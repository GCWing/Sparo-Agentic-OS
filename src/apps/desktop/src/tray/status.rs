//! Tray icon status aggregator.
//!
//! Tracks running agent turns and pending tool confirmations to derive the
//! composite `IconState`, then updates the tray icon accordingly.

use crate::tray::icon::{load_icon, IconState};
use log::{debug, warn};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex, OnceLock,
};

/// Thread-safe counters for deriving `IconState`.
pub struct TrayStatus {
    pub running_count: AtomicUsize,
    pub waiting_count: AtomicUsize,
    pub error_count: AtomicUsize,
}

impl TrayStatus {
    fn new() -> Self {
        Self {
            running_count: AtomicUsize::new(0),
            waiting_count: AtomicUsize::new(0),
            error_count: AtomicUsize::new(0),
        }
    }

    pub fn icon_state(&self) -> IconState {
        if self.error_count.load(Ordering::SeqCst) > 0 {
            IconState::Error
        } else if self.waiting_count.load(Ordering::SeqCst) > 0 {
            IconState::WaitingUser
        } else if self.running_count.load(Ordering::SeqCst) > 0 {
            IconState::Running
        } else {
            IconState::Idle
        }
    }
}

static STATUS: OnceLock<TrayStatus> = OnceLock::new();
static LAST_STATE: OnceLock<Mutex<IconState>> = OnceLock::new();

fn global_status() -> &'static TrayStatus {
    STATUS.get_or_init(TrayStatus::new)
}

fn last_state() -> &'static Mutex<IconState> {
    LAST_STATE.get_or_init(|| Mutex::new(IconState::Idle))
}

/// Apply the current status to the tray icon (icon + tooltip).
pub fn apply_icon_update(app: &tauri::AppHandle) {
    let status = global_status();
    let running = status.running_count.load(Ordering::SeqCst);
    let new_state = status.icon_state();

    {
        let mut last = last_state().lock().unwrap();
        if *last == new_state {
            return;
        }
        *last = new_state;
    }

    debug!("Tray status update: state={:?}, running={}", new_state, running);

    let tray_id = tauri::tray::TrayIconId::new("sparo-main");
    if let Some(tray) = app.tray_by_id(&tray_id) {
        if let Some(icon) = load_icon(app, new_state) {
            if let Err(e) = tray.set_icon(Some(icon)) {
                warn!("Failed to set tray icon: {}", e);
            }
        }
        let tooltip = new_state.tooltip(running);
        if let Err(e) = tray.set_tooltip(Some(tooltip.as_str())) {
            warn!("Failed to set tray tooltip: {}", e);
        }
    }
}

/// Increment the running turn counter and update the icon.
pub fn increment_running(app: &tauri::AppHandle) {
    global_status().running_count.fetch_add(1, Ordering::SeqCst);
    apply_icon_update(app);
}

/// Decrement the running turn counter and update the icon.
pub fn decrement_running(app: &tauri::AppHandle) {
    let status = global_status();
    let prev = status.running_count.fetch_sub(1, Ordering::SeqCst);
    if prev == 0 {
        status.running_count.store(0, Ordering::SeqCst);
    }
    apply_icon_update(app);
}

/// Set the error indicator.
pub fn set_error(app: &tauri::AppHandle, has_error: bool) {
    global_status()
        .error_count
        .store(if has_error { 1 } else { 0 }, Ordering::SeqCst);
    apply_icon_update(app);
}

/// Set whether a tool is waiting for user confirmation.
pub fn set_waiting_user(app: &tauri::AppHandle, is_waiting: bool) {
    global_status()
        .waiting_count
        .store(if is_waiting { 1 } else { 0 }, Ordering::SeqCst);
    apply_icon_update(app);
}
