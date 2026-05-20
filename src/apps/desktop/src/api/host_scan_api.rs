use bitfun_core::service::{get_global_host_auto_scan_service, HostScanRunSummary};
use log::{debug, error};

fn host_scan_service() -> Result<std::sync::Arc<bitfun_core::service::HostAutoScanService>, String>
{
    get_global_host_auto_scan_service()
        .ok_or_else(|| "Host auto scan service is not initialized".to_string())
}

#[tauri::command]
pub async fn run_host_scan() -> Result<HostScanRunSummary, String> {
    debug!("Running host scan manually");

    let service = host_scan_service()?;
    service.run_now().await.map_err(|error| {
        error!("Failed to run host scan manually: {}", error);
        format!("Failed to run host scan manually: {}", error)
    })
}
