use super::prompt::build_daily_letter_user_prompt;
use super::store::{
    daily_letter_markdown_path, daily_letter_record_id, get_daily_letter, list_daily_letters,
    load_daily_letter_record, load_daily_letter_state, path_string, resolve_request_scope,
    save_daily_letter_record, save_daily_letter_state,
};
use super::types::{
    DailyLetterAgentOutput, DailyLetterAgentResult, DailyLetterAppOpportunity,
    DailyLetterApplyReceiptsRequest, DailyLetterAttemptStatus, DailyLetterContextPacket,
    DailyLetterContinuationCard, DailyLetterGenerateRequest,
    DailyLetterGetRequest, DailyLetterListRequest, DailyLetterPreview, DailyLetterReceiptAction,
    DailyLetterReceiptCandidate, DailyLetterReceiptStatus, DailyLetterRecord,
    DailyLetterRecordStatus, DailyLetterRunSummary, DailyLetterScope, DailyLetterSealRequest,
    DailyLetterSourceFragment, DailyLetterSourceFragmentType, DailyLetterSourceStats,
    DailyLetterState, DailyLetterTrigger, DailyLetterUpdateContinuationRequest,
    DailyLetterWorkspaceRef,
};
use crate::agentic::coordination::get_global_coordinator;
use crate::agentic::memory::store::{
    ensure_memory_store_for_target, memory_journal_file_path_for_date, MemoryStoreTarget,
};
use crate::agentic_os::work::{default_work_store, WorkScope};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::get_path_manager_arc;
use crate::service::config::get_app_language_code;
use crate::util::extract_json_from_ai_response;
use chrono::{Datelike, Duration as ChronoDuration, Local, LocalResult, NaiveDate, TimeZone};
use log::{info, warn};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::{Mutex, Notify};
use tokio::time::Duration;

const AUTO_WAKE_HOUR_LOCAL: u32 = 21;
const AUTO_WAKE_MINUTE_LOCAL: u32 = 30;
const STARTUP_CATCH_UP_DELAY_SECS: u64 = 30;
const MAX_SESSION_SUMMARIES: usize = 12;
const MAX_WORK_FRAGMENTS: usize = 8;
const MAX_MEMORY_FRAGMENTS: usize = 4;
const MAX_FRAGMENT_CHARS: usize = 2200;
const MAX_RECEIPT_CANDIDATES: usize = 5;
const MAX_CONTINUATION_CARDS: usize = 5;
const IDLE_OPPORTUNITY_DELAY_SECS: u64 = 75;
const STALE_RUNNING_ATTEMPT_AFTER_MS: i64 = 20 * 60 * 1000;

static GLOBAL_DAILY_LETTER_SERVICE: OnceLock<Arc<DailyLetterService>> = OnceLock::new();

pub struct DailyLetterService {
    state: Mutex<DailyLetterState>,
    wake_notify: Notify,
    started: AtomicBool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MemoryJournalRecord {
    time: String,
    #[serde(rename = "type")]
    memory_type: String,
    content: String,
    session_id: String,
}

impl DailyLetterService {
    pub async fn new() -> CoreResult<Arc<Self>> {
        let mut state = load_daily_letter_state(DailyLetterScope::AgenticOs, None).await?;
        if matches!(
            state.last_attempt_status,
            Some(DailyLetterAttemptStatus::Running)
        ) {
            warn!(
                "Recovering interrupted daily letter run on startup: active_date={:?}, active_record_id={:?}",
                state.active_date, state.active_record_id
            );
            mark_daily_letter_run_interrupted(
                &mut state,
                "Previous daily letter run was interrupted before completion",
            );
            save_daily_letter_state(DailyLetterScope::AgenticOs, None, &state).await?;
        }
        Ok(Arc::new(Self {
            state: Mutex::new(state),
            wake_notify: Notify::new(),
            started: AtomicBool::new(false),
        }))
    }

    pub fn start(self: &Arc<Self>) {
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }

        info!(
            "Daily letter service started: auto_wake_hour_local={}, auto_wake_minute_local={}",
            AUTO_WAKE_HOUR_LOCAL, AUTO_WAKE_MINUTE_LOCAL
        );

