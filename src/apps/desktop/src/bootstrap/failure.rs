//! Failure-path UX.
//!
//! When boot fails before the webview is up, we still want the user to see a
//! human-readable message. `show_native_error_dialog` falls back to a native
//! OS dialog using `tauri-plugin-dialog`'s blocking message API; when even
//! Tauri itself failed to start, we fall back to an OS-level message box via
//! `rfd`-style platform calls that are always available.

#[cfg(target_os = "windows")]
fn show_windows_message_box(title: &str, body: &str) {
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;

    extern "system" {
        fn MessageBoxW(hwnd: isize, text: *const u16, caption: *const u16, utype: u32) -> i32;
    }

    let body_w: Vec<u16> = OsStr::new(body).encode_wide().chain(once(0)).collect();
    let title_w: Vec<u16> = OsStr::new(title).encode_wide().chain(once(0)).collect();
    const MB_OK: u32 = 0x0;
    const MB_ICONERROR: u32 = 0x10;
    unsafe {
        MessageBoxW(0, body_w.as_ptr(), title_w.as_ptr(), MB_OK | MB_ICONERROR);
    }
}

#[cfg(target_os = "macos")]
fn show_macos_message_box(title: &str, body: &str) {
    // Best-effort: shell out to AppleScript. Avoids new C deps.
    let script = format!(
        "display dialog \"{}\" with title \"{}\" buttons {{\"OK\"}} default button \"OK\" with icon stop",
        body.replace('"', "''"),
        title.replace('"', "''")
    );
    let _ = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .status();
}

#[cfg(target_os = "linux")]
fn show_linux_message_box(title: &str, body: &str) {
    // Try a few common dialog binaries; if none exist, give up silently.
    for (cmd, args) in [
        (
            "zenity",
            vec!["--error", "--no-wrap", "--title", title, "--text", body],
        ),
        ("kdialog", vec!["--title", title, "--error", body]),
        ("xmessage", vec!["-center", body]),
    ] {
        if std::process::Command::new(cmd).args(&args).status().is_ok() {
            return;
        }
    }
}

pub fn show_native_error_dialog(title: &str, body: &str) {
    eprintln!("[FATAL] {}: {}", title, body);
    #[cfg(target_os = "windows")]
    show_windows_message_box(title, body);
    #[cfg(target_os = "macos")]
    show_macos_message_box(title, body);
    #[cfg(target_os = "linux")]
    show_linux_message_box(title, body);
}
