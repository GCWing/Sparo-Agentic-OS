//! Outcome review result submission tool.
//!
//! Used by OutcomeReview to return a structured, OSAgent-consumable verdict.

use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::error::CoreResult;
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct OutcomeReviewTool;

impl OutcomeReviewTool {
    pub fn new() -> Self {
        Self
    }

    pub fn name_str() -> &'static str {
        "submit_outcome_review"
    }

    pub fn input_schema_value() -> Value {
        json!({
            "type": "object",
            "properties": {
                "work_id": {
                    "type": ["string", "null"],
                    "description": "Work id being reviewed, when known."
                },
                "verdict": {
                    "type": "string",
                    "enum": ["pass", "pass_with_notes", "needs_revision", "failed", "inconclusive"],
                    "description": "Overall outcome verdict."
                },
                "confidence": {
                    "type": "string",
                    "enum": ["high", "medium", "low"],
                    "description": "Confidence in the verdict."
                },
                "risk_level": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                    "description": "Delivery risk if OSAgent reports this result now."
                },
                "summary": {
                    "type": "string",
                    "description": "One-sentence outcome review conclusion."
                },
                "final_effect": {
                    "type": "string",
                    "description": "What the user would actually receive or experience."
                },
                "acceptance_checks": {
                    "type": "array",
                    "description": "Evidence-backed checks against the user's intended outcome.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "criterion": { "type": "string" },
                            "status": {
                                "type": "string",
                                "enum": ["passed", "failed", "partial", "unverified"]
                            },
                            "evidence": { "type": "string" },
                            "reasoning": { "type": "string" }
                        },
                        "required": ["criterion", "status", "evidence", "reasoning"],
                        "additionalProperties": false
                    }
                },
                "issues": {
                    "type": "array",
                    "description": "Result-quality issues that matter to handoff.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "severity": {
                                "type": "string",
                                "enum": ["blocker", "major", "minor"]
                            },
                            "title": { "type": "string" },
                            "evidence": { "type": "string" },
                            "impact": { "type": "string" },
                            "suggested_next_step": { "type": "string" }
                        },
                        "required": ["severity", "title", "evidence", "impact", "suggested_next_step"],
                        "additionalProperties": false
                    }
                },
                "verification_gaps": {
                    "type": "array",
                    "description": "Important evidence that is missing or unavailable.",
                    "items": { "type": "string" }
                },
                "recommended_next_action": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": ["report_to_user", "continue_work", "start_specialist_review", "ask_user", "stop"]
                        },
                        "instructions_for_os_agent": { "type": "string" },
                        "instructions_for_work_if_revision_needed": {
                            "type": ["string", "null"]
                        }
                    },
                    "required": ["action", "instructions_for_os_agent"],
                    "additionalProperties": false
                }
            },
            "required": [
                "verdict",
                "confidence",
                "risk_level",
                "summary",
                "final_effect",
                "acceptance_checks",
                "issues",
                "verification_gaps",
                "recommended_next_action"
            ],
            "additionalProperties": false
        })
    }

    fn validate_and_fill_defaults(input: &mut Value) {
        if input.get("verdict").is_none() {
            input["verdict"] = json!("inconclusive");
        }
        if input.get("confidence").is_none() {
            input["confidence"] = json!("low");
        }
        if input.get("risk_level").is_none() {
            input["risk_level"] = json!("medium");
        }
        if input.get("summary").is_none() {
            input["summary"] = json!("Outcome review did not provide a complete conclusion.");
        }
        if input.get("final_effect").is_none() {
            input["final_effect"] = json!("");
        }
        if input.get("acceptance_checks").is_none() {
            input["acceptance_checks"] = json!([]);
        }
        if input.get("issues").is_none() {
            input["issues"] = json!([]);
        }
        if input.get("verification_gaps").is_none() {
            input["verification_gaps"] = json!(["Outcome review output was incomplete."]);
        }
        if input.get("recommended_next_action").is_none() {
            input["recommended_next_action"] = json!({
                "action": "stop",
                "instructions_for_os_agent": "Treat this outcome review as incomplete; gather stronger evidence or rerun review before reporting final completion.",
                "instructions_for_work_if_revision_needed": null
            });
        } else if let Some(action) = input.get_mut("recommended_next_action") {
            if action.get("action").is_none() {
                action["action"] = json!("stop");
            }
            if action.get("instructions_for_os_agent").is_none() {
                action["instructions_for_os_agent"] = json!(
                    "Review output omitted OSAgent instructions; do not report final completion until the missing decision is resolved."
                );
            }
            if action
                .get("instructions_for_work_if_revision_needed")
                .is_none()
            {
                action["instructions_for_work_if_revision_needed"] = Value::Null;
            }
        }
    }
}

impl Default for OutcomeReviewTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for OutcomeReviewTool {
    fn name(&self) -> &str {
        Self::name_str()
    }

    async fn description(&self) -> CoreResult<String> {
        Ok("Submit an evidence-backed outcome review verdict for OSAgent. Use after inspecting the final effect of a Work result; this tool is read-only and does not change Work state.".to_string())
    }

    fn input_schema(&self) -> Value {
        Self::input_schema_value()
    }

    fn is_readonly(&self) -> bool {
        true
    }

    fn is_concurrency_safe(&self, _input: Option<&Value>) -> bool {
        true
    }

    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        false
    }

    async fn call_impl(
        &self,
        input: &Value,
        _context: &ToolUseContext,
    ) -> CoreResult<Vec<ToolResult>> {
        let mut filled_input = input.clone();
        Self::validate_and_fill_defaults(&mut filled_input);
        Ok(vec![ToolResult::Result {
            data: filled_input,
            result_for_assistant: Some("Outcome review submitted successfully".to_string()),
            image_attachments: None,
        }])
    }
}

#[cfg(test)]
mod tests {
    use super::{OutcomeReviewTool, Tool};
    use serde_json::json;

    #[test]
    fn schema_requires_safe_outcome_fields() {
        let schema = OutcomeReviewTool::input_schema_value();
        let required = schema
            .get("required")
            .and_then(|value| value.as_array())
            .expect("required fields");

        assert!(required.iter().any(|value| value == "verdict"));
        assert!(required.iter().any(|value| value == "final_effect"));
        assert!(required
            .iter()
            .any(|value| value == "recommended_next_action"));
    }

    #[test]
    fn incomplete_output_defaults_to_inconclusive() {
        let mut value = json!({});
        OutcomeReviewTool::validate_and_fill_defaults(&mut value);

        assert_eq!(value["verdict"], "inconclusive");
        assert_eq!(value["confidence"], "low");
        assert_eq!(value["recommended_next_action"]["action"], "stop");
    }

    #[test]
    fn tool_is_readonly() {
        let tool = OutcomeReviewTool::new();
        assert!(tool.is_readonly());
        assert!(!tool.needs_permissions(None));
    }
}
