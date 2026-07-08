use super::model_catalog::builtin_speech_model_manifests;
use super::types::{
    InstalledSpeechModelRecord, SpeechModelInstallState, SpeechModelManifest, SpeechModelStatus,
};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::PathManager;
use chrono::Utc;
use serde_json::json;
use std::path::{Component, Path, PathBuf};
use tokio::fs;

const INSTALL_RECORD_FILE: &str = "sparo-model-install.json";

#[derive(Clone)]
pub struct SpeechModelStore {
    path_manager: PathManager,
}

impl SpeechModelStore {
    pub fn new(path_manager: PathManager) -> Self {
        Self { path_manager }
    }

    pub fn path_manager(&self) -> &PathManager {
        &self.path_manager
    }

    pub fn model_dir(&self, manifest: &SpeechModelManifest) -> PathBuf {
        self.path_manager
            .speech_model_dir(&manifest.id, &manifest.version)
    }

    pub fn archive_download_path(&self, manifest: &SpeechModelManifest) -> PathBuf {
        self.path_manager
            .speech_model_downloads_dir()
            .join(&manifest.id)
            .join(&manifest.version)
            .join(&manifest.archive_name)
    }

    pub fn archive_partial_path(&self, manifest: &SpeechModelManifest) -> PathBuf {
        self.archive_download_path(manifest)
            .with_extension("partial")
    }

    pub async fn list_statuses(&self) -> CoreResult<Vec<SpeechModelStatus>> {
        let mut statuses = Vec::new();
        for manifest in builtin_speech_model_manifests() {
            statuses.push(self.status_for_manifest(&manifest).await?);
        }
        Ok(statuses)
    }

    pub async fn status_for_manifest(
        &self,
        manifest: &SpeechModelManifest,
    ) -> CoreResult<SpeechModelStatus> {
        let model_dir = self.model_dir(manifest);
        let installed_bytes = dir_size(&model_dir).await?;
        let installed = self.has_required_files(manifest).await;
        let state = if installed {
            SpeechModelInstallState::Installed
        } else if model_dir.exists() {
            SpeechModelInstallState::Corrupt
        } else {
            SpeechModelInstallState::NotInstalled
        };

        Ok(SpeechModelStatus {
            model_id: manifest.id.clone(),
            display_name: manifest.display_name.clone(),
            version: manifest.version.clone(),
            state,
            installed_path: installed.then_some(model_dir),
            installed_bytes,
            expected_bytes: manifest.archive_size_bytes,
            progress: None,
            error: None,
        })
    }

    pub async fn has_required_files(&self, manifest: &SpeechModelManifest) -> bool {
        let model_dir = self.model_dir(manifest);
        if !model_dir.is_dir() {
            return false;
        }

        manifest
            .required_files
            .iter()
            .all(|relative| model_dir.join(relative).is_file())
    }

    pub async fn verify_model(
        &self,
        manifest: &SpeechModelManifest,
    ) -> CoreResult<SpeechModelStatus> {
        let mut status = self.status_for_manifest(manifest).await?;
        if !self.has_required_files(manifest).await {
            status.state = SpeechModelInstallState::Corrupt;
            status.error = Some("Required model files are missing".to_string());
        }
        Ok(status)
    }

    pub async fn write_install_record(
        &self,
        manifest: &SpeechModelManifest,
        model_dir: &Path,
    ) -> CoreResult<()> {
        let record = InstalledSpeechModelRecord {
            id: manifest.id.clone(),
            version: manifest.version.clone(),
            installed_at_ms: Utc::now().timestamp_millis(),
            source_url: manifest.source_url.clone(),
            archive_sha256: manifest.archive_sha256.clone(),
        };
        let payload = serde_json::to_vec_pretty(&json!({
            "model": manifest,
            "install": record,
        }))?;
        fs::write(model_dir.join(INSTALL_RECORD_FILE), payload).await?;
        Ok(())
    }

    pub async fn delete_model(
        &self,
        manifest: &SpeechModelManifest,
    ) -> CoreResult<SpeechModelStatus> {
        let root = self.path_manager.speech_models_dir();
        let target = self.model_dir(manifest);
        if !target.exists() {
            return self.status_for_manifest(manifest).await;
        }

        let root = canonical_or_create(&root).await?;
        let resolved = target
            .canonicalize()
            .map_err(|e| CoreError::service(format!("Failed to resolve speech model path: {e}")))?;
        if !resolved.starts_with(&root) {
            return Err(CoreError::validation(
                "Refusing to delete path outside managed speech models directory",
            ));
        }

        fs::remove_dir_all(&resolved).await?;
        self.cleanup_download(manifest).await?;
        self.status_for_manifest(manifest).await
    }

    pub async fn cleanup_download(&self, manifest: &SpeechModelManifest) -> CoreResult<()> {
        let dir = self
            .path_manager
            .speech_model_downloads_dir()
            .join(&manifest.id)
            .join(&manifest.version);
        if dir.exists() {
            fs::remove_dir_all(dir).await?;
        }
        Ok(())
    }
}

pub fn validate_relative_archive_path(path: &Path) -> CoreResult<PathBuf> {
    let mut sanitized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => sanitized.push(part),
            Component::CurDir => {}
            _ => {
                return Err(CoreError::validation(format!(
                    "Archive entry contains unsafe path: {}",
                    path.display()
                )));
            }
        }
    }
    if sanitized.as_os_str().is_empty() {
        return Err(CoreError::validation("Archive entry path is empty"));
    }
    Ok(sanitized)
}

pub async fn dir_size(path: &Path) -> CoreResult<u64> {
    fn inner(
        path: &Path,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = CoreResult<u64>> + Send + '_>> {
        Box::pin(async move {
            if !path.exists() {
                return Ok(0);
            }
            let metadata = fs::metadata(path).await?;
            if metadata.is_file() {
                return Ok(metadata.len());
            }

            let mut total = 0u64;
            let mut entries = fs::read_dir(path).await?;
            while let Some(entry) = entries.next_entry().await? {
                total += inner(&entry.path()).await?;
            }
            Ok(total)
        })
    }

    inner(path).await
}

async fn canonical_or_create(path: &Path) -> CoreResult<PathBuf> {
    fs::create_dir_all(path).await?;
    path.canonicalize()
        .map_err(|e| CoreError::service(format!("Failed to resolve directory: {e}")))
}
