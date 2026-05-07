use super::Agent;
use crate::agentic::memory::store::MemoryScope;
use async_trait::async_trait;

pub struct GlobalMemoryConsolidatorAgent {
    default_tools: Vec<String>,
}

impl GlobalMemoryConsolidatorAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                "LS".to_string(),
                "Read".to_string(),
                "Glob".to_string(),
                "Grep".to_string(),
                "Write".to_string(),
                "Edit".to_string(),
            ],
        }
    }
}

impl Default for GlobalMemoryConsolidatorAgent {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Agent for GlobalMemoryConsolidatorAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "GlobalMemoryConsolidator"
    }

    fn name(&self) -> &str {
        "GlobalMemoryConsolidator"
    }

    fn description(&self) -> &str {
        "Hidden agent that consolidates global memory journals into durable memory files."
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "global_memory_consolidator"
    }

    fn memory_scope(&self) -> MemoryScope {
        MemoryScope::GlobalAgenticOs
    }

    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }

    fn is_readonly(&self) -> bool {
        false
    }
}
