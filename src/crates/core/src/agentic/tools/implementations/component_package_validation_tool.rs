//! ValidateComponentPackage tool - read-only shared Component package gate.

use std::path::{Path, PathBuf};

use crate::agentic::app_studio_context::AppStudioSubject;
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::agentic::tools::restrictions::is_local_path_within_root;
use crate::app_platform::{
    ComponentKind, ComponentPackageSource, ComponentSource, ProductAppResolver,
};
use crate::infrastructure::try_get_path_manager_arc;
use crate::error::{CoreError, CoreResult};
use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::fs;

pub struct ValidateComponentPackageTool;

impl ValidateComponentPackageTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ValidateComponentPackageTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for ValidateComponentPackageTool {
    fn name(&self) -> &str {
        "ValidateComponentPackage"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Validate a shared Component package without modifying it. Checks component.json, shared component identity, contract file presence, capabilities, permissions, dependency boundary, implementation reference, consumer compatibility evidence, and release gate placeholders.

Input: path, or component_id plus kind and optional version. In a bound AppStudio component session, input may be empty and defaults to the current bound Component package. Use this after meaningful Component package edits and before a Product App consumes or releases the component. This is a package contract gate; Product App consumer compatibility and eval evidence remain separate gates."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Component package directory containing component.json."
                },
                "component_id": {
                    "type": "string",
                    "description": "Shared Component id. Used with kind and version when path is omitted."
                },
                "kind": {
                    "type": "string",
                    "enum": ["surface", "agent", "bridge", "runtime", "tool", "skill", "surfaces", "agents", "bridges", "runtimes", "tools", "skills"],
                    "description": "Component kind or component kind path segment."
                },
                "version": {
                    "type": "string",
                    "description": "Component package version. Defaults to 1.0.0 when component_id is used outside a bound session."
                }
            },
            "description": "Provide path or component_id/kind for standalone validation. Leave empty in a bound AppStudio component session to validate the current Component package."
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
        let validation = validate_component_package(&package_dir).await?;

        Ok(vec![ToolResult::Result {
            data: validation.data,
            result_for_assistant: Some(validation.result_for_assistant),
            image_attachments: None,
        }])
    }
}

struct ComponentPackageValidation {
    data: Value,
    result_for_assistant: String,
}

