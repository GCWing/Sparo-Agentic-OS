use super::agent_session_handoff::{
    find_existing_session, handoff_source_session_id, handoff_source_workspace,
    handoff_to_agent_session, resolve_handoff_workspace, validate_session_id,
    AgentSessionHandoffRequest, AgentSessionHandoffTarget, ExistingAgentSessionHandoffTarget,
};
use crate::agentic::tools::framework::{
    Tool, ToolRenderOptions, ToolResult, ToolUseContext, ValidationResult,
};
use crate::error::{CoreError, CoreResult};
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

/// SessionMessage tool - send a message to another session via the dialog scheduler
pub struct SessionMessageTool;

impl Default for SessionMessageTool {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionMessageTool {
    pub fn new() -> Self {
        Self
    }
}

#[derive(Debug, Clone, Deserialize)]
enum SessionMessageAgentType {
    #[serde(rename = "Runno", alias = "runno", alias = "RUNNO")]
    Runno,
    #[serde(rename = "bitfun-coder", alias = "BitFunCoder", alias = "bitfun_coder")]
    BitFunCoder,
    #[serde(rename = "bitfun-plan", alias = "BitFunPlan", alias = "bitfun_plan")]
    BitFunPlan,
    #[serde(rename = "bitfun-debug", alias = "BitFunDebug", alias = "bitfun_debug")]
    BitFunDebug,
    #[serde(rename = "bitfun-team", alias = "BitFunTeam", alias = "bitfun_team")]
    BitFunTeam,
    #[serde(rename = "Cowork", alias = "cowork", alias = "COWORK")]
    Cowork,
    #[serde(rename = "Design", alias = "design", alias = "DESIGN")]
    Design,
    #[serde(
        rename = "DeepResearch",
        alias = "deepresearch",
        alias = "deep-research",
        alias = "deep_research"
    )]
    DeepResearch,
}

impl SessionMessageAgentType {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Runno => "Runno",
            Self::BitFunCoder => "bitfun-coder",
            Self::BitFunPlan => "bitfun-plan",
            Self::BitFunDebug => "bitfun-debug",
            Self::BitFunTeam => "bitfun-team",
            Self::Cowork => "Cowork",
            Self::Design => "Design",
            Self::DeepResearch => "DeepResearch",
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        if value.eq_ignore_ascii_case("Runno") {
            Some(Self::Runno)
        } else if value.eq_ignore_ascii_case("bitfun-coder") {
            Some(Self::BitFunCoder)
        } else if value.eq_ignore_ascii_case("bitfun-plan") {
            Some(Self::BitFunPlan)
        } else if value.eq_ignore_ascii_case("bitfun-debug") {
            Some(Self::BitFunDebug)
        } else if value.eq_ignore_ascii_case("bitfun-team") {
            Some(Self::BitFunTeam)
        } else if value.eq_ignore_ascii_case("cowork") {
            Some(Self::Cowork)
        } else if value.eq_ignore_ascii_case("design") {
            Some(Self::Design)
        } else if value.eq_ignore_ascii_case("deepresearch")
            || value.eq_ignore_ascii_case("deep-research")
            || value.eq_ignore_ascii_case("deep_research")
        {
            Some(Self::DeepResearch)
        } else {
            None
        }
    }

    fn is_coding_mode(&self) -> bool {
        matches!(
            self,
            Self::BitFunCoder | Self::BitFunPlan | Self::BitFunDebug | Self::BitFunTeam
        )
    }
}

#[derive(Debug, Clone, Deserialize)]
struct SessionMessageInput {
    workspace: String,
    session_id: String,
    message: String,
    agent_type: Option<SessionMessageAgentType>,
}

