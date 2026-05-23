//! Bridge App API - external app/runtime package management.

use crate::api::app_state::AppState;
use bitfun_core::bridge_app::{
    BridgeAppManager, BridgeAppManifest, BridgeAppPackage, BridgeAppRunResult,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetBridgeAppRequest {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBridgeAppRequest {
    pub manifest: BridgeAppManifest,
    #[serde(default)]
    pub overwrite: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteBridgeAppRequest {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunBridgeAppActionRequest {
    pub app_id: String,
    pub action: String,
    #[serde(default)]
    pub input: Value,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[tauri::command]
pub async fn list_bridge_apps(
    _state: State<'_, AppState>,
) -> Result<Vec<BridgeAppPackage>, String> {
    BridgeAppManager::list().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_bridge_app(
    _state: State<'_, AppState>,
    request: GetBridgeAppRequest,
) -> Result<BridgeAppPackage, String> {
    BridgeAppManager::get(&request.id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn validate_bridge_app_package(
    _state: State<'_, AppState>,
    request: SaveBridgeAppRequest,
) -> Result<Value, String> {
    let mut manifest = request.manifest;
    BridgeAppManager::validate_manifest(&mut manifest).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "manifest": manifest }))
}

#[tauri::command]
pub async fn create_bridge_app(
    _state: State<'_, AppState>,
    request: SaveBridgeAppRequest,
) -> Result<BridgeAppPackage, String> {
    BridgeAppManager::create_or_update(request.manifest, request.overwrite)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_bridge_app(
    _state: State<'_, AppState>,
    mut request: SaveBridgeAppRequest,
) -> Result<BridgeAppPackage, String> {
    request.overwrite = true;
    create_bridge_app(_state, request).await
}

#[tauri::command]
pub async fn delete_bridge_app(
    _state: State<'_, AppState>,
    request: DeleteBridgeAppRequest,
) -> Result<(), String> {
    BridgeAppManager::delete(&request.id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn run_bridge_app_action(
    _state: State<'_, AppState>,
    request: RunBridgeAppActionRequest,
) -> Result<BridgeAppRunResult, String> {
    let run_id = Uuid::new_v4().to_string();
    BridgeAppManager::run_action(
        &request.app_id,
        &request.action,
        request.input,
        request.workspace_path,
        run_id,
    )
    .await
    .map_err(|e| e.to_string())
}
