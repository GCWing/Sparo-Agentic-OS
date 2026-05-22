use super::{Agent, RequestContextPolicy};
use async_trait::async_trait;

pub struct FilesAgent {
    default_tools: Vec<String>,
}

impl Default for FilesAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl FilesAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                "LS".to_string(),
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
impl Agent for FilesAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "Files"
    }

    fn name(&self) -> &str {
        "Files"
    }

    fn description(&self) -> &str {
        "Agent for system-level file and folder reasoning and operations: find, summarize, rename, organize, classify, and archive. Prefers search-first workflows and delegates wide exploration to FileFinder."
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "files_agent"
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
