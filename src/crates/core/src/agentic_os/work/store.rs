use std::collections::{BTreeMap, HashMap};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex, RwLock};

use crate::error::{CoreError, CoreResult};
use crate::infrastructure::try_get_path_manager_arc;

use super::record::WorkRecord;
use super::run_store::FileRunStore;
use super::types::{WorkLocator, WorkScope};
use super::work_object::{WorkObjectLocator, WorkObjectRecord};

const INDEX_FILE: &str = "index.json";
const INVALID_RECORD_DIR: &str = "_invalid";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkIndex {
    schema_version: u32,
    work_ids: Vec<String>,
}

impl Default for WorkIndex {
    fn default() -> Self {
        Self {
            schema_version: 1,
            work_ids: Vec::new(),
        }
    }
}

static WORK_FILE_LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();

async fn work_file_lock(path: &Path) -> Arc<Mutex<()>> {
    let locks = WORK_FILE_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = locks.lock().await;
    locks
        .entry(path.to_path_buf())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

fn temp_path_for(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("work.json");
    path.with_file_name(format!(
        ".{file_name}.{}.tmp",
        uuid::Uuid::new_v4().simple()
    ))
}

async fn write_atomic(path: &Path, content: &[u8]) -> CoreResult<()> {
    let temp_path = temp_path_for(path);
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

#[async_trait]
pub trait WorkObjectStore: Send + Sync {
    async fn list_work_objects(&self) -> CoreResult<Vec<WorkObjectRecord>>;
    async fn get_work_object(
        &self,
        locator: &WorkObjectLocator,
    ) -> CoreResult<Option<WorkObjectRecord>>;
    async fn put_work_object(&self, record: &WorkObjectRecord) -> CoreResult<()>;
    async fn delete_work_object(&self, locator: &WorkObjectLocator) -> CoreResult<bool>;
}

#[async_trait]
pub trait WorkStore: WorkObjectStore + Send + Sync {
    async fn list(&self) -> CoreResult<Vec<WorkRecord>>;
    async fn get(&self, locator: &WorkLocator) -> CoreResult<Option<WorkRecord>>;
    async fn put(&self, record: &WorkRecord) -> CoreResult<()>;
    async fn delete(&self, locator: &WorkLocator) -> CoreResult<bool>;
}

pub fn default_work_store() -> CoreResult<Arc<dyn WorkStore>> {
    let path_manager = try_get_path_manager_arc()?;
    Ok(Arc::new(FileWorkStore::new(
        path_manager.works_root(),
        path_manager.runs_root(),
    )))
}

#[derive(Debug, Clone)]
pub struct FileWorkStore {
    root: PathBuf,
    run_store: FileRunStore,
}

impl FileWorkStore {
    pub fn new(root: PathBuf, runs_root: PathBuf) -> Self {
        Self {
            root,
            run_store: FileRunStore::new(runs_root),
        }
    }

    fn validate_workspace_id(workspace_id: &str) -> CoreResult<()> {
        if !workspace_id.starts_with("ws_")
            || workspace_id.len() <= 3
            || workspace_id == "."
            || workspace_id == ".."
            || workspace_id.contains('/')
            || workspace_id.contains('\\')
        {
            return Err(CoreError::validation("invalid workspace_id"));
        }
        Ok(())
    }

    fn scope_dir(&self, scope: &WorkScope) -> CoreResult<PathBuf> {
        match scope {
            WorkScope::Global => Ok(self.root.join("global")),
            WorkScope::Workspace { workspace_id } => {
                Self::validate_workspace_id(workspace_id)?;
                Ok(self.root.join("workspaces").join(workspace_id))
            }
        }
    }

    fn record_path(&self, locator: &WorkLocator) -> CoreResult<PathBuf> {
        Ok(self
            .scope_dir(&locator.scope)?
            .join(format!("{}.json", locator.work_id.as_str())))
    }

    fn object_scope_dir(&self, scope: &WorkScope) -> CoreResult<PathBuf> {
        let root = self.root.join("objects");
        match scope {
            WorkScope::Global => Ok(root.join("global")),
            WorkScope::Workspace { workspace_id } => {
                Self::validate_workspace_id(workspace_id)?;
                Ok(root.join("workspaces").join(workspace_id))
            }
        }
    }

    fn object_record_path(&self, locator: &WorkObjectLocator) -> CoreResult<PathBuf> {
        Ok(self
            .object_scope_dir(&locator.scope)?
            .join(format!("{}.json", locator.object_id.as_str())))
    }

    async fn ensure_roots(&self) -> CoreResult<()> {
        tokio::fs::create_dir_all(self.root.join("global")).await?;
        tokio::fs::create_dir_all(self.root.join("workspaces")).await?;
        tokio::fs::create_dir_all(self.root.join("objects").join("global")).await?;
        tokio::fs::create_dir_all(self.root.join("objects").join("workspaces")).await?;
        Ok(())
    }

    async fn write_record(&self, path: &Path, record: &WorkRecord) -> CoreResult<()> {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let lock = work_file_lock(path).await;
        let _guard = lock.lock().await;
        write_atomic(path, &serde_json::to_vec_pretty(record)?).await
    }

    async fn remove_record(path: &Path) -> CoreResult<bool> {
        let lock = work_file_lock(path).await;
        let _guard = lock.lock().await;
        match tokio::fs::remove_file(path).await {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error.into()),
        }
    }

    async fn quarantine_invalid_record(&self, path: &Path, reason: &str) {
        let Some(file_name) = path.file_name() else {
            return;
        };
        let quarantine_dir = path.parent().unwrap_or(&self.root).join(INVALID_RECORD_DIR);
        if let Err(error) = tokio::fs::create_dir_all(&quarantine_dir).await {
            log::warn!(
                "Failed to create invalid Work quarantine: dir={} error={}",
                quarantine_dir.display(),
                error
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
                "Quarantined invalid Work record: source={} target={} reason={}",
                path.display(),
                target.display(),
                reason
            ),
            Err(error) => log::warn!(
                "Failed to quarantine invalid Work record: source={} target={} reason={} error={}",
                path.display(),
                target.display(),
                reason,
                error
            ),
        }
    }

    async fn load_record(
        &self,
        path: &Path,
        expected_scope: &WorkScope,
    ) -> CoreResult<Option<WorkRecord>> {
        let lock = work_file_lock(path).await;
        let _guard = lock.lock().await;
        let content = match tokio::fs::read_to_string(path).await {
            Ok(content) => content,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        drop(_guard);

        let mut record = match serde_json::from_str::<WorkRecord>(&content) {
            Ok(record) => record,
            Err(error) => {
                self.quarantine_invalid_record(path, &error.to_string())
                    .await;
                return Ok(None);
            }
        };
        if &record.scope != expected_scope {
            self.quarantine_invalid_record(path, "record scope does not match its directory")
                .await;
            return Ok(None);
        }
        self.run_store.hydrate(&mut record).await?;
        Ok(Some(record))
    }

    async fn load_scope_records(
        &self,
        scope: &WorkScope,
        directory: &Path,
    ) -> CoreResult<Vec<WorkRecord>> {
        let mut records = Vec::new();
        let mut entries = match tokio::fs::read_dir(directory).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(records),
            Err(error) => return Err(error.into()),
        };
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.file_name().and_then(|value| value.to_str()) == Some(INDEX_FILE)
                || path.extension().and_then(|value| value.to_str()) != Some("json")
            {
                continue;
            }
            if let Some(record) = self.load_record(&path, scope).await? {
                records.push(record);
            }
        }
        Ok(records)
    }

    async fn load_work_object(
        &self,
        path: &Path,
        expected_scope: &WorkScope,
    ) -> CoreResult<Option<WorkObjectRecord>> {
        let lock = work_file_lock(path).await;
        let _guard = lock.lock().await;
        let content = match tokio::fs::read_to_string(path).await {
            Ok(content) => content,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        drop(_guard);

        let record = match serde_json::from_str::<WorkObjectRecord>(&content) {
            Ok(record) => record,
            Err(error) => {
                self.quarantine_invalid_record(path, &error.to_string())
                    .await;
                return Ok(None);
            }
        };
        if &record.scope != expected_scope {
            self.quarantine_invalid_record(path, "WorkObject scope does not match its directory")
                .await;
            return Ok(None);
        }
        Ok(Some(record))
    }

    async fn load_work_object_scope_records(
        &self,
        scope: &WorkScope,
        directory: &Path,
    ) -> CoreResult<Vec<WorkObjectRecord>> {
        let mut records = Vec::new();
        let mut entries = match tokio::fs::read_dir(directory).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(records),
            Err(error) => return Err(error.into()),
        };
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Some(record) = self.load_work_object(&path, scope).await? {
                records.push(record);
            }
        }
        Ok(records)
    }

    async fn update_index(&self, scope: &WorkScope) -> CoreResult<()> {
        let directory = self.scope_dir(scope)?;
        tokio::fs::create_dir_all(&directory).await?;
        let mut work_ids = self
            .load_scope_records(scope, &directory)
            .await?
            .into_iter()
            .map(|record| record.id.into_string())
            .collect::<Vec<_>>();
        work_ids.sort();
        let index = WorkIndex {
            schema_version: 1,
            work_ids,
        };
        let path = directory.join(INDEX_FILE);
        let lock = work_file_lock(&path).await;
        let _guard = lock.lock().await;
        write_atomic(&path, &serde_json::to_vec_pretty(&index)?).await
    }
}

