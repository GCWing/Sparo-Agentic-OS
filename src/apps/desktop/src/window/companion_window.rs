//! Agent Companion (desktop pet) floating window.
//!
//! Borderless, always-on-top, transparent, taskbar-skipping. Position memory
//! is kept across hide/show so the pet stays where the user left it. All
//! sizing is clamped to a sane envelope so the window cannot grow to cover
//! the desktop if the renderer reports a garbage size.

use bitfun_core::infrastructure::constants::{
    EVENT_AGENT_COMPANION_OPEN_LATEST_TASK, EVENT_AGENT_COMPANION_OPEN_SETTINGS,
    EVENT_AGENT_COMPANION_SETTINGS_UPDATED, WINDOW_AGENT_COMPANION, WINDOW_MAIN,
};
use bitfun_core::service::config::{get_global_config_service, types::GlobalConfig};
use log::{error, warn};
use std::sync::{OnceLock, RwLock};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    AppHandle, Emitter, Manager, WebviewUrl,
};

const WINDOW_MIN_SIZE: f64 = 96.0;
const WINDOW_MAX_WIDTH: f64 = 360.0;
const WINDOW_MAX_HEIGHT: f64 = 240.0;
const WINDOW_MARGIN: i32 = 64;
const WINDOW_EDGE_MARGIN: f64 = 8.0;

const MENU_OPEN_MAIN: &str = "agent_companion_open_main";
const MENU_OPEN_LATEST_TASK: &str = "agent_companion_open_latest_task";
const MENU_SETTINGS: &str = "agent_companion_settings";
const MENU_HIDE: &str = "agent_companion_hide";

static WINDOW_OPS: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static LAST_POSITION: OnceLock<RwLock<Option<tauri::LogicalPosition<f64>>>> = OnceLock::new();

fn window_ops() -> &'static tokio::sync::Mutex<()> {
    WINDOW_OPS.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn last_position() -> &'static RwLock<Option<tauri::LogicalPosition<f64>>> {
    LAST_POSITION.get_or_init(|| RwLock::new(None))
}

fn remember(position: tauri::LogicalPosition<f64>) {
    if let Ok(mut last) = last_position().write() {
        *last = Some(position);
    }
}

fn remembered() -> Option<tauri::LogicalPosition<f64>> {
    last_position().read().ok().and_then(|p| *p)
}

struct MenuLabels {
    open_main: &'static str,
    open_latest_task: &'static str,
    settings: &'static str,
    hide: &'static str,
}

const MENU_ZH: MenuLabels = MenuLabels {
    open_main: "打开 Sparo OS",
    open_latest_task: "打开最新任务",
    settings: "宠物设置",
    hide: "隐藏宠物",
};

const MENU_EN: MenuLabels = MenuLabels {
    open_main: "Open Sparo OS",
    open_latest_task: "Open Latest Task",
    settings: "Companion Settings",
    hide: "Hide Companion",
};

async fn menu_labels() -> &'static MenuLabels {
    if let Ok(service) = get_global_config_service().await {
        if let Ok(config) = service.get_config::<GlobalConfig>(None).await {
            if config.app.language.starts_with("zh") {
                return &MENU_ZH;
            }
        }
    }
    &MENU_EN
}

fn build_context_menu(
    app: &AppHandle,
    labels: &MenuLabels,
) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let open_main = MenuItem::with_id(app, MENU_OPEN_MAIN, labels.open_main, true, None::<&str>)?;
    let open_latest = MenuItem::with_id(
        app,
        MENU_OPEN_LATEST_TASK,
        labels.open_latest_task,
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, MENU_SETTINGS, labels.settings, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let hide = MenuItem::with_id(app, MENU_HIDE, labels.hide, true, None::<&str>)?;
    Menu::with_items(
        app,
        &[&open_main, &open_latest, &settings, &separator, &hide],
    )
}

async fn set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let service = get_global_config_service()
        .await
        .map_err(|e| e.to_string())?;
    let mut config = service
        .get_config::<GlobalConfig>(None)
        .await
        .map_err(|e| e.to_string())?;

    config.app.ai_experience.enable_agent_companion = enabled;
    if enabled {
        config.app.ai_experience.agent_companion_display_mode = "desktop".to_string();
    }

    service
        .set_config("app.ai_experience", &config.app.ai_experience)
        .await
        .map_err(|e| e.to_string())?;

    let _ = app.emit(
        EVENT_AGENT_COMPANION_SETTINGS_UPDATED,
        &config.app.ai_experience,
    );

    if enabled {
        show_agent_companion_desktop_pet(app.clone()).await?;
    } else {
        hide_agent_companion_desktop_pet(app.clone()).await?;
    }

    crate::tray::request_menu_refresh(&app);
    Ok(())
}

