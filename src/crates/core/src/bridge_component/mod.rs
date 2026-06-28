//! Bridge Component packages for adapting external applications and runtimes.
//!
//! Bridge Components are siblings of Agent Components. They expose external CLI, SDK, GUI,
//! service, MCP, or daemon capabilities through Sparo-compatible surfaces.

pub mod builtin;
pub mod events;
pub mod manager;
pub mod manifest;
pub mod registry;
pub mod runtime;

pub use events::{BridgeComponentEvent, BridgeComponentRunStatus};
pub use manager::{
    BridgeComponentAgent, BridgeComponentManager, BridgeComponentRun, BridgeComponentRunResult,
};
pub use manifest::{
    BridgeComponentAction, BridgeComponentCapability, BridgeComponentConsumer,
    BridgeComponentConsumerKind, BridgeComponentKind, BridgeComponentLifecycle,
    BridgeComponentManifest, BridgeComponentPackage, BridgeComponentPermissions,
    BridgeComponentRuntime, BridgeComponentRuntimeLanguage, BridgeComponentSurfaces,
    BridgeComponentToolDefinition,
};
pub use registry::BridgeComponentRegistry;
