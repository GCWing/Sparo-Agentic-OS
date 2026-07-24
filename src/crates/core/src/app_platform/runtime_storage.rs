use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::agentic_os::work::{WorkId, WorkScope};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::PathManager;

const STORAGE_JSON: &str = "storage.json";
const READINESS_PROBE_KEY: &str = "__sparo_readiness_probe__";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppDataLocator {
    pub scope: WorkScope,
    pub app_id: String,
    pub work_id: WorkId,
}

#[derive(Debug, Clone)]
pub struct ProductAppRuntimeStorage {
    path_manager: Arc<PathManager>,
}

impl ProductAppRuntimeStorage {
    pub fn new(path_manager: Arc<PathManager>) -> Self {
        Self { path_manager }
    }

    pub fn work_dir(&self, locator: &AppDataLocator) -> CoreResult<PathBuf> {
        let app_root = match &locator.scope {
            WorkScope::Global => self.path_manager.global_app_data_dir(&locator.app_id)?,
            WorkScope::Workspace { workspace_id } => self
                .path_manager
                .workspace_app_data_dir(workspace_id, &locator.app_id)?,
        };
        Ok(app_root.join("works").join(locator.work_id.as_str()))
    }

    pub fn runtime_dir(
        &self,
        locator: &AppDataLocator,
        runtime_instance_id: &str,
    ) -> CoreResult<PathBuf> {
        validate_runtime_instance_id(runtime_instance_id)?;
        Ok(self
            .work_dir(locator)?
            .join("runtimes")
            .join(runtime_instance_id))
    }

    pub async fn ensure_runtime_dir(
        &self,
        locator: &AppDataLocator,
        runtime_instance_id: &str,
    ) -> CoreResult<PathBuf> {
        let dir = self.runtime_dir(locator, runtime_instance_id)?;
        tokio::fs::create_dir_all(&dir).await.map_err(|error| {
            CoreError::io(format!(
                "Failed to create Product App data directory {}: {}",
                dir.display(),
                error
            ))
        })?;
        Ok(dir)
    }

    pub async fn get_storage(
        &self,
        locator: &AppDataLocator,
        runtime_instance_id: &str,
        key: &str,
    ) -> CoreResult<Value> {
        let storage = self.load_storage(locator, runtime_instance_id).await?;
        Ok(storage.get(key).cloned().unwrap_or(Value::Null))
    }

    pub async fn set_storage(
        &self,
        locator: &AppDataLocator,
        runtime_instance_id: &str,
        key: &str,
        value: Value,
    ) -> CoreResult<()> {
        let dir = self
            .ensure_runtime_dir(locator, runtime_instance_id)
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
        locator: &AppDataLocator,
        runtime_instance_id: &str,
    ) -> CoreResult<Value> {
        let dir = self
            .ensure_runtime_dir(locator, runtime_instance_id)
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
            .get_storage(locator, runtime_instance_id, READINESS_PROBE_KEY)
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
            .get_storage(locator, runtime_instance_id, READINESS_PROBE_KEY)
            .await?;
        let delete_verified = if let Some(value) = previous_value {
            read_after_cleanup == value
        } else {
            read_after_cleanup.is_null()
        };

        Ok(json!({
            "available": write_verified && read_verified && delete_verified,
            "scope": "app-data",
            "probeKey": READINESS_PROBE_KEY,
            "writeVerified": write_verified,
            "readVerified": read_verified,
            "deleteVerified": delete_verified,
            "preservedPreviousValue": had_previous_value,
        }))
    }

    pub fn probe_storage_scope(
        &self,
        locator: &AppDataLocator,
        runtime_instance_id: &str,
    ) -> CoreResult<Value> {
        let _dir = self.runtime_dir(locator, runtime_instance_id)?;
        Ok(json!({
            "available": true,
            "scope": "app-data",
        }))
    }

    async fn load_storage(
        &self,
        locator: &AppDataLocator,
        runtime_instance_id: &str,
    ) -> CoreResult<Value> {
        let dir = self.runtime_dir(locator, runtime_instance_id)?;
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

    fn locator() -> AppDataLocator {
        AppDataLocator {
            scope: WorkScope::Global,
            app_id: "builtin-test".to_string(),
            work_id: WorkId::parse("work_1").unwrap(),
        }
    }

    #[tokio::test]
    async fn runtime_storage_is_scoped_by_work_and_runtime_instance() {
        let storage = runtime_storage("scoped");
        let locator = locator();

        storage
            .set_storage(&locator, "runtime_one", "state", json!("one"))
            .await
            .unwrap();
        storage
            .set_storage(&locator, "runtime_two", "state", json!("two"))
            .await
            .unwrap();

        assert_eq!(
            storage
                .get_storage(&locator, "runtime_one", "state")
                .await
                .unwrap(),
            json!("one")
        );
        assert_eq!(
            storage
                .get_storage(&locator, "runtime_two", "state")
                .await
                .unwrap(),
            json!("two")
        );
    }

    #[test]
    fn workspace_app_data_uses_workspace_id_partition() {
        let storage = runtime_storage("workspace-scope");
        let locator = AppDataLocator {
            scope: WorkScope::Workspace {
                workspace_id: "ws_test".to_string(),
            },
            ..locator()
        };
        let path = storage
            .runtime_dir(&locator, "runtime_one")
            .expect("runtime directory");
        assert!(path.ends_with(
            Path::new("app_data")
                .join("workspaces")
                .join("ws_test")
                .join("builtin-test")
                .join("works")
                .join("work_1")
                .join("runtimes")
                .join("runtime_one")
        ));
    }
}
