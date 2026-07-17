//! Tauri commands exposed to the frontend installer UI.

use super::app_identity::{APP_EXE_FILENAME, INSTALL_FOLDER_NAME, INSTALL_MANIFEST_FILENAME};
use super::extract::{self, ESTIMATED_INSTALL_SIZE};
use super::types::{DiskSpaceInfo, InstallOptions, InstallProgress};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager, Window};

#[cfg(target_os = "windows")]
#[derive(Default)]
struct WindowsInstallState {
    uninstall_registered: bool,
    desktop_shortcut_created: bool,
    start_menu_shortcut_created: bool,
    context_menu_registered: bool,
    added_to_path: bool,
}

const MIN_WINDOWS_APP_EXE_BYTES: u64 = 5 * 1024 * 1024;
const PAYLOAD_MANIFEST_FILE: &str = "payload-manifest.json";
const INSTALLER_STATE_FILE: &str = "installer-state.json";
const INSTALLER_STATE_DIR_NAME: &str = "sparo_os_installer";
const EMBEDDED_PAYLOAD_ZIP: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/embedded_payload.zip"));

#[derive(Debug, Clone, Deserialize)]
struct PayloadManifest {
    files: Vec<PayloadManifestFile>,
}

#[derive(Debug, Clone, Deserialize)]
struct PayloadManifestFile {
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstalledManifest {
    version: u32,
    files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchContext {
    pub mode: String,
    pub uninstall_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPathValidation {
    pub install_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InstallerState {
    last_install_path: String,
}

/// Get the default installation path.
#[tauri::command]
pub fn get_default_install_path() -> String {
    let base = if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("C:\\Program Files"))
            })
    } else if cfg!(target_os = "macos") {
        dirs::home_dir()
            .map(|h| h.join("Applications"))
            .unwrap_or_else(|| PathBuf::from("/Applications"))
    } else {
        dirs::home_dir()
            .map(|h| h.join(".local/share"))
            .unwrap_or_else(|| PathBuf::from("/opt"))
    };

    base.join(INSTALL_FOLDER_NAME).to_string_lossy().to_string()
}

/// Last successful install path if still valid, otherwise platform default.
#[tauri::command]
pub fn get_initial_install_path() -> String {
    if let Some(saved) = read_last_install_path() {
        let saved_pb = PathBuf::from(saved.trim());
        if !saved_pb.as_os_str().is_empty() {
            if let Ok(resolved) = prepare_install_target(&saved_pb) {
                return resolved.to_string_lossy().to_string();
            }
        }
    }
    get_default_install_path()
}

/// Get available disk space for the given path.
#[tauri::command]
pub fn get_disk_space(path: String) -> Result<DiskSpaceInfo, String> {
    let path = PathBuf::from(&path);

    // Walk up to find an existing ancestor directory
    let check_path = find_existing_ancestor(&path);

    // Use std::fs metadata as a basic check. For actual disk space,
    // platform-specific APIs are needed.
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        let wide_path: Vec<u16> = OsStr::new(check_path.to_str().unwrap_or("C:\\"))
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let mut free_bytes_available: u64 = 0;
        let mut total_bytes: u64 = 0;
        let mut total_free_bytes: u64 = 0;

        unsafe {
            let result = windows_sys_get_disk_free_space(
                wide_path.as_ptr(),
                &mut free_bytes_available,
                &mut total_bytes,
                &mut total_free_bytes,
            );
            if result != 0 {
                return Ok(DiskSpaceInfo {
                    total: total_bytes,
                    available: free_bytes_available,
                    required: ESTIMATED_INSTALL_SIZE,
                    sufficient: free_bytes_available >= ESTIMATED_INSTALL_SIZE,
                });
            }
        }
    }

    // Fallback: assume sufficient space
    Ok(DiskSpaceInfo {
        total: 0,
        available: u64::MAX,
        required: ESTIMATED_INSTALL_SIZE,
        sufficient: true,
    })
}

#[cfg(target_os = "windows")]
unsafe fn windows_sys_get_disk_free_space(
    path: *const u16,
    free_bytes_available: *mut u64,
    total_bytes: *mut u64,
    total_free_bytes: *mut u64,
) -> i32 {
    // Link to kernel32.dll GetDiskFreeSpaceExW
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            lpDirectoryName: *const u16,
            lpFreeBytesAvailableToCaller: *mut u64,
            lpTotalNumberOfBytes: *mut u64,
            lpTotalNumberOfFreeBytes: *mut u64,
        ) -> i32;
    }
    GetDiskFreeSpaceExW(path, free_bytes_available, total_bytes, total_free_bytes)
}

