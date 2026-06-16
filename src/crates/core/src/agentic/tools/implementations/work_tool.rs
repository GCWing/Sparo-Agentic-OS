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
        Ok("Run and manage specialist Work through one control-plane tool. action=start atomically creates and launches an Agent WorkSession and returns its work_id; action=continue sends more instructions to existing Work; action=status reads progress and results; action=control changes lifecycle state. Always target Work by the work_id from start, never by a session id.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["start", "continue", "status", "control"],
                    "description": "start: create and launch new Work. continue: add instructions to existing Work. status: read progress and results. control: change lifecycle state."
                },
                "work_id": {
                    "type": "string",
                    "description": "The Work to target. Required for continue and control, and for status of one specific Work. This is the work_id returned by start, not a session id."
                },
                "kind": {
                    "type": "string",
                    "enum": ["one_shot", "multi_step", "long_running_session"],
                    "description": "start only. multi_step (default) for normal multi-step execution; one_shot for a single self-contained task; long_running_session for ongoing work."
                },
                "title": {
                    "type": "string",
                    "description": "start only, required. Short Work title; keep the user's exact title when they give one."
                },
                "objective": {
                    "type": "string",
                    "description": "start only, required. The durable goal of the Work."
                },
                "instructions": {
                    "type": "string",
                    "description": "Required for start and continue. The Agent only sees this text, so make it self-contained: goal, context, constraints, expected deliverable, how to verify, and how to report."
                },
                "scope": {
                    "type": "object",
                    "description": "start only, required. workspace for project work; system for Agentic OS or non-project work.",
                    "properties": {
                        "kind": { "type": "string", "enum": ["system", "workspace"] },
                        "workspace_path": {
                            "type": "string",
                            "description": "Required when kind is workspace."
                        }
                    },
                    "required": ["kind"],
                    "additionalProperties": false
                },
                "executor": {
                    "type": "object",
                    "description": "start only. Omit to default to agentic (Prime Builder).",
                    "properties": {
                        "kind": { "type": "string", "enum": ["agent"] },
                        "agent_type": {
                            "type": "string",
                            "description": "agentic for code work; Cowork for office deliverables; Design for UI/UX; DeepResearch for research; LiveAppStudio for live apps; AgentAppStudio for Agent Apps."
                        }
                    },
                    "additionalProperties": false
                },
                "control_action": {
                    "type": "string",
                    "enum": ["pause", "resume", "cancel_current_execution", "archive", "reopen"],
                    "description": "control only, required."
                },
                "include_archived": {
                    "type": "boolean",
                    "description": "status list only. Include archived Work. Defaults to false."
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
