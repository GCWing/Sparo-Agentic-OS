use crate::agentic::tools::{ToolPathPolicy, ToolRuntimeRestrictions};
use std::collections::BTreeSet;

pub fn build_auto_memory_runtime_restrictions(memory_dir: &str) -> ToolRuntimeRestrictions {
    ToolRuntimeRestrictions {
        allowed_tool_names: ["Read", "Glob", "Grep", "Memory"]
            .into_iter()
            .map(str::to_string)
            .collect::<BTreeSet<_>>(),
        denied_tool_names: BTreeSet::new(),
        path_policy: ToolPathPolicy {
            write_roots: vec![memory_dir.to_string()],
            edit_roots: Vec::new(),
            delete_roots: Vec::new(),
            ..ToolPathPolicy::default()
        },
        disable_snapshot_tracking: true,
    }
}

pub fn build_session_summary_runtime_restrictions(
    summary_file_path: &str,
) -> ToolRuntimeRestrictions {
    ToolRuntimeRestrictions {
        allowed_tool_names: ["Read", "Glob", "Grep", "Write", "Edit"]
            .into_iter()
            .map(str::to_string)
            .collect::<BTreeSet<_>>(),
        denied_tool_names: BTreeSet::new(),
        path_policy: ToolPathPolicy {
            write_roots: vec![summary_file_path.to_string()],
            edit_roots: vec![summary_file_path.to_string()],
            delete_roots: Vec::new(),
            ..ToolPathPolicy::default()
        },
        disable_snapshot_tracking: true,
    }
}
