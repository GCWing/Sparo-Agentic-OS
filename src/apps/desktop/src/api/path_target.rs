//! Shared desktop resolution and access helpers for local and runtime paths.

use crate::api::app_state::AppState;
use sparo_core::agentic::tools::workspace_paths::{is_sparo_runtime_uri, parse_sparo_runtime_uri};
use sparo_core::infrastructure::get_path_manager_arc;
use sparo_core::infrastructure::FileOperationOptions;
use sparo_core::service::workspace::WorkspaceInfo;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone)]
pub struct DesktopPathTarget {
    pub requested_path: String,
    pub resolved_path: PathBuf,
    pub is_runtime_artifact: bool,
}

impl DesktopPathTarget {
    pub fn requested_path(&self) -> &str {
        self.requested_path.as_str()
    }

    pub fn as_local_path(&self) -> Option<&Path> {
        Some(self.resolved_path.as_path())
    }

    pub fn is_runtime_artifact(&self) -> bool {
        self.is_runtime_artifact
    }
}

fn runtime_root_for_workspace_info(workspace: &WorkspaceInfo) -> Result<PathBuf, String> {
    Ok(get_path_manager_arc().workspace_runtime_root(&workspace.root_path))
}

async fn resolve_runtime_artifact_path(
    app_state: &AppState,
    raw_path: &str,
) -> Result<Option<PathBuf>, String> {
    if !is_sparo_runtime_uri(raw_path) {
        return Ok(None);
    }

    let parsed = parse_sparo_runtime_uri(raw_path).map_err(|e| e.to_string())?;
    let workspace = if parsed.workspace_scope == "last-used" {
        app_state.workspace_service.get_last_used_workspace().await
    } else {
        app_state
            .workspace_service
            .list_workspace_infos()
            .await
            .into_iter()
            .find(|workspace| workspace.id == parsed.workspace_scope)
    }
    .ok_or_else(|| {
        format!(
            "Unable to resolve runtime URI scope '{}'",
            parsed.workspace_scope
        )
    })?;

    let mut resolved = runtime_root_for_workspace_info(&workspace)?;
    for segment in parsed.relative_path.split('/') {
        resolved.push(segment);
    }

    Ok(Some(resolved))
}

pub async fn resolve_desktop_path_target(
    app_state: &AppState,
    raw_path: &str,
) -> Result<DesktopPathTarget, String> {
    if let Some(resolved_path) = resolve_runtime_artifact_path(app_state, raw_path).await? {
        return Ok(DesktopPathTarget {
            requested_path: raw_path.to_string(),
            resolved_path,
            is_runtime_artifact: true,
        });
    }

    Ok(DesktopPathTarget {
        requested_path: raw_path.to_string(),
        resolved_path: PathBuf::from(raw_path),
        is_runtime_artifact: false,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileMetadata {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_path: Option<String>,
    pub modified: u64,
    pub size: u64,
    pub is_file: bool,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_runtime_artifact: Option<bool>,
}

pub fn stat_local_path_metadata(
    requested_path: &str,
    resolved_path: &Path,
    is_runtime_artifact: bool,
) -> Result<LocalFileMetadata, String> {
    let metadata = std::fs::metadata(resolved_path).map_err(|e| {
        format!(
            "Failed to stat local file '{}': {}",
            resolved_path.display(),
            e
        )
    })?;

    let modified = metadata
        .modified()
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    Ok(LocalFileMetadata {
        path: requested_path.to_string(),
        resolved_path: is_runtime_artifact.then(|| resolved_path.to_string_lossy().to_string()),
        modified,
        size: metadata.len(),
        is_file: metadata.is_file(),
        is_dir: metadata.is_dir(),
        is_runtime_artifact: is_runtime_artifact.then_some(true),
    })
}

pub async fn read_text_file(app_state: &AppState, raw_path: &str) -> Result<String, String> {
    let target = resolve_desktop_path_target(app_state, raw_path).await?;
    app_state
        .filesystem_service
        .read_file(&target.resolved_path.to_string_lossy())
        .await
        .map(|result| result.content)
        .map_err(|e| format!("Failed to read file content: {}", e))
}

pub async fn write_text_file(
    app_state: &AppState,
    raw_path: &str,
    content: &str,
) -> Result<(), String> {
    let target = resolve_desktop_path_target(app_state, raw_path).await?;
    let options = FileOperationOptions {
        backup_on_overwrite: false,
        ..FileOperationOptions::default()
    };
    app_state
        .filesystem_service
        .write_file_with_options(&target.resolved_path.to_string_lossy(), content, options)
        .await
        .map(|_| ())
        .map_err(|e| format!("Failed to write file {}: {}", raw_path, e))
}

pub async fn path_exists(app_state: &AppState, raw_path: &str) -> Result<bool, String> {
    let target = resolve_desktop_path_target(app_state, raw_path).await?;
    Ok(target.resolved_path.exists())
}

pub async fn get_path_metadata(
    app_state: &AppState,
    raw_path: &str,
) -> Result<serde_json::Value, String> {
    let target = resolve_desktop_path_target(app_state, raw_path).await?;
    let metadata = stat_local_path_metadata(
        &target.requested_path,
        &target.resolved_path,
        target.is_runtime_artifact,
    )?;
    serde_json::to_value(metadata).map_err(|e| format!("Failed to serialize file metadata: {}", e))
}

pub async fn rename_path(
    app_state: &AppState,
    old_path: &str,
    new_path: &str,
) -> Result<(), String> {
    let old_target = resolve_desktop_path_target(app_state, old_path).await?;
    let new_target = resolve_desktop_path_target(app_state, new_path).await?;
    app_state
        .filesystem_service
        .move_file(
            &old_target.resolved_path.to_string_lossy(),
            &new_target.resolved_path.to_string_lossy(),
        )
        .await
        .map_err(|e| format!("Failed to rename file: {}", e))
}

pub async fn delete_file(app_state: &AppState, raw_path: &str) -> Result<(), String> {
    let target = resolve_desktop_path_target(app_state, raw_path).await?;
    app_state
        .filesystem_service
        .delete_file(&target.resolved_path.to_string_lossy())
        .await
        .map_err(|e| format!("Failed to delete file: {}", e))
}

pub async fn delete_directory(
    app_state: &AppState,
    raw_path: &str,
    recursive: bool,
) -> Result<(), String> {
    let target = resolve_desktop_path_target(app_state, raw_path).await?;
    app_state
        .filesystem_service
        .delete_directory(&target.resolved_path.to_string_lossy(), recursive)
        .await
        .map_err(|e| format!("Failed to delete directory: {}", e))
}

pub async fn create_empty_file(app_state: &AppState, raw_path: &str) -> Result<(), String> {
    let target = resolve_desktop_path_target(app_state, raw_path).await?;
    let options = FileOperationOptions::default();
    app_state
        .filesystem_service
        .write_file_with_options(&target.resolved_path.to_string_lossy(), "", options)
        .await
        .map(|_| ())
        .map_err(|e| format!("Failed to create file: {}", e))
}

pub async fn create_directory(app_state: &AppState, raw_path: &str) -> Result<(), String> {
    let target = resolve_desktop_path_target(app_state, raw_path).await?;
    app_state
        .filesystem_service
        .create_directory(&target.resolved_path.to_string_lossy())
        .await
        .map_err(|e| format!("Failed to create directory: {}", e))
}
