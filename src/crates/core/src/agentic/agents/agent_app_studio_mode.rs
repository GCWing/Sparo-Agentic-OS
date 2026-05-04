//! Agent App Studio Mode

use super::Agent;
use async_trait::async_trait;

pub struct AgentAppStudioMode {
    default_tools: Vec<String>,
}

impl Default for AgentAppStudioMode {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentAppStudioMode {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                "AskUserQuestion".to_string(),
                "CreatePlan".to_string(),
                "ListAgentApps".to_string(),
                "GetAgentApp".to_string(),
                "CreateAgentApp".to_string(),
                "UpdateAgentApp".to_string(),
                "ValidateAgentAppPackage".to_string(),
                "ListAgentAppToolOptions".to_string(),
                "CreateAgentAppJsTool".to_string(),
                "TestAgentAppJsTool".to_string(),
                "Read".to_string(),
                "Grep".to_string(),
                "Glob".to_string(),
            ],
        }
    }
}

#[async_trait]
impl Agent for AgentAppStudioMode {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "AgentAppStudio"
    }

    fn name(&self) -> &str {
        "Agent App Studio"
    }

    fn description(&self) -> &str {
        "Professional builder for FlowChat-native Agent Apps with prompts, tools, permissions, examples, and JavaScript runtime tools"
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "agent_app_studio_mode"
    }

    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }

    fn is_readonly(&self) -> bool {
        false
    }
}
