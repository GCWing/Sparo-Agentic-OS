//! Configuration service implementation
//!
//! Provides comprehensive configuration management functionality.

use super::manager::{ConfigManager, ConfigManagerSettings, ConfigStartupStatus, ConfigStatistics};
use super::types::*;
use super::{
    CommitConfigPlanRequest, ConfigApplyStatusReceiver, ConfigCommit, ConfigCommitReceiver,
    ConfigCommitStatus, ConfigPatch, ConfigPatchOperation, ConfigPlan, ConfigRollbackReceiver,
    ConfigSnapshot, PublishedConfigCatalog, SettingMutability, UndoConfigCommitRequest,
};
use crate::error::*;
use crate::service::speech::LOCAL_SENSEVOICE_SMALL_INT8_MODEL_REF;
use log::{info, warn};
use sparo_events::{ConfigApplyStatusEvent, ConfigChangeSource, ConfigScope};
use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Configuration service.
pub struct ConfigService {
    manager: Arc<RwLock<ConfigManager>>,
}

/// Configuration import/export format.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigExport {
    pub config: GlobalConfig,
    pub export_timestamp: String,
}

/// Configuration health status.
#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigHealthStatus {
    pub healthy: bool,
    pub config_directory: std::path::PathBuf,
    pub warnings: Vec<String>,
    pub message: String,
    pub last_modified: chrono::DateTime<chrono::Utc>,
}

impl ConfigService {
    /// Creates a new configuration service.
    pub async fn new() -> CoreResult<Self> {
        let settings = ConfigManagerSettings::default();
        Self::with_settings(settings).await
    }

    /// Creates a configuration service with custom settings.
    pub async fn with_settings(settings: ConfigManagerSettings) -> CoreResult<Self> {
        let manager = ConfigManager::new(settings).await?;
        Ok(Self {
            manager: Arc::new(RwLock::new(manager)),
        })
    }

    /// Gets a configuration value (supports dot-paths).
    pub async fn get_config<T>(&self, path: Option<&str>) -> CoreResult<T>
    where
        T: serde::de::DeserializeOwned,
    {
        let manager = self.manager.read().await;

        if let Some(path) = path {
            manager.get(path)
        } else {
            let config = manager.get_config();
            serde_json::from_value(serde_json::to_value(config)?)
                .map_err(|e| CoreError::config(format!("Failed to serialize config: {}", e)))
        }
    }

    /// Returns the current revisioned, redacted snapshot.
    pub async fn get_snapshot(&self) -> CoreResult<ConfigSnapshot> {
        let manager = self.manager.read().await;
        manager.get_snapshot()
    }

    /// Returns a redacted description of how persisted configuration started.
    pub async fn get_startup_status(&self) -> ConfigStartupStatus {
        let manager = self.manager.read().await;
        manager.startup_status().clone()
    }

    /// Discards an unusable persisted configuration and writes current defaults.
    pub async fn rebuild_default_config(&self) -> CoreResult<ConfigStartupStatus> {
        let mut manager = self.manager.write().await;
        manager.rebuild_default_config().await
    }

    /// Refreshes commits written by another Sparo process after the global
    /// watcher observes a changed atomic-file metadata marker.
    pub(crate) async fn refresh_external_changes(&self) -> CoreResult<usize> {
        let mut manager = self.manager.write().await;
        manager.refresh_external_changes().await
    }

    pub(crate) async fn persisted_file_marker(
        &self,
    ) -> CoreResult<super::atomic_store::FileMarker> {
        let manager = self.manager.read().await;
        manager.persisted_file_marker().await
    }

    /// Returns a storage-free Catalog safe for product-surface clients.
    pub async fn describe_published_catalog(
        &self,
        query: Option<&str>,
    ) -> CoreResult<PublishedConfigCatalog> {
        let manager = self.manager.read().await;
        Ok(manager.catalog().published(query))
    }

    /// Returns a storage-free Catalog and snapshot from one authoritative read lock.
    pub async fn describe_published_catalog_with_snapshot(
        &self,
        query: Option<&str>,
    ) -> CoreResult<(PublishedConfigCatalog, ConfigSnapshot)> {
        let manager = self.manager.read().await;
        Ok((manager.catalog().published(query), manager.get_snapshot()?))
    }

