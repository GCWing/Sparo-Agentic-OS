use super::prompt::{
    build_memory_consolidation_prompt, MemoryConsolidationAgentRole, MemoryConsolidationPromptInput,
};
use super::state::{
    load_state, now_ms, relative_log_path, save_state, JournalSlice, MemoryConsolidationSource,
    MemoryConsolidationSourceKind, MemoryConsolidationSourceState, MemoryConsolidationState,
};
use crate::agentic::coordination::get_global_coordinator;
use crate::agentic::memory::store::{
    ensure_memory_store_for_target, memory_store_dir_path_for_target, MemoryStoreTarget,
    MEMORY_CANONICAL_FILE,
};
use crate::agentic::tools::{ToolPathPolicy, ToolRuntimeRestrictions};
use crate::error::{CoreError, CoreResult};
use crate::service::workspace::{get_global_workspace_service, WorkspaceInfo, WorkspaceKind};
use chrono::{Local, TimeZone};
use log::{debug, info, warn};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::fs;
use tokio::sync::{Mutex, Notify};
use tokio::time::Duration;

const DEFAULT_DAILY_WAKE_HOUR_LOCAL: u32 = 3;
const DEFAULT_DAILY_WAKE_MINUTE_LOCAL: u32 = 30;
const STARTUP_CATCH_UP_DELAY_SECS: u64 = 120;
const MAX_JOURNAL_CONTEXT_LINES: usize = 320;
const SOUL_FILE_NAME: &str = "SOUL.md";
const USER_FILE_NAME: &str = "USER.md";

static GLOBAL_MEMORY_CONSOLIDATION_SERVICE: OnceLock<Arc<MemoryConsolidationService>> =
    OnceLock::new();

#[derive(Debug, Clone, Default)]
pub struct ManualMemoryConsolidationRequest {
    pub include_global: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryConsolidationSummary {
    pub attempted_sources: usize,
    pub updated_sources: usize,
}

#[derive(Debug, Clone)]
pub struct MemoryConsolidationStatusSnapshot {
    pub active: bool,
    pub last_started_at_ms: Option<i64>,
    pub last_completed_at_ms: Option<i64>,
    pub source_count: usize,
}

#[derive(Debug, Clone)]
struct JournalBatch {
    journal_context: String,
    last_relative_path: String,
    last_processed_line: usize,
}

pub struct MemoryConsolidationService {
    state: Mutex<MemoryConsolidationState>,
    wake_notify: Notify,
    started: AtomicBool,
    run_lock: Mutex<()>,
}

impl MemoryConsolidationService {
    pub async fn new() -> CoreResult<Arc<Self>> {
        let state = load_state().await?;
        Ok(Arc::new(Self {
            state: Mutex::new(state),
            wake_notify: Notify::new(),
            started: AtomicBool::new(false),
            run_lock: Mutex::new(()),
        }))
    }

    pub fn start(self: &Arc<Self>) {
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }

        info!(
            "Memory consolidation service started: daily_wake_hour_local={}, daily_wake_minute_local={}",
            DEFAULT_DAILY_WAKE_HOUR_LOCAL, DEFAULT_DAILY_WAKE_MINUTE_LOCAL
        );

        let catch_up_service = Arc::clone(self);
        tokio::spawn(async move {
            tokio::time::sleep(startup_catch_up_delay()).await;
            if let Err(error) = catch_up_service.maybe_run_startup_catch_up().await {
                warn!("Memory consolidation startup catch-up failed: {}", error);
            }
        });

        let service = Arc::clone(self);
        tokio::spawn(async move {
            service.run_loop().await;
        });
    }

    pub async fn run_now(
        &self,
        request: ManualMemoryConsolidationRequest,
    ) -> CoreResult<MemoryConsolidationSummary> {
        self.run_once(Some(request), false).await
    }

    pub async fn status_snapshot(&self) -> MemoryConsolidationStatusSnapshot {
        let state = self.state.lock().await.clone();
        let active = self.run_lock.try_lock().is_err();
        MemoryConsolidationStatusSnapshot {
            active,
            last_started_at_ms: state.last_started_at_ms,
            last_completed_at_ms: state.last_completed_at_ms,
            source_count: state.sources.len(),
        }
    }

