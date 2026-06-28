use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BridgeComponentKind {
    Cli,
    Sdk,
    Gui,
    Service,
    Mcp,
    Daemon,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BridgeComponentRuntimeLanguage {
    JavaScript,
    TypeScript,
    Python,
    Native,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeComponentRuntime {
    pub language: BridgeComponentRuntimeLanguage,
    pub entry: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_manager: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BridgeComponentSurfaces {
    #[serde(default)]
    pub launchable_app: bool,
    #[serde(default)]
    pub agent: bool,
    #[serde(default)]
    pub tool: bool,
    #[serde(default)]
    pub surface_component_backend: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BridgeComponentPermissions {
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
pub enum BridgeComponentConsumerKind {
    AgentComponent,
    SurfaceComponent,
    SurfaceComponentBackend,
    Management,
    System,
}

impl Default for BridgeComponentConsumerKind {
    fn default() -> Self {
        Self::Management
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BridgeComponentConsumer {
    #[serde(default)]
    pub kind: BridgeComponentConsumerKind,
    #[serde(default)]
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BridgeComponentLifecycle {
    #[serde(default)]
    pub streaming: bool,
    #[serde(default)]
    pub cancelable: bool,
    #[serde(default)]
    pub resumable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeComponentCapability {
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
    pub usable_by: Vec<BridgeComponentConsumerKind>,
    #[serde(default)]
    pub input_schema: Value,
    #[serde(default)]
    pub output_schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeComponentAction {
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
pub struct BridgeComponentToolDefinition {
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
pub struct BridgeComponentManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    pub kind: BridgeComponentKind,
    pub runtime: BridgeComponentRuntime,
    #[serde(default)]
    pub surfaces: BridgeComponentSurfaces,
    #[serde(default)]
    pub capabilities: Vec<BridgeComponentCapability>,
    #[serde(default)]
    pub actions: Vec<BridgeComponentAction>,
    #[serde(default)]
    pub tools: Vec<BridgeComponentToolDefinition>,
    #[serde(default)]
    pub lifecycle: BridgeComponentLifecycle,
    #[serde(default)]
    pub permissions: BridgeComponentPermissions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeComponentPackage {
    pub manifest: BridgeComponentManifest,
    pub path: String,
}
