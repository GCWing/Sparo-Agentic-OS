//! Typed validation for the authoritative global configuration.

use super::catalog::{SettingOptionsProvider, BUILTIN_THEME_OPTIONS};
use super::types::{
    AppConfig, AutoMemoryScopeConfig, ConfigValidationError, ConfigValidationResult,
    ConfigValidationWarning, EditorConfig, FlowChatFontMode, FontPreferenceSnapshot, GlobalConfig,
    MarkdownEditorFontMode, UiFontSizeLevel, WorkspaceConfig,
};
use crate::error::{CoreError, CoreResult};
use crate::service::speech::LOCAL_SENSEVOICE_SMALL_INT8_MODEL_REF;
use std::collections::HashSet;

/// Validates the complete typed configuration without re-serializing sections
/// or maintaining a parallel provider registry.
pub(crate) fn validate_config(config: &GlobalConfig) -> ConfigValidationResult {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    append_section_result("ai", validate_ai_config(config), &mut errors, &mut warnings);
    append_section_result(
        "app",
        validate_app_config(&config.app),
        &mut errors,
        &mut warnings,
    );
    append_section_result(
        "editor",
        validate_editor_config(&config.editor),
        &mut errors,
        &mut warnings,
    );
    append_section_result(
        "terminal",
        validate_terminal_config(config),
        &mut errors,
        &mut warnings,
    );
    append_section_result(
        "themes",
        validate_themes_config(config),
        &mut errors,
        &mut warnings,
    );
    append_section_result(
        "font",
        validate_font_config(&config.font),
        &mut errors,
        &mut warnings,
    );
    append_section_result(
        "workspace",
        validate_workspace_config(&config.workspace),
        &mut errors,
        &mut warnings,
    );

    ConfigValidationResult {
        valid: errors.is_empty(),
        errors,
        warnings,
    }
}

fn validate_themes_config(global: &GlobalConfig) -> CoreResult<Vec<String>> {
    let config = &global.themes;
    let mut declared_ids: HashSet<&str> = BUILTIN_THEME_OPTIONS.iter().map(|(id, _)| *id).collect();

    if let Some(custom_themes) = &config.custom {
        for (index, theme) in custom_themes.iter().enumerate() {
            let object = theme.as_object().ok_or_else(|| {
                CoreError::validation(format!("Custom theme at index {index} must be an object"))
            })?;
            let id = object
                .get("id")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| {
                    CoreError::validation(format!(
                        "Custom theme at index {index} must declare a non-empty string id"
                    ))
                })?;
            if id.trim().is_empty() {
                return Err(CoreError::validation(format!(
                    "Custom theme at index {index} must declare a non-empty string id"
                )));
            }
            if !declared_ids.insert(id) {
                return Err(CoreError::validation(format!(
                    "Theme id '{id}' is reserved or duplicated"
                )));
            }

            for required_field in ["name", "type", "colors", "effects", "motion", "typography"] {
                if !object.contains_key(required_field) {
                    return Err(CoreError::validation(format!(
                        "Custom theme '{id}' is missing required field '{required_field}'"
                    )));
                }
            }
            for pointer in [
                "/name",
                "/colors/background/primary",
                "/colors/background/secondary",
                "/colors/background/scene",
                "/colors/text/primary",
                "/colors/text/muted",
                "/colors/accent/500",
            ] {
                let missing = !matches!(
                    theme.pointer(pointer).and_then(serde_json::Value::as_str),
                    Some(value) if !value.trim().is_empty()
                );
                if missing {
                    return Err(CoreError::validation(format!(
                        "Custom theme '{id}' is missing required string value at '{pointer}'"
                    )));
                }
            }
            let theme_type = object
                .get("type")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| {
                    CoreError::validation(format!(
                        "Custom theme '{id}' field 'type' must be a string"
                    ))
                })?;
            if !matches!(theme_type, "light" | "dark") {
                return Err(CoreError::validation(format!(
                    "Custom theme '{id}' has unsupported type '{theme_type}'"
                )));
            }
        }
    }

    let selectable_ids = SettingOptionsProvider::AvailableThemes
        .resolve(global)
        .into_iter()
        .map(|option| option.value)
        .collect::<HashSet<_>>();
    if !selectable_ids.contains(config.current.as_str()) {
        return Err(CoreError::validation(format!(
            "Unknown current theme id '{}'",
            config.current
        )));
    }

    Ok(Vec::new())
}

fn validate_font_config(config: &FontPreferenceSnapshot) -> CoreResult<Vec<String>> {
    validate_conditional_font_size(
        "font.uiSize.customPx",
        config.ui_size.level == UiFontSizeLevel::Custom,
        config.ui_size.custom_px,
    )?;
    validate_conditional_font_size(
        "font.flowChat.basePx",
        config.flow_chat.mode == FlowChatFontMode::Independent,
        config.flow_chat.base_px,
    )?;
    validate_conditional_font_size(
        "font.markdownEditor.basePx",
        config.markdown_editor.mode == MarkdownEditorFontMode::Independent,
        config.markdown_editor.base_px,
    )?;
    Ok(Vec::new())
}

