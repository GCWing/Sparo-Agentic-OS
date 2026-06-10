//! Built-in skills shipped with Sparo OS.
//!
//! These skills are embedded into the `bitfun-core` binary and installed into the user skills
//! directory on demand and kept in sync with bundled versions.

use crate::infrastructure::get_path_manager_arc;
use crate::util::errors::BitFunResult;
use include_dir::{include_dir, Dir};
use log::{debug, error};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tokio::fs;

static BUILTIN_SKILLS_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/../../../bundles/skills");
static BUILTIN_SKILL_DIR_NAMES: OnceLock<HashSet<String>> = OnceLock::new();

fn collect_builtin_skill_dir_names() -> HashSet<String> {
    BUILTIN_SKILLS_DIR
        .dirs()
        .filter_map(|dir| {
            let rel = dir.path();
            if rel.components().count() != 1 {
                return None;
            }

            rel.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.to_string())
        })
        .collect()
}

pub fn builtin_skill_dir_names() -> &'static HashSet<String> {
    BUILTIN_SKILL_DIR_NAMES.get_or_init(collect_builtin_skill_dir_names)
}

pub fn is_builtin_skill_dir_name(dir_name: &str) -> bool {
    builtin_skill_dir_names().contains(dir_name)
}

pub fn builtin_skill_group_key(dir_name: &str) -> Option<&'static str> {
    match dir_name {
        "docx" | "pdf" | "pptx" | "xlsx" | "ppt-design" => Some("office"),
        "find-skills" | "writing-skills" => Some("meta"),
        _ => Some("superpowers"),
    }
}

pub async fn ensure_builtin_skills_installed() -> BitFunResult<()> {
    let pm = get_path_manager_arc();
    let dest_root = pm.user_skills_dir();

    // Create user skills directory if needed.
    if let Err(e) = fs::create_dir_all(&dest_root).await {
        error!(
            "Failed to create user skills directory: path={}, error={}",
            dest_root.display(),
            e
        );
        return Err(e.into());
    }

    let mut installed = 0usize;
    let mut updated = 0usize;
    let mut removed = 0usize;
    for skill_dir in BUILTIN_SKILLS_DIR.dirs() {
        let rel = skill_dir.path();
        if rel.components().count() != 1 {
            continue;
        }

        let stats = sync_dir(skill_dir, &dest_root).await?;
        installed += stats.installed;
        updated += stats.updated;
        removed += prune_stale_files(skill_dir, &dest_root).await?;
    }

    if installed > 0 || updated > 0 || removed > 0 {
        debug!(
            "Built-in skills synchronized: installed={}, updated={}, removed={}, dest_root={}",
            installed,
            updated,
            removed,
            dest_root.display()
        );
    }

    Ok(())
}

#[derive(Default)]
struct SyncStats {
    installed: usize,
    updated: usize,
}

async fn sync_dir(dir: &Dir<'_>, dest_root: &Path) -> BitFunResult<SyncStats> {
    let mut files: Vec<&include_dir::File<'_>> = Vec::new();
    collect_files(dir, &mut files);

    let mut stats = SyncStats::default();
    for file in files.into_iter() {
        let dest_path = safe_join(dest_root, file.path())?;
        let desired = desired_file_content(file, &dest_path).await?;

        if let Ok(current) = fs::read(&dest_path).await {
            if current == desired {
                continue;
            }
        }

        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent).await?;
        }
        let existed = dest_path.exists();
        fs::write(&dest_path, desired).await?;
        if existed {
            stats.updated += 1;
        } else {
            stats.installed += 1;
        }
    }

    Ok(stats)
}

/// Remove files inside a built-in skill's installed directory that no longer exist in the
/// embedded bundle, then drop directories that became empty. Built-in skill directories are
/// fully managed by Sparo, so stale files (for example removed style-preset references) must
/// not linger after an upgrade. Only the given built-in skill directory is touched; other
/// user-installed skills are never affected.
async fn prune_stale_files(skill_dir: &Dir<'_>, dest_root: &Path) -> BitFunResult<usize> {
    let mut embedded_files: Vec<&include_dir::File<'_>> = Vec::new();
    collect_files(skill_dir, &mut embedded_files);
    let embedded: HashSet<PathBuf> = embedded_files
        .into_iter()
        .map(|file| file.path().to_path_buf())
        .collect();

    let dest_dir = safe_join(dest_root, skill_dir.path())?;
    if !dest_dir.is_dir() {
        return Ok(0);
    }

    let mut removed = 0usize;
    let mut pending = vec![dest_dir];
    let mut visited_dirs: Vec<PathBuf> = Vec::new();
    while let Some(dir) = pending.pop() {
        let Ok(mut entries) = fs::read_dir(&dir).await else {
            continue;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let Ok(file_type) = entry.file_type().await else {
                continue;
            };
            if file_type.is_dir() {
                visited_dirs.push(path.clone());
                pending.push(path);
                continue;
            }

            let Ok(rel) = path.strip_prefix(dest_root) else {
                continue;
            };
            if !embedded.contains(rel) {
                match fs::remove_file(&path).await {
                    Ok(()) => removed += 1,
                    Err(e) => debug!(
                        "Failed to remove stale built-in skill file: path={}, error={}",
                        path.display(),
                        e
                    ),
                }
            }
        }
    }

    // Deepest directories first so emptied parents can be removed too. `remove_dir`
    // fails on non-empty directories, which keeps directories with remaining files intact.
    visited_dirs.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    for dir in visited_dirs {
        let _ = fs::remove_dir(&dir).await;
    }

    Ok(removed)
}

