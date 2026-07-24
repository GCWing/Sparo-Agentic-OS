//! Configuration manager implementation
//!
//! A typed, transactional configuration management system.

use super::apply::{prepare_config_apply, reconcile_external_config_apply, PreparedConfigApplySet};
use super::atomic_store;
use super::catalog::{
    get_value_at_path, redact_value, resolve_config_write_value, set_value_at_path, ConfigCatalog,
    SettingDescriptor, SettingMutability, SettingRisk,
};
use super::policy;
use super::secret_store::ConfigSecretStore;
use super::service::reconcile_model_references;
use super::transaction::{
    apply_status_to_commit, build_apply_receipts, index_plan_confirmation,
    remove_plan_confirmation, synchronize_undo_confirmation_index, CommitConfigPlanRequest,
    ConfigCommit, ConfigPatch, ConfigPatchOperation, ConfigPlan, ConfigPlanChange,
    ConfigTransactionState, DurableConfigTransactionJournal, IdempotencyRecord, PendingConfigPlan,
    PlanIdempotencyRecord, RawConfigChange, RetryConfigApplyRequest, StoredConfigCommit,
    UndoConfigCommitRequest, PLAN_TTL_MILLIS,
};
use super::types::*;
use super::validation;
use crate::error::*;
use crate::infrastructure::{try_get_path_manager_arc, PathManager};
use log::{debug, info, warn};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sparo_events::{
    ConfigApplyStatus, ConfigApplyStatusEvent, ConfigChangeSource, ConfigChangeSourceKind,
    ConfigCommittedEvent, ConfigScope, ConfigValueChange, SettingsSectionRef,
};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;

pub(super) enum CommitMutation {
    Plan {
        plan_id: String,
        idempotency_key: String,
        fingerprint: String,
    },
    Undo {
        original_commit_id: String,
        idempotency_key: String,
        fingerprint: String,
    },
    AutoRollback {
        original_commit_id: String,
    },
}

pub(super) enum RetryApplyOutcome {
    Replay(ConfigCommit),
    Dispatch {
        commit: ConfigCommit,
        snapshot: GlobalConfig,
        prepared: PreparedConfigApplySet,
    },
}

pub(super) struct PendingApplyDispatch {
    pub commit: ConfigCommit,
    pub snapshot: GlobalConfig,
    pub prepared: PreparedConfigApplySet,
}

pub(super) struct PendingApplyRecovery {
    pub dispatches: Vec<PendingApplyDispatch>,
    pub terminal_events: Vec<ConfigApplyStatusEvent>,
}

#[derive(Clone)]
struct ExternalSnapshotProjection {
    changes: Vec<ConfigValueChange>,
    affected_sections: Vec<SettingsSectionRef>,
}

struct ExternalConfigReconciliation {
    reconciliation_id: String,
    revision: u64,
    current: GlobalConfig,
    candidate: GlobalConfig,
    changes: Vec<ConfigValueChange>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConfigLoadOutcome {
    Created,
    Loaded,
}

fn normalize_retired_theme_selection(config: &mut GlobalConfig) {
    let replacement = match config.themes.current.as_str() {
        "sparo-china-style" => Some("light"),
        "slate" | "sparo-china-night" | "sparo-cyber" => Some("dark"),
        _ => None,
    };
    if let Some(replacement) = replacement {
        config.themes.current = replacement.to_string();
    }
}

/// Configuration manager.
pub struct ConfigManager {
    config_dir: PathBuf,
    config: GlobalConfig,
    defaults: GlobalConfig,
    config_file: PathBuf,
    secret_store: ConfigSecretStore,
    path_manager: Arc<PathManager>,
    transaction: ConfigTransactionState,
    last_announced_revision: u64,
    startup_status: ConfigStartupStatus,
}

/// Controls how a configuration consumer handles persisted startup failures.
///
/// Strict is the default for core and CLI callers. Desktop may explicitly opt
/// into read-only v1 defaults so corrupt persisted state cannot make the shell
/// unusable. The fallback never writes, moves, or deletes the source files.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigStartupFailurePolicy {
    Strict,
    ReadOnlyDefaults,
}

/// Runtime storage mode of the authoritative configuration service.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConfigStartupMode {
    Persistent,
    ReadOnlyDefaults,
}

/// Persisted-startup phase that caused a safe read-only fallback.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConfigStartupFailurePhase {
    Load,
    Validation,
    Journal,
}

impl ConfigStartupFailurePhase {
    fn issue_code(self) -> &'static str {
        match self {
            Self::Load => "config.startup.load_failed",
            Self::Validation => "config.startup.validation_failed",
            Self::Journal => "config.startup.journal_failed",
        }
    }
}

/// Public, deliberately redacted description of configuration startup state.
///
/// Raw errors and storage paths are excluded because schema and secret-store
/// failures can contain private local details. Full diagnostics remain in the
/// local backend log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigStartupIssue {
    pub code: String,
    pub phase: ConfigStartupFailurePhase,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigStartupStatus {
    pub mode: ConfigStartupMode,
    pub schema_version: String,
    pub writes_allowed: bool,
    pub source_preserved: bool,
    pub rebuild_allowed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue: Option<ConfigStartupIssue>,
}

impl ConfigStartupStatus {
    pub fn persistent() -> Self {
        Self {
            mode: ConfigStartupMode::Persistent,
            schema_version: CONFIG_SCHEMA_VERSION.to_string(),
            writes_allowed: true,
            source_preserved: true,
            rebuild_allowed: false,
            issue: None,
        }
    }

    pub fn read_only_defaults(phase: ConfigStartupFailurePhase) -> Self {
        Self {
            mode: ConfigStartupMode::ReadOnlyDefaults,
            schema_version: CONFIG_SCHEMA_VERSION.to_string(),
            writes_allowed: false,
            source_preserved: true,
            rebuild_allowed: true,
            issue: Some(ConfigStartupIssue {
                code: phase.issue_code().to_string(),
                phase,
            }),
        }
    }

    pub fn is_persistent(&self) -> bool {
        self.mode == ConfigStartupMode::Persistent
    }
}

/// Configuration manager settings.
#[derive(Debug, Clone)]
pub struct ConfigManagerSettings {
    pub path_manager: Option<Arc<PathManager>>,
    pub startup_failure_policy: ConfigStartupFailurePolicy,
}

impl Default for ConfigManagerSettings {
    fn default() -> Self {
        Self {
            path_manager: None,
            startup_failure_policy: ConfigStartupFailurePolicy::Strict,
        }
    }
}

impl ConfigManager {
    /// Creates a new unified configuration manager.
    pub async fn new(settings: ConfigManagerSettings) -> CoreResult<Self> {
        let startup_failure_policy = settings.startup_failure_policy;
        let path_manager = match settings.path_manager {
            Some(path_manager) => path_manager,
            None => try_get_path_manager_arc()?,
        };

        path_manager.initialize_user_directories().await?;

        let config_dir = path_manager.user_config_dir();
        let config_file = path_manager.app_config_file();
        let secret_store = ConfigSecretStore::new(&path_manager.secrets_dir());

        let mut defaults = GlobalConfig::default();
        Self::add_default_agent_models_config(&mut defaults.ai.agent_models);
        Self::add_default_func_agent_models_config(&mut defaults.ai.func_agent_models);
        let default_value = serde_json::to_value(&defaults).map_err(|error| {
            CoreError::config(format!("Failed to serialize default config: {error}"))
        })?;
        let initial_catalog = ConfigCatalog::build(&default_value, &default_value)?;

        let mut manager = Self {
            config_dir,
            config: defaults.clone(),
            defaults,
            config_file,
            secret_store,
            path_manager,
            transaction: ConfigTransactionState::new(1, initial_catalog),
            last_announced_revision: 1,
            startup_status: ConfigStartupStatus::persistent(),
        };

        let authority = atomic_store::lock_exclusive(&manager.config_file).await?;
        let load_outcome = match manager.load_or_create_config().await {
            Ok(outcome) => outcome,
            Err(error) => {
                return manager.finish_startup_failure(
                    authority,
                    startup_failure_policy,
                    ConfigStartupFailurePhase::Load,
                    error,
                );
            }
        };
        if let Err(error) = manager.ensure_valid_candidate(&manager.config).await {
            return manager.finish_startup_failure(
                authority,
                startup_failure_policy,
                ConfigStartupFailurePhase::Validation,
                error,
            );
        }
        let next_transaction = match manager.build_transaction_state(&manager.config).await {
            Ok(transaction) => transaction,
            Err(error) => {
                return manager.finish_startup_failure(
                    authority,
                    startup_failure_policy,
                    ConfigStartupFailurePhase::Journal,
                    error,
                );
            }
        };
        match load_outcome {
            ConfigLoadOutcome::Created => {
                manager.save_config(&authority).await?;
                debug!("Created default config file");
            }
            ConfigLoadOutcome::Loaded => {
                debug!("Loaded config from file");
            }
        }
        synchronize_undo_confirmation_index(&manager.transaction, &next_transaction);
        manager.transaction = next_transaction;
        manager.last_announced_revision = manager.transaction.revision;
        drop(authority);

        debug!("ConfigManager initialized at {:?}", manager.config_file);
        Ok(manager)
    }

    fn finish_startup_failure(
        mut self,
        authority: atomic_store::ExclusiveFileLock,
        policy: ConfigStartupFailurePolicy,
        phase: ConfigStartupFailurePhase,
        error: CoreError,
    ) -> CoreResult<Self> {
        drop(authority);
        if policy == ConfigStartupFailurePolicy::Strict {
            return Err(error);
        }

        warn!(
            "Persisted configuration startup failed; using read-only defaults: phase={:?}, error={}",
            phase, error
        );
        self.config = self.defaults.clone();
        let defaults = serde_json::to_value(&self.defaults).map_err(|catalog_error| {
            CoreError::config(format!(
                "Failed to serialize fallback defaults: {catalog_error}"
            ))
        })?;
        let catalog = ConfigCatalog::build(&defaults, &defaults)?;
        self.transaction = ConfigTransactionState::new(1, catalog);
        self.last_announced_revision = 1;
        self.startup_status = ConfigStartupStatus::read_only_defaults(phase);
        debug!("ConfigManager initialized with read-only schema v1 defaults");
        Ok(self)
    }

    /// Returns the path manager.
    pub fn path_manager(&self) -> &Arc<PathManager> {
        &self.path_manager
    }

    pub fn startup_status(&self) -> &ConfigStartupStatus {
        &self.startup_status
    }

    /// Replaces an unusable persisted configuration with the current defaults.
    ///
    /// This is the only recovery write permitted while the manager is using
    /// read-only defaults. It is deliberately destructive and must only be
    /// called after an explicit user action. No legacy values are inspected or
    /// migrated.
    pub async fn rebuild_default_config(&mut self) -> CoreResult<ConfigStartupStatus> {
        if self.startup_status.is_persistent() {
            return Err(CoreError::config("config.rebuild_not_required"));
        }

        let authority = atomic_store::lock_exclusive(&self.config_file).await?;
        let mut candidate = self.defaults.clone();
        candidate.transaction_journal = None;
        candidate.last_modified = chrono::Utc::now();
        self.ensure_valid_candidate(&candidate).await?;
        let next_transaction = self.build_transaction_state(&candidate).await?;
        self.persist_candidate_unchecked(&authority, &candidate)
            .await?;
        if let Err(error) = self.secret_store.clear().await {
            warn!("Failed to remove obsolete config secret storage after rebuilding defaults: {error}");
        }

        synchronize_undo_confirmation_index(&self.transaction, &next_transaction);
        self.config = candidate;
        self.transaction = next_transaction;
        self.last_announced_revision = self.transaction.revision;
        self.startup_status = ConfigStartupStatus::persistent();
        drop(authority);

        info!("Rebuilt current default configuration after explicit user confirmation");
        Ok(self.startup_status.clone())
    }

    fn ensure_persistent_runtime(&self) -> CoreResult<()> {
        if self.startup_status.is_persistent() {
            return Ok(());
        }
        Err(CoreError::config("config.recovery_read_only"))
    }

    /// Loads or creates the configuration file.
    async fn load_or_create_config(&mut self) -> CoreResult<ConfigLoadOutcome> {
        if self.config_file.exists() {
            self.config = self
                .deserialize_config(self.read_config_value().await?)
                .await?;
            Ok(ConfigLoadOutcome::Loaded)
        } else {
            self.config = self.defaults.clone();
            Ok(ConfigLoadOutcome::Created)
        }
    }

    async fn read_config(&self) -> CoreResult<GlobalConfig> {
        self.deserialize_config(self.read_config_value().await?)
            .await
    }

    async fn read_config_value(&self) -> CoreResult<Value> {
        let content = fs::read_to_string(&self.config_file)
            .await
            .map_err(|e| CoreError::config(format!("Failed to read config file: {}", e)))?;

        serde_json::from_str(&content)
            .map_err(|e| CoreError::config(format!("Failed to parse config file as JSON: {}", e)))
    }

    async fn deserialize_config(&self, config_value: Value) -> CoreResult<GlobalConfig> {
        let version = config_value
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or("<missing>");
        if version != CONFIG_SCHEMA_VERSION {
            return Err(CoreError::config(format!(
                "Unsupported config version '{version}'; expected '{CONFIG_SCHEMA_VERSION}'"
            )));
        }
        let mut config: GlobalConfig = serde_json::from_value(config_value).map_err(|error| {
            CoreError::config(format!("Config does not match the current schema: {error}"))
        })?;
        normalize_retired_theme_selection(&mut config);
        self.secret_store.resolve(&mut config).await?;
        Ok(config)
    }

    /// Adds default configuration for the primary agents (`agent_models`).
    fn add_default_agent_models_config(
        agent_models: &mut std::collections::HashMap<String, String>,
    ) {
        let agents_using_fast = vec!["Explore", "FileFinder", "GenerateDoc", "CodeReview"];
        for key in agents_using_fast {
            if !agent_models.contains_key(key) {
                agent_models.insert(key.to_string(), "fast".to_string());
            }
        }
    }

    /// Adds default configuration for functional agents (`func_agent_models`).
    fn add_default_func_agent_models_config(
        func_agent_models: &mut std::collections::HashMap<String, String>,
    ) {
        let func_agents_using_fast = vec!["compression", "session-title-func-agent"];
        for key in func_agents_using_fast {
            if !func_agent_models.contains_key(key) {
                func_agent_models.insert(key.to_string(), "fast".to_string());
            }
        }
    }

    /// Saves the configuration file.
    async fn save_config(&self, authority: &atomic_store::ExclusiveFileLock) -> CoreResult<()> {
        self.persist_candidate(authority, &self.config).await
    }

    /// Persists a fully validated candidate without mutating the in-memory snapshot.
    async fn persist_candidate(
        &self,
        authority: &atomic_store::ExclusiveFileLock,
        candidate: &GlobalConfig,
    ) -> CoreResult<()> {
        self.ensure_persistent_runtime()?;
        self.persist_candidate_unchecked(authority, candidate).await
    }

