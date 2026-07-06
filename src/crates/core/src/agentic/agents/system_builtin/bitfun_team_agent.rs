//! Team mode for BitFun Coder — Virtual engineering team powered by gstack skills
//!
//! Orchestrates a full software development sprint through specialized roles:
//! Think → Plan → Build → Review → Test → Ship

use super::{Agent, RequestContextPolicy};
use async_trait::async_trait;

pub struct BitFunTeamAgent {
    default_tools: Vec<String>,
    id: &'static str,
    name: &'static str,
    description: &'static str,
}

impl Default for BitFunTeamAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl BitFunTeamAgent {
    pub fn new() -> Self {
        Self::with_identity(
            "bitfun-team",
            "Team",
            "Team mode for coordinating specialized software delivery roles inside BitFun Coder",
        )
    }

    fn with_identity(id: &'static str, name: &'static str, description: &'static str) -> Self {
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
            id,
            name,
            description,
        }
    }
}

#[async_trait]
impl Agent for BitFunTeamAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        self.id
    }

    fn name(&self) -> &str {
        self.name
    }

    fn description(&self) -> &str {
        self.description
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "bitfun_team_agent"
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
    use super::{Agent, BitFunTeamAgent};

    #[test]
    fn bitfun_team_agent_identity_is_product_app_specific() {
        let agent = BitFunTeamAgent::new();
        assert_eq!(agent.id(), "bitfun-team");
        assert_eq!(agent.name(), "Team");
        assert_eq!(agent.prompt_template_name(None), "bitfun_team_agent");
        assert!(!agent.is_readonly());
        assert!(agent.default_tools().contains(&"Skill".to_string()));
    }
}
