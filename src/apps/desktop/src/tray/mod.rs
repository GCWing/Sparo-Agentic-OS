//! System tray module.
//!
//! Left-click: toggle (show / hide) the main window.
//! Right-click: native OS context menu, refreshed in the background.
//!
//! # Why we set the menu on the builder
//!
//! `on_tray_icon_event` fires *after* the OS has already started rendering
//! the popup. Calling `tray.set_menu()` inside that callback is therefore
//! too late — the OS shows whatever menu was already attached to the icon.
//! The only reliable way is to keep a menu attached at all times and call
//! `tray.set_menu()` proactively *before* the user right-clicks.
//!
//! Flow:
//!  1. `init_tray` builds a static "skeleton" menu synchronously and attaches
//!     it to the `TrayIconBuilder` via `.menu()`.
//!  2. Stage-C publishes the configuration service into `AppContainer`, then
//!     `request_menu_refresh` builds and attaches the enriched menu.
//!  3. After every menu-event action we call `request_menu_refresh` so the
//!     next open always shows fresh data.

pub mod controller;
pub mod event_subscriber;
pub mod icon;
pub mod status;

use icon::{load_icon, IconState};
use log::{error, warn};
use sparo_core::infrastructure::constants::{
    EVENT_TRAY_NEW_SESSION, EVENT_TRAY_RESTORE_SESSION, WINDOW_MAIN,
};
use sparo_core::service::config::{ConfigService, GlobalConfig};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

// ─────────────────────────────────────────────── Locale helpers ───

struct TrayStrings {
    show_window: &'static str,
    hide_window: &'static str,
    desktop_pet: &'static str,
    new_session: &'static str,
    recent_sessions: &'static str,
    no_recent: &'static str,
    quit: &'static str,
}

const ZH: TrayStrings = TrayStrings {
    show_window: "显示窗口",
    hide_window: "隐藏窗口",
    desktop_pet: "显示桌面宠物",
    new_session: "新建会话",
    recent_sessions: "最近会话",
    no_recent: "暂无最近会话",
    quit: "退出 Sparo OS",
};
const EN: TrayStrings = TrayStrings {
    show_window: "Show Window",
    hide_window: "Hide Window",
    desktop_pet: "Show Desktop Pet",
    new_session: "New Session",
    recent_sessions: "Recent Sessions",
    no_recent: "No Recent Sessions",
    quit: "Quit Sparo OS",
};

fn strings(config: &GlobalConfig) -> &'static TrayStrings {
    if config.app.language.starts_with("zh") {
        &ZH
    } else {
        &EN
    }
}

fn desktop_pet_should_show(config: &GlobalConfig) -> bool {
    config.app.ai_experience.enable_agent_companion
}

fn config_service(app: &AppHandle) -> Option<Arc<ConfigService>> {
    app.try_state::<Arc<crate::bootstrap::AppContainer>>()
        .and_then(|container| container.config_service())
}

#[derive(Debug, Default)]
struct MenuRefreshState {
    requested_generation: u64,
    worker_running: bool,
}

impl MenuRefreshState {
    /// Registers a refresh and returns whether the caller must start the sole
    /// background worker. A running worker observes the newest generation.
    fn request(&mut self) -> bool {
        self.requested_generation = self.requested_generation.wrapping_add(1);
        if self.worker_running {
            false
        } else {
            self.worker_running = true;
            true
        }
    }

    fn current_generation(&self) -> u64 {
        self.requested_generation
    }

    fn is_current(&self, generation: u64) -> bool {
        generation == self.requested_generation
    }

    fn finish(&mut self, generation: u64) -> bool {
        if !self.is_current(generation) {
            return false;
        }
        self.worker_running = false;
        true
    }
}

static MENU_REFRESH_STATE: OnceLock<Mutex<MenuRefreshState>> = OnceLock::new();

fn menu_refresh_state() -> &'static Mutex<MenuRefreshState> {
    MENU_REFRESH_STATE.get_or_init(|| Mutex::new(MenuRefreshState::default()))
}

fn lock_menu_refresh_state() -> std::sync::MutexGuard<'static, MenuRefreshState> {
    menu_refresh_state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

async fn load_global_config(service: &ConfigService) -> Result<GlobalConfig, String> {
    service
        .get_config::<GlobalConfig>(None)
        .await
        .map_err(|error| error.to_string())
}

async fn tray_toggle_desktop_pet(app: &AppHandle) -> Result<(), String> {
    let service = config_service(app)
        .ok_or_else(|| "Configuration service is not ready for tray actions".to_string())?;
    let config = load_global_config(&service).await?;
    crate::window::companion_window::set_enabled(app.clone(), !desktop_pet_should_show(&config))
        .await
}

// ─────────────────────────────────────────────── Initialisation ───

