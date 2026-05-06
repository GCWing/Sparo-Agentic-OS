//! Agentic API

use log::warn;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::api::app_state::AppState;
use crate::api::session_storage_path::{
    desktop_effective_session_storage_path, SessionStorageScopeDto,
};
use bitfun_core::agentic::coordination::{
    ConversationCoordinator, DialogScheduler, DialogSubmissionPolicy, DialogTriggerSource,
};
use bitfun_core::agentic::core::*;
use bitfun_core::agentic::image_analysis::ImageContextData;
use bitfun_core::agentic::tools::image_context::get_image_context;
use bitfun_core::service::config::GlobalConfig;
use bitfun_core::service::prompt_history::{
    PromptHistoryContext, PromptHistoryGlobalAiSnapshot, PromptHistoryModelSnapshot,
    PromptHistoryRuntimeSnapshot, PromptHistorySessionSnapshot, PromptHistoryStore,
};
use bitfun_core::service::prompt_value::PromptValueStore;
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub session_id: Option<String>,
    pub session_name: String,
    pub agent_type: String,
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub storage_scope: Option<SessionStorageScopeDto>,
    pub config: Option<SessionConfigDTO>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfigDTO {
    pub max_context_tokens: Option<usize>,
    pub auto_compact: Option<bool>,
    pub enable_tools: Option<bool>,
    pub safe_mode: Option<bool>,
    pub max_turns: Option<usize>,
    pub enable_context_compression: Option<bool>,
    pub compression_threshold: Option<f32>,
    pub model_name: Option<String>,
    #[serde(default)]
    pub storage_scope: Option<SessionStorageScopeDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionResponse {
    pub session_id: String,
    pub session_name: String,
    pub agent_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionModelRequest {
    pub session_id: String,
    pub model_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionTitleRequest {
    pub session_id: String,
    pub title: String,
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub storage_scope: Option<SessionStorageScopeDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDialogTurnRequest {
    pub session_id: String,
    pub user_input: String,
    pub original_user_input: Option<String>,
    pub agent_type: String,
    #[serde(default)]
    pub system_reminder_override: Option<String>,
    pub workspace_path: Option<String>,
    pub turn_id: Option<String>,
    #[serde(default)]
    pub persist_agent_type: Option<bool>,
    #[serde(default)]
    pub image_contexts: Option<Vec<ImageContextData>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDialogTurnResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactSessionRequest {
    pub session_id: String,
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub storage_scope: Option<SessionStorageScopeDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureCoordinatorSessionRequest {
    pub session_id: String,
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub storage_scope: Option<SessionStorageScopeDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSessionRequest {
    pub session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub session_id: String,
    pub session_name: String,
    pub agent_type: String,
    pub state: String,
    pub turn_count: usize,
    pub created_at: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelDialogTurnRequest {
    pub session_id: String,
    pub dialog_turn_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelToolRequest {
    pub tool_use_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSessionRequest {
    pub session_id: String,
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub storage_scope: Option<SessionStorageScopeDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSessionRequest {
    pub session_id: String,
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub storage_scope: Option<SessionStorageScopeDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsRequest {
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub storage_scope: Option<SessionStorageScopeDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmToolRequest {
    pub session_id: String,
    pub tool_id: String,
    pub updated_input: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectToolRequest {
    pub session_id: String,
    pub tool_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateSessionTitleRequest {
    pub session_id: String,
    pub user_message: String,
    pub max_length: Option<usize>,
}

#[tauri::command]
pub async fn create_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    app_state: State<'_, AppState>,
    request: CreateSessionRequest,
) -> Result<CreateSessionResponse, String> {
    let storage_scope = request
        .storage_scope
        .or_else(|| request.config.as_ref().and_then(|c| c.storage_scope));
    let resolved_workspace_path = request.workspace_path.clone().or_else(|| {
        if matches!(storage_scope, Some(SessionStorageScopeDto::AgenticOs)) {
            Some(
                app_state
                    .workspace_service
                    .path_manager()
                    .agentic_os_runtime_root()
                    .to_string_lossy()
                    .into_owned(),
            )
        } else {
            None
        }
    });
    let workspace_path = resolved_workspace_path
        .clone()
        .ok_or_else(|| "workspace_path is required to create a session".to_string())?;

    let config = request
        .config
        .map(|c| SessionConfig {
            max_context_tokens: c.max_context_tokens.unwrap_or(128128),
            auto_compact: c.auto_compact.unwrap_or(true),
            enable_tools: c.enable_tools.unwrap_or(true),
            safe_mode: c.safe_mode.unwrap_or(true),
            max_turns: c.max_turns.unwrap_or(200),
            enable_context_compression: c.enable_context_compression.unwrap_or(true),
            compression_threshold: c.compression_threshold.unwrap_or(0.8),
            workspace_path: Some(workspace_path.clone()),
            storage_scope: storage_scope.map(|scope| match scope {
                SessionStorageScopeDto::Workspace => SessionStorageScope::Workspace,
                SessionStorageScopeDto::AgenticOs => SessionStorageScope::AgenticOs,
            }),
            model_id: c.model_name,
        })
        .unwrap_or(SessionConfig {
            workspace_path: Some(workspace_path.clone()),
            storage_scope: storage_scope.map(|scope| match scope {
                SessionStorageScopeDto::Workspace => SessionStorageScope::Workspace,
                SessionStorageScopeDto::AgenticOs => SessionStorageScope::AgenticOs,
            }),
            ..Default::default()
        });

    let session = coordinator
        .create_session_with_workspace(
            request.session_id,
            request.session_name.clone(),
            request.agent_type.clone(),
            config,
            workspace_path,
        )
        .await
        .map_err(|e| format!("Failed to create session: {}", e))?;

    Ok(CreateSessionResponse {
        session_id: session.session_id,
        session_name: session.session_name,
        agent_type: session.agent_type,
    })
}

#[tauri::command]
pub async fn update_session_model(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: UpdateSessionModelRequest,
) -> Result<(), String> {
    coordinator
        .update_session_model(&request.session_id, &request.model_name)
        .await
        .map_err(|e| format!("Failed to update session model: {}", e))
}

#[tauri::command]
pub async fn update_session_title(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    app_state: State<'_, AppState>,
    request: UpdateSessionTitleRequest,
) -> Result<String, String> {
    let session_id = request.session_id.trim();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }

    if coordinator
        .get_session_manager()
        .get_session(session_id)
        .is_none()
    {
        let workspace_path = request
            .workspace_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .or_else(|| {
                if matches!(
                    request.storage_scope,
                    Some(SessionStorageScopeDto::AgenticOs)
                ) {
                    Some("")
                } else {
                    None
                }
            })
            .ok_or_else(|| {
                "workspace_path is required when the session is not loaded".to_string()
            })?;

        let effective = desktop_effective_session_storage_path(
            &app_state,
            Some(workspace_path),
            request.storage_scope,
        )
        .await;

        coordinator
            .restore_session(&effective, session_id)
            .await
            .map_err(|e| format!("Failed to restore session before renaming: {}", e))?;
    }

    coordinator
        .update_session_title(session_id, &request.title)
        .await
        .map_err(|e| format!("Failed to update session title: {}", e))
}

/// Load the session into the coordinator process when it exists on disk but is not in memory.
/// Uses the same remote→local session path mapping as `restore_session`.
#[tauri::command]
pub async fn ensure_coordinator_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    app_state: State<'_, AppState>,
    request: EnsureCoordinatorSessionRequest,
) -> Result<(), String> {
    let session_id = request.session_id.trim();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }
    if coordinator
        .get_session_manager()
        .get_session(session_id)
        .is_some()
    {
        return Ok(());
    }

    let wp = request.workspace_path.as_deref().unwrap_or("").trim();
    if wp.is_empty()
        && !matches!(
            request.storage_scope,
            Some(SessionStorageScopeDto::AgenticOs)
        )
    {
        return Err("workspace_path is required when the session is not loaded".to_string());
    }

    let effective =
        desktop_effective_session_storage_path(&app_state, Some(wp), request.storage_scope).await;
    coordinator
        .restore_session(&effective, session_id)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_dialog_turn(
    _app: AppHandle,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    app_state: State<'_, AppState>,
    request: StartDialogTurnRequest,
) -> Result<StartDialogTurnResponse, String> {
    let StartDialogTurnRequest {
        session_id,
        user_input,
        original_user_input,
        agent_type,
        system_reminder_override,
        workspace_path,
        turn_id,
        persist_agent_type,
        image_contexts,
    } = request;

    let policy = DialogSubmissionPolicy::for_source(DialogTriggerSource::DesktopUi)
        .with_persist_agent_type(persist_agent_type.unwrap_or(true));
    let resolved_images = if let Some(image_contexts) = image_contexts
        .as_ref()
        .filter(|images| !images.is_empty())
        .cloned()
    {
        Some(resolve_missing_image_payloads(image_contexts)?)
    } else {
        None
    };

    if let Some(workspace_for_history) = workspace_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let history_context = build_prompt_history_context(
            coordinator.inner().as_ref(),
            app_state.inner(),
            &session_id,
            &agent_type,
            workspace_for_history,
            persist_agent_type,
            system_reminder_override.as_deref(),
            image_contexts.as_ref().map_or(0, Vec::len),
        )
        .await;
        match PromptHistoryStore::record_chat_input(
            workspace_for_history.to_string(),
            session_id.clone(),
            turn_id.clone(),
            agent_type.clone(),
            user_input.clone(),
            original_user_input.clone(),
            Some(history_context),
        ) {
            Ok(event) => {
                if let Err(error) = PromptValueStore::record_prompt_created(
                    Path::new(workspace_for_history),
                    &event,
                ) {
                    warn!("Failed to record prompt value creation signal: {}", error);
                }
            }
            Err(error) => {
                warn!("Failed to record prompt history: {}", error);
            }
        }
    }

    scheduler
        .submit(
            session_id,
            user_input,
            original_user_input,
            turn_id,
            agent_type,
            system_reminder_override,
            workspace_path,
            policy,
            None,
            resolved_images,
        )
        .await
        .map_err(|e| format!("Failed to start dialog turn: {}", e))?;

    Ok(StartDialogTurnResponse {
        success: true,
        message: "Dialog turn started".to_string(),
    })
}

async fn build_prompt_history_context(
    coordinator: &ConversationCoordinator,
    app_state: &AppState,
    session_id: &str,
    agent_type: &str,
    workspace_path: &str,
    persist_agent_type: Option<bool>,
    system_reminder_override: Option<&str>,
    image_context_count: usize,
) -> PromptHistoryContext {
    let session = coordinator.get_session_manager().get_session(session_id);
    let global_config: Option<GlobalConfig> = app_state.config_service.get_config(None).await.ok();
    let session_snapshot = build_prompt_history_session_snapshot(session.as_ref(), workspace_path);
    let requested_model_id = session
        .as_ref()
        .and_then(|session| session.config.model_id.clone())
        .or_else(|| {
            global_config
                .as_ref()
                .and_then(|config| config.ai.agent_models.get(agent_type).cloned())
        })
        .or_else(|| Some("primary".to_string()));
    let resolved_model_id = global_config
        .as_ref()
        .and_then(|config| {
            requested_model_id
                .as_deref()
                .and_then(|model_id| config.ai.resolve_model_selection(model_id))
        })
        .or_else(|| requested_model_id.clone());

    PromptHistoryContext {
        trigger_source: "desktopUi".to_string(),
        session: session_snapshot,
        model: build_prompt_history_model_snapshot(
            global_config.as_ref(),
            requested_model_id,
            resolved_model_id,
        ),
        global_ai: global_config
            .as_ref()
            .map(|config| build_prompt_history_global_ai_snapshot(config, agent_type)),
        runtime: PromptHistoryRuntimeSnapshot {
            image_context_count,
            persist_agent_type,
            system_reminder_override_present: system_reminder_override
                .map(str::trim)
                .is_some_and(|value| !value.is_empty()),
        },
    }
}

fn build_prompt_history_session_snapshot(
    session: Option<&Session>,
    workspace_path: &str,
) -> PromptHistorySessionSnapshot {
    let config = session
        .map(|session| session.config.clone())
        .unwrap_or_else(|| SessionConfig {
            workspace_path: Some(workspace_path.to_string()),
            ..Default::default()
        });

    PromptHistorySessionSnapshot {
        session_name: session.map(|session| session.session_name.clone()),
        session_kind: session.and_then(|session| json_label(&session.kind)),
        workspace_path: config
            .workspace_path
            .clone()
            .or_else(|| Some(workspace_path.to_string())),
        remote_connection_id: None,
        remote_ssh_host: None,
        storage_scope: config.storage_scope.as_ref().and_then(json_label),
        model_id: config.model_id.clone(),
        max_context_tokens: config.max_context_tokens,
        auto_compact: config.auto_compact,
        enable_tools: config.enable_tools,
        safe_mode: config.safe_mode,
        max_turns: config.max_turns,
        enable_context_compression: config.enable_context_compression,
        compression_threshold: config.compression_threshold,
    }
}

fn build_prompt_history_model_snapshot(
    global_config: Option<&GlobalConfig>,
    requested_model_id: Option<String>,
    resolved_model_id: Option<String>,
) -> Option<PromptHistoryModelSnapshot> {
    let model = global_config.and_then(|config| {
        config.ai.models.iter().find(|model| {
            matches_model_ref(model, resolved_model_id.as_deref())
                || matches_model_ref(model, requested_model_id.as_deref())
        })
    });

    match model {
        Some(model) => Some(PromptHistoryModelSnapshot {
            requested_model_id,
            resolved_model_id,
            name: Some(model.name.clone()),
            provider: Some(model.provider.clone()),
            model_name: Some(model.model_name.clone()),
            base_url: Some(sanitize_history_url(&model.base_url)),
            request_url: model.request_url.as_deref().map(sanitize_history_url),
            enabled: Some(model.enabled),
            context_window: model.context_window,
            max_tokens: model.max_tokens,
            temperature: model.temperature,
            top_p: model.top_p,
            category: json_label(&model.category),
            capabilities: model.capabilities.iter().filter_map(json_label).collect(),
            reasoning_mode: model.reasoning_mode.as_ref().and_then(json_label),
            reasoning_effort: model.reasoning_effort.clone(),
            thinking_budget_tokens: model.thinking_budget_tokens,
            auth_type: json_label(&model.auth),
            inline_think_in_text: Some(model.inline_think_in_text),
            custom_headers_mode: model.custom_headers_mode.clone(),
            has_custom_headers: model
                .custom_headers
                .as_ref()
                .is_some_and(|headers| !headers.is_empty()),
            custom_request_body_mode: model.custom_request_body_mode.clone(),
            has_custom_request_body: model
                .custom_request_body
                .as_ref()
                .is_some_and(|body| !body.trim().is_empty()),
            skip_ssl_verify: Some(model.skip_ssl_verify),
        }),
        None if requested_model_id.is_some() || resolved_model_id.is_some() => {
            Some(PromptHistoryModelSnapshot {
                requested_model_id,
                resolved_model_id,
                name: None,
                provider: None,
                model_name: None,
                base_url: None,
                request_url: None,
                enabled: None,
                context_window: None,
                max_tokens: None,
                temperature: None,
                top_p: None,
                category: None,
                capabilities: Vec::new(),
                reasoning_mode: None,
                reasoning_effort: None,
                thinking_budget_tokens: None,
                auth_type: None,
                inline_think_in_text: None,
                custom_headers_mode: None,
                has_custom_headers: false,
                custom_request_body_mode: None,
                has_custom_request_body: false,
                skip_ssl_verify: None,
            })
        }
        None => None,
    }
}

fn build_prompt_history_global_ai_snapshot(
    config: &GlobalConfig,
    agent_type: &str,
) -> PromptHistoryGlobalAiSnapshot {
    PromptHistoryGlobalAiSnapshot {
        default_primary_model_id: config.ai.default_models.primary.clone(),
        default_fast_model_id: config.ai.default_models.fast.clone(),
        agent_model_id: config.ai.agent_models.get(agent_type).cloned(),
        stream_idle_timeout_secs: config.ai.stream_idle_timeout_secs,
        tool_execution_timeout_secs: config.ai.tool_execution_timeout_secs,
        tool_confirmation_timeout_secs: config.ai.tool_confirmation_timeout_secs,
        skip_tool_confirmation: config.ai.skip_tool_confirmation,
        proxy_enabled: config.ai.proxy.enabled,
        computer_use_enabled: config.ai.computer_use_enabled,
        workspace_auto_memory_enabled: config.ai.auto_memory.workspace.enabled,
        global_auto_memory_enabled: config.ai.auto_memory.global.enabled,
    }
}

fn matches_model_ref(
    model: &bitfun_core::service::config::AIModelConfig,
    model_ref: Option<&str>,
) -> bool {
    model_ref
        .is_some_and(|value| model.id == value || model.name == value || model.model_name == value)
}

fn sanitize_history_url(value: &str) -> String {
    let without_fragment = value.split('#').next().unwrap_or(value);
    let without_query = without_fragment
        .split('?')
        .next()
        .unwrap_or(without_fragment);
    if let Some((scheme, rest)) = without_query.split_once("://") {
        if let Some((_, host_and_path)) = rest.split_once('@') {
            return format!("{scheme}://***@{host_and_path}");
        }
    }
    without_query.to_string()
}

fn json_label<T: Serialize>(value: &T) -> Option<String> {
    let value = serde_json::to_value(value).ok()?;
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::String(value) => Some(value),
        serde_json::Value::Object(map) => map
            .get("type")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
            .or_else(|| Some(serde_json::Value::Object(map).to_string())),
        value => Some(value.to_string()),
    }
}

#[tauri::command]
pub async fn compact_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    app_state: State<'_, AppState>,
    request: CompactSessionRequest,
) -> Result<StartDialogTurnResponse, String> {
    let session_id = request.session_id.trim();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }

    if coordinator
        .get_session_manager()
        .get_session(session_id)
        .is_none()
    {
        let workspace_path = request
            .workspace_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .or_else(|| {
                if matches!(
                    request.storage_scope,
                    Some(SessionStorageScopeDto::AgenticOs)
                ) {
                    Some("")
                } else {
                    None
                }
            })
            .ok_or_else(|| {
                "workspace_path is required when the session is not loaded".to_string()
            })?;
        let effective = desktop_effective_session_storage_path(
            &app_state,
            Some(workspace_path),
            request.storage_scope,
        )
        .await;
        coordinator
            .restore_session(&effective, session_id)
            .await
            .map_err(|e| format!("Failed to restore session before compacting: {}", e))?;
    }

    coordinator
        .compact_session_manually(session_id.to_string())
        .await
        .map_err(|e| format!("Failed to compact session: {}", e))?;

    Ok(StartDialogTurnResponse {
        success: true,
        message: "Session compaction started".to_string(),
    })
}

fn is_blank_text(value: Option<&String>) -> bool {
    value.map(|s| s.trim().is_empty()).unwrap_or(true)
}

fn resolve_missing_image_payloads(
    image_contexts: Vec<ImageContextData>,
) -> Result<Vec<ImageContextData>, String> {
    let mut resolved = Vec::with_capacity(image_contexts.len());

    for mut image in image_contexts {
        let missing_payload =
            is_blank_text(image.image_path.as_ref()) && is_blank_text(image.data_url.as_ref());
        if !missing_payload {
            resolved.push(image);
            continue;
        }

        let stored = get_image_context(&image.id).ok_or_else(|| {
            format!(
                "Image context not found for image_id={}. It may have expired. Please re-attach the image and retry.",
                image.id
            )
        })?;

        if is_blank_text(image.image_path.as_ref()) {
            image.image_path = stored
                .image_path
                .clone()
                .filter(|s: &String| !s.trim().is_empty());
        }
        if is_blank_text(image.data_url.as_ref()) {
            image.data_url = stored
                .data_url
                .clone()
                .filter(|s: &String| !s.trim().is_empty());
        }
        if image.mime_type.trim().is_empty() {
            image.mime_type = stored.mime_type.clone();
        }

        let mut metadata = image
            .metadata
            .take()
            .unwrap_or_else(|| serde_json::json!({}));
        if !metadata.is_object() {
            metadata = serde_json::json!({ "raw_metadata": metadata });
        }
        if let Some(obj) = metadata.as_object_mut() {
            if !obj.contains_key("name") {
                obj.insert("name".to_string(), serde_json::json!(stored.image_name));
            }
            if !obj.contains_key("width") {
                obj.insert("width".to_string(), serde_json::json!(stored.width));
            }
            if !obj.contains_key("height") {
                obj.insert("height".to_string(), serde_json::json!(stored.height));
            }
            if !obj.contains_key("file_size") {
                obj.insert("file_size".to_string(), serde_json::json!(stored.file_size));
            }
            if !obj.contains_key("source") {
                obj.insert("source".to_string(), serde_json::json!(stored.source));
            }
            obj.insert(
                "resolved_from_upload_cache".to_string(),
                serde_json::json!(true),
            );
        }
        image.metadata = Some(metadata);

        let still_missing =
            is_blank_text(image.image_path.as_ref()) && is_blank_text(image.data_url.as_ref());
        if still_missing {
            return Err(format!(
                "Image context {} is missing image_path/data_url after cache resolution",
                image.id
            ));
        }

        resolved.push(image);
    }

    Ok(resolved)
}

#[tauri::command]
pub async fn cancel_dialog_turn(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: CancelDialogTurnRequest,
) -> Result<(), String> {
    coordinator
        .cancel_dialog_turn(&request.session_id, &request.dialog_turn_id)
        .await
        .map_err(|e| {
            log::error!(
                "Failed to cancel dialog turn: session_id={}, dialog_turn_id={}, error={}",
                request.session_id,
                request.dialog_turn_id,
                e
            );
            format!("Failed to cancel dialog turn: {}", e)
        })
}

#[tauri::command]
pub async fn cancel_tool(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: CancelToolRequest,
) -> Result<(), String> {
    let reason = request
        .reason
        .unwrap_or_else(|| "User cancelled".to_string());

    coordinator
        .cancel_tool(&request.tool_use_id, reason)
        .await
        .map_err(|e| {
            log::error!(
                "Failed to cancel tool execution: tool_use_id={}, error={}",
                request.tool_use_id,
                e
            );
            format!("Failed to cancel tool execution: {}", e)
        })
}

#[tauri::command]
pub async fn delete_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    app_state: State<'_, AppState>,
    request: DeleteSessionRequest,
) -> Result<(), String> {
    let effective_path = desktop_effective_session_storage_path(
        &app_state,
        request.workspace_path.as_deref(),
        request.storage_scope,
    )
    .await;
    coordinator
        .delete_session(&effective_path, &request.session_id)
        .await
        .map_err(|e| format!("Failed to delete session: {}", e))
}

#[tauri::command]
pub async fn restore_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    app_state: State<'_, AppState>,
    request: RestoreSessionRequest,
) -> Result<SessionResponse, String> {
    let effective_path = desktop_effective_session_storage_path(
        &app_state,
        request.workspace_path.as_deref(),
        request.storage_scope,
    )
    .await;
    let session = coordinator
        .restore_session(&effective_path, &request.session_id)
        .await
        .map_err(|e| format!("Failed to restore session: {}", e))?;

    Ok(session_to_response(session))
}

#[tauri::command]
pub async fn list_sessions(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    app_state: State<'_, AppState>,
    request: ListSessionsRequest,
) -> Result<Vec<SessionResponse>, String> {
    let effective_path = desktop_effective_session_storage_path(
        &app_state,
        request.workspace_path.as_deref(),
        request.storage_scope,
    )
    .await;
    let summaries = coordinator
        .list_sessions(&effective_path)
        .await
        .map_err(|e| format!("Failed to list sessions: {}", e))?;

    let responses = summaries
        .into_iter()
        .map(|summary| SessionResponse {
            session_id: summary.session_id,
            session_name: summary.session_name,
            agent_type: summary.agent_type,
            state: format!("{:?}", summary.state),
            turn_count: summary.turn_count,
            created_at: system_time_to_unix_secs(summary.created_at),
        })
        .collect();

    Ok(responses)
}

#[tauri::command]
pub async fn confirm_tool_execution(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: ConfirmToolRequest,
) -> Result<(), String> {
    coordinator
        .confirm_tool(&request.tool_id, request.updated_input)
        .await
        .map_err(|e| format!("Confirm tool failed: {}", e))
}

#[tauri::command]
pub async fn reject_tool_execution(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: RejectToolRequest,
) -> Result<(), String> {
    let reason = request
        .reason
        .unwrap_or_else(|| "User rejected".to_string());

    coordinator
        .reject_tool(&request.tool_id, reason)
        .await
        .map_err(|e| format!("Reject tool failed: {}", e))
}

#[tauri::command]
pub async fn generate_session_title(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: GenerateSessionTitleRequest,
) -> Result<String, String> {
    coordinator
        .generate_session_title(
            &request.session_id,
            &request.user_message,
            request.max_length,
        )
        .await
        .map_err(|e| format!("Failed to generate session title: {}", e))
}

#[tauri::command]
pub async fn list_agents(state: State<'_, AppState>) -> Result<Vec<AgentInfoDTO>, String> {
    let agent_infos = state.agent_registry.list_agents_info().await;

    let dtos: Vec<AgentInfoDTO> = agent_infos
        .into_iter()
        .map(|info| AgentInfoDTO {
            id: info.id,
            name: info.name,
            description: info.description,
            is_readonly: info.is_readonly,
            tool_count: info.tool_count,
            default_tools: info.default_tools,
            enabled: info.enabled,
        })
        .collect();

    Ok(dtos)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfoDTO {
    pub id: String,
    pub name: String,
    pub description: String,
    pub is_readonly: bool,
    pub tool_count: usize,
    pub default_tools: Vec<String>,
    pub enabled: bool,
}

fn session_to_response(session: Session) -> SessionResponse {
    SessionResponse {
        session_id: session.session_id,
        session_name: session.session_name,
        agent_type: session.agent_type,
        state: format!("{:?}", session.state),
        turn_count: session.dialog_turn_ids.len(),
        created_at: system_time_to_unix_secs(session.created_at),
    }
}

fn system_time_to_unix_secs(time: std::time::SystemTime) -> u64 {
    match time.duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => duration.as_secs(),
        Err(err) => {
            warn!("Failed to convert SystemTime to unix timestamp: {}", err);
            0
        }
    }
}
