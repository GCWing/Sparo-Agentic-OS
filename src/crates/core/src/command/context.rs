use std::sync::Arc;

use crate::infrastructure::ai::AIClientFactory;
use crate::service::config::ConfigService;

#[derive(Clone)]
pub struct CommandContext {
    config_service: Arc<ConfigService>,
    ai_client_factory: Option<Arc<AIClientFactory>>,
}

impl CommandContext {
    pub fn new(config_service: Arc<ConfigService>) -> Self {
        Self {
            config_service,
            ai_client_factory: None,
        }
    }

    pub fn with_ai_client_factory(mut self, ai_client_factory: Arc<AIClientFactory>) -> Self {
        self.ai_client_factory = Some(ai_client_factory);
        self
    }

    pub(crate) fn config_service(&self) -> &Arc<ConfigService> {
        &self.config_service
    }

    pub(crate) fn invalidate_ai_client_cache(&self) -> bool {
        if let Some(factory) = &self.ai_client_factory {
            factory.invalidate_cache();
            true
        } else {
            false
        }
    }
}
