use super::overview::{read_host_overview_status, HostOverviewStatus};
use super::state::{
    load_host_scan_state, save_host_scan_state, HostScanAttemptStatus, HostScanState,
    HostScanTrigger,
};
use crate::agentic::coordination::ConversationCoordinator;
use crate::service::config::types::AppHostScanConfig;
use crate::service::config::{
    get_global_config_service, subscribe_config_updates, ConfigUpdateEvent,
};
use crate::util::errors::BitFunResult;
use chrono::{Local, TimeZone};
use log::{debug, error, info, warn};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, Notify};
use tokio::time::Duration;
use uuid::Uuid;

// const INITIAL_EMPTY_OVERVIEW_DELAY_MS: i64 = 5 * 60 * 1_000;
const INITIAL_EMPTY_OVERVIEW_DELAY_MS: i64 = 10 * 1_000; // debug purpose
const AUTO_RETRY_DELAY_MS: i64 = 30 * 60 * 1_000;
const MAX_AUTO_FAILED_ATTEMPTS_PER_DAY: u32 = 3;

#[derive(Debug, Clone)]
struct TrackedHostScanTurn {
    trigger: HostScanTrigger,
    started_at_ms: i64,
    overview_before: HostOverviewStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostScanRunSummary {
    pub started: bool,
    pub trigger: String,
    pub turn_id: Option<String>,
    pub reason: Option<String>,
}

pub struct HostAutoScanService {
    coordinator: Arc<ConversationCoordinator>,
    state: Mutex<HostScanState>,
    tracked_turns: Mutex<HashMap<String, TrackedHostScanTurn>>,
    wake_notify: Notify,
    started: AtomicBool,
}

impl HostAutoScanService {
    pub async fn new(coordinator: Arc<ConversationCoordinator>) -> BitFunResult<Arc<Self>> {
        let state = load_host_scan_state().await?;
        debug!(
            "Loaded host auto scan state: last_attempt_status={:?}, last_attempt_trigger={:?}, next_auto_scan_not_before_ms={:?}, auto_failed_attempts_today={}, active_auto_turn_id={:?}",
            state.last_attempt_status,
            state.last_attempt_trigger,
            state.next_auto_scan_not_before_ms,
            state.auto_failed_attempts_today,
            state.active_auto_turn_id
        );
        Ok(Arc::new(Self {
            coordinator,
            state: Mutex::new(state),
            tracked_turns: Mutex::new(HashMap::new()),
            wake_notify: Notify::new(),
            started: AtomicBool::new(false),
        }))
    }

    pub fn start(self: &Arc<Self>) {
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }

        info!(
            "Host auto scan service started: initial_empty_delay_ms={}, retry_delay_ms={}, max_failed_attempts_per_day={}",
            INITIAL_EMPTY_OVERVIEW_DELAY_MS,
            AUTO_RETRY_DELAY_MS,
            MAX_AUTO_FAILED_ATTEMPTS_PER_DAY
        );

        let service = Arc::clone(self);
        tokio::spawn(async move {
            service.run_loop().await;
        });

        let service = Arc::clone(self);
        tokio::spawn(async move {
            service.run_config_listener().await;
        });
    }

    pub async fn run_now(&self) -> BitFunResult<HostScanRunSummary> {
        if !self.tracked_turns.lock().await.is_empty() {
            return Ok(HostScanRunSummary {
                started: false,
                trigger: trigger_label(&HostScanTrigger::Manual).to_string(),
                turn_id: None,
                reason: Some("A host scan is already active".to_string()),
            });
        }

        let request_id = format!("manual-host-scan-{}", Uuid::new_v4());
        let turn_id = self
            .coordinator
            .start_background_host_scan_turn(
                &request_id,
                Some(trigger_label(&HostScanTrigger::Manual)),
                None,
            )
            .await?;

        self.register_scan_turn(&turn_id, HostScanTrigger::Manual)
            .await?;

        info!(
            "Started manual host scan: request_id={}, turn_id={}",
            request_id, turn_id
        );

        Ok(HostScanRunSummary {
            started: true,
            trigger: trigger_label(&HostScanTrigger::Manual).to_string(),
            turn_id: Some(turn_id),
            reason: None,
        })
    }

