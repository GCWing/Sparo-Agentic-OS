//! Unified path management module
//!
//! Provides unified management for all app storage paths, supporting user, project, and temporary levels

use crate::util::errors::*;
use log::{debug, error};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Roaming/Local application data directory name (e.g. `%APPDATA%\\sparo_os` on Windows).
pub const APP_CONFIG_DIR_NAME: &str = "sparo_os";
/// Workspace- and home-level hidden directory (e.g. `<workspace>/.sparo_os`, `~/.sparo_os`).
pub const APP_HIDDEN_DIR_NAME: &str = ".sparo_os";
const LOCAL_WORKSPACE_SCOPE_HOST: &str = "localhost";

/// Storage level
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum StorageLevel {
    /// User: global configuration and data
    User,
    /// Project: configuration for a specific project
    Project,
    /// Session: temporary data for the current session
    Session,
    /// Temporary: cache that can be cleaned
    Temporary,
}

/// Path manager
///
/// Manages all app storage paths consistently across platforms
#[derive(Debug, Clone)]
pub struct PathManager {
    /// User-level application data root directory.
    user_root: PathBuf,
    /// Cache of runtime ids keyed by the original and canonical workspace paths.
    workspace_runtime_id_cache: Arc<Mutex<HashMap<PathBuf, String>>>,
}

impl PathManager {
    /// Create a new path manager
    pub fn new() -> BitFunResult<Self> {
        let user_root = Self::get_user_config_root()?;

        Ok(Self {
            user_root,
            workspace_runtime_id_cache: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// Get user config root directory
    ///
    /// - Windows: %APPDATA%\sparo_os\
    /// - macOS: ~/Library/Application Support/sparo_os/
    /// - Linux: ~/.config/sparo_os/
    fn get_user_config_root() -> BitFunResult<PathBuf> {
        let config_dir = dirs::config_dir()
            .ok_or_else(|| BitFunError::config("Failed to get config directory".to_string()))?;

        Ok(config_dir.join(APP_CONFIG_DIR_NAME))
    }

    /// Get the app root directory.
    pub fn app_root(&self) -> PathBuf {
        self.user_root.clone()
    }

    /// Get user config directory: ~/.config/sparo_os/config/
    pub fn user_config_dir(&self) -> PathBuf {
        self.user_root.join("config")
    }

    /// Get app config file path: ~/.config/sparo_os/config/app.json
    pub fn app_config_file(&self) -> PathBuf {
        self.user_config_dir().join("app.json")
    }

    /// Get user agent directory: ~/.config/sparo_os/agents/
    pub fn user_agents_dir(&self) -> PathBuf {
        self.user_root.join("agents")
    }

    /// Get user skills directory:
    /// - Windows: C:\Users\xxx\AppData\Roaming\sparo_os\skills\
    /// - macOS: ~/Library/Application Support/sparo_os/skills/
    /// - Linux: ~/.local/share/sparo_os/skills/
    pub fn user_skills_dir(&self) -> PathBuf {
        if cfg!(target_os = "windows") {
            dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("C:\\ProgramData"))
                .join(APP_CONFIG_DIR_NAME)
                .join("skills")
        } else if cfg!(target_os = "macos") {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("/tmp"))
                .join("Library")
                .join("Application Support")
                .join(APP_CONFIG_DIR_NAME)
                .join("skills")
        } else {
            dirs::data_local_dir()
                .unwrap_or_else(|| PathBuf::from("/tmp"))
                .join(APP_CONFIG_DIR_NAME)
                .join("skills")
        }
    }

    /// Get cache root directory: ~/.config/sparo_os/cache/
    pub fn cache_root(&self) -> PathBuf {
        self.user_root.join("cache")
    }

    /// Get managed runtimes root directory: ~/.config/sparo_os/runtimes/
    ///
    /// Sparo-managed runtime components (e.g. node/python/office) are stored here.
    pub fn managed_runtimes_dir(&self) -> PathBuf {
        self.user_root.join("runtimes")
    }

    /// Get user data directory: ~/.config/sparo_os/data/
    pub fn user_data_dir(&self) -> PathBuf {
        self.user_root.join("data")
    }

    /// Get user apps directory: <app-root>/apps/
    pub fn apps_dir(&self) -> PathBuf {
        self.user_root.join("apps")
    }

    /// Get managed browser profiles directory: <app-root>/browser/
    pub fn browser_profiles_dir(&self) -> PathBuf {
        self.user_root.join("browser")
    }

    /// Get user state directory: <app-root>/state/
    pub fn user_state_dir(&self) -> PathBuf {
        self.user_root.join("state")
    }

    /// Get secrets directory: <app-root>/secrets/
    pub fn secrets_dir(&self) -> PathBuf {
        self.user_root.join("secrets")
    }

    /// Get backups directory: <app-root>/backups/
    pub fn backups_dir(&self) -> PathBuf {
        self.user_root.join("backups")
    }

    /// Get reset backups directory: <app-root>/backups/reset/
    pub fn reset_backups_dir(&self) -> PathBuf {
        self.backups_dir().join("reset")
    }

    pub fn user_cron_dir(&self) -> PathBuf {
        self.user_state_dir().join("cron")
    }

    /// Get scheduled jobs persistence file: <app-root>/state/cron/jobs.json
    pub fn cron_jobs_file(&self) -> PathBuf {
        self.user_cron_dir().join("jobs.json")
    }

    /// Live Apps root: `<app-root>/apps/liveapps/`.
    pub fn live_apps_dir(&self) -> PathBuf {
        self.apps_dir().join("liveapps")
    }

    /// User Agent Apps root: `<app-root>/apps/agent_apps/`.
    pub fn user_agent_apps_dir(&self) -> PathBuf {
        self.apps_dir().join("agent_apps")
    }

    /// User Bridge Apps root: `<app-root>/apps/bridge_apps/`.
    pub fn user_bridge_apps_dir(&self) -> PathBuf {
        self.apps_dir().join("bridge_apps")
    }

    /// Project Agent Apps root: `<workspace>/.sparo_os/agent_apps/`.
    pub fn project_agent_apps_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("agent_apps")
    }

