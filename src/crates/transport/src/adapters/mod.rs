/// Transport adapters for different platforms
pub mod cli;

#[cfg(feature = "tauri-adapter")]
pub mod tauri;

pub use cli::{CliEvent, CliTransportAdapter};

#[cfg(feature = "tauri-adapter")]
pub use tauri::TauriTransportAdapter;
