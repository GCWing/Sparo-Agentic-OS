//! CreateProductAppCheckpoint tool - write a stable Product App package checkpoint.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use log::warn;
use serde_json::{json, Value};

use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::agentic::tools::implementations::util::{
    bound_app_studio_product_app_root, enforce_app_studio_package_write,
    has_app_studio_session_context,
};
use crate::agentic::tools::implementations::work_tool_support::work_service_from_tool_context;
use crate::agentic_os::work::{ArtifactRef, WorkId};
use crate::agentic_os::work::{
    WorkAppKind, WorkRecord, WorkService, WorkStudioFactCheck, WorkStudioFactStatus,
    WorkStudioPreviewKind, WorkStudioPreviewResult, WorkStudioPreviewSource,
};
use crate::app_platform::{
    compare_product_app_revisions, create_product_app_checkpoint,
    create_product_app_from_release_template, create_product_app_release,
    list_installed_shared_components, publish_product_app_release_to_catalog,
    restore_product_app_checkpoint, restore_product_app_release,
    validate_product_app_release_readiness, CompareProductAppRevisionsRequest,
    CreateProductAppCheckpointRequest, CreateProductAppFromReleaseTemplateRequest,
    CreateProductAppReleaseRequest, ProductAppReleaseCheck, ProductAppReleaseReadinessSnapshot,
    ProductAppResolver, ProductAppRevisionRef, PublishProductAppReleaseToCatalogRequest,
    PublishedProductAppReleaseCatalogSource, RestoreProductAppCheckpointRequest,
    RestoreProductAppReleaseRequest, WrittenProductAppCheckpoint,
    WrittenProductAppFromReleaseTemplate, WrittenProductAppRelease,
};
use crate::infrastructure::{try_get_path_manager_arc, PathManager};
use crate::error::{CoreError, CoreResult};

pub struct CreateProductAppCheckpointTool;
pub struct RestoreProductAppCheckpointTool;
pub struct RestoreProductAppReleaseTool;
pub struct CompareProductAppRevisionsTool;
pub struct CreateProductAppFromReleaseTemplateTool;
pub struct CreateProductAppReleaseTool;
pub struct PublishProductAppReleaseTool;

impl CreateProductAppCheckpointTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for CreateProductAppCheckpointTool {
    fn default() -> Self {
        Self::new()
    }
}

impl RestoreProductAppCheckpointTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for RestoreProductAppCheckpointTool {
    fn default() -> Self {
        Self::new()
    }
}

impl RestoreProductAppReleaseTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for RestoreProductAppReleaseTool {
    fn default() -> Self {
        Self::new()
    }
}

impl CompareProductAppRevisionsTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for CompareProductAppRevisionsTool {
    fn default() -> Self {
        Self::new()
    }
}

impl CreateProductAppFromReleaseTemplateTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for CreateProductAppFromReleaseTemplateTool {
    fn default() -> Self {
        Self::new()
    }
}

impl CreateProductAppReleaseTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for CreateProductAppReleaseTool {
    fn default() -> Self {
        Self::new()
    }
}

impl PublishProductAppReleaseTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for PublishProductAppReleaseTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for CreateProductAppCheckpointTool {
    fn name(&self) -> &str {
        "CreateProductAppCheckpoint"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Create a stable Product App checkpoint artifact for the current package. The checkpoint verifies app.json, app.lock.json, and resolver lock consistency, records deterministic source file hashes, and writes checkpoints/<checkpoint_id>/checkpoint.json.

Input: path, or app_id plus optional version for standalone checkpoints. In a bound AppStudio Product App session, leave package identity empty; the current package is always used. Optional work_id binds the checkpoint as a Work artifact. This is a draft checkpoint, not a release artifact, install, rollback, or share payload."#
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
                },
                "label": {
                    "type": "string",
                    "description": "Optional short human label for the checkpoint."
                },
                "summary": {
                    "type": "string",
                    "description": "Optional summary of what changed or why this checkpoint matters."
                },
                "work_id": {
                    "type": "string",
                    "description": "Optional Work id. When supplied, the checkpoint is bound as a Work artifact."
                }
            },
            "description": "Use path/app_id only for standalone checkpoints. Leave package identity empty in a bound AppStudio Product App session; the current package is used."
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
        let path_manager = try_get_path_manager_arc()
            .map_err(|e| CoreError::tool(format!("PathManager not initialized: {}", e)))?;
        let package_dir =
            package_dir_for_write_from_input(input, self.name(), &path_manager, context).await?;
        let shared_components = list_installed_shared_components(&path_manager)
            .await
            .map_err(|e| {
                CoreError::tool(format!("Failed to read installed shared components: {}", e))
            })?;
        let label = optional_string(input, "label").filter(|value| !value.trim().is_empty());
        let summary = optional_string(input, "summary").filter(|value| !value.trim().is_empty());
        let checkpoint = create_product_app_checkpoint(CreateProductAppCheckpointRequest {
            package_dir: package_dir.clone(),
            shared_components,
            label: label.clone(),
            summary: summary.clone(),
            created_by: Some(self.name().to_string()),
            created_at_ms: now_ms(),
        })
        .await
        .map_err(|e| {
            CoreError::tool(format!("Failed to create Product App checkpoint: {}", e))
        })?;

        let bound_work_id =
            bind_checkpoint_artifact(context, optional_string(input, "work_id"), &checkpoint)
                .await?;

        if let Err(error) =
            bind_checkpoint_session(context, &checkpoint, label.as_deref(), summary.as_deref())
                .await
        {
            warn!(
                "Failed to bind Product App checkpoint to AppStudio session: session_id={:?}, checkpoint_id={}, error={}",
                context.session_id,
                checkpoint.checkpoint_id,
                error
            );
        }

        let result_text = format!(
            "Product App checkpoint created for {}@{}. checkpoint_id: {}. Manifest: {}. This is not a release artifact.",
            checkpoint.app_id,
            checkpoint.version,
            checkpoint.checkpoint_id,
            checkpoint.manifest_path.display()
        );

        Ok(vec![ToolResult::Result {
            data: json!({
                "status": "created",
                "app_id": checkpoint.app_id,
                "version": checkpoint.version,
                "checkpoint_id": checkpoint.checkpoint_id,
                "component_lock_digest": checkpoint.component_lock_digest,
                "package_digest": checkpoint.package_digest,
                "path": package_dir.to_string_lossy(),
                "manifest_path": checkpoint.manifest_path.to_string_lossy(),
                "artifact_uri": checkpoint.artifact_uri,
                "file_count": checkpoint.file_count,
                "checkpoint_count": checkpoint.checkpoint_count,
                "work_id": bound_work_id,
                "release_status": "notReleased",
                "release_gate": "checkpointOnly"
            }),
            result_for_assistant: Some(result_text),
            image_attachments: None,
        }])
    }
}

