use crate::agentic::app_studio_context::AppStudioSubject;
use crate::agentic::tools::framework::ToolUseContext;
use crate::agentic::tools::restrictions::is_local_path_within_root;
use crate::util::errors::{BitFunError, BitFunResult};
use std::path::{Path, PathBuf};

pub use crate::agentic::tools::workspace_paths::{
    normalize_path, resolve_path, resolve_path_with_workspace,
};

pub fn has_app_studio_session_context(context: &ToolUseContext) -> bool {
    context.app_studio.is_some()
}

pub fn bound_app_studio_product_app_root(
    context: &ToolUseContext,
    tool_name: &str,
) -> BitFunResult<Option<PathBuf>> {
    let Some(app_studio) = context.app_studio.as_ref() else {
        return Ok(None);
    };

    match &app_studio.subject {
        AppStudioSubject::ProductApp { .. } => Ok(Some(app_studio.package_root.clone())),
        _ => Err(BitFunError::validation(format!(
            "{} requires a bound Product App subject",
            tool_name
        ))),
    }
}

pub async fn enforce_app_studio_package_write(
    context: &ToolUseContext,
    resolved_path: &str,
) -> BitFunResult<()> {
    let target = Path::new(resolved_path);
    if let Some(app_studio) = context.app_studio.as_ref() {
        for root in &app_studio.allowed_write_roots {
            if is_local_path_within_root(target, root)? {
                return Ok(());
            }
        }

        return Err(BitFunError::validation(format!(
            "AppStudio is bound to package root '{}' and cannot write '{}'",
            app_studio.package_root.display(),
            target.display()
        )));
    }

    if context.agent_type.as_deref() == Some("AppStudio") {
        return Err(BitFunError::validation(
            "AppStudio package writes require a bound App Studio execution context".to_string(),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agentic::app_studio_context::{
        AppStudioExecutionContext, AppStudioSubject, AppStudioSubjectScope,
    };
    use crate::agentic::tools::ToolRuntimeRestrictions;
    use std::collections::HashMap;
    use std::path::PathBuf;

    fn bound_app_studio_context(package_root: PathBuf, agent_type: &str) -> ToolUseContext {
        ToolUseContext {
            tool_call_id: None,
            agent_type: Some(agent_type.to_string()),
            session_id: Some("session-1".to_string()),
            dialog_turn_id: None,
            workspace: None,
            custom_data: HashMap::new(),
            app_studio: Some(AppStudioExecutionContext {
                subject: AppStudioSubject::ProductApp {
                    app_id: "current-app".to_string(),
                    version: "1.0.0".to_string(),
                    title: None,
                    scope: AppStudioSubjectScope::System,
                },
                package_root: package_root.clone(),
                allowed_write_roots: vec![package_root],
                work_id: None,
                runtime_instance_id: None,
                preview_issue_id: None,
            }),
            computer_use_host: None,
            cancellation_token: None,
            runtime_tool_restrictions: ToolRuntimeRestrictions::default(),
            workspace_services: None,
            workspace_mount: None,
            agentic: None,
        }
    }

    fn unbound_context(agent_type: &str) -> ToolUseContext {
        ToolUseContext {
            tool_call_id: None,
            agent_type: Some(agent_type.to_string()),
            session_id: Some("session-1".to_string()),
            dialog_turn_id: None,
            workspace: None,
            custom_data: HashMap::new(),
            app_studio: None,
            computer_use_host: None,
            cancellation_token: None,
            runtime_tool_restrictions: ToolRuntimeRestrictions::default(),
            workspace_services: None,
            workspace_mount: None,
            agentic: None,
        }
    }

    #[tokio::test]
    async fn bound_app_studio_write_guard_allows_only_current_package_root() {
        let base = std::env::temp_dir().join(format!(
            "sparo-app-studio-bound-test-{}",
            uuid::Uuid::new_v4()
        ));
        let current_root = base.join("apps").join("current-app").join("1.0.0");
        let sibling_root = base.join("apps").join("other-app").join("1.0.0");
        std::fs::create_dir_all(&current_root).expect("create current root");
        std::fs::create_dir_all(&sibling_root).expect("create sibling root");

        let context = bound_app_studio_context(current_root.clone(), "AppStudio");

        enforce_app_studio_package_write(
            &context,
            &current_root.join("app.json").to_string_lossy(),
        )
        .await
        .expect("current package root allowed");

        let denied = enforce_app_studio_package_write(
            &context,
            &sibling_root.join("app.json").to_string_lossy(),
        )
        .await;
        assert!(denied.is_err());

        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn inherited_app_studio_context_restricts_non_app_studio_subagents() {
        let base = std::env::temp_dir().join(format!(
            "sparo-app-studio-subagent-bound-test-{}",
            uuid::Uuid::new_v4()
        ));
        let current_root = base.join("apps").join("current-app").join("1.0.0");
        let sibling_root = base.join("apps").join("other-app").join("1.0.0");
        std::fs::create_dir_all(&current_root).expect("create current root");
        std::fs::create_dir_all(&sibling_root).expect("create sibling root");

        let context = bound_app_studio_context(current_root.clone(), "agentic");

        enforce_app_studio_package_write(
            &context,
            &current_root.join("app.json").to_string_lossy(),
        )
        .await
        .expect("inherited current package root allowed");

        let denied = enforce_app_studio_package_write(
            &context,
            &sibling_root.join("app.json").to_string_lossy(),
        )
        .await;
        assert!(denied.is_err());

        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn app_studio_agent_without_bound_context_cannot_write_by_agent_type_fallback() {
        let path = std::env::temp_dir()
            .join("sparo-app-studio-unbound")
            .join("app.json");
        let context = unbound_context("AppStudio");

        let denied = enforce_app_studio_package_write(&context, &path.to_string_lossy()).await;

        assert!(denied.is_err());
    }
}
