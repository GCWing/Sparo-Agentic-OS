//! Unified configuration system type definitions
//!
//! Defines all configuration-related types shared between backend and frontend.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Stable persistence schema version for the global configuration file.
///
/// This is intentionally independent from the application package version.
pub const CONFIG_SCHEMA_VERSION: &str = "1";

/// Web UI font preferences (settings → basics). Keys match `FontPreference` in the frontend (camelCase).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct FontPreferenceSnapshot {
    pub ui_size: UiFontSizeSnapshot,
    pub flow_chat: FlowChatFontSnapshot,
    pub markdown_editor: MarkdownEditorFontSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct UiFontSizeSnapshot {
    pub level: UiFontSizeLevel,
    pub custom_px: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum UiFontSizeLevel {
    Compact,
    Small,
    Default,
    Medium,
    Large,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct FlowChatFontSnapshot {
    pub mode: FlowChatFontMode,
    pub base_px: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum FlowChatFontMode {
    Sync,
    Independent,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct MarkdownEditorFontSnapshot {
    pub mode: MarkdownEditorFontMode,
    pub base_px: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum MarkdownEditorFontMode {
    Sync,
    Independent,
}

impl Default for FontPreferenceSnapshot {
    fn default() -> Self {
        Self {
            ui_size: UiFontSizeSnapshot::default(),
            flow_chat: FlowChatFontSnapshot::default(),
            markdown_editor: MarkdownEditorFontSnapshot::default(),
        }
    }
}

impl Default for UiFontSizeSnapshot {
    fn default() -> Self {
        Self {
            level: UiFontSizeLevel::Default,
            custom_px: None,
        }
    }
}

impl Default for FlowChatFontSnapshot {
    fn default() -> Self {
        Self {
            mode: FlowChatFontMode::Sync,
            base_px: None,
        }
    }
}

impl Default for MarkdownEditorFontSnapshot {
    fn default() -> Self {
        Self {
            mode: MarkdownEditorFontMode::Sync,
            base_px: None,
        }
    }
}

/// Global configuration structure - matches the frontend `GlobalConfig` exactly.
///
/// Persisted configuration objects intentionally default missing fields and
/// ignore unknown fields. This keeps additive and subtractive field changes
/// local to the affected setting while version and semantic validation remain
/// authoritative for incompatible changes.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct GlobalConfig {
    pub app: AppConfig,
    pub editor: EditorConfig,
    pub terminal: TerminalConfig,
    pub ai: AIConfig,
    /// Product App-scoped configuration keyed by stable Product App id.
    pub product_apps: ProductAppsConfig,
    /// MCP server configuration (stored uniformly; supports both JSON and structured formats).
    pub mcp_servers: Option<serde_json::Value>,
    /// Theme system configuration.
    pub themes: ThemesConfig,
    /// Web UI font size preferences exposed through the `core.font` Catalog namespace.
    pub font: FontPreferenceSnapshot,
    /// Authenticated transaction history embedded in the same atomic file as
    /// the configuration snapshot. This is an internal persistence field and
    /// is excluded from Catalog, snapshots, diffs, and exports.
    #[serde(
        default,
        rename = "_transactionJournal",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(skip)]
    pub(crate) transaction_journal: Option<String>,
    pub version: String,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schemars(with = "i64")]
    pub last_modified: chrono::DateTime<chrono::Utc>,
}

/// Configuration owned by Product Apps.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct ProductAppsConfig {
    /// App id -> app-specific configuration.
    pub apps: HashMap<String, ProductAppConfig>,
}

impl ProductAppsConfig {
    pub const BITFUN_CODER_APP_ID: &'static str = "builtin-bitfun-coder";

    /// Returns the BitFun Coder debug config, if the app has one configured.
    pub fn bitfun_coder_debug_config(&self) -> Option<&DebugModeConfig> {
        self.apps
            .get(Self::BITFUN_CODER_APP_ID)
            .and_then(|app| app.debug.as_ref())
    }
}

/// App-scoped configuration. Typed fields cover built-in runtime contracts; extra values allow
/// future Product Apps to add narrow settings without expanding the global config schema first.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct ProductAppConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub debug: Option<DebugModeConfig>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// App configuration.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct AppConfig {
    pub language: String,
    pub logging: AppLoggingConfig,
    pub notifications: NotificationConfig,
    pub host_scan: AppHostScanConfig,
    pub ai_experience: AIExperienceConfig,
    /// User-defined keyboard shortcut overrides.
    /// Stored as opaque JSON so the backend remains schema-agnostic;
    /// the frontend owns the versioned format (StoredKeybindingsV1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keybindings: Option<serde_json::Value>,
    /// System-tray behaviour preferences.
    pub tray: AppTrayConfig,
}

/// System-tray preferences.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct AppTrayConfig {
    /// When `true` (default) the close button hides the window to the tray
    /// instead of quitting. Set to `false` to make close always quit.
    pub close_to_tray: bool,
    /// Whether the one-time explanation for close-to-tray behavior was shown.
    #[serde(default)]
    pub hide_to_tray_hint_shown: bool,
}

impl Default for AppTrayConfig {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            hide_to_tray_hint_shown: false,
        }
    }
}

/// App logging configuration.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct AppLoggingConfig {
    /// Runtime backend log level.
    /// Allowed values: trace, debug, info, warn, error, off.
    pub level: String,
}

/// Host scan automation settings.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct AppHostScanConfig {
    /// Whether automatic background host scan is enabled.
    pub auto_scan_enabled: bool,
    /// Background scan interval in days once a valid overview exists.
    pub auto_scan_interval_days: u32,
}

/// AI experience configuration.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct AIExperienceConfig {
    /// Whether Daily Letter generation is enabled.
    pub enable_daily_letter: bool,
    /// Whether to enable automatic AI-generated summaries for session titles.
    pub enable_session_title_generation: bool,
    /// Whether to enable visual mode.
    pub enable_visual_mode: bool,
    /// Whether to show the pixel Agent companion in the collapsed chat input.
    pub enable_agent_companion: bool,
    /// Optional Petdex-compatible companion package selected by the user.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_companion_pet: Option<AgentCompanionPetSelection>,
    /// Whether to show model thinking process in FlowChat.
    pub show_thinking_process: bool,
    /// Whether completed thinking blocks remain as expandable collapsed items.
    pub show_completed_thinking_item: bool,
    /// Local voice input settings for the composer.
    pub voice_input: VoiceInputConfig,
}