#[async_trait]
impl Tool for RestoreProductAppCheckpointTool {
    fn name(&self) -> &str {
        "RestoreProductAppCheckpoint"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Restore a Product App package from a checkpoint created by CreateProductAppCheckpoint. This overwrites package files and removes package files that are not present in the checkpoint snapshot; checkpoints, releases, node_modules, .git, and .sparo_os are excluded.

Input: checkpoint_id and confirm=true. In a bound AppStudio Product App session, leave package identity empty; the current package is always used. This is destructive package editing and is not a release or rollback of installed user data."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["checkpoint_id", "confirm"],
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Product App package directory containing app.json, app.lock.json, and checkpoints/."
                },
                "app_id": {
                    "type": "string",
                    "description": "Installed Product App id. Used with version when path is omitted."
                },
                "version": {
                    "type": "string",
                    "description": "Product App version. Defaults to 1.0.0 when app_id is used."
                },
                "checkpoint_id": {
                    "type": "string",
                    "description": "Checkpoint id to restore."
                },
                "confirm": {
                    "type": "boolean",
                    "description": "Must be true to acknowledge package files will be overwritten."
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
        let path_manager = try_get_path_manager_arc()
            .map_err(|e| CoreError::tool(format!("PathManager not initialized: {}", e)))?;
        let package_dir =
            package_dir_for_write_from_input(input, self.name(), &path_manager, context).await?;
        let checkpoint_id = required_string(input, "checkpoint_id")?;
        let confirm = input
            .get("confirm")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let shared_components = list_installed_shared_components(&path_manager)
            .await
            .map_err(|e| {
                CoreError::tool(format!("Failed to read installed shared components: {}", e))
            })?;
        let restored = restore_product_app_checkpoint(RestoreProductAppCheckpointRequest {
            package_dir: package_dir.clone(),
            shared_components,
            checkpoint_id,
            confirm,
        })
        .await
        .map_err(|e| {
            CoreError::tool(format!("Failed to restore Product App checkpoint: {}", e))
        })?;

        let result_text = format!(
            "Product App checkpoint restored for {}@{}. checkpoint_id: {}. restored_files={}, removed_files={}.",
            restored.app_id,
            restored.version,
            restored.checkpoint_id,
            restored.restored_files,
            restored.removed_files
        );

        Ok(vec![ToolResult::Result {
            data: json!({
                "status": "restored",
                "app_id": restored.app_id,
                "version": restored.version,
                "checkpoint_id": restored.checkpoint_id,
                "component_lock_digest": restored.component_lock_digest,
                "package_digest": restored.package_digest,
                "path": package_dir.to_string_lossy(),
                "manifest_path": restored.manifest_path.to_string_lossy(),
                "restored_files": restored.restored_files,
                "removed_files": restored.removed_files
            }),
            result_for_assistant: Some(result_text),
            image_attachments: None,
        }])
    }
}

#[async_trait]
impl Tool for RestoreProductAppReleaseTool {
    fn name(&self) -> &str {
        "RestoreProductAppRelease"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Restore a Product App package from an immutable release artifact created by CreateProductAppRelease. This overwrites package files and removes package files that are not present in the release source snapshot; checkpoints, releases, node_modules, .git, .sparo_os, and release catalog provenance are excluded.

Input: release_id and confirm=true. In a bound AppStudio Product App session, leave package identity empty; the current package is always used. This is package rollback to a released source snapshot; it does not roll back installed user data, Work history, runtime storage, or private memory."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["release_id", "confirm"],
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Product App package directory containing app.json, app.lock.json, and releases/."
                },
                "app_id": {
                    "type": "string",
                    "description": "Installed Product App id. Used with version when path is omitted."
                },
                "version": {
                    "type": "string",
                    "description": "Product App version. Defaults to 1.0.0 when app_id is used."
                },
                "release_id": {
                    "type": "string",
                    "description": "Release id to restore."
                },
                "confirm": {
                    "type": "boolean",
                    "description": "Must be true to acknowledge package files will be overwritten."
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
        let path_manager = try_get_path_manager_arc()
            .map_err(|e| CoreError::tool(format!("PathManager not initialized: {}", e)))?;
        let package_dir =
            package_dir_for_write_from_input(input, self.name(), &path_manager, context).await?;
        let release_id = required_string(input, "release_id")?;
        let confirm = input
            .get("confirm")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let shared_components = list_installed_shared_components(&path_manager)
            .await
            .map_err(|e| {
                CoreError::tool(format!("Failed to read installed shared components: {}", e))
            })?;
        let restored = restore_product_app_release(RestoreProductAppReleaseRequest {
            package_dir: package_dir.clone(),
            shared_components,
            release_id,
            confirm,
        })
        .await
        .map_err(|e| CoreError::tool(format!("Failed to restore Product App release: {}", e)))?;

        let result_text = format!(
            "Product App release restored for {}@{}. release_id: {}. restored_files={}, removed_files={}.",
            restored.app_id,
            restored.version,
            restored.release_id,
            restored.restored_files,
            restored.removed_files
        );

        Ok(vec![ToolResult::Result {
            data: json!({
                "status": "restored",
                "app_id": restored.app_id,
                "version": restored.version,
                "release_id": restored.release_id,
                "component_lock_digest": restored.component_lock_digest,
                "package_digest": restored.package_digest,
                "path": package_dir.to_string_lossy(),
                "manifest_path": restored.manifest_path.to_string_lossy(),
                "restored_files": restored.restored_files,
                "removed_files": restored.removed_files,
                "rollback_scope": "packageSourceOnly"
            }),
            result_for_assistant: Some(result_text),
            image_attachments: None,
        }])
    }
}

