//! ValidateProductAppPackage tool - read-only Product App package gate.

use std::path::PathBuf;

use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::agentic::tools::implementations::util::bound_app_studio_product_app_root;
use crate::app_platform::{
    list_installed_shared_components, AppSurfaceMode, AppWorkMultiplicity, ComponentKind,
    ProductAppLaunchKind, ProductAppResolver,
};
use crate::infrastructure::try_get_path_manager_arc;
use crate::error::{CoreError, CoreResult};
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct ValidateProductAppPackageTool;

impl ValidateProductAppPackageTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ValidateProductAppPackageTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for ValidateProductAppPackageTool {
    fn name(&self) -> &str {
        "ValidateProductAppPackage"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Validate a Product App package without modifying it. Checks app.json, private components, primary surface, launch policy, component lock digest, permission boundary, data boundary, data lifecycle policy, user-path rehearsal contract, and package resolver consistency.

Input: path, or app_id plus optional version for standalone validation. In a bound AppStudio session, leave input empty; the current bound Product App package is always used. Use this after meaningful Product App package edits and before final handoff. This is a package validation gate; preview/runtime/user-path/eval evidence still requires the platform preview and eval facts."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Product App package directory containing app.json and app.lock.json."
                },
                "app_id": {
                    "type": "string",
                    "description": "Installed Product App id. Used with version when path is omitted."
                },
                "version": {
                    "type": "string",
                    "description": "Product App version. Defaults to 1.0.0 when app_id is used."
                }
            },
            "description": "Use path/app_id only for standalone validation. Leave empty in a bound AppStudio session; the current Product App package is used."
        })
    }

    fn is_readonly(&self) -> bool {
        true
    }

    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        false
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> CoreResult<Vec<ToolResult>> {
        let path_manager = try_get_path_manager_arc()
            .map_err(|e| CoreError::tool(format!("PathManager not initialized: {}", e)))?;
        let package_dir = package_dir_from_input(input, &path_manager, context)?;
        let package = ProductAppResolver::read_product_app_package(&package_dir)
            .await
            .map_err(|e| CoreError::tool(format!("Failed to read Product App package: {}", e)))?;

        let app_id = package.app.id.clone();
        let app_version = package.app.version.clone();
        let declared_lock_id = package.app.component_lock_id.clone();
        let primary_surface_id = package
            .app
            .primary_surface
            .as_ref()
            .map(|surface| surface.component_id.clone());
        let primary_surface_mode = package.app.primary_surface_mode;
        let work_multiplicity = package.app.work_multiplicity;
        let launch = package.app.launch.clone();
        let rehearsal_plan = package.rehearsal_plan.as_ref();
        let rehearsal_scenario_count = rehearsal_plan.map(|plan| plan.scenarios.len()).unwrap_or(0);
        let rehearsal_step_count = rehearsal_plan
            .map(|plan| {
                plan.scenarios
                    .iter()
                    .map(|scenario| scenario.steps.len())
                    .sum::<usize>()
            })
            .unwrap_or(0);

        let shared_components = list_installed_shared_components(&path_manager)
            .await
            .map_err(|e| {
                CoreError::tool(format!("Failed to read installed shared components: {}", e))
            })?;
        let resolved = ProductAppResolver::resolve_package_install(package, shared_components)
            .map_err(|e| CoreError::tool(format!("Product App resolver failed: {}", e)))?;
        let lock = ProductAppResolver::read_lock(&package_dir)
            .await
            .map_err(|e| {
                CoreError::tool(format!(
                    "Failed to read app.lock.json for Product App {}: {}",
                    app_id, e
                ))
            })?;

        let mut checks = Vec::new();
        push_check(
            &mut checks,
            "package",
            "passed",
            format!("Read Product App {}@{}.", app_id, app_version),
        );

        let resolved_lock_digest = resolved.lock.digest();
        let file_lock_digest = lock.digest();
        push_check(
            &mut checks,
            "componentLock",
            if declared_lock_id == resolved_lock_digest && file_lock_digest == resolved_lock_digest
            {
                "passed"
            } else {
                "failed"
            },
            format!(
                "declared={}, file={}, resolved={}",
                declared_lock_id, file_lock_digest, resolved_lock_digest
            ),
        );

        let launch_kind = launch.as_ref().map(|launch| launch.kind);
        let primary_surface = primary_surface_id.as_ref().and_then(|primary_surface_id| {
            resolved.components.iter().find(|component| {
                component.kind == ComponentKind::Surface && component.id == *primary_surface_id
            })
        });
        let has_agent_component = resolved
            .components
            .iter()
            .any(|component| component.kind == ComponentKind::Agent);
        let application_surface_entry =
            launch_kind == Some(ProductAppLaunchKind::ApplicationSurface);
        let agent_session_entry = launch_kind == Some(ProductAppLaunchKind::AgentSession);
        let entry_status = if application_surface_entry {
            primary_surface.is_some()
        } else if agent_session_entry {
            has_agent_component
                || launch
                    .as_ref()
                    .and_then(|launch| launch.agent_type.as_ref())
                    .is_some()
                || resolved.app.permissions.ai
        } else {
            false
        };
        push_check(
            &mut checks,
            "entry",
            if entry_status { "passed" } else { "failed" },
            format!(
                "launch={}, primarySurface={}, agentComponent={}",
                launch
                    .as_ref()
                    .map(|launch| format!("{:?}:{}", launch.kind, launch.target_id))
                    .unwrap_or_else(|| "missing".to_string()),
                primary_surface_id.as_deref().unwrap_or("none"),
                has_agent_component
            ),
        );
        push_check(
            &mut checks,
            "primarySurface",
            if !application_surface_entry && primary_surface_id.is_none() {
                "notRequired"
            } else if primary_surface.is_some() {
                "passed"
            } else {
                "failed"
            },
            format!(
                "primarySurface.componentId={}",
                primary_surface_id.as_deref().unwrap_or("none")
            ),
        );

        let private_surface_source_exists =
            primary_surface_id
                .as_ref()
                .is_some_and(|primary_surface_id| {
                    resolved
                        .private_surface_sources
                        .contains_key(primary_surface_id)
                });
        push_check(
            &mut checks,
            "surfaceSource",
            if !application_surface_entry && primary_surface_id.is_none() {
                "notRequired"
            } else if private_surface_source_exists {
                "passed"
            } else {
                "failed"
            },
            format!(
                "private surface source for {}",
                primary_surface_id.as_deref().unwrap_or("none")
            ),
        );

        let expected_launch_kind = if primary_surface_id.is_some() {
            ProductAppLaunchKind::ApplicationSurface
        } else {
            ProductAppLaunchKind::AgentSession
        };
        let launch_status = launch
            .as_ref()
            .is_some_and(|launch| launch.kind == expected_launch_kind)
            && launch.as_ref().is_some_and(|launch| {
                if expected_launch_kind == ProductAppLaunchKind::ApplicationSurface {
                    launch.target_id == app_id
                } else {
                    !launch.target_id.trim().is_empty()
                }
            });
        push_check(
            &mut checks,
            "launchPolicy",
            if launch_status { "passed" } else { "failed" },
            format!(
                "surfaceMode={:?}, launch={}",
                primary_surface_mode,
                launch
                    .as_ref()
                    .map(|launch| format!("{:?}:{}", launch.kind, launch.target_id))
                    .unwrap_or_else(|| "missing".to_string())
            ),
        );

        let invalid_sidecar_singleton = primary_surface_mode == Some(AppSurfaceMode::SidecarLinked)
            && work_multiplicity == AppWorkMultiplicity::Singleton;
        let full_app_multiple = primary_surface_mode == Some(AppSurfaceMode::ImmersivePrimary)
            && work_multiplicity == AppWorkMultiplicity::Multiple;
        push_check(
            &mut checks,
            "workMultiplicity",
            if invalid_sidecar_singleton {
                "failed"
            } else if full_app_multiple {
                "warning"
            } else {
                "passed"
            },
            if invalid_sidecar_singleton {
                "sidecarLinked apps are chat-bound preview workbenches and must create independent Works.".to_string()
            } else if full_app_multiple {
                "immersivePrimary apps default to singleton; keep multiple only when the app owns clearly independent Work objects.".to_string()
            } else {
                format!(
                    "surfaceMode={:?}, workMultiplicity={:?}",
                    primary_surface_mode, work_multiplicity
                )
            },
        );

        let permission_warnings = [
            ("fs", resolved.app.permissions.fs),
            ("net", resolved.app.permissions.net),
            ("shell", resolved.app.permissions.shell),
            ("secrets", resolved.app.permissions.secrets),
            ("ai", resolved.app.permissions.ai),
        ]
        .into_iter()
        .filter_map(|(name, enabled)| enabled.then_some(name))
        .collect::<Vec<_>>();
        push_check(
            &mut checks,
            "permissions",
            if permission_warnings.is_empty() {
                "passed"
            } else {
                "warning"
            },
            if permission_warnings.is_empty() {
                "Minimum Product App permission summary is empty.".to_string()
            } else {
                format!(
                    "Declared elevated permissions: {}",
                    permission_warnings.join(", ")
                )
            },
        );

        let data_boundary_declared = !resolved.app.work_object_kinds.is_empty();
        push_check(
            &mut checks,
            "data",
            if data_boundary_declared {
                "passed"
            } else {
                "notVerified"
            },
            if data_boundary_declared {
                format!(
                    "{} work object kind(s) declare the Product App data boundary.",
                    resolved.app.work_object_kinds.len()
                )
            } else {
                "No work object kind declares the Product App data boundary.".to_string()
            },
        );

        push_check(
            &mut checks,
            "dataLifecycle",
            if resolved.app.data_lifecycle.is_some() {
                "passed"
            } else {
                "notVerified"
            },
            if let Some(policy) = resolved.app.data_lifecycle.as_ref() {
                format!(
                    "Data lifecycle policy declares retention={:?}, deletion={:?}, migration={:?}, share={:?}.",
                    policy.retention, policy.deletion, policy.migration, policy.share
                )
            } else {
                "No dataLifecycle policy declares retention, deletion, migration, and share behavior."
                    .to_string()
            },
        );

        push_check(
            &mut checks,
            "userPathContract",
            if rehearsal_scenario_count > 0 && rehearsal_step_count > 0 {
                "passed"
            } else {
                "notVerified"
            },
            if rehearsal_scenario_count > 0 && rehearsal_step_count > 0 {
                format!(
                    "{} rehearsal scenario(s), {} step(s) are declared in tests/rehearsal.json.",
                    rehearsal_scenario_count, rehearsal_step_count
                )
            } else {
                "No machine-readable user path rehearsal scenario is declared in tests/rehearsal.json.".to_string()
            },
        );

        push_check(
            &mut checks,
            "componentGraph",
            "passed",
            format!("{} components resolved.", resolved.components.len()),
        );

        push_check(
            &mut checks,
            "preview",
            "notRun",
            "Package validation does not prove runtime preview loaded.".to_string(),
        );
        push_check(
            &mut checks,
            "agentEval",
            "notRun",
            "Package validation does not prove intelligent behavior.".to_string(),
        );

        let failed_count = checks
            .iter()
            .filter(|check| check.get("status").and_then(Value::as_str) == Some("failed"))
            .count();
        let warning_count = checks
            .iter()
            .filter(|check| check.get("status").and_then(Value::as_str) == Some("warning"))
            .count();
        let status = if failed_count > 0 {
            "failed"
        } else if warning_count > 0 {
            "warning"
        } else {
            "passed"
        };
        let result_text = format!(
            "Product App package validation {} for {}@{}. failed={}, warnings={}. Preview and Agent Eval remain separate gates.",
            status, app_id, app_version, failed_count, warning_count
        );

        Ok(vec![ToolResult::Result {
            data: json!({
                "status": status,
                "app_id": app_id,
                "version": app_version,
                "path": package_dir.to_string_lossy(),
                "component_lock_digest": resolved_lock_digest,
                "primary_surface_id": primary_surface_id,
                "primary_surface_mode": primary_surface_mode,
                "work_multiplicity": work_multiplicity,
                "checks": checks,
                "summary": {
                    "failed": failed_count,
                    "warnings": warning_count,
                    "preview": "notRun",
                    "agentEval": "notRun"
                }
            }),
            result_for_assistant: Some(result_text),
            image_attachments: None,
        }])
    }
}