fn validate_conditional_font_size(
    path: &str,
    required: bool,
    value: Option<u32>,
) -> CoreResult<()> {
    match (required, value) {
        (true, Some(12..=20)) | (false, None) => Ok(()),
        (true, Some(value)) => Err(CoreError::validation(format!(
            "{path} must be between 12 and 20, got {value}"
        ))),
        (true, None) => Err(CoreError::validation(format!(
            "{path} is required for the selected custom font mode"
        ))),
        (false, Some(_)) => Err(CoreError::validation(format!(
            "{path} must be omitted unless its custom font mode is selected"
        ))),
    }
}

fn append_section_result(
    path: &str,
    result: CoreResult<Vec<String>>,
    errors: &mut Vec<ConfigValidationError>,
    warnings: &mut Vec<ConfigValidationWarning>,
) {
    match result {
        Ok(section_warnings) => {
            warnings.extend(
                section_warnings
                    .into_iter()
                    .map(|message| ConfigValidationWarning {
                        path: path.to_string(),
                        message,
                        code: "VALIDATION_WARNING".to_string(),
                        severity: "warning".to_string(),
                    }),
            );
        }
        Err(error) => errors.push(ConfigValidationError {
            path: path.to_string(),
            message: error.to_string(),
            code: "VALIDATION_ERROR".to_string(),
            severity: "error".to_string(),
        }),
    }
}

fn validate_ai_config(global: &GlobalConfig) -> CoreResult<Vec<String>> {
    let config = &global.ai;
    let mut warnings = Vec::new();
    let mut model_ids = HashSet::new();

    if config.stream_idle_timeout_secs == Some(0) {
        return Err(CoreError::validation(
            "AI stream_idle_timeout_secs must be greater than 0".to_string(),
        ));
    }
    if config.goal_mode.max_continuation_turns == 0 {
        return Err(CoreError::validation(
            "AI goal_mode.max_continuation_turns must be greater than 0".to_string(),
        ));
    }
    if config.goal_mode.max_continuation_turns > 1000 {
        return Err(CoreError::validation(
            "AI goal_mode.max_continuation_turns must be less than or equal to 1000".to_string(),
        ));
    }

    validate_auto_memory_scope_config("global", &config.auto_memory.global)?;
    validate_auto_memory_scope_config("workspace", &config.auto_memory.workspace)?;

    for (index, model) in config.models.iter().enumerate() {
        if model.id.trim().is_empty() {
            return Err(CoreError::validation(format!(
                "Model id is required at index {index}"
            )));
        }
        if !model_ids.insert(model.id.as_str()) {
            return Err(CoreError::validation(format!(
                "Model id '{}' is duplicated",
                model.id
            )));
        }
        if model.name.trim().is_empty() {
            return Err(CoreError::validation(format!(
                "Model name is required at index {index}"
            )));
        }
        if model.provider.trim().is_empty() {
            return Err(CoreError::validation(format!(
                "Model provider is required at index {index}"
            )));
        }
        if model.api_key.trim().is_empty() {
            warnings.push(format!("Model '{}' has empty API key", model.name));
        }
        if model.context_window == 0 {
            return Err(CoreError::validation(format!(
                "Model '{}' context_window must be greater than 0",
                model.name
            )));
        }
        if model.max_tokens == Some(0) {
            return Err(CoreError::validation(format!(
                "Model '{}' max_tokens must be greater than 0",
                model.name
            )));
        }
        if let Some(temperature) = model.temperature {
            if !(0.0..=2.0).contains(&temperature) {
                warnings.push(format!(
                    "Model '{}' temperature should be between 0 and 2",
                    model.name
                ));
            }
        }
    }

    let enabled_model_ids = SettingOptionsProvider::EnabledAiModels
        .resolve(global)
        .into_iter()
        .map(|option| option.value)
        .collect::<HashSet<_>>();
    for (slot, model_id) in [
        ("primary", config.default_models.primary.as_deref()),
        ("fast", config.default_models.fast.as_deref()),
        ("search", config.default_models.search.as_deref()),
        (
            "image_understanding",
            config.default_models.image_understanding.as_deref(),
        ),
        (
            "image_generation",
            config.default_models.image_generation.as_deref(),
        ),
        (
            "speech_recognition",
            config.default_models.speech_recognition.as_deref(),
        ),
    ] {
        if let Some(model_id) = model_id {
            let is_local_speech_target =
                slot == "speech_recognition" && model_id == LOCAL_SENSEVOICE_SMALL_INT8_MODEL_REF;
            if !enabled_model_ids.contains(model_id) && !is_local_speech_target {
                return Err(CoreError::validation(format!(
                    "Default model '{slot}' references missing or disabled model '{model_id}'"
                )));
            }
        }
    }

    for (agent_name, model_id) in &config.agent_models {
        if !enabled_model_ids.contains(model_id.as_str())
            && model_id != "primary"
            && model_id != "fast"
        {
            return Err(CoreError::validation(format!(
                "Primary Agent '{agent_name}' configured model '{model_id}' does not exist"
            )));
        }
    }
    for (agent_name, model_id) in &config.func_agent_models {
        if !enabled_model_ids.contains(model_id.as_str())
            && model_id != "primary"
            && model_id != "fast"
        {
            return Err(CoreError::validation(format!(
                "Function Agent '{agent_name}' configured model '{model_id}' does not exist"
            )));
        }
    }

    Ok(warnings)
}

