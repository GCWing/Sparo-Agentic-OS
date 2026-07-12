//! CreateProductApp tool - create a Product App package starter.

use crate::agentic::app_builder_context::AppBuilderSubject;
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::agentic::tools::implementations::util::{
    bound_app_builder_draft_root, enforce_app_builder_package_write,
};
use crate::app_platform::{
    create_product_app_component_scaffold, default_product_app_work_multiplicity_for_surface_mode,
    list_system_shared_components, scaffold_product_app_draft, AppAuthor, AppI18n, AppIconSpec,
    AppInteractionModel, AppSurfaceMode, AppWorkMultiplicity, ComponentKind,
    CreateProductAppComponentDraft, CreateProductAppPackageDraft, CreateProductAppPackageOptions,
    ProductAppLaunch, ProductAppLaunchKind, ProductAppLaunchScopeRequirement, ProductAppResolver,
    SurfaceRef,
};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::try_get_path_manager_arc;
use async_trait::async_trait;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tokio::fs;

pub struct CreateProductAppTool;
pub struct CreateProductAppComponentTool;
pub struct GetProductAppPackageTool;
pub struct UpdateProductAppPackageTool;
pub struct RefreshProductAppLockTool;
pub struct ResolveBuilderPreviewTargetTool;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProductAppEntryKind {
    Agent,
    Surface,
    SurfaceAgent,
}

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

impl CreateProductAppComponentTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for CreateProductAppComponentTool {
    fn default() -> Self {
        Self::new()
    }
}

impl GetProductAppPackageTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for GetProductAppPackageTool {
    fn default() -> Self {
        Self::new()
    }
}

impl UpdateProductAppPackageTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for UpdateProductAppPackageTool {
    fn default() -> Self {
        Self::new()
    }
}

impl RefreshProductAppLockTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for RefreshProductAppLockTool {
    fn default() -> Self {
        Self::new()
    }
}

impl ResolveBuilderPreviewTargetTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ResolveBuilderPreviewTargetTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for CreateProductAppTool {
    fn name(&self) -> &str {
        "CreateProductApp"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Create a new Product App package. The tool writes an app.json package with an explicit Product App entry: agent, surface, or surfaceAgent. It creates the required app-private Component scaffolds and a component lock.

Input: name, description, category. Optional app_id can be supplied when the user names a durable package id.

The package is created only inside the already-bound Draft. Returns its identity, optional primary surface, optional agent component, launch policy, interaction model, component lock digest, validation seed, and editable Draft paths."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["name", "description"],
            "properties": {
                "app_id": {
                    "type": "string",
                    "description": "Optional assertion of the bound Draft App id; a mismatch is rejected."
                },
                "name": {
                    "type": "string",
                    "description": "Short app name, for example 'Image Compressor' or 'Markdown Viewer'."
                },
                "description": {
                    "type": "string",
                    "description": "One-sentence catalog description that tells users when to choose this Product App."
                },
                "i18n": {
                    "type": "object",
                    "description": "Optional localized catalog metadata, shaped as { locales: { \"zh-CN\": { name, description, tags }, \"en-US\": { name, description, tags } } }."
                },
                "authors": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["name"],
                        "properties": {
                            "name": { "type": "string" },
                            "url": { "type": "string" }
                        }
                    },
                    "description": "Optional Product App authors. Use one item for a single author; include url for a clickable catalog link."
                },
                "category": {
                    "type": "string",
                    "description": "Catalog category, for example utility, media, dev, or productivity."
                },
                "agent_type": {
                    "type": "string",
                    "description": "Agent runtime type for the generated private agent component when include_agent is true. Default Runno."
                },
                "entry_kind": {
                    "type": "string",
                    "enum": ["agent", "surface", "surfaceAgent"],
                    "description": "Product App entry to scaffold. agent creates a pure app-private Agent entry that opens in the normal session UI; surface creates a UI-only Product App; surfaceAgent creates both UI and app-private Agent behavior."
                },
                "include_agent": {
                    "type": "boolean",
                    "description": "Convenience when entry_kind is omitted. true maps to surfaceAgent, false maps to surface."
                },
                "primary_surface_mode": {
                    "type": "string",
                    "enum": ["chatPrimary", "sidecarLinked", "immersivePrimary", "embeddedObject"],
                    "description": "Surface host mode when entry_kind includes a surface. Defaults to immersivePrimary."
                },
                "work_multiplicity": {
                    "type": "string",
                    "enum": ["multiple", "singleton"],
                    "description": "Whether the app opens independent Works or reuses one Work per scope. Agent entries default to multiple; surface entries default from primary_surface_mode."
                }
            }
        })
    }

    fn is_readonly(&self) -> bool {
        false
    }

    fn mutates_app_builder_draft(&self) -> bool {
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
        let name = required_string(input, "name")?;
        let description = required_string(input, "description")?;
        let app_description = description.clone();
        let requested_app_id =
            optional_string(input, "app_id").filter(|value| !value.trim().is_empty());
        let category = optional_string(input, "category").unwrap_or_else(|| "utility".to_string());
        let i18n = optional_i18n(input)?;
        let authors = optional_authors(input)?.unwrap_or_default();
        let agent_type =
            optional_string(input, "agent_type").unwrap_or_else(|| "Runno".to_string());
        let include_agent_hint = optional_bool(input, "include_agent")?;
        let entry_kind = optional_entry_kind(input)?.unwrap_or_else(|| match include_agent_hint {
            Some(true) => ProductAppEntryKind::SurfaceAgent,
            Some(false) | None => ProductAppEntryKind::Surface,
        });
        let include_surface = matches!(
            entry_kind,
            ProductAppEntryKind::Surface | ProductAppEntryKind::SurfaceAgent
        );
        let include_agent = matches!(
            entry_kind,
            ProductAppEntryKind::Agent | ProductAppEntryKind::SurfaceAgent
        );
        let primary_surface_mode =
            optional_surface_mode(input)?.unwrap_or(AppSurfaceMode::ImmersivePrimary);
        let work_multiplicity = optional_work_multiplicity(input)?.unwrap_or_else(|| {
            if include_surface {
                default_product_app_work_multiplicity_for_surface_mode(primary_surface_mode)
            } else {
                AppWorkMultiplicity::Multiple
            }
        });
        let launch_kind = if include_surface {
            "applicationSurface"
        } else {
            "agentSession"
        };
        let interaction_model = if include_surface {
            "interactiveWorkspace"
        } else {
            "conversation"
        };
        let scope_requirement = if include_surface {
            "systemAllowed"
        } else {
            "workspaceOptional"
        };

        let draft_root =
            bound_app_builder_draft_root(context, "CreateProductApp")?.ok_or_else(|| {
                CoreError::validation(
                    "CreateProductApp is only available inside an authorized Intelligent App Draft",
                )
            })?;
        let draft_id = match context.app_builder.as_ref().map(|builder| &builder.subject) {
            Some(AppBuilderSubject::BuilderDraft { draft_id, .. }) => draft_id,
            _ => {
                return Err(CoreError::validation(
                    "CreateProductApp requires an authoritative Builder Draft identity",
                ))
            }
        };
        let app_id = authoritative_bound_draft_app_id(&draft_root, draft_id).await?;
        if requested_app_id
            .as_deref()
            .is_some_and(|requested| requested != app_id)
        {
            return Err(CoreError::validation(format!(
                "CreateProductApp app_id must match the bound Draft App {}",
                app_id
            )));
        }
        let primary_surface_id = include_surface.then(|| format!("{app_id}-surface"));
        let agent_component_id = include_agent.then(|| format!("{app_id}-agent"));
        let written = scaffold_product_app_draft(
            &draft_root,
            CreateProductAppPackageDraft {
                app_id,
                name,
                description,
                authors,
                i18n,
                version: "1.0.0".to_string(),
                agent_type,
                category,
                tags: Vec::new(),
                primary_surface_mode,
                work_multiplicity: Some(work_multiplicity),
                truth_source: None,
            },
            CreateProductAppPackageOptions {
                include_agent: Some(include_agent),
                include_surface: Some(include_surface),
            },
        )
        .await
        .map_err(|e| CoreError::tool(format!("Failed to create Product App package: {}", e)))?;

        let package_dir = written.package_dir.to_string_lossy().to_string();
        let agent_component_file = agent_component_id.as_ref().map(|component_id| {
            written
                .package_dir
                .join("components")
                .join("agents")
                .join(component_id)
                .join("component.json")
                .to_string_lossy()
                .to_string()
        });
        let primary_surface_dir = primary_surface_id.as_ref().map(|surface_id| {
            written
                .package_dir
                .join("components")
                .join("surfaces")
                .join(surface_id)
        });
        let files = json!({
            "app": written.package_dir.join("app.json").to_string_lossy(),
            "lock": written.package_dir.join("app.lock.json").to_string_lossy(),
            "primarySurface": primary_surface_dir.as_ref().map(|dir| dir
                .join("component.json")
                .to_string_lossy()
                .to_string()),
            "primarySurfaceSource": primary_surface_dir.as_ref().map(|dir| json!({
                "root": dir.join("source").to_string_lossy(),
                "index": dir.join("source").join("index.html").to_string_lossy(),
                "style": dir.join("source").join("style.css").to_string_lossy(),
                "ui": dir.join("source").join("ui.js").to_string_lossy(),
                "worker": dir.join("source").join("worker.js").to_string_lossy()
            })),
            "agentComponent": agent_component_file,
            "validationPlan": written.package_dir
                .join("tests")
                .join("validation-plan.md")
                .to_string_lossy(),
            "rehearsal": written.package_dir
                .join("tests")
                .join("rehearsal.json")
                .to_string_lossy(),
            "eval": if include_agent {
                Some(written.package_dir.join("tests").join("eval.json").to_string_lossy().to_string())
            } else {
                None
            },
        });

        let result_text = format!(
            "Product App package created. app_id: {}. Package directory: {}. Edit app.json, private components, work objects, and validation files inside this package.",
            written.app_id, package_dir
        );
        let skill_hints = default_product_app_skill_hints(include_surface, include_agent);

        Ok(vec![ToolResult::Result {
            data: json!({
                "app_id": written.app_id,
                "version": written.version,
                "component_lock_digest": written.component_lock_digest,
                "primary_surface_id": primary_surface_id,
                "agent_component_id": agent_component_id,
                "entry_kind": entry_kind_name(entry_kind),
                "include_agent": include_agent,
                "include_surface": include_surface,
                "primary_surface_mode": include_surface.then_some(primary_surface_mode),
                "work_multiplicity": work_multiplicity,
                "launch_kind": launch_kind,
                "scope_requirement": scope_requirement,
                "interaction_model": interaction_model,
                "path": package_dir,
                "files": files,
                "skill_hints": skill_hints,
                "blueprint_seed": {
                    "what_it_does": app_description,
                    "how_i_use_it": if !include_surface {
                        "Use the Product App through its app-private agent in the normal session UI."
                    } else if primary_surface_mode == AppSurfaceMode::SidecarLinked {
                        "Chat with the app while using the right-side panel."
                    } else {
                        "Use the app in a full runnable preview surface."
                    },
                    "what_ai_does": if include_agent {
                        "The app-private Agent Component is available for intelligent backend actions when the app declares service actions."
                    } else {
                        "No AI backend is declared yet. Add an app-private Agent Component only if the app needs intelligent behavior."
                    },
                    "what_data": "Product App package metadata and runtime Work state. Add external data only when the user intent requires it.",
                    "how_ready": if include_agent {
                        "Validate package graph, component lock, launch policy, preview load, runtime issues, permissions, data boundary, and Agent Eval before final handoff."
                    } else {
                        "Validate package graph, component lock, launch policy, preview load, runtime issues, permissions, data boundary, and user-path rehearsal before final handoff."
                    }
                },
                "validation_seed": {
                    "package": "created",
                    "preview": "notRun",
                    "runtime": "notRun",
                    "agent_eval": if include_agent { "notRun" } else { "notRequired" },
                    "release_gate": "blockedUntilValidated"
                },
                "component_scaffold": {
                    "tool": "CreateProductAppComponent",
                    "supported_kinds": ["surface", "agent", "bridge", "runtime", "tool", "skill"],
                    "boundary": "app-private only"
                },
                "next_steps": [
                    "Read the generated source files before editing behavior.",
                    "Call CreateProductAppComponent when the Product App needs another app-private implementation unit.",
                    "Run ValidateProductAppPackage after meaningful package or component edits.",
                    "Run RunBuilderPreview for runtime, user-path, and agent-eval evidence when applicable."
                ]
            }),
            result_for_assistant: Some(result_text),
            image_attachments: None,
        }])
    }
}

