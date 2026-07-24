//! Automatically derived configuration catalog.

use crate::error::{CoreError, CoreResult};
use crate::service::config::secret_classification::ConfigSecretPath;
use crate::service::config::types::GlobalConfig;
use crate::service::speech::LOCAL_SENSEVOICE_SMALL_INT8_MODEL_REF;
use agentshell::shell::ShellDetector;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use sparo_events::{ConfigApplyStrategy, ConfigScopeKind, ConfigStoredValue, SettingsSectionRef};
use std::collections::{BTreeMap, BTreeSet};

pub const SETTING_APP_LANGUAGE: &str = "core.app.language";
pub const SETTING_APP_TRAY_HINT_SHOWN: &str = "core.app.tray.hide_to_tray_hint_shown";
pub const SETTING_AGENT_COMPANION_ENABLED: &str = "core.app.ai_experience.enable_agent_companion";
pub const SETTING_AI_MODELS: &str = "core.ai.models";
pub const SETTING_AI_AGENT_MODELS: &str = "core.ai.agent_models";
pub const SETTING_AI_FUNC_AGENT_MODELS: &str = "core.ai.func_agent_models";
pub const SETTING_AI_SUBAGENT_CONFIGS: &str = "core.ai.subagent_configs";
pub const SETTING_AI_AGENT_CAPABILITY_CONFIGS: &str = "core.ai.agent_capability_configs";
pub const SETTING_AI_SKIP_TOOL_CONFIRMATION: &str = "core.ai.skip_tool_confirmation";
pub const SETTING_AI_DEFAULT_PRIMARY: &str = "core.ai.default_models.primary";
pub const SETTING_AI_DEFAULT_FAST: &str = "core.ai.default_models.fast";
pub const SETTING_AI_DEFAULT_SPEECH_RECOGNITION: &str = "core.ai.default_models.speech_recognition";
pub const SETTING_MCP_SERVERS: &str = "core.mcp_servers";
pub const SETTING_DEBUG_INGEST_PORT: &str = "core.product_apps.bitfun_coder.debug.ingest_port";

pub(crate) const BUILTIN_THEME_OPTIONS: [(&str, &str); 7] = [
    ("system", "System"),
    ("light", "Light"),
    ("slate", "Slate"),
    ("dark", "Dark"),
    ("sparo-china-style", "Sparo China Style"),
    ("sparo-china-night", "Sparo China Night"),
    ("sparo-cyber", "Sparo Cyber"),
];

/// Risk assigned by trusted catalog metadata.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingRisk {
    Safe,
    Elevated,
    Destructive,
}

/// Sensitivity of a setting value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingSensitivity {
    Public,
    Private,
    Secret,
}

/// Whether a catalog setting may be written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingMutability {
    Writable,
    ReadOnly,
}

/// Generic renderer hint for a setting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingControl {
    Switch,
    Select,
    Number,
    Text,
    Path,
    List,
    Object,
    Custom,
}

/// Trusted dynamic option providers. Descriptors may select one of these
/// built-in providers, but callers can never supply a function or command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingOptionsProvider {
    EnabledAiModels,
    SpeechRecognitionTargets,
    AgentModelTargets,
    AvailableThemes,
    AvailableTerminalShells,
}

/// One currently valid dynamic value. Only non-sensitive display metadata is
/// published; provider paths and executable locations remain internal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingOptionDescriptor {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingStorageDescriptor {
    pub provider: String,
    pub path: String,
    pub scope: ConfigScopeKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingPresentationDescriptor {
    pub category_id: String,
    pub tab_id: String,
    pub section_id: String,
    pub field_id: String,
    pub title_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description_key: Option<String>,
    pub control: SettingControl,
    pub order: u32,
    #[serde(default)]
    pub hidden: bool,
}

impl SettingPresentationDescriptor {
    pub fn section_ref(&self) -> SettingsSectionRef {
        SettingsSectionRef {
            category_id: self.category_id.clone(),
            tab_id: self.tab_id.clone(),
            section_id: self.section_id.clone(),
            field_ids: vec![self.field_id.clone()],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingAiDescriptor {
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub readable: bool,
    pub writable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingPolicyDescriptor {
    pub risk: SettingRisk,
    pub sensitivity: SettingSensitivity,
    pub mutability: SettingMutability,
    pub apply_strategy: ConfigApplyStrategy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SettingDescriptorSource {
    Core,
    ProductApp { app_id: String, release_id: String },
    Runtime { provider_id: String },
}

/// Publication contract for a configuration descriptor.
///
/// Formal settings are stable product APIs with explicitly declared identity,
/// localized presentation, and ownership. Bindings are path-derived contracts
/// for trusted product UI: visible as advanced fallback in development builds
/// and excluded from release publication. Internal descriptors never cross the
/// Core boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingExposure {
    Formal,
    Binding,
    Internal,
}

impl SettingExposure {
    fn is_published_for_build(self, release_build: bool) -> bool {
        match self {
            Self::Formal => true,
            Self::Binding => !release_build,
            Self::Internal => false,
        }
    }

    fn is_formal(self) -> bool {
        self == Self::Formal
    }

    fn is_hidden_for_build(self, release_build: bool) -> bool {
        match self {
            Self::Formal => false,
            Self::Binding => release_build,
            Self::Internal => true,
        }
    }
}

/// One setting contract derived from the typed config and trusted metadata.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingDescriptor {
    pub id: String,
    pub storage: SettingStorageDescriptor,
    pub value_schema: Value,
    pub default_value: ConfigStoredValue,
    pub presentation: SettingPresentationDescriptor,
    pub ai: SettingAiDescriptor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options_provider: Option<SettingOptionsProvider>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resolved_options: Vec<SettingOptionDescriptor>,
    pub policy: SettingPolicyDescriptor,
    pub source: SettingDescriptorSource,
    pub exposure: SettingExposure,
    /// Controls generic product-surface writes without changing Core-owned
    /// transaction mutability. The public projection expresses this as policy.
    pub(crate) generic_surface_writable: bool,
}

/// Product-surface setting contract. Storage routing is intentionally absent.
/// Formal IDs are stable product identities; Binding IDs are trusted-UI handles
/// whose lifetime follows their typed config declaration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishedSettingDescriptor {
    pub id: String,
    pub exposure: SettingExposure,
    pub value_schema: Value,
    pub default_value: ConfigStoredValue,
    pub presentation: SettingPresentationDescriptor,
    pub ai: SettingAiDescriptor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options_provider: Option<SettingOptionsProvider>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resolved_options: Vec<SettingOptionDescriptor>,
    pub policy: SettingPolicyDescriptor,
    pub source: SettingDescriptorSource,
}

impl SettingDescriptor {
    pub fn published(&self) -> Option<PublishedSettingDescriptor> {
        self.published_for_build(!cfg!(debug_assertions))
    }

    fn published_for_build(&self, release_build: bool) -> Option<PublishedSettingDescriptor> {
        if !self.exposure.is_published_for_build(release_build) {
            return None;
        }
        let mut ai = self.ai.clone();
        ai.aliases.retain(|alias| alias != &self.storage.path);
        ai.tags.retain(|tag| tag != &self.storage.path);
        let mut policy = self.policy.clone();
        if !self.generic_surface_writable {
            policy.mutability = SettingMutability::ReadOnly;
        }
        Some(PublishedSettingDescriptor {
            id: self.id.clone(),
            exposure: self.exposure,
            value_schema: self.value_schema.clone(),
            default_value: self.default_value.clone(),
            presentation: self.presentation.clone(),
            ai,
            options_provider: self.options_provider,
            resolved_options: self.resolved_options.clone(),
            policy,
            source: self.source.clone(),
        })
    }
}

/// Versioned read-only catalog projection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigCatalog {
    pub version: String,
    pub settings: Vec<SettingDescriptor>,
}

/// Versioned Catalog projection safe to publish outside Core.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishedConfigCatalog {
    pub version: String,
    pub settings: Vec<PublishedSettingDescriptor>,
}

impl PublishedConfigCatalog {
    pub fn find(&self, setting_id: &str) -> Option<&PublishedSettingDescriptor> {
        self.settings
            .iter()
            .find(|setting| setting.id == setting_id)
    }
}

impl SettingOptionsProvider {
    pub(crate) fn resolve(self, config: &GlobalConfig) -> Vec<SettingOptionDescriptor> {
        match self {
            Self::EnabledAiModels => model_options(
                config
                    .ai
                    .models
                    .iter()
                    .filter(|model| model.enabled)
                    .map(|model| (model.id.as_str(), model.name.as_str())),
                false,
            ),
            Self::SpeechRecognitionTargets => speech_recognition_options(
                config
                    .ai
                    .models
                    .iter()
                    .filter(|model| model.enabled)
                    .map(|model| (model.id.as_str(), model.name.as_str())),
            ),
            Self::AgentModelTargets => model_options(
                config
                    .ai
                    .models
                    .iter()
                    .filter(|model| model.enabled)
                    .map(|model| (model.id.as_str(), model.name.as_str())),
                true,
            ),
            Self::AvailableThemes => theme_options(
                config
                    .themes
                    .custom
                    .as_deref()
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|theme| {
                        let id = theme.get("id")?.as_str()?;
                        let label = theme.get("name").and_then(Value::as_str).unwrap_or(id);
                        Some((id, label))
                    }),
            ),
            Self::AvailableTerminalShells => terminal_shell_options(),
        }
    }

    fn resolve_from_value(self, config: &Value) -> Vec<SettingOptionDescriptor> {
        match self {
            Self::EnabledAiModels | Self::SpeechRecognitionTargets | Self::AgentModelTargets => {
                let models = config
                    .pointer("/ai/models")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter(|model| model.get("enabled").and_then(Value::as_bool) == Some(true))
                    .filter_map(|model| {
                        let id = model.get("id")?.as_str()?;
                        let label = model.get("name").and_then(Value::as_str).unwrap_or(id);
                        Some((id, label))
                    });
                match self {
                    Self::SpeechRecognitionTargets => speech_recognition_options(models),
                    _ => model_options(models, self == Self::AgentModelTargets),
                }
            }
            Self::AvailableThemes => {
                let custom = config
                    .pointer("/themes/custom")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|theme| {
                        let id = theme.get("id")?.as_str()?;
                        let label = theme.get("name").and_then(Value::as_str).unwrap_or(id);
                        Some((id, label))
                    });
                theme_options(custom)
            }
            Self::AvailableTerminalShells => terminal_shell_options(),
        }
    }
}

fn model_options<'a>(
    models: impl IntoIterator<Item = (&'a str, &'a str)>,
    include_slot_aliases: bool,
) -> Vec<SettingOptionDescriptor> {
    let mut options = Vec::new();
    let mut values = BTreeSet::new();
    if include_slot_aliases {
        push_option(&mut options, &mut values, "primary", "Primary model");
        push_option(&mut options, &mut values, "fast", "Fast model");
    }
    for (id, label) in models {
        push_option(&mut options, &mut values, id, label);
    }
    options
}

fn speech_recognition_options<'a>(
    models: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> Vec<SettingOptionDescriptor> {
    let mut options = model_options(models, false);
    let mut values = options
        .iter()
        .map(|option| option.value.clone())
        .collect::<BTreeSet<_>>();
    push_option(
        &mut options,
        &mut values,
        LOCAL_SENSEVOICE_SMALL_INT8_MODEL_REF,
        "SenseVoice Small INT8 (Local)",
    );
    options
}

fn theme_options<'a>(
    custom: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> Vec<SettingOptionDescriptor> {
    let mut options = Vec::new();
    let mut values = BTreeSet::new();
    for (id, label) in BUILTIN_THEME_OPTIONS {
        push_option(&mut options, &mut values, id, label);
    }
    for (id, label) in custom {
        push_option(&mut options, &mut values, id, label);
    }
    options
}

fn terminal_shell_options() -> Vec<SettingOptionDescriptor> {
    let mut options = Vec::new();
    let mut values = BTreeSet::new();
    push_option(&mut options, &mut values, "", "Auto-detect");
    for shell in ShellDetector::detect_available_shells() {
        let Ok(Value::String(shell_type)) = serde_json::to_value(shell.shell_type) else {
            continue;
        };
        push_option(&mut options, &mut values, &shell_type, &shell.display_name);
    }
    options
}

fn push_option(
    options: &mut Vec<SettingOptionDescriptor>,
    values: &mut BTreeSet<String>,
    value: &str,
    label: &str,
) {
    if values.insert(value.to_string()) {
        let label = label.trim();
        options.push(SettingOptionDescriptor {
            value: value.to_string(),
            label: if label.is_empty() { value } else { label }.to_string(),
        });
    }
}

impl ConfigCatalog {
    pub fn build(default_config: &Value, current_config: &Value) -> CoreResult<Self> {
        let typed_schema = global_config_schema_index(default_config, current_config)?;
        let declared_paths = typed_schema.keys().cloned().collect::<BTreeSet<_>>();
        let mut current_paths = BTreeSet::new();
        collect_runtime_leaf_paths(current_config, "", &declared_paths, &mut current_paths);
        let paths = declared_paths
            .union(&current_paths)
            .cloned()
            .collect::<BTreeSet<_>>();

        let mut settings = Vec::with_capacity(paths.len());
        let mut setting_ids = BTreeSet::new();
        let typed_current = serde_json::from_value::<GlobalConfig>(current_config.clone()).ok();
        for path in paths {
            if path.is_empty()
                || path.starts_with('_')
                || matches!(path.as_str(), "version" | "last_modified")
            {
                continue;
            }
            let default_value = get_value_at_path(default_config, &path).unwrap_or(Value::Null);
            let current_value = get_value_at_path(current_config, &path).unwrap_or(Value::Null);
            let metadata = metadata_for(&path);
            validate_formal_published_metadata(&path, &metadata)?;
            let mut descriptor = build_descriptor(
                &path,
                &default_value,
                &current_value,
                declared_paths.contains(&path),
                typed_schema.get(&path),
                metadata,
            );
            if let Some(provider) = descriptor.options_provider {
                descriptor.resolved_options = typed_current
                    .as_ref()
                    .map(|config| provider.resolve(config))
                    .unwrap_or_else(|| provider.resolve_from_value(current_config));
            }
            if !setting_ids.insert(descriptor.id.clone()) {
                return Err(CoreError::config(format!(
                    "Duplicate config setting identity '{}'",
                    descriptor.id
                )));
            }
            settings.push(descriptor);
        }
        settings.sort_by(|left, right| left.id.cmp(&right.id));

        let catalog_bytes = serde_json::to_vec(&settings).map_err(|error| {
            CoreError::config(format!("Failed to serialize config catalog: {error}"))
        })?;
        let version = format!("sha256:{:x}", Sha256::digest(catalog_bytes));
        Ok(Self { version, settings })
    }

    pub fn find(&self, setting_id: &str) -> Option<&SettingDescriptor> {
        self.settings
            .iter()
            .find(|setting| setting.id == setting_id)
    }

    #[cfg(test)]
    pub(crate) fn find_by_path(&self, path: &str) -> Option<&SettingDescriptor> {
        self.settings
            .iter()
            .find(|setting| setting.storage.path == path)
    }

    /// Builds the only Catalog shape allowed across a product-surface boundary.
    /// Private/internal descriptors and storage routing never leave Core, and
    /// external search cannot use a storage path as an accidental identifier.
    pub fn published(&self, query: Option<&str>) -> PublishedConfigCatalog {
        self.published_for_build(query, !cfg!(debug_assertions))
    }

    fn published_for_build(
        &self,
        query: Option<&str>,
        release_build: bool,
    ) -> PublishedConfigCatalog {
        let query = query
            .map(str::trim)
            .filter(|query| !query.is_empty())
            .map(str::to_lowercase);
        let mut ranked_settings = self
            .settings
            .iter()
            .enumerate()
            .filter_map(|(index, setting)| {
                let score = query
                    .as_deref()
                    .map(|query| setting_search_score(setting, query))
                    .unwrap_or_default();
                (query.is_none() || score > 0).then_some((score, index, setting))
            })
            .collect::<Vec<_>>();
        if query.is_some() {
            ranked_settings
                .sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
        }
        let settings = ranked_settings
            .into_iter()
            .filter_map(|(_, _, setting)| setting.published_for_build(release_build))
            .collect();
        PublishedConfigCatalog {
            version: self.version.clone(),
            settings,
        }
    }

