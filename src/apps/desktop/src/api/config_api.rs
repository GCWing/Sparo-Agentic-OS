//! Configuration API

use crate::api::app_state::AppState;
use bitfun_core::agent_app::{AgentAppLevel, AgentAppManager};
use bitfun_core::agentic::agents::AgentCategory;
use bitfun_core::agentic::tools::get_all_registered_tool_names;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct GetConfigRequest {
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SetConfigRequest {
    pub path: String,
    pub value: Value,
}

#[derive(Debug, Deserialize)]
pub struct ResetConfigRequest {
    pub path: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct GetRuntimeLoggingInfoRequest {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAgentCapabilityProfileRequest {
    pub agent_id: String,
    pub workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentCapabilityProfileRequest {
    pub agent_id: String,
    pub workspace_path: Option<String>,
    pub enabled: Option<bool>,
    pub model: Option<String>,
    pub tools: Option<Vec<String>>,
    pub skills: Option<Vec<String>>,
    pub subagents: Option<Vec<String>>,
}

fn workspace_root_from_request(workspace_path: Option<&str>) -> Option<std::path::PathBuf> {
    workspace_path
        .filter(|path| !path.trim().is_empty())
        .map(std::path::PathBuf::from)
}

fn normalize_unique_list(items: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    items
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .filter(|item| seen.insert(item.clone()))
        .collect()
}

fn to_json_value<T: Serialize>(value: T, context: &str) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| format!("Failed to serialize {}: {}", context, e))
}

#[tauri::command]
pub async fn get_config(
    state: State<'_, AppState>,
    request: GetConfigRequest,
) -> Result<Value, String> {
    let config_service = &state.config_service;

    match config_service
        .get_config::<Value>(request.path.as_deref())
        .await
    {
        Ok(config) => Ok(config),
        Err(e) => {
            error!("Failed to get config: path={:?}, error={}", request.path, e);
            Err(format!("Failed to get config: {}", e))
        }
    }
}

#[tauri::command]
pub async fn set_config(
    state: State<'_, AppState>,
    request: SetConfigRequest,
) -> Result<String, String> {
    let config_service = &state.config_service;

    match config_service
        .set_config(&request.path, request.value)
        .await
    {
        Ok(_) => {
            if let Err(e) = bitfun_core::service::config::reload_global_config().await {
                warn!(
                    "Failed to sync global config after set_config: path={}, error={}",
                    request.path, e
                );
            } else {
                info!(
                    "Global config synced after set_config: path={}",
                    request.path
                );
            }

            if request.path.starts_with("ai.models")
                || request.path.starts_with("ai.default_models")
                || request.path.starts_with("ai.agent_models")
                || request.path.starts_with("ai.stream_idle_timeout_secs")
                || request.path.starts_with("ai.proxy")
            {
                state.ai_client_factory.invalidate_cache();
                info!(
                    "AI config changed, cache invalidated: path={}",
                    request.path
                );
            }

            Ok("Configuration set successfully".to_string())
        }
        Err(e) => {
            error!("Failed to set config: path={}, error={}", request.path, e);
            Err(format!("Failed to set config: {}", e))
        }
    }
}

#[tauri::command]
pub async fn reset_config(
    state: State<'_, AppState>,
    request: ResetConfigRequest,
) -> Result<String, String> {
    let config_service = &state.config_service;

    match config_service.reset_config(request.path.as_deref()).await {
        Ok(_) => {
            if let Err(e) = bitfun_core::service::config::reload_global_config().await {
                warn!(
                    "Failed to sync global config after reset_config: path={:?}, error={}",
                    request.path, e
                );
            } else {
                info!(
                    "Global config synced after reset_config: path={:?}",
                    request.path
                );
            }

            let message = if let Some(path) = &request.path {
                format!("Configuration '{}' reset successfully", path)
            } else {
                "All configurations reset successfully".to_string()
            };

            let should_invalidate = match &request.path {
                Some(path) => path.starts_with("ai"),
                None => true,
            };
            if should_invalidate {
                state.ai_client_factory.invalidate_cache();
                info!(
                    "AI config reset, cache invalidated: path={:?}",
                    request.path
                );
            }

            Ok(message)
        }
        Err(e) => {
            error!(
                "Failed to reset config: path={:?}, error={}",
                request.path, e
            );
            Err(format!("Failed to reset config: {}", e))
        }
    }
}

#[tauri::command]
pub async fn export_config(state: State<'_, AppState>) -> Result<Value, String> {
    let config_service = &state.config_service;

    match config_service.export_config().await {
        Ok(export_data) => Ok(to_json_value(export_data, "export config data")?),
        Err(e) => {
            error!("Failed to export config: {}", e);
            Err(format!("Failed to export config: {}", e))
        }
    }
}

#[tauri::command]
pub async fn import_config(state: State<'_, AppState>, config: Value) -> Result<Value, String> {
    let config_service = &state.config_service;

    let export_data: bitfun_core::service::config::ConfigExport =
        serde_json::from_value(config).map_err(|e| format!("Invalid config format: {}", e))?;

    match config_service.import_config(export_data).await {
        Ok(result) => {
            if let Err(e) = bitfun_core::service::config::reload_global_config().await {
                warn!("Failed to sync global config after import_config: {}", e);
            } else {
                info!("Global config synced after import_config");
            }
            state.ai_client_factory.invalidate_cache();
            info!("Config imported, AI client cache invalidated");
            Ok(to_json_value(result, "import config result")?)
        }
        Err(e) => {
            error!("Failed to import config: {}", e);
            Err(format!("Failed to import config: {}", e))
        }
    }
}

#[tauri::command]
pub async fn validate_config(state: State<'_, AppState>) -> Result<Value, String> {
    let config_service = &state.config_service;

    match config_service.validate_config().await {
        Ok(validation_result) => Ok(to_json_value(
            validation_result,
            "config validation result",
        )?),
        Err(e) => {
            error!("Failed to validate config: {}", e);
            Err(format!("Failed to validate config: {}", e))
        }
    }
}

#[tauri::command]
pub async fn reload_config(state: State<'_, AppState>) -> Result<String, String> {
    let config_service = &state.config_service;

    match config_service.reload().await {
        Ok(_) => {
            info!("Config reloaded");
            Ok("Configuration reloaded successfully".to_string())
        }
        Err(e) => {
            error!("Failed to reload config: {}", e);
            Err(format!("Failed to reload config: {}", e))
        }
    }
}

#[tauri::command]
pub async fn sync_config_to_global(_state: State<'_, AppState>) -> Result<String, String> {
    match bitfun_core::service::config::reload_global_config().await {
        Ok(_) => {
            info!("Config synced to global service");
            Ok("Configuration synced to global service".to_string())
        }
        Err(e) => {
            error!("Failed to sync config to global service: {}", e);
            Err(format!("Failed to sync config to global service: {}", e))
        }
    }
}

#[tauri::command]
pub async fn get_global_config_health() -> Result<bool, String> {
    Ok(bitfun_core::service::config::GlobalConfigManager::is_initialized())
}

#[tauri::command]
pub async fn get_runtime_logging_info(
    _state: State<'_, AppState>,
    _request: GetRuntimeLoggingInfoRequest,
) -> Result<Value, String> {
    let logging_info = crate::logging::get_runtime_logging_info();
    to_json_value(logging_info, "runtime logging info")
}

#[tauri::command]
pub async fn get_agent_capability_profile(
    state: State<'_, AppState>,
    request: GetAgentCapabilityProfileRequest,
) -> Result<Value, String> {
    let workspace = workspace_root_from_request(request.workspace_path.as_deref());
    let profile = state
        .agent_registry
        .get_agent_capability_profile(&request.agent_id, workspace.as_deref())
        .await
        .ok_or_else(|| format!("Agent not found: {}", request.agent_id))?;

    to_json_value(profile, "agent capability profile")
}

async fn set_agent_model_config(
    state: &State<'_, AppState>,
    agent_id: &str,
    model: Option<String>,
) -> Result<(), String> {
    let mut agent_models: HashMap<String, String> = state
        .config_service
        .get_config(Some("ai.agent_models"))
        .await
        .unwrap_or_default();

    match model.map(|value| value.trim().to_string()) {
        Some(model) if !model.is_empty() => {
            agent_models.insert(agent_id.to_string(), model);
        }
        _ => {
            agent_models.remove(agent_id);
        }
    }

    state
        .config_service
        .set_config("ai.agent_models", &agent_models)
        .await
        .map_err(|e| format!("Failed to update model configuration: {}", e))
}

async fn validate_known_skills(
    skill_keys: &[String],
    workspace_path: Option<&str>,
) -> Result<(), String> {
    let registry = bitfun_core::agentic::tools::implementations::skills::SkillRegistry::global();
    let workspace = workspace_root_from_request(workspace_path);
    let all_skills = registry
        .get_all_skills_for_workspace(workspace.as_deref())
        .await;
    let known: HashSet<String> = all_skills.into_iter().map(|skill| skill.key).collect();
    let unknown = skill_keys
        .iter()
        .filter(|key| !known.contains(*key))
        .cloned()
        .collect::<Vec<_>>();
    if unknown.is_empty() {
        Ok(())
    } else {
        Err(format!("Unknown skill keys: {}", unknown.join(", ")))
    }
}

async fn validate_known_subagents(
    state: &State<'_, AppState>,
    subagent_ids: &[String],
    workspace: Option<&std::path::Path>,
) -> Result<(), String> {
    let known: HashSet<String> = state
        .agent_registry
        .get_subagents_info(workspace)
        .await
        .into_iter()
        .filter(|subagent| subagent.enabled)
        .map(|subagent| subagent.id)
        .collect();
    let unknown = subagent_ids
        .iter()
        .filter(|id| !known.contains(*id))
        .cloned()
        .collect::<Vec<_>>();
    if unknown.is_empty() {
        Ok(())
    } else {
        Err(format!("Unknown subagents: {}", unknown.join(", ")))
    }
}

async fn update_agent_capability_profile_for_builtin_agent(
    state: State<'_, AppState>,
    request: UpdateAgentCapabilityProfileRequest,
) -> Result<(), String> {
    let mut config = serde_json::Map::new();

    if let Some(enabled) = request.enabled {
        config.insert("enabled".to_string(), json!(enabled));
    }
    if let Some(tools) = request.tools {
        config.insert(
            "enabled_tools".to_string(),
            json!(normalize_unique_list(tools)),
        );
    }
    if !config.is_empty() {
        bitfun_core::service::config::agent_capability_config_canonicalizer::persist_agent_capability_config_from_value(
            &request.agent_id,
            Value::Object(config),
        )
        .await
        .map_err(|e| format!("Failed to update agent capabilities: {}", e))?;
    }

    if let Some(skills) = request.skills {
        crate::api::skill_api::replace_agent_skill_selection(
            state.clone(),
            crate::api::skill_api::ReplaceAgentSkillSelectionRequest {
                agent_id: request.agent_id.clone(),
                enabled_skill_keys: normalize_unique_list(skills),
                workspace_path: request.workspace_path.clone(),
            },
        )
        .await?;
    }

    if let Some(subagents) = request.subagents {
        crate::api::subagent_api::replace_agent_subagent_selection(
            state.clone(),
            crate::api::subagent_api::ReplaceAgentSubagentSelectionRequest {
                agent_id: request.agent_id.clone(),
                enabled_subagent_ids: normalize_unique_list(subagents),
                workspace_path: request.workspace_path.clone(),
            },
        )
        .await?;
    }

    if request.model.is_some() {
        set_agent_model_config(&state, &request.agent_id, request.model).await?;
    }

    if let Err(e) = bitfun_core::service::config::reload_global_config().await {
        warn!(
            "Failed to reload global config after agent capability update: agent_id={}, error={}",
            request.agent_id, e
        );
    }
    Ok(())
}

async fn update_agent_app_capability_profile(
    state: State<'_, AppState>,
    request: UpdateAgentCapabilityProfileRequest,
    workspace: Option<&std::path::Path>,
) -> Result<(), String> {
    let package = AgentAppManager::get(&request.agent_id, Some(AgentAppLevel::User), workspace)
        .map_err(|e| e.to_string())?;
    let mut manifest = package.manifest;
    manifest.level = AgentAppLevel::User;

    if let Some(enabled) = request.enabled {
        manifest.enabled = enabled;
    }
    if let Some(model) = request.model {
        manifest.model = model.trim().to_string();
    }
    if let Some(tools) = request.tools {
        manifest.tools = normalize_unique_list(tools);
    }
    if let Some(skills) = request.skills {
        manifest.skills = normalize_unique_list(skills);
    }
    if let Some(subagents) = request.subagents {
        manifest.subagents = normalize_unique_list(subagents);
    }

    let valid_tools = get_all_registered_tool_names().await;
    let invalid_tools = manifest
        .tools
        .iter()
        .filter(|tool| !valid_tools.contains(*tool))
        .cloned()
        .collect::<Vec<_>>();
    if !invalid_tools.is_empty() {
        return Err(format!("Unknown tools: {}", invalid_tools.join(", ")));
    }
    validate_known_skills(&manifest.skills, request.workspace_path.as_deref()).await?;
    validate_known_subagents(&state, &manifest.subagents, workspace).await?;
    AgentAppManager::validate_manifest(&mut manifest).map_err(|e| e.to_string())?;
    AgentAppManager::create_or_update(manifest, package.prompt, workspace, true)
        .map_err(|e| e.to_string())?;
    AgentAppManager::register_runtime_tools(workspace)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

async fn update_subagent_capability_profile(
    state: State<'_, AppState>,
    request: UpdateAgentCapabilityProfileRequest,
    workspace: Option<&std::path::Path>,
) -> Result<(), String> {
    if request.skills.is_some() {
        return Err("Subagent skill overrides are not configurable yet".to_string());
    }
    if request.subagents.is_some() {
        return Err("Nested subagent delegation is not configurable yet".to_string());
    }

    let is_custom = state
        .agent_registry
        .get_custom_subagent_config(&request.agent_id)
        .is_some();

    if let Some(tools) = request.tools {
        if !is_custom {
            return Err("Built-in subagent tools are read-only".to_string());
        }
        let detail = state
            .agent_registry
            .get_custom_subagent_detail(&request.agent_id, workspace)
            .await
            .map_err(|e| format!("Failed to load subagent detail: {}", e))?;
        let tools = normalize_unique_list(tools);
        let valid_tools = get_all_registered_tool_names().await;
        let invalid_tools = tools
            .iter()
            .filter(|tool| !valid_tools.contains(*tool))
            .cloned()
            .collect::<Vec<_>>();
        if !invalid_tools.is_empty() {
            return Err(format!("Unknown tools: {}", invalid_tools.join(", ")));
        }
        state
            .agent_registry
            .update_custom_subagent_definition(
                &request.agent_id,
                workspace,
                detail.description,
                detail.prompt,
                Some(tools),
                Some(detail.readonly),
            )
            .await
            .map_err(|e| format!("Failed to update subagent tools: {}", e))?;
        state
            .agent_registry
            .update_and_save_custom_subagent_config(
                &request.agent_id,
                Some(detail.enabled),
                Some(detail.model),
            )
            .map_err(|e| format!("Failed to preserve subagent configuration: {}", e))?;
    }

    if is_custom {
        if request.enabled.is_some() || request.model.is_some() {
            state
                .agent_registry
                .update_and_save_custom_subagent_config(
                    &request.agent_id,
                    request.enabled,
                    request.model,
                )
                .map_err(|e| format!("Failed to update subagent configuration: {}", e))?;
        }
    } else {
        if let Some(enabled) = request.enabled {
            let config = bitfun_core::service::config::types::SubAgentConfig { enabled };
            let path = format!("ai.subagent_configs.{}", request.agent_id);
            let config_value = serde_json::to_value(&config)
                .map_err(|e| format!("Failed to serialize subagent config: {}", e))?;
            state
                .config_service
                .set_config(&path, config_value)
                .await
                .map_err(|e| format!("Failed to update enabled status: {}", e))?;
        }

        if request.model.is_some() {
            set_agent_model_config(&state, &request.agent_id, request.model).await?;
        }
    }

    if let Err(e) = bitfun_core::service::config::reload_global_config().await {
        warn!(
            "Failed to reload global config after subagent capability update: agent_id={}, error={}",
            request.agent_id, e
        );
    }

    Ok(())
}

fn reject_hidden_capability_update(
    request: &UpdateAgentCapabilityProfileRequest,
) -> Result<(), String> {
    let mut fields = Vec::new();
    if request.enabled.is_some() {
        fields.push("enabled");
    }
    if request.model.is_some() {
        fields.push("model");
    }
    if request.tools.is_some() {
        fields.push("tools");
    }
    if request.skills.is_some() {
        fields.push("skills");
    }
    if request.subagents.is_some() {
        fields.push("subagents");
    }
    if fields.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Hidden agents are read-only; cannot update {}",
            fields.join(", ")
        ))
    }
}

