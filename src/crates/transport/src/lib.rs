pub mod adapters;
pub mod emitter;
/// Sparo OS Transport Layer
///
/// Host communication adapters and the bridge to `sparo_events::EventEmitter`.
pub mod traits;

pub use emitter::TransportEmitter;
pub use traits::TransportAdapter;

#[cfg(feature = "tauri-adapter")]
pub use adapters::TauriTransportAdapter;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
