use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::RwLock;

use crate::infrastructure::try_get_path_manager_arc;
use crate::util::errors::{BitFunError, BitFunResult};

use super::ids::WorkId;
use super::record::WorkRecord;

#[async_trait]
pub trait WorkStore: Send + Sync {
    async fn list(&self) -> BitFunResult<Vec<WorkRecord>>;
    async fn get(&self, id: &WorkId) -> BitFunResult<Option<WorkRecord>>;
    async fn put(&self, record: &WorkRecord) -> BitFunResult<()>;
}

pub fn default_work_store() -> BitFunResult<Arc<dyn WorkStore>> {
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

    async fn ensure_root(&self) -> BitFunResult<()> {
        tokio::fs::create_dir_all(&self.root).await?;
        Ok(())
    }
}

#[async_trait]
impl WorkStore for FileWorkStore {
    async fn list(&self) -> BitFunResult<Vec<WorkRecord>> {
        self.ensure_root().await?;
        let mut entries = tokio::fs::read_dir(&self.root).await?;
        let mut records = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let content = tokio::fs::read_to_string(&path).await?;
            let record: WorkRecord = serde_json::from_str(&content).map_err(|error| {
                BitFunError::parse(format!(
                    "Failed to parse WorkRecord {}: {}",
                    path.display(),
                    error
                ))
            })?;
            records.push(record);
        }
        records.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(records)
    }

    async fn get(&self, id: &WorkId) -> BitFunResult<Option<WorkRecord>> {
        self.ensure_root().await?;
        let path = self.path_for(id);
        if !path.exists() {
            return Ok(None);
        }
        let content = tokio::fs::read_to_string(&path).await?;
        let record = serde_json::from_str(&content)?;
        Ok(Some(record))
    }

    async fn put(&self, record: &WorkRecord) -> BitFunResult<()> {
        self.ensure_root().await?;
        let content = serde_json::to_string_pretty(record)?;
        tokio::fs::write(self.path_for(&record.id), content).await?;
        Ok(())
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
    async fn list(&self) -> BitFunResult<Vec<WorkRecord>> {
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

    async fn get(&self, id: &WorkId) -> BitFunResult<Option<WorkRecord>> {
        Ok(self.records.read().await.get(id).cloned())
    }

    async fn put(&self, record: &WorkRecord) -> BitFunResult<()> {
        self.records
            .write()
            .await
            .insert(record.id.clone(), record.clone());
        Ok(())
    }
}