    async fn run_loop(self: Arc<Self>) {
        loop {
            let next_delay = next_daily_wake_duration();
            tokio::select! {
                _ = tokio::time::sleep(next_delay) => {}
                _ = self.wake_notify.notified() => {}
            }

            if let Err(error) = self.run_once(None, true).await {
                warn!("Memory consolidation run failed: {}", error);
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
        }
    }

    async fn maybe_run_startup_catch_up(&self) -> CoreResult<()> {
        let should_run = {
            let state = self.state.lock().await;
            should_run_startup_catch_up(state.last_completed_at_ms, Local::now())
        };

        if !should_run {
            return Ok(());
        }

        info!(
            "Memory consolidation startup catch-up triggered: last_completed_at_ms={:?}",
            {
                let state = self.state.lock().await;
                state.last_completed_at_ms
            }
        );

        self.run_once(None, true).await?;
        Ok(())
    }

    async fn run_once(
        &self,
        request: Option<ManualMemoryConsolidationRequest>,
        persist_started_at: bool,
    ) -> CoreResult<MemoryConsolidationSummary> {
        let _guard = self.run_lock.lock().await;

        let sources = self.collect_sources(request.as_ref()).await?;
        if sources.is_empty() {
            return Ok(MemoryConsolidationSummary::default());
        }

        {
            let mut state = self.state.lock().await;
            state.last_started_at_ms = Some(now_ms());
            if persist_started_at {
                save_state(&state).await?;
            }
        }

        let global_memory_dir =
            memory_store_dir_path_for_target(MemoryStoreTarget::GlobalAgenticOs)?;
        let global_soul_file = global_memory_dir.join(SOUL_FILE_NAME);
        let global_user_file = global_memory_dir.join(USER_FILE_NAME);
        let global_memory_file = global_memory_dir.join(MEMORY_CANONICAL_FILE);
        let mut summary = MemoryConsolidationSummary {
            attempted_sources: sources.len(),
            updated_sources: 0,
        };

        for source in sources {
            match self
                .process_source(
                    &source,
                    &global_memory_dir,
                    &global_soul_file,
                    &global_user_file,
                    &global_memory_file,
                )
                .await
            {
                Ok(updated) => {
                    if updated {
                        summary.updated_sources += 1;
                    }
                }
                Err(error) => {
                    warn!(
                        "Memory consolidation source failed: source_key={}, error={}",
                        source.key, error
                    );
                }
            }
        }

        {
            let mut state = self.state.lock().await;
            state.last_completed_at_ms = Some(now_ms());
            save_state(&state).await?;
        }

        Ok(summary)
    }

    async fn collect_sources(
        &self,
        request: Option<&ManualMemoryConsolidationRequest>,
    ) -> CoreResult<Vec<MemoryConsolidationSource>> {
        let path_manager = crate::infrastructure::get_path_manager_arc();
        ensure_memory_store_for_target(MemoryStoreTarget::GlobalAgenticOs).await?;

        let include_global = request.map(|value| value.include_global).unwrap_or(true);
        let mut sources = Vec::new();

        if include_global {
            sources.push(MemoryConsolidationSource {
                key: "global".to_string(),
                kind: MemoryConsolidationSourceKind::Global,
                workspace_root: None,
                memory_dir: path_manager.agentic_os_memory_dir(),
            });
        }

        let candidate_workspaces = if let Some(workspace_service) = get_global_workspace_service() {
            workspace_service
                .list_workspace_routing_candidates()
                .await
                .into_iter()
                .filter(should_include_workspace_source)
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };

        let mut workspace_roots = Vec::new();
        for workspace in candidate_workspaces {
            let workspace_root = workspace.root_path;
            let memory_dir = path_manager.workspace_memory_dir(workspace_root.as_path())?;
            let prior_state = {
                let state = self.state.lock().await;
                state.source_state(&workspace_root.to_string_lossy().replace('\\', "/"))
            };
            let slices = collect_new_journal_slices(&memory_dir, &prior_state).await?;
            if slices.is_empty() {
                continue;
            }
            workspace_roots.push(workspace_root);
        }

        for workspace_root in workspace_roots {
            ensure_memory_store_for_target(MemoryStoreTarget::WorkspaceProject(
                workspace_root.as_path(),
            ))
            .await?;
            sources.push(MemoryConsolidationSource {
                key: workspace_root.to_string_lossy().replace('\\', "/"),
                kind: MemoryConsolidationSourceKind::Workspace,
                workspace_root: Some(workspace_root.clone()),
                memory_dir: path_manager.workspace_memory_dir(workspace_root.as_path())?,
            });
        }

        sources.sort_by(|left, right| left.key.cmp(&right.key));
        Ok(sources)
    }

    async fn process_source(
        &self,
        source: &MemoryConsolidationSource,
        global_memory_dir: &Path,
        global_soul_file: &Path,
        global_user_file: &Path,
        global_memory_file: &Path,
    ) -> CoreResult<bool> {
        let prior_state = {
            let state = self.state.lock().await;
            state.source_state(&source.key)
        };

        let slices = collect_new_journal_slices(&source.memory_dir, &prior_state).await?;
        if slices.is_empty() {
            return Ok(false);
        }

        let batches = build_journal_batches(&slices);
        if batches.is_empty() {
            return Ok(false);
        }

        let role = match source.kind {
            MemoryConsolidationSourceKind::Workspace => MemoryConsolidationAgentRole::Workspace,
            MemoryConsolidationSourceKind::Global => MemoryConsolidationAgentRole::Global,
        };
        let workspace_path = source
            .workspace_root
            .as_ref()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|| source.memory_dir.to_string_lossy().to_string());
        let restrictions = build_runtime_restrictions(source, global_memory_dir);
        let coordinator = get_global_coordinator()
            .ok_or_else(|| CoreError::service("Conversation coordinator is not initialized"))?;
        let workspace_memory_file_path =
            matches!(source.kind, MemoryConsolidationSourceKind::Workspace)
                .then_some(source.memory_dir.join(MEMORY_CANONICAL_FILE));
        let mut updated_any = false;

        for (index, batch) in batches.iter().enumerate() {
            let prompt = build_memory_consolidation_prompt(&MemoryConsolidationPromptInput {
                role,
                workspace_memory_file_path: workspace_memory_file_path.as_deref(),
                global_soul_file_path: match source.kind {
                    MemoryConsolidationSourceKind::Workspace => Some(global_soul_file),
                    MemoryConsolidationSourceKind::Global => Some(global_soul_file),
                },
                global_user_file_path: match source.kind {
                    MemoryConsolidationSourceKind::Workspace => Some(global_user_file),
                    MemoryConsolidationSourceKind::Global => Some(global_user_file),
                },
                global_memory_file_path: match source.kind {
                    MemoryConsolidationSourceKind::Workspace => Some(global_memory_file),
                    MemoryConsolidationSourceKind::Global => Some(global_memory_file),
                },
                journal_context: &batch.journal_context,
            })?;

            let result = match coordinator
                .execute_hidden_memory_consolidation(
                    role.agent_type().to_string(),
                    format!("Consolidate {}", source.key),
                    workspace_path.clone(),
                    prompt,
                    restrictions.clone(),
                    Some(source.key.clone()),
                    None,
                )
                .await
            {
                Ok(result) => result,
                Err(error) if updated_any => {
                    warn!(
                        "Memory consolidation batch failed after partial progress: source_key={}, batch_index={}, batch_count={}, error={}",
                        source.key,
                        index + 1,
                        batches.len(),
                        error
                    );
                    return Ok(true);
                }
                Err(error) => return Err(error),
            };

            debug!(
                "Memory consolidation batch finished: source_key={}, batch_index={}, batch_count={}, response_len={}, cursor_path={}, cursor_line={}",
                source.key,
                index + 1,
                batches.len(),
                result.len(),
                batch.last_relative_path,
                batch.last_processed_line
            );

            let mut state = self.state.lock().await;
            let source_state = state.source_state_mut(&source.key);
            source_state.last_processed_relative_path = Some(batch.last_relative_path.clone());
            source_state.last_processed_line = batch.last_processed_line;
            source_state.last_processed_at_ms = Some(now_ms());
            save_state(&state).await?;
            updated_any = true;
        }

        Ok(updated_any)
    }
}