#[tauri::command]
pub fn get_launch_context() -> LaunchContext {
    let args: Vec<String> = std::env::args().collect();
    if let Some(idx) = args.iter().position(|arg| arg == "--uninstall") {
        let uninstall_path = args
            .get(idx + 1)
            .map(|p| p.to_string())
            .or_else(|| guess_uninstall_path_from_exe());
        return LaunchContext {
            mode: "uninstall".to_string(),
            uninstall_path,
        };
    }

    if is_running_as_uninstall_binary() {
        return LaunchContext {
            mode: "uninstall".to_string(),
            uninstall_path: guess_uninstall_path_from_exe(),
        };
    }

    LaunchContext {
        mode: "install".to_string(),
        uninstall_path: None,
    }
}

/// Validate the installation path.
#[tauri::command]
pub fn validate_install_path(path: String) -> Result<InstallPathValidation, String> {
    let requested_path = PathBuf::from(&path);
    let install_path = prepare_install_target(&requested_path)?;
    Ok(InstallPathValidation {
        install_path: install_path.to_string_lossy().to_string(),
    })
}

/// Main installation command. Emits progress events to the frontend.
#[tauri::command]
pub async fn start_installation(window: Window, options: InstallOptions) -> Result<(), String> {
    let install_path = prepare_install_target(Path::new(&options.install_path))?;
    let install_dir_was_absent = !install_path.exists();
    #[cfg(target_os = "windows")]
    let mut windows_state = WindowsInstallState::default();

    let result: Result<(), String> = (|| {
        // Step 1: Create target directory
        emit_progress(&window, "prepare", 5, "Creating installation directory...");
        std::fs::create_dir_all(&install_path)
            .map_err(|e| format!("Failed to create directory: {}", e))?;

        // Step 2: Extract / copy application files
        emit_progress(&window, "extract", 15, "Extracting application files...");

        let mut extracted = false;
        let mut used_debug_placeholder = false;
        let mut checked_locations: Vec<String> = Vec::new();
        let mut installed_files: Vec<String> = Vec::new();

        if embedded_payload_available() {
            checked_locations.push("embedded payload zip".to_string());
            preflight_validate_payload_zip_bytes(EMBEDDED_PAYLOAD_ZIP, "embedded payload zip")?;
            installed_files =
                read_payload_manifest_from_zip_bytes(EMBEDDED_PAYLOAD_ZIP, "embedded payload zip")?
                    .files
                    .into_iter()
                    .map(|entry| entry.path)
                    .collect();
            extract::extract_zip_bytes_with_filter(
                EMBEDDED_PAYLOAD_ZIP,
                &install_path,
                should_install_payload_path,
            )
            .map_err(|e| format!("Embedded payload extraction failed: {}", e))?;
            extracted = true;
            log::info!("Extracted payload from embedded installer archive");
        }

        // Fallback to external payload locations for compatibility and local debug.
        let exe_dir = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf();

        if !extracted {
            for candidate in build_payload_candidates(&window, &exe_dir) {
                if candidate.is_zip {
                    checked_locations.push(format!("zip: {}", candidate.path.display()));
                    if !candidate.path.exists() {
                        continue;
                    }
                    preflight_validate_payload_zip_file(&candidate.path, &candidate.label)?;
                    installed_files =
                        read_payload_manifest_from_zip_file(&candidate.path, &candidate.label)?
                            .files
                            .into_iter()
                            .map(|entry| entry.path)
                            .collect();
                    extract::extract_zip_with_filter(
                        &candidate.path,
                        &install_path,
                        should_install_payload_path,
                    )
                    .map_err(|e| format!("Extraction failed from {}: {}", candidate.label, e))?;
                    extracted = true;
                    log::info!("Extracted payload from {}", candidate.label);
                    break;
                }

                checked_locations.push(format!("dir: {}", candidate.path.display()));
                if !candidate.path.exists() {
                    continue;
                }
                preflight_validate_payload_dir(&candidate.path, &candidate.label)?;
                installed_files =
                    read_payload_manifest_from_dir(&candidate.path, &candidate.label)?
                        .files
                        .into_iter()
                        .map(|entry| entry.path)
                        .collect();
                extract::copy_directory_with_filter(
                    &candidate.path,
                    &install_path,
                    should_install_payload_path,
                )
                .map_err(|e| format!("File copy failed from {}: {}", candidate.label, e))?;
                extracted = true;
                log::info!("Copied payload from {}", candidate.label);
                break;
            }
        }

        if !extracted {
            if cfg!(debug_assertions) {
                // Development mode: create a placeholder to simplify local UI iteration.
                log::warn!("No payload found - running in development mode");
                let placeholder = install_path.join(APP_EXE_FILENAME);
                if !placeholder.exists() {
                    std::fs::write(&placeholder, "placeholder")
                        .map_err(|e| format!("Failed to write placeholder: {}", e))?;
                }
                installed_files.push(APP_EXE_FILENAME.to_string());
                used_debug_placeholder = true;
            } else {
                return Err(format!(
                    "Installer payload is missing. Checked: {}",
                    checked_locations.join(" | ")
                ));
            }
        }

        if !used_debug_placeholder {
            verify_installed_payload(&install_path)?;
        }

        emit_progress(&window, "extract", 50, "Files extracted successfully");

        // Step 3: Windows-specific operations
        #[cfg(target_os = "windows")]
        {
            use super::registry;
            use super::shortcut;

            let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let uninstaller_path = install_path.join("uninstall.exe");
            std::fs::copy(&current_exe, &uninstaller_path)
                .map_err(|e| format!("Failed to create uninstaller executable: {}", e))?;
            let uninstall_command = format!(
                "\"{}\" --uninstall \"{}\"",
                uninstaller_path.display(),
                install_path.display()
            );
            installed_files.push("uninstall.exe".to_string());

            emit_progress(&window, "registry", 60, "Registering application...");
            registry::register_uninstall_entry(
                &install_path,
                env!("CARGO_PKG_VERSION"),
                &uninstall_command,
            )
            .map_err(|e| format!("Registry error: {}", e))?;
            windows_state.uninstall_registered = true;

            // Desktop shortcut
            if options.desktop_shortcut {
                emit_progress(&window, "shortcuts", 70, "Creating desktop shortcut...");
                shortcut::create_desktop_shortcut(&install_path)
                    .map_err(|e| format!("Shortcut error: {}", e))?;
                windows_state.desktop_shortcut_created = true;
            }

            // Start Menu
            if options.start_menu {
                emit_progress(&window, "shortcuts", 75, "Creating Start Menu entry...");
                shortcut::create_start_menu_shortcut(&install_path)
                    .map_err(|e| format!("Start Menu error: {}", e))?;
                windows_state.start_menu_shortcut_created = true;
            }

            // Context menu
            if options.context_menu {
                emit_progress(
                    &window,
                    "context_menu",
                    80,
                    "Adding context menu integration...",
                );
                registry::register_context_menu(&install_path)
                    .map_err(|e| format!("Context menu error: {}", e))?;
                windows_state.context_menu_registered = true;
            }

            // PATH
            if options.add_to_path {
                emit_progress(&window, "path", 85, "Adding to system PATH...");
                registry::add_to_path(&install_path).map_err(|e| format!("PATH error: {}", e))?;
                windows_state.added_to_path = true;
            }
        }

        write_installed_manifest(&install_path, installed_files)?;

        // Step 4: Done. The installed application owns all first-run configuration.
        emit_progress(&window, "complete", 100, "Installation complete!");
        Ok(())
    })();

    if let Err(err) = result {
        #[cfg(target_os = "windows")]
        rollback_installation(&install_path, install_dir_was_absent, &windows_state);
        #[cfg(not(target_os = "windows"))]
        rollback_installation(&install_path, install_dir_was_absent);
        return Err(err);
    }

    persist_last_install_path(&install_path);

    Ok(())
}

