use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{json, Value};

use crate::agentic_os::work::WorkId;
use crate::infrastructure::PathManager;
use crate::error::{CoreError, CoreResult};

const STORAGE_JSON: &str = "storage.json";
const READINESS_PROBE_KEY: &str = "__sparo_readiness_probe__";

#[derive(Debug, Clone)]
pub struct ProductAppRuntimeStorage {
    path_manager: Arc<PathManager>,
}

impl ProductAppRuntimeStorage {
    pub fn new(path_manager: Arc<PathManager>) -> Self {
        Self { path_manager }
    }

    pub fn runtime_dir(
        &self,
        work_id: &WorkId,
        runtime_instance_id: &str,
    ) -> CoreResult<PathBuf> {
        validate_runtime_instance_id(runtime_instance_id)?;
        Ok(self
            .path_manager
            .agentic_os_work_runtime_dir(work_id.as_str(), runtime_instance_id))
    }

    pub async fn ensure_runtime_dir(
        &self,
        work_id: &WorkId,
        runtime_instance_id: &str,
    ) -> CoreResult<PathBuf> {
        let dir = self.runtime_dir(work_id, runtime_instance_id)?;
        tokio::fs::create_dir_all(&dir).await.map_err(|error| {
            CoreError::io(format!(
                "Failed to create Product App runtime dir {}: {}",
                dir.display(),
                error
            ))
        })?;
        Ok(dir)
    }

    pub async fn get_storage(
        &self,
        work_id: &WorkId,
        runtime_instance_id: &str,
        key: &str,
    ) -> CoreResult<Value> {
        let storage = self.load_storage(work_id, runtime_instance_id).await?;
        Ok(storage.get(key).cloned().unwrap_or(Value::Null))
    }

    pub async fn set_storage(
        &self,
        work_id: &WorkId,
        runtime_instance_id: &str,
        key: &str,
        value: Value,
    ) -> CoreResult<()> {
        let dir = self
            .ensure_runtime_dir(work_id, runtime_instance_id)
            .await?;
        let mut current = self.load_storage_from_dir(&dir).await?;
        let obj = current.as_object_mut().ok_or_else(|| {
            CoreError::validation("Product App runtime storage is not an object".to_string())
        })?;
        obj.insert(key.to_string(), value);
        self.write_storage_to_dir(&dir, &current).await
    }

    pub async fn probe_readiness(
        &self,
        work_id: &WorkId,
        runtime_instance_id: &str,
    ) -> CoreResult<Value> {
        let dir = self
            .ensure_runtime_dir(work_id, runtime_instance_id)
            .await?;
        let mut current = self.load_storage_from_dir(&dir).await?;
        let obj = current.as_object_mut().ok_or_else(|| {
            CoreError::validation("Product App runtime storage is not an object".to_string())
        })?;
        let previous_value = obj.get(READINESS_PROBE_KEY).cloned();
        let had_previous_value = previous_value.is_some();
        let probe_value = json!({
            "kind": "product-app-runtime-readiness-probe",
            "version": 1,
        });

        obj.insert(READINESS_PROBE_KEY.to_string(), probe_value.clone());
        self.write_storage_to_dir(&dir, &current).await?;
        let read_after_write = self
            .get_storage(work_id, runtime_instance_id, READINESS_PROBE_KEY)
            .await?;
        let write_verified = read_after_write == probe_value;
        let read_verified = read_after_write.get("kind").and_then(Value::as_str)
            == Some("product-app-runtime-readiness-probe");

        let mut cleanup_storage = self.load_storage_from_dir(&dir).await?;
        let cleanup_obj = cleanup_storage.as_object_mut().ok_or_else(|| {
            CoreError::validation("Product App runtime storage is not an object".to_string())
        })?;
        if let Some(value) = previous_value.clone() {
            cleanup_obj.insert(READINESS_PROBE_KEY.to_string(), value);
        } else {
            cleanup_obj.remove(READINESS_PROBE_KEY);
        }
        self.write_storage_to_dir(&dir, &cleanup_storage).await?;
        let read_after_cleanup = self
            .get_storage(work_id, runtime_instance_id, READINESS_PROBE_KEY)
            .await?;
        let delete_verified = if let Some(value) = previous_value {
            read_after_cleanup == value
        } else {
            read_after_cleanup.is_null()
        };

        Ok(json!({
            "available": write_verified && read_verified && delete_verified,
            "scope": "work-runtime",
            "probeKey": READINESS_PROBE_KEY,
            "writeVerified": write_verified,
            "readVerified": read_verified,
            "deleteVerified": delete_verified,
            "preservedPreviousValue": had_previous_value,
        }))
    }

    pub fn probe_storage_scope(
        &self,
        work_id: &WorkId,
        runtime_instance_id: &str,
    ) -> CoreResult<Value> {
        let _dir = self.runtime_dir(work_id, runtime_instance_id)?;
        Ok(json!({
            "available": true,
            "scope": "work-runtime",
        }))
    }

    async fn load_storage(
        &self,
        work_id: &WorkId,
        runtime_instance_id: &str,
    ) -> CoreResult<Value> {
        let dir = self.runtime_dir(work_id, runtime_instance_id)?;
        self.load_storage_from_dir(&dir).await
    }

