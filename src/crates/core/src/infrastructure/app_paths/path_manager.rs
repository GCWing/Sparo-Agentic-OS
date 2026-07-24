//! Unified path management module
//!
//! Provides unified management for all app storage paths, supporting user, project, and temporary levels

use crate::agentic::core::{SessionDomain, SessionLocator};
use crate::error::*;
use log::{debug, error};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

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
    /// User-level application data root directory.
    user_root: PathBuf,
}

impl PathManager {
    /// Create a new path manager
    pub fn new() -> CoreResult<Self> {
        let user_root = Self::get_user_config_root()?;

        Ok(Self { user_root })
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

    pub fn cron_service_dir(&self) -> PathBuf {
        self.global_services_root().join("cron")
    }

    /// Get scheduled jobs persistence file: <app-root>/services/global/cron/jobs.json
    pub fn cron_jobs_file(&self) -> PathBuf {
        self.cron_service_dir().join("jobs.json")
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

    /// Authoritative root for every persisted conversation.
    pub fn sessions_root(&self) -> PathBuf {
        self.user_root.join("sessions")
    }

    /// Resolve the physical root of one session domain.
    pub fn session_domain_root(&self, domain: &SessionDomain) -> CoreResult<PathBuf> {
        match domain {
            SessionDomain::OsAgent => Ok(self.sessions_root().join("os_agent")),
            SessionDomain::Global => Ok(self.sessions_root().join("global")),
            SessionDomain::Workspace { workspace_id } => {
                validate_storage_segment("workspace_id", workspace_id)?;
                Ok(self.sessions_root().join("workspaces").join(workspace_id))
            }
        }
    }

    /// Resolve the execution root independently from the persistence domain.
    ///
    /// `OsAgent` is global and always executes from the Agentic OS runtime root.
    /// Other domains keep an explicit execution binding; workspace domains also
    /// verify that the binding matches their stable workspace ID.
    pub fn session_execution_root(
        &self,
        domain: &SessionDomain,
        requested_workspace_path: Option<&Path>,
    ) -> CoreResult<PathBuf> {
        if matches!(domain, SessionDomain::OsAgent) {
            return Ok(self.agentic_os_runtime_root());
        }

        let workspace_path = requested_workspace_path
            .filter(|path| !path.as_os_str().is_empty())
            .ok_or_else(|| {
                CoreError::validation("workspace_path is required to create a session")
            })?;

        if let SessionDomain::Workspace { workspace_id } = domain {
            let resolved_workspace_id = self.workspace_id(workspace_path)?;
            if &resolved_workspace_id != workspace_id {
                return Err(CoreError::validation(
                    "domain.workspace_id does not match workspace_path",
                ));
            }
        }

        Ok(workspace_path.to_path_buf())
    }

    /// Resolve a session directory from its typed locator.
    pub fn session_dir(&self, locator: &SessionLocator) -> CoreResult<PathBuf> {
        validate_storage_segment("session_id", &locator.session_id)?;
        Ok(self
            .session_domain_root(&locator.domain)?
            .join(&locator.session_id))
    }

    /// Authoritative root for platform Work records.
    pub fn works_root(&self) -> PathBuf {
        self.user_root.join("works")
    }

    pub fn global_works_dir(&self) -> PathBuf {
        self.works_root().join("global")
    }

    pub fn workspace_works_dir(&self, workspace_id: &str) -> CoreResult<PathBuf> {
        validate_storage_segment("workspace_id", workspace_id)?;
        Ok(self.works_root().join("workspaces").join(workspace_id))
    }

    /// Authoritative root for execution records.
    pub fn runs_root(&self) -> PathBuf {
        self.user_root.join("runs")
    }

    pub fn global_runs_dir(&self) -> PathBuf {
        self.runs_root().join("global")
    }

    pub fn workspace_runs_dir(&self, workspace_id: &str) -> CoreResult<PathBuf> {
        validate_storage_segment("workspace_id", workspace_id)?;
        Ok(self.runs_root().join("workspaces").join(workspace_id))
    }

    /// Authoritative root for private Intelligent App data.
    pub fn app_data_root(&self) -> PathBuf {
        self.user_root.join("app_data")
    }

    pub fn global_app_data_dir(&self, app_id: &str) -> CoreResult<PathBuf> {
        validate_storage_segment("app_id", app_id)?;
        Ok(self.app_data_root().join("global").join(app_id))
    }

    pub fn workspace_app_data_dir(&self, workspace_id: &str, app_id: &str) -> CoreResult<PathBuf> {
        validate_storage_segment("workspace_id", workspace_id)?;
        validate_storage_segment("app_id", app_id)?;
        Ok(self
            .app_data_root()
            .join("workspaces")
            .join(workspace_id)
            .join(app_id))
    }

    /// Authoritative root for platform service state and maintenance jobs.
    pub fn services_root(&self) -> PathBuf {
        self.user_root.join("services")
    }

    pub fn global_services_root(&self) -> PathBuf {
        self.services_root().join("global")
    }

    pub fn workspace_services_root(&self, workspace_id: &str) -> CoreResult<PathBuf> {
        validate_storage_segment("workspace_id", workspace_id)?;
        Ok(self.services_root().join("workspaces").join(workspace_id))
    }

    /// Resolve a global system-service data directory.
    pub fn global_service_dir(&self, service_id: &str) -> CoreResult<PathBuf> {
        validate_storage_segment("service_id", service_id)?;
        Ok(self.global_services_root().join(service_id))
    }

    /// Resolve a workspace-scoped system-service data directory.
    pub fn workspace_service_dir(
        &self,
        workspace_id: &str,
        service_id: &str,
    ) -> CoreResult<PathBuf> {
        validate_storage_segment("service_id", service_id)?;
        Ok(self.workspace_services_root(workspace_id)?.join(service_id))
    }

    /// Get the shared workspace runtime root directory: <app-root>/workspaces/
    pub fn workspaces_runtime_root(&self) -> PathBuf {
        self.user_root.join("workspaces")
    }

    /// Get the Agentic OS global runtime root: <app-root>/agentic_os/
    pub fn agentic_os_runtime_root(&self) -> PathBuf {
        self.user_root.join("agentic_os")
    }

    /// Get the Agentic OS global memory directory: <app-root>/agentic_os/memory/
    pub fn agentic_os_memory_dir(&self) -> PathBuf {
        self.agentic_os_runtime_root().join("memory")
    }

    /// Get the Agentic OS workspace overview directory: <app-root>/agentic_os/workspaces_overview/
    pub fn agentic_os_workspaces_overview_dir(&self) -> PathBuf {
        self.agentic_os_runtime_root().join("workspaces_overview")
    }

    /// Get the Agentic OS host runtime directory: <app-root>/agentic_os/host/
    pub fn agentic_os_host_dir(&self) -> PathBuf {
        self.agentic_os_runtime_root().join("host")
    }

    /// Get the Agentic OS host overview file path: <app-root>/agentic_os/host/host_overview.md
    pub fn agentic_os_host_overview_path(&self) -> PathBuf {
        self.agentic_os_host_dir().join("host_overview.md")
    }

    /// Get the Agentic OS host scan state file path: <app-root>/agentic_os/host/state.json
    pub fn agentic_os_host_scan_state_path(&self) -> PathBuf {
        self.agentic_os_host_dir().join("state.json")
    }

    /// Get the runtime root for a workspace: <app-root>/workspaces/<workspace-id>/
    pub fn workspace_runtime_root(&self, workspace_path: &Path) -> CoreResult<PathBuf> {
        let workspace_id = self.workspace_id(workspace_path)?;
        self.workspace_runtime_root_for_id(&workspace_id)
    }

    /// Resolve a workspace runtime root when a validated stable identity is already available.
    pub fn workspace_runtime_root_for_id(&self, workspace_id: &str) -> CoreResult<PathBuf> {
        validate_storage_segment("workspace_id", workspace_id)?;
        if !workspace_id.starts_with("ws_") {
            return Err(CoreError::validation(
                "workspace_id must start with 'ws_'".to_string(),
            ));
        }
        Ok(self.workspaces_runtime_root().join(workspace_id))
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
    pub fn workspace_snapshots_dir(&self, workspace_path: &Path) -> CoreResult<PathBuf> {
        Ok(self
            .workspace_runtime_root(workspace_path)?
            .join("snapshots"))
    }

    /// Get workspace plans directory: <app-root>/workspaces/<workspace-id>/plans/
    pub fn workspace_plans_dir(&self, workspace_path: &Path) -> CoreResult<PathBuf> {
        Ok(self.workspace_runtime_root(workspace_path)?.join("plans"))
    }

    /// Get workspace memory directory: <app-root>/workspaces/<workspace-id>/memory/
    pub fn workspace_memory_dir(&self, workspace_path: &Path) -> CoreResult<PathBuf> {
        Ok(self.workspace_runtime_root(workspace_path)?.join("memory"))
    }

    /// Get workspace AI memories file: <app-root>/workspaces/<workspace-id>/ai_memories.json
    pub fn workspace_ai_memories_file(&self, workspace_path: &Path) -> CoreResult<PathBuf> {
        Ok(self
            .workspace_runtime_root(workspace_path)?
            .join("ai_memories.json"))
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

    /// Ensure directory exists
    pub async fn ensure_dir(&self, path: &Path) -> CoreResult<()> {
        if let Err(error) = tokio::fs::create_dir_all(path).await {
            if matches!(tokio::fs::metadata(path).await, Ok(metadata) if metadata.is_dir()) {
                return Ok(());
            }

            return Err(CoreError::service(format!(
                "Failed to create directory {:?}: {}",
                path, error
            )));
        }

        Ok(())
    }

    /// Read the stable user-facing Workspace ID from the project marker.
    ///
    /// Session, Work, Run and App Data routing must use this ID. Missing or
    /// invalid markers are errors; storage code must not derive an identity
    /// from the editable absolute path.
    pub fn workspace_id(&self, workspace_path: &Path) -> CoreResult<String> {
        let marker_path = self.project_root(workspace_path).join("workspace.json");
        let content = std::fs::read_to_string(&marker_path).map_err(|error| {
            CoreError::io(format!(
                "Failed to read workspace identity '{}': {}",
                marker_path.display(),
                error
            ))
        })?;
        let value: serde_json::Value = serde_json::from_str(&content)?;
        let schema_version = value
            .get("schemaVersion")
            .and_then(serde_json::Value::as_u64);
        let workspace_id = value
            .get("workspaceId")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                CoreError::validation(format!(
                    "Workspace identity is missing workspaceId: {}",
                    marker_path.display()
                ))
            })?;
        if schema_version != Some(1) {
            return Err(CoreError::validation(format!(
                "Unsupported workspace identity schema: {}",
                marker_path.display()
            )));
        }
        validate_storage_segment("workspace_id", workspace_id)?;
        if !workspace_id.starts_with("ws_") {
            return Err(CoreError::validation(format!(
                "Workspace identity must start with 'ws_': {}",
                marker_path.display()
            )));
        }
        Ok(workspace_id.to_string())
    }

    /// Initialize user-level directory structure
    pub async fn initialize_user_directories(&self) -> CoreResult<()> {
        let dirs = vec![
            self.app_root(),
            self.sessions_root(),
            self.sessions_root().join("os_agent"),
            self.sessions_root().join("global"),
            self.sessions_root().join("workspaces"),
            self.works_root(),
            self.global_works_dir(),
            self.works_root().join("workspaces"),
            self.runs_root(),
            self.global_runs_dir(),
            self.runs_root().join("workspaces"),
            self.app_data_root(),
            self.app_data_root().join("global"),
            self.app_data_root().join("workspaces"),
            self.services_root(),
            self.global_services_root(),
            self.services_root().join("workspaces"),
            self.workspaces_runtime_root(),
            self.user_config_dir(),
            self.user_agents_dir(),
            self.cache_root(),
            self.user_data_dir(),
            self.user_models_dir(),
            self.speech_models_dir(),
            self.speech_model_downloads_dir(),
            self.user_state_dir(),
            self.cron_service_dir(),
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
                }
            }
        }
    }
}

