//! Component Studio Agent

use super::{Agent, RequestContextPolicy};
use async_trait::async_trait;

pub struct ComponentStudioAgent {
    default_tools: Vec<String>,
}

impl Default for ComponentStudioAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl ComponentStudioAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                "AskUserQuestion".to_string(),
                "CreatePlan".to_string(),
                "CreateComponentPackage".to_string(),
                "ListAgentComponents".to_string(),
                "GetAgentComponent".to_string(),
                "CreateAgentComponent".to_string(),
                "UpdateAgentComponent".to_string(),
                "ValidateAgentComponentPackage".to_string(),
                "ListAgentComponentToolOptions".to_string(),
                "CreateAgentComponentJsTool".to_string(),
                "TestAgentComponentJsTool".to_string(),
                "Read".to_string(),
                "Grep".to_string(),
                "Glob".to_string(),
            ],
        }
    }
}

#[async_trait]
impl Agent for ComponentStudioAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "ComponentStudio"
    }

    fn name(&self) -> &str {
        "Component Studio"
    }

    fn description(&self) -> &str {
        "Professional builder for reusable Sparo components with prompts, tools, permissions, examples, and runtime adapters"
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "component_studio_agent"
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
