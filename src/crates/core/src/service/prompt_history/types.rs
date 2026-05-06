use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptHistoryEvent {
    pub id: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub workspace_path: String,
    pub created_at: String,
    pub source: PromptHistorySource,
    pub text: String,
    pub original_text: Option<String>,
    pub prompt_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_commit_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_branch_at_created: Option<String>,
    pub agent_type: String,
    pub pinned: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<PromptHistoryContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptHistoryContext {
    pub trigger_source: String,
    pub session: PromptHistorySessionSnapshot,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<PromptHistoryModelSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub global_ai: Option<PromptHistoryGlobalAiSnapshot>,
    pub runtime: PromptHistoryRuntimeSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptHistorySessionSnapshot {
    pub session_name: Option<String>,
    pub session_kind: Option<String>,
    pub workspace_path: Option<String>,
    pub remote_connection_id: Option<String>,
    pub remote_ssh_host: Option<String>,
    pub storage_scope: Option<String>,
    pub model_id: Option<String>,
    pub max_context_tokens: usize,
    pub auto_compact: bool,
    pub enable_tools: bool,
    pub safe_mode: bool,
    pub max_turns: usize,
    pub enable_context_compression: bool,
    pub compression_threshold: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptHistoryModelSnapshot {
    pub requested_model_id: Option<String>,
    pub resolved_model_id: Option<String>,
    pub name: Option<String>,
    pub provider: Option<String>,
    pub model_name: Option<String>,
    pub base_url: Option<String>,
    pub request_url: Option<String>,
    pub enabled: Option<bool>,
    pub context_window: Option<u32>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub category: Option<String>,
    pub capabilities: Vec<String>,
    pub reasoning_mode: Option<String>,
    pub reasoning_effort: Option<String>,
    pub thinking_budget_tokens: Option<u32>,
    pub auth_type: Option<String>,
    pub inline_think_in_text: Option<bool>,
    pub custom_headers_mode: Option<String>,
    pub has_custom_headers: bool,
    pub custom_request_body_mode: Option<String>,
    pub has_custom_request_body: bool,
    pub skip_ssl_verify: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptHistoryGlobalAiSnapshot {
    pub default_primary_model_id: Option<String>,
    pub default_fast_model_id: Option<String>,
    pub agent_model_id: Option<String>,
    pub stream_idle_timeout_secs: Option<u64>,
    pub tool_execution_timeout_secs: Option<u64>,
    pub tool_confirmation_timeout_secs: Option<u64>,
    pub skip_tool_confirmation: bool,
    pub proxy_enabled: bool,
    pub computer_use_enabled: bool,
    pub workspace_auto_memory_enabled: bool,
    pub global_auto_memory_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptHistoryRuntimeSnapshot {
    pub image_context_count: usize,
    pub persist_agent_type: Option<bool>,
    pub system_reminder_override_present: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptHistorySource {
    ChatInput,
    Retry,
    Scheduled,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptHistoryQuery {
    pub workspace_path: String,
    pub session_id: Option<String>,
    pub agent_type: Option<String>,
    pub pinned: Option<bool>,
    pub query: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptHistorySummary {
    pub total: usize,
    pub events: Vec<PromptHistoryEvent>,
}
