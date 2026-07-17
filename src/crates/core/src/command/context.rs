use std::sync::Arc;

use crate::service::config::ConfigService;

#[derive(Clone)]
pub struct CommandContext {
    config_service: Arc<ConfigService>,
}

impl CommandContext {
    pub fn new(config_service: Arc<ConfigService>) -> Self {
        Self { config_service }
    }

    pub(crate) fn config_service(&self) -> &Arc<ConfigService> {
        &self.config_service
    }
}
