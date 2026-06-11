use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::infrastructure::try_get_path_manager_arc;
use crate::util::errors::{BitFunError, BitFunResult};

use super::assignment::{WorkAssignmentKind, WorkAssignmentRef};
use super::execution_binding::{
    WorkExecutionBinding, WorkExecutionBindingStatus, WorkExecutionSource,
};
use super::ids::WorkId;
use super::lifecycle::WorkSummary;
use super::record::{AgentSessionRef, ArtifactRef, WorkRecord};
use super::runtime_bridge::{
    CreateWorkSessionRequest, NoopWorkRuntimeBridge, WorkRuntimeBridge, WorkSessionAdvanceRequest,
};
use super::store::WorkStore;
use super::surface::WorkSurfaceRef;
use super::title::{WorkTitleSource, WorkTitleState};
use super::types::{WorkKind, WorkScope, WorkStatus, WorkVisibility};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrimarySurfacePolicy {
    WorkCenter,
    WorkSession,
    LiveApp,
}

impl Default for PrimarySurfacePolicy {
    fn default() -> Self {
        Self::WorkCenter
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkRequest {
    pub kind: WorkKind,
    pub title: String,
    pub objective: String,
    pub scope: WorkScope,
    #[serde(default)]
    pub visibility: WorkVisibility,
    #[serde(default = "default_start_primary_surface_policy")]
    pub primary_surface_policy: PrimarySurfacePolicy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignment: Option<WorkAssignmentRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub live_app_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_state: Option<WorkTitleState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartWorkRequest {
    pub kind: WorkKind,
    pub title: String,
    pub objective: String,
    pub instructions: String,
    pub scope: WorkScope,
    #[serde(default)]
    pub visibility: WorkVisibility,
    #[serde(default)]
    pub primary_surface_policy: PrimarySurfacePolicy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignment: Option<WorkAssignmentRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub live_app_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UpdateWorkRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub objective: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<WorkStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_surface: Option<WorkSurfaceRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_state: Option<WorkTitleState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchNewWorkRequest {
    pub parent_work_id: WorkId,
    pub kind: WorkKind,
    pub title: String,
    pub objective: String,
    pub assignment: WorkAssignmentRef,
    pub instructions: String,
    pub scope: WorkScope,
    #[serde(default)]
    pub surface_policy: PrimarySurfacePolicy,
    #[serde(default)]
    pub start: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum DispatchWorkRequest {
    DispatchNew(DispatchNewWorkRequest),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchWorkResponse {
    pub work: WorkRecord,
    pub parent_work_id: WorkId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_binding_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvanceWorkRequest {
    pub work_id: WorkId,
    pub instructions: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub advance_policy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvanceWorkResponse {
    pub work: WorkRecord,
    pub execution_binding_id: String,
    pub turn_id: String,
    pub started: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartWorkResponse {
    pub work: WorkRecord,
    pub execution_binding_id: String,
    pub turn_id: String,
    pub started: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ControlWorkAction {
    Pause,
    Resume,
    CancelCurrentExecution,
    Archive,
    Reopen,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlWorkRequest {
    pub work_id: WorkId,
    pub action: ControlWorkAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlWorkResponse {
    pub work: WorkRecord,
}

#[derive(Clone)]
pub struct WorkService {
    store: Arc<dyn WorkStore>,
    runtime_bridge: Arc<dyn WorkRuntimeBridge>,
}

impl WorkService {
    pub fn new(store: Arc<dyn WorkStore>) -> Self {
        Self {
            store,
            runtime_bridge: Arc::new(NoopWorkRuntimeBridge),
        }
    }

    pub fn with_runtime_bridge(
        store: Arc<dyn WorkStore>,
        runtime_bridge: Arc<dyn WorkRuntimeBridge>,
    ) -> Self {
        Self {
            store,
            runtime_bridge,
        }
    }

    pub async fn list(&self) -> BitFunResult<Vec<WorkRecord>> {
        self.store.list().await
    }

    pub async fn get(&self, id: &WorkId) -> BitFunResult<WorkRecord> {
        self.store
            .get(id)
            .await?
            .ok_or_else(|| BitFunError::NotFound(format!("Work not found: {}", id)))
    }

    pub async fn create(&self, request: CreateWorkRequest) -> BitFunResult<WorkRecord> {
        validate_required("title", &request.title)?;
        validate_required("objective", &request.objective)?;

        let now = now_millis();
        let work_id = WorkId::generate();
        let primary_surface = match request.primary_surface_policy {
            PrimarySurfacePolicy::WorkCenter | PrimarySurfacePolicy::WorkSession => {
                WorkSurfaceRef::WorkCenter {
                    work_id: work_id.clone(),
                }
            }
            PrimarySurfacePolicy::LiveApp => {
                let app_id = request.live_app_id.clone().ok_or_else(|| {
                    BitFunError::validation("live_app_id is required for live_app surface policy")
                })?;
                WorkSurfaceRef::LiveApp { app_id }
            }
        };

        let title_state = request.title_state.clone().unwrap_or_else(|| {
            if let PrimarySurfacePolicy::LiveApp = request.primary_surface_policy {
                request
                    .live_app_id
                    .as_ref()
                    .map(WorkTitleState::live_app)
                    .unwrap_or_default()
            } else {
                WorkTitleState::default()
            }
        });

        let mut record = WorkRecord::new(
            work_id.clone(),
            request.kind,
            request.title,
            request.objective,
            request.visibility,
            request.scope,
            primary_surface,
            now,
        );
        record.assignment = request.assignment;
        record.title_state = title_state;

        match request.primary_surface_policy {
            PrimarySurfacePolicy::WorkSession => {
                self.ensure_work_session(&mut record, None).await?;
            }
            PrimarySurfacePolicy::LiveApp => {
                if let WorkSurfaceRef::LiveApp { app_id } = &record.primary_surface {
                    record.execution_bindings.push(WorkExecutionBinding::new(
                        WorkExecutionSource::LiveAppWorker {
                            app_id: app_id.clone(),
                            worker_id: None,
                        },
                        WorkExecutionBindingStatus::Running,
                        now,
                    ));
                    record.set_status(WorkStatus::Running, "live app workflow started", now);
                }
            }
            PrimarySurfacePolicy::WorkCenter => {}
        }

        self.store.put(&record).await?;
        Ok(record)
    }

    pub async fn update(
        &self,
        id: &WorkId,
        request: UpdateWorkRequest,
    ) -> BitFunResult<WorkRecord> {
        let now = now_millis();
        let mut record = self.get(id).await?;

        if let Some(title) = request.title {
            validate_required("title", &title)?;
            record.title = title;
            record.title_state = request
                .title_state
                .clone()
                .unwrap_or_else(WorkTitleState::user_locked);
            record.touch(now);
        } else if let Some(title_state) = request.title_state {
            record.title_state = title_state;
            record.touch(now);
        }
        if let Some(objective) = request.objective {
            validate_required("objective", &objective)?;
            record.objective = objective;
            record.touch(now);
        }
        if let Some(summary) = request.summary {
            record.summary = Some(WorkSummary {
                text: summary,
                updated_at: now,
            });
            record.touch(now);
        }
        if let Some(status) = request.status {
            record.set_status(status, "status updated", now);
        }
        if let Some(surface) = request.primary_surface {
            record.bind_surface(surface, true, now);
        }

        self.store.put(&record).await?;
        Ok(record)
    }

    pub async fn sync_title_from_agent_session(
        &self,
        session_id: &str,
        title: &str,
        lock_as_user_title: bool,
    ) -> BitFunResult<Vec<WorkRecord>> {
        let session_id = session_id.trim();
        let title = title.trim();
        if session_id.is_empty() || title.is_empty() {
            return Ok(Vec::new());
        }

        let now = now_millis();
        let mut updated = Vec::new();
        for mut record in self.store.list().await? {
            if !work_title_can_follow_agent_session(&record, session_id) {
                continue;
            }

            let next_title_state = if lock_as_user_title {
                WorkTitleState {
                    source: WorkTitleSource::User,
                    locked: true,
                    subject_ref: Some(session_id.to_string()),
                }
            } else {
                WorkTitleState::session(session_id.to_string())
            };
            if record.title == title && record.title_state == next_title_state {
                continue;
            }

            record.title = title.to_string();
            record.title_state = next_title_state;
            record.touch(now);
            self.store.put(&record).await?;
            updated.push(record);
        }

        Ok(updated)
    }

    pub async fn sync_title_from_live_app(
        &self,
        app_id: &str,
        title: &str,
    ) -> BitFunResult<Vec<WorkRecord>> {
        let app_id = app_id.trim();
        let title = title.trim();
        if app_id.is_empty() || title.is_empty() {
            return Ok(Vec::new());
        }

        let now = now_millis();
        let mut updated = Vec::new();
        for mut record in self.store.list().await? {
            if !work_title_can_follow_live_app(&record, app_id) {
                continue;
            }

            let next_title_state = WorkTitleState::live_app(app_id.to_string());
            if record.title == title && record.title_state == next_title_state {
                continue;
            }

            record.title = title.to_string();
            record.title_state = next_title_state;
            record.touch(now);
            self.store.put(&record).await?;
            updated.push(record);
        }

        Ok(updated)
    }

    pub async fn bind_surface(
        &self,
        id: &WorkId,
        surface: WorkSurfaceRef,
        set_primary: bool,
    ) -> BitFunResult<WorkRecord> {
        let now = now_millis();
        let mut record = self.get(id).await?;
        record.bind_surface(surface, set_primary, now);
        self.store.put(&record).await?;
        Ok(record)
    }

    pub async fn bind_artifact(
        &self,
        id: &WorkId,
        artifact: ArtifactRef,
    ) -> BitFunResult<WorkRecord> {
        let now = now_millis();
        let mut record = self.get(id).await?;
        if !record
            .artifact_refs
            .iter()
            .any(|item| item.id == artifact.id)
        {
            record.artifact_refs.push(artifact);
        }
        record.touch(now);
        self.store.put(&record).await?;
        Ok(record)
    }

    pub async fn dispatch(
        &self,
        request: DispatchWorkRequest,
    ) -> BitFunResult<DispatchWorkResponse> {
        match request {
            DispatchWorkRequest::DispatchNew(request) => self.dispatch_new(request).await,
        }
    }

    pub async fn start(&self, request: StartWorkRequest) -> BitFunResult<StartWorkResponse> {
        validate_required("instructions", &request.instructions)?;
        if request.primary_surface_policy != PrimarySurfacePolicy::WorkSession {
            return Err(BitFunError::validation(
                "Work action=start currently requires primary_surface_policy=work_session",
            ));
        }

        let assignment = request
            .assignment
            .unwrap_or_else(|| WorkAssignmentRef::agent("agentic"));
        if assignment.kind != WorkAssignmentKind::Agent {
            return Err(BitFunError::validation(
                "Work action=start currently requires assignment.kind=agent",
            ));
        }
        if assignment
            .agent_type
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
        {
            return Err(BitFunError::validation(
                "assignment.agent_type is required for Work action=start",
            ));
        }

        let work = self
            .create(CreateWorkRequest {
                kind: request.kind,
                title: request.title,
                objective: request.objective,
                scope: request.scope,
                visibility: request.visibility,
                primary_surface_policy: request.primary_surface_policy,
                assignment: Some(assignment),
                live_app_id: request.live_app_id,
                title_state: Some(WorkTitleState::agent()),
            })
            .await?;

        let advanced = self
            .advance(AdvanceWorkRequest {
                work_id: work.id,
                instructions: request.instructions,
                advance_policy: Some("start_if_idle".to_string()),
            })
            .await?;

        Ok(StartWorkResponse {
            work: advanced.work,
            execution_binding_id: advanced.execution_binding_id,
            turn_id: advanced.turn_id,
            started: advanced.started,
        })
    }

    pub async fn dispatch_new(
        &self,
        request: DispatchNewWorkRequest,
    ) -> BitFunResult<DispatchWorkResponse> {
        let parent = self.get(&request.parent_work_id).await?;
        let mut child = self
            .create(CreateWorkRequest {
                kind: request.kind,
                title: request.title,
                objective: request.objective,
                scope: request.scope,
                visibility: WorkVisibility::Primary,
                primary_surface_policy: request.surface_policy,
                assignment: Some(request.assignment),
                live_app_id: None,
                title_state: Some(WorkTitleState::agent()),
            })
            .await?;

        let mut parent = parent;
        let now = now_millis();
        let parent_binding = WorkExecutionBinding::new(
            WorkExecutionSource::DelegatedWorkRun {
                parent_work_id: parent.id.clone(),
                child_work_id: child.id.clone(),
            },
            if request.start {
                WorkExecutionBindingStatus::Running
            } else {
                WorkExecutionBindingStatus::Queued
            },
            now,
        );
        parent.execution_bindings.push(parent_binding);
        parent.touch(now);
        self.store.put(&parent).await?;

        let execution_binding_id = if request.start {
            let advanced = self
                .advance(AdvanceWorkRequest {
                    work_id: child.id.clone(),
                    instructions: request.instructions,
                    advance_policy: Some("start_if_idle".to_string()),
                })
                .await?;
            child = advanced.work;
            Some(advanced.execution_binding_id)
        } else {
            None
        };

        Ok(DispatchWorkResponse {
            work: child,
            parent_work_id: request.parent_work_id,
            execution_binding_id,
        })
    }

    pub async fn advance(&self, request: AdvanceWorkRequest) -> BitFunResult<AdvanceWorkResponse> {
        validate_required("instructions", &request.instructions)?;
        let now = now_millis();
        let mut record = self.get(&request.work_id).await?;
        self.ensure_work_session(&mut record, None).await?;

        let session_id = record
            .work_session_id()
            .ok_or_else(|| BitFunError::service("WorkSession was not bound"))?
            .to_string();
        let agent_type = record
            .assignment
            .as_ref()
            .and_then(|assignment| assignment.agent_type.clone())
            .unwrap_or_else(|| "agentic".to_string());
        let workspace_path = resolve_runtime_workspace_path(&record.scope)?;

        let advance_outcome = self
            .runtime_bridge
            .advance_work_session(WorkSessionAdvanceRequest {
                work_id: record.id.clone(),
                session_id: session_id.clone(),
                agent_type,
                workspace_path,
                instructions: request.instructions,
            })
            .await?;

        let binding_status = if advance_outcome.started {
            WorkExecutionBindingStatus::Running
        } else {
            WorkExecutionBindingStatus::Queued
        };
        let binding = WorkExecutionBinding::new(
            WorkExecutionSource::AgentSessionRun {
                session_id: advance_outcome.session_id,
                turn_id: Some(advance_outcome.turn_id.clone()),
            },
            binding_status,
            now,
        );
        let execution_binding_id = binding.id.clone();
        record.execution_bindings.push(binding);
        record.set_status(WorkStatus::Active, "advanced", now);
        self.store.put(&record).await?;

        Ok(AdvanceWorkResponse {
            work: record,
            execution_binding_id,
            turn_id: advance_outcome.turn_id,
            started: advance_outcome.started,
        })
    }

    pub async fn control(&self, request: ControlWorkRequest) -> BitFunResult<ControlWorkResponse> {
        let now = now_millis();
        let mut record = self.get(&request.work_id).await?;
        match request.action {
            ControlWorkAction::Pause => record.set_status(WorkStatus::Paused, "paused", now),
            ControlWorkAction::Resume => record.set_status(WorkStatus::Active, "resumed", now),
            ControlWorkAction::Archive => record.set_status(WorkStatus::Archived, "archived", now),
            ControlWorkAction::Reopen => record.set_status(WorkStatus::Active, "reopened", now),
            ControlWorkAction::CancelCurrentExecution => {
                if let Some(binding) = record
                    .execution_bindings
                    .iter_mut()
                    .rev()
                    .find(|binding| binding.is_running())
                {
                    if let WorkExecutionSource::AgentSessionRun { session_id, .. } = &binding.source
                    {
                        self.runtime_bridge
                            .cancel_work_session_run(session_id)
                            .await?;
                    }
                    binding.set_status(WorkExecutionBindingStatus::Cancelled, now);
                }
                record.set_status(WorkStatus::Active, "current execution cancelled", now);
            }
        }
        self.store.put(&record).await?;
        Ok(ControlWorkResponse { work: record })
    }

    pub async fn mark_agent_session_turn_completed(
        &self,
        turn_id: &str,
    ) -> BitFunResult<Option<WorkRecord>> {
        self.mark_agent_session_turn_terminal(
            turn_id,
            WorkExecutionBindingStatus::Completed,
            WorkStatus::Active,
            "agent session turn completed",
        )
        .await
    }

    pub async fn mark_agent_session_turn_failed(
        &self,
        turn_id: &str,
        error: &str,
    ) -> BitFunResult<Option<WorkRecord>> {
        let label = if error.trim().is_empty() {
            "agent session failed".to_string()
        } else {
            format!("agent session failed: {}", error.trim())
        };
        self.mark_agent_session_turn_terminal(
            turn_id,
            WorkExecutionBindingStatus::Failed,
            WorkStatus::Failed,
            label,
        )
        .await
    }

    pub async fn mark_agent_session_turn_cancelled(
        &self,
        turn_id: &str,
    ) -> BitFunResult<Option<WorkRecord>> {
        self.mark_agent_session_turn_terminal(
            turn_id,
            WorkExecutionBindingStatus::Cancelled,
            WorkStatus::Active,
            "agent session turn cancelled",
        )
        .await
    }

    pub async fn mark_agent_session_turn_started(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> BitFunResult<Option<WorkRecord>> {
        let session_id = session_id.trim();
        let turn_id = turn_id.trim();
        if session_id.is_empty() || turn_id.is_empty() {
            return Ok(None);
        }

        let now = now_millis();
        for mut record in self.store.list().await? {
            if !work_references_agent_session(&record, session_id) {
                continue;
            }

            let mut matched_binding = false;
            for binding in &mut record.execution_bindings {
                if agent_session_binding_matches_turn(binding, turn_id) {
                    binding.set_status(WorkExecutionBindingStatus::Running, now);
                    matched_binding = true;
                }
            }

            if !matched_binding {
                record.execution_bindings.push(WorkExecutionBinding::new(
                    WorkExecutionSource::AgentSessionRun {
                        session_id: session_id.to_string(),
                        turn_id: Some(turn_id.to_string()),
                    },
                    WorkExecutionBindingStatus::Running,
                    now,
                ));
            }

            if should_reopen_for_agent_session_activity(record.status) {
                record.set_status(WorkStatus::Active, "agent session continued", now);
            } else {
                record.touch(now);
            }
            self.store.put(&record).await?;
            return Ok(Some(record));
        }

        Ok(None)
    }

    pub async fn mark_agent_session_turn_waiting_user(
        &self,
        turn_id: &str,
    ) -> BitFunResult<Option<WorkRecord>> {
        self.mark_agent_session_turn_execution_state(
            turn_id,
            WorkExecutionBindingStatus::WaitingUser,
            Some(WorkStatus::WaitingUser),
            "agent session waiting for user",
        )
        .await
    }

    pub async fn mark_agent_session_turn_running(
        &self,
        turn_id: &str,
    ) -> BitFunResult<Option<WorkRecord>> {
        self.mark_agent_session_turn_execution_state(
            turn_id,
            WorkExecutionBindingStatus::Running,
            Some(WorkStatus::Active),
            "agent session resumed",
        )
        .await
    }

    async fn mark_agent_session_turn_execution_state(
        &self,
        turn_id: &str,
        binding_status: WorkExecutionBindingStatus,
        work_status: Option<WorkStatus>,
        label: impl Into<String>,
    ) -> BitFunResult<Option<WorkRecord>> {
        let turn_id = turn_id.trim();
        if turn_id.is_empty() {
            return Ok(None);
        }

        let now = now_millis();
        let mut label = label.into();
        if label.len() > 512 {
            label.truncate(512);
        }

        for mut record in self.store.list().await? {
            let mut matched = false;
            for binding in &mut record.execution_bindings {
                if agent_session_binding_matches_turn(binding, turn_id) {
                    binding.set_status(binding_status, now);
                    matched = true;
                }
            }

            if matched {
                match work_status {
                    Some(status)
                        if record.status != WorkStatus::Archived
                            && record.status != WorkStatus::Completed =>
                    {
                        record.set_status(status, label, now);
                    }
                    _ => record.touch(now),
                }
                self.store.put(&record).await?;
                return Ok(Some(record));
            }
        }

        Ok(None)
    }

    async fn mark_agent_session_turn_terminal(
        &self,
        turn_id: &str,
        binding_status: WorkExecutionBindingStatus,
        work_status: WorkStatus,
        label: impl Into<String>,
    ) -> BitFunResult<Option<WorkRecord>> {
        let turn_id = turn_id.trim();
        if turn_id.is_empty() {
            return Ok(None);
        }

        let now = now_millis();
        let mut label = label.into();
        if label.len() > 512 {
            label.truncate(512);
        }

        for mut record in self.store.list().await? {
            let mut matched = false;
            for binding in &mut record.execution_bindings {
                if let WorkExecutionSource::AgentSessionRun {
                    turn_id: Some(binding_turn_id),
                    ..
                } = &binding.source
                {
                    if binding_turn_id == turn_id {
                        binding.set_status(binding_status, now);
                        matched = true;
                    }
                }
            }

            if matched {
                let has_running_binding = record
                    .execution_bindings
                    .iter()
                    .any(WorkExecutionBinding::is_running);
                if record.status != WorkStatus::Archived && !has_running_binding {
                    let next_status = if binding_status == WorkExecutionBindingStatus::Completed {
                        completed_turn_work_status(&record)
                    } else {
                        work_status
                    };
                    record.set_status(next_status, label, now);
                } else {
                    record.touch(now);
                }
                self.store.put(&record).await?;
                return Ok(Some(record));
            }
        }

        Ok(None)
    }

    async fn ensure_work_session(
        &self,
        record: &mut WorkRecord,
        agent_type_override: Option<String>,
    ) -> BitFunResult<()> {
        if record.work_session_id().is_some() {
            return Ok(());
        }

        let agent_type = agent_type_override
            .or_else(|| {
                record
                    .assignment
                    .as_ref()
                    .and_then(|assignment| assignment.agent_type.clone())
            })
            .unwrap_or_else(|| "agentic".to_string());
        let workspace_path = resolve_runtime_workspace_path(&record.scope)?;
        let outcome = self
            .runtime_bridge
            .create_work_session(CreateWorkSessionRequest {
                work_id: record.id.clone(),
                title: record.title.clone(),
                agent_type,
                workspace_path: workspace_path.clone(),
            })
            .await?;
        let now = now_millis();
        record.session_refs.push(AgentSessionRef {
            session_id: outcome.session_id.clone(),
            workspace_path: Some(workspace_path),
        });
        record.bind_surface(
            WorkSurfaceRef::WorkSession {
                session_id: outcome.session_id,
            },
            true,
            now,
        );
        Ok(())
    }
}

fn validate_required(field: &str, value: &str) -> BitFunResult<()> {
    if value.trim().is_empty() {
        return Err(BitFunError::validation(format!(
            "{} cannot be empty",
            field
        )));
    }
    Ok(())
}

fn resolve_runtime_workspace_path(scope: &WorkScope) -> BitFunResult<String> {
    match scope {
        WorkScope::Workspace { workspace_path } => {
            validate_required("workspace_path", workspace_path)?;
            Ok(workspace_path.clone())
        }
        WorkScope::System => {
            let path_manager = try_get_path_manager_arc()?;
            Ok(path_manager
                .agentic_os_runtime_root()
                .to_string_lossy()
                .into_owned())
        }
    }
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn default_start_primary_surface_policy() -> PrimarySurfacePolicy {
    PrimarySurfacePolicy::WorkSession
}

fn work_references_agent_session(record: &WorkRecord, session_id: &str) -> bool {
    record
        .session_refs
        .iter()
        .any(|reference| reference.session_id == session_id)
        || record.surfaces.iter().any(|surface| match surface {
            WorkSurfaceRef::WorkSession {
                session_id: surface_session_id,
            }
            | WorkSurfaceRef::AgentSession {
                session_id: surface_session_id,
            } => surface_session_id == session_id,
            _ => false,
        })
}

fn work_title_can_follow_agent_session(record: &WorkRecord, session_id: &str) -> bool {
    record.title_state.can_follow_session(session_id)
        && work_references_agent_session(record, session_id)
}

fn work_references_live_app(record: &WorkRecord, app_id: &str) -> bool {
    record.surfaces.iter().any(|surface| match surface {
        WorkSurfaceRef::LiveApp {
            app_id: surface_app_id,
        } => surface_app_id == app_id,
        _ => false,
    }) || record
        .execution_bindings
        .iter()
        .any(|binding| match &binding.source {
            WorkExecutionSource::LiveAppWorker {
                app_id: source_app_id,
                ..
            } => source_app_id == app_id,
            _ => false,
        })
}

fn work_title_can_follow_live_app(record: &WorkRecord, app_id: &str) -> bool {
    record.title_state.can_follow_live_app(app_id) && work_references_live_app(record, app_id)
}

fn agent_session_binding_matches_turn(binding: &WorkExecutionBinding, turn_id: &str) -> bool {
    matches!(
        &binding.source,
        WorkExecutionSource::AgentSessionRun {
            turn_id: Some(binding_turn_id),
            ..
        } if binding_turn_id == turn_id
    )
}

fn should_reopen_for_agent_session_activity(status: WorkStatus) -> bool {
    !matches!(status, WorkStatus::Active | WorkStatus::Archived)
}

fn completed_turn_work_status(record: &WorkRecord) -> WorkStatus {
    if record.kind == WorkKind::OneShot {
        WorkStatus::Completed
    } else {
        WorkStatus::Active
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use async_trait::async_trait;

    use super::*;
    use crate::agentic_os::work::store::MemoryWorkStore;

    #[derive(Debug)]
    struct TestRuntimeBridge;

    #[async_trait]
    impl WorkRuntimeBridge for TestRuntimeBridge {
        async fn create_work_session(
            &self,
            request: CreateWorkSessionRequest,
        ) -> BitFunResult<super::super::runtime_bridge::CreateWorkSessionOutcome> {
            Ok(super::super::runtime_bridge::CreateWorkSessionOutcome {
                session_id: format!("session_{}", request.work_id.as_str()),
                session_name: request.title,
                agent_type: request.agent_type,
            })
        }

        async fn advance_work_session(
            &self,
            request: WorkSessionAdvanceRequest,
        ) -> BitFunResult<super::super::runtime_bridge::WorkSessionAdvanceOutcome> {
            Ok(super::super::runtime_bridge::WorkSessionAdvanceOutcome {
                session_id: request.session_id,
                turn_id: format!("turn_{}", request.work_id.as_str()),
                started: true,
            })
        }
    }

    fn service() -> WorkService {
        WorkService::with_runtime_bridge(
            Arc::new(MemoryWorkStore::new()),
            Arc::new(TestRuntimeBridge),
        )
    }

    #[tokio::test]
    async fn work_record_round_trips() {
        let service = service();
        let record = service
            .create(CreateWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Fix login".to_string(),
                objective: "Investigate and fix login".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkCenter,
                assignment: None,
                live_app_id: None,
                title_state: None,
            })
            .await
            .expect("create work");

        let json = serde_json::to_string(&record).expect("serialize");
        let parsed: WorkRecord = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed.id, record.id);
        assert_eq!(parsed.objective, "Investigate and fix login");
    }

    #[tokio::test]
    async fn create_with_work_session_binds_session_surface() {
        let service = service();
        let record = service
            .create(CreateWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Implement feature".to_string(),
                objective: "Ship the feature".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("agentic")),
                live_app_id: None,
                title_state: None,
            })
            .await
            .expect("create work session");

        assert!(record.work_session_id().is_some());
        assert_eq!(record.session_refs.len(), 1);
    }

    #[tokio::test]
    async fn template_work_title_follows_generated_session_title() {
        let service = service();
        let record = service
            .create(CreateWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Coding".to_string(),
                objective: "Coding".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("agentic")),
                live_app_id: None,
                title_state: Some(WorkTitleState::template()),
            })
            .await
            .expect("create work session");
        let session_id = record.work_session_id().expect("work session").to_string();

        let updated = service
            .sync_title_from_agent_session(&session_id, "Fix OAuth callback", false)
            .await
            .expect("sync title");

        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0].title, "Fix OAuth callback");
        assert_eq!(updated[0].title_state.source, WorkTitleSource::Session);
        assert_eq!(
            updated[0].title_state.subject_ref.as_deref(),
            Some(session_id.as_str())
        );
        assert!(!updated[0].title_state.locked);
    }

    #[tokio::test]
    async fn manual_session_title_sync_locks_work_title() {
        let service = service();
        let record = service
            .create(CreateWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Coding".to_string(),
                objective: "Coding".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("agentic")),
                live_app_id: None,
                title_state: Some(WorkTitleState::template()),
            })
            .await
            .expect("create work session");
        let session_id = record.work_session_id().expect("work session").to_string();

        let updated = service
            .sync_title_from_agent_session(&session_id, "My session title", true)
            .await
            .expect("sync title");

        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0].title, "My session title");
        assert_eq!(updated[0].title_state.source, WorkTitleSource::User);
        assert!(updated[0].title_state.locked);
        assert_eq!(
            updated[0].title_state.subject_ref.as_deref(),
            Some(session_id.as_str())
        );
    }

    #[tokio::test]
    async fn user_locked_work_title_does_not_follow_session_title() {
        let service = service();
        let record = service
            .create(CreateWorkRequest {
                kind: WorkKind::MultiStep,
                title: "My named work".to_string(),
                objective: "Keep the user title".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("agentic")),
                live_app_id: None,
                title_state: None,
            })
            .await
            .expect("create work session");
        let session_id = record.work_session_id().expect("work session").to_string();

        let updated = service
            .sync_title_from_agent_session(&session_id, "Generated session title", false)
            .await
            .expect("sync title");
        let stored = service.get(&record.id).await.expect("stored work");

        assert!(updated.is_empty());
        assert_eq!(stored.title, "My named work");
        assert!(stored.title_state.locked);
        assert_eq!(stored.title_state.source, WorkTitleSource::User);
    }

    #[tokio::test]
    async fn manual_work_title_update_locks_future_session_sync() {
        let service = service();
        let record = service
            .create(CreateWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Coding".to_string(),
                objective: "Coding".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("agentic")),
                live_app_id: None,
                title_state: Some(WorkTitleState::template()),
            })
            .await
            .expect("create work session");
        let session_id = record.work_session_id().expect("work session").to_string();

        let renamed = service
            .update(
                &record.id,
                UpdateWorkRequest {
                    title: Some("My custom work title".to_string()),
                    ..Default::default()
                },
            )
            .await
            .expect("rename work");
        assert_eq!(renamed.title_state.source, WorkTitleSource::User);
        assert!(renamed.title_state.locked);

        let updated = service
            .sync_title_from_agent_session(&session_id, "Generated session title", false)
            .await
            .expect("sync title");
        let stored = service.get(&record.id).await.expect("stored work");

        assert!(updated.is_empty());
        assert_eq!(stored.title, "My custom work title");
    }

