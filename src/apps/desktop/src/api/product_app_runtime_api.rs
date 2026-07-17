//! Product App runtime API.
//!
//! Catalog APIs expose Product App and Component definitions. Runtime APIs bind
//! a Product App Work to the host surface adapter that can execute it.

use crate::api::app_release_runtime::{
    resolve_authorized_app_release, validate_product_app_ref, ReleaseExecutionPurpose,
};
use crate::api::app_state::AppState;
use crate::api::product_app_runtime_host_adapter as host_adapter;
use crate::api::product_app_runtime_host_adapter::{
    HostAdapterAiCancelRequest, HostAdapterAiChatMessage, HostAdapterAiChatRequest,
    HostAdapterAiChatStartedResponse, HostAdapterAiCompleteRequest, HostAdapterAiCompleteResponse,
    HostAdapterAiListModelsRequest, HostAdapterAiModelInfo, HostAdapterAiUsage,
    HostAdapterBackendCallRequest, HostAdapterBackendCallResponse, HostAdapterBackendRunRequest,
    HostAdapterCancelStalePptRunsRequest, HostAdapterCancelStalePptRunsResponse,
    HostAdapterClearRuntimeIssuesRequest, HostAdapterCoreBackendActionBinding,
    HostAdapterCoreBackendBinding, HostAdapterCoreBackendKind, HostAdapterCoreBackendMemoryScope,
    HostAdapterCoreBackendSessionPolicy, HostAdapterCoreIframePermissions,
    HostAdapterCoreInteraction, HostAdapterCoreInteractionChat, HostAdapterCoreInteractionMode,
    HostAdapterCoreInteractionTab, HostAdapterCoreInteractionTabSidecar,
    HostAdapterCoreInteractionText, HostAdapterCoreManager, HostAdapterCoreNetPermissions,
    HostAdapterCorePermissions, HostAdapterCoreSurface, HostAdapterCoreSurfaceMeta,
    HostAdapterGetRequest, HostAdapterInstallResult, HostAdapterPptTurnTextRequest,
    HostAdapterPptTurnTextResponse, HostAdapterRecompileRequest, HostAdapterRecompileResult,
    HostAdapterRecordRecentRequest, HostAdapterRenderSlidePageRequest,
    HostAdapterRuntimeIssueRequest, HostAdapterRuntimeIssueSeverity, HostAdapterRuntimeLogLevel,
    HostAdapterRuntimeLogRequest, HostAdapterRuntimeState, HostAdapterRuntimeStatus,
    HostAdapterWorkerCallRequest,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sparo_core::agentic::agents::{get_agent_registry, AgentCategory};
use sparo_core::agentic::coordination::{ConversationCoordinator, DialogScheduler};
use sparo_core::agentic_os::work::{
    default_work_store, RuntimeInstanceRef, WorkAppIntent, WorkAppRef, WorkId, WorkKind,
    WorkRecord, WorkScope, WorkStore, WorkSubject, WorkSurfaceRef, WorkVisibility,
};
use sparo_core::app_platform::{
    private_component_source_dir, register_private_product_app_runtime_components, AppComponentRef,
    AppDefinition, AppIconSpec, AppRuntimeInteractionText, AppSurfaceMode, AppTruthSource,
    ComponentDefinition, ComponentKind, ProductAppEvolutionStore, ProductAppRuntimeIssueSeverity,
    ProductAppRuntimeLogLevel, ProductAppRuntimeState, ResolvedProductApp,
};
use sparo_core::bridge_component::BridgeComponentRunResult;
use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveProductAppRuntimeInstanceRequest {
    pub work_id: String,
    pub slot_id: String,
    pub app_id: String,
    pub release_id: String,
    pub config_revision: String,
    pub data_schema_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_instance_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_app_surface_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProductAppRuntimeHostKind {
    ProductAppRuntime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeHost {
    pub kind: ProductAppRuntimeHostKind,
    pub surface_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeContext {
    pub work_id: String,
    pub runtime_instance_id: String,
    pub slot_id: String,
    pub app_id: String,
    pub release_id: String,
    pub config_revision: String,
    pub data_schema_version: String,
    pub product_app_surface_id: String,
    pub surface_id: String,
    pub host_surface_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedProductAppRuntimeInstance {
    pub work_id: String,
    pub runtime_instance_id: String,
    pub slot_id: String,
    pub app_id: String,
    pub release_id: String,
    pub config_revision: String,
    pub data_schema_version: String,
    pub product_app_surface_id: String,
    pub surface_id: String,
    pub implementation_ref: String,
    pub host: ProductAppRuntimeHost,
    pub runtime_context: ProductAppRuntimeContext,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeRecordRecentHostSurfaceRequest {
    pub app_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeGetHostSurfaceRequest {
    pub app_id: String,
    pub theme: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ProductAppRuntimeHostRuntimeStatus {
    pub available: bool,
    pub kind: Option<String>,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ProductAppRuntimeInstallResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeRecompileHostSurfaceRequest {
    pub app_id: String,
    pub theme: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ProductAppRuntimeRecompileResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeClearRuntimeIssuesRequest {
    pub app_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeWorkerCallRequest {
    pub app_id: String,
    pub method: String,
    pub params: Value,
    #[serde(default)]
    pub workspace_path: Option<String>,
    pub runtime_context: ProductAppRuntimeContext,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeIssueRequest {
    pub app_id: String,
    pub runtime_context: ProductAppRuntimeContext,
    pub severity: Option<ProductAppRuntimeIssueSeverity>,
    pub message: String,
    pub source: Option<String>,
    pub stack: Option<String>,
    pub category: Option<String>,
    pub timestamp_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeLogRequest {
    pub app_id: String,
    pub runtime_context: ProductAppRuntimeContext,
    pub level: Option<ProductAppRuntimeLogLevel>,
    pub category: Option<String>,
    pub message: String,
    pub source: Option<String>,
    pub stack: Option<String>,
    pub details: Option<Value>,
    pub timestamp_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeAiChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeAiCompleteRequest {
    pub app_id: String,
    pub runtime_context: ProductAppRuntimeContext,
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
pub struct ProductAppRuntimeAiCompleteResponse {
    pub text: String,
    pub usage: Option<ProductAppRuntimeAiUsage>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeAiUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeAiChatRequest {
    pub app_id: String,
    pub runtime_context: ProductAppRuntimeContext,
    pub messages: Vec<ProductAppRuntimeAiChatMessage>,
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
pub struct ProductAppRuntimeAiChatStartedResponse {
    pub stream_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeAiCancelRequest {
    pub app_id: String,
    pub runtime_context: ProductAppRuntimeContext,
    pub stream_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeAiListModelsRequest {
    pub app_id: String,
    pub runtime_context: ProductAppRuntimeContext,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeAiModelInfo {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub is_default: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeBackendCallRequest {
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
    pub runtime_context: ProductAppRuntimeContext,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeBackendCallResponse {
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
pub struct ProductAppRuntimeBackendRunRequest {
    pub app_id: String,
    pub action_run_id: String,
    pub runtime_context: ProductAppRuntimeContext,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub turn_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeCancelStalePptRunsRequest {
    pub app_id: String,
    pub runtime_context: ProductAppRuntimeContext,
    pub workspace_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeCancelStalePptRunsResponse {
    pub cancelled_sessions: usize,
    pub cancelled_turns: usize,
    pub cleared_queues: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimePptTurnTextRequest {
    pub app_id: String,
    pub runtime_context: ProductAppRuntimeContext,
    pub session_id: String,
    pub turn_id: String,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimePptTurnTextResponse {
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRuntimeRenderSlidePageRequest {
    pub html: String,
    pub format: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductAppRuntimeHostSurfaceMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: AppIconSpec,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub i18n: Option<Value>,
    pub version: u32,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub permissions: Value,
    #[serde(default)]
    pub backends: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interaction: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_rationale: Option<String>,
    #[serde(default)]
    pub runtime: ProductAppRuntimeState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductAppRuntimeHostSurface {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: AppIconSpec,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub i18n: Option<Value>,
    pub version: u32,
    pub created_at: i64,
    pub updated_at: i64,
    pub source: Value,
    pub compiled_html: String,
    #[serde(default)]
    pub permissions: Value,
    #[serde(default)]
    pub backends: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interaction: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_context: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_rationale: Option<String>,
    #[serde(default)]
    pub runtime: ProductAppRuntimeState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProductAppRuntimeBackendKind {
    AgentComponent,
    BridgeComponent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProductAppRuntimeBackendSessionPolicy {
    PerEntity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProductAppRuntimeBackendMemoryScope {
    AppInstance,
}

#[derive(Debug, Clone, PartialEq)]
struct ProductAppRuntimeBackendActionBinding {
    name: String,
    input_schema: Value,
    output_schema: Value,
    allow_state_patch: bool,
}

#[derive(Debug, Clone, PartialEq)]
struct ProductAppRuntimeBackendBinding {
    id: String,
    kind: ProductAppRuntimeBackendKind,
    component_id: String,
    component_package_dir: Option<String>,
    capability_id: Option<String>,
    role: String,
    session_policy: ProductAppRuntimeBackendSessionPolicy,
    memory_scope: ProductAppRuntimeBackendMemoryScope,
    actions: Vec<ProductAppRuntimeBackendActionBinding>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProductAppRuntimeInteractionMode {
    Standalone,
    Composite,
}

#[derive(Debug, Clone, PartialEq)]
struct ProductAppRuntimeInteractionChat {
    backend_id: Option<String>,
    agent_component_id: Option<String>,
    agent_type: Option<String>,
    backend_agent_type: Option<String>,
    session_policy: Option<ProductAppRuntimeBackendSessionPolicy>,
    memory_scope: Option<ProductAppRuntimeBackendMemoryScope>,
    initial_prompt_key: Option<String>,
    allow_user_prompt: bool,
}

#[derive(Debug, Clone)]
struct ProductAppRuntimeInteractionTab {
    id: String,
    tab_type: String,
    route: Option<String>,
    title: Option<HostAdapterCoreInteractionText>,
    title_key: Option<String>,
    default: bool,
    developer_only: bool,
    sidecar: Option<HostAdapterCoreInteractionTabSidecar>,
    data: Value,
}

#[derive(Debug, Clone)]
struct ProductAppRuntimeInteraction {
    mode: ProductAppRuntimeInteractionMode,
    profile: Option<String>,
    chat: Option<ProductAppRuntimeInteractionChat>,
    tabs: Vec<ProductAppRuntimeInteractionTab>,
}

fn product_app_runtime_host_surface_meta_from_host_adapter(
    app: HostAdapterCoreSurfaceMeta,
) -> ProductAppRuntimeHostSurfaceMeta {
    ProductAppRuntimeHostSurfaceMeta {
        id: app.id,
        name: app.name,
        description: app.description,
        icon: app.icon,
        category: app.category,
        tags: app.tags,
        i18n: host_non_empty_json(app.i18n),
        version: app.version,
        created_at: app.created_at,
        updated_at: app.updated_at,
        permissions: host_json(app.permissions),
        backends: host_json_array(app.backends),
        interaction: host_optional_json(app.interaction),
        permission_rationale: app.permission_rationale,
        runtime: product_app_runtime_state_from_host_adapter(app.runtime),
    }
}

fn product_app_runtime_host_surface_from_host_adapter(
    app: HostAdapterCoreSurface,
) -> ProductAppRuntimeHostSurface {
    ProductAppRuntimeHostSurface {
        id: app.id,
        name: app.name,
        description: app.description,
        icon: app.icon,
        category: app.category,
        tags: app.tags,
        i18n: host_non_empty_json(app.i18n),
        version: app.version,
        created_at: app.created_at,
        updated_at: app.updated_at,
        source: host_json(app.source),
        compiled_html: app.compiled_html,
        permissions: host_json(app.permissions),
        backends: host_json_array(app.backends),
        interaction: host_optional_json(app.interaction),
        ai_context: host_optional_json(app.ai_context),
        permission_rationale: app.permission_rationale,
        runtime: product_app_runtime_state_from_host_adapter(app.runtime),
    }
}

#[derive(Debug)]
pub(crate) struct DraftRuntimePreview {
    pub preview_session_id: String,
    pub ephemeral_artifact_id: String,
    pub host_surface: ProductAppRuntimeHostSurface,
    pub runtime_context: ProductAppRuntimeContext,
}

/// Materializes a Draft into an isolated, hidden preview Work. The preview is
/// never an Activation and its synthetic release id is never persisted as an
/// App Release. Reusing the normal Work runtime guard keeps every host bridge
/// operation scoped to this preview until `close_draft_runtime_preview` removes
/// both the runtime host and hidden Work.
pub(crate) async fn create_draft_runtime_preview(
    state: &AppState,
    draft_id: &str,
    slot_id: &str,
    resolved_app: &ResolvedProductApp,
    theme: Option<&str>,
    workspace_path: Option<&str>,
) -> Result<DraftRuntimePreview, String> {
    let primary_surface = resolved_app.app.primary_surface.as_ref().ok_or_else(|| {
        format!(
            "Draft {} does not declare an application primarySurface",
            draft_id
        )
    })?;
    let product_app_surface = resolved_app
        .components
        .iter()
        .find(|component| {
            component.kind == ComponentKind::Surface && component.id == primary_surface.component_id
        })
        .ok_or_else(|| {
            format!(
                "Draft {} primary surface component {} is not resolved",
                draft_id, primary_surface.component_id
            )
        })?;
    let implementation_ref = product_app_surface
        .implementation_ref
        .as_deref()
        .ok_or_else(|| {
            format!(
                "Draft {} surface {} has no implementationRef",
                draft_id, product_app_surface.id
            )
        })?;

    let work_id = WorkId::generate();
    let config_revision = resolved_app.lock.digest();
    let release_id = format!("draft:{}", draft_id);
    let app_ref = WorkAppRef::product_app(
        slot_id,
        &resolved_app.app.id,
        &release_id,
        &config_revision,
        "draft",
    );
    let surface_id = primary_surface
        .surface_id
        .clone()
        .unwrap_or_else(|| product_app_surface.id.clone());
    let surface = WorkSurfaceRef::ApplicationSurface {
        product_app_id: resolved_app.app.id.clone(),
        product_app_surface_id: product_app_surface.id.clone(),
        surface_id,
    };
    let now = chrono::Utc::now().timestamp_millis();
    let scope = workspace_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(|workspace_path| WorkScope::Workspace {
            workspace_path: workspace_path.to_string(),
        })
        .unwrap_or(WorkScope::System);
    let mut work = WorkRecord::new(
        work_id.clone(),
        WorkKind::AppWorkflow,
        format!("Draft preview: {}", resolved_app.app.name),
        format!("Isolated preview for Draft {}", draft_id),
        WorkVisibility::Hidden,
        WorkSubject::App {
            app: app_ref.clone(),
            intent: WorkAppIntent::Develop,
        },
        Vec::new(),
        scope,
        surface.clone(),
        now,
    );
    work.system_managed = true;
    work.system_process_kind = Some("intelligent_app_draft_preview".to_string());
    let runtime_instance =
        RuntimeInstanceRef::product_app_application_surface(&work_id, &app_ref, &surface)
            .ok_or_else(|| "Failed to bind Draft preview runtime instance".to_string())?;
    work.bind_runtime_instance(runtime_instance.clone(), now);
    let store = default_work_store().map_err(|error| error.to_string())?;
    store.put(&work).await.map_err(|error| error.to_string())?;

    let preview_result = async {
        if !implementation_ref.starts_with("app://") {
            return Err(format!(
                "Draft preview only supports private application surfaces: {}",
                implementation_ref
            ));
        }
        validate_private_surface_ref(implementation_ref, &resolved_app.app, product_app_surface)?;
        let source = resolved_app
            .private_surface_sources
            .get(&product_app_surface.id)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "Draft {} has no source for private surface {}",
                    draft_id, product_app_surface.id
                )
            })?;
        let host_surface_id = runtime_instance.id.clone();
        state
            .product_app_runtime_host_manager
            .upsert_runtime_host(
                &host_surface_id,
                product_app_surface.name.clone(),
                product_app_surface.description.clone(),
                resolved_app.app.icon.clone(),
                resolved_app.app.category.clone(),
                resolved_app.app.tags.clone(),
                source,
                HostAdapterCorePermissions::default(),
                Vec::new(),
                None,
                None,
            )
            .await
            .map_err(|error| error.to_string())?;
        let workspace_root = workspace_path
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(std::path::PathBuf::from);
        let host_surface = state
            .product_app_runtime_host_manager
            .recompile(
                &host_surface_id,
                theme.unwrap_or("dark"),
                workspace_root.as_deref(),
            )
            .await
            .map_err(|error| error.to_string())?;
        let runtime_context = ProductAppRuntimeContext {
            work_id: work_id.as_str().to_string(),
            runtime_instance_id: runtime_instance.id.clone(),
            slot_id: slot_id.to_string(),
            app_id: resolved_app.app.id.clone(),
            release_id,
            config_revision,
            data_schema_version: runtime_instance.data_schema_version.clone(),
            product_app_surface_id: product_app_surface.id.clone(),
            surface_id: match &surface {
                WorkSurfaceRef::ApplicationSurface { surface_id, .. } => surface_id.clone(),
                _ => unreachable!(),
            },
            host_surface_id: host_surface_id.clone(),
        };
        Ok::<_, String>(DraftRuntimePreview {
            preview_session_id: work_id.as_str().to_string(),
            ephemeral_artifact_id: host_surface_id,
            host_surface: product_app_runtime_host_surface_from_host_adapter(host_surface),
            runtime_context,
        })
    }
    .await;

    if preview_result.is_err() {
        let _ = state
            .product_app_runtime_host_manager
            .delete(&runtime_instance.id)
            .await;
        let _ = store.delete(&work_id).await;
    }
    preview_result
}

pub(crate) async fn close_draft_runtime_preview(
    state: &AppState,
    preview_session_id: &str,
) -> Result<(), String> {
    let work_id =
        WorkId::parse(preview_session_id.to_string()).map_err(|error| error.to_string())?;
    let store = default_work_store().map_err(|error| error.to_string())?;
    let work = store
        .get(&work_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("Draft preview not found: {}", preview_session_id))?;
    if !work.system_managed
        || work.system_process_kind.as_deref() != Some("intelligent_app_draft_preview")
    {
        return Err(format!(
            "Work {} is not an Intelligent App Draft preview",
            preview_session_id
        ));
    }
    for runtime_instance in &work.runtime_instances {
        state
            .product_app_runtime_host_manager
            .delete(&runtime_instance.id)
            .await
            .map_err(|error| error.to_string())?;
    }
    store
        .delete(&work_id)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) async fn cleanup_draft_runtime_previews(state: &AppState) -> Result<usize, String> {
    let store = default_work_store().map_err(|error| error.to_string())?;
    let previews = store
        .list()
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|work| {
            work.system_managed
                && work.system_process_kind.as_deref() == Some("intelligent_app_draft_preview")
        })
        .collect::<Vec<_>>();
    for preview in &previews {
        for runtime_instance in &preview.runtime_instances {
            if let Err(error) = state
                .product_app_runtime_host_manager
                .delete(&runtime_instance.id)
                .await
            {
                log::warn!(
                    "Failed to delete stale Draft preview runtime host: work_id={} runtime_instance_id={} error={}",
                    preview.id,
                    runtime_instance.id,
                    error
                );
            }
        }
        store
            .delete(&preview.id)
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(previews.len())
}

fn host_json<T: Serialize>(value: T) -> Value {
    serde_json::to_value(value).expect("product app runtime host payload should serialize")
}

fn host_optional_json<T: Serialize>(value: Option<T>) -> Option<Value> {
    value.map(host_json).filter(|value| !value.is_null())
}

fn host_non_empty_json<T: Serialize>(value: T) -> Option<Value> {
    let value = host_json(value);
    if is_empty_json_object(&value) {
        None
    } else {
        Some(value)
    }
}

fn host_json_array<T: Serialize>(values: Vec<T>) -> Vec<Value> {
    values.into_iter().map(host_json).collect()
}

fn is_empty_json_object(value: &Value) -> bool {
    value.as_object().is_some_and(|object| object.is_empty())
}

fn product_app_runtime_state_from_host_adapter(
    state: HostAdapterRuntimeState,
) -> ProductAppRuntimeState {
    ProductAppRuntimeState {
        source_revision: state.source_revision,
        deps_revision: state.deps_revision,
        deps_dirty: state.deps_dirty,
        worker_restart_required: state.worker_restart_required,
        ui_recompile_required: state.ui_recompile_required,
    }
}

fn host_adapter_issue_severity_from_product_app(
    severity: ProductAppRuntimeIssueSeverity,
) -> HostAdapterRuntimeIssueSeverity {
    match severity {
        ProductAppRuntimeIssueSeverity::Fatal => HostAdapterRuntimeIssueSeverity::Fatal,
        ProductAppRuntimeIssueSeverity::Warning => HostAdapterRuntimeIssueSeverity::Warning,
        ProductAppRuntimeIssueSeverity::Noise => HostAdapterRuntimeIssueSeverity::Noise,
    }
}

fn host_adapter_log_level_from_product_app(
    level: ProductAppRuntimeLogLevel,
) -> HostAdapterRuntimeLogLevel {
    match level {
        ProductAppRuntimeLogLevel::Debug => HostAdapterRuntimeLogLevel::Debug,
        ProductAppRuntimeLogLevel::Info => HostAdapterRuntimeLogLevel::Info,
        ProductAppRuntimeLogLevel::Warn => HostAdapterRuntimeLogLevel::Warn,
        ProductAppRuntimeLogLevel::Error => HostAdapterRuntimeLogLevel::Error,
    }
}

fn record_recent_host_adapter_request_from_product_app_runtime(
    request: ProductAppRuntimeRecordRecentHostSurfaceRequest,
) -> HostAdapterRecordRecentRequest {
    HostAdapterRecordRecentRequest {
        app_id: request.app_id,
    }
}

fn get_host_adapter_request_from_product_app_runtime(
    request: ProductAppRuntimeGetHostSurfaceRequest,
) -> HostAdapterGetRequest {
    HostAdapterGetRequest {
        app_id: request.app_id,
        theme: request.theme,
        workspace_path: request.workspace_path,
    }
}

fn product_app_runtime_status_from_host_adapter(
    status: HostAdapterRuntimeStatus,
) -> ProductAppRuntimeHostRuntimeStatus {
    ProductAppRuntimeHostRuntimeStatus {
        available: status.available,
        kind: status.kind,
        version: status.version,
        path: status.path,
    }
}

fn product_app_runtime_install_result_from_host_adapter(
    result: HostAdapterInstallResult,
) -> ProductAppRuntimeInstallResult {
    ProductAppRuntimeInstallResult {
        success: result.success,
        stdout: result.stdout,
        stderr: result.stderr,
    }
}

fn recompile_host_adapter_request_from_product_app_runtime(
    request: ProductAppRuntimeRecompileHostSurfaceRequest,
) -> HostAdapterRecompileRequest {
    HostAdapterRecompileRequest {
        app_id: request.app_id,
        theme: request.theme,
        workspace_path: request.workspace_path,
    }
}

fn product_app_runtime_recompile_result_from_host_adapter(
    result: HostAdapterRecompileResult,
) -> ProductAppRuntimeRecompileResult {
    ProductAppRuntimeRecompileResult {
        success: result.success,
        warnings: result.warnings,
    }
}

fn clear_runtime_issues_request_from_product_app_runtime(
    request: ProductAppRuntimeClearRuntimeIssuesRequest,
) -> HostAdapterClearRuntimeIssuesRequest {
    HostAdapterClearRuntimeIssuesRequest {
        app_id: request.app_id,
    }
}

fn worker_call_request_from_product_app_runtime(
    request: ProductAppRuntimeWorkerCallRequest,
) -> HostAdapterWorkerCallRequest {
    HostAdapterWorkerCallRequest {
        app_id: request.app_id,
        method: request.method,
        params: request.params,
        workspace_path: request.workspace_path,
        runtime_context: request.runtime_context,
    }
}

fn runtime_issue_request_from_product_app_runtime(
    request: ProductAppRuntimeIssueRequest,
) -> HostAdapterRuntimeIssueRequest {
    HostAdapterRuntimeIssueRequest {
        app_id: request.app_id,
        runtime_context: request.runtime_context,
        severity: request
            .severity
            .map(host_adapter_issue_severity_from_product_app),
        message: request.message,
        source: request.source,
        stack: request.stack,
        category: request.category,
        timestamp_ms: request.timestamp_ms,
    }
}

fn runtime_log_request_from_product_app_runtime(
    request: ProductAppRuntimeLogRequest,
) -> HostAdapterRuntimeLogRequest {
    HostAdapterRuntimeLogRequest {
        app_id: request.app_id,
        runtime_context: request.runtime_context,
        level: request.level.map(host_adapter_log_level_from_product_app),
        category: request.category,
        message: request.message,
        source: request.source,
        stack: request.stack,
        details: request.details,
        timestamp_ms: request.timestamp_ms,
    }
}

fn ai_chat_message_from_product_app_runtime(
    message: ProductAppRuntimeAiChatMessage,
) -> HostAdapterAiChatMessage {
    HostAdapterAiChatMessage {
        role: message.role,
        content: message.content,
    }
}

fn ai_complete_request_from_product_app_runtime(
    request: ProductAppRuntimeAiCompleteRequest,
) -> HostAdapterAiCompleteRequest {
    HostAdapterAiCompleteRequest {
        app_id: request.app_id,
        runtime_context: request.runtime_context,
        prompt: request.prompt,
        system_prompt: request.system_prompt,
        model: request.model,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
    }
}

fn product_app_runtime_ai_usage_from_host_adapter(
    usage: HostAdapterAiUsage,
) -> ProductAppRuntimeAiUsage {
    ProductAppRuntimeAiUsage {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
    }
}

fn product_app_runtime_ai_complete_response_from_host_adapter(
    response: HostAdapterAiCompleteResponse,
) -> ProductAppRuntimeAiCompleteResponse {
    ProductAppRuntimeAiCompleteResponse {
        text: response.text,
        usage: response
            .usage
            .map(product_app_runtime_ai_usage_from_host_adapter),
    }
}

fn ai_chat_request_from_product_app_runtime(
    request: ProductAppRuntimeAiChatRequest,
) -> HostAdapterAiChatRequest {
    HostAdapterAiChatRequest {
        app_id: request.app_id,
        runtime_context: request.runtime_context,
        messages: request
            .messages
            .into_iter()
            .map(ai_chat_message_from_product_app_runtime)
            .collect(),
        stream_id: request.stream_id,
        system_prompt: request.system_prompt,
        model: request.model,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
    }
}

fn product_app_runtime_ai_chat_started_response_from_host_adapter(
    response: HostAdapterAiChatStartedResponse,
) -> ProductAppRuntimeAiChatStartedResponse {
    ProductAppRuntimeAiChatStartedResponse {
        stream_id: response.stream_id,
    }
}

fn ai_cancel_request_from_product_app_runtime(
    request: ProductAppRuntimeAiCancelRequest,
) -> HostAdapterAiCancelRequest {
    HostAdapterAiCancelRequest {
        app_id: request.app_id,
        runtime_context: request.runtime_context,
        stream_id: request.stream_id,
    }
}

fn ai_list_models_request_from_product_app_runtime(
    request: ProductAppRuntimeAiListModelsRequest,
) -> HostAdapterAiListModelsRequest {
    HostAdapterAiListModelsRequest {
        app_id: request.app_id,
        runtime_context: request.runtime_context,
    }
}

fn product_app_runtime_ai_model_info_from_host_adapter(
    model: HostAdapterAiModelInfo,
) -> ProductAppRuntimeAiModelInfo {
    ProductAppRuntimeAiModelInfo {
        id: model.id,
        name: model.name,
        provider: model.provider,
        is_default: model.is_default,
    }
}

fn backend_call_request_from_product_app_runtime(
    request: ProductAppRuntimeBackendCallRequest,
) -> HostAdapterBackendCallRequest {
    HostAdapterBackendCallRequest {
        app_id: request.app_id,
        target: request.target,
        input: request.input,
        entity_id: request.entity_id,
        idempotency_key: request.idempotency_key,
        workspace_path: request.workspace_path,
        runtime_context: request.runtime_context,
    }
}

fn product_app_runtime_backend_call_response_from_host_adapter(
    response: HostAdapterBackendCallResponse,
) -> ProductAppRuntimeBackendCallResponse {
    ProductAppRuntimeBackendCallResponse {
        session_id: response.session_id,
        turn_id: response.turn_id,
        action_run_id: response.action_run_id,
        status: response.status,
        backend_id: response.backend_id,
        action: response.action,
        agent_type: response.agent_type,
        backend_kind: response.backend_kind,
        backend_component_id: response.backend_component_id,
        bridge_result: response.bridge_result,
    }
}

fn backend_run_request_from_product_app_runtime(
    request: ProductAppRuntimeBackendRunRequest,
) -> HostAdapterBackendRunRequest {
    HostAdapterBackendRunRequest {
        app_id: request.app_id,
        action_run_id: request.action_run_id,
        runtime_context: request.runtime_context,
        session_id: request.session_id,
        turn_id: request.turn_id,
    }
}

fn cancel_stale_ppt_runs_request_from_product_app_runtime(
    request: ProductAppRuntimeCancelStalePptRunsRequest,
) -> HostAdapterCancelStalePptRunsRequest {
    HostAdapterCancelStalePptRunsRequest {
        app_id: request.app_id,
        runtime_context: request.runtime_context,
        workspace_path: request.workspace_path,
    }
}

fn product_app_runtime_cancel_stale_ppt_runs_response_from_host_adapter(
    response: HostAdapterCancelStalePptRunsResponse,
) -> ProductAppRuntimeCancelStalePptRunsResponse {
    ProductAppRuntimeCancelStalePptRunsResponse {
        cancelled_sessions: response.cancelled_sessions,
        cancelled_turns: response.cancelled_turns,
        cleared_queues: response.cleared_queues,
    }
}

fn ppt_turn_text_request_from_product_app_runtime(
    request: ProductAppRuntimePptTurnTextRequest,
) -> HostAdapterPptTurnTextRequest {
    HostAdapterPptTurnTextRequest {
        app_id: request.app_id,
        runtime_context: request.runtime_context,
        session_id: request.session_id,
        turn_id: request.turn_id,
        workspace_path: request.workspace_path,
    }
}

fn product_app_runtime_ppt_turn_text_response_from_host_adapter(
    response: HostAdapterPptTurnTextResponse,
) -> ProductAppRuntimePptTurnTextResponse {
    ProductAppRuntimePptTurnTextResponse {
        text: response.text,
    }
}

fn render_slide_page_request_from_product_app_runtime(
    request: ProductAppRuntimeRenderSlidePageRequest,
) -> HostAdapterRenderSlidePageRequest {
    HostAdapterRenderSlidePageRequest {
        html: request.html,
        format: request.format,
        width: request.width,
        height: request.height,
    }
}

#[tauri::command]
pub async fn resolve_product_app_runtime_instance(
    state: State<'_, AppState>,
    request: ResolveProductAppRuntimeInstanceRequest,
) -> Result<ResolvedProductAppRuntimeInstance, String> {
    validate_runtime_binding_request(&request)?;
    let work_id = WorkId::parse(request.work_id.clone()).map_err(|error| error.to_string())?;
    let store = default_work_store().map_err(|error| error.to_string())?;
    let mut work = store
        .get(&work_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("Work not found: {}", work_id))?;

    let app_ref = work_product_app_ref(&work, &request.slot_id, &request.app_id)
        .ok_or_else(|| {
            format!(
                "Work {} does not bind slot {} to App {}",
                work.id, request.slot_id, request.app_id
            )
        })?
        .clone();
    validate_requested_app_ref(&request, &app_ref)?;
    let authoritative = resolve_authorized_app_release(
        &state,
        &app_ref.app_id,
        &app_ref.release_id,
        ReleaseExecutionPurpose::ExistingWorkRuntime,
    )
    .await?;
    validate_product_app_ref(&app_ref, &authoritative)?;

    let surface = work_application_surface(&work, &request, &app_ref.app_id)?.clone();
    let runtime_instance = ensure_work_runtime_instance(&store, &mut work, &app_ref, &surface)
        .await
        .map_err(|error| error.to_string())?;

    if let Some(expected_id) = request
        .runtime_instance_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
    {
        if runtime_instance.id != expected_id {
            return Err(format!(
                "Work {} runtime instance mismatch: requested {}, resolved {}",
                work.id, expected_id, runtime_instance.id
            ));
        }
    }

    if authoritative.resolved_release.release.config_revision != runtime_instance.config_revision {
        return Err(format!(
            "Work {} runtime config revision does not match its authoritative Release",
            work.id
        ));
    }
    if authoritative.resolved_release.release.data_schema_version
        != runtime_instance.data_schema_version
    {
        return Err(format!(
            "Work {} runtime data schema does not match its authoritative Release",
            work.id
        ));
    }
    authoritative.validate_application_surface_runtime(
        &work.scope,
        &runtime_instance.product_app_surface_id,
        &runtime_instance.surface_id,
    )?;
    let app = authoritative.package;

    let product_app_surface = app
        .components
        .iter()
        .find(|component| {
            component.kind == ComponentKind::Surface
                && component.id == runtime_instance.product_app_surface_id
        })
        .ok_or_else(|| {
            format!(
                "Product App {} lock does not resolve Product App surface {}",
                app.app.id, runtime_instance.product_app_surface_id
            )
        })?;
    let implementation_ref = product_app_surface
        .implementation_ref
        .clone()
        .ok_or_else(|| {
            format!(
                "Product App surface {} has no implementationRef",
                runtime_instance.product_app_surface_id
            )
        })?;
    let host_surface_id = resolve_product_app_host_surface_id(
        host_adapter::manager(&state),
        &runtime_instance,
        &app,
        product_app_surface,
        &implementation_ref,
    )
    .await?;

    let resolved_work_id = work.id.into_string();
    let resolved_runtime_instance_id = runtime_instance.id;
    let resolved_slot_id = runtime_instance.slot_id;
    let resolved_app_id = runtime_instance.app_id;
    let resolved_release_id = runtime_instance.release_id;
    let resolved_config_revision = runtime_instance.config_revision;
    let resolved_data_schema_version = runtime_instance.data_schema_version;
    let resolved_product_app_surface_id = runtime_instance.product_app_surface_id;
    let resolved_surface_id = runtime_instance.surface_id;

    let response = ResolvedProductAppRuntimeInstance {
        work_id: resolved_work_id.clone(),
        runtime_instance_id: resolved_runtime_instance_id.clone(),
        slot_id: resolved_slot_id.clone(),
        app_id: resolved_app_id.clone(),
        release_id: resolved_release_id.clone(),
        config_revision: resolved_config_revision.clone(),
        data_schema_version: resolved_data_schema_version.clone(),
        product_app_surface_id: resolved_product_app_surface_id.clone(),
        surface_id: resolved_surface_id.clone(),
        implementation_ref,
        host: ProductAppRuntimeHost {
            kind: ProductAppRuntimeHostKind::ProductAppRuntime,
            surface_id: host_surface_id.clone(),
        },
        runtime_context: ProductAppRuntimeContext {
            work_id: resolved_work_id,
            runtime_instance_id: resolved_runtime_instance_id,
            slot_id: resolved_slot_id,
            app_id: resolved_app_id,
            release_id: resolved_release_id,
            config_revision: resolved_config_revision,
            data_schema_version: resolved_data_schema_version,
            product_app_surface_id: resolved_product_app_surface_id,
            surface_id: resolved_surface_id,
            host_surface_id,
        },
    };
    let mut metrics = BTreeMap::new();
    metrics.insert("count".to_string(), 1.0);
    if let Err(error) = ProductAppEvolutionStore::new(state.workspace_service.path_manager())
        .record_signal_if_consented(
            "app_open",
            Some(response.slot_id.clone()),
            Some(response.app_id.clone()),
            Some(response.release_id.clone()),
            metrics,
        )
        .await
    {
        log::warn!("Failed to record minimized App evolution signal: {}", error);
    }
    Ok(response)
}

#[tauri::command]
pub async fn product_app_runtime_list_host_surfaces(
    state: State<'_, AppState>,
) -> Result<Vec<ProductAppRuntimeHostSurfaceMeta>, String> {
    let host_surfaces = host_adapter::list_host_surfaces(state).await?;
    Ok(host_surfaces
        .into_iter()
        .map(product_app_runtime_host_surface_meta_from_host_adapter)
        .collect())
}

#[tauri::command]
pub async fn product_app_runtime_list_recent_host_surfaces(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    host_adapter::list_recent_host_surfaces(state).await
}

#[tauri::command]
pub async fn product_app_runtime_record_recent_host_surface(
    state: State<'_, AppState>,
    request: ProductAppRuntimeRecordRecentHostSurfaceRequest,
) -> Result<Vec<String>, String> {
    host_adapter::record_recent_host_surface(
        state,
        record_recent_host_adapter_request_from_product_app_runtime(request),
    )
    .await
}

#[tauri::command]
pub async fn product_app_runtime_get_host_surface(
    state: State<'_, AppState>,
    request: ProductAppRuntimeGetHostSurfaceRequest,
) -> Result<ProductAppRuntimeHostSurface, String> {
    let host_surface = host_adapter::get_host_surface(
        state,
        get_host_adapter_request_from_product_app_runtime(request),
    )
    .await?;
    Ok(product_app_runtime_host_surface_from_host_adapter(
        host_surface,
    ))
}

#[tauri::command]
pub async fn product_app_runtime_host_runtime_status(
    state: State<'_, AppState>,
) -> Result<ProductAppRuntimeHostRuntimeStatus, String> {
    let status = host_adapter::runtime_status(state).await?;
    Ok(product_app_runtime_status_from_host_adapter(status))
}

#[tauri::command]
pub async fn product_app_runtime_list_running_workers(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    host_adapter::list_running_workers(state).await
}

#[tauri::command]
pub async fn product_app_runtime_stop_worker(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<(), String> {
    host_adapter::stop_worker(state, app_id).await
}

#[tauri::command]
pub async fn product_app_runtime_install_dependencies(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<ProductAppRuntimeInstallResult, String> {
    let result = host_adapter::install_dependencies(state, app_id).await?;
    Ok(product_app_runtime_install_result_from_host_adapter(result))
}

#[tauri::command]
pub async fn product_app_runtime_recompile_host_surface(
    state: State<'_, AppState>,
    request: ProductAppRuntimeRecompileHostSurfaceRequest,
) -> Result<ProductAppRuntimeRecompileResult, String> {
    let result = host_adapter::recompile_host_surface(
        state,
        recompile_host_adapter_request_from_product_app_runtime(request),
    )
    .await?;
    Ok(product_app_runtime_recompile_result_from_host_adapter(
        result,
    ))
}

#[tauri::command]
pub async fn product_app_runtime_clear_runtime_issues(
    state: State<'_, AppState>,
    request: ProductAppRuntimeClearRuntimeIssuesRequest,
) -> Result<(), String> {
    host_adapter::clear_runtime_issues(
        state,
        clear_runtime_issues_request_from_product_app_runtime(request),
    )
    .await
}

#[tauri::command]
pub async fn product_app_runtime_worker_call(
    state: State<'_, AppState>,
    request: ProductAppRuntimeWorkerCallRequest,
) -> Result<Value, String> {
    host_adapter::worker_call(state, worker_call_request_from_product_app_runtime(request)).await
}

#[tauri::command]
pub async fn product_app_runtime_report_runtime_issue(
    state: State<'_, AppState>,
    request: ProductAppRuntimeIssueRequest,
) -> Result<(), String> {
    let runtime_context = request.runtime_context.clone();
    let severity = request
        .severity
        .unwrap_or(ProductAppRuntimeIssueSeverity::Fatal);
    host_adapter::report_runtime_issue(
        state.clone(),
        runtime_issue_request_from_product_app_runtime(request),
    )
    .await?;
    let mut metrics = BTreeMap::new();
    metrics.insert("count".to_string(), 1.0);
    metrics.insert(
        "severity".to_string(),
        match severity {
            ProductAppRuntimeIssueSeverity::Noise => 0.0,
            ProductAppRuntimeIssueSeverity::Warning => 1.0,
            ProductAppRuntimeIssueSeverity::Fatal => 2.0,
        },
    );
    if let Err(error) = ProductAppEvolutionStore::new(state.workspace_service.path_manager())
        .record_signal_if_consented(
            "runtime_issue",
            Some(runtime_context.slot_id),
            Some(runtime_context.app_id),
            Some(runtime_context.release_id),
            metrics,
        )
        .await
    {
        log::warn!("Failed to record minimized App evolution signal: {}", error);
    }
    Ok(())
}

#[tauri::command]
pub async fn product_app_runtime_report_runtime_log(
    state: State<'_, AppState>,
    request: ProductAppRuntimeLogRequest,
) -> Result<(), String> {
    host_adapter::report_runtime_log(state, runtime_log_request_from_product_app_runtime(request))
        .await
}

#[tauri::command]
pub async fn product_app_runtime_ai_complete(
    state: State<'_, AppState>,
    request: ProductAppRuntimeAiCompleteRequest,
) -> Result<ProductAppRuntimeAiCompleteResponse, String> {
    let response =
        host_adapter::ai_complete(state, ai_complete_request_from_product_app_runtime(request))
            .await?;
    Ok(product_app_runtime_ai_complete_response_from_host_adapter(
        response,
    ))
}

#[tauri::command]
pub async fn product_app_runtime_ai_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ProductAppRuntimeAiChatRequest,
) -> Result<ProductAppRuntimeAiChatStartedResponse, String> {
    let response = host_adapter::ai_chat(
        app,
        state,
        ai_chat_request_from_product_app_runtime(request),
    )
    .await?;
    Ok(product_app_runtime_ai_chat_started_response_from_host_adapter(response))
}

#[tauri::command]
pub async fn product_app_runtime_ai_cancel(
    state: State<'_, AppState>,
    request: ProductAppRuntimeAiCancelRequest,
) -> Result<(), String> {
    host_adapter::ai_cancel(state, ai_cancel_request_from_product_app_runtime(request)).await
}

#[tauri::command]
pub async fn product_app_runtime_ai_list_models(
    state: State<'_, AppState>,
    request: ProductAppRuntimeAiListModelsRequest,
) -> Result<Vec<ProductAppRuntimeAiModelInfo>, String> {
    let models = host_adapter::ai_list_models(
        state,
        ai_list_models_request_from_product_app_runtime(request),
    )
    .await?;
    Ok(models
        .into_iter()
        .map(product_app_runtime_ai_model_info_from_host_adapter)
        .collect())
}

#[tauri::command]
pub async fn product_app_runtime_backend_call(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    state: State<'_, AppState>,
    request: ProductAppRuntimeBackendCallRequest,
) -> Result<ProductAppRuntimeBackendCallResponse, String> {
    let response = host_adapter::backend_call(
        coordinator,
        scheduler,
        state,
        backend_call_request_from_product_app_runtime(request),
    )
    .await?;
    Ok(product_app_runtime_backend_call_response_from_host_adapter(
        response,
    ))
}

#[tauri::command]
pub async fn product_app_runtime_backend_status(
    state: State<'_, AppState>,
    request: ProductAppRuntimeBackendRunRequest,
) -> Result<Value, String> {
    host_adapter::backend_status(state, backend_run_request_from_product_app_runtime(request)).await
}

#[tauri::command]
pub async fn product_app_runtime_backend_cancel_run(
    scheduler: State<'_, Arc<DialogScheduler>>,
    state: State<'_, AppState>,
    request: ProductAppRuntimeBackendRunRequest,
) -> Result<Value, String> {
    host_adapter::backend_cancel_run(
        scheduler,
        state,
        backend_run_request_from_product_app_runtime(request),
    )
    .await
}

#[tauri::command]
pub async fn product_app_runtime_cancel_stale_ppt_runs(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    state: State<'_, AppState>,
    request: ProductAppRuntimeCancelStalePptRunsRequest,
) -> Result<ProductAppRuntimeCancelStalePptRunsResponse, String> {
    let response = host_adapter::cancel_stale_ppt_runs(
        coordinator,
        scheduler,
        state,
        cancel_stale_ppt_runs_request_from_product_app_runtime(request),
    )
    .await?;
    Ok(product_app_runtime_cancel_stale_ppt_runs_response_from_host_adapter(response))
}

#[tauri::command]
pub async fn product_app_runtime_ppt_turn_assistant_text(
    state: State<'_, AppState>,
    request: ProductAppRuntimePptTurnTextRequest,
) -> Result<ProductAppRuntimePptTurnTextResponse, String> {
    let response = host_adapter::ppt_turn_assistant_text(
        state,
        ppt_turn_text_request_from_product_app_runtime(request),
    )
    .await?;
    Ok(product_app_runtime_ppt_turn_text_response_from_host_adapter(response))
}

#[tauri::command]
pub async fn product_app_runtime_render_slide_page(
    app: AppHandle,
    request: ProductAppRuntimeRenderSlidePageRequest,
) -> Result<String, String> {
    host_adapter::render_slide_page(
        app,
        render_slide_page_request_from_product_app_runtime(request),
    )
    .await
}

fn work_product_app_ref<'a>(
    work: &'a WorkRecord,
    slot_id: &str,
    app_id: &str,
) -> Option<&'a WorkAppRef> {
    if let Some(app) = work.subject.app_ref() {
        if app.matches_slot(slot_id) && app.matches_product_app_id(app_id) {
            return Some(app);
        }
    }
    work.app_refs
        .iter()
        .find(|relation| {
            relation.app.matches_slot(slot_id) && relation.app.matches_product_app_id(app_id)
        })
        .map(|relation| &relation.app)
}

fn validate_requested_app_ref(
    request: &ResolveProductAppRuntimeInstanceRequest,
    app_ref: &WorkAppRef,
) -> Result<(), String> {
    if app_ref.release_id != request.release_id {
        return Err(format!(
            "Work slot {} pins Release {}, but runtime request used {}",
            app_ref.slot_id, app_ref.release_id, request.release_id
        ));
    }
    if app_ref.config_revision != request.config_revision {
        return Err(format!(
            "Work slot {} pins config revision {}, but runtime request used {}",
            app_ref.slot_id, app_ref.config_revision, request.config_revision
        ));
    }
    if app_ref.data_schema_version != request.data_schema_version {
        return Err(format!(
            "Work slot {} pins data schema {}, but runtime request used {}",
            app_ref.slot_id, app_ref.data_schema_version, request.data_schema_version
        ));
    }
    Ok(())
}

fn validate_runtime_binding_request(
    request: &ResolveProductAppRuntimeInstanceRequest,
) -> Result<(), String> {
    for (field, value) in [
        ("workId", request.work_id.as_str()),
        ("slotId", request.slot_id.as_str()),
        ("appId", request.app_id.as_str()),
        ("releaseId", request.release_id.as_str()),
        ("configRevision", request.config_revision.as_str()),
        ("dataSchemaVersion", request.data_schema_version.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(format!("{} is required", field));
        }
    }
    Ok(())
}

fn work_application_surface<'a>(
    work: &'a WorkRecord,
    request: &ResolveProductAppRuntimeInstanceRequest,
    product_app_id: &str,
) -> Result<&'a WorkSurfaceRef, String> {
    std::iter::once(&work.primary_surface)
        .chain(work.surfaces.iter())
        .find(|surface| application_surface_matches(surface, request, product_app_id))
        .ok_or_else(|| {
            format!(
                "Work {} does not bind an application surface for Product App {}",
                work.id, product_app_id
            )
        })
}

fn application_surface_matches(
    surface: &WorkSurfaceRef,
    request: &ResolveProductAppRuntimeInstanceRequest,
    product_app_id: &str,
) -> bool {
    let WorkSurfaceRef::ApplicationSurface {
        product_app_id: surface_app_id,
        product_app_surface_id,
        surface_id,
    } = surface
    else {
        return false;
    };
    if surface_app_id != product_app_id {
        return false;
    }
    if let Some(expected_component_id) = request
        .product_app_surface_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
    {
        if product_app_surface_id != expected_component_id {
            return false;
        }
    }
    if let Some(expected_surface_id) = request
        .surface_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
    {
        if surface_id != expected_surface_id {
            return false;
        }
    }
    true
}

async fn ensure_work_runtime_instance(
    store: &std::sync::Arc<dyn WorkStore>,
    work: &mut WorkRecord,
    app_ref: &WorkAppRef,
    surface: &WorkSurfaceRef,
) -> sparo_core::error::CoreResult<RuntimeInstanceRef> {
    if let Some(instance) = work
        .runtime_instances
        .iter()
        .find(|instance| runtime_instance_matches(instance, app_ref, surface))
        .cloned()
    {
        return Ok(instance);
    }

    let Some(instance) =
        RuntimeInstanceRef::product_app_application_surface(&work.id, app_ref, surface)
    else {
        return Err(sparo_core::error::CoreError::validation(
            "application_surface is required for Product App runtime instance",
        ));
    };
    work.bind_runtime_instance(instance.clone(), chrono::Utc::now().timestamp_millis());
    store.put(work).await?;
    Ok(instance)
}

fn runtime_instance_matches(
    instance: &RuntimeInstanceRef,
    app_ref: &WorkAppRef,
    surface: &WorkSurfaceRef,
) -> bool {
    let WorkSurfaceRef::ApplicationSurface {
        product_app_id,
        product_app_surface_id,
        surface_id,
    } = surface
    else {
        return false;
    };
    instance.app_id == *product_app_id
        && instance.slot_id == app_ref.slot_id
        && instance.app_id == app_ref.app_id
        && instance.release_id == app_ref.release_id
        && instance.config_revision == app_ref.config_revision
        && instance.product_app_surface_id == *product_app_surface_id
        && instance.surface_id == *surface_id
}

async fn resolve_product_app_host_surface_id(
    host_adapter_manager: &std::sync::Arc<HostAdapterCoreManager>,
    runtime_instance: &RuntimeInstanceRef,
    app: &ResolvedProductApp,
    product_app_surface: &ComponentDefinition,
    implementation_ref: &str,
) -> Result<String, String> {
    if implementation_ref.starts_with("app://") {
        validate_private_surface_ref(implementation_ref, &app.app, product_app_surface)?;
        let source = app
            .private_surface_sources
            .get(&product_app_surface.id)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "Product App {}@{} package has no source for private surface {}",
                    app.app.id, app.app.version, product_app_surface.id
                )
            })?;
        register_private_product_app_runtime_components(app)
            .await
            .map_err(|error| error.to_string())?;
        let host_id = runtime_instance.id.clone();
        let backends = build_private_surface_backends(app, product_app_surface, &app.components)?;
        host_adapter_manager
            .upsert_runtime_host(
                &host_id,
                product_app_surface.name.clone(),
                product_app_surface.description.clone(),
                app.app.icon.clone(),
                app.app.category.clone(),
                app.app.tags.clone(),
                source,
                product_app_surface_host_permissions(product_app_surface),
                host_adapter_backends_from_product_app_runtime(backends),
                Some(host_adapter_interaction_from_product_app_runtime(
                    build_product_app_runtime_interaction(
                        &app.app,
                        product_app_surface,
                        &app.components,
                    )?,
                )),
                None,
            )
            .await
            .map_err(|error| error.to_string())?;
        return Ok(host_id);
    }

    Err(format!(
        "Unsupported Product App surface implementationRef: {}",
        implementation_ref
    ))
}

fn product_app_surface_host_permissions(
    product_app_surface: &ComponentDefinition,
) -> HostAdapterCorePermissions {
    let mut autoplay = false;
    let mut fullscreen = false;
    let mut net_allow = Vec::new();
    for permission in product_app_surface
        .permissions
        .iter()
        .filter(|permission| permission.kind.eq_ignore_ascii_case("net"))
    {
        for scope in &permission.scopes {
            let scope = scope.trim();
            if !scope.is_empty() && !net_allow.iter().any(|existing| existing == scope) {
                net_allow.push(scope.to_string());
            }
        }
    }
    for permission in product_app_surface
        .permissions
        .iter()
        .filter(|permission| permission.kind.eq_ignore_ascii_case("iframe"))
    {
        for scope in &permission.scopes {
            match scope.trim().to_ascii_lowercase().as_str() {
                "autoplay" => autoplay = true,
                "fullscreen" => fullscreen = true,
                _ => {}
            }
        }
    }

    HostAdapterCorePermissions {
        net: (!net_allow.is_empty()).then_some(HostAdapterCoreNetPermissions {
            allow: Some(net_allow),
        }),
        iframe: (autoplay || fullscreen).then_some(HostAdapterCoreIframePermissions {
            autoplay,
            fullscreen,
        }),
        ..Default::default()
    }
}

fn validate_private_surface_ref(
    implementation_ref: &str,
    app: &AppDefinition,
    product_app_surface: &ComponentDefinition,
) -> Result<(), String> {
    let Some(rest) = implementation_ref.strip_prefix("app://") else {
        return Err(format!(
            "Invalid private surface implementationRef: {implementation_ref}"
        ));
    };
    let Some((identity, path)) = rest.split_once('/') else {
        return Err(format!(
            "Invalid private surface implementationRef: {implementation_ref}"
        ));
    };
    let expected_identity = format!("{}@{}", app.id, app.version);
    if identity != expected_identity {
        return Err(format!(
            "Private surface {} does not belong to Product App {}",
            implementation_ref, expected_identity
        ));
    }
    let expected_path = format!(
        "{}/{}",
        ComponentKind::Surface.path_segment(),
        product_app_surface.id
    );
    if path != expected_path {
        return Err(format!(
            "Private surface {} does not match locked Product App surface {}",
            implementation_ref, product_app_surface.id
        ));
    }
    Ok(())
}

fn build_private_surface_backends(
    app: &ResolvedProductApp,
    product_app_surface: &ComponentDefinition,
    components: &[ComponentDefinition],
) -> Result<Vec<ProductAppRuntimeBackendBinding>, String> {
    product_app_surface
        .dependencies
        .iter()
        .filter_map(|dependency| {
            let kind = match dependency.kind {
                ComponentKind::Agent => ProductAppRuntimeBackendKind::AgentComponent,
                ComponentKind::Bridge => ProductAppRuntimeBackendKind::BridgeComponent,
                _ => return None,
            };
            Some((dependency, kind))
        })
        .map(|(dependency, kind)| {
            let resolved_component = components.iter().find(|component| {
                component.id == dependency.component_id && component.kind == dependency.kind
            });
            let component_package_dir = resolved_component
                .map(|component| {
                    private_component_source_dir(app, component)
                        .map_err(|error| error.to_string())
                        .map(|path| path.map(|path| path.to_string_lossy().to_string()))
                })
                .transpose()?
                .flatten();
            Ok(ProductAppRuntimeBackendBinding {
                id: backend_binding_id(dependency),
                kind,
                component_id: dependency.component_id.clone(),
                component_package_dir,
                capability_id: dependency.capabilities.first().cloned(),
                role: dependency.role.clone(),
                session_policy: ProductAppRuntimeBackendSessionPolicy::PerEntity,
                memory_scope: ProductAppRuntimeBackendMemoryScope::AppInstance,
                actions: build_backend_actions(dependency, components),
            })
        })
        .collect()
}

fn build_backend_actions(
    dependency: &AppComponentRef,
    components: &[ComponentDefinition],
) -> Vec<ProductAppRuntimeBackendActionBinding> {
    let resolved_component = components.iter().find(|component| {
        component.id == dependency.component_id && component.kind == dependency.kind
    });
    let declared_capability_filter = (!dependency.capabilities.is_empty()).then(|| {
        dependency
            .capabilities
            .iter()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>()
    });
    let mut action_names = Vec::<String>::new();

    if let Some(component) = resolved_component {
        for capability in &component.capabilities {
            if declared_capability_filter
                .as_ref()
                .is_some_and(|filter| !filter.contains(capability.id.as_str()))
            {
                continue;
            }
            for action in &capability.actions {
                push_unique(&mut action_names, action);
            }
        }
    }

    if action_names.is_empty() {
        for action in &dependency.capabilities {
            push_unique(&mut action_names, action);
        }
    }

    action_names
        .into_iter()
        .map(|name| ProductAppRuntimeBackendActionBinding {
            name,
            input_schema: serde_json::json!({ "type": "object" }),
            output_schema: serde_json::json!({ "type": "object" }),
            allow_state_patch: false,
        })
        .collect()
}

fn push_unique(items: &mut Vec<String>, value: &str) {
    if !items.iter().any(|item| item == value) {
        items.push(value.to_string());
    }
}

fn build_product_app_runtime_interaction(
    app: &AppDefinition,
    product_app_surface: &ComponentDefinition,
    components: &[ComponentDefinition],
) -> Result<ProductAppRuntimeInteraction, String> {
    match app.primary_surface_mode {
        Some(AppSurfaceMode::SidecarLinked) => {
            let declared_tabs = app
                .runtime_interaction
                .as_ref()
                .map(|interaction| interaction.tabs.as_slice())
                .unwrap_or_default();
            let declared_default_count = declared_tabs.iter().filter(|tab| tab.default).count();
            if declared_default_count > 1 {
                return Err(
                    "runtimeInteraction.tabs may declare at most one default tab".to_string(),
                );
            }

            let mut tab_ids = HashSet::from(["primary".to_string()]);
            let mut sidecar_action_ids = HashSet::new();
            let mut tabs = vec![ProductAppRuntimeInteractionTab {
                id: "primary".to_string(),
                tab_type: "product-app-runtime".to_string(),
                route: Some(default_product_app_runtime_route(app).to_string()),
                title: None,
                title_key: None,
                default: declared_default_count == 0,
                developer_only: false,
                sidecar: None,
                data: serde_json::Value::Null,
            }];

            for declared in declared_tabs {
                let id = declared.id.trim();
                if id.is_empty() {
                    return Err("runtimeInteraction tab id cannot be empty".to_string());
                }
                if !tab_ids.insert(id.to_string()) {
                    return Err(format!("Duplicate runtimeInteraction tab id: {id}"));
                }
                if declared.tab_type != "product-app-runtime" {
                    return Err(format!(
                        "Unsupported runtimeInteraction tab type '{}' for tab '{}'",
                        declared.tab_type, id
                    ));
                }
                let route = declared
                    .route
                    .as_deref()
                    .map(str::trim)
                    .filter(|route| !route.is_empty())
                    .ok_or_else(|| format!("runtimeInteraction tab '{id}' requires route"))?;
                if !route.starts_with('/') {
                    return Err(format!(
                        "runtimeInteraction tab '{id}' route must start with '/'"
                    ));
                }

                let sidecar = declared.sidecar.as_ref().map(|sidecar| {
                    let action_id = sidecar
                        .action_id
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned);
                    HostAdapterCoreInteractionTabSidecar {
                        action_id,
                        icon: sidecar.icon.map(|icon| icon.as_str().to_string()),
                        order: sidecar.order,
                        availability: sidecar
                            .availability
                            .map(|availability| availability.as_str().to_string()),
                        target_group: sidecar.target_group.map(|group| group.as_str().to_string()),
                    }
                });
                if let Some(action_id) = sidecar
                    .as_ref()
                    .and_then(|sidecar| sidecar.action_id.as_deref())
                {
                    if !sidecar_action_ids.insert(action_id.to_string()) {
                        return Err(format!(
                            "Duplicate runtimeInteraction sidecar actionId: {action_id}"
                        ));
                    }
                }

                let title = declared.title.as_ref().map(|title| match title {
                    AppRuntimeInteractionText::Plain(value) => {
                        HostAdapterCoreInteractionText::Plain(value.clone())
                    }
                    AppRuntimeInteractionText::Localized(values) => {
                        HostAdapterCoreInteractionText::Localized(
                            values.clone().into_iter().collect(),
                        )
                    }
                });
                tabs.push(ProductAppRuntimeInteractionTab {
                    id: id.to_string(),
                    tab_type: declared.tab_type.clone(),
                    route: Some(route.to_string()),
                    title,
                    title_key: declared.title_key.clone(),
                    default: declared.default,
                    developer_only: declared.developer_only,
                    sidecar,
                    data: declared.data.clone(),
                });
            }

            Ok(ProductAppRuntimeInteraction {
                mode: ProductAppRuntimeInteractionMode::Composite,
                profile: Some("product-app-runtime".to_string()),
                chat: build_product_app_runtime_chat(product_app_surface, components),
                tabs,
            })
        }
        Some(AppSurfaceMode::ChatPrimary)
        | Some(AppSurfaceMode::ImmersivePrimary)
        | Some(AppSurfaceMode::EmbeddedObject)
        | None => Ok(ProductAppRuntimeInteraction {
            mode: ProductAppRuntimeInteractionMode::Standalone,
            profile: Some("product-app-runtime".to_string()),
            chat: None,
            tabs: Vec::new(),
        }),
    }
}

fn build_product_app_runtime_chat(
    product_app_surface: &ComponentDefinition,
    components: &[ComponentDefinition],
) -> Option<ProductAppRuntimeInteractionChat> {
    let dependency = product_app_surface
        .dependencies
        .iter()
        .find(|dependency| dependency.kind == ComponentKind::Agent)?;
    let backend_agent_type = components
        .iter()
        .find(|component| {
            component.kind == ComponentKind::Agent && component.id == dependency.component_id
        })
        .and_then(|component| component.implementation_ref.as_deref())
        .and_then(|implementation_ref| implementation_ref.strip_prefix("agent://"))
        .map(str::trim)
        .filter(|agent_type| !agent_type.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| dependency.component_id.clone());
    let agent_type = if matches!(
        get_agent_registry().get_agent_category(&backend_agent_type, None),
        Some(AgentCategory::Hidden)
    ) {
        "Runno".to_string()
    } else {
        backend_agent_type.clone()
    };
    Some(ProductAppRuntimeInteractionChat {
        backend_id: Some(backend_binding_id(dependency)),
        agent_component_id: Some(dependency.component_id.clone()),
        agent_type: Some(agent_type),
        backend_agent_type: Some(backend_agent_type),
        session_policy: Some(ProductAppRuntimeBackendSessionPolicy::PerEntity),
        memory_scope: Some(ProductAppRuntimeBackendMemoryScope::AppInstance),
        initial_prompt_key: None,
        allow_user_prompt: true,
    })
}

fn host_adapter_backends_from_product_app_runtime(
    backends: Vec<ProductAppRuntimeBackendBinding>,
) -> Vec<HostAdapterCoreBackendBinding> {
    backends
        .into_iter()
        .map(|backend| HostAdapterCoreBackendBinding {
            id: backend.id,
            kind: host_adapter_backend_kind_from_product_app_runtime(backend.kind),
            component_id: backend.component_id,
            component_package_dir: backend.component_package_dir,
            capability_id: backend.capability_id,
            role: backend.role,
            session_policy: host_adapter_backend_session_policy_from_product_app_runtime(
                backend.session_policy,
            ),
            memory_scope: host_adapter_backend_memory_scope_from_product_app_runtime(
                backend.memory_scope,
            ),
            actions: backend
                .actions
                .into_iter()
                .map(host_adapter_backend_action_from_product_app_runtime)
                .collect(),
        })
        .collect()
}

fn host_adapter_backend_kind_from_product_app_runtime(
    kind: ProductAppRuntimeBackendKind,
) -> HostAdapterCoreBackendKind {
    match kind {
        ProductAppRuntimeBackendKind::AgentComponent => HostAdapterCoreBackendKind::AgentComponent,
        ProductAppRuntimeBackendKind::BridgeComponent => {
            HostAdapterCoreBackendKind::BridgeComponent
        }
    }
}

fn host_adapter_backend_session_policy_from_product_app_runtime(
    policy: ProductAppRuntimeBackendSessionPolicy,
) -> HostAdapterCoreBackendSessionPolicy {
    match policy {
        ProductAppRuntimeBackendSessionPolicy::PerEntity => {
            HostAdapterCoreBackendSessionPolicy::PerEntity
        }
    }
}

fn host_adapter_backend_memory_scope_from_product_app_runtime(
    scope: ProductAppRuntimeBackendMemoryScope,
) -> HostAdapterCoreBackendMemoryScope {
    match scope {
        ProductAppRuntimeBackendMemoryScope::AppInstance => {
            HostAdapterCoreBackendMemoryScope::AppInstance
        }
    }
}

fn host_adapter_backend_action_from_product_app_runtime(
    action: ProductAppRuntimeBackendActionBinding,
) -> HostAdapterCoreBackendActionBinding {
    HostAdapterCoreBackendActionBinding {
        name: action.name,
        input_schema: action.input_schema,
        output_schema: action.output_schema,
        allow_state_patch: action.allow_state_patch,
    }
}

fn host_adapter_interaction_from_product_app_runtime(
    interaction: ProductAppRuntimeInteraction,
) -> HostAdapterCoreInteraction {
    HostAdapterCoreInteraction {
        mode: host_adapter_interaction_mode_from_product_app_runtime(interaction.mode),
        profile: interaction.profile,
        title: None,
        chat: interaction
            .chat
            .map(host_adapter_interaction_chat_from_product_app_runtime),
        tabs: interaction
            .tabs
            .into_iter()
            .map(host_adapter_interaction_tab_from_product_app_runtime)
            .collect(),
    }
}

fn host_adapter_interaction_mode_from_product_app_runtime(
    mode: ProductAppRuntimeInteractionMode,
) -> HostAdapterCoreInteractionMode {
    match mode {
        ProductAppRuntimeInteractionMode::Standalone => HostAdapterCoreInteractionMode::Standalone,
        ProductAppRuntimeInteractionMode::Composite => HostAdapterCoreInteractionMode::Composite,
    }
}

fn host_adapter_interaction_chat_from_product_app_runtime(
    chat: ProductAppRuntimeInteractionChat,
) -> HostAdapterCoreInteractionChat {
    HostAdapterCoreInteractionChat {
        backend_id: chat.backend_id,
        agent_component_id: chat.agent_component_id,
        agent_type: chat.agent_type,
        backend_agent_type: chat.backend_agent_type,
        session_policy: chat
            .session_policy
            .map(host_adapter_backend_session_policy_from_product_app_runtime),
        memory_scope: chat
            .memory_scope
            .map(host_adapter_backend_memory_scope_from_product_app_runtime),
        initial_prompt_key: chat.initial_prompt_key,
        allow_user_prompt: chat.allow_user_prompt,
    }
}

fn host_adapter_interaction_tab_from_product_app_runtime(
    tab: ProductAppRuntimeInteractionTab,
) -> HostAdapterCoreInteractionTab {
    HostAdapterCoreInteractionTab {
        id: tab.id,
        tab_type: tab.tab_type,
        route: tab.route,
        title: tab.title,
        title_key: tab.title_key,
        default: tab.default,
        developer_only: tab.developer_only,
        sidecar: tab.sidecar,
        data: tab.data,
    }
}

fn default_product_app_runtime_route(app: &AppDefinition) -> &'static str {
    match app.truth_source {
        Some(AppTruthSource::RuntimeFact) => "/preview",
        Some(AppTruthSource::OwnedObjectState) | None => "/",
    }
}

fn backend_binding_id(dependency: &AppComponentRef) -> String {
    if dependency.role.trim().is_empty() {
        dependency.component_id.clone()
    } else {
        dependency.role.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sparo_core::app_platform::{
        AppCatalogVisibility, AppDataLifecyclePolicy, AppIconSpec, AppInstallScope,
        AppInteractionModel, AppPermissionSummary, AppRuntimeInteraction,
        AppRuntimeInteractionSidecar, AppRuntimeInteractionTab, AppRuntimeInteractionText,
        AppRuntimeSidecarIcon, AppRuntimeSidecarTargetGroup, AppSurfaceMode, AppTruthSource,
        AppWorkMultiplicity, CapabilityRef, ComponentLock, ComponentOwnerApp,
        ComponentPackageSource, ComponentSource, ComponentVisibility, ProductAppCatalogEntry,
        SurfaceRef,
    };

    fn runtime_request() -> ResolveProductAppRuntimeInstanceRequest {
        ResolveProductAppRuntimeInstanceRequest {
            work_id: "work_release_runtime".to_string(),
            slot_id: "primary".to_string(),
            app_id: "sample-app".to_string(),
            release_id: "release-sample-4".to_string(),
            config_revision: "config-2".to_string(),
            data_schema_version: "1".to_string(),
            runtime_instance_id: None,
            product_app_surface_id: None,
            surface_id: None,
        }
    }

    #[test]
    fn runtime_request_requires_complete_release_binding() {
        let mut request = runtime_request();
        request.release_id.clear();

        let error = validate_runtime_binding_request(&request)
            .expect_err("release identity must be explicit");

        assert_eq!(error, "releaseId is required");
    }

    #[test]
    fn runtime_request_cannot_override_work_config_revision() {
        let request = runtime_request();
        let app_ref =
            WorkAppRef::product_app("primary", "sample-app", "release-sample-4", "config-1", "1");

        let error = validate_requested_app_ref(&request, &app_ref)
            .expect_err("runtime must use Work-pinned config");

        assert!(error.contains("pins config revision config-1"));
    }

    fn test_app() -> AppDefinition {
        AppDefinition {
            id: "sample-app".to_string(),
            version: "1.0.0".to_string(),
            name: "Sample App".to_string(),
            description: "A sample app".to_string(),
            authors: Vec::new(),
            i18n: Default::default(),
            interaction_model: AppInteractionModel::InteractiveWorkspace,
            runtime_interaction: None,
            work_multiplicity: AppWorkMultiplicity::Multiple,
            work_object_kinds: Vec::new(),
            data_lifecycle: Some(AppDataLifecyclePolicy::default()),
            truth_source: None,
            primary_surface: Some(SurfaceRef {
                component_id: "sample-surface".to_string(),
                surface_id: Some("primary".to_string()),
            }),
            primary_surface_mode: Some(AppSurfaceMode::SidecarLinked),
            components: Vec::new(),
            component_lock_id: "sha256:lock".to_string(),
            permissions: AppPermissionSummary::default(),
            os_capabilities: Vec::new(),
            install_scope: AppInstallScope::System,
            catalog_visibility: AppCatalogVisibility::Discoverable,
            enabled: true,
            icon: AppIconSpec::Monogram {
                label: "Sample App".to_string(),
                seed: None,
                background: None,
            },
            category: "utility".to_string(),
            tags: Vec::new(),
            launch: None,
        }
    }

    fn test_surface() -> ComponentDefinition {
        ComponentDefinition {
            id: "sample-surface".to_string(),
            version: None,
            kind: ComponentKind::Surface,
            name: "Sample Surface".to_string(),
            description: "Sample private surface".to_string(),
            package_source: ComponentPackageSource::AppPrivate,
            owner_app: None,
            capabilities: Vec::new(),
            permissions: Vec::new(),
            uses_capabilities: Vec::new(),
            used_by_apps: vec!["sample-app".to_string()],
            visibility: ComponentVisibility::AppDependency,
            dependencies: vec![sparo_core::app_platform::AppComponentRef {
                component_id: "sample-agent".to_string(),
                kind: ComponentKind::Agent,
                source: ComponentSource::Private,
                role: "assistant".to_string(),
                version: None,
                capabilities: vec!["agent.run".to_string()],
                uses_capabilities: Vec::new(),
            }],
            implementation_ref: Some("app://sample-app@1.0.0/surfaces/sample-surface".to_string()),
        }
    }

    fn test_agent_component() -> ComponentDefinition {
        ComponentDefinition {
            id: "sample-agent".to_string(),
            version: None,
            kind: ComponentKind::Agent,
            name: "Sample Agent".to_string(),
            description: "Sample private agent".to_string(),
            package_source: ComponentPackageSource::AppPrivate,
            owner_app: Some(ComponentOwnerApp {
                app_id: "sample-app".to_string(),
                app_version: "1.0.0".to_string(),
            }),
            capabilities: vec![CapabilityRef {
                id: "agent.run".to_string(),
                title: "Run agent".to_string(),
                description: String::new(),
                actions: vec!["sendMessage".to_string(), "summarize".to_string()],
            }],
            permissions: Vec::new(),
            uses_capabilities: Vec::new(),
            used_by_apps: vec!["sample-app".to_string()],
            visibility: ComponentVisibility::AppDependency,
            dependencies: Vec::new(),
            implementation_ref: Some("agent://Runno".to_string()),
        }
    }

    fn test_resolved_app(components: Vec<ComponentDefinition>) -> ResolvedProductApp {
        let app = test_app();
        let lock = ComponentLock {
            app_id: app.id.clone(),
            version: app.version.clone(),
            lock_version: 1,
            permission_digest: "sha256:permission".to_string(),
            component_graph_digest: "sha256:components".to_string(),
            resolved_components: Vec::new(),
        };
        let component_lock_digest = lock.digest();
        ResolvedProductApp {
            app: app.clone(),
            components,
            lock,
            catalog_entry: ProductAppCatalogEntry {
                app,
                component_lock_digest,
                package_digest: None,
                update_available: false,
                installed_component_lock_digest: None,
                available_component_lock_digest: None,
                installed_package_digest: None,
                available_package_digest: None,
                catalog_release_id: None,
                catalog_release_label: None,
                catalog_release_notes: None,
                catalog_published_at_ms: None,
                dependency_summary: String::new(),
                installed: false,
                discoverable: false,
                library_sources: Vec::new(),
                catalog_source: None,
                catalog_issues: Vec::new(),
                management: Default::default(),
                rehearsal_plan: None,
                eval_plan: None,
            },
            private_surface_sources: Default::default(),
            package_dir: None,
        }
    }

    #[test]
    fn validates_private_surface_refs_against_package_identity() {
        let app = test_app();
        let surface = test_surface();

        validate_private_surface_ref(
            "app://sample-app@1.0.0/surfaces/sample-surface",
            &app,
            &surface,
        )
        .expect("valid private surface ref");

        assert!(validate_private_surface_ref(
            "app://sample-app@2.0.0/surfaces/sample-surface",
            &app,
            &surface,
        )
        .is_err());
        assert!(validate_private_surface_ref(
            "app://sample-app@1.0.0/surfaces/other-surface",
            &app,
            &surface,
        )
        .is_err());
    }

    #[test]
    fn private_surface_iframe_features_are_explicitly_scoped() {
        let mut surface = test_surface();
        surface.permissions = vec![
            sparo_core::app_platform::PermissionSpec {
                kind: "net".to_string(),
                summary: "Preview host".to_string(),
                scopes: vec!["http://127.0.0.1:*".to_string()],
            },
            sparo_core::app_platform::PermissionSpec {
                kind: "iframe".to_string(),
                summary: "Playback policy".to_string(),
                scopes: vec!["autoplay".to_string(), "unknown".to_string()],
            },
        ];

        let permissions = product_app_surface_host_permissions(&surface);
        let iframe = permissions.iframe.expect("declared iframe permission");
        assert!(iframe.autoplay);
        assert!(!iframe.fullscreen);
        assert_eq!(
            permissions.net.and_then(|net| net.allow),
            Some(vec!["http://127.0.0.1:*".to_string()])
        );
    }

    #[test]
    fn private_surface_dependencies_become_runtime_backends() {
        let components = vec![test_surface(), test_agent_component()];
        let app = test_resolved_app(components.clone());
        let backends = build_private_surface_backends(&app, &test_surface(), &components)
            .expect("runtime backends");

        assert_eq!(backends.len(), 1);
        assert_eq!(backends[0].id, "assistant");
        assert_eq!(backends[0].component_id, "sample-agent");
        assert_eq!(backends[0].component_package_dir, None);
        assert_eq!(backends[0].capability_id.as_deref(), Some("agent.run"));
        assert_eq!(
            backends[0]
                .actions
                .iter()
                .map(|action| action.name.as_str())
                .collect::<Vec<_>>(),
            vec!["sendMessage", "summarize"]
        );
        assert_eq!(
            backends[0].session_policy,
            ProductAppRuntimeBackendSessionPolicy::PerEntity
        );
    }

    #[test]
    fn app_private_dependencies_carry_component_package_dir() {
        let package_dir = std::env::temp_dir().join(format!(
            "sparo-product-app-runtime-api-test-{}",
            uuid::Uuid::new_v4()
        ));
        let source_dir = package_dir
            .join("components")
            .join(ComponentKind::Agent.path_segment())
            .join("sample-agent")
            .join("source");
        std::fs::create_dir_all(&source_dir).expect("create private component source dir");

        let mut agent = test_agent_component();
        agent.owner_app = Some(ComponentOwnerApp {
            app_id: "sample-app".to_string(),
            app_version: "1.0.0".to_string(),
        });
        agent.implementation_ref = Some("app://sample-app@1.0.0/agents/sample-agent".to_string());

        let components = vec![test_surface(), agent];
        let mut app = test_resolved_app(components.clone());
        app.package_dir = Some(package_dir.clone());
        let backends = build_private_surface_backends(&app, &test_surface(), &components)
            .expect("runtime backends");
        let expected_package_dir = source_dir.to_string_lossy().to_string();
        let _ = std::fs::remove_dir_all(&package_dir);

        assert_eq!(backends.len(), 1);
        assert_eq!(
            backends[0].component_package_dir.as_deref(),
            Some(expected_package_dir.as_str())
        );
    }

    #[test]
    fn sidecar_product_apps_use_composite_runtime_interaction() {
        let mut app = test_app();
        app.truth_source = Some(AppTruthSource::RuntimeFact);
        let interaction = build_product_app_runtime_interaction(
            &app,
            &test_surface(),
            &[test_surface(), test_agent_component()],
        )
        .expect("runtime interaction");

        assert_eq!(
            interaction.mode,
            ProductAppRuntimeInteractionMode::Composite
        );
        assert_eq!(interaction.profile.as_deref(), Some("product-app-runtime"));
        assert_eq!(
            interaction
                .chat
                .as_ref()
                .and_then(|chat| chat.backend_id.as_deref()),
            Some("assistant")
        );
        assert_eq!(
            interaction
                .chat
                .as_ref()
                .and_then(|chat| chat.agent_component_id.as_deref()),
            Some("sample-agent")
        );
        assert_eq!(
            interaction
                .chat
                .as_ref()
                .and_then(|chat| chat.agent_type.as_deref()),
            Some("Runno")
        );
        assert_eq!(
            interaction
                .chat
                .as_ref()
                .and_then(|chat| chat.backend_agent_type.as_deref()),
            Some("Runno")
        );
        assert_eq!(interaction.tabs.len(), 1);
        assert_eq!(interaction.tabs[0].route.as_deref(), Some("/preview"));
    }

    #[test]
    fn app_declared_manuscript_tab_is_appended_with_explicit_sidecar_metadata() {
        let mut app = test_app();
        app.runtime_interaction = Some(AppRuntimeInteraction {
            tabs: vec![AppRuntimeInteractionTab {
                id: "manuscript".to_string(),
                tab_type: "product-app-runtime".to_string(),
                title: Some(AppRuntimeInteractionText::Localized(
                    [
                        ("zh-CN".to_string(), "文本稿".to_string()),
                        ("en-US".to_string(), "Manuscript".to_string()),
                    ]
                    .into_iter()
                    .collect(),
                )),
                title_key: None,
                route: Some("/manuscript".to_string()),
                default: false,
                developer_only: false,
                sidecar: Some(AppRuntimeInteractionSidecar {
                    action_id: Some("ppt-manuscript".to_string()),
                    icon: Some(AppRuntimeSidecarIcon::FileText),
                    order: Some(10),
                    availability: None,
                    target_group: Some(AppRuntimeSidecarTargetGroup::Primary),
                }),
                data: serde_json::json!({
                    "documentId": "manuscript",
                    "viewMode": "edit-preview"
                }),
            }],
        });

        let interaction = build_product_app_runtime_interaction(
            &app,
            &test_surface(),
            &[test_surface(), test_agent_component()],
        )
        .expect("declared interaction tabs");

        assert_eq!(interaction.tabs.len(), 2);
        assert!(interaction.tabs[0].default);
        let manuscript = &interaction.tabs[1];
        assert_eq!(manuscript.id, "manuscript");
        assert_eq!(manuscript.route.as_deref(), Some("/manuscript"));
        assert!(!manuscript.default);
        let sidecar = manuscript.sidecar.as_ref().expect("sidecar metadata");
        assert_eq!(sidecar.action_id.as_deref(), Some("ppt-manuscript"));
        assert_eq!(sidecar.icon.as_deref(), Some("file-text"));
        assert_eq!(sidecar.target_group.as_deref(), Some("primary"));
    }

    #[test]
    fn hidden_backend_agent_is_not_used_as_the_visible_chat_shell() {
        let mut hidden_agent = test_agent_component();
        hidden_agent.implementation_ref = Some("agent://PptLiveAgent".to_string());

        let interaction = build_product_app_runtime_interaction(
            &test_app(),
            &test_surface(),
            &[test_surface(), hidden_agent],
        )
        .expect("runtime interaction");
        let chat = interaction.chat.expect("chat binding");

        assert_eq!(chat.agent_type.as_deref(), Some("Runno"));
        assert_eq!(chat.backend_agent_type.as_deref(), Some("PptLiveAgent"));
    }
}
