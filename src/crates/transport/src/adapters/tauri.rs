//! Tauri transport adapter
//!
//! Uses Tauri's app.emit() system to send events to frontend

#[cfg(feature = "tauri-adapter")]
use crate::traits::{TextChunk, ToolEventPayload, TransportAdapter};
#[cfg(feature = "tauri-adapter")]
use async_trait::async_trait;
#[cfg(feature = "tauri-adapter")]
use log::warn;
#[cfg(feature = "tauri-adapter")]
use serde_json::json;
#[cfg(feature = "tauri-adapter")]
use sparo_events::agentic::SessionSurfaceMode;
#[cfg(feature = "tauri-adapter")]
use sparo_events::AgenticEvent;
#[cfg(feature = "tauri-adapter")]
use std::fmt;

#[cfg(feature = "tauri-adapter")]
use tauri::{AppHandle, Emitter};

/// Tauri transport adapter
#[cfg(feature = "tauri-adapter")]
pub struct TauriTransportAdapter {
    app_handle: AppHandle,
}

#[cfg(feature = "tauri-adapter")]
impl TauriTransportAdapter {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    fn should_emit_timeline_event(surface_mode: SessionSurfaceMode) -> bool {
        !matches!(surface_mode, SessionSurfaceMode::InternalBackground)
    }
}

#[cfg(feature = "tauri-adapter")]
impl fmt::Debug for TauriTransportAdapter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TauriTransportAdapter")
            .field("adapter_type", &"tauri")
            .finish()
    }
}

