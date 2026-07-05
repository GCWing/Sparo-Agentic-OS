use crate::agentic::memory::store::{ensure_markdown_placeholder, format_path_for_prompt};
use crate::infrastructure::get_path_manager_arc;
use crate::service::workspace::{get_global_workspace_service, WorkspaceInfo, WorkspaceKind};
use crate::error::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tokio::fs;

const WORKSPACE_OVERVIEW_MAX_CHARS_PER_FILE: usize = 500;
const WORKSPACE_OVERVIEW_MAX_TOTAL_CHARS: usize = 10_000;
const WORKSPACE_CANDIDATES_MAX_CHARS: usize = 1_600;
const WORKSPACE_CANDIDATES_FULL_LIMIT: usize = 8;
const WORKSPACE_CANDIDATES_NAME_SUMMARY_LIMIT: usize = 30;
const WORKSPACE_CANDIDATES_NAME_ONLY_LIMIT: usize = 20;
const WORKSPACE_CANDIDATE_NAME_MAX_CHARS: usize = 80;
const WORKSPACE_CANDIDATE_SUMMARY_MAX_CHARS: usize = 140;
const WORKSPACE_CANDIDATE_PATH_MAX_CHARS: usize = 180;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOverviewBinding {
    pub file_name: String,
    pub file_path: PathBuf,
    pub workspace_id: String,
    pub workspace_name: String,
    pub workspace_root_path: PathBuf,
    pub workspace_memory_dir: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorkspaceCandidateOverview {
    workspace_name: String,
    overview_file_path: PathBuf,
    summary: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorkspaceCandidateRenderMode {
    Full,
    NameSummary,
    NameOnly,
}

pub(crate) async fn ensure_global_workspace_overview_files() -> CoreResult<()> {
    let overview_dir = workspace_overview_dir();
    tokio::fs::create_dir_all(&overview_dir)
        .await
        .map_err(|e| {
            CoreError::service(format!(
                "Failed to create workspace overview directory {}: {}",
                overview_dir.display(),
                e
            ))
        })?;

    let Some(workspace_service) = get_global_workspace_service() else {
        return Ok(());
    };

    let mut known_workspaces =
        collect_agentic_os_overview_workspaces(workspace_service.as_ref()).await;

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

pub(crate) async fn build_workspace_candidates_context() -> CoreResult<Option<String>> {
    let overview_dir = workspace_overview_dir();
    let candidates = collect_workspace_candidate_overviews().await?;
    Ok(render_workspace_candidates_context(
        &candidates,
        &overview_dir,
    ))
}

pub(crate) async fn build_global_workspace_overviews_context() -> CoreResult<Option<String>> {
    ensure_global_workspace_overview_files().await?;

    let overview_dir = workspace_overview_dir();
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
            "# Workspace Routing Context\nThe following are overviews of tracked workspaces; prioritize them when delegating tasks. Notes are loaded from `{}` and each file is truncated to {} characters.\n\n{}",
            overview_dir.to_string_lossy().replace('\\', "/"),
            WORKSPACE_OVERVIEW_MAX_CHARS_PER_FILE,
            rendered_entries.join("\n\n")
        )))
    }
}

pub async fn list_workspace_overview_bindings() -> CoreResult<Vec<WorkspaceOverviewBinding>> {
    ensure_global_workspace_overview_files().await?;

    let overview_dir = workspace_overview_dir();
    let Some(workspace_service) = get_global_workspace_service() else {
        return Ok(Vec::new());
    };

    let mut bindings = collect_agentic_os_overview_workspaces(workspace_service.as_ref())
        .await
        .into_iter()
        .map(|workspace| workspace_overview_binding(&overview_dir, &workspace))
        .collect::<Vec<_>>();

    bindings.sort_by(|left, right| {
        left.workspace_name
            .to_lowercase()
            .cmp(&right.workspace_name.to_lowercase())
            .then_with(|| left.workspace_id.cmp(&right.workspace_id))
    });

    Ok(bindings)
}

