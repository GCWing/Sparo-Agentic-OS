//! Main window: configure the window declared in `tauri.conf.json`.
//!
//! The window is declared in the Tauri config (label `main`, hidden) so the
//! capability system can bind permissions to it before any Rust code runs.
//! Here we only:
//!
//!   1. Override the native window background to match the user's last
//!      saved theme — `tauri.conf.json` hardcodes a dark fallback, which
//!      causes a black flash on light-theme cold-starts the moment the
//!      window is shown but before the webview has painted its first
//!      frame. Reading the persisted theme and calling
//!      `set_background_color` before `show_main_window` collapses that
//!      gap into a single same-color frame.
//!   2. Inject the theme bootstrap script before any UI scripts execute.
//!   3. Apply platform decoration tweaks (macOS overlay traffic lights,
//!      Windows decorations=false for our custom titlebar).
//!   4. Expose the `show_main_window` command used by the frontend boot loader
//!      to reveal the window once React has painted.

use bitfun_core::infrastructure::constants::WINDOW_MAIN;
use log::{error, warn};
use tauri::{AppHandle, Manager};

use crate::theme::ThemeConfig;

/// Parse a `#RRGGBB` / `#RGB` hex color into 8-bit RGB. Returns `None` for
/// anything we can't handle (e.g. `rgba(...)`), letting the caller fall back
/// to the Tauri config default.
fn parse_hex_color(input: &str) -> Option<(u8, u8, u8)> {
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

/// Apply theme init script and platform decoration tweaks to the declarative
/// main window. Called from `setup()` once.
pub fn configure(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(WINDOW_MAIN) else {
        return Err(format!("Main window '{}' not declared in tauri.conf.json", WINDOW_MAIN));
    };

    let theme = ThemeConfig::load_from_config();

    // Override the native window background so the system compositor can't
    // flash the hardcoded `tauri.conf.json` color (dark) during the brief
    // window-shown / first-paint gap on light-theme cold starts.
    if let Some((r, g, b)) = parse_hex_color(&theme.bg_primary) {
        if let Err(e) = window.set_background_color(Some(tauri::window::Color(r, g, b, 255))) {
            warn!("Failed to set main window background color: {}", e);
        }
    } else {
        warn!("Theme bg_primary is not a hex color, leaving native window default: {}", theme.bg_primary);
    }

    let init_script = theme.generate_init_script();
    if let Err(e) = window.eval(&init_script) {
        warn!("Failed to inject theme bootstrap script: {}", e);
    }

    #[cfg(target_os = "macos")]
    {
        use tauri::TitleBarStyle;
        if let Err(e) = window.set_title_bar_style(TitleBarStyle::Overlay) {
            warn!("Failed to set macOS overlay title bar: {}", e);
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Err(e) = window.set_decorations(false) {
            warn!("Failed to disable Windows decorations: {}", e);
        }
    }

    Ok(())
}

/// Reveal the main window to the user. Called from the frontend boot loader
/// the moment React has painted the splash so users get immediate feedback.
///
/// No `sleep` hacks: window-state plugin restores geometry; if the window
/// should be maximized that decision was made at declaration time.
#[tauri::command]
pub async fn show_main_window(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(WINDOW_MAIN) else {
        error!("Main window not found");
        return Err("Main window not found".to_string());
    };

    if let Err(e) = window.unminimize() {
        warn!("unminimize failed (likely already normal): {}", e);
    }
    window
        .show()
        .map_err(|e| format!("Failed to show main window: {}", e))?;
    window
        .set_focus()
        .map_err(|e| format!("Failed to focus main window: {}", e))?;

    Ok(())
}
