//! Agent Component tools used by App Studio component authoring.

use crate::agent_component::{
    slugify_agent_component_id, AgentComponentExample, AgentComponentJsToolManifest,
    AgentComponentLevel, AgentComponentManager, AgentComponentManifest,
    AGENT_COMPONENT_SCHEMA_VERSION,
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

fn parse_level(value: Option<&Value>) -> AgentComponentLevel {
    match value.and_then(Value::as_str).unwrap_or("user") {
        "project" => AgentComponentLevel::Project,
        _ => AgentComponentLevel::User,
    }
}

fn examples_from_value(value: Option<&Value>) -> Vec<AgentComponentExample> {
    value
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn manifest_from_input(
    input: &Value,
    context: &ToolUseContext,
) -> BitFunResult<AgentComponentManifest> {
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
        .unwrap_or_else(|| slugify_agent_component_id(&name));
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
    if level == AgentComponentLevel::Project && workspace_root(context).is_none() {
        return Err(BitFunError::validation(
            "Project Agent Components require a workspace path",
        ));
    }
    Ok(AgentComponentManifest {
        schema_version: AGENT_COMPONENT_SCHEMA_VERSION,
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

fn agent_component_schema(required_prompt: bool) -> Value {
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
            "level": { "type": "string", "enum": ["user", "project"], "description": "Install scope. Project Agent Components require a workspace path." },
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

async fn validate_selected_tools(manifest: &AgentComponentManifest) -> BitFunResult<()> {
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

pub struct ListAgentComponentsTool;

#[async_trait]
impl Tool for ListAgentComponentsTool {
    fn name(&self) -> &str {
        "ListAgentComponents"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("List installed Agent Component implementation packages.".to_string())
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
        let apps = AgentComponentManager::list(workspace_root(context).as_deref())?;
        Ok(vec![ToolResult::ok(
            json!({ "apps": apps }),
            Some(format!("Found {} Agent Components.", apps.len())),
        )])
    }
}

pub struct GetAgentComponentTool;

#[async_trait]
impl Tool for GetAgentComponentTool {
    fn name(&self) -> &str {
        "GetAgentComponent"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("Read a complete Agent Component package manifest and prompt.".to_string())
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
        let package = AgentComponentManager::get(id, level, workspace_root(context).as_deref())?;
        Ok(vec![ToolResult::ok(
            json!(package),
            Some(format!("Loaded Agent Component '{}'.", id)),
        )])
    }
}

pub struct ValidateAgentComponentPackageTool;

#[async_trait]
impl Tool for ValidateAgentComponentPackageTool {
    fn name(&self) -> &str {
        "ValidateAgentComponentPackage"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("Validate an Agent Component draft before creating or updating it.".to_string())
    }
    fn input_schema(&self) -> Value {
        agent_component_schema(true)
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
        AgentComponentManager::validate_manifest(&mut manifest)?;
        let prompt = input.get("prompt").and_then(Value::as_str).unwrap_or("");
        if prompt.trim().is_empty() {
            return Err(BitFunError::validation("prompt is required"));
        }
        validate_selected_tools(&manifest).await?;
        Ok(vec![ToolResult::ok(
            json!({ "ok": true, "manifest": manifest }),
            Some("Agent Component draft is valid.".to_string()),
        )])
    }
}

pub struct CreateAgentComponentTool;

#[async_trait]
impl Tool for CreateAgentComponentTool {
    fn name(&self) -> &str {
        "CreateAgentComponent"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("Create and register an Agent Component implementation package.".to_string())
    }
    fn input_schema(&self) -> Value {
        agent_component_schema(true)
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
        AgentComponentManager::validate_manifest(&mut manifest)?;
        validate_selected_tools(&manifest).await?;
        let prompt = input
            .get("prompt")
            .and_then(Value::as_str)
            .ok_or_else(|| BitFunError::validation("prompt is required"))?;
        let package = AgentComponentManager::create_or_update(
            manifest,
            prompt.to_string(),
            workspace_root(context).as_deref(),
            false,
        )?;
        AgentComponentManager::register_runtime_tools(workspace_root(context).as_deref()).await?;
        Ok(vec![ToolResult::ok(
            json!(package),
            Some("Agent Component implementation package created and registered.".to_string()),
        )])
    }
}

pub struct UpdateAgentComponentTool;

#[async_trait]
impl Tool for UpdateAgentComponentTool {
    fn name(&self) -> &str {
        "UpdateAgentComponent"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("Update and re-register an Agent Component implementation package.".to_string())
    }
    fn input_schema(&self) -> Value {
        agent_component_schema(true)
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
        AgentComponentManager::validate_manifest(&mut manifest)?;
        validate_selected_tools(&manifest).await?;
        let prompt = input
            .get("prompt")
            .and_then(Value::as_str)
            .ok_or_else(|| BitFunError::validation("prompt is required"))?;
        let package = AgentComponentManager::create_or_update(
            manifest,
            prompt.to_string(),
            workspace_root(context).as_deref(),
            true,
        )?;
        AgentComponentManager::register_runtime_tools(workspace_root(context).as_deref()).await?;
        Ok(vec![ToolResult::ok(
            json!(package),
            Some("Agent Component updated and registered.".to_string()),
        )])
    }
}

pub struct ListAgentComponentToolOptionsTool;

#[async_trait]
impl Tool for ListAgentComponentToolOptionsTool {
    fn name(&self) -> &str {
        "ListAgentComponentToolOptions"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("List tools that can be selected for an Agent Component.".to_string())
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
            Some("Listed available Agent Component tools.".to_string()),
        )])
    }
}

pub struct CreateAgentComponentJsToolTool;

#[async_trait]
impl Tool for CreateAgentComponentJsToolTool {
    fn name(&self) -> &str {
        "CreateAgentComponentJsTool"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("Create a JavaScript runtime tool inside an Agent Component package.".to_string())
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["componentId", "manifest", "source"],
            "properties": {
                "componentId": { "type": "string" },
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
        let component_id = input
            .get("componentId")
            .and_then(Value::as_str)
            .ok_or_else(|| BitFunError::validation("componentId is required"))?;
        let manifest: AgentComponentJsToolManifest = serde_json::from_value(
            input
                .get("manifest")
                .cloned()
                .ok_or_else(|| BitFunError::validation("manifest is required"))?,
        )?;
        let source = input
            .get("source")
            .and_then(Value::as_str)
            .ok_or_else(|| BitFunError::validation("source is required"))?;
        let tool_name = AgentComponentManager::create_js_tool(
            component_id,
            input.get("level").map(|v| parse_level(Some(v))),
            workspace_root(context).as_deref(),
            manifest,
            source.to_string(),
        )?;
        AgentComponentManager::register_runtime_tools(workspace_root(context).as_deref()).await?;
        Ok(vec![ToolResult::ok(
            json!({ "toolName": tool_name }),
            Some(format!("Created JS runtime tool {tool_name}.")),
        )])
    }
}

pub struct TestAgentComponentJsToolTool;

#[async_trait]
impl Tool for TestAgentComponentJsToolTool {
    fn name(&self) -> &str {
        "TestAgentComponentJsTool"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("Run an Agent Component JavaScript runtime tool with test input.".to_string())
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["componentId", "toolName", "input"],
            "properties": {
                "componentId": { "type": "string" },
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
        let component_id = input
            .get("componentId")
            .and_then(Value::as_str)
            .ok_or_else(|| BitFunError::validation("componentId is required"))?;
        let tool_name = input
            .get("toolName")
            .and_then(Value::as_str)
            .ok_or_else(|| BitFunError::validation("toolName is required"))?;
        let tool_input = input.get("input").unwrap_or(&Value::Null);
        let result = AgentComponentManager::test_js_tool(
            component_id,
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
