//! User approval API for immutable App capability manifests.

use crate::api::app_state::AppState;
use serde::{Deserialize, Serialize};
use sparo_core::app_platform::{CapabilityGrant, CapabilityGrantStore};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCapabilityGrantRequest {
    pub app_id: String,
}

#[tauri::command]
pub async fn list_app_capability_grants(
    state: State<'_, AppState>,
    request: AppCapabilityGrantRequest,
) -> Result<Vec<CapabilityGrant>, String> {
    grant_store(&state)
        .list_for_app(&request.app_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn revoke_app_capabilities(
    state: State<'_, AppState>,
    request: AppCapabilityGrantRequest,
) -> Result<usize, String> {
    grant_store(&state)
        .revoke_app(&request.app_id)
        .await
        .map_err(|error| error.to_string())
}

fn grant_store(state: &AppState) -> CapabilityGrantStore {
    CapabilityGrantStore::new(state.workspace_service.path_manager())
}