#[async_trait]
impl Tool for CompareProductAppRevisionsTool {
    fn name(&self) -> &str {
        "CompareProductAppRevisions"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Compare Product App package revisions using checkpoint manifests, release manifests, or the current package files. This is read-only history comparison for package source snapshots.

Input: base_kind plus base_id unless base_kind is current. Optional target_kind and target_id; target_kind defaults to current. Allowed revision kinds are checkpoint, release, and current. Optional path/app_id/version. The tool returns added, removed, and modified package files by deterministic sha256 hash."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["base_kind"],
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Product App package directory containing app.json, app.lock.json, and checkpoints/."
                },
                "app_id": {
                    "type": "string",
                    "description": "Installed Product App id. Used with version when path is omitted."
                },
                "version": {
                    "type": "string",
                    "description": "Product App version. Defaults to 1.0.0 when app_id is used."
                },
                "base_kind": {
                    "type": "string",
                    "enum": ["checkpoint", "release", "current"],
                    "description": "Base revision kind."
                },
                "base_id": {
                    "type": "string",
                    "description": "Base checkpoint id or release id. Omit only when base_kind is current."
                },
                "target_kind": {
                    "type": "string",
                    "enum": ["checkpoint", "release", "current"],
                    "description": "Target revision kind. Defaults to current."
                },
                "target_id": {
                    "type": "string",
                    "description": "Target checkpoint id or release id. Omit when target_kind is current or omitted."
                }
            }
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
        let package_dir = package_dir_from_input(input, self.name(), &path_manager, context)?;
        let base = revision_ref_from_input(input, "base", false)?;
        let target = revision_ref_from_input(input, "target", true)?;
        let comparison = compare_product_app_revisions(CompareProductAppRevisionsRequest {
            package_dir: package_dir.clone(),
            base,
            target,
        })
        .await
        .map_err(|e| {
            CoreError::tool(format!("Failed to compare Product App revisions: {}", e))
        })?;
        let result_text = format!(
            "Product App revision comparison complete. changed={}, unchanged={}.",
            comparison.changed_count, comparison.unchanged_count
        );

        Ok(vec![ToolResult::Result {
            data: json!({
                "status": "compared",
                "path": package_dir.to_string_lossy(),
                "base": comparison.base,
                "target": comparison.target,
                "changes": comparison.changes,
                "changed_count": comparison.changed_count,
                "unchanged_count": comparison.unchanged_count
            }),
            result_for_assistant: Some(result_text),
            image_attachments: None,
        }])
    }
}

#[async_trait]
impl Tool for CreateProductAppFromReleaseTemplateTool {
    fn name(&self) -> &str {
        "CreateProductAppFromReleaseTemplate"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Create a new Product App package from an immutable release source snapshot. This copies only release package source files, rebases app id/name/version and app-private component ownership, writes a fresh component lock, and excludes Work history, runtime storage, user private data, checkpoints, releases, and catalog provenance.

Input: release_id, new_app_id, name. Optional description, goal, version, path/app_id/version for standalone source release package resolution. In a bound AppStudio Product App session, leave source package identity empty; the current package is always used."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["release_id", "new_app_id", "name"],
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Source Product App package directory containing releases/<release_id>/release.json."
                },
                "app_id": {
                    "type": "string",
                    "description": "Source installed Product App id. Used with version when path is omitted."
                },
                "version": {
                    "type": "string",
                    "description": "Source Product App version. Defaults to 1.0.0 when app_id is used."
                },
                "release_id": {
                    "type": "string",
                    "description": "Release id to use as the immutable template source."
                },
                "new_app_id": {
                    "type": "string",
                    "description": "New durable Product App id. ASCII letters, numbers, '-' or '_'."
                },
                "name": {
                    "type": "string",
                    "description": "New Product App display name."
                },
                "description": {
                    "type": "string",
                    "description": "Optional new Product App description. Defaults to the release app description."
                },
                "goal": {
                    "type": "string",
                    "description": "Optional new Product App goal. Defaults to the release app goal."
                },
                "new_version": {
                    "type": "string",
                    "description": "New Product App version. Defaults to 1.0.0."
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
        let path_manager = try_get_path_manager_arc()
            .map_err(|e| CoreError::tool(format!("PathManager not initialized: {}", e)))?;
        let source_package_dir =
            package_dir_from_input(input, self.name(), &path_manager, context)?;
        let release_id = required_string(input, "release_id")?;
        let new_app_id = required_string(input, "new_app_id")?;
        let name = required_string(input, "name")?;
        let new_version =
            optional_string(input, "new_version").unwrap_or_else(|| "1.0.0".to_string());
        let target_package_dir =
            path_manager.system_product_app_version_dir(&new_app_id, &new_version);
        let shared_components = list_installed_shared_components(&path_manager)
            .await
            .map_err(|e| {
                CoreError::tool(format!("Failed to read installed shared components: {}", e))
            })?;
        let written =
            create_product_app_from_release_template(CreateProductAppFromReleaseTemplateRequest {
                source_package_dir,
                target_package_dir: target_package_dir.clone(),
                shared_components,
                release_id,
                new_app_id,
                new_name: name,
                new_version,
                new_description: optional_string(input, "description"),
                new_goal: optional_string(input, "goal"),
            })
            .await
            .map_err(|e| {
                CoreError::tool(format!(
                    "Failed to create Product App from release template: {}",
                    e
                ))
            })?;

        if let Err(error) = bind_template_session(context, &written).await {
            warn!(
                "Failed to bind release template Product App to AppStudio session: session_id={:?}, app_id={}, error={}",
                context.session_id,
                written.app_id,
                error
            );
        }

        let result_text = format!(
            "Product App package created from release template. source_release_id: {}. app_id: {}. Package directory: {}.",
            written.source_release_id,
            written.app_id,
            written.package_dir.display()
        );

        Ok(vec![ToolResult::Result {
            data: json!({
                "status": "created",
                "source_release_id": written.source_release_id,
                "source_app_id": written.source_app_id,
                "source_version": written.source_version,
                "app_id": written.app_id,
                "version": written.version,
                "name": written.name,
                "component_lock_digest": written.component_lock_digest,
                "package_digest": written.package_digest,
                "path": written.package_dir.to_string_lossy(),
                "file_count": written.file_count,
                "template_scope": "releasePackageSourceOnly"
            }),
            result_for_assistant: Some(result_text),
            image_attachments: None,
        }])
    }
}

