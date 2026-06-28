//! CreateProductApp tool - create a Product App package starter.

use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::app_platform::{
    create_product_app_package, AppSurfaceMode, CreateProductAppPackageDraft,
};
use crate::infrastructure::try_get_path_manager_arc;
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct CreateProductAppTool;

impl CreateProductAppTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for CreateProductAppTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for CreateProductAppTool {
    fn name(&self) -> &str {
        "CreateProductApp"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok(r#"Create a new Product App package starter. The tool writes an app.json package with private Surface and Agent components plus a component lock.

Input: name, description, category. Optional app_id can be supplied when the user names a durable package id.

Returns app_id, component_lock_digest, and the Product App package directory. Edit files inside this package only. Do not write legacy Surface Component meta.json/source layouts."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["name"],
            "properties": {
                "app_id": {
                    "type": "string",
                    "description": "Optional durable Product App id. ASCII letters, numbers, '-' or '_'."
                },
                "name": {
                    "type": "string",
                    "description": "Short app name, for example 'Image Compressor' or 'Markdown Viewer'."
                },
                "description": {
                    "type": "string",
                    "description": "One-sentence app description. Default empty."
                },
                "goal": {
                    "type": "string",
                    "description": "The Product App goal. Defaults to the description or app name."
                },
                "category": {
                    "type": "string",
                    "description": "Catalog category, for example utility, media, dev, or productivity."
                },
                "agent_type": {
                    "type": "string",
                    "description": "Agent runtime type for the generated private agent component. Default agentic."
                },
                "primary_surface_mode": {
                    "type": "string",
                    "enum": ["chatPrimary", "sidecarLinked", "immersivePrimary", "embeddedObject"],
                    "description": "Primary surface host mode. Defaults to chatPrimary unless the user explicitly asks for an interactive workspace surface."
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
        _context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let name = required_string(input, "name")?;
        let description = optional_string(input, "description").unwrap_or_default();
        let goal = optional_string(input, "goal")
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                if description.trim().is_empty() {
                    format!("Use {} as a focused Product App workflow.", name)
                } else {
                    description.clone()
                }
            });
        let app_id = optional_string(input, "app_id")
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| generated_app_id(&name));
        let category = optional_string(input, "category").unwrap_or_else(|| "utility".to_string());
        let agent_type =
            optional_string(input, "agent_type").unwrap_or_else(|| "agentic".to_string());
        let primary_surface_mode = optional_surface_mode(input)?
            .unwrap_or(AppSurfaceMode::ChatPrimary);

        let path_manager = try_get_path_manager_arc()
            .map_err(|e| BitFunError::tool(format!("PathManager not initialized: {}", e)))?;
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id,
                name,
                description,
                goal,
                version: "1.0.0".to_string(),
                agent_type,
                category,
                tags: Vec::new(),
                primary_surface_mode,
                truth_source: None,
            },
        )
        .await
        .map_err(|e| BitFunError::tool(format!("Failed to create Product App package: {}", e)))?;

        let package_dir = written.package_dir.to_string_lossy().to_string();
        let files = json!({
            "app": written.package_dir.join("app.json").to_string_lossy(),
            "lock": written.package_dir.join("app.lock.json").to_string_lossy(),
            "surfaceComponent": written.package_dir
                .join("components")
                .join("surfaces")
                .join(format!("{}-surface", written.app_id))
                .join("component.json")
                .to_string_lossy(),
            "agentComponent": written.package_dir
                .join("components")
                .join("agents")
                .join(format!("{}-agent", written.app_id))
                .join("component.json")
                .to_string_lossy(),
            "validationPlan": written.package_dir
                .join("tests")
                .join("validation-plan.md")
                .to_string_lossy(),
        });

        let result_text = format!(
            "Product App package created. app_id: {}. Package directory: {}. Edit app.json, private components, work objects, and validation files inside this package.",
            written.app_id, package_dir
        );

        Ok(vec![ToolResult::Result {
            data: json!({
                "app_id": written.app_id,
                "version": written.version,
                "component_lock_digest": written.component_lock_digest,
                "path": package_dir,
                "files": files,
            }),
            result_for_assistant: Some(result_text),
            image_attachments: None,
        }])
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

fn optional_surface_mode(input: &Value) -> BitFunResult<Option<AppSurfaceMode>> {
    let Some(value) = optional_string(input, "primary_surface_mode") else {
        return Ok(None);
    };
    let mode = match value.as_str() {
        "chatPrimary" => AppSurfaceMode::ChatPrimary,
        "sidecarLinked" => AppSurfaceMode::SidecarLinked,
        "immersivePrimary" => AppSurfaceMode::ImmersivePrimary,
        "embeddedObject" => AppSurfaceMode::EmbeddedObject,
        _ => {
            return Err(BitFunError::validation(
                "primary_surface_mode must be one of chatPrimary, sidecarLinked, immersivePrimary, or embeddedObject"
                    .to_string(),
            ))
        }
    };
    Ok(Some(mode))
}

fn generated_app_id(name: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;
    for ch in name.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            previous_dash = false;
        } else if !previous_dash && !slug.is_empty() {
            slug.push('-');
            previous_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        slug.push_str("product-app");
    }
    format!("{}-{}", slug, chrono::Utc::now().timestamp_millis())
}
