//! App Builder Agent
//!
//! A mode dedicated to designing, debugging, and evolving Sparo OS Product Apps.

use super::{Agent, RequestContextPolicy};
use async_trait::async_trait;

pub struct AppBuilderAgent {
    default_tools: Vec<String>,
}

impl Default for AppBuilderAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl AppBuilderAgent {
    pub fn new() -> Self {
        Self {
            default_tools: vec![
                // Briefing and progress
                "AskUserQuestion".to_string(),
                "TodoWrite".to_string(),
                // Domain knowledge is loaded on demand to avoid bloating the prompt.
                "Skill".to_string(),
                // Focused discovery and editing
                "Read".to_string(),
                "Grep".to_string(),
                "Glob".to_string(),
                "Write".to_string(),
                "Edit".to_string(),
                // Product App package workflow
                "CreateProductApp".to_string(),
                "CreateProductAppComponent".to_string(),
                "GetProductAppPackage".to_string(),
                "UpdateProductAppPackage".to_string(),
                "RefreshProductAppLock".to_string(),
                "ResolveBuilderPreviewTarget".to_string(),
                "CreateProductAppCheckpoint".to_string(),
                "CompareProductAppRevisions".to_string(),
                "RestoreProductAppCheckpoint".to_string(),
                "ValidateProductAppPackage".to_string(),
                "RunBuilderPreview".to_string(),
                // Review and verification
                "Task".to_string(),
            ],
        }
    }
}

#[async_trait]
impl Agent for AppBuilderAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        "AppBuilder"
    }

    fn name(&self) -> &str {
        "App Builder"
    }

    fn description(&self) -> &str {
        "App Builder: design, debug, and evolve Product Apps from a user goal"
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "app_builder_agent"
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

#[cfg(test)]
mod tests {
    use super::{Agent, AppBuilderAgent};

    #[test]
    fn default_tools_are_focused_on_product_app_delivery() {
        let agent = AppBuilderAgent::new();

        assert_eq!(
            agent.default_tools(),
            vec![
                "AskUserQuestion".to_string(),
                "TodoWrite".to_string(),
                "Skill".to_string(),
                "Read".to_string(),
                "Grep".to_string(),
                "Glob".to_string(),
                "Write".to_string(),
                "Edit".to_string(),
                "CreateProductApp".to_string(),
                "CreateProductAppComponent".to_string(),
                "GetProductAppPackage".to_string(),
                "UpdateProductAppPackage".to_string(),
                "RefreshProductAppLock".to_string(),
                "ResolveBuilderPreviewTarget".to_string(),
                "CreateProductAppCheckpoint".to_string(),
                "CompareProductAppRevisions".to_string(),
                "RestoreProductAppCheckpoint".to_string(),
                "ValidateProductAppPackage".to_string(),
                "RunBuilderPreview".to_string(),
                "Task".to_string(),
            ]
        );
    }

    #[test]
    fn default_tools_exclude_broad_or_destructive_surfaces() {
        let tools = AppBuilderAgent::new().default_tools();

        for excluded_tool in [
            "Delete",
            "WebSearch",
            "TerminalControl",
            "ControlHub",
            "GenerativeUI",
            "ComputerUse",
            "ListAgentComponents",
            "GetAgentComponent",
            "CreateAgentComponent",
            "UpdateAgentComponent",
            "ValidateAgentComponentPackage",
            "ListAgentComponentToolOptions",
            "CreateAgentComponentJsTool",
            "TestAgentComponentJsTool",
            "CreateComponentPackage",
            "ValidateComponentPackage",
            "ListBridgeComponents",
            "GetBridgeComponent",
            "CreateBridgeComponent",
            "UpdateBridgeComponent",
            "ValidateBridgeComponentPackage",
            "CreateBridgeComponentTemplate",
            "Bash",
        ] {
            assert!(
                !tools.contains(&excluded_tool.to_string()),
                "{excluded_tool} should not be a default App Builder tool"
            );
        }
    }
}