/// Uninstall Sparo OS (for the uninstaller companion).
#[tauri::command]
pub async fn uninstall(install_path: String) -> Result<(), String> {
    let install_path = PathBuf::from(&install_path);
    let uninstall_targets = collect_uninstall_targets(&install_path)?;

    #[cfg(target_os = "windows")]
    {
        use super::registry;
        use super::shortcut;

        let _ = shortcut::remove_desktop_shortcut();
        let _ = shortcut::remove_start_menu_shortcut();
        let _ = registry::remove_context_menu();
        let _ = registry::remove_from_path(&install_path);
        let _ = registry::remove_uninstall_entry();
    }

    #[cfg(target_os = "windows")]
    {
        let current_exe = std::env::current_exe().ok();
        let running_uninstall_binary = current_exe
            .as_ref()
            .and_then(|exe| exe.file_stem().map(|s| s.to_string_lossy().to_string()))
            .map(|stem| stem.eq_ignore_ascii_case("uninstall"))
            .unwrap_or(false);

        let current_exe_parent = current_exe
            .as_ref()
            .and_then(|exe| exe.parent().map(|p| p.to_path_buf()));
        let running_from_install_dir = current_exe_parent
            .as_ref()
            .map(|parent| windows_path_eq_case_insensitive(parent, &install_path))
            .unwrap_or(false);

        append_uninstall_runtime_log(&format!(
            "uninstall called: install_path='{}', current_exe='{}', running_uninstall_binary={}, running_from_install_dir={}",
            install_path.display(),
            current_exe
                .as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "<unknown>".to_string()),
            running_uninstall_binary,
            running_from_install_dir
        ));

        let current_exe_path = current_exe.as_deref();
        remove_installed_targets(&install_path, &uninstall_targets, current_exe_path)?;

        if (running_uninstall_binary || running_from_install_dir)
            && current_exe_path
                .map(|exe| {
                    windows_path_eq_case_insensitive(exe, &install_path.join("uninstall.exe"))
                })
                .unwrap_or(false)
        {
            schedule_windows_self_uninstall_cleanup(current_exe_path.unwrap())?;
        }
    }

    #[cfg(not(target_os = "windows"))]
    remove_installed_targets(&install_path, &uninstall_targets, None)?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn schedule_windows_self_uninstall_cleanup(uninstall_exe_path: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let temp_dir = std::env::temp_dir();
    let pid = std::process::id();
    let script_path = temp_dir.join(format!("sparo-uninstall-{}.cmd", pid));
    let log_path = temp_dir.join(format!("sparo-uninstall-cleanup-{}.log", pid));

    let script = format!(
        r#"@echo off
setlocal enableextensions
set "TARGET=%~1"
set "LOG=%~2"
if "%TARGET%"=="" exit /b 2
if "%LOG%"=="" set "LOG=%TEMP%\sparo-uninstall-cleanup.log"
echo [%DATE% %TIME%] cleanup start > "%LOG%"
cd /d "%TEMP%"
for /L %%i in (1,1,30) do (
  if not exist "%TARGET%" (
    echo [%DATE% %TIME%] cleanup success on try %%i >> "%LOG%"
    exit /b 0
  )
  del /f /q "%TARGET%" >> "%LOG%" 2>&1
  if not exist "%TARGET%" (
    echo [%DATE% %TIME%] cleanup success on try %%i >> "%LOG%"
    exit /b 0
  )
  timeout /t 1 /nobreak >nul
)
echo [%DATE% %TIME%] cleanup failed after retries >> "%LOG%"
exit /b 1
"#
    );

    std::fs::write(&script_path, script)
        .map_err(|e| format!("Failed to write cleanup script: {}", e))?;

    append_uninstall_runtime_log(&format!(
        "scheduled cleanup script='{}', target='{}', cleanup_log='{}'",
        script_path.display(),
        uninstall_exe_path.display(),
        log_path.display()
    ));

    let child = std::process::Command::new("cmd")
        .arg("/C")
        .arg("call")
        .arg(&script_path)
        .arg(uninstall_exe_path)
        .arg(&log_path)
        .current_dir(&temp_dir)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Failed to schedule uninstall cleanup: {}", e))?;

    append_uninstall_runtime_log(&format!("cleanup process spawned: pid={}", child.id()));

    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_path_eq_case_insensitive(a: &Path, b: &Path) -> bool {
    fn normalize(path: &Path) -> String {
        let mut s = path.to_string_lossy().replace('/', "\\").to_lowercase();
        while s.ends_with('\\') {
            s.pop();
        }
        s
    }
    normalize(a) == normalize(b)
}

#[cfg(target_os = "windows")]
fn append_uninstall_runtime_log(message: &str) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let log_path = std::env::temp_dir().join("sparo-uninstall-runtime.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        use std::io::Write;
        let _ = writeln!(file, "[{}] {}", ts, message);
    }
}

