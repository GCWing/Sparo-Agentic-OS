use crate::agentic::agents::get_agent_registry;
use crate::agentic::memory::store::{
    ensure_memory_store_for_target, format_path_for_prompt, memory_journal_file_path_for_date,
    MemoryScope, MemoryStoreTarget,
};
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext, ValidationResult};
use crate::error::{CoreError, CoreResult};
use async_trait::async_trait;
use chrono::{Local, SecondsFormat};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::fs;
use tokio::io::AsyncWriteExt;

pub struct MemoryTool;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum MemoryAction {
    Add,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MemoryToolInput {
    action: MemoryAction,
    #[serde(rename = "type")]
    memory_type: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MemoryJournalRecord {
    time: String,
    #[serde(rename = "type")]
    memory_type: String,
    content: String,
    session_id: String,
}

impl Default for MemoryTool {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryTool {
    pub fn new() -> Self {
        Self
    }

    fn resolve_memory_scope(&self, context: &ToolUseContext) -> CoreResult<MemoryScope> {
        let agent_type = context
            .agent_type
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("agentic");

        let workspace_root = context.workspace_root().ok_or_else(|| {
            CoreError::tool("Memory tool requires an active workspace".to_string())
        })?;

        Ok(get_agent_registry()
            .get_agent(agent_type, Some(workspace_root))
            .map(|agent| agent.memory_scope())
            .unwrap_or(MemoryScope::WorkspaceProject))
    }

    fn resolve_memory_target<'a>(
        &self,
        context: &'a ToolUseContext,
        scope: MemoryScope,
    ) -> CoreResult<MemoryStoreTarget<'a>> {
        match scope {
            MemoryScope::WorkspaceProject => Ok(MemoryStoreTarget::WorkspaceProject(
                context.workspace_root().ok_or_else(|| {
                    CoreError::tool(
                        "Workspace-scoped memory requires a workspace root".to_string(),
                    )
                })?,
            )),
            MemoryScope::GlobalAgenticOs => Ok(MemoryStoreTarget::GlobalAgenticOs),
        }
    }

    fn resolve_origin_session_id(&self, context: &ToolUseContext) -> CoreResult<String> {
        if let Some(origin) = context
            .custom_data
            .get("origin_session_id")
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
        {
            return Ok(origin.to_string());
        }

        context
            .session_id
            .as_ref()
            .filter(|value| !value.trim().is_empty())
            .cloned()
            .ok_or_else(|| {
                CoreError::tool(
                    "Memory tool requires a session id in context or origin_session_id override"
                        .to_string(),
                )
            })
    }

    fn format_record_time(now: chrono::DateTime<Local>) -> String {
        now.to_rfc3339_opts(SecondsFormat::Secs, true)
    }
}

#[async_trait]
impl Tool for MemoryTool {
    fn name(&self) -> &str {
        "Memory"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(
            r#"Append durable memory records to the structured auto-memory journal.

Actions:
- add: append one memory record to the current memory scope's daily journal

Rules:
- This tool is append-only. It does not edit or delete past memory entries.
- Provide the memory `type` and `content`.
- `type` must match the memory types described in the current memory instructions.
- `content` should contain the durable memory fact itself, not a summary of the whole conversation.

Use this tool when:
- The user explicitly asks you to remember something durable
- Auto memory needs to record a durable memory observation from recent turns

Do not use this tool for:
- Temporary task state
- General notes that belong only in the current conversation
- Codebase facts derivable from reading the repository"#
                .to_string(),
        )
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["add"],
                    "description": "Append a durable memory record to the current scope's daily memory journal."
                },
                "type": {
                    "type": "string",
                    "description": "Memory type"
                },
                "content": {
                    "type": "string",
                    "description": "The durable memory content to append."
                }
            },
            "required": ["action", "type", "content"],
            "additionalProperties": false
        })
    }

    fn is_readonly(&self) -> bool {
        false
    }

    fn is_concurrency_safe(&self, _input: Option<&Value>) -> bool {
        false
    }

    async fn validate_input(
        &self,
        input: &Value,
        _context: Option<&ToolUseContext>,
    ) -> ValidationResult {
        match serde_json::from_value::<MemoryToolInput>(input.clone()) {
            Ok(parsed) => {
                if parsed.memory_type.trim().is_empty() {
                    return ValidationResult {
                        result: false,
                        message: Some("type cannot be empty".to_string()),
                        error_code: Some(400),
                        meta: None,
                    };
                }
                if parsed.content.trim().is_empty() {
                    return ValidationResult {
                        result: false,
                        message: Some("content cannot be empty".to_string()),
                        error_code: Some(400),
                        meta: None,
                    };
                }
                ValidationResult::default()
            }
            Err(error) => ValidationResult {
                result: false,
                message: Some(format!("Invalid Memory input: {}", error)),
                error_code: Some(400),
                meta: None,
            },
        }
    }

    fn render_tool_use_message(
        &self,
        input: &Value,
        _options: &crate::agentic::tools::framework::ToolRenderOptions,
    ) -> String {
        let action = input
            .get("action")
            .and_then(|value| value.as_str())
            .unwrap_or("add");
        let memory_type = input
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("memory");
        format!("Memory {} ({})", action, memory_type)
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> CoreResult<Vec<ToolResult>> {
        let parsed: MemoryToolInput = serde_json::from_value(input.clone())
            .map_err(|e| CoreError::validation(format!("Invalid Memory input: {}", e)))?;

        let scope = self.resolve_memory_scope(context)?;
        let target = self.resolve_memory_target(context, scope)?;
        let session_id = self.resolve_origin_session_id(context)?;
        ensure_memory_store_for_target(target).await?;

        let now = Local::now();
        let record = MemoryJournalRecord {
            time: Self::format_record_time(now),
            memory_type: parsed.memory_type.clone(),
            content: parsed.content.clone(),
            session_id,
        };

        let journal_path = memory_journal_file_path_for_date(target, now.date_naive());
        if let Some(parent) = journal_path.parent() {
            fs::create_dir_all(parent).await.map_err(|e| {
                CoreError::tool(format!(
                    "Failed to create memory journal directory {}: {}",
                    parent.display(),
                    e
                ))
            })?;
        }

        let serialized = serde_json::to_string(&record).map_err(|e| {
            CoreError::tool(format!("Failed to serialize memory journal record: {}", e))
        })?;

        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&journal_path)
            .await
            .map_err(|e| {
                CoreError::tool(format!(
                    "Failed to open memory journal {}: {}",
                    journal_path.display(),
                    e
                ))
            })?;
        file.write_all(serialized.as_bytes()).await.map_err(|e| {
            CoreError::tool(format!(
                "Failed to append memory journal {}: {}",
                journal_path.display(),
                e
            ))
        })?;
        file.write_all(b"\n").await.map_err(|e| {
            CoreError::tool(format!(
                "Failed to finalize memory journal line {}: {}",
                journal_path.display(),
                e
            ))
        })?;
        file.flush().await.map_err(|e| {
            CoreError::tool(format!(
                "Failed to flush memory journal {}: {}",
                journal_path.display(),
                e
            ))
        })?;

        let logical_path = format_path_for_prompt(&journal_path);
        let data = json!({
            "action": "add",
            "scope": scope.as_label(),
            "journal_path": logical_path,
            "record": record,
        });

        Ok(vec![ToolResult::ok(
            data,
            Some(format!(
                "Appended memory journal record to {}",
                logical_path
            )),
        )])
    }
}

#[cfg(test)]
mod tests {
    use super::MemoryTool;
    use chrono::{FixedOffset, TimeZone, Timelike};

    #[test]
    fn record_time_is_formatted_to_seconds_precision() {
        let tz = FixedOffset::east_opt(8 * 3600).expect("valid offset");
        let now = tz
            .with_ymd_and_hms(2026, 5, 7, 11, 43, 19)
            .single()
            .expect("valid datetime")
            .with_nanosecond(168_745_600)
            .expect("valid nanos")
            .with_timezone(&chrono::Local);

        let formatted = MemoryTool::format_record_time(now);

        assert_eq!(formatted, "2026-05-07T11:43:19+08:00");
    }
}
