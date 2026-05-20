//! Workspace service - advanced workspace management API
//!
//! Provides comprehensive workspace management functionality.

use super::manager::{
    WorkspaceInfo, WorkspaceKind, WorkspaceManager, WorkspaceManagerConfig,
    WorkspaceManagerStatistics, WorkspaceOpenOptions, WorkspaceStatus, WorkspaceSummary,
};
use crate::agentic::persistence::{PersistenceManager, SessionWorkspaceMaintenanceService};
use crate::infrastructure::storage::{PersistenceService, StorageOptions};
use crate::infrastructure::{try_get_path_manager_arc, PathManager};
use crate::service::workspace_runtime::{
    try_get_workspace_runtime_service_arc, WorkspaceRuntimeService,
};
use crate::service::workspace_session::local_workspace_roots_equal;
use crate::util::errors::*;
use log::{info, warn};

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Workspace service.
pub struct WorkspaceService {
    manager: Arc<RwLock<WorkspaceManager>>,
    #[allow(dead_code)]
    config: WorkspaceManagerConfig,
    persistence: Arc<PersistenceService>,
    path_manager: Arc<PathManager>,
    runtime_service: Arc<WorkspaceRuntimeService>,
    session_workspace_maintenance: Arc<SessionWorkspaceMaintenanceService>,
}

/// Workspace creation options.
#[derive(Debug, Clone)]
pub struct WorkspaceCreateOptions {
    pub remember_last_used: bool,
    pub add_to_recent: bool,
    pub workspace_kind: WorkspaceKind,
    pub display_name: Option<String>,
}

impl Default for WorkspaceCreateOptions {
    fn default() -> Self {
        Self {
            remember_last_used: true,
            add_to_recent: true,
            workspace_kind: WorkspaceKind::Normal,
            display_name: None,
        }
    }
}

/// Batch import result.
#[derive(Debug, Serialize, Deserialize)]
pub struct BatchImportResult {
    pub successful: Vec<String>,
    pub failed: Vec<(String, String)>, // (path, error_message)
    pub total_processed: usize,
    pub skipped: Vec<String>,
}

impl WorkspaceService {
    fn collect_startup_restored_workspaces(manager: &WorkspaceManager) -> Vec<WorkspaceInfo> {
        let mut targets = Vec::new();
        let mut seen_workspace_ids = HashSet::new();

        if let Some(workspace) = manager.get_last_used_workspace() {
            Self::push_startup_restored_workspace(&mut targets, &mut seen_workspace_ids, workspace);
        }

        for workspace in manager.get_opened_workspace_infos() {
            Self::push_startup_restored_workspace(&mut targets, &mut seen_workspace_ids, workspace);
        }

        targets
    }

    fn push_startup_restored_workspace(
        targets: &mut Vec<WorkspaceInfo>,
        seen_workspace_ids: &mut HashSet<String>,
        workspace: &WorkspaceInfo,
    ) {
        if seen_workspace_ids.insert(workspace.id.clone()) {
            targets.push(workspace.clone());
        }
    }

    async fn prepare_startup_restored_workspaces(&self, workspaces: Vec<WorkspaceInfo>) {
        for workspace in workspaces {
            self.ensure_workspace_runtime_best_effort(&workspace, "restored")
                .await;
            self.maintain_workspace_sessions_best_effort(
                &workspace.root_path,
                "workspace_history_restored",
            )
            .await;
        }
    }

    async fn ensure_workspace_runtime_best_effort(&self, workspace: &WorkspaceInfo, trigger: &str) {
        if !workspace.root_path.exists() {
            return;
        }

        let result = self
            .runtime_service
            .ensure_local_workspace_runtime(&workspace.root_path)
            .await;

        if let Err(e) = result {
            warn!(
                "Failed to initialize workspace runtime: workspace_path={} trigger={} error={}",
                workspace.root_path.display(),
                trigger,
                e
            );
        }
    }

    async fn maintain_workspace_sessions_best_effort(&self, workspace_path: &Path, trigger: &str) {
        match self
            .session_workspace_maintenance
            .ensure_workspace_maintained(workspace_path)
            .await
        {
            Ok(report) if report.skipped || report.deleted_sessions == 0 => {}
            Ok(report) => {
                info!(
                    "Workspace session maintenance finished: trigger={}, workspace_path={}, scanned_sessions={}, hidden_sessions={}, deleted_sessions={}",
                    trigger,
                    workspace_path.display(),
                    report.scanned_sessions,
                    report.hidden_sessions,
                    report.deleted_sessions
                );
            }
            Err(e) => {
                warn!(
                    "Failed to maintain workspace sessions: trigger={}, workspace_path={}, error={}",
                    trigger,
                    workspace_path.display(),
                    e
                );
            }
        }
    }

    /// Creates a new workspace service.
    pub async fn new() -> BitFunResult<Self> {
        let config = WorkspaceManagerConfig::default();
        Self::with_config(config).await
    }

