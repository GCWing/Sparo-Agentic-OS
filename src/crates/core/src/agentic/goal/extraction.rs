use super::fork_message::GoalForkMessageBuilder;
use super::model::*;
use crate::agentic::coordination::ConversationCoordinator;
use crate::agentic::core::Message;
use crate::agentic::fork_agent::ForkAgentExecutionRequest;
use crate::agentic::tools::ToolRuntimeRestrictions;
use crate::error::CoreResult;
use async_trait::async_trait;
use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

/// Tools the executing agent may use during execution but which the judge must
/// not (the judge is a read-only reviewer that may also run verification
/// commands). Mutation + orchestration tools are denied.
const JUDGE_DENIED_TOOLS: &[&str] = &["Write", "Edit", "Delete", "Goal", "Task", "TodoWrite"];

/// Bound on judge tool turns: enough to read a few files / run a check, then
/// emit the verdict.
const JUDGE_MAX_TURNS: usize = 6;

#[derive(Debug, Clone)]
pub struct GoalExtractionRunRequest {
    pub workspace_path: String,
    pub agent_type: Option<String>,
    pub run: GoalExtractionRun,
}

#[derive(Debug, Clone)]
pub struct GoalExtractionRunOutput {
    pub final_text: String,
    pub audit: GoalRunAudit,
}

#[derive(Debug, Clone)]
pub struct GoalJudgeRunRequest {
    pub workspace_path: String,
    pub agent_type: Option<String>,
    pub run: GoalJudgeRun,
}

#[derive(Debug, Clone)]
pub struct GoalJudgeRunOutput {
    pub final_text: String,
    pub audit: GoalRunAudit,
}

#[async_trait]
pub trait GoalForkRunner: Send + Sync {
    async fn run_extraction(
        &self,
        request: GoalExtractionRunRequest,
    ) -> CoreResult<GoalExtractionRunOutput>;

    async fn run_judge(&self, request: GoalJudgeRunRequest) -> CoreResult<GoalJudgeRunOutput>;
}

fn judge_tool_restrictions() -> ToolRuntimeRestrictions {
    ToolRuntimeRestrictions {
        denied_tool_names: JUDGE_DENIED_TOOLS
            .iter()
            .map(|name| name.to_string())
            .collect::<BTreeSet<_>>(),
        ..ToolRuntimeRestrictions::default()
    }
}

pub struct CoordinatorGoalForkRunner {
    coordinator: Arc<ConversationCoordinator>,
}

impl CoordinatorGoalForkRunner {
    pub fn new(coordinator: Arc<ConversationCoordinator>) -> Self {
        Self { coordinator }
    }
}

#[async_trait]
impl GoalForkRunner for CoordinatorGoalForkRunner {
    async fn run_extraction(
        &self,
        request: GoalExtractionRunRequest,
    ) -> CoreResult<GoalExtractionRunOutput> {
        let snapshot = self
            .coordinator
            .capture_fork_agent_context_snapshot(&request.run.parent_session_id)
            .await?;
        let agent_type = request
            .agent_type
            .clone()
            .unwrap_or_else(|| snapshot.parent_agent_type.clone());
        let prompt =
            GoalForkMessageBuilder::render_extraction_message(&request.run.request_message);
        let mut context = HashMap::new();
        context.insert("goal_fork_kind".to_string(), "extraction".to_string());
        let result = self
            .coordinator
            .execute_fork_agent(
                ForkAgentExecutionRequest {
                    snapshot,
                    agent_type,
                    description: "Goal extraction".to_string(),
                    prompt_messages: vec![Message::user(prompt)],
                    context,
                    runtime_tool_restrictions: ToolRuntimeRestrictions::default(),
                    app_builder: None,
                    enable_tools_override: Some(false),
                    max_turns: Some(1),
                },
                None,
            )
            .await?;
        let mut audit = GoalRunAudit::pending("coordinator_fork", false);
        audit.fork_session_id = Some(result.session_id);
        audit.inherited_message_count = Some(result.inherited_message_count);
        audit.prompt_message_count = Some(result.prompt_message_count);
        Ok(GoalExtractionRunOutput {
            final_text: result.text,
            audit,
        })
    }

