use super::overview::ensure_host_overview_runtime_dir;
use crate::infrastructure::get_path_manager_arc;
use crate::error::*;
use serde::{Deserialize, Serialize};
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HostScanTrigger {
    Manual,
    Auto,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HostScanAttemptStatus {
    Running,
    Ok,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HostScanState {
    pub last_successful_scan_at_ms: Option<i64>,
    pub last_successful_scan_trigger: Option<HostScanTrigger>,
    pub last_attempt_started_at_ms: Option<i64>,
    pub last_attempt_finished_at_ms: Option<i64>,
    pub last_attempt_status: Option<HostScanAttemptStatus>,
    pub last_attempt_trigger: Option<HostScanTrigger>,
    pub last_error: Option<String>,
    #[serde(alias = "autoAttemptsToday")]
    pub auto_failed_attempts_today: u32,
    #[serde(alias = "autoAttemptsDayKey")]
    pub auto_failed_attempts_day_key: Option<String>,
    pub next_auto_scan_not_before_ms: Option<i64>,
    pub active_auto_turn_id: Option<String>,
}

pub(crate) fn host_scan_state_file_path() -> std::path::PathBuf {
    get_path_manager_arc().agentic_os_host_scan_state_path()
}

pub(crate) async fn load_host_scan_state() -> CoreResult<HostScanState> {
    ensure_host_overview_runtime_dir().await?;

    let path = host_scan_state_file_path();
    if !path.exists() {
        return Ok(HostScanState::default());
    }

    let content = fs::read_to_string(&path).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to read host scan state file {}: {}",
            path.display(),
            error
        ))
    })?;

    if content.trim().is_empty() {
        return Ok(HostScanState::default());
    }

    serde_json::from_str(&content).map_err(|error| {
        CoreError::service(format!(
            "Failed to parse host scan state file {}: {}",
            path.display(),
            error
        ))
    })
}

pub(crate) async fn save_host_scan_state(state: &HostScanState) -> CoreResult<()> {
    ensure_host_overview_runtime_dir().await?;

    let path = host_scan_state_file_path();
    let content = serde_json::to_string_pretty(state).map_err(|error| {
        CoreError::service(format!(
            "Failed to serialize host scan state for {}: {}",
            path.display(),
            error
        ))
    })?;

    fs::write(&path, content).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to write host scan state file {}: {}",
            path.display(),
            error
        ))
    })?;

    Ok(())
}
