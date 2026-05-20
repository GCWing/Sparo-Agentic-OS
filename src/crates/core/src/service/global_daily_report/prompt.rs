use crate::agentic::memory::store::format_path_for_prompt;
use std::path::Path;

pub(crate) fn default_global_daily_report_session_name() -> &'static str {
    "Global daily report"
}

pub(crate) fn global_daily_report_allowed_tools() -> Vec<String> {
    ["Read", "Glob", "Grep", "Write", "Edit"]
        .into_iter()
        .map(str::to_string)
        .collect()
}

pub(crate) fn build_global_daily_report_user_prompt(
    report_date: &str,
    output_report_path: &Path,
    source_summary_paths: &[std::path::PathBuf],
) -> String {
    let mut lines = vec![
        format!("Compile the global daily report for {}.", report_date),
        format!(
            "Output report file: {}",
            format_path_for_prompt(output_report_path)
        ),
        "Only update the output report file listed above.".to_string(),
        String::new(),
        format!("Source summaries ({}):", source_summary_paths.len()),
    ];

    for (index, path) in source_summary_paths.iter().enumerate() {
        lines.push(format!("{}. {}", index + 1, format_path_for_prompt(path)));
    }

    lines.join("\n")
}
