//! Phased boot orchestration for the desktop shell.
//!
//! The boot sequence is split into discrete stages. Each stage publishes a
//! `BootStage` value via the `boot://stage` Tauri event so the frontend can
//! drive the splash UI deterministically (no fake delay loops).
//!
//! Stage order:
//!
//! ```text
//!   PreWindow ──► WindowReady ──► GlobalReady ──► WorkspaceReady
//! ```
//!
//! On any failure a `BootStage::Degraded` is emitted; the frontend renders the
//! BootErrorPanel and offers "open log directory" / "retry" / "switch workspace".

pub mod boot;
pub mod container;
pub mod failure;
pub mod globals;
pub mod panic;
pub mod workspace;

pub use boot::{BootController, BootStage};
pub use container::AppContainer;
