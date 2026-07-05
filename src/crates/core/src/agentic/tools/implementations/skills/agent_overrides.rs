//! Agent-specific skill override helpers.

use crate::agentic::workspace::WorkspaceFileSystem;
use crate::infrastructure::get_path_manager_arc;
use crate::service::config::agent_capability_config_canonicalizer::persist_agent_capability_config_from_value;
use crate::service::config::global::GlobalConfigManager;
use crate::service::config::types::AgentCapabilityConfig;
use crate::error::{CoreError, CoreResult};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;

const PROJECT_AGENT_SKILLS_FILE_NAME: &str = "agent_skills.json";
const DISABLED_SKILLS_KEY: &str = "disabled_skills";
const DISABLED_SUITES_KEY: &str = "disabled_suites";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UserAgentSkillOverrides {
    pub disabled_skills: Vec<String>,
    pub enabled_skills: Vec<String>,
    pub disabled_suites: Vec<String>,
    pub enabled_suites: Vec<String>,
}

fn dedupe_skill_keys(keys: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();

    for key in keys {
        let trimmed = key.trim();
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

fn normalize_user_overrides(
    disabled_skills: Vec<String>,
    enabled_skills: Vec<String>,
    disabled_suites: Vec<String>,
    enabled_suites: Vec<String>,
) -> UserAgentSkillOverrides {
    let disabled_skills = dedupe_skill_keys(disabled_skills);
    let disabled_set: HashSet<String> = disabled_skills.iter().cloned().collect();
    let mut enabled_skills = dedupe_skill_keys(enabled_skills);
    enabled_skills.retain(|key| !disabled_set.contains(key));

    let disabled_suites = dedupe_skill_keys(disabled_suites);
    let disabled_suite_set: HashSet<String> = disabled_suites.iter().cloned().collect();
    let mut enabled_suites = dedupe_skill_keys(enabled_suites);
    enabled_suites.retain(|key| !disabled_suite_set.contains(key));

    UserAgentSkillOverrides {
        disabled_skills,
        enabled_skills,
        disabled_suites,
        enabled_suites,
    }
}

pub async fn load_user_agent_skill_overrides(
    agent_id: &str,
) -> CoreResult<UserAgentSkillOverrides> {
    let config_service = GlobalConfigManager::get_service().await?;
    let stored_configs: HashMap<String, AgentCapabilityConfig> = config_service
        .get_config(Some("ai.agent_capability_configs"))
        .await
        .unwrap_or_default();

    let config = stored_configs.get(agent_id);
    Ok(normalize_user_overrides(
        config
            .map(|item| item.disabled_user_skills.clone())
            .unwrap_or_default(),
        config
            .map(|item| item.enabled_user_skills.clone())
            .unwrap_or_default(),
        config
            .map(|item| item.disabled_user_skill_suites.clone())
            .unwrap_or_default(),
        config
            .map(|item| item.enabled_user_skill_suites.clone())
            .unwrap_or_default(),
    ))
}

pub async fn set_user_agent_skill_state(
    agent_id: &str,
    skill_key: &str,
    enabled: bool,
    default_enabled: bool,
) -> CoreResult<UserAgentSkillOverrides> {
    let mut overrides = load_user_agent_skill_overrides(agent_id).await?;
    overrides.disabled_skills.retain(|value| value != skill_key);
    overrides.enabled_skills.retain(|value| value != skill_key);

    if default_enabled {
        if !enabled {
            overrides.disabled_skills.push(skill_key.to_string());
        }
    } else {
        if enabled {
            overrides.enabled_skills.push(skill_key.to_string());
        }
    }

    let overrides = normalize_user_overrides(
        overrides.disabled_skills,
        overrides.enabled_skills,
        overrides.disabled_suites,
        overrides.enabled_suites,
    );

    persist_agent_capability_config_from_value(
        agent_id,
        json!({
            "disabled_user_skills": overrides.disabled_skills,
            "enabled_user_skills": overrides.enabled_skills,
            "disabled_user_skill_suites": overrides.disabled_suites,
            "enabled_user_skill_suites": overrides.enabled_suites,
        }),
    )
    .await?;

    load_user_agent_skill_overrides(agent_id).await
}

pub async fn set_user_agent_skill_suite_state(
    agent_id: &str,
    suite_key: &str,
    enabled: bool,
    default_enabled: bool,
) -> CoreResult<UserAgentSkillOverrides> {
    let mut overrides = load_user_agent_skill_overrides(agent_id).await?;
    overrides.disabled_suites.retain(|value| value != suite_key);
    overrides.enabled_suites.retain(|value| value != suite_key);

    if default_enabled {
        if !enabled {
            overrides.disabled_suites.push(suite_key.to_string());
        }
    } else if enabled {
        overrides.enabled_suites.push(suite_key.to_string());
    }

    let overrides = normalize_user_overrides(
        overrides.disabled_skills,
        overrides.enabled_skills,
        overrides.disabled_suites,
        overrides.enabled_suites,
    );

    persist_agent_capability_config_from_value(
        agent_id,
        json!({
            "disabled_user_skills": overrides.disabled_skills,
            "enabled_user_skills": overrides.enabled_skills,
            "disabled_user_skill_suites": overrides.disabled_suites,
            "enabled_user_skill_suites": overrides.enabled_suites,
        }),
    )
    .await?;

    load_user_agent_skill_overrides(agent_id).await
}

pub fn project_agent_skills_path_for_remote(remote_root: &str) -> String {
    use crate::infrastructure::APP_HIDDEN_DIR_NAME;

    format!(
        "{}/{}/config/{}",
        remote_root.trim_end_matches('/'),
        APP_HIDDEN_DIR_NAME,
        PROJECT_AGENT_SKILLS_FILE_NAME
    )
}

fn normalize_project_document_value(value: Value) -> Value {
    match value {
        Value::Object(_) => value,
        _ => Value::Object(Map::new()),
    }
}

fn agent_skills_object_mut(document: &mut Value) -> CoreResult<&mut Map<String, Value>> {
    if !document.is_object() {
        *document = Value::Object(Map::new());
    }

    document.as_object_mut().ok_or_else(|| {
        CoreError::config("Project agent skills must be a JSON object".to_string())
    })
}

fn agent_skills_object(document: &Value) -> Option<&Map<String, Value>> {
    document.as_object()
}

pub fn get_disabled_agent_skills_from_document(document: &Value, agent_id: &str) -> Vec<String> {
    let Some(agent_object) = agent_skills_object(document)
        .and_then(|map| map.get(agent_id))
        .and_then(Value::as_object)
    else {
        return Vec::new();
    };

    let keys = agent_object
        .get(DISABLED_SKILLS_KEY)
        .cloned()
        .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok())
        .unwrap_or_default();

    dedupe_skill_keys(keys)
}

pub fn get_disabled_agent_skill_suites_from_document(
    document: &Value,
    agent_id: &str,
) -> Vec<String> {
    let Some(agent_object) = agent_skills_object(document)
        .and_then(|map| map.get(agent_id))
        .and_then(Value::as_object)
    else {
        return Vec::new();
    };

    let keys = agent_object
        .get(DISABLED_SUITES_KEY)
        .cloned()
        .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok())
        .unwrap_or_default();

    dedupe_skill_keys(keys)
}

