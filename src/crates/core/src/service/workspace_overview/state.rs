use super::overview::ensure_workspace_overview_runtime_dir;
use crate::error::*;
use crate::infrastructure::get_path_manager_arc;
use serde::{Deserialize, Serialize};
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceOverviewRefreshTrigger {
    Manual,
    Auto,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceOverviewRefreshAttemptStatus {
    Running,
    Ok,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WorkspaceOverviewRefreshState {
    pub last_successful_refresh_at_ms: Option<i64>,
    pub last_attempt_started_at_ms: Option<i64>,
    pub last_attempt_finished_at_ms: Option<i64>,
    pub last_attempt_status: Option<WorkspaceOverviewRefreshAttemptStatus>,
    pub last_attempt_trigger: Option<WorkspaceOverviewRefreshTrigger>,
    pub last_error: Option<String>,
    pub auto_failed_attempts_today: u32,
    pub auto_failed_attempts_day_key: Option<String>,
    pub next_auto_refresh_not_before_ms: Option<i64>,
    pub active_auto_turn_id: Option<String>,
}

pub(crate) fn workspace_overview_refresh_state_file_path() -> std::path::PathBuf {
    get_path_manager_arc()
        .agentic_os_workspaces_overview_dir()
        .join("state.json")
}

pub(crate) async fn load_workspace_overview_refresh_state(
) -> CoreResult<WorkspaceOverviewRefreshState> {
    ensure_workspace_overview_runtime_dir().await?;

    let path = workspace_overview_refresh_state_file_path();
    if !path.exists() {
        return Ok(WorkspaceOverviewRefreshState::default());
    }

    let content = fs::read_to_string(&path).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to read workspace overview refresh state file {}: {}",
            path.display(),
            error
        ))
    })?;

    if content.trim().is_empty() {
        return Ok(WorkspaceOverviewRefreshState::default());
    }

    serde_json::from_str(&content).map_err(|error| {
        CoreError::service(format!(
            "Failed to parse workspace overview refresh state file {}: {}",
            path.display(),
            error
        ))
    })
}

pub(crate) async fn save_workspace_overview_refresh_state(
    state: &WorkspaceOverviewRefreshState,
) -> CoreResult<()> {
    ensure_workspace_overview_runtime_dir().await?;

    let path = workspace_overview_refresh_state_file_path();
    let content = serde_json::to_string_pretty(state).map_err(|error| {
        CoreError::service(format!(
            "Failed to serialize workspace overview refresh state for {}: {}",
            path.display(),
            error
        ))
    })?;

    fs::write(&path, content).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to write workspace overview refresh state file {}: {}",
            path.display(),
            error
        ))
    })?;

    Ok(())
}
