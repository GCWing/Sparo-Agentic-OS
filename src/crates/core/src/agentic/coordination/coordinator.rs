//! Conversation coordinator
//!
//! Top-level component that integrates all subsystems and provides a unified interface

use super::{scheduler::DialogSubmissionPolicy, turn_outcome::TurnOutcome};
use crate::agentic::agents::get_agent_registry;
use crate::agentic::core::{
    has_prompt_markup, Message, MessageContent, ProcessingPhase, PromptEnvelope, Session,
    SessionConfig, SessionKind, SessionState, SessionStorageScope, SessionSummary, TurnStats,
};
use crate::agentic::events::{
    AgenticEvent, EventPriority, EventQueue, EventRouter, EventSubscriber, SessionSurfaceMode,
};
use crate::agentic::execution::{ContextCompactionOutcome, ExecutionContext, ExecutionEngine};
use crate::agentic::fork_agent::{
    ForkAgentContextSnapshot, ForkAgentExecutionRequest, ForkAgentExecutionResult,
};
use crate::agentic::image_analysis::ImageContextData;
use crate::agentic::memory::store::{
    build_memory_manifest_for_target, ensure_memory_store_for_target,
    memory_store_dir_path_for_target, MemoryScope, MemoryStoreTarget,
};
use crate::agentic::memory::{
    build_auto_memory_runtime_restrictions, build_extract_prompt, build_session_summary_prompt,
    build_session_summary_runtime_restrictions, count_recent_model_visible_messages,
    handle_auto_memory_after_completed_turn, queue_action_from_schedule_decision,
    resolve_auto_memory_runtime_context, resolve_auto_memory_scope,
    resolve_local_auto_memory_context, session_can_consider_auto_memory,
    AutoMemoryCompletedTurnFollowup, AutoMemoryManager, AutoMemoryQueueAction,
};
use crate::agentic::round_preempt::DialogRoundPreemptSource;
use crate::agentic::session::SessionManager;
use crate::agentic::side_question::build_btw_user_input;
use crate::agentic::tools::pipeline::{SubagentParentInfo, ToolPipeline};
use crate::agentic::tools::ToolRuntimeRestrictions;
use crate::agentic::WorkspaceBinding;
use crate::infrastructure::get_path_manager_arc;
use crate::service::global_daily_report::prompt::global_daily_report_allowed_tools;
use crate::service::global_milestone::prompt::global_milestone_allowed_tools;
use crate::service::host::{
    build_host_scan_user_prompt, default_host_scan_session_name, host_scan_allowed_tools,
};
use crate::service::workspace::{get_global_workspace_service, WorkspaceCreateOptions};
use crate::service::workspace_overview::prompt::workspace_overview_refresh_allowed_tools;
use crate::util::errors::{BitFunError, BitFunResult};
use chrono::TimeZone;
use log::{debug, error, info, warn};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::OnceLock;
use std::sync::Weak;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::fs;
use tokio::sync::mpsc;
use tokio::time::{sleep, Duration, Instant};
use tokio_util::sync::CancellationToken;

const MANUAL_COMPACTION_COMMAND: &str = "/compact";
const CONTEXT_COMPRESSION_TOOL_NAME: &str = "ContextCompression";
const AUTO_MEMORY_FORK_MAX_TURNS: usize = 5;
const SESSION_SUMMARY_FORK_MAX_TURNS: usize = 4;

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

fn local_date_key_from_unix_ms(timestamp_ms: u64) -> String {
    let timestamp_ms = i64::try_from(timestamp_ms).unwrap_or(i64::MAX);
    chrono::Local
        .timestamp_millis_opt(timestamp_ms)
        .single()
        .unwrap_or_else(chrono::Local::now)
        .format("%Y-%m-%d")
        .to_string()
}

async fn archive_session_daily_summary(
    session_id: &str,
    session_manager: &SessionManager,
    date_key: &str,
) -> BitFunResult<()> {
    let summary_path = session_manager.session_summary_path(session_id).await?;
    let daily_summary_path = session_manager
        .session_daily_summary_path(session_id, date_key)
        .await?;

    let summary_content = fs::read_to_string(&summary_path).await.map_err(|error| {
        BitFunError::service(format!(
            "Failed to read session summary for daily archive: session_id={} path={} error={}",
            session_id,
            summary_path.display(),
            error
        ))
    })?;

    if let Some(parent) = daily_summary_path.parent() {
        fs::create_dir_all(parent).await.map_err(|error| {
            BitFunError::service(format!(
                "Failed to create session daily summary directory: session_id={} path={} error={}",
                session_id,
                parent.display(),
                error
            ))
        })?;
    }

    fs::write(&daily_summary_path, summary_content)
        .await
        .map_err(|error| {
            BitFunError::service(format!(
                "Failed to write session daily summary archive: session_id={} path={} error={}",
                session_id,
                daily_summary_path.display(),
                error
            ))
        })?;

    Ok(())
}

/// Subagent execution result
///
/// Contains the text response after subagent execution
#[derive(Debug, Clone)]
pub struct SubagentResult {
    /// AI text response
    pub text: String,
}

struct HiddenSubagentExecutionRequest {
    session_name: String,
    agent_type: String,
    session_config: SessionConfig,
    initial_messages: Vec<Message>,
    created_by: Option<String>,
    surface_mode: SessionSurfaceMode,
    subagent_parent_info: Option<SubagentParentInfo>,
    context: HashMap<String, String>,
    runtime_tool_restrictions: ToolRuntimeRestrictions,
}

#[derive(Debug, Clone, Default)]
struct DialogExecutionSettings {
    tool_allowlist_override: Option<Vec<String>>,
    runtime_tool_restrictions: ToolRuntimeRestrictions,
    surface_mode: SessionSurfaceMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DialogTriggerSource {
    DesktopUi,
    DesktopApi,
    AgentSession,
    ScheduledJob,
    RemoteRelay,
    Bot,
    Cli,
}

const HOST_SCAN_AGENT_TYPE: &str = "HostScanAgent";
const GLOBAL_DAILY_REPORT_AGENT_TYPE: &str = "GlobalDailyReportAgent";
const GLOBAL_MILESTONE_AGENT_TYPE: &str = "GlobalMilestoneAgent";
const WORKSPACE_OVERVIEW_AGENT_TYPE: &str = "WorkspaceOverviewRefresher";

/// Cancel token cleanup guard
///
/// Automatically cleans up cancel tokens in ExecutionEngine when dropped
struct CancelTokenGuard {
    execution_engine: Arc<ExecutionEngine>,
    dialog_turn_id: String,
}

impl Drop for CancelTokenGuard {
    fn drop(&mut self) {
        let execution_engine = self.execution_engine.clone();
        let dialog_turn_id = self.dialog_turn_id.clone();

        tokio::spawn(async move {
            execution_engine.cleanup_cancel_token(&dialog_turn_id).await;
        });
    }
}

fn surface_mode_for_session(session: &Session) -> SessionSurfaceMode {
    match session.kind {
        SessionKind::Subagent => SessionSurfaceMode::ParentRoutedSubagent,
        SessionKind::Standard => SessionSurfaceMode::UserVisible,
    }
}

/// Conversation coordinator
pub struct ConversationCoordinator {
    session_manager: Arc<SessionManager>,
    execution_engine: Arc<ExecutionEngine>,
    tool_pipeline: Arc<ToolPipeline>,
    auto_memory_manager: Arc<AutoMemoryManager>,
    event_queue: Arc<EventQueue>,
    event_router: Arc<EventRouter>,
    /// Notifies DialogScheduler of turn outcomes; injected after construction
    scheduler_notify_tx: OnceLock<mpsc::Sender<(String, TurnOutcome)>>,
    /// Round-boundary yield (same source as scheduler's yield flags); injected after construction
    round_preempt_source: OnceLock<Arc<dyn DialogRoundPreemptSource>>,
    /// Weak self-reference; set immediately after `Arc::new(...)` so spawned
    /// tasks can re-acquire a strong reference without going through a global.
    self_weak: OnceLock<Weak<ConversationCoordinator>>,
    /// Multi-workspace registry ? used to resolve a `WorkspaceMount` from
    /// a session's `workspace_path` when building tool execution contexts.
    workspace_registry: OnceLock<Weak<crate::runtime::WorkspaceRegistry>>,
    /// Weak handles to the surrounding agentic stack. Held as `Weak` because
    /// the scheduler/cron/host_auto_scan services own an `Arc<Self>`, so a
    /// strong back-reference would leak.
    scheduler_handle: OnceLock<Weak<crate::agentic::coordination::DialogScheduler>>,
    cron_handle: OnceLock<Weak<crate::service::cron::CronService>>,
    host_auto_scan_handle: OnceLock<Weak<crate::service::host::HostAutoScanService>>,
}

impl ConversationCoordinator {
    fn host_scan_execution_settings() -> DialogExecutionSettings {
        let tool_allowlist_override = Some(host_scan_allowed_tools());
        let runtime_tool_restrictions = ToolRuntimeRestrictions {
            allowed_tool_names: tool_allowlist_override
                .clone()
                .unwrap_or_default()
                .into_iter()
                .collect(),
            ..ToolRuntimeRestrictions::default()
        };

        DialogExecutionSettings {
            tool_allowlist_override,
            runtime_tool_restrictions,
            surface_mode: SessionSurfaceMode::InternalBackground,
        }
    }

    fn workspace_overview_execution_settings(
        runtime_tool_restrictions: ToolRuntimeRestrictions,
    ) -> DialogExecutionSettings {
        let tool_allowlist_override = Some(workspace_overview_refresh_allowed_tools());
        DialogExecutionSettings {
            tool_allowlist_override,
            runtime_tool_restrictions,
            surface_mode: SessionSurfaceMode::InternalBackground,
        }
    }

    fn global_daily_report_execution_settings(
        runtime_tool_restrictions: ToolRuntimeRestrictions,
    ) -> DialogExecutionSettings {
        let tool_allowlist_override = Some(global_daily_report_allowed_tools());
        DialogExecutionSettings {
            tool_allowlist_override,
            runtime_tool_restrictions,
            surface_mode: SessionSurfaceMode::InternalBackground,
        }
    }

    fn global_milestone_execution_settings(
        runtime_tool_restrictions: ToolRuntimeRestrictions,
    ) -> DialogExecutionSettings {
        let tool_allowlist_override = Some(global_milestone_allowed_tools());
        DialogExecutionSettings {
            tool_allowlist_override,
            runtime_tool_restrictions,
            surface_mode: SessionSurfaceMode::InternalBackground,
        }
    }

    async fn track_session_workspace_activity_best_effort(config: &SessionConfig, reason: &str) {
        let Some(workspace_path) = config.workspace_path.as_ref() else {
            return;
        };

        let Some(workspace_service) = get_global_workspace_service() else {
            return;
        };

        let options = WorkspaceCreateOptions {
            remember_last_used: false,
            add_to_recent: true,
            ..Default::default()
        };

        if let Err(error) = workspace_service
            .track_workspace_activity(PathBuf::from(workspace_path), options)
            .await
        {
            warn!(
                "Failed to track session workspace activity: reason={}, workspace_path={}, error={}",
                reason, workspace_path, error
            );
        }
    }

    async fn build_workspace_binding(config: &SessionConfig) -> Option<WorkspaceBinding> {
        let workspace_path = config.workspace_path.as_ref()?;
        Some(WorkspaceBinding::new(None, PathBuf::from(workspace_path)))
    }

    /// Build `WorkspaceServices` from a resolved `WorkspaceBinding`.
    async fn build_workspace_services(
        binding: &Option<WorkspaceBinding>,
    ) -> Option<crate::agentic::workspace::WorkspaceServices> {
        let binding = binding.as_ref()?;
        Some(crate::agentic::workspace::local_workspace_services(
            binding.root_path_string(),
        ))
    }

    fn normalize_agent_type(agent_type: &str) -> String {
        if agent_type.trim().is_empty() {
            "agentic".to_string()
        } else {
            agent_type.trim().to_string()
        }
    }

    fn ensure_user_message_metadata_object(
        metadata: Option<serde_json::Value>,
    ) -> serde_json::Value {
        match metadata {
            Some(value) if value.is_object() => value,
            Some(value) => serde_json::json!({ "raw_metadata": value }),
            None => serde_json::json!({}),
        }
    }

    fn estimate_context_tokens(messages: &[Message]) -> usize {
        let mut cloned = messages.to_vec();
        cloned.iter_mut().map(|message| message.get_tokens()).sum()
    }

    fn manual_compaction_metadata() -> serde_json::Value {
        serde_json::json!({
            "kind": "manual_compaction",
            "command": MANUAL_COMPACTION_COMMAND,
        })
    }

