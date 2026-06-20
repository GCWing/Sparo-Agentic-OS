use super::extraction::{fallback_extraction_result, GoalExtractionRunRequest, GoalForkRunner};
use super::fork_message::GoalForkMessageBuilder;
use super::intake::TextIntakeAnnotator;
use super::model::*;
use super::output_parser::GoalStructuredOutputParser;
use super::store::GoalStore;
use super::validation::GoalValidationGate;
use crate::agentic::coordination::DialogScheduler;
use crate::agentic::core::SessionState;
use crate::agentic::events::{AgenticEvent, SessionSurfaceMode, ToolEventData};
use crate::infrastructure::events::{emit_global_event, BackendEvent};
use crate::service::session::TurnStatus;
use crate::util::errors::{BitFunError, BitFunResult};
use serde_json::json;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, OwnedMutexGuard};
use uuid::Uuid;

pub(super) const GOAL_EXTRACTION_FALLBACK_MESSAGE: &str =
    "AI goal extraction failed; using the user's input as the goal.";

#[derive(Clone)]
pub struct GoalService {
    pub(super) store: Arc<GoalStore>,
    pub(super) scheduler: Arc<DialogScheduler>,
    pub(super) fork_runner: Arc<dyn GoalForkRunner>,
    /// Per-session write lock. Every mutation of a session's goal goes through
    /// this lock, making the service the single writer and removing the
    /// read-modify-write races the old design had.
    locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

impl GoalService {
    pub fn new(
        store: Arc<GoalStore>,
        scheduler: Arc<DialogScheduler>,
        fork_runner: Arc<dyn GoalForkRunner>,
    ) -> Self {
        Self {
            store,
            scheduler,
            fork_runner,
            locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn store(&self) -> Arc<GoalStore> {
        self.store.clone()
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
    ) -> BitFunResult<Option<GoalRecord>> {
        self.store
            .load_current(workspace_path.as_ref(), session_id)
            .await
    }

    pub async fn status(&self, request: GoalStatusRequest) -> BitFunResult<GoalResponse> {
        let goal = self
            .current(Path::new(&request.workspace_path), &request.session_id)
            .await?;
        Ok(GoalResponse {
            accepted: true,
            message: match &goal {
                Some(record) => format!(
                    "Goal {} is {:?} at revision {}",
                    record.goal_id, record.status, record.revision
                ),
                None => "No active goal for this session".to_string(),
            },
            goal,
            extraction: None,
            judge: None,
        })
    }

    // -- Intake --------------------------------------------------------------

    pub async fn handle_text_intake(
        &self,
        request: GoalUserRequest,
    ) -> BitFunResult<Option<GoalResponse>> {
        let intake = TextIntakeAnnotator::annotate(request);
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
        self.save_extraction_run(workspace_path, &intake.session_id, &run)
            .await?;

        let output = match self
            .fork_runner
            .run_extraction(GoalExtractionRunRequest {
                workspace_path: intake.workspace_path.clone(),
                agent_type: intake.agent_type.clone(),
                run: run.clone(),
            })
            .await
        {
            Ok(output) => output,
            Err(error) => {
                run.status = GoalExtractionStatus::Failed;
                run.rejection_reason = Some(error.to_string());
                run.updated_at_ms = now_ms();
                self.save_extraction_run(workspace_path, &intake.session_id, &run)
                    .await?;
                if !intake.entry.has_goal_prefix {
                    return Ok(None);
                }
                return Ok(Some(GoalResponse {
                    accepted: false,
                    message: format!("Goal extraction failed: {}", error),
                    goal: active_goal,
                    extraction: Some(run),
                    judge: None,
                }));
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
                run.status = GoalExtractionStatus::Rejected;
                run.audit.parser_status = Some("rejected".to_string());
                run.rejection_reason = Some(error.to_string());
                run.updated_at_ms = now_ms();
                self.save_extraction_run(workspace_path, &intake.session_id, &run)
                    .await?;
                if !intake.entry.has_goal_prefix {
                    return Ok(None);
                }
                return Ok(Some(GoalResponse {
                    accepted: false,
                    message: format!("Goal extraction rejected: {}", error),
                    goal: active_goal,
                    extraction: Some(run),
                    judge: None,
                }));
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
        self.save_extraction_run_with_message(
            workspace_path,
            &intake.session_id,
            &run,
            fallback_message,
        )
        .await?;

        match result.intent.kind.clone() {
            GoalIntentKind::ChatOnly => Ok(None),
            GoalIntentKind::QueryGoal => Ok(Some(
                self.status(GoalStatusRequest {
                    session_id: intake.session_id,
                    workspace_path: intake.workspace_path,
                })
                .await?,
            )),
            GoalIntentKind::ControlGoal => {
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
                Ok(Some(response))
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
                Ok(Some(response))
            }
            GoalIntentKind::AskClarification => {
                let question = result
                    .intent
                    .clarification_questions
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "Please clarify the goal before I continue.".to_string());
                let goal = if let Some(mut record) = active_goal {
                    record.status = GoalStatus::WaitingUser;
                    record.pending_user_question = Some(question.clone());
                    self.save_status(
                        workspace_path,
                        &intake.session_id,
                        &mut record,
                        "Goal clarification requested",
                    )
                    .await?;
                    Some(record)
                } else {
                    None
                };
                Ok(Some(GoalResponse {
                    accepted: true,
                    message: question,
                    goal,
                    extraction: Some(run),
                    judge: None,
                }))
            }
        }
    }

    // -- Control -------------------------------------------------------------

    pub async fn control(&self, request: GoalControlRequest) -> BitFunResult<GoalResponse> {
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
    ) -> BitFunResult<GoalResponse> {
        let mut record = self
            .store
            .load_current(workspace_path, session_id)
            .await?
            .ok_or_else(|| BitFunError::validation("No goal exists for this session"))?;
        let expected_revision = if action == GoalControlAction::Review {
            None
        } else {
            expected_revision
        };
        self.validate_expected(&record, expected_goal_id.as_deref(), expected_revision)?;

        match action {
            GoalControlAction::Status => Ok(GoalResponse {
                accepted: true,
                message: format!(
                    "Goal {} is {:?} at revision {}",
                    record.goal_id, record.status, record.revision
                ),
                goal: Some(record),
                extraction: None,
                judge: None,
            }),
            GoalControlAction::Review => {
                self.scheduler
                    .delete_queued_goal_turns(session_id, None)
                    .await;
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
                self.scheduler
                    .delete_queued_goal_turns(session_id, None)
                    .await;
                record.status = GoalStatus::Cancelled;
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
                self.scheduler
                    .delete_queued_goal_turns(session_id, None)
                    .await;
                record.status = GoalStatus::Paused;
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

    // -- Agent tool support --------------------------------------------------

    pub async fn record_progress(
        &self,
        workspace_path: &Path,
        session_id: &str,
        note: String,
    ) -> BitFunResult<GoalResponse> {
        let _guard = self.lock_session(session_id).await;
        self.record_progress_locked(workspace_path, session_id, note)
            .await
    }

    async fn record_progress_locked(
        &self,
        workspace_path: &Path,
        session_id: &str,
        note: String,
    ) -> BitFunResult<GoalResponse> {
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
    ) -> BitFunResult<GoalResponse> {
        let _guard = self.lock_session(session_id).await;
        let mut record = self.require_current(workspace_path, session_id).await?;
        record.status = GoalStatus::Blocked;
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

    // -- Events --------------------------------------------------------------

    pub async fn handle_event(&self, event: &AgenticEvent) -> BitFunResult<()> {
        match event {
            AgenticEvent::DialogTurnCompleted {
                session_id,
                turn_id,
                hidden_session,
                surface_mode,
                ..
            } => {
                if *hidden_session || !matches!(surface_mode, SessionSurfaceMode::UserVisible) {
                    return Ok(());
                }
                self.judge_after_turn(session_id, turn_id).await
            }
            AgenticEvent::DialogTurnFailed {
                session_id,
                turn_id,
                surface_mode,
                error,
                ..
            } => {
                if !matches!(surface_mode, SessionSurfaceMode::UserVisible) {
                    return Ok(());
                }
                if !self.should_accept_turn_event(session_id, turn_id).await? {
                    return Ok(());
                }
                self.record_event_note(session_id, format!("Turn {} failed: {}", turn_id, error))
                    .await
            }
            AgenticEvent::DialogTurnCancelled {
                session_id,
                turn_id,
                surface_mode,
                ..
            } => {
                if !matches!(surface_mode, SessionSurfaceMode::UserVisible) {
                    return Ok(());
                }
                if !self.should_accept_turn_event(session_id, turn_id).await? {
                    return Ok(());
                }
                self.record_event_note(session_id, format!("Turn {} was cancelled", turn_id))
                    .await
            }
            AgenticEvent::ToolEvent {
                session_id,
                turn_id,
                tool_event,
                surface_mode,
                ..
            } => {
                if !matches!(surface_mode, SessionSurfaceMode::UserVisible) {
                    return Ok(());
                }
                self.handle_tool_event(session_id, turn_id, tool_event)
                    .await
            }
            _ => Ok(()),
        }
    }

    async fn handle_tool_event(
        &self,
        session_id: &str,
        turn_id: &str,
        tool_event: &ToolEventData,
    ) -> BitFunResult<()> {
        match tool_event {
            ToolEventData::Failed {
                tool_name, error, ..
            } => {
                self.record_event_note(
                    session_id,
                    format!("Tool {} failed during goal work: {}", tool_name, error),
                )
                .await
            }
            ToolEventData::ConfirmationNeeded { tool_name, .. } => {
                let _guard = self.lock_session(session_id).await;
                let Some(workspace_path) = self.session_workspace_path(session_id) else {
                    return Ok(());
                };
                let Some(mut record) = self.current(Path::new(&workspace_path), session_id).await?
                else {
                    return Ok(());
                };
                if !record.status.is_loop_active()
                    || !Self::record_applies_to_turn(&record, turn_id)
                {
                    return Ok(());
                }
                record.status = GoalStatus::WaitingUser;
                self.save_status(
                    Path::new(&workspace_path),
                    session_id,
                    &mut record,
                    &format!("Tool {} requires confirmation", tool_name),
                )
                .await
            }
            _ => Ok(()),
        }
    }

    pub(super) async fn should_accept_turn_event(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> BitFunResult<bool> {
        let Some(workspace_path) = self.session_workspace_path(session_id) else {
            return Ok(false);
        };
        let Some(record) = self.current(Path::new(&workspace_path), session_id).await? else {
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

    async fn record_event_note(&self, session_id: &str, note: String) -> BitFunResult<()> {
        let _guard = self.lock_session(session_id).await;
        let Some(workspace_path) = self.session_workspace_path(session_id) else {
            return Ok(());
        };
        if self
            .current(Path::new(&workspace_path), session_id)
            .await?
            .is_some()
        {
            let _ = self
                .record_progress_locked(Path::new(&workspace_path), session_id, note)
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
    ) -> BitFunResult<GoalResponse> {
        let contract = result
            .contract
            .clone()
            .ok_or_else(|| BitFunError::validation("Goal contract is required"))?;
        let context_resolution = result
            .context_resolution
            .clone()
            .ok_or_else(|| BitFunError::validation("Goal context resolution is required"))?;
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
            .scheduler
            .delete_queued_goal_turns(session_id, Some(&run.trigger_turn_id))
            .await;

        let record = match self.store.load_current(workspace_path, session_id).await? {
            Some(mut current)
                if matches!(
                    result.intent.kind,
                    GoalIntentKind::UpdateGoal | GoalIntentKind::ApplyGuidance
                ) =>
            {
                current.contract = contract;
                current.context = GoalContextSnapshot {
                    frozen_context_markdown: context_resolution.frozen_context_markdown,
                };
                current.status = GoalStatus::Active;
                current.pending_user_question = None;
                current.latest_extraction = Some(latest_extraction);
                current.progress.trigger_turn_id = Some(run.trigger_turn_id.clone());
                current.progress.last_turn_id = None;
                current.progress.remaining_gaps.clear();
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
                budgets: GoalBudgets::default(),
                latest_extraction: Some(latest_extraction),
                latest_judgment: None,
                pending_user_question: None,
                created_at_ms: now,
                updated_at_ms: now,
            },
        };

        self.store
            .append_event(
                workspace_path,
                session_id,
                &GoalStoreEvent::Created {
                    goal_id: record.goal_id.clone(),
                    revision: record.revision,
                    objective: record.contract.resolved_objective.clone(),
                    extraction_id: run.extraction_id.clone(),
                },
            )
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
        if deleted_stale_goal_turns > 0 && self.scheduler.queue_depth(session_id) > 0 {
            if let Err(error) = self.scheduler.resume_queue(session_id).await {
                log::debug!(
                    "Failed to resume dialog queue after replacing stale goal turns: {}",
                    error
                );
            }
        }

        // If the trigger (owner) turn already finished before the goal existed,
        // judge it now; otherwise its DialogTurnCompleted event will judge it.
        if self
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

    pub(super) async fn is_trigger_turn_completed(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> BitFunResult<bool> {
        let Some(session) = self.scheduler.session_manager().get_session(session_id) else {
            return Ok(false);
        };

        if matches!(
            session.state,
            SessionState::Processing {
                ref current_turn_id,
                ..
            } if current_turn_id == turn_id
        ) {
            return Ok(false);
        }

        if self
            .scheduler
            .list_queue(session_id)
            .iter()
            .any(|queued| queued.turn_id == turn_id)
        {
            return Ok(false);
        }

        let Some(turn_index) = session
            .dialog_turn_ids
            .iter()
            .position(|candidate| candidate == turn_id)
        else {
            return Ok(false);
        };
        let turns = self
            .scheduler
            .session_manager()
            .load_turns_in_range(session_id, turn_index, turn_index)
            .await?;

        Ok(turns
            .iter()
            .any(|turn| turn.turn_id == turn_id && matches!(turn.status, TurnStatus::Completed)))
    }

    // -- Persistence helpers (shared with goal_loop) -------------------------

    pub(super) async fn save_status(
        &self,
        workspace_path: &Path,
        session_id: &str,
        record: &mut GoalRecord,
        reason: &str,
    ) -> BitFunResult<()> {
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
    ) -> BitFunResult<()> {
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
    ) -> BitFunResult<()> {
        self.save_extraction_run_with_message(workspace_path, session_id, run, None)
            .await
    }

    async fn save_extraction_run_with_message(
        &self,
        workspace_path: &Path,
        session_id: &str,
        run: &GoalExtractionRun,
        message: Option<&str>,
    ) -> BitFunResult<()> {
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
    ) -> BitFunResult<()> {
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
    ) -> BitFunResult<GoalRecord> {
        self.store
            .load_current(workspace_path, session_id)
            .await?
            .ok_or_else(|| BitFunError::validation("No active goal for this session"))
    }

    fn validate_expected(
        &self,
        record: &GoalRecord,
        expected_goal_id: Option<&str>,
        expected_revision: Option<u64>,
    ) -> BitFunResult<()> {
        if let Some(goal_id) = expected_goal_id {
            if goal_id != record.goal_id {
                return Err(BitFunError::validation(format!(
                    "Goal id mismatch: expected {} but current is {}",
                    goal_id, record.goal_id
                )));
            }
        }
        if let Some(revision) = expected_revision {
            if revision != record.revision {
                return Err(BitFunError::validation(format!(
                    "Goal revision mismatch: expected {} but current is {}",
                    revision, record.revision
                )));
            }
        }
        Ok(())
    }

    pub(super) fn session_workspace_path(&self, session_id: &str) -> Option<String> {
        self.scheduler
            .session_manager()
            .get_session(session_id)
            .and_then(|session| session.config.workspace_path)
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
) -> BitFunResult<ParsedGoalExtraction> {
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
}
