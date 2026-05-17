//! Stage-D: workspace-scoped services + agentic system + AppState.
//!
//! Runs on the Tauri async runtime *after* the main window is visible. The
//! frontend has already rendered the Splash and is waiting for the
//! `WorkspaceReady` boot stage before mounting `<App />`.

use anyhow::Context;
use bitfun_core::agentic::tools::computer_use_capability::set_computer_use_desktop_available;
use bitfun_core::agentic::tools::computer_use_host::ComputerUseHostRef;
use bitfun_core::infrastructure::constants::{
    SUBSCRIBER_KEY_CRON_JOBS, SUBSCRIBER_KEY_GLOBAL_DAILY_REPORT,
    SUBSCRIBER_KEY_GLOBAL_MILESTONE, SUBSCRIBER_KEY_HOST_AUTO_SCAN,
    SUBSCRIBER_KEY_TOKEN_USAGE, SUBSCRIBER_KEY_TRAY_STATUS,
    SUBSCRIBER_KEY_WORKSPACE_OVERVIEW_AUTO_REFRESH,
};
use std::sync::Arc;
use tauri::AppHandle;

use super::container::AppContainer;
use super::globals::GlobalServices;
use crate::api::app_state::AppState;
use crate::computer_use::DesktopComputerUseHost;
use crate::tray::event_subscriber::TrayStatusSubscriber;
use bitfun_transport::{TauriTransportAdapter, TransportAdapter};

pub struct AgenticHandles {
    pub coordinator: Arc<bitfun_core::agentic::coordination::ConversationCoordinator>,
    pub scheduler: Arc<bitfun_core::agentic::coordination::DialogScheduler>,
    pub event_queue: Arc<bitfun_core::agentic::events::EventQueue>,
    pub event_router: Arc<bitfun_core::agentic::events::EventRouter>,
}

