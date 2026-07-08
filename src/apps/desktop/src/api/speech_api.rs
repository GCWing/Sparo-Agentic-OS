//! Local speech input API.

use crate::api::AppState;
use log::warn;
use sparo_core::service::config::DefaultModelsConfig;
use sparo_core::service::{
    SpeechAppendAudioChunkRequest, SpeechAppendAudioChunkResponse, SpeechCancelInputSessionRequest,
    SpeechCancelModelDownloadRequest, SpeechDeleteModelRequest, SpeechDownloadModelRequest,
    SpeechFinishInputSessionRequest, SpeechInputSession, SpeechListModelsResponse,
    SpeechModelProgressEvent, SpeechModelStatus, SpeechStartInputSessionRequest,
    SpeechTranscriptionResult, SpeechVerifyModelRequest, LOCAL_SENSEVOICE_SMALL_INT8_MODEL_REF,
};
use tauri::{AppHandle, Emitter, State};

pub const EVENT_SPEECH_MODEL_PROGRESS: &str = "speech://model-download-progress";
pub const EVENT_SPEECH_MODEL_STATUS_CHANGED: &str = "speech://model-status-changed";

#[tauri::command]
pub async fn speech_list_models(
    state: State<'_, AppState>,
) -> Result<SpeechListModelsResponse, String> {
    state
        .speech_service
        .list_models()
        .await
        .map_err(|e| format!("Failed to list speech models: {}", e))
}

#[tauri::command]
pub async fn speech_download_model(
    state: State<'_, AppState>,
    app: AppHandle,
    request: SpeechDownloadModelRequest,
) -> Result<SpeechModelStatus, String> {
    let app_for_progress = app.clone();
    let status = state
        .speech_service
        .download_model(request, move |event: SpeechModelProgressEvent| {
            if let Err(e) = app_for_progress.emit(EVENT_SPEECH_MODEL_PROGRESS, &event) {
                warn!("Failed to emit speech model progress event: {}", e);
            }
        })
        .await
        .map_err(|e| format!("Failed to download speech model: {}", e))?;

    sync_default_speech_model_after_install(&state).await;
    emit_status(&app, &status);
    Ok(status)
}

#[tauri::command]
pub async fn speech_cancel_model_download(
    state: State<'_, AppState>,
    app: AppHandle,
    request: SpeechCancelModelDownloadRequest,
) -> Result<SpeechModelStatus, String> {
    let status = state
        .speech_service
        .cancel_model_download(request)
        .await
        .map_err(|e| format!("Failed to cancel speech model download: {}", e))?;
    emit_status(&app, &status);
    Ok(status)
}

#[tauri::command]
pub async fn speech_delete_model(
    state: State<'_, AppState>,
    app: AppHandle,
    request: SpeechDeleteModelRequest,
) -> Result<SpeechModelStatus, String> {
    let status = state
        .speech_service
        .delete_model(request)
        .await
        .map_err(|e| format!("Failed to delete speech model: {}", e))?;

    clear_default_speech_model_if_local(&state).await;
    emit_status(&app, &status);
    Ok(status)
}

#[tauri::command]
pub async fn speech_verify_model(
    state: State<'_, AppState>,
    app: AppHandle,
    request: SpeechVerifyModelRequest,
) -> Result<SpeechModelStatus, String> {
    let status = state
        .speech_service
        .verify_model(request)
        .await
        .map_err(|e| format!("Failed to verify speech model: {}", e))?;
    emit_status(&app, &status);
    Ok(status)
}

#[tauri::command]
pub async fn speech_start_input_session(
    state: State<'_, AppState>,
    request: SpeechStartInputSessionRequest,
) -> Result<SpeechInputSession, String> {
    state
        .speech_service
        .start_input_session(request)
        .await
        .map_err(|e| format!("Failed to start speech input session: {}", e))
}

#[tauri::command]
pub async fn speech_append_audio_chunk(
    state: State<'_, AppState>,
    request: SpeechAppendAudioChunkRequest,
) -> Result<SpeechAppendAudioChunkResponse, String> {
    state
        .speech_service
        .append_audio_chunk(request)
        .await
        .map_err(|e| format!("Failed to append speech audio chunk: {}", e))
}

#[tauri::command]
pub async fn speech_finish_input_session(
    state: State<'_, AppState>,
    request: SpeechFinishInputSessionRequest,
) -> Result<SpeechTranscriptionResult, String> {
    state
        .speech_service
        .finish_input_session(request)
        .await
        .map_err(|e| format!("Failed to transcribe speech input: {}", e))
}

#[tauri::command]
pub async fn speech_cancel_input_session(
    state: State<'_, AppState>,
    request: SpeechCancelInputSessionRequest,
) -> Result<(), String> {
    state
        .speech_service
        .cancel_input_session(request)
        .await
        .map_err(|e| format!("Failed to cancel speech input session: {}", e))
}

fn emit_status(app: &AppHandle, status: &SpeechModelStatus) {
    if let Err(e) = app.emit(EVENT_SPEECH_MODEL_STATUS_CHANGED, status) {
        warn!("Failed to emit speech model status event: {}", e);
    }
}

async fn sync_default_speech_model_after_install(state: &State<'_, AppState>) {
    let Ok(mut defaults) = state
        .config_service
        .get_config::<DefaultModelsConfig>(Some("ai.default_models"))
        .await
    else {
        return;
    };

    if defaults.speech_recognition.is_some() {
        return;
    }

    defaults.speech_recognition = Some(LOCAL_SENSEVOICE_SMALL_INT8_MODEL_REF.to_string());
    if let Err(e) = state
        .config_service
        .set_config("ai.default_models", &defaults)
        .await
    {
        warn!("Failed to set default speech recognition model: {}", e);
    }
}

async fn clear_default_speech_model_if_local(state: &State<'_, AppState>) {
    let Ok(mut defaults) = state
        .config_service
        .get_config::<DefaultModelsConfig>(Some("ai.default_models"))
        .await
    else {
        return;
    };

    if defaults.speech_recognition.as_deref() != Some(LOCAL_SENSEVOICE_SMALL_INT8_MODEL_REF) {
        return;
    }

    defaults.speech_recognition = None;
    if let Err(e) = state
        .config_service
        .set_config("ai.default_models", &defaults)
        .await
    {
        warn!("Failed to clear default speech recognition model: {}", e);
    }
}
