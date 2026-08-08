//! Application state management

use sparo_core::agentic::side_question::SideQuestionRuntime;
use sparo_core::agentic::{agents, tools};
use sparo_core::app_platform::{
    seed_system_app_releases, AppRevisionStore, SystemAppSeedIssue, SystemAppSeedResult,
};
use sparo_core::error::*;
use sparo_core::infrastructure::ai::{AIClient, AIClientFactory};
use sparo_core::product_app_runtime_host::{
    initialize_global_product_app_runtime_host_manager, ProductAppRuntimeHostManager,
    ProductAppRuntimeHostWorkerPool,
};
use sparo_core::service::{announcement, config, filesystem, mcp, speech, token_usage, workspace};

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    pub status: String,
    pub message: String,
    pub services: HashMap<String, bool>,
    pub system_apps: SystemAppSyncStatus,
    pub uptime_seconds: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SystemAppSyncPhase {
    Pending,
    Syncing,
    Ready,
    Degraded,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemAppSyncStatus {
    pub phase: SystemAppSyncPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<SystemAppSeedResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Default for SystemAppSyncStatus {
    fn default() -> Self {
        Self {
            phase: SystemAppSyncPhase::Pending,
            result: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppStatistics {
    pub sessions_created: u64,
    pub messages_processed: u64,
    pub tools_executed: u64,
    pub uptime_seconds: u64,
}

#[derive(Clone)]
pub struct AppState {
    pub ai_client: Arc<RwLock<Option<AIClient>>>,
    pub ai_client_factory: Arc<AIClientFactory>,
    pub side_question_runtime: Arc<SideQuestionRuntime>,
    pub tool_registry: Arc<Vec<Arc<dyn tools::framework::Tool>>>,
    pub workspace_service: Arc<workspace::WorkspaceService>,
    pub workspace_path: Arc<RwLock<Option<std::path::PathBuf>>>,
    pub config_service: Arc<config::ConfigService>,
    pub filesystem_service: Arc<filesystem::FileSystemService>,
    pub agent_registry: Arc<agents::AgentRegistry>,
    pub mcp_service: Option<Arc<mcp::MCPService>>,
    pub speech_service: Arc<speech::SpeechService>,
    pub token_usage_service: Arc<token_usage::TokenUsageService>,
    pub product_app_runtime_host_manager: Arc<ProductAppRuntimeHostManager>,
    pub app_revision_store: Arc<AppRevisionStore>,
    pub system_app_sync_status: Arc<RwLock<SystemAppSyncStatus>>,
    pub js_worker_pool: Option<Arc<ProductAppRuntimeHostWorkerPool>>,
    pub statistics: Arc<RwLock<AppStatistics>>,
    pub macos_edit_menu_mode: Arc<RwLock<crate::macos_menubar::EditMenuMode>>,
    pub start_time: std::time::Instant,
    pub active_searches: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub announcement_scheduler: Arc<announcement::AnnouncementScheduler>,
}

impl AppState {
    pub async fn new_async(
        token_usage_service: Arc<token_usage::TokenUsageService>,
    ) -> CoreResult<Self> {
        let start_time = std::time::Instant::now();

        let config_service = config::get_global_config_service().await.map_err(|e| {
            CoreError::config(format!("Failed to get global config service: {}", e))
        })?;

        let ai_client = Arc::new(RwLock::new(None));
        let ai_client_factory = AIClientFactory::get_global().await.map_err(|e| {
            CoreError::service(format!("Failed to get global AIClientFactory: {}", e))
        })?;
        let side_question_runtime = Arc::new(SideQuestionRuntime::new());

        let tool_registry = {
            let registry = tools::registry::get_global_tool_registry();
            let lock = registry.read().await;
            Arc::new(lock.get_all_tools())
        };

        let workspace_service = Arc::new(workspace::WorkspaceService::new().await?);
        workspace::set_global_workspace_service(workspace_service.clone());
        let filesystem_service = Arc::new(filesystem::FileSystemServiceFactory::create_default());

        let agent_registry = agents::get_agent_registry();

        let mcp_service = match mcp::MCPService::new(config_service.clone()) {
            Ok(service) => {
                log::info!("MCP service initialized successfully");
                let service = Arc::new(service);
                mcp::set_global_mcp_service(service.clone());
                Some(service)
            }
            Err(e) => {
                log::warn!("Failed to initialize MCP service: {}", e);
                None
            }
        };
        let path_manager = workspace_service.path_manager().clone();
        let app_revision_store = Arc::new(
            AppRevisionStore::open(path_manager.app_root())
                .await
                .map_err(|error| {
                    CoreError::service(format!(
                        "Failed to initialize Intelligent App revision store: {error}"
                    ))
                })?,
        );
        let system_app_sync_status = Arc::new(RwLock::new(SystemAppSyncStatus::default()));
        let speech_service = Arc::new(speech::SpeechService::new(path_manager.as_ref().clone()));

        let announcement_scheduler = Arc::new(
            announcement::AnnouncementScheduler::new(&path_manager)
                .await
                .map_err(|e| {
                    CoreError::service(format!(
                        "Failed to initialize announcement scheduler: {}",
                        e
                    ))
                })?,
        );

        let product_app_runtime_host_manager =
            Arc::new(ProductAppRuntimeHostManager::new(path_manager.clone()));
        initialize_global_product_app_runtime_host_manager(
            product_app_runtime_host_manager.clone(),
        );
        let worker_host_path = match resolve_worker_host_path() {
            Some(p) => {
                log::info!("Resolved worker_host.js at: {}", p.display());
                p
            }
            None => {
                log::warn!(
                    "worker_host.js not found in any candidate location; \
                     Product App Runtime host workers will not start"
                );
                std::path::PathBuf::from("worker_host.js")
            }
        };
        let js_worker_pool = ProductAppRuntimeHostWorkerPool::new(path_manager, worker_host_path)
            .ok()
            .map(Arc::new);
        if js_worker_pool.is_none() {
            log::warn!("JsWorkerPool not initialized (missing worker_host.js or no Bun/Node)");
        }

        let statistics = Arc::new(RwLock::new(AppStatistics {
            sessions_created: 0,
            messages_processed: 0,
            tools_executed: 0,
            uptime_seconds: 0,
        }));

        let initial_workspace = workspace_service.get_last_used_workspace().await;
        let initial_workspace_path = initial_workspace
            .as_ref()
            .map(|workspace| workspace.root_path.clone());

        if let Some(workspace_path) = initial_workspace_path.clone() {
            if let Err(e) =
                sparo_core::service::snapshot::initialize_snapshot_manager_for_workspace(
                    workspace_path.clone(),
                    None,
                )
                .await
            {
                log::warn!(
                    "Failed to restore snapshot system on startup: path={}, error={}",
                    workspace_path.display(),
                    e
                );
            }
        }

        let app_state = Self {
            ai_client,
            ai_client_factory,
            side_question_runtime,
            tool_registry,
            workspace_service,
            workspace_path: Arc::new(RwLock::new(initial_workspace_path)),
            config_service,
            filesystem_service,
            agent_registry,
            mcp_service,
            speech_service,
            token_usage_service,
            product_app_runtime_host_manager,
            app_revision_store,
            system_app_sync_status,
            js_worker_pool,
            statistics,
            macos_edit_menu_mode: Arc::new(RwLock::new(crate::macos_menubar::EditMenuMode::System)),
            start_time,
            active_searches: Arc::new(Mutex::new(HashMap::new())),
            announcement_scheduler,
        };

        match crate::api::product_app_runtime_api::cleanup_draft_runtime_previews(&app_state).await
        {
            Ok(0) => {}
            Ok(count) => log::info!(
                "Removed stale Intelligent App Draft previews: count={}",
                count
            ),
            Err(error) => log::warn!("Failed to remove stale Draft previews: {}", error),
        }

        log::info!("AppState initialized successfully");
        Ok(app_state)
    }

    /// Starts non-blocking reconciliation for System-owned Product Apps.
    /// Package and runtime-host failures are reported through health state and
    /// never participate in the desktop boot success decision.
    pub fn start_system_app_sync(self: &Arc<Self>) {
        let state = self.clone();
        tauri::async_runtime::spawn(async move {
            {
                let mut status = state.system_app_sync_status.write().await;
                if status.phase != SystemAppSyncPhase::Pending {
                    return;
                }
                status.phase = SystemAppSyncPhase::Syncing;
                status.result = None;
                status.error = None;
            }

            let path_manager = state.workspace_service.path_manager().clone();
            match seed_system_app_releases(&path_manager, &state.app_revision_store).await {
                Ok(mut result) => {
                    if let Err(error) = crate::api::product_app_runtime_api::cleanup_orphan_product_app_runtime_hosts(&state).await {
                        log::warn!(
                            "Failed to remove orphaned Intelligent App runtime hosts after system App synchronization: error={}",
                            error
                        );
                        result.issues.push(SystemAppSeedIssue {
                            source: "runtime-host-cleanup".to_string(),
                            app_id: None,
                            version: None,
                            message: error,
                        });
                    }
                    for issue in &result.issues {
                        log::warn!(
                            "System Intelligent App synchronization issue: source={}, app_id={}, version={}, error={}",
                            issue.source,
                            issue.app_id.as_deref().unwrap_or("unknown"),
                            issue.version.as_deref().unwrap_or("unknown"),
                            issue.message
                        );
                    }
                    log::info!(
                        "Synchronized system Intelligent Apps: components_added={}, components_reused={}, apps_retired={}, releases_added={}, releases_reused={}, releases_replaced={}, activations_created={}, activations_preserved={}, issues={}",
                        result.components_added,
                        result.components_reused,
                        result.apps_retired,
                        result.releases_added,
                        result.releases_reused,
                        result.releases_replaced,
                        result.activations_created,
                        result.activations_preserved,
                        result.issues.len(),
                    );
                    let phase = if result.is_degraded() {
                        SystemAppSyncPhase::Degraded
                    } else {
                        SystemAppSyncPhase::Ready
                    };
                    *state.system_app_sync_status.write().await = SystemAppSyncStatus {
                        phase,
                        result: Some(result),
                        error: None,
                    };
                }
                Err(error) => {
                    log::warn!(
                        "System Intelligent App synchronization is unavailable; desktop startup continues: error={}",
                        error
                    );
                    *state.system_app_sync_status.write().await = SystemAppSyncStatus {
                        phase: SystemAppSyncPhase::Failed,
                        result: None,
                        error: Some(error.to_string()),
                    };
                }
            }
        });
    }

    pub async fn get_health_status(&self) -> HealthStatus {
        let mut services = HashMap::new();
        services.insert(
            "ai_client".to_string(),
            self.ai_client.read().await.is_some(),
        );
        services.insert("workspace_service".to_string(), true);
        services.insert("config_service".to_string(), true);
        services.insert("filesystem_service".to_string(), true);
        let system_apps = self.system_app_sync_status.read().await.clone();
        services.insert(
            "system_apps".to_string(),
            system_apps.phase == SystemAppSyncPhase::Ready,
        );

        let all_healthy = services.values().all(|&status| status);

        HealthStatus {
            status: if all_healthy {
                "healthy".to_string()
            } else {
                "degraded".to_string()
            },
            message: if all_healthy {
                "All services are running normally".to_string()
            } else {
                "Some services are unavailable".to_string()
            },
            services,
            system_apps,
            uptime_seconds: self.start_time.elapsed().as_secs(),
        }
    }

    pub async fn get_statistics(&self) -> AppStatistics {
        let mut stats = self.statistics.read().await.clone();
        stats.uptime_seconds = self.start_time.elapsed().as_secs();
        stats
    }

    pub fn get_tool_names(&self) -> Vec<String> {
        self.tool_registry
            .iter()
            .map(|tool| tool.name().to_string())
            .collect()
    }
}

/// Try every layout we know about for `worker_host.js`, dev or bundled:
///   1. `CARGO_MANIFEST_DIR/resources/worker_host.js` — `cargo run` / `tauri dev`.
///   2. `<exe_dir>/resources/worker_host.js` — generic side-by-side bundle.
///   3. `<exe_dir>/../Resources/resources/worker_host.js` — macOS `.app` (Tauri
///      copies bundle.resources into `Contents/Resources/`).
///   4. `<exe_dir>/../Resources/worker_host.js` — flat macOS layout fallback.
///   5. `<exe_dir>/../lib/<bin>/resources/worker_host.js` — typical Linux deb/AppImage.
///   6. `<exe_dir>/../share/<bin>/resources/worker_host.js` — alt Linux layout.
fn resolve_worker_host_path() -> Option<std::path::PathBuf> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    candidates.push(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("worker_host.js"),
    );

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join("resources").join("worker_host.js"));
            if let Some(parent) = exe_dir.parent() {
                candidates.push(
                    parent
                        .join("Resources")
                        .join("resources")
                        .join("worker_host.js"),
                );
                candidates.push(parent.join("Resources").join("worker_host.js"));
                if let Some(bin_name) = exe.file_name().and_then(|s| s.to_str()) {
                    candidates.push(
                        parent
                            .join("lib")
                            .join(bin_name)
                            .join("resources")
                            .join("worker_host.js"),
                    );
                    candidates.push(
                        parent
                            .join("share")
                            .join(bin_name)
                            .join("resources")
                            .join("worker_host.js"),
                    );
                }
            }
        }
    }

    candidates.into_iter().find(|p| p.exists())
}
