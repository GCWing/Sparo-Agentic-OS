//! Bridge App tools used by Bridge Studio and Agent App builders.

use crate::agent_app::{
    AgentAppBridgeCapabilityRef, AgentAppExample, AgentAppLevel, AgentAppManager, AgentAppManifest,
    AgentAppServiceAction, AgentAppServiceBridgeCall, AGENT_APP_SCHEMA_VERSION,
};
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::bridge_app::manager::BRIDGE_APP_SCHEMA_VERSION;
use crate::bridge_app::{
    BridgeAppAction, BridgeAppCapability, BridgeAppConsumerKind, BridgeAppKind, BridgeAppLifecycle,
    BridgeAppManager, BridgeAppManifest, BridgeAppPermissions, BridgeAppRunStatus,
    BridgeAppRuntime, BridgeAppRuntimeLanguage, BridgeAppSurfaces, BridgeAppToolDefinition,
};
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

pub fn bridge_app_runtime_tool_name(app_id: &str, tool_name: &str) -> String {
    format!("bridgeapp__{}__{}", app_id, tool_name)
}

pub struct BridgeAppRuntimeToolAdapter {
    app_id: String,
    name: String,
    tool: BridgeAppToolDefinition,
}

impl BridgeAppRuntimeToolAdapter {
    pub fn new(app_id: String, tool: BridgeAppToolDefinition) -> Self {
        let name = bridge_app_runtime_tool_name(&app_id, &tool.name);
        Self { app_id, name, tool }
    }

    fn allowed_actions(&self) -> Vec<&str> {
        if self.tool.actions.is_empty() {
            vec![self.tool.action.as_str()]
        } else {
            self.tool.actions.iter().map(String::as_str).collect()
        }
    }

    fn select_action_and_payload(&self, input: &Value) -> BitFunResult<(String, Value)> {
        let requested_action = input.get("action").and_then(Value::as_str);
        let action = requested_action.unwrap_or(&self.tool.action).to_string();
        let allowed_actions = self.allowed_actions();
        if !allowed_actions.iter().any(|allowed| *allowed == action) {
            return Err(BitFunError::validation(format!(
                "Bridge App tool '{}' does not allow action '{}'. Allowed actions: {}",
                self.tool.name,
                action,
                allowed_actions.join(", ")
            )));
        }

        let mut payload = input.clone();
        if let Value::Object(map) = &mut payload {
            map.remove("action");
        }
        Ok((action, payload))
    }
}

fn bridge_run_failure_message(
    tool_name: &str,
    result: &crate::bridge_app::BridgeAppRunResult,
) -> String {
    let mut parts = vec![format!(
        "{} failed during Bridge App action '{}' (run {}).",
        tool_name, result.action, result.run_id
    )];
    if let Some(message) = result
        .output
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .filter(|message| !message.trim().is_empty())
    {
        parts.push(message.trim().to_string());
    } else if let Some(message) = result
        .output
        .get("message")
        .and_then(Value::as_str)
        .filter(|message| !message.trim().is_empty())
    {
        parts.push(message.trim().to_string());
    }
    if let Some(stderr) = result
        .stderr
        .as_deref()
        .map(str::trim)
        .filter(|stderr| !stderr.is_empty())
    {
        parts.push(format!("stderr: {stderr}"));
    }
    parts.join(" ")
}

#[async_trait]
impl Tool for BridgeAppRuntimeToolAdapter {
    fn name(&self) -> &str {
        &self.name
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok(self.tool.description.clone())
    }

    fn input_schema(&self) -> Value {
        self.tool.input_schema.clone()
    }

    fn user_facing_name(&self) -> String {
        self.tool.name.clone()
    }