        let catch_up_service = Arc::clone(self);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(STARTUP_CATCH_UP_DELAY_SECS)).await;
            if let Err(error) = catch_up_service.run_auto_if_due().await {
                warn!("Daily letter startup catch-up failed: {}", error);
            }
        });

        let service = Arc::clone(self);
        tokio::spawn(async move {
            service.run_loop().await;
        });
    }

    pub async fn list(
        &self,
        request: DailyLetterListRequest,
    ) -> CoreResult<Vec<DailyLetterRecord>> {
        list_daily_letters(request).await
    }

    pub async fn get(
        &self,
        request: DailyLetterGetRequest,
    ) -> CoreResult<Option<DailyLetterRecord>> {
        get_daily_letter(request).await
    }

    pub async fn run_now(
        &self,
        request: DailyLetterGenerateRequest,
    ) -> CoreResult<DailyLetterRunSummary> {
        self.run_once(request, DailyLetterTrigger::Manual).await
    }

    pub async fn apply_receipts(
        &self,
        request: DailyLetterApplyReceiptsRequest,
    ) -> CoreResult<DailyLetterRecord> {
        if request.decisions.is_empty() {
            return Err(CoreError::validation(
                "At least one receipt decision is required",
            ));
        }

        let scope =
            resolve_record_request_scope(&request.record_id, request.workspace_path.as_deref());
        let workspace_path = request.workspace_path.as_deref().map(Path::new);
        let mut record = get_daily_letter(DailyLetterGetRequest {
            id: Some(request.record_id.clone()),
            date: None,
            scope: Some(scope),
            workspace_path: request.workspace_path.clone(),
        })
        .await?
        .ok_or_else(|| CoreError::validation("Daily letter record was not found"))?;

        let now_ms = now_ms();
        for decision in &request.decisions {
            let Some(candidate) = record
                .receipt_candidates
                .iter_mut()
                .find(|item| item.id == decision.candidate_id)
            else {
                return Err(CoreError::validation(format!(
                    "Receipt candidate was not found: {}",
                    decision.candidate_id
                )));
            };

            match decision.action {
                DailyLetterReceiptAction::Dismiss => {
                    candidate.status = DailyLetterReceiptStatus::Dismissed;
                    candidate.decided_at_ms = Some(now_ms);
                }
                DailyLetterReceiptAction::Accept | DailyLetterReceiptAction::Edit => {
                    let final_text = decision
                        .final_text
                        .as_deref()
                        .unwrap_or(candidate.text.as_str())
                        .trim()
                        .to_string();
                    if final_text.is_empty() {
                        return Err(CoreError::validation(
                            "Accepted receipt memory content cannot be empty",
                        ));
                    }
                    let journal_path =
                        append_receipt_memory(scope, workspace_path, &record.id, &final_text)
                            .await?;
                    candidate.status = match decision.action {
                        DailyLetterReceiptAction::Accept => DailyLetterReceiptStatus::Accepted,
                        DailyLetterReceiptAction::Edit => DailyLetterReceiptStatus::Edited,
                        DailyLetterReceiptAction::Dismiss => DailyLetterReceiptStatus::Dismissed,
                    };
                    candidate.final_text = Some(final_text);
                    candidate.memory_journal_path = Some(path_string(journal_path));
                    candidate.decided_at_ms = Some(now_ms);
                }
            }
        }

        record.status = next_record_status(&record);
        record.updated_at_ms = now_ms;
        save_daily_letter_record(&record).await?;
        Ok(record)
    }

    pub async fn seal(&self, request: DailyLetterSealRequest) -> CoreResult<DailyLetterRecord> {
        let scope =
            resolve_record_request_scope(&request.record_id, request.workspace_path.as_deref());
        let mut record = get_daily_letter(DailyLetterGetRequest {
            id: Some(request.record_id.clone()),
            date: None,
            scope: Some(scope),
            workspace_path: request.workspace_path.clone(),
        })
        .await?
        .ok_or_else(|| CoreError::validation("Daily letter record was not found"))?;

        if record
            .receipt_candidates
            .iter()
            .any(|item| item.status == DailyLetterReceiptStatus::Pending)
        {
            return Err(CoreError::validation(
                "Daily letter still has pending receipt candidates",
            ));
        }

        record.status = DailyLetterRecordStatus::Sealed;
        record.updated_at_ms = now_ms();
        save_daily_letter_record(&record).await?;
        Ok(record)
    }

    pub async fn update_continuation(
        &self,
        request: DailyLetterUpdateContinuationRequest,
    ) -> CoreResult<DailyLetterRecord> {
        let scope =
            resolve_record_request_scope(&request.record_id, request.workspace_path.as_deref());
        let mut record = get_daily_letter(DailyLetterGetRequest {
            id: Some(request.record_id.clone()),
            date: None,
            scope: Some(scope),
            workspace_path: request.workspace_path.clone(),
        })
        .await?
        .ok_or_else(|| CoreError::validation("Daily letter record was not found"))?;

        let Some(card) = record
            .continuation_cards
            .iter_mut()
            .find(|item| item.id == request.continuation_id)
        else {
            return Err(CoreError::validation(format!(
                "Continuation card was not found: {}",
                request.continuation_id
            )));
        };

        card.remind_tomorrow = request.remind_tomorrow;
        record.updated_at_ms = now_ms();
        save_daily_letter_record(&record).await?;
        Ok(record)
    }

    pub async fn state_snapshot(&self) -> DailyLetterState {
        self.state.lock().await.clone()
    }

    pub fn notify_idle_opportunity(self: &Arc<Self>) {
        let service = Arc::clone(self);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(IDLE_OPPORTUNITY_DELAY_SECS)).await;
            if let Err(error) = service.run_auto_if_due().await {
                warn!("Daily letter idle opportunity failed: {}", error);
            }
        });
    }

    async fn run_loop(self: Arc<Self>) {
        loop {
            let next_delay = next_auto_wake_duration();
            tokio::select! {
                _ = tokio::time::sleep(next_delay) => {}
                _ = self.wake_notify.notified() => {}
            }

            if let Err(error) = self.run_auto_if_due().await {
                warn!("Daily letter scheduled run failed: {}", error);
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
        }
    }

    async fn run_auto_if_due(&self) -> CoreResult<()> {
        let today = today_local_date_key();
        let mut state = self.state.lock().await;
        if matches!(
            state.last_attempt_status,
            Some(DailyLetterAttemptStatus::Running)
        ) {
            if is_stale_daily_letter_run(&state) {
                warn!(
                    "Clearing stale daily letter run before auto generation: active_date={:?}, active_record_id={:?}",
                    state.active_date, state.active_record_id
                );
                mark_daily_letter_run_interrupted(
                    &mut state,
                    "Previous daily letter run expired before completion",
                );
                save_daily_letter_state(DailyLetterScope::AgenticOs, None, &state).await?;
            } else {
                info!("Daily letter auto run skipped because a letter run is already active");
                return Ok(());
            }
        }
        if state.last_completed_date.as_deref() == Some(today.as_str()) {
            return Ok(());
        }
        drop(state);

        let _ = self
            .run_once(
                DailyLetterGenerateRequest {
                    date: Some(today),
                    scope: Some(DailyLetterScope::AgenticOs),
                    workspace_path: None,
                    force: false,
                },
                DailyLetterTrigger::Auto,
            )
            .await?;
        Ok(())
    }

    async fn run_once(
        &self,
        request: DailyLetterGenerateRequest,
        trigger: DailyLetterTrigger,
    ) -> CoreResult<DailyLetterRunSummary> {
        let scope = resolve_request_scope(request.scope, request.workspace_path.as_deref());
        let workspace_path = request.workspace_path.as_deref().map(Path::new);
        let date = request.date.unwrap_or_else(today_local_date_key);
        validate_date_key(&date)?;

        if !request.force {
            if let Some(record) = load_daily_letter_record(&date, scope, workspace_path).await? {
                return Ok(DailyLetterRunSummary {
                    started: false,
                    trigger,
                    date: Some(date),
                    record: Some(record),
                    reason: Some("Daily letter already exists for this date".to_string()),
                });
            }
        }

        {
            let mut state = self.state.lock().await;
            if matches!(
                state.last_attempt_status,
                Some(DailyLetterAttemptStatus::Running)
            ) {
                if is_stale_daily_letter_run(&state) {
                    warn!(
                        "Clearing stale daily letter run before manual generation: active_date={:?}, active_record_id={:?}",
                        state.active_date, state.active_record_id
                    );
                    mark_daily_letter_run_interrupted(
                        &mut state,
                        "Previous daily letter run expired before completion",
                    );
                } else {
                    return Ok(DailyLetterRunSummary {
                        started: false,
                        trigger,
                        date: Some(date),
                        record: None,
                        reason: Some("A daily letter run is already active".to_string()),
                    });
                }
            }
            state.active_date = Some(date.clone());
            state.active_record_id = Some(daily_letter_record_id(&date, scope, workspace_path));
            state.last_attempted_date = Some(date.clone());
            state.last_attempt_started_at_ms = Some(now_ms());
            state.last_attempt_finished_at_ms = None;
            state.last_attempt_status = Some(DailyLetterAttemptStatus::Running);
            state.last_attempt_trigger = Some(trigger.clone());
            state.last_error = None;
            save_daily_letter_state(scope, workspace_path, &state).await?;
        }

        let result: CoreResult<Option<DailyLetterRecord>> = async {
            let packet = build_context_packet(&date, scope, workspace_path).await?;
            if !has_high_signal_fragment(&packet) && matches!(trigger, DailyLetterTrigger::Auto) {
                return Ok(None);
            }

            let record = if !has_high_signal_fragment(&packet) {
                build_insufficient_context_record(&packet)
            } else {
                let output = generate_letter_with_ai(&packet).await?;
                build_record_from_agent_output(&packet, output)?
            };
            save_daily_letter_record(&record).await?;
            Ok(Some(record))
        }
        .await;

        match result {
            Ok(Some(record)) => {
                let mut state = self.state.lock().await;
                state.last_attempt_finished_at_ms = Some(now_ms());
                state.last_attempt_status = Some(DailyLetterAttemptStatus::Ok);
                state.last_error = None;
                state.last_completed_date = Some(date.clone());
                state.active_date = None;
                state.active_record_id = None;
                state.next_auto_run_not_before_ms = Some(next_auto_wake_timestamp_ms());
                save_daily_letter_state(scope, workspace_path, &state).await?;
                self.wake_notify.notify_one();
                Ok(DailyLetterRunSummary {
                    started: true,
                    trigger,
                    date: Some(date),
                    record: Some(record),
                    reason: None,
                })
            }
            Ok(None) => {
                let mut state = self.state.lock().await;
                state.last_attempt_finished_at_ms = Some(now_ms());
                state.last_attempt_status = Some(DailyLetterAttemptStatus::SkippedNoSources);
                state.last_error = None;
                state.active_date = None;
                state.active_record_id = None;
                state.next_auto_run_not_before_ms = Some(next_auto_wake_timestamp_ms());
                save_daily_letter_state(scope, workspace_path, &state).await?;
                self.wake_notify.notify_one();
                Ok(DailyLetterRunSummary {
                    started: false,
                    trigger,
                    date: Some(date),
                    record: None,
                    reason: Some("No authorized daily context was available".to_string()),
                })
            }
            Err(error) => {
                let mut state = self.state.lock().await;
                state.last_attempt_finished_at_ms = Some(now_ms());
                state.last_attempt_status = Some(DailyLetterAttemptStatus::Error);
                state.last_error = Some(error.to_string());
                state.active_date = None;
                state.active_record_id = None;
                save_daily_letter_state(scope, workspace_path, &state).await?;
                self.wake_notify.notify_one();
                Err(error)
            }
        }
    }
}