fn should_include_workspace_source(workspace: &WorkspaceInfo) -> bool {
    workspace.workspace_kind == WorkspaceKind::Normal && workspace.root_path.exists()
}

fn build_runtime_restrictions(
    source: &MemoryConsolidationSource,
    global_memory_dir: &Path,
) -> ToolRuntimeRestrictions {
    let mut write_roots = vec![source.memory_dir.to_string_lossy().to_string()];
    if matches!(source.kind, MemoryConsolidationSourceKind::Workspace) {
        write_roots.push(global_memory_dir.to_string_lossy().to_string());
    }

    ToolRuntimeRestrictions {
        allowed_tool_names: ["Read", "Glob", "Grep", "Write", "Edit", "LS"]
            .into_iter()
            .map(str::to_string)
            .collect::<BTreeSet<_>>(),
        denied_tool_names: BTreeSet::new(),
        path_policy: ToolPathPolicy {
            write_roots: write_roots.clone(),
            edit_roots: write_roots,
            delete_roots: Vec::new(),
            ..ToolPathPolicy::default()
        },
        disable_snapshot_tracking: true,
    }
}

async fn collect_new_journal_slices(
    memory_dir: &Path,
    source_state: &MemoryConsolidationSourceState,
) -> CoreResult<Vec<JournalSlice>> {
    let files = list_journal_files(memory_dir).await?;
    let mut slices = Vec::new();

    for file in files {
        let relative_path = relative_log_path(memory_dir, &file);
        let start_line = match source_state.last_processed_relative_path.as_deref() {
            Some(previous) if previous == relative_path => source_state.last_processed_line + 1,
            Some(previous) if relative_path.as_str() < previous => continue,
            _ => 1,
        };

        let content = fs::read_to_string(&file).await.map_err(|error| {
            CoreError::service(format!(
                "Failed to read memory journal {}: {}",
                file.display(),
                error
            ))
        })?;
        let total_lines = content.lines().count();
        if total_lines == 0 || start_line > total_lines {
            continue;
        }

        let selected_lines = content
            .lines()
            .enumerate()
            .filter_map(|(index, line)| {
                let line_number = index + 1;
                (line_number >= start_line).then_some(line)
            })
            .collect::<Vec<_>>();
        if selected_lines.is_empty() {
            continue;
        }

        slices.push(JournalSlice {
            relative_path,
            start_line,
            content: selected_lines.join("\n"),
        });
    }

    Ok(slices)
}