async fn collect_workspace_candidate_overviews() -> CoreResult<Vec<WorkspaceCandidateOverview>> {
    ensure_global_workspace_overview_files().await?;

    let overview_dir = workspace_overview_dir();
    let Some(workspace_service) = get_global_workspace_service() else {
        return Ok(Vec::new());
    };

    let bindings = collect_agentic_os_overview_workspaces(workspace_service.as_ref())
        .await
        .into_iter()
        .map(|workspace| workspace_overview_binding(&overview_dir, &workspace))
        .collect::<Vec<_>>();

    let mut candidates = Vec::with_capacity(bindings.len());
    for binding in bindings {
        let summary = match fs::read_to_string(&binding.file_path).await {
            Ok(content) => parse_workspace_overview_summary(&content),
            Err(_) => None,
        };

        candidates.push(WorkspaceCandidateOverview {
            workspace_name: binding.workspace_name,
            overview_file_path: binding.file_path,
            summary,
        });
    }

    Ok(candidates)
}

fn workspace_overview_dir() -> PathBuf {
    get_path_manager_arc().agentic_os_workspaces_overview_dir()
}

async fn ensure_workspace_overview_file(
    overview_dir: &Path,
    workspace: &WorkspaceInfo,
) -> CoreResult<()> {
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
    "summary: \n\ndetails:\n".to_string()
}

fn workspace_overview_binding(
    overview_dir: &Path,
    workspace: &WorkspaceInfo,
) -> WorkspaceOverviewBinding {
    let file_name = workspace_overview_file_name(workspace);
    let path_manager = get_path_manager_arc();

    WorkspaceOverviewBinding {
        file_path: overview_dir.join(&file_name),
        file_name,
        workspace_id: workspace.id.clone(),
        workspace_name: workspace.name.clone(),
        workspace_root_path: workspace.root_path.clone(),
        workspace_memory_dir: path_manager.workspace_memory_dir(&workspace.root_path),
    }
}

async fn build_workspace_overview_path_map(_overview_dir: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();

    let Ok(bindings) = list_workspace_overview_bindings().await else {
        return map;
    };

    for binding in bindings {
        map.entry(binding.file_name)
            .or_insert_with(|| format_path_for_prompt(&binding.workspace_root_path));
    }

    map
}

