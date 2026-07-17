//! Agent capability configuration resolution and mutation.
//!
//! Stored configuration keeps only user overrides. Effective tool lists are
//! derived from the current agent defaults at runtime.

use crate::agentic::agents::get_agent_registry;
use crate::agentic::tools::registry::get_all_registered_tools;
use crate::error::*;
use crate::service::config::catalog::SETTING_AI_AGENT_CAPABILITY_CONFIGS;
use crate::service::config::global::GlobalConfigManager;
use crate::service::config::types::{AgentCapabilityConfig, AgentCapabilityConfigView};
use crate::service::config::{ConfigPatchOperation, ConfigService};
use serde_json::Value;
use sparo_events::{ConfigChangeSource, ConfigChangeSourceKind};
use std::collections::{HashMap, HashSet};

async fn commit_agent_capability_configs(
    config_service: &ConfigService,
    value: Value,
    source_kind: ConfigChangeSourceKind,
    surface: &'static str,
) -> CoreResult<()> {
    config_service
        .commit_operations(
            ConfigChangeSource {
                kind: source_kind,
                surface: Some(surface.to_string()),
                request_id: None,
            },
            vec![ConfigPatchOperation::Set {
                setting_id: SETTING_AI_AGENT_CAPABILITY_CONFIGS.to_string(),
                value,
            }],
            true,
        )
        .await
        .map(|_| ())
}

fn dedupe_preserving_order(items: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();

    for item in items {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            continue;
        }

        let owned = trimmed.to_string();
        if seen.insert(owned.clone()) {
            normalized.push(owned);
        }
    }

    normalized
}

fn normalize_tools(tools: Vec<String>, valid_tools: &HashSet<String>) -> Vec<String> {
    dedupe_preserving_order(tools)
        .into_iter()
        .filter(|tool| valid_tools.contains(tool))
        .collect()
}

fn normalize_skill_keys(keys: Vec<String>) -> Vec<String> {
    dedupe_preserving_order(keys)
}

fn normalize_subagent_ids(ids: Vec<String>) -> Vec<String> {
    dedupe_preserving_order(ids)
}

fn normalize_skill_override_lists(
    disabled_user_skills: Vec<String>,
    enabled_user_skills: Vec<String>,
    disabled_user_skill_suites: Vec<String>,
    enabled_user_skill_suites: Vec<String>,
) -> (Vec<String>, Vec<String>, Vec<String>, Vec<String>) {
    let disabled_user_skills = normalize_skill_keys(disabled_user_skills);
    let disabled_set: HashSet<String> = disabled_user_skills.iter().cloned().collect();
    let mut enabled_user_skills = normalize_skill_keys(enabled_user_skills);
    enabled_user_skills.retain(|key| !disabled_set.contains(key));

    let disabled_user_skill_suites = normalize_skill_keys(disabled_user_skill_suites);
    let disabled_suite_set: HashSet<String> = disabled_user_skill_suites.iter().cloned().collect();
    let mut enabled_user_skill_suites = normalize_skill_keys(enabled_user_skill_suites);
    enabled_user_skill_suites.retain(|key| !disabled_suite_set.contains(key));

    (
        disabled_user_skills,
        enabled_user_skills,
        disabled_user_skill_suites,
        enabled_user_skill_suites,
    )
}

fn normalize_subagent_override_lists(
    disabled_subagents: Vec<String>,
    enabled_subagents: Vec<String>,
) -> (Vec<String>, Vec<String>) {
    let disabled_subagents = normalize_subagent_ids(disabled_subagents);
    let disabled_set: HashSet<String> = disabled_subagents.iter().cloned().collect();
    let mut enabled_subagents = normalize_subagent_ids(enabled_subagents);
    enabled_subagents.retain(|id| !disabled_set.contains(id));
    (disabled_subagents, enabled_subagents)
}

