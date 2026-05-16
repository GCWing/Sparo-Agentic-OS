use super::overview::{
    read_workspace_overview_directory_status, workspace_overview_dir_path,
    WorkspaceOverviewDirectoryStatus,
};
use super::prompt::{
    build_workspace_overview_refresh_system_reminder,
    build_workspace_overview_refresh_user_prompt,
    default_workspace_overview_refresh_session_name, workspace_overview_refresh_allowed_tools,
    WORKSPACE_OVERVIEW_REFRESH_MAX_ITEMS_PER_RUN,
};
use super::state::{
    load_workspace_overview_refresh_state, save_workspace_overview_refresh_state,
    WorkspaceOverviewRefreshAttemptStatus, WorkspaceOverviewRefreshState,
    WorkspaceOverviewRefreshTrigger,
};
use crate::agentic::coordination::ConversationCoordinator;
use crate::agentic::memory::routing::build_global_workspace_overviews_context;
use crate::agentic::tools::{ToolPathPolicy, ToolRuntimeRestrictions};
use crate::service::workspace::{get_global_workspace_service, WorkspaceInfo, WorkspaceKind};
use crate::util::errors::BitFunResult;
use chrono::{Local, TimeZone};
use log::{error, info, warn};
use sha2::Digest;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::sync::{Mutex, Notify};
use tokio::time::Duration;
use uuid::Uuid;

const AUTO_REFRESH_INTERVAL_DAYS: i64 = 1;
const INITIAL_EMPTY_OVERVIEW_DELAY_MS: i64 = 10 * 60 * 1_000;
// const INITIAL_EMPTY_OVERVIEW_DELAY_MS: i64 = 30 * 1_000; // bebug purpose
const AUTO_RETRY_DELAY_MS: i64 = 30 * 60 * 1_000;
const MAX_AUTO_FAILED_ATTEMPTS_PER_DAY: u32 = 3;
static GLOBAL_WORKSPACE_OVERVIEW_AUTO_REFRESH_SERVICE: OnceLock<
    Arc<WorkspaceOverviewAutoRefreshService>,
> = OnceLock::new();

#[derive(Debug, Clone)]
struct TrackedWorkspaceOverviewTurn {
    trigger: WorkspaceOverviewRefreshTrigger,
    started_at_ms: i64,
    status_before: WorkspaceOverviewDirectoryStatus,
}

pub struct WorkspaceOverviewAutoRefreshService {
    coordinator: Arc<ConversationCoordinator>,
    state: Mutex<WorkspaceOverviewRefreshState>,
    tracked_turns: Mutex<HashMap<String, TrackedWorkspaceOverviewTurn>>,
    wake_notify: Notify,
    started: AtomicBool,
}

impl WorkspaceOverviewAutoRefreshService {
    pub async fn new(coordinator: Arc<ConversationCoordinator>) -> BitFunResult<Arc<Self>> {
        let state = load_workspace_overview_refresh_state().await?;
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
            "Workspace overview auto refresh service started: interval_days={}, initial_empty_delay_ms={}, retry_delay_ms={}, max_failed_attempts_per_day={}, max_items_per_run={}",
            AUTO_REFRESH_INTERVAL_DAYS,
            INITIAL_EMPTY_OVERVIEW_DELAY_MS,
            AUTO_RETRY_DELAY_MS,
            MAX_AUTO_FAILED_ATTEMPTS_PER_DAY,
            WORKSPACE_OVERVIEW_REFRESH_MAX_ITEMS_PER_RUN
        );