#[async_trait]
impl Tool for SessionMessageTool {
    fn name(&self) -> &str {
        "SessionMessage"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(
            r#"Asynchronously send a message to another agent session. When the target session finishes, its result is automatically sent back to you as a follow-up message.

You must provide the target workspace as an absolute path, and you can optionally set agent_type to choose how the target session handles the request:
- "Runno": OS-native general execution for planning, automation, implementation, and verification.
- "bitfun-coder": BitFun Coder's default coding mode.
- "bitfun-plan": BitFun Coder planning mode for clarifying requirements and producing an implementation plan before coding.
- "bitfun-debug": BitFun Coder debugging mode for diagnosing and repairing defects with evidence.
- "bitfun-team": BitFun Coder team mode for role-based software delivery.
- "Cowork": Collaborative agent for office-style work such as research, documentation, presentations, etc.
- "Design": Design-focused agent for HTML prototypes, design artifacts, and visual exploration.
- "DeepResearch": Deep research agent for source-backed research and synthesis.

When overriding an existing BitFun Coder session's agent_type, only switching among the "bitfun-*" modes is allowed. It will not switch sessions to or from "Runno", "Cowork", "Design", or "DeepResearch"."#
                .to_string(),
        )
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "workspace": {
                    "type": "string",
                    "description": "Required absolute target workspace path."
                },
                "session_id": {
                    "type": "string",
                    "description": "Target session ID."
                },
                "message": {
                    "type": "string",
                    "description": "Message to send to the target session."
                },
                "agent_type": {
                    "type": "string",
                    "enum": ["Runno", "bitfun-coder", "bitfun-plan", "bitfun-debug", "bitfun-team", "Cowork", "Design", "DeepResearch"],
                    "description": "Optional target agent type. Defaults to the target session's current agent type."
                }
            },
            "required": ["workspace", "session_id", "message"],
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
        context: Option<&ToolUseContext>,
    ) -> ValidationResult {
        let parsed: SessionMessageInput = match serde_json::from_value(input.clone()) {
            Ok(value) => value,
            Err(err) => {
                return ValidationResult {
                    result: false,
                    message: Some(format!("Invalid input: {}", err)),
                    error_code: Some(400),
                    meta: None,
                };
            }
        };

        if let Err(message) = validate_session_id(&parsed.session_id) {
            return ValidationResult {
                result: false,
                message: Some(message),
                error_code: Some(400),
                meta: None,
            };
        }

        if parsed.message.trim().is_empty() {
            return ValidationResult {
                result: false,
                message: Some("message cannot be empty".to_string()),
                error_code: Some(400),
                meta: None,
            };
        }

        if parsed.workspace.trim().is_empty() {
            return ValidationResult {
                result: false,
                message: Some("workspace is required and cannot be empty".to_string()),
                error_code: Some(400),
                meta: None,
            };
        }

        let Some(context) = context else {
            let workspace = parsed.workspace.trim();
            if workspace.is_empty() {
                return ValidationResult {
                    result: false,
                    message: Some("workspace is required and cannot be empty".to_string()),
                    error_code: Some(400),
                    meta: None,
                };
            }
            if !std::path::Path::new(workspace).is_absolute()
                && !crate::agentic::tools::workspace_paths::posix_style_path_is_absolute(workspace)
            {
                return ValidationResult {
                    result: false,
                    message: Some("workspace must be an absolute path".to_string()),
                    error_code: Some(400),
                    meta: None,
                };
            }
            return ValidationResult::default();
        };

        let ws_ok = if context.is_remote() {
            crate::agentic::tools::workspace_paths::posix_style_path_is_absolute(
                parsed.workspace.trim(),
            )
        } else {
            std::path::Path::new(parsed.workspace.trim()).is_absolute()
        };
        if !ws_ok {
            return ValidationResult {
                result: false,
                message: Some("workspace must be an absolute path".to_string()),
                error_code: Some(400),
                meta: None,
            };
        }

        let Some(source_session_id) = context.session_id.as_deref() else {
            return ValidationResult {
                result: false,
                message: Some(
                    "SessionMessage requires a source session in tool context".to_string(),
                ),
                error_code: Some(400),
                meta: None,
            };
        };

        if source_session_id == parsed.session_id {
            return ValidationResult {
                result: false,
                message: Some(
                    "SessionMessage cannot send a message to the same session".to_string(),
                ),
                error_code: Some(400),
                meta: None,
            };
        }

        ValidationResult::default()
    }

    fn render_tool_use_message(&self, input: &Value, _options: &ToolRenderOptions) -> String {
        let workspace = input
            .get("workspace")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown workspace");
        let session_id = input
            .get("session_id")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");

        format!("Send message to session {} in {}", session_id, workspace)
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> CoreResult<Vec<ToolResult>> {
        let params: SessionMessageInput = serde_json::from_value(input.clone())
            .map_err(|e| CoreError::tool(format!("Invalid input: {}", e)))?;
        let workspace = resolve_handoff_workspace(&params.workspace, context, false).await?;
        let source_session_id = handoff_source_session_id(context, "SessionMessage")?.to_string();
        let target_session_id = params.session_id.clone();

        if source_session_id == target_session_id {
            return Err(CoreError::tool(
                "SessionMessage cannot send a message to the same session".to_string(),
            ));
        }

        let source_workspace = handoff_source_workspace(context, "SessionMessage")?;
        let agentic = context.agentic().ok_or_else(|| {
            crate::error::CoreError::tool("agentic stack not initialized".to_string())
        })?;
        let target_session =
            find_existing_session(&agentic.coordinator, &workspace, &target_session_id).await?;

        let persisted_agent_type = target_session.agent_type.trim();
        let target_agent_type = if let Some(requested_agent_type) = params.agent_type.as_ref() {
            let current_agent_type = if persisted_agent_type.is_empty() {
                SessionMessageAgentType::Runno
            } else {
                SessionMessageAgentType::from_str(persisted_agent_type).ok_or_else(|| {
                    CoreError::tool(format!(
                        "SessionMessage agent_type override is only supported for sessions using 'Runno', 'bitfun-coder', 'bitfun-plan', 'bitfun-debug', 'bitfun-team', 'Cowork', 'Design', or 'DeepResearch'. Current agent type is '{}'.",
                        persisted_agent_type
                    ))
                })?
            };

            if requested_agent_type.as_str() != current_agent_type.as_str()
                && !(requested_agent_type.is_coding_mode() && current_agent_type.is_coding_mode())
            {
                return Err(CoreError::tool(format!(
                    "SessionMessage only allows agent_type override among BitFun Coder modes. Cannot switch session '{}' from '{}' to '{}'.",
                    target_session_id,
                    current_agent_type.as_str(),
                    requested_agent_type.as_str()
                )));
            }

            requested_agent_type.as_str().to_string()
        } else if persisted_agent_type.is_empty() {
            "Runno".to_string()
        } else {
            persisted_agent_type.to_string()
        };

        handoff_to_agent_session(
            agentic,
            AgentSessionHandoffRequest {
                workspace: workspace.clone(),
                message: params.message.clone(),
                source_session_id,
                source_workspace_path: source_workspace,
                target: AgentSessionHandoffTarget::Existing(ExistingAgentSessionHandoffTarget {
                    session_id: target_session_id.clone(),
                    agent_type: Some(target_agent_type.clone()),
                }),
            },
        )
        .await?;

        Ok(vec![ToolResult::Result {
            data: json!({
                "success": true,
                "target_workspace": workspace.clone(),
                "target_session_id": target_session_id.clone(),
                "target_agent_type": target_agent_type.clone(),
            }),
            result_for_assistant: Some(format!(
                "Message accepted for session '{}' in workspace '{}' using agent type '{}'.",
                target_session_id, workspace, target_agent_type
            )),
            image_attachments: None,
        }])
    }
}
