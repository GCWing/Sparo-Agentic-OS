use crate::agentic::memory::store::MemoryScope;

const WORKSPACE_SYSTEM_PROMPT: &str = include_str!("workspace/system.md");
const WORKSPACE_REMINDER_PROMPT: &str = include_str!("workspace/reminder.md");
const GLOBAL_SYSTEM_PROMPT: &str = include_str!("global/system.md");
const GLOBAL_REMINDER_PROMPT: &str = include_str!("global/reminder.md");
const SESSION_SUMMARY_PROMPT: &str = include_str!("session_summary.md");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MemoryPromptKind {
    System,
    Reminder,
}

pub(crate) struct MemoryPromptTemplateVars<'a> {
    pub(crate) memory_dir: &'a str,
    pub(crate) canonical_file_name: &'a str,
    pub(crate) recent_message_count: Option<usize>,
    pub(crate) existing_memories_section: Option<&'a str>,
}

pub(crate) fn render_memory_prompt(
    scope: MemoryScope,
    kind: MemoryPromptKind,
    vars: &MemoryPromptTemplateVars<'_>,
) -> String {
    let template = match (scope, kind) {
        (MemoryScope::WorkspaceProject, MemoryPromptKind::System) => WORKSPACE_SYSTEM_PROMPT,
        (MemoryScope::WorkspaceProject, MemoryPromptKind::Reminder) => WORKSPACE_REMINDER_PROMPT,
        (MemoryScope::GlobalAgenticOs, MemoryPromptKind::System) => GLOBAL_SYSTEM_PROMPT,
        (MemoryScope::GlobalAgenticOs, MemoryPromptKind::Reminder) => GLOBAL_REMINDER_PROMPT,
    };

    let recent_message_count = vars
        .recent_message_count
        .map(|value| value.to_string())
        .unwrap_or_default();

    let existing_memories_section = vars.existing_memories_section.unwrap_or_default();

    template
        .replace("__MEMORY_DIR__", vars.memory_dir)
        .replace("__CANONICAL_FILE_NAME__", vars.canonical_file_name)
        .replace("__RECENT_MESSAGE_COUNT__", &recent_message_count)
        .replace("__EXISTING_MEMORIES_SECTION__", existing_memories_section)
}

pub(crate) fn render_session_summary_prompt(session_summary_path: &str) -> String {
    SESSION_SUMMARY_PROMPT.replace("__SESSION_SUMMARY_PATH__", session_summary_path)
}

#[cfg(test)]
mod tests {
    use super::{
        render_memory_prompt, render_session_summary_prompt, MemoryPromptKind,
        MemoryPromptTemplateVars,
    };
    use crate::agentic::memory::store::MemoryScope;

    #[test]
    fn renders_workspace_system_prompt_with_runtime_values() {
        let rendered = render_memory_prompt(
            MemoryScope::WorkspaceProject,
            MemoryPromptKind::System,
            &MemoryPromptTemplateVars {
                memory_dir: "/workspace/memory",
                canonical_file_name: "MEMORY.md",
                recent_message_count: None,
                existing_memories_section: None,
            },
        );

        assert!(rendered.contains("`/workspace/memory`"));
        assert!(!rendered.contains("__MEMORY_DIR__"));
    }

    #[test]
    fn renders_global_reminder_prompt_with_optional_section() {
        let rendered = render_memory_prompt(
            MemoryScope::GlobalAgenticOs,
            MemoryPromptKind::Reminder,
            &MemoryPromptTemplateVars {
                memory_dir: "/global/memory",
                canonical_file_name: "MEMORY.md",
                recent_message_count: Some(7),
                existing_memories_section: Some(
                    "\n\n## Existing memory files\n\n- [Profile](user.md)",
                ),
            },
        );

        assert!(rendered.contains("~7 messages"));
        assert!(rendered.contains("## Existing memory files"));
        assert!(!rendered.contains("workspace overview"));
        assert!(!rendered.contains("__RECENT_MESSAGE_COUNT__"));
    }

    #[test]
    fn renders_session_summary_prompt_with_runtime_values() {
        let rendered = render_session_summary_prompt("/workspace/sessions/abc/summary.md");

        assert!(rendered.contains("`/workspace/sessions/abc/summary.md`"));
        assert!(!rendered.contains("__SESSION_SUMMARY_PATH__"));
    }
}
