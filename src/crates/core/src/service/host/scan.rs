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

pub(crate) fn build_host_scan_user_prompt() -> String {
    "Scan this host and update the shared host overview document with practical routing guidance."
        .to_string()
}