/// Launch the installed application.
#[tauri::command]
pub fn launch_application(install_path: String) -> Result<(), String> {
    let root = PathBuf::from(&install_path);
    let exe = resolve_installed_executable(&root);

    std::process::Command::new(&exe)
        .current_dir(&install_path)
        .spawn()
        .map_err(|e| format!("Failed to launch Sparo OS: {}", e))?;

    Ok(())
}

fn resolve_installed_executable(install_path: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        install_path.join(APP_EXE_FILENAME)
    }
    #[cfg(target_os = "macos")]
    {
        install_path.join(INSTALL_FOLDER_NAME)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        install_path.join("sparo-os")
    }
}

/// Close the installer window.
#[tauri::command]
pub fn close_installer(window: Window) {
    let _ = window.close();
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn emit_progress(window: &Window, step: &str, percent: u32, message: &str) {
    let progress = InstallProgress {
        step: step.to_string(),
        percent,
        message: message.to_string(),
    };
    let _ = window.emit("install-progress", &progress);
    log::info!("[{}%] {}: {}", percent, step, message);
}

fn guess_uninstall_path_from_exe() -> Option<String> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
        .map(|p| p.to_string_lossy().to_string())
}

fn is_running_as_uninstall_binary() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.file_stem().map(|s| s.to_string_lossy().to_string()))
        .map(|stem| stem.eq_ignore_ascii_case("uninstall"))
        .unwrap_or(false)
}

