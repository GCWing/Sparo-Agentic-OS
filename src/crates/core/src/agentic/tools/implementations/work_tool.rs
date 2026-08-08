use async_trait::async_trait;
use serde_json::Value;

use crate::agentic::tools::framework::{
    Tool, ToolRenderOptions, ToolResult, ToolUseContext, ValidationResult,
};
use crate::agentic_os::tools::work::{handle, work_input_schema, WorkInput};
use crate::error::{CoreError, CoreResult};

use super::work_tool_support::{work_owner_from_tool_context, work_service_from_tool_context};

pub struct WorkTool;

impl WorkTool {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for WorkTool {
    fn name(&self) -> &str {
        "Work"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok("Run and manage specialist Work through one control-plane tool. action=start atomically creates and launches an Agent WorkSession and returns its work_id; action=continue sends more instructions to existing Work; action=status reads progress and results; action=control changes lifecycle state; action=reclassify changes kind or topic attachment. Always target Work by the work_id from start, never by a session id. System-managed works are immutable.".to_string())
    }

    fn input_schema(&self) -> Value {
        work_input_schema()
    }

    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        false
    }

    async fn validate_input(
        &self,
        input: &Value,
        _context: Option<&ToolUseContext>,
    ) -> ValidationResult {
        match serde_json::from_value::<WorkInput>(input.clone()) {
            Ok(_) => ValidationResult::default(),
            Err(error) => ValidationResult {
                result: false,
                message: Some(error.to_string()),
                error_code: Some(400),
                meta: None,
            },
        }
    }

    fn render_tool_use_message(&self, input: &Value, _options: &ToolRenderOptions) -> String {
        let action = input
            .get("action")
            .and_then(|value| value.as_str())
            .unwrap_or("?");
        match action {
            "start" => {
                let title = input
                    .get("title")
                    .and_then(|value| value.as_str())
                    .unwrap_or("Untitled Work");
                format!("Start Work: {}", title)
            }
            "continue" => format!(
                "Continue Work {}",
                input
                    .get("work_id")
                    .and_then(|value| value.as_str())
                    .unwrap_or("?")
            ),
            "status" => "Read Work status".to_string(),
            "control" => format!(
                "Control Work: {}",
                input
                    .get("control_action")
                    .and_then(|value| value.as_str())
                    .unwrap_or("?")
            ),
            _ => format!("Work: {}", action),
        }
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> CoreResult<Vec<ToolResult>> {
        let params: WorkInput = serde_json::from_value(input.clone())
            .map_err(|error| CoreError::tool(format!("Invalid input: {}", error)))?;
        let mut params = params;
        params.owner = work_owner_from_tool_context(context);
        let service = work_service_from_tool_context(context)?;
        let data = handle(&service, params).await?;
        let result_for_assistant = work_result_for_assistant(&data);
        Ok(vec![ToolResult::ok(data, Some(result_for_assistant))])
    }
}

fn work_result_for_assistant(data: &Value) -> String {
    let action = data
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    match action {
        "start" => render_single_work_result("Work started", data),
        "continue" => render_single_work_result("Work continued", data),
        "control" => render_single_work_result("Work controlled", data),
        "status" => {
            if data.get("work").is_some() {
                render_single_work_result("Work status", data)
            } else {
                render_work_list_result(data)
            }
        }
        _ => "Work updated. Use Work(action=\"status\", work_id=\"...\") to inspect progress and results.".to_string(),
    }
}

fn render_single_work_result(prefix: &str, data: &Value) -> String {
    let work = data.get("work").unwrap_or(data);
    let work_id = string_field(data, "work_id")
        .or_else(|| string_field(work, "id"))
        .unwrap_or("<unknown>");
    let title = string_field(work, "title").unwrap_or("Untitled Work");
    let status = string_field(data, "status")
        .or_else(|| string_field(work, "status"))
        .unwrap_or("unknown");
    let running = data
        .get("running")
        .and_then(Value::as_bool)
        .or_else(|| work.get("running").and_then(Value::as_bool))
        .unwrap_or(false);
    let summary = data
        .pointer("/result/summary/text")
        .and_then(Value::as_str)
        .or_else(|| work.pointer("/summary/text").and_then(Value::as_str));
    let artifact_count = data
        .pointer("/result/artifact_refs")
        .and_then(Value::as_array)
        .map(Vec::len)
        .or_else(|| {
            work.get("artifact_refs")
                .and_then(Value::as_array)
                .map(Vec::len)
        })
        .unwrap_or(0);
    let latest_execution_status = data
        .pointer("/result/latest_execution/status")
        .and_then(Value::as_str);

    let mut parts = vec![format!(
        "{prefix}: {work_id} [{status}{}] {}.",
        if running { ", running" } else { "" },
        compact_text(title, 100)
    )];

    if let Some(summary) = summary.filter(|value| !value.trim().is_empty()) {
        parts.push(format!("Latest summary: {}.", compact_text(summary, 180)));
    }
    if artifact_count > 0 {
        parts.push(format!("Artifacts: {artifact_count}."));
    }
    if let Some(execution_status) = latest_execution_status {
        parts.push(format!("Latest execution: {execution_status}."));
    }
    parts.push(format!(
        "Use Work(action=\"status\", work_id=\"{work_id}\") for the full Work record when needed."
    ));

    parts.join(" ")
}

fn render_work_list_result(data: &Value) -> String {
    let works = data
        .get("works")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if works.is_empty() {
        return "Work status: no matching Work found.".to_string();
    }

    let mut lines = vec![format!(
        "Work status list: {} Work item(s). Use Work(action=\"status\", work_id=\"...\") for progress, results, and lifecycle detail.",
        works.len()
    )];
    for work in works.iter().take(5) {
        let work_id = string_field(work, "id").unwrap_or("<unknown>");
        let status = string_field(work, "status").unwrap_or("unknown");
        let title = string_field(work, "title").unwrap_or("Untitled Work");
        let objective = string_field(work, "objective").unwrap_or("");
        lines.push(format!(
            "- {work_id} [{status}] {} | objective: {}",
            compact_text(title, 80),
            compact_text(objective, 120)
        ));
    }
    lines.join("\n")
}

fn string_field<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.get(field).and_then(Value::as_str)
}