    /// Validates a catalog-backed patch and returns an immutable short-lived plan.
    pub async fn plan_patch(&self, patch: ConfigPatch) -> CoreResult<ConfigPlan> {
        let mut manager = self.manager.write().await;
        manager.plan_patch(patch).await
    }

    /// Plans a generic product-surface patch only for settings published by
    /// the active Catalog and writable through that generic boundary. Managed
    /// settings remain writable solely through their canonical domain APIs.
    pub async fn plan_product_surface_patch(&self, patch: ConfigPatch) -> CoreResult<ConfigPlan> {
        let mut manager = self.manager.write().await;
        let catalog = manager.catalog().published(None);
        validate_product_surface_operations(&catalog, &patch.operations)?;
        manager.plan_patch(patch).await
    }

    /// Atomically commits a validated plan.
    pub async fn commit_plan(&self, request: CommitConfigPlanRequest) -> CoreResult<ConfigCommit> {
        let mut manager = self.manager.write().await;
        manager.commit_plan(request).await
    }

    /// Commits an already intentional internal action through the same catalog,
    /// planning, validation, persistence, and apply pipeline as external clients.
    /// Interactive callers that need a confirmation preview should use
    /// [`Self::plan_patch`] and [`Self::commit_plan`] separately.
    pub async fn commit_operations(
        &self,
        source: ConfigChangeSource,
        operations: Vec<ConfigPatchOperation>,
        confirmed: bool,
    ) -> CoreResult<ConfigCommit> {
        let mut manager = self.manager.write().await;
        Self::commit_operations_locked(&mut manager, source, operations, confirmed).await
    }

    async fn commit_operations_locked(
        manager: &mut ConfigManager,
        source: ConfigChangeSource,
        operations: Vec<ConfigPatchOperation>,
        confirmed: bool,
    ) -> CoreResult<ConfigCommit> {
        if operations.is_empty() {
            return Err(CoreError::validation(
                "config.operations_empty: at least one operation is required",
            ));
        }

        manager.refresh_external_changes().await?;
        let expected_revision = manager.get_snapshot()?.revision;
        let request_id = format!("config-operation-{}", uuid::Uuid::new_v4());
        let plan = manager
            .plan_patch(ConfigPatch {
                request_id: request_id.clone(),
                idempotency_key: format!("{request_id}:plan"),
                expected_revision,
                source,
                scope: ConfigScope::user(),
                operations,
            })
            .await?;

        manager
            .commit_plan(CommitConfigPlanRequest {
                plan_id: plan.plan_id,
                expected_revision,
                idempotency_key: format!("{request_id}:commit"),
                confirmed,
            })
            .await
    }

    /// Creates a conflict-checked compensating commit.
    pub async fn undo_commit(
        &self,
        request: UndoConfigCommitRequest,
        source: ConfigChangeSource,
    ) -> CoreResult<ConfigCommit> {
        let mut manager = self.manager.write().await;
        manager.undo_commit(request, source).await
    }

    pub async fn get_commit(&self, commit_id: &str) -> CoreResult<ConfigCommit> {
        let manager = self.manager.read().await;
        manager.get_commit(commit_id)
    }

    pub async fn list_recent_commits(&self, limit: usize) -> Vec<ConfigCommit> {
        let manager = self.manager.read().await;
        manager.list_recent_commits(limit)
    }

    pub async fn retry_apply(
        &self,
        request: super::transaction::RetryConfigApplyRequest,
    ) -> CoreResult<ConfigCommit> {
        let outcome = {
            let mut manager = self.manager.write().await;
            manager.prepare_apply_retry(request).await?
        };
        match outcome {
            super::manager::RetryApplyOutcome::Replay(commit) => Ok(commit),
            super::manager::RetryApplyOutcome::Dispatch {
                commit,
                snapshot,
                prepared,
            } => {
                super::global::GlobalConfigManager::dispatch_retry(&commit, snapshot, prepared);
                Ok(commit)
            }
        }
    }

    pub(crate) async fn resume_pending_applies(&self, consumer: &str) -> CoreResult<()> {
        loop {
            let recovery = {
                let manager = self.manager.read().await;
                manager.prepare_pending_applies(consumer).await?
            };
            let mut reclassify_after_rollback = false;
            for event in recovery.terminal_events {
                let commit =
                    super::global::GlobalConfigManager::publish_apply_status(event).await?;
                if commit.status == ConfigCommitStatus::RolledBack {
                    reclassify_after_rollback = true;
                    break;
                }
            }
            if reclassify_after_rollback {
                continue;
            }
            for dispatch in recovery.dispatches {
                super::global::GlobalConfigManager::dispatch_retry(
                    &dispatch.commit,
                    dispatch.snapshot,
                    dispatch.prepared,
                );
            }
            return Ok(());
        }
    }

