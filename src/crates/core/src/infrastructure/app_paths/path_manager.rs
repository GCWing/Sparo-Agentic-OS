//! Unified path management module
//!
//! Provides unified management for all app storage paths, supporting user, project, and temporary levels

use crate::error::*;
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
    pub fn new() -> CoreResult<Self> {
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
    fn get_user_config_root() -> CoreResult<PathBuf> {
        let config_dir = dirs::config_dir()
            .ok_or_else(|| CoreError::config("Failed to get config directory".to_string()))?;

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

    /// Get user skill suites directory:
    /// - Windows: C:\Users\xxx\AppData\Roaming\sparo_os\skill-suites\
    /// - macOS: ~/Library/Application Support/sparo_os/skill-suites/
    /// - Linux: ~/.local/share/sparo_os/skill-suites/
    pub fn user_skill_suites_dir(&self) -> PathBuf {
        if cfg!(target_os = "windows") {
            dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("C:\\ProgramData"))
                .join(APP_CONFIG_DIR_NAME)
                .join("skill-suites")
        } else if cfg!(target_os = "macos") {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("/tmp"))
                .join("Library")
                .join("Application Support")
                .join(APP_CONFIG_DIR_NAME)
                .join("skill-suites")
        } else {
            dirs::data_local_dir()
                .unwrap_or_else(|| PathBuf::from("/tmp"))
                .join(APP_CONFIG_DIR_NAME)
                .join("skill-suites")
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

    /// User-level managed model resources shared across workspaces.
    pub fn user_models_dir(&self) -> PathBuf {
        self.user_data_dir().join("models")
    }

    /// User-level speech recognition model resources shared across workspaces.
    pub fn speech_models_dir(&self) -> PathBuf {
        self.user_models_dir().join("speech")
    }

    /// Versioned speech model resource directory.
    pub fn speech_model_dir(&self, model_id: &str, version: &str) -> PathBuf {
        self.speech_models_dir().join(model_id).join(version)
    }

    /// Temporary download workspace for managed speech model resources.
    pub fn speech_model_downloads_dir(&self) -> PathBuf {
        self.cache_root().join("model-downloads").join("speech")
    }

    /// Temporary audio chunks for local voice input sessions.
    pub fn speech_input_temp_dir(&self) -> PathBuf {
        self.temp_dir().join("speech-input")
    }

    /// Get user apps directory: <app-root>/apps/
    pub fn apps_dir(&self) -> PathBuf {
        self.user_root.join("apps")
    }

    /// System Product App packages root: `<app-root>/apps/`.
    pub fn system_product_apps_dir(&self) -> PathBuf {
        self.apps_dir()
    }

    /// System Component packages root: `<app-root>/components/`.
    pub fn system_components_dir(&self) -> PathBuf {
        self.user_root.join("components")
    }

    /// Project Product App packages root: `<workspace>/.sparo_os/apps/`.
    pub fn project_product_apps_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("apps")
    }

    /// Project Component packages root: `<workspace>/.sparo_os/components/`.
    pub fn project_components_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("components")
    }

    /// Versioned system Product App package directory:
    /// `<app-root>/apps/<app-id>/<app-version>/`.
    pub fn system_product_app_version_dir(&self, app_id: &str, app_version: &str) -> PathBuf {
        versioned_package_dir(&self.system_product_apps_dir(), app_id, app_version)
    }

    /// Versioned project Product App package directory:
    /// `<workspace>/.sparo_os/apps/<app-id>/<app-version>/`.
    pub fn project_product_app_version_dir(
        &self,
        workspace_path: &Path,
        app_id: &str,
        app_version: &str,
    ) -> PathBuf {
        versioned_package_dir(
            &self.project_product_apps_dir(workspace_path),
            app_id,
            app_version,
        )
    }

    /// Versioned system Component package directory:
    /// `<app-root>/components/<kind>/<component-id>/<component-version>/`.
    pub fn system_component_version_dir(
        &self,
        kind: &str,
        component_id: &str,
        component_version: &str,
    ) -> PathBuf {
        versioned_component_dir(
            &self.system_components_dir(),
            kind,
            component_id,
            component_version,
        )
    }

    /// Versioned project Component package directory:
    /// `<workspace>/.sparo_os/components/<kind>/<component-id>/<component-version>/`.
    pub fn project_component_version_dir(
        &self,
        workspace_path: &Path,
        kind: &str,
        component_id: &str,
        component_version: &str,
    ) -> PathBuf {
        versioned_component_dir(
            &self.project_components_dir(workspace_path),
            kind,
            component_id,
            component_version,
        )
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

    /// Product App Runtime Host surfaces root: `<app-root>/apps/product_app_runtime_hosts/`.
    pub fn product_app_runtime_hosts_dir(&self) -> PathBuf {
        self.apps_dir().join("product_app_runtime_hosts")
    }

    /// User Agent Components root: `<app-root>/apps/agent_components/`.
    pub fn user_agent_components_dir(&self) -> PathBuf {
        self.apps_dir().join("agent_components")
    }

    /// User Bridge Components root: `<app-root>/apps/bridge_components/`.
    pub fn user_bridge_components_dir(&self) -> PathBuf {
        self.apps_dir().join("bridge_components")
    }

    /// Project Agent Components root: `<workspace>/.sparo_os/agent_components/`.
    pub fn project_agent_components_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("agent_components")
    }

    /// Project Bridge Components root: `<workspace>/.sparo_os/bridge_components/`.
    pub fn project_bridge_components_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("bridge_components")
    }

    /// Per-host-surface data: `<app-root>/apps/product_app_runtime_hosts/{app_id}/`
    pub fn product_app_runtime_host_dir(&self, app_id: &str) -> PathBuf {
        self.product_app_runtime_hosts_dir().join(app_id)
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

    /// Get project skill suites directory: {project}/.sparo_os/skill-suites/
    pub fn project_skill_suites_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("skill-suites")
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

    /// Get the Agentic OS Work runtime data root: <app-root>/agentic_os/work_runtimes/
    pub fn agentic_os_work_runtimes_dir(&self) -> PathBuf {
        self.agentic_os_runtime_root().join("work_runtimes")
    }

    /// Get data dir for a Work-owned Product App runtime instance.
    pub fn agentic_os_work_runtime_dir(&self, work_id: &str, runtime_instance_id: &str) -> PathBuf {
        self.agentic_os_work_runtimes_dir()
            .join(work_id)
            .join(runtime_instance_id)
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
    pub async fn ensure_dir(&self, path: &Path) -> CoreResult<()> {
        if !path.exists() {
            tokio::fs::create_dir_all(path).await.map_err(|e| {
                CoreError::service(format!("Failed to create directory {:?}: {}", path, e))
            })?;
        }
        Ok(())
    }

    /// Initialize user-level directory structure
    pub async fn initialize_user_directories(&self) -> CoreResult<()> {
        let dirs = vec![
            self.app_root(),
            self.workspaces_runtime_root(),
            self.user_config_dir(),
            self.user_agents_dir(),
            self.cache_root(),
            self.user_data_dir(),
            self.user_models_dir(),
            self.speech_models_dir(),
            self.speech_model_downloads_dir(),
            self.user_state_dir(),
            self.user_cron_dir(),
            self.apps_dir(),
            self.system_components_dir(),
            self.browser_profiles_dir(),
            self.product_app_runtime_hosts_dir(),
            self.user_agent_components_dir(),
            self.user_bridge_components_dir(),
            self.user_rules_dir(),
            self.secrets_dir(),
            self.backups_dir(),
            self.reset_backups_dir(),
            self.logs_dir(),
            self.temp_dir(),
            self.speech_input_temp_dir(),
        ];

        for dir in dirs {
            self.ensure_dir(&dir).await?;
        }

        debug!("User-level directories initialized");
        Ok(())
    }
}

fn versioned_package_dir(root: &Path, package_id: &str, package_version: &str) -> PathBuf {
    root.join(package_id).join(package_version)
}

fn versioned_component_dir(
    root: &Path,
    kind: &str,
    component_id: &str,
    component_version: &str,
) -> PathBuf {
    root.join(kind).join(component_id).join(component_version)
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

fn init_global_path_manager() -> CoreResult<Arc<PathManager>> {
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
pub fn try_get_path_manager_arc() -> CoreResult<Arc<PathManager>> {
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

    #[test]
    fn work_runtime_dir_lives_under_agentic_os_runtime_root() {
        let pm = PathManager::default();

        assert_eq!(
            pm.agentic_os_work_runtime_dir("work_1", "runtime_1"),
            pm.agentic_os_runtime_root()
                .join("work_runtimes")
                .join("work_1")
                .join("runtime_1")
        );
    }

    #[test]
    fn product_app_and_component_packages_are_versioned() {
        let pm = PathManager::default();
        let workspace = Path::new(r"E:\Projects\Video");

        assert_eq!(
            pm.system_product_app_version_dir("remotion-live", "1.0.0"),
            pm.system_product_apps_dir()
                .join("remotion-live")
                .join("1.0.0")
        );
        assert_eq!(
            pm.system_component_version_dir("bridges", "sparo-video-engine", "2.1.3"),
            pm.system_components_dir()
                .join("bridges")
                .join("sparo-video-engine")
                .join("2.1.3")
        );
        assert_eq!(
            pm.project_product_app_version_dir(workspace, "remotion-live", "1.0.0"),
            pm.project_product_apps_dir(workspace)
                .join("remotion-live")
                .join("1.0.0")
        );
        assert_eq!(
            pm.project_component_version_dir(workspace, "agents", "remotion-video-agent", "1.0.0"),
            pm.project_components_dir(workspace)
                .join("agents")
                .join("remotion-video-agent")
                .join("1.0.0")
        );
    }
}