fn validate_auto_memory_scope_config(
    scope_name: &str,
    config: &AutoMemoryScopeConfig,
) -> CoreResult<()> {
    if config.extract_every_eligible_turns == 0 {
        return Err(CoreError::validation(format!(
            "AI auto_memory.{scope_name}.extract_every_eligible_turns must be greater than 0"
        )));
    }

    if let Some(force_threshold) = config.force_extract_after_pending_eligible_turns {
        if force_threshold <= config.extract_every_eligible_turns {
            return Err(CoreError::validation(format!(
                "AI auto_memory.{scope_name}.force_extract_after_pending_eligible_turns must be greater than auto_memory.{scope_name}.extract_every_eligible_turns"
            )));
        }
    }

    Ok(())
}

fn validate_app_config(config: &AppConfig) -> CoreResult<Vec<String>> {
    let mut warnings = Vec::new();

    if !matches!(config.language.as_str(), "zh-CN" | "en-US") {
        return Err(CoreError::validation(format!(
            "Invalid app.language '{}': expected zh-CN or en-US",
            config.language
        )));
    }

    if config.zoom_level < 0.5 || config.zoom_level > 3.0 {
        warnings.push("Zoom level should be between 0.5 and 3.0".to_string());
    }
    if config.sidebar.width < 200 || config.sidebar.width > 800 {
        warnings.push("Sidebar width should be between 200 and 800 pixels".to_string());
    }

    if !matches!(
        config.logging.level.to_lowercase().as_str(),
        "trace" | "debug" | "info" | "warn" | "error" | "off"
    ) {
        return Err(CoreError::validation(format!(
            "Invalid app.logging.level '{}': expected one of trace/debug/info/warn/error/off",
            config.logging.level
        )));
    }
    if config.host_scan.auto_scan_interval_days == 0 {
        return Err(CoreError::validation(
            "app.host_scan.auto_scan_interval_days must be greater than 0".to_string(),
        ));
    }

    Ok(warnings)
}

fn validate_editor_config(config: &EditorConfig) -> CoreResult<Vec<String>> {
    let mut warnings = Vec::new();

    if config.font_size < 8 || config.font_size > 72 {
        warnings.push("Font size should be between 8 and 72".to_string());
    }
    if config.tab_size < 1 || config.tab_size > 8 {
        warnings.push("Tab size should be between 1 and 8".to_string());
    }
    if config.line_height < 1.0 || config.line_height > 3.0 {
        warnings.push("Line height should be between 1.0 and 3.0".to_string());
    }

    Ok(warnings)
}

fn validate_terminal_config(global: &GlobalConfig) -> CoreResult<Vec<String>> {
    let config = &global.terminal;
    if config.font_size < 8 || config.font_size > 72 {
        return Err(CoreError::validation(
            "Terminal font_size must be between 8 and 72".to_string(),
        ));
    }

    let selectable_shells = SettingOptionsProvider::AvailableTerminalShells
        .resolve(global)
        .into_iter()
        .map(|option| option.value)
        .collect::<HashSet<_>>();
    if !selectable_shells.contains(config.default_shell.as_str()) {
        return Err(CoreError::validation(format!(
            "Unknown or unavailable terminal shell '{}'",
            config.default_shell
        )));
    }

    let mut warnings = Vec::new();
    if config.scrollback > 100_000 {
        warnings.push("Large scrollback buffer may impact performance".to_string());
    }
    Ok(warnings)
}

fn validate_workspace_config(config: &WorkspaceConfig) -> CoreResult<Vec<String>> {
    let mut warnings = Vec::new();

    if config.max_file_size > 1024 * 1024 * 1024 {
        warnings.push("Very large max file size may impact performance".to_string());
    }
    if config.exclude_patterns.is_empty() {
        warnings.push("No exclude patterns defined, may scan unnecessary files".to_string());
    }

    Ok(warnings)
}

