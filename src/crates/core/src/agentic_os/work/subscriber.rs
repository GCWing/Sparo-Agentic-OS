use crate::agentic::events::{AgenticEvent, EventSubscriber, ToolEventData};
use crate::util::errors::BitFunResult;

use super::{default_work_store, WorkService};

pub struct WorkEventSubscriber;

impl WorkEventSubscriber {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait]
impl EventSubscriber for WorkEventSubscriber {
    async fn on_event(&self, event: &AgenticEvent) -> BitFunResult<()> {
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
                ..
            } => {
                service
                    .mark_agent_session_turn_started(session_id, turn_id)
                    .await?;
            }
            AgenticEvent::DialogTurnCompleted { turn_id, .. } => {
                service.mark_agent_session_turn_completed(turn_id).await?;
            }
            AgenticEvent::DialogTurnFailed { turn_id, error, .. } => {
                service
                    .mark_agent_session_turn_failed(turn_id, error)
                    .await?;
            }
            AgenticEvent::DialogTurnCancelled { turn_id, .. } => {
                service.mark_agent_session_turn_cancelled(turn_id).await?;
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