    pub fn snapshot_values(&self, config: &Value) -> BTreeMap<String, ConfigStoredValue> {
        self.settings
            .iter()
            .map(|descriptor| {
                let value =
                    get_value_at_path(config, &descriptor.storage.path).unwrap_or(Value::Null);
                (descriptor.id.clone(), redact_value(descriptor, value))
            })
            .collect()
    }

    /// Redacted snapshot projection safe for product-surface clients. Internal
    /// descriptors remain available to Core and never cross this boundary.
    pub fn published_snapshot_values(&self, config: &Value) -> BTreeMap<String, ConfigStoredValue> {
        self.published_snapshot_values_for_build(config, !cfg!(debug_assertions))
    }

    fn published_snapshot_values_for_build(
        &self,
        config: &Value,
        release_build: bool,
    ) -> BTreeMap<String, ConfigStoredValue> {
        self.settings
            .iter()
            .filter(|descriptor| descriptor.exposure.is_published_for_build(release_build))
            .map(|descriptor| {
                let value =
                    get_value_at_path(config, &descriptor.storage.path).unwrap_or(Value::Null);
                (descriptor.id.clone(), redact_value(descriptor, value))
            })
            .collect()
    }
}

/// Scores natural-language catalog queries without exposing or searching by
/// private storage routes. A query may contain several hints (including mixed
/// languages); matching more hints ranks a setting higher, while one useful
/// hint is enough to keep discovery recall high.
fn setting_search_score(setting: &SettingDescriptor, query: &str) -> u32 {
    let searchable = std::iter::once((setting.id.as_str(), 12_u32))
        .chain(std::iter::once((
            setting.presentation.title_key.as_str(),
            8,
        )))
        .chain(
            setting
                .presentation
                .description_key
                .as_deref()
                .into_iter()
                .map(|description| (description, 6)),
        )
        .chain(
            setting
                .ai
                .aliases
                .iter()
                .chain(setting.ai.tags.iter())
                .filter(|candidate| candidate.as_str() != setting.storage.path)
                .map(|candidate| (candidate.as_str(), 10)),
        )
        .map(|(candidate, weight)| (candidate.to_lowercase(), weight))
        .collect::<Vec<_>>();

    let exact_phrase_score = searchable
        .iter()
        .filter(|(candidate, _)| candidate.contains(query))
        .map(|(_, weight)| *weight)
        .max()
        .unwrap_or_default()
        * 100;
    let term_score = query
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .filter_map(|term| {
            searchable
                .iter()
                .filter(|(candidate, _)| candidate.contains(term))
                .map(|(_, weight)| *weight)
                .max()
        })
        .map(|weight| 100 + weight)
        .sum::<u32>();

    exact_phrase_score + term_score
}

pub(crate) fn redact_value(descriptor: &SettingDescriptor, value: Value) -> ConfigStoredValue {
    if descriptor.policy.sensitivity == SettingSensitivity::Secret {
        ConfigStoredValue::secret(is_configured(&value))
    } else {
        ConfigStoredValue::public(redact_nested_secrets(
            value,
            &ConfigSecretPath::from_storage_path(&descriptor.storage.path),
        ))
    }
}

/// Resolves write-only secret placeholders against the current raw value.
/// Public structure remains replaceable, while a missing secret key or a
/// redacted `{ configured }` marker preserves the existing secret. Arrays use
/// stable object ids when available so reordering cannot attach one model's
/// credential to another model.
pub(crate) fn resolve_config_write_value(
    descriptor: &SettingDescriptor,
    current: &Value,
    proposed: &Value,
) -> CoreResult<Value> {
    if descriptor.policy.sensitivity == SettingSensitivity::Secret {
        return resolve_secret_value(Some(current), proposed);
    }
    resolve_nested_secret_values(
        Some(current),
        proposed,
        &ConfigSecretPath::from_storage_path(&descriptor.storage.path),
    )
}

fn resolve_nested_secret_values(
    current: Option<&Value>,
    proposed: &Value,
    path: &ConfigSecretPath,
) -> CoreResult<Value> {
    match proposed {
        Value::Object(proposed_object) => {
            let current_object = current.and_then(Value::as_object);
            let mut resolved = Map::new();
            for (key, proposed_value) in proposed_object {
                let current_value = current_object.and_then(|object| object.get(key));
                let child_path = path.child(key);
                let value = if child_path.is_sensitive() {
                    resolve_secret_value(current_value, proposed_value)?
                } else {
                    resolve_nested_secret_values(current_value, proposed_value, &child_path)?
                };
                resolved.insert(key.clone(), value);
            }
            if let Some(current_object) = current_object {
                for (key, current_value) in current_object {
                    if path.child(key).is_sensitive() && !proposed_object.contains_key(key) {
                        resolved.insert(key.clone(), current_value.clone());
                    }
                }
            }
            Ok(Value::Object(resolved))
        }
        Value::Array(proposed_items) => {
            let current_items = current.and_then(Value::as_array);
            proposed_items
                .iter()
                .enumerate()
                .map(|(index, proposed_item)| {
                    let current_item = current_items.and_then(|items| {
                        if let Some(id) = stable_object_id(proposed_item) {
                            items.iter().find(|item| stable_object_id(item) == Some(id))
                        } else {
                            items.get(index)
                        }
                    });
                    resolve_nested_secret_values(current_item, proposed_item, path)
                })
                .collect::<CoreResult<Vec<_>>>()
                .map(Value::Array)
        }
        _ => Ok(proposed.clone()),
    }
}

fn resolve_secret_value(current: Option<&Value>, proposed: &Value) -> CoreResult<Value> {
    if is_redacted_secret_marker(proposed) {
        return match current {
            Some(current) => Ok(current.clone()),
            None if proposed.get("configured") == Some(&Value::Bool(false)) => {
                Ok(Value::String(String::new()))
            }
            None => Err(CoreError::validation(
                "Cannot preserve a configured secret that does not exist",
            )),
        };
    }
    // `null` is a legitimate typed value for nullable credential containers
    // such as model custom headers. Clearing a non-null secret uses the
    // explicit `{ "clear": true }` marker so value shape is never guessed
    // from the previous value.
    if proposed.is_null() {
        return Ok(Value::Null);
    }
    if is_clear_secret_marker(proposed) {
        return Ok(empty_secret_value(current));
    }
    Ok(proposed.clone())
}

fn stable_object_id(value: &Value) -> Option<&str> {
    value.get("id").and_then(Value::as_str)
}

fn is_redacted_secret_marker(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.get("configured").is_some_and(Value::is_boolean)
        && object
            .keys()
            .all(|key| matches!(key.as_str(), "configured" | "provider" | "maskedSuffix"))
}

fn is_clear_secret_marker(value: &Value) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.len() == 1 && object.get("clear") == Some(&Value::Bool(true)))
}

fn empty_secret_value(current: Option<&Value>) -> Value {
    match current {
        Some(Value::Array(_)) => Value::Array(Vec::new()),
        Some(Value::Object(_)) => Value::Object(Map::new()),
        Some(Value::Bool(_)) => Value::Bool(false),
        Some(Value::Number(_)) => Value::Null,
        _ => Value::String(String::new()),
    }
}

pub(crate) fn get_value_at_path(root: &Value, path: &str) -> Option<Value> {
    if path.is_empty() {
        return Some(root.clone());
    }
    let mut current = root;
    for key in path.split('.').filter(|key| !key.is_empty()) {
        current = current.get(key)?;
    }
    Some(current.clone())
}

pub(crate) fn set_value_at_path(root: &mut Value, path: &str, value: Value) -> CoreResult<()> {
    if path.is_empty() {
        *root = value;
        return Ok(());
    }
    let keys: Vec<&str> = path.split('.').filter(|key| !key.is_empty()).collect();
    let (last, parents) = keys
        .split_last()
        .ok_or_else(|| CoreError::config("Configuration path is empty"))?;
    let mut current = root;
    for key in parents {
        current = current
            .get_mut(*key)
            .ok_or_else(|| CoreError::config(format!("Config path '{path}' does not exist")))?;
    }
    let object = current.as_object_mut().ok_or_else(|| {
        CoreError::config(format!("Config path '{path}' has a non-object parent"))
    })?;
    object.insert((*last).to_string(), value);
    Ok(())
}

fn collect_runtime_leaf_paths(
    value: &Value,
    prefix: &str,
    declared_paths: &BTreeSet<String>,
    paths: &mut BTreeSet<String>,
) {
    if !prefix.is_empty() && declared_paths.contains(prefix) {
        paths.insert(prefix.to_string());
        return;
    }
    match value {
        Value::Object(object) if !object.is_empty() => {
            for (key, child) in object {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                collect_runtime_leaf_paths(child, &path, declared_paths, paths);
            }
        }
        _ => {
            paths.insert(prefix.to_string());
        }
    }
}

fn global_config_schema_index(
    default_config: &Value,
    current_config: &Value,
) -> CoreResult<BTreeMap<String, Value>> {
    let mut root = serde_json::to_value(schemars::schema_for!(GlobalConfig)).map_err(|error| {
        CoreError::config(format!("Failed to generate typed config schema: {error}"))
    })?;
    strictify_config_write_schema(&mut root, None);
    let mut index = BTreeMap::new();
    collect_typed_schema_paths(
        &root,
        &root,
        "",
        Some(default_config),
        Some(current_config),
        &mut index,
    )?;
    Ok(index)
}

/// Keeps Catalog-backed writes strict even though disk deserialization is
/// intentionally tolerant of additive and subtractive field changes.
///
/// `schemars` mirrors the tolerant Serde contract, which makes fields optional
/// and no longer marks ordinary objects as closed. Restore the pre-existing API
/// contract here: non-null fields are required and typed objects reject
/// undeclared fields. The small exemption list contains fields that were
/// already explicitly optional through field-level `serde(default)`.
fn strictify_config_write_schema(schema: &mut Value, definition: Option<&str>) {
    let Some(object) = schema.as_object_mut() else {
        return;
    };

    if let Some(required) = object
        .get("properties")
        .and_then(Value::as_object)
        .map(|properties| {
            properties
                .iter()
                .filter_map(|(name, property_schema)| {
                    (!schema_allows_null(property_schema)
                        && !config_write_field_may_be_omitted(definition, name))
                    .then(|| Value::String(name.clone()))
                })
                .collect::<Vec<_>>()
        })
    {
        if required.is_empty() {
            object.remove("required");
        } else {
            object.insert("required".to_string(), Value::Array(required));
        }
        object
            .entry("additionalProperties".to_string())
            .or_insert(Value::Bool(false));

        let properties = object
            .get_mut("properties")
            .and_then(Value::as_object_mut)
            .expect("properties remain an object");
        for (name, property_schema) in properties {
            if !config_write_field_may_be_omitted(definition, name) {
                if let Some(property) = property_schema.as_object_mut() {
                    property.remove("default");
                }
            }
            strictify_config_write_schema(property_schema, definition);
        }
    }

    for definitions_key in ["definitions", "$defs"] {
        if let Some(definitions) = object
            .get_mut(definitions_key)
            .and_then(Value::as_object_mut)
        {
            for (name, definition_schema) in definitions {
                strictify_config_write_schema(definition_schema, Some(name));
            }
        }
    }
    for key in ["items", "additionalProperties"] {
        if let Some(child) = object.get_mut(key).filter(|value| value.is_object()) {
            strictify_config_write_schema(child, definition);
        }
    }
    for key in ["allOf", "anyOf", "oneOf"] {
        if let Some(branches) = object.get_mut(key).and_then(Value::as_array_mut) {
            for branch in branches {
                strictify_config_write_schema(branch, definition);
            }
        }
    }
}

fn config_write_field_may_be_omitted(definition: Option<&str>, field: &str) -> bool {
    match definition {
        Some("AppTrayConfig") => field == "hide_to_tray_hint_shown",
        Some("AgentCapabilityConfig") | Some("AgentCapabilityConfigView") => matches!(
            field,
            "added_tools"
                | "removed_tools"
                | "disabled_user_skills"
                | "enabled_user_skills"
                | "disabled_user_skill_suites"
                | "enabled_user_skill_suites"
                | "disabled_subagents"
                | "enabled_subagents"
        ),
        _ => false,
    }
}

fn schema_allows_null(schema: &Value) -> bool {
    if schema_is_null(schema)
        || schema.get("default").is_some_and(Value::is_null)
        || schema
            .get("type")
            .and_then(Value::as_array)
            .is_some_and(|types| types.iter().any(|value| value.as_str() == Some("null")))
    {
        return true;
    }
    ["anyOf", "oneOf"]
        .into_iter()
        .filter_map(|key| schema.get(key).and_then(Value::as_array))
        .flatten()
        .any(schema_is_null)
}

fn collect_typed_schema_paths(
    schema: &Value,
    root: &Value,
    prefix: &str,
    default_value: Option<&Value>,
    current_value: Option<&Value>,
    index: &mut BTreeMap<String, Value>,
) -> CoreResult<()> {
    let normalized = normalize_typed_schema(schema, root)?;
    if !prefix.is_empty() && metadata_for(prefix).atomic_object {
        index.insert(prefix.to_string(), normalized);
        return Ok(());
    }
    let properties = normalized.get("properties").and_then(Value::as_object);
    if let Some(properties) = properties.filter(|properties| !properties.is_empty()) {
        for (name, property_schema) in properties {
            let path = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}.{name}")
            };
            collect_typed_schema_paths(
                property_schema,
                root,
                &path,
                default_value.and_then(|value| value.get(name)),
                current_value.and_then(|value| value.get(name)),
                index,
            )?;
        }
    } else if prefix == "product_apps.apps" {
        let additional_schema = normalized
            .get("additionalProperties")
            .filter(|value| value.is_object())
            .ok_or_else(|| {
                CoreError::config("Product App config map is missing its typed value schema")
            })?;
        let keys = default_value
            .and_then(Value::as_object)
            .into_iter()
            .flat_map(|object| object.keys())
            .chain(
                current_value
                    .and_then(Value::as_object)
                    .into_iter()
                    .flat_map(|object| object.keys()),
            )
            .cloned()
            .collect::<BTreeSet<_>>();
        for key in keys {
            collect_typed_schema_paths(
                additional_schema,
                root,
                &format!("{prefix}.{key}"),
                default_value.and_then(|value| value.get(&key)),
                current_value.and_then(|value| value.get(&key)),
                index,
            )?;
        }
    } else if !prefix.is_empty() {
        index.insert(prefix.to_string(), normalized);
    }
    Ok(())
}

fn normalize_typed_schema(schema: &Value, root: &Value) -> CoreResult<Value> {
    let resolved = resolve_schema_reference(schema, root)?;
    let mut normalized = resolved.clone();
    if schema.get("$ref").is_some() {
        overlay_reference_annotations(schema, &mut normalized);
    }

    for composition_key in ["anyOf", "oneOf"] {
        let Some(branches) = normalized
            .get(composition_key)
            .and_then(Value::as_array)
            .cloned()
        else {
            continue;
        };
        let mut non_null = branches
            .iter()
            .filter(|branch| !schema_is_null(branch))
            .collect::<Vec<_>>();
        if branches.len() == non_null.len() + 1 && non_null.len() == 1 {
            normalized = normalize_typed_schema(non_null.remove(0), root)?;
            if let Some(object) = normalized.as_object_mut() {
                object.insert("nullable".to_string(), Value::Bool(true));
            }
            break;
        }
    }

    if let Some(types) = normalized.get("type").and_then(Value::as_array).cloned() {
        let non_null = types
            .iter()
            .filter(|value| value.as_str() != Some("null"))
            .cloned()
            .collect::<Vec<_>>();
        if types.len() == non_null.len() + 1 && non_null.len() == 1 {
            if let Some(object) = normalized.as_object_mut() {
                object.insert("type".to_string(), non_null[0].clone());
                object.insert("nullable".to_string(), Value::Bool(true));
            }
        }
    }

    if let Some(properties) = normalized
        .get("properties")
        .and_then(Value::as_object)
        .cloned()
    {
        let mut expanded = Map::new();
        for (name, property_schema) in properties {
            expanded.insert(name, normalize_typed_schema(&property_schema, root)?);
        }
        normalized
            .as_object_mut()
            .expect("JSON schema is an object")
            .insert("properties".to_string(), Value::Object(expanded));
    }
    for key in ["items", "additionalProperties"] {
        let Some(child_schema) = normalized
            .get(key)
            .filter(|value| value.is_object())
            .cloned()
        else {
            continue;
        };
        let expanded = normalize_typed_schema(&child_schema, root)?;
        normalized
            .as_object_mut()
            .expect("JSON schema is an object")
            .insert(key.to_string(), expanded);
    }
    for key in ["allOf", "anyOf", "oneOf"] {
        let Some(branches) = normalized.get(key).and_then(Value::as_array).cloned() else {
            continue;
        };
        let expanded = branches
            .iter()
            .map(|branch| normalize_typed_schema(branch, root))
            .collect::<CoreResult<Vec<_>>>()?;
        normalized
            .as_object_mut()
            .expect("JSON schema is an object")
            .insert(key.to_string(), Value::Array(expanded));
    }
    collapse_const_enum(&mut normalized);
    Ok(normalized)
}

