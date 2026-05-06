use crate::service::prompt_history::PromptHistoryEvent;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptCommitTracePrompt {
    pub prompt_history_event_id: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub created_at: String,
    pub source: String,
    pub agent_type: String,
    pub model: Option<String>,
    pub prompt_hash: String,
    pub prompt_summary: String,
    pub prompt_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptReviewTrace {
    pub schema_version: u32,
    pub trace_id: String,
    pub commit_hash: String,
    pub short_hash: String,
    pub commit_subject: String,
    pub generated_at: String,
    pub redacted: bool,
    pub prompts: Vec<PromptCommitTracePrompt>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptCommitTraceSummary {
    pub trace_id: String,
    pub trace_path: String,
    pub prompt_count: usize,
    pub source: PromptCommitLinkSource,
    pub confidence: PromptCommitLinkConfidence,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptCommitLinkSource {
    HeadMarker,
    TimeWindow,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptCommitLinkConfidence {
    Direct,
    Inferred,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPromptHistoryCommit {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub subject: String,
    pub trace: Option<PromptCommitTraceSummary>,
    pub prompts: Vec<PromptHistoryEvent>,
}
