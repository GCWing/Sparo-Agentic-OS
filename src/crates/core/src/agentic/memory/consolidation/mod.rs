mod prompt;
mod runner;
mod state;

pub use runner::{
    get_global_memory_consolidation_service, set_global_memory_consolidation_service,
    ManualMemoryConsolidationRequest, MemoryConsolidationService, MemoryConsolidationSummary,
};