/// Local voice input configuration.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct VoiceInputConfig {
    /// Whether the composer should show the microphone action.
    pub enabled: bool,
    /// Default language passed to local speech recognition.
    pub default_language: String,
    /// Maximum recording length for one voice input.
    pub max_recording_seconds: u32,
}

/// User-selected Agent companion package.
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentCompanionPetSelection {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub source: String,
    pub package_path: String,
    pub spritesheet_path: String,
    pub spritesheet_mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct NotificationConfig {
    /// Whether to show a toast notification when a dialog turn completes while the window is not focused.
    pub dialog_completion_notify: bool,
    /// Whether to show built-in tip cards on startup (can be disabled by the user).
    pub enable_startup_tips: bool,
}

/// Theme system configuration.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct ThemesConfig {
    /// Currently active theme ID.
    pub current: String,
    /// User-defined themes. Each entry is a complete Web UI `ThemeConfig`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom: Option<Vec<serde_json::Value>>,
}

impl Default for ThemesConfig {
    fn default() -> Self {
        Self {
            current: "system".to_string(),
            custom: None,
        }
    }
}

/// Editor configuration.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct EditorConfig {
    pub font_size: u32,
    pub font_family: String,
    pub line_height: f64,
    pub tab_size: u32,
    pub insert_spaces: bool,
    pub word_wrap: String,
    pub line_numbers: String,
    pub minimap: MinimapConfig,
    pub theme: String,
    pub auto_save: String,
    pub auto_save_delay: u32,
    pub format_on_save: bool,
    pub format_on_paste: bool,
    pub trim_auto_whitespace: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct MinimapConfig {
    pub enabled: bool,
    pub side: String,
    pub size: String,
}

/// Terminal configuration.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct TerminalConfig {
    /// Empty string means "auto-detect".
    pub default_shell: String,
    pub font_size: u32,
    pub font_family: String,
    pub cursor_blink: bool,
    pub cursor_style: String,
    pub scrollback: u32,
    pub theme: TerminalThemeConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct TerminalThemeConfig {
    pub background: String,
    pub foreground: String,
    pub cursor: String,
    pub selection: String,
    pub black: String,
    pub red: String,
    pub green: String,
    pub yellow: String,
    pub blue: String,
    pub magenta: String,
    pub cyan: String,
    pub white: String,
    pub bright_black: String,
    pub bright_red: String,
    pub bright_green: String,
    pub bright_yellow: String,
    pub bright_blue: String,
    pub bright_magenta: String,
    pub bright_cyan: String,
    pub bright_white: String,
}

/// Model capability type (a model can have multiple capabilities).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ModelCapability {
    /// Text chat (primary capability).
    TextChat,
    /// Image understanding (vision).
    ImageUnderstanding,
    /// Image generation.
    ImageGeneration,
    /// Embeddings (semantic vectors).
    Embedding,
    /// Search API (e.g. Perplexity).
    Search,
    /// Code specialized.
    CodeSpecialized,
    /// Function calling / tool use.
    FunctionCalling,
    /// Speech-to-text.
    SpeechRecognition,
}

/// Model category (for UI display and filtering).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ModelCategory {
    /// General chat model.
    #[default]
    GeneralChat,
    /// Multimodal model (text + image understanding).
    Multimodal,
    /// Image generation model.
    ImageGeneration,
    /// Embedding / vector model.
    Embedding,
    /// Search-enhanced model.
    SearchEnhanced,
    /// Code-specialized model.
    CodeSpecialized,
    /// Speech recognition model.
    SpeechRecognition,
}

pub use sparo_ai_adapters::types::ReasoningMode;

/// Default model configuration.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
#[derive(Default)]
pub struct DefaultModelsConfig {
    /// Primary model ID (for complex tasks).
    pub primary: Option<String>,
    /// Fast model ID (for simple tasks).
    pub fast: Option<String>,
    /// Search model.
    pub search: Option<String>,
    /// Image understanding model.
    pub image_understanding: Option<String>,
    /// Image generation model.
    pub image_generation: Option<String>,
    /// Speech recognition model.
    pub speech_recognition: Option<String>,
}

/// AI configuration.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct AIConfig {
    /// All configured models.
    pub models: Vec<AIModelConfig>,

    /// Model mapping for primary agents (e.g. Explore, FileFinder).
    /// agent_type -> model_id
    pub agent_models: HashMap<String, String>,

    /// Model mapping for functional agents (e.g. session-title-func-agent, compression).
    /// func_agent_name -> model_id
    pub func_agent_models: HashMap<String, String>,

    /// Default model configuration.
    pub default_models: DefaultModelsConfig,

    /// Mode configuration.
    /// agent_id -> AgentCapabilityConfig
    pub agent_capability_configs: HashMap<String, AgentCapabilityConfig>,

    /// SubAgent configuration (enable/disable state).
    /// subagent_id -> SubAgentConfig
    pub subagent_configs: HashMap<String, SubAgentConfig>,

    /// Global proxy configuration.
    pub proxy: ProxyConfig,

    /// Streaming idle timeout in seconds; `None` means wait indefinitely.
    pub stream_idle_timeout_secs: Option<u64>,

    /// Tool execution timeout in seconds; `None` means wait indefinitely.
    pub tool_execution_timeout_secs: Option<u64>,

    /// Tool confirmation timeout in seconds; `None` means wait indefinitely.
    pub tool_confirmation_timeout_secs: Option<u64>,

    /// Skip tool execution confirmation (global, applies to all modes).
    pub skip_tool_confirmation: bool,

    /// Auto-memory runtime behavior.
    pub auto_memory: AutoMemoryConfig,

    /// Goal-mode runtime behavior.
    pub goal_mode: GoalModeConfig,

    /// Allow Computer use (desktop automation) when the desktop host is available (all session modes).
    pub computer_use_enabled: bool,
}

/// Goal-mode runtime configuration.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct GoalModeConfig {
    /// Maximum number of system-queued continuation turns for each goal.
    pub max_continuation_turns: u32,
}