#[tauri::command]
pub async fn update_agent_capability_profile(
    state: State<'_, AppState>,
    request: UpdateAgentCapabilityProfileRequest,
) -> Result<Value, String> {
    let workspace = workspace_root_from_request(request.workspace_path.as_deref());
    let agent_id = request.agent_id.clone();
    let category = state
        .agent_registry
        .get_agent_category(&agent_id, workspace.as_deref())
        .ok_or_else(|| format!("Agent not found: {}", agent_id))?;

    match category {
        AgentCategory::Agent => update_agent_capability_profile_for_builtin_agent(state.clone(), request).await?,
        AgentCategory::AgentApp => {
            update_agent_app_capability_profile(state.clone(), request, workspace.as_deref())
                .await?
        }
        AgentCategory::SubAgent => {
            update_subagent_capability_profile(state.clone(), request, workspace.as_deref()).await?
        }
        AgentCategory::Hidden => {
            reject_hidden_capability_update(&request)?;
        }
    }

    let profile = state
        .agent_registry
        .get_agent_capability_profile(&agent_id, workspace.as_deref())
        .await
        .ok_or_else(|| format!("Agent not found after update: {}", agent_id))?;
    to_json_value(profile, "agent capability profile")
}

#[tauri::command]
pub async fn get_agent_capability_configs(_state: State<'_, AppState>) -> Result<Value, String> {
    let agent_capability_configs =
        bitfun_core::service::config::agent_capability_config_canonicalizer::get_agent_capability_config_views()
            .await
            .map_err(|e| format!("Failed to get agent capability configs: {}", e))?;

    to_json_value(agent_capability_configs, "agent capability configs")
}