fn compact_text(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    let mut chars = trimmed.chars();
    let compact = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{compact}...")
    } else {
        compact
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn work_schema_is_single_control_plane() {
        let schema = WorkTool::new().input_schema();
        let actions = schema["properties"]["action"]["enum"]
            .as_array()
            .expect("action enum");
        assert_eq!(actions.len(), 5);
        for action in ["start", "continue", "status", "control", "reclassify"] {
            assert!(
                actions.iter().any(|value| value.as_str() == Some(action)),
                "missing action {action}"
            );
        }
        assert_eq!(schema["required"].as_array().expect("required").len(), 1);
        assert_eq!(schema["additionalProperties"], false);
        assert!(schema["properties"].get("owner").is_none());
        assert!(schema["properties"].get("workspace_path").is_none());

        let scope_schema =
            serde_json::to_string(&schema["properties"]["scope"]).expect("serialize scope schema");
        assert!(scope_schema.contains("\"global\""));
        assert!(scope_schema.contains("\"workspace\""));
        assert!(scope_schema.contains("\"workspace_path\""));
        assert!(!scope_schema.contains("workspaceId"));
    }

    #[test]
    fn status_result_for_assistant_summarizes_single_work() {
        let data = json!({
            "action": "status",
            "work_id": "work_123",
            "status": "completed",
            "running": false,
            "result": {
                "summary": { "text": "Implemented the feature and ran tests." },
                "artifact_refs": [{ "id": "artifact_1" }],
                "latest_execution": { "status": "completed" }
            },
            "work": {
                "id": "work_123",
                "title": "Implement feature",
                "status": "completed"
            }
        });

        let summary = work_result_for_assistant(&data);

        assert!(summary.contains("Work status: work_123 [completed] Implement feature."));
        assert!(summary.contains("Latest summary: Implemented the feature and ran tests."));
        assert!(summary.contains("Artifacts: 1."));
        assert!(summary.contains("Work(action=\"status\", work_id=\"work_123\")"));
    }

    #[test]
    fn status_result_for_assistant_summarizes_work_list() {
        let data = json!({
            "action": "status",
            "works": [
                {
                    "id": "work_a",
                    "title": "Fix auth",
                    "objective": "Fix login expiry",
                    "status": "active"
                }
            ]
        });

        let summary = work_result_for_assistant(&data);

        assert!(summary.contains("Work status list: 1 Work item(s)."));
        assert!(summary.contains("work_a [active] Fix auth"));
        assert!(summary.contains("Use Work(action=\"status\", work_id=\"...\")"));
    }
}
