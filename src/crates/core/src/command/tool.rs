use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::agentic::tools::registry::{get_global_tool_registry, ToolRegistry};
use crate::agentic::tools::ToolRuntimeRestrictions;
use crate::agentic::workspace::{
    LocalWorkspaceFs, LocalWorkspaceShell, WorkspaceBinding, WorkspaceServices,
};

use super::{CommandError, CommandResult};

#[derive(Debug, Clone, Serialize)]
pub struct ToolInfo {
    pub name: String,
    pub user_facing_name: String,
    pub description: String,
    pub readonly: bool,
    pub enabled: bool,
    pub supports_streaming: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ToolSchemaRequest {
    pub name: String,
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolSchemaResponse {
    pub name: String,
    pub input_schema: Value,
    pub model_input_schema: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExecuteToolRequest {
    pub name: String,
    #[serde(default)]
    pub input: Value,
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExecuteToolResponse {
    pub tool_name: String,
    pub results: Vec<ToolResult>,
    pub display_results: Vec<Value>,
}

fn resolve_workspace_path(workspace_path: Option<String>) -> CommandResult<PathBuf> {
    match workspace_path {
        Some(path) if path.trim().is_empty() => std::env::current_dir().map_err(CommandError::tool),
        Some(path) => Ok(PathBuf::from(path)),
        None => std::env::current_dir().map_err(CommandError::tool),
    }
}

fn tool_context(workspace_path: Option<String>) -> CommandResult<ToolUseContext> {
    let workspace_root = resolve_workspace_path(workspace_path)?;
    let workspace = WorkspaceBinding::new(None, workspace_root.clone());
    let workspace_root_string = workspace_root.to_string_lossy().to_string();
    Ok(ToolUseContext {
        tool_call_id: Some(uuid::Uuid::new_v4().to_string()),
        agent_type: Some("cli".to_string()),
        session_id: Some(format!("cli-tool-{}", uuid::Uuid::new_v4())),
        dialog_turn_id: None,
        workspace: Some(workspace),
        custom_data: HashMap::new(),
        computer_use_host: None,
        cancellation_token: None,
        runtime_tool_restrictions: ToolRuntimeRestrictions::default(),
        workspace_services: Some(WorkspaceServices {
            fs: Arc::new(LocalWorkspaceFs),
            shell: Arc::new(LocalWorkspaceShell::new(workspace_root_string)),
        }),
        workspace_mount: None,
        agentic: None,
    })
}

fn resolve_tool_by_name(registry: &ToolRegistry, name: &str) -> Option<Arc<dyn Tool>> {
    registry.get_tool(name).or_else(|| {
        registry
            .get_all_tools()
            .into_iter()
            .find(|tool| tool.name().eq_ignore_ascii_case(name))
    })
}

pub async fn list_tools() -> CommandResult<Vec<ToolInfo>> {
    let registry = get_global_tool_registry();
    let tools = {
        let registry = registry.read().await;
        registry.get_all_tools()
    };

    let mut infos = Vec::with_capacity(tools.len());
    for tool in tools {
        let enabled = tool.is_enabled().await;
        let name = tool.name().to_string();
        let description = if name == "Skill" {
            "Execute a skill within the main conversation".to_string()
        } else {
            tool.description()
                .await
                .unwrap_or_else(|error| format!("Description unavailable: {}", error))
        };
        infos.push(ToolInfo {
            name,
            user_facing_name: tool.user_facing_name(),
            description,
            readonly: tool.is_readonly(),
            enabled,
            supports_streaming: tool.supports_streaming(),
        });
    }
    Ok(infos)
}

pub async fn tool_schema(request: ToolSchemaRequest) -> CommandResult<ToolSchemaResponse> {
    let registry = get_global_tool_registry();
    let tool = {
        let registry = registry.read().await;
        resolve_tool_by_name(&registry, &request.name)
            .ok_or_else(|| CommandError::tool(format!("Tool not found: {}", request.name)))?
    };
    let context = tool_context(request.workspace_path)?;
    Ok(ToolSchemaResponse {
        name: tool.name().to_string(),
        input_schema: tool.input_schema(),
        model_input_schema: tool
            .input_schema_for_model_with_context(Some(&context))
            .await,
    })
}

pub async fn execute_tool(request: ExecuteToolRequest) -> CommandResult<ExecuteToolResponse> {
    let registry = get_global_tool_registry();
    let tool = {
        let registry = registry.read().await;
        resolve_tool_by_name(&registry, &request.name)
            .ok_or_else(|| CommandError::tool(format!("Tool not found: {}", request.name)))?
    };
    if !tool.is_enabled().await {
        return Err(CommandError::tool(format!(
            "Tool is disabled: {}",
            request.name
        )));
    }

    let context = tool_context(request.workspace_path)?;
    let validation = tool.validate_input(&request.input, Some(&context)).await;
    if !validation.result {
        return Err(CommandError::tool(validation.message.unwrap_or_else(
            || format!("Invalid input for tool {}", request.name),
        )));
    }

    let results = tool
        .call(&request.input, &context)
        .await
        .map_err(CommandError::tool)?;
    let display_results = results
        .iter()
        .map(|result| {
            json!({
                "content": result.content(),
                "assistant": match result {
                    ToolResult::Result { result_for_assistant, .. } => result_for_assistant.clone(),
                    _ => None,
                }
            })
        })
        .collect();

    Ok(ExecuteToolResponse {
        tool_name: tool.name().to_string(),
        results,
        display_results,
    })
}
