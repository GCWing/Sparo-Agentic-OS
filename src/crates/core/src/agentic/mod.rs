//! Agentic Module
//!
//! Core AI Agent service system

// Core module
pub mod core;
pub mod events;
pub mod persistence;

// Session management module
pub mod session;

// Execution engine module
pub mod execution;

// Tools module
pub mod tools;

// Memory system
pub mod memory;

// Coordination module
pub mod coordination;

// Shared-context fork-agent execution module
pub mod fork_agent;

/// Round-boundary yield when user queues a message during an active turn
pub mod round_preempt;

// Image analysis module
pub mod image_analysis;

// Markdown co-authoring prompt and proposal normalization.
pub mod markdown_coauthor;

// Ephemeral side-question module (used by desktop /btw overlay)
pub mod side_question;

// Agents module
pub mod agents;
pub mod workspace;

pub use agents::*;
pub use coordination::*;
pub use core::*;
pub use events::{queue, router, types as event_types};
pub use execution::*;
pub use fork_agent::*;
pub use image_analysis::{ImageAnalyzer, MessageEnhancer};
pub use persistence::PersistenceManager;
pub use round_preempt::{
    DialogRoundPreemptSource, NoopDialogRoundPreemptSource, SessionRoundYieldFlags,
};
pub use session::*;
pub use side_question::*;
pub use workspace::WorkspaceBinding;