fn overlay_reference_annotations(reference: &Value, resolved: &mut Value) {
    let Some(resolved) = resolved.as_object_mut() else {
        return;
    };
    for key in [
        "title",
        "description",
        "default",
        "examples",
        "deprecated",
        "readOnly",
        "writeOnly",
        "$comment",
    ] {
        if let Some(value) = reference.get(key) {
            resolved.insert(key.to_string(), value.clone());
        }
    }
}

fn collapse_const_enum(schema: &mut Value) {
    let Some(branches) = schema.get("oneOf").and_then(Value::as_array) else {
        return;
    };
    if branches.is_empty() {
        return;
    }

    let mut variants = Vec::with_capacity(branches.len());
    let mut variant_type = None::<String>;
    for branch in branches {
        let Some(object) = branch.as_object() else {
            return;
        };
        if object.keys().any(|key| {
            !matches!(
                key.as_str(),
                "const"
                    | "type"
                    | "title"
                    | "description"
                    | "deprecated"
                    | "examples"
                    | "readOnly"
                    | "writeOnly"
                    | "$comment"
            )
        }) {
            return;
        }
        let Some(value) = object.get("const") else {
            return;
        };
        let Some(current_type) = object.get("type").and_then(Value::as_str) else {
            return;
        };
        if variant_type
            .as_deref()
            .is_some_and(|expected| expected != current_type)
        {
            return;
        }
        variant_type = Some(current_type.to_string());
        if variants.contains(value) {
            return;
        }
        variants.push(value.clone());
    }

    let object = schema.as_object_mut().expect("JSON schema is an object");
    object.remove("oneOf");
    object.insert(
        "type".to_string(),
        Value::String(variant_type.expect("enum type")),
    );
    object.insert("enum".to_string(), Value::Array(variants));
}

fn resolve_schema_reference<'a>(schema: &'a Value, root: &'a Value) -> CoreResult<&'a Value> {
    let Some(reference) = schema.get("$ref").and_then(Value::as_str) else {
        return Ok(schema);
    };
    let pointer = reference.strip_prefix('#').ok_or_else(|| {
        CoreError::config(format!(
            "External config schema reference is unsupported: {reference}"
        ))
    })?;
    root.pointer(pointer).ok_or_else(|| {
        CoreError::config(format!(
            "Config schema reference does not exist: {reference}"
        ))
    })
}

fn schema_is_null(schema: &Value) -> bool {
    schema.get("type").and_then(Value::as_str) == Some("null")
}

fn build_descriptor(
    path: &str,
    default_value: &Value,
    current_value: &Value,
    declared: bool,
    typed_schema: Option<&Value>,
    metadata: CatalogMetadata,
) -> SettingDescriptor {
    let exposure = metadata.exposure.unwrap_or(if declared {
        SettingExposure::Binding
    } else {
        SettingExposure::Internal
    });
    let source = match (metadata.source.clone(), exposure) {
        (Some(source), _) => source,
        (None, SettingExposure::Formal) => {
            unreachable!("formal setting source is validated before descriptor construction")
        }
        (None, SettingExposure::Binding) => SettingDescriptorSource::Runtime {
            provider_id: "global-config-binding".to_string(),
        },
        (None, SettingExposure::Internal) => SettingDescriptorSource::Runtime {
            provider_id: "global-config-runtime".to_string(),
        },
    };
    let direct_secret = path_is_secret(path);
    let nested_secret = !direct_secret
        && (typed_schema.is_some_and(|schema| schema_contains_secret_field(path, schema))
            || contains_secret_field(path, default_value)
            || contains_secret_field(path, current_value));
    let read_only = matches!(path, "version" | "last_modified") || metadata.read_only;
    let sensitivity = if direct_secret {
        SettingSensitivity::Secret
    } else if nested_secret {
        SettingSensitivity::Private
    } else {
        metadata.sensitivity
    };
    let risk = if direct_secret || nested_secret {
        SettingRisk::Elevated
    } else {
        metadata.risk
    };
    let apply_strategy = if direct_secret && metadata.apply_strategy != ConfigApplyStrategy::Adapter
    {
        ConfigApplyStrategy::ManualOnly
    } else {
        metadata.apply_strategy
    };
    let mutability = if read_only {
        SettingMutability::ReadOnly
    } else {
        SettingMutability::Writable
    };
    let value_schema = metadata
        .value_schema
        .clone()
        .or_else(|| typed_schema.cloned())
        .unwrap_or_else(|| schema_for(preferred_value(default_value, current_value)));
    let id = setting_id(path, &metadata, declared);
    let hidden_by_policy = exposure.is_hidden_for_build(!cfg!(debug_assertions));
    let ai_exposed = exposure.is_formal() && metadata.user_facing;
    let scalar = is_scalar_schema(&value_schema);
    let projection_group = id
        .strip_prefix("core.")
        .and_then(|stable_id| stable_id.split('.').next())
        .map(normalize_identifier)
        .filter(|group| !group.is_empty())
        .unwrap_or_else(|| "advanced".to_string());
    let field_name = path.rsplit('.').next().unwrap_or(path);
    let field_id = normalize_identifier(field_name);
    let mut presentation = metadata
        .presentation
        .unwrap_or_else(|| SettingPresentationDescriptor {
            category_id: "advanced".to_string(),
            tab_id: projection_group.clone(),
            section_id: format!("advanced-{projection_group}"),
            field_id: if field_id.is_empty() {
                short_hash(path)
            } else {
                field_id
            },
            title_key: format!("settings/config-center:generated.{id}.title"),
            description_key: None,
            control: control_for(default_value, current_value, &value_schema),
            order: 10_000,
            hidden: hidden_by_policy,
        });
    presentation.hidden = presentation.hidden || hidden_by_policy;
    if metadata.options_provider.is_some() && scalar {
        presentation.control = SettingControl::Select;
    }
    let aliases = metadata
        .aliases
        .iter()
        .map(|alias| (*alias).to_string())
        .chain([field_name.replace('_', " ")])
        .collect();
    let default_value = if sensitivity == SettingSensitivity::Secret {
        ConfigStoredValue::secret(is_configured(default_value))
    } else {
        ConfigStoredValue::public(redact_nested_secrets(
            default_value.clone(),
            &ConfigSecretPath::from_storage_path(path),
        ))
    };

    SettingDescriptor {
        id,
        storage: SettingStorageDescriptor {
            provider: "global-config".to_string(),
            path: path.to_string(),
            scope: ConfigScopeKind::User,
        },
        value_schema,
        default_value,
        presentation,
        ai: SettingAiDescriptor {
            aliases,
            tags: vec![projection_group],
            readable: ai_exposed,
            writable: ai_exposed
                && !read_only
                && sensitivity != SettingSensitivity::Secret
                && !nested_secret
                && scalar,
        },
        options_provider: metadata.options_provider,
        resolved_options: Vec::new(),
        policy: SettingPolicyDescriptor {
            risk,
            sensitivity,
            mutability,
            apply_strategy,
        },
        source,
        exposure,
        generic_surface_writable: metadata.generic_surface_writable,
    }
}

fn preferred_value<'a>(default: &'a Value, current: &'a Value) -> &'a Value {
    if default.is_null() {
        current
    } else {
        default
    }
}

#[derive(Clone, Copy)]
enum StableValueSchema {
    Derived,
    StringEnum(&'static [&'static str]),
    NullableInteger { minimum: u64, maximum: Option<u64> },
    NullableObject,
}

impl StableValueSchema {
    fn materialize(self) -> Option<Value> {
        match self {
            Self::Derived => None,
            Self::StringEnum(values) => Some(serde_json::json!({
                "type": "string",
                "enum": values,
            })),
            Self::NullableInteger { minimum, maximum } => {
                let mut schema = serde_json::json!({
                    "type": "integer",
                    "nullable": true,
                    "minimum": minimum,
                });
                if let Some(maximum) = maximum {
                    schema
                        .as_object_mut()
                        .expect("integer schema is an object")
                        .insert("maximum".to_string(), Value::from(maximum));
                }
                Some(schema)
            }
            Self::NullableObject => Some(serde_json::json!({
                "type": "object",
                "nullable": true,
                "properties": {},
            })),
        }
    }
}

#[derive(Clone, Copy)]
struct UserFacingPresentationDeclaration {
    category_id: &'static str,
    tab_id: &'static str,
    section_id: &'static str,
    field_id: &'static str,
    title_key: &'static str,
    description_key: &'static str,
    control: SettingControl,
}

#[derive(Clone, Copy)]
struct StableSettingDeclaration {
    storage_path: &'static str,
    stable_product_id: &'static str,
    exposure: SettingExposure,
    generic_surface_writable: bool,
    aliases: &'static [&'static str],
    risk: SettingRisk,
    sensitivity: SettingSensitivity,
    apply_strategy: ConfigApplyStrategy,
    read_only: bool,
    options_provider: Option<SettingOptionsProvider>,
    atomic_object: bool,
    value_schema: StableValueSchema,
    presentation: Option<UserFacingPresentationDeclaration>,
}

impl StableSettingDeclaration {
    fn metadata(self) -> CatalogMetadata {
        let user_facing = self.presentation.is_some();
        let presentation = self
            .presentation
            .map(|presentation| SettingPresentationDescriptor {
                category_id: presentation.category_id.to_string(),
                tab_id: presentation.tab_id.to_string(),
                section_id: presentation.section_id.to_string(),
                field_id: presentation.field_id.to_string(),
                title_key: presentation.title_key.to_string(),
                description_key: Some(presentation.description_key.to_string()),
                control: presentation.control,
                order: 100,
                hidden: false,
            });
        let presentation = presentation.or_else(|| {
            Some(SettingPresentationDescriptor {
                category_id: "internal".to_string(),
                tab_id: "internal".to_string(),
                section_id: "product-contract".to_string(),
                field_id: self
                    .stable_product_id
                    .rsplit('.')
                    .next()
                    .unwrap_or(self.stable_product_id)
                    .to_string(),
                title_key: format!(
                    "settings/config-center:internal.{}.title",
                    self.stable_product_id
                ),
                description_key: None,
                control: SettingControl::Custom,
                order: 10_000,
                hidden: true,
            })
        });
        CatalogMetadata {
            stable_product_id: Some(self.stable_product_id),
            exposure: Some(self.exposure),
            generic_surface_writable: self.generic_surface_writable,
            source: Some(SettingDescriptorSource::Core),
            aliases: self.aliases,
            risk: self.risk,
            sensitivity: self.sensitivity,
            apply_strategy: self.apply_strategy,
            read_only: self.read_only,
            options_provider: self.options_provider,
            atomic_object: self.atomic_object,
            value_schema: self.value_schema.materialize(),
            presentation,
            user_facing,
        }
    }
}

macro_rules! setting_value_or {
    ($default:expr) => {
        $default
    };
    ($default:expr, $value:expr) => {
        $value
    };
}

macro_rules! setting_option {
    () => {
        None
    };
    ($value:expr) => {
        Some($value)
    };
}

macro_rules! public_setting {
    (
        $path:literal => $id:expr,
        ($category:literal, $tab:literal, $section:literal, $field:literal),
        ($title:literal, $description:literal),
        $control:expr,
        [$($alias:expr),* $(,)?]
        $(, risk = $risk:expr)?
        $(, sensitivity = $sensitivity:expr)?
        $(, apply = $apply:expr)?
        $(, options = $options:expr)?
        $(, schema = $schema:expr)?
        $(, atomic = $atomic:expr)?
        $(, generic_surface_writable = $generic_surface_writable:expr)?
        $(,)?
    ) => {
        StableSettingDeclaration {
            storage_path: $path,
            stable_product_id: $id,
            exposure: SettingExposure::Formal,
            generic_surface_writable: setting_value_or!(true $(, $generic_surface_writable)?),
            aliases: &[$($alias),*],
            risk: setting_value_or!(SettingRisk::Safe $(, $risk)?),
            sensitivity: setting_value_or!(SettingSensitivity::Public $(, $sensitivity)?),
            apply_strategy: setting_value_or!(ConfigApplyStrategy::Reactive $(, $apply)?),
            read_only: false,
            options_provider: setting_option!($($options)?),
            atomic_object: setting_value_or!(false $(, $atomic)?),
            value_schema: setting_value_or!(StableValueSchema::Derived $(, $schema)?),
            presentation: Some(UserFacingPresentationDeclaration {
                category_id: $category,
                tab_id: $tab,
                section_id: $section,
                field_id: $field,
                title_key: $title,
                description_key: $description,
                control: $control,
            }),
        }
    };
}

macro_rules! hidden_setting {
    (
        $path:literal => $id:expr
        $(, risk = $risk:expr)?
        $(, sensitivity = $sensitivity:expr)?
        $(, apply = $apply:expr)?
        $(, options = $options:expr)?
        $(, schema = $schema:expr)?
        $(, atomic = $atomic:expr)?
        $(, generic_surface_writable = $generic_surface_writable:expr)?
        $(,)?
    ) => {
        StableSettingDeclaration {
            storage_path: $path,
            stable_product_id: $id,
            exposure: SettingExposure::Formal,
            generic_surface_writable: setting_value_or!(true $(, $generic_surface_writable)?),
            aliases: &[],
            risk: setting_value_or!(SettingRisk::Safe $(, $risk)?),
            sensitivity: setting_value_or!(SettingSensitivity::Public $(, $sensitivity)?),
            apply_strategy: setting_value_or!(ConfigApplyStrategy::Reactive $(, $apply)?),
            read_only: false,
            options_provider: setting_option!($($options)?),
            atomic_object: setting_value_or!(false $(, $atomic)?),
            value_schema: setting_value_or!(StableValueSchema::Derived $(, $schema)?),
            presentation: None,
        }
    };
}

macro_rules! internal_setting {
    (
        $path:literal => $id:expr
        $(, risk = $risk:expr)?
        $(, sensitivity = $sensitivity:expr)?
        $(, apply = $apply:expr)?
        $(, options = $options:expr)?
        $(, schema = $schema:expr)?
        $(, atomic = $atomic:expr)?
        $(, generic_surface_writable = $generic_surface_writable:expr)?
        $(,)?
    ) => {
        StableSettingDeclaration {
            storage_path: $path,
            stable_product_id: $id,
            exposure: SettingExposure::Internal,
            generic_surface_writable: setting_value_or!(true $(, $generic_surface_writable)?),
            aliases: &[],
            risk: setting_value_or!(SettingRisk::Safe $(, $risk)?),
            sensitivity: setting_value_or!(SettingSensitivity::Public $(, $sensitivity)?),
            apply_strategy: setting_value_or!(ConfigApplyStrategy::Reactive $(, $apply)?),
            read_only: false,
            options_provider: setting_option!($($options)?),
            atomic_object: setting_value_or!(false $(, $atomic)?),
            value_schema: setting_value_or!(StableValueSchema::Derived $(, $schema)?),
            presentation: None,
        }
    };
}

