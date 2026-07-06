//! Agent Component API - implementation package management for Product App agent backends.

use crate::api::app_state::AppState;
use serde::Deserialize;
use serde_json::{json, Value};
use sparo_core::agent_component::{
    AgentComponentBridgeCapabilityRef, AgentComponentExample, AgentComponentInfo,
    AgentComponentJsToolManifest, AgentComponentLevel, AgentComponentManager,
    AgentComponentManifest, AgentComponentPackage,
};
use sparo_core::agentic::tools::get_all_registered_tool_names;
use sparo_core::agentic::tools::implementations::bridge_component_runtime_tool_name;
use sparo_core::bridge_component::{BridgeComponentManager, BridgeComponentPackage};
use std::path::PathBuf;
use tauri::State;

fn workspace_root_from_request(workspace_path: Option<&str>) -> Option<PathBuf> {
    workspace_path
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
}

async fn validate_selected_tools(manifest: &AgentComponentManifest) -> Result<(), String> {
    let valid_tools = get_all_registered_tool_names().await;
    let invalid: Vec<String> = manifest
        .tools
        .iter()
        .filter(|tool| !valid_tools.contains(tool))
        .cloned()
        .collect();
    if !invalid.is_empty() {
        return Err(format!("Unknown tools: {}", invalid.join(", ")));
    }
    Ok(())
}

