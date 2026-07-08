//! Local speech input services.

pub mod audio;
mod downloader;
pub mod model_catalog;
pub mod model_store;
pub mod recognizer;
mod sensevoice_int8;
pub mod types;

use self::downloader::download_and_install_model;
use self::model_catalog::get_builtin_speech_model_manifest;
use self::model_store::SpeechModelStore;
use self::recognizer::SpeechRecognizer;
use self::sensevoice_int8::SenseVoiceInt8Recognizer;
pub use self::types::*;
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::PathManager;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Clone)]
pub struct SpeechService {
    store: SpeechModelStore,
    recognizer: Arc<dyn SpeechRecognizer>,
    downloads: Arc<Mutex<HashMap<String, CancellationToken>>>,
    sessions: Arc<Mutex<HashMap<String, SpeechInputSessionState>>>,
}

#[derive(Debug)]
struct SpeechInputSessionState {
    session: SpeechInputSession,
    audio_path: PathBuf,
    received_bytes: u64,
}

impl SpeechService {
    pub fn new(path_manager: PathManager) -> Self {
        Self {
            store: SpeechModelStore::new(path_manager),
            recognizer: Arc::new(SenseVoiceInt8Recognizer::new()),
            downloads: Arc::new(Mutex::new(HashMap::new())),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn list_models(&self) -> CoreResult<SpeechListModelsResponse> {
        Ok(SpeechListModelsResponse {
            models: self.store.list_statuses().await?,
        })
    }

    pub async fn model_status(&self, model_id: &str) -> CoreResult<SpeechModelStatus> {
        let manifest = get_builtin_speech_model_manifest(model_id)?;
        self.store.status_for_manifest(&manifest).await
    }

    pub async fn download_model<F>(
        &self,
        request: SpeechDownloadModelRequest,
        on_progress: F,
    ) -> CoreResult<SpeechModelStatus>
    where
        F: Fn(SpeechModelProgressEvent) + Send + Sync,
    {
        let manifest = get_builtin_speech_model_manifest(&request.model_id)?;
        let cancel = CancellationToken::new();
        {
            let mut downloads = self.downloads.lock().await;
            if downloads.contains_key(&manifest.id) {
                return Err(CoreError::validation(format!(
                    "Speech model is already downloading: {}",
                    manifest.id
                )));
            }
            downloads.insert(manifest.id.clone(), cancel.clone());
        }

        let result = download_and_install_model(&self.store, &manifest, cancel, |progress| {
            let status = SpeechModelStatus {
                model_id: manifest.id.clone(),
                display_name: manifest.display_name.clone(),
                version: manifest.version.clone(),
                state: SpeechModelInstallState::Downloading,
                installed_path: None,
                installed_bytes: progress.downloaded_bytes,
                expected_bytes: manifest.archive_size_bytes,
                progress: Some(progress),
                error: None,
            };
            on_progress(SpeechModelProgressEvent { status });
        })
        .await;

        self.downloads.lock().await.remove(&manifest.id);
        result
    }

    pub async fn cancel_model_download(
        &self,
        request: SpeechCancelModelDownloadRequest,
    ) -> CoreResult<SpeechModelStatus> {
        let manifest = get_builtin_speech_model_manifest(&request.model_id)?;
        if let Some(token) = self.downloads.lock().await.remove(&manifest.id) {
            token.cancel();
        }
        self.store.cleanup_download(&manifest).await?;
        self.store.status_for_manifest(&manifest).await
    }

    pub async fn delete_model(
        &self,
        request: SpeechDeleteModelRequest,
    ) -> CoreResult<SpeechModelStatus> {
        let manifest = get_builtin_speech_model_manifest(&request.model_id)?;
        if let Some(token) = self.downloads.lock().await.remove(&manifest.id) {
            token.cancel();
        }
        self.recognizer.unload().await?;
        self.store.delete_model(&manifest).await
    }

    pub async fn verify_model(
        &self,
        request: SpeechVerifyModelRequest,
    ) -> CoreResult<SpeechModelStatus> {
        let manifest = get_builtin_speech_model_manifest(&request.model_id)?;
        self.store.verify_model(&manifest).await
    }

    pub async fn start_input_session(
        &self,
        request: SpeechStartInputSessionRequest,
    ) -> CoreResult<SpeechInputSession> {
        let model_id = request
            .model_id
            .unwrap_or_else(|| LOCAL_SENSEVOICE_SMALL_INT8_MODEL_ID.to_string());
        let manifest = get_builtin_speech_model_manifest(&model_id)?;
        if !self.store.has_required_files(&manifest).await {
            return Err(CoreError::NotFound(
                "Speech model is not installed; download it before starting voice input"
                    .to_string(),
            ));
        }

        let sample_rate = request.sample_rate.unwrap_or(DEFAULT_SPEECH_SAMPLE_RATE);
        if sample_rate == 0 {
            return Err(CoreError::validation(
                "Sample rate must be greater than zero",
            ));
        }
        let max_recording_seconds = request
            .max_recording_seconds
            .unwrap_or(DEFAULT_MAX_RECORDING_SECONDS);
        let language = request.language.unwrap_or_else(|| "auto".to_string());
        let model_dir = self.store.model_dir(&manifest);
        let recognizer = Arc::clone(&self.recognizer);
        let warmup_language = language.clone();
        let warmup_model_id = model_id.clone();
        tokio::spawn(async move {
            if let Err(error) = recognizer.warmup(model_dir, warmup_language).await {
                log::warn!(
                    "Failed to warm up speech recognizer: model_id={}, error={}",
                    warmup_model_id,
                    error
                );
            }
        });

        let session_id = Uuid::new_v4().to_string();
        let temp_dir = self.store.path_manager().speech_input_temp_dir();
        fs::create_dir_all(&temp_dir).await?;
        let audio_path = temp_dir.join(format!("{session_id}.pcm"));
        fs::File::create(&audio_path).await?;

        let session = SpeechInputSession {
            session_id: session_id.clone(),
            model_id,
            language,
            sample_rate,
            max_recording_seconds,
        };
        self.sessions.lock().await.insert(
            session_id,
            SpeechInputSessionState {
                session: session.clone(),
                audio_path,
                received_bytes: 0,
            },
        );
        Ok(session)
    }

    pub async fn append_audio_chunk(
        &self,
        request: SpeechAppendAudioChunkRequest,
    ) -> CoreResult<SpeechAppendAudioChunkResponse> {
        let bytes = BASE64_STANDARD
            .decode(request.pcm16_base64.as_bytes())
            .map_err(|e| CoreError::validation(format!("Invalid base64 audio chunk: {e}")))?;
        if bytes.len() % 2 != 0 {
            return Err(CoreError::validation(
                "PCM16 audio chunks must contain complete samples",
            ));
        }

        let mut sessions = self.sessions.lock().await;
        let state = sessions
            .get_mut(&request.session_id)
            .ok_or_else(|| CoreError::NotFound("Speech input session not found".to_string()))?;
        let max_bytes =
            state.session.sample_rate as u64 * state.session.max_recording_seconds as u64 * 2;
        if state.received_bytes + bytes.len() as u64 > max_bytes {
            return Err(CoreError::validation(
                "Speech input audio exceeds the recording limit",
            ));
        }

        let mut file = fs::OpenOptions::new()
            .append(true)
            .open(&state.audio_path)
            .await?;
        file.write_all(&bytes).await?;
        state.received_bytes += bytes.len() as u64;
        Ok(SpeechAppendAudioChunkResponse {
            received_bytes: state.received_bytes,
            received_seconds: audio::pcm16_duration_seconds(
                state.received_bytes,
                state.session.sample_rate,
            ),
        })
    }

    pub async fn finish_input_session(
        &self,
        request: SpeechFinishInputSessionRequest,
    ) -> CoreResult<SpeechTranscriptionResult> {
        let state = self
            .sessions
            .lock()
            .await
            .remove(&request.session_id)
            .ok_or_else(|| CoreError::NotFound("Speech input session not found".to_string()))?;
        let manifest = get_builtin_speech_model_manifest(&state.session.model_id)?;
        let pcm16_le = fs::read(&state.audio_path).await?;
        let _ = fs::remove_file(&state.audio_path).await;
        if pcm16_le.is_empty() {
            return Err(CoreError::validation("No speech audio was captured"));
        }

        self.recognizer
            .transcribe(SpeechTranscribeRequest {
                model_id: state.session.model_id,
                model_dir: self.store.model_dir(&manifest),
                pcm16_le,
                sample_rate: state.session.sample_rate,
                language: state.session.language,
            })
            .await
    }

    pub async fn cancel_input_session(
        &self,
        request: SpeechCancelInputSessionRequest,
    ) -> CoreResult<()> {
        if let Some(state) = self.sessions.lock().await.remove(&request.session_id) {
            let _ = fs::remove_file(state.audio_path).await;
        }
        Ok(())
    }
}