#[async_trait]
impl Tool for CreateProductAppReleaseTool {
    fn name(&self) -> &str {
        "CreateProductAppRelease"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Create an immutable Product App release artifact from the current package. This tool requires a Work id whose derived release-rehearsal readiness is passed; it verifies the Work subject app id/version/component lock matches the current package before writing releases/<release_id>/release.json plus a package source snapshot.

Input: work_id. Optional path/app_id/version for standalone release creation, plus label and notes. In a bound AppStudio Product App session, leave package identity empty; the current package is always used. This creates a release artifact only; it does not include Work history, runtime storage, user private data, or sensitive memory."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["work_id"],
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
                },
                "work_id": {
                    "type": "string",
                    "description": "Product App Work id whose release readiness must be passed."
                },
                "label": {
                    "type": "string",
                    "description": "Optional short release label."
                },
                "notes": {
                    "type": "string",
                    "description": "Optional release notes."
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
        let path_manager = try_get_path_manager_arc()
            .map_err(|e| CoreError::tool(format!("PathManager not initialized: {}", e)))?;
        let package_dir =
            package_dir_for_write_from_input(input, self.name(), &path_manager, context).await?;
        let work_id = required_work_id(input)?;
        let service = work_service_from_tool_context(context)?;
        let record = service.get(&work_id).await?;
        verify_work_matches_package(&record, &package_dir).await?;
        let readiness = release_readiness_from_work(&record)?;
        let shared_components = list_installed_shared_components(&path_manager)
            .await
            .map_err(|e| {
                CoreError::tool(format!("Failed to read installed shared components: {}", e))
            })?;
        let label = optional_string(input, "label").filter(|value| !value.trim().is_empty());
        let notes = optional_string(input, "notes").filter(|value| !value.trim().is_empty());
        let release = create_product_app_release(CreateProductAppReleaseRequest {
            package_dir: package_dir.clone(),
            shared_components,
            readiness,
            label: label.clone(),
            notes: notes.clone(),
            created_by: Some(self.name().to_string()),
            created_at_ms: now_ms(),
        })
        .await
        .map_err(|e| CoreError::tool(format!("Failed to create Product App release: {}", e)))?;

        bind_release_artifact(&service, &work_id, &release, label.as_deref()).await?;
        if let Err(error) =
            bind_release_session(context, &release, label.as_deref(), notes.as_deref()).await
        {
            warn!(
                "Failed to bind Product App release to AppStudio session: session_id={:?}, release_id={}, error={}",
                context.session_id,
                release.release_id,
                error
            );
        }

        let result_text = format!(
            "Product App release created for {}@{}. release_id: {}. Manifest: {}.",
            release.app_id,
            release.version,
            release.release_id,
            release.manifest_path.display()
        );

        Ok(vec![ToolResult::Result {
            data: json!({
                "status": "released",
                "app_id": release.app_id,
                "version": release.version,
                "release_id": release.release_id,
                "component_lock_digest": release.component_lock_digest,
                "package_digest": release.package_digest,
                "path": package_dir.to_string_lossy(),
                "manifest_path": release.manifest_path.to_string_lossy(),
                "artifact_uri": release.artifact_uri,
                "file_count": release.file_count,
                "release_count": release.release_count,
                "work_id": work_id.as_str(),
                "release_status": "released"
            }),
            result_for_assistant: Some(result_text),
            image_attachments: None,
        }])
    }
}

#[async_trait]
impl Tool for PublishProductAppReleaseTool {
    fn name(&self) -> &str {
        "PublishProductAppRelease"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Publish an existing Product App release artifact into the local Product App catalog source. The release must already have passed CreateProductAppRelease readiness; this tool preserves the release source snapshot and component lock, writes release-source.json provenance, and makes the app discoverable/installable without including Work history, runtime storage, user private data, or sensitive memory.

Input: release_id. Optional path/app_id/version for standalone publishing, plus work_id. In a bound AppStudio Product App session, leave package identity empty; the current package is always used."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["release_id"],
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Product App package directory containing releases/<release_id>/release.json."
                },
                "app_id": {
                    "type": "string",
                    "description": "Installed Product App id. Used with version when path is omitted."
                },
                "version": {
                    "type": "string",
                    "description": "Product App version. Defaults to 1.0.0 when app_id is used."
                },
                "release_id": {
                    "type": "string",
                    "description": "Release id under releases/<release_id>."
                },
                "work_id": {
                    "type": "string",
                    "description": "Optional Work id. When supplied it must match the release readiness work id."
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
        let path_manager = try_get_path_manager_arc()
            .map_err(|e| CoreError::tool(format!("PathManager not initialized: {}", e)))?;
        let package_dir = package_dir_from_input(input, self.name(), &path_manager, context)?;
        let release_id = required_string(input, "release_id")?;
        let release_manifest_path = package_dir
            .join("releases")
            .join(&release_id)
            .join("release.json");

        let published = publish_product_app_release_to_catalog(
            &path_manager,
            PublishProductAppReleaseToCatalogRequest {
                release_manifest_path,
                published_by: Some(self.name().to_string()),
                published_at_ms: now_ms(),
            },
        )
        .await
        .map_err(|e| {
            CoreError::tool(format!(
                "Failed to publish Product App release to catalog: {}",
                e
            ))
        })?;
        verify_publish_work_id(input, &published)?;

        if let Err(error) = bind_publish_artifact(context, &published).await {
            warn!(
                "Failed to bind Product App catalog publish artifact: session_id={:?}, release_id={}, error={}",
                context.session_id,
                published.release_id,
                error
            );
        }
        if let Err(error) = bind_publish_session(context, &published).await {
            warn!(
                "Failed to bind Product App catalog publish to AppStudio session: session_id={:?}, release_id={}, error={}",
                context.session_id,
                published.release_id,
                error
            );
        }

        let result_text = format!(
            "Product App release {} for {}@{} was published to the local catalog source. Source: {}.",
            published.release_id,
            published.app_id,
            published.version,
            published.source_dir.display()
        );

        Ok(vec![ToolResult::Result {
            data: json!({
                "status": "published",
                "app_id": published.app_id,
                "version": published.version,
                "release_id": published.release_id,
                "artifact_uri": published.artifact_uri,
                "source_dir": published.source_dir.to_string_lossy(),
                "component_lock_digest": published.component_lock_digest,
                "package_digest": published.package_digest,
                "published_at": published.published_at_ms,
                "work_id": published.work_id,
                "catalog_status": "discoverable"
            }),
            result_for_assistant: Some(result_text),
            image_attachments: None,
        }])
    }
}