    pub async fn register_scan_turn(
        &self,
        turn_id: &str,
        trigger: HostScanTrigger,
    ) -> BitFunResult<()> {
        let turn_id = turn_id.trim();
        if turn_id.is_empty() {
            return Ok(());
        }

        let started_at_ms = now_ms();
        let overview_before = read_host_overview_status().await.unwrap_or_default();
        debug!(
            "Registering host scan turn: turn_id={}, trigger={:?}, started_at_ms={}, overview_before_exists={}, overview_before_empty={}, overview_before_modified_at_ms={:?}",
            turn_id,
            trigger,
            started_at_ms,
            overview_before.exists,
            overview_before.is_empty,
            overview_before.modified_at_ms
        );

        {
            let mut tracked_turns = self.tracked_turns.lock().await;
            tracked_turns.insert(
                turn_id.to_string(),
                TrackedHostScanTurn {
                    trigger: trigger.clone(),
                    started_at_ms,
                    overview_before,
                },
            );
        }

        let mut state = self.state.lock().await;
        prepare_attempt_tracking(&mut state, &trigger, turn_id, started_at_ms);
        save_host_scan_state(&state).await?;
        self.wake_notify.notify_one();
        Ok(())
    }

    pub async fn handle_turn_completed(&self, turn_id: &str) -> BitFunResult<()> {
        if let Some(tracked) = self.take_tracked_turn(turn_id).await {
            let finished_at_ms = now_ms();
            let mut state = self.state.lock().await;
            finalize_attempt(
                &mut state,
                &tracked.trigger,
                HostScanAttemptStatus::Ok,
                finished_at_ms,
                None,
                turn_id,
            );
            save_host_scan_state(&state).await?;
            info!(
                "Host scan turn completed successfully: turn_id={}, trigger={:?}, finished_at_ms={}, next_auto_scan_not_before_ms={:?}, last_successful_scan_at_ms={:?}",
                turn_id,
                tracked.trigger,
                finished_at_ms,
                state.next_auto_scan_not_before_ms,
                state.last_successful_scan_at_ms
            );
            self.wake_notify.notify_one();
        }

        Ok(())
    }

    pub async fn handle_turn_failed(&self, turn_id: &str, error_message: &str) -> BitFunResult<()> {
        if let Some(tracked) = self.take_tracked_turn(turn_id).await {
            let overview_after = read_host_overview_status().await.unwrap_or_default();
            let outcome = resolve_failed_turn_outcome(
                &tracked,
                HostScanAttemptStatus::Error,
                error_message.trim(),
                overview_after.clone(),
            );
            let finished_at_ms = now_ms();
            let mut state = self.state.lock().await;
            finalize_attempt(
                &mut state,
                &tracked.trigger,
                outcome.status.clone(),
                finished_at_ms,
                outcome.error_message.clone(),
                turn_id,
            );
            save_host_scan_state(&state).await?;
            log_host_scan_terminal_outcome(
                "failed",
                turn_id,
                &tracked,
                &outcome.status,
                outcome.error_message.as_deref(),
                finished_at_ms,
                &overview_after,
                &state,
            );
            self.wake_notify.notify_one();
        }

        Ok(())
    }

