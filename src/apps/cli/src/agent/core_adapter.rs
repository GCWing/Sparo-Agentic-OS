//! Core Agent adapter
//!
//! Adapts sparo-core's Agentic system to CLI's Agent interface

use anyhow::Result;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::RwLock;
use tokio::sync::{mpsc, Mutex};

use super::{Agent, AgentEvent, AgentResponse};
use crate::session::{ToolCall, ToolCallStatus};
use sparo_core::agentic::coordination::{
    ConversationCoordinator, DialogSubmissionPolicy, DialogTriggerSource,
};
use sparo_core::agentic::core::SessionConfig;
use sparo_core::agentic::events::EventQueue;
use sparo_events::{AgenticEvent as CoreEvent, ToolEventData};

fn agent_display_name(agent_type: &str, workspace_path: Option<&PathBuf>) -> String {
    let agent_type = agent_type.trim();
    if agent_type.is_empty() {
        return "Runno".to_string();
    }

    sparo_core::agentic::agents::get_agent_registry()
        .get_agent(agent_type, workspace_path.map(|path| path.as_path()))
        .map(|agent| agent.name().to_string())
        .unwrap_or_else(|| agent_type.to_string())
}

/// Core-based Agent implementation
pub struct CoreAgentAdapter {
    agent_type: Arc<RwLock<String>>,
    coordinator: Arc<ConversationCoordinator>,
    event_queue: Arc<EventQueue>,
    workspace_path: Arc<RwLock<Option<PathBuf>>>,
    session_id: Arc<Mutex<Option<String>>>,
}

impl CoreAgentAdapter {
    pub fn new(
        agent_type: String,
        coordinator: Arc<ConversationCoordinator>,
        event_queue: Arc<EventQueue>,
        workspace_path: Option<PathBuf>,
    ) -> Self {
        Self {
            agent_type: Arc::new(RwLock::new(agent_type.clone())),
            coordinator,
            event_queue,
            workspace_path: Arc::new(RwLock::new(workspace_path)),
            session_id: Arc::new(Mutex::new(None)),
        }
    }

    pub fn new_with_session(
        agent_type: String,
        coordinator: Arc<ConversationCoordinator>,
        event_queue: Arc<EventQueue>,
        workspace_path: Option<PathBuf>,
        session_id: Option<String>,
    ) -> Self {
        Self {
            agent_type: Arc::new(RwLock::new(agent_type)),
            coordinator,
            event_queue,
            workspace_path: Arc::new(RwLock::new(workspace_path)),
            session_id: Arc::new(Mutex::new(session_id.filter(|id| !id.trim().is_empty()))),
        }
    }

    fn current_workspace_path(&self) -> Option<PathBuf> {
        self.workspace_path
            .read()
            .ok()
            .and_then(|workspace_path| workspace_path.clone())
    }

    fn current_agent_type(&self) -> String {
        self.agent_type
            .read()
            .map(|agent_type| agent_type.clone())
            .unwrap_or_else(|_| "Runno".to_string())
    }

    async fn ensure_session(&self) -> Result<String> {
        let mut session_id_guard = self.session_id.lock().await;
        if let Some(session_id) = session_id_guard.as_ref() {
            return Ok(session_id.clone());
        }

        let workspace_path = self
            .current_workspace_path()
            .or_else(|| std::env::current_dir().ok())
            .map(|path| path.to_string_lossy().to_string());

        let session = self
            .coordinator
            .create_session(
                format!(
                    "CLI Session - {}",
                    chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
                ),
                self.current_agent_type(),
                SessionConfig {
                    workspace_path,
                    ..Default::default()
                },
            )
            .await?;

        *session_id_guard = Some(session.session_id.clone());
        tracing::info!("Created session: {}", session.session_id);

        Ok(session.session_id)
    }
}

