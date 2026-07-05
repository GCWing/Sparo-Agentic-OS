use crate::infrastructure::get_path_manager_arc;
use crate::error::*;
use std::time::UNIX_EPOCH;
use tokio::fs::{self, File};
use tokio::io::AsyncReadExt;

pub(crate) const WORKSPACE_OVERVIEW_FILE_MAX_CHARS: usize = 600;

#[derive(Debug, Clone, Default)]
pub(crate) struct WorkspaceOverviewDirectoryStatus {
    pub exists: bool,
    pub has_non_empty_files: bool,
    pub latest_modified_at_ms: Option<i64>,
}

pub(crate) fn workspace_overview_dir_path() -> std::path::PathBuf {
    get_path_manager_arc().agentic_os_workspaces_overview_dir()
}

pub(crate) async fn ensure_workspace_overview_runtime_dir() -> CoreResult<()> {
    let dir = workspace_overview_dir_path();
    fs::create_dir_all(&dir).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to create workspace overview runtime directory {}: {}",
            dir.display(),
            error
        ))
    })?;
    Ok(())
}

pub(crate) async fn read_workspace_overview_directory_status(
) -> CoreResult<WorkspaceOverviewDirectoryStatus> {
    ensure_workspace_overview_runtime_dir().await?;

    let dir = workspace_overview_dir_path();
    if !dir.exists() {
        return Ok(WorkspaceOverviewDirectoryStatus::default());
    }

    let mut latest_modified_at_ms: Option<i64> = None;
    let mut has_non_empty_files = false;
    let mut entries = fs::read_dir(&dir).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to read workspace overview directory {}: {}",
            dir.display(),
            error
        ))
    })?;

    while let Some(entry) = entries.next_entry().await.map_err(|error| {
        CoreError::service(format!(
            "Failed to iterate workspace overview directory {}: {}",
            dir.display(),
            error
        ))
    })? {
        let path = entry.path();
        let is_md = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_md {
            continue;
        }

        let metadata = entry.metadata().await.map_err(|error| {
            CoreError::service(format!(
                "Failed to read workspace overview metadata {}: {}",
                path.display(),
                error
            ))
        })?;
        let modified_at_ms = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .and_then(|duration| i64::try_from(duration.as_millis()).ok());
        latest_modified_at_ms = match (latest_modified_at_ms, modified_at_ms) {
            (Some(current), Some(candidate)) => Some(current.max(candidate)),
            (None, Some(candidate)) => Some(candidate),
            (current, None) => current,
        };

        if metadata.len() > 0 && file_contains_non_whitespace(&path).await? {
            has_non_empty_files = true;
        }
    }

    Ok(WorkspaceOverviewDirectoryStatus {
        exists: true,
        has_non_empty_files,
        latest_modified_at_ms,
    })
}

async fn file_contains_non_whitespace(path: &std::path::Path) -> CoreResult<bool> {
    let mut file = File::open(path).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to open workspace overview file {}: {}",
            path.display(),
            error
        ))
    })?;

    let mut buffer = [0_u8; 2048];
    let mut is_first_chunk = true;

    loop {
        let bytes_read = file.read(&mut buffer).await.map_err(|error| {
            CoreError::service(format!(
                "Failed to read workspace overview file {}: {}",
                path.display(),
                error
            ))
        })?;

        if bytes_read == 0 {
            return Ok(false);
        }

        let mut slice = &buffer[..bytes_read];
        if is_first_chunk {
            is_first_chunk = false;
            if slice.starts_with(&[0xEF, 0xBB, 0xBF]) {
                slice = &slice[3..];
            }
        }

        if slice.iter().any(|byte| !byte.is_ascii_whitespace()) {
            return Ok(true);
        }
    }
}
