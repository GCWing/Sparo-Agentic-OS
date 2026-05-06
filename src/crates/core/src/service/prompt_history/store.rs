use super::types::{
    PromptHistoryContext, PromptHistoryEvent, PromptHistoryQuery, PromptHistorySource,
    PromptHistorySummary,
};
use crate::infrastructure::get_path_manager_arc;
use crate::util::errors::{BitFunError, BitFunResult};
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use uuid::Uuid;

const PROMPT_HISTORY_DIR: &str = "prompt_history";
const PROMPT_HISTORY_FILE: &str = "events.jsonl";

pub struct PromptHistoryStore;

impl PromptHistoryStore {
    pub fn history_dir(workspace_path: &Path) -> PathBuf {
        get_path_manager_arc()
            .project_runtime_root(workspace_path)
            .join(PROMPT_HISTORY_DIR)
    }

    pub fn history_file(workspace_path: &Path) -> PathBuf {
        Self::history_dir(workspace_path).join(PROMPT_HISTORY_FILE)
    }

    pub fn record_chat_input(
        workspace_path: impl Into<String>,
        session_id: impl Into<String>,
        turn_id: Option<String>,
        agent_type: impl Into<String>,
        text: impl Into<String>,
        original_text: Option<String>,
        context: Option<PromptHistoryContext>,
    ) -> BitFunResult<PromptHistoryEvent> {
        let workspace_path = workspace_path.into();
        let text = text.into();
        if text.trim().is_empty() {
            return Err(BitFunError::validation("Prompt text is required"));
        }
        let git_snapshot = capture_git_snapshot(Path::new(&workspace_path));
        let event = PromptHistoryEvent {
            id: format!("prompt_{}", Uuid::new_v4().simple()),
            session_id: session_id.into(),
            turn_id,
            workspace_path: workspace_path.clone(),
            created_at: Utc::now().to_rfc3339(),
            source: PromptHistorySource::ChatInput,
            prompt_hash: prompt_hash(&text),
            after_commit_hash: git_snapshot.head,
            git_branch_at_created: git_snapshot.branch,
            text,
            original_text: original_text.filter(|value| !value.trim().is_empty()),
            agent_type: agent_type.into(),
            pinned: false,
            context,
        };
        Self::append_event(Path::new(&workspace_path), &event)?;
        Ok(event)
    }

    pub fn list(query: PromptHistoryQuery) -> BitFunResult<PromptHistorySummary> {
        let workspace = Path::new(&query.workspace_path);
        let file = Self::history_file(workspace);
        Self::list_from_files(files_if_exists(vec![file]), query)
    }

    pub fn list_all_projects(query: PromptHistoryQuery) -> BitFunResult<PromptHistorySummary> {
        let projects_root = get_path_manager_arc().projects_root();
        if !projects_root.exists() {
            return Ok(PromptHistorySummary {
                total: 0,
                events: Vec::new(),
            });
        }

        let mut files = Vec::new();
        for entry in fs::read_dir(projects_root)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let file = entry
                .path()
                .join(PROMPT_HISTORY_DIR)
                .join(PROMPT_HISTORY_FILE);
            if file.exists() {
                files.push(file);
            }
        }
        Self::list_from_files(files, query)
    }

    pub fn get(workspace_path: &Path, event_id: &str) -> BitFunResult<PromptHistoryEvent> {
        let result = Self::list(PromptHistoryQuery {
            workspace_path: workspace_path.to_string_lossy().to_string(),
            session_id: None,
            agent_type: None,
            pinned: None,
            query: None,
            limit: None,
        })?;
        result
            .events
            .into_iter()
            .find(|event| event.id == event_id)
            .ok_or_else(|| {
                BitFunError::NotFound(format!("Prompt history event not found: {event_id}"))
            })
    }

    fn list_from_files(
        files: Vec<PathBuf>,
        query: PromptHistoryQuery,
    ) -> BitFunResult<PromptHistorySummary> {
        let q = query
            .query
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_lowercase);
        let session_filter = query
            .session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let agent_filter = query
            .agent_type
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let mut events = Vec::new();
        for file in files {
            for line in BufReader::new(fs::File::open(file)?).lines() {
                let line = line?;
                if line.trim().is_empty() {
                    continue;
                }
                let event: PromptHistoryEvent = match serde_json::from_str(&line) {
                    Ok(event) => event,
                    Err(error) => {
                        log::warn!("Failed to parse prompt history event: {}", error);
                        continue;
                    }
                };
                if let Some(session_id) = session_filter {
                    if event.session_id != session_id {
                        continue;
                    }
                }
                if let Some(agent_type) = agent_filter {
                    if event.agent_type != agent_type {
                        continue;
                    }
                }
                if let Some(pinned) = query.pinned {
                    if event.pinned != pinned {
                        continue;
                    }
                }
                if let Some(q) = &q {
                    let hay = format!("{} {} {}", event.text, event.agent_type, event.session_id)
                        .to_lowercase();
                    if !hay.contains(q) {
                        continue;
                    }
                }
                events.push(event);
            }
        }
        events.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        let total = events.len();
        events.truncate(query.limit.unwrap_or(100).clamp(1, 500));
        Ok(PromptHistorySummary { total, events })
    }

    fn append_event(workspace_path: &Path, event: &PromptHistoryEvent) -> BitFunResult<()> {
        let dir = Self::history_dir(workspace_path);
        fs::create_dir_all(&dir)?;
        Self::append_event_to_file(&dir.join(PROMPT_HISTORY_FILE), event)
    }

    fn append_event_to_file(file_path: &Path, event: &PromptHistoryEvent) -> BitFunResult<()> {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(file_path)?;
        let line = serde_json::to_string(event)?;
        writeln!(file, "{line}")?;
        Ok(())
    }
}

fn files_if_exists(files: Vec<PathBuf>) -> Vec<PathBuf> {
    files.into_iter().filter(|file| file.exists()).collect()
}

fn prompt_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.trim().as_bytes());
    hex::encode(hasher.finalize())
}

struct PromptHistoryGitSnapshot {
    head: Option<String>,
    branch: Option<String>,
}

fn capture_git_snapshot(workspace_path: &Path) -> PromptHistoryGitSnapshot {
    if !is_git_repository(workspace_path) {
        return PromptHistoryGitSnapshot {
            head: None,
            branch: None,
        };
    }
    PromptHistoryGitSnapshot {
        head: run_git_optional(workspace_path, &["rev-parse", "HEAD"]),
        branch: run_git_optional(workspace_path, &["branch", "--show-current"]),
    }
}

fn is_git_repository(workspace_path: &Path) -> bool {
    Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(workspace_path)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
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
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}
