use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DailyLetterScope {
    Workspace,
    AgenticOs,
}

impl Default for DailyLetterScope {
    fn default() -> Self {
        Self::AgenticOs
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DailyLetterRecordStatus {
    Ready,
    InsufficientContext,
    NeedsReceipt,
    Sealed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DailyLetterReceiptStatus {
    Pending,
    Accepted,
    Edited,
    Dismissed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DailyLetterSourceFragmentType {
    DailyReport,
    SessionSummary,
    Event,
    Work,
    Command,
    Git,
    Memory,
    Explicit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterWorkspaceRef {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterSourceFragment {
    pub id: String,
    #[serde(rename = "type")]
    pub fragment_type: DailyLetterSourceFragmentType,
    pub title: String,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    #[serde(default)]
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterSourceStats {
    #[serde(default)]
    pub daily_report_count: usize,
    pub session_summary_count: usize,
    #[serde(default)]
    pub event_count: usize,
    pub work_count: usize,
    #[serde(default)]
    pub command_count: usize,
    pub memory_file_count: usize,
    pub git_signal_count: usize,
    #[serde(default)]
    pub explicit_count: usize,
    pub fragment_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterContextPacket {
    pub date: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coverage_start_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coverage_start_at_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coverage_end_at_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_letter_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_letter_date: Option<String>,
    pub locale: String,
    pub scope: DailyLetterScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<DailyLetterWorkspaceRef>,
    pub source_stats: DailyLetterSourceStats,
    pub fragments: Vec<DailyLetterSourceFragment>,
    #[serde(default)]
    pub memory_context: Vec<DailyLetterSourceFragment>,
    #[serde(default)]
    pub user_preferences: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DailyLetterAgentResult {
    Letter,
    InsufficientContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterAgentPreview {
    pub title: String,
    pub one_line: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterAgentReceiptCandidate {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default)]
    pub source_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterAgentAppOpportunity {
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub source_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterAgentOutput {
    pub result: DailyLetterAgentResult,
    pub preview: DailyLetterAgentPreview,
    pub body_markdown: String,
    #[serde(default)]
    pub receipt_candidates: Vec<DailyLetterAgentReceiptCandidate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_opportunity: Option<DailyLetterAgentAppOpportunity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterPreview {
    pub title: String,
    pub one_line: String,
    pub receipt_count: usize,
    pub app_idea_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterReceiptCandidate {
    pub id: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default)]
    pub source_ids: Vec<String>,
    pub status: DailyLetterReceiptStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub final_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory_journal_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterAppOpportunity {
    pub id: String,
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub source_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterRecord {
    pub id: String,
    pub date: String,
    pub scope: DailyLetterScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<DailyLetterWorkspaceRef>,
    pub status: DailyLetterRecordStatus,
    pub preview: DailyLetterPreview,
    pub body_markdown: String,
    #[serde(default)]
    pub receipt_candidates: Vec<DailyLetterReceiptCandidate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_opportunity: Option<DailyLetterAppOpportunity>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterListRequest {
    #[serde(default)]
    pub scope: Option<DailyLetterScope>,
    #[serde(default)]
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterGetRequest {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub scope: Option<DailyLetterScope>,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterGenerateRequest {
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub scope: Option<DailyLetterScope>,
    #[serde(default)]
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DailyLetterReceiptAction {
    Accept,
    Edit,
    Dismiss,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterReceiptDecision {
    pub candidate_id: String,
    pub action: DailyLetterReceiptAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub final_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterApplyReceiptsRequest {
    pub record_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub decisions: Vec<DailyLetterReceiptDecision>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterSealRequest {
    pub record_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DailyLetterAttemptStatus {
    Running,
    Ok,
    Error,
    Cancelled,
    SkippedNoSources,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DailyLetterTrigger {
    Auto,
    Manual,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DailyLetterState {
    pub last_completed_date: Option<String>,
    pub active_date: Option<String>,
    pub active_record_id: Option<String>,
    pub last_attempted_date: Option<String>,
    pub last_attempt_started_at_ms: Option<i64>,
    pub last_attempt_finished_at_ms: Option<i64>,
    pub last_attempt_status: Option<DailyLetterAttemptStatus>,
    pub last_attempt_trigger: Option<DailyLetterTrigger>,
    pub last_error: Option<String>,
    pub next_auto_run_not_before_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLetterRunSummary {
    pub started: bool,
    pub trigger: DailyLetterTrigger,
    pub date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub record: Option<DailyLetterRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}