    /// Creates a workspace service with a custom configuration.
    pub async fn with_config(config: WorkspaceManagerConfig) -> BitFunResult<Self> {
        let path_manager = try_get_path_manager_arc()?;
        let runtime_service = try_get_workspace_runtime_service_arc()?;

        path_manager.initialize_user_directories().await?;

        let persistence = Arc::new(
            PersistenceService::new_user_level(path_manager.clone())
                .await
                .map_err(|e| {
                    BitFunError::service(format!("Failed to create persistence service: {}", e))
                })?,
        );

        let manager = WorkspaceManager::new(config.clone());
        let session_workspace_maintenance = Arc::new(SessionWorkspaceMaintenanceService::new(
            Arc::new(PersistenceManager::new(path_manager.clone())?),
        ));

        let service = Self {
            manager: Arc::new(RwLock::new(manager)),
            config,
            persistence,
            path_manager,
            runtime_service,
            session_workspace_maintenance,
        };

        if let Err(e) = service.load_workspace_history_only().await {
            warn!("Failed to load workspace history on startup: {}", e);
        }

        Ok(service)
    }

    /// Returns the path manager.
    pub fn path_manager(&self) -> &Arc<PathManager> {
        &self.path_manager
    }

    /// Returns the persistence service.
    pub fn persistence(&self) -> &Arc<PersistenceService> {
        &self.persistence
    }

    pub fn runtime_service(&self) -> &Arc<WorkspaceRuntimeService> {
        &self.runtime_service
    }

    /// Opens a workspace.
    pub async fn open_workspace(&self, path: PathBuf) -> BitFunResult<WorkspaceInfo> {
        self.open_workspace_with_options(path, WorkspaceCreateOptions::default())
            .await
    }

    /// Opens a workspace with explicit workspace metadata.
    pub async fn open_workspace_with_options(
        &self,
        path: PathBuf,
        options: WorkspaceCreateOptions,
    ) -> BitFunResult<WorkspaceInfo> {
        let result = {
            let mut manager = self.manager.write().await;
            manager
                .open_workspace_with_options(path, Self::to_manager_open_options(&options))
                .await
        };

        if let Ok(workspace) = result.as_ref() {
            self.ensure_workspace_runtime_best_effort(workspace, "opened")
                .await;
        }

        if result.is_ok() {
            if let Err(e) = self.save_workspace_data().await {
                warn!("Failed to save workspace data after opening: {}", e);
            }
        }

        if let Ok(workspace) = result.as_ref() {
            self.maintain_workspace_sessions_best_effort(&workspace.root_path, "workspace_opened")
                .await;
        }

        result
    }

    /// Registers or refreshes workspace activity without marking it as opened in the UI.
    pub async fn track_workspace_activity(
        &self,
        path: PathBuf,
        options: WorkspaceCreateOptions,
    ) -> BitFunResult<WorkspaceInfo> {
        let result = {
            let mut manager = self.manager.write().await;
            manager
                .track_workspace_with_options(path, Self::to_manager_open_options(&options))
                .await
        };

        if let Ok(workspace) = result.as_ref() {
            self.ensure_workspace_runtime_best_effort(workspace, "tracked")
                .await;
        }

        if result.is_ok() {
            if let Err(e) = self.save_workspace_data().await {
                warn!(
                    "Failed to save workspace data after tracking activity: {}",
                    e
                );
            }
        }

        if let Ok(workspace) = result.as_ref() {
            self.maintain_workspace_sessions_best_effort(&workspace.root_path, "workspace_tracked")
                .await;
        }

        result
    }

    /// Quickly opens a workspace (using default options).
    pub async fn quick_open(&self, path: &str) -> BitFunResult<WorkspaceInfo> {
        let path_buf = PathBuf::from(path);
        self.open_workspace(path_buf).await
    }

    /// Creates a workspace (for a new project).
    pub async fn create_workspace(
        &self,
        path: PathBuf,
        options: WorkspaceCreateOptions,
    ) -> BitFunResult<WorkspaceInfo> {
        if !path.exists() {
            tokio::fs::create_dir_all(&path).await.map_err(|e| {
                BitFunError::service(format!("Failed to create workspace directory: {}", e))
            })?;
        }

        let workspace = self
            .open_workspace_with_options(path, options.clone())
            .await?;

        {
            let mut manager = self.manager.write().await;
            manager
                .get_workspaces_mut()
                .insert(workspace.id.clone(), workspace.clone());
        }

        self.save_workspace_data().await?;

        Ok(workspace)
    }

    /// Closes the last-used workspace.
    pub async fn close_last_used_workspace(&self) -> BitFunResult<()> {
        let result = {
            let mut manager = self.manager.write().await;
            manager.close_last_used_workspace()
        };

        if result.is_ok() {
            if let Err(e) = self.save_workspace_data().await {
                warn!("Failed to save workspace data after closing: {}", e);
            }
        }

        result
    }