/// Initialise the system tray. Called from `.setup()` in `lib.rs`.
pub fn init_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let icon = load_icon(app, IconState::Idle).ok_or("Could not load tray idle icon")?;

    // Build a minimal synchronous menu to attach right now.
    // Sessions are loaded separately in the background below.
    let initial_menu = build_skeleton_menu(app)?;

    let app_for_event = app.clone();

    TrayIconBuilder::with_id("sparo-main")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Sparo OS")
        .show_menu_on_left_click(false)
        .menu(&initial_menu)
        .on_tray_icon_event(move |_tray, event| {
            let app = app_for_event.clone();
            match event {
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    controller::toggle_main_window(&app);
                }
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } => {
                    controller::show_main_window(&app);
                }
                _ => {}
            }
        })
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id().as_ref());
        })
        .build(app)
        .map_err(|e| {
            error!("Failed to build tray icon: {}", e);
            Box::new(e) as Box<dyn std::error::Error>
        })?;

    Ok(())
}

// ─────────────────────────────────────────────── Menu builders ───

/// Synchronous skeleton menu attached at startup (before locale is known).
/// Falls back to English so there is always a valid menu to display.
fn build_skeleton_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let s = &EN;
    let toggle = MenuItem::with_id(app, "toggle_main", s.show_window, true, None::<&str>)?;
    let pet = CheckMenuItem::with_id(
        app,
        "toggle_desktop_pet",
        s.desktop_pet,
        false,
        false,
        None::<&str>,
    )?;
    let new_ses = MenuItem::with_id(app, "new_session", s.new_session, true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let no_ses = MenuItem::with_id(app, "no_sessions", s.no_recent, false, None::<&str>)?;
    let recent =
        Submenu::with_id_and_items(app, "recent_sessions", s.recent_sessions, true, &[&no_ses])?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let recovery = build_recovery_submenu(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", s.quit, true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &toggle, &pet, &new_ses, &sep1, &recent, &sep2, &recovery, &sep3, &quit,
        ],
    )
}

/// Async full menu: locale-aware labels, dynamic window-visibility toggle,
/// and the current session list.
async fn build_full_menu(
    app: &AppHandle,
    service: &ConfigService,
) -> Result<Menu<tauri::Wry>, String> {
    let config = load_global_config(service).await?;
    let s = strings(&config);

    let main_visible = app
        .get_webview_window(WINDOW_MAIN)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false);

    let toggle_label = if main_visible {
        s.hide_window
    } else {
        s.show_window
    };
    let pet_checked = desktop_pet_should_show(&config);

    let toggle = MenuItem::with_id(app, "toggle_main", toggle_label, true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let pet = CheckMenuItem::with_id(
        app,
        "toggle_desktop_pet",
        s.desktop_pet,
        true,
        pet_checked,
        None::<&str>,
    )
    .map_err(|error| error.to_string())?;
    let new_ses = MenuItem::with_id(app, "new_session", s.new_session, true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let sep1 = PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?;
    let recent = build_sessions_submenu(app, s).await;
    let sep2 = PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?;
    let recovery = build_recovery_submenu(app).map_err(|error| error.to_string())?;
    let sep3 = PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(app, "quit", s.quit, true, None::<&str>)
        .map_err(|error| error.to_string())?;

    Menu::with_items(
        app,
        &[
            &toggle, &pet, &new_ses, &sep1, &recent, &sep2, &recovery, &sep3, &quit,
        ],
    )
    .map_err(|error| error.to_string())
}

fn build_recovery_submenu(app: &AppHandle) -> Result<Submenu<tauri::Wry>, tauri::Error> {
    let snapshot = crate::frontend_runtime_watchdog::snapshot();
    let reload = MenuItem::with_id(app, "runtime_reload_ui", "Reload UI", true, None::<&str>)?;
    let open_logs = MenuItem::with_id(app, "runtime_open_logs", "Open Logs", true, None::<&str>)?;
    let copy_diagnostics = MenuItem::with_id(
        app,
        "runtime_copy_diagnostics",
        "Copy Diagnostics",
        true,
        None::<&str>,
    )?;
    let disable_safe_mode = MenuItem::with_id(
        app,
        "runtime_disable_safe_mode",
        "Disable Safe Mode",
        snapshot.safe_mode,
        None::<&str>,
    )?;
    Submenu::with_id_and_items(
        app,
        "runtime_recovery",
        "Runtime Recovery",
        true,
        &[&reload, &open_logs, &copy_diagnostics, &disable_safe_mode],
    )
}

async fn build_sessions_submenu(app: &AppHandle, s: &TrayStrings) -> Submenu<tauri::Wry> {
    let (app_state, coordinator) = app
        .try_state::<Arc<crate::bootstrap::AppContainer>>()
        .map(|container| (container.app_state(), container.coordinator()))
        .unwrap_or_default();
    let sessions = match (app_state, coordinator) {
        (Some(app_state), Some(coordinator)) => {
            let workspace_path = app_state.workspace_path.read().await.clone();
            match workspace_path {
                Some(path) => coordinator.list_sessions(&path).await.unwrap_or_default(),
                None => Vec::new(),
            }
        }
        _ => Vec::new(),
    };

    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = Vec::new();

    if sessions.is_empty() {
        if let Ok(item) = MenuItem::with_id(app, "no_sessions", s.no_recent, false, None::<&str>) {
            items.push(Box::new(item));
        }
    } else {
        for (i, session) in sessions.into_iter().take(8).enumerate() {
            let id = format!("session:{}", session.session_id);
            let label = if session.session_name.is_empty() {
                "Untitled".to_string()
            } else {
                session.session_name
            };
            let label = if label.len() > 50 {
                format!("{}...", &label[..50])
            } else {
                label
            };
            let label = format!("{}. {}", i + 1, label);
            if let Ok(item) = MenuItem::with_id(app, id, label, true, None::<&str>) {
                items.push(Box::new(item));
            }
        }
    }

    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        items.iter().map(|b| b.as_ref()).collect();

    Submenu::with_id_and_items(app, "recent_sessions", s.recent_sessions, true, &refs)
        .unwrap_or_else(|_| {
            Submenu::with_id_and_items(app, "recent_sessions_fb", s.recent_sessions, false, &[])
                .expect("submenu fallback")
        })
}

// ─────────────────────────────────────────────── Background refresh ───

/// Rebuild the full menu asynchronously and attach it to the tray icon so
/// it is ready for the *next* right-click.
pub fn request_menu_refresh(app: &AppHandle) {
    let Some(config_service) = config_service(app) else {
        return;
    };

    let should_start_worker = lock_menu_refresh_state().request();
    if !should_start_worker {
        return;
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let generation = lock_menu_refresh_state().current_generation();
            let result = build_full_menu(&app, &config_service).await;

            // Keep the generation check and synchronous menu publication under
            // the same lock. A newer request therefore cannot be registered
            // between validation and `set_menu`, so stale async results never
            // overwrite the menu requested by a newer generation.
            let mut refresh = lock_menu_refresh_state();
            if !refresh.is_current(generation) {
                continue;
            }

            match result {
                Ok(menu) => {
                    let tray_id = tauri::tray::TrayIconId::new("sparo-main");
                    if let Some(tray) = app.tray_by_id(&tray_id) {
                        if let Err(error) = tray.set_menu(Some(menu)) {
                            warn!("Failed to update tray menu: {}", error);
                        }
                    }
                }
                Err(error) => error!("Failed to build tray menu: {}", error),
            }

            let finished = refresh.finish(generation);
            debug_assert!(finished, "current tray refresh generation must finish");
            return;
        }
    });
}

