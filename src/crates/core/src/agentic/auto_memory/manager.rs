use crate::agentic::auto_memory::AutoMemoryQueueAction;
use crate::agentic::coordination::ConversationCoordinator;
use dashmap::DashMap;
use log::{debug, warn};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{Notify, Semaphore};
use tokio::time::{sleep_until, Duration, Instant};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone)]
struct WorkspaceRunState {
    worker_running: bool,
    pending_sessions: HashSet<String>,
    delayed_sessions: HashMap<String, i64>,
    known_sessions: HashSet<String>,
    active_session_id: Option<String>,
    active_session_cancellation_token: Option<CancellationToken>,
}

enum WorkspaceLoopAction {
    Run {
        session_id: String,
        cancellation_token: CancellationToken,
    },
    Wait {
        ready_at_ms: i64,
        notify: Arc<Notify>,
    },
    Stop,
}

pub struct AutoMemoryManager {
    workspace_runs: Arc<DashMap<String, WorkspaceRunState>>,
    session_workspace_keys: Arc<DashMap<String, String>>,
    workspace_notifiers: Arc<DashMap<String, Arc<Notify>>>,
    global_semaphore: Arc<Semaphore>,
}

impl AutoMemoryManager {
    pub fn new() -> Self {
        Self {
            workspace_runs: Arc::new(DashMap::new()),
            session_workspace_keys: Arc::new(DashMap::new()),
            workspace_notifiers: Arc::new(DashMap::new()),
            global_semaphore: Arc::new(Semaphore::new(1)),
        }
    }

    pub fn schedule_now(
        self: &Arc<Self>,
        coordinator: Arc<ConversationCoordinator>,
        session_id: String,
        workspace_key: String,
    ) {
        self.schedule_session(coordinator, session_id, workspace_key, None);
    }

    pub fn schedule_at(
        self: &Arc<Self>,
        coordinator: Arc<ConversationCoordinator>,
        session_id: String,
        workspace_key: String,
        ready_at_ms: i64,
    ) {
        if ready_at_ms <= current_time_ms() {
            self.schedule_now(coordinator, session_id, workspace_key);
            return;
        }

        self.schedule_session(coordinator, session_id, workspace_key, Some(ready_at_ms));
    }

    pub fn cancel_session(&self, session_id: &str) {
        let Some((_, workspace_key)) = self.session_workspace_keys.remove(session_id) else {
            return;
        };

        if let Some(mut state) = self.workspace_runs.get_mut(&workspace_key) {
            state.pending_sessions.remove(session_id);
            state.delayed_sessions.remove(session_id);
            if state.active_session_id.as_deref() == Some(session_id) {
                if let Some(token) = state.active_session_cancellation_token.as_ref() {
                    token.cancel();
                }
                debug!(
                    "Cancelled active auto memory session run: session_id={}, workspace_key={}",
                    session_id, workspace_key
                );
            } else {
                debug!(
                    "Removed queued auto memory session before execution: session_id={}, workspace_key={}, pending_sessions_remaining={}, delayed_sessions_remaining={}",
                    session_id,
                    workspace_key,
                    state.pending_sessions.len(),
                    state.delayed_sessions.len()
                );
            }
        }

        self.notify_workspace(&workspace_key);
    }

