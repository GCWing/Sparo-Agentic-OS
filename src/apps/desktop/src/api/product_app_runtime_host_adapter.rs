//! Bottom adapter from Product App Runtime host operations to the desktop host engine.

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::api::app_state::AppState;
use crate::api::product_app_runtime_host_engine as host_engine;
use sparo_core::agentic::coordination::{ConversationCoordinator, DialogScheduler};
pub(crate) use sparo_core::product_app_runtime_host::ProductAppRuntimeHostInstallResult as HostAdapterInstallResult;

pub(crate) use crate::api::product_app_runtime_host_engine::{
    ProductAppRuntimeHostAiCancelRequest as HostAdapterAiCancelRequest,
    ProductAppRuntimeHostAiChatMessage as HostAdapterAiChatMessage,
    ProductAppRuntimeHostAiChatRequest as HostAdapterAiChatRequest,
    ProductAppRuntimeHostAiChatStartedResponse as HostAdapterAiChatStartedResponse,
    ProductAppRuntimeHostAiCompleteRequest as HostAdapterAiCompleteRequest,
    ProductAppRuntimeHostAiCompleteResponse as HostAdapterAiCompleteResponse,
    ProductAppRuntimeHostAiListModelsRequest as HostAdapterAiListModelsRequest,
    ProductAppRuntimeHostAiModelInfo as HostAdapterAiModelInfo,
    ProductAppRuntimeHostAiUsage as HostAdapterAiUsage,
    ProductAppRuntimeHostBackendCallRequest as HostAdapterBackendCallRequest,
    ProductAppRuntimeHostBackendCallResponse as HostAdapterBackendCallResponse,
    ProductAppRuntimeHostBackendRunRequest as HostAdapterBackendRunRequest,
    ProductAppRuntimeHostClearRuntimeIssuesRequest as HostAdapterClearRuntimeIssuesRequest,
    ProductAppRuntimeHostRecompileRequest as HostAdapterRecompileRequest,
    ProductAppRuntimeHostRuntimeIssueRequest as HostAdapterRuntimeIssueRequest,
    ProductAppRuntimeHostRuntimeLogRequest as HostAdapterRuntimeLogRequest,
    ProductAppRuntimeHostWorkerCallRequest as HostAdapterWorkerCallRequest,
    RecompileResult as HostAdapterRecompileResult, RuntimeStatus as HostAdapterRuntimeStatus,
};

pub(crate) use crate::api::product_app_runtime_host_engine::{
    ProductAppRuntimeHostGetRequest as HostAdapterGetRequest,
    ProductAppRuntimeHostRecordRecentRequest as HostAdapterRecordRecentRequest,
};
pub(crate) use sparo_core::product_app_runtime_host::{
    ProductAppRuntimeHostAgentWorkspace as HostAdapterCoreAgentWorkspace,
    ProductAppRuntimeHostBackendActionBinding as HostAdapterCoreBackendActionBinding,
    ProductAppRuntimeHostBackendBinding as HostAdapterCoreBackendBinding,
    ProductAppRuntimeHostBackendKind as HostAdapterCoreBackendKind,
    ProductAppRuntimeHostBackendMemoryScope as HostAdapterCoreBackendMemoryScope,
    ProductAppRuntimeHostBackendSessionPolicy as HostAdapterCoreBackendSessionPolicy,
    ProductAppRuntimeHostFlowChatCard as HostAdapterCoreFlowChatCard,
    ProductAppRuntimeHostIframePermissions as HostAdapterCoreIframePermissions,
    ProductAppRuntimeHostInteraction as HostAdapterCoreInteraction,
    ProductAppRuntimeHostInteractionChat as HostAdapterCoreInteractionChat,
    ProductAppRuntimeHostInteractionMode as HostAdapterCoreInteractionMode,
    ProductAppRuntimeHostInteractionTab as HostAdapterCoreInteractionTab,
    ProductAppRuntimeHostInteractionTabSidecar as HostAdapterCoreInteractionTabSidecar,
    ProductAppRuntimeHostInteractionText as HostAdapterCoreInteractionText,
    ProductAppRuntimeHostManager as HostAdapterCoreManager,
    ProductAppRuntimeHostNetPermissions as HostAdapterCoreNetPermissions,
    ProductAppRuntimeHostPermissions as HostAdapterCorePermissions,
    ProductAppRuntimeHostRuntimeIssueSeverity as HostAdapterRuntimeIssueSeverity,
    ProductAppRuntimeHostRuntimeLogLevel as HostAdapterRuntimeLogLevel,
    ProductAppRuntimeHostRuntimeState as HostAdapterRuntimeState,
    ProductAppRuntimeHostSurface as HostAdapterCoreSurface,
    ProductAppRuntimeHostSurfaceMeta as HostAdapterCoreSurfaceMeta,
};