pub fn install_global_daily_letter_service(service: Arc<DailyLetterService>) -> Result<(), ()> {
    GLOBAL_DAILY_LETTER_SERVICE.set(service).map_err(|_| ())
}

pub fn get_global_daily_letter_service() -> Option<Arc<DailyLetterService>> {
    GLOBAL_DAILY_LETTER_SERVICE.get().cloned()
}

fn resolve_record_request_scope(record_id: &str, workspace_path: Option<&str>) -> DailyLetterScope {
    if workspace_path
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        DailyLetterScope::Workspace
    } else if record_id.contains("agentic-os") {
        DailyLetterScope::AgenticOs
    } else {
        DailyLetterScope::Workspace
    }
}

async fn build_context_packet(
    date: &str,
    scope: DailyLetterScope,
    workspace_path: Option<&Path>,
) -> CoreResult<DailyLetterContextPacket> {
    let locale = get_app_language_code().await;
    let workspace = workspace_path.map(workspace_ref_for_path);

    let mut fragments = Vec::new();
    fragments.extend(collect_exploration_target_fragments(date, scope, workspace_path).await?);
    fragments.extend(collect_session_summary_fragments(date, scope, workspace_path).await?);
    fragments.extend(collect_work_fragments(date, scope, workspace_path).await?);
    fragments.extend(collect_git_fragments(date, workspace_path).await?);

    let memory_context = collect_memory_context_fragments(scope, workspace_path).await?;
    let user_preferences = memory_context
        .iter()
        .filter(|fragment| fragment.title.contains("USER"))
        .map(|fragment| {
            format!(
                "Read {} for durable user expression and work-style preferences.",
                fragment.id
            )
        })
        .take(4)
        .collect::<Vec<_>>();

    let source_stats = DailyLetterSourceStats {
        session_summary_count: fragments
            .iter()
            .filter(|item| item.fragment_type == DailyLetterSourceFragmentType::SessionSummary)
            .count(),
        event_count: fragments
            .iter()
            .filter(|item| item.fragment_type == DailyLetterSourceFragmentType::Event)
            .count(),
        work_count: fragments
            .iter()
            .filter(|item| item.fragment_type == DailyLetterSourceFragmentType::Work)
            .count(),
        command_count: fragments
            .iter()
            .filter(|item| item.fragment_type == DailyLetterSourceFragmentType::Command)
            .count(),
        memory_file_count: memory_context.len(),
        git_signal_count: fragments
            .iter()
            .filter(|item| item.fragment_type == DailyLetterSourceFragmentType::Git)
            .count(),
        explicit_count: fragments
            .iter()
            .filter(|item| item.fragment_type == DailyLetterSourceFragmentType::Explicit)
            .count(),
        fragment_count: fragments.len() + memory_context.len(),
    };

    Ok(DailyLetterContextPacket {
        date: date.to_string(),
        locale,
        scope,
        workspace,
        source_stats,
        fragments,
        memory_context,
        user_preferences,
    })
}

