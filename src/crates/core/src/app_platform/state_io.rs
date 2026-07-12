use std::{io::ErrorKind, path::Path};

use serde::Serialize;
use tokio::{
    fs::{self, OpenOptions},
    io::AsyncWriteExt,
};
use uuid::Uuid;

use crate::error::{CoreError, CoreResult};

enum JsonFileState {
    Missing,
    Valid,
    Invalid(String),
}

pub(crate) async fn atomic_write_json(path: &Path, value: &impl Serialize) -> CoreResult<()> {
    let parent = path.parent().ok_or_else(|| {
        CoreError::validation(format!("State path has no parent: {}", path.display()))
    })?;
    fs::create_dir_all(parent).await?;
    recover_atomic_json(path).await?;

    let transaction_id = Uuid::new_v4();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("state");
    let temp_path = parent.join(format!(".{file_name}.{transaction_id}.tmp"));
    let backup_path = parent.join(format!(".{file_name}.backup"));
    let payload = serde_json::to_vec_pretty(value)?;

    if let Err(error) = write_synced_temp(&temp_path, &payload).await {
        let _ = fs::remove_file(&temp_path).await;
        return Err(error);
    }

    let had_previous = fs::try_exists(path).await?;
    if had_previous {
        // Recovery intentionally retains a backup while the target is only known
        // to be syntactically valid JSON; the caller still has to deserialize it
        // into the concrete state type. Once a caller reaches a new typed write,
        // the synced temp is the durable replacement and the fixed backup slot
        // can be prepared for the current target.
        remove_if_present(&backup_path).await?;
        sync_directory_best_effort(parent).await;
        if let Err(error) = fs::rename(path, &backup_path).await {
            let _ = fs::remove_file(&temp_path).await;
            return Err(error.into());
        }
        sync_directory_best_effort(parent).await;
    }

    if let Err(commit_error) = fs::rename(&temp_path, path).await {
        if had_previous && !fs::try_exists(path).await.unwrap_or(false) {
            let _ = fs::rename(&backup_path, path).await;
            sync_directory_best_effort(parent).await;
        }
        let _ = fs::remove_file(&temp_path).await;
        return Err(commit_error.into());
    }
    sync_directory_best_effort(parent).await;

    match inspect_json_file(path).await? {
        JsonFileState::Valid => {
            if had_previous {
                remove_if_present(&backup_path).await?;
                sync_directory_best_effort(parent).await;
            }
            Ok(())
        }
        JsonFileState::Missing => Err(CoreError::validation(format!(
            "Committed state disappeared before validation: {}",
            path.display()
        ))),
        JsonFileState::Invalid(error) => Err(CoreError::validation(format!(
            "Committed state is invalid JSON; recovery backup was preserved: {} ({error})",
            path.display()
        ))),
    }
}

/// Restores the last committed state after a crash between moving the old file
/// aside and committing its replacement.
pub(crate) async fn recover_atomic_json(path: &Path) -> CoreResult<()> {
    let parent = path.parent().ok_or_else(|| {
        CoreError::validation(format!("State path has no parent: {}", path.display()))
    })?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("state");
    let backup_path = parent.join(format!(".{file_name}.backup"));

    match inspect_json_file(path).await? {
        // Generic recovery can prove JSON syntax only. Keep the backup until the
        // owning store successfully deserializes the target into its concrete
        // schema or performs the next atomic typed write.
        JsonFileState::Valid => Ok(()),
        target_state @ (JsonFileState::Missing | JsonFileState::Invalid(_)) => {
            match inspect_json_file(&backup_path).await? {
                JsonFileState::Valid => {
                    if matches!(&target_state, JsonFileState::Invalid(_)) {
                        // Delete only after proving that the backup can replace it. A crash
                        // after this removal still leaves the sole valid copy at backup_path.
                        fs::remove_file(path).await?;
                        sync_directory_best_effort(parent).await;
                    }
                    fs::rename(&backup_path, path).await?;
                    sync_directory_best_effort(parent).await;
                    Ok(())
                }
                JsonFileState::Missing if matches!(&target_state, JsonFileState::Missing) => Ok(()),
                backup_state => Err(unrecoverable_state_error(
                    path,
                    &backup_path,
                    &target_state,
                    &backup_state,
                )),
            }
        }
    }
}

async fn write_synced_temp(path: &Path, payload: &[u8]) -> CoreResult<()> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .await?;
    file.write_all(payload).await?;
    file.flush().await?;
    file.sync_all().await?;
    drop(file);
    Ok(())
}

