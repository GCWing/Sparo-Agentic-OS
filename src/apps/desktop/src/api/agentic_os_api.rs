use std::sync::Arc;

use bitfun_core::agentic::coordination::{ConversationCoordinator, DialogScheduler};
use bitfun_core::agentic_os::work::{
    default_work_store, AgenticWorkRuntimeBridge, WorkExecutionGraph, WorkId, WorkService,
};
use bitfun_core::command::agentic_os as agentic_os_command;
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgenticOsGetWorkExecutionGraphRequest {
    pub work_id: WorkId,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgenticOsGetWorkExecutionGraphResponse {
    pub graph: WorkExecutionGraph,
}

#[tauri::command]
pub async fn agentic_os_get_work_execution_graph(
    request: AgenticOsGetWorkExecutionGraphRequest,
) -> Result<AgenticOsGetWorkExecutionGraphResponse, String> {
    let service = WorkService::new(default_work_store().map_err(|error| error.to_string())?);
    let graph = service
        .execution_graph(&request.work_id)
        .await
        .map_err(|error| error.to_string())?;
    Ok(AgenticOsGetWorkExecutionGraphResponse { graph })
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
pub async fn agentic_os_resolve_app_work(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: agentic_os_command::AgenticOsResolveAppWorkRequest,
) -> Result<agentic_os_command::AgenticOsResolveAppWorkResponse, String> {
    let service = work_service(&coordinator, &scheduler)?;
    agentic_os_command::resolve_app_work_with_service(&service, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_resolve_component_work(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: agentic_os_command::AgenticOsResolveComponentWorkRequest,
) -> Result<agentic_os_command::AgenticOsResolveComponentWorkResponse, String> {
    let service = work_service(&coordinator, &scheduler)?;
    agentic_os_command::resolve_component_work_with_service(&service, request)
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
pub async fn agentic_os_link_session_to_work(
    request: agentic_os_command::AgenticOsLinkSessionToWorkRequest,
) -> Result<agentic_os_command::AgenticOsLinkSessionToWorkResponse, String> {
    agentic_os_command::link_session_to_work(request)
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

#[tauri::command]
pub async fn agentic_os_record_studio_preview_result(
    request: agentic_os_command::AgenticOsRecordStudioPreviewResultRequest,
) -> Result<agentic_os_command::AgenticOsRecordStudioPreviewResultResponse, String> {
    agentic_os_command::record_studio_preview_result(request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_record_studio_validation_result(
    request: agentic_os_command::AgenticOsRecordStudioValidationResultRequest,
) -> Result<agentic_os_command::AgenticOsRecordStudioValidationResultResponse, String> {
    agentic_os_command::record_studio_validation_result(request)
        .await
        .map_err(|error| error.to_string())
}
