//! Bridge App API - external app/runtime package management.

use crate::api::app_state::AppState;
use bitfun_core::agentic::tools::registry::get_global_tool_registry;
use bitfun_core::bridge_app::{
    BridgeAppConsumer, BridgeAppConsumerKind, BridgeAppManager, BridgeAppManifest,
    BridgeAppPackage, BridgeAppRun, BridgeAppRunResult,
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
pub struct ImportBridgeAppFromPathRequest {
    pub path: String,
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
    #[serde(default)]
    pub capability_id: Option<String>,
    pub action: String,
    #[serde(default)]
    pub input: Value,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRunRequest {
    pub run_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRunEventsRequest {
    pub run_id: String,
    #[serde(default)]
    pub after_index: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListBridgeRunsRequest {
    #[serde(default)]
    pub app_id: Option<String>,
}

async fn refresh_bridge_app_runtime_tools() {
    let registry = get_global_tool_registry();
    let mut guard = registry.write().await;
    guard.register_bridge_app_runtime_tools();
}

fn refresh_bridge_app_agent_surfaces() -> Result<(), String> {
    BridgeAppManager::register_agent_surfaces()
        .map(|_| ())
        .map_err(|e| e.to_string())
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
    let package = BridgeAppManager::create_or_update(request.manifest, request.overwrite)
        .map_err(|e| e.to_string())?;
    refresh_bridge_app_runtime_tools().await;
    refresh_bridge_app_agent_surfaces()?;
    Ok(package)
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
pub async fn import_bridge_app_from_path(
    _state: State<'_, AppState>,
    request: ImportBridgeAppFromPathRequest,
) -> Result<BridgeAppPackage, String> {
    let package = BridgeAppManager::import_from_path(request.path.into(), request.overwrite)
        .map_err(|e| e.to_string())?;
    refresh_bridge_app_runtime_tools().await;
    refresh_bridge_app_agent_surfaces()?;
    Ok(package)
}

#[tauri::command]
pub async fn delete_bridge_app(
    _state: State<'_, AppState>,
    request: DeleteBridgeAppRequest,
) -> Result<(), String> {
    BridgeAppManager::delete(&request.id).map_err(|e| e.to_string())?;
    refresh_bridge_app_runtime_tools().await;
    let _ = bitfun_core::agentic::agents::get_agent_registry().remove_agent_app(&request.id);
    refresh_bridge_app_agent_surfaces()?;
    Ok(())
}

#[tauri::command]
pub async fn run_bridge_app_action(
    _state: State<'_, AppState>,
    request: RunBridgeAppActionRequest,
) -> Result<BridgeAppRunResult, String> {
    let run_id = Uuid::new_v4().to_string();
    BridgeAppManager::run_capability_action(
        &request.app_id,
        request.capability_id.as_deref(),
        &request.action,
        request.input,
        request.workspace_path,
        run_id,
        BridgeAppConsumer {
            kind: BridgeAppConsumerKind::Management,
            id: "bridge-management".to_string(),
            session_id: None,
            turn_id: None,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_bridge_app_runs(
    _state: State<'_, AppState>,
    request: ListBridgeRunsRequest,
) -> Result<Vec<BridgeAppRun>, String> {
    Ok(BridgeAppManager::list_runs(request.app_id.as_deref()).await)
}

#[tauri::command]
pub async fn get_bridge_app_run(
    _state: State<'_, AppState>,
    request: BridgeRunRequest,
) -> Result<BridgeAppRun, String> {
    BridgeAppManager::get_run(&request.run_id)
        .await
        .ok_or_else(|| format!("Bridge run not found: {}", request.run_id))
}

#[tauri::command]
pub async fn cancel_bridge_app_run(
    _state: State<'_, AppState>,
    request: BridgeRunRequest,
) -> Result<BridgeAppRun, String> {
    BridgeAppManager::cancel_run(&request.run_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_bridge_app_run_artifacts(
    _state: State<'_, AppState>,
    request: BridgeRunRequest,
) -> Result<Vec<Value>, String> {
    BridgeAppManager::get_artifacts(&request.run_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stream_bridge_app_run_events(
    _state: State<'_, AppState>,
    request: BridgeRunEventsRequest,
) -> Result<Vec<bitfun_core::bridge_app::BridgeAppEvent>, String> {
    BridgeAppManager::stream_run_events(&request.run_id, request.after_index)
        .await
        .map_err(|e| e.to_string())
}