pub fn resolve_effective_tools(
    default_tools: &[String],
    agent_capability_config: Option<&AgentCapabilityConfig>,
    valid_tools: &HashSet<String>,
) -> Vec<String> {
    let Some(config) = agent_capability_config else {
        return normalize_tools(default_tools.to_vec(), valid_tools);
    };

    let default_tools = normalize_tools(default_tools.to_vec(), valid_tools);
    let removed: HashSet<String> = config.removed_tools.iter().cloned().collect();
    let added = normalize_tools(config.added_tools.clone(), valid_tools);

    let mut effective = Vec::new();
    let mut seen = HashSet::new();

    for tool in default_tools {
        if removed.contains(&tool) {
            continue;
        }
        if seen.insert(tool.clone()) {
            effective.push(tool);
        }
    }

    for tool in added {
        if seen.insert(tool.clone()) {
            effective.push(tool);
        }
    }

    effective
}

pub fn resolve_effective_subagents(
    default_subagents: &[String],
    agent_capability_config: Option<&AgentCapabilityConfig>,
    valid_subagents: &HashSet<String>,
) -> Vec<String> {
    let default_subagents: Vec<String> = normalize_subagent_ids(default_subagents.to_vec())
        .into_iter()
        .filter(|id| valid_subagents.contains(id))
        .collect();
    let Some(config) = agent_capability_config else {
        return default_subagents;
    };

    let removed: HashSet<String> = config.disabled_subagents.iter().cloned().collect();
    let added = normalize_subagent_ids(config.enabled_subagents.clone())
        .into_iter()
        .filter(|id| valid_subagents.contains(id));

    let mut effective = Vec::new();
    let mut seen = HashSet::new();
    for id in default_subagents {
        if removed.contains(&id) {
            continue;
        }
        if seen.insert(id.clone()) {
            effective.push(id);
        }
    }
    for id in added {
        if seen.insert(id.clone()) {
            effective.push(id);
        }
    }
    effective
}

fn stored_agent_config_from_enabled_tools(
    agent_id: &str,
    enabled: bool,
    enabled_tools: Vec<String>,
    disabled_user_skills: Vec<String>,
    enabled_user_skills: Vec<String>,
    disabled_user_skill_suites: Vec<String>,
    enabled_user_skill_suites: Vec<String>,
    disabled_subagents: Vec<String>,
    enabled_subagents: Vec<String>,
    default_tools: &[String],
    valid_tools: &HashSet<String>,
) -> Option<AgentCapabilityConfig> {
    let default_tools = normalize_tools(default_tools.to_vec(), valid_tools);
    let enabled_tools = normalize_tools(enabled_tools, valid_tools);
    let enabled_set: HashSet<String> = enabled_tools.iter().cloned().collect();
    let default_set: HashSet<String> = default_tools.iter().cloned().collect();

    let mut added_tools = Vec::new();
    for tool in &enabled_tools {
        if !default_set.contains(tool) {
            added_tools.push(tool.clone());
        }
    }

    let mut removed_tools = Vec::new();
    for tool in &default_tools {
        if !enabled_set.contains(tool) {
            removed_tools.push(tool.clone());
        }
    }

    stored_agent_config_from_overrides(
        agent_id,
        enabled,
        added_tools,
        removed_tools,
        disabled_user_skills,
        enabled_user_skills,
        disabled_user_skill_suites,
        enabled_user_skill_suites,
        disabled_subagents,
        enabled_subagents,
        &default_tools,
        valid_tools,
    )
}

