use super::prompt::{
    build_global_daily_report_user_prompt, default_global_daily_report_session_name,
    global_daily_report_allowed_tools,
};
use super::state::{
    global_daily_report_runtime_dir, load_global_daily_report_state,
    save_global_daily_report_state, GlobalDailyReportAttemptStatus, GlobalDailyReportState,
};
use crate::agentic::coordination::ConversationCoordinator;
use crate::agentic::tools::{ToolPathPolicy, ToolRuntimeRestrictions};
use crate::error::CoreResult;
use crate::infrastructure::get_path_manager_arc;
use crate::service::config::is_primary_ai_model_configured;
use chrono::{Datelike, Duration as ChronoDuration, Local, LocalResult, TimeZone};
use log::{info, warn};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::fs;
use tokio::sync::{Mutex, Notify};
use tokio::time::Duration;
use uuid::Uuid;

const DAILY_WAKE_HOUR_LOCAL: u32 = 0;
const DAILY_WAKE_MINUTE_LOCAL: u32 = 5;
const STARTUP_CATCH_UP_DELAY_SECS: u64 = 15;
const STALE_RUNNING_ATTEMPT_AFTER_MS: i64 = 2 * 60 * 60 * 1000;

static GLOBAL_GLOBAL_DAILY_REPORT_SERVICE: OnceLock<Arc<GlobalDailyReportService>> =
    OnceLock::new();

pub struct GlobalDailyReportService {
    coordinator: Arc<ConversationCoordinator>,
    state: Mutex<GlobalDailyReportState>,
    wake_notify: Notify,
    started: AtomicBool,
}

