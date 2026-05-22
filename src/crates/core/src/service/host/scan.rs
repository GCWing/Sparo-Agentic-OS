use super::overview::{host_overview_file_path, read_host_overview_status};

const HOST_SCAN_ALLOWED_TOOL_NAMES: [&str; 6] = ["Read", "Grep", "Glob", "Write", "Edit", "Bash"];

pub(crate) fn default_host_scan_session_name() -> &'static str {
    "Host scan"
}

pub(crate) fn host_scan_allowed_tools() -> Vec<String> {
    HOST_SCAN_ALLOWED_TOOL_NAMES
        .into_iter()
        .map(str::to_string)
        .collect()
}

pub(crate) async fn build_host_scan_user_prompt() -> String {
    let overview_path = host_overview_file_path();
    let overview_path = overview_path.to_string_lossy().replace('\\', "/");
    let overview_status = read_host_overview_status().await.unwrap_or_default();

    if !overview_status.exists || overview_status.is_empty {
        return format!(
            "Scan this host and generate the shared host overview document at `{}`.\n\nThe host overview file does not exist or is empty. Create or populate it with concise, practical, durable routing guidance for future Sparo OS sessions.",
            overview_path
        );
    }

    format!(
        "Scan this host and update the shared host overview document at `{}`.\n\nThe host overview file already exists and contains content. Preserve useful current guidance, and only update parts that are stale, inaccurate, incomplete, or materially improved by the current scan.",
        overview_path
    )
}