    /// Closes the specified workspace.
    pub async fn close_workspace(&self, workspace_id: &str) -> BitFunResult<()> {
        let result = {
            let mut manager = self.manager.write().await;
            manager.close_workspace(workspace_id)
        };

        if result.is_ok() {
            if let Err(e) = self.save_workspace_data().await {
                warn!("Failed to save workspace data after closing: {}", e);
            }
        }

        result
    }

    /// Remembers a workspace from the opened workspace list as the last-used workspace.
    pub async fn remember_workspace(&self, workspace_id: &str) -> BitFunResult<()> {
        let result = {
            let mut manager = self.manager.write().await;
            manager.remember_workspace(workspace_id)
        };

        if result.is_ok() {
            if let Err(e) = self.save_workspace_data().await {
                warn!(
                    "Failed to save workspace data after remembering workspace: {}",
                    e
                );
            }
        }

        if result.is_ok() {
            if let Some(workspace) = self.get_workspace(workspace_id).await {
                self.ensure_workspace_runtime_best_effort(&workspace, "activated")
                    .await;
                self.maintain_workspace_sessions_best_effort(
                    &workspace.root_path,
                    "workspace_remembered",
                )
                .await;
            }
        }

        result
    }

    /// Reorders the opened workspaces without changing active or recent state.
    pub async fn reorder_opened_workspaces(&self, workspace_ids: Vec<String>) -> BitFunResult<()> {
        let current_ids = {
            let manager = self.manager.read().await;
            manager.get_opened_workspace_ids().clone()
        };

        if workspace_ids.len() != current_ids.len() {
            return Err(BitFunError::service(format!(
                "Opened workspace count mismatch: expected {}, got {}",
                current_ids.len(),
                workspace_ids.len()
            )));
        }

        let requested_ids = workspace_ids.iter().cloned().collect::<HashSet<_>>();
        if requested_ids.len() != workspace_ids.len() {
            return Err(BitFunError::service(
                "Opened workspace order contains duplicate ids".to_string(),
            ));
        }

        let current_id_set = current_ids.iter().cloned().collect::<HashSet<_>>();
        if requested_ids != current_id_set {
            return Err(BitFunError::service(
                "Opened workspace order must contain exactly the currently opened workspace ids"
                    .to_string(),
            ));
        }

        {
            let mut manager = self.manager.write().await;
            manager.set_opened_workspace_ids(workspace_ids.clone());
        }

        if let Err(error) = self.save_workspace_data().await {
            let mut manager = self.manager.write().await;
            manager.set_opened_workspace_ids(current_ids);
            return Err(error);
        }

        Ok(())
    }

    /// Remembers the specified workspace as last-used.
    pub async fn remember_workspace_by_id(&self, workspace_id: &str) -> BitFunResult<()> {
        self.remember_workspace(workspace_id).await
    }

    /// Returns the last-used workspace.
    pub async fn get_last_used_workspace(&self) -> Option<WorkspaceInfo> {
        let manager = self.manager.read().await;
        manager.get_last_used_workspace().cloned()
    }

    /// Best-effort synchronous read for contexts that cannot `await`.
    pub fn try_get_last_used_workspace_path(&self) -> Option<PathBuf> {
        self.manager.try_read().ok().and_then(|manager| {
            manager
                .get_last_used_workspace()
                .map(|workspace| workspace.root_path.clone())
        })
    }

    /// Returns workspace details.
    pub async fn get_workspace(&self, workspace_id: &str) -> Option<WorkspaceInfo> {
        let manager = self.manager.read().await;
        manager.get_workspace(workspace_id).cloned()
    }

    /// Returns workspace details by root path.
    pub async fn get_workspace_by_path(&self, path: &Path) -> Option<WorkspaceInfo> {
        let manager = self.manager.read().await;
        manager
            .get_workspaces()
            .values()
            .find(|workspace| local_workspace_roots_equal(&workspace.root_path, path))
            .cloned()
    }

    /// Returns all currently opened workspaces.
    pub async fn get_opened_workspaces(&self) -> Vec<WorkspaceInfo> {
        let manager = self.manager.read().await;
        manager
            .get_opened_workspace_infos()
            .into_iter()
            .cloned()
            .collect()
    }

    /// All tracked workspaces with full metadata (maintenance, etc.).
    pub async fn list_workspace_infos(&self) -> Vec<WorkspaceInfo> {
        let manager = self.manager.read().await;
        manager.get_workspaces().values().cloned().collect()
    }

    /// Lists tracked workspaces ordered by most recent activity.
    pub async fn list_workspace_routing_candidates(&self) -> Vec<WorkspaceInfo> {
        let manager = self.manager.read().await;
        let mut workspaces = manager
            .get_workspaces()
            .values()
            .cloned()
            .collect::<Vec<_>>();

        workspaces.sort_by(|left, right| {
            right
                .last_accessed
                .cmp(&left.last_accessed)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
                .then_with(|| left.id.cmp(&right.id))
        });

        workspaces
    }