fn workspace_ref_for_path(path: &Path) -> DailyLetterWorkspaceRef {
    let path_manager = get_path_manager_arc();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Workspace")
        .to_string();
    DailyLetterWorkspaceRef {
        id: path_manager.workspace_runtime_id(path),
        name,
        path: path_string(path),
    }
}

async fn collect_exploration_target_fragments(
    date: &str,
    scope: DailyLetterScope,
    workspace_path: Option<&Path>,
) -> CoreResult<Vec<DailyLetterSourceFragment>> {
    let path_manager = get_path_manager_arc();
    let mut fragments = Vec::new();

    let session_roots = session_exploration_roots(scope, workspace_path).await?;
    for (index, root) in session_roots.into_iter().enumerate() {
        push_path_fragment(
            &mut fragments,
            format!("event-stream-{}", index + 1),
            DailyLetterSourceFragmentType::Event,
            format!("Session event stream {}", index + 1),
            format!(
                "Explore session turns, metadata, and model/tool event files under this runtime root for {}. Prefer daily_summaries first, then turns/*.json only when needed.",
                date
            ),
            root,
            0.72,
        );
    }

    let command_roots = command_exploration_roots(scope, workspace_path).await?;
    for (index, root) in command_roots.into_iter().enumerate() {
        push_path_fragment(
            &mut fragments,
            format!("command-summary-{}", index + 1),
            DailyLetterSourceFragmentType::Command,
            format!("Command and tool summaries {}", index + 1),
            format!(
                "Use Grep/Glob under this runtime root to find command, tool, terminal, and execution result summaries for {}. Keep only concise evidence.",
                date
            ),
            root,
            0.7,
        );
    }

    let explicit_root = match scope {
        DailyLetterScope::AgenticOs => path_manager
            .agentic_os_runtime_root()
            .join("daily_letters")
            .join("inbox"),
        DailyLetterScope::Workspace => {
            let Some(path) = workspace_path else {
                return Ok(fragments);
            };
            path_manager
                .project_root(path)
                .join("daily_letters")
                .join("inbox")
        }
    };
    push_path_fragment(
        &mut fragments,
        "explicit-daily-letter-inbox".to_string(),
        DailyLetterSourceFragmentType::Explicit,
        "Explicitly added daily letter snippets".to_string(),
        format!(
            "Read snippets the user explicitly placed in today's Daily Letter inbox for {}.",
            date
        ),
        explicit_root,
        0.9,
    );

    Ok(fragments)
}

async fn session_exploration_roots(
    scope: DailyLetterScope,
    workspace_path: Option<&Path>,
) -> CoreResult<Vec<PathBuf>> {
    let path_manager = get_path_manager_arc();
    match scope {
        DailyLetterScope::AgenticOs => {
            let mut roots = vec![path_manager.agentic_os_runtime_root().join("sessions")];
            let workspaces_root = path_manager.workspaces_runtime_root();
            if workspaces_root.exists() {
                roots.push(workspaces_root);
            }
            Ok(roots)
        }
        DailyLetterScope::Workspace => {
            let Some(path) = workspace_path else {
                return Ok(Vec::new());
            };
            Ok(vec![path_manager.workspace_sessions_dir(path)])
        }
    }
}

async fn command_exploration_roots(
    scope: DailyLetterScope,
    workspace_path: Option<&Path>,
) -> CoreResult<Vec<PathBuf>> {
    let path_manager = get_path_manager_arc();
    let mut roots = session_exploration_roots(scope, workspace_path).await?;
    roots.push(path_manager.agentic_os_runtime_root().join("works"));
    roots.push(path_manager.agentic_os_work_runtimes_dir());
    Ok(roots)
}

fn push_path_fragment(
    fragments: &mut Vec<DailyLetterSourceFragment>,
    id: String,
    fragment_type: DailyLetterSourceFragmentType,
    title: String,
    summary: String,
    path: PathBuf,
    confidence: f32,
) {
    if !path.exists() {
        return;
    }
    fragments.push(DailyLetterSourceFragment {
        id,
        fragment_type,
        title,
        summary,
        evidence_label: Some(path_string(&path)),
        source_path: Some(path_string(path)),
        confidence,
    });
}

