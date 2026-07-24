use super::prompt::{
    build_global_milestone_user_prompt, default_global_milestone_session_name,
    global_milestone_allowed_tools,
};
use super::state::{
    ensure_global_milestone_runtime_dir, load_global_milestone_state, save_global_milestone_state,
    GlobalMilestoneAttemptStatus, GlobalMilestoneState, GlobalMilestoneTrigger,
};
use crate::agentic::coordination::ConversationCoordinator;
use crate::agentic::memory::store::MEMORY_MILESTONES_FILE;
use crate::agentic::tools::{ToolPathPolicy, ToolRuntimeRestrictions};
use crate::error::CoreResult;
use crate::infrastructure::get_path_manager_arc;
use crate::service::config::{is_primary_ai_model_configured, PRIMARY_AI_MODEL_REQUIRED_REASON};
use chrono::{Datelike, Duration as ChronoDuration, Local, LocalResult, TimeZone};
use log::{info, warn};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::fs;
use tokio::sync::{Mutex, Notify};
use tokio::time::Duration;
use uuid::Uuid;

const AUTO_RUN_INTERVAL_DAYS: i64 = 7;
const AUTO_WAKE_HOUR_LOCAL: u32 = 0;
const AUTO_WAKE_MINUTE_LOCAL: u32 = 10;
const STARTUP_CATCH_UP_DELAY_SECS: u64 = 20;
const STALE_RUNNING_ATTEMPT_AFTER_MS: i64 = 2 * 60 * 60 * 1000;

static GLOBAL_GLOBAL_MILESTONE_SERVICE: OnceLock<Arc<GlobalMilestoneService>> = OnceLock::new();

#[derive(Debug, Clone)]
struct PendingMilestoneRun {
    source_start_date: String,
    source_end_date: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalMilestoneRunSummary {
    pub started: bool,
    pub trigger: String,
    pub source_start_date: Option<String>,
    pub source_end_date: Option<String>,
    pub turn_id: Option<String>,
    pub reason: Option<String>,
}

pub struct GlobalMilestoneService {
    coordinator: Arc<ConversationCoordinator>,
    state: Mutex<GlobalMilestoneState>,
    wake_notify: Notify,
    started: AtomicBool,
}

impl GlobalMilestoneService {
    pub async fn new(coordinator: Arc<ConversationCoordinator>) -> CoreResult<Arc<Self>> {
        let mut state = load_global_milestone_state().await?;
        if matches!(
            state.last_attempt_status,
            Some(GlobalMilestoneAttemptStatus::Running)
        ) {
            warn!(
                "Recovering interrupted global milestone run on startup: active_source_start_date={:?}, active_source_end_date={:?}, active_turn_id={:?}",
                state.active_source_start_date, state.active_source_end_date, state.active_turn_id
            );
            mark_global_milestone_run_interrupted(
                &mut state,
                "Previous global milestone run was interrupted before completion",
            );
            save_global_milestone_state(&state).await?;
        }
        Ok(Arc::new(Self {
            coordinator,
            state: Mutex::new(state),
            wake_notify: Notify::new(),
            started: AtomicBool::new(false),
        }))
    }

    pub fn start(self: &Arc<Self>) {
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }

        info!(
            "Global milestone service started: auto_run_interval_days={}, auto_wake_hour_local={}, auto_wake_minute_local={}",
            AUTO_RUN_INTERVAL_DAYS, AUTO_WAKE_HOUR_LOCAL, AUTO_WAKE_MINUTE_LOCAL
        );

