use crate::infrastructure::get_path_manager_arc;
use crate::util::errors::*;
use std::time::UNIX_EPOCH;
use tokio::fs::{self, File};
use tokio::io::AsyncReadExt;

pub(crate) const HOST_OVERVIEW_CONTEXT_MAX_LINES: usize = 200;

#[derive(Debug, Clone, Default)]
pub(crate) struct HostOverviewStatus {
    pub exists: bool,
    pub is_empty: bool,
    pub modified_at_ms: Option<i64>,
}

pub(crate) fn host_overview_file_path() -> std::path::PathBuf {
    get_path_manager_arc().agentic_os_host_overview_path()
}

pub(crate) async fn ensure_host_overview_runtime_dir() -> BitFunResult<()> {
    let host_dir = get_path_manager_arc().agentic_os_host_dir();
    fs::create_dir_all(&host_dir).await.map_err(|error| {
        BitFunError::service(format!(
            "Failed to create Agentic OS host runtime directory {}: {}",
            host_dir.display(),
            error
        ))
    })?;
    Ok(())
}

pub(crate) async fn build_host_overview_context() -> BitFunResult<Option<String>> {
    ensure_host_overview_runtime_dir().await?;

    let path = host_overview_file_path();
    let mut section = format!(
        "# Host Environment Context\nThe host overview file lives at `{}`. This file is reserved for machine-level routing context about where work, tools, documents, and new workspaces likely belong on this host.\n",
        format_path_for_prompt(&path)
    );

    if !path.exists() {
        section.push_str(
            "\nNo host overview has been written yet. If the current task is to scan the host, create this file.\n",
        );
        return Ok(Some(section));
    }

    let content = fs::read_to_string(&path).await.map_err(|error| {
        BitFunError::service(format!(
            "Failed to read host overview file {}: {}",
            path.display(),
            error
        ))
    })?;

    let trimmed = content.trim();
    if trimmed.is_empty() {
        section.push_str(
            "\nThe host overview file already exists but is currently empty. If the current task is to scan the host, populate it.\n",
        );
        return Ok(Some(section));
    }

    let truncated = truncate_to_line_limit(trimmed, HOST_OVERVIEW_CONTEXT_MAX_LINES);
    section.push_str(
        "\nUse the existing overview below as prior machine-level context. Treat it as guidance, not ground truth, and verify before taking sensitive actions.\n\n",
    );
    section.push_str(&format!("<host_overview>{}</host_overview>", truncated));

    Ok(Some(section))
}

pub(crate) async fn read_host_overview_status() -> BitFunResult<HostOverviewStatus> {
    ensure_host_overview_runtime_dir().await?;

    let path = host_overview_file_path();
    let metadata = match fs::metadata(&path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(HostOverviewStatus::default());
        }
        Err(error) => {
            return Err(BitFunError::service(format!(
                "Failed to read host overview metadata {}: {}",
                path.display(),
                error
            )));
        }
    };

    let modified_at_ms = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| i64::try_from(duration.as_millis()).ok());

    let is_empty = if metadata.len() == 0 {
        true
    } else {
        !file_contains_non_whitespace(&path).await?
    };

    Ok(HostOverviewStatus {
        exists: true,
        is_empty,
        modified_at_ms,
    })
}

async fn file_contains_non_whitespace(path: &std::path::Path) -> BitFunResult<bool> {
    let mut file = File::open(path).await.map_err(|error| {
        BitFunError::service(format!(
            "Failed to open host overview file {}: {}",
            path.display(),
            error
        ))
    })?;

    let mut buffer = [0_u8; 2048];
    let mut is_first_chunk = true;

    loop {
        let bytes_read = file.read(&mut buffer).await.map_err(|error| {
            BitFunError::service(format!(
                "Failed to read host overview file {}: {}",
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

fn format_path_for_prompt(path: &std::path::Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn truncate_to_line_limit(value: &str, max_lines: usize) -> &str {
    if max_lines == 0 {
        return "";
    }

    let line_count = value.lines().count();
    if line_count <= max_lines {
        return value;
    }

    let mut end = value.len();
    for (count, (index, _)) in value.match_indices('\n').enumerate() {
        if count + 1 == max_lines {
            end = index;
            break;
        }
    }

    &value[..end]
}

#[cfg(test)]
mod tests {
    use super::truncate_to_line_limit;

    #[test]
    fn truncate_limits_to_first_n_lines() {
        let value = "line1\nline2\nline3\nline4";
        assert_eq!(truncate_to_line_limit(value, 2), "line1\nline2");
    }

    #[test]
    fn truncate_preserves_utf8_content() {
        let value = "盘符 overview\n第二行\n第三行";
        assert_eq!(truncate_to_line_limit(value, 2), "盘符 overview\n第二行");
    }
}