async fn collect_session_summary_fragments(
    date: &str,
    scope: DailyLetterScope,
    workspace_path: Option<&Path>,
) -> CoreResult<Vec<DailyLetterSourceFragment>> {
    let source_paths = collect_session_daily_summary_sources(date, scope, workspace_path).await?;
    let mut fragments = Vec::new();
    for (index, path) in source_paths
        .into_iter()
        .take(MAX_SESSION_SUMMARIES)
        .enumerate()
    {
        fragments.push(DailyLetterSourceFragment {
            id: format!("session-summary-{}", index + 1),
            fragment_type: DailyLetterSourceFragmentType::SessionSummary,
            title: format!("Session summary {}", index + 1),
            summary: format!(
                "Daily summary file for {}. Read this sourcePath before citing it in the letter.",
                date
            ),
            evidence_label: Some(path_string(&path)),
            source_path: Some(path_string(path)),
            confidence: 0.86,
        });
    }
    Ok(fragments)
}

async fn collect_work_fragments(
    date: &str,
    scope: DailyLetterScope,
    workspace_path: Option<&Path>,
) -> CoreResult<Vec<DailyLetterSourceFragment>> {
    let store = match default_work_store() {
        Ok(store) => store,
        Err(error) => {
            warn!("Daily letter could not open work store: {}", error);
            return Ok(Vec::new());
        }
    };
    let records = store.list().await?;
    let target_date = parse_date_key(date)?;
    let mut fragments = Vec::new();
    for work in records {
        if fragments.len() >= MAX_WORK_FRAGMENTS {
            break;
        }
        if !work_matches_scope(&work.scope, scope, workspace_path) {
            continue;
        }
        if local_date_from_ms(work.updated_at) != Some(target_date) {
            continue;
        }
        let mut summary = format!(
            "Work: {}\nStatus: {:?}\nObjective: {}",
            work.title, work.status, work.objective
        );
        if let Some(work_summary) = work.summary.as_ref() {
            summary.push_str(&format!("\nSummary: {}", work_summary.text));
        }
        if let Some(last_event) = work.lifecycle.events.last() {
            summary.push_str(&format!(
                "\nLast lifecycle event: {:?} ({})",
                last_event.status, last_event.label
            ));
        }
        fragments.push(DailyLetterSourceFragment {
            id: format!("work-{}", fragments.len() + 1),
            fragment_type: DailyLetterSourceFragmentType::Work,
            title: work.title,
            summary: truncate_chars(&summary, MAX_FRAGMENT_CHARS),
            evidence_label: Some(work.id.to_string()),
            source_path: Some(path_string(
                get_path_manager_arc()
                    .agentic_os_runtime_root()
                    .join("works")
                    .join(format!("{}.json", work.id.as_str())),
            )),
            confidence: 0.78,
        });
    }
    Ok(fragments)
}

fn work_matches_scope(
    scope: &WorkScope,
    target: DailyLetterScope,
    workspace_path: Option<&Path>,
) -> bool {
    match target {
        DailyLetterScope::AgenticOs => true,
        DailyLetterScope::Workspace => {
            let Some(expected) = workspace_path else {
                return false;
            };
            scope
                .workspace_path()
                .map(|value| paths_equal(Path::new(value), expected))
                .unwrap_or(false)
        }
    }
}

async fn collect_git_fragments(
    date: &str,
    workspace_path: Option<&Path>,
) -> CoreResult<Vec<DailyLetterSourceFragment>> {
    let Some(workspace_path) = workspace_path else {
        return Ok(Vec::new());
    };
    if !workspace_path.join(".git").exists() {
        return Ok(Vec::new());
    }

    let mut fragments = Vec::new();
    if let Some(log) = run_git(
        workspace_path,
        &[
            "log",
            "--since",
            date,
            "--until",
            &next_date_key(date)?,
            "--oneline",
            "--decorate",
            "-8",
        ],
    )
    .await
    {
        if !log.trim().is_empty() {
            fragments.push(DailyLetterSourceFragment {
                id: "git-log".to_string(),
                fragment_type: DailyLetterSourceFragmentType::Git,
                title: "Git commits".to_string(),
                summary: truncate_chars(&log, 1400),
                evidence_label: Some("git log".to_string()),
                source_path: None,
                confidence: 0.74,
            });
        }
    }
    if let Some(status) = run_git(workspace_path, &["status", "--short"]).await {
        if !status.trim().is_empty() {
            fragments.push(DailyLetterSourceFragment {
                id: "git-status".to_string(),
                fragment_type: DailyLetterSourceFragmentType::Git,
                title: "Git working tree".to_string(),
                summary: truncate_chars(&status, 1400),
                evidence_label: Some("git status --short".to_string()),
                source_path: None,
                confidence: 0.68,
            });
        }
    }
    Ok(fragments)
}

async fn collect_memory_context_fragments(
    scope: DailyLetterScope,
    workspace_path: Option<&Path>,
) -> CoreResult<Vec<DailyLetterSourceFragment>> {
    let memory_dir = match scope {
        DailyLetterScope::AgenticOs => get_path_manager_arc().agentic_os_memory_dir(),
        DailyLetterScope::Workspace => {
            let Some(path) = workspace_path else {
                return Ok(Vec::new());
            };
            get_path_manager_arc().workspace_memory_dir(path)
        }
    };
    let file_names = match scope {
        DailyLetterScope::AgenticOs => vec!["USER.md", "MEMORY.md", "MILESTONES.md"],
        DailyLetterScope::Workspace => vec!["MEMORY.md"],
    };
    let mut fragments = Vec::new();
    for file_name in file_names {
        if fragments.len() >= MAX_MEMORY_FRAGMENTS {
            break;
        }
        let path = memory_dir.join(file_name);
        if !path.exists() {
            continue;
        }
        fragments.push(DailyLetterSourceFragment {
            id: format!("memory-{}", fragments.len() + 1),
            fragment_type: DailyLetterSourceFragmentType::Memory,
            title: format!("Memory {}", file_name),
            summary: format!(
                "Long-term memory file {}. Read this sourcePath for durable user preferences and context before writing.",
                file_name
            ),
            evidence_label: Some(path_string(&path)),
            source_path: Some(path_string(path)),
            confidence: 0.7,
        });
    }
    Ok(fragments)
}

