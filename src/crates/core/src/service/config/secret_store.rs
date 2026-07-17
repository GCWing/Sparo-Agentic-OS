//! Encrypted storage for configuration secrets.
//!
//! Runtime configuration keeps resolved values in memory. The ordinary
//! `app.json` persists opaque references only; encrypted material lives under
//! the application secrets directory.

use super::atomic_store;
use super::secret_classification::ConfigSecretPath;
use super::types::GlobalConfig;
use crate::error::{CoreError, CoreResult};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

const REFERENCE_PREFIX: &str = "sparo-secret://config/";
const JOURNAL_PREFIX: &str = "sparo-config-journal:v1:";
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultFile {
    version: u8,
    entries: BTreeMap<String, String>,
}

impl ConfigSecretStore {
    async fn load_vault_or_default(&self) -> CoreResult<VaultFile> {
        if self.vault_path.exists() {
            self.load_vault().await
        } else {
            Ok(VaultFile {
                version: vault_version(),
                entries: BTreeMap::new(),
            })
        }
    }
}

const fn vault_version() -> u8 {
    1
}

pub(crate) struct StagedConfigSecrets {
    pub persisted_config: GlobalConfig,
    active_references: BTreeSet<String>,
}

pub(crate) struct ConfigSecretStore {
    // Stored separately from app.json.
    key_path: PathBuf,
    vault_path: PathBuf,
}

impl ConfigSecretStore {
    pub(crate) fn new(secrets_dir: &Path) -> Self {
        Self {
            key_path: secrets_dir.join(".config_secrets.key"),
            vault_path: secrets_dir.join("config_secrets.json"),
        }
    }

    /// Resolves persisted encrypted references. Non-empty sensitive values in
    /// `app.json` must be references; plaintext is an invalid storage format.
    pub(crate) async fn resolve(&self, config: &mut GlobalConfig) -> CoreResult<()> {
        let mut config_value = serde_json::to_value(&*config).map_err(|error| {
            CoreError::config(format!("Failed to inspect configuration secrets: {error}"))
        })?;
        let root_path = ConfigSecretPath::root();
        let has_references = contains_sensitive_reference(&config_value, &root_path);
        let vault = if has_references {
            Some(self.load_vault().await?)
        } else {
            None
        };
        let key = if has_references {
            Some(self.read_key().await?)
        } else {
            None
        };
        resolve_sensitive_values(&mut config_value, &root_path, vault.as_ref(), key.as_ref())?;
        *config = serde_json::from_value(config_value).map_err(|error| {
            CoreError::config(format!(
                "Failed to restore resolved configuration secrets: {error}"
            ))
        })?;
        Ok(())
    }

