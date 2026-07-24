use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkKind {
    OneShot,
    MultiStep,
    LongRunningSession,
    Recurring,
    Tracking,
    Topic,
    AppWorkflow,
    DelegatedWork,
}

impl Default for WorkKind {
    fn default() -> Self {
        Self::MultiStep
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkStatus {
    Draft,
    Active,
    Running,
    WaitingUser,
    Blocked,
    Paused,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
    Archived,
}

impl Default for WorkStatus {
    fn default() -> Self {
        Self::Active
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkVisibility {
    Primary,
    Secondary,
    Hidden,
}

impl Default for WorkVisibility {
    fn default() -> Self {
        Self::Primary
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum WorkScope {
    Global,
    Workspace { workspace_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkLocator {
    pub scope: WorkScope,
    pub work_id: super::ids::WorkId,
}

impl WorkScope {
    pub fn workspace_id(&self) -> Option<&str> {
        match self {
            WorkScope::Global => None,
            WorkScope::Workspace { workspace_id } => Some(workspace_id),
        }
    }
}

#[cfg(test)]
mod locator_contract_tests {
    use super::{WorkLocator, WorkScope};
    use crate::agentic_os::work::WorkId;

    #[test]
    fn work_locator_uses_one_camel_case_wire_contract() {
        let locator = WorkLocator {
            scope: WorkScope::Workspace {
                workspace_id: "ws_contract".to_string(),
            },
            work_id: WorkId::parse("work_contract").expect("valid Work ID"),
        };

        assert_eq!(
            serde_json::to_value(locator).expect("serialize Work locator"),
            serde_json::json!({
                "scope": {
                    "kind": "workspace",
                    "workspaceId": "ws_contract"
                },
                "workId": "work_contract"
            })
        );
    }
}
