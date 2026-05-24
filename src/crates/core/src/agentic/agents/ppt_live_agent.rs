//! Hidden PPT Live backend agent.

use super::{Agent, RequestContextPolicy};
use async_trait::async_trait;

pub struct PptLiveAgent {
    default_tools: Vec<String>,
}

impl PptLiveAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec!["Skill".to_string()],
        }
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
        "PptLive"
    }

    fn name(&self) -> &str {
        "PptLive"
    }

    fn description(&self) -> &str {
        "Hidden backend agent for PPT Live deck generation."
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "ppt_live_agent"
    }

    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }

    fn request_context_policy(&self) -> RequestContextPolicy {
        RequestContextPolicy::workspace_agent_default()
    }

    fn is_readonly(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ppt_live_agent_only_exposes_skill_tool() {
        let agent = PptLiveAgent::new();

        assert_eq!(agent.default_tools(), vec!["Skill".to_string()]);
    }
}