    /// Lists all workspaces.
    pub async fn list_workspaces(&self) -> Vec<WorkspaceSummary> {
        let manager = self.manager.read().await;
        manager.list_workspaces()
    }

    /// Lists workspaces by status.
    pub async fn list_workspaces_by_status(
        &self,
        status: WorkspaceStatus,
    ) -> Vec<WorkspaceSummary> {
        let manager = self.manager.read().await;
        manager
            .list_workspaces()
            .into_iter()
            .filter(|ws| ws.status == status)
            .collect()
    }

    /// Returns recently accessed workspaces.
    pub async fn get_recent_workspaces(&self) -> Vec<WorkspaceInfo> {
        let manager = self.manager.read().await;
        let recent_ids = manager.get_recent_workspaces();
        let mut recent_workspaces = Vec::new();

        for workspace_id in recent_ids {
            if let Some(workspace) = manager.get_workspaces().get(workspace_id) {
                recent_workspaces.push(workspace.clone());
            }
        }

        recent_workspaces
    }

    /// Drops a workspace from recent lists only (workspace record and open state unchanged).
    pub async fn remove_workspace_from_recent(&self, workspace_id: &str) -> BitFunResult<()> {
        let changed = {
            let mut manager = self.manager.write().await;
            manager.remove_from_recent_workspaces_only(workspace_id)
        };
        if changed {
            self.save_workspace_data().await?;
        }
        Ok(())
    }

    /// Searches workspaces.
    pub async fn search_workspaces(&self, query: &str) -> Vec<WorkspaceSummary> {
        let manager = self.manager.read().await;
        manager.search_workspaces(query)
    }

    /// Removes a workspace.
    pub async fn remove_workspace(&self, workspace_id: &str) -> BitFunResult<()> {
        let result = {
            let mut manager = self.manager.write().await;
            manager.remove_workspace(workspace_id)
        };

        if result.is_ok() {
            if let Err(e) = self.save_workspace_data().await {
                warn!("Failed to save workspace data after removal: {}", e);
            }
        }

        result
    }

    /// Removes workspaces in batch.
    pub async fn batch_remove_workspaces(
        &self,
        workspace_ids: Vec<String>,
    ) -> BitFunResult<BatchRemoveResult> {
        let mut result = BatchRemoveResult {
            successful: Vec::new(),
            failed: Vec::new(),
            total_processed: workspace_ids.len(),
        };

        for workspace_id in workspace_ids {
            match self.remove_workspace(&workspace_id).await {
                Ok(_) => result.successful.push(workspace_id),
                Err(e) => result.failed.push((workspace_id, e.to_string())),
            }
        }

        Ok(result)
    }

    /// Rescans a workspace.
    pub async fn rescan_workspace(&self, workspace_id: &str) -> BitFunResult<WorkspaceInfo> {
        let workspace_path = {
            let manager = self.manager.read().await;
            if let Some(workspace) = manager.get_workspace(workspace_id) {
                workspace.root_path.clone()
            } else {
                return Err(BitFunError::service(format!(
                    "Workspace not found: {}",
                    workspace_id
                )));
            }
        };

        let existing_workspace = {
            let manager = self.manager.read().await;
            manager.get_workspace(workspace_id).cloned()
        };
        let Some(existing_workspace) = existing_workspace else {
            return Err(BitFunError::service(format!(
                "Workspace not found: {}",
                workspace_id
            )));
        };
        let new_workspace = WorkspaceInfo::new(
            workspace_path,
            WorkspaceOpenOptions {
                remember_last_used: existing_workspace.status == WorkspaceStatus::Active,
                add_to_recent: false,
                workspace_kind: existing_workspace.workspace_kind.clone(),
                display_name: Some(existing_workspace.name.clone()),
            },
        )
        .await?;
        let mut new_workspace = new_workspace;
        new_workspace.id = existing_workspace.id.clone();
        new_workspace.opened_at = existing_workspace.opened_at;
        new_workspace.metadata = existing_workspace.metadata.clone();

        {
            let mut manager = self.manager.write().await;
            manager
                .get_workspaces_mut()
                .insert(workspace_id.to_string(), new_workspace.clone());
        }

        if let Err(e) = self.save_workspace_data().await {
            warn!("Failed to save workspace data after rescan: {}", e);
        }

        Ok(new_workspace)
    }

