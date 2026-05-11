//! EventSubscriber that updates the tray icon based on agent lifecycle events.

use crate::tray::status;
use bitfun_core::agentic::events::{AgenticEvent, EventSubscriber};
use bitfun_core::util::errors::BitFunResult;
use tauri::AppHandle;

pub struct TrayStatusSubscriber {
    app: AppHandle,
}

impl TrayStatusSubscriber {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

#[async_trait::async_trait]
impl EventSubscriber for TrayStatusSubscriber {
    async fn on_event(&self, event: &AgenticEvent) -> BitFunResult<()> {
        match event {
            AgenticEvent::DialogTurnStarted { .. } => {
                status::increment_running(&self.app);
            }
            AgenticEvent::DialogTurnCompleted { hidden_session, .. } => {
                if !hidden_session {
                    status::decrement_running(&self.app);
                }
            }
            AgenticEvent::DialogTurnCancelled { .. } => {
                status::decrement_running(&self.app);
            }
            AgenticEvent::DialogTurnFailed { .. } => {
                status::decrement_running(&self.app);
                status::set_error(&self.app, true);
                // Clear the error indicator after 10 seconds
                let app = self.app.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                    status::set_error(&app, false);
                });
            }
            _ => {}
        }
        Ok(())
    }
}
