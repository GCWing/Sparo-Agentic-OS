use super::util::normalize_path;
use crate::agentic::coordination::{
    AgentSessionReplyRoute, DialogSubmissionPolicy, DialogTriggerSource,
};
use crate::agentic::core::{PromptEnvelope, SessionConfig, SessionDomain};
use crate::agentic::tools::framework::ToolUseContext;
use crate::agentic::tools::workspace_paths::posix_style_path_is_absolute;
use crate::agentic::SessionSummary;
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::try_get_path_manager_arc;
use std::path::Path;

pub const STANDARD_AGENT_TYPES: &[&str] = &[
    "Runno",
    "bitfun-coder",
    "bitfun-plan",
    "bitfun-debug",
    "bitfun-team",
    "Cowork",
    "Design",
    "DeepResearch",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentSessionHandoffKind {
    Created,
    Reused,
}

#[derive(Debug, Clone)]
pub struct ExistingAgentSessionHandoffTarget {
    pub session_id: String,
    pub agent_type: Option<String>,
}

#[derive(Debug, Clone)]
pub enum AgentSessionHandoffTarget {
    New {
        agent_type: String,
        session_name: Option<String>,
        created_by: Option<String>,
    },
    Existing(ExistingAgentSessionHandoffTarget),
}

#[derive(Debug, Clone)]
pub struct AgentSessionHandoffRequest {
    pub workspace: String,
    pub message: String,
    pub source_session_id: String,
    pub source_workspace_path: String,
    pub target: AgentSessionHandoffTarget,
}

#[derive(Debug, Clone)]
pub struct AgentSessionHandoffOutcome {
    pub kind: AgentSessionHandoffKind,
    pub workspace: String,
    pub session_id: String,
    pub session_name: String,
    pub agent_type: String,
}

pub async fn get_global_workspace_path() -> String {
    if let Ok(path_manager) = try_get_path_manager_arc() {
        return path_manager
            .agentic_os_runtime_root()
            .to_string_lossy()
            .into_owned();
    }

    dirs::home_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "/".to_string())
}

pub async fn resolve_handoff_workspace(
    workspace: &str,
    context: &ToolUseContext,
    allow_global: bool,
) -> CoreResult<String> {
    let workspace = workspace.trim();
    if workspace.is_empty() {
        return Err(CoreError::tool("workspace cannot be empty".to_string()));
    }

    if allow_global && workspace == "global" {
        return Ok(get_global_workspace_path().await);
    }

    if context.is_remote() {
        if !posix_style_path_is_absolute(workspace) {
            return Err(CoreError::tool(
                "workspace must be an absolute POSIX path on the remote host".to_string(),
            ));
        }
        return context.resolve_workspace_tool_path(workspace);
    }

    let path = Path::new(workspace);
    if !path.is_absolute() {
        let message = if allow_global {
            "workspace must be an absolute path or the keyword 'global'"
        } else {
            "workspace must be an absolute path"
        };
        return Err(CoreError::tool(message.to_string()));
    }

    let resolved = normalize_path(workspace);
    let path = Path::new(&resolved);
    if !path.exists() {
        return Err(CoreError::tool(format!(
            "workspace does not exist: {}",
            resolved
        )));
    }
    if !path.is_dir() {
        return Err(CoreError::tool(format!(
            "workspace is not a directory: {}",
            resolved
        )));
    }

    Ok(resolved)
}

pub fn validate_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty() {
        return Err("session_id cannot be empty".to_string());
    }
    if session_id == "." || session_id == ".." {
        return Err("session_id cannot be '.' or '..'".to_string());
    }
    if session_id.contains('/') || session_id.contains('\\') {
        return Err("session_id cannot contain path separators".to_string());
    }
    if !session_id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("session_id can only contain ASCII letters, numbers, '-' and '_'".to_string());
    }

    Ok(())
}

pub fn handoff_creator_marker(context: &ToolUseContext, tool_name: &str) -> CoreResult<String> {
    let session_id = context
        .session_id
        .as_ref()
        .ok_or_else(|| CoreError::tool(format!("{} requires a session context", tool_name)))?;
    Ok(format!("session-{}", session_id))
}

