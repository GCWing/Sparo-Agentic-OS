//! Agentic Agent

use super::{Agent, RequestContextPolicy};
use async_trait::async_trait;
pub struct AgenticAgent {
    default_tools: Vec<String>,
}

impl Default for AgenticAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl AgenticAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
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
impl Agent for AgenticAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "agentic"
    }

    fn name(&self) -> &str {
        "Prime Builder"
    }

    fn description(&self) -> &str {
        "Autonomous software development agent for coding, implementation, debugging, tests, and end-to-end application changes"
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "agentic_agent"
    }

    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }

    fn request_context_policy(&self) -> RequestContextPolicy {
        RequestContextPolicy::workspace_agent_default()
    }

    fn is_readonly(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::{Agent, AgenticAgent};

    #[test]
    fn always_uses_default_prompt_template() {
        let agent = AgenticAgent::new();
        assert_eq!(agent.prompt_template_name(Some("gpt-5.1")), "agentic_agent");
        assert_eq!(
            agent.prompt_template_name(Some("GPT-5-CODEX")),
            "agentic_agent"
        );
        assert_eq!(
            agent.prompt_template_name(Some("claude-sonnet-4")),
            "agentic_agent"
        );
        assert_eq!(agent.prompt_template_name(None), "agentic_agent");
    }
}
