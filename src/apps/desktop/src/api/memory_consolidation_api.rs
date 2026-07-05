use sparo_core::agentic::memory::{
    get_global_memory_consolidation_service, ManualMemoryConsolidationRequest,
    MemoryConsolidationSummary,
};
use log::{debug, error};
use serde::Deserialize;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunMemoryConsolidationRequest {
    #[serde(default = "default_true")]
    pub include_global: bool,
}

fn default_true() -> bool {
    true
}

fn memory_consolidation_service(
) -> Result<std::sync::Arc<sparo_core::agentic::memory::MemoryConsolidationService>, String> {
    get_global_memory_consolidation_service()
        .ok_or_else(|| "Memory consolidation service is not initialized".to_string())
}

#[tauri::command]
pub async fn run_memory_consolidation(
    request: Option<RunMemoryConsolidationRequest>,
) -> Result<MemoryConsolidationSummary, String> {
    let request = request.unwrap_or_default();
    debug!(
        "Running memory consolidation manually: include_global={}",
        request.include_global,
    );

    let service = memory_consolidation_service()?;
    let payload = ManualMemoryConsolidationRequest {
        include_global: request.include_global,
    };

    service.run_now(payload).await.map_err(|error| {
        error!("Failed to run memory consolidation: {}", error);
        format!("Failed to run memory consolidation: {}", error)
    })
}
