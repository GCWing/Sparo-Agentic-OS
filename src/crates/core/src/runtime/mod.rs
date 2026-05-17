//! Runtime layer: multi-workspace registry + per-workspace mount bundle.
//!
//! ## Why this module exists
//!
//! Historically every workspace-scoped service was reachable via a
//! `OnceCell`/`OnceLock` global (`get_global_coordinator`, `get_global_cron_service`,
//! the keyed `snapshot_managers()` map, ...). That made the data layer's
//! multi-workspace capability (`list_sessions(workspace_path)`, etc.)
//! unreachable from the runtime: only ever one set of background tasks could
//! be alive at a time.
//!
//! This module is the new single source of truth for **which workspaces are
//! mounted right now**, with two types:
//!
//!   * [`WorkspaceMount`] — the per-workspace bundle of *workspace-local*
//!     services: snapshot manager, custom-subagent overlay, and the metadata
//!     needed to route incoming calls.
//!   * [`WorkspaceRegistry`] — a lock-free registry of `WorkspaceMount`s
//!     keyed by `WorkspaceId`. Supports `mount` / `unmount` plus lookup by
//!     id, path, or session id, and tracks which mount the user is currently
//!     focused on (`active`).
//!
//! Truly process-wide services (config, i18n, AI factory, the agentic stack
//! that is itself multi-workspace aware via `workspace_path` arguments) stay
//! singletons but are now owned explicitly by `AppContainer` rather than
//! reached via globals.

pub mod handles;
pub mod mount;
pub mod registry;

pub use handles::AgenticHandles;
pub use mount::{WorkspaceId, WorkspaceMount};
pub use registry::{MountedWorkspace, WorkspaceRegistry};