#[async_trait]
impl WorkObjectStore for FileWorkStore {
    async fn list_work_objects(&self) -> CoreResult<Vec<WorkObjectRecord>> {
        self.ensure_roots().await?;
        let object_root = self.root.join("objects");
        let mut records = self
            .load_work_object_scope_records(&WorkScope::Global, &object_root.join("global"))
            .await?;

        let workspace_root = object_root.join("workspaces");
        let mut workspace_entries = tokio::fs::read_dir(&workspace_root).await?;
        while let Some(entry) = workspace_entries.next_entry().await? {
            if !entry.file_type().await?.is_dir() {
                continue;
            }
            let workspace_id = entry.file_name().to_string_lossy().into_owned();
            Self::validate_workspace_id(&workspace_id)?;
            let scope = WorkScope::Workspace { workspace_id };
            records.extend(
                self.load_work_object_scope_records(&scope, &entry.path())
                    .await?,
            );
        }
        records.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(records)
    }

    async fn get_work_object(
        &self,
        locator: &WorkObjectLocator,
    ) -> CoreResult<Option<WorkObjectRecord>> {
        self.ensure_roots().await?;
        self.load_work_object(&self.object_record_path(locator)?, &locator.scope)
            .await
    }

    async fn put_work_object(&self, record: &WorkObjectRecord) -> CoreResult<()> {
        self.ensure_roots().await?;
        let path = self.object_record_path(&record.locator())?;
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let lock = work_file_lock(&path).await;
        let _guard = lock.lock().await;
        write_atomic(&path, &serde_json::to_vec_pretty(record)?).await
    }

