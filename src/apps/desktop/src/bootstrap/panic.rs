//! Process-wide panic hook.
//!
//! Replaces the legacy `std::process::exit(1)` hook with a safer cleanup path:
//!
//!   1. Log a structured error so the panic shows up in `app.log`.
//!   2. Recognise the known non-fatal wry/wkwebview panic and *return without
//!      terminating* — the webview is still alive and a panic here is a Wry
//!      bug, not an application bug.
//!   3. Run the process-manager cleanup so spawned children (terminals, MCP
//!      servers, debug ingest server) do not survive as zombies on Windows.
//!   4. Exit with a non-zero code so packaging tools / CI see the failure.

use std::sync::atomic::{AtomicBool, Ordering};

static CLEANUP_RAN: AtomicBool = AtomicBool::new(false);

pub fn install() {
    std::panic::set_hook(Box::new(|info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown".to_string());

        let message = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str))
            .unwrap_or("unknown panic");

        log::error!("Application panic at {}: {}", location, message);

        // Known non-fatal wry / wkwebview panic on macOS (PR tauri-apps/wry#1554):
        // WKWebView.URL() returns nil after navigating to an invalid address
        // and the URL bridge unwraps. The webview itself is still alive, so we
        // refuse to terminate the process — the user can keep working.
        if location.contains("wry") && location.contains("wkwebview") {
            log::warn!("Suppressed non-fatal wry/wkwebview panic");
            return;
        }

        if message.contains("WSAStartup") || message.contains("10093") {
            log::error!(
                "Network stack panic detected; common causes: corrupted Winsock catalog, \
                 antivirus interference, or running before Windows networking is ready. \
                 Recovery hints: 1) restart the app, 2) `netsh winsock reset` and reboot."
            );
        }

        if !CLEANUP_RAN.swap(true, Ordering::SeqCst) {
            log::info!("Running panic cleanup hook");
            bitfun_core::util::process_manager::cleanup_all_processes();
        }

        // Use abort() instead of exit() so OS crash dumps still fire if any
        // are configured (Sentry / WER / etc). Avoids running Drop on partially
        // initialized global state which itself could re-panic.
        std::process::abort();
    }));
}