    async fn run_judge(&self, request: GoalJudgeRunRequest) -> CoreResult<GoalJudgeRunOutput> {
        let snapshot = self
            .coordinator
            .capture_fork_agent_context_snapshot(&request.run.parent_session_id)
            .await?;
        let agent_type = request
            .agent_type
            .clone()
            .unwrap_or_else(|| snapshot.parent_agent_type.clone());
        let prompt = GoalForkMessageBuilder::render_judge_message(&request.run.request_message);
        let mut context = HashMap::new();
        context.insert("goal_fork_kind".to_string(), "judge".to_string());
        let result = self
            .coordinator
            .execute_fork_agent(
                ForkAgentExecutionRequest {
                    snapshot,
                    agent_type,
                    description: "Goal judge".to_string(),
                    prompt_messages: vec![Message::user(prompt)],
                    context,
                    runtime_tool_restrictions: judge_tool_restrictions(),
                    app_builder: None,
                    enable_tools_override: Some(true),
                    max_turns: Some(JUDGE_MAX_TURNS),
                },
                None,
            )
            .await?;
        let mut audit = GoalRunAudit::pending("coordinator_fork", true);
        audit.fork_session_id = Some(result.session_id);
        audit.inherited_message_count = Some(result.inherited_message_count);
        audit.prompt_message_count = Some(result.prompt_message_count);
        Ok(GoalJudgeRunOutput {
            final_text: result.text,
            audit,
        })
    }
}

/// Deterministic runner for tests/e2e. Reuses the production schemas so the
/// validation and store paths stay identical; only the model call is replaced.
pub struct DeterministicGoalForkRunner;

#[async_trait]
impl GoalForkRunner for DeterministicGoalForkRunner {
    async fn run_extraction(
        &self,
        request: GoalExtractionRunRequest,
    ) -> CoreResult<GoalExtractionRunOutput> {
        let result = fallback_extraction_result(
            &request.run,
            "Deterministic extraction for tests/e2e profile.",
            Vec::new(),
        );
        Ok(GoalExtractionRunOutput {
            final_text: serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string()),
            audit: GoalRunAudit::pending("deterministic", false),
        })
    }

    async fn run_judge(&self, request: GoalJudgeRunRequest) -> CoreResult<GoalJudgeRunOutput> {
        let verdict = deterministic_verdict(&request.run);
        Ok(GoalJudgeRunOutput {
            final_text: serde_json::to_string_pretty(&verdict).unwrap_or_else(|_| "{}".to_string()),
            audit: GoalRunAudit::pending("deterministic", false),
        })
    }
}