fn package_dir_from_input(
    input: &Value,
    operation_name: &str,
    path_manager: &PathManager,
    context: &ToolUseContext,
) -> CoreResult<PathBuf> {
    if let Some(package_root) = bound_app_studio_product_app_root(context, operation_name)? {
        return Ok(package_root);
    }

    if let Some(path) = optional_string(input, "path").filter(|value| !value.trim().is_empty()) {
        return Ok(PathBuf::from(path));
    }
    let app_id = required_string(input, "app_id")?;
    let version = optional_string(input, "version").unwrap_or_else(|| "1.0.0".to_string());
    Ok(path_manager.system_product_app_version_dir(&app_id, &version))
}

async fn package_dir_for_write_from_input(
    input: &Value,
    operation_name: &str,
    path_manager: &PathManager,
    context: &ToolUseContext,
) -> CoreResult<PathBuf> {
    let package_dir = package_dir_from_input(input, operation_name, path_manager, context)?;
    enforce_app_studio_package_write(context, package_dir.to_string_lossy().as_ref()).await?;
    Ok(package_dir)
}

fn required_work_id(input: &Value) -> CoreResult<WorkId> {
    let work_id = required_string(input, "work_id")?;
    WorkId::parse(work_id)
        .map_err(|error| CoreError::validation(format!("Invalid work_id: {error}")))
}

async fn verify_work_matches_package(
    record: &WorkRecord,
    package_dir: &PathBuf,
) -> CoreResult<()> {
    let Some(app_ref) = record.subject.app_ref() else {
        return Err(CoreError::validation(
            "CreateProductAppRelease requires a Product App Work subject".to_string(),
        ));
    };
    if app_ref.kind != WorkAppKind::ProductApp {
        return Err(CoreError::validation(
            "CreateProductAppRelease requires a Product App Work subject".to_string(),
        ));
    }

    let package = ProductAppResolver::read_product_app_package(package_dir).await?;
    let file_lock_digest = ProductAppResolver::read_lock(package_dir).await?.digest();
    if app_ref.app_id != package.app.id
        || app_ref.app_version != package.app.version
        || app_ref.component_lock_digest != file_lock_digest
    {
        return Err(CoreError::validation(format!(
            "Release Work subject does not match current package. work={}@{} lock={}, package={}@{} lock={}",
            app_ref.app_id,
            app_ref.app_version,
            app_ref.component_lock_digest,
            package.app.id,
            package.app.version,
            file_lock_digest
        )));
    }
    Ok(())
}

fn release_readiness_from_work(
    record: &WorkRecord,
) -> CoreResult<ProductAppReleaseReadinessSnapshot> {
    let preview = latest_derived_release_rehearsal(record).ok_or_else(|| {
        CoreError::validation(
            "CreateProductAppRelease requires a derived release-rehearsal readiness fact on the Work graph"
                .to_string(),
        )
    })?;

    if preview.status != WorkStudioFactStatus::Passed {
        return Err(CoreError::validation(format!(
            "CreateProductAppRelease requires release readiness passed, got {}",
            work_fact_status_string(preview.status)
        )));
    }
    let release_gate = preview
        .checks
        .iter()
        .find(|check| check.id == "releaseGate")
        .ok_or_else(|| {
            CoreError::validation(
                "CreateProductAppRelease requires a releaseGate check in readiness facts"
                    .to_string(),
            )
        })?;
    if release_gate.status != WorkStudioFactStatus::Passed {
        return Err(CoreError::validation(format!(
            "CreateProductAppRelease requires releaseGate passed, got {}",
            work_fact_status_string(release_gate.status)
        )));
    }
    if let Some(check) = preview
        .checks
        .iter()
        .find(|check| check.status != WorkStudioFactStatus::Passed)
    {
        return Err(CoreError::validation(format!(
            "CreateProductAppRelease requires every readiness check to pass. {}={}",
            check.id,
            work_fact_status_string(check.status)
        )));
    }

    let readiness = ProductAppReleaseReadinessSnapshot {
        work_id: record.id.to_string(),
        preview_result_id: preview.id.clone(),
        status: work_fact_status_string(preview.status).to_string(),
        observed_at: preview.observed_at,
        checks: preview
            .checks
            .iter()
            .map(release_check_from_work_check)
            .collect(),
    };
    validate_product_app_release_readiness(&readiness)?;
    Ok(readiness)
}

fn latest_derived_release_rehearsal(record: &WorkRecord) -> Option<&WorkStudioPreviewResult> {
    record
        .studio_preview_results
        .iter()
        .filter(|preview| {
            preview.kind == WorkStudioPreviewKind::ReleaseRehearsal
                && preview.source == WorkStudioPreviewSource::ReleaseRehearsal
        })
        .max_by_key(|preview| preview.observed_at)
}

fn release_check_from_work_check(check: &WorkStudioFactCheck) -> ProductAppReleaseCheck {
    ProductAppReleaseCheck {
        id: check.id.clone(),
        status: work_fact_status_string(check.status).to_string(),
        detail: check.detail.clone(),
    }
}

fn work_fact_status_string(status: WorkStudioFactStatus) -> &'static str {
    match status {
        WorkStudioFactStatus::Passed => "passed",
        WorkStudioFactStatus::Warning => "warning",
        WorkStudioFactStatus::Failed => "failed",
        WorkStudioFactStatus::NotRun => "notRun",
        WorkStudioFactStatus::NotVerified => "notVerified",
        WorkStudioFactStatus::Blocked => "blocked",
        WorkStudioFactStatus::Running => "running",
        WorkStudioFactStatus::Ready => "ready",
        WorkStudioFactStatus::Waiting => "waiting",
    }
}

fn verify_publish_work_id(
    input: &Value,
    published: &PublishedProductAppReleaseCatalogSource,
) -> CoreResult<()> {
    let Some(work_id) = optional_string(input, "work_id").filter(|value| !value.trim().is_empty())
    else {
        return Ok(());
    };
    if work_id != published.work_id {
        return Err(CoreError::validation(format!(
            "PublishProductAppRelease work_id does not match release readiness. input={}, release={}",
            work_id, published.work_id
        )));
    }
    Ok(())
}