fn stored_agent_config_from_overrides(
    agent_id: &str,
    enabled: bool,
    added_tools: Vec<String>,
    removed_tools: Vec<String>,
    disabled_user_skills: Vec<String>,
    enabled_user_skills: Vec<String>,
    disabled_user_skill_suites: Vec<String>,
    enabled_user_skill_suites: Vec<String>,
    disabled_subagents: Vec<String>,
    enabled_subagents: Vec<String>,
    default_tools: &[String],
    valid_tools: &HashSet<String>,
) -> Option<AgentCapabilityConfig> {
    let default_set: HashSet<String> = default_tools.iter().cloned().collect();
    let mut added_tools = normalize_tools(added_tools, valid_tools);
    let mut removed_tools = normalize_tools(removed_tools, valid_tools);
    let (
        disabled_user_skills,
        enabled_user_skills,
        disabled_user_skill_suites,
        enabled_user_skill_suites,
    ) = normalize_skill_override_lists(
        disabled_user_skills,
        enabled_user_skills,
        disabled_user_skill_suites,
        enabled_user_skill_suites,
    );
    let (disabled_subagents, enabled_subagents) =
        normalize_subagent_override_lists(disabled_subagents, enabled_subagents);

    added_tools.retain(|tool| !default_set.contains(tool));
    removed_tools.retain(|tool| default_set.contains(tool));

    let removed_set: HashSet<String> = removed_tools.iter().cloned().collect();
    added_tools.retain(|tool| !removed_set.contains(tool));

    if enabled
        && added_tools.is_empty()
        && removed_tools.is_empty()
        && disabled_user_skills.is_empty()
        && enabled_user_skills.is_empty()
        && disabled_user_skill_suites.is_empty()
        && enabled_user_skill_suites.is_empty()
        && disabled_subagents.is_empty()
        && enabled_subagents.is_empty()
    {
        return None;
    }

    Some(AgentCapabilityConfig {
        agent_id: agent_id.to_string(),
        added_tools,
        removed_tools,
        enabled,
        disabled_user_skills,
        enabled_user_skills,
        disabled_user_skill_suites,
        enabled_user_skill_suites,
        disabled_subagents,
        enabled_subagents,
    })
}

fn build_agent_capability_view(
    agent_id: &str,
    default_tools: Vec<String>,
    agent_capability_config: Option<&AgentCapabilityConfig>,
    valid_tools: &HashSet<String>,
) -> AgentCapabilityConfigView {
    let default_tools = normalize_tools(default_tools, valid_tools);
    let enabled_tools =
        resolve_effective_tools(&default_tools, agent_capability_config, valid_tools);
    let enabled = agent_capability_config
        .map(|config| config.enabled)
        .unwrap_or(true);
    let (
        disabled_user_skills,
        enabled_user_skills,
        disabled_user_skill_suites,
        enabled_user_skill_suites,
    ) = agent_capability_config
        .map(|config| {
            normalize_skill_override_lists(
                config.disabled_user_skills.clone(),
                config.enabled_user_skills.clone(),
                config.disabled_user_skill_suites.clone(),
                config.enabled_user_skill_suites.clone(),
            )
        })
        .unwrap_or_else(|| (Vec::new(), Vec::new(), Vec::new(), Vec::new()));
    AgentCapabilityConfigView {
        agent_id: agent_id.to_string(),
        enabled_tools,
        default_tools,
        enabled,
        disabled_user_skills,
        enabled_user_skills,
        disabled_user_skill_suites,
        enabled_user_skill_suites,
        enabled_subagents: Vec::new(),
        default_subagents: Vec::new(),
    }
}

async fn get_valid_tool_names() -> HashSet<String> {
    get_all_registered_tools()
        .await
        .into_iter()
        .map(|tool| tool.name().to_string())
        .collect()
}

async fn get_agent_defaults() -> CoreResult<HashMap<String, Vec<String>>> {
    Ok(get_agent_registry()
        .list_agents_info()
        .await?
        .into_iter()
        .map(|agent| (agent.id, agent.default_tools))
        .collect())
}

pub async fn get_agent_capability_config_views(
) -> CoreResult<HashMap<String, AgentCapabilityConfigView>> {
    let config_service = GlobalConfigManager::get_service().await?;
    let stored_configs: HashMap<String, AgentCapabilityConfig> = config_service
        .get_config(Some("ai.agent_capability_configs"))
        .await?;
    let agent_defaults = get_agent_defaults().await?;
    let valid_tools = get_valid_tool_names().await;

    let mut views = HashMap::new();
    for (agent_id, default_tools) in agent_defaults {
        let view = build_agent_capability_view(
            &agent_id,
            default_tools,
            stored_configs.get(&agent_id),
            &valid_tools,
        );
        views.insert(agent_id, view);
    }

    Ok(views)
}

