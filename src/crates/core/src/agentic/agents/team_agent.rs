//! Team Agent — Virtual engineering team powered by gstack skills
//!
//! Orchestrates a full software development sprint through specialized roles:
//! Think → Plan → Build → Review → Test → Ship

use super::{Agent, RequestContextPolicy};
use async_trait::async_trait;

pub struct TeamAgent {
    default_tools: Vec<String>,
}

impl Default for TeamAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl TeamAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                "Skill".to_string(),
                "Task".to_string(),
                "Read".to_string(),
                "Write".to_string(),
                "Edit".to_string(),
                "Delete".to_string(),
                "Bash".to_string(),
                "Grep".to_string(),
                "Glob".to_string(),
                "WebSearch".to_string(),
                "WebFetch".to_string(),
                "TodoWrite".to_string(),
                "AskUserQuestion".to_string(),
                "Git".to_string(),
                "TerminalControl".to_string(),
                "ControlHub".to_string(),
                "GetFileDiff".to_string(),
            ],
        }
    }
}

#[async_trait]
impl Agent for TeamAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "Team"
    }

    fn name(&self) -> &str {
        "Team"
    }

    fn description(&self) -> &str {
        "Virtual engineering team: CEO, Eng Manager, Designer, Code Reviewer, QA Lead, Security Officer, Release Engineer — orchestrated through a full sprint workflow"
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "team_agent"
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
    use super::{Agent, TeamAgent};

    #[test]
    fn team_agent_basics() {
        let agent = TeamAgent::new();
        assert_eq!(agent.id(), "Team");
        assert_eq!(agent.prompt_template_name(None), "team_agent");
        assert!(!agent.is_readonly());
        assert!(agent.default_tools().contains(&"Skill".to_string()));
    }
}