impl GlobalDailyReportService {
    pub async fn new(coordinator: Arc<ConversationCoordinator>) -> CoreResult<Arc<Self>> {
        let mut state = load_global_daily_report_state().await?;
        if matches!(
            state.last_attempt_status,
            Some(GlobalDailyReportAttemptStatus::Running)
        ) {
            warn!(
                "Recovering interrupted global daily report run on startup: active_report_date={:?}, active_turn_id={:?}",
                state.active_report_date, state.active_turn_id
            );
            mark_global_daily_report_run_interrupted(
                &mut state,
                "Previous global daily report run was interrupted before completion",
            );
            save_global_daily_report_state(&state).await?;
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
            "Global daily report service started: daily_wake_hour_local={}, daily_wake_minute_local={}",
            DAILY_WAKE_HOUR_LOCAL, DAILY_WAKE_MINUTE_LOCAL
        );

        let catch_up_service = Arc::clone(self);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(STARTUP_CATCH_UP_DELAY_SECS)).await;
            if let Err(error) = catch_up_service.run_catch_up().await {
                warn!("Global daily report startup catch-up failed: {}", error);
            }
        });

        let service = Arc::clone(self);
        tokio::spawn(async move {
            service.run_loop().await;
        });
    }

    pub async fn handle_turn_completed(&self, turn_id: &str) -> CoreResult<()> {
        let mut state = self.state.lock().await;
        if state.active_turn_id.as_deref() != Some(turn_id) {
            return Ok(());
        }

        state.last_attempt_finished_at_ms = Some(now_ms());
        state.last_attempt_status = Some(GlobalDailyReportAttemptStatus::Ok);
        state.last_error = None;
        state.last_completed_date = state.active_report_date.clone();
        state.last_attempted_date = state.active_report_date.clone();
        state.active_turn_id = None;
        state.active_report_date = None;
        save_global_daily_report_state(&state).await?;
        self.wake_notify.notify_one();
        Ok(())
    }

    pub async fn handle_turn_failed(&self, turn_id: &str, error_message: &str) -> CoreResult<()> {
        let mut state = self.state.lock().await;
        if state.active_turn_id.as_deref() != Some(turn_id) {
            return Ok(());
        }

        state.last_attempt_finished_at_ms = Some(now_ms());
        state.last_attempt_status = Some(GlobalDailyReportAttemptStatus::Error);
        state.last_error = Some(error_message.trim().to_string());
        state.last_attempted_date = state.active_report_date.clone();
        state.active_turn_id = None;
        state.active_report_date = None;
        save_global_daily_report_state(&state).await?;
        self.wake_notify.notify_one();
        Ok(())
    }

    pub async fn handle_turn_cancelled(&self, turn_id: &str) -> CoreResult<()> {
        let mut state = self.state.lock().await;
        if state.active_turn_id.as_deref() != Some(turn_id) {
            return Ok(());
        }

        state.last_attempt_finished_at_ms = Some(now_ms());
        state.last_attempt_status = Some(GlobalDailyReportAttemptStatus::Cancelled);
        state.last_error = Some("Global daily report turn was cancelled".to_string());
        state.last_attempted_date = state.active_report_date.clone();
        state.active_turn_id = None;
        state.active_report_date = None;
        save_global_daily_report_state(&state).await?;
        self.wake_notify.notify_one();
        Ok(())
    }

    async fn run_loop(self: Arc<Self>) {
        loop {
            let next_delay = next_daily_wake_duration();
            tokio::select! {
                _ = tokio::time::sleep(next_delay) => {}
                _ = self.wake_notify.notified() => {}
            }

            if let Err(error) = self.run_catch_up().await {
                warn!("Global daily report scheduled run failed: {}", error);
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
        }
    }

    async fn run_catch_up(&self) -> CoreResult<()> {
        if !is_primary_ai_model_configured().await {
            return Ok(());
        }

        {
            let mut state = self.state.lock().await;
            if matches!(
                state.last_attempt_status,
                Some(GlobalDailyReportAttemptStatus::Running)
            ) || state.active_turn_id.is_some()
            {
                if is_stale_global_daily_report_run(&state) {
                    warn!(
                        "Clearing stale global daily report run before catch-up: active_report_date={:?}, active_turn_id={:?}",
                        state.active_report_date, state.active_turn_id
                    );
                    mark_global_daily_report_run_interrupted(
                        &mut state,
                        "Previous global daily report run expired before completion",
                    );
                    save_global_daily_report_state(&state).await?;
                } else {
                    info!("Global daily report catch-up skipped because a report turn is already active");
                    return Ok(());
                }
            }
        }

        while let Some(target_date) = self.next_due_report_date().await? {
            let source_paths = collect_session_daily_summary_sources(&target_date).await?;
            if source_paths.is_empty() {
                info!(
                    "Skipping global daily report for date with no source summaries: report_date={}",
                    target_date
                );
                let mut state = self.state.lock().await;
                state.last_attempt_started_at_ms = Some(now_ms());
                state.last_attempt_finished_at_ms = Some(now_ms());
                state.last_attempt_status = Some(GlobalDailyReportAttemptStatus::SkippedNoSources);
                state.last_error = None;
                state.last_attempted_date = Some(target_date.clone());
                state.last_completed_date = Some(target_date.clone());
                save_global_daily_report_state(&state).await?;
                continue;
            }

            let output_path = global_daily_report_output_path(&target_date)?;
            let request_id = format!("global-daily-report-{}", Uuid::new_v4());
            let prompt =
                build_global_daily_report_user_prompt(&target_date, &output_path, &source_paths);
            let runtime_tool_restrictions = ToolRuntimeRestrictions {
                allowed_tool_names: global_daily_report_allowed_tools().into_iter().collect(),
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
                .start_background_global_daily_report_turn(
                    &request_id,
                    default_global_daily_report_session_name(),
                    prompt,
                    runtime_tool_restrictions,
                    None,
                )
                .await?;

            info!(
                "Started global daily report run: report_date={}, turn_id={}, source_count={}, output_path={}",
                target_date,
                turn_id,
                source_paths.len(),
                output_path.display()
            );

            let mut state = self.state.lock().await;
            state.last_attempt_started_at_ms = Some(now_ms());
            state.last_attempt_finished_at_ms = None;
            state.last_attempt_status = Some(GlobalDailyReportAttemptStatus::Running);
            state.last_error = None;
            state.active_turn_id = Some(turn_id);
            state.active_report_date = Some(target_date);
            save_global_daily_report_state(&state).await?;
            break;
        }

        Ok(())
    }

    async fn next_due_report_date(&self) -> CoreResult<Option<String>> {
        let yesterday = previous_local_date_key();
        let state = self.state.lock().await;

        let next_date = match state.last_completed_date.as_deref() {
            Some(last_completed) => next_date_key(last_completed),
            None => earliest_available_report_date()
                .await?
                .unwrap_or(yesterday.clone()),
        };

        if next_date > yesterday {
            info!(
                "No global daily report catch-up needed: last_completed_date={:?}, yesterday={}",
                state.last_completed_date, yesterday
            );
            Ok(None)
        } else {
            info!(
                "Global daily report catch-up selected next date: last_completed_date={:?}, next_date={}, yesterday={}",
                state.last_completed_date, next_date, yesterday
            );
            Ok(Some(next_date))
        }
    }
}

pub fn install_global_global_daily_report_service(
    service: Arc<GlobalDailyReportService>,
) -> Result<(), ()> {
    GLOBAL_GLOBAL_DAILY_REPORT_SERVICE
        .set(service)
        .map_err(|_| ())
}

pub fn get_global_global_daily_report_service() -> Option<Arc<GlobalDailyReportService>> {
    GLOBAL_GLOBAL_DAILY_REPORT_SERVICE.get().cloned()
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
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

fn next_daily_wake_duration() -> Duration {
    let now = Local::now();
    let today_wake = local_datetime(
        now.year(),
        now.month(),
        now.day(),
        DAILY_WAKE_HOUR_LOCAL,
        DAILY_WAKE_MINUTE_LOCAL,
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
            DAILY_WAKE_HOUR_LOCAL,
            DAILY_WAKE_MINUTE_LOCAL,
            0,
        )
    };

    let millis = (next_wake - now).num_milliseconds().max(0) as u64;
    Duration::from_millis(millis)
}

fn previous_local_date_key() -> String {
    (Local::now().date_naive() - ChronoDuration::days(1))
        .format("%Y-%m-%d")
        .to_string()
}

fn next_date_key(date_key: &str) -> String {
    chrono::NaiveDate::parse_from_str(date_key, "%Y-%m-%d")
        .map(|date| {
            (date + ChronoDuration::days(1))
                .format("%Y-%m-%d")
                .to_string()
        })
        .unwrap_or_else(|_| previous_local_date_key())
}

fn global_daily_report_output_path(date_key: &str) -> CoreResult<PathBuf> {
    let year = date_key.split('-').next().unwrap_or("unknown");
    Ok(global_daily_report_runtime_dir()?
        .join(year)
        .join(format!("{date_key}.md")))
}

fn is_stale_global_daily_report_run(state: &GlobalDailyReportState) -> bool {
    state
        .last_attempt_started_at_ms
        .map(|started_at_ms| {
            now_ms().saturating_sub(started_at_ms) > STALE_RUNNING_ATTEMPT_AFTER_MS
        })
        .unwrap_or(true)
}

fn mark_global_daily_report_run_interrupted(state: &mut GlobalDailyReportState, reason: &str) {
    state.last_attempt_finished_at_ms = Some(now_ms());
    state.last_attempt_status = Some(GlobalDailyReportAttemptStatus::Cancelled);
    state.last_error = Some(reason.to_string());
    state.last_attempted_date = state.active_report_date.clone();
    state.active_turn_id = None;
    state.active_report_date = None;
}

async fn earliest_available_report_date() -> CoreResult<Option<String>> {
    let mut dates = Vec::new();
    for path in collect_all_daily_summary_files().await? {
        if let Some(date) = daily_summary_date_from_path(&path) {
            dates.push(date);
        }
    }
    dates.sort();
    dates.dedup();
    Ok(dates.into_iter().next())
}

async fn collect_session_daily_summary_sources(report_date: &str) -> CoreResult<Vec<PathBuf>> {
    let mut result = Vec::new();
    let target_file_name = format!("{report_date}.md");

    for path in collect_all_daily_summary_files().await? {
        if path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value == target_file_name)
        {
            result.push(path);
        }
    }

    result.sort();
    result.dedup();
    Ok(result)
}

