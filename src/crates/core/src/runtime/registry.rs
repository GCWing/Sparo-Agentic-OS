//! Multi-workspace registry.
//!
//! Lock-free reads via `DashMap`. Mount / unmount are infrequent (user-driven
//! workspace switches) so we accept a short write critical section there. All
//! lookups (`by_id`, `by_path`, `by_session`, `active`) are O(1) or O(N) over
//! the small N of mounted workspaces.

use crate::agentic::session::SessionManager;
use crate::runtime::mount::{WorkspaceId, WorkspaceMount};
use arc_swap::ArcSwapOption;
use dashmap::DashMap;
use dunce::canonicalize;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// A registry lookup result. Keeps the `WorkspaceId` alongside the bundle so
/// the caller does not have to re-derive it.
#[derive(Clone)]
pub struct MountedWorkspace {
    pub id: WorkspaceId,
    pub mount: WorkspaceMount,
}

#[derive(Default)]
pub struct WorkspaceRegistry {
    by_id: DashMap<WorkspaceId, WorkspaceMount>,
    active: ArcSwapOption<WorkspaceId>,
}

impl WorkspaceRegistry {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn mount(&self, mount: WorkspaceMount) {
        let id = mount.id.clone();
        log::info!(
            "Mounting workspace: id={}, root={}",
            id,
            mount.root().display()
        );
        self.by_id.insert(id, mount);
    }

    pub fn unmount(&self, id: &WorkspaceId) -> Option<WorkspaceMount> {
        log::info!("Unmounting workspace: id={}", id);
        let removed = self.by_id.remove(id).map(|(_, mount)| mount);
        // If we just unmounted the active workspace, clear the active pointer
        // so commands fail fast instead of operating on a half-torn mount.
        if let Some(active) = self.active.load_full() {
            if active.as_ref() == id {
                self.active.store(None);
            }
        }
        removed
    }

    pub fn get(&self, id: &WorkspaceId) -> Option<WorkspaceMount> {
        self.by_id.get(id).map(|entry| entry.value().clone())
    }

    pub fn by_path(&self, path: &Path) -> Option<WorkspaceMount> {
        let canonical = canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        self.by_id
            .iter()
            .find(|entry| {
                let mount_root = entry.value().root();
                let mount_canonical =
                    canonicalize(mount_root).unwrap_or_else(|_| mount_root.to_path_buf());
                mount_canonical == canonical
            })
            .map(|entry| entry.value().clone())
    }

    pub fn by_workspace_id_str(&self, id: &str) -> Option<WorkspaceMount> {
        self.get(&WorkspaceId::new(id))
    }

    /// Resolve a mount from a session id by asking the supplied
    /// `SessionManager` which workspace owns it. Necessary for code paths like
    /// the remote-connect server where the only context is a session id.
    pub fn by_session_id(
        &self,
        session_manager: &SessionManager,
        session_id: &str,
    ) -> Option<WorkspaceMount> {
        let session = session_manager.get_session(session_id)?;
        let workspace_path = session.config.workspace_path.as_ref()?;
        let path = PathBuf::from(workspace_path);
        self.by_path(&path)
    }

    pub fn set_active(&self, id: Option<WorkspaceId>) {
        match &id {
            Some(id) => log::debug!("Active workspace set to: id={}", id),
            None => log::debug!("Active workspace cleared"),
        }
        self.active.store(id.map(Arc::new));
    }

    pub fn active_id(&self) -> Option<WorkspaceId> {
        self.active.load_full().map(|arc| (*arc).clone())
    }

    pub fn active(&self) -> Option<WorkspaceMount> {
        let active = self.active.load_full()?;
        self.get(&active)
    }

    /// Snapshot the current mount list. Cheap because `WorkspaceMount` is
    /// `Clone` over `Arc`s.
    pub fn list(&self) -> Vec<MountedWorkspace> {
        self.by_id
            .iter()
            .map(|entry| MountedWorkspace {
                id: entry.key().clone(),
                mount: entry.value().clone(),
            })
            .collect()
    }

    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }
}

impl std::fmt::Debug for WorkspaceRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkspaceRegistry")
            .field("mounted", &self.by_id.len())
            .field("active", &self.active_id())
            .finish()
    }
}
