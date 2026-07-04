//! CreateComponentPackage tool - create shared Component packages.

use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::agentic::tools::implementations::util::has_app_studio_session_context;
use crate::app_platform::{
    create_component_package, ComponentKind, CreateComponentPackageDraft, WrittenComponentPackage,
};
use crate::infrastructure::try_get_path_manager_arc;
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use log::warn;
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

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

    async fn description(&self) -> BitFunResult<String> {
        Ok(r#"Create a shared Component Package through App Studio component authoring.

Supports the final component kinds: surface, agent, bridge, runtime, tool, and skill. The result is a reusable component package under the system component package root. Components are not Product Apps and do not enter the App Catalog until referenced by a Product App lock."#
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
                    "description": "Optional runtime implementation reference for shared components, for example skill://foo, agent://agentic, or bundle://bridge-components/foo. Product App private surfaces use app://... refs inside Product App packages."
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
    ) -> BitFunResult<Vec<ToolResult>> {
        let component_id = required_string(input, "component_id")?;
        let kind = required_component_kind(input)?;
        let name = required_string(input, "name")?;
        let component_name = name.clone();
        let description = required_string(input, "description")?;
        let component_description = description.clone();
        let version = optional_string(input, "version").unwrap_or_else(|| "1.0.0".to_string());
        let implementation_ref =
            optional_string(input, "implementation_ref").filter(|value| !value.trim().is_empty());

        let path_manager = try_get_path_manager_arc()
            .map_err(|e| BitFunError::tool(format!("PathManager not initialized: {}", e)))?;
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
        .map_err(|e| BitFunError::tool(format!("Failed to create Component package: {}", e)))?;

        let package_dir = written.package_dir.to_string_lossy().to_string();
        let kind = component_kind_name(written.kind);
        let kind_segment = written.kind.path_segment();
        let result_text = format!(
            "Component package created. component_id: {}. kind: {}. Package directory: {}. Reference it from a Product App instead of launching it directly.",
            written.component_id, kind, package_dir
        );

        if let Err(error) = bind_created_component_session(
            context,
            &written,
            CreatedComponentSessionBinding {
                component_name: &component_name,
                description: &component_description,
                kind,
                kind_segment,
                package_dir: &package_dir,
            },
        )
        .await
        {
            warn!(
                "Failed to bind created Component package to AppStudio session: session_id={:?}, component_id={}, error={}",
                context.session_id,
                written.component_id,
                error
            );
        }

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

struct CreatedComponentSessionBinding<'a> {
    component_name: &'a str,
    description: &'a str,
    kind: &'a str,
    kind_segment: &'a str,
    package_dir: &'a str,
}

async fn bind_created_component_session(
    context: &ToolUseContext,
    written: &WrittenComponentPackage,
    binding: CreatedComponentSessionBinding<'_>,
) -> BitFunResult<()> {
    if !has_app_studio_session_context(context) {
        return Ok(());
    }
    let Some(session_id) = context.session_id.as_deref() else {
        return Ok(());
    };
    let Some(agentic) = context.agentic() else {
        return Ok(());
    };

    let patch = created_component_session_metadata_patch(written, binding, now_ms());
    agentic
        .coordinator
        .merge_session_custom_metadata(session_id, patch)
        .await?;
    Ok(())
}

fn created_component_session_metadata_patch(
    written: &WrittenComponentPackage,
    binding: CreatedComponentSessionBinding<'_>,
    updated_at: u64,
) -> Value {
    json!({
        "agentSessionBinding": {
            "schemaVersion": 1,
            "intent": {
                "agentType": "AppStudio",
                "mode": "edit"
            },
            "subject": {
                "kind": "component",
                "id": written.component_id,
                "title": binding.component_name,
                "version": written.version,
                "data": {
                    "componentKind": binding.kind_segment,
                    "componentKindLabel": binding.kind,
                    "packageRoot": binding.package_dir,
                    "createdByTool": "CreateComponentPackage"
                }
            },
            "surface": {
                "contentType": "app-studio",
                "title": format!("Edit {}", binding.component_name),
                "data": {
                    "componentId": written.component_id,
                    "componentKind": binding.kind_segment,
                    "componentVersion": written.version,
                    "componentPackageRoot": binding.package_dir,
                    "componentName": binding.component_name,
                    "componentDescription": binding.description,
                    "packageRoot": binding.package_dir,
                    "scope": { "kind": "system" }
                }
            },
            "scope": { "kind": "system" },
            "workspacePath": null,
            "openedFrom": "CreateComponentPackage",
            "updatedAt": updated_at
        },
        "appStudioFacts": {
            "subject": {
                "kind": "component",
                "componentId": written.component_id,
                "componentKind": binding.kind_segment,
                "version": written.version,
                "packageRoot": binding.package_dir
            },
            "blueprint": {
                "whatItDoes": binding.description,
                "howReady": "Component package created; contract validation and Product App consumer checks still gate readiness."
            },
            "technicalBlueprint": {
                "componentId": written.component_id,
                "componentKind": binding.kind_segment,
                "kindLabel": binding.kind,
                "version": written.version
            },
            "previewResults": [],
            "issues": [],
            "logs": [],
            "componentGraph": {
                "componentCount": 1,
                "agentComponentCount": if binding.kind_segment == "agents" { 1 } else { 0 },
                "components": [
                    {
                        "componentId": written.component_id,
                        "kind": binding.kind,
                        "source": "shared",
                        "role": "subject",
                        "version": written.version
                    }
                ]
            },
            "agentSummary": {
                "backendActionCount": if binding.kind_segment == "agents" { 1 } else { 0 },
                "memoryScopes": [],
                "sessionPolicies": []
            },
            "dataSummary": {
                "readsWorkspace": false,
                "writesWorkspace": false,
                "usesRuntimeStorage": false,
                "externalAccess": false,
                "runtimeRunCount": 0,
                "artifactCount": 0
            },
            "evalSummary": {
                "status": "notRun",
                "caseCount": 0,
                "detail": "Component eval has not been run for this newly created Component package."
            },
            "validationSummary": {
                "status": "notRun",
                "failed": 0,
                "warnings": 0,
                "updatedAt": updated_at,
                "source": "derived",
                "checks": [
                    {
                        "id": "componentContract",
                        "status": "notRun",
                        "detail": "Component package created; run a component contract validation before reuse."
                    },
                    {
                        "id": "consumerCompatibility",
                        "status": "notVerified",
                        "detail": "No Product App consumer has validated this component yet."
                    }
                ]
            },
            "versionSummary": {
                "currentVersion": written.version,
                "checkpointCount": 0,
                "releaseStatus": "notVerified"
            },
            "shareSummary": {
                "visibility": "privateDraft",
                "installLocation": "system",
                "privateDataExcluded": true
            },
            "createResult": {
                "packageRoot": binding.package_dir,
                "createdAt": updated_at
            }
        }
    })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
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

fn required_component_kind(input: &Value) -> BitFunResult<ComponentKind> {
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
        _ => Err(BitFunError::validation(
            "kind must be one of surface, agent, bridge, runtime, tool, or skill".to_string(),
        )),
    }
}

fn required_string(input: &Value, field: &str) -> BitFunResult<String> {
    let value = optional_string(input, field)
        .ok_or_else(|| BitFunError::validation(format!("Missing required field: {field}")))?;
    if value.trim().is_empty() {
        return Err(BitFunError::validation(format!("{field} cannot be empty")));
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
    use std::path::PathBuf;

    #[test]
    fn created_component_session_metadata_patch_binds_component_package() {
        let package_dir = std::env::temp_dir()
            .join("sparo-created-component")
            .join("agents")
            .join("shared-agent")
            .join("1.0.0");
        let package_dir_string = package_dir.to_string_lossy().to_string();
        let written = WrittenComponentPackage {
            component_id: "shared-agent".to_string(),
            kind: ComponentKind::Agent,
            version: "1.0.0".to_string(),
            package_dir: PathBuf::from(&package_dir_string),
        };

        let patch = created_component_session_metadata_patch(
            &written,
            CreatedComponentSessionBinding {
                component_name: "Shared Agent",
                description: "Shared agent contract",
                kind: "agent",
                kind_segment: "agents",
                package_dir: &package_dir_string,
            },
            1234,
        );

        assert_eq!(
            patch
                .pointer("/agentSessionBinding/subject/kind")
                .and_then(Value::as_str),
            Some("component")
        );
        assert_eq!(
            patch
                .pointer("/agentSessionBinding/subject/id")
                .and_then(Value::as_str),
            Some("shared-agent")
        );
        assert_eq!(
            patch
                .pointer("/agentSessionBinding/subject/data/componentKind")
                .and_then(Value::as_str),
            Some("agents")
        );
        assert_eq!(
            patch
                .pointer("/agentSessionBinding/subject/data/packageRoot")
                .and_then(Value::as_str),
            Some(package_dir_string.as_str())
        );
        assert_eq!(
            patch
                .pointer("/agentSessionBinding/surface/data/componentVersion")
                .and_then(Value::as_str),
            Some("1.0.0")
        );
        assert_eq!(
            patch
                .pointer("/agentSessionBinding/surface/data/componentPackageRoot")
                .and_then(Value::as_str),
            Some(package_dir_string.as_str())
        );
        assert_eq!(
            patch
                .pointer("/appStudioFacts/subject/componentKind")
                .and_then(Value::as_str),
            Some("agents")
        );
        assert_eq!(
            patch
                .pointer("/appStudioFacts/subject/version")
                .and_then(Value::as_str),
            Some("1.0.0")
        );
        assert_eq!(
            patch
                .pointer("/appStudioFacts/subject/packageRoot")
                .and_then(Value::as_str),
            Some(package_dir_string.as_str())
        );
        assert_eq!(
            patch
                .pointer("/appStudioFacts/validationSummary/checks/0/id")
                .and_then(Value::as_str),
            Some("componentContract")
        );
    }
}
