//! Hidden PPT Live backend agent.

use super::Agent;
use async_trait::async_trait;

pub struct PptLiveAgent {
    default_tools: Vec<String>,
}

impl PptLiveAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                "WebFetch".to_string(),
                "WebSearch".to_string(),
            ],
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

    fn is_readonly(&self) -> bool {
        true
    }
}
