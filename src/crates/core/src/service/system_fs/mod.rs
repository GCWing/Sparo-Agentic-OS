use crate::util::errors::{BitFunError, BitFunResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const LIST_DIR_LIMIT: usize = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DriveKind {
    Fixed,
    Removable,
    Network,
    Optical,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub id: String,
    pub mount: String,
    pub label: String,
    pub fs_type: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub kind: DriveKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickFolder {
    pub id: String,
    pub name: String,
    pub path: String,
    pub icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FsEntryKind {
    File,
    Dir,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub path: String,
    pub name: String,
    pub kind: FsEntryKind,
    pub size: u64,
    pub modified: Option<DateTime<Utc>>,
    pub readonly: bool,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    pub success: bool,
    pub error: Option<String>,
    pub before: Option<String>,
    pub after: Option<String>,
}

pub struct SystemFsService;

impl SystemFsService {
    pub fn list_drives() -> BitFunResult<Vec<DriveInfo>> {
        list_drives()
    }

    pub fn list_quick_folders() -> Vec<QuickFolder> {
        list_quick_folders()
    }

    pub fn list_dir(path: impl AsRef<Path>) -> BitFunResult<Vec<FsEntry>> {
        list_dir(path)
    }

    pub fn stat(path: impl AsRef<Path>) -> BitFunResult<FsEntry> {
        stat(path)
    }
}

pub fn list_drives() -> BitFunResult<Vec<DriveInfo>> {
    #[cfg(target_os = "windows")]
    {
        let mut drives = Vec::new();
        for letter in b'A'..=b'Z' {
            let mount = format!("{}:\\", letter as char);
            if Path::new(&mount).exists() {
                drives.push(DriveInfo {
                    id: mount.clone(),
                    mount: mount.clone(),
                    label: mount.clone(),
                    fs_type: String::new(),
                    total_bytes: 0,
                    free_bytes: 0,
                    kind: DriveKind::Fixed,
                });
            }
        }
        return Ok(drives);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut drives = vec![DriveInfo {
            id: "/".to_string(),
            mount: "/".to_string(),
            label: "Root".to_string(),
            fs_type: String::new(),
            total_bytes: 0,
            free_bytes: 0,
            kind: DriveKind::Fixed,
        }];

        #[cfg(target_os = "macos")]
        let extra_roots = ["/Volumes"];
        #[cfg(target_os = "linux")]
        let extra_roots = ["/mnt", "/media"];

        for root in extra_roots {
            if let Ok(entries) = std::fs::read_dir(root) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        let mount = path.to_string_lossy().into_owned();
                        let label = path
                            .file_name()
                            .and_then(|name| name.to_str())
                            .unwrap_or(&mount)
                            .to_string();
                        drives.push(DriveInfo {
                            id: mount.clone(),
                            mount,
                            label,
                            fs_type: String::new(),
                            total_bytes: 0,
                            free_bytes: 0,
                            kind: DriveKind::Fixed,
                        });
                    }
                }
            }
        }
        Ok(drives)
    }
}

pub fn list_quick_folders() -> Vec<QuickFolder> {
    let mut folders = Vec::new();
    let mut push = |id: &str, name: &str, path: Option<PathBuf>, icon: &str| {
        if let Some(path) = path {
            if is_readable_directory(&path) {
                folders.push(QuickFolder {
                    id: id.to_string(),
                    name: name.to_string(),
                    path: path.to_string_lossy().into_owned(),
                    icon: icon.to_string(),
                });
            }
        }
    };

    push("home", "Home", dirs::home_dir(), "Home");
    push("desktop", "Desktop", dirs::desktop_dir(), "Monitor");
    push("downloads", "Downloads", dirs::download_dir(), "Download");
    push("documents", "Documents", dirs::document_dir(), "FileText");
    push("pictures", "Pictures", dirs::picture_dir(), "Image");
    push("videos", "Videos", dirs::video_dir(), "Video");
    folders
}

fn is_readable_directory(path: &Path) -> bool {
    path.is_dir() && std::fs::read_dir(path).is_ok()
}

pub fn list_dir(path: impl AsRef<Path>) -> BitFunResult<Vec<FsEntry>> {
    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(path.as_ref()).map_err(|error| {
        BitFunError::service(format!(
            "Failed to list directory '{}': {}",
            path.as_ref().display(),
            error
        ))
    })?;

    for entry in read_dir.take(LIST_DIR_LIMIT).flatten() {
        if let Ok(item) = entry_from_path(&entry.path()) {
            entries.push(item);
        }
    }

    entries.sort_by(|a, b| {
        entry_kind_rank(&a.kind)
            .cmp(&entry_kind_rank(&b.kind))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.path.cmp(&b.path))
    });
    Ok(entries)
}