fn embedded_payload_available() -> bool {
    option_env!("EMBEDDED_PAYLOAD_AVAILABLE")
        .map(|v| v == "1")
        .unwrap_or(false)
}

#[derive(Debug)]
struct PayloadCandidate {
    label: String,
    path: PathBuf,
    is_zip: bool,
}

fn build_payload_candidates(window: &Window, exe_dir: &Path) -> Vec<PayloadCandidate> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = window.app_handle().path().resource_dir() {
        candidates.push(PayloadCandidate {
            label: "resource_dir/payload.zip".to_string(),
            path: resource_dir.join("payload.zip"),
            is_zip: true,
        });
        candidates.push(PayloadCandidate {
            label: "resource_dir/payload".to_string(),
            path: resource_dir.join("payload"),
            is_zip: false,
        });
        // Some bundle layouts keep runtime resources under a nested resources directory.
        candidates.push(PayloadCandidate {
            label: "resource_dir/resources/payload.zip".to_string(),
            path: resource_dir.join("resources").join("payload.zip"),
            is_zip: true,
        });
        candidates.push(PayloadCandidate {
            label: "resource_dir/resources/payload".to_string(),
            path: resource_dir.join("resources").join("payload"),
            is_zip: false,
        });
    }

    candidates.push(PayloadCandidate {
        label: "exe_dir/payload.zip".to_string(),
        path: exe_dir.join("payload.zip"),
        is_zip: true,
    });
    candidates.push(PayloadCandidate {
        label: "exe_dir/payload".to_string(),
        path: exe_dir.join("payload"),
        is_zip: false,
    });
    candidates.push(PayloadCandidate {
        label: "exe_dir/resources/payload.zip".to_string(),
        path: exe_dir.join("resources").join("payload.zip"),
        is_zip: true,
    });
    candidates.push(PayloadCandidate {
        label: "exe_dir/resources/payload".to_string(),
        path: exe_dir.join("resources").join("payload"),
        is_zip: false,
    });

    candidates
}

fn find_existing_ancestor(path: &Path) -> PathBuf {
    let mut current = path.to_path_buf();
    while !current.exists() {
        if let Some(parent) = current.parent() {
            current = parent.to_path_buf();
        } else {
            break;
        }
    }
    current
}

/// Actual install root is under `{user choice}/Sparo OS` by default.
/// If the path already ends with `Sparo OS`, do not append again.
fn with_install_subdir(path: PathBuf) -> PathBuf {
    let already_install_root = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.eq_ignore_ascii_case(INSTALL_FOLDER_NAME))
        .unwrap_or(false);
    if already_install_root {
        path
    } else {
        path.join(INSTALL_FOLDER_NAME)
    }
}

fn has_any_install_manifest(install_path: &Path) -> bool {
    install_path.join(INSTALL_MANIFEST_FILENAME).exists()
}

fn has_installed_windows_app_exe(install_path: &Path) -> bool {
    install_path.join(APP_EXE_FILENAME).exists()
}

/// Stable codes for `validate_install_path` / `prepare_install_target`; localized in the frontend.
const INSTALL_PATH_ERR_PREFIX: &str = "INSTALL_PATH::";

