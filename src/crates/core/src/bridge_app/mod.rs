//! Bridge App packages for adapting external applications and runtimes.
//!
//! Bridge Apps are siblings of Agent Apps. They expose external CLI, SDK, GUI,
//! service, MCP, or daemon capabilities through Sparo-compatible surfaces.

pub mod builtin;
pub mod events;
pub mod manager;
pub mod manifest;
pub mod registry;
pub mod runtime;

pub use events::{BridgeAppEvent, BridgeAppRunStatus};
pub use manager::{BridgeAppAgent, BridgeAppManager, BridgeAppRun, BridgeAppRunResult};
pub use manifest::{
    BridgeAppAction, BridgeAppCapability, BridgeAppConsumer, BridgeAppConsumerKind, BridgeAppKind,
    BridgeAppLifecycle, BridgeAppManifest, BridgeAppPackage, BridgeAppPermissions,
    BridgeAppRuntime, BridgeAppRuntimeLanguage, BridgeAppSurfaces, BridgeAppToolDefinition,
};
pub use registry::BridgeAppRegistry;
