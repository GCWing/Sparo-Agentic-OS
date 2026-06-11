use serde::Deserialize;
use serde_json::{json, Value};

use crate::agentic_os::work::{
    AdvanceWorkRequest, ControlWorkAction, ControlWorkRequest, PrimarySurfacePolicy,
    StartWorkRequest, WorkAssignmentKind, WorkAssignmentRef, WorkId, WorkKind, WorkProjection,
    WorkRecord, WorkScope, WorkService, WorkStatus, WorkVisibility,
};
use crate::util::errors::{BitFunError, BitFunResult};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkAction {
    Start,
    Continue,
    Status,
    Control,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkExecutorKind {
    Agent,
}

#[derive(Debug, Deserialize)]
pub struct WorkExecutorInput {
    #[serde(default)]
    pub kind: Option<WorkExecutorKind>,
    #[serde(default)]
    pub agent_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WorkInput {
    pub action: WorkAction,
    #[serde(default)]
    pub work_id: Option<WorkId>,
    #[serde(default)]
    pub kind: Option<WorkKind>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub objective: Option<String>,
    #[serde(default)]
    pub instructions: Option<String>,
    #[serde(default)]
    pub scope: Option<WorkScope>,
    #[serde(default)]
    pub executor: Option<WorkExecutorInput>,
    #[serde(default)]
    pub control_action: Option<ControlWorkAction>,
    #[serde(default)]
    pub include_archived: Option<bool>,
}

pub async fn handle(service: &WorkService, input: WorkInput) -> BitFunResult<Value> {
    match input.action {
        WorkAction::Start => start_work(service, input).await,
        WorkAction::Continue => continue_work(service, input).await,
        WorkAction::Status => status_work(service, input).await,
        WorkAction::Control => control_work(service, input).await,
    }
}

async fn start_work(service: &WorkService, input: WorkInput) -> BitFunResult<Value> {
    let assignment = input
        .executor
        .map(work_executor_to_assignment)
        .transpose()?;
    let response = service
        .start(StartWorkRequest {
            kind: input.kind.unwrap_or(WorkKind::MultiStep),
            title: required_string(input.title, "title")?,
            objective: required_string(input.objective, "objective")?,
            instructions: required_string(input.instructions, "instructions")?,
            scope: input
                .scope
                .ok_or_else(|| BitFunError::validation("scope is required for action=start"))?,
            visibility: WorkVisibility::Primary,
            primary_surface_policy: PrimarySurfacePolicy::WorkSession,
            assignment: Some(assignment.unwrap_or_else(|| WorkAssignmentRef::agent("agentic"))),
            live_app_id: None,
            idempotency_key: None,
        })
        .await?;

    Ok(json!({
        "action": "start",
        "work_id": response.work.id,
        "status": response.work.status,
        "surface": response.work.primary_surface,
        "execution": {
            "kind": "agent_session_run",
            "execution_binding_id": response.execution_binding_id,
            "turn_id": response.turn_id,
            "started": response.started,
        },
        "work": response.work,
    }))
}

async fn continue_work(service: &WorkService, input: WorkInput) -> BitFunResult<Value> {
    let response = service
        .advance(AdvanceWorkRequest {
            work_id: required_work_id(input.work_id, "continue")?,
            instructions: required_string(input.instructions, "instructions")?,
            advance_policy: Some("start_if_idle".to_string()),
        })
        .await?;

    Ok(json!({
        "action": "continue",
        "work_id": response.work.id,
        "status": response.work.status,
        "surface": response.work.primary_surface,
        "execution": {
            "kind": "agent_session_run",
            "execution_binding_id": response.execution_binding_id,
            "turn_id": response.turn_id,
            "started": response.started,
        },
        "work": response.work,
    }))
}

async fn status_work(service: &WorkService, input: WorkInput) -> BitFunResult<Value> {
    if let Some(work_id) = input.work_id {
        let work = service.get(&work_id).await?;
        return Ok(json!({
            "action": "status",
            "work_id": work.id,
            "status": work.status,
            "running": work.execution_bindings.iter().any(|binding| binding.is_running()),
            "result": work_result(&work),
            "work": work,
        }));
    }

    let include_archived = input.include_archived.unwrap_or(false);
    let works = service
        .list()
        .await?
        .into_iter()
        .filter(|work| include_archived || work.status != WorkStatus::Archived)
        .map(|work| WorkProjection::from(&work))
        .collect::<Vec<_>>();
    Ok(json!({
        "action": "status",
        "works": works,
    }))
}

async fn control_work(service: &WorkService, input: WorkInput) -> BitFunResult<Value> {
    let response = service
        .control(ControlWorkRequest {
            work_id: required_work_id(input.work_id, "control")?,
            action: input.control_action.ok_or_else(|| {
                BitFunError::validation("control_action is required for action=control")
            })?,
        })
        .await?;

    Ok(json!({
        "action": "control",
        "work_id": response.work.id,
        "status": response.work.status,
        "work": response.work,
    }))
}

fn work_executor_to_assignment(executor: WorkExecutorInput) -> BitFunResult<WorkAssignmentRef> {
    match executor.kind.unwrap_or(WorkExecutorKind::Agent) {
        WorkExecutorKind::Agent => {
            let agent_type = required_string(executor.agent_type, "executor.agent_type")?;
            let assignment = WorkAssignmentRef::agent(agent_type);
            debug_assert_eq!(assignment.kind, WorkAssignmentKind::Agent);
            Ok(assignment)
        }
    }
}

fn work_result(work: &WorkRecord) -> Value {
    json!({
        "summary": work.summary,
        "artifact_refs": work.artifact_refs,
        "latest_execution": work.execution_bindings.last(),
    })
}

fn required_string(value: Option<String>, field: &str) -> BitFunResult<String> {
    let value = value.unwrap_or_default();
    if value.trim().is_empty() {
        return Err(BitFunError::validation(format!(
            "{} is required and cannot be empty",
            field
        )));
    }
    Ok(value)
}

fn required_work_id(work_id: Option<WorkId>, action: &str) -> BitFunResult<WorkId> {
    work_id.ok_or_else(|| {
        BitFunError::validation(format!("work_id is required for action={}", action))
    })
}
