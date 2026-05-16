use super::overview::{
    WORKSPACE_OVERVIEW_FILE_MAX_CHARS,
};
use crate::agentic::memory::store::format_path_for_prompt;
use crate::service::workspace::WorkspaceInfo;
use std::path::Path;

pub(crate) const WORKSPACE_OVERVIEW_REFRESH_MAX_ITEMS_PER_RUN: usize = 5;

pub(crate) fn default_workspace_overview_refresh_session_name() -> &'static str {
    "Workspace overview refresh"
}

pub(crate) fn workspace_overview_refresh_allowed_tools() -> Vec<String> {
    ["Read", "Glob", "Grep", "Write", "Edit", "Bash"]
        .into_iter()
        .map(str::to_string)
        .collect()
}

pub(crate) fn build_workspace_overview_refresh_user_prompt(
    items: &[(WorkspaceInfo, std::path::PathBuf)],
) -> String {
    let mut lines = vec![
        "Refresh the listed workspace overview files.".to_string(),
        format!(
            "Background: these files help future Agentic OS sessions choose the right workspace for delegated work."
        ),
        format!(
            "Constraint: keep each overview file at or under {} characters.",
            WORKSPACE_OVERVIEW_FILE_MAX_CHARS
        ),
        "Constraint: only use Bash for lightweight read-only inspection commands. Do not run builds, tests, package manager installs, or other expensive commands.".to_string(),
        "Constraint: only update the listed overview files. Do not modify any other files.".to_string(),
        String::new(),
        "Targets:".to_string(),
    ];

    for (index, (workspace, overview_path)) in items.iter().enumerate() {
        lines.push(format!(
            "{}. workspace_root: {}",
            index + 1,
            format_path_for_prompt(&workspace.root_path)
        ));
        lines.push(format!(
            "   overview_file: {}",
            format_path_for_prompt(overview_path)
        ));
    }

    lines.join("\n")
}

pub(crate) fn build_workspace_overview_refresh_system_reminder(
    overview_dir: &Path,
) -> String {
    format!(
        "The shared workspace overview directory is `{}`. Overview files are durable routing hints, not user-facing summaries.",
        format_path_for_prompt(overview_dir)
    )
}
