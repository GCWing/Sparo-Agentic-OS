//! DTO Module

use serde::{Deserialize, Serialize};
use sparo_core::service::workspace::manager::WorkspaceKind;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceKindDto {
    Normal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIdentityDto {
    pub name: Option<String>,
    pub creature: Option<String>,
    pub vibe: Option<String>,
    pub emoji: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfoDto {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub workspace_kind: WorkspaceKindDto,
    pub opened_at: String,
    pub last_accessed: String,
    pub identity: Option<WorkspaceIdentityDto>,
}

impl WorkspaceInfoDto {
    pub fn from_workspace_info(
        info: &sparo_core::service::workspace::manager::WorkspaceInfo,
    ) -> Self {
        Self {
            id: info.id.clone(),
            name: info.name.clone(),
            root_path: info.root_path.to_string_lossy().to_string(),
            workspace_kind: WorkspaceKindDto::from_workspace_kind(&info.workspace_kind),
            opened_at: info.opened_at.to_rfc3339(),
            last_accessed: info.last_accessed.to_rfc3339(),
            identity: info
                .identity
                .as_ref()
                .map(WorkspaceIdentityDto::from_workspace_identity),
        }
    }
}

impl WorkspaceIdentityDto {
    pub fn from_workspace_identity(
        identity: &sparo_core::service::workspace::manager::WorkspaceIdentity,
    ) -> Self {
        Self {
            name: identity.name.clone(),
            creature: identity.creature.clone(),
            vibe: identity.vibe.clone(),
            emoji: identity.emoji.clone(),
        }
    }
}

impl WorkspaceKindDto {
    pub fn from_workspace_kind(workspace_kind: &WorkspaceKind) -> Self {
        match workspace_kind {
            WorkspaceKind::Normal => WorkspaceKindDto::Normal,
        }
    }
}