    fn build_manual_compaction_round_completed(
        turn_id: &str,
        outcome: &ContextCompactionOutcome,
        context_window: usize,
        threshold: f32,
    ) -> crate::service::session::ModelRoundData {
        use crate::service::session::{ModelRoundData, ToolCallData, ToolItemData, ToolResultData};

        let completed_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let started_at = completed_at.saturating_sub(outcome.duration_ms);

        ModelRoundData {
            id: format!("{}-manual-compaction-round", turn_id),
            turn_id: turn_id.to_string(),
            round_index: 0,
            timestamp: started_at,
            text_items: Vec::new(),
            tool_items: vec![ToolItemData {
                id: outcome.compression_id.clone(),
                tool_name: CONTEXT_COMPRESSION_TOOL_NAME.to_string(),
                tool_call: ToolCallData {
                    input: serde_json::json!({
                        "trigger": "manual",
                        "tokens_before": outcome.tokens_before,
                        "context_window": context_window,
                        "threshold": threshold,
                    }),
                    id: outcome.compression_id.clone(),
                },
                tool_result: Some(ToolResultData {
                    result: serde_json::json!({
                        "compression_count": outcome.compression_count,
                        "tokens_before": outcome.tokens_before,
                        "tokens_after": outcome.tokens_after,
                        "compression_ratio": outcome.compression_ratio,
                        "duration": outcome.duration_ms,
                        "applied": outcome.applied,
                        "has_summary": outcome.has_summary,
                        "summary_source": outcome.summary_source,
                    }),
                    success: true,
                    result_for_assistant: None,
                    error: None,
                    duration_ms: Some(outcome.duration_ms),
                }),
                ai_intent: None,
                start_time: started_at,
                end_time: Some(completed_at),
                duration_ms: Some(outcome.duration_ms),
                order_index: Some(0),
                status: Some("completed".to_string()),
                interruption_reason: None,
                execution_projection: None,
            }],
            thinking_items: Vec::new(),
            start_time: started_at,
            end_time: Some(completed_at),
            status: "completed".to_string(),
        }
    }

    fn build_manual_compaction_round_failed(
        turn_id: &str,
        compression_id: String,
        error: &str,
        context_window: usize,
        threshold: f32,
    ) -> crate::service::session::ModelRoundData {
        use crate::service::session::{ModelRoundData, ToolCallData, ToolItemData, ToolResultData};

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        ModelRoundData {
            id: format!("{}-manual-compaction-round", turn_id),
            turn_id: turn_id.to_string(),
            round_index: 0,
            timestamp,
            text_items: Vec::new(),
            tool_items: vec![ToolItemData {
                id: compression_id.clone(),
                tool_name: CONTEXT_COMPRESSION_TOOL_NAME.to_string(),
                tool_call: ToolCallData {
                    input: serde_json::json!({
                        "trigger": "manual",
                        "context_window": context_window,
                        "threshold": threshold,
                        "summary_source": "none",
                    }),
                    id: compression_id,
                },
                tool_result: Some(ToolResultData {
                    result: serde_json::Value::Null,
                    success: false,
                    result_for_assistant: None,
                    error: Some(error.to_string()),
                    duration_ms: None,
                }),
                ai_intent: None,
                start_time: timestamp,
                end_time: Some(timestamp),
                duration_ms: Some(0),
                order_index: Some(0),
                status: Some("error".to_string()),
                interruption_reason: None,
                execution_projection: None,
            }],
            thinking_items: Vec::new(),
            start_time: timestamp,
            end_time: Some(timestamp),
            status: "error".to_string(),
        }
    }

    pub fn new(
        session_manager: Arc<SessionManager>,
        execution_engine: Arc<ExecutionEngine>,
        tool_pipeline: Arc<ToolPipeline>,
        event_queue: Arc<EventQueue>,
        event_router: Arc<EventRouter>,
    ) -> Self {
        Self {
            session_manager,
            execution_engine,
            tool_pipeline,
            auto_memory_manager: Arc::new(AutoMemoryManager::new()),
            event_queue,
            event_router,
            scheduler_notify_tx: OnceLock::new(),
            round_preempt_source: OnceLock::new(),
            self_weak: OnceLock::new(),
            workspace_registry: OnceLock::new(),
            scheduler_handle: OnceLock::new(),
            cron_handle: OnceLock::new(),
            host_auto_scan_handle: OnceLock::new(),
        }
    }

    /// Wire up the weak self-reference. Must be called exactly once,
    /// immediately after `Arc::new(...)`, so internal `tokio::spawn`
    /// callbacks can recover an `Arc<Self>` without a process-wide global.
    pub fn install_self_arc(self: &Arc<Self>) {
        let _ = self.self_weak.set(Arc::downgrade(self));
    }

    /// Recover a strong reference to this coordinator. Returns `None` if
    /// `install_self_arc` was never called or the only references have been
    /// dropped (workspace was unmounted while a background task was racing
    /// to fire).
    pub fn self_arc(&self) -> Option<Arc<Self>> {
        self.self_weak.get().and_then(|w| w.upgrade())
    }

    /// Inject the surrounding runtime handles so the coordinator can build
    /// fully-populated `ExecutionContext`s (including `workspace_mount` and
    /// `agentic` handles) without reaching for a global.
    ///
    /// Called once during desktop boot after the registry and surrounding
    /// agentic services have been constructed.
    pub fn install_runtime_handles(
        &self,
        workspace_registry: Weak<crate::runtime::WorkspaceRegistry>,
        scheduler: Weak<crate::agentic::coordination::DialogScheduler>,
        cron_service: Weak<crate::service::cron::CronService>,
        host_auto_scan: Weak<crate::service::host::HostAutoScanService>,
    ) {
        let _ = self.workspace_registry.set(workspace_registry);
        let _ = self.scheduler_handle.set(scheduler);
        let _ = self.cron_handle.set(cron_service);
        let _ = self.host_auto_scan_handle.set(host_auto_scan);
    }

    /// Build the runtime-handle pair (`workspace_mount`, `agentic`) for an
    /// execution context targeting `workspace_path`. Both halves are best-
    /// effort: if any handle is unwired, the corresponding slot stays `None`
    /// and the tool will report a clear "not initialized" error rather than
    /// silently misbehaving.
    pub fn build_execution_handles(
        &self,
        workspace_path: Option<&std::path::Path>,
    ) -> (
        Option<crate::runtime::WorkspaceMount>,
        Option<crate::runtime::AgenticHandles>,
    ) {
        let workspace_mount = workspace_path.and_then(|path| {
            self.workspace_registry
                .get()
                .and_then(|w| w.upgrade())
                .and_then(|registry| registry.by_path(path))
        });

        let agentic = match (
            self.self_arc(),
            self.scheduler_handle.get().and_then(|w| w.upgrade()),
            self.cron_handle.get().and_then(|w| w.upgrade()),
            self.host_auto_scan_handle.get().and_then(|w| w.upgrade()),
        ) {
            (Some(coord), Some(scheduler), Some(cron_service), Some(host_auto_scan)) => {
                Some(crate::runtime::AgenticHandles {
                    coordinator: coord,
                    scheduler,
                    cron_service,
                    host_auto_scan,
                })
            }
            _ => None,
        };

        (workspace_mount, agentic)
    }

    /// Inject the DialogScheduler notification channel after construction.
    /// Called once during app initialization after the scheduler is created.
    pub fn set_scheduler_notifier(&self, tx: mpsc::Sender<(String, TurnOutcome)>) {
        let _ = self.scheduler_notify_tx.set(tx);
    }

    /// Wire round-boundary preempt (typically the scheduler's [`SessionRoundYieldFlags`](crate::agentic::round_preempt::SessionRoundYieldFlags)).
    pub fn set_round_preempt_source(&self, source: Arc<dyn DialogRoundPreemptSource>) {
        let _ = self.round_preempt_source.set(source);
    }

    /// Create a new session
    pub async fn create_session(
        &self,
        session_name: String,
        agent_type: String,
        config: SessionConfig,
    ) -> BitFunResult<Session> {
        let workspace_path = config.workspace_path.clone().ok_or_else(|| {
            BitFunError::Validation(
                "workspace_path is required when creating a session".to_string(),
            )
        })?;
        self.create_session_with_workspace_and_creator(
            None,
            session_name,
            agent_type,
            config,
            workspace_path,
            None,
        )
        .await
    }

    /// Create a new session with optional session ID
    pub async fn create_session_with_id(
        &self,
        session_id: Option<String>,
        session_name: String,
        agent_type: String,
        config: SessionConfig,
    ) -> BitFunResult<Session> {
        let workspace_path = config.workspace_path.clone().ok_or_else(|| {
            BitFunError::Validation(
                "workspace_path is required when creating a session".to_string(),
            )
        })?;
        self.create_session_with_workspace_and_creator(
            session_id,
            session_name,
            agent_type,
            config,
            workspace_path,
            None,
        )
        .await
    }

    /// Create a new session with optional session ID and workspace binding.
    /// `workspace_path` is forwarded in the `SessionCreated` event and also stored
    /// in the session's in-memory config so it can be retrieved without disk access.
    pub async fn create_session_with_workspace(
        &self,
        session_id: Option<String>,
        session_name: String,
        agent_type: String,
        config: SessionConfig,
        workspace_path: String,
    ) -> BitFunResult<Session> {
        self.create_session_with_workspace_and_creator(
            session_id,
            session_name,
            agent_type,
            config,
            workspace_path,
            None,
        )
        .await
    }

    pub async fn update_session_model(&self, session_id: &str, model_id: &str) -> BitFunResult<()> {
        let normalized_model_id = model_id.trim();
        let normalized_model_id = if normalized_model_id.is_empty() {
            "primary"
        } else {
            normalized_model_id
        };

        self.session_manager
            .update_session_model_id(session_id, normalized_model_id)
            .await?;

        info!(
            "Coordinator updated session model: session_id={}, model_id={}",
            session_id, normalized_model_id
        );

        Ok(())
    }

    /// Create a new session with explicit creator identity.
    pub async fn create_session_with_workspace_and_creator(
        &self,
        session_id: Option<String>,
        session_name: String,
        agent_type: String,
        mut config: SessionConfig,
        workspace_path: String,
        created_by: Option<String>,
    ) -> BitFunResult<Session> {
        // Persist the workspace binding inside the session config so execution can
        // consistently restore the correct workspace regardless of the entry point.
        config.workspace_path = Some(workspace_path.clone());
        let agent_type = Self::normalize_agent_type(&agent_type);
        let session = self
            .session_manager
            .create_session_with_id_and_creator(
                session_id,
                session_name,
                agent_type,
                config,
                created_by,
            )
            .await?;

        Self::track_session_workspace_activity_best_effort(&session.config, "session_created")
            .await;

        // SessionManager::create_session_with_id_and_creator already persists the
        // session into the effective workspace session storage path. Avoid writing
        // a second copy here using the raw workspace path, because remote workspaces
        // resolve to a different effective storage path and double-writing can leave
        // metadata/turn files split across two locations.

        self.emit_event(AgenticEvent::SessionCreated {
            session_id: session.session_id.clone(),
            session_name: session.session_name.clone(),
            agent_type: session.agent_type.clone(),
            workspace_path: Some(workspace_path),
        })
        .await;
        Ok(session)
    }