/// The single declaration source for every stable setting ID.
///
/// User-facing declarations drive manual settings, CLI discovery, SettingsAgent
/// discovery, policy, apply routing and locale validation. Hidden declarations
/// are stable Web UI protocol contracts. Internal declarations are stable
/// Core-only transaction contracts. Both stay hidden and AI-disabled. Typed
/// fields not listed here are development-only advanced Bindings.
const STABLE_SETTING_DECLARATIONS: &[StableSettingDeclaration] = &[
    // Appearance.
    public_setting!(
        "app.language" => SETTING_APP_LANGUAGE,
        ("general", "appearance", "language", "language"),
        ("settings/appearance:appearance.language", "settings/appearance:appearance.languageRowHint"),
        SettingControl::Select,
        ["language", "locale", "语言"],
        apply = ConfigApplyStrategy::Adapter,
        schema = StableValueSchema::StringEnum(&["zh-CN", "en-US"]),
    ),
    public_setting!(
        "themes.current" => "core.themes.current",
        ("general", "appearance", "theme", "theme"),
        ("settings/appearance:appearance.themes", "settings/appearance:appearance.themeRowHint"),
        SettingControl::Select,
        ["theme", "appearance", "主题", "外观"],
        options = SettingOptionsProvider::AvailableThemes,
    ),
    public_setting!(
        "themes.custom" => "core.themes.custom",
        ("general", "appearance", "theme", "custom-themes"),
        ("settings/appearance:appearance.custom", "settings/appearance:appearance.themeRowHint"),
        SettingControl::List,
        ["custom theme", "自定义主题"],
    ),
    public_setting!(
        "font.uiSize.level" => "core.font.ui_size.level",
        ("general", "appearance", "font-size", "ui-font-size"),
        ("settings/appearance:appearance.fontSize.uiSizeLabel", "settings/appearance:appearance.fontSize.uiSizeHint"),
        SettingControl::Select,
        [
            "interface font size",
            "ui font size",
            "界面字号",
            "界面字体",
            "字体大小",
            "全局字号",
        ],
        schema = StableValueSchema::StringEnum(&["compact", "small", "default", "medium", "large", "custom"]),
    ),
    public_setting!(
        "font.uiSize.customPx" => "core.font.ui_size.custom_px",
        ("general", "appearance", "font-size", "ui-font-custom-size"),
        ("settings/appearance:appearance.fontSize.customPxLabel", "settings/appearance:appearance.fontSize.uiSizeHint"),
        SettingControl::Number,
        ["custom interface font size", "自定义界面字号"],
        schema = StableValueSchema::NullableInteger { minimum: 12, maximum: Some(20) },
    ),
    public_setting!(
        "font.flowChat.mode" => "core.font.flow_chat.mode",
        ("general", "appearance", "font-size", "flow-chat-font-mode"),
        ("settings/appearance:appearance.fontSize.flowChatLabel", "settings/appearance:appearance.fontSize.flowChatHint"),
        SettingControl::Select,
        ["chat font", "conversation font", "对话字体"],
    ),
    public_setting!(
        "font.flowChat.basePx" => "core.font.flow_chat.base_px",
        ("general", "appearance", "font-size", "flow-chat-font-size"),
        ("settings/appearance:appearance.fontSize.flowChatLabel", "settings/appearance:appearance.fontSize.flowChatHint"),
        SettingControl::Number,
        ["chat font size", "对话字号"],
        schema = StableValueSchema::NullableInteger { minimum: 12, maximum: Some(20) },
    ),
    public_setting!(
        "font.markdownEditor.mode" => "core.font.markdown_editor.mode",
        ("general", "appearance", "font-size", "markdown-editor-font-mode"),
        ("settings/appearance:appearance.fontSize.markdownEditorLabel", "settings/appearance:appearance.fontSize.markdownEditorHint"),
        SettingControl::Select,
        ["markdown editor font", "markdown 编辑器字体"],
    ),
    public_setting!(
        "font.markdownEditor.basePx" => "core.font.markdown_editor.base_px",
        ("general", "appearance", "font-size", "markdown-editor-font-size"),
        ("settings/appearance:appearance.fontSize.markdownEditorLabel", "settings/appearance:appearance.fontSize.markdownEditorHint"),
        SettingControl::Number,
        ["markdown editor font size", "markdown 编辑器字号"],
        schema = StableValueSchema::NullableInteger { minimum: 12, maximum: Some(20) },
    ),
    // Basics.
    public_setting!(
        "app.logging.level" => "core.app.logging.level",
        ("general", "basics", "logging", "log-level"),
        ("settings/basics:logging.sections.level", "settings/basics:logging.level.description"),
        SettingControl::Select,
        ["log level", "logging", "日志级别"],
        apply = ConfigApplyStrategy::Adapter,
        schema = StableValueSchema::StringEnum(&["trace", "debug", "info", "warn", "error", "off"]),
    ),
    public_setting!(
        "terminal.default_shell" => "core.terminal.default_shell",
        ("general", "terminal", "shell", "shell"),
        ("settings/basics:terminal.sections.defaultTerminal", "settings/basics:terminal.controls.description"),
        SettingControl::Select,
        ["terminal shell", "default shell", "终端 shell"],
        options = SettingOptionsProvider::AvailableTerminalShells,
    ),
    public_setting!(
        "app.notifications.dialog_completion_notify" => "core.app.notifications.dialog_completion_notify",
        ("general", "basics", "notifications", "dialog-completion-notify"),
        ("settings/basics:notifications.dialogCompletion.label", "settings/basics:notifications.dialogCompletion.description"),
        SettingControl::Switch,
        ["completion notification", "完成通知"],
    ),
    public_setting!(
        "app.notifications.enable_startup_tips" => "core.app.notifications.enable_startup_tips",
        ("general", "basics", "notifications", "startup-tips"),
        ("settings/basics:notifications.startupTips.label", "settings/basics:notifications.startupTips.description"),
        SettingControl::Switch,
        ["startup tips", "启动提示"],
    ),
    public_setting!(
        "app.tray.close_to_tray" => "core.app.tray.close_to_tray",
        ("general", "basics", "tray", "close-to-tray"),
        ("settings/basics:tray.closeAction.label", "settings/basics:tray.closeAction.description"),
        SettingControl::Switch,
        ["close to tray", "system tray", "关闭到托盘"],
    ),
    // Editor.
    public_setting!("editor.font_size" => "core.editor.font_size", ("productApps", "editor", "appearance", "font-size"), ("settings/editor:appearance.fontSize", "settings/editor:subtitle"), SettingControl::Number, ["editor font size", "编辑器字号"]),
    public_setting!("editor.font_family" => "core.editor.font_family", ("productApps", "editor", "appearance", "font-family"), ("settings/editor:appearance.font", "settings/editor:subtitle"), SettingControl::Text, ["editor font", "编辑器字体"]),
    public_setting!("editor.line_height" => "core.editor.line_height", ("productApps", "editor", "appearance", "line-height"), ("settings/editor:appearance.lineHeight", "settings/editor:subtitle"), SettingControl::Number, ["line height", "行高"]),
    public_setting!("editor.tab_size" => "core.editor.tab_size", ("productApps", "editor", "behavior", "tab-size"), ("settings/editor:behavior.tabSize", "settings/editor:subtitle"), SettingControl::Number, ["tab size", "制表符宽度"]),
    public_setting!("editor.insert_spaces" => "core.editor.insert_spaces", ("productApps", "editor", "behavior", "insert-spaces"), ("settings/editor:behavior.insertSpaces", "settings/editor:behavior.insertSpacesDesc"), SettingControl::Switch, ["insert spaces", "空格缩进"]),
    public_setting!("editor.word_wrap" => "core.editor.word_wrap", ("productApps", "editor", "behavior", "word-wrap"), ("settings/editor:behavior.wordWrap", "settings/editor:subtitle"), SettingControl::Select, ["word wrap", "自动换行"]),
    public_setting!("editor.line_numbers" => "core.editor.line_numbers", ("productApps", "editor", "behavior", "line-numbers"), ("settings/editor:behavior.lineNumbers", "settings/editor:subtitle"), SettingControl::Select, ["line numbers", "行号"]),
    public_setting!("editor.minimap.enabled" => "core.editor.minimap.enabled", ("productApps", "editor", "display", "minimap-enabled"), ("settings/editor:display.minimap", "settings/editor:display.minimapDesc"), SettingControl::Switch, ["minimap", "代码缩略图"]),
    public_setting!("editor.minimap.side" => "core.editor.minimap.side", ("productApps", "editor", "display", "minimap-side"), ("settings/editor:display.minimapPosition", "settings/editor:display.minimapDesc"), SettingControl::Select, ["minimap side", "缩略图位置"]),
    public_setting!("editor.minimap.size" => "core.editor.minimap.size", ("productApps", "editor", "display", "minimap-size"), ("settings/editor:display.minimapSize", "settings/editor:display.minimapDesc"), SettingControl::Select, ["minimap size", "缩略图大小"]),
    public_setting!("editor.theme" => "core.editor.theme", ("productApps", "editor", "appearance", "editor-theme"), ("settings/editor:sections.appearance.title", "settings/editor:subtitle"), SettingControl::Text, ["editor theme", "编辑器主题"]),
    public_setting!("editor.auto_save" => "core.editor.auto_save", ("productApps", "editor", "behavior", "auto-save"), ("settings/editor:sections.behavior.title", "settings/editor:subtitle"), SettingControl::Text, ["auto save", "自动保存"]),
    public_setting!("editor.auto_save_delay" => "core.editor.auto_save_delay", ("productApps", "editor", "behavior", "auto-save-delay"), ("settings/editor:sections.behavior.title", "settings/editor:subtitle"), SettingControl::Number, ["auto save delay", "自动保存延迟"]),
    public_setting!("editor.format_on_save" => "core.editor.format_on_save", ("productApps", "editor", "advanced", "format-on-save"), ("settings/editor:advanced.formatOnSave", "settings/editor:advanced.formatOnSaveDesc"), SettingControl::Switch, ["format on save", "保存时格式化"]),
    public_setting!("editor.format_on_paste" => "core.editor.format_on_paste", ("productApps", "editor", "advanced", "format-on-paste"), ("settings/editor:advanced.formatOnPaste", "settings/editor:advanced.formatOnPasteDesc"), SettingControl::Switch, ["format on paste", "粘贴时格式化"]),
    public_setting!("editor.trim_auto_whitespace" => "core.editor.trim_auto_whitespace", ("productApps", "editor", "advanced", "trim-auto-whitespace"), ("settings/editor:advanced.trimAutoWhitespace", "settings/editor:advanced.trimAutoWhitespaceDesc"), SettingControl::Switch, ["trim whitespace", "清理尾随空格"]),
    // Keyboard.
    public_setting!("app.keybindings" => "core.app.keybindings", ("general", "keyboard", "shortcuts", "keybindings"), ("settings/keyboard:title", "settings/keyboard:subtitle"), SettingControl::Custom, ["keyboard shortcuts", "keybindings", "快捷键"]),
    // Memory and host scan.
    public_setting!("ai.auto_memory.global.enabled" => "core.ai.auto_memory.global.enabled", ("smartCapabilities", "memory", "global-auto-memory", "enabled"), ("settings/memory:autoMemory.global.enabled", "settings/memory:autoMemory.global.enabledDesc"), SettingControl::Switch, ["global memory", "全局记忆"]),
    public_setting!("ai.auto_memory.global.extract_every_eligible_turns" => "core.ai.auto_memory.global.extract_every_eligible_turns", ("smartCapabilities", "memory", "global-auto-memory", "extract-every-turns"), ("settings/memory:autoMemory.global.extractEveryEligibleTurns", "settings/memory:autoMemory.global.extractEveryEligibleTurnsDesc"), SettingControl::Number, ["global memory interval", "全局记忆频率"]),
    public_setting!("ai.auto_memory.global.min_extract_interval_secs" => "core.ai.auto_memory.global.min_extract_interval_secs", ("smartCapabilities", "memory", "global-auto-memory", "minimum-interval"), ("settings/memory:autoMemory.global.minExtractIntervalMinutes", "settings/memory:autoMemory.global.minExtractIntervalMinutesDesc"), SettingControl::Number, ["global memory cooldown", "全局记忆冷却"]),
    public_setting!("ai.auto_memory.global.force_extract_after_pending_eligible_turns" => "core.ai.auto_memory.global.force_extract_after_pending_eligible_turns", ("smartCapabilities", "memory", "global-auto-memory", "force-after-pending-turns"), ("settings/memory:autoMemory.global.forceExtractAfterPendingEligibleTurns", "settings/memory:autoMemory.global.forceExtractAfterPendingEligibleTurnsDesc"), SettingControl::Number, ["force global memory extraction", "强制全局记忆"]),
    hidden_setting!("ai.auto_memory.global.idle_trigger_after_secs" => "core.ai.auto_memory.global.idle_trigger_after_secs"),
    public_setting!("ai.auto_memory.workspace.enabled" => "core.ai.auto_memory.workspace.enabled", ("smartCapabilities", "memory", "workspace-auto-memory", "enabled"), ("settings/memory:autoMemory.workspace.enabled", "settings/memory:autoMemory.workspace.enabledDesc"), SettingControl::Switch, ["workspace memory", "工作区记忆"]),
    public_setting!("ai.auto_memory.workspace.extract_every_eligible_turns" => "core.ai.auto_memory.workspace.extract_every_eligible_turns", ("smartCapabilities", "memory", "workspace-auto-memory", "extract-every-turns"), ("settings/memory:autoMemory.workspace.extractEveryEligibleTurns", "settings/memory:autoMemory.workspace.extractEveryEligibleTurnsDesc"), SettingControl::Number, ["workspace memory interval", "工作区记忆频率"]),
    public_setting!("ai.auto_memory.workspace.min_extract_interval_secs" => "core.ai.auto_memory.workspace.min_extract_interval_secs", ("smartCapabilities", "memory", "workspace-auto-memory", "minimum-interval"), ("settings/memory:autoMemory.workspace.minExtractIntervalMinutes", "settings/memory:autoMemory.workspace.minExtractIntervalMinutesDesc"), SettingControl::Number, ["workspace memory cooldown", "工作区记忆冷却"]),
    public_setting!("ai.auto_memory.workspace.force_extract_after_pending_eligible_turns" => "core.ai.auto_memory.workspace.force_extract_after_pending_eligible_turns", ("smartCapabilities", "memory", "workspace-auto-memory", "force-after-pending-turns"), ("settings/memory:autoMemory.workspace.forceExtractAfterPendingEligibleTurns", "settings/memory:autoMemory.workspace.forceExtractAfterPendingEligibleTurnsDesc"), SettingControl::Number, ["force workspace memory extraction", "强制工作区记忆"]),
    hidden_setting!("ai.auto_memory.workspace.idle_trigger_after_secs" => "core.ai.auto_memory.workspace.idle_trigger_after_secs"),
    public_setting!("app.host_scan.auto_scan_enabled" => "core.app.host_scan.auto_scan_enabled", ("smartCapabilities", "memory", "host-scan", "enabled"), ("settings/memory:hostScan.enable.label", "settings/memory:hostScan.enable.description"), SettingControl::Switch, ["host scan", "automatic scan", "主机扫描"], apply = ConfigApplyStrategy::Adapter),
    public_setting!("app.host_scan.auto_scan_interval_days" => "core.app.host_scan.auto_scan_interval_days", ("smartCapabilities", "memory", "host-scan", "interval-days"), ("settings/memory:hostScan.interval.label", "settings/memory:hostScan.interval.description"), SettingControl::Number, ["host scan interval", "扫描间隔"], apply = ConfigApplyStrategy::Adapter),
    // Models and proxy.
    public_setting!("ai.models" => SETTING_AI_MODELS, ("general", "models", "providers", "models"), ("settings/ai-model:title", "settings/ai-model:editProviderSubtitle"), SettingControl::Custom, ["models", "providers", "api key", "模型供应商"], apply = ConfigApplyStrategy::Adapter),
    public_setting!("ai.default_models.primary" => SETTING_AI_DEFAULT_PRIMARY, ("general", "models", "default-model", "primary-model"), ("settings/default-model:core.primary.label", "settings/default-model:core.primary.description"), SettingControl::Select, ["primary model", "default model", "主力模型"], apply = ConfigApplyStrategy::Adapter, options = SettingOptionsProvider::EnabledAiModels),
    public_setting!("ai.default_models.fast" => SETTING_AI_DEFAULT_FAST, ("general", "models", "default-model", "fast-model"), ("settings/default-model:core.fast.label", "settings/default-model:core.fast.description"), SettingControl::Select, ["fast model", "快速模型"], apply = ConfigApplyStrategy::Adapter, options = SettingOptionsProvider::EnabledAiModels),
    public_setting!("ai.default_models.search" => "core.ai.default_models.search", ("general", "models", "default-model", "search-model"), ("settings/default-model:optional.title", "settings/default-model:optional.selectModel"), SettingControl::Select, ["search model", "搜索模型"], apply = ConfigApplyStrategy::Adapter, options = SettingOptionsProvider::EnabledAiModels),
    public_setting!("ai.default_models.image_understanding" => "core.ai.default_models.image_understanding", ("general", "models", "default-model", "image-understanding-model"), ("settings/default-model:optional.capabilities.image_understanding.label", "settings/default-model:optional.capabilities.image_understanding.description"), SettingControl::Select, ["vision model", "image understanding model", "视觉模型"], apply = ConfigApplyStrategy::Adapter, options = SettingOptionsProvider::EnabledAiModels),
    public_setting!("ai.default_models.image_generation" => "core.ai.default_models.image_generation", ("general", "models", "default-model", "image-generation-model"), ("settings/default-model:optional.capabilities.image_generation.label", "settings/default-model:optional.capabilities.image_generation.description"), SettingControl::Select, ["image generation model", "图像生成模型"], apply = ConfigApplyStrategy::Adapter, options = SettingOptionsProvider::EnabledAiModels),
    public_setting!("ai.default_models.speech_recognition" => SETTING_AI_DEFAULT_SPEECH_RECOGNITION, ("general", "models", "default-model", "speech-recognition-model"), ("settings/default-model:optional.capabilities.speech_recognition.label", "settings/default-model:optional.capabilities.speech_recognition.description"), SettingControl::Select, ["speech recognition model", "语音识别模型"], apply = ConfigApplyStrategy::Adapter, options = SettingOptionsProvider::SpeechRecognitionTargets),
    public_setting!("ai.proxy.enabled" => "core.ai.proxy.enabled", ("general", "models", "proxy", "enabled"), ("settings/ai-model:proxy.enable", "settings/ai-model:proxy.urlHint"), SettingControl::Switch, ["proxy", "model proxy", "代理"], apply = ConfigApplyStrategy::Adapter),
    public_setting!("ai.proxy.url" => "core.ai.proxy.url", ("general", "models", "proxy", "url"), ("settings/ai-model:proxy.url", "settings/ai-model:proxy.urlHint"), SettingControl::Text, ["proxy url", "代理地址"], apply = ConfigApplyStrategy::Adapter),
    public_setting!("ai.proxy.username" => "core.ai.proxy.username", ("general", "models", "proxy", "username"), ("settings/ai-model:proxy.username", "settings/ai-model:proxy.usernamePlaceholder"), SettingControl::Text, ["proxy username", "代理用户名"], apply = ConfigApplyStrategy::Adapter),
    public_setting!("ai.proxy.password" => "core.ai.proxy.password", ("general", "models", "proxy", "password"), ("settings/ai-model:proxy.password", "settings/ai-model:proxy.passwordPlaceholder"), SettingControl::Text, ["proxy password", "代理密码"], apply = ConfigApplyStrategy::Adapter),
    public_setting!("ai.stream_idle_timeout_secs" => "core.ai.stream_idle_timeout_secs", ("general", "models", "runtime", "stream-idle-timeout"), ("settings/ai-model:streamIdleTimeout.label", "settings/ai-model:streamIdleTimeout.title"), SettingControl::Number, ["stream timeout", "stream idle timeout", "流式超时"], apply = ConfigApplyStrategy::Adapter, schema = StableValueSchema::NullableInteger { minimum: 1, maximum: None }),
    // Permissions.
    public_setting!("ai.skip_tool_confirmation" => SETTING_AI_SKIP_TOOL_CONFIRMATION, ("smartCapabilities", "permissions", "tool-execution", "skip-tool-confirmation"), ("settings/agentic-tools:config.autoExecute", "settings/agentic-tools:config.autoExecuteDesc"), SettingControl::Switch, ["skip tool confirmation", "auto execute tools", "自动执行工具"], risk = SettingRisk::Elevated),
    public_setting!("ai.tool_execution_timeout_secs" => "core.ai.tool_execution_timeout_secs", ("smartCapabilities", "permissions", "tool-execution", "execution-timeout"), ("settings/agentic-tools:config.executionTimeout", "settings/agentic-tools:config.executionTimeoutDesc"), SettingControl::Number, ["tool execution timeout", "工具执行超时"], schema = StableValueSchema::NullableInteger { minimum: 1, maximum: None }),
    public_setting!("ai.tool_confirmation_timeout_secs" => "core.ai.tool_confirmation_timeout_secs", ("smartCapabilities", "permissions", "tool-execution", "confirmation-timeout"), ("settings/agentic-tools:config.confirmTimeout", "settings/agentic-tools:config.confirmTimeoutDesc"), SettingControl::Number, ["tool confirmation timeout", "工具确认超时"], schema = StableValueSchema::NullableInteger { minimum: 1, maximum: None }),
    public_setting!("ai.goal_mode.max_continuation_turns" => "core.ai.goal_mode.max_continuation_turns", ("smartCapabilities", "permissions", "goal-mode", "max-continuation-turns"), ("settings/permissions:goalMode.maxContinuationTurns", "settings/permissions:goalMode.maxContinuationTurnsDesc"), SettingControl::Number, ["goal continuation turns", "目标续跑轮次"]),
    public_setting!("ai.computer_use_enabled" => "core.ai.computer_use_enabled", ("smartCapabilities", "permissions", "computer-use", "computer-use-enabled"), ("settings/permissions:computerUse.enable", "settings/permissions:computerUse.enableDesc"), SettingControl::Switch, ["computer use", "desktop automation", "电脑操作"], risk = SettingRisk::Elevated),
    // Personalization and voice input.
    public_setting!("ai.agent_models" => SETTING_AI_AGENT_MODELS, ("smartCapabilities", "personalization", "models", "agent-models"), ("settings/default-model:advanced.modeOverrides.title", "settings/default-model:advanced.modeOverrides.description"), SettingControl::Custom, ["agent models", "agent model override", "Agent 模型"], apply = ConfigApplyStrategy::Adapter, options = SettingOptionsProvider::AgentModelTargets),
    public_setting!("ai.func_agent_models" => SETTING_AI_FUNC_AGENT_MODELS, ("smartCapabilities", "personalization", "models", "function-agent-models"), ("settings/default-model:advanced.subAgentOverrides.title", "settings/default-model:advanced.subAgentOverrides.description"), SettingControl::Custom, ["function agent models", "subagent models", "功能 Agent 模型"], apply = ConfigApplyStrategy::Adapter, options = SettingOptionsProvider::AgentModelTargets),
    public_setting!("app.ai_experience.enable_daily_letter" => "core.app.ai_experience.enable_daily_letter", ("smartCapabilities", "personalization", "daily-letter", "enabled"), ("settings/personalization:features.dailyLetter.title", "settings/personalization:features.dailyLetter.subtitle"), SettingControl::Switch, ["daily letter", "每日信笺"]),
    public_setting!("app.ai_experience.enable_session_title_generation" => "core.app.ai_experience.enable_session_title_generation", ("smartCapabilities", "personalization", "session-title", "enabled"), ("settings/personalization:features.sessionTitle.title", "settings/personalization:features.sessionTitle.warning"), SettingControl::Switch, ["session title generation", "会话标题生成"]),
    hidden_setting!("app.ai_experience.enable_visual_mode" => "core.app.ai_experience.enable_visual_mode"),
    public_setting!("app.ai_experience.enable_agent_companion" => SETTING_AGENT_COMPANION_ENABLED, ("smartCapabilities", "personalization", "agent-companion", "enabled"), ("settings/personalization:features.agentCompanion.enable", "settings/personalization:features.agentCompanion.title"), SettingControl::Switch, ["agent companion", "desktop pet", "Agent 伙伴"]),
    public_setting!("app.ai_experience.agent_companion_pet" => "core.app.ai_experience.agent_companion_pet", ("smartCapabilities", "personalization", "agent-companion", "pet"), ("settings/personalization:features.agentCompanion.petLabel", "settings/personalization:features.agentCompanion.petDescription"), SettingControl::Custom, ["companion pet", "petdex", "伙伴宠物"], atomic = true),
    public_setting!("app.ai_experience.show_thinking_process" => "core.app.ai_experience.show_thinking_process", ("smartCapabilities", "personalization", "thinking-process", "show-thinking-process"), ("settings/personalization:features.thinkingProcess.showProcess", "settings/personalization:features.thinkingProcess.showProcessDescription"), SettingControl::Switch, ["show thinking process", "显示思考过程"]),
    public_setting!("app.ai_experience.show_completed_thinking_item" => "core.app.ai_experience.show_completed_thinking_item", ("smartCapabilities", "personalization", "thinking-process", "show-completed-thinking"), ("settings/personalization:features.thinkingProcess.keepCompletedItem", "settings/personalization:features.thinkingProcess.keepCompletedItemDescription"), SettingControl::Switch, ["completed thinking item", "保留已完成思考"]),
    public_setting!("app.ai_experience.voice_input.enabled" => "core.app.ai_experience.voice_input.enabled", ("smartCapabilities", "voiceInput", "composer", "enabled"), ("settings/voice-input:composer.enabled.label", "settings/voice-input:composer.enabled.description"), SettingControl::Switch, ["voice input", "microphone", "语音输入"]),
    public_setting!("app.ai_experience.voice_input.default_language" => "core.app.ai_experience.voice_input.default_language", ("smartCapabilities", "voiceInput", "composer", "language"), ("settings/voice-input:composer.language.label", "settings/voice-input:composer.language.description"), SettingControl::Select, ["voice language", "speech language", "语音语言"]),
    public_setting!("app.ai_experience.voice_input.max_recording_seconds" => "core.app.ai_experience.voice_input.max_recording_seconds", ("smartCapabilities", "voiceInput", "composer", "max-recording-seconds"), ("settings/voice-input:composer.maxRecording.label", "settings/voice-input:composer.maxRecording.description"), SettingControl::Number, ["maximum recording time", "最长录音时间"]),
    // BitFun Coder Product App settings currently owned by Core.
    public_setting!("product_apps.apps.builtin-bitfun-coder.debug.ingest_port" => SETTING_DEBUG_INGEST_PORT, ("productApps", "bitfun-coder", "debug", "ingest-port"), ("settings/debug:settings.ingestPort.label", "settings/debug:settings.ingestPort.description"), SettingControl::Number, ["debug ingest port", "调试端口"], risk = SettingRisk::Elevated, apply = ConfigApplyStrategy::Adapter),
    public_setting!("product_apps.apps.builtin-bitfun-coder.debug.log_path" => "core.product_apps.bitfun_coder.debug.log_path", ("productApps", "bitfun-coder", "debug", "log-path"), ("settings/debug:settings.logPath.label", "settings/debug:settings.logPath.description"), SettingControl::Path, ["debug log path", "调试日志路径"], apply = ConfigApplyStrategy::Adapter),
    public_setting!("product_apps.apps.builtin-bitfun-coder.debug.enabled_languages" => "core.product_apps.bitfun_coder.debug.enabled_languages", ("productApps", "bitfun-coder", "debug", "enabled-languages"), ("settings/debug:sections.templates", "settings/debug:templates.description"), SettingControl::List, ["debug languages", "调试语言"], apply = ConfigApplyStrategy::Adapter),
    public_setting!("product_apps.apps.builtin-bitfun-coder.debug.language_templates" => "core.product_apps.bitfun_coder.debug.language_templates", ("productApps", "bitfun-coder", "debug", "language-templates"), ("settings/debug:sections.templates", "settings/debug:templates.description"), SettingControl::Custom, ["debug templates", "调试模板"], apply = ConfigApplyStrategy::Adapter),
    // Hidden but stable product-surface snapshot contracts.
    hidden_setting!("ai.agent_capability_configs" => SETTING_AI_AGENT_CAPABILITY_CONFIGS, generic_surface_writable = false),
    hidden_setting!("terminal.font_size" => "core.terminal.font_size"),
    hidden_setting!("terminal.font_family" => "core.terminal.font_family"),
    hidden_setting!("terminal.cursor_blink" => "core.terminal.cursor_blink"),
    hidden_setting!("terminal.cursor_style" => "core.terminal.cursor_style"),
    hidden_setting!("terminal.scrollback" => "core.terminal.scrollback"),
    hidden_setting!("terminal.theme.background" => "core.terminal.theme.background"),
    hidden_setting!("terminal.theme.foreground" => "core.terminal.theme.foreground"),
    hidden_setting!("terminal.theme.cursor" => "core.terminal.theme.cursor"),
    hidden_setting!("terminal.theme.selection" => "core.terminal.theme.selection"),
    hidden_setting!("terminal.theme.black" => "core.terminal.theme.black"),
    hidden_setting!("terminal.theme.red" => "core.terminal.theme.red"),
    hidden_setting!("terminal.theme.green" => "core.terminal.theme.green"),
    hidden_setting!("terminal.theme.yellow" => "core.terminal.theme.yellow"),
    hidden_setting!("terminal.theme.blue" => "core.terminal.theme.blue"),
    hidden_setting!("terminal.theme.magenta" => "core.terminal.theme.magenta"),
    hidden_setting!("terminal.theme.cyan" => "core.terminal.theme.cyan"),
    hidden_setting!("terminal.theme.white" => "core.terminal.theme.white"),
    hidden_setting!("terminal.theme.bright_black" => "core.terminal.theme.bright_black"),
    hidden_setting!("terminal.theme.bright_red" => "core.terminal.theme.bright_red"),
    hidden_setting!("terminal.theme.bright_green" => "core.terminal.theme.bright_green"),
    hidden_setting!("terminal.theme.bright_yellow" => "core.terminal.theme.bright_yellow"),
    hidden_setting!("terminal.theme.bright_blue" => "core.terminal.theme.bright_blue"),
    hidden_setting!("terminal.theme.bright_magenta" => "core.terminal.theme.bright_magenta"),
    hidden_setting!("terminal.theme.bright_cyan" => "core.terminal.theme.bright_cyan"),
    hidden_setting!("terminal.theme.bright_white" => "core.terminal.theme.bright_white"),
    // Core-only stable transaction IDs.
    internal_setting!("app.tray.hide_to_tray_hint_shown" => SETTING_APP_TRAY_HINT_SHOWN),
    internal_setting!("ai.subagent_configs" => SETTING_AI_SUBAGENT_CONFIGS),
    internal_setting!("mcp_servers" => SETTING_MCP_SERVERS, schema = StableValueSchema::NullableObject),
];

