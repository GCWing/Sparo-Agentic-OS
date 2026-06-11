use serde::{Deserialize, Serialize};

use crate::agentic_os::work::{
    default_work_store, AdvanceWorkRequest, ControlWorkRequest, CreateWorkRequest,
    DispatchWorkRequest, StartWorkRequest, UpdateWorkRequest, WorkId, WorkRecord, WorkService,
};

use super::super::{CommandError, CommandResult};

#[derive(Debug, Clone, Deserialize, Default)]
pub struct AgenticOsListWorksRequest {
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsListWorksResponse {
    pub works: Vec<WorkRecord>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgenticOsGetWorkRequest {
    pub work_id: WorkId,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsGetWorkResponse {
    pub work: WorkRecord,
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
    pub work_id: WorkId,
    #[serde(flatten)]
    pub update: UpdateWorkRequest,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsUpdateWorkResponse {
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
    let mut works = service.list().await.map_err(CommandError::session)?;
    if let Some(workspace_path) = request
        .workspace_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        works.retain(|work| work.scope.workspace_path() == Some(workspace_path));
    }
    Ok(AgenticOsListWorksResponse { works })
}

pub async fn get_work(request: AgenticOsGetWorkRequest) -> CommandResult<AgenticOsGetWorkResponse> {
    let service = WorkService::new(default_work_store().map_err(CommandError::session)?);
    let work = service
        .get(&request.work_id)
        .await
        .map_err(CommandError::session)?;
    Ok(AgenticOsGetWorkResponse { work })
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
        .update(&request.work_id, request.update)
        .await
        .map_err(CommandError::session)?;
    Ok(AgenticOsUpdateWorkResponse { work })
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