        let service = Arc::clone(self);
        tokio::spawn(async move {
            service.run_loop().await;
        });
    }

    pub async fn handle_turn_completed(&self, turn_id: &str) -> BitFunResult<()> {
        if let Some(tracked) = self.take_tracked_turn(turn_id).await {
            let finished_at_ms = now_ms();
            let mut state = self.state.lock().await;
            finalize_attempt(
                &mut state,
                &tracked.trigger,
                WorkspaceOverviewRefreshAttemptStatus::Ok,
                finished_at_ms,
                None,
                turn_id,
            );
            save_workspace_overview_refresh_state(&state).await?;
            self.wake_notify.notify_one();
        }

        Ok(())
    }

    pub async fn handle_turn_failed(&self, turn_id: &str, error_message: &str) -> BitFunResult<()> {
        if let Some(tracked) = self.take_tracked_turn(turn_id).await {
            let status_after = read_workspace_overview_directory_status().await.unwrap_or_default();
            let outcome = resolve_failed_turn_outcome(
                &tracked,
                WorkspaceOverviewRefreshAttemptStatus::Error,
                error_message.trim(),
                status_after,
            );
            let finished_at_ms = now_ms();
            let mut state = self.state.lock().await;
            finalize_attempt(
                &mut state,
                &tracked.trigger,
                outcome.status,
                finished_at_ms,
                outcome.error_message,
                turn_id,
            );
            save_workspace_overview_refresh_state(&state).await?;
            self.wake_notify.notify_one();
        }

        Ok(())
    }

    pub async fn handle_turn_cancelled(&self, turn_id: &str) -> BitFunResult<()> {
        if let Some(tracked) = self.take_tracked_turn(turn_id).await {
            let status_after = read_workspace_overview_directory_status().await.unwrap_or_default();
            let outcome = resolve_failed_turn_outcome(
                &tracked,
                WorkspaceOverviewRefreshAttemptStatus::Cancelled,
                "Workspace overview refresh turn was cancelled",
                status_after,
            );
            let finished_at_ms = now_ms();
            let mut state = self.state.lock().await;
            finalize_attempt(
                &mut state,
                &tracked.trigger,
                outcome.status,
                finished_at_ms,
                outcome.error_message,
                turn_id,
            );
            save_workspace_overview_refresh_state(&state).await?;
            self.wake_notify.notify_one();
        }

        Ok(())
    }

    async fn run_loop(self: Arc<Self>) {
        if let Err(error) = self.reconcile_startup_state().await {
            error!(
                "Failed to reconcile workspace overview refresh state on startup: {}",
                error
            );
        }

        loop {
            match self.reconcile_and_maybe_start_auto_refresh().await {
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
                    error!(
                        "Workspace overview auto refresh scheduling iteration failed: {}",
                        error
                    );
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_secs(60)) => {}
                        _ = self.wake_notify.notified() => {}
                    }
                }
            }
        }
    }

    async fn reconcile_startup_state(&self) -> BitFunResult<()> {
        let mut state = self.state.lock().await;
        if let Some(active_turn_id) = state.active_auto_turn_id.clone() {
            let status_after = read_workspace_overview_directory_status().await.unwrap_or_default();
            let did_update = state
                .last_attempt_started_at_ms
                .map(|started_at_ms| {
                    workspace_overview_was_updated_after_start(&status_after, started_at_ms)
                })
                .unwrap_or(false);
            let recovered_status = if did_update {
                WorkspaceOverviewRefreshAttemptStatus::Ok
            } else {
                WorkspaceOverviewRefreshAttemptStatus::Error
            };
            finalize_attempt(
                &mut state,
                &WorkspaceOverviewRefreshTrigger::Auto,
                recovered_status,
                now_ms(),
                if did_update {
                    None
                } else {
                    Some(format!(
                        "Previous background workspace overview refresh was interrupted before completion: {}",
                        active_turn_id
                    ))
                },
                &active_turn_id,
            );
            save_workspace_overview_refresh_state(&state).await?;
        }
        Ok(())
    }

    async fn reconcile_and_maybe_start_auto_refresh(&self) -> BitFunResult<Option<Duration>> {
        if !self.tracked_turns.lock().await.is_empty() {
            return Ok(None);
        }

        {
            let state = self.state.lock().await;
            if state.active_auto_turn_id.is_some() {
                return Ok(None);
            }
        }

        let Some(targets) = collect_refresh_targets().await? else {
            return Ok(None);
        };

        let now = now_ms();
        let directory_status = read_workspace_overview_directory_status().await?;
        let due_at = {
            let mut state = self.state.lock().await;
            let due_at = ensure_due_time(&mut state, &directory_status, now);
            save_workspace_overview_refresh_state(&state).await?;
            due_at
        };

        let Some(due_at) = due_at else {
            return Ok(None);
        };
        if now < due_at {
            return Ok(Some(duration_until_ms(now, due_at)));
        }

        let request_id = format!("auto-workspace-overview-refresh-{}", Uuid::new_v4());
        let prompt = build_workspace_overview_refresh_user_prompt(&targets);
        let system_reminder =
            build_workspace_overview_refresh_system_reminder(&workspace_overview_dir_path());
        let runtime_tool_restrictions = build_runtime_restrictions(&targets);

        match self
            .coordinator
            .start_background_workspace_overview_refresh_turn(
                &request_id,
                default_workspace_overview_refresh_session_name(),
                prompt,
                system_reminder,
                runtime_tool_restrictions,
                None,
            )
            .await
        {
            Ok(turn_id) => {
                self.register_turn(&turn_id, WorkspaceOverviewRefreshTrigger::Auto)
                    .await?;
                info!(
                    "Started automatic workspace overview refresh: request_id={}, turn_id={}, target_count={}",
                    request_id,
                    turn_id,
                    targets.len()
                );
            }
            Err(error) => {
                warn!(
                    "Failed to start automatic workspace overview refresh: request_id={}, error={}",
                    request_id, error
                );
                self.record_auto_launch_failure(error.to_string()).await?;
            }
        }

        Ok(None)
    }

    async fn register_turn(
        &self,
        turn_id: &str,
        trigger: WorkspaceOverviewRefreshTrigger,
    ) -> BitFunResult<()> {
        let turn_id = turn_id.trim();
        if turn_id.is_empty() {
            return Ok(());
        }

        let started_at_ms = now_ms();
        let status_before = read_workspace_overview_directory_status().await.unwrap_or_default();

        {
            let mut tracked_turns = self.tracked_turns.lock().await;
            tracked_turns.insert(
                turn_id.to_string(),
                TrackedWorkspaceOverviewTurn {
                    trigger: trigger.clone(),
                    started_at_ms,
                    status_before,
                },
            );
        }

        let mut state = self.state.lock().await;
        prepare_attempt_tracking(&mut state, &trigger, turn_id, started_at_ms);
        save_workspace_overview_refresh_state(&state).await?;
        self.wake_notify.notify_one();
        Ok(())
    }

    async fn record_auto_launch_failure(&self, error_message: String) -> BitFunResult<()> {
        let mut state = self.state.lock().await;
        let now = now_ms();
        state.last_attempt_started_at_ms = Some(now);
        finalize_attempt(
            &mut state,
            &WorkspaceOverviewRefreshTrigger::Auto,
            WorkspaceOverviewRefreshAttemptStatus::Error,
            now,
            Some(error_message),
            "",
        );
        save_workspace_overview_refresh_state(&state).await?;
        Ok(())
    }

    async fn take_tracked_turn(&self, turn_id: &str) -> Option<TrackedWorkspaceOverviewTurn> {
        let mut tracked_turns = self.tracked_turns.lock().await;
        tracked_turns.remove(turn_id)
    }
}