fn revision_ref_from_input(
    input: &Value,
    prefix: &str,
    default_current: bool,
) -> CoreResult<ProductAppRevisionRef> {
    let kind_field = format!("{prefix}_kind");
    let id_field = format!("{prefix}_id");
    let kind = optional_string(input, &kind_field)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| default_current.then(|| "current".to_string()))
        .ok_or_else(|| CoreError::validation(format!("Missing required field: {kind_field}")))?;

    match kind.as_str() {
        "current" => Ok(ProductAppRevisionRef::CurrentPackage),
        "checkpoint" => Ok(ProductAppRevisionRef::Checkpoint(required_string(
            input, &id_field,
        )?)),
        "release" => Ok(ProductAppRevisionRef::Release(required_string(
            input, &id_field,
        )?)),
        _ => Err(CoreError::validation(format!(
            "{kind_field} must be checkpoint, release, or current"
        ))),
    }
}

async fn bind_checkpoint_artifact(
    context: &ToolUseContext,
    work_id_input: Option<String>,
    checkpoint: &WrittenProductAppCheckpoint,
) -> CoreResult<Option<String>> {
    let Some(work_id_input) = work_id_input.filter(|value| !value.trim().is_empty()) else {
        return Ok(None);
    };
    let work_id = WorkId::parse(work_id_input)
        .map_err(|error| CoreError::validation(format!("Invalid work_id: {error}")))?;
    let service = work_service_from_tool_context(context)?;
    service
        .bind_artifact(
            &work_id,
            ArtifactRef {
                id: checkpoint.checkpoint_id.clone(),
                label: Some(format!(
                    "Checkpoint {} ({})",
                    checkpoint.version, checkpoint.checkpoint_id
                )),
                uri: Some(checkpoint.artifact_uri.clone()),
                runtime_provenance: None,
            },
        )
        .await?;
    Ok(Some(work_id.into_string()))
}

async fn bind_release_artifact(
    service: &WorkService,
    work_id: &WorkId,
    release: &WrittenProductAppRelease,
    label: Option<&str>,
) -> CoreResult<()> {
    service
        .bind_artifact(
            work_id,
            ArtifactRef {
                id: release.release_id.clone(),
                label: Some(
                    label
                        .filter(|value| !value.trim().is_empty())
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| {
                            format!("Release {} ({})", release.version, release.release_id)
                        }),
                ),
                uri: Some(release.artifact_uri.clone()),
                runtime_provenance: None,
            },
        )
        .await?;
    Ok(())
}

async fn bind_publish_artifact(
    context: &ToolUseContext,
    published: &PublishedProductAppReleaseCatalogSource,
) -> CoreResult<()> {
    let work_id = WorkId::parse(&published.work_id)
        .map_err(|error| CoreError::validation(format!("Invalid release work_id: {error}")))?;
    let service = work_service_from_tool_context(context)?;
    service
        .bind_artifact(
            &work_id,
            ArtifactRef {
                id: format!("catalog-source:{}", published.release_id),
                label: Some(format!(
                    "Published release {} ({})",
                    published.version, published.release_id
                )),
                uri: Some(published.artifact_uri.clone()),
                runtime_provenance: None,
            },
        )
        .await?;
    Ok(())
}

async fn bind_checkpoint_session(
    context: &ToolUseContext,
    checkpoint: &WrittenProductAppCheckpoint,
    label: Option<&str>,
    summary: Option<&str>,
) -> CoreResult<()> {
    if !has_app_studio_session_context(context) {
        return Ok(());
    }
    let Some(session_id) = context.session_id.as_deref() else {
        return Ok(());
    };
    let Some(agentic) = context.agentic() else {
        return Ok(());
    };

    let patch = json!({
        "appStudioFacts": {
            "versionSummary": {
                "currentVersion": checkpoint.version,
                "componentLockDigest": checkpoint.component_lock_digest,
                "checkpointCount": checkpoint.checkpoint_count,
                "latestCheckpoint": {
                    "checkpointId": checkpoint.checkpoint_id,
                    "artifactUri": checkpoint.artifact_uri,
                    "manifestPath": checkpoint.manifest_path.to_string_lossy(),
                    "packageDigest": checkpoint.package_digest,
                    "componentLockDigest": checkpoint.component_lock_digest,
                    "createdAt": checkpoint.created_at_ms,
                    "label": label,
                    "summary": summary,
                    "releaseStatus": "notReleased"
                },
                "releaseStatus": "notReleased"
            }
        }
    });
    agentic
        .coordinator
        .merge_session_custom_metadata(session_id, patch)
        .await?;
    Ok(())
}

async fn bind_release_session(
    context: &ToolUseContext,
    release: &WrittenProductAppRelease,
    label: Option<&str>,
    notes: Option<&str>,
) -> CoreResult<()> {
    if !has_app_studio_session_context(context) {
        return Ok(());
    }
    let Some(session_id) = context.session_id.as_deref() else {
        return Ok(());
    };
    let Some(agentic) = context.agentic() else {
        return Ok(());
    };

    let patch = json!({
        "appStudioFacts": {
            "versionSummary": {
                "currentVersion": release.version,
                "componentLockDigest": release.component_lock_digest,
                "releaseStatus": "released",
                "latestRelease": {
                    "releaseId": release.release_id,
                    "artifactUri": release.artifact_uri,
                    "manifestPath": release.manifest_path.to_string_lossy(),
                    "packageDigest": release.package_digest,
                    "componentLockDigest": release.component_lock_digest,
                    "createdAt": release.created_at_ms,
                    "label": label,
                    "notes": notes,
                    "privateDataExcluded": true
                },
                "releaseCount": release.release_count
            },
            "shareSummary": {
                "visibility": "privateRelease",
                "installLocation": "system",
                "privateDataExcluded": true,
                "latestReleaseId": release.release_id
            }
        }
    });
    agentic
        .coordinator
        .merge_session_custom_metadata(session_id, patch)
        .await?;
    Ok(())
}