/// Global auto-memory configuration.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct AutoMemoryConfig {
    /// Auto-memory settings for agentic_os global memory.
    pub global: AutoMemoryScopeConfig,

    /// Auto-memory settings for standard workspace memory.
    pub workspace: AutoMemoryScopeConfig,
}

/// Scope-specific auto-memory configuration.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct AutoMemoryScopeConfig {
    /// Whether background auto-memory extraction is enabled.
    pub enabled: bool,

    /// Run background extraction after every N eligible turns.
    pub extract_every_eligible_turns: u32,

    /// Require at least this many seconds since the last memory-consuming
    /// extraction or direct memory write before scheduling another extraction.
    pub min_extract_interval_secs: u64,

    /// If cooldown has not expired yet, force extraction once pending eligible
    /// turns reach this backlog size.
    pub force_extract_after_pending_eligible_turns: Option<u32>,

    /// Even when the eligible-turn threshold has not been reached yet, trigger
    /// auto-memory after this many seconds of session idleness since the latest
    /// eligible turn.
    pub idle_trigger_after_secs: Option<u64>,
}

impl AIConfig {
    /// Resolves a stable model id only when the model exists and is enabled.
    /// Display names and provider model names are never configuration identities.
    pub fn resolve_model_reference(&self, model_ref: &str) -> Option<String> {
        self.models
            .iter()
            .find(|model| model.enabled && model.id == model_ref)
            .map(|m| m.id.clone())
    }

    /// Returns true if the given reference points to a model that exists and is
    /// currently enabled.
    pub fn is_model_reference_active(&self, model_ref: &str) -> bool {
        self.resolve_model_reference(model_ref).is_some()
    }

    /// Returns the id of the first enabled model, if any. Model-list
    /// transactions use it as the deterministic replacement for references
    /// removed by the same atomic change.
    pub fn first_enabled_model_id(&self) -> Option<String> {
        self.models.iter().find(|m| m.enabled).map(|m| m.id.clone())
    }

    /// Resolves a model selector value.
    ///
    /// Special values:
    /// - `primary`: must resolve to a valid (enabled) primary model
    /// - `fast`: uses the configured fast model, or primary when fast is unset
    ///
    /// Regular values must be stable model ids. A configured but invalid fast id
    /// is rejected instead of being silently replaced with primary.
    pub fn resolve_model_selection(&self, model_ref: &str) -> Option<String> {
        match model_ref {
            "primary" => self
                .default_models
                .primary
                .as_deref()
                .and_then(|value| self.resolve_model_reference(value)),
            "fast" => match self.default_models.fast.as_deref() {
                Some(value) => self.resolve_model_reference(value),
                None => self
                    .default_models
                    .primary
                    .as_deref()
                    .and_then(|value| self.resolve_model_reference(value)),
            },
            _ => self.resolve_model_reference(model_ref),
        }
    }
}

/// Mode configuration (tool configuration per mode).
///
/// Model mapping has moved to `AIConfig.agent_models`, keyed by `agent_id`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct AgentCapabilityConfig {
    /// Mode ID (e.g. agentic, debug, requirement, ui-design).
    pub agent_id: String,

    /// Tools explicitly enabled by the user that are not part of the mode defaults.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub added_tools: Vec<String>,

    /// Default tools explicitly disabled by the user.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub removed_tools: Vec<String>,

    /// Whether this mode is enabled.
    pub enabled: bool,

    /// User-level skills disabled for this mode.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_user_skills: Vec<String>,

    /// User-level built-in skills explicitly enabled even though the mode default disables them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enabled_user_skills: Vec<String>,

    /// User-level suites disabled for this mode.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_user_skill_suites: Vec<String>,

    /// User-level suites explicitly enabled even though the mode default disables them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enabled_user_skill_suites: Vec<String>,

    /// Default subagents explicitly disabled for this mode.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_subagents: Vec<String>,

    /// Subagents explicitly enabled for this mode when defaults exclude them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enabled_subagents: Vec<String>,
}

/// API view of a mode configuration.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AgentCapabilityConfigView {
    pub agent_id: String,
    pub enabled_tools: Vec<String>,
    pub default_tools: Vec<String>,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_user_skills: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enabled_user_skills: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_user_skill_suites: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enabled_user_skill_suites: Vec<String>,
    pub enabled_subagents: Vec<String>,
    pub default_subagents: Vec<String>,
}

/// Default is no timeout (wait forever).
fn default_stream_idle_timeout() -> Option<u64> {
    None
}

/// Default is no timeout (wait forever).
fn default_tool_execution_timeout() -> Option<u64> {
    None
}

/// Default is no timeout (wait forever).
fn default_tool_confirmation_timeout() -> Option<u64> {
    None
}

fn default_goal_mode_max_continuation_turns() -> u32 {
    100
}

fn default_global_auto_memory_extract_every_eligible_turns() -> u32 {
    10
}

fn default_workspace_auto_memory_extract_every_eligible_turns() -> u32 {
    3
}

fn default_global_auto_memory_min_extract_interval_secs() -> u64 {
    60 * 60
}

fn default_workspace_auto_memory_min_extract_interval_secs() -> u64 {
    60 * 60
}

fn default_auto_memory_enabled() -> bool {
    true
}

fn default_global_auto_memory_force_extract_after_pending_eligible_turns() -> Option<u32> {
    Some(20)
}

fn default_workspace_auto_memory_force_extract_after_pending_eligible_turns() -> Option<u32> {
    Some(6)
}

fn default_global_auto_memory_idle_trigger_after_secs() -> Option<u64> {
    Some(15 * 60)
}

fn default_workspace_auto_memory_idle_trigger_after_secs() -> Option<u64> {
    Some(10 * 60)
}

impl Default for AgentCapabilityConfig {
    fn default() -> Self {
        Self {
            agent_id: String::new(),
            added_tools: Vec::new(),
            removed_tools: Vec::new(),
            enabled: true,
            disabled_user_skills: Vec::new(),
            enabled_user_skills: Vec::new(),
            disabled_user_skill_suites: Vec::new(),
            enabled_user_skill_suites: Vec::new(),
            disabled_subagents: Vec::new(),
            enabled_subagents: Vec::new(),
        }
    }
}

