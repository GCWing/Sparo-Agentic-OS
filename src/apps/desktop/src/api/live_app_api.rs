//! Live App API — Tauri commands for CRUD, JS Worker, and dialog.

use crate::api::app_state::AppState;
use crate::api::session_storage_path::{
    desktop_effective_session_storage_path, SessionStorageScopeDto,
};
use bitfun_core::agent_app::AgentAppManager;
use bitfun_core::agentic::agents::build_ppt_live_private_prompt;
use bitfun_core::agentic::coordination::{
    ConversationCoordinator, DialogScheduler, DialogSubmissionPolicy, DialogSubmitOutcome,
    DialogTriggerSource,
};
use bitfun_core::agentic::core::{SessionConfig, SessionState, SessionStorageScope};
use bitfun_core::agentic_os::work::{default_work_store, WorkService};
use bitfun_core::bridge_app::{
    BridgeAppConsumer, BridgeAppConsumerKind, BridgeAppManager, BridgeAppRunResult,
    BridgeAppRunStatus,
};
use bitfun_core::infrastructure::events::{emit_global_event, BackendEvent};
use bitfun_core::live_app::{
    dispatch_host, is_host_primitive, InstallResult as CoreInstallResult, LiveApp,
    LiveAppAiContext, LiveAppBackendBinding, LiveAppBackendKind, LiveAppBuildMode, LiveAppEntry,
    LiveAppI18n, LiveAppMeta, LiveAppPermissions, LiveAppRuntimeIssue, LiveAppRuntimeIssueSeverity,
    LiveAppRuntimeLog, LiveAppRuntimeLogLevel, LiveAppSource, LiveAppSourceFile,
    LiveAppSourceFileKind,
};
use bitfun_core::service::config::types::GlobalConfig;
use bitfun_core::util::types::Message;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