pub(crate) fn manager(state: &AppState) -> &Arc<HostAdapterCoreManager> {
    &state.product_app_runtime_host_manager
}

pub(crate) async fn list_host_surfaces(
    state: State<'_, AppState>,
) -> Result<Vec<HostAdapterCoreSurfaceMeta>, String> {
    host_engine::list_product_app_runtime_host_surfaces(state).await
}

pub(crate) async fn list_recent_host_surfaces(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    host_engine::list_recent_product_app_runtime_host_surfaces(state).await
}

pub(crate) async fn record_recent_host_surface(
    state: State<'_, AppState>,
    request: HostAdapterRecordRecentRequest,
) -> Result<Vec<String>, String> {
    host_engine::record_recent_product_app_runtime_host_surface(state, request).await
}

pub(crate) async fn get_host_surface(
    state: State<'_, AppState>,
    request: HostAdapterGetRequest,
) -> Result<HostAdapterCoreSurface, String> {
    host_engine::get_product_app_runtime_host_surface(state, request).await
}

pub(crate) async fn runtime_status(
    state: State<'_, AppState>,
) -> Result<HostAdapterRuntimeStatus, String> {
    host_engine::product_app_runtime_host_status(state).await
}

pub(crate) async fn list_running_workers(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    host_engine::product_app_runtime_host_list_running_workers(state).await
}

pub(crate) async fn stop_worker(state: State<'_, AppState>, app_id: String) -> Result<(), String> {
    host_engine::product_app_runtime_host_stop_worker(state, app_id).await
}

pub(crate) async fn install_dependencies(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<HostAdapterInstallResult, String> {
    host_engine::product_app_runtime_host_install_deps(state, app_id).await
}

pub(crate) async fn recompile_host_surface(
    state: State<'_, AppState>,
    request: HostAdapterRecompileRequest,
) -> Result<HostAdapterRecompileResult, String> {
    host_engine::product_app_runtime_host_recompile(state, request).await
}

pub(crate) async fn clear_runtime_issues(
    state: State<'_, AppState>,
    request: HostAdapterClearRuntimeIssuesRequest,
) -> Result<(), String> {
    host_engine::product_app_runtime_host_clear_runtime_issues(state, request).await
}

pub(crate) async fn worker_call(
    state: State<'_, AppState>,
    request: HostAdapterWorkerCallRequest,
) -> Result<serde_json::Value, String> {
    host_engine::product_app_runtime_host_worker_call(state, request).await
}

pub(crate) async fn report_runtime_issue(
    state: State<'_, AppState>,
    request: HostAdapterRuntimeIssueRequest,
) -> Result<(), String> {
    host_engine::product_app_runtime_host_report_runtime_issue(state, request).await
}

pub(crate) async fn report_runtime_log(
    state: State<'_, AppState>,
    request: HostAdapterRuntimeLogRequest,
) -> Result<(), String> {
    host_engine::product_app_runtime_host_report_runtime_log(state, request).await
}

pub(crate) async fn ai_complete(
    state: State<'_, AppState>,
    request: HostAdapterAiCompleteRequest,
) -> Result<HostAdapterAiCompleteResponse, String> {
    host_engine::product_app_runtime_host_ai_complete(state, request).await
}

pub(crate) async fn ai_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    request: HostAdapterAiChatRequest,
) -> Result<HostAdapterAiChatStartedResponse, String> {
    host_engine::product_app_runtime_host_ai_chat(app, state, request).await
}

pub(crate) async fn ai_cancel(
    state: State<'_, AppState>,
    request: HostAdapterAiCancelRequest,
) -> Result<(), String> {
    host_engine::product_app_runtime_host_ai_cancel(state, request).await
}

pub(crate) async fn ai_list_models(
    state: State<'_, AppState>,
    request: HostAdapterAiListModelsRequest,
) -> Result<Vec<HostAdapterAiModelInfo>, String> {
    host_engine::product_app_runtime_host_ai_list_models(state, request).await
}

pub(crate) async fn backend_call(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    state: State<'_, AppState>,
    request: HostAdapterBackendCallRequest,
) -> Result<HostAdapterBackendCallResponse, String> {
    host_engine::product_app_runtime_host_backend_call(coordinator, scheduler, state, request).await
}

pub(crate) async fn backend_status(
    state: State<'_, AppState>,
    request: HostAdapterBackendRunRequest,
) -> Result<serde_json::Value, String> {
    host_engine::product_app_runtime_host_backend_status(state, request).await
}

pub(crate) async fn backend_cancel_run(
    scheduler: State<'_, Arc<DialogScheduler>>,
    state: State<'_, AppState>,
    request: HostAdapterBackendRunRequest,
) -> Result<serde_json::Value, String> {
    host_engine::product_app_runtime_host_backend_cancel_run(scheduler, state, request).await
}
