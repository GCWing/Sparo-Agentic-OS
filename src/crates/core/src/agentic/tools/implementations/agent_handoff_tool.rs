use super::agent_session_handoff::{
    handoff_creator_marker, handoff_source_session_id, handoff_source_workspace,
    handoff_to_agent_session, resolve_handoff_workspace, validate_session_id,
    AgentSessionHandoffKind, AgentSessionHandoffRequest, AgentSessionHandoffTarget,
    ExistingAgentSessionHandoffTarget, STANDARD_AGENT_TYPES,
};
use crate::agentic::tools::framework::{
    Tool, ToolRenderOptions, ToolResult, ToolUseContext, ValidationResult,
};
use crate::agentic::SessionSummary;
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::try_get_path_manager_arc;
use crate::service::workspace::get_global_workspace_service;
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

/// AgentHandoff tool hands work to Standard agent sessions.
///
/// AgentHandoff is the high-level delegation entrypoint for OSAgent-style delegation:
/// - `handoff` creates a child session when `session_id` is omitted
/// - `handoff` reuses an existing session when `session_id` is provided
/// - `list` combines tracked workspace routing candidates with their sessions
/// - `status` is scoped to sessions created by this OSAgent session
pub struct AgentHandoffTool;

impl Default for AgentHandoffTool {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentHandoffTool {
    pub fn new() -> Self {
        Self
    }
}

#[derive(Debug, Deserialize)]
enum AgentHandoffAction {
    #[serde(rename = "handoff", alias = "dispatch")]
    Handoff,
    #[serde(rename = "list")]
    List,
    #[serde(rename = "status")]
    Status,
}

#[derive(Debug, Deserialize)]
struct AgentHandoffInput {
    action: AgentHandoffAction,
    /// Target workspace: absolute path or "global"
    workspace: Option<String>,
    /// Existing session to reuse. Omit to create a new session.
    session_id: Option<String>,
    /// Agent type used when creating a new session.
    agent_type: Option<String>,
    /// Display name used when creating a new session.
    session_name: Option<String>,
    /// Message sent to the target session.
    message: Option<String>,
}

#[async_trait]
impl Tool for AgentHandoffTool {
    fn name(&self) -> &str {
        "AgentHandoff"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Hand work to Standard agent sessions as OSAgent.

Actions:
- "handoff": Send a task to an agent session. If `session_id` is omitted, a new session is created and the message is sent immediately. If `session_id` is provided, that session is reused.
- "list": List tracked workspace routing candidates and their existing sessions, so you can find matching workspace paths and session IDs.
- "status": Show sessions that were created by this OSAgent session.

Parameters for "handoff":
- workspace: Absolute path to the project directory, or "global" for non-project tasks.
- message: Full instructions sent to the target agent. Include all required context because the target session does not see the OSAgent conversation.
- session_id: Optional existing session ID to reuse.
- agent_type: Required only when creating a new session. One of "Runno" (native general execution), "bitfun-coder" (BitFun Coder), "bitfun-plan", "bitfun-debug", "bitfun-team", "Cowork", "Design", or "DeepResearch".
- session_name: Optional display name when creating a new session.

Parameters for "list":
  No additional parameters required.

Parameters for "status":
  No additional parameters required."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["handoff", "list", "status"],
                    "description": "handoff: send work to a new or existing agent session; list: discover workspaces and sessions; status: view OSAgent-created sessions"
                },
                "workspace": {
                    "type": "string",
                    "description": "Absolute path to the workspace directory, or 'global' for non-project tasks. Required for handoff."
                },
                "session_id": {
                    "type": "string",
                    "description": "Existing session ID to reuse. Omit this field to create a new session."
                },
                "agent_type": {
                    "type": "string",
                    "enum": ["Runno", "bitfun-coder", "bitfun-plan", "bitfun-debug", "bitfun-team", "Cowork", "Design", "DeepResearch"],
                    "description": "Type of agent to create. Required only when session_id is omitted."
                },
                "session_name": {
                    "type": "string",
                    "description": "Short display name for a newly created session. Ignored when reusing an existing session."
                },
                "message": {
                    "type": "string",
                    "description": "Full task description sent to the target session. Required for handoff."
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
    ) -> ValidationResult {
        let parsed: AgentHandoffInput = match serde_json::from_value(input.clone()) {
            Ok(value) => value,
            Err(error) => {
                return ValidationResult {
                    result: false,
                    message: Some(format!("Invalid input: {}", error)),
                    error_code: Some(400),
                    meta: None,
                };
            }
        };

        if let AgentHandoffAction::Handoff = parsed.action {
            if parsed.workspace.as_deref().unwrap_or("").trim().is_empty() {
                return ValidationResult {
                    result: false,
                    message: Some("workspace is required for handoff".to_string()),
                    error_code: Some(400),
                    meta: None,
                };
            }

            if parsed.message.as_deref().unwrap_or("").trim().is_empty() {
                return ValidationResult {
                    result: false,
                    message: Some("message is required for handoff".to_string()),
                    error_code: Some(400),
                    meta: None,
                };
            }

            let session_id = parsed
                .session_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());

            if let Some(session_id) = session_id {
                if let Err(message) = validate_session_id(session_id) {
                    return ValidationResult {
                        result: false,
                        message: Some(message),
                        error_code: Some(400),
                        meta: None,
                    };
                }

                if parsed.agent_type.is_some() {
                    return ValidationResult {
                        result: false,
                        message: Some(
                            "agent_type is only allowed when creating a new session".to_string(),
                        ),
                        error_code: Some(400),
                        meta: None,
                    };
                }

                if parsed.session_name.is_some() {
                    return ValidationResult {
                        result: false,
                        message: Some(
                            "session_name is only allowed when creating a new session".to_string(),
                        ),
                        error_code: Some(400),
                        meta: None,
                    };
                }
            } else if let Some(agent_type) = parsed.agent_type.as_deref() {
                if !STANDARD_AGENT_TYPES.contains(&agent_type) {
                    return ValidationResult {
                        result: false,
                        message: Some(format!(
                            "agent_type must be one of: {}",
                            STANDARD_AGENT_TYPES.join(", ")
                        )),
                        error_code: Some(400),
                        meta: None,
                    };
                }
            } else {
                return ValidationResult {
                    result: false,
                    message: Some("agent_type is required when creating a new session".to_string()),
                    error_code: Some(400),
                    meta: None,
                };
            }
        }

