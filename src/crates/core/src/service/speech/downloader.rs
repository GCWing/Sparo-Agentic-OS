use super::model_store::{validate_relative_archive_path, SpeechModelStore};
use super::types::{SpeechModelManifest, SpeechModelProgress, SpeechModelStatus};
use crate::error::{CoreError, CoreResult};
use bzip2::read::BzDecoder;
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::path::{Path, PathBuf};
use tar::Archive;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub async fn download_and_install_model<F>(
    store: &SpeechModelStore,
    manifest: &SpeechModelManifest,
    cancel: CancellationToken,
    on_progress: F,
) -> CoreResult<SpeechModelStatus>
where
    F: Fn(SpeechModelProgress) + Send + Sync,
{
    let archive_path = store.archive_download_path(manifest);
    let partial_path = store.archive_partial_path(manifest);
    if let Some(parent) = partial_path.parent() {
        fs::create_dir_all(parent).await?;
    }

    if archive_path.exists() {
        let actual_hash = sha256_file(&archive_path).await?;
        if actual_hash == manifest.archive_sha256 {
            on_progress(SpeechModelProgress {
                model_id: manifest.id.clone(),
                downloaded_bytes: manifest.archive_size_bytes,
                total_bytes: manifest.archive_size_bytes,
                percent: 100.0,
            });
            install_archive(store, manifest, &archive_path).await?;
            return store.status_for_manifest(manifest).await;
        }
        fs::remove_file(&archive_path).await?;
    }

    let client = reqwest::Client::new();
    let response = client
        .get(&manifest.source_url)
        .header(reqwest::header::USER_AGENT, "SparoOS")
        .send()
        .await?
        .error_for_status()?;

    let total_bytes = response
        .content_length()
        .unwrap_or(manifest.archive_size_bytes);
    let mut stream = response.bytes_stream();
    let mut file = fs::File::create(&partial_path).await?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0u64;

    while let Some(chunk) = stream.next().await {
        if cancel.is_cancelled() {
            let _ = fs::remove_file(&partial_path).await;
            return Err(CoreError::Cancelled(format!(
                "Speech model download cancelled: {}",
                manifest.id
            )));
        }

        let chunk = chunk?;
        file.write_all(&chunk).await?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        let percent = if total_bytes > 0 {
            downloaded as f64 / total_bytes as f64 * 100.0
        } else {
            0.0
        };
        on_progress(SpeechModelProgress {
            model_id: manifest.id.clone(),
            downloaded_bytes: downloaded,
            total_bytes,
            percent,
        });
    }
    file.flush().await?;
    drop(file);

    let actual_hash = format!("{:x}", hasher.finalize());
    if actual_hash != manifest.archive_sha256 {
        let _ = fs::remove_file(&partial_path).await;
        return Err(CoreError::validation(format!(
            "Speech model checksum mismatch: expected={}, actual={}",
            manifest.archive_sha256, actual_hash
        )));
    }

    if archive_path.exists() {
        fs::remove_file(&archive_path).await?;
    }
    fs::rename(&partial_path, &archive_path).await?;
    install_archive(store, manifest, &archive_path).await?;
    store.status_for_manifest(manifest).await
}

async fn install_archive(
    store: &SpeechModelStore,
    manifest: &SpeechModelManifest,
    archive_path: &Path,
) -> CoreResult<()> {
    let final_dir = store.model_dir(manifest);
    let parent = final_dir.parent().ok_or_else(|| {
        CoreError::service(format!(
            "Speech model path has no parent: {}",
            final_dir.display()
        ))
    })?;
    fs::create_dir_all(parent).await?;

    let staging = parent.join(format!(".installing-{}", Uuid::new_v4().simple()));
    if staging.exists() {
        fs::remove_dir_all(&staging).await?;
    }
    fs::create_dir_all(&staging).await?;

    let install_result =
        install_archive_into_staging(store, manifest, archive_path, &staging, &final_dir).await;
    if install_result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(&staging).await;
    }
    install_result
}

async fn install_archive_into_staging(
    store: &SpeechModelStore,
    manifest: &SpeechModelManifest,
    archive_path: &Path,
    staging: &Path,
    final_dir: &Path,
) -> CoreResult<()> {
    let archive_path = archive_path.to_path_buf();
    let staging_for_extract = staging.to_path_buf();
    tokio::task::spawn_blocking(move || extract_tar_bz2(&archive_path, &staging_for_extract))
        .await
        .map_err(|e| CoreError::service(format!("Speech model extraction task failed: {e}")))??;

    let payload_dir = find_payload_dir(&staging, &manifest.required_files).await?;
    if final_dir.exists() {
        fs::remove_dir_all(&final_dir).await?;
    }

    if payload_dir == staging {
        fs::rename(&staging, &final_dir).await?;
    } else {
        fs::rename(&payload_dir, &final_dir).await?;
        if staging.exists() {
            fs::remove_dir_all(&staging).await?;
        }
    }

    store.write_install_record(manifest, &final_dir).await?;
    Ok(())
}

async fn sha256_file(path: &Path) -> CoreResult<String> {
    let mut file = fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn extract_tar_bz2(archive_path: &Path, destination: &Path) -> CoreResult<()> {
    let file = File::open(archive_path)?;
    let decoder = BzDecoder::new(file);
    let mut archive = Archive::new(decoder);
    for entry in archive.entries()? {
        let mut entry = entry?;
        let relative = validate_relative_archive_path(&entry.path()?)?;
        let target = destination.join(relative);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        entry.unpack(&target)?;
    }
    Ok(())
}

async fn find_payload_dir(staging: &Path, required_files: &[String]) -> CoreResult<PathBuf> {
    if has_required_files_at(staging, required_files) {
        return Ok(staging.to_path_buf());
    }

    let mut entries = fs::read_dir(staging).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.is_dir() && has_required_files_at(&path, required_files) {
            return Ok(path);
        }
    }

    Err(CoreError::validation(
        "Downloaded speech model archive does not contain the required model files",
    ))
}

fn has_required_files_at(path: &Path, required_files: &[String]) -> bool {
    required_files
        .iter()
        .all(|relative| path.join(relative).is_file())
}
