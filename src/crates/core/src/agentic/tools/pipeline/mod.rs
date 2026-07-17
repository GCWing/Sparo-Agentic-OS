//! Tool pipeline module
//!
//! Provides complete lifecycle management for tool execution

pub mod state_manager;
pub mod tool_pipeline;
pub mod types;

pub use state_manager::*;
pub use tool_pipeline::*;
pub use types::*;

pub(crate) fn tool_error_requires_publication(agent_type: &str) -> bool {
    agent_type == crate::agentic::agents::SettingsAgent::ID
}

pub(crate) fn published_tool_error_for_agent(agent_type: &str, error: &str) -> String {
    if tool_error_requires_publication(agent_type) {
        sparo_events::published_settings_agent_error_code(error).to_string()
    } else {
        error.to_string()
    }
}

#[cfg(test)]
mod public_error_tests {
    use super::{published_tool_error_for_agent, tool_error_requires_publication};

    #[test]
    fn settings_tool_errors_are_stable_while_ordinary_tool_errors_are_unchanged() {
        let sensitive = "config.revision_conflict at C:\\private\\app.json: token=secret";

        let settings_error = published_tool_error_for_agent("SettingsAgent", sensitive);
        assert_eq!(settings_error, "config.revision_conflict");
        assert!(!settings_error.contains("private"));
        assert!(!settings_error.contains("secret"));
        assert!(tool_error_requires_publication("SettingsAgent"));

        assert_eq!(
            published_tool_error_for_agent("Runno", sensitive),
            sensitive
        );
        assert!(!tool_error_requires_publication("Runno"));
    }
}
