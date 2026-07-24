//! Dialog scheduler
//!
//! Message queue manager that automatically dispatches queued messages
//! when the target session becomes idle.
//!
//! Acts as the primary entry point for all user-facing message submissions,
//! wrapping ConversationCoordinator with:
//! - Per-session priority queue (max 20 messages)
//! - Higher-priority messages dispatched before lower-priority ones
//! - FIFO ordering within the same priority level
//! - Queue paused on failed/cancelled turns until the user resumes

use super::coordinator::{ConversationCoordinator, DialogTriggerSource};
use super::turn_outcome::{
    SessionControlActor, TurnCancellationReason, TurnOutcome, TurnOutcomeQueueAction,
};
use crate::agentic::core::{PromptEnvelope, SessionState};
use crate::agentic::events::{AgenticEvent, EventQueue};
use crate::agentic::image_analysis::ImageContextData;
use crate::agentic::round_preempt::{
    DialogRoundPreemptSource, DialogTurnGuidance, SessionRoundYieldFlags,
};
use crate::agentic::session::SessionManager;
use crate::agentic::session_hooks::{
    SessionDriverSubmit, SessionHook, SessionHookBus, SessionHookKind, SessionTurnOutcome,
    SessionWorkOwner, SessionWorkOwnerMatcher,
};
use dashmap::DashMap;
use log::{debug, info, warn};
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use uuid::Uuid;

const MAX_QUEUE_DEPTH: usize = 20;
const GUIDANCE_INTERRUPTIBLE_TOOL_NAMES: &[&str] = &["Bash", "TerminalControl"];