pub fn set_agent_skill_disabled_in_document(
    document: &mut Value,
    agent_id: &str,
    skill_key: &str,
    disabled: bool,
) -> CoreResult<Vec<String>> {
    let agent_skills = agent_skills_object_mut(document)?;
    let agent_entry = agent_skills
        .entry(agent_id.to_string())
        .or_insert_with(|| Value::Object(Map::new()));

    if !agent_entry.is_object() {
        *agent_entry = Value::Object(Map::new());
    }

    let agent_object = agent_entry.as_object_mut().ok_or_else(|| {
        CoreError::config("Agent skills entry must be a JSON object".to_string())
    })?;

    let current = agent_object
        .get(DISABLED_SKILLS_KEY)
        .cloned()
        .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok())
        .unwrap_or_default();

    let mut next = dedupe_skill_keys(current);
    if disabled {
        next.push(skill_key.to_string());
        next = dedupe_skill_keys(next);
    } else {
        next.retain(|value| value != skill_key);
    }

    if next.is_empty() {
        agent_object.remove(DISABLED_SKILLS_KEY);
    } else {
        agent_object.insert(
            DISABLED_SKILLS_KEY.to_string(),
            serde_json::to_value(&next)?,
        );
    }

    if agent_object.is_empty() {
        agent_skills.remove(agent_id);
    }

    Ok(next)
}