    fn is_readonly(&self) -> bool {
        self.tool.readonly
    }

    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        self.tool.needs_permissions
    }

    fn tool_ui_metadata(&self) -> Option<Value> {
        self.tool.ui.clone()
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let (action, payload) = self.select_action_and_payload(input)?;
        let workspace_path = context
            .workspace_root()
            .map(|path| path.to_string_lossy().to_string());
        let consumer = crate::bridge_app::BridgeAppConsumer {
            kind: BridgeAppConsumerKind::AgentApp,
            id: context
                .agent_type
                .clone()
                .unwrap_or_else(|| "bridge-app-tool".to_string()),
            session_id: context.session_id.clone(),
            turn_id: context.dialog_turn_id.clone(),
        };
        let result = BridgeAppManager::start_run(
            &self.app_id,
            Some(&self.tool.capability_id),
            &action,
            payload,
            workspace_path,
            consumer,
        )
        .await?;

        if result.status == BridgeAppRunStatus::Failed {
            return Err(BitFunError::tool(bridge_run_failure_message(
                &self.tool.name,
                &result,
            )));
        }

        Ok(vec![ToolResult::ok(
            json!({
                "run_id": result.run_id,
                "bridge_id": result.app_id,
                "capability_id": result.capability_id,
                "action": result.action,
                "status": result.status,
                "output": result.output,
                "events": result.events,
                "stderr": result.stderr,
            }),
            Some(format!(
                "{} finished with status {:?}",
                self.tool.name, result.status
            )),
        )])
    }
}

fn manifest_from_input(input: &Value) -> BitFunResult<BridgeAppManifest> {
    let manifest_value = input
        .get("manifest")
        .cloned()
        .unwrap_or_else(|| input.clone());
    serde_json::from_value(manifest_value).map_err(BitFunError::from)
}

fn bridge_manifest_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["manifest"],
        "properties": {
            "manifest": {
                "type": "object",
                "required": ["schemaVersion", "id", "name", "description", "kind", "runtime", "actions"],
                "properties": {
                    "schemaVersion": { "type": "number" },
                    "id": { "type": "string" },
                    "name": { "type": "string" },
                    "description": { "type": "string" },
                    "kind": { "type": "string", "enum": ["cli", "sdk", "gui", "service", "mcp", "daemon"] },
                    "runtime": {
                        "type": "object",
                        "required": ["language", "entry"],
                        "properties": {
                            "language": { "type": "string", "enum": ["javascript", "typescript", "python", "native"] },
                            "entry": { "type": "string" },
                            "packageManager": { "type": "string" }
                        }
                    },
                    "surfaces": { "type": "object" },
                    "capabilities": { "type": "array" },
                    "actions": { "type": "array" },
                    "lifecycle": { "type": "object" },
                    "permissions": { "type": "object" }
                }
            },
            "overwrite": { "type": "boolean", "default": false }
        }
    })
}

fn slugify_id(value: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in value.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "bridge-app".to_string()
    } else if out
        .chars()
        .next()
        .is_some_and(|ch| ch.is_ascii_alphabetic())
    {
        out
    } else {
        format!("bridge-{out}")
    }
}

fn standard_action(name: &str, description: &str) -> BridgeAppAction {
    BridgeAppAction {
        name: name.to_string(),
        description: description.to_string(),
        input_schema: json!({ "type": "object" }),
        output_schema: json!({ "type": "object" }),
        streaming: matches!(name, "start" | "resume"),
        cancelable: name == "start",
        resumable: name == "start",
    }
}

fn bridge_kind(value: &str) -> BitFunResult<BridgeAppKind> {
    match value {
        "cli" => Ok(BridgeAppKind::Cli),
        "sdk" => Ok(BridgeAppKind::Sdk),
        "gui" => Ok(BridgeAppKind::Gui),
        "service" => Ok(BridgeAppKind::Service),
        "mcp" => Ok(BridgeAppKind::Mcp),
        "daemon" => Ok(BridgeAppKind::Daemon),
        other => Err(BitFunError::validation(format!(
            "Unsupported Bridge template kind: {other}"
        ))),
    }
}