#[derive(Clone)]
struct CatalogMetadata {
    /// Published product identity. This is deliberately independent from the
    /// provider storage path: when storage moves, the metadata declaration
    /// moves while this id remains unchanged. Undeclared Binding and runtime
    /// Internal fields stay `None` and use derived implementation identities.
    stable_product_id: Option<&'static str>,
    /// Explicit publication boundary for stable declarations. Undeclared typed
    /// fields derive Binding exposure; runtime-only fields derive Internal.
    exposure: Option<SettingExposure>,
    /// Whether generic published Catalog consumers may write this setting.
    /// Core-owned services still use the descriptor's intrinsic mutability.
    generic_surface_writable: bool,
    /// Owner declared alongside stable identities. Undeclared Binding and
    /// runtime Internal descriptors use generic runtime providers instead.
    source: Option<SettingDescriptorSource>,
    aliases: &'static [&'static str],
    risk: SettingRisk,
    sensitivity: SettingSensitivity,
    apply_strategy: ConfigApplyStrategy,
    read_only: bool,
    options_provider: Option<SettingOptionsProvider>,
    /// Treats a typed object as one replaceable value instead of recursively
    /// publishing its implementation fields. This is explicit per setting so
    /// nullable objects that intentionally expose child settings still expand.
    atomic_object: bool,
    value_schema: Option<Value>,
    presentation: Option<SettingPresentationDescriptor>,
    /// User-facing settings are discoverable by SettingsAgent and visible in
    /// generated/manual UI. Hidden Formal declarations remain stable product
    /// protocol contracts without becoming user- or AI-facing settings.
    user_facing: bool,
}

fn validate_formal_published_metadata(path: &str, metadata: &CatalogMetadata) -> CoreResult<()> {
    if metadata.exposure != Some(SettingExposure::Formal) || !metadata.user_facing {
        return Ok(());
    }
    if metadata.source.is_none() {
        return Err(CoreError::config(format!(
            "Formal published setting '{path}' must declare a descriptor source"
        )));
    }
    let presentation = metadata.presentation.as_ref().ok_or_else(|| {
        CoreError::config(format!(
            "Formal published setting '{path}' must declare presentation metadata"
        ))
    })?;
    let description_key = presentation.description_key.as_deref().ok_or_else(|| {
        CoreError::config(format!(
            "Formal published setting '{path}' must declare a localized description"
        ))
    })?;
    for (field, key) in [
        ("title", presentation.title_key.as_str()),
        ("description", description_key),
    ] {
        if key.trim() != key || !key.contains(':') || key.contains(path) {
            return Err(CoreError::config(format!(
                "Formal published setting '{path}' has invalid localized {field} key '{key}'"
            )));
        }
    }
    Ok(())
}

