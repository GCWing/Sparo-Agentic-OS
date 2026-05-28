//! Markdown AI API
//!
//! Ephemeral streaming AI calls for Markdown editing experiences:
//! - No session or dialog turn is created
//! - No persistence writes
//! - Supports streaming output and cancellation by request id

use crate::api::app_state::AppState;
use bitfun_core::agentic::markdown_coauthor::{
    build_proposal_prompt, normalize_proposal, proposal_system_prompt, MarkdownDocumentProfile,
    MarkdownCoauthorPromptRequest,
};
use bitfun_core::util::types::message::Message as AIMessage;
use futures::StreamExt;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownAiResponse {
    pub ok: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownAiCancelRequest {
    pub request_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownAiProposeEditsRequest {
    pub request_id: String,
    pub action_id: String,
    pub scope: String,
    pub intent: String,
    pub file_path: Option<String>,
    pub source_hash: String,
    pub document_markdown: String,
    pub target: Value,
    pub profile: Option<MarkdownDocumentProfile>,
    pub user_directive: Option<String>,
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownAiProposalChunkEvent {
    pub request_id: String,
    pub chunk: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownAiProposalCompletedEvent {
    pub request_id: String,
    pub proposal: Value,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownAiErrorEvent {
    pub request_id: String,
    pub error: String,
}

#[tauri::command]
pub async fn markdown_ai_cancel(
    state: State<'_, AppState>,
    request: MarkdownAiCancelRequest,
) -> Result<(), String> {
    if request.request_id.trim().is_empty() {
        return Err("requestId is required".to_string());
    }

    state
        .side_question_runtime
        .cancel(&request.request_id)
        .await;
    Ok(())
}

#[tauri::command]
pub async fn markdown_ai_propose_edits(
    app: AppHandle,
    state: State<'_, AppState>,
    request: MarkdownAiProposeEditsRequest,
) -> Result<MarkdownAiResponse, String> {
    if request.request_id.trim().is_empty() {
        return Err("requestId is required".to_string());
    }
    if request.action_id.trim().is_empty() {
        return Err("actionId is required".to_string());
    }
    if request.source_hash.trim().is_empty() {
        return Err("sourceHash is required".to_string());
    }
    if request.document_markdown.trim().is_empty() {
        return Err("documentMarkdown is required".to_string());
    }

    let model_id = request
        .model_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("primary")
        .to_string();

    let client = state
        .ai_client_factory
        .get_client_resolved(&model_id)
        .await
        .map_err(|error| format!("Failed to create AI client: {}", error))?;

    let cancel_token = state
        .side_question_runtime
        .register(request.request_id.clone())
        .await;

    let request_id = request.request_id.clone();
    let runtime = state.side_question_runtime.clone();
    let app_handle = app.clone();

    info!(
        "Starting Markdown AI proposal request request_id={} action_id={} scope={} intent={} source_hash={} model_id={}",
        request.request_id,
        request.action_id,
        request.scope,
        request.intent,
        request.source_hash,
        model_id
    );
    if request.action_id == "rewrite_selection" {
        let selected_markdown_chars = request
            .target
            .get("markdown")
            .and_then(|value| value.as_str())
            .map(|value| value.chars().count())
            .unwrap_or(0);
        let target_from = request
            .target
            .get("from")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let target_to = request
            .target
            .get("to")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        info!(
            "Markdown AI selection rewrite payload request_id={} selected_markdown_chars={} target_from={} target_to={}",
            request.request_id,
            selected_markdown_chars,
            target_from,
            target_to
        );
    }

    tokio::spawn(async move {
        let core_request = MarkdownCoauthorPromptRequest {
            request_id: request.request_id.clone(),
            action_id: request.action_id.clone(),
            scope: request.scope.clone(),
            intent: request.intent.clone(),
            file_path: request.file_path.clone(),
            source_hash: request.source_hash.clone(),
            document_markdown: request.document_markdown.clone(),
            target: request.target.clone(),
            profile: request.profile.clone(),
            user_directive: request.user_directive.clone(),
            model_id: request.model_id.clone(),
        };

        let prompt = match build_proposal_prompt(&core_request) {
            Ok(prompt) => prompt,
            Err(error) => {
                runtime.remove(&request_id).await;
                let payload = MarkdownAiErrorEvent { request_id, error };
                if let Err(emit_error) = app_handle.emit("markdown-ai://error", payload) {
                    warn!("Failed to emit Markdown AI error: {}", emit_error);
                }
                return;
            }
        };

        let messages = vec![
            AIMessage::system(proposal_system_prompt().to_string()),
            AIMessage::user(prompt),
        ];

        let mut full_text = String::new();
        let mut last_finish_reason: Option<String> = None;
        let mut emitted_text_chunks: usize = 0;
        let mut emitted_text_chars: usize = 0;

        let mut stream = match client.send_message_stream(messages, None).await {
            Ok(response) => response.stream,
            Err(error) => {
                runtime.remove(&request_id).await;
                let payload = MarkdownAiErrorEvent {
                    request_id,
                    error: format!("AI call failed: {}", error),
                };
                if let Err(emit_error) = app_handle.emit("markdown-ai://error", payload) {
                    warn!("Failed to emit Markdown AI error: {}", emit_error);
                }
                return;
            }
        };

        while let Some(chunk_result) = stream.next().await {
            if cancel_token.is_cancelled() {
                runtime.remove(&request_id).await;
                return;
            }

            match chunk_result {
                Ok(chunk) => {
                    if let Some(reason) = chunk.finish_reason.clone() {
                        last_finish_reason = Some(reason);
                    }
                    if let Some(text) = chunk.text {
                        if text.is_empty() {
                            continue;
                        }
                        emitted_text_chunks += 1;
                        let chunk_chars = text.chars().count();
                        emitted_text_chars += chunk_chars;
                        full_text.push_str(&text);
                        debug!(
                            "Emitting Markdown AI proposal text chunk request_id={} action_id={} chunk_index={} chunk_chars={} emitted_text_chars={}",
                            request_id,
                            core_request.action_id,
                            emitted_text_chunks,
                            chunk_chars,
                            emitted_text_chars
                        );
                        let payload = MarkdownAiProposalChunkEvent {
                            request_id: request_id.clone(),
                            chunk: serde_json::json!({ "type": "text", "text": text }),
                        };
                        if let Err(error) = app_handle.emit("markdown-ai://proposal-chunk", payload) {
                            warn!("Failed to emit Markdown AI proposal chunk: {}", error);
                        }
                    }
                }
                Err(error) => {
                    runtime.remove(&request_id).await;
                    let payload = MarkdownAiErrorEvent {
                        request_id,
                        error: format!("Stream error: {}", error),
                    };
                    if let Err(emit_error) = app_handle.emit("markdown-ai://error", payload) {
                        warn!("Failed to emit Markdown AI error: {}", emit_error);
                    }
                    return;
                }
            }
        }

        runtime.remove(&request_id).await;

        if cancel_token.is_cancelled() {
            return;
        }

        let proposal = normalize_proposal(&core_request, &full_text, last_finish_reason.clone());
        let op_count = proposal
            .get("ops")
            .and_then(Value::as_array)
            .map(|ops| ops.len())
            .unwrap_or(0);
        info!(
            "Completed Markdown AI proposal request request_id={} action_id={} scope={} intent={} source_hash={} model_id={} op_count={} text_chunk_count={} full_text_chars={}",
            request_id,
            request.action_id,
            request.scope,
            request.intent,
            request.source_hash,
            model_id,
            op_count,
            emitted_text_chunks,
            full_text.chars().count()
        );
        let payload = MarkdownAiProposalCompletedEvent {
            request_id,
            proposal,
            finish_reason: last_finish_reason,
        };
        if let Err(error) = app_handle.emit("markdown-ai://proposal-completed", payload) {
            warn!("Failed to emit Markdown AI proposal completion: {}", error);
        }
    });

    Ok(MarkdownAiResponse { ok: true })
}
