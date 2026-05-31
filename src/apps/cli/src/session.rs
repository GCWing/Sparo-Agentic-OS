use bitfun_core::service::session::{
    DialogTurnData as CoreDialogTurnData, SessionMetadata as CoreSessionMetadata,
};
/// Session management module
///
/// Provides in-memory chat transcript state for the CLI TUI.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Session information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    /// Session ID
    pub id: String,
    /// Session title
    pub title: String,
    /// Created time
    pub created_at: DateTime<Utc>,
    /// Updated time
    pub updated_at: DateTime<Utc>,
    /// Workspace path
    pub workspace: Option<String>,
    /// Agent used
    pub agent: String,
    /// Message list
    pub messages: Vec<Message>,
    /// Metadata
    pub metadata: SessionMetadata,
}

/// Session metadata
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionMetadata {
    /// Message count
    pub message_count: usize,
    /// Tool call count
    pub tool_calls: usize,
    /// Files modified count
    pub files_modified: usize,
    /// Tags
    pub tags: Vec<String>,
}

/// Message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    /// Message ID
    pub id: String,
    /// Role (user, assistant, system)
    pub role: String,
    /// Content (for simple text messages)
    pub content: String,
    /// Timestamp
    pub timestamp: DateTime<Utc>,
    /// Flow items (mixed text and tools in order)
    #[serde(default)]
    pub flow_items: Vec<FlowItem>,
}

/// Flow item (inspired by flowchat architecture)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum FlowItem {
    /// Text block
    #[serde(rename = "text")]
    Text {
        /// Content
        content: String,
        /// Whether currently streaming
        #[serde(default)]
        is_streaming: bool,
    },
    /// Tool call
    #[serde(rename = "tool")]
    Tool {
        /// Tool call details
        tool_call: ToolCall,
    },
}

/// Tool call record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    /// Tool ID
    pub tool_id: Option<String>,
    /// Tool name
    pub tool_name: String,
    /// Tool parameters
    pub parameters: serde_json::Value,
    /// Execution result
    pub result: Option<String>,
    /// Execution status
    pub status: ToolCallStatus,
    /// Progress percentage (0.0 - 1.0)
    pub progress: Option<f32>,
    /// Progress message
    pub progress_message: Option<String>,
    /// Execution duration (milliseconds)
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ToolCallStatus {
    /// Early detected
    EarlyDetected,
    /// Parameters partially parsed
    ParamsPartial,
    /// Queued
    Queued,
    /// Waiting for dependencies
    Waiting,
    /// Confirmation needed
    ConfirmationNeeded,
    /// Confirmed
    Confirmed,
    /// Rejected
    Rejected,
    /// Pending execution
    Pending,
    /// Running
    Running,
    /// Streaming output
    Streaming,
    /// Execution successful
    Success,
    /// Execution failed
    Failed,
    /// Cancelled
    Cancelled,
}

impl Session {
    /// Create new session
    pub fn new(agent: String, workspace: Option<String>) -> Self {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();

        Self {
            id: id.clone(),
            title: format!("Session {}", now.format("%m-%d %H:%M")),
            created_at: now,
            updated_at: now,
            workspace,
            agent,
            messages: Vec::new(),
            metadata: SessionMetadata::default(),
        }
    }