// ============== Request/Response DTOs ==============

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLiveAppRequest {
    pub name: String,
    pub description: String,
    pub icon: String,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub i18n: LiveAppI18n,
    pub source: LiveAppSourceDto,
    #[serde(default)]
    pub permissions: LiveAppPermissions,
    #[serde(default)]
    pub backends: Vec<LiveAppBackendBinding>,
    pub ai_context: Option<LiveAppAiContext>,
    pub permission_rationale: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordRecentLiveAppRequest {
    pub app_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppSourceDto {
    pub html: String,
    pub css: String,
    #[serde(default)]
    pub ui_js: String,
    #[serde(default)]
    pub esm_dependencies: Vec<EsmDepDto>,
    #[serde(default = "empty_i18n_messages")]
    pub i18n_messages: Value,
    #[serde(default)]
    pub worker_js: String,
    #[serde(default)]
    pub npm_dependencies: Vec<NpmDepDto>,
    #[serde(default)]
    pub entry: LiveAppEntryDto,
    #[serde(default)]
    pub source_files: Vec<LiveAppSourceFileDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppEntryDto {
    #[serde(default = "default_ui_entry")]
    pub ui_entry: String,
    #[serde(default)]
    pub worker_entry: Option<String>,
    #[serde(default)]
    pub style_entries: Vec<String>,
    #[serde(default)]
    pub build_mode: LiveAppBuildMode,
}

impl Default for LiveAppEntryDto {
    fn default() -> Self {
        Self {
            ui_entry: default_ui_entry(),
            worker_entry: Some("worker.js".to_string()),
            style_entries: vec!["style.css".to_string()],
            build_mode: LiveAppBuildMode::InlineLegacy,
        }
    }
}

fn default_ui_entry() -> String {
    "ui.js".to_string()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppSourceFileDto {
    pub path: String,
    #[serde(default)]
    pub kind: LiveAppSourceFileKind,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct EsmDepDto {
    pub name: String,
    pub version: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NpmDepDto {
    pub name: String,
    pub version: String,
}

fn empty_i18n_messages() -> Value {
    json!({})
}

impl From<LiveAppSourceDto> for LiveAppSource {
    fn from(d: LiveAppSourceDto) -> Self {
        LiveAppSource {
            html: d.html,
            css: d.css,
            ui_js: d.ui_js,
            esm_dependencies: d
                .esm_dependencies
                .into_iter()
                .map(|x| bitfun_core::live_app::EsmDep {
                    name: x.name,
                    version: x.version,
                    url: x.url,
                })
                .collect(),
            i18n_messages: d.i18n_messages,
            worker_js: d.worker_js,
            npm_dependencies: d
                .npm_dependencies
                .into_iter()
                .map(|x| bitfun_core::live_app::NpmDep {
                    name: x.name,
                    version: x.version,
                })
                .collect(),
            entry: LiveAppEntry {
                ui_entry: d.entry.ui_entry,
                worker_entry: d.entry.worker_entry,
                style_entries: d.entry.style_entries,
                build_mode: d.entry.build_mode,
            },
            source_files: d
                .source_files
                .into_iter()
                .map(|file| LiveAppSourceFile {
                    path: file.path,
                    kind: file.kind,
                    content: file.content,
                })
                .collect(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLiveAppRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
    pub i18n: Option<LiveAppI18n>,
    pub source: Option<LiveAppSourceDto>,
    pub permissions: Option<LiveAppPermissions>,
    pub backends: Option<Vec<LiveAppBackendBinding>>,
    pub ai_context: Option<LiveAppAiContext>,
    pub permission_rationale: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetLiveAppRequest {
    pub app_id: String,
    pub theme: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppWorkerCallRequest {
    pub app_id: String,
    pub method: String,
    pub params: Value,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppRecompileRequest {
    pub app_id: String,
    pub theme: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppImportFromPathRequest {
    pub path: String,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppSyncFromFsRequest {
    pub app_id: String,
    pub theme: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RuntimeStatus {
    pub available: bool,
    pub kind: Option<String>,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RecompileResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppRuntimeIssueRequest {
    pub app_id: String,
    pub severity: Option<LiveAppRuntimeIssueSeverity>,
    pub message: String,
    pub source: Option<String>,
    pub stack: Option<String>,
    pub category: Option<String>,
    pub timestamp_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppRuntimeLogRequest {
    pub app_id: String,
    pub level: Option<LiveAppRuntimeLogLevel>,
    pub category: Option<String>,
    pub message: String,
    pub source: Option<String>,
    pub stack: Option<String>,
    pub details: Option<Value>,
    pub timestamp_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppCaptureMatrixRequest {
    pub app_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppClearRuntimeIssuesRequest {
    pub app_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppBackendCallRequest {
    pub app_id: String,
    pub target: String,
    #[serde(default)]
    pub input: Value,
    #[serde(default)]
    pub entity_id: Option<String>,
    #[serde(default)]
    pub idempotency_key: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppBackendCallResponse {
    pub session_id: String,
    pub turn_id: String,
    pub action_run_id: String,
    pub status: String,
    pub backend_id: String,
    pub action: String,
    pub agent_type: String,
    pub backend_kind: String,
    pub backend_app_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bridge_result: Option<BridgeAppRunResult>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppBackendRunRequest {
    pub app_id: String,
    pub action_run_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub turn_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppPptTurnTextRequest {
    pub session_id: String,
    pub turn_id: String,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppPptTurnTextResponse {
    pub text: String,
}

fn live_app_payload(app: &LiveApp, reason: &str) -> Value {
    json!({
        "id": app.id,
        "name": app.name,
        "version": app.version,
        "updatedAt": app.updated_at,
        "reason": reason,
        "runtime": {
            "sourceRevision": app.runtime.source_revision,
            "depsRevision": app.runtime.deps_revision,
            "depsDirty": app.runtime.deps_dirty,
            "workerRestartRequired": app.runtime.worker_restart_required,
            "uiRecompileRequired": app.runtime.ui_recompile_required,
        }
    })
}

async fn emit_live_app_event(event_name: &str, payload: Value) {
    let _ = emit_global_event(BackendEvent::Custom {
        event_name: event_name.to_string(),
        payload,
    })
    .await;
}

async fn sync_live_app_work_titles(app: &LiveApp) {
    let service = match default_work_store() {
        Ok(store) => WorkService::new(store),
        Err(error) => {
            log::warn!(
                "Failed to access Work store for Live App title sync: app_id={}, error={}",
                app.id,
                error
            );
            return;
        }
    };

    if let Err(error) = service.sync_title_from_live_app(&app.id, &app.name).await {
        log::warn!(
            "Failed to sync Live App Work titles: app_id={}, error={}",
            app.id,
            error
        );
    }
}

async fn emit_live_app_runtime_issues_cleared(app_id: &str) {
    emit_live_app_event("liveapp-runtime-errors-cleared", json!({ "appId": app_id })).await;
}

fn workspace_root_from_input(workspace_path: Option<&str>) -> Option<PathBuf> {
    workspace_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

fn live_app_backend_owner(app_id: &str, backend_id: &str, entity_id: Option<&str>) -> String {
    match entity_id.map(str::trim).filter(|value| !value.is_empty()) {
        Some(entity_id) => format!("live-app-backend:{}:{}:{}", app_id, backend_id, entity_id),
        None => format!("live-app-backend:{}:{}", app_id, backend_id),
    }
}

fn parse_backend_target(target: &str) -> Result<(&str, &str), String> {
    let trimmed = target.trim();
    let Some((backend_id, action_name)) = trimmed.split_once('.') else {
        return Err("Backend target must use '<backendId>.<actionName>'".to_string());
    };
    if backend_id.trim().is_empty() || action_name.trim().is_empty() {
        return Err("Backend target must include both backend id and action name".to_string());
    }
    Ok((backend_id.trim(), action_name.trim()))
}

async fn maybe_stop_worker(state: &State<'_, AppState>, app: &LiveApp) {
    if app.runtime.worker_restart_required {
        if let Some(ref pool) = state.js_worker_pool {
            pool.stop(&app.id).await;
        }
        emit_live_app_event(
            "liveapp-worker-stopped",
            json!({ "id": app.id, "reason": "pending-restart" }),
        )
        .await;
    }
}

async fn ensure_worker_dependencies(
    state: &State<'_, AppState>,
    app_id: &str,
    app: &mut LiveApp,
) -> Result<bool, String> {
    let pool = state
        .js_worker_pool
        .as_ref()
        .ok_or_else(|| "JS Worker pool not initialized".to_string())?;

    let needs_install = !app.source.npm_dependencies.is_empty()
        && (app.runtime.deps_dirty || !pool.has_installed_deps(app_id));
    if !needs_install {
        return Ok(false);
    }

    let install = pool
        .install_deps(app_id, &app.source.npm_dependencies)
        .await
        .map_err(|e| e.to_string())?;
    if !install.success {
        let details = if !install.stderr.trim().is_empty() {
            install.stderr
        } else {
            install.stdout
        };
        return Err(format!(
            "Live App dependencies install failed for {app_id}: {}",
            details.trim()
        ));
    }

    pool.stop(app_id).await;
    *app = state
        .live_app_manager
        .mark_deps_installed(app_id)
        .await
        .map_err(|e| e.to_string())?;
    emit_live_app_event("liveapp-updated", live_app_payload(app, "deps-installed")).await;
    Ok(true)
}

// ============== App management commands ==============

#[tauri::command]
pub async fn list_live_apps(state: State<'_, AppState>) -> Result<Vec<LiveAppMeta>, String> {
    state
        .live_app_manager
        .list()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_recent_live_apps(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    state
        .live_app_manager
        .list_recent_opened()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn record_recent_live_app(
    state: State<'_, AppState>,
    request: RecordRecentLiveAppRequest,
) -> Result<Vec<String>, String> {
    state
        .live_app_manager
        .record_recent_opened(&request.app_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_live_app(
    state: State<'_, AppState>,
    request: GetLiveAppRequest,
) -> Result<LiveApp, String> {
    let mut app = state
        .live_app_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;

    let theme_type = request.theme.as_deref().unwrap_or("dark");
    let workspace_root = workspace_root_from_input(request.workspace_path.as_deref());
    match state.live_app_manager.compile_source(
        &request.app_id,
        &app.source,
        &app.permissions,
        theme_type,
        workspace_root.as_deref(),
    ) {
        Ok(html) => app.compiled_html = html,
        Err(e) => log::warn!("get_live_app: recompile failed, using cached: {}", e),
    }
    Ok(app)
}

#[tauri::command]
pub async fn create_live_app(
    state: State<'_, AppState>,
    request: CreateLiveAppRequest,
) -> Result<LiveApp, String> {
    let source: LiveAppSource = request.source.into();
    let workspace_root = workspace_root_from_input(request.workspace_path.as_deref());
    let app = state
        .live_app_manager
        .create(
            request.name,
            request.description,
            request.icon,
            request.category,
            request.tags,
            request.i18n,
            source,
            request.permissions,
            request.backends,
            request.ai_context,
            request.permission_rationale,
            workspace_root.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())?;
    sync_live_app_work_titles(&app).await;
    emit_live_app_event("liveapp-created", live_app_payload(&app, "create")).await;
    Ok(app)
}

#[tauri::command]
pub async fn update_live_app(
    state: State<'_, AppState>,
    app_id: String,
    request: UpdateLiveAppRequest,
) -> Result<LiveApp, String> {
    let workspace_root = workspace_root_from_input(request.workspace_path.as_deref());
    let app = state
        .live_app_manager
        .update(
            &app_id,
            request.name,
            request.description,
            request.icon,
            request.category,
            request.tags,
            request.i18n,
            request.source.map(Into::into),
            request.permissions,
            request.backends,
            request.ai_context,
            request.permission_rationale,
            workspace_root.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())?;
    maybe_stop_worker(&state, &app).await;
    emit_live_app_runtime_issues_cleared(&app.id).await;
    sync_live_app_work_titles(&app).await;
    emit_live_app_event("liveapp-updated", live_app_payload(&app, "update")).await;
    Ok(app)
}

#[tauri::command]
pub async fn delete_live_app(state: State<'_, AppState>, app_id: String) -> Result<(), String> {
    if let Some(ref pool) = state.js_worker_pool {
        pool.stop(app_id.as_str()).await;
    }
    state
        .live_app_manager
        .delete(&app_id)
        .await
        .map_err(|e| e.to_string())?;
    emit_live_app_event(
        "liveapp-deleted",
        json!({ "id": app_id, "reason": "delete" }),
    )
    .await;
    Ok(())
}

#[tauri::command]
pub async fn get_live_app_versions(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<Vec<u32>, String> {
    state
        .live_app_manager
        .list_versions(&app_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rollback_live_app(
    state: State<'_, AppState>,
    app_id: String,
    version: u32,
) -> Result<LiveApp, String> {
    let app = state
        .live_app_manager
        .rollback(&app_id, version)
        .await
        .map_err(|e| e.to_string())?;
    maybe_stop_worker(&state, &app).await;
    emit_live_app_runtime_issues_cleared(&app.id).await;
    sync_live_app_work_titles(&app).await;
    emit_live_app_event("liveapp-rolled-back", live_app_payload(&app, "rollback")).await;
    emit_live_app_event("liveapp-updated", live_app_payload(&app, "rollback")).await;
    Ok(app)
}

#[tauri::command]
pub async fn get_live_app_storage(
    state: State<'_, AppState>,
    app_id: String,
    key: String,
) -> Result<Value, String> {
    state
        .live_app_manager
        .get_storage(&app_id, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_live_app_storage(
    state: State<'_, AppState>,
    app_id: String,
    key: String,
    value: Value,
) -> Result<(), String> {
    state
        .live_app_manager
        .set_storage(&app_id, &key, value)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn grant_live_app_workspace(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<(), String> {
    state.live_app_manager.grant_workspace(&app_id).await;
    Ok(())
}

#[tauri::command]
pub async fn grant_live_app_path(
    state: State<'_, AppState>,
    app_id: String,
    path: String,
) -> Result<(), String> {
    state
        .live_app_manager
        .grant_path(&app_id, PathBuf::from(path))
        .await;
    Ok(())
}

// ============== JS Worker & Runtime ==============

#[tauri::command]
pub async fn live_app_runtime_status(state: State<'_, AppState>) -> Result<RuntimeStatus, String> {
    let Some(ref pool) = state.js_worker_pool else {
        return Ok(RuntimeStatus {
            available: false,
            kind: None,
            version: None,
            path: None,
        });
    };
    let info = pool.runtime_info();
    Ok(RuntimeStatus {
        available: true,
        kind: Some(match info.kind {
            bitfun_core::live_app::RuntimeKind::Bun => "bun".to_string(),
            bitfun_core::live_app::RuntimeKind::Node => "node".to_string(),
        }),
        version: Some(info.version.clone()),
        path: Some(info.path.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub async fn live_app_worker_call(
    state: State<'_, AppState>,
    request: LiveAppWorkerCallRequest,
) -> Result<Value, String> {
    if request.method == "storage.get" {
        let key = request
            .params
            .get("key")
            .and_then(Value::as_str)
            .ok_or_else(|| "storage.get requires string key".to_string())?;
        return state
            .live_app_manager
            .get_storage(&request.app_id, key)
            .await
            .map_err(|e| e.to_string());
    }
    if request.method == "storage.set" {
        let key = request
            .params
            .get("key")
            .and_then(Value::as_str)
            .ok_or_else(|| "storage.set requires string key".to_string())?;
        let value = request.params.get("value").cloned().unwrap_or(Value::Null);
        state
            .live_app_manager
            .set_storage(&request.app_id, key, value)
            .await
            .map_err(|e| e.to_string())?;
        return Ok(Value::Null);
    }

    if is_host_primitive(&request.method) {
        let app = state
            .live_app_manager
            .get(&request.app_id)
            .await
            .map_err(|e| e.to_string())?;
        let workspace_root = workspace_root_from_input(request.workspace_path.as_deref());
        let granted_paths = state
            .live_app_manager
            .granted_paths_for_app(&request.app_id)
            .await;
        let app_data_dir = state
            .live_app_manager
            .path_manager()
            .live_app_dir(&request.app_id);
        return dispatch_host(
            &app.permissions,
            &request.app_id,
            &app_data_dir,
            workspace_root.as_deref(),
            &granted_paths,
            &request.method,
            request.params,
        )
        .await
        .map_err(|e| e.to_string());
    }

    let pool = state
        .js_worker_pool
        .as_ref()
        .ok_or_else(|| "JS Worker pool not initialized".to_string())?;
    let was_running = pool.is_running(&request.app_id).await;
    let mut app = state
        .live_app_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;
    let deps_installed = ensure_worker_dependencies(&state, &request.app_id, &mut app).await?;
    let workspace_root = workspace_root_from_input(request.workspace_path.as_deref());
    let policy = state
        .live_app_manager
        .resolve_policy_for_app(&request.app_id, &app.permissions, workspace_root.as_deref())
        .await;
    let policy_json = serde_json::to_string(&policy).map_err(|e| e.to_string())?;
    let worker_revision = state
        .live_app_manager
        .build_worker_revision(&app, &policy_json);
    let should_emit_restart = !was_running || deps_installed || app.runtime.worker_restart_required;
    let result = pool
        .call(
            &request.app_id,
            &worker_revision,
            &policy_json,
            app.permissions.node.as_ref(),
            &request.method,
            request.params,
        )
        .await
        .map_err(|e| e.to_string())?;
    if should_emit_restart {
        let app = state
            .live_app_manager
            .clear_worker_restart_required(&request.app_id)
            .await
            .map_err(|e| e.to_string())?;
        emit_live_app_event(
            "liveapp-worker-restarted",
            live_app_payload(
                &app,
                if deps_installed {
                    "deps-installed"
                } else {
                    "runtime-restart"
                },
            ),
        )
        .await;
    }
    Ok(result)
}

#[tauri::command]
pub async fn live_app_worker_stop(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<(), String> {
    if let Some(ref pool) = state.js_worker_pool {
        pool.stop(&app_id).await;
    }
    emit_live_app_event(
        "liveapp-worker-stopped",
        json!({ "id": app_id, "reason": "manual-stop" }),
    )
    .await;
    Ok(())
}

#[tauri::command]
pub async fn live_app_worker_list_running(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let Some(ref pool) = state.js_worker_pool else {
        return Ok(vec![]);
    };
    Ok(pool.list_running().await)
}

#[tauri::command]
pub async fn live_app_install_deps(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<CoreInstallResult, String> {
    let pool = state
        .js_worker_pool
        .as_ref()
        .ok_or_else(|| "JS Worker pool not initialized".to_string())?;
    let app = state
        .live_app_manager
        .get(&app_id)
        .await
        .map_err(|e| e.to_string())?;
    let install = pool
        .install_deps(&app_id, &app.source.npm_dependencies)
        .await
        .map_err(|e| e.to_string())?;
    if install.success {
        pool.stop(&app_id).await;
        let app = state
            .live_app_manager
            .mark_deps_installed(&app_id)
            .await
            .map_err(|e| e.to_string())?;
        emit_live_app_event("liveapp-updated", live_app_payload(&app, "deps-installed")).await;
    }
    Ok(install)
}

#[tauri::command]
pub async fn live_app_recompile(
    state: State<'_, AppState>,
    request: LiveAppRecompileRequest,
) -> Result<RecompileResult, String> {
    let theme_type = request.theme.as_deref().unwrap_or("dark");
    let workspace_root = workspace_root_from_input(request.workspace_path.as_deref());
    let app = state
        .live_app_manager
        .recompile(&request.app_id, theme_type, workspace_root.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    emit_live_app_runtime_issues_cleared(&app.id).await;
    emit_live_app_event("liveapp-recompiled", live_app_payload(&app, "recompile")).await;
    emit_live_app_event("liveapp-updated", live_app_payload(&app, "recompile")).await;
    Ok(RecompileResult {
        success: true,
        warnings: None,
    })
}

#[tauri::command]
pub async fn live_app_dialog_message(
    _state: State<'_, AppState>,
    _app_id: String,
    _options: Value,
) -> Result<Value, String> {
    // Tauri dialog is handled by frontend useLiveAppBridge via @tauri-apps/plugin-dialog.
    // This command can be used if we want backend to show message box; for now return not implemented.
    Err("Use dialog from frontend bridge".to_string())
}

#[tauri::command]
pub async fn live_app_import_from_path(
    state: State<'_, AppState>,
    request: LiveAppImportFromPathRequest,
) -> Result<LiveApp, String> {
    let path_buf = PathBuf::from(&request.path);
    let workspace_root = workspace_root_from_input(request.workspace_path.as_deref());
    let app = state
        .live_app_manager
        .import_from_path(path_buf, workspace_root.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    maybe_stop_worker(&state, &app).await;
    sync_live_app_work_titles(&app).await;
    emit_live_app_event("liveapp-created", live_app_payload(&app, "import")).await;
    Ok(app)
}

#[tauri::command]
pub async fn live_app_sync_from_fs(
    state: State<'_, AppState>,
    request: LiveAppSyncFromFsRequest,
) -> Result<LiveApp, String> {
    let theme_type = request.theme.as_deref().unwrap_or("dark");
    let workspace_root = workspace_root_from_input(request.workspace_path.as_deref());
    let app = state
        .live_app_manager
        .sync_from_fs(&request.app_id, theme_type, workspace_root.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    maybe_stop_worker(&state, &app).await;
    emit_live_app_runtime_issues_cleared(&app.id).await;
    sync_live_app_work_titles(&app).await;
    emit_live_app_event("liveapp-updated", live_app_payload(&app, "sync-from-fs")).await;
    Ok(app)
}

#[tauri::command]
pub async fn live_app_report_runtime_issue(
    state: State<'_, AppState>,
    request: LiveAppRuntimeIssueRequest,
) -> Result<(), String> {
    let issue = LiveAppRuntimeIssue {
        app_id: request.app_id,
        severity: request
            .severity
            .unwrap_or(LiveAppRuntimeIssueSeverity::Fatal),
        message: request.message,
        source: request.source,
        stack: request.stack,
        category: request.category,
        timestamp_ms: request.timestamp_ms.unwrap_or_else(|| now_ms() as i64),
    };
    state
        .live_app_manager
        .record_runtime_issue(issue.clone())
        .await;
    emit_live_app_event("liveapp-runtime-error", json!(issue)).await;
    Ok(())
}

#[tauri::command]
pub async fn live_app_report_runtime_log(
    state: State<'_, AppState>,
    request: LiveAppRuntimeLogRequest,
) -> Result<(), String> {
    let log_entry = LiveAppRuntimeLog {
        app_id: request.app_id,
        level: request.level.unwrap_or(LiveAppRuntimeLogLevel::Info),
        category: request.category.unwrap_or_else(|| "runtime".to_string()),
        message: request.message,
        source: request.source,
        stack: request.stack,
        details: request.details,
        timestamp_ms: request.timestamp_ms.unwrap_or_else(|| now_ms() as i64),
    };
    state.live_app_manager.record_runtime_log(log_entry).await;
    Ok(())
}

#[tauri::command]
pub async fn live_app_clear_runtime_issues(
    state: State<'_, AppState>,
    request: LiveAppClearRuntimeIssuesRequest,
) -> Result<(), String> {
    state
        .live_app_manager
        .clear_runtime_issues(&request.app_id)
        .await;
    emit_live_app_runtime_issues_cleared(&request.app_id).await;
    Ok(())
}

#[tauri::command]
pub async fn live_app_capture_matrix(
    state: State<'_, AppState>,
    request: LiveAppCaptureMatrixRequest,
) -> Result<Value, String> {
    let app = state
        .live_app_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;
    let timestamp = now_ms() as i64;
    let review_dir = state
        .live_app_manager
        .path_manager()
        .live_app_dir(&request.app_id)
        .join("_review")
        .join(timestamp.to_string());
    tokio::fs::create_dir_all(&review_dir)
        .await
        .map_err(|e| e.to_string())?;
    let states = vec![
        json!({ "theme": "light", "locale": "zh-CN", "path": Value::Null, "status": "capture_requested" }),
        json!({ "theme": "light", "locale": "en-US", "path": Value::Null, "status": "capture_requested" }),
        json!({ "theme": "dark", "locale": "zh-CN", "path": Value::Null, "status": "capture_requested" }),
        json!({ "theme": "dark", "locale": "en-US", "path": Value::Null, "status": "capture_requested" }),
    ];
    let manifest = json!({
        "appId": app.id,
        "appName": app.name,
        "createdAt": timestamp,
        "status": "capture_requested",
        "screenshots": states,
    });
    let manifest_path = review_dir.join("manifest.json");
    tokio::fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .await
    .map_err(|e| e.to_string())?;
    let result = json!({
        "manifestPath": manifest_path.to_string_lossy(),
        "reviewDir": review_dir.to_string_lossy(),
        "manifest": manifest,
    });
    emit_live_app_event("liveapp-screenshot-matrix-requested", result.clone()).await;
    Ok(result)
}

// ============== AI commands ==============

/// Active AI stream cancellation flags: stream_id → cancel flag.
static AI_STREAM_REGISTRY: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

/// Per-app rate limiter state: app_id → (request_count, window_start_ms).
static AI_RATE_LIMITER: OnceLock<Mutex<HashMap<String, (u32, u64)>>> = OnceLock::new();
static LIVE_APP_AGENTIC_TURN_COUNTER: AtomicU64 = AtomicU64::new(1);

fn ai_stream_registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    AI_STREAM_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn ai_rate_limiter() -> &'static Mutex<HashMap<String, (u32, u64)>> {
    AI_RATE_LIMITER.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Check and increment the rate limiter for a given app. Returns Err if rate limit exceeded.
fn check_rate_limit(app_id: &str, rate_limit_per_minute: u32) -> Result<(), String> {
    if rate_limit_per_minute == 0 {
        return Ok(());
    }
    let now = now_ms();
    let window_ms: u64 = 60_000;
    let mut map = ai_rate_limiter().lock().unwrap_or_else(|p| p.into_inner());
    let entry = map.entry(app_id.to_string()).or_insert((0, now));
    if now - entry.1 >= window_ms {
        *entry = (1, now);
    } else {
        entry.0 += 1;
        if entry.0 > rate_limit_per_minute {
            return Err(format!(
                "AI rate limit exceeded: max {} requests/minute",
                rate_limit_per_minute
            ));
        }
    }
    Ok(())
}

/// Validate the requested model against the app's allowed_models list.
/// Returns the resolved model id (may be "primary" / "fast") to pass to AIClientFactory.
fn validate_model(
    model: Option<&str>,
    ai_perms: &bitfun_core::live_app::AiPermissions,
) -> Result<String, String> {
    let requested = model.unwrap_or("primary");
    if let Some(ref allowed) = ai_perms.allowed_models {
        if !allowed.is_empty() && !allowed.iter().any(|m| m == requested) {
            return Err(format!(
                "Model '{}' is not allowed by this Live App's AI permissions",
                requested
            ));
        }
    }
    Ok(requested.to_string())
}

// ---- Request/Response DTOs for AI commands ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppAiChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppAiCompleteRequest {
    pub app_id: String,
    pub prompt: String,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppAiCompleteResponse {
    pub text: String,
    pub usage: Option<LiveAppAiUsage>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppAiUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppAiChatRequest {
    pub app_id: String,
    pub messages: Vec<LiveAppAiChatMessage>,
    pub stream_id: String,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppAiChatStartedResponse {
    pub stream_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppAiCancelRequest {
    pub app_id: String,
    pub stream_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppAiListModelsRequest {
    pub app_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppAiModelInfo {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub is_default: bool,
}

// ---- Payload structs for Tauri events ----

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AiStreamChunkPayload {
    pub app_id: String,
    pub stream_id: String,
    #[serde(rename = "type")]
    pub payload_type: String,
    pub data: serde_json::Value,
}

// ---- Helper: build Message list from request ----

fn build_messages_for_ai(
    system_prompt: Option<&str>,
    chat_messages: &[LiveAppAiChatMessage],
) -> Vec<Message> {
    let mut msgs = Vec::new();
    if let Some(sp) = system_prompt {
        if !sp.is_empty() {
            msgs.push(Message::system(sp.to_string()));
        }
    }
    for m in chat_messages {
        let role = m.role.to_lowercase();
        if role == "assistant" {
            msgs.push(Message::assistant(m.content.clone()));
        } else {
            // Treat any unrecognized role as "user" for safety
            msgs.push(Message::user(m.content.clone()));
        }
    }
    msgs
}

// ---- Commands ----

/// Non-streaming AI completion — waits for the full response before returning.
#[tauri::command]
pub async fn live_app_ai_complete(
    state: State<'_, AppState>,
    request: LiveAppAiCompleteRequest,
) -> Result<LiveAppAiCompleteResponse, String> {
    let app = state
        .live_app_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;

    let ai_perms = app
        .permissions
        .ai
        .as_ref()
        .ok_or("AI access is not enabled for this Live App")?;

    if !ai_perms.enabled {
        return Err("AI access is not enabled for this Live App".to_string());
    }

    let rate_limit = ai_perms.rate_limit_per_minute.unwrap_or(0);
    check_rate_limit(&request.app_id, rate_limit)?;

    let model_ref = validate_model(request.model.as_deref(), ai_perms)?;

    let ai_client = state
        .ai_client_factory
        .get_client_resolved(&model_ref)
        .await
        .map_err(|e| format!("Failed to get AI client: {}", e))?;

    let messages = build_messages_for_ai(
        request.system_prompt.as_deref(),
        &[LiveAppAiChatMessage {
            role: "user".to_string(),
            content: request.prompt.clone(),
        }],
    );

    let stream_response = ai_client
        .send_message_stream(messages, None)
        .await
        .map_err(|e| format!("AI request failed: {}", e))?;

    let mut stream = stream_response.stream;
    let mut full_text = String::new();
    let mut usage: Option<LiveAppAiUsage> = None;

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                if let Some(text) = chunk.text {
                    full_text.push_str(&text);
                }
                if let Some(u) = chunk.usage {
                    usage = Some(LiveAppAiUsage {
                        prompt_tokens: u.prompt_token_count,
                        completion_tokens: u.candidates_token_count,
                        total_tokens: u.total_token_count,
                    });
                }
            }
            Err(e) => {
                return Err(format!("AI stream error: {}", e));
            }
        }
    }

    Ok(LiveAppAiCompleteResponse {
        text: full_text,
        usage,
    })
}

/// Streaming AI chat — returns immediately, emits chunks via "liveapp://ai-stream" events.
#[tauri::command]
pub async fn live_app_ai_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    request: LiveAppAiChatRequest,
) -> Result<LiveAppAiChatStartedResponse, String> {
    if request.stream_id.trim().is_empty() {
        return Err("streamId is required".to_string());
    }
    if request.messages.is_empty() {
        return Err("messages must not be empty".to_string());
    }

    let live_app = state
        .live_app_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;

    let ai_perms = live_app
        .permissions
        .ai
        .as_ref()
        .ok_or("AI access is not enabled for this Live App")?;

    if !ai_perms.enabled {
        return Err("AI access is not enabled for this Live App".to_string());
    }

    let rate_limit = ai_perms.rate_limit_per_minute.unwrap_or(0);
    check_rate_limit(&request.app_id, rate_limit)?;

    let model_ref = validate_model(request.model.as_deref(), ai_perms)?;

    let ai_client = state
        .ai_client_factory
        .get_client_resolved(&model_ref)
        .await
        .map_err(|e| format!("Failed to get AI client: {}", e))?;

    let messages = build_messages_for_ai(request.system_prompt.as_deref(), &request.messages);

    let stream_response = ai_client
        .send_message_stream(messages, None)
        .await
        .map_err(|e| format!("AI request failed: {}", e))?;

    // Register a cancellation flag for this stream
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut registry = ai_stream_registry()
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        registry.insert(request.stream_id.clone(), cancel_flag.clone());
    }

    let stream_id = request.stream_id.clone();
    let app_id = request.app_id.clone();
    let app_handle = app.clone();

    tokio::spawn(async move {
        let mut stream = stream_response.stream;
        let mut full_text = String::new();
        let mut last_usage: Option<LiveAppAiUsage> = None;

        while let Some(chunk_result) = stream.next().await {
            // Check cancellation
            if cancel_flag.load(Ordering::SeqCst) {
                break;
            }

            match chunk_result {
                Ok(chunk) => {
                    let has_text = chunk.text.as_ref().map(|t| !t.is_empty()).unwrap_or(false);
                    let has_reasoning = chunk
                        .reasoning_content
                        .as_ref()
                        .map(|t| !t.is_empty())
                        .unwrap_or(false);

                    if has_text || has_reasoning {
                        if let Some(ref t) = chunk.text {
                            full_text.push_str(t);
                        }
                        let payload = AiStreamChunkPayload {
                            app_id: app_id.clone(),
                            stream_id: stream_id.clone(),
                            payload_type: "chunk".to_string(),
                            data: json!({
                                "text": chunk.text,
                                "reasoningContent": chunk.reasoning_content,
                            }),
                        };
                        if let Err(e) = app_handle.emit("liveapp://ai-stream", &payload) {
                            log::warn!("Failed to emit AI stream chunk: {}", e);
                        }
                    }

                    if let Some(u) = chunk.usage {
                        last_usage = Some(LiveAppAiUsage {
                            prompt_tokens: u.prompt_token_count,
                            completion_tokens: u.candidates_token_count,
                            total_tokens: u.total_token_count,
                        });
                    }

                    if let Some(ref reason) = chunk.finish_reason {
                        if !reason.is_empty() && reason != "null" {
                            break;
                        }
                    }
                }
                Err(e) => {
                    let payload = AiStreamChunkPayload {
                        app_id: app_id.clone(),
                        stream_id: stream_id.clone(),
                        payload_type: "error".to_string(),
                        data: json!({ "message": e.to_string() }),
                    };
                    let _ = app_handle.emit("liveapp://ai-stream", &payload);
                    // Clean up registry
                    let mut registry = ai_stream_registry()
                        .lock()
                        .unwrap_or_else(|p| p.into_inner());
                    registry.remove(&stream_id);
                    return;
                }
            }
        }

        // Emit done
        let usage_val = last_usage.map(|u| {
            json!({
                "promptTokens": u.prompt_tokens,
                "completionTokens": u.completion_tokens,
                "totalTokens": u.total_tokens,
            })
        });
        let done_payload = AiStreamChunkPayload {
            app_id: app_id.clone(),
            stream_id: stream_id.clone(),
            payload_type: "done".to_string(),
            data: json!({
                "fullText": full_text,
                "usage": usage_val,
            }),
        };
        let _ = app_handle.emit("liveapp://ai-stream", &done_payload);

        // Clean up registry
        let mut registry = ai_stream_registry()
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        registry.remove(&stream_id);
    });

    Ok(LiveAppAiChatStartedResponse {
        stream_id: request.stream_id,
    })
}

/// Cancel an ongoing AI stream.
#[tauri::command]
pub async fn live_app_ai_cancel(
    _state: State<'_, AppState>,
    request: LiveAppAiCancelRequest,
) -> Result<(), String> {
    let mut registry = ai_stream_registry()
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    if let Some(flag) = registry.get(&request.stream_id) {
        flag.store(true, Ordering::SeqCst);
    }
    // Remove from registry so it gets GC'd
    registry.remove(&request.stream_id);
    Ok(())
}

/// List AI models available to a Live App (no sensitive fields).
#[tauri::command]
pub async fn live_app_ai_list_models(
    state: State<'_, AppState>,
    request: LiveAppAiListModelsRequest,
) -> Result<Vec<LiveAppAiModelInfo>, String> {
    let live_app = state
        .live_app_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;

    let ai_perms = live_app
        .permissions
        .ai
        .as_ref()
        .ok_or("AI access is not enabled for this Live App")?;

    if !ai_perms.enabled {
        return Err("AI access is not enabled for this Live App".to_string());
    }

    let global_config = state
        .config_service
        .get_config::<GlobalConfig>(None)
        .await
        .map_err(|e| e.to_string())?;

    let primary_id = global_config
        .ai
        .resolve_model_selection("primary")
        .unwrap_or_default();
    let fast_id = global_config
        .ai
        .resolve_model_selection("fast")
        .unwrap_or_default();

    let allowed = ai_perms.allowed_models.as_deref().unwrap_or(&[]);

    let models: Vec<LiveAppAiModelInfo> = global_config
        .ai
        .models
        .iter()
        .filter(|m| m.enabled)
        .filter(|m| {
            if allowed.is_empty() {
                // No restriction — allow all
                true
            } else {
                // Allow if model id/name matches any entry in allowed list,
                // or if "primary"/"fast" is in allowed and this model is the resolved target.
                allowed.iter().any(|a| match a.as_str() {
                    "primary" => m.id == primary_id,
                    "fast" => m.id == fast_id,
                    other => m.id == other || m.name == other,
                })
            }
        })
        .map(|m| LiveAppAiModelInfo {
            id: m.id.clone(),
            name: m.name.clone(),
            provider: m.provider.clone(),
            is_default: m.id == primary_id,
        })
        .collect();

    Ok(models)
}

fn next_live_app_backend_run_id(app_id: &str) -> String {
    let sequence = LIVE_APP_AGENTIC_TURN_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("live-app-backend-{}-{}", app_id, sequence)
}

fn build_backend_action_prompt(
    live_app: &LiveApp,
    backend_id: &str,
    action_name: &str,
    binding_action_schema: &Value,
    service_action_prompt: &str,
    service_output_schema: &Value,
    input: &Value,
) -> String {
    let action_instruction = if service_action_prompt.trim().is_empty() {
        "Execute the requested service action for the Live App.".to_string()
    } else {
        service_action_prompt.trim().to_string()
    };
    format!(
        r#"You are serving a Sparo OS Live App backend action.

Live App:
- id: {app_id}
- name: {app_name}

Backend binding:
- backend id: {backend_id}
- action: {action_name}

Action instruction:
{action_instruction}

Input JSON:
```json
{input}
```

Binding output schema:
```json
{binding_schema}
```

Service output schema:
```json
{service_schema}
```

Return only a single JSON object that conforms to the effective output schema. Do not wrap it in Markdown. If the action cannot be completed, return a JSON object with an "error" string and a "recoverable" boolean."#,
        app_id = live_app.id,
        app_name = live_app.name,
        backend_id = backend_id,
        action_name = action_name,
        action_instruction = action_instruction,
        input = serde_json::to_string_pretty(input).unwrap_or_else(|_| "{}".to_string()),
        binding_schema = serde_json::to_string_pretty(binding_action_schema)
            .unwrap_or_else(|_| "{}".to_string()),
        service_schema = serde_json::to_string_pretty(service_output_schema)
            .unwrap_or_else(|_| "{}".to_string()),
    )
}

fn is_ppt_live_private_backend(app_id: &str, backend_id: &str, action_name: &str) -> bool {
    app_id == "builtin-ppt-live" && backend_id == "ppt" && action_name == "generate"
}

const PPT_LIVE_PRIVATE_OWNER_PREFIX: &str = "live-app-backend:builtin-ppt-live:ppt:";

fn is_ppt_live_private_session(agent_type: &str, created_by: Option<&str>) -> bool {
    // Legacy hidden-agent sessions may still exist until cleaned up.
    if agent_type == "PptLive" {
        return true;
    }
    created_by
        .map(|value| value.starts_with(PPT_LIVE_PRIVATE_OWNER_PREFIX))
        .unwrap_or(false)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppCancelStalePptRunsRequest {
    pub workspace_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppCancelStalePptRunsResponse {
    pub cancelled_sessions: usize,
    pub cancelled_turns: usize,
    pub cleared_queues: usize,
}

async fn cancel_ppt_live_session_work(
    coordinator: &ConversationCoordinator,
    scheduler: &DialogScheduler,
    session_id: &str,
) -> Result<Option<String>, String> {
    let queue_depth = scheduler.queue_depth(session_id);
    if queue_depth > 0 {
        scheduler.clear_session_queue(session_id);
    }

    let cancelled = coordinator
        .cancel_active_turn_for_session(session_id, Duration::from_secs(2))
        .await
        .map_err(|e| format!("Failed to cancel active PPT Live turn: {}", e))?;

    if cancelled.is_some() {
        return Ok(cancelled);
    }

    let Some(session) = coordinator.get_session_manager().get_session(session_id) else {
        return Ok(None);
    };
    let SessionState::Processing {
        current_turn_id, ..
    } = &session.state
    else {
        return Ok(None);
    };
    coordinator
        .cancel_dialog_turn(session_id, current_turn_id)
        .await
        .map_err(|e| format!("Failed to cancel processing PPT Live turn: {}", e))?;
    Ok(Some(current_turn_id.clone()))
}

/// Cancel in-flight PPT Live private backend runs (survives app/webview reload).
pub async fn cancel_stale_ppt_live_private_runs_internal(
    coordinator: &ConversationCoordinator,
    scheduler: &DialogScheduler,
    workspace_path: &Path,
) -> Result<LiveAppCancelStalePptRunsResponse, String> {
    let effective_path = workspace_path.to_path_buf();
    let mut session_ids = HashSet::new();

    for session in coordinator.get_session_manager().list_loaded_sessions() {
        if is_ppt_live_private_session(&session.agent_type, session.created_by.as_deref()) {
            session_ids.insert(session.session_id);
        }
    }

    let summaries = coordinator
        .list_sessions(&effective_path)
        .await
        .map_err(|e| format!("Failed to list sessions for PPT Live cleanup: {}", e))?;
    for summary in summaries {
        if is_ppt_live_private_session(&summary.agent_type, summary.created_by.as_deref()) {
            session_ids.insert(summary.session_id);
        }
    }

    let mut cancelled_sessions = 0usize;
    let mut cancelled_turns = 0usize;
    let mut cleared_queues = 0usize;

    for session_id in session_ids {
        let queue_depth = scheduler.queue_depth(&session_id);
        if queue_depth > 0 {
            scheduler.clear_session_queue(&session_id);
            cleared_queues += 1;
        }

        if coordinator
            .get_session_manager()
            .get_session(&session_id)
            .is_none()
        {
            let _ = coordinator
                .restore_session(&effective_path, &session_id)
                .await
                .map_err(|e| {
                    log::warn!(
                        "PPT Live cleanup could not restore session {}: {}",
                        session_id,
                        e
                    );
                });
        }

        if let Some(turn_id) =
            cancel_ppt_live_session_work(coordinator, scheduler, &session_id).await?
        {
            cancelled_sessions += 1;
            cancelled_turns += 1;
            log::info!(
                "Cancelled stale PPT Live private backend run: session_id={}, turn_id={}",
                session_id,
                turn_id
            );
        }
    }

    Ok(LiveAppCancelStalePptRunsResponse {
        cancelled_sessions,
        cancelled_turns,
        cleared_queues,
    })
}

#[tauri::command]
pub async fn live_app_cancel_stale_ppt_runs(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    state: State<'_, AppState>,
    request: LiveAppCancelStalePptRunsRequest,
) -> Result<LiveAppCancelStalePptRunsResponse, String> {
    let workspace_path = request.workspace_path.clone().unwrap_or_else(|| {
        state
            .workspace_service
            .path_manager()
            .agentic_os_runtime_root()
            .to_string_lossy()
            .into_owned()
    });
    cancel_stale_ppt_live_private_runs_internal(
        coordinator.as_ref(),
        scheduler.as_ref(),
        Path::new(&workspace_path),
    )
    .await
}

fn assistant_text_from_ppt_turn(turn: &bitfun_core::service::session::DialogTurnData) -> String {
    turn.model_rounds
        .iter()
        .flat_map(|round| round.text_items.iter())
        .map(|item| item.content.as_str())
        .filter(|content| !content.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Load persisted assistant text for a finished PPT Live private backend turn.
#[tauri::command]
pub async fn live_app_ppt_turn_assistant_text(
    state: State<'_, AppState>,
    request: LiveAppPptTurnTextRequest,
) -> Result<LiveAppPptTurnTextResponse, String> {
    use bitfun_core::agentic::persistence::PersistenceManager;
    use bitfun_core::infrastructure::PathManager;

    let session_id = request.session_id.trim();
    let turn_id = request.turn_id.trim();
    if session_id.is_empty() || turn_id.is_empty() {
        return Err("sessionId and turnId are required".to_string());
    }

    let workspace_path = request.workspace_path.clone().unwrap_or_else(|| {
        state
            .workspace_service
            .path_manager()
            .agentic_os_runtime_root()
            .to_string_lossy()
            .into_owned()
    });
    let effective = desktop_effective_session_storage_path(
        &state,
        Some(workspace_path.as_str()),
        Some(SessionStorageScopeDto::AgenticOs),
    )
    .await;
    let path_manager =
        Arc::new(PathManager::new().map_err(|e| format!("Path manager init failed: {}", e))?);
    let persistence = PersistenceManager::new(path_manager)
        .map_err(|e| format!("Persistence init failed: {}", e))?;
    let metadata = persistence
        .load_session_metadata(&effective, session_id)
        .await
        .map_err(|e| format!("Failed to load PPT Live session metadata: {}", e))?
        .ok_or_else(|| format!("PPT Live session metadata not found: {}", session_id))?;

    for turn_index in (0..metadata.turn_count).rev() {
        let Some(turn) = persistence
            .load_dialog_turn(&effective, session_id, turn_index)
            .await
            .map_err(|e| format!("Failed to load PPT Live dialog turn: {}", e))?
        else {
            continue;
        };
        if turn.turn_id != turn_id {
            continue;
        }
        let text = assistant_text_from_ppt_turn(&turn);
        if text.trim().is_empty() {
            return Err("PPT Live assistant output is not available yet".to_string());
        }
        return Ok(LiveAppPptTurnTextResponse { text });
    }

    Err(format!("PPT Live dialog turn not found: {}", turn_id))
}

async fn submit_ppt_live_private_backend(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    state: State<'_, AppState>,
    app: LiveApp,
    backend_id: &str,
    action_name: &str,
    request: LiveAppBackendCallRequest,
) -> Result<LiveAppBackendCallResponse, String> {
    let workspace_path = request.workspace_path.clone().unwrap_or_else(|| {
        state
            .workspace_service
            .path_manager()
            .agentic_os_runtime_root()
            .to_string_lossy()
            .into_owned()
    });
    let action_run_id = request
        .idempotency_key
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| next_live_app_backend_run_id(&app.id));
    let owner = format!(
        "{}:{}",
        live_app_backend_owner(&app.id, backend_id, request.entity_id.as_deref()),
        action_run_id
    );
    let config = SessionConfig {
        workspace_path: Some(workspace_path.clone()),
        storage_scope: Some(SessionStorageScope::AgenticOs),
        model_id: Some("primary".to_string()),
        enable_tools: true,
        safe_mode: true,
        auto_compact: false,
        enable_context_compression: false,
        max_turns: 1,
        ..Default::default()
    };
    let session = coordinator
        .create_session_with_workspace_and_creator(
            None,
            "PPT Live Run".to_string(),
            "agentic".to_string(),
            config,
            workspace_path.clone(),
            Some(owner),
        )
        .await
        .map_err(|e| format!("Failed to create PPT Live backend session: {}", e))?;
    let prompt = build_ppt_live_private_prompt(&request.input);
    let outcome = scheduler
        .submit(
            session.session_id.clone(),
            prompt,
            Some("PPT Live generation".to_string()),
            Some(action_run_id.clone()),
            "agentic".to_string(),
            None,
            session.config.workspace_path.clone(),
            DialogSubmissionPolicy::for_source(DialogTriggerSource::DesktopApi)
                .with_persist_agent_type(false)
                .with_skip_tool_confirmation(true),
            None,
            None,
        )
        .await
        .map_err(|e| format!("Failed to start PPT Live generation: {}", e))?;
    let status = match &outcome {
        DialogSubmitOutcome::Started { .. } => "started",
        DialogSubmitOutcome::Queued { .. } => "queued",
    }
    .to_string();

    Ok(LiveAppBackendCallResponse {
        session_id: session.session_id,
        turn_id: action_run_id.clone(),
        action_run_id,
        status,
        backend_id: backend_id.to_string(),
        action: action_name.to_string(),
        agent_type: "agentic".to_string(),
        backend_kind: "agentApp".to_string(),
        backend_app_id: "agentic".to_string(),
        bridge_result: None,
    })
}

#[tauri::command]
pub async fn live_app_backend_call(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    state: State<'_, AppState>,
    request: LiveAppBackendCallRequest,
) -> Result<LiveAppBackendCallResponse, String> {
    let app = state
        .live_app_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;
    let (backend_id_raw, action_name_raw) = parse_backend_target(&request.target)?;
    let backend_id = backend_id_raw.to_string();
    let action_name = action_name_raw.to_string();
    if is_ppt_live_private_backend(&app.id, &backend_id, &action_name) {
        return submit_ppt_live_private_backend(
            coordinator,
            scheduler,
            state,
            app,
            &backend_id,
            &action_name,
            request,
        )
        .await;
    }
    let binding = app
        .backends
        .iter()
        .find(|backend| backend.id == backend_id)
        .ok_or_else(|| format!("Live App backend '{}' is not declared", backend_id))?;
    let binding_action = binding
        .actions
        .iter()
        .find(|action| action.name == action_name)
        .ok_or_else(|| {
            format!(
                "Action '{}' is not declared for Live App backend '{}'",
                action_name, backend_id
            )
        })?;

    let action_run_id = request
        .idempotency_key
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| next_live_app_backend_run_id(&app.id));

    if binding.kind == LiveAppBackendKind::BridgeApp {
        let result = BridgeAppManager::run_capability_action(
            &binding.app_id,
            binding.capability_id.as_deref(),
            &action_name,
            request.input.clone(),
            request.workspace_path.clone(),
            action_run_id.clone(),
            BridgeAppConsumer {
                kind: BridgeAppConsumerKind::LiveAppBackend,
                id: app.id.clone(),
                session_id: None,
                turn_id: Some(action_run_id.clone()),
            },
        )
        .await
        .map_err(|e| format!("Failed to run Bridge App backend: {}", e))?;
        let status = match result.status {
            BridgeAppRunStatus::Completed => "completed",
            BridgeAppRunStatus::Failed => "failed",
            BridgeAppRunStatus::Cancelled => "cancelled",
            BridgeAppRunStatus::Pending => "pending",
            BridgeAppRunStatus::Running => "running",
            BridgeAppRunStatus::WaitingForApproval => "waiting_for_approval",
        }
        .to_string();
        for event in &result.events {
            emit_live_app_event(
                "liveapp-backend-event",
                json!({
                    "appId": app.id,
                    "backendId": backend_id,
                    "action": action_name,
                    "actionRunId": action_run_id,
                    "backendKind": "bridgeApp",
                    "backendAppId": binding.app_id,
                    "event": event,
                }),
            )
            .await;
        }

        return Ok(LiveAppBackendCallResponse {
            session_id: String::new(),
            turn_id: action_run_id.clone(),
            action_run_id,
            status,
            backend_id,
            action: action_name,
            agent_type: binding.app_id.clone(),
            backend_kind: "bridgeApp".to_string(),
            backend_app_id: binding.app_id.clone(),
            bridge_result: Some(result),
        });
    }

    let agent_package = AgentAppManager::get(&binding.app_id, None, None)
        .map_err(|e| format!("Failed to load Agent App backend: {}", e))?;
    let service_action = agent_package
        .manifest
        .service_actions
        .iter()
        .find(|action| action.name == action_name)
        .ok_or_else(|| {
            format!(
                "Agent App '{}' does not expose service action '{}'",
                binding.app_id, action_name
            )
        })?;
    if let Some(bridge_call) = service_action.bridge_call.as_ref() {
        let bridge_action = bridge_call
            .action
            .trim()
            .is_empty()
            .then_some(action_name.as_str())
            .unwrap_or_else(|| bridge_call.action.as_str());
        let result = BridgeAppManager::run_capability_action(
            &bridge_call.bridge_id,
            Some(&bridge_call.capability_id),
            bridge_action,
            request.input.clone(),
            request.workspace_path.clone(),
            action_run_id.clone(),
            BridgeAppConsumer {
                kind: BridgeAppConsumerKind::AgentApp,
                id: binding.app_id.clone(),
                session_id: None,
                turn_id: Some(action_run_id.clone()),
            },
        )
        .await
        .map_err(|e| format!("Failed to run Agent App Bridge service action: {}", e))?;
        let status = match result.status {
            BridgeAppRunStatus::Completed => "completed",
            BridgeAppRunStatus::Failed => "failed",
            BridgeAppRunStatus::Cancelled => "cancelled",
            BridgeAppRunStatus::Pending => "pending",
            BridgeAppRunStatus::Running => "running",
            BridgeAppRunStatus::WaitingForApproval => "waiting_for_approval",
        }
        .to_string();
        for event in &result.events {
            emit_live_app_event(
                "liveapp-backend-event",
                json!({
                    "appId": app.id,
                    "backendId": backend_id,
                    "action": action_name,
                    "actionRunId": action_run_id,
                    "backendKind": "agentApp",
                    "backendAppId": binding.app_id,
                    "bridgeAppId": bridge_call.bridge_id,
                    "capabilityId": bridge_call.capability_id,
                    "bridgeAction": bridge_action,
                    "event": event,
                }),
            )
            .await;
        }

        return Ok(LiveAppBackendCallResponse {
            session_id: String::new(),
            turn_id: action_run_id.clone(),
            action_run_id,
            status,
            backend_id,
            action: action_name,
            agent_type: binding.app_id.clone(),
            backend_kind: "agentApp".to_string(),
            backend_app_id: binding.app_id.clone(),
            bridge_result: Some(result),
        });
    }

    let workspace_path = state
        .workspace_service
        .path_manager()
        .agentic_os_runtime_root()
        .to_string_lossy()
        .into_owned();
    let owner = live_app_backend_owner(&app.id, &backend_id, request.entity_id.as_deref());
    let effective_path = desktop_effective_session_storage_path(
        &state,
        Some(&workspace_path),
        Some(SessionStorageScopeDto::AgenticOs),
    )
    .await;
    let existing_session = coordinator
        .list_sessions(&effective_path)
        .await
        .map_err(|e| format!("Failed to list backend sessions: {}", e))?
        .into_iter()
        .find(|session| session.created_by.as_deref() == Some(owner.as_str()));
    let session = match existing_session {
        Some(session) => coordinator
            .get_session_manager()
            .get_session(&session.session_id)
            .ok_or_else(|| "Backend session is not loaded".to_string())?,
        None => {
            let config = SessionConfig {
                workspace_path: Some(workspace_path.clone()),
                storage_scope: Some(SessionStorageScope::AgenticOs),
                model_id: Some(agent_package.manifest.model.clone()),
                enable_tools: !agent_package.manifest.readonly,
                safe_mode: true,
                auto_compact: true,
                enable_context_compression: true,
                ..Default::default()
            };
            coordinator
                .create_session_with_workspace_and_creator(
                    None,
                    format!("{} Backend", app.name),
                    binding.app_id.clone(),
                    config,
                    workspace_path.clone(),
                    Some(owner),
                )
                .await
                .map_err(|e| format!("Failed to create backend session: {}", e))?
        }
    };

    let prompt = build_backend_action_prompt(
        &app,
        &backend_id,
        &action_name,
        &binding_action.output_schema,
        &service_action.prompt_template,
        &service_action.output_schema,
        &request.input,
    );
    let outcome = scheduler
        .submit(
            session.session_id.clone(),
            prompt,
            Some(format!("{}.{}", backend_id, action_name)),
            Some(action_run_id.clone()),
            binding.app_id.clone(),
            None,
            session.config.workspace_path.clone(),
            DialogSubmissionPolicy::for_source(DialogTriggerSource::DesktopApi),
            None,
            None,
        )
        .await
        .map_err(|e| format!("Failed to start backend action: {}", e))?;
    let status = match outcome {
        DialogSubmitOutcome::Started { .. } => "started",
        DialogSubmitOutcome::Queued { .. } => "queued",
    }
    .to_string();

    Ok(LiveAppBackendCallResponse {
        session_id: session.session_id,
        turn_id: action_run_id.clone(),
        action_run_id,
        status,
        backend_id,
        action: action_name,
        agent_type: binding.app_id.clone(),
        backend_kind: "agentApp".to_string(),
        backend_app_id: binding.app_id.clone(),
        bridge_result: None,
    })
}

#[tauri::command]
pub async fn live_app_backend_status(
    state: State<'_, AppState>,
    request: LiveAppBackendRunRequest,
) -> Result<Value, String> {
    let _app = state
        .live_app_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(run) = BridgeAppManager::get_run(&request.action_run_id).await {
        return Ok(json!({
            "kind": "bridgeApp",
            "actionRunId": request.action_run_id,
            "status": run.status,
            "backendAppId": run.bridge_id,
            "capabilityId": run.capability_id,
            "action": run.action,
            "updatedAt": run.updated_at,
            "artifacts": run.artifacts,
            "output": run.output,
        }));
    }

    Ok(json!({
        "kind": "agentApp",
        "actionRunId": request.action_run_id,
        "sessionId": request.session_id,
        "turnId": request.turn_id,
        "status": "unknown",
        "message": "Agent App backend status is available through backend event streaming.",
    }))
}

#[tauri::command]
pub async fn live_app_backend_cancel_run(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    state: State<'_, AppState>,
    request: LiveAppBackendRunRequest,
) -> Result<Value, String> {
    let _app = state
        .live_app_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;

    if BridgeAppManager::get_run(&request.action_run_id)
        .await
        .is_some()
    {
        let run = BridgeAppManager::cancel_run(&request.action_run_id)
            .await
            .map_err(|e| e.to_string())?;
        return Ok(json!({
            "kind": "bridgeApp",
            "actionRunId": request.action_run_id,
            "status": run.status,
            "backendAppId": run.bridge_id,
            "capabilityId": run.capability_id,
            "action": run.action,
        }));
    }

    let session_id = request
        .session_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "backend.cancelRun requires sessionId for Agent App backend runs".to_string()
        })?;
    let turn_id = request
        .turn_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "backend.cancelRun requires turnId for Agent App backend runs".to_string()
        })?;

    coordinator
        .cancel_dialog_turn(session_id, turn_id)
        .await
        .map_err(|e| format!("Failed to cancel backend run: {}", e))?;

    Ok(json!({
        "kind": "agentApp",
        "actionRunId": request.action_run_id,
        "sessionId": session_id,
        "turnId": turn_id,
        "status": "cancelled",
    }))
}
