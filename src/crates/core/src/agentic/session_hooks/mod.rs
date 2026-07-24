//! Session lifecycle hooks and driver port.
//!
//! Agentic events describe facts for transports and logs. Session hooks are the
//! typed, ordered extension surface for systems that want to react to a session
//! lifecycle and, when authorized, drive the session forward.

use super::coordination::{
    DialogQueuePriority, DialogScheduler, DialogSubmitOutcome, DialogTriggerSource,
    SessionControlActor, TurnCancellationReason,
};
use super::core::SessionState;
use super::events::{AgenticEvent, EventSubscriber, SessionSurfaceMode, ToolEventData};
use crate::error::{CoreError, CoreResult};
use async_trait::async_trait;
use dashmap::DashMap;
use log::{debug, warn};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionWorkOwner {
    User,
    Goal { goal_id: String, revision: u64 },
    AgentSession,
    WorkMessage,
    ScheduledJob,
    RemoteRelay,
    Bot,
    System { id: String },
}

impl SessionWorkOwner {
    pub fn from_trigger_source(trigger_source: DialogTriggerSource) -> Self {
        match trigger_source {
            DialogTriggerSource::Goal => Self::System {
                id: "legacy_goal".to_string(),
            },
            DialogTriggerSource::AgentSession => Self::AgentSession,
            DialogTriggerSource::WorkMessage => Self::WorkMessage,
            DialogTriggerSource::ScheduledJob => Self::ScheduledJob,
            DialogTriggerSource::RemoteRelay => Self::RemoteRelay,
            DialogTriggerSource::Bot => Self::Bot,
            DialogTriggerSource::DesktopUi
            | DialogTriggerSource::DesktopApi
            | DialogTriggerSource::Cli => Self::User,
        }
    }

    pub fn goal(goal_id: impl Into<String>, revision: u64) -> Self {
        Self::Goal {
            goal_id: goal_id.into(),
            revision,
        }
    }

