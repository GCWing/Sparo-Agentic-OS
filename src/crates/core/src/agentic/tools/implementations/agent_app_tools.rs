//! Agent App tools used by Agent App Studio.

use crate::agent_app::{
    slugify_agent_app_id, AgentAppExample, AgentAppJsToolManifest, AgentAppLevel, AgentAppManager,
    AgentAppManifest, AGENT_APP_SCHEMA_VERSION,
};
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::agentic::tools::get_all_registered_tool_names;
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;

fn workspace_root(context: &ToolUseContext) -> Option<PathBuf> {
    context.workspace_root().map(PathBuf::from)
}

fn parse_level(value: Option<&Value>) -> AgentAppLevel {
    match value.and_then(Value::as_str).unwrap_or("user") {
        "project" => AgentAppLevel::Project,
        _ => AgentAppLevel::User,
    }
}

fn examples_from_value(value: Option<&Value>) -> Vec<AgentAppExample> {
    value
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn manifest_from_input(input: &Value, context: &ToolUseContext) -> BitFunResult<AgentAppManifest> {
    let name = input
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| BitFunError::validation("name is required"))?
        .trim()
        .to_string();
    let id = input
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| slugify_agent_app_id(&name));
    let tools = input
        .get("tools")
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_else(|| {
            vec![
                "LS".to_string(),
                "Read".to_string(),
                "Glob".to_string(),
                "Grep".to_string(),
            ]
        });
    let subagents = input
        .get("subagents")
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let skills = input
        .get("skills")
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let level = parse_level(input.get("level"));
    if level == AgentAppLevel::Project && workspace_root(context).is_none() {
        return Err(BitFunError::validation(
            "Project Agent Apps require a workspace path",
        ));
    }
    Ok(AgentAppManifest {
        schema_version: AGENT_APP_SCHEMA_VERSION,
        id,
        name,
        description: input
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string(),
        icon: input
            .get("icon")
            .and_then(Value::as_str)
            .unwrap_or("bot")
            .to_string(),
        category: input
            .get("category")
            .and_then(Value::as_str)
            .unwrap_or("custom")
            .to_string(),
        tags: input
            .get("tags")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default(),
        level,
        model: input
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("primary")
            .to_string(),
        readonly: input
            .get("readonly")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        enabled: input
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        tools,
        skills,
        subagents,
        tool_policies: input
            .get("toolPolicies")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_else(BTreeMap::new),
        service_actions: input
            .get("serviceActions")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default(),
        bridge_capabilities: input
            .get("bridgeCapabilities")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default(),
        examples: examples_from_value(input.get("examples")),
    })
}

fn agent_app_schema(required_prompt: bool) -> Value {
    let mut required = vec!["name", "description"];
    if required_prompt {
        required.push("prompt");
    }
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": required,
        "properties": {
            "id": { "type": "string", "description": "Stable id. Defaults to a slug from name." },
            "level": { "type": "string", "enum": ["user", "project"], "description": "Install scope. Project Agent Apps require a workspace path." },
            "name": { "type": "string" },
            "description": { "type": "string" },
            "prompt": { "type": "string" },
            "icon": { "type": "string" },
            "category": { "type": "string" },
            "tags": { "type": "array", "items": { "type": "string" } },
            "model": { "type": "string" },
            "readonly": { "type": "boolean" },
            "enabled": { "type": "boolean" },
            "tools": { "type": "array", "items": { "type": "string" } },
            "toolPolicies": { "type": "object" },
            "bridgeCapabilities": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["bridgeId", "capabilityId"],
                    "properties": {
                        "bridgeId": { "type": "string" },
                        "capabilityId": { "type": "string" },
                        "alias": { "type": "string" },
                        "mode": { "type": "string" }
                    }
                }
            },
            "serviceActions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["name", "description"],
                    "properties": {
                        "name": { "type": "string" },
                        "description": { "type": "string" },
                        "inputSchema": { "type": "object" },
                        "outputSchema": { "type": "object" },
                        "promptTemplate": { "type": "string" },
                        "memory": { "type": "string" },
                        "toolPolicy": { "type": "array", "items": { "type": "string" } },
                        "bridgeCall": {
                            "type": "object",
                            "required": ["bridgeId", "capabilityId"],
                            "properties": {
                                "bridgeId": { "type": "string" },
                                "capabilityId": { "type": "string" },
                                "action": { "type": "string" },
                                "mode": { "type": "string" }
                            }
                        }
                    }
                }
            },
            "examples": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["title", "prompt"],
                    "properties": {
                        "title": { "type": "string" },
                        "prompt": { "type": "string" }
                    }
                }
            }
        }
    })
}