    /// Ensure the completed/failed/cancelled turn is persisted to the workspace
    /// session storage. If the frontend already saved a richer version
    /// during streaming, we only update the final status; otherwise we create
    /// a minimal record with the user message so the turn is never lost.
    /// Safety-net persistence: only creates a minimal record when the frontend
    /// has not saved anything yet.  The frontend's PersistenceModule is the
    /// authoritative writer for turn content (model rounds, text, tools, etc.)
    /// and final status.  This function must NOT overwrite frontend-managed
    /// data, because the spawned task always runs before the frontend receives
    /// the DialogTurnCompleted event via the transport layer, and the existing
    /// disk data from debounced saves may have incomplete model rounds.
    async fn finalize_turn_in_workspace(
        session_id: &str,
        turn_id: &str,
        turn_index: usize,
        user_input: &str,
        workspace_path: &str,
        // Pre-resolved on-disk session storage path (mirror dir for remote workspaces).
        // When present we use it directly so we never re-resolve without remote SSH info
        // (which would derive a local workspace runtime id from a raw remote POSIX path).
        resolved_session_storage_path: Option<&std::path::Path>,
        status: crate::service::session::TurnStatus,
        user_message_metadata: Option<serde_json::Value>,
    ) {
        use crate::agentic::persistence::PersistenceManager;
        use crate::infrastructure::PathManager;
        use crate::service::session::{
            DialogTurnData, SessionMetadata, SessionStatus, UserMessageData,
        };

        let path_manager = match PathManager::new() {
            Ok(pm) => std::sync::Arc::new(pm),
            Err(_) => return,
        };

        let workspace_path_buf = match resolved_session_storage_path {
            Some(p) => p.to_path_buf(),
            None => std::path::PathBuf::from(workspace_path),
        };
        let persistence_manager = match PersistenceManager::new(path_manager) {
            Ok(manager) => manager,
            Err(_) => return,
        };

        if let Ok(Some(_existing)) = persistence_manager
            .load_dialog_turn(&workspace_path_buf, session_id, turn_index)
            .await
        {
            return;
        }

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        if let Ok(None) = persistence_manager
            .load_session_metadata(&workspace_path_buf, session_id)
            .await
        {
            let metadata = SessionMetadata {
                session_id: session_id.to_string(),
                session_name: "Recovered Session".to_string(),
                agent_type: "agentic".to_string(),
                created_by: None,
                session_kind: SessionKind::Standard,
                model_name: "default".to_string(),
                created_at: now_ms,
                last_active_at: now_ms,
                turn_count: 0,
                message_count: 0,
                tool_call_count: 0,
                status: SessionStatus::Active,
                terminal_session_id: None,
                snapshot_session_id: None,
                tags: Vec::new(),
                custom_metadata: None,
                todos: None,
                workspace_path: Some(workspace_path.to_string()),
                workspace_hostname: None,
                storage_scope: None,
            };
            if let Err(e) = persistence_manager
                .save_session_metadata(&workspace_path_buf, &metadata)
                .await
            {
                warn!(
                    "Failed to create fallback session metadata during turn finalization: session_id={}, error={}",
                    session_id, e
                );
                // Do not return: on read-only or transient IO errors we still try to persist the
                // minimal dialog turn so local/remote UI history is not silently empty.
            }
        }

        let mut turn_data = DialogTurnData::new(
            turn_id.to_string(),
            turn_index,
            session_id.to_string(),
            UserMessageData {
                id: format!("{}-user", turn_id),
                content: user_input.to_string(),
                timestamp: now_ms,
                metadata: user_message_metadata,
            },
        );
        turn_data.status = status;
        turn_data.end_time = Some(now_ms);
        turn_data.duration_ms = Some(now_ms.saturating_sub(turn_data.start_time));

        if let Err(e) = persistence_manager
            .save_dialog_turn(&workspace_path_buf, &turn_data)
            .await
        {
            warn!(
                "Failed to finalize turn in workspace: session_id={}, turn_index={}, error={}",
                session_id, turn_index, e
            );
        }
    }

    /// Create a hidden subagent session for internal AI execution.
    /// Unlike `create_session`, this does NOT emit `SessionCreated` to the transport layer,
    /// because hidden child sessions are internal implementation details of the execution engine
    /// and must never appear as top-level items in the UI.
    async fn create_hidden_subagent_session(
        &self,
        session_id: Option<String>,
        session_name: String,
        agent_type: String,
        config: SessionConfig,
        created_by: Option<String>,
    ) -> BitFunResult<Session> {
        self.session_manager
            .create_session_with_id_and_details(
                session_id,
                session_name,
                agent_type,
                config,
                created_by,
                SessionKind::Subagent,
            )
            .await
    }

    async fn load_session_context_messages(&self, session: &Session) -> BitFunResult<Vec<Message>> {
        let session_id = &session.session_id;
        let mut context_messages = self
            .session_manager
            .get_context_messages(session_id)
            .await?;

        if context_messages.is_empty() && !session.dialog_turn_ids.is_empty() {
            if let Some(workspace_path) = session.config.workspace_path.as_deref() {
                match self
                    .session_manager
                    .restore_session(Path::new(workspace_path), session_id)
                    .await
                {
                    Ok(_) => {
                        context_messages = self
                            .session_manager
                            .get_context_messages(session_id)
                            .await?;
                    }
                    Err(e) => {
                        debug!(
                            "Failed to restore parent session context for fork capture: session_id={}, error={}",
                            session_id, e
                        );
                    }
                }
            }
        }

        Ok(context_messages)
    }

    async fn wrap_user_input(
        &self,
        agent_type: &str,
        user_input: String,
        system_reminder_override: Option<&str>,
        workspace: Option<&WorkspaceBinding>,
    ) -> BitFunResult<String> {
        let agent_registry = get_agent_registry();
        if let Some(workspace) = workspace {
            agent_registry
                .load_custom_subagents(workspace.root_path())
                .await;
        }
        let current_agent = agent_registry
            .get_agent(agent_type, workspace.map(|binding| binding.root_path()))
            .ok_or_else(|| BitFunError::NotFound(format!("Agent not found: {}", agent_type)))?;
        let agent_system_reminder = current_agent.get_system_reminder(0).await?;

        let mut wrapped_user_input = if has_prompt_markup(&user_input) {
            user_input
        } else {
            let mut envelope = PromptEnvelope::new();
            envelope.push_user_query(user_input);
            envelope.render()
        };

        let mut reminder_blocks = Vec::new();
        if !agent_system_reminder.is_empty() {
            let mut envelope = PromptEnvelope::new();
            envelope.push_system_reminder(agent_system_reminder);
            reminder_blocks.push(envelope.render());
        }
        if let Some(override_text) = system_reminder_override
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let mut envelope = PromptEnvelope::new();
            envelope.push_system_reminder(override_text);
            reminder_blocks.push(envelope.render());
        }

        if !reminder_blocks.is_empty() {
            let mut combined = reminder_blocks.join("\n");
            if !wrapped_user_input.is_empty() {
                combined.push('\n');
                combined.push_str(&wrapped_user_input);
            }
            wrapped_user_input = combined;
        }
        Ok(wrapped_user_input)
    }

    fn schedule_auto_memory_queue_action(
        &self,
        session_id: &str,
        store_key: &str,
        queue_action: AutoMemoryQueueAction,
    ) {
        let Some(coordinator) = self.self_arc() else {
            return;
        };

        match queue_action {
            AutoMemoryQueueAction::Skip => {}
            AutoMemoryQueueAction::QueueNow => coordinator.auto_memory_manager.schedule_now(
                coordinator.clone(),
                session_id.to_string(),
                store_key.to_string(),
            ),
            AutoMemoryQueueAction::QueueAt { ready_at_ms } => {
                coordinator.auto_memory_manager.schedule_at(
                    coordinator.clone(),
                    session_id.to_string(),
                    store_key.to_string(),
                    ready_at_ms,
                )
            }
        }
    }

