//! Theme system: data + bootstrap init script + window background color helper.
//!
//! Window creation and the Agent Companion floating window live in
//! `crate::window`; the menu-event handler that resolves Agent Companion
//! context-menu IDs lives in `crate::window::companion_window`.

use dark_light::Mode;
use serde_json::Value;
use sparo_core::service::config::types::GlobalConfig;
use std::{fs, path::Path};

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

impl ThemeConfig {
    pub fn get_builtin_theme(theme_id: &str) -> Option<Self> {
        match theme_id {
            "slate" => Some(Self {
                id: theme_id.to_string(),
                bg_primary: "#14161a".to_string(),
                bg_secondary: "#22262c".to_string(),
                bg_scene: "#22262c".to_string(),
                is_light: false,
                text_primary: "#eef0f3".to_string(),
                text_muted: "rgba(255, 255, 255, 0.4)".to_string(),
                accent_color: "#B7372F".to_string(),
            }),
            "dark" => Some(Self {
                id: theme_id.to_string(),
                bg_primary: "#0e0e10".to_string(),
                bg_secondary: "#1c1c1f".to_string(),
                bg_scene: "#1c1c1f".to_string(),
                is_light: false,
                text_primary: "#e8e8e8".to_string(),
                text_muted: "rgba(255, 255, 255, 0.4)".to_string(),
                accent_color: "#B7372F".to_string(),
            }),
            "sparo-cyber" => Some(Self {
                id: theme_id.to_string(),
                bg_primary: "#101010".to_string(),
                bg_secondary: "#151515".to_string(),
                bg_scene: "#141414".to_string(),
                is_light: false,
                text_primary: "#e0f2ff".to_string(),
                text_muted: "rgba(255, 255, 255, 0.4)".to_string(),
                accent_color: "#00e6ff".to_string(),
            }),
            "sparo-china-night" => Some(Self {
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
            "sparo-china-style" => Some(Self {
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

    pub fn from_startup_config_file(config_path: &Path) -> Self {
        match Self::try_from_startup_config_file(config_path) {
            Ok(theme) => theme,
            Err(error) => {
                log::warn!(
                    "Failed to resolve startup theme from persisted config; using system fallback: {}",
                    error
                );
                Self::system_fallback()
            }
        }
    }

    fn try_from_startup_config_file(config_path: &Path) -> Result<Self, String> {
        if !config_path.exists() {
            return Ok(Self::system_fallback());
        }

        let content = fs::read_to_string(config_path)
            .map_err(|error| format!("Failed to read config file: {error}"))?;
        let config: Value = serde_json::from_str(&content)
            .map_err(|error| format!("Failed to parse config file as JSON: {error}"))?;
        Self::from_startup_config_value(&config)
    }

    fn from_startup_config_value(config: &Value) -> Result<Self, String> {
        let theme_id = config
            .pointer("/themes/current")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("system");
        Self::from_theme_selection(
            theme_id,
            config
                .pointer("/themes/custom")
                .and_then(Value::as_array)
                .map(Vec::as_slice),
        )
    }

    /// Resolve the native bootstrap theme from the authoritative typed config.
    pub fn from_global_config(global_config: &GlobalConfig) -> Result<Self, String> {
        let theme_id = global_config.themes.current.as_str();
        Self::from_theme_selection(theme_id, global_config.themes.custom.as_deref())
    }

    fn from_theme_selection(
        theme_id: &str,
        custom_themes: Option<&[serde_json::Value]>,
    ) -> Result<Self, String> {
        let resolved_id = Self::resolve_builtin_theme_id(theme_id);
        if let Some(config) = Self::get_builtin_theme(resolved_id) {
            return Ok(config);
        }

        let custom_theme = custom_themes
            .and_then(|themes| {
                themes.iter().find(|theme| {
                    theme.get("id").and_then(serde_json::Value::as_str) == Some(theme_id)
                })
            })
            .ok_or_else(|| format!("Configured theme '{theme_id}' is not available"))?;
        Self::from_custom_theme(custom_theme)
    }

    fn system_fallback() -> Self {
        Self::get_builtin_theme(Self::resolve_builtin_theme_id("system"))
            .or_else(|| Self::get_builtin_theme("light"))
            .expect("builtin light theme must be available")
    }

    fn resolve_builtin_theme_id(theme_id: &str) -> &str {
        if theme_id == "system" {
            return match dark_light::detect() {
                Mode::Dark => "dark",
                Mode::Light | Mode::Default => "light",
            };
        }
        theme_id
    }

    fn from_custom_theme(theme: &serde_json::Value) -> Result<Self, String> {
        fn required_string(theme: &serde_json::Value, pointer: &str) -> Result<String, String> {
            theme
                .pointer(pointer)
                .and_then(serde_json::Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string)
                .ok_or_else(|| format!("Custom theme is missing string value at '{pointer}'"))
        }

        let id = required_string(theme, "/id")?;
        let theme_type = required_string(theme, "/type")?;
        if !matches!(theme_type.as_str(), "light" | "dark") {
            return Err(format!(
                "Custom theme '{id}' has unsupported type '{theme_type}'"
            ));
        }

        Ok(Self {
            id,
            bg_primary: required_string(theme, "/colors/background/primary")?,
            bg_secondary: required_string(theme, "/colors/background/secondary")?,
            bg_scene: required_string(theme, "/colors/background/scene")?,
            is_light: theme_type == "light",
            text_primary: required_string(theme, "/colors/text/primary")?,
            text_muted: required_string(theme, "/colors/text/muted")?,
            accent_color: required_string(theme, "/colors/accent/500")?,
        })
    }

    pub fn bg_primary_rgb(&self) -> Option<(u8, u8, u8)> {
        parse_hex_rgb(&self.bg_primary)
    }

    fn theme_type(&self) -> &'static str {
        if self.is_light {
            "light"
        } else {
            "dark"
        }
    }

    pub fn generate_startup_bootstrap_script(&self) -> String {
        let payload = serde_json::json!({
            "id": self.id,
            "type": self.theme_type(),
            "bg": self.bg_primary,
        });
        let payload = serde_json::to_string(&payload)
            .expect("startup theme bootstrap payload must be JSON serializable");

        format!(
            r#"
            (function() {{
                try {{
                    var params = new URLSearchParams(window.location.search);
                    if (params.get('sparoWindow') === 'agent-companion') return;
                }} catch (_) {{}}

                var theme = {payload};
                window.__SPARO_STARTUP_THEME__ = theme;
                try {{
                    window.localStorage.setItem('sparo:theme-bootstrap', JSON.stringify(theme));
                }} catch (_) {{}}

                function applyStartupTheme() {{
                    var root = document.documentElement;
                    if (!root) return;
                    root.setAttribute('data-theme', theme.id);
                    root.setAttribute('data-theme-type', theme.type);
                    root.style.setProperty('--color-bg-primary', theme.bg);
                    root.style.backgroundColor = theme.bg;
                    if (document.body) {{
                        document.body.style.backgroundColor = theme.bg;
                    }}
                }}

                applyStartupTheme();
                if (document.readyState === 'loading') {{
                    document.addEventListener('DOMContentLoaded', applyStartupTheme);
                }}
            }})();
            "#,
            payload = payload,
        )
    }

    pub fn generate_init_script(&self) -> String {
        let theme_type = self.theme_type();
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

pub fn parse_hex_rgb(input: &str) -> Option<(u8, u8, u8)> {
    let raw = input.trim().trim_start_matches('#');
    match raw.len() {
        6 => {
            let r = u8::from_str_radix(&raw[0..2], 16).ok()?;
            let g = u8::from_str_radix(&raw[2..4], 16).ok()?;
            let b = u8::from_str_radix(&raw[4..6], 16).ok()?;
            Some((r, g, b))
        }
        3 => {
            let r = u8::from_str_radix(&raw[0..1], 16).ok()?;
            let g = u8::from_str_radix(&raw[1..2], 16).ok()?;
            let b = u8::from_str_radix(&raw[2..3], 16).ok()?;
            Some((r * 17, g * 17, b * 17))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_hex_rgb, ThemeConfig};
    use serde_json::json;

    #[test]
    fn startup_config_uses_builtin_light_theme() {
        let theme = ThemeConfig::from_startup_config_value(&json!({
            "themes": {
                "current": "light"
            }
        }))
        .expect("light theme should resolve");

        assert_eq!(theme.id, "light");
        assert_eq!(theme.bg_primary, "#F8FAFC");
        assert!(theme.is_light);
    }

    #[test]
    fn startup_config_uses_custom_theme_background() {
        let theme = ThemeConfig::from_startup_config_value(&json!({
            "themes": {
                "current": "custom-startup",
                "custom": [{
                    "id": "custom-startup",
                    "type": "light",
                    "colors": {
                        "background": {
                            "primary": "#abc123",
                            "secondary": "#ffffff",
                            "scene": "#fefefe"
                        },
                        "text": {
                            "primary": "#111111",
                            "muted": "#555555"
                        },
                        "accent": {
                            "500": "#B7372F"
                        }
                    }
                }]
            }
        }))
        .expect("custom theme should resolve");

        assert_eq!(theme.id, "custom-startup");
        assert_eq!(theme.bg_primary, "#abc123");
        assert_eq!(theme.bg_primary_rgb(), Some((0xab, 0xc1, 0x23)));
    }

    #[test]
    fn hex_rgb_supports_short_and_long_forms() {
        assert_eq!(parse_hex_rgb("#abc"), Some((0xaa, 0xbb, 0xcc)));
        assert_eq!(parse_hex_rgb("F8FAFC"), Some((0xf8, 0xfa, 0xfc)));
        assert_eq!(parse_hex_rgb("rgba(0, 0, 0, 0.5)"), None);
    }
}
