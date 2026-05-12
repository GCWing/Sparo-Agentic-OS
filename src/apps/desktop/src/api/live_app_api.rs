//! Live App API — Tauri commands for CRUD, JS Worker, and dialog.

use crate::api::app_state::AppState;
use crate::api::session_storage_path::{
    desktop_effective_session_storage_path, SessionStorageScopeDto,
};
use bitfun_core::agentic::coordination::{
    ConversationCoordinator, DialogScheduler, DialogSubmissionPolicy, DialogSubmitOutcome,
    DialogTriggerSource,
};
use bitfun_core::agentic::core::{SessionConfig, SessionStorageScope};
use bitfun_core::infrastructure::events::{emit_global_event, BackendEvent};
use bitfun_core::live_app::{
    InstallResult as CoreInstallResult, LiveApp, LiveAppAiContext, LiveAppMeta, LiveAppPermissions,
    LiveAppRuntimeIssue, LiveAppRuntimeIssueSeverity, LiveAppRuntimeLog, LiveAppRuntimeLogLevel,
    LiveAppSource,
};
use bitfun_core::service::config::types::GlobalConfig;
use bitfun_core::util::types::Message;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
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
    pub source: LiveAppSourceDto,
    #[serde(default)]
    pub permissions: LiveAppPermissions,
    pub ai_context: Option<LiveAppAiContext>,
    pub permission_rationale: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
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
    #[serde(default)]
    pub worker_js: String,
    #[serde(default)]
    pub npm_dependencies: Vec<NpmDepDto>,
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
            worker_js: d.worker_js,
            npm_dependencies: d
                .npm_dependencies
                .into_iter()
                .map(|x| bitfun_core::live_app::NpmDep {
                    name: x.name,
                    version: x.version,
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
    pub source: Option<LiveAppSourceDto>,
    pub permissions: Option<LiveAppPermissions>,
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
pub struct LiveAppAgenticCreateSessionRequest {
    pub app_id: String,
    pub session_name: String,
    #[serde(default)]
    pub agent_type: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppAgenticSessionResponse {
    pub session_id: String,
    pub session_name: String,
    pub agent_type: String,
    pub workspace_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppAgenticSendMessageRequest {
    pub app_id: String,
    pub session_id: String,
    pub prompt: String,
    #[serde(default)]
    pub original_prompt: Option<String>,
    #[serde(default)]
    pub agent_type: Option<String>,
    #[serde(default)]
    pub turn_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppAgenticSendMessageResponse {
    pub session_id: String,
    pub turn_id: String,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppAgenticSessionRequest {
    pub app_id: String,
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppAgenticCancelTurnRequest {
    pub app_id: String,
    pub session_id: String,
    pub turn_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppAgenticToolDecisionRequest {
    pub app_id: String,
    pub session_id: String,
    pub tool_id: String,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub updated_input: Option<Value>,
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

async fn emit_live_app_runtime_issues_cleared(app_id: &str) {
    emit_live_app_event("liveapp-runtime-errors-cleared", json!({ "appId": app_id })).await;
}

fn workspace_root_from_input(workspace_path: Option<&str>) -> Option<PathBuf> {
    workspace_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

fn live_app_agentic_owner(app_id: &str) -> String {
    format!("live-app:{}", app_id)
}

fn validate_live_app_agentic_access(app: &LiveApp) -> Result<(), String> {
    let Some(agentic) = app.permissions.agentic.as_ref() else {
        return Err("Agentic access is not enabled for this Live App".to_string());
    };
    if !agentic.enabled {
        return Err("Agentic access is not enabled for this Live App".to_string());
    }
    Ok(())
}

fn validate_live_app_agent_type(app: &LiveApp, agent_type: &str) -> Result<(), String> {
    let Some(agentic) = app.permissions.agentic.as_ref() else {
        return Err("Agentic access is not enabled for this Live App".to_string());
    };
    if let Some(allowed) = agentic.allowed_agents.as_ref() {
        if !allowed.is_empty() && !allowed.iter().any(|agent| agent == agent_type) {
            return Err(format!(
                "Agent '{}' is not allowed by this Live App's Agentic permissions",
                agent_type
            ));
        }
    }
    Ok(())
}

fn resolve_live_app_agentic_workspace(
    state: &AppState,
    app: &LiveApp,
    workspace_path: Option<&str>,
) -> Result<String, String> {
    let explicit = workspace_path
        .map(str::trim)
        .filter(|path| !path.is_empty());
    if let Some(path) = explicit {
        let allowed = app
            .permissions
            .agentic
            .as_ref()
            .map(|agentic| agentic.allow_workspace)
            .unwrap_or(false);
        if !allowed {
            return Err(
                "This Live App is not allowed to bind Agentic sessions to a workspace".to_string(),
            );
        }
        return Ok(path.to_string());
    }

    Ok(state
        .workspace_service
        .path_manager()
        .agentic_os_runtime_root()
        .to_string_lossy()
        .into_owned())
}

async fn count_live_app_agentic_sessions(
    coordinator: &ConversationCoordinator,
    state: &AppState,
    app_id: &str,
    workspace_path: &str,
) -> Result<usize, String> {
    let effective_path = desktop_effective_session_storage_path(
        state,
        Some(workspace_path),
        Some(SessionStorageScopeDto::AgenticOs),
    )
    .await;
    let owner = live_app_agentic_owner(app_id);
    let sessions = coordinator
        .list_sessions(&effective_path)
        .await
        .map_err(|e| format!("Failed to list Agentic sessions: {}", e))?;
    Ok(sessions
        .into_iter()
        .filter(|session| session.created_by.as_deref() == Some(owner.as_str()))
        .count())
}

fn ensure_live_app_owns_agentic_session(
    coordinator: &ConversationCoordinator,
    app_id: &str,
    session_id: &str,
) -> Result<bitfun_core::agentic::core::Session, String> {
    let owner = live_app_agentic_owner(app_id);
    let session = coordinator
        .get_session_manager()
        .get_session(session_id)
        .ok_or_else(|| "Agentic session is not loaded".to_string())?;
    if session.created_by.as_deref() != Some(owner.as_str()) {
        return Err("This Live App does not own the Agentic session".to_string());
    }
    Ok(session)
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
            source,
            request.permissions,
            request.ai_context,
            request.permission_rationale,
            workspace_root.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())?;
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
            request.source.map(Into::into),
            request.permissions,
            request.ai_context,
            request.permission_rationale,
            workspace_root.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())?;
    maybe_stop_worker(&state, &app).await;
    emit_live_app_runtime_issues_cleared(&app.id).await;
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

fn next_live_app_agentic_turn_id(app_id: &str) -> String {
    let sequence = LIVE_APP_AGENTIC_TURN_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("live-app-agentic-{}-{}", app_id, sequence)
}

// ============== Agentic commands ==============

#[tauri::command]
pub async fn live_app_agentic_create_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    state: State<'_, AppState>,
    request: LiveAppAgenticCreateSessionRequest,
) -> Result<LiveAppAgenticSessionResponse, String> {
    let app = state
        .live_app_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;
    validate_live_app_agentic_access(&app)?;

    let agent_type = request
        .agent_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("agentic")
        .to_string();
    validate_live_app_agent_type(&app, &agent_type)?;

    let workspace_path =
        resolve_live_app_agentic_workspace(&state, &app, request.workspace_path.as_deref())?;

    if let Some(max_sessions) = app
        .permissions
        .agentic
        .as_ref()
        .and_then(|agentic| agentic.max_sessions)
    {
        let count =
            count_live_app_agentic_sessions(&coordinator, &state, &request.app_id, &workspace_path)
                .await?;
        if count >= max_sessions as usize {
            return Err(format!(
                "Live App Agentic session limit exceeded: max {} sessions",
                max_sessions
            ));
        }
    }

    let allow_tools = app
        .permissions
        .agentic
        .as_ref()
        .and_then(|agentic| agentic.allow_tools)
        .unwrap_or(true);
    let config = SessionConfig {
        workspace_path: Some(workspace_path.clone()),
        storage_scope: Some(SessionStorageScope::AgenticOs),
        model_id: request.model.filter(|value| !value.trim().is_empty()),
        enable_tools: allow_tools,
        safe_mode: true,
        auto_compact: true,
        enable_context_compression: true,
        ..Default::default()
    };

    let session = coordinator
        .create_session_with_workspace_and_creator(
            None,
            request.session_name,
            agent_type,
            config,
            workspace_path.clone(),
            Some(live_app_agentic_owner(&request.app_id)),
        )
        .await
        .map_err(|e| format!("Failed to create Agentic session: {}", e))?;

    Ok(LiveAppAgenticSessionResponse {
        session_id: session.session_id,
        session_name: session.session_name,
        agent_type: session.agent_type,
        workspace_path,
    })
}

#[tauri::command]
pub async fn live_app_agentic_send_message(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    state: State<'_, AppState>,
    request: LiveAppAgenticSendMessageRequest,
) -> Result<LiveAppAgenticSendMessageResponse, String> {
    let app = state
        .live_app_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;
    validate_live_app_agentic_access(&app)?;

    let session =
        ensure_live_app_owns_agentic_session(&coordinator, &request.app_id, &request.session_id)?;
    let agent_type = request
        .agent_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&session.agent_type)
        .to_string();
    validate_live_app_agent_type(&app, &agent_type)?;

    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("prompt is required".to_string());
    }
    let turn_id = request
        .turn_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| next_live_app_agentic_turn_id(&request.app_id));

    let outcome = scheduler
        .submit(
            session.session_id.clone(),
            prompt.to_string(),
            request.original_prompt,
            Some(turn_id.clone()),
            agent_type,
            None,
            session.config.workspace_path.clone(),
            DialogSubmissionPolicy::for_source(DialogTriggerSource::DesktopApi),
            None,
            None,
        )
        .await
        .map_err(|e| format!("Failed to start Agentic dialog turn: {}", e))?;

    let status = match outcome {
        DialogSubmitOutcome::Started { .. } => "started",
        DialogSubmitOutcome::Queued { .. } => "queued",
    }
    .to_string();

    Ok(LiveAppAgenticSendMessageResponse {
        session_id: session.session_id,
        turn_id,
        status,
    })
}

#[tauri::command]
pub async fn live_app_agentic_cancel_turn(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    state: State<'_, AppState>,
    request: LiveAppAgenticCancelTurnRequest,
) -> Result<(), String> {
    let app = state
        .live_app_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;
    validate_live_app_agentic_access(&app)?;
    ensure_live_app_owns_agentic_session(&coordinator, &request.app_id, &request.session_id)?;

    coordinator
        .cancel_dialog_turn(&request.session_id, &request.turn_id)
        .await
        .map_err(|e| format!("Failed to cancel Agentic dialog turn: {}", e))
}

#[tauri::command]
pub async fn live_app_agentic_list_sessions(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    state: State<'_, AppState>,
    app_id: String,
) -> Result<Vec<LiveAppAgenticSessionResponse>, String> {
    let app = state
        .live_app_manager
        .get(&app_id)
        .await
        .map_err(|e| e.to_string())?;
    validate_live_app_agentic_access(&app)?;

    let workspace_path = resolve_live_app_agentic_workspace(&state, &app, None)?;
    let effective_path = desktop_effective_session_storage_path(
        &state,
        Some(&workspace_path),
        Some(SessionStorageScopeDto::AgenticOs),
    )
    .await;
    let owner = live_app_agentic_owner(&app_id);
    let sessions = coordinator
        .list_sessions(&effective_path)
        .await
        .map_err(|e| format!("Failed to list Agentic sessions: {}", e))?;

    Ok(sessions
        .into_iter()
        .filter(|session| session.created_by.as_deref() == Some(owner.as_str()))
        .map(|session| LiveAppAgenticSessionResponse {
            session_id: session.session_id,
            session_name: session.session_name,
            agent_type: session.agent_type,
            workspace_path: workspace_path.clone(),
        })
        .collect())
}

#[tauri::command]
pub async fn live_app_agentic_restore_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    state: State<'_, AppState>,
    request: LiveAppAgenticSessionRequest,
) -> Result<LiveAppAgenticSessionResponse, String> {
    let app = state
        .live_app_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;
    validate_live_app_agentic_access(&app)?;
    let workspace_path = resolve_live_app_agentic_workspace(&state, &app, None)?;
    let effective_path = desktop_effective_session_storage_path(
        &state,
        Some(&workspace_path),
        Some(SessionStorageScopeDto::AgenticOs),
    )
    .await;
    let session = coordinator
        .restore_session(&effective_path, &request.session_id)
        .await
        .map_err(|e| format!("Failed to restore Agentic session: {}", e))?;

    if session.created_by.as_deref() != Some(live_app_agentic_owner(&request.app_id).as_str()) {
        return Err("This Live App does not own the Agentic session".to_string());
    }

    Ok(LiveAppAgenticSessionResponse {
        session_id: session.session_id,
        session_name: session.session_name,
        agent_type: session.agent_type,
        workspace_path,
    })
}

#[tauri::command]
pub async fn live_app_agentic_delete_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    state: State<'_, AppState>,
    request: LiveAppAgenticSessionRequest,
) -> Result<(), String> {
    let app = state
        .live_app_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;
    validate_live_app_agentic_access(&app)?;
    let session =
        ensure_live_app_owns_agentic_session(&coordinator, &request.app_id, &request.session_id)?;
    let workspace_path = session
        .config
        .workspace_path
        .as_deref()
        .ok_or_else(|| "Agentic session has no workspace path".to_string())?;
    let effective_path = desktop_effective_session_storage_path(
        &state,
        Some(workspace_path),
        Some(SessionStorageScopeDto::AgenticOs),
    )
    .await;
    coordinator
        .delete_session(&effective_path, &request.session_id)
        .await
        .map_err(|e| format!("Failed to delete Agentic session: {}", e))
}

#[tauri::command]
pub async fn live_app_agentic_confirm_tool(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    state: State<'_, AppState>,
    request: LiveAppAgenticToolDecisionRequest,
) -> Result<(), String> {
    let app = state
        .live_app_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;
    validate_live_app_agentic_access(&app)?;
    ensure_live_app_owns_agentic_session(&coordinator, &request.app_id, &request.session_id)?;

    coordinator
        .confirm_tool(&request.tool_id, request.updated_input)
        .await
        .map_err(|e| format!("Confirm Agentic tool failed: {}", e))
}

#[tauri::command]
pub async fn live_app_agentic_reject_tool(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    state: State<'_, AppState>,
    request: LiveAppAgenticToolDecisionRequest,
) -> Result<(), String> {
    let app = state
        .live_app_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;
    validate_live_app_agentic_access(&app)?;
    ensure_live_app_owns_agentic_session(&coordinator, &request.app_id, &request.session_id)?;

    coordinator
        .reject_tool(
            &request.tool_id,
            request
                .reason
                .unwrap_or_else(|| "Rejected by Live App".to_string()),
        )
        .await
        .map_err(|e| format!("Reject Agentic tool failed: {}", e))
}