async fn list_journal_files(memory_dir: &Path) -> CoreResult<Vec<PathBuf>> {
    let logs_dir = memory_dir.join("logs");
    let mut files = Vec::new();
    if !logs_dir.exists() {
        return Ok(files);
    }

    let mut pending = vec![logs_dir];
    while let Some(dir) = pending.pop() {
        let mut entries = fs::read_dir(&dir).await.map_err(|error| {
            CoreError::service(format!(
                "Failed to read journal directory {}: {}",
                dir.display(),
                error
            ))
        })?;

        while let Some(entry) = entries.next_entry().await.map_err(|error| {
            CoreError::service(format!(
                "Failed to iterate journal directory {}: {}",
                dir.display(),
                error
            ))
        })? {
            let path = entry.path();
            let file_type = entry.file_type().await.map_err(|error| {
                CoreError::service(format!(
                    "Failed to inspect journal entry {}: {}",
                    path.display(),
                    error
                ))
            })?;
            if file_type.is_dir() {
                pending.push(path);
            } else if file_type.is_file()
                && path.extension().and_then(|ext| ext.to_str()) == Some("jsonl")
            {
                files.push(path);
            }
        }
    }

    files.sort();
    Ok(files)
}

fn build_journal_batches(slices: &[JournalSlice]) -> Vec<JournalBatch> {
    let mut batches = Vec::new();
    let mut rendered = Vec::new();
    let mut line_budget = 0usize;
    let mut last_relative_path: Option<String> = None;
    let mut last_processed_line = 0usize;

    let flush_batch = |batches: &mut Vec<JournalBatch>,
                       rendered: &mut Vec<String>,
                       line_budget: &mut usize,
                       last_relative_path: &mut Option<String>,
                       last_processed_line: &mut usize| {
        if rendered.is_empty() {
            return;
        }

        if let Some(path) = last_relative_path.take() {
            batches.push(JournalBatch {
                journal_context: rendered.join("\n\n"),
                last_relative_path: path,
                last_processed_line: *last_processed_line,
            });
        }

        rendered.clear();
        *line_budget = 0;
        *last_processed_line = 0;
    };

    for slice in slices {
        let body_lines = slice.content.lines().collect::<Vec<_>>();
        if body_lines.is_empty() {
            continue;
        }

        let mut offset = 0usize;
        while offset < body_lines.len() {
            if line_budget >= MAX_JOURNAL_CONTEXT_LINES {
                flush_batch(
                    &mut batches,
                    &mut rendered,
                    &mut line_budget,
                    &mut last_relative_path,
                    &mut last_processed_line,
                );
            }

            let remaining = MAX_JOURNAL_CONTEXT_LINES.saturating_sub(line_budget);
            if remaining == 0 {
                continue;
            }

            let take = remaining.min(body_lines.len() - offset);
            let chunk_start_line = slice.start_line + offset;
            let chunk_end_line = chunk_start_line + take - 1;

            rendered.push(format!(
                "### {} (lines {}-{})\n{}",
                slice.relative_path,
                chunk_start_line,
                chunk_end_line,
                body_lines[offset..offset + take].join("\n")
            ));
            line_budget += take;
            last_relative_path = Some(slice.relative_path.clone());
            last_processed_line = chunk_end_line;
            offset += take;

            if line_budget >= MAX_JOURNAL_CONTEXT_LINES {
                flush_batch(
                    &mut batches,
                    &mut rendered,
                    &mut line_budget,
                    &mut last_relative_path,
                    &mut last_processed_line,
                );
            }
        }
    }

    flush_batch(
        &mut batches,
        &mut rendered,
        &mut line_budget,
        &mut last_relative_path,
        &mut last_processed_line,
    );

    batches
}