async fn bind_publish_session(
    context: &ToolUseContext,
    published: &PublishedProductAppReleaseCatalogSource,
) -> CoreResult<()> {
    if !has_app_studio_session_context(context) {
        return Ok(());
    }
    let Some(session_id) = context.session_id.as_deref() else {
        return Ok(());
    };
    let Some(agentic) = context.agentic() else {
        return Ok(());
    };

    let patch = json!({
        "appStudioFacts": {
            "versionSummary": {
                "currentVersion": published.version,
                "componentLockDigest": published.component_lock_digest,
                "releaseStatus": "published",
                "latestPublishedRelease": {
                    "releaseId": published.release_id,
                    "artifactUri": published.artifact_uri,
                    "sourceDir": published.source_dir.to_string_lossy(),
                    "packageDigest": published.package_digest,
                    "componentLockDigest": published.component_lock_digest,
                    "publishedAt": published.published_at_ms
                }
            },
            "shareSummary": {
                "visibility": "catalogSource",
                "installLocation": "system",
                "privateDataExcluded": true,
                "latestReleaseId": published.release_id,
                "catalogStatus": "discoverable"
            }
        }
    });
    agentic
        .coordinator
        .merge_session_custom_metadata(session_id, patch)
        .await?;
    Ok(())
}

async fn bind_template_session(
    context: &ToolUseContext,
    written: &WrittenProductAppFromReleaseTemplate,
) -> CoreResult<()> {
    if !has_app_studio_session_context(context) {
        return Ok(());
    }
    let Some(session_id) = context.session_id.as_deref() else {
        return Ok(());
    };
    let Some(agentic) = context.agentic() else {
        return Ok(());
    };

    let updated_at = now_ms();
    let package_root = written.package_dir.to_string_lossy();
    let patch = json!({
        "agentSessionBinding": {
            "schemaVersion": 1,
            "intent": {
                "agentType": "AppStudio",
                "mode": "edit"
            },
            "subject": {
                "kind": "product-app",
                "id": written.app_id,
                "title": written.name,
                "version": written.version,
                "data": {
                    "packageRoot": package_root,
                    "componentLockDigest": written.component_lock_digest,
                    "createdByTool": "CreateProductAppFromReleaseTemplate",
                    "sourceReleaseId": written.source_release_id,
                    "sourceAppId": written.source_app_id,
                    "sourceVersion": written.source_version
                }
            },
            "surface": {
                "contentType": "app-studio",
                "title": format!("Edit {}", written.name),
                "data": {
                    "appId": written.app_id,
                    "packageRoot": package_root,
                    "scope": { "kind": "system" }
                }
            },
            "scope": { "kind": "system" },
            "workspacePath": null,
            "openedFrom": "CreateProductAppFromReleaseTemplate",
            "updatedAt": updated_at
        },
        "appStudioFacts": {
            "subject": {
                "kind": "product-app",
                "appId": written.app_id,
                "version": written.version,
                "packageRoot": package_root
            },
            "blueprint": {
                "whatItDoes": format!(
                    "Template created from release {} of {}@{}.",
                    written.source_release_id,
                    written.source_app_id,
                    written.source_version
                ),
                "howReady": "Template package created; validation, preview, runtime issues, permissions, data, and eval still gate readiness."
            },
            "technicalBlueprint": {
                "appId": written.app_id,
                "version": written.version,
                "sourceReleaseId": written.source_release_id,
                "sourceAppId": written.source_app_id,
                "sourceVersion": written.source_version
            },
            "previewResults": [],
            "issues": [],
            "logs": [],
            "validationSummary": {
                "status": "notRun",
                "failed": 0,
                "warnings": 0,
                "updatedAt": updated_at,
                "source": "derived",
                "checks": [
                    {
                        "id": "package",
                        "status": "notRun",
                        "detail": "Release template package created; run ValidateProductAppPackage before handoff."
                    }
                ]
            },
            "versionSummary": {
                "currentVersion": written.version,
                "componentLockDigest": written.component_lock_digest,
                "checkpointCount": 0,
                "releaseCount": 0,
                "releaseStatus": "notVerified"
            },
            "shareSummary": {
                "visibility": "privateDraft",
                "installLocation": "system",
                "privateDataExcluded": true
            },
            "createResult": {
                "packageRoot": package_root,
                "createdAt": updated_at,
                "sourceReleaseId": written.source_release_id,
                "templateScope": "releasePackageSourceOnly"
            }
        }
    });
    agentic
        .coordinator
        .merge_session_custom_metadata(session_id, patch)
        .await?;
    Ok(())
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

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agentic::app_studio_context::{
        AppStudioExecutionContext, AppStudioSubject, AppStudioSubjectScope,
    };
    use crate::agentic::tools::ToolRuntimeRestrictions;
    use crate::agentic_os::work::{
        WorkAppRef, WorkKind, WorkScope, WorkSubject, WorkSurfaceRef, WorkVisibility,
    };
    use std::collections::HashMap;

    fn bound_context(package_root: PathBuf, subject: AppStudioSubject) -> ToolUseContext {
        ToolUseContext {
            tool_call_id: None,
            agent_type: Some("AppStudio".to_string()),
            session_id: Some("session-1".to_string()),
            dialog_turn_id: None,
            workspace: None,
            custom_data: HashMap::new(),
            app_studio: Some(AppStudioExecutionContext {
                subject,
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
    fn checkpoint_defaults_to_bound_product_app_package_root() {
        let base = test_root("bound-product-app");
        let package_root = base.join("apps").join("current-app").join("1.0.0");
        std::fs::create_dir_all(&package_root).expect("create package root");
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let context = bound_context(
            package_root.clone(),
            AppStudioSubject::ProductApp {
                app_id: "current-app".to_string(),
                version: "1.0.0".to_string(),
                title: Some("Current App".to_string()),
                scope: AppStudioSubjectScope::System,
            },
        );

        let resolved = package_dir_from_input(
            &json!({}),
            "CreateProductAppCheckpoint",
            &path_manager,
            &context,
        )
        .expect("bound root");

        assert_eq!(resolved, package_root);
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn checkpoint_rejects_bound_component_subject() {
        let base = test_root("bound-component");
        let package_root = base
            .join("components")
            .join("surfaces")
            .join("shared")
            .join("1.0.0");
        std::fs::create_dir_all(&package_root).expect("create package root");
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let context = bound_context(
            package_root,
            AppStudioSubject::Component {
                component_id: "shared".to_string(),
                component_kind: "surfaces".to_string(),
                version: "1.0.0".to_string(),
                title: Some("Shared".to_string()),
                scope: AppStudioSubjectScope::System,
            },
        );

        let denied = package_dir_from_input(
            &json!({}),
            "CreateProductAppCheckpoint",
            &path_manager,
            &context,
        );

        assert!(denied.is_err());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn checkpoint_rejects_path_outside_bound_root() {
        let base = test_root("outside-bound-root");
        let package_root = base.join("apps").join("current-app").join("1.0.0");
        let sibling_root = base.join("apps").join("other-app").join("1.0.0");
        std::fs::create_dir_all(&package_root).expect("create package root");
        std::fs::create_dir_all(&sibling_root).expect("create sibling root");
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let context = bound_context(
            package_root,
            AppStudioSubject::ProductApp {
                app_id: "current-app".to_string(),
                version: "1.0.0".to_string(),
                title: Some("Current App".to_string()),
                scope: AppStudioSubjectScope::System,
            },
        );

        let denied = package_dir_from_input(
            &json!({ "path": sibling_root.to_string_lossy() }),
            "CreateProductAppCheckpoint",
            &path_manager,
            &context,
        );

        assert!(denied.is_err());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn release_readiness_from_work_accepts_passed_derived_release_rehearsal() {
        let mut record = release_work_record();
        record
            .studio_preview_results
            .push(release_rehearsal_preview(WorkStudioFactStatus::Passed));

        let readiness = release_readiness_from_work(&record).expect("release readiness");

        assert_eq!(readiness.status, "passed");
        assert_eq!(readiness.work_id, record.id.to_string());
        assert!(readiness
            .checks
            .iter()
            .any(|check| check.id == "releaseGate" && check.status == "passed"));
    }

    #[test]
    fn release_readiness_from_work_rejects_missing_required_readiness_check() {
        let mut record = release_work_record();
        let mut preview = release_rehearsal_preview(WorkStudioFactStatus::Passed);
        preview.checks.retain(|check| check.id != "runtimeStorage");
        record.studio_preview_results.push(preview);

        let error = release_readiness_from_work(&record)
            .expect_err("missing runtime evidence should fail")
            .to_string();

        assert!(error.contains("runtimeStorage readiness evidence"));
    }

    #[test]
    fn release_readiness_from_work_rejects_unpassed_release_gate() {
        let mut record = release_work_record();
        record
            .studio_preview_results
            .push(release_rehearsal_preview(WorkStudioFactStatus::NotVerified));

        let error = release_readiness_from_work(&record)
            .expect_err("unpassed release gate should fail")
            .to_string();

        assert!(error.contains("release readiness passed"));
    }

    #[test]
    fn publish_work_id_accepts_matching_release_readiness_work() {
        let published = published_release_source("work_release_test");

        verify_publish_work_id(&json!({ "work_id": "work_release_test" }), &published)
            .expect("matching work id should pass");
    }

    #[test]
    fn publish_work_id_rejects_mismatched_release_readiness_work() {
        let published = published_release_source("work_release_test");

        let error = verify_publish_work_id(&json!({ "work_id": "other_work" }), &published)
            .expect_err("mismatched work id should fail")
            .to_string();

        assert!(error.contains("does not match release readiness"));
    }

    fn release_work_record() -> WorkRecord {
        let work_id = WorkId::parse("work_release_test").expect("work id");
        let app = WorkAppRef::product_app("release-app", "1.0.0", "sha256:lock");
        WorkRecord::new(
            work_id,
            WorkKind::AppWorkflow,
            "Release app".to_string(),
            "Prepare release.".to_string(),
            WorkVisibility::Primary,
            WorkSubject::App {
                app: app.clone(),
                intent: Default::default(),
            },
            Vec::new(),
            WorkScope::System,
            WorkSurfaceRef::ApplicationSurface {
                product_app_id: app.app_id,
                product_app_surface_id: "release-app-surface".to_string(),
                surface_id: "primary".to_string(),
            },
            1,
        )
    }

    fn release_rehearsal_preview(
        release_gate_status: WorkStudioFactStatus,
    ) -> WorkStudioPreviewResult {
        let checks = [
            ("validation", WorkStudioFactStatus::Passed),
            ("preview", WorkStudioFactStatus::Passed),
            ("issues", WorkStudioFactStatus::Passed),
            ("criticalPath", WorkStudioFactStatus::Passed),
            ("permissions", WorkStudioFactStatus::Passed),
            ("data", WorkStudioFactStatus::Passed),
            ("dataLifecycle", WorkStudioFactStatus::Passed),
            ("dataSummary", WorkStudioFactStatus::Passed),
            ("runtimeStorage", WorkStudioFactStatus::Passed),
            ("runtimeDependencies", WorkStudioFactStatus::Passed),
            ("agentEval", WorkStudioFactStatus::Passed),
            ("userPath", WorkStudioFactStatus::Passed),
            ("releaseGate", release_gate_status),
        ]
        .into_iter()
        .map(|(id, status)| WorkStudioFactCheck {
            id: id.to_string(),
            status,
            detail: Some(format!("{id} evidence.")),
        })
        .collect::<Vec<_>>();

        WorkStudioPreviewResult {
            id: "preview:release-rehearsal:work_release_test".to_string(),
            kind: WorkStudioPreviewKind::ReleaseRehearsal,
            status: release_gate_status,
            source: WorkStudioPreviewSource::ReleaseRehearsal,
            harness_mode: Some("release-rehearsal".to_string()),
            trigger_turn_id: None,
            detail: Some("Derived release rehearsal.".to_string()),
            checks,
            work_id: WorkId::parse("work_release_test").expect("work id"),
            runtime_instance_id: None,
            product_app_id: Some("release-app".to_string()),
            component_id: None,
            product_app_surface_id: None,
            surface_id: None,
            observed_at: 10,
            issue_count: 0,
            fatal_issue_count: 0,
            warning_issue_count: 0,
        }
    }

    fn published_release_source(work_id: &str) -> PublishedProductAppReleaseCatalogSource {
        PublishedProductAppReleaseCatalogSource {
            app_id: "release-app".to_string(),
            version: "1.0.0".to_string(),
            release_id: "release-release-app-1.0.0-1-abcdef".to_string(),
            release_label: Some("Release candidate".to_string()),
            release_notes: Some("Ready for catalog publication.".to_string()),
            artifact_uri:
                "product-app://release-app@1.0.0/releases/release-release-app-1.0.0-1-abcdef"
                    .to_string(),
            source_dir: PathBuf::from("catalog-source"),
            component_lock_digest: "sha256:lock".to_string(),
            package_digest: "sha256:package".to_string(),
            published_at_ms: 1,
            work_id: work_id.to_string(),
        }
    }

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "sparo-create-product-app-checkpoint-tool-{name}-{}",
            uuid::Uuid::new_v4()
        ))
    }
}
