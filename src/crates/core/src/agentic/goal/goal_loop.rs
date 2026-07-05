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
use crate::agentic::coordination::DialogQueuePriority;
use crate::agentic::session_hooks::{
    SessionDriverSubmit, SessionDriverSubmitOutcome, SessionWorkOwner,
};
use crate::error::CoreResult;
use serde_json::json;
use std::path::Path;
use uuid::Uuid;

/// Number of judge attempts (initial + re-ask) before escalating to the user.
const JUDGE_PARSE_ATTEMPTS: u32 = 2;

impl GoalService {
    /// Entry point invoked from `DialogTurnCompleted` for user-visible turns.
    pub(super) async fn judge_after_turn(
        &self,
        workspace_path: &str,
        session_id: &str,
        turn_id: &str,
    ) -> CoreResult<()> {
        let _guard = self.lock_session(session_id).await;
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
        if Self::trigger_turn_waiting_for_extraction(&record, turn_id) {
            return Ok(());
        }
        record.progress.last_turn_id = Some(turn_id.to_string());
        self.run_judge_for_record(
            workspace,
            workspace_path,
            session_id,
            record,
            None,
            GoalJudgeTrigger::TurnCompleted,
        )
        .await?;
        Ok(())
    }

    fn trigger_turn_waiting_for_extraction(record: &GoalRecord, turn_id: &str) -> bool {
        if record.progress.trigger_turn_id.as_deref() != Some(turn_id) {
            return false;
        }
        record.latest_extraction.as_ref().is_some_and(|extraction| {
            matches!(
                extraction.status,
                GoalExtractionStatus::Queued | GoalExtractionStatus::Running
            )
        })
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
    ) -> CoreResult<GoalResponse> {
        if record.progress.judge_runs >= record.budgets.max_judge_runs {
            record.status = GoalStatus::BudgetLimited;
            record.driver.phase = GoalDriverPhase::Idle;
            record.driver.last_reason = Some("Goal judge budget reached".to_string());
            record.driver.updated_at_ms = Some(now_ms());
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
        record.driver.phase = GoalDriverPhase::Judging;
        record.driver.last_reason = Some(format!("Goal judge started: {:?}", trigger));
        record.driver.updated_at_ms = Some(now_ms());
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

        let Some(mut current_record) = self.current(workspace_path, session_id).await? else {
            run.status = GoalJudgeStatus::Rejected;
            run.rejection_reason =
                Some("Goal changed or was cleared while judge was running".to_string());
            run.updated_at_ms = now_ms();
            self.save_judge_run(workspace_path, session_id, &run)
                .await?;
            return Ok(GoalResponse {
                accepted: true,
                message: "Goal judgment ignored because the goal no longer exists".to_string(),
                goal: None,
                extraction: None,
                judge: Some(run),
            });
        };
        if current_record.goal_id != run.goal_id || current_record.revision != run.goal_revision {
            run.status = GoalJudgeStatus::Rejected;
            run.rejection_reason =
                Some("Goal changed while judge was running; stale verdict ignored".to_string());
            run.updated_at_ms = now_ms();
            self.save_judge_run(workspace_path, session_id, &run)
                .await?;
            return Ok(GoalResponse {
                accepted: true,
                message: "Stale goal judgment ignored".to_string(),
                goal: Some(current_record),
                extraction: None,
                judge: Some(run),
            });
        }

        let Some(verdict) = verdict else {
            // Could not obtain a usable verdict after retries: hand back to the
            // user rather than silently stalling in `Judging`.
            run.status = GoalJudgeStatus::Rejected;
            run.updated_at_ms = now_ms();
            self.save_judge_run(workspace_path, session_id, &run)
                .await?;
            current_record.status = GoalStatus::WaitingUser;
            current_record.driver.phase = GoalDriverPhase::Idle;
            current_record.driver.last_reason =
                Some("Goal judge produced no usable verdict".to_string());
            current_record.driver.updated_at_ms = Some(now_ms());
            current_record.pending_user_question = Some(
                "The automatic goal judge could not produce a usable verdict. Please review the work and steer or clear the goal.".to_string(),
            );
            self.save_status(
                workspace_path,
                session_id,
                &mut current_record,
                "Goal judge produced no usable verdict",
            )
            .await?;
            return Ok(simple_response(
                run.rejection_reason
                    .clone()
                    .unwrap_or_else(|| "Goal judge produced no usable verdict".to_string())
                    .as_str(),
                current_record,
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
            current_record,
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
    ) -> CoreResult<Option<GoalVerdict>> {
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
    ) -> CoreResult<GoalResponse> {
        let met = verdict.met_count();
        let gaps = verdict.gaps_as_objects();

        match verdict.state {
            GoalVerdictState::Pass => {
                record.status = GoalStatus::Completed;
                record.driver.phase = GoalDriverPhase::Idle;
                record.driver.last_reason = Some("Goal completed".to_string());
                record.driver.updated_at_ms = Some(now_ms());
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
                record.driver.phase = GoalDriverPhase::Idle;
                record.driver.last_reason = Some(if record.status == GoalStatus::Blocked {
                    "Goal blocked after repeated no-progress judgments".to_string()
                } else {
                    "Goal judgment requires continuation".to_string()
                });
                record.driver.updated_at_ms = Some(now_ms());
            }
            GoalVerdictState::NeedsUser => {
                record.status = GoalStatus::WaitingUser;
                record.driver.phase = GoalDriverPhase::Idle;
                record.driver.last_reason = Some("Goal needs user input".to_string());
                record.driver.updated_at_ms = Some(now_ms());
                record.pending_user_question = verdict.user_question.clone();
                record.progress.remaining_gaps = gaps.clone();
                record.progress.last_summary = Some(verdict.summary.clone());
            }
            GoalVerdictState::Blocked => {
                record.status = GoalStatus::Blocked;
                record.driver.phase = GoalDriverPhase::Idle;
                record.driver.last_reason = Some("Goal blocked".to_string());
                record.driver.updated_at_ms = Some(now_ms());
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
            let continuation_text = render_gap_continuation(&record);
            self.queue_continuation(
                workspace_path_string,
                &record,
                &continuation_text,
                agent_type,
            )
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

    /// Queue the next owner turn from the current goal and judge-reported gaps.
    /// Respects the continuation budget and yields to any user input already
    /// queued.
    pub(super) async fn queue_continuation(
        &self,
        workspace_path: &str,
        record: &GoalRecord,
        continuation_text: &str,
        agent_type: Option<&str>,
    ) -> CoreResult<()> {
        if !record.status.is_loop_active() {
            return Ok(());
        }
        if record.progress.continuation_turns >= record.budgets.max_continuation_turns {
            let mut updated = record.clone();
            updated.status = GoalStatus::BudgetLimited;
            updated.driver.phase = GoalDriverPhase::Idle;
            updated.driver.last_reason = Some("Goal continuation budget reached".to_string());
            updated.driver.updated_at_ms = Some(now_ms());
            self.save_status(
                Path::new(workspace_path),
                &record.session_id,
                &mut updated,
                "Goal continuation budget reached",
            )
            .await?;
            return Ok(());
        }
        if self.driver.snapshot(&record.session_id).await?.queue_depth > 0 {
            // The user (or a prior continuation) already has a turn queued; let
            // it run. The loop will judge again when that turn completes.
            return Ok(());
        }

        let display_text = continuation_text.trim().to_string();
        let system_reminder = GoalReminderBuilder::system_reminder(record);
        let metadata = json!({
            "goal": {
                "kind": "continuation",
                "goalId": record.goal_id,
                "revision": record.revision,
            }
        });
        let submit_result = self
            .driver
            .submit_turn(SessionDriverSubmit {
                session_id: record.session_id.clone(),
                workspace_path: workspace_path.to_string(),
                user_input: display_text.clone(),
                original_user_input: Some(display_text),
                turn_id: None,
                agent_type: agent_type.unwrap_or("agentic").to_string(),
                system_reminder_override: Some(system_reminder),
                owner: SessionWorkOwner::goal(record.goal_id.clone(), record.revision),
                queue_priority: DialogQueuePriority::Low,
                skip_tool_confirmation: true,
                metadata: Some(metadata),
            })
            .await?;

        let (turn_id, driver_phase) = match submit_result {
            SessionDriverSubmitOutcome::Started { turn_id, .. } => {
                (turn_id, GoalDriverPhase::OwnerTurnRunning)
            }
            SessionDriverSubmitOutcome::Queued { turn_id, .. } => {
                (turn_id, GoalDriverPhase::ContinuationQueued)
            }
        };
        let mut updated = record.clone();
        updated.driver.phase = driver_phase;
        updated.driver.last_reason = Some("Goal continuation queued".to_string());
        updated.driver.last_turn_id = Some(turn_id.clone());
        updated.driver.updated_at_ms = Some(now_ms());
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

fn render_gap_continuation(record: &GoalRecord) -> String {
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