async fn validate_component_package(
    package_dir: &Path,
) -> CoreResult<ComponentPackageValidation> {
    let package = ProductAppResolver::read_component_package(package_dir)
        .await
        .map_err(|e| CoreError::tool(format!("Failed to read Component package: {}", e)))?;
    let component = package.component;
    let component_id = component.id.clone();
    let component_kind = component.kind.path_segment();
    let kind_label = component_kind_name(component.kind);
    let version = component
        .version
        .clone()
        .unwrap_or_else(|| "0.0.0".to_string());

    let mut checks = Vec::new();
    push_check(
        &mut checks,
        "package",
        "passed",
        format!("Read Component package {}@{}.", component_id, version),
    );

    push_check(
        &mut checks,
        "componentSchema",
        if component.package_source == ComponentPackageSource::Shared
            && component.owner_app.is_none()
        {
            "passed"
        } else {
            "failed"
        },
        format!(
            "kind={}, packageSource={:?}, ownerApp={}",
            kind_label,
            component.package_source,
            component.owner_app.is_some()
        ),
    );

    let contract_path = package_dir.join("tests").join("contract.md");
    let contract_text = fs::read_to_string(&contract_path).await.unwrap_or_default();
    push_check(
        &mut checks,
        "componentContract",
        if !contract_text.trim().is_empty() {
            "passed"
        } else {
            "failed"
        },
        format!("contract={}", contract_path.display()),
    );

    push_check(
        &mut checks,
        "capabilities",
        if component.capabilities.is_empty() {
            "warning"
        } else {
            "passed"
        },
        if component.capabilities.is_empty() {
            "No capabilities declared; Product Apps cannot reason about reusable behavior."
                .to_string()
        } else {
            format!("{} capabilities declared.", component.capabilities.len())
        },
    );

    let permission_kinds = component
        .permissions
        .iter()
        .map(|permission| permission.kind.as_str())
        .collect::<Vec<_>>();
    push_check(
        &mut checks,
        "permissions",
        if permission_kinds.is_empty() {
            "passed"
        } else {
            "warning"
        },
        if permission_kinds.is_empty() {
            "No Component package permissions declared.".to_string()
        } else {
            format!("Declared permissions: {}", permission_kinds.join(", "))
        },
    );

    let invalid_dependencies = component
        .dependencies
        .iter()
        .filter(|dependency| dependency.source != ComponentSource::Shared)
        .map(|dependency| {
            format!(
                "{}:{}",
                dependency.kind.path_segment(),
                dependency.component_id
            )
        })
        .collect::<Vec<_>>();
    push_check(
        &mut checks,
        "dependencies",
        if invalid_dependencies.is_empty() {
            "passed"
        } else {
            "failed"
        },
        if invalid_dependencies.is_empty() {
            format!(
                "{} shared dependencies declared.",
                component.dependencies.len()
            )
        } else {
            format!(
                "Shared Component packages cannot depend on app-private components: {}",
                invalid_dependencies.join(", ")
            )
        },
    );

    push_check(
        &mut checks,
        "implementation",
        if component.implementation_ref.is_some() {
            "passed"
        } else {
            "warning"
        },
        component.implementation_ref.clone().unwrap_or_else(|| {
            "No implementationRef declared; runtime behavior remains unverified.".to_string()
        }),
    );

    push_check(
        &mut checks,
        "consumerCompatibility",
        "notVerified",
        if component.used_by_apps.is_empty() {
            "No Product App consumer lock has validated this component yet.".to_string()
        } else {
            format!(
                "Component manifest lists Product App consumer(s): {}; consumer compatibility still requires a consuming Product App runtime evidence run.",
                component.used_by_apps.join(", ")
            )
        },
    );

    push_check(
        &mut checks,
        "agentEval",
        "notRun",
        "Component package validation does not prove intelligent behavior.".to_string(),
    );

    let failed_count = count_status(&checks, "failed");
    let warning_count = count_status(&checks, "warning");
    let status = if failed_count > 0 {
        "failed"
    } else if warning_count > 0 {
        "warning"
    } else {
        "passed"
    };
    push_check(
        &mut checks,
        "releaseGate",
        if failed_count > 0 {
            "blocked"
        } else {
            "notVerified"
        },
        "Release still requires consumer compatibility, preview/runtime, permission/data, and eval evidence."
            .to_string(),
    );

    let result_for_assistant = format!(
        "Component package validation {} for {}/{}@{}. failed={}, warnings={}. Consumer compatibility and eval remain separate gates.",
        status, component_kind, component_id, version, failed_count, warning_count
    );

    Ok(ComponentPackageValidation {
        data: json!({
            "status": status,
            "component_id": component_id,
            "componentId": component_id,
            "component_kind": component_kind,
            "componentKind": component_kind,
            "kind": kind_label,
            "version": version,
            "path": package_dir.to_string_lossy(),
            "checks": checks,
            "summary": {
                "failed": failed_count,
                "warnings": warning_count,
                "consumerCompatibility": "notVerified",
                "agentEval": "notRun"
            }
        }),
        result_for_assistant,
    })
}

fn package_dir_from_input(
    input: &Value,
    path_manager: &crate::infrastructure::PathManager,
    context: &ToolUseContext,
) -> CoreResult<PathBuf> {
    if let Some(app_studio) = context.app_studio.as_ref() {
        let AppStudioSubject::Component {
            component_id: bound_component_id,
            component_kind: bound_component_kind,
            version: bound_version,
            ..
        } = &app_studio.subject
        else {
            return Err(CoreError::validation(
                "ValidateComponentPackage requires a bound Component subject".to_string(),
            ));
        };

        if let Some(path) = optional_string(input, "path").filter(|value| !value.trim().is_empty())
        {
            let package_dir = PathBuf::from(path);
            if !is_local_path_within_root(&package_dir, &app_studio.package_root)? {
                return Err(CoreError::validation(format!(
                    "ValidateComponentPackage is bound to package root '{}' and cannot validate '{}'",
                    app_studio.package_root.display(),
                    package_dir.display()
                )));
            }
            return Ok(package_dir);
        }

        if let Some(component_id) = optional_component_id(input) {
            let requested_kind = optional_component_kind_segment(input)?;
            let requested_version = optional_string(input, "version");
            if component_id != *bound_component_id
                || requested_kind
                    .as_deref()
                    .is_some_and(|kind| kind != bound_component_kind)
                || requested_version
                    .as_deref()
                    .is_some_and(|version| version != bound_version)
            {
                return Err(CoreError::validation(format!(
                    "ValidateComponentPackage is bound to {}/{}@{} and cannot validate {}/{}@{}",
                    bound_component_kind,
                    bound_component_id,
                    bound_version,
                    requested_kind.unwrap_or_else(|| bound_component_kind.clone()),
                    component_id,
                    requested_version.unwrap_or_else(|| bound_version.clone())
                )));
            }
        }

        return Ok(app_studio.package_root.clone());
    }

    if let Some(path) = optional_string(input, "path").filter(|value| !value.trim().is_empty()) {
        return Ok(PathBuf::from(path));
    }

    let component_id = required_component_id(input)?;
    let component_kind = required_component_kind_segment(input)?;
    let version = optional_string(input, "version").unwrap_or_else(|| "1.0.0".to_string());
    Ok(path_manager.system_component_version_dir(&component_kind, &component_id, &version))
}

