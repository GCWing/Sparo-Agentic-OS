use crate::agentic::memory::store::{format_path_for_prompt, MEMORY_MILESTONES_FILE};
use std::path::Path;

pub(crate) const MILESTONE_FILE_MAX_LINES: usize = 200;

pub(crate) fn default_global_milestone_session_name() -> &'static str {
    "Global milestone refresh"
}

pub(crate) fn global_milestone_allowed_tools() -> Vec<String> {
    ["Read", "Glob", "Grep", "Write", "Edit"]
        .into_iter()
        .map(str::to_string)
        .collect()
}

pub(crate) fn build_global_milestone_user_prompt(
    milestone_path: &Path,
    source_report_paths: &[std::path::PathBuf],
) -> String {
    let mut lines = vec![
        "Update the global milestone file using the provided daily reports.".to_string(),
        format!("Milestone file: {}", format_path_for_prompt(milestone_path)),
        format!(
            "Keep the final `{}` file under {} lines.",
            MEMORY_MILESTONES_FILE, MILESTONE_FILE_MAX_LINES
        ),
        "Only update the milestone file listed above.".to_string(),
        String::new(),
        format!("Source daily reports ({}):", source_report_paths.len()),
    ];

    for (index, path) in source_report_paths.iter().enumerate() {
        lines.push(format!("{}. {}", index + 1, format_path_for_prompt(path)));
    }

    lines.join("\n")
}
