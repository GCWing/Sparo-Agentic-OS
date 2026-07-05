use super::model::{GoalExtractionRun, GoalJudgeRun, GoalRecord, GoalStoreEvent};
use crate::infrastructure::PathManager;
use crate::error::{CoreError, CoreResult};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::fs;
use tokio::io::AsyncWriteExt;

#[derive(Clone)]
pub struct GoalStore {
    path_manager: Arc<PathManager>,
}

impl GoalStore {
    pub fn new(path_manager: Arc<PathManager>) -> Self {
        Self { path_manager }
    }

    fn workspace_sessions_dir(&self, workspace_path: &Path) -> PathBuf {
        let agentic_os_runtime_root = self.path_manager.agentic_os_runtime_root();
        if workspace_path == agentic_os_runtime_root {
            agentic_os_runtime_root.join("sessions")
        } else {
            self.path_manager.workspace_sessions_dir(workspace_path)
        }
    }

    pub fn goals_dir(&self, workspace_path: &Path, session_id: &str) -> PathBuf {
        self.workspace_sessions_dir(workspace_path)
            .join(session_id)
            .join("goals")
    }

    fn current_path(&self, workspace_path: &Path, session_id: &str) -> PathBuf {
        self.goals_dir(workspace_path, session_id)
            .join("current.json")
    }

    fn events_path(&self, workspace_path: &Path, session_id: &str) -> PathBuf {
        self.goals_dir(workspace_path, session_id)
            .join("events.jsonl")
    }

    fn snapshots_dir(&self, workspace_path: &Path, session_id: &str) -> PathBuf {
        self.goals_dir(workspace_path, session_id).join("snapshots")
    }

    fn extractions_dir(&self, workspace_path: &Path, session_id: &str) -> PathBuf {
        self.goals_dir(workspace_path, session_id)
            .join("extractions")
    }

    fn judges_dir(&self, workspace_path: &Path, session_id: &str) -> PathBuf {
        self.goals_dir(workspace_path, session_id).join("judges")
    }

    pub async fn load_current(
        &self,
        workspace_path: &Path,
        session_id: &str,
    ) -> CoreResult<Option<GoalRecord>> {
        let path = self.current_path(workspace_path, session_id);
        if !path.exists() {
            return Ok(None);
        }
        let bytes = fs::read(&path).await.map_err(|error| {
            CoreError::service(format!(
                "Failed to read goal current file: path={} error={}",
                path.display(),
                error
            ))
        })?;
        let record = serde_json::from_slice(&bytes).map_err(|error| {
            CoreError::service(format!(
                "Failed to parse goal current file: path={} error={}",
                path.display(),
                error
            ))
        })?;
        Ok(Some(record))
    }

    pub async fn save_current(
        &self,
        workspace_path: &Path,
        session_id: &str,
        record: &GoalRecord,
    ) -> CoreResult<()> {
        let path = self.current_path(workspace_path, session_id);
        self.write_json_atomic(&path, record).await
    }

    pub async fn clear_current(&self, workspace_path: &Path, session_id: &str) -> CoreResult<()> {
        let path = self.current_path(workspace_path, session_id);
        if path.exists() {
            fs::remove_file(&path).await.map_err(|error| {
                CoreError::service(format!(
                    "Failed to remove goal current file: path={} error={}",
                    path.display(),
                    error
                ))
            })?;
        }
        Ok(())
    }

    pub async fn save_snapshot(
        &self,
        workspace_path: &Path,
        session_id: &str,
        record: &GoalRecord,
    ) -> CoreResult<()> {
        let path = self
            .snapshots_dir(workspace_path, session_id)
            .join(format!("{}.md", record.goal_id));
        self.write_text_atomic(&path, &record.context.frozen_context_markdown)
            .await
    }

    pub async fn save_extraction_run(
        &self,
        workspace_path: &Path,
        session_id: &str,
        run: &GoalExtractionRun,
    ) -> CoreResult<()> {
        let path = self
            .extractions_dir(workspace_path, session_id)
            .join(format!("{}.json", run.extraction_id));
        self.write_json_atomic(&path, run).await
    }

    pub async fn save_judge_run(
        &self,
        workspace_path: &Path,
        session_id: &str,
        run: &GoalJudgeRun,
    ) -> CoreResult<()> {
        let path = self
            .judges_dir(workspace_path, session_id)
            .join(format!("{}.json", run.judge_id));
        self.write_json_atomic(&path, run).await
    }

    pub async fn append_event(
        &self,
        workspace_path: &Path,
        session_id: &str,
        event: &GoalStoreEvent,
    ) -> CoreResult<()> {
        let dir = self.goals_dir(workspace_path, session_id);
        fs::create_dir_all(&dir).await.map_err(|error| {
            CoreError::service(format!(
                "Failed to create goal directory: path={} error={}",
                dir.display(),
                error
            ))
        })?;
        let path = self.events_path(workspace_path, session_id);
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .await
            .map_err(|error| {
                CoreError::service(format!(
                    "Failed to open goal event log: path={} error={}",
                    path.display(),
                    error
                ))
            })?;
        let mut value = serde_json::to_value(event).map_err(|error| {
            CoreError::service(format!("Failed to encode goal event: {}", error))
        })?;
        if let serde_json::Value::Object(ref mut map) = value {
            map.insert("atMs".to_string(), serde_json::json!(now_ms()));
        }
        let mut line = serde_json::to_vec(&value).map_err(|error| {
            CoreError::service(format!("Failed to encode goal event: {}", error))
        })?;
        line.push(b'\n');
        file.write_all(&line).await.map_err(|error| {
            CoreError::service(format!(
                "Failed to append goal event: path={} error={}",
                path.display(),
                error
            ))
        })
    }

    async fn write_json_atomic<T: Serialize + ?Sized>(
        &self,
        path: &Path,
        value: &T,
    ) -> CoreResult<()> {
        let body = serde_json::to_vec_pretty(value).map_err(|error| {
            CoreError::service(format!("Failed to encode goal file: {}", error))
        })?;
        self.write_bytes_atomic(path, &body).await
    }

    async fn write_text_atomic(&self, path: &Path, value: &str) -> CoreResult<()> {
        self.write_bytes_atomic(path, value.as_bytes()).await
    }

    async fn write_bytes_atomic(&self, path: &Path, body: &[u8]) -> CoreResult<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await.map_err(|error| {
                CoreError::service(format!(
                    "Failed to create goal file directory: path={} error={}",
                    parent.display(),
                    error
                ))
            })?;
        }
        let tmp_path = path.with_extension("tmp");
        fs::write(&tmp_path, body).await.map_err(|error| {
            CoreError::service(format!(
                "Failed to write temporary goal file: path={} error={}",
                tmp_path.display(),
                error
            ))
        })?;
        fs::rename(&tmp_path, path).await.map_err(|error| {
            CoreError::service(format!(
                "Failed to replace goal file: path={} error={}",
                path.display(),
                error
            ))
        })
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}