    /// Start a new dialog turn
    /// Note: Events are sent to frontend via EventLoop, no Stream returned.
    /// Submission behavior is controlled by `submission_policy`, which provides
    /// default per-source behavior while still allowing selective overrides.
    #[allow(clippy::too_many_arguments)]
    #[allow(clippy::too_many_arguments)]
    pub async fn start_dialog_turn(
        &self,
        session_id: String,
        user_input: String,
        original_user_input: Option<String>,
        turn_id: Option<String>,
        agent_type: String,
        system_reminder_override: Option<String>,
        workspace_path: Option<String>,
        submission_policy: DialogSubmissionPolicy,
        extra_user_message_metadata: Option<serde_json::Value>,
    ) -> BitFunResult<()> {
        self.start_dialog_turn_internal(
            session_id,
            user_input,
            original_user_input,
            None,
            turn_id,
            agent_type,
            system_reminder_override,
            workspace_path,
            submission_policy,
            extra_user_message_metadata,
            DialogExecutionSettings::default(),
            false,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn start_dialog_turn_with_image_contexts(
        &self,
        session_id: String,
        user_input: String,
        original_user_input: Option<String>,
        image_contexts: Vec<ImageContextData>,
        turn_id: Option<String>,
        agent_type: String,
        system_reminder_override: Option<String>,
        workspace_path: Option<String>,
        submission_policy: DialogSubmissionPolicy,
        extra_user_message_metadata: Option<serde_json::Value>,
    ) -> BitFunResult<()> {
        self.start_dialog_turn_internal(
            session_id,
            user_input,
            original_user_input,
            Some(image_contexts),
            turn_id,
            agent_type,
            system_reminder_override,
            workspace_path,
            submission_policy,
            extra_user_message_metadata,
            DialogExecutionSettings::default(),
            false,
        )
        .await
    }

    /// Compact the active session context as a persisted maintenance turn.
    pub async fn compact_session_manually(&self, session_id: String) -> BitFunResult<()> {
        let session = self
            .session_manager
            .get_session(&session_id)
            .ok_or_else(|| BitFunError::NotFound(format!("Session not found: {}", session_id)))?;

        match &session.state {
            SessionState::Idle => {}
            SessionState::Processing {
                current_turn_id,
                phase,
            } => {
                return Err(BitFunError::Validation(format!(
                    "Session is still processing: current_turn_id={}, phase={:?}",
                    current_turn_id, phase
                )));
            }
            SessionState::Error { error, .. } => {
                return Err(BitFunError::Validation(format!(
                    "Session must be idle before manual compaction: {}",
                    error
                )));
            }
        }

        let context_messages = self
            .session_manager
            .get_context_messages(&session_id)
            .await?;
        let needs_restore = if context_messages.is_empty() {
            true
        } else {
            context_messages.len() == 1 && !session.dialog_turn_ids.is_empty()
        };

        if needs_restore {
            let workspace_path = session.config.workspace_path.as_deref().ok_or_else(|| {
                BitFunError::Validation(format!(
                    "workspace_path is required when restoring session: {}",
                    session_id
                ))
            })?;
            self.session_manager
                .restore_session(Path::new(workspace_path), &session_id)
                .await?;
        }

        let context_messages = self
            .session_manager
            .get_context_messages(&session_id)
            .await?;
        let turn_index = self.session_manager.get_turn_count(&session_id);
        let user_message_metadata = Some(Self::manual_compaction_metadata());
        let turn_id = self
            .session_manager
            .start_maintenance_turn(
                &session_id,
                MANUAL_COMPACTION_COMMAND.to_string(),
                None,
                user_message_metadata.clone(),
            )
            .await?;

        self.emit_event(AgenticEvent::DialogTurnStarted {
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
            turn_index,
            user_input: MANUAL_COMPACTION_COMMAND.to_string(),
            original_user_input: None,
            user_message_metadata: user_message_metadata.clone(),
            surface_mode: SessionSurfaceMode::UserVisible,
            subagent_parent_info: None,
        })
        .await;

        let current_tokens = Self::estimate_context_tokens(&context_messages);
        let session_max_tokens = session.config.max_context_tokens;

        // Unify context_window: min(model capability, session config)
        let model_context_window =
            match crate::infrastructure::ai::get_global_ai_client_factory().await {
                Ok(factory) => {
                    let model_id = session.config.model_id.as_deref().unwrap_or("default");
                    match factory.get_client_resolved(model_id).await {
                        Ok(client) => Some(client.config.context_window as usize),
                        Err(_) => None,
                    }
                }
                Err(_) => None,
            };
        let context_window = match model_context_window {
            Some(mcw) => mcw.min(session_max_tokens),
            None => session_max_tokens,
        };
        let compression_threshold = session.config.compression_threshold;

        match self
            .execution_engine
            .compact_session_context(
                &session_id,
                &turn_id,
                context_messages,
                current_tokens,
                context_window,
                "manual",
                crate::agentic::session::CompressionTailPolicy::CollapseAll,
            )
            .await
        {
            Ok(outcome) => {
                let model_round = Self::build_manual_compaction_round_completed(
                    &turn_id,
                    &outcome,
                    context_window,
                    compression_threshold,
                );
                self.session_manager
                    .complete_maintenance_turn(
                        &session_id,
                        &turn_id,
                        vec![model_round],
                        outcome.duration_ms,
                    )
                    .await?;
                self.session_manager
                    .update_session_state(&session_id, SessionState::Idle)
                    .await?;

                self.emit_event(AgenticEvent::DialogTurnCompleted {
                    session_id,
                    turn_id,
                    total_rounds: 1,
                    total_tools: 1,
                    duration_ms: outcome.duration_ms,
                    hidden_session: !matches!(
                        surface_mode_for_session(&session),
                        SessionSurfaceMode::UserVisible
                    ),
                    surface_mode: surface_mode_for_session(&session),
                    subagent_parent_info: None,
                })
                .await;

                Ok(())
            }
            Err(err) => {
                let error_text = err.to_string();
                let compression_id = format!("compression_{}", uuid::Uuid::new_v4());
                let model_round = Self::build_manual_compaction_round_failed(
                    &turn_id,
                    compression_id,
                    &error_text,
                    context_window,
                    compression_threshold,
                );
                let _ = self
                    .session_manager
                    .fail_maintenance_turn(
                        &session_id,
                        &turn_id,
                        error_text.clone(),
                        vec![model_round],
                    )
                    .await;
                let _ = self
                    .session_manager
                    .update_session_state(&session_id, SessionState::Idle)
                    .await;
                self.emit_event(AgenticEvent::DialogTurnFailed {
                    session_id,
                    turn_id,
                    error: error_text.clone(),
                    surface_mode: surface_mode_for_session(&session),
                    subagent_parent_info: None,
                })
                .await;
                Err(err)
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn start_dialog_turn_internal(
        &self,
        session_id: String,
        user_input: String,
        original_user_input: Option<String>,
        image_contexts: Option<Vec<ImageContextData>>,
        turn_id: Option<String>,
        agent_type: String,
        system_reminder_override: Option<String>,
        workspace_path: Option<String>,
        submission_policy: DialogSubmissionPolicy,
        extra_user_message_metadata: Option<serde_json::Value>,
        execution_settings: DialogExecutionSettings,
        suppress_session_title_generation: bool,
    ) -> BitFunResult<()> {
        // Get latest session, restoring from persistence on demand so every entry
        // point can use the same start_dialog_turn flow.
        let session = match self.session_manager.get_session(&session_id) {
            Some(session) => session,
            None => {
                debug!(
                    "Session not found in memory, attempting restore before starting dialog: session_id={}",
                    session_id
                );
                let workspace_path = workspace_path.clone().ok_or_else(|| {
                    BitFunError::Validation(format!(
                        "workspace_path is required when restoring session: {}",
                        session_id
                    ))
                })?;
                self.session_manager
                    .restore_session(Path::new(&workspace_path), &session_id)
                    .await?
            }
        };

        let requested_agent_type = agent_type.trim().to_string();
        let provisional_agent_type = if !requested_agent_type.is_empty() {
            requested_agent_type.clone()
        } else if !session.agent_type.is_empty() {
            session.agent_type.clone()
        } else {
            "agentic".to_string()
        };
        let effective_agent_type = Self::normalize_agent_type(&provisional_agent_type);

        Self::track_session_workspace_activity_best_effort(&session.config, "dialog_started").await;

        debug!(
            "Resolved dialog turn agent type: session_id={}, turn_id={}, requested_agent_type={}, session_agent_type={}, effective_agent_type={}, trigger_source={:?}, queue_priority={:?}, skip_tool_confirmation={}, persist_agent_type={}",
            session_id,
            turn_id.as_deref().unwrap_or(""),
            if requested_agent_type.is_empty() {
                "<empty>"
            } else {
                requested_agent_type.as_str()
            },
            if session.agent_type.is_empty() {
                "<empty>"
            } else {
                session.agent_type.as_str()
            },
            effective_agent_type,
            submission_policy.trigger_source,
            submission_policy.queue_priority,
            submission_policy.skip_tool_confirmation,
            submission_policy.persist_agent_type
        );
        if let Some(tool_allowlist_override) = execution_settings.tool_allowlist_override.as_ref() {
            debug!(
                "Applying dialog tool allowlist override: session_id={}, turn_id={}, tool_count={}, tools={:?}",
                session_id,
                turn_id.as_deref().unwrap_or(""),
                tool_allowlist_override.len(),
                tool_allowlist_override
            );
        }

        if submission_policy.persist_agent_type && session.agent_type != effective_agent_type {
            self.session_manager
                .update_session_agent_type(&session_id, &effective_agent_type)
                .await?;
        }

        debug!(
            "Checking session state: session_id={}, state={:?}",
            session_id, session.state
        );

        // Check session state
        // Allow Idle or any error state (user can retry after error)
        // If Processing, cancel request hasn't arrived yet, reject new dialog
        match &session.state {
            SessionState::Idle => {
                debug!(
                    "Session state is Idle, allowing new dialog: session_id={}",
                    session_id
                );
            }
            SessionState::Error { .. } => {
                debug!(
                    "Session in error state, allowing new dialog (user retry): session_id={}",
                    session_id
                );
            }
            SessionState::Processing {
                current_turn_id,
                phase,
            } => {
                warn!(
                    "Session still processing, rejecting new dialog: session_id={}, current_turn_id={}, phase={:?}",
                    session_id,
                    current_turn_id,
                    phase
                );
                return Err(BitFunError::Validation(format!(
                    "Session state does not allow starting new dialog: {:?}",
                    session.state
                )));
            }
        }

        // Ensure session history is loaded into memory
        // Critical fix: prevent unloaded history after app restart
        let context_messages = self
            .session_manager
            .get_context_messages(&session_id)
            .await?;

        // Check if restore is needed:
        // - Empty context needs restore
        // - Only 1 message (likely just system prompt) with existing turns needs restore
        // - Sessions with multiple turns should have > 1 messages (at least system + user + assistant)
        let needs_restore = if context_messages.is_empty() {
            debug!(
                "Session {} context is empty, restoring from persistence",
                session_id
            );
            true
        } else if context_messages.len() == 1 && !session.dialog_turn_ids.is_empty() {
            debug!(
                "Session {} has {} turns but only {} messages, restoring history",
                session_id,
                session.dialog_turn_ids.len(),
                context_messages.len()
            );
            true
        } else {
            debug!(
                "Session {} context exists ({} messages, {} turns), no restore needed",
                session_id,
                context_messages.len(),
                session.dialog_turn_ids.len()
            );
            false
        };

        if needs_restore {
            debug!(
                "Starting session history restore: session_id={}",
                session_id
            );
            match self
                .session_manager
                .restore_session(
                    Path::new(
                        session
                            .config
                            .workspace_path
                            .as_deref()
                            .or(workspace_path.as_deref())
                            .ok_or_else(|| {
                                BitFunError::Validation(format!(
                                    "workspace_path is required when restoring session: {}",
                                    session_id
                                ))
                            })?,
                    ),
                    &session_id,
                )
                .await
            {
                Ok(_) => {
                    let restored_messages = self
                        .session_manager
                        .get_context_messages(&session_id)
                        .await?;
                    info!(
                        "Session history restored from persistence: session_id={}, messages: {} -> {}",
                        session_id,
                        context_messages.len(),
                        restored_messages.len()
                    );
                }
                Err(e) => {
                    debug!(
                        "Failed to restore session history (may be new session): session_id={}, error={}",
                        session_id,
                        e
                    );
                }
            }
        }

        self.auto_memory_manager.cancel_session(&session_id);

        let original_user_input = original_user_input.unwrap_or_else(|| user_input.clone());

        let mut user_message_metadata = extra_user_message_metadata;

        // Build image metadata for workspace turn persistence (before image_contexts is consumed)
        // Also stores original_text so the UI can display the user's actual input
        // instead of the vision-enhanced text.
        if let Some(imgs) = image_contexts.as_ref().filter(|imgs| !imgs.is_empty()) {
            let image_meta: Vec<serde_json::Value> = imgs
                .iter()
                .map(|img| {
                    let name = img
                        .metadata
                        .as_ref()
                        .and_then(|m| m.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("image.png");
                    let mut meta = serde_json::json!({
                        "id": &img.id,
                        "name": name,
                        "mime_type": &img.mime_type,
                    });
                    if let Some(url) = &img.data_url {
                        meta["data_url"] = serde_json::json!(url);
                    }
                    if let Some(path) = &img.image_path {
                        meta["image_path"] = serde_json::json!(path);
                    }
                    meta
                })
                .collect();

            let mut metadata =
                Self::ensure_user_message_metadata_object(user_message_metadata.take());
            if let Some(obj) = metadata.as_object_mut() {
                obj.insert("images".to_string(), serde_json::json!(image_meta));
                obj.insert(
                    "original_text".to_string(),
                    serde_json::json!(original_user_input.clone()),
                );
            }
            user_message_metadata = Some(metadata);
        }

        let session_workspace = Self::build_workspace_binding(&session.config).await;

        // Build WorkspaceServices based on the workspace type
        let workspace_services = Self::build_workspace_services(&session_workspace).await;

        info!(
            "Dialog turn workspace context: session_id={}, workspace_path={:?}, is_remote={}, workspace_services={}",
            session_id,
            session.config.workspace_path,
            session_workspace.as_ref().map(|ws| ws.is_remote()).unwrap_or(false),
            if workspace_services.is_some() { "available" } else { "NONE" }
        );

        let wrapped_user_input = self
            .wrap_user_input(
                &effective_agent_type,
                user_input,
                system_reminder_override.as_deref(),
                session_workspace.as_ref(),
            )
            .await?;

        if original_user_input != wrapped_user_input {
            let mut metadata =
                Self::ensure_user_message_metadata_object(user_message_metadata.take());
            if let Some(obj) = metadata.as_object_mut() {
                obj.insert(
                    "original_text".to_string(),
                    serde_json::json!(original_user_input.clone()),
                );
            }
            user_message_metadata = Some(metadata);
        }

        // Inject trigger source into metadata so the frontend can distinguish human
        // user input from agent-session notifications, scheduled jobs, bots, etc.
        {
            let trigger_source_str = match submission_policy.trigger_source {
                DialogTriggerSource::DesktopUi => "desktop_ui",
                DialogTriggerSource::DesktopApi => "desktop_api",
                DialogTriggerSource::AgentSession => "agent_session",
                DialogTriggerSource::ScheduledJob => "scheduled_job",
                DialogTriggerSource::Bot => "bot",
                DialogTriggerSource::Cli => "cli",
                DialogTriggerSource::RemoteRelay => "remote_relay",
            };
            let mut metadata =
                Self::ensure_user_message_metadata_object(user_message_metadata.take());
            if let Some(obj) = metadata.as_object_mut() {
                obj.insert(
                    "triggerSource".to_string(),
                    serde_json::json!(trigger_source_str),
                );
            }
            user_message_metadata = Some(metadata);
        }

        // Start new dialog turn (sets state to Processing internally)
        let turn_index = self.session_manager.get_turn_count(&session_id);
        // Pass frontend turnId, generate if not provided
        let turn_id = self
            .session_manager
            .start_dialog_turn(
                &session_id,
                wrapped_user_input.clone(),
                turn_id,
                image_contexts,
                user_message_metadata.clone(),
            )
            .await?;

        // Send dialog turn started event with original input and image metadata
        // so all frontends (desktop, mobile, bot) can display correctly.
        self.emit_event(AgenticEvent::DialogTurnStarted {
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
            turn_index,
            user_input: wrapped_user_input.clone(),
            original_user_input: if original_user_input != wrapped_user_input {
                Some(original_user_input.clone())
            } else {
                None
            },
            user_message_metadata: user_message_metadata.clone(),
            surface_mode: execution_settings.surface_mode,
            subagent_parent_info: None,
        })
        .await;

        // Get context messages (re-fetch as history may have been restored)
        let messages = self
            .session_manager
            .get_context_messages(&session_id)
            .await?;

        // Create execution context (pass full config and resource IDs)
        let mut context_vars = std::collections::HashMap::new();
        context_vars.insert(
            "max_context_tokens".to_string(),
            session.config.max_context_tokens.to_string(),
        );
        context_vars.insert(
            "enable_tools".to_string(),
            session.config.enable_tools.to_string(),
        );
        context_vars.insert(
            "original_user_input".to_string(),
            original_user_input.clone(),
        );

        // Pass model_id for token usage tracking
        if let Some(model_id) = &session.config.model_id {
            context_vars.insert("model_name".to_string(), model_id.clone());
        }

        // Pass snapshot session ID
        if let Some(snapshot_id) = &session.snapshot_session_id {
            context_vars.insert("snapshot_session_id".to_string(), snapshot_id.clone());
        }

        // Pass turn_index (for operation history/rollback)
        context_vars.insert("turn_index".to_string(), turn_index.to_string());
        let session_workspace_path = session_workspace
            .as_ref()
            .map(|workspace| workspace.root_path_string());
        // Pre-resolve the on-disk session storage path for the bound workspace root.
        let session_storage_path = session_workspace
            .as_ref()
            .map(|workspace| workspace.session_storage_path().to_path_buf());

        let (workspace_mount, agentic) = self.build_execution_handles(
            session
                .config
                .workspace_path
                .as_deref()
                .map(std::path::Path::new),
        );
        let execution_context = ExecutionContext {
            session_id: session_id.clone(),
            dialog_turn_id: turn_id.clone(),
            turn_index,
            agent_type: effective_agent_type.clone(),
            surface_mode: execution_settings.surface_mode,
            workspace: session_workspace,
            context: context_vars,
            tool_allowlist_override: execution_settings.tool_allowlist_override,
            subagent_parent_info: None,
            skip_tool_confirmation: submission_policy.skip_tool_confirmation,
            runtime_tool_restrictions: execution_settings.runtime_tool_restrictions,
            workspace_services,
            workspace_mount,
            agentic,
            round_preempt: self.round_preempt_source.get().cloned(),
        };

        // Auto-generate session title on first message
        if turn_index == 0 && !suppress_session_title_generation {
            let sm = self.session_manager.clone();
            let eq = self.event_queue.clone();
            let sid = session_id.clone();
            let msg = original_user_input;
            let expected_title = self
                .session_manager
                .get_session(&session_id)
                .map(|session| session.session_name)
                .unwrap_or_default();
            tokio::spawn(async move {
                let allow_ai = is_ai_session_title_generation_enabled().await;
                let resolved = sm.resolve_session_title(&msg, Some(20), allow_ai).await;

                match sm
                    .update_session_title_if_current(&sid, &expected_title, &resolved.title)
                    .await
                {
                    Ok(true) => {
                        let _ = eq
                            .enqueue(
                                AgenticEvent::SessionTitleGenerated {
                                    session_id: sid,
                                    title: resolved.title,
                                    method: resolved.method.as_str().to_string(),
                                },
                                Some(EventPriority::Normal),
                            )
                            .await;
                    }
                    Ok(false) => {
                        debug!("Skipped auto session title update because title changed");
                    }
                    Err(error) => {
                        debug!("Auto session title generation failed to apply: {error}");
                    }
                }
            });
        }

        // Start async execution task
        let session_manager = self.session_manager.clone();
        let execution_engine = self.execution_engine.clone();
        let event_queue = self.event_queue.clone();
        let session_id_clone = session_id.clone();
        let turn_id_clone = turn_id.clone();
        let user_input_for_workspace = wrapped_user_input.clone();
        let session_storage_path_for_finalize = session_storage_path.clone();
        let effective_agent_type_clone = effective_agent_type.clone();
        let user_message_metadata_clone = user_message_metadata;
        let scheduler_notify_tx = self.scheduler_notify_tx.get().cloned();
        let session_kind = session.kind;
        let auto_memory_context = resolve_local_auto_memory_context(&session);
        let coordinator_for_spawn = self.self_arc();

        tokio::spawn(async move {
            // Note: Don't check cancellation here as cancel token hasn't been created yet
            // Cancel token is created in execute_dialog_turn -> execute_round
            // execute_dialog_turn has proper cancellation checks internally

            let _ = session_manager
                .update_session_state(
                    &session_id_clone,
                    SessionState::Processing {
                        current_turn_id: turn_id_clone.clone(),
                        phase: ProcessingPhase::Thinking,
                    },
                )
                .await;

            let workspace_turn_status = match execution_engine
                .execute_dialog_turn(effective_agent_type_clone, messages, execution_context)
                .await
            {
                Ok(execution_result) => {
                    let final_response = match &execution_result.final_message.content {
                        MessageContent::Text(text) => text.clone(),
                        MessageContent::Mixed { text, .. } => text.clone(),
                        _ => String::new(),
                    };
                    info!(
                        "Dialog turn completed: session={}, turn={}, rounds={}",
                        session_id_clone, turn_id_clone, execution_result.total_rounds
                    );

                    let _ = session_manager
                        .complete_dialog_turn(
                            &session_id_clone,
                            &turn_id_clone,
                            final_response.clone(),
                            TurnStats {
                                total_rounds: execution_result.total_rounds,
                                total_tools: 0, // TODO: get from execution_result
                                total_tokens: 0,
                                duration_ms: 0,
                            },
                        )
                        .await;

                    let _ = session_manager
                        .update_session_state(&session_id_clone, SessionState::Idle)
                        .await;

                    let auto_memory_followup = handle_auto_memory_after_completed_turn(
                        session_manager.as_ref(),
                        &session_id_clone,
                        &turn_id_clone,
                        session_kind,
                        auto_memory_context.clone(),
                        current_time_ms(),
                    )
                    .await;

                    if let Some(AutoMemoryCompletedTurnFollowup {
                        store_key,
                        queue_action,
                    }) = auto_memory_followup
                    {
                        if let Some(coord) = coordinator_for_spawn.as_ref() {
                            coord.schedule_auto_memory_queue_action(
                                &session_id_clone,
                                &store_key,
                                queue_action,
                            );
                        }
                    }

                    if let Some(tx) = &scheduler_notify_tx {
                        let _ = tx.try_send((
                            session_id_clone.clone(),
                            TurnOutcome::Completed {
                                turn_id: turn_id_clone.clone(),
                                final_response,
                            },
                        ));
                    }

                    Some(crate::service::session::TurnStatus::Completed)
                }
                Err(e) => {
                    let is_cancellation = matches!(&e, BitFunError::Cancelled(_));

                    if is_cancellation {
                        info!(
                            "Dialog turn cancelled: session={}, turn={}",
                            session_id_clone, turn_id_clone
                        );

                        // The execution engine only emits DialogTurnCancelled when
                        // cancellation is detected between rounds.  If cancellation
                        // interrupted streaming mid-round, no event was emitted.
                        // Emit it here unconditionally (duplicates are harmless).
                        let _ = event_queue
                            .enqueue(
                                AgenticEvent::DialogTurnCancelled {
                                    session_id: session_id_clone.clone(),
                                    turn_id: turn_id_clone.clone(),
                                    surface_mode: SessionSurfaceMode::UserVisible,
                                    subagent_parent_info: None,
                                },
                                Some(EventPriority::Critical),
                            )
                            .await;

                        // Mark the turn as completed in persistence so its partial
                        // content appears in historical messages (turns_to_chat_messages
                        // skips InProgress turns).
                        let _ = session_manager
                            .complete_dialog_turn(
                                &session_id_clone,
                                &turn_id_clone,
                                String::new(),
                                TurnStats {
                                    total_rounds: 0,
                                    total_tools: 0,
                                    total_tokens: 0,
                                    duration_ms: 0,
                                },
                            )
                            .await;

                        let _ = session_manager
                            .update_session_state(&session_id_clone, SessionState::Idle)
                            .await;

                        if let Some(tx) = &scheduler_notify_tx {
                            let _ = tx.try_send((
                                session_id_clone.clone(),
                                TurnOutcome::Cancelled {
                                    turn_id: turn_id_clone.clone(),
                                },
                            ));
                        }

                        Some(crate::service::session::TurnStatus::Cancelled)
                    } else {
                        let error_text = e.to_string();
                        error!("Dialog turn execution failed: {}", error_text);

                        let recoverable =
                            !matches!(&e, BitFunError::AIClient(_) | BitFunError::Timeout(_));

                        let _ = event_queue
                            .enqueue(
                                AgenticEvent::DialogTurnFailed {
                                    session_id: session_id_clone.clone(),
                                    turn_id: turn_id_clone.clone(),
                                    error: error_text.clone(),
                                    surface_mode: SessionSurfaceMode::UserVisible,
                                    subagent_parent_info: None,
                                },
                                Some(EventPriority::Critical),
                            )
                            .await;

                        let _ = session_manager
                            .fail_dialog_turn(&session_id_clone, &turn_id_clone, error_text.clone())
                            .await;

                        let _ = session_manager
                            .update_session_state(
                                &session_id_clone,
                                SessionState::Error {
                                    error: error_text.clone(),
                                    recoverable,
                                },
                            )
                            .await;

                        if let Some(tx) = &scheduler_notify_tx {
                            let _ = tx.try_send((
                                session_id_clone.clone(),
                                TurnOutcome::Failed {
                                    turn_id: turn_id_clone.clone(),
                                    error: error_text,
                                },
                            ));
                        }

                        Some(crate::service::session::TurnStatus::Error)
                    }
                }
            };

            let should_finalize_in_workspace =
                session_manager.should_persist_session_id(&session_id_clone);

            if should_finalize_in_workspace {
                if let (Some(ref wp), Some(status)) =
                    (&session_workspace_path, workspace_turn_status)
                {
                    Self::finalize_turn_in_workspace(
                        &session_id_clone,
                        &turn_id_clone,
                        turn_index,
                        &user_input_for_workspace,
                        wp,
                        session_storage_path_for_finalize.as_deref(),
                        status,
                        user_message_metadata_clone,
                    )
                    .await;
                }
            }
        });

        Ok(())
    }

    pub fn cancel_auto_memory_for_session(&self, session_id: &str) {
        self.auto_memory_manager.cancel_session(session_id);
    }

    pub async fn next_auto_memory_queue_action(&self, session_id: &str) -> AutoMemoryQueueAction {
        let Some(session) = self.session_manager.get_session(session_id) else {
            return AutoMemoryQueueAction::Skip;
        };

        if !session_can_consider_auto_memory(&session) {
            return AutoMemoryQueueAction::Skip;
        }

        let Some(auto_memory_context) = resolve_auto_memory_runtime_context(&session).await else {
            return AutoMemoryQueueAction::Skip;
        };

        if !auto_memory_context.scope_config.enabled {
            return AutoMemoryQueueAction::Skip;
        }

        if self
            .session_manager
            .next_auto_memory_cursor(session_id)
            .is_none()
        {
            return AutoMemoryQueueAction::Skip;
        }

        let now_ms = current_time_ms();
        match self.session_manager.auto_memory_schedule_decision(
            session_id,
            auto_memory_context.policy,
            now_ms,
        ) {
            Ok(schedule_decision) => queue_action_from_schedule_decision(schedule_decision),
            Err(_) => AutoMemoryQueueAction::Skip,
        }
    }

    pub async fn has_pending_auto_memory(&self, session_id: &str) -> bool {
        !matches!(
            self.next_auto_memory_queue_action(session_id).await,
            AutoMemoryQueueAction::Skip
        )
    }

    async fn refresh_session_summary_after_auto_memory(
        &self,
        session_id: &str,
        session_agent_type: &str,
        snapshot: ForkAgentContextSnapshot,
        summary_date_key: &str,
        cancel_token: &CancellationToken,
    ) -> BitFunResult<()> {
        if cancel_token.is_cancelled() {
            return Err(BitFunError::Cancelled(
                "Session summary task has been cancelled".to_string(),
            ));
        }

        let summary_path = self
            .session_manager
            .session_summary_path(session_id)
            .await?;
        let prompt = build_session_summary_prompt(summary_path.as_path())?;

        let _result = self
            .execute_fork_agent(
                ForkAgentExecutionRequest {
                    snapshot,
                    agent_type: session_agent_type.to_string(),
                    description: "Session summary refresh".to_string(),
                    prompt_messages: vec![Message::user(prompt)],
                    context: HashMap::new(),
                    runtime_tool_restrictions: build_session_summary_runtime_restrictions(
                        &summary_path.to_string_lossy().replace('\\', "/"),
                    ),
                    max_turns: Some(SESSION_SUMMARY_FORK_MAX_TURNS),
                },
                Some(cancel_token),
            )
            .await?;

        archive_session_daily_summary(session_id, self.session_manager.as_ref(), summary_date_key)
            .await?;

        Ok(())
    }

    pub async fn run_auto_memory_cycle(
        &self,
        session_id: &str,
        cancel_token: &CancellationToken,
    ) -> BitFunResult<bool> {
        if cancel_token.is_cancelled() {
            return Err(BitFunError::Cancelled(
                "Auto memory task has been cancelled".to_string(),
            ));
        }

        let Some(session) = self.session_manager.get_session(session_id) else {
            return Ok(false);
        };

        if !session_can_consider_auto_memory(&session) {
            return Ok(false);
        }

        if resolve_local_auto_memory_context(&session).is_none() {
            return Ok(false);
        }

        let queue_action = self.next_auto_memory_queue_action(session_id).await;
        match queue_action {
            AutoMemoryQueueAction::Skip => return Ok(false),
            AutoMemoryQueueAction::QueueAt { ready_at_ms } => {
                debug!(
                    "Deferring auto memory cycle until cooldown expires: session_id={}, ready_at_ms={}",
                    session_id, ready_at_ms
                );
                return Ok(false);
            }
            AutoMemoryQueueAction::QueueNow => {}
        }

        let Some(cursor) = self.session_manager.next_auto_memory_cursor(session_id) else {
            return Ok(false);
        };
        debug!(
            "Starting auto memory cycle: session_id={}, from_turn={}, through_turn={}, history_revision={}",
            session_id, cursor.from_turn, cursor.through_turn, cursor.history_revision
        );

        let cycle_result = async {
            let pending_turns = self
                .session_manager
                .load_turns_in_range(session_id, cursor.from_turn, cursor.through_turn)
                .await?;
            let summary_date_key = pending_turns
                .iter()
                .filter(|turn| turn.kind.is_model_visible())
                .map(|turn| turn.end_time.unwrap_or(turn.start_time))
                .max()
                .map(local_date_key_from_unix_ms)
                .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());
            let has_model_visible_turns = pending_turns
                .iter()
                .any(|turn| turn.kind.is_model_visible());

            if !has_model_visible_turns {
                let consumed_at_ms = current_time_ms();
                let advanced = self
                    .session_manager
                    .complete_auto_memory_extraction_if_revision_matches(
                        session_id,
                        cursor.through_turn,
                        cursor.history_revision,
                        consumed_at_ms,
                    )
                    .await?;
                let _ = advanced;
                return Ok(true);
            }

            if cancel_token.is_cancelled() {
                return Err(BitFunError::Cancelled(
                    "Auto memory task has been cancelled".to_string(),
                ));
            }

            let workspace_root =
                PathBuf::from(session.config.workspace_path.clone().ok_or_else(|| {
                    BitFunError::Validation(format!(
                        "Session workspace_path is missing: {}",
                        session_id
                    ))
                })?);
            let memory_scope = resolve_auto_memory_scope(&session.agent_type, &workspace_root);
            let memory_target = match memory_scope {
                MemoryScope::WorkspaceProject => {
                    MemoryStoreTarget::WorkspaceProject(workspace_root.as_path())
                }
                MemoryScope::GlobalAgenticOs => MemoryStoreTarget::GlobalAgenticOs,
            };
            ensure_memory_store_for_target(memory_target).await?;
            let memory_dir = memory_store_dir_path_for_target(memory_target);
            let memory_dir_display = memory_dir.to_string_lossy().replace('\\', "/");
            let existing_memories = build_memory_manifest_for_target(memory_target).await?;
            let snapshot = self.capture_fork_agent_context_snapshot(session_id).await?;
            let recent_message_count = count_recent_model_visible_messages(
                &snapshot.messages,
                cursor
                    .from_turn
                    .checked_sub(1)
                    .and_then(|index| session.dialog_turn_ids.get(index))
                    .map(String::as_str),
            );

            let prompt = build_extract_prompt(
                recent_message_count,
                &memory_dir_display,
                existing_memories.as_deref(),
                memory_scope,
            );
            let mut fork_context = HashMap::new();
            fork_context.insert("origin_session_id".to_string(), session_id.to_string());

            debug!(
                "Launching auto memory fork: session_id={}, from_turn={}, through_turn={}, pending_turns={}, recent_message_count={}, inherited_messages={}, has_existing_memory_manifest={}, scope={}",
                session_id,
                cursor.from_turn,
                cursor.through_turn,
                pending_turns.len(),
                recent_message_count,
                snapshot.inherited_message_count(),
                existing_memories.is_some(),
                memory_scope.as_label()
            );

            let result = self
                .execute_fork_agent(
                    ForkAgentExecutionRequest {
                        snapshot: snapshot.clone(),
                        agent_type: session.agent_type.clone(),
                        description: "Auto memory extraction".to_string(),
                        prompt_messages: vec![Message::user(prompt)],
                        context: fork_context,
                        runtime_tool_restrictions: build_auto_memory_runtime_restrictions(
                            &memory_dir.to_string_lossy(),
                        ),
                        max_turns: Some(AUTO_MEMORY_FORK_MAX_TURNS),
                    },
                    Some(cancel_token),
                )
                .await?;

            debug!(
                "Auto memory fork completed: session_id={}, from_turn={}, through_turn={}, inherited_messages={}, prompt_messages={}, child_text_len={}",
                session_id,
                cursor.from_turn,
                cursor.through_turn,
                result.inherited_message_count,
                result.prompt_message_count,
                result.text.len()
            );

            self.refresh_session_summary_after_auto_memory(
                session_id,
                &session.agent_type,
                snapshot,
                &summary_date_key,
                cancel_token,
            )
            .await?;

            let consumed_at_ms = current_time_ms();
            let advanced = self
                .session_manager
                .complete_auto_memory_extraction_if_revision_matches(
                    session_id,
                    cursor.through_turn,
                    cursor.history_revision,
                    consumed_at_ms,
                )
                .await?;
            let _ = advanced;

            Ok(true)
        }
        .await;

        cycle_result
    }
    /// Cancel dialog turn execution
    /// Immediately set state to Idle to allow new dialog, old turn ends naturally via cancel token
    pub async fn cancel_dialog_turn(
        &self,
        session_id: &str,
        dialog_turn_id: &str,
    ) -> BitFunResult<()> {
        info!(
            "Received cancel request: dialog_turn_id={}, session_id={}",
            dialog_turn_id, session_id
        );

        let old_state = self
            .session_manager
            .get_session(session_id)
            .map(|s| format!("{:?}", s.state))
            .unwrap_or_else(|| "Unknown".to_string());
        debug!("Current state: {}", old_state);

        // Step 1: Immediately update session state to Idle (non-blocking, allows immediate new dialog)
        debug!("Updating session state to Idle");
        self.session_manager
            .update_session_state(session_id, SessionState::Idle)
            .await?;

        let new_state = self
            .session_manager
            .get_session(session_id)
            .map(|s| format!("{:?}", s.state))
            .unwrap_or_else(|| "Unknown".to_string());
        debug!("State updated: {} -> {}", old_state, new_state);

        // Step 2: Immediately send state change event (notify frontend can start new dialog)
        self.emit_event(AgenticEvent::SessionStateChanged {
            session_id: session_id.to_string(),
            new_state: "idle".to_string(),
        })
        .await;
        debug!("Session state change event sent");

        // Step 3: Notify the scheduler immediately so that any agent-session reply_route
        // (e.g. Dispatcher waiting for a sub-agent to finish) is forwarded without delay.
        // The execution task will also send TurnOutcome::Cancelled once the in-flight AI
        // call returns, but by then active_turns will already have been removed, making
        // the second forward_agent_session_reply call a no-op.
        if let Some(tx) = self.scheduler_notify_tx.get() {
            let _ = tx.try_send((
                session_id.to_string(),
                TurnOutcome::Cancelled {
                    turn_id: dialog_turn_id.to_string(),
                },
            ));
            debug!(
                "Immediately notified scheduler of cancellation: session_id={}, turn_id={}",
                session_id, dialog_turn_id
            );
        }

        // Step 4: Async cleanup of old turn (let it end naturally via cancel token, non-blocking)
        let execution_engine = self.execution_engine.clone();
        let tool_pipeline = self.tool_pipeline.clone();
        let dialog_turn_id_clone = dialog_turn_id.to_string();

        tokio::spawn(async move {
            debug!(
                "Starting async cleanup for cancelled turn: {}",
                dialog_turn_id_clone
            );

            if let Err(e) = execution_engine
                .cancel_dialog_turn(&dialog_turn_id_clone)
                .await
            {
                warn!("Failed to cancel execution engine: {}", e);
            }

            if let Err(e) = tool_pipeline
                .cancel_dialog_turn_tools(&dialog_turn_id_clone)
                .await
            {
                warn!("Failed to cancel tool execution: {}", e);
            }

            debug!("Async cleanup completed: {}", dialog_turn_id_clone);
        });

        Ok(())
    }

    pub async fn cancel_active_turn_for_session(
        &self,
        session_id: &str,
        wait_timeout: Duration,
    ) -> BitFunResult<Option<String>> {
        let Some(session) = self.session_manager.get_session(session_id) else {
            return Ok(None);
        };

        let SessionState::Processing {
            current_turn_id, ..
        } = session.state
        else {
            return Ok(None);
        };

        self.cancel_dialog_turn(session_id, &current_turn_id)
            .await?;

        let deadline = Instant::now() + wait_timeout;
        while self.execution_engine.has_active_turn(&current_turn_id) {
            if Instant::now() >= deadline {
                warn!(
                    "Timed out waiting for active turn cancellation: session_id={}, dialog_turn_id={}, timeout_ms={}",
                    session_id,
                    current_turn_id,
                    wait_timeout.as_millis()
                );
                break;
            }
            sleep(Duration::from_millis(50)).await;
        }

        Ok(Some(current_turn_id))
    }

    /// Delete session
    pub async fn delete_session(
        &self,
        workspace_path: &Path,
        session_id: &str,
    ) -> BitFunResult<()> {
        self.auto_memory_manager.cancel_session(session_id);
        self.session_manager
            .delete_session(workspace_path, session_id)
            .await?;
        self.emit_event(AgenticEvent::SessionDeleted {
            session_id: session_id.to_string(),
        })
        .await;
        Ok(())
    }

    /// Restore session
    pub async fn restore_session(
        &self,
        workspace_path: &Path,
        session_id: &str,
    ) -> BitFunResult<Session> {
        self.session_manager
            .restore_session(workspace_path, session_id)
            .await
    }

    /// List all sessions
    pub async fn list_sessions(&self, workspace_path: &Path) -> BitFunResult<Vec<SessionSummary>> {
        self.session_manager.list_sessions(workspace_path).await
    }

    /// Get a best-effort message view for a session.
    pub async fn get_messages(&self, session_id: &str) -> BitFunResult<Vec<Message>> {
        self.session_manager.get_messages(session_id).await
    }

    /// Get a paginated best-effort message view for a session.
    pub async fn get_messages_paginated(
        &self,
        session_id: &str,
        limit: usize,
        before_message_id: Option<&str>,
    ) -> BitFunResult<(Vec<Message>, bool)> {
        self.session_manager
            .get_messages_paginated(session_id, limit, before_message_id)
            .await
    }

    /// Subscribe to internal events
    ///
    /// For internal systems to subscribe to events (e.g., logging, monitoring)
    pub fn subscribe_internal<H>(&self, subscriber_id: String, handler: H)
    where
        H: EventSubscriber + 'static,
    {
        self.event_router
            .subscribe_internal(subscriber_id, Arc::new(handler));
    }

    /// Unsubscribe from internal events
    ///
    /// Remove subscriber previously added via subscribe_internal
    pub fn unsubscribe_internal(&self, subscriber_id: &str) {
        self.event_router.unsubscribe_internal(subscriber_id);
    }

    /// Confirm tool execution
    pub async fn confirm_tool(
        &self,
        tool_id: &str,
        updated_input: Option<serde_json::Value>,
    ) -> BitFunResult<()> {
        self.tool_pipeline
            .confirm_tool(tool_id, updated_input)
            .await
    }

    /// Reject tool execution
    pub async fn reject_tool(&self, tool_id: &str, reason: String) -> BitFunResult<()> {
        self.tool_pipeline.reject_tool(tool_id, reason).await
    }

    /// Cancel tool execution
    pub async fn cancel_tool(&self, tool_id: &str, reason: String) -> BitFunResult<()> {
        self.tool_pipeline.cancel_tool(tool_id, reason).await
    }

    async fn execute_hidden_subagent_internal(
        &self,
        request: HiddenSubagentExecutionRequest,
        cancel_token: Option<&CancellationToken>,
    ) -> BitFunResult<SubagentResult> {
        // Check cancel token (before creating session)
        if let Some(token) = cancel_token {
            if token.is_cancelled() {
                debug!("Subagent task cancelled before execution");
                return Err(BitFunError::Cancelled(
                    "Subagent task has been cancelled".to_string(),
                ));
            }
        }

        let HiddenSubagentExecutionRequest {
            session_name,
            agent_type,
            session_config,
            initial_messages,
            created_by,
            surface_mode,
            subagent_parent_info,
            context,
            runtime_tool_restrictions,
        } = request;

        let session = self
            .create_hidden_subagent_session(
                None,
                session_name,
                agent_type.clone(),
                session_config,
                created_by,
            )
            .await?;

        // Check cancel token (after creating session, before execution)
        if let Some(token) = cancel_token {
            if token.is_cancelled() {
                debug!("Subagent task cancelled before AI call, cleaning up resources");
                let _ = self.cleanup_subagent_resources(&session.session_id).await;
                return Err(BitFunError::Cancelled(
                    "Subagent task has been cancelled".to_string(),
                ));
            }
        }

        // Generate unique dialog_turn_id for cancel token management
        let dialog_turn_id = format!("subagent-{}", uuid::Uuid::new_v4());
        debug!(
            "Generated unique dialog_turn_id for subagent: {}",
            dialog_turn_id
        );

        // If external cancel_token provided, create child_token and register to RoundExecutor
        // This allows execute_dialog_turn internal checks to detect external cancellation
        let _cleanup_guard = if let Some(parent_token) = cancel_token {
            // Create child_token, cancelled when parent_token is cancelled
            let child_token = parent_token.child_token();

            // Register to ExecutionEngine (forwarded to RoundExecutor), using dialog_turn_id as key
            self.execution_engine
                .register_cancel_token(&dialog_turn_id, child_token.clone());

            debug!(
                "Registered cancel token to RoundExecutor: dialog_turn_id={}",
                dialog_turn_id
            );

            // Create cleanup guard to ensure token cleanup on function exit
            Some(CancelTokenGuard {
                execution_engine: self.execution_engine.clone(),
                dialog_turn_id: dialog_turn_id.clone(),
            })
        } else {
            None
        };

        let subagent_workspace = Self::build_workspace_binding(&session.config).await;
        let subagent_services = Self::build_workspace_services(&subagent_workspace).await;
        let (subagent_mount, subagent_handles) = self.build_execution_handles(
            session
                .config
                .workspace_path
                .as_deref()
                .map(std::path::Path::new),
        );
        let execution_context = ExecutionContext {
            session_id: session.session_id.clone(),
            dialog_turn_id: dialog_turn_id.clone(),
            turn_index: 0,
            agent_type: agent_type.clone(),
            surface_mode,
            workspace: subagent_workspace,
            context,
            tool_allowlist_override: None,
            subagent_parent_info: subagent_parent_info.clone(),
            // Subagents run autonomously without user interaction; always skip
            // tool confirmation to prevent them from blocking indefinitely on a
            // confirmation channel that nobody will ever respond to.
            skip_tool_confirmation: true,
            runtime_tool_restrictions,
            workspace_services: subagent_services,
            workspace_mount: subagent_mount,
            agentic: subagent_handles,
            round_preempt: self.round_preempt_source.get().cloned(),
        };

        let result = self
            .execution_engine
            .execute_dialog_turn(agent_type, initial_messages, execution_context)
            .await;

        // cleanup_guard automatically cleans up token on scope exit (via Drop trait)

        // Extract text response
        let response_text = match result {
            Ok(exec_result) => match exec_result.final_message.content {
                MessageContent::Mixed { text, .. } => text,
                MessageContent::Text(text) => text,
                _ => String::new(),
            },
            Err(e) => {
                error!(
                    "Subagent execution failed: session={}, error={}",
                    session.session_id, e
                );

                if let Err(cleanup_err) = self.cleanup_subagent_resources(&session.session_id).await
                {
                    warn!(
                        "Failed to cleanup subagent resources: session={}, error={}",
                        session.session_id, cleanup_err
                    );
                }

                return Err(e);
            }
        };

        // Clean up subagent session resources after successful execution
        debug!(
            "Starting subagent resource cleanup: session={}",
            session.session_id
        );
        if let Err(e) = self.cleanup_subagent_resources(&session.session_id).await {
            warn!(
                "Failed to cleanup subagent resources: session={}, error={}",
                session.session_id, e
            );
        } else {
            debug!(
                "Subagent resource cleanup completed: session={}",
                session.session_id
            );
        }

        Ok(SubagentResult {
            text: response_text,
        })
    }

    pub async fn capture_fork_agent_context_snapshot(
        &self,
        parent_session_id: &str,
    ) -> BitFunResult<ForkAgentContextSnapshot> {
        let parent_session = self
            .session_manager
            .get_session(parent_session_id)
            .ok_or_else(|| {
                BitFunError::NotFound(format!("Parent session not found: {}", parent_session_id))
            })?;
        let context_messages = self.load_session_context_messages(&parent_session).await?;
        ForkAgentContextSnapshot::from_parent_session(&parent_session, context_messages)
    }

    async fn ensure_hidden_btw_session(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
        child_session_name: Option<&str>,
    ) -> BitFunResult<Session> {
        if let Some(session) = self.session_manager.get_session(child_session_id) {
            return Ok(session);
        }

        let snapshot = self
            .capture_fork_agent_context_snapshot(parent_session_id)
            .await?;
        let session_name = child_session_name
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or("Side thread")
            .to_string();
        let child_session = self
            .create_hidden_subagent_session(
                Some(child_session_id.to_string()),
                session_name,
                snapshot.parent_agent_type.clone(),
                snapshot.build_child_session_config(None),
                Some(format!("session-{}", snapshot.parent_session_id)),
            )
            .await?;

        self.session_manager
            .replace_context_messages(&child_session.session_id, snapshot.messages)
            .await;

        Ok(child_session)
    }

    pub async fn start_hidden_btw_turn(
        &self,
        request_id: &str,
        parent_session_id: &str,
        child_session_id: &str,
        child_session_name: Option<&str>,
        question: &str,
        model_id: Option<&str>,
    ) -> BitFunResult<String> {
        if request_id.trim().is_empty() {
            return Err(BitFunError::Validation(
                "request_id is required".to_string(),
            ));
        }
        if parent_session_id.trim().is_empty() {
            return Err(BitFunError::Validation(
                "parent_session_id is required".to_string(),
            ));
        }
        if child_session_id.trim().is_empty() {
            return Err(BitFunError::Validation(
                "child_session_id is required".to_string(),
            ));
        }
        if question.trim().is_empty() {
            return Err(BitFunError::Validation("question is required".to_string()));
        }

        let child_session = self
            .ensure_hidden_btw_session(parent_session_id, child_session_id, child_session_name)
            .await?;

        if let Some(model_id) = model_id
            .map(str::trim)
            .filter(|model_id| !model_id.is_empty())
        {
            self.session_manager
                .update_session_model_id(child_session_id, model_id)
                .await?;
        }

        let turn_id = format!("btw-turn-{}", request_id.trim());
        let user_message_metadata = Some(serde_json::json!({
            "kind": "btw",
            "parentSessionId": parent_session_id,
        }));

        self.start_dialog_turn_internal(
            child_session_id.to_string(),
            build_btw_user_input(question),
            Some(question.trim().to_string()),
            None,
            Some(turn_id.clone()),
            child_session.agent_type.clone(),
            None,
            child_session.config.workspace_path.clone(),
            DialogSubmissionPolicy::for_source(DialogTriggerSource::DesktopApi)
                .with_skip_tool_confirmation(true),
            user_message_metadata,
            DialogExecutionSettings::default(),
            true,
        )
        .await?;

        Ok(turn_id)
    }

    pub async fn start_background_host_scan_turn(
        &self,
        request_id: &str,
        trigger: Option<&str>,
        model_id: Option<&str>,
    ) -> BitFunResult<String> {
        if request_id.trim().is_empty() {
            return Err(BitFunError::Validation(
                "request_id is required".to_string(),
            ));
        }

        let child_session = self
            .create_ephemeral_background_session(
                Some(format!("system-host-scan-session-{}", request_id.trim())),
                default_host_scan_session_name().to_string(),
                HOST_SCAN_AGENT_TYPE.to_string(),
                Some(format!("background-host-scan-{}", request_id.trim())),
            )
            .await?;

        if let Some(model_id) = model_id
            .map(str::trim)
            .filter(|model_id| !model_id.is_empty())
        {
            self.session_manager
                .update_session_model_id(&child_session.session_id, model_id)
                .await?;
        }

        let turn_id = format!("background-host-scan-turn-{}", request_id.trim());
        let trigger = trigger.unwrap_or("auto");
        let user_message_metadata = Some(serde_json::json!({
            "kind": "host_scan",
            "trigger": trigger,
        }));
        let submission_policy = DialogSubmissionPolicy::for_source(if trigger == "manual" {
            DialogTriggerSource::DesktopApi
        } else {
            DialogTriggerSource::ScheduledJob
        })
        .with_skip_tool_confirmation(true)
        .with_persist_agent_type(false);

        self.start_dialog_turn_internal(
            child_session.session_id.clone(),
            build_host_scan_user_prompt().await,
            Some("/scan_host".to_string()),
            None,
            Some(turn_id.clone()),
            child_session.agent_type.clone(),
            None,
            child_session.config.workspace_path.clone(),
            submission_policy,
            user_message_metadata,
            Self::host_scan_execution_settings(),
            true,
        )
        .await?;

        Ok(turn_id)
    }

    pub async fn start_background_workspace_overview_refresh_turn(
        &self,
        request_id: &str,
        session_name: &str,
        user_prompt: String,
        system_reminder: String,
        runtime_tool_restrictions: ToolRuntimeRestrictions,
        trigger: Option<&str>,
        model_id: Option<&str>,
    ) -> BitFunResult<String> {
        if request_id.trim().is_empty() {
            return Err(BitFunError::Validation(
                "request_id is required".to_string(),
            ));
        }

        let child_session = self
            .create_ephemeral_background_session(
                Some(format!(
                    "system-workspace-overview-session-{}",
                    request_id.trim()
                )),
                session_name.to_string(),
                WORKSPACE_OVERVIEW_AGENT_TYPE.to_string(),
                Some(format!(
                    "background-workspace-overview-{}",
                    request_id.trim()
                )),
            )
            .await?;

        if let Some(model_id) = model_id
            .map(str::trim)
            .filter(|model_id| !model_id.is_empty())
        {
            self.session_manager
                .update_session_model_id(&child_session.session_id, model_id)
                .await?;
        }

        let turn_id = format!(
            "background-workspace-overview-refresh-turn-{}",
            request_id.trim()
        );
        let trigger = trigger.unwrap_or("auto");
        let user_message_metadata = Some(serde_json::json!({
            "kind": "workspace_overview_refresh",
            "trigger": trigger,
        }));
        let submission_policy = DialogSubmissionPolicy::for_source(if trigger == "manual" {
            DialogTriggerSource::DesktopApi
        } else {
            DialogTriggerSource::ScheduledJob
        })
        .with_skip_tool_confirmation(true)
        .with_persist_agent_type(false);

        self.start_dialog_turn_internal(
            child_session.session_id.clone(),
            user_prompt,
            Some("/refresh_workspace_overviews".to_string()),
            None,
            Some(turn_id.clone()),
            child_session.agent_type.clone(),
            Some(system_reminder),
            child_session.config.workspace_path.clone(),
            submission_policy,
            user_message_metadata,
            Self::workspace_overview_execution_settings(runtime_tool_restrictions),
            true,
        )
        .await?;

        Ok(turn_id)
    }

    pub async fn start_background_global_daily_report_turn(
        &self,
        request_id: &str,
        session_name: &str,
        user_prompt: String,
        runtime_tool_restrictions: ToolRuntimeRestrictions,
        model_id: Option<&str>,
    ) -> BitFunResult<String> {
        if request_id.trim().is_empty() {
            return Err(BitFunError::Validation(
                "request_id is required".to_string(),
            ));
        }

        let child_session = self
            .create_ephemeral_background_session(
                Some(format!(
                    "system-global-daily-report-session-{}",
                    request_id.trim()
                )),
                session_name.to_string(),
                GLOBAL_DAILY_REPORT_AGENT_TYPE.to_string(),
                Some(format!(
                    "background-global-daily-report-{}",
                    request_id.trim()
                )),
            )
            .await?;

        if let Some(model_id) = model_id
            .map(str::trim)
            .filter(|model_id| !model_id.is_empty())
        {
            self.session_manager
                .update_session_model_id(&child_session.session_id, model_id)
                .await?;
        }

        let turn_id = format!("background-global-daily-report-turn-{}", request_id.trim());
        let user_message_metadata = Some(serde_json::json!({
            "kind": "global_daily_report",
            "trigger": "auto",
        }));

        self.start_dialog_turn_internal(
            child_session.session_id.clone(),
            user_prompt,
            Some("/global_daily_report".to_string()),
            None,
            Some(turn_id.clone()),
            child_session.agent_type.clone(),
            None,
            child_session.config.workspace_path.clone(),
            DialogSubmissionPolicy::for_source(DialogTriggerSource::ScheduledJob)
                .with_skip_tool_confirmation(true)
                .with_persist_agent_type(false),
            user_message_metadata,
            Self::global_daily_report_execution_settings(runtime_tool_restrictions),
            true,
        )
        .await?;

        Ok(turn_id)
    }

    pub async fn start_background_global_milestone_turn(
        &self,
        request_id: &str,
        session_name: &str,
        user_prompt: String,
        runtime_tool_restrictions: ToolRuntimeRestrictions,
        trigger: Option<&str>,
        model_id: Option<&str>,
    ) -> BitFunResult<String> {
        if request_id.trim().is_empty() {
            return Err(BitFunError::Validation(
                "request_id is required".to_string(),
            ));
        }

        let child_session = self
            .create_ephemeral_background_session(
                Some(format!(
                    "system-global-milestone-session-{}",
                    request_id.trim()
                )),
                session_name.to_string(),
                GLOBAL_MILESTONE_AGENT_TYPE.to_string(),
                Some(format!("background-global-milestone-{}", request_id.trim())),
            )
            .await?;

        if let Some(model_id) = model_id
            .map(str::trim)
            .filter(|model_id| !model_id.is_empty())
        {
            self.session_manager
                .update_session_model_id(&child_session.session_id, model_id)
                .await?;
        }

        let turn_id = format!("background-global-milestone-turn-{}", request_id.trim());
        let user_message_metadata = Some(serde_json::json!({
            "kind": "global_milestone",
            "trigger": trigger.unwrap_or("auto"),
        }));

        self.start_dialog_turn_internal(
            child_session.session_id.clone(),
            user_prompt,
            Some("/global_milestone".to_string()),
            None,
            Some(turn_id.clone()),
            child_session.agent_type.clone(),
            None,
            child_session.config.workspace_path.clone(),
            DialogSubmissionPolicy::for_source(DialogTriggerSource::ScheduledJob)
                .with_skip_tool_confirmation(true)
                .with_persist_agent_type(false),
            user_message_metadata,
            Self::global_milestone_execution_settings(runtime_tool_restrictions),
            true,
        )
        .await?;

        Ok(turn_id)
    }

    async fn create_ephemeral_background_session(
        &self,
        session_id: Option<String>,
        session_name: String,
        agent_type: String,
        created_by: Option<String>,
    ) -> BitFunResult<Session> {
        let workspace_path = get_path_manager_arc()
            .agentic_os_runtime_root()
            .to_string_lossy()
            .into_owned();

        self.create_hidden_subagent_session(
            session_id,
            session_name,
            agent_type,
            SessionConfig {
                workspace_path: Some(workspace_path),
                storage_scope: Some(SessionStorageScope::AgenticOs),
                ..SessionConfig::default()
            },
            created_by,
        )
        .await
    }

    /// Execute a hidden child agent that inherits the parent session's current
    /// model-visible context.
    pub async fn execute_fork_agent(
        &self,
        request: ForkAgentExecutionRequest,
        cancel_token: Option<&CancellationToken>,
    ) -> BitFunResult<ForkAgentExecutionResult> {
        if request.agent_type.trim().is_empty() {
            return Err(BitFunError::Validation(
                "ForkAgentExecutionRequest.agent_type is required".to_string(),
            ));
        }
        if request.description.trim().is_empty() {
            return Err(BitFunError::Validation(
                "ForkAgentExecutionRequest.description is required".to_string(),
            ));
        }
        if request.prompt_messages.is_empty() {
            return Err(BitFunError::Validation(
                "ForkAgentExecutionRequest.prompt_messages must not be empty".to_string(),
            ));
        }

        let inherited_message_count = request.snapshot.inherited_message_count();
        let prompt_message_count = request.prompt_messages.len();
        let agent_type = request.agent_type.clone();
        let session_config = request.child_session_config();
        let initial_messages = request.composed_initial_messages();
        let created_by = Some(format!("session-{}", request.snapshot.parent_session_id));
        let child_result = self
            .execute_hidden_subagent_internal(
                HiddenSubagentExecutionRequest {
                    session_name: format!("Fork: {}", request.description),
                    agent_type,
                    session_config,
                    initial_messages,
                    created_by,
                    surface_mode: SessionSurfaceMode::InternalBackground,
                    subagent_parent_info: None,
                    context: request.context,
                    runtime_tool_restrictions: request.runtime_tool_restrictions,
                },
                cancel_token,
            )
            .await?;

        Ok(ForkAgentExecutionResult {
            text: child_result.text,
            inherited_message_count,
            prompt_message_count,
        })
    }

    /// Execute subagent task directly
    /// DialogTurnStarted event not needed for now
    ///
    /// Parameters:
    /// - agent_type: Agent type
    /// - task_description: Task description
    /// - subagent_parent_info: Parent info (tool call context)
    /// - context: Additional context
    /// - cancel_token: Optional cancel token (for async cancellation)
    ///
    /// Returns SubagentResult with the final text response
    pub async fn execute_subagent(
        &self,
        agent_type: String,
        task_description: String,
        subagent_parent_info: SubagentParentInfo,
        workspace_path: Option<String>,
        context: Option<HashMap<String, String>>,
        cancel_token: Option<&CancellationToken>,
    ) -> BitFunResult<SubagentResult> {
        let workspace_path = workspace_path.ok_or_else(|| {
            BitFunError::Validation(
                "workspace_path is required when creating a subagent session".to_string(),
            )
        })?;

        self.execute_hidden_subagent_internal(
            HiddenSubagentExecutionRequest {
                session_name: format!("Subagent: {}", task_description),
                agent_type,
                session_config: SessionConfig {
                    workspace_path: Some(workspace_path),
                    ..SessionConfig::default()
                },
                initial_messages: vec![Message::user(task_description)],
                created_by: Some(format!("session-{}", subagent_parent_info.session_id)),
                surface_mode: SessionSurfaceMode::ParentRoutedSubagent,
                subagent_parent_info: Some(subagent_parent_info),
                context: context.unwrap_or_default(),
                runtime_tool_restrictions: ToolRuntimeRestrictions::default(),
            },
            cancel_token,
        )
        .await
    }

    pub async fn execute_hidden_memory_consolidation(
        &self,
        agent_type: String,
        session_name: String,
        workspace_path: String,
        prompt: String,
        runtime_tool_restrictions: ToolRuntimeRestrictions,
        created_by: Option<String>,
        cancel_token: Option<&CancellationToken>,
    ) -> BitFunResult<String> {
        let result = self
            .execute_hidden_subagent_internal(
                HiddenSubagentExecutionRequest {
                    session_name,
                    agent_type,
                    session_config: SessionConfig {
                        workspace_path: Some(workspace_path),
                        ..SessionConfig::default()
                    },
                    initial_messages: vec![Message::user(prompt)],
                    created_by,
                    surface_mode: SessionSurfaceMode::InternalBackground,
                    subagent_parent_info: None,
                    context: HashMap::new(),
                    runtime_tool_restrictions,
                },
                cancel_token,
            )
            .await?;

        Ok(result.text)
    }

    /// Clean up subagent session resources
    ///
    /// Release resources occupied by subagent session (sandbox, etc.) and delete session
    async fn cleanup_subagent_resources(&self, session_id: &str) -> BitFunResult<()> {
        debug!(
            "Starting subagent resource cleanup: session_id={}",
            session_id
        );

        // Clean up snapshot system resources
        if let Some(workspace_path) = self
            .session_manager
            .get_session(session_id)
            .and_then(|session| session.config.workspace_path.map(std::path::PathBuf::from))
        {
            let snapshot_manager_opt = self
                .workspace_registry
                .get()
                .and_then(|w| w.upgrade())
                .and_then(|registry| registry.by_path(&workspace_path))
                .map(|mount| mount.snapshot_manager.clone());
            if let Some(snapshot_manager) = snapshot_manager_opt {
                let snapshot_service = snapshot_manager.get_snapshot_service();
                let snapshot_service = snapshot_service.read().await;
                if let Err(e) = snapshot_service.accept_session(session_id).await {
                    warn!(
                        "Failed to cleanup snapshot system resources: session={}, error={}",
                        session_id, e
                    );
                } else {
                    debug!(
                        "Snapshot system resources cleaned up: session={}",
                        session_id
                    );
                }
            }
        }

        // Delete the subagent session itself, including runtime context and persisted turn data.
        let workspace_path = self
            .session_manager
            .get_session(session_id)
            .and_then(|session| session.config.workspace_path.map(std::path::PathBuf::from));

        if let Some(workspace_path) = workspace_path {
            if let Err(e) = self
                .session_manager
                .delete_session(&workspace_path, session_id)
                .await
            {
                warn!(
                    "Failed to delete subagent session: session={}, error={}",
                    session_id, e
                );
            } else {
                debug!("Subagent session deleted: session={}", session_id);
            }
        } else {
            warn!(
                "Failed to delete subagent session because workspace_path is missing: session={}",
                session_id
            );
        }

        debug!(
            "Subagent resource cleanup completed: session_id={}",
            session_id
        );
        Ok(())
    }

    /// Generate session title
    ///
    /// Use AI to generate a concise and accurate session title based on user message content.
    /// Also persists the title to the session backend. Callers that go through
    /// `start_dialog_turn` do NOT need to call this separately ??first-message
    /// title generation is handled automatically inside `start_dialog_turn`.
    pub async fn generate_session_title(
        &self,
        session_id: &str,
        user_message: &str,
        max_length: Option<usize>,
    ) -> BitFunResult<String> {
        let allow_ai = is_ai_session_title_generation_enabled().await;
        let resolved = self
            .session_manager
            .resolve_session_title(user_message, max_length, allow_ai)
            .await;

        self.session_manager
            .update_session_title(session_id, &resolved.title)
            .await?;

        let event = AgenticEvent::SessionTitleGenerated {
            session_id: session_id.to_string(),
            title: resolved.title.clone(),
            method: resolved.method.as_str().to_string(),
        };
        self.emit_event(event).await;

        debug!(
            "Session title generation event sent: session_id={}, title={}",
            session_id, resolved.title
        );

        Ok(resolved.title)
    }

    pub async fn update_session_title(
        &self,
        session_id: &str,
        title: &str,
    ) -> BitFunResult<String> {
        let normalized = title.trim().to_string();
        if normalized.is_empty() {
            return Err(BitFunError::validation(
                "Session title must not be empty".to_string(),
            ));
        }

        self.session_manager
            .update_session_title(session_id, &normalized)
            .await?;

        self.emit_event(AgenticEvent::SessionTitleGenerated {
            session_id: session_id.to_string(),
            title: normalized.clone(),
            method: "manual".to_string(),
        })
        .await;

        Ok(normalized)
    }

    /// Emit event
    async fn emit_event(&self, event: AgenticEvent) {
        let _ = self
            .event_queue
            .enqueue(event, Some(EventPriority::Normal))
            .await;
    }

    /// Emit a `SessionModelAutoMigrated` event with `High` priority so the
    /// frontend can refresh its model selector and surface a notice promptly.
    ///
    /// Callers (e.g. `SessionManager`) reach this method via
    /// [`get_global_coordinator`] so they don't need to thread an
    /// `Arc<EventQueue>` through every constructor.
    pub async fn emit_session_model_auto_migrated(
        &self,
        session_id: &str,
        previous_model_id: &str,
        new_model_id: &str,
        reason: &str,
    ) {
        let event = AgenticEvent::SessionModelAutoMigrated {
            session_id: session_id.to_string(),
            previous_model_id: previous_model_id.to_string(),
            new_model_id: new_model_id.to_string(),
            reason: reason.to_string(),
        };
        let _ = self
            .event_queue
            .enqueue(event, Some(EventPriority::High))
            .await;
    }

    /// Get SessionManager reference (for advanced features like mode management)
    pub fn get_session_manager(&self) -> &Arc<SessionManager> {
        &self.session_manager
    }

    /// Persist a completed `/btw` side-question turn into an existing child session.
    #[allow(clippy::too_many_arguments)]
    pub async fn persist_btw_turn(
        &self,
        workspace_path: &Path,
        child_session_id: &str,
        request_id: &str,
        question: &str,
        full_text: &str,
        parent_session_id: &str,
        parent_dialog_turn_id: Option<&str>,
        parent_turn_index: Option<usize>,
    ) -> BitFunResult<()> {
        self.session_manager
            .persist_btw_turn(
                workspace_path,
                child_session_id,
                request_id,
                question,
                full_text,
                parent_session_id,
                parent_dialog_turn_id,
                parent_turn_index,
            )
            .await
    }
}

// ?? Process-wide singleton accessor (installation-only API) ??????????????????
//
// `coordinator` is one of a handful of services that are genuinely
// process-wide: it owns the single `EventQueue`/`EventRouter` and routes
// every workspace's sessions through its multi-workspace-aware
// `SessionManager`. Long-lived non-tool subsystems (the remote-connect
// dispatcher, persistence cleanup) need a stable lookup point.
//
// Unlike the previous `set_global` model, callers MUST NOT install from
// arbitrary code: `install_global_coordinator` is intended to be called
// exactly once from `AppContainer` boot. Tools should use
// `ToolUseContext::agentic()` ? this lookup is a fallback for code that
// runs outside the per-tool injection path.
static GLOBAL_COORDINATOR: OnceLock<Arc<ConversationCoordinator>> = OnceLock::new();

/// Install the process-wide coordinator. Called once at boot by
/// `AppContainer`. Returns `Err` if a coordinator is already installed.
pub fn install_global_coordinator(coordinator: Arc<ConversationCoordinator>) -> Result<(), ()> {
    GLOBAL_COORDINATOR.set(coordinator).map_err(|_| ())
}

/// Look up the installed process-wide coordinator. Returns `None` until
/// `AppContainer` has finished Stage-D boot.
pub fn get_global_coordinator() -> Option<Arc<ConversationCoordinator>> {
    GLOBAL_COORDINATOR.get().cloned()
}

async fn is_ai_session_title_generation_enabled() -> bool {
    match crate::service::config::get_global_config_service().await {
        Ok(service) => service
            .get_config::<bool>(Some("app.ai_experience.enable_session_title_generation"))
            .await
            .unwrap_or(true),
        Err(_) => true,
    }
}
