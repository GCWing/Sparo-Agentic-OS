//! Native watchdog for the web UI runtime.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sparo_core::infrastructure::constants::WINDOW_MAIN;
use std::{
    fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const HEARTBEAT_SUSPECT_MS: i64 = 8_000;
const HEARTBEAT_FROZEN_MS: i64 = 15_000;
const HEARTBEAT_AUTO_RELOAD_MS: i64 = 25_000;
const FIRST_HEARTBEAT_GRACE_MS: i64 = 30_000;
const WATCHDOG_TICK_MS: u64 = 2_000;
const SAFE_MODE_WINDOW_MS: i64 = 10 * 60 * 1_000;
const SAFE_MODE_FREEZE_THRESHOLD: usize = 2;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendRuntimeHeartbeatRequest {
    pub captured_at: i64,
    pub gate_open: bool,
    pub pressure: bool,
    pub visibility: String,
    pub lag_count: usize,
    pub context: Option<Value>,
    pub diagnostics: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FrontendRuntimeWatchdogState {
    WaitingForFirstHeartbeat,
    Healthy,
    Suspect,
    Frozen,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendRuntimeWatchdogSnapshot {
    pub state: FrontendRuntimeWatchdogState,
    pub started_at: i64,
    pub checked_at: i64,
    pub last_received_at: Option<i64>,
    pub last_heartbeat: Option<FrontendRuntimeHeartbeatRequest>,
    pub heartbeat_age_ms: Option<i64>,
    pub diagnostic_path: Option<String>,
    pub freeze_count_in_window: usize,
    pub safe_mode: bool,
    pub auto_recovery_count: usize,
    pub last_auto_recovery_at: Option<i64>,
}

#[derive(Debug)]
struct WatchdogStore {
    started_at: i64,
    state: FrontendRuntimeWatchdogState,
    last_received_at: Option<i64>,
    last_heartbeat: Option<FrontendRuntimeHeartbeatRequest>,
    diagnostic_path: Option<PathBuf>,
    freeze_events: Vec<i64>,
    safe_mode: bool,
    auto_recovered_last_received_at: Option<i64>,
    auto_recovery_count: usize,
    last_auto_recovery_at: Option<i64>,
}

impl WatchdogStore {
    fn new() -> Self {
        Self {
            started_at: now_ms(),
            state: FrontendRuntimeWatchdogState::WaitingForFirstHeartbeat,
            last_received_at: None,
            last_heartbeat: None,
            diagnostic_path: None,
            freeze_events: Vec::new(),
            safe_mode: false,
            auto_recovered_last_received_at: None,
            auto_recovery_count: 0,
            last_auto_recovery_at: None,
        }
    }

    fn evaluate(&self, checked_at: i64) -> FrontendRuntimeWatchdogState {
        if let Some(last_received_at) = self.last_received_at {
            let age_ms = checked_at.saturating_sub(last_received_at);
            if age_ms >= HEARTBEAT_FROZEN_MS {
                FrontendRuntimeWatchdogState::Frozen
            } else if age_ms >= HEARTBEAT_SUSPECT_MS {
                FrontendRuntimeWatchdogState::Suspect
            } else {
                FrontendRuntimeWatchdogState::Healthy
            }
        } else {
            let startup_age_ms = checked_at.saturating_sub(self.started_at);
            if startup_age_ms >= FIRST_HEARTBEAT_GRACE_MS + HEARTBEAT_FROZEN_MS {
                FrontendRuntimeWatchdogState::Frozen
            } else if startup_age_ms >= FIRST_HEARTBEAT_GRACE_MS {
                FrontendRuntimeWatchdogState::Suspect
            } else {
                FrontendRuntimeWatchdogState::WaitingForFirstHeartbeat
            }
        }
    }

    fn snapshot(&self, checked_at: i64) -> FrontendRuntimeWatchdogSnapshot {
        FrontendRuntimeWatchdogSnapshot {
            state: self.state,
            started_at: self.started_at,
            checked_at,
            last_received_at: self.last_received_at,
            last_heartbeat: self.last_heartbeat.clone(),
            heartbeat_age_ms: self
                .last_received_at
                .map(|received_at| checked_at.saturating_sub(received_at)),
            diagnostic_path: self
                .diagnostic_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            freeze_count_in_window: self.freeze_events.len(),
            safe_mode: self.safe_mode,
            auto_recovery_count: self.auto_recovery_count,
            last_auto_recovery_at: self.last_auto_recovery_at,
        }
    }

    fn record_freeze(&mut self, frozen_at: i64) {
        self.freeze_events
            .retain(|event_at| frozen_at.saturating_sub(*event_at) <= SAFE_MODE_WINDOW_MS);
        self.freeze_events.push(frozen_at);
        if self.freeze_events.len() >= SAFE_MODE_FREEZE_THRESHOLD {
            self.safe_mode = true;
        }
    }

    fn disable_safe_mode(&mut self) {
        self.safe_mode = false;
        self.freeze_events.clear();
    }

    fn should_auto_recover(&self, checked_at: i64) -> bool {
        if self.state != FrontendRuntimeWatchdogState::Frozen {
            return false;
        }
        let Some(last_received_at) = self.last_received_at else {
            return false;
        };
        if self.auto_recovered_last_received_at == Some(last_received_at) {
            return false;
        }
        checked_at.saturating_sub(last_received_at) >= HEARTBEAT_AUTO_RELOAD_MS
    }

    fn mark_auto_recovery(&mut self, checked_at: i64) {
        self.auto_recovered_last_received_at = self.last_received_at;
        self.auto_recovery_count += 1;
        self.last_auto_recovery_at = Some(checked_at);
    }

    fn record_heartbeat(
        &mut self,
        mut request: FrontendRuntimeHeartbeatRequest,
        received_at: i64,
    ) -> bool {
        if request.diagnostics.is_none() {
            request.diagnostics = self
                .last_heartbeat
                .as_ref()
                .and_then(|heartbeat| heartbeat.diagnostics.clone());
        }
        let recovered = matches!(
            self.state,
            FrontendRuntimeWatchdogState::Suspect | FrontendRuntimeWatchdogState::Frozen
        );
        self.last_received_at = Some(received_at);
        self.last_heartbeat = Some(request);
        self.state = FrontendRuntimeWatchdogState::Healthy;
        self.auto_recovered_last_received_at = None;
        recovered
    }
}

static WATCHDOG: OnceLock<Mutex<WatchdogStore>> = OnceLock::new();

fn store() -> &'static Mutex<WatchdogStore> {
    WATCHDOG.get_or_init(|| Mutex::new(WatchdogStore::new()))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

/// Records a Web UI heartbeat and reports whether it recovered the watchdog
/// from a suspect or frozen state. This process-level primitive intentionally
/// has no dependency on workspace-scoped `AppState`.
pub fn record_heartbeat(request: FrontendRuntimeHeartbeatRequest) -> Result<bool, String> {
    let mut guard = store()
        .lock()
        .map_err(|_| "Failed to record frontend runtime heartbeat".to_string())?;
    Ok(guard.record_heartbeat(request, now_ms()))
}

pub fn snapshot() -> FrontendRuntimeWatchdogSnapshot {
    let checked_at = now_ms();
    store()
        .lock()
        .map(|guard| guard.snapshot(checked_at))
        .unwrap_or_else(|_| FrontendRuntimeWatchdogSnapshot {
            state: FrontendRuntimeWatchdogState::Frozen,
            started_at: checked_at,
            checked_at,
            last_received_at: None,
            last_heartbeat: None,
            heartbeat_age_ms: None,
            diagnostic_path: None,
            freeze_count_in_window: 0,
            safe_mode: true,
            auto_recovery_count: 0,
            last_auto_recovery_at: None,
        })
}

pub fn disable_safe_mode(app: &AppHandle) -> Result<(), String> {
    let mut guard = store()
        .lock()
        .map_err(|_| "Failed to disable frontend runtime safe mode".to_string())?;
    guard.disable_safe_mode();
    drop(guard);
    crate::tray::request_menu_refresh(app);
    Ok(())
}

pub fn start(app: AppHandle) {
    let _ = store();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(WATCHDOG_TICK_MS)).await;
            let checked_at = now_ms();
            let mut changed = false;
            let mut should_write_diagnostic = false;
            let mut should_auto_reload = false;

            if let Ok(mut guard) = store().lock() {
                let next = guard.evaluate(checked_at);
                if next != guard.state {
                    log::warn!(
                        "Frontend runtime watchdog state changed: old_state={:?}, new_state={:?}",
                        guard.state,
                        next
                    );
                    if matches!(next, FrontendRuntimeWatchdogState::Frozen) {
                        guard.record_freeze(checked_at);
                    }
                    guard.state = next;
                    changed = true;
                    should_write_diagnostic = matches!(
                        next,
                        FrontendRuntimeWatchdogState::Suspect
                            | FrontendRuntimeWatchdogState::Frozen
                    );
                }
                if guard.should_auto_recover(checked_at) {
                    guard.mark_auto_recovery(checked_at);
                    should_auto_reload = true;
                    should_write_diagnostic = true;
                }
            }

            if should_write_diagnostic {
                if let Err(error) = write_diagnostic_snapshot(&app) {
                    log::warn!("Failed to write frontend runtime diagnostic: {}", error);
                }
            }
            if should_auto_reload {
                log::warn!("Frontend runtime watchdog auto-reloading UI after missed heartbeats");
                if let Err(error) = reload_ui(&app) {
                    log::warn!("Frontend runtime watchdog auto-reload failed: {}", error);
                }
            }
            if changed {
                crate::tray::request_menu_refresh(&app);
            }
        }
    });
}

