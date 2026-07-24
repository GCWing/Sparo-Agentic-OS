use serde::{Deserialize, Serialize};

use crate::agentic_os::work::{
    default_work_store, AdvanceWorkRequest, ControlWorkRequest, CreateWorkRequest,
    DispatchWorkRequest, LinkSessionToWorkRequest, ResolveAppWorkRequest,
    ResolveComponentWorkRequest, StartWorkRequest, UpdateWorkRequest, WorkAppRef,
    WorkBuilderPreviewResult, WorkBuilderValidationResult, WorkCleanupReport, WorkDeleteOptions,
    WorkId, WorkLocator, WorkRecord, WorkService,
};

use super::super::{CommandError, CommandResult};

#[derive(Debug, Clone, Deserialize, Default)]
pub struct AgenticOsListWorksRequest {
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub app: Option<WorkAppRef>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsListWorksResponse {
    pub works: Vec<WorkRecord>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgenticOsGetWorkRequest {
    pub locator: WorkLocator,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsGetWorkResponse {
    pub work: WorkRecord,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgenticOsDeleteWorkRequest {
    pub locator: WorkLocator,
    #[serde(default)]
    pub options: WorkDeleteOptions,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsDeleteWorkResponse {
    pub deleted: bool,
    pub cleanup_report: WorkCleanupReport,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgenticOsCreateWorkRequest {
    #[serde(flatten)]
    pub work: CreateWorkRequest,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsCreateWorkResponse {
    pub work: WorkRecord,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgenticOsStartWorkRequest {
    #[serde(flatten)]
    pub start: StartWorkRequest,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsStartWorkResponse {
    pub work: WorkRecord,
    pub execution_binding_id: String,
    pub turn_id: String,
    pub started: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgenticOsUpdateWorkRequest {
    pub locator: WorkLocator,
    #[serde(flatten)]
    pub update: UpdateWorkRequest,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsUpdateWorkResponse {
    pub work: WorkRecord,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgenticOsResolveAppWorkRequest {
    #[serde(flatten)]
    pub app_work: ResolveAppWorkRequest,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsResolveAppWorkResponse {
    pub work: WorkRecord,
    pub created: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgenticOsResolveComponentWorkRequest {
    #[serde(flatten)]
    pub component_work: ResolveComponentWorkRequest,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsResolveComponentWorkResponse {
    pub work: WorkRecord,
    pub created: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgenticOsLinkSessionToWorkRequest {
    #[serde(flatten)]
    pub link: LinkSessionToWorkRequest,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsLinkSessionToWorkResponse {
    pub work: WorkRecord,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgenticOsDispatchWorkRequest {
    #[serde(flatten)]
    pub dispatch: DispatchWorkRequest,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsDispatchWorkResponse {
    pub work: WorkRecord,
    pub parent_work_id: WorkId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_binding_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgenticOsAdvanceWorkRequest {
    #[serde(flatten)]
    pub advance: AdvanceWorkRequest,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsAdvanceWorkResponse {
    pub work: WorkRecord,
    pub execution_binding_id: String,
    pub turn_id: String,
    pub started: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgenticOsControlWorkRequest {
    #[serde(flatten)]
    pub control: ControlWorkRequest,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsControlWorkResponse {
    pub work: WorkRecord,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgenticOsRecordBuilderPreviewResultRequest {
    pub locator: WorkLocator,
    pub preview_result: WorkBuilderPreviewResult,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsRecordBuilderPreviewResultResponse {
    pub work: WorkRecord,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgenticOsRecordBuilderValidationResultRequest {
    pub locator: WorkLocator,
    pub validation_result: WorkBuilderValidationResult,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsRecordBuilderValidationResultResponse {
    pub work: WorkRecord,
}

pub async fn list_works(
    request: AgenticOsListWorksRequest,
) -> CommandResult<AgenticOsListWorksResponse> {
    let service = WorkService::new(default_work_store().map_err(CommandError::session)?);
    list_works_with_service(&service, request).await
}

pub async fn list_works_with_service(
    service: &WorkService,
    request: AgenticOsListWorksRequest,
) -> CommandResult<AgenticOsListWorksResponse> {
    let processes = crate::agentic_os::background_process::list_background_processes()
        .await
        .map_err(CommandError::session)?;
    service
        .ensure_system_works_from_processes(&processes.processes)
        .await
        .map_err(CommandError::session)?;

    let mut works = service.list().await.map_err(CommandError::session)?;
    if let Some(workspace_path) = request
        .workspace_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        works.retain(|work| work.workspace_path.as_deref() == Some(workspace_path));
    }
    if let Some(app) = request.app.as_ref() {
        works.retain(|work| work.references_app(app));
    }
    Ok(AgenticOsListWorksResponse { works })
}

pub async fn get_work(request: AgenticOsGetWorkRequest) -> CommandResult<AgenticOsGetWorkResponse> {
    let service = WorkService::new(default_work_store().map_err(CommandError::session)?);
    let work = service
        .get(&request.locator)
        .await
        .map_err(CommandError::session)?;
    Ok(AgenticOsGetWorkResponse { work })
}

pub async fn delete_work(
    request: AgenticOsDeleteWorkRequest,
) -> CommandResult<AgenticOsDeleteWorkResponse> {
    let service = WorkService::new(default_work_store().map_err(CommandError::session)?);
    delete_work_with_service(&service, request).await
}

pub async fn delete_work_with_service(
    service: &WorkService,
    request: AgenticOsDeleteWorkRequest,
) -> CommandResult<AgenticOsDeleteWorkResponse> {
    let response = service
        .delete_with_options(&request.locator, request.options)
        .await
        .map_err(CommandError::session)?;
    Ok(AgenticOsDeleteWorkResponse {
        deleted: response.deleted,
        cleanup_report: response.cleanup_report,
    })
}

pub async fn create_work(
    request: AgenticOsCreateWorkRequest,
) -> CommandResult<AgenticOsCreateWorkResponse> {
    let service = WorkService::new(default_work_store().map_err(CommandError::session)?);
    create_work_with_service(&service, request).await
}

pub async fn create_work_with_service(
    service: &WorkService,
    request: AgenticOsCreateWorkRequest,
) -> CommandResult<AgenticOsCreateWorkResponse> {
    let work = service
        .create(request.work)
        .await
        .map_err(CommandError::session)?;
    Ok(AgenticOsCreateWorkResponse { work })
}

pub async fn resolve_app_work(
    request: AgenticOsResolveAppWorkRequest,
) -> CommandResult<AgenticOsResolveAppWorkResponse> {
    let service = WorkService::new(default_work_store().map_err(CommandError::session)?);
    resolve_app_work_with_service(&service, request).await
}

pub async fn resolve_app_work_with_service(
    service: &WorkService,
    request: AgenticOsResolveAppWorkRequest,
) -> CommandResult<AgenticOsResolveAppWorkResponse> {
    let response = service
        .resolve_app_work(request.app_work)
        .await
        .map_err(CommandError::session)?;
    Ok(AgenticOsResolveAppWorkResponse {
        work: response.work,
        created: response.created,
    })
}

pub async fn resolve_component_work(
    request: AgenticOsResolveComponentWorkRequest,
) -> CommandResult<AgenticOsResolveComponentWorkResponse> {
    let service = WorkService::new(default_work_store().map_err(CommandError::session)?);
    resolve_component_work_with_service(&service, request).await
}

pub async fn resolve_component_work_with_service(
    service: &WorkService,
    request: AgenticOsResolveComponentWorkRequest,
) -> CommandResult<AgenticOsResolveComponentWorkResponse> {
    let response = service
        .resolve_component_work(request.component_work)
        .await
        .map_err(CommandError::session)?;
    Ok(AgenticOsResolveComponentWorkResponse {
        work: response.work,
        created: response.created,
    })
}

pub async fn start_work(
    request: AgenticOsStartWorkRequest,
) -> CommandResult<AgenticOsStartWorkResponse> {
    let service = WorkService::new(default_work_store().map_err(CommandError::session)?);
    start_work_with_service(&service, request).await
}

pub async fn start_work_with_service(
    service: &WorkService,
    request: AgenticOsStartWorkRequest,
) -> CommandResult<AgenticOsStartWorkResponse> {
    let response = service
        .start(request.start)
        .await
        .map_err(CommandError::session)?;
    Ok(AgenticOsStartWorkResponse {
        work: response.work,
        execution_binding_id: response.execution_binding_id,
        turn_id: response.turn_id,
        started: response.started,
    })
}

pub async fn update_work(
    request: AgenticOsUpdateWorkRequest,
) -> CommandResult<AgenticOsUpdateWorkResponse> {
    let service = WorkService::new(default_work_store().map_err(CommandError::session)?);
    update_work_with_service(&service, request).await
}

pub async fn update_work_with_service(
    service: &WorkService,
    request: AgenticOsUpdateWorkRequest,
) -> CommandResult<AgenticOsUpdateWorkResponse> {
    let work = service
        .update(&request.locator, request.update)
        .await
        .map_err(CommandError::session)?;
    Ok(AgenticOsUpdateWorkResponse { work })
}

pub async fn link_session_to_work(
    request: AgenticOsLinkSessionToWorkRequest,
) -> CommandResult<AgenticOsLinkSessionToWorkResponse> {
    let service = WorkService::new(default_work_store().map_err(CommandError::session)?);
    link_session_to_work_with_service(&service, request).await
}

pub async fn link_session_to_work_with_service(
    service: &WorkService,
    request: AgenticOsLinkSessionToWorkRequest,
) -> CommandResult<AgenticOsLinkSessionToWorkResponse> {
    let work = service
        .link_session_to_work(request.link)
        .await
        .map_err(CommandError::session)?;
    Ok(AgenticOsLinkSessionToWorkResponse { work })
}

pub async fn dispatch_work(
    request: AgenticOsDispatchWorkRequest,
) -> CommandResult<AgenticOsDispatchWorkResponse> {
    let service = WorkService::new(default_work_store().map_err(CommandError::session)?);
    dispatch_work_with_service(&service, request).await
}

pub async fn dispatch_work_with_service(
    service: &WorkService,
    request: AgenticOsDispatchWorkRequest,
) -> CommandResult<AgenticOsDispatchWorkResponse> {
    let response = service
        .dispatch(request.dispatch)
        .await
        .map_err(CommandError::session)?;
    Ok(AgenticOsDispatchWorkResponse {
        work: response.work,
        parent_work_id: response.parent_work_id,
        execution_binding_id: response.execution_binding_id,
    })
}

pub async fn advance_work(
    request: AgenticOsAdvanceWorkRequest,
) -> CommandResult<AgenticOsAdvanceWorkResponse> {
    let service = WorkService::new(default_work_store().map_err(CommandError::session)?);
    advance_work_with_service(&service, request).await
}

pub async fn advance_work_with_service(
    service: &WorkService,
    request: AgenticOsAdvanceWorkRequest,
) -> CommandResult<AgenticOsAdvanceWorkResponse> {
    let response = service
        .advance(request.advance)
        .await
        .map_err(CommandError::session)?;
    Ok(AgenticOsAdvanceWorkResponse {
        work: response.work,
        execution_binding_id: response.execution_binding_id,
        turn_id: response.turn_id,
        started: response.started,
    })
}

pub async fn control_work(
    request: AgenticOsControlWorkRequest,
) -> CommandResult<AgenticOsControlWorkResponse> {
    let service = WorkService::new(default_work_store().map_err(CommandError::session)?);
    control_work_with_service(&service, request).await
}

pub async fn control_work_with_service(
    service: &WorkService,
    request: AgenticOsControlWorkRequest,
) -> CommandResult<AgenticOsControlWorkResponse> {
    let response = service
        .control(request.control)
        .await
        .map_err(CommandError::session)?;
    Ok(AgenticOsControlWorkResponse {
        work: response.work,
    })
}

pub async fn record_builder_preview_result(
    request: AgenticOsRecordBuilderPreviewResultRequest,
) -> CommandResult<AgenticOsRecordBuilderPreviewResultResponse> {
    let service = WorkService::new(default_work_store().map_err(CommandError::session)?);
    record_builder_preview_result_with_service(&service, request).await
}

pub async fn record_builder_preview_result_with_service(
    service: &WorkService,
    request: AgenticOsRecordBuilderPreviewResultRequest,
) -> CommandResult<AgenticOsRecordBuilderPreviewResultResponse> {
    let work = service
        .record_builder_preview_result(&request.locator, request.preview_result)
        .await
        .map_err(CommandError::session)?;
    Ok(AgenticOsRecordBuilderPreviewResultResponse { work })
}

pub async fn record_builder_validation_result(
    request: AgenticOsRecordBuilderValidationResultRequest,
) -> CommandResult<AgenticOsRecordBuilderValidationResultResponse> {
    let service = WorkService::new(default_work_store().map_err(CommandError::session)?);
    record_builder_validation_result_with_service(&service, request).await
}

pub async fn record_builder_validation_result_with_service(
    service: &WorkService,
    request: AgenticOsRecordBuilderValidationResultRequest,
) -> CommandResult<AgenticOsRecordBuilderValidationResultResponse> {
    let work = service
        .record_builder_validation_result(&request.locator, request.validation_result)
        .await
        .map_err(CommandError::session)?;
    Ok(AgenticOsRecordBuilderValidationResultResponse { work })
}
