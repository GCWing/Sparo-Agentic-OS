//! Shared process-wide Agentic runtime construction.
//!
//! Desktop and CLI are both hosts for the same agent runtime. This module owns
//! the host-agnostic stack assembly so each host only supplies host capabilities
//! such as desktop computer-use integration and UI/event transport.

use std::sync::Arc;

use crate::agentic::coordination::{self, ConversationCoordinator, DialogScheduler};
use crate::agentic::events::{EventQueue, EventRouter};
use crate::agentic::execution::{ExecutionEngine, RoundExecutor, StreamProcessor};
use crate::agentic::persistence::PersistenceManager;
use crate::agentic::session::{ContextCompressor, SessionContextStore, SessionManager};
use crate::agentic::tools::computer_use_host::ComputerUseHostRef;
use crate::agentic::tools::pipeline::{ToolPipeline, ToolStateManager};
use crate::agentic::tools::registry::get_global_tool_registry;
use crate::infrastructure::try_get_path_manager_arc;

#[derive(Default, Clone)]
pub struct AgenticRuntimeOptions {
    pub computer_use_host: Option<ComputerUseHostRef>,
    pub register_agent_apps: bool,
    pub install_process_globals: bool,
}

pub struct AgenticRuntime {
    pub coordinator: Arc<ConversationCoordinator>,
    pub scheduler: Arc<DialogScheduler>,
    pub session_manager: Arc<SessionManager>,
    pub event_queue: Arc<EventQueue>,
    pub event_router: Arc<EventRouter>,
    pub tool_pipeline: Arc<ToolPipeline>,
    pub persistence_manager: Arc<PersistenceManager>,
}

pub async fn initialize_agentic_runtime(
    options: AgenticRuntimeOptions,
) -> anyhow::Result<AgenticRuntime> {
    let event_queue = Arc::new(EventQueue::new(Default::default()));
    let event_router = Arc::new(EventRouter::new());

    let path_manager = try_get_path_manager_arc()
        .map_err(|e| anyhow::anyhow!("try_get_path_manager_arc: {}", e))?;
    let persistence_manager = Arc::new(PersistenceManager::new(path_manager.clone())?);

    let context_store = Arc::new(SessionContextStore::new());
    let context_compressor = Arc::new(ContextCompressor::new(Default::default()));
    let session_manager = Arc::new(SessionManager::new(
        context_store,
        persistence_manager.clone(),
        Default::default(),
    ));

    if options.register_agent_apps {
        if let Err(e) = crate::agent_app::AgentAppManager::seed_builtin_file_agent_apps() {
            log::warn!("Failed to seed built-in Files Agent Apps at startup: {}", e);
        }
        if let Err(e) = crate::agent_app::AgentAppManager::register_all(None) {
            log::warn!("Failed to register user Agent Apps at startup: {}", e);
        }
        if let Err(e) = crate::agent_app::AgentAppManager::register_runtime_tools(None).await {
            log::warn!(
                "Failed to register user Agent App runtime tools at startup: {}",
                e
            );
        }
        if let Err(e) = crate::bridge_app::BridgeAppManager::register_agent_surfaces() {
            log::warn!(
                "Failed to register Bridge App agent surfaces at startup: {}",
                e
            );
        }
    }

    let tool_registry = get_global_tool_registry();
    let tool_state_manager = Arc::new(ToolStateManager::new(event_queue.clone()));
    let tool_pipeline = Arc::new(ToolPipeline::new(
        tool_registry,
        tool_state_manager,
        options.computer_use_host,
    ));

    let stream_processor = Arc::new(StreamProcessor::new(event_queue.clone()));
    let round_executor = Arc::new(RoundExecutor::new(
        stream_processor,
        event_queue.clone(),
        tool_pipeline.clone(),
    ));
    let execution_engine = Arc::new(ExecutionEngine::new(
        round_executor,
        event_queue.clone(),
        session_manager.clone(),
        context_compressor,
        Default::default(),
    ));

    let coordinator = Arc::new(ConversationCoordinator::new(
        session_manager.clone(),
        execution_engine,
        tool_pipeline.clone(),
        event_queue.clone(),
        event_router.clone(),
    ));

    coordinator.install_self_arc();
    session_manager.install_coordinator(Arc::downgrade(&coordinator));

    let scheduler = DialogScheduler::new(coordinator.clone(), session_manager.clone());
    coordinator.set_scheduler_notifier(scheduler.outcome_sender());
    coordinator.set_round_preempt_source(scheduler.preempt_monitor());

    if options.install_process_globals {
        let _ = coordination::install_global_coordinator(coordinator.clone());
        let _ = coordination::install_global_scheduler(scheduler.clone());
    }

    Ok(AgenticRuntime {
        coordinator,
        scheduler,
        session_manager,
        event_queue,
        event_router,
        tool_pipeline,
        persistence_manager,
    })
}
