//! BitFun Coder Agent

use super::{Agent, RequestContextPolicy};
use async_trait::async_trait;

pub struct BitFunCoderAgent {
    default_tools: Vec<String>,
}

impl Default for BitFunCoderAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl BitFunCoderAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                "Goal".to_string(),
                "Task".to_string(),
                "Read".to_string(),
                "Write".to_string(),
                "Edit".to_string(),
                "Delete".to_string(),
                "Memory".to_string(),
                "Bash".to_string(),
                "Grep".to_string(),
                "Glob".to_string(),
                "WebSearch".to_string(),
                "TodoWrite".to_string(),
                "GenerativeUI".to_string(),
                "Skill".to_string(),
                "AskUserQuestion".to_string(),
                "TerminalControl".to_string(),
                "ControlHub".to_string(),
            ],
        }
    }
}

#[async_trait]
impl Agent for BitFunCoderAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "bitfun-coder"
    }

    fn name(&self) -> &str {
        "BitFun Coder"
    }

    fn description(&self) -> &str {
        "Professional coding Product App agent for implementation, debugging, automation, and verification"
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "bitfun_coder_agent"
    }

    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }

    fn request_context_policy(&self) -> RequestContextPolicy {
        RequestContextPolicy::workspace_agent_default().with_files_context()
    }

    fn is_readonly(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::{Agent, BitFunCoderAgent};

    #[test]
    fn bitfun_coder_agent_identity_is_product_app_specific() {
        let agent = BitFunCoderAgent::new();
        assert_eq!(agent.id(), "bitfun-coder");
        assert_eq!(agent.name(), "BitFun Coder");
        assert_eq!(agent.prompt_template_name(None), "bitfun_coder_agent");
        assert!(!agent.is_readonly());
    }
}
