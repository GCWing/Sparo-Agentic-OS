use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkKind {
    OneShot,
    MultiStep,
    LongRunningSession,
    Recurring,
    Tracking,
    Topic,
    AppWorkflow,
    DelegatedWork,
}

impl Default for WorkKind {
    fn default() -> Self {
        Self::MultiStep
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkStatus {
    Draft,
    Active,
    Running,
    WaitingUser,
    Blocked,
    Paused,
    Completed,
    Failed,
    Archived,
}

impl Default for WorkStatus {
    fn default() -> Self {
        Self::Active
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkVisibility {
    Primary,
    Secondary,
    Hidden,
}

impl Default for WorkVisibility {
    fn default() -> Self {
        Self::Primary
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WorkScope {
    System,
    Workspace { workspace_path: String },
}

impl WorkScope {
    pub fn workspace_path(&self) -> Option<&str> {
        match self {
            WorkScope::System => None,
            WorkScope::Workspace { workspace_path } => Some(workspace_path),
        }
    }
}
