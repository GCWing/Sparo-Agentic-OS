//! Boot stage IPC.
//!
//! The frontend's `BootLoader` calls `get_boot_stage` once on mount and then
//! listens for `boot://stage` events. There is no polling; the controller in
//! `bootstrap::boot` pushes every transition.

use crate::bootstrap::{AppContainer, BootStage};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_boot_stage(container: State<'_, Arc<AppContainer>>) -> Result<BootStage, String> {
    Ok(container.boot.current())
}

#[tauri::command]
pub async fn get_boot_history(
    container: State<'_, Arc<AppContainer>>,
) -> Result<Vec<String>, String> {
    Ok(container.boot.history())
}