#[async_trait::async_trait]
impl Agent for CoreAgentAdapter {
    async fn process_message(
        &self,
        message: String,
        event_tx: mpsc::UnboundedSender<AgentEvent>,
    ) -> Result<AgentResponse> {
        let session_id = self.ensure_session().await?;
        let agent_type = self.current_agent_type();
        let workspace_path = self.current_workspace_path();
        tracing::info!("Processing message: {}", message);

        let _ = event_tx.send(AgentEvent::Thinking);
        self.coordinator
            .start_dialog_turn(
                session_id.clone(),
                message.clone(),
                None,
                None,
                agent_type,
                None,
                workspace_path.as_ref().map(|p| p.display().to_string()),
                DialogSubmissionPolicy::for_source(DialogTriggerSource::Cli),
                None,
            )
            .await?;

        let mut accumulated_text = String::new();
        let mut tool_map: std::collections::HashMap<String, ToolCall> =
            std::collections::HashMap::new();

        let event_queue = self.event_queue.clone();
        let session_id_clone = session_id.clone();

        loop {
            let events = event_queue.dequeue_batch(10).await;

            if events.is_empty() {
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                continue;
            }

            for envelope in events {
                let event = envelope.event;

                if event.session_id() != Some(&session_id_clone) {
                    continue;
                }

                tracing::debug!("Received event: {:?}", event);

                match event {
                    CoreEvent::TextChunk { text, .. } => {
                        accumulated_text.push_str(&text);
                        let _ = event_tx.send(AgentEvent::TextChunk(text));
                    }

                    CoreEvent::ToolEvent { tool_event, .. } => match tool_event {
                        ToolEventData::EarlyDetected { tool_id, tool_name } => {
                            tool_map.insert(
                                tool_id.clone(),
                                ToolCall {
                                    tool_id: Some(tool_id),
                                    tool_name: tool_name.clone(),
                                    parameters: serde_json::Value::Null,
                                    result: None,
                                    status: ToolCallStatus::EarlyDetected,
                                    progress: None,
                                    progress_message: None,
                                    duration_ms: None,
                                },
                            );
                        }

                        ToolEventData::ParamsPartial {
                            tool_id,
                            tool_name: _,
                            params,
                        } => {
                            if let Some(tool) = tool_map.get_mut(&tool_id) {
                                tool.status = ToolCallStatus::ParamsPartial;
                                tool.progress_message = Some(params);
                            }
                        }

                        ToolEventData::Queued {
                            tool_id,
                            tool_name: _,
                            position,
                        } => {
                            if let Some(tool) = tool_map.get_mut(&tool_id) {
                                tool.status = ToolCallStatus::Queued;
                                tool.progress_message =
                                    Some(format!("Queue position: {}", position));
                            }
                        }

                        ToolEventData::Waiting {
                            tool_id,
                            tool_name: _,
                            dependencies,
                        } => {
                            if let Some(tool) = tool_map.get_mut(&tool_id) {
                                tool.status = ToolCallStatus::Waiting;
                                tool.progress_message =
                                    Some(format!("Waiting for: {:?}", dependencies));
                            }
                        }

                        ToolEventData::Started {
                            tool_id,
                            tool_name,
                            params,
                        } => {
                            tool_map.entry(tool_id.clone()).or_insert_with(|| ToolCall {
                                tool_id: Some(tool_id.clone()),
                                tool_name: tool_name.clone(),
                                parameters: params.clone(),
                                result: None,
                                status: ToolCallStatus::Running,
                                progress: Some(0.0),
                                progress_message: None,
                                duration_ms: None,
                            });

                            let _ = event_tx.send(AgentEvent::ToolCallStart {
                                tool_id,
                                tool_name,
                                parameters: params,
                            });
                        }

                        ToolEventData::Progress {
                            tool_id,
                            tool_name,
                            message,
                            percentage,
                        } => {
                            if let Some(tool) = tool_map.get_mut(&tool_id) {
                                tool.progress = Some(percentage);
                                tool.progress_message = Some(message.clone());
                            }

                            let _ = event_tx.send(AgentEvent::ToolCallProgress {
                                tool_id,
                                tool_name,
                                message,
                            });
                        }

                        ToolEventData::Streaming {
                            tool_id,
                            tool_name: _,
                            chunks_received,
                        } => {
                            if let Some(tool) = tool_map.get_mut(&tool_id) {
                                tool.status = ToolCallStatus::Streaming;
                                tool.progress_message =
                                    Some(format!("Received {} chunks", chunks_received));
                            }
                        }

                        ToolEventData::ConfirmationNeeded {
                            tool_id,
                            tool_name,
                            params,
                        } => {
                            let tool =
                                tool_map.entry(tool_id.clone()).or_insert_with(|| ToolCall {
                                    tool_id: Some(tool_id.clone()),
                                    tool_name: tool_name.clone(),
                                    parameters: params.clone(),
                                    result: None,
                                    status: ToolCallStatus::ConfirmationNeeded,
                                    progress: None,
                                    progress_message: None,
                                    duration_ms: None,
                                });
                            {
                                tool.status = ToolCallStatus::ConfirmationNeeded;
                                tool.parameters = params.clone();
                                tool.progress_message =
                                    Some("Waiting for user confirmation".to_string());
                            }
                            let _ = event_tx.send(AgentEvent::ToolConfirmationNeeded {
                                tool_id,
                                tool_name,
                                parameters: params,
                            });
                        }

                        ToolEventData::Confirmed { tool_id, tool_name } => {
                            if let Some(tool) = tool_map.get_mut(&tool_id) {
                                tool.status = ToolCallStatus::Confirmed;
                            }
                            let _ = event_tx.send(AgentEvent::ToolConfirmed { tool_id, tool_name });
                        }

                        ToolEventData::Rejected { tool_id, tool_name } => {
                            if let Some(tool) = tool_map.get_mut(&tool_id) {
                                tool.status = ToolCallStatus::Rejected;
                                tool.result = Some("Tool execution rejected".to_string());
                            }
                            let _ = event_tx.send(AgentEvent::ToolRejected {
                                tool_id,
                                tool_name,
                                reason: "Tool execution rejected".to_string(),
                            });
                        }

                        ToolEventData::Completed {
                            tool_id,
                            tool_name,
                            result,
                            result_for_assistant: _,
                            duration_ms,
                        } => {
                            let result_str = serde_json::to_string(&result)
                                .unwrap_or_else(|_| "Success".to_string());

                            if let Some(tool) = tool_map.get_mut(&tool_id) {
                                tool.status = ToolCallStatus::Success;
                                tool.result = Some(result_str.clone());
                                tool.progress = Some(1.0);
                                tool.duration_ms = Some(duration_ms);
                            }

                            let _ = event_tx.send(AgentEvent::ToolCallComplete {
                                tool_id,
                                tool_name,
                                result: result_str,
                                success: true,
                            });
                        }

                        ToolEventData::Failed {
                            tool_id,
                            tool_name,
                            error,
                        } => {
                            if let Some(tool) = tool_map.get_mut(&tool_id) {
                                tool.status = ToolCallStatus::Failed;
                                tool.result = Some(error.clone());
                            }

                            let _ = event_tx.send(AgentEvent::ToolCallComplete {
                                tool_id,
                                tool_name,
                                result: error,
                                success: false,
                            });
                        }

                        ToolEventData::Cancelled {
                            tool_id,
                            tool_name: _,
                            reason,
                        } => {
                            if let Some(tool) = tool_map.get_mut(&tool_id) {
                                tool.status = ToolCallStatus::Cancelled;
                                tool.result = Some(reason);
                            }
                        }

                        _ => {}
                    },

                    CoreEvent::DialogTurnCompleted { .. } => {
                        tracing::info!("Dialog turn completed");
                        let _ = event_tx.send(AgentEvent::Done);
                        let tool_calls: Vec<ToolCall> = tool_map.into_values().collect();

                        return Ok(AgentResponse {
                            session_id: Some(session_id.clone()),
                            tool_calls,
                            success: true,
                        });
                    }

                    CoreEvent::DialogTurnFailed { error, .. } => {
                        tracing::error!("Execution error: {}", error);
                        let _ = event_tx.send(AgentEvent::Error(error.clone()));
                        let tool_calls: Vec<ToolCall> = tool_map.into_values().collect();

                        return Ok(AgentResponse {
                            session_id: Some(session_id.clone()),
                            tool_calls,
                            success: false,
                        });
                    }

                    CoreEvent::SystemError { error, .. } => {
                        tracing::error!("System error: {}", error);
                        let _ = event_tx.send(AgentEvent::Error(error.clone()));
                        let tool_calls: Vec<ToolCall> = tool_map.into_values().collect();

                        return Ok(AgentResponse {
                            session_id: Some(session_id.clone()),
                            tool_calls,
                            success: false,
                        });
                    }

                    _ => {
                        tracing::debug!("Ignoring event: {:?}", event);
                    }
                }
            }
        }
    }

