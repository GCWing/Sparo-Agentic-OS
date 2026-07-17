//! Durable same-directory atomic JSON persistence.

use crate::error::{CoreError, CoreResult};
use std::ffi::OsString;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

/// Cross-process authority guard for one atomically replaced configuration file.
///
/// The lock lives in a stable sibling file because locking `app.json` itself
/// would lock the old inode/handle after an atomic replacement. Keeping the
/// file handle alive holds the exclusive OS lock on Windows, Linux, and macOS;
/// closing it releases the lock even when a task exits early with an error.
pub(crate) struct ExclusiveFileLock {
    _file: std::fs::File,
    protected_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FileMarker {
    len: u64,
    modified: std::time::SystemTime,
    created: Option<std::time::SystemTime>,
}

pub(crate) async fn file_marker(path: &Path) -> CoreResult<FileMarker> {
    let metadata = tokio::fs::metadata(path).await.map_err(|error| {
        CoreError::config(format!(
            "Failed to read configuration file metadata '{}': {error}",
            path.display()
        ))
    })?;
    let modified = metadata.modified().map_err(|error| {
        CoreError::config(format!(
            "Failed to read configuration modification time '{}': {error}",
            path.display()
        ))
    })?;
    Ok(FileMarker {
        len: metadata.len(),
        modified,
        created: metadata.created().ok(),
    })
}

impl ExclusiveFileLock {
    pub(crate) fn require_protects(&self, path: &Path) -> CoreResult<()> {
        if self.protected_path == path {
            return Ok(());
        }
        Err(CoreError::config(format!(
            "Configuration lock for '{}' cannot authorize writing '{}'",
            self.protected_path.display(),
            path.display()
        )))
    }
}

/// Acquires the cross-process write authority for `path` without blocking an
/// async runtime worker. Lock/open failures are fatal so callers never proceed
/// with an unprotected read-modify-write sequence.
pub(crate) async fn lock_exclusive(path: &Path) -> CoreResult<ExclusiveFileLock> {
    let protected_path = path.to_path_buf();
    let lock_path = lock_path_for(path)?;
    tokio::task::spawn_blocking(move || {
        let parent = lock_path.parent().ok_or_else(|| {
            CoreError::config(format!(
                "Configuration lock path '{}' has no parent",
                lock_path.display()
            ))
        })?;
        std::fs::create_dir_all(parent).map_err(|error| {
            CoreError::config(format!(
                "Failed to create configuration lock directory '{}': {error}",
                parent.display()
            ))
        })?;
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(&lock_path)
            .map_err(|error| {
                CoreError::config(format!(
                    "Failed to open configuration lock '{}': {error}",
                    lock_path.display()
                ))
            })?;
        file.lock().map_err(|error| {
            CoreError::config(format!(
                "Failed to acquire configuration lock '{}': {error}",
                lock_path.display()
            ))
        })?;
        Ok(ExclusiveFileLock {
            _file: file,
            protected_path,
        })
    })
    .await
    .map_err(|error| CoreError::config(format!("Configuration lock task failed: {error}")))?
}

fn lock_path_for(path: &Path) -> CoreResult<PathBuf> {
    let file_name = path.file_name().ok_or_else(|| {
        CoreError::config(format!(
            "Configuration path '{}' has no file name",
            path.display()
        ))
    })?;
    let mut lock_name = OsString::from(".");
    lock_name.push(file_name);
    lock_name.push(".lock");
    Ok(path.with_file_name(lock_name))
}

pub(crate) async fn write_atomic(path: &Path, bytes: &[u8]) -> CoreResult<()> {
    let parent = path.parent().ok_or_else(|| {
        CoreError::config(format!(
            "Configuration path '{}' has no parent",
            path.display()
        ))
    })?;
    tokio::fs::create_dir_all(parent).await.map_err(|error| {
        CoreError::config(format!(
            "Failed to create configuration directory '{}': {error}",
            parent.display()
        ))
    })?;

    let temp_path = temp_path_for(path);
    let result = async {
        let mut file = tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)
            .await
            .map_err(|error| {
                CoreError::config(format!(
                    "Failed to create atomic configuration file '{}': {error}",
                    temp_path.display()
                ))
            })?;
        file.write_all(bytes).await.map_err(|error| {
            CoreError::config(format!(
                "Failed to write atomic configuration file '{}': {error}",
                temp_path.display()
            ))
        })?;
        file.flush().await.map_err(|error| {
            CoreError::config(format!(
                "Failed to flush atomic configuration file '{}': {error}",
                temp_path.display()
            ))
        })?;
        file.sync_all().await.map_err(|error| {
            CoreError::config(format!(
                "Failed to sync atomic configuration file '{}': {error}",
                temp_path.display()
            ))
        })?;
        drop(file);

        replace_file(&temp_path, path).await?;
        sync_parent(parent).await?;
        Ok(())
    }
    .await;

    if result.is_err() {
        let _ = tokio::fs::remove_file(&temp_path).await;
    }
    result
}

fn temp_path_for(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config.json");
    path.with_file_name(format!(".{name}.{}.tmp", uuid::Uuid::new_v4()))
}

#[cfg(windows)]
async fn replace_file(source: &Path, destination: &Path) -> CoreResult<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(CoreError::config(format!(
            "Failed to atomically replace configuration file: {}",
            std::io::Error::last_os_error()
        )));
    }
    Ok(())
}

#[cfg(not(windows))]
async fn replace_file(source: &Path, destination: &Path) -> CoreResult<()> {
    tokio::fs::rename(source, destination)
        .await
        .map_err(|error| {
            CoreError::config(format!(
                "Failed to atomically replace configuration file '{}': {error}",
                destination.display()
            ))
        })
}

#[cfg(unix)]
async fn sync_parent(parent: &Path) -> CoreResult<()> {
    let parent = parent.to_path_buf();
    tokio::task::spawn_blocking(move || {
        std::fs::File::open(&parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| {
                CoreError::config(format!(
                    "Failed to sync configuration directory '{}': {error}",
                    parent.display()
                ))
            })
    })
    .await
    .map_err(|error| CoreError::config(format!("Configuration sync task failed: {error}")))?
}

#[cfg(not(unix))]
async fn sync_parent(_parent: &Path) -> CoreResult<()> {
    Ok(())
}