    pub async fn handle_turn_cancelled(&self, turn_id: &str) -> BitFunResult<()> {
        if let Some(tracked) = self.take_tracked_turn(turn_id).await {
            let overview_after = read_host_overview_status().await.unwrap_or_default();
            let outcome = resolve_failed_turn_outcome(
                &tracked,
                HostScanAttemptStatus::Cancelled,
                "Host scan turn was cancelled",
                overview_after.clone(),
            );
            let finished_at_ms = now_ms();
            let mut state = self.state.lock().await;
            finalize_attempt(
                &mut state,
                &tracked.trigger,
                outcome.status.clone(),
                finished_at_ms,
                outcome.error_message.clone(),
                turn_id,
            );
            save_host_scan_state(&state).await?;
            log_host_scan_terminal_outcome(
                "cancelled",
                turn_id,
                &tracked,
                &outcome.status,
                outcome.error_message.as_deref(),
                finished_at_ms,
                &overview_after,
                &state,
            );
            self.wake_notify.notify_one();
        }

        Ok(())
    }

    async fn run_loop(self: Arc<Self>) {
        if let Err(error) = self.reconcile_startup_state().await {
            error!(
                "Failed to reconcile host auto scan state on startup: {}",
                error
            );
        }

        loop {
            match self.reconcile_and_maybe_start_auto_scan().await {
                Ok(Some(next_wake_after)) => {
                    tokio::select! {
                        _ = tokio::time::sleep(next_wake_after) => {}
                        _ = self.wake_notify.notified() => {}
                    }
                }
                Ok(None) => {
                    self.wake_notify.notified().await;
                }
                Err(error) => {
                    error!("Host auto scan scheduling iteration failed: {}", error);
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_secs(60)) => {}
                        _ = self.wake_notify.notified() => {}
                    }
                }
            }
        }
    }

    async fn run_config_listener(self: Arc<Self>) {
        let Some(mut receiver) = subscribe_config_updates() else {
            warn!("Config update subscription unavailable for host auto scan service");
            return;
        };

        loop {
            match receiver.recv().await {
                Ok(ConfigUpdateEvent::ConfigReloaded) => {
                    debug!("Host auto scan service woke up due to config reload");
                    self.wake_notify.notify_one();
                }
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    warn!("Host auto scan config listener channel closed");
                    break;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
                    warn!(
                        "Host auto scan config listener lagged by {} messages",
                        count
                    );
                }
            }
        }
    }

    async fn reconcile_startup_state(&self) -> BitFunResult<()> {
        let mut state = self.state.lock().await;
        if let Some(active_turn_id) = state.active_auto_turn_id.clone() {
            let startup_status = read_host_overview_status().await.unwrap_or_default();
            let did_update_overview = state
                .last_attempt_started_at_ms
                .map(|started_at_ms| {
                    host_overview_was_updated_after_start(&startup_status, started_at_ms)
                })
                .unwrap_or(false);
            let recovered_status = if did_update_overview {
                HostScanAttemptStatus::Ok
            } else {
                HostScanAttemptStatus::Error
            };
            finalize_attempt(
                &mut state,
                &HostScanTrigger::Auto,
                recovered_status.clone(),
                now_ms(),
                if did_update_overview {
                    None
                } else {
                    Some(format!(
                        "Previous background host scan was interrupted before completion: {}",
                        active_turn_id
                    ))
                },
                &active_turn_id,
            );
            save_host_scan_state(&state).await?;
            match recovered_status {
                HostScanAttemptStatus::Ok => info!(
                    "Recovered interrupted host auto scan as successful because host overview was updated: turn_id={}, overview_modified_at_ms={:?}",
                    active_turn_id,
                    startup_status.modified_at_ms
                ),
                HostScanAttemptStatus::Error => warn!(
                    "Recovered interrupted host auto scan as failed: turn_id={}, next_auto_scan_not_before_ms={:?}, auto_failed_attempts_today={}",
                    active_turn_id,
                    state.next_auto_scan_not_before_ms,
                    state.auto_failed_attempts_today
                ),
                _ => {}
            }
        }
        Ok(())
    }

    async fn reconcile_and_maybe_start_auto_scan(&self) -> BitFunResult<Option<Duration>> {
        let config = load_host_scan_config().await;
        if !config.auto_scan_enabled {
            return Ok(None);
        }

        if !self.tracked_turns.lock().await.is_empty() {
            return Ok(None);
        }

        {
            let state = self.state.lock().await;
            if state.active_auto_turn_id.is_some() {
                return Ok(None);
            }
        }

        let now = now_ms();
        let overview = read_host_overview_status().await?;
        let due_at = {
            let mut state = self.state.lock().await;
            let previous_state = state.clone();
            let due_at = ensure_due_time(&mut state, &overview, &config, now);
            if *state != previous_state {
                debug!(
                    "Host auto scan schedule state changed: now_ms={}, overview_exists={}, overview_empty={}, overview_modified_at_ms={:?}, auto_scan_interval_days={}, previous_next_auto_scan_not_before_ms={:?}, next_auto_scan_not_before_ms={:?}, previous_failed_attempts_today={}, auto_failed_attempts_today={}, last_attempt_status={:?}",
                    now,
                    overview.exists,
                    overview.is_empty,
                    overview.modified_at_ms,
                    config.auto_scan_interval_days,
                    previous_state.next_auto_scan_not_before_ms,
                    state.next_auto_scan_not_before_ms,
                    previous_state.auto_failed_attempts_today,
                    state.auto_failed_attempts_today,
                    state.last_attempt_status
                );
                save_host_scan_state(&state).await?;
            }
            due_at
        };

        let Some(due_at) = due_at else {
            debug!(
                "Host auto scan skipped because no due time could be resolved: now_ms={}, overview_exists={}, overview_empty={}, overview_modified_at_ms={:?}, last_successful_scan_at_ms={:?}",
                now,
                overview.exists,
                overview.is_empty,
                overview.modified_at_ms,
                self.state.lock().await.last_successful_scan_at_ms
            );
            return Ok(None);
        };
        if now < due_at {
            return Ok(Some(duration_until_ms(now, due_at)));
        }

        let request_id = format!("auto-host-scan-{}", Uuid::new_v4());
        info!(
            "Host auto scan is due and will start: request_id={}, due_at_ms={}, now_ms={}, overview_exists={}, overview_empty={}, overview_modified_at_ms={:?}",
            request_id,
            due_at,
            now,
            overview.exists,
            overview.is_empty,
            overview.modified_at_ms
        );
        match self
            .coordinator
            .start_background_host_scan_turn(
                &request_id,
                Some(trigger_label(&HostScanTrigger::Auto)),
                None,
            )
            .await
        {
            Ok(turn_id) => {
                self.register_scan_turn(&turn_id, HostScanTrigger::Auto)
                    .await?;
                info!(
                    "Started automatic host scan: request_id={}, turn_id={}",
                    request_id, turn_id
                );
            }
            Err(error) => {
                warn!(
                    "Failed to start automatic host scan: request_id={}, error={}",
                    request_id, error
                );
                self.record_auto_launch_failure(error.to_string()).await?;
            }
        }

        Ok(None)
    }

    async fn record_auto_launch_failure(&self, error_message: String) -> BitFunResult<()> {
        let mut state = self.state.lock().await;
        let now = now_ms();
        state.last_attempt_started_at_ms = Some(now);
        finalize_attempt(
            &mut state,
            &HostScanTrigger::Auto,
            HostScanAttemptStatus::Error,
            now,
            Some(error_message.clone()),
            "",
        );
        save_host_scan_state(&state).await?;
        warn!(
            "Recorded host auto scan launch failure: finished_at_ms={}, next_auto_scan_not_before_ms={:?}, auto_failed_attempts_today={}, error={}",
            now,
            state.next_auto_scan_not_before_ms,
            state.auto_failed_attempts_today,
            error_message
        );
        Ok(())
    }

    async fn take_tracked_turn(&self, turn_id: &str) -> Option<TrackedHostScanTurn> {
        let mut tracked_turns = self.tracked_turns.lock().await;
        tracked_turns.remove(turn_id)
    }
}