    #[tokio::test]
    async fn live_app_work_title_can_follow_live_app_name() {
        let service = service();
        let record = service
            .create(CreateWorkRequest {
                kind: WorkKind::AppWorkflow,
                title: "Old app name".to_string(),
                objective: "Run the app workflow".to_string(),
                scope: WorkScope::System,
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::LiveApp,
                assignment: None,
                live_app_id: Some("live-app-1".to_string()),
                title_state: None,
            })
            .await
            .expect("create live app work");

        assert_eq!(record.title_state.source, WorkTitleSource::LiveApp);
        assert_eq!(
            record.title_state.subject_ref.as_deref(),
            Some("live-app-1")
        );

        let updated = service
            .sync_title_from_live_app("live-app-1", "Expense Tracker")
            .await
            .expect("sync live app title");

        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0].title, "Expense Tracker");
        assert_eq!(updated[0].title_state.source, WorkTitleSource::LiveApp);
    }

    #[tokio::test]
    async fn dispatch_new_creates_delegated_work() {
        let service = service();
        let parent = service
            .create(CreateWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Parent".to_string(),
                objective: "Coordinate the effort".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkCenter,
                assignment: None,
                live_app_id: None,
                title_state: None,
            })
            .await
            .expect("parent");

        let response = service
            .dispatch_new(DispatchNewWorkRequest {
                parent_work_id: parent.id.clone(),
                kind: WorkKind::DelegatedWork,
                title: "Child".to_string(),
                objective: "Investigate auth".to_string(),
                assignment: WorkAssignmentRef::agent("agentic"),
                instructions: "Check auth flow".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                surface_policy: PrimarySurfacePolicy::WorkSession,
                start: true,
            })
            .await
            .expect("dispatch");

        assert_eq!(response.work.kind, WorkKind::DelegatedWork);
        assert!(response.execution_binding_id.is_some());
        let refreshed_parent = service.get(&parent.id).await.expect("parent");
        assert_eq!(refreshed_parent.execution_bindings.len(), 1);
    }

    #[tokio::test]
    async fn start_creates_work_session_and_agent_session_run_with_turn_id() {
        let service = service();
        let response = service
            .start(StartWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Builder task".to_string(),
                objective: "Confirm the builder task exists".to_string(),
                instructions: "Confirm the task has been created.".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("agentic")),
                live_app_id: None,
                idempotency_key: None,
            })
            .await
            .expect("start work");

        assert_eq!(response.work.status, WorkStatus::Active);
        assert_eq!(
            response.turn_id,
            format!("turn_{}", response.work.id.as_str())
        );
        assert!(response.work.work_session_id().is_some());
        assert!(response.work.execution_bindings.iter().any(|binding| {
            matches!(
                &binding.source,
                WorkExecutionSource::AgentSessionRun {
                    turn_id: Some(turn_id),
                    ..
                } if turn_id == &response.turn_id
            )
        }));
    }

    #[tokio::test]
    async fn completed_multi_step_agent_session_turn_returns_work_to_active() {
        let service = service();
        let response = service
            .start(StartWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Complete me".to_string(),
                objective: "Complete the run".to_string(),
                instructions: "Finish quickly.".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("agentic")),
                live_app_id: None,
                idempotency_key: None,
            })
            .await
            .expect("start work");

        let completed = service
            .mark_agent_session_turn_completed(&response.turn_id)
            .await
            .expect("mark completed")
            .expect("matched work");

        assert_eq!(completed.status, WorkStatus::Active);
        assert!(completed
            .execution_bindings
            .iter()
            .any(|binding| { binding.status == WorkExecutionBindingStatus::Completed }));
    }

    #[tokio::test]
    async fn completed_one_shot_agent_session_turn_completes_work() {
        let service = service();
        let response = service
            .start(StartWorkRequest {
                kind: WorkKind::OneShot,
                title: "Answer once".to_string(),
                objective: "Answer the question".to_string(),
                instructions: "Answer briefly.".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("agentic")),
                live_app_id: None,
                idempotency_key: None,
            })
            .await
            .expect("start work");

        let completed = service
            .mark_agent_session_turn_completed(&response.turn_id)
            .await
            .expect("mark completed")
            .expect("matched work");

        assert_eq!(completed.status, WorkStatus::Completed);
    }

    #[tokio::test]
    async fn direct_bound_session_turn_creates_agent_session_run_binding() {
        let service = service();
        let record = service
            .create(CreateWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Continue directly".to_string(),
                objective: "Allow direct session continuation".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("agentic")),
                live_app_id: None,
                title_state: Some(WorkTitleState::template()),
            })
            .await
            .expect("create work session");

        let session_id = record.work_session_id().expect("work session").to_string();
        let updated = service
            .mark_agent_session_turn_started(&session_id, "direct-turn")
            .await
            .expect("mark started")
            .expect("matched work");

        assert_eq!(updated.status, WorkStatus::Active);
        assert!(updated.execution_bindings.iter().any(|binding| {
            binding.status == WorkExecutionBindingStatus::Running
                && matches!(
                    &binding.source,
                    WorkExecutionSource::AgentSessionRun {
                        session_id: binding_session_id,
                        turn_id: Some(turn_id),
                    } if binding_session_id == &session_id && turn_id == "direct-turn"
                )
        }));
    }

    #[tokio::test]
    async fn tool_confirmation_marks_bound_work_waiting_user() {
        let service = service();
        let response = service
            .start(StartWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Needs confirmation".to_string(),
                objective: "Wait for user confirmation".to_string(),
                instructions: "Ask for confirmation.".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("agentic")),
                live_app_id: None,
                idempotency_key: None,
            })
            .await
            .expect("start work");

        let waiting = service
            .mark_agent_session_turn_waiting_user(&response.turn_id)
            .await
            .expect("mark waiting")
            .expect("matched work");

        assert_eq!(waiting.status, WorkStatus::WaitingUser);
        assert!(waiting.execution_bindings.iter().any(|binding| {
            binding.status == WorkExecutionBindingStatus::WaitingUser
                && matches!(
                    &binding.source,
                    WorkExecutionSource::AgentSessionRun {
                        turn_id: Some(turn_id),
                        ..
                    } if turn_id == &response.turn_id
                )
        }));
    }
}
