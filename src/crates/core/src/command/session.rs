use serde::{Deserialize, Serialize};

use crate::agentic::core::{SessionDomain, SessionLocator};
use crate::agentic::persistence::PersistenceManager;
use crate::infrastructure::try_get_path_manager_arc;
use crate::service::session::{DialogTurnData, SessionMetadata};

use super::{CommandError, CommandResult};

#[derive(Debug, Clone, Deserialize)]
pub struct SessionWorkspaceRequest {
    pub domain: SessionDomain,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ShowSessionRequest {
    pub locator: SessionLocator,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeleteSessionRequest {
    pub locator: SessionLocator,
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

pub async fn list_sessions(
    request: SessionWorkspaceRequest,
) -> CommandResult<Vec<SessionMetadata>> {
    let manager = persistence_manager().await?;
    let mut sessions = manager
        .list_session_metadata(&request.domain)
        .await
        .map_err(CommandError::session)?;
    sessions.sort_by(|a, b| b.last_active_at.cmp(&a.last_active_at));
    Ok(sessions)
}

pub async fn show_session(request: ShowSessionRequest) -> CommandResult<SessionDetail> {
    let manager = persistence_manager().await?;
    let locator = resolve_existing_session(&manager, request.locator).await?;
    let metadata = manager
        .load_session_metadata(&locator.domain, &locator.session_id)
        .await
        .map_err(CommandError::session)?
        .ok_or_else(|| {
            CommandError::session(format!("Session not found: {}", locator.session_id))
        })?;
    let turns = manager
        .load_session_turns(&locator.domain, &locator.session_id)
        .await
        .map_err(CommandError::session)?;

    Ok(SessionDetail { metadata, turns })
}

pub async fn delete_session(request: DeleteSessionRequest) -> CommandResult<DeleteSessionResponse> {
    let manager = persistence_manager().await?;
    let locator = resolve_existing_session(&manager, request.locator).await?;
    manager
        .delete_session(&locator)
        .await
        .map_err(CommandError::session)?;
    Ok(DeleteSessionResponse {
        message: format!("Deleted session: {}", locator.session_id),
    })
}

async fn resolve_existing_session(
    manager: &PersistenceManager,
    mut locator: SessionLocator,
) -> CommandResult<SessionLocator> {
    if locator.session_id == "last" {
        let mut sessions = manager
            .list_session_metadata(&locator.domain)
            .await
            .map_err(CommandError::session)?;
        locator.session_id = sessions
            .drain(..)
            .into_iter()
            .max_by_key(|metadata| metadata.last_active_at)
            .map(|metadata| metadata.session_id)
            .ok_or_else(|| CommandError::session("No history sessions"))?;
    }
    Ok(locator)
}