async fn collect_all_daily_summary_files() -> CoreResult<Vec<PathBuf>> {
    let path_manager = get_path_manager_arc();
    collect_all_daily_summary_files_with_roots(
        &path_manager.session_domain_root(&crate::agentic::core::SessionDomain::OsAgent)?,
        &path_manager.session_domain_root(&crate::agentic::core::SessionDomain::Global)?,
        &path_manager.sessions_root().join("workspaces"),
    )
    .await
}

async fn collect_all_daily_summary_files_with_roots(
    os_agent_sessions_dir: &Path,
    global_sessions_dir: &Path,
    workspace_session_domains_root: &Path,
) -> CoreResult<Vec<PathBuf>> {
    let mut result = Vec::new();

    collect_daily_summary_files_under(os_agent_sessions_dir, &mut result).await?;
    collect_daily_summary_files_under(global_sessions_dir, &mut result).await?;

    if workspace_session_domains_root.exists() {
        let mut entries = fs::read_dir(workspace_session_domains_root)
            .await
            .map_err(|error| {
                crate::error::CoreError::service(format!(
                    "Failed to read workspace session domains root {}: {}",
                    workspace_session_domains_root.display(),
                    error
                ))
            })?;

        while let Some(entry) = entries.next_entry().await.map_err(|error| {
            crate::error::CoreError::service(format!(
                "Failed to iterate workspace session domains root {}: {}",
                workspace_session_domains_root.display(),
                error
            ))
        })? {
            let file_type = entry.file_type().await.map_err(|error| {
                crate::error::CoreError::service(format!(
                    "Failed to inspect workspace session domain {}: {}",
                    entry.path().display(),
                    error
                ))
            })?;
            if file_type.is_dir() {
                collect_daily_summary_files_under(&entry.path(), &mut result).await?;
            }
        }
    }

    Ok(result)
}