fn prepare_install_target(requested_path: &Path) -> Result<PathBuf, String> {
    if !requested_path.is_absolute() {
        return Err(format!("{}not_absolute", INSTALL_PATH_ERR_PREFIX));
    }

    if requested_path.parent().is_none() {
        return Err(format!("{}filesystem_root", INSTALL_PATH_ERR_PREFIX));
    }

    if requested_path.exists() && !requested_path.is_dir() {
        return Err(format!("{}path_not_directory", INSTALL_PATH_ERR_PREFIX));
    }

    let install_path = with_install_subdir(requested_path.to_path_buf());

    if install_path.exists() {
        if !install_path.is_dir() {
            return Err(format!("{}path_not_directory", INSTALL_PATH_ERR_PREFIX));
        }
        if directory_has_entries(&install_path)?
            && !has_any_install_manifest(&install_path)
            && !has_installed_windows_app_exe(&install_path)
        {
            return Err(format!(
                "{}directory_must_be_empty_or_sparo",
                INSTALL_PATH_ERR_PREFIX
            ));
        }
    }

    let writable_dir = if install_path.exists() {
        install_path.clone()
    } else {
        find_existing_ancestor(&install_path)
    };
    let test_file = writable_dir.join(".sparo_install_path_test");
    match std::fs::write(&test_file, "test") {
        Ok(_) => {
            let _ = std::fs::remove_file(&test_file);
            Ok(install_path)
        }
        Err(_) if install_path.exists() => {
            Err(format!("{}directory_not_writable", INSTALL_PATH_ERR_PREFIX))
        }
        Err(_) => Err(format!("{}parent_not_writable", INSTALL_PATH_ERR_PREFIX)),
    }
}

fn directory_has_entries(path: &Path) -> Result<bool, String> {
    let mut entries = std::fs::read_dir(path)
        .map_err(|_| format!("{}inspect_directory_failed", INSTALL_PATH_ERR_PREFIX))?;
    Ok(entries
        .next()
        .transpose()
        .map_err(|_| format!("{}inspect_directory_failed", INSTALL_PATH_ERR_PREFIX))?
        .is_some())
}

fn installer_state_path() -> Result<PathBuf, String> {
    let data_root = dirs::data_local_dir()
        .or_else(dirs::config_dir)
        .ok_or_else(|| "Failed to get user data directory".to_string())?;
    Ok(data_root
        .join(INSTALLER_STATE_DIR_NAME)
        .join(INSTALLER_STATE_FILE))
}

fn read_last_install_path() -> Option<String> {
    let state_path = installer_state_path().ok()?;
    if !state_path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(&state_path).ok()?;
    let state: InstallerState = serde_json::from_str(&content).ok()?;
    let trimmed = state.last_install_path.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn persist_last_install_path(install_path: &Path) {
    let Ok(state_path) = installer_state_path() else {
        log::warn!("Could not resolve installer state path");
        return;
    };
    let state = InstallerState {
        last_install_path: install_path.to_string_lossy().to_string(),
    };
    let Some(state_dir) = state_path.parent() else {
        log::warn!("Installer state path has no parent directory");
        return;
    };
    if let Err(e) = std::fs::create_dir_all(state_dir) {
        log::warn!("Failed to create installer state directory: {}", e);
        return;
    }
    let body = match serde_json::to_string_pretty(&state) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("Failed to serialize installer state: {}", e);
            return;
        }
    };
    if let Err(e) = std::fs::write(&state_path, body) {
        log::warn!("Failed to write installer state: {}", e);
    }
}

fn preflight_validate_payload_zip_bytes(
    zip_bytes: &[u8],
    source_label: &str,
) -> Result<(), String> {
    let reader = Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(reader)
        .map_err(|e| format!("Invalid zip from {source_label}: {e}"))?;
    preflight_validate_payload_zip_archive(&mut archive, source_label)
}

fn preflight_validate_payload_zip_file(path: &Path, source_label: &str) -> Result<(), String> {
    let file = File::open(path)
        .map_err(|e| format!("Failed to open payload zip ({source_label}): {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Invalid payload zip ({source_label}): {e}"))?;
    preflight_validate_payload_zip_archive(&mut archive, source_label)
}

fn preflight_validate_payload_zip_archive<R: std::io::Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    source_label: &str,
) -> Result<(), String> {
    let mut primary_size: Option<u64> = None;
    for i in 0..archive.len() {
        let file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read payload entry ({source_label}): {e}"))?;
        if file.name().ends_with('/') {
            continue;
        }
        let file_name = zip_entry_file_name(file.name());
        if file_name.eq_ignore_ascii_case(APP_EXE_FILENAME) {
            primary_size = Some(file.size());
        }
    }

    let size = primary_size.ok_or_else(|| {
        format!("Payload from {source_label} does not contain {APP_EXE_FILENAME}")
    })?;
    validate_payload_exe_size(size, source_label)
}