    async fn load_storage_from_dir(&self, dir: &Path) -> CoreResult<Value> {
        let path = storage_path(dir);
        if !path.exists() {
            return Ok(json!({}));
        }
        let content = tokio::fs::read_to_string(&path).await.map_err(|error| {
            CoreError::io(format!(
                "Failed to read Product App runtime storage {}: {}",
                path.display(),
                error
            ))
        })?;
        serde_json::from_str(&content).map_err(|error| {
            CoreError::parse(format!(
                "Invalid Product App runtime storage {}: {}",
                path.display(),
                error
            ))
        })
    }

    async fn write_storage_to_dir(&self, dir: &Path, value: &Value) -> CoreResult<()> {
        let content = serde_json::to_string_pretty(value).map_err(CoreError::from)?;
        tokio::fs::write(storage_path(dir), content)
            .await
            .map_err(|error| {
                CoreError::io(format!(
                    "Failed to write Product App runtime storage {}: {}",
                    storage_path(dir).display(),
                    error
                ))
            })
    }
}

fn storage_path(runtime_dir: &Path) -> PathBuf {
    runtime_dir.join(STORAGE_JSON)
}

fn validate_runtime_instance_id(value: &str) -> CoreResult<()> {
    if value.trim().is_empty() {
        return Err(CoreError::validation(
            "runtime_instance_id cannot be empty".to_string(),
        ));
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return Err(CoreError::validation(
            "runtime_instance_id can only contain ASCII letters, numbers, '-' and '_'".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime_storage(test_name: &str) -> ProductAppRuntimeStorage {
        let root = std::env::temp_dir().join(format!(
            "sparo-product-runtime-storage-{}-{}",
            test_name,
            uuid::Uuid::new_v4().simple()
        ));
        ProductAppRuntimeStorage::new(Arc::new(PathManager::with_user_root_for_tests(root)))
    }

    #[tokio::test]
    async fn runtime_storage_is_scoped_by_work_and_runtime_instance() {
        let storage = runtime_storage("scoped");
        let work_id = WorkId::parse("work_1").unwrap();

        storage
            .set_storage(&work_id, "runtime_one", "state", json!("one"))
            .await
            .unwrap();
        storage
            .set_storage(&work_id, "runtime_two", "state", json!("two"))
            .await
            .unwrap();

        assert_eq!(
            storage
                .get_storage(&work_id, "runtime_one", "state")
                .await
                .unwrap(),
            json!("one")
        );
        assert_eq!(
            storage
                .get_storage(&work_id, "runtime_two", "state")
                .await
                .unwrap(),
            json!("two")
        );
    }

    #[test]
    fn runtime_storage_rejects_path_unsafe_instance_ids() {
        let storage = runtime_storage("unsafe-instance-id");
        let work_id = WorkId::parse("work_1").unwrap();

        let error = storage
            .runtime_dir(&work_id, "product-app-runtime:work_1:runtime_1")
            .expect_err("colon-delimited owner ids must not be accepted as storage paths");

        assert!(error
            .to_string()
            .contains("runtime_instance_id can only contain"));
    }

    #[test]
    fn runtime_storage_probe_resolves_scope_without_creating_storage() {
        let storage = runtime_storage("probe");
        let work_id = WorkId::parse("work_1").unwrap();

        let probe = storage
            .probe_storage_scope(&work_id, "runtime_one")
            .expect("storage scope probe");

        assert_eq!(probe["available"], json!(true));
        assert_eq!(probe["scope"], json!("work-runtime"));
    }

    #[tokio::test]
    async fn runtime_storage_readiness_probe_verifies_write_read_delete_without_leaking_key() {
        let storage = runtime_storage("readiness-probe");
        let work_id = WorkId::parse("work_1").unwrap();

        let probe = storage
            .probe_readiness(&work_id, "runtime_one")
            .await
            .expect("readiness probe");

        assert_eq!(probe["available"], json!(true));
        assert_eq!(probe["writeVerified"], json!(true));
        assert_eq!(probe["readVerified"], json!(true));
        assert_eq!(probe["deleteVerified"], json!(true));
        assert_eq!(
            storage
                .get_storage(&work_id, "runtime_one", READINESS_PROBE_KEY)
                .await
                .unwrap(),
            Value::Null
        );
    }

    #[tokio::test]
    async fn runtime_storage_readiness_probe_restores_reserved_key_if_present() {
        let storage = runtime_storage("readiness-probe-restore");
        let work_id = WorkId::parse("work_1").unwrap();

        storage
            .set_storage(
                &work_id,
                "runtime_one",
                READINESS_PROBE_KEY,
                json!({ "existing": true }),
            )
            .await
            .unwrap();
        let probe = storage
            .probe_readiness(&work_id, "runtime_one")
            .await
            .expect("readiness probe");

        assert_eq!(probe["available"], json!(true));
        assert_eq!(probe["preservedPreviousValue"], json!(true));
        assert_eq!(
            storage
                .get_storage(&work_id, "runtime_one", READINESS_PROBE_KEY)
                .await
                .unwrap(),
            json!({ "existing": true })
        );
    }
}