/// Initialize agentic coordinator + scheduler + workspace-adjacent services.
/// Side-effects: registers `set_global_*` so the rest of the core can find them
/// — these globals are an internal core concern that the desktop shell merely
/// triggers; replacing them is out of scope for this orchestrator.
pub async fn initialize_agentic(
    app_handle: &AppHandle,
    container: &Arc<AppContainer>,
    globals: &GlobalServices,
) -> anyhow::Result<AgenticHandles> {
    use bitfun_core::agentic::*;

    let event_queue = Arc::new(events::EventQueue::new(Default::default()));
    let event_router = Arc::new(events::EventRouter::new());

    let path_manager = bitfun_core::infrastructure::try_get_path_manager_arc()
        .context("try_get_path_manager_arc in agentic init")?;
    let persistence_manager =
        Arc::new(persistence::PersistenceManager::new(path_manager.clone())?);

    let context_store = Arc::new(session::SessionContextStore::new());
    let context_compressor = Arc::new(session::ContextCompressor::new(Default::default()));

    let session_manager = Arc::new(session::SessionManager::new(
        context_store,
        persistence_manager,
        Default::default(),
    ));

    let tool_registry = tools::registry::get_global_tool_registry();
    if let Err(e) = bitfun_core::agent_app::AgentAppManager::register_all(None) {
        log::warn!("Failed to register user Agent Apps at startup: {}", e);
    }
    if let Err(e) = bitfun_core::agent_app::AgentAppManager::register_runtime_tools(None).await {
        log::warn!(
            "Failed to register user Agent App runtime tools at startup: {}",
            e
        );
    }
    let tool_state_manager =
        Arc::new(tools::pipeline::ToolStateManager::new(event_queue.clone()));

    let computer_use_host: ComputerUseHostRef = Arc::new(DesktopComputerUseHost::new());
    set_computer_use_desktop_available(true);

    let tool_pipeline = Arc::new(tools::pipeline::ToolPipeline::new(
        tool_registry,
        tool_state_manager,
        Some(computer_use_host),
    ));

    let stream_processor = Arc::new(execution::StreamProcessor::new(event_queue.clone()));
    let round_executor = Arc::new(execution::RoundExecutor::new(
        stream_processor,
        event_queue.clone(),
        tool_pipeline.clone(),
    ));
    let execution_engine = Arc::new(execution::ExecutionEngine::new(
        round_executor,
        event_queue.clone(),
        session_manager.clone(),
        context_compressor,
        Default::default(),
    ));

    let coordinator = Arc::new(coordination::ConversationCoordinator::new(
        session_manager.clone(),
        execution_engine,
        tool_pipeline,
        event_queue.clone(),
        event_router.clone(),
    ));

    // Wire up the weak self-reference for internal `tokio::spawn` paths.
    coordinator.install_self_arc();
    // Inject runtime back-references into SessionManager so its background
    // reconciliation paths can emit model-migration events without a global.
    session_manager.install_coordinator(Arc::downgrade(&coordinator));
    // Install as the process-wide coordinator (single instance — owns the
    // shared EventQueue/Router and multi-workspace-aware SessionManager).
    let _ = coordination::install_global_coordinator(coordinator.clone());

    let token_usage_subscriber =
        Arc::new(bitfun_core::service::token_usage::TokenUsageSubscriber::new(
            globals.token_usage_service.clone(),
        ));
    event_router.subscribe_internal(SUBSCRIBER_KEY_TOKEN_USAGE.to_string(), token_usage_subscriber);

    let scheduler =
        coordination::DialogScheduler::new(coordinator.clone(), session_manager.clone());
    coordinator.set_scheduler_notifier(scheduler.outcome_sender());
    coordinator.set_round_preempt_source(scheduler.preempt_monitor());
    let _ = coordination::install_global_scheduler(scheduler.clone());

    let cron_service =
        bitfun_core::service::cron::CronService::new(path_manager.clone(), scheduler.clone())
            .await
            .map_err(|e| anyhow::anyhow!("Failed to initialize cron service: {}", e))?;
    let _ = bitfun_core::service::cron::install_global_cron_service(cron_service.clone());
    // SessionManager needs the cron service to clean up jobs when a
    // session is deleted; inject as Weak.
    session_manager.install_cron_service(Arc::downgrade(&cron_service));
    let cron_subscriber = Arc::new(bitfun_core::service::cron::CronEventSubscriber::new(
        cron_service.clone(),
    ));
    event_router.subscribe_internal(SUBSCRIBER_KEY_CRON_JOBS.to_string(), cron_subscriber);
    cron_service.start();

    let host_auto_scan_service =
        bitfun_core::service::HostAutoScanService::new(coordinator.clone())
            .await
            .map_err(|e| anyhow::anyhow!("Failed to initialize host auto scan service: {}", e))?;
    let _ = bitfun_core::service::install_global_host_auto_scan_service(
        host_auto_scan_service.clone(),
    );
    let host_auto_scan_subscriber = Arc::new(
        bitfun_core::service::HostAutoScanEventSubscriber::new(host_auto_scan_service.clone()),
    );
    event_router.subscribe_internal(
        SUBSCRIBER_KEY_HOST_AUTO_SCAN.to_string(),
        host_auto_scan_subscriber,
    );
    host_auto_scan_service.start();

    let workspace_overview_auto_refresh_service =
        bitfun_core::service::WorkspaceOverviewAutoRefreshService::new(coordinator.clone())
            .await
            .map_err(|e| {
                anyhow::anyhow!(
                    "Failed to initialize workspace overview auto refresh service: {}",
                    e
                )
            })?;
    let _ = bitfun_core::service::set_global_workspace_overview_auto_refresh_service(
        workspace_overview_auto_refresh_service.clone(),
    );
    let workspace_overview_auto_refresh_subscriber = Arc::new(
        bitfun_core::service::WorkspaceOverviewAutoRefreshEventSubscriber::new(
            workspace_overview_auto_refresh_service.clone(),
        ),
    );
    event_router.subscribe_internal(
        SUBSCRIBER_KEY_WORKSPACE_OVERVIEW_AUTO_REFRESH.to_string(),
        workspace_overview_auto_refresh_subscriber,
    );
    workspace_overview_auto_refresh_service.start();

    let memory_consolidation_service =
        bitfun_core::agentic::memory::MemoryConsolidationService::new()
            .await
            .map_err(|e| {
                anyhow::anyhow!("Failed to initialize memory consolidation service: {}", e)
            })?;
    let _ = bitfun_core::agentic::memory::set_global_memory_consolidation_service(
        memory_consolidation_service.clone(),
    );
    memory_consolidation_service.start();

    let global_daily_report_service =
        bitfun_core::service::GlobalDailyReportService::new(coordinator.clone())
            .await
            .map_err(|e| anyhow::anyhow!("Failed to initialize global daily report service: {}", e))?;
    let _ = bitfun_core::service::install_global_global_daily_report_service(
        global_daily_report_service.clone(),
    );
    let global_daily_report_subscriber = Arc::new(
        bitfun_core::service::GlobalDailyReportEventSubscriber::new(
            global_daily_report_service.clone(),
        ),
    );
    event_router.subscribe_internal(
        SUBSCRIBER_KEY_GLOBAL_DAILY_REPORT.to_string(),
        global_daily_report_subscriber,
    );
    global_daily_report_service.start();

    let global_milestone_service =
        bitfun_core::service::GlobalMilestoneService::new(coordinator.clone())
            .await
            .map_err(|e| anyhow::anyhow!("Failed to initialize global milestone service: {}", e))?;
    let _ = bitfun_core::service::install_global_global_milestone_service(
        global_milestone_service.clone(),
    );
    let global_milestone_subscriber = Arc::new(
        bitfun_core::service::GlobalMilestoneEventSubscriber::new(
            global_milestone_service.clone(),
        ),
    );
    event_router.subscribe_internal(
        SUBSCRIBER_KEY_GLOBAL_MILESTONE.to_string(),
        global_milestone_subscriber,
    );
    global_milestone_service.start();

    // Tray status subscriber lives in desktop crate; the channel is shared with
    // every other subscriber via the same EventRouter.
    let tray_subscriber = Arc::new(TrayStatusSubscriber::new(app_handle.clone()));
    event_router.subscribe_internal(SUBSCRIBER_KEY_TRAY_STATUS.to_string(), tray_subscriber);

    // Wire the runtime back-references on the coordinator so its tool-call
    // ExecutionContexts carry `workspace_mount` + `agentic` handles for
    // every per-workspace dispatch. The workspace registry slot stays
    // empty until at least one workspace is mounted; AppContainer is
    // responsible for keeping the registry alive.
    coordinator.install_runtime_handles(
        Arc::downgrade(&container.workspace_registry()),
        Arc::downgrade(&scheduler),
        Arc::downgrade(&cron_service),
        Arc::downgrade(&host_auto_scan_service),
    );
    // The same registry needs a back-reference on SessionManager for its
    // snapshot cleanup path.
    session_manager.install_workspace_registry(Arc::downgrade(&container.workspace_registry()));

    log::info!("Workspace overview auto refresh service initialized and started");
    log::info!("Memory consolidation service initialized and started");
    log::info!("Global daily report service initialized and started");
    log::info!("Global milestone service initialized and started");
    log::info!("Stage-D agentic services ready");
    Ok(AgenticHandles {
        coordinator,
        scheduler,
        event_queue,
        event_router,
    })
}

