//! Computer Use sub-agent
//!
//! Dedicated agent for perceiving and operating the user's local computer.

use super::Agent;
use async_trait::async_trait;

pub struct ComputerUseAgent {
    default_tools: Vec<String>,
}

impl Default for ComputerUseAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl ComputerUseAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                "AskUserQuestion".to_string(),
                "TodoWrite".to_string(),
                "Skill".to_string(),
                "Bash".to_string(),
                "TerminalControl".to_string(),
                "ControlHub".to_string(),
                "ComputerUse".to_string(),
            ],
        }
    }
}

#[async_trait]
impl Agent for ComputerUseAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "ComputerUse"
    }

    fn name(&self) -> &str {
        "Computer Use"
    }

    fn description(&self) -> &str {
        "Dedicated desktop automation agent for perceiving the local environment and operating apps, browsers, and OS UI"
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "computer_use_agent"
    }

    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }

    fn is_readonly(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::{Agent, ComputerUseAgent};

    #[test]
    fn computer_use_agent_basics() {
        let agent = ComputerUseAgent::new();
        assert_eq!(agent.id(), "ComputerUse");
        assert_eq!(agent.name(), "Computer Use");
        assert_eq!(agent.prompt_template_name(None), "computer_use_agent");
        assert!(agent.default_tools().contains(&"ControlHub".to_string()));
        assert!(agent.default_tools().contains(&"ComputerUse".to_string()));
        assert!(!agent.default_tools().contains(&"Write".to_string()));
        assert!(!agent.is_readonly());
    }
}