// ── Process-wide singleton accessor (installation-only API) ──────────────────
static GLOBAL_HOST_AUTO_SCAN_SERVICE: std::sync::OnceLock<Arc<HostAutoScanService>> =
    std::sync::OnceLock::new();

pub fn install_global_host_auto_scan_service(service: Arc<HostAutoScanService>) -> Result<(), ()> {
    GLOBAL_HOST_AUTO_SCAN_SERVICE.set(service).map_err(|_| ())
}

pub fn get_global_host_auto_scan_service() -> Option<Arc<HostAutoScanService>> {
    GLOBAL_HOST_AUTO_SCAN_SERVICE.get().cloned()
}

fn trigger_label(trigger: &HostScanTrigger) -> &'static str {
    match trigger {
        HostScanTrigger::Manual => "manual",
        HostScanTrigger::Auto => "auto",
    }
}

fn prepare_attempt_tracking(
    state: &mut HostScanState,
    trigger: &HostScanTrigger,
    turn_id: &str,
    now_ms: i64,
) {
    state.last_attempt_started_at_ms = Some(now_ms);
    state.last_attempt_finished_at_ms = None;
    state.last_attempt_status = Some(HostScanAttemptStatus::Running);
    state.last_attempt_trigger = Some(trigger.clone());
    state.last_error = None;

    if matches!(trigger, HostScanTrigger::Auto) {
        state.active_auto_turn_id = Some(turn_id.to_string());
    }
}

