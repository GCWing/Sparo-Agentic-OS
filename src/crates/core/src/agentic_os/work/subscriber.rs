use std::sync::Arc;

use crate::agentic::coordination::{
    DialogQueuePriority, DialogScheduler, DialogSubmissionPolicy, DialogTriggerSource,
};
use crate::agentic::core::PromptEnvelope;
use crate::agentic::events::{AgenticEvent, EventSubscriber, ToolEventData};
use crate::error::CoreResult;
use crate::infrastructure::try_get_path_manager_arc;

use super::{
    default_work_store, WorkExecutionAppBuilderContext, WorkExecutionBindingStatus,
    WorkExecutionSource, WorkRecord, WorkService,
};

pub struct WorkEventSubscriber {
    scheduler: Option<Arc<DialogScheduler>>,
}

impl WorkEventSubscriber {
    pub fn new() -> Self {
        Self { scheduler: None }
    }

    pub fn with_scheduler(scheduler: Arc<DialogScheduler>) -> Self {
        Self {
            scheduler: Some(scheduler),
        }
    }
}

#[async_trait::async_trait]
impl EventSubscriber for WorkEventSubscriber {
    async fn on_event(&self, event: &AgenticEvent) -> CoreResult<()> {
        let service = WorkService::new(default_work_store()?);
        match event {
            AgenticEvent::SessionTitleGenerated {
                session_id,
                title,
                method,
            } => {
                service
                    .sync_title_from_agent_session(
                        session_id,
                        title,
                        method.eq_ignore_ascii_case("manual"),
                    )
                    .await?;
            }
            AgenticEvent::DialogTurnStarted {
                session_id,
                turn_id,
                user_message_metadata,
                ..
            } => {
                service
                    .mark_agent_session_turn_started_with_app_builder_context(
                        session_id,
                        turn_id,
                        WorkExecutionAppBuilderContext::from_turn_metadata(
                            user_message_metadata.as_ref(),
                        ),
                    )
                    .await?;
            }
            AgenticEvent::DialogTurnCompleted { turn_id, .. } => {
                let work = service.mark_agent_session_turn_completed(turn_id).await?;
                self.queue_work_message(
                    &service,
                    work.as_ref(),
                    turn_id,
                    WorkExecutionBindingStatus::Completed,
                    None,
                )
                .await?;
            }
            AgenticEvent::DialogTurnFailed { turn_id, error, .. } => {
                let work = service
                    .mark_agent_session_turn_failed(turn_id, error)
                    .await?;
                self.queue_work_message(
                    &service,
                    work.as_ref(),
                    turn_id,
                    WorkExecutionBindingStatus::Failed,
                    Some(error.as_str()),
                )
                .await?;
            }
            AgenticEvent::DialogTurnCancelled { turn_id, .. } => {
                let work = service.mark_agent_session_turn_cancelled(turn_id).await?;
                self.queue_work_message(
                    &service,
                    work.as_ref(),
                    turn_id,
                    WorkExecutionBindingStatus::Cancelled,
                    None,
                )
                .await?;
            }
            AgenticEvent::ToolEvent {
                turn_id,
                tool_event,
                ..
            } => match tool_event {
                ToolEventData::ConfirmationNeeded { .. } => {
                    service
                        .mark_agent_session_turn_waiting_user(turn_id)
                        .await?;
                }
                ToolEventData::Confirmed { .. }
                | ToolEventData::Rejected { .. }
                | ToolEventData::Started { .. }
                | ToolEventData::Progress { .. }
                | ToolEventData::Streaming { .. }
                | ToolEventData::StreamChunk { .. } => {
                    service.mark_agent_session_turn_running(turn_id).await?;
                }
                _ => {}
            },
            _ => {}
        }
        Ok(())
    }
}