pub fn stat(path: impl AsRef<Path>) -> BitFunResult<FsEntry> {
    entry_from_path(path.as_ref())
}

pub fn create_file(path: impl AsRef<Path>) -> OperationResult {
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path.as_ref())
    {
        Ok(_) => OperationResult {
            success: true,
            error: None,
            before: None,
            after: Some(path.as_ref().to_string_lossy().into_owned()),
        },
        Err(error) => op_error(error),
    }
}

pub fn create_dir(path: impl AsRef<Path>) -> OperationResult {
    match std::fs::create_dir_all(path.as_ref()) {
        Ok(_) => OperationResult {
            success: true,
            error: None,
            before: None,
            after: Some(path.as_ref().to_string_lossy().into_owned()),
        },
        Err(error) => op_error(error),
    }
}

pub fn delete_path(path: impl AsRef<Path>, recursive: bool) -> OperationResult {
    let path = path.as_ref();
    let result = if path.is_dir() {
        if recursive {
            std::fs::remove_dir_all(path)
        } else {
            std::fs::remove_dir(path)
        }
    } else {
        std::fs::remove_file(path)
    };

    match result {
        Ok(_) => OperationResult {
            success: true,
            error: None,
            before: Some(path.to_string_lossy().into_owned()),
            after: None,
        },
        Err(error) => op_error(error),
    }
}

pub fn reveal_in_os(path: impl AsRef<Path>) -> BitFunResult<()> {
    let path = path.as_ref();
    let path_str = path.to_string_lossy().into_owned();
    let is_dir = path.is_dir();

    #[cfg(target_os = "windows")]
    {
        let normalized = path_str.replace('/', "\\");
        let mut command = std::process::Command::new("explorer");
        if is_dir {
            command.arg(&normalized);
        } else {
            command.args(["/select,", &normalized]);
        }
        command
            .spawn()
            .map_err(|error| BitFunError::service(error.to_string()))?;
    }

    #[cfg(target_os = "macos")]
    {
        let mut command = std::process::Command::new("open");
        if is_dir {
            command.arg(&path_str);
        } else {
            command.args(["-R", &path_str]);
        }
        command
            .spawn()
            .map_err(|error| BitFunError::service(error.to_string()))?;
    }

    #[cfg(target_os = "linux")]
    {
        let target = if is_dir {
            path.to_path_buf()
        } else {
            path.parent().unwrap_or(path).to_path_buf()
        };
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|error| BitFunError::service(error.to_string()))?;
    }

    Ok(())
}

pub fn open_with_default(path: impl AsRef<Path>) -> BitFunResult<()> {
    let path = path.as_ref().to_string_lossy().into_owned();
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &path])
        .spawn()
        .map_err(|error| BitFunError::service(error.to_string()))?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|error| BitFunError::service(error.to_string()))?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|error| BitFunError::service(error.to_string()))?;
    Ok(())
}

fn entry_from_path(path: &Path) -> BitFunResult<FsEntry> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| {
        BitFunError::service(format!("Failed to stat '{}': {}", path.display(), error))
    })?;
    let file_type = metadata.file_type();
    let kind = if file_type.is_dir() {
        FsEntryKind::Dir
    } else if file_type.is_file() {
        FsEntryKind::File
    } else if file_type.is_symlink() {
        FsEntryKind::Symlink
    } else {
        FsEntryKind::Other
    };
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
    let modified = metadata.modified().ok().map(DateTime::<Utc>::from);
    let hidden = name.starts_with('.');

    Ok(FsEntry {
        path: path.to_string_lossy().into_owned(),
        name,
        kind,
        size: metadata.len(),
        modified,
        readonly: metadata.permissions().readonly(),
        hidden,
    })
}

fn op_error(error: std::io::Error) -> OperationResult {
    OperationResult {
        success: false,
        error: Some(error.to_string()),
        before: None,
        after: None,
    }
}

fn entry_kind_rank(kind: &FsEntryKind) -> u8 {
    match kind {
        FsEntryKind::Dir => 0,
        FsEntryKind::File => 1,
        FsEntryKind::Symlink => 2,
        FsEntryKind::Other => 3,
    }
}
