//! Goal-mode data model.
//!
//! The goal lifecycle is owned by a deterministic loop. After every owner turn
//! the loop forks a **judge** that inherits the session transcript, may inspect
//! the workspace with read/verify tools, and returns a single [`GoalVerdict`].
//! There is no separate "evidence" model: the work *is* the conversation plus
//! whatever the judge confirms on demand.

use serde::{Deserialize, Serialize};

pub const GOAL_EXTRACTION_SCHEMA_VERSION: &str = "goal.extraction.v2";
pub const GOAL_JUDGE_SCHEMA_VERSION: &str = "goal.judge.v2";

fn default_true() -> bool {
    true
}

fn default_risk_level() -> GoalRiskLevel {
    GoalRiskLevel::Medium
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    /// The loop owns the goal and will judge after each owner turn.
    Active,
    /// A judge fork is currently running for this goal.
    Judging,
    /// The loop is waiting for the user (a question or a confirmation).
    WaitingUser,
    /// Paused by the user.
    Paused,
    /// Stuck: repeated no-progress or an explicit blocker.
    Blocked,
    /// Continuation budget exhausted.
    BudgetLimited,
    /// Judge returned `pass`.
    Completed,
    /// Cleared by the user.
    Cancelled,
}

impl GoalStatus {
    /// Whether the loop should drive (judge / continue) this goal.
    pub fn is_loop_active(&self) -> bool {
        matches!(self, Self::Active)
    }

