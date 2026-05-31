use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::service::files::model::FileOperationType;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileOperationRecovery {
    pub operation_type: FileOperationType,
    pub source_path: String,
    pub target_path: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileOperationApplyResult {
    #[serde(default)]
    pub refresh_paths: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery: Option<FileOperationRecovery>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileOperationItemResult {
    pub item_id: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub refresh_paths: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery: Option<FileOperationRecovery>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileOperationAuditRecord {
    pub plan_id: String,
    pub started_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
    pub success: bool,
    pub results: Vec<FileOperationItemResult>,
}
