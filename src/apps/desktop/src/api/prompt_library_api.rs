use crate::api::app_state::AppState;
use bitfun_core::agentic::coordination::get_global_scheduler;
use bitfun_core::infrastructure::ai::AIClientFactory;
use bitfun_core::service::prompt_assets::{
    PromptAsset, PromptAssetGit, PromptAssetGitCommit, PromptAssetGitDiff, PromptAssetGitStatus,
    PromptAssetMetadata, PromptAssetScope, PromptAssetStore, PromptAssetSummary,
    PromptValidationReport,
};
use bitfun_core::service::prompt_commit_trace::{
    GitPromptHistoryCommit, PromptCommitTraceStore, PromptReviewTrace,
};
use bitfun_core::service::config::{
    get_app_language_code, short_model_user_language_instruction,
};
use bitfun_core::service::prompt_history::{
    PromptHistoryEvent, PromptHistoryQuery, PromptHistoryStore, PromptHistorySummary,
};
use bitfun_core::service::prompt_value::{
    PromptLlmAssessment, PromptLlmAssessmentStatus, PromptValueConfidence, PromptValueRecord,
    PromptValueSignal, PromptValueSignalInput, PromptValueStore,
};
use bitfun_core::util::types::message::Message as AIMessage;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;
use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tauri::State;
use tokio::sync::Mutex;
use tokio::time::{sleep, timeout, Duration};

const PROMPT_LLM_ASSESSMENT_TIMEOUT: Duration = Duration::from_secs(90);
const PROMPT_LLM_ASSESSMENT_MAX_ATTEMPTS: u32 = 3;
const PROMPT_LLM_ASSESSMENT_IDLE_POLL: Duration = Duration::from_secs(2);

#[derive(Debug, Clone)]
struct PromptLlmAssessmentJob {
    workspace_path: PathBuf,
    source_workspace_path: PathBuf,
    history_event_id: String,
    model_ref: String,
    force: bool,
}

#[derive(Default)]
struct PromptLlmAssessmentQueue {
    pending: VecDeque<PromptLlmAssessmentJob>,
    queued_keys: HashSet<String>,
    worker_running: bool,
}

static PROMPT_LLM_ASSESSMENT_QUEUE: OnceLock<Arc<Mutex<PromptLlmAssessmentQueue>>> =
    OnceLock::new();

fn prompt_llm_assessment_queue() -> Arc<Mutex<PromptLlmAssessmentQueue>> {
    PROMPT_LLM_ASSESSMENT_QUEUE
        .get_or_init(|| Arc::new(Mutex::new(PromptLlmAssessmentQueue::default())))
        .clone()
}

fn asset_scope_or_project(scope: Option<PromptAssetScope>) -> PromptAssetScope {
    scope.unwrap_or(PromptAssetScope::Project)
}

fn workspace_root_from_request(workspace_path: &str) -> Result<PathBuf, String> {
    let trimmed = workspace_path.trim();
    if trimmed.is_empty() {
        return Err("workspacePath is required".to_string());
    }
    Ok(PathBuf::from(trimmed))
}

fn list_all_prompt_asset_summaries(
    workspace: &std::path::Path,
) -> Result<Vec<PromptAssetSummary>, String> {
    let mut assets = Vec::new();
    for scope in [
        PromptAssetScope::Project,
        PromptAssetScope::Workspace,
        PromptAssetScope::User,
    ] {
        match PromptAssetStore::list_assets(workspace, scope) {
            Ok(mut items) => assets.append(&mut items),
            Err(error) => {
                log::warn!(
                    "Failed to list prompt assets for value scoring: workspace_path={} scope={:?} error={}",
                    workspace.display(),
                    scope,
                    error
                );
            }
        }
    }
    Ok(assets)
}

