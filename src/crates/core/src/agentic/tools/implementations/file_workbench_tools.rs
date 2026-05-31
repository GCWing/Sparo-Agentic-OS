//! File Workbench tools for agentic access to the Files scene context.

use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext, ValidationResult};
use crate::service::{
    get_files_context, plan_file_operations, FileOperationIntent, FileOperationPlan,
    FileOperationType, FilesContext, FilesContextScope, FilesContextSelectionKind,
    WorkbenchFileEntry, WorkbenchFileEntryKind, WorkbenchFileScope,
};
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Default)]
pub struct FileContextReadTool;

#[derive(Default)]
pub struct FileOperationPlanTool;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileContextReadInput {
    session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileOperationPlanInput {
    session_id: Option<String>,
    title: String,
    operation_type: FileOperationType,
    target_dir: Option<String>,
    reason: String,
}

impl FileContextReadTool {
    pub fn new() -> Self {
        Self
    }
}

impl FileOperationPlanTool {
    pub fn new() -> Self {
        Self
    }
}

fn session_id_from_input_or_context(
    input_session_id: Option<String>,
    context: &ToolUseContext,
) -> BitFunResult<String> {
    input_session_id
        .or_else(|| context.session_id.clone())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            BitFunError::tool("A sessionId is required to read Files context".to_string())
        })
}

fn file_scope_from_context(context: &FilesContext) -> WorkbenchFileScope {
    match context.scope {
        FilesContextScope::Workspace => WorkbenchFileScope::Workspace {
            root: context
                .workspace_root
                .clone()
                .unwrap_or_else(|| context.cwd.clone()),
            workspace_id: None,
        },
        FilesContextScope::System => WorkbenchFileScope::System {
            root: Some(context.cwd.clone()),
        },
        FilesContextScope::Pinned => WorkbenchFileScope::Pinned {
            pin_id: "files-context".to_string(),
            path: context.cwd.clone(),
        },
    }
}

fn workbench_entries_from_context(context: &FilesContext) -> Vec<WorkbenchFileEntry> {
    let scope = file_scope_from_context(context);
    context
        .selection
        .iter()
        .map(|item| {
            let name = item
                .path
                .split(['/', '\\'])
                .next_back()
                .filter(|value| !value.is_empty())
                .unwrap_or(&item.path)
                .to_string();
            WorkbenchFileEntry {
                id: item.path.clone(),
                path: item.path.clone(),
                name,
                kind: match item.kind {
                    FilesContextSelectionKind::File => WorkbenchFileEntryKind::File,
                    FilesContextSelectionKind::Dir => WorkbenchFileEntryKind::Dir,
                },
                scope: scope.clone(),
                size: item.size,
                modified_at: item.modified.clone(),
                category: item.category.clone(),
                hidden: item.hidden.unwrap_or(false),
                readonly: item.readonly.unwrap_or(false),
            }
        })
        .collect()
}

fn plan_from_files_context(
    context: &FilesContext,
    title: String,
    operation_type: FileOperationType,
    target_dir: Option<String>,
    reason: String,
) -> BitFunResult<FileOperationPlan> {
    let entries = workbench_entries_from_context(context);
    if entries.is_empty() {
        return Err(BitFunError::tool(
            "Files context has no selected files to plan against".to_string(),
        ));
    }

    let mut plan = plan_file_operations(
        file_scope_from_context(context),
        context.cwd.clone(),
        &entries,
        FileOperationIntent {
            title,
            operation_type,
            target_dir,
            reason,
        },
    );
    plan.created_by = "agent".to_string();
    Ok(plan)
}

