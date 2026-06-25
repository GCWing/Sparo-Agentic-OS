use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkAppKind {
    LiveApp,
    AgentApp,
    BridgeApp,
    SystemApp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkAppRef {
    pub kind: WorkAppKind,
    pub app_id: String,
}

impl WorkAppRef {
    pub fn live_app(app_id: impl Into<String>) -> Self {
        Self {
            kind: WorkAppKind::LiveApp,
            app_id: app_id.into(),
        }
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
