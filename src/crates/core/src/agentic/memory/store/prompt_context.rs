use super::{
    ensure_memory_store_for_target, format_path_for_prompt, list_memory_files_recursive,
    memory_primary_files_for_scope, memory_store_dir_path_for_target, MemoryScope,
    MemoryStoreTarget, MEMORY_CANONICAL_FILE, MEMORY_CANONICAL_MAX_LINES, MEMORY_LOG_DIR_NAME,
    MEMORY_LOG_MAX_FILES, MEMORY_LOG_MAX_LINES_PER_FILE, MEMORY_MILESTONES_FILE,
};
use crate::agentic::memory::prompts::{
    render_memory_prompt, MemoryPromptKind, MemoryPromptTemplateVars,
};
use crate::error::*;
use std::path::{Path, PathBuf};
use tokio::fs;

pub(crate) async fn build_memory_prompt_for_target(
    target: MemoryStoreTarget<'_>,
) -> CoreResult<String> {
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
) -> CoreResult<Option<String>> {
    ensure_memory_store_for_target(target).await?;
    let memory_dir = memory_store_dir_path_for_target(target);
    let sections = build_memory_space_sections(target.scope(), &memory_dir).await?;
    if sections.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(sections))
    }
}

async fn build_memory_space_sections(
    scope: MemoryScope,
    memory_dir: &Path,
) -> CoreResult<String> {
    let primary_sections = build_primary_memory_sections(scope, memory_dir).await?;
    let recent_logs_section = build_recent_log_section(memory_dir).await?;

    Ok([primary_sections, recent_logs_section]
        .into_iter()
        .filter(|section| !section.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n"))
}

async fn build_primary_memory_sections(
    scope: MemoryScope,
    memory_dir: &Path,
) -> CoreResult<String> {
    let mut sections = Vec::new();

    for file_name in memory_primary_files_for_scope(scope) {
        let path = memory_dir.join(file_name);
        let section = build_single_memory_section(&path, file_name).await?;
        if !section.trim().is_empty() {
            sections.push(section);
        }
    }

    Ok(sections.join("\n\n"))
}

async fn build_single_memory_section(path: &Path, file_name: &str) -> CoreResult<String> {
    let (title, description, empty_label) = match file_name {
        "SOUL.md" => (
            "Assistant Persona",
            "Defines stable assistant style and behavior.",
            "SOUL.md",
        ),
        "USER.md" => (
            "User Profile",
            "Stores durable user preferences and profile notes.",
            "USER.md",
        ),
        MEMORY_MILESTONES_FILE => (
            "Milestones",
            "Captures key milestones in the user's collaboration with Agentic OS.",
            MEMORY_MILESTONES_FILE,
        ),
        _ => (
            "Canonical Memory",
            "Keeps durable facts and follow-ups worth carrying forward.",
            MEMORY_CANONICAL_FILE,
        ),
    };

    let (content, description_suffix) = match fs::read_to_string(path).await {
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
        format!("({empty_label} is empty)")
    } else {
        content
    };

    Ok(format!(
        r#"# {title}
{description} Source: `{}`.{description_suffix}
{body}"#,
        format_path_for_prompt(path)
    ))
}

async fn build_recent_log_section(memory_dir: &Path) -> CoreResult<String> {
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

async fn recent_log_files(memory_dir: &Path) -> CoreResult<Vec<PathBuf>> {
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

async fn render_latest_log_content(memory_dir: &Path, path: &Path) -> CoreResult<String> {
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
    use super::{
        build_memory_space_sections, build_single_memory_section, recent_log_files,
        render_latest_log_content, render_recent_log_file_list,
    };
    use crate::agentic::memory::store::{
        MemoryScope, MEMORY_LOG_DIR_NAME, MEMORY_LOG_MAX_FILES, MEMORY_MILESTONES_FILE,
    };
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
    async fn workspace_context_keeps_recent_journal_but_only_workspace_memory_file() {
        let memory_dir = unique_test_memory_dir("workspace-context");
        let logs_dir = memory_dir.join(MEMORY_LOG_DIR_NAME).join("2026").join("05");
        fs::create_dir_all(&memory_dir)
            .await
            .expect("create memory dir");
        fs::create_dir_all(&logs_dir)
            .await
            .expect("create logs dir");
        fs::write(memory_dir.join("MEMORY.md"), "workspace memory")
            .await
            .expect("write memory");
        fs::write(logs_dir.join("2026-05-07.jsonl"), "{\"kind\":\"note\"}")
            .await
            .expect("write log");

        let rendered = build_memory_space_sections(MemoryScope::WorkspaceProject, &memory_dir)
            .await
            .expect("workspace sections");

        assert!(rendered.contains("# Canonical Memory"));
        assert!(rendered.contains("workspace memory"));
        assert!(rendered.contains("# Recent Memory Journal"));
        assert!(!rendered.contains("# Assistant Persona"));
        assert!(!rendered.contains("# User Profile"));

        fs::remove_dir_all(&memory_dir)
            .await
            .expect("remove temp dir");
    }

    #[tokio::test]
    async fn primary_memory_files_use_distinct_descriptions() {
        let memory_dir = unique_test_memory_dir("primary-memory-descriptions");
        fs::create_dir_all(&memory_dir)
            .await
            .expect("create memory dir");

        let soul = build_single_memory_section(&memory_dir.join("SOUL.md"), "SOUL.md")
            .await
            .expect("render soul");
        let user = build_single_memory_section(&memory_dir.join("USER.md"), "USER.md")
            .await
            .expect("render user");
        let canonical = build_single_memory_section(&memory_dir.join("MEMORY.md"), "MEMORY.md")
            .await
            .expect("render canonical");
        let milestones = build_single_memory_section(
            &memory_dir.join(MEMORY_MILESTONES_FILE),
            MEMORY_MILESTONES_FILE,
        )
        .await
        .expect("render milestones");

        assert!(soul.contains("Defines stable assistant style and behavior."));
        assert!(user.contains("Stores durable user preferences and profile notes."));
        assert!(canonical.contains("Keeps durable facts and follow-ups worth carrying forward."));
        assert!(milestones
            .contains("Captures key milestones in the user's collaboration with Agentic OS."));

        fs::remove_dir_all(&memory_dir)
            .await
            .expect("remove temp dir");
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
        std::env::temp_dir().join(format!("sparo-memory-{prefix}-{nanos}"))
    }
}
