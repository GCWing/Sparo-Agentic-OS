/// Agent integration module
///
/// Wraps interaction with sparo-core's Agent system
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
    /// Tool execution is waiting for user confirmation
    ToolConfirmationNeeded {
        tool_id: String,
        tool_name: String,
        parameters: serde_json::Value,
    },
    /// Tool confirmation was accepted
    ToolConfirmed { tool_id: String, tool_name: String },
    /// Tool confirmation was rejected
    ToolRejected {
        tool_id: String,
        tool_name: String,
        reason: String,
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
    /// Core session id used for this response, when available.
    pub session_id: Option<String>,
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
    fn name(&self) -> String;

    /// Update the workspace used for future messages.
    fn set_workspace_path(&self, workspace_path: Option<PathBuf>);

    /// Update the agent type used for the next new core session.
    fn set_agent_type(&self, _agent_type: String) -> Result<()> {
        anyhow::bail!("This agent does not support agent switching")
    }

    /// Repoint future messages at an existing session context.
    fn set_session_context(
        &self,
        _session_id: String,
        _workspace_path: Option<PathBuf>,
        _agent_type: String,
    ) -> Result<()> {
        anyhow::bail!("This agent does not support session switching")
    }

    /// Forget the current core session so the next message creates a new one.
    fn reset_session(&self);

    /// Confirm a pending tool execution.
    async fn confirm_tool(
        &self,
        _tool_id: &str,
        _updated_input: Option<serde_json::Value>,
    ) -> Result<()> {
        anyhow::bail!("This agent does not support tool confirmation")
    }

    /// Reject a pending tool execution.
    async fn reject_tool(&self, _tool_id: &str, _reason: String) -> Result<()> {
        anyhow::bail!("This agent does not support tool rejection")
    }
}
