use super::{
    ensure_memory_store_for_target, format_manifest_path, list_memory_files_recursive,
    memory_primary_files_for_scope, memory_store_dir_path_for_target, MemoryScope,
    MemoryStoreTarget, MEMORY_MANIFEST_MAX_FILES,
};
use crate::util::errors::*;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub(crate) async fn build_memory_manifest_for_target(
    target: MemoryStoreTarget<'_>,
) -> BitFunResult<Option<String>> {
    ensure_memory_store_for_target(target).await?;
    let memory_dir = memory_store_dir_path_for_target(target);
    let primary_files = memory_primary_files_for_scope(target.scope());
    let mut memory_files = primary_files
        .iter()
        .map(|file_name| memory_dir.join(file_name))
        .collect::<Vec<_>>();
    memory_files.extend(list_memory_files_recursive(&memory_dir).await?);

    Ok(render_memory_manifest(
        target.scope(),
        &memory_dir,
        memory_files,
    ))
}

fn render_memory_manifest(
    scope: MemoryScope,
    memory_dir: &Path,
    memory_files: Vec<PathBuf>,
) -> Option<String> {
    let mut seen = HashSet::new();
    let mut ordinary = Vec::new();

    for path in memory_files {
        let relative_path = format_manifest_path(&path, memory_dir);
        if relative_path.is_empty() || !seen.insert(relative_path.clone()) {
            continue;
        }

        ordinary.push(relative_path);
    }

    ordinary.sort();

    let primary_order = memory_primary_files_for_scope(scope)
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    let mut ordered_primary = Vec::new();
    for primary in &primary_order {
        if ordinary.iter().any(|path| path == primary) {
            ordered_primary.push(primary.clone());
        }
    }
    ordinary.retain(|path| !primary_order.iter().any(|primary| primary == path));
    if !ordered_primary.is_empty() {
        ordered_primary.extend(ordinary);
        ordinary = ordered_primary;
    }

    let ordinary_limit = MEMORY_MANIFEST_MAX_FILES.min(ordinary.len());
    let ordinary = ordinary
        .into_iter()
        .take(ordinary_limit)
        .collect::<Vec<_>>();

    match scope {
        MemoryScope::WorkspaceProject => {
            if ordinary.is_empty() {
                None
            } else {
                Some(render_file_list(&ordinary))
            }
        }
        MemoryScope::GlobalAgenticOs => {
            if ordinary.is_empty() {
                None
            } else {
                Some(format!(
                    "### Memory files\n\n{}",
                    render_file_list(&ordinary)
                ))
            }
        }
    }
}

fn render_file_list(paths: &[String]) -> String {
    paths
        .iter()
        .map(|path| format!("- {}", path))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::render_memory_manifest;
    use crate::agentic::memory::store::MemoryScope;
    use std::path::PathBuf;

    #[test]
    fn workspace_manifest_lists_memory_file_first() {
        let memory_dir = PathBuf::from("/memory");
        let manifest = render_memory_manifest(
            MemoryScope::WorkspaceProject,
            &memory_dir,
            vec![
                memory_dir.join("logs/2026/05/2026-05-07.jsonl"),
                memory_dir.join("MEMORY.md"),
            ],
        )
        .expect("workspace manifest should exist");

        assert_eq!(manifest, "- MEMORY.md\n- logs/2026/05/2026-05-07.jsonl");
    }

    #[test]
    fn global_manifest_lists_global_memory_files() {
        let memory_dir = PathBuf::from("/memory");
        let manifest = render_memory_manifest(
            MemoryScope::GlobalAgenticOs,
            &memory_dir,
            vec![
                memory_dir.join("SOUL.md"),
                memory_dir.join("USER.md"),
                memory_dir.join("logs/2026/05/2026-05-07.jsonl"),
                memory_dir.join("MEMORY.md"),
            ],
        )
        .expect("global manifest should exist");

        assert_eq!(
            manifest,
            "### Memory files\n\n- SOUL.md\n- USER.md\n- MEMORY.md\n- logs/2026/05/2026-05-07.jsonl"
        );
    }
}
