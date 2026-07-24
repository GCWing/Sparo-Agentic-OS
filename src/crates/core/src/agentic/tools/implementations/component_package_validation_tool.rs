//! ValidateComponentPackage tool - read-only app-private Component package gate.

use std::path::{Path, PathBuf};

use crate::agentic::app_builder_context::AppBuilderSubject;
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::app_platform::{
    AppDefinition, ComponentDefinition, ComponentKind, ComponentPackageSource, ComponentSource,
};
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
        Ok(r#"Validate an app-private Component inside the Product App package of the current Builder Draft without modifying it. Checks component.json, ownership, contract file presence, capabilities, permissions, dependency boundary, implementation reference, runtime evidence placeholders, and release gate placeholders.

Input requires component_id and kind. Arbitrary paths, version locators, installed Releases, and shared Component packages are not AppBuilder subjects. Use this after meaningful app-private Component edits and before publishing the Draft. Runtime and eval evidence remain separate gates."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["component_id", "kind"],
            "properties": {
                "component_id": {
                    "type": "string",
                    "description": "App-private Component id inside the current Builder Draft."
                },
                "kind": {
                    "type": "string",
                    "enum": ["surface", "agent", "bridge", "runtime", "tool", "skill", "surfaces", "agents", "bridges", "runtimes", "tools", "skills"],
                    "description": "Component kind or component kind path segment."
                }
            },
            "description": "Select an app-private Component from the Product App package in the bound Builder Draft."
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
        let package_dir = package_dir_from_input(input, context)?;
        let draft_root = &context
            .app_builder
            .as_ref()
            .expect("package locator proved a bound Builder Draft")
            .package_root;
        let validation = validate_component_package(&package_dir, draft_root).await?;

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
    draft_root: &Path,
) -> CoreResult<ComponentPackageValidation> {
    let app: AppDefinition = read_package_json(&draft_root.join("app.json"), "Product App").await?;
    let component: ComponentDefinition =
        read_package_json(&package_dir.join("component.json"), "Component").await?;
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

    let owner_matches_app = component
        .owner_app
        .as_ref()
        .is_some_and(|owner| owner.app_id == app.id && owner.app_version == app.version);
    push_check(
        &mut checks,
        "componentSchema",
        if component.package_source == ComponentPackageSource::AppPrivate
            && component.version.is_none()
            && owner_matches_app
        {
            "passed"
        } else {
            "failed"
        },
        format!(
            "kind={}, packageSource={:?}, ownerMatchesApp={}",
            kind_label, component.package_source, owner_matches_app
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
                "App-private Components may depend only on shared Components; invalid dependencies: {}",
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

async fn read_package_json<T>(path: &Path, label: &str) -> CoreResult<T>
where
    T: for<'de> serde::Deserialize<'de>,
{
    let bytes = fs::read(path)
        .await
        .map_err(|error| CoreError::tool(format!("Failed to read {label} package: {error}")))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| CoreError::tool(format!("Failed to parse {label} package: {error}")))
}

fn package_dir_from_input(input: &Value, context: &ToolUseContext) -> CoreResult<PathBuf> {
    let Some(app_builder) = context.app_builder.as_ref() else {
        return Err(CoreError::validation(
            "ValidateComponentPackage requires a bound Builder Draft",
        ));
    };
    let AppBuilderSubject::BuilderDraft { .. } = &app_builder.subject;
    let component_id = required_component_id(input)?;
    validate_component_id(&component_id)?;
    let component_kind = required_component_kind_segment(input)?;
    let components_root = app_builder.package_root.join("components");
    let package_dir = components_root.join(component_kind).join(component_id);
    if !package_dir.is_dir() {
        return Err(CoreError::validation(format!(
            "The selected app-private Component does not exist in the current Builder Draft: {}",
            package_dir.display()
        )));
    }
    let canonical_components_root = dunce::canonicalize(&components_root).map_err(|error| {
        CoreError::validation(format!(
            "Failed to resolve Builder Draft component root '{}': {error}",
            components_root.display()
        ))
    })?;
    let canonical_package_dir = dunce::canonicalize(&package_dir).map_err(|error| {
        CoreError::validation(format!(
            "Failed to resolve app-private Component '{}': {error}",
            package_dir.display()
        ))
    })?;
    if !canonical_package_dir.starts_with(&canonical_components_root) {
        return Err(CoreError::validation(
            "App-private Component path escapes the current Builder Draft",
        ));
    }
    Ok(canonical_package_dir)
}

fn validate_component_id(component_id: &str) -> CoreResult<()> {
    if component_id.is_empty()
        || matches!(component_id, "." | "..")
        || !component_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(CoreError::validation(
            "component_id must be a non-empty package id without path separators",
        ));
    }
    Ok(())
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
    use crate::agentic::app_builder_context::AppBuilderSubjectScope;
    use crate::agentic::tools::ToolRuntimeRestrictions;
    use crate::app_platform::{
        create_product_app_package_with_options, AppSurfaceMode, CreateProductAppPackageDraft,
        CreateProductAppPackageOptions,
    };
    use crate::infrastructure::PathManager;
    use std::collections::HashMap;

    fn draft_context(package_root: PathBuf) -> ToolUseContext {
        ToolUseContext {
            tool_call_id: None,
            agent_type: Some("AppBuilder".to_string()),
            session_id: Some("session-1".to_string()),
            session_domain: None,
            dialog_turn_id: None,
            workspace: None,
            custom_data: HashMap::new(),
            app_builder: Some(
                crate::agentic::app_builder_context::AppBuilderExecutionContext {
                    subject: AppBuilderSubject::BuilderDraft {
                        draft_id: "draft_0123456789abcdef0123456789abcdef".to_string(),
                        title: Some("Current Draft".to_string()),
                        scope: AppBuilderSubjectScope::System,
                    },
                    package_root: package_root.clone(),
                    allowed_write_roots: vec![package_root],
                    work_id: None,
                    runtime_instance_id: None,
                    preview_issue_id: None,
                },
            ),
            computer_use_host: None,
            cancellation_token: None,
            runtime_tool_restrictions: ToolRuntimeRestrictions::default(),
            workspace_services: None,
            workspace_mount: None,
            agentic: None,
        }
    }

    fn unbound_context() -> ToolUseContext {
        let mut context = draft_context(PathBuf::new());
        context.app_builder = None;
        context
    }

    #[test]
    fn component_locator_is_always_relative_to_the_bound_builder_draft() {
        let root = std::env::temp_dir().join(format!(
            "sparo-private-component-locator-{}",
            uuid::Uuid::new_v4()
        ));
        let component_root = root.join("components").join("agents").join("current-agent");
        std::fs::create_dir_all(&component_root).expect("create component root");
        let resolved = package_dir_from_input(
            &json!({ "component_id": "current-agent", "kind": "agent" }),
            &draft_context(root.clone()),
        )
        .expect("resolve component");

        assert_eq!(
            resolved,
            dunce::canonicalize(component_root).expect("canonical component")
        );
        assert!(package_dir_from_input(
            &json!({ "component_id": "../outside", "kind": "agent" }),
            &draft_context(root.clone()),
        )
        .is_err());
        assert!(package_dir_from_input(
            &json!({ "component_id": "current-agent", "kind": "agent" }),
            &unbound_context(),
        )
        .is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn validates_an_app_private_component_from_the_builder_draft() {
        let base = std::env::temp_dir().join(format!(
            "sparo-private-component-validation-{}",
            uuid::Uuid::new_v4()
        ));
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let written = create_product_app_package_with_options(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "current-app".to_string(),
                name: "Current App".to_string(),
                description: "A test Product App.".to_string(),
                authors: Vec::new(),
                i18n: Default::default(),
                version: "1.0.0".to_string(),
                agent_type: "Runno".to_string(),
                category: "test".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
            CreateProductAppPackageOptions {
                include_agent: Some(true),
                include_surface: Some(true),
            },
        )
        .await
        .expect("create Product App package");
        let package_root = written.package_dir;
        let component_root = package_dir_from_input(
            &json!({ "component_id": "current-app-agent", "kind": "agent" }),
            &draft_context(package_root.clone()),
        )
        .expect("resolve app-private component");
        let result = validate_component_package(&component_root, &package_root)
            .await
            .expect("validate app-private component");

        let schema = result.data["checks"]
            .as_array()
            .expect("checks")
            .iter()
            .find(|check| check["id"] == "componentSchema")
            .expect("component schema");
        assert_eq!(schema["status"], "passed", "{}", result.data);
        let _ = std::fs::remove_dir_all(base);
    }
}