async fn generate_letter_with_ai(
    packet: &DailyLetterContextPacket,
) -> CoreResult<DailyLetterAgentOutput> {
    let user_prompt = build_daily_letter_user_prompt(packet)?;
    let workspace_path = packet
        .workspace
        .as_ref()
        .map(|workspace| workspace.path.clone())
        .unwrap_or_else(|| {
            get_path_manager_arc()
                .agentic_os_runtime_root()
                .to_string_lossy()
                .into_owned()
        });
    let coordinator = get_global_coordinator()
        .ok_or_else(|| CoreError::service("Conversation coordinator is not initialized"))?;
    let response_text = coordinator
        .execute_hidden_daily_letter_writer(
            &packet_record_key(packet),
            format!("Daily Letter {}", packet.date),
            workspace_path,
            user_prompt,
            None,
        )
        .await?;
    let json = extract_json_from_ai_response(&response_text).ok_or_else(|| {
        CoreError::parse("Daily letter writer response did not contain valid JSON")
    })?;
    serde_json::from_str::<DailyLetterAgentOutput>(&json).map_err(|error| {
        CoreError::parse(format!(
            "Failed to parse daily letter writer output: {}",
            error
        ))
    })
}

fn packet_record_key(packet: &DailyLetterContextPacket) -> String {
    daily_letter_record_id(
        &packet.date,
        packet.scope,
        packet
            .workspace
            .as_ref()
            .map(|workspace| Path::new(&workspace.path)),
    )
}

fn build_record_from_agent_output(
    packet: &DailyLetterContextPacket,
    output: DailyLetterAgentOutput,
) -> CoreResult<DailyLetterRecord> {
    let now = now_ms();
    let valid_source_ids = packet
        .fragments
        .iter()
        .chain(packet.memory_context.iter())
        .map(|fragment| fragment.id.as_str())
        .collect::<HashSet<_>>();
    let receipt_candidates = output
        .receipt_candidates
        .into_iter()
        .enumerate()
        .map(|(index, item)| DailyLetterReceiptCandidate {
            id: format!("receipt-{}", index + 1),
            text: item.text.trim().to_string(),
            reason: item.reason.map(|value| value.trim().to_string()),
            source_ids: filter_source_ids(item.source_ids, &valid_source_ids),
            status: DailyLetterReceiptStatus::Pending,
            final_text: None,
            memory_journal_path: None,
            decided_at_ms: None,
        })
        .filter(|item| !item.text.is_empty() && !item.source_ids.is_empty())
        .take(MAX_RECEIPT_CANDIDATES)
        .collect::<Vec<_>>();
    let continuation_cards = output
        .continuation_cards
        .into_iter()
        .enumerate()
        .map(|(index, item)| DailyLetterContinuationCard {
            id: format!("next-{}", index + 1),
            text: item.text.trim().to_string(),
            reason: item.reason.map(|value| value.trim().to_string()),
            source_ids: filter_source_ids(item.source_ids, &valid_source_ids),
            remind_tomorrow: false,
        })
        .filter(|item| !item.text.is_empty() && !item.source_ids.is_empty())
        .take(MAX_CONTINUATION_CARDS)
        .collect::<Vec<_>>();
    let app_opportunity = output
        .app_opportunity
        .map(|item| DailyLetterAppOpportunity {
            id: "app-opportunity-1".to_string(),
            title: item.title.trim().to_string(),
            summary: item.summary.trim().to_string(),
            source_ids: filter_source_ids(item.source_ids, &valid_source_ids),
        })
        .filter(|item| {
            !item.title.is_empty() && !item.summary.is_empty() && !item.source_ids.is_empty()
        });

    let mut record = DailyLetterRecord {
        id: daily_letter_record_id(
            &packet.date,
            packet.scope,
            packet.workspace.as_ref().map(|w| Path::new(&w.path)),
        ),
        date: packet.date.clone(),
        scope: packet.scope,
        workspace: packet.workspace.clone(),
        status: match output.result {
            DailyLetterAgentResult::Letter => DailyLetterRecordStatus::Ready,
            DailyLetterAgentResult::InsufficientContext => {
                DailyLetterRecordStatus::InsufficientContext
            }
        },
        preview: DailyLetterPreview {
            title: non_empty_or(
                output.preview.title.trim(),
                &format!("今日来信 · {}", packet.date),
            ),
            one_line: non_empty_or(output.preview.one_line.trim(), "今天的线索已经为你收好。"),
            receipt_count: receipt_candidates.len(),
            continuation_count: continuation_cards.len(),
            app_idea_count: usize::from(app_opportunity.is_some()),
        },
        body_markdown: non_empty_or(
            output.body_markdown.trim(),
            "今天的上下文比较轻，我先把能确认的部分留在这里。",
        ),
        receipt_candidates,
        continuation_cards,
        app_opportunity,
        created_at_ms: now,
        updated_at_ms: now,
    };
    record.status = next_record_status(&record);
    validate_daily_letter_record(&packet, &record)?;
    Ok(record)
}

