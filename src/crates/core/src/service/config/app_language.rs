//! Canonical UI language for user-facing AI output.
//!
//! Desktop and CLI store the active locale in `app.language`. Agent prompts and other localized
//! AI output read the same persisted setting through this module.

use super::GlobalConfigManager;
use crate::error::{CoreError, CoreResult};

/// Returns the validated UI language from the authoritative global config.
pub async fn get_app_language_code() -> CoreResult<String> {
    let code = GlobalConfigManager::get_service()
        .await?
        .get_config::<String>(Some("app.language"))
        .await?;
    if matches!(code.as_str(), "zh-CN" | "en-US") {
        Ok(code)
    } else {
        Err(CoreError::config(format!(
            "Unsupported app.language value: {code}"
        )))
    }
}

/// Short instruction for models to answer in the app UI language (session titles, etc.).
pub fn short_model_user_language_instruction(lang_code: &str) -> CoreResult<&'static str> {
    match lang_code {
        "en-US" => Ok("Use English"),
        "zh-CN" => Ok("使用简体中文"),
        _ => Err(CoreError::config(format!(
            "Unsupported app language code: {lang_code}"
        ))),
    }
}
