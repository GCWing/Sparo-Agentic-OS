//! Stage-C: process-wide globals.
//!
//! Runs entirely on the Tauri async runtime. Independent of any webview.

use anyhow::Context;
use sparo_core::runtime::{initialize_process_runtime, ProcessRuntimeOptions};
use std::sync::Arc;

pub struct GlobalServices {
    pub config_service: Arc<sparo_core::service::config::ConfigService>,
    pub token_usage_service: Arc<sparo_core::service::token_usage::TokenUsageService>,
}

/// Initialize process-wide globals required by every command and every
/// workspace. Returns the small set of handles the workspace stage needs.
pub async fn initialize() -> anyhow::Result<GlobalServices> {
    let runtime = initialize_process_runtime(ProcessRuntimeOptions {
        initialize_i18n: true,
        initialize_token_usage: true,
        config_startup_failure_policy:
            sparo_core::service::config::ConfigStartupFailurePolicy::ReadOnlyDefaults,
    })
    .await
    .context("initialize_process_runtime")?;
    let config_service = runtime.config_service.clone();
    let token_usage_service = runtime
        .token_usage_service
        .context("token_usage_service missing after process runtime initialization")?;

    log::info!("Stage-C globals ready");
    Ok(GlobalServices {
        config_service,
        token_usage_service,
    })
}