fn collect_files<'a>(dir: &'a Dir<'a>, out: &mut Vec<&'a include_dir::File<'a>>) {
    for file in dir.files() {
        out.push(file);
    }

    for sub in dir.dirs() {
        collect_files(sub, out);
    }
}

fn safe_join(root: &Path, relative: &Path) -> BitFunResult<PathBuf> {
    if relative.is_absolute() {
        return Err(crate::util::errors::BitFunError::validation(format!(
            "Unexpected absolute path in built-in skills: {}",
            relative.display()
        )));
    }

    // Prevent `..` traversal even though include_dir should only contain clean relative paths.
    for c in relative.components() {
        if matches!(c, std::path::Component::ParentDir) {
            return Err(crate::util::errors::BitFunError::validation(format!(
                "Unexpected parent dir component in built-in skills path: {}",
                relative.display()
            )));
        }
    }

    Ok(root.join(relative))
}

async fn desired_file_content(
    file: &include_dir::File<'_>,
    _dest_path: &Path,
) -> BitFunResult<Vec<u8>> {
    Ok(file.contents().to_vec())
}

#[cfg(test)]
mod tests {
    use super::builtin_skill_group_key;
    use super::{prune_stale_files, sync_dir, BUILTIN_SKILLS_DIR};

    #[tokio::test]
    async fn prune_removes_stale_files_only_inside_builtin_skill_dir() {
        let dest_root = std::env::temp_dir().join(format!(
            "sparo-builtin-skill-prune-test-{}",
            std::process::id()
        ));
        let _ = tokio::fs::remove_dir_all(&dest_root).await;

        let skill_dir = BUILTIN_SKILLS_DIR
            .get_dir("ppt-design")
            .expect("ppt-design must be embedded in bundles/skills");
        sync_dir(skill_dir, &dest_root).await.unwrap();

        // Stale leftovers inside the managed skill directory.
        let stale_preset = dest_root.join("ppt-design/references/style-presets/zz-removed.md");
        tokio::fs::write(&stale_preset, b"stale").await.unwrap();
        let stale_nested = dest_root.join("ppt-design/obsolete-dir/old.txt");
        tokio::fs::create_dir_all(stale_nested.parent().unwrap())
            .await
            .unwrap();
        tokio::fs::write(&stale_nested, b"old").await.unwrap();

        // A sibling user-installed skill must never be touched.
        let foreign = dest_root.join("third-party-skill/SKILL.md");
        tokio::fs::create_dir_all(foreign.parent().unwrap())
            .await
            .unwrap();
        tokio::fs::write(&foreign, b"---\nname: ppt-design\n---\n")
            .await
            .unwrap();

        let removed = prune_stale_files(skill_dir, &dest_root).await.unwrap();

        assert_eq!(removed, 2);
        assert!(!stale_preset.exists());
        assert!(!stale_nested.exists());
        assert!(
            !stale_nested.parent().unwrap().exists(),
            "emptied directory should be removed"
        );
        assert!(dest_root.join("ppt-design/SKILL.md").exists());
        assert!(dest_root
            .join("ppt-design/references/style-presets/insight-report.md")
            .exists());
        assert!(foreign.exists(), "sibling skills must be untouched");

        let _ = tokio::fs::remove_dir_all(&dest_root).await;
    }

    #[test]
    fn builtin_skill_groups_match_expected_sets() {
        assert_eq!(builtin_skill_group_key("docx"), Some("office"));
        assert_eq!(builtin_skill_group_key("pdf"), Some("office"));
        assert_eq!(builtin_skill_group_key("pptx"), Some("office"));
        assert_eq!(builtin_skill_group_key("xlsx"), Some("office"));
        assert_eq!(builtin_skill_group_key("ppt-design"), Some("office"));
        assert_eq!(builtin_skill_group_key("find-skills"), Some("meta"));
        assert_eq!(builtin_skill_group_key("writing-skills"), Some("meta"));
        assert_eq!(
            builtin_skill_group_key("test-driven-development"),
            Some("superpowers")
        );
    }
}
