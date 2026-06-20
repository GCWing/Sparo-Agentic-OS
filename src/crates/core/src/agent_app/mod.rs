//! Agent App packages for Sparo-native agent customization.

pub mod builtin;
pub mod js_runtime;
pub mod manager;
pub mod manifest;

pub use manager::{
    slugify_agent_app_id, validate_agent_app_id, AgentAppAgent, AgentAppManager,
    AgentAppRuntimeToolAdapter, AGENT_APP_EXAMPLES, AGENT_APP_MANIFEST, AGENT_APP_PROMPT,
    AGENT_APP_SCHEMA_VERSION,
};
pub use manifest::{
    AgentAppBridgeCapabilityRef, AgentAppExample, AgentAppInfo, AgentAppJsToolManifest,
    AgentAppLevel, AgentAppManifest, AgentAppPackage, AgentAppServiceAction,
    AgentAppServiceBridgeCall, AgentAppToolPolicy, JsToolFsPermissions, JsToolNetPermissions,
    JsToolPermissions, JsToolShellPermissions,
};