#[async_trait]
impl Tool for CreateProductAppComponentTool {
    fn name(&self) -> &str {
        "CreateProductAppComponent"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Create an app-private Component scaffold inside an existing Product App package, update app.json references, refresh app.lock.json, and return editable paths.

Supports Product App private component kinds: surface, agent, bridge, runtime, tool, and skill. This is not shared Component Package authoring; use it when the current Product App needs another implementation unit."#
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
                    "description": "App-private component id. ASCII letters, numbers, '-' or '_'."
                },
                "kind": {
                    "type": "string",
                    "enum": ["surface", "agent", "bridge", "runtime", "tool", "skill"],
                    "description": "Component kind to scaffold inside the Product App package."
                },
                "name": {
                    "type": "string",
                    "description": "Short component name."
                },
                "description": {
                    "type": "string",
                    "description": "One-sentence component contract summary."
                },
                "role": {
                    "type": "string",
                    "description": "Optional app role for app.json components. Defaults from kind."
                },
                "implementation_ref": {
                    "type": "string",
                    "description": "Optional implementationRef override. Surface defaults to app://<app>@<version>/surfaces/<component_id>; Agent defaults to agent://<agent_type>."
                },
                "agent_type": {
                    "type": "string",
                    "description": "Agent runtime type when kind=agent and implementation_ref is omitted. Defaults to Runno."
                },
                "make_primary_surface": {
                    "type": "boolean",
                    "description": "When kind=surface, also make the new surface the Product App primary surface."
                }
            },
            "description": "Create app-private Product App component scaffolds after the AI chooses the implementation units the app needs."
        })
    }

    fn is_readonly(&self) -> bool {
        false
    }

    fn mutates_app_builder_draft(&self) -> bool {
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
        let package_dir = bound_product_app_draft_root(context, "CreateProductAppComponent")?;
        enforce_app_builder_package_write(context, &package_dir.to_string_lossy()).await?;
        let component_id = required_string(input, "component_id")?;
        let kind = required_component_kind(input)?;
        let name = required_string(input, "name")?;
        let description = required_string(input, "description")?;
        let role = optional_string(input, "role").filter(|value| !value.trim().is_empty());
        let implementation_ref =
            optional_string(input, "implementation_ref").filter(|value| !value.trim().is_empty());
        let agent_type =
            optional_string(input, "agent_type").filter(|value| !value.trim().is_empty());
        let make_primary_surface = optional_bool(input, "make_primary_surface")?.unwrap_or(false);
        let shared_components =
            list_system_shared_components(&path_manager)
                .await
                .map_err(|e| {
                    CoreError::tool(format!("Failed to read system shared components: {}", e))
                })?;

        let written = create_product_app_component_scaffold(
            CreateProductAppComponentDraft {
                package_dir: package_dir.clone(),
                component_id,
                kind,
                name,
                description,
                role,
                implementation_ref,
                agent_type,
                make_primary_surface,
            },
            shared_components,
        )
        .await
        .map_err(|e| {
            CoreError::tool(format!(
                "Failed to create Product App component scaffold: {}",
                e
            ))
        })?;

        let kind_name = component_kind_name(written.kind);
        let generated_files = written
            .generated_files
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        let skill_hints = component_skill_hints(written.kind);

        Ok(vec![ToolResult::Result {
            data: json!({
                "app_id": written.app_id,
                "version": written.version,
                "component_id": written.component_id,
                "kind": kind_name,
                "role": written.role,
                "component_lock_digest": written.component_lock_digest,
                "package_root": written.package_dir.to_string_lossy(),
                "component_root": written.component_dir.to_string_lossy(),
                "files": {
                    "component": written.component_dir.join("component.json").to_string_lossy(),
                    "source": written.component_dir.join("source").to_string_lossy(),
                    "app": written.package_dir.join("app.json").to_string_lossy(),
                    "lock": written.package_dir.join("app.lock.json").to_string_lossy(),
                    "generated": generated_files,
                },
                "skill_hints": skill_hints,
                "next_steps": [
                    "Read the generated component.json and source scaffold before editing behavior.",
                    "Implement only the component behavior the Product App actually needs.",
                    "Run ValidateProductAppPackage after meaningful component edits.",
                    "Run RunBuilderPreview for package, runtime, user-path, and agent-eval evidence when applicable."
                ]
            }),
            result_for_assistant: Some(format!(
                "Created app-private {} component scaffold {} in {}. app.lock.json refreshed.",
                kind_name,
                written.component_id,
                written.component_dir.display()
            )),
            image_attachments: None,
        }])
    }
}

#[async_trait]
impl Tool for GetProductAppPackageTool {
    fn name(&self) -> &str {
        "GetProductAppPackage"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Read the current bound Intelligent App Draft package and return its package, component graph, lock, rehearsal, and eval summary without modifying files."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {},
            "description": "The package is derived exclusively from the bound Draft identity."
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
        _input: &Value,
        context: &ToolUseContext,
    ) -> CoreResult<Vec<ToolResult>> {
        let path_manager = try_get_path_manager_arc()
            .map_err(|e| CoreError::tool(format!("PathManager not initialized: {}", e)))?;
        let package_dir = bound_product_app_draft_root(context, "GetProductAppPackage")?;
        let package = ProductAppResolver::read_product_app_package(&package_dir)
            .await
            .map_err(|e| CoreError::tool(format!("Failed to read Product App package: {}", e)))?;
        let lock = ProductAppResolver::read_lock(&package_dir)
            .await
            .map_err(|e| CoreError::tool(format!("Failed to read app.lock.json: {}", e)))?;
        let shared_components =
            list_system_shared_components(&path_manager)
                .await
                .map_err(|e| {
                    CoreError::tool(format!("Failed to read system shared components: {}", e))
                })?;
        let resolved =
            ProductAppResolver::resolve_package_install(package.clone(), shared_components)
                .map_err(|e| CoreError::tool(format!("Product App resolver failed: {}", e)))?;
        let declared_lock_digest = package.app.component_lock_id.clone();
        let file_lock_digest = lock.digest();
        let resolved_lock_digest = resolved.lock.digest();
        let lock_consistent =
            declared_lock_digest == file_lock_digest && file_lock_digest == resolved_lock_digest;
        let app_id = package.app.id.clone();
        let app_version = package.app.version.clone();
        let primary_surface_id = package
            .app
            .primary_surface
            .as_ref()
            .map(|surface| surface.component_id.clone());
        let primary_surface_mode = package.app.primary_surface_mode;
        let launch = package.app.launch.clone();
        let private_component_count = package.private_components.len();
        let resolved_component_count = resolved.components.len();
        let rehearsal_scenario_count = package
            .rehearsal_plan
            .as_ref()
            .map(|plan| plan.scenarios.len())
            .unwrap_or(0);
        let eval_case_count = package
            .eval_plan
            .as_ref()
            .map(|plan| plan.cases.len())
            .unwrap_or(0);
        let app = package.app;
        let private_components = package.private_components;
        let rehearsal_plan = package.rehearsal_plan;
        let eval_plan = package.eval_plan;
        let resolved_components = resolved.components;

        Ok(vec![ToolResult::Result {
            data: json!({
                "app_id": app_id.clone(),
                "version": app_version.clone(),
                "package_root": package_dir.to_string_lossy(),
                "app": app,
                "primary_surface_id": primary_surface_id,
                "primary_surface_mode": primary_surface_mode,
                "launch": launch,
                "component_graph": {
                    "private_component_count": private_component_count,
                    "resolved_component_count": resolved_component_count,
                    "private_components": private_components,
                    "resolved_components": resolved_components,
                },
                "component_lock": {
                    "declared": declared_lock_digest.clone(),
                    "file": file_lock_digest.clone(),
                    "resolved": resolved_lock_digest.clone(),
                    "consistent": lock_consistent,
                },
                "plans": {
                    "rehearsal_scenario_count": rehearsal_scenario_count,
                    "eval_case_count": eval_case_count,
                    "rehearsal": rehearsal_plan,
                    "eval": eval_plan,
                },
                "files": {
                    "app": package_dir.join("app.json").to_string_lossy(),
                    "lock": package_dir.join("app.lock.json").to_string_lossy(),
                    "components": package_dir.join("components").to_string_lossy(),
                    "tests": package_dir.join("tests").to_string_lossy(),
                }
            }),
            result_for_assistant: Some(format!(
                "Read Product App package {}@{} at {}. Lock consistent: {}.",
                app_id,
                app_version,
                package_dir.display(),
                lock_consistent
            )),
            image_attachments: None,
        }])
    }
}