pub async fn get_agent_capability_config_view(
    agent_id: &str,
) -> CoreResult<AgentCapabilityConfigView> {
    let views = get_agent_capability_config_views().await?;
    views
        .get(agent_id)
        .cloned()
        .ok_or_else(|| CoreError::config(format!("Agent does not exist: {}", agent_id)))
}

pub async fn persist_agent_capability_config_from_value(
    agent_id: &str,
    config: Value,
) -> CoreResult<()> {
    let config_service = GlobalConfigManager::get_service().await?;
    let mut stored_configs: HashMap<String, AgentCapabilityConfig> = config_service
        .get_config(Some("ai.agent_capability_configs"))
        .await?;
    let agent_defaults = get_agent_defaults().await?;
    let default_tools = agent_defaults
        .get(agent_id)
        .ok_or_else(|| CoreError::config(format!("Agent does not exist: {}", agent_id)))?;
    let valid_tools = get_valid_tool_names().await;
    let current = stored_configs.get(agent_id);

    let enabled = config
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| current.map(|item| item.enabled).unwrap_or(true));
    let enabled_tools = if let Some(tools) = config.get("enabled_tools") {
        serde_json::from_value::<Vec<String>>(tools.clone()).map_err(|error| {
            CoreError::config(format!(
                "Invalid enabled_tools for agent {}': {}",
                agent_id, error
            ))
        })?
    } else {
        resolve_effective_tools(default_tools, current, &valid_tools)
    };

    let disabled_user_skills = if config
        .as_object()
        .map(|obj| obj.contains_key("disabled_user_skills"))
        .unwrap_or(false)
    {
        match config.get("disabled_user_skills") {
            Some(Value::Null) | None => Vec::new(),
            Some(value) => {
                serde_json::from_value::<Vec<String>>(value.clone()).map_err(|error| {
                    CoreError::config(format!(
                        "Invalid disabled_user_skills for agent {}': {}",
                        agent_id, error
                    ))
                })?
            }
        }
    } else {
        current
            .map(|item| item.disabled_user_skills.clone())
            .unwrap_or_default()
    };
    let enabled_user_skills = if config
        .as_object()
        .map(|obj| obj.contains_key("enabled_user_skills"))
        .unwrap_or(false)
    {
        match config.get("enabled_user_skills") {
            Some(Value::Null) | None => Vec::new(),
            Some(value) => {
                serde_json::from_value::<Vec<String>>(value.clone()).map_err(|error| {
                    CoreError::config(format!(
                        "Invalid enabled_user_skills for agent {}': {}",
                        agent_id, error
                    ))
                })?
            }
        }
    } else {
        current
            .map(|item| item.enabled_user_skills.clone())
            .unwrap_or_default()
    };
    let disabled_user_skill_suites = if config
        .as_object()
        .map(|obj| obj.contains_key("disabled_user_skill_suites"))
        .unwrap_or(false)
    {
        match config.get("disabled_user_skill_suites") {
            Some(Value::Null) | None => Vec::new(),
            Some(value) => {
                serde_json::from_value::<Vec<String>>(value.clone()).map_err(|error| {
                    CoreError::config(format!(
                        "Invalid disabled_user_skill_suites for agent {}': {}",
                        agent_id, error
                    ))
                })?
            }
        }
    } else {
        current
            .map(|item| item.disabled_user_skill_suites.clone())
            .unwrap_or_default()
    };
    let enabled_user_skill_suites = if config
        .as_object()
        .map(|obj| obj.contains_key("enabled_user_skill_suites"))
        .unwrap_or(false)
    {
        match config.get("enabled_user_skill_suites") {
            Some(Value::Null) | None => Vec::new(),
            Some(value) => {
                serde_json::from_value::<Vec<String>>(value.clone()).map_err(|error| {
                    CoreError::config(format!(
                        "Invalid enabled_user_skill_suites for agent {}': {}",
                        agent_id, error
                    ))
                })?
            }
        }
    } else {
        current
            .map(|item| item.enabled_user_skill_suites.clone())
            .unwrap_or_default()
    };
    let disabled_subagents = if config
        .as_object()
        .map(|obj| obj.contains_key("disabled_subagents"))
        .unwrap_or(false)
    {
        match config.get("disabled_subagents") {
            Some(Value::Null) | None => Vec::new(),
            Some(value) => {
                serde_json::from_value::<Vec<String>>(value.clone()).map_err(|error| {
                    CoreError::config(format!(
                        "Invalid disabled_subagents for agent {}': {}",
                        agent_id, error
                    ))
                })?
            }
        }
    } else {
        current
            .map(|item| item.disabled_subagents.clone())
            .unwrap_or_default()
    };
    let enabled_subagents = if config
        .as_object()
        .map(|obj| obj.contains_key("enabled_subagents"))
        .unwrap_or(false)
    {
        match config.get("enabled_subagents") {
            Some(Value::Null) | None => Vec::new(),
            Some(value) => {
                serde_json::from_value::<Vec<String>>(value.clone()).map_err(|error| {
                    CoreError::config(format!(
                        "Invalid enabled_subagents for agent {}': {}",
                        agent_id, error
                    ))
                })?
            }
        }
    } else {
        current
            .map(|item| item.enabled_subagents.clone())
            .unwrap_or_default()
    };

    if let Some(canonical) = stored_agent_config_from_enabled_tools(
        agent_id,
        enabled,
        enabled_tools,
        disabled_user_skills,
        enabled_user_skills,
        disabled_user_skill_suites,
        enabled_user_skill_suites,
        disabled_subagents,
        enabled_subagents,
        default_tools,
        &valid_tools,
    ) {
        stored_configs.insert(agent_id.to_string(), canonical);
    } else {
        stored_configs.remove(agent_id);
    }

    commit_agent_capability_configs(
        &config_service,
        serde_json::to_value(stored_configs)?,
        ConfigChangeSourceKind::Manual,
        "agent-capability-config",
    )
    .await
}