fn list_prompt_value_records_for_workspace(
    workspace: &std::path::Path,
    scope: PromptAssetScope,
    limit: Option<usize>,
) -> Result<Vec<PromptValueRecord>, String> {
    let history_query = PromptHistoryQuery {
        workspace_path: workspace.to_string_lossy().to_string(),
        session_id: None,
        agent_type: None,
        pinned: None,
        query: None,
        limit: limit.or(Some(500)),
    };
    let history = match scope {
        PromptAssetScope::User => PromptHistoryStore::list_all_projects(history_query),
        PromptAssetScope::Project | PromptAssetScope::Workspace => {
            PromptHistoryStore::list(history_query)
        }
    }
    .map_err(|e| e.to_string())?;
    let assets = list_all_prompt_asset_summaries(workspace)?;
    let git_commits =
        PromptCommitTraceStore::list_git_prompt_history(workspace, 80).unwrap_or_default();
    PromptValueStore::list_records(workspace, &history.events, &assets, &git_commits)
        .map_err(|e| e.to_string())
}

fn prompt_value_record_for_event(
    workspace: &std::path::Path,
    source_workspace: &std::path::Path,
    event: &PromptHistoryEvent,
) -> Result<PromptValueRecord, String> {
    let mut history = PromptHistoryStore::list(PromptHistoryQuery {
        workspace_path: source_workspace.to_string_lossy().to_string(),
        session_id: None,
        agent_type: None,
        pinned: None,
        query: None,
        limit: Some(500),
    })
    .map(|summary| summary.events)
    .unwrap_or_default();
    if !history.iter().any(|item| item.id == event.id) {
        history.push(event.clone());
    }
    let assets = list_all_prompt_asset_summaries(workspace)?;
    let git_commits =
        PromptCommitTraceStore::list_git_prompt_history(workspace, 80).unwrap_or_default();
    let records = PromptValueStore::list_records(workspace, &history, &assets, &git_commits)
        .map_err(|e| e.to_string())?;
    records
        .into_iter()
        .find(|record| record.prompt_history_event_id == event.id)
        .ok_or_else(|| "Prompt value record not found".to_string())
}

fn should_enqueue_llm_assessment(record: &PromptValueRecord) -> bool {
    match record.llm_assessment.as_ref() {
        None => true,
        Some(assessment) => {
            if matches!(
                assessment.status,
                PromptLlmAssessmentStatus::Pending | PromptLlmAssessmentStatus::Running
            ) && assessment.attempts == 0
            {
                return true;
            }
            false
        }
    }
}

fn is_stale_llm_assessment(assessment: &PromptLlmAssessment) -> bool {
    let Ok(requested_at) = DateTime::parse_from_rfc3339(&assessment.requested_at) else {
        return true;
    };
    let age = Utc::now().signed_duration_since(requested_at.with_timezone(&Utc));
    age.num_seconds() > (PROMPT_LLM_ASSESSMENT_TIMEOUT.as_secs() as i64 * 2)
}

fn enqueue_llm_assessments_for_records(
    ai_client_factory: Arc<AIClientFactory>,
    workspace_path: &Path,
    source_workspace_path: &Path,
    records: &[PromptValueRecord],
) {
    for record in records.iter().take(20) {
        if !should_enqueue_llm_assessment(record) {
            continue;
        }
        enqueue_prompt_llm_assessment_job(
            ai_client_factory.clone(),
            PromptLlmAssessmentJob {
                workspace_path: workspace_path.to_path_buf(),
                source_workspace_path: source_workspace_path.to_path_buf(),
                history_event_id: record.prompt_history_event_id.clone(),
                model_ref: "primary".to_string(),
                force: false,
            },
        );
    }
}