fn package_dir_from_input(
    input: &Value,
    path_manager: &crate::infrastructure::PathManager,
    context: &ToolUseContext,
) -> CoreResult<PathBuf> {
    if let Some(package_root) =
        bound_app_studio_product_app_root(context, "ValidateProductAppPackage")?
    {
        return Ok(package_root);
    }

    if let Some(path) = optional_string(input, "path").filter(|value| !value.trim().is_empty()) {
        return Ok(PathBuf::from(path));
    }
    let app_id = required_string(input, "app_id")?;
    let version = optional_string(input, "version").unwrap_or_else(|| "1.0.0".to_string());
    Ok(path_manager.system_product_app_version_dir(&app_id, &version))
}

fn push_check(checks: &mut Vec<Value>, id: &str, status: &str, detail: String) {
    checks.push(json!({
        "id": id,
        "status": status,
        "detail": detail,
    }));
}

fn required_string(input: &Value, field: &str) -> CoreResult<String> {
    let value = optional_string(input, field)
        .ok_or_else(|| CoreError::validation(format!("Missing required field: {field}")))?;
    if value.trim().is_empty() {
        return Err(CoreError::validation(format!("{field} cannot be empty")));
    }
    Ok(value)
}

fn optional_string(input: &Value, field: &str) -> Option<String> {
    input
        .get(field)
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agentic::app_studio_context::{
        AppStudioExecutionContext, AppStudioSubject, AppStudioSubjectScope,
    };
    use crate::agentic::tools::ToolRuntimeRestrictions;
    use crate::infrastructure::PathManager;
    use std::collections::HashMap;

    fn bound_context(package_root: PathBuf, app_id: &str, version: &str) -> ToolUseContext {
        ToolUseContext {
            tool_call_id: None,
            agent_type: Some("AppStudio".to_string()),
            session_id: Some("session-1".to_string()),
            dialog_turn_id: None,
            workspace: None,
            custom_data: HashMap::new(),
            app_studio: Some(AppStudioExecutionContext {
                subject: AppStudioSubject::ProductApp {
                    app_id: app_id.to_string(),
                    version: version.to_string(),
                    title: Some("Current App".to_string()),
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

    #[test]
    fn validate_product_app_defaults_to_bound_package_root() {
        let base = test_root("default-bound");
        let package_root = base.join("apps").join("current-app").join("1.0.0");
        std::fs::create_dir_all(&package_root).expect("create package root");
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let context = bound_context(package_root.clone(), "current-app", "1.0.0");

        let resolved = package_dir_from_input(&json!({}), &path_manager, &context)
            .expect("bound default package root");

        assert_eq!(resolved, package_root);
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn validate_product_app_accepts_matching_bound_app_id() {
        let base = test_root("matching-app-id");
        let package_root = base.join("apps").join("current-app").join("1.2.3");
        std::fs::create_dir_all(&package_root).expect("create package root");
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let context = bound_context(package_root.clone(), "current-app", "1.2.3");

        let resolved = package_dir_from_input(
            &json!({
                "app_id": "current-app",
                "version": "1.2.3"
            }),
            &path_manager,
            &context,
        )
        .expect("matching bound app id");

        assert_eq!(resolved, package_root);
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn validate_product_app_rejects_mismatched_bound_app_id() {
        let base = test_root("mismatched-app-id");
        let package_root = base.join("apps").join("current-app").join("1.0.0");
        std::fs::create_dir_all(&package_root).expect("create package root");
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let context = bound_context(package_root, "current-app", "1.0.0");

        let denied = package_dir_from_input(
            &json!({
                "app_id": "other-app",
                "version": "1.0.0"
            }),
            &path_manager,
            &context,
        );

        assert!(denied.is_err());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn validate_product_app_rejects_path_outside_bound_root() {
        let base = test_root("outside-path");
        let package_root = base.join("apps").join("current-app").join("1.0.0");
        let sibling_root = base.join("apps").join("other-app").join("1.0.0");
        std::fs::create_dir_all(&package_root).expect("create package root");
        std::fs::create_dir_all(&sibling_root).expect("create sibling root");
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let context = bound_context(package_root, "current-app", "1.0.0");

        let denied = package_dir_from_input(
            &json!({ "path": sibling_root.to_string_lossy() }),
            &path_manager,
            &context,
        );

        assert!(denied.is_err());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn validate_product_app_standalone_requires_path_or_app_id() {
        let base = test_root("standalone-required");
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let context = ToolUseContext {
            tool_call_id: None,
            agent_type: Some("agentic".to_string()),
            session_id: None,
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
        };

        let denied = package_dir_from_input(&json!({}), &path_manager, &context);

        assert!(denied.is_err());
        let _ = std::fs::remove_dir_all(base);
    }

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "sparo-validate-product-app-{name}-{}",
            uuid::Uuid::new_v4()
        ))
    }
}
