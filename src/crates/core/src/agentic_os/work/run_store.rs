use std::collections::BTreeSet;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::error::{CoreError, CoreResult};

use super::execution_graph::{
    WorkBuilderIssue, WorkBuilderPreviewResult, WorkBuilderValidationResult, WorkRuntimeIssue,
    WorkRuntimeLog, WorkRuntimeRun,
};
use super::record::WorkRecord;
use super::types::{WorkLocator, WorkScope};

const RUN_FILE: &str = "run.json";
const WORK_INDEX_DIR: &str = "_work_index";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredRun {
    schema_version: u32,
    work_locator: WorkLocator,
    run: WorkRuntimeRun,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkExecutionIndex {
    schema_version: u32,
    run_ids: Vec<String>,
    runtime_issues: Vec<WorkRuntimeIssue>,
    runtime_logs: Vec<WorkRuntimeLog>,
    builder_preview_results: Vec<WorkBuilderPreviewResult>,
    builder_validation_results: Vec<WorkBuilderValidationResult>,
    builder_issues: Vec<WorkBuilderIssue>,
}

impl WorkExecutionIndex {
    fn from_record(record: &WorkRecord) -> Self {
        Self {
            schema_version: 1,
            run_ids: record
                .runtime_runs
                .iter()
                .map(|run| run.run_id.clone())
                .collect(),
            runtime_issues: record.runtime_issues.clone(),
            runtime_logs: record.runtime_logs.clone(),
            builder_preview_results: record.builder_preview_results.clone(),
            builder_validation_results: record.builder_validation_results.clone(),
            builder_issues: record.builder_issues.clone(),
        }
    }

    fn hydrate_observations(self, record: &mut WorkRecord) {
        record.runtime_issues = self.runtime_issues;
        record.runtime_logs = self.runtime_logs;
        record.builder_preview_results = self.builder_preview_results;
        record.builder_validation_results = self.builder_validation_results;
        record.builder_issues = self.builder_issues;
    }
}

#[derive(Debug, Clone)]
pub(super) struct FileRunStore {
    root: PathBuf,
}

impl FileRunStore {
    pub(super) fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn scope_dir(&self, scope: &WorkScope) -> PathBuf {
        match scope {
            WorkScope::Global => self.root.join("global"),
            WorkScope::Workspace { workspace_id } => {
                self.root.join("workspaces").join(workspace_id)
            }
        }
    }

    fn validate_id(label: &str, id: &str) -> CoreResult<()> {
        if id.trim().is_empty() || id == "." || id == ".." || id.contains('/') || id.contains('\\')
        {
            return Err(CoreError::validation(format!("invalid {label}")));
        }
        Ok(())
    }

    fn run_dir(&self, scope: &WorkScope, run_id: &str) -> CoreResult<PathBuf> {
        Self::validate_id("run_id", run_id)?;
        Ok(self.scope_dir(scope).join(run_id))
    }

    fn run_path(&self, scope: &WorkScope, run_id: &str) -> CoreResult<PathBuf> {
        Ok(self.run_dir(scope, run_id)?.join(RUN_FILE))
    }

    fn index_path(&self, locator: &WorkLocator) -> CoreResult<PathBuf> {
        Self::validate_id("work_id", locator.work_id.as_str())?;
        Ok(self
            .scope_dir(&locator.scope)
            .join(WORK_INDEX_DIR)
            .join(format!("{}.json", locator.work_id.as_str())))
    }

    async fn load_index(&self, locator: &WorkLocator) -> CoreResult<Option<WorkExecutionIndex>> {
        let path = self.index_path(locator)?;
        let bytes = match tokio::fs::read(&path).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let index: WorkExecutionIndex = serde_json::from_slice(&bytes)?;
        if index.schema_version != 1 {
            return Err(CoreError::validation(format!(
                "unsupported Work execution index schema: {}",
                index.schema_version
            )));
        }
        Ok(Some(index))
    }

    async fn load_run(&self, locator: &WorkLocator, run_id: &str) -> CoreResult<WorkRuntimeRun> {
        let path = self.run_path(&locator.scope, run_id)?;
        let bytes = tokio::fs::read(&path).await.map_err(|error| {
            CoreError::io(format!(
                "failed to read indexed Run '{}': {}",
                path.display(),
                error
            ))
        })?;
        let stored: StoredRun = serde_json::from_slice(&bytes)?;
        if stored.schema_version != 1 {
            return Err(CoreError::validation(format!(
                "unsupported Run schema: {}",
                stored.schema_version
            )));
        }
        if &stored.work_locator != locator || stored.run.run_id != run_id {
            return Err(CoreError::validation(format!(
                "Run locator does not match its execution index: {}",
                path.display()
            )));
        }
        Ok(stored.run)
    }

    pub(super) async fn hydrate(&self, record: &mut WorkRecord) -> CoreResult<()> {
        let locator = record.locator();
        let Some(index) = self.load_index(&locator).await? else {
            return Ok(());
        };
        let mut runs = Vec::with_capacity(index.run_ids.len());
        for run_id in &index.run_ids {
            runs.push(self.load_run(&locator, run_id).await?);
        }
        record.runtime_runs = runs;
        index.hydrate_observations(record);
        Ok(())
    }

    pub(super) async fn save(&self, record: &WorkRecord) -> CoreResult<()> {
        let locator = record.locator();
        let previous_run_ids = self
            .load_index(&locator)
            .await?
            .map(|index| index.run_ids.into_iter().collect::<BTreeSet<_>>())
            .unwrap_or_default();
        let current_run_ids = record
            .runtime_runs
            .iter()
            .map(|run| run.run_id.clone())
            .collect::<BTreeSet<_>>();

        for run in &record.runtime_runs {
            let path = self.run_path(&locator.scope, &run.run_id)?;
            if let Ok(bytes) = tokio::fs::read(&path).await {
                let existing: StoredRun = serde_json::from_slice(&bytes)?;
                if existing.work_locator != locator {
                    return Err(CoreError::validation(format!(
                        "run_id is already owned by another Work: {}",
                        run.run_id
                    )));
                }
            }
            let stored = StoredRun {
                schema_version: 1,
                work_locator: locator.clone(),
                run: run.clone(),
            };
            write_atomic(&path, &serde_json::to_vec_pretty(&stored)?).await?;
        }

        for stale_run_id in previous_run_ids.difference(&current_run_ids) {
            remove_dir_if_exists(&self.run_dir(&locator.scope, stale_run_id)?).await?;
        }

        let index_path = self.index_path(&locator)?;
        write_atomic(
            &index_path,
            &serde_json::to_vec_pretty(&WorkExecutionIndex::from_record(record))?,
        )
        .await
    }

    pub(super) async fn delete(&self, locator: &WorkLocator) -> CoreResult<()> {
        if let Some(index) = self.load_index(locator).await? {
            for run_id in index.run_ids {
                remove_dir_if_exists(&self.run_dir(&locator.scope, &run_id)?).await?;
            }
        }
        match tokio::fs::remove_file(self.index_path(locator)?).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

async fn remove_dir_if_exists(path: &Path) -> CoreResult<()> {
    match tokio::fs::remove_dir_all(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

async fn write_atomic(path: &Path, content: &[u8]) -> CoreResult<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(RUN_FILE);
    let temp_path = path.with_file_name(format!(
        ".{file_name}.{}.tmp",
        uuid::Uuid::new_v4().simple()
    ));
    let result = async {
        let mut temp_file = tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)
            .await?;
        temp_file.write_all(content).await?;
        temp_file.flush().await?;
        temp_file.sync_all().await?;
        drop(temp_file);
        replace_file(&temp_path, path).await
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temp_path).await;
    }
    result
}

#[cfg(windows)]
async fn replace_file(source: &Path, destination: &Path) -> CoreResult<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(not(windows))]
async fn replace_file(source: &Path, destination: &Path) -> CoreResult<()> {
    tokio::fs::rename(source, destination).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::FileRunStore;
    use crate::agentic_os::work::{WorkId, WorkLocator, WorkScope};
    use std::path::PathBuf;

    #[test]
    fn run_records_are_addressed_by_run_id_not_work_id() {
        let store = FileRunStore::new(PathBuf::from("runs"));
        let locator = WorkLocator {
            scope: WorkScope::Workspace {
                workspace_id: "ws_contract".to_string(),
            },
            work_id: WorkId::parse("work_contract").expect("valid Work ID"),
        };

        assert_eq!(
            store
                .run_path(&locator.scope, "run_contract")
                .expect("Run path"),
            PathBuf::from("runs")
                .join("workspaces")
                .join("ws_contract")
                .join("run_contract")
                .join("run.json")
        );
        assert_eq!(
            store.index_path(&locator).expect("Work index path"),
            PathBuf::from("runs")
                .join("workspaces")
                .join("ws_contract")
                .join("_work_index")
                .join("work_contract.json")
        );
    }
}
