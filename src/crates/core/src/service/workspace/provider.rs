use super::manager::{WorkspaceInfo, WorkspaceSummary};
use super::service::{BatchImportResult, WorkspaceHealthStatus, WorkspaceService};
use crate::error::CoreResult;
use std::sync::Arc;

/// Workspace provider - simplified workspace access API
pub struct WorkspaceProvider {
    service: Arc<WorkspaceService>,
}

impl WorkspaceProvider {
    /// Creates a new workspace provider.
    pub async fn new() -> CoreResult<Self> {
        let service = Arc::new(WorkspaceService::new().await?);
        Ok(Self { service })
    }

    /// Creates a workspace provider with a custom service.
    pub fn with_service(service: Arc<WorkspaceService>) -> Self {
        Self { service }
    }

    /// Quick-opens a workspace.
    pub async fn open(&self, path: &str) -> CoreResult<WorkspaceInfo> {
        self.service.quick_open(path).await
    }

    /// Quickly creates a new project workspace.
    pub async fn create_project(&self, path: &str) -> CoreResult<WorkspaceInfo> {
        self.service
            .open_workspace(std::path::PathBuf::from(path))
            .await
    }

    /// Returns the last-used workspace.
    pub async fn last_used(&self) -> Option<WorkspaceInfo> {
        self.service.get_last_used_workspace().await
    }

    /// Remembers a workspace as last-used.
    pub async fn remember(&self, workspace_id: &str) -> CoreResult<()> {
        self.service.remember_workspace_by_id(workspace_id).await
    }

    /// Lists recent workspaces.
    pub async fn recent(&self, limit: usize) -> Vec<WorkspaceInfo> {
        let mut recent = self.service.get_recent_workspaces().await;
        recent.truncate(limit);
        recent
    }

    /// Searches workspaces.
    pub async fn search(&self, query: &str) -> Vec<WorkspaceSummary> {
        self.service.search_workspaces(query).await
    }

    /// Closes the last-used workspace.
    pub async fn close_last_used(&self) -> CoreResult<()> {
        self.service.close_last_used_workspace().await
    }

    /// Returns the service reference (for advanced operations).
    pub fn get_service(&self) -> Arc<WorkspaceService> {
        self.service.clone()
    }

    /// Returns the workspace summary.
    pub async fn get_summary(&self) -> WorkspaceSystemSummary {
        let quick_summary = self.service.get_quick_summary().await;
        let health = self
            .service
            .health_check()
            .await
            .unwrap_or_else(|_| WorkspaceHealthStatus {
                healthy: false,
                total_workspaces: 0,
                active_workspaces: 0,
                last_used_workspace_valid: false,
                total_files: 0,
                total_size_mb: 0,
                warnings: vec!["Health check failed".to_string()],
                issues: vec!["Unable to check health".to_string()],
                message: "Health check failed".to_string(),
            });

        WorkspaceSystemSummary {
            total_workspaces: quick_summary.total_workspaces,
            active_workspaces: quick_summary.active_workspaces,
            last_used_workspace: quick_summary.last_used_workspace,
            recent_workspaces: quick_summary.recent_workspaces,
            healthy: health.healthy,
            warnings: health.warnings,
            total_files: health.total_files,
            total_size_mb: health.total_size_mb,
        }
    }

    /// Quick cleanup.
    pub async fn quick_cleanup(&self) -> CoreResult<WorkspaceCleanupResult> {
        let invalid_count = self.service.cleanup_invalid_workspaces().await?;

        Ok(WorkspaceCleanupResult {
            invalid_workspaces_removed: invalid_count,
            total_workspaces_after: self.service.get_workspace_count().await,
        })
    }

    /// Batch-imports directories.
    pub async fn import_directories(
        &self,
        directories: Vec<String>,
    ) -> CoreResult<BatchImportResult> {
        self.service.batch_import_workspaces(directories).await
    }

    /// Rescans a workspace.
    pub async fn rescan(&self, workspace_id: &str) -> CoreResult<WorkspaceInfo> {
        self.service.rescan_workspace(workspace_id).await
    }
}

/// Workspace system summary
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct WorkspaceSystemSummary {
    pub total_workspaces: usize,
    pub active_workspaces: usize,
    pub last_used_workspace: Option<WorkspaceSummary>,
    pub recent_workspaces: Vec<WorkspaceSummary>,
    pub healthy: bool,
    pub warnings: Vec<String>,
    pub total_files: usize,
    pub total_size_mb: u64,
}

/// Workspace cleanup result
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct WorkspaceCleanupResult {
    pub invalid_workspaces_removed: usize,
    pub total_workspaces_after: usize,
}
