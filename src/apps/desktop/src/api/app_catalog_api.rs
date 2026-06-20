//! Unified App Catalog API for Live App, Agent App, and Bridge App.

use crate::api::app_state::AppState;
use bitfun_core::agent_app::AgentAppManager;
use bitfun_core::app_platform::{AppCatalogEntry, AppCatalogKind};
use bitfun_core::bridge_app::BridgeAppManager;
use tauri::State;

#[tauri::command]
pub async fn list_app_catalog(state: State<'_, AppState>) -> Result<Vec<AppCatalogEntry>, String> {
    let mut entries = Vec::new();

    for app in state
        .live_app_manager
        .list()
        .await
        .map_err(|e| e.to_string())?
    {
        entries.push(AppCatalogEntry {
            id: app.id,
            name: app.name,
            description: app.description,
            kind: AppCatalogKind::LiveApp,
            icon: app.icon,
            category: app.category,
            enabled: true,
        });
    }

    AgentAppManager::seed_builtin_agent_apps().map_err(|e| e.to_string())?;
    AgentAppManager::register_all(None).map_err(|e| e.to_string())?;
    for app in AgentAppManager::list(None).map_err(|e| e.to_string())? {
        entries.push(AppCatalogEntry {
            id: app.id,
            name: app.name,
            description: app.description,
            kind: AppCatalogKind::AgentApp,
            icon: app.icon,
            category: app.category,
            enabled: app.enabled,
        });
    }

    for app in BridgeAppManager::list().map_err(|e| e.to_string())? {
        entries.push(AppCatalogEntry {
            id: app.manifest.id,
            name: app.manifest.name,
            description: app.manifest.description,
            kind: AppCatalogKind::BridgeApp,
            icon: "plug".to_string(),
            category: format!("{:?}", app.manifest.kind).to_lowercase(),
            enabled: true,
        });
    }

    entries.sort_by(|a, b| {
        a.kind
            .catalog_order()
            .cmp(&b.kind.catalog_order())
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}
