use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use bitfun_acp::client::AcpClientStreamEvent;
use bitfun_acp::AcpClientService;
use bitfun_core::agentic::coordination::{
    get_global_scheduler, DialogSubmissionPolicy, DialogTriggerSource,
};
use bitfun_core::agentic::core::PromptEnvelope;
use bitfun_core::agentic::persistence::PersistenceManager;
use bitfun_core::agentic::tools::implementations::agent_session_dispatch::{
    is_external_agent_type, AgentSessionDispatchKind, AgentSessionDispatchOutcome,
    AgentSessionDispatchRequest, AgentSessionDispatchTarget, ExternalAgentSessionDispatcher,
    ExternalDispatcherSession, ExternalSessionWorkspace,
};
use bitfun_core::infrastructure::PathManager;
use bitfun_core::service::remote_ssh::workspace_state::{
    get_effective_session_path, normalize_remote_workspace_path,
};
use bitfun_core::service::session::{SessionMetadata, StoredSessionMetadataFile};
use bitfun_core::service::workspace::WorkspaceKind;
use bitfun_core::util::errors::{BitFunError, BitFunResult};
use tauri::{AppHandle, Emitter};
use tokio::fs;

const DISPATCH_ORIGIN: &str = "dispatcher";

pub struct AcpDispatchAdapter {
    app_handle: AppHandle,
    acp_client_service: Arc<AcpClientService>,
    persistence_manager: PersistenceManager,
    path_manager: Arc<PathManager>,
}

impl AcpDispatchAdapter {
    pub fn new(
        app_handle: AppHandle,
        acp_client_service: Arc<AcpClientService>,
        path_manager: Arc<PathManager>,
    ) -> BitFunResult<Self> {
        Ok(Self {
            app_handle,
            acp_client_service,
            persistence_manager: PersistenceManager::new(path_manager.clone())?,
            path_manager,
        })
    }

    fn acp_client_id_from_agent_type(agent_type: &str) -> Option<String> {
        let value = agent_type.trim();
        if !is_external_agent_type(value) {
            return None;
        }

        let client_id = value.trim_start_matches("acp:").trim();
        if client_id.is_empty() {
            None
        } else {
            Some(client_id.to_string())
        }
    }

    async fn session_storage_path(workspace: &str) -> PathBuf {
        let trimmed = workspace.trim();
        if trimmed.is_empty() {
            return PathBuf::from(workspace);
        }

        let mut remote_connection_id: Option<String> = None;
        let mut remote_ssh_host: Option<String> = None;

        if let Some(workspace_service) = bitfun_core::service::workspace::get_global_workspace_service()
        {
            let wanted_remote_root = normalize_remote_workspace_path(trimmed);
            let candidates = workspace_service.list_workspace_routing_candidates().await;
            for candidate in candidates {
                if candidate.workspace_kind != WorkspaceKind::Remote {
                    continue;
                }

                let candidate_remote_root =
                    normalize_remote_workspace_path(&candidate.root_path.to_string_lossy());
                if candidate_remote_root != wanted_remote_root {
                    continue;
                }

                remote_connection_id = candidate.remote_ssh_connection_id().map(str::to_string);
                remote_ssh_host = candidate
                    .metadata
                    .get("sshHost")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);

                if remote_connection_id.is_some() || remote_ssh_host.is_some() {
                    break;
                }
            }
        }