pub fn set_agent_skill_suite_disabled_in_document(
    document: &mut Value,
    agent_id: &str,
    suite_key: &str,
    disabled: bool,
) -> CoreResult<Vec<String>> {
    let agent_skills = agent_skills_object_mut(document)?;
    let agent_entry = agent_skills
        .entry(agent_id.to_string())
        .or_insert_with(|| Value::Object(Map::new()));

    if !agent_entry.is_object() {
        *agent_entry = Value::Object(Map::new());
    }

    let agent_object = agent_entry.as_object_mut().ok_or_else(|| {
        CoreError::config("Agent skills entry must be a JSON object".to_string())
    })?;

    let current = agent_object
        .get(DISABLED_SUITES_KEY)
        .cloned()
        .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok())
        .unwrap_or_default();

    let mut next = dedupe_skill_keys(current);
    if disabled {
        next.push(suite_key.to_string());
        next = dedupe_skill_keys(next);
    } else {
        next.retain(|value| value != suite_key);
    }

    if next.is_empty() {
        agent_object.remove(DISABLED_SUITES_KEY);
    } else {
        agent_object.insert(
            DISABLED_SUITES_KEY.to_string(),
            serde_json::to_value(&next)?,
        );
    }

    if agent_object.is_empty() {
        agent_skills.remove(agent_id);
    }

    Ok(next)
}

pub fn set_disabled_agent_skills_in_document(
    document: &mut Value,
    agent_id: &str,
    skill_keys: Vec<String>,
) -> CoreResult<Vec<String>> {
    let agent_skills = agent_skills_object_mut(document)?;
    let next = dedupe_skill_keys(skill_keys);

    if next.is_empty() {
        if let Some(agent_entry) = agent_skills.get_mut(agent_id) {
            if !agent_entry.is_object() {
                *agent_entry = Value::Object(Map::new());
            }

            if let Some(agent_object) = agent_entry.as_object_mut() {
                agent_object.remove(DISABLED_SKILLS_KEY);
                if agent_object.is_empty() {
                    agent_skills.remove(agent_id);
                }
            }
        }

        return Ok(Vec::new());
    }

    let agent_entry = agent_skills
        .entry(agent_id.to_string())
        .or_insert_with(|| Value::Object(Map::new()));

    if !agent_entry.is_object() {
        *agent_entry = Value::Object(Map::new());
    }

    let agent_object = agent_entry.as_object_mut().ok_or_else(|| {
        CoreError::config("Agent skills entry must be a JSON object".to_string())
    })?;

    agent_object.insert(
        DISABLED_SKILLS_KEY.to_string(),
        serde_json::to_value(&next)?,
    );

    Ok(next)
}