// ─────────────────────────────────────────────── Menu event handler ───

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "toggle_main" => controller::toggle_main_window(app),
        "new_session" => {
            controller::show_main_window(app);
            let _ = app.emit_to(
                tauri::EventTarget::webview_window(WINDOW_MAIN),
                EVENT_TRAY_NEW_SESSION,
                (),
            );
        }
        "toggle_desktop_pet" => {
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = tray_toggle_desktop_pet(&app_handle).await {
                    warn!("Tray desktop pet toggle failed: {}", error);
                }
                request_menu_refresh(&app_handle);
            });
            // The async action owns its single post-completion refresh. Do not
            // publish the pre-commit pet state from the common tail below.
            return;
        }
        "runtime_reload_ui" => {
            if let Err(error) = crate::frontend_runtime_watchdog::reload_ui(app) {
                warn!("Tray runtime UI reload failed: {}", error);
            }
        }
        "runtime_open_logs" => {
            if let Err(error) = crate::frontend_runtime_watchdog::open_logs(app) {
                warn!("Tray open logs failed: {}", error);
            }
        }
        "runtime_copy_diagnostics" => {
            if let Err(error) = crate::frontend_runtime_watchdog::copy_diagnostics() {
                warn!("Tray copy diagnostics failed: {}", error);
            }
        }
        "runtime_disable_safe_mode" => {
            if let Err(error) = crate::frontend_runtime_watchdog::disable_safe_mode(app) {
                warn!("Tray disable safe mode failed: {}", error);
            }
        }
        "quit" => {
            crate::set_wants_exit();
            if let Some(w) = app.get_webview_window(WINDOW_MAIN) {
                let _ = w.close();
            } else {
                crate::request_clean_exit(app.clone());
            }
        }
        id if id.starts_with("session:") => {
            let session_id = &id["session:".len()..];
            controller::show_main_window(app);
            let _ = app.emit_to(
                tauri::EventTarget::webview_window(WINDOW_MAIN),
                EVENT_TRAY_RESTORE_SESSION,
                session_id,
            );
        }
        _ => {}
    }
    request_menu_refresh(app);
}

#[cfg(test)]
mod tests {
    use super::MenuRefreshState;

    #[test]
    fn menu_refresh_requests_are_single_flight_and_coalesced_by_generation() {
        let mut refresh = MenuRefreshState::default();

        assert!(refresh.request());
        let first_generation = refresh.current_generation();
        assert!(!refresh.request());
        let latest_generation = refresh.current_generation();

        assert_ne!(first_generation, latest_generation);
        assert!(!refresh.is_current(first_generation));
        assert!(!refresh.finish(first_generation));
        assert!(refresh.worker_running);

        assert!(refresh.finish(latest_generation));
        assert!(!refresh.worker_running);
        assert!(refresh.request());
    }
}
