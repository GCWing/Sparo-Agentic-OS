/// Agent integration module
///
/// Wraps interaction with bitfun-core's Agent system
pub mod agentic_system;
pub mod core_adapter;

use anyhow::Result;
use std::path::PathBuf;
use tokio::sync::mpsc;

use crate::session::ToolCall;

/// Agent event
#[derive(Debug, Clone)]
pub enum AgentEvent {
    /// Start thinking
    Thinking,
    /// Text stream
    TextChunk(String),
    /// Tool call started
    ToolCallStart {
        tool_id: String,
        tool_name: String,
        parameters: serde_json::Value,
    },
    /// Tool call in progress
    ToolCallProgress {
        tool_id: String,
        tool_name: String,
        message: String,
    },
    /// Tool call completed
    ToolCallComplete {
        tool_id: String,
        tool_name: String,
        result: String,
        success: bool,
    },
    /// Done
    Done,
    /// Error
    Error(String),
}

/// Agent response
#[derive(Debug, Clone)]
pub struct AgentResponse {
    /// Tool call list
    pub tool_calls: Vec<ToolCall>,
    /// Whether successful
    pub success: bool,
}

/// Agent interface
#[async_trait::async_trait]
pub trait Agent: Send + Sync {
    /// Process user message
    async fn process_message(
        &self,
        message: String,
        event_tx: mpsc::UnboundedSender<AgentEvent>,
    ) -> Result<AgentResponse>;

    /// Get Agent name
    fn name(&self) -> &str;

    /// Update the workspace used for future messages.
    fn set_workspace_path(&self, workspace_path: Option<PathBuf>);

    /// Forget the current core session so the next message creates a new one.
    fn reset_session(&self);
}
