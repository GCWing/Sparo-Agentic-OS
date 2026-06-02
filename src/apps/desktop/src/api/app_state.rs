//! Application state management

use bitfun_core::agentic::side_question::SideQuestionRuntime;
use bitfun_core::agentic::{agents, tools};
use bitfun_core::infrastructure::ai::{AIClient, AIClientFactory};
use bitfun_core::live_app::{
    initialize_global_live_app_manager, seed_builtin_live_apps, JsWorkerPool, LiveAppManager,
};
use bitfun_core::service::{announcement, config, filesystem, mcp, token_usage, workspace};
use bitfun_core::util::errors::*;

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
    pub uptime_seconds: u64,
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
    pub token_usage_service: Arc<token_usage::TokenUsageService>,
    pub live_app_manager: Arc<LiveAppManager>,
    pub js_worker_pool: Option<Arc<JsWorkerPool>>,
    pub statistics: Arc<RwLock<AppStatistics>>,
    pub macos_edit_menu_mode: Arc<RwLock<crate::macos_menubar::EditMenuMode>>,
    pub start_time: std::time::Instant,
    pub active_searches: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub announcement_scheduler: Arc<announcement::AnnouncementScheduler>,
}

impl AppState {
    pub async fn new_async(
        token_usage_service: Arc<token_usage::TokenUsageService>,
    ) -> BitFunResult<Self> {
        let start_time = std::time::Instant::now();

        let config_service = config::get_global_config_service().await.map_err(|e| {
            BitFunError::config(format!("Failed to get global config service: {}", e))
        })?;

        let ai_client = Arc::new(RwLock::new(None));
        let ai_client_factory = AIClientFactory::get_global().await.map_err(|e| {
            BitFunError::service(format!("Failed to get global AIClientFactory: {}", e))
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

        let announcement_scheduler = Arc::new(
            announcement::AnnouncementScheduler::new(&path_manager)
                .await
                .map_err(|e| {
                    BitFunError::service(format!(
                        "Failed to initialize announcement scheduler: {}",
                        e
                    ))
                })?,
        );

        let live_app_manager = Arc::new(LiveAppManager::new(path_manager.clone()));
        initialize_global_live_app_manager(live_app_manager.clone());
        let seed_manager = live_app_manager.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = seed_builtin_live_apps(&seed_manager).await {
                log::warn!("Failed to seed built-in live apps: {}", e);
            }
        });

        let worker_host_path = match resolve_worker_host_path() {
            Some(p) => {
                log::info!("Resolved worker_host.js at: {}", p.display());
                p
            }
            None => {
                log::warn!(
                    "worker_host.js not found in any candidate location; \
                     Live App workers will not start"
                );
                std::path::PathBuf::from("worker_host.js")
            }
        };
        let js_worker_pool = JsWorkerPool::new(path_manager, worker_host_path)
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
                bitfun_core::service::snapshot::initialize_snapshot_manager_for_workspace(
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
            token_usage_service,
            live_app_manager,
            js_worker_pool,
            statistics,
            macos_edit_menu_mode: Arc::new(RwLock::new(crate::macos_menubar::EditMenuMode::System)),
            start_time,
            active_searches: Arc::new(Mutex::new(HashMap::new())),
            announcement_scheduler,
        };

        log::info!("AppState initialized successfully");
        Ok(app_state)
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