#[async_trait]
impl Tool for UpdateProductAppPackageTool {
    fn name(&self) -> &str {
        "UpdateProductAppPackage"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Update structured metadata and launch fields in the current bound Intelligent App Draft, then refresh app.json component_lock_id and app.lock.json. Supported updates: name, description, authors, i18n, category, structured icon, tags, work_multiplicity, interaction_model, primary_surface_id, primary_surface_mode, launch_kind, launch_target_id, launch_scope_requirement, launch_agent_type, launch_surface_id. Use component authoring or file tools for private component source edits."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "name": { "type": "string" },
                "description": { "type": "string" },
                "i18n": {
                    "type": "object",
                    "description": "Localized catalog metadata, shaped as { locales: { \"zh-CN\": { name, description, tags }, \"en-US\": { name, description, tags } } }."
                },
                "authors": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["name"],
                        "properties": {
                            "name": { "type": "string" },
                            "url": { "type": "string" }
                        }
                    },
                    "description": "Replace Product App authors. Use an empty array to clear authors."
                },
                "category": { "type": "string" },
                "icon": {
                    "type": "object",
                    "additionalProperties": false,
                    "oneOf": [
                        {
                            "properties": {
                                "kind": { "const": "packageAsset" },
                                "path": { "type": "string" },
                                "background": { "type": "string" }
                            },
                            "required": ["kind", "path"]
                        },
                        {
                            "properties": {
                                "kind": { "const": "nativeAsset" },
                                "assetId": { "type": "string" },
                                "background": { "type": "string" }
                            },
                            "required": ["kind", "assetId"]
                        },
                        {
                            "properties": {
                                "kind": { "const": "lucide" },
                                "name": { "type": "string" },
                                "background": { "type": "string" }
                            },
                            "required": ["kind", "name"]
                        },
                        {
                            "properties": {
                                "kind": { "const": "monogram" },
                                "label": { "type": "string" },
                                "seed": { "type": "string" },
                                "background": { "type": "string" }
                            },
                            "required": ["kind", "label"]
                        }
                    ]
                },
                "tags": { "type": "array", "items": { "type": "string" } },
                "work_multiplicity": {
                    "type": "string",
                    "enum": ["multiple", "singleton"]
                },
                "interaction_model": {
                    "type": "string",
                    "enum": ["conversation", "interactiveWorkspace"]
                },
                "primary_surface_id": {
                    "type": "string",
                    "description": "Primary private Product App surface id."
                },
                "primary_surface_mode": {
                    "type": "string",
                    "enum": ["chatPrimary", "sidecarLinked", "immersivePrimary", "embeddedObject"]
                },
                "launch_kind": {
                    "type": "string",
                    "enum": ["agentSession", "applicationSurface", "appBuilder"]
                },
                "launch_target_id": { "type": "string" },
                "launch_scope_requirement": {
                    "type": "string",
                    "enum": ["systemAllowed", "workspaceOptional", "workspaceRequired"]
                },
                "launch_agent_type": { "type": "string" },
                "launch_surface_id": { "type": "string" }
            },
            "description": "Update only structured Product App package fields. At least one update field is required."
        })
    }

    fn is_readonly(&self) -> bool {
        false
    }

    fn mutates_app_builder_draft(&self) -> bool {
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
        let package_dir = bound_product_app_draft_root(context, "UpdateProductAppPackage")?;
        let mut package = ProductAppResolver::read_product_app_package(&package_dir)
            .await
            .map_err(|e| CoreError::tool(format!("Failed to read Product App package: {}", e)))?;
        let previous_app_id = package.app.id.clone();
        let previous_version = package.app.version.clone();
        let previous_lock = package.app.component_lock_id.clone();
        let mut changed_fields = Vec::new();

        apply_string_update(
            input,
            "name",
            &mut package.app.name,
            &mut changed_fields,
            false,
        )?;
        apply_string_update(
            input,
            "description",
            &mut package.app.description,
            &mut changed_fields,
            true,
        )?;
        apply_string_update(
            input,
            "category",
            &mut package.app.category,
            &mut changed_fields,
            true,
        )?;
        if let Some(i18n) = optional_i18n_update(input)? {
            if package.app.i18n != i18n {
                package.app.i18n = i18n;
                changed_fields.push("i18n".to_string());
            }
        }
        if let Some(authors) = optional_authors(input)? {
            if package.app.authors != authors {
                package.app.authors = authors;
                changed_fields.push("authors".to_string());
            }
        }
        if let Some(icon) = optional_app_icon(input, "icon")? {
            if package.app.icon != icon {
                package.app.icon = icon;
                changed_fields.push("icon".to_string());
            }
        }

        if let Some(tags) = optional_string_array(input, "tags")? {
            if package.app.tags != tags {
                package.app.tags = tags;
                changed_fields.push("tags".to_string());
            }
        }
        let requested_surface_mode = optional_surface_mode(input)?;
        let requested_work_multiplicity = optional_work_multiplicity(input)?;

        if let Some(mode) = requested_surface_mode {
            if package.app.primary_surface_mode != Some(mode) {
                package.app.primary_surface_mode = Some(mode);
                changed_fields.push("primary_surface_mode".to_string());
            }
            if requested_work_multiplicity.is_none() {
                let default_work_multiplicity =
                    default_product_app_work_multiplicity_for_surface_mode(mode);
                if package.app.work_multiplicity != default_work_multiplicity {
                    package.app.work_multiplicity = default_work_multiplicity;
                    changed_fields.push("work_multiplicity".to_string());
                }
            }
        }
        if let Some(interaction_model) = optional_interaction_model(input)? {
            if package.app.interaction_model != interaction_model {
                package.app.interaction_model = interaction_model;
                changed_fields.push("interaction_model".to_string());
            }
        }
        if let Some(work_multiplicity) = requested_work_multiplicity {
            if package.app.work_multiplicity != work_multiplicity {
                package.app.work_multiplicity = work_multiplicity;
                changed_fields.push("work_multiplicity".to_string());
            }
        }
        if let Some(primary_surface_id) =
            optional_string(input, "primary_surface_id").filter(|value| !value.is_empty())
        {
            let current_surface_id = package
                .app
                .primary_surface
                .as_ref()
                .map(|surface| surface.component_id.as_str());
            if current_surface_id != Some(primary_surface_id.as_str()) {
                let surface_id = package
                    .app
                    .primary_surface
                    .as_ref()
                    .and_then(|surface| surface.surface_id.clone())
                    .or_else(|| Some("primary".to_string()));
                package.app.primary_surface = Some(SurfaceRef {
                    component_id: primary_surface_id,
                    surface_id,
                });
                if package.app.primary_surface_mode.is_none() {
                    package.app.primary_surface_mode = Some(AppSurfaceMode::ImmersivePrimary);
                }
                changed_fields.push("primary_surface_id".to_string());
            }
        }

        let primary_surface_id = package
            .app
            .primary_surface
            .as_ref()
            .map(|surface| surface.component_id.as_str());
        if update_launch(
            input,
            &mut package.app.launch,
            package.app.primary_surface_mode,
            &package.app.id,
            primary_surface_id,
        )? {
            changed_fields.push("launch".to_string());
        }

        if changed_fields.is_empty() {
            return Err(CoreError::validation(
                "UpdateProductAppPackage requires at least one update field".to_string(),
            ));
        }

        let shared_components =
            list_system_shared_components(&path_manager)
                .await
                .map_err(|e| {
                    CoreError::tool(format!("Failed to read system shared components: {}", e))
                })?;
        let resolved = ProductAppResolver::resolve_package_install(package, shared_components)
            .map_err(|e| CoreError::tool(format!("Product App resolver failed: {}", e)))?;
        enforce_product_app_package_write(context, &package_dir).await?;
        let component_lock_digest = resolved.lock.digest();
        let app_path = package_dir.join("app.json");
        let lock_path = ProductAppResolver::write_lock(&package_dir, &resolved.lock).await?;
        let updated_app = resolved.app;
        let updated_app_id = updated_app.id.clone();
        let updated_app_version = updated_app.version.clone();
        write_json_file(&app_path, &updated_app).await?;

        Ok(vec![ToolResult::Result {
            data: json!({
                "app_id": updated_app_id.clone(),
                "version": updated_app_version.clone(),
                "previous": {
                    "app_id": previous_app_id,
                    "version": previous_version,
                    "component_lock_digest": previous_lock,
                },
                "package_root": package_dir.to_string_lossy(),
                "component_lock_digest": component_lock_digest.clone(),
                "changed_fields": changed_fields,
                "app": updated_app,
                "files": {
                    "app": app_path.to_string_lossy(),
                    "lock": lock_path.to_string_lossy(),
                }
            }),
            result_for_assistant: Some(format!(
                "Updated Product App package {}@{} at {}. component_lock_digest: {}.",
                updated_app_id,
                updated_app_version,
                package_dir.display(),
                component_lock_digest
            )),
            image_attachments: None,
        }])
    }
}

