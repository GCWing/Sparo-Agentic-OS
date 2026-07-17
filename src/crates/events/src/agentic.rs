//! Agentic Events Definition
use serde::{Deserialize, Serialize};
use std::time::SystemTime;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum AgenticEventPriority {
    Critical = 0, // Immediately send (error, cancellation)
    High = 1,
    Normal = 2,
    Low = 3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgenticEventDeliveryClass {
    /// Events that contribute to a user-visible session/turn timeline and must
    /// preserve enqueue order end-to-end.
    OrderedTimeline,
    /// Events that can be delivered independently to regain concurrency.
    PriorityControl,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentParentInfo {
    #[serde(rename = "toolCallId")]
    pub tool_call_id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "dialogTurnId")]
    pub dialog_turn_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionSurfaceMode {
    UserVisible,
    ParentRoutedSubagent,
    InternalBackground,
}

impl Default for SessionSurfaceMode {
    fn default() -> Self {
        Self::UserVisible
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgenticEvent {
    SessionCreated {
        session_id: String,
        session_name: String,
        agent_type: String,
        /// Workspace path this session belongs to. None for locally-created sessions.
        #[serde(skip_serializing_if = "Option::is_none")]
        workspace_path: Option<String>,
    },

    SessionStateChanged {
        session_id: String,
        new_state: String,
    },

    SessionDeleted {
        session_id: String,
    },

    SessionTitleGenerated {
        session_id: String,
        title: String,
        method: String,
    },
    ImageAnalysisStarted {
        session_id: String,
        image_count: usize,
        user_input: String,
        /// Image metadata JSON for UI rendering (same as DialogTurnStarted)
        image_metadata: Option<serde_json::Value>,
    },

    ImageAnalysisCompleted {
        session_id: String,
        success: bool,
        duration_ms: u64,
    },

    DialogTurnStarted {
        session_id: String,
        turn_id: String,
        turn_index: usize,
        user_input: String,
        /// Original user input before vision enhancement (for display on all clients)
        original_user_input: Option<String>,
        /// Image metadata JSON for UI rendering (id, name, data_url, mime_type, image_path)
        user_message_metadata: Option<serde_json::Value>,
        #[serde(default)]
        surface_mode: SessionSurfaceMode,
        subagent_parent_info: Option<SubagentParentInfo>,
    },

    DialogTurnCompleted {
        session_id: String,
        turn_id: String,
        total_rounds: usize,
        total_tools: usize,
        duration_ms: u64,
        #[serde(default)]
        hidden_session: bool,
        #[serde(default)]
        surface_mode: SessionSurfaceMode,
        subagent_parent_info: Option<SubagentParentInfo>,
    },

    DialogTurnCancelled {
        session_id: String,
        turn_id: String,
        #[serde(default)]
        surface_mode: SessionSurfaceMode,
        subagent_parent_info: Option<SubagentParentInfo>,
    },

    DialogTurnFailed {
        session_id: String,
        turn_id: String,
        error: String,
        #[serde(default)]
        surface_mode: SessionSurfaceMode,
        subagent_parent_info: Option<SubagentParentInfo>,
    },

    DialogTurnQueued {
        session_id: String,
        turn_id: String,
        user_input: String,
        original_user_input: Option<String>,
        agent_type: String,
        queue_priority: String,
        queue_depth: usize,
        enqueued_at_ms: u64,
        has_images: bool,
        image_count: usize,
    },

    DialogTurnQueueUpdated {
        session_id: String,
        turn_id: String,
        user_input: String,
        original_user_input: Option<String>,
        queue_depth: usize,
        updated_at_ms: u64,
    },

    DialogTurnQueueDeleted {
        session_id: String,
        turn_id: String,
        queue_depth: usize,
    },

    DialogTurnQueueDispatching {
        session_id: String,
        turn_id: String,
        queue_depth: usize,
    },

    DialogTurnQueuePaused {
        session_id: String,
        reason: String,
        turn_id: Option<String>,
        error: Option<String>,
        queue_depth: usize,
    },

    DialogTurnQueueResumed {
        session_id: String,
        queue_depth: usize,
    },

    DialogTurnGuidanceRequested {
        session_id: String,
        turn_id: String,
        guidance_id: String,
        source_turn_id: String,
        user_input: String,
        original_user_input: Option<String>,
        queue_depth: usize,
        received_at_ms: u64,
        has_images: bool,
        image_count: usize,
    },

    DialogTurnGuidanceApplied {
        session_id: String,
        turn_id: String,
        guidance_id: String,
        source_turn_id: String,
        applied_at_ms: u64,
    },

    DialogTurnGuidanceFailed {
        session_id: String,
        turn_id: Option<String>,
        guidance_id: Option<String>,
        source_turn_id: String,
        error: String,
    },

    TokenUsageUpdated {
        session_id: String,
        turn_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        round_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        snapshot_id: Option<String>,
        model_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provider: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent_type: Option<String>,
        input_tokens: usize,
        output_tokens: Option<usize>,
        total_tokens: usize,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cached_tokens: Option<usize>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reasoning_tokens: Option<usize>,
        max_context_tokens: Option<usize>,
        is_subagent: bool,
    },

    ContextBudgetUpdated {
        session_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        turn_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        round_id: Option<String>,
        snapshot: serde_json::Value,
    },

    ContextCompressionStarted {
        session_id: String,
        turn_id: String,
        compression_id: String,
        trigger: String,
        tokens_before: usize,
        context_window: usize,
        threshold: f32,
        #[serde(default)]
        surface_mode: SessionSurfaceMode,
        subagent_parent_info: Option<SubagentParentInfo>,
    },

    ContextCompressionCompleted {
        session_id: String,
        turn_id: String,
        compression_id: String,
        compression_count: usize,
        tokens_before: usize,
        tokens_after: usize,
        compression_ratio: f64,
        duration_ms: u64,
        has_summary: bool,
        summary_source: String,
        #[serde(default)]
        surface_mode: SessionSurfaceMode,
        subagent_parent_info: Option<SubagentParentInfo>,
    },

    ContextCompressionFailed {
        session_id: String,
        turn_id: String,
        compression_id: String,
        error: String,
        #[serde(default)]
        surface_mode: SessionSurfaceMode,
        subagent_parent_info: Option<SubagentParentInfo>,
    },

    ModelRoundStarted {
        session_id: String,
        turn_id: String,
        round_id: String,
        round_index: usize,
        #[serde(default)]
        surface_mode: SessionSurfaceMode,
        subagent_parent_info: Option<SubagentParentInfo>,
    },

    ModelRoundCompleted {
        session_id: String,
        turn_id: String,
        round_id: String,
        has_tool_calls: bool,
        #[serde(default)]
        surface_mode: SessionSurfaceMode,
        subagent_parent_info: Option<SubagentParentInfo>,
    },

    TextChunk {
        session_id: String,
        turn_id: String,
        round_id: String,
        text: String,
        #[serde(default)]
        surface_mode: SessionSurfaceMode,
        subagent_parent_info: Option<SubagentParentInfo>,
    },

    ThinkingChunk {
        session_id: String,
        turn_id: String,
        round_id: String,
        content: String,
        #[serde(default)]
        is_end: bool,
        #[serde(default)]
        surface_mode: SessionSurfaceMode,
        subagent_parent_info: Option<SubagentParentInfo>,
    },

    ToolEvent {
        session_id: String,
        turn_id: String,
        tool_event: ToolEventData,
        #[serde(default)]
        surface_mode: SessionSurfaceMode,
        subagent_parent_info: Option<SubagentParentInfo>,
    },

    SystemError {
        session_id: Option<String>,
        error: String,
        recoverable: bool,
    },

    /// A session's bound model has been automatically migrated because the
    /// previously bound model became unavailable (disabled or deleted).
    /// The frontend should refresh its model selector for the session and
    /// surface a non-blocking notice so the user knows what happened.
    SessionModelAutoMigrated {
        session_id: String,
        /// The model id the session was using before the migration.
        previous_model_id: String,
        /// The model id (or selector such as `"primary"` / `"fast"`) the session is now bound
        /// to. This is what `SessionConfig.model_id` was rewritten to.
        new_model_id: String,
        /// Why the migration happened, e.g. `"model_disabled"` or
        /// `"model_deleted"`.
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event_type")]
pub enum ToolEventData {
    EarlyDetected {
        tool_id: String,
        tool_name: String,
    },
    ParamsPartial {
        tool_id: String,
        tool_name: String,
        params: String,
    },
    Queued {
        tool_id: String,
        tool_name: String,
        position: usize,
    },
    Waiting {
        tool_id: String,
        tool_name: String,
        dependencies: Vec<String>,
    },
    Started {
        tool_id: String,
        tool_name: String,
        params: serde_json::Value,
    },
    Progress {
        tool_id: String,
        tool_name: String,
        message: String,
        percentage: f32,
    },
    Streaming {
        tool_id: String,
        tool_name: String,
        chunks_received: usize,
    },
    StreamChunk {
        tool_id: String,
        tool_name: String,
        data: serde_json::Value,
    },
    ConfirmationNeeded {
        tool_id: String,
        tool_name: String,
        params: serde_json::Value,
    },
    Confirmed {
        tool_id: String,
        tool_name: String,
    },
    Rejected {
        tool_id: String,
        tool_name: String,
    },
    Completed {
        tool_id: String,
        tool_name: String,
        result: serde_json::Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        result_for_assistant: Option<String>,
        duration_ms: u64,
    },
    Failed {
        tool_id: String,
        tool_name: String,
        error: String,
    },
    Cancelled {
        tool_id: String,
        tool_name: String,
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgenticEventEnvelope {
    pub id: String,
    pub event: AgenticEvent,
    pub priority: AgenticEventPriority,
    pub sequence: u64,
    pub timestamp: SystemTime,
}

impl PartialEq for AgenticEventEnvelope {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl Eq for AgenticEventEnvelope {}

impl PartialOrd for AgenticEventEnvelope {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for AgenticEventEnvelope {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        match self.priority.cmp(&other.priority) {
            std::cmp::Ordering::Equal => self.sequence.cmp(&other.sequence),
            other => other,
        }
    }
}

impl AgenticEventEnvelope {
    pub fn new(event: AgenticEvent, priority: AgenticEventPriority, sequence: u64) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            event,
            priority,
            sequence,
            timestamp: SystemTime::now(),
        }
    }
}

impl AgenticEvent {
    /// Get the session ID of the event
    pub fn session_id(&self) -> Option<&str> {
        match self {
            Self::SessionCreated { session_id, .. }
            | Self::SessionStateChanged { session_id, .. }
            | Self::SessionDeleted { session_id }
            | Self::SessionTitleGenerated { session_id, .. }
            | Self::ImageAnalysisStarted { session_id, .. }
            | Self::ImageAnalysisCompleted { session_id, .. }
            | Self::DialogTurnStarted { session_id, .. }
            | Self::DialogTurnCompleted { session_id, .. }
            | Self::DialogTurnQueued { session_id, .. }
            | Self::DialogTurnQueueUpdated { session_id, .. }
            | Self::DialogTurnQueueDeleted { session_id, .. }
            | Self::DialogTurnQueueDispatching { session_id, .. }
            | Self::DialogTurnQueuePaused { session_id, .. }
            | Self::DialogTurnQueueResumed { session_id, .. }
            | Self::DialogTurnGuidanceRequested { session_id, .. }
            | Self::DialogTurnGuidanceApplied { session_id, .. }
            | Self::DialogTurnGuidanceFailed { session_id, .. }
            | Self::TokenUsageUpdated { session_id, .. }
            | Self::ContextBudgetUpdated { session_id, .. }
            | Self::ContextCompressionStarted { session_id, .. }
            | Self::ContextCompressionCompleted { session_id, .. }
            | Self::ContextCompressionFailed { session_id, .. }
            | Self::DialogTurnCancelled { session_id, .. }
            | Self::DialogTurnFailed { session_id, .. }
            | Self::ModelRoundStarted { session_id, .. }
            | Self::TextChunk { session_id, .. }
            | Self::ThinkingChunk { session_id, .. }
            | Self::ModelRoundCompleted { session_id, .. }
            | Self::ToolEvent { session_id, .. }
            | Self::SessionModelAutoMigrated { session_id, .. } => Some(session_id),
            Self::SystemError { session_id, .. } => session_id.as_deref(),
        }
    }

    /// Get the default priority
    pub fn default_priority(&self) -> AgenticEventPriority {
        match self {
            Self::SystemError { .. }
            | Self::DialogTurnFailed { .. }
            | Self::DialogTurnCancelled { .. } => AgenticEventPriority::Critical,

            Self::SessionStateChanged { .. }
            | Self::SessionTitleGenerated { .. }
            | Self::SessionModelAutoMigrated { .. }
            | Self::ContextCompressionFailed { .. } => AgenticEventPriority::High,

            Self::ImageAnalysisStarted { .. }
            | Self::ImageAnalysisCompleted { .. }
            | Self::TextChunk { .. }
            | Self::ThinkingChunk { .. }
            | Self::ModelRoundStarted { .. }
            | Self::ModelRoundCompleted { .. }
            | Self::DialogTurnQueued { .. }
            | Self::DialogTurnQueueUpdated { .. }
            | Self::DialogTurnQueueDeleted { .. }
            | Self::DialogTurnQueueDispatching { .. }
            | Self::DialogTurnQueuePaused { .. }
            | Self::DialogTurnQueueResumed { .. }
            | Self::DialogTurnGuidanceRequested { .. }
            | Self::DialogTurnGuidanceApplied { .. }
            | Self::DialogTurnGuidanceFailed { .. }
            | Self::TokenUsageUpdated { .. }
            | Self::ContextBudgetUpdated { .. }
            | Self::DialogTurnCompleted { .. }
            | Self::ContextCompressionStarted { .. }
            | Self::ContextCompressionCompleted { .. } => AgenticEventPriority::Normal,

            Self::ToolEvent { tool_event, .. } => tool_event.default_priority(),

            _ => AgenticEventPriority::Low,
        }
    }

    /// Classify event delivery semantics for downstream transports.
    pub fn delivery_class(&self) -> AgenticEventDeliveryClass {
        match self {
            Self::SessionCreated { .. }
            | Self::SessionStateChanged { .. }
            | Self::SessionDeleted { .. }
            | Self::SessionTitleGenerated { .. }
            | Self::TokenUsageUpdated { .. }
            | Self::ContextBudgetUpdated { .. }
            | Self::SystemError { .. }
            | Self::SessionModelAutoMigrated { .. } => AgenticEventDeliveryClass::PriorityControl,

            Self::ImageAnalysisStarted { .. }
            | Self::ImageAnalysisCompleted { .. }
            | Self::DialogTurnStarted { .. }
            | Self::DialogTurnCompleted { .. }
            | Self::DialogTurnCancelled { .. }
            | Self::DialogTurnFailed { .. }
            | Self::DialogTurnQueued { .. }
            | Self::DialogTurnQueueUpdated { .. }
            | Self::DialogTurnQueueDeleted { .. }
            | Self::DialogTurnQueueDispatching { .. }
            | Self::DialogTurnQueuePaused { .. }
            | Self::DialogTurnQueueResumed { .. }
            | Self::DialogTurnGuidanceRequested { .. }
            | Self::DialogTurnGuidanceApplied { .. }
            | Self::DialogTurnGuidanceFailed { .. }
            | Self::ContextCompressionStarted { .. }
            | Self::ContextCompressionCompleted { .. }
            | Self::ContextCompressionFailed { .. }
            | Self::ModelRoundStarted { .. }
            | Self::ModelRoundCompleted { .. }
            | Self::TextChunk { .. }
            | Self::ThinkingChunk { .. }
            | Self::ToolEvent { .. } => AgenticEventDeliveryClass::OrderedTimeline,
        }
    }
}

impl ToolEventData {
    /// Get the default priority for a specific tool event variant.
    pub fn default_priority(&self) -> AgenticEventPriority {
        match self {
            Self::Cancelled { .. } => AgenticEventPriority::Critical,

            Self::Started { .. }
            | Self::Completed { .. }
            | Self::Failed { .. }
            | Self::ConfirmationNeeded { .. } => AgenticEventPriority::High,

            Self::EarlyDetected { .. }
            | Self::ParamsPartial { .. }
            | Self::Queued { .. }
            | Self::Waiting { .. }
            | Self::Progress { .. }
            | Self::Streaming { .. }
            | Self::StreamChunk { .. }
            | Self::Confirmed { .. }
            | Self::Rejected { .. } => AgenticEventPriority::Normal,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AgenticEvent, AgenticEventDeliveryClass, AgenticEventEnvelope, AgenticEventPriority,
        SessionSurfaceMode,
    };
    use std::cmp::Reverse;
    use std::collections::BinaryHeap;

    #[test]
    fn envelope_orders_by_priority_then_sequence() {
        let mut heap = BinaryHeap::new();
        heap.push(Reverse(AgenticEventEnvelope::new(
            AgenticEvent::TextChunk {
                session_id: "s".into(),
                turn_id: "t".into(),
                round_id: "r".into(),
                text: "second".into(),
                subagent_parent_info: None,
                surface_mode: SessionSurfaceMode::UserVisible,
            },
            AgenticEventPriority::Normal,
            2,
        )));
        heap.push(Reverse(AgenticEventEnvelope::new(
            AgenticEvent::SystemError {
                session_id: None,
                error: "boom".into(),
                recoverable: false,
            },
            AgenticEventPriority::Critical,
            99,
        )));
        heap.push(Reverse(AgenticEventEnvelope::new(
            AgenticEvent::TextChunk {
                session_id: "s".into(),
                turn_id: "t".into(),
                round_id: "r".into(),
                text: "first".into(),
                subagent_parent_info: None,
                surface_mode: SessionSurfaceMode::UserVisible,
            },
            AgenticEventPriority::Normal,
            1,
        )));

        let first = heap.pop().expect("critical event").0;
        let second = heap.pop().expect("first normal event").0;
        let third = heap.pop().expect("second normal event").0;

        assert!(matches!(first.event, AgenticEvent::SystemError { .. }));
        assert_eq!(second.sequence, 1);
        assert_eq!(third.sequence, 2);
    }

    #[test]
    fn delivery_class_keeps_streaming_events_ordered() {
        let text_chunk = AgenticEvent::TextChunk {
            session_id: "s".into(),
            turn_id: "t".into(),
            round_id: "r".into(),
            text: "hello".into(),
            subagent_parent_info: None,
            surface_mode: SessionSurfaceMode::UserVisible,
        };
        let session_created = AgenticEvent::SessionCreated {
            session_id: "s".into(),
            session_name: "name".into(),
            agent_type: "agent".into(),
            workspace_path: None,
        };

        assert_eq!(
            text_chunk.delivery_class(),
            AgenticEventDeliveryClass::OrderedTimeline
        );
        assert_eq!(
            session_created.delivery_class(),
            AgenticEventDeliveryClass::PriorityControl
        );
    }
}
