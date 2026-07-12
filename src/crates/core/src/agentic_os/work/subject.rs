use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkAppKind {
    NativeApp,
    ProductApp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkAppRef {
    pub kind: WorkAppKind,
    pub slot_id: String,
    pub app_id: String,
    pub release_id: String,
    pub config_revision: String,
    pub data_schema_version: String,
}

impl WorkAppRef {
    pub fn native_app(
        slot_id: impl Into<String>,
        app_id: impl Into<String>,
        release_id: impl Into<String>,
        config_revision: impl Into<String>,
        data_schema_version: impl Into<String>,
    ) -> Self {
        Self {
            kind: WorkAppKind::NativeApp,
            slot_id: slot_id.into(),
            app_id: app_id.into(),
            release_id: release_id.into(),
            config_revision: config_revision.into(),
            data_schema_version: data_schema_version.into(),
        }
    }

    pub fn product_app(
        slot_id: impl Into<String>,
        app_id: impl Into<String>,
        release_id: impl Into<String>,
        config_revision: impl Into<String>,
        data_schema_version: impl Into<String>,
    ) -> Self {
        Self {
            kind: WorkAppKind::ProductApp,
            slot_id: slot_id.into(),
            app_id: app_id.into(),
            release_id: release_id.into(),
            config_revision: config_revision.into(),
            data_schema_version: data_schema_version.into(),
        }
    }

    pub fn matches_slot(&self, slot_id: &str) -> bool {
        self.slot_id == slot_id
    }

    pub fn matches_product_app_id(&self, app_id: &str) -> bool {
        self.kind == WorkAppKind::ProductApp && self.app_id == app_id
    }

    pub fn matches_native_app_id(&self, app_id: &str) -> bool {
        self.kind == WorkAppKind::NativeApp && self.app_id == app_id
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkAppIntent {
    Use,
    Run,
    Develop,
    Debug,
    Edit,
    Review,
}

impl Default for WorkAppIntent {
    fn default() -> Self {
        Self::Use
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkComponentRef {
    pub component_id: String,
    pub component_kind: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub version: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub package_root: String,
}

impl WorkComponentRef {
    pub fn component(
        component_id: impl Into<String>,
        component_kind: impl Into<String>,
        version: impl Into<String>,
        package_root: impl Into<String>,
    ) -> Self {
        Self {
            component_id: component_id.into(),
            component_kind: component_kind.into(),
            version: version.into(),
            package_root: package_root.into(),
        }
    }

    pub fn matches_component(&self, component_id: &str, component_kind: &str) -> bool {
        self.component_id == component_id && self.component_kind == component_kind
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkComponentIntent {
    Develop,
    Debug,
    Edit,
    Review,
}

impl Default for WorkComponentIntent {
    fn default() -> Self {
        Self::Develop
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WorkSubject {
    Goal,
    Project {
        workspace_path: String,
    },
    App {
        app: WorkAppRef,
        #[serde(default)]
        intent: WorkAppIntent,
    },
    Component {
        component: WorkComponentRef,
        #[serde(default)]
        intent: WorkComponentIntent,
    },
    Artifact {
        artifact_id: String,
    },
}

impl Default for WorkSubject {
    fn default() -> Self {
        Self::Goal
    }
}

impl WorkSubject {
    pub fn app_ref(&self) -> Option<&WorkAppRef> {
        match self {
            WorkSubject::App { app, .. } => Some(app),
            _ => None,
        }
    }

    pub fn component_ref(&self) -> Option<&WorkComponentRef> {
        match self {
            WorkSubject::Component { component, .. } => Some(component),
            _ => None,
        }
    }

    pub fn app_intent(&self) -> Option<WorkAppIntent> {
        match self {
            WorkSubject::App { intent, .. } => Some(*intent),
            _ => None,
        }
    }

    pub fn component_intent(&self) -> Option<WorkComponentIntent> {
        match self {
            WorkSubject::Component { intent, .. } => Some(*intent),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkAppRelationRole {
    Subject,
    Executor,
    Surface,
    Origin,
    Context,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkAppRelation {
    pub app: WorkAppRef,
    pub role: WorkAppRelationRole,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_id: Option<String>,
}

impl WorkAppRelation {
    pub fn subject(app: WorkAppRef) -> Self {
        Self {
            app,
            role: WorkAppRelationRole::Subject,
            surface_id: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn work_app_ref_requires_immutable_execution_binding_fields() {
        let missing_release = serde_json::from_value::<WorkAppRef>(serde_json::json!({
            "kind": "product_app",
            "slot_id": "primary",
            "app_id": "sample-app",
            "config_revision": "config-1",
            "data_schema_version": "1"
        }))
        .expect_err("release id is required");

        assert!(missing_release.to_string().contains("release_id"));
    }

    #[test]
    fn work_app_ref_serializes_slot_release_config_and_data_schema() {
        let app =
            WorkAppRef::product_app("primary", "sample-app", "release-sample-1", "config-2", "3");

        let value = serde_json::to_value(app).expect("serialize Work App ref");

        assert_eq!(value["slot_id"], "primary");
        assert_eq!(value["release_id"], "release-sample-1");
        assert_eq!(value["config_revision"], "config-2");
        assert_eq!(value["data_schema_version"], "3");
        assert!(value.get("app_version").is_none());
        assert!(value.get("component_lock_digest").is_none());
    }
}