#[cfg(test)]
mod tests {
    use super::{validate_auto_memory_scope_config, validate_config};
    use crate::service::config::types::{
        AutoMemoryScopeConfig, FlowChatFontMode, GlobalConfig, UiFontSizeLevel,
    };
    use crate::service::speech::LOCAL_SENSEVOICE_SMALL_INT8_MODEL_REF;

    #[test]
    fn speech_recognition_slot_accepts_only_the_reserved_local_model_reference() {
        let mut config = GlobalConfig::default();
        config.ai.default_models.speech_recognition =
            Some(LOCAL_SENSEVOICE_SMALL_INT8_MODEL_REF.to_string());
        assert!(validate_config(&config).valid);

        config.ai.default_models.speech_recognition = Some("local:unknown-model".to_string());
        let unknown = validate_config(&config);
        assert!(!unknown.valid);
        assert!(unknown.errors.iter().any(|error| {
            error.path == "ai"
                && error
                    .message
                    .contains("speech_recognition' references missing or disabled model")
        }));

        config.ai.default_models.speech_recognition = None;
        config.ai.default_models.primary = Some(LOCAL_SENSEVOICE_SMALL_INT8_MODEL_REF.to_string());
        let wrong_slot = validate_config(&config);
        assert!(!wrong_slot.valid);
        assert!(wrong_slot.errors.iter().any(|error| {
            error.path == "ai"
                && error
                    .message
                    .contains("primary' references missing or disabled model")
        }));
    }

    #[test]
    fn validates_force_extract_threshold_is_above_base_threshold() {
        let result = validate_auto_memory_scope_config(
            "workspace",
            &AutoMemoryScopeConfig {
                extract_every_eligible_turns: 3,
                force_extract_after_pending_eligible_turns: Some(3),
                ..AutoMemoryScopeConfig::default()
            },
        );

        assert!(result.is_err());
    }

    #[test]
    fn allows_disabling_force_extract_threshold() {
        let result = validate_auto_memory_scope_config(
            "workspace",
            &AutoMemoryScopeConfig {
                extract_every_eligible_turns: 3,
                force_extract_after_pending_eligible_turns: None,
                ..AutoMemoryScopeConfig::default()
            },
        );

        assert!(result.is_ok());
    }

    #[test]
    fn rejects_invalid_ai_timeout() {
        let mut config = GlobalConfig::default();
        config.ai.stream_idle_timeout_secs = Some(0);

        let result = validate_config(&config);

        assert!(!result.valid);
        assert!(result.errors.iter().any(|error| {
            error.path == "ai"
                && error
                    .message
                    .contains("stream_idle_timeout_secs must be greater than 0")
        }));
    }

    #[test]
    fn rejects_invalid_terminal_font_size() {
        let mut config = GlobalConfig::default();
        config.terminal.font_size = 7;

        let result = validate_config(&config);

        assert!(!result.valid);
        assert!(result.errors.iter().any(|error| {
            error.path == "terminal" && error.message.contains("font_size must be between 8 and 72")
        }));
    }

    #[test]
    fn rejects_unavailable_terminal_shell() {
        let mut config = GlobalConfig::default();
        config.terminal.default_shell = "definitely-not-an-installed-shell".to_string();

        let result = validate_config(&config);

        assert!(!result.valid);
        assert!(result.errors.iter().any(|error| {
            error.path == "terminal"
                && error
                    .message
                    .contains("Unknown or unavailable terminal shell")
        }));
    }

    #[test]
    fn rejects_unsupported_app_language() {
        let mut config = GlobalConfig::default();
        config.app.language = "fr-FR".to_string();

        let result = validate_config(&config);

        assert!(!result.valid);
        assert!(result.errors.iter().any(|error| {
            error.path == "app" && error.message.contains("expected zh-CN or en-US")
        }));
    }

    #[test]
    fn rejects_unknown_theme_ids_without_legacy_aliases() {
        let mut config = GlobalConfig::default();
        config.themes.current = "sparo-light".to_string();

        let result = validate_config(&config);

        assert!(!result.valid);
        assert!(result.errors.iter().any(|error| {
            error.path == "themes" && error.message.contains("Unknown current theme id")
        }));
    }

    #[test]
    fn requires_font_values_exactly_when_custom_modes_are_selected() {
        let mut config = GlobalConfig::default();
        config.font.ui_size.level = UiFontSizeLevel::Custom;
        config.font.flow_chat.mode = FlowChatFontMode::Independent;

        let result = validate_config(&config);

        assert!(!result.valid);
        assert!(result.errors.iter().any(|error| {
            error.path == "font" && error.message.contains("font.uiSize.customPx is required")
        }));
    }
}
