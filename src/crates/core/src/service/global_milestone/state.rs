use crate::error::*;
use crate::infrastructure::get_path_manager_arc;
use serde::{Deserialize, Serialize};
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GlobalMilestoneAttemptStatus {
    Running,
    Ok,
    Error,
    Cancelled,
    SkippedNoSources,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GlobalMilestoneTrigger {
    Auto,
    Manual,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GlobalMilestoneState {
    pub last_completed_source_end_date: Option<String>,
    pub active_source_start_date: Option<String>,
    pub active_source_end_date: Option<String>,
    pub active_turn_id: Option<String>,
    pub last_successful_run_at_ms: Option<i64>,
    pub last_attempt_started_at_ms: Option<i64>,
    pub last_attempt_finished_at_ms: Option<i64>,
    pub last_attempt_status: Option<GlobalMilestoneAttemptStatus>,
    pub last_attempt_trigger: Option<GlobalMilestoneTrigger>,
    pub last_error: Option<String>,
    pub next_auto_run_not_before_ms: Option<i64>,
}

pub(crate) fn global_milestone_state_file_path() -> std::path::PathBuf {
    get_path_manager_arc().agentic_os_global_milestone_state_path()
}

pub(crate) async fn ensure_global_milestone_runtime_dir() -> CoreResult<()> {
    let dir = get_path_manager_arc().agentic_os_global_milestone_dir();
    fs::create_dir_all(&dir).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to create global milestone runtime directory {}: {}",
            dir.display(),
            error
        ))
    })?;
    Ok(())
}

pub(crate) async fn load_global_milestone_state() -> CoreResult<GlobalMilestoneState> {
    ensure_global_milestone_runtime_dir().await?;

    let path = global_milestone_state_file_path();
    if !path.exists() {
        return Ok(GlobalMilestoneState::default());
    }

    let content = fs::read_to_string(&path).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to read global milestone state file {}: {}",
            path.display(),
            error
        ))
    })?;

    if content.trim().is_empty() {
        return Ok(GlobalMilestoneState::default());
    }

    serde_json::from_str(&content).map_err(|error| {
        CoreError::service(format!(
            "Failed to parse global milestone state file {}: {}",
            path.display(),
            error
        ))
    })
}

pub(crate) async fn save_global_milestone_state(state: &GlobalMilestoneState) -> CoreResult<()> {
    ensure_global_milestone_runtime_dir().await?;

    let path = global_milestone_state_file_path();
    let content = serde_json::to_string_pretty(state).map_err(|error| {
        CoreError::service(format!(
            "Failed to serialize global milestone state for {}: {}",
            path.display(),
            error
        ))
    })?;

    fs::write(&path, content).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to write global milestone state file {}: {}",
            path.display(),
            error
        ))
    })?;

    Ok(())
}