pub fn reload_ui(app: &AppHandle) -> Result<(), String> {
    if let Err(error) = write_diagnostic_snapshot(app) {
        log::warn!(
            "Failed to write frontend runtime diagnostic before reload: {}",
            error
        );
    }

    let main = app
        .get_webview_window(WINDOW_MAIN)
        .ok_or_else(|| "Main window is not available".to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.unminimize().map_err(|error| error.to_string())?;
    main.reload().map_err(|error| error.to_string())
}

pub fn open_logs(app: &AppHandle) -> Result<(), String> {
    let log_info = crate::logging::get_runtime_logging_info();
    app.opener()
        .open_path(log_info.session_log_dir, None::<String>)
        .map_err(|error| error.to_string())
}

pub fn copy_diagnostics() -> Result<(), String> {
    let payload = serde_json::to_string_pretty(&json!({
        "frontendRuntime": snapshot(),
        "runtimeLogs": crate::logging::get_runtime_logging_info(),
    }))
    .map_err(|error| error.to_string())?;
    write_clipboard_text(&payload)
}

fn write_diagnostic_snapshot(app: &AppHandle) -> Result<(), String> {
    let checked_at = now_ms();
    let log_info = crate::logging::get_runtime_logging_info();
    let diagnostics_path = PathBuf::from(log_info.session_log_dir).join("frontend-runtime.json");
    if let Some(parent) = diagnostics_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let snapshot = store()
        .lock()
        .map_err(|_| "Failed to read frontend runtime watchdog state".to_string())?
        .snapshot(checked_at);
    let payload = json!({
        "frontendRuntime": snapshot,
        "runtimeLogs": crate::logging::get_runtime_logging_info(),
    });
    let bytes = serde_json::to_vec_pretty(&payload).map_err(|error| error.to_string())?;
    fs::write(&diagnostics_path, bytes).map_err(|error| error.to_string())?;

    if let Ok(mut guard) = store().lock() {
        guard.diagnostic_path = Some(diagnostics_path);
    }
    crate::tray::request_menu_refresh(app);
    Ok(())
}

fn write_clipboard_text(text: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut child = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Set-Clipboard -Value ([Console]::In.ReadToEnd())",
            ])
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Failed to start clipboard helper: {}", error))?;
        child
            .stdin
            .as_mut()
            .ok_or_else(|| "Failed to open clipboard helper stdin".to_string())?
            .write_all(text.as_bytes())
            .map_err(|error| format!("Failed to write clipboard payload: {}", error))?;
        let status = child
            .wait()
            .map_err(|error| format!("Failed to wait for clipboard helper: {}", error))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("Clipboard helper exited with status: {}", status))
        }
    }

    #[cfg(target_os = "macos")]
    {
        pipe_to_clipboard("pbcopy", &[], text)
    }

    #[cfg(target_os = "linux")]
    {
        pipe_to_clipboard("wl-copy", &[], text)
            .or_else(|_| pipe_to_clipboard("xclip", &["-selection", "clipboard"], text))
            .or_else(|_| pipe_to_clipboard("xsel", &["--clipboard", "--input"], text))
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = text;
        Err("Clipboard is not supported on this platform".to_string())
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn pipe_to_clipboard(command: &str, args: &[&str], text: &str) -> Result<(), String> {
    let mut child = Command::new(command)
        .args(args)
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start clipboard helper {}: {}", command, error))?;
    child
        .stdin
        .as_mut()
        .ok_or_else(|| "Failed to open clipboard helper stdin".to_string())?
        .write_all(text.as_bytes())
        .map_err(|error| format!("Failed to write clipboard payload: {}", error))?;
    let status = child
        .wait()
        .map_err(|error| format!("Failed to wait for clipboard helper: {}", error))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Clipboard helper exited with status: {}", status))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn heartbeat(captured_at: i64) -> FrontendRuntimeHeartbeatRequest {
        FrontendRuntimeHeartbeatRequest {
            captured_at,
            gate_open: true,
            pressure: false,
            visibility: "visible".to_string(),
            lag_count: 0,
            context: None,
            diagnostics: None,
        }
    }

    #[test]
    fn heartbeat_recovers_unhealthy_process_state_without_app_state() {
        for initial_state in [
            FrontendRuntimeWatchdogState::Suspect,
            FrontendRuntimeWatchdogState::Frozen,
        ] {
            let mut watchdog = WatchdogStore::new();
            watchdog.state = initial_state;

            assert!(watchdog.record_heartbeat(heartbeat(1_234), 1_235));
            assert_eq!(watchdog.state, FrontendRuntimeWatchdogState::Healthy);
            assert_eq!(watchdog.last_received_at, Some(1_235));
            assert_eq!(
                watchdog
                    .last_heartbeat
                    .as_ref()
                    .expect("heartbeat should be recorded")
                    .captured_at,
                1_234
            );
        }
    }

    #[test]
    fn first_heartbeat_does_not_report_runtime_recovery() {
        let mut watchdog = WatchdogStore::new();

        assert!(!watchdog.record_heartbeat(heartbeat(2_345), 2_346));
        assert_eq!(watchdog.state, FrontendRuntimeWatchdogState::Healthy);
    }
}