#[tauri::command]
pub async fn get_agent_capability_config(
    _state: State<'_, AppState>,
    agent_id: String,
) -> Result<Value, String> {
    let config =
        bitfun_core::service::config::agent_capability_config_canonicalizer::get_agent_capability_config_view(&agent_id)
            .await
            .map_err(|e| format!("Failed to get agent capability config: {}", e))?;

    to_json_value(config, "agent capability config")
}

#[tauri::command]
pub async fn set_agent_capability_config(
    state: State<'_, AppState>,
    agent_id: String,
    config: Value,
) -> Result<String, String> {
    let _ = state;

    match bitfun_core::service::config::agent_capability_config_canonicalizer::persist_agent_capability_config_from_value(
        &agent_id, config,
    )
    .await
    {
        Ok(_) => {
            if let Err(e) = bitfun_core::service::config::reload_global_config().await {
                warn!(
                    "Failed to reload global config after agent capability config change: agent_id={}, error={}",
                    agent_id, e
                );
            } else {
                info!(
                    "Global config reloaded after agent capability config change: agent_id={}",
                    agent_id
                );
            }

            Ok(format!("Agent {}' configuration set successfully", agent_id))
        }
        Err(e) => {
            error!(
                "Failed to set agent capability config: agent_id={}, error={}",
                agent_id, e
            );
            Err(format!("Failed to set agent capability config: {}", e))
        }
    }
}