fn enqueue_prompt_llm_assessment_job(
    ai_client_factory: Arc<AIClientFactory>,
    job: PromptLlmAssessmentJob,
) {
    let queue = prompt_llm_assessment_queue();
    tokio::spawn(async move {
        let should_start_worker = {
            let mut guard = queue.lock().await;
            let key = prompt_llm_assessment_job_key(&job);
            if guard.queued_keys.insert(key.clone()) {
                guard.pending.push_back(job);
            } else if job.force {
                if let Some(existing) = guard
                    .pending
                    .iter_mut()
                    .find(|existing| prompt_llm_assessment_job_key(existing) == key)
                {
                    existing.force = true;
                    existing.model_ref = job.model_ref.clone();
                }
            }
            if guard.worker_running {
                false
            } else {
                guard.worker_running = true;
                true
            }
        };
        if should_start_worker {
            let queue_for_worker = queue.clone();
            tokio::spawn(async move {
                run_prompt_llm_assessment_worker(ai_client_factory, queue_for_worker).await;
            });
        }
    });
}

fn prompt_llm_assessment_job_key(job: &PromptLlmAssessmentJob) -> String {
    format!(
        "{}:{}:{}",
        job.workspace_path.display(),
        job.source_workspace_path.display(),
        job.history_event_id
    )
}

async fn run_prompt_llm_assessment_worker(
    ai_client_factory: Arc<AIClientFactory>,
    queue: Arc<Mutex<PromptLlmAssessmentQueue>>,
) {
    loop {
        let job = {
            let mut guard = queue.lock().await;
            guard.pending.pop_front()
        };
        let Some(job) = job else {
            let mut guard = queue.lock().await;
            guard.worker_running = false;
            if guard.pending.is_empty() {
                return;
            }
            guard.worker_running = true;
            continue;
        };
        let key = prompt_llm_assessment_job_key(&job);
        process_prompt_llm_assessment_job(ai_client_factory.clone(), &job).await;
        let mut guard = queue.lock().await;
        guard.queued_keys.remove(&key);
    }
}

