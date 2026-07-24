use crate::agentic::coordination::get_global_coordinator;
use crate::agentic::memory::{
    get_global_memory_consolidation_service, ManualMemoryConsolidationRequest,
};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::get_path_manager_arc;
use crate::service::global_daily_report::state::{
    load_global_daily_report_state, GlobalDailyReportAttemptStatus,
};
use crate::service::global_milestone::{
    get_global_global_milestone_service,
    state::{load_global_milestone_state, GlobalMilestoneAttemptStatus, GlobalMilestoneTrigger},
};
use crate::service::host::{
    get_global_host_auto_scan_service,
    state::{load_host_scan_state, HostScanAttemptStatus, HostScanTrigger},
};
use crate::service::workspace_overview::{
    get_global_workspace_overview_auto_refresh_service,
    state::{
        load_workspace_overview_refresh_state, WorkspaceOverviewRefreshAttemptStatus,
        WorkspaceOverviewRefreshTrigger,
    },
};
use crate::service::{
    get_global_daily_letter_service, global_daily_letters_output_dir, DailyLetterAttemptStatus,
    DailyLetterGenerateRequest, DailyLetterScope, DailyLetterTrigger,
};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackgroundProcessKind {
    AutoMemoryExtraction,
    MemoryConsolidation,
    HostScan,
    WorkspaceOverviewRefresh,
    GlobalDailyReport,
    DailyLetter,
    GlobalMilestone,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackgroundProcessCategory {
    Memory,
    Workspace,
    Report,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackgroundProcessStatus {
    Idle,
    Disabled,
    Scheduled,
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Skipped,
    CoolingDown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackgroundProcessTrigger {
    Auto,
    Manual,
    StartupCatchUp,
    PostTurn,
    Retry,
    Scheduled,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackgroundProcessPhase {
    Idle,
    WaitingSchedule,
    WaitingRetry,
    Queued,
    RunningHiddenAgent,
    ScanningHost,
    RefreshingWorkspaceOverview,
    ConsolidatingMemory,
    ExtractingMemory,
    GeneratingReport,
    WritingDailyLetter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackgroundProcessAction {
    RunNow,
    Retry,
    OpenOutput,
    OpenSettings,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BackgroundProcessScope {
    System,
    Workspace { workspace_path: String },
    Session { session_id: String },
    Path { path: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundProcessOutputRef {
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundProcessLastResult {
    pub status: BackgroundProcessStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundProcess {
    pub id: String,
    pub kind: BackgroundProcessKind,
    pub category: BackgroundProcessCategory,
    pub title: String,
    pub status: BackgroundProcessStatus,
    pub scope: BackgroundProcessScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger: Option<BackgroundProcessTrigger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<BackgroundProcessPhase>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_result: Option<BackgroundProcessLastResult>,
    #[serde(default)]
    pub output_refs: Vec<BackgroundProcessOutputRef>,
    #[serde(default)]
    pub actions: Vec<BackgroundProcessAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundProcessList {
    pub generated_at: i64,
    pub processes: Vec<BackgroundProcess>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunBackgroundProcessRequest {
    pub kind: BackgroundProcessKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunBackgroundProcessResponse {
    pub kind: BackgroundProcessKind,
    pub started: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

pub async fn list_background_processes() -> CoreResult<BackgroundProcessList> {
    let mut processes = Vec::new();

    processes.push(host_scan_process().await?);
    processes.push(workspace_overview_process().await?);
    processes.push(memory_consolidation_process().await);
    processes.push(global_daily_report_process().await?);
    processes.push(daily_letter_process().await?);
    processes.push(global_milestone_process().await?);
    processes.extend(auto_memory_processes());

    processes.sort_by(process_order);
    Ok(BackgroundProcessList {
        generated_at: now_ms(),
        processes,
    })
}

pub async fn run_background_process(
    request: RunBackgroundProcessRequest,
) -> CoreResult<RunBackgroundProcessResponse> {
    match request.kind {
        BackgroundProcessKind::HostScan => {
            let service = get_global_host_auto_scan_service()
                .ok_or_else(|| CoreError::service("Host scan service is not initialized"))?;
            let summary = service.run_now().await?;
            Ok(RunBackgroundProcessResponse {
                kind: request.kind,
                started: summary.started,
                turn_id: summary.turn_id,
                reason: summary.reason,
            })
        }
        BackgroundProcessKind::WorkspaceOverviewRefresh => {
            let service =
                get_global_workspace_overview_auto_refresh_service().ok_or_else(|| {
                    CoreError::service("Workspace overview refresh service is not initialized")
                })?;
            let summary = service.run_now().await?;
            Ok(RunBackgroundProcessResponse {
                kind: request.kind,
                started: summary.started,
                turn_id: summary.turn_id,
                reason: summary.reason,
            })
        }
        BackgroundProcessKind::MemoryConsolidation => {
            let service = get_global_memory_consolidation_service().ok_or_else(|| {
                CoreError::service("Memory consolidation service is not initialized")
            })?;
            let snapshot = service.status_snapshot().await;
            if snapshot.active {
                return Ok(RunBackgroundProcessResponse {
                    kind: request.kind,
                    started: false,
                    turn_id: None,
                    reason: Some("Memory consolidation is already active".to_string()),
                });
            }
            let summary = service
                .run_now(ManualMemoryConsolidationRequest {
                    include_global: true,
                })
                .await?;
            Ok(RunBackgroundProcessResponse {
                kind: request.kind,
                started: summary.attempted_sources > 0,
                turn_id: None,
                reason: (summary.attempted_sources == 0)
                    .then(|| "No memory journals are ready for consolidation".to_string()),
            })
        }
        BackgroundProcessKind::GlobalMilestone => {
            let service = get_global_global_milestone_service()
                .ok_or_else(|| CoreError::service("Global milestone service is not initialized"))?;
            let summary = service.run_now().await?;
            Ok(RunBackgroundProcessResponse {
                kind: request.kind,
                started: summary.started,
                turn_id: summary.turn_id,
                reason: summary.reason,
            })
        }
        BackgroundProcessKind::DailyLetter => {
            let service = get_global_daily_letter_service()
                .ok_or_else(|| CoreError::service("Daily letter service is not initialized"))?;
            let summary = service
                .run_now(DailyLetterGenerateRequest {
                    date: None,
                    scope: Some(DailyLetterScope::AgenticOs),
                    workspace_path: None,
                    force: false,
                })
                .await?;
            Ok(RunBackgroundProcessResponse {
                kind: request.kind,
                started: summary.started,
                turn_id: None,
                reason: summary.reason,
            })
        }
        BackgroundProcessKind::AutoMemoryExtraction | BackgroundProcessKind::GlobalDailyReport => {
            Ok(RunBackgroundProcessResponse {
                kind: request.kind,
                started: false,
                turn_id: None,
                reason: Some("This process is managed by its scheduler".to_string()),
            })
        }
    }
}

async fn host_scan_process() -> CoreResult<BackgroundProcess> {
    let state = load_host_scan_state().await?;
    let output_path = get_path_manager_arc().agentic_os_host_overview_path();
    let status = attempt_status(
        state.last_attempt_status.as_ref().map(host_scan_status),
        state.next_auto_scan_not_before_ms,
        state.last_error.as_deref(),
    );

    Ok(BackgroundProcess {
        id: "host_scan".to_string(),
        kind: BackgroundProcessKind::HostScan,
        category: BackgroundProcessCategory::Workspace,
        title: "Host scan".to_string(),
        status,
        scope: BackgroundProcessScope::System,
        trigger: state.last_attempt_trigger.as_ref().map(host_scan_trigger),
        phase: phase_for_attempt_status(
            status,
            BackgroundProcessPhase::ScanningHost,
            state.next_auto_scan_not_before_ms,
        ),
        started_at: state.last_attempt_started_at_ms,
        finished_at: state.last_attempt_finished_at_ms,
        next_run_at: state.next_auto_scan_not_before_ms,
        active_turn_id: state.active_auto_turn_id.clone(),
        active_session_id: None,
        last_error: state.last_error.clone(),
        last_result: terminal_result(
            state.last_attempt_status.as_ref().map(host_scan_status),
            state.last_attempt_finished_at_ms,
            state.last_error.clone(),
        ),
        output_refs: vec![BackgroundProcessOutputRef {
            label: "Host overview".to_string(),
            path: Some(path_string(output_path)),
            uri: None,
        }],
        actions: actions_for_status(status),
    })
}

async fn workspace_overview_process() -> CoreResult<BackgroundProcess> {
    let state = load_workspace_overview_refresh_state().await?;
    let output_path = get_path_manager_arc().agentic_os_workspaces_overview_dir();
    let status = attempt_status(
        state
            .last_attempt_status
            .as_ref()
            .map(workspace_overview_status),
        state.next_auto_refresh_not_before_ms,
        state.last_error.as_deref(),
    );

    Ok(BackgroundProcess {
        id: "workspace_overview_refresh".to_string(),
        kind: BackgroundProcessKind::WorkspaceOverviewRefresh,
        category: BackgroundProcessCategory::Workspace,
        title: "Workspace overview refresh".to_string(),
        status,
        scope: BackgroundProcessScope::System,
        trigger: state
            .last_attempt_trigger
            .as_ref()
            .map(workspace_overview_trigger),
        phase: phase_for_attempt_status(
            status,
            BackgroundProcessPhase::RefreshingWorkspaceOverview,
            state.next_auto_refresh_not_before_ms,
        ),
        started_at: state.last_attempt_started_at_ms,
        finished_at: state.last_attempt_finished_at_ms,
        next_run_at: state.next_auto_refresh_not_before_ms,
        active_turn_id: state.active_auto_turn_id.clone(),
        active_session_id: None,
        last_error: state.last_error.clone(),
        last_result: terminal_result(
            state
                .last_attempt_status
                .as_ref()
                .map(workspace_overview_status),
            state.last_attempt_finished_at_ms,
            state.last_error.clone(),
        ),
        output_refs: vec![BackgroundProcessOutputRef {
            label: "Workspace overviews".to_string(),
            path: Some(path_string(output_path)),
            uri: None,
        }],
        actions: actions_for_status(status),
    })
}

async fn memory_consolidation_process() -> BackgroundProcess {
    let output_path = get_path_manager_arc().agentic_os_memory_dir();
    let Some(service) = get_global_memory_consolidation_service() else {
        return BackgroundProcess {
            id: "memory_consolidation".to_string(),
            kind: BackgroundProcessKind::MemoryConsolidation,
            category: BackgroundProcessCategory::Memory,
            title: "Memory consolidation".to_string(),
            status: BackgroundProcessStatus::Disabled,
            scope: BackgroundProcessScope::System,
            trigger: Some(BackgroundProcessTrigger::Scheduled),
            phase: Some(BackgroundProcessPhase::Idle),
            started_at: None,
            finished_at: None,
            next_run_at: None,
            active_turn_id: None,
            active_session_id: None,
            last_error: None,
            last_result: None,
            output_refs: vec![BackgroundProcessOutputRef {
                label: "Agentic OS memory".to_string(),
                path: Some(path_string(output_path)),
                uri: None,
            }],
            actions: vec![BackgroundProcessAction::OpenSettings],
        };
    };
    let snapshot = service.status_snapshot().await;
    let status = if snapshot.active {
        BackgroundProcessStatus::Running
    } else if snapshot.last_completed_at_ms.is_some() {
        BackgroundProcessStatus::Succeeded
    } else {
        BackgroundProcessStatus::Idle
    };

    BackgroundProcess {
        id: "memory_consolidation".to_string(),
        kind: BackgroundProcessKind::MemoryConsolidation,
        category: BackgroundProcessCategory::Memory,
        title: "Memory consolidation".to_string(),
        status,
        scope: BackgroundProcessScope::System,
        trigger: Some(BackgroundProcessTrigger::Scheduled),
        phase: if snapshot.active {
            Some(BackgroundProcessPhase::ConsolidatingMemory)
        } else {
            Some(BackgroundProcessPhase::Idle)
        },
        started_at: snapshot.last_started_at_ms,
        finished_at: snapshot.last_completed_at_ms,
        next_run_at: None,
        active_turn_id: None,
        active_session_id: None,
        last_error: None,
        last_result: snapshot
            .last_completed_at_ms
            .map(|finished_at| BackgroundProcessLastResult {
                status: BackgroundProcessStatus::Succeeded,
                finished_at: Some(finished_at),
                message: Some(format!("{} source(s) tracked", snapshot.source_count)),
            }),
        output_refs: vec![BackgroundProcessOutputRef {
            label: "Agentic OS memory".to_string(),
            path: Some(path_string(output_path)),
            uri: None,
        }],
        actions: actions_for_status(status),
    }
}

async fn global_daily_report_process() -> CoreResult<BackgroundProcess> {
    let state = load_global_daily_report_state().await?;
    let output_path =
        crate::service::global_daily_report::state::global_daily_report_runtime_dir()?;
    let status = match state.last_attempt_status.as_ref() {
        Some(GlobalDailyReportAttemptStatus::Running) => BackgroundProcessStatus::Running,
        Some(GlobalDailyReportAttemptStatus::Error) => BackgroundProcessStatus::Failed,
        Some(GlobalDailyReportAttemptStatus::Cancelled) => BackgroundProcessStatus::Cancelled,
        Some(GlobalDailyReportAttemptStatus::SkippedNoSources) => BackgroundProcessStatus::Skipped,
        Some(GlobalDailyReportAttemptStatus::Ok) => BackgroundProcessStatus::Succeeded,
        None => BackgroundProcessStatus::Idle,
    };

    Ok(BackgroundProcess {
        id: "global_daily_report".to_string(),
        kind: BackgroundProcessKind::GlobalDailyReport,
        category: BackgroundProcessCategory::Report,
        title: "Global daily report".to_string(),
        status,
        scope: BackgroundProcessScope::System,
        trigger: Some(BackgroundProcessTrigger::Scheduled),
        phase: phase_for_attempt_status(status, BackgroundProcessPhase::GeneratingReport, None),
        started_at: state.last_attempt_started_at_ms,
        finished_at: state.last_attempt_finished_at_ms,
        next_run_at: None,
        active_turn_id: state.active_turn_id.clone(),
        active_session_id: None,
        last_error: state.last_error.clone(),
        last_result: terminal_result(
            state.last_attempt_status.as_ref().map(global_daily_status),
            state.last_attempt_finished_at_ms,
            state.last_error.clone(),
        ),
        output_refs: vec![BackgroundProcessOutputRef {
            label: "Daily reports".to_string(),
            path: Some(path_string(output_path)),
            uri: None,
        }],
        actions: read_only_actions(status),
    })
}

async fn daily_letter_process() -> CoreResult<BackgroundProcess> {
    let output_path = global_daily_letters_output_dir()?;
    let Some(service) = get_global_daily_letter_service() else {
        return Ok(BackgroundProcess {
            id: "daily_letter".to_string(),
            kind: BackgroundProcessKind::DailyLetter,
            category: BackgroundProcessCategory::Report,
            title: "Daily letter".to_string(),
            status: BackgroundProcessStatus::Disabled,
            scope: BackgroundProcessScope::System,
            trigger: Some(BackgroundProcessTrigger::Scheduled),
            phase: Some(BackgroundProcessPhase::Idle),
            started_at: None,
            finished_at: None,
            next_run_at: None,
            active_turn_id: None,
            active_session_id: None,
            last_error: None,
            last_result: None,
            output_refs: vec![BackgroundProcessOutputRef {
                label: "Daily letters".to_string(),
                path: Some(path_string(output_path)),
                uri: None,
            }],
            actions: vec![BackgroundProcessAction::OpenSettings],
        });
    };

    let state = service.state_snapshot().await;
    let status = attempt_status(
        state.last_attempt_status.as_ref().map(daily_letter_status),
        state.next_auto_run_not_before_ms,
        state.last_error.as_deref(),
    );
    Ok(BackgroundProcess {
        id: "daily_letter".to_string(),
        kind: BackgroundProcessKind::DailyLetter,
        category: BackgroundProcessCategory::Report,
        title: "Daily letter".to_string(),
        status,
        scope: BackgroundProcessScope::System,
        trigger: state
            .last_attempt_trigger
            .as_ref()
            .map(daily_letter_trigger),
        phase: phase_for_attempt_status(
            status,
            BackgroundProcessPhase::WritingDailyLetter,
            state.next_auto_run_not_before_ms,
        ),
        started_at: state.last_attempt_started_at_ms,
        finished_at: state.last_attempt_finished_at_ms,
        next_run_at: state.next_auto_run_not_before_ms,
        active_turn_id: None,
        active_session_id: None,
        last_error: state.last_error.clone(),
        last_result: terminal_result(
            state.last_attempt_status.as_ref().map(daily_letter_status),
            state.last_attempt_finished_at_ms,
            state.last_error.clone(),
        ),
        output_refs: vec![BackgroundProcessOutputRef {
            label: "Daily letters".to_string(),
            path: Some(path_string(output_path)),
            uri: None,
        }],
        actions: actions_for_status(status),
    })
}

async fn global_milestone_process() -> CoreResult<BackgroundProcess> {
    let state = load_global_milestone_state().await?;
    let output_path = get_path_manager_arc()
        .agentic_os_memory_dir()
        .join("MILESTONES.md");
    let status = attempt_status(
        state
            .last_attempt_status
            .as_ref()
            .map(global_milestone_status),
        state.next_auto_run_not_before_ms,
        state.last_error.as_deref(),
    );

    Ok(BackgroundProcess {
        id: "global_milestone".to_string(),
        kind: BackgroundProcessKind::GlobalMilestone,
        category: BackgroundProcessCategory::Report,
        title: "Global milestone".to_string(),
        status,
        scope: BackgroundProcessScope::System,
        trigger: state
            .last_attempt_trigger
            .as_ref()
            .map(global_milestone_trigger),
        phase: phase_for_attempt_status(status, BackgroundProcessPhase::GeneratingReport, None),
        started_at: state.last_attempt_started_at_ms,
        finished_at: state.last_attempt_finished_at_ms,
        next_run_at: state.next_auto_run_not_before_ms,
        active_turn_id: state.active_turn_id.clone(),
        active_session_id: None,
        last_error: state.last_error.clone(),
        last_result: terminal_result(
            state
                .last_attempt_status
                .as_ref()
                .map(global_milestone_status),
            state.last_attempt_finished_at_ms,
            state.last_error.clone(),
        ),
        output_refs: vec![BackgroundProcessOutputRef {
            label: "Milestones".to_string(),
            path: Some(path_string(output_path)),
            uri: None,
        }],
        actions: actions_for_status(status),
    })
}

fn auto_memory_processes() -> Vec<BackgroundProcess> {
    let Some(coordinator) = get_global_coordinator() else {
        return Vec::new();
    };
    coordinator
        .auto_memory_workspace_snapshots()
        .into_iter()
        .map(|snapshot| {
            let status = if snapshot.active_session_id.is_some() {
                BackgroundProcessStatus::Running
            } else if snapshot.pending_session_count > 0 {
                BackgroundProcessStatus::Queued
            } else if snapshot.delayed_session_count > 0 {
                BackgroundProcessStatus::Scheduled
            } else if snapshot.worker_running {
                BackgroundProcessStatus::Queued
            } else {
                BackgroundProcessStatus::Idle
            };
            let id = format!("auto_memory:{}", snapshot.workspace_key);
            BackgroundProcess {
                id,
                kind: BackgroundProcessKind::AutoMemoryExtraction,
                category: BackgroundProcessCategory::Memory,
                title: "Auto memory extraction".to_string(),
                status,
                scope: auto_memory_scope(&snapshot.workspace_key),
                trigger: Some(BackgroundProcessTrigger::PostTurn),
                phase: match status {
                    BackgroundProcessStatus::Running => {
                        Some(BackgroundProcessPhase::ExtractingMemory)
                    }
                    BackgroundProcessStatus::Queued => Some(BackgroundProcessPhase::Queued),
                    BackgroundProcessStatus::Scheduled => {
                        Some(BackgroundProcessPhase::WaitingSchedule)
                    }
                    _ => Some(BackgroundProcessPhase::Idle),
                },
                started_at: None,
                finished_at: None,
                next_run_at: snapshot.next_ready_at_ms,
                active_turn_id: None,
                active_session_id: snapshot.active_session_id,
                last_error: None,
                last_result: None,
                output_refs: vec![BackgroundProcessOutputRef {
                    label: "Memory store".to_string(),
                    path: Some(snapshot.workspace_key),
                    uri: None,
                }],
                actions: vec![
                    BackgroundProcessAction::OpenOutput,
                    BackgroundProcessAction::OpenSettings,
                ],
            }
        })
        .collect()
}

fn attempt_status(
    last_status: Option<BackgroundProcessStatus>,
    next_run_at: Option<i64>,
    last_error: Option<&str>,
) -> BackgroundProcessStatus {
    match last_status {
        Some(BackgroundProcessStatus::Running) => BackgroundProcessStatus::Running,
        Some(BackgroundProcessStatus::Failed) | Some(BackgroundProcessStatus::Cancelled)
            if next_run_at.is_some() && last_error.is_some() =>
        {
            BackgroundProcessStatus::CoolingDown
        }
        Some(BackgroundProcessStatus::Failed) => BackgroundProcessStatus::Failed,
        Some(BackgroundProcessStatus::Cancelled) => BackgroundProcessStatus::Cancelled,
        Some(BackgroundProcessStatus::Skipped) => BackgroundProcessStatus::Skipped,
        Some(BackgroundProcessStatus::Succeeded) if next_run_at.is_some() => {
            BackgroundProcessStatus::Scheduled
        }
        Some(BackgroundProcessStatus::Succeeded) => BackgroundProcessStatus::Succeeded,
        _ if next_run_at.is_some() => BackgroundProcessStatus::Scheduled,
        _ => BackgroundProcessStatus::Idle,
    }
}

fn terminal_result(
    status: Option<BackgroundProcessStatus>,
    finished_at: Option<i64>,
    message: Option<String>,
) -> Option<BackgroundProcessLastResult> {
    let status = match status? {
        BackgroundProcessStatus::Running
        | BackgroundProcessStatus::Scheduled
        | BackgroundProcessStatus::Queued
        | BackgroundProcessStatus::CoolingDown
        | BackgroundProcessStatus::Idle
        | BackgroundProcessStatus::Disabled => return None,
        terminal => terminal,
    };
    Some(BackgroundProcessLastResult {
        status,
        finished_at,
        message,
    })
}

fn phase_for_attempt_status(
    status: BackgroundProcessStatus,
    running_phase: BackgroundProcessPhase,
    next_run_at: Option<i64>,
) -> Option<BackgroundProcessPhase> {
    match status {
        BackgroundProcessStatus::Running => Some(running_phase),
        BackgroundProcessStatus::CoolingDown => Some(BackgroundProcessPhase::WaitingRetry),
        BackgroundProcessStatus::Scheduled if next_run_at.is_some() => {
            Some(BackgroundProcessPhase::WaitingSchedule)
        }
        BackgroundProcessStatus::Idle
        | BackgroundProcessStatus::Succeeded
        | BackgroundProcessStatus::Skipped => Some(BackgroundProcessPhase::Idle),
        _ => None,
    }
}

fn actions_for_status(status: BackgroundProcessStatus) -> Vec<BackgroundProcessAction> {
    let mut actions = read_only_actions(status);
    if !matches!(
        status,
        BackgroundProcessStatus::Running | BackgroundProcessStatus::Queued
    ) {
        if matches!(
            status,
            BackgroundProcessStatus::Failed | BackgroundProcessStatus::CoolingDown
        ) {
            actions.insert(0, BackgroundProcessAction::Retry);
        } else {
            actions.insert(0, BackgroundProcessAction::RunNow);
        }
    }
    actions
}

fn read_only_actions(_status: BackgroundProcessStatus) -> Vec<BackgroundProcessAction> {
    vec![
        BackgroundProcessAction::OpenOutput,
        BackgroundProcessAction::OpenSettings,
    ]
}

fn host_scan_status(status: &HostScanAttemptStatus) -> BackgroundProcessStatus {
    match status {
        HostScanAttemptStatus::Running => BackgroundProcessStatus::Running,
        HostScanAttemptStatus::Ok => BackgroundProcessStatus::Succeeded,
        HostScanAttemptStatus::Error => BackgroundProcessStatus::Failed,
        HostScanAttemptStatus::Cancelled => BackgroundProcessStatus::Cancelled,
    }
}

fn workspace_overview_status(
    status: &WorkspaceOverviewRefreshAttemptStatus,
) -> BackgroundProcessStatus {
    match status {
        WorkspaceOverviewRefreshAttemptStatus::Running => BackgroundProcessStatus::Running,
        WorkspaceOverviewRefreshAttemptStatus::Ok => BackgroundProcessStatus::Succeeded,
        WorkspaceOverviewRefreshAttemptStatus::Error => BackgroundProcessStatus::Failed,
        WorkspaceOverviewRefreshAttemptStatus::Cancelled => BackgroundProcessStatus::Cancelled,
    }
}

fn global_daily_status(status: &GlobalDailyReportAttemptStatus) -> BackgroundProcessStatus {
    match status {
        GlobalDailyReportAttemptStatus::Running => BackgroundProcessStatus::Running,
        GlobalDailyReportAttemptStatus::Ok => BackgroundProcessStatus::Succeeded,
        GlobalDailyReportAttemptStatus::Error => BackgroundProcessStatus::Failed,
        GlobalDailyReportAttemptStatus::Cancelled => BackgroundProcessStatus::Cancelled,
        GlobalDailyReportAttemptStatus::SkippedNoSources => BackgroundProcessStatus::Skipped,
    }
}

fn daily_letter_status(status: &DailyLetterAttemptStatus) -> BackgroundProcessStatus {
    match status {
        DailyLetterAttemptStatus::Running => BackgroundProcessStatus::Running,
        DailyLetterAttemptStatus::Ok => BackgroundProcessStatus::Succeeded,
        DailyLetterAttemptStatus::Error => BackgroundProcessStatus::Failed,
        DailyLetterAttemptStatus::Cancelled => BackgroundProcessStatus::Cancelled,
        DailyLetterAttemptStatus::SkippedNoSources => BackgroundProcessStatus::Skipped,
    }
}

fn global_milestone_status(status: &GlobalMilestoneAttemptStatus) -> BackgroundProcessStatus {
    match status {
        GlobalMilestoneAttemptStatus::Running => BackgroundProcessStatus::Running,
        GlobalMilestoneAttemptStatus::Ok => BackgroundProcessStatus::Succeeded,
        GlobalMilestoneAttemptStatus::Error => BackgroundProcessStatus::Failed,
        GlobalMilestoneAttemptStatus::Cancelled => BackgroundProcessStatus::Cancelled,
        GlobalMilestoneAttemptStatus::SkippedNoSources => BackgroundProcessStatus::Skipped,
    }
}

fn host_scan_trigger(trigger: &HostScanTrigger) -> BackgroundProcessTrigger {
    match trigger {
        HostScanTrigger::Manual => BackgroundProcessTrigger::Manual,
        HostScanTrigger::Auto => BackgroundProcessTrigger::Auto,
    }
}

fn workspace_overview_trigger(
    trigger: &WorkspaceOverviewRefreshTrigger,
) -> BackgroundProcessTrigger {
    match trigger {
        WorkspaceOverviewRefreshTrigger::Manual => BackgroundProcessTrigger::Manual,
        WorkspaceOverviewRefreshTrigger::Auto => BackgroundProcessTrigger::Auto,
    }
}

fn global_milestone_trigger(trigger: &GlobalMilestoneTrigger) -> BackgroundProcessTrigger {
    match trigger {
        GlobalMilestoneTrigger::Manual => BackgroundProcessTrigger::Manual,
        GlobalMilestoneTrigger::Auto => BackgroundProcessTrigger::Auto,
    }
}

fn daily_letter_trigger(trigger: &DailyLetterTrigger) -> BackgroundProcessTrigger {
    match trigger {
        DailyLetterTrigger::Manual => BackgroundProcessTrigger::Manual,
        DailyLetterTrigger::Auto => BackgroundProcessTrigger::Auto,
    }
}

fn auto_memory_scope(store_key: &str) -> BackgroundProcessScope {
    let global_memory_dir = path_string(get_path_manager_arc().agentic_os_memory_dir());
    if same_normalized_path(store_key, &global_memory_dir) {
        return BackgroundProcessScope::System;
    }
    BackgroundProcessScope::Path {
        path: store_key.to_string(),
    }
}

fn same_normalized_path(left: &str, right: &str) -> bool {
    normalize_path(left).eq_ignore_ascii_case(&normalize_path(right))
}

fn normalize_path(value: &str) -> String {
    value.replace('\\', "/").trim_end_matches('/').to_string()
}

fn path_string(path: impl Into<std::path::PathBuf>) -> String {
    path.into().to_string_lossy().replace('\\', "/")
}

fn process_order(left: &BackgroundProcess, right: &BackgroundProcess) -> std::cmp::Ordering {
    let left_bucket = status_order(left.status);
    let right_bucket = status_order(right.status);
    left_bucket
        .cmp(&right_bucket)
        .then_with(|| category_order(left.category).cmp(&category_order(right.category)))
        .then_with(|| left.title.cmp(&right.title))
}

fn status_order(status: BackgroundProcessStatus) -> u8 {
    match status {
        BackgroundProcessStatus::Failed | BackgroundProcessStatus::CoolingDown => 0,
        BackgroundProcessStatus::Running => 1,
        BackgroundProcessStatus::Queued => 2,
        BackgroundProcessStatus::Scheduled => 3,
        BackgroundProcessStatus::Idle => 4,
        BackgroundProcessStatus::Skipped => 5,
        BackgroundProcessStatus::Succeeded => 6,
        BackgroundProcessStatus::Cancelled => 7,
        BackgroundProcessStatus::Disabled => 8,
    }
}

fn category_order(category: BackgroundProcessCategory) -> u8 {
    match category {
        BackgroundProcessCategory::Memory => 0,
        BackgroundProcessCategory::Workspace => 1,
        BackgroundProcessCategory::Report => 2,
        BackgroundProcessCategory::System => 3,
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}
