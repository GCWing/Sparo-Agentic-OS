use crate::agentic::memory::store::format_path_for_prompt;
use crate::util::errors::{BitFunError, BitFunResult};
use std::path::Path;

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

    fn label(self) -> &'static str {
        match self {
            Self::Workspace => "workspace",
            Self::Global => "global",
        }
    }
}

pub struct MemoryConsolidationPromptInput<'a> {
    pub role: MemoryConsolidationAgentRole,
    pub target_memory_dir: &'a Path,
    pub source_label: &'a str,
    pub canonical_file_path: &'a Path,
    pub journal_context: &'a str,
    pub global_memory_file_path: Option<&'a Path>,
    pub global_memory_dir: Option<&'a Path>,
}

pub fn build_memory_consolidation_prompt(
    input: &MemoryConsolidationPromptInput<'_>,
) -> BitFunResult<String> {
    let source_label = input.source_label.trim();
    let journal_context = input.journal_context.trim();
    if source_label.is_empty() {
        return Err(BitFunError::validation(
            "source_label cannot be empty for memory consolidation prompt",
        ));
    }

    let target_memory_dir = format_path_for_prompt(input.target_memory_dir);
    let canonical_file_path = format_path_for_prompt(input.canonical_file_path);
    let role_rules = match input.role {
        MemoryConsolidationAgentRole::Workspace => {
            let global_file = input.global_memory_file_path.ok_or_else(|| {
                BitFunError::validation(
                    "workspace consolidation prompt requires global_memory_file_path",
                )
            })?;
            let global_dir = input.global_memory_dir.ok_or_else(|| {
                BitFunError::validation("workspace consolidation prompt requires global_memory_dir")
            })?;
            format!(
                "- Update `{canonical_file_path}` with durable workspace memory.\n\
- If the new workspace journal reveals durable cross-workspace or user-level memory, also update `{}`.\n\
- Only update global memory when the new journal justifies it.\n\
- Treat `{}` as the global memory root when making any optional global update.",
                format_path_for_prompt(global_file),
                format_path_for_prompt(global_dir)
            )
        }
        MemoryConsolidationAgentRole::Global => format!(
            "- Update `{canonical_file_path}` with durable global memory.\n\
- Do not edit any workspace-specific memory files from this run."
        ),
    };

    Ok(format!(
        r#"You are a hidden {role} memory consolidation agent.

Target memory root: `{target_memory_dir}`
Canonical memory file: `{canonical_file_path}`
Source: {source_label}

Rules:
- Process only the journal entries included below. They represent new append-only logs since the last completed consolidation cursor.
{role_rules}
- Preserve good existing memory. Rewrite for clarity when needed, but do not throw away useful memory without a clear reason.
- Produce durable memory, not a day-by-day recap.
- Journal files are read-only input. Never edit or delete journal files.
- Prefer focused updates to existing memory files over creating extra files.
- Keep the result concise, structured, and maintainable.

Journal context:
{journal_context}
"#,
        role = input.role.label(),
    ))
}
