use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum FileScope {
    Workspace {
        root: String,
        workspace_id: Option<String>,
    },
    System {
        root: Option<String>,
    },
    Pinned {
        pin_id: String,
        path: String,
    },
    Recent {
        id: String,
    },
    Smart {
        collection: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileEntryKind {
    File,
    Dir,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub id: String,
    pub path: String,
    pub name: String,
    pub kind: FileEntryKind,
    pub scope: FileScope,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub readonly: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FileOperationType {
    Mkdir,
    Rename,
    Move,
    Copy,
    DeleteToTrash,
    DeletePermanent,
    Archive,
    Extract,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileOperationPlanStatus {
    Draft,
    Ready,
    Approved,
    Executing,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileOperationRisk {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileOperationPlanItem {
    pub id: String,
    pub operation_type: FileOperationType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_path: Option<String>,
    pub reason: String,
    pub risk: FileOperationRisk,
    pub requires_confirmation: bool,
    #[serde(default)]
    pub included: bool,
    #[serde(default)]
    pub conflicts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileOperationPlanSummary {
    pub total: usize,
    pub high_risk_count: usize,
    pub conflict_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileOperationPlan {
    pub id: String,
    pub title: String,
    pub scope: FileScope,
    pub cwd: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub items: Vec<FileOperationPlanItem>,
    pub summary: FileOperationPlanSummary,
    pub status: FileOperationPlanStatus,
}