#[cfg(feature = "tauri-adapter")]
#[async_trait]
impl TransportAdapter for TauriTransportAdapter {
    async fn emit_event(&self, _session_id: &str, event: AgenticEvent) -> anyhow::Result<()> {
        match event {
            AgenticEvent::SessionCreated {
                session_id,
                session_name,
                agent_type,
                workspace_path,
            } => {
                self.app_handle.emit(
                    "agentic://session-created",
                    json!({
                        "sessionId": session_id,
                        "sessionName": session_name,
                        "agentType": agent_type,
                        "workspacePath": workspace_path,
                    }),
                )?;
            }
            AgenticEvent::SessionDeleted { session_id } => {
                self.app_handle.emit(
                    "agentic://session-deleted",
                    json!({
                        "sessionId": session_id,
                    }),
                )?;
            }
            AgenticEvent::ImageAnalysisStarted {
                session_id,
                image_count,
                user_input,
                image_metadata,
            } => {
                self.app_handle.emit(
                    "agentic://image-analysis-started",
                    json!({
                        "sessionId": session_id,
                        "imageCount": image_count,
                        "userInput": user_input,
                        "imageMetadata": image_metadata,
                    }),
                )?;
            }
            AgenticEvent::ImageAnalysisCompleted {
                session_id,
                success,
                duration_ms,
            } => {
                self.app_handle.emit(
                    "agentic://image-analysis-completed",
                    json!({
                        "sessionId": session_id,
                        "success": success,
                        "durationMs": duration_ms,
                    }),
                )?;
            }
            AgenticEvent::DialogTurnStarted {
                session_id,
                turn_id,
                turn_index,
                user_input,
                original_user_input,
                user_message_metadata,
                surface_mode,
                subagent_parent_info,
            } => {
                if !Self::should_emit_timeline_event(surface_mode) {
                    return Ok(());
                }
                self.app_handle.emit(
                    "agentic://dialog-turn-started",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "turnIndex": turn_index,
                        "userInput": user_input,
                        "originalUserInput": original_user_input,
                        "userMessageMetadata": user_message_metadata,
                        "surfaceMode": surface_mode,
                        "subagentParentInfo": subagent_parent_info,
                    }),
                )?;
            }
            AgenticEvent::ModelRoundStarted {
                session_id,
                turn_id,
                round_id,
                surface_mode,
                ..
            } => {
                if !Self::should_emit_timeline_event(surface_mode) {
                    return Ok(());
                }
                self.app_handle.emit(
                    "agentic://model-round-started",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "roundId": round_id,
                        "surfaceMode": surface_mode,
                    }),
                )?;
            }
            AgenticEvent::TextChunk {
                session_id,
                turn_id,
                round_id,
                text,
                surface_mode,
                subagent_parent_info,
            } => {
                if !Self::should_emit_timeline_event(surface_mode) {
                    return Ok(());
                }
                self.app_handle.emit(
                    "agentic://text-chunk",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "roundId": round_id,
                        "text": text,
                        "surfaceMode": surface_mode,
                        "subagentParentInfo": subagent_parent_info,
                    }),
                )?;
            }
            AgenticEvent::ThinkingChunk {
                session_id,
                turn_id,
                round_id,
                content,
                is_end,
                surface_mode,
                subagent_parent_info,
            } => {
                if !Self::should_emit_timeline_event(surface_mode) {
                    return Ok(());
                }
                self.app_handle.emit(
                    "agentic://text-chunk",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "roundId": round_id,
                        "text": content,
                        "contentType": "thinking",
                        "isThinkingEnd": is_end,
                        "surfaceMode": surface_mode,
                        "subagentParentInfo": subagent_parent_info,
                    }),
                )?;
            }
            AgenticEvent::ToolEvent {
                session_id,
                turn_id,
                tool_event,
                surface_mode,
                subagent_parent_info,
            } => {
                if !Self::should_emit_timeline_event(surface_mode) {
                    return Ok(());
                }
                self.app_handle.emit(
                    "agentic://tool-event",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "toolEvent": tool_event,
                        "surfaceMode": surface_mode,
                        "subagentParentInfo": subagent_parent_info,
                    }),
                )?;
            }
            AgenticEvent::DialogTurnCompleted {
                session_id,
                turn_id,
                hidden_session,
                surface_mode,
                subagent_parent_info,
                ..
            } => {
                if !Self::should_emit_timeline_event(surface_mode) {
                    return Ok(());
                }
                self.app_handle.emit(
                    "agentic://dialog-turn-completed",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "hiddenSession": hidden_session,
                        "surfaceMode": surface_mode,
                        "subagentParentInfo": subagent_parent_info,
                    }),
                )?;
            }
            AgenticEvent::SessionTitleGenerated {
                session_id,
                title,
                method,
            } => {
                self.app_handle.emit(
                    "session_title_generated",
                    json!({
                        "sessionId": session_id,
                        "title": title,
                        "method": method,
                        "timestamp": chrono::Utc::now().timestamp_millis(),
                    }),
                )?;
            }
            AgenticEvent::DialogTurnCancelled {
                session_id,
                turn_id,
                surface_mode,
                subagent_parent_info,
            } => {
                if !Self::should_emit_timeline_event(surface_mode) {
                    return Ok(());
                }
                self.app_handle.emit(
                    "agentic://dialog-turn-cancelled",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "surfaceMode": surface_mode,
                        "subagentParentInfo": subagent_parent_info,
                    }),
                )?;
            }
            AgenticEvent::DialogTurnFailed {
                session_id,
                turn_id,
                error,
                surface_mode,
                subagent_parent_info,
            } => {
                if !Self::should_emit_timeline_event(surface_mode) {
                    return Ok(());
                }
                self.app_handle.emit(
                    "agentic://dialog-turn-failed",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "error": error,
                        "surfaceMode": surface_mode,
                        "subagentParentInfo": subagent_parent_info,
                    }),
                )?;
            }
            AgenticEvent::DialogTurnQueued {
                session_id,
                turn_id,
                user_input,
                original_user_input,
                agent_type,
                queue_priority,
                queue_depth,
                enqueued_at_ms,
                has_images,
                image_count,
            } => {
                self.app_handle.emit(
                    "agentic://dialog-turn-queued",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "userInput": user_input,
                        "originalUserInput": original_user_input,
                        "agentType": agent_type,
                        "queuePriority": queue_priority,
                        "queueDepth": queue_depth,
                        "enqueuedAtMs": enqueued_at_ms,
                        "hasImages": has_images,
                        "imageCount": image_count,
                    }),
                )?;
            }
            AgenticEvent::DialogTurnQueueUpdated {
                session_id,
                turn_id,
                user_input,
                original_user_input,
                queue_depth,
                updated_at_ms,
            } => {
                self.app_handle.emit(
                    "agentic://dialog-turn-queue-updated",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "userInput": user_input,
                        "originalUserInput": original_user_input,
                        "queueDepth": queue_depth,
                        "updatedAtMs": updated_at_ms,
                    }),
                )?;
            }
            AgenticEvent::DialogTurnQueueDeleted {
                session_id,
                turn_id,
                queue_depth,
            } => {
                self.app_handle.emit(
                    "agentic://dialog-turn-queue-deleted",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "queueDepth": queue_depth,
                    }),
                )?;
            }
            AgenticEvent::DialogTurnQueueDispatching {
                session_id,
                turn_id,
                queue_depth,
            } => {
                self.app_handle.emit(
                    "agentic://dialog-turn-queue-dispatching",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "queueDepth": queue_depth,
                    }),
                )?;
            }
            AgenticEvent::DialogTurnQueuePaused {
                session_id,
                reason,
                turn_id,
                error,
                queue_depth,
            } => {
                self.app_handle.emit(
                    "agentic://dialog-turn-queue-paused",
                    json!({
                        "sessionId": session_id,
                        "reason": reason,
                        "turnId": turn_id,
                        "error": error,
                        "queueDepth": queue_depth,
                    }),
                )?;
            }
            AgenticEvent::DialogTurnQueueResumed {
                session_id,
                queue_depth,
            } => {
                self.app_handle.emit(
                    "agentic://dialog-turn-queue-resumed",
                    json!({
                        "sessionId": session_id,
                        "queueDepth": queue_depth,
                    }),
                )?;
            }
            AgenticEvent::DialogTurnGuidanceRequested {
                session_id,
                turn_id,
                guidance_id,
                source_turn_id,
                user_input,
                original_user_input,
                queue_depth,
                received_at_ms,
                has_images,
                image_count,
            } => {
                self.app_handle.emit(
                    "agentic://dialog-turn-guidance-requested",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "guidanceId": guidance_id,
                        "sourceTurnId": source_turn_id,
                        "userInput": user_input,
                        "originalUserInput": original_user_input,
                        "queueDepth": queue_depth,
                        "receivedAtMs": received_at_ms,
                        "hasImages": has_images,
                        "imageCount": image_count,
                    }),
                )?;
            }
            AgenticEvent::DialogTurnGuidanceApplied {
                session_id,
                turn_id,
                guidance_id,
                source_turn_id,
                applied_at_ms,
            } => {
                self.app_handle.emit(
                    "agentic://dialog-turn-guidance-applied",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "guidanceId": guidance_id,
                        "sourceTurnId": source_turn_id,
                        "appliedAtMs": applied_at_ms,
                    }),
                )?;
            }
            AgenticEvent::DialogTurnGuidanceFailed {
                session_id,
                turn_id,
                guidance_id,
                source_turn_id,
                error,
            } => {
                self.app_handle.emit(
                    "agentic://dialog-turn-guidance-failed",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "guidanceId": guidance_id,
                        "sourceTurnId": source_turn_id,
                        "error": error,
                    }),
                )?;
            }
            AgenticEvent::TokenUsageUpdated {
                session_id,
                turn_id,
                round_id,
                snapshot_id,
                model_id,
                provider,
                agent_type,
                input_tokens,
                output_tokens,
                total_tokens,
                cached_tokens,
                reasoning_tokens,
                max_context_tokens,
                is_subagent,
            } => {
                self.app_handle.emit(
                    "agentic://token-usage-updated",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "roundId": round_id,
                        "snapshotId": snapshot_id,
                        "modelId": model_id,
                        "provider": provider,
                        "agentType": agent_type,
                        "inputTokens": input_tokens,
                        "outputTokens": output_tokens,
                        "totalTokens": total_tokens,
                        "cachedTokens": cached_tokens,
                        "reasoningTokens": reasoning_tokens,
                        "maxContextTokens": max_context_tokens,
                        "isSubagent": is_subagent,
                    }),
                )?;
            }
            AgenticEvent::ContextBudgetUpdated {
                session_id,
                turn_id,
                round_id,
                snapshot,
            } => {
                self.app_handle.emit(
                    "agentic://context-budget-updated",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "roundId": round_id,
                        "snapshot": snapshot,
                    }),
                )?;
            }
            AgenticEvent::ContextCompressionStarted {
                session_id,
                turn_id,
                subagent_parent_info,
                compression_id,
                trigger,
                tokens_before,
                context_window,
                threshold,
                surface_mode,
            } => {
                if !Self::should_emit_timeline_event(surface_mode) {
                    return Ok(());
                }
                self.app_handle.emit(
                    "agentic://context-compression-started",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "compressionId": compression_id,
                        "trigger": trigger,
                        "tokensBefore": tokens_before,
                        "contextWindow": context_window,
                        "threshold": threshold,
                        "surfaceMode": surface_mode,
                        "subagentParentInfo": subagent_parent_info,
                    }),
                )?;
            }
            AgenticEvent::ContextCompressionCompleted {
                session_id,
                turn_id,
                subagent_parent_info,
                compression_id,
                compression_count,
                tokens_before,
                tokens_after,
                compression_ratio,
                duration_ms,
                has_summary,
                summary_source,
                surface_mode,
            } => {
                if !Self::should_emit_timeline_event(surface_mode) {
                    return Ok(());
                }
                self.app_handle.emit(
                    "agentic://context-compression-completed",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "compressionId": compression_id,
                        "compressionCount": compression_count,
                        "tokensBefore": tokens_before,
                        "tokensAfter": tokens_after,
                        "compressionRatio": compression_ratio,
                        "durationMs": duration_ms,
                        "hasSummary": has_summary,
                        "summarySource": summary_source,
                        "surfaceMode": surface_mode,
                        "subagentParentInfo": subagent_parent_info,
                    }),
                )?;
            }
            AgenticEvent::ContextCompressionFailed {
                session_id,
                turn_id,
                subagent_parent_info,
                compression_id,
                error,
                surface_mode,
            } => {
                if !Self::should_emit_timeline_event(surface_mode) {
                    return Ok(());
                }
                self.app_handle.emit(
                    "agentic://context-compression-failed",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "compressionId": compression_id,
                        "error": error,
                        "surfaceMode": surface_mode,
                        "subagentParentInfo": subagent_parent_info,
                    }),
                )?;
            }
            AgenticEvent::SessionStateChanged {
                session_id,
                new_state,
            } => {
                self.app_handle.emit(
                    "agentic://session-state-changed",
                    json!({
                        "sessionId": session_id,
                        "newState": new_state,
                    }),
                )?;
            }
            AgenticEvent::SessionModelAutoMigrated {
                session_id,
                previous_model_id,
                new_model_id,
                reason,
            } => {
                self.app_handle.emit(
                    "agentic://session-model-auto-migrated",
                    json!({
                        "sessionId": session_id,
                        "previousModelId": previous_model_id,
                        "newModelId": new_model_id,
                        "reason": reason,
                    }),
                )?;
            }
            AgenticEvent::ModelRoundCompleted {
                session_id,
                turn_id,
                round_id,
                has_tool_calls,
                surface_mode,
                subagent_parent_info,
            } => {
                if !Self::should_emit_timeline_event(surface_mode) {
                    return Ok(());
                }
                self.app_handle.emit(
                    "agentic://model-round-completed",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "roundId": round_id,
                        "hasToolCalls": has_tool_calls,
                        "surfaceMode": surface_mode,
                        "subagentParentInfo": subagent_parent_info,
                    }),
                )?;
            }
            _ => {
                warn!("Unhandled AgenticEvent type in TauriAdapter");
            }
        }
        Ok(())
    }

    async fn emit_text_chunk(&self, _session_id: &str, chunk: TextChunk) -> anyhow::Result<()> {
        self.app_handle.emit(
            "agentic://text-chunk",
            json!({
                "sessionId": chunk.session_id,
                "turnId": chunk.turn_id,
                "roundId": chunk.round_id,
                "text": chunk.text,
                "timestamp": chunk.timestamp,
            }),
        )?;
        Ok(())
    }

    async fn emit_tool_event(
        &self,
        _session_id: &str,
        event: ToolEventPayload,
    ) -> anyhow::Result<()> {
        self.app_handle.emit(
            "agentic://tool-event",
            json!({
                "sessionId": event.session_id,
                "turnId": event.turn_id,
                "toolEvent": {
                    "tool_id": event.tool_id,
                    "tool_name": event.tool_name,
                    "event_type": event.event_type,
                    "params": event.params,
                    "result": event.result,
                    "error": event.error,
                    "duration_ms": event.duration_ms,
                }
            }),
        )?;
        Ok(())
    }

    async fn emit_stream_start(
        &self,
        session_id: &str,
        turn_id: &str,
        round_id: &str,
    ) -> anyhow::Result<()> {
        self.app_handle.emit(
            "agentic://stream-start",
            json!({
                "sessionId": session_id,
                "turnId": turn_id,
                "roundId": round_id,
            }),
        )?;
        Ok(())
    }

    async fn emit_stream_end(
        &self,
        session_id: &str,
        turn_id: &str,
        round_id: &str,
    ) -> anyhow::Result<()> {
        self.app_handle.emit(
            "agentic://stream-end",
            json!({
                "sessionId": session_id,
                "turnId": turn_id,
                "roundId": round_id,
            }),
        )?;
        Ok(())
    }

    async fn emit_generic(
        &self,
        event_name: &str,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        self.app_handle.emit(event_name, payload)?;
        Ok(())
    }

    fn adapter_type(&self) -> &str {
        "tauri"
    }
}