    /// Imports workspaces in batch.
    pub async fn batch_import_workspaces(
        &self,
        paths: Vec<String>,
    ) -> BitFunResult<BatchImportResult> {
        let mut result = BatchImportResult {
            successful: Vec::new(),
            failed: Vec::new(),
            total_processed: paths.len(),
            skipped: Vec::new(),
        };

        for path_str in paths {
            let path = PathBuf::from(&path_str);

            if !path.exists() {
                result
                    .failed
                    .push((path_str, "Path does not exist".to_string()));
                continue;
            }

            if !path.is_dir() {
                result
                    .failed
                    .push((path_str, "Path is not a directory".to_string()));
                continue;
            }

            {
                let manager = self.manager.read().await;
                if manager
                    .get_workspaces()
                    .values()
                    .any(|w| local_workspace_roots_equal(&w.root_path, &path))
                {
                    result.skipped.push(path_str);
                    continue;
                }
            }

            match self.open_workspace(path).await {
                Ok(workspace) => {
                    result.successful.push(workspace.id);
                }
                Err(e) => {
                    result.failed.push((path_str, e.to_string()));
                }
            }
        }

        Ok(result)
    }

    /// Cleans up invalid workspaces.
    pub async fn cleanup_invalid_workspaces(&self) -> BitFunResult<usize> {
        let result = {
            let mut manager = self.manager.write().await;
            manager.cleanup_invalid_workspaces().await
        };

        if result.is_ok() {
            if let Err(e) = self.save_workspace_data().await {
                warn!("Failed to save workspace data after cleanup: {}", e);
            }
        }

        result
    }

    /// Returns statistics.
    pub async fn get_statistics(&self) -> WorkspaceManagerStatistics {
        let manager = self.manager.read().await;
        manager.get_statistics()
    }

    /// Returns the workspace count.
    pub async fn get_workspace_count(&self) -> usize {
        let manager = self.manager.read().await;
        manager.get_workspace_count()
    }

    /// Runs a health check.
    pub async fn health_check(&self) -> BitFunResult<WorkspaceHealthStatus> {
        let stats = self.get_statistics().await;

        let mut warnings = Vec::new();
        let mut issues = Vec::new();

        if stats.total_workspaces == 0 {
            warnings.push("No workspaces found".to_string());
        }

        if stats.active_workspaces == 0 {
            warnings.push("No active workspaces".to_string());
        }

        if stats.inactive_workspaces > stats.active_workspaces * 3 {
            issues.push("Too many inactive workspaces, consider cleanup".to_string());
        }

        let last_used_workspace_valid = match self.get_last_used_workspace().await {
            Some(current) => current.is_valid().await,
            None => true,
        };

        if !last_used_workspace_valid {
            issues.push("Last-used workspace path is invalid".to_string());
        }

        let healthy = issues.is_empty() && last_used_workspace_valid;

        Ok(WorkspaceHealthStatus {
            healthy,
            total_workspaces: stats.total_workspaces,
            active_workspaces: stats.active_workspaces,
            last_used_workspace_valid,
            total_files: 0,
            total_size_mb: 0,
            warnings,
            issues: issues.clone(),
            message: if healthy {
                "Workspace system is healthy".to_string()
            } else {
                format!("{} issues detected", issues.len())
            },
        })
    }