impl Default for AgentCapabilityConfigView {
    fn default() -> Self {
        Self {
            agent_id: String::new(),
            enabled_tools: Vec::new(),
            default_tools: Vec::new(),
            enabled: true,
            disabled_user_skills: Vec::new(),
            enabled_user_skills: Vec::new(),
            disabled_user_skill_suites: Vec::new(),
            enabled_user_skill_suites: Vec::new(),
            enabled_subagents: Vec::new(),
            default_subagents: Vec::new(),
        }
    }
}

/// Debug-mode configuration.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct DebugModeConfig {
    /// Custom log path (relative to the workspace; default: `.sparo_os/debug.log`).
    pub log_path: String,

    /// Ingest server port.
    pub ingest_port: u16,

    /// Enabled languages (auto-detected based on project type when empty).
    pub enabled_languages: Vec<String>,

    /// Debug template configuration per language.
    pub language_templates: HashMap<String, LanguageDebugTemplate>,
}

impl Default for DebugModeConfig {
    fn default() -> Self {
        Self {
            log_path: ".sparo_os/debug.log".to_string(),
            ingest_port: 7242,
            enabled_languages: Vec::new(),
            language_templates: Self::default_language_templates(),
        }
    }
}

impl DebugModeConfig {
    /// Returns the default language templates.
    ///
    /// Core languages (JavaScript) are enabled by default and cannot be disabled;
    /// they are included in the static prompt.
    /// Other languages (Python/Rust/Go/Java) are disabled by default and can be enabled as needed.
    pub fn default_language_templates() -> HashMap<String, LanguageDebugTemplate> {
        let mut templates = HashMap::new();

        templates.insert("javascript".to_string(), LanguageDebugTemplate {
            language: "javascript".to_string(),
            display_name: "JavaScript / TypeScript".to_string(),
            enabled: false,
            instrumentation_template: r#"fetch('http://127.0.0.1:{PORT}/ingest/{SESSION_ID}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'{LOCATION}',message:'{MESSAGE}',data:{DATA},timestamp:Date.now(),sessionId:'{SESSION_ID}',hypothesisId:'{HYPOTHESIS_ID}',runId:'{RUN_ID}'})}).catch(()=>{});"#.to_string(),
            region_start: "// #region agent log".to_string(),
            region_end: "// #endregion".to_string(),
            notes: vec![
                "Send logs to the ingest server via HTTP POST.".to_string(),
                "{DATA} must be replaced with a JavaScript object expression.".to_string(),
            ],
        });

        templates.insert("python".to_string(), LanguageDebugTemplate {
            language: "python".to_string(),
            display_name: "Python".to_string(),
            enabled: false,
            instrumentation_template: r#"import json, time, os
with open(os.path.join(os.getcwd(), '{LOG_PATH}'), 'a', encoding='utf-8') as _f:
    _f.write(json.dumps({"location": "{LOCATION}", "message": "{MESSAGE}", "data": {DATA}, "timestamp": int(time.time()*1000), "sessionId": "{SESSION_ID}", "hypothesisId": "{HYPOTHESIS_ID}", "runId": "{RUN_ID}"}, ensure_ascii=False) + '\n')"#.to_string(),
            region_start: "# region agent log".to_string(),
            region_end: "# endregion".to_string(),
            notes: vec![
                "Append NDJSON logs directly to workspace LOG_PATH.".to_string(),
                "Use ensure_ascii=False to preserve non-ASCII characters.".to_string(),
                "{DATA} must be a Python expression (e.g., {\"var\": var} or locals()).".to_string(),
                "Imports only need to be declared once at the top.".to_string(),
            ],
        });

        templates.insert("rust".to_string(), LanguageDebugTemplate {
            language: "rust".to_string(),
            display_name: "Rust".to_string(),
            enabled: false,
            instrumentation_template: r##"{
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};
    if let Ok(mut _f) = OpenOptions::new().create(true).append(true).open("{LOG_PATH}") {
        let _ts = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        let _ = writeln!(_f, r#"{{"location":"{LOCATION}","message":"{MESSAGE}","data":{},"timestamp":{},"sessionId":"{SESSION_ID}","hypothesisId":"{HYPOTHESIS_ID}","runId":"{RUN_ID}"}}"#, serde_json::json!({DATA}), _ts);
    }
}"##.to_string(),
            region_start: "// #region agent log".to_string(),
            region_end: "// #endregion".to_string(),
            notes: vec![
                "Append NDJSON logs directly to LOG_PATH.".to_string(),
                "Requires serde_json: cargo add serde_json.".to_string(),
                "{DATA} must be a Rust expression (e.g., {\"var\": var}).".to_string(),
                "Use in sync code; for async code use tokio::fs.".to_string(),
            ],
        });

        templates.insert("go".to_string(), LanguageDebugTemplate {
            language: "go".to_string(),
            display_name: "Go".to_string(),
            enabled: false,
            instrumentation_template: r#"func() {
	f, err := os.OpenFile("{LOG_PATH}", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err == nil {
		defer f.Close()
		data, _ := json.Marshal(map[string]interface{}{"location": "{LOCATION}", "message": "{MESSAGE}", "data": {DATA}, "timestamp": time.Now().UnixMilli(), "sessionId": "{SESSION_ID}", "hypothesisId": "{HYPOTHESIS_ID}", "runId": "{RUN_ID}"})
		f.Write(append(data, '\n'))
	}
}()"#.to_string(),
            region_start: "// #region agent log".to_string(),
            region_end: "// #endregion".to_string(),
            notes: vec![
                "Use an immediately-invoked anonymous function; can be inserted anywhere.".to_string(),
                "Append NDJSON logs directly to LOG_PATH.".to_string(),
                "Import \"os\", \"encoding/json\", and \"time\".".to_string(),
                "{DATA} must be a Go expression (e.g., map[string]interface{}{\"var\": var}).".to_string(),
            ],
        });