    async fn persist_candidate_unchecked(
        &self,
        authority: &atomic_store::ExclusiveFileLock,
        candidate: &GlobalConfig,
    ) -> CoreResult<()> {
        authority.require_protects(&self.config_file)?;
        let staged = self.secret_store.stage(candidate).await?;
        let content = serde_json::to_vec_pretty(&staged.persisted_config)
            .map_err(|e| CoreError::config(format!("Config serialization failed: {}", e)))?;
        atomic_store::write_atomic(&self.config_file, &content).await?;
        if let Err(error) = self.secret_store.finalize(&staged).await {
            warn!("Failed to prune stale config secret entries: {}", error);
        }
        Ok(())
    }

    /// Gets a configuration value (supports dot-paths).
    pub fn get<T>(&self, path: &str) -> CoreResult<T>
    where
        T: serde::de::DeserializeOwned,
    {
        let value = self.get_value_by_path(path)?;
        serde_json::from_value(value).map_err(|e| {
            CoreError::config(format!(
                "Failed to deserialize config value at '{}': {}",
                path, e
            ))
        })
    }

    /// Returns the full configuration.
    pub fn get_config(&self) -> &GlobalConfig {
        &self.config
    }

    /// Returns the internal authoritative catalog to the service projection.
    pub(crate) fn catalog(&self) -> &ConfigCatalog {
        &self.transaction.catalog
    }

    /// Returns one authoritative recent commit, including its latest durable
    /// apply receipts. Expired history is indistinguishable from an unknown id.
    pub fn get_commit(&self, commit_id: &str) -> CoreResult<ConfigCommit> {
        let cutoff = chrono::Utc::now()
            .timestamp_millis()
            .saturating_sub(super::transaction::TRANSACTION_HISTORY_TTL_MILLIS);
        self.transaction
            .commits
            .get(commit_id)
            .filter(|stored| stored.commit.committed_at.timestamp_millis() > cutoff)
            .map(|stored| stored.commit.clone())
            .ok_or_else(|| CoreError::validation("config.commit_unknown"))
    }

    /// Returns recent commits newest-first. The bounded journal remains the
    /// only history store; this method creates no secondary cache.
    pub fn list_recent_commits(&self, limit: usize) -> Vec<ConfigCommit> {
        let cutoff = chrono::Utc::now()
            .timestamp_millis()
            .saturating_sub(super::transaction::TRANSACTION_HISTORY_TTL_MILLIS);
        let mut commits = self
            .transaction
            .commits
            .values()
            .filter(|stored| stored.commit.committed_at.timestamp_millis() > cutoff)
            .map(|stored| stored.commit.clone())
            .collect::<Vec<_>>();
        commits.sort_by(|left, right| right.committed_at.cmp(&left.committed_at));
        commits.truncate(limit.min(super::transaction::MAX_TRANSACTION_HISTORY_ENTRIES));
        commits
    }

    pub(super) async fn prepare_apply_retry(
        &mut self,
        request: RetryConfigApplyRequest,
    ) -> CoreResult<RetryApplyOutcome> {
        require_nonempty("commit_id", &request.commit_id)?;
        require_nonempty("consumer", &request.consumer)?;
        require_idempotency_key(&request.idempotency_key)?;
        let fingerprint = hash_serializable(&request)?;
        let (authority, _) = self
            .acquire_authority_after_external_reconciliation()
            .await?;
        if let Some(record) = self.transaction.idempotency.get(&request.idempotency_key) {
            if record.fingerprint == fingerprint {
                return Ok(RetryApplyOutcome::Replay(record.commit.clone()));
            }
            return Err(CoreError::validation(
                "config.idempotency_conflict: key was used for a different request",
            ));
        }

        let stored = self
            .transaction
            .commits
            .get(&request.commit_id)
            .cloned()
            .ok_or_else(|| CoreError::validation("config.commit_unknown"))?;
        if stored.commit.revision != request.expected_revision {
            return Err(CoreError::validation(
                "config.apply_retry_revision_mismatch",
            ));
        }
        let receipt = stored
            .commit
            .apply_receipts
            .iter()
            .find(|receipt| receipt.consumer == request.consumer)
            .cloned()
            .ok_or_else(|| CoreError::validation("config.apply_retry_consumer_unknown"))?;
        if receipt.critical {
            return Err(CoreError::validation(
                "config.apply_retry_critical_consumer_forbidden",
            ));
        }
        if receipt.status != super::transaction::ConfigApplyReceiptStatus::Failed {
            return Err(CoreError::validation(
                "config.apply_retry_requires_failed_receipt",
            ));
        }
        if receipt.attempt != request.expected_attempt {
            return Err(CoreError::validation("config.apply_retry_attempt_mismatch"));
        }

        let current = serde_json::to_value(&self.config)
            .map_err(|error| CoreError::config(format!("Failed to serialize config: {error}")))?;
        for path in &receipt.paths {
            let raw = stored
                .raw_changes
                .iter()
                .find(|change| &change.path == path)
                .ok_or_else(|| CoreError::validation("config.apply_retry_change_unavailable"))?;
            if get_value_at_path(&current, path).unwrap_or(Value::Null) != raw.after {
                return Err(CoreError::validation(format!(
                    "config.apply_retry_conflict: '{}' changed after commit {}",
                    raw.setting_id, request.commit_id
                )));
            }
        }
        let changes = stored
            .commit
            .changes
            .iter()
            .filter(|change| receipt.paths.contains(&change.path))
            .cloned()
            .collect::<Vec<_>>();
        if changes.len() != receipt.paths.len() {
            return Err(CoreError::validation(
                "config.apply_retry_change_unavailable",
            ));
        }
        let prepared = prepare_config_apply(&self.config, &self.config, &changes).await?;
        if !prepared.consumers().contains(&request.consumer) {
            return Err(CoreError::validation(
                "config.apply_retry_consumer_inactive",
            ));
        }

        let next_attempt = receipt
            .attempt
            .checked_add(1)
            .ok_or_else(|| CoreError::config("Config apply receipt attempt exhausted"))?;
        let mut next = self.transaction.clone();
        let stored = next
            .commits
            .get_mut(&request.commit_id)
            .expect("retry commit remains present");
        let retry_receipt = stored
            .commit
            .apply_receipts
            .iter_mut()
            .find(|candidate| candidate.consumer == request.consumer)
            .expect("retry receipt remains present");
        retry_receipt.status = super::transaction::ConfigApplyReceiptStatus::Pending;
        retry_receipt.attempt = next_attempt;
        retry_receipt.attempted_at = chrono::Utc::now();
        retry_receipt.message = Some(format!("Retrying {}", request.consumer));
        stored.commit.status = super::transaction::ConfigCommitStatus::Applying;
        let commit = stored.commit.clone();
        for record in next.idempotency.values_mut() {
            if record.commit.commit_id == commit.commit_id {
                record.commit = commit.clone();
            }
        }
        next.idempotency.insert(
            request.idempotency_key,
            IdempotencyRecord {
                fingerprint,
                commit: commit.clone(),
            },
        );
        self.persist_transaction_state(&authority, next).await?;
        Ok(RetryApplyOutcome::Dispatch {
            commit,
            snapshot: self.config.clone(),
            prepared,
        })
    }

    pub(super) async fn prepare_pending_applies(
        &self,
        consumer: &str,
    ) -> CoreResult<PendingApplyRecovery> {
        let current = serde_json::to_value(&self.config)
            .map_err(|error| CoreError::config(format!("Failed to serialize config: {error}")))?;
        let mut stored_commits = self
            .transaction
            .commits
            .values()
            .filter(|stored| {
                stored.commit.apply_receipts.iter().any(|receipt| {
                    receipt.consumer == consumer
                        && receipt.status == super::transaction::ConfigApplyReceiptStatus::Pending
                })
            })
            .cloned()
            .collect::<Vec<_>>();
        stored_commits.sort_by_key(|stored| stored.commit.revision);
        let mut dispatches = Vec::new();
        let mut terminal_events = Vec::new();
        for stored in stored_commits {
            let receipt = stored
                .commit
                .apply_receipts
                .iter()
                .find(|receipt| receipt.consumer == consumer)
                .cloned()
                .expect("pending receipt exists");
            let values_still_current = receipt.paths.iter().all(|path| {
                stored.raw_changes.iter().any(|change| {
                    &change.path == path
                        && get_value_at_path(&current, path).unwrap_or(Value::Null) == change.after
                })
            });
            let superseding_revision = self
                .transaction
                .commits
                .values()
                .filter(|candidate| candidate.commit.revision > stored.commit.revision)
                .filter(|candidate| {
                    candidate
                        .raw_changes
                        .iter()
                        .any(|change| receipt.paths.contains(&change.path))
                })
                .map(|candidate| candidate.commit.revision)
                .min()
                .or_else(|| (!values_still_current).then_some(self.transaction.revision));
            if let Some(superseding_revision) = superseding_revision {
                terminal_events.push(ConfigApplyStatusEvent {
                    commit_id: stored.commit.commit_id,
                    revision: stored.commit.revision,
                    consumer: receipt.consumer.clone(),
                    receipt_attempt: receipt.attempt,
                    status: ConfigApplyStatus::Superseded,
                    paths: receipt.paths.clone(),
                    message: Some(format!(
                        "Superseded by configuration revision {}",
                        superseding_revision
                    )),
                });
                continue;
            }
            let changes = stored
                .commit
                .changes
                .iter()
                .filter(|change| receipt.paths.contains(&change.path))
                .cloned()
                .collect::<Vec<_>>();
            let prepared = match prepare_config_apply(&self.config, &self.config, &changes).await {
                Ok(prepared) => prepared,
                Err(error) => {
                    terminal_events.push(ConfigApplyStatusEvent {
                        commit_id: stored.commit.commit_id,
                        revision: stored.commit.revision,
                        consumer: receipt.consumer.clone(),
                        receipt_attempt: receipt.attempt,
                        status: ConfigApplyStatus::Failed,
                        paths: receipt.paths.clone(),
                        message: Some(error.to_string()),
                    });
                    continue;
                }
            };
            if prepared.consumers().contains(consumer) {
                dispatches.push(PendingApplyDispatch {
                    commit: stored.commit,
                    snapshot: self.config.clone(),
                    prepared,
                });
            } else {
                terminal_events.push(ConfigApplyStatusEvent {
                    commit_id: stored.commit.commit_id,
                    revision: stored.commit.revision,
                    consumer: receipt.consumer.clone(),
                    receipt_attempt: receipt.attempt,
                    status: ConfigApplyStatus::Failed,
                    paths: receipt.paths.clone(),
                    message: Some(
                        "Runtime consumer became unavailable during recovery".to_string(),
                    ),
                });
            }
        }
        Ok(PendingApplyRecovery {
            dispatches,
            terminal_events,
        })
    }

    /// Returns the current revisioned, redacted snapshot.
    pub fn get_snapshot(&self) -> CoreResult<super::transaction::ConfigSnapshot> {
        let config = serde_json::to_value(&self.config)
            .map_err(|error| CoreError::config(format!("Failed to serialize config: {error}")))?;
        Ok(self.transaction.snapshot(&config))
    }

    /// Validates a catalog-backed patch and stores a short-lived immutable plan.
    pub async fn plan_patch(&mut self, mut patch: ConfigPatch) -> CoreResult<ConfigPlan> {
        require_nonempty("request_id", &patch.request_id)?;
        require_idempotency_key(&patch.idempotency_key)?;
        if patch.scope != ConfigScope::user() {
            return Err(CoreError::validation(
                "config.scope_unsupported: only user scope is currently available",
            ));
        }
        let (authority, _) = self
            .acquire_authority_after_external_reconciliation()
            .await?;
        let now_ms = chrono::Utc::now().timestamp_millis();
        self.transaction.remove_expired_plans(now_ms);
        self.transaction.prune_transaction_history(now_ms);
        patch.source.request_id = Some(patch.request_id.clone());
        let plan_fingerprint = hash_serializable(&patch)?;
        if let Some(record) = self
            .transaction
            .plan_idempotency
            .get(&patch.idempotency_key)
        {
            if record.fingerprint == plan_fingerprint {
                return Ok(record.plan.clone());
            }
            return Err(CoreError::validation(
                "config.idempotency_conflict: plan key was used for a different request",
            ));
        }
        if patch.expected_revision != self.transaction.revision {
            return Err(CoreError::validation(format!(
                "config.revision_conflict: expected {}, current {}",
                patch.expected_revision, self.transaction.revision
            )));
        }
        if patch.operations.is_empty() {
            return Err(CoreError::validation(
                "A configuration patch must contain at least one operation",
            ));
        }

        let mut seen = HashSet::new();
        let mut candidate_value = serde_json::to_value(&self.config)
            .map_err(|error| CoreError::config(format!("Failed to serialize config: {error}")))?;
        let defaults_value = serde_json::to_value(&self.defaults).map_err(|error| {
            CoreError::config(format!("Failed to serialize default config: {error}"))
        })?;
        for operation in &patch.operations {
            let setting_id = match operation {
                ConfigPatchOperation::Set { setting_id, .. }
                | ConfigPatchOperation::Reset { setting_id } => setting_id,
            };
            if !seen.insert(setting_id.clone()) {
                return Err(CoreError::validation(format!(
                    "Setting '{setting_id}' appears more than once in the same patch"
                )));
            }
            let descriptor = self
                .transaction
                .catalog
                .find(setting_id)
                .cloned()
                .ok_or_else(|| CoreError::validation(format!("Unknown setting '{setting_id}'")))?;
            let proposed = match operation {
                ConfigPatchOperation::Set { value, .. } => value.clone(),
                ConfigPatchOperation::Reset { .. } => get_value_at_path(
                    &defaults_value,
                    &descriptor.storage.path,
                )
                .ok_or_else(|| {
                    CoreError::validation(format!("Setting '{setting_id}' has no default value"))
                })?,
            };
            let current = get_value_at_path(&candidate_value, &descriptor.storage.path)
                .unwrap_or(Value::Null);
            let after = resolve_config_write_value(&descriptor, &current, &proposed)?;
            policy::validate_write(&descriptor, &after, patch.source.kind)?;
            set_value_at_path(
                &mut candidate_value,
                &descriptor.storage.path,
                after.clone(),
            )?;
        }

        let mut candidate: GlobalConfig =
            serde_json::from_value(candidate_value).map_err(|error| {
                CoreError::validation(format!(
                    "Configuration patch does not match the typed config: {error}"
                ))
            })?;
        reconcile_model_references(&mut candidate, "plan_patch");
        let raw_changes = self.raw_changes_between(&candidate)?;
        self.ensure_valid_candidate(&candidate).await?;
        let changes = self.public_plan_changes(&raw_changes)?;
        let affected_sections = self.affected_sections(&raw_changes)?;
        let requires_confirmation = raw_changes.iter().any(|change| {
            self.descriptor_for_change(change)
                .is_some_and(policy::requires_confirmation)
        });
        let operation_hash =
            hash_serializable(&(&plan_fingerprint, &self.transaction.catalog.version))?;
        let plan = ConfigPlan {
            plan_id: format!("cfg-plan-{}", uuid::Uuid::new_v4()),
            base_revision: self.transaction.revision,
            catalog_version: self.transaction.catalog.version.clone(),
            operation_hash,
            expires_at_ms: now_ms + PLAN_TTL_MILLIS,
            changes,
            requires_confirmation,
            affected_sections,
            warnings: Vec::new(),
        };
        self.transaction.pending_plans.insert(
            plan.plan_id.clone(),
            PendingConfigPlan {
                plan: plan.clone(),
                candidate,
                raw_changes,
                source: patch.source,
            },
        );
        self.transaction.plan_idempotency.insert(
            patch.idempotency_key,
            PlanIdempotencyRecord {
                fingerprint: plan_fingerprint,
                plan: plan.clone(),
            },
        );
        index_plan_confirmation(&plan);
        drop(authority);
        Ok(plan)
    }