pub fn set_disabled_agent_skill_suites_in_document(
    document: &mut Value,
    agent_id: &str,
    suite_keys: Vec<String>,
) -> CoreResult<Vec<String>> {
    let agent_skills = agent_skills_object_mut(document)?;
    let next = dedupe_skill_keys(suite_keys);

    if next.is_empty() {
        if let Some(agent_entry) = agent_skills.get_mut(agent_id) {
            if !agent_entry.is_object() {
                *agent_entry = Value::Object(Map::new());
            }

            if let Some(agent_object) = agent_entry.as_object_mut() {
                agent_object.remove(DISABLED_SUITES_KEY);
                if agent_object.is_empty() {
                    agent_skills.remove(agent_id);
                }
            }
        }

        return Ok(Vec::new());
    }

    let agent_entry = agent_skills
        .entry(agent_id.to_string())
        .or_insert_with(|| Value::Object(Map::new()));

    if !agent_entry.is_object() {
        *agent_entry = Value::Object(Map::new());
    }

    let agent_object = agent_entry.as_object_mut().ok_or_else(|| {
        CoreError::config("Agent skills entry must be a JSON object".to_string())
    })?;

    agent_object.insert(
        DISABLED_SUITES_KEY.to_string(),
        serde_json::to_value(&next)?,
    );

    Ok(next)
}

pub async fn load_project_agent_skills_document_local(
    workspace_root: &Path,
) -> CoreResult<Value> {
    let path = get_path_manager_arc().project_agent_skills_file(workspace_root);
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => Ok(normalize_project_document_value(serde_json::from_str(
            &content,
        )?)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Value::Object(Map::new())),
        Err(error) => Err(CoreError::config(format!(
            "Failed to read project skill overrides file '{}': {}",
            path.display(),
            error
        ))),
    }
}

pub async fn save_project_agent_skills_document_local(
    workspace_root: &Path,
    document: &Value,
) -> CoreResult<()> {
    let path = get_path_manager_arc().project_agent_skills_file(workspace_root);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(&path, serde_json::to_vec_pretty(document)?).await?;
    Ok(())
}

pub async fn load_disabled_agent_skills_local(
    workspace_root: &Path,
    agent_id: &str,
) -> CoreResult<Vec<String>> {
    let document = load_project_agent_skills_document_local(workspace_root).await?;
    Ok(get_disabled_agent_skills_from_document(&document, agent_id))
}

pub async fn load_disabled_agent_skill_suites_local(
    workspace_root: &Path,
    agent_id: &str,
) -> CoreResult<Vec<String>> {
    let document = load_project_agent_skills_document_local(workspace_root).await?;
    Ok(get_disabled_agent_skill_suites_from_document(
        &document, agent_id,
    ))
}

pub async fn load_disabled_agent_skills_remote(
    fs: &dyn WorkspaceFileSystem,
    remote_root: &str,
    agent_id: &str,
) -> CoreResult<Vec<String>> {
    let path = project_agent_skills_path_for_remote(remote_root);
    let exists = fs.exists(&path).await.unwrap_or(false);
    if !exists {
        return Ok(Vec::new());
    }

    let content = fs.read_file_text(&path).await.map_err(|error| {
        CoreError::config(format!(
            "Failed to read remote project skill overrides: {}",
            error
        ))
    })?;
    let document = normalize_project_document_value(serde_json::from_str(&content)?);
    Ok(get_disabled_agent_skills_from_document(&document, agent_id))
}

pub async fn load_disabled_agent_skill_suites_remote(
    fs: &dyn WorkspaceFileSystem,
    remote_root: &str,
    agent_id: &str,
) -> CoreResult<Vec<String>> {
    let path = project_agent_skills_path_for_remote(remote_root);
    let exists = fs.exists(&path).await.unwrap_or(false);
    if !exists {
        return Ok(Vec::new());
    }

    let content = fs.read_file_text(&path).await.map_err(|error| {
        CoreError::config(format!(
            "Failed to read remote project skill overrides: {}",
            error
        ))
    })?;
    let document = normalize_project_document_value(serde_json::from_str(&content)?);
    Ok(get_disabled_agent_skill_suites_from_document(
        &document, agent_id,
    ))
}
