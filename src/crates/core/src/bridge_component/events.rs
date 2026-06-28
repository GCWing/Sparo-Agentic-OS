use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BridgeComponentRunStatus {
    Pending,
    Running,
    WaitingForApproval,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BridgeComponentEvent {
    #[serde(rename = "run.started")]
    RunStarted { run_id: String },
    #[serde(rename = "run.status")]
    RunStatus {
        status: BridgeComponentRunStatus,
        #[serde(default)]
        message: String,
    },
    #[serde(rename = "text.delta")]
    TextDelta { text: String },
    #[serde(rename = "thinking.delta")]
    ThinkingDelta { text: String },
    #[serde(rename = "tool.started")]
    ToolStarted {
        name: String,
        #[serde(default)]
        input: Value,
    },
    #[serde(rename = "tool.completed")]
    ToolCompleted {
        name: String,
        #[serde(default)]
        output: Value,
    },
    #[serde(rename = "tool.delta")]
    ToolDelta {
        name: String,
        #[serde(default)]
        delta: Value,
    },
    #[serde(rename = "artifact.created")]
    ArtifactCreated {
        #[serde(default)]
        artifact: Value,
    },
    #[serde(rename = "approval.required")]
    ApprovalRequired {
        #[serde(default)]
        request: Value,
    },
    #[serde(rename = "approval.resolved")]
    ApprovalResolved {
        #[serde(default)]
        response: Value,
    },
    #[serde(rename = "run.completed")]
    RunCompleted {
        #[serde(default)]
        output: Value,
    },
    #[serde(rename = "run.failed")]
    RunFailed {
        #[serde(default)]
        error: Value,
    },
    #[serde(rename = "run.cancelled")]
    RunCancelled {
        #[serde(default)]
        reason: Value,
    },
}
