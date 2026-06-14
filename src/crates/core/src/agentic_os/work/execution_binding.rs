use serde::{Deserialize, Serialize};

use super::ids::WorkId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkExecutionBindingStatus {
    Queued,
    Running,
    WaitingUser,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum WorkExecutionSource {
    AgentSessionRun {
        session_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        turn_id: Option<String>,
    },
    DelegatedWorkRun {
        parent_work_id: WorkId,
        child_work_id: WorkId,
    },
    LiveAppWorker {
        app_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        worker_id: Option<String>,
    },
    ApplicationAction {
        application_id: String,
        action_id: String,
    },
    RuntimeSubagentRun {
        run_id: String,
    },
    External {
        label: String,
        reference: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkExecutionBinding {
    pub id: String,
    pub status: WorkExecutionBindingStatus,
    pub source: WorkExecutionSource,
    pub created_at: i64,
    pub updated_at: i64,
}

impl WorkExecutionBinding {
    pub fn new(source: WorkExecutionSource, status: WorkExecutionBindingStatus, now: i64) -> Self {
        Self {
            id: format!("exec_{}", uuid::Uuid::new_v4().simple()),
            source,
            status,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn is_running(&self) -> bool {
        matches!(
            self.status,
            WorkExecutionBindingStatus::Queued
                | WorkExecutionBindingStatus::Running
                | WorkExecutionBindingStatus::WaitingUser
        )
    }

    pub fn set_status(&mut self, status: WorkExecutionBindingStatus, now: i64) {
        self.status = status;
        self.updated_at = now;
    }
}