fn runtime_language_for_kind(kind: BridgeAppKind) -> BridgeAppRuntimeLanguage {
    match kind {
        BridgeAppKind::Cli
        | BridgeAppKind::Sdk
        | BridgeAppKind::Gui
        | BridgeAppKind::Service
        | BridgeAppKind::Mcp
        | BridgeAppKind::Daemon => BridgeAppRuntimeLanguage::JavaScript,
    }
}

fn write_text(path: &Path, text: &str) -> BitFunResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, text)?;
    Ok(())
}

fn template_worker_source() -> &'static str {
    r#"const readline = require("node:readline");

let activeRequest = null;

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function runIdOf(request) {
  return request.runId || request.run_id || `bridge-run-${Date.now()}`;
}

function workspacePathOf(request) {
  return request.workspacePath || request.workspace_path || process.cwd();
}

async function readRequest() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed) return JSON.parse(trimmed);
  }
  return {};
}

async function main() {
  activeRequest = await readRequest();
  const runId = runIdOf(activeRequest);
  const action = activeRequest.action;
  emit({ type: "run.started", runId });

  try {
    switch (action) {
      case "health":
        emit({
          type: "run.completed",
          output: {
            ok: true,
            workspacePath: workspacePathOf(activeRequest),
            bridgeId: activeRequest.bridgeId || activeRequest.bridge_id,
            capabilityId: activeRequest.capabilityId || activeRequest.capability_id
          }
        });
        return;
      case "setup":
        emit({ type: "text.delta", text: "Setup completed.\n" });
        emit({ type: "run.completed", output: { ok: true } });
        return;
      case "start":
        emit({ type: "text.delta", text: "Bridge template run started.\n" });
        emit({
          type: "artifact.created",
          artifact: { kind: "log", title: "Template run", content: "Replace worker.js with adapter logic." }
        });
        emit({ type: "run.completed", output: { status: "completed" } });
        return;
      case "status":
      case "resume":
      case "cancel":
      case "artifacts":
        emit({ type: "run.completed", output: { status: "notTracked", action } });
        return;
      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  } catch (error) {
    emit({ type: "run.failed", error: { message: error instanceof Error ? error.message : String(error) } });
    process.exitCode = 1;
  }
}

main();
"#
}

fn package_json_source(id: &str) -> String {
    format!(
        r#"{{
  "name": "@sparo/bridge-app-{id}",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "scripts": {{
    "smoke": "node worker.js"
  }}
}}
"#
    )
}

fn readme_source(name: &str, capability_id: &str) -> String {
    format!(
        r#"# {name}

This Bridge App exposes `{capability_id}` through the standard Bridge lifecycle actions:

- health
- setup
- start
- status
- resume
- cancel
- artifacts

Replace `worker.js` with the real SDK, CLI, GUI, service, daemon, or MCP adapter logic.
"#
    )
}

pub struct ListBridgeAppsTool;

#[async_trait]
impl Tool for ListBridgeAppsTool {
    fn name(&self) -> &str {
        "ListBridgeApps"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("List installed Bridge Apps and their declared capabilities.".to_string())
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
        let apps = BridgeAppManager::list()?;
        Ok(vec![ToolResult::ok(
            json!({ "apps": apps }),
            Some(format!("Found {} Bridge Apps.", apps.len())),
        )])
    }
}

pub struct GetBridgeAppTool;

#[async_trait]
impl Tool for GetBridgeAppTool {
    fn name(&self) -> &str {
        "GetBridgeApp"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("Read a complete Bridge App package manifest.".to_string())
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["id"],
            "properties": { "id": { "type": "string" } }
        })
    }
    fn is_readonly(&self) -> bool {
        true
    }
    async fn call_impl(
        &self,
        input: &Value,
        _context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let id = input
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| BitFunError::validation("id is required"))?;
        let package = BridgeAppManager::get(id)?;
        Ok(vec![ToolResult::ok(
            json!({ "package": package }),
            Some(format!("Loaded Bridge App '{}'.", id)),
        )])
    }
}

pub struct ValidateBridgeAppPackageTool;

