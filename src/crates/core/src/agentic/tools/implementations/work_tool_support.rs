use std::sync::Arc;

use crate::agentic::tools::framework::ToolUseContext;
use crate::agentic_os::work::{
    default_work_store, AgenticWorkRuntimeBridge, WorkRuntimeBridge, WorkService,
};
use crate::util::errors::BitFunResult;

pub fn work_service_from_tool_context(context: &ToolUseContext) -> BitFunResult<WorkService> {
    let store = default_work_store()?;
    let runtime: Arc<dyn WorkRuntimeBridge> = if let Some(agentic) = context.agentic() {
        Arc::new(AgenticWorkRuntimeBridge::new(
            agentic.coordinator.clone(),
            agentic.scheduler.clone(),
        ))
    } else {
        Arc::new(crate::agentic_os::work::NoopWorkRuntimeBridge)
    };
    Ok(WorkService::with_runtime_bridge(store, runtime))
}
