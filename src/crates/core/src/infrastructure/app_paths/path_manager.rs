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

const MAX_PROJECT_SLUG_LEN: usize = 120;
/// Roaming/Local application data directory name (e.g. `%APPDATA%\\sparo_os` on Windows).
pub const APP_CONFIG_DIR_NAME: &str = "sparo_os";
/// Workspace- and home-level hidden directory (e.g. `<workspace>/.sparo_os`, `~/.sparo_os`).
pub const APP_HIDDEN_DIR_NAME: &str = ".sparo_os";

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
    /// User config root directory
    user_root: PathBuf,
    /// Optional override for the Sparo OS home directory, used by tests to avoid
    /// touching the real user home.
    sparo_home_override: Option<PathBuf>,
    /// Cache of runtime slugs keyed by the original and canonical workspace paths.
    project_runtime_slug_cache: Arc<Mutex<HashMap<PathBuf, String>>>,
}

impl PathManager {
    /// Create a new path manager
    pub fn new() -> BitFunResult<Self> {
        let user_root = Self::get_user_config_root()?;

        Ok(Self {
            user_root,
            sparo_home_override: None,
            project_runtime_slug_cache: Arc::new(Mutex::new(HashMap::new())),
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

    /// Get the app home root directory: ~/.sparo_os/
    pub fn sparo_home_dir(&self) -> PathBuf {
        if let Some(path) = &self.sparo_home_override {
            return path.clone();
        }
        dirs::home_dir()
            .unwrap_or_else(|| self.user_root.clone())
            .join(APP_HIDDEN_DIR_NAME)
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

    pub fn user_cron_dir(&self) -> PathBuf {
        self.user_data_dir().join("cron")
    }

    /// Get scheduled jobs persistence file: ~/.config/sparo_os/data/cron/jobs.json
    pub fn cron_jobs_file(&self) -> PathBuf {
        self.user_cron_dir().join("jobs.json")
    }

    /// Live Apps root: `~/.config/sparo_os/data/liveapps/`.
    pub fn live_apps_dir(&self) -> PathBuf {
        self.user_data_dir().join("liveapps")
    }

    /// User Agent Apps root: `~/.config/sparo_os/data/agent_apps/`.
    pub fn user_agent_apps_dir(&self) -> PathBuf {
        self.user_data_dir().join("agent_apps")
    }

    /// Project Agent Apps root: `<workspace>/.sparo_os/agent_apps/`.
    pub fn project_agent_apps_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_root(workspace_path).join("agent_apps")
    }

    /// Per-app data: `~/.config/sparo_os/data/liveapps/{app_id}/`
    pub fn live_app_dir(&self, app_id: &str) -> PathBuf {
        self.live_apps_dir().join(app_id)
    }

    /// Get user-level rules directory: ~/.config/sparo_os/data/rules/
    pub fn user_rules_dir(&self) -> PathBuf {
        self.user_data_dir().join("rules")
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

    /// Get the shared runtime projects root directory: ~/.sparo_os/projects/
    pub fn projects_root(&self) -> PathBuf {
        self.sparo_home_dir().join("projects")
    }

    /// Get the Agentic OS global runtime root: ~/.sparo_os/core/agentic_os/
    pub fn agentic_os_runtime_root(&self) -> PathBuf {
        self.sparo_home_dir().join("core").join("agentic_os")
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

    /// Get the runtime root for a workspace: ~/.sparo_os/projects/<workspace-slug>/
    pub fn project_runtime_root(&self, workspace_path: &Path) -> PathBuf {
        self.projects_root()
            .join(self.project_runtime_slug(workspace_path))
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

    /// Get project snapshots directory: ~/.sparo_os/projects/<workspace-slug>/snapshots/
    pub fn project_snapshots_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_runtime_root(workspace_path).join("snapshots")
    }

    /// Get project sessions directory: ~/.sparo_os/projects/<workspace-slug>/sessions/
    pub fn project_sessions_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_runtime_root(workspace_path).join("sessions")
    }

    /// Get project plans directory: ~/.sparo_os/projects/<workspace-slug>/plans/
    pub fn project_plans_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_runtime_root(workspace_path).join("plans")
    }

    /// Get project memory directory: ~/.sparo_os/projects/<workspace-slug>/memory/
    pub fn project_memory_dir(&self, workspace_path: &Path) -> PathBuf {
        self.project_runtime_root(workspace_path).join("memory")
    }

    /// Get project AI memories file: ~/.sparo_os/projects/<workspace-slug>/ai_memories.json
    pub fn project_ai_memories_file(&self, workspace_path: &Path) -> PathBuf {
        self.project_runtime_root(workspace_path)
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

    fn project_runtime_slug(&self, workspace_path: &Path) -> String {
        let requested_path = workspace_path.to_path_buf();
        if let Some(slug) = self.cached_project_runtime_slug(&requested_path) {
            return slug;
        }

        let canonical_path =
            dunce::canonicalize(workspace_path).unwrap_or_else(|_| requested_path.clone());
        if canonical_path != requested_path {
            if let Some(slug) = self.cached_project_runtime_slug(&canonical_path) {
                self.store_project_runtime_slug(&requested_path, &slug);
                return slug;
            }
        }

        let canonical = canonical_path.to_string_lossy().to_string();
        let slug = Self::build_project_runtime_slug(&canonical);

        self.store_project_runtime_slug(&canonical_path, &slug);
        if canonical_path != requested_path {
            self.store_project_runtime_slug(&requested_path, &slug);
        }

        slug
    }

    fn cached_project_runtime_slug(&self, workspace_path: &Path) -> Option<String> {
        self.project_runtime_slug_cache
            .lock()
            .expect("project runtime slug cache poisoned")
            .get(workspace_path)
            .cloned()
    }

    fn store_project_runtime_slug(&self, workspace_path: &Path, slug: &str) {
        self.project_runtime_slug_cache
            .lock()
            .expect("project runtime slug cache poisoned")
            .insert(workspace_path.to_path_buf(), slug.to_string());
    }

    fn build_project_runtime_slug(canonical: &str) -> String {
        let slug: String = canonical
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() {
                    ch.to_ascii_lowercase()
                } else {
                    '-'
                }
            })
            .collect();

        let slug = slug.trim_matches('-');
        let slug = if slug.is_empty() { "workspace" } else { slug };

        if slug.len() <= MAX_PROJECT_SLUG_LEN {
            return slug.to_string();
        }

        let hash = hex::encode(Sha256::digest(canonical.as_bytes()));
        let suffix = &hash[..12];
        let max_prefix_len = MAX_PROJECT_SLUG_LEN.saturating_sub(suffix.len() + 1);
        let prefix = slug[..max_prefix_len].trim_end_matches('-');
        format!("{}-{}", prefix, suffix)
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
            self.sparo_home_dir(),
            self.projects_root(),
            self.user_config_dir(),
            self.user_agents_dir(),
            self.cache_root(),
            self.user_data_dir(),
            self.user_cron_dir(),
            self.live_apps_dir(),
            self.user_rules_dir(),
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
                    sparo_home_override: None,
                    project_runtime_slug_cache: Arc::new(Mutex::new(HashMap::new())),
                }
            }
        }
    }
}

#[cfg(test)]
impl PathManager {
    pub(crate) fn with_user_root_for_tests(user_root: PathBuf) -> Self {
        let base = user_root
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| user_root.clone());
        Self {
            user_root,
            sparo_home_override: Some(base.join("home").join(APP_HIDDEN_DIR_NAME)),
            project_runtime_slug_cache: Arc::new(Mutex::new(HashMap::new())),
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
    fn project_runtime_root_uses_human_readable_workspace_slug() {
        let pm = PathManager::default();
        let runtime_root =
            pm.project_runtime_root(Path::new(r"E:\Projects\Sparo\Sparo-Agentic-OS"));
        let slug = runtime_root
            .file_name()
            .and_then(|value| value.to_str())
            .expect("runtime root should have terminal component");

        assert!(slug.starts_with("e--projects-sparo-sparo-agentic-os"));
        assert_eq!(runtime_root.parent(), Some(pm.projects_root().as_path()));
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
