use super::extraction::{fallback_extraction_result, GoalExtractionRunRequest, GoalForkRunner};
use super::fork_message::GoalForkMessageBuilder;
use super::intake::{GoalTextIntake, TextIntakeAnnotator};
use super::model::*;
use super::output_parser::GoalStructuredOutputParser;
use super::steering::GoalReminderBuilder;
use super::store::GoalStore;
use super::validation::GoalValidationGate;
use crate::agentic::coordination::{SessionControlActor, TurnCancellationReason};
use crate::agentic::events::SessionSurfaceMode;
use crate::agentic::session_hooks::{
    SessionDriver, SessionDriverSubmit, SessionDriverSubmitOutcome, SessionHookContext,
    SessionHookKind, SessionTurnOutcome, SessionWorkOwner, SessionWorkOwnerMatcher,
};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::events::{emit_global_event, BackendEvent};
use serde_json::json;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, OwnedMutexGuard};
use uuid::Uuid;

pub(super) const GOAL_EXTRACTION_FALLBACK_MESSAGE: &str =
    "AI goal extraction failed; using the user's input as the goal.";
const GOAL_ACTIVE_TURN_CANCEL_WAIT: Duration = Duration::from_millis(500);

#[derive(Clone)]
pub struct GoalService {
    pub(super) store: Arc<GoalStore>,
    pub(super) driver: Arc<dyn SessionDriver>,
    pub(super) fork_runner: Arc<dyn GoalForkRunner>,
    /// Per-session write lock. Every mutation of a session's goal goes through
    /// this lock, making the service the single writer and removing the
    /// read-modify-write races the old design had.
    locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

impl GoalService {
    pub fn new(
        store: Arc<GoalStore>,
        fork_runner: Arc<dyn GoalForkRunner>,
        driver: Arc<dyn SessionDriver>,
    ) -> Self {
        Self {
            store,
            fork_runner,
            driver,
            locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn store(&self) -> Arc<GoalStore> {
        self.store.clone()
    }

    async fn configured_goal_budgets(&self) -> GoalBudgets {
        let mut budgets = GoalBudgets::default();
        if let Ok(config_service) = crate::service::config::get_global_config_service().await {
            if let Ok(goal_mode_config) = config_service
                .get_config::<crate::service::config::types::GoalModeConfig>(Some("ai.goal_mode"))
                .await
            {
                budgets.max_continuation_turns = goal_mode_config.max_continuation_turns.max(1);
            }
        }
        budgets
    }

    pub(super) async fn lock_session(&self, session_id: &str) -> OwnedMutexGuard<()> {
        let lock = {
            let mut map = self.locks.lock().await;
            map.entry(session_id.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        lock.lock_owned().await
    }

    // -- Reads (lock-free) ---------------------------------------------------

    pub async fn current(
        &self,
        workspace_path: impl AsRef<Path>,
        session_id: &str,
    ) -> CoreResult<Option<GoalRecord>> {
        self.store
            .load_current(workspace_path.as_ref(), session_id)
            .await
    }

    pub async fn status(&self, request: GoalStatusRequest) -> CoreResult<GoalResponse> {
        self.status_snapshot(request).await
    }

    async fn status_snapshot(&self, request: GoalStatusRequest) -> CoreResult<GoalResponse> {
        let goal = self
            .current(Path::new(&request.workspace_path), &request.session_id)
            .await?;
        Ok(GoalResponse {
            accepted: true,
            message: match &goal {
                Some(record) => format!("Goal is {:?}", record.status),
                None => "No active goal for this session".to_string(),
            },
            goal,
            extraction: None,
            judge: None,
        })
    }

    pub async fn reconcile_active_goal(
        &self,
        workspace_path_string: &str,
        session_id: &str,
        agent_type: Option<&str>,
        reason: &str,
    ) -> CoreResult<GoalResponse> {
        let _guard = self.lock_session(session_id).await;
        let workspace_path = Path::new(workspace_path_string);
        let Some(mut record) = self.current(workspace_path, session_id).await? else {
            return Ok(GoalResponse {
                accepted: true,
                message: "No active goal for this session".to_string(),
                goal: None,
                extraction: None,
                judge: None,
            });
        };

        if !record.status.is_driver_authorized() {
            return Ok(GoalResponse {
                accepted: true,
                message: format!("Goal is {:?}", record.status),
                goal: Some(record),
                extraction: None,
                judge: None,
            });
        }

        self.driver
            .ensure_session_loaded(workspace_path, session_id)
            .await?;

        let mut snapshot = self.driver.snapshot(session_id).await?;
        if snapshot.is_processing() {
            return Ok(GoalResponse {
                accepted: true,
                message: "Goal driver is waiting for the active turn".to_string(),
                goal: Some(record),
                extraction: None,
                judge: None,
            });
        }

        if let Some(pause) = snapshot.queue_pause.as_ref() {
            if pause.reason == "user_cancelled" {
                return Ok(GoalResponse {
                    accepted: true,
                    message: "Goal driver is waiting because the user cancelled the queue"
                        .to_string(),
                    goal: Some(record),
                    extraction: None,
                    judge: None,
                });
            }
            if pause.reason == "run_failed" {
                let _ = self.driver.resume_queue(session_id).await;
            }
        }

        snapshot = self.driver.snapshot(session_id).await?;
        if snapshot.is_processing() {
            return Ok(GoalResponse {
                accepted: true,
                message: "Goal driver resumed queued session work".to_string(),
                goal: Some(record),
                extraction: None,
                judge: None,
            });
        }

        if snapshot.queue_depth > 0 {
            return Ok(GoalResponse {
                accepted: true,
                message: "Goal driver is waiting for queued session input".to_string(),
                goal: Some(record),
                extraction: None,
                judge: None,
            });
        }

        record.driver.phase = GoalDriverPhase::Recovering;
        record.driver.last_reason = Some(reason.to_string());
        record.driver.last_turn_id = record.progress.last_turn_id.clone();
        record.driver.interrupted_attempts = record.driver.interrupted_attempts.saturating_add(1);
        record.driver.updated_at_ms = Some(now_ms());
        self.store
            .append_event(
                workspace_path,
                session_id,
                &GoalStoreEvent::DriverReconciled {
                    goal_id: record.goal_id.clone(),
                    revision: record.revision,
                    phase: record.driver.phase.clone(),
                    reason: reason.to_string(),
                },
            )
            .await?;

        self.run_judge_for_record(
            workspace_path,
            workspace_path_string,
            session_id,
            record,
            agent_type,
            GoalJudgeTrigger::Recovery,
        )
        .await
    }

    // -- Intake --------------------------------------------------------------

    pub async fn handle_text_intake(
        &self,
        request: GoalUserRequest,
    ) -> CoreResult<Option<GoalResponse>> {
        let intake = TextIntakeAnnotator::annotate(request);
        if let Some(action) = direct_goal_control_action(&intake) {
            let _guard = self.lock_session(&intake.session_id).await;
            let workspace_path = Path::new(&intake.workspace_path);
            if action == GoalControlAction::Status {
                return Ok(Some(
                    self.status_snapshot(GoalStatusRequest {
                        session_id: intake.session_id,
                        workspace_path: intake.workspace_path,
                    })
                    .await?,
                ));
            }
            let response = self
                .control_locked(
                    workspace_path,
                    &intake.workspace_path,
                    &intake.session_id,
                    intake.agent_type.as_deref(),
                    action,
                    None,
                    None,
                )
                .await?;
            return Ok(Some(response));
        }

        let (run, response) = self.start_text_intake(&intake).await?;
        let service = self.clone();
        tokio::spawn(async move {
            if let Err(error) = service.finish_text_intake_extraction(intake, run).await {
                log::warn!("Goal extraction refinement failed: {}", error);
            }
        });
        Ok(response)
    }

    async fn start_text_intake(
        &self,
        intake: &GoalTextIntake,
    ) -> CoreResult<(GoalExtractionRun, Option<GoalResponse>)> {
        let _guard = self.lock_session(&intake.session_id).await;
        let workspace_path = Path::new(&intake.workspace_path);
        let active_goal = self.current(workspace_path, &intake.session_id).await?;
        let extraction_id = format!("goal-extraction-{}", Uuid::new_v4());
        let request_message = GoalForkMessageBuilder::extraction_request(
            extraction_id.clone(),
            &intake,
            active_goal.as_ref(),
        );
        let now = now_ms();
        let mut run = GoalExtractionRun {
            extraction_id: extraction_id.clone(),
            parent_session_id: intake.session_id.clone(),
            extraction_session_id: None,
            trigger_turn_id: intake.trigger_turn_id.clone(),
            raw_input: intake.raw_input.clone(),
            checkpoint_event_id: intake.trigger_turn_id.clone(),
            status: GoalExtractionStatus::Queued,
            request_message,
            final_text: None,
            result: None,
            rejection_reason: None,
            audit: GoalRunAudit::pending("pending", false),
            created_at_ms: now,
            updated_at_ms: now,
        };
        self.save_extraction_run(workspace_path, &intake.session_id, &run)
            .await?;

        run.status = GoalExtractionStatus::Running;
        run.updated_at_ms = now_ms();
        let immediate_goal = self
            .create_immediate_goal_if_needed(workspace_path, intake, &run)
            .await?;
        self.save_extraction_run(workspace_path, &intake.session_id, &run)
            .await?;

        let response_goal = immediate_goal.or(active_goal);
        Ok((
            run.clone(),
            Some(GoalResponse {
                accepted: true,
                message: match response_goal.as_ref() {
                    Some(record) => {
                        format!("Goal accepted: {}", record.contract.resolved_objective)
                    }
                    None => "Goal refinement started".to_string(),
                },
                goal: response_goal,
                extraction: Some(run),
                judge: None,
            }),
        ))
    }

    async fn create_immediate_goal_if_needed(
        &self,
        workspace_path: &Path,
        intake: &GoalTextIntake,
        run: &GoalExtractionRun,
    ) -> CoreResult<Option<GoalRecord>> {
        let Some(_objective) = immediate_goal_objective(intake) else {
            return Ok(None);
        };
        let result = fallback_extraction_result(
            run,
            "User-submitted /goal input accepted immediately as the active goal.",
            Vec::new(),
        );
        let contract = result
            .contract
            .clone()
            .ok_or_else(|| CoreError::validation("Immediate goal contract is required"))?;
        let context_resolution = result
            .context_resolution
            .clone()
            .ok_or_else(|| CoreError::validation("Immediate goal context is required"))?;
        let now = now_ms();
        let _ = self
            .driver
            .delete_queued_turns(
                &intake.session_id,
                SessionWorkOwnerMatcher::AnyGoal,
                Some(&run.trigger_turn_id),
            )
            .await?;
        let record = GoalRecord {
            goal_id: format!("goal-{}", Uuid::new_v4()),
            session_id: intake.session_id.clone(),
            revision: 1,
            status: GoalStatus::Active,
            contract,
            context: GoalContextSnapshot {
                frozen_context_markdown: context_resolution.frozen_context_markdown,
            },
            progress: GoalProgress {
                trigger_turn_id: Some(run.trigger_turn_id.clone()),
                ..GoalProgress::default()
            },
            driver: GoalDriverState {
                phase: GoalDriverPhase::OwnerTurnRunning,
                last_reason: Some("Goal accepted from user input".to_string()),
                last_turn_id: Some(run.trigger_turn_id.clone()),
                interrupted_attempts: 0,
                updated_at_ms: Some(now),
            },
            budgets: self.configured_goal_budgets().await,
            latest_extraction: Some(extraction_summary_from_run(run)),
            latest_judgment: None,
            pending_user_question: None,
            created_at_ms: now,
            updated_at_ms: now,
        };
        self.store
            .append_event(
                workspace_path,
                &intake.session_id,
                &GoalStoreEvent::Created {
                    goal_id: record.goal_id.clone(),
                    revision: record.revision,
                    objective: record.contract.resolved_objective.clone(),
                    extraction_id: run.extraction_id.clone(),
                },
            )
            .await?;
        self.save_current_goal(
            workspace_path,
            &intake.session_id,
            &record,
            Some("Goal accepted"),
        )
        .await?;
        self.store
            .save_snapshot(workspace_path, &intake.session_id, &record)
            .await?;
        Ok(Some(record))
    }

    async fn is_current_goal_refinement(
        &self,
        workspace_path: &Path,
        session_id: &str,
        run: &GoalExtractionRun,
    ) -> CoreResult<bool> {
        let Some(record) = self.current(workspace_path, session_id).await? else {
            return Ok(false);
        };
        Ok(Self::record_matches_extraction(&record, run))
    }

    async fn update_current_goal_extraction_summary(
        &self,
        workspace_path: &Path,
        session_id: &str,
        run: &GoalExtractionRun,
        message: &str,
    ) -> CoreResult<Option<GoalRecord>> {
        let Some(mut record) = self.current(workspace_path, session_id).await? else {
            return Ok(None);
        };
        if !Self::record_matches_extraction(&record, run) {
            return Ok(Some(record));
        }
        record.latest_extraction = Some(extraction_summary_from_run(run));
        record.revision += 1;
        record.updated_at_ms = now_ms();
        self.save_current_goal(workspace_path, session_id, &record, Some(message))
            .await?;
        Ok(Some(record))
    }

    pub(super) fn record_matches_extraction(record: &GoalRecord, run: &GoalExtractionRun) -> bool {
        record.progress.trigger_turn_id.as_deref() == Some(run.trigger_turn_id.as_str())
            && record
                .latest_extraction
                .as_ref()
                .is_some_and(|summary| summary.extraction_id == run.extraction_id)
    }

    async fn finish_text_intake_extraction(
        &self,
        intake: GoalTextIntake,
        mut run: GoalExtractionRun,
    ) -> CoreResult<()> {
        let workspace_path_string = intake.workspace_path.clone();
        let output = match self
            .fork_runner
            .run_extraction(GoalExtractionRunRequest {
                workspace_path: workspace_path_string.clone(),
                agent_type: intake.agent_type.clone(),
                run: run.clone(),
            })
            .await
        {
            Ok(output) => output,
            Err(error) => {
                let _guard = self.lock_session(&intake.session_id).await;
                let workspace_path = Path::new(&intake.workspace_path);
                run.status = GoalExtractionStatus::Failed;
                run.rejection_reason = Some(error.to_string());
                run.updated_at_ms = now_ms();
                self.save_extraction_run(workspace_path, &intake.session_id, &run)
                    .await?;
                self.update_current_goal_extraction_summary(
                    workspace_path,
                    &intake.session_id,
                    &run,
                    "Goal extraction failed",
                )
                .await?;
                return Ok(());
            }
        };
        run.final_text = Some(output.final_text.clone());
        run.audit = output.audit;

        let parsed = match parse_goal_extraction_output(
            &run,
            &output.final_text,
            intake.entry.has_goal_prefix,
        ) {
            Ok(parsed) => parsed,
            Err(error) => {
                let _guard = self.lock_session(&intake.session_id).await;
                let workspace_path = Path::new(&intake.workspace_path);
                run.status = GoalExtractionStatus::Rejected;
                run.audit.parser_status = Some("rejected".to_string());
                run.rejection_reason = Some(error.to_string());
                run.updated_at_ms = now_ms();
                self.save_extraction_run(workspace_path, &intake.session_id, &run)
                    .await?;
                self.update_current_goal_extraction_summary(
                    workspace_path,
                    &intake.session_id,
                    &run,
                    "Goal extraction rejected",
                )
                .await?;
                return Ok(());
            }
        };

        let fallback_message = parsed
            .rejection_reason
            .as_ref()
            .map(|_| GOAL_EXTRACTION_FALLBACK_MESSAGE);
        let result = parsed.result;
        run.audit.parser_status = Some(parsed.parser_status);
        run.rejection_reason = parsed.rejection_reason;
        run.result = Some(result.clone());
        run.status = if result.intent.kind == GoalIntentKind::AskClarification {
            GoalExtractionStatus::NeedsClarification
        } else {
            GoalExtractionStatus::Accepted
        };
        run.updated_at_ms = now_ms();

        let _guard = self.lock_session(&intake.session_id).await;
        let workspace_path = Path::new(&intake.workspace_path);
        self.save_extraction_run_with_message(
            workspace_path,
            &intake.session_id,
            &run,
            fallback_message,
        )
        .await?;

        match result.intent.kind.clone() {
            GoalIntentKind::ChatOnly | GoalIntentKind::QueryGoal => {
                self.update_current_goal_extraction_summary(
                    workspace_path,
                    &intake.session_id,
                    &run,
                    "Goal extraction recorded",
                )
                .await?;
            }
            GoalIntentKind::ControlGoal => {
                if self
                    .is_current_goal_refinement(workspace_path, &intake.session_id, &run)
                    .await?
                {
                    self.update_current_goal_extraction_summary(
                        workspace_path,
                        &intake.session_id,
                        &run,
                        "Goal extraction recorded",
                    )
                    .await?;
                } else {
                    let action = result
                        .intent
                        .control_action
                        .clone()
                        .unwrap_or(GoalControlAction::Status);
                    let mut response = self
                        .control_locked(
                            workspace_path,
                            &intake.workspace_path,
                            &intake.session_id,
                            intake.agent_type.as_deref(),
                            action,
                            result.intent.target_goal_id.clone(),
                            None,
                        )
                        .await?;
                    response.extraction = Some(run);
                }
            }
            GoalIntentKind::CreateGoal
            | GoalIntentKind::UpdateGoal
            | GoalIntentKind::ApplyGuidance => {
                let mut response = self
                    .create_or_update_from_extraction(
                        workspace_path,
                        &intake.workspace_path,
                        &intake.session_id,
                        intake.agent_type.as_deref(),
                        &run,
                        result,
                    )
                    .await?;
                if let Some(message) = fallback_message {
                    response.message = message.to_string();
                }
                response.extraction = Some(run);
            }
            GoalIntentKind::AskClarification => {
                if self
                    .is_current_goal_refinement(workspace_path, &intake.session_id, &run)
                    .await?
                {
                    self.update_current_goal_extraction_summary(
                        workspace_path,
                        &intake.session_id,
                        &run,
                        "Goal extraction recorded",
                    )
                    .await?;
                } else {
                    let question = result
                        .intent
                        .clarification_questions
                        .first()
                        .cloned()
                        .unwrap_or_else(|| {
                            "Please clarify the goal before I continue.".to_string()
                        });
                    if let Some(mut record) =
                        self.current(workspace_path, &intake.session_id).await?
                    {
                        record.status = GoalStatus::WaitingUser;
                        record.driver.phase = GoalDriverPhase::Idle;
                        record.driver.last_reason =
                            Some("Goal clarification requested".to_string());
                        record.driver.updated_at_ms = Some(now_ms());
                        record.pending_user_question = Some(question.clone());
                        self.save_status(
                            workspace_path,
                            &intake.session_id,
                            &mut record,
                            "Goal clarification requested",
                        )
                        .await?;
                    }
                }
            }
        }
        Ok(())
    }

    pub async fn update_from_user_edit(
        &self,
        request: GoalEditRequest,
    ) -> CoreResult<GoalResponse> {
        let edited_objective = request.edited_objective.trim().to_string();
        if edited_objective.is_empty() {
            return Err(CoreError::validation("Edited goal objective is required"));
        }

        let _guard = self.lock_session(&request.session_id).await;
        let workspace_path = Path::new(&request.workspace_path);
        let current = self
            .store
            .load_current(workspace_path, &request.session_id)
            .await?
            .ok_or_else(|| CoreError::validation("No goal exists for this session"))?;
        self.validate_expected(
            &current,
            request.expected_goal_id.as_deref(),
            request.expected_revision,
        )?;

        let previous_objective = current.contract.resolved_objective.clone();
        let trigger_turn_id = format!("goal-edit-{}", Uuid::new_v4());
        let intake = GoalTextIntake {
            session_id: request.session_id.clone(),
            workspace_path: request.workspace_path.clone(),
            agent_type: request.agent_type.clone(),
            trigger_turn_id,
            raw_input: edited_objective.clone(),
            skip_initial_continuation: false,
            entry: GoalEntryMetadata {
                source: "goal_edit".to_string(),
                has_goal_prefix: true,
                prefix: Some("goal_edit".to_string()),
            },
        };

        let extraction_id = format!("goal-extraction-{}", Uuid::new_v4());
        let request_message = GoalForkMessageBuilder::extraction_request(
            extraction_id.clone(),
            &intake,
            Some(&current),
        );
        let now = now_ms();
        let result =
            fallback_goal_edit_result(&extraction_id, &intake, &edited_objective, &current.goal_id);
        let mut run = GoalExtractionRun {
            extraction_id: extraction_id.clone(),
            parent_session_id: intake.session_id.clone(),
            extraction_session_id: None,
            trigger_turn_id: intake.trigger_turn_id.clone(),
            raw_input: intake.raw_input.clone(),
            checkpoint_event_id: intake.trigger_turn_id.clone(),
            status: GoalExtractionStatus::Accepted,
            request_message,
            final_text: serde_json::to_string_pretty(&result).ok(),
            result: Some(result.clone()),
            rejection_reason: None,
            audit: GoalRunAudit {
                runner_kind: "direct_user_edit".to_string(),
                enable_tools: false,
                fork_session_id: None,
                inherited_message_count: None,
                prompt_message_count: None,
                parser_status: Some("accepted".to_string()),
            },
            created_at_ms: now,
            updated_at_ms: now,
        };
        run.updated_at_ms = now_ms();
        self.save_extraction_run_with_message(workspace_path, &intake.session_id, &run, None)
            .await?;

        let mut response = self
            .create_or_update_from_extraction(
                workspace_path,
                &intake.workspace_path,
                &intake.session_id,
                intake.agent_type.as_deref(),
                &run,
                result,
            )
            .await?;
        response.message = format!(
            "Goal updated: {}",
            response
                .goal
                .as_ref()
                .map(|record| record.contract.resolved_objective.as_str())
                .unwrap_or(edited_objective.as_str())
        );
        response.extraction = Some(run);

        if let Some(record) = response.goal.as_ref() {
            if let Err(error) = self
                .queue_goal_edit_steering(
                    &intake.workspace_path,
                    &previous_objective,
                    record,
                    intake.agent_type.as_deref(),
                )
                .await
            {
                log::warn!(
                    "Failed to queue goal edit steering: session_id={} goal_id={} error={}",
                    intake.session_id,
                    record.goal_id,
                    error
                );
                response.message = format!(
                    "Goal updated, but active steering could not be queued: {}",
                    error
                );
            }
        }

        Ok(response)
    }

    // -- Control -------------------------------------------------------------

    pub async fn control(&self, request: GoalControlRequest) -> CoreResult<GoalResponse> {
        let _guard = self.lock_session(&request.session_id).await;
        let workspace_path = Path::new(&request.workspace_path);
        self.control_locked(
            workspace_path,
            &request.workspace_path,
            &request.session_id,
            None,
            request.action,
            request.expected_goal_id,
            request.expected_revision,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn control_locked(
        &self,
        workspace_path: &Path,
        workspace_path_string: &str,
        session_id: &str,
        agent_type: Option<&str>,
        action: GoalControlAction,
        expected_goal_id: Option<String>,
        expected_revision: Option<u64>,
    ) -> CoreResult<GoalResponse> {
        let mut record = self
            .store
            .load_current(workspace_path, session_id)
            .await?
            .ok_or_else(|| CoreError::validation("No goal exists for this session"))?;
        let expected_revision = if action == GoalControlAction::Review {
            None
        } else {
            expected_revision
        };
        self.validate_expected(&record, expected_goal_id.as_deref(), expected_revision)?;

        match action {
            GoalControlAction::Status => Ok(GoalResponse {
                accepted: true,
                message: format!("Goal is {:?}", record.status),
                goal: Some(record),
                extraction: None,
                judge: None,
            }),
            GoalControlAction::Review => {
                let _ = self
                    .driver
                    .delete_queued_turns(session_id, SessionWorkOwnerMatcher::AnyGoal, None)
                    .await?;
                // A user-requested review is just an immediate judge run.
                self.run_judge_for_record(
                    workspace_path,
                    workspace_path_string,
                    session_id,
                    record,
                    agent_type,
                    GoalJudgeTrigger::UserReview,
                )
                .await
            }
            GoalControlAction::Clear => {
                let _ = self
                    .driver
                    .delete_queued_turns(session_id, SessionWorkOwnerMatcher::AnyGoal, None)
                    .await?;
                let _ = self
                    .cancel_current_goal_attempt(session_id, &record)
                    .await?;
                record.status = GoalStatus::Cancelled;
                record.driver.phase = GoalDriverPhase::Idle;
                record.driver.last_reason = Some("clear requested".to_string());
                record.driver.updated_at_ms = Some(now_ms());
                record.revision += 1;
                record.updated_at_ms = now_ms();
                self.store
                    .append_event(
                        workspace_path,
                        session_id,
                        &GoalStoreEvent::StatusChanged {
                            goal_id: record.goal_id.clone(),
                            revision: record.revision,
                            status: record.status.clone(),
                            reason: "clear requested".to_string(),
                        },
                    )
                    .await?;
                self.store.clear_current(workspace_path, session_id).await?;
                self.emit_goal_lifecycle_event(
                    "goal_cleared",
                    workspace_path,
                    session_id,
                    Some(&record),
                    None,
                    None,
                    Some("Goal cleared"),
                )
                .await;
                Ok(GoalResponse {
                    accepted: true,
                    message: "Goal cleared".to_string(),
                    goal: Some(record),
                    extraction: None,
                    judge: None,
                })
            }
            GoalControlAction::Pause => {
                let _ = self
                    .driver
                    .delete_queued_turns(session_id, SessionWorkOwnerMatcher::AnyGoal, None)
                    .await?;
                let _ = self
                    .cancel_current_goal_attempt(session_id, &record)
                    .await?;
                record.status = GoalStatus::Paused;
                record.driver.phase = GoalDriverPhase::Idle;
                record.driver.last_reason = Some("Goal paused by user".to_string());
                record.driver.updated_at_ms = Some(now_ms());
                self.save_status(workspace_path, session_id, &mut record, "Goal paused")
                    .await?;
                Ok(GoalResponse {
                    accepted: true,
                    message: "Goal paused".to_string(),
                    goal: Some(record),
                    extraction: None,
                    judge: None,
                })
            }
            GoalControlAction::Resume => {
                record.status = GoalStatus::Active;
                record.driver.phase = GoalDriverPhase::Recovering;
                record.driver.last_reason = Some("Goal resumed by user".to_string());
                record.driver.updated_at_ms = Some(now_ms());
                record.pending_user_question = None;
                self.save_status(workspace_path, session_id, &mut record, "Goal resumed")
                    .await?;
                // Re-judge on resume so the loop re-derives the next step from
                // the current state rather than a stale steering message.
                self.run_judge_for_record(
                    workspace_path,
                    workspace_path_string,
                    session_id,
                    record,
                    agent_type,
                    GoalJudgeTrigger::Resume,
                )
                .await
            }
        }
    }

    async fn cancel_current_goal_attempt(
        &self,
        session_id: &str,
        record: &GoalRecord,
    ) -> CoreResult<Option<String>> {
        self.driver
            .cancel_active_turn(
                session_id,
                SessionWorkOwnerMatcher::AnyGoal,
                record.progress.trigger_turn_id.as_deref(),
                TurnCancellationReason::GoalControl,
                SessionControlActor::Goal,
                GOAL_ACTIVE_TURN_CANCEL_WAIT,
            )
            .await
    }

    // -- Agent tool support --------------------------------------------------

    pub async fn record_progress(
        &self,
        workspace_path: &Path,
        session_id: &str,
        note: String,
    ) -> CoreResult<GoalResponse> {
        let _guard = self.lock_session(session_id).await;
        self.record_progress_locked(workspace_path, session_id, note)
            .await
    }

    async fn record_progress_locked(
        &self,
        workspace_path: &Path,
        session_id: &str,
        note: String,
    ) -> CoreResult<GoalResponse> {
        let mut record = self.require_current(workspace_path, session_id).await?;
        push_bounded(&mut record.progress.notes, note.clone(), 50);
        record.revision += 1;
        record.updated_at_ms = now_ms();
        self.store
            .append_event(
                workspace_path,
                session_id,
                &GoalStoreEvent::Progress {
                    goal_id: record.goal_id.clone(),
                    revision: record.revision,
                    note,
                },
            )
            .await?;
        self.save_current_goal(
            workspace_path,
            session_id,
            &record,
            Some("Goal progress recorded"),
        )
        .await?;
        Ok(GoalResponse {
            accepted: true,
            message: "Goal progress recorded".to_string(),
            goal: Some(record),
            extraction: None,
            judge: None,
        })
    }

    pub async fn record_blocker_claim(
        &self,
        workspace_path: &Path,
        session_id: &str,
        summary: String,
    ) -> CoreResult<GoalResponse> {
        let _guard = self.lock_session(session_id).await;
        let mut record = self.require_current(workspace_path, session_id).await?;
        record.status = GoalStatus::Blocked;
        record.driver.phase = GoalDriverPhase::Idle;
        record.driver.last_reason = Some("Agent reported a blocker".to_string());
        record.driver.updated_at_ms = Some(now_ms());
        push_bounded(
            &mut record.progress.notes,
            format!("Blocker reported: {}", summary),
            50,
        );
        self.store
            .append_event(
                workspace_path,
                session_id,
                &GoalStoreEvent::BlockerClaimed {
                    goal_id: record.goal_id.clone(),
                    revision: record.revision + 1,
                    summary,
                },
            )
            .await?;
        self.save_status(
            workspace_path,
            session_id,
            &mut record,
            "Agent reported a blocker",
        )
        .await?;
        Ok(GoalResponse {
            accepted: true,
            message: "Goal marked blocked".to_string(),
            goal: Some(record),
            extraction: None,
            judge: None,
        })
    }

    // -- Session hooks -------------------------------------------------------

    pub async fn handle_session_hook(&self, context: SessionHookContext) -> CoreResult<()> {
        let session_id = context.hook.session_id.as_str();
        let workspace_path = match context.workspace_path() {
            Some(path) => path.to_string(),
            None => return Ok(()),
        };

        match &context.hook.kind {
            SessionHookKind::SessionRestored { reason }
            | SessionHookKind::DriverReconcile { reason } => {
                let _ = self
                    .reconcile_active_goal(&workspace_path, session_id, None, reason)
                    .await?;
            }
            SessionHookKind::SessionLifecycleChanged { state, .. } => {
                if state == "deleted" {
                    let _ = self
                        .driver
                        .delete_queued_turns(session_id, SessionWorkOwnerMatcher::AnyGoal, None)
                        .await?;
                }
            }
            SessionHookKind::SessionExecutionChanged { .. } => {}
            SessionHookKind::TurnFinished {
                turn_id,
                owner,
                outcome,
                surface_mode,
                hidden_session,
            } => {
                if !matches!(surface_mode, SessionSurfaceMode::UserVisible) {
                    return Ok(());
                }
                match outcome {
                    SessionTurnOutcome::Completed => {
                        if !*hidden_session {
                            self.judge_after_turn(&workspace_path, session_id, turn_id)
                                .await?;
                        }
                    }
                    SessionTurnOutcome::Failed { error } => {
                        if !self
                            .should_accept_turn_event(&workspace_path, session_id, turn_id)
                            .await?
                        {
                            return Ok(());
                        }
                        self.record_event_note(
                            &workspace_path,
                            session_id,
                            format!("Turn {} failed: {}", turn_id, error),
                        )
                        .await?;
                    }
                    SessionTurnOutcome::Cancelled { reason, actor: _ } => {
                        if !self
                            .should_accept_turn_event(&workspace_path, session_id, turn_id)
                            .await?
                            && !owner.as_ref().is_some_and(SessionWorkOwner::is_goal)
                        {
                            return Ok(());
                        }
                        if matches!(
                            reason,
                            TurnCancellationReason::UserRequested
                                | TurnCancellationReason::GoalControl
                                | TurnCancellationReason::Unknown
                        ) {
                            self.pause_goal_after_session_stop(
                                &workspace_path,
                                session_id,
                                "Goal paused because the related turn was cancelled",
                            )
                            .await?;
                        }
                    }
                }
            }
            SessionHookKind::TurnCancellationRequested {
                turn_id,
                owner,
                reason,
                actor: _,
                surface_mode,
            } => {
                if !matches!(surface_mode, SessionSurfaceMode::UserVisible) {
                    return Ok(());
                }
                if !self
                    .should_accept_turn_event(&workspace_path, session_id, turn_id)
                    .await?
                    && !owner.as_ref().is_some_and(SessionWorkOwner::is_goal)
                {
                    return Ok(());
                }
                self.record_event_note(
                    &workspace_path,
                    session_id,
                    format!(
                        "Turn {} cancellation requested: {}",
                        turn_id,
                        reason.as_str()
                    ),
                )
                .await?;
                if matches!(
                    reason,
                    TurnCancellationReason::UserRequested | TurnCancellationReason::GoalControl
                ) {
                    self.pause_goal_after_session_stop(
                        &workspace_path,
                        session_id,
                        "Goal paused because the related turn cancellation was requested",
                    )
                    .await?;
                }
            }
            SessionHookKind::QueueChanged { reason, .. } => {
                if reason == "run_failed" {
                    let _ = self
                        .reconcile_active_goal(
                            &workspace_path,
                            session_id,
                            None,
                            "queue_paused_after_run_failed",
                        )
                        .await?;
                }
            }
            SessionHookKind::ToolFailed {
                turn_id,
                tool_name,
                error,
                surface_mode,
            } => {
                if !matches!(surface_mode, SessionSurfaceMode::UserVisible) {
                    return Ok(());
                }
                if !self
                    .should_accept_turn_event(&workspace_path, session_id, turn_id)
                    .await?
                {
                    return Ok(());
                }
                self.record_event_note(
                    &workspace_path,
                    session_id,
                    format!("Tool {} failed during goal work: {}", tool_name, error),
                )
                .await?;
            }
            SessionHookKind::ToolAttentionNeeded {
                turn_id,
                tool_name,
                reason: _,
                surface_mode,
            } => {
                if !matches!(surface_mode, SessionSurfaceMode::UserVisible) {
                    return Ok(());
                }
                self.handle_tool_confirmation(&workspace_path, session_id, turn_id, tool_name)
                    .await?;
            }
            SessionHookKind::TurnSubmitted { .. }
            | SessionHookKind::TurnQueued { .. }
            | SessionHookKind::TurnStarted { .. }
            | SessionHookKind::TurnProgressed { .. } => {}
        }

        Ok(())
    }

    async fn pause_goal_after_session_stop(
        &self,
        workspace_path: &str,
        session_id: &str,
        reason: &str,
    ) -> CoreResult<()> {
        let _guard = self.lock_session(session_id).await;
        let Some(mut record) = self.current(Path::new(workspace_path), session_id).await? else {
            return Ok(());
        };
        if !record.status.is_driver_authorized() && !record.status.is_loop_active() {
            return Ok(());
        }
        let _ = self
            .driver
            .delete_queued_turns(session_id, SessionWorkOwnerMatcher::AnyGoal, None)
            .await?;
        record.status = GoalStatus::Paused;
        record.driver.phase = GoalDriverPhase::Idle;
        record.driver.last_reason = Some(reason.to_string());
        record.driver.updated_at_ms = Some(now_ms());
        self.save_status(Path::new(workspace_path), session_id, &mut record, reason)
            .await
    }

    async fn handle_tool_confirmation(
        &self,
        workspace_path: &str,
        session_id: &str,
        turn_id: &str,
        tool_name: &str,
    ) -> CoreResult<()> {
        let _guard = self.lock_session(session_id).await;
        let Some(mut record) = self.current(Path::new(workspace_path), session_id).await? else {
            return Ok(());
        };
        if !record.status.is_loop_active() || !Self::record_applies_to_turn(&record, turn_id) {
            return Ok(());
        }
        record.status = GoalStatus::WaitingUser;
        record.driver.phase = GoalDriverPhase::Idle;
        record.driver.last_reason = Some(format!("Tool {} requires confirmation", tool_name));
        record.driver.updated_at_ms = Some(now_ms());
        self.save_status(
            Path::new(workspace_path),
            session_id,
            &mut record,
            &format!("Tool {} requires confirmation", tool_name),
        )
        .await
    }

    pub(super) async fn should_accept_turn_event(
        &self,
        workspace_path: &str,
        session_id: &str,
        turn_id: &str,
    ) -> CoreResult<bool> {
        let Some(record) = self.current(Path::new(workspace_path), session_id).await? else {
            return Ok(false);
        };
        Ok(Self::record_applies_to_turn(&record, turn_id))
    }

    pub(super) fn record_applies_to_turn(record: &GoalRecord, turn_id: &str) -> bool {
        match record.progress.trigger_turn_id.as_deref() {
            Some(trigger_turn_id)
                if record.progress.last_turn_id.as_deref() != Some(trigger_turn_id) =>
            {
                turn_id == trigger_turn_id
            }
            _ => true,
        }
    }

    async fn record_event_note(
        &self,
        workspace_path: &str,
        session_id: &str,
        note: String,
    ) -> CoreResult<()> {
        let _guard = self.lock_session(session_id).await;
        if self
            .current(Path::new(workspace_path), session_id)
            .await?
            .is_some()
        {
            let _ = self
                .record_progress_locked(Path::new(workspace_path), session_id, note)
                .await?;
        }
        Ok(())
    }

    // -- Create / update -----------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    async fn create_or_update_from_extraction(
        &self,
        workspace_path: &Path,
        workspace_path_string: &str,
        session_id: &str,
        agent_type: Option<&str>,
        run: &GoalExtractionRun,
        result: GoalExtractionResult,
    ) -> CoreResult<GoalResponse> {
        let contract = result
            .contract
            .clone()
            .ok_or_else(|| CoreError::validation("Goal contract is required"))?;
        let context_resolution = result
            .context_resolution
            .clone()
            .ok_or_else(|| CoreError::validation("Goal context resolution is required"))?;
        let now = now_ms();
        let latest_extraction = GoalExtractionSummary {
            extraction_id: run.extraction_id.clone(),
            status: run.status.clone(),
            confidence: result.confidence,
            intent: result.intent.kind.clone(),
            warnings: result.warnings.clone(),
            updated_at_ms: now,
        };

        let deleted_stale_goal_turns = self
            .driver
            .delete_queued_turns(
                session_id,
                SessionWorkOwnerMatcher::AnyGoal,
                Some(&run.trigger_turn_id),
            )
            .await?;
        let configured_budgets = self.configured_goal_budgets().await;

        let mut previous_objective_for_event: Option<String> = None;
        let current_goal = self.store.load_current(workspace_path, session_id).await?;
        if run.request_message.payload.entry.has_goal_prefix
            && !matches!(
                result.intent.kind,
                GoalIntentKind::UpdateGoal | GoalIntentKind::ApplyGuidance
            )
            && !current_goal
                .as_ref()
                .is_some_and(|record| Self::record_matches_extraction(record, run))
        {
            return Ok(GoalResponse {
                accepted: true,
                message: "Goal refinement ignored because the goal changed".to_string(),
                goal: current_goal,
                extraction: None,
                judge: None,
            });
        }

        let record = match current_goal {
            Some(mut current)
                if Self::record_matches_extraction(&current, run)
                    || matches!(
                        result.intent.kind,
                        GoalIntentKind::UpdateGoal | GoalIntentKind::ApplyGuidance
                    ) =>
            {
                let is_initial_refinement = Self::record_matches_extraction(&current, run);
                let previous_status = current.status.clone();
                let previous_driver = current.driver.clone();
                previous_objective_for_event = Some(current.contract.resolved_objective.clone());
                current.contract = contract;
                current.context = GoalContextSnapshot {
                    frozen_context_markdown: context_resolution.frozen_context_markdown,
                };
                if !is_initial_refinement || current.status.is_driver_authorized() {
                    current.status = GoalStatus::Active;
                    current.driver = GoalDriverState {
                        phase: GoalDriverPhase::Recovering,
                        last_reason: Some(if is_initial_refinement {
                            "Goal refined from extraction".to_string()
                        } else {
                            "Goal updated".to_string()
                        }),
                        last_turn_id: Some(run.trigger_turn_id.clone()),
                        interrupted_attempts: 0,
                        updated_at_ms: Some(now),
                    };
                } else {
                    current.status = previous_status;
                    current.driver = previous_driver;
                }
                current.pending_user_question = None;
                current.latest_extraction = Some(latest_extraction);
                current.latest_judgment = None;
                if is_initial_refinement {
                    current.progress.trigger_turn_id = Some(run.trigger_turn_id.clone());
                    current.progress.remaining_gaps.clear();
                    current.progress.no_progress_streak = 0;
                    current.progress.last_met_count = 0;
                    current.progress.last_summary = None;
                } else {
                    current.progress = GoalProgress {
                        trigger_turn_id: Some(run.trigger_turn_id.clone()),
                        ..GoalProgress::default()
                    };
                }
                current.budgets = configured_budgets;
                current.revision += 1;
                current.updated_at_ms = now;
                current
            }
            _ => GoalRecord {
                goal_id: format!("goal-{}", Uuid::new_v4()),
                session_id: session_id.to_string(),
                revision: 1,
                status: GoalStatus::Active,
                contract,
                context: GoalContextSnapshot {
                    frozen_context_markdown: context_resolution.frozen_context_markdown,
                },
                progress: GoalProgress {
                    trigger_turn_id: Some(run.trigger_turn_id.clone()),
                    ..GoalProgress::default()
                },
                driver: GoalDriverState {
                    phase: GoalDriverPhase::Recovering,
                    last_reason: Some("Goal created".to_string()),
                    last_turn_id: Some(run.trigger_turn_id.clone()),
                    interrupted_attempts: 0,
                    updated_at_ms: Some(now),
                },
                budgets: configured_budgets,
                latest_extraction: Some(latest_extraction),
                latest_judgment: None,
                pending_user_question: None,
                created_at_ms: now,
                updated_at_ms: now,
            },
        };

        let store_event = match previous_objective_for_event {
            Some(previous_objective) => GoalStoreEvent::Updated {
                goal_id: record.goal_id.clone(),
                revision: record.revision,
                previous_objective,
                objective: record.contract.resolved_objective.clone(),
                extraction_id: run.extraction_id.clone(),
            },
            None => GoalStoreEvent::Created {
                goal_id: record.goal_id.clone(),
                revision: record.revision,
                objective: record.contract.resolved_objective.clone(),
                extraction_id: run.extraction_id.clone(),
            },
        };
        self.store
            .append_event(workspace_path, session_id, &store_event)
            .await?;
        let create_message = if run.rejection_reason.is_some() {
            GOAL_EXTRACTION_FALLBACK_MESSAGE
        } else {
            "Goal created or updated"
        };
        self.save_current_goal(workspace_path, session_id, &record, Some(create_message))
            .await?;
        self.store
            .save_snapshot(workspace_path, session_id, &record)
            .await?;
        let snapshot = self.driver.snapshot(session_id).await?;
        if deleted_stale_goal_turns > 0 && snapshot.queue_depth > 0 {
            if let Err(error) = self.driver.resume_queue(session_id).await {
                log::debug!(
                    "Failed to resume dialog queue after replacing stale goal turns: {}",
                    error
                );
            }
        }

        // If the trigger (owner) turn already finished before the goal existed,
        // judge it now; otherwise its DialogTurnCompleted event will judge it.
        if record.status.is_loop_active()
            && self
                .is_trigger_turn_completed(session_id, &run.trigger_turn_id)
                .await?
        {
            // Mark the trigger turn as judged so every later continuation turn
            // is eligible for judging (see `record_applies_to_turn`).
            let mut record = record;
            record.progress.last_turn_id = Some(run.trigger_turn_id.clone());
            return self
                .run_judge_for_record(
                    workspace_path,
                    workspace_path_string,
                    session_id,
                    record,
                    agent_type,
                    GoalJudgeTrigger::TurnCompleted,
                )
                .await;
        }

        Ok(GoalResponse {
            accepted: true,
            message: format!("Goal created: {}", record.contract.resolved_objective),
            goal: Some(record),
            extraction: None,
            judge: None,
        })
    }

    async fn queue_goal_edit_steering(
        &self,
        workspace_path: &str,
        previous_objective: &str,
        record: &GoalRecord,
        agent_type: Option<&str>,
    ) -> CoreResult<()> {
        if !record.status.is_loop_active() {
            return Ok(());
        }

        let steering_text = render_goal_edit_steering(previous_objective, record);
        let display_text = render_goal_edit_display_message(record);
        let system_reminder = GoalReminderBuilder::system_reminder(record);
        let turn_id = format!("goal-edit-steering-{}", Uuid::new_v4());
        let metadata = json!({
            "goal": {
                "kind": "user_edit_steering",
                "goalId": record.goal_id.clone(),
                "revision": record.revision,
                "previousObjective": previous_objective,
                "newObjective": record.contract.resolved_objective.clone(),
            }
        });

        let submit_result = self
            .driver
            .submit_turn(SessionDriverSubmit {
                session_id: record.session_id.clone(),
                workspace_path: workspace_path.to_string(),
                user_input: steering_text,
                original_user_input: Some(display_text),
                turn_id: Some(turn_id),
                agent_type: agent_type.unwrap_or("Runno").to_string(),
                system_reminder_override: Some(system_reminder),
                owner: SessionWorkOwner::goal(record.goal_id.clone(), record.revision),
                queue_priority: crate::agentic::coordination::DialogQueuePriority::High,
                skip_tool_confirmation: true,
                metadata: Some(metadata),
            })
            .await?;

        if let SessionDriverSubmitOutcome::Queued { turn_id, .. } = submit_result {
            self.driver
                .guide_queued_turn(&record.session_id, &turn_id)
                .await?;
        }

        Ok(())
    }

    pub(super) async fn is_trigger_turn_completed(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> CoreResult<bool> {
        self.driver.is_turn_completed(session_id, turn_id).await
    }

    // -- Persistence helpers (shared with goal_loop) -------------------------

    pub(super) async fn save_status(
        &self,
        workspace_path: &Path,
        session_id: &str,
        record: &mut GoalRecord,
        reason: &str,
    ) -> CoreResult<()> {
        record.revision += 1;
        record.updated_at_ms = now_ms();
        self.store
            .append_event(
                workspace_path,
                session_id,
                &GoalStoreEvent::StatusChanged {
                    goal_id: record.goal_id.clone(),
                    revision: record.revision,
                    status: record.status.clone(),
                    reason: reason.to_string(),
                },
            )
            .await?;
        self.save_current_goal(workspace_path, session_id, record, Some(reason))
            .await
    }

    pub(super) async fn save_current_goal(
        &self,
        workspace_path: &Path,
        session_id: &str,
        record: &GoalRecord,
        message: Option<&str>,
    ) -> CoreResult<()> {
        self.store
            .save_current(workspace_path, session_id, record)
            .await?;
        self.emit_goal_lifecycle_event(
            "goal_updated",
            workspace_path,
            session_id,
            Some(record),
            None,
            None,
            message,
        )
        .await;
        Ok(())
    }

    async fn save_extraction_run(
        &self,
        workspace_path: &Path,
        session_id: &str,
        run: &GoalExtractionRun,
    ) -> CoreResult<()> {
        self.save_extraction_run_with_message(workspace_path, session_id, run, None)
            .await
    }

    async fn save_extraction_run_with_message(
        &self,
        workspace_path: &Path,
        session_id: &str,
        run: &GoalExtractionRun,
        message: Option<&str>,
    ) -> CoreResult<()> {
        self.store
            .save_extraction_run(workspace_path, session_id, run)
            .await?;
        self.store
            .append_event(
                workspace_path,
                session_id,
                &GoalStoreEvent::ExtractionRunRecorded {
                    extraction_id: run.extraction_id.clone(),
                    session_id: session_id.to_string(),
                    status: run.status.clone(),
                    audit: run.audit.clone(),
                },
            )
            .await?;
        self.emit_goal_lifecycle_event(
            "goal_extraction_run",
            workspace_path,
            session_id,
            None,
            Some(run),
            None,
            message,
        )
        .await;
        Ok(())
    }

    pub(super) async fn save_judge_run(
        &self,
        workspace_path: &Path,
        session_id: &str,
        run: &GoalJudgeRun,
    ) -> CoreResult<()> {
        self.store
            .save_judge_run(workspace_path, session_id, run)
            .await?;
        self.store
            .append_event(
                workspace_path,
                session_id,
                &GoalStoreEvent::JudgeRunRecorded {
                    judge_id: run.judge_id.clone(),
                    goal_id: run.goal_id.clone(),
                    revision: run.goal_revision,
                    status: run.status.clone(),
                    audit: run.audit.clone(),
                },
            )
            .await?;
        let goal = self
            .current(workspace_path, session_id)
            .await
            .ok()
            .flatten();
        self.emit_goal_lifecycle_event(
            "goal_judge_run",
            workspace_path,
            session_id,
            goal.as_ref(),
            None,
            Some(run),
            None,
        )
        .await;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn emit_goal_lifecycle_event(
        &self,
        event_type: &str,
        workspace_path: &Path,
        session_id: &str,
        goal: Option<&GoalRecord>,
        extraction: Option<&GoalExtractionRun>,
        judge: Option<&GoalJudgeRun>,
        message: Option<&str>,
    ) {
        let payload = json!({
            "eventType": event_type,
            "sessionId": session_id,
            "workspacePath": workspace_path.to_string_lossy().to_string(),
            "goal": goal,
            "extraction": extraction,
            "judge": judge,
            "message": message,
            "updatedAtMs": now_ms(),
        });

        if let Err(error) = emit_global_event(BackendEvent::Custom {
            event_name: "agentic://goal-event".to_string(),
            payload,
        })
        .await
        {
            log::debug!("Failed to emit goal lifecycle event: {}", error);
        }
    }

    pub(super) async fn require_current(
        &self,
        workspace_path: &Path,
        session_id: &str,
    ) -> CoreResult<GoalRecord> {
        self.store
            .load_current(workspace_path, session_id)
            .await?
            .ok_or_else(|| CoreError::validation("No active goal for this session"))
    }

    fn validate_expected(
        &self,
        record: &GoalRecord,
        expected_goal_id: Option<&str>,
        expected_revision: Option<u64>,
    ) -> CoreResult<()> {
        if let Some(goal_id) = expected_goal_id {
            if goal_id != record.goal_id {
                return Err(CoreError::validation(format!(
                    "Goal id mismatch: expected {} but current is {}",
                    goal_id, record.goal_id
                )));
            }
        }
        if let Some(revision) = expected_revision {
            if revision != record.revision {
                return Err(CoreError::validation(format!(
                    "Goal revision mismatch: expected {} but current is {}",
                    revision, record.revision
                )));
            }
        }
        Ok(())
    }
}

pub(super) fn push_bounded<T>(buffer: &mut Vec<T>, value: T, max_len: usize) {
    buffer.push(value);
    if buffer.len() > max_len {
        let overflow = buffer.len() - max_len;
        buffer.drain(0..overflow);
    }
}

struct ParsedGoalExtraction {
    result: GoalExtractionResult,
    parser_status: String,
    rejection_reason: Option<String>,
}

fn parse_goal_extraction_output(
    run: &GoalExtractionRun,
    output_text: &str,
    explicit_goal_command: bool,
) -> CoreResult<ParsedGoalExtraction> {
    let result = match GoalStructuredOutputParser::parse_json::<GoalExtractionResult>(
        output_text,
        "goal extraction",
    ) {
        Ok(result) => result,
        Err(error) if explicit_goal_command => {
            return Ok(fallback_goal_extraction_parse(
                run,
                "fallback_after_parse_rejection",
                error.to_string(),
            ));
        }
        Err(error) => return Err(error),
    };

    match GoalValidationGate::validate_extraction(run, &result) {
        Ok(()) => Ok(ParsedGoalExtraction {
            result,
            parser_status: "accepted".to_string(),
            rejection_reason: None,
        }),
        Err(error) if explicit_goal_command => Ok(fallback_goal_extraction_parse(
            run,
            "fallback_after_validation_rejection",
            error.to_string(),
        )),
        Err(error) => Err(error),
    }
}

fn fallback_goal_extraction_parse(
    run: &GoalExtractionRun,
    parser_status: &str,
    rejection_reason: String,
) -> ParsedGoalExtraction {
    let result = fallback_extraction_result(
        run,
        "Explicit /goal command accepted with command-derived fallback contract.",
        vec![format!(
            "Extractor output was not accepted; using command-derived fallback contract: {}",
            rejection_reason
        )],
    );
    ParsedGoalExtraction {
        result,
        parser_status: parser_status.to_string(),
        rejection_reason: Some(rejection_reason),
    }
}

fn fallback_goal_edit_result(
    extraction_id: &str,
    intake: &GoalTextIntake,
    edited_objective: &str,
    target_goal_id: &str,
) -> GoalExtractionResult {
    let objective = edited_objective.trim();
    let contract = GoalContract {
        raw_trigger: edited_objective.to_string(),
        resolved_objective: objective.to_string(),
        success_criteria: vec![GoalCriterion {
            id: "criterion-1".to_string(),
            description: "Deliver the updated goal and verify the final user-visible result."
                .to_string(),
            required: true,
        }],
        required_checks: Vec::new(),
        non_goals: Vec::new(),
        constraints: vec![
            "The edited goal replaces the previous active goal immediately.".to_string(),
        ],
        risk_level: GoalRiskLevel::Medium,
    };
    GoalExtractionResult {
        extraction_id: extraction_id.to_string(),
        parent_session_id: intake.session_id.clone(),
        trigger_turn_id: intake.trigger_turn_id.clone(),
        intent: GoalIntentDecision {
            kind: GoalIntentKind::UpdateGoal,
            confidence: 1.0,
            raw_trigger: edited_objective.to_string(),
            target_goal_id: Some(target_goal_id.to_string()),
            control_action: None,
            reason_summary: "The user edited the active goal.".to_string(),
            clarification_questions: Vec::new(),
        },
        context_resolution: Some(GoalContextResolution {
            resolved_objective: objective.to_string(),
            frozen_context_markdown: format!("User-edited goal:\n\n{}", objective),
            confidence: 1.0,
            ambiguity_questions: Vec::new(),
        }),
        contract: Some(contract),
        confidence: 1.0,
        warnings: Vec::new(),
    }
}

fn extraction_summary_from_run(run: &GoalExtractionRun) -> GoalExtractionSummary {
    let result = run.result.as_ref();
    GoalExtractionSummary {
        extraction_id: run.extraction_id.clone(),
        status: run.status.clone(),
        confidence: result.map(|result| result.confidence).unwrap_or(0.0),
        intent: result
            .map(|result| result.intent.kind.clone())
            .unwrap_or(GoalIntentKind::CreateGoal),
        warnings: result
            .map(|result| result.warnings.clone())
            .unwrap_or_default(),
        updated_at_ms: run.updated_at_ms,
    }
}

fn direct_goal_control_action(intake: &GoalTextIntake) -> Option<GoalControlAction> {
    let body = goal_command_body(&intake.raw_input)?;
    match body.trim().to_ascii_lowercase().as_str() {
        "" | "status" => Some(GoalControlAction::Status),
        "pause" => Some(GoalControlAction::Pause),
        "resume" => Some(GoalControlAction::Resume),
        "clear" | "cancel" => Some(GoalControlAction::Clear),
        "review" => Some(GoalControlAction::Review),
        _ => None,
    }
}

fn immediate_goal_objective(intake: &GoalTextIntake) -> Option<String> {
    let body = goal_command_body(&intake.raw_input)?;
    let objective = body.trim();
    if objective.is_empty() {
        return None;
    }
    let lower = objective.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "status" | "pause" | "resume" | "clear" | "cancel" | "review"
    ) {
        return None;
    }
    Some(objective.to_string())
}

fn goal_command_body(raw_input: &str) -> Option<String> {
    let trimmed = raw_input.trim_start();
    let prefix = trimmed.get(..5)?;
    if !prefix.eq_ignore_ascii_case("/goal") {
        return None;
    }
    Some(trimmed.get(5..).unwrap_or_default().trim().to_string())
}

fn render_goal_edit_steering(previous_objective: &str, record: &GoalRecord) -> String {
    format!(
        "User goal update received while this session is active.\n\nPrevious goal:\n{}\n\nNew active goal:\n{}\n\nEffective immediately:\n- Treat the new active goal as the objective for this session.\n- Re-evaluate the current step against the new goal before continuing.\n- Carry over prior work only when it still helps the new goal.\n- Do not claim completion based on the previous goal.",
        previous_objective.trim(),
        record.contract.resolved_objective.trim()
    )
}

fn render_goal_edit_display_message(record: &GoalRecord) -> String {
    format!(
        "Goal updated by user:\n{}",
        record.contract.resolved_objective.trim()
    )
}

pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_run(raw_input: &str, has_goal_prefix: bool) -> GoalExtractionRun {
        GoalExtractionRun {
            extraction_id: "goal-extraction-test".to_string(),
            parent_session_id: "session-test".to_string(),
            extraction_session_id: None,
            trigger_turn_id: "turn-test".to_string(),
            raw_input: raw_input.to_string(),
            checkpoint_event_id: "turn-test".to_string(),
            status: GoalExtractionStatus::Running,
            request_message: GoalExtractionRequestMessage {
                extraction_id: "goal-extraction-test".to_string(),
                instruction_version: "test".to_string(),
                fixed_instruction: "test".to_string(),
                payload: GoalExtractionPayload {
                    raw_input: raw_input.to_string(),
                    entry: GoalEntryMetadata {
                        source: "test".to_string(),
                        has_goal_prefix,
                        prefix: has_goal_prefix.then(|| "/goal".to_string()),
                    },
                    active_goal: None,
                },
                output_schema: "{}".to_string(),
            },
            final_text: None,
            result: None,
            rejection_reason: None,
            audit: GoalRunAudit::pending("test", false),
            created_at_ms: 1,
            updated_at_ms: 1,
        }
    }

    fn malformed_model_extraction() -> String {
        serde_json::json!({
            "extractionId": "goal-extraction-test",
            "parentSessionId": "",
            "triggerTurnId": "",
            "intent": {
                "kind": "create_goal",
                "confidence": 0.97,
                "rawTrigger": "/goal analyze architecture",
                "reasonSummary": "The user explicitly requested goal mode.",
                "clarificationQuestions": []
            },
            "contract": { "title": "Analyze architecture" },
            "confidence": 0.97,
            "warnings": []
        })
        .to_string()
    }

    fn sample_intake(raw_input: &str) -> GoalTextIntake {
        GoalTextIntake {
            session_id: "session-test".to_string(),
            workspace_path: "workspace-test".to_string(),
            agent_type: None,
            trigger_turn_id: "turn-test".to_string(),
            raw_input: raw_input.to_string(),
            skip_initial_continuation: false,
            entry: GoalEntryMetadata {
                source: "test".to_string(),
                has_goal_prefix: raw_input.trim_start().starts_with("/goal"),
                prefix: Some("/goal".to_string()),
            },
        }
    }

    #[test]
    fn goal_slash_exact_controls_do_not_become_objectives() {
        let pause = sample_intake("/goal pause");
        let status = sample_intake("/goal");

        assert_eq!(
            direct_goal_control_action(&pause),
            Some(GoalControlAction::Pause)
        );
        assert_eq!(
            direct_goal_control_action(&status),
            Some(GoalControlAction::Status)
        );
        assert_eq!(immediate_goal_objective(&pause), None);
        assert_eq!(immediate_goal_objective(&status), None);
    }

    #[test]
    fn goal_slash_free_text_is_the_immediate_objective() {
        let intake = sample_intake("/goal pause work on the release and audit the UI");

        assert_eq!(direct_goal_control_action(&intake), None);
        assert_eq!(
            immediate_goal_objective(&intake),
            Some("pause work on the release and audit the UI".to_string())
        );
    }

    #[test]
    fn explicit_goal_falls_back_when_model_output_shape_drifts() {
        let run = sample_run("/goal analyze architecture", true);

        let parsed =
            parse_goal_extraction_output(&run, &malformed_model_extraction(), true).unwrap();

        assert_eq!(
            parsed.parser_status,
            "fallback_after_parse_rejection".to_string()
        );
        assert_eq!(parsed.result.intent.kind, GoalIntentKind::CreateGoal);
        assert_eq!(
            parsed.result.contract.unwrap().resolved_objective,
            "analyze architecture"
        );
        assert!(parsed.rejection_reason.is_some());
    }

    #[test]
    fn non_explicit_goal_keeps_strict_rejection() {
        let run = sample_run("analyze architecture", false);
        let result = parse_goal_extraction_output(&run, &malformed_model_extraction(), false);
        assert!(result.is_err());
    }

    #[test]
    fn goal_edit_fallback_treats_control_words_as_objective() {
        let intake = GoalTextIntake {
            session_id: "session-test".to_string(),
            workspace_path: "workspace-test".to_string(),
            agent_type: None,
            trigger_turn_id: "turn-test".to_string(),
            raw_input: "pause".to_string(),
            skip_initial_continuation: false,
            entry: GoalEntryMetadata {
                source: "goal_edit".to_string(),
                has_goal_prefix: true,
                prefix: Some("goal_edit".to_string()),
            },
        };

        let result = fallback_goal_edit_result("goal-extraction-test", &intake, "pause", "goal-1");

        assert_eq!(result.intent.kind, GoalIntentKind::UpdateGoal);
        assert_eq!(result.intent.target_goal_id, Some("goal-1".to_string()));
        assert_eq!(
            result.contract.unwrap().resolved_objective,
            "pause".to_string()
        );
    }
}
