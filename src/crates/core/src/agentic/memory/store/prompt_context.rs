use super::{
    ensure_memory_store_for_target, format_path_for_prompt, memory_store_dir_path_for_target,
    MemoryStoreTarget, MEMORY_INDEX_FILE, MEMORY_INDEX_MAX_LINES,
};
use crate::agentic::memory::prompts::{
    render_memory_prompt, MemoryPromptKind, MemoryPromptTemplateVars,
};
use crate::util::errors::*;
use tokio::fs;

pub(crate) async fn build_memory_prompt_for_target(
    target: MemoryStoreTarget<'_>,
) -> BitFunResult<String> {
    ensure_memory_store_for_target(target).await?;
    let memory_dir = memory_store_dir_path_for_target(target);
    let memory_dir_display = format_path_for_prompt(&memory_dir);
    Ok(render_memory_prompt(
        target.scope(),
        MemoryPromptKind::System,
        &MemoryPromptTemplateVars {
            memory_dir: &memory_dir_display,
            index_file_name: MEMORY_INDEX_FILE,
            recent_message_count: None,
            existing_memories_section: None,
        },
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