    fn schedule_session(
        self: &Arc<Self>,
        coordinator: Arc<ConversationCoordinator>,
        session_id: String,
        workspace_key: String,
        ready_at_ms: Option<i64>,
    ) {
        self.session_workspace_keys
            .insert(session_id.clone(), workspace_key.clone());

        let (should_spawn, pending_session_count, delayed_session_count, active_session_id) = {
            let mut should_spawn = false;
            if let Some(mut existing) = self.workspace_runs.get_mut(&workspace_key) {
                existing.known_sessions.insert(session_id.clone());
                match ready_at_ms {
                    Some(ready_at_ms) => {
                        if !existing.pending_sessions.contains(&session_id) {
                            existing
                                .delayed_sessions
                                .entry(session_id.clone())
                                .and_modify(|current_ready_at| {
                                    *current_ready_at = (*current_ready_at).min(ready_at_ms);
                                })
                                .or_insert(ready_at_ms);
                        }
                    }
                    None => {
                        existing.delayed_sessions.remove(&session_id);
                        existing.pending_sessions.insert(session_id.clone());
                    }
                }

                let pending_session_count = existing.pending_sessions.len();
                let delayed_session_count = existing.delayed_sessions.len();
                let active_session_id = existing.active_session_id.clone();
                if !existing.worker_running {
                    existing.worker_running = true;
                    should_spawn = true;
                }
                (
                    should_spawn,
                    pending_session_count,
                    delayed_session_count,
                    active_session_id,
                )
            } else {
                let mut pending_sessions = HashSet::new();
                let mut delayed_sessions = HashMap::new();
                match ready_at_ms {
                    Some(ready_at_ms) => {
                        delayed_sessions.insert(session_id.clone(), ready_at_ms);
                    }
                    None => {
                        pending_sessions.insert(session_id.clone());
                    }
                }
                let mut known_sessions = HashSet::new();
                known_sessions.insert(session_id.clone());
                self.workspace_runs.insert(
                    workspace_key.clone(),
                    WorkspaceRunState {
                        worker_running: true,
                        pending_sessions,
                        delayed_sessions,
                        known_sessions,
                        active_session_id: None,
                        active_session_cancellation_token: None,
                    },
                );
                should_spawn = true;
                (
                    should_spawn,
                    ready_at_ms.is_none() as usize,
                    ready_at_ms.is_some() as usize,
                    None,
                )
            }
        };

        debug!(
            "Scheduled auto memory session: session_id={}, workspace_key={}, worker_spawned={}, pending_sessions={}, delayed_sessions={}, active_session_id={}, ready_at_ms={}",
            session_id,
            workspace_key,
            should_spawn,
            pending_session_count,
            delayed_session_count,
            active_session_id.as_deref().unwrap_or("<none>"),
            ready_at_ms
                .map(|value| value.to_string())
                .unwrap_or_else(|| "<now>".to_string())
        );

        self.notify_workspace(&workspace_key);

        if !should_spawn {
            return;
        }

        let manager = self.clone();
        tokio::spawn(async move {
            manager.run_workspace_loop(coordinator, workspace_key).await;
        });
    }

    async fn run_workspace_loop(
        self: Arc<Self>,
        coordinator: Arc<ConversationCoordinator>,
        workspace_key: String,
    ) {
        debug!(
            "Started auto memory workspace worker: workspace_key={}",
            workspace_key
        );

        loop {
            match self.next_workspace_action(&workspace_key) {
                WorkspaceLoopAction::Run {
                    session_id,
                    cancellation_token,
                } => {
                    let permit = self.global_semaphore.clone().acquire_owned().await;
                    let run_result = match permit {
                        Ok(_permit) => {
                            coordinator
                                .run_auto_memory_cycle(&session_id, &cancellation_token)
                                .await
                        }
                        Err(err) => {
                            warn!(
                                "Auto memory global semaphore closed unexpectedly: workspace_key={}, session_id={}, error={}",
                                workspace_key, session_id, err
                            );
                            self.finish_session_run(
                                &workspace_key,
                                &session_id,
                                AutoMemoryQueueAction::Skip,
                            );
                            continue;
                        }
                    };

                    let mut executed = false;
                    match run_result {
                        Ok(did_run) => {
                            executed = did_run;
                        }
                        Err(crate::util::errors::BitFunError::Cancelled(_)) => {
                            debug!(
                                "Auto memory cycle cancelled: workspace_key={}, session_id={}",
                                workspace_key, session_id
                            );
                        }
                        Err(err) => {
                            warn!(
                                "Auto memory cycle failed: workspace_key={}, session_id={}, error={}",
                                workspace_key, session_id, err
                            );
                        }
                    }

                    let followup_action = if cancellation_token.is_cancelled() {
                        AutoMemoryQueueAction::Skip
                    } else {
                        coordinator.next_auto_memory_queue_action(&session_id).await
                    };
                    self.finish_session_run(&workspace_key, &session_id, followup_action);

                    debug!(
                        "Finished auto memory session run: workspace_key={}, session_id={}, executed={}, followup_action={:?}",
                        workspace_key, session_id, executed, followup_action
                    );
                }
                WorkspaceLoopAction::Wait {
                    ready_at_ms,
                    notify,
                } => {
                    let sleep_duration_ms =
                        ready_at_ms.saturating_sub(current_time_ms()).max(0) as u64;
                    let sleep_deadline = Instant::now() + Duration::from_millis(sleep_duration_ms);
                    debug!(
                        "Waiting for delayed auto memory session: workspace_key={}, ready_at_ms={}, sleep_duration_ms={}",
                        workspace_key, ready_at_ms, sleep_duration_ms
                    );
                    tokio::select! {
                        _ = sleep_until(sleep_deadline) => {}
                        _ = notify.notified() => {}
                    }
                }
                WorkspaceLoopAction::Stop => break,
            }
        }

        debug!(
            "Stopped auto memory workspace worker: workspace_key={}",
            workspace_key
        );
    }

