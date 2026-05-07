use super::util::normalize_path;
use crate::agentic::coordination::{
    get_global_coordinator, get_global_scheduler, AgentSessionReplyRoute, DialogSubmissionPolicy,
    DialogTriggerSource,
};
use crate::agentic::core::{PromptEnvelope, SessionConfig};
use crate::agentic::persistence::PersistenceManager;
use crate::agentic::tools::framework::ToolUseContext;
use crate::agentic::tools::workspace_paths::posix_style_path_is_absolute;
use crate::agentic::SessionSummary;
use crate::infrastructure::try_get_path_manager_arc;
use crate::service::session::{SessionMetadata, StoredSessionMetadataFile};
use crate::service::workspace::get_global_workspace_service;
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, OnceLock};
use tokio::fs;

pub const STANDARD_AGENT_TYPES: &[&str] = &["agentic", "Plan", "Cowork", "Design", "debug"];
pub const ACP_AGENT_TYPE_PREFIX: &str = "acp:";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentSessionDispatchKind {
    Created,
    Reused,
}

#[derive(Debug, Clone)]
pub struct ExistingAgentSessionDispatchTarget {
    pub session_id: String,
    pub agent_type: Option<String>,
}

#[derive(Debug, Clone)]
pub enum AgentSessionDispatchTarget {
    New {
        agent_type: String,
        session_name: Option<String>,
        created_by: Option<String>,
    },
    Existing(ExistingAgentSessionDispatchTarget),
}

#[derive(Debug, Clone)]
pub struct AgentSessionDispatchRequest {
    pub workspace: String,
    pub message: String,
    pub source_session_id: String,
    pub source_workspace_path: String,
    pub source_dialog_turn_id: Option<String>,
    pub source_tool_call_id: Option<String>,
    pub target: AgentSessionDispatchTarget,
}

#[derive(Debug, Clone)]
pub struct AgentSessionDispatchOutcome {
    pub kind: AgentSessionDispatchKind,
    pub workspace: String,
    pub session_id: String,
    pub session_name: String,
    pub agent_type: String,
}

#[derive(Debug, Clone)]
pub struct ExternalSessionWorkspace {
    pub path: String,
    pub kind: String,
}

#[derive(Debug, Clone)]
pub struct ExternalDispatcherSession {
    pub session_id: String,
    pub session_name: String,
    pub agent_type: String,
    pub workspace: String,
    pub workspace_kind: String,
}

#[async_trait]
pub trait ExternalAgentSessionDispatcher: Send + Sync {
    async fn dispatch(
        &self,
        request: AgentSessionDispatchRequest,
    ) -> BitFunResult<Option<AgentSessionDispatchOutcome>>;

    async fn list_sessions_created_by(
        &self,
        creator_marker: &str,
        workspaces: &[ExternalSessionWorkspace],
    ) -> BitFunResult<Vec<ExternalDispatcherSession>>;
}

static GLOBAL_EXTERNAL_AGENT_SESSION_DISPATCHER: OnceLock<Arc<dyn ExternalAgentSessionDispatcher>> =
    OnceLock::new();

pub fn set_global_external_agent_session_dispatcher(
    dispatcher: Arc<dyn ExternalAgentSessionDispatcher>,
) {
    let _ = GLOBAL_EXTERNAL_AGENT_SESSION_DISPATCHER.set(dispatcher);
}

pub fn get_global_external_agent_session_dispatcher(
) -> Option<Arc<dyn ExternalAgentSessionDispatcher>> {
    GLOBAL_EXTERNAL_AGENT_SESSION_DISPATCHER.get().cloned()
}

