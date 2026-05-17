use super::Agent;
use crate::agentic::memory::store::MemoryScope;
use async_trait::async_trait;

pub struct GlobalDailyReportAgent {
    default_tools: Vec<String>,
}

impl GlobalDailyReportAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                "Read".to_string(),
                "Glob".to_string(),
                "Grep".to_string(),
                "Write".to_string(),
                "Edit".to_string(),
            ],
        }
    }
}

impl Default for GlobalDailyReportAgent {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Agent for GlobalDailyReportAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "GlobalDailyReportAgent"
    }

    fn name(&self) -> &str {
        "GlobalDailyReportAgent"
    }

    fn description(&self) -> &str {
        "Hidden agent that compiles one global daily report from session daily summaries."
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "global_daily_report_agent"
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
