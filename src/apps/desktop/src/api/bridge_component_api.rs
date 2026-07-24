//! Bridge Component API - implementation adapter management for Product App bridge backends.

use crate::api::app_state::AppState;
use serde::Deserialize;
use serde_json::{json, Value};
use sparo_core::agentic::tools::registry::get_global_tool_registry;
use sparo_core::bridge_component::{
    BridgeComponentConsumer, BridgeComponentConsumerKind, BridgeComponentManager,
    BridgeComponentManifest, BridgeComponentPackage, BridgeComponentRun, BridgeComponentRunResult,
};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetBridgeComponentRequest {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBridgeComponentRequest {
    pub manifest: BridgeComponentManifest,
    #[serde(default)]
    pub overwrite: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBridgeComponentFromPathRequest {
    pub path: String,
    #[serde(default)]
    pub overwrite: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteBridgeComponentRequest {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunBridgeComponentActionRequest {
    pub component_id: String,
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
    pub component_id: Option<String>,
}

async fn refresh_bridge_component_runtime_tools() {
    let registry = get_global_tool_registry();
    let mut guard = registry.write().await;
    guard.register_bridge_component_runtime_tools();
}

fn refresh_bridge_component_agent_surfaces() -> Result<(), String> {
    BridgeComponentManager::register_agent_surfaces()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_bridge_components(
    _state: State<'_, AppState>,
) -> Result<Vec<BridgeComponentPackage>, String> {
    BridgeComponentManager::list().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_bridge_component(
    _state: State<'_, AppState>,
    request: GetBridgeComponentRequest,
) -> Result<BridgeComponentPackage, String> {
    BridgeComponentManager::get(&request.id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn validate_bridge_component_package(
    _state: State<'_, AppState>,
    request: SaveBridgeComponentRequest,
) -> Result<Value, String> {
    let mut manifest = request.manifest;
    BridgeComponentManager::validate_manifest(&mut manifest).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "manifest": manifest }))
}

#[tauri::command]
pub async fn create_bridge_component(
    _state: State<'_, AppState>,
    request: SaveBridgeComponentRequest,
) -> Result<BridgeComponentPackage, String> {
    let package = BridgeComponentManager::create_or_update(request.manifest, request.overwrite)
        .map_err(|e| e.to_string())?;
    refresh_bridge_component_runtime_tools().await;
    refresh_bridge_component_agent_surfaces()?;
    Ok(package)
}

#[tauri::command]
pub async fn update_bridge_component(
    _state: State<'_, AppState>,
    mut request: SaveBridgeComponentRequest,
) -> Result<BridgeComponentPackage, String> {
    request.overwrite = true;
    create_bridge_component(_state, request).await
}

#[tauri::command]
pub async fn import_bridge_component_from_path(
    _state: State<'_, AppState>,
    request: ImportBridgeComponentFromPathRequest,
) -> Result<BridgeComponentPackage, String> {
    let package = BridgeComponentManager::import_from_path(request.path.into(), request.overwrite)
        .map_err(|e| e.to_string())?;
    refresh_bridge_component_runtime_tools().await;
    refresh_bridge_component_agent_surfaces()?;
    Ok(package)
}

#[tauri::command]
pub async fn delete_bridge_component(
    _state: State<'_, AppState>,
    request: DeleteBridgeComponentRequest,
) -> Result<(), String> {
    BridgeComponentManager::delete(&request.id).map_err(|e| e.to_string())?;
    refresh_bridge_component_runtime_tools().await;
    let _ = sparo_core::agentic::agents::get_agent_registry().remove_agent_component(&request.id);
    refresh_bridge_component_agent_surfaces()?;
    Ok(())
}

#[tauri::command]
pub async fn run_bridge_component_action(
    _state: State<'_, AppState>,
    request: RunBridgeComponentActionRequest,
) -> Result<BridgeComponentRunResult, String> {
    let run_id = Uuid::new_v4().to_string();
    BridgeComponentManager::run_capability_action(
        &request.component_id,
        request.capability_id.as_deref(),
        &request.action,
        request.input,
        request.workspace_path,
        run_id,
        BridgeComponentConsumer {
            kind: BridgeComponentConsumerKind::Management,
            id: "bridge-management".to_string(),
            session_id: None,
            turn_id: None,
            work_id: None,
            work_title: None,
            runtime_instance_id: None,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_bridge_component_runs(
    _state: State<'_, AppState>,
    request: ListBridgeRunsRequest,
) -> Result<Vec<BridgeComponentRun>, String> {
    Ok(BridgeComponentManager::list_runs(request.component_id.as_deref()).await)
}

#[tauri::command]
pub async fn get_bridge_component_run(
    _state: State<'_, AppState>,
    request: BridgeRunRequest,
) -> Result<BridgeComponentRun, String> {
    BridgeComponentManager::get_run(&request.run_id)
        .await
        .ok_or_else(|| format!("Bridge run not found: {}", request.run_id))
}

#[tauri::command]
pub async fn cancel_bridge_component_run(
    _state: State<'_, AppState>,
    request: BridgeRunRequest,
) -> Result<BridgeComponentRun, String> {
    BridgeComponentManager::cancel_run(&request.run_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_bridge_component_run_artifacts(
    _state: State<'_, AppState>,
    request: BridgeRunRequest,
) -> Result<Vec<Value>, String> {
    BridgeComponentManager::get_artifacts(&request.run_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stream_bridge_component_run_events(
    _state: State<'_, AppState>,
    request: BridgeRunEventsRequest,
) -> Result<Vec<sparo_core::bridge_component::BridgeComponentEvent>, String> {
    BridgeComponentManager::stream_run_events(&request.run_id, request.after_index)
        .await
        .map_err(|e| e.to_string())
}