    /// Atomically commits a previously validated plan.
    pub async fn commit_plan(
        &mut self,
        request: CommitConfigPlanRequest,
    ) -> CoreResult<ConfigCommit> {
        require_idempotency_key(&request.idempotency_key)?;
        let fingerprint = hash_serializable(&request)?;
        let local_pending = self
            .transaction
            .pending_plans
            .get(&request.plan_id)
            .cloned();
        let (authority, _) = self
            .acquire_authority_after_external_reconciliation()
            .await?;
        let now_ms = chrono::Utc::now().timestamp_millis();
        self.transaction.remove_expired_plans(now_ms);
        self.transaction.prune_transaction_history(now_ms);
        if let Some(record) = self.transaction.idempotency.get(&request.idempotency_key) {
            if record.fingerprint == fingerprint {
                return Ok(record.commit.clone());
            }
            return Err(CoreError::validation(
                "config.idempotency_conflict: key was used for a different request",
            ));
        }
        let pending = self
            .transaction
            .pending_plans
            .get(&request.plan_id)
            .cloned()
            .or(local_pending)
            .ok_or_else(|| CoreError::validation("config.plan_expired_or_unknown"))?;
        if pending.plan.expires_at_ms <= now_ms {
            return Err(CoreError::validation("config.plan_expired"));
        }
        if request.expected_revision != self.transaction.revision
            || pending.plan.base_revision != self.transaction.revision
        {
            return Err(CoreError::validation(format!(
                "config.stale_plan: plan {}, current {}",
                pending.plan.base_revision, self.transaction.revision
            )));
        }
        if pending.plan.catalog_version != self.transaction.catalog.version {
            return Err(CoreError::validation("config.catalog_changed"));
        }
        if pending.plan.requires_confirmation && !request.confirmed {
            return Err(CoreError::validation("config.confirmation_required"));
        }

        let commit = self
            .commit_candidate(
                &authority,
                pending.candidate,
                pending.source,
                pending.raw_changes,
                CommitMutation::Plan {
                    plan_id: request.plan_id,
                    idempotency_key: request.idempotency_key,
                    fingerprint,
                },
            )
            .await?;
        Ok(commit)
    }

    /// Creates a conflict-checked compensating commit for a prior commit.
    pub async fn undo_commit(
        &mut self,
        request: UndoConfigCommitRequest,
        source: ConfigChangeSource,
    ) -> CoreResult<ConfigCommit> {
        require_idempotency_key(&request.idempotency_key)?;
        require_nonempty("undo_token", &request.undo_token)?;
        let (authority, _) = self
            .acquire_authority_after_external_reconciliation()
            .await?;
        self.transaction
            .prune_transaction_history(chrono::Utc::now().timestamp_millis());
        let fingerprint = hash_serializable(&(request.clone(), source.clone()))?;
        if let Some(record) = self.transaction.idempotency.get(&request.idempotency_key) {
            if record.fingerprint == fingerprint {
                return Ok(record.commit.clone());
            }
            return Err(CoreError::validation(
                "config.idempotency_conflict: key was used for a different request",
            ));
        }
        if request.expected_revision != self.transaction.revision {
            return Err(CoreError::validation(format!(
                "config.revision_conflict: expected {}, current {}",
                request.expected_revision, self.transaction.revision
            )));
        }
        let stored = self
            .transaction
            .commits
            .get(&request.commit_id)
            .cloned()
            .ok_or_else(|| CoreError::validation("config.commit_unknown"))?;
        if stored.commit.undo_token.as_deref() != Some(request.undo_token.as_str()) {
            return Err(CoreError::validation("config.undo_token_invalid"));
        }
        if stored.max_risk >= SettingRisk::Elevated && !request.confirmed {
            return Err(CoreError::validation("config.confirmation_required"));
        }

        let mut candidate_value = serde_json::to_value(&self.config)
            .map_err(|error| CoreError::config(format!("Failed to serialize config: {error}")))?;
        for change in &stored.raw_changes {
            let current = get_value_at_path(&candidate_value, &change.path).unwrap_or(Value::Null);
            if current != change.after {
                return Err(CoreError::validation(format!(
                    "config.undo_conflict: '{}' changed after commit {}",
                    change.setting_id, request.commit_id
                )));
            }
        }
        for change in &stored.raw_changes {
            set_value_at_path(&mut candidate_value, &change.path, change.before.clone())?;
        }
        let mut candidate: GlobalConfig =
            serde_json::from_value(candidate_value).map_err(|error| {
                CoreError::config(format!("Failed to deserialize undo candidate: {error}"))
            })?;
        reconcile_model_references(&mut candidate, "undo_config_commit");
        let reverse_changes = self.raw_changes_between(&candidate)?;
        let commit = self
            .commit_candidate(
                &authority,
                candidate,
                source,
                reverse_changes,
                CommitMutation::Undo {
                    original_commit_id: request.commit_id,
                    idempotency_key: request.idempotency_key,
                    fingerprint,
                },
            )
            .await?;
        Ok(commit)
    }

    /// Applies an authoritative runtime consumer acknowledgement to the stored
    /// commit and every idempotent replay projection of that commit.
    pub async fn record_apply_status(
        &mut self,
        event: &ConfigApplyStatusEvent,
    ) -> CoreResult<ConfigCommit> {
        let (authority, _) = self
            .acquire_authority_after_external_reconciliation()
            .await?;
        let mut next = self.transaction.clone();
        next.prune_transaction_history(chrono::Utc::now().timestamp_millis());
        let stored = next
            .commits
            .get_mut(&event.commit_id)
            .ok_or_else(|| CoreError::validation("config.apply_status_commit_unknown"))?;
        let changed = apply_status_to_commit(&mut stored.commit, event)?;
        let updated = stored.commit.clone();
        for record in next.idempotency.values_mut() {
            if record.commit.commit_id == updated.commit_id {
                record.commit = updated.clone();
            }
        }
        if changed {
            self.persist_transaction_state(&authority, next).await?;
        }
        Ok(updated)
    }

    /// Expires one exact receipt attempt. A timeout from an older attempt is a
    /// no-op and cannot fail a newer retry.
    pub async fn expire_pending_apply_receipt(
        &mut self,
        commit_id: &str,
        revision: u64,
        consumer: &str,
        receipt_attempt: u32,
    ) -> CoreResult<(Option<ConfigApplyStatusEvent>, ConfigCommit)> {
        let (authority, _) = self
            .acquire_authority_after_external_reconciliation()
            .await?;
        let mut next = self.transaction.clone();
        next.prune_transaction_history(chrono::Utc::now().timestamp_millis());
        let stored = next
            .commits
            .get(commit_id)
            .ok_or_else(|| CoreError::validation("config.apply_status_commit_unknown"))?;
        if stored.commit.revision != revision {
            return Err(CoreError::validation("config.apply_status_commit_mismatch"));
        }
        let pending = stored
            .commit
            .apply_receipts
            .iter()
            .find(|receipt| receipt.consumer == consumer)
            .filter(|receipt| {
                receipt.attempt == receipt_attempt
                    && receipt.status == super::transaction::ConfigApplyReceiptStatus::Pending
            })
            .map(|receipt| ConfigApplyStatusEvent {
                commit_id: commit_id.to_string(),
                revision,
                consumer: receipt.consumer.clone(),
                receipt_attempt,
                status: ConfigApplyStatus::Failed,
                paths: receipt.paths.clone(),
                message: Some("Runtime consumer acknowledgement timed out".to_string()),
            });
        if let Some(event) = &pending {
            let stored = next
                .commits
                .get_mut(commit_id)
                .expect("stored commit remains present while expiring receipts");
            apply_status_to_commit(&mut stored.commit, event)?;
            let updated = stored.commit.clone();
            for record in next.idempotency.values_mut() {
                if record.commit.commit_id == updated.commit_id {
                    record.commit = updated.clone();
                }
            }
        }
        let commit = next
            .commits
            .get(commit_id)
            .expect("stored commit remains present while expiring receipts")
            .commit
            .clone();
        if pending.is_some() {
            self.persist_transaction_state(&authority, next).await?;
        }
        Ok((pending, commit))
    }

    /// Creates a compensating commit after a critical runtime adapter fails.
    /// This internal path requires the exact failed revision and rechecks every
    /// changed value before restoring the previous snapshot.
    pub async fn rollback_failed_commit(
        &mut self,
        commit_id: &str,
        expected_revision: u64,
    ) -> CoreResult<(ConfigCommit, String)> {
        let (authority, _) = self
            .acquire_authority_after_external_reconciliation()
            .await?;
        self.transaction
            .prune_transaction_history(chrono::Utc::now().timestamp_millis());
        if self.transaction.revision != expected_revision {
            return Err(CoreError::validation(format!(
                "config.auto_rollback_conflict: failed revision {expected_revision}, current {}",
                self.transaction.revision
            )));
        }
        let stored = self
            .transaction
            .commits
            .get(commit_id)
            .cloned()
            .ok_or_else(|| CoreError::validation("config.commit_unknown"))?;
        if stored.commit.revision != expected_revision {
            return Err(CoreError::validation(
                "config.auto_rollback_revision_mismatch",
            ));
        }
        if !stored.commit.apply_receipts.iter().any(|receipt| {
            receipt.critical
                && receipt.status == super::transaction::ConfigApplyReceiptStatus::Failed
        }) {
            return Err(CoreError::validation(
                "config.auto_rollback_requires_critical_failure",
            ));
        }

        let mut candidate_value = serde_json::to_value(&self.config)
            .map_err(|error| CoreError::config(format!("Failed to serialize config: {error}")))?;
        for change in &stored.raw_changes {
            let current = get_value_at_path(&candidate_value, &change.path).unwrap_or(Value::Null);
            if current != change.after {
                return Err(CoreError::validation(format!(
                    "config.auto_rollback_conflict: '{}' changed after commit {}",
                    change.setting_id, commit_id
                )));
            }
        }
        for change in &stored.raw_changes {
            set_value_at_path(&mut candidate_value, &change.path, change.before.clone())?;
        }
        let mut candidate: GlobalConfig =
            serde_json::from_value(candidate_value).map_err(|error| {
                CoreError::config(format!("Failed to deserialize rollback candidate: {error}"))
            })?;
        reconcile_model_references(&mut candidate, "auto_rollback_config_commit");
        let reverse_changes = self.raw_changes_between(&candidate)?;
        let rollback = self
            .commit_candidate(
                &authority,
                candidate,
                ConfigChangeSource {
                    kind: ConfigChangeSourceKind::System,
                    surface: Some("config-auto-rollback".to_string()),
                    request_id: Some(commit_id.to_string()),
                },
                reverse_changes,
                CommitMutation::AutoRollback {
                    original_commit_id: commit_id.to_string(),
                },
            )
            .await?;
        let catalog_version = self.transaction.catalog.version.clone();
        Ok((rollback, catalog_version))
    }

    /// Validates configuration.
    pub fn validate_config(&self) -> ConfigValidationResult {
        validation::validate_config(&self.config)
    }

    /// Exports configuration.
    pub fn export_config(&self) -> CoreResult<serde_json::Value> {
        let mut export = self.config.clone();
        export.transaction_journal = None;
        self.secret_store.clear_for_export(&mut export)?;
        export.ai.proxy.password = None;
        serde_json::to_value(export)
            .map_err(|e| CoreError::config(format!("Failed to export config: {}", e)))
    }

    /// Imports configuration through the same Catalog -> Plan -> Commit
    /// protocol as every other live write.
    pub async fn import_config(
        &mut self,
        config_data: serde_json::Value,
        expected_revision: u64,
        idempotency_key: String,
        confirmed: bool,
    ) -> CoreResult<Option<ConfigCommit>> {
        require_idempotency_key(&idempotency_key)?;
        let (authority, _) = self
            .acquire_authority_after_external_reconciliation()
            .await?;
        if expected_revision != self.transaction.revision {
            return Err(CoreError::validation(format!(
                "config.revision_conflict: expected {expected_revision}, current {}",
                self.transaction.revision
            )));
        }
        let mut imported_config: GlobalConfig = serde_json::from_value(config_data)
            .map_err(|e| CoreError::config(format!("Failed to parse imported config: {}", e)))?;
        self.secret_store
            .restore_redacted_for_import(&mut imported_config, &self.config)?;
        imported_config.transaction_journal = None;
        if imported_config.version != CONFIG_SCHEMA_VERSION {
            return Err(CoreError::validation(format!(
                "config.import_version_mismatch: expected {}, received {}",
                CONFIG_SCHEMA_VERSION, imported_config.version
            )));
        }
        reconcile_model_references(&mut imported_config, "import_config");
        let raw_changes = self.raw_changes_between(&imported_config)?;
        drop(authority);
        if raw_changes.is_empty() {
            return Ok(None);
        }
        let plan = self
            .plan_patch(ConfigPatch {
                request_id: format!("config-import-{}", uuid::Uuid::new_v4()),
                idempotency_key: format!("{idempotency_key}:plan"),
                expected_revision,
                source: ConfigChangeSource {
                    kind: ConfigChangeSourceKind::Import,
                    surface: Some("config-import".to_string()),
                    request_id: None,
                },
                scope: ConfigScope::user(),
                operations: raw_changes
                    .into_iter()
                    .map(|change| ConfigPatchOperation::Set {
                        setting_id: change.setting_id,
                        value: change.after,
                    })
                    .collect(),
            })
            .await?;
        let commit = self
            .commit_plan(CommitConfigPlanRequest {
                plan_id: plan.plan_id,
                expected_revision,
                idempotency_key,
                confirmed,
            })
            .await?;

        info!("Successfully imported configuration");
        Ok(Some(commit))
    }

    /// Returns configuration statistics.
    pub fn get_statistics(&self) -> ConfigStatistics {
        ConfigStatistics {
            total_ai_models: self.config.ai.models.len(),
            has_default_model: self.config.ai.default_models.primary.is_some(),
            config_directory: self.config_dir.clone(),
            last_modified: self.config.last_modified,
        }
    }

    /// Gets a configuration value by dot-path.
    fn get_value_by_path(&self, path: &str) -> CoreResult<serde_json::Value> {
        self.get_value_by_path_from_config(&self.config, path)
    }

