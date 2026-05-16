use super::{Agent, RequestContextPolicy};
use crate::agentic::memory::store::MemoryScope;
use async_trait::async_trait;

pub struct HostScanAgent {
    default_tools: Vec<String>,
}

impl HostScanAgent {
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

impl Default for HostScanAgent {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Agent for HostScanAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "HostScanAgent"
    }

    fn name(&self) -> &str {
        "HostScanAgent"
    }

    fn description(&self) -> &str {
        "Hidden agent that scans the local host and maintains durable host routing guidance."
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "host_scan_agent"
    }

    fn request_context_policy(&self) -> RequestContextPolicy {
        RequestContextPolicy::empty().with_host_overview_context()
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