    /// Removes secret material owned exclusively by the discarded config.
    pub(crate) async fn clear(&self) -> CoreResult<()> {
        for path in [&self.vault_path, &self.key_path] {
            match tokio::fs::remove_file(path).await {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(CoreError::config(format!(
                        "Failed to remove obsolete config secret storage: {error}"
                    )));
                }
            }
        }
        Ok(())
    }

    /// Stages encrypted entries before `app.json` is replaced. Existing entries
    /// remain until the caller confirms the config write.
    pub(crate) async fn stage(&self, config: &GlobalConfig) -> CoreResult<StagedConfigSecrets> {
        let mut persisted_value = serde_json::to_value(config).map_err(|error| {
            CoreError::config(format!("Failed to inspect configuration secrets: {error}"))
        })?;
        let root_path = ConfigSecretPath::root();
        let has_secrets = contains_sensitive_nonempty_string(&persisted_value, &root_path);
        if !has_secrets {
            return Ok(StagedConfigSecrets {
                persisted_config: config.clone(),
                active_references: BTreeSet::new(),
            });
        }

        let key = self.ensure_key().await?;
        let mut vault = self.load_vault_or_default().await?;
        let mut active_references = BTreeSet::new();
        externalize_sensitive_values(
            &mut persisted_value,
            &root_path,
            &key,
            &mut vault,
            &mut active_references,
        )?;
        let persisted_config = serde_json::from_value(persisted_value).map_err(|error| {
            CoreError::config(format!(
                "Failed to stage externalized configuration secrets: {error}"
            ))
        })?;
        self.write_vault(&vault).await?;
        Ok(StagedConfigSecrets {
            persisted_config,
            active_references,
        })
    }

    pub(crate) async fn finalize(&self, staged: &StagedConfigSecrets) -> CoreResult<()> {
        if !self.vault_path.exists() {
            return Ok(());
        }
        let mut vault = self.load_vault().await?;
        vault
            .entries
            .retain(|reference, _| staged.active_references.contains(reference));
        self.write_vault(&vault).await
    }

    pub(crate) fn clear_for_export(&self, config: &mut GlobalConfig) -> CoreResult<()> {
        let mut value = serde_json::to_value(&*config).map_err(|error| {
            CoreError::config(format!("Failed to sanitize configuration export: {error}"))
        })?;
        clear_sensitive_strings(&mut value, &ConfigSecretPath::root());
        *config = serde_json::from_value(value).map_err(|error| {
            CoreError::config(format!(
                "Failed to rebuild sanitized configuration export: {error}"
            ))
        })?;
        Ok(())
    }

    /// Restores credentials intentionally redacted by [`Self::clear_for_export`]
    /// from the current in-memory snapshot. Import uses the same trusted secret
    /// classifier as persistence and export instead of field-specific patches.
    pub(crate) fn restore_redacted_for_import(
        &self,
        imported: &mut GlobalConfig,
        current: &GlobalConfig,
    ) -> CoreResult<()> {
        let mut imported_value = serde_json::to_value(&*imported).map_err(|error| {
            CoreError::config(format!("Failed to inspect imported secrets: {error}"))
        })?;
        let current_value = serde_json::to_value(current).map_err(|error| {
            CoreError::config(format!("Failed to inspect current secrets: {error}"))
        })?;
        restore_redacted_sensitive_strings(
            &mut imported_value,
            &current_value,
            &ConfigSecretPath::root(),
        );
        *imported = serde_json::from_value(imported_value).map_err(|error| {
            CoreError::config(format!("Failed to restore imported secrets: {error}"))
        })?;
        Ok(())
    }

    /// Seals the durable transaction journal before it is embedded in app.json.
    /// Raw rollback values can contain credentials, so this payload must never
    /// be persisted as ordinary JSON.
    pub(crate) async fn seal_journal<T: Serialize>(&self, journal: &T) -> CoreResult<String> {
        let plaintext = serde_json::to_string(journal).map_err(|error| {
            CoreError::config(format!(
                "Failed to serialize config transaction journal: {error}"
            ))
        })?;
        let key = self.ensure_key().await?;
        Ok(format!(
            "{JOURNAL_PREFIX}{}",
            encrypt_value(&key, &plaintext)?
        ))
    }

    /// Opens and authenticates the transaction journal stored in app.json.
    pub(crate) async fn open_journal<T: DeserializeOwned>(&self, sealed: &str) -> CoreResult<T> {
        let encrypted = sealed.strip_prefix(JOURNAL_PREFIX).ok_or_else(|| {
            CoreError::config("Config transaction journal has an unsupported format")
        })?;
        let key = self.read_key().await?;
        let plaintext = decrypt_value(&key, encrypted)?;
        serde_json::from_str(&plaintext).map_err(|error| {
            CoreError::config(format!("Invalid config transaction journal: {error}"))
        })
    }

    async fn ensure_key(&self) -> CoreResult<Vec<u8>> {
        if self.key_path.exists() {
            return self.read_key().await;
        }
        let parent = self
            .key_path
            .parent()
            .ok_or_else(|| CoreError::config("Config secret key path has no parent"))?;
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            CoreError::config(format!(
                "Failed to create config secrets directory '{}': {error}",
                parent.display()
            ))
        })?;

        let mut key = vec![0_u8; KEY_LEN];
        rand::rngs::OsRng.fill_bytes(&mut key);
        let mut file = match tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&self.key_path)
            .await
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return self.read_key().await;
            }
            Err(error) => {
                return Err(CoreError::config(format!(
                    "Failed to create config secret key '{}': {error}",
                    self.key_path.display()
                )));
            }
        };
        file.write_all(&key).await.map_err(|error| {
            CoreError::config(format!("Failed to write config secret key: {error}"))
        })?;
        file.flush().await.map_err(|error| {
            CoreError::config(format!("Failed to flush config secret key: {error}"))
        })?;
        file.sync_all().await.map_err(|error| {
            CoreError::config(format!("Failed to sync config secret key: {error}"))
        })?;
        drop(file);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&self.key_path, std::fs::Permissions::from_mode(0o600))
                .await
                .map_err(|error| {
                    CoreError::config(format!(
                        "Failed to restrict config secret key permissions: {error}"
                    ))
                })?;
        }
        Ok(key)
    }

    async fn read_key(&self) -> CoreResult<Vec<u8>> {
        let key = tokio::fs::read(&self.key_path).await.map_err(|error| {
            CoreError::config(format!(
                "Failed to read config secret key '{}': {error}",
                self.key_path.display()
            ))
        })?;
        if key.len() != KEY_LEN {
            return Err(CoreError::config("Config secret key has an invalid length"));
        }
        Ok(key)
    }

    async fn load_vault(&self) -> CoreResult<VaultFile> {
        let bytes = tokio::fs::read(&self.vault_path).await.map_err(|error| {
            CoreError::config(format!(
                "Failed to read config secret vault '{}': {error}",
                self.vault_path.display()
            ))
        })?;
        let vault: VaultFile = serde_json::from_slice(&bytes)
            .map_err(|error| CoreError::config(format!("Invalid config secret vault: {error}")))?;
        if vault.version != vault_version() {
            return Err(CoreError::config(format!(
                "Unsupported config secret vault version {}",
                vault.version
            )));
        }
        Ok(vault)
    }

    async fn write_vault(&self, vault: &VaultFile) -> CoreResult<()> {
        let bytes = serde_json::to_vec_pretty(vault).map_err(|error| {
            CoreError::config(format!("Failed to serialize config secret vault: {error}"))
        })?;
        atomic_store::write_atomic(&self.vault_path, &bytes).await
    }
}