    /// Exports workspace configuration.
    pub async fn export_workspaces(&self) -> BitFunResult<WorkspaceExport> {
        let manager = self.manager.read().await;
        let workspaces: Vec<WorkspaceInfo> = manager.get_workspaces().values().cloned().collect();
        let last_used_workspace_id = manager.get_last_used_workspace().map(|w| w.id.clone());
        let _recent_workspaces = manager.get_recent_workspaces().clone();

        Ok(WorkspaceExport {
            workspaces,
            last_used_workspace_id,
            recent_workspaces: manager
                .get_recent_workspace_infos()
                .iter()
                .map(|w| w.id.clone())
                .collect(),
            export_timestamp: chrono::Utc::now().to_rfc3339(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        })
    }

    /// Imports workspace configuration.
    pub async fn import_workspaces(
        &self,
        export: WorkspaceExport,
        overwrite: bool,
    ) -> BitFunResult<WorkspaceImportResult> {
        let mut result = WorkspaceImportResult {
            imported_workspaces: 0,
            skipped_workspaces: 0,
            errors: Vec::new(),
            warnings: Vec::new(),
        };

        let mut manager = self.manager.write().await;

        for workspace in export.workspaces {
            if !workspace.is_valid().await {
                result.warnings.push(format!(
                    "Workspace path no longer valid: {:?}",
                    workspace.root_path
                ));
                continue;
            }

            if !overwrite && manager.get_workspaces().contains_key(&workspace.id) {
                result.skipped_workspaces += 1;
                continue;
            }

            manager
                .get_workspaces_mut()
                .insert(workspace.id.clone(), workspace);
            result.imported_workspaces += 1;
        }

        manager.set_recent_workspaces(export.recent_workspaces.clone());

        if let Some(current_id) = export.last_used_workspace_id {
            if manager.get_workspaces().contains_key(&current_id) {
                if let Err(e) = manager.set_last_used_workspace(current_id) {
                    result
                        .warnings
                        .push(format!("Failed to restore last-used workspace: {}", e));
                }
            } else {
                result
                    .warnings
                    .push("Last-used workspace not found in import".to_string());
            }
        }

        drop(manager);

        Ok(result)
    }

    /// Returns a quick summary.
    pub async fn get_quick_summary(&self) -> WorkspaceQuickSummary {
        let stats = self.get_statistics().await;
        let last_used_workspace = self.get_last_used_workspace().await;
        let recent_workspaces = self.get_recent_workspaces().await;

        WorkspaceQuickSummary {
            total_workspaces: stats.total_workspaces,
            active_workspaces: stats.active_workspaces,
            last_used_workspace: last_used_workspace.map(|w| w.get_summary()),
            recent_workspaces: recent_workspaces
                .into_iter()
                .take(5)
                .map(|w| w.get_summary())
                .collect(),
        }
    }

    /// Saves workspace data locally.
    async fn save_workspace_data(&self) -> BitFunResult<()> {
        let manager = self.manager.read().await;

        let workspace_data = WorkspacePersistenceData {
            workspaces: manager.get_workspaces().clone(),
            opened_workspace_ids: manager.get_opened_workspace_ids().clone(),
            last_used_workspace_id: manager.get_last_used_workspace().map(|w| w.id.clone()),
            recent_workspaces: manager.get_recent_workspaces().clone(),
            saved_at: chrono::Utc::now(),
        };

        self.persistence
            .save_json("workspace_data", &workspace_data, StorageOptions::default())
            .await
            .map_err(|e| BitFunError::service(format!("Failed to save workspace data: {}", e)))?;

        Ok(())
    }

    /// Loads workspace data from local storage.
    #[allow(dead_code)]
    async fn load_workspace_data(&self) -> BitFunResult<()> {
        let workspace_data: Option<WorkspacePersistenceData> = self
            .persistence
            .load_json("workspace_data")
            .await
            .map_err(|e| BitFunError::service(format!("Failed to load workspace data: {}", e)))?;

        if let Some(data) = workspace_data {
            let mut manager = self.manager.write().await;

            *manager.get_workspaces_mut() = data.workspaces;
            manager.set_opened_workspace_ids(data.opened_workspace_ids);
            manager.set_recent_workspaces(data.recent_workspaces);

            if let Some(raw_current) = data.last_used_workspace_id {
                if let Some(workspace) = manager.get_workspaces().get(&raw_current) {
                    if workspace.is_valid().await {
                        if let Err(e) = manager.set_last_used_workspace(raw_current) {
                            warn!("Failed to restore last-used workspace: {}", e);
                        }
                    } else {
                        warn!("Last-used workspace path no longer valid, skipping restore");
                    }
                }
            }

            info!(
                "Loaded {} workspaces from local storage",
                manager.get_workspaces().len()
            );
        } else {
            info!("No saved workspace data found, starting fresh");
        }

        Ok(())
    }

    /// Loads workspace history only without restoring the current workspace (used on startup).
    async fn load_workspace_history_only(&self) -> BitFunResult<()> {
        let workspace_data: Option<WorkspacePersistenceData> = self
            .persistence
            .load_json("workspace_data")
            .await
            .map_err(|e| BitFunError::service(format!("Failed to load workspace data: {}", e)))?;

        let mut workspaces_to_restore = Vec::new();

        if let Some(data) = workspace_data {
            let mut manager = self.manager.write().await;

            let mut workspaces: HashMap<String, WorkspaceInfo> = data.workspaces;
            workspaces.retain(|_id, ws| !ws.metadata.contains_key("connectionId"));

            *manager.get_workspaces_mut() = workspaces;
            // Also filter opened/recent lists to remove references to removed legacy workspaces
            let filtered_opened_ids: Vec<String> = data
                .opened_workspace_ids
                .clone()
                .into_iter()
                .filter(|id| manager.get_workspaces().contains_key(id))
                .collect();
            manager.set_opened_workspace_ids(filtered_opened_ids);

            let filtered_recent: Vec<String> = data
                .recent_workspaces
                .clone()
                .into_iter()
                .filter(|id| manager.get_workspaces().contains_key(id))
                .collect();
            manager.set_recent_workspaces(filtered_recent);

            let raw_current = data
                .last_used_workspace_id
                .or_else(|| data.opened_workspace_ids.first().cloned());

            if let Some(raw) = raw_current {
                if manager.get_workspaces().contains_key(&raw) {
                    if let Err(e) = manager.set_last_used_workspace(raw) {
                        warn!("Failed to restore last-used workspace on startup: {}", e);
                    }
                }
            }

            workspaces_to_restore = Self::collect_startup_restored_workspaces(&manager);
        }

        self.prepare_startup_restored_workspaces(workspaces_to_restore)
            .await;

        Ok(())
    }

    fn to_manager_open_options(options: &WorkspaceCreateOptions) -> WorkspaceOpenOptions {
        WorkspaceOpenOptions {
            remember_last_used: options.remember_last_used,
            add_to_recent: options.add_to_recent,
            workspace_kind: options.workspace_kind.clone(),
            display_name: options.display_name.clone(),
        }
    }

    /// Saves workspace data manually (public API).
    pub async fn manual_save(&self) -> BitFunResult<()> {
        self.save_workspace_data().await
    }

    /// Clears all persisted data.
    pub async fn clear_persistent_data(&self) -> BitFunResult<()> {
        self.persistence
            .delete("workspace_data")
            .await
            .map_err(|e| BitFunError::service(format!("Failed to clear workspace data: {}", e)))?;

        Ok(())
    }

    /// Returns the underlying `WorkspaceManager` handle.
    /// Used to share workspace state with other services (e.g. Agent).
    pub fn get_manager(&self) -> Arc<RwLock<WorkspaceManager>> {
        self.manager.clone()
    }
}

/// Batch remove result.
#[derive(Debug, Serialize, Deserialize)]
pub struct BatchRemoveResult {
    pub successful: Vec<String>,
    pub failed: Vec<(String, String)>,
    pub total_processed: usize,
}

/// Workspace health status.
#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceHealthStatus {
    pub healthy: bool,
    pub total_workspaces: usize,
    pub active_workspaces: usize,
    pub last_used_workspace_valid: bool,
    pub total_files: usize,
    pub total_size_mb: u64,
    pub warnings: Vec<String>,
    pub issues: Vec<String>,
    pub message: String,
}

