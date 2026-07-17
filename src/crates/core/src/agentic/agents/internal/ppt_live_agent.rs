use super::{Agent, RequestContextPolicy};
use crate::agentic::memory::store::MemoryScope;
use async_trait::async_trait;

/// Hidden Product App agent that orchestrates PPT Live creation and revision.
pub struct PptLiveAgent;

impl PptLiveAgent {
    pub const ID: &'static str = "PptLiveAgent";

    pub fn new() -> Self {
        Self
    }
}

impl Default for PptLiveAgent {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Agent for PptLiveAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        Self::ID
    }

    fn name(&self) -> &str {
        Self::ID
    }

    fn description(&self) -> &str {
        "Hidden Product App agent for PPT Live manuscript and visual-deck orchestration."
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "ppt_live_agent"
    }

    fn request_context_policy(&self) -> RequestContextPolicy {
        RequestContextPolicy::empty()
    }

    fn memory_scope(&self) -> MemoryScope {
        MemoryScope::GlobalAgenticOs
    }

    fn default_tools(&self) -> Vec<String> {
        vec![
            "Skill".to_string(),
            "WebSearch".to_string(),
            "WebFetch".to_string(),
        ]
    }

    fn is_readonly(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_and_prompt_are_product_app_specific() {
        let agent = PptLiveAgent::new();
        assert_eq!(agent.id(), "PptLiveAgent");
        assert_eq!(agent.name(), "PptLiveAgent");
        assert_eq!(agent.prompt_template_name(None), "ppt_live_agent");
        assert!(agent.is_readonly());
    }

    #[test]
    fn exposes_only_presentation_design_and_read_only_research_tools() {
        let agent = PptLiveAgent::new();
        assert_eq!(
            agent.default_tools(),
            vec![
                "Skill".to_string(),
                "WebSearch".to_string(),
                "WebFetch".to_string(),
            ]
        );
        for forbidden in ["Bash", "Write", "Edit", "Delete", "ComputerUse", "Task"] {
            assert!(!agent.default_tools().iter().any(|tool| tool == forbidden));
        }
    }
}
