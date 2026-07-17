//! Runtime capability API

use crate::frontend_runtime_watchdog::{
    self, FrontendRuntimeHeartbeatRequest, FrontendRuntimeWatchdogSnapshot,
};
use sparo_core::service::runtime::{RuntimeCommandCapability, RuntimeManager};

#[tauri::command]
pub async fn get_runtime_capabilities() -> Result<Vec<RuntimeCommandCapability>, String> {
    let manager = RuntimeManager::new().map_err(|e| e.to_string())?;
    Ok(manager.get_capabilities())
}

#[tauri::command]
pub async fn record_frontend_runtime_heartbeat(
    app: tauri::AppHandle,
    request: FrontendRuntimeHeartbeatRequest,
) -> Result<(), String> {
    if frontend_runtime_watchdog::record_heartbeat(request)? {
        crate::tray::request_menu_refresh(&app);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_frontend_runtime_watchdog_snapshot(
) -> Result<FrontendRuntimeWatchdogSnapshot, String> {
    Ok(frontend_runtime_watchdog::snapshot())
}

#[tauri::command]
pub async fn disable_frontend_runtime_safe_mode(
    app: tauri::AppHandle,
) -> Result<FrontendRuntimeWatchdogSnapshot, String> {
    frontend_runtime_watchdog::disable_safe_mode(&app)?;
    Ok(frontend_runtime_watchdog::snapshot())
}