#[async_trait]
impl Tool for ValidateBridgeAppPackageTool {
    fn name(&self) -> &str {
        "ValidateBridgeAppPackage"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("Validate a Bridge App manifest before writing it.".to_string())
    }
    fn input_schema(&self) -> Value {
        bridge_manifest_schema()
    }
    fn is_readonly(&self) -> bool {
        true
    }
    async fn call_impl(
        &self,
        input: &Value,
        _context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let mut manifest = manifest_from_input(input)?;
        BridgeAppManager::validate_manifest(&mut manifest)?;
        Ok(vec![ToolResult::ok(
            json!({ "valid": true, "manifest": manifest }),
            Some("Bridge App manifest is valid.".to_string()),
        )])
    }
}

pub struct CreateBridgeAppTool;

#[async_trait]
impl Tool for CreateBridgeAppTool {
    fn name(&self) -> &str {
        "CreateBridgeApp"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("Create and register a Bridge App manifest.".to_string())
    }
    fn input_schema(&self) -> Value {
        bridge_manifest_schema()
    }
    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        true
    }
    async fn call_impl(
        &self,
        input: &Value,
        _context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let manifest = manifest_from_input(input)?;
        let overwrite = input
            .get("overwrite")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let package = BridgeAppManager::create_or_update(manifest, overwrite)?;
        Ok(vec![ToolResult::ok(
            json!({ "package": package }),
            Some("Bridge App created.".to_string()),
        )])
    }
}

pub struct UpdateBridgeAppTool;

#[async_trait]
impl Tool for UpdateBridgeAppTool {
    fn name(&self) -> &str {
        "UpdateBridgeApp"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok("Update an existing Bridge App manifest.".to_string())
    }
    fn input_schema(&self) -> Value {
        bridge_manifest_schema()
    }
    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        true
    }
    async fn call_impl(
        &self,
        input: &Value,
        _context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let manifest = manifest_from_input(input)?;
        let package = BridgeAppManager::create_or_update(manifest, true)?;
        Ok(vec![ToolResult::ok(
            json!({ "package": package }),
            Some("Bridge App updated.".to_string()),
        )])
    }
}

pub struct CreateBridgeAppTemplateTool;

