//! Sparo OS installer branding.

pub const APP_DISPLAY_NAME: &str = "Sparo OS";
pub const APP_PUBLISHER: &str = "Sparo OS Team";

/// Windows executable name in install directory and payload archive (no spaces).
pub const APP_EXE_FILENAME: &str = "SparoOS.exe";

/// Subdirectory appended under the user-chosen install root on Windows.
pub const INSTALL_FOLDER_NAME: &str = "Sparo OS";

/// Install manifest written by new installers.
pub const INSTALL_MANIFEST_FILENAME: &str = ".sparo-os-install-manifest.json";

pub const UNINSTALL_REGISTRY_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Uninstall\SparoOS";

pub const CONTEXT_MENU_SHELL_KEY: &str = "SparoOS";
pub const CONTEXT_MENU_VERB: &str = "Open with Sparo OS";

pub const DESKTOP_SHORTCUT_NAME: &str = "Sparo OS.lnk";

pub const START_MENU_FOLDER_NAME: &str = "Sparo OS";
pub const START_MENU_SHORTCUT_NAME: &str = "Sparo OS.lnk";