fn preflight_validate_payload_dir(path: &Path, source_label: &str) -> Result<(), String> {
    let primary = path.join(APP_EXE_FILENAME);
    let meta = std::fs::metadata(&primary).map_err(|_| {
        format!(
            "Payload directory from {source_label} does not contain {}",
            primary.display()
        )
    })?;
    validate_payload_exe_size(meta.len(), source_label)
}

fn validate_payload_exe_size(size: u64, source_label: &str) -> Result<(), String> {
    if size < MIN_WINDOWS_APP_EXE_BYTES {
        return Err(format!(
            "Payload main executable from {source_label} is too small ({size} bytes)"
        ));
    }
    Ok(())
}

fn read_payload_manifest_from_zip_bytes(
    zip_bytes: &[u8],
    source_label: &str,
) -> Result<PayloadManifest, String> {
    let reader = Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(reader)
        .map_err(|e| format!("Invalid zip from {source_label}: {e}"))?;
    read_payload_manifest_from_zip_archive(&mut archive, source_label)
}

fn read_payload_manifest_from_zip_file(
    path: &Path,
    source_label: &str,
) -> Result<PayloadManifest, String> {
    let file = File::open(path)
        .map_err(|e| format!("Failed to open payload zip ({source_label}): {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Invalid payload zip ({source_label}): {e}"))?;
    read_payload_manifest_from_zip_archive(&mut archive, source_label)
}

fn read_payload_manifest_from_zip_archive<R: std::io::Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    source_label: &str,
) -> Result<PayloadManifest, String> {
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read payload entry ({source_label}): {e}"))?;
        let file_name = zip_entry_file_name(file.name());
        if !file_name.eq_ignore_ascii_case(PAYLOAD_MANIFEST_FILE) {
            continue;
        }
        let mut raw = String::new();
        file.read_to_string(&mut raw)
            .map_err(|e| format!("Failed to read payload manifest ({source_label}): {e}"))?;
        return parse_payload_manifest(&raw, source_label);
    }

    Err(format!(
        "Payload manifest is missing from {source_label}. Refusing unsafe install."
    ))
}

fn read_payload_manifest_from_dir(
    path: &Path,
    source_label: &str,
) -> Result<PayloadManifest, String> {
    let manifest_path = path.join(PAYLOAD_MANIFEST_FILE);
    let raw = std::fs::read_to_string(&manifest_path).map_err(|e| {
        format!(
            "Failed to read payload manifest from {} ({}): {}",
            source_label,
            manifest_path.display(),
            e
        )
    })?;
    parse_payload_manifest(&raw, source_label)
}

fn parse_payload_manifest(raw: &str, source_label: &str) -> Result<PayloadManifest, String> {
    serde_json::from_str(raw)
        .map_err(|e| format!("Invalid payload manifest from {source_label}: {}", e))
}

fn zip_entry_file_name(entry_name: &str) -> &str {
    entry_name
        .rsplit(&['/', '\\'][..])
        .next()
        .unwrap_or(entry_name)
}

fn is_payload_manifest_path(relative_path: &Path) -> bool {
    relative_path
        .file_name()
        .and_then(|s| s.to_str())
        .map(|n| n.eq_ignore_ascii_case(PAYLOAD_MANIFEST_FILE))
        .unwrap_or(false)
}

fn should_install_payload_path(relative_path: &Path) -> bool {
    !is_payload_manifest_path(relative_path)
}

fn write_installed_manifest(install_path: &Path, files: Vec<String>) -> Result<(), String> {
    let mut normalized: Vec<String> = files
        .into_iter()
        .map(|entry| sanitize_manifest_relative_path(&entry))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(path_buf_to_manifest_string)
        .collect();
    normalized.sort();
    normalized.dedup();

    let manifest = InstalledManifest {
        version: 1,
        files: normalized,
    };
    let path = install_path.join(INSTALL_MANIFEST_FILENAME);
    let body = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize install manifest: {}", e))?;
    std::fs::write(&path, body).map_err(|e| format!("Failed to write install manifest: {}", e))
}