        templates.insert("java".to_string(), LanguageDebugTemplate {
            language: "java".to_string(),
            display_name: "Java".to_string(),
            enabled: false,
            instrumentation_template: r#"try {
    java.nio.file.Files.writeString(
        java.nio.file.Path.of("{LOG_PATH}"),
        String.format("{\"location\":\"{LOCATION}\",\"message\":\"{MESSAGE}\",\"data\":%s,\"timestamp\":%d,\"sessionId\":\"{SESSION_ID}\",\"hypothesisId\":\"{HYPOTHESIS_ID}\",\"runId\":\"{RUN_ID}\"}%n",
            new com.google.gson.Gson().toJson({DATA}), System.currentTimeMillis()),
        java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
} catch (Exception _e) { /* debug log */ }"#.to_string(),
            region_start: "// #region agent log".to_string(),
            region_end: "// #endregion".to_string(),
            notes: vec![
                "Append NDJSON logs directly to LOG_PATH.".to_string(),
                "Requires Gson (or use Jackson).".to_string(),
                "{DATA} must be a Java object (e.g., Map.of(\"var\", var)).".to_string(),
                "Java 11+ can use Files.writeString; older versions use Files.write + getBytes().".to_string(),
            ],
        });

        templates
    }

    /// Returns relevant templates based on detected project languages.
    pub fn get_templates_for_languages(
        &self,
        detected_languages: &[String],
    ) -> Vec<&LanguageDebugTemplate> {
        let target_languages: Vec<&str> = if !self.enabled_languages.is_empty() {
            self.enabled_languages.iter().map(|s| s.as_str()).collect()
        } else {
            detected_languages.iter().map(|s| s.as_str()).collect()
        };

        let language_mapping: HashMap<&str, &str> = [
            ("typescript", "javascript"),
            ("javascript", "javascript"),
            ("python", "python"),
            ("rust", "rust"),
            ("go", "go"),
            ("java", "java"),
            ("kotlin", "java"),
        ]
        .into_iter()
        .collect();

        let mut result = Vec::new();
        let mut seen = std::collections::HashSet::new();

        for lang in &target_languages {
            let template_lang = language_mapping.get(lang).unwrap_or(lang);
            if !seen.contains(template_lang) {
                if let Some(template) = self.language_templates.get(*template_lang) {
                    if template.enabled {
                        result.push(template);
                        seen.insert(template_lang);
                    }
                }
            }
        }

        result
    }
}

/// Language debug template.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct LanguageDebugTemplate {
    /// Language identifier (javascript, python, rust, go, java).
    pub language: String,

    /// Display name.
    pub display_name: String,

    /// Whether this language template is enabled (when enabled, user-defined templates override
    /// built-in logic).
    pub enabled: bool,

    /// Instrumentation code template.
    /// Placeholders: {LOCATION}, {MESSAGE}, {DATA}, {PORT}, {SESSION_ID}, {HYPOTHESIS_ID},
    /// {RUN_ID}, {LOG_PATH}
    pub instrumentation_template: String,

    /// Region marker start.
    pub region_start: String,

    /// Region marker end.
    pub region_end: String,

    /// Special notes.
    pub notes: Vec<String>,
}

impl Default for LanguageDebugTemplate {
    fn default() -> Self {
        Self {
            language: String::new(),
            display_name: String::new(),
            enabled: false,
            instrumentation_template: String::new(),
            region_start: "// #region agent log".to_string(),
            region_end: "// #endregion".to_string(),
            notes: Vec::new(),
        }
    }
}

/// SubAgent configuration (enabled/disabled per sub-agent).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct SubAgentConfig {
    /// Whether this SubAgent is enabled.
    pub enabled: bool,
}

impl Default for SubAgentConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct AIModelConfig {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub model_name: String,
    pub base_url: String,

    /// Computed actual request URL (auto-derived from base_url + provider format).
    /// Stored by the frontend when config is saved; falls back to base_url if absent.
    pub request_url: Option<String>,

    pub api_key: String,
    /// Context window size (total token limit for input + output).
    pub context_window: u32,
    /// Max output tokens (request parameter limiting model output length).
    pub max_tokens: Option<u32>,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub enabled: bool,
    /// Model category (primary category used for UI filtering).
    pub category: ModelCategory,
    /// Capability tags (multi-select).
    pub capabilities: Vec<ModelCapability>,
    /// Recommended use cases.
    pub recommended_for: Vec<String>,
    /// Additional metadata (JSON, for extensibility).
    pub metadata: Option<serde_json::Value>,

    /// Provider-agnostic reasoning mode.
    pub reasoning_mode: ReasoningMode,

    /// Whether to parse OpenAI-compatible text chunks containing `<think>...</think>` into
    /// streaming reasoning content.
    pub inline_think_in_text: bool,

    /// Custom HTTP request headers.
    pub custom_headers: Option<std::collections::HashMap<String, String>>,

    /// Custom header mode: "replace" (default, full replacement) or "merge" (merge; apply
    /// defaults first, then custom).
    pub custom_headers_mode: Option<String>,

    /// Whether to skip SSL certificate verification (advanced; use only when necessary).
    pub skip_ssl_verify: bool,

    /// Reasoning effort level for providers that support explicit effort controls.
    /// Valid values are provider-specific. None = use API default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,

    /// Optional Anthropic manual thinking token budget.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_budget_tokens: Option<u32>,

    /// Custom request body (JSON string, used to override default request body fields).
    pub custom_request_body: Option<String>,

    /// Custom request body mode: "merge" (default) or "trim" (keep only essential runtime
    /// fields, then apply custom JSON).
    pub custom_request_body_mode: Option<String>,

    /// Authentication source for this model. The default source is a static API key;
    /// selecting a CLI source causes the AI client
    /// factory to look up `~/.codex/auth.json` or `~/.gemini/...` at request
    /// time and inject the resolved Bearer token / extra headers.
    pub auth: AuthConfig,
}

/// Where to obtain the runtime auth material for an `AIModelConfig`.
///
/// Stored on disk as `{"type":"api_key"}` / `{"type":"codex_cli"}` /
/// `{"type":"gemini_cli"}`; the concrete sub-mode (apikey vs OAuth) is
/// auto-detected from the CLI's on-disk state at resolution time so the user
/// only has to choose "use Codex CLI" once.
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum AuthConfig {
    /// Use the inline `api_key` string.
    #[default]
    ApiKey,
    /// Reuse `~/.codex/auth.json` (apikey or ChatGPT-login).
    CodexCli,
    /// Reuse `~/.gemini/.env` or `~/.gemini/oauth_creds.json`.
    GeminiCli,
}

pub use sparo_ai_adapters::types::ProxyConfig;

