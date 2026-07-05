// Hide console window in Windows release builds.
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// Synchronous entrypoint.
//
// Tauri owns the only async runtime in the process via `tauri::async_runtime`
// (tokio under the hood). The previous `#[tokio::main]` layered a second
// runtime on top, which is the recommended anti-pattern in the Tauri docs:
// `Tokio` and `tauri::async_runtime` can race on main-thread requirements
// (macOS menu / window APIs), and the legacy `RUST_MIN_STACK = 8MB` trick is
// silently ignored because tokio workers are spawned *before* main() runs.
//
// Stack tuning, if ever needed, must be passed to the tokio Builder used by
// `tauri::async_runtime`, not via env vars.
fn main() {
    sparo_desktop_lib::run();
}
