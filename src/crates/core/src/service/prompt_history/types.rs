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
    pub git_branch_at_created: Option<String>,
    pub forked_from_event_id: Option<String>,
    pub model_id: Option<String>,
    pub image_context_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supersedes: Option<String>,
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