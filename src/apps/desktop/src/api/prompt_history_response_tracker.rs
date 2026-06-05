//! Subscriber that records prompt history events when dialog turns complete.
//! Prompt info is collected at submission time and the full event (with
//! response data, tool summaries, preceding prompts, and snapshot-based
//! file changes) is persisted when the turn finishes.

use bitfun_core::agentic::events::{AgenticEvent, EventSubscriber};
use bitfun_core::service::prompt_history::{
    PromptHistoryEvent, PromptHistorySource, PromptHistoryStore,
};
use bitfun_core::service::snapshot::manager::get_snapshot_manager_for_workspace;
use bitfun_core::util::errors::BitFunResult;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Prompt info captured at submission time, persisted when the turn finishes.
struct PendingPrompt {
    workspace_path: PathBuf,
    event_id: String,
    session_id: String,
    session_name: Option<String>,
    text: String,
    prompt_hash: String,
    agent_type: String,
    source: PromptHistorySource,
    model_id: Option<String>,
    image_context_count: usize,
    /// Git HEAD captured at submission time (used as diff base at completion).
    after_commit_hash: Option<String>,
    /// First line of the commit message for after_commit_hash.
    after_commit_subject: Option<String>,
    git_branch_at_created: Option<String>,
    created_at: String,
    /// Dialog turn index captured from DialogTurnStarted.
    turn_index: Option<usize>,
    /// Tool call records accumulated during the turn (keyed by tool_id).
    tool_events: HashMap<String, DetailedToolRecord>,
}

/// A detailed record of a single tool execution within a turn.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DetailedToolRecord {
    /// Unique tool call id (from the tool event).
    tool_id: String,
    tool_name: String,
    duration_ms: u64,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    /// Primary affected file path extracted from tool params.
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    /// Key context field (command for Bash, search pattern for Grep/Glob, etc.).
    #[serde(skip_serializing_if = "Option::is_none")]
    context: Option<String>,
    /// Truncated result output (first ~200 chars of result text).
    #[serde(skip_serializing_if = "Option::is_none")]
    result_summary: Option<String>,
    /// ISO-8601 timestamp when the tool started.
    #[serde(skip_serializing_if = "Option::is_none")]
    started_at: Option<String>,
    /// Number of lines added (for file-modifying tools).
    #[serde(skip_serializing_if = "Option::is_none")]
    lines_added: Option<usize>,
    /// Number of lines removed (for file-modifying tools).
    #[serde(skip_serializing_if = "Option::is_none")]
    lines_removed: Option<usize>,
}

pub struct PromptHistoryResponseTracker {
    /// turn_id → PendingPrompt
    turns: Mutex<HashMap<String, PendingPrompt>>,
}

impl PromptHistoryResponseTracker {
    pub fn new() -> Self {
        Self {
            turns: Mutex::new(HashMap::new()),
        }
    }

    /// Hard cap on in-flight pending turns to prevent unbounded memory growth.
    const MAX_PENDING_TURNS: usize = 100;

    /// Maximum age of a pending turn before it is considered stale and evicted.
    const MAX_TURN_AGE_MINUTES: i64 = 30;

    /// Register prompt info captured at submission time.
    /// The full event is persisted when the turn completes.
    #[allow(clippy::too_many_arguments)]
    pub fn register_turn(
        &self,
        workspace_path: PathBuf,
        turn_id: String,
        event_id: String,
        session_id: String,
        session_name: Option<String>,
        text: String,
        agent_type: String,
        source: PromptHistorySource,
        model_id: Option<String>,
        image_context_count: usize,
        after_commit_hash: Option<String>,
        after_commit_subject: Option<String>,
        git_branch_at_created: Option<String>,
    ) {
        let created_at = chrono::Utc::now().to_rfc3339();
        let prompt_hash = PromptHistoryStore::prompt_hash(&text);
        if let Ok(mut map) = self.turns.lock() {
            // Evict the oldest entry when at capacity.
            while map.len() >= Self::MAX_PENDING_TURNS {
                if let Some(oldest_id) = map
                    .iter()
                    .min_by_key(|(_, v)| v.created_at.as_str())
                    .map(|(k, _)| k.clone())
                {
                    log::warn!(
                        "PromptHistoryResponseTracker: evicting oldest pending turn (capacity={}): turn_id={}",
                        Self::MAX_PENDING_TURNS,
                        oldest_id
                    );
                    map.remove(&oldest_id);
                } else {
                    break;
                }
            }
            map.insert(
                turn_id,
                PendingPrompt {
                    workspace_path,
                    event_id,
                    session_id,
                    session_name,
                    text,
                    prompt_hash,
                    agent_type,
                    source,
                    model_id,
                    image_context_count,
                    after_commit_hash,
                    after_commit_subject,
                    git_branch_at_created,
                    created_at,
                    turn_index: None,
                    tool_events: HashMap::new(),
                },
            );
        }
    }
}