fn bridge_component_to_agent_info(package: BridgeComponentPackage) -> Option<AgentComponentInfo> {
    if !package.manifest.surfaces.agent || package.manifest.tools.is_empty() {
        return None;
    }
    let tools = package
        .manifest
        .tools
        .iter()
        .map(|tool| bridge_component_runtime_tool_name(&package.manifest.id, &tool.name))
        .collect::<Vec<_>>();
    let name = package
        .manifest
        .tools
        .first()
        .and_then(|tool| {
            tool.ui
                .as_ref()
                .and_then(|ui| ui.get("card"))
                .and_then(|card| card.get("displayName").or_else(|| card.get("title")))
                .and_then(Value::as_str)
        })
        .unwrap_or(&package.manifest.name)
        .to_string();
    let first_capability = package.manifest.capabilities.first();
    let examples = first_capability
        .map(|capability| {
            vec![AgentComponentExample {
                title: format!("Use {}", name),
                prompt: format!(
                    "Use {} to handle this task and summarize the result.",
                    capability.title
                ),
            }]
        })
        .unwrap_or_default();
    let bridge_capabilities = package
        .manifest
        .capabilities
        .iter()
        .map(|capability| AgentComponentBridgeCapabilityRef {
            bridge_id: package.manifest.id.clone(),
            capability_id: capability.id.clone(),
            alias: capability.id.clone(),
            mode: "auto".to_string(),
        })
        .collect();

    Some(AgentComponentInfo {
        id: package.manifest.id,
        name,
        description: package.manifest.description,
        icon: "plug".to_string(),
        category: format!("{:?}", package.manifest.kind).to_ascii_lowercase(),
        tags: vec!["bridge".to_string()],
        level: AgentComponentLevel::User,
        model: "primary".to_string(),
        readonly: package.manifest.tools.iter().all(|tool| tool.readonly),
        enabled: true,
        tools,
        skills: Vec::new(),
        subagents: Vec::new(),
        service_actions: Vec::new(),
        bridge_capabilities,
        examples,
        path: package.path,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentComponentsRequest {
    pub workspace_path: Option<String>,
}

#[tauri::command]
pub async fn list_agent_components(
    _state: State<'_, AppState>,
    request: ListAgentComponentsRequest,
) -> Result<Vec<AgentComponentInfo>, String> {
    let workspace = workspace_root_from_request(request.workspace_path.as_deref());
    AgentComponentManager::seed_builtin_agent_components().map_err(|e| e.to_string())?;
    AgentComponentManager::register_all(workspace.as_deref()).map_err(|e| e.to_string())?;
    AgentComponentManager::register_runtime_tools(workspace.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    BridgeComponentManager::register_agent_surfaces().map_err(|e| e.to_string())?;
    let mut apps = AgentComponentManager::list(workspace.as_deref()).map_err(|e| e.to_string())?;
    let existing_ids = apps
        .iter()
        .map(|app| app.id.clone())
        .collect::<std::collections::HashSet<_>>();
    let bridge_components = BridgeComponentManager::list()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|package| !existing_ids.contains(&package.manifest.id))
        .filter_map(bridge_component_to_agent_info);
    apps.extend(bridge_components);
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(apps)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAgentComponentRequest {
    pub id: String,
    pub level: Option<AgentComponentLevel>,
    pub workspace_path: Option<String>,
}

#[tauri::command]
pub async fn get_agent_component(
    _state: State<'_, AppState>,
    request: GetAgentComponentRequest,
) -> Result<AgentComponentPackage, String> {
    let workspace = workspace_root_from_request(request.workspace_path.as_deref());
    AgentComponentManager::get(&request.id, request.level, workspace.as_deref())
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAgentComponentRequest {
    pub manifest: AgentComponentManifest,
    pub prompt: String,
    #[serde(default)]
    pub overwrite: bool,
    pub workspace_path: Option<String>,
}

#[tauri::command]
pub async fn create_agent_component(
    _state: State<'_, AppState>,
    request: SaveAgentComponentRequest,
) -> Result<AgentComponentPackage, String> {
    let workspace = workspace_root_from_request(request.workspace_path.as_deref());
    let mut manifest = request.manifest;
    AgentComponentManager::validate_manifest(&mut manifest).map_err(|e| e.to_string())?;
    validate_selected_tools(&manifest).await?;
    let package = AgentComponentManager::create_or_update(
        manifest,
        request.prompt,
        workspace.as_deref(),
        request.overwrite,
    )
    .map_err(|e| e.to_string())?;
    AgentComponentManager::register_runtime_tools(workspace.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    Ok(package)
}

#[tauri::command]
pub async fn update_agent_component(
    _state: State<'_, AppState>,
    mut request: SaveAgentComponentRequest,
) -> Result<AgentComponentPackage, String> {
    request.overwrite = true;
    create_agent_component(_state, request).await
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAgentComponentRequest {
    pub id: String,
    pub level: AgentComponentLevel,
    pub workspace_path: Option<String>,
}

#[tauri::command]
pub async fn delete_agent_component(
    _state: State<'_, AppState>,
    request: DeleteAgentComponentRequest,
) -> Result<(), String> {
    let workspace = workspace_root_from_request(request.workspace_path.as_deref());
    AgentComponentManager::delete(&request.id, request.level, workspace.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reload_agent_components(
    _state: State<'_, AppState>,
    request: ListAgentComponentsRequest,
) -> Result<Vec<AgentComponentInfo>, String> {
    list_agent_components(_state, request).await
}

#[tauri::command]
pub async fn validate_agent_component_package(
    _state: State<'_, AppState>,
    request: SaveAgentComponentRequest,
) -> Result<Value, String> {
    let mut manifest = request.manifest;
    AgentComponentManager::validate_manifest(&mut manifest).map_err(|e| e.to_string())?;
    if request.prompt.trim().is_empty() {
        return Err("Agent Component prompt cannot be empty".to_string());
    }
    validate_selected_tools(&manifest).await?;
    Ok(serde_json::json!({ "ok": true, "manifest": manifest }))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentComponentJsToolRequest {
    pub component_id: String,
    pub level: Option<AgentComponentLevel>,
    pub manifest: AgentComponentJsToolManifest,
    pub source: String,
    pub workspace_path: Option<String>,
}

#[tauri::command]
pub async fn create_agent_component_js_tool(
    _state: State<'_, AppState>,
    request: CreateAgentComponentJsToolRequest,
) -> Result<String, String> {
    let workspace = workspace_root_from_request(request.workspace_path.as_deref());
    let tool = AgentComponentManager::create_js_tool(
        &request.component_id,
        request.level,
        workspace.as_deref(),
        request.manifest,
        request.source,
    )
    .map_err(|e| e.to_string())?;
    AgentComponentManager::register_runtime_tools(workspace.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    Ok(tool)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestAgentComponentJsToolRequest {
    pub component_id: String,
    pub level: Option<AgentComponentLevel>,
    pub tool_name: String,
    pub input: Value,
    pub workspace_path: Option<String>,
}

#[tauri::command]
pub async fn test_agent_component_js_tool(
    _state: State<'_, AppState>,
    request: TestAgentComponentJsToolRequest,
) -> Result<Value, String> {
    let workspace = workspace_root_from_request(request.workspace_path.as_deref());
    AgentComponentManager::test_js_tool(
        &request.component_id,
        &request.tool_name,
        &request.input,
        request.level,
        workspace.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_agent_component(
    _state: State<'_, AppState>,
    request: GetAgentComponentRequest,
) -> Result<Value, String> {
    let workspace = workspace_root_from_request(request.workspace_path.as_deref());
    let package = AgentComponentManager::get(&request.id, request.level, workspace.as_deref())
        .map_err(|e| e.to_string())?;
    let app_dir = PathBuf::from(&package.path);
    let tools_dir = app_dir.join("tools");
    let mut js_tools = Vec::new();
    if tools_dir.exists() {
        for entry in std::fs::read_dir(&tools_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let manifest_text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let manifest: AgentComponentJsToolManifest =
                serde_json::from_str(&manifest_text).map_err(|e| e.to_string())?;
            let source = std::fs::read_to_string(app_dir.join(&manifest.entry))
                .map_err(|e| e.to_string())?;
            js_tools.push(json!({ "manifest": manifest, "source": source }));
        }
    }
    Ok(json!({
        "schemaVersion": 1,
        "manifest": package.manifest,
        "prompt": package.prompt,
        "jsTools": js_tools,
    }))
}

#[tauri::command]
pub async fn import_agent_component(
    _state: State<'_, AppState>,
    request: Value,
) -> Result<Value, String> {
    let workspace_path = request
        .get("workspacePath")
        .and_then(Value::as_str)
        .map(str::to_string);
    let workspace = workspace_root_from_request(workspace_path.as_deref());
    let mut manifest: AgentComponentManifest = serde_json::from_value(
        request
            .get("manifest")
            .cloned()
            .ok_or_else(|| "manifest is required".to_string())?,
    )
    .map_err(|e| e.to_string())?;
    AgentComponentManager::validate_manifest(&mut manifest).map_err(|e| e.to_string())?;
    validate_selected_tools(&manifest).await?;
    let prompt = request
        .get("prompt")
        .and_then(Value::as_str)
        .ok_or_else(|| "prompt is required".to_string())?
        .to_string();
    let package =
        AgentComponentManager::create_or_update(manifest, prompt, workspace.as_deref(), true)
            .map_err(|e| e.to_string())?;
    if let Some(js_tools) = request.get("jsTools").and_then(Value::as_array) {
        for item in js_tools {
            let manifest: AgentComponentJsToolManifest = serde_json::from_value(
                item.get("manifest")
                    .cloned()
                    .ok_or_else(|| "jsTools[].manifest is required".to_string())?,
            )
            .map_err(|e| e.to_string())?;
            let source = item
                .get("source")
                .and_then(Value::as_str)
                .ok_or_else(|| "jsTools[].source is required".to_string())?;
            AgentComponentManager::create_js_tool(
                &package.manifest.id,
                Some(package.manifest.level),
                workspace.as_deref(),
                manifest,
                source.to_string(),
            )
            .map_err(|e| e.to_string())?;
        }
    }
    AgentComponentManager::register_runtime_tools(workspace.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    Ok(json!(package))
}