#[async_trait]
impl Tool for RefreshProductAppLockTool {
    fn name(&self) -> &str {
        "RefreshProductAppLock"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Refresh the component lock for the current bound Intelligent App Draft after package/component edits. The tool resolves the package, writes the updated app.json component_lock_id, and rewrites app.lock.json."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {},
            "description": "The package is derived exclusively from the bound Draft identity."
        })
    }

    fn is_readonly(&self) -> bool {
        false
    }

    fn mutates_app_builder_draft(&self) -> bool {
        true
    }

    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        false
    }

    async fn call_impl(
        &self,
        _input: &Value,
        context: &ToolUseContext,
    ) -> CoreResult<Vec<ToolResult>> {
        let path_manager = try_get_path_manager_arc()
            .map_err(|e| CoreError::tool(format!("PathManager not initialized: {}", e)))?;
        let package_dir = bound_product_app_draft_root(context, "RefreshProductAppLock")?;
        let package = ProductAppResolver::read_product_app_package(&package_dir)
            .await
            .map_err(|e| CoreError::tool(format!("Failed to read Product App package: {}", e)))?;
        let app_id = package.app.id.clone();
        let app_version = package.app.version.clone();
        let previous_declared_lock = package.app.component_lock_id.clone();
        let previous_file_lock = ProductAppResolver::read_lock(&package_dir)
            .await
            .ok()
            .map(|lock| lock.digest());
        let shared_components =
            list_system_shared_components(&path_manager)
                .await
                .map_err(|e| {
                    CoreError::tool(format!("Failed to read system shared components: {}", e))
                })?;
        let resolved = ProductAppResolver::resolve_package_install(package, shared_components)
            .map_err(|e| CoreError::tool(format!("Product App resolver failed: {}", e)))?;
        enforce_product_app_package_write(context, &package_dir).await?;
        let component_lock_digest = resolved.lock.digest();
        let changed = previous_declared_lock != component_lock_digest
            || previous_file_lock.as_deref() != Some(component_lock_digest.as_str());
        let app_path = package_dir.join("app.json");
        let lock_path = ProductAppResolver::write_lock(&package_dir, &resolved.lock).await?;
        write_json_file(&app_path, &resolved.app).await?;

        Ok(vec![ToolResult::Result {
            data: json!({
                "app_id": app_id.clone(),
                "version": app_version.clone(),
                "package_root": package_dir.to_string_lossy(),
                "component_lock_digest": component_lock_digest.clone(),
                "previous": {
                    "declared": previous_declared_lock.clone(),
                    "file": previous_file_lock.clone(),
                },
                "files": {
                    "app": app_path.to_string_lossy(),
                    "lock": lock_path.to_string_lossy(),
                },
                "changed": changed,
            }),
            result_for_assistant: Some(format!(
                "Refreshed Product App lock for {}@{}. component_lock_digest: {}.",
                app_id, app_version, component_lock_digest
            )),
            image_attachments: None,
        }])
    }
}

