//! Agent system for Sparo OS
//!
//! Provides flexible agent selection with different system prompts and tool sets

mod custom_subagents;
mod prompt_builder;
mod registry;
// Launchable agents
mod agent_app_studio_agent;
mod agentic_agent;
mod computer_use_agent;
mod cowork_agent;
mod debug_agent;
mod design_agent;
mod design_review_agent;
mod dispatcher_agent;
mod live_app_studio_agent;
mod plan_agent;
mod team_agent;
// Built-in subagents
mod deep_research_agent;
mod explore_agent;
mod file_finder_agent;
// Hidden agents
mod code_review_agent;
mod generate_doc_agent;
mod global_daily_report_agent;
mod global_memory_consolidator_agent;
mod global_milestone_agent;
mod host_scan_agent;
mod init_agent;
mod workspace_memory_consolidator_agent;
mod workspace_overview_refresher_agent;

use crate::agentic::memory::store::MemoryScope;
use crate::util::errors::{BitFunError, BitFunResult};
pub use agent_app_studio_agent::AgentAppStudioAgent;
pub use agentic_agent::AgenticAgent;
use async_trait::async_trait;
pub use code_review_agent::CodeReviewAgent;
pub use computer_use_agent::ComputerUseAgent;
pub use cowork_agent::CoworkAgent;
pub use custom_subagents::{CustomSubagent, CustomSubagentKind};
pub use debug_agent::DebugAgent;
pub use deep_research_agent::DeepResearchAgent;
pub use design_agent::DesignAgent;
pub use design_review_agent::DesignReviewAgent;
pub use dispatcher_agent::DispatcherAgent;
pub use explore_agent::ExploreAgent;
pub use file_finder_agent::FileFinderAgent;
pub use generate_doc_agent::GenerateDocAgent;
pub use global_daily_report_agent::GlobalDailyReportAgent;
pub use global_memory_consolidator_agent::GlobalMemoryConsolidatorAgent;
pub use global_milestone_agent::GlobalMilestoneAgent;
pub use host_scan_agent::HostScanAgent;
pub use init_agent::InitAgent;
pub use live_app_studio_agent::LiveAppStudioAgent;
pub use plan_agent::PlanAgent;
pub use prompt_builder::{
    PromptBuilder, PromptBuilderContext, RemoteExecutionHints, RequestContextPolicy,
    RequestContextSection,
};
pub use registry::{
    get_agent_registry, AgentCategory, AgentInfo, AgentRegistry, CustomSubagentConfig,
    CustomSubagentDetail, SubAgentSource,
};
use std::any::Any;
pub use team_agent::TeamAgent;
pub use workspace_memory_consolidator_agent::WorkspaceMemoryConsolidatorAgent;
pub use workspace_overview_refresher_agent::WorkspaceOverviewRefresherAgent;

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
    async fn build_prompt(&self, context: &PromptBuilderContext) -> BitFunResult<String> {
        let prompt_components = PromptBuilder::new(context.clone());
        let template_name = self.prompt_template_name(context.model_name.as_deref());
        let system_prompt_template = get_embedded_prompt(template_name).ok_or_else(|| {
            BitFunError::Agent(format!("{} not found in embedded files", template_name))
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
    ) -> BitFunResult<String> {
        if let Some(context) = context {
            self.build_prompt(context).await
        } else {
            Err(BitFunError::Agent(
                "Prompt build context is required".to_string(),
            ))
        }
    }

    /// Get the system reminder for this agent when an agent needs turn-level guidance.
    /// system_reminder will be appended to the user_query
    /// This is not necessary for all agents.
    async fn get_system_reminder(&self, _index: usize) -> BitFunResult<String> {
        if let Some(system_reminder_template_name) = self.system_reminder_template_name() {
            let system_reminder =
                get_embedded_prompt(system_reminder_template_name).ok_or_else(|| {
                    BitFunError::Agent(format!(
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