/// Result of [`DialogScheduler::submit`]: whether this message began executing immediately
/// or was placed in the per-session queue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DialogSubmitOutcome {
    Started { session_id: String, turn_id: String },
    Queued { session_id: String, turn_id: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum DialogQueuePriority {
    Low = 0,
    Normal = 1,
    High = 2,
}

impl DialogQueuePriority {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Normal => "normal",
            Self::High => "high",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DialogSubmissionPolicy {
    pub trigger_source: DialogTriggerSource,
    pub queue_priority: DialogQueuePriority,
    pub skip_tool_confirmation: bool,
    pub persist_agent_type: bool,
}

impl DialogSubmissionPolicy {
    pub const fn new(
        trigger_source: DialogTriggerSource,
        queue_priority: DialogQueuePriority,
        skip_tool_confirmation: bool,
        persist_agent_type: bool,
    ) -> Self {
        Self {
            trigger_source,
            queue_priority,
            skip_tool_confirmation,
            persist_agent_type,
        }
    }

    pub const fn for_source(trigger_source: DialogTriggerSource) -> Self {
        let (queue_priority, skip_tool_confirmation) = match trigger_source {
            DialogTriggerSource::AgentSession => (DialogQueuePriority::Low, true),
            DialogTriggerSource::Goal => (DialogQueuePriority::Low, true),
            DialogTriggerSource::WorkMessage => (DialogQueuePriority::Normal, true),
            DialogTriggerSource::ScheduledJob => (DialogQueuePriority::Low, true),
            DialogTriggerSource::DesktopUi
            | DialogTriggerSource::DesktopApi
            | DialogTriggerSource::Cli => (DialogQueuePriority::Normal, false),
            DialogTriggerSource::RemoteRelay | DialogTriggerSource::Bot => {
                (DialogQueuePriority::Normal, true)
            }
        };
        Self::new(trigger_source, queue_priority, skip_tool_confirmation, true)
    }

    pub const fn with_queue_priority(mut self, queue_priority: DialogQueuePriority) -> Self {
        self.queue_priority = queue_priority;
        self
    }

    pub const fn with_skip_tool_confirmation(mut self, skip_tool_confirmation: bool) -> Self {
        self.skip_tool_confirmation = skip_tool_confirmation;
        self
    }

    pub const fn with_persist_agent_type(mut self, persist_agent_type: bool) -> Self {
        self.persist_agent_type = persist_agent_type;
        self
    }
}

#[derive(Debug, Clone)]
pub struct AgentSessionReplyRoute {
    pub source_session_id: String,
    pub source_workspace_path: String,
}

#[derive(Debug, Clone)]
struct ActiveTurn {
    turn_id: String,
    workspace_path: Option<String>,
    owner: SessionWorkOwner,
    policy: DialogSubmissionPolicy,
    reply_route: Option<AgentSessionReplyRoute>,
}

impl ActiveTurn {
    fn from_queued_turn(turn: &QueuedTurn, turn_id: String) -> Self {
        Self {
            turn_id,
            workspace_path: turn.workspace_path.clone(),
            owner: turn.owner.clone(),
            policy: turn.policy,
            reply_route: turn.reply_route.clone(),
        }
    }

    fn is_agent_session_request(&self) -> bool {
        self.policy.trigger_source == DialogTriggerSource::AgentSession
            && self.reply_route.is_some()
    }

    fn should_suppress_cancelled_reply_for_requester(&self, requester_session_id: &str) -> bool {
        self.is_agent_session_request()
            && self
                .reply_route
                .as_ref()
                .is_some_and(|reply_route| reply_route.source_session_id == requester_session_id)
    }
}

/// A message waiting to be dispatched to the coordinator
#[derive(Debug, Clone)]
pub struct QueuedTurn {
    pub user_input: String,
    pub original_user_input: Option<String>,
    pub turn_id: Option<String>,
    pub agent_type: String,
    pub system_reminder_override: Option<String>,
    pub workspace_path: Option<String>,
    pub owner: SessionWorkOwner,
    pub policy: DialogSubmissionPolicy,
    pub reply_route: Option<AgentSessionReplyRoute>,
    pub image_contexts: Option<Vec<ImageContextData>>,
    pub extra_metadata: Option<serde_json::Value>,
    #[allow(dead_code)]
    pub enqueued_at: SystemTime,
}

#[derive(Debug, Clone)]
pub struct ActiveTurnSnapshot {
    pub turn_id: String,
    pub workspace_path: Option<String>,
    pub owner: SessionWorkOwner,
}

impl QueuedTurn {
    fn turn_id(&self) -> Option<&str> {
        self.turn_id.as_deref()
    }

    fn enqueued_at_ms(&self) -> u64 {
        system_time_ms(self.enqueued_at)
    }

    fn image_count(&self) -> usize {
        self.image_contexts
            .as_ref()
            .map(|images| images.len())
            .unwrap_or(0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DialogQueuePauseReason {
    UserCancelled,
    RunFailed,
}

impl DialogQueuePauseReason {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::UserCancelled => "user_cancelled",
            Self::RunFailed => "run_failed",
        }
    }
}

#[derive(Debug, Clone)]
struct DialogQueuePause {
    reason: DialogQueuePauseReason,
    turn_id: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogQueuePauseSnapshot {
    pub reason: String,
    pub turn_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogQueuedTurnSnapshot {
    pub session_id: String,
    pub turn_id: String,
    pub user_input: String,
    pub original_user_input: Option<String>,
    pub agent_type: String,
    pub queue_priority: String,
    pub position: usize,
    pub enqueued_at_ms: u64,
    pub has_images: bool,
    pub image_count: usize,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogGuidedTurnSnapshot {
    pub session_id: String,
    pub source_turn_id: String,
    pub target_turn_id: Option<String>,
    pub guidance_id: Option<String>,
    pub user_input: String,
    pub original_user_input: Option<String>,
    pub queue_depth: usize,
    pub received_at_ms: u64,
    pub has_images: bool,
    pub image_count: usize,
    pub status: String,
}

fn system_time_ms(value: SystemTime) -> u64 {
    value
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

/// Message queue manager for dialog turns.
///
/// All user-facing callers (frontend Tauri commands, remote server, bot router)
/// should submit messages through this scheduler instead of calling
/// ConversationCoordinator directly.
pub struct DialogScheduler {
    coordinator: Arc<ConversationCoordinator>,
    session_manager: Arc<SessionManager>,
    event_queue: Arc<EventQueue>,
    /// Per-session priority message queues
    queues: Arc<DashMap<String, VecDeque<QueuedTurn>>>,
    /// Sessions whose queued turns require explicit user confirmation before dispatch.
    queue_pauses: Arc<DashMap<String, DialogQueuePause>>,
    /// Currently active turn metadata keyed by target session ID
    active_turns: Arc<DashMap<String, ActiveTurn>>,
    /// Session extension hook bus.
    hook_bus: Arc<SessionHookBus>,
    /// Turns whose cancelled auto-reply should be suppressed because the source
    /// agent explicitly cancelled its own outstanding SessionMessage request.
    suppressed_cancelled_replies: Arc<DashMap<(String, String), ()>>,
    /// Cloneable sender given to ConversationCoordinator for turn outcome notifications
    outcome_tx: mpsc::Sender<(String, TurnOutcome)>,
    /// When a user submits while `Processing`, engine yields after the current model round.
    round_yield_flags: Arc<SessionRoundYieldFlags>,
}

impl DialogScheduler {
    /// Create a new DialogScheduler and start its background outcome handler.
    ///
    /// The returned `Arc<DialogScheduler>` should be stored globally.
    /// Call `coordinator.set_scheduler_notifier(scheduler.outcome_sender())`
    /// immediately after to wire up the notification channel.
    pub fn new(
        coordinator: Arc<ConversationCoordinator>,
        session_manager: Arc<SessionManager>,
        event_queue: Arc<EventQueue>,
        hook_bus: Arc<SessionHookBus>,
    ) -> Arc<Self> {
        let (outcome_tx, outcome_rx) = mpsc::channel(128);

        let scheduler = Arc::new(Self {
            coordinator,
            session_manager,
            event_queue,
            queues: Arc::new(DashMap::new()),
            queue_pauses: Arc::new(DashMap::new()),
            active_turns: Arc::new(DashMap::new()),
            hook_bus,
            suppressed_cancelled_replies: Arc::new(DashMap::new()),
            outcome_tx,
            round_yield_flags: Arc::new(SessionRoundYieldFlags::default()),
        });

        let scheduler_for_handler = Arc::clone(&scheduler);
        tokio::spawn(async move {
            scheduler_for_handler.run_outcome_handler(outcome_rx).await;
        });

        scheduler
    }

    /// Returns a sender to give to ConversationCoordinator for turn outcome notifications.
    pub fn outcome_sender(&self) -> mpsc::Sender<(String, TurnOutcome)> {
        self.outcome_tx.clone()
    }

    /// Pass to [`ConversationCoordinator::set_round_preempt_source`](super::coordinator::ConversationCoordinator::set_round_preempt_source).
    pub fn preempt_monitor(&self) -> Arc<dyn DialogRoundPreemptSource> {
        self.round_yield_flags.clone()
    }

    fn user_message_may_preempt(policy: &DialogSubmissionPolicy) -> bool {
        matches!(
            policy.trigger_source,
            DialogTriggerSource::DesktopUi
                | DialogTriggerSource::DesktopApi
                | DialogTriggerSource::Cli
                | DialogTriggerSource::RemoteRelay
                | DialogTriggerSource::Bot
        )
    }

    /// Submit a user message for a session.
    ///
    /// - Session idle, queue empty → dispatched immediately.
    /// - Session idle, queue non-empty → enqueued then highest-priority queued message dispatched.
    /// - Session processing → queued (up to MAX_QUEUE_DEPTH). For interactive sources
    ///   (desktop, CLI, bot, …), also requests a yield after the current model round so
    ///   the queued message can start sooner than a full multi-round turn.
    /// - Session error → queue cleared, dispatched immediately.
    ///
    /// Returns `Err(String)` if the queue is full or the coordinator returns an error.
    #[allow(clippy::too_many_arguments)]
    pub async fn submit(
        &self,
        session_id: String,
        user_input: String,
        original_user_input: Option<String>,
        turn_id: Option<String>,
        agent_type: String,
        system_reminder_override: Option<String>,
        workspace_path: Option<String>,
        policy: DialogSubmissionPolicy,
        reply_route: Option<AgentSessionReplyRoute>,
        image_contexts: Option<Vec<ImageContextData>>,
    ) -> Result<DialogSubmitOutcome, String> {
        self.submit_with_metadata(
            session_id,
            user_input,
            original_user_input,
            turn_id,
            agent_type,
            system_reminder_override,
            workspace_path,
            policy,
            reply_route,
            image_contexts,
            None,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn submit_with_metadata(
        &self,
        session_id: String,
        user_input: String,
        original_user_input: Option<String>,
        turn_id: Option<String>,
        agent_type: String,
        system_reminder_override: Option<String>,
        workspace_path: Option<String>,
        policy: DialogSubmissionPolicy,
        reply_route: Option<AgentSessionReplyRoute>,
        image_contexts: Option<Vec<ImageContextData>>,
        extra_metadata: Option<serde_json::Value>,
    ) -> Result<DialogSubmitOutcome, String> {
        let resolved_turn_id = turn_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let queued_turn = QueuedTurn {
            user_input,
            original_user_input,
            turn_id: Some(resolved_turn_id.clone()),
            agent_type,
            system_reminder_override,
            workspace_path,
            owner: SessionWorkOwner::from_trigger_source(policy.trigger_source),
            policy,
            reply_route,
            image_contexts,
            extra_metadata,
            enqueued_at: SystemTime::now(),
        };
        self.submit_queued_turn(session_id, queued_turn, resolved_turn_id)
            .await
    }

    pub async fn submit_driver_turn(
        &self,
        request: SessionDriverSubmit,
    ) -> Result<DialogSubmitOutcome, String> {
        let resolved_turn_id = request
            .turn_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let queued_turn = QueuedTurn {
            user_input: request.user_input,
            original_user_input: request.original_user_input,
            turn_id: Some(resolved_turn_id.clone()),
            agent_type: request.agent_type,
            system_reminder_override: request.system_reminder_override,
            workspace_path: Some(request.workspace_path),
            owner: request.owner,
            policy: DialogSubmissionPolicy::for_source(DialogTriggerSource::Goal)
                .with_queue_priority(request.queue_priority)
                .with_skip_tool_confirmation(request.skip_tool_confirmation),
            reply_route: None,
            image_contexts: None,
            extra_metadata: request.metadata,
            enqueued_at: SystemTime::now(),
        };
        self.submit_queued_turn(request.session_id, queued_turn, resolved_turn_id)
            .await
    }

    async fn submit_queued_turn(
        &self,
        session_id: String,
        queued_turn: QueuedTurn,
        resolved_turn_id: String,
    ) -> Result<DialogSubmitOutcome, String> {
        self.publish_turn_submitted(
            &session_id,
            &resolved_turn_id,
            queued_turn.owner.clone(),
            queued_turn.policy.trigger_source,
        );

        let state = self
            .session_manager
            .get_session(&session_id)
            .map(|s| s.state.clone());

        match state {
            None => {
                let tid = self.start_turn(&session_id, &queued_turn).await?;
                Ok(DialogSubmitOutcome::Started {
                    session_id,
                    turn_id: tid,
                })
            }

            Some(SessionState::Error { .. }) => {
                if self.is_queue_paused(&session_id) {
                    self.enqueue(&session_id, queued_turn).await?;
                    Ok(DialogSubmitOutcome::Queued {
                        session_id,
                        turn_id: resolved_turn_id,
                    })
                } else {
                    self.clear_queue(&session_id);
                    let tid = self.start_turn(&session_id, &queued_turn).await?;
                    Ok(DialogSubmitOutcome::Started {
                        session_id,
                        turn_id: tid,
                    })
                }
            }

            Some(SessionState::Idle) => {
                let queue_non_empty = self
                    .queues
                    .get(&session_id)
                    .map(|q| !q.is_empty())
                    .unwrap_or(false);

                if queue_non_empty || self.is_queue_paused(&session_id) {
                    self.enqueue(&session_id, queued_turn.clone()).await?;
                    let started_tid = self.try_start_next_queued(&session_id).await?;
                    let outcome = match started_tid {
                        Some(tid) if tid == resolved_turn_id => DialogSubmitOutcome::Started {
                            session_id: session_id.clone(),
                            turn_id: tid,
                        },
                        _ => DialogSubmitOutcome::Queued {
                            session_id: session_id.clone(),
                            turn_id: resolved_turn_id,
                        },
                    };
                    Ok(outcome)
                } else {
                    let tid = self.start_turn(&session_id, &queued_turn).await?;
                    Ok(DialogSubmitOutcome::Started {
                        session_id,
                        turn_id: tid,
                    })
                }
            }

            Some(SessionState::Processing { .. }) => {
                let may_preempt = Self::user_message_may_preempt(&queued_turn.policy);
                self.enqueue(&session_id, queued_turn).await?;
                if may_preempt {
                    self.round_yield_flags.request_yield(&session_id);
                }
                Ok(DialogSubmitOutcome::Queued {
                    session_id,
                    turn_id: resolved_turn_id,
                })
            }
        }
    }

    /// Number of messages currently queued for a session.
    pub fn queue_depth(&self, session_id: &str) -> usize {
        self.queues.get(session_id).map(|q| q.len()).unwrap_or(0)
    }

    pub fn session_manager(&self) -> &Arc<SessionManager> {
        &self.session_manager
    }

    /// Drop any queued dialog turns for a session (used when abandoning stale work).
    pub fn clear_session_queue(&self, session_id: &str) {
        self.clear_queue(session_id);
    }

    /// Snapshot queued dialog turns for a session in dispatch order.
    pub fn list_queue(&self, session_id: &str) -> Vec<DialogQueuedTurnSnapshot> {
        self.queues
            .get(session_id)
            .map(|queue| {
                queue
                    .iter()
                    .enumerate()
                    .filter_map(|(index, turn)| {
                        Self::snapshot_queued_turn(session_id, turn, index + 1)
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn queue_pause(&self, session_id: &str) -> Option<DialogQueuePauseSnapshot> {
        self.queue_pauses
            .get(session_id)
            .map(|pause| DialogQueuePauseSnapshot {
                reason: pause.reason.as_str().to_string(),
                turn_id: pause.turn_id.clone(),
                error: pause.error.clone(),
            })
    }

    pub fn active_turn_snapshot(&self, session_id: &str) -> Option<ActiveTurnSnapshot> {
        self.active_turns
            .get(session_id)
            .map(|active| ActiveTurnSnapshot {
                turn_id: active.turn_id.clone(),
                workspace_path: active.workspace_path.clone(),
                owner: active.owner.clone(),
            })
    }

    pub async fn update_queued_turn(
        &self,
        session_id: &str,
        turn_id: &str,
        user_input: String,
        original_user_input: Option<String>,
    ) -> Result<Option<DialogQueuedTurnSnapshot>, String> {
        let updated = {
            let Some(mut queue) = self.queues.get_mut(session_id) else {
                return Ok(None);
            };
            let queue_depth = queue.len();
            let Some((index, turn)) = queue
                .iter_mut()
                .enumerate()
                .find(|(_, turn)| turn.turn_id() == Some(turn_id))
            else {
                return Ok(None);
            };

            turn.user_input = user_input;
            turn.original_user_input = original_user_input;
            Self::snapshot_queued_turn(session_id, turn, index + 1)
                .map(|snapshot| (snapshot, queue_depth))
        };

        let Some((snapshot, queue_depth)) = updated else {
            return Ok(None);
        };

        self.emit_queue_updated(&snapshot, queue_depth).await;
        Ok(Some(snapshot))
    }

    pub async fn delete_queued_turn(&self, session_id: &str, turn_id: &str) -> bool {
        let deleted = {
            let Some(mut queue) = self.queues.get_mut(session_id) else {
                return false;
            };
            let Some(index) = queue
                .iter()
                .position(|turn| turn.turn_id() == Some(turn_id))
            else {
                return false;
            };
            queue.remove(index);
            queue.len()
        };

        if deleted == 0 {
            self.queue_pauses.remove(session_id);
        }
        self.emit_queue_deleted(session_id, turn_id, deleted).await;
        true
    }

    pub async fn delete_queued_owner_turns(
        &self,
        session_id: &str,
        owner: SessionWorkOwnerMatcher,
        except_turn_id: Option<&str>,
    ) -> usize {
        let deleted = {
            let Some(mut queue) = self.queues.get_mut(session_id) else {
                return 0;
            };

            let mut deleted_turn_ids = Vec::new();
            let mut index = 0;
            while index < queue.len() {
                let should_delete = queue.get(index).is_some_and(|turn| {
                    owner.matches(&turn.owner) && turn.turn_id() != except_turn_id
                });
                if should_delete {
                    if let Some(removed) = queue.remove(index) {
                        if let Some(turn_id) = removed.turn_id {
                            deleted_turn_ids.push(turn_id);
                        }
                    }
                } else {
                    index += 1;
                }
            }

            let remaining = queue.len();
            if remaining == 0 {
                drop(queue);
                self.queues.remove(session_id);
            }
            (deleted_turn_ids, remaining)
        };

        let (deleted_turn_ids, remaining) = deleted;
        if deleted_turn_ids.is_empty() {
            return 0;
        }

        if remaining == 0 {
            self.queue_pauses.remove(session_id);
            self.round_yield_flags.clear(session_id);
        }
        for turn_id in &deleted_turn_ids {
            self.emit_queue_deleted(session_id, turn_id, remaining)
                .await;
        }
        deleted_turn_ids.len()
    }

    pub async fn guide_queued_turn(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> Result<Option<DialogGuidedTurnSnapshot>, String> {
        let Some((queued_turn, queue_depth)) = self.remove_queued_turn(session_id, turn_id) else {
            return Ok(None);
        };

        if queue_depth == 0 {
            self.queue_pauses.remove(session_id);
            self.round_yield_flags.clear(session_id);
        }
        self.emit_queue_deleted(session_id, turn_id, queue_depth)
            .await;

        let received_at_ms = system_time_ms(SystemTime::now());
        let source_turn_id = queued_turn
            .turn_id
            .clone()
            .unwrap_or_else(|| turn_id.to_string());
        let user_input = queued_turn.user_input.clone();
        let original_user_input = queued_turn.original_user_input.clone();
        let image_count = queued_turn.image_count();
        let has_images = image_count > 0;

        let state = self
            .session_manager
            .get_session(session_id)
            .map(|session| session.state.clone());

        if let Some(SessionState::Processing {
            current_turn_id, ..
        }) = state
        {
            let guidance_id = Uuid::new_v4().to_string();
            self.round_yield_flags.push_guidance(
                session_id,
                DialogTurnGuidance {
                    guidance_id: guidance_id.clone(),
                    target_turn_id: current_turn_id.clone(),
                    source_turn_id: source_turn_id.clone(),
                    user_input: user_input.clone(),
                    original_user_input: original_user_input.clone(),
                    image_contexts: queued_turn.image_contexts.clone(),
                    received_at_ms,
                },
            );
            self.emit_guidance_requested(
                session_id,
                &current_turn_id,
                &guidance_id,
                &source_turn_id,
                &user_input,
                original_user_input.clone(),
                queue_depth,
                received_at_ms,
                has_images,
                image_count,
            )
            .await;

            if let Err(error) = self
                .coordinator
                .cancel_dialog_turn_tools_by_name(
                    &current_turn_id,
                    GUIDANCE_INTERRUPTIBLE_TOOL_NAMES,
                    "Guidance requested for active dialog turn".to_string(),
                )
                .await
            {
                warn!(
                    "Failed to request cancellation for guidance-interruptible tools: session_id={} turn_id={} error={}",
                    session_id, current_turn_id, error
                );
            }

            return Ok(Some(DialogGuidedTurnSnapshot {
                session_id: session_id.to_string(),
                source_turn_id,
                target_turn_id: Some(current_turn_id),
                guidance_id: Some(guidance_id),
                user_input,
                original_user_input,
                queue_depth,
                received_at_ms,
                has_images,
                image_count,
                status: "guided".to_string(),
            }));
        }

        let started_turn_id = self.start_turn(session_id, &queued_turn).await?;
        Ok(Some(DialogGuidedTurnSnapshot {
            session_id: session_id.to_string(),
            source_turn_id,
            target_turn_id: Some(started_turn_id),
            guidance_id: None,
            user_input,
            original_user_input,
            queue_depth,
            received_at_ms,
            has_images,
            image_count,
            status: "started".to_string(),
        }))
    }

    pub async fn resume_queue(&self, session_id: &str) -> Result<Option<String>, String> {
        self.queue_pauses.remove(session_id);
        self.emit_queue_resumed(session_id).await;
        self.try_start_next_queued(session_id).await
    }

    pub async fn cancel_dialog_turn(
        &self,
        session_id: &str,
        dialog_turn_id: &str,
        reason: TurnCancellationReason,
        actor: SessionControlActor,
    ) -> crate::error::CoreResult<()> {
        let Some(session) = self.session_manager.get_session(session_id) else {
            return Ok(());
        };
        let SessionState::Processing {
            current_turn_id, ..
        } = &session.state
        else {
            return Ok(());
        };
        if current_turn_id != dialog_turn_id {
            debug!(
                "Ignoring cancel request for non-active turn: session_id={}, requested_turn_id={}, active_turn_id={}",
                session_id, dialog_turn_id, current_turn_id
            );
            return Ok(());
        }
        let owner = self
            .active_turns
            .get(session_id)
            .filter(|active_turn| active_turn.turn_id == dialog_turn_id)
            .map(|active_turn| active_turn.owner.clone());
        self.publish_turn_cancellation_requested(session_id, dialog_turn_id, owner, reason, actor)
            .await;
        self.coordinator
            .cancel_dialog_turn_with_reason(session_id, dialog_turn_id, reason, actor)
            .await
    }

    pub async fn cancel_active_turn_for_session(
        &self,
        session_id: &str,
        reason: TurnCancellationReason,
        actor: SessionControlActor,
        wait_timeout: Duration,
    ) -> crate::error::CoreResult<Option<String>> {
        let Some(session) = self.session_manager.get_session(session_id) else {
            return Ok(None);
        };
        let SessionState::Processing {
            current_turn_id, ..
        } = session.state
        else {
            return Ok(None);
        };

        self.cancel_dialog_turn(session_id, &current_turn_id, reason, actor)
            .await?;

        self.coordinator
            .wait_until_turn_inactive(session_id, &current_turn_id, wait_timeout)
            .await;
        Ok(Some(current_turn_id))
    }

    /// Cancel the target session's active turn on behalf of a requester session.
    ///
    /// If the requester is the same source session that originally sent the
    /// in-flight SessionMessage request, the scheduler suppresses the automatic
    /// cancelled-reply bounce-back for that specific turn.
    pub async fn cancel_active_turn_for_session_from_requester(
        &self,
        target_session_id: &str,
        requester_session_id: &str,
        wait_timeout: Duration,
    ) -> crate::error::CoreResult<Option<String>> {
        let suppression_key = self
            .active_turns
            .get(target_session_id)
            .and_then(|active_turn| {
                active_turn
                    .should_suppress_cancelled_reply_for_requester(requester_session_id)
                    .then(|| (target_session_id.to_string(), active_turn.turn_id.clone()))
            });

        if let Some((session_id, turn_id)) = suppression_key.as_ref() {
            debug!(
                "Suppressing cancelled auto-reply for agent-session turn: target_session_id={}, turn_id={}, requester_session_id={}",
                session_id, turn_id, requester_session_id
            );
            self.suppressed_cancelled_replies
                .insert((session_id.clone(), turn_id.clone()), ());
        }

        match self
            .cancel_active_turn_for_session(
                target_session_id,
                TurnCancellationReason::UserRequested,
                SessionControlActor::AgentSession,
                wait_timeout,
            )
            .await
        {
            Ok(cancelled_turn_id) => {
                if cancelled_turn_id.is_none() {
                    if let Some((session_id, turn_id)) = suppression_key {
                        self.suppressed_cancelled_replies
                            .remove(&(session_id, turn_id));
                    }
                }
                Ok(cancelled_turn_id)
            }
            Err(error) => {
                if let Some((session_id, turn_id)) = suppression_key {
                    self.suppressed_cancelled_replies
                        .remove(&(session_id, turn_id));
                }
                Err(error)
            }
        }
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    /// Cancel the currently active turn only when its owner matches the caller's
    /// authorization. A fallback turn id lets an extension cancel the original
    /// user-visible trigger turn that became extension-owned after intake.
    pub async fn cancel_owned_active_turn(
        &self,
        session_id: &str,
        owner: SessionWorkOwnerMatcher,
        fallback_turn_id: Option<&str>,
        reason: TurnCancellationReason,
        actor: SessionControlActor,
        wait_timeout: Duration,
    ) -> crate::error::CoreResult<Option<String>> {
        let Some(session) = self.session_manager.get_session(session_id) else {
            return Ok(None);
        };
        let SessionState::Processing {
            current_turn_id, ..
        } = session.state
        else {
            return Ok(None);
        };

        let active_is_owned = self
            .active_turns
            .get(session_id)
            .is_some_and(|active_turn| owner.matches(&active_turn.owner));
        let active_is_fallback_turn = fallback_turn_id == Some(current_turn_id.as_str());
        if !active_is_owned && !active_is_fallback_turn {
            return Ok(None);
        }

        self.cancel_active_turn_for_session(session_id, reason, actor, wait_timeout)
            .await
    }

    fn snapshot_queued_turn(
        session_id: &str,
        turn: &QueuedTurn,
        position: usize,
    ) -> Option<DialogQueuedTurnSnapshot> {
        Some(DialogQueuedTurnSnapshot {
            session_id: session_id.to_string(),
            turn_id: turn.turn_id()?.to_string(),
            user_input: turn.user_input.clone(),
            original_user_input: turn.original_user_input.clone(),
            agent_type: turn.agent_type.clone(),
            queue_priority: turn.policy.queue_priority.as_str().to_string(),
            position,
            enqueued_at_ms: turn.enqueued_at_ms(),
            has_images: turn.image_count() > 0,
            image_count: turn.image_count(),
            status: "queued".to_string(),
        })
    }

    fn is_queue_paused(&self, session_id: &str) -> bool {
        self.queue_pauses.contains_key(session_id)
    }

    async fn emit_event(&self, event: AgenticEvent) {
        if let Err(error) = self.event_queue.enqueue(event, None).await {
            warn!("Failed to enqueue dialog queue event: {}", error);
        }
    }

    fn workspace_path_for_session(&self, session_id: &str) -> Option<String> {
        self.session_manager
            .get_session(session_id)
            .and_then(|session| session.config.workspace_path)
    }

    async fn publish_hook(&self, session_id: &str, kind: SessionHookKind) {
        self.hook_bus
            .publish(SessionHook::new(
                session_id.to_string(),
                self.workspace_path_for_session(session_id),
                kind,
            ))
            .await;
    }

    fn publish_hook_background(&self, session_id: &str, kind: SessionHookKind) {
        self.hook_bus.publish_background(SessionHook::new(
            session_id.to_string(),
            self.workspace_path_for_session(session_id),
            kind,
        ));
    }

    fn publish_turn_submitted(
        &self,
        session_id: &str,
        turn_id: &str,
        owner: SessionWorkOwner,
        source: DialogTriggerSource,
    ) {
        self.publish_hook_background(
            session_id,
            SessionHookKind::TurnSubmitted {
                turn_id: turn_id.to_string(),
                owner,
                source: Self::trigger_source_label(source).to_string(),
            },
        );
    }

    fn publish_turn_queued(
        &self,
        session_id: &str,
        turn_id: &str,
        owner: SessionWorkOwner,
        queue_depth: usize,
    ) {
        self.publish_hook_background(
            session_id,
            SessionHookKind::TurnQueued {
                turn_id: turn_id.to_string(),
                owner,
                queue_depth,
            },
        );
    }

    fn publish_turn_started(&self, session_id: &str, turn_id: &str, owner: SessionWorkOwner) {
        self.publish_hook_background(
            session_id,
            SessionHookKind::TurnStarted {
                turn_id: turn_id.to_string(),
                owner,
            },
        );
    }

    fn trigger_source_label(source: DialogTriggerSource) -> &'static str {
        match source {
            DialogTriggerSource::DesktopUi => "desktop_ui",
            DialogTriggerSource::DesktopApi => "desktop_api",
            DialogTriggerSource::AgentSession => "agent_session",
            DialogTriggerSource::Goal => "goal",
            DialogTriggerSource::WorkMessage => "work_message",
            DialogTriggerSource::ScheduledJob => "scheduled_job",
            DialogTriggerSource::RemoteRelay => "remote_relay",
            DialogTriggerSource::Bot => "bot",
            DialogTriggerSource::Cli => "cli",
        }
    }

    async fn publish_turn_cancellation_requested(
        &self,
        session_id: &str,
        turn_id: &str,
        owner: Option<SessionWorkOwner>,
        reason: TurnCancellationReason,
        actor: SessionControlActor,
    ) {
        let kind = SessionHookKind::TurnCancellationRequested {
            turn_id: turn_id.to_string(),
            owner,
            reason,
            actor,
            surface_mode: crate::agentic::events::SessionSurfaceMode::UserVisible,
        };
        if matches!(actor, SessionControlActor::Goal) {
            self.publish_hook_background(session_id, kind);
        } else {
            self.publish_hook(session_id, kind).await;
        }
    }

    async fn publish_turn_finished(
        &self,
        session_id: &str,
        owner: Option<SessionWorkOwner>,
        outcome: &TurnOutcome,
    ) {
        let hook_outcome = match outcome {
            TurnOutcome::Completed { .. } => SessionTurnOutcome::Completed,
            TurnOutcome::Failed { error, .. } => SessionTurnOutcome::Failed {
                error: error.clone(),
            },
            TurnOutcome::Cancelled { reason, actor, .. } => SessionTurnOutcome::Cancelled {
                reason: *reason,
                actor: *actor,
            },
        };
        self.publish_hook(
            session_id,
            SessionHookKind::TurnFinished {
                turn_id: outcome.turn_id().to_string(),
                owner,
                outcome: hook_outcome,
                hidden_session: false,
                surface_mode: crate::agentic::events::SessionSurfaceMode::UserVisible,
            },
        )
        .await;
    }

    async fn publish_queue_changed(
        &self,
        session_id: &str,
        reason: impl Into<String>,
        turn_id: Option<String>,
        error: Option<String>,
    ) {
        self.publish_hook_background(
            session_id,
            SessionHookKind::QueueChanged {
                reason: reason.into(),
                turn_id,
                error,
                queue_depth: self.queue_depth(session_id),
            },
        );
    }

    async fn emit_queue_queued(
        &self,
        snapshot: &DialogQueuedTurnSnapshot,
        owner: SessionWorkOwner,
        queue_depth: usize,
    ) {
        self.emit_event(AgenticEvent::DialogTurnQueued {
            session_id: snapshot.session_id.clone(),
            turn_id: snapshot.turn_id.clone(),
            user_input: snapshot.user_input.clone(),
            original_user_input: snapshot.original_user_input.clone(),
            agent_type: snapshot.agent_type.clone(),
            queue_priority: snapshot.queue_priority.clone(),
            queue_depth,
            enqueued_at_ms: snapshot.enqueued_at_ms,
            has_images: snapshot.has_images,
            image_count: snapshot.image_count,
        })
        .await;
        self.publish_turn_queued(&snapshot.session_id, &snapshot.turn_id, owner, queue_depth);
        self.publish_queue_changed(
            &snapshot.session_id,
            "queued",
            Some(snapshot.turn_id.clone()),
            None,
        )
        .await;
    }

    async fn emit_queue_updated(&self, snapshot: &DialogQueuedTurnSnapshot, queue_depth: usize) {
        self.emit_event(AgenticEvent::DialogTurnQueueUpdated {
            session_id: snapshot.session_id.clone(),
            turn_id: snapshot.turn_id.clone(),
            user_input: snapshot.user_input.clone(),
            original_user_input: snapshot.original_user_input.clone(),
            queue_depth,
            updated_at_ms: system_time_ms(SystemTime::now()),
        })
        .await;
        self.publish_queue_changed(
            &snapshot.session_id,
            "updated",
            Some(snapshot.turn_id.clone()),
            None,
        )
        .await;
    }

    async fn emit_queue_deleted(&self, session_id: &str, turn_id: &str, queue_depth: usize) {
        self.emit_event(AgenticEvent::DialogTurnQueueDeleted {
            session_id: session_id.to_string(),
            turn_id: turn_id.to_string(),
            queue_depth,
        })
        .await;
        self.publish_queue_changed(session_id, "deleted", Some(turn_id.to_string()), None)
            .await;
    }

    async fn emit_queue_dispatching(&self, session_id: &str, turn_id: &str, queue_depth: usize) {
        self.emit_event(AgenticEvent::DialogTurnQueueDispatching {
            session_id: session_id.to_string(),
            turn_id: turn_id.to_string(),
            queue_depth,
        })
        .await;
    }

    async fn emit_queue_resumed(&self, session_id: &str) {
        self.emit_event(AgenticEvent::DialogTurnQueueResumed {
            session_id: session_id.to_string(),
            queue_depth: self.queue_depth(session_id),
        })
        .await;
        self.publish_queue_changed(session_id, "queue_resumed", None, None)
            .await;
    }

    #[allow(clippy::too_many_arguments)]
    async fn emit_guidance_requested(
        &self,
        session_id: &str,
        turn_id: &str,
        guidance_id: &str,
        source_turn_id: &str,
        user_input: &str,
        original_user_input: Option<String>,
        queue_depth: usize,
        received_at_ms: u64,
        has_images: bool,
        image_count: usize,
    ) {
        self.emit_event(AgenticEvent::DialogTurnGuidanceRequested {
            session_id: session_id.to_string(),
            turn_id: turn_id.to_string(),
            guidance_id: guidance_id.to_string(),
            source_turn_id: source_turn_id.to_string(),
            user_input: user_input.to_string(),
            original_user_input,
            queue_depth,
            received_at_ms,
            has_images,
            image_count,
        })
        .await;
    }

    async fn pause_queue(
        &self,
        session_id: &str,
        reason: DialogQueuePauseReason,
        turn_id: Option<String>,
        error: Option<String>,
    ) {
        let queue_depth = self.queue_depth(session_id);
        if queue_depth == 0 {
            self.queue_pauses.remove(session_id);
            return;
        }

        self.queue_pauses.insert(
            session_id.to_string(),
            DialogQueuePause {
                reason,
                turn_id: turn_id.clone(),
                error: error.clone(),
            },
        );
        self.emit_event(AgenticEvent::DialogTurnQueuePaused {
            session_id: session_id.to_string(),
            reason: reason.as_str().to_string(),
            turn_id: turn_id.clone(),
            error: error.clone(),
            queue_depth,
        })
        .await;
        self.publish_queue_changed(session_id, reason.as_str(), turn_id, error)
            .await;
    }

    async fn enqueue(&self, session_id: &str, queued_turn: QueuedTurn) -> Result<(), String> {
        let queue_len = self.queues.get(session_id).map(|q| q.len()).unwrap_or(0);

        if queue_len >= MAX_QUEUE_DEPTH {
            warn!(
                "Queue full, rejecting message: session_id={}, max={}",
                session_id, MAX_QUEUE_DEPTH
            );
            return Err(format!(
                "Message queue full for session {} (max {} messages)",
                session_id, MAX_QUEUE_DEPTH
            ));
        }

        self.queues
            .entry(session_id.to_string())
            .or_default()
            .push_back(queued_turn.clone());
        if let Some(mut queue) = self.queues.get_mut(session_id) {
            if let Some(reordered_turn) = queue.pop_back() {
                let insert_at = queue.iter().position(|existing| {
                    existing.policy.queue_priority < reordered_turn.policy.queue_priority
                });
                if let Some(index) = insert_at {
                    queue.insert(index, reordered_turn);
                } else {
                    queue.push_back(reordered_turn);
                }
            }
        }

        let queued_snapshot = self.queues.get(session_id).and_then(|queue| {
            queue
                .iter()
                .position(|turn| turn.turn_id() == queued_turn.turn_id())
                .and_then(|index| {
                    queue
                        .get(index)
                        .and_then(|turn| Self::snapshot_queued_turn(session_id, turn, index + 1))
                })
        });
        let new_len = self.queues.get(session_id).map(|q| q.len()).unwrap_or(0);
        debug!(
            "Message queued: session_id={}, queue_depth={}, priority={:?}",
            session_id, new_len, queued_turn.policy.queue_priority
        );
        if let Some(snapshot) = queued_snapshot.as_ref() {
            self.emit_queue_queued(snapshot, queued_turn.owner.clone(), new_len)
                .await;
        }
        Ok(())
    }

    fn clear_queue(&self, session_id: &str) {
        if let Some(mut queue) = self.queues.get_mut(session_id) {
            let count = queue.len();
            queue.clear();
            if count > 0 {
                info!(
                    "Cleared {} queued messages: session_id={}",
                    count, session_id
                );
            }
        }
        self.queue_pauses.remove(session_id);
    }

    fn dequeue_next(&self, session_id: &str) -> Option<QueuedTurn> {
        self.queues
            .get_mut(session_id)
            .and_then(|mut q| q.pop_front())
    }

    fn remove_queued_turn(&self, session_id: &str, turn_id: &str) -> Option<(QueuedTurn, usize)> {
        let mut queue = self.queues.get_mut(session_id)?;
        let index = queue
            .iter()
            .position(|queued_turn| queued_turn.turn_id() == Some(turn_id))?;
        let queued_turn = queue.remove(index)?;
        let remaining = queue.len();
        if queue.is_empty() {
            drop(queue);
            self.queues.remove(session_id);
        }
        Some((queued_turn, remaining))
    }

    fn requeue_front(&self, session_id: &str, turn: QueuedTurn) {
        self.queues
            .entry(session_id.to_string())
            .or_default()
            .push_front(turn);
    }

    async fn try_start_next_queued(&self, session_id: &str) -> Result<Option<String>, String> {
        if self.is_queue_paused(session_id) {
            return Ok(None);
        }

        let state = self
            .session_manager
            .get_session(session_id)
            .map(|s| s.state.clone());
        if matches!(state, Some(SessionState::Processing { .. })) {
            return Ok(None);
        }

        let Some(next_turn) = self.dequeue_next(session_id) else {
            return Ok(None);
        };

        let remaining = self.queues.get(session_id).map(|q| q.len()).unwrap_or(0);
        info!(
            "Dispatching queued message: session_id={}, priority={:?}, remaining_queue_depth={}",
            session_id, next_turn.policy.queue_priority, remaining
        );
        if let Some(turn_id) = next_turn.turn_id() {
            self.emit_queue_dispatching(session_id, turn_id, remaining)
                .await;
        }

        match self.start_turn(session_id, &next_turn).await {
            Ok(tid) => Ok(Some(tid)),
            Err(err) => {
                self.requeue_front(session_id, next_turn);
                Err(err)
            }
        }
    }

    async fn start_turn(
        &self,
        session_id: &str,
        queued_turn: &QueuedTurn,
    ) -> Result<String, String> {
        // Inject routing metadata for system-triggered turns so the frontend can
        // render their source without changing the normal message queue shape.
        let extra_metadata = Self::merge_turn_metadata(
            queued_turn.extra_metadata.clone(),
            queued_turn.reply_route.as_ref(),
        );

        let res = match queued_turn
            .image_contexts
            .as_ref()
            .filter(|imgs| !imgs.is_empty())
        {
            Some(imgs) => {
                self.coordinator
                    .start_dialog_turn_with_image_contexts(
                        session_id.to_string(),
                        queued_turn.user_input.clone(),
                        queued_turn.original_user_input.clone(),
                        imgs.clone(),
                        queued_turn.turn_id.clone(),
                        queued_turn.agent_type.clone(),
                        queued_turn.system_reminder_override.clone(),
                        queued_turn.policy,
                        extra_metadata,
                    )
                    .await
            }
            None => {
                self.coordinator
                    .start_dialog_turn(
                        session_id.to_string(),
                        queued_turn.user_input.clone(),
                        queued_turn.original_user_input.clone(),
                        queued_turn.turn_id.clone(),
                        queued_turn.agent_type.clone(),
                        queued_turn.system_reminder_override.clone(),
                        queued_turn.policy,
                        extra_metadata,
                    )
                    .await
            }
        };

        res.map_err(|e| e.to_string())?;

        let resolved = self
            .session_manager
            .get_session(session_id)
            .and_then(|s| match &s.state {
                SessionState::Processing {
                    current_turn_id, ..
                } => Some(current_turn_id.clone()),
                _ => None,
            })
            .ok_or_else(|| {
                format!(
                    "Failed to resolve turn_id after starting dialog: session_id={}",
                    session_id
                )
            })?;

        self.active_turns.insert(
            session_id.to_string(),
            ActiveTurn::from_queued_turn(queued_turn, resolved.clone()),
        );
        self.publish_turn_started(session_id, &resolved, queued_turn.owner.clone());

        Ok(resolved)
    }

    fn merge_turn_metadata(
        base: Option<serde_json::Value>,
        reply_route: Option<&AgentSessionReplyRoute>,
    ) -> Option<serde_json::Value> {
        let mut object = match base {
            Some(serde_json::Value::Object(map)) => map,
            Some(_) | None => serde_json::Map::new(),
        };

        if let Some(route) = reply_route {
            object
                .entry("sourceSessionId".to_string())
                .or_insert_with(|| serde_json::json!(route.source_session_id.clone()));
        }

        if object.is_empty() {
            None
        } else {
            Some(serde_json::Value::Object(object))
        }
    }

    async fn forward_agent_session_reply(
        &self,
        responder_session_id: &str,
        active_turn: &ActiveTurn,
        outcome: &TurnOutcome,
    ) {
        if !active_turn.is_agent_session_request() {
            return;
        }

        let Some(reply_route) = active_turn.reply_route.as_ref() else {
            return;
        };

        let responder_workspace = active_turn
            .workspace_path
            .as_deref()
            .unwrap_or("<unknown workspace>");
        let reply_user_input = outcome.reply_text();
        let reply_message =
            Self::format_agent_session_reply(responder_session_id, responder_workspace, outcome);

        if let Err(error) = self
            .submit(
                reply_route.source_session_id.clone(),
                reply_message,
                Some(reply_user_input),
                None,
                String::new(),
                None,
                Some(reply_route.source_workspace_path.clone()),
                DialogSubmissionPolicy::for_source(DialogTriggerSource::AgentSession),
                None,
                None,
            )
            .await
        {
            warn!(
                "Failed to forward agent-session reply: responder_session_id={}, source_session_id={}, error={}",
                responder_session_id, reply_route.source_session_id, error
            );
        }
    }

    fn take_suppressed_cancelled_reply(&self, session_id: &str, turn_id: &str) -> bool {
        self.suppressed_cancelled_replies
            .remove(&(session_id.to_string(), turn_id.to_string()))
            .is_some()
    }

    fn should_skip_agent_session_reply(
        outcome: &TurnOutcome,
        suppressed_cancelled_reply: bool,
    ) -> bool {
        matches!(outcome, TurnOutcome::Cancelled { .. }) && suppressed_cancelled_reply
    }

    fn format_agent_session_reply(
        responder_session_id: &str,
        responder_workspace: &str,
        outcome: &TurnOutcome,
    ) -> String {
        let mut envelope = PromptEnvelope::new();
        let status = outcome.status();
        let reply_text = outcome.reply_text();
        envelope.push_system_reminder(format!(
            "This message is an automated reply to a previous SessionMessage call, not a human user message.\n\
From session: {responder_session_id}\n\
From workspace: {responder_workspace}\n\
Status: {status}"
        ));
        envelope.push_user_query(reply_text);
        envelope.render()
    }

    async fn dispatch_next_if_idle(&self, session_id: &str) -> Result<(), String> {
        let _ = self.try_start_next_queued(session_id).await?;
        Ok(())
    }

    /// Background loop that receives turn outcome notifications from the coordinator.
    async fn run_outcome_handler(&self, mut outcome_rx: mpsc::Receiver<(String, TurnOutcome)>) {
        while let Some((session_id, outcome)) = outcome_rx.recv().await {
            self.round_yield_flags.clear(&session_id);
            let suppressed_cancelled_reply =
                self.take_suppressed_cancelled_reply(&session_id, outcome.turn_id());

            let active_turn = self.active_turns.remove(&session_id).map(|(_, turn)| turn);
            if let Some(active_turn) = active_turn.as_ref() {
                if Self::should_skip_agent_session_reply(&outcome, suppressed_cancelled_reply) {
                    debug!(
                        "Skipping cancelled auto-reply because the source session explicitly cancelled its own SessionMessage request: session_id={}, turn_id={}",
                        session_id,
                        outcome.turn_id()
                    );
                } else {
                    self.forward_agent_session_reply(&session_id, active_turn, &outcome)
                        .await;
                }
            }
            self.publish_turn_finished(
                &session_id,
                active_turn.as_ref().map(|turn| turn.owner.clone()),
                &outcome,
            )
            .await;

            let status = outcome.status();
            match outcome.queue_action() {
                TurnOutcomeQueueAction::DispatchNext => {
                    if let Err(e) = self.dispatch_next_if_idle(&session_id).await {
                        warn!(
                            "Failed to dispatch next queued message after {}: session_id={}, error={}",
                            status,
                            session_id,
                            e
                        );
                    }
                }
                TurnOutcomeQueueAction::PauseQueue => {
                    debug!("Turn {}, pausing queue: session_id={}", status, session_id);
                    let (reason, error) = match &outcome {
                        TurnOutcome::Cancelled { .. } => {
                            (DialogQueuePauseReason::UserCancelled, None)
                        }
                        TurnOutcome::Failed { error, .. } => {
                            (DialogQueuePauseReason::RunFailed, Some(error.clone()))
                        }
                        TurnOutcome::Completed { .. } => continue,
                    };
                    self.pause_queue(
                        &session_id,
                        reason,
                        Some(outcome.turn_id().to_string()),
                        error,
                    )
                    .await;
                }
            }
        }
    }
}

// ── Process-wide singleton accessor (installation-only API) ──────────────────
//
// See `coordinator::install_global_coordinator` for the broader rationale.
// The scheduler is a single shared instance per process — it pumps turn
// outcomes for all sessions across all mounted workspaces. Tools should
// use `ToolUseContext::agentic()`; this lookup is for long-lived
// non-tool subsystems that run outside the per-tool injection path.

static GLOBAL_SCHEDULER: std::sync::OnceLock<std::sync::Arc<DialogScheduler>> =
    std::sync::OnceLock::new();

/// Install the process-wide scheduler. Called once at boot by `AppContainer`.
pub fn install_global_scheduler(scheduler: std::sync::Arc<DialogScheduler>) -> Result<(), ()> {
    GLOBAL_SCHEDULER.set(scheduler).map_err(|_| ())
}

/// Look up the installed process-wide scheduler. Returns `None` until
/// `AppContainer` has finished Stage-D boot.
pub fn get_global_scheduler() -> Option<std::sync::Arc<DialogScheduler>> {
    GLOBAL_SCHEDULER.get().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent_session_active_turn(source_session_id: &str) -> ActiveTurn {
        ActiveTurn {
            turn_id: "turn_1".to_string(),
            workspace_path: Some("/workspace".to_string()),
            owner: SessionWorkOwner::AgentSession,
            policy: DialogSubmissionPolicy::for_source(DialogTriggerSource::AgentSession),
            reply_route: Some(AgentSessionReplyRoute {
                source_session_id: source_session_id.to_string(),
                source_workspace_path: "/source".to_string(),
            }),
        }
    }

    #[test]
    fn requester_matching_reply_route_suppresses_cancelled_reply() {
        let active_turn = agent_session_active_turn("session_a");
        assert!(active_turn.should_suppress_cancelled_reply_for_requester("session_a"));
        assert!(!active_turn.should_suppress_cancelled_reply_for_requester("session_c"));
    }

    #[test]
    fn cancelled_reply_is_skipped_only_when_suppressed() {
        let cancelled = TurnOutcome::Cancelled {
            turn_id: "turn_1".to_string(),
            reason: TurnCancellationReason::UserRequested,
            actor: SessionControlActor::User,
        };
        let completed = TurnOutcome::Completed {
            turn_id: "turn_1".to_string(),
            final_response: "done".to_string(),
        };

        assert!(DialogScheduler::should_skip_agent_session_reply(
            &cancelled, true
        ));
        assert!(!DialogScheduler::should_skip_agent_session_reply(
            &cancelled, false
        ));
        assert!(!DialogScheduler::should_skip_agent_session_reply(
            &completed, true
        ));
    }

    #[test]
    fn work_message_policy_uses_normal_queue_without_confirmation() {
        let policy = DialogSubmissionPolicy::for_source(DialogTriggerSource::WorkMessage);

        assert_eq!(policy.trigger_source, DialogTriggerSource::WorkMessage);
        assert_eq!(policy.queue_priority, DialogQueuePriority::Normal);
        assert!(policy.skip_tool_confirmation);
        assert!(policy.persist_agent_type);
        assert!(!DialogScheduler::user_message_may_preempt(&policy));
    }

    #[test]
    fn merge_turn_metadata_preserves_work_message_marker() {
        let metadata = DialogScheduler::merge_turn_metadata(
            Some(serde_json::json!({
                "workMessageKind": "execution_finished",
                "workId": "work_123",
                "workExecutionStatus": "completed"
            })),
            None,
        )
        .expect("metadata");

        assert_eq!(metadata["workMessageKind"], "execution_finished");
        assert_eq!(metadata["workId"], "work_123");
        assert_eq!(metadata["workExecutionStatus"], "completed");
        assert!(metadata.get("sourceSessionId").is_none());
    }

    #[test]
    fn merge_turn_metadata_adds_reply_source_without_overwriting_work_source() {
        let metadata = DialogScheduler::merge_turn_metadata(
            Some(serde_json::json!({
                "workMessageKind": "execution_finished",
                "sourceSessionId": "work-session"
            })),
            Some(&AgentSessionReplyRoute {
                source_session_id: "owner-session".to_string(),
                source_workspace_path: "/owner".to_string(),
            }),
        )
        .expect("metadata");

        assert_eq!(metadata["workMessageKind"], "execution_finished");
        assert_eq!(metadata["sourceSessionId"], "work-session");
    }
}
