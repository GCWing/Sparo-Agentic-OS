//! Subagent API

use crate::api::app_state::AppState;
use log::warn;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sparo_core::agentic::agents::{
    AgentCategory, AgentInfo, CustomSubagent, CustomSubagentConfig, CustomSubagentDetail,
    CustomSubagentKind, SubAgentSource,
};
use sparo_core::service::config::catalog::{SETTING_AI_AGENT_MODELS, SETTING_AI_SUBAGENT_CONFIGS};
use sparo_core::service::config::types::SubAgentConfig;
use sparo_core::service::config::{ConfigPatchOperation, ConfigService};
use sparo_events::{ConfigChangeSource, ConfigChangeSourceKind};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSubagentsRequest {
    pub source: Option<SubAgentSource>,
    pub workspace_path: Option<String>,
}

fn workspace_root_from_request(workspace_path: Option<&str>) -> Option<PathBuf> {
    workspace_path
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

async fn commit_subagent_settings(
    config_service: &ConfigService,
    operations: Vec<ConfigPatchOperation>,
    surface: &'static str,
) -> Result<(), String> {
    config_service
        .commit_operations(
            ConfigChangeSource {
                kind: ConfigChangeSourceKind::Manual,
                surface: Some(surface.to_string()),
                request_id: None,
            },
            operations,
            true,
        )
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_subagents(
    state: State<'_, AppState>,
    request: ListSubagentsRequest,
) -> Result<Vec<AgentInfo>, String> {
    let workspace = workspace_root_from_request(request.workspace_path.as_deref());
    let list = state
        .agent_registry
        .get_subagents_info(workspace.as_deref())
        .await
        .map_err(|error| format!("Failed to read subagent configuration: {error}"))?;

    let result = match request.source {
        Some(source) => list
            .into_iter()
            .filter(|a| a.subagent_source == Some(source))
            .collect(),
        None => list,
    };

    Ok(result)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSubagentInfo {
    #[serde(flatten)]
    pub subagent: AgentInfo,
    pub disabled_by_agent: bool,
    pub selected_for_runtime: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAgentSubagentConfigsRequest {
    pub agent_id: String,
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceAgentSubagentSelectionRequest {
    pub agent_id: String,
    pub enabled_subagent_ids: Vec<String>,
    pub workspace_path: Option<String>,
}

#[tauri::command]
pub async fn get_agent_subagent_configs(
    state: State<'_, AppState>,
    request: GetAgentSubagentConfigsRequest,
) -> Result<Vec<AgentSubagentInfo>, String> {
    let workspace = workspace_root_from_request(request.workspace_path.as_deref());
    let subagents = state
        .agent_registry
        .get_subagents_info(workspace.as_deref())
        .await
        .map_err(|error| format!("Failed to read subagent configuration: {error}"))?
        .into_iter()
        .filter(|subagent| subagent.enabled)
        .collect::<Vec<_>>();
    let profile = state
        .agent_registry
        .get_agent_capability_profile(&request.agent_id, workspace.as_deref())
        .await
        .map_err(|error| format!("Failed to read agent capability configuration: {error}"))?
        .ok_or_else(|| format!("Agent not found: {}", request.agent_id))?;
    let effective_set: HashSet<String> = profile.subagents.effective.into_iter().collect();

    Ok(subagents
        .into_iter()
        .map(|subagent| {
            let selected_for_runtime = effective_set.contains(&subagent.id);
            AgentSubagentInfo {
                disabled_by_agent: !selected_for_runtime,
                selected_for_runtime,
                subagent,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn replace_agent_subagent_selection(
    state: State<'_, AppState>,
    request: ReplaceAgentSubagentSelectionRequest,
) -> Result<String, String> {
    let workspace = workspace_root_from_request(request.workspace_path.as_deref());
    let subagents = state
        .agent_registry
        .get_subagents_info(workspace.as_deref())
        .await
        .map_err(|error| format!("Failed to read subagent configuration: {error}"))?
        .into_iter()
        .filter(|subagent| subagent.enabled)
        .collect::<Vec<_>>();
    let valid_subagents: HashSet<String> = subagents
        .iter()
        .map(|subagent| subagent.id.clone())
        .collect();
    let default_subagents: HashSet<String> = subagents
        .iter()
        .map(|subagent| subagent.id.clone())
        .collect();

    let mut seen = HashSet::new();
    let enabled_subagent_ids: Vec<String> = request
        .enabled_subagent_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .filter(|id| seen.insert(id.clone()))
        .collect();
    let unknown: Vec<String> = enabled_subagent_ids
        .iter()
        .filter(|id| !valid_subagents.contains(*id))
        .cloned()
        .collect();
    if !unknown.is_empty() {
        return Err(format!(
            "Unknown subagents for agent '{}': {}",
            request.agent_id,
            unknown.join(", ")
        ));
    }

    let enabled_set: HashSet<String> = enabled_subagent_ids.iter().cloned().collect();
    let disabled_subagents: Vec<String> = default_subagents
        .iter()
        .filter(|id| !enabled_set.contains(*id))
        .cloned()
        .collect();
    let enabled_subagents: Vec<String> = enabled_subagent_ids
        .into_iter()
        .filter(|id| !default_subagents.contains(id))
        .collect();

    sparo_core::service::config::agent_capability_config_canonicalizer::persist_agent_capability_config_from_value(
        &request.agent_id,
        json!({
            "disabled_subagents": disabled_subagents,
            "enabled_subagents": enabled_subagents,
        }),
    )
    .await
    .map_err(|e| format!("Failed to update agent subagents: {}", e))?;

    Ok(format!(
        "Agent {}' subagent selection updated successfully",
        request.agent_id
    ))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSubagentDetailRequest {
    pub subagent_id: String,
    pub workspace_path: Option<String>,
}

#[tauri::command]
pub async fn get_subagent_detail(
    state: State<'_, AppState>,
    request: GetSubagentDetailRequest,
) -> Result<CustomSubagentDetail, String> {
    let workspace = workspace_root_from_request(request.workspace_path.as_deref());
    state
        .agent_registry
        .get_custom_subagent_detail(&request.subagent_id, workspace.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSubagentRequest {
    pub subagent_id: String,
}

#[tauri::command]
pub async fn delete_subagent(
    state: State<'_, AppState>,
    request: DeleteSubagentRequest,
) -> Result<(), String> {
    let subagent_id = request.subagent_id;

    let config_service = &state.config_service;
    let mut agent_models: HashMap<String, String> = config_service
        .get_config(Some("ai.agent_models"))
        .await
        .map_err(|error| format!("Failed to read ai.agent_models: {error}"))?;
    agent_models.remove(&subagent_id);

    let mut subagent_configs: HashMap<String, SubAgentConfig> = config_service
        .get_config(Some("ai.subagent_configs"))
        .await
        .map_err(|error| format!("Failed to read ai.subagent_configs: {error}"))?;
    subagent_configs.remove(&subagent_id);

    commit_subagent_settings(
        config_service,
        vec![
            ConfigPatchOperation::Set {
                setting_id: SETTING_AI_AGENT_MODELS.to_string(),
                value: serde_json::to_value(agent_models).map_err(|error| error.to_string())?,
            },
            ConfigPatchOperation::Set {
                setting_id: SETTING_AI_SUBAGENT_CONFIGS.to_string(),
                value: serde_json::to_value(subagent_configs).map_err(|error| error.to_string())?,
            },
        ],
        "subagent-delete",
    )
    .await
    .map_err(|error| format!("Failed to clean up subagent settings: {error}"))?;

    let file_path = state
        .agent_registry
        .remove_subagent(&subagent_id)
        .map_err(|e| e.to_string())?;

    if let Some(ref path) = file_path {
        if let Err(e) = std::fs::remove_file(path) {
            warn!("Failed to delete subagent file: path={}, error={}", path, e);
        }
    }

    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSubagentRequest {
    pub subagent_id: String,
    pub description: String,
    pub prompt: String,
    pub tools: Option<Vec<String>>,
    pub readonly: Option<bool>,
    pub workspace_path: Option<String>,
}

#[tauri::command]
pub async fn update_subagent(
    state: State<'_, AppState>,
    request: UpdateSubagentRequest,
) -> Result<(), String> {
    if request.description.trim().is_empty() {
        return Err("Description cannot be empty".to_string());
    }
    if request.prompt.trim().is_empty() {
        return Err("Prompt cannot be empty".to_string());
    }
    let workspace = workspace_root_from_request(request.workspace_path.as_deref());
    state
        .agent_registry
        .update_custom_subagent_definition(
            &request.subagent_id,
            workspace.as_deref(),
            request.description.trim().to_string(),
            request.prompt.trim().to_string(),
            request.tools,
            request.readonly,
        )
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SubagentLevel {
    User,
    Project,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSubagentRequest {
    pub level: SubagentLevel,
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub tools: Option<Vec<String>>,
    pub readonly: Option<bool>,
    pub workspace_path: Option<String>,
}

fn validate_agent_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    let mut chars = name.chars();
    if !chars.next().is_some_and(|c| c.is_ascii_alphabetic()) {
        return Err("Name must start with a letter".to_string());
    }
    for c in chars {
        if !c.is_ascii_alphanumeric() && c != '-' && c != '_' {
            return Err("Name can only contain letters, numbers, -, _".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn create_subagent(
    state: State<'_, AppState>,
    request: CreateSubagentRequest,
) -> Result<(), String> {
    let name = request.name.trim();
    validate_agent_name(name)?;
    let workspace = workspace_root_from_request(request.workspace_path.as_deref());

    if request.level == SubagentLevel::Project && workspace.is_none() {
        return Err("Project-level Agent requires opening a workspace first".to_string());
    }

    let modes = state
        .agent_registry
        .list_agents_info()
        .await
        .map_err(|error| format!("Failed to read agent capability configuration: {error}"))?;
    let subagents = state
        .agent_registry
        .get_subagents_info(workspace.as_deref())
        .await
        .map_err(|error| format!("Failed to read subagent configuration: {error}"))?;
    let existing: std::collections::HashSet<_> = modes
        .iter()
        .map(|m| m.id.as_str().to_lowercase())
        .chain(subagents.iter().map(|s| s.id.as_str().to_lowercase()))
        .collect();
    if existing.contains(name.to_lowercase().as_str()) {
        return Err(format!(
            "Name '{}' conflicts with existing Agent or Sub Agent",
            name
        ));
    }

    let pm = state.workspace_service.path_manager();
    let agents_dir = match request.level {
        SubagentLevel::User => pm.user_agents_dir(),
        SubagentLevel::Project => {
            let root = workspace.as_deref().ok_or("Workspace path not available")?;
            pm.project_agents_dir(root)
        }
    };

    std::fs::create_dir_all(&agents_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let tools = request.tools.filter(|t| !t.is_empty()).unwrap_or_else(|| {
        vec![
            "LS".to_string(),
            "Read".to_string(),
            "Glob".to_string(),
            "Grep".to_string(),
        ]
    });
    let kind = match request.level {
        SubagentLevel::User => CustomSubagentKind::User,
        SubagentLevel::Project => CustomSubagentKind::Project,
    };
    let file_path = agents_dir.join(format!("{}.md", name.to_lowercase()));
    let path_str = file_path.to_string_lossy().to_string();
    if file_path.exists() {
        return Err(format!("File '{}' already exists", path_str));
    }

    let readonly = request.readonly.unwrap_or(true);
    let subagent = CustomSubagent::new(
        name.to_string(),
        request.description.trim().to_string(),
        tools,
        request.prompt.trim().to_string(),
        readonly,
        path_str.clone(),
        kind,
    );
    subagent
        .save_to_file(None, None)
        .map_err(|e| e.to_string())?;

    let custom_config = CustomSubagentConfig {
        enabled: subagent.enabled,
        model: subagent.model.clone(),
    };

    state.agent_registry.register_agent(
        Arc::new(subagent),
        AgentCategory::SubAgent,
        Some(SubAgentSource::from_custom_kind(kind)),
        Some(custom_config),
    );

    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReloadSubagentsRequest {
    pub workspace_path: Option<String>,
}

#[tauri::command]
pub async fn reload_subagents(
    state: State<'_, AppState>,
    request: ReloadSubagentsRequest,
) -> Result<(), String> {
    let workspace_root = workspace_root_from_request(request.workspace_path.as_deref())
        .ok_or_else(|| "workspacePath is required to reload project subagents".to_string())?;
    state
        .agent_registry
        .load_custom_subagents(workspace_root.as_path())
        .await
        .map_err(|error| format!("Failed to reload custom subagents: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn list_agent_tool_names(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let names: Vec<String> = state
        .tool_registry
        .iter()
        .map(|t| t.name().to_string())
        .collect();
    Ok(names)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSubagentConfigRequest {
    pub subagent_id: String,
    pub enabled: Option<bool>,
    pub model: Option<String>,
}

#[tauri::command]
pub async fn update_subagent_config(
    state: State<'_, AppState>,
    request: UpdateSubagentConfigRequest,
) -> Result<(), String> {
    let subagent_id = &request.subagent_id;

    if state
        .agent_registry
        .get_custom_subagent_config(subagent_id)
        .is_some()
    {
        state
            .agent_registry
            .update_and_save_custom_subagent_config(subagent_id, request.enabled, request.model)
            .map_err(|e| format!("Failed to update configuration: {}", e))?;
        Ok(())
    } else {
        let config_service = &state.config_service;
        let mut operations = Vec::new();

        if let Some(enabled) = request.enabled {
            let mut subagent_configs: HashMap<String, SubAgentConfig> = config_service
                .get_config(Some("ai.subagent_configs"))
                .await
                .map_err(|error| format!("Failed to read ai.subagent_configs: {error}"))?;
            subagent_configs.insert(subagent_id.clone(), SubAgentConfig { enabled });
            operations.push(ConfigPatchOperation::Set {
                setting_id: SETTING_AI_SUBAGENT_CONFIGS.to_string(),
                value: serde_json::to_value(subagent_configs)
                    .map_err(|e| format!("Failed to serialize subagent config: {e}"))?,
            });
        }

        if let Some(model) = request.model {
            let mut agent_models: HashMap<String, String> = config_service
                .get_config(Some("ai.agent_models"))
                .await
                .map_err(|error| format!("Failed to read ai.agent_models: {error}"))?;
            agent_models.insert(subagent_id.clone(), model);
            operations.push(ConfigPatchOperation::Set {
                setting_id: SETTING_AI_AGENT_MODELS.to_string(),
                value: serde_json::to_value(agent_models)
                    .map_err(|e| format!("Failed to serialize model configuration: {e}"))?,
            });
        }

        if !operations.is_empty() {
            commit_subagent_settings(config_service, operations, "subagent-update")
                .await
                .map_err(|error| format!("Failed to update subagent settings: {error}"))?;
        }

        Ok(())
    }
}