fn read_installed_manifest(install_path: &Path) -> Result<Option<InstalledManifest>, String> {
    let path = install_path.join(INSTALL_MANIFEST_FILENAME);
    if path.exists() {
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read install manifest: {}", e))?;
        let manifest = serde_json::from_str::<InstalledManifest>(&raw)
            .map_err(|e| format!("Invalid install manifest: {}", e))?;
        return Ok(Some(manifest));
    }
    Ok(None)
}

fn collect_uninstall_targets(install_path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut relative_paths = match read_installed_manifest(install_path)? {
        Some(manifest) => manifest.files,
        None => vec![APP_EXE_FILENAME.to_string(), "uninstall.exe".to_string()],
    };
    relative_paths.push(INSTALL_MANIFEST_FILENAME.to_string());

    let mut targets: Vec<PathBuf> = relative_paths
        .into_iter()
        .map(|entry| sanitize_manifest_relative_path(&entry))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|entry| install_path.join(entry))
        .collect();
    targets.sort();
    targets.dedup();
    Ok(targets)
}

fn remove_installed_targets(
    install_path: &Path,
    targets: &[PathBuf],
    skip_file: Option<&Path>,
) -> Result<(), String> {
    for path in targets {
        if skip_file
            .map(|skip| paths_equal_for_platform(path, skip))
            .unwrap_or(false)
        {
            continue;
        }

        if !path.exists() {
            continue;
        }

        if path.is_file() {
            std::fs::remove_file(path).map_err(|e| {
                format!("Failed to remove installed file {}: {}", path.display(), e)
            })?;
        }
    }

    for dir in collect_parent_directories(install_path, targets) {
        let _ = std::fs::remove_dir(&dir);
    }

    Ok(())
}

fn collect_parent_directories(root: &Path, paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    for path in paths {
        let mut current = path.parent().map(|p| p.to_path_buf());
        while let Some(dir) = current {
            if paths_equal_for_platform(&dir, root) {
                break;
            }
            if dirs.iter().any(|existing| existing == &dir) {
                break;
            }
            dirs.push(dir.clone());
            current = dir.parent().map(|p| p.to_path_buf());
        }
    }

    dirs.sort_by(|a, b| {
        b.components()
            .count()
            .cmp(&a.components().count())
            .then_with(|| a.cmp(b))
    });
    dirs
}

fn sanitize_manifest_relative_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        return Err(format!("Manifest entry must be relative: {}", raw));
    }

    if path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(format!("Manifest entry escapes install directory: {}", raw));
    }

    Ok(path)
}

fn path_buf_to_manifest_string(path: PathBuf) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn verify_installed_payload(install_path: &Path) -> Result<(), String> {
    let app_exe = install_path.join(APP_EXE_FILENAME);
    let app_meta = std::fs::metadata(&app_exe)
        .map_err(|_| "Installed application executable is missing after extraction".to_string())?;
    if app_meta.len() < MIN_WINDOWS_APP_EXE_BYTES {
        return Err(format!(
            "Installed executable is too small ({} bytes). Payload is likely invalid.",
            app_meta.len()
        ));
    }

    Ok(())
}

fn paths_equal_for_platform(a: &Path, b: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        windows_path_eq_case_insensitive(a, b)
    }

    #[cfg(not(target_os = "windows"))]
    {
        a == b
    }
}

#[cfg(target_os = "windows")]
fn rollback_installation(
    install_path: &Path,
    install_dir_was_absent: bool,
    windows_state: &WindowsInstallState,
) {
    use super::registry;
    use super::shortcut;

    log::warn!("Installation failed, starting rollback");

    if windows_state.added_to_path {
        let _ = registry::remove_from_path(install_path);
    }
    if windows_state.context_menu_registered {
        let _ = registry::remove_context_menu();
    }
    if windows_state.start_menu_shortcut_created {
        let _ = shortcut::remove_start_menu_shortcut();
    }
    if windows_state.desktop_shortcut_created {
        let _ = shortcut::remove_desktop_shortcut();
    }
    if windows_state.uninstall_registered {
        let _ = registry::remove_uninstall_entry();
    }

    if install_dir_was_absent && install_path.exists() {
        let _ = std::fs::remove_dir_all(install_path);
    }
}

#[cfg(not(target_os = "windows"))]
fn rollback_installation(install_path: &Path, install_dir_was_absent: bool) {
    log::warn!("Installation failed, starting rollback");
    if install_dir_was_absent && install_path.exists() {
        let _ = std::fs::remove_dir_all(install_path);
    }
}
