use super::{ensure_markdown_placeholder, format_path_for_prompt};
use crate::infrastructure::get_path_manager_arc;
use crate::service::workspace::{get_global_workspace_service, WorkspaceInfo, WorkspaceKind};
use crate::util::errors::*;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use tokio::fs;

const WORKSPACES_OVERVIEW_DIR: &str = "workspaces_overview";
const WORKSPACE_OVERVIEW_MAX_CHARS_PER_FILE: usize = 500;
const WORKSPACE_OVERVIEW_MAX_TOTAL_CHARS: usize = 10_000;

pub(super) async fn ensure_global_memory_overview_files(memory_dir: &Path) -> BitFunResult<()> {
    let overview_dir = memory_dir.join(WORKSPACES_OVERVIEW_DIR);
    tokio::fs::create_dir_all(&overview_dir)
        .await
        .map_err(|e| {
            BitFunError::service(format!(
                "Failed to create global workspace overview directory {}: {}",
                overview_dir.display(),
                e
            ))
        })?;

    let Some(workspace_service) = get_global_workspace_service() else {
        return Ok(());
    };

    let mut known_workspaces =
        collect_dispatcher_overview_workspaces(workspace_service.as_ref()).await;

    known_workspaces.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });

    for workspace in &known_workspaces {
        ensure_workspace_overview_file(&overview_dir, workspace).await?;
    }

    Ok(())
}

pub(crate) async fn build_global_workspace_overviews_context(
    memory_dir: &Path,
) -> BitFunResult<Option<String>> {
    ensure_global_memory_overview_files(memory_dir).await?;

    let overview_dir = memory_dir.join(WORKSPACES_OVERVIEW_DIR);
    if !overview_dir.exists() {
        return Ok(None);
    }

    let workspace_paths = build_workspace_overview_path_map(&overview_dir).await;
    let mut ordered_files = ordered_workspace_overview_paths(&overview_dir).await?;
    if ordered_files.is_empty() {
        return Ok(None);
    }

    let mut rendered_entries = Vec::new();
    let mut total_chars = 0usize;

    for path in ordered_files.drain(..) {
        let content = match fs::read_to_string(&path).await {
            Ok(content) => content,
            Err(_) => continue,
        };

        let trimmed = content.trim();
        let truncated = truncate_to_char_boundary(trimmed, WORKSPACE_OVERVIEW_MAX_CHARS_PER_FILE);

        let filename = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_string())
            .unwrap_or_else(|| path.to_string_lossy().to_string());
        let workspace_path = workspace_paths
            .get(&filename)
            .cloned()
            .unwrap_or_else(|| "(unknown workspace path)".to_string());

        let entry = format!(
            "<workspace path=\"{}\">\n<overview file_name=\"{}\">{}</overview>\n</workspace>",
            workspace_path, filename, truncated
        );
        let entry_len = entry.chars().count();

        if !rendered_entries.is_empty()
            && total_chars + entry_len > WORKSPACE_OVERVIEW_MAX_TOTAL_CHARS
        {
            break;
        }

        total_chars += entry_len;
        rendered_entries.push(entry);
    }

    if rendered_entries.is_empty() {
        Ok(None)
    } else {
        Ok(Some(format!(
            "# Workspace Routing Context\nThe entries below are tracked workspace routing candidates. Use them as durable routing hints when deciding which workspace a delegated session should use. They are common candidates, not an exhaustive or exclusive list. Notes are loaded from `{}` and each file is truncated to {} characters.\n\n{}",
            overview_dir.to_string_lossy().replace('\\', "/"),
            WORKSPACE_OVERVIEW_MAX_CHARS_PER_FILE,
            rendered_entries.join("\n\n")
        )))
    }
}

async fn ensure_workspace_overview_file(
    overview_dir: &Path,
    workspace: &WorkspaceInfo,
) -> BitFunResult<()> {
    let overview_path = overview_dir.join(workspace_overview_file_name(workspace));
    let content = format_workspace_overview(workspace);
    ensure_markdown_placeholder(&overview_path, &content).await?;
    Ok(())
}

fn workspace_overview_file_name(workspace: &WorkspaceInfo) -> String {
    format!(
        "{}--{}.md",
        workspace_overview_slug(workspace),
        workspace_overview_hash(workspace)
    )
}

fn format_workspace_overview(_workspace: &WorkspaceInfo) -> String {
    "".to_string()
}

async fn build_workspace_overview_path_map(overview_dir: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();

    let Some(workspace_service) = get_global_workspace_service() else {
        return map;
    };

    for workspace in collect_dispatcher_overview_workspaces(workspace_service.as_ref()).await {
        push_workspace_overview_metadata(&mut map, overview_dir, &workspace);
    }

    map
}

