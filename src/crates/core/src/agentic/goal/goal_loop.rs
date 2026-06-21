//! The goal loop.
//!
//! After every owner turn the loop forks a tool-enabled **judge** that inherits
//! the session transcript and returns a single [`GoalVerdict`]. The loop is the
//! only component that decides completion, continuation, or escalation — the
//! executing agent never claims completion itself.

use super::extraction::GoalJudgeRunRequest;
use super::fork_message::GoalForkMessageBuilder;
use super::model::*;
use super::output_parser::GoalStructuredOutputParser;
use super::service::{now_ms, GoalService};
use super::steering::GoalReminderBuilder;
use super::validation::GoalValidationGate;
use crate::agentic::coordination::{
    DialogQueuePriority, DialogSubmissionPolicy, DialogSubmitOutcome, DialogTriggerSource,
};
use crate::util::errors::{BitFunError, BitFunResult};
use serde_json::json;
use std::path::Path;
use uuid::Uuid;

/// Number of judge attempts (initial + re-ask) before escalating to the user.
const JUDGE_PARSE_ATTEMPTS: u32 = 2;

impl GoalService {
    /// Entry point invoked from `DialogTurnCompleted` for user-visible turns.
    pub(super) async fn judge_after_turn(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> BitFunResult<()> {
        let _guard = self.lock_session(session_id).await;
        let Some(workspace_path) = self.session_workspace_path(session_id) else {
            return Ok(());
        };
        let workspace = Path::new(&workspace_path);
        let Some(mut record) = self.current(workspace, session_id).await? else {
            return Ok(());
        };
        if !record.status.is_loop_active() {
            return Ok(());
        }
        if !Self::record_applies_to_turn(&record, turn_id) {
            return Ok(());
        }
        if record.progress.last_turn_id.as_deref() == Some(turn_id) {
            // Already judged this turn.
            return Ok(());
        }
        record.progress.last_turn_id = Some(turn_id.to_string());
        self.run_judge_for_record(
            workspace,
            &workspace_path,
            session_id,
            record,
            None,
            GoalJudgeTrigger::TurnCompleted,
        )
        .await?;
        Ok(())
    }

    /// Run a judge fork for `record`, accept its verdict, and apply it. Assumes
    /// the per-session lock is already held by the caller.
    pub(super) async fn run_judge_for_record(
        &self,
        workspace_path: &Path,
        workspace_path_string: &str,
        session_id: &str,
        mut record: GoalRecord,
        agent_type: Option<&str>,
        trigger: GoalJudgeTrigger,
    ) -> BitFunResult<GoalResponse> {
        if record.progress.judge_runs >= record.budgets.max_judge_runs {
            record.status = GoalStatus::BudgetLimited;
            self.save_status(
                workspace_path,
                session_id,
                &mut record,
                "Goal judge budget reached",
            )
            .await?;
            return Ok(simple_response("Goal judge budget reached", record, None));
        }

        record.status = GoalStatus::Judging;
        record.progress.judge_runs += 1;
        self.save_status(
            workspace_path,
            session_id,
            &mut record,
            "Goal judging started",
        )
        .await?;

        let judge_id = format!("goal-judge-{}", Uuid::new_v4());
        let request_message = GoalForkMessageBuilder::judge_request(judge_id.clone(), &record);
        let now = now_ms();
        let mut run = GoalJudgeRun {
            judge_id,
            parent_session_id: session_id.to_string(),
            judge_session_id: None,
            goal_id: record.goal_id.clone(),
            goal_revision: record.revision,
            turn_id: record
                .progress
                .last_turn_id
                .clone()
                .unwrap_or_else(|| "review".to_string()),
            trigger,
            status: GoalJudgeStatus::Queued,
            request_message,
            final_text: None,
            verdict: None,
            rejection_reason: None,
            audit: GoalRunAudit::pending("pending", true),
            created_at_ms: now,
            updated_at_ms: now,
        };
        self.save_judge_run(workspace_path, session_id, &run)
            .await?;

        run.status = GoalJudgeStatus::Running;
        run.updated_at_ms = now_ms();
        self.save_judge_run(workspace_path, session_id, &run)
            .await?;

        let verdict = self
            .execute_judge_with_reask(workspace_path_string, agent_type, &record, &mut run)
            .await?;

        let Some(verdict) = verdict else {
            // Could not obtain a usable verdict after retries: hand back to the
            // user rather than silently stalling in `Judging`.
            run.status = GoalJudgeStatus::Rejected;
            run.updated_at_ms = now_ms();
            self.save_judge_run(workspace_path, session_id, &run)
                .await?;
            record.status = GoalStatus::WaitingUser;
            record.pending_user_question = Some(
                "The automatic goal judge could not produce a usable verdict. Please review the work and steer or clear the goal.".to_string(),
            );
            self.save_status(
                workspace_path,
                session_id,
                &mut record,
                "Goal judge produced no usable verdict",
            )
            .await?;
            return Ok(simple_response(
                run.rejection_reason
                    .clone()
                    .unwrap_or_else(|| "Goal judge produced no usable verdict".to_string())
                    .as_str(),
                record,
                Some(run),
            ));
        };

        run.status = GoalJudgeStatus::Decided;
        run.verdict = Some(verdict.clone());
        run.audit.parser_status = Some("accepted".to_string());
        run.updated_at_ms = now_ms();
        self.save_judge_run(workspace_path, session_id, &run)
            .await?;

        self.apply_verdict(
            workspace_path,
            workspace_path_string,
            session_id,
            record,
            &run,
            verdict,
            agent_type,
        )
        .await
    }

    /// Execute the judge fork, parsing tolerantly and re-asking once on a
    /// parse/consistency failure. Fork transport errors are treated as failed
    /// attempts (not propagated) so a flaky judge can never wedge the goal in
    /// `Judging`.
    async fn execute_judge_with_reask(
        &self,
        workspace_path_string: &str,
        agent_type: Option<&str>,
        record: &GoalRecord,
        run: &mut GoalJudgeRun,
    ) -> BitFunResult<Option<GoalVerdict>> {
        let mut last_error: Option<String> = None;
        for attempt in 0..JUDGE_PARSE_ATTEMPTS {
            let mut attempt_run = run.clone();
            if let Some(error) = &last_error {
                attempt_run.request_message.fixed_instruction = format!(
                    "{}\n\nIMPORTANT: your previous reply was rejected ({}). Return ONLY one JSON object that matches the schema, with no surrounding prose.",
                    attempt_run.request_message.fixed_instruction, error
                );
            }

            let output = match self
                .fork_runner
                .run_judge(GoalJudgeRunRequest {
                    workspace_path: workspace_path_string.to_string(),
                    agent_type: agent_type.map(str::to_string),
                    run: attempt_run,
                })
                .await
            {
                Ok(output) => output,
                Err(error) => {
                    last_error = Some(format!("judge fork error: {}", error));
                    continue;
                }
            };

            run.final_text = Some(output.final_text.clone());
            run.audit = output.audit;

            match GoalStructuredOutputParser::parse_verdict_loose(&output.final_text) {
                Some(verdict) => match GoalValidationGate::validate_verdict(record, &verdict) {
                    Ok(()) => return Ok(Some(verdict)),
                    Err(error) => {
                        last_error = Some(error.to_string());
                    }
                },
                None => {
                    last_error =
                        Some("output was not a recognizable verdict JSON object".to_string());
                }
            }

            let _ = attempt;
        }

        run.rejection_reason = last_error;
        Ok(None)
    }

    #[allow(clippy::too_many_arguments)]
    async fn apply_verdict(
        &self,
        workspace_path: &Path,
        workspace_path_string: &str,
        session_id: &str,
        mut record: GoalRecord,
        run: &GoalJudgeRun,
        verdict: GoalVerdict,
        agent_type: Option<&str>,
    ) -> BitFunResult<GoalResponse> {
        let met = verdict.met_count();
        let gaps = verdict.gaps_as_objects();

        match verdict.state {
            GoalVerdictState::Pass => {
                record.status = GoalStatus::Completed;
                record.progress.remaining_gaps.clear();
                record.progress.no_progress_streak = 0;
                record.progress.last_met_count = met;
                record.pending_user_question = None;
                record.progress.last_summary = Some(verdict.summary.clone());
            }
            GoalVerdictState::Continue => {
                let improved = met > record.progress.last_met_count
                    || gaps.len() < record.progress.remaining_gaps.len();
                if improved {
                    record.progress.no_progress_streak = 0;
                } else {
                    record.progress.no_progress_streak += 1;
                }
                record.progress.last_met_count = met;
                record.progress.remaining_gaps = gaps.clone();
                record.progress.last_summary = Some(verdict.summary.clone());
                record.status = if record.progress.no_progress_streak
                    >= record.budgets.max_no_progress_streak
                {
                    GoalStatus::Blocked
                } else {
                    GoalStatus::Active
                };
            }
            GoalVerdictState::NeedsUser => {
                record.status = GoalStatus::WaitingUser;
                record.pending_user_question = verdict.user_question.clone();
                record.progress.remaining_gaps = gaps.clone();
                record.progress.last_summary = Some(verdict.summary.clone());
            }
            GoalVerdictState::Blocked => {
                record.status = GoalStatus::Blocked;
                record.progress.remaining_gaps = gaps.clone();
                record.progress.last_summary = Some(verdict.summary.clone());
            }
        }

        let summary = GoalJudgmentSummary {
            judge_id: run.judge_id.clone(),
            state: verdict.state.clone(),
            summary: verdict.summary.clone(),
            remaining_gaps: gaps,
            confidence: verdict.confidence,
            judged_at_ms: now_ms(),
        };
        record.latest_judgment = Some(summary.clone());
        record.revision += 1;
        record.updated_at_ms = now_ms();

        self.store
            .append_event(
                workspace_path,
                session_id,
                &GoalStoreEvent::JudgmentRecorded {
                    goal_id: record.goal_id.clone(),
                    revision: record.revision,
                    summary,
                },
            )
            .await?;
        self.save_current_goal(
            workspace_path,
            session_id,
            &record,
            Some("Goal judgment recorded"),
        )
        .await?;

        if record.status.is_loop_active() {
            let steering = if verdict.next_steering.trim().is_empty() {
                fallback_steering(&record)
            } else {
                verdict.next_steering.clone()
            };
            self.queue_continuation(workspace_path_string, &record, &steering, agent_type)
                .await?;
        }

        let message = match verdict.state {
            GoalVerdictState::Pass => "Goal completed".to_string(),
            GoalVerdictState::Continue => "Goal judged: continuing".to_string(),
            GoalVerdictState::NeedsUser => "Goal needs user input".to_string(),
            GoalVerdictState::Blocked => "Goal blocked".to_string(),
        };
        let reloaded = self
            .current(workspace_path, session_id)
            .await?
            .unwrap_or(record);
        Ok(simple_response(&message, reloaded, Some(run.clone())))
    }

    /// Queue the next owner turn with the judge-provided steering. Respects the
    /// continuation budget and yields to any user input already queued.
    pub(super) async fn queue_continuation(
        &self,
        workspace_path: &str,
        record: &GoalRecord,
        steering_text: &str,
        agent_type: Option<&str>,
    ) -> BitFunResult<()> {
        if !record.status.is_loop_active() {
            return Ok(());
        }
        if record.progress.continuation_turns >= record.budgets.max_continuation_turns {
            let mut updated = record.clone();
            updated.status = GoalStatus::BudgetLimited;
            self.save_status(
                Path::new(workspace_path),
                &record.session_id,
                &mut updated,
                "Goal continuation budget reached",
            )
            .await?;
            return Ok(());
        }
        if self.scheduler.queue_depth(&record.session_id) > 0 {
            // The user (or a prior continuation) already has a turn queued; let
            // it run. The loop will judge again when that turn completes.
            return Ok(());
        }

        let display_text = steering_text.trim().to_string();
        let system_reminder = GoalReminderBuilder::system_reminder(record);
        let metadata = json!({
            "goal": {
                "kind": "continuation",
                "goalId": record.goal_id,
                "revision": record.revision,
            }
        });
        let submit_result = self
            .scheduler
            .submit_with_metadata(
                record.session_id.clone(),
                display_text.clone(),
                Some(display_text),
                None,
                agent_type.unwrap_or("agentic").to_string(),
                Some(system_reminder),
                Some(workspace_path.to_string()),
                DialogSubmissionPolicy::for_source(DialogTriggerSource::Goal)
                    .with_queue_priority(DialogQueuePriority::Low),
                None,
                None,
                Some(metadata),
            )
            .await
            .map_err(BitFunError::service)?;

        let turn_id = match submit_result {
            DialogSubmitOutcome::Started { turn_id, .. }
            | DialogSubmitOutcome::Queued { turn_id, .. } => turn_id,
        };
        let mut updated = record.clone();
        updated.progress.continuation_turns += 1;
        updated.revision += 1;
        updated.updated_at_ms = now_ms();
        self.store
            .append_event(
                Path::new(workspace_path),
                &record.session_id,
                &GoalStoreEvent::ContinuationQueued {
                    goal_id: updated.goal_id.clone(),
                    revision: updated.revision,
                    turn_id,
                },
            )
            .await?;
        self.save_current_goal(
            Path::new(workspace_path),
            &record.session_id,
            &updated,
            Some("Goal continuation queued"),
        )
        .await?;
        Ok(())
    }
}

fn fallback_steering(record: &GoalRecord) -> String {
    let gaps = if record.progress.remaining_gaps.is_empty() {
        String::new()
    } else {
        let lines = record
            .progress
            .remaining_gaps
            .iter()
            .map(|gap| format!("- {}", gap.description))
            .collect::<Vec<_>>()
            .join("\n");
        format!("\n\nRemaining gaps:\n{}", lines)
    };
    format!(
        "Continue working toward the goal:\n{}{}",
        record.contract.resolved_objective, gaps
    )
}

fn simple_response(message: &str, record: GoalRecord, judge: Option<GoalJudgeRun>) -> GoalResponse {
    GoalResponse {
        accepted: true,
        message: message.to_string(),
        goal: Some(record),
        extraction: None,
        judge,
    }
}
