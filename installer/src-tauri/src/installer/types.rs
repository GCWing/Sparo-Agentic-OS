use serde::{Deserialize, Serialize};

/// Installation options passed from the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstallOptions {
    /// Target installation directory
    pub install_path: String,
    /// Create a desktop shortcut
    pub desktop_shortcut: bool,
    /// Add to Start Menu
    pub start_menu: bool,
    /// Register right-click context menu ("Open with Sparo OS")
    pub context_menu: bool,
    /// Add to system PATH
    pub add_to_path: bool,
}

/// Progress update sent to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    /// Current step name
    pub step: String,
    /// Progress percentage (0-100)
    pub percent: u32,
    /// Human-readable status message
    pub message: String,
}

/// Disk space information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSpaceInfo {
    /// Total disk space in bytes
    pub total: u64,
    /// Available disk space in bytes
    pub available: u64,
    /// Required space in bytes (estimated)
    pub required: u64,
    /// Whether there is enough space
    pub sufficient: bool,
}

impl Default for InstallOptions {
    fn default() -> Self {
        Self {
            install_path: String::new(),
            desktop_shortcut: true,
            start_menu: true,
            context_menu: true,
            add_to_path: true,
        }
    }
}