#[async_trait]
impl Tool for ResolveBuilderPreviewTargetTool {
    fn name(&self) -> &str {
        "ResolveBuilderPreviewTarget"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Resolve the current bound Intelligent App Draft into a structured App Builder Preview Target without opening a runtime host or claiming execution evidence. Optional mode can force product-app-preview, agent-chat, sidecar-ui, full-ui, embedded-object, capability, agent-eval, runtime-boundary, runtime-dependencies, permission-review, user-path-rehearsal, or release-rehearsal."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": [
                        "auto",
                        "product-app-preview",
                        "agent-chat",
                        "sidecar-ui",
                        "full-ui",
                        "embedded-object",
                        "capability",
                        "agent-eval",
                        "runtime-boundary",
                        "runtime-dependencies",
                        "permission-review",
                        "user-path-rehearsal",
                        "release-rehearsal"
                    ]
                },
                "fixture_id": { "type": "string" },
                "locale": { "type": "string" },
                "theme": { "type": "string" },
                "viewport": { "type": "string" }
            },
            "description": "Resolve preview target identity and placement only. RunBuilderPreview produces evidence."
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
        let package_dir = bound_product_app_draft_root(context, "ResolveBuilderPreviewTarget")?;
        let package = ProductAppResolver::read_product_app_package(&package_dir)
            .await
            .map_err(|e| CoreError::tool(format!("Failed to read Product App package: {}", e)))?;
        let shared_components =
            list_system_shared_components(&path_manager)
                .await
                .map_err(|e| {
                    CoreError::tool(format!("Failed to read system shared components: {}", e))
                })?;
        let resolved =
            ProductAppResolver::resolve_package_install(package.clone(), shared_components)
                .map_err(|e| CoreError::tool(format!("Product App resolver failed: {}", e)))?;
        let requested_mode = optional_string(input, "mode").unwrap_or_else(|| "auto".to_string());
        let mode = resolve_preview_mode(
            &requested_mode,
            package.app.primary_surface_mode,
            package.app.launch.as_ref().map(|launch| launch.kind),
        )?;
        let placement = preview_placement(&mode);
        let app_id = package.app.id.clone();
        let app_version = package.app.version.clone();
        let primary_surface_id = package
            .app
            .primary_surface
            .as_ref()
            .map(|surface| surface.component_id.clone());
        let primary_surface_mode = package.app.primary_surface_mode;
        let launch = package.app.launch.clone();
        let app_name = package.app.name.clone();
        let app_description = package.app.description.clone();
        let component_lock_digest = resolved.lock.digest();

        Ok(vec![ToolResult::Result {
            data: json!({
                "preview_target": {
                    "kind": "product-app-preview",
                    "app_id": app_id.clone(),
                    "version": app_version.clone(),
                    "package_root": package_dir.to_string_lossy(),
                    "mode": mode.clone(),
                    "primary_surface_id": primary_surface_id,
                    "primary_surface_mode": primary_surface_mode,
                    "launch": launch,
                    "component_lock_digest": component_lock_digest.clone(),
                    "fixture_id": optional_string(input, "fixture_id"),
                    "locale": optional_string(input, "locale"),
                    "theme": optional_string(input, "theme"),
                    "viewport": optional_string(input, "viewport"),
                    "placement": placement,
                },
                "product_app": {
                    "id": app_id.clone(),
                    "version": app_version.clone(),
                    "name": app_name,
                    "description": app_description,
                },
                "component_graph": {
                    "resolved_component_count": resolved.components.len(),
                    "private_component_count": package.private_components.len(),
                },
                "evidence_boundary": {
                    "status": "targetResolved",
                    "detail": "ResolveBuilderPreviewTarget resolves identity and placement only. RunBuilderPreview or the Product App runtime host must produce execution evidence."
                }
            }),
            result_for_assistant: Some(format!(
                "Resolved Builder preview target for {}@{} using mode {}.",
                app_id, app_version, mode
            )),
            image_attachments: None,
        }])
    }
}

async fn authoritative_bound_draft_app_id(
    draft_root: &Path,
    expected_draft_id: &str,
) -> CoreResult<String> {
    let control_path = draft_root.join(".sparo_os").join("draft.json");
    let bytes = fs::read(&control_path).await.map_err(|error| {
        CoreError::validation(format!(
            "Failed to read authoritative Draft metadata {}: {error}",
            control_path.display()
        ))
    })?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|error| {
        CoreError::validation(format!(
            "Failed to parse authoritative Draft metadata {}: {error}",
            control_path.display()
        ))
    })?;
    if value.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || value.get("draftId").and_then(Value::as_str) != Some(expected_draft_id)
    {
        return Err(CoreError::validation(format!(
            "Authoritative Draft metadata does not match bound Draft {expected_draft_id}"
        )));
    }
    let app_id = value
        .get("appId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            CoreError::validation("Authoritative Draft metadata has no App identity".to_string())
        })?;
    Ok(app_id.to_string())
}

fn bound_product_app_draft_root(context: &ToolUseContext, tool_name: &str) -> CoreResult<PathBuf> {
    bound_app_builder_draft_root(context, tool_name)?.ok_or_else(|| {
        CoreError::validation(format!(
            "{tool_name} is only available inside an authorized Intelligent App Draft"
        ))
    })
}

async fn write_json_file<T: Serialize>(path: &Path, value: &T) -> CoreResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let bytes = serde_json::to_vec_pretty(value)?;
    fs::write(path, bytes).await?;
    Ok(())
}

async fn enforce_product_app_package_write(
    context: &ToolUseContext,
    package_dir: &Path,
) -> CoreResult<()> {
    enforce_app_builder_package_write(context, package_dir.to_string_lossy().as_ref()).await
}

fn required_string(input: &Value, field: &str) -> CoreResult<String> {
    let value = optional_string(input, field)
        .ok_or_else(|| CoreError::validation(format!("Missing required field: {field}")))?;
    if value.trim().is_empty() {
        return Err(CoreError::validation(format!("{field} cannot be empty")));
    }
    Ok(value)
}

fn required_component_kind(input: &Value) -> CoreResult<ComponentKind> {
    let value = required_string(input, "kind")?;
    match value.to_ascii_lowercase().as_str() {
        "surface" | "surfacecomponent" => Ok(ComponentKind::Surface),
        "agent" | "agentcomponent" => Ok(ComponentKind::Agent),
        "bridge" | "bridgecomponent" => Ok(ComponentKind::Bridge),
        "runtime" | "runtimecomponent" => Ok(ComponentKind::Runtime),
        "tool" | "toolcomponent" => Ok(ComponentKind::Tool),
        "skill" | "skillcomponent" => Ok(ComponentKind::Skill),
        other => Err(CoreError::validation(format!(
            "Unsupported Product App component kind: {other}"
        ))),
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

fn default_product_app_skill_hints(
    include_surface: bool,
    include_agent: bool,
) -> Vec<&'static str> {
    let mut hints = vec!["product-app-api"];
    if include_surface {
        hints.extend(["product-app-surface", "product-app-ui-polish"]);
    }
    if include_agent {
        hints.push("product-app-agent-component");
    }
    hints
}

fn component_skill_hints(kind: ComponentKind) -> Vec<&'static str> {
    match kind {
        ComponentKind::Surface => vec![
            "product-app-surface",
            "product-app-api",
            "product-app-ui-polish",
        ],
        ComponentKind::Agent => vec!["product-app-agent-component", "product-app-api"],
        ComponentKind::Bridge => vec!["product-app-bridge-component", "product-app-api"],
        ComponentKind::Runtime => vec!["product-app-runtime-component"],
        ComponentKind::Tool => vec!["product-app-tool-component", "product-app-api"],
        ComponentKind::Skill => vec!["product-app-skill-component"],
    }
}

fn entry_kind_name(kind: ProductAppEntryKind) -> &'static str {
    match kind {
        ProductAppEntryKind::Agent => "agent",
        ProductAppEntryKind::Surface => "surface",
        ProductAppEntryKind::SurfaceAgent => "surfaceAgent",
    }
}

