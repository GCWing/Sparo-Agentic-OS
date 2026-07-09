use serde::{Deserialize, Serialize};

use super::ids::WorkId;
use super::record::WorkRecord;
use super::subject::{WorkAppRelation, WorkSubject};
use super::surface::WorkSurfaceRef;
use super::types::{WorkKind, WorkScope, WorkStatus};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkProjection {
    pub id: WorkId,
    pub kind: WorkKind,
    pub title: String,
    pub objective: String,
    pub status: WorkStatus,
    pub subject: WorkSubject,
    pub app_refs: Vec<WorkAppRelation>,
    pub scope: WorkScope,
    pub primary_surface: WorkSurfaceRef,
    pub running: bool,
    #[serde(default)]
    pub system_managed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_process_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub topic_work_id: Option<WorkId>,
    pub updated_at: i64,
}

impl From<&WorkRecord> for WorkProjection {
    fn from(record: &WorkRecord) -> Self {
        Self {
            id: record.id.clone(),
            kind: record.kind,
            title: record.title.clone(),
            objective: record.objective.clone(),
            status: record.status,
            subject: record.subject.clone(),
            app_refs: record.app_refs.clone(),
            scope: record.scope.clone(),
            primary_surface: record.primary_surface.clone(),
            running: record
                .execution_bindings
                .iter()
                .any(|binding| binding.is_running()),
            system_managed: record.system_managed,
            system_process_kind: record.system_process_kind.clone(),
            topic_work_id: record.topic_work_id.clone(),
            updated_at: record.updated_at,
        }
    }
}
