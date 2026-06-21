use super::GoalService;
use crate::agentic::events::{AgenticEvent, EventSubscriber};
use crate::util::errors::BitFunResult;
use std::sync::Arc;

pub struct GoalEventSubscriber {
    service: Arc<GoalService>,
}

impl GoalEventSubscriber {
    pub fn new(service: Arc<GoalService>) -> Self {
        Self { service }
    }
}

#[async_trait::async_trait]
impl EventSubscriber for GoalEventSubscriber {
    async fn on_event(&self, event: &AgenticEvent) -> BitFunResult<()> {
        self.service.handle_event(event).await
    }
}
