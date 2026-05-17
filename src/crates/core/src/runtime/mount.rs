//! Per-workspace bundle of mounted services.
//!
//! A `WorkspaceMount` is the runtime "incarnation" of an open workspace. It
//! owns everything that is workspace-local (its on-disk snapshot manager, its
//! custom-subagent overlay, the path it was opened against) but does **not**
//! own any process-wide service — those live in `AppContainer::platform` and
//! are shared across all mounts.

use crate::agentic::agents::AgentRegistry;
use crate::service::snapshot::SnapshotManager;
use crate::service::workspace::WorkspaceInfo;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Stable identifier for a mounted workspace. Mirrors `WorkspaceInfo::id` so
/// the frontend and backend agree on the same key without needing to round-
/// trip the path.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct WorkspaceId(pub String);

impl WorkspaceId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for WorkspaceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<String> for WorkspaceId {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for WorkspaceId {
    fn from(value: &str) -> Self {
        Self(value.to_string())
    }
}

/// Workspace-local services that must exist for as long as the workspace is
/// mounted and must be released when it is unmounted.
///
/// All fields are `Arc`-wrapped so callers can hold cheap references; the
/// mount itself is `Clone` so it can be handed back from registry lookups
/// without bumping reference counts on each field individually.
#[derive(Clone)]
pub struct WorkspaceMount {
    pub id: WorkspaceId,
    pub info: Arc<WorkspaceInfo>,
    pub root_path: Arc<PathBuf>,
    pub snapshot_manager: Arc<SnapshotManager>,
    /// Custom subagent overlay loaded from `<workspace>/.sparo_os/agents`.
    /// Shared with the global agent registry — every mount keeps a handle to
    /// the same registry but the overlay is workspace-scoped.
    pub agent_registry: Arc<AgentRegistry>,
}

impl WorkspaceMount {
    pub fn new(
        info: WorkspaceInfo,
        snapshot_manager: Arc<SnapshotManager>,
        agent_registry: Arc<AgentRegistry>,
    ) -> Self {
        let id = WorkspaceId::new(info.id.clone());
        let root_path = Arc::new(info.root_path.clone());
        Self {
            id,
            info: Arc::new(info),
            root_path,
            snapshot_manager,
            agent_registry,
        }
    }

    pub fn root(&self) -> &Path {
        self.root_path.as_path()
    }
}

impl std::fmt::Debug for WorkspaceMount {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkspaceMount")
            .field("id", &self.id)
            .field("root", &self.root_path.display().to_string())
            .finish()
    }
}
