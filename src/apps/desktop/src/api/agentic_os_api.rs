use std::sync::Arc;

use bitfun_core::agentic::coordination::{ConversationCoordinator, DialogScheduler};
use bitfun_core::agentic_os::work::{default_work_store, AgenticWorkRuntimeBridge, WorkService};
use bitfun_core::command::agentic_os as agentic_os_command;
use tauri::State;

fn work_service(
    coordinator: &Arc<ConversationCoordinator>,
    scheduler: &Arc<DialogScheduler>,
) -> Result<WorkService, String> {
    let store = default_work_store().map_err(|error| error.to_string())?;
    let runtime = Arc::new(AgenticWorkRuntimeBridge::new(
        coordinator.clone(),
        scheduler.clone(),
    ));
    Ok(WorkService::with_runtime_bridge(store, runtime))
}

#[tauri::command]
pub async fn agentic_os_list_works(
    request: agentic_os_command::AgenticOsListWorksRequest,
) -> Result<agentic_os_command::AgenticOsListWorksResponse, String> {
    agentic_os_command::list_works(request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_get_work(
    request: agentic_os_command::AgenticOsGetWorkRequest,
) -> Result<agentic_os_command::AgenticOsGetWorkResponse, String> {
    agentic_os_command::get_work(request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_create_work(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: agentic_os_command::AgenticOsCreateWorkRequest,
) -> Result<agentic_os_command::AgenticOsCreateWorkResponse, String> {
    let service = work_service(&coordinator, &scheduler)?;
    agentic_os_command::create_work_with_service(&service, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_start_work(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: agentic_os_command::AgenticOsStartWorkRequest,
) -> Result<agentic_os_command::AgenticOsStartWorkResponse, String> {
    let service = work_service(&coordinator, &scheduler)?;
    agentic_os_command::start_work_with_service(&service, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_update_work(
    request: agentic_os_command::AgenticOsUpdateWorkRequest,
) -> Result<agentic_os_command::AgenticOsUpdateWorkResponse, String> {
    agentic_os_command::update_work(request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_dispatch_work(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: agentic_os_command::AgenticOsDispatchWorkRequest,
) -> Result<agentic_os_command::AgenticOsDispatchWorkResponse, String> {
    let service = work_service(&coordinator, &scheduler)?;
    agentic_os_command::dispatch_work_with_service(&service, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_advance_work(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: agentic_os_command::AgenticOsAdvanceWorkRequest,
) -> Result<agentic_os_command::AgenticOsAdvanceWorkResponse, String> {
    let service = work_service(&coordinator, &scheduler)?;
    agentic_os_command::advance_work_with_service(&service, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_control_work(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: agentic_os_command::AgenticOsControlWorkRequest,
) -> Result<agentic_os_command::AgenticOsControlWorkResponse, String> {
    let service = work_service(&coordinator, &scheduler)?;
    agentic_os_command::control_work_with_service(&service, request)
        .await
        .map_err(|error| error.to_string())
}
