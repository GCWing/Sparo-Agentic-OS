//! Intelligent App identity, Draft, Release, and Activation API.

use crate::api::app_state::AppState;
use crate::api::product_app_runtime_api::{
    close_draft_runtime_preview, create_draft_runtime_preview,
    delete_product_app_runtime_instances_for_slot, prune_stale_product_app_runtime_instances,
    ProductAppRuntimeContext, ProductAppRuntimeHostSurface,
};
use serde::{Deserialize, Serialize};
use sparo_core::app_platform::{
    list_system_shared_components, ActivateReleaseRequest, ActivationRecord, AppActivationPolicy,
    AppActivationScope, AppCatalogProjection, AppOwner, AppOwnerKind, AppRecord,
    AppReleaseCapabilityReview, CapabilityGrant, CreateDraftRequest, CreateIntelligentAppRequest,
    CreatedApp, DraftRecord, ForkReleaseRequest, ProductAppEvolutionStore, ProductAppResolver,
    PublishDraftRequest, ReleaseProvenanceKind, ReleaseRecord, ResolvedDraft,
};
use tauri::State;

const LOCAL_USER_OWNER_ID: &str = "local-user";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListIntelligentAppCatalogRequest {}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateIntelligentAppApiRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkIntelligentAppApiRequest {
    pub source_release_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_app_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAppDraftApiRequest {
    pub app_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_release_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAppRebaseDraftApiRequest {
    pub app_id: String,
    pub current_release_id: String,
    pub target_upstream_release_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftIdRequest {
    pub draft_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedDraftResponse {
    pub draft: DraftRecord,
    pub source_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishAppDraftApiRequest {
    pub draft_id: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedAppDraftResponse {
    pub app: AppRecord,
    pub release: ReleaseRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveDraftPreviewRequest {
    pub draft_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseDraftPreviewRequest {
    pub preview_session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftPreviewResponse {
    pub preview_session_id: String,
    pub ephemeral_artifact_id: String,
    pub host_surface: ProductAppRuntimeHostSurface,
    pub runtime_context: ProductAppRuntimeContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateAppReleaseApiRequest {
    pub slot_id: String,
    pub app_id: String,
    pub release_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotActivationRequest {
    pub slot_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIdRequest {
    pub app_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppReleaseRequest {
    pub app_id: String,
    pub release_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveAppReleaseCapabilitiesRequest {
    pub app_id: String,
    pub release_id: String,
}

#[tauri::command]
pub async fn list_app_catalog(
    state: State<'_, AppState>,
    request: ListIntelligentAppCatalogRequest,
) -> Result<AppCatalogProjection, String> {
    let _ = request;
    Ok(state
        .app_revision_store
        .list_catalog(&AppActivationScope::System)
        .await)
}

#[tauri::command]
pub async fn create_intelligent_app(
    state: State<'_, AppState>,
    request: CreateIntelligentAppApiRequest,
) -> Result<CreatedApp, String> {
    state
        .app_revision_store
        .create_intelligent_app(CreateIntelligentAppRequest {
            app_id: request.app_id,
            slot_id: request.slot_id,
            display_name: request.display_name,
            description: request.description,
            owner: AppOwner::user(LOCAL_USER_OWNER_ID),
        })
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn fork_intelligent_app(
    state: State<'_, AppState>,
    request: ForkIntelligentAppApiRequest,
) -> Result<CreatedApp, String> {
    let created = state
        .app_revision_store
        .fork_release(ForkReleaseRequest {
            source_release_id: request.source_release_id,
            new_app_id: request.new_app_id,
            slot_id: request.slot_id,
            display_name: request.display_name,
            description: request.description,
            owner: AppOwner::user(LOCAL_USER_OWNER_ID),
        })
        .await
        .map_err(|error| error.to_string())?;
    Ok(created)
}

#[tauri::command]
pub async fn create_app_draft(
    state: State<'_, AppState>,
    request: CreateAppDraftApiRequest,
) -> Result<DraftRecord, String> {
    state
        .app_revision_store
        .create_draft(CreateDraftRequest {
            app_id: request.app_id,
            base_release_id: request.base_release_id,
        })
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_app_rebase_draft(
    state: State<'_, AppState>,
    request: CreateAppRebaseDraftApiRequest,
) -> Result<DraftRecord, String> {
    state
        .app_revision_store
        .create_rebase_draft(
            &request.app_id,
            &request.current_release_id,
            &request.target_upstream_release_id,
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn resolve_app_draft(
    state: State<'_, AppState>,
    request: DraftIdRequest,
) -> Result<ResolvedDraftResponse, String> {
    let ResolvedDraft { draft, source_path } = state
        .app_revision_store
        .resolve_draft(&request.draft_id)
        .await
        .map_err(|error| error.to_string())?;
    Ok(ResolvedDraftResponse {
        draft,
        source_path: source_path.display().to_string(),
    })
}

#[tauri::command]
pub async fn delete_app_draft(
    state: State<'_, AppState>,
    request: DraftIdRequest,
) -> Result<DraftRecord, String> {
    state
        .app_revision_store
        .delete_draft(&request.draft_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn resolve_intelligent_app_draft_preview(
    state: State<'_, AppState>,
    request: ResolveDraftPreviewRequest,
) -> Result<DraftPreviewResponse, String> {
    let resolved_draft = state
        .app_revision_store
        .resolve_draft(&request.draft_id)
        .await
        .map_err(|error| error.to_string())?;
    let app = state
        .app_revision_store
        .get_app(&resolved_draft.draft.app_id)
        .await
        .ok_or_else(|| format!("Intelligent App not found: {}", resolved_draft.draft.app_id))?;
    let shared_components = list_system_shared_components(state.workspace_service.path_manager())
        .await
        .map_err(|error| error.to_string())?;
    let package = ProductAppResolver::read_product_app_package(&resolved_draft.source_path)
        .await
        .map_err(|error| error.to_string())?;
    let resolved_app = ProductAppResolver::resolve_package_install(package, shared_components)
        .map_err(|error| error.to_string())?;
    if resolved_app.app.id != app.app_id {
        return Err(format!(
            "Draft {} package belongs to app {}, expected {}",
            request.draft_id, resolved_app.app.id, app.app_id
        ));
    }
    let preview = create_draft_runtime_preview(
        &state,
        &request.draft_id,
        &app.slot_id,
        &resolved_app,
        request.theme.as_deref(),
        request.workspace_path.as_deref(),
    )
    .await?;
    Ok(DraftPreviewResponse {
        preview_session_id: preview.preview_session_id,
        ephemeral_artifact_id: preview.ephemeral_artifact_id,
        host_surface: preview.host_surface,
        runtime_context: preview.runtime_context,
    })
}

#[tauri::command]
pub async fn close_intelligent_app_draft_preview(
    state: State<'_, AppState>,
    request: CloseDraftPreviewRequest,
) -> Result<(), String> {
    close_draft_runtime_preview(&state, &request.preview_session_id).await
}

#[tauri::command]
pub async fn publish_app_draft(
    state: State<'_, AppState>,
    request: PublishAppDraftApiRequest,
) -> Result<PublishedAppDraftResponse, String> {
    let resolved = state
        .app_revision_store
        .resolve_draft(&request.draft_id)
        .await
        .map_err(|error| error.to_string())?;
    let shared_components = list_system_shared_components(state.workspace_service.path_manager())
        .await
        .map_err(|error| error.to_string())?;
    let app = state
        .app_revision_store
        .get_app(&resolved.draft.app_id)
        .await
        .ok_or_else(|| format!("Intelligent App not found: {}", resolved.draft.app_id))?;
    let evolution_store = ProductAppEvolutionStore::new(state.workspace_service.path_manager());
    let ai_generated = evolution_store
        .state()
        .await
        .map_err(|error| error.to_string())?
        .proposals
        .values()
        .any(|proposal| {
            proposal.candidate_draft_id.as_deref() == Some(resolved.draft.draft_id.as_str())
        });
    let provenance = if ai_generated {
        ReleaseProvenanceKind::AiGenerated
    } else {
        provenance_for_owner(app.owner.kind)
    };
    let published_draft_id = request.draft_id.clone();
    let release = state
        .app_revision_store
        .publish_draft(
            PublishDraftRequest {
                draft_id: request.draft_id,
                version: request.version,
                label: request.label,
                notes: request.notes,
                provenance,
            },
            &shared_components,
        )
        .await
        .map_err(|error| error.to_string())?;
    if let Err(error) = evolution_store
        .record_candidate_release(&published_draft_id, &release.release_id)
        .await
    {
        log::warn!(
            "Failed to link published Release to evolution proposal: draft_id={} release_id={} error={}",
            published_draft_id,
            release.release_id,
            error
        );
    }
    let app = state
        .app_revision_store
        .get_app(&resolved.draft.app_id)
        .await
        .ok_or_else(|| format!("Intelligent App not found: {}", resolved.draft.app_id))?;
    Ok(PublishedAppDraftResponse { app, release })
}

#[tauri::command]
pub async fn activate_app_release(
    state: State<'_, AppState>,
    request: ActivateAppReleaseApiRequest,
) -> Result<ActivationRecord, String> {
    let activation = activation_policy(&state)
        .activate(ActivateReleaseRequest {
            scope: AppActivationScope::System,
            slot_id: request.slot_id,
            app_id: request.app_id,
            release_id: request.release_id,
        })
        .await
        .map_err(|error| error.to_string())?;
    prune_stale_product_app_runtime_instances(&state, &activation)
        .await
        .map_err(|error| format!("App activated, but stale runtime cleanup failed: {error}"))?;
    Ok(activation)
}

#[tauri::command]
pub async fn get_app_release_capability_review(
    state: State<'_, AppState>,
    request: AppReleaseRequest,
) -> Result<AppReleaseCapabilityReview, String> {
    activation_policy(&state)
        .review_release(
            &AppActivationScope::System,
            &request.app_id,
            &request.release_id,
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn approve_app_release_capabilities(
    state: State<'_, AppState>,
    request: ApproveAppReleaseCapabilitiesRequest,
) -> Result<CapabilityGrant, String> {
    activation_policy(&state)
        .approve_release(
            &AppActivationScope::System,
            &request.app_id,
            &request.release_id,
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn deactivate_app_slot(
    state: State<'_, AppState>,
    request: SlotActivationRequest,
) -> Result<ActivationRecord, String> {
    let activation = state
        .app_revision_store
        .deactivate(&AppActivationScope::System, &request.slot_id)
        .await
        .map_err(|error| error.to_string())?;
    prune_stale_product_app_runtime_instances(&state, &activation).await?;
    Ok(activation)
}

#[tauri::command]
pub async fn remove_intelligent_app(
    state: State<'_, AppState>,
    request: AppIdRequest,
) -> Result<(), String> {
    let archived = state
        .app_revision_store
        .archive_app(&request.app_id)
        .await
        .map_err(|error| error.to_string())?;
    if let Some(activation) = state
        .app_revision_store
        .get_active(&AppActivationScope::System, &archived.app.slot_id)
        .await
    {
        prune_stale_product_app_runtime_instances(&state, &activation).await?;
    } else {
        delete_product_app_runtime_instances_for_slot(&state, &archived.app.slot_id).await?;
    }
    Ok(())
}

fn provenance_for_owner(owner: AppOwnerKind) -> ReleaseProvenanceKind {
    match owner {
        AppOwnerKind::System => ReleaseProvenanceKind::System,
        AppOwnerKind::User => ReleaseProvenanceKind::User,
        AppOwnerKind::Organization => ReleaseProvenanceKind::Organization,
    }
}

fn activation_policy(state: &AppState) -> AppActivationPolicy<'_> {
    AppActivationPolicy::new(
        state.app_revision_store.as_ref(),
        state.workspace_service.path_manager(),
    )
}
