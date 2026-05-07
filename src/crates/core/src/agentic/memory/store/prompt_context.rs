use super::{
    ensure_memory_store_for_target, format_path_for_prompt, list_memory_files_recursive,
    memory_store_dir_path_for_target, MemoryStoreTarget, MEMORY_CANONICAL_FILE,
    MEMORY_CANONICAL_MAX_LINES, MEMORY_LOG_DIR_NAME, MEMORY_LOG_MAX_FILES,
    MEMORY_LOG_MAX_LINES_PER_FILE,
};
use crate::agentic::memory::prompts::{
    render_memory_prompt, MemoryPromptKind, MemoryPromptTemplateVars,
};
use crate::util::errors::*;
use std::path::{Path, PathBuf};
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
            canonical_file_name: MEMORY_CANONICAL_FILE,
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
    let sections = build_memory_space_sections(&memory_dir).await?;
    if sections.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(sections))
    }
}

async fn build_memory_space_sections(memory_dir: &Path) -> BitFunResult<String> {
    let canonical_section = build_canonical_memory_section(memory_dir).await?;
    let recent_logs_section = build_recent_log_section(memory_dir).await?;

    Ok([canonical_section, recent_logs_section]
        .into_iter()
        .filter(|section| !section.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n"))
}

async fn build_canonical_memory_section(memory_dir: &Path) -> BitFunResult<String> {
    let canonical_path = memory_dir.join(MEMORY_CANONICAL_FILE);
    let (content, description_suffix) = match fs::read_to_string(&canonical_path).await {
        Ok(content) if !content.trim().is_empty() => {
            let lines = content.lines().collect::<Vec<_>>();
            let was_truncated = lines.len() > MEMORY_CANONICAL_MAX_LINES;
            (
                lines
                    .into_iter()
                    .take(MEMORY_CANONICAL_MAX_LINES)
                    .collect::<Vec<_>>()
                    .join("\n"),
                if was_truncated {
                    format!(" Showing up to {MEMORY_CANONICAL_MAX_LINES} lines.")
                } else {
                    String::new()
                },
            )
        }
        _ => (String::new(), String::new()),
    };

    let body = if content.trim().is_empty() {
        format!("({MEMORY_CANONICAL_FILE} is empty)")
    } else {
        content
    };

    Ok(format!(
        r#"# Canonical Memory
Persistent curated memory loaded from `{}`.{description_suffix}
{body}"#,
        format_path_for_prompt(&canonical_path)
    ))
}

async fn build_recent_log_section(memory_dir: &Path) -> BitFunResult<String> {
    let log_files = recent_log_files(memory_dir).await?;
    if log_files.is_empty() {
        return Ok(format!(
            "# Recent Memory Journal\nNo journal entries found under `{}`.",
            format_path_for_prompt(&memory_dir.join(MEMORY_LOG_DIR_NAME))
        ));
    }

    let latest_log = log_files.last().cloned();
    let recent_file_list = render_recent_log_file_list(memory_dir, &log_files);
    let latest_log_content = match latest_log {
        Some(path) => render_latest_log_content(memory_dir, &path).await?,
        None => String::new(),
    };

    Ok(format!(
        "# Recent Memory Journal\nAppend-only auto-memory records from `{}`.\n\n{}\n\n{}",
        format_path_for_prompt(&memory_dir.join(MEMORY_LOG_DIR_NAME)),
        recent_file_list,
        latest_log_content
    ))
}

async fn recent_log_files(memory_dir: &Path) -> BitFunResult<Vec<PathBuf>> {
    let mut paths = list_memory_files_recursive(memory_dir)
        .await?
        .into_iter()
        .filter(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("jsonl"))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();

    paths.sort();
    if paths.len() > MEMORY_LOG_MAX_FILES {
        let split_at = paths.len() - MEMORY_LOG_MAX_FILES;
        paths = paths.split_off(split_at);
    }
    Ok(paths)
}

fn render_recent_log_file_list(memory_dir: &Path, log_files: &[PathBuf]) -> String {
    let items = log_files
        .iter()
        .map(|path| format!("- {}", relative_log_path(memory_dir, path)))
        .collect::<Vec<_>>()
        .join("\n");

    format!("## Recent files\n{items}")
}

async fn render_latest_log_content(memory_dir: &Path, path: &Path) -> BitFunResult<String> {
    let relative = relative_log_path(memory_dir, path);
    let content = match fs::read_to_string(path).await {
        Ok(content) => content,
        Err(_) => {
            return Ok(format!(
                "## Latest log content\nUnable to read latest log `{}`.",
                format_path_for_prompt(path)
            ));
        }
    };

    let lines = content.lines().collect::<Vec<_>>();
    let was_truncated = lines.len() > MEMORY_LOG_MAX_LINES_PER_FILE;
    let snippet = lines
        .into_iter()
        .take(MEMORY_LOG_MAX_LINES_PER_FILE)
        .collect::<Vec<_>>()
        .join("\n");
    let truncation_note = if was_truncated {
        format!(" Showing up to {MEMORY_LOG_MAX_LINES_PER_FILE} lines.")
    } else {
        String::new()
    };

    Ok(format!(
        "## Latest log content\nFrom `{}` (`{}`).{}\n```jsonl\n{}\n```",
        relative,
        format_path_for_prompt(path),
        truncation_note,
        snippet
    ))
}

fn relative_log_path(memory_dir: &Path, path: &Path) -> String {
    path.strip_prefix(memory_dir)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::{recent_log_files, render_latest_log_content, render_recent_log_file_list};
    use crate::agentic::memory::store::{MEMORY_LOG_DIR_NAME, MEMORY_LOG_MAX_FILES};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::fs;

    #[test]
    fn recent_log_file_list_includes_relative_paths() {
        let memory_dir = PathBuf::from("/memory");
        let rendered = render_recent_log_file_list(
            &memory_dir,
            &[
                memory_dir.join("logs/2026/05/2026-05-06.jsonl"),
                memory_dir.join("logs/2026/05/2026-05-07.jsonl"),
            ],
        );

        assert_eq!(
            rendered,
            "## Recent files\n- logs/2026/05/2026-05-06.jsonl\n- logs/2026/05/2026-05-07.jsonl"
        );
    }

    #[tokio::test]
    async fn latest_log_content_renders_only_requested_file() {
        let memory_dir = unique_test_memory_dir("latest-log-content");
        let logs_dir = memory_dir.join(MEMORY_LOG_DIR_NAME).join("2026").join("05");
        fs::create_dir_all(&logs_dir)
            .await
            .expect("create logs dir");

        let latest_log = logs_dir.join("2026-05-07.jsonl");
        fs::write(&latest_log, "{\"time\":\"t1\"}\n{\"time\":\"t2\"}")
            .await
            .expect("write log");

        let rendered = render_latest_log_content(&memory_dir, &latest_log)
            .await
            .expect("render latest log content");

        assert!(rendered.contains("## Latest log content"));
        assert!(rendered.contains("logs/2026/05/2026-05-07.jsonl"));
        assert!(rendered.contains("```jsonl\n{\"time\":\"t1\"}\n{\"time\":\"t2\"}\n```"));

        fs::remove_dir_all(&memory_dir)
            .await
            .expect("remove temp dir");
    }

    #[tokio::test]
    async fn recent_log_files_returns_last_seven_sorted_files() {
        let memory_dir = unique_test_memory_dir("recent-log-files");
        let logs_dir = memory_dir.join(MEMORY_LOG_DIR_NAME).join("2026").join("05");
        fs::create_dir_all(&logs_dir)
            .await
            .expect("create logs dir");

        for day in 1..=9 {
            let path = logs_dir.join(format!("2026-05-{day:02}.jsonl"));
            fs::write(path, "{}").await.expect("write log");
        }

        let files = recent_log_files(&memory_dir)
            .await
            .expect("recent log files");

        assert_eq!(files.len(), MEMORY_LOG_MAX_FILES);
        assert!(files
            .first()
            .expect("first file")
            .ends_with(PathBuf::from("logs/2026/05/2026-05-03.jsonl")));
        assert!(files
            .last()
            .expect("last file")
            .ends_with(PathBuf::from("logs/2026/05/2026-05-09.jsonl")));

        fs::remove_dir_all(&memory_dir)
            .await
            .expect("remove temp dir");
    }

    fn unique_test_memory_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("bitfun-memory-{prefix}-{nanos}"))
    }
}
