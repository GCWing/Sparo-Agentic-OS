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
//!  2. `request_menu_refresh` spawns a background task that fetches sessions
//!     and calls `tray.set_menu()` with the enriched menu.
//!  3. After every menu-event action we call `request_menu_refresh` so the
//!     next open always shows fresh data.

pub mod controller;
pub mod event_subscriber;
pub mod icon;
pub mod status;

use sparo_core::agentic::coordination::ConversationCoordinator;
use sparo_core::infrastructure::constants::{
    EVENT_TRAY_NEW_SESSION, EVENT_TRAY_RESTORE_SESSION, WINDOW_MAIN,
};
use sparo_core::service::config::{get_global_config_service, GlobalConfig};
use icon::{load_icon, IconState};
use log::{error, warn};
use std::sync::Arc;
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

async fn strings() -> &'static TrayStrings {
    if let Ok(svc) = get_global_config_service().await {
        if let Ok(cfg) = svc.get_config::<GlobalConfig>(None).await {
            if cfg.app.language.starts_with("zh") {
                return &ZH;
            }
        }
    }
    &EN
}

fn desktop_pet_should_show(config: &GlobalConfig) -> bool {
    config.app.ai_experience.enable_agent_companion
}

async fn load_global_config() -> Option<GlobalConfig> {
    let service = get_global_config_service().await.ok()?;
    service.get_config::<GlobalConfig>(None).await.ok()
}

async fn tray_toggle_desktop_pet(app: &AppHandle) -> Result<(), String> {
    let service = get_global_config_service()
        .await
        .map_err(|error| error.to_string())?;
    let mut config = service
        .get_config::<GlobalConfig>(None)
        .await
        .map_err(|error| error.to_string())?;

    let desktop_on = desktop_pet_should_show(&config);
    if desktop_on {
        config.app.ai_experience.enable_agent_companion = false;
    } else {
        config.app.ai_experience.enable_agent_companion = true;
        config.app.ai_experience.agent_companion_display_mode = "desktop".to_string();
    }

    service
        .set_config("app.ai_experience", &config.app.ai_experience)
        .await
        .map_err(|error| error.to_string())?;

    if desktop_pet_should_show(&config) {
        crate::window::companion_window::show_agent_companion_desktop_pet(app.clone()).await?;
    } else {
        crate::window::companion_window::hide_agent_companion_desktop_pet(app.clone()).await?;
    }

    Ok(())
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

    request_menu_refresh(app);
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
        true,
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
async fn build_full_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let s = strings().await;

    let main_visible = app
        .get_webview_window(WINDOW_MAIN)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false);

    let toggle_label = if main_visible {
        s.hide_window
    } else {
        s.show_window
    };
    let pet_checked = load_global_config()
        .await
        .as_ref()
        .map(desktop_pet_should_show)
        .unwrap_or(false);

    let toggle = MenuItem::with_id(app, "toggle_main", toggle_label, true, None::<&str>)?;
    let pet = CheckMenuItem::with_id(
        app,
        "toggle_desktop_pet",
        s.desktop_pet,
        true,
        pet_checked,
        None::<&str>,
    )?;
    let new_ses = MenuItem::with_id(app, "new_session", s.new_session, true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let recent = build_sessions_submenu(app, s).await;
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
    let workspace = app
        .try_state::<crate::api::app_state::AppState>()
        .map(|st| st.workspace_path.clone());
    let sessions = if let Some(workspace_arc) = workspace {
        let path = workspace_arc.read().await.clone();
        if let Some(path) = path {
            if let Some(coordinator) = app.try_state::<Arc<ConversationCoordinator>>() {
                coordinator.list_sessions(&path).await.unwrap_or_default()
            } else {
                vec![]
            }
        } else {
            vec![]
        }
    } else {
        vec![]
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
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match build_full_menu(&app).await {
            Ok(menu) => {
                let tray_id = tauri::tray::TrayIconId::new("sparo-main");
                if let Some(tray) = app.tray_by_id(&tray_id) {
                    if let Err(e) = tray.set_menu(Some(menu)) {
                        warn!("Failed to update tray menu: {}", e);
                    }
                }
            }
            Err(e) => error!("Failed to build tray menu: {}", e),
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
                sparo_core::util::process_manager::cleanup_all_processes();
                app.exit(0);
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