fn is_reference(value: &str) -> bool {
    value.starts_with(REFERENCE_PREFIX)
}

fn contains_sensitive_reference(value: &Value, path: &ConfigSecretPath) -> bool {
    match value {
        Value::String(value) => path.is_sensitive() && is_reference(value),
        Value::Array(values) => values
            .iter()
            .any(|value| contains_sensitive_reference(value, path)),
        Value::Object(object) => object
            .iter()
            .any(|(key, value)| contains_sensitive_reference(value, &path.child(key))),
        _ => false,
    }
}

fn contains_sensitive_nonempty_string(value: &Value, path: &ConfigSecretPath) -> bool {
    match value {
        Value::String(value) => path.is_sensitive() && !value.is_empty(),
        Value::Array(values) => values
            .iter()
            .any(|value| contains_sensitive_nonempty_string(value, path)),
        Value::Object(object) => object
            .iter()
            .any(|(key, value)| contains_sensitive_nonempty_string(value, &path.child(key))),
        _ => false,
    }
}

fn clear_sensitive_strings(value: &mut Value, path: &ConfigSecretPath) {
    match value {
        Value::String(value) if path.is_sensitive() => value.clear(),
        Value::Array(values) => {
            for value in values {
                clear_sensitive_strings(value, path);
            }
        }
        Value::Object(object) => {
            for (field, value) in object {
                clear_sensitive_strings(value, &path.child(field));
            }
        }
        _ => {}
    }
}