fn next_daily_wake_duration() -> Duration {
    let wake_at = next_daily_wake_instant(Local::now());
    let delta_ms = wake_at
        .timestamp_millis()
        .saturating_sub(Local::now().timestamp_millis())
        .max(0) as u64;
    Duration::from_millis(delta_ms)
}

fn startup_catch_up_delay() -> Duration {
    Duration::from_secs(STARTUP_CATCH_UP_DELAY_SECS)
}

fn should_run_startup_catch_up(
    last_completed_at_ms: Option<i64>,
    now: chrono::DateTime<Local>,
) -> bool {
    let Some(last_completed_at_ms) = last_completed_at_ms else {
        return true;
    };

    let last_completed_at = Local
        .timestamp_millis_opt(last_completed_at_ms)
        .single()
        .unwrap_or(now);
    last_completed_at < most_recent_daily_wake_instant(now)
}

fn next_daily_wake_instant(now: chrono::DateTime<Local>) -> chrono::DateTime<Local> {
    let target_today = daily_wake_instant(now.date_naive());
    if now < target_today {
        return target_today;
    }

    now.date_naive()
        .succ_opt()
        .map(daily_wake_instant)
        .unwrap_or(target_today)
}

fn most_recent_daily_wake_instant(now: chrono::DateTime<Local>) -> chrono::DateTime<Local> {
    let target_today = daily_wake_instant(now.date_naive());
    if now >= target_today {
        target_today
    } else {
        now.date_naive()
            .pred_opt()
            .map(daily_wake_instant)
            .unwrap_or(target_today)
    }
}