fn finalize_attempt(
    state: &mut HostScanState,
    trigger: &HostScanTrigger,
    status: HostScanAttemptStatus,
    finished_at_ms: i64,
    error_message: Option<String>,
    turn_id: &str,
) {
    state.last_attempt_finished_at_ms = Some(finished_at_ms);
    state.last_attempt_status = Some(status.clone());
    state.last_attempt_trigger = Some(trigger.clone());
    state.last_error = error_message.filter(|value| !value.trim().is_empty());

    match status {
        HostScanAttemptStatus::Ok => {
            state.last_successful_scan_at_ms = Some(finished_at_ms);
            state.last_successful_scan_trigger = Some(trigger.clone());
            state.next_auto_scan_not_before_ms = None;
            state.auto_failed_attempts_today = 0;
            state.auto_failed_attempts_day_key = Some(local_day_key(finished_at_ms));
        }
        HostScanAttemptStatus::Error | HostScanAttemptStatus::Cancelled => {
            if matches!(trigger, HostScanTrigger::Auto) {
                increment_auto_failed_attempt_count(state, finished_at_ms);
                state.next_auto_scan_not_before_ms = Some(next_auto_retry_time_ms(
                    state.auto_failed_attempts_today,
                    finished_at_ms,
                ));
            }
        }
        HostScanAttemptStatus::Running => {}
    }

    if matches!(trigger, HostScanTrigger::Auto) {
        let should_clear_active = turn_id.is_empty()
            || state
                .active_auto_turn_id
                .as_deref()
                .map(|value| value == turn_id)
                .unwrap_or(true);
        if should_clear_active {
            state.active_auto_turn_id = None;
        }
    }
}

fn ensure_due_time(
    state: &mut HostScanState,
    overview: &HostOverviewStatus,
    config: &AppHostScanConfig,
    now_ms: i64,
) -> Option<i64> {
    reset_auto_failed_attempt_day_if_needed(state, now_ms);

    if has_pending_auto_retry(state) {
        return state.next_auto_scan_not_before_ms;
    }

    if !overview.exists || overview.is_empty {
        if state.next_auto_scan_not_before_ms.is_none() {
            state.next_auto_scan_not_before_ms = Some(now_ms + INITIAL_EMPTY_OVERVIEW_DELAY_MS);
        }
        return state.next_auto_scan_not_before_ms;
    }

    if state.next_auto_scan_not_before_ms.is_some() {
        state.next_auto_scan_not_before_ms = None;
    }

    let baseline = effective_freshness_baseline_ms(state, overview)?;
    let interval_ms = i64::from(config.auto_scan_interval_days) * 24 * 60 * 60 * 1_000;
    Some(baseline.saturating_add(interval_ms))
}

