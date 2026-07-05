//! Runtime capability API

use crate::api::app_state::AppState;
use crate::frontend_runtime_watchdog::{
    self, FrontendRuntimeHeartbeatRequest, FrontendRuntimeWatchdogSnapshot,
};
use sparo_core::service::runtime::{RuntimeCommandCapability, RuntimeManager};
use tauri::State;

#[tauri::command]
pub async fn get_runtime_capabilities(
    _state: State<'_, AppState>,
) -> Result<Vec<RuntimeCommandCapability>, String> {
    let manager = RuntimeManager::new().map_err(|e| e.to_string())?;
    Ok(manager.get_capabilities())
}

#[tauri::command]
pub async fn record_frontend_runtime_heartbeat(
    _state: State<'_, AppState>,
    request: FrontendRuntimeHeartbeatRequest,
) -> Result<(), String> {
    frontend_runtime_watchdog::record_heartbeat(request)
}

#[tauri::command]
pub async fn get_frontend_runtime_watchdog_snapshot(
    _state: State<'_, AppState>,
) -> Result<FrontendRuntimeWatchdogSnapshot, String> {
    Ok(frontend_runtime_watchdog::snapshot())
}

#[tauri::command]
pub async fn disable_frontend_runtime_safe_mode(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
) -> Result<FrontendRuntimeWatchdogSnapshot, String> {
    frontend_runtime_watchdog::disable_safe_mode(&app)?;
    Ok(frontend_runtime_watchdog::snapshot())
}