#[async_trait::async_trait]
impl EventSubscriber for PromptHistoryResponseTracker {
    async fn on_event(&self, event: &AgenticEvent) -> BitFunResult<()> {
        self.evict_stale();

        match event {
            AgenticEvent::DialogTurnStarted {
                turn_id,
                turn_index,
                ..
            } => {
                if let Ok(mut map) = self.turns.lock() {
                    if let Some(pending) = map.get_mut(turn_id) {
                        pending.turn_index = Some(*turn_index);
                    }
                }
            }

            AgenticEvent::ToolEvent {
                turn_id,
                tool_event,
                ..
            } => {
                use bitfun_core::agentic::events::ToolEventData;
                if let Ok(mut map) = self.turns.lock() {
                    if let Some(pending) = map.get_mut(turn_id) {
                        match tool_event {
                            ToolEventData::Started {
                                tool_id,
                                tool_name,
                                params,
                            } => {
                                let record = pending
                                    .tool_events
                                    .entry(tool_id.clone())
                                    .or_insert_with(|| DetailedToolRecord {
                                        tool_id: tool_id.clone(),
                                        tool_name: tool_name.clone(),
                                        duration_ms: 0,
                                        status: "started".to_string(),
                                        error: None,
                                        file_path: None,
                                        context: None,
                                        result_summary: None,
                                        started_at: Some(chrono::Utc::now().to_rfc3339()),
                                        lines_added: None,
                                        lines_removed: None,
                                    });
                                record.tool_name = tool_name.clone();
                                record.started_at = Some(chrono::Utc::now().to_rfc3339());
                                // Extract file_path and context from params
                                let (fp, ctx) = extract_tool_context(tool_name, params);
                                record.file_path = fp;
                                record.context = ctx;
                            }
                            ToolEventData::Completed {
                                tool_id,
                                tool_name,
                                result,
                                duration_ms,
                                ..
                            } => {
                                let record = pending
                                    .tool_events
                                    .entry(tool_id.clone())
                                    .or_insert_with(|| DetailedToolRecord {
                                        tool_id: tool_id.clone(),
                                        tool_name: tool_name.clone(),
                                        duration_ms: 0,
                                        status: "completed".to_string(),
                                        error: None,
                                        file_path: None,
                                        context: None,
                                        result_summary: None,
                                        started_at: None,
                                        lines_added: None,
                                        lines_removed: None,
                                    });
                                record.tool_name = tool_name.clone();
                                record.status = "completed".to_string();
                                record.duration_ms = *duration_ms;
                                // Fallback: set started_at if the Started event was missed
                                if record.started_at.is_none() {
                                    record.started_at = Some(chrono::Utc::now().to_rfc3339());
                                }
                                // Only record result summary for non-file, non-Bash, non-TodoWrite tools
                                if !is_file_tool(tool_name) && tool_name != "Bash" && tool_name != "TodoWrite" {
                                    record.result_summary = summarize_result(result);
                                }
                                // Try to extract file_path from result for file tools if params didn't provide it
                                if record.file_path.is_none() && is_file_tool(tool_name) {
                                    let (fp, _) = extract_tool_context(tool_name, result);
                                    record.file_path = fp;
                                }
                                // Extract line counts from result for file-modifying tools
                                if is_file_modifying_tool(tool_name) {
                                    if let Some(stats) = result.get("stats") {
                                        record.lines_added =
                                            stats.get("added").or_else(|| stats.get("linesAdded"))
                                                .and_then(|v| v.as_u64().map(|n| n as usize));
                                        record.lines_removed =
                                            stats.get("removed").or_else(|| stats.get("linesRemoved"))
                                                .and_then(|v| v.as_u64().map(|n| n as usize));
                                    }
                                }
                            }
                            ToolEventData::Failed {
                                tool_id,
                                tool_name,
                                error,
                            } => {
                                let record = pending
                                    .tool_events
                                    .entry(tool_id.clone())
                                    .or_insert_with(|| DetailedToolRecord {
                                        tool_id: tool_id.clone(),
                                        tool_name: tool_name.clone(),
                                        duration_ms: 0,
                                        status: "failed".to_string(),
                                        error: None,
                                        file_path: None,
                                        context: None,
                                        result_summary: None,
                                        started_at: Some(chrono::Utc::now().to_rfc3339()),
                                        lines_added: None,
                                        lines_removed: None,
                                    });
                                record.tool_name = tool_name.clone();
                                record.status = "failed".to_string();
                                record.error = Some(error.clone());
                                // Fallback: set started_at if the Started event was missed
                                if record.started_at.is_none() {
                                    record.started_at = Some(chrono::Utc::now().to_rfc3339());
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }

            AgenticEvent::DialogTurnCompleted {
                turn_id,
                total_rounds,
                total_tools,
                duration_ms,
                response_total_tokens,
                response_input_tokens,
                response_output_tokens,
                final_response,
                ..
            } => {
                let pending = match self.take_turn(turn_id) {
                    Some(p) => p,
                    None => return Ok(()),
                };

                let file_changes =
                    capture_snapshot_changes(&pending.workspace_path, &pending.session_id, pending.turn_index).await;

                let tool_summary = build_tool_summary(&pending.tool_events);
                let preceding_ids = get_preceding_event_ids(
                    &pending.workspace_path,
                    &pending.session_id,
                    &pending.created_at,
                );

                let event = PromptHistoryEvent {
                    id: pending.event_id,
                    session_id: pending.session_id,
                    session_name: pending.session_name,
                    turn_id: Some(turn_id.clone()),
                    created_at: pending.created_at,
                    updated_at: Some(chrono::Utc::now().to_rfc3339()),
                    source: pending.source,
                    text: pending.text,
                    prompt_hash: pending.prompt_hash,
                    agent_type: pending.agent_type,
                    pinned: false,
                    after_commit_hash: pending.after_commit_hash,
                    after_commit_subject: pending.after_commit_subject,
                    git_branch_at_created: pending.git_branch_at_created,
                    forked_from_event_id: None,
                    model_id: pending.model_id,
                    image_context_count: pending.image_context_count,
                    supersedes: None,
                    response_status: Some("completed".to_string()),
                    response_total_rounds: Some(*total_rounds),
                    response_total_tools: Some(*total_tools),
                    response_duration_ms: Some(*duration_ms),
                    response_total_tokens: *response_total_tokens,
                    response_input_tokens: *response_input_tokens,
                    response_output_tokens: *response_output_tokens,
                    response_summary: final_response.clone(),
                    response_error: None,
                    response_modified_files: file_changes.modified_files,
                    response_lines_added: file_changes.lines_added,
                    response_lines_removed: file_changes.lines_removed,
                    response_tool_summary: tool_summary,
                    preceding_prompt_event_ids: preceding_ids,
                };

                if let Err(error) =
                    PromptHistoryStore::record_event(&pending.workspace_path, &event).await
                {
                    log::warn!(
                        "Failed to record prompt history: event_id={}, error={}",
                        event.id,
                        error
                    );
                }
            }

            AgenticEvent::DialogTurnFailed {
                turn_id,
                error,
                ..
            } => {
                let pending = match self.take_turn(turn_id) {
                    Some(p) => p,
                    None => return Ok(()),
                };

                let file_changes =
                    capture_snapshot_changes(&pending.workspace_path, &pending.session_id, pending.turn_index).await;

                let tool_summary = build_tool_summary(&pending.tool_events);
                let preceding_ids = get_preceding_event_ids(
                    &pending.workspace_path,
                    &pending.session_id,
                    &pending.created_at,
                );

                let event = PromptHistoryEvent {
                    id: pending.event_id,
                    session_id: pending.session_id,
                    session_name: pending.session_name,
                    turn_id: Some(turn_id.clone()),
                    created_at: pending.created_at,
                    updated_at: Some(chrono::Utc::now().to_rfc3339()),
                    source: pending.source,
                    text: pending.text,
                    prompt_hash: pending.prompt_hash,
                    agent_type: pending.agent_type,
                    pinned: false,
                    after_commit_hash: pending.after_commit_hash,
                    after_commit_subject: pending.after_commit_subject,
                    git_branch_at_created: pending.git_branch_at_created,
                    forked_from_event_id: None,
                    model_id: pending.model_id,
                    image_context_count: pending.image_context_count,
                    supersedes: None,
                    response_status: Some("failed".to_string()),
                    response_total_rounds: None,
                    response_total_tools: None,
                    response_duration_ms: None,
                    response_total_tokens: None,
                    response_input_tokens: None,
                    response_output_tokens: None,
                    response_summary: None,
                    response_error: Some(error.clone()),
                    response_modified_files: file_changes.modified_files,
                    response_lines_added: file_changes.lines_added,
                    response_lines_removed: file_changes.lines_removed,
                    response_tool_summary: tool_summary,
                    preceding_prompt_event_ids: preceding_ids,
                };

                if let Err(err) =
                    PromptHistoryStore::record_event(&pending.workspace_path, &event).await
                {
                    log::warn!(
                        "Failed to record prompt history failed: event_id={}, error={}",
                        event.id,
                        err
                    );
                }
            }

            AgenticEvent::DialogTurnCancelled { turn_id, .. } => {
                let pending = match self.take_turn(turn_id) {
                    Some(p) => p,
                    None => return Ok(()),
                };

                let file_changes =
                    capture_snapshot_changes(&pending.workspace_path, &pending.session_id, pending.turn_index).await;

                let tool_summary = build_tool_summary(&pending.tool_events);
                let preceding_ids = get_preceding_event_ids(
                    &pending.workspace_path,
                    &pending.session_id,
                    &pending.created_at,
                );

                let event = PromptHistoryEvent {
                    id: pending.event_id,
                    session_id: pending.session_id,
                    session_name: pending.session_name,
                    turn_id: Some(turn_id.clone()),
                    created_at: pending.created_at,
                    updated_at: Some(chrono::Utc::now().to_rfc3339()),
                    source: pending.source,
                    text: pending.text,
                    prompt_hash: pending.prompt_hash,
                    agent_type: pending.agent_type,
                    pinned: false,
                    after_commit_hash: pending.after_commit_hash,
                    after_commit_subject: pending.after_commit_subject,
                    git_branch_at_created: pending.git_branch_at_created,
                    forked_from_event_id: None,
                    model_id: pending.model_id,
                    image_context_count: pending.image_context_count,
                    supersedes: None,
                    response_status: Some("cancelled".to_string()),
                    response_total_rounds: None,
                    response_total_tools: None,
                    response_duration_ms: None,
                    response_total_tokens: None,
                    response_input_tokens: None,
                    response_output_tokens: None,
                    response_summary: None,
                    response_error: None,
                    response_modified_files: file_changes.modified_files,
                    response_lines_added: file_changes.lines_added,
                    response_lines_removed: file_changes.lines_removed,
                    response_tool_summary: tool_summary,
                    preceding_prompt_event_ids: preceding_ids,
                };

                if let Err(err) =
                    PromptHistoryStore::record_event(&pending.workspace_path, &event).await
                {
                    log::warn!(
                        "Failed to record prompt history cancelled: event_id={}, error={}",
                        event.id,
                        err
                    );
                }
            }

            _ => {}
        }

        Ok(())
    }
}

impl PromptHistoryResponseTracker {
    /// Remove and return a pending turn (called on completion / failure / cancel).
    fn take_turn(&self, turn_id: &str) -> Option<PendingPrompt> {
        self.turns
            .lock()
            .ok()
            .and_then(|mut map| map.remove(turn_id))
    }

    /// Explicitly discard a pending turn without persisting.
    /// Used when the scheduler rejects a submission after registration.
    pub fn remove_turn(&self, turn_id: &str) {
        if let Ok(mut map) = self.turns.lock() {
            if map.remove(turn_id).is_some() {
                log::debug!(
                    "PromptHistoryResponseTracker: removed unstarted turn: turn_id={}",
                    turn_id
                );
            }
        }
    }

    /// Remove pending turns that have exceeded MAX_TURN_AGE_MINUTES.
    fn evict_stale(&self) {
        let cutoff = chrono::Utc::now()
            .checked_sub_signed(chrono::Duration::minutes(Self::MAX_TURN_AGE_MINUTES))
            .map(|t| t.to_rfc3339());

        if let Some(ref cutoff) = cutoff {
            if let Ok(mut map) = self.turns.lock() {
                let stale: Vec<String> = map
                    .iter()
                    .filter(|(_, v)| v.created_at.as_str() < cutoff.as_str())
                    .map(|(k, _)| k.clone())
                    .collect();
                for id in stale {
                    log::warn!(
                        "PromptHistoryResponseTracker: evicting stale pending turn: turn_id={}",
                        id
                    );
                    map.remove(&id);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// File change helpers (snapshot-based, git fallback)
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
struct FileChangeSummary {
    modified_files: Option<String>,
    lines_added: Option<usize>,
    lines_removed: Option<usize>,
}

#[derive(Debug, Clone, serde::Serialize)]
struct FileChange {
    file: String,
    #[serde(rename = "added")]
    lines_added: usize,
    #[serde(rename = "removed")]
    lines_removed: usize,
}

/// Captures file changes from the snapshot operation history.
/// Falls back to empty result when no snapshot manager is available.
async fn capture_snapshot_changes(
    workspace_path: &Path,
    session_id: &str,
    turn_index: Option<usize>,
) -> FileChangeSummary {
    let Some(manager) = get_snapshot_manager_for_workspace(workspace_path) else {
        log::debug!(
            "No snapshot manager for workspace, skipping file change capture: workspace={:?} session_id={}",
            workspace_path,
            session_id
        );
        return FileChangeSummary::default();
    };

    log::info!(
        "Capturing snapshot changes: workspace={:?} session_id={} turn_index={:?}",
        workspace_path,
        session_id,
        turn_index
    );

    capture_snapshot_changes_from_manager(&manager, session_id, turn_index).await
}

async fn capture_snapshot_changes_from_manager(
    manager: &bitfun_core::service::snapshot::manager::SnapshotManager,
    session_id: &str,
    turn_index: Option<usize>,
) -> FileChangeSummary {
    let session = match manager.get_session(session_id).await {
        Ok(s) => {
            log::info!(
                "Got snapshot session: session_id={} operation_count={}",
                session_id,
                s.operations.len()
            );
            s
        },
        Err(e) => {
            log::warn!(
                "Failed to get snapshot session: session_id={}, error={}",
                session_id,
                e
            );
            return FileChangeSummary::default();
        }
    };

    // Filter operations by turn_index when available; otherwise take all.
    let operations: Vec<_> = if let Some(ti) = turn_index {
        session.operations.into_iter().filter(|op| op.turn_index == ti).collect()
    } else {
        session.operations
    };

    if operations.is_empty() {
        log::info!(
            "No snapshot operations for turn: session_id={} turn_index={:?}",
            session_id,
            turn_index
        );
        return FileChangeSummary::default();
    }

    log::info!(
        "Processing {} snapshot operations for file changes",
        operations.len()
    );

    // Aggregate per-file: same file across multiple operations → sum lines.
    let mut file_map: HashMap<String, FileChange> = HashMap::new();
    for op in &operations {
        let path_str = op.file_path.to_string_lossy().to_string();
        let entry = file_map.entry(path_str).or_insert_with(|| FileChange {
            file: op.file_path.to_string_lossy().to_string(),
            lines_added: 0,
            lines_removed: 0,
        });
        entry.lines_added = entry.lines_added.saturating_add(op.diff_summary.lines_added);
        entry.lines_removed = entry.lines_removed.saturating_add(op.diff_summary.lines_removed);
    }

    let file_changes: Vec<FileChange> = file_map.into_values().collect();
    let total_added = file_changes.iter().map(|f| f.lines_added).sum::<usize>();
    let total_removed = file_changes.iter().map(|f| f.lines_removed).sum::<usize>();

    log::info!(
        "Snapshot file changes captured: file_count={} total_added={} total_removed={}",
        file_changes.len(),
        total_added,
        total_removed
    );

    let modified_files_json = if file_changes.is_empty() {
        None
    } else {
        serde_json::to_string(&file_changes).ok()
    };

    FileChangeSummary {
        modified_files: modified_files_json,
        lines_added: if total_added > 0 || total_removed > 0 {
            Some(total_added)
        } else {
            None
        },
        lines_removed: if total_added > 0 || total_removed > 0 {
            Some(total_removed)
        } else {
            None
        },
    }
}

// ---------------------------------------------------------------------------
// Tool call summary — detailed per-tool records with timeline
// ---------------------------------------------------------------------------

/// Converts the accumulated tool records into a JSON array of detailed entries,
/// ordered by started_at so the frontend can render a timeline.
fn build_tool_summary(tool_events: &HashMap<String, DetailedToolRecord>) -> Option<String> {
    if tool_events.is_empty() {
        return None;
    }

    let mut records: Vec<&DetailedToolRecord> = tool_events.values().collect();
    // Sort by started_at (tools without started_at go last).
    records.sort_by_key(|r| {
        r.started_at
            .as_deref()
            .unwrap_or("z")
    });

    serde_json::to_string(&records).ok()
}

/// Extracts tool-specific information based on tool category.
///
/// Categories:
/// - File-modifying tools (Write, Edit, Delete): full file_path, no context
/// - File-reading tools (Read): full file_path, no context
/// - File-search tools (Glob, Grep): search path + pattern
/// - Bash: full command (untruncated) as context, no file_path
/// - TodoWrite: formatted task list with status markers as context, no file_path
/// - Other tools (Task, WebSearch, WebFetch, etc.): nothing extra
fn extract_tool_context(tool_name: &str, params: &serde_json::Value) -> (Option<String>, Option<String>) {
    match tool_name {
        // File-modifying tools — record full file path, skip everything else
        "Write" | "Edit" | "Delete" => {
            let fp = extract_file_path(params);
            (fp, None)
        }
        // File-reading tool — record full file path
        "Read" => {
            let fp = extract_file_path(params);
            (fp, None)
        }
        // File-search tools — record search path + pattern
        "Glob" | "Grep" => {
            let fp = extract_file_path(params);
            let pattern = params
                .get("pattern")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            (fp, pattern)
        }
        // Bash — record full command (no truncation), skip file_path
        "Bash" => {
            let cmd = params
                .get("command")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            (None, cmd)
        }
        // TodoWrite — record complete task list with completion status
        "TodoWrite" => {
            let todos_str = format_todo_list(params);
            (None, todos_str)
        }
        // All other tools — don't record extra information
        _ => (None, None),
    }
}

/// Formats a TodoWrite tool's todos array into a human-readable string
/// with status markers: [x] completed, [~] in_progress, [ ] pending.
fn format_todo_list(params: &serde_json::Value) -> Option<String> {
    let todos = params.get("todos")?.as_array()?;
    if todos.is_empty() {
        return None;
    }
    let lines: Vec<String> = todos
        .iter()
        .map(|t| {
            let status = t
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("pending");
            let content = t
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let marker = match status {
                "completed" => "[x]",
                "in_progress" => "[~]",
                _ => "[ ]",
            };
            format!("{} {}", marker, content)
        })
        .collect();
    Some(lines.join("\n"))
}

/// Returns true for file-modifying tools (Write, Edit, Delete).
fn is_file_modifying_tool(tool_name: &str) -> bool {
    matches!(tool_name, "Write" | "Edit" | "Delete")
}

/// Returns true for any file-related tool (Read, Write, Edit, Delete, Glob, Grep).
fn is_file_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "Read" | "Write" | "Edit" | "Delete" | "Glob" | "Grep"
    )
}

/// Try common key names for a file path in a JSON object.
fn extract_file_path(value: &serde_json::Value) -> Option<String> {
    for key in &["file_path", "filePath", "target_file", "path", "plan_file_path", "filename"] {
        if let Some(s) = value.get(key).and_then(|v| v.as_str()) {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Truncate a result JSON value to a short human-readable summary (~200 chars).
fn summarize_result(result: &serde_json::Value) -> Option<String> {
    match result {
        serde_json::Value::String(s) => {
            if s.is_empty() {
                None
            } else {
                Some(truncate_str(s).to_string())
            }
        }
        serde_json::Value::Object(map) => {
            // Try common result fields first
            if let Some(content) = map.get("content").and_then(|v| v.as_str()) {
                return Some(truncate_str(content).to_string());
            }
            if let Some(diff) = map.get("diff").or_else(|| map.get("diffContent")).and_then(|v| v.as_str()) {
                return Some(truncate_str(diff).to_string());
            }
            if let Some(output) = map.get("output").or_else(|| map.get("stdout")).and_then(|v| v.as_str()) {
                return Some(truncate_str(output).to_string());
            }
            if let Some(text) = map.get("text").or_else(|| map.get("message")).and_then(|v| v.as_str()) {
                return Some(truncate_str(text).to_string());
            }
            // Fallback: compact JSON representation
            let compact = serde_json::to_string(map).unwrap_or_default();
            if compact.len() <= 4 {
                None
            } else {
                Some(truncate_str(&compact).to_string())
            }
        }
        _ => None,
    }
}

fn truncate_str(s: &str) -> &str {
    const MAX_LEN: usize = 200;
    if s.len() <= MAX_LEN {
        return s;
    }
    let mut end = MAX_LEN;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    if end == 0 {
        // First char already exceeds MAX_LEN; return empty.
        ""
    } else {
        &s[..end]
    }
}

// ---------------------------------------------------------------------------
// Preceding prompt tracking — summary + timeline, not just raw IDs
// ---------------------------------------------------------------------------

/// Compact preceding-prompt entry stored in JSON.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PrecedingPromptEntry {
    id: String,
    /// First line of the prompt text, truncated to 80 chars.
    summary: String,
    created_at: String,
    agent_type: String,
}

/// Maximum number of preceding prompt entries to store.
const MAX_PRECEDING_IDS: usize = 5;

/// Returns a JSON array of `[{id, summary, createdAt, agentType}]` for the
/// most recent prompt events in the same session created before `created_before`.
fn get_preceding_event_ids(
    workspace_path: &Path,
    session_id: &str,
    created_before: &str,
) -> Option<String> {
    let query = bitfun_core::service::prompt_history::PromptHistoryQuery {
        session_id: Some(session_id.to_string()),
        limit: Some(MAX_PRECEDING_IDS),
        to_date: Some(created_before.to_string()),
        ..Default::default()
    };

    let summary = match PromptHistoryStore::list(workspace_path, query) {
        Ok(s) => s,
        Err(_) => return None,
    };

    let entries: Vec<PrecedingPromptEntry> = summary
        .events
        .iter()
        .filter(|e| e.created_at.as_str() < created_before)
        .map(|e| PrecedingPromptEntry {
            id: e.id.clone(),
            summary: first_line_truncated(&e.text, 80),
            created_at: e.created_at.clone(),
            agent_type: e.agent_type.clone(),
        })
        .collect();

    if entries.is_empty() {
        None
    } else {
        serde_json::to_string(&entries).ok()
    }
}

fn first_line_truncated(text: &str, max_len: usize) -> String {
    let line = text.trim().lines().next().unwrap_or("").trim();
    if line.len() <= max_len {
        line.to_string()
    } else {
        let mut end = max_len;
        while end > 0 && !line.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}...", &line[..end])
    }
}