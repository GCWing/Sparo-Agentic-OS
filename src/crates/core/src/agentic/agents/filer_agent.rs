use super::{Agent, RequestContextPolicy};
use async_trait::async_trait;

pub struct FilerAgent {
    default_tools: Vec<String>,
}

impl Default for FilerAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl FilerAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                "LS".to_string(),
                "FileContextRead".to_string(),
                "FileOperationPlan".to_string(),
                "Read".to_string(),
                "Grep".to_string(),
                "Glob".to_string(),
                "Edit".to_string(),
                "Write".to_string(),
                "Bash".to_string(),
                "Task".to_string(),
            ],
        }
    }
}

#[async_trait]
impl Agent for FilerAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "Filer"
    }

    fn name(&self) -> &str {
        "Filer"
    }

    fn description(&self) -> &str {
        "General-purpose file system agent for local files and folders: find, inspect, summarize, rename, move, organize, classify, deduplicate, clean up, and archive. Prefers search-first workflows and previews destructive changes before applying them."
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "filer_agent"
    }

    fn default_tools(&self) -> Vec<String> {
        self.default_tools.clone()
    }

    fn request_context_policy(&self) -> RequestContextPolicy {
        RequestContextPolicy::default().with_files_context()
    }

    fn is_readonly(&self) -> bool {
        false
    }
}