pub fn is_external_agent_type(agent_type: &str) -> bool {
    agent_type.trim().starts_with(ACP_AGENT_TYPE_PREFIX)
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

pub async fn resolve_dispatch_workspace(
    workspace: &str,
    context: &ToolUseContext,
    allow_global: bool,
) -> BitFunResult<String> {
    let workspace = workspace.trim();
    if workspace.is_empty() {
        return Err(BitFunError::tool("workspace cannot be empty".to_string()));
    }

    if allow_global && workspace == "global" {
        return Ok(get_global_workspace_path().await);
    }

    if context.is_remote() {
        if !posix_style_path_is_absolute(workspace) {
            return Err(BitFunError::tool(
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
        return Err(BitFunError::tool(message.to_string()));
    }

    let resolved = normalize_path(workspace);
    let path = Path::new(&resolved);
    if !path.exists() {
        return Err(BitFunError::tool(format!(
            "workspace does not exist: {}",
            resolved
        )));
    }
    if !path.is_dir() {
        return Err(BitFunError::tool(format!(
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

pub fn dispatch_creator_marker(context: &ToolUseContext, tool_name: &str) -> BitFunResult<String> {
    let session_id = context
        .session_id
        .as_ref()
        .ok_or_else(|| BitFunError::tool(format!("{} requires a session context", tool_name)))?;
    Ok(format!("session-{}", session_id))
}

pub fn dispatch_source_session_id<'a>(
    context: &'a ToolUseContext,
    tool_name: &str,
) -> BitFunResult<&'a str> {
    context
        .session_id
        .as_deref()
        .ok_or_else(|| BitFunError::tool(format!("{} requires a source session", tool_name)))
}

pub fn dispatch_source_workspace(
    context: &ToolUseContext,
    tool_name: &str,
) -> BitFunResult<String> {
    context
        .workspace_root()
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| BitFunError::tool(format!("{} requires a source workspace", tool_name)))
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

#[derive(Debug, Clone)]
struct ResolvedExistingDispatchSession {
    workspace: String,
    metadata: SessionMetadata,
}

async fn collect_known_dispatch_workspaces(preferred_workspace: Option<&str>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut workspaces = Vec::new();

    let mut push_workspace = |workspace: String| {
        let trimmed = workspace.trim();
        if trimmed.is_empty() {
            return;
        }
        let owned = trimmed.to_string();
        if seen.insert(owned.clone()) {
            workspaces.push(owned);
        }
    };

    if let Some(workspace) = preferred_workspace {
        push_workspace(workspace.to_string());
    }

    if let Ok(path_manager) = try_get_path_manager_arc() {
        push_workspace(
            path_manager
                .agentic_os_runtime_root()
                .to_string_lossy()
                .into_owned(),
        );
    }

    if let Some(workspace_service) = get_global_workspace_service() {
        for workspace_info in workspace_service.list_workspace_routing_candidates().await {
            push_workspace(workspace_info.root_path.to_string_lossy().into_owned());
        }
    }

    workspaces
}

async fn resolve_existing_dispatch_session(
    preferred_workspace: Option<&str>,
    session_id: &str,
) -> BitFunResult<ResolvedExistingDispatchSession> {
    validate_session_id(session_id).map_err(BitFunError::tool)?;

    let path_manager = try_get_path_manager_arc()
        .map_err(|error| BitFunError::tool(format!("path manager unavailable: {}", error)))?;
    let persistence_manager = PersistenceManager::new(path_manager)
        .map_err(|error| BitFunError::tool(format!("persistence unavailable: {}", error)))?;

    for workspace in collect_known_dispatch_workspaces(preferred_workspace).await {
        let workspace_path = Path::new(&workspace);
        let metadata = persistence_manager
            .load_session_metadata(workspace_path, session_id)
            .await?;
        if let Some(metadata) = metadata {
            return Ok(ResolvedExistingDispatchSession {
                workspace,
                metadata,
            });
        }
    }

    if let Some(resolved) =
        find_persisted_dispatch_session(&persistence_manager, session_id).await?
    {
        return Ok(resolved);
    }

    Err(BitFunError::NotFound(format!(
        "Session '{}' not found in known or persisted workspaces",
        session_id
    )))
}

async fn find_persisted_dispatch_session(
    persistence_manager: &PersistenceManager,
    session_id: &str,
) -> BitFunResult<Option<ResolvedExistingDispatchSession>> {
    let path_manager = try_get_path_manager_arc()
        .map_err(|error| BitFunError::tool(format!("path manager unavailable: {}", error)))?;

    if let Some(resolved) = scan_project_runtime_sessions(
        persistence_manager,
        &path_manager.projects_root(),
        session_id,
    )
    .await?
    {
        return Ok(Some(resolved));
    }

    scan_remote_runtime_sessions(
        persistence_manager,
        &crate::infrastructure::app_paths::PathManager::remote_ssh_mirror_root(),
        session_id,
    )
    .await
}

async fn scan_project_runtime_sessions(
    persistence_manager: &PersistenceManager,
    projects_root: &Path,
    session_id: &str,
) -> BitFunResult<Option<ResolvedExistingDispatchSession>> {
    let mut entries = match fs::read_dir(projects_root).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(BitFunError::tool(format!(
                "failed to inspect projects root '{}': {}",
                projects_root.display(),
                error
            )));
        }
    };

    while let Some(entry) = entries.next_entry().await.map_err(|error| {
        BitFunError::tool(format!(
            "failed to enumerate projects root '{}': {}",
            projects_root.display(),
            error
        ))
    })? {
        let file_type = entry.file_type().await.map_err(|error| {
            BitFunError::tool(format!(
                "failed to inspect project runtime '{}': {}",
                entry.path().display(),
                error
            ))
        })?;
        if !file_type.is_dir() {
            continue;
        }

        if let Some(resolved) =
            load_persisted_dispatch_session(persistence_manager, &entry.path(), session_id).await?
        {
            return Ok(Some(resolved));
        }
    }

    Ok(None)
}

async fn scan_remote_runtime_sessions(
    persistence_manager: &PersistenceManager,
    remote_root: &Path,
    session_id: &str,
) -> BitFunResult<Option<ResolvedExistingDispatchSession>> {
    let mut stack = vec![remote_root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let mut entries = match fs::read_dir(&dir).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(BitFunError::tool(format!(
                    "failed to inspect remote runtime root '{}': {}",
                    dir.display(),
                    error
                )));
            }
        };

        while let Some(entry) = entries.next_entry().await.map_err(|error| {
            BitFunError::tool(format!(
                "failed to enumerate remote runtime root '{}': {}",
                dir.display(),
                error
            ))
        })? {
            let file_type = entry.file_type().await.map_err(|error| {
                BitFunError::tool(format!(
                    "failed to inspect remote runtime entry '{}': {}",
                    entry.path().display(),
                    error
                ))
            })?;
            if !file_type.is_dir() {
                continue;
            }

            let path = entry.path();
            if let Some(resolved) =
                load_persisted_dispatch_session(persistence_manager, &path, session_id).await?
            {
                return Ok(Some(resolved));
            }
            stack.push(path);
        }
    }

    Ok(None)
}

async fn load_persisted_dispatch_session(
    persistence_manager: &PersistenceManager,
    runtime_root: &Path,
    session_id: &str,
) -> BitFunResult<Option<ResolvedExistingDispatchSession>> {
    let metadata_path = runtime_root
        .join("sessions")
        .join(session_id)
        .join("metadata.json");
    let stored = read_persisted_session_metadata(&metadata_path).await?;
    let Some(stored) = stored else {
        return Ok(None);
    };

    let workspace = stored
        .metadata
        .workspace_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let Some(workspace) = workspace else {
        return Ok(None);
    };

    let metadata = persistence_manager
        .load_session_metadata(Path::new(&workspace), session_id)
        .await?
        .unwrap_or(stored.metadata);

    Ok(Some(ResolvedExistingDispatchSession {
        workspace,
        metadata,
    }))
}

async fn read_persisted_session_metadata(
    metadata_path: &Path,
) -> BitFunResult<Option<StoredSessionMetadataFile>> {
    let bytes = match fs::read(metadata_path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(BitFunError::tool(format!(
                "failed to read session metadata '{}': {}",
                metadata_path.display(),
                error
            )));
        }
    };

    serde_json::from_slice::<StoredSessionMetadataFile>(&bytes)
        .map(Some)
        .map_err(|error| {
            BitFunError::tool(format!(
                "failed to parse session metadata '{}': {}",
                metadata_path.display(),
                error
            ))
        })
}

async fn resolve_existing_dispatch_request(
    mut request: AgentSessionDispatchRequest,
) -> BitFunResult<(
    AgentSessionDispatchRequest,
    Option<ResolvedExistingDispatchSession>,
)> {
    let AgentSessionDispatchTarget::Existing(existing) = &mut request.target else {
        return Ok((request, None));
    };

    let preferred_workspace = request.workspace.trim();
    let preferred_workspace = if preferred_workspace.is_empty() {
        None
    } else {
        Some(preferred_workspace)
    };

    let resolved =
        resolve_existing_dispatch_session(preferred_workspace, &existing.session_id).await?;
    request.workspace = resolved.workspace.clone();

    if existing
        .agent_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        let persisted_agent_type = resolved.metadata.agent_type.trim();
        if !persisted_agent_type.is_empty() {
            existing.agent_type = Some(persisted_agent_type.to_string());
        }
    }

    Ok((request, Some(resolved)))
}

pub async fn find_existing_session(
    workspace: &str,
    session_id: &str,
) -> BitFunResult<SessionSummary> {
    validate_session_id(session_id).map_err(BitFunError::tool)?;

    let coordinator = get_global_coordinator()
        .ok_or_else(|| BitFunError::tool("coordinator not initialized".to_string()))?;
    let workspace_path = Path::new(workspace);
    let sessions = coordinator.list_sessions(workspace_path).await?;

    sessions
        .into_iter()
        .find(|session| session.session_id == session_id)
        .ok_or_else(|| {
            BitFunError::NotFound(format!(
                "Session '{}' not found in workspace '{}'",
                session_id, workspace
            ))
        })
}

pub async fn dispatch_to_agent_session(
    request: AgentSessionDispatchRequest,
) -> BitFunResult<AgentSessionDispatchOutcome> {
    let (request, resolved_existing) = resolve_existing_dispatch_request(request).await?;

    if request.message.trim().is_empty() {
        return Err(BitFunError::tool("message cannot be empty".to_string()));
    }

    if let Some(dispatcher) = get_global_external_agent_session_dispatcher() {
        if let Some(outcome) = dispatcher.dispatch(request.clone()).await? {
            return Ok(outcome);
        }
    }

    let coordinator = get_global_coordinator()
        .ok_or_else(|| BitFunError::tool("coordinator not initialized".to_string()))?;
    let scheduler = get_global_scheduler()
        .ok_or_else(|| BitFunError::tool("scheduler not initialized".to_string()))?;

    let (kind, session_id, session_name, agent_type) = match request.target {
        AgentSessionDispatchTarget::New {
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
                        ..Default::default()
                    },
                    request.workspace.clone(),
                    created_by,
                )
                .await?;

            (
                AgentSessionDispatchKind::Created,
                session.session_id,
                session.session_name,
                session.agent_type,
            )
        }
        AgentSessionDispatchTarget::Existing(existing) => {
            let resolved = if let Some(resolved) = resolved_existing {
                resolved
            } else {
                resolve_existing_dispatch_session(Some(&request.workspace), &existing.session_id)
                    .await?
            };
            let agent_type = existing.agent_type.unwrap_or_else(|| {
                let persisted_agent_type = resolved.metadata.agent_type.trim();
                if persisted_agent_type.is_empty() {
                    "agentic".to_string()
                } else {
                    persisted_agent_type.to_string()
                }
            });

            (
                AgentSessionDispatchKind::Reused,
                resolved.metadata.session_id,
                resolved.metadata.session_name,
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
        .map_err(BitFunError::tool)?;

    Ok(AgentSessionDispatchOutcome {
        kind,
        workspace: request.workspace,
        session_id,
        session_name,
        agent_type,
    })
}
