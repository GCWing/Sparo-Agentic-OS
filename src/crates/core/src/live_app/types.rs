//! Live App types — data model and permissions (V2: ESM UI + Node Worker).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// ESM dependency for Import Map (browser UI).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EsmDep {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// NPM dependency for Worker (package.json).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NpmDep {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LiveAppBuildMode {
    InlineLegacy,
    NativeEsm,
    Bundled,
}

impl Default for LiveAppBuildMode {
    fn default() -> Self {
        Self::InlineLegacy
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppEntry {
    #[serde(default = "default_ui_entry")]
    pub ui_entry: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worker_entry: Option<String>,
    #[serde(default)]
    pub style_entries: Vec<String>,
    #[serde(default)]
    pub build_mode: LiveAppBuildMode,
}

fn default_ui_entry() -> String {
    "ui.js".to_string()
}

impl Default for LiveAppEntry {
    fn default() -> Self {
        Self {
            ui_entry: default_ui_entry(),
            worker_entry: Some("worker.js".to_string()),
            style_entries: vec!["style.css".to_string()],
            build_mode: LiveAppBuildMode::InlineLegacy,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppSourceFile {
    pub path: String,
    #[serde(default)]
    pub kind: LiveAppSourceFileKind,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LiveAppSourceFileKind {
    Script,
    Style,
    Html,
    Worker,
    Json,
    Asset,
}

impl Default for LiveAppSourceFileKind {
    fn default() -> Self {
        Self::Asset
    }
}

/// Live App source: UI layer (browser) + Worker layer (Node.js).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveAppSource {
    pub html: String,
    pub css: String,
    /// ESM module code running in the browser.
    #[serde(rename = "ui_js")]
    pub ui_js: String,
    #[serde(default, rename = "esm_dependencies")]
    pub esm_dependencies: Vec<EsmDep>,
    /// Locale messages keyed by locale id, then message key.
    #[serde(default = "default_i18n_messages", rename = "i18n_messages")]
    pub i18n_messages: serde_json::Value,
    /// Node.js Worker logic (source/worker.js).
    #[serde(rename = "worker_js")]
    pub worker_js: String,
    #[serde(default, rename = "npm_dependencies")]
    pub npm_dependencies: Vec<NpmDep>,
    #[serde(default)]
    pub entry: LiveAppEntry,
    #[serde(default)]
    pub source_files: Vec<LiveAppSourceFile>,
}

fn default_i18n_messages() -> serde_json::Value {
    serde_json::json!({})
}

impl Default for LiveAppSource {
    fn default() -> Self {
        Self {
            html: String::new(),
            css: String::new(),
            ui_js: String::new(),
            esm_dependencies: Vec::new(),
            i18n_messages: default_i18n_messages(),
            worker_js: String::new(),
            npm_dependencies: Vec::new(),
            entry: LiveAppEntry::default(),
            source_files: Vec::new(),
        }
    }
}

/// Permissions manifest (resolved to policy for JS Worker).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LiveAppPermissions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fs: Option<FsPermissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shell: Option<ShellPermissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub net: Option<NetPermissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node: Option<NodePermissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai: Option<AiPermissions>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FsPermissions {
    /// Path scopes: "{appdata}", "{workspace}", "{home}", or absolute paths.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub write: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ShellPermissions {
    /// Command allowlist (e.g. ["git", "ffmpeg"]). Empty = all forbidden.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NetPermissions {
    /// Domain allowlist. "*" = all.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow: Option<Vec<String>>,
}

/// Node.js Worker permissions (memory, timeout).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NodePermissions {
    #[serde(default = "default_node_enabled")]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_memory_mb: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

fn default_node_enabled() -> bool {
    true
}

/// AI permissions — controls access to the host application's AI client.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AiPermissions {
    /// Whether AI access is enabled for this Live App.
    #[serde(default)]
    pub enabled: bool,
    /// Allowed model references (e.g. ["primary", "fast"] or specific model ids).
    /// Empty or absent means only "primary" is allowed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_models: Option<Vec<String>>,
    /// Maximum output tokens per single request.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens_per_request: Option<u32>,
    /// Maximum number of AI requests per minute (per app).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limit_per_minute: Option<u32>,
}

/// Agentic permissions — controls access to host-managed Sparo OS Agentic sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppAgentBackendBinding {
    pub id: String,
    pub agent_app_id: String,
    #[serde(default = "default_backend_role")]
    pub role: String,
    #[serde(default)]
    pub session_policy: LiveAppBackendSessionPolicy,
    #[serde(default)]
    pub memory_scope: LiveAppBackendMemoryScope,
    #[serde(default)]
    pub actions: Vec<LiveAppBackendActionBinding>,
}

fn default_backend_role() -> String {
    "primary".to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LiveAppBackendSessionPolicy {
    Ephemeral,
    Persistent,
    PerEntity,
    Shared,
}

impl Default for LiveAppBackendSessionPolicy {
    fn default() -> Self {
        Self::Persistent
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LiveAppBackendMemoryScope {
    None,
    AppInstance,
    Entity,
    AgentApp,
}

impl Default for LiveAppBackendMemoryScope {
    fn default() -> Self {
        Self::AppInstance
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppBackendActionBinding {
    pub name: String,
    #[serde(default)]
    pub input_schema: serde_json::Value,
    #[serde(default)]
    pub output_schema: serde_json::Value,
    #[serde(default)]
    pub allow_state_patch: bool,
}

/// AI context for iteration (stored in meta, not in compiled HTML).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LiveAppAiContext {
    pub original_prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub iteration_history: Vec<String>,
}

/// Runtime lifecycle state persisted in meta.json.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct LiveAppRuntimeState {
    /// Revision used for UI / source lifecycle changes.
    pub source_revision: String,
    /// Revision derived from npm dependencies.
    pub deps_revision: String,
    /// Dependencies changed and need install before reliable worker startup.
    pub deps_dirty: bool,
    /// Worker should be restarted on next runtime use.
    pub worker_restart_required: bool,
    /// UI assets should be recompiled before next render.
    pub ui_recompile_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppRuntimeIssue {
    pub app_id: String,
    pub severity: LiveAppRuntimeIssueSeverity,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub timestamp_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LiveAppRuntimeIssueSeverity {
    Fatal,
    Warning,
    Noise,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAppRuntimeLog {
    pub app_id: String,
    pub level: LiveAppRuntimeLogLevel,
    pub category: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
    pub timestamp_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LiveAppRuntimeLogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

/// Full Live App entity (in-memory / API).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveApp {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "LiveAppI18n::is_empty")]
    pub i18n: LiveAppI18n,
    pub version: u32,
    pub created_at: i64,
    pub updated_at: i64,

    pub source: LiveAppSource,
    /// Assembled HTML with Import Map + Runtime Adapter (generated by compiler).
    pub compiled_html: String,

    #[serde(default)]
    pub permissions: LiveAppPermissions,

    #[serde(default)]
    pub agent_backends: Vec<LiveAppAgentBackendBinding>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_context: Option<LiveAppAiContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_rationale: Option<String>,

    #[serde(default)]
    pub runtime: LiveAppRuntimeState,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LiveAppLocalizedMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LiveAppI18n {
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub locales: HashMap<String, LiveAppLocalizedMeta>,
}

impl LiveAppI18n {
    pub fn is_empty(&self) -> bool {
        self.locales.is_empty()
    }
}

/// Live App metadata only (for list views; no source/compiled_html).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveAppMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "LiveAppI18n::is_empty")]
    pub i18n: LiveAppI18n,
    pub version: u32,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub permissions: LiveAppPermissions,
    #[serde(default)]
    pub agent_backends: Vec<LiveAppAgentBackendBinding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_context: Option<LiveAppAiContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_rationale: Option<String>,
    #[serde(default)]
    pub runtime: LiveAppRuntimeState,
}

impl From<&LiveApp> for LiveAppMeta {
    fn from(app: &LiveApp) -> Self {
        Self {
            id: app.id.clone(),
            name: app.name.clone(),
            description: app.description.clone(),
            icon: app.icon.clone(),
            category: app.category.clone(),
            tags: app.tags.clone(),
            i18n: app.i18n.clone(),
            version: app.version,
            created_at: app.created_at,
            updated_at: app.updated_at,
            permissions: app.permissions.clone(),
            agent_backends: app.agent_backends.clone(),
            ai_context: app.ai_context.clone(),
            permission_rationale: app.permission_rationale.clone(),
            runtime: app.runtime.clone(),
        }
    }
}

/// Path scope for permission policy resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathScope {
    AppData,
    Workspace,
    UserSelected,
    Home,
    Custom(Vec<std::path::PathBuf>),
}

impl PathScope {
    pub fn from_manifest_value(s: &str) -> Self {
        match s {
            "{appdata}" => PathScope::AppData,
            "{workspace}" => PathScope::Workspace,
            "{user-selected}" => PathScope::UserSelected,
            "{home}" => PathScope::Home,
            _ => PathScope::Custom(vec![std::path::PathBuf::from(s)]),
        }
    }
}