fn has_high_signal_fragment(packet: &DailyLetterContextPacket) -> bool {
    packet
        .fragments
        .iter()
        .chain(packet.memory_context.iter())
        .any(|fragment| {
            fragment.confidence >= 0.7
                && (!fragment.summary.trim().is_empty() || fragment.source_path.is_some())
        })
}

fn validate_daily_letter_record(
    packet: &DailyLetterContextPacket,
    record: &DailyLetterRecord,
) -> CoreResult<()> {
    if matches!(record.status, DailyLetterRecordStatus::InsufficientContext) {
        return Ok(());
    }

    if !has_high_signal_fragment(packet) {
        return Err(CoreError::validation(
            "Daily letter requires at least one high-signal source fragment",
        ));
    }
    if record.preview.title.trim().is_empty() || record.preview.one_line.trim().is_empty() {
        return Err(CoreError::validation(
            "Daily letter preview title and oneLine are required",
        ));
    }
    if record.body_markdown.trim().chars().count() < 40 {
        return Err(CoreError::validation(
            "Daily letter body is too short to publish",
        ));
    }
    for candidate in &record.receipt_candidates {
        if candidate.source_ids.is_empty() {
            return Err(CoreError::validation(
                "Daily letter receipt candidates must include source ids",
            ));
        }
    }
    for card in &record.continuation_cards {
        if card.source_ids.is_empty() {
            return Err(CoreError::validation(
                "Daily letter continuation cards must include source ids",
            ));
        }
    }
    if let Some(app) = record.app_opportunity.as_ref() {
        if app.source_ids.is_empty() {
            return Err(CoreError::validation(
                "Daily letter app opportunity must include source ids",
            ));
        }
    }
    Ok(())
}

fn build_insufficient_context_record(packet: &DailyLetterContextPacket) -> DailyLetterRecord {
    let now = now_ms();
    let is_en = packet.locale == "en-US";
    DailyLetterRecord {
        id: daily_letter_record_id(
            &packet.date,
            packet.scope,
            packet.workspace.as_ref().map(|w| Path::new(&w.path)),
        ),
        date: packet.date.clone(),
        scope: packet.scope,
        workspace: packet.workspace.clone(),
        status: DailyLetterRecordStatus::InsufficientContext,
        preview: DailyLetterPreview {
            title: if is_en {
                format!("Daily Letter · {}", packet.date)
            } else {
                format!("今日来信 · {}", packet.date)
            },
            one_line: if is_en {
                "I do not have enough authorized context for today yet.".to_string()
            } else {
                "今天能看见的上下文还不多，我先把这封空白处留给你。".to_string()
            },
            receipt_count: 0,
            continuation_count: 0,
            app_idea_count: 0,
        },
        body_markdown: if is_en {
            "Today I do not have enough authorized context to write a useful letter. When more work, commands, memories, or explicit notes are available, I will turn them into a warmer summary here.".to_string()
        } else {
            "今天我能看见的上下文还不够多，所以不硬写成一份总结。\n\n等有新的会话摘要、工作状态、命令结果、Git 活动，或你主动加入今日来信的片段，我会把它们整理成一封更像信的回望。".to_string()
        },
        receipt_candidates: Vec::new(),
        continuation_cards: Vec::new(),
        app_opportunity: None,
        created_at_ms: now,
        updated_at_ms: now,
    }
}

fn next_record_status(record: &DailyLetterRecord) -> DailyLetterRecordStatus {
    if matches!(record.status, DailyLetterRecordStatus::InsufficientContext) {
        return DailyLetterRecordStatus::InsufficientContext;
    }
    if matches!(record.status, DailyLetterRecordStatus::Sealed) {
        return DailyLetterRecordStatus::Sealed;
    }
    if record
        .receipt_candidates
        .iter()
        .any(|item| item.status == DailyLetterReceiptStatus::Pending)
    {
        DailyLetterRecordStatus::NeedsReceipt
    } else {
        DailyLetterRecordStatus::Ready
    }
}

async fn append_receipt_memory(
    scope: DailyLetterScope,
    workspace_path: Option<&Path>,
    record_id: &str,
    content: &str,
) -> CoreResult<PathBuf> {
    let target = match scope {
        DailyLetterScope::AgenticOs => MemoryStoreTarget::GlobalAgenticOs,
        DailyLetterScope::Workspace => {
            let workspace = workspace_path.ok_or_else(|| {
                CoreError::validation("workspacePath is required for workspace receipt memory")
            })?;
            MemoryStoreTarget::WorkspaceProject(workspace)
        }
    };
    ensure_memory_store_for_target(target).await?;
    let now = Local::now();
    let record = MemoryJournalRecord {
        time: now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        memory_type: "daily_letter_receipt".to_string(),
        content: content.to_string(),
        session_id: format!("daily-letter:{record_id}"),
    };
    let journal_path = memory_journal_file_path_for_date(target, now.date_naive());
    if let Some(parent) = journal_path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let serialized = serde_json::to_string(&record)?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&journal_path)
        .await?;
    file.write_all(serialized.as_bytes()).await?;
    file.write_all(b"\n").await?;
    file.flush().await?;
    Ok(journal_path)
}

async fn collect_session_daily_summary_sources(
    date: &str,
    scope: DailyLetterScope,
    workspace_path: Option<&Path>,
) -> CoreResult<Vec<PathBuf>> {
    let target_file_name = format!("{date}.md");
    let path_manager = get_path_manager_arc();
    let roots = match scope {
        DailyLetterScope::AgenticOs => {
            let mut roots = vec![path_manager.agentic_os_runtime_root().join("sessions")];
            let workspaces_root = path_manager.workspaces_runtime_root();
            if workspaces_root.exists() {
                let mut entries = fs::read_dir(workspaces_root).await?;
                while let Some(entry) = entries.next_entry().await? {
                    roots.push(entry.path().join("sessions"));
                }
            }
            roots
        }
        DailyLetterScope::Workspace => {
            let Some(path) = workspace_path else {
                return Ok(Vec::new());
            };
            vec![path_manager.workspace_sessions_dir(path)]
        }
    };

    let mut result = Vec::new();
    for root in roots {
        collect_daily_summary_files_under(&root, &target_file_name, &mut result).await?;
    }
    result.sort();
    result.dedup();
    Ok(result)
}

