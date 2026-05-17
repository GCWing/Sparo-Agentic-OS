//! Theme system: data + bootstrap init script + window background color helper.
//!
//! Window creation and the Agent Companion floating window live in
//! `crate::window`; the menu-event handler that resolves Agent Companion
//! context-menu IDs lives in `crate::window::companion_window`.

use bitfun_core::infrastructure::try_get_path_manager_arc;
use bitfun_core::service::config::types::GlobalConfig;
use dark_light::Mode;
use log::{debug, warn};

// Re-export window commands so the `tauri::generate_handler!` invocation in
// `lib.rs` keeps its compact import surface.
pub use crate::window::companion_window::{
    handle_context_menu_event as handle_agent_companion_context_menu_event,
    hide_agent_companion_desktop_pet, resize_agent_companion_desktop_pet,
    show_agent_companion_context_menu, show_agent_companion_desktop_pet,
};
pub use crate::window::main_window::show_main_window;

#[derive(Debug, Clone)]
pub struct ThemeConfig {
    pub id: String,
    pub bg_primary: String,
    pub bg_secondary: String,
    pub bg_scene: String,
    pub is_light: bool,
    pub text_primary: String,
    pub text_muted: String,
    pub accent_color: String,
}

impl Default for ThemeConfig {
    fn default() -> Self {
        Self::get_builtin_theme("light").unwrap_or_else(|| Self {
            id: "light".to_string(),
            bg_primary: "#F8FAFC".to_string(),
            bg_secondary: "#FFFFFF".to_string(),
            bg_scene: "#FFFFFF".to_string(),
            is_light: true,
            text_primary: "#0F172A".to_string(),
            text_muted: "#5B6B8C".to_string(),
            accent_color: "#B7372F".to_string(),
        })
    }
}

impl ThemeConfig {
    pub fn get_builtin_theme(theme_id: &str) -> Option<Self> {
        match theme_id {
            "slate" | "bitfun-slate" => Some(Self {
                id: theme_id.to_string(),
                bg_primary: "#14161a".to_string(),
                bg_secondary: "#22262c".to_string(),
                bg_scene: "#22262c".to_string(),
                is_light: false,
                text_primary: "#eef0f3".to_string(),
                text_muted: "rgba(255, 255, 255, 0.4)".to_string(),
                accent_color: "#B7372F".to_string(),
            }),
            "dark" | "bitfun-dark" => Some(Self {
                id: theme_id.to_string(),
                bg_primary: "#0e0e10".to_string(),
                bg_secondary: "#1c1c1f".to_string(),
                bg_scene: "#1c1c1f".to_string(),
                is_light: false,
                text_primary: "#e8e8e8".to_string(),
                text_muted: "rgba(255, 255, 255, 0.4)".to_string(),
                accent_color: "#B7372F".to_string(),
            }),
            "bitfun-cyber" => Some(Self {
                id: theme_id.to_string(),
                bg_primary: "#101010".to_string(),
                bg_secondary: "#151515".to_string(),
                bg_scene: "#141414".to_string(),
                is_light: false,
                text_primary: "#e0f2ff".to_string(),
                text_muted: "rgba(255, 255, 255, 0.4)".to_string(),
                accent_color: "#00e6ff".to_string(),
            }),
            "bitfun-china-night" => Some(Self {
                id: theme_id.to_string(),
                bg_primary: "#1a1814".to_string(),
                bg_secondary: "#141210".to_string(),
                bg_scene: "#1e1c17".to_string(),
                is_light: false,
                text_primary: "#e8e6e1".to_string(),
                text_muted: "rgba(255, 255, 255, 0.4)".to_string(),
                accent_color: "#c4a35a".to_string(),
            }),
            "light" => Some(Self {
                id: theme_id.to_string(),
                bg_primary: "#F8FAFC".to_string(),
                bg_secondary: "#FFFFFF".to_string(),
                bg_scene: "#FFFFFF".to_string(),
                is_light: true,
                text_primary: "#0F172A".to_string(),
                text_muted: "#5B6B8C".to_string(),
                accent_color: "#B7372F".to_string(),
            }),
            "bitfun-china-style" => Some(Self {
                id: theme_id.to_string(),
                bg_primary: "#faf8f0".to_string(),
                bg_secondary: "#f5f3e8".to_string(),
                bg_scene: "#fdfcf6".to_string(),
                is_light: true,
                text_primary: "#1a1a1a".to_string(),
                text_muted: "rgba(0, 0, 0, 0.5)".to_string(),
                accent_color: "#2e5e8a".to_string(),
            }),
            _ => None,
        }
    }