fn stable_setting_declaration(path: &str) -> Option<StableSettingDeclaration> {
    STABLE_SETTING_DECLARATIONS
        .iter()
        .copied()
        .find(|declaration| declaration.storage_path == path)
}

fn metadata_for(path: &str) -> CatalogMetadata {
    if let Some(declaration) = stable_setting_declaration(path) {
        return declaration.metadata();
    }

    let mut metadata = CatalogMetadata {
        stable_product_id: None,
        exposure: None,
        generic_surface_writable: true,
        source: None,
        aliases: &[],
        risk: SettingRisk::Safe,
        sensitivity: SettingSensitivity::Public,
        apply_strategy: ConfigApplyStrategy::Reactive,
        read_only: false,
        options_provider: None,
        atomic_object: false,
        value_schema: None,
        presentation: None,
        user_facing: false,
    };

    // Binding metadata is intentionally limited to generic development fallback
    // behavior. Product identity, presentation, AI access and apply routing must
    // be declared in STABLE_SETTING_DECLARATIONS.
    if path_requires_elevated_risk(path) {
        metadata.risk = SettingRisk::Elevated;
    }
    metadata
}

fn path_requires_elevated_risk(path: &str) -> bool {
    let normalized_path = path
        .split('.')
        .map(normalize_product_segment)
        .collect::<Vec<_>>()
        .join(".");
    let field = normalized_path.rsplit('.').next().unwrap_or_default();
    normalized_path.contains("computer_use")
        || normalized_path.contains("permission")
        || normalized_path.contains("skip_tool_confirmation")
        || field == "port"
        || field.ends_with("_port")
}
fn setting_id(path: &str, metadata: &CatalogMetadata, declared: bool) -> String {
    metadata
        .stable_product_id
        .map(str::to_string)
        .unwrap_or_else(|| {
            if declared {
                typed_setting_id(path)
            } else {
                advanced_setting_id(path)
            }
        })
}

fn typed_setting_id(path: &str) -> String {
    let normalized = path
        .split('.')
        .filter(|segment| !segment.is_empty())
        .map(normalize_product_segment)
        .collect::<Vec<_>>()
        .join(".");
    format!("core.{normalized}")
}

fn normalize_product_segment(segment: &str) -> String {
    let characters = segment.chars().collect::<Vec<_>>();
    let mut normalized = String::new();
    for (index, character) in characters.iter().copied().enumerate() {
        if character == '_' || character == '-' || character.is_whitespace() {
            if !normalized.ends_with('_') && !normalized.is_empty() {
                normalized.push('_');
            }
            continue;
        }
        if character.is_ascii_uppercase() {
            let previous = index
                .checked_sub(1)
                .and_then(|offset| characters.get(offset));
            let next = characters.get(index + 1);
            let starts_word = previous
                .is_some_and(|value| value.is_ascii_lowercase() || value.is_ascii_digit())
                || (previous.is_some_and(|value| value.is_ascii_uppercase())
                    && next.is_some_and(|value| value.is_ascii_lowercase()));
            if starts_word && !normalized.ends_with('_') && !normalized.is_empty() {
                normalized.push('_');
            }
            normalized.push(character.to_ascii_lowercase());
        } else if character.is_ascii_alphanumeric() {
            normalized.push(character.to_ascii_lowercase());
        } else if !normalized.ends_with('_') && !normalized.is_empty() {
            normalized.push('_');
        }
    }
    normalized.trim_matches('_').to_string()
}

fn advanced_setting_id(path: &str) -> String {
    format!("advanced.{}", short_hash(path))
}

fn short_hash(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    format!("{:x}", digest)[..24].to_string()
}

