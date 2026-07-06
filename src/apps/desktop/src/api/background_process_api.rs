use log::{debug, error};
use sparo_core::agentic_os::background_process::{
    BackgroundProcessList, RunBackgroundProcessRequest, RunBackgroundProcessResponse,
};
use sparo_core::command::agentic_os::{
    list_background_processes_command, run_background_process_command,
};

#[tauri::command]
pub async fn agentic_os_list_background_processes() -> Result<BackgroundProcessList, String> {
    debug!("Listing Agentic OS background processes");

    list_background_processes_command().await.map_err(|error| {
        error!("Failed to list Agentic OS background processes: {}", error);
        format!("Failed to list Agentic OS background processes: {}", error)
    })
}

#[tauri::command]
pub async fn agentic_os_run_background_process(
    request: RunBackgroundProcessRequest,
) -> Result<RunBackgroundProcessResponse, String> {
    debug!(
        "Running Agentic OS background process: kind={:?}",
        request.kind
    );

    run_background_process_command(request)
        .await
        .map_err(|error| {
            error!("Failed to run Agentic OS background process: {}", error);
            format!("Failed to run Agentic OS background process: {}", error)
        })
}
