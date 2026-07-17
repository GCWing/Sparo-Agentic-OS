//! Desktop-only gate for Computer use (set from Sparo OS desktop at startup).

use std::sync::atomic::{AtomicBool, Ordering};

use crate::error::CoreResult;
use crate::service::config::global::GlobalConfigManager;
use crate::service::config::types::AIConfig;

static COMPUTER_USE_DESKTOP_AVAILABLE: AtomicBool = AtomicBool::new(false);

/// Mark whether this process is Sparo OS desktop with OS automation wired up.
pub fn set_computer_use_desktop_available(available: bool) {
    COMPUTER_USE_DESKTOP_AVAILABLE.store(available, Ordering::SeqCst);
}

pub fn computer_use_desktop_available() -> bool {
    COMPUTER_USE_DESKTOP_AVAILABLE.load(Ordering::SeqCst)
}

/// Reads the authoritative Computer use setting. Configuration failures are
/// returned to callers that can surface them instead of manufacturing defaults.
pub async fn computer_use_setting_enabled() -> CoreResult<bool> {
    if !computer_use_desktop_available() {
        return Ok(false);
    }

    let service = GlobalConfigManager::get_service().await?;
    let ai: AIConfig = service.get_config(Some("ai")).await?;
    Ok(ai.computer_use_enabled)
}

/// Tool discovery has a boolean-only contract, so configuration failures must
/// fail closed. Tool execution paths read the same setting with the typed error.
pub async fn computer_use_tool_enabled() -> bool {
    computer_use_setting_enabled().await.unwrap_or(false)
}
