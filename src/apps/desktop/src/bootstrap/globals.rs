//! Stage-C: process-wide globals.
//!
//! Runs entirely on the Tauri async runtime. Independent of any webview.

use anyhow::Context;
use std::sync::Arc;

pub struct GlobalServices {
    pub token_usage_service: Arc<bitfun_core::service::token_usage::TokenUsageService>,
}

/// Initialize process-wide globals required by every command and every
/// workspace. Returns the small set of handles the workspace stage needs.
pub async fn initialize() -> anyhow::Result<GlobalServices> {
    // 1) config: backs every later service.
    bitfun_core::service::config::initialize_global_config()
        .await
        .context("initialize_global_config")?;

    // 2) i18n: needs config for `app.language`.
    {
        use bitfun_core::service::config::get_global_config_service;
        use bitfun_core::service::i18n::initialize_global_i18n_service;
        let config_service = get_global_config_service()
            .await
            .context("get_global_config_service for i18n")?;
        initialize_global_i18n_service(Some(config_service))
            .await
            .context("initialize_global_i18n_service")?;
    }

    // 3) AI client factory: backs every model / agent call.
    bitfun_core::infrastructure::ai::AIClientFactory::initialize_global()
        .await
        .context("AIClientFactory::initialize_global")?;

    // 4) Token usage accounting (workspace-scoped data lives under
    //    `~/.sparo_os/projects/<slug>/`, so it depends on PathManager only and
    //    is safe to construct before a workspace is chosen).
    let path_manager = bitfun_core::infrastructure::try_get_path_manager_arc()
        .context("try_get_path_manager_arc")?;
    let token_usage_service = Arc::new(
        bitfun_core::service::token_usage::TokenUsageService::new(path_manager)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to initialize token usage service: {}", e))?,
    );

    log::info!("Stage-C globals ready");
    Ok(GlobalServices {
        token_usage_service,
    })
}