        let catch_up_service = Arc::clone(self);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(STARTUP_CATCH_UP_DELAY_SECS)).await;
            if let Err(error) = catch_up_service.run_auto_if_due().await {
                warn!("Global milestone startup catch-up failed: {}", error);
            }
        });

        let service = Arc::clone(self);
        tokio::spawn(async move {
            service.run_loop().await;
        });
    }

    pub async fn run_now(&self) -> CoreResult<GlobalMilestoneRunSummary> {
        self.run_once(GlobalMilestoneTrigger::Manual, true).await
    }

    pub async fn handle_turn_completed(&self, turn_id: &str) -> CoreResult<()> {
        let mut state = self.state.lock().await;
        if state.active_turn_id.as_deref() != Some(turn_id) {
            return Ok(());
        }

        let finished_at_ms = now_ms();
        state.last_attempt_finished_at_ms = Some(finished_at_ms);
        state.last_attempt_status = Some(GlobalMilestoneAttemptStatus::Ok);
        state.last_error = None;
        state.last_successful_run_at_ms = Some(finished_at_ms);
        state.last_completed_source_end_date = state.active_source_end_date.clone();
        state.active_turn_id = None;
        state.active_source_start_date = None;
        state.active_source_end_date = None;
        state.next_auto_run_not_before_ms =
            Some(finished_at_ms.saturating_add(AUTO_RUN_INTERVAL_DAYS * 24 * 60 * 60 * 1_000));
        save_global_milestone_state(&state).await?;
        self.wake_notify.notify_one();
        Ok(())
    }

    pub async fn handle_turn_failed(&self, turn_id: &str, error_message: &str) -> CoreResult<()> {
        let mut state = self.state.lock().await;
        if state.active_turn_id.as_deref() != Some(turn_id) {
            return Ok(());
        }

        state.last_attempt_finished_at_ms = Some(now_ms());
        state.last_attempt_status = Some(GlobalMilestoneAttemptStatus::Error);
        state.last_error = Some(error_message.trim().to_string());
        state.active_turn_id = None;
        state.active_source_start_date = None;
        state.active_source_end_date = None;
        save_global_milestone_state(&state).await?;
        self.wake_notify.notify_one();
        Ok(())
    }

    pub async fn handle_turn_cancelled(&self, turn_id: &str) -> CoreResult<()> {
        let mut state = self.state.lock().await;
        if state.active_turn_id.as_deref() != Some(turn_id) {
            return Ok(());
        }

        state.last_attempt_finished_at_ms = Some(now_ms());
        state.last_attempt_status = Some(GlobalMilestoneAttemptStatus::Cancelled);
        state.last_error = Some("Global milestone turn was cancelled".to_string());
        state.active_turn_id = None;
        state.active_source_start_date = None;
        state.active_source_end_date = None;
        save_global_milestone_state(&state).await?;
        self.wake_notify.notify_one();
        Ok(())
    }

    async fn run_loop(self: Arc<Self>) {
        loop {
            let next_delay = next_auto_wake_duration();
            tokio::select! {
                _ = tokio::time::sleep(next_delay) => {}
                _ = self.wake_notify.notified() => {}
            }

            if let Err(error) = self.run_auto_if_due().await {
                warn!("Global milestone scheduled run failed: {}", error);
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
        }
    }

    async fn run_auto_if_due(&self) -> CoreResult<()> {
        let should_run = {
            let mut state = self.state.lock().await;
            if matches!(
                state.last_attempt_status,
                Some(GlobalMilestoneAttemptStatus::Running)
            ) || state.active_turn_id.is_some()
            {
                if is_stale_global_milestone_run(&state) {
                    warn!(
                        "Clearing stale global milestone run before auto generation: active_source_start_date={:?}, active_source_end_date={:?}, active_turn_id={:?}",
                        state.active_source_start_date, state.active_source_end_date, state.active_turn_id
                    );
                    mark_global_milestone_run_interrupted(
                        &mut state,
                        "Previous global milestone run expired before completion",
                    );
                    save_global_milestone_state(&state).await?;
                } else {
                    info!(
                        "Global milestone auto run skipped because a milestone turn is already active"
                    );
                    return Ok(());
                }
            }

            state
                .next_auto_run_not_before_ms
                .map(|value| value <= now_ms())
                .unwrap_or(true)
        };

        if should_run {
            let _ = self.run_once(GlobalMilestoneTrigger::Auto, false).await?;
        }

        Ok(())
    }

    async fn run_once(
        &self,
        trigger: GlobalMilestoneTrigger,
        ignore_schedule: bool,
    ) -> CoreResult<GlobalMilestoneRunSummary> {
        {
            let mut state = self.state.lock().await;
            if matches!(
                state.last_attempt_status,
                Some(GlobalMilestoneAttemptStatus::Running)
            ) || state.active_turn_id.is_some()
            {
                if is_stale_global_milestone_run(&state) {
                    warn!(
                        "Clearing stale global milestone run before manual generation: active_source_start_date={:?}, active_source_end_date={:?}, active_turn_id={:?}",
                        state.active_source_start_date, state.active_source_end_date, state.active_turn_id
                    );
                    mark_global_milestone_run_interrupted(
                        &mut state,
                        "Previous global milestone run expired before completion",
                    );
                    save_global_milestone_state(&state).await?;
                } else {
                    return Ok(GlobalMilestoneRunSummary {
                        started: false,
                        trigger: trigger_label(&trigger).to_string(),
                        source_start_date: None,
                        source_end_date: None,
                        turn_id: None,
                        reason: Some("A milestone run is already active".to_string()),
                    });
                }
            }
        }

        if matches!(trigger, GlobalMilestoneTrigger::Auto) && !ignore_schedule {
            let state = self.state.lock().await;
            if state
                .next_auto_run_not_before_ms
                .is_some_and(|value| value > now_ms())
            {
                return Ok(GlobalMilestoneRunSummary {
                    started: false,
                    trigger: trigger_label(&trigger).to_string(),
                    source_start_date: None,
                    source_end_date: None,
                    turn_id: None,
                    reason: Some("Auto run is not due yet".to_string()),
                });
            }
        }

        if !is_primary_ai_model_configured().await {
            return Ok(GlobalMilestoneRunSummary {
                started: false,
                trigger: trigger_label(&trigger).to_string(),
                source_start_date: None,
                source_end_date: None,
                turn_id: None,
                reason: Some(PRIMARY_AI_MODEL_REQUIRED_REASON.to_string()),
            });
        }

        let pending = match self.next_pending_run().await? {
            Some(value) => value,
            None => {
                let mut state = self.state.lock().await;
                let current_ms = now_ms();
                state.last_attempt_started_at_ms = Some(current_ms);
                state.last_attempt_finished_at_ms = Some(current_ms);
                state.last_attempt_status = Some(GlobalMilestoneAttemptStatus::SkippedNoSources);
                state.last_attempt_trigger = Some(trigger.clone());
                state.last_error = None;
                if matches!(trigger, GlobalMilestoneTrigger::Auto) {
                    state.next_auto_run_not_before_ms = Some(
                        current_ms.saturating_add(AUTO_RUN_INTERVAL_DAYS * 24 * 60 * 60 * 1_000),
                    );
                }
                save_global_milestone_state(&state).await?;
                return Ok(GlobalMilestoneRunSummary {
                    started: false,
                    trigger: trigger_label(&trigger).to_string(),
                    source_start_date: None,
                    source_end_date: None,
                    turn_id: None,
                    reason: Some("No new daily reports are available".to_string()),
                });
            }
        };

        let source_paths = collect_global_daily_report_sources(
            &pending.source_start_date,
            &pending.source_end_date,
        )
        .await?;
        if source_paths.is_empty() {
            let mut state = self.state.lock().await;
            let current_ms = now_ms();
            state.last_attempt_started_at_ms = Some(current_ms);
            state.last_attempt_finished_at_ms = Some(current_ms);
            state.last_attempt_status = Some(GlobalMilestoneAttemptStatus::SkippedNoSources);
            state.last_attempt_trigger = Some(trigger.clone());
            state.last_error = None;
            save_global_milestone_state(&state).await?;
            return Ok(GlobalMilestoneRunSummary {
                started: false,
                trigger: trigger_label(&trigger).to_string(),
                source_start_date: Some(pending.source_start_date),
                source_end_date: Some(pending.source_end_date),
                turn_id: None,
                reason: Some("No daily report files matched the pending date range".to_string()),
            });
        }

        ensure_global_milestone_runtime_dir().await?;
        let output_path = milestone_output_path();
        let request_id = format!("global-milestone-{}", Uuid::new_v4());
        let prompt = build_global_milestone_user_prompt(&output_path, &source_paths);
        let runtime_tool_restrictions = ToolRuntimeRestrictions {
            allowed_tool_names: global_milestone_allowed_tools().into_iter().collect(),
            denied_tool_names: Default::default(),
            path_policy: ToolPathPolicy {
                write_roots: vec![output_path.to_string_lossy().to_string()],
                edit_roots: vec![output_path.to_string_lossy().to_string()],
                delete_roots: Vec::new(),
                ..ToolPathPolicy::default()
            },
            disable_snapshot_tracking: true,
        };

        let turn_id = self
            .coordinator
            .start_background_global_milestone_turn(
                &request_id,
                default_global_milestone_session_name(),
                prompt,
                runtime_tool_restrictions,
                Some(trigger_label(&trigger)),
                None,
            )
            .await?;

        info!(
            "Started global milestone run: trigger={}, source_start_date={}, source_end_date={}, turn_id={}, source_count={}, output_path={}",
            trigger_label(&trigger),
            pending.source_start_date,
            pending.source_end_date,
            turn_id,
            source_paths.len(),
            output_path.display()
        );

        let mut state = self.state.lock().await;
        state.last_attempt_started_at_ms = Some(now_ms());
        state.last_attempt_finished_at_ms = None;
        state.last_attempt_status = Some(GlobalMilestoneAttemptStatus::Running);
        state.last_attempt_trigger = Some(trigger.clone());
        state.last_error = None;
        state.active_turn_id = Some(turn_id.clone());
        state.active_source_start_date = Some(pending.source_start_date.clone());
        state.active_source_end_date = Some(pending.source_end_date.clone());
        save_global_milestone_state(&state).await?;

        Ok(GlobalMilestoneRunSummary {
            started: true,
            trigger: trigger_label(&trigger).to_string(),
            source_start_date: Some(pending.source_start_date),
            source_end_date: Some(pending.source_end_date),
            turn_id: Some(turn_id),
            reason: None,
        })
    }

    async fn next_pending_run(&self) -> CoreResult<Option<PendingMilestoneRun>> {
        let latest_available_date = latest_available_daily_report_date().await?;
        let Some(source_end_date) = latest_available_date else {
            return Ok(None);
        };

        let state = self.state.lock().await;
        let source_start_date = match state.last_completed_source_end_date.as_deref() {
            Some(last_completed) => next_date_key(last_completed),
            None => earliest_available_daily_report_date()
                .await?
                .unwrap_or_else(|| source_end_date.clone()),
        };

        if source_start_date > source_end_date {
            Ok(None)
        } else {
            Ok(Some(PendingMilestoneRun {
                source_start_date,
                source_end_date,
            }))
        }
    }
}

