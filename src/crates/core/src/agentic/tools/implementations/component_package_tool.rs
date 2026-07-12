//! CreateComponentPackage tool - system-level shared Component package authoring.

use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::app_platform::{create_component_package, ComponentKind, CreateComponentPackageDraft};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::try_get_path_manager_arc;
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct CreateComponentPackageTool;

impl CreateComponentPackageTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for CreateComponentPackageTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for CreateComponentPackageTool {
    fn name(&self) -> &str {
        "CreateComponentPackage"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Create a system-level shared Component Package outside AppBuilder.

Supports the final component kinds: surface, agent, bridge, runtime, tool, and skill. The result is a reusable component package under the system component package root. AppBuilder creates only app-private Components with CreateProductAppComponent inside its bound Draft. Shared Components are not Product Apps and do not enter the App Catalog until referenced by a Product App lock."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["component_id", "kind", "name", "description"],
            "properties": {
                "component_id": {
                    "type": "string",
                    "description": "Durable component id. ASCII letters, numbers, '-' or '_'."
                },
                "kind": {
                    "type": "string",
                    "enum": ["surface", "agent", "bridge", "runtime", "tool", "skill"],
                    "description": "Component kind."
                },
                "name": {
                    "type": "string",
                    "description": "Short component name."
                },
                "description": {
                    "type": "string",
                    "description": "One-sentence component contract summary."
                },
                "version": {
                    "type": "string",
                    "description": "Semver package version. Defaults to 1.0.0."
                },
                "implementation_ref": {
                    "type": "string",
                    "description": "Optional runtime implementation reference for shared components, for example skill://foo, agent://Runno, or bundle://bridge-components/foo. Product App private surfaces use app://... refs inside Product App packages."
                }
            }
        })
    }

    fn is_readonly(&self) -> bool {
        false
    }

    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        false
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> CoreResult<Vec<ToolResult>> {
        if context.agent_type.as_deref() == Some("AppBuilder") || context.app_builder.is_some() {
            return Err(CoreError::validation(
                "AppBuilder cannot create or mutate shared Component packages; create an App-private component inside the bound Draft",
            ));
        }
        let component_id = required_string(input, "component_id")?;
        let kind = required_component_kind(input)?;
        let name = required_string(input, "name")?;
        let description = required_string(input, "description")?;
        let version = optional_string(input, "version").unwrap_or_else(|| "1.0.0".to_string());
        let implementation_ref =
            optional_string(input, "implementation_ref").filter(|value| !value.trim().is_empty());

        let path_manager = try_get_path_manager_arc()
            .map_err(|e| CoreError::tool(format!("PathManager not initialized: {}", e)))?;
        let written = create_component_package(
            &path_manager,
            CreateComponentPackageDraft {
                component_id,
                kind,
                name,
                description,
                version,
                implementation_ref,
            },
        )
        .await
        .map_err(|e| CoreError::tool(format!("Failed to create Component package: {}", e)))?;

        let package_dir = written.package_dir.to_string_lossy().to_string();
        let kind = component_kind_name(written.kind);
        let kind_segment = written.kind.path_segment();
        let result_text = format!(
            "Component package created. component_id: {}. kind: {}. Package directory: {}. Reference it from a Product App instead of launching it directly.",
            written.component_id, kind, package_dir
        );

        Ok(vec![ToolResult::Result {
            data: json!({
                "component_id": written.component_id,
                "componentId": written.component_id,
                "kind": kind,
                "component_kind": kind_segment,
                "componentKind": kind_segment,
                "version": written.version,
                "path": package_dir,
                "packageRoot": package_dir,
                "files": {
                    "component": written.package_dir.join("component.json").to_string_lossy(),
                    "implementationReadme": written.package_dir.join("src").join("README.md").to_string_lossy(),
                    "contract": written.package_dir.join("tests").join("contract.md").to_string_lossy(),
                },
            }),
            result_for_assistant: Some(result_text),
            image_attachments: None,
        }])
    }
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

fn required_component_kind(input: &Value) -> CoreResult<ComponentKind> {
    let kind = required_string(input, "kind")?;
    let normalized = kind
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|ch| !matches!(*ch, '_' | ' ' | '-'))
        .collect::<String>();
    match normalized.as_str() {
        "surface" | "surfacecomponent" => Ok(ComponentKind::Surface),
        "agent" | "agentcomponent" => Ok(ComponentKind::Agent),
        "bridge" | "bridgecomponent" => Ok(ComponentKind::Bridge),
        "runtime" | "runtimecomponent" => Ok(ComponentKind::Runtime),
        "tool" | "toolcomponent" => Ok(ComponentKind::Tool),
        "skill" | "skillcomponent" => Ok(ComponentKind::Skill),
        _ => Err(CoreError::validation(
            "kind must be one of surface, agent, bridge, runtime, tool, or skill".to_string(),
        )),
    }
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