#[async_trait]
impl Tool for FileContextReadTool {
    fn name(&self) -> &str {
        "FileContextRead"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok("Read the structured File Workbench context for the current session, including cwd, selected files, summary, capabilities, and recent paths. Use this before planning file organization work from the Files scene.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "sessionId": {
                    "type": "string",
                    "description": "Optional session id. Defaults to the active tool session."
                }
            }
        })
    }

    fn is_readonly(&self) -> bool {
        true
    }

    fn is_concurrency_safe(&self, _input: Option<&Value>) -> bool {
        true
    }

    fn render_tool_use_message(
        &self,
        _input: &Value,
        _options: &crate::agentic::tools::framework::ToolRenderOptions,
    ) -> String {
        "Read Files context".to_string()
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let input: FileContextReadInput =
            serde_json::from_value(input.clone()).map_err(|error| {
                BitFunError::tool(format!("Invalid FileContextRead input: {}", error))
            })?;
        let session_id = session_id_from_input_or_context(input.session_id, context)?;
        let context = get_files_context(&session_id).ok_or_else(|| {
            BitFunError::tool("No Files context is available for this session".to_string())
        })?;
        let assistant = format!(
            "Files context loaded: cwd={}, selected_items={}",
            context.cwd,
            context.selection.len()
        );
        Ok(vec![ToolResult::ok(json!(context), Some(assistant))])
    }
}

#[async_trait]
impl Tool for FileOperationPlanTool {
    fn name(&self) -> &str {
        "FileOperationPlan"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok("Create a reviewed, non-executing File Workbench operation plan from the current Files context selection. This tool never changes files; execution must happen through the app's confirmed operation flow.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["title", "operationType", "reason"],
            "properties": {
                "sessionId": {
                    "type": "string",
                    "description": "Optional session id. Defaults to the active tool session."
                },
                "title": {
                    "type": "string",
                    "description": "Short user-visible title for the planned file operation."
                },
                "operationType": {
                    "type": "string",
                    "enum": ["mkdir", "rename", "move", "copy", "delete-to-trash", "delete-permanent", "archive", "extract"],
                    "description": "The operation type to plan. The plan is preview-only and does not execute."
                },
                "targetDir": {
                    "type": "string",
                    "description": "Optional target directory for move/copy/archive/extract."
                },
                "reason": {
                    "type": "string",
                    "description": "Why this plan is useful for the selected files."
                }
            }
        })
    }

    fn is_readonly(&self) -> bool {
        true
    }

    fn is_concurrency_safe(&self, _input: Option<&Value>) -> bool {
        true
    }

    async fn validate_input(
        &self,
        input: &Value,
        _context: Option<&ToolUseContext>,
    ) -> ValidationResult {
        let Ok(input) = serde_json::from_value::<FileOperationPlanInput>(input.clone()) else {
            return ValidationResult {
                result: false,
                message: Some("title, operationType, and reason are required".to_string()),
                error_code: Some(400),
                meta: None,
            };
        };
        if input.title.trim().is_empty() || input.reason.trim().is_empty() {
            return ValidationResult {
                result: false,
                message: Some("title and reason cannot be empty".to_string()),
                error_code: Some(400),
                meta: None,
            };
        }
        ValidationResult::default()
    }

    fn render_tool_use_message(
        &self,
        input: &Value,
        _options: &crate::agentic::tools::framework::ToolRenderOptions,
    ) -> String {
        let operation = input
            .get("operationType")
            .and_then(Value::as_str)
            .unwrap_or("file operation");
        format!("Plan {}", operation)
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let input: FileOperationPlanInput =
            serde_json::from_value(input.clone()).map_err(|error| {
                BitFunError::tool(format!("Invalid FileOperationPlan input: {}", error))
            })?;
        let session_id = session_id_from_input_or_context(input.session_id, context)?;
        let files_context = get_files_context(&session_id).ok_or_else(|| {
            BitFunError::tool("No Files context is available for this session".to_string())
        })?;
        let plan = plan_from_files_context(
            &files_context,
            input.title,
            input.operation_type,
            input.target_dir,
            input.reason,
        )?;
        let assistant = format!(
            "Created file operation plan {} with {} item(s), {} high-risk item(s), and {} conflict(s). This is a preview only; it has not been executed.",
            plan.id,
            plan.summary.total,
            plan.summary.high_risk_count,
            plan.summary.conflict_count
        );
        Ok(vec![ToolResult::ok(json!(plan), Some(assistant))])
    }
}

