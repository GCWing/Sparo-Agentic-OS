//! Agent system for Sparo OS
//!
//! Provides flexible agent selection with different system prompts and tool sets

mod custom_subagents;
mod delegates;
mod internal;
mod os_native;
mod prompt_builder;
mod registry;
mod system_builtin;

use crate::agentic::memory::store::MemoryScope;
use crate::error::{CoreError, CoreResult};
use async_trait::async_trait;
pub use custom_subagents::{CustomSubagent, CustomSubagentKind};
pub use delegates::{
    ComputerUseAgent, DesignReviewAgent, ExploreAgent, FileFinderAgent, OutcomeReviewAgent,
};
pub use internal::{
    CodeReviewAgent, DailyLetterWriterAgent, FilerAgent, GenerateDocAgent, GlobalDailyReportAgent,
    GlobalMemoryConsolidatorAgent, GlobalMilestoneAgent, HostScanAgent, InitAgent, SettingsAgent,
    WorkspaceMemoryConsolidatorAgent, WorkspaceOverviewRefresherAgent,
};
pub use os_native::{AppBuilderAgent, OsAgent, RunnoAgent};
pub use prompt_builder::{
    PromptBuilder, PromptBuilderContext, RemoteExecutionHints, RequestContextPolicy,
    RequestContextSection,
};
pub use registry::{
    get_agent_registry, AgentCategory, AgentInfo, AgentRegistry, CustomSubagentConfig,
    CustomSubagentDetail, SubAgentSource,
};
use std::any::Any;
pub use system_builtin::{
    BitFunCoderAgent, BitFunDebugAgent, BitFunPlanAgent, BitFunTeamAgent, CoworkAgent,
    DeepResearchAgent, DesignAgent,
};

// Include embedded prompts generated at compile time
include!(concat!(env!("OUT_DIR"), "/embedded_agents_prompt.rs"));

/// Agent trait defining the interface for all agents
#[async_trait]
pub trait Agent: Send + Sync + 'static {
    /// downcast to specific type
    fn as_any(&self) -> &dyn Any;

    /// Unique identifier for the agent
    fn id(&self) -> &str;

    /// Human-readable name
    fn name(&self) -> &str;

    /// Description of what the agent does
    fn description(&self) -> &str;

    /// Prompt template name for the agent.
    fn prompt_template_name(&self, model_name: Option<&str>) -> &str;

    fn system_reminder_template_name(&self) -> Option<&str> {
        None // by default, no system reminder
    }

    fn request_context_policy(&self) -> RequestContextPolicy {
        RequestContextPolicy::default()
    }

    fn memory_scope(&self) -> MemoryScope {
        MemoryScope::WorkspaceProject
    }

    /// Build the system prompt for this agent
    async fn build_prompt(&self, context: &PromptBuilderContext) -> CoreResult<String> {
        let prompt_components = PromptBuilder::new(context.clone());
        let template_name = self.prompt_template_name(context.model_name.as_deref());
        let system_prompt_template = get_embedded_prompt(template_name).ok_or_else(|| {
            CoreError::Agent(format!("{} not found in embedded files", template_name))
        })?;

        let prompt = prompt_components
            .build_prompt_from_template(system_prompt_template)
            .await?;

        Ok(prompt)
    }

    /// Get the system prompt for this agent
    async fn get_system_prompt(
        &self,
        context: Option<&PromptBuilderContext>,
    ) -> CoreResult<String> {
        if let Some(context) = context {
            self.build_prompt(context).await
        } else {
            Err(CoreError::Agent(
                "Prompt build context is required".to_string(),
            ))
        }
    }

    /// Get the system reminder for this agent when an agent needs turn-level guidance.
    /// system_reminder will be appended to the user_query
    /// This is not necessary for all agents.
    async fn get_system_reminder(&self, _index: usize) -> CoreResult<String> {
        if let Some(system_reminder_template_name) = self.system_reminder_template_name() {
            let system_reminder =
                get_embedded_prompt(system_reminder_template_name).ok_or_else(|| {
                    CoreError::Agent(format!(
                        "{} not found in embedded files",
                        system_reminder_template_name
                    ))
                })?;
            Ok(system_reminder.to_string())
        } else {
            Ok("".to_string())
        }
    }

    /// Get the list of default tools for this agent
    fn default_tools(&self) -> Vec<String>;

    /// Whether this agent is read-only (prevents file modifications)
    fn is_readonly(&self) -> bool {
        false
    }
}
