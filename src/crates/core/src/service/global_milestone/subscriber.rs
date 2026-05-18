use super::service::GlobalMilestoneService;
use crate::agentic::events::{AgenticEvent, EventSubscriber};
use crate::util::errors::BitFunResult;
use log::error;
use std::sync::Arc;

pub struct GlobalMilestoneEventSubscriber {
    service: Arc<GlobalMilestoneService>,
}

impl GlobalMilestoneEventSubscriber {
    pub fn new(service: Arc<GlobalMilestoneService>) -> Self {
        Self { service }
    }
}

#[async_trait::async_trait]
impl EventSubscriber for GlobalMilestoneEventSubscriber {
    async fn on_event(&self, event: &AgenticEvent) -> BitFunResult<()> {
        let result = match event {
            AgenticEvent::DialogTurnCompleted { turn_id, .. } => {
                self.service.handle_turn_completed(turn_id).await
            }
            AgenticEvent::DialogTurnFailed { turn_id, error, .. } => {
                self.service.handle_turn_failed(turn_id, error).await
            }
            AgenticEvent::DialogTurnCancelled { turn_id, .. } => {
                self.service.handle_turn_cancelled(turn_id).await
            }
            _ => Ok(()),
        };

        if let Err(error) = &result {
            error!("Failed to update global milestone state from event: {}", error);
        }

        result
    }
}
