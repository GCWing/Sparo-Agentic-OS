use super::{Agent, RequestContextPolicy};
use crate::agentic::memory::store::MemoryScope;
use async_trait::async_trait;

/// Internal agent that translates user intent into catalog-backed configuration transactions.
pub struct SettingsAgent;

impl SettingsAgent {
    pub const ID: &'static str = "SettingsAgent";
    pub const CATALOG_TOOL: &'static str = "SettingsCatalog";
    pub const CHANGE_TOOL: &'static str = "SettingsChange";

    pub fn new() -> Self {
        Self
    }
}

impl Default for SettingsAgent {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Agent for SettingsAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        Self::ID
    }

    fn name(&self) -> &str {
        Self::ID
    }

    fn description(&self) -> &str {
        "Hidden agent that plans and applies catalog-backed Sparo OS settings changes."
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        "settings_agent"
    }

    fn request_context_policy(&self) -> RequestContextPolicy {
        RequestContextPolicy::empty()
    }

    fn memory_scope(&self) -> MemoryScope {
        MemoryScope::GlobalAgenticOs
    }

    fn default_tools(&self) -> Vec<String> {
        vec![
            Self::CATALOG_TOOL.to_string(),
            Self::CHANGE_TOOL.to_string(),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_only_the_two_settings_tools() {
        let agent = SettingsAgent::new();
        assert_eq!(
            agent.default_tools(),
            vec!["SettingsCatalog".to_string(), "SettingsChange".to_string()]
        );
    }
}
