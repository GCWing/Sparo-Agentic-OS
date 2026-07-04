use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    ApplicationAction {
        application_id: String,
        action_id: String,
    },
    RuntimeInstanceRun {
        runtime_instance_id: String,
        run_id: String,
        component_id: String,
        action: String,
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
#[serde(rename_all = "camelCase")]
pub struct WorkExecutionAppStudioContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_id: Option<WorkId>,
    pub issue_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_app_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_instance_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_result_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl WorkExecutionAppStudioContext {
    pub fn from_turn_metadata(metadata: Option<&Value>) -> Option<Self> {
        let issue = metadata?.get("appStudioIssueContext")?;
        let issue_id = string_field(issue, "issueId")?;
        Some(Self {
            work_id: string_field(issue, "workId").and_then(|value| WorkId::parse(value).ok()),
            issue_id,
            product_app_id: string_field(issue, "productAppId"),
            subject_kind: string_field(issue, "subjectKind"),
            component_kind: string_field(issue, "componentKind"),
            runtime_instance_id: string_field(issue, "runtimeInstanceId"),
            component_id: string_field(issue, "componentId"),
            preview_result_id: string_field(issue, "previewResultId"),
            package_root: string_field(issue, "packageRoot"),
            severity: string_field(issue, "severity"),
            category: string_field(issue, "category"),
            source: string_field(issue, "source"),
            message: string_field(issue, "message"),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkExecutionBinding {
    pub id: String,
    pub status: WorkExecutionBindingStatus,
    pub source: WorkExecutionSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_studio: Option<WorkExecutionAppStudioContext>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_message_queued_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl WorkExecutionBinding {
    pub fn new(source: WorkExecutionSource, status: WorkExecutionBindingStatus, now: i64) -> Self {
        Self {
            id: format!("exec_{}", uuid::Uuid::new_v4().simple()),
            source,
            status,
            app_studio: None,
            work_message_queued_at: None,
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

    pub fn mark_work_message_queued(&mut self, now: i64) {
        self.work_message_queued_at = Some(now);
        self.updated_at = now;
    }
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    match value.get(key)? {
        Value::String(text) => {
            let trimmed = text.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn app_studio_context_from_turn_metadata_parses_work_and_issue() {
        let metadata = json!({
            "appStudioIssueContext": {
                "workId": "work_123",
                "issueId": "studio-issue-1",
                "runtimeInstanceId": "runtime-1",
                "componentId": "surface-1",
                "packageRoot": "product-app://app@1.0.0"
            }
        });

        let context = WorkExecutionAppStudioContext::from_turn_metadata(Some(&metadata))
            .expect("app studio context");

        assert_eq!(
            context.work_id.as_ref().map(WorkId::as_str),
            Some("work_123")
        );
        assert_eq!(context.issue_id, "studio-issue-1");
        assert_eq!(context.runtime_instance_id.as_deref(), Some("runtime-1"));
        assert_eq!(context.component_id.as_deref(), Some("surface-1"));
    }
}
