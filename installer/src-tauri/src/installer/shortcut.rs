//! Windows shortcut (.lnk) creation for desktop and Start Menu.

use super::app_identity::{
    APP_EXE_FILENAME, DESKTOP_SHORTCUT_NAME, LEGACY_DESKTOP_SHORTCUT_NAME,
    LEGACY_START_MENU_FOLDER_NAME, START_MENU_FOLDER_NAME, START_MENU_SHORTCUT_NAME,
};
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

/// Create a desktop shortcut for Sparo OS.
pub fn create_desktop_shortcut(install_path: &Path) -> Result<()> {
    let desktop = dirs::desktop_dir().with_context(|| "Cannot find Desktop directory")?;
    let shortcut_path = desktop.join(DESKTOP_SHORTCUT_NAME);
    let exe_path = install_path.join(APP_EXE_FILENAME);

    create_lnk(&shortcut_path, &exe_path, install_path)?;
    log::info!("Created desktop shortcut at {}", shortcut_path.display());
    Ok(())
}

/// Create a Start Menu shortcut for Sparo OS.
pub fn create_start_menu_shortcut(install_path: &Path) -> Result<()> {
    let start_menu = get_start_menu_dir()?;
    let folder = start_menu.join(START_MENU_FOLDER_NAME);
    std::fs::create_dir_all(&folder)?;

    let shortcut_path = folder.join(START_MENU_SHORTCUT_NAME);
    let exe_path = install_path.join(APP_EXE_FILENAME);

    create_lnk(&shortcut_path, &exe_path, install_path)?;
    log::info!("Created Start Menu shortcut at {}", shortcut_path.display());
    Ok(())
}

/// Remove desktop shortcuts (current and legacy).
pub fn remove_desktop_shortcut() -> Result<()> {
    if let Some(desktop) = dirs::desktop_dir() {
        for name in [DESKTOP_SHORTCUT_NAME, LEGACY_DESKTOP_SHORTCUT_NAME] {
            let shortcut_path = desktop.join(name);
            if shortcut_path.exists() {
                let _ = std::fs::remove_file(&shortcut_path);
            }
        }
    }
    Ok(())
}

/// Remove Start Menu shortcut folders (current and legacy).
pub fn remove_start_menu_shortcut() -> Result<()> {
    let start_menu = get_start_menu_dir()?;
    for folder_name in [START_MENU_FOLDER_NAME, LEGACY_START_MENU_FOLDER_NAME] {
        let folder = start_menu.join(folder_name);
        if folder.exists() {
            let _ = std::fs::remove_dir_all(&folder);
        }
    }
    Ok(())
}

/// Get the current user's Start Menu Programs directory.
fn get_start_menu_dir() -> Result<PathBuf> {
    let appdata =
        std::env::var("APPDATA").with_context(|| "APPDATA environment variable not set")?;
    Ok(PathBuf::from(appdata)
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs"))
}

/// Create a .lnk shortcut file using the mslnk crate.
fn create_lnk(shortcut_path: &Path, target: &Path, _working_dir: &Path) -> Result<()> {
    let lnk = mslnk::ShellLink::new(target)
        .with_context(|| format!("Failed to create shell link for {}", target.display()))?;

    // Note: mslnk has limited API. For full control (icon, arguments, etc.),
    // consider using the windows crate with IShellLink COM interface.
    lnk.create_lnk(shortcut_path)
        .with_context(|| format!("Failed to write shortcut to {}", shortcut_path.display()))?;

    log::info!(
        "Created shortcut: {} -> {}",
        shortcut_path.display(),
        target.display()
    );
    Ok(())
}