    /// Project Bridge Apps root: `<workspace>/.sparo_os/bridge_apps/`.
    pub fn project_bridge_apps_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("bridge_apps")
    }

    /// Per-app data: `~/.config/sparo_os/data/liveapps/{app_id}/`
    pub fn live_app_dir(&self, app_id: &str) -> PathBuf {
        self.live_apps_dir().join(app_id)
    }

    /// Get user-level rules directory: <app-root>/state/rules/
    pub fn user_rules_dir(&self) -> PathBuf {
        self.user_state_dir().join("rules")
    }

    /// Get logs directory: ~/.config/sparo_os/logs/
    pub fn logs_dir(&self) -> PathBuf {
        self.user_root.join("logs")
    }

    /// Get temp directory: ~/.config/sparo_os/temp/
    pub fn temp_dir(&self) -> PathBuf {
        self.user_root.join("temp")
    }

    /// Get project config root directory: {project}/.sparo_os/
    pub fn project_root(&self, workspace_path: &Path) -> PathBuf {
        workspace_path.join(APP_HIDDEN_DIR_NAME)
    }

    /// Get the shared workspace runtime root directory: <app-root>/workspaces/
    pub fn workspaces_runtime_root(&self) -> PathBuf {
        self.user_root.join("workspaces")
    }

    /// Get the Agentic OS global runtime root: <app-root>/agentic_os/
    pub fn agentic_os_runtime_root(&self) -> PathBuf {
        self.user_root.join("agentic_os")
    }

    /// Get the Agentic OS global memory directory: ~/.sparo_os/core/agentic_os/memory/
    pub fn agentic_os_memory_dir(&self) -> PathBuf {
        self.agentic_os_runtime_root().join("memory")
    }

    /// Get the Agentic OS workspace overview directory: ~/.sparo_os/core/agentic_os/workspaces_overview/
    pub fn agentic_os_workspaces_overview_dir(&self) -> PathBuf {
        self.agentic_os_runtime_root().join("workspaces_overview")
    }

    /// Get the Agentic OS host runtime directory: ~/.sparo_os/core/agentic_os/host/
    pub fn agentic_os_host_dir(&self) -> PathBuf {
        self.agentic_os_runtime_root().join("host")
    }

    /// Get the Agentic OS host overview file path: ~/.sparo_os/core/agentic_os/host/host_overview.md
    pub fn agentic_os_host_overview_path(&self) -> PathBuf {
        self.agentic_os_host_dir().join("host_overview.md")
    }

    /// Get the Agentic OS host scan state file path: ~/.sparo_os/core/agentic_os/host/state.json
    pub fn agentic_os_host_scan_state_path(&self) -> PathBuf {
        self.agentic_os_host_dir().join("state.json")
    }

    /// Get the Agentic OS global daily reports directory: ~/.sparo_os/core/agentic_os/daily_reports/
    pub fn agentic_os_daily_reports_dir(&self) -> PathBuf {
        self.agentic_os_runtime_root().join("daily_reports")
    }

    /// Get the Agentic OS global daily reports state file path: ~/.sparo_os/core/agentic_os/daily_reports/state.json
    pub fn agentic_os_daily_reports_state_path(&self) -> PathBuf {
        self.agentic_os_daily_reports_dir().join("state.json")
    }

    /// Get the Agentic OS global milestone runtime directory: ~/.sparo_os/core/agentic_os/global_milestone/
    pub fn agentic_os_global_milestone_dir(&self) -> PathBuf {
        self.agentic_os_runtime_root().join("global_milestone")
    }

    /// Get the Agentic OS global milestone state file path: ~/.sparo_os/core/agentic_os/global_milestone/state.json
    pub fn agentic_os_global_milestone_state_path(&self) -> PathBuf {
        self.agentic_os_global_milestone_dir().join("state.json")
    }

    /// Get the runtime root for a workspace: <app-root>/workspaces/<workspace-id>/
    pub fn workspace_runtime_root(&self, workspace_path: &Path) -> PathBuf {
        self.workspaces_runtime_root()
            .join(self.workspace_runtime_id(workspace_path))
    }

    /// Get project internal config directory: {project}/.sparo_os/config/
    pub fn project_internal_config_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("config")
    }

    /// Get project agent skills file: {project}/.sparo_os/config/agent_skills.json
    pub fn project_agent_skills_file(&self, workspace_path: &Path) -> PathBuf {
        self.project_internal_config_dir(workspace_path)
            .join("agent_skills.json")
    }

    /// Get project agent directory: {project}/.sparo_os/agents/
    pub fn project_agents_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("agents")
    }

    /// Get project-level rules directory: {project}/.sparo_os/rules/
    pub fn project_rules_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("rules")
    }

    /// Get workspace snapshots directory: <app-root>/workspaces/<workspace-id>/snapshots/
    pub fn workspace_snapshots_dir(&self, workspace_path: &Path) -> PathBuf {
        self.workspace_runtime_root(workspace_path)
            .join("snapshots")
    }

    /// Get workspace sessions directory: <app-root>/workspaces/<workspace-id>/sessions/
    pub fn workspace_sessions_dir(&self, workspace_path: &Path) -> PathBuf {
        self.workspace_runtime_root(workspace_path).join("sessions")
    }

    /// Get workspace plans directory: <app-root>/workspaces/<workspace-id>/plans/
    pub fn workspace_plans_dir(&self, workspace_path: &Path) -> PathBuf {
        self.workspace_runtime_root(workspace_path).join("plans")
    }

    /// Get workspace memory directory: <app-root>/workspaces/<workspace-id>/memory/
    pub fn workspace_memory_dir(&self, workspace_path: &Path) -> PathBuf {
        self.workspace_runtime_root(workspace_path).join("memory")
    }

    /// Get workspace AI memories file: <app-root>/workspaces/<workspace-id>/ai_memories.json
    pub fn workspace_ai_memories_file(&self, workspace_path: &Path) -> PathBuf {
        self.workspace_runtime_root(workspace_path)
            .join("ai_memories.json")
    }

    /// Get the workspace-local design root directory: {project}/.design/
    pub fn workspace_design_root(&self, workspace_path: &Path) -> PathBuf {
        workspace_path.join(".design")
    }

    /// Get the shared workspace design tokens file: {project}/.design/tokens.json
    pub fn workspace_design_tokens_file(&self, workspace_path: &Path) -> PathBuf {
        self.workspace_design_root(workspace_path)
            .join("tokens.json")
    }

    /// Get the workspace-local design artifact directory: {project}/.design/<artifact_id>/
    pub fn workspace_design_artifact_dir(
        &self,
        workspace_path: &Path,
        artifact_id: &str,
    ) -> PathBuf {
        self.workspace_design_root(workspace_path).join(artifact_id)
    }

    pub fn workspace_runtime_id(&self, workspace_path: &Path) -> String {
        let requested_path = workspace_path.to_path_buf();
        if let Some(id) = self.cached_workspace_runtime_id(&requested_path) {
            return id;
        }

        let canonical_path =
            dunce::canonicalize(workspace_path).unwrap_or_else(|_| requested_path.clone());
        if canonical_path != requested_path {
            if let Some(id) = self.cached_workspace_runtime_id(&canonical_path) {
                self.store_workspace_runtime_id(&requested_path, &id);
                return id;
            }
        }

        let canonical = canonical_path.to_string_lossy().to_string();
        let id = Self::build_workspace_runtime_id(&canonical);

        self.store_workspace_runtime_id(&canonical_path, &id);
        if canonical_path != requested_path {
            self.store_workspace_runtime_id(&requested_path, &id);
        }

        id
    }

    fn cached_workspace_runtime_id(&self, workspace_path: &Path) -> Option<String> {
        self.workspace_runtime_id_cache
            .lock()
            .expect("workspace runtime id cache poisoned")
            .get(workspace_path)
            .cloned()
    }

    fn store_workspace_runtime_id(&self, workspace_path: &Path, id: &str) {
        self.workspace_runtime_id_cache
            .lock()
            .expect("workspace runtime id cache poisoned")
            .insert(workspace_path.to_path_buf(), id.to_string());
    }

    fn build_workspace_runtime_id(canonical: &str) -> String {
        let normalized = canonical.replace('\\', "/");
        let mut hasher = Sha256::new();
        hasher.update(LOCAL_WORKSPACE_SCOPE_HOST.as_bytes());
        hasher.update(b"\n");
        hasher.update(normalized.as_bytes());
        let hash = hex::encode(&hasher.finalize()[..16]);
        format!("local_{hash}")
    }

    /// Ensure directory exists
    pub async fn ensure_dir(&self, path: &Path) -> BitFunResult<()> {
        if !path.exists() {
            tokio::fs::create_dir_all(path).await.map_err(|e| {
                BitFunError::service(format!("Failed to create directory {:?}: {}", path, e))
            })?;
        }
        Ok(())
    }

    /// Initialize user-level directory structure
    pub async fn initialize_user_directories(&self) -> BitFunResult<()> {
        let dirs = vec![
            self.app_root(),
            self.workspaces_runtime_root(),
            self.user_config_dir(),
            self.user_agents_dir(),
            self.cache_root(),
            self.user_data_dir(),
            self.user_state_dir(),
            self.user_cron_dir(),
            self.apps_dir(),
            self.browser_profiles_dir(),
            self.live_apps_dir(),
            self.user_agent_apps_dir(),
            self.user_bridge_apps_dir(),
            self.user_rules_dir(),
            self.secrets_dir(),
            self.backups_dir(),
            self.reset_backups_dir(),
            self.logs_dir(),
            self.temp_dir(),
        ];

        for dir in dirs {
            self.ensure_dir(&dir).await?;
        }

        debug!("User-level directories initialized");
        Ok(())
    }
}

