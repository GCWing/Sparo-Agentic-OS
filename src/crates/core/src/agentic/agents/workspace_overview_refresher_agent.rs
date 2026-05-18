use super::Agent;
use crate::agentic::memory::store::MemoryScope;
use async_trait::async_trait;

pub struct WorkspaceOverviewRefresherAgent {
    default_tools: Vec<String>,
}

impl WorkspaceOverviewRefresherAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                "Read".to_string(),
                "Glob".to_string(),
                "Grep".to_string(),
                "Write".to_string(),
                "Edit".to_string(),
                "Bash".to_string(),
            ],
        }
    }
}

impl Default for WorkspaceOverviewRefresherAgent {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Agent for WorkspaceOverviewRefresherAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "WorkspaceOverviewRefresher"
    }

    fn name(&self) -> &str {
        "WorkspaceOverviewRefresher"
    }

    fn description(&self) -> &str {
        "Hidden agent that refreshes workspace routing overview files for future delegation."
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "workspace_overview_refresher"
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
