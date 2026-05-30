pub mod adapters;
pub mod emitter;
pub mod event_bus;
pub mod events;
/// Sparo OS Transport Layer
///
/// Desktop and CLI communication abstraction layer.
pub mod traits;

pub use adapters::{CliEvent, CliTransportAdapter};
pub use emitter::TransportEmitter;
pub use event_bus::{EventBus, EventPriority};
pub use events::{
    AgenticEventPayload, BackendEventPayload, FileWatchEventPayload, ProfileEventPayload,
    SnapshotEventPayload, UnifiedEvent,
};
pub use traits::{StreamEvent, TextChunk, ToolEventPayload, ToolEventType, TransportAdapter};

#[cfg(feature = "tauri-adapter")]
pub use adapters::TauriTransportAdapter;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