        ValidationResult::default()
    }

    fn render_tool_use_message(&self, input: &Value, _options: &ToolRenderOptions) -> String {
        let action = input
            .get("action")
            .and_then(|value| value.as_str())
            .unwrap_or("?");
        match action {
            "handoff" | "dispatch" => {
                if let Some(session_id) = input.get("session_id").and_then(|value| value.as_str()) {
                    format!("Hand off to existing session {}", session_id)
                } else {
                    let agent = input
                        .get("agent_type")
                        .and_then(|value| value.as_str())
                        .unwrap_or("agent");
                    let name = input
                        .get("session_name")
                        .and_then(|value| value.as_str())
                        .unwrap_or("New Session");
                    format!("Hand off to new {} session: {}", agent, name)
                }
            }
            "list" => "List workspaces and sessions".to_string(),
            "status" => "Check agent session status".to_string(),
            _ => format!("Agent handoff: {}", action),
        }
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> CoreResult<Vec<ToolResult>> {
        let params: AgentHandoffInput = serde_json::from_value(input.clone())
            .map_err(|error| CoreError::tool(format!("Invalid input: {}", error)))?;

        match params.action {
            AgentHandoffAction::Handoff => {
                let workspace = resolve_handoff_workspace(
                    params.workspace.as_deref().unwrap_or(""),
                    context,
                    true,
                )
                .await?;
                let message = params
                    .message
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| {
                        CoreError::tool("message is required for handoff".to_string())
                    })?;
                let source_session_id =
                    handoff_source_session_id(context, "AgentHandoff")?.to_string();
                let source_workspace_path = handoff_source_workspace(context, "AgentHandoff")?;
                let session_id = params
                    .session_id
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty());

                let target = if let Some(session_id) = session_id {
                    AgentSessionHandoffTarget::Existing(ExistingAgentSessionHandoffTarget {
                        session_id,
                        agent_type: None,
                    })
                } else {
                    AgentSessionHandoffTarget::New {
                        agent_type: params.agent_type.unwrap_or_else(|| "Runno".to_string()),
                        session_name: params.session_name,
                        created_by: Some(handoff_creator_marker(context, "AgentHandoff")?),
                    }
                };

                let agentic = context
                    .agentic()
                    .ok_or_else(|| CoreError::tool("agentic stack not initialized".to_string()))?;
                let outcome = handoff_to_agent_session(
                    agentic,
                    AgentSessionHandoffRequest {
                        workspace: workspace.clone(),
                        message,
                        source_session_id,
                        source_workspace_path,
                        target,
                    },
                )
                .await?;

                let handoff_kind = match outcome.kind {
                    AgentSessionHandoffKind::Created => "created",
                    AgentSessionHandoffKind::Reused => "reused",
                };
                let result_for_assistant = match outcome.kind {
                    AgentSessionHandoffKind::Created => format!(
                        "Created {} session '{}' (id: {}) in workspace '{}' and handed off the task.",
                        outcome.agent_type, outcome.session_name, outcome.session_id, outcome.workspace
                    ),
                    AgentSessionHandoffKind::Reused => format!(
                        "Reused session '{}' (id: {}) in workspace '{}' and handed off the task.",
                        outcome.session_name, outcome.session_id, outcome.workspace
                    ),
                };

                Ok(vec![ToolResult::Result {
                    data: json!({
                        "action": "handoff",
                        "success": true,
                        "handoff_kind": handoff_kind,
                        "session_id": outcome.session_id,
                        "session_name": outcome.session_name,
                        "agent_type": outcome.agent_type,
                        "workspace": outcome.workspace,
                    }),
                    result_for_assistant: Some(result_for_assistant),
                    image_attachments: None,
                }])
            }

            AgentHandoffAction::List => {
                let coordinator = context
                    .agentic()
                    .map(|h| h.coordinator.clone())
                    .ok_or_else(|| CoreError::tool("coordinator not initialized".to_string()))?;
                let mut workspace_entries: Vec<Value> = Vec::new();

                if let Ok(path_manager) = try_get_path_manager_arc() {
                    let workspace_path = path_manager
                        .agentic_os_runtime_root()
                        .to_string_lossy()
                        .into_owned();
                    let sessions: Vec<SessionSummary> = coordinator
                        .list_sessions(&crate::agentic::core::SessionDomain::OsAgent)
                        .await
                        .unwrap_or_default();
                    workspace_entries.push(json!({
                        "name": "Agentic OS",
                        "path": workspace_path,
                        "kind": "global",
                        "session_count": sessions.len(),
                        "sessions": sessions.iter().map(|session| json!({
                            "session_id": session.session_id,
                            "session_name": session.session_name,
                            "agent_type": session.agent_type,
                            "created_at": session.created_at,
                            "last_activity_at": session.last_activity_at,
                        })).collect::<Vec<_>>(),
                    }));
                }

                if let Some(ws_service) = get_global_workspace_service() {
                    let candidates = ws_service.list_workspace_routing_candidates().await;
                    for workspace_info in candidates {
                        let workspace_path =
                            workspace_info.root_path.to_string_lossy().into_owned();
                        let sessions: Vec<SessionSummary> = coordinator
                            .list_sessions(&crate::agentic::core::SessionDomain::Workspace {
                                workspace_id: workspace_info.id.clone(),
                            })
                            .await
                            .unwrap_or_default();

                        workspace_entries.push(json!({
                            "name": workspace_info.name,
                            "path": workspace_path,
                            "kind": "project",
                            "last_accessed": workspace_info.last_accessed.to_rfc3339(),
                            "session_count": sessions.len(),
                            "sessions": sessions.iter().map(|session| json!({
                                "session_id": session.session_id,
                                "session_name": session.session_name,
                                "agent_type": session.agent_type,
                                "created_at": session.created_at,
                                "last_activity_at": session.last_activity_at,
                            })).collect::<Vec<_>>(),
                        }));
                    }
                }

                let total_sessions: usize = workspace_entries
                    .iter()
                    .filter_map(|entry| entry["session_count"].as_u64())
                    .map(|count| count as usize)
                    .sum();

                let mut text_lines = vec![format!(
                    "Found {} workspace(s) with {} total session(s):",
                    workspace_entries.len(),
                    total_sessions
                )];
                for entry in &workspace_entries {
                    let name = entry["name"].as_str().unwrap_or("?");
                    let path = entry["path"].as_str().unwrap_or("?");
                    let kind = entry["kind"].as_str().unwrap_or("project");
                    let count = entry["session_count"].as_u64().unwrap_or(0);
                    text_lines.push(format!(
                        "  - [{}] {} ({}): {} session(s)",
                        kind, name, path, count
                    ));
                }

                Ok(vec![ToolResult::Result {
                    data: json!({
                        "action": "list",
                        "workspace_count": workspace_entries.len(),
                        "workspaces": workspace_entries,
                    }),
                    result_for_assistant: Some(text_lines.join("\n")),
                    image_attachments: None,
                }])
            }

            AgentHandoffAction::Status => {
                let coordinator = context
                    .agentic()
                    .map(|h| h.coordinator.clone())
                    .ok_or_else(|| CoreError::tool("coordinator not initialized".to_string()))?;
                let creator_marker = handoff_creator_marker(context, "AgentHandoff")?;
                let legacy_creator_marker = handoff_creator_marker(context, "AgentDispatch").ok();
                let workspace_path = context.workspace_root();
                let belongs_to_this_os_agent = |session: &SessionSummary| {
                    let created_by = session.created_by.as_deref();
                    created_by == Some(creator_marker.as_str())
                        || legacy_creator_marker
                            .as_deref()
                            .is_some_and(|marker| created_by == Some(marker))
                };

                let all_sessions: Vec<SessionSummary> = if let Some(path) = workspace_path {
                    let workspace_id = try_get_path_manager_arc()?.workspace_id(path)?;
                    coordinator
                        .list_sessions(&crate::agentic::core::SessionDomain::Workspace {
                            workspace_id,
                        })
                        .await?
                } else {
                    Vec::new()
                };

                let mut os_agent_sessions: Vec<Value> = Vec::new();

                if let Ok(path_manager) = try_get_path_manager_arc() {
                    let global_path = path_manager.agentic_os_runtime_root();
                    {
                        let sessions = coordinator
                            .list_sessions(&crate::agentic::core::SessionDomain::OsAgent)
                            .await
                            .unwrap_or_default();
                        for session in sessions {
                            if belongs_to_this_os_agent(&session) {
                                os_agent_sessions.push(json!({
                                    "session_id": session.session_id,
                                    "session_name": session.session_name,
                                    "agent_type": session.agent_type,
                                    "workspace": global_path.to_string_lossy(),
                                    "workspace_kind": "global",
                                    "created_at": session.created_at,
                                    "last_activity_at": session.last_activity_at,
                                }));
                            }
                        }
                    }
                }

                if let Some(ws_service) = get_global_workspace_service() {
                    let candidates = ws_service.list_workspace_routing_candidates().await;
                    for workspace_info in candidates {
                        let path = workspace_info.root_path.as_path();
                        if !path.exists() {
                            continue;
                        }
                        let sessions = coordinator
                            .list_sessions(&crate::agentic::core::SessionDomain::Workspace {
                                workspace_id: workspace_info.id.clone(),
                            })
                            .await
                            .unwrap_or_default();
                        for session in sessions {
                            if belongs_to_this_os_agent(&session) {
                                os_agent_sessions.push(json!({
                                    "session_id": session.session_id,
                                    "session_name": session.session_name,
                                    "agent_type": session.agent_type,
                                    "workspace": workspace_info.root_path.to_string_lossy(),
                                    "workspace_kind": "project",
                                    "created_at": session.created_at,
                                    "last_activity_at": session.last_activity_at,
                                }));
                            }
                        }
                    }
                }

                for session in &all_sessions {
                    let already_included = os_agent_sessions
                        .iter()
                        .any(|entry| entry["session_id"].as_str() == Some(&session.session_id));
                    if !already_included && belongs_to_this_os_agent(session) {
                        let workspace = workspace_path
                            .map(|path| path.to_string_lossy().into_owned())
                            .unwrap_or_default();
                        os_agent_sessions.push(json!({
                            "session_id": session.session_id,
                            "session_name": session.session_name,
                            "agent_type": session.agent_type,
                            "workspace": workspace,
                            "created_at": session.created_at,
                            "last_activity_at": session.last_activity_at,
                        }));
                    }
                }

                let sessions_table = {
                    let lines = if os_agent_sessions.is_empty() {
                        vec!["No sessions created by this OSAgent yet.".to_string()]
                    } else {
                        let mut lines = vec![
                            "| session_id | session_name | agent_type | workspace |".to_string(),
                            "| --- | --- | --- | --- |".to_string(),
                        ];
                        for session in &os_agent_sessions {
                            lines.push(format!(
                                "| {} | {} | {} | {} |",
                                session["session_id"].as_str().unwrap_or(""),
                                session["session_name"].as_str().unwrap_or(""),
                                session["agent_type"].as_str().unwrap_or(""),
                                session["workspace"].as_str().unwrap_or(""),
                            ));
                        }
                        lines
                    };
                    lines.join("\n")
                };

                Ok(vec![ToolResult::Result {
                    data: json!({
                        "action": "status",
                        "os_agent_session_count": os_agent_sessions.len(),
                        "sessions": os_agent_sessions,
                    }),
                    result_for_assistant: Some(format!(
                        "OSAgent has created {} session(s):\n{}",
                        os_agent_sessions.len(),
                        sessions_table
                    )),
                    image_attachments: None,
                }])
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn handoff_requires_agent_type_when_creating() {
        let tool = AgentHandoffTool::new();
        let result = tool
            .validate_input(
                &json!({
                    "action": "handoff",
                    "workspace": "/tmp/project",
                    "message": "Investigate the failure"
                }),
                None,
            )
            .await;

        assert!(!result.result);
        assert_eq!(
            result.message.as_deref(),
            Some("agent_type is required when creating a new session")
        );
    }

    #[tokio::test]
    async fn handoff_rejects_agent_type_when_reusing() {
        let tool = AgentHandoffTool::new();
        let result = tool
            .validate_input(
                &json!({
                    "action": "handoff",
                    "workspace": "/tmp/project",
                    "session_id": "session_123",
                    "agent_type": "Runno",
                    "message": "Continue the task"
                }),
                None,
            )
            .await;

        assert!(!result.result);
        assert_eq!(
            result.message.as_deref(),
            Some("agent_type is only allowed when creating a new session")
        );
    }
}
