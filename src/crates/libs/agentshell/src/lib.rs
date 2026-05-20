//! agentshell - Agent-first terminal library
//!
//! Provides PTY management, shell integration (OSC 633), streaming command execution,
//! session lifecycle, ANSI output cleaning, and cross-platform compatibility.
//!
//! # Architecture
//!
//! - `pty`: PTY process management and data buffering
//! - `session`: Terminal session lifecycle and persistence
//! - `shell`: Shell detection and integration scripts (OSC 633)
//! - `config`: Configuration types and defaults
//! - `events`: Event definitions for frontend/transport communication
//! - `api`: Public API for external consumers (Tauri, WebSocket, Agent tools)
//! - `output`: ANSI escape sequence cleaning for clean LLM/agent output

pub mod api;
pub mod config;
pub mod events;
pub mod output;
pub mod pty;
pub mod session;
pub mod shell;

// Re-export main types for convenience
pub use api::{
    AcknowledgeRequest, CloseSessionRequest, CreateSessionRequest, ExecuteCommandRequest,
    ExecuteCommandResponse, GetHistoryRequest, GetHistoryResponse, ResizeRequest,
    SendCommandRequest, SessionResponse, ShellInfo, SignalRequest, TerminalApi, WriteRequest,
};
pub use config::{ShellConfig, TerminalConfig};
pub use events::{TerminalEvent, TerminalEventEmitter};
pub use output::{strip_ansi, strip_ansi_bytes, AnsiCleaner};
pub use pty::{
    // New component-based types
    spawn_pty,
    DataBufferer,
    FlowControl,
    ProcessInfo,
    ProcessProperty,
    PtyCommand,
    PtyController,
    PtyEvent,
    PtyEventStream,
    PtyInfo,
    PtyService,
    PtyServiceEvent,
    PtyWriter,
    SpawnResult,
};
pub use session::{
    CommandCompletionReason, CommandExecuteResult, CommandStream, CommandStreamEvent,
    ExecuteOptions, SessionManager, SessionSource, SessionStatus, TerminalBindingOptions,
    TerminalSession, TerminalSessionBinding,
};
pub use shell::{
    get_integration_script_content, CommandState, ScriptsManager, ShellDetector, ShellIntegration,
    ShellIntegrationEvent, ShellIntegrationManager, ShellProfile, ShellType,
};

/// Result type for terminal operations
pub type TerminalResult<T> = Result<T, TerminalError>;

/// Error types for terminal operations
#[derive(Debug, thiserror::Error)]
pub enum TerminalError {
    #[error("PTY error: {0}")]
    Pty(String),

    #[error("Session error: {0}")]
    Session(String),

    #[error("Shell error: {0}")]
    Shell(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Process not running")]
    ProcessNotRunning,

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Flow control error: {0}")]
    FlowControl(String),

    #[error("Anyhow error: {0}")]
    Anyhow(#[from] anyhow::Error),

    #[error("Command timeout: {0}")]
    Timeout(String),
}