    pub fn is_goal(&self) -> bool {
        matches!(self, Self::Goal { .. })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionWorkOwnerMatcher {
    Exact(SessionWorkOwner),
    AnyGoal,
    Any,
}

impl SessionWorkOwnerMatcher {
    pub fn matches(&self, owner: &SessionWorkOwner) -> bool {
        match self {
            Self::Exact(expected) => expected == owner,
            Self::AnyGoal => owner.is_goal(),
            Self::Any => true,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionHook {
    pub hook_id: String,
    pub session_id: String,
    pub workspace_path: Option<String>,
    pub sequence: u64,
    pub kind: SessionHookKind,
    pub emitted_at_ms: i64,
}

impl SessionHook {
    pub fn new(
        session_id: impl Into<String>,
        workspace_path: Option<String>,
        kind: SessionHookKind,
    ) -> Self {
        Self {
            hook_id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.into(),
            workspace_path,
            sequence: 0,
            kind,
            emitted_at_ms: now_ms(),
        }
    }

    fn with_sequence(mut self, sequence: u64) -> Self {
        self.sequence = sequence;
        self
    }
}

#[derive(Debug, Clone)]
pub enum SessionHookKind {
    SessionRestored {
        reason: String,
    },
    SessionLifecycleChanged {
        state: String,
        reason: String,
    },
    SessionExecutionChanged {
        new_state: String,
    },
    TurnSubmitted {
        turn_id: String,
        owner: SessionWorkOwner,
        source: String,
    },
    TurnQueued {
        turn_id: String,
        owner: SessionWorkOwner,
        queue_depth: usize,
    },
    TurnStarted {
        turn_id: String,
        owner: SessionWorkOwner,
    },
    TurnProgressed {
        turn_id: String,
        owner: Option<SessionWorkOwner>,
        phase: String,
    },
    TurnCancellationRequested {
        turn_id: String,
        owner: Option<SessionWorkOwner>,
        reason: TurnCancellationReason,
        actor: SessionControlActor,
        surface_mode: SessionSurfaceMode,
    },
    TurnFinished {
        turn_id: String,
        owner: Option<SessionWorkOwner>,
        outcome: SessionTurnOutcome,
        hidden_session: bool,
        surface_mode: SessionSurfaceMode,
    },
    QueueChanged {
        reason: String,
        turn_id: Option<String>,
        error: Option<String>,
        queue_depth: usize,
    },
    ToolFailed {
        turn_id: String,
        tool_name: String,
        error: String,
        surface_mode: SessionSurfaceMode,
    },
    ToolAttentionNeeded {
        turn_id: String,
        tool_name: String,
        reason: String,
        surface_mode: SessionSurfaceMode,
    },
    DriverReconcile {
        reason: String,
    },
}

#[derive(Debug, Clone)]
pub enum SessionTurnOutcome {
    Completed,
    Failed {
        error: String,
    },
    Cancelled {
        reason: TurnCancellationReason,
        actor: SessionControlActor,
    },
}

#[derive(Debug, Clone)]
pub struct SessionRuntimeSnapshot {
    pub session_id: String,
    pub workspace_path: Option<String>,
    pub state: Option<SessionState>,
    pub queue_depth: usize,
    pub queue_pause: Option<SessionQueuePauseSnapshot>,
    pub active_turn_id: Option<String>,
    pub active_owner: Option<SessionWorkOwner>,
}

impl SessionRuntimeSnapshot {
    pub fn is_processing(&self) -> bool {
        matches!(self.state, Some(SessionState::Processing { .. }))
    }
}

#[derive(Debug, Clone)]
pub struct SessionQueuePauseSnapshot {
    pub reason: String,
    pub turn_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SessionHookContext {
    pub hook: SessionHook,
    pub previous_snapshot: Option<SessionRuntimeSnapshot>,
    pub current_snapshot: Option<SessionRuntimeSnapshot>,
}

impl SessionHookContext {
    pub fn workspace_path(&self) -> Option<&str> {
        self.hook
            .workspace_path
            .as_deref()
            .or_else(|| self.current_snapshot.as_ref()?.workspace_path.as_deref())
            .or_else(|| self.previous_snapshot.as_ref()?.workspace_path.as_deref())
    }
}

#[derive(Debug, Clone)]
pub struct SessionDriverSubmit {
    pub session_id: String,
    pub workspace_path: String,
    pub user_input: String,
    pub original_user_input: Option<String>,
    pub turn_id: Option<String>,
    pub agent_type: String,
    pub system_reminder_override: Option<String>,
    pub owner: SessionWorkOwner,
    pub queue_priority: DialogQueuePriority,
    pub skip_tool_confirmation: bool,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionDriverSubmitOutcome {
    Started { session_id: String, turn_id: String },
    Queued { session_id: String, turn_id: String },
}

impl From<DialogSubmitOutcome> for SessionDriverSubmitOutcome {
    fn from(value: DialogSubmitOutcome) -> Self {
        match value {
            DialogSubmitOutcome::Started {
                session_id,
                turn_id,
            } => Self::Started {
                session_id,
                turn_id,
            },
            DialogSubmitOutcome::Queued {
                session_id,
                turn_id,
            } => Self::Queued {
                session_id,
                turn_id,
            },
        }
    }
}

#[derive(Debug, Clone)]
pub enum SessionDriverIntent {
    ResumeQueue {
        session_id: String,
    },
    CancelOwnerWork {
        session_id: String,
        owner: SessionWorkOwnerMatcher,
        fallback_turn_id: Option<String>,
        reason: TurnCancellationReason,
        actor: SessionControlActor,
        wait_timeout: Duration,
    },
}

#[async_trait]
pub trait SessionDriver: Send + Sync {
    async fn snapshot(&self, session_id: &str) -> CoreResult<SessionRuntimeSnapshot>;

    async fn ensure_session_loaded(
        &self,
        workspace_path: &Path,
        session_id: &str,
    ) -> CoreResult<()>;

    async fn submit_turn(
        &self,
        request: SessionDriverSubmit,
    ) -> CoreResult<SessionDriverSubmitOutcome>;

    async fn guide_queued_turn(&self, session_id: &str, turn_id: &str) -> CoreResult<()>;

    async fn delete_queued_turns(
        &self,
        session_id: &str,
        owner: SessionWorkOwnerMatcher,
        except_turn_id: Option<&str>,
    ) -> CoreResult<usize>;

    async fn cancel_active_turn(
        &self,
        session_id: &str,
        owner: SessionWorkOwnerMatcher,
        fallback_turn_id: Option<&str>,
        reason: TurnCancellationReason,
        actor: SessionControlActor,
        wait_timeout: Duration,
    ) -> CoreResult<Option<String>>;

    async fn resume_queue(&self, session_id: &str) -> CoreResult<Option<String>>;

    async fn is_turn_completed(&self, session_id: &str, turn_id: &str) -> CoreResult<bool>;

    async fn execute_intent(&self, intent: SessionDriverIntent) -> CoreResult<()> {
        match intent {
            SessionDriverIntent::ResumeQueue { session_id } => {
                let _ = self.resume_queue(&session_id).await?;
            }
            SessionDriverIntent::CancelOwnerWork {
                session_id,
                owner,
                fallback_turn_id,
                reason,
                actor,
                wait_timeout,
            } => {
                let _ = self
                    .cancel_active_turn(
                        &session_id,
                        owner,
                        fallback_turn_id.as_deref(),
                        reason,
                        actor,
                        wait_timeout,
                    )
                    .await?;
            }
        }
        Ok(())
    }
}

#[async_trait]
pub trait SessionExtension: Send + Sync + 'static {
    fn id(&self) -> &'static str;

    async fn on_session_hook(
        &self,
        context: SessionHookContext,
        driver: Arc<dyn SessionDriver>,
    ) -> CoreResult<Vec<SessionDriverIntent>>;
}

pub struct SessionHookBus {
    extensions: Arc<DashMap<String, Arc<dyn SessionExtension>>>,
    driver: Arc<RwLock<Option<Arc<dyn SessionDriver>>>>,
    sequences: Mutex<HashMap<String, u64>>,
    last_snapshots: Mutex<HashMap<String, SessionRuntimeSnapshot>>,
}

impl SessionHookBus {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            extensions: Arc::new(DashMap::new()),
            driver: Arc::new(RwLock::new(None)),
            sequences: Mutex::new(HashMap::new()),
            last_snapshots: Mutex::new(HashMap::new()),
        })
    }

    pub async fn set_driver(&self, driver: Arc<dyn SessionDriver>) {
        *self.driver.write().await = Some(driver);
    }

    pub fn register_extension(&self, extension: Arc<dyn SessionExtension>) {
        let id = extension.id().to_string();
        self.extensions.insert(id.clone(), extension);
        debug!("Registered session extension: {}", id);
    }

    pub async fn publish(&self, hook: SessionHook) {
        self.process(hook).await;
    }

    pub fn publish_background(self: &Arc<Self>, hook: SessionHook) {
        let bus = self.clone();
        tokio::spawn(async move {
            bus.process(hook).await;
        });
    }

    async fn process(&self, hook: SessionHook) {
        let hook = self.assign_sequence(hook);
        let Some(driver) = self.driver.read().await.clone() else {
            debug!("Skipping session hook because no driver is installed");
            return;
        };
        let current_snapshot = driver.snapshot(&hook.session_id).await.ok();
        let previous_snapshot =
            self.update_snapshot_history(&hook.session_id, current_snapshot.clone());
        let context = SessionHookContext {
            hook,
            previous_snapshot,
            current_snapshot,
        };
        let extensions: Vec<Arc<dyn SessionExtension>> = self
            .extensions
            .iter()
            .map(|entry| entry.value().clone())
            .collect();

        for extension in extensions {
            match extension
                .on_session_hook(context.clone(), driver.clone())
                .await
            {
                Ok(intents) => {
                    for intent in intents {
                        if let Err(error) = driver.execute_intent(intent).await {
                            warn!(
                                "Session extension intent failed: extension={} error={}",
                                extension.id(),
                                error
                            );
                        }
                    }
                }
                Err(error) => {
                    warn!(
                        "Session extension failed: extension={} session_id={} error={}",
                        extension.id(),
                        context.hook.session_id,
                        error
                    );
                }
            }
        }
    }

    fn assign_sequence(&self, hook: SessionHook) -> SessionHook {
        let mut sequences = self
            .sequences
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let next = sequences
            .entry(hook.session_id.clone())
            .and_modify(|value| *value += 1)
            .or_insert(1);
        hook.with_sequence(*next)
    }

    fn update_snapshot_history(
        &self,
        session_id: &str,
        current_snapshot: Option<SessionRuntimeSnapshot>,
    ) -> Option<SessionRuntimeSnapshot> {
        let mut snapshots = self
            .last_snapshots
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous = snapshots.get(session_id).cloned();
        if let Some(snapshot) = current_snapshot {
            snapshots.insert(session_id.to_string(), snapshot);
        }
        previous
    }
}

pub struct ToolSessionHookSubscriber {
    hook_bus: Arc<SessionHookBus>,
}

impl ToolSessionHookSubscriber {
    pub fn new(hook_bus: Arc<SessionHookBus>) -> Self {
        Self { hook_bus }
    }

    fn hook_from_event(event: &AgenticEvent) -> Option<SessionHook> {
        match event {
            AgenticEvent::ToolEvent {
                session_id,
                turn_id,
                tool_event,
                surface_mode,
                ..
            } => match tool_event {
                ToolEventData::Failed {
                    tool_name, error, ..
                } => Some(SessionHook::new(
                    session_id.clone(),
                    None,
                    SessionHookKind::ToolFailed {
                        turn_id: turn_id.clone(),
                        tool_name: tool_name.clone(),
                        error: error.clone(),
                        surface_mode: *surface_mode,
                    },
                )),
                ToolEventData::ConfirmationNeeded { tool_name, .. } => Some(SessionHook::new(
                    session_id.clone(),
                    None,
                    SessionHookKind::ToolAttentionNeeded {
                        turn_id: turn_id.clone(),
                        tool_name: tool_name.clone(),
                        reason: "tool_confirmation_needed".to_string(),
                        surface_mode: *surface_mode,
                    },
                )),
                _ => None,
            },
            _ => None,
        }
    }
}

#[async_trait]
impl EventSubscriber for ToolSessionHookSubscriber {
    async fn on_event(&self, event: &AgenticEvent) -> CoreResult<()> {
        if let Some(hook) = Self::hook_from_event(event) {
            self.hook_bus.publish(hook).await;
        }
        Ok(())
    }
}

pub struct SchedulerSessionDriver {
    scheduler: Arc<DialogScheduler>,
}

impl SchedulerSessionDriver {
    pub fn new(scheduler: Arc<DialogScheduler>) -> Self {
        Self { scheduler }
    }
}

#[async_trait]
impl SessionDriver for SchedulerSessionDriver {
    async fn snapshot(&self, session_id: &str) -> CoreResult<SessionRuntimeSnapshot> {
        let session = self.scheduler.session_manager().get_session(session_id);
        let queue_pause =
            self.scheduler
                .queue_pause(session_id)
                .map(|pause| SessionQueuePauseSnapshot {
                    reason: pause.reason,
                    turn_id: pause.turn_id,
                    error: pause.error,
                });
        let active = self.scheduler.active_turn_snapshot(session_id);
        Ok(SessionRuntimeSnapshot {
            session_id: session_id.to_string(),
            workspace_path: session
                .as_ref()
                .and_then(|session| session.config.workspace_path.clone()),
            state: session.as_ref().map(|session| session.state.clone()),
            queue_depth: self.scheduler.queue_depth(session_id),
            queue_pause,
            active_turn_id: active.as_ref().map(|active| active.turn_id.clone()),
            active_owner: active.map(|active| active.owner),
        })
    }

    async fn ensure_session_loaded(
        &self,
        workspace_path: &Path,
        session_id: &str,
    ) -> CoreResult<()> {
        if self
            .scheduler
            .session_manager()
            .get_session(session_id)
            .is_some()
        {
            return Ok(());
        }
        self.scheduler
            .session_manager()
            .restore_session(&crate::agentic::core::SessionLocator {
                domain: crate::agentic::core::SessionDomain::Workspace {
                    workspace_id: crate::infrastructure::try_get_path_manager_arc()?
                        .workspace_id(workspace_path)?,
                },
                session_id: session_id.to_string(),
            })
            .await
            .map(|_| ())
    }

    async fn submit_turn(
        &self,
        request: SessionDriverSubmit,
    ) -> CoreResult<SessionDriverSubmitOutcome> {
        self.scheduler
            .submit_driver_turn(request)
            .await
            .map(SessionDriverSubmitOutcome::from)
            .map_err(CoreError::service)
    }

    async fn guide_queued_turn(&self, session_id: &str, turn_id: &str) -> CoreResult<()> {
        self.scheduler
            .guide_queued_turn(session_id, turn_id)
            .await
            .map(|_| ())
            .map_err(CoreError::service)
    }

    async fn delete_queued_turns(
        &self,
        session_id: &str,
        owner: SessionWorkOwnerMatcher,
        except_turn_id: Option<&str>,
    ) -> CoreResult<usize> {
        Ok(self
            .scheduler
            .delete_queued_owner_turns(session_id, owner, except_turn_id)
            .await)
    }

    async fn cancel_active_turn(
        &self,
        session_id: &str,
        owner: SessionWorkOwnerMatcher,
        fallback_turn_id: Option<&str>,
        reason: TurnCancellationReason,
        actor: SessionControlActor,
        wait_timeout: Duration,
    ) -> CoreResult<Option<String>> {
        self.scheduler
            .cancel_owned_active_turn(
                session_id,
                owner,
                fallback_turn_id,
                reason,
                actor,
                wait_timeout,
            )
            .await
    }

    async fn resume_queue(&self, session_id: &str) -> CoreResult<Option<String>> {
        self.scheduler
            .resume_queue(session_id)
            .await
            .map_err(CoreError::service)
    }

    async fn is_turn_completed(&self, session_id: &str, turn_id: &str) -> CoreResult<bool> {
        let Some(session) = self.scheduler.session_manager().get_session(session_id) else {
            return Ok(false);
        };

        if matches!(
            session.state,
            SessionState::Processing {
                ref current_turn_id,
                ..
            } if current_turn_id == turn_id
        ) {
            return Ok(false);
        }

        if self
            .scheduler
            .list_queue(session_id)
            .iter()
            .any(|queued| queued.turn_id == turn_id)
        {
            return Ok(false);
        }

        let Some(turn_index) = session
            .dialog_turn_ids
            .iter()
            .position(|candidate| candidate == turn_id)
        else {
            return Ok(false);
        };
        let turns = self
            .scheduler
            .session_manager()
            .load_turns_in_range(session_id, turn_index, turn_index)
            .await?;
        Ok(turns.iter().any(|turn| {
            turn.turn_id == turn_id
                && matches!(turn.status, crate::service::session::TurnStatus::Completed)
        }))
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owner_matcher_matches_goal_family_without_matching_user_work() {
        let goal_owner = SessionWorkOwner::goal("goal-1", 3);
        let user_owner = SessionWorkOwner::User;

        assert!(SessionWorkOwnerMatcher::AnyGoal.matches(&goal_owner));
        assert!(!SessionWorkOwnerMatcher::AnyGoal.matches(&user_owner));
        assert!(SessionWorkOwnerMatcher::Exact(goal_owner.clone()).matches(&goal_owner));
        assert!(!SessionWorkOwnerMatcher::Exact(goal_owner).matches(&user_owner));
    }

    #[test]
    fn hook_bus_assigns_per_session_sequence_numbers() {
        let bus = SessionHookBus::new();
        let first = bus.assign_sequence(SessionHook::new(
            "session-1",
            None,
            SessionHookKind::SessionExecutionChanged {
                new_state: "processing".to_string(),
            },
        ));
        let second = bus.assign_sequence(SessionHook::new(
            "session-1",
            None,
            SessionHookKind::SessionExecutionChanged {
                new_state: "idle".to_string(),
            },
        ));
        let other = bus.assign_sequence(SessionHook::new(
            "session-2",
            None,
            SessionHookKind::SessionExecutionChanged {
                new_state: "idle".to_string(),
            },
        ));

        assert_eq!(first.sequence, 1);
        assert_eq!(second.sequence, 2);
        assert_eq!(other.sequence, 1);
    }

    #[test]
    fn event_bridge_leaves_turn_finished_to_runtime_hooks() {
        let event = AgenticEvent::DialogTurnCompleted {
            session_id: "session-1".to_string(),
            turn_id: "turn-1".to_string(),
            total_rounds: 1,
            total_tools: 0,
            duration_ms: 12,
            hidden_session: false,
            surface_mode: SessionSurfaceMode::UserVisible,
            subagent_parent_info: None,
        };

        assert!(ToolSessionHookSubscriber::hook_from_event(&event).is_none());
    }
}