    /// Read the current theme id from the on-disk config. Uses synchronous
    /// IO because this runs once during boot before the async runtime is busy;
    /// the file is in the application config dir (always local) so this is
    /// O(few KB) and not a bottleneck.
    pub fn load_from_config() -> Self {
        let default = Self::default();
        let path_manager = match try_get_path_manager_arc() {
            Ok(pm) => pm,
            Err(e) => {
                debug!("Failed to create PathManager, using default theme: {}", e);
                return default;
            }
        };
        let config_file = path_manager.app_config_file();
        if !config_file.exists() {
            return default;
        }
        let config_content = match std::fs::read_to_string(&config_file) {
            Ok(content) => content,
            Err(e) => {
                debug!("Failed to read config file, using default theme: {}", e);
                return default;
            }
        };
        let global_config: GlobalConfig = match serde_json::from_str(&config_content) {
            Ok(config) => config,
            Err(e) => {
                debug!("Failed to parse config file, using default theme: {}", e);
                return default;
            }
        };
        let theme_id = global_config
            .themes
            .as_ref()
            .map(|t| t.current.as_str())
            .unwrap_or("light");
        let resolved_id = Self::resolve_builtin_theme_id(theme_id);
        match Self::get_builtin_theme(resolved_id) {
            Some(config) => config,
            None => {
                warn!("Unknown theme ID: {}, using default theme", theme_id);
                default
            }
        }
    }

    fn resolve_builtin_theme_id(theme_id: &str) -> &str {
        if theme_id == "sparo-light" || theme_id == "bitfun-light" {
            return "light";
        }
        if theme_id == "bitfun-dark" {
            return "dark";
        }
        if theme_id == "bitfun-slate" {
            return "slate";
        }
        if theme_id == "bitfun-midnight" {
            return "slate";
        }
        if theme_id == "system" {
            return match dark_light::detect() {
                Mode::Dark => "dark",
                Mode::Light | Mode::Default => "light",
            };
        }
        theme_id
    }

    pub fn generate_init_script(&self) -> String {
        let theme_type = if self.is_light { "light" } else { "dark" };
        format!(
            r#"
            (function() {{
                function applyTheme() {{
                    var root = document.documentElement;
                    if (!root) return false;
                    root.setAttribute('data-theme', '{id}');
                    root.setAttribute('data-theme-type', '{theme_type}');
                    root.style.setProperty('--color-bg-primary', '{bg_primary}');
                    root.style.setProperty('--color-bg-secondary', '{bg_secondary}');
                    root.style.setProperty('--color-bg-tertiary', '{bg_primary}');
                    root.style.setProperty('--color-bg-workbench', '{bg_primary}');
                    root.style.setProperty('--color-bg-flowchat', '{bg_scene}');
                    root.style.setProperty('--color-bg-scene', '{bg_scene}');
                    root.style.setProperty('--color-text-primary', '{text_primary}');
                    root.style.backgroundColor = '{bg_primary}';
                    if (document.body) {{
                        document.body.style.backgroundColor = '{bg_primary}';
                    }}
                    return true;
                }}
                if (document.documentElement) {{
                    applyTheme();
                }}
                if (document.readyState === 'loading') {{
                    document.addEventListener('DOMContentLoaded', applyTheme);
                }} else {{
                    applyTheme();
                }}
            }})();
            "#,
            id = self.id,
            theme_type = theme_type,
            bg_primary = self.bg_primary,
            bg_secondary = self.bg_secondary,
            bg_scene = self.bg_scene,
            text_primary = self.text_primary,
        )
    }
}