/// Configuration validation result.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ConfigValidationResult {
    pub valid: bool,
    pub errors: Vec<ConfigValidationError>,
    pub warnings: Vec<ConfigValidationWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ConfigValidationError {
    pub path: String,
    pub message: String,
    pub code: String,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ConfigValidationWarning {
    pub path: String,
    pub message: String,
    pub code: String,
    pub severity: String,
}

impl Default for GlobalConfig {
    fn default() -> Self {
        Self {
            app: AppConfig::default(),
            editor: EditorConfig::default(),
            terminal: TerminalConfig::default(),
            ai: AIConfig::default(),
            product_apps: ProductAppsConfig::default(),
            mcp_servers: None,
            themes: ThemesConfig::default(),
            font: FontPreferenceSnapshot::default(),
            transaction_journal: None,
            version: CONFIG_SCHEMA_VERSION.to_string(),
            last_modified: chrono::Utc::now(),
        }
    }
}

impl Default for ProductAppsConfig {
    fn default() -> Self {
        let mut apps = HashMap::new();
        apps.insert(
            Self::BITFUN_CODER_APP_ID.to_string(),
            ProductAppConfig {
                debug: Some(DebugModeConfig::default()),
                extra: HashMap::new(),
            },
        );
        Self { apps }
    }
}

impl Default for ProductAppConfig {
    fn default() -> Self {
        Self {
            debug: None,
            extra: HashMap::new(),
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            language: "zh-CN".to_string(),
            logging: AppLoggingConfig::default(),
            notifications: NotificationConfig::default(),
            host_scan: AppHostScanConfig::default(),
            ai_experience: AIExperienceConfig::default(),
            keybindings: None,
            tray: AppTrayConfig::default(),
        }
    }
}

impl Default for AppLoggingConfig {
    fn default() -> Self {
        Self {
            // Set to Debug in early development for easier diagnostics
            level: "debug".to_string(),
        }
    }
}

impl Default for AppHostScanConfig {
    fn default() -> Self {
        Self {
            auto_scan_enabled: true,
            auto_scan_interval_days: 7,
        }
    }
}

impl Default for AIExperienceConfig {
    fn default() -> Self {
        Self {
            enable_daily_letter: true,
            enable_session_title_generation: true,
            enable_visual_mode: false,
            enable_agent_companion: true,
            agent_companion_pet: Some(AgentCompanionPetSelection {
                id: "sparky".to_string(),
                display_name: "Sparky".to_string(),
                description: Some(
                    "A cute non-pixel Sparo-inspired desktop companion with warm red-orange energy and calm agentic focus."
                        .to_string(),
                ),
                source: "preset".to_string(),
                package_path: "/agent-companion-pets/sparky".to_string(),
                spritesheet_path: "/agent-companion-pets/sparky/spritesheet.webp".to_string(),
                spritesheet_mime_type: "image/webp".to_string(),
            }),
            show_thinking_process: true,
            show_completed_thinking_item: true,
            voice_input: VoiceInputConfig::default(),
        }
    }
}

impl Default for VoiceInputConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            default_language: "auto".to_string(),
            max_recording_seconds: 60,
        }
    }
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            font_size: 14,
            font_family: "Consolas, \"Courier New\", monospace".to_string(),
            line_height: 1.5,
            tab_size: 2,
            insert_spaces: true,
            word_wrap: "off".to_string(),
            line_numbers: "on".to_string(),
            minimap: MinimapConfig {
                enabled: true,
                side: "right".to_string(),
                size: "proportional".to_string(),
            },
            theme: "vs".to_string(),
            auto_save: "afterDelay".to_string(),
            auto_save_delay: 1000,
            format_on_save: true,
            format_on_paste: true,
            trim_auto_whitespace: true,
        }
    }
}

impl Default for TerminalConfig {
    fn default() -> Self {
        Self {
            default_shell: String::new(),
            font_size: 14,
            font_family: "Consolas, \"Courier New\", monospace".to_string(),
            cursor_blink: true,
            cursor_style: "block".to_string(),
            scrollback: 1000,
            theme: TerminalThemeConfig::default(),
        }
    }
}

impl Default for TerminalThemeConfig {
    fn default() -> Self {
        Self {
            background: "#1e1e1e".to_string(),
            foreground: "#d4d4d4".to_string(),
            cursor: "#d4d4d4".to_string(),
            selection: "#264f78".to_string(),
            black: "#000000".to_string(),
            red: "#cd3131".to_string(),
            green: "#0dbc79".to_string(),
            yellow: "#e5e510".to_string(),
            blue: "#2472c8".to_string(),
            magenta: "#bc3fbc".to_string(),
            cyan: "#11a8cd".to_string(),
            white: "#e5e5e5".to_string(),
            bright_black: "#666666".to_string(),
            bright_red: "#f14c4c".to_string(),
            bright_green: "#23d18b".to_string(),
            bright_yellow: "#f5f543".to_string(),
            bright_blue: "#3b8eea".to_string(),
            bright_magenta: "#d670d6".to_string(),
            bright_cyan: "#29b8db".to_string(),
            bright_white: "#e5e5e5".to_string(),
        }
    }
}

impl Default for AIConfig {
    fn default() -> Self {
        Self {
            models: vec![],
            agent_models: std::collections::HashMap::new(),
            func_agent_models: std::collections::HashMap::new(),
            default_models: DefaultModelsConfig::default(),
            agent_capability_configs: std::collections::HashMap::new(),
            subagent_configs: std::collections::HashMap::new(),
            proxy: ProxyConfig::default(),
            stream_idle_timeout_secs: default_stream_idle_timeout(),
            tool_execution_timeout_secs: default_tool_execution_timeout(),
            tool_confirmation_timeout_secs: default_tool_confirmation_timeout(),
            skip_tool_confirmation: true,
            auto_memory: AutoMemoryConfig::default(),
            goal_mode: GoalModeConfig::default(),
            computer_use_enabled: false,
        }
    }
}

impl Default for GoalModeConfig {
    fn default() -> Self {
        Self {
            max_continuation_turns: default_goal_mode_max_continuation_turns(),
        }
    }
}