fn restore_redacted_sensitive_strings(
    imported: &mut Value,
    current: &Value,
    path: &ConfigSecretPath,
) {
    match imported {
        Value::String(imported_value) if path.is_sensitive() && imported_value.is_empty() => {
            if let Some(current_value) = current.as_str().filter(|value| !value.is_empty()) {
                *imported_value = current_value.to_string();
            }
        }
        Value::Array(imported_values) => {
            let current_values = current.as_array();
            for (index, imported_value) in imported_values.iter_mut().enumerate() {
                let Some(current_value) =
                    current_values.and_then(|values| match array_item_identity(imported_value) {
                        Some(identity) => values
                            .iter()
                            .find(|candidate| array_item_identity(candidate) == Some(identity)),
                        None => values.get(index),
                    })
                else {
                    continue;
                };
                restore_redacted_sensitive_strings(imported_value, current_value, path);
            }
        }
        Value::Object(imported_object) => {
            let Some(current_object) = current.as_object() else {
                return;
            };
            for (field, imported_value) in imported_object {
                let Some(current_value) = current_object.get(field) else {
                    continue;
                };
                restore_redacted_sensitive_strings(
                    imported_value,
                    current_value,
                    &path.child(field),
                );
            }
        }
        _ => {}
    }
}

fn array_item_identity(value: &Value) -> Option<&str> {
    value.get("id").and_then(Value::as_str)
}

