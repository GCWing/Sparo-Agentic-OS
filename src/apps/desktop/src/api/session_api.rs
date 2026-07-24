//! Session persistence API

use crate::api::app_state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sparo_core::agentic::coordination::ConversationCoordinator;
use sparo_core::agentic::persistence::{
    PersistenceManager, SessionBranchRequest, SessionBranchResult,
};
use sparo_core::agentic::tools::{get_all_registered_tools, ToolRuntimeRestrictions};
use sparo_core::agentic::{
    PromptBuilder, PromptBuilderContext, SessionContextPolicy, SessionDomain, SessionLocator,
    WorkspaceBinding,
};
use sparo_core::infrastructure::PathManager;
use sparo_core::service::config::types::{AIConfig, ModelCapability, ModelCategory};
use sparo_core::service::context_stats::{ContextBudgetSnapshot, ContextStatsEstimator};
use sparo_core::service::session::{
    DialogTurnData, SessionMetadata, SessionTranscriptExport, SessionTranscriptExportOptions,
};
use sparo_core::util::types::ToolDefinition;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListPersistedSessionsRequest {
    pub domain: SessionDomain,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadSessionTurnsRequest {
    pub locator: SessionLocator,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveSessionTurnRequest {
    pub turn_data: DialogTurnData,
    pub domain: SessionDomain,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveSessionMetadataRequest {
    pub metadata: SessionMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSessionTranscriptRequest {
    pub locator: SessionLocator,
    #[serde(default = "default_tools")]
    pub tools: bool,
    #[serde(default)]
    pub tool_inputs: bool,
    #[serde(default)]
    pub thinking: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turns: Option<Vec<String>>,
}

fn default_tools() -> bool {
    false
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeletePersistedSessionRequest {
    pub locator: SessionLocator,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TouchSessionActivityRequest {
    pub locator: SessionLocator,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadPersistedSessionMetadataRequest {
    pub locator: SessionLocator,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetContextBudgetRequest {
    pub locator: SessionLocator,
    pub agent_type: String,
    pub workspace_path: Option<String>,
    pub model_id: Option<String>,
}

#[derive(Clone)]
struct CachedContextBudget {
    snapshot: ContextBudgetSnapshot,
    stored_at: Instant,
}

const CONTEXT_BUDGET_CACHE_TTL: Duration = Duration::from_secs(30);
static CONTEXT_BUDGET_CACHE: OnceLock<Mutex<HashMap<String, CachedContextBudget>>> =
    OnceLock::new();

fn context_budget_cache() -> &'static Mutex<HashMap<String, CachedContextBudget>> {
    CONTEXT_BUDGET_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn normalized_context_budget_workspace_key(workspace_path: Option<&Path>) -> String {
    let Some(path) = workspace_path else {
        return "none".to_string();
    };
    let normalized = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        normalized.to_ascii_lowercase()
    } else {
        normalized
    }
}

fn context_budget_cache_key(
    session_id: &str,
    agent_type: &str,
    model_name: &str,
    provider: &str,
    model_context_window: usize,
    effective_context_window: usize,
    context_policy: &SessionContextPolicy,
    domain: &SessionDomain,
    workspace_path: Option<&Path>,
) -> String {
    [
        session_id.to_string(),
        agent_type.to_string(),
        model_name.to_string(),
        provider.to_string(),
        model_context_window.to_string(),
        effective_context_window.to_string(),
        format!("{context_policy:?}"),
        format!("{domain:?}"),
        normalized_context_budget_workspace_key(workspace_path),
    ]
    .join("\u{1f}")
}

fn cached_context_budget_snapshot(cache_key: &str) -> Option<ContextBudgetSnapshot> {
    let mut cache = context_budget_cache().lock().ok()?;
    let entry = cache.get(cache_key)?;
    if entry.stored_at.elapsed() > CONTEXT_BUDGET_CACHE_TTL {
        cache.remove(cache_key);
        return None;
    }
    let mut snapshot = entry.snapshot.clone();
    snapshot.id = uuid::Uuid::new_v4().to_string();
    snapshot.created_at = chrono::Utc::now().timestamp_millis() as u64;
    Some(snapshot)
}

fn store_context_budget_snapshot(cache_key: String, snapshot: &ContextBudgetSnapshot) {
    if let Ok(mut cache) = context_budget_cache().lock() {
        cache.insert(
            cache_key,
            CachedContextBudget {
                snapshot: snapshot.clone(),
                stored_at: Instant::now(),
            },
        );
    }
}

fn validate_public_persistence_metadata(
    existing: Option<&SessionMetadata>,
    proposed: Option<&SessionMetadata>,
) -> Result<(), String> {
    if existing.is_some_and(SessionMetadata::should_hide_from_user_lists)
        || proposed.is_some_and(SessionMetadata::should_hide_from_user_lists)
    {
        return Err("session.system_owned".to_string());
    }
    Ok(())
}

async fn ensure_public_persistence_mutation(
    coordinator: &ConversationCoordinator,
    manager: &PersistenceManager,
    domain: &SessionDomain,
    session_id: &str,
    proposed: Option<&SessionMetadata>,
) -> Result<(), String> {
    coordinator
        .ensure_session_accepts_public_mutation(session_id)
        .await
        .map_err(|_| "settings.lifecycle_owned".to_string())?;
    let existing = manager
        .load_session_metadata(domain, session_id)
        .await
        .map_err(|_| "session.ownership_check_failed".to_string())?;
    validate_public_persistence_metadata(existing.as_ref(), proposed)
}

fn resolve_model_config_for_budget<'a>(
    ai_config: &'a AIConfig,
    selector: &str,
) -> Option<&'a sparo_core::service::config::types::AIModelConfig> {
    let selector = if selector.trim().is_empty() {
        "primary"
    } else {
        selector.trim()
    };
    let resolved_model_id = ai_config.resolve_model_selection(selector)?;
    ai_config
        .models
        .iter()
        .find(|model| model.id == resolved_model_id)
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
) -> Result<Vec<ToolDefinition>, String> {
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
        session_domain: None,
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
            .map_err(|error| {
                format!(
                    "Failed to build description for tool '{}': {error}",
                    tool.name()
                )
            })?;
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
    Ok(tool_definitions)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForkSessionRequest {
    pub source: SessionLocator,
    pub source_turn_id: String,
}

pub type ForkSessionResponse = SessionBranchResult;

#[tauri::command]
pub async fn list_persisted_sessions(
    request: ListPersistedSessionsRequest,
    path_manager: State<'_, Arc<PathManager>>,
) -> Result<Vec<SessionMetadata>, String> {
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;

    manager
        .list_session_metadata(&request.domain)
        .await
        .map_err(|e| format!("Failed to list persisted sessions: {}", e))
}

#[tauri::command]
pub async fn load_session_turns(
    request: LoadSessionTurnsRequest,
    path_manager: State<'_, Arc<PathManager>>,
) -> Result<Vec<DialogTurnData>, String> {
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;

    let turns = if let Some(limit) = request.limit {
        manager
            .load_recent_turns(&request.locator.domain, &request.locator.session_id, limit)
            .await
    } else {
        manager
            .load_session_turns(&request.locator.domain, &request.locator.session_id)
            .await
    };

    turns.map_err(|e| format!("Failed to load session turns: {}", e))
}

#[tauri::command]
pub async fn get_context_budget(
    request: GetContextBudgetRequest,
    app_state: State<'_, AppState>,
    path_manager: State<'_, Arc<PathManager>>,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
) -> Result<ContextBudgetSnapshot, String> {
    let loaded_session = match coordinator
        .get_session_manager()
        .get_session(&request.locator.session_id)
    {
        Some(session) => Some(session),
        None => {
            let manager = PersistenceManager::new(path_manager.inner().clone())
                .map_err(|error| format!("Failed to open session persistence: {error}"))?;
            if manager
                .load_session_metadata(&request.locator.domain, &request.locator.session_id)
                .await
                .map_err(|error| format!("Failed to inspect session context policy: {error}"))?
                .is_some()
            {
                Some(
                    manager
                        .load_session(&request.locator)
                        .await
                        .map_err(|error| {
                            format!("Failed to load authoritative session context policy: {error}")
                        })?,
                )
            } else {
                None
            }
        }
    };
    let agent_type = normalize_context_budget_agent_type(
        loaded_session
            .as_ref()
            .map(|session| session.agent_type.as_str())
            .unwrap_or(&request.agent_type),
    );
    let context_policy = loaded_session
        .as_ref()
        .map(|session| session.config.context_policy.clone())
        .unwrap_or_default();
    let workspace_path = loaded_session
        .as_ref()
        .and_then(|session| session.config.workspace_path.as_ref())
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            request
                .workspace_path
                .as_ref()
                .filter(|path| !path.trim().is_empty())
                .map(PathBuf::from)
        });
    let workspace = workspace_path.map(|path| WorkspaceBinding::new(None, path));

    let session_model_id = loaded_session
        .as_ref()
        .and_then(|session| session.config.model_id.as_deref())
        .map(str::trim)
        .filter(|model_id| !model_id.is_empty())
        .map(str::to_string);
    let selector = if let Some(model_id) = session_model_id {
        model_id
    } else if loaded_session.is_some() {
        app_state
            .agent_registry
            .get_model_id_for_agent(
                &agent_type,
                workspace.as_ref().map(|binding| binding.root_path()),
            )
            .await
            .map_err(|error| format!("Failed to resolve session model: {error}"))?
    } else if let Some(model_id) = request
        .model_id
        .as_deref()
        .map(str::trim)
        .filter(|model_id| !model_id.is_empty())
    {
        model_id.to_string()
    } else {
        app_state
            .agent_registry
            .get_model_id_for_agent(
                &agent_type,
                workspace.as_ref().map(|binding| binding.root_path()),
            )
            .await
            .map_err(|error| format!("Failed to resolve session model: {error}"))?
    };
    let ai_config: AIConfig = app_state
        .config_service
        .get_config(Some("ai"))
        .await
        .map_err(|error| format!("Failed to read AI settings: {error}"))?;
    let model_config = resolve_model_config_for_budget(&ai_config, &selector)
        .ok_or_else(|| format!("Configured model selector is invalid: {selector}"))?;
    let model_name = model_config.model_name.clone();
    let provider = model_config.provider.clone();
    let model_context_window = model_config.context_window as usize;
    let context_window = context_policy
        .resolve(model_context_window)
        .map_err(|error| format!("Failed to resolve session context window: {error}"))?
        .effective_context_window;
    let cache_key = context_budget_cache_key(
        &request.locator.session_id,
        &agent_type,
        &model_name,
        &provider,
        model_context_window,
        context_window,
        &context_policy,
        &request.locator.domain,
        workspace.as_ref().map(|binding| binding.root_path()),
    );
    if let Some(snapshot) = cached_context_budget_snapshot(&cache_key) {
        return Ok(snapshot);
    }

    let current_agent = app_state
        .agent_registry
        .get_agent(
            &agent_type,
            workspace.as_ref().map(|binding| binding.root_path()),
        )
        .ok_or_else(|| format!("Agent not found: {}", agent_type))?;

    let primary_supports_image_understanding = model_config
        .capabilities
        .iter()
        .any(|cap| matches!(cap, ModelCapability::ImageUnderstanding))
        || matches!(model_config.category, ModelCategory::Multimodal);

    let prompt_context = workspace.as_ref().map(|binding| {
        PromptBuilderContext::new(binding.root_path_string(), Some(model_name.clone()))
            .with_session_id(request.locator.session_id.clone())
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
        .await
        .map_err(|error| format!("Failed to read agent tool configuration: {error}"))?;
    let tool_definitions = build_tool_definitions_for_budget(
        &agent_allowed_tools,
        workspace.as_ref(),
        &agent_type,
        primary_supports_image_understanding,
    )
    .await?;

    let snapshot = ContextStatsEstimator::static_snapshot(
        request.locator.session_id,
        agent_type,
        model_name,
        provider,
        context_window,
        &system_prompt,
        request_context_reminder.as_deref(),
        Some(&tool_definitions),
    );
    store_context_budget_snapshot(cache_key, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub async fn save_session_turn(
    request: SaveSessionTurnRequest,
    path_manager: State<'_, Arc<PathManager>>,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
) -> Result<(), String> {
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;
    ensure_public_persistence_mutation(
        coordinator.inner().as_ref(),
        &manager,
        &request.domain,
        &request.turn_data.session_id,
        None,
    )
    .await?;

    manager
        .save_dialog_turn(&request.domain, &request.turn_data)
        .await
        .map_err(|e| format!("Failed to save session turn: {}", e))
}

#[tauri::command]
pub async fn save_session_metadata(
    request: SaveSessionMetadataRequest,
    path_manager: State<'_, Arc<PathManager>>,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
) -> Result<(), String> {
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;
    ensure_public_persistence_mutation(
        coordinator.inner().as_ref(),
        &manager,
        &request.metadata.domain,
        &request.metadata.session_id,
        Some(&request.metadata),
    )
    .await?;

    manager
        .save_session_metadata(&request.metadata.domain, &request.metadata)
        .await
        .map_err(|e| format!("Failed to save session metadata: {}", e))
}

#[tauri::command]
pub async fn export_session_transcript(
    request: ExportSessionTranscriptRequest,
    path_manager: State<'_, Arc<PathManager>>,
) -> Result<SessionTranscriptExport, String> {
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;

    manager
        .export_session_transcript(
            &request.locator.domain,
            &request.locator.session_id,
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
    path_manager: State<'_, Arc<PathManager>>,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
) -> Result<(), String> {
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;
    ensure_public_persistence_mutation(
        coordinator.inner().as_ref(),
        &manager,
        &request.locator.domain,
        &request.locator.session_id,
        None,
    )
    .await?;

    manager
        .delete_session(&request.locator)
        .await
        .map_err(|e| format!("Failed to delete persisted session: {}", e))
}

#[tauri::command]
pub async fn touch_session_activity(
    request: TouchSessionActivityRequest,
    path_manager: State<'_, Arc<PathManager>>,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
) -> Result<(), String> {
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;
    ensure_public_persistence_mutation(
        coordinator.inner().as_ref(),
        &manager,
        &request.locator.domain,
        &request.locator.session_id,
        None,
    )
    .await?;

    manager
        .touch_session(&request.locator)
        .await
        .map_err(|e| format!("Failed to update session activity: {}", e))
}

#[tauri::command]
pub async fn load_persisted_session_metadata(
    request: LoadPersistedSessionMetadataRequest,
    path_manager: State<'_, Arc<PathManager>>,
) -> Result<Option<SessionMetadata>, String> {
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;

    let metadata = manager
        .load_session_metadata(&request.locator.domain, &request.locator.session_id)
        .await
        .map_err(|e| format!("Failed to load persisted session metadata: {}", e))?;

    Ok(metadata.filter(|metadata| !metadata.should_hide_from_user_lists()))
}

#[tauri::command]
pub async fn fork_session(
    request: ForkSessionRequest,
    path_manager: State<'_, Arc<PathManager>>,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
) -> Result<ForkSessionResponse, String> {
    let manager = PersistenceManager::new(path_manager.inner().clone())
        .map_err(|e| format!("Failed to create persistence manager: {}", e))?;
    ensure_public_persistence_mutation(
        coordinator.inner().as_ref(),
        &manager,
        &request.source.domain,
        &request.source.session_id,
        None,
    )
    .await?;

    manager
        .branch_session(
            &request.source,
            &SessionBranchRequest {
                source_session_id: request.source.session_id.clone(),
                source_turn_id: request.source_turn_id,
            },
        )
        .await
        .map_err(|e| format!("Failed to fork session: {}", e))
}

#[cfg(test)]
mod ownership_tests {
    use super::{context_budget_cache_key, validate_public_persistence_metadata};
    use sparo_core::agentic::core::{SessionContextPolicy, SessionDomain, SessionKind};
    use sparo_core::service::session::SessionMetadata;

    fn metadata(session_id: &str) -> SessionMetadata {
        SessionMetadata::new(
            SessionDomain::Global,
            session_id.to_string(),
            "Session".to_string(),
            "Runno".to_string(),
            "primary".to_string(),
        )
    }

    #[test]
    fn public_persistence_mutation_rejects_existing_or_proposed_system_sessions() {
        let visible = metadata("visible");
        assert!(validate_public_persistence_metadata(Some(&visible), Some(&visible)).is_ok());

        let mut internal = metadata("internal");
        internal.session_kind = SessionKind::Internal;
        assert!(validate_public_persistence_metadata(Some(&internal), None).is_err());
        assert!(validate_public_persistence_metadata(None, Some(&internal)).is_err());

        let mut subagent = metadata("subagent");
        subagent.session_kind = SessionKind::Subagent;
        assert!(validate_public_persistence_metadata(Some(&subagent), None).is_err());
    }

    #[test]
    fn context_budget_cache_identity_includes_policy_and_effective_window() {
        let domain = SessionDomain::Global;
        let follow_model = context_budget_cache_key(
            "session",
            "Runno",
            "model",
            "provider",
            1_000_000,
            1_000_000,
            &SessionContextPolicy::FollowModel,
            &domain,
            None,
        );
        let capped = context_budget_cache_key(
            "session",
            "Runno",
            "model",
            "provider",
            1_000_000,
            64_000,
            &SessionContextPolicy::ExplicitCap { max_tokens: 64_000 },
            &domain,
            None,
        );

        assert_ne!(follow_model, capped);
    }
}