    pub fn from_persisted(metadata: CoreSessionMetadata, turns: Vec<CoreDialogTurnData>) -> Self {
        let created_at = datetime_from_unix_ms(metadata.created_at);
        let updated_at = datetime_from_unix_ms(metadata.last_active_at);
        let mut session = Self {
            id: metadata.session_id.clone(),
            title: metadata.session_name.clone(),
            created_at,
            updated_at,
            workspace: metadata.workspace_path.clone(),
            agent: metadata.agent_type.clone(),
            messages: Vec::new(),
            metadata: SessionMetadata {
                message_count: metadata.message_count,
                tool_calls: metadata.tool_call_count,
                files_modified: 0,
                tags: metadata.tags.clone(),
            },
        };

        for turn in turns
            .into_iter()
            .filter(|turn| turn.kind.is_model_visible())
        {
            session.messages.push(Message {
                id: turn.user_message.id.clone(),
                role: "user".to_string(),
                content: turn.user_message.content.clone(),
                timestamp: datetime_from_unix_ms(turn.user_message.timestamp),
                flow_items: Vec::new(),
            });

            let mut assistant = Message {
                id: format!("assistant-{}", turn.turn_id),
                role: "assistant".to_string(),
                content: String::new(),
                timestamp: datetime_from_unix_ms(turn.timestamp),
                flow_items: Vec::new(),
            };

            for round in &turn.model_rounds {
                for text in &round.text_items {
                    if text.content.trim().is_empty() {
                        continue;
                    }
                    if !assistant.content.is_empty() {
                        assistant.content.push_str("\n\n");
                    }
                    assistant.content.push_str(&text.content);
                    assistant.flow_items.push(FlowItem::Text {
                        content: text.content.clone(),
                        is_streaming: false,
                    });
                }

                for tool in &round.tool_items {
                    assistant.flow_items.push(FlowItem::Tool {
                        tool_call: ToolCall {
                            tool_id: Some(tool.tool_call.id.clone()),
                            tool_name: tool.tool_name.clone(),
                            parameters: tool.tool_call.input.clone(),
                            result: tool
                                .tool_result
                                .as_ref()
                                .map(|result| {
                                    result
                                        .result_for_assistant
                                        .clone()
                                        .unwrap_or_else(|| result.result.to_string())
                                })
                                .or_else(|| tool.ai_intent.clone()),
                            status: if tool
                                .tool_result
                                .as_ref()
                                .map(|result| result.success)
                                .unwrap_or(false)
                            {
                                ToolCallStatus::Success
                            } else if tool.tool_result.is_some() {
                                ToolCallStatus::Failed
                            } else {
                                ToolCallStatus::Pending
                            },
                            progress: tool.tool_result.as_ref().map(|_| 1.0),
                            progress_message: tool.status.clone(),
                            duration_ms: tool.duration_ms,
                        },
                    });
                }
            }

            if !assistant.content.trim().is_empty() || !assistant.flow_items.is_empty() {
                session.messages.push(assistant);
            }
        }

        session.metadata.message_count = session.messages.len();
        session
    }

    /// Add message
    pub fn add_message(&mut self, role: String, content: String) {
        let message = Message {
            id: uuid::Uuid::new_v4().to_string(),
            role,
            content,
            timestamp: Utc::now(),
            flow_items: Vec::new(),
        };

        self.messages.push(message);
        self.metadata.message_count = self.messages.len();
        self.updated_at = Utc::now();
    }

    /// Add or update text flow of the last message
    pub fn update_last_message_text_flow(&mut self, content: String, is_streaming: bool) {
        if let Some(last_message) = self.messages.last_mut() {
            if let Some(FlowItem::Text {
                content: ref mut c,
                is_streaming: ref mut s,
            }) = last_message.flow_items.last_mut()
            {
                *c = content.clone();
                *s = is_streaming;
            } else {
                last_message.flow_items.push(FlowItem::Text {
                    content: content.clone(),
                    is_streaming,
                });
            }
            last_message.content = content;
            self.updated_at = Utc::now();
        }
    }

    /// Add tool call to the last message
    pub fn add_tool_to_last_message(&mut self, tool_call: ToolCall) {
        if let Some(last_message) = self.messages.last_mut() {
            last_message.flow_items.push(FlowItem::Tool { tool_call });
            self.metadata.tool_calls += 1;
            self.updated_at = Utc::now();
        }
    }

    /// Update tool call status in the last message
    pub fn update_tool_in_last_message(
        &mut self,
        tool_id: &str,
        update_fn: impl FnOnce(&mut ToolCall),
    ) {
        if let Some(last_message) = self.messages.last_mut() {
            for item in last_message.flow_items.iter_mut() {
                if let FlowItem::Tool { tool_call } = item {
                    if tool_call.tool_id.as_deref() == Some(tool_id) {
                        update_fn(tool_call);
                        break;
                    }
                }
            }
            self.updated_at = Utc::now();
        }
    }
}

fn datetime_from_unix_ms(timestamp_ms: u64) -> DateTime<Utc> {
    DateTime::<Utc>::from(std::time::UNIX_EPOCH + std::time::Duration::from_millis(timestamp_ms))
}
