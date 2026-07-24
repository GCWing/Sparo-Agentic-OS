use crate::error::*;
use crate::infrastructure::get_path_manager_arc;
use serde::{Deserialize, Serialize};
use tokio::fs;

pub(crate) const GLOBAL_DAILY_REPORT_SERVICE_ID: &str = "global_daily_report";

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

pub(crate) fn global_daily_report_runtime_dir() -> CoreResult<std::path::PathBuf> {
    get_path_manager_arc().global_service_dir(GLOBAL_DAILY_REPORT_SERVICE_ID)
}

pub(crate) fn global_daily_report_state_file_path() -> CoreResult<std::path::PathBuf> {
    Ok(global_daily_report_runtime_dir()?.join("state.json"))
}

pub(crate) async fn ensure_global_daily_report_runtime_dir() -> CoreResult<()> {
    let dir = global_daily_report_runtime_dir()?;
    fs::create_dir_all(&dir).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to create global daily report runtime directory {}: {}",
            dir.display(),
            error
        ))
    })?;
    Ok(())
}

pub(crate) async fn load_global_daily_report_state() -> CoreResult<GlobalDailyReportState> {
    ensure_global_daily_report_runtime_dir().await?;

    let path = global_daily_report_state_file_path()?;
    if !path.exists() {
        return Ok(GlobalDailyReportState::default());
    }

    let content = fs::read_to_string(&path).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to read global daily report state file {}: {}",
            path.display(),
            error
        ))
    })?;

    if content.trim().is_empty() {
        return Ok(GlobalDailyReportState::default());
    }

    serde_json::from_str(&content).map_err(|error| {
        CoreError::service(format!(
            "Failed to parse global daily report state file {}: {}",
            path.display(),
            error
        ))
    })
}

pub(crate) async fn save_global_daily_report_state(
    state: &GlobalDailyReportState,
) -> CoreResult<()> {
    ensure_global_daily_report_runtime_dir().await?;

    let path = global_daily_report_state_file_path()?;
    let content = serde_json::to_string_pretty(state).map_err(|error| {
        CoreError::service(format!(
            "Failed to serialize global daily report state for {}: {}",
            path.display(),
            error
        ))
    })?;

    fs::write(&path, content).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to write global daily report state file {}: {}",
            path.display(),
            error
        ))
    })?;

    Ok(())
}