    /// Whether the durable goal authorization still exists and the driver is
    /// allowed to reconcile an interrupted or idle attempt back into work.
    pub fn is_driver_authorized(&self) -> bool {
        matches!(self, Self::Active | Self::Judging)
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalRiskLevel {
    Low,
    Medium,
    High,
}

// ---------------------------------------------------------------------------
// Contract (lean: criteria + checks the judge enforces)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalCriterion {
    pub id: String,
    pub description: String,
    #[serde(default = "default_true")]
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalRequiredCheck {
    pub id: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalContract {
    pub raw_trigger: String,
    pub resolved_objective: String,
    #[serde(default)]
    pub success_criteria: Vec<GoalCriterion>,
    #[serde(default)]
    pub required_checks: Vec<GoalRequiredCheck>,
    #[serde(default)]
    pub non_goals: Vec<String>,
    #[serde(default)]
    pub constraints: Vec<String>,
    #[serde(default = "default_risk_level")]
    pub risk_level: GoalRiskLevel,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalContextSnapshot {
    #[serde(default)]
    pub frozen_context_markdown: String,
}

/// A remaining gap. Kept as an object (criterionId + description) so the UI can
/// render it uniformly; the judge emits plain strings that the loop wraps.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalGap {
    pub criterion_id: String,
    pub description: String,
}

impl GoalGap {
    pub fn from_text(text: impl Into<String>) -> Self {
        Self {
            criterion_id: "gap".to_string(),
            description: text.into(),
        }
    }
}

// ---------------------------------------------------------------------------
// Progress + budgets
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalProgress {
    #[serde(default)]
    pub notes: Vec<String>,
    #[serde(default)]
    pub remaining_gaps: Vec<GoalGap>,
    #[serde(default)]
    pub continuation_turns: u32,
    #[serde(default)]
    pub judge_runs: u32,
    #[serde(default)]
    pub no_progress_streak: u32,
    #[serde(default)]
    pub last_met_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger_turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_turn_id: Option<String>,
}

impl Default for GoalProgress {
    fn default() -> Self {
        Self {
            notes: Vec::new(),
            remaining_gaps: Vec::new(),
            continuation_turns: 0,
            judge_runs: 0,
            no_progress_streak: 0,
            last_met_count: 0,
            last_summary: None,
            trigger_turn_id: None,
            last_turn_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalBudgets {
    pub max_continuation_turns: u32,
    pub max_judge_runs: u32,
    pub max_no_progress_streak: u32,
}

impl Default for GoalBudgets {
    fn default() -> Self {
        Self {
            max_continuation_turns: 100,
            max_judge_runs: 40,
            max_no_progress_streak: 3,
        }
    }
}

// ---------------------------------------------------------------------------
// Durable driver state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalDriverPhase {
    Idle,
    Recovering,
    Judging,
    ContinuationQueued,
    OwnerTurnRunning,
}

impl Default for GoalDriverPhase {
    fn default() -> Self {
        Self::Idle
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalDriverState {
    #[serde(default)]
    pub phase: GoalDriverPhase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_turn_id: Option<String>,
    #[serde(default)]
    pub interrupted_attempts: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at_ms: Option<i64>,
}

// ---------------------------------------------------------------------------
// Fork run audit
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalRunAudit {
    pub runner_kind: String,
    pub enable_tools: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fork_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inherited_message_count: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_message_count: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parser_status: Option<String>,
}

impl GoalRunAudit {
    pub fn pending(runner_kind: impl Into<String>, enable_tools: bool) -> Self {
        Self {
            runner_kind: runner_kind.into(),
            enable_tools,
            fork_session_id: None,
            inherited_message_count: None,
            prompt_message_count: None,
            parser_status: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalIntentKind {
    ChatOnly,
    CreateGoal,
    UpdateGoal,
    ApplyGuidance,
    QueryGoal,
    ControlGoal,
    AskClarification,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalControlAction {
    Status,
    Pause,
    Resume,
    Clear,
    Review,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalIntentDecision {
    pub kind: GoalIntentKind,
    #[serde(default)]
    pub confidence: f32,
    #[serde(default)]
    pub raw_trigger: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_goal_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub control_action: Option<GoalControlAction>,
    #[serde(default)]
    pub reason_summary: String,
    #[serde(default)]
    pub clarification_questions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalContextResolution {
    pub resolved_objective: String,
    #[serde(default)]
    pub frozen_context_markdown: String,
    #[serde(default)]
    pub confidence: f32,
    #[serde(default)]
    pub ambiguity_questions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalExtractionResult {
    pub extraction_id: String,
    pub parent_session_id: String,
    pub trigger_turn_id: String,
    pub intent: GoalIntentDecision,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_resolution: Option<GoalContextResolution>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contract: Option<GoalContract>,
    #[serde(default)]
    pub confidence: f32,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalExtractionStatus {
    Queued,
    Running,
    Accepted,
    NeedsClarification,
    Rejected,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalEntryMetadata {
    pub source: String,
    pub has_goal_prefix: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalExtractionPayload {
    pub raw_input: String,
    pub entry: GoalEntryMetadata,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_goal: Option<GoalRecordSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalExtractionRequestMessage {
    pub extraction_id: String,
    pub instruction_version: String,
    pub fixed_instruction: String,
    pub payload: GoalExtractionPayload,
    pub output_schema: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalExtractionRun {
    pub extraction_id: String,
    pub parent_session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extraction_session_id: Option<String>,
    pub trigger_turn_id: String,
    pub raw_input: String,
    pub checkpoint_event_id: String,
    pub status: GoalExtractionStatus,
    pub request_message: GoalExtractionRequestMessage,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub final_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<GoalExtractionResult>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rejection_reason: Option<String>,
    pub audit: GoalRunAudit,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalExtractionSummary {
    pub extraction_id: String,
    pub status: GoalExtractionStatus,
    pub confidence: f32,
    pub intent: GoalIntentKind,
    #[serde(default)]
    pub warnings: Vec<String>,
    pub updated_at_ms: i64,
}

// ---------------------------------------------------------------------------
// Judge (per-turn verdict)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalVerdictState {
    /// The goal is done.
    Pass,
    /// Not done; keep working from the reported remaining gaps.
    Continue,
    /// The loop needs the user (a real decision/input).
    NeedsUser,
    /// Stuck; cannot make progress without intervention.
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalCriterionVerdict {
    pub id: String,
    #[serde(default)]
    pub met: bool,
    #[serde(default)]
    pub note: String,
}

/// The single structured object a judge fork must return.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalVerdict {
    pub state: GoalVerdictState,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub criteria: Vec<GoalCriterionVerdict>,
    #[serde(default)]
    pub remaining_gaps: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_question: Option<String>,
    #[serde(default)]
    pub confidence: f32,
}

impl GoalVerdict {
    pub fn met_count(&self) -> u32 {
        self.criteria.iter().filter(|c| c.met).count() as u32
    }

    pub fn gaps_as_objects(&self) -> Vec<GoalGap> {
        self.remaining_gaps
            .iter()
            .filter(|gap| !gap.trim().is_empty())
            .map(GoalGap::from_text)
            .collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalJudgeStatus {
    Queued,
    Running,
    Decided,
    Rejected,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalJudgeTrigger {
    TurnCompleted,
    UserReview,
    Resume,
    UserEdit,
    Recovery,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalJudgeRequestMessage {
    pub judge_id: String,
    pub instruction_version: String,
    pub fixed_instruction: String,
    pub objective: String,
    #[serde(default)]
    pub criteria: Vec<GoalCriterion>,
    #[serde(default)]
    pub required_checks: Vec<GoalRequiredCheck>,
    #[serde(default)]
    pub constraints: Vec<String>,
    #[serde(default)]
    pub remaining_gaps: Vec<GoalGap>,
    pub output_schema: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalJudgeRun {
    pub judge_id: String,
    pub parent_session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub judge_session_id: Option<String>,
    pub goal_id: String,
    pub goal_revision: u64,
    pub turn_id: String,
    pub trigger: GoalJudgeTrigger,
    pub status: GoalJudgeStatus,
    pub request_message: GoalJudgeRequestMessage,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub final_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verdict: Option<GoalVerdict>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rejection_reason: Option<String>,
    pub audit: GoalRunAudit,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalJudgmentSummary {
    pub judge_id: String,
    pub state: GoalVerdictState,
    pub summary: String,
    #[serde(default)]
    pub remaining_gaps: Vec<GoalGap>,
    pub confidence: f32,
    pub judged_at_ms: i64,
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalRecordSummary {
    pub goal_id: String,
    pub revision: u64,
    pub status: GoalStatus,
    pub objective: String,
    #[serde(default)]
    pub remaining_gaps: Vec<GoalGap>,
}

impl From<&GoalRecord> for GoalRecordSummary {
    fn from(record: &GoalRecord) -> Self {
        Self {
            goal_id: record.goal_id.clone(),
            revision: record.revision,
            status: record.status.clone(),
            objective: record.contract.resolved_objective.clone(),
            remaining_gaps: record.progress.remaining_gaps.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalRecord {
    pub goal_id: String,
    pub session_id: String,
    pub revision: u64,
    pub status: GoalStatus,
    pub contract: GoalContract,
    pub context: GoalContextSnapshot,
    pub progress: GoalProgress,
    #[serde(default)]
    pub driver: GoalDriverState,
    pub budgets: GoalBudgets,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_extraction: Option<GoalExtractionSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_judgment: Option<GoalJudgmentSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_user_question: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

// ---------------------------------------------------------------------------
// API request/response + tool input
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalUserRequest {
    pub session_id: String,
    pub workspace_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default)]
    pub skip_initial_continuation: bool,
    pub raw_input: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalControlRequest {
    pub session_id: String,
    pub workspace_path: String,
    pub action: GoalControlAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_goal_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalEditRequest {
    pub session_id: String,
    pub workspace_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
    pub edited_objective: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_goal_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalStatusRequest {
    pub session_id: String,
    pub workspace_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalResponse {
    pub accepted: bool,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal: Option<GoalRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extraction: Option<GoalExtractionRun>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub judge: Option<GoalJudgeRun>,
}

/// Advisory tool surface for the executing agent. Completion is never claimed
/// here — the loop decides. The agent can read the goal, drop a progress note,
/// or signal that it is blocked.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalToolInput {
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

// ---------------------------------------------------------------------------
// Event log (timestamps are injected centrally by the store)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum GoalStoreEvent {
    ExtractionRunRecorded {
        extraction_id: String,
        session_id: String,
        status: GoalExtractionStatus,
        audit: GoalRunAudit,
    },
    Created {
        goal_id: String,
        revision: u64,
        objective: String,
        extraction_id: String,
    },
    Updated {
        goal_id: String,
        revision: u64,
        previous_objective: String,
        objective: String,
        extraction_id: String,
    },
    StatusChanged {
        goal_id: String,
        revision: u64,
        status: GoalStatus,
        reason: String,
    },
    Progress {
        goal_id: String,
        revision: u64,
        note: String,
    },
    BlockerClaimed {
        goal_id: String,
        revision: u64,
        summary: String,
    },
    JudgeRunRecorded {
        judge_id: String,
        goal_id: String,
        revision: u64,
        status: GoalJudgeStatus,
        audit: GoalRunAudit,
    },
    JudgmentRecorded {
        goal_id: String,
        revision: u64,
        summary: GoalJudgmentSummary,
    },
    LoopDecision {
        goal_id: String,
        revision: u64,
        decision: String,
        reason: String,
    },
    DriverReconciled {
        goal_id: String,
        revision: u64,
        phase: GoalDriverPhase,
        reason: String,
    },
    ContinuationQueued {
        goal_id: String,
        revision: u64,
        turn_id: String,
    },
}
