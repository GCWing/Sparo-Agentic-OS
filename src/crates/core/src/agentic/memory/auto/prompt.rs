use crate::agentic::core::{Message, MessageRole, MessageSemanticKind};
use crate::agentic::memory::prompts::{
    render_memory_prompt, MemoryPromptKind, MemoryPromptTemplateVars,
};
use crate::agentic::memory::store::{MemoryScope, MEMORY_CANONICAL_FILE};

pub fn count_recent_model_visible_messages(
    messages: &[Message],
    since_turn_id: Option<&str>,
) -> usize {
    let boundary_index = since_turn_id.and_then(|turn_id| {
        messages
            .iter()
            .enumerate()
            .rev()
            .find(|(_, message)| message.metadata.turn_id.as_deref() == Some(turn_id))
            .map(|(index, _)| index)
    });

    let count = messages
        .iter()
        .enumerate()
        .filter(|(index, _)| boundary_index.map_or(true, |boundary| *index > boundary))
        .filter(|(_, message)| is_model_visible_message(message))
        .count();

    count.max(1)
}

fn is_model_visible_message(message: &Message) -> bool {
    if matches!(
        message.metadata.semantic_kind,
        Some(MessageSemanticKind::ComputerUseVerificationScreenshot)
            | Some(MessageSemanticKind::ComputerUsePostActionSnapshot)
    ) {
        return false;
    }

    matches!(
        message.role,
        MessageRole::User | MessageRole::Assistant | MessageRole::Tool
    )
}

pub fn build_extract_prompt(
    recent_message_count: usize,
    memory_dir: &str,
    existing_memories: Option<&str>,
    memory_scope: MemoryScope,
) -> String {
    let existing_memories_section = existing_memories
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            format!(
                "\n\n## Existing memory files\n\n{}\n\nUse this list for context only. Auto memory writes must append journal entries through the `Memory` tool rather than editing these files directly.",
                value.trim()
            )
        })
        .unwrap_or_default();

    render_memory_prompt(
        memory_scope,
        MemoryPromptKind::Reminder,
        &MemoryPromptTemplateVars {
            memory_dir,
            canonical_file_name: MEMORY_CANONICAL_FILE,
            recent_message_count: Some(recent_message_count),
            existing_memories_section: Some(&existing_memories_section),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{build_extract_prompt, count_recent_model_visible_messages};
    use crate::agentic::core::{Message, ToolCall, ToolResult};
    use serde_json::json;

    #[test]
    fn counts_runtime_message_flow_including_tool_results() {
        let messages = vec![
            Message::user("old user".to_string()).with_turn_id("turn-1".to_string()),
            Message::assistant_with_tools(
                "calling tool".to_string(),
                vec![ToolCall {
                    tool_id: "tool-1".to_string(),
                    tool_name: "Read".to_string(),
                    arguments: json!({ "file_path": "a.txt" }),
                    is_error: false,
                }],
            )
            .with_turn_id("turn-2".to_string()),
            Message::tool_result(ToolResult {
                tool_id: "tool-1".to_string(),
                tool_name: "Read".to_string(),
                result: json!({ "content": "hello" }),
                result_for_assistant: Some("hello".to_string()),
                is_error: false,
                duration_ms: None,
                image_attachments: None,
            })
            .with_turn_id("turn-2".to_string()),
            Message::assistant("final answer".to_string()).with_turn_id("turn-2".to_string()),
        ];

        assert_eq!(
            count_recent_model_visible_messages(&messages, Some("turn-1")),
            3
        );
    }

    #[test]
    fn extract_prompt_mentions_memory_tool() {
        let prompt = build_extract_prompt(
            7,
            "/workspace/memory",
            Some("- SOUL.md\n- USER.md\n- MEMORY.md\n- logs/2026/05/2026-05-07.jsonl"),
            crate::agentic::memory::store::MemoryScope::WorkspaceProject,
        );

        assert!(prompt.contains("`Memory` tool"));
        assert!(prompt.contains("MEMORY.md"));
        assert!(prompt.contains("logs/2026/05/2026-05-07.jsonl"));
    }
}