async fn process_prompt_llm_assessment_job(
    ai_client_factory: Arc<AIClientFactory>,
    job: &PromptLlmAssessmentJob,
) {
    let event = match PromptHistoryStore::get(
        job.source_workspace_path.as_path(),
        &job.history_event_id,
    ) {
        Ok(event) => event,
        Err(error) => {
            log::warn!(
                "Skipping prompt LLM assessment; history event not found: workspace_path={} history_event_id={} error={}",
                job.source_workspace_path.display(),
                job.history_event_id,
                error
            );
            return;
        }
    };

    let record = match prompt_value_record_for_event(
        job.workspace_path.as_path(),
        job.source_workspace_path.as_path(),
        &event,
    ) {
        Ok(record) => record,
        Err(error) => {
            log::warn!(
                "Skipping prompt LLM assessment; prompt value record not found: workspace_path={} history_event_id={} error={}",
                job.workspace_path.display(),
                job.history_event_id,
                error
            );
            return;
        }
    };

    if !job.force {
        if let Some(existing) = record.llm_assessment.as_ref() {
            if matches!(existing.status, PromptLlmAssessmentStatus::Completed) {
                return;
            }
            if matches!(
                existing.status,
                PromptLlmAssessmentStatus::Pending | PromptLlmAssessmentStatus::Running
            ) && existing.attempts > 0
                && !is_stale_llm_assessment(existing)
            {
                return;
            }
        }
    }

    let mut assessment = record
        .llm_assessment
        .clone()
        .unwrap_or_else(|| {
            PromptValueStore::new_llm_assessment(
                &event,
                &record,
                PromptLlmAssessmentStatus::Pending,
                Some(job.model_ref.clone()),
            )
            .unwrap_or_else(|error| {
                log::warn!(
                    "Failed to initialize prompt LLM assessment: history_event_id={} error={}",
                    event.id,
                    error
                );
                PromptLlmAssessment {
                    prompt_history_event_id: event.id.clone(),
                    prompt_hash: event.prompt_hash.clone(),
                    deterministic_score: record.score,
                    input_hash: String::new(),
                    status: PromptLlmAssessmentStatus::Failed,
                    attempts: 0,
                    requested_at: Utc::now().to_rfc3339(),
                    completed_at: Some(Utc::now().to_rfc3339()),
                    model: Some(job.model_ref.clone()),
                    language_code: None,
                    llm_score: None,
                    confidence: None,
                    impact_summary: None,
                    quality_findings: Vec::new(),
                    risk_findings: Vec::new(),
                    recommended_action: None,
                    suggested_tags: Vec::new(),
                    template_potential: None,
                    rationale: Vec::new(),
                    error: Some("Failed to initialize LLM assessment".to_string()),
                }
            })
        });

    while assessment.attempts < PROMPT_LLM_ASSESSMENT_MAX_ATTEMPTS {
        wait_for_dialog_idle().await;
        let language_code = get_app_language_code().await;
        let language_instruction = short_model_user_language_instruction(language_code.as_str());

        assessment.status = PromptLlmAssessmentStatus::Running;
        assessment.attempts = assessment.attempts.saturating_add(1);
        assessment.requested_at = Utc::now().to_rfc3339();
        assessment.completed_at = None;
        assessment.model = Some(job.model_ref.clone());
        assessment.language_code = Some(language_code.clone());
        if let Err(error) =
            PromptValueStore::save_llm_assessment(job.workspace_path.as_path(), &assessment)
        {
            log::warn!(
                "Failed to persist running prompt LLM assessment: workspace_path={} history_event_id={} error={}",
                job.workspace_path.display(),
                assessment.prompt_history_event_id,
                error
            );
        }

        let mut attempt_assessment = assessment.clone();
        let completed = match timeout(
            PROMPT_LLM_ASSESSMENT_TIMEOUT,
            run_prompt_llm_assessment(
                ai_client_factory.clone(),
                &job.model_ref,
                &event,
                &record,
                &mut attempt_assessment,
                language_code.as_str(),
                language_instruction,
            ),
        )
        .await
        {
            Ok(completed) => completed,
            Err(_) => failed_llm_assessment(
                &assessment,
                format!(
                    "LLM assessment timed out after {} seconds",
                    PROMPT_LLM_ASSESSMENT_TIMEOUT.as_secs()
                ),
            ),
        };

        if matches!(completed.status, PromptLlmAssessmentStatus::Completed)
            || completed.attempts >= PROMPT_LLM_ASSESSMENT_MAX_ATTEMPTS
        {
            let final_assessment = PromptLlmAssessment {
                attempts: assessment.attempts,
                ..completed
            };
            persist_prompt_llm_assessment(job.workspace_path.as_path(), &final_assessment);
            return;
        }

        assessment = PromptLlmAssessment {
            status: PromptLlmAssessmentStatus::Pending,
            attempts: assessment.attempts,
            requested_at: Utc::now().to_rfc3339(),
            completed_at: None,
            error: completed.error,
            ..completed
        };
        persist_prompt_llm_assessment(job.workspace_path.as_path(), &assessment);
        sleep(Duration::from_secs(4)).await;
    }
}

async fn wait_for_dialog_idle() {
    loop {
        let active_turn_count = get_global_scheduler()
            .map(|scheduler| scheduler.active_turn_count())
            .unwrap_or(0);
        if active_turn_count == 0 {
            return;
        }
        sleep(PROMPT_LLM_ASSESSMENT_IDLE_POLL).await;
    }
}