    /// Gets a configuration value by dot-path from the given config.
    fn get_value_by_path_from_config(
        &self,
        config: &GlobalConfig,
        path: &str,
    ) -> CoreResult<serde_json::Value> {
        let config_value = serde_json::to_value(config)
            .map_err(|e| CoreError::config(format!("Failed to serialize config: {}", e)))?;

        let keys: Vec<&str> = path.split('.').collect();
        let mut current = &config_value;

        for key in keys {
            current = current
                .get(key)
                .ok_or_else(|| CoreError::config(format!("Config path '{}' not found", path)))?;
        }

        Ok(current.clone())
    }

    async fn build_transaction_state(
        &self,
        config: &GlobalConfig,
    ) -> CoreResult<ConfigTransactionState> {
        let defaults = serde_json::to_value(&self.defaults).map_err(|error| {
            CoreError::config(format!("Failed to serialize default config: {error}"))
        })?;
        let current = serde_json::to_value(config)
            .map_err(|error| CoreError::config(format!("Failed to serialize config: {error}")))?;
        let catalog = ConfigCatalog::build(&defaults, &current)?;
        if let Some(sealed) = config.transaction_journal.as_deref() {
            let journal: DurableConfigTransactionJournal =
                self.secret_store.open_journal(sealed).await?;
            ConfigTransactionState::restore(catalog, journal)
        } else {
            Ok(ConfigTransactionState::new(1, catalog))
        }
    }

    /// Reloads the only authoritative snapshot and durable journal while the
    /// caller holds the cross-process file lock. Compatible in-process plans
    /// remain usable. A commit captures its requested local plan before this
    /// refresh so an externally superseded plan returns a deterministic stale
    /// plan conflict instead of being mistaken for an unknown id.
    async fn refresh_authoritative_state(
        &mut self,
    ) -> CoreResult<(usize, Option<ExternalConfigReconciliation>)> {
        let disk_config = self.read_config().await?;
        self.ensure_valid_candidate(&disk_config).await?;
        let mut disk_transaction = self.build_transaction_state(&disk_config).await?;
        if disk_transaction.revision < self.transaction.revision {
            return Err(CoreError::validation(format!(
                "config.revision_regression: in-memory {}, persisted {}",
                self.transaction.revision, disk_transaction.revision
            )));
        }
        if disk_transaction.revision == self.transaction.revision
            && config_snapshot_payload(&disk_config)? != config_snapshot_payload(&self.config)?
        {
            return Err(CoreError::validation(
                "config.revision_integrity_conflict: persisted values changed without a new revision",
            ));
        }
        let snapshot_projection = if disk_transaction.revision > self.last_announced_revision {
            Some(self.external_snapshot_projection(&disk_config, &disk_transaction.catalog)?)
        } else {
            None
        };
        let external_current = snapshot_projection.as_ref().map(|_| self.config.clone());

        let now_ms = chrono::Utc::now().timestamp_millis();
        let previous = self.transaction.clone();
        let compatible_plan_ids = previous
            .pending_plans
            .iter()
            .filter(|(_, pending)| {
                pending.plan.expires_at_ms > now_ms
                    && pending.plan.base_revision == disk_transaction.revision
                    && pending.plan.catalog_version == disk_transaction.catalog.version
            })
            .map(|(plan_id, _)| plan_id.clone())
            .collect::<HashSet<_>>();
        for (plan_id, pending) in previous.pending_plans {
            if compatible_plan_ids.contains(&plan_id) {
                index_plan_confirmation(&pending.plan);
                disk_transaction.pending_plans.insert(plan_id, pending);
            } else {
                remove_plan_confirmation(&plan_id);
            }
        }
        for (key, record) in previous.plan_idempotency {
            if compatible_plan_ids.contains(&record.plan.plan_id) {
                disk_transaction.plan_idempotency.insert(key, record);
            }
        }

        synchronize_undo_confirmation_index(&self.transaction, &disk_transaction);
        self.config = disk_config;
        self.transaction = disk_transaction;
        let published = snapshot_projection
            .as_ref()
            .map(|projection| self.publish_unannounced_external_commits(projection))
            .unwrap_or(0);
        let reconciliation = snapshot_projection.map(|projection| ExternalConfigReconciliation {
            reconciliation_id: format!("cfg-external-reconciliation-{}", self.transaction.revision),
            revision: self.transaction.revision,
            current: external_current.expect("external projection has a resident snapshot"),
            candidate: self.config.clone(),
            changes: projection.changes,
        });
        Ok((published, reconciliation))
    }

    /// Returns write authority only after every newly discovered external
    /// revision has been enqueued into this process's live adapter FIFOs. The
    /// OS file lock is never held while adapter preparation runs; after the
    /// enqueue, the lock is reacquired and the authoritative revision is
    /// checked again before a caller can mutate state.
    async fn acquire_authority_after_external_reconciliation(
        &mut self,
    ) -> CoreResult<(atomic_store::ExclusiveFileLock, usize)> {
        self.ensure_persistent_runtime()?;
        let mut published = 0usize;
        loop {
            let authority = atomic_store::lock_exclusive(&self.config_file).await?;
            let (newly_published, reconciliation) = self.refresh_authoritative_state().await?;
            published = published.saturating_add(newly_published);
            let Some(reconciliation) = reconciliation else {
                return Ok((authority, published));
            };
            drop(authority);
            reconcile_external_config_apply(
                reconciliation.reconciliation_id,
                reconciliation.revision,
                reconciliation.current,
                reconciliation.candidate,
                reconciliation.changes,
            )
            .await;
        }
    }

    /// Fully refreshes after the long-resident watcher observes a changed
    /// atomic-file metadata marker. The authoritative snapshot and journal are
    /// re-read under the same cross-process lock used by writers.
    pub(super) async fn refresh_external_changes(&mut self) -> CoreResult<usize> {
        let (authority, published) = self
            .acquire_authority_after_external_reconciliation()
            .await?;
        drop(authority);
        Ok(published)
    }

    pub(super) async fn persisted_file_marker(&self) -> CoreResult<atomic_store::FileMarker> {
        self.ensure_persistent_runtime()?;
        atomic_store::file_marker(&self.config_file).await
    }

    fn external_snapshot_projection(
        &self,
        disk_config: &GlobalConfig,
        disk_catalog: &ConfigCatalog,
    ) -> CoreResult<ExternalSnapshotProjection> {
        let raw_changes = self.raw_changes_between(disk_config)?;
        let changes = raw_changes
            .iter()
            .map(|change| {
                let descriptor = disk_catalog
                    .find(&change.setting_id)
                    .or_else(|| self.transaction.catalog.find(&change.setting_id))
                    .ok_or_else(|| {
                        CoreError::config(format!(
                            "Catalog descriptor missing for external snapshot setting '{}'",
                            change.setting_id
                        ))
                    })?;
                Ok(ConfigValueChange {
                    setting_id: change.setting_id.clone(),
                    path: change.path.clone(),
                    old_value: redact_value(descriptor, change.before.clone()),
                    new_value: redact_value(descriptor, change.after.clone()),
                    apply_strategy: change.apply_strategy,
                })
            })
            .collect::<CoreResult<Vec<_>>>()?;
        let affected_sections = affected_sections_from_catalogs(
            disk_catalog,
            Some(&self.transaction.catalog),
            &raw_changes,
        )?;
        Ok(ExternalSnapshotProjection {
            changes,
            affected_sections,
        })
    }

    fn publish_unannounced_external_commits(
        &mut self,
        snapshot_projection: &ExternalSnapshotProjection,
    ) -> usize {
        debug_assert!(self.transaction.revision > self.last_announced_revision);
        let mut commits = self
            .transaction
            .commits
            .values()
            .filter(|stored| stored.commit.revision > self.last_announced_revision)
            .map(|stored| stored.commit.clone())
            .collect::<Vec<_>>();
        commits.sort_by_key(|commit| commit.revision);
        let history_is_contiguous = commits
            .first()
            .is_some_and(|commit| commit.revision == self.last_announced_revision + 1)
            && commits
                .windows(2)
                .all(|window| window[1].revision == window[0].revision + 1)
            && commits
                .last()
                .is_some_and(|commit| commit.revision == self.transaction.revision);

        let catalog_version = self.transaction.catalog.version.clone();
        let published = if history_is_contiguous {
            for commit in &commits {
                super::global::GlobalConfigManager::publish_external_commit(ConfigCommittedEvent {
                    commit_id: commit.commit_id.clone(),
                    revision: commit.revision,
                    catalog_version: catalog_version.clone(),
                    scope: commit.scope.clone(),
                    source: commit.source.clone(),
                    changes: commit.changes.clone(),
                    affected_sections: commit.affected_sections.clone(),
                    committed_at: commit.committed_at,
                });
            }
            commits.len()
        } else {
            warn!(
                "Config commit history gap detected; publishing authoritative snapshot refresh: from_revision={}, to_revision={}",
                self.last_announced_revision, self.transaction.revision
            );
            super::global::GlobalConfigManager::publish_external_commit(ConfigCommittedEvent {
                commit_id: format!("cfg-external-snapshot-{}", self.transaction.revision),
                revision: self.transaction.revision,
                catalog_version,
                scope: ConfigScope::user(),
                source: ConfigChangeSource {
                    kind: ConfigChangeSourceKind::System,
                    surface: Some("config-external-snapshot-refresh".to_string()),
                    request_id: None,
                },
                changes: snapshot_projection.changes.clone(),
                affected_sections: snapshot_projection.affected_sections.clone(),
                committed_at: self.config.last_modified,
            });
            1
        };
        self.last_announced_revision = self.transaction.revision;
        published
    }

    async fn persist_transaction_state(
        &mut self,
        authority: &atomic_store::ExclusiveFileLock,
        mut next: ConfigTransactionState,
    ) -> CoreResult<()> {
        next.prune_transaction_history(chrono::Utc::now().timestamp_millis());
        let mut candidate = self.config.clone();
        candidate.transaction_journal = Some(
            self.secret_store
                .seal_journal(&next.durable_journal())
                .await?,
        );
        self.persist_candidate(authority, &candidate).await?;
        synchronize_undo_confirmation_index(&self.transaction, &next);
        self.config = candidate;
        self.transaction = next;
        Ok(())
    }

