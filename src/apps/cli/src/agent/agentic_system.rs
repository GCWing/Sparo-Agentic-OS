//! Agentic System Initialization for CLI
//!
//! Initialize the complete agentic system, including coordinator, execution engine, session management, etc.

use anyhow::Result;
use bitfun_core::infrastructure::ai::AIClientFactory;
use bitfun_core::runtime::{initialize_agentic_runtime, AgenticRuntimeOptions};
use std::sync::Arc;

use bitfun_core::agentic::coordination;
use bitfun_core::agentic::events;

/// Agentic system state
pub struct AgenticSystem {
    pub coordinator: Arc<coordination::ConversationCoordinator>,
    pub event_queue: Arc<events::EventQueue>,
}

/// Initialize Agentic system
pub async fn init_agentic_system() -> Result<AgenticSystem> {
    tracing::info!("Initializing Agentic system");

    let _ai_client_factory = AIClientFactory::get_global().await?;
    let runtime = initialize_agentic_runtime(AgenticRuntimeOptions {
        computer_use_host: None,
        register_agent_apps: true,
        install_process_globals: true,
    })
    .await?;
    tracing::info!("Agentic system initialization complete");

    Ok(AgenticSystem {
        coordinator: runtime.coordinator,
        event_queue: runtime.event_queue,
    })
}