impl Default for AutoMemoryConfig {
    fn default() -> Self {
        Self {
            global: AutoMemoryScopeConfig {
                enabled: default_auto_memory_enabled(),
                extract_every_eligible_turns:
                    default_global_auto_memory_extract_every_eligible_turns(),
                min_extract_interval_secs: default_global_auto_memory_min_extract_interval_secs(),
                force_extract_after_pending_eligible_turns:
                    default_global_auto_memory_force_extract_after_pending_eligible_turns(),
                idle_trigger_after_secs: default_global_auto_memory_idle_trigger_after_secs(),
            },
            workspace: AutoMemoryScopeConfig {
                enabled: default_auto_memory_enabled(),
                extract_every_eligible_turns:
                    default_workspace_auto_memory_extract_every_eligible_turns(),
                min_extract_interval_secs: default_workspace_auto_memory_min_extract_interval_secs(
                ),
                force_extract_after_pending_eligible_turns:
                    default_workspace_auto_memory_force_extract_after_pending_eligible_turns(),
                idle_trigger_after_secs: default_workspace_auto_memory_idle_trigger_after_secs(),
            },
        }
    }
}

impl Default for AutoMemoryScopeConfig {
    fn default() -> Self {
        Self {
            enabled: default_auto_memory_enabled(),
            extract_every_eligible_turns:
                default_workspace_auto_memory_extract_every_eligible_turns(),
            min_extract_interval_secs: default_workspace_auto_memory_min_extract_interval_secs(),
            force_extract_after_pending_eligible_turns:
                default_workspace_auto_memory_force_extract_after_pending_eligible_turns(),
            idle_trigger_after_secs: default_workspace_auto_memory_idle_trigger_after_secs(),
        }
    }
}

impl Default for AIModelConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            provider: String::new(),
            model_name: String::new(),
            base_url: String::new(),
            request_url: None,
            api_key: String::new(),
            context_window: 128_128,
            max_tokens: None,
            temperature: None,
            top_p: None,
            enabled: false,
            category: ModelCategory::GeneralChat,
            capabilities: vec![],
            recommended_for: vec![],
            metadata: None,
            reasoning_mode: ReasoningMode::Default,
            inline_think_in_text: true,
            custom_headers: None,
            custom_headers_mode: None,
            skip_ssl_verify: false,
            reasoning_effort: None,
            thinking_budget_tokens: None,
            custom_request_body: None,
            custom_request_body_mode: None,
            auth: AuthConfig::ApiKey,
        }
    }
}

impl Default for NotificationConfig {
    fn default() -> Self {
        Self {
            dialog_completion_notify: true,
            enable_startup_tips: true,
        }
    }
}

