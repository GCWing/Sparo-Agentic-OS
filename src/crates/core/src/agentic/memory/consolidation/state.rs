use crate::error::{CoreError, CoreResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::fs;

const STATE_FILE_NAME: &str = "state.json";
const STATE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryConsolidationState {
    pub version: u32,
    #[serde(default)]
    pub sources: HashMap<String, MemoryConsolidationSourceState>,
    #[serde(default)]
    pub last_started_at_ms: Option<i64>,
    #[serde(default)]
    pub last_completed_at_ms: Option<i64>,
}

impl Default for MemoryConsolidationState {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            sources: HashMap::new(),
            last_started_at_ms: None,
            last_completed_at_ms: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemoryConsolidationSourceState {
    #[serde(default)]
    pub last_processed_relative_path: Option<String>,
    #[serde(default)]
    pub last_processed_line: usize,
    #[serde(default)]
    pub last_processed_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryConsolidationSourceKind {
    Workspace,
    Global,
}

#[derive(Debug, Clone)]
pub struct MemoryConsolidationSource {
    pub key: String,
    pub kind: MemoryConsolidationSourceKind,
    pub workspace_root: Option<PathBuf>,
    pub memory_dir: PathBuf,
}

#[derive(Debug, Clone)]
pub struct JournalSlice {
    pub relative_path: String,
    pub start_line: usize,
    pub content: String,
}

impl MemoryConsolidationState {
    pub fn source_state(&self, key: &str) -> MemoryConsolidationSourceState {
        self.sources.get(key).cloned().unwrap_or_default()
    }

    pub fn source_state_mut(&mut self, key: &str) -> &mut MemoryConsolidationSourceState {
        self.sources.entry(key.to_string()).or_default()
    }
}

pub fn state_file_path() -> PathBuf {
    crate::infrastructure::get_path_manager_arc()
        .agentic_os_memory_dir()
        .join(STATE_FILE_NAME)
}

pub async fn load_state() -> CoreResult<MemoryConsolidationState> {
    let path = state_file_path();
    if !path.exists() {
        return Ok(MemoryConsolidationState::default());
    }

    let content = fs::read_to_string(&path).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to read memory consolidation state {}: {}",
            path.display(),
            error
        ))
    })?;

    let mut state: MemoryConsolidationState = serde_json::from_str(&content).map_err(|error| {
        CoreError::service(format!(
            "Failed to parse memory consolidation state {}: {}",
            path.display(),
            error
        ))
    })?;
    state.version = STATE_VERSION;
    Ok(state)
}

pub async fn save_state(state: &MemoryConsolidationState) -> CoreResult<()> {
    let path = state_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await.map_err(|error| {
            CoreError::service(format!(
                "Failed to create memory consolidation state directory {}: {}",
                parent.display(),
                error
            ))
        })?;
    }

    let content = serde_json::to_string_pretty(state).map_err(|error| {
        CoreError::service(format!(
            "Failed to serialize memory consolidation state: {}",
            error
        ))
    })?;

    fs::write(&path, content).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to write memory consolidation state {}: {}",
            path.display(),
            error
        ))
    })?;

    Ok(())
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

pub fn relative_log_path(memory_dir: &Path, log_path: &Path) -> String {
    log_path
        .strip_prefix(memory_dir)
        .unwrap_or(log_path)
        .to_string_lossy()
        .replace('\\', "/")
}