        get_effective_session_path(
            trimmed,
            remote_connection_id.as_deref(),
            remote_ssh_host.as_deref(),
        )
        .await
    }

    fn build_turn_id() -> String {
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        format!("dispatch_{millis}")
    }

    fn emit_session_created(
        &self,
        session_id: &str,
        session_name: &str,
        agent_type: &str,
        workspace_path: &str,
    ) {
        let _ = self.app_handle.emit(
            "agentic://session-created",
            serde_json::json!({
                "sessionId": session_id,
                "sessionName": session_name,
                "agentType": agent_type,
                "workspacePath": workspace_path,
                "customMetadata": {
                    "kind": "normal",
                    "origin": DISPATCH_ORIGIN,
                    "provider": "acp",
                },
            }),
        );
    }

    fn emit_turn_started(
        &self,
        session_id: &str,
        turn_id: &str,
        user_input: &str,
    ) -> BitFunResult<()> {
        self.app_handle
            .emit(
                "agentic://dialog-turn-started",
                serde_json::json!({
                    "sessionId": session_id,
                    "turnId": turn_id,
                    "turnIndex": null,
                    "userInput": user_input,
                    "originalUserInput": user_input,
                    "userMessageMetadata": {
                        "triggerSource": "agent_session",
                    },
                    "subagentParentInfo": null,
                }),
            )
            .map_err(|e| BitFunError::service(e.to_string()))
    }

    fn format_reply_message(
        responder_session_id: &str,
        responder_workspace: &str,
        status: &str,
        reply_text: &str,
    ) -> String {
        let mut envelope = PromptEnvelope::new();
        envelope.push_system_reminder(format!(
            "This message is an automated reply to a previous SessionMessage call, not a human user message.\n\
From session: {responder_session_id}\n\
From workspace: {responder_workspace}\n\
Status: {status}"
        ));
        envelope.push_user_query(reply_text.to_string());
        envelope.render()
    }

    async fn submit_reply(
        responder_session_id: String,
        responder_workspace: String,
        source_session_id: String,
        source_workspace_path: String,
        status: &'static str,
        reply_text: String,
    ) {
        let Some(scheduler) = get_global_scheduler() else {
            log::warn!(
                "Failed to forward ACP dispatch reply because scheduler is unavailable: responder_session_id={}",
                responder_session_id
            );
            return;
        };

        let reply_message = Self::format_reply_message(
            &responder_session_id,
            &responder_workspace,
            status,
            &reply_text,
        );

        if let Err(error) = scheduler
            .submit(
                source_session_id.clone(),
                reply_message,
                Some(reply_text),
                None,
                String::new(),
                None,
                Some(source_workspace_path.clone()),
                DialogSubmissionPolicy::for_source(DialogTriggerSource::AgentSession),
                None,
                None,
            )
            .await
        {
            log::warn!(
                "Failed to forward ACP dispatch reply: responder_session_id={} source_session_id={} error={}",
                responder_session_id,
                source_session_id,
                error
            );
        }
    }

    fn metadata_client_id(
        metadata: &bitfun_core::service::session::SessionMetadata,
    ) -> Option<String> {
        metadata
            .custom_metadata
            .as_ref()
            .and_then(|custom| custom.get("acpClientId"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .or_else(|| Self::acp_client_id_from_agent_type(&metadata.agent_type))
    }

    fn workspace_kind_for_path(&self, workspace_path: &str) -> String {
        let normalized = workspace_path.trim();
        let global = self.path_manager.agentic_os_runtime_root();
        if normalized == global.to_string_lossy() {
            "global".to_string()
        } else {
            "project".to_string()
        }
    }

    fn push_external_session(
        &self,
        sessions: &mut Vec<ExternalDispatcherSession>,
        seen_session_ids: &mut HashSet<String>,
        metadata: SessionMetadata,
        workspace: String,
        workspace_kind: String,
    ) {
        if metadata.created_by.is_none() {
            return;
        }
        if !Self::metadata_client_id(&metadata).is_some() {
            return;
        }
        if !seen_session_ids.insert(metadata.session_id.clone()) {
            return;
        }

        sessions.push(ExternalDispatcherSession {
            session_id: metadata.session_id,
            session_name: metadata.session_name,
            agent_type: metadata.agent_type,
            workspace,
            workspace_kind,
        });
    }

    async fn scan_persisted_runtime_root(
        &self,
        runtime_root: &Path,
        creator_marker: &str,
        sessions: &mut Vec<ExternalDispatcherSession>,
        seen_session_ids: &mut HashSet<String>,
    ) -> BitFunResult<()> {
        let sessions_root = runtime_root.join("sessions");
        let mut entries = match fs::read_dir(&sessions_root).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(BitFunError::tool(format!(
                    "failed to inspect ACP sessions root '{}': {}",
                    sessions_root.display(),
                    error
                )));
            }
        };

        while let Some(entry) = entries.next_entry().await.map_err(|error| {
            BitFunError::tool(format!(
                "failed to enumerate ACP sessions root '{}': {}",
                sessions_root.display(),
                error
            ))
        })? {
            let file_type = entry.file_type().await.map_err(|error| {
                BitFunError::tool(format!(
                    "failed to inspect ACP session entry '{}': {}",
                    entry.path().display(),
                    error
                ))
            })?;
            if !file_type.is_dir() {
                continue;
            }

            let metadata_path = entry.path().join("metadata.json");
            let stored = match self
                .read_persisted_metadata(&metadata_path)
                .await?
            {
                Some(stored) => stored,
                None => continue,
            };

            if stored.metadata.created_by.as_deref() != Some(creator_marker) {
                continue;
            }

            let workspace = stored
                .metadata
                .workspace_path
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| runtime_root.to_string_lossy().into_owned());
            let workspace_kind = self.workspace_kind_for_path(&workspace);

            self.push_external_session(
                sessions,
                seen_session_ids,
                stored.metadata,
                workspace,
                workspace_kind,
            );
        }

        Ok(())
    }

    async fn read_persisted_metadata(
        &self,
        metadata_path: &Path,
    ) -> BitFunResult<Option<StoredSessionMetadataFile>> {
        let bytes = match fs::read(metadata_path).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(BitFunError::tool(format!(
                    "failed to read ACP session metadata '{}': {}",
                    metadata_path.display(),
                    error
                )));
            }
        };

        serde_json::from_slice::<StoredSessionMetadataFile>(&bytes)
            .map(Some)
            .map_err(|error| {
                BitFunError::tool(format!(
                    "failed to parse ACP session metadata '{}': {}",
                    metadata_path.display(),
                    error
                ))
            })
    }

    async fn scan_global_persisted_sessions(
        &self,
        creator_marker: &str,
        sessions: &mut Vec<ExternalDispatcherSession>,
        seen_session_ids: &mut HashSet<String>,
    ) -> BitFunResult<()> {
        let mut project_entries = match fs::read_dir(self.path_manager.projects_root()).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(BitFunError::tool(format!(
                    "failed to inspect ACP projects root '{}': {}",
                    self.path_manager.projects_root().display(),
                    error
                )));
            }
        };

        while let Some(entry) = project_entries.next_entry().await.map_err(|error| {
            BitFunError::tool(format!(
                "failed to enumerate ACP projects root '{}': {}",
                self.path_manager.projects_root().display(),
                error
            ))
        })? {
            let file_type = entry.file_type().await.map_err(|error| {
                BitFunError::tool(format!(
                    "failed to inspect ACP project runtime '{}': {}",
                    entry.path().display(),
                    error
                ))
            })?;
            if !file_type.is_dir() {
                continue;
            }

            self.scan_persisted_runtime_root(
                &entry.path(),
                creator_marker,
                sessions,
                seen_session_ids,
            )
            .await?;
        }

        let mut stack = vec![PathManager::remote_ssh_mirror_root()];
        while let Some(dir) = stack.pop() {
            let mut entries = match fs::read_dir(&dir).await {
                Ok(entries) => entries,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => {
                    return Err(BitFunError::tool(format!(
                        "failed to inspect ACP remote runtime root '{}': {}",
                        dir.display(),
                        error
                    )));
                }
            };

            while let Some(entry) = entries.next_entry().await.map_err(|error| {
                BitFunError::tool(format!(
                    "failed to enumerate ACP remote runtime root '{}': {}",
                    dir.display(),
                    error
                ))
            })? {
                let file_type = entry.file_type().await.map_err(|error| {
                    BitFunError::tool(format!(
                        "failed to inspect ACP remote runtime entry '{}': {}",
                        entry.path().display(),
                        error
                    ))
                })?;
                if !file_type.is_dir() {
                    continue;
                }

                let path = entry.path();
                self.scan_persisted_runtime_root(
                    &path,
                    creator_marker,
                    sessions,
                    seen_session_ids,
                )
                .await?;
                stack.push(path);
            }
        }

        Ok(())
    }
}

