//! SettingsAgent desktop adapter.

use crate::api::command_error::{public_settings_agent_error, PublicCommandError};
use std::sync::Arc;

use sparo_core::agentic::coordination::ConversationCoordinator;
use sparo_core::command::settings_agent as core_settings_agent;
use tauri::State;

pub use core_settings_agent::{ResetSettingsFlowSessionRequest, SettingsFlowSessionResponse};

#[tauri::command]
pub async fn ensure_settings_flow_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
) -> Result<SettingsFlowSessionResponse, PublicCommandError> {
    core_settings_agent::ensure_settings_flow_session(coordinator.inner())
        .await
        .map_err(|error| {
            let public_error = public_settings_agent_error(&error);
            log::error!(
                "Failed to ensure SettingsAgent FlowChat session: error_code={}",
                public_error.code()
            );
            public_error
        })
}

#[tauri::command]
pub async fn reset_settings_flow_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: ResetSettingsFlowSessionRequest,
) -> Result<SettingsFlowSessionResponse, PublicCommandError> {
    core_settings_agent::reset_settings_flow_session(coordinator.inner(), request)
        .await
        .map_err(|error| {
            let public_error = public_settings_agent_error(&error);
            log::error!(
                "Failed to reset SettingsAgent FlowChat session: error_code={}",
                public_error.code()
            );
            public_error
        })
}
