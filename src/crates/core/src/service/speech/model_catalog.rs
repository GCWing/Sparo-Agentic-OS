use super::types::{SpeechModelManifest, LOCAL_SENSEVOICE_SMALL_INT8_MODEL_ID};
use crate::error::{CoreError, CoreResult};

pub fn builtin_speech_model_manifests() -> Vec<SpeechModelManifest> {
    vec![sensevoice_small_int8_manifest()]
}

pub fn get_builtin_speech_model_manifest(model_id: &str) -> CoreResult<SpeechModelManifest> {
    builtin_speech_model_manifests()
        .into_iter()
        .find(|manifest| manifest.id == model_id)
        .ok_or_else(|| CoreError::NotFound(format!("Unknown speech model: {model_id}")))
}

pub fn sensevoice_small_int8_manifest() -> SpeechModelManifest {
    SpeechModelManifest {
        id: LOCAL_SENSEVOICE_SMALL_INT8_MODEL_ID.to_string(),
        display_name: "SenseVoice Small INT8".to_string(),
        provider: "k2-fsa/sherpa-onnx".to_string(),
        version: "2025-09-09".to_string(),
        variant: "int8".to_string(),
        description: "Local multilingual speech recognition for Mandarin, Cantonese, English, Japanese, and Korean.".to_string(),
        source_url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2".to_string(),
        source_page_url: "https://k2-fsa.github.io/sherpa/onnx/sense-voice/index.html".to_string(),
        archive_name: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2".to_string(),
        archive_size_bytes: 165_783_878,
        archive_sha256: "7305f7905bfcf77fa0b39388a313f3da35c68d971661a65475b56fb2162c8e63".to_string(),
        license_name: Some("Apache-2.0".to_string()),
        languages: vec![
            "auto".to_string(),
            "zh".to_string(),
            "yue".to_string(),
            "en".to_string(),
            "ja".to_string(),
            "ko".to_string(),
        ],
        required_files: vec![
            "model.int8.onnx".to_string(),
            "tokens.txt".to_string(),
            "README.md".to_string(),
        ],
    }
}
