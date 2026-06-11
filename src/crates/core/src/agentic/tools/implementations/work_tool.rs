use async_trait::async_trait;
use serde_json::{json, Value};

use crate::agentic::tools::framework::{
    Tool, ToolRenderOptions, ToolResult, ToolUseContext, ValidationResult,
};
use crate::agentic_os::tools::work::{handle, WorkInput};
use crate::util::errors::{BitFunError, BitFunResult};

use super::work_tool_support::work_service_from_tool_context;

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

    async fn description(&self) -> BitFunResult<String> {
        Ok("Manage Agentic OS Work through one control-plane tool. Use action=start to atomically create and launch an Agent WorkSession, action=continue for existing Work, action=status to inspect progress/results, and action=control to cancel, pause, resume, archive, or reopen Work. Always target Work by work_id; never schedule by session_id.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["start", "continue", "status", "control"],
                    "description": "start creates and launches a new Work; continue sends instructions to an existing Work; status reads progress/results; control changes lifecycle state."
                },
                "work_id": {
                    "type": "string",
                    "description": "Required for continue/control and for status of a specific Work. Never pass a session id here."
                },
                "kind": {
                    "type": "string",
                    "enum": ["one_shot", "multi_step", "long_running_session", "recurring", "tracking", "topic", "app_workflow", "delegated_work"],
                    "description": "Only used by action=start. Defaults to multi_step."
                },
                "title": {
                    "type": "string",
                    "description": "Required for action=start. Short human-readable Work title; preserve an exact title when the user provides one."
                },
                "objective": {
                    "type": "string",
                    "description": "Required for action=start. Durable goal of the Work."
                },
                "instructions": {
                    "type": "string",
                    "description": "Required for action=start and action=continue. Include goal, context, constraints, expected deliverable, verification, and reporting requirements."
                },
                "scope": {
                    "type": "object",
                    "description": "Required for action=start. Use workspace for project work and system for Agentic OS/global work.",
                    "properties": {
                        "kind": { "type": "string", "enum": ["system", "workspace"] },
                        "workspace_path": {
                            "type": "string",
                            "description": "Required when scope.kind=\"workspace\"."
                        }
                    },
                    "required": ["kind"],
                    "additionalProperties": false
                },
                "executor": {
                    "type": "object",
                    "description": "Only used by action=start. Omit to use Prime Builder (agentic).",
                    "properties": {
                        "kind": { "type": "string", "enum": ["agent"] },
                        "agent_type": {
                            "type": "string",
                            "description": "Agent type. Use agentic for Prime Builder / code work; Cowork for office deliverables; Design for UI/UX; DeepResearch for research; LiveAppStudio for live apps; AgentAppStudio for Agent Apps."
                        }
                    },
                    "additionalProperties": false
                },
                "control_action": {
                    "type": "string",
                    "enum": ["pause", "resume", "cancel_current_execution", "archive", "reopen"],
                    "description": "Required for action=control."
                },
                "include_archived": {
                    "type": "boolean",
                    "description": "Only used by action=status without work_id. Defaults to false."
                }
            },
            "required": ["action"],
            "additionalProperties": false
        })
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
    ) -> BitFunResult<Vec<ToolResult>> {
        let params: WorkInput = serde_json::from_value(input.clone())
            .map_err(|error| BitFunError::tool(format!("Invalid input: {}", error)))?;
        let service = work_service_from_tool_context(context)?;
        let data = handle(&service, params).await?;
        Ok(vec![ToolResult::ok(data, Some("Work updated".to_string()))])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn work_schema_is_single_control_plane() {
        let schema = WorkTool::new().input_schema();
        let actions = schema["properties"]["action"]["enum"]
            .as_array()
            .expect("action enum");
        assert_eq!(actions.len(), 4);
        for action in ["start", "continue", "status", "control"] {
            assert!(
                actions.iter().any(|value| value.as_str() == Some(action)),
                "missing action {action}"
            );
        }
        assert_eq!(schema["required"].as_array().expect("required").len(), 1);
    }
}
