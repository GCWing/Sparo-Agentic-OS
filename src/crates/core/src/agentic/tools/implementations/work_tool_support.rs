use std::sync::Arc;

use crate::agentic::tools::framework::ToolUseContext;
use crate::agentic_os::work::{
    default_work_store, AgenticWorkRuntimeBridge, WorkOwnerRef, WorkRuntimeBridge, WorkService,
};
use crate::error::CoreResult;
use crate::infrastructure::try_get_path_manager_arc;

pub fn work_service_from_tool_context(context: &ToolUseContext) -> CoreResult<WorkService> {
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

pub fn work_owner_from_tool_context(context: &ToolUseContext) -> Option<WorkOwnerRef> {
    let session_id = context
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let turn_id = context
        .dialog_turn_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let workspace_path = context
        .workspace_root()
        .map(|path| path.to_string_lossy().into_owned())
        .or_else(|| {
            try_get_path_manager_arc().ok().map(|paths| {
                paths
                    .agentic_os_runtime_root()
                    .to_string_lossy()
                    .into_owned()
            })
        });

    Some(WorkOwnerRef {
        session_id,
        turn_id,
        workspace_path,
    })
}