impl Default for PathManager {
    fn default() -> Self {
        match Self::new() {
            Ok(manager) => manager,
            Err(e) => {
                error!(
                    "Failed to create PathManager from system config directory, using temp fallback: {}",
                    e
                );
                Self {
                    user_root: std::env::temp_dir().join(APP_CONFIG_DIR_NAME),
                    workspace_runtime_id_cache: Arc::new(Mutex::new(HashMap::new())),
                }
            }
        }
    }
}

#[cfg(test)]
impl PathManager {
    pub(crate) fn with_user_root_for_tests(user_root: PathBuf) -> Self {
        Self {
            user_root,
            workspace_runtime_id_cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

use std::sync::OnceLock;

/// Global PathManager instance
static GLOBAL_PATH_MANAGER: OnceLock<Arc<PathManager>> = OnceLock::new();

fn init_global_path_manager() -> BitFunResult<Arc<PathManager>> {
    PathManager::new().map(Arc::new)
}

/// Get the global PathManager instance (Arc)
///
/// Return a shared Arc to the global PathManager instance
pub fn get_path_manager_arc() -> Arc<PathManager> {
    GLOBAL_PATH_MANAGER
        .get_or_init(|| match init_global_path_manager() {
            Ok(manager) => manager,
            Err(e) => {
                error!(
                    "Failed to create global PathManager from config directory, using fallback: {}",
                    e
                );
                Arc::new(PathManager::default())
            }
        })
        .clone()
}

/// Try to get the global PathManager instance (Arc)
pub fn try_get_path_manager_arc() -> BitFunResult<Arc<PathManager>> {
    if let Some(manager) = GLOBAL_PATH_MANAGER.get() {
        return Ok(Arc::clone(manager));
    }

    let manager = init_global_path_manager()?;
    match GLOBAL_PATH_MANAGER.set(Arc::clone(&manager)) {
        Ok(()) => Ok(manager),
        Err(_) => Ok(Arc::clone(GLOBAL_PATH_MANAGER.get().expect(
            "GLOBAL_PATH_MANAGER should be initialized after set failure",
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::PathManager;
    use std::path::Path;

    #[test]
    fn workspace_runtime_root_uses_stable_workspace_id() {
        let pm = PathManager::default();
        let runtime_root =
            pm.workspace_runtime_root(Path::new(r"E:\Projects\Sparo\Sparo-Agentic-OS"));
        let id = runtime_root
            .file_name()
            .and_then(|value| value.to_str())
            .expect("runtime root should have terminal component");

        assert!(id.starts_with("local_"));
        assert_eq!(id.len(), 6 + 32);
        assert_eq!(
            runtime_root.parent(),
            Some(pm.workspaces_runtime_root().as_path())
        );
    }

    #[test]
    fn host_overview_path_lives_under_agentic_os_runtime_root() {
        let pm = PathManager::default();

        assert_eq!(
            pm.agentic_os_host_dir(),
            pm.agentic_os_runtime_root().join("host")
        );
        assert_eq!(
            pm.agentic_os_workspaces_overview_dir(),
            pm.agentic_os_runtime_root().join("workspaces_overview")
        );
        assert_eq!(
            pm.agentic_os_host_overview_path(),
            pm.agentic_os_host_dir().join("host_overview.md")
        );
        assert_eq!(
            pm.agentic_os_host_scan_state_path(),
            pm.agentic_os_host_dir().join("state.json")
        );
    }
}
