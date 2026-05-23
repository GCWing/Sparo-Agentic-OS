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
    pub gui: Vec<String>,
    #[serde(default)]
    pub secrets: Vec<String>,
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
    pub actions: Vec<BridgeAppAction>,
    #[serde(default)]
    pub permissions: BridgeAppPermissions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAppPackage {
    pub manifest: BridgeAppManifest,
    pub path: String,
}
