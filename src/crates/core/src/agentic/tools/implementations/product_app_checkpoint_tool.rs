//! Draft checkpoint tools for Product App authoring.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use log::warn;
use serde_json::{json, Value};

use crate::agentic::app_builder_context::{AppBuilderSubject, AppBuilderSubjectScope};
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::agentic::tools::implementations::util::{
    bound_app_builder_draft_root, enforce_app_builder_package_write,
    has_app_builder_session_context,
};
use crate::agentic::tools::implementations::work_tool_support::work_service_from_tool_context;
use crate::agentic_os::work::{ArtifactRef, WorkId, WorkLocator, WorkScope};
use crate::app_platform::{
    compare_product_app_revisions, create_product_app_checkpoint, list_system_shared_components,
    restore_product_app_checkpoint, CompareProductAppRevisionsRequest,
    CreateProductAppCheckpointRequest, ProductAppRevisionRef, RestoreProductAppCheckpointRequest,
    WrittenProductAppCheckpoint,
};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::try_get_path_manager_arc;

pub struct CreateProductAppCheckpointTool;
pub struct RestoreProductAppCheckpointTool;
pub struct CompareProductAppRevisionsTool;

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

#[async_trait]
impl Tool for CreateProductAppCheckpointTool {
    fn name(&self) -> &str {
        "CreateProductAppCheckpoint"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Create a draft checkpoint for the current Product App package. The checkpoint verifies app.json, app.lock.json, and the resolved component lock, then records deterministic source file hashes under checkpoints/<checkpoint_id>. It is authoring history only; publishing a Release is handled by the intelligent-app lifecycle API.

The package is derived exclusively from the bound Draft identity. Optional work_id binds the checkpoint as a Work artifact."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "label": { "type": "string", "description": "Optional short checkpoint label." },
                "summary": { "type": "string", "description": "Optional authoring summary." },
                "work_id": { "type": "string", "description": "Optional Work id to receive the checkpoint artifact." }
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
        let path_manager = try_get_path_manager_arc()
            .map_err(|error| CoreError::tool(format!("PathManager not initialized: {error}")))?;
        let package_dir = package_dir_for_write(self.name(), context).await?;
        let shared_components =
            list_system_shared_components(&path_manager)
                .await
                .map_err(|error| {
                    CoreError::tool(format!("Failed to read system shared components: {error}"))
                })?;
        let label = optional_string(input, "label").filter(|value| !value.is_empty());
        let summary = optional_string(input, "summary").filter(|value| !value.is_empty());
        let checkpoint = create_product_app_checkpoint(CreateProductAppCheckpointRequest {
            package_dir: package_dir.clone(),
            shared_components,
            label: label.clone(),
            summary: summary.clone(),
            created_by: Some(self.name().to_string()),
            created_at_ms: now_ms(),
        })
        .await
        .map_err(|error| {
            CoreError::tool(format!("Failed to create Product App checkpoint: {error}"))
        })?;

        let work_id =
            bind_checkpoint_artifact(context, optional_string(input, "work_id"), &checkpoint)
                .await?;
        if let Err(error) =
            bind_checkpoint_session(context, &checkpoint, label.as_deref(), summary.as_deref())
                .await
        {
            warn!(
                "Failed to bind Product App checkpoint to App Builder session: session_id={:?}, checkpoint_id={}, error={}",
                context.session_id, checkpoint.checkpoint_id, error
            );
        }

        let result_text = format!(
            "Draft checkpoint created for {}@{}. checkpoint_id: {}.",
            checkpoint.app_id, checkpoint.version, checkpoint.checkpoint_id
        );
        Ok(vec![ToolResult::Result {
            data: json!({
                "status": "checkpointed",
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
                "created_at": checkpoint.created_at_ms,
                "work_id": work_id
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
        Ok(r#"Restore the bound Product App Draft from one of its checkpoints. This replaces checkpointed package source while preserving the checkpoint history and local runtime-only directories.

Input: checkpoint_id and confirm=true. In a bound App Builder session, omit package identity because the bound Draft is always used."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["checkpoint_id", "confirm"],
            "properties": {
                "checkpoint_id": { "type": "string", "description": "Checkpoint id under checkpoints/." },
                "confirm": { "type": "boolean", "const": true, "description": "Required destructive-edit confirmation." }
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
        true
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> CoreResult<Vec<ToolResult>> {
        let path_manager = try_get_path_manager_arc()
            .map_err(|error| CoreError::tool(format!("PathManager not initialized: {error}")))?;
        let package_dir = package_dir_for_write(self.name(), context).await?;
        let checkpoint_id = required_string(input, "checkpoint_id")?;
        let confirm = input
            .get("confirm")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let shared_components =
            list_system_shared_components(&path_manager)
                .await
                .map_err(|error| {
                    CoreError::tool(format!("Failed to read system shared components: {error}"))
                })?;
        let restored = restore_product_app_checkpoint(RestoreProductAppCheckpointRequest {
            package_dir: package_dir.clone(),
            shared_components,
            checkpoint_id,
            confirm,
        })
        .await
        .map_err(|error| {
            CoreError::tool(format!("Failed to restore Product App checkpoint: {error}"))
        })?;

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
                "removed_files": restored.removed_files,
                "scope": "draftSource"
            }),
            result_for_assistant: Some(format!(
                "Draft checkpoint {} restored. restored_files={}, removed_files={}.",
                restored.checkpoint_id, restored.restored_files, restored.removed_files
            )),
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
        Ok(r#"Compare two Product App Draft source states using checkpoints or the current package. This read-only tool returns added, removed, and modified files by deterministic sha256 hash.

Input: base_kind and optional base_id. target_kind defaults to current. Allowed kinds are checkpoint and current."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["base_kind"],
            "properties": {
                "base_kind": { "type": "string", "enum": ["checkpoint", "current"] },
                "base_id": { "type": "string", "description": "Required when base_kind is checkpoint." },
                "target_kind": { "type": "string", "enum": ["checkpoint", "current"], "default": "current" },
                "target_id": { "type": "string", "description": "Required when target_kind is checkpoint." }
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
        let package_dir = package_dir_from_context(self.name(), context)?;
        let comparison = compare_product_app_revisions(CompareProductAppRevisionsRequest {
            package_dir: package_dir.clone(),
            base: revision_ref_from_input(input, "base", false)?,
            target: revision_ref_from_input(input, "target", true)?,
        })
        .await
        .map_err(|error| {
            CoreError::tool(format!("Failed to compare Product App revisions: {error}"))
        })?;

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
            result_for_assistant: Some(format!(
                "Draft comparison complete. changed={}, unchanged={}.",
                comparison.changed_count, comparison.unchanged_count
            )),
            image_attachments: None,
        }])
    }
}

fn package_dir_from_context(operation_name: &str, context: &ToolUseContext) -> CoreResult<PathBuf> {
    bound_app_builder_draft_root(context, operation_name)?.ok_or_else(|| {
        CoreError::validation(format!(
            "{operation_name} is only available inside an authorized Intelligent App Draft"
        ))
    })
}

async fn package_dir_for_write(
    operation_name: &str,
    context: &ToolUseContext,
) -> CoreResult<PathBuf> {
    let package_dir = package_dir_from_context(operation_name, context)?;
    enforce_app_builder_package_write(context, package_dir.to_string_lossy().as_ref()).await?;
    Ok(package_dir)
}

fn revision_ref_from_input(
    input: &Value,
    prefix: &str,
    default_current: bool,
) -> CoreResult<ProductAppRevisionRef> {
    let kind_field = format!("{prefix}_kind");
    let id_field = format!("{prefix}_id");
    let kind = optional_string(input, &kind_field)
        .filter(|value| !value.is_empty())
        .or_else(|| default_current.then(|| "current".to_string()))
        .ok_or_else(|| CoreError::validation(format!("Missing required field: {kind_field}")))?;
    match kind.as_str() {
        "current" => Ok(ProductAppRevisionRef::CurrentPackage),
        "checkpoint" => Ok(ProductAppRevisionRef::Checkpoint(required_string(
            input, &id_field,
        )?)),
        _ => Err(CoreError::validation(format!(
            "{kind_field} must be checkpoint or current"
        ))),
    }
}

async fn bind_checkpoint_artifact(
    context: &ToolUseContext,
    work_id_input: Option<String>,
    checkpoint: &WrittenProductAppCheckpoint,
) -> CoreResult<Option<String>> {
    let Some(work_id_input) = work_id_input.filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let work_id = WorkId::parse(work_id_input)
        .map_err(|error| CoreError::validation(format!("Invalid work_id: {error}")))?;
    let app_builder = context
        .app_builder
        .as_ref()
        .ok_or_else(|| CoreError::validation("App Builder context is required for work binding"))?;
    let AppBuilderSubject::BuilderDraft { scope, .. } = &app_builder.subject;
    let scope = match scope {
        AppBuilderSubjectScope::System => WorkScope::Global,
        AppBuilderSubjectScope::Workspace { workspace_path } => WorkScope::Workspace {
            workspace_id: try_get_path_manager_arc()?.workspace_id(workspace_path)?,
        },
    };
    work_service_from_tool_context(context)?
        .bind_artifact(
            &WorkLocator {
                scope,
                work_id: work_id.clone(),
            },
            ArtifactRef {
                id: checkpoint.checkpoint_id.clone(),
                label: Some(format!(
                    "Draft checkpoint {} ({})",
                    checkpoint.version, checkpoint.checkpoint_id
                )),
                uri: Some(checkpoint.artifact_uri.clone()),
                runtime_provenance: None,
            },
        )
        .await?;
    Ok(Some(work_id.into_string()))
}

async fn bind_checkpoint_session(
    context: &ToolUseContext,
    checkpoint: &WrittenProductAppCheckpoint,
    label: Option<&str>,
    summary: Option<&str>,
) -> CoreResult<()> {
    if !has_app_builder_session_context(context) {
        return Ok(());
    }
    let Some(session_id) = context.session_id.as_deref() else {
        return Ok(());
    };
    let Some(agentic) = context.agentic() else {
        return Ok(());
    };
    agentic
        .coordinator
        .merge_session_custom_metadata(
            session_id,
            json!({
                "appBuilderFacts": {
                    "draftHistory": {
                        "currentVersion": checkpoint.version,
                        "componentLockDigest": checkpoint.component_lock_digest,
                        "checkpointCount": checkpoint.checkpoint_count,
                        "latestCheckpoint": {
                            "checkpointId": checkpoint.checkpoint_id,
                            "artifactUri": checkpoint.artifact_uri,
                            "manifestPath": checkpoint.manifest_path.to_string_lossy(),
                            "packageDigest": checkpoint.package_digest,
                            "createdAt": checkpoint.created_at_ms,
                            "label": label,
                            "summary": summary
                        }
                    }
                }
            }),
        )
        .await?;
    Ok(())
}

fn required_string(input: &Value, field: &str) -> CoreResult<String> {
    let value = optional_string(input, field)
        .ok_or_else(|| CoreError::validation(format!("Missing required field: {field}")))?;
    if value.is_empty() {
        return Err(CoreError::validation(format!("{field} cannot be empty")));
    }
    Ok(value)
}

fn optional_string(input: &Value, field: &str) -> Option<String> {
    input
        .get(field)
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}