async fn validate_selected_tools(manifest: &AgentAppManifest) -> BitFunResult<()> {
    let valid_tools = get_all_registered_tool_names().await;
    let invalid: Vec<String> = manifest
        .tools
        .iter()
        .filter(|tool| !valid_tools.contains(tool))
        .cloned()
        .collect();
    if !invalid.is_empty() {
        return Err(BitFunError::validation(format!(
            "Unknown tools: {}",
            invalid.join(", ")
        )));
    }
    Ok(())
}

pub struct ListAgentAppsTool;

#[async_trait]
impl Tool for ListAgentAppsTool {
    fn name(&self) -> &str {
        "ListAgentApps"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("List installed FlowChat-native Agent Apps.".to_string())
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "additionalProperties": false, "properties": {} })
    }
    fn is_readonly(&self) -> bool {
        true
    }
    async fn call_impl(
        &self,
        _input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let apps = AgentAppManager::list(workspace_root(context).as_deref())?;
        Ok(vec![ToolResult::ok(
            json!({ "apps": apps }),
            Some(format!("Found {} Agent Apps.", apps.len())),
        )])
    }
}

pub struct GetAgentAppTool;

#[async_trait]
impl Tool for GetAgentAppTool {
    fn name(&self) -> &str {
        "GetAgentApp"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("Read a complete Agent App package manifest and prompt.".to_string())
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "additionalProperties": false, "required": ["id"], "properties": { "id": { "type": "string" }, "level": { "type": "string", "enum": ["user", "project"] } } })
    }
    fn is_readonly(&self) -> bool {
        true
    }
    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let id = input
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| BitFunError::validation("id is required"))?;
        let level = input.get("level").map(|v| parse_level(Some(v)));
        let package = AgentAppManager::get(id, level, workspace_root(context).as_deref())?;
        Ok(vec![ToolResult::ok(
            json!(package),
            Some(format!("Loaded Agent App '{}'.", id)),
        )])
    }
}

pub struct ValidateAgentAppPackageTool;

#[async_trait]
impl Tool for ValidateAgentAppPackageTool {
    fn name(&self) -> &str {
        "ValidateAgentAppPackage"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("Validate an Agent App draft before creating or updating it.".to_string())
    }
    fn input_schema(&self) -> Value {
        agent_app_schema(true)
    }
    fn is_readonly(&self) -> bool {
        true
    }
    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let mut manifest = manifest_from_input(input, context)?;
        AgentAppManager::validate_manifest(&mut manifest)?;
        let prompt = input.get("prompt").and_then(Value::as_str).unwrap_or("");
        if prompt.trim().is_empty() {
            return Err(BitFunError::validation("prompt is required"));
        }
        validate_selected_tools(&manifest).await?;
        Ok(vec![ToolResult::ok(
            json!({ "ok": true, "manifest": manifest }),
            Some("Agent App draft is valid.".to_string()),
        )])
    }
}

pub struct CreateAgentAppTool;

#[async_trait]
impl Tool for CreateAgentAppTool {
    fn name(&self) -> &str {
        "CreateAgentApp"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("Create and register a FlowChat-native Agent App package.".to_string())
    }
    fn input_schema(&self) -> Value {
        agent_app_schema(true)
    }
    fn is_readonly(&self) -> bool {
        false
    }
    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        true
    }
    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let mut manifest = manifest_from_input(input, context)?;
        AgentAppManager::validate_manifest(&mut manifest)?;
        validate_selected_tools(&manifest).await?;
        let prompt = input
            .get("prompt")
            .and_then(Value::as_str)
            .ok_or_else(|| BitFunError::validation("prompt is required"))?;
        let package = AgentAppManager::create_or_update(
            manifest,
            prompt.to_string(),
            workspace_root(context).as_deref(),
            false,
        )?;
        AgentAppManager::register_runtime_tools(workspace_root(context).as_deref()).await?;
        Ok(vec![ToolResult::ok(
            json!(package),
            Some("Agent App created and registered. It now appears in Agent Apps.".to_string()),
        )])
    }
}

pub struct UpdateAgentAppTool;

