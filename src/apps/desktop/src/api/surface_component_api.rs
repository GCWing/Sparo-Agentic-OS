//! Product App API — Tauri commands for CRUD, JS Worker, and dialog.

use crate::api::app_state::AppState;
use crate::api::session_storage_path::{
    desktop_effective_session_storage_path, SessionStorageScopeDto,
};
use bitfun_core::agent_component::AgentComponentManager;
use bitfun_core::agentic::agents::build_ppt_live_private_prompt;
use bitfun_core::agentic::coordination::{
    ConversationCoordinator, DialogScheduler, DialogSubmissionPolicy, DialogSubmitOutcome,
    DialogTriggerSource, SessionControlActor, TurnCancellationReason,
};
use bitfun_core::agentic::core::{SessionConfig, SessionState, SessionStorageScope};
use bitfun_core::agentic_os::work::{default_work_store, WorkService};
use bitfun_core::bridge_component::{
    BridgeComponentConsumer, BridgeComponentConsumerKind, BridgeComponentManager,
    BridgeComponentRunResult, BridgeComponentRunStatus,
};
use bitfun_core::infrastructure::events::{emit_global_event, BackendEvent};
use bitfun_core::service::config::types::GlobalConfig;
use bitfun_core::surface_component::{
    dispatch_host, ensure_builtin_surface_component_current, is_host_primitive,
    seed_builtin_surface_components, InstallResult as CoreInstallResult, SurfaceComponent,
    SurfaceComponentAiContext, SurfaceComponentBackendBinding, SurfaceComponentBackendKind,
    SurfaceComponentBuildMode, SurfaceComponentEntry, SurfaceComponentI18n,
    SurfaceComponentInteraction, SurfaceComponentMeta, SurfaceComponentPermissions,
    SurfaceComponentRuntimeIssue, SurfaceComponentRuntimeIssueSeverity, SurfaceComponentRuntimeLog,
    SurfaceComponentRuntimeLogLevel, SurfaceComponentSource, SurfaceComponentSourceFile,
    SurfaceComponentSourceFileKind,
};
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
pub struct CreateSurfaceComponentRequest {
    pub name: String,
    pub description: String,
    pub icon: String,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub i18n: SurfaceComponentI18n,
    pub source: SurfaceComponentSourceDto,
    #[serde(default)]
    pub permissions: SurfaceComponentPermissions,
    #[serde(default)]
    pub backends: Vec<SurfaceComponentBackendBinding>,
    pub interaction: Option<SurfaceComponentInteraction>,
    pub ai_context: Option<SurfaceComponentAiContext>,
    pub permission_rationale: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordRecentSurfaceComponentRequest {
    pub app_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentSourceDto {
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
    pub entry: SurfaceComponentEntryDto,
    #[serde(default)]
    pub source_files: Vec<SurfaceComponentSourceFileDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentEntryDto {
    #[serde(default = "default_ui_entry")]
    pub ui_entry: String,
    #[serde(default)]
    pub worker_entry: Option<String>,
    #[serde(default)]
    pub style_entries: Vec<String>,
    #[serde(default)]
    pub build_mode: SurfaceComponentBuildMode,
}

impl Default for SurfaceComponentEntryDto {
    fn default() -> Self {
        Self {
            ui_entry: default_ui_entry(),
            worker_entry: Some("worker.js".to_string()),
            style_entries: vec!["style.css".to_string()],
            build_mode: SurfaceComponentBuildMode::NativeEsm,
        }
    }
}

fn default_ui_entry() -> String {
    "ui.js".to_string()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentSourceFileDto {
    pub path: String,
    #[serde(default)]
    pub kind: SurfaceComponentSourceFileKind,
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

impl From<SurfaceComponentSourceDto> for SurfaceComponentSource {
    fn from(d: SurfaceComponentSourceDto) -> Self {
        SurfaceComponentSource {
            html: d.html,
            css: d.css,
            ui_js: d.ui_js,
            esm_dependencies: d
                .esm_dependencies
                .into_iter()
                .map(|x| bitfun_core::surface_component::EsmDep {
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
                .map(|x| bitfun_core::surface_component::NpmDep {
                    name: x.name,
                    version: x.version,
                })
                .collect(),
            entry: SurfaceComponentEntry {
                ui_entry: d.entry.ui_entry,
                worker_entry: d.entry.worker_entry,
                style_entries: d.entry.style_entries,
                build_mode: d.entry.build_mode,
            },
            source_files: d
                .source_files
                .into_iter()
                .map(|file| SurfaceComponentSourceFile {
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
pub struct UpdateSurfaceComponentRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
    pub i18n: Option<SurfaceComponentI18n>,
    pub source: Option<SurfaceComponentSourceDto>,
    pub permissions: Option<SurfaceComponentPermissions>,
    pub backends: Option<Vec<SurfaceComponentBackendBinding>>,
    pub interaction: Option<SurfaceComponentInteraction>,
    pub ai_context: Option<SurfaceComponentAiContext>,
    pub permission_rationale: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSurfaceComponentRequest {
    pub app_id: String,
    pub theme: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentWorkerCallRequest {
    pub app_id: String,
    pub method: String,
    pub params: Value,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentRecompileRequest {
    pub app_id: String,
    pub theme: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentImportFromPathRequest {
    pub path: String,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentSyncFromFsRequest {
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
pub struct SurfaceComponentRuntimeIssueRequest {
    pub app_id: String,
    pub severity: Option<SurfaceComponentRuntimeIssueSeverity>,
    pub message: String,
    pub source: Option<String>,
    pub stack: Option<String>,
    pub category: Option<String>,
    pub timestamp_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentRuntimeLogRequest {
    pub app_id: String,
    pub level: Option<SurfaceComponentRuntimeLogLevel>,
    pub category: Option<String>,
    pub message: String,
    pub source: Option<String>,
    pub stack: Option<String>,
    pub details: Option<Value>,
    pub timestamp_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentCaptureMatrixRequest {
    pub app_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentClearRuntimeIssuesRequest {
    pub app_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentBackendCallRequest {
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
pub struct SurfaceComponentBackendCallResponse {
    pub session_id: String,
    pub turn_id: String,
    pub action_run_id: String,
    pub status: String,
    pub backend_id: String,
    pub action: String,
    pub agent_type: String,
    pub backend_kind: String,
    pub backend_component_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bridge_result: Option<BridgeComponentRunResult>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentBackendRunRequest {
    pub app_id: String,
    pub action_run_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub turn_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentPptTurnTextRequest {
    pub session_id: String,
    pub turn_id: String,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentPptTurnTextResponse {
    pub text: String,
}

fn surface_component_payload(app: &SurfaceComponent, reason: &str) -> Value {
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

async fn emit_surface_component_event(event_name: &str, payload: Value) {
    let _ = emit_global_event(BackendEvent::Custom {
        event_name: event_name.to_string(),
        payload,
    })
    .await;
}

async fn sync_surface_component_work_titles(app: &SurfaceComponent) {
    let service = match default_work_store() {
        Ok(store) => WorkService::new(store),
        Err(error) => {
            log::warn!(
                "Failed to access Work store for Product App title sync: app_id={}, error={}",
                app.id,
                error
            );
            return;
        }
    };

    if let Err(error) = service
        .sync_title_from_application_surface(&app.id, &app.name)
        .await
    {
        log::warn!(
            "Failed to sync Product App Work titles: app_id={}, error={}",
            app.id,
            error
        );
    }
}

async fn emit_surface_component_runtime_issues_cleared(app_id: &str) {
    emit_surface_component_event(
        "surface-component-runtime-errors-cleared",
        json!({ "appId": app_id }),
    )
    .await;
}

fn workspace_root_from_input(workspace_path: Option<&str>) -> Option<PathBuf> {
    workspace_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

fn surface_component_backend_owner(
    app_id: &str,
    backend_id: &str,
    entity_id: Option<&str>,
) -> String {
    match entity_id.map(str::trim).filter(|value| !value.is_empty()) {
        Some(entity_id) => format!(
            "surface-component-backend:{}:{}:{}",
            app_id, backend_id, entity_id
        ),
        None => format!("surface-component-backend:{}:{}", app_id, backend_id),
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

async fn maybe_stop_worker(state: &State<'_, AppState>, app: &SurfaceComponent) {
    if app.runtime.worker_restart_required {
        if let Some(ref pool) = state.js_worker_pool {
            pool.stop(&app.id).await;
        }
        emit_surface_component_event(
            "surface-component-worker-stopped",
            json!({ "id": app.id, "reason": "pending-restart" }),
        )
        .await;
    }
}

async fn ensure_worker_dependencies(
    state: &State<'_, AppState>,
    app_id: &str,
    app: &mut SurfaceComponent,
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
            "Product App dependencies install failed for {app_id}: {}",
            details.trim()
        ));
    }

    pool.stop(app_id).await;
    *app = state
        .surface_component_manager
        .mark_deps_installed(app_id)
        .await
        .map_err(|e| e.to_string())?;
    emit_surface_component_event(
        "surface-component-updated",
        surface_component_payload(app, "deps-installed"),
    )
    .await;
    Ok(true)
}

// ============== App management commands ==============

#[tauri::command]
pub async fn list_surface_components(
    state: State<'_, AppState>,
) -> Result<Vec<SurfaceComponentMeta>, String> {
    if let Err(e) = seed_builtin_surface_components(&state.surface_component_manager).await {
        log::warn!(
            "list_surface_components: refresh built-in Product Apps failed: {}",
            e
        );
    }

    state
        .surface_component_manager
        .list()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_recent_surface_components(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    state
        .surface_component_manager
        .list_recent_opened()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn record_recent_surface_component(
    state: State<'_, AppState>,
    request: RecordRecentSurfaceComponentRequest,
) -> Result<Vec<String>, String> {
    state
        .surface_component_manager
        .record_recent_opened(&request.app_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_surface_component(
    state: State<'_, AppState>,
    request: GetSurfaceComponentRequest,
) -> Result<SurfaceComponent, String> {
    if let Err(e) =
        ensure_builtin_surface_component_current(&state.surface_component_manager, &request.app_id)
            .await
    {
        log::warn!(
            "get_surface_component: refresh built-in Product App '{}' failed: {}",
            request.app_id,
            e
        );
    }

    let mut app = state
        .surface_component_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;

    let theme_type = request.theme.as_deref().unwrap_or("dark");
    let workspace_root = workspace_root_from_input(request.workspace_path.as_deref());
    match state.surface_component_manager.compile_source(
        &request.app_id,
        &app.source,
        &app.permissions,
        theme_type,
        workspace_root.as_deref(),
    ) {
        Ok(html) => app.compiled_html = html,
        Err(e) => log::warn!(
            "get_surface_component: recompile failed, using cached: {}",
            e
        ),
    }
    Ok(app)
}

#[tauri::command]
pub async fn create_surface_component(
    state: State<'_, AppState>,
    request: CreateSurfaceComponentRequest,
) -> Result<SurfaceComponent, String> {
    let source: SurfaceComponentSource = request.source.into();
    let workspace_root = workspace_root_from_input(request.workspace_path.as_deref());
    let app = state
        .surface_component_manager
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
            request.interaction,
            request.ai_context,
            request.permission_rationale,
            workspace_root.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())?;
    sync_surface_component_work_titles(&app).await;
    emit_surface_component_event(
        "surface-component-created",
        surface_component_payload(&app, "create"),
    )
    .await;
    Ok(app)
}

#[tauri::command]
pub async fn update_surface_component(
    state: State<'_, AppState>,
    app_id: String,
    request: UpdateSurfaceComponentRequest,
) -> Result<SurfaceComponent, String> {
    let workspace_root = workspace_root_from_input(request.workspace_path.as_deref());
    let app = state
        .surface_component_manager
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
            request.interaction,
            request.ai_context,
            request.permission_rationale,
            workspace_root.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())?;
    maybe_stop_worker(&state, &app).await;
    emit_surface_component_runtime_issues_cleared(&app.id).await;
    sync_surface_component_work_titles(&app).await;
    emit_surface_component_event(
        "surface-component-updated",
        surface_component_payload(&app, "update"),
    )
    .await;
    Ok(app)
}

#[tauri::command]
pub async fn delete_surface_component(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<(), String> {
    if let Some(ref pool) = state.js_worker_pool {
        pool.stop(app_id.as_str()).await;
    }
    state
        .surface_component_manager
        .delete(&app_id)
        .await
        .map_err(|e| e.to_string())?;
    emit_surface_component_event(
        "surface-component-deleted",
        json!({ "id": app_id, "reason": "delete" }),
    )
    .await;
    Ok(())
}

#[tauri::command]
pub async fn get_surface_component_versions(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<Vec<u32>, String> {
    state
        .surface_component_manager
        .list_versions(&app_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rollback_surface_component(
    state: State<'_, AppState>,
    app_id: String,
    version: u32,
) -> Result<SurfaceComponent, String> {
    let app = state
        .surface_component_manager
        .rollback(&app_id, version)
        .await
        .map_err(|e| e.to_string())?;
    maybe_stop_worker(&state, &app).await;
    emit_surface_component_runtime_issues_cleared(&app.id).await;
    sync_surface_component_work_titles(&app).await;
    emit_surface_component_event(
        "surface-component-rolled-back",
        surface_component_payload(&app, "rollback"),
    )
    .await;
    emit_surface_component_event(
        "surface-component-updated",
        surface_component_payload(&app, "rollback"),
    )
    .await;
    Ok(app)
}

#[tauri::command]
pub async fn get_surface_component_storage(
    state: State<'_, AppState>,
    app_id: String,
    key: String,
) -> Result<Value, String> {
    state
        .surface_component_manager
        .get_storage(&app_id, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_surface_component_storage(
    state: State<'_, AppState>,
    app_id: String,
    key: String,
    value: Value,
) -> Result<(), String> {
    state
        .surface_component_manager
        .set_storage(&app_id, &key, value)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn grant_surface_component_workspace(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<(), String> {
    state
        .surface_component_manager
        .grant_workspace(&app_id)
        .await;
    Ok(())
}

#[tauri::command]
pub async fn grant_surface_component_path(
    state: State<'_, AppState>,
    app_id: String,
    path: String,
) -> Result<(), String> {
    state
        .surface_component_manager
        .grant_path(&app_id, PathBuf::from(path))
        .await;
    Ok(())
}

// ============== JS Worker & Runtime ==============

#[tauri::command]
pub async fn surface_component_runtime_status(
    state: State<'_, AppState>,
) -> Result<RuntimeStatus, String> {
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
            bitfun_core::surface_component::RuntimeKind::Bun => "bun".to_string(),
            bitfun_core::surface_component::RuntimeKind::Node => "node".to_string(),
        }),
        version: Some(info.version.clone()),
        path: Some(info.path.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub async fn surface_component_worker_call(
    state: State<'_, AppState>,
    request: SurfaceComponentWorkerCallRequest,
) -> Result<Value, String> {
    if request.method == "storage.get" {
        let key = request
            .params
            .get("key")
            .and_then(Value::as_str)
            .ok_or_else(|| "storage.get requires string key".to_string())?;
        return state
            .surface_component_manager
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
            .surface_component_manager
            .set_storage(&request.app_id, key, value)
            .await
            .map_err(|e| e.to_string())?;
        return Ok(Value::Null);
    }

    if is_host_primitive(&request.method) {
        let app = state
            .surface_component_manager
            .get(&request.app_id)
            .await
            .map_err(|e| e.to_string())?;
        let workspace_root = workspace_root_from_input(request.workspace_path.as_deref());
        let granted_paths = state
            .surface_component_manager
            .granted_paths_for_app(&request.app_id)
            .await;
        let app_data_dir = state
            .surface_component_manager
            .path_manager()
            .surface_component_dir(&request.app_id);
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
        .surface_component_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;
    let deps_installed = ensure_worker_dependencies(&state, &request.app_id, &mut app).await?;
    let workspace_root = workspace_root_from_input(request.workspace_path.as_deref());
    let policy = state
        .surface_component_manager
        .resolve_policy_for_app(&request.app_id, &app.permissions, workspace_root.as_deref())
        .await;
    let policy_json = serde_json::to_string(&policy).map_err(|e| e.to_string())?;
    let worker_revision = state
        .surface_component_manager
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
            .surface_component_manager
            .clear_worker_restart_required(&request.app_id)
            .await
            .map_err(|e| e.to_string())?;
        emit_surface_component_event(
            "surface-component-worker-restarted",
            surface_component_payload(
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
pub async fn surface_component_worker_stop(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<(), String> {
    if let Some(ref pool) = state.js_worker_pool {
        pool.stop(&app_id).await;
    }
    emit_surface_component_event(
        "surface-component-worker-stopped",
        json!({ "id": app_id, "reason": "manual-stop" }),
    )
    .await;
    Ok(())
}

#[tauri::command]
pub async fn surface_component_worker_list_running(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let Some(ref pool) = state.js_worker_pool else {
        return Ok(vec![]);
    };
    Ok(pool.list_running().await)
}

#[tauri::command]
pub async fn surface_component_install_deps(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<CoreInstallResult, String> {
    let pool = state
        .js_worker_pool
        .as_ref()
        .ok_or_else(|| "JS Worker pool not initialized".to_string())?;
    let app = state
        .surface_component_manager
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
            .surface_component_manager
            .mark_deps_installed(&app_id)
            .await
            .map_err(|e| e.to_string())?;
        emit_surface_component_event(
            "surface-component-updated",
            surface_component_payload(&app, "deps-installed"),
        )
        .await;
    }
    Ok(install)
}

#[tauri::command]
pub async fn surface_component_recompile(
    state: State<'_, AppState>,
    request: SurfaceComponentRecompileRequest,
) -> Result<RecompileResult, String> {
    let theme_type = request.theme.as_deref().unwrap_or("dark");
    let workspace_root = workspace_root_from_input(request.workspace_path.as_deref());
    let app = state
        .surface_component_manager
        .recompile(&request.app_id, theme_type, workspace_root.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    emit_surface_component_runtime_issues_cleared(&app.id).await;
    emit_surface_component_event(
        "surface-component-recompiled",
        surface_component_payload(&app, "recompile"),
    )
    .await;
    emit_surface_component_event(
        "surface-component-updated",
        surface_component_payload(&app, "recompile"),
    )
    .await;
    Ok(RecompileResult {
        success: true,
        warnings: None,
    })
}

#[tauri::command]
pub async fn surface_component_dialog_message(
    _state: State<'_, AppState>,
    _app_id: String,
    _options: Value,
) -> Result<Value, String> {
    // Tauri dialog is handled by frontend useSurfaceComponentBridge via @tauri-apps/plugin-dialog.
    // This command can be used if we want backend to show message box; for now return not implemented.
    Err("Use dialog from frontend bridge".to_string())
}

#[tauri::command]
pub async fn surface_component_import_from_path(
    state: State<'_, AppState>,
    request: SurfaceComponentImportFromPathRequest,
) -> Result<SurfaceComponent, String> {
    let path_buf = PathBuf::from(&request.path);
    let workspace_root = workspace_root_from_input(request.workspace_path.as_deref());
    let app = state
        .surface_component_manager
        .import_from_path(path_buf, workspace_root.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    maybe_stop_worker(&state, &app).await;
    sync_surface_component_work_titles(&app).await;
    emit_surface_component_event(
        "surface-component-created",
        surface_component_payload(&app, "import"),
    )
    .await;
    Ok(app)
}

#[tauri::command]
pub async fn surface_component_sync_from_fs(
    state: State<'_, AppState>,
    request: SurfaceComponentSyncFromFsRequest,
) -> Result<SurfaceComponent, String> {
    let theme_type = request.theme.as_deref().unwrap_or("dark");
    let workspace_root = workspace_root_from_input(request.workspace_path.as_deref());
    let app = state
        .surface_component_manager
        .sync_from_fs(&request.app_id, theme_type, workspace_root.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    maybe_stop_worker(&state, &app).await;
    emit_surface_component_runtime_issues_cleared(&app.id).await;
    sync_surface_component_work_titles(&app).await;
    emit_surface_component_event(
        "surface-component-updated",
        surface_component_payload(&app, "sync-from-fs"),
    )
    .await;
    Ok(app)
}

#[tauri::command]
pub async fn surface_component_report_runtime_issue(
    state: State<'_, AppState>,
    request: SurfaceComponentRuntimeIssueRequest,
) -> Result<(), String> {
    let issue = SurfaceComponentRuntimeIssue {
        app_id: request.app_id,
        severity: request
            .severity
            .unwrap_or(SurfaceComponentRuntimeIssueSeverity::Fatal),
        message: request.message,
        source: request.source,
        stack: request.stack,
        category: request.category,
        timestamp_ms: request.timestamp_ms.unwrap_or_else(|| now_ms() as i64),
    };
    state
        .surface_component_manager
        .record_runtime_issue(issue.clone())
        .await;
    emit_surface_component_event("surface-component-runtime-error", json!(issue)).await;
    Ok(())
}

#[tauri::command]
pub async fn surface_component_report_runtime_log(
    state: State<'_, AppState>,
    request: SurfaceComponentRuntimeLogRequest,
) -> Result<(), String> {
    let log_entry = SurfaceComponentRuntimeLog {
        app_id: request.app_id,
        level: request
            .level
            .unwrap_or(SurfaceComponentRuntimeLogLevel::Info),
        category: request.category.unwrap_or_else(|| "runtime".to_string()),
        message: request.message,
        source: request.source,
        stack: request.stack,
        details: request.details,
        timestamp_ms: request.timestamp_ms.unwrap_or_else(|| now_ms() as i64),
    };
    state
        .surface_component_manager
        .record_runtime_log(log_entry)
        .await;
    Ok(())
}

#[tauri::command]
pub async fn surface_component_clear_runtime_issues(
    state: State<'_, AppState>,
    request: SurfaceComponentClearRuntimeIssuesRequest,
) -> Result<(), String> {
    state
        .surface_component_manager
        .clear_runtime_issues(&request.app_id)
        .await;
    emit_surface_component_runtime_issues_cleared(&request.app_id).await;
    Ok(())
}

#[tauri::command]
pub async fn surface_component_capture_matrix(
    state: State<'_, AppState>,
    request: SurfaceComponentCaptureMatrixRequest,
) -> Result<Value, String> {
    let app = state
        .surface_component_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;
    let timestamp = now_ms() as i64;
    let review_dir = state
        .surface_component_manager
        .path_manager()
        .surface_component_dir(&request.app_id)
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
    emit_surface_component_event(
        "surface-component-screenshot-matrix-requested",
        result.clone(),
    )
    .await;
    Ok(result)
}

// ============== AI commands ==============

/// Active AI stream cancellation flags: stream_id → cancel flag.
static AI_STREAM_REGISTRY: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

/// Per-app rate limiter state: app_id → (request_count, window_start_ms).
static AI_RATE_LIMITER: OnceLock<Mutex<HashMap<String, (u32, u64)>>> = OnceLock::new();
static SURFACE_COMPONENT_AGENTIC_TURN_COUNTER: AtomicU64 = AtomicU64::new(1);

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
    ai_perms: &bitfun_core::surface_component::AiPermissions,
) -> Result<String, String> {
    let requested = model.unwrap_or("primary");
    if let Some(ref allowed) = ai_perms.allowed_models {
        if !allowed.is_empty() && !allowed.iter().any(|m| m == requested) {
            return Err(format!(
                "Model '{}' is not allowed by this Product App's AI permissions",
                requested
            ));
        }
    }
    Ok(requested.to_string())
}

// ---- Request/Response DTOs for AI commands ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentAiChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentAiCompleteRequest {
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
pub struct SurfaceComponentAiCompleteResponse {
    pub text: String,
    pub usage: Option<SurfaceComponentAiUsage>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentAiUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentAiChatRequest {
    pub app_id: String,
    pub messages: Vec<SurfaceComponentAiChatMessage>,
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
pub struct SurfaceComponentAiChatStartedResponse {
    pub stream_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentAiCancelRequest {
    pub app_id: String,
    pub stream_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentAiListModelsRequest {
    pub app_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentAiModelInfo {
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
    chat_messages: &[SurfaceComponentAiChatMessage],
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
pub async fn surface_component_ai_complete(
    state: State<'_, AppState>,
    request: SurfaceComponentAiCompleteRequest,
) -> Result<SurfaceComponentAiCompleteResponse, String> {
    let app = state
        .surface_component_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;

    let ai_perms = app
        .permissions
        .ai
        .as_ref()
        .ok_or("AI access is not enabled for this Product App")?;

    if !ai_perms.enabled {
        return Err("AI access is not enabled for this Product App".to_string());
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
        &[SurfaceComponentAiChatMessage {
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
    let mut usage: Option<SurfaceComponentAiUsage> = None;

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                if let Some(text) = chunk.text {
                    full_text.push_str(&text);
                }
                if let Some(u) = chunk.usage {
                    usage = Some(SurfaceComponentAiUsage {
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

    Ok(SurfaceComponentAiCompleteResponse {
        text: full_text,
        usage,
    })
}

/// Streaming AI chat — returns immediately, emits chunks via "surface-component://ai-stream" events.
#[tauri::command]
pub async fn surface_component_ai_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    request: SurfaceComponentAiChatRequest,
) -> Result<SurfaceComponentAiChatStartedResponse, String> {
    if request.stream_id.trim().is_empty() {
        return Err("streamId is required".to_string());
    }
    if request.messages.is_empty() {
        return Err("messages must not be empty".to_string());
    }

    let surface_component = state
        .surface_component_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;

    let ai_perms = surface_component
        .permissions
        .ai
        .as_ref()
        .ok_or("AI access is not enabled for this Product App")?;

    if !ai_perms.enabled {
        return Err("AI access is not enabled for this Product App".to_string());
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
        let mut last_usage: Option<SurfaceComponentAiUsage> = None;

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
                        if let Err(e) = app_handle.emit("surface-component://ai-stream", &payload) {
                            log::warn!("Failed to emit AI stream chunk: {}", e);
                        }
                    }

                    if let Some(u) = chunk.usage {
                        last_usage = Some(SurfaceComponentAiUsage {
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
                    let _ = app_handle.emit("surface-component://ai-stream", &payload);
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
        let _ = app_handle.emit("surface-component://ai-stream", &done_payload);

        // Clean up registry
        let mut registry = ai_stream_registry()
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        registry.remove(&stream_id);
    });

    Ok(SurfaceComponentAiChatStartedResponse {
        stream_id: request.stream_id,
    })
}

/// Cancel an ongoing AI stream.
#[tauri::command]
pub async fn surface_component_ai_cancel(
    _state: State<'_, AppState>,
    request: SurfaceComponentAiCancelRequest,
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

/// List AI models available to a Product App (no sensitive fields).
#[tauri::command]
pub async fn surface_component_ai_list_models(
    state: State<'_, AppState>,
    request: SurfaceComponentAiListModelsRequest,
) -> Result<Vec<SurfaceComponentAiModelInfo>, String> {
    let surface_component = state
        .surface_component_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;

    let ai_perms = surface_component
        .permissions
        .ai
        .as_ref()
        .ok_or("AI access is not enabled for this Product App")?;

    if !ai_perms.enabled {
        return Err("AI access is not enabled for this Product App".to_string());
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

    let models: Vec<SurfaceComponentAiModelInfo> = global_config
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
        .map(|m| SurfaceComponentAiModelInfo {
            id: m.id.clone(),
            name: m.name.clone(),
            provider: m.provider.clone(),
            is_default: m.id == primary_id,
        })
        .collect();

    Ok(models)
}

fn next_surface_component_backend_run_id(app_id: &str) -> String {
    let sequence = SURFACE_COMPONENT_AGENTIC_TURN_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("surface-component-backend-{}-{}", app_id, sequence)
}

fn build_backend_action_prompt(
    surface_component: &SurfaceComponent,
    backend_id: &str,
    action_name: &str,
    binding_action_schema: &Value,
    service_action_prompt: &str,
    service_output_schema: &Value,
    input: &Value,
) -> String {
    let action_instruction = if service_action_prompt.trim().is_empty() {
        "Execute the requested service action for the Product App.".to_string()
    } else {
        service_action_prompt.trim().to_string()
    };
    format!(
        r#"You are serving a Sparo OS Product App backend action.

Product App:
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
        app_id = surface_component.id,
        app_name = surface_component.name,
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

const PPT_LIVE_PRIVATE_OWNER_PREFIX: &str = "surface-component-backend:builtin-ppt-live:ppt:";

fn is_ppt_live_private_session(created_by: Option<&str>) -> bool {
    created_by
        .map(|value| value.starts_with(PPT_LIVE_PRIVATE_OWNER_PREFIX))
        .unwrap_or(false)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentCancelStalePptRunsRequest {
    pub workspace_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceComponentCancelStalePptRunsResponse {
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

    let cancelled = scheduler
        .cancel_active_turn_for_session(
            session_id,
            TurnCancellationReason::Superseded,
            SessionControlActor::System,
            Duration::from_secs(2),
        )
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
    scheduler
        .cancel_dialog_turn(
            session_id,
            current_turn_id,
            TurnCancellationReason::Superseded,
            SessionControlActor::System,
        )
        .await
        .map_err(|e| format!("Failed to cancel processing PPT Live turn: {}", e))?;
    Ok(Some(current_turn_id.clone()))
}

/// Cancel in-flight PPT Live private backend runs (survives app/webview reload).
pub async fn cancel_stale_ppt_live_private_runs_internal(
    coordinator: &ConversationCoordinator,
    scheduler: &DialogScheduler,
    workspace_path: &Path,
) -> Result<SurfaceComponentCancelStalePptRunsResponse, String> {
    let effective_path = workspace_path.to_path_buf();
    let mut session_ids = HashSet::new();

    for session in coordinator.get_session_manager().list_loaded_sessions() {
        if is_ppt_live_private_session(session.created_by.as_deref()) {
            session_ids.insert(session.session_id);
        }
    }

    let summaries = coordinator
        .list_sessions(&effective_path)
        .await
        .map_err(|e| format!("Failed to list sessions for PPT Live cleanup: {}", e))?;
    for summary in summaries {
        if is_ppt_live_private_session(summary.created_by.as_deref()) {
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

    Ok(SurfaceComponentCancelStalePptRunsResponse {
        cancelled_sessions,
        cancelled_turns,
        cleared_queues,
    })
}

#[tauri::command]
pub async fn surface_component_cancel_stale_ppt_runs(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    state: State<'_, AppState>,
    request: SurfaceComponentCancelStalePptRunsRequest,
) -> Result<SurfaceComponentCancelStalePptRunsResponse, String> {
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
pub async fn surface_component_ppt_turn_assistant_text(
    state: State<'_, AppState>,
    request: SurfaceComponentPptTurnTextRequest,
) -> Result<SurfaceComponentPptTurnTextResponse, String> {
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
        return Ok(SurfaceComponentPptTurnTextResponse { text });
    }

    Err(format!("PPT Live dialog turn not found: {}", turn_id))
}

async fn submit_ppt_live_private_backend(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    state: State<'_, AppState>,
    app: SurfaceComponent,
    backend_id: &str,
    action_name: &str,
    request: SurfaceComponentBackendCallRequest,
) -> Result<SurfaceComponentBackendCallResponse, String> {
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
        .unwrap_or_else(|| next_surface_component_backend_run_id(&app.id));
    let owner = format!(
        "{}:{}",
        surface_component_backend_owner(&app.id, backend_id, request.entity_id.as_deref()),
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

    Ok(SurfaceComponentBackendCallResponse {
        session_id: session.session_id,
        turn_id: action_run_id.clone(),
        action_run_id,
        status,
        backend_id: backend_id.to_string(),
        action: action_name.to_string(),
        agent_type: "agentic".to_string(),
        backend_kind: "agentComponent".to_string(),
        backend_component_id: "agentic".to_string(),
        bridge_result: None,
    })
}

#[tauri::command]
pub async fn surface_component_backend_call(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    state: State<'_, AppState>,
    request: SurfaceComponentBackendCallRequest,
) -> Result<SurfaceComponentBackendCallResponse, String> {
    let app = state
        .surface_component_manager
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
        .ok_or_else(|| format!("Product App backend '{}' is not declared", backend_id))?;
    let binding_action = binding
        .actions
        .iter()
        .find(|action| action.name == action_name)
        .ok_or_else(|| {
            format!(
                "Action '{}' is not declared for Product App backend '{}'",
                action_name, backend_id
            )
        })?;

    let action_run_id = request
        .idempotency_key
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| next_surface_component_backend_run_id(&app.id));

    if binding.kind == SurfaceComponentBackendKind::BridgeComponent {
        let result = BridgeComponentManager::run_capability_action(
            &binding.component_id,
            binding.capability_id.as_deref(),
            &action_name,
            request.input.clone(),
            request.workspace_path.clone(),
            action_run_id.clone(),
            BridgeComponentConsumer {
                kind: BridgeComponentConsumerKind::SurfaceComponentBackend,
                id: app.id.clone(),
                session_id: None,
                turn_id: Some(action_run_id.clone()),
            },
        )
        .await
        .map_err(|e| format!("Failed to run Bridge Component backend: {}", e))?;
        let status = match result.status {
            BridgeComponentRunStatus::Completed => "completed",
            BridgeComponentRunStatus::Failed => "failed",
            BridgeComponentRunStatus::Cancelled => "cancelled",
            BridgeComponentRunStatus::Pending => "pending",
            BridgeComponentRunStatus::Running => "running",
            BridgeComponentRunStatus::WaitingForApproval => "waiting_for_approval",
        }
        .to_string();
        for event in &result.events {
            emit_surface_component_event(
                "surface-component-backend-event",
                json!({
                    "appId": app.id,
                    "backendId": backend_id,
                    "action": action_name,
                    "actionRunId": action_run_id,
                    "backendKind": "bridgeComponent",
                    "backendComponentId": binding.component_id,
                    "event": event,
                }),
            )
            .await;
        }

        return Ok(SurfaceComponentBackendCallResponse {
            session_id: String::new(),
            turn_id: action_run_id.clone(),
            action_run_id,
            status,
            backend_id,
            action: action_name,
            agent_type: binding.component_id.clone(),
            backend_kind: "bridgeComponent".to_string(),
            backend_component_id: binding.component_id.clone(),
            bridge_result: Some(result),
        });
    }

    let agent_package = AgentComponentManager::get(&binding.component_id, None, None)
        .map_err(|e| format!("Failed to load Agent Component backend: {}", e))?;
    let service_action = agent_package
        .manifest
        .service_actions
        .iter()
        .find(|action| action.name == action_name)
        .ok_or_else(|| {
            format!(
                "Agent Component '{}' does not expose service action '{}'",
                binding.component_id, action_name
            )
        })?;
    if let Some(bridge_call) = service_action.bridge_call.as_ref() {
        let bridge_action = bridge_call
            .action
            .trim()
            .is_empty()
            .then_some(action_name.as_str())
            .unwrap_or_else(|| bridge_call.action.as_str());
        let result = BridgeComponentManager::run_capability_action(
            &bridge_call.bridge_id,
            Some(&bridge_call.capability_id),
            bridge_action,
            request.input.clone(),
            request.workspace_path.clone(),
            action_run_id.clone(),
            BridgeComponentConsumer {
                kind: BridgeComponentConsumerKind::AgentComponent,
                id: binding.component_id.clone(),
                session_id: None,
                turn_id: Some(action_run_id.clone()),
            },
        )
        .await
        .map_err(|e| format!("Failed to run Agent Component Bridge service action: {}", e))?;
        let status = match result.status {
            BridgeComponentRunStatus::Completed => "completed",
            BridgeComponentRunStatus::Failed => "failed",
            BridgeComponentRunStatus::Cancelled => "cancelled",
            BridgeComponentRunStatus::Pending => "pending",
            BridgeComponentRunStatus::Running => "running",
            BridgeComponentRunStatus::WaitingForApproval => "waiting_for_approval",
        }
        .to_string();
        for event in &result.events {
            emit_surface_component_event(
                "surface-component-backend-event",
                json!({
                    "appId": app.id,
                    "backendId": backend_id,
                    "action": action_name,
                    "actionRunId": action_run_id,
                    "backendKind": "agentComponent",
                    "backendComponentId": binding.component_id,
                    "bridgeComponentId": bridge_call.bridge_id,
                    "capabilityId": bridge_call.capability_id,
                    "bridgeAction": bridge_action,
                    "event": event,
                }),
            )
            .await;
        }

        return Ok(SurfaceComponentBackendCallResponse {
            session_id: String::new(),
            turn_id: action_run_id.clone(),
            action_run_id,
            status,
            backend_id,
            action: action_name,
            agent_type: binding.component_id.clone(),
            backend_kind: "agentComponent".to_string(),
            backend_component_id: binding.component_id.clone(),
            bridge_result: Some(result),
        });
    }

    let workspace_path = state
        .workspace_service
        .path_manager()
        .agentic_os_runtime_root()
        .to_string_lossy()
        .into_owned();
    let owner = surface_component_backend_owner(&app.id, &backend_id, request.entity_id.as_deref());
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
                    binding.component_id.clone(),
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
            binding.component_id.clone(),
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

    Ok(SurfaceComponentBackendCallResponse {
        session_id: session.session_id,
        turn_id: action_run_id.clone(),
        action_run_id,
        status,
        backend_id,
        action: action_name,
        agent_type: binding.component_id.clone(),
        backend_kind: "agentComponent".to_string(),
        backend_component_id: binding.component_id.clone(),
        bridge_result: None,
    })
}

#[tauri::command]
pub async fn surface_component_backend_status(
    state: State<'_, AppState>,
    request: SurfaceComponentBackendRunRequest,
) -> Result<Value, String> {
    let _app = state
        .surface_component_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(run) = BridgeComponentManager::get_run(&request.action_run_id).await {
        return Ok(json!({
            "kind": "bridgeComponent",
            "actionRunId": request.action_run_id,
            "status": run.status,
            "backendComponentId": run.bridge_id,
            "capabilityId": run.capability_id,
            "action": run.action,
            "updatedAt": run.updated_at,
            "artifacts": run.artifacts,
            "output": run.output,
        }));
    }

    Ok(json!({
        "kind": "agentComponent",
        "actionRunId": request.action_run_id,
        "sessionId": request.session_id,
        "turnId": request.turn_id,
        "status": "unknown",
        "message": "Agent Component backend status is available through backend event streaming.",
    }))
}

#[tauri::command]
pub async fn surface_component_backend_cancel_run(
    scheduler: State<'_, Arc<DialogScheduler>>,
    state: State<'_, AppState>,
    request: SurfaceComponentBackendRunRequest,
) -> Result<Value, String> {
    let _app = state
        .surface_component_manager
        .get(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;

    if BridgeComponentManager::get_run(&request.action_run_id)
        .await
        .is_some()
    {
        let run = BridgeComponentManager::cancel_run(&request.action_run_id)
            .await
            .map_err(|e| e.to_string())?;
        return Ok(json!({
            "kind": "bridgeComponent",
            "actionRunId": request.action_run_id,
            "status": run.status,
            "backendComponentId": run.bridge_id,
            "capabilityId": run.capability_id,
            "action": run.action,
        }));
    }

    let session_id = request
        .session_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "backend.cancelRun requires sessionId for Agent Component backend runs".to_string()
        })?;
    let turn_id = request
        .turn_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "backend.cancelRun requires turnId for Agent Component backend runs".to_string()
        })?;

    scheduler
        .cancel_dialog_turn(
            session_id,
            turn_id,
            TurnCancellationReason::UserRequested,
            SessionControlActor::User,
        )
        .await
        .map_err(|e| format!("Failed to cancel backend run: {}", e))?;

    Ok(json!({
        "kind": "agentComponent",
        "actionRunId": request.action_run_id,
        "sessionId": session_id,
        "turnId": turn_id,
        "status": "cancelled",
    }))
}