impl WorkEventSubscriber {
    async fn queue_work_message(
        &self,
        service: &WorkService,
        work: Option<&WorkRecord>,
        turn_id: &str,
        execution_status: WorkExecutionBindingStatus,
        error: Option<&str>,
    ) -> CoreResult<()> {
        let Some(scheduler) = self.scheduler.as_ref() else {
            return Ok(());
        };
        let Some(work) = work else {
            return Ok(());
        };
        let Some(owner) = work
            .delegation
            .as_ref()
            .and_then(|delegation| delegation.owner.as_ref())
        else {
            return Ok(());
        };
        if owner.session_id.trim().is_empty()
            || work
                .execution_bindings
                .iter()
                .any(|binding| binding.is_running())
        {
            return Ok(());
        }
        let Some(binding) = work.execution_bindings.iter().find(|binding| {
            matches!(
                &binding.source,
                WorkExecutionSource::AgentSessionRun {
                    turn_id: Some(binding_turn_id),
                    ..
                } if binding_turn_id == turn_id
            )
        }) else {
            return Ok(());
        };
        if binding.work_message_queued_at.is_some() {
            return Ok(());
        }

        let display_text = format_work_message_display(work, execution_status);
        let message = format_work_message_prompt(work, turn_id, execution_status, error);
        let workspace_path = owner.workspace_path.clone().or_else(|| {
            try_get_path_manager_arc().ok().map(|paths| {
                paths
                    .agentic_os_runtime_root()
                    .to_string_lossy()
                    .into_owned()
            })
        });
        let metadata = serde_json::json!({
            "workMessageKind": "execution_finished",
            "workMessageRole": work_message_role(work),
            "workId": work.id.as_str(),
            "workTitle": work.title.clone(),
            "workStatus": work.status,
            "workKind": work.kind,
            "workAgentType": work_agent_type(work),
            "workExecutionStatus": execution_status,
            "workTurnId": turn_id,
            "workExecutionBindingId": binding.id.clone(),
            "sourceSessionId": work.work_session_id(),
            "ownerTurnId": owner.turn_id.clone(),
        });
        let priority = match execution_status {
            WorkExecutionBindingStatus::Failed
            | WorkExecutionBindingStatus::Cancelled
            | WorkExecutionBindingStatus::Interrupted => DialogQueuePriority::High,
            _ => DialogQueuePriority::Normal,
        };
        let policy = DialogSubmissionPolicy::for_source(DialogTriggerSource::WorkMessage)
            .with_queue_priority(priority);

        scheduler
            .submit_with_metadata(
                owner.session_id.clone(),
                message,
                Some(display_text),
                None,
                String::new(),
                None,
                workspace_path,
                policy,
                None,
                None,
                Some(metadata),
            )
            .await
            .map_err(crate::error::CoreError::tool)?;
        service
            .mark_agent_session_turn_work_message_queued(turn_id)
            .await?;
        Ok(())
    }
}

fn format_work_message_display(
    work: &WorkRecord,
    execution_status: WorkExecutionBindingStatus,
) -> String {
    if work_message_role(work) == "outcome_review" {
        let label = match execution_status {
            WorkExecutionBindingStatus::Completed => "returned",
            WorkExecutionBindingStatus::Failed => "failed",
            WorkExecutionBindingStatus::Cancelled => "cancelled",
            WorkExecutionBindingStatus::Interrupted => "interrupted",
            WorkExecutionBindingStatus::Queued
            | WorkExecutionBindingStatus::Running
            | WorkExecutionBindingStatus::WaitingUser => execution_status_label(execution_status),
        };
        return format!("Outcome review {label}: {}", work.title.as_str());
    }

    let label = match execution_status {
        WorkExecutionBindingStatus::Completed => match work.status {
            super::WorkStatus::Completed => "completed",
            _ => "execution completed",
        },
        WorkExecutionBindingStatus::Failed => "failed",
        WorkExecutionBindingStatus::Cancelled => "cancelled",
        WorkExecutionBindingStatus::Interrupted => "interrupted",
        WorkExecutionBindingStatus::Queued
        | WorkExecutionBindingStatus::Running
        | WorkExecutionBindingStatus::WaitingUser => execution_status_label(execution_status),
    };
    format!("Work {label}: {}", work.title.as_str())
}

fn format_work_message_prompt(
    work: &WorkRecord,
    turn_id: &str,
    execution_status: WorkExecutionBindingStatus,
    error: Option<&str>,
) -> String {
    let mut envelope = PromptEnvelope::new();
    let work_session_id = work.work_session_id().unwrap_or("<unknown>");
    let assigned_agent_type = work_agent_type(work).unwrap_or("<unknown>");
    let message_role = work_message_role(work);
    let owner_turn_id = work
        .delegation
        .as_ref()
        .and_then(|delegation| delegation.owner.as_ref())
        .and_then(|owner| owner.turn_id.as_deref())
        .unwrap_or("<unknown>");
    let instructions = work
        .delegation
        .as_ref()
        .and_then(|delegation| delegation.instructions.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("<not recorded>");
    let error_line = error
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("\nError: {value}"))
        .unwrap_or_default();

    envelope.push_system_reminder(format!(
        "This message is an automated Agentic OS Work message, not a human user message.\n\
Work message kind: execution_finished\n\
Work ID: {work_id}\n\
Work title: {title}\n\
Work message role: {message_role}\n\
Assigned agent type: {assigned_agent_type}\n\
Work status: {work_status}\n\
Execution status: {execution_status}\n\
WorkSession ID: {work_session_id}\n\
WorkSession turn ID: {turn_id}\n\
Delegating OSAgent turn ID: {owner_turn_id}{error_line}\n\n\
Use the original delegation and the Work's observable result to decide the next action. \
If the result needs verification, arrange verification before reporting final completion. \
If it needs revision, continue the same Work by work_id with focused instructions. \
If it is acceptable or verification is intentionally skipped, report the result to the user concisely.",
        work_id = work.id.as_str(),
        title = work.title.as_str(),
        work_status = work_status_label(work.status),
        execution_status = execution_status_label(execution_status),
    ));
    envelope.push_user_query(format!(
        "Original Work delegation:\n{instructions}\n\nReview Work `{}` and decide whether to verify, continue, ask the user, or report the result.",
        work.id.as_str()
    ));
    envelope.render()
}