#[async_trait]
impl ExternalAgentSessionDispatcher for AcpDispatchAdapter {
    async fn dispatch(
        &self,
        request: AgentSessionDispatchRequest,
    ) -> BitFunResult<Option<AgentSessionDispatchOutcome>> {
        match request.target.clone() {
            AgentSessionDispatchTarget::New {
                agent_type,
                session_name,
                created_by,
            } => {
                let Some(client_id) = Self::acp_client_id_from_agent_type(&agent_type) else {
                    return Ok(None);
                };

                let session_storage_path = Self::session_storage_path(&request.workspace).await;
                let response = self
                    .acp_client_service
                    .create_dispatched_flow_session_record(
                        &session_storage_path,
                        &request.workspace,
                        &client_id,
                        session_name,
                        created_by,
                        Some(DISPATCH_ORIGIN),
                    )
                    .await?;
                self.acp_client_service
                    .start_client_for_session(&client_id, &response.session_id)
                    .await?;

                self.emit_session_created(
                    &response.session_id,
                    &response.session_name,
                    &response.agent_type,
                    &request.workspace,
                );

                let turn_id = Self::build_turn_id();
                self.emit_turn_started(&response.session_id, &turn_id, &request.message)?;

                let app_handle = self.app_handle.clone();
                let acp_client_service = self.acp_client_service.clone();
                let session_id = response.session_id.clone();
                let session_name_for_outcome = response.session_name.clone();
                let agent_type_for_outcome = response.agent_type.clone();
                let workspace = request.workspace.clone();
                let workspace_for_task = workspace.clone();
                let source_session_id = request.source_session_id.clone();
                let source_workspace_path = request.source_workspace_path.clone();
                let prompt = request.message.clone();
                let session_name_for_task = session_name_for_outcome.clone();
                tokio::spawn(async move {
                    let mut current_round_id: Option<String> = None;
                    let mut reply_text = String::new();
                    let result = acp_client_service
                        .prompt_agent_stream(
                            &client_id,
                            prompt.clone(),
                            Some(workspace_for_task.clone()),
                            Some(session_id.clone()),
                            Some(session_storage_path.clone()),
                            None,
                            |event| {
                                match event {
                                    AcpClientStreamEvent::ModelRoundStarted {
                                        round_id,
                                        round_index,
                                        disable_explore_grouping,
                                    } => {
                                        current_round_id = Some(round_id.clone());
                                        app_handle.emit(
                                            "agentic://model-round-started",
                                            serde_json::json!({
                                                "sessionId": session_id,
                                                "turnId": turn_id,
                                                "roundId": round_id,
                                                "roundIndex": round_index,
                                                "renderHints": {
                                                    "disableExploreGrouping": disable_explore_grouping,
                                                },
                                                "subagentParentInfo": null,
                                            }),
                                        ).map_err(|e| BitFunError::service(e.to_string()))?;
                                    }
                                    AcpClientStreamEvent::AgentText(text) => {
                                        reply_text.push_str(&text);
                                        let round_id = current_round_id.clone().ok_or_else(|| {
                                            BitFunError::service(
                                                "ACP text arrived before model round start".to_string(),
                                            )
                                        })?;
                                        app_handle.emit(
                                            "agentic://text-chunk",
                                            serde_json::json!({
                                                "sessionId": session_id,
                                                "turnId": turn_id,
                                                "roundId": round_id,
                                                "text": text,
                                                "subagentParentInfo": null,
                                            }),
                                        ).map_err(|e| BitFunError::service(e.to_string()))?;
                                    }
                                    AcpClientStreamEvent::AgentThought(text) => {
                                        let round_id = current_round_id.clone().ok_or_else(|| {
                                            BitFunError::service(
                                                "ACP thought arrived before model round start".to_string(),
                                            )
                                        })?;
                                        app_handle.emit(
                                            "agentic://text-chunk",
                                            serde_json::json!({
                                                "sessionId": session_id,
                                                "turnId": turn_id,
                                                "roundId": round_id,
                                                "text": text,
                                                "contentType": "thinking",
                                                "isThinkingEnd": false,
                                                "subagentParentInfo": null,
                                            }),
                                        ).map_err(|e| BitFunError::service(e.to_string()))?;
                                    }
                                    AcpClientStreamEvent::ToolEvent(tool_event) => {
                                        app_handle.emit(
                                            "agentic://tool-event",
                                            serde_json::json!({
                                                "sessionId": session_id,
                                                "turnId": turn_id,
                                                "toolEvent": tool_event,
                                                "subagentParentInfo": null,
                                            }),
                                        ).map_err(|e| BitFunError::service(e.to_string()))?;
                                    }
                                    AcpClientStreamEvent::Completed => {
                                        app_handle.emit(
                                            "agentic://dialog-turn-completed",
                                            serde_json::json!({
                                                "sessionId": session_id,
                                                "turnId": turn_id,
                                                "subagentParentInfo": null,
                                                "partialRecoveryReason": null,
                                            }),
                                        ).map_err(|e| BitFunError::service(e.to_string()))?;
                                    }
                                    AcpClientStreamEvent::Cancelled => {
                                        app_handle.emit(
                                            "agentic://dialog-turn-cancelled",
                                            serde_json::json!({
                                                "sessionId": session_id,
                                                "turnId": turn_id,
                                                "subagentParentInfo": null,
                                            }),
                                        ).map_err(|e| BitFunError::service(e.to_string()))?;
                                    }
                                }
                                Ok(())
                            },
                        )
                        .await;

                    match result {
                        Ok(()) => {
                            let final_text = if reply_text.trim().is_empty() {
                                format!(
                                    "ACP session '{}' completed without text output.",
                                    session_name_for_task
                                )
                            } else {
                                reply_text
                            };
                            Self::submit_reply(
                                session_id.clone(),
                                workspace_for_task.clone(),
                                source_session_id.clone(),
                                source_workspace_path.clone(),
                                "completed",
                                final_text,
                            )
                            .await;
                        }
                        Err(error) => {
                            let _ = app_handle.emit(
                                "agentic://dialog-turn-failed",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "turnId": turn_id,
                                    "error": error.to_string(),
                                    "errorCategory": null,
                                    "errorDetail": null,
                                    "subagentParentInfo": null,
                                }),
                            );
                            Self::submit_reply(
                                session_id.clone(),
                                workspace_for_task.clone(),
                                source_session_id.clone(),
                                source_workspace_path.clone(),
                                "failed",
                                format!(
                                    "ACP session '{}' failed: {}",
                                    session_name_for_task, error
                                ),
                            )
                            .await;
                        }
                    }
                });

                Ok(Some(AgentSessionDispatchOutcome {
                    kind: AgentSessionDispatchKind::Created,
                    workspace,
                    session_id: response.session_id,
                    session_name: session_name_for_outcome,
                    agent_type: agent_type_for_outcome,
                }))
            }
            AgentSessionDispatchTarget::Existing(existing) => {
                let session_storage_path = Self::session_storage_path(&request.workspace).await;
                let Some(metadata) = self
                    .persistence_manager
                    .load_session_metadata(Path::new(&session_storage_path), &existing.session_id)
                    .await?
                else {
                    return Ok(None);
                };

                let Some(client_id) = Self::metadata_client_id(&metadata) else {
                    return Ok(None);
                };

                self.acp_client_service
                    .start_client_for_session(&client_id, &existing.session_id)
                    .await?;

                let turn_id = Self::build_turn_id();
                self.emit_turn_started(&existing.session_id, &turn_id, &request.message)?;

                let app_handle = self.app_handle.clone();
                let acp_client_service = self.acp_client_service.clone();
                let session_id = existing.session_id.clone();
                let session_name = metadata.session_name.clone();
                let agent_type = metadata.agent_type.clone();
                let workspace = request.workspace.clone();
                let workspace_for_task = workspace.clone();
                let source_session_id = request.source_session_id.clone();
                let source_workspace_path = request.source_workspace_path.clone();
                let prompt = request.message.clone();
                let session_name_for_task = session_name.clone();
                tokio::spawn(async move {
                    let mut current_round_id: Option<String> = None;
                    let mut reply_text = String::new();
                    let result = acp_client_service
                        .prompt_agent_stream(
                            &client_id,
                            prompt.clone(),
                            Some(workspace_for_task.clone()),
                            Some(session_id.clone()),
                            Some(session_storage_path.clone()),
                            None,
                            |event| {
                                match event {
                                    AcpClientStreamEvent::ModelRoundStarted {
                                        round_id,
                                        round_index,
                                        disable_explore_grouping,
                                    } => {
                                        current_round_id = Some(round_id.clone());
                                        app_handle.emit(
                                            "agentic://model-round-started",
                                            serde_json::json!({
                                                "sessionId": session_id,
                                                "turnId": turn_id,
                                                "roundId": round_id,
                                                "roundIndex": round_index,
                                                "renderHints": {
                                                    "disableExploreGrouping": disable_explore_grouping,
                                                },
                                                "subagentParentInfo": null,
                                            }),
                                        ).map_err(|e| BitFunError::service(e.to_string()))?;
                                    }
                                    AcpClientStreamEvent::AgentText(text) => {
                                        reply_text.push_str(&text);
                                        let round_id = current_round_id.clone().ok_or_else(|| {
                                            BitFunError::service(
                                                "ACP text arrived before model round start".to_string(),
                                            )
                                        })?;
                                        app_handle.emit(
                                            "agentic://text-chunk",
                                            serde_json::json!({
                                                "sessionId": session_id,
                                                "turnId": turn_id,
                                                "roundId": round_id,
                                                "text": text,
                                                "subagentParentInfo": null,
                                            }),
                                        ).map_err(|e| BitFunError::service(e.to_string()))?;
                                    }
                                    AcpClientStreamEvent::AgentThought(text) => {
                                        let round_id = current_round_id.clone().ok_or_else(|| {
                                            BitFunError::service(
                                                "ACP thought arrived before model round start".to_string(),
                                            )
                                        })?;
                                        app_handle.emit(
                                            "agentic://text-chunk",
                                            serde_json::json!({
                                                "sessionId": session_id,
                                                "turnId": turn_id,
                                                "roundId": round_id,
                                                "text": text,
                                                "contentType": "thinking",
                                                "isThinkingEnd": false,
                                                "subagentParentInfo": null,
                                            }),
                                        ).map_err(|e| BitFunError::service(e.to_string()))?;
                                    }
                                    AcpClientStreamEvent::ToolEvent(tool_event) => {
                                        app_handle.emit(
                                            "agentic://tool-event",
                                            serde_json::json!({
                                                "sessionId": session_id,
                                                "turnId": turn_id,
                                                "toolEvent": tool_event,
                                                "subagentParentInfo": null,
                                            }),
                                        ).map_err(|e| BitFunError::service(e.to_string()))?;
                                    }
                                    AcpClientStreamEvent::Completed => {
                                        app_handle.emit(
                                            "agentic://dialog-turn-completed",
                                            serde_json::json!({
                                                "sessionId": session_id,
                                                "turnId": turn_id,
                                                "subagentParentInfo": null,
                                                "partialRecoveryReason": null,
                                            }),
                                        ).map_err(|e| BitFunError::service(e.to_string()))?;
                                    }
                                    AcpClientStreamEvent::Cancelled => {
                                        app_handle.emit(
                                            "agentic://dialog-turn-cancelled",
                                            serde_json::json!({
                                                "sessionId": session_id,
                                                "turnId": turn_id,
                                                "subagentParentInfo": null,
                                            }),
                                        ).map_err(|e| BitFunError::service(e.to_string()))?;
                                    }
                                }
                                Ok(())
                            },
                        )
                        .await;

                    match result {
                        Ok(()) => {
                            let final_text = if reply_text.trim().is_empty() {
                                format!(
                                    "ACP session '{}' completed without text output.",
                                    session_name_for_task
                                )
                            } else {
                                reply_text
                            };
                            Self::submit_reply(
                                session_id.clone(),
                                workspace_for_task.clone(),
                                source_session_id.clone(),
                                source_workspace_path.clone(),
                                "completed",
                                final_text,
                            )
                            .await;
                        }
                        Err(error) => {
                            let _ = app_handle.emit(
                                "agentic://dialog-turn-failed",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "turnId": turn_id,
                                    "error": error.to_string(),
                                    "errorCategory": null,
                                    "errorDetail": null,
                                    "subagentParentInfo": null,
                                }),
                            );
                            Self::submit_reply(
                                session_id.clone(),
                                workspace_for_task.clone(),
                                source_session_id.clone(),
                                source_workspace_path.clone(),
                                "failed",
                                format!(
                                    "ACP session '{}' failed: {}",
                                    session_name_for_task, error
                                ),
                            )
                            .await;
                        }
                    }
                });

                Ok(Some(AgentSessionDispatchOutcome {
                    kind: AgentSessionDispatchKind::Reused,
                    workspace,
                    session_id: existing.session_id,
                    session_name,
                    agent_type,
                }))
            }
        }
    }

    async fn list_sessions_created_by(
        &self,
        creator_marker: &str,
        workspaces: &[ExternalSessionWorkspace],
    ) -> BitFunResult<Vec<ExternalDispatcherSession>> {
        let mut sessions = Vec::new();
        let mut seen_session_ids = HashSet::new();
        for workspace in workspaces {
            let path = Path::new(&workspace.path);
            if !path.exists() {
                continue;
            }

            let metadata_list = self
                .persistence_manager
                .list_session_metadata_including_internal(path)
                .await?;
            for metadata in metadata_list {
                if metadata.created_by.as_deref() != Some(creator_marker) {
                    continue;
                }
                self.push_external_session(
                    &mut sessions,
                    &mut seen_session_ids,
                    metadata,
                    workspace.path.clone(),
                    workspace.kind.clone(),
                );
            }
        }

        self.scan_global_persisted_sessions(creator_marker, &mut sessions, &mut seen_session_ids)
            .await?;

        Ok(sessions)
    }
}