pub async fn reset_agent_capability_config_to_default(agent_id: &str) -> CoreResult<()> {
    let config_service = GlobalConfigManager::get_service().await?;
    let mut stored_configs: HashMap<String, AgentCapabilityConfig> = config_service
        .get_config(Some("ai.agent_capability_configs"))
        .await?;
    stored_configs.remove(agent_id);
    commit_agent_capability_configs(
        &config_service,
        serde_json::to_value(stored_configs)?,
        ConfigChangeSourceKind::Manual,
        "agent-capability-config",
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{normalize_skill_override_lists, stored_agent_config_from_overrides};
    use std::collections::HashSet;

    #[test]
    fn normalize_skill_override_lists_removes_duplicates_and_conflicts() {
        let (disabled, enabled, disabled_suites, enabled_suites) = normalize_skill_override_lists(
            vec![
                "user::sparo::pdf".to_string(),
                "user::sparo::pdf".to_string(),
            ],
            vec![
                "user::sparo::pdf".to_string(),
                "user::sparo::docx".to_string(),
                "user::sparo::docx".to_string(),
            ],
            vec![
                "office-documents".to_string(),
                "office-documents".to_string(),
            ],
            vec![
                "office-documents".to_string(),
                "product-app-development".to_string(),
            ],
        );

        assert_eq!(disabled, vec!["user::sparo::pdf".to_string()]);
        assert_eq!(enabled, vec!["user::sparo::docx".to_string()]);
        assert_eq!(disabled_suites, vec!["office-documents".to_string()]);
        assert_eq!(enabled_suites, vec!["product-app-development".to_string()]);
    }

    #[test]
    fn stored_agent_config_from_overrides_keeps_enabled_user_skills() {
        let valid_tools = HashSet::new();
        let stored = stored_agent_config_from_overrides(
            "Runno",
            true,
            Vec::new(),
            Vec::new(),
            Vec::new(),
            vec!["user::sparo::pdf".to_string()],
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            &[],
            &valid_tools,
        )
        .expect("agent capability config should be retained when skill overrides exist");

        assert_eq!(
            stored.enabled_user_skills,
            vec!["user::sparo::pdf".to_string()]
        );
        assert!(stored.disabled_user_skills.is_empty());
    }
}
