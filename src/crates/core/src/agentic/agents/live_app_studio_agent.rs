//! Live App Studio Agent
//!
//! A mode dedicated to building, debugging, and evolving Sparo OS Live Apps.

use super::{Agent, RequestContextPolicy};
use async_trait::async_trait;

pub struct LiveAppStudioAgent {
    default_tools: Vec<String>,
}

impl Default for LiveAppStudioAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl LiveAppStudioAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                // Briefing and progress
                "AskUserQuestion".to_string(),
                "TodoWrite".to_string(),
                // Domain knowledge is loaded on demand to avoid bloating the prompt.
                "Skill".to_string(),
                // Focused discovery and editing
                "Read".to_string(),
                "Grep".to_string(),
                "Glob".to_string(),
                "Write".to_string(),
                "Edit".to_string(),
                // Live App workflow
                "InitLiveApp".to_string(),
                "LiveAppRecompile".to_string(),
                "LiveAppRuntimeProbe".to_string(),
                "LiveAppClearRuntimeIssues".to_string(),
                "LiveAppScreenshotMatrix".to_string(),
                // Review and verification
                "Task".to_string(),
                "Bash".to_string(),
            ],
        }
    }
}

#[async_trait]
impl Agent for LiveAppStudioAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "LiveAppStudio"
    }

    fn name(&self) -> &str {
        "Live App Studio"
    }

    fn description(&self) -> &str {
        "Live App Studio: build, debug, and evolve Live Apps from a single sentence"
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "live_app_studio_agent"
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
    use super::{Agent, LiveAppStudioAgent};

    #[test]
    fn default_tools_are_focused_on_live_app_delivery() {
        let agent = LiveAppStudioAgent::new();

        assert_eq!(
            agent.default_tools(),
            vec![
                "AskUserQuestion".to_string(),
                "TodoWrite".to_string(),
                "Skill".to_string(),
                "Read".to_string(),
                "Grep".to_string(),
                "Glob".to_string(),
                "Write".to_string(),
                "Edit".to_string(),
                "InitLiveApp".to_string(),
                "LiveAppRecompile".to_string(),
                "LiveAppRuntimeProbe".to_string(),
                "LiveAppClearRuntimeIssues".to_string(),
                "LiveAppScreenshotMatrix".to_string(),
                "Task".to_string(),
                "Bash".to_string(),
            ]
        );
    }

    #[test]
    fn default_tools_exclude_broad_or_destructive_surfaces() {
        let tools = LiveAppStudioAgent::new().default_tools();

        for excluded_tool in [
            "Delete",
            "WebSearch",
            "TerminalControl",
            "ControlHub",
            "GenerativeUI",
            "ComputerUse",
        ] {
            assert!(
                !tools.contains(&excluded_tool.to_string()),
                "{excluded_tool} should not be a default Live App Studio tool"
            );
        }
    }
}
