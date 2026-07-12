//! Consent and command-oriented review API for Intelligent App evolution.

use crate::api::app_state::AppState;
use serde::{Deserialize, Serialize};
use sparo_core::app_platform::{
    AppActivationPolicy, AppActivationScope, AppOwnerKind, EvolutionAutonomyLevel,
    EvolutionConsent, EvolutionProposal, EvolutionProposalKind, ProductAppEvolutionState,
    ProductAppEvolutionStore,
};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAppEvolutionConsentRequest {
    pub enabled: bool,
    pub autonomy_level: EvolutionAutonomyLevel,
    pub signal_retention_days: u32,
    pub allow_content_analysis: bool,
    pub allow_product_insights: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveAppEvolutionProposalRequest {
    pub proposal_id: String,
    pub candidate_draft_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEvolutionProposalRequest {
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackAppEvolutionProposalRequest {
    pub proposal_id: String,
}

#[tauri::command]
pub async fn get_app_evolution_state(
    state: State<'_, AppState>,
) -> Result<ProductAppEvolutionState, String> {
    evolution_store(&state)
        .state()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn set_app_evolution_consent(
    state: State<'_, AppState>,
    request: SetAppEvolutionConsentRequest,
) -> Result<ProductAppEvolutionState, String> {
    evolution_store(&state)
        .set_consent(EvolutionConsent {
            enabled: request.enabled,
            autonomy_level: request.autonomy_level,
            signal_retention_days: request.signal_retention_days,
            allow_content_analysis: request.allow_content_analysis,
            allow_product_insights: request.allow_product_insights,
            // ProductAppEvolutionStore always replaces this with trusted backend time.
            updated_at_ms: 0,
        })
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn approve_app_evolution_proposal(
    state: State<'_, AppState>,
    request: ApproveAppEvolutionProposalRequest,
) -> Result<EvolutionProposal, String> {
    let store = evolution_store(&state);
    let evolution_state = store.state().await.map_err(|error| error.to_string())?;
    let proposal = evolution_state
        .proposals
        .get(&request.proposal_id)
        .cloned()
        .ok_or_else(|| format!("Evolution proposal not found: {}", request.proposal_id))?;
    let resolved_draft = state
        .app_revision_store
        .resolve_draft(&request.candidate_draft_id)
        .await
        .map_err(|error| error.to_string())?;
    let candidate_app = state
        .app_revision_store
        .get_app(&resolved_draft.draft.app_id)
        .await
        .ok_or_else(|| {
            format!(
                "Candidate Draft references missing App: {}",
                resolved_draft.draft.app_id
            )
        })?;
    if candidate_app.owner.kind == AppOwnerKind::System {
        return Err("Evolution candidates must be user- or organization-owned Drafts".to_string());
    }

    match proposal.kind {
        EvolutionProposalKind::Create => {
            if resolved_draft.draft.base_release_id.is_some()
                || candidate_app.derived_from.is_some()
            {
                return Err(
                    "Create evolution proposal requires a new App Draft without a base Release"
                        .to_string(),
                );
            }
        }
        EvolutionProposalKind::Improve | EvolutionProposalKind::Rebase => {
            let base_app_id = proposal
                .base_app_id
                .as_deref()
                .ok_or_else(|| "Evolution proposal has no base App".to_string())?;
            let base_release_id = proposal
                .base_release_id
                .as_deref()
                .ok_or_else(|| "Evolution proposal has no base Release".to_string())?;
            state
                .app_revision_store
                .resolve_release(base_app_id, base_release_id)
                .await
                .map_err(|error| error.to_string())?;
            if resolved_draft.draft.base_release_id.as_deref() != Some(base_release_id) {
                return Err(format!(
                    "Candidate Draft base does not match proposal base Release {base_release_id}"
                ));
            }
            if candidate_app.app_id != base_app_id
                && candidate_app.derived_from.as_ref().is_none_or(|derived| {
                    derived.app_id != base_app_id || derived.release_id != base_release_id
                })
            {
                return Err(
                    "Candidate Draft App is not the proposal base App or its verified fork"
                        .to_string(),
                );
            }
        }
    }

    store
        .approve_proposal_draft(&request.proposal_id, &request.candidate_draft_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn reject_app_evolution_proposal(
    state: State<'_, AppState>,
    request: AppEvolutionProposalRequest,
) -> Result<EvolutionProposal, String> {
    evolution_store(&state)
        .reject_proposal(&request.proposal_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn rollback_app_evolution_proposal(
    state: State<'_, AppState>,
    request: RollbackAppEvolutionProposalRequest,
) -> Result<EvolutionProposal, String> {
    let store = evolution_store(&state);
    let proposal = store
        .state()
        .await
        .map_err(|error| error.to_string())?
        .proposals
        .get(&request.proposal_id)
        .cloned()
        .ok_or_else(|| format!("Evolution proposal not found: {}", request.proposal_id))?;
    let candidate_release_id = proposal.candidate_release_id.as_deref().ok_or_else(|| {
        format!(
            "Evolution proposal {} has no candidate Release to roll back",
            request.proposal_id
        )
    })?;
    let releases = state.app_revision_store.list_releases(None).await;
    let candidate_release = releases
        .iter()
        .find(|release| release.release_id == candidate_release_id)
        .ok_or_else(|| format!("Candidate Release not found: {candidate_release_id}"))?;
    let candidate_app = state
        .app_revision_store
        .get_app(&candidate_release.app_id)
        .await
        .ok_or_else(|| format!("Candidate App not found: {}", candidate_release.app_id))?;
    AppActivationPolicy::new(
        state.app_revision_store.as_ref(),
        state.workspace_service.path_manager(),
    )
    .rollback_if_current(
        &AppActivationScope::System,
        &candidate_app.slot_id,
        candidate_release_id,
    )
    .await
    .map_err(|error| error.to_string())?;
    store
        .rollback_proposal(&request.proposal_id)
        .await
        .map_err(|error| error.to_string())
}

fn evolution_store(state: &AppState) -> ProductAppEvolutionStore {
    ProductAppEvolutionStore::new(state.workspace_service.path_manager())
}
