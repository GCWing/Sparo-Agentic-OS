use std::path::Path;

use schemars::{generate::SchemaSettings, JsonSchema};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::agentic_os::work::{
    AdvanceWorkRequest, ControlWorkAction, ControlWorkRequest, PrimarySurfacePolicy,
    ReclassifyWorkRequest, StartWorkRequest, UpdateWorkRequest, WorkAssignmentKind,
    WorkAssignmentRef, WorkId, WorkKind, WorkLocator, WorkOwnerRef, WorkProjection, WorkRecord,
    WorkScope, WorkService, WorkStatus, WorkSubject, WorkVisibility,
};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::try_get_path_manager_arc;

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkAction {
    Start,
    Continue,
    Status,
    Control,
    Reclassify,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkExecutorKind {
    Agent,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct WorkExecutorInput {
    /// Executor kind. Omit to use an agent.
    #[serde(default)]
    pub kind: Option<WorkExecutorKind>,
    /// Agent type, such as Runno, bitfun-coder, Cowork, Design, DeepResearch,
    /// AppBuilder, or OutcomeReview.
    #[serde(default)]
    pub agent_type: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkInputKind {
    OneShot,
    MultiStep,
    LongRunningSession,
    Tracking,
    Topic,
    Recurring,
    AppWorkflow,
}

impl From<WorkInputKind> for WorkKind {
    fn from(value: WorkInputKind) -> Self {
        match value {
            WorkInputKind::OneShot => Self::OneShot,
            WorkInputKind::MultiStep => Self::MultiStep,
            WorkInputKind::LongRunningSession => Self::LongRunningSession,
            WorkInputKind::Tracking => Self::Tracking,
            WorkInputKind::Topic => Self::Topic,
            WorkInputKind::Recurring => Self::Recurring,
            WorkInputKind::AppWorkflow => Self::AppWorkflow,
        }
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkInputControlAction {
    Pause,
    Resume,
    CancelCurrentExecution,
    Archive,
    Reopen,
}

impl From<WorkInputControlAction> for ControlWorkAction {
    fn from(value: WorkInputControlAction) -> Self {
        match value {
            WorkInputControlAction::Pause => Self::Pause,
            WorkInputControlAction::Resume => Self::Resume,
            WorkInputControlAction::CancelCurrentExecution => Self::CancelCurrentExecution,
            WorkInputControlAction::Archive => Self::Archive,
            WorkInputControlAction::Reopen => Self::Reopen,
        }
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum WorkInputScope {
    /// Agentic OS or other non-project Work.
    Global,
    /// Project Work. The stable workspace identity is resolved from the
    /// workspace marker at this path.
    Workspace {
        /// Absolute path to the project workspace.
        workspace_path: String,
    },
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct WorkInput {
    /// start: create and launch Work. continue: add instructions. status:
    /// inspect one Work or list all Work. control: change lifecycle state.
    /// reclassify: change kind or topic attachment.
    pub action: WorkAction,
    /// Work ID returned by start. Required for continue, control, reclassify,
    /// and status of one specific Work.
    #[serde(default)]
    pub work_id: Option<String>,
    /// Work kind for start or reclassify. Defaults to multi_step for start.
    #[serde(default)]
    pub kind: Option<WorkInputKind>,
    /// Short Work title. Required for start.
    #[serde(default)]
    pub title: Option<String>,
    /// Durable Work goal. Required for start.
    #[serde(default)]
    pub objective: Option<String>,
    /// Self-contained execution instructions. Required for start and continue.
    #[serde(default)]
    pub instructions: Option<String>,
    /// Execution scope. Required only for start.
    #[serde(default)]
    pub scope: Option<WorkInputScope>,
    /// Agent executor selection for start. Omit to use Runno.
    #[serde(default)]
    pub executor: Option<WorkExecutorInput>,
    /// Lifecycle action. Required for control.
    #[serde(default)]
    pub control_action: Option<WorkInputControlAction>,
    /// Include archived Work when listing status.
    #[serde(default)]
    pub include_archived: Option<bool>,
    /// Optional Topic Work ID to attach under during start or reclassify.
    #[serde(default)]
    pub topic_work_id: Option<String>,
    /// Clear the current topic attachment.
    #[serde(default)]
    pub clear_topic_work_id: Option<bool>,
    #[serde(skip)]
    pub owner: Option<WorkOwnerRef>,
}

pub fn work_input_schema() -> Value {
    let settings = SchemaSettings::draft07().with(|settings| {
        settings.meta_schema = None;
        settings.inline_subschemas = true;
    });
    serde_json::to_value(
        settings
            .into_generator()
            .into_root_schema_for::<WorkInput>(),
    )
    .expect("WorkInput schema must serialize")
}

pub async fn handle(service: &WorkService, input: WorkInput) -> CoreResult<Value> {
    match input.action {
        WorkAction::Start => start_work(service, input).await,
        WorkAction::Continue => continue_work(service, input).await,
        WorkAction::Status => status_work(service, input).await,
        WorkAction::Control => control_work(service, input).await,
        WorkAction::Reclassify => reclassify_work(service, input).await,
    }
}

async fn start_work(service: &WorkService, input: WorkInput) -> CoreResult<Value> {
    let assignment = input
        .executor
        .map(work_executor_to_assignment)
        .transpose()?;
    let (scope, workspace_path) = resolve_start_scope(
        input
            .scope
            .ok_or_else(|| CoreError::validation("scope is required for action=start"))?,
    )?;
    let response = service
        .start(StartWorkRequest {
            kind: input.kind.map(Into::into).unwrap_or(WorkKind::MultiStep),
            title: required_string(input.title, "title")?,
            objective: required_string(input.objective, "objective")?,
            instructions: required_string(input.instructions, "instructions")?,
            subject: WorkSubject::Goal,
            app_refs: Vec::new(),
            scope,
            workspace_path,
            visibility: WorkVisibility::Primary,
            primary_surface_policy: PrimarySurfacePolicy::WorkSession,
            assignment: Some(assignment.unwrap_or_else(|| WorkAssignmentRef::agent("Runno"))),
            idempotency_key: None,
            owner: input.owner,
        })
        .await?;

    let mut work = response.work;
    if input.topic_work_id.is_some() || input.clear_topic_work_id.unwrap_or(false) {
        let topic_work_id = optional_work_id(input.topic_work_id, "topic_work_id")?;
        work = service
            .update(
                &work.locator(),
                UpdateWorkRequest {
                    topic_work_id,
                    clear_topic_work_id: input.clear_topic_work_id.unwrap_or(false),
                    ..UpdateWorkRequest::default()
                },
            )
            .await?;
    }

    Ok(json!({
        "action": "start",
        "work_id": work.id,
        "status": work.status,
        "surface": work.primary_surface,
        "execution": {
            "kind": "agent_session_run",
            "execution_binding_id": response.execution_binding_id,
            "turn_id": response.turn_id,
            "started": response.started,
        },
        "work": work,
    }))
}

async fn continue_work(service: &WorkService, input: WorkInput) -> CoreResult<Value> {
    let locator = required_work_locator(service, input.work_id, "continue").await?;
    let response = service
        .advance(AdvanceWorkRequest {
            locator,
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

async fn status_work(service: &WorkService, input: WorkInput) -> CoreResult<Value> {
    if let Some(work_id) = input.work_id {
        let locator = required_work_locator(service, Some(work_id), "status").await?;
        let work = service.get(&locator).await?;
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

async fn control_work(service: &WorkService, input: WorkInput) -> CoreResult<Value> {
    let locator = required_work_locator(service, input.work_id, "control").await?;
    let response = service
        .control(ControlWorkRequest {
            locator,
            action: input
                .control_action
                .ok_or_else(|| {
                    CoreError::validation("control_action is required for action=control")
                })?
                .into(),
        })
        .await?;

    Ok(json!({
        "action": "control",
        "work_id": response.work.id,
        "status": response.work.status,
        "work": response.work,
    }))
}

async fn reclassify_work(service: &WorkService, input: WorkInput) -> CoreResult<Value> {
    let locator = required_work_locator(service, input.work_id, "reclassify").await?;
    let work = service
        .reclassify(ReclassifyWorkRequest {
            locator,
            kind: input
                .kind
                .ok_or_else(|| CoreError::validation("kind is required for action=reclassify"))?
                .into(),
            topic_work_id: optional_work_id(input.topic_work_id, "topic_work_id")?,
            clear_topic_work_id: input.clear_topic_work_id.unwrap_or(false),
        })
        .await?;

    Ok(json!({
        "action": "reclassify",
        "work_id": work.id,
        "kind": work.kind,
        "topic_work_id": work.topic_work_id,
        "status": work.status,
        "work": work,
    }))
}

fn work_executor_to_assignment(executor: WorkExecutorInput) -> CoreResult<WorkAssignmentRef> {
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

fn required_string(value: Option<String>, field: &str) -> CoreResult<String> {
    let value = value.unwrap_or_default();
    if value.trim().is_empty() {
        return Err(CoreError::validation(format!(
            "{} is required and cannot be empty",
            field
        )));
    }
    Ok(value)
}

fn resolve_start_scope(scope: WorkInputScope) -> CoreResult<(WorkScope, Option<String>)> {
    resolve_start_scope_with(scope, |workspace_path| {
        try_get_path_manager_arc()?.workspace_id(workspace_path)
    })
}

fn resolve_start_scope_with(
    scope: WorkInputScope,
    resolve_workspace_id: impl FnOnce(&Path) -> CoreResult<String>,
) -> CoreResult<(WorkScope, Option<String>)> {
    match scope {
        WorkInputScope::Global => Ok((WorkScope::Global, None)),
        WorkInputScope::Workspace { workspace_path } => {
            let workspace_path = required_string(Some(workspace_path), "scope.workspace_path")?;
            let workspace_id = resolve_workspace_id(Path::new(&workspace_path))?;
            Ok((WorkScope::Workspace { workspace_id }, Some(workspace_path)))
        }
    }
}

async fn required_work_locator(
    service: &WorkService,
    work_id: Option<String>,
    action: &str,
) -> CoreResult<WorkLocator> {
    let work_id = required_work_id(work_id, action)?;
    service.locate_by_id(&work_id).await
}

fn required_work_id(work_id: Option<String>, action: &str) -> CoreResult<WorkId> {
    work_id
        .ok_or_else(|| CoreError::validation(format!("work_id is required for action={action}")))
        .and_then(|work_id| {
            WorkId::parse(work_id).map_err(|error| {
                CoreError::validation(format!("invalid work_id for action={action}: {error}"))
            })
        })
}

fn optional_work_id(work_id: Option<String>, field: &str) -> CoreResult<Option<WorkId>> {
    work_id
        .map(|work_id| {
            WorkId::parse(work_id)
                .map_err(|error| CoreError::validation(format!("invalid {field}: {error}")))
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::json;

    use super::*;
    use crate::agentic_os::work::{MemoryWorkStore, WorkStore, WorkSurfaceRef};

    #[test]
    fn workspace_start_contract_uses_path_without_internal_identity() {
        let input = serde_json::from_value::<WorkInput>(json!({
            "action": "start",
            "title": "Build deck",
            "objective": "Create a project deck",
            "instructions": "Create and verify the deck.",
            "scope": {
                "kind": "workspace",
                "workspace_path": "D:/workspace/project"
            }
        }))
        .expect("workspace Work input");

        assert!(matches!(
            input.scope,
            Some(WorkInputScope::Workspace { workspace_path })
                if workspace_path == "D:/workspace/project"
        ));
    }

    #[test]
    fn workspace_start_contract_rejects_internal_workspace_identity() {
        let error = serde_json::from_value::<WorkInput>(json!({
            "action": "start",
            "title": "Build deck",
            "objective": "Create a project deck",
            "instructions": "Create and verify the deck.",
            "scope": {
                "kind": "workspace",
                "workspaceId": "ws_internal",
                "workspace_path": "D:/workspace/project"
            }
        }))
        .expect_err("internal workspace identity must not be agent-facing");

        assert!(error.to_string().contains("workspaceId"));
    }

    #[test]
    fn workspace_start_scope_resolves_stable_identity() {
        let (scope, workspace_path) = resolve_start_scope_with(
            WorkInputScope::Workspace {
                workspace_path: "D:/workspace/project".to_string(),
            },
            |path| {
                assert_eq!(path, Path::new("D:/workspace/project"));
                Ok("ws_project".to_string())
            },
        )
        .expect("resolved workspace scope");

        assert_eq!(
            scope,
            WorkScope::Workspace {
                workspace_id: "ws_project".to_string()
            }
        );
        assert_eq!(workspace_path.as_deref(), Some("D:/workspace/project"));
    }

    #[test]
    fn global_start_scope_has_no_workspace_path() {
        let (scope, workspace_path) = resolve_start_scope_with(WorkInputScope::Global, |_| {
            panic!("global scope must not resolve workspace identity")
        })
        .expect("global scope");

        assert_eq!(scope, WorkScope::Global);
        assert_eq!(workspace_path, None);
    }

    #[test]
    fn follow_up_contract_only_requires_work_id() {
        let input = serde_json::from_value::<WorkInput>(json!({
            "action": "continue",
            "work_id": "work_123",
            "instructions": "Continue with the next step."
        }))
        .expect("follow-up Work input");

        assert_eq!(input.work_id.as_deref(), Some("work_123"));
        assert!(input.scope.is_none());
    }

    #[tokio::test]
    async fn work_locator_is_resolved_from_opaque_work_id() {
        let store = Arc::new(MemoryWorkStore::new());
        let service = WorkService::new(store.clone());
        let work_id = WorkId::parse("work_123").expect("work ID");
        let record = WorkRecord::new(
            work_id.clone(),
            WorkKind::MultiStep,
            "Build deck".to_string(),
            "Create a project deck".to_string(),
            WorkVisibility::Primary,
            WorkSubject::Goal,
            Vec::new(),
            WorkScope::Global,
            WorkSurfaceRef::WorkCenter {
                work_id: work_id.clone(),
            },
            1,
        );
        store.put(&record).await.expect("store Work");

        let locator = service
            .locate_by_id(&work_id)
            .await
            .expect("resolve Work locator");

        assert_eq!(locator, record.locator());
    }

    #[tokio::test]
    async fn duplicate_work_id_across_scopes_is_rejected() {
        let store = Arc::new(MemoryWorkStore::new());
        let service = WorkService::new(store.clone());
        let work_id = WorkId::parse("work_duplicate").expect("work ID");
        for scope in [
            WorkScope::Global,
            WorkScope::Workspace {
                workspace_id: "ws_project".to_string(),
            },
        ] {
            let record = WorkRecord::new(
                work_id.clone(),
                WorkKind::MultiStep,
                "Build deck".to_string(),
                "Create a project deck".to_string(),
                WorkVisibility::Primary,
                WorkSubject::Goal,
                Vec::new(),
                scope,
                WorkSurfaceRef::WorkCenter {
                    work_id: work_id.clone(),
                },
                1,
            );
            store.put(&record).await.expect("store Work");
        }

        let error = service
            .locate_by_id(&work_id)
            .await
            .expect_err("duplicate Work ID must be rejected");

        assert!(error.to_string().contains("ambiguous across scopes"));
    }
}
