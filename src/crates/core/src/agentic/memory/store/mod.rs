mod manifest;
mod paths;
mod prompt_context;

use crate::error::*;
use std::path::{Path, PathBuf};
use tokio::fs;

pub(crate) use manifest::build_memory_manifest_for_target;
pub(crate) use paths::{
    ensure_memory_store_for_target, memory_journal_file_path_for_date,
    memory_store_dir_path_for_target,
};
pub(crate) use prompt_context::{
    build_memory_files_context_for_target, build_memory_prompt_for_target,
};

pub(crate) const MEMORY_SOUL_FILE: &str = "SOUL.md";
pub(crate) const MEMORY_USER_FILE: &str = "USER.md";
pub(crate) const MEMORY_CANONICAL_FILE: &str = "MEMORY.md";
pub(crate) const MEMORY_MILESTONES_FILE: &str = "MILESTONES.md";
pub(crate) const GLOBAL_MEMORY_PRIMARY_FILES: [&str; 4] = [
    MEMORY_SOUL_FILE,
    MEMORY_USER_FILE,
    MEMORY_CANONICAL_FILE,
    MEMORY_MILESTONES_FILE,
];
pub(crate) const WORKSPACE_MEMORY_PRIMARY_FILES: [&str; 1] = [MEMORY_CANONICAL_FILE];
const MEMORY_DIR_NAME: &str = "memory";
const MEMORY_SOUL_TEMPLATE: &str = "";
const MEMORY_USER_TEMPLATE: &str = "";
const MEMORY_CANONICAL_TEMPLATE: &str = "";
const MEMORY_MILESTONES_TEMPLATE: &str = "";
const MEMORY_CANONICAL_MAX_LINES: usize = 200;
const MEMORY_MANIFEST_MAX_FILES: usize = 200;
const MEMORY_LOG_DIR_NAME: &str = "logs";
const MEMORY_LOG_MAX_FILES: usize = 7;
const MEMORY_LOG_MAX_LINES_PER_FILE: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryScope {
    WorkspaceProject,
    GlobalAgenticOs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MemoryStoreTarget<'a> {
    WorkspaceProject(&'a Path),
    GlobalAgenticOs,
}

impl MemoryScope {
    pub(crate) fn as_label(self) -> &'static str {
        match self {
            Self::WorkspaceProject => "workspace",
            Self::GlobalAgenticOs => "global",
        }
    }
}

impl<'a> MemoryStoreTarget<'a> {
    pub(crate) fn scope(self) -> MemoryScope {
        match self {
            Self::WorkspaceProject(_) => MemoryScope::WorkspaceProject,
            Self::GlobalAgenticOs => MemoryScope::GlobalAgenticOs,
        }
    }
}

pub(crate) fn memory_primary_files_for_scope(scope: MemoryScope) -> &'static [&'static str] {
    match scope {
        MemoryScope::WorkspaceProject => &WORKSPACE_MEMORY_PRIMARY_FILES,
        MemoryScope::GlobalAgenticOs => &GLOBAL_MEMORY_PRIMARY_FILES,
    }
}

pub(crate) fn format_path_for_prompt(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub(crate) async fn ensure_markdown_placeholder(path: &Path, content: &str) -> CoreResult<bool> {
    if path.exists() {
        return Ok(false);
    }

    fs::write(path, content)
        .await
        .map_err(|e| CoreError::service(format!("Failed to create {}: {}", path.display(), e)))?;

    Ok(true)
}

pub(super) async fn list_memory_files_recursive(memory_dir: &Path) -> CoreResult<Vec<PathBuf>> {
    let mut files = Vec::new();
    let mut pending_dirs = vec![memory_dir.to_path_buf()];

    while let Some(dir) = pending_dirs.pop() {
        let mut entries = fs::read_dir(&dir).await.map_err(|e| {
            CoreError::service(format!(
                "Failed to read memory directory {}: {}",
                dir.display(),
                e
            ))
        })?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| {
            CoreError::service(format!(
                "Failed to iterate memory directory {}: {}",
                dir.display(),
                e
            ))
        })? {
            let file_type = entry.file_type().await.map_err(|e| {
                CoreError::service(format!(
                    "Failed to inspect memory entry {}: {}",
                    entry.path().display(),
                    e
                ))
            })?;

            if file_type.is_dir() {
                pending_dirs.push(entry.path());
                continue;
            }

            if !file_type.is_file() {
                continue;
            }

            let file_name = entry.file_name().to_string_lossy().into_owned();
            if file_name.ends_with(".md")
                && !GLOBAL_MEMORY_PRIMARY_FILES
                    .iter()
                    .any(|primary| file_name.eq_ignore_ascii_case(primary))
            {
                files.push(entry.path());
                continue;
            }

            if file_name.ends_with(".jsonl") {
                files.push(entry.path());
            }
        }
    }

    files.sort();
    Ok(files)
}

pub(super) fn format_manifest_path(path: &Path, memory_dir: &Path) -> String {
    path.strip_prefix(memory_dir)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}