    fn name(&self) -> String {
        let agent_type = self.current_agent_type();
        let workspace_path = self.current_workspace_path();
        agent_display_name(&agent_type, workspace_path.as_ref())
    }

    fn set_workspace_path(&self, workspace_path: Option<PathBuf>) {
        if let Ok(mut current_workspace_path) = self.workspace_path.write() {
            *current_workspace_path = workspace_path;
        } else {
            tracing::warn!("Failed to update CLI agent workspace path");
            return;
        }

        self.reset_session();
    }

    fn set_agent_type(&self, agent_type: String) -> Result<()> {
        if let Ok(mut current_agent_type) = self.agent_type.write() {
            *current_agent_type = if agent_type.trim().is_empty() {
                "Runno".to_string()
            } else {
                agent_type
            };
            Ok(())
        } else {
            anyhow::bail!("Failed to update CLI agent type")
        }
    }

    fn set_session_context(
        &self,
        session_id: String,
        workspace_path: Option<PathBuf>,
        agent_type: String,
    ) -> Result<()> {
        if let Ok(mut current_workspace_path) = self.workspace_path.write() {
            *current_workspace_path = workspace_path;
        } else {
            anyhow::bail!("Failed to update CLI agent workspace path");
        }

        if let Ok(mut current_agent_type) = self.agent_type.write() {
            *current_agent_type = if agent_type.trim().is_empty() {
                "Runno".to_string()
            } else {
                agent_type
            };
        } else {
            anyhow::bail!("Failed to update CLI agent type");
        }

        match self.session_id.try_lock() {
            Ok(mut current_session_id) => {
                *current_session_id = Some(session_id);
                Ok(())
            }
            Err(_) => {
                anyhow::bail!("Cannot switch CLI session while an agent turn is still running")
            }
        }
    }

