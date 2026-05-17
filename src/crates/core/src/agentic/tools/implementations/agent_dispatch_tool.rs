use super::agent_session_dispatch::{
    dispatch_creator_marker, dispatch_source_session_id, dispatch_source_workspace,
    dispatch_to_agent_session, resolve_dispatch_workspace, validate_session_id,
    AgentSessionDispatchKind, AgentSessionDispatchRequest, AgentSessionDispatchTarget,
    ExistingAgentSessionDispatchTarget, STANDARD_AGENT_TYPES,
};
use crate::agentic::tools::framework::{
    Tool, ToolRenderOptions, ToolResult, ToolUseContext, ValidationResult,
};
use crate::agentic::SessionSummary;
use crate::infrastructure::try_get_path_manager_arc;
use crate::service::workspace::get_global_workspace_service;
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

/// AgentDispatch tool ??dispatches work to Standard agent sessions.
///
/// AgentDispatch is the high-level delegation entrypoint for Dispatcher-style agents:
/// - `dispatch` creates a child session when `session_id` is omitted
/// - `dispatch` reuses an existing session when `session_id` is provided
/// - `list` combines tracked workspace routing candidates with their sessions
/// - `status` is scoped to sessions created by this Dispatcher
pub struct AgentDispatchTool;

impl Default for AgentDispatchTool {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentDispatchTool {
    pub fn new() -> Self {
        Self
    }
}

#[derive(Debug, Deserialize)]
enum AgentDispatchAction {
    #[serde(rename = "dispatch")]
    Dispatch,
    #[serde(rename = "list")]
    List,
    #[serde(rename = "status")]
    Status,
}

#[derive(Debug, Deserialize)]
struct AgentDispatchInput {
    action: AgentDispatchAction,
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
impl Tool for AgentDispatchTool {
    fn name(&self) -> &str {
        "AgentDispatch"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok(r#"Dispatch work to Standard agent sessions as the Dispatcher.

Actions:
- "dispatch": Send a task to an agent session. If `session_id` is omitted, a new session is created and the message is sent immediately. If `session_id` is provided, that session is reused.
- "list": List tracked workspace routing candidates and their existing sessions, so you can find matching workspace paths and session IDs.
- "status": Show sessions that were created by this Dispatcher session.

Parameters for "dispatch":
- workspace: Absolute path to the project directory, or "global" for non-project tasks.
- message: Full instructions sent to the target agent. Include all required context because the target session does not see the Dispatcher conversation.
- session_id: Optional existing session ID to reuse.
- agent_type: Required only when creating a new session. One of "agentic" (coding), "Plan" (planning), "Cowork" (collaboration), "Design" (design work), or "debug" (debugging).
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
                    "enum": ["dispatch", "list", "status"],
                    "description": "dispatch: send work to a new or existing agent session; list: discover workspaces and sessions; status: view Dispatcher-created sessions"
                },
                "workspace": {
                    "type": "string",
                    "description": "Absolute path to the workspace directory, or 'global' for non-project tasks. Required for dispatch."
                },
                "session_id": {
                    "type": "string",
                    "description": "Existing session ID to reuse. Omit this field to create a new session."
                },
                "agent_type": {
                    "type": "string",
                    "enum": ["agentic", "Plan", "Cowork", "Design", "debug"],
                    "description": "Type of agent to create. Required only when session_id is omitted."
                },
                "session_name": {
                    "type": "string",
                    "description": "Short display name for a newly created session. Ignored when reusing an existing session."
                },
                "message": {
                    "type": "string",
                    "description": "Full task description sent to the target session. Required for dispatch."
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
        let parsed: AgentDispatchInput = match serde_json::from_value(input.clone()) {
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

        if let AgentDispatchAction::Dispatch = parsed.action {
            if parsed.workspace.as_deref().unwrap_or("").trim().is_empty() {
                return ValidationResult {
                    result: false,
                    message: Some("workspace is required for dispatch".to_string()),
                    error_code: Some(400),
                    meta: None,
                };
            }

            if parsed.message.as_deref().unwrap_or("").trim().is_empty() {
                return ValidationResult {
                    result: false,
                    message: Some("message is required for dispatch".to_string()),
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
            "dispatch" => {
                if let Some(session_id) = input.get("session_id").and_then(|value| value.as_str()) {
                    format!("Dispatch to existing session {}", session_id)
                } else {
                    let agent = input
                        .get("agent_type")
                        .and_then(|value| value.as_str())
                        .unwrap_or("agent");
                    let name = input
                        .get("session_name")
                        .and_then(|value| value.as_str())
                        .unwrap_or("New Session");
                    format!("Dispatch to new {} session: {}", agent, name)
                }
            }
            "list" => "List workspaces and sessions".to_string(),
            "status" => "Check agent session status".to_string(),
            _ => format!("Agent dispatch: {}", action),
        }
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let params: AgentDispatchInput = serde_json::from_value(input.clone())
            .map_err(|error| BitFunError::tool(format!("Invalid input: {}", error)))?;

        match params.action {
            AgentDispatchAction::Dispatch => {
                let workspace = resolve_dispatch_workspace(
                    params.workspace.as_deref().unwrap_or(""),
                    context,
                    true,
                )
                .await?;
                let message = params
                    .message
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| {
                        BitFunError::tool("message is required for dispatch".to_string())
                    })?;
                let source_session_id =
                    dispatch_source_session_id(context, "AgentDispatch")?.to_string();
                let source_workspace_path = dispatch_source_workspace(context, "AgentDispatch")?;
                let session_id = params
                    .session_id
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty());

                let target = if let Some(session_id) = session_id {
                    AgentSessionDispatchTarget::Existing(ExistingAgentSessionDispatchTarget {
                        session_id,
                        agent_type: None,
                    })
                } else {
                    AgentSessionDispatchTarget::New {
                        agent_type: params.agent_type.unwrap_or_else(|| "agentic".to_string()),
                        session_name: params.session_name,
                        created_by: Some(dispatch_creator_marker(context, "AgentDispatch")?),
                    }
                };

                let agentic = context
                    .agentic()
                    .ok_or_else(|| BitFunError::tool("agentic stack not initialized".to_string()))?;
                let outcome = dispatch_to_agent_session(agentic, AgentSessionDispatchRequest {
                    workspace: workspace.clone(),
                    message,
                    source_session_id,
                    source_workspace_path,
                    target,
                })
                .await?;

                let dispatch_kind = match outcome.kind {
                    AgentSessionDispatchKind::Created => "created",
                    AgentSessionDispatchKind::Reused => "reused",
                };
                let result_for_assistant = match outcome.kind {
                    AgentSessionDispatchKind::Created => format!(
                        "Created {} session '{}' (id: {}) in workspace '{}' and dispatched the task.",
                        outcome.agent_type, outcome.session_name, outcome.session_id, outcome.workspace
                    ),
                    AgentSessionDispatchKind::Reused => format!(
                        "Reused session '{}' (id: {}) in workspace '{}' and dispatched the task.",
                        outcome.session_name, outcome.session_id, outcome.workspace
                    ),
                };

                Ok(vec![ToolResult::Result {
                    data: json!({
                        "action": "dispatch",
                        "success": true,
                        "dispatch_kind": dispatch_kind,
                        "session_id": outcome.session_id,
                        "session_name": outcome.session_name,
                        "agent_type": outcome.agent_type,
                        "workspace": outcome.workspace,
                    }),
                    result_for_assistant: Some(result_for_assistant),
                    image_attachments: None,
                }])
            }

            AgentDispatchAction::List => {
                let coordinator = context.agentic().map(|h| h.coordinator.clone()).ok_or_else(|| BitFunError::tool("coordinator not initialized".to_string()))?;
                let mut workspace_entries: Vec<Value> = Vec::new();

                if let Ok(path_manager) = try_get_path_manager_arc() {
                    let workspace_path = path_manager
                        .agentic_os_runtime_root()
                        .to_string_lossy()
                        .into_owned();
                    let path = Path::new(&workspace_path);
                    let sessions: Vec<SessionSummary> = if path.exists() {
                        coordinator.list_sessions(path).await.unwrap_or_default()
                    } else {
                        Vec::new()
                    };
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
                        let path = Path::new(&workspace_path);

                        let sessions: Vec<SessionSummary> = if path.exists() {
                            coordinator.list_sessions(path).await.unwrap_or_default()
                        } else {
                            Vec::new()
                        };

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

            AgentDispatchAction::Status => {
                let coordinator = context.agentic().map(|h| h.coordinator.clone()).ok_or_else(|| BitFunError::tool("coordinator not initialized".to_string()))?;
                let creator_marker = dispatch_creator_marker(context, "AgentDispatch")?;
                let workspace_path = context.workspace_root();

                let all_sessions: Vec<SessionSummary> = if let Some(path) = workspace_path {
                    coordinator.list_sessions(path).await.unwrap_or_default()
                } else {
                    Vec::new()
                };

                let mut dispatcher_sessions: Vec<Value> = Vec::new();

                if let Ok(path_manager) = try_get_path_manager_arc() {
                    let global_path = path_manager.agentic_os_runtime_root();
                    if global_path.exists() {
                        let sessions = coordinator
                            .list_sessions(global_path.as_path())
                            .await
                            .unwrap_or_default();
                        for session in sessions {
                            if session.created_by.as_deref() == Some(&creator_marker) {
                                dispatcher_sessions.push(json!({
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
                        let sessions = coordinator.list_sessions(path).await.unwrap_or_default();
                        for session in sessions {
                            if session.created_by.as_deref() == Some(&creator_marker) {
                                dispatcher_sessions.push(json!({
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
                    let already_included = dispatcher_sessions
                        .iter()
                        .any(|entry| entry["session_id"].as_str() == Some(&session.session_id));
                    if !already_included && session.created_by.as_deref() == Some(&creator_marker) {
                        let workspace = workspace_path
                            .map(|path| path.to_string_lossy().into_owned())
                            .unwrap_or_default();
                        dispatcher_sessions.push(json!({
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
                    let lines = if dispatcher_sessions.is_empty() {
                        vec!["No sessions created by this Dispatcher yet.".to_string()]
                    } else {
                        let mut lines = vec![
                            "| session_id | session_name | agent_type | workspace |".to_string(),
                            "| --- | --- | --- | --- |".to_string(),
                        ];
                        for session in &dispatcher_sessions {
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
                        "dispatcher_session_count": dispatcher_sessions.len(),
                        "sessions": dispatcher_sessions,
                    }),
                    result_for_assistant: Some(format!(
                        "Dispatcher has created {} session(s):\n{}",
                        dispatcher_sessions.len(),
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
    async fn dispatch_requires_agent_type_when_creating() {
        let tool = AgentDispatchTool::new();
        let result = tool
            .validate_input(
                &json!({
                    "action": "dispatch",
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
    async fn dispatch_rejects_agent_type_when_reusing() {
        let tool = AgentDispatchTool::new();
        let result = tool
            .validate_input(
                &json!({
                    "action": "dispatch",
                    "workspace": "/tmp/project",
                    "session_id": "session_123",
                    "agent_type": "agentic",
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