pub fn handoff_source_session_id<'a>(
    context: &'a ToolUseContext,
    tool_name: &str,
) -> CoreResult<&'a str> {
    context
        .session_id
        .as_deref()
        .ok_or_else(|| CoreError::tool(format!("{} requires a source session", tool_name)))
}

pub fn handoff_source_workspace(context: &ToolUseContext, tool_name: &str) -> CoreResult<String> {
    context
        .workspace_root()
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| CoreError::tool(format!("{} requires a source workspace", tool_name)))
}

pub fn format_forwarded_agent_message(message: &str) -> String {
    let mut envelope = PromptEnvelope::new();
    envelope.push_system_reminder(
        "This request was sent by another agent, not human user. Do not use interactive tools for this request. In particular, do not call AskUserQuestion."
            .to_string(),
    );
    envelope.push_user_query(message.to_string());
    envelope.render()
}

pub async fn find_existing_session(
    coordinator: &std::sync::Arc<crate::agentic::coordination::ConversationCoordinator>,
    workspace: &str,
    session_id: &str,
) -> CoreResult<SessionSummary> {
    validate_session_id(session_id).map_err(CoreError::tool)?;

    let domain = SessionDomain::Workspace {
        workspace_id: try_get_path_manager_arc()?.workspace_id(Path::new(workspace))?,
    };
    let sessions = coordinator.list_sessions(&domain).await?;

    sessions
        .into_iter()
        .find(|session| session.session_id == session_id)
        .ok_or_else(|| {
            CoreError::NotFound(format!(
                "Session '{}' not found in workspace '{}'",
                session_id, workspace
            ))
        })
}

pub async fn handoff_to_agent_session(
    agentic: &crate::runtime::AgenticHandles,
    request: AgentSessionHandoffRequest,
) -> CoreResult<AgentSessionHandoffOutcome> {
    if request.message.trim().is_empty() {
        return Err(CoreError::tool("message cannot be empty".to_string()));
    }

    let coordinator = agentic.coordinator.clone();
    let scheduler = agentic.scheduler.clone();

    let (kind, session_id, session_name, agent_type) = match request.target {
        AgentSessionHandoffTarget::New {
            agent_type,
            session_name,
            created_by,
        } => {
            let session_name = session_name
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| format!("{} session", agent_type));
            let session = coordinator
                .create_session_with_workspace_and_creator(
                    None,
                    session_name.clone(),
                    agent_type.clone(),
                    SessionConfig {
                        workspace_path: Some(request.workspace.clone()),
                        ..SessionConfig::new(SessionDomain::Workspace {
                            workspace_id: try_get_path_manager_arc()?
                                .workspace_id(Path::new(&request.workspace))?,
                        })
                    },
                    request.workspace.clone(),
                    created_by,
                )
                .await?;

            (
                AgentSessionHandoffKind::Created,
                session.session_id,
                session.session_name,
                session.agent_type,
            )
        }
        AgentSessionHandoffTarget::Existing(existing) => {
            let session =
                find_existing_session(&coordinator, &request.workspace, &existing.session_id)
                    .await?;
            let agent_type = existing.agent_type.unwrap_or_else(|| {
                let persisted_agent_type = session.agent_type.trim();
                if persisted_agent_type.is_empty() {
                    "Runno".to_string()
                } else {
                    persisted_agent_type.to_string()
                }
            });

            (
                AgentSessionHandoffKind::Reused,
                session.session_id,
                session.session_name,
                agent_type,
            )
        }
    };

    scheduler
        .submit(
            session_id.clone(),
            format_forwarded_agent_message(&request.message),
            Some(request.message),
            None,
            agent_type.clone(),
            None,
            Some(request.workspace.clone()),
            DialogSubmissionPolicy::for_source(DialogTriggerSource::AgentSession),
            Some(AgentSessionReplyRoute {
                source_session_id: request.source_session_id,
                source_workspace_path: request.source_workspace_path,
            }),
            None,
        )
        .await
        .map_err(CoreError::tool)?;

    Ok(AgentSessionHandoffOutcome {
        kind,
        workspace: request.workspace,
        session_id,
        session_name,
        agent_type,
    })
}
