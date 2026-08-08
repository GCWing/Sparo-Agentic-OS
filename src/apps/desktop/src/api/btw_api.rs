//! BTW (side question) API
//!
//! Desktop adapter for the core `/btw` feature.
//!
//! `/btw` runs as a hidden transient child session that reuses the parent
//! session's full context snapshot while still flowing through the normal
//! agentic event pipeline.

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

use crate::api::agentic_api::{order_composer_images, resolve_missing_image_payloads};
use crate::api::app_state::AppState;

use sparo_core::agentic::coordination::{
    ConversationCoordinator, DialogScheduler, SessionControlActor, TurnCancellationReason,
};
use sparo_core::agentic::image_analysis::ImageContextData;
use sparo_core::agentic::{compile_composer_submission, ComposerSubmissionEnvelope};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BtwAskStreamRequest {
    pub request_id: String,
    pub session_id: String,
    pub question: String,
    pub child_session_id: String,
    pub child_session_name: Option<String>,
    /// Optional model id override. Supports "fast"/"primary" aliases.
    pub model_id: Option<String>,
    #[serde(default)]
    pub composer_submission: Option<ComposerSubmissionEnvelope>,
    #[serde(default)]
    pub image_contexts: Option<Vec<ImageContextData>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BtwAskStreamResponse {
    pub ok: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BtwCancelRequest {
    pub request_id: String,
}

#[tauri::command]
pub async fn btw_cancel(
    state: State<'_, AppState>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: BtwCancelRequest,
) -> Result<(), String> {
    if request.request_id.trim().is_empty() {
        return Err("requestId is required".to_string());
    }

    state
        .side_question_runtime
        .cancel(&request.request_id)
        .await;
    if let Some(active_turn) = state
        .side_question_runtime
        .get_btw_turn(&request.request_id)
        .await
    {
        scheduler
            .cancel_dialog_turn(
                &active_turn.session_id,
                &active_turn.turn_id,
                TurnCancellationReason::UserRequested,
                SessionControlActor::User,
            )
            .await
            .map_err(|e| e.to_string())?;
        state
            .side_question_runtime
            .remove(&request.request_id)
            .await;
    }
    Ok(())
}

#[tauri::command]
pub async fn btw_ask_stream(
    state: State<'_, AppState>,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: BtwAskStreamRequest,
) -> Result<BtwAskStreamResponse, String> {
    if request.request_id.trim().is_empty() {
        return Err("requestId is required".to_string());
    }
    if request.session_id.trim().is_empty() {
        return Err("sessionId is required".to_string());
    }
    if request.question.trim().is_empty() && request.composer_submission.is_none() {
        return Err("question is required".to_string());
    }
    let child_session_id = request.child_session_id.trim();
    if child_session_id.is_empty() {
        return Err("childSessionId is required".to_string());
    }

    let (question, image_contexts) = if let Some(submission) = request.composer_submission.as_ref()
    {
        let compiled =
            compile_composer_submission(submission).map_err(|error| error.to_string())?;
        let images = order_composer_images(&compiled.image_attachment_ids, request.image_contexts)?;
        let images = images.map(resolve_missing_image_payloads).transpose()?;
        (compiled.user_input, images)
    } else {
        (request.question.clone(), request.image_contexts)
    };

    let turn_id = coordinator
        .start_hidden_btw_turn(
            &request.request_id,
            &request.session_id,
            child_session_id,
            request.child_session_name.as_deref(),
            &question,
            request.model_id.as_deref(),
            image_contexts,
        )
        .await
        .map_err(|e| e.to_string())?;

    state
        .side_question_runtime
        .register_btw_turn(
            request.request_id.clone(),
            child_session_id.to_string(),
            turn_id.clone(),
        )
        .await;
    let runtime = state.side_question_runtime.clone();
    let request_id = request.request_id.clone();
    let child_session_id = child_session_id.to_string();
    let turn_id = turn_id;
    let coordinator = coordinator.inner().clone();
    tokio::spawn(async move {
        loop {
            let Some(session) = coordinator
                .get_session_manager()
                .get_session(&child_session_id)
            else {
                runtime.remove(&request_id).await;
                break;
            };

            match session.state {
                sparo_core::agentic::core::SessionState::Processing {
                    current_turn_id, ..
                } if current_turn_id == turn_id => {
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                }
                _ => {
                    runtime.remove(&request_id).await;
                    break;
                }
            }
        }
    });

    Ok(BtwAskStreamResponse { ok: true })
}
