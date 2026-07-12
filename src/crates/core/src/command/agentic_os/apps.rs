//! Authoritative Intelligent App catalog command boundary.

use serde::{Deserialize, Serialize};

use crate::app_platform::{
    seed_system_app_releases, AppActivationScope, AppRevisionStore, AppSlotProjection, DraftRecord,
};
use crate::infrastructure::try_get_path_manager_arc;

use super::super::{CommandError, CommandResult};

#[derive(Debug, Clone, Default, Deserialize)]
pub struct IntelligentAppCatalogRequest {}

#[derive(Debug, Clone, Serialize)]
pub struct IntelligentAppCatalogResponse {
    pub slots: Vec<AppSlotProjection>,
    pub drafts: Vec<DraftRecord>,
}

/// Opens the same revision store used by Desktop, synchronizes bundled system
/// releases, and projects the global activation without consulting legacy
/// package/runtime-host indexes.
pub async fn get_intelligent_app_catalog(
    request: IntelligentAppCatalogRequest,
) -> CommandResult<IntelligentAppCatalogResponse> {
    let path_manager = try_get_path_manager_arc().map_err(CommandError::session)?;
    let store = AppRevisionStore::open(path_manager.app_root())
        .await
        .map_err(CommandError::session)?;
    seed_system_app_releases(&path_manager, &store)
        .await
        .map_err(CommandError::session)?;

    let _ = request;
    let scope = AppActivationScope::System;
    let projection = store.list_catalog(&scope).await;

    Ok(IntelligentAppCatalogResponse {
        slots: projection.slots,
        drafts: projection.drafts,
    })
}