#[async_trait]
impl Tool for UpdateAgentAppTool {
    fn name(&self) -> &str {
        "UpdateAgentApp"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("Update and re-register a FlowChat-native Agent App package.".to_string())
    }
    fn input_schema(&self) -> Value {
        agent_app_schema(true)
    }
    fn is_readonly(&self) -> bool {
        false
    }
    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        true
    }
    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let mut manifest = manifest_from_input(input, context)?;
        AgentAppManager::validate_manifest(&mut manifest)?;
        validate_selected_tools(&manifest).await?;
        let prompt = input
            .get("prompt")
            .and_then(Value::as_str)
            .ok_or_else(|| BitFunError::validation("prompt is required"))?;
        let package = AgentAppManager::create_or_update(
            manifest,
            prompt.to_string(),
            workspace_root(context).as_deref(),
            true,
        )?;
        AgentAppManager::register_runtime_tools(workspace_root(context).as_deref()).await?;
        Ok(vec![ToolResult::ok(
            json!(package),
            Some("Agent App updated and registered.".to_string()),
        )])
    }
}

pub struct ListAgentAppToolOptionsTool;

#[async_trait]
impl Tool for ListAgentAppToolOptionsTool {
    fn name(&self) -> &str {
        "ListAgentAppToolOptions"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("List tools that can be selected for an Agent App.".to_string())
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "additionalProperties": false, "properties": {} })
    }
    fn is_readonly(&self) -> bool {
        true
    }
    async fn call_impl(
        &self,
        _input: &Value,
        _context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let tools = get_all_registered_tool_names().await;
        Ok(vec![ToolResult::ok(
            json!({ "tools": tools }),
            Some("Listed available Agent App tools.".to_string()),
        )])
    }
}

pub struct CreateAgentAppJsToolTool;

#[async_trait]
impl Tool for CreateAgentAppJsToolTool {
    fn name(&self) -> &str {
        "CreateAgentAppJsTool"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("Create a JavaScript runtime tool inside an Agent App package.".to_string())
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["appId", "manifest", "source"],
            "properties": {
                "appId": { "type": "string" },
                "level": { "type": "string", "enum": ["user", "project"] },
                "manifest": { "type": "object" },
                "source": { "type": "string" }
            }
        })
    }
    fn is_readonly(&self) -> bool {
        false
    }
    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        true
    }
    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let app_id = input
            .get("appId")
            .and_then(Value::as_str)
            .ok_or_else(|| BitFunError::validation("appId is required"))?;
        let manifest: AgentAppJsToolManifest = serde_json::from_value(
            input
                .get("manifest")
                .cloned()
                .ok_or_else(|| BitFunError::validation("manifest is required"))?,
        )?;
        let source = input
            .get("source")
            .and_then(Value::as_str)
            .ok_or_else(|| BitFunError::validation("source is required"))?;
        let tool_name = AgentAppManager::create_js_tool(
            app_id,
            input.get("level").map(|v| parse_level(Some(v))),
            workspace_root(context).as_deref(),
            manifest,
            source.to_string(),
        )?;
        AgentAppManager::register_runtime_tools(workspace_root(context).as_deref()).await?;
        Ok(vec![ToolResult::ok(
            json!({ "toolName": tool_name }),
            Some(format!("Created JS runtime tool {tool_name}.")),
        )])
    }
}

pub struct TestAgentAppJsToolTool;

#[async_trait]
impl Tool for TestAgentAppJsToolTool {
    fn name(&self) -> &str {
        "TestAgentAppJsTool"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("Run an Agent App JavaScript runtime tool with test input.".to_string())
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["appId", "toolName", "input"],
            "properties": {
                "appId": { "type": "string" },
                "level": { "type": "string", "enum": ["user", "project"] },
                "toolName": { "type": "string" },
                "input": { "type": "object" }
            }
        })
    }
    fn is_readonly(&self) -> bool {
        true
    }
    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let app_id = input
            .get("appId")
            .and_then(Value::as_str)
            .ok_or_else(|| BitFunError::validation("appId is required"))?;
        let tool_name = input
            .get("toolName")
            .and_then(Value::as_str)
            .ok_or_else(|| BitFunError::validation("toolName is required"))?;
        let tool_input = input.get("input").unwrap_or(&Value::Null);
        let result = AgentAppManager::test_js_tool(
            app_id,
            tool_name,
            tool_input,
            input.get("level").map(|v| parse_level(Some(v))),
            workspace_root(context).as_deref(),
        )
        .await?;
        Ok(vec![ToolResult::ok(
            result,
            Some(format!("Tested JS runtime tool {tool_name}.")),
        )])
    }
}
