use super::types::{
    GitPromptHistoryCommit, PromptCommitLinkConfidence, PromptCommitLinkSource,
    PromptCommitTracePrompt, PromptCommitTraceSummary, PromptReviewTrace,
};
use crate::service::prompt_history::{PromptHistoryEvent, PromptHistoryQuery, PromptHistoryStore};
use crate::util::errors::{BitFunError, BitFunResult};
use chrono::{DateTime, Utc};
use regex::Regex;
use std::fs;
use std::path::Path;
use std::process::Command;

const REVIEW_TRACE_DIR: &str = ".sparo_review/prompt-traces";
const GIT_DATE_FORMAT: &str = "--date=iso-strict";

#[derive(Debug, Clone)]
struct GitCommit {
    hash: String,
    short_hash: String,
    parent_hashes: Vec<String>,
    author: String,
    date: String,
    subject: String,
    parsed_date: Option<DateTime<Utc>>,
}

pub struct PromptCommitTraceStore;

impl PromptCommitTraceStore {
    pub fn list_git_prompt_history(
        workspace_root: &Path,
        limit: usize,
    ) -> BitFunResult<Vec<GitPromptHistoryCommit>> {
        if !is_git_repository(workspace_root) {
            return Ok(Vec::new());
        }

        let commits = load_commits(workspace_root, limit.clamp(1, 100))?;
        if commits.is_empty() {
            return Ok(Vec::new());
        }

        let history = PromptHistoryStore::list(PromptHistoryQuery {
            workspace_path: workspace_root.to_string_lossy().to_string(),
            session_id: None,
            agent_type: None,
            pinned: None,
            query: None,
            limit: Some(500),
        })?;

        let mut result = Vec::with_capacity(commits.len());
        for (index, commit) in commits.iter().enumerate() {
            let previous_commit_date = commits.get(index + 1).and_then(|item| item.parsed_date);
            let (prompts, source, confidence) = prompts_for_commit(
                &history.events,
                commit,
                previous_commit_date,
                commit.parsed_date,
            );
            let trace = if prompts.is_empty() {
                None
            } else {
                Some(Self::write_trace(
                    workspace_root,
                    commit,
                    &prompts,
                    source,
                    confidence,
                )?)
            };
            result.push(GitPromptHistoryCommit {
                hash: commit.hash.clone(),
                short_hash: commit.short_hash.clone(),
                author: commit.author.clone(),
                date: commit.date.clone(),
                subject: commit.subject.clone(),
                trace,
                prompts,
            });
        }

        Ok(result)
    }

    pub fn get_review_trace(
        workspace_root: &Path,
        trace_id: &str,
    ) -> BitFunResult<PromptReviewTrace> {
        let trace_id = ensure_safe_trace_id(trace_id)?;
        let path = workspace_root
            .join(REVIEW_TRACE_DIR)
            .join(format!("{trace_id}.json"));
        let content = fs::read_to_string(path)?;
        Ok(serde_json::from_str(&content)?)
    }

    fn write_trace(
        workspace_root: &Path,
        commit: &GitCommit,
        prompts: &[PromptHistoryEvent],
        source: PromptCommitLinkSource,
        confidence: PromptCommitLinkConfidence,
    ) -> BitFunResult<PromptCommitTraceSummary> {
        let trace_id = format!("trace_{}", commit.short_hash);
        let trace_dir = workspace_root.join(REVIEW_TRACE_DIR);
        fs::create_dir_all(&trace_dir)?;
        let trace_path = trace_dir.join(format!("{trace_id}.json"));
        let trace = PromptReviewTrace {
            schema_version: 1,
            trace_id: trace_id.clone(),
            commit_hash: commit.hash.clone(),
            short_hash: commit.short_hash.clone(),
            commit_subject: commit.subject.clone(),
            generated_at: Utc::now().to_rfc3339(),
            redacted: true,
            prompts: prompts.iter().map(prompt_to_trace_prompt).collect(),
        };
        let content = serde_json::to_string_pretty(&trace)?;
        fs::write(&trace_path, format!("{content}\n"))?;
        Ok(PromptCommitTraceSummary {
            trace_id,
            trace_path: path_to_repo_relative(workspace_root, &trace_path),
            prompt_count: prompts.len(),
            source,
            confidence,
        })
    }
}

fn load_commits(workspace_root: &Path, limit: usize) -> BitFunResult<Vec<GitCommit>> {
    let limit_arg = format!("-n{}", limit);
    let output = run_git(
        workspace_root,
        &[
            "--no-pager",
            "log",
            &limit_arg,
            GIT_DATE_FORMAT,
            "--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%ad%x1f%s",
        ],
    )?;
    Ok(output.lines().filter_map(parse_commit_line).collect())
}

