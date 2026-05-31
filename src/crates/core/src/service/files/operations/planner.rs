use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::service::files::model::{
    FileEntry, FileOperationPlan, FileOperationPlanItem, FileOperationPlanStatus,
    FileOperationPlanSummary, FileOperationRisk, FileOperationType, FileScope,
};
use crate::service::files::safety::{review_file_operation, FileSafetyRisk};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileOperationIntent {
    pub title: String,
    pub operation_type: FileOperationType,
    pub target_dir: Option<String>,
    pub reason: String,
}

fn parent_path(path: &str) -> Option<String> {
    let trimmed = path.trim_end_matches(['/', '\\']);
    let split_index = trimmed.rfind(['/', '\\'])?;
    if split_index == 0 {
        return Some(trimmed[..1].to_string());
    }
    Some(trimmed[..split_index].to_string())
}

fn stem_for_path(path: &str) -> String {
    let name = path
        .split(['/', '\\'])
        .next_back()
        .filter(|value| !value.is_empty())
        .unwrap_or(path);
    name.rsplit_once('.')
        .map(|(stem, _)| stem)
        .filter(|stem| !stem.is_empty())
        .unwrap_or(name)
        .to_string()
}

fn join_path(dir: &str, name: &str) -> String {
    format!("{}/{}", dir.trim_end_matches(['/', '\\']), name)
}

fn target_for_entry(
    entry: &FileEntry,
    target_dir: &Option<String>,
    operation_type: &FileOperationType,
) -> Option<String> {
    match operation_type {
        FileOperationType::Move | FileOperationType::Copy | FileOperationType::Rename => {
            target_dir.as_ref().map(|dir| join_path(dir, &entry.name))
        }
        FileOperationType::Archive => {
            let base_dir = target_dir
                .clone()
                .or_else(|| parent_path(&entry.path))
                .unwrap_or_else(|| ".".to_string());
            Some(join_path(
                &base_dir,
                &format!("{}.zip", stem_for_path(&entry.name)),
            ))
        }
        FileOperationType::Extract => {
            let base_dir = target_dir
                .clone()
                .or_else(|| parent_path(&entry.path))
                .unwrap_or_else(|| ".".to_string());
            Some(join_path(&base_dir, &stem_for_path(&entry.name)))
        }
        _ => target_dir.clone(),
    }
}

pub fn plan_file_operations(
    scope: FileScope,
    cwd: impl Into<String>,
    selection: &[FileEntry],
    intent: FileOperationIntent,
) -> FileOperationPlan {
    let items: Vec<FileOperationPlanItem> = selection
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let target_path = target_for_entry(entry, &intent.target_dir, &intent.operation_type);
            let safety = review_file_operation(
                &intent.operation_type,
                Some(&entry.path),
                target_path.as_deref(),
            );
            FileOperationPlanItem {
                id: format!("item-{}-{}", index, Uuid::new_v4()),
                operation_type: intent.operation_type.clone(),
                source_path: Some(entry.path.clone()),
                target_path,
                reason: intent.reason.clone(),
                risk: FileOperationRisk::from(&safety.risk),
                requires_confirmation: safety.requires_confirmation,
                included: !matches!(safety.risk, FileSafetyRisk::High),
                conflicts: safety.reasons,
            }
        })
        .collect();

    let high_risk_count = items
        .iter()
        .filter(|item| matches!(item.risk, FileOperationRisk::High))
        .count();
    let conflict_count = items
        .iter()
        .filter(|item| !item.conflicts.is_empty())
        .count();

    FileOperationPlan {
        id: format!("file-plan-{}", Uuid::new_v4()),
        title: intent.title,
        scope,
        cwd: cwd.into(),
        created_by: "user".to_string(),
        created_at: Utc::now(),
        summary: FileOperationPlanSummary {
            total: items.len(),
            high_risk_count,
            conflict_count,
        },
        items,
        status: FileOperationPlanStatus::Draft,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::files::model::FileEntryKind;

    fn entry(path: &str) -> FileEntry {
        FileEntry {
            id: path.to_string(),
            path: path.to_string(),
            name: path.split('/').next_back().unwrap_or(path).to_string(),
            kind: FileEntryKind::File,
            scope: FileScope::Workspace {
                root: "/work".to_string(),
                workspace_id: None,
            },
            size: Some(10),
            modified_at: None,
            category: Some("text".to_string()),
            hidden: false,
            readonly: false,
        }
    }

    #[test]
    fn plans_move_operations_without_executing() {
        let plan = plan_file_operations(
            FileScope::Workspace {
                root: "/work".to_string(),
                workspace_id: None,
            },
            "/work",
            &[entry("/work/a.txt")],
            FileOperationIntent {
                title: "Move files".to_string(),
                operation_type: FileOperationType::Move,
                target_dir: Some("/work/archive".to_string()),
                reason: "Group selected files".to_string(),
            },
        );

        assert_eq!(plan.status, FileOperationPlanStatus::Draft);
        assert_eq!(plan.summary.total, 1);
        assert_eq!(
            plan.items[0].target_path.as_deref(),
            Some("/work/archive/a.txt")
        );
        assert!(plan.items[0].requires_confirmation);
    }

    #[test]
    fn flags_permanent_delete_as_high_risk() {
        let plan = plan_file_operations(
            FileScope::System {
                root: Some("C:/".to_string()),
            },
            "C:/",
            &[entry("C:/Users/example/AppData/token.txt")],
            FileOperationIntent {
                title: "Delete".to_string(),
                operation_type: FileOperationType::DeletePermanent,
                target_dir: None,
                reason: "Remove selected files".to_string(),
            },
        );

        assert_eq!(plan.summary.high_risk_count, 1);
        assert!(!plan.items[0].included);
        assert!(!plan.items[0].conflicts.is_empty());
    }

    #[test]
    fn plans_archive_and_extract_targets_without_explicit_target_dir() {
        let archive_plan = plan_file_operations(
            FileScope::Workspace {
                root: "/work".to_string(),
                workspace_id: None,
            },
            "/work",
            &[entry("/work/report.txt")],
            FileOperationIntent {
                title: "Archive".to_string(),
                operation_type: FileOperationType::Archive,
                target_dir: None,
                reason: "Package selected file".to_string(),
            },
        );

        assert_eq!(
            archive_plan.items[0].target_path.as_deref(),
            Some("/work/report.zip")
        );

        let extract_plan = plan_file_operations(
            FileScope::Workspace {
                root: "/work".to_string(),
                workspace_id: None,
            },
            "/work",
            &[entry("/work/report.zip")],
            FileOperationIntent {
                title: "Extract".to_string(),
                operation_type: FileOperationType::Extract,
                target_dir: None,
                reason: "Inspect archive".to_string(),
            },
        );

        assert_eq!(
            extract_plan.items[0].target_path.as_deref(),
            Some("/work/report")
        );
    }
}