pub fn install_global_global_milestone_service(
    service: Arc<GlobalMilestoneService>,
) -> Result<(), ()> {
    GLOBAL_GLOBAL_MILESTONE_SERVICE.set(service).map_err(|_| ())
}

pub fn get_global_global_milestone_service() -> Option<Arc<GlobalMilestoneService>> {
    GLOBAL_GLOBAL_MILESTONE_SERVICE.get().cloned()
}

fn trigger_label(trigger: &GlobalMilestoneTrigger) -> &'static str {
    match trigger {
        GlobalMilestoneTrigger::Auto => "auto",
        GlobalMilestoneTrigger::Manual => "manual",
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn local_datetime(
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
) -> chrono::DateTime<Local> {
    match Local.with_ymd_and_hms(year, month, day, hour, minute, second) {
        LocalResult::Single(dt) => dt,
        LocalResult::Ambiguous(dt, _) => dt,
        LocalResult::None => Local::now(),
    }
}

fn next_auto_wake_duration() -> Duration {
    let now = Local::now();
    let today_wake = local_datetime(
        now.year(),
        now.month(),
        now.day(),
        AUTO_WAKE_HOUR_LOCAL,
        AUTO_WAKE_MINUTE_LOCAL,
        0,
    );
    let next_wake = if now < today_wake {
        today_wake
    } else {
        let tomorrow = now.date_naive() + ChronoDuration::days(1);
        local_datetime(
            tomorrow.year(),
            tomorrow.month(),
            tomorrow.day(),
            AUTO_WAKE_HOUR_LOCAL,
            AUTO_WAKE_MINUTE_LOCAL,
            0,
        )
    };

    let millis = (next_wake - now).num_milliseconds().max(0) as u64;
    Duration::from_millis(millis)
}

fn milestone_output_path() -> PathBuf {
    get_path_manager_arc()
        .agentic_os_memory_dir()
        .join(MEMORY_MILESTONES_FILE)
}

fn next_date_key(date_key: &str) -> String {
    chrono::NaiveDate::parse_from_str(date_key, "%Y-%m-%d")
        .map(|date| {
            (date + ChronoDuration::days(1))
                .format("%Y-%m-%d")
                .to_string()
        })
        .unwrap_or_else(|_| date_key.to_string())
}

fn is_stale_global_milestone_run(state: &GlobalMilestoneState) -> bool {
    state
        .last_attempt_started_at_ms
        .map(|started_at_ms| {
            now_ms().saturating_sub(started_at_ms) > STALE_RUNNING_ATTEMPT_AFTER_MS
        })
        .unwrap_or(true)
}

fn mark_global_milestone_run_interrupted(state: &mut GlobalMilestoneState, reason: &str) {
    state.last_attempt_finished_at_ms = Some(now_ms());
    state.last_attempt_status = Some(GlobalMilestoneAttemptStatus::Cancelled);
    state.last_error = Some(reason.to_string());
    state.active_turn_id = None;
    state.active_source_start_date = None;
    state.active_source_end_date = None;
}

async fn earliest_available_daily_report_date() -> CoreResult<Option<String>> {
    let mut dates = collect_all_global_daily_report_dates().await?;
    dates.sort();
    dates.dedup();
    Ok(dates.into_iter().next())
}

async fn latest_available_daily_report_date() -> CoreResult<Option<String>> {
    let mut dates = collect_all_global_daily_report_dates().await?;
    dates.sort();
    dates.dedup();
    Ok(dates.into_iter().last())
}

async fn collect_all_global_daily_report_dates() -> CoreResult<Vec<String>> {
    let mut dates = Vec::new();
    for path in collect_all_global_daily_report_files().await? {
        if let Some(date) = daily_report_date_from_path(&path) {
            dates.push(date);
        }
    }
    Ok(dates)
}

async fn collect_global_daily_report_sources(
    source_start_date: &str,
    source_end_date: &str,
) -> CoreResult<Vec<PathBuf>> {
    let start = chrono::NaiveDate::parse_from_str(source_start_date, "%Y-%m-%d").ok();
    let end = chrono::NaiveDate::parse_from_str(source_end_date, "%Y-%m-%d").ok();

    let mut result = Vec::new();
    for path in collect_all_global_daily_report_files().await? {
        let Some(date_key) = daily_report_date_from_path(&path) else {
            continue;
        };
        let Some(date) = chrono::NaiveDate::parse_from_str(&date_key, "%Y-%m-%d").ok() else {
            continue;
        };
        if start.is_some_and(|start| date < start) || end.is_some_and(|end| date > end) {
            continue;
        }
        result.push(path);
    }

    result.sort();
    result.dedup();
    Ok(result)
}

async fn collect_all_global_daily_report_files() -> CoreResult<Vec<PathBuf>> {
    ensure_global_milestone_runtime_dir().await?;
    let reports_dir =
        crate::service::global_daily_report::state::global_daily_report_runtime_dir()?;
    collect_daily_report_files_under(&reports_dir).await
}

async fn collect_daily_report_files_under(root: &Path) -> CoreResult<Vec<PathBuf>> {
    let mut result = Vec::new();
    if !root.exists() {
        return Ok(result);
    }

    let mut pending_dirs = vec![root.to_path_buf()];
    while let Some(dir) = pending_dirs.pop() {
        let mut entries = fs::read_dir(&dir).await.map_err(|error| {
            crate::error::CoreError::service(format!(
                "Failed to read global daily reports directory {}: {}",
                dir.display(),
                error
            ))
        })?;

        while let Some(entry) = entries.next_entry().await.map_err(|error| {
            crate::error::CoreError::service(format!(
                "Failed to iterate global daily reports directory {}: {}",
                dir.display(),
                error
            ))
        })? {
            let file_type = entry.file_type().await.map_err(|error| {
                crate::error::CoreError::service(format!(
                    "Failed to inspect global daily report entry {}: {}",
                    entry.path().display(),
                    error
                ))
            })?;
            if file_type.is_dir() {
                pending_dirs.push(entry.path());
                continue;
            }
            if file_type.is_file()
                && entry
                    .path()
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case("md"))
            {
                result.push(entry.path());
            }
        }
    }

    Ok(result)
}

fn daily_report_date_from_path(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|value| value.to_str())
        .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        .filter(|date| *date <= Local::now().date_naive())
        .map(|date| date.format("%Y-%m-%d").to_string())
}

#[cfg(test)]
mod tests {
    use super::{daily_report_date_from_path, next_date_key};
    use std::path::Path;

    #[test]
    fn advances_date_key_by_one_day() {
        assert_eq!(next_date_key("2026-05-17"), "2026-05-18");
    }

    #[test]
    fn extracts_date_key_from_daily_report_path() {
        let path = Path::new("C:/tmp/daily_reports/2026/2026-05-17.md");
        assert_eq!(
            daily_report_date_from_path(path),
            Some("2026-05-17".to_string())
        );
    }

    #[test]
    fn ignores_future_daily_report_path() {
        let path = Path::new("C:/tmp/daily_reports/9999/9999-01-01.md");
        assert_eq!(daily_report_date_from_path(path), None);
    }
}