    fn next_workspace_action(&self, workspace_key: &str) -> WorkspaceLoopAction {
        self.promote_ready_delayed_sessions(workspace_key, current_time_ms());

        let notify = self.get_or_create_notify(workspace_key);
        let Some(mut state) = self.workspace_runs.get_mut(workspace_key) else {
            return WorkspaceLoopAction::Stop;
        };

        if let Some(session_id) = state.pending_sessions.iter().next().cloned() {
            state.pending_sessions.remove(&session_id);
            state.delayed_sessions.remove(&session_id);
            let cancellation_token = CancellationToken::new();
            state.active_session_id = Some(session_id.clone());
            state.active_session_cancellation_token = Some(cancellation_token.clone());
            debug!(
                "Starting auto memory session run: workspace_key={}, session_id={}, pending_sessions_remaining={}, delayed_sessions_remaining={}",
                workspace_key,
                session_id,
                state.pending_sessions.len(),
                state.delayed_sessions.len()
            );
            return WorkspaceLoopAction::Run {
                session_id,
                cancellation_token,
            };
        }

        if let Some(ready_at_ms) = state.delayed_sessions.values().copied().min() {
            return WorkspaceLoopAction::Wait {
                ready_at_ms,
                notify,
            };
        }

        state.worker_running = false;
        state.active_session_id = None;
        state.active_session_cancellation_token = None;
        state.known_sessions.clear();
        drop(state);

        self.workspace_runs.remove(workspace_key);
        self.workspace_notifiers.remove(workspace_key);

        WorkspaceLoopAction::Stop
    }

    fn promote_ready_delayed_sessions(&self, workspace_key: &str, now_ms: i64) {
        if let Some(mut state) = self.workspace_runs.get_mut(workspace_key) {
            let ready_session_ids: Vec<String> = state
                .delayed_sessions
                .iter()
                .filter_map(|(session_id, ready_at_ms)| {
                    if *ready_at_ms <= now_ms {
                        Some(session_id.clone())
                    } else {
                        None
                    }
                })
                .collect();

            for session_id in ready_session_ids {
                state.delayed_sessions.remove(&session_id);
                state.pending_sessions.insert(session_id);
            }
        }
    }

    fn finish_session_run(
        &self,
        workspace_key: &str,
        session_id: &str,
        followup_action: AutoMemoryQueueAction,
    ) {
        if let Some(mut state) = self.workspace_runs.get_mut(workspace_key) {
            if state.active_session_id.as_deref() == Some(session_id) {
                state.active_session_id = None;
                state.active_session_cancellation_token = None;
            }

            match followup_action {
                AutoMemoryQueueAction::Skip => {
                    state.delayed_sessions.remove(session_id);
                }
                AutoMemoryQueueAction::QueueNow => {
                    state.delayed_sessions.remove(session_id);
                    state.pending_sessions.insert(session_id.to_string());
                    state.known_sessions.insert(session_id.to_string());
                }
                AutoMemoryQueueAction::QueueAt { ready_at_ms } => {
                    state.pending_sessions.remove(session_id);
                    state
                        .delayed_sessions
                        .insert(session_id.to_string(), ready_at_ms);
                    state.known_sessions.insert(session_id.to_string());
                }
            }

            debug!(
                "Updated auto memory workspace run state: workspace_key={}, session_id={}, followup_action={:?}, pending_sessions={}, delayed_sessions={}",
                workspace_key,
                session_id,
                followup_action,
                state.pending_sessions.len(),
                state.delayed_sessions.len()
            );
        }

        self.notify_workspace(workspace_key);
    }

    fn get_or_create_notify(&self, workspace_key: &str) -> Arc<Notify> {
        self.workspace_notifiers
            .entry(workspace_key.to_string())
            .or_insert_with(|| Arc::new(Notify::new()))
            .clone()
    }

    fn notify_workspace(&self, workspace_key: &str) {
        if let Some(notify) = self.workspace_notifiers.get(workspace_key) {
            notify.notify_one();
        }
    }
}

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}
