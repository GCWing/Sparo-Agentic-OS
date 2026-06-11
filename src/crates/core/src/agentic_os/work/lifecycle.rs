use serde::{Deserialize, Serialize};

use super::types::WorkStatus;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkSummary {
    pub text: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkLifecycleEvent {
    pub status: WorkStatus,
    pub label: String,
    pub at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct WorkLifecycle {
    pub events: Vec<WorkLifecycleEvent>,
}

impl WorkLifecycle {
    pub fn push(&mut self, status: WorkStatus, label: impl Into<String>, at: i64) {
        self.events.push(WorkLifecycleEvent {
            status,
            label: label.into(),
            at,
        });
    }
}
