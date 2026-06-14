//! Stage-D: workspace-scoped services + agentic system + AppState.
//!
//! Runs on the Tauri async runtime *after* the main window is visible. The
//! frontend has already rendered the Splash and is waiting for the
//! `WorkspaceReady` boot stage before mounting `<App />`.

use anyhow::Context;
use bitfun_core::agentic::events::AgenticEventDeliveryClass;
use bitfun_core::agentic::tools::computer_use_capability::set_computer_use_desktop_available;
use bitfun_core::agentic::tools::computer_use_host::ComputerUseHostRef;
use bitfun_core::infrastructure::constants::{
    SUBSCRIBER_KEY_AGENTIC_OS_WORK, SUBSCRIBER_KEY_CRON_JOBS, SUBSCRIBER_KEY_GLOBAL_DAILY_REPORT,
    SUBSCRIBER_KEY_GLOBAL_MILESTONE, SUBSCRIBER_KEY_HOST_AUTO_SCAN, SUBSCRIBER_KEY_TOKEN_USAGE,
    SUBSCRIBER_KEY_TRAY_STATUS, SUBSCRIBER_KEY_WORKSPACE_OVERVIEW_AUTO_REFRESH,
};
use bitfun_core::runtime::{initialize_agentic_runtime, AgenticRuntimeOptions};
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
    let computer_use_host: ComputerUseHostRef = Arc::new(DesktopComputerUseHost::new());
    set_computer_use_desktop_available(true);
    let runtime = initialize_agentic_runtime(AgenticRuntimeOptions {
        computer_use_host: Some(computer_use_host),
        register_agent_apps: true,
        install_process_globals: true,
    })
    .await
    .context("initialize_agentic_runtime")?;

    let coordinator = runtime.coordinator.clone();
    let scheduler = runtime.scheduler.clone();
    let session_manager = runtime.session_manager.clone();
    let event_queue = runtime.event_queue.clone();
    let event_router = runtime.event_router.clone();
    let path_manager = runtime.persistence_manager.path_manager().clone();

    let token_usage_subscriber = Arc::new(
        bitfun_core::service::token_usage::TokenUsageSubscriber::new(
            globals.token_usage_service.clone(),
        ),
    );
    event_router.subscribe_internal(
        SUBSCRIBER_KEY_TOKEN_USAGE.to_string(),
        token_usage_subscriber,
    );

    let work_subscriber = Arc::new(bitfun_core::agentic_os::work::WorkEventSubscriber::new());
    event_router.subscribe_internal(SUBSCRIBER_KEY_AGENTIC_OS_WORK.to_string(), work_subscriber);
    match bitfun_core::agentic_os::work::default_work_store() {
        Ok(store) => {
            let service = bitfun_core::agentic_os::work::WorkService::new(store);
            match service.reconcile_orphaned_executions().await {
                Ok(records) if !records.is_empty() => {
                    log::info!(
                        "Reconciled orphaned work executions during startup: count={}",
                        records.len()
                    );
                }
                Ok(_) => {}
                Err(e) => {
                    log::warn!("Failed to reconcile orphaned work executions: {}", e);
                }
            }
        }
        Err(e) => {
            log::warn!(
                "Failed to initialize work store for orphaned execution reconciliation: {}",
                e
            );
        }
    }

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
    let _ =
        bitfun_core::service::install_global_host_auto_scan_service(host_auto_scan_service.clone());
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
            .map_err(|e| {
                anyhow::anyhow!("Failed to initialize global daily report service: {}", e)
            })?;
    let _ = bitfun_core::service::install_global_global_daily_report_service(
        global_daily_report_service.clone(),
    );
    let global_daily_report_subscriber =
        Arc::new(bitfun_core::service::GlobalDailyReportEventSubscriber::new(
            global_daily_report_service.clone(),
        ));
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
        bitfun_core::service::GlobalMilestoneEventSubscriber::new(global_milestone_service.clone()),
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

    let ppt_cleanup_coordinator = coordinator.clone();
    let ppt_cleanup_scheduler = scheduler.clone();
    let ppt_cleanup_root = path_manager.agentic_os_runtime_root();
    tokio::spawn(async move {
        match crate::api::live_app_api::cancel_stale_ppt_live_private_runs_internal(
            ppt_cleanup_coordinator.as_ref(),
            ppt_cleanup_scheduler.as_ref(),
            ppt_cleanup_root.as_path(),
        )
        .await
        {
            Ok(summary) if summary.cancelled_turns > 0 || summary.cleared_queues > 0 => {
                log::info!(
                    "Cancelled stale PPT Live runs on startup: sessions={}, turns={}, cleared_queues={}",
                    summary.cancelled_sessions,
                    summary.cancelled_turns,
                    summary.cleared_queues
                );
            }
            Ok(_) => {}
            Err(error) => {
                log::warn!("Stale PPT Live cleanup on startup failed: {}", error);
            }
        }
    });

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

async fn dispatch_event(
    event_router: Arc<bitfun_core::agentic::events::EventRouter>,
    transport: Arc<TauriTransportAdapter>,
    envelope: bitfun_core::agentic::events::EventEnvelope,
) {
    if let Err(e) = event_router.route(envelope.clone()).await {
        log::warn!("Internal event routing failed: {:?}", e);
    }
    if let Err(e) = transport.emit_event("", envelope.event).await {
        log::error!("Failed to emit event: {:?}", e);
    }
}

/// Pump events out of the agentic `EventQueue` onto the unified
/// `TauriTransportAdapter`, preserving strict order for timeline events while
/// still allowing control events to run concurrently.
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
                    match envelope.event.delivery_class() {
                        AgenticEventDeliveryClass::OrderedTimeline => {
                            // Timeline events participate in a user-visible
                            // stream and must remain strictly ordered.
                            dispatch_event(event_router.clone(), transport.clone(), envelope).await;
                        }
                        AgenticEventDeliveryClass::PriorityControl => {
                            // Control-path events can run independently so
                            // they do not stall timeline delivery.
                            let event_router = event_router.clone();
                            let transport = transport.clone();
                            tauri::async_runtime::spawn(async move {
                                dispatch_event(event_router, transport, envelope).await;
                            });
                        }
                    }
                }
            }
        }
    });
}
