use super::{Agent, RequestContextPolicy};
use crate::agentic::memory::store::MemoryScope;
use async_trait::async_trait;

pub struct DailyLetterWriterAgent {
    default_tools: Vec<String>,
}

impl DailyLetterWriterAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                "LS".to_string(),
                "Read".to_string(),
                "Glob".to_string(),
                "Grep".to_string(),
            ],
        }
    }
}

impl Default for DailyLetterWriterAgent {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Agent for DailyLetterWriterAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "DailyLetterWriter"
    }

    fn name(&self) -> &str {
        "DailyLetterWriter"
    }

    fn description(&self) -> &str {
        "Hidden agent that writes a structured daily letter from a system-provided context packet."
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "daily_letter_writer"
    }

    fn request_context_policy(&self) -> RequestContextPolicy {
        RequestContextPolicy::empty()
    }

    fn memory_scope(&self) -> MemoryScope {
        MemoryScope::GlobalAgenticOs
    }

    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }

    fn is_readonly(&self) -> bool {
        true
    }
}
