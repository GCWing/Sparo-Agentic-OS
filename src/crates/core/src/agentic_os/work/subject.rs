use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkAppKind {
    ProductApp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkAppRef {
    pub kind: WorkAppKind,
    pub app_id: String,
    pub app_version: String,
    pub component_lock_digest: String,
}

impl WorkAppRef {
    pub fn product_app(
        app_id: impl Into<String>,
        app_version: impl Into<String>,
        component_lock_digest: impl Into<String>,
    ) -> Self {
        Self {
            kind: WorkAppKind::ProductApp,
            app_id: app_id.into(),
            app_version: app_version.into(),
            component_lock_digest: component_lock_digest.into(),
        }
    }

    pub fn matches_product_app_id(&self, app_id: &str) -> bool {
        self.kind == WorkAppKind::ProductApp && self.app_id == app_id
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

    pub fn app_intent(&self) -> Option<WorkAppIntent> {
        match self {
            WorkSubject::App { intent, .. } => Some(*intent),
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
