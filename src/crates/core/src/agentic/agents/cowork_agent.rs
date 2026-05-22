//! Cowork Agent
//!
//! A collaborative mode that prioritizes early clarification and lightweight progress tracking.

use super::{Agent, RequestContextPolicy};
use async_trait::async_trait;

pub struct CoworkAgent {
    default_tools: Vec<String>,
}

impl Default for CoworkAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl CoworkAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                // Clarification + planning helpers
                "AskUserQuestion".to_string(),
                "TodoWrite".to_string(),
                "Task".to_string(),
                "Skill".to_string(),
                // Discovery + editing
                "LS".to_string(),
                "Read".to_string(),
                "Grep".to_string(),
                "Glob".to_string(),
                "Write".to_string(),
                "Edit".to_string(),
                "Delete".to_string(),
                "Memory".to_string(),
                // Utilities
                "GetFileDiff".to_string(),
                "Bash".to_string(),
                "TerminalControl".to_string(),
                "WebSearch".to_string(),
                "ControlHub".to_string(),
            ],
        }
    }
}

#[async_trait]
impl Agent for CoworkAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "Cowork"
    }

    fn name(&self) -> &str {
        "Cowork"
    }

    fn description(&self) -> &str {
        "Office and collaboration mode for documents, research, drafting, and structured multi-step work"
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "cowork_agent"
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