async fn collect_daily_summary_files_under(
    sessions_dir: &Path,
    target_file_name: &str,
    result: &mut Vec<PathBuf>,
) -> CoreResult<()> {
    if !sessions_dir.exists() {
        return Ok(());
    }
    let mut session_entries = fs::read_dir(sessions_dir).await?;
    while let Some(session_entry) = session_entries.next_entry().await? {
        let daily_summaries_dir = session_entry.path().join("daily_summaries");
        if !daily_summaries_dir.exists() {
            continue;
        }
        let path = daily_summaries_dir.join(target_file_name);
        if path.exists() {
            result.push(path);
        }
    }
    Ok(())
}

async fn run_git(workspace_path: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(workspace_path);
    command.args(args);
    match tokio::time::timeout(Duration::from_secs(2), command.output()).await {
        Ok(Ok(output)) if output.status.success() => {
            Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
        }
        Ok(Ok(output)) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::debug!(
                "Daily letter git command returned non-zero status: args={:?} status={} stderr={}",
                args,
                output.status,
                stderr.trim()
            );
            None
        }
        Ok(Err(error)) => {
            log::debug!(
                "Daily letter git command failed: args={:?} error={}",
                args,
                error
            );
            None
        }
        Err(_) => {
            log::debug!("Daily letter git command timed out: args={:?}", args);
            None
        }
    }
}

fn filter_source_ids(source_ids: Vec<String>, valid: &HashSet<&str>) -> Vec<String> {
    source_ids
        .into_iter()
        .filter(|source_id| valid.contains(source_id.as_str()))
        .collect()
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.trim().to_string();
    }
    let mut out = value.chars().take(max_chars).collect::<String>();
    out.push_str("\n...");
    out
}

fn non_empty_or(value: &str, fallback: &str) -> String {
    if value.trim().is_empty() {
        fallback.to_string()
    } else {
        value.trim().to_string()
    }
}

fn validate_date_key(date: &str) -> CoreResult<()> {
    parse_date_key(date).map(|_| ())
}

fn parse_date_key(date: &str) -> CoreResult<NaiveDate> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|error| {
        CoreError::validation(format!("Invalid daily letter date {}: {}", date, error))
    })
}

fn next_date_key(date: &str) -> CoreResult<String> {
    Ok((parse_date_key(date)? + ChronoDuration::days(1))
        .format("%Y-%m-%d")
        .to_string())
}

fn local_date_from_ms(timestamp_ms: i64) -> Option<NaiveDate> {
    Local
        .timestamp_millis_opt(timestamp_ms)
        .single()
        .map(|value| value.date_naive())
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    let left = dunce::canonicalize(left).unwrap_or_else(|_| left.to_path_buf());
    let right = dunce::canonicalize(right).unwrap_or_else(|_| right.to_path_buf());
    left == right
}

fn is_stale_daily_letter_run(state: &DailyLetterState) -> bool {
    state
        .last_attempt_started_at_ms
        .map(|started_at_ms| {
            now_ms().saturating_sub(started_at_ms) > STALE_RUNNING_ATTEMPT_AFTER_MS
        })
        .unwrap_or(true)
}

fn mark_daily_letter_run_interrupted(state: &mut DailyLetterState, reason: &str) {
    state.last_attempt_finished_at_ms = Some(now_ms());
    state.last_attempt_status = Some(DailyLetterAttemptStatus::Cancelled);
    state.last_error = Some(reason.to_string());
    state.active_date = None;
    state.active_record_id = None;
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

fn today_local_date_key() -> String {
    Local::now().date_naive().format("%Y-%m-%d").to_string()
}

fn local_datetime(
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
) -> chrono::DateTime<Local> {
    match Local.with_ymd_and_hms(year, month, day, hour, minute, second) {
        LocalResult::Single(dt) => dt,
        LocalResult::Ambiguous(dt, _) => dt,
        LocalResult::None => Local::now(),
    }
}

fn next_auto_wake_duration() -> Duration {
    let now = Local::now();
    let today_wake = local_datetime(
        now.year(),
        now.month(),
        now.day(),
        AUTO_WAKE_HOUR_LOCAL,
        AUTO_WAKE_MINUTE_LOCAL,
        0,
    );
    let next_wake = if now < today_wake {
        today_wake
    } else {
        let tomorrow = now.date_naive() + ChronoDuration::days(1);
        local_datetime(
            tomorrow.year(),
            tomorrow.month(),
            tomorrow.day(),
            AUTO_WAKE_HOUR_LOCAL,
            AUTO_WAKE_MINUTE_LOCAL,
            0,
        )
    };
    let millis = (next_wake - now).num_milliseconds().max(0) as u64;
    Duration::from_millis(millis)
}

fn next_auto_wake_timestamp_ms() -> i64 {
    let duration = next_auto_wake_duration();
    now_ms().saturating_add(duration.as_millis().min(i64::MAX as u128) as i64)
}

pub fn global_daily_letters_output_dir() -> PathBuf {
    get_path_manager_arc()
        .agentic_os_runtime_root()
        .join("daily_letters")
}

pub fn global_daily_letter_markdown_path(date: &str) -> CoreResult<PathBuf> {
    daily_letter_markdown_path(date, DailyLetterScope::AgenticOs, None)
}
