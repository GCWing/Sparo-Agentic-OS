use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::agentic::persistence::PersistenceManager;
use crate::infrastructure::{try_get_path_manager_arc, PathManager};
use crate::service::session::{DialogTurnData, SessionMetadata};

use super::{CommandError, CommandResult};

#[derive(Debug, Clone, Deserialize)]
pub struct SessionWorkspaceRequest {
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ShowSessionRequest {
    pub session_id: String,
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeleteSessionRequest {
    pub session_id: String,
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionDetail {
    pub metadata: SessionMetadata,
    pub turns: Vec<DialogTurnData>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeleteSessionResponse {
    pub message: String,
}

async fn persistence_manager() -> CommandResult<PersistenceManager> {
    let path_manager = try_get_path_manager_arc().map_err(CommandError::session)?;
    PersistenceManager::new(path_manager).map_err(CommandError::session)
}

fn resolve_workspace_path(
    path_manager: &Arc<PathManager>,
    workspace_path: Option<String>,
) -> CommandResult<PathBuf> {
    match workspace_path {
        Some(path) if path.trim().is_empty() => {
            std::env::current_dir().map_err(CommandError::session)
        }
        Some(path) => Ok(PathBuf::from(path)),
        None => std::env::current_dir()
            .map_err(CommandError::session)
            .or_else(|_| Ok(path_manager.agentic_os_runtime_root())),
    }
}

pub async fn list_sessions(
    request: SessionWorkspaceRequest,
) -> CommandResult<Vec<SessionMetadata>> {
    let manager = persistence_manager().await?;
    let workspace_path = resolve_workspace_path(manager.path_manager(), request.workspace_path)?;
    let mut sessions = manager
        .list_session_metadata(&workspace_path)
        .await
        .map_err(CommandError::session)?;
    sessions.sort_by(|a, b| b.last_active_at.cmp(&a.last_active_at));
    Ok(sessions)
}

pub async fn show_session(request: ShowSessionRequest) -> CommandResult<SessionDetail> {
    let manager = persistence_manager().await?;
    let workspace_path = resolve_workspace_path(manager.path_manager(), request.workspace_path)?;
    let session_id = if request.session_id == "last" {
        let mut sessions = manager
            .list_session_metadata(&workspace_path)
            .await
            .map_err(CommandError::session)?;
        if sessions.is_empty() {
            let global_path = manager.path_manager().agentic_os_runtime_root();
            if global_path != workspace_path {
                sessions = manager
                    .list_session_metadata(&global_path)
                    .await
                    .map_err(CommandError::session)?;
            }
        }
        sessions
            .into_iter()
            .max_by_key(|metadata| metadata.last_active_at)
            .map(|metadata| metadata.session_id)
            .ok_or_else(|| CommandError::session("No history sessions"))?
    } else {
        request.session_id
    };

    let mut resolved_workspace_path = workspace_path;
    let mut metadata = manager
        .load_session_metadata(&resolved_workspace_path, &session_id)
        .await
        .map_err(CommandError::session)?;

    if metadata.is_none() {
        let global_path = manager.path_manager().agentic_os_runtime_root();
        if global_path != resolved_workspace_path {
            metadata = manager
                .load_session_metadata(&global_path, &session_id)
                .await
                .map_err(CommandError::session)?;
            if metadata.is_some() {
                resolved_workspace_path = global_path;
            }
        }
    }

    let metadata = metadata
        .ok_or_else(|| CommandError::session(format!("Session not found: {}", session_id)))?;
    let turns = manager
        .load_session_turns(&resolved_workspace_path, &session_id)
        .await
        .map_err(CommandError::session)?;

    Ok(SessionDetail { metadata, turns })
}

pub async fn delete_session(request: DeleteSessionRequest) -> CommandResult<DeleteSessionResponse> {
    let manager = persistence_manager().await?;
    let workspace_path = resolve_workspace_path(manager.path_manager(), request.workspace_path)?;
    manager
        .delete_session(&workspace_path, &request.session_id)
        .await
        .map_err(CommandError::session)?;
    Ok(DeleteSessionResponse {
        message: format!("Deleted session: {}", request.session_id),
    })
}