fn resolve_sensitive_values(
    value: &mut Value,
    path: &ConfigSecretPath,
    vault: Option<&VaultFile>,
    key: Option<&Vec<u8>>,
) -> CoreResult<()> {
    match value {
        Value::String(value) if path.is_sensitive() => {
            resolve_value(value, vault, key)?;
        }
        Value::Array(values) => {
            for value in values {
                resolve_sensitive_values(value, path, vault, key)?;
            }
        }
        Value::Object(object) => {
            for (field, value) in object {
                resolve_sensitive_values(value, &path.child(field), vault, key)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn externalize_sensitive_values(
    value: &mut Value,
    path: &ConfigSecretPath,
    key: &[u8],
    vault: &mut VaultFile,
    active_references: &mut BTreeSet<String>,
) -> CoreResult<()> {
    match value {
        Value::String(value) if path.is_sensitive() => {
            externalize_value(value, key, vault, active_references)?;
        }
        Value::Array(values) => {
            for value in values {
                externalize_sensitive_values(value, path, key, vault, active_references)?;
            }
        }
        Value::Object(object) => {
            for (field, value) in object {
                externalize_sensitive_values(
                    value,
                    &path.child(field),
                    key,
                    vault,
                    active_references,
                )?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn resolve_value(
    value: &mut String,
    vault: Option<&VaultFile>,
    key: Option<&Vec<u8>>,
) -> CoreResult<()> {
    if value.is_empty() {
        return Ok(());
    }
    if !is_reference(value) {
        return Err(CoreError::config(
            "Sensitive configuration values must use encrypted vault references",
        ));
    }
    let encrypted = vault
        .and_then(|vault| vault.entries.get(value))
        .ok_or_else(|| CoreError::config("Config secret reference is missing from the vault"))?;
    let key = key.ok_or_else(|| CoreError::config("Config secret key is unavailable"))?;
    *value = decrypt_value(key, encrypted)?;
    Ok(())
}

fn externalize_value(
    value: &mut String,
    key: &[u8],
    vault: &mut VaultFile,
    active_references: &mut BTreeSet<String>,
) -> CoreResult<()> {
    if value.is_empty() {
        return Ok(());
    }
    let reference = format!("{REFERENCE_PREFIX}{}", uuid::Uuid::new_v4());
    let encrypted = encrypt_value(key, value)?;
    vault.entries.insert(reference.clone(), encrypted);
    active_references.insert(reference.clone());
    *value = reference;
    Ok(())
}

fn encrypt_value(key: &[u8], plaintext: &str) -> CoreResult<String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| CoreError::config("Failed to initialize config secret cipher"))?;
    let mut nonce_bytes = [0_u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_bytes())
        .map_err(|_| CoreError::config("Failed to encrypt configuration secret"))?;
    let mut payload = nonce_bytes.to_vec();
    payload.extend(ciphertext);
    Ok(B64.encode(payload))
}

fn decrypt_value(key: &[u8], encrypted: &str) -> CoreResult<String> {
    let payload = B64
        .decode(encrypted)
        .map_err(|_| CoreError::config("Config secret vault entry is not valid base64"))?;
    if payload.len() <= NONCE_LEN {
        return Err(CoreError::config("Config secret vault entry is truncated"));
    }
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| CoreError::config("Failed to initialize config secret cipher"))?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&payload[..NONCE_LEN]),
            &payload[NONCE_LEN..],
        )
        .map_err(|_| CoreError::config("Failed to decrypt configuration secret"))?;
    String::from_utf8(plaintext)
        .map_err(|_| CoreError::config("Decrypted configuration secret is not valid UTF-8"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::config::types::{AIModelConfig, ProductAppConfig};
    use std::collections::HashMap;

    #[tokio::test]
    async fn externalizes_and_resolves_configuration_secrets() {
        let temp = tempfile::tempdir().expect("temp directory");
        let store = ConfigSecretStore::new(temp.path());
        let mut config = GlobalConfig::default();
        config.ai.models.push(AIModelConfig {
            id: "model-one".to_string(),
            api_key: "plain-api-key".to_string(),
            custom_headers: Some(HashMap::from([
                ("X-Custom".to_string(), "plain-custom-header".to_string()),
                (
                    "Authorization".to_string(),
                    "Bearer plain-model-token".to_string(),
                ),
            ])),
            ..AIModelConfig::default()
        });
        config.ai.proxy.password = Some("plain-proxy-password".to_string());
        config.mcp_servers = Some(serde_json::json!({
            "mcpServers": {
                "private": {
                    "env": { "FOO": "plain-mcp-env" },
                    "headers": {
                        "Cookie": "plain-mcp-cookie",
                        "Authorization": "Bearer plain-mcp-token"
                    }
                }
            }
        }));
        config.product_apps.apps.insert(
            "ordinary".to_string(),
            ProductAppConfig {
                extra: HashMap::from([
                    (
                        "env".to_string(),
                        serde_json::json!({ "FOO": "ordinary-env" }),
                    ),
                    (
                        "headers".to_string(),
                        serde_json::json!({ "X-Custom": "ordinary-header" }),
                    ),
                ]),
                ..ProductAppConfig::default()
            },
        );

        let staged = store.stage(&config).await.expect("stage secrets");
        let persisted = serde_json::to_string(&staged.persisted_config).expect("serialize");
        assert!(!persisted.contains("plain-api-key"));
        assert!(!persisted.contains("plain-custom-header"));
        assert!(!persisted.contains("plain-model-token"));
        assert!(!persisted.contains("plain-proxy-password"));
        assert!(!persisted.contains("plain-mcp-env"));
        assert!(!persisted.contains("plain-mcp-cookie"));
        assert!(!persisted.contains("plain-mcp-token"));
        assert!(persisted.contains("ordinary-env"));
        assert!(persisted.contains("ordinary-header"));
        assert!(persisted.contains(REFERENCE_PREFIX));
        store.finalize(&staged).await.expect("finalize secrets");

        let mut loaded = staged.persisted_config;
        store.resolve(&mut loaded).await.expect("resolve secrets");
        assert_eq!(loaded.ai.models[0].api_key, "plain-api-key");
        assert_eq!(
            loaded.ai.models[0]
                .custom_headers
                .as_ref()
                .and_then(|headers| headers.get("X-Custom"))
                .map(String::as_str),
            Some("plain-custom-header")
        );
        assert_eq!(
            loaded.ai.proxy.password.as_deref(),
            Some("plain-proxy-password")
        );
        assert_eq!(
            loaded
                .mcp_servers
                .as_ref()
                .and_then(|value| value.pointer("/mcpServers/private/env/FOO"))
                .and_then(Value::as_str),
            Some("plain-mcp-env")
        );
        assert_eq!(
            loaded
                .mcp_servers
                .as_ref()
                .and_then(|value| value.pointer("/mcpServers/private/headers/Cookie"))
                .and_then(Value::as_str),
            Some("plain-mcp-cookie")
        );
        assert_eq!(
            loaded
                .mcp_servers
                .as_ref()
                .and_then(|value| value.pointer("/mcpServers/private/headers/Authorization"))
                .and_then(Value::as_str),
            Some("Bearer plain-mcp-token")
        );
    }

    #[tokio::test]
    async fn rejects_plaintext_secrets_in_persisted_configuration() {
        let temp = tempfile::tempdir().expect("temp directory");
        let store = ConfigSecretStore::new(temp.path());
        let mut config = GlobalConfig::default();
        config.ai.models.push(AIModelConfig {
            id: "model-one".to_string(),
            api_key: "must-not-be-plaintext".to_string(),
            ..AIModelConfig::default()
        });

        let error = store
            .resolve(&mut config)
            .await
            .expect_err("plaintext persisted secret must fail");

        assert!(error
            .to_string()
            .contains("must use encrypted vault references"));
    }

    #[tokio::test]
    async fn rejects_plaintext_in_structural_credential_maps() {
        let temp = tempfile::tempdir().expect("temp directory");
        let store = ConfigSecretStore::new(temp.path());
        let mut config = GlobalConfig::default();
        config.ai.models.push(AIModelConfig {
            id: "model-one".to_string(),
            custom_headers: Some(HashMap::from([(
                "X-Custom".to_string(),
                "must-not-be-plaintext".to_string(),
            )])),
            ..AIModelConfig::default()
        });

        let error = store
            .resolve(&mut config)
            .await
            .expect_err("plaintext credential-map value must fail");

        assert!(error
            .to_string()
            .contains("must use encrypted vault references"));
    }

    #[test]
    fn export_sanitization_clears_typed_and_dynamic_secrets() {
        let temp = tempfile::tempdir().expect("temp directory");
        let store = ConfigSecretStore::new(temp.path());
        let mut config = GlobalConfig::default();
        config.ai.models.push(AIModelConfig {
            id: "model-one".to_string(),
            api_key: "plain-api-key".to_string(),
            custom_headers: Some(HashMap::from([(
                "X-Custom".to_string(),
                "plain-custom-header".to_string(),
            )])),
            ..AIModelConfig::default()
        });
        config.mcp_servers = Some(serde_json::json!({
            "env": { "FOO": "plain-mcp-env" },
            "headers": {
                "Cookie": "plain-mcp-cookie",
                "Authorization": "Bearer plain-mcp-token"
            }
        }));

        store
            .clear_for_export(&mut config)
            .expect("sanitize export");

        assert!(config.ai.models[0].api_key.is_empty());
        assert_eq!(
            config.ai.models[0]
                .custom_headers
                .as_ref()
                .and_then(|headers| headers.get("X-Custom"))
                .map(String::as_str),
            Some("")
        );
        assert_eq!(
            config
                .mcp_servers
                .as_ref()
                .and_then(|value| value.pointer("/env/FOO"))
                .and_then(Value::as_str),
            Some("")
        );
        assert_eq!(
            config
                .mcp_servers
                .as_ref()
                .and_then(|value| value.pointer("/headers/Cookie"))
                .and_then(Value::as_str),
            Some("")
        );
        assert_eq!(
            config
                .mcp_servers
                .as_ref()
                .and_then(|value| value.pointer("/headers/Authorization"))
                .and_then(Value::as_str),
            Some("")
        );
    }

    #[test]
    fn import_restores_all_redacted_secrets_by_trusted_path_and_stable_identity() {
        let temp = tempfile::tempdir().expect("temp directory");
        let store = ConfigSecretStore::new(temp.path());
        let mut current = GlobalConfig::default();
        current.ai.models = vec![
            AIModelConfig {
                id: "model-one".to_string(),
                api_key: "secret-one".to_string(),
                custom_headers: Some(HashMap::from([(
                    "X-Custom".to_string(),
                    "model-header-one".to_string(),
                )])),
                ..AIModelConfig::default()
            },
            AIModelConfig {
                id: "model-two".to_string(),
                api_key: "secret-two".to_string(),
                custom_headers: Some(HashMap::from([(
                    "X-Custom".to_string(),
                    "model-header-two".to_string(),
                )])),
                ..AIModelConfig::default()
            },
        ];
        current.mcp_servers = Some(serde_json::json!({
            "servers": {
                "private": {
                    "env": { "FOO": "current-env" },
                    "headers": {
                        "Cookie": "current-cookie",
                        "Authorization": "Bearer current-token"
                    }
                }
            }
        }));

        let mut imported = current.clone();
        store
            .clear_for_export(&mut imported)
            .expect("sanitize import payload");
        imported.ai.models.swap(0, 1);
        store
            .restore_redacted_for_import(&mut imported, &current)
            .expect("restore redacted import secrets");

        assert_eq!(imported.ai.models[0].id, "model-two");
        assert_eq!(imported.ai.models[0].api_key, "secret-two");
        assert_eq!(imported.ai.models[1].id, "model-one");
        assert_eq!(imported.ai.models[1].api_key, "secret-one");
        assert_eq!(
            imported.ai.models[0]
                .custom_headers
                .as_ref()
                .and_then(|headers| headers.get("X-Custom"))
                .map(String::as_str),
            Some("model-header-two")
        );
        assert_eq!(
            imported
                .mcp_servers
                .as_ref()
                .and_then(|value| value.pointer("/servers/private/env/FOO"))
                .and_then(Value::as_str),
            Some("current-env")
        );
        assert_eq!(
            imported
                .mcp_servers
                .as_ref()
                .and_then(|value| value.pointer("/servers/private/headers/Cookie"))
                .and_then(Value::as_str),
            Some("current-cookie")
        );
        assert_eq!(
            imported
                .mcp_servers
                .as_ref()
                .and_then(|value| { value.pointer("/servers/private/headers/Authorization") })
                .and_then(Value::as_str),
            Some("Bearer current-token")
        );

        imported.ai.models[0].id = "brand-new-model".to_string();
        imported.ai.models[0].api_key.clear();
        store
            .restore_redacted_for_import(&mut imported, &current)
            .expect("new identities remain credential-free");
        assert!(imported.ai.models[0].api_key.is_empty());
    }

    #[tokio::test]
    async fn transaction_journal_is_authenticated_and_encrypted() {
        let temp = tempfile::tempdir().expect("temp directory");
        let store = ConfigSecretStore::new(temp.path());
        let journal = serde_json::json!({
            "rawChanges": [{ "before": "journal-only-secret" }],
            "revision": 42
        });

        let sealed = store.seal_journal(&journal).await.expect("seal journal");
        assert!(sealed.starts_with(JOURNAL_PREFIX));
        assert!(!sealed.contains("journal-only-secret"));
        let opened: Value = store.open_journal(&sealed).await.expect("open journal");
        assert_eq!(opened, journal);
    }
}
