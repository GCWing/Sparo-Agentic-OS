//! Tray icon event controller: handles left/right click and double-click.

use log::debug;
use tauri::Manager;

/// Toggle the main application window visibility.
pub fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };

    let is_visible = main.is_visible().unwrap_or(false);
    let is_focused = main.is_focused().unwrap_or(false);

    if is_visible && is_focused {
        debug!("Tray left-click: hiding main window");
        let _ = main.hide();
    } else if is_visible {
        // Visible but not focused: bring to front
        debug!("Tray left-click: focusing main window");
        let _ = main.set_focus();
    } else {
        debug!("Tray left-click: showing main window");
        show_main_window(app);
    }
}

/// Unconditionally show and focus the main window.
pub fn show_main_window(app: &tauri::AppHandle) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let _ = main.show();
    let _ = main.unminimize();
    let _ = main.set_focus();
}
