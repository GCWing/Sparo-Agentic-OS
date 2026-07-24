//! Application data reset service.
//!
//! This is intentionally broader than routine cleanup: it removes durable
//! Sparo OS application data and asks the desktop shell to restart afterwards.

use crate::error::{CoreError, CoreResult};
use crate::infrastructure::{PathManager, APP_HIDDEN_DIR_NAME};
use chrono::Utc;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tokio::fs;

const RESET_CONFIRMATION: &str = "RESET SPARO OS";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResetMode {
    Soft,
    AppData,
    Factory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetApplicationDataRequest {
    pub mode: ResetMode,
    pub confirmation: String,
    #[serde(default = "default_create_backup")]
    pub create_backup: bool,
    #[serde(default)]
    pub include_logs: bool,
    #[serde(default)]
    pub include_secrets: bool,
    #[serde(default)]
    pub include_browser_profiles: bool,
    #[serde(default)]
    pub include_project_local_sparo_dirs: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetApplicationDataResult {
    pub reset_id: String,
    pub deleted_roots: Vec<PathBuf>,
    pub preserved_roots: Vec<PathBuf>,
    pub backup_dir: Option<PathBuf>,
    pub bytes_freed: u64,
    pub requires_restart: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResetManifest {
    reset_id: String,
    mode: ResetMode,
    created_at: String,
    deleted_roots: Vec<PathBuf>,
    preserved_roots: Vec<PathBuf>,
}

pub struct ResetApplicationDataService {
    path_manager: PathManager,
}

fn default_create_backup() -> bool {
    true
}

impl ResetApplicationDataService {
    pub fn new(path_manager: PathManager) -> Self {
        Self { path_manager }
    }

    pub async fn reset(
        &self,
        request: ResetApplicationDataRequest,
    ) -> CoreResult<ResetApplicationDataResult> {
        if request.confirmation.trim() != RESET_CONFIRMATION {
            return Err(CoreError::validation(format!(
                "Reset confirmation must be '{}'",
                RESET_CONFIRMATION
            )));
        }

        let reset_id = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
        let plan = self.build_plan(&request)?;
        let backup_dir = if request.create_backup {
            Some(
                self.create_reset_backup(&reset_id, request.mode, &plan.delete_roots)
                    .await?,
            )
        } else {
            None
        };

        let bytes_freed = Self::sum_existing_roots_size(&plan.delete_roots).await?;
        for root in &plan.delete_roots {
            Self::remove_root_if_exists(root).await?;
        }

        self.path_manager.initialize_user_directories().await?;
        self.write_reset_report(
            &reset_id,
            request.mode,
            &plan.delete_roots,
            &plan.preserved_roots,
            backup_dir.as_deref(),
        )
        .await?;

        info!(
            "Application data reset completed: reset_id={} mode={:?} deleted_roots={} bytes_freed={}",
            reset_id,
            request.mode,
            plan.delete_roots.len(),
            bytes_freed
        );

        Ok(ResetApplicationDataResult {
            reset_id,
            deleted_roots: plan.delete_roots,
            preserved_roots: plan.preserved_roots,
            backup_dir,
            bytes_freed,
            requires_restart: true,
        })
    }

    fn build_plan(&self, request: &ResetApplicationDataRequest) -> CoreResult<ResetPlan> {
        let mut delete_roots = Vec::new();
        let mut preserved_roots = Vec::new();

        match request.mode {
            ResetMode::Soft => {
                delete_roots.push(self.path_manager.cache_root());
                delete_roots.push(self.path_manager.temp_dir());
                delete_roots.push(self.path_manager.user_state_dir().join("ui"));
                preserved_roots.extend([
                    self.path_manager.user_config_dir(),
                    self.path_manager.sessions_root(),
                    self.path_manager.works_root(),
                    self.path_manager.runs_root(),
                    self.path_manager.app_data_root(),
                    self.path_manager.services_root(),
                    self.path_manager.workspaces_runtime_root(),
                    self.path_manager.agentic_os_runtime_root(),
                    self.path_manager.user_data_dir(),
                    self.path_manager.apps_dir(),
                ]);
            }
            ResetMode::AppData | ResetMode::Factory => {
                delete_roots.extend([
                    self.path_manager.user_config_dir(),
                    self.path_manager.user_state_dir(),
                    self.path_manager.sessions_root(),
                    self.path_manager.works_root(),
                    self.path_manager.runs_root(),
                    self.path_manager.app_data_root(),
                    self.path_manager.services_root(),
                    self.path_manager.workspaces_runtime_root(),
                    self.path_manager.agentic_os_runtime_root(),
                    self.path_manager.user_data_dir(),
                    self.path_manager.apps_dir(),
                    self.path_manager.system_components_dir(),
                    self.path_manager.cache_root(),
                    self.path_manager.temp_dir(),
                ]);
                if request.include_logs {
                    delete_roots.push(self.path_manager.logs_dir());
                } else {
                    preserved_roots.push(self.path_manager.logs_dir());
                }
                if request.include_secrets || matches!(request.mode, ResetMode::Factory) {
                    delete_roots.push(self.path_manager.secrets_dir());
                } else {
                    preserved_roots.push(self.path_manager.secrets_dir());
                }
                if matches!(request.mode, ResetMode::Factory) {
                    delete_roots.extend([
                        self.path_manager.user_agents_dir(),
                        self.path_manager.user_skills_dir(),
                        self.path_manager.user_skill_suites_dir(),
                        self.path_manager.managed_runtimes_dir(),
                    ]);
                }
                if request.include_browser_profiles || matches!(request.mode, ResetMode::Factory) {
                    delete_roots.push(self.path_manager.browser_profiles_dir());
                }
            }
        }

        for project_dir in &request.include_project_local_sparo_dirs {
            Self::validate_project_local_sparo_dir(project_dir)?;
            delete_roots.push(project_dir.clone());
        }

        Ok(ResetPlan {
            delete_roots: Self::dedupe_paths(delete_roots),
            preserved_roots: Self::dedupe_paths(preserved_roots),
        })
    }

    async fn create_reset_backup(
        &self,
        reset_id: &str,
        mode: ResetMode,
        delete_roots: &[PathBuf],
    ) -> CoreResult<PathBuf> {
        let backup_dir = self.path_manager.reset_backups_dir().join(reset_id);
        fs::create_dir_all(&backup_dir).await.map_err(|error| {
            CoreError::io(format!(
                "Failed to create reset backup directory {}: {}",
                backup_dir.display(),
                error
            ))
        })?;

        let excluded_ephemeral_roots = [
            self.path_manager.cache_root(),
            self.path_manager.temp_dir(),
            self.path_manager.logs_dir(),
        ];
        let mut backed_up_roots = Vec::new();
        for (index, source) in delete_roots.iter().enumerate() {
            if excluded_ephemeral_roots.iter().any(|root| root == source) {
                continue;
            }
            let name = source
                .file_name()
                .and_then(|value| value.to_str())
                .filter(|value| !value.is_empty())
                .unwrap_or("root");
            let target = backup_dir.join("roots").join(format!("{index:03}-{name}"));
            if Self::copy_path_if_exists(source, &target).await? {
                backed_up_roots.push(serde_json::json!({
                    "source": source,
                    "backupPath": target,
                }));
            }
        }

        let manifest = serde_json::json!({
            "resetId": reset_id,
            "mode": mode,
            "createdAt": Utc::now().to_rfc3339(),
            "roots": backed_up_roots,
        });
        fs::write(
            backup_dir.join("reset-backup.json"),
            serde_json::to_vec_pretty(&manifest)?,
        )
        .await
        .map_err(|error| {
            CoreError::io(format!("Failed to write reset backup manifest: {}", error))
        })?;

        Ok(backup_dir)
    }

    async fn write_reset_report(
        &self,
        reset_id: &str,
        mode: ResetMode,
        deleted_roots: &[PathBuf],
        preserved_roots: &[PathBuf],
        backup_dir: Option<&Path>,
    ) -> CoreResult<()> {
        let logs_dir = self.path_manager.logs_dir();
        fs::create_dir_all(&logs_dir).await.map_err(|error| {
            CoreError::io(format!(
                "Failed to create logs directory {}: {}",
                logs_dir.display(),
                error
            ))
        })?;

        let manifest = ResetManifest {
            reset_id: reset_id.to_string(),
            mode,
            created_at: Utc::now().to_rfc3339(),
            deleted_roots: deleted_roots.to_vec(),
            preserved_roots: preserved_roots.to_vec(),
        };
        let report = serde_json::json!({
            "manifest": manifest,
            "backupDir": backup_dir,
        });
        fs::write(
            logs_dir.join(format!("reset-{reset_id}.json")),
            serde_json::to_vec_pretty(&report)?,
        )
        .await
        .map_err(|error| CoreError::io(format!("Failed to write reset report: {}", error)))?;

        Ok(())
    }

    fn validate_project_local_sparo_dir(path: &Path) -> CoreResult<()> {
        if path.file_name().and_then(|name| name.to_str()) != Some(APP_HIDDEN_DIR_NAME) {
            return Err(CoreError::validation(format!(
                "Project-local reset path must end with {}: {}",
                APP_HIDDEN_DIR_NAME,
                path.display()
            )));
        }
        if path.parent().is_none() {
            return Err(CoreError::validation(format!(
                "Project-local reset path has no parent workspace: {}",
                path.display()
            )));
        }
        Ok(())
    }

    fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for path in paths {
            if seen.insert(path.clone()) {
                out.push(path);
            }
        }
        out
    }

    async fn sum_existing_roots_size(paths: &[PathBuf]) -> CoreResult<u64> {
        let mut total = 0;
        for path in paths {
            total += Self::dir_size(path).await?;
        }
        Ok(total)
    }

    fn dir_size(
        path: &Path,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = CoreResult<u64>> + Send + '_>> {
        Box::pin(async move {
            if !path.exists() {
                return Ok(0);
            }
            let metadata = fs::metadata(path).await.map_err(|error| {
                CoreError::io(format!("Failed to stat {}: {}", path.display(), error))
            })?;
            if metadata.is_file() {
                return Ok(metadata.len());
            }

            let mut total = 0;
            let mut entries = fs::read_dir(path).await.map_err(|error| {
                CoreError::io(format!("Failed to read {}: {}", path.display(), error))
            })?;
            while let Some(entry) = entries.next_entry().await.map_err(|error| {
                CoreError::io(format!("Failed to iterate {}: {}", path.display(), error))
            })? {
                total += Self::dir_size(&entry.path()).await?;
            }
            Ok(total)
        })
    }

    async fn remove_root_if_exists(path: &Path) -> CoreResult<()> {
        if !path.exists() {
            return Ok(());
        }
        let metadata = fs::metadata(path).await.map_err(|error| {
            CoreError::io(format!("Failed to stat {}: {}", path.display(), error))
        })?;
        if metadata.is_dir() {
            fs::remove_dir_all(path).await.map_err(|error| {
                CoreError::io(format!("Failed to delete {}: {}", path.display(), error))
            })?;
        } else {
            fs::remove_file(path).await.map_err(|error| {
                CoreError::io(format!("Failed to delete {}: {}", path.display(), error))
            })?;
        }
        Ok(())
    }

    async fn copy_path_if_exists(source: &Path, target: &Path) -> CoreResult<bool> {
        if !source.exists() {
            return Ok(false);
        }
        let source_metadata = fs::metadata(source).await.map_err(|error| {
            CoreError::io(format!(
                "Failed to stat backup source {}: {}",
                source.display(),
                error
            ))
        })?;
        if source_metadata.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).await?;
            }
            fs::copy(source, target).await.map_err(|error| {
                CoreError::io(format!(
                    "Failed to copy reset backup file {} -> {}: {}",
                    source.display(),
                    target.display(),
                    error
                ))
            })?;
            return Ok(true);
        }

        let mut pending = vec![(source.to_path_buf(), target.to_path_buf())];
        while let Some((current_source, current_target)) = pending.pop() {
            fs::create_dir_all(&current_target).await.map_err(|error| {
                CoreError::io(format!(
                    "Failed to create backup directory {}: {}",
                    current_target.display(),
                    error
                ))
            })?;
            let mut entries = fs::read_dir(&current_source).await.map_err(|error| {
                CoreError::io(format!(
                    "Failed to read backup source {}: {}",
                    current_source.display(),
                    error
                ))
            })?;
            while let Some(entry) = entries.next_entry().await.map_err(|error| {
                CoreError::io(format!(
                    "Failed to iterate backup source {}: {}",
                    current_source.display(),
                    error
                ))
            })? {
                let source_path = entry.path();
                let target_path = current_target.join(entry.file_name());
                let file_type = entry.file_type().await.map_err(|error| {
                    CoreError::io(format!(
                        "Failed to stat {}: {}",
                        source_path.display(),
                        error
                    ))
                })?;
                if file_type.is_dir() {
                    pending.push((source_path, target_path));
                } else if let Err(error) = fs::copy(&source_path, &target_path).await {
                    warn!(
                        "Failed to copy reset backup file {} -> {}: {}",
                        source_path.display(),
                        target_path.display(),
                        error
                    );
                }
            }
        }
        Ok(true)
    }
}

