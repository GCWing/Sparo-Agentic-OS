//! Agent Component packages for Sparo-native agent customization.

pub mod builtin;
pub mod js_runtime;
pub mod manager;
pub mod manifest;

pub use manager::{
    slugify_agent_component_id, validate_agent_component_id, AgentComponentAgent,
    AgentComponentManager, AgentComponentRuntimeToolAdapter, AGENT_COMPONENT_EXAMPLES,
    AGENT_COMPONENT_MANIFEST, AGENT_COMPONENT_PROMPT, AGENT_COMPONENT_SCHEMA_VERSION,
};
pub use manifest::{
    AgentComponentBridgeCapabilityRef, AgentComponentExample, AgentComponentInfo,
    AgentComponentJsToolManifest, AgentComponentLevel, AgentComponentManifest,
    AgentComponentPackage, AgentComponentServiceAction, AgentComponentServiceBridgeComponentCall,
    AgentComponentToolPolicy, JsToolFsPermissions, JsToolNetPermissions, JsToolPermissions,
    JsToolShellPermissions,
};
