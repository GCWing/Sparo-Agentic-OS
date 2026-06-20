use crate::agentic::goal::{get_global_goal_service, GoalToolInput};
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use serde_json::{json, Value};

/// Advisory goal tool for the executing agent.
///
/// Completion is owned by the goal loop (a judge reviews the goal after every
/// turn), so this tool deliberately cannot complete, verify, or submit
/// evidence. The agent can only read the goal, drop a progress note, or signal
/// that it is genuinely blocked.
pub struct GoalTool;

impl GoalTool {
    pub fn new() -> Self {
        Self
    }

    pub fn name_str() -> &'static str {
        "Goal"
    }
}

impl Default for GoalTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for GoalTool {
    fn name(&self) -> &str {
        Self::name_str()
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok("Inspect the active session goal, record a progress note, or report that you are blocked. A judge automatically reviews the goal after every turn, so you cannot complete or verify the goal through this tool.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["get", "note", "blocked"],
                    "description": "get: read the current goal; note: record a short progress note; blocked: report that you cannot proceed without help."
                },
                "summary": {
                    "type": ["string", "null"],
                    "description": "Progress note text (action=note) or blocker description (action=blocked)."
                }
            },
            "required": ["action"],
            "additionalProperties": false
        })
    }

    fn is_readonly(&self) -> bool {
        false
    }

    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        false
    }

    async fn validate_input(
        &self,
        input: &Value,
        _context: Option<&ToolUseContext>,
    ) -> crate::agentic::tools::framework::ValidationResult {
        let parsed: Result<GoalToolInput, _> = serde_json::from_value(input.clone());
        match parsed {
            Ok(value) => {
                let action = value.action.as_str();
                let allowed = matches!(action, "get" | "note" | "blocked");
                crate::agentic::tools::framework::ValidationResult {
                    result: allowed,
                    message: if allowed {
                        None
                    } else {
                        Some(format!("Unsupported Goal action: {}", action))
                    },
                    error_code: None,
                    meta: None,
                }
            }
            Err(error) => crate::agentic::tools::framework::ValidationResult {
                result: false,
                message: Some(format!("Invalid Goal input: {}", error)),
                error_code: None,
                meta: None,
            },
        }
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let parsed: GoalToolInput = serde_json::from_value(input.clone()).map_err(|error| {
            BitFunError::validation(format!("Invalid Goal tool input: {}", error))
        })?;
        let service = get_global_goal_service()
            .ok_or_else(|| BitFunError::service("Goal service is not initialized"))?;
        let session_id = context
            .session_id
            .as_deref()
            .ok_or_else(|| BitFunError::validation("Goal tool requires session_id"))?;
        let workspace = context
            .workspace
            .as_ref()
            .ok_or_else(|| BitFunError::validation("Goal tool requires a workspace"))?;
        let workspace_path = workspace.root_path();

        let response = match parsed.action.as_str() {
            "get" => {
                service
                    .status(crate::agentic::goal::GoalStatusRequest {
                        session_id: session_id.to_string(),
                        workspace_path: workspace.root_path_string(),
                    })
                    .await?
            }
            "note" => {
                let note = parsed
                    .summary
                    .unwrap_or_else(|| "Progress was reported without a summary.".to_string());
                service
                    .record_progress(workspace_path, session_id, note)
                    .await?
            }
            "blocked" => {
                let note = parsed
                    .summary
                    .unwrap_or_else(|| "The agent reported a blocker.".to_string());
                service
                    .record_blocker_claim(workspace_path, session_id, note)
                    .await?
            }
            other => {
                return Err(BitFunError::validation(format!(
                    "Unsupported Goal action: {}",
                    other
                )));
            }
        };

        let assistant_text = if let Some(goal) = &response.goal {
            format!(
                "Goal action processed. Current status: {:?}. Revision: {}.",
                goal.status, goal.revision
            )
        } else {
            response.message.clone()
        };

        Ok(vec![ToolResult::ok(
            serde_json::to_value(response).map_err(|error| {
                BitFunError::service(format!("Failed to encode Goal response: {}", error))
            })?,
            Some(assistant_text),
        )])
    }
}

#[cfg(test)]
mod tests {
    use super::{GoalTool, Tool};

    #[test]
    fn schema_exposes_only_advisory_actions() {
        let schema = GoalTool::new().input_schema();
        let actions = schema["properties"]["action"]["enum"]
            .as_array()
            .expect("action enum");
        assert!(actions.iter().any(|value| value == "get"));
        assert!(actions.iter().any(|value| value == "note"));
        assert!(actions.iter().any(|value| value == "blocked"));
        assert!(!actions.iter().any(|value| value == "complete"));
        assert!(!actions.iter().any(|value| value == "submit_evidence"));
    }
}
