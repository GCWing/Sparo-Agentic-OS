//! Agentic API

use log::warn;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::api::app_state::AppState;
use crate::api::command_error::public_settings_agent_error;
use sparo_core::agentic::agents::SettingsAgent;
use sparo_core::agentic::coordination::{
    ConversationCoordinator, DialogGuidedTurnSnapshot, DialogQueuePauseSnapshot,
    DialogQueuedTurnSnapshot, DialogScheduler, DialogSubmissionPolicy, DialogSubmitOutcome,
    DialogTriggerSource, SessionControlActor, TurnCancellationReason,
};
use sparo_core::agentic::core::*;
use sparo_core::agentic::image_analysis::ImageContextData;
use sparo_core::agentic::tools::image_context::get_image_context;
use sparo_core::agentic::{compile_composer_submission, ComposerSubmissionEnvelope};

fn published_settings_agent_error(error: &impl std::fmt::Display) -> String {
    public_settings_agent_error(error).code().to_string()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub session_id: Option<String>,
    pub session_name: String,
    pub agent_type: String,
    pub workspace_path: Option<String>,
    pub domain: SessionDomain,
    pub config: Option<SessionConfigDTO>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfigDTO {
    pub context_policy: Option<SessionContextPolicyDTO>,
    pub auto_compact: Option<bool>,
    pub enable_tools: Option<bool>,
    pub safe_mode: Option<bool>,
    pub max_turns: Option<usize>,
    pub enable_context_compression: Option<bool>,
    pub compression_threshold: Option<f32>,
    pub model_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum SessionContextPolicyDTO {
    FollowModel,
    ExplicitCap {
        #[serde(rename = "maxTokens")]
        max_tokens: usize,
    },
}

impl SessionContextPolicyDTO {
    fn into_core(self) -> Result<SessionContextPolicy, String> {
        match self {
            Self::FollowModel => Ok(SessionContextPolicy::FollowModel),
            Self::ExplicitCap { max_tokens } if max_tokens > 0 => {
                Ok(SessionContextPolicy::ExplicitCap { max_tokens })
            }
            Self::ExplicitCap { .. } => {
                Err("contextPolicy.maxTokens must be greater than zero".to_string())
            }
        }
    }
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
    pub locator: SessionLocator,
    pub title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionWorkspaceRequest {
    pub session_id: String,
    pub workspace_path: String,
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
    pub trigger_source: Option<DialogTriggerSourceDto>,
    #[serde(default)]
    pub user_message_metadata: Option<serde_json::Value>,
    #[serde(default)]
    pub persist_agent_type: Option<bool>,
    #[serde(default)]
    pub image_contexts: Option<Vec<ImageContextData>>,
    #[serde(default)]
    pub composer_submission: Option<ComposerSubmissionEnvelope>,
}

pub(crate) fn order_composer_images(
    expected_ids: &[String],
    image_contexts: Option<Vec<ImageContextData>>,
) -> Result<Option<Vec<ImageContextData>>, String> {
    let mut images_by_id = image_contexts
        .unwrap_or_default()
        .into_iter()
        .map(|image| (image.id.clone(), image))
        .collect::<std::collections::HashMap<_, _>>();

    let mut ordered = Vec::with_capacity(expected_ids.len());
    for id in expected_ids {
        let image = images_by_id.remove(id).ok_or_else(|| {
            format!(
                "Composer image attachment is missing its image payload: {}",
                id
            )
        })?;
        ordered.push(image);
    }
    if let Some((id, _)) = images_by_id.into_iter().next() {
        return Err(format!(
            "Image payload does not belong to the Composer submission: {}",
            id
        ));
    }

    Ok((!ordered.is_empty()).then_some(ordered))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SettingsFlowTurnContext {
    #[serde(default)]
    expected_revision: Option<u64>,
    #[serde(default)]
    dirty_setting_ids: Vec<String>,
}

fn settings_flow_turn_context(
    metadata: Option<&serde_json::Value>,
) -> Result<SettingsFlowTurnContext, String> {
    let Some(context) = metadata.and_then(|value| value.get("settingsContext")) else {
        return Ok(SettingsFlowTurnContext::default());
    };
    serde_json::from_value(context.clone())
        .map_err(|error| format!("Invalid settingsContext metadata: {}", error))
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DialogTriggerSourceDto {
    DesktopUi,
    DesktopApi,
    AgentSession,
    Goal,
    WorkMessage,
    ScheduledJob,
    RemoteRelay,
    Bot,
    Cli,
}

impl From<DialogTriggerSourceDto> for DialogTriggerSource {
    fn from(value: DialogTriggerSourceDto) -> Self {
        match value {
            DialogTriggerSourceDto::DesktopUi => DialogTriggerSource::DesktopUi,
            DialogTriggerSourceDto::DesktopApi => DialogTriggerSource::DesktopApi,
            DialogTriggerSourceDto::AgentSession => DialogTriggerSource::AgentSession,
            DialogTriggerSourceDto::Goal => DialogTriggerSource::Goal,
            DialogTriggerSourceDto::WorkMessage => DialogTriggerSource::WorkMessage,
            DialogTriggerSourceDto::ScheduledJob => DialogTriggerSource::ScheduledJob,
            DialogTriggerSourceDto::RemoteRelay => DialogTriggerSource::RemoteRelay,
            DialogTriggerSourceDto::Bot => DialogTriggerSource::Bot,
            DialogTriggerSourceDto::Cli => DialogTriggerSource::Cli,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDialogTurnResponse {
    pub success: bool,
    pub message: String,
    pub status: String,
    pub turn_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedDialogTurnsRequest {
    pub session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedDialogTurnsResponse {
    pub session_id: String,
    pub items: Vec<DialogQueuedTurnSnapshot>,
    pub pause: Option<DialogQueuePauseSnapshot>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateQueuedDialogTurnRequest {
    pub session_id: String,
    pub turn_id: String,
    pub user_input: String,
    #[serde(default)]
    pub original_user_input: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteQueuedDialogTurnRequest {
    pub session_id: String,
    pub turn_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideQueuedDialogTurnRequest {
    pub session_id: String,
    pub turn_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeQueuedDialogTurnsResponse {
    pub started_turn_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactSessionRequest {
    pub locator: SessionLocator,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureCoordinatorSessionRequest {
    pub locator: SessionLocator,
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
pub struct CancelSessionRequest {
    pub session_id: String,
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
    pub locator: SessionLocator,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSessionRequest {
    pub locator: SessionLocator,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsRequest {
    pub domain: SessionDomain,
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
    request: CreateSessionRequest,
) -> Result<CreateSessionResponse, String> {
    let mut config = SessionConfig::new(request.domain);
    config.workspace_path = request
        .workspace_path
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty());
    if let Some(c) = request.config {
        config.context_policy = c
            .context_policy
            .map(SessionContextPolicyDTO::into_core)
            .transpose()?
            .unwrap_or_default();
        config.auto_compact = c.auto_compact.unwrap_or(true);
        config.enable_tools = c.enable_tools.unwrap_or(true);
        config.safe_mode = c.safe_mode.unwrap_or(true);
        config.max_turns = c.max_turns.unwrap_or(200);
        config.enable_context_compression = c.enable_context_compression.unwrap_or(true);
        config.compression_threshold = c.compression_threshold.unwrap_or(0.8);
        config.model_id = c.model_name;
    }

    let session = coordinator
        .create_session_with_id(
            request.session_id,
            request.session_name.clone(),
            request.agent_type.clone(),
            config,
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
    request: UpdateSessionTitleRequest,
) -> Result<String, String> {
    let session_id = request.locator.session_id.trim();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }

    if coordinator
        .get_session_manager()
        .get_session(session_id)
        .is_none()
    {
        coordinator
            .restore_session(&request.locator)
            .await
            .map_err(|e| format!("Failed to restore session before renaming: {}", e))?;
    }

    coordinator
        .update_session_title(session_id, &request.title)
        .await
        .map_err(|e| format!("Failed to update session title: {}", e))
}

#[tauri::command]
pub async fn update_session_workspace(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: UpdateSessionWorkspaceRequest,
) -> Result<(), String> {
    let session_id = request.session_id.trim();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }

    let workspace_path = request.workspace_path.trim();
    if workspace_path.is_empty() {
        return Err("workspace_path is required".to_string());
    }

    coordinator
        .update_session_workspace_path(session_id, workspace_path)
        .await
        .map_err(|e| format!("Failed to update session workspace: {}", e))
}

/// Load the session into the coordinator process when it exists on disk but is not in memory.
/// Uses the same remote→local session path mapping as `restore_session`.
#[tauri::command]
pub async fn ensure_coordinator_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: EnsureCoordinatorSessionRequest,
) -> Result<(), String> {
    let session_id = request.locator.session_id.trim();
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

    coordinator
        .restore_session(&request.locator)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_dialog_turn(
    _app: AppHandle,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
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
        trigger_source,
        user_message_metadata,
        persist_agent_type,
        image_contexts,
        composer_submission,
    } = request;

    let (user_input, image_contexts) = if let Some(submission) = composer_submission.as_ref() {
        let compiled =
            compile_composer_submission(submission).map_err(|error| error.to_string())?;
        let ordered_images = order_composer_images(&compiled.image_attachment_ids, image_contexts)?;
        (compiled.user_input, ordered_images)
    } else {
        (user_input, image_contexts)
    };

    if coordinator
        .is_active_settings_agent_session(&session_id)
        .await
    {
        if agent_type != SettingsAgent::ID {
            return Err(published_settings_agent_error(&"settings.request_invalid"));
        }
        if system_reminder_override.is_some()
            || image_contexts
                .as_ref()
                .is_some_and(|images| !images.is_empty())
        {
            return Err(published_settings_agent_error(&"settings.request_invalid"));
        }
        if sparo_core::command::settings_agent::contains_sensitive_credential(&user_input) {
            return Err(published_settings_agent_error(
                &"settings.secure_input_required",
            ));
        }
        let settings_context = settings_flow_turn_context(user_message_metadata.as_ref())
            .map_err(|_| published_settings_agent_error(&"settings.request_invalid"))?;
        if settings_context.dirty_setting_ids.len() > 4096
            || settings_context
                .dirty_setting_ids
                .iter()
                .any(|setting_id| setting_id.trim().is_empty() || setting_id.len() > 256)
        {
            return Err(published_settings_agent_error(&"settings.request_invalid"));
        }
        let handle = coordinator
            .start_settings_agent_turn_in_session(
                &session_id,
                turn_id.as_deref(),
                &user_input,
                settings_context.expected_revision,
                settings_context.dirty_setting_ids,
            )
            .await
            .map_err(|error| published_settings_agent_error(&error))?;
        return Ok(StartDialogTurnResponse {
            success: true,
            message: "Dialog turn started".to_string(),
            status: "started".to_string(),
            turn_id: handle.turn_id,
        });
    }

    let policy = DialogSubmissionPolicy::for_source(
        trigger_source
            .map(DialogTriggerSource::from)
            .unwrap_or(DialogTriggerSource::DesktopUi),
    )
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

    let outcome = scheduler
        .submit_with_metadata(
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
            user_message_metadata,
        )
        .await
        .map_err(|e| format!("Failed to start dialog turn: {}", e))?;

    let (status, turn_id) = match outcome {
        DialogSubmitOutcome::Started { turn_id, .. } => ("started", turn_id),
        DialogSubmitOutcome::Queued { turn_id, .. } => ("queued", turn_id),
    };

    Ok(StartDialogTurnResponse {
        success: true,
        message: format!("Dialog turn {}", status),
        status: status.to_string(),
        turn_id,
    })
}

#[tauri::command]
pub async fn list_queued_dialog_turns(
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: QueuedDialogTurnsRequest,
) -> Result<QueuedDialogTurnsResponse, String> {
    let session_id = request.session_id.trim();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }

    Ok(QueuedDialogTurnsResponse {
        session_id: session_id.to_string(),
        items: scheduler.list_queue(session_id),
        pause: scheduler.queue_pause(session_id),
    })
}

#[tauri::command]
pub async fn update_queued_dialog_turn(
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: UpdateQueuedDialogTurnRequest,
) -> Result<Option<DialogQueuedTurnSnapshot>, String> {
    let session_id = request.session_id.trim();
    let turn_id = request.turn_id.trim();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }
    if turn_id.is_empty() {
        return Err("turn_id is required".to_string());
    }
    let user_input = request.user_input.trim().to_string();
    if user_input.is_empty() {
        return Err("user_input is required".to_string());
    }

    scheduler
        .update_queued_turn(session_id, turn_id, user_input, request.original_user_input)
        .await
}

#[tauri::command]
pub async fn delete_queued_dialog_turn(
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: DeleteQueuedDialogTurnRequest,
) -> Result<bool, String> {
    let session_id = request.session_id.trim();
    let turn_id = request.turn_id.trim();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }
    if turn_id.is_empty() {
        return Err("turn_id is required".to_string());
    }

    Ok(scheduler.delete_queued_turn(session_id, turn_id).await)
}

#[tauri::command]
pub async fn guide_queued_dialog_turn(
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: GuideQueuedDialogTurnRequest,
) -> Result<Option<DialogGuidedTurnSnapshot>, String> {
    let session_id = request.session_id.trim();
    let turn_id = request.turn_id.trim();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }
    if turn_id.is_empty() {
        return Err("turn_id is required".to_string());
    }

    scheduler.guide_queued_turn(session_id, turn_id).await
}

#[tauri::command]
pub async fn resume_queued_dialog_turns(
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: QueuedDialogTurnsRequest,
) -> Result<ResumeQueuedDialogTurnsResponse, String> {
    let session_id = request.session_id.trim();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }

    let started_turn_id = scheduler.resume_queue(session_id).await?;
    Ok(ResumeQueuedDialogTurnsResponse { started_turn_id })
}

#[tauri::command]
pub async fn compact_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: CompactSessionRequest,
) -> Result<StartDialogTurnResponse, String> {
    let session_id = request.locator.session_id.trim();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }

    if coordinator
        .get_session_manager()
        .get_session(session_id)
        .is_none()
    {
        coordinator
            .restore_session(&request.locator)
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
        status: "started".to_string(),
        turn_id: String::new(),
    })
}

fn is_blank_text(value: Option<&String>) -> bool {
    value.map(|s| s.trim().is_empty()).unwrap_or(true)
}

pub(crate) fn resolve_missing_image_payloads(
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
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: CancelDialogTurnRequest,
) -> Result<(), String> {
    scheduler
        .cancel_dialog_turn(
            &request.session_id,
            &request.dialog_turn_id,
            TurnCancellationReason::UserRequested,
            SessionControlActor::User,
        )
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
pub async fn cancel_session(
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: CancelSessionRequest,
) -> Result<(), String> {
    let session_id = request.session_id.trim();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }

    let Some(session) = scheduler.session_manager().get_session(session_id) else {
        return Ok(());
    };

    let SessionState::Processing {
        current_turn_id, ..
    } = session.state
    else {
        return Ok(());
    };

    scheduler
        .cancel_dialog_turn(
            session_id,
            &current_turn_id,
            TurnCancellationReason::UserRequested,
            SessionControlActor::User,
        )
        .await
        .map_err(|e| {
            log::error!(
                "Failed to cancel active session turn: session_id={}, dialog_turn_id={}, error={}",
                session_id,
                current_turn_id,
                e
            );
            format!("Failed to cancel active session turn: {}", e)
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
    request: DeleteSessionRequest,
) -> Result<(), String> {
    coordinator
        .delete_session(&request.locator)
        .await
        .map_err(|e| format!("Failed to delete session: {}", e))
}

#[tauri::command]
pub async fn restore_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: RestoreSessionRequest,
) -> Result<SessionResponse, String> {
    let session = coordinator
        .restore_session(&request.locator)
        .await
        .map_err(|e| format!("Failed to restore session: {}", e))?;

    Ok(session_to_response(session))
}

#[tauri::command]
pub async fn list_sessions(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: ListSessionsRequest,
) -> Result<Vec<SessionResponse>, String> {
    let summaries = coordinator
        .list_sessions(&request.domain)
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
    let is_settings_session = coordinator
        .is_active_settings_agent_session(&request.session_id)
        .await;
    if is_settings_session && request.updated_input.is_some() {
        return Err(published_settings_agent_error(&"settings.request_invalid"));
    }
    coordinator
        .confirm_tool_for_session(&request.session_id, &request.tool_id, request.updated_input)
        .await
        .map_err(|error| {
            if is_settings_session {
                published_settings_agent_error(&error)
            } else {
                format!("Confirm tool failed: {}", error)
            }
        })
}

#[tauri::command]
pub async fn reject_tool_execution(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: RejectToolRequest,
) -> Result<(), String> {
    let is_settings_session = coordinator
        .is_active_settings_agent_session(&request.session_id)
        .await;
    let reason = if is_settings_session {
        "Settings change rejected by user".to_string()
    } else {
        request
            .reason
            .unwrap_or_else(|| "User rejected".to_string())
    };

    coordinator
        .reject_tool_for_session(&request.session_id, &request.tool_id, reason)
        .await
        .map_err(|error| {
            if is_settings_session {
                published_settings_agent_error(&error)
            } else {
                format!("Reject tool failed: {}", error)
            }
        })
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
    let agent_infos = state
        .agent_registry
        .list_agents_info()
        .await
        .map_err(|error| format!("Failed to read agent capability configuration: {error}"))?;

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

#[cfg(test)]
mod settings_flow_tests {
    use super::{
        published_settings_agent_error, settings_flow_turn_context, SessionContextPolicyDTO,
    };
    use serde_json::json;
    use sparo_core::agentic::core::SessionContextPolicy;

    #[test]
    fn settings_context_uses_only_revision_and_dirty_setting_ids() {
        let metadata = json!({
            "settingsContext": {
                "expectedRevision": 8,
                "dirtySettingIds": ["core.font.ui_size.level"]
            },
            "unrelated": "generic message metadata"
        });
        let context = settings_flow_turn_context(Some(&metadata)).expect("valid context");
        assert_eq!(context.expected_revision, Some(8));
        assert_eq!(
            context.dirty_setting_ids,
            vec!["core.font.ui_size.level".to_string()]
        );
    }

    #[test]
    fn settings_context_rejects_client_owned_capabilities() {
        let metadata = json!({
            "settingsContext": {
                "expectedRevision": 8,
                "dirtySettingIds": [],
                "modelId": "untrusted-model"
            }
        });
        assert!(settings_flow_turn_context(Some(&metadata)).is_err());
    }

    #[test]
    fn settings_flow_error_boundary_never_publishes_internal_details() {
        let published = published_settings_agent_error(
            &"execution failed at C:\\private\\settings.json: token=secret",
        );

        assert_eq!(published, "config.operation_failed");
        assert!(!published.contains("private"));
        assert!(!published.contains("secret"));
        assert_eq!(
            published_settings_agent_error(&"settings.secure_input_required: token=secret"),
            "settings.secure_input_required"
        );
    }

    #[test]
    fn session_context_policy_dto_requires_an_explicit_nonzero_cap() {
        assert_eq!(
            SessionContextPolicyDTO::FollowModel.into_core().unwrap(),
            SessionContextPolicy::FollowModel
        );
        assert_eq!(
            SessionContextPolicyDTO::ExplicitCap { max_tokens: 64_000 }
                .into_core()
                .unwrap(),
            SessionContextPolicy::ExplicitCap { max_tokens: 64_000 }
        );
        assert!(SessionContextPolicyDTO::ExplicitCap { max_tokens: 0 }
            .into_core()
            .is_err());
    }
}
