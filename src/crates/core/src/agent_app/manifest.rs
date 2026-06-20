use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

use super::manager::AGENT_APP_SCHEMA_VERSION;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentAppLevel {
    User,
    Project,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppExample {
    pub title: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppToolPolicy {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allow: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppServiceBridgeCall {
    pub bridge_id: String,
    pub capability_id: String,
    #[serde(default)]
    pub action: String,
    #[serde(default = "default_bridge_mode")]
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppServiceAction {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub input_schema: Value,
    #[serde(default)]
    pub output_schema: Value,
    #[serde(default)]
    pub prompt_template: String,
    #[serde(default)]
    pub memory: String,
    #[serde(default)]
    pub tool_policy: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bridge_call: Option<AgentAppServiceBridgeCall>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppBridgeCapabilityRef {
    pub bridge_id: String,
    pub capability_id: String,
    #[serde(default)]
    pub alias: String,
    #[serde(default = "default_bridge_mode")]
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppManifest {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default = "default_icon")]
    pub icon: String,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_level")]
    pub level: AgentAppLevel,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default)]
    pub readonly: bool,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_tools")]
    pub tools: Vec<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub subagents: Vec<String>,
    #[serde(default)]
    pub tool_policies: BTreeMap<String, AgentAppToolPolicy>,
    #[serde(default)]
    pub service_actions: Vec<AgentAppServiceAction>,
    #[serde(default)]
    pub bridge_capabilities: Vec<AgentAppBridgeCapabilityRef>,
    #[serde(default)]
    pub examples: Vec<AgentAppExample>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppPackage {
    pub manifest: AgentAppManifest,
    pub prompt: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub category: String,
    pub tags: Vec<String>,
    pub level: AgentAppLevel,
    pub model: String,
    pub readonly: bool,
    pub enabled: bool,
    pub tools: Vec<String>,
    pub skills: Vec<String>,
    pub subagents: Vec<String>,
    pub service_actions: Vec<AgentAppServiceAction>,
    pub bridge_capabilities: Vec<AgentAppBridgeCapabilityRef>,
    pub examples: Vec<AgentAppExample>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JsToolPermissions {
    #[serde(default)]
    pub fs: JsToolFsPermissions,
    #[serde(default)]
    pub shell: JsToolShellPermissions,
    #[serde(default)]
    pub net: JsToolNetPermissions,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JsToolFsPermissions {
    #[serde(default)]
    pub read: Vec<String>,
    #[serde(default)]
    pub write: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JsToolShellPermissions {
    #[serde(default)]
    pub allow: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JsToolNetPermissions {
    #[serde(default)]
    pub allow: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppJsToolManifest {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
    pub runtime: String,
    pub entry: String,
    #[serde(default = "default_readonly")]
    pub readonly: bool,
    #[serde(default)]
    pub permissions: JsToolPermissions,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default = "default_max_output_bytes")]
    pub max_output_bytes: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui: Option<Value>,
}

fn default_schema_version() -> u32 {
    AGENT_APP_SCHEMA_VERSION
}

fn default_icon() -> String {
    "bot".to_string()
}

fn default_category() -> String {
    "custom".to_string()
}

fn default_level() -> AgentAppLevel {
    AgentAppLevel::User
}

pub(crate) fn default_model() -> String {
    "primary".to_string()
}

fn default_enabled() -> bool {
    true
}

fn default_bridge_mode() -> String {
    "auto".to_string()
}

fn default_readonly() -> bool {
    true
}

fn default_timeout_ms() -> u64 {
    30_000
}

fn default_max_output_bytes() -> usize {
    200_000
}

pub(crate) fn default_tools() -> Vec<String> {
    vec![
        "LS".to_string(),
        "Read".to_string(),
        "Glob".to_string(),
        "Grep".to_string(),
    ]
}
