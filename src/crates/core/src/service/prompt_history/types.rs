use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptHistoryEvent {
    pub id: String,
    pub session_id: String,
    pub session_name: Option<String>,
    pub turn_id: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    pub source: PromptHistorySource,
    pub text: String,
    pub prompt_hash: String,
    pub agent_type: String,
    pub pinned: bool,
    pub after_commit_hash: Option<String>,
    /// First line of the commit message for after_commit_hash.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after_commit_subject: Option<String>,
    pub git_branch_at_created: Option<String>,
    pub forked_from_event_id: Option<String>,
    pub model_id: Option<String>,
    pub image_context_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supersedes: Option<String>,
    // --- Response-side fields (populated after turn completion) ---
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_total_rounds: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_total_tools: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_total_tokens: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_input_tokens: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_output_tokens: Option<usize>,
    /// Truncated final AI response text (first ~500 chars).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_summary: Option<String>,
    /// Failure reason when response_status is "failed".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_error: Option<String>,
    /// JSON array of `[{file, added, removed}]` representing files changed
    /// (snapshot-based, derived from the file operation history).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_modified_files: Option<String>,
    /// Lines added.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_lines_added: Option<usize>,
    /// Lines removed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_lines_removed: Option<usize>,
    /// JSON array of `[{toolName, durationMs, status, error?}]` summarising tools
    /// executed during this turn.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_tool_summary: Option<String>,
    /// IDs of preceding prompt history events in the same session.
    /// Serialised as `["prompt_...", ...]`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preceding_prompt_event_ids: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptHistorySource {
    ChatInput,
    Retry,
    Scheduled,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PromptHistoryQuery {
    pub session_id: Option<String>,
    pub agent_type: Option<String>,
    pub pinned: Option<bool>,
    pub query: Option<String>,
    pub branch: Option<String>,
    pub prompt_hash: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptHistorySummary {
    pub total: usize,
    pub events: Vec<PromptHistoryEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptLineage {
    pub event: PromptHistoryEvent,
    pub ancestors: Vec<String>,
    pub descendants: Vec<String>,
    pub siblings: Vec<String>,
}

/// Request to update response-side fields on a prompt history event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptHistoryResponseUpdate {
    pub status: String,
    pub total_rounds: Option<usize>,
    pub total_tools: Option<usize>,
    pub duration_ms: Option<u64>,
    pub total_tokens: Option<usize>,
    pub input_tokens: Option<usize>,
    pub output_tokens: Option<usize>,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub modified_files: Option<String>,
    pub lines_added: Option<usize>,
    pub lines_removed: Option<usize>,
    pub after_commit_subject: Option<String>,
    pub tool_summary: Option<String>,
    pub preceding_event_ids: Option<String>,
}