async fn inspect_json_file(path: &Path) -> CoreResult<JsonFileState> {
    match fs::read(path).await {
        Ok(bytes) => match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(_) => Ok(JsonFileState::Valid),
            Err(error) => Ok(JsonFileState::Invalid(error.to_string())),
        },
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(JsonFileState::Missing),
        Err(error) => Err(error.into()),
    }
}

async fn remove_if_present(path: &Path) -> CoreResult<()> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

async fn sync_directory_best_effort(path: &Path) {
    // Directory handles cannot be opened for syncing on every supported
    // platform (notably common Windows filesystems), so durability is improved
    // where supported without turning that platform limitation into a failure.
    if let Ok(directory) = fs::File::open(path).await {
        let _ = directory.sync_all().await;
    }
}

fn unrecoverable_state_error(
    target_path: &Path,
    backup_path: &Path,
    target_state: &JsonFileState,
    backup_state: &JsonFileState,
) -> CoreError {
    CoreError::validation(format!(
        "No valid atomic JSON state is available; files were preserved for diagnosis: target={} ({}), backup={} ({})",
        target_path.display(),
        describe_state(target_state),
        backup_path.display(),
        describe_state(backup_state)
    ))
}

fn describe_state(state: &JsonFileState) -> &str {
    match state {
        JsonFileState::Missing => "missing",
        JsonFileState::Valid => "valid",
        JsonFileState::Invalid(error) => error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn recovers_fixed_backup_when_target_is_missing() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("registry.json");
        let backup = temp.path().join(".registry.json.backup");
        fs::write(&backup, br#"{"revision":1}"#)
            .await
            .expect("write backup");

        recover_atomic_json(&path).await.expect("recover");

        assert_eq!(
            fs::read_to_string(&path).await.expect("read state"),
            r#"{"revision":1}"#
        );
        assert!(!backup.exists());
    }

    #[tokio::test]
    async fn invalid_target_is_replaced_only_by_valid_backup() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("registry.json");
        let backup = temp.path().join(".registry.json.backup");
        fs::write(&path, b"not-json").await.expect("write target");
        fs::write(&backup, br#"{"revision":1}"#)
            .await
            .expect("write backup");

        recover_atomic_json(&path).await.expect("recover");

        assert_eq!(
            fs::read_to_string(&path).await.expect("read state"),
            r#"{"revision":1}"#
        );
        assert!(!backup.exists());
    }

    #[tokio::test]
    async fn syntactically_valid_target_keeps_backup_for_typed_validation() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("registry.json");
        let backup = temp.path().join(".registry.json.backup");
        fs::write(&path, br#"{"revision":2}"#)
            .await
            .expect("write target");
        fs::write(&backup, b"not-json").await.expect("write backup");

        recover_atomic_json(&path).await.expect("recover");

        assert_eq!(
            fs::read_to_string(&path).await.expect("read state"),
            r#"{"revision":2}"#
        );
        assert_eq!(fs::read(&backup).await.expect("read backup"), b"not-json");
    }

    #[tokio::test]
    async fn schema_invalid_but_json_valid_target_does_not_destroy_valid_backup() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("registry.json");
        let backup = temp.path().join(".registry.json.backup");
        fs::write(&path, br#"{}"#).await.expect("write target");
        fs::write(&backup, br#"{"schemaVersion":2,"apps":{}}"#)
            .await
            .expect("write backup");

        recover_atomic_json(&path).await.expect("syntax recovery");

        assert_eq!(fs::read(&path).await.expect("read target"), br#"{}"#);
        assert_eq!(
            fs::read(&backup).await.expect("read backup"),
            br#"{"schemaVersion":2,"apps":{}}"#
        );
    }

    #[tokio::test]
    async fn invalid_target_and_backup_are_preserved_when_recovery_fails() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("registry.json");
        let backup = temp.path().join(".registry.json.backup");
        fs::write(&path, b"bad-target").await.expect("write target");
        fs::write(&backup, b"bad-backup")
            .await
            .expect("write backup");

        let error = recover_atomic_json(&path)
            .await
            .expect_err("recovery must fail");

        assert!(error.to_string().contains("No valid atomic JSON state"));
        assert_eq!(fs::read(&path).await.expect("read target"), b"bad-target");
        assert_eq!(fs::read(&backup).await.expect("read backup"), b"bad-backup");
    }

    #[tokio::test]
    async fn successful_write_replaces_state_and_removes_backup() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("registry.json");
        fs::write(&path, br#"{"revision":1}"#)
            .await
            .expect("write old state");

        atomic_write_json(&path, &json!({ "revision": 2 }))
            .await
            .expect("write new state");

        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).await.expect("read state"))
                .expect("parse state");
        assert_eq!(value["revision"], 2);
        assert!(!temp.path().join(".registry.json.backup").exists());
    }
}
