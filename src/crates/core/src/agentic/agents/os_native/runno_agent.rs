//! Runno Agent

use super::{Agent, RequestContextPolicy};
use async_trait::async_trait;

pub struct RunnoAgent {
    default_tools: Vec<String>,
}

impl Default for RunnoAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl RunnoAgent {
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
impl Agent for RunnoAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "Runno"
    }

    fn name(&self) -> &str {
        "Runno"
    }

    fn description(&self) -> &str {
        "OS-native general execution agent for turning goals into planned, executed, and verified results"
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "runno_agent"
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
    use super::{Agent, RunnoAgent};

    #[test]
    fn runno_agent_identity_is_native_execution() {
        let agent = RunnoAgent::new();
        assert_eq!(agent.id(), "Runno");
        assert_eq!(agent.name(), "Runno");
        assert_eq!(agent.prompt_template_name(None), "runno_agent");
        assert!(!agent.is_readonly());
    }
}
