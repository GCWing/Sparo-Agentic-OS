use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::app_platform::{
    get_installed_product_app_by_lock, seed_builtin_product_app_packages, ComponentKind,
};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::try_get_path_manager_arc;

use super::assignment::{WorkAssignmentKind, WorkAssignmentRef};
use super::execution_binding::{
    WorkExecutionAppBuilderContext, WorkExecutionBinding, WorkExecutionBindingStatus,
    WorkExecutionSource,
};
use super::execution_graph::{
    WorkArtifactNode, WorkBuilderFactCheck, WorkBuilderFactStatus, WorkBuilderIssue,
    WorkBuilderIssueOrigin, WorkBuilderIssueStatus, WorkBuilderPreviewKind,
    WorkBuilderPreviewResult, WorkBuilderPreviewSource, WorkBuilderValidationResult,
    WorkBuilderValidationTargetKind, WorkExecutionGraph, WorkRuntimeIssue,
    WorkRuntimeIssueSeverity, WorkRuntimeLog, WorkRuntimeLogLevel, WorkRuntimeRun,
    WorkRuntimeRunStatus,
};
use super::hooks::{
    WorkCleanupReport, WorkDeleteOptions, WorkLifecycleHookBus, WorkLifecycleHookContext,
};
use super::ids::WorkId;
use super::lifecycle::WorkSummary;
use super::record::{
    AgentSessionRef, ArtifactRef, RuntimeInstanceRef, WorkDelegationContext, WorkOwnerRef,
    WorkRecord,
};
use super::runtime_bridge::{
    CreateWorkSessionRequest, NoopWorkRuntimeBridge, WorkRuntimeBridge, WorkSessionAdvanceRequest,
};
use super::store::WorkStore;
use super::subject::{
    WorkAppIntent, WorkAppRef, WorkAppRelation, WorkComponentIntent, WorkComponentRef, WorkSubject,
};
use super::surface::WorkSurfaceRef;
use super::title::{WorkTitleSource, WorkTitleState};
use super::types::{WorkKind, WorkScope, WorkStatus, WorkVisibility};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrimarySurfacePolicy {
    WorkCenter,
    WorkSession,
    ApplicationSurface,
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
    pub subject: WorkSubject,
    #[serde(default)]
    pub app_refs: Vec<WorkAppRelation>,
    pub scope: WorkScope,
    #[serde(default)]
    pub visibility: WorkVisibility,
    #[serde(default = "default_start_primary_surface_policy")]
    pub primary_surface_policy: PrimarySurfacePolicy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_surface: Option<WorkSurfaceRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignment: Option<WorkAssignmentRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_state: Option<WorkTitleState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delegation: Option<WorkDelegationContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartWorkRequest {
    pub kind: WorkKind,
    pub title: String,
    pub objective: String,
    pub instructions: String,
    pub subject: WorkSubject,
    #[serde(default)]
    pub app_refs: Vec<WorkAppRelation>,
    pub scope: WorkScope,
    #[serde(default)]
    pub visibility: WorkVisibility,
    #[serde(default)]
    pub primary_surface_policy: PrimarySurfacePolicy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignment: Option<WorkAssignmentRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<WorkOwnerRef>,
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
pub struct LinkSessionToWorkRequest {
    pub work_id: WorkId,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<WorkSurfaceRef>,
    #[serde(default)]
    pub set_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveAppWorkRequest {
    pub app: WorkAppRef,
    #[serde(default)]
    pub intent: WorkAppIntent,
    pub title: String,
    pub objective: String,
    pub scope: WorkScope,
    #[serde(default)]
    pub visibility: WorkVisibility,
    #[serde(default = "default_app_primary_surface_policy")]
    pub primary_surface_policy: PrimarySurfacePolicy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_surface: Option<WorkSurfaceRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignment: Option<WorkAssignmentRef>,
    #[serde(default)]
    pub app_refs: Vec<WorkAppRelation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveAppWorkResponse {
    pub work: WorkRecord,
    pub created: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveComponentWorkRequest {
    pub component: WorkComponentRef,
    #[serde(default)]
    pub intent: WorkComponentIntent,
    pub title: String,
    pub objective: String,
    pub scope: WorkScope,
    #[serde(default)]
    pub visibility: WorkVisibility,
    #[serde(default)]
    pub primary_surface_policy: PrimarySurfacePolicy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignment: Option<WorkAssignmentRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveComponentWorkResponse {
    pub work: WorkRecord,
    pub created: bool,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteWorkResponse {
    pub deleted: bool,
    #[serde(default)]
    pub cleanup_report: WorkCleanupReport,
}

const MAX_WORK_RUNTIME_ISSUES: usize = 200;
const MAX_WORK_RUNTIME_LOGS: usize = 500;

#[derive(Clone)]
pub struct WorkService {
    store: Arc<dyn WorkStore>,
    runtime_bridge: Arc<dyn WorkRuntimeBridge>,
    hook_bus: WorkLifecycleHookBus,
}

impl WorkService {
    pub fn new(store: Arc<dyn WorkStore>) -> Self {
        Self {
            store,
            runtime_bridge: Arc::new(NoopWorkRuntimeBridge),
            hook_bus: WorkLifecycleHookBus::default_handlers(),
        }
    }

    pub fn with_runtime_bridge(
        store: Arc<dyn WorkStore>,
        runtime_bridge: Arc<dyn WorkRuntimeBridge>,
    ) -> Self {
        Self {
            store,
            runtime_bridge,
            hook_bus: WorkLifecycleHookBus::default_handlers(),
        }
    }

    pub fn with_lifecycle_hooks(
        store: Arc<dyn WorkStore>,
        runtime_bridge: Arc<dyn WorkRuntimeBridge>,
        hook_bus: WorkLifecycleHookBus,
    ) -> Self {
        Self {
            store,
            runtime_bridge,
            hook_bus,
        }
    }

    pub async fn list(&self) -> CoreResult<Vec<WorkRecord>> {
        self.store.list().await
    }

    pub async fn reconcile_orphaned_executions(&self) -> CoreResult<Vec<WorkRecord>> {
        let now = now_millis();
        let mut reconciled = Vec::new();

        for mut record in self.store.list().await? {
            let mut interrupted = false;
            for binding in &mut record.execution_bindings {
                if binding.is_running() {
                    binding.set_status(WorkExecutionBindingStatus::Interrupted, now);
                    interrupted = true;
                }
            }

            if !interrupted {
                continue;
            }

            if record.status != WorkStatus::Archived && record.status != WorkStatus::Completed {
                let next_status = interrupted_turn_work_status(&record);
                record.set_status(next_status, "orphaned execution interrupted", now);
            } else {
                record.touch(now);
            }
            self.store.put(&record).await?;
            reconciled.push(record);
        }

        Ok(reconciled)
    }

    pub async fn get(&self, id: &WorkId) -> CoreResult<WorkRecord> {
        self.store
            .get(id)
            .await?
            .ok_or_else(|| CoreError::NotFound(format!("Work not found: {}", id)))
    }

    pub async fn delete(&self, id: &WorkId) -> CoreResult<DeleteWorkResponse> {
        self.delete_with_options(id, WorkDeleteOptions::default())
            .await
    }

    pub async fn delete_with_options(
        &self,
        id: &WorkId,
        options: WorkDeleteOptions,
    ) -> CoreResult<DeleteWorkResponse> {
        let Some(record) = self.store.get(id).await? else {
            return Ok(DeleteWorkResponse {
                deleted: false,
                cleanup_report: WorkCleanupReport {
                    work_id: id.as_str().to_string(),
                    items: Vec::new(),
                },
            });
        };

        let context =
            WorkLifecycleHookContext::new(record.clone(), Arc::clone(&self.runtime_bridge));
        let plan = self.hook_bus.plan_delete(&context, options).await?;
        let cleanup_report = self.hook_bus.execute_delete(&context, plan).await;
        if cleanup_report.has_required_failures() {
            return Err(CoreError::service(format!(
                "Failed to cleanup required Work resources before deleting work_id={}",
                id
            )));
        }

        Ok(DeleteWorkResponse {
            deleted: self.store.delete(id).await?,
            cleanup_report,
        })
    }

    pub async fn resolve_app_work(
        &self,
        request: ResolveAppWorkRequest,
    ) -> CoreResult<ResolveAppWorkResponse> {
        validate_required("app.app_id", &request.app.app_id)?;
        validate_required("title", &request.title)?;
        validate_required("objective", &request.objective)?;

        let subject = WorkSubject::App {
            app: request.app.clone(),
            intent: request.intent,
        };

        let mut candidates = self
            .store
            .list()
            .await?
            .into_iter()
            .filter(|work| {
                work.scope == request.scope
                    && work.references_app(&request.app)
                    && matches!(
                        work.subject.app_intent(),
                        Some(intent) if intent == request.intent
                    )
                    && is_resumable_app_work_status(work.status)
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| {
            app_work_status_rank(right.status)
                .cmp(&app_work_status_rank(left.status))
                .then_with(|| right.updated_at.cmp(&left.updated_at))
                .then_with(|| left.id.cmp(&right.id))
        });
        if let Some(work) = candidates.into_iter().next() {
            return Ok(ResolveAppWorkResponse {
                work,
                created: false,
            });
        }

        let work = self
            .create(CreateWorkRequest {
                kind: WorkKind::AppWorkflow,
                title: request.title,
                objective: request.objective,
                subject,
                app_refs: request.app_refs,
                scope: request.scope,
                visibility: request.visibility,
                primary_surface_policy: request.primary_surface_policy,
                primary_surface: request.primary_surface,
                assignment: request.assignment,
                title_state: None,
                delegation: None,
            })
            .await?;
        Ok(ResolveAppWorkResponse {
            work,
            created: true,
        })
    }

    pub async fn resolve_component_work(
        &self,
        request: ResolveComponentWorkRequest,
    ) -> CoreResult<ResolveComponentWorkResponse> {
        validate_required("component.component_id", &request.component.component_id)?;
        validate_required(
            "component.component_kind",
            &request.component.component_kind,
        )?;
        validate_required("title", &request.title)?;
        validate_required("objective", &request.objective)?;

        let subject = WorkSubject::Component {
            component: request.component.clone(),
            intent: request.intent,
        };

        let mut candidates = self
            .store
            .list()
            .await?
            .into_iter()
            .filter(|work| {
                work.scope == request.scope
                    && work.references_component(&request.component)
                    && matches!(
                        work.subject.component_intent(),
                        Some(intent) if intent == request.intent
                    )
                    && is_resumable_app_work_status(work.status)
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| {
            app_work_status_rank(right.status)
                .cmp(&app_work_status_rank(left.status))
                .then_with(|| right.updated_at.cmp(&left.updated_at))
                .then_with(|| left.id.cmp(&right.id))
        });
        if let Some(work) = candidates.into_iter().next() {
            return Ok(ResolveComponentWorkResponse {
                work,
                created: false,
            });
        }

        let work = self
            .create(CreateWorkRequest {
                kind: WorkKind::AppWorkflow,
                title: request.title,
                objective: request.objective,
                subject,
                app_refs: Vec::new(),
                scope: request.scope,
                visibility: request.visibility,
                primary_surface_policy: request.primary_surface_policy,
                primary_surface: None,
                assignment: request.assignment,
                title_state: None,
                delegation: None,
            })
            .await?;
        Ok(ResolveComponentWorkResponse {
            work,
            created: true,
        })
    }

    pub async fn create(&self, request: CreateWorkRequest) -> CoreResult<WorkRecord> {
        validate_required("title", &request.title)?;
        validate_required("objective", &request.objective)?;

        let now = now_millis();
        let work_id = WorkId::generate();
        let primary_surface = match request.primary_surface {
            Some(surface) => {
                validate_surface_ref("primary_surface", &surface)?;
                surface
            }
            None => match request.primary_surface_policy {
                PrimarySurfacePolicy::WorkCenter | PrimarySurfacePolicy::WorkSession => {
                    WorkSurfaceRef::WorkCenter {
                        work_id: work_id.clone(),
                    }
                }
                PrimarySurfacePolicy::ApplicationSurface => {
                    application_surface_for_product_app_subject(&request.subject).await?
                }
            },
        };

        let title_state = request.title_state.clone().unwrap_or_else(|| {
            if let WorkSurfaceRef::ApplicationSurface { product_app_id, .. } = &primary_surface {
                WorkTitleState::application_surface(product_app_id)
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
            request.subject,
            request.app_refs,
            request.scope,
            primary_surface,
            now,
        );
        record.assignment = request.assignment;
        record.title_state = title_state;
        record.delegation = request.delegation;

        match request.primary_surface_policy {
            PrimarySurfacePolicy::WorkSession => {
                self.ensure_work_session(&mut record, None).await?;
            }
            PrimarySurfacePolicy::ApplicationSurface => {
                if !matches!(
                    &record.primary_surface,
                    WorkSurfaceRef::ApplicationSurface { .. }
                ) {
                    return Err(CoreError::validation(
                        "primary_surface.kind=application_surface is required when primary_surface_policy=application_surface",
                    ));
                }
                let Some(app_ref) = record.subject.app_ref().cloned() else {
                    return Err(CoreError::validation(
                        "subject.kind=app is required when primary_surface_policy=application_surface",
                    ));
                };
                if let Some(runtime_instance) = RuntimeInstanceRef::product_app_application_surface(
                    &record.id,
                    &app_ref,
                    &record.primary_surface,
                ) {
                    record.bind_runtime_instance(runtime_instance, now);
                }
            }
            PrimarySurfacePolicy::WorkCenter => {}
        }

        self.store.put(&record).await?;
        Ok(record)
    }

    pub async fn link_session_to_work(
        &self,
        request: LinkSessionToWorkRequest,
    ) -> CoreResult<WorkRecord> {
        validate_required("session_id", &request.session_id)?;
        let now = now_millis();
        let mut record = self.get(&request.work_id).await?;

        if !record
            .session_refs
            .iter()
            .any(|session_ref| session_ref.session_id == request.session_id)
        {
            record.session_refs.push(AgentSessionRef {
                session_id: request.session_id.clone(),
                workspace_path: request.workspace_path,
            });
        }

        let surface = request.surface.unwrap_or(WorkSurfaceRef::AgentSession {
            session_id: request.session_id,
        });
        record.bind_surface(surface, request.set_primary, now);
        self.store.put(&record).await?;
        Ok(record)
    }

    pub async fn update(&self, id: &WorkId, request: UpdateWorkRequest) -> CoreResult<WorkRecord> {
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
    ) -> CoreResult<Vec<WorkRecord>> {
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

    pub async fn sync_title_from_application_surface(
        &self,
        application_id: &str,
        title: &str,
    ) -> CoreResult<Vec<WorkRecord>> {
        let application_id = application_id.trim();
        let title = title.trim();
        if application_id.is_empty() || title.is_empty() {
            return Ok(Vec::new());
        }

        let now = now_millis();
        let mut updated = Vec::new();
        for mut record in self.store.list().await? {
            if !work_title_can_follow_application_surface(&record, application_id) {
                continue;
            }

            let next_title_state = WorkTitleState::application_surface(application_id.to_string());
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
    ) -> CoreResult<WorkRecord> {
        let now = now_millis();
        let mut record = self.get(id).await?;
        record.bind_surface(surface, set_primary, now);
        self.store.put(&record).await?;
        Ok(record)
    }

    pub async fn execution_graph(&self, id: &WorkId) -> CoreResult<WorkExecutionGraph> {
        let record = self.get(id).await?;
        Ok(WorkExecutionGraph::from_parts(
            record.id.clone(),
            record.updated_at,
            record.execution_bindings.clone(),
            record.runtime_instances.clone(),
            record.runtime_runs.clone(),
            record.runtime_issues.clone(),
            record.runtime_logs.clone(),
            artifact_nodes_for_record(&record),
            record.builder_preview_results.clone(),
            record.builder_validation_results.clone(),
            record.builder_issues.clone(),
        ))
    }

    pub async fn bind_artifact(
        &self,
        id: &WorkId,
        artifact: ArtifactRef,
    ) -> CoreResult<WorkRecord> {
        let now = now_millis();
        let mut record = self.get(id).await?;
        if let Some(existing) = record
            .artifact_refs
            .iter()
            .position(|item| item.id == artifact.id)
            .and_then(|index| record.artifact_refs.get_mut(index))
        {
            if existing.label.is_none() {
                existing.label = artifact.label;
            }
            if existing.uri.is_none() {
                existing.uri = artifact.uri;
            }
            if existing.runtime_provenance.is_none() {
                existing.runtime_provenance = artifact.runtime_provenance;
            }
        } else {
            record.artifact_refs.push(artifact);
        }
        record.touch(now);
        self.store.put(&record).await?;
        Ok(record)
    }

    pub async fn bind_runtime_run(
        &self,
        id: &WorkId,
        runtime_instance_id: String,
        run_id: String,
        component_id: String,
        action: String,
        status: WorkExecutionBindingStatus,
    ) -> CoreResult<WorkRecord> {
        validate_required("runtime_instance_id", &runtime_instance_id)?;
        validate_required("run_id", &run_id)?;
        validate_required("component_id", &component_id)?;
        validate_required("action", &action)?;

        let now = now_millis();
        self.record_runtime_run(
            id,
            WorkRuntimeRun {
                run_id,
                runtime_instance_id,
                component_id,
                component_kind: "component".to_string(),
                action,
                status: execution_binding_status_to_runtime_run_status(status),
                started_at: now,
                updated_at: now,
                artifact_count: 0,
                event_count: 0,
                error: None,
            },
        )
        .await
    }

    pub async fn record_runtime_run(
        &self,
        id: &WorkId,
        mut run: WorkRuntimeRun,
    ) -> CoreResult<WorkRecord> {
        validate_required("runtime_instance_id", &run.runtime_instance_id)?;
        validate_required("run_id", &run.run_id)?;
        validate_required("component_id", &run.component_id)?;
        validate_required("component_kind", &run.component_kind)?;
        validate_required("action", &run.action)?;

        let now = now_millis();
        if run.started_at <= 0 {
            run.started_at = now;
        }
        if run.updated_at <= 0 {
            run.updated_at = run.started_at;
        }
        let binding_time = run.updated_at.max(run.started_at);
        let binding_status = runtime_run_status_to_execution_binding_status(run.status);
        let runtime_instance_id = run.runtime_instance_id.clone();
        let run_id = run.run_id.clone();
        let component_id = run.component_id.clone();
        let action = run.action.clone();
        let mut record = self.get(id).await?;
        if let Some(existing) = record
            .runtime_runs
            .iter_mut()
            .find(|existing| existing.run_id == run.run_id)
        {
            *existing = run;
        } else {
            record.runtime_runs.push(run);
        }

        let mut matched_binding = false;
        for binding in &mut record.execution_bindings {
            if let WorkExecutionSource::RuntimeInstanceRun {
                run_id: binding_run_id,
                ..
            } = &binding.source
            {
                if binding_run_id == &run_id {
                    binding.set_status(binding_status, binding_time);
                    matched_binding = true;
                    break;
                }
            }
        }

        if !matched_binding {
            record.execution_bindings.push(WorkExecutionBinding::new(
                WorkExecutionSource::RuntimeInstanceRun {
                    runtime_instance_id,
                    run_id,
                    component_id,
                    action,
                },
                binding_status,
                binding_time,
            ));
        }

        if matches!(
            binding_status,
            WorkExecutionBindingStatus::Queued
                | WorkExecutionBindingStatus::Running
                | WorkExecutionBindingStatus::WaitingUser
        ) && !matches!(record.status, WorkStatus::Archived)
        {
            record.set_status(WorkStatus::Running, "runtime instance run active", now);
        }

        record.touch(now);
        self.store.put(&record).await?;
        Ok(record)
    }

    pub async fn record_runtime_issue(
        &self,
        id: &WorkId,
        issue: WorkRuntimeIssue,
    ) -> CoreResult<WorkRecord> {
        validate_required("runtime_instance_id", &issue.runtime_instance_id)?;
        validate_required("product_app_id", &issue.product_app_id)?;
        validate_required("component_id", &issue.component_id)?;
        validate_required("message", &issue.message)?;

        let now = now_millis();
        let mut record = self.get(id).await?;
        apply_runtime_issue_to_builder_facts(&mut record, &issue);
        record.runtime_issues.push(issue);
        trim_runtime_issues(&mut record.runtime_issues);
        refresh_release_rehearsal_preview_result(&mut record, now);
        record.touch(now);
        self.store.put(&record).await?;
        Ok(record)
    }

    pub async fn record_runtime_log(
        &self,
        id: &WorkId,
        log: WorkRuntimeLog,
    ) -> CoreResult<WorkRecord> {
        validate_required("runtime_instance_id", &log.runtime_instance_id)?;
        validate_required("product_app_id", &log.product_app_id)?;
        validate_required("component_id", &log.component_id)?;
        validate_required("category", &log.category)?;
        validate_required("message", &log.message)?;

        let now = now_millis();
        let mut record = self.get(id).await?;
        apply_runtime_log_to_builder_facts(&mut record, &log);
        record.runtime_logs.push(log);
        trim_runtime_logs(&mut record.runtime_logs);
        refresh_release_rehearsal_preview_result(&mut record, now);
        record.touch(now);
        self.store.put(&record).await?;
        Ok(record)
    }

    pub async fn record_builder_preview_result(
        &self,
        id: &WorkId,
        mut preview_result: WorkBuilderPreviewResult,
    ) -> CoreResult<WorkRecord> {
        validate_required("preview_result.id", &preview_result.id)?;
        if preview_result.work_id != *id {
            return Err(CoreError::validation(format!(
                "preview_result.work_id={} does not match work_id={}",
                preview_result.work_id, id
            )));
        }

        let now = now_millis();
        if preview_result.observed_at <= 0 {
            preview_result.observed_at = now;
        }
        let refresh_release_rehearsal = preview_result.kind
            != WorkBuilderPreviewKind::ReleaseRehearsal
            || preview_result.source != WorkBuilderPreviewSource::ReleaseRehearsal;
        let mut record = self.get(id).await?;
        apply_preview_result_to_builder_issues(&mut record, &preview_result);
        reconcile_builder_issues_for_preview_result(&mut record, &mut preview_result, now);
        upsert_builder_preview_result(&mut record, preview_result);
        if refresh_release_rehearsal {
            refresh_release_rehearsal_preview_result(&mut record, now);
        }
        record.touch(now);
        self.store.put(&record).await?;
        Ok(record)
    }

    pub async fn record_builder_issue(
        &self,
        id: &WorkId,
        issue: WorkBuilderIssue,
    ) -> CoreResult<WorkRecord> {
        validate_required("builder_issue.id", &issue.id)?;
        validate_required("builder_issue.app_id", &issue.app_id)?;
        validate_required("builder_issue.message", &issue.message)?;

        let now = now_millis();
        let runtime_instance_id = issue.runtime_instance_id.clone();
        let mut record = self.get(id).await?;
        upsert_builder_issue(&mut record, issue);
        if let Some(runtime_instance_id) = runtime_instance_id.as_deref() {
            refresh_builder_preview_result_for_runtime_instance(&mut record, runtime_instance_id);
        }
        refresh_release_rehearsal_preview_result(&mut record, now);
        record.touch(now);
        self.store.put(&record).await?;
        Ok(record)
    }

    pub async fn record_builder_validation_result(
        &self,
        id: &WorkId,
        mut validation_result: WorkBuilderValidationResult,
    ) -> CoreResult<WorkRecord> {
        validate_required("validation_result.id", &validation_result.id)?;
        validate_required("validation_result.tool_name", &validation_result.tool_name)?;
        if validation_result.work_id != *id {
            return Err(CoreError::validation(format!(
                "validation_result.work_id={} does not match work_id={}",
                validation_result.work_id, id
            )));
        }
        match validation_result.target_kind {
            WorkBuilderValidationTargetKind::ProductApp => {
                validate_required(
                    "validation_result.app_id",
                    validation_result.app_id.as_deref().unwrap_or_default(),
                )?;
            }
            WorkBuilderValidationTargetKind::Component => {
                validate_required(
                    "validation_result.component_id",
                    validation_result
                        .component_id
                        .as_deref()
                        .unwrap_or_default(),
                )?;
                validate_required(
                    "validation_result.component_kind",
                    validation_result
                        .component_kind
                        .as_deref()
                        .unwrap_or_default(),
                )?;
            }
        }

        let now = now_millis();
        if validation_result.observed_at <= 0 {
            validation_result.observed_at = now;
        }
        let mut record = self.get(id).await?;
        apply_validation_result_to_builder_issues(&mut record, &validation_result, now);
        refresh_capability_preview_result_for_validation(&mut record, &validation_result);
        upsert_builder_validation_result(&mut record, validation_result);
        refresh_release_rehearsal_preview_result(&mut record, now);
        record.touch(now);
        self.store.put(&record).await?;
        Ok(record)
    }

    pub async fn update_builder_issue_status(
        &self,
        id: &WorkId,
        issue_id: &str,
        status: WorkBuilderIssueStatus,
    ) -> CoreResult<WorkRecord> {
        validate_required("issue_id", issue_id)?;

        let now = now_millis();
        let mut record = self.get(id).await?;
        let runtime_instance_id = {
            let issue = record
                .builder_issues
                .iter_mut()
                .find(|issue| issue.id == issue_id)
                .ok_or_else(|| {
                    CoreError::NotFound(format!("Builder issue not found: {}", issue_id))
                })?;
            issue.status = status;
            issue.resolved_at = match status {
                WorkBuilderIssueStatus::Open
                | WorkBuilderIssueStatus::StillOpen
                | WorkBuilderIssueStatus::Regressed => None,
                WorkBuilderIssueStatus::Acknowledged | WorkBuilderIssueStatus::Fixed => Some(now),
            };
            issue.runtime_instance_id.clone()
        };
        if let Some(runtime_instance_id) = runtime_instance_id.as_deref() {
            refresh_builder_preview_result_for_runtime_instance(&mut record, runtime_instance_id);
        }
        refresh_release_rehearsal_preview_result(&mut record, now);
        record.touch(now);
        self.store.put(&record).await?;
        Ok(record)
    }

    pub async fn dispatch(&self, request: DispatchWorkRequest) -> CoreResult<DispatchWorkResponse> {
        match request {
            DispatchWorkRequest::DispatchNew(request) => self.dispatch_new(request).await,
        }
    }

    pub async fn start(&self, request: StartWorkRequest) -> CoreResult<StartWorkResponse> {
        validate_required("instructions", &request.instructions)?;
        if request.primary_surface_policy != PrimarySurfacePolicy::WorkSession {
            return Err(CoreError::validation(
                "Work action=start currently requires primary_surface_policy=work_session",
            ));
        }

        let assignment = request
            .assignment
            .unwrap_or_else(|| WorkAssignmentRef::agent("Runno"));
        if assignment.kind != WorkAssignmentKind::Agent {
            return Err(CoreError::validation(
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
            return Err(CoreError::validation(
                "assignment.agent_type is required for Work action=start",
            ));
        }

        let delegation = WorkDelegationContext {
            owner: request.owner,
            instructions: Some(request.instructions.clone()),
        };

        let work = self
            .create(CreateWorkRequest {
                kind: request.kind,
                title: request.title,
                objective: request.objective,
                subject: request.subject,
                app_refs: request.app_refs,
                scope: request.scope,
                visibility: request.visibility,
                primary_surface_policy: request.primary_surface_policy,
                primary_surface: None,
                assignment: Some(assignment),
                title_state: Some(WorkTitleState::agent()),
                delegation: Some(delegation),
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
    ) -> CoreResult<DispatchWorkResponse> {
        let parent = self.get(&request.parent_work_id).await?;
        let mut child = self
            .create(CreateWorkRequest {
                kind: request.kind,
                title: request.title,
                objective: request.objective,
                subject: parent.subject.clone(),
                app_refs: parent.app_refs.clone(),
                scope: request.scope,
                visibility: WorkVisibility::Primary,
                primary_surface_policy: request.surface_policy,
                primary_surface: None,
                assignment: Some(request.assignment),
                title_state: Some(WorkTitleState::agent()),
                delegation: parent.delegation.clone(),
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

    pub async fn advance(&self, request: AdvanceWorkRequest) -> CoreResult<AdvanceWorkResponse> {
        validate_required("instructions", &request.instructions)?;
        let now = now_millis();
        let mut record = self.get(&request.work_id).await?;
        self.ensure_work_session(&mut record, None).await?;

        let session_id = record
            .work_session_id()
            .ok_or_else(|| CoreError::service("WorkSession was not bound"))?
            .to_string();
        let agent_type = record
            .assignment
            .as_ref()
            .and_then(|assignment| assignment.agent_type.clone())
            .unwrap_or_else(|| "Runno".to_string());
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

    pub async fn control(&self, request: ControlWorkRequest) -> CoreResult<ControlWorkResponse> {
        let now = now_millis();
        let mut record = self.get(&request.work_id).await?;
        match request.action {
            ControlWorkAction::Pause => record.set_status(WorkStatus::Paused, "paused", now),
            ControlWorkAction::Resume => record.set_status(WorkStatus::Active, "resumed", now),
            ControlWorkAction::Archive => record.set_status(WorkStatus::Archived, "archived", now),
            ControlWorkAction::Reopen => record.set_status(WorkStatus::Active, "reopened", now),
            ControlWorkAction::CancelCurrentExecution => {
                let mut cancelled_binding = false;
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
                    cancelled_binding = true;
                }
                if cancelled_binding {
                    let next_status = cancelled_turn_work_status(&record);
                    record.set_status(next_status, "current execution cancelled", now);
                } else {
                    record.touch(now);
                }
            }
        }
        self.store.put(&record).await?;
        Ok(ControlWorkResponse { work: record })
    }

    pub async fn mark_agent_session_turn_completed(
        &self,
        turn_id: &str,
    ) -> CoreResult<Option<WorkRecord>> {
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
    ) -> CoreResult<Option<WorkRecord>> {
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
    ) -> CoreResult<Option<WorkRecord>> {
        self.mark_agent_session_turn_terminal(
            turn_id,
            WorkExecutionBindingStatus::Cancelled,
            WorkStatus::Cancelled,
            "agent session turn cancelled",
        )
        .await
    }

    pub async fn mark_agent_session_turn_started(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> CoreResult<Option<WorkRecord>> {
        self.mark_agent_session_turn_started_with_app_builder_context(session_id, turn_id, None)
            .await
    }

    pub async fn mark_agent_session_turn_started_with_app_builder_context(
        &self,
        session_id: &str,
        turn_id: &str,
        app_builder: Option<WorkExecutionAppBuilderContext>,
    ) -> CoreResult<Option<WorkRecord>> {
        let session_id = session_id.trim();
        let turn_id = turn_id.trim();
        if session_id.is_empty() || turn_id.is_empty() {
            return Ok(None);
        }

        let now = now_millis();
        if let Some(work_id) = app_builder
            .as_ref()
            .and_then(|context| context.work_id.clone())
        {
            if let Ok(mut record) = self.get(&work_id).await {
                ensure_agent_session_ref(&mut record, session_id, None);
                upsert_agent_session_run_binding(
                    &mut record,
                    session_id,
                    turn_id,
                    app_builder.clone(),
                    now,
                );
                if should_reopen_for_agent_session_activity(record.status) {
                    record.set_status(WorkStatus::Active, "agent session continued", now);
                } else {
                    record.touch(now);
                }
                self.store.put(&record).await?;
                return Ok(Some(record));
            }
        }

        for mut record in self.store.list().await? {
            if !work_references_agent_session(&record, session_id) {
                continue;
            }

            upsert_agent_session_run_binding(
                &mut record,
                session_id,
                turn_id,
                app_builder.clone(),
                now,
            );

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
    ) -> CoreResult<Option<WorkRecord>> {
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
    ) -> CoreResult<Option<WorkRecord>> {
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
    ) -> CoreResult<Option<WorkRecord>> {
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
    ) -> CoreResult<Option<WorkRecord>> {
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
            let mut fixed_issue_ids = Vec::new();
            for binding in &mut record.execution_bindings {
                if let WorkExecutionSource::AgentSessionRun {
                    turn_id: Some(binding_turn_id),
                    ..
                } = &binding.source
                {
                    if binding_turn_id == turn_id {
                        binding.set_status(binding_status, now);
                        matched = true;
                        if binding_status == WorkExecutionBindingStatus::Completed {
                            if let Some(context) = binding.app_builder.as_ref() {
                                fixed_issue_ids.push(context.issue_id.clone());
                            }
                        }
                    }
                }
            }

            if matched {
                if binding_status == WorkExecutionBindingStatus::Completed {
                    mark_builder_issues_fixed(&mut record, &fixed_issue_ids, now);
                }
                let has_running_binding = record
                    .execution_bindings
                    .iter()
                    .any(WorkExecutionBinding::is_running);
                if record.status != WorkStatus::Archived && !has_running_binding {
                    let next_status = match binding_status {
                        WorkExecutionBindingStatus::Completed => {
                            completed_turn_work_status(&record)
                        }
                        WorkExecutionBindingStatus::Cancelled => {
                            cancelled_turn_work_status(&record)
                        }
                        WorkExecutionBindingStatus::Interrupted => {
                            interrupted_turn_work_status(&record)
                        }
                        _ => work_status,
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

    pub async fn mark_agent_session_turn_work_message_queued(
        &self,
        turn_id: &str,
    ) -> CoreResult<Option<WorkRecord>> {
        let turn_id = turn_id.trim();
        if turn_id.is_empty() {
            return Ok(None);
        }

        let now = now_millis();
        for mut record in self.store.list().await? {
            let mut matched = false;
            for binding in &mut record.execution_bindings {
                if agent_session_binding_matches_turn(binding, turn_id) {
                    binding.mark_work_message_queued(now);
                    matched = true;
                }
            }

            if matched {
                record.touch(now);
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
    ) -> CoreResult<()> {
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
            .unwrap_or_else(|| "Runno".to_string());
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

async fn application_surface_for_product_app_subject(
    subject: &WorkSubject,
) -> CoreResult<WorkSurfaceRef> {
    let app = subject.app_ref().ok_or_else(|| {
        CoreError::validation(
            "subject.kind=app is required when primary_surface_policy=application_surface",
        )
    })?;
    validate_required("subject.app.app_id", &app.app_id)?;
    validate_required("subject.app.app_version", &app.app_version)?;
    validate_required(
        "subject.app.component_lock_digest",
        &app.component_lock_digest,
    )?;

    let path_manager = try_get_path_manager_arc()?;
    if let Err(error) = seed_builtin_product_app_packages(path_manager.as_ref()).await {
        log::warn!(
            "Failed to seed built-in Product App packages before Work surface resolution: {}",
            error
        );
    }

    let (resolved_app, _installed_lock_digest) = get_installed_product_app_by_lock(
        path_manager.as_ref(),
        &app.app_id,
        &app.app_version,
        &app.component_lock_digest,
    )
    .await?;

    let primary_surface = resolved_app.app.primary_surface.as_ref().ok_or_else(|| {
        CoreError::validation(format!(
            "Product App {}@{} does not declare a primary surface for application surface Work",
            app.app_id, app.app_version
        ))
    })?;
    let product_app_surface_id = primary_surface.component_id.clone();
    validate_required(
        "installed_product_app.primary_surface.component_id",
        &product_app_surface_id,
    )?;
    let surface_id = resolved_app
        .app
        .primary_surface
        .as_ref()
        .and_then(|surface| surface.surface_id.clone())
        .unwrap_or_else(|| "primary".to_string());
    validate_required(
        "installed_product_app.primary_surface.surface_id",
        &surface_id,
    )?;

    if !resolved_app.components.iter().any(|component| {
        component.kind == ComponentKind::Surface && component.id == product_app_surface_id
    }) {
        return Err(CoreError::validation(format!(
            "Product App {} lock does not resolve primary Product App surface {}",
            app.app_id, product_app_surface_id
        )));
    }

    Ok(WorkSurfaceRef::ApplicationSurface {
        product_app_id: app.app_id.clone(),
        product_app_surface_id,
        surface_id,
    })
}

fn validate_surface_ref(label: &str, surface: &WorkSurfaceRef) -> CoreResult<()> {
    match surface {
        WorkSurfaceRef::OsAgentHome {
            agentic_os_session_id,
        } => {
            if let Some(session_id) = agentic_os_session_id {
                validate_required(&format!("{label}.agentic_os_session_id"), session_id)?;
            }
        }
        WorkSurfaceRef::WorkSession { session_id }
        | WorkSurfaceRef::AgentSession { session_id } => {
            validate_required(&format!("{label}.session_id"), session_id)?;
        }
        WorkSurfaceRef::WorkCenter { work_id } => {
            validate_required(&format!("{label}.work_id"), work_id.as_str())?;
        }
        WorkSurfaceRef::ApplicationSurface {
            product_app_id,
            product_app_surface_id,
            surface_id,
        } => {
            validate_required(&format!("{label}.product_app_id"), product_app_id)?;
            validate_required(
                &format!("{label}.product_app_surface_id"),
                product_app_surface_id,
            )?;
            validate_required(&format!("{label}.surface_id"), surface_id)?;
        }
    }
    Ok(())
}

fn validate_required(field: &str, value: &str) -> CoreResult<()> {
    if value.trim().is_empty() {
        return Err(CoreError::validation(format!("{} cannot be empty", field)));
    }
    Ok(())
}

fn resolve_runtime_workspace_path(scope: &WorkScope) -> CoreResult<String> {
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

fn default_app_primary_surface_policy() -> PrimarySurfacePolicy {
    PrimarySurfacePolicy::ApplicationSurface
}

fn is_resumable_app_work_status(status: WorkStatus) -> bool {
    matches!(
        status,
        WorkStatus::Draft
            | WorkStatus::Active
            | WorkStatus::Running
            | WorkStatus::WaitingUser
            | WorkStatus::Blocked
            | WorkStatus::Paused
            | WorkStatus::Interrupted
    )
}

fn app_work_status_rank(status: WorkStatus) -> u8 {
    match status {
        WorkStatus::Running => 7,
        WorkStatus::WaitingUser | WorkStatus::Blocked => 6,
        WorkStatus::Active => 5,
        WorkStatus::Paused => 4,
        WorkStatus::Interrupted => 3,
        WorkStatus::Draft => 2,
        _ => 0,
    }
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

fn work_references_application_surface(record: &WorkRecord, application_id: &str) -> bool {
    record
        .subject
        .app_ref()
        .is_some_and(|app| app.matches_product_app_id(application_id))
        || record
            .app_refs
            .iter()
            .any(|relation| relation.app.matches_product_app_id(application_id))
        || record.surfaces.iter().any(|surface| match surface {
            WorkSurfaceRef::ApplicationSurface {
                product_app_id: surface_application_id,
                ..
            } => surface_application_id == application_id,
            _ => false,
        })
        || record
            .execution_bindings
            .iter()
            .any(|binding| match &binding.source {
                WorkExecutionSource::ApplicationAction {
                    application_id: source_application_id,
                    ..
                } => source_application_id == application_id,
                WorkExecutionSource::RuntimeInstanceRun {
                    runtime_instance_id,
                    ..
                } => record.runtime_instances.iter().any(|instance| {
                    instance.id == runtime_instance_id.as_str()
                        && instance.product_app_id == application_id
                }),
                _ => false,
            })
}

fn work_title_can_follow_application_surface(record: &WorkRecord, application_id: &str) -> bool {
    record
        .title_state
        .can_follow_application_surface(application_id)
        && work_references_application_surface(record, application_id)
}

fn ensure_agent_session_ref(
    record: &mut WorkRecord,
    session_id: &str,
    workspace_path: Option<String>,
) {
    if record
        .session_refs
        .iter()
        .any(|reference| reference.session_id == session_id)
    {
        return;
    }
    record.session_refs.push(AgentSessionRef {
        session_id: session_id.to_string(),
        workspace_path,
    });
}

fn upsert_agent_session_run_binding(
    record: &mut WorkRecord,
    session_id: &str,
    turn_id: &str,
    app_builder: Option<WorkExecutionAppBuilderContext>,
    now: i64,
) {
    for binding in &mut record.execution_bindings {
        if agent_session_binding_matches_turn(binding, turn_id) {
            binding.set_status(WorkExecutionBindingStatus::Running, now);
            if app_builder.is_some() {
                binding.app_builder = app_builder;
            }
            return;
        }
    }

    let mut binding = WorkExecutionBinding::new(
        WorkExecutionSource::AgentSessionRun {
            session_id: session_id.to_string(),
            turn_id: Some(turn_id.to_string()),
        },
        WorkExecutionBindingStatus::Running,
        now,
    );
    binding.app_builder = app_builder;
    record.execution_bindings.push(binding);
}

fn mark_builder_issues_fixed(record: &mut WorkRecord, issue_ids: &[String], now: i64) {
    let mut runtime_instance_ids = Vec::new();
    for issue_id in issue_ids {
        let Some(issue) = record
            .builder_issues
            .iter_mut()
            .find(|issue| issue.id == *issue_id)
        else {
            continue;
        };
        if issue.status == WorkBuilderIssueStatus::Fixed {
            continue;
        }
        issue.status = WorkBuilderIssueStatus::Fixed;
        issue.resolved_at = Some(now);
        if let Some(runtime_instance_id) = issue.runtime_instance_id.clone() {
            runtime_instance_ids.push(runtime_instance_id);
        }
    }

    runtime_instance_ids.sort();
    runtime_instance_ids.dedup();
    for runtime_instance_id in runtime_instance_ids {
        refresh_builder_preview_result_for_runtime_instance(record, &runtime_instance_id);
    }
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

fn cancelled_turn_work_status(record: &WorkRecord) -> WorkStatus {
    if record.kind == WorkKind::OneShot {
        WorkStatus::Cancelled
    } else {
        WorkStatus::Active
    }
}

fn interrupted_turn_work_status(record: &WorkRecord) -> WorkStatus {
    if record.kind == WorkKind::OneShot {
        WorkStatus::Interrupted
    } else {
        WorkStatus::Active
    }
}

fn artifact_nodes_for_record(record: &WorkRecord) -> Vec<WorkArtifactNode> {
    record
        .artifact_refs
        .iter()
        .map(|artifact| {
            let (runtime_instance_id, run_id) = artifact
                .runtime_provenance
                .as_ref()
                .map(|provenance| {
                    (
                        Some(provenance.runtime_instance_id.clone()),
                        Some(provenance.run_id.clone()),
                    )
                })
                .unwrap_or((None, None));
            WorkArtifactNode {
                artifact: artifact.clone(),
                runtime_instance_id,
                run_id,
            }
        })
        .collect()
}

fn runtime_run_status_to_execution_binding_status(
    status: WorkRuntimeRunStatus,
) -> WorkExecutionBindingStatus {
    match status {
        WorkRuntimeRunStatus::Pending => WorkExecutionBindingStatus::Queued,
        WorkRuntimeRunStatus::Running => WorkExecutionBindingStatus::Running,
        WorkRuntimeRunStatus::WaitingUser => WorkExecutionBindingStatus::WaitingUser,
        WorkRuntimeRunStatus::Completed => WorkExecutionBindingStatus::Completed,
        WorkRuntimeRunStatus::Failed => WorkExecutionBindingStatus::Failed,
        WorkRuntimeRunStatus::Cancelled => WorkExecutionBindingStatus::Cancelled,
    }
}

fn execution_binding_status_to_runtime_run_status(
    status: WorkExecutionBindingStatus,
) -> WorkRuntimeRunStatus {
    match status {
        WorkExecutionBindingStatus::Queued => WorkRuntimeRunStatus::Pending,
        WorkExecutionBindingStatus::Running => WorkRuntimeRunStatus::Running,
        WorkExecutionBindingStatus::WaitingUser => WorkRuntimeRunStatus::WaitingUser,
        WorkExecutionBindingStatus::Completed => WorkRuntimeRunStatus::Completed,
        WorkExecutionBindingStatus::Failed => WorkRuntimeRunStatus::Failed,
        WorkExecutionBindingStatus::Cancelled | WorkExecutionBindingStatus::Interrupted => {
            WorkRuntimeRunStatus::Cancelled
        }
    }
}

fn trim_runtime_issues(issues: &mut Vec<WorkRuntimeIssue>) {
    if issues.len() <= MAX_WORK_RUNTIME_ISSUES {
        return;
    }
    issues.sort_by_key(|issue| issue.timestamp_ms);
    let excess = issues.len() - MAX_WORK_RUNTIME_ISSUES;
    issues.drain(0..excess);
}

fn trim_runtime_logs(logs: &mut Vec<WorkRuntimeLog>) {
    if logs.len() <= MAX_WORK_RUNTIME_LOGS {
        return;
    }
    logs.sort_by_key(|log| log.timestamp_ms);
    let excess = logs.len() - MAX_WORK_RUNTIME_LOGS;
    logs.drain(0..excess);
}

fn apply_runtime_issue_to_builder_facts(record: &mut WorkRecord, issue: &WorkRuntimeIssue) {
    let builder_issue = WorkBuilderIssue {
        id: builder_issue_id(&[
            "runtime-issue",
            issue.runtime_instance_id.as_str(),
            &issue.timestamp_ms.to_string(),
            runtime_issue_severity_str(issue.severity),
            issue.message.as_str(),
        ]),
        app_id: issue.product_app_id.clone(),
        product_app_id: Some(issue.product_app_id.clone()),
        component_id: Some(issue.component_id.clone()),
        runtime_instance_id: Some(issue.runtime_instance_id.clone()),
        preview_result_id: Some(builder_preview_result_id(&issue.runtime_instance_id)),
        severity: issue.severity,
        status: WorkBuilderIssueStatus::Open,
        message: issue.message.clone(),
        source: issue.source.clone(),
        category: issue.category.clone(),
        timestamp_ms: issue.timestamp_ms,
        origin: WorkBuilderIssueOrigin::WorkExecutionGraph,
        resolved_at: None,
    };
    upsert_builder_issue(record, builder_issue);
    refresh_builder_preview_result_for_runtime_instance(record, &issue.runtime_instance_id);
}

fn apply_runtime_log_to_builder_facts(record: &mut WorkRecord, log: &WorkRuntimeLog) {
    if let Some(severity) = builder_issue_severity_for_log(log.level) {
        let builder_issue = WorkBuilderIssue {
            id: builder_issue_id(&[
                "runtime-log",
                log.runtime_instance_id.as_str(),
                &log.timestamp_ms.to_string(),
                runtime_log_level_str(log.level),
                log.category.as_str(),
                log.message.as_str(),
            ]),
            app_id: log.product_app_id.clone(),
            product_app_id: Some(log.product_app_id.clone()),
            component_id: Some(log.component_id.clone()),
            runtime_instance_id: Some(log.runtime_instance_id.clone()),
            preview_result_id: Some(builder_preview_result_id(&log.runtime_instance_id)),
            severity,
            status: WorkBuilderIssueStatus::Open,
            message: log.message.clone(),
            source: log.source.clone(),
            category: Some(log.category.clone()),
            timestamp_ms: log.timestamp_ms,
            origin: WorkBuilderIssueOrigin::WorkExecutionGraph,
            resolved_at: None,
        };
        upsert_builder_issue(record, builder_issue);
    }
    refresh_builder_preview_result_for_runtime_instance(record, &log.runtime_instance_id);
}

fn apply_validation_result_to_builder_issues(
    record: &mut WorkRecord,
    validation_result: &WorkBuilderValidationResult,
    now: i64,
) {
    let mut active_issue_ids = Vec::new();
    for check in &validation_result.checks {
        let Some(severity) = validation_issue_severity(check.status) else {
            continue;
        };
        let issue_id = validation_issue_id(validation_result, check);
        active_issue_ids.push(issue_id.clone());
        reopen_existing_builder_issue(record, &issue_id);
        upsert_builder_issue(
            record,
            WorkBuilderIssue {
                id: issue_id,
                app_id: validation_target_app_id(validation_result),
                product_app_id: validation_result.app_id.clone(),
                component_id: validation_result.component_id.clone(),
                runtime_instance_id: None,
                preview_result_id: None,
                severity,
                status: WorkBuilderIssueStatus::Open,
                message: validation_issue_message(check),
                source: Some(validation_result.tool_name.clone()),
                category: Some(validation_issue_category(check)),
                timestamp_ms: validation_result.observed_at,
                origin: WorkBuilderIssueOrigin::Validation,
                resolved_at: None,
            },
        );
    }

    for issue in record.builder_issues.iter_mut() {
        if !matches!(issue.origin, WorkBuilderIssueOrigin::Validation) {
            continue;
        }
        if !validation_issue_matches_target(issue, validation_result) {
            continue;
        }
        if active_issue_ids
            .iter()
            .any(|active_id| active_id == &issue.id)
        {
            continue;
        }
        if issue.status != WorkBuilderIssueStatus::Fixed {
            issue.status = WorkBuilderIssueStatus::Fixed;
            issue.resolved_at = Some(now);
        }
    }
}

fn upsert_builder_issue(record: &mut WorkRecord, issue: WorkBuilderIssue) {
    if let Some(existing) = record
        .builder_issues
        .iter_mut()
        .find(|existing| existing.id == issue.id)
    {
        let status = match existing.status {
            WorkBuilderIssueStatus::Open => issue.status,
            WorkBuilderIssueStatus::StillOpen | WorkBuilderIssueStatus::Regressed => {
                existing.status
            }
            WorkBuilderIssueStatus::Acknowledged => WorkBuilderIssueStatus::Acknowledged,
            WorkBuilderIssueStatus::Fixed => {
                if existing
                    .resolved_at
                    .is_some_and(|resolved_at| issue.timestamp_ms >= resolved_at)
                {
                    WorkBuilderIssueStatus::Regressed
                } else {
                    WorkBuilderIssueStatus::Fixed
                }
            }
        };
        let resolved_at = match status {
            WorkBuilderIssueStatus::Acknowledged | WorkBuilderIssueStatus::Fixed => {
                existing.resolved_at.or(issue.resolved_at)
            }
            WorkBuilderIssueStatus::Open
            | WorkBuilderIssueStatus::StillOpen
            | WorkBuilderIssueStatus::Regressed => None,
        };
        *existing = WorkBuilderIssue {
            status,
            resolved_at,
            ..issue
        };
    } else {
        record.builder_issues.push(issue);
    }
}

fn upsert_builder_validation_result(
    record: &mut WorkRecord,
    validation_result: WorkBuilderValidationResult,
) {
    if let Some(existing) = record
        .builder_validation_results
        .iter_mut()
        .find(|existing| existing.id == validation_result.id)
    {
        *existing = validation_result;
    } else {
        record.builder_validation_results.push(validation_result);
    }
}

fn refresh_capability_preview_result_for_validation(
    record: &mut WorkRecord,
    validation_result: &WorkBuilderValidationResult,
) {
    if validation_result.target_kind != WorkBuilderValidationTargetKind::Component {
        return;
    }

    let checks = validation_result
        .checks
        .iter()
        .filter(|check| capability_preview_check_id(&check.id))
        .collect::<Vec<_>>();
    if checks.is_empty() {
        return;
    }

    let fatal_issue_count = checks
        .iter()
        .filter(|check| {
            matches!(
                check.status,
                WorkBuilderFactStatus::Failed | WorkBuilderFactStatus::Blocked
            )
        })
        .count();
    let warning_issue_count = checks
        .iter()
        .filter(|check| check.status == WorkBuilderFactStatus::Warning)
        .count();
    let has_running = checks.iter().any(|check| {
        matches!(
            check.status,
            WorkBuilderFactStatus::Running | WorkBuilderFactStatus::Waiting
        )
    });
    let has_unverified = checks.iter().any(|check| {
        matches!(
            check.status,
            WorkBuilderFactStatus::NotRun | WorkBuilderFactStatus::NotVerified
        )
    });
    let status = if fatal_issue_count > 0 {
        WorkBuilderFactStatus::Failed
    } else if warning_issue_count > 0 {
        WorkBuilderFactStatus::Warning
    } else if has_running {
        WorkBuilderFactStatus::Running
    } else if has_unverified {
        WorkBuilderFactStatus::NotVerified
    } else {
        WorkBuilderFactStatus::Passed
    };

    upsert_builder_preview_result(
        record,
        WorkBuilderPreviewResult {
            id: capability_preview_result_id(validation_result),
            kind: WorkBuilderPreviewKind::Capability,
            status,
            source: WorkBuilderPreviewSource::PreviewHarness,
            harness_mode: Some("capability".to_string()),
            trigger_turn_id: None,
            detail: Some(capability_preview_detail(validation_result, &checks)),
            checks: checks.iter().map(|check| (*check).clone()).collect(),
            work_id: record.id.clone(),
            runtime_instance_id: None,
            product_app_id: validation_result.app_id.clone(),
            component_id: validation_result.component_id.clone(),
            product_app_surface_id: None,
            surface_id: None,
            observed_at: validation_result.observed_at,
            issue_count: fatal_issue_count + warning_issue_count,
            fatal_issue_count,
            warning_issue_count,
        },
    );
}

fn capability_preview_check_id(id: &str) -> bool {
    matches!(
        id,
        "componentContract"
            | "capabilities"
            | "permissions"
            | "dependencies"
            | "implementation"
            | "agentEval"
    )
}

fn capability_preview_detail(
    validation_result: &WorkBuilderValidationResult,
    checks: &[&WorkBuilderFactCheck],
) -> String {
    let failed = checks
        .iter()
        .filter(|check| {
            matches!(
                check.status,
                WorkBuilderFactStatus::Failed | WorkBuilderFactStatus::Blocked
            )
        })
        .map(|check| check.id.as_str())
        .collect::<Vec<_>>();
    let warnings = checks
        .iter()
        .filter(|check| check.status == WorkBuilderFactStatus::Warning)
        .map(|check| check.id.as_str())
        .collect::<Vec<_>>();
    let pending = checks
        .iter()
        .filter(|check| {
            matches!(
                check.status,
                WorkBuilderFactStatus::NotRun
                    | WorkBuilderFactStatus::NotVerified
                    | WorkBuilderFactStatus::Running
                    | WorkBuilderFactStatus::Waiting
            )
        })
        .map(|check| check.id.as_str())
        .collect::<Vec<_>>();
    let target = validation_result
        .component_id
        .as_deref()
        .unwrap_or("component");

    if !failed.is_empty() {
        format!(
            "Capability preview for {target} failed capability checks: {}.",
            failed.join(", ")
        )
    } else if !warnings.is_empty() {
        format!(
            "Capability preview for {target} has warning checks: {}.",
            warnings.join(", ")
        )
    } else if !pending.is_empty() {
        format!(
            "Capability preview for {target} is waiting for checks: {}.",
            pending.join(", ")
        )
    } else {
        format!("Capability preview for {target} passed current capability checks.")
    }
}

fn upsert_builder_preview_result(
    record: &mut WorkRecord,
    preview_result: WorkBuilderPreviewResult,
) {
    if let Some(existing) = record
        .builder_preview_results
        .iter_mut()
        .find(|existing| existing.id == preview_result.id)
    {
        *existing = preview_result;
    } else {
        record.builder_preview_results.push(preview_result);
    }
}

fn apply_preview_result_to_builder_issues(
    record: &mut WorkRecord,
    preview_result: &WorkBuilderPreviewResult,
) {
    if preview_result.source == WorkBuilderPreviewSource::RuntimeFact
        || !preview_result_is_not_clean(preview_result)
    {
        return;
    }
    if preview_result
        .runtime_instance_id
        .as_deref()
        .is_some_and(|runtime_instance_id| {
            record.builder_issues.iter().any(|issue| {
                issue.runtime_instance_id.as_deref() == Some(runtime_instance_id)
                    && issue.severity != WorkRuntimeIssueSeverity::Noise
                    && matches!(
                        issue.origin,
                        WorkBuilderIssueOrigin::RuntimeEvent
                            | WorkBuilderIssueOrigin::WorkExecutionGraph
                            | WorkBuilderIssueOrigin::Preview
                    )
            })
        })
    {
        return;
    }

    let issue_id = builder_issue_id(&["preview", preview_result.id.as_str()]);
    reopen_existing_builder_issue(record, &issue_id);
    upsert_builder_issue(
        record,
        WorkBuilderIssue {
            id: issue_id,
            app_id: preview_issue_app_id(record, preview_result),
            product_app_id: preview_result.product_app_id.clone(),
            component_id: preview_result
                .component_id
                .clone()
                .or_else(|| preview_result.product_app_surface_id.clone()),
            runtime_instance_id: preview_result.runtime_instance_id.clone(),
            preview_result_id: Some(preview_result.id.clone()),
            severity: preview_issue_severity(preview_result),
            status: WorkBuilderIssueStatus::Open,
            message: preview_issue_message(preview_result),
            source: Some(preview_source_label(preview_result.source).to_string()),
            category: Some(preview_issue_category(preview_result)),
            timestamp_ms: preview_result.observed_at,
            origin: WorkBuilderIssueOrigin::Preview,
            resolved_at: None,
        },
    );
}

fn reconcile_builder_issues_for_preview_result(
    record: &mut WorkRecord,
    preview_result: &mut WorkBuilderPreviewResult,
    _now: i64,
) {
    if preview_result.source == WorkBuilderPreviewSource::RuntimeFact {
        return;
    }
    let Some(runtime_instance_id) = preview_result.runtime_instance_id.as_deref() else {
        return;
    };

    let preview_ready = preview_result_is_clean_ready(preview_result);
    let preview_failed = preview_result_is_not_clean(preview_result);

    if preview_ready {
        for issue in record
            .builder_issues
            .iter_mut()
            .filter(|issue| preview_reconciles_issue(preview_result, issue))
        {
            issue.status = WorkBuilderIssueStatus::Fixed;
            issue.resolved_at = Some(preview_result.observed_at);
        }
    } else if preview_failed {
        for issue in record.builder_issues.iter_mut().filter(|issue| {
            issue.runtime_instance_id.as_deref() == Some(runtime_instance_id)
                && issue.severity != WorkRuntimeIssueSeverity::Noise
                && matches!(
                    issue.origin,
                    WorkBuilderIssueOrigin::RuntimeEvent
                        | WorkBuilderIssueOrigin::WorkExecutionGraph
                        | WorkBuilderIssueOrigin::Preview
                )
        }) {
            if issue.status == WorkBuilderIssueStatus::Fixed {
                if preview_result.source == WorkBuilderPreviewSource::FixRerun
                    || issue
                        .resolved_at
                        .is_some_and(|resolved_at| preview_result.observed_at >= resolved_at)
                {
                    issue.status = WorkBuilderIssueStatus::Regressed;
                    issue.resolved_at = None;
                }
            } else {
                issue.status = WorkBuilderIssueStatus::StillOpen;
                issue.resolved_at = None;
            }
        }
    }

    let active_issues = record
        .builder_issues
        .iter()
        .filter(|issue| preview_reconciles_issue(preview_result, issue))
        .collect::<Vec<_>>();
    let fatal_issue_count = active_issues
        .iter()
        .filter(|issue| issue.severity == WorkRuntimeIssueSeverity::Fatal)
        .count();
    let warning_issue_count = active_issues
        .iter()
        .filter(|issue| issue.severity == WorkRuntimeIssueSeverity::Warning)
        .count();

    preview_result.issue_count = preview_result.issue_count.max(active_issues.len());
    preview_result.fatal_issue_count = preview_result.fatal_issue_count.max(fatal_issue_count);
    preview_result.warning_issue_count =
        preview_result.warning_issue_count.max(warning_issue_count);
    preview_result.status = reconciled_preview_status(preview_result);
}

fn preview_reconciles_issue(
    preview_result: &WorkBuilderPreviewResult,
    issue: &WorkBuilderIssue,
) -> bool {
    issue.runtime_instance_id.as_deref() == preview_result.runtime_instance_id.as_deref()
        && preview_result.runtime_instance_id.is_some()
        && issue.status != WorkBuilderIssueStatus::Fixed
        && issue.severity != WorkRuntimeIssueSeverity::Noise
        && matches!(
            issue.origin,
            WorkBuilderIssueOrigin::RuntimeEvent
                | WorkBuilderIssueOrigin::WorkExecutionGraph
                | WorkBuilderIssueOrigin::Preview
        )
}

fn refresh_release_rehearsal_preview_result(record: &mut WorkRecord, now: i64) {
    let has_external_preview_evidence = record.builder_preview_results.iter().any(|preview| {
        preview.kind != WorkBuilderPreviewKind::ReleaseRehearsal
            || preview.source != WorkBuilderPreviewSource::ReleaseRehearsal
    });
    if record.builder_validation_results.is_empty()
        && !has_external_preview_evidence
        && record.builder_issues.is_empty()
    {
        return;
    }

    let preview_results = record
        .builder_preview_results
        .iter()
        .filter(|preview| is_product_preview_evidence(preview))
        .collect::<Vec<_>>();
    let latest_release_harness = record
        .builder_preview_results
        .iter()
        .filter(|preview| is_release_readiness_harness_evidence(preview))
        .max_by_key(|preview| preview.observed_at);
    let active_issues = record
        .builder_issues
        .iter()
        .filter(|issue| {
            issue.status != WorkBuilderIssueStatus::Fixed
                && issue.severity != WorkRuntimeIssueSeverity::Noise
        })
        .collect::<Vec<_>>();
    let fatal_issue_count = active_issues
        .iter()
        .filter(|issue| issue.severity == WorkRuntimeIssueSeverity::Fatal)
        .count();
    let warning_issue_count = active_issues
        .iter()
        .filter(|issue| issue.severity == WorkRuntimeIssueSeverity::Warning)
        .count();
    let validation_failed = record.builder_validation_results.iter().any(|validation| {
        matches!(
            validation.status,
            WorkBuilderFactStatus::Failed | WorkBuilderFactStatus::Blocked
        )
    });
    let validation_warning = record
        .builder_validation_results
        .iter()
        .any(|validation| validation.status == WorkBuilderFactStatus::Warning);
    let validation_running = record.builder_validation_results.iter().any(|validation| {
        matches!(
            validation.status,
            WorkBuilderFactStatus::Running | WorkBuilderFactStatus::Waiting
        )
    });
    let validation_unverified = record
        .builder_validation_results
        .iter()
        .flat_map(|validation| validation.checks.iter())
        .any(|check| {
            matches!(
                check.status,
                WorkBuilderFactStatus::NotRun
                    | WorkBuilderFactStatus::NotVerified
                    | WorkBuilderFactStatus::Waiting
            )
        });
    let missing_release_gate = record.builder_validation_results.iter().all(|validation| {
        validation
            .checks
            .iter()
            .all(|check| check.id != "releaseGate")
    });
    let preview_failed = preview_results.iter().any(|preview| {
        matches!(
            preview.status,
            WorkBuilderFactStatus::Failed | WorkBuilderFactStatus::Blocked
        )
    });
    let preview_warning = preview_results
        .iter()
        .any(|preview| preview.status == WorkBuilderFactStatus::Warning);
    let preview_running = preview_results.iter().any(|preview| {
        matches!(
            preview.status,
            WorkBuilderFactStatus::Running | WorkBuilderFactStatus::Waiting
        )
    });
    let preview_unverified = preview_results.iter().any(|preview| {
        matches!(
            preview.status,
            WorkBuilderFactStatus::NotRun
                | WorkBuilderFactStatus::NotVerified
                | WorkBuilderFactStatus::Ready
        ) || preview.checks.is_empty()
            || preview
                .checks
                .iter()
                .any(|check| fact_status_is_unverified(check.status))
    });
    let release_readiness_checks = release_readiness_evidence_checks(record);
    let release_readiness_failed = release_readiness_checks
        .iter()
        .any(|check| fact_status_is_failed(check.status));
    let release_readiness_warning = release_readiness_checks
        .iter()
        .any(|check| fact_status_is_warning(check.status));
    let release_readiness_running = release_readiness_checks
        .iter()
        .any(|check| fact_status_is_running(check.status));
    let release_readiness_unverified = release_readiness_checks
        .iter()
        .any(|check| fact_status_is_unverified(check.status));
    let release_readiness_pending = release_readiness_pending_ids(&release_readiness_checks);
    let has_validation = !record.builder_validation_results.is_empty();
    let has_preview = !preview_results.is_empty();
    let release_checks = release_rehearsal_checks(
        has_validation,
        has_preview,
        validation_failed,
        validation_warning,
        validation_running,
        validation_unverified,
        missing_release_gate,
        preview_failed,
        preview_warning,
        preview_running,
        preview_unverified,
        fatal_issue_count,
        warning_issue_count,
        release_readiness_checks,
        release_readiness_pending.clone(),
        release_readiness_failed,
        release_readiness_warning,
        release_readiness_running,
        release_readiness_unverified,
    );
    let status =
        if fatal_issue_count > 0 || validation_failed || preview_failed || release_readiness_failed
        {
            WorkBuilderFactStatus::Failed
        } else if warning_issue_count > 0
            || validation_warning
            || preview_warning
            || release_readiness_warning
        {
            WorkBuilderFactStatus::Warning
        } else if validation_running || preview_running || release_readiness_running {
            WorkBuilderFactStatus::Running
        } else if !has_validation
            || !has_preview
            || validation_unverified
            || preview_unverified
            || missing_release_gate
            || release_readiness_unverified
        {
            WorkBuilderFactStatus::NotVerified
        } else {
            WorkBuilderFactStatus::Passed
        };
    let observed_at = record
        .builder_validation_results
        .iter()
        .map(|validation| validation.observed_at)
        .chain(preview_results.iter().map(|preview| preview.observed_at))
        .chain(latest_release_harness.map(|preview| preview.observed_at))
        .chain(active_issues.iter().map(|issue| issue.timestamp_ms))
        .max()
        .unwrap_or(now);

    upsert_builder_preview_result(
        record,
        WorkBuilderPreviewResult {
            id: release_rehearsal_preview_result_id(&record.id),
            kind: WorkBuilderPreviewKind::ReleaseRehearsal,
            status,
            source: WorkBuilderPreviewSource::ReleaseRehearsal,
            harness_mode: Some("release-rehearsal".to_string()),
            trigger_turn_id: None,
            detail: Some(release_rehearsal_detail(
                has_validation,
                has_preview,
                validation_unverified,
                missing_release_gate,
                &release_readiness_pending,
                fatal_issue_count,
                warning_issue_count,
            )),
            checks: release_checks,
            work_id: record.id.clone(),
            runtime_instance_id: None,
            product_app_id: release_rehearsal_product_app_id(record),
            component_id: record
                .subject
                .component_ref()
                .map(|component| component.component_id.clone()),
            product_app_surface_id: None,
            surface_id: None,
            observed_at,
            issue_count: active_issues.len(),
            fatal_issue_count,
            warning_issue_count,
        },
    );
}

fn preview_result_is_clean_ready(preview_result: &WorkBuilderPreviewResult) -> bool {
    preview_result.status == WorkBuilderFactStatus::Passed
        && preview_result.issue_count == 0
        && preview_result.fatal_issue_count == 0
        && preview_result.warning_issue_count == 0
}

fn preview_result_is_not_clean(preview_result: &WorkBuilderPreviewResult) -> bool {
    matches!(
        preview_result.status,
        WorkBuilderFactStatus::Failed
            | WorkBuilderFactStatus::Blocked
            | WorkBuilderFactStatus::Warning
    ) || preview_result.issue_count > 0
        || preview_result.fatal_issue_count > 0
        || preview_result.warning_issue_count > 0
}

fn reconciled_preview_status(preview_result: &WorkBuilderPreviewResult) -> WorkBuilderFactStatus {
    if preview_result.fatal_issue_count > 0 {
        WorkBuilderFactStatus::Failed
    } else if preview_result.warning_issue_count > 0 {
        WorkBuilderFactStatus::Warning
    } else if preview_result.status == WorkBuilderFactStatus::Passed {
        WorkBuilderFactStatus::Passed
    } else {
        preview_result.status
    }
}

fn refresh_builder_preview_result_for_runtime_instance(
    record: &mut WorkRecord,
    runtime_instance_id: &str,
) {
    let Some(instance) = record
        .runtime_instances
        .iter()
        .find(|instance| instance.id == runtime_instance_id)
        .cloned()
    else {
        return;
    };

    let active_issues = record
        .builder_issues
        .iter()
        .filter(|issue| {
            issue.runtime_instance_id.as_deref() == Some(runtime_instance_id)
                && issue.status != WorkBuilderIssueStatus::Fixed
                && issue.severity != WorkRuntimeIssueSeverity::Noise
        })
        .collect::<Vec<_>>();
    let fatal_issue_count = active_issues
        .iter()
        .filter(|issue| issue.severity == WorkRuntimeIssueSeverity::Fatal)
        .count();
    let warning_issue_count = active_issues
        .iter()
        .filter(|issue| issue.severity == WorkRuntimeIssueSeverity::Warning)
        .count();
    let observed_at = active_issues
        .iter()
        .map(|issue| issue.timestamp_ms)
        .chain(
            record
                .builder_preview_results
                .iter()
                .filter(|preview| {
                    preview.runtime_instance_id.as_deref() == Some(runtime_instance_id)
                })
                .map(|preview| preview.observed_at),
        )
        .max()
        .unwrap_or(record.updated_at);
    let status = if fatal_issue_count > 0 {
        WorkBuilderFactStatus::Failed
    } else if warning_issue_count > 0 {
        WorkBuilderFactStatus::Warning
    } else {
        WorkBuilderFactStatus::Ready
    };

    upsert_builder_preview_result(
        record,
        WorkBuilderPreviewResult {
            id: builder_preview_result_id(runtime_instance_id),
            kind: WorkBuilderPreviewKind::ProductAppPreview,
            status,
            source: WorkBuilderPreviewSource::RuntimeFact,
            harness_mode: Some("product-app-preview".to_string()),
            trigger_turn_id: None,
            detail: Some("Derived from runtime issues and logs.".to_string()),
            checks: Vec::new(),
            work_id: record.id.clone(),
            runtime_instance_id: Some(runtime_instance_id.to_string()),
            product_app_id: Some(instance.product_app_id),
            component_id: Some(instance.product_app_surface_id.clone()),
            product_app_surface_id: Some(instance.product_app_surface_id),
            surface_id: Some(instance.surface_id),
            observed_at,
            issue_count: active_issues.len(),
            fatal_issue_count,
            warning_issue_count,
        },
    );
}

fn validation_issue_severity(status: WorkBuilderFactStatus) -> Option<WorkRuntimeIssueSeverity> {
    match status {
        WorkBuilderFactStatus::Failed | WorkBuilderFactStatus::Blocked => {
            Some(WorkRuntimeIssueSeverity::Fatal)
        }
        WorkBuilderFactStatus::Warning => Some(WorkRuntimeIssueSeverity::Warning),
        WorkBuilderFactStatus::Passed
        | WorkBuilderFactStatus::NotRun
        | WorkBuilderFactStatus::NotVerified
        | WorkBuilderFactStatus::Running
        | WorkBuilderFactStatus::Ready
        | WorkBuilderFactStatus::Waiting => None,
    }
}

fn validation_issue_id(
    validation_result: &WorkBuilderValidationResult,
    check: &WorkBuilderFactCheck,
) -> String {
    builder_issue_id(&[
        "validation",
        validation_target_key(validation_result).as_str(),
        check.id.as_str(),
    ])
}

fn validation_target_key(validation_result: &WorkBuilderValidationResult) -> String {
    match validation_result.target_kind {
        WorkBuilderValidationTargetKind::ProductApp => format!(
            "product-app:{}",
            validation_result.app_id.as_deref().unwrap_or("unknown")
        ),
        WorkBuilderValidationTargetKind::Component => format!(
            "component:{}:{}",
            validation_result
                .component_kind
                .as_deref()
                .unwrap_or("component"),
            validation_result
                .component_id
                .as_deref()
                .unwrap_or("unknown")
        ),
    }
}

fn validation_target_app_id(validation_result: &WorkBuilderValidationResult) -> String {
    validation_result
        .app_id
        .clone()
        .or_else(|| validation_result.component_id.clone())
        .unwrap_or_else(|| "app-builder-validation".to_string())
}

fn release_rehearsal_product_app_id(record: &WorkRecord) -> Option<String> {
    record
        .subject
        .app_ref()
        .map(|app| app.app_id.clone())
        .or_else(|| {
            record
                .app_refs
                .first()
                .map(|relation| relation.app.app_id.clone())
        })
        .or_else(|| {
            record
                .builder_validation_results
                .iter()
                .find_map(|validation| validation.app_id.clone())
        })
        .or_else(|| {
            record
                .builder_preview_results
                .iter()
                .find_map(|preview| preview.product_app_id.clone())
        })
}

fn release_rehearsal_detail(
    has_validation: bool,
    has_preview: bool,
    validation_unverified: bool,
    missing_release_gate: bool,
    release_readiness_pending: &[String],
    fatal_issue_count: usize,
    warning_issue_count: usize,
) -> String {
    let mut pending = Vec::new();
    if !has_validation {
        pending.push("validation");
    }
    if !has_preview {
        pending.push("preview");
    }
    if validation_unverified {
        pending.push("not-run validation gates");
    }
    if missing_release_gate {
        pending.push("release gate");
    }
    pending.extend(release_readiness_pending.iter().map(String::as_str));

    if fatal_issue_count > 0 {
        format!(
            "Release rehearsal blocked by {fatal_issue_count} fatal issue(s) and {warning_issue_count} warning issue(s)."
        )
    } else if warning_issue_count > 0 {
        format!("Release rehearsal has {warning_issue_count} warning issue(s).")
    } else if pending.is_empty() {
        "Release rehearsal passed current validation, preview, and issue gates.".to_string()
    } else {
        format!(
            "Release rehearsal is waiting for {} evidence.",
            pending.join(", ")
        )
    }
}

fn fact_status_is_failed(status: WorkBuilderFactStatus) -> bool {
    matches!(
        status,
        WorkBuilderFactStatus::Failed | WorkBuilderFactStatus::Blocked
    )
}

fn fact_status_is_warning(status: WorkBuilderFactStatus) -> bool {
    status == WorkBuilderFactStatus::Warning
}

fn fact_status_is_running(status: WorkBuilderFactStatus) -> bool {
    matches!(
        status,
        WorkBuilderFactStatus::Running | WorkBuilderFactStatus::Waiting
    )
}

fn fact_status_is_unverified(status: WorkBuilderFactStatus) -> bool {
    matches!(
        status,
        WorkBuilderFactStatus::NotRun | WorkBuilderFactStatus::NotVerified
    )
}

fn release_readiness_evidence_checks(record: &WorkRecord) -> Vec<WorkBuilderFactCheck> {
    let required_ids = release_readiness_required_check_ids(record);
    let mut checks = required_ids
        .into_iter()
        .map(|id| release_readiness_evidence_check(record, id))
        .collect::<Vec<_>>();

    if release_readiness_requires_permission_review(record, &checks) {
        let insertion_index = checks
            .iter()
            .position(|check| check.id == "permissions")
            .map(|index| index + 1)
            .unwrap_or(checks.len());
        checks.insert(
            insertion_index,
            release_readiness_evidence_check(record, "permissionReview"),
        );
    }

    for id in [
        "surfaceMode",
        "runtimeReady",
        "visualRoot",
        "viewport",
        "interactionSurface",
    ] {
        if let Some(check) = release_readiness_optional_evidence_check(record, id) {
            checks.push(check);
        }
    }

    checks
}

fn release_readiness_required_check_ids(record: &WorkRecord) -> Vec<&'static str> {
    if record.subject.component_ref().is_some() {
        return vec![
            "componentContract",
            "capabilities",
            "dependencies",
            "implementation",
            "consumerCompatibility",
            "permissions",
            "data",
            "dataSummary",
            "runtimeDependencies",
            "agentEval",
        ];
    }

    let mut required_ids = vec![
        "criticalPath",
        "permissions",
        "permissionReview",
        "data",
        "dataSummary",
        "runtimeStorage",
        "runtimeDependencies",
        "agentEval",
        "userPath",
    ];
    if record.subject.app_ref().is_some() {
        let insertion_index = required_ids
            .iter()
            .position(|id| *id == "dataSummary")
            .unwrap_or(required_ids.len());
        required_ids.insert(insertion_index, "dataLifecycle");
    }
    required_ids
}

fn release_readiness_requires_permission_review(
    record: &WorkRecord,
    checks: &[WorkBuilderFactCheck],
) -> bool {
    if checks.iter().any(|check| check.id == "permissionReview") {
        return false;
    }
    latest_release_harness_check(record, "permissionReview").is_some()
        || checks
            .iter()
            .any(|check| check.id == "permissions" && fact_status_is_warning(check.status))
}

fn release_readiness_evidence_check(record: &WorkRecord, id: &str) -> WorkBuilderFactCheck {
    if id == "permissionReview" {
        return release_readiness_permission_review_check(record);
    }

    if let Some(component) = record.subject.component_ref() {
        if component_runtime_release_readiness_check(id) {
            return latest_component_runtime_preview_check(record, id, &component.component_id)
                .cloned()
                .or_else(|| {
                    latest_validation_check(record, id)
                        .filter(|check| validation_runtime_check_is_blocker(check.status))
                        .cloned()
                })
                .unwrap_or_else(|| missing_release_readiness_check(id));
        }
    }

    if id == "agentEval" {
        return latest_agent_eval_check(record)
            .cloned()
            .unwrap_or_else(|| missing_release_readiness_check(id));
    }

    if let Some(check) = latest_release_harness_check(record, id) {
        return check.clone();
    }

    match id {
        "criticalPath" => critical_path_evidence_from_validation(record),
        "componentContract" | "capabilities" | "dependencies" | "implementation"
        | "permissions" => latest_validation_check(record, id)
            .cloned()
            .unwrap_or_else(|| missing_release_readiness_check(id)),
        "consumerCompatibility" => missing_release_readiness_check(id),
        "data"
        | "dataLifecycle"
        | "dataSummary"
        | "runtimeStorage"
        | "runtimeDependencies"
        | "userPath"
        | "permissionReview" => missing_release_readiness_check(id),
        _ => missing_release_readiness_check(id),
    }
}

fn release_readiness_permission_review_check(record: &WorkRecord) -> WorkBuilderFactCheck {
    let Some((review_observed_at, check)) =
        latest_release_harness_check_with_observed_at(record, "permissionReview")
    else {
        return missing_release_readiness_check("permissionReview");
    };

    if latest_permission_warning_observed_at(record)
        .is_some_and(|permissions_observed_at| permissions_observed_at > review_observed_at)
    {
        return WorkBuilderFactCheck {
            id: "permissionReview".to_string(),
            status: WorkBuilderFactStatus::NotVerified,
            detail: Some(
                "Elevated permissions changed after the last explicit review.".to_string(),
            ),
        };
    }

    check.clone()
}

fn component_runtime_release_readiness_check(id: &str) -> bool {
    matches!(
        id,
        "consumerCompatibility"
            | "data"
            | "dataLifecycle"
            | "dataSummary"
            | "runtimeStorage"
            | "runtimeDependencies"
            | "agentEval"
    )
}

fn latest_component_runtime_preview_check<'a>(
    record: &'a WorkRecord,
    id: &str,
    component_id: &str,
) -> Option<&'a WorkBuilderFactCheck> {
    record
        .builder_preview_results
        .iter()
        .filter(|preview| preview.kind != WorkBuilderPreviewKind::ReleaseRehearsal)
        .filter(|preview| preview.component_id.as_deref() == Some(component_id))
        .filter(|preview| component_runtime_preview_source_is_strong(id, preview.source))
        .filter_map(|preview| {
            preview
                .checks
                .iter()
                .find(|check| check.id == id)
                .map(|check| (preview.observed_at, check))
        })
        .max_by_key(|(observed_at, _)| *observed_at)
        .map(|(_, check)| check)
}

fn component_runtime_preview_source_is_strong(id: &str, source: WorkBuilderPreviewSource) -> bool {
    if id == "agentEval" {
        return matches!(
            source,
            WorkBuilderPreviewSource::PreviewHarness
                | WorkBuilderPreviewSource::RuntimeObservation
                | WorkBuilderPreviewSource::FixRerun
        );
    }

    source == WorkBuilderPreviewSource::RuntimeObservation
}

fn validation_runtime_check_is_blocker(status: WorkBuilderFactStatus) -> bool {
    fact_status_is_failed(status)
}

fn latest_permission_warning_observed_at(record: &WorkRecord) -> Option<i64> {
    [
        latest_release_harness_check_with_observed_at(record, "permissions"),
        latest_validation_check_with_observed_at(record, "permissions"),
    ]
    .into_iter()
    .flatten()
    .filter(|(_, check)| fact_status_is_warning(check.status))
    .map(|(observed_at, _)| observed_at)
    .max()
}

fn release_readiness_optional_evidence_check(
    record: &WorkRecord,
    id: &str,
) -> Option<WorkBuilderFactCheck> {
    let check = latest_release_harness_check(record, id)
        .cloned()
        .or_else(|| latest_preview_check(record, id).cloned());
    if id == "surfaceMode"
        && check
            .as_ref()
            .is_some_and(|check| fact_status_is_unverified(check.status))
    {
        return None;
    }
    check
}

fn latest_release_harness_check<'a>(
    record: &'a WorkRecord,
    id: &str,
) -> Option<&'a WorkBuilderFactCheck> {
    latest_release_harness_check_with_observed_at(record, id).map(|(_, check)| check)
}

fn latest_release_harness_check_with_observed_at<'a>(
    record: &'a WorkRecord,
    id: &str,
) -> Option<(i64, &'a WorkBuilderFactCheck)> {
    record
        .builder_preview_results
        .iter()
        .filter(|preview| is_release_readiness_harness_evidence(preview))
        .filter_map(|preview| {
            preview
                .checks
                .iter()
                .find(|check| check.id == id)
                .map(|check| (preview.observed_at, check))
        })
        .max_by_key(|(observed_at, _)| *observed_at)
}

fn latest_preview_check<'a>(record: &'a WorkRecord, id: &str) -> Option<&'a WorkBuilderFactCheck> {
    record
        .builder_preview_results
        .iter()
        .filter(|preview| is_product_preview_evidence(preview))
        .filter_map(|preview| {
            preview
                .checks
                .iter()
                .find(|check| check.id == id)
                .map(|check| (preview.observed_at, check))
        })
        .max_by_key(|(observed_at, _)| *observed_at)
        .map(|(_, check)| check)
}

fn latest_agent_eval_check<'a>(record: &'a WorkRecord) -> Option<&'a WorkBuilderFactCheck> {
    record
        .builder_preview_results
        .iter()
        .filter(|preview| preview.kind == WorkBuilderPreviewKind::AgentEval)
        .filter_map(|preview| {
            preview
                .checks
                .iter()
                .find(|check| check.id == "agentEval")
                .map(|check| (preview.observed_at, check))
        })
        .max_by_key(|(observed_at, _)| *observed_at)
        .map(|(_, check)| check)
}

fn is_product_preview_evidence(preview: &WorkBuilderPreviewResult) -> bool {
    matches!(
        preview.kind,
        WorkBuilderPreviewKind::ProductAppPreview
            | WorkBuilderPreviewKind::AgentChat
            | WorkBuilderPreviewKind::Sidecar
            | WorkBuilderPreviewKind::FullApp
            | WorkBuilderPreviewKind::Embedded
            | WorkBuilderPreviewKind::Capability
    )
}

fn is_release_readiness_harness_evidence(preview: &WorkBuilderPreviewResult) -> bool {
    preview.source == WorkBuilderPreviewSource::RuntimeObservation
        && matches!(
            preview.kind,
            WorkBuilderPreviewKind::RuntimeBoundary
                | WorkBuilderPreviewKind::RuntimeDependencies
                | WorkBuilderPreviewKind::PermissionReview
                | WorkBuilderPreviewKind::UserPathRehearsal
        )
}

fn latest_validation_check<'a>(
    record: &'a WorkRecord,
    id: &str,
) -> Option<&'a WorkBuilderFactCheck> {
    latest_validation_check_with_observed_at(record, id).map(|(_, check)| check)
}

fn latest_validation_check_with_observed_at<'a>(
    record: &'a WorkRecord,
    id: &str,
) -> Option<(i64, &'a WorkBuilderFactCheck)> {
    record
        .builder_validation_results
        .iter()
        .filter_map(|validation| {
            validation
                .checks
                .iter()
                .find(|check| check.id == id)
                .map(|check| (validation.observed_at, check))
        })
        .max_by_key(|(observed_at, _)| *observed_at)
}

fn latest_validation_checks<'a>(
    record: &'a WorkRecord,
    ids: &[&str],
) -> Vec<&'a WorkBuilderFactCheck> {
    ids.iter()
        .filter_map(|id| latest_validation_check(record, id))
        .collect()
}

fn critical_path_evidence_from_validation(record: &WorkRecord) -> WorkBuilderFactCheck {
    let checks =
        latest_validation_checks(record, &["primarySurface", "surfaceSource", "launchPolicy"]);
    if checks.len() < 3 {
        return missing_release_readiness_check("criticalPath");
    }
    if checks
        .iter()
        .any(|check| fact_status_is_failed(check.status))
    {
        return WorkBuilderFactCheck {
            id: "criticalPath".to_string(),
            status: WorkBuilderFactStatus::Failed,
            detail: Some(
                "Primary surface, source, or launch policy validation failed.".to_string(),
            ),
        };
    }
    if checks
        .iter()
        .any(|check| fact_status_is_warning(check.status))
    {
        return WorkBuilderFactCheck {
            id: "criticalPath".to_string(),
            status: WorkBuilderFactStatus::Warning,
            detail: Some(
                "Primary surface, source, or launch policy validation has warnings.".to_string(),
            ),
        };
    }
    if checks
        .iter()
        .any(|check| fact_status_is_running(check.status))
    {
        return WorkBuilderFactCheck {
            id: "criticalPath".to_string(),
            status: WorkBuilderFactStatus::Running,
            detail: Some(
                "Primary surface, source, or launch policy validation is still running."
                    .to_string(),
            ),
        };
    }
    WorkBuilderFactCheck {
        id: "criticalPath".to_string(),
        status: WorkBuilderFactStatus::NotVerified,
        detail: Some(
            "Package surface and launch checks passed; no new-user critical path rehearsal has executed."
                .to_string(),
        ),
    }
}

fn missing_release_readiness_check(id: &str) -> WorkBuilderFactCheck {
    WorkBuilderFactCheck {
        id: id.to_string(),
        status: WorkBuilderFactStatus::NotVerified,
        detail: Some(match id {
            "criticalPath" => {
                "No critical path package or rehearsal evidence is recorded.".to_string()
            }
            "componentContract" => {
                "No Component contract readiness evidence is recorded.".to_string()
            }
            "capabilities" => "No Component capability readiness evidence is recorded.".to_string(),
            "dependencies" => "No Component dependency readiness evidence is recorded.".to_string(),
            "implementation" => {
                "No Component implementation readiness evidence is recorded.".to_string()
            }
            "consumerCompatibility" => {
                "No consumer compatibility readiness evidence is recorded.".to_string()
            }
            "permissions" => "No permission readiness evidence is recorded.".to_string(),
            "data" => "No data boundary readiness evidence is recorded.".to_string(),
            "dataLifecycle" => "No data lifecycle readiness evidence is recorded.".to_string(),
            "dataSummary" => {
                "No Data/Memory retention and sharing summary evidence is recorded.".to_string()
            }
            "runtimeStorage" => {
                "No runtime storage scope readiness evidence is recorded.".to_string()
            }
            "runtimeDependencies" => {
                "No runtime dependency health readiness evidence is recorded.".to_string()
            }
            "agentEval" => "No Agent Eval readiness evidence is recorded.".to_string(),
            "userPath" => "No executed user-path rehearsal evidence is recorded.".to_string(),
            "permissionReview" => {
                "No explicit App Builder permission review evidence is recorded.".to_string()
            }
            _ => format!("No {id} release readiness evidence is recorded."),
        }),
    }
}

fn release_readiness_pending_ids(checks: &[WorkBuilderFactCheck]) -> Vec<String> {
    checks
        .iter()
        .filter(|check| {
            fact_status_is_failed(check.status)
                || fact_status_is_running(check.status)
                || fact_status_is_unverified(check.status)
        })
        .map(|check| check.id.clone())
        .collect()
}

fn release_rehearsal_checks(
    has_validation: bool,
    has_preview: bool,
    validation_failed: bool,
    validation_warning: bool,
    validation_running: bool,
    validation_unverified: bool,
    missing_release_gate: bool,
    preview_failed: bool,
    preview_warning: bool,
    preview_running: bool,
    preview_unverified: bool,
    fatal_issue_count: usize,
    warning_issue_count: usize,
    release_readiness_checks: Vec<WorkBuilderFactCheck>,
    release_readiness_pending: Vec<String>,
    release_readiness_failed: bool,
    release_readiness_warning: bool,
    release_readiness_running: bool,
    release_readiness_unverified: bool,
) -> Vec<WorkBuilderFactCheck> {
    let mut checks = vec![
        WorkBuilderFactCheck {
            id: "validation".to_string(),
            status: if !has_validation {
                WorkBuilderFactStatus::NotVerified
            } else if validation_failed {
                WorkBuilderFactStatus::Failed
            } else if validation_warning {
                WorkBuilderFactStatus::Warning
            } else if validation_running {
                WorkBuilderFactStatus::Running
            } else if validation_unverified {
                WorkBuilderFactStatus::NotVerified
            } else {
                WorkBuilderFactStatus::Passed
            },
            detail: Some(if !has_validation {
                "No package validation result is recorded.".to_string()
            } else if validation_unverified {
                "Validation contains not-run or not-verified gates.".to_string()
            } else {
                "Package validation evidence is recorded.".to_string()
            }),
        },
        WorkBuilderFactCheck {
            id: "preview".to_string(),
            status: if !has_preview {
                WorkBuilderFactStatus::NotVerified
            } else if preview_failed {
                WorkBuilderFactStatus::Failed
            } else if preview_warning {
                WorkBuilderFactStatus::Warning
            } else if preview_running {
                WorkBuilderFactStatus::Running
            } else if preview_unverified {
                WorkBuilderFactStatus::NotVerified
            } else {
                WorkBuilderFactStatus::Passed
            },
            detail: Some(if !has_preview {
                "No non-rehearsal preview result is recorded.".to_string()
            } else if preview_unverified {
                "Preview evidence is recorded but is still ready, missing detailed checks, or contains not-run/not-verified gates.".to_string()
            } else {
                "Preview evidence is recorded.".to_string()
            }),
        },
        WorkBuilderFactCheck {
            id: "issues".to_string(),
            status: if fatal_issue_count > 0 {
                WorkBuilderFactStatus::Failed
            } else if warning_issue_count > 0 {
                WorkBuilderFactStatus::Warning
            } else {
                WorkBuilderFactStatus::Passed
            },
            detail: Some(format!(
                "{fatal_issue_count} fatal issue(s), {warning_issue_count} warning issue(s)."
            )),
        },
    ];
    checks.extend(release_readiness_checks);
    checks.push(WorkBuilderFactCheck {
        id: "releaseGate".to_string(),
        status: if missing_release_gate {
            WorkBuilderFactStatus::NotVerified
        } else if validation_failed || release_readiness_failed {
            WorkBuilderFactStatus::Failed
        } else if validation_warning || release_readiness_warning {
            WorkBuilderFactStatus::Warning
        } else if validation_running || release_readiness_running {
            WorkBuilderFactStatus::Running
        } else if validation_unverified || release_readiness_unverified {
            WorkBuilderFactStatus::NotVerified
        } else {
            WorkBuilderFactStatus::Passed
        },
        detail: Some(if missing_release_gate {
            "No releaseGate validation check is recorded.".to_string()
        } else if !release_readiness_pending.is_empty() {
            format!(
                "Release gate is waiting for {} evidence.",
                release_readiness_pending.join(", ")
            )
        } else {
            "Release gate validation check is recorded.".to_string()
        }),
    });
    checks
}

fn preview_issue_app_id(record: &WorkRecord, preview_result: &WorkBuilderPreviewResult) -> String {
    preview_result
        .product_app_id
        .clone()
        .or_else(|| record.subject.app_ref().map(|app| app.app_id.clone()))
        .or_else(|| {
            record
                .app_refs
                .first()
                .map(|relation| relation.app.app_id.clone())
        })
        .or_else(|| preview_result.component_id.clone())
        .or_else(|| preview_result.product_app_surface_id.clone())
        .unwrap_or_else(|| format!("work:{}", record.id))
}

fn preview_issue_message(preview_result: &WorkBuilderPreviewResult) -> String {
    preview_result
        .detail
        .as_deref()
        .filter(|detail| !detail.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "Builder preview '{}' is {:?}",
                preview_result.id, preview_result.status
            )
        })
}

fn preview_issue_category(preview_result: &WorkBuilderPreviewResult) -> String {
    format!(
        "preview:{}",
        preview_result
            .harness_mode
            .as_deref()
            .unwrap_or_else(|| preview_kind_label(preview_result.kind))
    )
}

fn preview_issue_severity(preview_result: &WorkBuilderPreviewResult) -> WorkRuntimeIssueSeverity {
    if preview_result.fatal_issue_count > 0
        || matches!(
            preview_result.status,
            WorkBuilderFactStatus::Failed | WorkBuilderFactStatus::Blocked
        )
    {
        WorkRuntimeIssueSeverity::Fatal
    } else if preview_result.warning_issue_count > 0
        || preview_result.issue_count > 0
        || preview_result.status == WorkBuilderFactStatus::Warning
    {
        WorkRuntimeIssueSeverity::Warning
    } else {
        WorkRuntimeIssueSeverity::Noise
    }
}

fn preview_kind_label(kind: WorkBuilderPreviewKind) -> &'static str {
    match kind {
        WorkBuilderPreviewKind::ProductAppPreview => "product-app-preview",
        WorkBuilderPreviewKind::AgentChat => "agent-chat",
        WorkBuilderPreviewKind::Sidecar => "sidecar",
        WorkBuilderPreviewKind::FullApp => "full-app",
        WorkBuilderPreviewKind::Embedded => "embedded",
        WorkBuilderPreviewKind::Capability => "capability",
        WorkBuilderPreviewKind::AgentEval => "agent-eval",
        WorkBuilderPreviewKind::RuntimeBoundary => "runtime-boundary",
        WorkBuilderPreviewKind::RuntimeDependencies => "runtime-dependencies",
        WorkBuilderPreviewKind::PermissionReview => "permission-review",
        WorkBuilderPreviewKind::UserPathRehearsal => "user-path-rehearsal",
        WorkBuilderPreviewKind::ReleaseRehearsal => "release-rehearsal",
    }
}

fn preview_source_label(source: WorkBuilderPreviewSource) -> &'static str {
    match source {
        WorkBuilderPreviewSource::RuntimeFact => "runtime-fact",
        WorkBuilderPreviewSource::RuntimeObservation => "runtime-observation",
        WorkBuilderPreviewSource::PreviewHarness => "preview-harness",
        WorkBuilderPreviewSource::FixRerun => "fix-rerun",
        WorkBuilderPreviewSource::ReleaseRehearsal => "release-rehearsal",
    }
}

fn validation_issue_message(check: &WorkBuilderFactCheck) -> String {
    check
        .detail
        .as_deref()
        .filter(|detail| !detail.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("Validation check '{}' is {:?}", check.id, check.status))
}

fn validation_issue_category(check: &WorkBuilderFactCheck) -> String {
    format!("validation:{}", check.id)
}

fn validation_issue_matches_target(
    issue: &WorkBuilderIssue,
    validation_result: &WorkBuilderValidationResult,
) -> bool {
    match validation_result.target_kind {
        WorkBuilderValidationTargetKind::ProductApp => {
            issue.product_app_id.as_deref() == validation_result.app_id.as_deref()
        }
        WorkBuilderValidationTargetKind::Component => {
            issue.component_id.as_deref() == validation_result.component_id.as_deref()
        }
    }
}

fn reopen_existing_builder_issue(record: &mut WorkRecord, issue_id: &str) {
    if let Some(existing) = record
        .builder_issues
        .iter_mut()
        .find(|existing| existing.id == issue_id)
    {
        existing.status = WorkBuilderIssueStatus::Open;
        existing.resolved_at = None;
    }
}

fn builder_issue_severity_for_log(level: WorkRuntimeLogLevel) -> Option<WorkRuntimeIssueSeverity> {
    match level {
        WorkRuntimeLogLevel::Error => Some(WorkRuntimeIssueSeverity::Fatal),
        WorkRuntimeLogLevel::Warn => Some(WorkRuntimeIssueSeverity::Warning),
        WorkRuntimeLogLevel::Debug | WorkRuntimeLogLevel::Info => None,
    }
}

fn builder_preview_result_id(runtime_instance_id: &str) -> String {
    format!("preview:{runtime_instance_id}")
}

fn release_rehearsal_preview_result_id(work_id: &WorkId) -> String {
    format!("preview:release-rehearsal:{work_id}")
}

fn capability_preview_result_id(validation_result: &WorkBuilderValidationResult) -> String {
    format!(
        "preview:capability:{}",
        compact_id_part(&validation_target_key(validation_result))
    )
}

fn builder_issue_id(parts: &[&str]) -> String {
    format!(
        "builder-issue:{}",
        parts
            .iter()
            .map(|part| compact_id_part(part))
            .collect::<Vec<_>>()
            .join(":")
    )
}

fn compact_id_part(value: &str) -> String {
    let mut part = value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | ':') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    while part.contains("--") {
        part = part.replace("--", "-");
    }
    let part = part.trim_matches('-').chars().take(96).collect::<String>();
    if part.is_empty() {
        "unknown".to_string()
    } else {
        part
    }
}

fn runtime_issue_severity_str(severity: WorkRuntimeIssueSeverity) -> &'static str {
    match severity {
        WorkRuntimeIssueSeverity::Fatal => "fatal",
        WorkRuntimeIssueSeverity::Warning => "warning",
        WorkRuntimeIssueSeverity::Noise => "noise",
    }
}

fn runtime_log_level_str(level: WorkRuntimeLogLevel) -> &'static str {
    match level {
        WorkRuntimeLogLevel::Debug => "debug",
        WorkRuntimeLogLevel::Info => "info",
        WorkRuntimeLogLevel::Warn => "warn",
        WorkRuntimeLogLevel::Error => "error",
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;

    use super::super::execution_graph::{
        WorkBuilderFactStatus, WorkBuilderIssueStatus, WorkRuntimeInstanceStatus,
        WorkRuntimeIssueSeverity, WorkRuntimeLogLevel,
    };
    use super::super::hooks::{WorkCleanupAction, WorkCleanupItemStatus, WorkResourceOwnership};
    use super::super::record::ArtifactRuntimeProvenance;
    use super::*;
    use crate::agentic_os::work::store::MemoryWorkStore;
    use crate::agentic_os::work::subject::WorkAppRelationRole;
    use crate::app_platform::list_installed_product_apps;

    #[derive(Debug)]
    struct TestRuntimeBridge;

    #[async_trait]
    impl WorkRuntimeBridge for TestRuntimeBridge {
        async fn create_work_session(
            &self,
            request: CreateWorkSessionRequest,
        ) -> CoreResult<super::super::runtime_bridge::CreateWorkSessionOutcome> {
            Ok(super::super::runtime_bridge::CreateWorkSessionOutcome {
                session_id: format!("session_{}", request.work_id.as_str()),
                session_name: request.title,
                agent_type: request.agent_type,
            })
        }

        async fn advance_work_session(
            &self,
            request: WorkSessionAdvanceRequest,
        ) -> CoreResult<super::super::runtime_bridge::WorkSessionAdvanceOutcome> {
            Ok(super::super::runtime_bridge::WorkSessionAdvanceOutcome {
                session_id: request.session_id,
                turn_id: format!("turn_{}", request.work_id.as_str()),
                started: true,
            })
        }
    }

    #[derive(Debug, Default)]
    struct RecordingRuntimeBridge {
        deleted_sessions: Mutex<Vec<(String, String)>>,
    }

    #[async_trait]
    impl WorkRuntimeBridge for RecordingRuntimeBridge {
        async fn create_work_session(
            &self,
            request: CreateWorkSessionRequest,
        ) -> CoreResult<super::super::runtime_bridge::CreateWorkSessionOutcome> {
            Ok(super::super::runtime_bridge::CreateWorkSessionOutcome {
                session_id: format!("session_{}", request.work_id.as_str()),
                session_name: request.title,
                agent_type: request.agent_type,
            })
        }

        async fn advance_work_session(
            &self,
            request: WorkSessionAdvanceRequest,
        ) -> CoreResult<super::super::runtime_bridge::WorkSessionAdvanceOutcome> {
            Ok(super::super::runtime_bridge::WorkSessionAdvanceOutcome {
                session_id: request.session_id,
                turn_id: format!("turn_{}", request.work_id.as_str()),
                started: true,
            })
        }

        async fn delete_work_session(
            &self,
            workspace_path: &str,
            session_id: &str,
        ) -> CoreResult<()> {
            self.deleted_sessions
                .lock()
                .expect("deleted sessions lock")
                .push((workspace_path.to_string(), session_id.to_string()));
            Ok(())
        }
    }

    fn service() -> WorkService {
        WorkService::with_runtime_bridge(
            Arc::new(MemoryWorkStore::new()),
            Arc::new(TestRuntimeBridge),
        )
    }

    fn passed_runtime_preview_checks() -> Vec<WorkBuilderFactCheck> {
        vec![
            WorkBuilderFactCheck {
                id: "runtimeReady".to_string(),
                status: WorkBuilderFactStatus::Passed,
                detail: Some("Runtime bridge reported ready.".to_string()),
            },
            WorkBuilderFactCheck {
                id: "visualRoot".to_string(),
                status: WorkBuilderFactStatus::Passed,
                detail: Some("Runtime DOM reported visible elements.".to_string()),
            },
            WorkBuilderFactCheck {
                id: "viewport".to_string(),
                status: WorkBuilderFactStatus::Passed,
                detail: Some("Runtime viewport reported non-zero size.".to_string()),
            },
            WorkBuilderFactCheck {
                id: "interactionSurface".to_string(),
                status: WorkBuilderFactStatus::Passed,
                detail: Some("Runtime interaction surface was verified.".to_string()),
            },
        ]
    }

    #[tokio::test]
    async fn work_record_round_trips() {
        let service = service();
        let record = service
            .create(CreateWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Fix login".to_string(),
                objective: "Investigate and fix login".to_string(),
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkCenter,
                primary_surface: None,
                assignment: None,
                title_state: None,
                delegation: None,
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
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                primary_surface: None,
                assignment: Some(WorkAssignmentRef::agent("Runno")),
                title_state: None,
                delegation: None,
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
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                primary_surface: None,
                assignment: Some(WorkAssignmentRef::agent("Runno")),
                title_state: Some(WorkTitleState::template()),
                delegation: None,
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
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                primary_surface: None,
                assignment: Some(WorkAssignmentRef::agent("Runno")),
                title_state: Some(WorkTitleState::template()),
                delegation: None,
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
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                primary_surface: None,
                assignment: Some(WorkAssignmentRef::agent("Runno")),
                title_state: None,
                delegation: None,
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
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                primary_surface: None,
                assignment: Some(WorkAssignmentRef::agent("Runno")),
                title_state: Some(WorkTitleState::template()),
                delegation: None,
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
    async fn application_surface_work_title_can_follow_application_name() {
        let service = service();
        let record = service
            .create(CreateWorkRequest {
                kind: WorkKind::AppWorkflow,
                title: "Old app name".to_string(),
                objective: "Run the app workflow".to_string(),
                subject: WorkSubject::App {
                    app: WorkAppRef::product_app("product-app-1", "1.0.0", "sha256:test-lock"),
                    intent: Default::default(),
                },
                app_refs: Vec::new(),
                scope: WorkScope::System,
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::ApplicationSurface,
                primary_surface: Some(WorkSurfaceRef::ApplicationSurface {
                    product_app_id: "product-app-1".to_string(),
                    product_app_surface_id: "product-app-1-surface".to_string(),
                    surface_id: "primary".to_string(),
                }),
                assignment: None,
                title_state: None,
                delegation: None,
            })
            .await
            .expect("create application surface work");

        assert_eq!(
            record.title_state.source,
            WorkTitleSource::ApplicationSurface
        );
        assert_eq!(
            record.title_state.subject_ref.as_deref(),
            Some("product-app-1")
        );

        let updated = service
            .sync_title_from_application_surface("product-app-1", "Expense Tracker")
            .await
            .expect("sync application surface title");

        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0].title, "Expense Tracker");
        assert_eq!(
            updated[0].title_state.source,
            WorkTitleSource::ApplicationSurface
        );
    }

    #[tokio::test]
    async fn resolve_app_work_creates_and_reuses_app_subject_work() {
        let service = service();
        let app = WorkAppRef::product_app("product-app-1", "1.0.0", "sha256:test-lock");
        let first = service
            .resolve_app_work(ResolveAppWorkRequest {
                app: app.clone(),
                intent: WorkAppIntent::Run,
                title: "Run Expense Tracker".to_string(),
                objective: "Use the Product App".to_string(),
                scope: WorkScope::System,
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::ApplicationSurface,
                primary_surface: Some(WorkSurfaceRef::ApplicationSurface {
                    product_app_id: "product-app-1".to_string(),
                    product_app_surface_id: "product-app-1-surface".to_string(),
                    surface_id: "primary".to_string(),
                }),
                assignment: Some(WorkAssignmentRef {
                    kind: WorkAssignmentKind::Application,
                    agent_type: None,
                    assistant_id: None,
                    application_id: Some("product-app-1".to_string()),
                    human_label: None,
                    external_label: None,
                }),
                app_refs: vec![WorkAppRelation {
                    app: app.clone(),
                    role: WorkAppRelationRole::Executor,
                    surface_id: None,
                }],
            })
            .await
            .expect("resolve app work");

        assert!(first.created);
        assert_eq!(first.work.kind, WorkKind::AppWorkflow);
        assert_eq!(
            first.work.subject,
            WorkSubject::App {
                app: app.clone(),
                intent: WorkAppIntent::Run,
            }
        );
        assert!(matches!(
            first.work.primary_surface,
            WorkSurfaceRef::ApplicationSurface {
                ref product_app_id,
                ref product_app_surface_id,
                ref surface_id,
            } if product_app_id == "product-app-1"
                && product_app_surface_id == "product-app-1-surface"
                && surface_id == "primary"
        ));
        assert_eq!(first.work.runtime_instances.len(), 1);
        assert_eq!(first.work.status, WorkStatus::Active);
        assert!(first.work.execution_bindings.is_empty());
        assert_eq!(
            first.work.runtime_instances[0].product_app_id,
            "product-app-1"
        );
        assert_eq!(first.work.runtime_instances[0].app_version, "1.0.0");
        assert_eq!(
            first.work.runtime_instances[0].component_lock_digest,
            "sha256:test-lock"
        );
        assert_eq!(
            first.work.runtime_instances[0].product_app_surface_id,
            "product-app-1-surface"
        );
        assert!(first.work.references_app(&app));
        assert!(first.work.app_refs.iter().any(|relation| {
            relation.app == app && relation.role == WorkAppRelationRole::Subject
        }));
        assert!(first.work.app_refs.iter().any(|relation| {
            relation.app == app && relation.role == WorkAppRelationRole::Executor
        }));

        let second = service
            .resolve_app_work(ResolveAppWorkRequest {
                app: app.clone(),
                intent: WorkAppIntent::Run,
                title: "Different title".to_string(),
                objective: "Different objective".to_string(),
                scope: WorkScope::System,
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::ApplicationSurface,
                primary_surface: Some(WorkSurfaceRef::ApplicationSurface {
                    product_app_id: "product-app-1".to_string(),
                    product_app_surface_id: "product-app-1-surface".to_string(),
                    surface_id: "primary".to_string(),
                }),
                assignment: None,
                app_refs: Vec::new(),
            })
            .await
            .expect("reuse app work");

        assert!(!second.created);
        assert_eq!(second.work.id, first.work.id);
    }

    #[tokio::test]
    async fn resolve_component_work_creates_and_reuses_component_subject_work() {
        let service = service();
        let component = WorkComponentRef::component(
            "agent-1",
            "agent",
            "1.0.0",
            "D:/workspace/project/.sparo_os/components/agent-1",
        );
        let first = service
            .resolve_component_work(ResolveComponentWorkRequest {
                component: component.clone(),
                intent: WorkComponentIntent::Develop,
                title: "Agent Component package".to_string(),
                objective: "Develop the agent Component package".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Secondary,
                primary_surface_policy: PrimarySurfacePolicy::WorkCenter,
                assignment: None,
            })
            .await
            .expect("resolve component work");

        assert!(first.created);
        assert_eq!(first.work.kind, WorkKind::AppWorkflow);
        assert_eq!(first.work.visibility, WorkVisibility::Secondary);
        assert!(matches!(
            first.work.primary_surface,
            WorkSurfaceRef::WorkCenter { ref work_id } if work_id == &first.work.id
        ));
        assert_eq!(
            first.work.subject,
            WorkSubject::Component {
                component: component.clone(),
                intent: WorkComponentIntent::Develop,
            }
        );
        assert!(first.work.references_component(&component));
        assert!(first.work.app_refs.is_empty());

        let second = service
            .resolve_component_work(ResolveComponentWorkRequest {
                component: component.clone(),
                intent: WorkComponentIntent::Develop,
                title: "Different title".to_string(),
                objective: "Different objective".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkCenter,
                assignment: None,
            })
            .await
            .expect("reuse component work");

        assert!(!second.created);
        assert_eq!(second.work.id, first.work.id);

        let review = service
            .resolve_component_work(ResolveComponentWorkRequest {
                component,
                intent: WorkComponentIntent::Review,
                title: "Review Agent Component".to_string(),
                objective: "Review the agent Component package".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Secondary,
                primary_surface_policy: PrimarySurfacePolicy::WorkCenter,
                assignment: None,
            })
            .await
            .expect("resolve review component work");

        assert!(review.created);
        assert_ne!(review.work.id, first.work.id);
    }

    #[tokio::test]
    async fn execution_graph_uses_work_owned_runtime_facts() {
        let service = service();
        let app = WorkAppRef::product_app("product-app-1", "1.0.0", "sha256:test-lock");
        let response = service
            .resolve_app_work(ResolveAppWorkRequest {
                app: app.clone(),
                intent: WorkAppIntent::Run,
                title: "Run Expense Tracker".to_string(),
                objective: "Use the Product App".to_string(),
                scope: WorkScope::System,
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::ApplicationSurface,
                primary_surface: Some(WorkSurfaceRef::ApplicationSurface {
                    product_app_id: "product-app-1".to_string(),
                    product_app_surface_id: "product-app-1-surface".to_string(),
                    surface_id: "primary".to_string(),
                }),
                assignment: None,
                app_refs: Vec::new(),
            })
            .await
            .expect("resolve app work");

        let work_id = response.work.id;
        let runtime_instance_id = response.work.runtime_instances[0].id.clone();
        service
            .record_runtime_run(
                &work_id,
                WorkRuntimeRun {
                    run_id: "run-1".to_string(),
                    runtime_instance_id: runtime_instance_id.clone(),
                    component_id: "product-app-1-surface".to_string(),
                    component_kind: "surface".to_string(),
                    action: "render".to_string(),
                    status: WorkRuntimeRunStatus::Completed,
                    started_at: 100,
                    updated_at: 120,
                    artifact_count: 1,
                    event_count: 3,
                    error: None,
                },
            )
            .await
            .expect("record runtime run");
        service
            .bind_artifact(
                &work_id,
                ArtifactRef {
                    id: "artifact-1".to_string(),
                    label: Some("Preview".to_string()),
                    uri: Some("file:///preview.png".to_string()),
                    runtime_provenance: Some(ArtifactRuntimeProvenance {
                        runtime_instance_id: runtime_instance_id.clone(),
                        run_id: "run-1".to_string(),
                        component_id: "product-app-1-surface".to_string(),
                        action: "render".to_string(),
                    }),
                },
            )
            .await
            .expect("bind artifact");
        service
            .record_runtime_issue(
                &work_id,
                WorkRuntimeIssue {
                    runtime_instance_id: runtime_instance_id.clone(),
                    product_app_id: "product-app-1".to_string(),
                    component_id: "product-app-1-surface".to_string(),
                    severity: WorkRuntimeIssueSeverity::Warning,
                    message: "Missing optional panel".to_string(),
                    source: Some("surface".to_string()),
                    category: Some("diagnostics".to_string()),
                    timestamp_ms: 130,
                },
            )
            .await
            .expect("record runtime issue");
        service
            .record_runtime_log(
                &work_id,
                WorkRuntimeLog {
                    runtime_instance_id: runtime_instance_id.clone(),
                    product_app_id: "product-app-1".to_string(),
                    component_id: "product-app-1-surface".to_string(),
                    level: WorkRuntimeLogLevel::Warn,
                    category: "runtime".to_string(),
                    message: "Panel fallback used".to_string(),
                    source: Some("surface".to_string()),
                    timestamp_ms: 140,
                },
            )
            .await
            .expect("record runtime log");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        assert_eq!(graph.summary.runtime_instance_count, 1);
        assert_eq!(graph.summary.runtime_run_count, 1);
        assert_eq!(graph.summary.artifact_count, 1);
        assert_eq!(graph.summary.issue_count, 1);
        assert_eq!(graph.summary.warning_count, 2);
        assert!(graph
            .summary
            .last_activity_at
            .is_some_and(|value| value >= 140));
        assert_eq!(
            graph.runtime_instances[0].status,
            WorkRuntimeInstanceStatus::Completed
        );
        assert_eq!(graph.runtime_instances[0].runs[0].run_id, "run-1");
        assert_eq!(
            graph.runtime_instances[0].artifacts[0]
                .runtime_instance_id
                .as_deref(),
            Some(runtime_instance_id.as_str())
        );
        assert_eq!(graph.builder_issues.len(), 2);
        assert!(graph
            .builder_issues
            .iter()
            .all(|issue| issue.status == WorkBuilderIssueStatus::Open));
        assert_eq!(graph.builder_preview_results.len(), 1);
        assert_eq!(
            graph.builder_preview_results[0].id,
            format!("preview:{runtime_instance_id}")
        );
        assert_eq!(
            graph.builder_preview_results[0].status,
            WorkBuilderFactStatus::Warning
        );
        assert_eq!(graph.builder_preview_results[0].warning_issue_count, 2);

        for issue_id in graph
            .builder_issues
            .iter()
            .map(|issue| issue.id.clone())
            .collect::<Vec<_>>()
        {
            service
                .update_builder_issue_status(&work_id, &issue_id, WorkBuilderIssueStatus::Fixed)
                .await
                .expect("mark builder issue fixed");
        }
        let graph = service.execution_graph(&work_id).await.expect("graph");
        assert!(graph
            .builder_issues
            .iter()
            .all(|issue| issue.status == WorkBuilderIssueStatus::Fixed));
        assert_eq!(
            graph.builder_preview_results[0].status,
            WorkBuilderFactStatus::Ready
        );
        assert_eq!(graph.builder_preview_results[0].issue_count, 0);
    }

    #[tokio::test]
    async fn builder_validation_result_records_fact_and_resolves_validation_issues() {
        let app_ref = WorkAppRef::product_app("product-app-1", "1.0.0", "sha256:lock");
        let service = service();
        let work = service
            .create(CreateWorkRequest {
                kind: WorkKind::AppWorkflow,
                title: "Product App development".to_string(),
                objective: "Develop Product App".to_string(),
                subject: WorkSubject::App {
                    app: app_ref,
                    intent: WorkAppIntent::Develop,
                },
                app_refs: Vec::new(),
                scope: WorkScope::System,
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkCenter,
                primary_surface: None,
                assignment: None,
                title_state: None,
                delegation: None,
            })
            .await
            .expect("create work");
        let work_id = work.id.clone();

        service
            .record_builder_validation_result(
                &work_id,
                WorkBuilderValidationResult {
                    id: "validation:product-app:product-app-1".to_string(),
                    tool_name: "ValidateProductAppPackage".to_string(),
                    target_kind: WorkBuilderValidationTargetKind::ProductApp,
                    status: WorkBuilderFactStatus::Failed,
                    work_id: work_id.clone(),
                    app_id: Some("product-app-1".to_string()),
                    component_id: None,
                    component_kind: None,
                    version: Some("1.0.0".to_string()),
                    package_root: Some("product-app://product-app-1@1.0.0".to_string()),
                    observed_at: 200,
                    failed_count: 1,
                    warning_count: 0,
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "package".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Package exists.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "releaseGate".to_string(),
                            status: WorkBuilderFactStatus::Failed,
                            detail: Some("Release gate is blocked.".to_string()),
                        },
                    ],
                },
            )
            .await
            .expect("record validation result");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        assert_eq!(graph.builder_validation_results.len(), 1);
        assert_eq!(
            graph.builder_validation_results[0].status,
            WorkBuilderFactStatus::Failed
        );
        assert_eq!(graph.builder_issues.len(), 1);
        assert_eq!(
            graph.builder_issues[0].origin,
            WorkBuilderIssueOrigin::Validation
        );
        assert_eq!(graph.builder_issues[0].status, WorkBuilderIssueStatus::Open);
        assert_eq!(
            graph.builder_issues[0].category.as_deref(),
            Some("validation:releaseGate")
        );
        let release_rehearsal = graph
            .builder_preview_results
            .iter()
            .find(|preview| preview.kind == WorkBuilderPreviewKind::ReleaseRehearsal)
            .expect("release rehearsal preview result");
        assert_eq!(release_rehearsal.status, WorkBuilderFactStatus::Failed);
        assert_eq!(
            release_rehearsal.source,
            WorkBuilderPreviewSource::ReleaseRehearsal
        );
        assert_eq!(release_rehearsal.fatal_issue_count, 1);

        service
            .record_builder_validation_result(
                &work_id,
                WorkBuilderValidationResult {
                    id: "validation:product-app:product-app-1".to_string(),
                    tool_name: "ValidateProductAppPackage".to_string(),
                    target_kind: WorkBuilderValidationTargetKind::ProductApp,
                    status: WorkBuilderFactStatus::Passed,
                    work_id: work_id.clone(),
                    app_id: Some("product-app-1".to_string()),
                    component_id: None,
                    component_kind: None,
                    version: Some("1.0.0".to_string()),
                    package_root: Some("product-app://product-app-1@1.0.0".to_string()),
                    observed_at: 300,
                    failed_count: 0,
                    warning_count: 0,
                    checks: vec![WorkBuilderFactCheck {
                        id: "releaseGate".to_string(),
                        status: WorkBuilderFactStatus::Passed,
                        detail: Some("Release gate passed.".to_string()),
                    }],
                },
            )
            .await
            .expect("record passing validation result");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        assert_eq!(
            graph.builder_validation_results[0].status,
            WorkBuilderFactStatus::Passed
        );
        assert_eq!(graph.builder_issues.len(), 1);
        assert_eq!(
            graph.builder_issues[0].status,
            WorkBuilderIssueStatus::Fixed
        );
        assert!(graph.builder_issues[0].resolved_at.is_some());
        let release_rehearsal = graph
            .builder_preview_results
            .iter()
            .find(|preview| preview.kind == WorkBuilderPreviewKind::ReleaseRehearsal)
            .expect("release rehearsal preview result");
        assert_eq!(release_rehearsal.status, WorkBuilderFactStatus::NotVerified);
    }

    #[test]
    fn release_readiness_harness_evidence_requires_runtime_observation_source() {
        let work_id = WorkId::generate();
        let mut preview = WorkBuilderPreviewResult {
            id: "preview:runtime-boundary:runtime-1".to_string(),
            kind: WorkBuilderPreviewKind::RuntimeBoundary,
            status: WorkBuilderFactStatus::Passed,
            source: WorkBuilderPreviewSource::PreviewHarness,
            harness_mode: Some("runtime-boundary".to_string()),
            trigger_turn_id: None,
            detail: Some(
                "Tool-level preview harness result should not satisfy release readiness."
                    .to_string(),
            ),
            checks: vec![WorkBuilderFactCheck {
                id: "runtimeStorage".to_string(),
                status: WorkBuilderFactStatus::Passed,
                detail: Some("Runtime storage passed.".to_string()),
            }],
            work_id,
            runtime_instance_id: Some("runtime-1".to_string()),
            product_app_id: Some("product-app-1".to_string()),
            component_id: Some("surface-1".to_string()),
            product_app_surface_id: Some("surface-1".to_string()),
            surface_id: Some("primary".to_string()),
            observed_at: 100,
            issue_count: 0,
            fatal_issue_count: 0,
            warning_issue_count: 0,
        };

        assert!(!is_release_readiness_harness_evidence(&preview));

        preview.source = WorkBuilderPreviewSource::RuntimeObservation;
        assert!(is_release_readiness_harness_evidence(&preview));
    }

    #[test]
    fn component_runtime_readiness_preview_source_requires_strong_evidence() {
        assert!(component_runtime_preview_source_is_strong(
            "runtimeDependencies",
            WorkBuilderPreviewSource::RuntimeObservation
        ));
        assert!(!component_runtime_preview_source_is_strong(
            "runtimeDependencies",
            WorkBuilderPreviewSource::PreviewHarness
        ));
        assert!(!component_runtime_preview_source_is_strong(
            "runtimeDependencies",
            WorkBuilderPreviewSource::RuntimeFact
        ));
        assert!(component_runtime_preview_source_is_strong(
            "agentEval",
            WorkBuilderPreviewSource::PreviewHarness
        ));
    }

    #[tokio::test]
    async fn component_validation_derives_capability_preview_result() {
        let service = service();
        let component = WorkComponentRef::component(
            "shared-agent",
            "agents",
            "1.0.0",
            "D:/workspace/project/.sparo_os/components/agents/shared-agent/1.0.0",
        );
        let response = service
            .resolve_component_work(ResolveComponentWorkRequest {
                component: component.clone(),
                intent: WorkComponentIntent::Develop,
                title: "Shared Agent Component package".to_string(),
                objective: "Develop the shared agent Component package".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Secondary,
                primary_surface_policy: PrimarySurfacePolicy::WorkCenter,
                assignment: None,
            })
            .await
            .expect("resolve component work");
        let work_id = response.work.id.clone();

        service
            .record_builder_validation_result(
                &work_id,
                WorkBuilderValidationResult {
                    id: "validation:component:agents:shared-agent".to_string(),
                    tool_name: "ValidateComponentPackage".to_string(),
                    target_kind: WorkBuilderValidationTargetKind::Component,
                    status: WorkBuilderFactStatus::Warning,
                    work_id: work_id.clone(),
                    app_id: None,
                    component_id: Some("shared-agent".to_string()),
                    component_kind: Some("agents".to_string()),
                    version: Some("1.0.0".to_string()),
                    package_root: Some(component.package_root.clone()),
                    observed_at: 250,
                    failed_count: 0,
                    warning_count: 1,
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "componentContract".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Contract exists.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "capabilities".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Capabilities are declared.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "agentEval".to_string(),
                            status: WorkBuilderFactStatus::Warning,
                            detail: Some("Representative eval has not passed yet.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "consumerCompatibility".to_string(),
                            status: WorkBuilderFactStatus::Warning,
                            detail: Some("No consumer app verified.".to_string()),
                        },
                    ],
                },
            )
            .await
            .expect("record component validation");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        let capability_preview = graph
            .builder_preview_results
            .iter()
            .find(|preview| preview.kind == WorkBuilderPreviewKind::Capability)
            .expect("capability preview result");
        assert_eq!(capability_preview.status, WorkBuilderFactStatus::Warning);
        assert_eq!(
            capability_preview.source,
            WorkBuilderPreviewSource::PreviewHarness
        );
        assert_eq!(
            capability_preview.harness_mode.as_deref(),
            Some("capability")
        );
        assert_eq!(capability_preview.observed_at, 250);
        assert_eq!(capability_preview.issue_count, 1);
        assert_eq!(capability_preview.warning_issue_count, 1);
        assert_eq!(capability_preview.fatal_issue_count, 0);
        assert!(capability_preview
            .detail
            .as_deref()
            .is_some_and(|detail| detail.contains("agentEval")));
        assert_eq!(
            capability_preview
                .checks
                .iter()
                .map(|check| check.id.as_str())
                .collect::<Vec<_>>(),
            vec!["componentContract", "capabilities", "agentEval"]
        );
        assert!(graph.builder_issues.iter().any(|issue| {
            issue.category.as_deref() == Some("validation:agentEval")
                && issue.origin == WorkBuilderIssueOrigin::Validation
        }));
        assert!(graph
            .builder_issues
            .iter()
            .all(
                |issue| issue.category.as_deref() != Some("validation:consumerCompatibility")
                    || issue.origin == WorkBuilderIssueOrigin::Validation
            ));

        service
            .record_builder_validation_result(
                &work_id,
                WorkBuilderValidationResult {
                    id: "validation:component:agents:shared-agent".to_string(),
                    tool_name: "ValidateComponentPackage".to_string(),
                    target_kind: WorkBuilderValidationTargetKind::Component,
                    status: WorkBuilderFactStatus::Passed,
                    work_id: work_id.clone(),
                    app_id: None,
                    component_id: Some("shared-agent".to_string()),
                    component_kind: Some("agents".to_string()),
                    version: Some("1.0.0".to_string()),
                    package_root: Some(component.package_root),
                    observed_at: 300,
                    failed_count: 0,
                    warning_count: 0,
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "componentContract".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Contract exists.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "capabilities".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Capabilities are declared.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "dependencies".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Only shared dependencies are declared.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "implementation".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("implementationRef resolves.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "consumerCompatibility".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Consumer Product App lock validated.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "permissions".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Permission boundary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "data".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Data boundary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "releaseGate".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Component validation release gate passed.".to_string()),
                        },
                    ],
                },
            )
            .await
            .expect("record passing component validation");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        let capability_preview = graph
            .builder_preview_results
            .iter()
            .find(|preview| preview.kind == WorkBuilderPreviewKind::Capability)
            .expect("capability preview result");
        assert_eq!(capability_preview.status, WorkBuilderFactStatus::Passed);
        assert_eq!(capability_preview.issue_count, 0);
        let release_rehearsal = graph
            .builder_preview_results
            .iter()
            .find(|preview| preview.kind == WorkBuilderPreviewKind::ReleaseRehearsal)
            .expect("release rehearsal preview result");
        assert_eq!(release_rehearsal.status, WorkBuilderFactStatus::NotVerified);
        assert!(release_rehearsal
            .detail
            .as_deref()
            .is_some_and(|detail| detail.contains("agentEval")));
        assert!(release_rehearsal.checks.iter().any(|check| {
            check.id == "consumerCompatibility"
                && check.status == WorkBuilderFactStatus::NotVerified
        }));
        assert_eq!(
            release_rehearsal
                .checks
                .iter()
                .map(|check| check.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "validation",
                "preview",
                "issues",
                "componentContract",
                "capabilities",
                "dependencies",
                "implementation",
                "consumerCompatibility",
                "permissions",
                "data",
                "dataSummary",
                "runtimeDependencies",
                "agentEval",
                "releaseGate"
            ]
        );
        assert!(graph
            .builder_issues
            .iter()
            .all(|issue| issue.status == WorkBuilderIssueStatus::Fixed));
    }

    #[tokio::test]
    async fn component_release_rehearsal_passes_with_component_readiness_evidence() {
        let service = service();
        let component = WorkComponentRef::component(
            "shared-agent",
            "agents",
            "1.0.0",
            "D:/workspace/project/.sparo_os/components/agents/shared-agent/1.0.0",
        );
        let response = service
            .resolve_component_work(ResolveComponentWorkRequest {
                component: component.clone(),
                intent: WorkComponentIntent::Develop,
                title: "Shared Agent Component package".to_string(),
                objective: "Release the shared agent Component package".to_string(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Secondary,
                primary_surface_policy: PrimarySurfacePolicy::WorkCenter,
                assignment: None,
            })
            .await
            .expect("resolve component work");
        let work_id = response.work.id.clone();

        service
            .record_builder_validation_result(
                &work_id,
                WorkBuilderValidationResult {
                    id: "validation:component:agents:shared-agent".to_string(),
                    tool_name: "ValidateComponentPackage".to_string(),
                    target_kind: WorkBuilderValidationTargetKind::Component,
                    status: WorkBuilderFactStatus::Passed,
                    work_id: work_id.clone(),
                    app_id: None,
                    component_id: Some("shared-agent".to_string()),
                    component_kind: Some("agents".to_string()),
                    version: Some("1.0.0".to_string()),
                    package_root: Some(component.package_root),
                    observed_at: 200,
                    failed_count: 0,
                    warning_count: 0,
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "componentContract".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Contract exists.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "capabilities".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Capabilities are declared.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "dependencies".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Only shared dependencies are declared.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "implementation".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("implementationRef resolves.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "consumerCompatibility".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Consumer Product App lock validated.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "permissions".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Permission boundary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "data".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Data boundary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "releaseGate".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Component validation release gate passed.".to_string()),
                        },
                    ],
                },
            )
            .await
            .expect("record component validation");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:consumer-compatibility:shared-agent".to_string(),
                    kind: WorkBuilderPreviewKind::Capability,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("consumer-compatibility".to_string()),
                    trigger_turn_id: None,
                    detail: Some(
                        "Consumer Product App loaded shared Component at runtime.".to_string(),
                    ),
                    checks: vec![WorkBuilderFactCheck {
                        id: "consumerCompatibility".to_string(),
                        status: WorkBuilderFactStatus::Passed,
                        detail: Some(
                            "Consuming Product App runtime-ready and primary preview checks passed."
                                .to_string(),
                        ),
                    }],
                    work_id: work_id.clone(),
                    runtime_instance_id: None,
                    product_app_id: Some("consumer-app".to_string()),
                    component_id: Some("shared-agent".to_string()),
                    product_app_surface_id: Some("consumer-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 290,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record consumer compatibility runtime evidence");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:component-runtime-boundary:shared-agent".to_string(),
                    kind: WorkBuilderPreviewKind::RuntimeBoundary,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("runtime-boundary".to_string()),
                    trigger_turn_id: None,
                    detail: Some(
                        "Component consumer runtime boundary evidence passed.".to_string(),
                    ),
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "data".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Consumer runtime data boundary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "dataSummary".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Consumer runtime data/share summary passed.".to_string()),
                        },
                    ],
                    work_id: work_id.clone(),
                    runtime_instance_id: None,
                    product_app_id: None,
                    component_id: Some("shared-agent".to_string()),
                    product_app_surface_id: Some("shared-agent".to_string()),
                    surface_id: None,
                    observed_at: 300,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record component runtime boundary evidence");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:component-release-evidence:shared-agent".to_string(),
                    kind: WorkBuilderPreviewKind::RuntimeDependencies,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("runtime-dependencies".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Component release evidence passed.".to_string()),
                    checks: vec![WorkBuilderFactCheck {
                        id: "runtimeDependencies".to_string(),
                        status: WorkBuilderFactStatus::Passed,
                        detail: Some("Consumer runtime dependencies are current.".to_string()),
                    }],
                    work_id: work_id.clone(),
                    runtime_instance_id: None,
                    product_app_id: None,
                    component_id: Some("shared-agent".to_string()),
                    product_app_surface_id: Some("shared-agent".to_string()),
                    surface_id: None,
                    observed_at: 305,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record component release evidence");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:agent-eval:shared-agent".to_string(),
                    kind: WorkBuilderPreviewKind::AgentEval,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::PreviewHarness,
                    harness_mode: Some("agent-eval".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Component Agent Eval evidence passed.".to_string()),
                    checks: vec![WorkBuilderFactCheck {
                        id: "agentEval".to_string(),
                        status: WorkBuilderFactStatus::Passed,
                        detail: Some("Representative Component eval passed.".to_string()),
                    }],
                    work_id: work_id.clone(),
                    runtime_instance_id: None,
                    product_app_id: None,
                    component_id: Some("shared-agent".to_string()),
                    product_app_surface_id: Some("shared-agent".to_string()),
                    surface_id: None,
                    observed_at: 310,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record component agent eval evidence");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        let release_rehearsal = graph
            .builder_preview_results
            .iter()
            .find(|preview| {
                preview.kind == WorkBuilderPreviewKind::ReleaseRehearsal
                    && preview.source == WorkBuilderPreviewSource::ReleaseRehearsal
            })
            .expect("release rehearsal preview result");
        assert_eq!(release_rehearsal.status, WorkBuilderFactStatus::Passed);
        assert_eq!(
            release_rehearsal
                .checks
                .iter()
                .map(|check| (check.id.as_str(), check.status))
                .collect::<Vec<_>>(),
            vec![
                ("validation", WorkBuilderFactStatus::Passed),
                ("preview", WorkBuilderFactStatus::Passed),
                ("issues", WorkBuilderFactStatus::Passed),
                ("componentContract", WorkBuilderFactStatus::Passed),
                ("capabilities", WorkBuilderFactStatus::Passed),
                ("dependencies", WorkBuilderFactStatus::Passed),
                ("implementation", WorkBuilderFactStatus::Passed),
                ("consumerCompatibility", WorkBuilderFactStatus::Passed),
                ("permissions", WorkBuilderFactStatus::Passed),
                ("data", WorkBuilderFactStatus::Passed),
                ("dataSummary", WorkBuilderFactStatus::Passed),
                ("runtimeDependencies", WorkBuilderFactStatus::Passed),
                ("agentEval", WorkBuilderFactStatus::Passed),
                ("releaseGate", WorkBuilderFactStatus::Passed),
            ]
        );
    }

    #[tokio::test]
    async fn release_rehearsal_passes_after_validation_and_preview_are_clean() {
        let service = service();
        let app = WorkAppRef::product_app("product-app-1", "1.0.0", "sha256:test-lock");
        let response = service
            .resolve_app_work(ResolveAppWorkRequest {
                app,
                intent: WorkAppIntent::Develop,
                title: "Product App Builder".to_string(),
                objective: "Verify release rehearsal".to_string(),
                scope: WorkScope::System,
                visibility: WorkVisibility::Secondary,
                primary_surface_policy: PrimarySurfacePolicy::ApplicationSurface,
                primary_surface: Some(WorkSurfaceRef::ApplicationSurface {
                    product_app_id: "product-app-1".to_string(),
                    product_app_surface_id: "product-app-1-surface".to_string(),
                    surface_id: "primary".to_string(),
                }),
                assignment: None,
                app_refs: Vec::new(),
            })
            .await
            .expect("resolve app work");
        let work_id = response.work.id.clone();
        let runtime_instance_id = response.work.runtime_instances[0].id.clone();

        service
            .record_builder_validation_result(
                &work_id,
                WorkBuilderValidationResult {
                    id: "validation:product-app:product-app-1".to_string(),
                    tool_name: "ValidateProductAppPackage".to_string(),
                    target_kind: WorkBuilderValidationTargetKind::ProductApp,
                    status: WorkBuilderFactStatus::Passed,
                    work_id: work_id.clone(),
                    app_id: Some("product-app-1".to_string()),
                    component_id: None,
                    component_kind: None,
                    version: Some("1.0.0".to_string()),
                    package_root: Some("product-app://product-app-1@1.0.0".to_string()),
                    observed_at: 200,
                    failed_count: 0,
                    warning_count: 0,
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "package".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Package exists.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "data".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some(
                                "1 work object kind declares the Product App data boundary."
                                    .to_string(),
                            ),
                        },
                        WorkBuilderFactCheck {
                            id: "dataLifecycle".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some(
                                "Data lifecycle policy declares retention and deletion."
                                    .to_string(),
                            ),
                        },
                        WorkBuilderFactCheck {
                            id: "releaseGate".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Release gate passed.".to_string()),
                        },
                    ],
                },
            )
            .await
            .expect("record validation result");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: format!("preview:{runtime_instance_id}"),
                    kind: WorkBuilderPreviewKind::ProductAppPreview,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("product-app-preview".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Preview iframe loaded.".to_string()),
                    checks: passed_runtime_preview_checks(),
                    work_id: work_id.clone(),
                    runtime_instance_id: Some(runtime_instance_id.clone()),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 300,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record preview result");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        let release_rehearsal = graph
            .builder_preview_results
            .iter()
            .find(|preview| {
                preview.kind == WorkBuilderPreviewKind::ReleaseRehearsal
                    && preview.source == WorkBuilderPreviewSource::ReleaseRehearsal
            })
            .expect("release rehearsal preview result");
        assert_eq!(release_rehearsal.status, WorkBuilderFactStatus::NotVerified);
        assert!(release_rehearsal
            .checks
            .iter()
            .any(|check| check.id == "criticalPath"
                && check.status == WorkBuilderFactStatus::NotVerified));
        assert!(release_rehearsal
            .checks
            .iter()
            .any(|check| check.id == "data" && check.status == WorkBuilderFactStatus::NotVerified));
        assert!(release_rehearsal.checks.iter().any(|check| {
            check.id == "dataLifecycle" && check.status == WorkBuilderFactStatus::NotVerified
        }));
        assert!(release_rehearsal.checks.iter().any(|check| {
            check.id == "runtimeStorage" && check.status == WorkBuilderFactStatus::NotVerified
        }));

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:release-rehearsal:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::ReleaseRehearsal,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::PreviewHarness,
                    harness_mode: Some("release-rehearsal".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Release rehearsal package evidence passed.".to_string()),
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "criticalPath".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Critical path rehearsal passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "permissions".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Permission boundary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "data".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Data boundary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "dataLifecycle".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Data lifecycle policy passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "dataSummary".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Data summary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "runtimeStorage".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Runtime storage scope passed.".to_string()),
                        },
                    ],
                    work_id: work_id.clone(),
                    runtime_instance_id: None,
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: None,
                    product_app_surface_id: None,
                    surface_id: None,
                    observed_at: 400,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record release rehearsal package evidence");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:agent-eval:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::AgentEval,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::PreviewHarness,
                    harness_mode: Some("agent-eval".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Agent Eval evidence passed.".to_string()),
                    checks: vec![WorkBuilderFactCheck {
                        id: "agentEval".to_string(),
                        status: WorkBuilderFactStatus::Passed,
                        detail: Some("Agent eval passed.".to_string()),
                    }],
                    work_id: work_id.clone(),
                    runtime_instance_id: None,
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: None,
                    product_app_surface_id: None,
                    surface_id: None,
                    observed_at: 410,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record agent eval evidence");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:runtime-boundary:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::RuntimeBoundary,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("runtime-boundary".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Runtime boundary evidence passed.".to_string()),
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "runtimeStorage".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Runtime storage scope resolved.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "permissions".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Runtime permission boundary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "data".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Runtime data boundary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "dataLifecycle".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some(
                                "Runtime retention and share-impact evidence passed.".to_string(),
                            ),
                        },
                        WorkBuilderFactCheck {
                            id: "dataSummary".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Runtime data summary passed.".to_string()),
                        },
                    ],
                    work_id: work_id.clone(),
                    runtime_instance_id: Some(runtime_instance_id.clone()),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 425,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record runtime boundary release rehearsal evidence");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:runtime-dependencies:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::RuntimeDependencies,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("runtime-dependencies".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Runtime dependency health evidence passed.".to_string()),
                    checks: vec![WorkBuilderFactCheck {
                        id: "runtimeDependencies".to_string(),
                        status: WorkBuilderFactStatus::Passed,
                        detail: Some("Runtime dependencies are installed and current.".to_string()),
                    }],
                    work_id: work_id.clone(),
                    runtime_instance_id: Some(runtime_instance_id.clone()),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 435,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record runtime dependency release rehearsal evidence");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:permission-review:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::PermissionReview,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("permission-review".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Explicit permission review evidence passed.".to_string()),
                    checks: vec![WorkBuilderFactCheck {
                        id: "permissionReview".to_string(),
                        status: WorkBuilderFactStatus::Passed,
                        detail: Some("Explicit App Builder permission review passed.".to_string()),
                    }],
                    work_id: work_id.clone(),
                    runtime_instance_id: Some(runtime_instance_id.clone()),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 440,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record permission review release rehearsal evidence");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:user-path-rehearsal:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::UserPathRehearsal,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("user-path-rehearsal".to_string()),
                    trigger_turn_id: None,
                    detail: Some("User path rehearsal passed.".to_string()),
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "criticalPath".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("New-user critical path rehearsal passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "userPath".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("User path rehearsal passed.".to_string()),
                        },
                    ],
                    work_id: work_id.clone(),
                    runtime_instance_id: Some(runtime_instance_id.clone()),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 450,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record user-path release rehearsal evidence");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        let release_rehearsal = graph
            .builder_preview_results
            .iter()
            .find(|preview| {
                preview.kind == WorkBuilderPreviewKind::ReleaseRehearsal
                    && preview.source == WorkBuilderPreviewSource::ReleaseRehearsal
            })
            .expect("release rehearsal preview result");
        assert_eq!(release_rehearsal.status, WorkBuilderFactStatus::Passed);
        assert_eq!(
            release_rehearsal.source,
            WorkBuilderPreviewSource::ReleaseRehearsal
        );
        assert_eq!(release_rehearsal.issue_count, 0);
        assert_eq!(
            release_rehearsal.product_app_id.as_deref(),
            Some("product-app-1")
        );
        assert_eq!(
            release_rehearsal
                .checks
                .iter()
                .map(|check| (check.id.as_str(), check.status))
                .collect::<Vec<_>>(),
            vec![
                ("validation", WorkBuilderFactStatus::Passed),
                ("preview", WorkBuilderFactStatus::Passed),
                ("issues", WorkBuilderFactStatus::Passed),
                ("criticalPath", WorkBuilderFactStatus::Passed),
                ("permissions", WorkBuilderFactStatus::Passed),
                ("permissionReview", WorkBuilderFactStatus::Passed),
                ("data", WorkBuilderFactStatus::Passed),
                ("dataLifecycle", WorkBuilderFactStatus::Passed),
                ("dataSummary", WorkBuilderFactStatus::Passed),
                ("runtimeStorage", WorkBuilderFactStatus::Passed),
                ("runtimeDependencies", WorkBuilderFactStatus::Passed),
                ("agentEval", WorkBuilderFactStatus::Passed),
                ("userPath", WorkBuilderFactStatus::Passed),
                ("releaseGate", WorkBuilderFactStatus::Passed),
            ]
        );
    }

    #[tokio::test]
    async fn release_rehearsal_does_not_use_validation_agent_eval_as_execution_evidence() {
        let service = service();
        let app = WorkAppRef::product_app("product-app-1", "1.0.0", "sha256:test-lock");
        let response = service
            .resolve_app_work(ResolveAppWorkRequest {
                app,
                intent: WorkAppIntent::Develop,
                title: "Product App Builder".to_string(),
                objective: "Verify release rehearsal".to_string(),
                scope: WorkScope::System,
                visibility: WorkVisibility::Secondary,
                primary_surface_policy: PrimarySurfacePolicy::ApplicationSurface,
                primary_surface: Some(WorkSurfaceRef::ApplicationSurface {
                    product_app_id: "product-app-1".to_string(),
                    product_app_surface_id: "product-app-1-surface".to_string(),
                    surface_id: "primary".to_string(),
                }),
                assignment: None,
                app_refs: Vec::new(),
            })
            .await
            .expect("resolve app work");
        let work_id = response.work.id.clone();
        let runtime_instance_id = response.work.runtime_instances[0].id.clone();

        service
            .record_builder_validation_result(
                &work_id,
                WorkBuilderValidationResult {
                    id: "validation:product-app:product-app-1".to_string(),
                    tool_name: "ValidateProductAppPackage".to_string(),
                    target_kind: WorkBuilderValidationTargetKind::ProductApp,
                    status: WorkBuilderFactStatus::Passed,
                    work_id: work_id.clone(),
                    app_id: Some("product-app-1".to_string()),
                    component_id: None,
                    component_kind: None,
                    version: Some("1.0.0".to_string()),
                    package_root: Some("product-app://product-app-1@1.0.0".to_string()),
                    observed_at: 200,
                    failed_count: 0,
                    warning_count: 0,
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "package".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Package exists.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "data".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Data boundary declared.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "agentEval".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some(
                                "Validation claimed Agent Eval passed, but did not run a harness."
                                    .to_string(),
                            ),
                        },
                        WorkBuilderFactCheck {
                            id: "releaseGate".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Release gate passed.".to_string()),
                        },
                    ],
                },
            )
            .await
            .expect("record validation result");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: format!("preview:{runtime_instance_id}"),
                    kind: WorkBuilderPreviewKind::ProductAppPreview,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("product-app-preview".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Preview iframe loaded.".to_string()),
                    checks: passed_runtime_preview_checks(),
                    work_id: work_id.clone(),
                    runtime_instance_id: Some(runtime_instance_id.clone()),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 300,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record preview result");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:release-rehearsal:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::ReleaseRehearsal,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::PreviewHarness,
                    harness_mode: Some("release-rehearsal".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Release rehearsal package evidence passed.".to_string()),
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "criticalPath".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Critical path rehearsal passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "permissions".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Permission boundary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "data".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Data boundary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "dataLifecycle".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Data lifecycle policy passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "dataSummary".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Data summary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "runtimeStorage".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Runtime storage scope passed.".to_string()),
                        },
                    ],
                    work_id: work_id.clone(),
                    runtime_instance_id: None,
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: None,
                    product_app_surface_id: None,
                    surface_id: None,
                    observed_at: 400,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record release rehearsal package evidence");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:user-path-rehearsal:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::UserPathRehearsal,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("user-path-rehearsal".to_string()),
                    trigger_turn_id: None,
                    detail: Some("User path rehearsal passed.".to_string()),
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "criticalPath".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("New-user critical path rehearsal passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "userPath".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("User path rehearsal passed.".to_string()),
                        },
                    ],
                    work_id: work_id.clone(),
                    runtime_instance_id: Some(runtime_instance_id),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 450,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record user-path release rehearsal evidence");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        let release_rehearsal = graph
            .builder_preview_results
            .iter()
            .find(|preview| {
                preview.kind == WorkBuilderPreviewKind::ReleaseRehearsal
                    && preview.source == WorkBuilderPreviewSource::ReleaseRehearsal
            })
            .expect("release rehearsal preview result");
        let agent_eval = release_rehearsal
            .checks
            .iter()
            .find(|check| check.id == "agentEval")
            .expect("agentEval check");

        assert_eq!(release_rehearsal.status, WorkBuilderFactStatus::NotVerified);
        assert_eq!(agent_eval.status, WorkBuilderFactStatus::NotVerified);
        assert!(agent_eval
            .detail
            .as_deref()
            .is_some_and(|detail| detail.contains("No Agent Eval readiness evidence")));
    }

    #[tokio::test]
    async fn release_rehearsal_absorbs_preview_harness_readiness_warnings() {
        let service = service();
        let app = WorkAppRef::product_app("product-app-1", "1.0.0", "sha256:test-lock");
        let response = service
            .resolve_app_work(ResolveAppWorkRequest {
                app,
                intent: WorkAppIntent::Develop,
                title: "Product App Builder".to_string(),
                objective: "Verify release rehearsal warnings".to_string(),
                scope: WorkScope::System,
                visibility: WorkVisibility::Secondary,
                primary_surface_policy: PrimarySurfacePolicy::ApplicationSurface,
                primary_surface: Some(WorkSurfaceRef::ApplicationSurface {
                    product_app_id: "product-app-1".to_string(),
                    product_app_surface_id: "product-app-1-surface".to_string(),
                    surface_id: "primary".to_string(),
                }),
                assignment: None,
                app_refs: Vec::new(),
            })
            .await
            .expect("resolve app work");
        let work_id = response.work.id.clone();

        service
            .record_builder_validation_result(
                &work_id,
                WorkBuilderValidationResult {
                    id: "validation:product-app:product-app-1".to_string(),
                    tool_name: "ValidateProductAppPackage".to_string(),
                    target_kind: WorkBuilderValidationTargetKind::ProductApp,
                    status: WorkBuilderFactStatus::Passed,
                    work_id: work_id.clone(),
                    app_id: Some("product-app-1".to_string()),
                    component_id: None,
                    component_kind: None,
                    version: Some("1.0.0".to_string()),
                    package_root: Some("product-app://product-app-1@1.0.0".to_string()),
                    observed_at: 200,
                    failed_count: 0,
                    warning_count: 0,
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "primarySurface".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Primary surface resolves.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "surfaceSource".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Surface source resolves.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "launchPolicy".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Launch policy resolves.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "dataLifecycle".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Data lifecycle policy passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "releaseGate".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Release gate validation passed.".to_string()),
                        },
                    ],
                },
            )
            .await
            .expect("record validation result");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:runtime:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::ProductAppPreview,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("product-app-preview".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Preview iframe loaded.".to_string()),
                    checks: passed_runtime_preview_checks(),
                    work_id: work_id.clone(),
                    runtime_instance_id: response
                        .work
                        .runtime_instances
                        .first()
                        .map(|instance| instance.id.clone()),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 300,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record preview result");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:runtime-boundary:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::RuntimeBoundary,
                    status: WorkBuilderFactStatus::Warning,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("runtime-boundary".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Runtime boundary found an elevated permission.".to_string()),
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "runtimeStorage".to_string(),
                            status: WorkBuilderFactStatus::NotVerified,
                            detail: Some("Runtime storage scope has not been probed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "permissions".to_string(),
                            status: WorkBuilderFactStatus::Warning,
                            detail: Some("Elevated permission declared.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "data".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Data boundary declared.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "dataSummary".to_string(),
                            status: WorkBuilderFactStatus::NotVerified,
                            detail: Some(
                                "Runtime data/share summary has not been recorded.".to_string(),
                            ),
                        },
                    ],
                    work_id: work_id.clone(),
                    runtime_instance_id: None,
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: None,
                    product_app_surface_id: None,
                    surface_id: None,
                    observed_at: 400,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record release rehearsal package evidence");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        let release_rehearsal = graph
            .builder_preview_results
            .iter()
            .find(|preview| {
                preview.kind == WorkBuilderPreviewKind::ReleaseRehearsal
                    && preview.source == WorkBuilderPreviewSource::ReleaseRehearsal
            })
            .expect("derived release rehearsal preview result");

        assert_eq!(release_rehearsal.status, WorkBuilderFactStatus::Warning);
        assert_eq!(
            release_rehearsal
                .checks
                .iter()
                .map(|check| (check.id.as_str(), check.status))
                .collect::<Vec<_>>(),
            vec![
                ("validation", WorkBuilderFactStatus::Passed),
                ("preview", WorkBuilderFactStatus::Passed),
                ("issues", WorkBuilderFactStatus::Warning),
                ("criticalPath", WorkBuilderFactStatus::NotVerified),
                ("permissions", WorkBuilderFactStatus::Warning),
                ("permissionReview", WorkBuilderFactStatus::NotVerified),
                ("data", WorkBuilderFactStatus::Passed),
                ("dataLifecycle", WorkBuilderFactStatus::NotVerified),
                ("dataSummary", WorkBuilderFactStatus::NotVerified),
                ("runtimeStorage", WorkBuilderFactStatus::NotVerified),
                ("runtimeDependencies", WorkBuilderFactStatus::NotVerified),
                ("agentEval", WorkBuilderFactStatus::NotVerified),
                ("userPath", WorkBuilderFactStatus::NotVerified),
                ("releaseGate", WorkBuilderFactStatus::Warning),
            ]
        );
    }

    #[tokio::test]
    async fn release_rehearsal_requires_permission_review_for_elevated_permission_warning() {
        let service = service();
        let app = WorkAppRef::product_app("product-app-1", "1.0.0", "sha256:test-lock");
        let response = service
            .resolve_app_work(ResolveAppWorkRequest {
                app,
                intent: WorkAppIntent::Develop,
                title: "Product App Builder".to_string(),
                objective: "Verify permission review evidence".to_string(),
                scope: WorkScope::System,
                visibility: WorkVisibility::Secondary,
                primary_surface_policy: PrimarySurfacePolicy::ApplicationSurface,
                primary_surface: Some(WorkSurfaceRef::ApplicationSurface {
                    product_app_id: "product-app-1".to_string(),
                    product_app_surface_id: "product-app-1-surface".to_string(),
                    surface_id: "primary".to_string(),
                }),
                assignment: None,
                app_refs: Vec::new(),
            })
            .await
            .expect("resolve app work");
        let work_id = response.work.id.clone();
        let runtime_instance_id = response.work.runtime_instances[0].id.clone();

        service
            .record_builder_validation_result(
                &work_id,
                WorkBuilderValidationResult {
                    id: "validation:product-app:product-app-1".to_string(),
                    tool_name: "ValidateProductAppPackage".to_string(),
                    target_kind: WorkBuilderValidationTargetKind::ProductApp,
                    status: WorkBuilderFactStatus::Passed,
                    work_id: work_id.clone(),
                    app_id: Some("product-app-1".to_string()),
                    component_id: None,
                    component_kind: None,
                    version: Some("1.0.0".to_string()),
                    package_root: Some("product-app://product-app-1@1.0.0".to_string()),
                    observed_at: 200,
                    failed_count: 0,
                    warning_count: 0,
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "primarySurface".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Primary surface resolves.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "surfaceSource".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Surface source resolves.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "launchPolicy".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Launch policy resolves.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "dataLifecycle".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Data lifecycle policy passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "releaseGate".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Release gate validation passed.".to_string()),
                        },
                    ],
                },
            )
            .await
            .expect("record validation result");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: format!("preview:{runtime_instance_id}"),
                    kind: WorkBuilderPreviewKind::ProductAppPreview,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("product-app-preview".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Preview iframe loaded.".to_string()),
                    checks: passed_runtime_preview_checks(),
                    work_id: work_id.clone(),
                    runtime_instance_id: Some(runtime_instance_id.clone()),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 300,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record preview result");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:runtime-boundary:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::RuntimeBoundary,
                    status: WorkBuilderFactStatus::Warning,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("runtime-boundary".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Runtime boundary found elevated permission.".to_string()),
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "permissions".to_string(),
                            status: WorkBuilderFactStatus::Warning,
                            detail: Some("Elevated permission declared.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "data".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Data boundary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "dataLifecycle".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some(
                                "Runtime retention and share-impact evidence passed.".to_string(),
                            ),
                        },
                        WorkBuilderFactCheck {
                            id: "dataSummary".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Data summary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "runtimeStorage".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Runtime storage scope passed.".to_string()),
                        },
                    ],
                    work_id: work_id.clone(),
                    runtime_instance_id: Some(runtime_instance_id.clone()),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 400,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record runtime boundary warning");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:runtime-dependencies:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::RuntimeDependencies,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("runtime-dependencies".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Runtime dependency health passed.".to_string()),
                    checks: vec![WorkBuilderFactCheck {
                        id: "runtimeDependencies".to_string(),
                        status: WorkBuilderFactStatus::Passed,
                        detail: Some("Runtime dependency health passed.".to_string()),
                    }],
                    work_id: work_id.clone(),
                    runtime_instance_id: Some(runtime_instance_id.clone()),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 405,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record runtime dependency evidence");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:user-path-rehearsal:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::UserPathRehearsal,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("user-path-rehearsal".to_string()),
                    trigger_turn_id: None,
                    detail: Some("User path rehearsal passed.".to_string()),
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "criticalPath".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("New-user critical path rehearsal passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "userPath".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("User path passed.".to_string()),
                        },
                    ],
                    work_id: work_id.clone(),
                    runtime_instance_id: Some(runtime_instance_id.clone()),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 406,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record user path evidence");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:agent-eval:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::AgentEval,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::PreviewHarness,
                    harness_mode: Some("agent-eval".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Agent Eval evidence passed.".to_string()),
                    checks: vec![WorkBuilderFactCheck {
                        id: "agentEval".to_string(),
                        status: WorkBuilderFactStatus::Passed,
                        detail: Some("Agent eval passed.".to_string()),
                    }],
                    work_id: work_id.clone(),
                    runtime_instance_id: None,
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: None,
                    product_app_surface_id: None,
                    surface_id: None,
                    observed_at: 410,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record agent eval evidence");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        let release_rehearsal = graph
            .builder_preview_results
            .iter()
            .find(|preview| {
                preview.kind == WorkBuilderPreviewKind::ReleaseRehearsal
                    && preview.source == WorkBuilderPreviewSource::ReleaseRehearsal
            })
            .expect("derived release rehearsal preview result");
        assert_eq!(release_rehearsal.status, WorkBuilderFactStatus::Warning);
        assert!(release_rehearsal.checks.iter().any(|check| {
            check.id == "permissionReview" && check.status == WorkBuilderFactStatus::NotVerified
        }));
        assert!(release_rehearsal
            .checks
            .iter()
            .find(|check| check.id == "releaseGate")
            .and_then(|check| check.detail.as_deref())
            .is_some_and(|detail| detail.contains("permissionReview")));

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:permission-review:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::PermissionReview,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("permission-review".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Elevated permission reviewed.".to_string()),
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "permissions".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Elevated permission reviewed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "permissionReview".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Explicit permission review recorded.".to_string()),
                        },
                    ],
                    work_id: work_id.clone(),
                    runtime_instance_id: Some(runtime_instance_id),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 450,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record permission review evidence");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        let release_rehearsal = graph
            .builder_preview_results
            .iter()
            .find(|preview| {
                preview.kind == WorkBuilderPreviewKind::ReleaseRehearsal
                    && preview.source == WorkBuilderPreviewSource::ReleaseRehearsal
            })
            .expect("derived release rehearsal preview result");
        assert_eq!(release_rehearsal.status, WorkBuilderFactStatus::Passed);
        assert!(release_rehearsal.checks.iter().any(|check| {
            check.id == "permissionReview" && check.status == WorkBuilderFactStatus::Passed
        }));
        assert!(release_rehearsal.checks.iter().any(|check| {
            check.id == "permissions" && check.status == WorkBuilderFactStatus::Passed
        }));

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:runtime-boundary:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::RuntimeBoundary,
                    status: WorkBuilderFactStatus::Warning,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("runtime-boundary".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Runtime boundary found a new elevated permission.".to_string()),
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "runtimeStorage".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Runtime storage scope passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "permissions".to_string(),
                            status: WorkBuilderFactStatus::Warning,
                            detail: Some("New elevated permission declared.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "data".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Runtime data boundary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "dataSummary".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Runtime data summary passed.".to_string()),
                        },
                    ],
                    work_id: work_id.clone(),
                    runtime_instance_id: Some("runtime-boundary-1".to_string()),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 500,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record newer permission warning");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        let release_rehearsal = graph
            .builder_preview_results
            .iter()
            .find(|preview| {
                preview.kind == WorkBuilderPreviewKind::ReleaseRehearsal
                    && preview.source == WorkBuilderPreviewSource::ReleaseRehearsal
            })
            .expect("derived release rehearsal preview result");
        assert_eq!(release_rehearsal.status, WorkBuilderFactStatus::Warning);
        let permission_review = release_rehearsal
            .checks
            .iter()
            .find(|check| check.id == "permissionReview")
            .expect("permissionReview check");
        assert_eq!(permission_review.status, WorkBuilderFactStatus::NotVerified);
        assert!(permission_review
            .detail
            .as_deref()
            .is_some_and(|detail| detail.contains("changed after")));
    }

    #[tokio::test]
    async fn release_rehearsal_absorbs_runtime_visual_checks() {
        let service = service();
        let app = WorkAppRef::product_app("product-app-1", "1.0.0", "sha256:test-lock");
        let response = service
            .resolve_app_work(ResolveAppWorkRequest {
                app,
                intent: WorkAppIntent::Develop,
                title: "Product App Builder".to_string(),
                objective: "Verify release rehearsal visual checks".to_string(),
                scope: WorkScope::System,
                visibility: WorkVisibility::Secondary,
                primary_surface_policy: PrimarySurfacePolicy::ApplicationSurface,
                primary_surface: Some(WorkSurfaceRef::ApplicationSurface {
                    product_app_id: "product-app-1".to_string(),
                    product_app_surface_id: "product-app-1-surface".to_string(),
                    surface_id: "primary".to_string(),
                }),
                assignment: None,
                app_refs: Vec::new(),
            })
            .await
            .expect("resolve app work");
        let work_id = response.work.id.clone();
        let runtime_instance_id = response.work.runtime_instances[0].id.clone();

        service
            .record_builder_validation_result(
                &work_id,
                WorkBuilderValidationResult {
                    id: "validation:product-app:product-app-1".to_string(),
                    tool_name: "ValidateProductAppPackage".to_string(),
                    target_kind: WorkBuilderValidationTargetKind::ProductApp,
                    status: WorkBuilderFactStatus::Passed,
                    work_id: work_id.clone(),
                    app_id: Some("product-app-1".to_string()),
                    component_id: None,
                    component_kind: None,
                    version: Some("1.0.0".to_string()),
                    package_root: Some("product-app://product-app-1@1.0.0".to_string()),
                    observed_at: 200,
                    failed_count: 0,
                    warning_count: 0,
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "primarySurface".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Primary surface resolves.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "surfaceSource".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Surface source resolves.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "launchPolicy".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Launch policy resolves.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "dataLifecycle".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Data lifecycle policy passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "releaseGate".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Release gate validation passed.".to_string()),
                        },
                    ],
                },
            )
            .await
            .expect("record validation result");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: format!("preview:{runtime_instance_id}"),
                    kind: WorkBuilderPreviewKind::ProductAppPreview,
                    status: WorkBuilderFactStatus::NotVerified,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("product-app-preview".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Preview iframe runtime bridge reported ready.".to_string()),
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "runtimeReady".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Runtime bridge reported ready.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "visualRoot".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Runtime DOM reported visible elements.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "viewport".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Runtime viewport reported non-zero size.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "interactionSurface".to_string(),
                            status: WorkBuilderFactStatus::NotVerified,
                            detail: Some("No user path interaction has run.".to_string()),
                        },
                    ],
                    work_id: work_id.clone(),
                    runtime_instance_id: Some(runtime_instance_id.clone()),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 300,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record runtime preview result");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:runtime-boundary:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::RuntimeBoundary,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("runtime-boundary".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Runtime boundary evidence passed.".to_string()),
                    checks: vec![
                        WorkBuilderFactCheck {
                            id: "permissions".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Permission boundary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "data".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Data boundary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "dataLifecycle".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some(
                                "Runtime retention and share-impact evidence passed.".to_string(),
                            ),
                        },
                        WorkBuilderFactCheck {
                            id: "dataSummary".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Data summary passed.".to_string()),
                        },
                        WorkBuilderFactCheck {
                            id: "runtimeStorage".to_string(),
                            status: WorkBuilderFactStatus::Passed,
                            detail: Some("Runtime storage scope passed.".to_string()),
                        },
                    ],
                    work_id: work_id.clone(),
                    runtime_instance_id: Some(runtime_instance_id.clone()),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 400,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record runtime boundary evidence");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: "preview:agent-eval:product-app-1".to_string(),
                    kind: WorkBuilderPreviewKind::AgentEval,
                    status: WorkBuilderFactStatus::Passed,
                    source: WorkBuilderPreviewSource::PreviewHarness,
                    harness_mode: Some("agent-eval".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Agent Eval evidence passed.".to_string()),
                    checks: vec![WorkBuilderFactCheck {
                        id: "agentEval".to_string(),
                        status: WorkBuilderFactStatus::Passed,
                        detail: Some("Agent eval passed.".to_string()),
                    }],
                    work_id: work_id.clone(),
                    runtime_instance_id: None,
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: None,
                    product_app_surface_id: None,
                    surface_id: None,
                    observed_at: 410,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record agent eval evidence");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        let release_rehearsal = graph
            .builder_preview_results
            .iter()
            .find(|preview| {
                preview.kind == WorkBuilderPreviewKind::ReleaseRehearsal
                    && preview.source == WorkBuilderPreviewSource::ReleaseRehearsal
            })
            .expect("derived release rehearsal preview result");

        assert_eq!(release_rehearsal.status, WorkBuilderFactStatus::NotVerified);
        assert_eq!(
            release_rehearsal
                .checks
                .iter()
                .map(|check| (check.id.as_str(), check.status))
                .collect::<Vec<_>>(),
            vec![
                ("validation", WorkBuilderFactStatus::Passed),
                ("preview", WorkBuilderFactStatus::NotVerified),
                ("issues", WorkBuilderFactStatus::Passed),
                ("criticalPath", WorkBuilderFactStatus::Passed),
                ("permissions", WorkBuilderFactStatus::Passed),
                ("permissionReview", WorkBuilderFactStatus::NotVerified),
                ("data", WorkBuilderFactStatus::Passed),
                ("dataLifecycle", WorkBuilderFactStatus::Passed),
                ("dataSummary", WorkBuilderFactStatus::Passed),
                ("runtimeStorage", WorkBuilderFactStatus::Passed),
                ("runtimeDependencies", WorkBuilderFactStatus::NotVerified),
                ("agentEval", WorkBuilderFactStatus::Passed),
                ("userPath", WorkBuilderFactStatus::NotVerified),
                ("runtimeReady", WorkBuilderFactStatus::Passed),
                ("visualRoot", WorkBuilderFactStatus::Passed),
                ("viewport", WorkBuilderFactStatus::Passed),
                ("interactionSurface", WorkBuilderFactStatus::NotVerified),
                ("releaseGate", WorkBuilderFactStatus::NotVerified),
            ]
        );
        assert!(release_rehearsal.checks.iter().any(|check| {
            check.id == "releaseGate"
                && check.detail.as_deref().is_some_and(|detail| {
                    detail.contains("userPath") && detail.contains("interactionSurface")
                })
        }));
    }

    #[tokio::test]
    async fn resolve_app_work_derives_application_surface_from_product_app_lock() {
        let path_manager = try_get_path_manager_arc().expect("path manager");
        seed_builtin_product_app_packages(path_manager.as_ref())
            .await
            .expect("seed built-in product apps");
        let app = list_installed_product_apps(path_manager.as_ref())
            .await
            .expect("list installed product apps")
            .into_iter()
            .find(|app| app.app.id == "builtin-remotion-live")
            .expect("built-in Remotion Live app");
        let app_ref = WorkAppRef::product_app(
            app.app.id.clone(),
            app.app.version.clone(),
            app.lock.digest(),
        );
        let service = service();

        let response = service
            .resolve_app_work(ResolveAppWorkRequest {
                app: app_ref.clone(),
                intent: WorkAppIntent::Run,
                title: "Remotion Live".to_string(),
                objective: "Open the Product App surface".to_string(),
                scope: WorkScope::System,
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::ApplicationSurface,
                primary_surface: None,
                assignment: Some(WorkAssignmentRef {
                    kind: WorkAssignmentKind::Application,
                    agent_type: None,
                    assistant_id: None,
                    application_id: Some(app.app.id.clone()),
                    human_label: None,
                    external_label: None,
                }),
                app_refs: vec![WorkAppRelation {
                    app: app_ref.clone(),
                    role: WorkAppRelationRole::Executor,
                    surface_id: None,
                }],
            })
            .await
            .expect("resolve app work");

        assert!(response.created);
        assert!(matches!(
            response.work.primary_surface,
            WorkSurfaceRef::ApplicationSurface {
                ref product_app_id,
                ref product_app_surface_id,
                ref surface_id,
            } if product_app_id == "builtin-remotion-live"
                && product_app_surface_id == &app.app.primary_surface.as_ref().expect("primary surface").component_id
                && surface_id.as_str() == app.app.primary_surface.as_ref().and_then(|surface| surface.surface_id.as_deref()).unwrap_or("primary")
        ));
        assert_eq!(response.work.runtime_instances.len(), 1);
        assert_eq!(
            response.work.runtime_instances[0].component_lock_digest,
            app_ref.component_lock_digest
        );
    }

    #[tokio::test]
    async fn link_session_to_work_adds_session_ref_and_surface() {
        let service = service();
        let record = service
            .create(CreateWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Investigate".to_string(),
                objective: "Keep session linked to work".to_string(),
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkCenter,
                primary_surface: None,
                assignment: None,
                title_state: None,
                delegation: None,
            })
            .await
            .expect("create work");

        let updated = service
            .link_session_to_work(LinkSessionToWorkRequest {
                work_id: record.id.clone(),
                session_id: "session-1".to_string(),
                workspace_path: Some("D:/workspace/project".to_string()),
                surface: Some(WorkSurfaceRef::AgentSession {
                    session_id: "session-1".to_string(),
                }),
                set_primary: true,
            })
            .await
            .expect("link session");

        assert_eq!(updated.session_refs.len(), 1);
        assert_eq!(updated.session_refs[0].session_id, "session-1");
        assert_eq!(
            updated.session_refs[0].workspace_path.as_deref(),
            Some("D:/workspace/project")
        );
        assert!(matches!(
            updated.primary_surface,
            WorkSurfaceRef::AgentSession { ref session_id } if session_id == "session-1"
        ));
    }

    #[tokio::test]
    async fn delete_work_cleans_owned_work_session_before_record_delete() {
        let bridge = Arc::new(RecordingRuntimeBridge::default());
        let runtime_bridge: Arc<dyn WorkRuntimeBridge> = bridge.clone();
        let service =
            WorkService::with_runtime_bridge(Arc::new(MemoryWorkStore::new()), runtime_bridge);
        let record = service
            .create(CreateWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Implement feature".to_string(),
                objective: "Ship the feature".to_string(),
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                primary_surface: None,
                assignment: Some(WorkAssignmentRef::agent("Runno")),
                title_state: None,
                delegation: None,
            })
            .await
            .expect("create work");
        let session_id = record
            .work_session_id()
            .expect("work session id")
            .to_string();

        let response = service.delete(&record.id).await.expect("delete work");

        assert!(response.deleted);
        assert!(service
            .store
            .get(&record.id)
            .await
            .expect("get deleted work")
            .is_none());
        assert_eq!(
            bridge
                .deleted_sessions
                .lock()
                .expect("deleted sessions lock")
                .as_slice(),
            &[("D:/workspace/project".to_string(), session_id.clone())]
        );
        assert!(response.cleanup_report.items.iter().any(|report| {
            report.item.resource.id == session_id
                && report.item.resource.ownership == WorkResourceOwnership::Owned
                && report.item.action == WorkCleanupAction::Delete
                && report.status == WorkCleanupItemStatus::Succeeded
        }));
    }

    #[tokio::test]
    async fn delete_work_retains_linked_sessions_by_default() {
        let service = service();
        let record = service
            .create(CreateWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Investigate".to_string(),
                objective: "Keep session linked to work".to_string(),
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkCenter,
                primary_surface: None,
                assignment: None,
                title_state: None,
                delegation: None,
            })
            .await
            .expect("create work");
        let linked = service
            .link_session_to_work(LinkSessionToWorkRequest {
                work_id: record.id.clone(),
                session_id: "session-linked".to_string(),
                workspace_path: Some("D:/workspace/project".to_string()),
                surface: Some(WorkSurfaceRef::AgentSession {
                    session_id: "session-linked".to_string(),
                }),
                set_primary: true,
            })
            .await
            .expect("link session");

        let response = service.delete(&linked.id).await.expect("delete work");

        assert!(response.deleted);
        assert!(response.cleanup_report.items.iter().any(|report| {
            report.item.resource.id == "session-linked"
                && report.item.resource.ownership == WorkResourceOwnership::Linked
                && report.item.action == WorkCleanupAction::Retain
                && report.status == WorkCleanupItemStatus::Retained
        }));
    }

    #[tokio::test]
    async fn dispatch_new_creates_delegated_work() {
        let service = service();
        let parent = service
            .create(CreateWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Parent".to_string(),
                objective: "Coordinate the effort".to_string(),
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkCenter,
                primary_surface: None,
                assignment: None,
                title_state: None,
                delegation: None,
            })
            .await
            .expect("parent");

        let response = service
            .dispatch_new(DispatchNewWorkRequest {
                parent_work_id: parent.id.clone(),
                kind: WorkKind::DelegatedWork,
                title: "Child".to_string(),
                objective: "Investigate auth".to_string(),
                assignment: WorkAssignmentRef::agent("Runno"),
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
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("Runno")),
                idempotency_key: None,
                owner: None,
            })
            .await
            .expect("start work");

        assert_eq!(response.work.status, WorkStatus::Active);
        assert_eq!(
            response.turn_id,
            format!("turn_{}", response.work.id.as_str())
        );
        assert_eq!(
            response
                .work
                .delegation
                .as_ref()
                .and_then(|delegation| delegation.instructions.as_deref()),
            Some("Confirm the task has been created.")
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
    async fn start_records_work_owner_for_completion_routing() {
        let service = service();
        let response = service
            .start(StartWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Owned work".to_string(),
                objective: "Record owner".to_string(),
                instructions: "Do the owned work.".to_string(),
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("Runno")),
                idempotency_key: None,
                owner: Some(WorkOwnerRef {
                    session_id: "os-session".to_string(),
                    turn_id: Some("os-turn".to_string()),
                    workspace_path: Some("D:/workspace/agentic_os".to_string()),
                }),
            })
            .await
            .expect("start work");

        let owner = response
            .work
            .delegation
            .as_ref()
            .and_then(|delegation| delegation.owner.as_ref())
            .expect("owner");
        assert_eq!(owner.session_id, "os-session");
        assert_eq!(owner.turn_id.as_deref(), Some("os-turn"));
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
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("Runno")),
                idempotency_key: None,
                owner: None,
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
    async fn completed_app_builder_fix_turn_marks_bound_builder_issue_fixed() {
        let service = service();
        let app = WorkAppRef::product_app("product-app-1", "1.0.0", "sha256:test-lock");
        let response = service
            .resolve_app_work(ResolveAppWorkRequest {
                app: app.clone(),
                intent: WorkAppIntent::Develop,
                title: "Product App Builder".to_string(),
                objective: "Fix runtime issues".to_string(),
                scope: WorkScope::System,
                visibility: WorkVisibility::Secondary,
                primary_surface_policy: PrimarySurfacePolicy::ApplicationSurface,
                primary_surface: Some(WorkSurfaceRef::ApplicationSurface {
                    product_app_id: "product-app-1".to_string(),
                    product_app_surface_id: "product-app-1-surface".to_string(),
                    surface_id: "primary".to_string(),
                }),
                assignment: None,
                app_refs: Vec::new(),
            })
            .await
            .expect("resolve app work");
        let work_id = response.work.id.clone();
        let runtime_instance_id = response.work.runtime_instances[0].id.clone();

        service
            .record_runtime_issue(
                &work_id,
                WorkRuntimeIssue {
                    runtime_instance_id: runtime_instance_id.clone(),
                    product_app_id: "product-app-1".to_string(),
                    component_id: "product-app-1-surface".to_string(),
                    severity: WorkRuntimeIssueSeverity::Fatal,
                    message: "Preview crashed".to_string(),
                    source: Some("ui.js:12".to_string()),
                    category: Some("runtime".to_string()),
                    timestamp_ms: 500,
                },
            )
            .await
            .expect("record runtime issue");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        let issue_id = graph.builder_issues[0].id.clone();
        assert_eq!(graph.builder_issues[0].status, WorkBuilderIssueStatus::Open);
        assert_eq!(
            graph.builder_preview_results[0].status,
            WorkBuilderFactStatus::Failed
        );

        service
            .mark_agent_session_turn_started_with_app_builder_context(
                "app-builder-session",
                "fix-turn-1",
                Some(WorkExecutionAppBuilderContext {
                    work_id: Some(work_id.clone()),
                    issue_id: issue_id.clone(),
                    product_app_id: Some("product-app-1".to_string()),
                    subject_kind: Some("Product App".to_string()),
                    component_kind: None,
                    runtime_instance_id: Some(runtime_instance_id.clone()),
                    component_id: Some("product-app-1-surface".to_string()),
                    preview_result_id: Some(format!("preview:{runtime_instance_id}")),
                    package_root: Some("product-app://product-app-1@1.0.0".to_string()),
                    severity: Some("fatal".to_string()),
                    category: Some("runtime".to_string()),
                    source: Some("ui.js:12".to_string()),
                    message: Some("Preview crashed".to_string()),
                }),
            )
            .await
            .expect("mark started")
            .expect("matched work");

        let completed = service
            .mark_agent_session_turn_completed("fix-turn-1")
            .await
            .expect("mark completed")
            .expect("matched work");
        let issue = completed
            .builder_issues
            .iter()
            .find(|issue| issue.id == issue_id)
            .expect("builder issue");
        assert_eq!(issue.status, WorkBuilderIssueStatus::Fixed);
        assert!(issue.resolved_at.is_some());
        assert_eq!(
            completed.builder_preview_results[0].status,
            WorkBuilderFactStatus::Ready
        );
        assert!(completed.execution_bindings.iter().any(|binding| binding
            .app_builder
            .as_ref()
            .is_some_and(|context| context.issue_id == issue_id)));
    }

    #[tokio::test]
    async fn builder_preview_observation_ready_resolves_runtime_issues() {
        let service = service();
        let app = WorkAppRef::product_app("product-app-1", "1.0.0", "sha256:test-lock");
        let response = service
            .resolve_app_work(ResolveAppWorkRequest {
                app,
                intent: WorkAppIntent::Develop,
                title: "Product App Builder".to_string(),
                objective: "Verify preview".to_string(),
                scope: WorkScope::System,
                visibility: WorkVisibility::Secondary,
                primary_surface_policy: PrimarySurfacePolicy::ApplicationSurface,
                primary_surface: Some(WorkSurfaceRef::ApplicationSurface {
                    product_app_id: "product-app-1".to_string(),
                    product_app_surface_id: "product-app-1-surface".to_string(),
                    surface_id: "primary".to_string(),
                }),
                assignment: None,
                app_refs: Vec::new(),
            })
            .await
            .expect("resolve app work");
        let work_id = response.work.id.clone();
        let runtime_instance_id = response.work.runtime_instances[0].id.clone();

        service
            .record_runtime_issue(
                &work_id,
                WorkRuntimeIssue {
                    runtime_instance_id: runtime_instance_id.clone(),
                    product_app_id: "product-app-1".to_string(),
                    component_id: "product-app-1-surface".to_string(),
                    severity: WorkRuntimeIssueSeverity::Fatal,
                    message: "Preview crashed".to_string(),
                    source: Some("ui.js:12".to_string()),
                    category: Some("runtime".to_string()),
                    timestamp_ms: 500,
                },
            )
            .await
            .expect("record runtime issue");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        let issue_id = graph.builder_issues[0].id.clone();
        assert_eq!(graph.builder_issues[0].status, WorkBuilderIssueStatus::Open);

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: format!("preview:{runtime_instance_id}"),
                    kind: WorkBuilderPreviewKind::ProductAppPreview,
                    status: WorkBuilderFactStatus::Ready,
                    source: WorkBuilderPreviewSource::RuntimeObservation,
                    harness_mode: Some("product-app-preview".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Preview iframe loaded.".to_string()),
                    checks: Vec::new(),
                    work_id: work_id.clone(),
                    runtime_instance_id: Some(runtime_instance_id.clone()),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 900,
                    issue_count: 0,
                    fatal_issue_count: 0,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record ready preview");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        let issue = graph
            .builder_issues
            .iter()
            .find(|issue| issue.id == issue_id)
            .expect("builder issue");
        assert_eq!(issue.status, WorkBuilderIssueStatus::Fixed);
        assert_eq!(issue.resolved_at, Some(900));
        assert_eq!(
            graph.builder_preview_results[0].status,
            WorkBuilderFactStatus::Ready
        );
        assert_eq!(graph.builder_preview_results[0].issue_count, 0);
        assert_eq!(
            graph.builder_preview_results[0].source,
            WorkBuilderPreviewSource::RuntimeObservation
        );
    }

    #[tokio::test]
    async fn failed_preview_observation_marks_active_issue_still_open() {
        let service = service();
        let app = WorkAppRef::product_app("product-app-1", "1.0.0", "sha256:test-lock");
        let response = service
            .resolve_app_work(ResolveAppWorkRequest {
                app,
                intent: WorkAppIntent::Develop,
                title: "Product App Builder".to_string(),
                objective: "Verify preview".to_string(),
                scope: WorkScope::System,
                visibility: WorkVisibility::Secondary,
                primary_surface_policy: PrimarySurfacePolicy::ApplicationSurface,
                primary_surface: Some(WorkSurfaceRef::ApplicationSurface {
                    product_app_id: "product-app-1".to_string(),
                    product_app_surface_id: "product-app-1-surface".to_string(),
                    surface_id: "primary".to_string(),
                }),
                assignment: None,
                app_refs: Vec::new(),
            })
            .await
            .expect("resolve app work");
        let work_id = response.work.id.clone();
        let runtime_instance_id = response.work.runtime_instances[0].id.clone();

        service
            .record_runtime_issue(
                &work_id,
                WorkRuntimeIssue {
                    runtime_instance_id: runtime_instance_id.clone(),
                    product_app_id: "product-app-1".to_string(),
                    component_id: "product-app-1-surface".to_string(),
                    severity: WorkRuntimeIssueSeverity::Fatal,
                    message: "Preview crashed".to_string(),
                    source: Some("ui.js:12".to_string()),
                    category: Some("runtime".to_string()),
                    timestamp_ms: 500,
                },
            )
            .await
            .expect("record runtime issue");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: format!("preview:{runtime_instance_id}"),
                    kind: WorkBuilderPreviewKind::ProductAppPreview,
                    status: WorkBuilderFactStatus::Failed,
                    source: WorkBuilderPreviewSource::PreviewHarness,
                    harness_mode: Some("product-app-preview".to_string()),
                    trigger_turn_id: None,
                    detail: Some("Preview runtime fatal: Preview crashed".to_string()),
                    checks: Vec::new(),
                    work_id: work_id.clone(),
                    runtime_instance_id: Some(runtime_instance_id.clone()),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 900,
                    issue_count: 1,
                    fatal_issue_count: 1,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record failed preview");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        assert_eq!(
            graph.builder_issues[0].status,
            WorkBuilderIssueStatus::StillOpen
        );
        assert_eq!(
            graph.builder_preview_results[0].status,
            WorkBuilderFactStatus::Failed
        );
        assert_eq!(
            graph.builder_preview_results[0].source,
            WorkBuilderPreviewSource::PreviewHarness
        );
    }

    #[tokio::test]
    async fn blocked_preview_observation_without_runtime_identity_creates_preview_issue() {
        let service = service();
        let app = WorkAppRef::product_app("product-app-1", "1.0.0", "sha256:test-lock");
        let response = service
            .resolve_app_work(ResolveAppWorkRequest {
                app,
                intent: WorkAppIntent::Develop,
                title: "Product App Builder".to_string(),
                objective: "Verify preview".to_string(),
                scope: WorkScope::System,
                visibility: WorkVisibility::Secondary,
                primary_surface_policy: PrimarySurfacePolicy::ApplicationSurface,
                primary_surface: Some(WorkSurfaceRef::ApplicationSurface {
                    product_app_id: "product-app-1".to_string(),
                    product_app_surface_id: "product-app-1-surface".to_string(),
                    surface_id: "primary".to_string(),
                }),
                assignment: None,
                app_refs: Vec::new(),
            })
            .await
            .expect("resolve app work");
        let work_id = response.work.id.clone();

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: format!("preview:{work_id}:runtime-resolve"),
                    kind: WorkBuilderPreviewKind::ProductAppPreview,
                    status: WorkBuilderFactStatus::Blocked,
                    source: WorkBuilderPreviewSource::PreviewHarness,
                    harness_mode: Some("product-app-preview".to_string()),
                    trigger_turn_id: None,
                    detail: Some(
                        "Preview runtime-resolve failed before runtime identity was available."
                            .to_string(),
                    ),
                    checks: Vec::new(),
                    work_id: work_id.clone(),
                    runtime_instance_id: None,
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 900,
                    issue_count: 1,
                    fatal_issue_count: 1,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record blocked preview");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        let blocked_preview = graph
            .builder_preview_results
            .iter()
            .find(|preview| preview.kind == WorkBuilderPreviewKind::ProductAppPreview)
            .expect("blocked preview result");
        assert_eq!(blocked_preview.status, WorkBuilderFactStatus::Blocked);
        assert_eq!(blocked_preview.runtime_instance_id, None);
        let release_rehearsal = graph
            .builder_preview_results
            .iter()
            .find(|preview| preview.kind == WorkBuilderPreviewKind::ReleaseRehearsal)
            .expect("release rehearsal preview result");
        assert_eq!(release_rehearsal.status, WorkBuilderFactStatus::Failed);
        assert_eq!(graph.builder_issues.len(), 1);
        assert_eq!(
            graph.builder_issues[0].origin,
            WorkBuilderIssueOrigin::Preview
        );
        assert_eq!(graph.builder_issues[0].runtime_instance_id, None);
        assert_eq!(
            graph.builder_issues[0].preview_result_id.as_deref(),
            Some(blocked_preview.id.as_str())
        );
        assert_eq!(graph.builder_issues[0].status, WorkBuilderIssueStatus::Open);
        assert_eq!(
            graph.builder_issues[0].severity,
            WorkRuntimeIssueSeverity::Fatal
        );
    }

    #[tokio::test]
    async fn failed_preview_rerun_marks_previously_fixed_issue_regressed() {
        let service = service();
        let app = WorkAppRef::product_app("product-app-1", "1.0.0", "sha256:test-lock");
        let response = service
            .resolve_app_work(ResolveAppWorkRequest {
                app,
                intent: WorkAppIntent::Develop,
                title: "Product App Builder".to_string(),
                objective: "Verify preview".to_string(),
                scope: WorkScope::System,
                visibility: WorkVisibility::Secondary,
                primary_surface_policy: PrimarySurfacePolicy::ApplicationSurface,
                primary_surface: Some(WorkSurfaceRef::ApplicationSurface {
                    product_app_id: "product-app-1".to_string(),
                    product_app_surface_id: "product-app-1-surface".to_string(),
                    surface_id: "primary".to_string(),
                }),
                assignment: None,
                app_refs: Vec::new(),
            })
            .await
            .expect("resolve app work");
        let work_id = response.work.id.clone();
        let runtime_instance_id = response.work.runtime_instances[0].id.clone();

        service
            .record_runtime_issue(
                &work_id,
                WorkRuntimeIssue {
                    runtime_instance_id: runtime_instance_id.clone(),
                    product_app_id: "product-app-1".to_string(),
                    component_id: "product-app-1-surface".to_string(),
                    severity: WorkRuntimeIssueSeverity::Fatal,
                    message: "Preview crashed".to_string(),
                    source: Some("ui.js:12".to_string()),
                    category: Some("runtime".to_string()),
                    timestamp_ms: 500,
                },
            )
            .await
            .expect("record runtime issue");
        let issue_id = service
            .execution_graph(&work_id)
            .await
            .expect("graph")
            .builder_issues[0]
            .id
            .clone();
        service
            .update_builder_issue_status(&work_id, &issue_id, WorkBuilderIssueStatus::Fixed)
            .await
            .expect("mark fixed");

        service
            .record_builder_preview_result(
                &work_id,
                WorkBuilderPreviewResult {
                    id: format!("preview:{runtime_instance_id}"),
                    kind: WorkBuilderPreviewKind::ProductAppPreview,
                    status: WorkBuilderFactStatus::Failed,
                    source: WorkBuilderPreviewSource::FixRerun,
                    harness_mode: Some("product-app-preview".to_string()),
                    trigger_turn_id: Some("fix-turn-1".to_string()),
                    detail: Some("Preview rerun failed.".to_string()),
                    checks: Vec::new(),
                    work_id: work_id.clone(),
                    runtime_instance_id: Some(runtime_instance_id.clone()),
                    product_app_id: Some("product-app-1".to_string()),
                    component_id: Some("product-app-1-surface".to_string()),
                    product_app_surface_id: Some("product-app-1-surface".to_string()),
                    surface_id: Some("primary".to_string()),
                    observed_at: 900,
                    issue_count: 1,
                    fatal_issue_count: 1,
                    warning_issue_count: 0,
                },
            )
            .await
            .expect("record failed rerun");

        let graph = service.execution_graph(&work_id).await.expect("graph");
        let issue = graph
            .builder_issues
            .iter()
            .find(|issue| issue.id == issue_id)
            .expect("builder issue");
        assert_eq!(issue.status, WorkBuilderIssueStatus::Regressed);
        assert_eq!(issue.resolved_at, None);
        assert_eq!(
            graph.builder_preview_results[0].status,
            WorkBuilderFactStatus::Failed
        );
        assert_eq!(graph.builder_preview_results[0].fatal_issue_count, 1);
        assert_eq!(
            graph.builder_preview_results[0].source,
            WorkBuilderPreviewSource::FixRerun
        );
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
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("Runno")),
                idempotency_key: None,
                owner: None,
            })
            .await
            .expect("start work");

        let completed = service
            .mark_agent_session_turn_completed(&response.turn_id)
            .await
            .expect("mark completed")
            .expect("matched work");

        assert_eq!(completed.status, WorkStatus::Completed);
        let notified = service
            .mark_agent_session_turn_work_message_queued(&response.turn_id)
            .await
            .expect("mark work message queued")
            .expect("matched work");
        assert!(notified.execution_bindings.iter().any(|binding| {
            binding.work_message_queued_at.is_some()
                && matches!(
                    &binding.source,
                    WorkExecutionSource::AgentSessionRun {
                        turn_id: Some(turn_id),
                        ..
                    } if turn_id == &response.turn_id
                )
        }));
    }

    #[tokio::test]
    async fn cancelled_one_shot_agent_session_turn_cancels_work() {
        let service = service();
        let response = service
            .start(StartWorkRequest {
                kind: WorkKind::OneShot,
                title: "Cancel once".to_string(),
                objective: "Cancel the one-shot run".to_string(),
                instructions: "Start, then cancel.".to_string(),
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("Runno")),
                idempotency_key: None,
                owner: None,
            })
            .await
            .expect("start work");

        let cancelled = service
            .mark_agent_session_turn_cancelled(&response.turn_id)
            .await
            .expect("mark cancelled")
            .expect("matched work");

        assert_eq!(cancelled.status, WorkStatus::Cancelled);
        assert!(cancelled.execution_bindings.iter().any(|binding| {
            binding.status == WorkExecutionBindingStatus::Cancelled
                && matches!(
                    &binding.source,
                    WorkExecutionSource::AgentSessionRun {
                        turn_id: Some(turn_id),
                        ..
                    } if turn_id == &response.turn_id
                )
        }));
    }

    #[tokio::test]
    async fn cancelled_multi_step_agent_session_turn_returns_work_to_active() {
        let service = service();
        let response = service
            .start(StartWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Cancel step".to_string(),
                objective: "Cancel one run but keep work open".to_string(),
                instructions: "Start, then cancel.".to_string(),
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("Runno")),
                idempotency_key: None,
                owner: None,
            })
            .await
            .expect("start work");

        let cancelled = service
            .mark_agent_session_turn_cancelled(&response.turn_id)
            .await
            .expect("mark cancelled")
            .expect("matched work");

        assert_eq!(cancelled.status, WorkStatus::Active);
        assert!(cancelled
            .execution_bindings
            .iter()
            .any(|binding| binding.status == WorkExecutionBindingStatus::Cancelled));
    }

    #[tokio::test]
    async fn startup_reconciliation_interrupts_orphaned_running_one_shot_work() {
        let service = service();
        let response = service
            .start(StartWorkRequest {
                kind: WorkKind::OneShot,
                title: "Interrupted once".to_string(),
                objective: "Recover after restart".to_string(),
                instructions: "Start and then lose the process.".to_string(),
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("Runno")),
                idempotency_key: None,
                owner: None,
            })
            .await
            .expect("start work");

        let reconciled = service
            .reconcile_orphaned_executions()
            .await
            .expect("reconcile orphaned executions");

        let interrupted = reconciled
            .into_iter()
            .find(|work| work.id == response.work.id)
            .expect("interrupted work");
        assert_eq!(interrupted.status, WorkStatus::Interrupted);
        assert!(interrupted
            .execution_bindings
            .iter()
            .any(|binding| binding.status == WorkExecutionBindingStatus::Interrupted));
    }

    #[tokio::test]
    async fn direct_bound_session_turn_creates_agent_session_run_binding() {
        let service = service();
        let record = service
            .create(CreateWorkRequest {
                kind: WorkKind::MultiStep,
                title: "Continue directly".to_string(),
                objective: "Allow direct session continuation".to_string(),
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                primary_surface: None,
                assignment: Some(WorkAssignmentRef::agent("Runno")),
                title_state: Some(WorkTitleState::template()),
                delegation: None,
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
                subject: WorkSubject::Goal,
                app_refs: Vec::new(),
                scope: WorkScope::Workspace {
                    workspace_path: "D:/workspace/project".to_string(),
                },
                visibility: WorkVisibility::Primary,
                primary_surface_policy: PrimarySurfacePolicy::WorkSession,
                assignment: Some(WorkAssignmentRef::agent("Runno")),
                idempotency_key: None,
                owner: None,
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