fn prompts_for_commit(
    events: &[PromptHistoryEvent],
    commit: &GitCommit,
    after: Option<DateTime<Utc>>,
    until: Option<DateTime<Utc>>,
) -> (
    Vec<PromptHistoryEvent>,
    PromptCommitLinkSource,
    PromptCommitLinkConfidence,
) {
    let mut direct_prompts = events
        .iter()
        .filter(|event| {
            event.after_commit_hash.as_ref().is_some_and(|hash| {
                commit
                    .parent_hashes
                    .iter()
                    .any(|parent_hash| parent_hash == hash)
            })
        })
        .cloned()
        .collect::<Vec<_>>();
    if !direct_prompts.is_empty() {
        direct_prompts.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        return (
            direct_prompts,
            PromptCommitLinkSource::HeadMarker,
            PromptCommitLinkConfidence::Direct,
        );
    }

    let mut prompts = events
        .iter()
        .filter(|event| event.after_commit_hash.is_none())
        .filter_map(|event| {
            let created_at = DateTime::parse_from_rfc3339(&event.created_at)
                .ok()
                .map(|date| date.with_timezone(&Utc))?;
            if let Some(after) = after {
                if created_at <= after {
                    return None;
                }
            }
            if let Some(until) = until {
                if created_at > until {
                    return None;
                }
            }
            Some(event.clone())
        })
        .collect::<Vec<_>>();
    prompts.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    (
        prompts,
        PromptCommitLinkSource::TimeWindow,
        PromptCommitLinkConfidence::Inferred,
    )
}

fn prompt_to_trace_prompt(event: &PromptHistoryEvent) -> PromptCommitTracePrompt {
    let model = event.context.as_ref().and_then(|context| {
        context.model.as_ref().and_then(|model| {
            model
                .name
                .clone()
                .or_else(|| model.model_name.clone())
                .or_else(|| model.resolved_model_id.clone())
                .or_else(|| model.requested_model_id.clone())
        })
    });
    PromptCommitTracePrompt {
        prompt_history_event_id: event.id.clone(),
        session_id: event.session_id.clone(),
        turn_id: event.turn_id.clone(),
        created_at: event.created_at.clone(),
        source: format!("{:?}", event.source),
        agent_type: event.agent_type.clone(),
        model,
        prompt_hash: event.prompt_hash.clone(),
        prompt_summary: first_line(&event.text),
        prompt_text: redact_prompt_text(&event.text),
    }
}

fn redact_prompt_text(text: &str) -> String {
    let mut redacted = text.to_string();
    let patterns = [
        r#"(?i)\b(api[_-]?key|token|password|passwd|secret)\b\s*[:=]\s*['"]?[^'"\s]+"#,
        r"\bsk-[A-Za-z0-9_-]{16,}\b",
        r"\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b",
    ];
    for pattern in patterns {
        if let Ok(regex) = Regex::new(pattern) {
            redacted = regex.replace_all(&redacted, "[REDACTED]").to_string();
        }
    }
    redacted
}

fn first_line(text: &str) -> String {
    text.trim()
        .lines()
        .next()
        .unwrap_or("Prompt")
        .chars()
        .take(160)
        .collect()
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

fn parse_commit_line(line: &str) -> Option<GitCommit> {
    let parts = line.split('\u{1f}').collect::<Vec<_>>();
    if parts.len() != 6 {
        return None;
    }
    let date = parts[4].to_string();
    let parsed_date = DateTime::parse_from_rfc3339(&date)
        .ok()
        .map(|date| date.with_timezone(&Utc));
    Some(GitCommit {
        hash: parts[0].to_string(),
        short_hash: parts[1].to_string(),
        parent_hashes: parts[2]
            .split_whitespace()
            .map(str::to_string)
            .collect::<Vec<_>>(),
        author: parts[3].to_string(),
        date,
        subject: parts[5].to_string(),
        parsed_date,
    })
}

fn ensure_safe_trace_id(trace_id: &str) -> BitFunResult<&str> {
    let trimmed = trace_id.trim();
    if trimmed.is_empty()
        || !trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return Err(BitFunError::validation("Trace ID is invalid"));
    }
    Ok(trimmed)
}

fn path_to_repo_relative(workspace_root: &Path, path: &Path) -> String {
    path.strip_prefix(workspace_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}