fn push_check(checks: &mut Vec<Value>, id: &str, status: &str, detail: String) {
    checks.push(json!({
        "id": id,
        "status": status,
        "detail": detail,
    }));
}

fn count_status(checks: &[Value], status: &str) -> usize {
    checks
        .iter()
        .filter(|check| check.get("status").and_then(Value::as_str) == Some(status))
        .count()
}

fn component_kind_name(kind: ComponentKind) -> &'static str {
    match kind {
        ComponentKind::Surface => "surface",
        ComponentKind::Agent => "agent",
        ComponentKind::Bridge => "bridge",
        ComponentKind::Runtime => "runtime",
        ComponentKind::Tool => "tool",
        ComponentKind::Skill => "skill",
    }
}

fn required_component_id(input: &Value) -> CoreResult<String> {
    optional_component_id(input)
        .ok_or_else(|| CoreError::validation("Missing required field: component_id".to_string()))
}

fn optional_component_id(input: &Value) -> Option<String> {
    optional_string(input, "component_id").or_else(|| optional_string(input, "componentId"))
}

fn required_component_kind_segment(input: &Value) -> CoreResult<String> {
    optional_component_kind_segment(input)?
        .ok_or_else(|| CoreError::validation("Missing required field: kind".to_string()))
}

fn optional_component_kind_segment(input: &Value) -> CoreResult<Option<String>> {
    optional_string(input, "kind")
        .or_else(|| optional_string(input, "component_kind"))
        .or_else(|| optional_string(input, "componentKind"))
        .map(|value| component_kind_segment(&value).map(str::to_string))
        .transpose()
}

