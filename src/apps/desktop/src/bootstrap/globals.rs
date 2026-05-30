//! Stage-C: process-wide globals.
//!
//! Runs entirely on the Tauri async runtime. Independent of any webview.

use anyhow::Context;
use bitfun_core::runtime::{initialize_process_runtime, ProcessRuntimeOptions};
use std::sync::Arc;

pub struct GlobalServices {
    pub token_usage_service: Arc<bitfun_core::service::token_usage::TokenUsageService>,
}

/// Initialize process-wide globals required by every command and every
/// workspace. Returns the small set of handles the workspace stage needs.
pub async fn initialize() -> anyhow::Result<GlobalServices> {
    let runtime = initialize_process_runtime(ProcessRuntimeOptions {
        initialize_i18n: true,
        initialize_token_usage: true,
    })
    .await
    .context("initialize_process_runtime")?;
    let token_usage_service = runtime
        .token_usage_service
        .context("token_usage_service missing after process runtime initialization")?;

    log::info!("Stage-C globals ready");
    Ok(GlobalServices {
        token_usage_service,
    })
}