    async fn delete_work_object(&self, locator: &WorkObjectLocator) -> CoreResult<bool> {
        self.ensure_roots().await?;
        Self::remove_record(&self.object_record_path(locator)?).await
    }
}

#[async_trait]
impl WorkStore for FileWorkStore {
    async fn list(&self) -> CoreResult<Vec<WorkRecord>> {
        self.ensure_roots().await?;
        let mut records = self
            .load_scope_records(&WorkScope::Global, &self.root.join("global"))
            .await?;

        let workspace_root = self.root.join("workspaces");
        let mut workspace_entries = tokio::fs::read_dir(&workspace_root).await?;
        while let Some(entry) = workspace_entries.next_entry().await? {
            if !entry.file_type().await?.is_dir() {
                continue;
            }
            let workspace_id = entry.file_name().to_string_lossy().into_owned();
            Self::validate_workspace_id(&workspace_id)?;
            let scope = WorkScope::Workspace { workspace_id };
            records.extend(self.load_scope_records(&scope, &entry.path()).await?);
        }

        records.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(records)
    }

    async fn get(&self, locator: &WorkLocator) -> CoreResult<Option<WorkRecord>> {
        self.ensure_roots().await?;
        let path = self.record_path(locator)?;
        self.load_record(&path, &locator.scope).await
    }

    async fn put(&self, record: &WorkRecord) -> CoreResult<()> {
        self.ensure_roots().await?;
        let locator = record.locator();
        let path = self.record_path(&locator)?;
        self.write_record(&path, record).await?;
        self.run_store.save(record).await?;
        self.update_index(&record.scope).await
    }

    async fn delete(&self, locator: &WorkLocator) -> CoreResult<bool> {
        self.ensure_roots().await?;
        let deleted = Self::remove_record(&self.record_path(locator)?).await?;
        self.run_store.delete(locator).await?;
        self.update_index(&locator.scope).await?;
        Ok(deleted)
    }
}

#[derive(Debug, Default)]
pub struct MemoryWorkStore {
    records: RwLock<BTreeMap<WorkLocator, WorkRecord>>,
    object_records: RwLock<BTreeMap<WorkObjectLocator, WorkObjectRecord>>,
}

impl MemoryWorkStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl WorkObjectStore for MemoryWorkStore {
    async fn list_work_objects(&self) -> CoreResult<Vec<WorkObjectRecord>> {
        let records = self.object_records.read().await;
        let mut values = records.values().cloned().collect::<Vec<_>>();
        values.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(values)
    }