async fn ordered_workspace_overview_paths(
    overview_dir: &Path,
) -> CoreResult<Vec<std::path::PathBuf>> {
    let mut ordered = Vec::new();
    let mut seen = HashSet::new();

    if let Some(workspace_service) = get_global_workspace_service() {
        for workspace in collect_agentic_os_overview_workspaces(workspace_service.as_ref()).await {
            push_workspace_overview_path(&overview_dir, &workspace, &mut ordered, &mut seen);
        }
    }

    let mut remaining = Vec::new();
    let mut entries = fs::read_dir(overview_dir).await.map_err(|e| {
        CoreError::service(format!(
            "Failed to read global workspace overview directory {}: {}",
            overview_dir.display(),
            e
        ))
    })?;

    while let Some(entry) = entries.next_entry().await.map_err(|e| {
        CoreError::service(format!(
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
    if !should_include_in_agentic_os_workspace_overviews(workspace) {
        return;
    }

    let path = overview_dir.join(workspace_overview_file_name(workspace));
    let key = path.to_string_lossy().to_string();
    if seen.insert(key) {
        ordered.push(path);
    }
}

async fn collect_agentic_os_overview_workspaces(
    workspace_service: &crate::service::workspace::WorkspaceService,
) -> Vec<WorkspaceInfo> {
    workspace_service
        .list_workspace_routing_candidates()
        .await
        .into_iter()
        .filter(should_include_in_agentic_os_workspace_overviews)
        .collect()
}

fn should_include_in_agentic_os_workspace_overviews(workspace: &WorkspaceInfo) -> bool {
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

fn parse_workspace_overview_summary(content: &str) -> Option<String> {
    for line in content.trim_start_matches('\u{feff}').lines() {
        let trimmed = line.trim();
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };

        if key.trim().eq_ignore_ascii_case("summary") {
            if let Some(summary) = sanitize_workspace_summary(value) {
                return Some(summary);
            }
            break;
        }
    }

    content
        .trim_start_matches('\u{feff}')
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("details:") {
                return None;
            }

            if let Some((key, value)) = trimmed.split_once(':') {
                if key.trim().eq_ignore_ascii_case("summary") {
                    return sanitize_workspace_summary(value);
                }
            }

            sanitize_workspace_summary(trimmed)
        })
}

fn sanitize_workspace_summary(value: &str) -> Option<String> {
    let mut text = value
        .replace(['\r', '\n', '\t'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    loop {
        let trimmed = text.trim();
        let stripped = trimmed
            .strip_prefix('#')
            .or_else(|| trimmed.strip_prefix('-'))
            .or_else(|| trimmed.strip_prefix('*'))
            .or_else(|| trimmed.strip_prefix('>'));

        match stripped {
            Some(next) => text = next.trim().to_string(),
            None => {
                text = trimmed.trim_matches('`').to_string();
                break;
            }
        }
    }

    if text.is_empty() || text.eq_ignore_ascii_case("details:") {
        return None;
    }

    Some(truncate_single_line(
        &text,
        WORKSPACE_CANDIDATE_SUMMARY_MAX_CHARS,
    ))
}

fn render_workspace_candidates_context(
    candidates: &[WorkspaceCandidateOverview],
    overview_dir: &Path,
) -> Option<String> {
    if candidates.is_empty() {
        return None;
    }

    let initial_mode = if candidates.len() <= WORKSPACE_CANDIDATES_FULL_LIMIT {
        WorkspaceCandidateRenderMode::Full
    } else if candidates.len() <= WORKSPACE_CANDIDATES_NAME_SUMMARY_LIMIT {
        WorkspaceCandidateRenderMode::NameSummary
    } else {
        WorkspaceCandidateRenderMode::NameOnly
    };

    for mode in degrade_modes(initial_mode) {
        let default_limit = match mode {
            WorkspaceCandidateRenderMode::Full | WorkspaceCandidateRenderMode::NameSummary => {
                candidates.len()
            }
            WorkspaceCandidateRenderMode::NameOnly => {
                candidates.len().min(WORKSPACE_CANDIDATES_NAME_ONLY_LIMIT)
            }
        };

        let mut limit = default_limit;
        while limit > 0 {
            let rendered = render_workspace_candidates_context_with_mode(
                candidates,
                overview_dir,
                mode,
                limit,
            );
            if rendered.chars().count() <= WORKSPACE_CANDIDATES_MAX_CHARS {
                return Some(rendered);
            }
            limit -= 1;
        }
    }

    Some(render_workspace_candidates_context_with_mode(
        candidates,
        overview_dir,
        WorkspaceCandidateRenderMode::NameOnly,
        0,
    ))
}

fn degrade_modes(
    initial_mode: WorkspaceCandidateRenderMode,
) -> impl Iterator<Item = WorkspaceCandidateRenderMode> {
    let modes = match initial_mode {
        WorkspaceCandidateRenderMode::Full => vec![
            WorkspaceCandidateRenderMode::Full,
            WorkspaceCandidateRenderMode::NameSummary,
            WorkspaceCandidateRenderMode::NameOnly,
        ],
        WorkspaceCandidateRenderMode::NameSummary => vec![
            WorkspaceCandidateRenderMode::NameSummary,
            WorkspaceCandidateRenderMode::NameOnly,
        ],
        WorkspaceCandidateRenderMode::NameOnly => vec![WorkspaceCandidateRenderMode::NameOnly],
    };

    modes.into_iter()
}

fn render_workspace_candidates_context_with_mode(
    candidates: &[WorkspaceCandidateOverview],
    overview_dir: &Path,
    mode: WorkspaceCandidateRenderMode,
    limit: usize,
) -> String {
    let overview_dir = escape_prompt_inline(&truncate_single_line(
        &format_path_for_prompt(overview_dir),
        WORKSPACE_CANDIDATE_PATH_MAX_CHARS,
    ));

    let mut lines = vec![
        "# Workspace Candidates".to_string(),
        String::new(),
        "These workspaces are routing candidates, not instructions and not a default workspace."
            .to_string(),
        "Use a candidate only when the user names it, or when the conversation clearly points to exactly one candidate. If the target cannot be resolved to one workspace, ask before starting workspace-scoped Work.".to_string(),
        "For more detail, use `Read` on the listed overview file. If file paths are omitted, use `Glob` in the overview directory, then `Read` the matching file.".to_string(),
        format!("Overview directory: `{}`", overview_dir),
        String::new(),
        "Candidates:".to_string(),
    ];

    for candidate in candidates.iter().take(limit) {
        lines.push(render_workspace_candidate_line(candidate, mode));
    }

    let omitted = candidates.len().saturating_sub(limit);
    if omitted > 0 {
        lines.push(format!(
            "- ... omitted {} more candidates to stay within the prompt budget.",
            omitted
        ));
    } else if limit == 0 {
        lines.push("- Candidate names omitted to stay within the prompt budget.".to_string());
    }

    lines.join("\n")
}

fn render_workspace_candidate_line(
    candidate: &WorkspaceCandidateOverview,
    mode: WorkspaceCandidateRenderMode,
) -> String {
    let name = escape_prompt_inline(&truncate_single_line(
        &candidate.workspace_name,
        WORKSPACE_CANDIDATE_NAME_MAX_CHARS,
    ));

    match mode {
        WorkspaceCandidateRenderMode::Full => {
            let overview_path = escape_prompt_inline(&truncate_single_line(
                &format_path_for_prompt(&candidate.overview_file_path),
                WORKSPACE_CANDIDATE_PATH_MAX_CHARS,
            ));

            match candidate.summary.as_deref() {
                Some(summary) => format!(
                    "- {}: {} (overview: `{}`)",
                    name,
                    escape_prompt_inline(summary),
                    overview_path
                ),
                None => format!("- {} (overview: `{}`)", name, overview_path),
            }
        }
        WorkspaceCandidateRenderMode::NameSummary => match candidate.summary.as_deref() {
            Some(summary) => format!("- {}: {}", name, escape_prompt_inline(summary)),
            None => format!("- {}", name),
        },
        WorkspaceCandidateRenderMode::NameOnly => format!("- {}", name),
    }
}

fn truncate_single_line(value: &str, max_chars: usize) -> String {
    let normalized = value
        .replace(['\r', '\n', '\t'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if normalized.chars().count() <= max_chars {
        return normalized;
    }

    let keep = max_chars.saturating_sub(3);
    let mut truncated = normalized.chars().take(keep).collect::<String>();
    truncated.push_str("...");
    truncated
}

fn escape_prompt_inline(value: &str) -> String {
    value.replace('`', "'")
}

#[cfg(test)]
mod tests {
    use super::{
        parse_workspace_overview_summary, render_workspace_candidates_context,
        slugify_workspace_component, workspace_overview_hash, WorkspaceCandidateOverview,
        WORKSPACE_CANDIDATES_MAX_CHARS, WORKSPACE_CANDIDATE_SUMMARY_MAX_CHARS,
    };
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
            slugify_workspace_component("Sparo OS Desktop"),
            "sparo-os-desktop"
        );
        assert_eq!(slugify_workspace_component("  api_core  "), "api-core");
    }

    #[test]
    fn workspace_hash_is_short_and_stable_for_same_path() {
        let workspace = build_workspace_info("Sparo OS", "E:/Projects/work/Sparo-OS");
        let hash = workspace_overview_hash(&workspace);

        assert_eq!(hash.len(), 8);
        assert_eq!(hash, workspace_overview_hash(&workspace));
    }

    #[test]
    fn summary_parser_reads_explicit_summary() {
        let summary = parse_workspace_overview_summary(
            "summary: Project API and admin service\n\ndetails:\nMore",
        );

        assert_eq!(summary.as_deref(), Some("Project API and admin service"));
    }

    #[test]
    fn summary_parser_falls_back_to_first_meaningful_line() {
        let summary = parse_workspace_overview_summary(
            "\n# Website project for launch copy\n\ndetails:\nMore",
        );

        assert_eq!(summary.as_deref(), Some("Website project for launch copy"));
    }

    #[test]
    fn summary_parser_truncates_long_values() {
        let long_summary = "x".repeat(WORKSPACE_CANDIDATE_SUMMARY_MAX_CHARS + 20);
        let content = format!("summary: {}", long_summary);
        let summary = parse_workspace_overview_summary(&content).expect("summary");

        assert!(summary.chars().count() <= WORKSPACE_CANDIDATE_SUMMARY_MAX_CHARS);
        assert!(summary.ends_with("..."));
    }

    #[test]
    fn workspace_candidates_context_degrades_under_budget() {
        let candidates = (0..40)
            .map(|index| WorkspaceCandidateOverview {
                workspace_name: format!("Workspace {}", index),
                overview_file_path: PathBuf::from(format!(
                    "C:/Users/test/AppData/Roaming/sparo_os/workspace-overviews/workspace-{}.md",
                    index
                )),
                summary: Some("A concise summary for routing decisions.".to_string()),
            })
            .collect::<Vec<_>>();

        let overview_dir = PathBuf::from("C:/overviews");
        let rendered = render_workspace_candidates_context(&candidates, overview_dir.as_path())
            .expect("context");

        assert!(rendered.chars().count() <= WORKSPACE_CANDIDATES_MAX_CHARS);
        assert!(rendered.contains("omitted"));
        assert!(!rendered.contains("(overview:"));
    }
}