fn effective_freshness_baseline_ms(
    state: &HostScanState,
    overview: &HostOverviewStatus,
) -> Option<i64> {
    match (state.last_successful_scan_at_ms, overview.modified_at_ms) {
        (Some(scan_at), Some(modified_at)) => Some(scan_at.max(modified_at)),
        (Some(scan_at), None) => Some(scan_at),
        (None, Some(modified_at)) => Some(modified_at),
        (None, None) => None,
    }
}

fn increment_auto_failed_attempt_count(state: &mut HostScanState, now_ms: i64) {
    let day_key = local_day_key(now_ms);
    if state.auto_failed_attempts_day_key.as_deref() != Some(day_key.as_str()) {
        state.auto_failed_attempts_today = 0;
        state.auto_failed_attempts_day_key = Some(day_key);
    }
    state.auto_failed_attempts_today = state.auto_failed_attempts_today.saturating_add(1);
}

fn reset_auto_failed_attempt_day_if_needed(state: &mut HostScanState, now_ms: i64) {
    let day_key = local_day_key(now_ms);
    if state.auto_failed_attempts_day_key.as_deref() != Some(day_key.as_str()) {
        state.auto_failed_attempts_today = 0;
        state.auto_failed_attempts_day_key = Some(day_key);
        if let Some(not_before) = state.next_auto_scan_not_before_ms {
            if not_before <= now_ms {
                state.next_auto_scan_not_before_ms = None;
            }
        }
    }
}

fn has_pending_auto_retry(state: &HostScanState) -> bool {
    matches!(state.last_attempt_trigger, Some(HostScanTrigger::Auto))
        && matches!(
            state.last_attempt_status,
            Some(HostScanAttemptStatus::Error | HostScanAttemptStatus::Cancelled)
        )
        && state.next_auto_scan_not_before_ms.is_some()
}

fn next_auto_retry_time_ms(auto_failed_attempts_today: u32, now_ms: i64) -> i64 {
    if auto_failed_attempts_today >= MAX_AUTO_FAILED_ATTEMPTS_PER_DAY {
        next_local_day_start_ms(now_ms)
    } else {
        now_ms + AUTO_RETRY_DELAY_MS
    }
}

#[derive(Debug)]
struct FailedTurnOutcome {
    status: HostScanAttemptStatus,
    error_message: Option<String>,
}

fn resolve_failed_turn_outcome(
    tracked: &TrackedHostScanTurn,
    fallback_status: HostScanAttemptStatus,
    error_message: &str,
    overview_after: HostOverviewStatus,
) -> FailedTurnOutcome {
    if host_overview_was_updated_since(
        &tracked.overview_before,
        &overview_after,
        tracked.started_at_ms,
    ) {
        info!(
            "Treating host scan turn as successful because host overview was updated before the turn ended with an error"
        );
        return FailedTurnOutcome {
            status: HostScanAttemptStatus::Ok,
            error_message: None,
        };
    }

    FailedTurnOutcome {
        status: fallback_status,
        error_message: Some(error_message.to_string()),
    }
}

