use crate::agentic::app_builder_context::AppBuilderSubject;
use crate::agentic::tools::framework::ToolUseContext;
use crate::agentic::tools::restrictions::is_local_path_within_root;
use crate::error::{CoreError, CoreResult};
use std::path::{Path, PathBuf};

pub use crate::agentic::tools::workspace_paths::{
    normalize_path, resolve_path, resolve_path_with_workspace,
};

pub fn has_app_builder_session_context(context: &ToolUseContext) -> bool {
    context.app_builder.is_some()
}

pub fn bound_app_builder_product_app_root(
    context: &ToolUseContext,
    tool_name: &str,
) -> CoreResult<Option<PathBuf>> {
    let Some(app_builder) = context.app_builder.as_ref() else {
        return Ok(None);
    };

    match &app_builder.subject {
        AppBuilderSubject::ProductApp { .. } => Ok(Some(app_builder.package_root.clone())),
        _ => Err(CoreError::validation(format!(
            "{} requires a bound Product App subject",
            tool_name
        ))),
    }
}

pub async fn enforce_app_builder_package_write(
    context: &ToolUseContext,
    resolved_path: &str,
) -> CoreResult<()> {
    let target = Path::new(resolved_path);
    if let Some(app_builder) = context.app_builder.as_ref() {
        for root in &app_builder.allowed_write_roots {
            if is_local_path_within_root(target, root)? {
                return Ok(());
            }
        }

        return Err(CoreError::validation(format!(
            "AppBuilder is bound to package root '{}' and cannot write '{}'",
            app_builder.package_root.display(),
            target.display()
        )));
    }

    if context.agent_type.as_deref() == Some("AppBuilder") {
        return Err(CoreError::validation(
            "AppBuilder package writes require a bound App Builder execution context".to_string(),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agentic::app_builder_context::{
        AppBuilderExecutionContext, AppBuilderSubject, AppBuilderSubjectScope,
    };
    use crate::agentic::tools::ToolRuntimeRestrictions;
    use std::collections::HashMap;
    use std::path::PathBuf;

    fn bound_app_builder_context(package_root: PathBuf, agent_type: &str) -> ToolUseContext {
        ToolUseContext {
            tool_call_id: None,
            agent_type: Some(agent_type.to_string()),
            session_id: Some("session-1".to_string()),
            dialog_turn_id: None,
            workspace: None,
            custom_data: HashMap::new(),
            app_builder: Some(AppBuilderExecutionContext {
                subject: AppBuilderSubject::ProductApp {
                    app_id: "current-app".to_string(),
                    version: "1.0.0".to_string(),
                    title: None,
                    scope: AppBuilderSubjectScope::System,
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
            app_builder: None,
            computer_use_host: None,
            cancellation_token: None,
            runtime_tool_restrictions: ToolRuntimeRestrictions::default(),
            workspace_services: None,
            workspace_mount: None,
            agentic: None,
        }
    }

    #[tokio::test]
    async fn bound_app_builder_write_guard_allows_only_current_package_root() {
        let base = std::env::temp_dir().join(format!(
            "sparo-app-builder-bound-test-{}",
            uuid::Uuid::new_v4()
        ));
        let current_root = base.join("apps").join("current-app").join("1.0.0");
        let sibling_root = base.join("apps").join("other-app").join("1.0.0");
        std::fs::create_dir_all(&current_root).expect("create current root");
        std::fs::create_dir_all(&sibling_root).expect("create sibling root");

        let context = bound_app_builder_context(current_root.clone(), "AppBuilder");

        enforce_app_builder_package_write(
            &context,
            &current_root.join("app.json").to_string_lossy(),
        )
        .await
        .expect("current package root allowed");

        let denied = enforce_app_builder_package_write(
            &context,
            &sibling_root.join("app.json").to_string_lossy(),
        )
        .await;
        assert!(denied.is_err());

        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn inherited_app_builder_context_restricts_non_app_builder_subagents() {
        let base = std::env::temp_dir().join(format!(
            "sparo-app-builder-subagent-bound-test-{}",
            uuid::Uuid::new_v4()
        ));
        let current_root = base.join("apps").join("current-app").join("1.0.0");
        let sibling_root = base.join("apps").join("other-app").join("1.0.0");
        std::fs::create_dir_all(&current_root).expect("create current root");
        std::fs::create_dir_all(&sibling_root).expect("create sibling root");

        let context = bound_app_builder_context(current_root.clone(), "Runno");

        enforce_app_builder_package_write(
            &context,
            &current_root.join("app.json").to_string_lossy(),
        )
        .await
        .expect("inherited current package root allowed");

        let denied = enforce_app_builder_package_write(
            &context,
            &sibling_root.join("app.json").to_string_lossy(),
        )
        .await;
        assert!(denied.is_err());

        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn app_builder_agent_without_bound_context_cannot_write_by_agent_type_fallback() {
        let path = std::env::temp_dir()
            .join("sparo-app-builder-unbound")
            .join("app.json");
        let context = unbound_context("AppBuilder");

        let denied = enforce_app_builder_package_write(&context, &path.to_string_lossy()).await;

        assert!(denied.is_err());
    }
}
