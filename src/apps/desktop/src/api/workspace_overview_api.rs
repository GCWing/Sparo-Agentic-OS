use sparo_core::agentic::memory::routing::WorkspaceOverviewBinding;
use sparo_core::service::{
    get_global_workspace_overview_auto_refresh_service, WorkspaceOverviewRefreshRunSummary,
};
use log::{debug, error};

fn workspace_overview_service(
) -> Result<std::sync::Arc<sparo_core::service::WorkspaceOverviewAutoRefreshService>, String> {
    get_global_workspace_overview_auto_refresh_service()
        .ok_or_else(|| "Workspace overview auto refresh service is not initialized".to_string())
}

#[tauri::command]
pub async fn run_workspace_overview_refresh() -> Result<WorkspaceOverviewRefreshRunSummary, String>
{
    debug!("Running workspace overview refresh manually");

    let service = workspace_overview_service()?;
    service.run_now().await.map_err(|error| {
        error!(
            "Failed to run workspace overview refresh manually: {}",
            error
        );
        format!(
            "Failed to run workspace overview refresh manually: {}",
            error
        )
    })
}

#[tauri::command]
pub async fn list_workspace_overview_bindings() -> Result<Vec<WorkspaceOverviewBinding>, String> {
    debug!("Listing workspace overview bindings");

    sparo_core::agentic::memory::routing::list_workspace_overview_bindings()
        .await
        .map_err(|error| {
            error!("Failed to list workspace overview bindings: {}", error);
            format!("Failed to list workspace overview bindings: {}", error)
        })
}
