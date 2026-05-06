use super::{
    build_global_memory_policy_sections, build_workspace_memory_policy_sections,
    ensure_memory_store_for_target, format_path_for_prompt, memory_store_dir_path_for_target,
    MemoryStoreTarget, SharedMemoryPolicyProfile, MEMORY_INDEX_FILE, MEMORY_INDEX_MAX_LINES,
};
use crate::util::errors::*;
use tokio::fs;

pub(crate) async fn build_memory_prompt_for_target(
    target: MemoryStoreTarget<'_>,
) -> BitFunResult<String> {
    ensure_memory_store_for_target(target).await?;
    let memory_dir = memory_store_dir_path_for_target(target);
    let memory_dir_display = format_path_for_prompt(&memory_dir);
    Ok(format!(
        "# auto memory\n\n\
You have a persistent, file-based memory system at `{memory_dir_display}`. This directory already exists — write to it directly with the Write/Edit tool (do not run mkdir or check for its existence).\n\n\
You should build up this memory system over time so that future conversations can have a complete picture of who the user is, how they'd like to collaborate with you, what behaviors to avoid or repeat, and the context behind the work the user gives you.\n\n\
{}",
        match target {
            MemoryStoreTarget::WorkspaceProject(_) => build_workspace_memory_policy_sections(
                MEMORY_INDEX_FILE,
                SharedMemoryPolicyProfile::Full,
            ),
            MemoryStoreTarget::GlobalAgenticOs => {
                build_global_memory_policy_sections(
                    MEMORY_INDEX_FILE,
                    SharedMemoryPolicyProfile::Full,
                )
            }
        }
    ))
}

pub(crate) async fn build_memory_files_context_for_target(
    target: MemoryStoreTarget<'_>,
) -> BitFunResult<Option<String>> {
    ensure_memory_store_for_target(target).await?;
    let memory_dir = memory_store_dir_path_for_target(target);
    let memory_files_section = build_memory_space_files_section(&memory_dir).await?;
    if memory_files_section.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(memory_files_section))
    }
}

async fn build_memory_space_files_section(memory_dir: &std::path::Path) -> BitFunResult<String> {
    let index_path = memory_dir.join(MEMORY_INDEX_FILE);
    let (index_content, index_description_suffix) = match fs::read_to_string(&index_path).await {
        Ok(content) if !content.trim().is_empty() => {
            let lines = content.lines().collect::<Vec<_>>();
            let was_truncated = lines.len() > MEMORY_INDEX_MAX_LINES;
            (
                lines
                    .into_iter()
                    .take(MEMORY_INDEX_MAX_LINES)
                    .collect::<Vec<_>>()
                    .join("\n"),
                if was_truncated {
                    format!(" Showing up to {MEMORY_INDEX_MAX_LINES} lines.")
                } else {
                    String::new()
                },
            )
        }
        _ => (String::new(), String::new()),
    };
    let index_body = if index_content.trim().is_empty() {
        format!("({MEMORY_INDEX_FILE} is empty)")
    } else {
        index_content
    };

    Ok(format!(
        r#"# Memory Index
Persistent memory index loaded from `{}`.{index_description_suffix}
{index_body}"#,
        format_path_for_prompt(memory_dir)
    ))
}
