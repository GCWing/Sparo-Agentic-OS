use crate::infrastructure::get_path_manager_arc;
use crate::service::prompt_history::{PromptHistoryEvent, PromptHistoryQuery, PromptHistoryStore};
use crate::util::errors::BitFunResult;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct PromptGitTraceStore;

impl PromptGitTraceStore {
    pub fn trace_dir(workspace_path: &Path) -> PathBuf {
        get_path_manager_arc()
            .project_runtime_root(workspace_path)
            .join("prompt_library")
            .join("git-traces")
    }

    pub fn list_git_prompt_commits(
        workspace_path: &Path,
        branch: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> BitFunResult<Vec<GitPromptCommit>> {
        if !is_git_repository(workspace_path) {
            return Ok(Vec::new());
        }

        if let Some(b) = branch {
            if !b.is_empty() && !branch_exists(workspace_path, b) {
                return Ok(Vec::new());
            }
        }

        let commits = load_commits(workspace_path, branch, limit, offset)?;
        if commits.is_empty() {
            return Ok(Vec::new());
        }

        let events = PromptHistoryStore::list(
            workspace_path,
            PromptHistoryQuery {
                limit: Some(500),
                ..Default::default()
            },
        )
        .map(|s| s.events)
        .unwrap_or_default();

        let mut results = Vec::with_capacity(commits.len());
        for (i, commit) in commits.iter().enumerate() {
            let older_commit = commits.get(i + 1);

            let prompts = prompts_for_commit(&events, commit, older_commit);
            let trace = if !prompts.is_empty() {
                Some(Self::cache_trace(workspace_path, commit, branch, &prompts)?)
            } else {
                None
            };

            results.push(GitPromptCommit {
                hash: commit.hash.clone(),
                short_hash: commit.short_hash.clone(),
                parent_hashes: commit.parent_hashes.clone(),
                author: commit.author.clone(),
                date: commit.date.clone(),
                subject: commit.subject.clone(),
                branch: commit.branch.clone(),
                trace,
                prompts,
            });
        }

        Ok(results)
    }

    pub fn list_branches(workspace_path: &Path) -> BitFunResult<Vec<String>> {
        if !is_git_repository(workspace_path) {
            return Ok(Vec::new());
        }
        let output = run_git(workspace_path, &["branch", "--format=%(refname:short)"])?;
        Ok(output
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect())
    }

    pub fn get_head_snapshot(workspace_path: &Path) -> BitFunResult<GitHeadSnapshot> {
        if !is_git_repository(workspace_path) {
            return Ok(GitHeadSnapshot {
                observed_head: None,
                observed_branch: None,
            });
        }
        Ok(GitHeadSnapshot {
            observed_head: run_git_optional(workspace_path, &["rev-parse", "HEAD"]),
            observed_branch: run_git_optional(workspace_path, &["branch", "--show-current"]),
        })
    }

    fn cache_trace(
        workspace_path: &Path,
        commit: &GitCommit,
        branch: Option<&str>,
        prompts: &[PromptHistoryEvent],
    ) -> BitFunResult<GitPromptTraceSummary> {
        let trace_id = format!(
            "trace_{}_{}",
            commit.short_hash,
            branch.unwrap_or("HEAD").replace('/', "_")
        );
        let dir = Self::trace_dir(workspace_path);
        fs::create_dir_all(&dir)?;
        let path = dir.join(format!("{}.json", trace_id));

        let direct_count = prompts
            .iter()
            .filter(|e| {
                e.after_commit_hash
                    .as_deref()
                    .is_some_and(|hash| commit.parent_hashes.iter().any(|p| p == hash))
            })
            .count();
        let is_root_commit = commit.parent_hashes.is_empty();
        let source = if direct_count > 0 {
            PromptCommitLinkSource::HeadMarker
        } else if is_root_commit {
            PromptCommitLinkSource::FirstCommit
        } else {
            PromptCommitLinkSource::TimeWindow
        };
        let confidence = if direct_count > 0 || is_root_commit {
            PromptCommitLinkConfidence::Direct
        } else {
            PromptCommitLinkConfidence::Inferred
        };

        let trace = GitPromptTrace {
            schema_version: 1,
            trace_id: trace_id.clone(),
            commit_hash: commit.hash.clone(),
            short_hash: commit.short_hash.clone(),
            commit_subject: commit.subject.clone(),
            branch_name: branch.map(str::to_string),
            generated_at: Utc::now().to_rfc3339(),
            prompts: prompts
                .iter()
                .map(|e| GitTraceEntry {
                    event_id: e.id.clone(),
                    session_id: e.session_id.clone(),
                    created_at: e.created_at.clone(),
                    link_source: source.clone(),
                    link_confidence: confidence.clone(),
                })
                .collect(),
        };

        fs::write(&path, serde_json::to_string_pretty(&trace)?)?;

        Ok(GitPromptTraceSummary {
            trace_id,
            trace_path: path.to_string_lossy().to_string(),
            prompt_count: prompts.len(),
            source,
            confidence,
        })
    }
}

fn prompts_for_commit(
    events: &[PromptHistoryEvent],
    commit: &GitCommit,
    older: Option<&GitCommit>,
) -> Vec<PromptHistoryEvent> {
    let direct: Vec<_> = events
        .iter()
        .filter(|e| {
            e.after_commit_hash.as_ref().is_some_and(|hash| {
                commit.parent_hashes.iter().any(|parent| parent == hash)
            })
        })
        .cloned()
        .collect();
    if !direct.is_empty() {
        return direct;
    }

    events
        .iter()
        .filter(|e| e.after_commit_hash.is_none())
        .filter_map(|e| {
            let created = DateTime::parse_from_rfc3339(&e.created_at)
                .ok()
                .map(|d| d.with_timezone(&Utc))?;

            if let Some(older_bound) = older.and_then(|c| c.parsed_date) {
                if created <= older_bound {
                    return None;
                }
            }

            if let Some(upper_bound) = commit.parsed_date {
                if created > upper_bound {
                    return None;
                }
            }

            Some(e.clone())
        })
        .collect()
}

fn branch_exists(workspace_path: &Path, branch: &str) -> bool {
    run_git(
        workspace_path,
        &["rev-parse", "--verify", &format!("refs/heads/{}", branch)],
    )
    .is_ok()
}

#[derive(Debug, Clone)]
struct GitCommit {
    hash: String,
    short_hash: String,
    parent_hashes: Vec<String>,
    author: String,
    date: String,
    subject: String,
    branch: Option<String>,
    parsed_date: Option<DateTime<Utc>>,
}

fn load_commits(
    workspace_path: &Path,
    branch: Option<&str>,
    limit: usize,
    offset: usize,
) -> BitFunResult<Vec<GitCommit>> {
    let limit_arg = format!("-n{}", limit);
    let skip_arg = format!("--skip={}", offset);
    let current_branch = run_git_optional(workspace_path, &["branch", "--show-current"]);

    let output = match branch {
        Some(b) if !b.is_empty() => run_git(
            workspace_path,
            &[
                "--no-pager", "log", b,
                &limit_arg, &skip_arg,
                "--date=iso-strict",
                "--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%ad%x1f%s",
            ],
        ),
        _ => run_git(
            workspace_path,
            &[
                "--no-pager", "log",
                &limit_arg, &skip_arg,
                "--date=iso-strict",
                "--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%ad%x1f%s",
            ],
        ),
    }?;

    let effective_branch = branch
        .map(str::to_string)
        .or_else(|| current_branch.clone());

    Ok(output
        .lines()
        .filter_map(|line| {
            let parts: Vec<_> = line.split('\u{1f}').collect();
            if parts.len() != 6 {
                return None;
            }
            let parsed_date = DateTime::parse_from_rfc3339(parts[4])
                .ok()
                .map(|d| d.with_timezone(&Utc));
            Some(GitCommit {
                hash: parts[0].to_string(),
                short_hash: parts[1].to_string(),
                parent_hashes: parts[2].split_whitespace().map(str::to_string).collect(),
                author: parts[3].to_string(),
                date: parts[4].to_string(),
                subject: parts[5].to_string(),
                branch: effective_branch.clone(),
                parsed_date,
            })
        })
        .collect())
}

fn is_git_repository(workspace_path: &Path) -> bool {
    workspace_path.join(".git").exists()
}

fn run_git(workspace_path: &Path, args: &[&str]) -> BitFunResult<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(workspace_path)
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(crate::util::errors::BitFunError::service(if stderr.is_empty() {
            "Git command failed".to_string()
        } else {
            stderr
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn run_git_optional(workspace_path: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(workspace_path)
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() { None } else { Some(value) }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPromptCommit {
    pub hash: String,
    pub short_hash: String,
    pub parent_hashes: Vec<String>,
    pub author: String,
    pub date: String,
    pub subject: String,
    pub branch: Option<String>,
    pub trace: Option<GitPromptTraceSummary>,
    pub prompts: Vec<PromptHistoryEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPromptTraceSummary {
    pub trace_id: String,
    pub trace_path: String,
    pub prompt_count: usize,
    pub source: PromptCommitLinkSource,
    pub confidence: PromptCommitLinkConfidence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPromptTrace {
    pub schema_version: u32,
    pub trace_id: String,
    pub commit_hash: String,
    pub short_hash: String,
    pub commit_subject: String,
    pub branch_name: Option<String>,
    pub generated_at: String,
    pub prompts: Vec<GitTraceEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTraceEntry {
    pub event_id: String,
    pub session_id: String,
    pub created_at: String,
    pub link_source: PromptCommitLinkSource,
    pub link_confidence: PromptCommitLinkConfidence,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptCommitLinkSource {
    HeadMarker,
    FirstCommit,
    TimeWindow,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptCommitLinkConfidence {
    Direct,
    Inferred,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHeadSnapshot {
    pub observed_head: Option<String>,
    pub observed_branch: Option<String>,
}