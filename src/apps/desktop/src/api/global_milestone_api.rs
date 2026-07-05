use sparo_core::service::{get_global_global_milestone_service, GlobalMilestoneRunSummary};
use log::{debug, error};

fn global_milestone_service(
) -> Result<std::sync::Arc<sparo_core::service::GlobalMilestoneService>, String> {
    get_global_global_milestone_service()
        .ok_or_else(|| "Global milestone service is not initialized".to_string())
}

#[tauri::command]
pub async fn run_global_milestone() -> Result<GlobalMilestoneRunSummary, String> {
    debug!("Running global milestone refresh manually");

    let service = global_milestone_service()?;
    service.run_now().await.map_err(|error| {
        error!("Failed to run global milestone refresh: {}", error);
        format!("Failed to run global milestone refresh: {}", error)
    })
}