    /// Subscribes to commits without introducing a second event channel.
    pub fn subscribe_commits(&self) -> ConfigCommitReceiver {
        super::global::GlobalConfigManager::subscribe_commits()
    }

    /// Subscribes to terminal runtime application acknowledgements.
    pub fn subscribe_apply_statuses(&self) -> ConfigApplyStatusReceiver {
        super::global::GlobalConfigManager::subscribe_apply_statuses()
    }

    pub fn subscribe_rollbacks(&self) -> ConfigRollbackReceiver {
        super::global::GlobalConfigManager::subscribe_rollbacks()
    }

    pub(crate) async fn record_apply_status(
        &self,
        event: &ConfigApplyStatusEvent,
    ) -> CoreResult<ConfigCommit> {
        let mut manager = self.manager.write().await;
        manager.record_apply_status(event).await
    }

    pub(crate) async fn expire_pending_apply_receipt(
        &self,
        commit_id: &str,
        revision: u64,
        consumer: &str,
        receipt_attempt: u32,
    ) -> CoreResult<(Option<ConfigApplyStatusEvent>, ConfigCommit)> {
        let mut manager = self.manager.write().await;
        manager
            .expire_pending_apply_receipt(commit_id, revision, consumer, receipt_attempt)
            .await
    }

    pub(crate) async fn rollback_failed_commit(
        &self,
        commit_id: &str,
        revision: u64,
    ) -> CoreResult<(ConfigCommit, String)> {
        let mut manager = self.manager.write().await;
        manager.rollback_failed_commit(commit_id, revision).await
    }

    /// Validates configuration.
    pub async fn validate_config(&self) -> CoreResult<ConfigValidationResult> {
        let manager = self.manager.read().await;
        Ok(manager.validate_config())
    }

    /// Exports configuration.
    pub async fn export_config(&self) -> CoreResult<ConfigExport> {
        let manager = self.manager.read().await;
        let config_value = manager.export_config()?;
        let config: GlobalConfig = serde_json::from_value(config_value)?;

        Ok(ConfigExport {
            config,
            export_timestamp: chrono::Utc::now().to_rfc3339(),
        })
    }

    /// Imports configuration as one validated, model-consistent commit.
    pub async fn import_config(
        &self,
        export: ConfigExport,
        expected_revision: u64,
        idempotency_key: String,
        confirmed: bool,
    ) -> CoreResult<Option<ConfigCommit>> {
        let mut manager = self.manager.write().await;
        manager
            .import_config(
                serde_json::to_value(export.config)?,
                expected_revision,
                idempotency_key,
                confirmed,
            )
            .await
    }

    /// Returns configuration statistics.
    pub async fn get_statistics(&self) -> ConfigStatistics {
        let manager = self.manager.read().await;
        manager.get_statistics()
    }

    /// Runs a health check.
    pub async fn health_check(&self) -> CoreResult<ConfigHealthStatus> {
        let manager = self.manager.read().await;
        let stats = manager.get_statistics();
        let validation_result = manager.validate_config();

        let mut warnings = Vec::new();

        for warning in &validation_result.warnings {
            warnings.push(format!("{}: {}", warning.path, warning.message));
        }

        if stats.total_ai_models == 0 {
            warnings.push("No AI models configured".to_string());
        }

        let config = manager.get_config();
        if config.ai.default_models.primary.is_none() {
            warnings.push("Primary model not configured".to_string());
        }

        if !stats.config_directory.exists() {
            return Ok(ConfigHealthStatus {
                healthy: false,
                config_directory: stats.config_directory,
                warnings,
                message: "Configuration directory does not exist".to_string(),
                last_modified: stats.last_modified,
            });
        }

        let healthy = validation_result.valid && stats.total_ai_models > 0;

        Ok(ConfigHealthStatus {
            healthy,
            config_directory: stats.config_directory,
            warnings,
            message: if healthy {
                "Configuration system is healthy".to_string()
            } else {
                "Configuration system has issues".to_string()
            },
            last_modified: stats.last_modified,
        })
    }