/// Construct workspace-bound `AppState` and publish it into the container so
/// every existing `#[tauri::command]` that uses `State<'_, AppState>` becomes
/// callable.
pub async fn initialize_app_state(
    container: &Arc<AppContainer>,
    globals: GlobalServices,
) -> anyhow::Result<Arc<AppState>> {
    let app_state = AppState::new_async(globals.token_usage_service)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to initialize AppState: {}", e))?;
    let app_state = Arc::new(app_state);
    container.set_app_state(app_state.clone());
    log::info!("Stage-D AppState ready");
    Ok(app_state)
}

/// Pump events out of the agentic `EventQueue` onto the unified
/// `TauriTransportAdapter`. One spawn, fire-and-forget per envelope so a slow
/// emit cannot stall the whole batch.
pub fn spawn_event_loop(
    event_queue: Arc<bitfun_core::agentic::events::EventQueue>,
    event_router: Arc<bitfun_core::agentic::events::EventRouter>,
    transport: Arc<TauriTransportAdapter>,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            event_queue.wait_for_events().await;
            loop {
                let batch = event_queue.dequeue_configured_batch().await;
                if batch.is_empty() {
                    break;
                }
                for envelope in batch {
                    let router = event_router.clone();
                    let transport = transport.clone();
                    // Each envelope is dispatched independently so a hung
                    // subscriber or slow webview cannot stall the queue.
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = router.route(envelope.clone()).await {
                            log::warn!("Internal event routing failed: {:?}", e);
                        }
                        if let Err(e) = transport.emit_event("", envelope.event).await {
                            log::error!("Failed to emit event: {:?}", e);
                        }
                    });
                }
            }
        }
    });
}