fn normalize_identifier(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn schema_for(value: &Value) -> Value {
    match value {
        Value::Null => serde_json::json!({ "type": "object", "properties": {} }),
        Value::Bool(_) => serde_json::json!({ "type": "boolean" }),
        Value::Number(number) if number.is_i64() || number.is_u64() => {
            serde_json::json!({ "type": "integer" })
        }
        Value::Number(_) => serde_json::json!({ "type": "number" }),
        Value::String(_) => serde_json::json!({ "type": "string" }),
        Value::Array(items) => serde_json::json!({
            "type": "array",
            "items": items.first().map(schema_for).unwrap_or_else(|| serde_json::json!({}))
        }),
        Value::Object(object) => {
            let properties: Map<String, Value> = object
                .iter()
                .map(|(key, value)| (key.clone(), schema_for(value)))
                .collect();
            serde_json::json!({ "type": "object", "properties": properties })
        }
    }
}

fn control_for(default: &Value, current: &Value, schema: &Value) -> SettingControl {
    if schema
        .get("enum")
        .and_then(Value::as_array)
        .is_some_and(|variants| !variants.is_empty())
    {
        return SettingControl::Select;
    }
    match schema.get("type").and_then(Value::as_str) {
        Some("boolean") => return SettingControl::Switch,
        Some("integer" | "number") => return SettingControl::Number,
        Some("string") => return SettingControl::Text,
        Some("array") => return SettingControl::List,
        Some("object") => return SettingControl::Object,
        _ => {}
    }

    let value = preferred_value(default, current);
    match value {
        Value::Bool(_) => SettingControl::Switch,
        Value::Number(_) => SettingControl::Number,
        Value::String(_) => SettingControl::Text,
        Value::Array(_) => SettingControl::List,
        Value::Object(_) | Value::Null => SettingControl::Object,
    }
}

fn is_scalar_schema(schema: &Value) -> bool {
    matches!(
        schema.get("type").and_then(Value::as_str),
        Some("boolean" | "integer" | "number" | "string")
    )
}

fn path_is_secret(path: &str) -> bool {
    ConfigSecretPath::from_storage_path(path).is_sensitive()
}

fn contains_secret_field(storage_path: &str, value: &Value) -> bool {
    contains_secret_field_at_path(value, &ConfigSecretPath::from_storage_path(storage_path))
}

fn contains_secret_field_at_path(value: &Value, path: &ConfigSecretPath) -> bool {
    if path.is_sensitive() {
        return true;
    }
    match value {
        Value::Object(object) => object
            .iter()
            .any(|(key, value)| contains_secret_field_at_path(value, &path.child(key))),
        Value::Array(values) => values
            .iter()
            .any(|value| contains_secret_field_at_path(value, path)),
        _ => false,
    }
}

fn schema_contains_secret_field(storage_path: &str, schema: &Value) -> bool {
    schema_contains_secret_field_at_path(schema, &ConfigSecretPath::from_storage_path(storage_path))
}

fn schema_contains_secret_field_at_path(schema: &Value, path: &ConfigSecretPath) -> bool {
    if path.is_sensitive() {
        return true;
    }
    let Some(object) = schema.as_object() else {
        return false;
    };

    object
        .get("properties")
        .and_then(Value::as_object)
        .is_some_and(|properties| {
            properties
                .iter()
                .any(|(name, child)| schema_contains_secret_field_at_path(child, &path.child(name)))
        })
        || ["items", "additionalProperties"]
            .iter()
            .filter_map(|key| object.get(*key))
            .any(|child| schema_contains_secret_field_at_path(child, path))
        || ["allOf", "anyOf", "oneOf"]
            .iter()
            .filter_map(|key| object.get(*key).and_then(Value::as_array))
            .flatten()
            .any(|child| schema_contains_secret_field_at_path(child, path))
}

fn redact_nested_secrets(value: Value, path: &ConfigSecretPath) -> Value {
    if path.is_sensitive() {
        return serde_json::json!({ "configured": is_configured(&value) });
    }
    match value {
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .map(|(key, value)| {
                    let child_path = path.child(&key);
                    (key, redact_nested_secrets(value, &child_path))
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .map(|value| redact_nested_secrets(value, path))
                .collect(),
        ),
        other => other,
    }
}

fn is_configured(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(value) => !value.trim().is_empty(),
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => !value.is_empty(),
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contains_exact_string(value: &Value, needle: &str) -> bool {
        match value {
            Value::String(value) => value == needle,
            Value::Array(values) => values
                .iter()
                .any(|value| contains_exact_string(value, needle)),
            Value::Object(values) => values
                .values()
                .any(|value| contains_exact_string(value, needle)),
            _ => false,
        }
    }

    #[test]
    fn recursively_discovers_leaves_and_keeps_arrays_atomic() {
        let value = serde_json::json!({
            "app": { "logging": { "level": "info" } },
            "ai": { "models": [{ "id": "one", "api_key": "secret", "max_tokens": 4096 }] }
        });
        let catalog = ConfigCatalog::build(&value, &value).expect("catalog");
        assert!(catalog.find("core.app.logging.level").is_some());
        let models = catalog
            .settings
            .iter()
            .find(|setting| setting.storage.path == "ai.models")
            .expect("models descriptor");
        assert_eq!(models.policy.sensitivity, SettingSensitivity::Private);
        assert_eq!(models.exposure, SettingExposure::Formal);
        assert!(!models.presentation.hidden);
        assert!(models.ai.readable);
        assert!(!models.ai.writable);
        assert_eq!(
            catalog.snapshot_values(&value)[&models.id],
            ConfigStoredValue::public(serde_json::json!([{
                "id": "one",
                "api_key": { "configured": true },
                "max_tokens": 4096
            }]))
        );
    }

    #[test]
    fn mixed_secret_writes_preserve_credentials_by_stable_object_id() {
        let current = serde_json::json!([
            { "id": "one", "name": "One", "api_key": "secret-one" },
            { "id": "two", "name": "Two", "api_key": "secret-two" }
        ]);
        let catalog = ConfigCatalog::build(
            &serde_json::json!({ "ai": { "models": [] } }),
            &serde_json::json!({ "ai": { "models": current.clone() } }),
        )
        .expect("catalog");
        let descriptor = catalog.find_by_path("ai.models").expect("models");
        let proposed = serde_json::json!([
            { "id": "two", "name": "Two updated", "api_key": { "configured": true } },
            { "id": "one", "name": "One updated" }
        ]);

        let resolved = resolve_config_write_value(descriptor, &current, &proposed)
            .expect("resolve mixed secrets");

        assert_eq!(resolved[0]["api_key"], "secret-two");
        assert_eq!(resolved[1]["api_key"], "secret-one");
        assert!(!resolved.to_string().contains("configured"));
    }

    #[test]
    fn a_new_stable_id_cannot_inherit_an_existing_secret_by_array_position() {
        let current = serde_json::json!([
            { "id": "existing", "api_key": "existing-secret" }
        ]);
        let catalog = ConfigCatalog::build(
            &serde_json::json!({ "ai": { "models": [] } }),
            &serde_json::json!({ "ai": { "models": current.clone() } }),
        )
        .expect("catalog");
        let descriptor = catalog.find_by_path("ai.models").expect("models");

        let error = resolve_config_write_value(
            descriptor,
            &current,
            &serde_json::json!([
                { "id": "new", "api_key": { "configured": true } }
            ]),
        )
        .expect_err("new model must not inherit an existing secret");

        assert!(error
            .to_string()
            .contains("configured secret that does not exist"));
    }

    #[test]
    fn explicit_secret_clear_uses_the_existing_value_shape() {
        let current = serde_json::json!({ "password": "secret" });
        let catalog = ConfigCatalog::build(&current, &current).expect("catalog");
        let descriptor = catalog.find_by_path("password").expect("password");

        assert_eq!(
            resolve_config_write_value(
                descriptor,
                &Value::String("secret".into()),
                &serde_json::json!({ "clear": true }),
            )
            .expect("clear"),
            Value::String(String::new())
        );
    }

    #[test]
    fn current_only_dynamic_field_remains_internal() {
        let defaults = serde_json::json!({ "unknown": {} });
        let current = serde_json::json!({ "unknown": { "new_field": true } });
        let first = ConfigCatalog::build(&defaults, &current).expect("catalog");
        let second = ConfigCatalog::build(&defaults, &current).expect("catalog");
        let first_dynamic = first
            .find_by_path("unknown.new_field")
            .expect("dynamic setting");
        let second_dynamic = second
            .find_by_path("unknown.new_field")
            .expect("dynamic setting");
        assert_eq!(first_dynamic.id, second_dynamic.id);
        assert_ne!(first_dynamic.id, first_dynamic.storage.path);
        assert!(first_dynamic.id.starts_with("advanced."));
        assert_eq!(first_dynamic.exposure, SettingExposure::Internal);
        assert!(!first_dynamic.ai.readable);
        assert!(!first_dynamic.ai.writable);
    }

    #[test]
    fn exposure_visibility_policy_covers_development_and_release_builds() {
        assert!(!SettingExposure::Formal.is_hidden_for_build(false));
        assert!(!SettingExposure::Formal.is_hidden_for_build(true));
        assert!(SettingExposure::Formal.is_published_for_build(false));
        assert!(SettingExposure::Formal.is_published_for_build(true));
        assert!(!SettingExposure::Binding.is_hidden_for_build(false));
        assert!(SettingExposure::Binding.is_hidden_for_build(true));
        assert!(SettingExposure::Binding.is_published_for_build(false));
        assert!(!SettingExposure::Binding.is_published_for_build(true));
        assert!(SettingExposure::Internal.is_hidden_for_build(false));
        assert!(SettingExposure::Internal.is_hidden_for_build(true));
        assert!(!SettingExposure::Internal.is_published_for_build(false));
        assert!(!SettingExposure::Internal.is_published_for_build(true));
    }

    #[test]
    fn stable_declarations_have_unique_identity_and_complete_user_facing_copy() {
        assert_eq!(STABLE_SETTING_DECLARATIONS.len(), 105);
        assert_eq!(
            STABLE_SETTING_DECLARATIONS
                .iter()
                .filter(|declaration| declaration.exposure == SettingExposure::Formal)
                .count(),
            102
        );
        assert_eq!(
            STABLE_SETTING_DECLARATIONS
                .iter()
                .filter(|declaration| declaration.exposure == SettingExposure::Internal)
                .count(),
            3
        );
        let mut stable_ids = BTreeSet::new();
        let mut storage_paths = BTreeSet::new();

        for declaration in STABLE_SETTING_DECLARATIONS {
            assert!(
                stable_ids.insert(declaration.stable_product_id),
                "duplicate stable setting id {}",
                declaration.stable_product_id
            );
            assert!(
                storage_paths.insert(declaration.storage_path),
                "duplicate setting storage path {}",
                declaration.storage_path
            );
            assert!(declaration.stable_product_id.starts_with("core."));
            if let Some(presentation) = declaration.presentation {
                assert_eq!(declaration.exposure, SettingExposure::Formal);
                assert!(!presentation.title_key.trim().is_empty());
                assert!(!presentation.description_key.trim().is_empty());
                assert!(presentation.title_key.contains(':'));
                assert!(presentation.description_key.contains(':'));
            }
        }

        let value = serde_json::to_value(super::super::types::GlobalConfig::default())
            .expect("global config");
        let catalog = ConfigCatalog::build(&value, &value).expect("catalog");
        let formal_settings = catalog
            .settings
            .iter()
            .filter(|setting| setting.exposure == SettingExposure::Formal)
            .collect::<Vec<_>>();
        assert_eq!(formal_settings.len(), 102);
        for declaration in STABLE_SETTING_DECLARATIONS {
            let descriptor = catalog
                .find(declaration.stable_product_id)
                .expect("declared stable setting");
            assert_eq!(descriptor.storage.path, declaration.storage_path);
            assert_eq!(descriptor.exposure, declaration.exposure);
        }
    }

    #[test]
    fn stable_internal_transaction_ids_never_cross_publication_boundaries() {
        let value = serde_json::to_value(super::super::types::GlobalConfig::default())
            .expect("global config");
        let catalog = ConfigCatalog::build(&value, &value).expect("catalog");
        let development_catalog = catalog.published_for_build(None, false);
        let release_catalog = catalog.published_for_build(None, true);
        let development_values = catalog.published_snapshot_values_for_build(&value, false);
        let release_values = catalog.published_snapshot_values_for_build(&value, true);

        for setting_id in [
            SETTING_APP_TRAY_HINT_SHOWN,
            SETTING_AI_SUBAGENT_CONFIGS,
            SETTING_MCP_SERVERS,
        ] {
            let setting = catalog.find(setting_id).expect("stable Internal setting");
            assert_eq!(setting.exposure, SettingExposure::Internal, "{setting_id}");
            assert!(setting.presentation.hidden, "{setting_id}");
            assert!(!setting.ai.readable && !setting.ai.writable, "{setting_id}");
            assert!(
                development_catalog.find(setting_id).is_none(),
                "{setting_id}"
            );
            assert!(release_catalog.find(setting_id).is_none(), "{setting_id}");
            assert!(!development_values.contains_key(setting_id), "{setting_id}");
            assert!(!release_values.contains_key(setting_id), "{setting_id}");
        }

        assert_eq!(
            catalog
                .find(SETTING_MCP_SERVERS)
                .expect("MCP servers")
                .value_schema,
            serde_json::json!({
                "type": "object",
                "nullable": true,
                "properties": {},
            })
        );
    }

    #[test]
    fn managed_formal_setting_is_core_writable_but_generic_surface_read_only() {
        let value = serde_json::to_value(super::super::types::GlobalConfig::default())
            .expect("global config");
        let catalog = ConfigCatalog::build(&value, &value).expect("catalog");
        let descriptor = catalog
            .find(SETTING_AI_AGENT_CAPABILITY_CONFIGS)
            .expect("managed capability setting");

        assert_eq!(descriptor.exposure, SettingExposure::Formal);
        assert!(descriptor.presentation.hidden);
        assert!(!descriptor.ai.readable && !descriptor.ai.writable);
        assert!(!descriptor.generic_surface_writable);
        assert_eq!(descriptor.policy.mutability, SettingMutability::Writable);

        let mut changed_settings = catalog.settings.clone();
        changed_settings
            .iter_mut()
            .find(|setting| setting.id == SETTING_AI_AGENT_CAPABILITY_CONFIGS)
            .expect("managed capability setting")
            .generic_surface_writable = true;
        let changed_bytes = serde_json::to_vec(&changed_settings).expect("changed Catalog");
        let changed_version = format!("sha256:{:x}", Sha256::digest(changed_bytes));
        assert_ne!(catalog.version, changed_version);

        for release_build in [false, true] {
            let published = catalog
                .published_for_build(None, release_build)
                .find(SETTING_AI_AGENT_CAPABILITY_CONFIGS)
                .expect("published managed capability setting")
                .clone();
            assert_eq!(published.policy.mutability, SettingMutability::ReadOnly);
            assert!(serde_json::to_value(published)
                .expect("published setting")
                .get("genericSurfaceWritable")
                .is_none());
        }
    }

    #[test]
    fn web_setting_dependencies_are_explicit_formal_contracts() {
        let value = serde_json::to_value(super::super::types::GlobalConfig::default())
            .expect("global config");
        let catalog = ConfigCatalog::build(&value, &value).expect("catalog");

        // Keep this list aligned with the namespaces claimed by custom settings
        // tabs and the namespace reads/writes performed by Web UI services.
        for namespace in [
            "core.app.language",
            "core.themes",
            "core.font",
            "core.app.notifications.dialog_completion_notify",
            "core.app.notifications.enable_startup_tips",
            "core.app.tray.close_to_tray",
            "core.product_apps.bitfun_coder.debug",
            "core.editor",
            "core.app.keybindings",
            "core.ai.auto_memory.global",
            "core.ai.auto_memory.workspace",
            "core.app.host_scan",
            "core.ai.models",
            "core.ai.default_models",
            "core.ai.proxy",
            "core.ai.stream_idle_timeout_secs",
            "core.ai.skip_tool_confirmation",
            "core.ai.tool_execution_timeout_secs",
            "core.ai.tool_confirmation_timeout_secs",
            "core.ai.goal_mode.max_continuation_turns",
            "core.ai.computer_use_enabled",
            "core.ai.agent_models",
            "core.ai.func_agent_models",
            "core.app.ai_experience",
            "core.app.ai_experience.voice_input",
            "core.ai.agent_capability_configs",
            "core.terminal.default_shell",
        ] {
            let matches = catalog
                .settings
                .iter()
                .filter(|setting| {
                    setting.id == namespace
                        || setting
                            .id
                            .strip_prefix(namespace)
                            .is_some_and(|suffix| suffix.starts_with('.'))
                })
                .collect::<Vec<_>>();
            assert!(!matches.is_empty(), "missing Web setting {namespace}");
            assert!(
                matches
                    .iter()
                    .all(|setting| setting.exposure == SettingExposure::Formal),
                "Web setting namespace {namespace} contains a storage-derived Binding"
            );
        }
    }

    #[test]
    fn formal_product_identity_and_source_survive_a_storage_path_move() {
        let metadata = metadata_for("app.language");
        let original = build_descriptor(
            "app.language",
            &serde_json::json!("en-US"),
            &serde_json::json!("zh-CN"),
            true,
            None,
            metadata.clone(),
        );
        let moved = build_descriptor(
            "app.locale",
            &serde_json::json!("en-US"),
            &serde_json::json!("zh-CN"),
            true,
            None,
            metadata,
        );

        assert_eq!(original.id, "core.app.language");
        assert_eq!(moved.id, original.id);
        assert_eq!(moved.source, original.source);
        assert_eq!(original.exposure, SettingExposure::Formal);
        assert_eq!(moved.exposure, SettingExposure::Formal);
    }

    #[test]
    fn undeclared_typed_scalar_is_a_development_only_binding() {
        let value = serde_json::json!(0.9);
        let schema = serde_json::json!({ "type": "number" });
        let setting = build_descriptor(
            "terminal.transparency",
            &value,
            &value,
            true,
            Some(&schema),
            metadata_for("terminal.transparency"),
        );

        assert_eq!(setting.id, "core.terminal.transparency");
        assert_eq!(setting.exposure, SettingExposure::Binding);
        assert_eq!(setting.presentation.category_id, "advanced");
        assert_eq!(setting.presentation.tab_id, "terminal");
        assert_eq!(setting.presentation.section_id, "advanced-terminal");
        assert!(!setting.ai.readable);
        assert!(!setting.ai.writable);
        assert_eq!(setting.policy.risk, SettingRisk::Safe);
    }

    #[test]
    fn nullable_typed_scalars_keep_their_declared_schema_and_controls() {
        let defaults = serde_json::json!({
            "ai": {
                "default_models": { "primary": null },
                "stream_idle_timeout_secs": null
            }
        });
        let catalog = ConfigCatalog::build(&defaults, &defaults).expect("catalog");

        let model = catalog
            .find_by_path("ai.default_models.primary")
            .expect("default model");
        assert_eq!(model.value_schema["type"], "string");
        assert_eq!(model.value_schema["nullable"], true);
        assert_eq!(model.presentation.control, SettingControl::Select);
        assert_eq!(model.exposure, SettingExposure::Formal);
        assert!(model.ai.writable);

        let timeout = catalog
            .find_by_path("ai.stream_idle_timeout_secs")
            .expect("stream timeout");
        assert_eq!(
            timeout.value_schema,
            serde_json::json!({ "type": "integer", "nullable": true, "minimum": 1 })
        );
        assert_eq!(timeout.presentation.control, SettingControl::Number);
        assert_eq!(timeout.exposure, SettingExposure::Formal);
        assert!(timeout.ai.readable);
        assert!(timeout.ai.writable);
    }

    #[test]
    fn trusted_dynamic_providers_publish_only_current_valid_values() {
        let defaults = serde_json::to_value(super::super::types::GlobalConfig::default())
            .expect("global config");
        let mut current = defaults.clone();
        current["ai"]["models"] = serde_json::json!([
            { "id": "enabled", "name": "Enabled model", "enabled": true },
            { "id": "disabled", "name": "Disabled model", "enabled": false }
        ]);
        current["themes"]["custom"] = serde_json::json!([
            { "id": "custom-theme", "name": "Custom theme" }
        ]);

        let catalog = ConfigCatalog::build(&defaults, &current).expect("catalog");
        let primary = catalog
            .find("core.ai.default_models.primary")
            .expect("primary model");
        assert_eq!(
            primary.options_provider,
            Some(SettingOptionsProvider::EnabledAiModels)
        );
        assert_eq!(primary.presentation.control, SettingControl::Select);
        assert!(primary
            .resolved_options
            .iter()
            .any(|option| option.value == "enabled" && option.label == "Enabled model"));
        assert!(!primary
            .resolved_options
            .iter()
            .any(|option| option.value == "disabled"));

        let speech = catalog
            .find(SETTING_AI_DEFAULT_SPEECH_RECOGNITION)
            .expect("speech recognition model");
        assert_eq!(
            speech.options_provider,
            Some(SettingOptionsProvider::SpeechRecognitionTargets)
        );
        assert!(speech
            .resolved_options
            .iter()
            .any(|option| option.value == "enabled"));
        assert!(speech.resolved_options.iter().any(|option| {
            option.value == LOCAL_SENSEVOICE_SMALL_INT8_MODEL_REF
                && option.label == "SenseVoice Small INT8 (Local)"
        }));
        assert!(!speech
            .resolved_options
            .iter()
            .any(|option| option.value == "disabled"));

        let agent_models = catalog.find("core.ai.agent_models").expect("agent models");
        assert_eq!(
            agent_models.options_provider,
            Some(SettingOptionsProvider::AgentModelTargets)
        );
        assert!(agent_models
            .resolved_options
            .iter()
            .any(|option| option.value == "primary"));

        let theme = catalog.find("core.themes.current").expect("theme");
        assert_eq!(
            theme.options_provider,
            Some(SettingOptionsProvider::AvailableThemes)
        );
        assert!(theme
            .resolved_options
            .iter()
            .any(|option| option.value == "custom-theme" && option.label == "Custom theme"));

        let shell = catalog
            .find("core.terminal.default_shell")
            .expect("terminal shell");
        assert_eq!(
            shell.options_provider,
            Some(SettingOptionsProvider::AvailableTerminalShells)
        );
        assert!(shell
            .resolved_options
            .iter()
            .any(|option| option.value.is_empty()));

        let published = catalog.published(None);
        let serialized = serde_json::to_value(
            published
                .find("core.terminal.default_shell")
                .expect("published terminal shell"),
        )
        .expect("serialize shell descriptor");
        assert!(!contains_exact_string(
            &serialized,
            "terminal.default_shell"
        ));
        assert!(!serialized.to_string().to_lowercase().contains("system32"));
    }

    #[test]
    fn formal_published_metadata_requires_localized_title_and_description() {
        let mut metadata = metadata_for("app.language");
        metadata
            .presentation
            .as_mut()
            .expect("presentation")
            .description_key = None;

        let error = validate_formal_published_metadata("app.language", &metadata)
            .expect_err("formal copy is mandatory");
        assert!(error.to_string().contains("localized description"));
    }

    #[test]
    fn formal_published_metadata_requires_an_explicit_source() {
        let mut metadata = metadata_for("app.language");
        metadata.source = None;

        let error = validate_formal_published_metadata("app.language", &metadata)
            .expect_err("formal source is mandatory");
        assert!(error.to_string().contains("descriptor source"));
    }

    #[test]
    fn only_formal_settings_are_ai_accessible() {
        let value = serde_json::to_value(super::super::types::GlobalConfig::default())
            .expect("global config");
        let catalog = ConfigCatalog::build(&value, &value).expect("catalog");
        let development_catalog = catalog.published_for_build(None, false);
        let release_catalog = catalog.published_for_build(None, true);

        assert!(catalog
            .settings
            .iter()
            .any(|setting| setting.exposure == SettingExposure::Formal));
        for setting_id in [
            "core.themes.current",
            "core.font.ui_size.level",
            "core.font.ui_size.custom_px",
            "core.ai.default_models.primary",
            "core.ai.skip_tool_confirmation",
            "core.ai.computer_use_enabled",
            "core.editor.font_size",
        ] {
            let setting = catalog.find(setting_id).expect("formal product setting");
            assert_eq!(setting.exposure, SettingExposure::Formal, "{setting_id}");
            assert!(setting.ai.readable, "{setting_id}");
        }
        for setting_id in [
            "core.ai.skip_tool_confirmation",
            "core.ai.computer_use_enabled",
        ] {
            assert_eq!(
                catalog
                    .find(setting_id)
                    .expect("elevated setting")
                    .policy
                    .risk,
                SettingRisk::Elevated,
                "{setting_id}"
            );
        }
        for setting in &catalog.settings {
            if setting.ai.readable || setting.ai.writable {
                assert_eq!(setting.exposure, SettingExposure::Formal, "{}", setting.id);
            }
            match setting.exposure {
                SettingExposure::Formal => {
                    if setting.presentation.hidden {
                        assert!(
                            !setting.ai.readable && !setting.ai.writable,
                            "{}",
                            setting.id
                        );
                    } else {
                        assert!(setting.ai.readable, "{}", setting.id);
                    }
                    assert!(
                        development_catalog.find(&setting.id).is_some(),
                        "{}",
                        setting.id
                    );
                    assert!(
                        release_catalog.find(&setting.id).is_some(),
                        "{}",
                        setting.id
                    );
                }
                SettingExposure::Binding => {
                    assert!(
                        !setting.ai.readable && !setting.ai.writable,
                        "{}",
                        setting.id
                    );
                    assert!(
                        development_catalog.find(&setting.id).is_some(),
                        "{}",
                        setting.id
                    );
                    assert!(
                        release_catalog.find(&setting.id).is_none(),
                        "{}",
                        setting.id
                    );
                }
                SettingExposure::Internal => {
                    assert!(
                        !setting.ai.readable && !setting.ai.writable,
                        "{}",
                        setting.id
                    );
                    assert!(
                        development_catalog.find(&setting.id).is_none(),
                        "{}",
                        setting.id
                    );
                    assert!(
                        release_catalog.find(&setting.id).is_none(),
                        "{}",
                        setting.id
                    );
                }
            }
        }
    }

    #[test]
    fn natural_language_search_accepts_multiple_hints_and_ranks_the_best_match() {
        let value = serde_json::to_value(super::super::types::GlobalConfig::default())
            .expect("global config");
        let catalog = ConfigCatalog::build(&value, &value).expect("catalog");

        for query in ["字体 大小 font size", "字体大小"] {
            let published = catalog.published_for_build(Some(query), true);
            assert_eq!(
                published
                    .settings
                    .first()
                    .map(|setting| setting.id.as_str()),
                Some("core.font.ui_size.level"),
                "query: {query}"
            );
        }
    }

    #[test]
    fn natural_language_search_returns_no_unrelated_fallbacks() {
        let value = serde_json::to_value(super::super::types::GlobalConfig::default())
            .expect("global config");
        let catalog = ConfigCatalog::build(&value, &value).expect("catalog");

        assert!(catalog
            .published_for_build(Some("no-such-setting-concept"), true)
            .settings
            .is_empty());
    }

    #[test]
    fn companion_pet_is_one_stable_atomic_descriptor_for_none_and_some_values() {
        let defaults = super::super::types::GlobalConfig::default();
        let defaults_value = serde_json::to_value(&defaults).expect("default config");
        let mut without_pet = defaults.clone();
        without_pet.app.ai_experience.agent_companion_pet = None;
        let without_pet_value = serde_json::to_value(&without_pet).expect("config without pet");

        let with_pet_catalog =
            ConfigCatalog::build(&defaults_value, &defaults_value).expect("catalog with pet");
        let without_pet_catalog =
            ConfigCatalog::build(&defaults_value, &without_pet_value).expect("catalog without pet");
        let setting_id = "core.app.ai_experience.agent_companion_pet";

        let with_pet = with_pet_catalog
            .find(setting_id)
            .expect("atomic pet setting");
        let without_pet = without_pet_catalog
            .find(setting_id)
            .expect("atomic pet setting without value");
        assert_eq!(with_pet_catalog.version, without_pet_catalog.version);
        assert_eq!(with_pet.value_schema, without_pet.value_schema);
        assert_eq!(with_pet.value_schema["type"], serde_json::json!("object"));
        assert_eq!(with_pet.value_schema["nullable"], serde_json::json!(true));
        assert!(with_pet_catalog
            .settings
            .iter()
            .all(|setting| !setting.id.starts_with(&format!("{setting_id}."))));

        let with_values = with_pet_catalog.snapshot_values(&defaults_value);
        let without_values = without_pet_catalog.snapshot_values(&without_pet_value);
        assert!(matches!(
            &with_values[setting_id],
            ConfigStoredValue::Value { value } if value.is_object()
        ));
        assert!(matches!(
            &without_values[setting_id],
            ConfigStoredValue::Value { value } if value.is_null()
        ));

        for debug_id in [
            "core.product_apps.bitfun_coder.debug.ingest_port",
            "core.product_apps.bitfun_coder.debug.log_path",
            "core.product_apps.bitfun_coder.debug.enabled_languages",
            "core.product_apps.bitfun_coder.debug.language_templates",
        ] {
            assert!(without_pet_catalog.find(debug_id).is_some(), "{debug_id}");
        }
    }

    #[test]
    fn custom_tab_claimed_settings_are_formal_and_release_published() {
        let defaults = serde_json::json!({
            "font": { "flowChat": { "mode": "sync" } },
            "ai": { "auto_memory": { "global": { "enabled": true } } },
            "app": { "host_scan": { "auto_scan_enabled": true } }
        });
        let catalog = ConfigCatalog::build(&defaults, &defaults).expect("catalog");

        for (path, id) in [
            ("font.flowChat.mode", "core.font.flow_chat.mode"),
            (
                "ai.auto_memory.global.enabled",
                "core.ai.auto_memory.global.enabled",
            ),
            (
                "app.host_scan.auto_scan_enabled",
                "core.app.host_scan.auto_scan_enabled",
            ),
        ] {
            let setting = catalog.find_by_path(path).expect("formal setting");
            assert_eq!(setting.id, id);
            assert_eq!(setting.exposure, SettingExposure::Formal, "path {path}");
            assert!(!setting.presentation.hidden, "path {path}");
            assert!(setting.ai.readable, "path {path}");
            assert!(
                catalog.published_for_build(None, true).find(id).is_some(),
                "path {path}"
            );
        }
        assert_eq!(
            catalog
                .find_by_path("app.host_scan.auto_scan_enabled")
                .expect("host scan")
                .policy
                .apply_strategy,
            ConfigApplyStrategy::Adapter
        );
    }

    #[test]
    fn undeclared_runtime_fields_are_hidden_and_ai_inaccessible() {
        let defaults = serde_json::json!({
            "feature": {
                "rules": [{ "name": "one" }],
                "credentials": { "api_key": "secret", "region": "us" }
            }
        });
        let catalog = ConfigCatalog::build(&defaults, &defaults).expect("catalog");
        let rules = catalog.find_by_path("feature.rules").expect("rules");
        let api_key = catalog
            .find_by_path("feature.credentials.api_key")
            .expect("api key");

        assert_eq!(rules.exposure, SettingExposure::Internal);
        assert_eq!(api_key.exposure, SettingExposure::Internal);
        assert!(rules.presentation.hidden && !rules.ai.readable);
        assert!(api_key.presentation.hidden && !api_key.ai.readable);
        assert!(!rules.ai.writable && !api_key.ai.writable);
        assert_eq!(api_key.policy.sensitivity, SettingSensitivity::Secret);
        assert!(matches!(
            catalog.snapshot_values(&defaults)[&api_key.id],
            ConfigStoredValue::Secret {
                configured: true,
                ..
            }
        ));
    }

    #[test]
    fn credential_maps_redact_arbitrary_children_and_preserve_ordinary_maps() {
        use std::collections::HashMap;

        let mut config = super::super::types::GlobalConfig::default();
        config.ai.models.push(super::super::types::AIModelConfig {
            id: "model-one".to_string(),
            custom_headers: Some(HashMap::from([
                ("X-Custom".to_string(), "model-custom-secret".to_string()),
                (
                    "Authorization".to_string(),
                    "Bearer model-authorized-secret".to_string(),
                ),
            ])),
            metadata: Some(serde_json::json!({
                "labels": { "FOO": "ordinary-model-metadata" }
            })),
            ..super::super::types::AIModelConfig::default()
        });
        config.mcp_servers = Some(serde_json::json!({
            "mcpServers": {
                "private": {
                    "enabled": true,
                    "env": { "FOO": "mcp-env-secret" },
                    "headers": {
                        "Cookie": "mcp-cookie-secret",
                        "Authorization": "Bearer mcp-authorized-secret"
                    }
                }
            }
        }));
        let current = serde_json::to_value(&config).expect("global config");
        let defaults = serde_json::to_value(super::super::types::GlobalConfig::default())
            .expect("default global config");
        let catalog = ConfigCatalog::build(&defaults, &current).expect("catalog");

        let model_descriptor = catalog.find_by_path("ai.models").expect("models");
        let model_value = match catalog.snapshot_values(&current)[&model_descriptor.id].clone() {
            ConfigStoredValue::Value { value } => value,
            other => panic!("expected private model projection, received {other:?}"),
        };
        assert_eq!(
            model_value.pointer("/0/custom_headers"),
            Some(&serde_json::json!({ "configured": true }))
        );
        assert_eq!(
            model_value.pointer("/0/metadata/labels/FOO"),
            Some(&Value::String("ordinary-model-metadata".to_string()))
        );

        let mcp_descriptor = catalog.find_by_path("mcp_servers").expect("MCP servers");
        let mcp_value = match catalog.snapshot_values(&current)[&mcp_descriptor.id].clone() {
            ConfigStoredValue::Value { value } => value,
            other => panic!("expected private MCP projection, received {other:?}"),
        };
        assert_eq!(
            mcp_value.pointer("/mcpServers/private/env"),
            Some(&serde_json::json!({ "configured": true }))
        );
        assert_eq!(
            mcp_value.pointer("/mcpServers/private/headers"),
            Some(&serde_json::json!({ "configured": true }))
        );

        let serialized = serde_json::to_string(&(model_value.clone(), mcp_value.clone()))
            .expect("serialize redacted values");
        for secret in [
            "model-custom-secret",
            "model-authorized-secret",
            "mcp-env-secret",
            "mcp-cookie-secret",
            "mcp-authorized-secret",
        ] {
            assert!(!serialized.contains(secret));
        }

        let resolved_models =
            resolve_config_write_value(model_descriptor, &current["ai"]["models"], &model_value)
                .expect("resolve model placeholders");
        assert_eq!(
            resolved_models.pointer("/0/custom_headers/X-Custom"),
            Some(&Value::String("model-custom-secret".to_string()))
        );
        let resolved_mcp =
            resolve_config_write_value(mcp_descriptor, &current["mcp_servers"], &mcp_value)
                .expect("resolve MCP placeholders");
        assert_eq!(
            resolved_mcp.pointer("/mcpServers/private/env/FOO"),
            Some(&Value::String("mcp-env-secret".to_string()))
        );
        assert_eq!(
            resolved_mcp.pointer("/mcpServers/private/headers/Cookie"),
            Some(&Value::String("mcp-cookie-secret".to_string()))
        );
    }

    #[test]
    fn nullable_secret_containers_preserve_null_and_require_explicit_clear_markers() {
        let current = serde_json::json!({ "Authorization": "Bearer secret" });

        assert_eq!(
            resolve_secret_value(Some(&current), &Value::Null).expect("nullable secret"),
            Value::Null
        );
        assert_eq!(
            resolve_secret_value(Some(&current), &serde_json::json!({ "clear": true }))
                .expect("explicit clear"),
            serde_json::json!({})
        );
    }

    #[test]
    fn release_catalog_contains_only_formal_descriptors_without_storage_routes() {
        let defaults = serde_json::json!({
            "font": { "flowChat": { "mode": "sync" } },
            "terminal": { "transparency": 0.9 },
            "feature": { "rules": [{ "name": "one" }] }
        });
        let catalog = ConfigCatalog::build(&defaults, &defaults).expect("catalog");

        let release_catalog = catalog.published_for_build(None, true);
        let formal = release_catalog
            .find("core.font.flow_chat.mode")
            .expect("release Formal setting");
        let serialized = serde_json::to_value(formal).expect("published descriptor");

        assert!(serialized.get("storage").is_none());
        assert_eq!(serialized["exposure"], serde_json::json!("formal"));
        assert!(!serialized.to_string().contains("font.flowChat.mode"));
        assert!(release_catalog
            .settings
            .iter()
            .all(|setting| setting.exposure == SettingExposure::Formal));
        for setting in &release_catalog.settings {
            let internal = catalog.find(&setting.id).expect("internal descriptor");
            let serialized = serde_json::to_value(setting).expect("published descriptor");
            assert!(
                !contains_exact_string(&serialized, &internal.storage.path),
                "published setting {} exposed its storage path",
                setting.id
            );
        }
        assert!(catalog
            .published_for_build(Some("font.flowChat.mode"), true)
            .settings
            .is_empty());

        let release_values = catalog.published_snapshot_values_for_build(&defaults, true);
        let development_values = catalog.published_snapshot_values_for_build(&defaults, false);
        let internal_rules = catalog
            .find_by_path("feature.rules")
            .expect("internal rules");
        assert!(release_values.contains_key("core.font.flow_chat.mode"));
        assert!(!release_values.contains_key(&internal_rules.id));
        assert!(!development_values.contains_key(&internal_rules.id));
    }

    #[test]
    fn sensitive_control_and_port_paths_are_elevated() {
        let defaults = serde_json::json!({
            "ai": {
                "computer_use_enabled": false,
                "skip_tool_confirmation": false
            },
            "security": { "permission_mode": "prompt" },
            "server": { "adminPort": 9000 }
        });
        let catalog = ConfigCatalog::build(&defaults, &defaults).expect("catalog");

        for path in [
            "ai.computer_use_enabled",
            "ai.skip_tool_confirmation",
            "security.permission_mode",
            "server.adminPort",
        ] {
            assert_eq!(
                catalog.find_by_path(path).expect("elevated").policy.risk,
                SettingRisk::Elevated,
                "path {path}"
            );
        }
    }

    #[test]
    fn dynamic_leaf_schema_uses_current_value_when_no_default_exists() {
        let defaults = serde_json::json!({ "dynamic": {} });
        let current = serde_json::json!({ "dynamic": { "key": "value" } });
        let catalog = ConfigCatalog::build(&defaults, &current).expect("catalog");
        let setting = catalog
            .settings
            .iter()
            .find(|setting| setting.storage.path == "dynamic.key")
            .expect("dynamic leaf");
        assert_eq!(
            setting.value_schema,
            serde_json::json!({ "type": "string" })
        );
    }

    #[test]
    fn adapter_strategy_metadata_excludes_unrelated_paths() {
        let value = serde_json::json!({
            "app": {
                "logging": { "level": "info" },
                "host_scan": { "auto_scan_enabled": true },
                "unhandled_port": 9000
            },
            "terminal": { "default_shell": "pwsh" },
            "ai": { "models": [] }
        });
        let catalog = ConfigCatalog::build(&value, &value).expect("catalog");

        for path in [
            "app.logging.level",
            "app.host_scan.auto_scan_enabled",
            "ai.models",
        ] {
            assert_eq!(
                catalog
                    .find_by_path(path)
                    .expect("adapter descriptor")
                    .policy
                    .apply_strategy,
                ConfigApplyStrategy::Adapter
            );
        }
        for path in ["app.unhandled_port", "terminal.default_shell"] {
            assert_eq!(
                catalog
                    .find_by_path(path)
                    .expect("reactive descriptor")
                    .policy
                    .apply_strategy,
                ConfigApplyStrategy::Reactive
            );
        }
    }

    #[test]
    fn ai_proxy_password_remains_an_adapter_secret() {
        let value = serde_json::json!({
            "ai": { "proxy": { "password": "secret" } }
        });
        let catalog = ConfigCatalog::build(&value, &value).expect("catalog");
        let password = catalog
            .find_by_path("ai.proxy.password")
            .expect("proxy password");
        assert_eq!(password.policy.sensitivity, SettingSensitivity::Secret);
        assert_eq!(password.policy.apply_strategy, ConfigApplyStrategy::Adapter);
        assert!(!password.ai.writable);
    }

    #[test]
    fn global_catalog_has_only_the_themes_source_of_truth() {
        let value = serde_json::to_value(super::super::types::GlobalConfig::default())
            .expect("global config");
        let catalog = ConfigCatalog::build(&value, &value).expect("catalog");

        assert!(catalog.find_by_path("theme.id").is_none());
        assert!(catalog.find_by_path("themes.current").is_some());
    }

    #[test]
    fn global_catalog_has_no_generic_application_settings_tab() {
        let value = serde_json::to_value(super::super::types::GlobalConfig::default())
            .expect("global config");
        let catalog = ConfigCatalog::build(&value, &value).expect("catalog");

        assert!(catalog
            .settings
            .iter()
            .filter(|setting| !setting.presentation.hidden)
            .all(|setting| setting.presentation.tab_id != "app"));
    }

    #[test]
    fn global_typed_schema_derives_scalar_enum_array_map_and_object_descriptors() {
        let value = serde_json::to_value(super::super::types::GlobalConfig::default())
            .expect("global config");
        let catalog = ConfigCatalog::build(&value, &value).expect("catalog");

        let scalar = catalog.find_by_path("editor.line_height").expect("scalar");
        assert_eq!(scalar.value_schema["type"], "number");
        assert_eq!(scalar.presentation.control, SettingControl::Number);

        let models = catalog.find_by_path("ai.models").expect("model array");
        assert_eq!(models.value_schema["type"], "array");
        assert_eq!(models.presentation.control, SettingControl::Custom);
        assert!(
            models.value_schema["items"]["properties"]["category"]["enum"]
                .as_array()
                .is_some_and(|values| values.contains(&serde_json::json!("general_chat")))
        );
        assert_eq!(models.policy.sensitivity, SettingSensitivity::Private);

        let map = catalog.find_by_path("ai.agent_models").expect("typed map");
        assert_eq!(map.value_schema["type"], "object");
        assert_eq!(map.value_schema["additionalProperties"]["type"], "string");
        assert_eq!(map.presentation.control, SettingControl::Custom);

        let object = catalog.find_by_path("mcp_servers").expect("object");
        assert_eq!(object.value_schema["type"], "object");
        assert_eq!(object.presentation.control, SettingControl::Custom);
    }

    #[test]
    fn documented_unit_enum_normalizes_to_a_select_schema() {
        let schema = serde_json::json!({
            "oneOf": [
                { "type": "string", "const": "first", "description": "First value" },
                { "type": "string", "const": "second", "description": "Second value" }
            ]
        });
        let normalized = normalize_typed_schema(&schema, &schema).expect("normalize enum");

        assert_eq!(normalized["type"], "string");
        assert_eq!(normalized["enum"], serde_json::json!(["first", "second"]));
        assert!(normalized.get("oneOf").is_none());
        assert_eq!(
            control_for(
                &Value::String("first".to_string()),
                &Value::String("first".to_string()),
                &normalized,
            ),
            SettingControl::Select
        );
    }

    #[test]
    fn builtin_product_app_debug_expands_but_undeclared_values_stay_internal() {
        let defaults = serde_json::to_value(super::super::types::GlobalConfig::default())
            .expect("global config");
        let mut current = defaults.clone();
        current["product_apps"]["apps"]["builtin-bitfun-coder"]
            .as_object_mut()
            .expect("built-in product app config")
            .insert("future_toggle".to_string(), Value::Bool(true));

        let catalog = ConfigCatalog::build(&defaults, &current).expect("catalog");
        let debug = catalog
            .find_by_path("product_apps.apps.builtin-bitfun-coder.debug.ingest_port")
            .expect("typed built-in debug setting");
        assert_eq!(debug.exposure, SettingExposure::Formal);
        assert!(debug.ai.readable && debug.ai.writable);
        assert_eq!(debug.source, SettingDescriptorSource::Core);

        let dynamic = catalog
            .find_by_path("product_apps.apps.builtin-bitfun-coder.future_toggle")
            .expect("undeclared dynamic value");
        assert_eq!(dynamic.exposure, SettingExposure::Internal);
        assert!(dynamic.presentation.hidden);
        assert!(!dynamic.ai.readable && !dynamic.ai.writable);
        assert_eq!(
            dynamic.source,
            SettingDescriptorSource::Runtime {
                provider_id: "global-config-runtime".to_string()
            }
        );
    }
}