    fn reset_session(&self) {
        match self.session_id.try_lock() {
            Ok(mut session_id) => {
                *session_id = None;
            }
            Err(_) => {
                tracing::warn!(
                    "Workspace was updated while a CLI agent turn was active; the current turn keeps its existing session"
                );
            }
        }
    }

    async fn confirm_tool(
        &self,
        tool_id: &str,
        updated_input: Option<serde_json::Value>,
    ) -> Result<()> {
        self.coordinator
            .confirm_tool(tool_id, updated_input)
            .await
            .map_err(Into::into)
    }

    async fn reject_tool(&self, tool_id: &str, reason: String) -> Result<()> {
        self.coordinator
            .reject_tool(tool_id, reason)
            .await
            .map_err(Into::into)
    }
}

#[cfg(test)]
mod tests {
    use super::agent_display_name;

    #[test]
    fn agent_display_name_uses_live_registry_names() {
        assert_eq!(agent_display_name("Runno", None), "Runno");
        assert_eq!(agent_display_name("bitfun-coder", None), "BitFun Coder");
        assert_eq!(agent_display_name("bitfun-debug", None), "Debug");
    }

    #[test]
    fn agent_display_name_preserves_unknown_agent_ids() {
        assert_eq!(
            agent_display_name("custom-experimental-agent", None),
            "custom-experimental-agent"
        );
        assert_eq!(agent_display_name("  ", None), "Runno");
    }
}