fn log_host_scan_terminal_outcome(
    terminal_kind: &str,
    turn_id: &str,
    tracked: &TrackedHostScanTurn,
    final_status: &HostScanAttemptStatus,
    error_message: Option<&str>,
    finished_at_ms: i64,
    overview_after: &HostOverviewStatus,
    state: &HostScanState,
) {
    match final_status {
        HostScanAttemptStatus::Ok => {
            info!(
                "Host scan turn resolved successfully: terminal_kind={}, turn_id={}, trigger={:?}, started_at_ms={}, finished_at_ms={}, overview_after_exists={}, overview_after_empty={}, overview_after_modified_at_ms={:?}, next_auto_scan_not_before_ms={:?}",
                terminal_kind,
                turn_id,
                tracked.trigger,
                tracked.started_at_ms,
                finished_at_ms,
                overview_after.exists,
                overview_after.is_empty,
                overview_after.modified_at_ms,
                state.next_auto_scan_not_before_ms
            );
        }
        HostScanAttemptStatus::Error | HostScanAttemptStatus::Cancelled => {
            warn!(
                "Host scan turn resolved with retryable failure: terminal_kind={}, turn_id={}, trigger={:?}, final_status={:?}, started_at_ms={}, finished_at_ms={}, overview_after_exists={}, overview_after_empty={}, overview_after_modified_at_ms={:?}, next_auto_scan_not_before_ms={:?}, auto_failed_attempts_today={}, error={}",
                terminal_kind,
                turn_id,
                tracked.trigger,
                final_status,
                tracked.started_at_ms,
                finished_at_ms,
                overview_after.exists,
                overview_after.is_empty,
                overview_after.modified_at_ms,
                state.next_auto_scan_not_before_ms,
                state.auto_failed_attempts_today,
                error_message.unwrap_or("")
            );
        }
        HostScanAttemptStatus::Running => {}
    }
}

fn host_overview_was_updated_since(
    overview_before: &HostOverviewStatus,
    overview_after: &HostOverviewStatus,
    started_at_ms: i64,
) -> bool {
    if !overview_after.exists || overview_after.is_empty {
        return false;
    }

    if !overview_before.exists || overview_before.is_empty {
        return true;
    }

    match (
        overview_before.modified_at_ms,
        overview_after.modified_at_ms,
    ) {
        (Some(before_ms), Some(after_ms)) => after_ms > before_ms,
        (None, Some(after_ms)) => after_ms >= started_at_ms,
        _ => false,
    }
}

fn host_overview_was_updated_after_start(
    overview_after: &HostOverviewStatus,
    started_at_ms: i64,
) -> bool {
    if !overview_after.exists || overview_after.is_empty {
        return false;
    }

    overview_after
        .modified_at_ms
        .map(|modified_at_ms| modified_at_ms >= started_at_ms)
        .unwrap_or(false)
}

fn local_day_key(timestamp_ms: i64) -> String {
    local_datetime(timestamp_ms).format("%Y-%m-%d").to_string()
}

fn next_local_day_start_ms(timestamp_ms: i64) -> i64 {
    let date = local_datetime(timestamp_ms).date_naive();
    let next_day = date.succ_opt().unwrap_or_else(|| Local::now().date_naive());
    let naive = next_day.and_hms_opt(0, 0, 0).unwrap_or_else(|| {
        Local::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .expect("midnight must be valid")
    });

    Local
        .from_local_datetime(&naive)
        .earliest()
        .or_else(|| Local.from_local_datetime(&naive).latest())
        .unwrap_or_else(Local::now)
        .timestamp_millis()
}

fn local_datetime(timestamp_ms: i64) -> chrono::DateTime<Local> {
    Local
        .timestamp_millis_opt(timestamp_ms)
        .earliest()
        .or_else(|| Local.timestamp_millis_opt(timestamp_ms).latest())
        .unwrap_or_else(Local::now)
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

async fn load_host_scan_config() -> AppHostScanConfig {
    let Ok(config_service) = get_global_config_service().await else {
        return AppHostScanConfig::default();
    };

    config_service
        .get_config::<AppHostScanConfig>(Some("app.host_scan"))
        .await
        .unwrap_or_default()
}

fn duration_until_ms(now_ms: i64, target_ms: i64) -> Duration {
    if target_ms <= now_ms {
        return Duration::from_secs(0);
    }

    let delta_ms = u64::try_from(target_ms.saturating_sub(now_ms)).unwrap_or(u64::MAX);
    Duration::from_millis(delta_ms)
}
