use serde::Serialize;
use sparo_events::{published_config_error_code, published_settings_agent_error_code};
use std::fmt::Display;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicCommandError {
    code: String,
}

impl PublicCommandError {
    pub(crate) fn new(code: &'static str) -> Self {
        Self {
            code: code.to_string(),
        }
    }

    pub(crate) fn code(&self) -> &str {
        &self.code
    }
}

pub(crate) fn public_config_error(error: &impl Display) -> PublicCommandError {
    let internal = error.to_string();
    PublicCommandError::new(published_config_error_code(&internal))
}

pub(crate) fn public_settings_agent_error(error: &impl Display) -> PublicCommandError {
    let internal = error.to_string();
    PublicCommandError::new(published_settings_agent_error_code(&internal))
}
