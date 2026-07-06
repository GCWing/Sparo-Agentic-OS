//! Plan mode for BitFun Coder

use super::{Agent, RequestContextPolicy};
use async_trait::async_trait;
pub struct BitFunPlanAgent {
    default_tools: Vec<String>,
    id: &'static str,
    name: &'static str,
    description: &'static str,
}

impl Default for BitFunPlanAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl BitFunPlanAgent {
    pub fn new() -> Self {
        Self::with_identity(
            "bitfun-plan",
            "Plan",
            "Plan mode for clarifying requests and creating implementation plans inside BitFun Coder",
        )
    }

    fn with_identity(id: &'static str, name: &'static str, description: &'static str) -> Self {
        Self {
            default_tools: vec![
                "Task".to_string(),
                "LS".to_string(),
                "Read".to_string(),
                "Write".to_string(),
                "Edit".to_string(),
                "Memory".to_string(),
                "Grep".to_string(),
                "Glob".to_string(),
                "AskUserQuestion".to_string(),
                "CreatePlan".to_string(),
                "ControlHub".to_string(),
            ],
            id,
            name,
            description,
        }
    }
}

#[async_trait]
impl Agent for BitFunPlanAgent {
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
        "bitfun_plan_agent"
    }

    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }

    fn request_context_policy(&self) -> RequestContextPolicy {
        RequestContextPolicy::empty()
            .with_workspace_instructions()
            .with_project_layout()
    }

    fn is_readonly(&self) -> bool {
        // only modify plan file, not modify project code
        true
    }
}
