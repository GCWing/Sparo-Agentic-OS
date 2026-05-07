pub mod auto;
pub mod consolidation;
mod prompts;
pub mod routing;
pub mod store;

pub use auto::{
    build_auto_memory_runtime_restrictions, build_extract_prompt,
    count_recent_model_visible_messages, handle_auto_memory_after_completed_turn,
    queue_action_from_schedule_decision, resolve_auto_memory_runtime_context,
    resolve_auto_memory_scope, resolve_local_auto_memory_context,
    resolve_session_auto_memory_scope, session_can_consider_auto_memory,
    AutoMemoryCompletedTurnFollowup, AutoMemoryExtractionCursor, AutoMemoryManager,
    AutoMemoryPostTurnAction, AutoMemoryQueueAction, AutoMemoryReadyReason,
    AutoMemoryScheduleDecision, AutoMemoryState, AutoMemoryThrottlePolicy,
    ResolvedAutoMemoryContext, ResolvedAutoMemoryRuntimeContext,
};
pub use consolidation::{
    get_global_memory_consolidation_service, set_global_memory_consolidation_service,
    ManualMemoryConsolidationRequest, MemoryConsolidationService, MemoryConsolidationSummary,
};
pub use store::MemoryScope;
