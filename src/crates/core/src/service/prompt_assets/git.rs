use super::store::PromptAssetStore;
use super::types::{
    PromptAssetGitCommit, PromptAssetGitDiff, PromptAssetGitStatus, PromptAssetGitStatusEntry,
};
use crate::util::errors::{BitFunError, BitFunResult};
use std::path::Path;
use std::process::Command;

pub struct PromptAssetGit;

impl PromptAssetGit {
    pub fn status(workspace_root: &Path) -> BitFunResult<PromptAssetGitStatus> {
        let prompt_root = PromptAssetStore::project_prompt_root(workspace_root);
        if !is_git_repository(workspace_root) {
            return Ok(PromptAssetGitStatus {
                is_git_repository: false,
                prompt_root: prompt_root.to_string_lossy().to_string(),
                entries: Vec::new(),
                message: Some("Workspace is not a Git repository".to_string()),
            });
        }
        let output = run_git(
            workspace_root,
            &[
                "status",
                "--short",
                "--",
                PromptAssetStore::project_prompt_root_relative_path(),
            ],
        )?;
        let entries = output
            .lines()
            .filter_map(parse_status_line)
            .collect::<Vec<_>>();
        Ok(PromptAssetGitStatus {
            is_git_repository: true,
            prompt_root: prompt_root.to_string_lossy().to_string(),
            entries,
            message: None,
        })
    }

    pub fn diff(
        workspace_root: &Path,
        relative_path: Option<&str>,
    ) -> BitFunResult<PromptAssetGitDiff> {
        let path = relative_path.unwrap_or(PromptAssetStore::project_prompt_root_relative_path());
        if !is_git_repository(workspace_root) {
            return Ok(PromptAssetGitDiff {
                is_git_repository: false,
                relative_path: path.to_string(),
                diff: String::new(),
                message: Some("Workspace is not a Git repository".to_string()),
            });
        }
        let diff = run_git(workspace_root, &["--no-pager", "diff", "--", path])?;
        Ok(PromptAssetGitDiff {
            is_git_repository: true,
            relative_path: path.to_string(),
            diff,
            message: None,
        })
    }

    pub fn history(
        workspace_root: &Path,
        relative_path: Option<&str>,
        limit: usize,
    ) -> BitFunResult<Vec<PromptAssetGitCommit>> {
        if !is_git_repository(workspace_root) {
            return Ok(Vec::new());
        }
        let limit_arg = format!("-n{}", limit.clamp(1, 100));
        let path = relative_path.unwrap_or(PromptAssetStore::project_prompt_root_relative_path());
        let output = run_git(
            workspace_root,
            &[
                "--no-pager",
                "log",
                &limit_arg,
                "--date=iso-strict",
                "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s",
                "--",
                path,
            ],
        )?;
        Ok(output.lines().filter_map(parse_commit_line).collect())
    }

    pub fn rollback(workspace_root: &Path, relative_path: &str, commit: &str) -> BitFunResult<()> {
        if !is_git_repository(workspace_root) {
            return Err(BitFunError::validation("Workspace is not a Git repository"));
        }
        if relative_path.trim().is_empty() || relative_path.contains("..") {
            return Err(BitFunError::validation("Prompt path is invalid"));
        }
        if commit.trim().is_empty()
            || !commit
                .chars()
                .all(|ch| ch.is_ascii_hexdigit() || ch == '-' || ch == '_')
        {
            return Err(BitFunError::validation("Commit reference is invalid"));
        }
        run_git(workspace_root, &["checkout", commit, "--", relative_path])?;
        Ok(())
    }
}

fn is_git_repository(workspace_root: &Path) -> bool {
    Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(workspace_root)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn run_git(workspace_root: &Path, args: &[&str]) -> BitFunResult<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(workspace_root)
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(BitFunError::service(if stderr.is_empty() {
            "Git command failed".to_string()
        } else {
            stderr
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn parse_status_line(line: &str) -> Option<PromptAssetGitStatusEntry> {
    if line.len() < 4 {
        return None;
    }
    Some(PromptAssetGitStatusEntry {
        status: line[..2].trim().to_string(),
        path: line[3..].to_string(),
    })
}

fn parse_commit_line(line: &str) -> Option<PromptAssetGitCommit> {
    let parts = line.split('\u{1f}').collect::<Vec<_>>();
    if parts.len() != 5 {
        return None;
    }
    Some(PromptAssetGitCommit {
        hash: parts[0].to_string(),
        short_hash: parts[1].to_string(),
        author: parts[2].to_string(),
        date: parts[3].to_string(),
        subject: parts[4].to_string(),
    })
}