fn daily_wake_instant(date: chrono::NaiveDate) -> chrono::DateTime<Local> {
    let Some(naive) = date.and_hms_opt(
        DEFAULT_DAILY_WAKE_HOUR_LOCAL,
        DEFAULT_DAILY_WAKE_MINUTE_LOCAL,
        0,
    ) else {
        return Local::now();
    };

    let local_result = Local.from_local_datetime(&naive);
    local_result
        .single()
        .or_else(|| local_result.earliest())
        .or_else(|| local_result.latest())
        .unwrap_or_else(Local::now)
}

pub fn get_global_memory_consolidation_service() -> Option<Arc<MemoryConsolidationService>> {
    GLOBAL_MEMORY_CONSOLIDATION_SERVICE.get().cloned()
}

pub fn set_global_memory_consolidation_service(service: Arc<MemoryConsolidationService>) {
    let _ = GLOBAL_MEMORY_CONSOLIDATION_SERVICE.set(service);
}

#[cfg(test)]
mod tests {
    use super::{
        build_journal_batches, should_run_startup_catch_up, JournalSlice, MAX_JOURNAL_CONTEXT_LINES,
    };
    use chrono::TimeZone;

    #[test]
    fn splits_single_large_slice_into_multiple_batches() {
        let content = (1..=400)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        let slices = vec![JournalSlice {
            relative_path: "logs/2026-05-07.jsonl".to_string(),
            start_line: 1,
            content,
        }];

        let batches = build_journal_batches(&slices);

        assert_eq!(batches.len(), 2);
        assert_eq!(batches[0].last_relative_path, "logs/2026-05-07.jsonl");
        assert_eq!(batches[0].last_processed_line, MAX_JOURNAL_CONTEXT_LINES);
        assert_eq!(batches[1].last_relative_path, "logs/2026-05-07.jsonl");
        assert_eq!(batches[1].last_processed_line, 400);
    }

    #[test]
    fn carries_cursor_across_multiple_files() {
        let slices = vec![
            JournalSlice {
                relative_path: "logs/2026-05-07.jsonl".to_string(),
                start_line: 11,
                content: (11..=210)
                    .map(|line| format!("day1 line {line}"))
                    .collect::<Vec<_>>()
                    .join("\n"),
            },
            JournalSlice {
                relative_path: "logs/2026-05-08.jsonl".to_string(),
                start_line: 1,
                content: (1..=180)
                    .map(|line| format!("day2 line {line}"))
                    .collect::<Vec<_>>()
                    .join("\n"),
            },
        ];

        let batches = build_journal_batches(&slices);

        assert_eq!(batches.len(), 2);
        assert_eq!(batches[0].last_relative_path, "logs/2026-05-08.jsonl");
        assert_eq!(batches[0].last_processed_line, 120);
        assert_eq!(batches[1].last_relative_path, "logs/2026-05-08.jsonl");
        assert_eq!(batches[1].last_processed_line, 180);
    }

    #[test]
    fn startup_catch_up_runs_when_last_completion_is_before_latest_schedule() {
        let now = chrono::Local
            .with_ymd_and_hms(2026, 5, 7, 10, 0, 0)
            .single()
            .expect("valid local datetime");
        let last_completed = chrono::Local
            .with_ymd_and_hms(2026, 5, 7, 2, 0, 0)
            .single()
            .expect("valid local datetime")
            .timestamp_millis();

        assert!(should_run_startup_catch_up(Some(last_completed), now));
    }

    #[test]
    fn startup_catch_up_skips_when_last_completion_is_current() {
        let now = chrono::Local
            .with_ymd_and_hms(2026, 5, 7, 10, 0, 0)
            .single()
            .expect("valid local datetime");
        let last_completed = chrono::Local
            .with_ymd_and_hms(2026, 5, 7, 4, 0, 0)
            .single()
            .expect("valid local datetime")
            .timestamp_millis();

        assert!(!should_run_startup_catch_up(Some(last_completed), now));
    }
}