async fn ordered_workspace_overview_paths(
    overview_dir: &Path,
) -> BitFunResult<Vec<std::path::PathBuf>> {
    let mut ordered = Vec::new();
    let mut seen = HashSet::new();

    if let Some(workspace_service) = get_global_workspace_service() {
        for workspace in collect_dispatcher_overview_workspaces(workspace_service.as_ref()).await {
            push_workspace_overview_path(&overview_dir, &workspace, &mut ordered, &mut seen);
        }
    }

    let mut remaining = Vec::new();
    let mut entries = fs::read_dir(overview_dir).await.map_err(|e| {
        BitFunError::service(format!(
            "Failed to read global workspace overview directory {}: {}",
            overview_dir.display(),
            e
        ))
    })?;

    while let Some(entry) = entries.next_entry().await.map_err(|e| {
        BitFunError::service(format!(
            "Failed to iterate global workspace overview directory {}: {}",
            overview_dir.display(),
            e
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

        let key = path.to_string_lossy().to_string();
        if seen.insert(key) {
            remaining.push(path);
        }
    }

    remaining.sort_by(|left, right| {
        left.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .cmp(
                right
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default(),
            )
    });
    ordered.extend(remaining);

    Ok(ordered)
}

fn push_workspace_overview_path(
    overview_dir: &Path,
    workspace: &WorkspaceInfo,
    ordered: &mut Vec<std::path::PathBuf>,
    seen: &mut HashSet<String>,
) {
    if !should_include_in_dispatcher_workspace_overviews(workspace) {
        return;
    }

    let path = overview_dir.join(workspace_overview_file_name(workspace));
    let key = path.to_string_lossy().to_string();
    if seen.insert(key) {
        ordered.push(path);
    }
}

fn push_workspace_overview_metadata(
    map: &mut HashMap<String, String>,
    overview_dir: &Path,
    workspace: &WorkspaceInfo,
) {
    if !should_include_in_dispatcher_workspace_overviews(workspace) {
        return;
    }

    let filename = overview_dir
        .join(workspace_overview_file_name(workspace))
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .unwrap_or_else(|| workspace_overview_file_name(workspace));

    map.entry(filename)
        .or_insert_with(|| format_path_for_prompt(&workspace.root_path));
}

async fn collect_dispatcher_overview_workspaces(
    workspace_service: &crate::service::workspace::WorkspaceService,
) -> Vec<WorkspaceInfo> {
    workspace_service
        .list_workspace_routing_candidates()
        .await
        .into_iter()
        .filter(should_include_in_dispatcher_workspace_overviews)
        .collect()
}

fn should_include_in_dispatcher_workspace_overviews(workspace: &WorkspaceInfo) -> bool {
    workspace.workspace_kind == WorkspaceKind::Normal && !is_agentic_os_workspace(workspace)
}

fn is_agentic_os_workspace(workspace: &WorkspaceInfo) -> bool {
    workspace.root_path == get_path_manager_arc().agentic_os_runtime_root()
}

fn workspace_overview_slug(workspace: &WorkspaceInfo) -> String {
    let preferred = workspace.name.trim();
    let fallback = workspace
        .root_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .unwrap_or_default();
    let seed = if preferred.is_empty() {
        fallback
    } else {
        preferred
    };

    slugify_workspace_component(seed)
}

fn workspace_overview_hash(workspace: &WorkspaceInfo) -> String {
    let normalized_path = format_path_for_prompt(&workspace.root_path);
    let digest = Sha256::digest(normalized_path.as_bytes());
    format!("{:x}", digest)[..8].to_string()
}

fn slugify_workspace_component(value: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;

    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_was_dash = false;
            continue;
        }

        if !last_was_dash && !slug.is_empty() {
            slug.push('-');
            last_was_dash = true;
        }
    }

    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "workspace".to_string()
    } else {
        slug
    }
}

fn truncate_to_char_boundary(value: &str, max_chars: usize) -> String {
    let mut truncated = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        truncated.push_str("\n[Truncated]");
    }
    truncated
}

#[cfg(test)]
mod tests {
    use super::{slugify_workspace_component, workspace_overview_hash};
    use crate::service::workspace::{WorkspaceInfo, WorkspaceKind, WorkspaceStatus};
    use std::collections::HashMap;
    use std::path::PathBuf;

    fn build_workspace_info(name: &str, root_path: &str) -> WorkspaceInfo {
        WorkspaceInfo {
            id: "workspace-id".to_string(),
            name: name.to_string(),
            root_path: PathBuf::from(root_path),
            workspace_kind: WorkspaceKind::Normal,
            status: WorkspaceStatus::Inactive,
            opened_at: chrono::Utc::now(),
            last_accessed: chrono::Utc::now(),
            identity: None,
            metadata: HashMap::new(),
        }
    }

    #[test]
    fn workspace_slug_is_human_readable() {
        assert_eq!(
            slugify_workspace_component("BitFun Desktop"),
            "bitfun-desktop"
        );
        assert_eq!(slugify_workspace_component("  api_core  "), "api-core");
    }

    #[test]
    fn workspace_hash_is_short_and_stable_for_same_path() {
        let workspace = build_workspace_info("BitFun", "E:/Projects/work/BitFun");
        let hash = workspace_overview_hash(&workspace);

        assert_eq!(hash.len(), 8);
        assert_eq!(hash, workspace_overview_hash(&workspace));
    }
}