    async fn get_work_object(
        &self,
        locator: &WorkObjectLocator,
    ) -> CoreResult<Option<WorkObjectRecord>> {
        Ok(self.object_records.read().await.get(locator).cloned())
    }

    async fn put_work_object(&self, record: &WorkObjectRecord) -> CoreResult<()> {
        self.object_records
            .write()
            .await
            .insert(record.locator(), record.clone());
        Ok(())
    }

    async fn delete_work_object(&self, locator: &WorkObjectLocator) -> CoreResult<bool> {
        Ok(self.object_records.write().await.remove(locator).is_some())
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

    async fn get(&self, locator: &WorkLocator) -> CoreResult<Option<WorkRecord>> {
        Ok(self.records.read().await.get(locator).cloned())
    }

    async fn put(&self, record: &WorkRecord) -> CoreResult<()> {
        self.records
            .write()
            .await
            .insert(record.locator(), record.clone());
        Ok(())
    }

    async fn delete(&self, locator: &WorkLocator) -> CoreResult<bool> {
        Ok(self.records.write().await.remove(locator).is_some())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agentic_os::work::{
        WorkAppRef, WorkId, WorkKind, WorkObjectRecord, WorkSubject, WorkSurfaceRef, WorkVisibility,
    };

    fn temp_work_store_root(test_name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "sparo-work-store-{}-{}",
            test_name,
            uuid::Uuid::new_v4().simple()
        ))
    }

    fn test_record(scope: WorkScope) -> WorkRecord {
        WorkRecord::new(
            WorkId::generate(),
            WorkKind::OneShot,
            "Persistence test".to_string(),
            "Keep the Work record readable".to_string(),
            WorkVisibility::Primary,
            WorkSubject::Goal,
            Vec::new(),
            scope,
            WorkSurfaceRef::OsAgentHome {
                agentic_os_session_id: None,
            },
            1,
        )
    }

    #[tokio::test]
    async fn stores_global_and_workspace_records_in_separate_user_roots() {
        let root = temp_work_store_root("scope-roots");
        let store = FileWorkStore::new(root.clone(), root.join("_runs"));
        let global = test_record(WorkScope::Global);
        let workspace = test_record(WorkScope::Workspace {
            workspace_id: "ws_test".to_string(),
        });

        store.put(&global).await.unwrap();
        store.put(&workspace).await.unwrap();

        assert!(root
            .join("global")
            .join(format!("{}.json", global.id.as_str()))
            .exists());
        assert!(root
            .join("workspaces")
            .join("ws_test")
            .join(format!("{}.json", workspace.id.as_str()))
            .exists());
        assert_eq!(
            store.get(&workspace.locator()).await.unwrap(),
            Some(workspace.clone())
        );
        assert!(store.delete(&global.locator()).await.unwrap());

        let _ = tokio::fs::remove_dir_all(root).await;
    }

    #[tokio::test]
    async fn rejects_a_locator_that_points_at_another_scope() {
        let root = temp_work_store_root("wrong-scope");
        let store = FileWorkStore::new(root.clone(), root.join("_runs"));
        let record = test_record(WorkScope::Global);
        store.put(&record).await.unwrap();

        let wrong = WorkLocator {
            scope: WorkScope::Workspace {
                workspace_id: "ws_test".to_string(),
            },
            work_id: record.id.clone(),
        };
        assert!(store.get(&wrong).await.unwrap().is_none());
        assert!(store.get(&record.locator()).await.unwrap().is_some());

        let _ = tokio::fs::remove_dir_all(root).await;
    }

    #[tokio::test]
    async fn persists_work_objects_outside_work_record_files() {
        let root = temp_work_store_root("work-objects");
        let store = FileWorkStore::new(root.clone(), root.join("_runs"));
        let object = WorkObjectRecord::new(
            "deck".to_string(),
            "Design review".to_string(),
            WorkScope::Workspace {
                workspace_id: "ws_test".to_string(),
            },
            Some("D:/workspace/test".to_string()),
            WorkAppRef::product_app("ppt-live", "ppt-live", "release-1", "config-1", "1"),
            10,
        );

        store.put_work_object(&object).await.unwrap();

        assert!(root
            .join("objects")
            .join("workspaces")
            .join("ws_test")
            .join(format!("{}.json", object.id.as_str()))
            .exists());
        assert_eq!(
            store.get_work_object(&object.locator()).await.unwrap(),
            Some(object.clone())
        );
        assert_eq!(store.list_work_objects().await.unwrap(), vec![object]);

        let _ = tokio::fs::remove_dir_all(root).await;
    }
}
