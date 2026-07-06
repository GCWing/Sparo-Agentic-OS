use super::Agent;
use crate::agentic::memory::store::MemoryScope;
use async_trait::async_trait;

pub struct WorkspaceMemoryConsolidatorAgent {
    default_tools: Vec<String>,
}

impl WorkspaceMemoryConsolidatorAgent {
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

impl Default for WorkspaceMemoryConsolidatorAgent {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Agent for WorkspaceMemoryConsolidatorAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "WorkspaceMemoryConsolidator"
    }

    fn name(&self) -> &str {
        "WorkspaceMemoryConsolidator"
    }

    fn description(&self) -> &str {
        "Hidden agent that consolidates workspace memory journals into durable memory files."
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "workspace_memory_consolidator"
    }

    fn memory_scope(&self) -> MemoryScope {
        MemoryScope::WorkspaceProject
    }

    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }

    fn is_readonly(&self) -> bool {
        false
    }
}
