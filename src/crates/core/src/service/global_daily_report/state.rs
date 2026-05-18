use crate::infrastructure::get_path_manager_arc;
use crate::util::errors::*;
use serde::{Deserialize, Serialize};
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GlobalDailyReportAttemptStatus {
    Running,
    Ok,
    Error,
    Cancelled,
    SkippedNoSources,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GlobalDailyReportState {
    pub last_completed_date: Option<String>,
    pub last_attempted_date: Option<String>,
    pub active_report_date: Option<String>,
    pub active_turn_id: Option<String>,
    pub last_attempt_started_at_ms: Option<i64>,
    pub last_attempt_finished_at_ms: Option<i64>,
    pub last_attempt_status: Option<GlobalDailyReportAttemptStatus>,
    pub last_error: Option<String>,
}

pub(crate) fn global_daily_report_state_file_path() -> std::path::PathBuf {
    get_path_manager_arc().agentic_os_daily_reports_state_path()
}

pub(crate) async fn ensure_global_daily_report_runtime_dir() -> BitFunResult<()> {
    let dir = get_path_manager_arc().agentic_os_daily_reports_dir();
    fs::create_dir_all(&dir).await.map_err(|error| {
        BitFunError::service(format!(
            "Failed to create global daily report runtime directory {}: {}",
            dir.display(),
            error
        ))
    })?;
    Ok(())
}

pub(crate) async fn load_global_daily_report_state() -> BitFunResult<GlobalDailyReportState> {
    ensure_global_daily_report_runtime_dir().await?;

    let path = global_daily_report_state_file_path();
    if !path.exists() {
        return Ok(GlobalDailyReportState::default());
    }

    let content = fs::read_to_string(&path).await.map_err(|error| {
        BitFunError::service(format!(
            "Failed to read global daily report state file {}: {}",
            path.display(),
            error
        ))
    })?;

    if content.trim().is_empty() {
        return Ok(GlobalDailyReportState::default());
    }

    serde_json::from_str(&content).map_err(|error| {
        BitFunError::service(format!(
            "Failed to parse global daily report state file {}: {}",
            path.display(),
            error
        ))
    })
}

pub(crate) async fn save_global_daily_report_state(
    state: &GlobalDailyReportState,
) -> BitFunResult<()> {
    ensure_global_daily_report_runtime_dir().await?;

    let path = global_daily_report_state_file_path();
    let content = serde_json::to_string_pretty(state).map_err(|error| {
        BitFunError::service(format!(
            "Failed to serialize global daily report state for {}: {}",
            path.display(),
            error
        ))
    })?;

    fs::write(&path, content).await.map_err(|error| {
        BitFunError::service(format!(
            "Failed to write global daily report state file {}: {}",
            path.display(),
            error
        ))
    })?;

    Ok(())
}
