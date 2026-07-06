//! Session persistence API

use crate::api::app_state::AppState;
use crate::api::session_storage_path::{
    desktop_effective_session_storage_path, SessionStorageScopeDto,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sparo_core::agentic::persistence::{
    PersistenceManager, SessionBranchRequest, SessionBranchResult,
};
use sparo_core::agentic::tools::{get_all_registered_tools, ToolRuntimeRestrictions};
use sparo_core::agentic::{PromptBuilder, PromptBuilderContext, WorkspaceBinding};
use sparo_core::infrastructure::PathManager;
use sparo_core::service::config::types::{AIConfig, ModelCapability, ModelCategory};
use sparo_core::service::context_stats::{ContextBudgetSnapshot, ContextStatsEstimator};
use sparo_core::service::session::{
    DialogTurnData, SessionMetadata, SessionTranscriptExport, SessionTranscriptExportOptions,
};
use sparo_core::util::types::ToolDefinition;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListPersistedSessionsRequest {
    pub workspace_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_scope: Option<SessionStorageScopeDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadSessionTurnsRequest {
    pub session_id: String,
    pub workspace_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_scope: Option<SessionStorageScopeDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveSessionTurnRequest {
    pub turn_data: DialogTurnData,
    pub workspace_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_scope: Option<SessionStorageScopeDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveSessionMetadataRequest {
    pub metadata: SessionMetadata,
    pub workspace_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_scope: Option<SessionStorageScopeDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSessionTranscriptRequest {
    pub session_id: String,
    pub workspace_path: Option<String>,
    #[serde(default = "default_tools")]
    pub tools: bool,
    #[serde(default)]
    pub tool_inputs: bool,
    #[serde(default)]
    pub thinking: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turns: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_scope: Option<SessionStorageScopeDto>,
}

fn default_tools() -> bool {
    false
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeletePersistedSessionRequest {
    pub session_id: String,
    pub workspace_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_scope: Option<SessionStorageScopeDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TouchSessionActivityRequest {
    pub session_id: String,
    pub workspace_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_scope: Option<SessionStorageScopeDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadPersistedSessionMetadataRequest {
    pub session_id: String,
    pub workspace_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_scope: Option<SessionStorageScopeDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetContextBudgetRequest {
    pub session_id: String,
    pub agent_type: String,
    pub workspace_path: Option<String>,
    pub model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_scope: Option<SessionStorageScopeDto>,
}

fn legacy_os_agent_workspace_roots(path_manager: &PathManager) -> Vec<PathBuf> {
    let _ = path_manager;
    Vec::new()
}

fn resolve_configured_model_id(ai_config: &AIConfig, selector: &str) -> String {
    if selector.is_empty() || selector == "primary" || selector == "default" {
        return ai_config
            .default_models
            .primary
            .clone()
            .or_else(|| {
                ai_config
                    .models
                    .iter()
                    .find(|m| m.enabled)
                    .map(|m| m.id.clone())
            })
            .unwrap_or_else(|| "primary".to_string());
    }
    if selector == "fast" {
        return ai_config
            .default_models
            .fast
            .clone()
            .or_else(|| ai_config.default_models.primary.clone())
            .unwrap_or_else(|| selector.to_string());
    }
    selector.to_string()
}

fn resolve_model_config_for_budget<'a>(
    ai_config: &'a AIConfig,
    selector: &str,
) -> Option<&'a sparo_core::service::config::types::AIModelConfig> {
    let resolved_model_id = resolve_configured_model_id(ai_config, selector);
    ai_config
        .models
        .iter()
        .find(|m| {
            m.id == resolved_model_id
                || m.name == resolved_model_id
                || m.model_name == resolved_model_id
        })
        .or_else(|| ai_config.models.iter().find(|m| m.enabled))
        .or_else(|| ai_config.models.first())
}

fn normalize_context_budget_agent_type(agent_type: &str) -> String {
    match agent_type.trim().to_ascii_lowercase().as_str() {
        "" => "Runno".to_string(),
        "runno" => "Runno".to_string(),
        "bitfun-coder" | "bitfun_coder" => "bitfun-coder".to_string(),
        "bitfun-plan" | "bitfun_plan" => "bitfun-plan".to_string(),
        "cowork" => "Cowork".to_string(),
        "design" => "Design".to_string(),
        "bitfun-debug" | "bitfun_debug" => "bitfun-debug".to_string(),
        "bitfun-team" | "bitfun_team" => "bitfun-team".to_string(),
        "osagent" | "os-agent" | "os_agent" => "OSAgent".to_string(),
        "deepresearch" | "deep-research" | "deep_research" => "DeepResearch".to_string(),
        "appbuilder" | "app-builder" | "app_builder" => "AppBuilder".to_string(),
        _ => agent_type.trim().to_string(),
    }
}

async fn build_tool_definitions_for_budget(
    mode_allowed_tools: &[String],
    workspace: Option<&WorkspaceBinding>,
    agent_type: &str,
    primary_supports_image_understanding: bool,
) -> Vec<ToolDefinition> {
    let all_tools = get_all_registered_tools().await;
    let mut tool_opts_custom = HashMap::new();
    tool_opts_custom.insert(
        "primary_model_supports_image_understanding".to_string(),
        Value::Bool(primary_supports_image_understanding),
    );
    let description_context = sparo_core::agentic::tools::framework::ToolUseContext {
        tool_call_id: None,
        agent_type: Some(agent_type.to_string()),
        session_id: None,
        dialog_turn_id: None,
        workspace: workspace.cloned(),
        custom_data: tool_opts_custom,
        app_builder: None,
        computer_use_host: None,
        cancellation_token: None,
        runtime_tool_restrictions: ToolRuntimeRestrictions::default(),
        workspace_services: None,
        workspace_mount: None,
        agentic: None,
    };

    let mut tool_definitions = Vec::new();
    for tool in &all_tools {
        if !tool.is_enabled().await {
            continue;
        }
        if !mode_allowed_tools.contains(&tool.name().to_string()) {
            continue;
        }

        let description = tool
            .description_with_context(Some(&description_context))
            .await
            .unwrap_or_else(|_| format!("Tool: {}", tool.name()));
        let parameters = tool
            .input_schema_for_model_with_context(Some(&description_context))
            .await;
        tool_definitions.push(ToolDefinition {
            name: tool.name().to_string(),
            description,
            parameters,
        });
    }

    let tool_ordering: HashMap<String, usize> = [
        ("Goal", 1),
        ("Task", 2),
        ("Bash", 3),
        ("TerminalControl", 4),
        ("Glob", 5),
        ("Grep", 6),
        ("Read", 7),
        ("Edit", 8),
        ("Write", 9),
        ("Delete", 10),
        ("WebFetch", 11),
        ("WebSearch", 12),
        ("TodoWrite", 13),
        ("Skill", 14),
        ("Log", 15),
        ("ComputerUse", 16),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect();
    tool_definitions.sort_by_key(|tool| tool_ordering.get(&tool.name).unwrap_or(&100));
    tool_definitions
}

async fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    let mut pending = vec![(source.to_path_buf(), target.to_path_buf())];
    while let Some((current_source, current_target)) = pending.pop() {
        fs::create_dir_all(&current_target).await.map_err(|e| {
            format!(
                "Failed to create target directory {}: {}",
                current_target.display(),
                e
            )
        })?;
        let mut entries = fs::read_dir(&current_source).await.map_err(|e| {
            format!(
                "Failed to read directory {}: {}",
                current_source.display(),
                e
            )
        })?;
        while let Some(entry) = entries.next_entry().await.map_err(|e| {
            format!(
                "Failed to read directory entry in {}: {}",
                current_source.display(),
                e
            )
        })? {
            let source_path = entry.path();
            let target_path = current_target.join(entry.file_name());
            let file_type = entry
                .file_type()
                .await
                .map_err(|e| format!("Failed to stat {}: {}", source_path.display(), e))?;
            if file_type.is_dir() {
                pending.push((source_path, target_path));
            } else {
                if let Some(parent) = target_path.parent() {
                    fs::create_dir_all(parent).await.map_err(|e| {
                        format!(
                            "Failed to create parent directory {}: {}",
                            parent.display(),
                            e
                        )
                    })?;
                }
                fs::copy(&source_path, &target_path).await.map_err(|e| {
                    format!(
                        "Failed to copy {} to {}: {}",
                        source_path.display(),
                        target_path.display(),
                        e
                    )
                })?;
            }
        }
    }
    Ok(())
}

async fn migrate_legacy_os_agent_sessions_if_needed(
    manager: &PersistenceManager,
    path_manager: &PathManager,
    agentic_os_root: &Path,
) -> Result<(), String> {
    let existing = manager
        .list_session_metadata(agentic_os_root)
        .await
        .map_err(|e| format!("Failed to inspect Agentic OS sessions: {}", e))?;
    if !existing.is_empty() {
        return Ok(());
    }

    let target_sessions_dir = path_manager.agentic_os_runtime_root().join("sessions");
    fs::create_dir_all(&target_sessions_dir)
        .await
        .map_err(|e| format!("Failed to create Agentic OS sessions dir: {}", e))?;

    for legacy_root in legacy_os_agent_workspace_roots(path_manager) {
        let legacy_metadata = match manager.list_session_metadata(&legacy_root).await {
            Ok(value) => value,
            Err(_) => continue,
        };
        // Keep the old persisted agent_type literal so existing sessions migrate into Agentic OS.
        for metadata in legacy_metadata
            .into_iter()
            .filter(|item| item.agent_type.eq_ignore_ascii_case("dispatcher"))
        {
            let source_dir = path_manager
                .workspace_sessions_dir(&legacy_root)
                .join(&metadata.session_id);
            let target_dir = target_sessions_dir.join(&metadata.session_id);
            if target_dir.exists() || !source_dir.exists() {
                continue;
            }
            copy_dir_recursive(&source_dir, &target_dir).await?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForkSessionRequest {
    pub source_session_id: String,
    pub source_turn_id: String,
    pub workspace_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_scope: Option<SessionStorageScopeDto>,
}

pub type ForkSessionResponse = SessionBranchResult;

#[tauri::command]
pub async fn list_persisted_sessions(
    request: ListPersistedSessionsRequest,
    app_state: State<'_, AppState>,
    path_manager: State<'_, Arc<PathManager>>,
) -> Result<Vec<SessionMetadata>, String> {
    let workspace_path = desktop_effective_session_storage_path(
        &app_state,
        request.workspace_path.as_deref(),
        request.storage_scope,
    )
    .await;
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;
    if matches!(
        request.storage_scope,
        Some(SessionStorageScopeDto::AgenticOs)
    ) {
        migrate_legacy_os_agent_sessions_if_needed(
            &manager,
            path_manager.inner().as_ref(),
            &workspace_path,
        )
        .await?;
    }

    manager
        .list_session_metadata(&workspace_path)
        .await
        .map_err(|e| format!("Failed to list persisted sessions: {}", e))
}

#[tauri::command]
pub async fn load_session_turns(
    request: LoadSessionTurnsRequest,
    app_state: State<'_, AppState>,
    path_manager: State<'_, Arc<PathManager>>,
) -> Result<Vec<DialogTurnData>, String> {
    let workspace_path = desktop_effective_session_storage_path(
        &app_state,
        request.workspace_path.as_deref(),
        request.storage_scope,
    )
    .await;
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;
    if matches!(
        request.storage_scope,
        Some(SessionStorageScopeDto::AgenticOs)
    ) {
        migrate_legacy_os_agent_sessions_if_needed(
            &manager,
            path_manager.inner().as_ref(),
            &workspace_path,
        )
        .await?;
    }

    let turns = if let Some(limit) = request.limit {
        manager
            .load_recent_turns(&workspace_path, &request.session_id, limit)
            .await
    } else {
        manager
            .load_session_turns(&workspace_path, &request.session_id)
            .await
    };

    turns.map_err(|e| format!("Failed to load session turns: {}", e))
}

#[tauri::command]
pub async fn get_context_budget(
    request: GetContextBudgetRequest,
    app_state: State<'_, AppState>,
) -> Result<ContextBudgetSnapshot, String> {
    let agent_type = normalize_context_budget_agent_type(&request.agent_type);
    let ai_config: AIConfig = app_state
        .config_service
        .get_config(Some("ai"))
        .await
        .unwrap_or_default();
    let selector = request.model_id.as_deref().unwrap_or("primary");
    let model_config = resolve_model_config_for_budget(&ai_config, selector);
    let model_name = model_config
        .map(|model| model.model_name.clone())
        .unwrap_or_else(|| "primary".to_string());
    let provider = model_config
        .map(|model| model.provider.clone())
        .unwrap_or_else(|| "unknown".to_string());
    let context_window = model_config
        .and_then(|model| model.context_window)
        .unwrap_or(128128) as usize;

    let workspace_path = request
        .workspace_path
        .as_ref()
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            if matches!(
                request.storage_scope,
                Some(SessionStorageScopeDto::AgenticOs)
            ) {
                Some(
                    app_state
                        .workspace_service
                        .path_manager()
                        .agentic_os_runtime_root(),
                )
            } else {
                None
            }
        });
    let workspace = workspace_path.map(|path| WorkspaceBinding::new(None, path));

    let current_agent = app_state
        .agent_registry
        .get_agent(
            &agent_type,
            workspace.as_ref().map(|binding| binding.root_path()),
        )
        .ok_or_else(|| format!("Agent not found: {}", agent_type))?;

    let primary_supports_image_understanding = model_config.is_some_and(|m| {
        m.capabilities
            .iter()
            .any(|cap| matches!(cap, ModelCapability::ImageUnderstanding))
            || matches!(m.category, ModelCategory::Multimodal)
    });

    let prompt_context = workspace.as_ref().map(|binding| {
        PromptBuilderContext::new(binding.root_path_string(), Some(model_name.clone()))
            .with_session_id(request.session_id.clone())
            .with_memory_scope(current_agent.memory_scope())
            .with_supports_image_understanding(primary_supports_image_understanding)
    });

    let request_context_reminder = if let Some(prompt_context) = prompt_context.as_ref() {
        PromptBuilder::new(prompt_context.clone())
            .build_request_context_reminder(&current_agent.request_context_policy())
            .await
    } else {
        None
    };
    let system_prompt = current_agent
        .get_system_prompt(prompt_context.as_ref())
        .await
        .map_err(|e| format!("Failed to build system prompt: {}", e))?;

    let agent_allowed_tools = app_state
        .agent_registry
        .get_agent_tools(
            &agent_type,
            workspace.as_ref().map(|binding| binding.root_path()),
        )
        .await;
    let tool_definitions = build_tool_definitions_for_budget(
        &agent_allowed_tools,
        workspace.as_ref(),
        &agent_type,
        primary_supports_image_understanding,
    )
    .await;

    Ok(ContextStatsEstimator::static_snapshot(
        request.session_id,
        agent_type,
        model_name,
        provider,
        context_window,
        &system_prompt,
        request_context_reminder.as_deref(),
        Some(&tool_definitions),
    ))
}

#[tauri::command]
pub async fn save_session_turn(
    request: SaveSessionTurnRequest,
    app_state: State<'_, AppState>,
    path_manager: State<'_, Arc<PathManager>>,
) -> Result<(), String> {
    let workspace_path = desktop_effective_session_storage_path(
        &app_state,
        request.workspace_path.as_deref(),
        request.storage_scope,
    )
    .await;
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;
    if matches!(
        request.storage_scope,
        Some(SessionStorageScopeDto::AgenticOs)
    ) {
        migrate_legacy_os_agent_sessions_if_needed(
            &manager,
            path_manager.inner().as_ref(),
            &workspace_path,
        )
        .await?;
    }

    manager
        .save_dialog_turn(&workspace_path, &request.turn_data)
        .await
        .map_err(|e| format!("Failed to save session turn: {}", e))
}

#[tauri::command]
pub async fn save_session_metadata(
    request: SaveSessionMetadataRequest,
    app_state: State<'_, AppState>,
    path_manager: State<'_, Arc<PathManager>>,
) -> Result<(), String> {
    let workspace_path = desktop_effective_session_storage_path(
        &app_state,
        request.workspace_path.as_deref(),
        request.storage_scope,
    )
    .await;
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;

    manager
        .save_session_metadata(&workspace_path, &request.metadata)
        .await
        .map_err(|e| format!("Failed to save session metadata: {}", e))
}

#[tauri::command]
pub async fn export_session_transcript(
    request: ExportSessionTranscriptRequest,
    app_state: State<'_, AppState>,
    path_manager: State<'_, Arc<PathManager>>,
) -> Result<SessionTranscriptExport, String> {
    let workspace_path = desktop_effective_session_storage_path(
        &app_state,
        request.workspace_path.as_deref(),
        request.storage_scope,
    )
    .await;
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;

    manager
        .export_session_transcript(
            &workspace_path,
            &request.session_id,
            &SessionTranscriptExportOptions {
                tools: request.tools,
                tool_inputs: request.tool_inputs,
                thinking: request.thinking,
                turns: request.turns,
            },
        )
        .await
        .map_err(|e| format!("Failed to export session transcript: {}", e))
}

#[tauri::command]
pub async fn delete_persisted_session(
    request: DeletePersistedSessionRequest,
    app_state: State<'_, AppState>,
    path_manager: State<'_, Arc<PathManager>>,
) -> Result<(), String> {
    let workspace_path = desktop_effective_session_storage_path(
        &app_state,
        request.workspace_path.as_deref(),
        request.storage_scope,
    )
    .await;
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;

    manager
        .delete_session(&workspace_path, &request.session_id)
        .await
        .map_err(|e| format!("Failed to delete persisted session: {}", e))
}

#[tauri::command]
pub async fn touch_session_activity(
    request: TouchSessionActivityRequest,
    app_state: State<'_, AppState>,
    path_manager: State<'_, Arc<PathManager>>,
) -> Result<(), String> {
    let workspace_path = desktop_effective_session_storage_path(
        &app_state,
        request.workspace_path.as_deref(),
        request.storage_scope,
    )
    .await;
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;

    manager
        .touch_session(&workspace_path, &request.session_id)
        .await
        .map_err(|e| format!("Failed to update session activity: {}", e))
}

#[tauri::command]
pub async fn load_persisted_session_metadata(
    request: LoadPersistedSessionMetadataRequest,
    app_state: State<'_, AppState>,
    path_manager: State<'_, Arc<PathManager>>,
) -> Result<Option<SessionMetadata>, String> {
    let workspace_path = desktop_effective_session_storage_path(
        &app_state,
        request.workspace_path.as_deref(),
        request.storage_scope,
    )
    .await;
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;

    let metadata = manager
        .load_session_metadata(&workspace_path, &request.session_id)
        .await
        .map_err(|e| format!("Failed to load persisted session metadata: {}", e))?;

    Ok(metadata.filter(|metadata| !metadata.should_hide_from_user_lists()))
}

#[tauri::command]
pub async fn fork_session(
    request: ForkSessionRequest,
    app_state: State<'_, AppState>,
    path_manager: State<'_, Arc<PathManager>>,
) -> Result<ForkSessionResponse, String> {
    let workspace_path = desktop_effective_session_storage_path(
        &app_state,
        request.workspace_path.as_deref(),
        request.storage_scope,
    )
    .await;
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;
    if matches!(
        request.storage_scope,
        Some(SessionStorageScopeDto::AgenticOs)
    ) {
        migrate_legacy_os_agent_sessions_if_needed(
            &manager,
            path_manager.inner().as_ref(),
            &workspace_path,
        )
        .await?;
    }

    manager
        .branch_session(
            &workspace_path,
            &SessionBranchRequest {
                source_session_id: request.source_session_id,
                source_turn_id: request.source_turn_id,
            },
        )
        .await
        .map_err(|e| format!("Failed to fork session: {}", e))
}