/// Workspace export format.
#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceExport {
    pub workspaces: Vec<WorkspaceInfo>,
    pub last_used_workspace_id: Option<String>,
    pub recent_workspaces: Vec<String>,
    pub export_timestamp: String,
    pub version: String,
}

/// Workspace import result.
#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceImportResult {
    pub imported_workspaces: usize,
    pub skipped_workspaces: usize,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

/// Workspace quick summary.
#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceQuickSummary {
    pub total_workspaces: usize,
    pub active_workspaces: usize,
    pub last_used_workspace: Option<WorkspaceSummary>,
    pub recent_workspaces: Vec<WorkspaceSummary>,
}

/// Workspace persistence data.
#[derive(Debug, Serialize, Deserialize)]
struct WorkspacePersistenceData {
    pub workspaces: std::collections::HashMap<String, WorkspaceInfo>,
    #[serde(default)]
    pub opened_workspace_ids: Vec<String>,
    pub last_used_workspace_id: Option<String>,
    #[serde(default)]
    pub recent_workspaces: Vec<String>,
    pub saved_at: chrono::DateTime<chrono::Utc>,
}

// ── Global workspace service singleton ──────────────────────────────

static GLOBAL_WORKSPACE_SERVICE: std::sync::OnceLock<Arc<WorkspaceService>> =
    std::sync::OnceLock::new();

pub fn set_global_workspace_service(service: Arc<WorkspaceService>) {
    match GLOBAL_WORKSPACE_SERVICE.set(service) {
        Ok(_) => info!("Global workspace service set"),
        Err(_) => info!("Global workspace service already exists, skipping set"),
    }
}