fn component_kind_segment(value: &str) -> CoreResult<&'static str> {
    let normalized = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|ch| !matches!(*ch, '_' | ' ' | '-'))
        .collect::<String>();
    match normalized.as_str() {
        "surface" | "surfacecomponent" | "surfaces" => Ok(ComponentKind::Surface.path_segment()),
        "agent" | "agentcomponent" | "agents" => Ok(ComponentKind::Agent.path_segment()),
        "bridge" | "bridgecomponent" | "bridges" => Ok(ComponentKind::Bridge.path_segment()),
        "runtime" | "runtimecomponent" | "runtimes" => Ok(ComponentKind::Runtime.path_segment()),
        "tool" | "toolcomponent" | "tools" => Ok(ComponentKind::Tool.path_segment()),
        "skill" | "skillcomponent" | "skills" => Ok(ComponentKind::Skill.path_segment()),
        _ => Err(CoreError::validation(
            "kind must be one of surface, agent, bridge, runtime, tool, or skill".to_string(),
        )),
    }
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
    use crate::agentic::app_studio_context::{AppStudioExecutionContext, AppStudioSubjectScope};
    use crate::agentic::tools::ToolRuntimeRestrictions;
    use crate::app_platform::{
        create_component_package, ComponentKind, CreateComponentPackageDraft,
    };
    use crate::infrastructure::PathManager;
    use std::collections::HashMap;

    fn bound_component_context(
        package_root: PathBuf,
        component_id: &str,
        component_kind: &str,
        version: &str,
    ) -> ToolUseContext {
        ToolUseContext {
            tool_call_id: None,
            agent_type: Some("AppStudio".to_string()),
            session_id: Some("session-1".to_string()),
            dialog_turn_id: None,
            workspace: None,
            custom_data: HashMap::new(),
            app_studio: Some(AppStudioExecutionContext {
                subject: AppStudioSubject::Component {
                    component_id: component_id.to_string(),
                    component_kind: component_kind.to_string(),
                    version: version.to_string(),
                    title: Some("Shared Agent".to_string()),
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

    fn unbound_context() -> ToolUseContext {
        ToolUseContext {
            tool_call_id: None,
            agent_type: Some("AppStudio".to_string()),
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

    #[test]
    fn validate_component_package_defaults_to_bound_package_root() {
        let base = test_root("default-bound");
        let package_root = base
            .join("components")
            .join("agents")
            .join("shared-agent")
            .join("1.0.0");
        std::fs::create_dir_all(&package_root).expect("create package root");
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let context =
            bound_component_context(package_root.clone(), "shared-agent", "agents", "1.0.0");

        let resolved = package_dir_from_input(&json!({}), &path_manager, &context)
            .expect("bound default package root");

        assert_eq!(resolved, package_root);
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn validate_component_package_rejects_non_component_bound_subject() {
        let base = test_root("wrong-subject");
        let package_root = base.join("apps").join("current-app").join("1.0.0");
        std::fs::create_dir_all(&package_root).expect("create package root");
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let mut context =
            bound_component_context(package_root.clone(), "shared-agent", "agents", "1.0.0");
        context.app_studio.as_mut().expect("context").subject = AppStudioSubject::ProductApp {
            app_id: "current-app".to_string(),
            version: "1.0.0".to_string(),
            title: Some("Current App".to_string()),
            scope: AppStudioSubjectScope::System,
        };

        let denied = package_dir_from_input(&json!({}), &path_manager, &context);

        assert!(denied.is_err());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn validate_component_package_rejects_mismatched_bound_component() {
        let base = test_root("mismatched-component");
        let package_root = base
            .join("components")
            .join("agents")
            .join("shared-agent")
            .join("1.0.0");
        std::fs::create_dir_all(&package_root).expect("create package root");
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let context = bound_component_context(package_root, "shared-agent", "agents", "1.0.0");

        let denied = package_dir_from_input(
            &json!({
                "component_id": "other-agent",
                "kind": "agent",
                "version": "1.0.0"
            }),
            &path_manager,
            &context,
        );

        assert!(denied.is_err());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn validate_component_package_rejects_path_outside_bound_root() {
        let base = test_root("outside-path");
        let package_root = base
            .join("components")
            .join("agents")
            .join("shared-agent")
            .join("1.0.0");
        let sibling_root = base
            .join("components")
            .join("agents")
            .join("other-agent")
            .join("1.0.0");
        std::fs::create_dir_all(&package_root).expect("create package root");
        std::fs::create_dir_all(&sibling_root).expect("create sibling root");
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let context = bound_component_context(package_root, "shared-agent", "agents", "1.0.0");

        let denied = package_dir_from_input(
            &json!({ "path": sibling_root.to_string_lossy() }),
            &path_manager,
            &context,
        );

        assert!(denied.is_err());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn validate_component_package_standalone_requires_kind_with_component_id() {
        let base = test_root("standalone-kind-required");
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let context = unbound_context();

        let denied = package_dir_from_input(
            &json!({
                "component_id": "shared-agent",
            }),
            &path_manager,
            &context,
        );

        assert!(denied.is_err());
        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn validate_component_package_reads_contract_gate() {
        let base = test_root("contract-gate");
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let written = create_component_package(
            &path_manager,
            CreateComponentPackageDraft {
                component_id: "shared-agent".to_string(),
                kind: ComponentKind::Agent,
                name: "Shared Agent".to_string(),
                description: "Reusable agent contract".to_string(),
                version: "1.0.0".to_string(),
                implementation_ref: Some("agent://shared-agent".to_string()),
            },
        )
        .await
        .expect("create component package");

        let validation = validate_component_package(&written.package_dir)
            .await
            .expect("validate component package");

        assert_eq!(
            validation.data.get("componentKind").and_then(Value::as_str),
            Some("agents")
        );
        assert_eq!(
            validation
                .data
                .pointer("/checks/2/id")
                .and_then(Value::as_str),
            Some("componentContract")
        );
        assert_eq!(
            validation
                .data
                .pointer("/summary/failed")
                .and_then(Value::as_u64),
            Some(0)
        );
        let _ = std::fs::remove_dir_all(base);
    }

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "sparo-validate-component-package-{name}-{}",
            uuid::Uuid::new_v4()
        ))
    }
}
