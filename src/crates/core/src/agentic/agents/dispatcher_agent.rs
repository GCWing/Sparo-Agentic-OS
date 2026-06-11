//! Dispatcher Agent — Agentic OS top-level executive companion
use super::{Agent, RequestContextPolicy};
use crate::agentic::memory::store::MemoryScope;
use async_trait::async_trait;

pub struct DispatcherAgent {
    default_tools: Vec<String>,
}

impl Default for DispatcherAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl DispatcherAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                // Agentic OS Work management
                "Work".to_string(),
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
                // Durable memory
                "Memory".to_string(),
            ],
        }
    }
}

#[async_trait]
impl Agent for DispatcherAgent {
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
        "dispatcher_agent"
    }

    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }

    fn request_context_policy(&self) -> RequestContextPolicy {
        RequestContextPolicy::empty()
            .with_workspace_instructions()
            .with_workspace_routing_context()
            .with_host_overview_context()
            .with_memory_scope(MemoryScope::GlobalAgenticOs)
    }

    fn memory_scope(&self) -> MemoryScope {
        MemoryScope::GlobalAgenticOs
    }

    fn is_readonly(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatcher_uses_work_tools_for_managed_work() {
        let tools = DispatcherAgent::new().default_tools();
        assert!(tools.contains(&"Work".to_string()));
        assert!(!tools.contains(&"WorkRead".to_string()));
        assert!(!tools.contains(&"WorkStart".to_string()));
        assert!(!tools.contains(&"WorkAdvance".to_string()));
        assert!(!tools.contains(&"WorkControl".to_string()));
        assert!(!tools.contains(&"WorkMutation".to_string()));
        assert!(!tools.contains(&"WorkDispatch".to_string()));
        assert!(!tools.contains(&"AgentDispatch".to_string()));
        assert!(!tools.contains(&"SessionMessage".to_string()));
        assert!(!tools.contains(&"SessionHistory".to_string()));
    }

    #[test]
    fn dispatcher_prompt_describes_work_first_execution() {
        let prompt = include_str!("prompts/dispatcher_agent.md");

        assert!(!prompt.contains("AgentDispatch"));
        assert!(prompt.contains("Work(action=\"start\")"));
        assert!(prompt.contains("Work(action=\"continue\")"));
        assert!(prompt.contains("Work(action=\"status\")"));
        assert!(!prompt.contains("WorkDispatch(action=\"dispatch_new\")"));
        assert!(prompt.contains("There is only one Work tool"));
        assert!(prompt.contains("Continue by `work_id`, never by `session_id`"));
    }
}