pub fn get_global_workspace_overview_auto_refresh_service(
) -> Option<Arc<WorkspaceOverviewAutoRefreshService>> {
    GLOBAL_WORKSPACE_OVERVIEW_AUTO_REFRESH_SERVICE.get().cloned()
}

pub fn set_global_workspace_overview_auto_refresh_service(
    service: Arc<WorkspaceOverviewAutoRefreshService>,
) {
    let _ = GLOBAL_WORKSPACE_OVERVIEW_AUTO_REFRESH_SERVICE.set(service);
}

#[derive(Debug)]
struct FailedTurnOutcome {
    status: WorkspaceOverviewRefreshAttemptStatus,
    error_message: Option<String>,
}

fn prepare_attempt_tracking(
    state: &mut WorkspaceOverviewRefreshState,
    trigger: &WorkspaceOverviewRefreshTrigger,
    turn_id: &str,
    now_ms: i64,
) {
    state.last_attempt_started_at_ms = Some(now_ms);
    state.last_attempt_finished_at_ms = None;
    state.last_attempt_status = Some(WorkspaceOverviewRefreshAttemptStatus::Running);
    state.last_attempt_trigger = Some(trigger.clone());
    state.last_error = None;
    state.active_auto_turn_id = Some(turn_id.to_string());
}