    /// Returns all AI model configurations.
    pub async fn get_ai_models(&self) -> CoreResult<Vec<AIModelConfig>> {
        let config: GlobalConfig = self.get_config(None).await?;
        Ok(config.ai.models)
    }

    /// Reports whether a selector resolves to an enabled model in the current
    /// authoritative configuration. An empty selector means `primary`.
    pub async fn has_usable_ai_model(&self, model_selector: Option<&str>) -> bool {
        let manager = self.manager.read().await;
        let selector = model_selector
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("primary");
        manager
            .get_config()
            .ai
            .resolve_model_selection(selector)
            .is_some()
    }
}

fn validate_product_surface_operations(
    catalog: &PublishedConfigCatalog,
    operations: &[ConfigPatchOperation],
) -> CoreResult<()> {
    for operation in operations {
        let setting_id = operation.setting_id();
        let descriptor = catalog.find(setting_id).ok_or_else(|| {
            CoreError::validation(format!(
                "config.setting_unavailable: setting '{setting_id}' is not published"
            ))
        })?;
        if descriptor.policy.mutability != SettingMutability::Writable {
            return Err(CoreError::validation(format!(
                "config.setting_managed: setting '{setting_id}' requires its dedicated domain API"
            )));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Default)]
pub(crate) struct ReconcileModelsReport {
    pub invalidated_model_ids: Vec<String>,
    pub default_models_changed: bool,
    pub agent_models_changed: bool,
}

impl ReconcileModelsReport {
    pub(crate) fn is_noop(&self) -> bool {
        self.invalidated_model_ids.is_empty()
            && !self.default_models_changed
            && !self.agent_models_changed
    }
}

/// Normalizes all model references in one in-memory candidate.
///
/// Callers must include the resulting differences in the same atomic commit as
/// the triggering model change. This function never performs persistence or
/// publishes an event on its own.
pub(crate) fn reconcile_model_references(
    config: &mut GlobalConfig,
    caller: &str,
) -> ReconcileModelsReport {
    let enabled_ids: HashSet<String> = config
        .ai
        .models
        .iter()
        .filter(|model| model.enabled)
        .map(|model| model.id.clone())
        .collect();
    let is_active = |reference: &str| {
        matches!(reference, "primary" | "fast") || enabled_ids.contains(reference)
    };
    let classify_invalid = |reference: &str, invalidated: &mut HashSet<String>| {
        if is_active(reference) {
            return false;
        }
        invalidated.insert(reference.to_string());
        true
    };

    let mut invalidated = HashSet::new();
    let agent_keys_to_remove = config
        .ai
        .agent_models
        .iter()
        .filter_map(|(agent, model_ref)| {
            classify_invalid(model_ref, &mut invalidated).then(|| agent.clone())
        })
        .collect::<Vec<_>>();
    for agent in &agent_keys_to_remove {
        warn!(
            "Reconcile ({caller}): clearing ai.agent_models[{agent}] because target model is missing or disabled"
        );
        config.ai.agent_models.remove(agent);
    }

    let func_keys_to_remove = config
        .ai
        .func_agent_models
        .iter()
        .filter_map(|(agent, model_ref)| {
            classify_invalid(model_ref, &mut invalidated).then(|| agent.clone())
        })
        .collect::<Vec<_>>();
    for agent in &func_keys_to_remove {
        warn!(
            "Reconcile ({caller}): clearing ai.func_agent_models[{agent}] because target model is missing or disabled"
        );
        config.ai.func_agent_models.remove(agent);
    }

    let replacement_id = config.ai.first_enabled_model_id();
    let mut default_models_changed = false;
    let mut repoint_default_slot = |slot: &mut Option<String>,
                                    slot_name: &str,
                                    accepts_local_speech: bool| {
        let needs_fix = match slot.as_deref() {
            Some("") => true,
            Some(value) => {
                !is_active(value)
                    && !(accepts_local_speech && value == LOCAL_SENSEVOICE_SMALL_INT8_MODEL_REF)
            }
            None => false,
        };
        if !needs_fix {
            return;
        }
        if let Some(current) = slot.as_deref() {
            classify_invalid(current, &mut invalidated);
        }
        match replacement_id.as_ref() {
            Some(new_id) => {
                info!(
                    "Reconcile ({caller}): default_models.{slot_name} repointed: {:?} -> {}",
                    slot, new_id
                );
                *slot = Some(new_id.clone());
            }
            None => {
                info!(
                    "Reconcile ({caller}): default_models.{slot_name} cleared (no enabled model available); previous={:?}",
                    slot
                );
                *slot = None;
            }
        }
        default_models_changed = true;
    };
    repoint_default_slot(&mut config.ai.default_models.primary, "primary", false);
    repoint_default_slot(&mut config.ai.default_models.fast, "fast", false);
    repoint_default_slot(&mut config.ai.default_models.search, "search", false);
    repoint_default_slot(
        &mut config.ai.default_models.image_understanding,
        "image_understanding",
        false,
    );
    repoint_default_slot(
        &mut config.ai.default_models.image_generation,
        "image_generation",
        false,
    );
    repoint_default_slot(
        &mut config.ai.default_models.speech_recognition,
        "speech_recognition",
        true,
    );
    invalidated.retain(|id| !enabled_ids.contains(id));

    let report = ReconcileModelsReport {
        invalidated_model_ids: invalidated.into_iter().collect(),
        default_models_changed,
        agent_models_changed: !agent_keys_to_remove.is_empty() || !func_keys_to_remove.is_empty(),
    };
    if !report.is_noop() {
        info!(
            "Reconcile ({caller}): invalidated={:?}, default_changed={}, agent_changed={}",
            report.invalidated_model_ids,
            report.default_models_changed,
            report.agent_models_changed
        );
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::PathManager;
    use crate::service::config::catalog::{
        ConfigCatalog, SETTING_AI_AGENT_CAPABILITY_CONFIGS, SETTING_APP_LANGUAGE,
        SETTING_MCP_SERVERS,
    };
    use sparo_events::ConfigChangeSourceKind;
    use std::sync::Arc;

    #[test]
    fn speech_recognition_reconcile_preserves_reserved_local_model_reference() {
        let mut config = GlobalConfig::default();
        config.ai.default_models.speech_recognition =
            Some(LOCAL_SENSEVOICE_SMALL_INT8_MODEL_REF.to_string());

        let report = reconcile_model_references(&mut config, "speech-test");

        assert_eq!(
            config.ai.default_models.speech_recognition.as_deref(),
            Some(LOCAL_SENSEVOICE_SMALL_INT8_MODEL_REF)
        );
        assert!(report.is_noop());
        assert!(!report
            .invalidated_model_ids
            .iter()
            .any(|id| id == LOCAL_SENSEVOICE_SMALL_INT8_MODEL_REF));
    }

    #[test]
    fn generic_product_surface_patch_rejects_managed_and_internal_settings() {
        let value = serde_json::to_value(GlobalConfig::default()).expect("global config");
        let catalog = ConfigCatalog::build(&value, &value)
            .expect("catalog")
            .published(None);

        validate_product_surface_operations(
            &catalog,
            &[ConfigPatchOperation::Reset {
                setting_id: SETTING_APP_LANGUAGE.to_string(),
            }],
        )
        .expect("ordinary published setting is writable");

        let managed = validate_product_surface_operations(
            &catalog,
            &[ConfigPatchOperation::Reset {
                setting_id: SETTING_AI_AGENT_CAPABILITY_CONFIGS.to_string(),
            }],
        )
        .expect_err("managed capability config requires its canonical API");
        assert!(managed.to_string().contains("config.setting_managed"));

        let internal = validate_product_surface_operations(
            &catalog,
            &[ConfigPatchOperation::Reset {
                setting_id: SETTING_MCP_SERVERS.to_string(),
            }],
        )
        .expect_err("internal MCP storage is not a generic product setting");
        assert!(internal.to_string().contains("config.setting_unavailable"));
    }

    #[test]
    fn model_reference_reconcile_updates_one_candidate() {
        let active = AIModelConfig {
            id: "active-id".to_string(),
            name: "Active".to_string(),
            model_name: "active-model".to_string(),
            enabled: true,
            ..AIModelConfig::default()
        };
        let disabled = AIModelConfig {
            id: "disabled-id".to_string(),
            name: "Disabled".to_string(),
            model_name: "disabled-model".to_string(),
            enabled: false,
            ..AIModelConfig::default()
        };
        let mut config = GlobalConfig::default();
        config.ai.models = vec![active, disabled];
        config.ai.default_models.primary = Some("disabled-id".to_string());
        config.ai.default_models.fast = Some("disabled-model".to_string());
        config
            .ai
            .agent_models
            .insert("CodeAgent".to_string(), "Disabled".to_string());
        config
            .ai
            .func_agent_models
            .insert("ReviewAgent".to_string(), "missing-id".to_string());

        let report = reconcile_model_references(&mut config, "test");

        assert_eq!(
            config.ai.default_models.primary.as_deref(),
            Some("active-id")
        );
        assert_eq!(config.ai.default_models.fast.as_deref(), Some("active-id"));
        assert!(config.ai.agent_models.is_empty());
        assert!(config.ai.func_agent_models.is_empty());
        assert!(report.default_models_changed);
        assert!(report.agent_models_changed);
        assert!(report
            .invalidated_model_ids
            .iter()
            .any(|id| id == "disabled-id"));
        assert!(report
            .invalidated_model_ids
            .iter()
            .any(|id| id == "missing-id"));
    }

    #[tokio::test]
    async fn resident_service_refreshes_and_announces_an_external_commit() {
        let _apply_test_guard = super::super::apply::acquire_config_apply_test_lock().await;
        let temp = tempfile::tempdir().expect("tempdir");
        let path_manager = Arc::new(PathManager::with_user_root_for_tests(
            temp.path().join("user-root"),
        ));
        let resident = ConfigService::with_settings(ConfigManagerSettings {
            path_manager: Some(path_manager.clone()),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("resident service");
        let writer = ConfigService::with_settings(ConfigManagerSettings {
            path_manager: Some(path_manager.clone()),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("writer service");
        let initial = resident.get_snapshot().await.expect("initial snapshot");
        let current: GlobalConfig = writer.get_config(None).await.expect("writer config");
        let next_language = if current.app.language == "zh-CN" {
            "en-US"
        } else {
            "zh-CN"
        };
        let mut events = super::super::global::GlobalConfigManager::subscribe_commits();

        let committed = writer
            .commit_operations(
                ConfigChangeSource {
                    kind: ConfigChangeSourceKind::Manual,
                    surface: Some("external-config-refresh-test".to_string()),
                    request_id: None,
                },
                vec![ConfigPatchOperation::Set {
                    setting_id: "core.app.language".to_string(),
                    value: serde_json::Value::String(next_language.to_string()),
                }],
                true,
            )
            .await
            .expect("external writer commit");
        assert_eq!(committed.revision, initial.revision + 1);
        receive_commit(&mut events, &committed.commit_id).await;
        let persisted_after_origin = tokio::fs::read(path_manager.app_config_file())
            .await
            .expect("origin config bytes");
        let origin_receipts = committed.apply_receipts.clone();
        let (apply_sender, mut apply_receiver) = tokio::sync::mpsc::unbounded_channel();
        let apply: super::super::apply::ConfigApply = Arc::new(move |context| {
            apply_sender.send(context).expect("capture external apply");
            Box::pin(async { Ok(()) })
        });
        let _registration = super::super::apply::register_config_apply_adapter(
            "resident-external-i18n-test",
            vec![super::super::apply::ConfigApplyPathPattern::exact(
                "app.language",
            )],
            super::super::apply::ConfigApplyAdapterCriticality::NonCritical,
            None,
            apply,
        )
        .expect("register resident adapter");

        assert_eq!(
            resident.refresh_external_changes().await.expect("refresh"),
            1
        );
        let apply_context =
            tokio::time::timeout(std::time::Duration::from_secs(2), apply_receiver.recv())
                .await
                .expect("resident apply timeout")
                .expect("resident apply context");
        assert_eq!(
            apply_context.origin,
            super::super::apply::ConfigApplyOrigin::ExternalReconciliation
        );
        assert_eq!(apply_context.revision, committed.revision);
        assert_eq!(apply_context.snapshot.app.language, next_language);
        assert_eq!(apply_context.changes.len(), 1);
        assert_eq!(apply_context.changes[0].path, "app.language");
        let local_apply = wait_for_external_apply_state(
            "resident-external-i18n-test",
            super::super::apply::ExternalConfigApplyStatus::Applied,
        )
        .await;
        assert_eq!(local_apply.revision, committed.revision);
        assert!(local_apply.failure_code.is_none());
        let external_event = receive_commit(&mut events, &committed.commit_id).await;
        assert_eq!(external_event.revision, committed.revision);
        let refreshed = resident.get_snapshot().await.expect("refreshed snapshot");
        assert_eq!(refreshed.revision, committed.revision);
        let refreshed_config: GlobalConfig = resident
            .get_config(None)
            .await
            .expect("refreshed resident config");
        assert_eq!(refreshed_config.app.language, next_language);
        assert_eq!(
            resident
                .refresh_external_changes()
                .await
                .expect("no-op poll"),
            0
        );
        assert!(apply_receiver.try_recv().is_err());
        let persisted_after_reconciliation = tokio::fs::read(path_manager.app_config_file())
            .await
            .expect("reconciled config bytes");
        assert_eq!(persisted_after_reconciliation, persisted_after_origin);
        let refreshed_commit = resident
            .get_commit(&committed.commit_id)
            .await
            .expect("refreshed commit");
        assert_eq!(refreshed_commit.apply_receipts, origin_receipts);
    }

    #[tokio::test]
    async fn resident_external_apply_failure_is_process_local_and_does_not_rewrite_receipts() {
        let _apply_test_guard = super::super::apply::acquire_config_apply_test_lock().await;
        let temp = tempfile::tempdir().expect("tempdir");
        let path_manager = Arc::new(PathManager::with_user_root_for_tests(
            temp.path().join("user-root"),
        ));
        let resident = ConfigService::with_settings(ConfigManagerSettings {
            path_manager: Some(path_manager.clone()),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("resident service");
        let writer = ConfigService::with_settings(ConfigManagerSettings {
            path_manager: Some(path_manager.clone()),
            ..ConfigManagerSettings::default()
        })
        .await
        .expect("writer service");
        let current: GlobalConfig = writer.get_config(None).await.expect("writer config");
        let next_language = if current.app.language == "zh-CN" {
            "en-US"
        } else {
            "zh-CN"
        };
        let committed = writer
            .commit_operations(
                ConfigChangeSource {
                    kind: ConfigChangeSourceKind::Manual,
                    surface: Some("external-config-failure-test".to_string()),
                    request_id: None,
                },
                vec![ConfigPatchOperation::Set {
                    setting_id: "core.app.language".to_string(),
                    value: serde_json::Value::String(next_language.to_string()),
                }],
                true,
            )
            .await
            .expect("external writer commit");
        let persisted_after_origin = tokio::fs::read(path_manager.app_config_file())
            .await
            .expect("origin config bytes");
        let origin_receipts = committed.apply_receipts.clone();
        let apply: super::super::apply::ConfigApply = Arc::new(|context| {
            assert_eq!(
                context.origin,
                super::super::apply::ConfigApplyOrigin::ExternalReconciliation
            );
            Box::pin(async { Err(CoreError::service("resident adapter unavailable")) })
        });
        let _registration = super::super::apply::register_config_apply_adapter(
            "resident-external-failure-test",
            vec![super::super::apply::ConfigApplyPathPattern::exact(
                "app.language",
            )],
            super::super::apply::ConfigApplyAdapterCriticality::NonCritical,
            None,
            apply,
        )
        .expect("register failing resident adapter");

        assert_eq!(
            resident.refresh_external_changes().await.expect("refresh"),
            1
        );
        let local_apply = wait_for_external_apply_state(
            "resident-external-failure-test",
            super::super::apply::ExternalConfigApplyStatus::Failed,
        )
        .await;
        assert_eq!(local_apply.revision, committed.revision);
        assert_eq!(
            local_apply.failure_code.as_deref(),
            Some("config.external_apply_failed")
        );
        assert_eq!(
            tokio::fs::read(path_manager.app_config_file())
                .await
                .expect("config after failed reconciliation"),
            persisted_after_origin
        );
        assert_eq!(
            resident
                .get_commit(&committed.commit_id)
                .await
                .expect("refreshed commit")
                .apply_receipts,
            origin_receipts
        );
        assert_eq!(
            resident
                .refresh_external_changes()
                .await
                .expect("settled refresh"),
            0
        );
    }

    async fn wait_for_external_apply_state(
        consumer: &str,
        expected: super::super::apply::ExternalConfigApplyStatus,
    ) -> super::super::apply::ExternalConfigApplyState {
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if let Some(state) = super::super::apply::external_config_apply_state(consumer) {
                    if state.status == expected {
                        return state;
                    }
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("external apply state")
    }

    async fn receive_commit(
        receiver: &mut super::super::global::ConfigCommitReceiver,
        commit_id: &str,
    ) -> sparo_events::ConfigCommittedEvent {
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
}
