/// Events Layer
///
/// Independent event definition layer, providing:
/// - EventEmitter trait (event sending interface)
/// - Various event type definitions
/// - Event abstraction independent of platforms
pub mod agentic;
pub mod config;
pub mod emitter;

pub use agentic::{
    AgenticEvent, AgenticEventDeliveryClass, AgenticEventEnvelope, AgenticEventPriority,
    SubagentParentInfo, ToolEventData,
};
pub use config::{
    published_config_error_code, published_settings_agent_error_code, ConfigApplyStatus,
    ConfigApplyStatusEvent, ConfigApplyStrategy, ConfigChangeSource, ConfigChangeSourceKind,
    ConfigCommittedEvent, ConfigRolledBackEvent, ConfigScope, ConfigScopeKind, ConfigStoredValue,
    ConfigValueChange, PublishedConfigApplyStatusEvent, PublishedConfigCommittedEvent,
    PublishedConfigRolledBackEvent, PublishedConfigValueChange, SettingsSectionRef,
};
pub use emitter::EventEmitter;