fn optional_string(input: &Value, field: &str) -> Option<String> {
    input
        .get(field)
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
}

fn optional_bool(input: &Value, field: &str) -> CoreResult<Option<bool>> {
    match input.get(field) {
        Some(value) => value.as_bool().map(Some).ok_or_else(|| {
            CoreError::validation(format!("{field} must be a boolean when provided"))
        }),
        None => Ok(None),
    }
}

fn optional_i18n(input: &Value) -> CoreResult<AppI18n> {
    optional_i18n_update(input).map(|value| value.unwrap_or_default())
}

fn optional_i18n_update(input: &Value) -> CoreResult<Option<AppI18n>> {
    let Some(value) = input.get("i18n") else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(Some(AppI18n::default()));
    }
    serde_json::from_value::<AppI18n>(value.clone())
        .map(Some)
        .map_err(|error| CoreError::validation(format!("i18n must be valid AppI18n: {error}")))
}

fn optional_authors(input: &Value) -> CoreResult<Option<Vec<AppAuthor>>> {
    let Some(value) = input.get("authors") else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(Some(Vec::new()));
    }
    serde_json::from_value::<Vec<AppAuthor>>(value.clone())
        .map(Some)
        .map_err(|error| {
            CoreError::validation(format!(
                "authors must be an array of {{ name, url? }} objects: {error}"
            ))
        })
}

fn optional_entry_kind(input: &Value) -> CoreResult<Option<ProductAppEntryKind>> {
    let Some(value) = optional_string(input, "entry_kind") else {
        return Ok(None);
    };
    let kind = match value.as_str() {
        "agent" => ProductAppEntryKind::Agent,
        "surface" => ProductAppEntryKind::Surface,
        "surfaceAgent" => ProductAppEntryKind::SurfaceAgent,
        _ => {
            return Err(CoreError::validation(
                "entry_kind must be agent, surface, or surfaceAgent".to_string(),
            ))
        }
    };
    Ok(Some(kind))
}

fn optional_surface_mode(input: &Value) -> CoreResult<Option<AppSurfaceMode>> {
    let Some(value) = optional_string(input, "primary_surface_mode") else {
        return Ok(None);
    };
    let mode = match value.as_str() {
        "chatPrimary" => AppSurfaceMode::ChatPrimary,
        "sidecarLinked" => AppSurfaceMode::SidecarLinked,
        "immersivePrimary" => AppSurfaceMode::ImmersivePrimary,
        "embeddedObject" => AppSurfaceMode::EmbeddedObject,
        _ => {
            return Err(CoreError::validation(
                "primary_surface_mode must be one of chatPrimary, sidecarLinked, immersivePrimary, or embeddedObject"
                    .to_string(),
            ))
        }
    };
    Ok(Some(mode))
}

fn optional_interaction_model(input: &Value) -> CoreResult<Option<AppInteractionModel>> {
    let Some(value) = optional_string(input, "interaction_model") else {
        return Ok(None);
    };
    let model = match value.as_str() {
        "conversation" => AppInteractionModel::Conversation,
        "interactiveWorkspace" => AppInteractionModel::InteractiveWorkspace,
        _ => {
            return Err(CoreError::validation(
                "interaction_model must be conversation or interactiveWorkspace".to_string(),
            ))
        }
    };
    Ok(Some(model))
}

fn optional_work_multiplicity(input: &Value) -> CoreResult<Option<AppWorkMultiplicity>> {
    let Some(value) = optional_string(input, "work_multiplicity") else {
        return Ok(None);
    };
    let multiplicity = match value.as_str() {
        "multiple" => AppWorkMultiplicity::Multiple,
        "singleton" => AppWorkMultiplicity::Singleton,
        _ => {
            return Err(CoreError::validation(
                "work_multiplicity must be multiple or singleton".to_string(),
            ))
        }
    };
    Ok(Some(multiplicity))
}

fn optional_launch_kind(input: &Value) -> CoreResult<Option<ProductAppLaunchKind>> {
    let Some(value) = optional_string(input, "launch_kind") else {
        return Ok(None);
    };
    let kind = match value.as_str() {
        "agentSession" => ProductAppLaunchKind::AgentSession,
        "applicationSurface" => ProductAppLaunchKind::ApplicationSurface,
        "appBuilder" => ProductAppLaunchKind::AppBuilder,
        _ => {
            return Err(CoreError::validation(
                "launch_kind must be agentSession, applicationSurface, or appBuilder".to_string(),
            ))
        }
    };
    Ok(Some(kind))
}

fn optional_launch_scope_requirement(
    input: &Value,
) -> CoreResult<Option<ProductAppLaunchScopeRequirement>> {
    let Some(value) = optional_string(input, "launch_scope_requirement") else {
        return Ok(None);
    };
    let requirement = match value.as_str() {
        "systemAllowed" => ProductAppLaunchScopeRequirement::SystemAllowed,
        "workspaceOptional" => ProductAppLaunchScopeRequirement::WorkspaceOptional,
        "workspaceRequired" => ProductAppLaunchScopeRequirement::WorkspaceRequired,
        _ => {
            return Err(CoreError::validation(
                "launch_scope_requirement must be systemAllowed, workspaceOptional, or workspaceRequired"
                    .to_string(),
            ))
        }
    };
    Ok(Some(requirement))
}

fn optional_string_array(input: &Value, field: &str) -> CoreResult<Option<Vec<String>>> {
    let Some(value) = input.get(field) else {
        return Ok(None);
    };
    let Some(values) = value.as_array() else {
        return Err(CoreError::validation(format!("{field} must be an array")));
    };
    let mut result = Vec::new();
    for value in values {
        let Some(text) = value.as_str() else {
            return Err(CoreError::validation(format!(
                "{field} must contain only strings"
            )));
        };
        let text = text.trim();
        if !text.is_empty() {
            result.push(text.to_string());
        }
    }
    result.sort();
    result.dedup();
    Ok(Some(result))
}

fn optional_app_icon(input: &Value, field: &str) -> CoreResult<Option<AppIconSpec>> {
    let Some(value) = input.get(field) else {
        return Ok(None);
    };
    serde_json::from_value::<AppIconSpec>(value.clone())
        .map(Some)
        .map_err(|error| {
            CoreError::validation(format!("{field} must be a valid AppIconSpec: {error}"))
        })
}

fn apply_string_update(
    input: &Value,
    field: &str,
    target: &mut String,
    changed_fields: &mut Vec<String>,
    allow_empty: bool,
) -> CoreResult<()> {
    let Some(value) = input.get(field) else {
        return Ok(());
    };
    let Some(text) = value.as_str() else {
        return Err(CoreError::validation(format!("{field} must be a string")));
    };
    let text = text.trim().to_string();
    if !allow_empty && text.is_empty() {
        return Err(CoreError::validation(format!("{field} cannot be empty")));
    }
    if target != &text {
        *target = text;
        changed_fields.push(field.to_string());
    }
    Ok(())
}