#[cfg(test)]
impl PathManager {
    pub(crate) fn with_user_root_for_tests(user_root: PathBuf) -> Self {
        Self { user_root }
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
    use crate::agentic::core::SessionDomain;
    use std::fs;
    use std::path::Path;
    use std::sync::Arc;
    use tempfile::tempdir;
    use tokio::sync::Barrier;

    #[test]
    fn stable_workspace_identity_routes_all_user_data_without_path_hashing() {
        let temp = tempdir().expect("temp dir");
        let workspace = temp.path().join("workspace");
        fs::create_dir_all(workspace.join(".sparo_os")).expect("workspace marker dir");
        fs::write(
            workspace.join(".sparo_os").join("workspace.json"),
            r#"{"schemaVersion":1,"workspaceId":"ws_contract"}"#,
        )
        .expect("workspace marker");
        let pm = PathManager::with_user_root_for_tests(temp.path().join("user"));

        assert_eq!(
            pm.workspace_runtime_root(&workspace)
                .expect("stable runtime root"),
            pm.workspaces_runtime_root().join("ws_contract")
        );
        assert_eq!(
            pm.session_domain_root(&SessionDomain::Workspace {
                workspace_id: "ws_contract".to_string(),
            })
            .expect("workspace session root"),
            pm.sessions_root().join("workspaces").join("ws_contract")
        );
        assert_eq!(
            pm.workspace_works_dir("ws_contract")
                .expect("workspace Work root"),
            pm.works_root().join("workspaces").join("ws_contract")
        );
        assert_eq!(
            pm.workspace_runs_dir("ws_contract")
                .expect("workspace Run root"),
            pm.runs_root().join("workspaces").join("ws_contract")
        );
        assert_eq!(
            pm.workspace_service_dir("ws_contract", "daily_letter")
                .expect("workspace service root"),
            pm.services_root()
                .join("workspaces")
                .join("ws_contract")
                .join("daily_letter")
        );
        assert_eq!(
            pm.global_service_dir("global_daily_report")
                .expect("global service root"),
            pm.services_root()
                .join("global")
                .join("global_daily_report")
        );
    }

    #[test]
    fn os_agent_and_global_sessions_have_disjoint_roots() {
        let pm = PathManager::default();
        let os_agent = pm
            .session_domain_root(&SessionDomain::OsAgent)
            .expect("OSAgent root");
        let global = pm
            .session_domain_root(&SessionDomain::Global)
            .expect("Global root");

        assert_eq!(os_agent, pm.sessions_root().join("os_agent"));
        assert_eq!(global, pm.sessions_root().join("global"));
        assert_ne!(os_agent, global);
    }

    #[test]
    fn os_agent_execution_is_global_and_does_not_require_a_workspace() {
        let temp = tempdir().expect("temp dir");
        let pm = PathManager::with_user_root_for_tests(temp.path().join("user"));

        assert_eq!(
            pm.session_execution_root(&SessionDomain::OsAgent, None)
                .expect("global execution root"),
            pm.agentic_os_runtime_root()
        );
        assert_eq!(
            pm.session_execution_root(
                &SessionDomain::OsAgent,
                Some(Path::new("D:/workspace/project")),
            )
            .expect("OS Agent ignores project bindings"),
            pm.agentic_os_runtime_root()
        );
    }

    #[test]
    fn workspace_execution_requires_a_matching_stable_workspace() {
        let temp = tempdir().expect("temp dir");
        let workspace = temp.path().join("workspace");
        fs::create_dir_all(workspace.join(".sparo_os")).expect("workspace marker dir");
        fs::write(
            workspace.join(".sparo_os").join("workspace.json"),
            r#"{"schemaVersion":1,"workspaceId":"ws_contract"}"#,
        )
        .expect("workspace marker");
        let pm = PathManager::with_user_root_for_tests(temp.path().join("user"));

        let domain = SessionDomain::Workspace {
            workspace_id: "ws_contract".to_string(),
        };
        assert!(pm.session_execution_root(&domain, None).is_err());
        assert_eq!(
            pm.session_execution_root(&domain, Some(&workspace))
                .expect("matching workspace"),
            workspace
        );

        let mismatched_domain = SessionDomain::Workspace {
            workspace_id: "different_workspace".to_string(),
        };
        assert!(pm
            .session_execution_root(&mismatched_domain, Some(&workspace))
            .is_err());
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

    #[tokio::test]
    async fn ensure_dir_allows_concurrent_creation() {
        const TASK_COUNT: usize = 16;

        let temp_dir = tempdir().expect("temporary directory should be created");
        let manager = Arc::new(PathManager::with_user_root_for_tests(
            temp_dir.path().to_path_buf(),
        ));
        let target = temp_dir.path().join("shared").join("nested");
        let barrier = Arc::new(Barrier::new(TASK_COUNT));
        let mut tasks = Vec::with_capacity(TASK_COUNT);

        for _ in 0..TASK_COUNT {
            let manager = Arc::clone(&manager);
            let target = target.clone();
            let barrier = Arc::clone(&barrier);
            tasks.push(tokio::spawn(async move {
                barrier.wait().await;
                manager.ensure_dir(&target).await
            }));
        }

        for task in tasks {
            task.await
                .expect("directory creation task should complete")
                .expect("concurrent directory creation should succeed");
        }
        assert!(target.is_dir());
    }

    #[tokio::test]
    async fn ensure_dir_rejects_file_at_target_path() {
        let temp_dir = tempdir().expect("temporary directory should be created");
        let manager = PathManager::with_user_root_for_tests(temp_dir.path().to_path_buf());
        let target = temp_dir.path().join("not-a-directory");
        tokio::fs::write(&target, b"file")
            .await
            .expect("target file should be created");

        let error = manager
            .ensure_dir(&target)
            .await
            .expect_err("file conflict should fail directory creation");

        assert!(target.is_file());
        assert!(error.to_string().contains("Failed to create directory"));
    }
}

fn validate_storage_segment(field: &str, value: &str) -> CoreResult<()> {
    let value = value.trim();
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\')
    {
        return Err(CoreError::validation(format!(
            "{field} must be a non-empty storage identifier"
        )));
    }
    Ok(())
}