#[tauri::command]
pub async fn reset_agent_capability_config(
    _state: State<'_, AppState>,
    agent_id: String,
) -> Result<String, String> {
    match bitfun_core::service::config::agent_capability_config_canonicalizer::reset_agent_capability_config_to_default(
        &agent_id,
    )
    .await
    {
        Ok(_) => {
            if let Err(e) = bitfun_core::service::config::reload_global_config().await {
                warn!(
                    "Failed to reload global config after agent capability config reset: agent_id={}, error={}",
                    agent_id, e
                );
            } else {
                info!(
                    "Global config reloaded after agent capability config reset: agent_id={}",
                    agent_id
                );
            }

            Ok(format!(
                "Agent {}' configuration reset successfully",
                agent_id
            ))
        }
        Err(e) => {
            error!(
                "Failed to reset agent capability config: agent_id={}, error={}",
                agent_id, e
            );
            Err(format!("Failed to reset agent capability config: {}", e))
        }
    }
}

#[tauri::command]
pub async fn get_subagent_configs(state: State<'_, AppState>) -> Result<Value, String> {
    use bitfun_core::service::config::types::SubAgentConfig;
    use std::collections::HashMap;

    let config_service = &state.config_service;
    let mut subagent_configs: HashMap<String, SubAgentConfig> = config_service
        .get_config(Some("ai.subagent_configs"))
        .await
        .unwrap_or_default();

    let workspace = state.workspace_path.read().await.clone();
    let all_subagents = state
        .agent_registry
        .get_subagents_info(workspace.as_deref())
        .await;
    let mut needs_save = false;

    for subagent in all_subagents {
        let subagent_id = subagent.id;
        if let std::collections::hash_map::Entry::Vacant(e) = subagent_configs.entry(subagent_id) {
            e.insert(SubAgentConfig { enabled: true });
            needs_save = true;
        }
    }

    if needs_save {
        match to_json_value(&subagent_configs, "subagent configs") {
            Ok(subagent_configs_value) => {
                if let Err(e) = config_service
                    .set_config("ai.subagent_configs", subagent_configs_value)
                    .await
                {
                    warn!("Failed to save initialized subagent configs: {}", e);
                }
            }
            Err(e) => {
                warn!("Failed to serialize initialized subagent configs: {}", e);
            }
        }
    }

    to_json_value(subagent_configs, "subagent configs")
}