async fn collect_daily_summary_files_under(
    sessions_dir: &Path,
    result: &mut Vec<PathBuf>,
) -> CoreResult<()> {
    if !sessions_dir.exists() {
        return Ok(());
    }

    let mut session_entries = fs::read_dir(sessions_dir).await.map_err(|error| {
        crate::error::CoreError::service(format!(
            "Failed to read sessions directory {}: {}",
            sessions_dir.display(),
            error
        ))
    })?;

    while let Some(session_entry) = session_entries.next_entry().await.map_err(|error| {
        crate::error::CoreError::service(format!(
            "Failed to iterate sessions directory {}: {}",
            sessions_dir.display(),
            error
        ))
    })? {
        let daily_summaries_dir = session_entry.path().join("daily_summaries");
        if !daily_summaries_dir.exists() {
            continue;
        }

        let mut files = fs::read_dir(&daily_summaries_dir).await.map_err(|error| {
            crate::error::CoreError::service(format!(
                "Failed to read daily summaries directory {}: {}",
                daily_summaries_dir.display(),
                error
            ))
        })?;

        while let Some(file) = files.next_entry().await.map_err(|error| {
            crate::error::CoreError::service(format!(
                "Failed to iterate daily summaries directory {}: {}",
                daily_summaries_dir.display(),
                error
            ))
        })? {
            let path = file.path();
            if path.extension().and_then(|value| value.to_str()) == Some("md") {
                result.push(path);
            }
        }
    }

    Ok(())
}

fn daily_summary_date_from_path(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .filter(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok())
}

#[cfg(test)]
mod tests {
    use super::{
        collect_all_daily_summary_files_with_roots, daily_summary_date_from_path, next_date_key,
    };
    use std::path::{Path, PathBuf};
    use tokio::fs;
    use uuid::Uuid;

    struct TestWorkspace {
        root: PathBuf,
    }

    impl TestWorkspace {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("sparo-daily-report-test-{}", Uuid::new_v4()));
            std::fs::create_dir_all(&root).expect("create temp root");
            Self { root }
        }

        fn domain_session_daily_summary(
            &self,
            domain: &str,
            session_id: &str,
            date_key: &str,
        ) -> PathBuf {
            self.root
                .join("sessions")
                .join(domain)
                .join(session_id)
                .join("daily_summaries")
                .join(format!("{date_key}.md"))
        }

        fn workspace_session_daily_summary(
            &self,
            workspace_id: &str,
            session_id: &str,
            date_key: &str,
        ) -> PathBuf {
            self.root
                .join("sessions")
                .join("workspaces")
                .join(workspace_id)
                .join(session_id)
                .join("daily_summaries")
                .join(format!("{date_key}.md"))
        }
    }

    #[tokio::test]
    async fn collects_daily_summary_files_from_agentic_and_workspace_sessions() {
        let workspace = TestWorkspace::new();
        let target_date = "2026-05-17";
        let agentic_path = workspace.domain_session_daily_summary("os_agent", "os-1", target_date);
        let global_path = workspace.domain_session_daily_summary("global", "global-1", target_date);
        let project_path =
            workspace.workspace_session_daily_summary("ws_a", "session-1", target_date);
        let other_date_path =
            workspace.workspace_session_daily_summary("ws_a", "session-2", "2026-05-16");

        for path in [&agentic_path, &global_path, &project_path, &other_date_path] {
            fs::create_dir_all(path.parent().expect("parent"))
                .await
                .expect("create parent");
            fs::write(path, "# Session Summary\n")
                .await
                .expect("write summary");
        }

        let sources = collect_all_daily_summary_files_with_roots(
            &workspace.root.join("sessions").join("os_agent"),
            &workspace.root.join("sessions").join("global"),
            &workspace.root.join("sessions").join("workspaces"),
        )
        .await
        .expect("collect sources");

        assert_eq!(sources.len(), 4);
        assert!(sources.contains(&agentic_path));
        assert!(sources.contains(&global_path));
        assert!(sources.contains(&project_path));
        assert!(sources.contains(&other_date_path));
        assert_eq!(
            daily_summary_date_from_path(&project_path),
            Some(target_date.to_string())
        );
    }

    #[test]
    fn advances_date_key_by_one_day() {
        assert_eq!(next_date_key("2026-05-17"), "2026-05-18");
    }

    #[test]
    fn extracts_date_key_from_daily_summary_path() {
        let path = Path::new("C:/tmp/daily_summaries/2026-05-17.md");
        assert_eq!(
            daily_summary_date_from_path(path),
            Some("2026-05-17".to_string())
        );
    }
}