fn work_agent_type(work: &WorkRecord) -> Option<&str> {
    work.assignment
        .as_ref()
        .and_then(|assignment| assignment.agent_type.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn work_message_role(work: &WorkRecord) -> &'static str {
    match work_agent_type(work) {
        Some("OutcomeReview") => "outcome_review",
        _ => "execution_result",
    }
}

fn execution_status_label(status: WorkExecutionBindingStatus) -> &'static str {
    match status {
        WorkExecutionBindingStatus::Queued => "queued",
        WorkExecutionBindingStatus::Running => "running",
        WorkExecutionBindingStatus::WaitingUser => "waiting_user",
        WorkExecutionBindingStatus::Completed => "completed",
        WorkExecutionBindingStatus::Failed => "failed",
        WorkExecutionBindingStatus::Cancelled => "cancelled",
        WorkExecutionBindingStatus::Interrupted => "interrupted",
    }
}

fn work_status_label(status: super::WorkStatus) -> &'static str {
    match status {
        super::WorkStatus::Draft => "draft",
        super::WorkStatus::Active => "active",
        super::WorkStatus::Running => "running",
        super::WorkStatus::WaitingUser => "waiting_user",
        super::WorkStatus::Blocked => "blocked",
        super::WorkStatus::Paused => "paused",
        super::WorkStatus::Completed => "completed",
        super::WorkStatus::Failed => "failed",
        super::WorkStatus::Cancelled => "cancelled",
        super::WorkStatus::Interrupted => "interrupted",
        super::WorkStatus::Archived => "archived",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agentic_os::work::{
        WorkAssignmentRef, WorkDelegationContext, WorkId, WorkKind, WorkOwnerRef, WorkScope,
        WorkStatus, WorkSubject, WorkSurfaceRef, WorkVisibility,
    };

    fn owned_work(status: WorkStatus) -> WorkRecord {
        let mut work = WorkRecord::new(
            WorkId::generate(),
            WorkKind::MultiStep,
            "Audit generated report".to_string(),
            "Decide whether the report is ready to show the user.".to_string(),
            WorkVisibility::Primary,
            WorkSubject::Goal,
            Vec::new(),
            WorkScope::System,
            WorkSurfaceRef::WorkSession {
                session_id: "work-session".to_string(),
            },
            100,
        );
        work.status = status;
        work.delegation = Some(WorkDelegationContext {
            owner: Some(WorkOwnerRef {
                session_id: "owner-session".to_string(),
                turn_id: Some("owner-turn".to_string()),
                workspace_path: Some("D:/workspace/owner".to_string()),
            }),
            instructions: Some("Check the report against the requested criteria.".to_string()),
        });
        work
    }

    fn outcome_review_work(status: WorkStatus) -> WorkRecord {
        let mut work = owned_work(status);
        work.assignment = Some(WorkAssignmentRef::agent("OutcomeReview"));
        work
    }

    #[test]
    fn work_message_prompt_marks_system_origin_and_next_decision() {
        let work = owned_work(WorkStatus::Completed);
        let prompt = format_work_message_prompt(
            &work,
            "work-turn",
            WorkExecutionBindingStatus::Completed,
            None,
        );

        assert!(prompt.contains("automated Agentic OS Work message"));
        assert!(prompt.contains("not a human user message"));
        assert!(prompt.contains("Work message kind: execution_finished"));
        assert!(prompt.contains("Work message role: execution_result"));
        assert!(prompt.contains("Delegating OSAgent turn ID: owner-turn"));
        assert!(prompt.contains("arrange verification before reporting final completion"));
        assert!(prompt.contains("continue, ask the user, or report"));
    }

    #[test]
    fn display_distinguishes_execution_completion_from_work_completion() {
        let active_work = owned_work(WorkStatus::Active);
        let completed_work = owned_work(WorkStatus::Completed);

        assert_eq!(
            format_work_message_display(&active_work, WorkExecutionBindingStatus::Completed),
            "Work execution completed: Audit generated report"
        );
        assert_eq!(
            format_work_message_display(&completed_work, WorkExecutionBindingStatus::Completed),
            "Work completed: Audit generated report"
        );
    }

    #[test]
    fn outcome_review_work_message_has_review_role() {
        let work = outcome_review_work(WorkStatus::Completed);
        let prompt = format_work_message_prompt(
            &work,
            "review-turn",
            WorkExecutionBindingStatus::Completed,
            None,
        );

        assert_eq!(work_agent_type(&work), Some("OutcomeReview"));
        assert_eq!(work_message_role(&work), "outcome_review");
        assert_eq!(
            format_work_message_display(&work, WorkExecutionBindingStatus::Completed),
            "Outcome review returned: Audit generated report"
        );
        assert!(prompt.contains("Work message role: outcome_review"));
        assert!(prompt.contains("Assigned agent type: OutcomeReview"));
    }
}
