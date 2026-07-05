use super::auto_scan::HostAutoScanService;
use crate::agentic::events::{AgenticEvent, EventSubscriber};
use crate::error::CoreResult;
use log::error;
use std::sync::Arc;

pub struct HostAutoScanEventSubscriber {
    service: Arc<HostAutoScanService>,
}

impl HostAutoScanEventSubscriber {
    pub fn new(service: Arc<HostAutoScanService>) -> Self {
        Self { service }
    }
}

#[async_trait::async_trait]
impl EventSubscriber for HostAutoScanEventSubscriber {
    async fn on_event(&self, event: &AgenticEvent) -> CoreResult<()> {
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
            error!("Failed to update host scan state from event: {}", error);
        }

        result
    }
}