fn finalize_attempt(
    state: &mut WorkspaceOverviewRefreshState,
    trigger: &WorkspaceOverviewRefreshTrigger,
    status: WorkspaceOverviewRefreshAttemptStatus,
    finished_at_ms: i64,
    error_message: Option<String>,
    turn_id: &str,
) {
    state.last_attempt_finished_at_ms = Some(finished_at_ms);
    state.last_attempt_status = Some(status.clone());
    state.last_attempt_trigger = Some(trigger.clone());
    state.last_error = error_message.filter(|value| !value.trim().is_empty());

    match status {
        WorkspaceOverviewRefreshAttemptStatus::Ok => {
            state.last_successful_refresh_at_ms = Some(finished_at_ms);
            state.next_auto_refresh_not_before_ms = None;
            state.auto_failed_attempts_today = 0;
            state.auto_failed_attempts_day_key = Some(local_day_key(finished_at_ms));
        }
        WorkspaceOverviewRefreshAttemptStatus::Error
        | WorkspaceOverviewRefreshAttemptStatus::Cancelled => {
            increment_auto_failed_attempt_count(state, finished_at_ms);
            state.next_auto_refresh_not_before_ms = Some(next_auto_retry_time_ms(
                state.auto_failed_attempts_today,
                finished_at_ms,
            ));
        }
        WorkspaceOverviewRefreshAttemptStatus::Running => {}
    }

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

fn ensure_due_time(
    state: &mut WorkspaceOverviewRefreshState,
    directory_status: &WorkspaceOverviewDirectoryStatus,
    now_ms: i64,
) -> Option<i64> {
    reset_auto_failed_attempt_day_if_needed(state, now_ms);

    if has_pending_auto_retry(state) {
        return state.next_auto_refresh_not_before_ms;
    }

    if !directory_status.exists || !directory_status.has_non_empty_files {
        if state.next_auto_refresh_not_before_ms.is_none() {
            state.next_auto_refresh_not_before_ms = Some(now_ms + INITIAL_EMPTY_OVERVIEW_DELAY_MS);
        }
        return state.next_auto_refresh_not_before_ms;
    }

    if state.next_auto_refresh_not_before_ms.is_some() {
        state.next_auto_refresh_not_before_ms = None;
    }

    let baseline = effective_freshness_baseline_ms(state, directory_status)?;
    Some(
        baseline.saturating_add(AUTO_REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1_000),
    )
}

fn effective_freshness_baseline_ms(
    state: &WorkspaceOverviewRefreshState,
    directory_status: &WorkspaceOverviewDirectoryStatus,
) -> Option<i64> {
    match (
        state.last_successful_refresh_at_ms,
        directory_status.latest_modified_at_ms,
    ) {
        (Some(refresh_at), Some(modified_at)) => Some(refresh_at.max(modified_at)),
        (Some(refresh_at), None) => Some(refresh_at),
        (None, Some(modified_at)) => Some(modified_at),
        (None, None) => None,
    }
}

fn has_pending_auto_retry(state: &WorkspaceOverviewRefreshState) -> bool {
    matches!(
        state.last_attempt_status,
        Some(
            WorkspaceOverviewRefreshAttemptStatus::Error
                | WorkspaceOverviewRefreshAttemptStatus::Cancelled
        )
    ) && state.next_auto_refresh_not_before_ms.is_some()
}

fn next_auto_retry_time_ms(auto_failed_attempts_today: u32, now_ms: i64) -> i64 {
    if auto_failed_attempts_today >= MAX_AUTO_FAILED_ATTEMPTS_PER_DAY {
        next_local_day_start_ms(now_ms)
    } else {
        now_ms + AUTO_RETRY_DELAY_MS
    }
}

fn increment_auto_failed_attempt_count(state: &mut WorkspaceOverviewRefreshState, now_ms: i64) {
    let day_key = local_day_key(now_ms);
    if state.auto_failed_attempts_day_key.as_deref() != Some(day_key.as_str()) {
        state.auto_failed_attempts_today = 0;
        state.auto_failed_attempts_day_key = Some(day_key);
    }
    state.auto_failed_attempts_today = state.auto_failed_attempts_today.saturating_add(1);
}

fn reset_auto_failed_attempt_day_if_needed(
    state: &mut WorkspaceOverviewRefreshState,
    now_ms: i64,
) {
    let day_key = local_day_key(now_ms);
    if state.auto_failed_attempts_day_key.as_deref() != Some(day_key.as_str()) {
        state.auto_failed_attempts_today = 0;
        state.auto_failed_attempts_day_key = Some(day_key);
        if let Some(not_before) = state.next_auto_refresh_not_before_ms {
            if not_before <= now_ms {
                state.next_auto_refresh_not_before_ms = None;
            }
        }
    }
}

fn resolve_failed_turn_outcome(
    tracked: &TrackedWorkspaceOverviewTurn,
    fallback_status: WorkspaceOverviewRefreshAttemptStatus,
    error_message: &str,
    status_after: WorkspaceOverviewDirectoryStatus,
) -> FailedTurnOutcome {
    if workspace_overview_was_updated_since(&tracked.status_before, &status_after, tracked.started_at_ms)
    {
        return FailedTurnOutcome {
            status: WorkspaceOverviewRefreshAttemptStatus::Ok,
            error_message: None,
        };
    }

    FailedTurnOutcome {
        status: fallback_status,
        error_message: Some(error_message.to_string()),
    }
}

fn workspace_overview_was_updated_since(
    before: &WorkspaceOverviewDirectoryStatus,
    after: &WorkspaceOverviewDirectoryStatus,
    started_at_ms: i64,
) -> bool {
    if !after.exists || !after.has_non_empty_files {
        return false;
    }

    if !before.exists || !before.has_non_empty_files {
        return true;
    }

    match (before.latest_modified_at_ms, after.latest_modified_at_ms) {
        (Some(before_ms), Some(after_ms)) => after_ms > before_ms,
        (None, Some(after_ms)) => after_ms >= started_at_ms,
        _ => false,
    }
}

fn workspace_overview_was_updated_after_start(
    after: &WorkspaceOverviewDirectoryStatus,
    started_at_ms: i64,
) -> bool {
    if !after.exists || !after.has_non_empty_files {
        return false;
    }

    after.latest_modified_at_ms
        .map(|modified_at_ms| modified_at_ms >= started_at_ms)
        .unwrap_or(false)
}

async fn collect_refresh_targets(
) -> BitFunResult<Option<Vec<(WorkspaceInfo, PathBuf)>>> {
    let Some(workspace_service) = get_global_workspace_service() else {
        return Ok(None);
    };

    let mut candidates = workspace_service.list_workspace_routing_candidates().await;
    candidates.retain(|workspace| {
        workspace.workspace_kind == WorkspaceKind::Normal
            && workspace.root_path != crate::infrastructure::get_path_manager_arc().agentic_os_runtime_root()
    });

    if candidates.is_empty() {
        return Ok(None);
    }

    let _ = build_global_workspace_overviews_context().await?;
    let overview_dir = workspace_overview_dir_path();

    let mut scored = Vec::new();
    for workspace in candidates {
        let overview_path = workspace_overview_path(&overview_dir, &workspace);
        let metadata = tokio::fs::metadata(&overview_path).await.ok();
        let modified_at_ms = metadata
            .as_ref()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .and_then(|duration| i64::try_from(duration.as_millis()).ok());
        let is_empty = match metadata {
            Some(ref metadata) if metadata.len() == 0 => true,
            Some(_) => tokio::fs::read_to_string(&overview_path)
                .await
                .map(|content| content.trim().is_empty())
                .unwrap_or(true),
            None => true,
        };
        let score = if modified_at_ms.is_none() || is_empty {
            i64::MAX
        } else if workspace.last_accessed.timestamp_millis()
            > modified_at_ms.unwrap_or_default()
        {
            workspace.last_accessed.timestamp_millis()
        } else {
            modified_at_ms.unwrap_or_default()
        };
        scored.push((score, workspace, overview_path));
    }

    scored.sort_by(|left, right| right.0.cmp(&left.0));
    let targets = scored
        .into_iter()
        .take(WORKSPACE_OVERVIEW_REFRESH_MAX_ITEMS_PER_RUN)
        .map(|(_, workspace, overview_path)| (workspace, overview_path))
        .collect::<Vec<_>>();

    if targets.is_empty() {
        Ok(None)
    } else {
        Ok(Some(targets))
    }
}

fn workspace_overview_path(
    overview_dir: &std::path::Path,
    workspace: &WorkspaceInfo,
) -> PathBuf {
    let normalized_path = workspace.root_path.to_string_lossy().replace('\\', "/");
    let digest = sha2::Sha256::digest(normalized_path.as_bytes());
    let hash = format!("{:x}", digest)[..8].to_string();

    let preferred = workspace.name.trim();
    let fallback = workspace
        .root_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .unwrap_or_default();
    let seed = if preferred.is_empty() { fallback } else { preferred };

    let mut slug = String::new();
    let mut last_was_dash = false;
    for ch in seed.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash && !slug.is_empty() {
            slug.push('-');
            last_was_dash = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    let slug = if slug.is_empty() {
        "workspace".to_string()
    } else {
        slug
    };

    overview_dir.join(format!("{slug}--{hash}.md"))
}

fn build_runtime_restrictions(
    targets: &[(WorkspaceInfo, PathBuf)],
) -> ToolRuntimeRestrictions {
    let mut write_roots = vec![workspace_overview_dir_path().to_string_lossy().to_string()];
    write_roots.sort();
    write_roots.dedup();

    let _workspace_roots = targets
        .iter()
        .map(|(workspace, _)| workspace.root_path.to_string_lossy().to_string())
        .collect::<Vec<_>>();

    ToolRuntimeRestrictions {
        allowed_tool_names: workspace_overview_refresh_allowed_tools()
            .into_iter()
            .collect(),
        denied_tool_names: std::collections::BTreeSet::new(),
        path_policy: ToolPathPolicy {
            write_roots: write_roots.clone(),
            edit_roots: write_roots,
            delete_roots: Vec::new(),
        },
        disable_snapshot_tracking: true,
    }
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

fn duration_until_ms(now_ms: i64, target_ms: i64) -> Duration {
    if target_ms <= now_ms {
        return Duration::from_secs(0);
    }

    let delta_ms = u64::try_from(target_ms.saturating_sub(now_ms)).unwrap_or(u64::MAX);
    Duration::from_millis(delta_ms)
}
