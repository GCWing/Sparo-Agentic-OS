//! Shared desktop resolution of on-disk session roots for local workspaces.

use crate::api::app_state::AppState;
use sparo_core::service::workspace_session::workspace_session_identity;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStorageScopeDto {
    Workspace,
    AgenticOs,
}

pub async fn desktop_effective_session_storage_path(
    app_state: &AppState,
    workspace_path: Option<&str>,
    storage_scope: Option<SessionStorageScopeDto>,
) -> PathBuf {
    if matches!(storage_scope, Some(SessionStorageScopeDto::AgenticOs)) {
        return app_state
            .workspace_service
            .path_manager()
            .agentic_os_runtime_root();
    }
    let workspace_path = workspace_path.unwrap_or_default();
    if workspace_path.is_empty() {
        return app_state
            .workspace_service
            .path_manager()
            .agentic_os_runtime_root();
    }
    if let Some(identity) = workspace_session_identity(workspace_path) {
        identity.session_storage_path()
    } else {
        PathBuf::from(workspace_path)
    }
}