pub fn fallback_extraction_result(
    run: &GoalExtractionRun,
    reason_summary: impl Into<String>,
    warnings: Vec<String>,
) -> GoalExtractionResult {
    let raw = run.request_message.payload.raw_input.trim();
    let body = if run.request_message.payload.entry.has_goal_prefix {
        raw.strip_prefix("/goal")
            .or_else(|| raw.strip_prefix("/GOAL"))
            .unwrap_or(raw)
            .trim()
    } else {
        raw
    };
    let lower = body.to_ascii_lowercase();

    // Explicit slash-command argument parsing (a CLI affordance, not semantic
    // routing). Free-form bodies become a create-goal request.
    let (kind, control_action) = if run.request_message.payload.entry.has_goal_prefix {
        match lower.as_str() {
            "" | "status" => (GoalIntentKind::QueryGoal, Some(GoalControlAction::Status)),
            "pause" => (GoalIntentKind::ControlGoal, Some(GoalControlAction::Pause)),
            "resume" => (GoalIntentKind::ControlGoal, Some(GoalControlAction::Resume)),
            "clear" | "cancel" => (GoalIntentKind::ControlGoal, Some(GoalControlAction::Clear)),
            "review" => (GoalIntentKind::ControlGoal, Some(GoalControlAction::Review)),
            _ => (GoalIntentKind::CreateGoal, None),
        }
    } else {
        (GoalIntentKind::ChatOnly, None)
    };

    let contract = matches!(
        kind,
        GoalIntentKind::CreateGoal | GoalIntentKind::UpdateGoal | GoalIntentKind::ApplyGuidance
    )
    .then(|| deterministic_contract(&run.raw_input, body));
    let context_resolution = contract.as_ref().map(|contract| GoalContextResolution {
        resolved_objective: contract.resolved_objective.clone(),
        frozen_context_markdown: format!("Raw trigger:\n\n{}", run.raw_input),
        confidence: 0.86,
        ambiguity_questions: Vec::new(),
    });

    GoalExtractionResult {
        extraction_id: run.extraction_id.clone(),
        parent_session_id: run.parent_session_id.clone(),
        trigger_turn_id: run.trigger_turn_id.clone(),
        intent: GoalIntentDecision {
            kind,
            confidence: 0.9,
            raw_trigger: run.raw_input.clone(),
            target_goal_id: run
                .request_message
                .payload
                .active_goal
                .as_ref()
                .map(|goal| goal.goal_id.clone()),
            control_action,
            reason_summary: reason_summary.into(),
            clarification_questions: Vec::new(),
        },
        context_resolution,
        contract,
        confidence: 0.9,
        warnings,
    }
}

fn deterministic_contract(raw_trigger: &str, body: &str) -> GoalContract {
    let objective = body.trim();
    let objective = if objective.is_empty() {
        raw_trigger.trim()
    } else {
        objective
    };
    GoalContract {
        raw_trigger: raw_trigger.to_string(),
        resolved_objective: objective.to_string(),
        success_criteria: vec![GoalCriterion {
            id: "criterion-1".to_string(),
            description:
                "Deliver the requested objective and verify the final user-visible result."
                    .to_string(),
            required: true,
        }],
        required_checks: Vec::new(),
        non_goals: Vec::new(),
        constraints: vec![
            "Continue in the same session until the goal passes judging or needs the user."
                .to_string(),
        ],
        risk_level: GoalRiskLevel::Medium,
    }
}

/// Deterministic verdict for the e2e profile. The goal passes when its objective
/// contains the sentinel `e2e-pass`; otherwise it keeps continuing with a gap.
fn deterministic_verdict(run: &GoalJudgeRun) -> GoalVerdict {
    let objective = run.request_message.objective.to_ascii_lowercase();
    let pass = objective.contains("e2e-pass");
    if pass {
        GoalVerdict {
            state: GoalVerdictState::Pass,
            summary: "Deterministic judge: objective sentinel reached.".to_string(),
            criteria: run
                .request_message
                .criteria
                .iter()
                .map(|criterion| GoalCriterionVerdict {
                    id: criterion.id.clone(),
                    met: true,
                    note: "Satisfied (deterministic e2e).".to_string(),
                })
                .collect(),
            remaining_gaps: Vec::new(),
            user_question: None,
            confidence: 0.95,
        }
    } else {
        GoalVerdict {
            state: GoalVerdictState::Continue,
            summary: "Deterministic judge: keep working (e2e).".to_string(),
            criteria: run
                .request_message
                .criteria
                .iter()
                .map(|criterion| GoalCriterionVerdict {
                    id: criterion.id.clone(),
                    met: false,
                    note: "Not yet confirmed (deterministic e2e).".to_string(),
                })
                .collect(),
            remaining_gaps: vec![
                "Deterministic judge requires the e2e-pass sentinel in the objective.".to_string(),
            ],
            user_question: None,
            confidence: 0.9,
        }
    }
}

pub fn test_e2e_runner_enabled() -> bool {
    std::env::var("SPARO_GOAL_DETERMINISTIC_FORK")
        .ok()
        .is_some_and(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        || std::env::var("SPARO_E2E_APP_MODE").is_ok()
        || std::env::var("SPARO_WEBDRIVER_PORT").is_ok()
}