#[async_trait]
impl Tool for CreateBridgeAppTemplateTool {
    fn name(&self) -> &str {
        "CreateBridgeAppTemplate"
    }
    async fn description(&self) -> BitFunResult<String> {
        Ok(
            "Create a Bridge App template package and optionally generate its Agent App wrapper."
                .to_string(),
        )
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["name", "description", "kind"],
            "properties": {
                "id": { "type": "string", "description": "Stable Bridge App id. Defaults to a slug from name." },
                "name": { "type": "string" },
                "description": { "type": "string" },
                "kind": { "type": "string", "enum": ["sdk", "cli", "gui", "service", "daemon", "mcp"] },
                "capabilityId": { "type": "string", "description": "Stable capability id. Defaults to <bridge-id>.default." },
                "capabilityTitle": { "type": "string" },
                "category": { "type": "string" },
                "overwrite": { "type": "boolean", "default": false },
                "generateAgentAppWrapper": { "type": "boolean", "default": true },
                "generateLiveAppBindingExample": { "type": "boolean", "default": true }
            }
        })
    }
    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        true
    }
    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let name = input
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| BitFunError::validation("name is required"))?
            .trim();
        let description = input
            .get("description")
            .and_then(Value::as_str)
            .ok_or_else(|| BitFunError::validation("description is required"))?
            .trim();
        let kind = bridge_kind(input.get("kind").and_then(Value::as_str).unwrap_or("sdk"))?;
        let bridge_id = input
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| slugify_id(name));
        let capability_id = input
            .get("capabilityId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("{bridge_id}.default"));
        let capability_title = input
            .get("capabilityTitle")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(name);
        let category = input
            .get("category")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(match kind {
                BridgeAppKind::Gui => "guiAgent",
                BridgeAppKind::Sdk => "externalAgent",
                BridgeAppKind::Cli => "cli",
                BridgeAppKind::Service => "service",
                BridgeAppKind::Mcp => "mcp",
                BridgeAppKind::Daemon => "daemon",
            });
        let overwrite = input
            .get("overwrite")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let generate_agent = input
            .get("generateAgentAppWrapper")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let generate_live_binding = input
            .get("generateLiveAppBindingExample")
            .and_then(Value::as_bool)
            .unwrap_or(true);

        let action_names = [
            (
                "health",
                "Check dependency, permission, and configuration readiness.",
            ),
            (
                "setup",
                "Install or prepare dependencies needed by this Bridge App.",
            ),
            ("start", "Start the capability run."),
            ("status", "Return current or last known run status."),
            ("resume", "Resume or re-observe a resumable run."),
            (
                "cancel",
                "Cancel a running external operation when supported.",
            ),
            ("artifacts", "Return artifacts produced by a run."),
        ];
        let actions: Vec<BridgeAppAction> = action_names
            .iter()
            .map(|(name, description)| standard_action(name, description))
            .collect();

        let mut gui_permissions = Vec::new();
        if kind == BridgeAppKind::Gui {
            gui_permissions.push(json!({
                "appName": capability_title,
                "automation": ["observe", "keyboard", "mouse", "accessibility"],
                "confirmationPolicy": "onHighRiskAction"
            }));
        }

        let manifest = BridgeAppManifest {
            schema_version: BRIDGE_APP_SCHEMA_VERSION,
            id: bridge_id.clone(),
            name: name.to_string(),
            description: description.to_string(),
            kind,
            runtime: BridgeAppRuntime {
                language: runtime_language_for_kind(kind),
                entry: "worker.js".to_string(),
                package_manager: Some("npm".to_string()),
            },
            surfaces: BridgeAppSurfaces {
                launchable_app: false,
                agent: false,
                tool: false,
                live_app_backend: true,
            },
            capabilities: vec![BridgeAppCapability {
                id: capability_id.clone(),
                title: capability_title.to_string(),
                description: description.to_string(),
                category: category.to_string(),
                actions: actions.iter().map(|action| action.name.clone()).collect(),
                streaming: true,
                cancelable: true,
                resumable: true,
                usable_by: vec![
                    BridgeAppConsumerKind::AgentApp,
                    BridgeAppConsumerKind::LiveAppBackend,
                    BridgeAppConsumerKind::Management,
                ],
                input_schema: json!({ "type": "object" }),
                output_schema: json!({ "type": "object" }),
            }],
            actions,
            tools: Vec::new(),
            lifecycle: BridgeAppLifecycle {
                streaming: true,
                cancelable: true,
                resumable: true,
            },
            permissions: BridgeAppPermissions {
                fs: vec!["{workspace}".to_string(), "{app}".to_string()],
                net: Vec::new(),
                shell: vec!["node".to_string()],
                gui: gui_permissions,
                secrets: Vec::new(),
            },
        };
        let package = BridgeAppManager::create_or_update(manifest, overwrite)?;
        let app_dir = BridgeAppManager::app_dir(&bridge_id);
        let mut files = vec![app_dir.join("manifest.json").to_string_lossy().to_string()];
        let package_json = package_json_source(&bridge_id);
        let readme = readme_source(name, &capability_id);
        for (path, text) in [
            (
                app_dir.join("worker.js"),
                template_worker_source().to_string(),
            ),
            (app_dir.join("package.json"), package_json),
            (app_dir.join("README.md"), readme),
            (
                app_dir.join("schemas").join("input.schema.json"),
                "{\n  \"type\": \"object\"\n}\n".to_string(),
            ),
            (
                app_dir.join("tests").join("smoke.request.json"),
                json!({
                    "bridgeId": bridge_id,
                    "capabilityId": capability_id,
                    "action": "health",
                    "runId": "smoke-health",
                    "input": {},
                    "consumer": { "kind": "management", "id": "bridge-studio" }
                })
                .to_string(),
            ),
        ] {
            write_text(&path, &text)?;
            files.push(path.to_string_lossy().to_string());
        }
        std::fs::create_dir_all(app_dir.join("assets"))?;
        files.push(app_dir.join("assets").to_string_lossy().to_string());

        let mut agent_package = None;
        if generate_agent {
            let agent_id = format!("{}-agent", bridge_id);
            let agent_manifest = AgentAppManifest {
                schema_version: AGENT_APP_SCHEMA_VERSION,
                id: agent_id.clone(),
                name: format!("{name} Agent"),
                description: format!("Conversational wrapper for {name}."),
                icon: "bot".to_string(),
                category: "bridge-wrapper".to_string(),
                tags: vec!["bridge".to_string(), category.to_string()],
                level: AgentAppLevel::User,
                model: "primary".to_string(),
                readonly: false,
                enabled: true,
                tools: vec!["BridgeCall".to_string()],
                skills: Vec::new(),
                subagents: Vec::new(),
                tool_policies: BTreeMap::new(),
                service_actions: vec![AgentAppServiceAction {
                    name: "start".to_string(),
                    description: format!("Start a {name} run through the Bridge capability."),
                    input_schema: json!({ "type": "object" }),
                    output_schema: json!({ "type": "object" }),
                    prompt_template: String::new(),
                    memory: "ephemeral".to_string(),
                    tool_policy: vec!["BridgeCall".to_string()],
                    bridge_call: Some(AgentAppServiceBridgeCall {
                        bridge_id: bridge_id.clone(),
                        capability_id: capability_id.clone(),
                        action: "start".to_string(),
                        mode: "auto".to_string(),
                    }),
                }],
                bridge_capabilities: vec![AgentAppBridgeCapabilityRef {
                    bridge_id: bridge_id.clone(),
                    capability_id: capability_id.clone(),
                    alias: "bridge".to_string(),
                    mode: "auto".to_string(),
                }],
                examples: vec![AgentAppExample {
                    title: format!("Use {name}"),
                    prompt: format!("Use {name} to inspect this workspace and report the result."),
                }],
            };
            let prompt = format!(
                "You are the product-facing Agent App wrapper for {name}.\n\nUse BridgeCall for capability `{capability_id}` on Bridge App `{bridge_id}`. Prefer natural user intent over exposing raw Bridge actions. Start with `health` when setup or credentials may be missing, use `start` for work, and summarize artifacts clearly."
            );
            let created = AgentAppManager::create_or_update(
                agent_manifest,
                prompt,
                context.workspace_root(),
                overwrite,
            )?;
            agent_package = Some(created);
        }

        let mut live_binding_files = Vec::new();
        if generate_live_binding {
            let binding_dir = app_dir.join("live-app-binding-example");
            let backend_json = binding_dir.join("backend.json");
            let usage_js = binding_dir.join("usage.js");
            write_text(
                &backend_json,
                &serde_json::to_string_pretty(&json!({
                    "id": "bridge",
                    "kind": "bridgeApp",
                    "appId": bridge_id,
                    "capabilityId": capability_id,
                    "actions": [
                        { "name": "start", "inputSchema": {}, "outputSchema": {} },
                        { "name": "cancel", "inputSchema": {}, "outputSchema": {} }
                    ]
                }))?,
            )?;
            write_text(
                &usage_js,
                "const run = await app.backend.call('bridge.start', input);\nconst status = await app.backend.status(run.runId || run.run_id);\n",
            )?;
            live_binding_files.push(backend_json.to_string_lossy().to_string());
            live_binding_files.push(usage_js.to_string_lossy().to_string());
        }

        Ok(vec![ToolResult::ok(
            json!({
                "package": package,
                "files": files,
                "agentAppWrapper": agent_package,
                "liveAppBindingExample": live_binding_files,
            }),
            Some(format!("Created Bridge App template '{}'.", bridge_id)),
        )])
    }
}
