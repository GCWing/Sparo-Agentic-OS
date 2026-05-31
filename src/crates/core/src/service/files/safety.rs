use std::path::Path;

use serde::{Deserialize, Serialize};

use super::model::{FileOperationRisk, FileOperationType};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileSafetyRisk {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileSafetyReview {
    pub risk: FileSafetyRisk,
    pub requires_confirmation: bool,
    pub sensitive_path: bool,
    pub reasons: Vec<String>,
}

fn normalized_path(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

pub fn is_sensitive_path(path: &str) -> bool {
    let normalized = normalized_path(path);
    normalized == "/"
        || normalized.ends_with(':')
        || normalized.contains("/windows")
        || normalized.contains("/system32")
        || normalized.contains("/appdata")
        || normalized.contains("/library/application support")
        || normalized.contains("/.config")
}

pub fn review_file_operation(
    operation_type: &FileOperationType,
    source_path: Option<&str>,
    target_path: Option<&str>,
) -> FileSafetyReview {
    let mut reasons = Vec::new();
    let sensitive_path =
        source_path.is_some_and(is_sensitive_path) || target_path.is_some_and(is_sensitive_path);

    if sensitive_path {
        reasons.push("Operation touches a sensitive path".to_string());
    }

    let mut risk = match operation_type {
        FileOperationType::DeletePermanent => {
            reasons.push("Permanent deletion cannot be automatically restored".to_string());
            FileSafetyRisk::High
        }
        FileOperationType::DeleteToTrash | FileOperationType::Move | FileOperationType::Rename => {
            FileSafetyRisk::Medium
        }
        FileOperationType::Mkdir
        | FileOperationType::Copy
        | FileOperationType::Archive
        | FileOperationType::Extract => FileSafetyRisk::Low,
    };

    if sensitive_path {
        risk = FileSafetyRisk::High;
    }

    if let Some(target) = target_path {
        if Path::new(target).components().count() == 0 {
            reasons.push("Target path is empty".to_string());
            risk = FileSafetyRisk::High;
        }
    }

    FileSafetyReview {
        requires_confirmation: !matches!(risk, FileSafetyRisk::Low),
        sensitive_path,
        risk,
        reasons,
    }
}

impl From<&FileSafetyRisk> for FileOperationRisk {
    fn from(value: &FileSafetyRisk) -> Self {
        match value {
            FileSafetyRisk::Low => FileOperationRisk::Low,
            FileSafetyRisk::Medium => FileOperationRisk::Medium,
            FileSafetyRisk::High => FileOperationRisk::High,
        }
    }
}
