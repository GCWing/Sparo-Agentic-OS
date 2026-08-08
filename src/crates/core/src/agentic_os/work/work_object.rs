use serde::{Deserialize, Serialize};

use super::{WorkAppRef, WorkScope};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct WorkObjectId(String);

impl WorkObjectId {
    pub fn generate() -> Self {
        Self(format!("object_{}", uuid::Uuid::new_v4().simple()))
    }

    pub fn parse(value: impl Into<String>) -> Result<Self, String> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err("work_object_id cannot be empty".to_string());
        }
        if !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
        {
            return Err(
                "work_object_id can only contain ASCII letters, numbers, '-' and '_'".to_string(),
            );
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for WorkObjectId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkObjectLocator {
    pub scope: WorkScope,
    pub object_id: WorkObjectId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkObjectRole {
    Primary,
    Input,
    Output,
    Reference,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkObjectRef {
    pub locator: WorkObjectLocator,
    pub kind_id: String,
    pub role: WorkObjectRole,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkObjectLifecycle {
    Active,
    Archived,
    Trashed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkObjectOriginKind {
    Blank,
    Template,
    Import,
    Fork,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkObjectOrigin {
    pub kind: WorkObjectOriginKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_object: Option<WorkObjectLocator>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_revision: Option<u64>,
}

impl Default for WorkObjectOrigin {
    fn default() -> Self {
        Self {
            kind: WorkObjectOriginKind::Blank,
            source_object: None,
            source_revision: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkObjectStorageOwner {
    Runtime,
    Workspace,
    External,
}

impl Default for WorkObjectStorageOwner {
    fn default() -> Self {
        Self::Runtime
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkObjectStorage {
    #[serde(default)]
    pub owner: WorkObjectStorageOwner,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
}

impl Default for WorkObjectStorage {
    fn default() -> Self {
        Self {
            owner: WorkObjectStorageOwner::Runtime,
            uri: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkObjectRecord {
    pub id: WorkObjectId,
    pub kind_id: String,
    pub title: String,
    pub scope: WorkScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    pub app: WorkAppRef,
    #[serde(default)]
    pub storage: WorkObjectStorage,
    #[serde(default)]
    pub head_revision: u64,
    pub lifecycle: WorkObjectLifecycle,
    #[serde(default)]
    pub origin: WorkObjectOrigin,
    pub created_at: i64,
    pub updated_at: i64,
}

impl WorkObjectRecord {
    pub fn new(
        kind_id: String,
        title: String,
        scope: WorkScope,
        workspace_path: Option<String>,
        app: WorkAppRef,
        now: i64,
    ) -> Self {
        Self {
            id: WorkObjectId::generate(),
            kind_id,
            title,
            scope,
            workspace_path,
            app,
            storage: WorkObjectStorage::default(),
            head_revision: 0,
            lifecycle: WorkObjectLifecycle::Active,
            origin: WorkObjectOrigin::default(),
            created_at: now,
            updated_at: now,
        }
    }

    pub fn locator(&self) -> WorkObjectLocator {
        WorkObjectLocator {
            scope: self.scope.clone(),
            object_id: self.id.clone(),
        }
    }

    pub fn as_ref(&self, role: WorkObjectRole) -> WorkObjectRef {
        WorkObjectRef {
            locator: self.locator(),
            kind_id: self.kind_id.clone(),
            role,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agentic_os::work::WorkAppRef;

    #[test]
    fn locator_uses_stable_camel_case_wire_contract() {
        let locator = WorkObjectLocator {
            scope: WorkScope::Workspace {
                workspace_id: "ws_contract".to_string(),
            },
            object_id: WorkObjectId::parse("object_contract").expect("valid object id"),
        };

        assert_eq!(
            serde_json::to_value(locator).expect("serialize WorkObject locator"),
            serde_json::json!({
                "scope": { "kind": "workspace", "workspaceId": "ws_contract" },
                "objectId": "object_contract"
            })
        );
    }

    #[test]
    fn record_keeps_the_immutable_app_release_binding() {
        let app = WorkAppRef::product_app("ppt-live", "ppt-live", "release-1", "config-1", "1");
        let record = WorkObjectRecord::new(
            "deck".to_string(),
            "Quarterly review".to_string(),
            WorkScope::Global,
            None,
            app.clone(),
            10,
        );

        assert_eq!(record.app, app);
        assert_eq!(record.as_ref(WorkObjectRole::Primary).kind_id, "deck");
    }
}