struct ResetPlan {
    delete_roots: Vec<PathBuf>,
    preserved_roots: Vec<PathBuf>,
}

#[cfg(test)]
mod tests {
    use super::{
        ResetApplicationDataRequest, ResetApplicationDataService, ResetMode, RESET_CONFIRMATION,
    };
    use crate::infrastructure::PathManager;
    use tempfile::tempdir;

    fn request(mode: ResetMode) -> ResetApplicationDataRequest {
        ResetApplicationDataRequest {
            mode,
            confirmation: RESET_CONFIRMATION.to_string(),
            create_backup: false,
            include_logs: false,
            include_secrets: false,
            include_browser_profiles: false,
            include_project_local_sparo_dirs: Vec::new(),
        }
    }

    #[test]
    fn soft_reset_preserves_all_authoritative_storage_roots() {
        let temp = tempdir().expect("temp dir");
        let paths = PathManager::with_user_root_for_tests(temp.path().join("user"));
        let service = ResetApplicationDataService::new(paths.clone());
        let plan = service
            .build_plan(&request(ResetMode::Soft))
            .expect("soft reset plan");

        for root in [
            paths.sessions_root(),
            paths.works_root(),
            paths.runs_root(),
            paths.app_data_root(),
            paths.services_root(),
        ] {
            assert!(
                plan.preserved_roots.contains(&root),
                "missing preserved root {}",
                root.display()
            );
            assert!(!plan.delete_roots.contains(&root));
        }
    }

    #[test]
    fn app_data_reset_deletes_all_authoritative_storage_roots() {
        let temp = tempdir().expect("temp dir");
        let paths = PathManager::with_user_root_for_tests(temp.path().join("user"));
        let service = ResetApplicationDataService::new(paths.clone());
        let plan = service
            .build_plan(&request(ResetMode::AppData))
            .expect("app-data reset plan");

        for root in [
            paths.sessions_root(),
            paths.works_root(),
            paths.runs_root(),
            paths.app_data_root(),
            paths.services_root(),
            paths.workspaces_runtime_root(),
            paths.agentic_os_runtime_root(),
            paths.apps_dir(),
            paths.system_components_dir(),
        ] {
            assert!(
                plan.delete_roots.contains(&root),
                "missing deleted root {}",
                root.display()
            );
        }
    }
}
