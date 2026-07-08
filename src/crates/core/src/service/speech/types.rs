use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const LOCAL_SENSEVOICE_SMALL_INT8_MODEL_ID: &str = "sensevoice-small-int8";
pub const LOCAL_SENSEVOICE_SMALL_INT8_MODEL_REF: &str = "local:sensevoice-small-int8";
pub const DEFAULT_SPEECH_SAMPLE_RATE: u32 = 16_000;
pub const DEFAULT_MAX_RECORDING_SECONDS: u32 = 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechModelManifest {
    pub id: String,
    pub display_name: String,
    pub provider: String,
    pub version: String,
    pub variant: String,
    pub description: String,
    pub source_url: String,
    pub source_page_url: String,
    pub archive_name: String,
    pub archive_size_bytes: u64,
    pub archive_sha256: String,
    pub license_name: Option<String>,
    pub languages: Vec<String>,
    pub required_files: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpeechModelInstallState {
    NotInstalled,
    Downloading,
    Installed,
    Verifying,
    Corrupt,
    Deleting,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechModelProgress {
    pub model_id: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechModelStatus {
    pub model_id: String,
    pub display_name: String,
    pub version: String,
    pub state: SpeechModelInstallState,
    pub installed_path: Option<PathBuf>,
    pub installed_bytes: u64,
    pub expected_bytes: u64,
    pub progress: Option<SpeechModelProgress>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechListModelsResponse {
    pub models: Vec<SpeechModelStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechDownloadModelRequest {
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechCancelModelDownloadRequest {
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechDeleteModelRequest {
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechVerifyModelRequest {
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechModelProgressEvent {
    pub status: SpeechModelStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechStartInputSessionRequest {
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub sample_rate: Option<u32>,
    #[serde(default)]
    pub max_recording_seconds: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechInputSession {
    pub session_id: String,
    pub model_id: String,
    pub language: String,
    pub sample_rate: u32,
    pub max_recording_seconds: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechAppendAudioChunkRequest {
    pub session_id: String,
    /// Base64-encoded PCM16 little-endian mono audio.
    pub pcm16_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechAppendAudioChunkResponse {
    pub received_bytes: u64,
    pub received_seconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechFinishInputSessionRequest {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechCancelInputSessionRequest {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechTranscriptionResult {
    pub text: String,
    pub language: String,
    pub duration_ms: u64,
    pub audio_duration_seconds: f64,
}

#[derive(Debug, Clone)]
pub struct SpeechTranscribeRequest {
    pub model_id: String,
    pub model_dir: PathBuf,
    pub pcm16_le: Vec<u8>,
    pub sample_rate: u32,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSpeechModelRecord {
    pub id: String,
    pub version: String,
    pub installed_at_ms: i64,
    pub source_url: String,
    pub archive_sha256: String,
}