pub fn get_global_workspace_service() -> Option<Arc<WorkspaceService>> {
    GLOBAL_WORKSPACE_SERVICE.get().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::storage::{PersistenceService, StorageOptions};
    use crate::service::session::SessionMetadata;
    use std::collections::HashMap;
    use uuid::Uuid;

    struct TestEnvironment {
        root: PathBuf,
        path_manager: Arc<PathManager>,
    }

    impl TestEnvironment {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!("bitfun-workspace-service-test-{}", Uuid::new_v4()));
            std::fs::create_dir_all(&root).expect("test root should be created");

            let path_manager = Arc::new(PathManager::with_user_root_for_tests(
                root.join("user-root"),
            ));

            Self { root, path_manager }
        }

        fn create_workspace_dir(&self, name: &str) -> PathBuf {
            let path = self.root.join(name);
            std::fs::create_dir_all(&path).expect("workspace directory should be created");
            path
        }
    }

    impl Drop for TestEnvironment {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    async fn build_test_workspace_service(path_manager: Arc<PathManager>) -> WorkspaceService {
        path_manager
            .initialize_user_directories()
            .await
            .expect("user directories should initialize");

        let config = WorkspaceManagerConfig::default();
        let persistence = Arc::new(
            PersistenceService::new_user_level(path_manager.clone())
                .await
                .expect("persistence should initialize"),
        );
        let runtime_service = Arc::new(WorkspaceRuntimeService::new(path_manager.clone()));
        let session_workspace_maintenance =
            Arc::new(SessionWorkspaceMaintenanceService::new(Arc::new(
                PersistenceManager::new(path_manager.clone())
                    .expect("persistence manager should initialize"),
            )));

        WorkspaceService {
            manager: Arc::new(RwLock::new(WorkspaceManager::new(config.clone()))),
            config,
            persistence,
            path_manager,
            runtime_service,
            session_workspace_maintenance,
        }
    }

    #[tokio::test]
    async fn load_workspace_history_only_ensures_all_opened_local_workspaces() {
        let env = TestEnvironment::new();
        let service = build_test_workspace_service(env.path_manager.clone()).await;
        let persistence_manager = PersistenceManager::new(env.path_manager.clone())
            .expect("persistence manager should initialize");

        let first_workspace_root = env.create_workspace_dir("workspace-one");
        let second_workspace_root = env.create_workspace_dir("workspace-two");

        let first_workspace = WorkspaceInfo::new(
            first_workspace_root.clone(),
            WorkspaceOpenOptions {
                remember_last_used: false,
                ..Default::default()
            },
        )
        .await
        .expect("first workspace should initialize");
        let second_workspace = WorkspaceInfo::new(
            second_workspace_root.clone(),
            WorkspaceOpenOptions {
                remember_last_used: false,
                ..Default::default()
            },
        )
        .await
        .expect("second workspace should initialize");

        let second_session = SessionMetadata::new(
            Uuid::new_v4().to_string(),
            "Workspace Session".to_string(),
            "agent".to_string(),
            "model".to_string(),
        );
        persistence_manager
            .save_session_metadata(&second_workspace_root, &second_session)
            .await
            .expect("workspace session metadata should save");

        let second_runtime = persistence_manager
            .runtime_service()
            .context_for_local_workspace(&second_workspace_root);

        let first_runtime = service
            .runtime_service
            .context_for_local_workspace(&first_workspace_root);
        assert!(
            !first_runtime.runtime_root.exists(),
            "startup should begin without a runtime root for the first workspace"
        );
        assert!(
            !second_runtime.runtime_root.exists(),
            "startup should begin without a runtime root for the second workspace"
        );

        let workspace_data = WorkspacePersistenceData {
            workspaces: HashMap::from([
                (first_workspace.id.clone(), first_workspace.clone()),
                (second_workspace.id.clone(), second_workspace.clone()),
            ]),
            opened_workspace_ids: vec![first_workspace.id.clone(), second_workspace.id.clone()],
            last_used_workspace_id: Some(first_workspace.id.clone()),
            recent_workspaces: vec![first_workspace.id.clone(), second_workspace.id.clone()],
            saved_at: chrono::Utc::now(),
        };

        service
            .persistence
            .save_json("workspace_data", &workspace_data, StorageOptions::default())
            .await
            .expect("workspace data should save");

        service
            .load_workspace_history_only()
            .await
            .expect("workspace history should restore");

        let restored_current = service
            .get_last_used_workspace()
            .await
            .expect("current workspace should be restored");
        assert_eq!(restored_current.id, first_workspace.id);
        assert!(
            first_runtime.runtime_root.exists(),
            "active workspace runtime should be ensured on startup"
        );
        assert!(
            second_runtime
                .sessions_dir
                .join(&second_session.session_id)
                .exists(),
            "non-active opened workspace sessions should remain in the shared runtime root"
        );

        let restored_sessions = persistence_manager
            .list_session_metadata(&second_workspace_root)
            .await
            .expect("restored workspace sessions should list successfully");
        assert_eq!(restored_sessions.len(), 1);
        assert_eq!(restored_sessions[0].session_id, second_session.session_id);
    }

    #[tokio::test]
    async fn track_workspace_activity_registers_without_opening_workspace() {
        let env = TestEnvironment::new();
        let service = build_test_workspace_service(env.path_manager.clone()).await;
        let workspace_root = env.create_workspace_dir("tracked-workspace");

        let tracked = service
            .track_workspace_activity(workspace_root.clone(), WorkspaceCreateOptions::default())
            .await
            .expect("workspace tracking should succeed");

        let tracked_by_path = service
            .get_workspace_by_path(&workspace_root)
            .await
            .expect("tracked workspace should be queryable by path");
        assert_eq!(tracked_by_path.id, tracked.id);

        let recent = service.get_recent_workspaces().await;
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].id, tracked.id);

        assert!(
            service.get_opened_workspaces().await.is_empty(),
            "tracked workspace activity should not add the workspace to the opened UI list"
        );
        assert!(
            service.get_last_used_workspace().await.is_none(),
            "tracked workspace activity should not change the current workspace"
        );
    }

    #[tokio::test]
    async fn routing_candidates_include_tracked_workspaces_by_last_activity() {
        let env = TestEnvironment::new();
        let service = build_test_workspace_service(env.path_manager.clone()).await;
        let first_root = env.create_workspace_dir("workspace-one");
        let second_root = env.create_workspace_dir("workspace-two");

        let first = service
            .track_workspace_activity(first_root, WorkspaceCreateOptions::default())
            .await
            .expect("first tracked workspace should succeed");
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        let second = service
            .track_workspace_activity(second_root, WorkspaceCreateOptions::default())
            .await
            .expect("second tracked workspace should succeed");

        let candidates = service.list_workspace_routing_candidates().await;
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].id, second.id);
        assert_eq!(candidates[1].id, first.id);
    }
}
