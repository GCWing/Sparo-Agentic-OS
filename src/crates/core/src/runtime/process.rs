//! Shared process-wide runtime initialization for Desktop and CLI.

use std::sync::Arc;

use crate::command::CommandContext;
use crate::infrastructure::ai::AIClientFactory;
use crate::infrastructure::try_get_path_manager_arc;
use crate::service::config::{get_global_config_service, initialize_global_config, ConfigService};
use crate::service::i18n::initialize_global_i18n_service;
use crate::service::token_usage::TokenUsageService;

#[derive(Debug, Clone, Copy)]
pub struct ProcessRuntimeOptions {
    pub initialize_i18n: bool,
    pub initialize_token_usage: bool,
}

impl Default for ProcessRuntimeOptions {
    fn default() -> Self {
        Self {
            initialize_i18n: true,
            initialize_token_usage: false,
        }
    }
}

#[derive(Clone)]
pub struct ProcessRuntime {
    pub config_service: Arc<ConfigService>,
    pub ai_client_factory: Arc<AIClientFactory>,
    pub token_usage_service: Option<Arc<TokenUsageService>>,
}

impl ProcessRuntime {
    pub fn command_context(&self) -> CommandContext {
        CommandContext::new(self.config_service.clone())
            .with_ai_client_factory(self.ai_client_factory.clone())
    }
}

pub async fn initialize_process_runtime(
    options: ProcessRuntimeOptions,
) -> anyhow::Result<ProcessRuntime> {
    initialize_global_config()
        .await
        .map_err(|e| anyhow::anyhow!("initialize_global_config: {}", e))?;

    let config_service = get_global_config_service()
        .await
        .map_err(|e| anyhow::anyhow!("get_global_config_service: {}", e))?;

    if options.initialize_i18n {
        initialize_global_i18n_service(Some(config_service.clone()))
            .await
            .map_err(|e| anyhow::anyhow!("initialize_global_i18n_service: {}", e))?;
    }

    AIClientFactory::initialize_global()
        .await
        .map_err(|e| anyhow::anyhow!("AIClientFactory::initialize_global: {}", e))?;
    let ai_client_factory = AIClientFactory::get_global()
        .await
        .map_err(|e| anyhow::anyhow!("AIClientFactory::get_global: {}", e))?;

    let token_usage_service = if options.initialize_token_usage {
        let path_manager = try_get_path_manager_arc()
            .map_err(|e| anyhow::anyhow!("try_get_path_manager_arc: {}", e))?;
        Some(Arc::new(
            TokenUsageService::new(path_manager)
                .await
                .map_err(|e| anyhow::anyhow!("TokenUsageService::new: {}", e))?,
        ))
    } else {
        None
    };

    Ok(ProcessRuntime {
        config_service,
        ai_client_factory,
        token_usage_service,
    })
}