impl Default for MinimapConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            side: "right".to_string(),
            size: "proportional".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AIConfig, AIModelConfig, AgentCapabilityConfig, AgentCapabilityConfigView, AuthConfig,
        GlobalConfig, ReasoningMode, CONFIG_SCHEMA_VERSION,
    };

    #[test]
    fn default_config_uses_stable_schema_version() {
        assert_eq!(GlobalConfig::default().version, CONFIG_SCHEMA_VERSION);
        assert_eq!(CONFIG_SCHEMA_VERSION, "1");
    }

    #[test]
    fn capability_configs_round_trip_when_empty_vectors_are_omitted() {
        let stored = AgentCapabilityConfig::default();
        let stored_value = serde_json::to_value(&stored).expect("serialize stored capability");
        assert!(stored_value.get("added_tools").is_none());
        assert_eq!(
            serde_json::from_value::<AgentCapabilityConfig>(stored_value)
                .expect("deserialize stored capability")
                .added_tools,
            Vec::<String>::new()
        );

        let view = AgentCapabilityConfigView::default();
        let view_value = serde_json::to_value(&view).expect("serialize capability view");
        assert!(view_value.get("disabled_user_skills").is_none());
        assert_eq!(
            serde_json::from_value::<AgentCapabilityConfigView>(view_value)
                .expect("deserialize capability view")
                .disabled_user_skills,
            Vec::<String>::new()
        );
    }

    #[test]
    fn persistent_config_defaults_missing_fields_and_ignores_removed_fields() {
        let mut config = GlobalConfig::default();
        config.ai.models.push(AIModelConfig {
            id: "preserved-model".to_string(),
            name: "Preserved model".to_string(),
            enabled: true,
            ..AIModelConfig::default()
        });
        config.ai.default_models.primary = Some("preserved-model".to_string());
        let mut value = serde_json::to_value(config).expect("serialize config");
        value["app"]
            .as_object_mut()
            .expect("app object")
            .remove("logging");
        value["themes"]["pointer"] = serde_json::json!({
            "scale": 1.25,
            "accent": "legacy"
        });
        value["ai"]["proxy"]["enabled"] = serde_json::json!(true);
        value["ai"]["proxy"]
            .as_object_mut()
            .expect("proxy object")
            .remove("url");
        value["ai"]["proxy"]["legacy_mode"] = serde_json::json!("removed");
        value["workspace"] = serde_json::json!({
            "exclude_patterns": ["**/node_modules/**"],
            "max_file_size": 52_428_800
        });
        value["app"]["auto_update"] = serde_json::json!(true);
        value["app"]["telemetry"] = serde_json::json!(false);
        value["app"]["startup_behavior"] = serde_json::json!("lastWorkspace");
        value["app"]["confirm_on_exit"] = serde_json::json!(true);
        value["app"]["restore_windows"] = serde_json::json!(true);
        value["app"]["zoom_level"] = serde_json::json!(1.0);
        value["app"]["sidebar"] = serde_json::json!({
            "width": 300,
            "collapsed": false
        });
        value["app"]["right_panel"] = serde_json::json!({
            "width": 400,
            "collapsed": true
        });
        value["app"]["notifications"]["enabled"] = serde_json::json!(true);
        value["app"]["notifications"]["position"] = serde_json::json!("topRight");
        value["app"]["notifications"]["duration"] = serde_json::json!(5000);

        let loaded =
            serde_json::from_value::<GlobalConfig>(value).expect("field evolution stays readable");
        let canonical = serde_json::to_value(&loaded).expect("serialize canonical config");

        assert_eq!(loaded.app.logging.level, "debug");
        assert_eq!(loaded.ai.models.len(), 1);
        assert_eq!(loaded.ai.models[0].id, "preserved-model");
        assert_eq!(
            loaded.ai.default_models.primary.as_deref(),
            Some("preserved-model")
        );
        assert!(loaded.ai.proxy.enabled);
        assert!(loaded.ai.proxy.url.is_empty());
        assert!(canonical["themes"].get("pointer").is_none());
        assert!(canonical["ai"]["proxy"].get("legacy_mode").is_none());
        assert!(canonical.get("workspace").is_none());
        for field in [
            "auto_update",
            "telemetry",
            "startup_behavior",
            "confirm_on_exit",
            "restore_windows",
            "zoom_level",
            "sidebar",
            "right_panel",
        ] {
            assert!(canonical["app"].get(field).is_none(), "{field}");
        }
        for field in ["enabled", "position", "duration"] {
            assert!(
                canonical["app"]["notifications"].get(field).is_none(),
                "{field}"
            );
        }
    }

    #[test]
    fn generated_schema_excludes_internal_journal_and_matches_persisted_timestamp() {
        let schema = serde_json::to_value(schemars::schema_for!(GlobalConfig))
            .expect("serialize global config schema");
        let properties = schema["properties"]
            .as_object()
            .expect("global schema properties");

        assert!(!properties.contains_key("_transactionJournal"));
        assert_eq!(properties["last_modified"]["type"], "integer");
    }

    #[test]
    fn ai_model_schema_matches_tolerant_persistence_contract() {
        let schema = serde_json::to_value(schemars::schema_for!(AIModelConfig))
            .expect("serialize model schema");
        let required = schema.get("required").and_then(serde_json::Value::as_array);

        assert!(required.map(Vec::is_empty).unwrap_or(true));
        assert_ne!(
            schema.get("additionalProperties"),
            Some(&serde_json::json!(false))
        );
    }

    #[test]
    fn ignores_removed_thinking_flag() {
        let mut value = serde_json::to_value(AIModelConfig::default()).expect("serialize model");
        value.as_object_mut().expect("model object").insert(
            "enable_thinking_process".to_string(),
            serde_json::json!(true),
        );

        let loaded =
            serde_json::from_value::<AIModelConfig>(value).expect("removed field is ignored");
        let canonical = serde_json::to_value(loaded).expect("serialize canonical model");

        assert!(canonical.get("enable_thinking_process").is_none());
    }

    #[test]
    fn defaults_missing_reasoning_mode() {
        let mut value = serde_json::to_value(AIModelConfig::default()).expect("serialize model");
        value
            .as_object_mut()
            .expect("model object")
            .remove("reasoning_mode");

        let loaded =
            serde_json::from_value::<AIModelConfig>(value).expect("new field uses current default");

        assert_eq!(loaded.reasoning_mode, ReasoningMode::Default);
    }

    #[test]
    fn reasoning_mode_is_the_only_serialized_reasoning_switch() {
        let config = AIModelConfig {
            reasoning_mode: ReasoningMode::Enabled,
            ..AIModelConfig::default()
        };

        let value = serde_json::to_value(&config).expect("config should serialize");

        assert!(value.get("enable_thinking_process").is_none());
        assert_eq!(
            value.get("reasoning_mode").and_then(|v| v.as_str()),
            Some("enabled")
        );
    }

    #[test]
    fn default_model_config_enables_inline_think_in_text() {
        let config = AIModelConfig::default();
        assert!(config.inline_think_in_text);
    }

    #[test]
    fn defaults_missing_inline_think_in_text() {
        let mut value =
            serde_json::to_value(AIModelConfig::default()).expect("serialize model config");
        value
            .as_object_mut()
            .expect("model config object")
            .remove("inline_think_in_text");
        let loaded =
            serde_json::from_value::<AIModelConfig>(value).expect("new field uses current default");

        assert!(loaded.inline_think_in_text);
    }

    #[test]
    fn default_ai_config_uses_no_stream_idle_timeout() {
        let config = AIConfig::default();

        assert_eq!(config.stream_idle_timeout_secs, None);
    }

    #[test]
    fn allows_missing_optional_stream_idle_timeout() {
        let mut value = serde_json::to_value(AIConfig::default()).expect("serialize AI config");
        value
            .as_object_mut()
            .expect("AI config object")
            .remove("stream_idle_timeout_secs");
        let config: AIConfig =
            serde_json::from_value(value).expect("optional stream idle timeout may be omitted");

        assert_eq!(config.stream_idle_timeout_secs, None);
    }

    #[test]
    fn default_goal_mode_config_uses_one_hundred_continuation_turns() {
        let config = AIConfig::default();

        assert_eq!(config.goal_mode.max_continuation_turns, 100);
    }

    #[test]
    fn defaults_missing_goal_mode() {
        let mut value = serde_json::to_value(AIConfig::default()).expect("serialize AI config");
        value
            .as_object_mut()
            .expect("AI config object")
            .remove("goal_mode");

        let loaded =
            serde_json::from_value::<AIConfig>(value).expect("new section uses current default");

        assert_eq!(loaded.goal_mode.max_continuation_turns, 100);
    }

    #[test]
    fn default_auto_memory_config_uses_split_scope_defaults() {
        let config = AIConfig::default();

        assert!(config.auto_memory.global.enabled);
        assert_eq!(config.auto_memory.global.extract_every_eligible_turns, 10);
        assert_eq!(config.auto_memory.global.min_extract_interval_secs, 60 * 60);
        assert_eq!(
            config
                .auto_memory
                .global
                .force_extract_after_pending_eligible_turns,
            Some(20)
        );
        assert!(config.auto_memory.workspace.enabled);
        assert_eq!(config.auto_memory.workspace.extract_every_eligible_turns, 3);
        assert_eq!(
            config.auto_memory.workspace.min_extract_interval_secs,
            60 * 60
        );
        assert_eq!(
            config
                .auto_memory
                .workspace
                .force_extract_after_pending_eligible_turns,
            Some(6)
        );
    }

    #[test]
    fn defaults_missing_auto_memory_scopes() {
        let value = serde_json::json!({});

        let loaded = serde_json::from_value::<super::AutoMemoryConfig>(value)
            .expect("new scopes use current defaults");

        assert_eq!(loaded.global.extract_every_eligible_turns, 10);
        assert_eq!(loaded.workspace.extract_every_eligible_turns, 3);
    }

    #[test]
    fn auth_discriminator_rejects_unknown_variants() {
        let error = serde_json::from_value::<AuthConfig>(serde_json::json!({
            "type": "removed_auth_source"
        }))
        .expect_err("security-sensitive tagged variants stay versioned");

        assert!(error.to_string().contains("removed_auth_source"));
    }
}
