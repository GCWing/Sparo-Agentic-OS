use super::auto_refresh::WorkspaceOverviewAutoRefreshService;
use crate::agentic::events::{AgenticEvent, EventSubscriber};
use crate::util::errors::BitFunResult;
use log::error;
use std::sync::Arc;

pub struct WorkspaceOverviewAutoRefreshEventSubscriber {
    service: Arc<WorkspaceOverviewAutoRefreshService>,
}

impl WorkspaceOverviewAutoRefreshEventSubscriber {
    pub fn new(service: Arc<WorkspaceOverviewAutoRefreshService>) -> Self {
        Self { service }
    }
}

#[async_trait::async_trait]
impl EventSubscriber for WorkspaceOverviewAutoRefreshEventSubscriber {
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
            error!(
                "Failed to update workspace overview refresh state from event: {}",
                error
            );
        }

        result
    }
}
