use super::types::{SpeechTranscribeRequest, SpeechTranscriptionResult};
use crate::error::CoreResult;
use async_trait::async_trait;
use std::path::PathBuf;

#[async_trait]
pub trait SpeechRecognizer: Send + Sync {
    async fn warmup(&self, model_dir: PathBuf, language: String) -> CoreResult<()>;

    async fn unload(&self) -> CoreResult<()>;

    async fn transcribe(
        &self,
        request: SpeechTranscribeRequest,
    ) -> CoreResult<SpeechTranscriptionResult>;
}