pub fn handle_context_menu_event(app: &AppHandle, id: &str) -> bool {
    match id {
        MENU_OPEN_MAIN => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = crate::window::main_window::show_main_window(app).await {
                    warn!("Agent companion menu failed to show main window: {}", e);
                }
            });
            true
        }
        MENU_OPEN_LATEST_TASK => {
            let _ = app.emit_to(
                tauri::EventTarget::webview_window(WINDOW_MAIN),
                EVENT_AGENT_COMPANION_OPEN_LATEST_TASK,
                (),
            );
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = crate::window::main_window::show_main_window(app).await {
                    warn!(
                        "Agent companion menu failed to show latest task window: {}",
                        e
                    );
                }
            });
            true
        }
        MENU_SETTINGS => {
            let _ = app.emit_to(
                tauri::EventTarget::webview_window(WINDOW_MAIN),
                EVENT_AGENT_COMPANION_OPEN_SETTINGS,
                (),
            );
            true
        }
        MENU_HIDE => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = set_enabled(app, false).await {
                    warn!("Agent companion menu failed to hide desktop pet: {}", e);
                }
            });
            true
        }
        _ => false,
    }
}

fn app_url(path: &str) -> WebviewUrl {
    if cfg!(debug_assertions) {
        let dev_url = format!(
            "{}/{}",
            bitfun_core::infrastructure::constants::dev_vite_url(),
            path
        );
        match dev_url.parse() {
            Ok(url) => WebviewUrl::External(url),
            Err(e) => {
                error!("Invalid dev URL, fallback to app URL: {}", e);
                WebviewUrl::App(path.into())
            }
        }
    } else {
        let app_path = if path.starts_with('?') {
            format!("index.html{}", path)
        } else {
            path.to_string()
        };
        WebviewUrl::App(app_path.into())
    }
}

fn work_area(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
) -> Option<(tauri::LogicalPosition<f64>, tauri::LogicalSize<f64>)> {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let scale_factor = monitor.scale_factor();
    let area = monitor.work_area();
    Some((
        area.position.to_logical::<f64>(scale_factor),
        area.size.to_logical::<f64>(scale_factor),
    ))
}

fn clamp_position(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    position: tauri::LogicalPosition<f64>,
    size: tauri::LogicalSize<f64>,
) -> tauri::LogicalPosition<f64> {
    let Some((area_position, area_size)) = work_area(app, window) else {
        return position;
    };
    let min_x = area_position.x + WINDOW_EDGE_MARGIN;
    let min_y = area_position.y + WINDOW_EDGE_MARGIN;
    let max_x = area_position.x + area_size.width - size.width - WINDOW_EDGE_MARGIN;
    let max_y = area_position.y + area_size.height - size.height - WINDOW_EDGE_MARGIN;
    tauri::LogicalPosition::new(
        if max_x >= min_x {
            position.x.clamp(min_x, max_x)
        } else {
            area_position.x
        },
        if max_y >= min_y {
            position.y.clamp(min_y, max_y)
        } else {
            area_position.y
        },
    )
}

fn default_position(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
) -> Option<tauri::LogicalPosition<f64>> {
    let (area_position, area_size) = work_area(app, window)?;
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let scale_factor = monitor.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
    let window_size = window
        .outer_size()
        .ok()
        .map(|s| s.to_logical::<f64>(scale_factor));
    let window_width = window_size
        .as_ref()
        .map(|s| s.width)
        .unwrap_or(WINDOW_MIN_SIZE);
    let window_height = window_size
        .as_ref()
        .map(|s| s.height)
        .unwrap_or(WINDOW_MIN_SIZE);
    let x = area_position.x + area_size.width - window_width - f64::from(WINDOW_MARGIN);
    let y = area_position.y + area_size.height - window_height - f64::from(WINDOW_MARGIN);
    Some(clamp_position(
        app,
        window,
        tauri::LogicalPosition::new(x, y),
        tauri::LogicalSize::new(window_width, window_height),
    ))
}

fn effective_size(window: &tauri::WebviewWindow) -> tauri::LogicalSize<f64> {
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let size = window
        .outer_size()
        .ok()
        .map(|s| s.to_logical::<f64>(scale_factor))
        .unwrap_or_else(|| tauri::LogicalSize::new(WINDOW_MIN_SIZE, WINDOW_MIN_SIZE));
    tauri::LogicalSize::new(
        size.width.clamp(WINDOW_MIN_SIZE, WINDOW_MAX_WIDTH),
        size.height.clamp(WINDOW_MIN_SIZE, WINDOW_MAX_HEIGHT),
    )
}

