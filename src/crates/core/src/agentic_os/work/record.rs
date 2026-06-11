use serde::{Deserialize, Serialize};

use super::assignment::WorkAssignmentRef;
use super::execution_binding::WorkExecutionBinding;
use super::ids::WorkId;
use super::lifecycle::{WorkLifecycle, WorkSummary};
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
pub struct ArtifactRef {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemoryRef {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
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
    pub scope: WorkScope,
    pub primary_surface: WorkSurfaceRef,
    pub surfaces: Vec<WorkSurfaceRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignment: Option<WorkAssignmentRef>,
    pub lifecycle: WorkLifecycle,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<WorkSummary>,
    pub session_refs: Vec<AgentSessionRef>,
    pub execution_bindings: Vec<WorkExecutionBinding>,
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
            scope,
            primary_surface: primary_surface.clone(),
            surfaces: vec![primary_surface],
            assignment: None,
            lifecycle,
            summary: None,
            session_refs: Vec::new(),
            execution_bindings: Vec::new(),
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

    pub fn work_session_id(&self) -> Option<&str> {
        self.surfaces.iter().find_map(|surface| match surface {
            WorkSurfaceRef::WorkSession { session_id } => Some(session_id.as_str()),
            _ => None,
        })
    }
}
