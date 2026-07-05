use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::RwLock;

use crate::infrastructure::try_get_path_manager_arc;
use crate::error::CoreResult;

use super::ids::WorkId;
use super::record::WorkRecord;

const INVALID_RECORD_DIR: &str = "_invalid";

#[async_trait]
pub trait WorkStore: Send + Sync {
    async fn list(&self) -> CoreResult<Vec<WorkRecord>>;
    async fn get(&self, id: &WorkId) -> CoreResult<Option<WorkRecord>>;
    async fn put(&self, record: &WorkRecord) -> CoreResult<()>;
    async fn delete(&self, id: &WorkId) -> CoreResult<bool>;
}

pub fn default_work_store() -> CoreResult<Arc<dyn WorkStore>> {
    let path_manager = try_get_path_manager_arc()?;
    Ok(Arc::new(FileWorkStore::new(
        path_manager.agentic_os_runtime_root().join("works"),
    )))
}

#[derive(Debug, Clone)]
pub struct FileWorkStore {
    root: PathBuf,
}

impl FileWorkStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn path_for(&self, id: &WorkId) -> PathBuf {
        self.root.join(format!("{}.json", id.as_str()))
    }

    async fn ensure_root(&self) -> CoreResult<()> {
        tokio::fs::create_dir_all(&self.root).await?;
        Ok(())
    }

    async fn quarantine_invalid_record(&self, path: &Path, error: &serde_json::Error) {
        let Some(file_name) = path.file_name() else {
            log::warn!(
                "Skipping invalid work record with unreadable file name: path={} error={}",
                path.display(),
                error
            );
            return;
        };

        let quarantine_dir = self.root.join(INVALID_RECORD_DIR);
        if let Err(create_error) = tokio::fs::create_dir_all(&quarantine_dir).await {
            log::warn!(
                "Failed to create invalid work record quarantine: dir={} error={}",
                quarantine_dir.display(),
                create_error
            );
            return;
        }

        let target = quarantine_dir.join(format!(
            "{}.invalid.{}",
            chrono::Utc::now().timestamp_millis(),
            file_name.to_string_lossy()
        ));
        match tokio::fs::rename(path, &target).await {
            Ok(()) => log::warn!(
                "Quarantined invalid work record: source={} target={} error={}",
                path.display(),
                target.display(),
                error
            ),
            Err(rename_error) => log::warn!(
                "Failed to quarantine invalid work record: source={} target={} parse_error={} rename_error={}",
                path.display(),
                target.display(),
                error,
                rename_error
            ),
        }
    }

    async fn load_record(&self, path: &Path) -> CoreResult<Option<WorkRecord>> {
        let content = tokio::fs::read_to_string(path).await?;
        match serde_json::from_str::<WorkRecord>(&content) {
            Ok(record) => Ok(Some(record)),
            Err(error) => {
                self.quarantine_invalid_record(path, &error).await;
                Ok(None)
            }
        }
    }
}

#[async_trait]
impl WorkStore for FileWorkStore {
    async fn list(&self) -> CoreResult<Vec<WorkRecord>> {
        self.ensure_root().await?;
        let mut entries = tokio::fs::read_dir(&self.root).await?;
        let mut records = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Some(record) = self.load_record(&path).await? {
                records.push(record);
            }
        }
        records.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(records)
    }

    async fn get(&self, id: &WorkId) -> CoreResult<Option<WorkRecord>> {
        self.ensure_root().await?;
        let path = self.path_for(id);
        if !path.exists() {
            return Ok(None);
        }
        self.load_record(&path).await
    }

    async fn put(&self, record: &WorkRecord) -> CoreResult<()> {
        self.ensure_root().await?;
        let content = serde_json::to_string_pretty(record)?;
        tokio::fs::write(self.path_for(&record.id), content).await?;
        Ok(())
    }

    async fn delete(&self, id: &WorkId) -> CoreResult<bool> {
        self.ensure_root().await?;
        let path = self.path_for(id);
        match tokio::fs::remove_file(path).await {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_work_store_root(test_name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "sparo-work-store-{}-{}",
            test_name,
            uuid::Uuid::new_v4().simple()
        ))
    }

    #[tokio::test]
    async fn file_store_quarantines_invalid_records_instead_of_loading_legacy_shapes() {
        let root = temp_work_store_root("invalid-record");
        let store = FileWorkStore::new(root.clone());
        tokio::fs::create_dir_all(&root).await.unwrap();
        let legacy_path = root.join("work_legacy.json");
        tokio::fs::write(
            &legacy_path,
            r#"{
              "id": "work_legacy",
              "kind": "app_workflow",
              "title": "Legacy",
              "objective": "Legacy",
              "status": "active",
              "visibility": "primary",
              "subject": {
                "kind": "app",
                "app": { "kind": "surface_component", "app_id": "legacy-surface-component" },
                "intent": "run"
              },
              "app_refs": [],
              "scope": { "kind": "system" },
              "primary_surface": { "kind": "surface_component", "app_id": "legacy-surface-component" },
              "surfaces": [],
              "lifecycle": { "events": [] },
              "session_refs": [],
              "execution_bindings": [],
              "artifact_refs": [],
              "memory_refs": [],
              "created_at": 1,
              "updated_at": 1
            }"#,
        )
        .await
        .unwrap();

        let records = store.list().await.unwrap();
        assert!(records.is_empty());
        assert!(!legacy_path.exists());

        let mut invalid_entries = tokio::fs::read_dir(root.join(INVALID_RECORD_DIR))
            .await
            .unwrap();
        assert!(invalid_entries.next_entry().await.unwrap().is_some());

        let _ = tokio::fs::remove_dir_all(root).await;
    }
}

#[derive(Debug, Default)]
pub struct MemoryWorkStore {
    records: RwLock<BTreeMap<WorkId, WorkRecord>>,
}

impl MemoryWorkStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl WorkStore for MemoryWorkStore {
    async fn list(&self) -> CoreResult<Vec<WorkRecord>> {
        let records = self.records.read().await;
        let mut values = records.values().cloned().collect::<Vec<_>>();
        values.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(values)
    }

    async fn get(&self, id: &WorkId) -> CoreResult<Option<WorkRecord>> {
        Ok(self.records.read().await.get(id).cloned())
    }

    async fn put(&self, record: &WorkRecord) -> CoreResult<()> {
        self.records
            .write()
            .await
            .insert(record.id.clone(), record.clone());
        Ok(())
    }

    async fn delete(&self, id: &WorkId) -> CoreResult<bool> {
        Ok(self.records.write().await.remove(id).is_some())
    }
}