fn position_window(app: &AppHandle, window: &tauri::WebviewWindow) {
    let Some(position) = remembered().or_else(|| default_position(app, window)) else {
        return;
    };
    let size = effective_size(window);
    let position = clamp_position(app, window, position, size);
    if let Err(e) = window.set_position(position) {
        warn!("Failed to position Agent companion window: {}", e);
    } else {
        remember(position);
    }
}

fn resize_window(app: &AppHandle, window: &tauri::WebviewWindow, width: f64, height: f64) {
    if !width.is_finite() || !height.is_finite() {
        warn!(
            "Ignored invalid Agent companion window size: width={}, height={}",
            width, height
        );
        return;
    }
    let width = width.clamp(WINDOW_MIN_SIZE, WINDOW_MAX_WIDTH);
    let height = height.clamp(WINDOW_MIN_SIZE, WINDOW_MAX_HEIGHT);
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let size = effective_size(window);
    if (size.width - width).abs() < 0.5 && (size.height - height).abs() < 0.5 {
        return;
    }
    let old_position = window
        .outer_position()
        .ok()
        .map(|p| p.to_logical::<f64>(scale_factor));
    if let Err(e) = window.set_size(tauri::LogicalSize::new(width, height)) {
        warn!("Failed to resize Agent companion window: {}", e);
        return;
    }
    if let Some(position) = old_position {
        let next = clamp_position(
            app,
            window,
            tauri::LogicalPosition::new(
                position.x + size.width - width,
                position.y + size.height - height,
            ),
            tauri::LogicalSize::new(width, height),
        );
        if let Err(e) = window.set_position(next) {
            warn!("Failed to reposition Agent companion window: {}", e);
        } else {
            remember(next);
        }
    }
}

#[tauri::command]
pub async fn show_agent_companion_desktop_pet(app: AppHandle) -> Result<(), String> {
    let _guard = window_ops().lock().await;

    if let Some(window) = app.get_webview_window(WINDOW_AGENT_COMPANION) {
        if let Err(e) = window.unminimize() {
            warn!("Failed to unminimize Agent companion window: {}", e);
        }
        if let Err(e) = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0))) {
            warn!("Failed to reset Agent companion window background: {}", e);
        }
        position_window(&app, &window);
        window
            .show()
            .map_err(|e| format!("Failed to show Agent companion window: {}", e))?;
        return Ok(());
    }

    let url = app_url("?sparoWindow=agent-companion");
    let mut builder = tauri::WebviewWindowBuilder::new(&app, WINDOW_AGENT_COMPANION, url)
        .title("Sparo OS Agent Companion")
        .inner_size(WINDOW_MIN_SIZE, WINDOW_MIN_SIZE)
        .max_inner_size(WINDOW_MAX_WIDTH, WINDOW_MAX_HEIGHT)
        .min_inner_size(1.0, 1.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .accept_first_mouse(true)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .transparent(true);

    builder = builder.disable_drag_drop_handler();

    let window = builder
        .build()
        .map_err(|e| format!("Failed to create Agent companion window: {}", e))?;

    position_window(&app, &window);

    window
        .show()
        .map_err(|e| format!("Failed to show Agent companion window: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn resize_agent_companion_desktop_pet(
    app: AppHandle,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let _guard = window_ops().lock().await;
    if let Some(window) = app.get_webview_window(WINDOW_AGENT_COMPANION) {
        let app_for_resize = app.clone();
        let window_for_resize = window.clone();
        window
            .run_on_main_thread(move || {
                resize_window(&app_for_resize, &window_for_resize, width, height);
            })
            .map_err(|e| format!("Failed to schedule Agent companion window resize: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn show_agent_companion_context_menu(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(WINDOW_AGENT_COMPANION) else {
        return Err("Agent companion window not found".to_string());
    };
    let labels = menu_labels().await;
    let menu = build_context_menu(&app, labels)
        .map_err(|e| format!("Failed to build Agent companion context menu: {}", e))?;
    window
        .popup_menu(&menu)
        .map_err(|e| format!("Failed to show Agent companion context menu: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn hide_agent_companion_desktop_pet(app: AppHandle) -> Result<(), String> {
    let _guard = window_ops().lock().await;
    if let Some(window) = app.get_webview_window(WINDOW_AGENT_COMPANION) {
        if let Ok(scale_factor) = window.scale_factor() {
            if let Ok(position) = window.outer_position() {
                remember(position.to_logical::<f64>(scale_factor));
            }
        }
        window
            .destroy()
            .map_err(|e| format!("Failed to destroy Agent companion window: {}", e))?;
    }
    Ok(())
}