#[cfg(test)]
mod tests {
    use super::{FileContextReadTool, FileOperationPlanTool};
    use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
    use crate::service::{
        clear_files_context, stash_files_context, FilesContext, FilesContextScope,
        FilesContextSelection, FilesContextSelectionKind, FilesContextSummary,
        FilesContextSummaryCategory,
    };
    use chrono::Utc;
    use serde_json::json;

    fn empty_context(session_id: &str) -> ToolUseContext {
        ToolUseContext {
            tool_call_id: None,
            agent_type: Some("Filer".to_string()),
            session_id: Some(session_id.to_string()),
            dialog_turn_id: None,
            workspace: None,
            custom_data: std::collections::HashMap::new(),
            computer_use_host: None,
            cancellation_token: None,
            runtime_tool_restrictions: Default::default(),
            workspace_services: None,
            workspace_mount: None,
            agentic: None,
        }
    }

    fn stash_sample_context(session_id: &str) {
        stash_files_context(
            session_id,
            FilesContext {
                scope: FilesContextScope::System,
                cwd: "C:/Users/example/Downloads".to_string(),
                workspace_root: None,
                selection: vec![FilesContextSelection {
                    path: "C:/Users/example/Downloads/report.md".to_string(),
                    kind: FilesContextSelectionKind::File,
                    size: Some(128),
                    category: Some("text".to_string()),
                    readonly: Some(false),
                    hidden: Some(false),
                    modified: None,
                }],
                recently_opened_paths: vec![],
                summary: Some(FilesContextSummary {
                    item_count: 1,
                    file_count: 1,
                    folder_count: 0,
                    total_size: 128,
                    categories: vec![FilesContextSummaryCategory {
                        category: "text".to_string(),
                        count: 1,
                    }],
                    capabilities: vec!["organize".to_string()],
                }),
                capabilities: vec![],
                source: Some("file-workbench".to_string()),
                created_at: Utc::now(),
            },
        );
    }

    #[tokio::test]
    async fn reads_structured_files_context() {
        let session_id = format!("file-context-tool-test-{}", uuid::Uuid::new_v4());
        stash_sample_context(&session_id);

        let result = FileContextReadTool::new()
            .call(&json!({}), &empty_context(&session_id))
            .await
            .expect("read files context");
        clear_files_context(&session_id);

        match &result[0] {
            ToolResult::Result { data, .. } => {
                assert_eq!(data["cwd"], "C:/Users/example/Downloads");
                assert_eq!(
                    data["selection"][0]["path"],
                    "C:/Users/example/Downloads/report.md"
                );
            }
            _ => panic!("unexpected tool result"),
        }
    }

    #[tokio::test]
    async fn creates_non_executing_operation_plan_from_context() {
        let session_id = format!("file-plan-tool-test-{}", uuid::Uuid::new_v4());
        stash_sample_context(&session_id);

        let result = FileOperationPlanTool::new()
            .call(
                &json!({
                    "title": "Archive selected files",
                    "operationType": "archive",
                    "reason": "Package the selected file"
                }),
                &empty_context(&session_id),
            )
            .await
            .expect("plan file operation");
        clear_files_context(&session_id);

        match &result[0] {
            ToolResult::Result { data, .. } => {
                assert_eq!(data["createdBy"], "agent");
                assert_eq!(data["items"][0]["operationType"], "archive");
                assert_eq!(
                    data["items"][0]["targetPath"],
                    "C:/Users/example/Downloads/report.zip"
                );
            }
            _ => panic!("unexpected tool result"),
        }
    }
}