#[tauri::command]
pub async fn set_subagent_config(
    state: State<'_, AppState>,
    subagent_id: String,
    enabled: bool,
) -> Result<String, String> {
    use bitfun_core::service::config::types::SubAgentConfig;

    let config_service = &state.config_service;
    let config = SubAgentConfig { enabled };
    let path = format!("ai.subagent_configs.{}", subagent_id);
    let config_value = to_json_value(&config, "subagent config")?;

    match config_service.set_config(&path, config_value).await {
        Ok(_) => {
            if let Err(e) = bitfun_core::service::config::reload_global_config().await {
                warn!("Failed to reload global config after subagent config change: subagent_id={}, error={}", subagent_id, e);
            } else {
                info!("Global config reloaded after subagent config change: subagent_id={}, enabled={}", subagent_id, enabled);
            }

            Ok(format!(
                "SubAgent '{}' configuration set successfully",
                subagent_id
            ))
        }
        Err(e) => {
            error!(
                "Failed to set subagent config: subagent_id={}, enabled={}, error={}",
                subagent_id, enabled, e
            );
            Err(format!("Failed to set SubAgent config: {}", e))
        }
    }
}

#[tauri::command]
pub async fn canonicalize_agent_capability_configs(_state: State<'_, AppState>) -> Result<Value, String> {
    match bitfun_core::service::config::agent_capability_config_canonicalizer::canonicalize_agent_capability_configs().await
    {
        Ok(report) => {
            info!(
                "Agent capability configs canonicalized: removed_agents={}, updated_agents={}",
                report.removed_agent_capability_configs.len(),
                report.updated_agents.len()
            );
            Ok(to_json_value(
                report,
                "agent capability config canonicalization report",
            )?)
        }
        Err(e) => {
            error!("Failed to canonicalize agent capability configs: {}", e);
            Err(format!("Failed to canonicalize agent capability configs: {}", e))
        }
    }
}
