use super::GoalService;
use crate::agentic::session_hooks::{
    SessionDriver, SessionDriverIntent, SessionExtension, SessionHookContext,
};
use crate::util::errors::BitFunResult;
use async_trait::async_trait;
use std::sync::Arc;

pub struct GoalSessionExtension {
    service: Arc<GoalService>,
}

impl GoalSessionExtension {
    pub fn new(service: Arc<GoalService>) -> Self {
        Self { service }
    }
}

#[async_trait]
impl SessionExtension for GoalSessionExtension {
    fn id(&self) -> &'static str {
        "agentic_goal"
    }

    async fn on_session_hook(
        &self,
        context: SessionHookContext,
        _driver: Arc<dyn SessionDriver>,
    ) -> BitFunResult<Vec<SessionDriverIntent>> {
        self.service.handle_session_hook(context).await?;
        Ok(Vec::new())
    }
}