fn update_launch(
    input: &Value,
    launch: &mut Option<ProductAppLaunch>,
    _primary_surface_mode: Option<AppSurfaceMode>,
    app_id: &str,
    primary_surface_id: Option<&str>,
) -> CoreResult<bool> {
    let requested_kind = optional_launch_kind(input)?;
    let should_resync_for_surface_mode = input.get("primary_surface_mode").is_some();
    let default_kind = if primary_surface_id.is_some() {
        ProductAppLaunchKind::ApplicationSurface
    } else {
        ProductAppLaunchKind::AgentSession
    };
    let default_scope = if default_kind == ProductAppLaunchKind::ApplicationSurface {
        ProductAppLaunchScopeRequirement::SystemAllowed
    } else {
        ProductAppLaunchScopeRequirement::WorkspaceOptional
    };
    let kind = requested_kind.unwrap_or_else(|| {
        if should_resync_for_surface_mode {
            default_kind
        } else {
            launch
                .as_ref()
                .map(|launch| launch.kind)
                .unwrap_or(default_kind)
        }
    });
    let target_id = optional_string(input, "launch_target_id")
        .filter(|value| !value.is_empty())
        .or_else(|| {
            if should_resync_for_surface_mode {
                None
            } else {
                launch.as_ref().map(|launch| launch.target_id.clone())
            }
        })
        .unwrap_or_else(|| {
            if kind == ProductAppLaunchKind::ApplicationSurface {
                app_id.to_string()
            } else {
                launch
                    .as_ref()
                    .and_then(|launch| launch.agent_type.clone())
                    .unwrap_or_else(|| primary_surface_id.unwrap_or("Runno").to_string())
            }
        });
    let scope_requirement = optional_launch_scope_requirement(input)?
        .or_else(|| launch.as_ref().map(|launch| launch.scope_requirement))
        .unwrap_or(default_scope);
    let agent_type = optional_string(input, "launch_agent_type")
        .filter(|value| !value.is_empty())
        .or_else(|| launch.as_ref().and_then(|launch| launch.agent_type.clone()));
    let surface_id = optional_string(input, "launch_surface_id")
        .filter(|value| !value.is_empty())
        .or_else(|| launch.as_ref().and_then(|launch| launch.surface_id.clone()))
        .or_else(|| {
            (kind == ProductAppLaunchKind::ApplicationSurface).then(|| "primary".to_string())
        });

    if kind == ProductAppLaunchKind::ApplicationSurface && primary_surface_id.is_none() {
        return Err(CoreError::validation(
            "applicationSurface launch requires primary_surface_id and an app-private Product App surface"
                .to_string(),
        ));
    }
    let agent_type = if kind == ProductAppLaunchKind::AgentSession {
        agent_type.or_else(|| Some(target_id.clone()))
    } else {
        agent_type
    };

    let next = ProductAppLaunch {
        kind,
        target_id,
        scope_requirement,
        agent_type,
        surface_id,
    };
    if launch.as_ref().is_some_and(|current| {
        current.kind == next.kind
            && current.target_id == next.target_id
            && current.scope_requirement == next.scope_requirement
            && current.agent_type == next.agent_type
            && current.surface_id == next.surface_id
    }) {
        return Ok(false);
    }
    *launch = Some(next);
    Ok(true)
}

fn resolve_preview_mode(
    requested_mode: &str,
    surface_mode: Option<AppSurfaceMode>,
    launch_kind: Option<ProductAppLaunchKind>,
) -> CoreResult<String> {
    let mode = match requested_mode {
        "" | "auto" => {
            if launch_kind == Some(ProductAppLaunchKind::AgentSession) {
                "agent-chat"
            } else {
                match surface_mode.unwrap_or(AppSurfaceMode::ImmersivePrimary) {
                    AppSurfaceMode::ChatPrimary => "agent-chat",
                    AppSurfaceMode::SidecarLinked => "sidecar-ui",
                    AppSurfaceMode::ImmersivePrimary => "full-ui",
                    AppSurfaceMode::EmbeddedObject => "embedded-object",
                }
            }
        }
        "product-app-preview"
        | "agent-chat"
        | "sidecar-ui"
        | "full-ui"
        | "embedded-object"
        | "capability"
        | "agent-eval"
        | "runtime-boundary"
        | "runtime-dependencies"
        | "permission-review"
        | "user-path-rehearsal"
        | "release-rehearsal" => requested_mode,
        _ => {
            return Err(CoreError::validation(
                "mode must be auto, product-app-preview, agent-chat, sidecar-ui, full-ui, embedded-object, capability, agent-eval, runtime-boundary, runtime-dependencies, permission-review, user-path-rehearsal, or release-rehearsal"
                    .to_string(),
            ))
        }
    };
    Ok(mode.to_string())
}

fn preview_placement(mode: &str) -> Value {
    let (tab_id, layout) = match mode {
        "agent-chat" | "agent-eval" => ("agent", "schema-runner"),
        "sidecar-ui" => ("preview", "split-sandbox"),
        "full-ui" | "product-app-preview" => ("preview", "single-frame"),
        "embedded-object" => ("preview", "host-fixture"),
        "capability" | "runtime-boundary" | "runtime-dependencies" | "permission-review" => {
            ("validation", "schema-runner")
        }
        "user-path-rehearsal" | "release-rehearsal" => ("validation", "rehearsal-checklist"),
        _ => ("preview", "single-frame"),
    };
    json!({
        "slot": "right-workbench-tab",
        "tab_id": tab_id,
        "tabId": tab_id,
        "layout": layout,
        "focusMode": false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_hints_track_product_app_component_kinds() {
        assert_eq!(
            default_product_app_skill_hints(true, true),
            vec![
                "product-app-api",
                "product-app-surface",
                "product-app-ui-polish",
                "product-app-agent-component"
            ]
        );
        assert_eq!(
            component_skill_hints(ComponentKind::Surface),
            vec![
                "product-app-surface",
                "product-app-api",
                "product-app-ui-polish"
            ]
        );
        assert_eq!(
            component_skill_hints(ComponentKind::Agent),
            vec!["product-app-agent-component", "product-app-api"]
        );
        assert_eq!(
            component_skill_hints(ComponentKind::Bridge),
            vec!["product-app-bridge-component", "product-app-api"]
        );
        assert_eq!(
            component_skill_hints(ComponentKind::Runtime),
            vec!["product-app-runtime-component"]
        );
        assert_eq!(
            component_skill_hints(ComponentKind::Tool),
            vec!["product-app-tool-component", "product-app-api"]
        );
        assert_eq!(
            component_skill_hints(ComponentKind::Skill),
            vec!["product-app-skill-component"]
        );
    }
}