    async fn ensure_valid_candidate(&self, candidate: &GlobalConfig) -> CoreResult<()> {
        let validation = validation::validate_config(candidate);
        if validation.valid {
            return Ok(());
        }
        let messages = validation
            .errors
            .iter()
            .map(|error| error.message.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        Err(CoreError::validation(format!(
            "Invalid configuration candidate: {messages}"
        )))
    }

    pub(super) fn raw_changes_between(
        &self,
        candidate: &GlobalConfig,
    ) -> CoreResult<Vec<RawConfigChange>> {
        let defaults_value = serde_json::to_value(&self.defaults).map_err(|error| {
            CoreError::config(format!("Failed to serialize default config: {error}"))
        })?;
        let old_value = serde_json::to_value(&self.config)
            .map_err(|error| CoreError::config(format!("Failed to serialize config: {error}")))?;
        let new_value = serde_json::to_value(candidate)
            .map_err(|error| CoreError::config(format!("Failed to serialize config: {error}")))?;
        let candidate_catalog = ConfigCatalog::build(&defaults_value, &new_value)?;
        let mut descriptors = BTreeMap::<String, SettingDescriptor>::new();
        for descriptor in self
            .transaction
            .catalog
            .settings
            .iter()
            .chain(candidate_catalog.settings.iter())
        {
            descriptors
                .entry(descriptor.storage.path.clone())
                .or_insert_with(|| descriptor.clone());
        }
        let mut changes = Vec::new();
        for (path, descriptor) in descriptors {
            if matches!(path.as_str(), "version" | "last_modified") || path.starts_with('_') {
                continue;
            }
            let before = get_value_at_path(&old_value, &path).unwrap_or(Value::Null);
            let after = get_value_at_path(&new_value, &path).unwrap_or(Value::Null);
            if before != after {
                changes.push(RawConfigChange {
                    setting_id: descriptor.id,
                    path,
                    before,
                    after,
                    risk: descriptor.policy.risk,
                    apply_strategy: descriptor.policy.apply_strategy,
                });
            }
        }
        Ok(changes)
    }

    fn descriptor_for_change(&self, change: &RawConfigChange) -> Option<&SettingDescriptor> {
        self.transaction.catalog.find(&change.setting_id)
    }

    fn public_plan_changes(
        &self,
        changes: &[RawConfigChange],
    ) -> CoreResult<Vec<ConfigPlanChange>> {
        changes
            .iter()
            .map(|change| {
                let descriptor = self.descriptor_for_change(change).ok_or_else(|| {
                    CoreError::config(format!(
                        "Catalog descriptor missing for setting '{}'",
                        change.setting_id
                    ))
                })?;
                Ok(ConfigPlanChange {
                    setting_id: change.setting_id.clone(),
                    before: redact_value(descriptor, change.before.clone()),
                    after: redact_value(descriptor, change.after.clone()),
                    risk: change.risk,
                    apply_strategy: change.apply_strategy,
                })
            })
            .collect()
    }

    fn affected_sections(
        &self,
        changes: &[RawConfigChange],
    ) -> CoreResult<Vec<SettingsSectionRef>> {
        affected_sections_from_catalog(&self.transaction.catalog, changes)
    }

    pub(super) async fn commit_candidate(
        &mut self,
        authority: &atomic_store::ExclusiveFileLock,
        mut candidate: GlobalConfig,
        source: ConfigChangeSource,
        raw_changes: Vec<RawConfigChange>,
        mutation: CommitMutation,
    ) -> CoreResult<ConfigCommit> {
        candidate.transaction_journal = self.config.transaction_journal.clone();
        self.ensure_valid_candidate(&candidate).await?;
        if raw_changes.is_empty() {
            let commit = ConfigCommit {
                commit_id: format!("cfg-noop-{}", uuid::Uuid::new_v4()),
                revision: self.transaction.revision,
                status: super::transaction::ConfigCommitStatus::Applied,
                scope: ConfigScope::user(),
                source,
                changes: Vec::new(),
                apply_receipts: Vec::new(),
                affected_sections: Vec::new(),
                restart_required: Vec::new(),
                undo_token: None,
                committed_at: chrono::Utc::now(),
            };
            match mutation {
                CommitMutation::Plan {
                    plan_id,
                    idempotency_key,
                    fingerprint,
                } => {
                    let mut next = self.transaction.clone();
                    next.pending_plans.remove(&plan_id);
                    next.idempotency.insert(
                        idempotency_key,
                        IdempotencyRecord {
                            fingerprint,
                            commit: commit.clone(),
                        },
                    );
                    self.persist_transaction_state(authority, next).await?;
                    remove_plan_confirmation(&plan_id);
                    return Ok(commit);
                }
                CommitMutation::Undo { .. } | CommitMutation::AutoRollback { .. } => {
                    return Err(CoreError::validation(
                        "config.compensating_commit_has_no_changes",
                    ));
                }
            }
        }

        let defaults_value = serde_json::to_value(&self.defaults).map_err(|error| {
            CoreError::config(format!("Failed to serialize default config: {error}"))
        })?;
        let prospective_value = serde_json::to_value(&candidate).map_err(|error| {
            CoreError::config(format!("Failed to serialize config candidate: {error}"))
        })?;
        let prospective_catalog = ConfigCatalog::build(&defaults_value, &prospective_value)?;
        for change in &raw_changes {
            let descriptor = prospective_catalog
                .find(&change.setting_id)
                .or_else(|| self.descriptor_for_change(change))
                .ok_or_else(|| {
                    CoreError::config(format!(
                        "Catalog descriptor missing for setting '{}'",
                        change.setting_id
                    ))
                })?;
            if descriptor.policy.mutability == SettingMutability::ReadOnly {
                return Err(CoreError::validation(format!(
                    "Setting '{}' is read-only",
                    descriptor.id
                )));
            }
            if get_value_at_path(&prospective_value, &change.path).is_some() {
                policy::validate_write(descriptor, &change.after, source.kind)?;
            } else {
                policy::validate_delete(descriptor, source.kind)?;
            }
        }

        let committed_at = chrono::Utc::now();
        let mut next_transaction = self.transaction.clone();
        next_transaction.prune_transaction_history(committed_at.timestamp_millis());
        let next_revision = next_transaction
            .revision
            .checked_add(1)
            .ok_or_else(|| CoreError::config("Configuration revision exhausted"))?;
        candidate.last_modified = committed_at;
        let candidate_value = serde_json::to_value(&candidate).map_err(|error| {
            CoreError::config(format!("Failed to serialize config candidate: {error}"))
        })?;
        let next_catalog = ConfigCatalog::build(&defaults_value, &candidate_value)?;
        let changes = raw_changes
            .iter()
            .map(|change| {
                let descriptor = next_catalog
                    .find(&change.setting_id)
                    .or_else(|| self.descriptor_for_change(change))
                    .ok_or_else(|| {
                        CoreError::config(format!(
                            "Catalog descriptor missing for setting '{}'",
                            change.setting_id
                        ))
                    })?;
                Ok(ConfigValueChange {
                    setting_id: change.setting_id.clone(),
                    path: change.path.clone(),
                    old_value: redact_value(descriptor, change.before.clone()),
                    new_value: redact_value(descriptor, change.after.clone()),
                    apply_strategy: change.apply_strategy,
                })
            })
            .collect::<CoreResult<Vec<_>>>()?;
        let affected_sections = affected_sections_from_catalogs(
            &next_catalog,
            Some(&next_transaction.catalog),
            &raw_changes,
        )?;
        let prepared_applies = prepare_config_apply(&self.config, &candidate, &changes).await?;

        let (status, apply_receipts, restart_required) =
            build_apply_receipts(&changes, prepared_applies.receipt_routes());

        let commit_id = format!("cfg-commit-{}", uuid::Uuid::new_v4());
        let mut commit = ConfigCommit {
            commit_id: commit_id.clone(),
            revision: next_revision,
            status,
            scope: ConfigScope::user(),
            source: source.clone(),
            changes: changes.clone(),
            apply_receipts,
            affected_sections: affected_sections.clone(),
            restart_required,
            undo_token: Some(format!("cfg-undo-{}", uuid::Uuid::new_v4())),
            committed_at,
        };
        let max_risk = changes
            .iter()
            .try_fold(SettingRisk::Safe, |current, change| {
                let descriptor = next_catalog.find(&change.setting_id).ok_or_else(|| {
                    CoreError::config(format!(
                        "Committed setting is missing from the authoritative catalog: {}",
                        change.setting_id
                    ))
                })?;
                Ok::<_, CoreError>(current.max(descriptor.policy.risk))
            })?;
        let stored = StoredConfigCommit {
            commit: commit.clone(),
            raw_changes,
            max_risk,
        };
        next_transaction.revision = next_revision;
        next_transaction.catalog = next_catalog;
        next_transaction
            .commits
            .insert(commit_id.clone(), stored.clone());

        let completed_plan_id = match mutation {
            CommitMutation::Plan {
                plan_id,
                idempotency_key,
                fingerprint,
            } => {
                next_transaction.pending_plans.remove(&plan_id);
                next_transaction.idempotency.insert(
                    idempotency_key,
                    IdempotencyRecord {
                        fingerprint,
                        commit: commit.clone(),
                    },
                );
                Some(plan_id)
            }
            CommitMutation::Undo {
                original_commit_id,
                idempotency_key,
                fingerprint,
            } => {
                if let Some(original) = next_transaction.commits.get_mut(&original_commit_id) {
                    original.raw_changes.clear();
                    original.commit.undo_token = None;
                }
                for record in next_transaction.idempotency.values_mut() {
                    if record.commit.commit_id == original_commit_id {
                        record.commit.undo_token = None;
                    }
                }
                next_transaction.idempotency.insert(
                    idempotency_key,
                    IdempotencyRecord {
                        fingerprint,
                        commit: commit.clone(),
                    },
                );
                None
            }
            CommitMutation::AutoRollback { original_commit_id } => {
                if let Some(original) = next_transaction.commits.get_mut(&original_commit_id) {
                    original.raw_changes.clear();
                    original.commit.status = super::transaction::ConfigCommitStatus::RolledBack;
                    original.commit.undo_token = None;
                    for receipt in &mut original.commit.apply_receipts {
                        receipt.status = super::transaction::ConfigApplyReceiptStatus::RolledBack;
                    }
                }
                for record in next_transaction.idempotency.values_mut() {
                    if record.commit.commit_id == original_commit_id {
                        record.commit.status = super::transaction::ConfigCommitStatus::RolledBack;
                        record.commit.undo_token = None;
                        for receipt in &mut record.commit.apply_receipts {
                            receipt.status =
                                super::transaction::ConfigApplyReceiptStatus::RolledBack;
                        }
                    }
                }
                if let Some(stored_rollback) = next_transaction.commits.get_mut(&commit_id) {
                    stored_rollback.raw_changes.clear();
                    stored_rollback.commit.undo_token = None;
                    commit = stored_rollback.commit.clone();
                }
                None
            }
        };
        next_transaction.prune_transaction_history(committed_at.timestamp_millis());
        candidate.transaction_journal = Some(
            self.secret_store
                .seal_journal(&next_transaction.durable_journal())
                .await?,
        );
        self.persist_candidate(authority, &candidate).await?;
        synchronize_undo_confirmation_index(&self.transaction, &next_transaction);
        self.config = candidate;
        self.transaction = next_transaction;
        self.last_announced_revision = next_revision;
        if let Some(plan_id) = completed_plan_id {
            remove_plan_confirmation(&plan_id);
        }

        super::global::GlobalConfigManager::publish_commit(
            ConfigCommittedEvent {
                commit_id: commit_id.clone(),
                revision: next_revision,
                catalog_version: self.transaction.catalog.version.clone(),
                scope: ConfigScope::user(),
                source,
                changes,
                affected_sections,
                committed_at,
            },
            &commit,
            self.config.clone(),
            prepared_applies,
        );
        Ok(commit)
    }
}

fn affected_sections_from_catalog(
    catalog: &ConfigCatalog,
    changes: &[RawConfigChange],
) -> CoreResult<Vec<SettingsSectionRef>> {
    affected_sections_from_catalogs(catalog, None, changes)
}

fn affected_sections_from_catalogs(
    catalog: &ConfigCatalog,
    previous_catalog: Option<&ConfigCatalog>,
    changes: &[RawConfigChange],
) -> CoreResult<Vec<SettingsSectionRef>> {
    let mut sections: BTreeMap<(String, String, String), BTreeSet<String>> = BTreeMap::new();
    for change in changes {
        let descriptor = catalog
            .find(&change.setting_id)
            .or_else(|| previous_catalog.and_then(|catalog| catalog.find(&change.setting_id)))
            .ok_or_else(|| {
                CoreError::config(format!(
                    "Catalog descriptor missing for setting '{}'",
                    change.setting_id
                ))
            })?;
        let presentation = &descriptor.presentation;
        sections
            .entry((
                presentation.category_id.clone(),
                presentation.tab_id.clone(),
                presentation.section_id.clone(),
            ))
            .or_default()
            .insert(presentation.field_id.clone());
    }
    Ok(sections
        .into_iter()
        .map(
            |((category_id, tab_id, section_id), field_ids)| SettingsSectionRef {
                category_id,
                tab_id,
                section_id,
                field_ids: field_ids.into_iter().collect(),
            },
        )
        .collect())
}

fn require_idempotency_key(key: &str) -> CoreResult<()> {
    require_nonempty("idempotency_key", key)
}

fn require_nonempty(field: &str, value: &str) -> CoreResult<()> {
    if value.trim().is_empty() {
        return Err(CoreError::validation(format!("{field} must not be empty")));
    }
    Ok(())
}

fn hash_serializable(value: &impl Serialize) -> CoreResult<String> {
    let bytes = serde_json::to_vec(value)
        .map_err(|error| CoreError::config(format!("Failed to hash request: {error}")))?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn config_snapshot_payload(config: &GlobalConfig) -> CoreResult<Value> {
    let mut snapshot = config.clone();
    snapshot.transaction_journal = None;
    serde_json::to_value(snapshot).map_err(|error| {
        CoreError::config(format!(
            "Failed to serialize configuration integrity payload: {error}"
        ))
    })
}

/// Configuration statistics.
#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigStatistics {
    pub total_ai_models: usize,
    pub has_default_model: bool,
    pub config_directory: PathBuf,
    pub last_modified: chrono::DateTime<chrono::Utc>,
}

#[cfg(test)]
mod transaction_tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn normalizes_retired_builtin_theme_selections() {
        for (retired, expected) in [
            ("sparo-china-style", "light"),
            ("slate", "dark"),
            ("sparo-china-night", "dark"),
            ("sparo-cyber", "dark"),
        ] {
            let mut config = GlobalConfig::default();
            config.themes.current = retired.to_string();

            normalize_retired_theme_selection(&mut config);

            assert_eq!(config.themes.current, expected);
        }
    }

    #[test]
    fn leaves_unknown_theme_selections_for_validation() {
        let mut config = GlobalConfig::default();
        config.themes.current = "unknown-theme".to_string();

        normalize_retired_theme_selection(&mut config);

        assert_eq!(config.themes.current, "unknown-theme");
    }

    async fn isolated_manager() -> (tempfile::TempDir, ConfigManager) {
        let temp = tempfile::tempdir().expect("tempdir");
        let path_manager = Arc::new(PathManager::with_user_root_for_tests(
            temp.path().join("user-root"),
        ));
        let manager = ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("manager");
        (temp, manager)
    }

