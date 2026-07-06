use serde::{Deserialize, Serialize};

use super::assignment::WorkAssignmentRef;
use super::execution_binding::WorkExecutionBinding;
use super::execution_graph::{
    WorkBuilderIssue, WorkBuilderPreviewResult, WorkBuilderValidationResult, WorkRuntimeIssue,
    WorkRuntimeLog, WorkRuntimeRun,
};
use super::ids::WorkId;
use super::lifecycle::{WorkLifecycle, WorkSummary};
use super::subject::{
    WorkAppRef, WorkAppRelation, WorkAppRelationRole, WorkComponentRef, WorkSubject,
};
use super::surface::WorkSurfaceRef;
use super::title::WorkTitleState;
use super::types::{WorkKind, WorkScope, WorkStatus, WorkVisibility};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentSessionRef {
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRuntimeProvenance {
    pub runtime_instance_id: String,
    pub run_id: String,
    pub component_id: String,
    pub action: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactRef {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_provenance: Option<ArtifactRuntimeProvenance>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemoryRef {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkOwnerRef {
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkDelegationContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<WorkOwnerRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeInstanceRef {
    pub id: String,
    pub product_app_id: String,
    pub app_version: String,
    pub component_lock_digest: String,
    pub product_app_surface_id: String,
    pub surface_id: String,
}

impl RuntimeInstanceRef {
    pub fn product_app_application_surface(
        work_id: &WorkId,
        app: &WorkAppRef,
        surface: &WorkSurfaceRef,
    ) -> Option<Self> {
        let WorkSurfaceRef::ApplicationSurface {
            product_app_id,
            product_app_surface_id,
            surface_id,
        } = surface
        else {
            return None;
        };

        if product_app_id != &app.app_id {
            return None;
        }

        let lock_suffix = runtime_id_segment(&app.component_lock_digest, 12);
        Some(Self {
            id: format!(
                "runtime_{}_{}_{}",
                work_id.as_str(),
                runtime_id_segment(product_app_id, 48),
                lock_suffix
            ),
            product_app_id: product_app_id.clone(),
            app_version: app.app_version.clone(),
            component_lock_digest: app.component_lock_digest.clone(),
            product_app_surface_id: product_app_surface_id.clone(),
            surface_id: surface_id.clone(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkRecord {
    pub id: WorkId,
    pub kind: WorkKind,
    pub title: String,
    #[serde(default)]
    pub title_state: WorkTitleState,
    pub objective: String,
    pub status: WorkStatus,
    pub visibility: WorkVisibility,
    pub subject: WorkSubject,
    pub app_refs: Vec<WorkAppRelation>,
    pub scope: WorkScope,
    pub primary_surface: WorkSurfaceRef,
    pub surfaces: Vec<WorkSurfaceRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignment: Option<WorkAssignmentRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delegation: Option<WorkDelegationContext>,
    pub lifecycle: WorkLifecycle,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<WorkSummary>,
    pub session_refs: Vec<AgentSessionRef>,
    pub execution_bindings: Vec<WorkExecutionBinding>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub runtime_instances: Vec<RuntimeInstanceRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub runtime_runs: Vec<WorkRuntimeRun>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub runtime_issues: Vec<WorkRuntimeIssue>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub runtime_logs: Vec<WorkRuntimeLog>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub builder_preview_results: Vec<WorkBuilderPreviewResult>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub builder_validation_results: Vec<WorkBuilderValidationResult>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub builder_issues: Vec<WorkBuilderIssue>,
    pub artifact_refs: Vec<ArtifactRef>,
    pub memory_refs: Vec<MemoryRef>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl WorkRecord {
    pub fn new(
        id: WorkId,
        kind: WorkKind,
        title: String,
        objective: String,
        visibility: WorkVisibility,
        subject: WorkSubject,
        app_refs: Vec<WorkAppRelation>,
        scope: WorkScope,
        primary_surface: WorkSurfaceRef,
        now: i64,
    ) -> Self {
        let mut lifecycle = WorkLifecycle::default();
        lifecycle.push(WorkStatus::Active, "created", now);
        Self {
            id,
            kind,
            title,
            title_state: WorkTitleState::default(),
            objective,
            status: WorkStatus::Active,
            visibility,
            app_refs: normalize_app_refs(&subject, app_refs),
            subject,
            scope,
            primary_surface: primary_surface.clone(),
            surfaces: vec![primary_surface],
            assignment: None,
            delegation: None,
            lifecycle,
            summary: None,
            session_refs: Vec::new(),
            execution_bindings: Vec::new(),
            runtime_instances: Vec::new(),
            runtime_runs: Vec::new(),
            runtime_issues: Vec::new(),
            runtime_logs: Vec::new(),
            builder_preview_results: Vec::new(),
            builder_validation_results: Vec::new(),
            builder_issues: Vec::new(),
            artifact_refs: Vec::new(),
            memory_refs: Vec::new(),
            created_at: now,
            updated_at: now,
        }
    }

    pub fn touch(&mut self, now: i64) {
        self.updated_at = now;
    }

    pub fn set_status(&mut self, status: WorkStatus, label: impl Into<String>, now: i64) {
        self.status = status;
        self.lifecycle.push(status, label, now);
        self.touch(now);
    }

    pub fn bind_surface(&mut self, surface: WorkSurfaceRef, set_primary: bool, now: i64) {
        if !self.surfaces.iter().any(|existing| existing == &surface) {
            self.surfaces.push(surface.clone());
        }
        if set_primary {
            self.primary_surface = surface;
        }
        self.touch(now);
    }

    pub fn bind_runtime_instance(&mut self, instance: RuntimeInstanceRef, now: i64) {
        if !self
            .runtime_instances
            .iter()
            .any(|existing| existing.id == instance.id)
        {
            self.runtime_instances.push(instance);
            self.touch(now);
        }
    }

    pub fn work_session_id(&self) -> Option<&str> {
        self.surfaces.iter().find_map(|surface| match surface {
            WorkSurfaceRef::WorkSession { session_id } => Some(session_id.as_str()),
            _ => None,
        })
    }

    pub fn references_app(&self, app: &WorkAppRef) -> bool {
        self.subject.app_ref() == Some(app)
            || self.app_refs.iter().any(|relation| &relation.app == app)
    }

    pub fn references_component(&self, component: &WorkComponentRef) -> bool {
        self.subject.component_ref().is_some_and(|candidate| {
            candidate.component_id == component.component_id
                && candidate.component_kind == component.component_kind
                && (component.version.is_empty() || candidate.version == component.version)
        })
    }
}

fn normalize_app_refs(
    subject: &WorkSubject,
    app_refs: Vec<WorkAppRelation>,
) -> Vec<WorkAppRelation> {
    let mut normalized = Vec::new();
    if let Some(app) = subject.app_ref() {
        push_app_relation(&mut normalized, WorkAppRelation::subject(app.clone()));
    }
    for relation in app_refs {
        push_app_relation(&mut normalized, relation);
    }
    normalized
}

fn push_app_relation(relations: &mut Vec<WorkAppRelation>, relation: WorkAppRelation) {
    if relations.iter().any(|existing| {
        existing.app == relation.app
            && existing.role == relation.role
            && existing.surface_id == relation.surface_id
    }) {
        return;
    }
    if relation.role == WorkAppRelationRole::Subject
        && relations.iter().any(|existing| {
            existing.app == relation.app && existing.role == WorkAppRelationRole::Subject
        })
    {
        return;
    }
    relations.push(relation);
}

fn runtime_id_segment(value: &str, max_len: usize) -> String {
    let mut segment = value
        .chars()
        .filter_map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                Some(ch)
            } else if ch == ':' || ch == '/' || ch == '.' {
                Some('_')
            } else {
                None
            }
        })
        .take(max_len)
        .collect::<String>();
    if segment.is_empty() {
        segment = "instance".to_string();
    }
    segment
}