fn persist_prompt_llm_assessment(workspace_path: &Path, assessment: &PromptLlmAssessment) {
    if let Err(error) = PromptValueStore::save_llm_assessment(workspace_path, assessment) {
        log::warn!(
            "Failed to persist prompt LLM assessment: workspace_path={} history_event_id={} error={}",
            workspace_path.display(),
            assessment.prompt_history_event_id,
            error
        );
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAssetListRequest {
    pub workspace_path: String,
    pub scope: Option<PromptAssetScope>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAssetRequest {
    pub workspace_path: String,
    pub asset_id: String,
    pub scope: Option<PromptAssetScope>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePromptAssetRequest {
    pub workspace_path: String,
    pub metadata: PromptAssetMetadata,
    pub body: String,
    pub relative_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatePromptContentRequest {
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAssetGitPathRequest {
    pub workspace_path: String,
    pub relative_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAssetGitHistoryRequest {
    pub workspace_path: String,
    pub relative_path: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptGitHistoryRequest {
    pub workspace_path: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptReviewTraceRequest {
    pub workspace_path: String,
    pub trace_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptValueListRequest {
    pub workspace_path: String,
    pub scope: Option<PromptAssetScope>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordPromptValueSignalRequest {
    pub workspace_path: String,
    #[serde(flatten)]
    pub signal: PromptValueSignalInput,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPromptLlmAssessmentRequest {
    pub workspace_path: String,
    pub source_workspace_path: Option<String>,
    pub history_event_id: String,
    pub model_id: Option<String>,
    pub force: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackPromptAssetRequest {
    pub workspace_path: String,
    pub relative_path: String,
    pub commit: String,
}

#[tauri::command]
pub async fn list_prompt_assets(
    request: PromptAssetListRequest,
) -> Result<Vec<PromptAssetSummary>, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptAssetStore::list_assets(workspace.as_path(), asset_scope_or_project(request.scope))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_prompt_asset(request: PromptAssetRequest) -> Result<PromptAsset, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptAssetStore::get_asset(
        workspace.as_path(),
        asset_scope_or_project(request.scope),
        &request.asset_id,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_prompt_asset(request: SavePromptAssetRequest) -> Result<PromptAsset, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    let scope = request.metadata.scope;
    PromptAssetStore::save_asset(
        workspace.as_path(),
        scope,
        request.metadata,
        &request.body,
        request.relative_path.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn validate_prompt_content(
    request: ValidatePromptContentRequest,
) -> Result<PromptValidationReport, String> {
    Ok(PromptAssetStore::validate_content(&request.content))
}

#[tauri::command]
pub async fn validate_prompt_asset(
    request: PromptAssetRequest,
) -> Result<PromptValidationReport, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptAssetStore::validate_asset(
        workspace.as_path(),
        asset_scope_or_project(request.scope),
        &request.asset_id,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_prompt_asset_git_status(
    request: PromptAssetListRequest,
) -> Result<PromptAssetGitStatus, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptAssetGit::status(workspace.as_path()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_prompt_asset_git_diff(
    request: PromptAssetGitPathRequest,
) -> Result<PromptAssetGitDiff, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptAssetGit::diff(workspace.as_path(), request.relative_path.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_prompt_asset_git_history(
    request: PromptAssetGitHistoryRequest,
) -> Result<Vec<PromptAssetGitCommit>, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptAssetGit::history(
        workspace.as_path(),
        request.relative_path.as_deref(),
        request.limit.unwrap_or(20),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rollback_prompt_asset(request: RollbackPromptAssetRequest) -> Result<(), String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptAssetGit::rollback(workspace.as_path(), &request.relative_path, &request.commit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_git_prompt_history(
    request: PromptGitHistoryRequest,
) -> Result<Vec<GitPromptHistoryCommit>, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptCommitTraceStore::list_git_prompt_history(
        workspace.as_path(),
        request.limit.unwrap_or(40),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_prompt_review_trace(
    request: PromptReviewTraceRequest,
) -> Result<PromptReviewTrace, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptCommitTraceStore::get_review_trace(workspace.as_path(), &request.trace_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_prompt_values(
    state: State<'_, AppState>,
    request: PromptValueListRequest,
) -> Result<Vec<PromptValueRecord>, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    let records = list_prompt_value_records_for_workspace(
        workspace.as_path(),
        request.scope.unwrap_or(PromptAssetScope::Project),
        request.limit,
    )?;
    if matches!(
        request.scope.unwrap_or(PromptAssetScope::Project),
        PromptAssetScope::Project | PromptAssetScope::Workspace
    ) {
        enqueue_llm_assessments_for_records(
            state.ai_client_factory.clone(),
            workspace.as_path(),
            workspace.as_path(),
            &records,
        );
    }
    Ok(records)
}

#[tauri::command]
pub async fn record_prompt_value_signal(
    request: RecordPromptValueSignalRequest,
) -> Result<PromptValueSignal, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptValueStore::record_signal(workspace.as_path(), request.signal).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn request_prompt_llm_assessment(
    state: State<'_, AppState>,
    request: RequestPromptLlmAssessmentRequest,
) -> Result<PromptLlmAssessment, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    let source_workspace = workspace_root_from_request(
        request
            .source_workspace_path
            .as_deref()
            .unwrap_or(&request.workspace_path),
    )?;
    let event = PromptHistoryStore::get(source_workspace.as_path(), &request.history_event_id)
        .map_err(|e| e.to_string())?;
    let record =
        prompt_value_record_for_event(workspace.as_path(), source_workspace.as_path(), &event)?;
    let language_code = get_app_language_code().await;

    let model_ref = request
        .model_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("primary")
        .to_string();
    let mut assessment = PromptValueStore::new_llm_assessment(
        &event,
        &record,
        PromptLlmAssessmentStatus::Pending,
        Some(model_ref.clone()),
    )
    .map_err(|e| e.to_string())?;
    assessment.language_code = Some(language_code);
    PromptValueStore::save_llm_assessment(workspace.as_path(), &assessment)
        .map_err(|e| e.to_string())?;

    enqueue_prompt_llm_assessment_job(
        state.ai_client_factory.clone(),
        PromptLlmAssessmentJob {
            workspace_path: workspace,
            source_workspace_path: source_workspace,
            history_event_id: event.id.clone(),
            model_ref,
            force: true,
        },
    );

    Ok(assessment)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptLlmAssessmentOutput {
    llm_score: u32,
    confidence: PromptValueConfidence,
    impact_summary: String,
    #[serde(default)]
    quality_findings: Vec<String>,
    #[serde(default)]
    risk_findings: Vec<String>,
    recommended_action: String,
    #[serde(default)]
    suggested_tags: Vec<String>,
    template_potential: String,
    #[serde(default)]
    rationale: Vec<String>,
}

async fn run_prompt_llm_assessment(
    ai_client_factory: Arc<AIClientFactory>,
    model_ref: &str,
    event: &PromptHistoryEvent,
    record: &PromptValueRecord,
    assessment: &mut PromptLlmAssessment,
    language_code: &str,
    language_instruction: &str,
) -> PromptLlmAssessment {
    let client = match ai_client_factory.get_client_resolved(model_ref).await {
        Ok(client) => client,
        Err(error) => {
            return failed_llm_assessment(
                assessment,
                format!("Failed to create AI client: {}", error),
            );
        }
    };

    assessment.model = Some(client.config.model.clone());
    assessment.language_code = Some(language_code.to_string());
    let payload = prompt_llm_assessment_payload(event, record, language_code);
    let messages = vec![
        AIMessage::system(prompt_llm_assessment_system_prompt(
            language_code,
            language_instruction,
        )),
        AIMessage::user(payload),
    ];
    let response = match client.send_message(messages, None).await {
        Ok(response) => response,
        Err(error) => {
            return failed_llm_assessment(assessment, format!("AI call failed: {}", error));
        }
    };
    let parsed = match parse_prompt_llm_assessment_output(&response.text) {
        Ok(parsed) => parsed,
        Err(error) => {
            return failed_llm_assessment(
                assessment,
                format!("Failed to parse AI assessment JSON: {}", error),
            );
        }
    };

    assessment.status = PromptLlmAssessmentStatus::Completed;
    assessment.completed_at = Some(Utc::now().to_rfc3339());
    assessment.llm_score = Some(parsed.llm_score.min(100));
    assessment.confidence = Some(parsed.confidence);
    assessment.impact_summary = Some(truncate_chars(parsed.impact_summary.trim(), 600));
    assessment.quality_findings = parsed
        .quality_findings
        .into_iter()
        .map(|value| truncate_chars(value.trim(), 240))
        .filter(|value| !value.is_empty())
        .take(6)
        .collect();
    assessment.risk_findings = parsed
        .risk_findings
        .into_iter()
        .map(|value| truncate_chars(value.trim(), 240))
        .filter(|value| !value.is_empty())
        .take(6)
        .collect();
    assessment.recommended_action = Some(truncate_chars(parsed.recommended_action.trim(), 40));
    assessment.suggested_tags = parsed
        .suggested_tags
        .into_iter()
        .map(|value| normalize_tag(&value))
        .filter(|value| !value.is_empty())
        .take(8)
        .collect();
    assessment.template_potential = Some(truncate_chars(parsed.template_potential.trim(), 20));
    assessment.rationale = parsed
        .rationale
        .into_iter()
        .map(|value| truncate_chars(value.trim(), 240))
        .filter(|value| !value.is_empty())
        .take(6)
        .collect();
    assessment.error = None;
    assessment.clone()
}

fn failed_llm_assessment(assessment: &PromptLlmAssessment, error: String) -> PromptLlmAssessment {
    let mut failed = assessment.clone();
    failed.status = PromptLlmAssessmentStatus::Failed;
    failed.completed_at = Some(Utc::now().to_rfc3339());
    failed.error = Some(truncate_chars(error.trim(), 500));
    failed
}

fn prompt_llm_assessment_payload(
    event: &PromptHistoryEvent,
    record: &PromptValueRecord,
    language_code: &str,
) -> String {
    let signal_summary = record
        .signals
        .iter()
        .map(|signal| {
            json!({
                "kind": signal.kind,
                "weight": signal.weight,
                "confidence": signal.confidence,
                "reason": &signal.reason,
            })
        })
        .collect::<Vec<_>>();
    let payload = json!({
        "outputLanguage": language_code,
        "prompt": {
            "textPreview": redact_and_truncate(&event.text, 1600),
            "length": event.text.chars().count(),
            "source": event.source,
            "agentType": &event.agent_type,
            "hasImages": event.context.as_ref().is_some_and(|context| context.runtime.image_context_count > 0),
            "imageContextCount": event.context.as_ref().map(|context| context.runtime.image_context_count).unwrap_or(0),
        },
        "deterministicAssessment": {
            "score": record.score,
            "tier": record.tier,
            "confidence": record.confidence,
            "reuseCount": record.reuse_count,
            "reasons": &record.reasons,
            "warnings": &record.warnings,
            "signals": signal_summary,
        }
    });
    serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string())
}

fn prompt_llm_assessment_system_prompt(
    language_code: &str,
    language_instruction: &str,
) -> String {
    let natural_language = match language_code {
        "en-US" => "English",
        _ => "Simplified Chinese",
    };
    format!(
        "You assess the impact of a user prompt in Sparo OS.\n\
Return strict JSON only. Do not wrap it in markdown.\n\
Evaluate actual impact from the structured deterministic facts, not whether the prompt merely looks polished.\n\
Retries, correction prompts, failures, and rollbacks reduce confidence.\n\
If evidence is thin, lower confidence instead of inventing impact.\n\
Output language: {}. {}.\n\
All natural-language values in impactSummary, qualityFindings, riskFindings, suggestedTags, and rationale must be written in {}.\n\
Keep JSON keys and enum values in English exactly as specified. confidence and templatePotential must be one of low, medium, high. recommendedAction must be one of save, promote, revise, ignore, watch.\n\
Use this exact JSON shape: {{\"llmScore\":0,\"confidence\":\"low|medium|high\",\"impactSummary\":\"...\",\"qualityFindings\":[],\"riskFindings\":[],\"recommendedAction\":\"save|promote|revise|ignore|watch\",\"suggestedTags\":[],\"templatePotential\":\"low|medium|high\",\"rationale\":[]}}.",
        language_code,
        language_instruction,
        natural_language
    )
}

fn parse_prompt_llm_assessment_output(
    text: &str,
) -> Result<PromptLlmAssessmentOutput, serde_json::Error> {
    let json_text = extract_json_object(text).unwrap_or(text).trim();
    serde_json::from_str(json_text)
}

fn extract_json_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(&text[start..=end])
}

fn redact_and_truncate(text: &str, max_chars: usize) -> String {
    let mut redacted = text.to_string();
    let patterns = [
        r#"(?i)\b(api[_-]?key|token|password|passwd|secret)\b\s*[:=]\s*['"]?[^'"\s]+"#,
        r"\bsk-[A-Za-z0-9_-]{16,}\b",
        r"\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b",
    ];
    for pattern in patterns {
        if let Ok(regex) = regex::Regex::new(pattern) {
            redacted = regex.replace_all(&redacted, "[REDACTED]").to_string();
        }
    }
    truncate_chars(redacted.trim(), max_chars)
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    value.chars().take(max_chars).collect()
}

fn normalize_tag(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .take(40)
        .collect()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPromptHistoryRequest {
    pub workspace_path: String,
    pub scope: Option<PromptAssetScope>,
    pub session_id: Option<String>,
    pub agent_type: Option<String>,
    pub pinned: Option<bool>,
    pub query: Option<String>,
    pub limit: Option<usize>,
}

#[tauri::command]
pub async fn list_prompt_history(
    request: ListPromptHistoryRequest,
) -> Result<PromptHistorySummary, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    let query = PromptHistoryQuery {
        workspace_path: workspace.to_string_lossy().to_string(),
        session_id: request.session_id,
        agent_type: request.agent_type,
        pinned: request.pinned,
        query: request.query,
        limit: request.limit,
    };
    match request.scope.unwrap_or(PromptAssetScope::Project) {
        PromptAssetScope::User => PromptHistoryStore::list_all_projects(query),
        PromptAssetScope::Project | PromptAssetScope::Workspace => PromptHistoryStore::list(query),
    }
    .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotePromptHistoryToAssetRequest {
    pub workspace_path: String,
    pub source_workspace_path: Option<String>,
    pub history_event_id: String,
    pub metadata: PromptAssetMetadata,
    pub body: Option<String>,
    pub relative_path: Option<String>,
}

#[tauri::command]
pub async fn promote_prompt_history_to_asset(
    request: PromotePromptHistoryToAssetRequest,
) -> Result<PromptAsset, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    let source_workspace = workspace_root_from_request(
        request
            .source_workspace_path
            .as_deref()
            .unwrap_or(&request.workspace_path),
    )?;
    let event = PromptHistoryStore::get(source_workspace.as_path(), &request.history_event_id)
        .map_err(|e| e.to_string())?;
    let mut metadata = request.metadata;
    metadata.source_history_event_id = Some(event.id.clone());
    metadata.source_session_id = Some(event.session_id.clone());
    metadata.source_turn_id = event.turn_id.clone();
    let scope = metadata.scope;
    let body = request.body.unwrap_or_else(|| event.text.clone());
    let asset = PromptAssetStore::save_asset(
        workspace.as_path(),
        scope,
        metadata,
        &body,
        request.relative_path.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    let summary = PromptAssetSummary::from(&asset);
    if let Err(error) =
        PromptValueStore::record_saved_as_asset(workspace.as_path(), &event, &summary)
    {
        log::warn!(
            "Failed to record prompt value asset signal: workspace_path={} history_event_id={} error={}",
            workspace.display(),
            event.id,
            error
        );
    }
    Ok(asset)
}
