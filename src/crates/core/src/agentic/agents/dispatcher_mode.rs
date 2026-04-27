//! Dispatcher Mode — Agentic OS top-level executive companion
use super::{Agent, RequestContextPolicy};
use crate::service::memory_store::MemoryScope;
use async_trait::async_trait;

pub struct DispatcherMode {
    default_tools: Vec<String>,
}

impl Default for DispatcherMode {
    fn default() -> Self {
        Self::new()
    }
}

impl DispatcherMode {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                // Delegation tool for specialized agent work
                "AgentDispatch".to_string(),
                // Communicate with existing sessions
                "SessionMessage".to_string(),
                "SessionHistory".to_string(),
                // Information gathering - read-only file access
                "Read".to_string(),
                "Glob".to_string(),
                "Grep".to_string(),
                // Command execution for environment inspection
                "Bash".to_string(),
                // Web research
                "WebSearch".to_string(),
                "WebFetch".to_string(),
                // Structured thinking and task tracking
                "TodoWrite".to_string(),
                // Clarification
                "AskUserQuestion".to_string(),
                // Forked auto-memory agents use these tools to update memory
                "Write".to_string(),
                "Edit".to_string(),
                "Delete".to_string(),
            ],
        }
    }
}

#[async_trait]
impl Agent for DispatcherMode {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "Dispatcher"
    }

    fn name(&self) -> &str {
        "Executive Companion"
    }

    fn description(&self) -> &str {
        "Sparo Agentic OS top-level executive companion: helps the user think, decide, organize, delegate, track, and close the loop with professional judgment and long-term continuity"
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "dispatcher_mode"
    }

    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }

    fn request_context_policy(&self) -> RequestContextPolicy {
        RequestContextPolicy::empty()
            .with_workspace_instructions()
            .with_recent_workspaces()
            .with_memory_scope(MemoryScope::GlobalAgenticOs)
            .with_global_workspace_overviews()
    }

    fn memory_scope(&self) -> MemoryScope {
        MemoryScope::GlobalAgenticOs
    }

    fn is_readonly(&self) -> bool {
        false
    }
}
