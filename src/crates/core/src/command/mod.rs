//! Host-agnostic command handlers shared by Desktop and CLI.

pub mod agentic_os;
mod context;
mod error;
pub mod session;
pub mod settings_agent;
pub mod tool;

pub use context::CommandContext;
pub use error::{CommandError, CommandResult};