    async fn read_only_manager(path_manager: Arc<PathManager>) -> ConfigManager {
        ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager),
            startup_failure_policy: ConfigStartupFailurePolicy::ReadOnlyDefaults,
        })
        .await
        .expect("desktop recovery manager")
    }

    fn assert_read_only_status(manager: &ConfigManager, expected_phase: ConfigStartupFailurePhase) {
        let status = manager.startup_status();
        assert_eq!(status.mode, ConfigStartupMode::ReadOnlyDefaults);
        assert_eq!(status.schema_version, CONFIG_SCHEMA_VERSION);
        assert!(!status.writes_allowed);
        assert!(status.source_preserved);
        assert!(status.rebuild_allowed);
        assert_eq!(
            status.issue.as_ref().map(|issue| issue.phase),
            Some(expected_phase)
        );
        assert_eq!(manager.config.version, CONFIG_SCHEMA_VERSION);
        assert_eq!(
            serde_json::to_value(&manager.config).expect("serialize recovery config"),
            serde_json::to_value(&manager.defaults).expect("serialize recovery defaults")
        );
        assert_eq!(manager.transaction.revision, 1);
    }

    #[tokio::test]
    async fn startup_rejects_unsupported_config_version() {
        let (_temp, manager) = isolated_manager().await;
        let path_manager = manager.path_manager.clone();
        let config_file = path_manager.app_config_file();
        let mut persisted: Value = serde_json::from_slice(
            &tokio::fs::read(&config_file)
                .await
                .expect("read persisted config"),
        )
        .expect("parse persisted config");
        persisted["version"] = Value::String("0.0.0".to_string());
        tokio::fs::write(
            &config_file,
            serde_json::to_vec_pretty(&persisted).expect("serialize config"),
        )
        .await
        .expect("write invalid config version");
        drop(manager);

        let error = match ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager),
            ..ConfigManagerSettings::default()
        })
        .await
        {
            Ok(_) => panic!("unsupported config version must fail"),
            Err(error) => error,
        };

        assert!(error.to_string().contains("Unsupported config version"));
    }

    #[tokio::test]
    async fn startup_accepts_removed_fields_and_canonicalizes_them_on_next_save() {
        let (_temp, mut manager) = isolated_manager().await;
        let path_manager = manager.path_manager.clone();
        let config_file = path_manager.app_config_file();
        let seeded = commit_language(&mut manager, "en-US", "seed-stale-history").await;
        let stale = manager
            .transaction
            .commits
            .get_mut(&seeded.commit_id)
            .expect("seeded commit");
        stale.raw_changes[0].setting_id = "core.themes.pointer.scale".to_string();
        stale.raw_changes[0].path = "themes.pointer.scale".to_string();
        let authority = atomic_store::lock_exclusive(&config_file)
            .await
            .expect("config authority");
        let stale_transaction = manager.transaction.clone();
        manager
            .persist_transaction_state(&authority, stale_transaction)
            .await
            .expect("persist stale journal");
        drop(authority);

        let mut persisted: Value = serde_json::from_slice(
            &tokio::fs::read(&config_file)
                .await
                .expect("read persisted config"),
        )
        .expect("parse persisted config");
        persisted["themes"]["pointer"] = serde_json::json!({
            "scale": 1.25,
            "accent": "legacy"
        });
        tokio::fs::write(
            &config_file,
            serde_json::to_vec_pretty(&persisted).expect("serialize config with removed field"),
        )
        .await
        .expect("write config with removed field");
        drop(manager);

        let mut restarted = ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager.clone()),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("removed fields must not block startup");
        assert!(restarted.startup_status().is_persistent());
        assert!(restarted.startup_status().writes_allowed);
        assert_eq!(
            restarted.config.themes.current,
            persisted["themes"]["current"]
        );
        assert_eq!(restarted.transaction.revision, seeded.revision);
        assert!(!restarted
            .transaction
            .commits
            .contains_key(&seeded.commit_id));
        assert!(!restarted
            .transaction
            .idempotency
            .contains_key("seed-stale-history"));

        let unchanged: Value = serde_json::from_slice(
            &tokio::fs::read(&config_file)
                .await
                .expect("read unchanged config"),
        )
        .expect("parse unchanged config");
        assert!(unchanged["themes"].get("pointer").is_some());

        commit_language(&mut restarted, "zh-CN", "canonicalize-removed-field").await;
        let canonical: Value = serde_json::from_slice(
            &tokio::fs::read(&config_file)
                .await
                .expect("read canonical config"),
        )
        .expect("parse canonical config");
        assert!(canonical["themes"].get("pointer").is_none());
        assert_eq!(canonical["app"]["language"], "zh-CN");
    }

    #[tokio::test]
    async fn read_only_defaults_preserve_sources_until_explicit_default_rebuild() {
        let (_temp, manager) = isolated_manager().await;
        let path_manager = manager.path_manager.clone();
        let config_file = path_manager.app_config_file();
        let vault_file = path_manager.secrets_dir().join("config_secrets.json");
        let key_file = path_manager.secrets_dir().join(".config_secrets.key");
        let mut persisted: Value = serde_json::from_slice(
            &tokio::fs::read(&config_file)
                .await
                .expect("read persisted config"),
        )
        .expect("parse persisted config");
        persisted["app"]["language"] = Value::Bool(true);
        let original_config =
            serde_json::to_vec_pretty(&persisted).expect("serialize invalid current config");
        let original_vault = b"original-vault-bytes".to_vec();
        let original_key = b"original-key-bytes".to_vec();
        tokio::fs::write(&config_file, &original_config)
            .await
            .expect("write invalid current config");
        tokio::fs::write(&vault_file, &original_vault)
            .await
            .expect("write sentinel vault");
        tokio::fs::write(&key_file, &original_key)
            .await
            .expect("write sentinel key");
        drop(manager);

        let mut recovered = read_only_manager(path_manager.clone()).await;
        assert_read_only_status(&recovered, ConfigStartupFailurePhase::Load);
        let snapshot = recovered
            .get_snapshot()
            .expect("read-only defaults still expose a redacted snapshot");
        assert_eq!(snapshot.revision, 1);
        assert_eq!(
            tokio::fs::read(&config_file)
                .await
                .expect("read app config"),
            original_config
        );
        assert_eq!(
            tokio::fs::read(&vault_file).await.expect("read vault"),
            original_vault
        );
        assert_eq!(
            tokio::fs::read(&key_file).await.expect("read key"),
            original_key
        );

        let error = recovered
            .plan_patch(ConfigPatch {
                request_id: "recovery-write".to_string(),
                idempotency_key: "recovery-write-plan".to_string(),
                expected_revision: 1,
                source: manual_source(),
                scope: ConfigScope::user(),
                operations: Vec::new(),
            })
            .await
            .expect_err("read-only recovery rejects every write before disk authority");
        assert!(error.to_string().contains("config.recovery_read_only"));
        assert_eq!(
            tokio::fs::read(&config_file)
                .await
                .expect("read app config"),
            original_config
        );
        assert_eq!(
            tokio::fs::read(&vault_file).await.expect("read vault"),
            original_vault
        );
        assert_eq!(
            tokio::fs::read(&key_file).await.expect("read key"),
            original_key
        );

        let rebuilt_status = recovered
            .rebuild_default_config()
            .await
            .expect("explicit recovery rebuild succeeds");
        assert!(rebuilt_status.is_persistent());
        assert!(rebuilt_status.writes_allowed);
        assert!(!rebuilt_status.rebuild_allowed);
        let rebuilt: Value = serde_json::from_slice(
            &tokio::fs::read(&config_file)
                .await
                .expect("read rebuilt default config"),
        )
        .expect("parse rebuilt default config");
        assert_eq!(rebuilt["version"], CONFIG_SCHEMA_VERSION);
        assert_eq!(rebuilt["app"]["language"], "zh-CN");
        assert!(!vault_file.exists());
        assert!(!key_file.exists());

        for directory in [path_manager.user_config_dir(), path_manager.secrets_dir()] {
            let mut entries = tokio::fs::read_dir(directory)
                .await
                .expect("read recovery storage directory");
            while let Some(entry) = entries.next_entry().await.expect("read directory entry") {
                assert!(
                    !entry.file_name().to_string_lossy().ends_with(".tmp"),
                    "recovery must not leave atomic temp artifacts"
                );
            }
        }
    }

    #[tokio::test]
    async fn read_only_defaults_cover_semantic_validation_failure() {
        let (_temp, manager) = isolated_manager().await;
        let path_manager = manager.path_manager.clone();
        let config_file = path_manager.app_config_file();
        let mut persisted: Value = serde_json::from_slice(
            &tokio::fs::read(&config_file)
                .await
                .expect("read persisted config"),
        )
        .expect("parse persisted config");
        persisted["ai"]["auto_memory"]["global"]["extract_every_eligible_turns"] = Value::from(10);
        persisted["ai"]["auto_memory"]["global"]["force_extract_after_pending_eligible_turns"] =
            Value::from(10);
        let original = serde_json::to_vec_pretty(&persisted).expect("serialize invalid config");
        tokio::fs::write(&config_file, &original)
            .await
            .expect("write semantically invalid config");
        drop(manager);

        let strict_error = ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager.clone()),
            startup_failure_policy: ConfigStartupFailurePolicy::Strict,
        })
        .await
        .err()
        .expect("strict startup must reject semantic validation failure");
        assert!(strict_error
            .to_string()
            .contains("force_extract_after_pending_eligible_turns"));
        assert_eq!(
            tokio::fs::read(&config_file)
                .await
                .expect("read unchanged strict config"),
            original
        );

        let recovered = read_only_manager(path_manager).await;
        assert_read_only_status(&recovered, ConfigStartupFailurePhase::Validation);
        assert_eq!(
            tokio::fs::read(&config_file)
                .await
                .expect("read unchanged invalid config"),
            original
        );
    }

    #[tokio::test]
    async fn read_only_defaults_cover_transaction_journal_failure_without_writing() {
        let (_temp, manager) = isolated_manager().await;
        let path_manager = manager.path_manager.clone();
        let config_file = path_manager.app_config_file();
        let mut persisted: Value = serde_json::from_slice(
            &tokio::fs::read(&config_file)
                .await
                .expect("read persisted config"),
        )
        .expect("parse persisted config");
        persisted["_transactionJournal"] = Value::String("invalid-journal".to_string());
        let original = serde_json::to_vec_pretty(&persisted).expect("serialize invalid journal");
        tokio::fs::write(&config_file, &original)
            .await
            .expect("write invalid journal");
        drop(manager);

        let recovered = read_only_manager(path_manager.clone()).await;
        assert_read_only_status(&recovered, ConfigStartupFailurePhase::Journal);
        assert_eq!(
            tokio::fs::read(&config_file)
                .await
                .expect("read unchanged journal config"),
            original
        );
        assert!(!path_manager
            .secrets_dir()
            .join("config_secrets.json")
            .exists());
        assert!(!path_manager
            .secrets_dir()
            .join(".config_secrets.key")
            .exists());
    }

    #[tokio::test]
    async fn import_requires_current_config_schema_version() {
        let (_temp, mut manager) = isolated_manager().await;
        let mut imported = manager.config.clone();
        imported.version = "0.1.0".to_string();

        let error = manager
            .import_config(
                serde_json::to_value(imported).expect("serialize imported config"),
                manager.transaction.revision,
                "legacy-import-version".to_string(),
                true,
            )
            .await
            .expect_err("legacy import version must fail");

        assert!(error.to_string().contains(&format!(
            "config.import_version_mismatch: expected {CONFIG_SCHEMA_VERSION}, received 0.1.0"
        )));
    }

    #[tokio::test]
    async fn startup_rejects_invalid_model_references_without_repairing_them() {
        let (_temp, manager) = isolated_manager().await;
        let path_manager = manager.path_manager.clone();
        let config_file = path_manager.app_config_file();
        let mut persisted: Value = serde_json::from_slice(
            &tokio::fs::read(&config_file)
                .await
                .expect("read persisted config"),
        )
        .expect("parse persisted config");
        persisted["ai"]["default_models"]["primary"] = Value::String("missing-model".to_string());
        tokio::fs::write(
            &config_file,
            serde_json::to_vec_pretty(&persisted).expect("serialize config"),
        )
        .await
        .expect("write invalid model reference");
        drop(manager);

        let error = match ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager),
            ..ConfigManagerSettings::default()
        })
        .await
        {
            Ok(_) => panic!("invalid model references must fail startup"),
            Err(error) => error,
        };

        assert!(error
            .to_string()
            .contains("references missing or disabled model 'missing-model'"));
    }

    fn manual_source() -> ConfigChangeSource {
        ConfigChangeSource {
            kind: ConfigChangeSourceKind::Manual,
            surface: Some("config-transaction-test".to_string()),
            request_id: None,
        }
    }

    fn no_op_config_apply() -> super::super::apply::ConfigApply {
        Arc::new(|_| Box::pin(async { Ok(()) }))
    }

    fn ai_runtime_patterns() -> Vec<super::super::apply::ConfigApplyPathPattern> {
        use super::super::apply::ConfigApplyPathPattern;
        vec![
            ConfigApplyPathPattern::prefix("ai.models"),
            ConfigApplyPathPattern::prefix("ai.default_models"),
            ConfigApplyPathPattern::prefix("ai.agent_models"),
            ConfigApplyPathPattern::prefix("ai.func_agent_models"),
            ConfigApplyPathPattern::prefix("ai.proxy"),
            ConfigApplyPathPattern::exact("ai.stream_idle_timeout_secs"),
        ]
    }

    fn logging_patterns() -> Vec<super::super::apply::ConfigApplyPathPattern> {
        vec![super::super::apply::ConfigApplyPathPattern::exact(
            "app.logging.level",
        )]
    }

    fn i18n_patterns() -> Vec<super::super::apply::ConfigApplyPathPattern> {
        vec![super::super::apply::ConfigApplyPathPattern::exact(
            "app.language",
        )]
    }

    fn language_patch(revision: u64, language: &str) -> ConfigPatch {
        ConfigPatch {
            request_id: format!("request-{language}"),
            idempotency_key: format!("plan-{language}"),
            expected_revision: revision,
            source: manual_source(),
            scope: ConfigScope::user(),
            operations: vec![ConfigPatchOperation::Set {
                setting_id: "core.app.language".to_string(),
                value: Value::String(language.to_string()),
            }],
        }
    }

    async fn commit_language(
        manager: &mut ConfigManager,
        language: &str,
        idempotency_key: &str,
    ) -> ConfigCommit {
        commit_test_operations(
            manager,
            vec![ConfigPatchOperation::Set {
                setting_id: "core.app.language".to_string(),
                value: Value::String(language.to_string()),
            }],
            idempotency_key,
        )
        .await
    }

    async fn commit_test_operations(
        manager: &mut ConfigManager,
        operations: Vec<ConfigPatchOperation>,
        idempotency_key: &str,
    ) -> ConfigCommit {
        let revision = manager.transaction.revision;
        let plan = manager
            .plan_patch(ConfigPatch {
                request_id: format!("request-{idempotency_key}"),
                idempotency_key: format!("plan-{idempotency_key}"),
                expected_revision: revision,
                source: manual_source(),
                scope: ConfigScope::user(),
                operations,
            })
            .await
            .expect("plan");
        manager
            .commit_plan(CommitConfigPlanRequest {
                plan_id: plan.plan_id,
                expected_revision: revision,
                idempotency_key: idempotency_key.to_string(),
                confirmed: true,
            })
            .await
            .expect("commit")
    }

    #[tokio::test]
    async fn rejects_revision_conflict_before_planning() {
        let (_temp, mut manager) = isolated_manager().await;
        let result = manager
            .plan_patch(language_patch(manager.transaction.revision + 1, "en-US"))
            .await;
        assert!(result
            .expect_err("revision conflict")
            .to_string()
            .contains("config.revision_conflict"));
    }

    #[tokio::test]
    async fn planning_is_idempotent_and_rejects_key_reuse() {
        let (_temp, mut manager) = isolated_manager().await;
        let revision = manager.transaction.revision;
        let patch = language_patch(revision, "en-US");
        let first = manager.plan_patch(patch.clone()).await.expect("first plan");
        assert_eq!(
            manager.transaction.pending_plans[&first.plan_id]
                .source
                .request_id
                .as_deref(),
            Some("request-en-US")
        );
        let retry = manager.plan_patch(patch.clone()).await.expect("plan retry");
        assert_eq!(first.plan_id, retry.plan_id);

        let mut conflicting = patch;
        conflicting.operations = vec![ConfigPatchOperation::Set {
            setting_id: "core.app.language".to_string(),
            value: Value::String("ja-JP".to_string()),
        }];
        let error = manager
            .plan_patch(conflicting)
            .await
            .expect_err("idempotency conflict");
        assert!(error.to_string().contains("config.idempotency_conflict"));
    }

    #[tokio::test]
    async fn model_plan_preserves_redacted_api_key_against_current_revision() {
        let (_temp, mut manager) = isolated_manager().await;
        let model = AIModelConfig {
            id: "model-one".to_string(),
            name: "Provider".to_string(),
            provider: "openai".to_string(),
            model_name: "model-one".to_string(),
            base_url: "https://example.com/v1".to_string(),
            api_key: "secret-one".to_string(),
            enabled: true,
            ..AIModelConfig::default()
        };
        commit_test_operations(
            &mut manager,
            vec![ConfigPatchOperation::Set {
                setting_id: "core.ai.models".to_string(),
                value: serde_json::to_value(vec![model]).expect("model value"),
            }],
            "seed-model-with-secret",
        )
        .await;
        let current_value = serde_json::to_value(&manager.config).expect("current");
        let descriptor = manager
            .transaction
            .catalog
            .find_by_path("ai.models")
            .expect("models descriptor")
            .clone();
        let snapshot = manager.transaction.snapshot(&current_value);
        let mut proposed = match snapshot.values[&descriptor.id].clone() {
            sparo_events::ConfigStoredValue::Value { value } => value,
            other => panic!("expected sanitized model value, received {other:?}"),
        };
        proposed[0]["enabled"] = Value::Bool(false);

        let plan = manager
            .plan_patch(ConfigPatch {
                request_id: "request-model-update".to_string(),
                idempotency_key: "plan-model-update".to_string(),
                expected_revision: manager.transaction.revision,
                source: manual_source(),
                scope: ConfigScope::user(),
                operations: vec![ConfigPatchOperation::Set {
                    setting_id: descriptor.id,
                    value: proposed,
                }],
            })
            .await
            .expect("model plan");
        let candidate = &manager.transaction.pending_plans[&plan.plan_id].candidate;

        assert_eq!(candidate.ai.models[0].api_key, "secret-one");
        assert!(!candidate.ai.models[0].enabled);
    }

    #[tokio::test]
    async fn rejects_stale_plan_after_an_intervening_commit() {
        let (_temp, mut manager) = isolated_manager().await;
        let revision = manager.transaction.revision;
        let stale = manager
            .plan_patch(language_patch(revision, "zh-CN"))
            .await
            .expect("stale plan");
        let winner = manager
            .plan_patch(language_patch(revision, "en-US"))
            .await
            .expect("winner plan");
        manager
            .commit_plan(CommitConfigPlanRequest {
                plan_id: winner.plan_id,
                expected_revision: revision,
                idempotency_key: "winner".to_string(),
                confirmed: true,
            })
            .await
            .expect("winner commit");
        let result = manager
            .commit_plan(CommitConfigPlanRequest {
                plan_id: stale.plan_id,
                expected_revision: revision,
                idempotency_key: "stale".to_string(),
                confirmed: true,
            })
            .await;
        assert!(result
            .expect_err("stale plan")
            .to_string()
            .contains("config.stale_plan"));
    }

    #[tokio::test]
    async fn retries_same_idempotent_commit_without_advancing_revision() {
        let (_temp, mut manager) = isolated_manager().await;
        let revision = manager.transaction.revision;
        let plan = manager
            .plan_patch(language_patch(revision, "en-US"))
            .await
            .expect("plan");
        let request = CommitConfigPlanRequest {
            plan_id: plan.plan_id,
            expected_revision: revision,
            idempotency_key: "same-request".to_string(),
            confirmed: true,
        };
        let first = manager
            .commit_plan(request.clone())
            .await
            .expect("first commit");
        let retry = manager
            .commit_plan(request)
            .await
            .expect("idempotent retry");
        assert_eq!(first.commit_id, retry.commit_id);
        assert_eq!(first.revision, retry.revision);
        assert_eq!(manager.transaction.revision, first.revision);
    }

    #[tokio::test]
    async fn adapter_setting_without_a_live_owner_is_saved_for_restart() {
        let _apply_test_guard = super::super::apply::acquire_config_apply_test_lock().await;
        let (_temp, mut manager) = isolated_manager().await;
        let next_language = if manager.config.app.language == "zh-CN" {
            "en-US"
        } else {
            "zh-CN"
        };

        let commit =
            commit_language(&mut manager, next_language, "inactive-runtime-language").await;

        assert_eq!(manager.config.app.language, next_language);
        assert_eq!(
            commit.status,
            super::super::transaction::ConfigCommitStatus::Applied
        );
        assert_eq!(commit.apply_receipts.len(), 1);
        let receipt = &commit.apply_receipts[0];
        assert_eq!(
            receipt.consumer,
            super::super::apply::CONFIG_APPLY_CONSUMER_INACTIVE_RUNTIME
        );
        assert_eq!(
            receipt.status,
            super::super::transaction::ConfigApplyReceiptStatus::RestartRequired
        );
        assert!(!receipt.critical);
        assert_eq!(
            commit.restart_required,
            vec!["core.app.language".to_string()]
        );
    }

    #[tokio::test]
    async fn undo_rejects_when_a_related_path_changed_later() {
        let (_temp, mut manager) = isolated_manager().await;
        let original = commit_language(&mut manager, "en-US", "first-language").await;
        commit_language(&mut manager, "zh-CN", "second-language").await;
        let result = manager
            .undo_commit(
                UndoConfigCommitRequest {
                    commit_id: original.commit_id,
                    undo_token: original.undo_token.expect("undo token"),
                    expected_revision: manager.transaction.revision,
                    idempotency_key: "undo-first".to_string(),
                    confirmed: true,
                },
                manual_source(),
            )
            .await;
        assert!(result
            .expect_err("undo conflict")
            .to_string()
            .contains("config.undo_conflict"));
    }

    #[tokio::test]
    async fn undo_requires_the_opaque_token_issued_for_the_commit() {
        let (_temp, mut manager) = isolated_manager().await;
        let original = commit_language(&mut manager, "en-US", "token-protected-language").await;
        let revision = manager.transaction.revision;

        let error = manager
            .undo_commit(
                UndoConfigCommitRequest {
                    commit_id: original.commit_id.clone(),
                    undo_token: "wrong-token".to_string(),
                    expected_revision: revision,
                    idempotency_key: "undo-with-wrong-token".to_string(),
                    confirmed: true,
                },
                manual_source(),
            )
            .await
            .expect_err("invalid token must be rejected");
        assert!(error.to_string().contains("config.undo_token_invalid"));

        let undo_source = ConfigChangeSource {
            kind: ConfigChangeSourceKind::Ai,
            surface: Some("settings-ai-mode".to_string()),
            request_id: Some("settings-turn-1".to_string()),
        };
        let undone = manager
            .undo_commit(
                UndoConfigCommitRequest {
                    commit_id: original.commit_id.clone(),
                    undo_token: original.undo_token.expect("undo token"),
                    expected_revision: revision,
                    idempotency_key: "undo-with-valid-token".to_string(),
                    confirmed: true,
                },
                undo_source.clone(),
            )
            .await
            .expect("valid token should undo the commit");
        assert_eq!(undone.source, undo_source);
        assert!(undone.undo_token.is_some());
        assert!(manager
            .transaction
            .commits
            .get(&original.commit_id)
            .is_some_and(|stored| {
                stored.raw_changes.is_empty() && stored.commit.undo_token.is_none()
            }));
    }

    #[tokio::test]
    async fn model_change_and_reference_repairs_publish_one_commit() {
        let _apply_test_guard = super::super::apply::acquire_config_apply_test_lock().await;
        let (_temp, mut manager) = isolated_manager().await;
        let _adapter = super::super::apply::register_config_apply_adapter(
            super::super::apply::CONFIG_APPLY_CONSUMER_AI_MODEL_RUNTIME,
            ai_runtime_patterns(),
            super::super::apply::ConfigApplyAdapterCriticality::Critical,
            None,
            no_op_config_apply(),
        )
        .expect("register AI model apply adapter");
        let active = AIModelConfig {
            id: "active-id".to_string(),
            name: "Active".to_string(),
            provider: "openai".to_string(),
            model_name: "active-model".to_string(),
            base_url: "https://example.com/v1".to_string(),
            enabled: true,
            ..AIModelConfig::default()
        };
        let fallback = AIModelConfig {
            id: "fallback-id".to_string(),
            name: "Fallback".to_string(),
            provider: "openai".to_string(),
            model_name: "fallback-model".to_string(),
            base_url: "https://example.com/v1".to_string(),
            enabled: true,
            ..AIModelConfig::default()
        };
        commit_test_operations(
            &mut manager,
            vec![
                ConfigPatchOperation::Set {
                    setting_id: "core.ai.models".to_string(),
                    value: serde_json::json!([active.clone(), fallback.clone()]),
                },
                ConfigPatchOperation::Set {
                    setting_id: "core.ai.agent_models".to_string(),
                    value: serde_json::json!({ "test-agent": "active-id" }),
                },
                ConfigPatchOperation::Set {
                    setting_id: "core.ai.default_models.primary".to_string(),
                    value: serde_json::json!("active-id"),
                },
            ],
            "seed-models",
        )
        .await;

        let mut commits = super::super::global::GlobalConfigManager::subscribe_commits();
        let revision = manager.transaction.revision;
        let disabled = AIModelConfig {
            enabled: false,
            ..active
        };
        commit_test_operations(
            &mut manager,
            vec![ConfigPatchOperation::Set {
                setting_id: "core.ai.models".to_string(),
                value: serde_json::json!([disabled, fallback]),
            }],
            "disable-active-model",
        )
        .await;

        assert!(manager.transaction.revision > revision);
        assert_eq!(
            manager.config.ai.default_models.primary.as_deref(),
            Some("fallback-id")
        );
        assert!(!manager.config.ai.agent_models.contains_key("test-agent"));
        let event = tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                let event = commits.recv().await.expect("config commit channel");
                if event.source.request_id.as_deref() == Some("request-disable-active-model") {
                    break event;
                }
            }
        })
        .await
        .expect("model commit");
        assert_eq!(event.revision, manager.transaction.revision);
        assert!(event.changes_under("ai.models"));
        assert!(event.changes_under("ai.agent_models"));
        assert!(event.changes_under("ai.default_models"));
    }

    #[tokio::test]
    async fn critical_apply_failure_creates_a_non_undoable_compensating_commit() {
        let _apply_test_guard = super::super::apply::acquire_config_apply_test_lock().await;
        let (_temp, mut manager) = isolated_manager().await;
        let _adapter = super::super::apply::register_config_apply_adapter(
            super::super::apply::CONFIG_APPLY_CONSUMER_AI_MODEL_RUNTIME,
            ai_runtime_patterns(),
            super::super::apply::ConfigApplyAdapterCriticality::Critical,
            None,
            no_op_config_apply(),
        )
        .expect("register AI model apply adapter");
        let before = manager.config.ai.stream_idle_timeout_secs;
        let descriptor = manager
            .transaction
            .catalog
            .find_by_path("ai.stream_idle_timeout_secs")
            .expect("timeout descriptor")
            .clone();
        let revision = manager.transaction.revision;
        let plan = manager
            .plan_patch(ConfigPatch {
                request_id: "critical-apply-plan".to_string(),
                idempotency_key: "critical-apply-plan".to_string(),
                expected_revision: revision,
                source: manual_source(),
                scope: ConfigScope::user(),
                operations: vec![ConfigPatchOperation::Set {
                    setting_id: descriptor.id,
                    value: serde_json::json!(45),
                }],
            })
            .await
            .expect("plan critical change");
        let commit = manager
            .commit_plan(CommitConfigPlanRequest {
                plan_id: plan.plan_id,
                expected_revision: revision,
                idempotency_key: "critical-apply-commit".to_string(),
                confirmed: true,
            })
            .await
            .expect("commit critical change");
        assert_eq!(
            commit.status,
            super::super::transaction::ConfigCommitStatus::Applying
        );

        manager
            .record_apply_status(&ConfigApplyStatusEvent {
                commit_id: commit.commit_id.clone(),
                revision: commit.revision,
                consumer: super::super::apply::CONFIG_APPLY_CONSUMER_AI_MODEL_RUNTIME.to_string(),
                receipt_attempt: 1,
                status: ConfigApplyStatus::Failed,
                paths: vec!["ai.stream_idle_timeout_secs".to_string()],
                message: Some("test adapter failure".to_string()),
            })
            .await
            .expect("record critical failure");
        let (rollback, _) = manager
            .rollback_failed_commit(&commit.commit_id, commit.revision)
            .await
            .expect("auto rollback");

        assert!(rollback.revision > commit.revision);
        assert!(rollback.undo_token.is_none());
        assert_eq!(manager.config.ai.stream_idle_timeout_secs, before);
        assert!(manager
            .transaction
            .commits
            .get(&commit.commit_id)
            .is_some_and(|stored| {
                stored.raw_changes.is_empty()
                    && stored.commit.status
                        == super::super::transaction::ConfigCommitStatus::RolledBack
            }));
        assert!(manager
            .transaction
            .commits
            .get(&rollback.commit_id)
            .is_some_and(|stored| stored.raw_changes.is_empty()));
    }

    #[tokio::test]
    async fn failed_noncritical_apply_can_retry_without_accepting_a_late_attempt() {
        let _apply_test_guard = super::super::apply::acquire_config_apply_test_lock().await;
        let (_temp, mut manager) = isolated_manager().await;
        let _adapter = super::super::apply::register_config_apply_adapter(
            super::super::apply::CONFIG_APPLY_CONSUMER_RUNTIME_LOGGING,
            logging_patterns(),
            super::super::apply::ConfigApplyAdapterCriticality::NonCritical,
            None,
            no_op_config_apply(),
        )
        .expect("register logging apply adapter");
        let revision = manager.transaction.revision;
        let plan = manager
            .plan_patch(ConfigPatch {
                request_id: "retry-logging-plan".to_string(),
                idempotency_key: "retry-logging-plan".to_string(),
                expected_revision: revision,
                source: manual_source(),
                scope: ConfigScope::user(),
                operations: vec![ConfigPatchOperation::Set {
                    setting_id: "core.app.logging.level".to_string(),
                    value: serde_json::json!("info"),
                }],
            })
            .await
            .expect("plan logging change");
        let commit = manager
            .commit_plan(CommitConfigPlanRequest {
                plan_id: plan.plan_id,
                expected_revision: revision,
                idempotency_key: "retry-logging-commit".to_string(),
                confirmed: true,
            })
            .await
            .expect("commit logging change");
        let receipt = commit.apply_receipts[0].clone();
        manager
            .record_apply_status(&ConfigApplyStatusEvent {
                commit_id: commit.commit_id.clone(),
                revision: commit.revision,
                consumer: receipt.consumer.clone(),
                receipt_attempt: 1,
                status: ConfigApplyStatus::Failed,
                paths: receipt.paths.clone(),
                message: Some("simulated failure".to_string()),
            })
            .await
            .expect("record first failure");

        let retry_request = RetryConfigApplyRequest {
            commit_id: commit.commit_id.clone(),
            expected_revision: commit.revision,
            consumer: receipt.consumer.clone(),
            expected_attempt: 1,
            idempotency_key: "retry-logging-attempt-2".to_string(),
        };
        let retried = match manager
            .prepare_apply_retry(retry_request.clone())
            .await
            .expect("prepare retry")
        {
            RetryApplyOutcome::Dispatch { commit, .. } => commit,
            RetryApplyOutcome::Replay(_) => panic!("first retry must dispatch"),
        };
        assert_eq!(
            retried.status,
            super::super::transaction::ConfigCommitStatus::Applying
        );
        assert_eq!(retried.apply_receipts[0].attempt, 2);

        let late = manager
            .record_apply_status(&ConfigApplyStatusEvent {
                commit_id: commit.commit_id.clone(),
                revision: commit.revision,
                consumer: receipt.consumer.clone(),
                receipt_attempt: 1,
                status: ConfigApplyStatus::Applied,
                paths: receipt.paths.clone(),
                message: None,
            })
            .await
            .expect_err("late attempt must be rejected");
        assert!(late
            .to_string()
            .contains("config.apply_status_attempt_mismatch"));

        let applied = manager
            .record_apply_status(&ConfigApplyStatusEvent {
                commit_id: commit.commit_id.clone(),
                revision: commit.revision,
                consumer: receipt.consumer,
                receipt_attempt: 2,
                status: ConfigApplyStatus::Applied,
                paths: receipt.paths,
                message: None,
            })
            .await
            .expect("second attempt applies");
        assert_eq!(
            applied.status,
            super::super::transaction::ConfigCommitStatus::Applied
        );
        match manager
            .prepare_apply_retry(retry_request)
            .await
            .expect("idempotent retry replay")
        {
            RetryApplyOutcome::Replay(replayed) => assert_eq!(replayed, applied),
            RetryApplyOutcome::Dispatch { .. } => panic!("retry replay must not dispatch again"),
        }
    }

    #[tokio::test]
    async fn recovery_supersedes_an_overwritten_receipt_without_making_it_retryable() {
        let _apply_test_guard = super::super::apply::acquire_config_apply_test_lock().await;
        let (_temp, mut manager) = isolated_manager().await;
        let consumer = super::super::apply::CONFIG_APPLY_CONSUMER_RUNTIME_I18N;
        let _adapter = super::super::apply::register_config_apply_adapter(
            consumer,
            i18n_patterns(),
            super::super::apply::ConfigApplyAdapterCriticality::NonCritical,
            None,
            no_op_config_apply(),
        )
        .expect("register i18n apply adapter");
        let original_language = manager.config.app.language.clone();
        let intermediate_language = if original_language == "en-US" {
            "zh-CN"
        } else {
            "en-US"
        };
        let superseded = commit_language(
            &mut manager,
            intermediate_language,
            "recovery-superseded-language",
        )
        .await;
        let overwritten = commit_language(
            &mut manager,
            &original_language,
            "recovery-overwritten-language",
        )
        .await;
        let current = commit_language(
            &mut manager,
            intermediate_language,
            "recovery-current-language",
        )
        .await;

        let recovery = manager
            .prepare_pending_applies(consumer)
            .await
            .expect("classify pending applies");
        assert_eq!(recovery.terminal_events.len(), 2);
        assert_eq!(recovery.dispatches.len(), 1);
        assert!(recovery
            .terminal_events
            .iter()
            .all(|event| event.status == ConfigApplyStatus::Superseded));
        assert!(recovery
            .terminal_events
            .iter()
            .any(|event| event.commit_id == overwritten.commit_id));
        let event = recovery
            .terminal_events
            .into_iter()
            .find(|event| event.commit_id == superseded.commit_id)
            .expect("oldest matching-value revision is still superseded");
        assert_eq!(event.commit_id, superseded.commit_id);
        assert_eq!(event.status, ConfigApplyStatus::Superseded);
        assert_eq!(recovery.dispatches[0].commit.commit_id, current.commit_id);

        let updated = manager
            .record_apply_status(&event)
            .await
            .expect("record superseded receipt");
        assert_eq!(
            updated.apply_receipts[0].status,
            super::super::transaction::ConfigApplyReceiptStatus::Superseded
        );
        assert_eq!(
            updated.status,
            super::super::transaction::ConfigCommitStatus::Partial
        );
        let retry_error = match manager
            .prepare_apply_retry(RetryConfigApplyRequest {
                commit_id: superseded.commit_id,
                expected_revision: superseded.revision,
                consumer: consumer.to_string(),
                expected_attempt: 1,
                idempotency_key: "retry-superseded-language".to_string(),
            })
            .await
        {
            Ok(_) => panic!("superseded receipts must never be retryable"),
            Err(error) => error,
        };
        assert!(retry_error
            .to_string()
            .contains("config.apply_retry_requires_failed_receipt"));
    }

    #[tokio::test]
    async fn recovery_prepare_failure_becomes_a_retryable_failed_receipt() {
        let _apply_test_guard = super::super::apply::acquire_config_apply_test_lock().await;
        let (_temp, mut manager) = isolated_manager().await;
        let consumer = super::super::apply::CONFIG_APPLY_CONSUMER_RUNTIME_LOGGING;
        let initial_adapter = super::super::apply::register_config_apply_adapter(
            consumer,
            logging_patterns(),
            super::super::apply::ConfigApplyAdapterCriticality::NonCritical,
            None,
            no_op_config_apply(),
        )
        .expect("register initial logging apply adapter");
        let next_level = if manager.config.app.logging.level == "debug" {
            "info"
        } else {
            "debug"
        };
        let commit = commit_test_operations(
            &mut manager,
            vec![ConfigPatchOperation::Set {
                setting_id: "core.app.logging.level".to_string(),
                value: serde_json::json!(next_level),
            }],
            "recovery-prepare-failure",
        )
        .await;
        drop(initial_adapter);

        let failing_prepare: super::super::apply::ConfigApplyPrepare = Arc::new(|_| {
            Box::pin(async {
                Err(CoreError::config(
                    "Simulated recovery prepare failure".to_string(),
                ))
            })
        });
        let failing_adapter = super::super::apply::register_config_apply_adapter(
            consumer,
            logging_patterns(),
            super::super::apply::ConfigApplyAdapterCriticality::NonCritical,
            Some(failing_prepare),
            no_op_config_apply(),
        )
        .expect("register failing logging apply adapter");
        let recovery = manager
            .prepare_pending_applies(consumer)
            .await
            .expect("classify recovery prepare failure");
        assert!(recovery.dispatches.is_empty());
        assert_eq!(recovery.terminal_events.len(), 1);
        let event = recovery.terminal_events.into_iter().next().unwrap();
        assert_eq!(event.status, ConfigApplyStatus::Failed);
        assert!(event
            .message
            .as_deref()
            .is_some_and(|message| message.contains("config.apply_prepare_failed")));
        let failed = manager
            .record_apply_status(&event)
            .await
            .expect("record recovery prepare failure");
        assert_eq!(
            failed.apply_receipts[0].status,
            super::super::transaction::ConfigApplyReceiptStatus::Failed
        );
        drop(failing_adapter);

        let _retry_adapter = super::super::apply::register_config_apply_adapter(
            consumer,
            logging_patterns(),
            super::super::apply::ConfigApplyAdapterCriticality::NonCritical,
            None,
            no_op_config_apply(),
        )
        .expect("register retry logging apply adapter");
        let retried = manager
            .prepare_apply_retry(RetryConfigApplyRequest {
                commit_id: commit.commit_id,
                expected_revision: commit.revision,
                consumer: consumer.to_string(),
                expected_attempt: 1,
                idempotency_key: "retry-recovery-prepare-failure".to_string(),
            })
            .await
            .expect("failed noncritical recovery receipt must be retryable");
        let RetryApplyOutcome::Dispatch { commit, .. } = retried else {
            panic!("first recovery retry must dispatch");
        };
        assert_eq!(commit.apply_receipts[0].attempt, 2);
        assert_eq!(
            commit.apply_receipts[0].status,
            super::super::transaction::ConfigApplyReceiptStatus::Pending
        );
    }

    #[tokio::test]
    async fn persisted_config_externalizes_model_credentials() {
        let temp = tempfile::tempdir().expect("tempdir");
        let path_manager = Arc::new(PathManager::with_user_root_for_tests(
            temp.path().join("user-root"),
        ));
        let manager = ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager.clone()),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("manager");
        let mut candidate = manager.config.clone();
        candidate.ai.models.push(AIModelConfig {
            id: "secure-model".to_string(),
            name: "Secure Model".to_string(),
            provider: "openai".to_string(),
            model_name: "secure-model".to_string(),
            base_url: "https://example.com/v1".to_string(),
            api_key: "must-not-enter-app-json".to_string(),
            enabled: true,
            ..AIModelConfig::default()
        });
        let authority = atomic_store::lock_exclusive(&manager.config_file)
            .await
            .expect("config authority");
        manager
            .persist_candidate(&authority, &candidate)
            .await
            .expect("persist externalized config");
        drop(authority);
        let persisted = tokio::fs::read_to_string(path_manager.app_config_file())
            .await
            .expect("read app config");
        assert!(!persisted.contains("must-not-enter-app-json"));
        assert!(persisted.contains("sparo-secret://config/"));
        drop(manager);

        let restarted = ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("restarted manager");
        assert_eq!(
            restarted.config.ai.models[0].api_key,
            "must-not-enter-app-json"
        );
    }

    #[tokio::test]
    async fn persisted_revision_survives_manager_restart() {
        let temp = tempfile::tempdir().expect("tempdir");
        let path_manager = Arc::new(PathManager::with_user_root_for_tests(
            temp.path().join("user-root"),
        ));
        let mut manager = ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager.clone()),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("first manager");
        commit_language(&mut manager, "en-US", "persisted-revision").await;
        let committed_revision = manager.transaction.revision;
        drop(manager);

        let restarted = ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("restarted manager");
        assert_eq!(restarted.transaction.revision, committed_revision);
    }

    #[tokio::test]
    async fn independent_managers_reject_a_plan_from_a_persisted_stale_revision() {
        let temp = tempfile::tempdir().expect("tempdir");
        let path_manager = Arc::new(PathManager::with_user_root_for_tests(
            temp.path().join("user-root"),
        ));
        let mut first = ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager.clone()),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("first manager");
        let mut second = ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("second manager");
        let base_revision = first.transaction.revision;
        assert_eq!(second.transaction.revision, base_revision);

        let next_level = if second.config.app.logging.level == "debug" {
            "info"
        } else {
            "debug"
        };
        let stale_plan = second
            .plan_patch(ConfigPatch {
                request_id: "cross-process-stale-plan".to_string(),
                idempotency_key: "cross-process-stale-plan".to_string(),
                expected_revision: base_revision,
                source: manual_source(),
                scope: ConfigScope::user(),
                operations: vec![ConfigPatchOperation::Set {
                    setting_id: "core.app.logging.level".to_string(),
                    value: Value::String(next_level.to_string()),
                }],
            })
            .await
            .expect("plan against shared base revision");
        let next_language = if first.config.app.language == "zh-CN" {
            "en-US"
        } else {
            "zh-CN"
        };
        let committed =
            commit_language(&mut first, next_language, "cross-process-first-commit").await;

        let error = second
            .commit_plan(CommitConfigPlanRequest {
                plan_id: stale_plan.plan_id,
                expected_revision: base_revision,
                idempotency_key: "cross-process-stale-commit".to_string(),
                confirmed: true,
            })
            .await
            .expect_err("persisted external revision must invalidate the stale plan");

        assert!(error.to_string().contains("config.stale_plan"));
        assert_eq!(second.transaction.revision, committed.revision);
        assert_eq!(second.config.app.language, next_language);
        assert_eq!(
            second.config.app.logging.level,
            first.config.app.logging.level
        );

        let error = second
            .plan_patch(language_patch(base_revision, next_language))
            .await
            .expect_err("old expectedRevision must be rejected after authoritative refresh");
        assert!(error.to_string().contains("config.revision_conflict"));
    }

    #[tokio::test]
    async fn independent_managers_commit_monotonic_revisions_without_lost_updates() {
        let temp = tempfile::tempdir().expect("tempdir");
        let path_manager = Arc::new(PathManager::with_user_root_for_tests(
            temp.path().join("user-root"),
        ));
        let mut first = ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager.clone()),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("first manager");
        let mut second = ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager.clone()),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("second manager");
        let next_language = if first.config.app.language == "zh-CN" {
            "en-US"
        } else {
            "zh-CN"
        };
        let first_commit =
            commit_language(&mut first, next_language, "cross-process-sequential-first").await;
        let next_level = if second.config.app.logging.level == "debug" {
            "info"
        } else {
            "debug"
        };
        let second_plan = second
            .plan_patch(ConfigPatch {
                request_id: "cross-process-sequential-second".to_string(),
                idempotency_key: "cross-process-sequential-second-plan".to_string(),
                expected_revision: first_commit.revision,
                source: manual_source(),
                scope: ConfigScope::user(),
                operations: vec![ConfigPatchOperation::Set {
                    setting_id: "core.app.logging.level".to_string(),
                    value: Value::String(next_level.to_string()),
                }],
            })
            .await
            .expect("second manager refreshes from authoritative file while planning");
        let second_commit = second
            .commit_plan(CommitConfigPlanRequest {
                plan_id: second_plan.plan_id,
                expected_revision: first_commit.revision,
                idempotency_key: "cross-process-sequential-second-commit".to_string(),
                confirmed: true,
            })
            .await
            .expect("second commit");

        assert_eq!(second_commit.revision, first_commit.revision + 1);
        let restarted = ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("authoritative restart");
        assert_eq!(restarted.transaction.revision, second_commit.revision);
        assert_eq!(restarted.config.app.language, next_language);
        assert_eq!(restarted.config.app.logging.level, next_level);
    }

    #[tokio::test]
    async fn external_history_gap_publishes_a_snapshot_projection_and_advances() {
        let temp = tempfile::tempdir().expect("tempdir");
        let path_manager = Arc::new(PathManager::with_user_root_for_tests(
            temp.path().join("user-root"),
        ));
        let mut resident = ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager.clone()),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("resident manager");
        let mut writer = ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("writer manager");
        let next_language = if writer.config.app.language == "zh-CN" {
            "en-US"
        } else {
            "zh-CN"
        };
        let mut events = super::super::global::GlobalConfigManager::subscribe_commits();
        let committed = commit_language(&mut writer, next_language, "external-gap-writer").await;
        receive_matching_commit(&mut events, &committed.commit_id).await;

        let authority = atomic_store::lock_exclusive(&writer.config_file)
            .await
            .expect("writer authority");
        let mut pruned = writer.transaction.clone();
        pruned.commits.clear();
        pruned.idempotency.clear();
        writer
            .persist_transaction_state(&authority, pruned)
            .await
            .expect("persist pruned history");
        drop(authority);

        assert_eq!(
            resident.refresh_external_changes().await.expect("refresh"),
            1
        );
        let synthetic_id = format!("cfg-external-snapshot-{}", committed.revision);
        let event = receive_matching_commit(&mut events, &synthetic_id).await;
        assert_eq!(event.revision, committed.revision);
        assert_eq!(
            event.source.surface.as_deref(),
            Some("config-external-snapshot-refresh")
        );
        assert!(event.changes_path("app.language"));
        assert_eq!(resident.transaction.revision, committed.revision);
        assert_eq!(resident.last_announced_revision, committed.revision);
        assert_eq!(resident.config.app.language, next_language);
        assert_eq!(
            resident.refresh_external_changes().await.expect("settled"),
            0
        );
    }

    async fn receive_matching_commit(
        receiver: &mut super::super::global::ConfigCommitReceiver,
        commit_id: &str,
    ) -> ConfigCommittedEvent {
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                let event = receiver.recv().await.expect("config commit event");
                if event.commit_id == commit_id {
                    return event;
                }
            }
        })
        .await
        .expect("matching config commit event")
    }

    #[tokio::test]
    async fn commit_idempotency_and_undo_survive_manager_restart() {
        let temp = tempfile::tempdir().expect("tempdir");
        let path_manager = Arc::new(PathManager::with_user_root_for_tests(
            temp.path().join("user-root"),
        ));
        let mut manager = ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager.clone()),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("first manager");
        let next_language = if manager.config.app.language == "zh-CN" {
            "en-US"
        } else {
            "zh-CN"
        };
        let revision = manager.transaction.revision;
        let plan = manager
            .plan_patch(language_patch(revision, next_language))
            .await
            .expect("plan language");
        let request = CommitConfigPlanRequest {
            plan_id: plan.plan_id,
            expected_revision: revision,
            idempotency_key: "restart-durable-commit".to_string(),
            confirmed: true,
        };
        let committed = manager
            .commit_plan(request.clone())
            .await
            .expect("commit language");
        let undo_token = committed.undo_token.clone().expect("undo token");
        let persisted = tokio::fs::read_to_string(path_manager.app_config_file())
            .await
            .expect("read app config");
        assert!(persisted.contains("sparo-config-journal:v1:"));
        assert!(!persisted.contains(&committed.commit_id));
        assert!(!persisted.contains(&undo_token));
        drop(manager);

        let mut restarted = ConfigManager::new(ConfigManagerSettings {
            path_manager: Some(path_manager),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("restarted manager");
        assert_eq!(
            restarted
                .get_commit(&committed.commit_id)
                .expect("restored commit"),
            committed
        );
        let replayed = restarted
            .commit_plan(request)
            .await
            .expect("idempotent replay after restart");
        assert_eq!(replayed, committed);

        let undone = restarted
            .undo_commit(
                UndoConfigCommitRequest {
                    commit_id: committed.commit_id,
                    undo_token,
                    expected_revision: committed.revision,
                    idempotency_key: "restart-durable-undo".to_string(),
                    confirmed: true,
                },
                manual_source(),
            )
            .await
            .expect("undo after restart");
        assert!(undone.revision > committed.revision);
    }
}
