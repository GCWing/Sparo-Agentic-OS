use chrono::Utc;

use crate::service::files::audit::{
    FileOperationApplyResult, FileOperationAuditRecord, FileOperationItemResult,
};
use crate::service::files::model::{
    FileOperationPlan, FileOperationPlanItem, FileOperationPlanStatus, FileOperationRisk,
};

pub fn confirmation_token_for_plan(plan_id: &str) -> String {
    format!("confirm:{}", plan_id)
}

pub fn execute_file_operation_plan_with<F>(
    plan: &FileOperationPlan,
    confirmation_token: &str,
    mut apply_item: F,
) -> Result<FileOperationAuditRecord, String>
where
    F: FnMut(&FileOperationPlanItem) -> Result<FileOperationApplyResult, String>,
{
    if confirmation_token != confirmation_token_for_plan(&plan.id) {
        return Err("File operation plan confirmation token is invalid".to_string());
    }

    if !matches!(
        plan.status,
        FileOperationPlanStatus::Draft | FileOperationPlanStatus::Ready
    ) {
        return Err(format!(
            "File operation plan cannot be executed from status {:?}",
            plan.status
        ));
    }

    let started_at = Utc::now();
    let mut results = Vec::with_capacity(plan.items.len());

    for item in &plan.items {
        if !item.included {
            results.push(FileOperationItemResult {
                item_id: item.id.clone(),
                success: false,
                error: Some("Plan item is not included for execution".to_string()),
                refresh_paths: refresh_paths_for_item(item),
                recovery: None,
            });
            continue;
        }

        if matches!(item.risk, FileOperationRisk::High) {
            results.push(FileOperationItemResult {
                item_id: item.id.clone(),
                success: false,
                error: Some("High-risk plan item requires a safer revised plan".to_string()),
                refresh_paths: refresh_paths_for_item(item),
                recovery: None,
            });
            continue;
        }

        match apply_item(item) {
            Ok(apply_result) => results.push(FileOperationItemResult {
                item_id: item.id.clone(),
                success: true,
                error: None,
                refresh_paths: apply_result.refresh_paths,
                recovery: apply_result.recovery,
            }),
            Err(error) => results.push(FileOperationItemResult {
                item_id: item.id.clone(),
                success: false,
                error: Some(error),
                refresh_paths: refresh_paths_for_item(item),
                recovery: None,
            }),
        }
    }

    let success = results.iter().all(|result| result.success);

    Ok(FileOperationAuditRecord {
        plan_id: plan.id.clone(),
        started_at,
        completed_at: Some(Utc::now()),
        success,
        results,
    })
}

fn refresh_paths_for_item(item: &FileOperationPlanItem) -> Vec<String> {
    let mut paths = Vec::new();
    if let Some(source_path) = item.source_path.as_deref() {
        paths.push(parent_or_self(source_path));
    }
    if let Some(target_path) = item.target_path.as_deref() {
        let parent = parent_or_self(target_path);
        if !paths.iter().any(|path| path == &parent) {
            paths.push(parent);
        }
    }
    paths
}

fn parent_or_self(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let Some(index) = normalized.rfind('/') else {
        return path.to_string();
    };
    if index == 0 {
        return normalized[..=index].to_string();
    }
    normalized[..index].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::files::model::{FileOperationPlanSummary, FileOperationType, FileScope};

    fn plan_with_item(item: FileOperationPlanItem) -> FileOperationPlan {
        FileOperationPlan {
            id: "plan-1".to_string(),
            title: "Review".to_string(),
            scope: FileScope::System {
                root: Some("/work".to_string()),
            },
            cwd: "/work".to_string(),
            created_by: "test".to_string(),
            created_at: Utc::now(),
            items: vec![item],
            summary: FileOperationPlanSummary {
                total: 1,
                high_risk_count: 0,
                conflict_count: 0,
            },
            status: FileOperationPlanStatus::Draft,
        }
    }

    fn item(risk: FileOperationRisk, included: bool) -> FileOperationPlanItem {
        FileOperationPlanItem {
            id: "item-1".to_string(),
            operation_type: FileOperationType::Move,
            source_path: Some("/work/a.txt".to_string()),
            target_path: Some("/work/archive/a.txt".to_string()),
            reason: "Move".to_string(),
            risk,
            requires_confirmation: true,
            included,
            conflicts: vec![],
        }
    }

    #[test]
    fn rejects_invalid_confirmation_token() {
        let plan = plan_with_item(item(FileOperationRisk::Low, true));
        let result = execute_file_operation_plan_with(&plan, "wrong", |_| {
            Ok(FileOperationApplyResult::default())
        });
        assert!(result.is_err());
    }

    #[test]
    fn executes_included_non_high_risk_items_and_records_audit() {
        let plan = plan_with_item(item(FileOperationRisk::Medium, true));
        let audit =
            execute_file_operation_plan_with(&plan, &confirmation_token_for_plan(&plan.id), |_| {
                Ok(FileOperationApplyResult {
                    refresh_paths: vec!["/work".to_string(), "/work/archive".to_string()],
                    recovery: None,
                })
            })
            .expect("plan should execute");

        assert!(audit.success);
        assert_eq!(audit.results.len(), 1);
        assert_eq!(audit.results[0].refresh_paths.len(), 2);
    }

    #[test]
    fn records_recovery_metadata_from_apply_result() {
        let plan = plan_with_item(item(FileOperationRisk::Medium, true));
        let audit =
            execute_file_operation_plan_with(&plan, &confirmation_token_for_plan(&plan.id), |_| {
                Ok(FileOperationApplyResult {
                    refresh_paths: vec!["/work".to_string()],
                    recovery: Some(crate::service::files::audit::FileOperationRecovery {
                        operation_type: FileOperationType::Move,
                        source_path: "/trash/a.txt".to_string(),
                        target_path: "/work/a.txt".to_string(),
                        label: "Restore".to_string(),
                    }),
                })
            })
            .expect("plan should execute");

        assert_eq!(
            audit.results[0]
                .recovery
                .as_ref()
                .map(|recovery| recovery.target_path.as_str()),
            Some("/work/a.txt")
        );
    }

    #[test]
    fn skips_high_risk_items_even_with_confirmation() {
        let plan = plan_with_item(item(FileOperationRisk::High, true));
        let audit =
            execute_file_operation_plan_with(&plan, &confirmation_token_for_plan(&plan.id), |_| {
                Ok(FileOperationApplyResult::default())
            })
            .expect("audit should be recorded");

        assert!(!audit.success);
        assert!(audit.results[0]
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("High-risk"));
    }
}
