use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptValueTier {
    Excellent,
    High,
    Potential,
    Context,
    Normal,
    Risk,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptValueConfidence {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptLlmAssessmentStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptValueSignalKind {
    PromptCreated,
    TurnCompleted,
    TurnFailed,
    TurnCancelled,
    Retry,
    SavedAsAsset,
    AssetUsed,
    UserPinned,
    UserFeedback,
    ToolSucceeded,
    ToolFailed,
    Rollback,
    CommitWindow,
    StructuredPrompt,
    CorrectionPrompt,
    ImageContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptValueSignal {
    pub id: String,
    pub prompt_history_event_id: Option<String>,
    pub prompt_hash: Option<String>,
    pub session_id: Option<String>,
    pub turn_id: Option<String>,
    pub kind: PromptValueSignalKind,
    pub weight: i32,
    pub confidence: PromptValueConfidence,
    pub reason: String,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptValueSignalInput {
    pub prompt_history_event_id: Option<String>,
    pub prompt_hash: Option<String>,
    pub session_id: Option<String>,
    pub turn_id: Option<String>,
    pub kind: PromptValueSignalKind,
    pub weight: Option<i32>,
    pub confidence: Option<PromptValueConfidence>,
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptValueRecord {
    pub prompt_history_event_id: String,
    pub prompt_hash: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub score: u32,
    pub tier: PromptValueTier,
    pub confidence: PromptValueConfidence,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_assessment: Option<PromptLlmAssessment>,
    pub reuse_count: usize,
    pub reasons: Vec<String>,
    pub warnings: Vec<String>,
    pub signals: Vec<PromptValueSignal>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptLlmAssessment {
    pub prompt_history_event_id: String,
    pub prompt_hash: String,
    pub deterministic_score: u32,
    pub input_hash: String,
    pub status: PromptLlmAssessmentStatus,
    #[serde(default)]
    pub attempts: u32,
    pub requested_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_score: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<PromptValueConfidence>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub impact_summary: Option<String>,
    #[serde(default)]
    pub quality_findings: Vec<String>,
    #[serde(default)]
    pub risk_findings: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommended_action: Option<String>,
    #[serde(default)]
    pub suggested_tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_potential: Option<String>,
    #[serde(default)]
    pub rationale: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
