//! Tray icon loading and state management

use log::{debug, warn};
use tauri::{image::Image, Manager};

/// Represents the visual state of the tray icon.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IconState {
    Idle,
    Running,
    WaitingUser,
    Error,
}

impl IconState {
    pub fn resource_name(self) -> &'static str {
        match self {
            IconState::Idle => "icons/tray/tray-idle.png",
            IconState::Running => "icons/tray/tray-running.png",
            IconState::WaitingUser => "icons/tray/tray-waiting.png",
            IconState::Error => "icons/tray/tray-error.png",
        }
    }

    pub fn tooltip(self, running_count: usize) -> String {
        match self {
            IconState::Idle => "Sparo OS".to_string(),
            IconState::Running => {
                if running_count == 1 {
                    "Sparo OS - 1 Agent running".to_string()
                } else {
                    format!("Sparo OS - {} Agents running", running_count)
                }
            }
            IconState::WaitingUser => "Sparo OS - Waiting for confirmation".to_string(),
            IconState::Error => "Sparo OS - Task error".to_string(),
        }
    }
}

/// Load a tray icon image from the application resource directory.
pub fn load_icon(app: &tauri::AppHandle, state: IconState) -> Option<Image<'static>> {
    let resource_name = state.resource_name();
    match app
        .path()
        .resolve(resource_name, tauri::path::BaseDirectory::Resource)
    {
        Ok(path) => match std::fs::read(&path) {
            Ok(bytes) => match Image::from_bytes(bytes.leak()) {
                Ok(img) => {
                    debug!("Loaded tray icon: {}", resource_name);
                    Some(img)
                }
                Err(e) => {
                    warn!("Failed to decode tray icon {}: {}", resource_name, e);
                    None
                }
            },
            Err(e) => {
                warn!("Failed to read tray icon file {}: {}", path.display(), e);
                None
            }
        },
        Err(e) => {
            warn!(
                "Failed to resolve tray icon resource {}: {}",
                resource_name, e
            );
            None
        }
    }
}
