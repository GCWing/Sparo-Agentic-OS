use serde::{Deserialize, Serialize};

use super::ids::WorkId;
use super::record::WorkRecord;
use super::surface::WorkSurfaceRef;
use super::types::{WorkKind, WorkScope, WorkStatus};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkProjection {
    pub id: WorkId,
    pub kind: WorkKind,
    pub title: String,
    pub objective: String,
    pub status: WorkStatus,
    pub scope: WorkScope,
    pub primary_surface: WorkSurfaceRef,
    pub running: bool,
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
            scope: record.scope.clone(),
            primary_surface: record.primary_surface.clone(),
            running: record
                .execution_bindings
                .iter()
                .any(|binding| binding.is_running()),
            updated_at: record.updated_at,
        }
    }
}
