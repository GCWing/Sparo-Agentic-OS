use crate::agentic_os::background_process::{
    list_background_processes, run_background_process, BackgroundProcessList,
    RunBackgroundProcessRequest, RunBackgroundProcessResponse,
};
use crate::util::errors::BitFunResult;

pub async fn list_background_processes_command() -> BitFunResult<BackgroundProcessList> {
    list_background_processes().await
}

pub async fn run_background_process_command(
    request: RunBackgroundProcessRequest,
) -> BitFunResult<RunBackgroundProcessResponse> {
    run_background_process(request).await
}
