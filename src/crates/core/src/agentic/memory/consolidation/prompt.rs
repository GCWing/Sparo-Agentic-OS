use crate::agentic::memory::store::format_path_for_prompt;
use crate::util::errors::BitFunResult;
use std::path::Path;

const WORKSPACE_CONSOLIDATION_PROMPT_TEMPLATE: &str = include_str!("prompts/workspace.md");
const GLOBAL_CONSOLIDATION_PROMPT_TEMPLATE: &str = include_str!("prompts/global.md");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryConsolidationAgentRole {
    Workspace,
    Global,
}

impl MemoryConsolidationAgentRole {
    pub fn agent_type(self) -> &'static str {
        match self {
            Self::Workspace => "WorkspaceMemoryConsolidator",
            Self::Global => "GlobalMemoryConsolidator",
        }
    }

    fn prompt_template(self) -> &'static str {
        match self {
            Self::Workspace => WORKSPACE_CONSOLIDATION_PROMPT_TEMPLATE,
            Self::Global => GLOBAL_CONSOLIDATION_PROMPT_TEMPLATE,
        }
    }
}

pub struct MemoryConsolidationPromptInput<'a> {
    pub role: MemoryConsolidationAgentRole,
    pub workspace_memory_file_path: Option<&'a Path>,
    pub global_soul_file_path: Option<&'a Path>,
    pub global_user_file_path: Option<&'a Path>,
    pub global_memory_file_path: Option<&'a Path>,
    pub journal_context: &'a str,
}

pub fn build_memory_consolidation_prompt(
    input: &MemoryConsolidationPromptInput<'_>,
) -> BitFunResult<String> {
    let journal_context = input.journal_context.trim();

    let workspace_memory_file_path = input
        .workspace_memory_file_path
        .map(format_path_for_prompt)
        .unwrap_or_default();
    let global_soul_file_path = input
        .global_soul_file_path
        .map(format_path_for_prompt)
        .unwrap_or_default();
    let global_user_file_path = input
        .global_user_file_path
        .map(format_path_for_prompt)
        .unwrap_or_default();
    let global_memory_file_path = input
        .global_memory_file_path
        .map(format_path_for_prompt)
        .unwrap_or_default();

    let prompt = input
        .role
        .prompt_template()
        .replace("{workspace_memory_file_path}", &workspace_memory_file_path)
        .replace("{global_soul_file_path}", &global_soul_file_path)
        .replace("{global_user_file_path}", &global_user_file_path)
        .replace("{global_memory_file_path}", &global_memory_file_path)
        .replace("{journal_context}", journal_context);

    Ok(prompt)
}
