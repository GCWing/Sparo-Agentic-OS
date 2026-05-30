use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BridgeAppKind {
    Cli,
    Sdk,
    Gui,
    Service,
    Mcp,
    Daemon,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BridgeAppRuntimeLanguage {
    JavaScript,
    TypeScript,
    Python,
    Native,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAppRuntime {
    pub language: BridgeAppRuntimeLanguage,
    pub entry: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_manager: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAppSurfaces {
    #[serde(default)]
    pub launchable_app: bool,
    #[serde(default)]
    pub agent: bool,
    #[serde(default)]
    pub tool: bool,
    #[serde(default)]
    pub live_app_backend: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAppPermissions {
    #[serde(default)]
    pub fs: Vec<String>,
    #[serde(default)]
    pub net: Vec<String>,
    #[serde(default)]
    pub shell: Vec<String>,
    #[serde(default)]
    pub gui: Vec<Value>,
    #[serde(default)]
    pub secrets: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BridgeAppConsumerKind {
    AgentApp,
    LiveApp,
    LiveAppBackend,
    Management,
    System,
}

impl Default for BridgeAppConsumerKind {
    fn default() -> Self {
        Self::Management
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAppConsumer {
    #[serde(default)]
    pub kind: BridgeAppConsumerKind,
    #[serde(default)]
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAppLifecycle {
    #[serde(default)]
    pub streaming: bool,
    #[serde(default)]
    pub cancelable: bool,
    #[serde(default)]
    pub resumable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAppCapability {
    pub id: String,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub actions: Vec<String>,
    #[serde(default)]
    pub streaming: bool,
    #[serde(default)]
    pub cancelable: bool,
    #[serde(default)]
    pub resumable: bool,
    #[serde(default)]
    pub usable_by: Vec<BridgeAppConsumerKind>,
    #[serde(default)]
    pub input_schema: Value,
    #[serde(default)]
    pub output_schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAppAction {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub input_schema: Value,
    #[serde(default)]
    pub output_schema: Value,
    #[serde(default)]
    pub streaming: bool,
    #[serde(default)]
    pub cancelable: bool,
    #[serde(default)]
    pub resumable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAppToolDefinition {
    pub name: String,
    pub description: String,
    pub capability_id: String,
    pub action: String,
    #[serde(default)]
    pub actions: Vec<String>,
    #[serde(default)]
    pub input_schema: Value,
    #[serde(default)]
    pub readonly: bool,
    #[serde(default)]
    pub needs_permissions: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAppManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    pub kind: BridgeAppKind,
    pub runtime: BridgeAppRuntime,
    #[serde(default)]
    pub surfaces: BridgeAppSurfaces,
    #[serde(default)]
    pub capabilities: Vec<BridgeAppCapability>,
    #[serde(default)]
    pub actions: Vec<BridgeAppAction>,
    #[serde(default)]
    pub tools: Vec<BridgeAppToolDefinition>,
    #[serde(default)]
    pub lifecycle: BridgeAppLifecycle,
    #[serde(default)]
    pub permissions: BridgeAppPermissions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAppPackage {
    pub manifest: BridgeAppManifest,
    pub path: String,
}
