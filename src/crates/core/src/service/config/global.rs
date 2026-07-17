//! Global configuration service singleton
//!
//! Provides the process-wide configuration service and its authoritative commit stream.

use super::apply::PreparedConfigApplySet;
use super::manager::{ConfigManagerSettings, ConfigStartupStatus};
use super::service::ConfigService;
use super::transaction::{ConfigApplyReceiptStatus, ConfigCommit, ConfigCommitStatus};
use super::types::GlobalConfig;
use crate::error::*;
use log::{debug, info, warn};
use sparo_events::{
    ConfigApplyStatus, ConfigApplyStatusEvent, ConfigCommittedEvent, ConfigRolledBackEvent,
};
use std::sync::{Arc, OnceLock};
use tokio::sync::RwLock;

/// Global configuration service singleton.
static GLOBAL_CONFIG_SERVICE: OnceLock<Arc<RwLock<Option<Arc<ConfigService>>>>> = OnceLock::new();

/// The one configuration-domain notification channel.
static CONFIG_COMMIT_SENDER: OnceLock<tokio::sync::broadcast::Sender<ConfigCommittedEvent>> =
    OnceLock::new();
static CONFIG_APPLY_STATUS_SENDER: OnceLock<
    tokio::sync::broadcast::Sender<ConfigApplyStatusEvent>,
> = OnceLock::new();
static CONFIG_ROLLBACK_SENDER: OnceLock<tokio::sync::broadcast::Sender<ConfigRolledBackEvent>> =
    OnceLock::new();

const CONFIG_APPLY_ACK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const EXTERNAL_CONFIG_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(750);
const CONFIG_APPLY_TRANSACTION_CONSUMER: &str = "config-transaction";

/// A receiver for authoritative configuration commits.
pub type ConfigCommitReceiver = tokio::sync::broadcast::Receiver<ConfigCommittedEvent>;
pub type ConfigApplyStatusReceiver = tokio::sync::broadcast::Receiver<ConfigApplyStatusEvent>;
pub type ConfigRollbackReceiver = tokio::sync::broadcast::Receiver<ConfigRolledBackEvent>;

/// Global configuration service manager.
pub struct GlobalConfigManager;

impl GlobalConfigManager {
    /// Initializes the global configuration service.
    pub async fn initialize() -> CoreResult<()> {
        Self::initialize_with_settings(ConfigManagerSettings::default()).await
    }

    /// Initializes the global configuration service with an explicit startup
    /// policy. Core and CLI callers use [`Self::initialize`], whose default is
    /// strict; the desktop shell may opt into read-only defaults.
    pub async fn initialize_with_settings(settings: ConfigManagerSettings) -> CoreResult<()> {
        if Self::is_initialized() {
            debug!("Global config service already initialized, skipping");
            return Ok(());
        }

        config_commit_sender();
        config_apply_status_sender();
        config_rollback_sender();

        let config_service = Arc::new(ConfigService::with_settings(settings).await?);
        let service_wrapper = Arc::new(RwLock::new(Some(Arc::clone(&config_service))));

        GLOBAL_CONFIG_SERVICE.set(service_wrapper).map_err(|_| {
            CoreError::config("Failed to initialize global config service".to_string())
        })?;

        let startup_status = config_service.get_startup_status().await;
        if should_start_external_config_watcher(&startup_status) {
            info!("Global config service initialized");
            start_external_config_watcher(Arc::clone(&config_service));

            for commit in config_service
                .list_recent_commits(super::transaction::MAX_TRANSACTION_HISTORY_ENTRIES)
                .await
            {
                for receipt in commit
                    .apply_receipts
                    .iter()
                    .filter(|receipt| receipt.status == ConfigApplyReceiptStatus::Pending)
                {
                    schedule_receipt_timeout(
                        commit.commit_id.clone(),
                        commit.revision,
                        receipt.consumer.clone(),
                        receipt.attempt,
                    );
                }
            }
        } else {
            let issue_code = startup_status
                .issue
                .as_ref()
                .map(|issue| issue.code.as_str())
                .unwrap_or("config.startup.unknown");
            warn!(
                "Global config service initialized with read-only defaults: issue_code={}",
                issue_code
            );
        }

        Ok(())
    }

    /// Returns the global configuration service instance.
    pub async fn get_service() -> CoreResult<Arc<ConfigService>> {
        let service_wrapper = GLOBAL_CONFIG_SERVICE.get().ok_or_else(|| {
            CoreError::config("Global config service not initialized".to_string())
        })?;

        let service_guard = service_wrapper.read().await;
        service_guard
            .as_ref()
            .ok_or_else(|| CoreError::config("Global config service is None".to_string()))
            .map(Arc::clone)
    }

    /// Subscribes to authoritative commits.
    pub fn subscribe_commits() -> ConfigCommitReceiver {
        config_commit_sender().subscribe()
    }

    pub fn subscribe_apply_statuses() -> ConfigApplyStatusReceiver {
        config_apply_status_sender().subscribe()
    }

    pub fn subscribe_rollbacks() -> ConfigRollbackReceiver {
        config_rollback_sender().subscribe()
    }

    /// Publishes one authoritative commit after its durable write succeeds.
    pub(crate) fn publish_commit(
        event: ConfigCommittedEvent,
        commit: &ConfigCommit,
        snapshot: GlobalConfig,
        prepared_applies: PreparedConfigApplySet,
    ) {
        let _ = config_commit_sender().send(event);
        publish_aggregate_apply_status(commit);
        dispatch_prepared_applies(commit, snapshot, prepared_applies);
    }

    /// Publishes a durable commit discovered in another process. Origin-process
    /// receipts are never replayed; the manager separately reconciles the
    /// authoritative diff through process-local adapter state.
    pub(crate) fn publish_external_commit(event: ConfigCommittedEvent) {
        let _ = config_commit_sender().send(event);
    }

    pub(crate) fn dispatch_retry(
        commit: &ConfigCommit,
        snapshot: GlobalConfig,
        prepared_applies: PreparedConfigApplySet,
    ) {
        publish_aggregate_apply_status(commit);
        dispatch_prepared_applies(commit, snapshot, prepared_applies);
    }

    /// Records and publishes a terminal status from the runtime consumer that
    /// actually applied a committed adapter change.
    pub(crate) async fn publish_apply_status(
        event: ConfigApplyStatusEvent,
    ) -> CoreResult<super::transaction::ConfigCommit> {
        let service = Self::get_service().await?;
        let commit = service.record_apply_status(&event).await?;
        let _ = config_apply_status_sender().send(event);
        match maybe_auto_rollback(&service, &commit).await {
            Ok(Some(rolled_back)) => {
                publish_aggregate_apply_status(&rolled_back);
                return Ok(rolled_back);
            }
            Ok(None) => {}
            Err(error) => {
                publish_aggregate_apply_status(&commit);
                return Err(error);
            }
        }
        publish_aggregate_apply_status(&commit);
        Ok(commit)
    }

    /// Returns whether the configuration service has been initialized.
    pub fn is_initialized() -> bool {
        GLOBAL_CONFIG_SERVICE.get().is_some()
    }

    /// Starts external-change observation after an explicit recovery rebuild.
    /// Recovery startup does not create a watcher because its source file is
    /// known to be unusable; the first successful rebuild activates it.
    pub fn activate_external_watcher_after_rebuild(service: Arc<ConfigService>) {
        start_external_config_watcher(service);
    }

    #[cfg(test)]
    pub(crate) fn install_service_for_tests(config_service: Arc<ConfigService>) -> CoreResult<()> {
        config_commit_sender();
        config_apply_status_sender();
        config_rollback_sender();

        let service_wrapper = Arc::new(RwLock::new(Some(config_service)));
        match GLOBAL_CONFIG_SERVICE.set(service_wrapper) {
            Ok(()) => Ok(()),
            Err(_) if Self::is_initialized() => Ok(()),
            Err(_) => Err(CoreError::config(
                "Failed to install test global config service".to_string(),
            )),
        }
    }
}

fn should_start_external_config_watcher(status: &ConfigStartupStatus) -> bool {
    status.is_persistent()
}

fn start_external_config_watcher(service: Arc<ConfigService>) {
    let Ok(runtime) = tokio::runtime::Handle::try_current() else {
        warn!("Unable to start external config watcher: runtime unavailable");
        return;
    };
    runtime.spawn(async move {
        let mut interval = tokio::time::interval(EXTERNAL_CONFIG_POLL_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        interval.tick().await;
        let mut last_error: Option<String> = None;
        let mut last_marker = None;
        loop {
            interval.tick().await;
            let observed_marker = match service.persisted_file_marker().await {
                Ok(marker) => marker,
                Err(error) => {
                    let message = error.to_string();
                    if last_error.as_deref() != Some(message.as_str()) {
                        warn!("Failed to inspect external config marker: error={message}");
                        last_error = Some(message);
                    }
                    continue;
                }
            };
            if last_marker.as_ref() == Some(&observed_marker) {
                last_error = None;
                continue;
            }
            match service.refresh_external_changes().await {
                Ok(_) => {
                    last_marker = Some(observed_marker);
                    last_error = None;
                }
                Err(error) => {
                    let message = error.to_string();
                    if last_error.as_deref() != Some(message.as_str()) {
                        warn!("Failed to refresh external config commit: error={message}");
                        last_error = Some(message);
                    }
                }
            }
        }
    });
}

fn dispatch_prepared_applies(
    commit: &ConfigCommit,
    snapshot: GlobalConfig,
    prepared_applies: PreparedConfigApplySet,
) {
    let Ok(runtime) = tokio::runtime::Handle::try_current() else {
        warn!(
            "Unable to dispatch config apply jobs: commit_id={}, reason=runtime_unavailable",
            commit.commit_id
        );
        return;
    };
    for reservation in prepared_applies.into_reservations() {
        let consumer = reservation.consumer().to_string();
        let Some(receipt) = commit
            .apply_receipts
            .iter()
            .find(|receipt| receipt.consumer == consumer)
        else {
            warn!(
                "Prepared config apply has no receipt: commit_id={}, consumer={}",
                commit.commit_id, consumer
            );
            continue;
        };
        if receipt.status != ConfigApplyReceiptStatus::Pending {
            warn!(
                "Prepared config apply receipt is not pending: commit_id={}, consumer={}",
                commit.commit_id, consumer
            );
            continue;
        }

        let commit_id = commit.commit_id.clone();
        let revision = commit.revision;
        let receipt_attempt = receipt.attempt;
        let paths = reservation.paths();
        schedule_receipt_timeout(
            commit_id.clone(),
            revision,
            consumer.clone(),
            receipt_attempt,
        );
        let apply_snapshot = snapshot.clone();
        runtime.spawn(async move {
            let result = reservation
                .dispatch(
                    commit_id.clone(),
                    revision,
                    receipt_attempt,
                    apply_snapshot,
                )
                .await;
            let (status, message) = match result {
                Ok(()) => (ConfigApplyStatus::Applied, None),
                Err(error) => (ConfigApplyStatus::Failed, Some(error.to_string())),
            };
            let event = ConfigApplyStatusEvent {
                commit_id: commit_id.clone(),
                revision,
                consumer: consumer.clone(),
                receipt_attempt,
                status,
                paths,
                message,
            };
            if let Err(error) = GlobalConfigManager::publish_apply_status(event).await {
                debug!(
                    "Config apply result was not accepted: commit_id={}, consumer={}, attempt={}, error={}",
                    commit_id, consumer, receipt_attempt, error
                );
            }
        });
    }
}

fn schedule_receipt_timeout(
    commit_id: String,
    revision: u64,
    consumer: String,
    receipt_attempt: u32,
) {
    let Ok(runtime) = tokio::runtime::Handle::try_current() else {
        return;
    };
    runtime.spawn(async move {
        tokio::time::sleep(CONFIG_APPLY_ACK_TIMEOUT).await;
        let service = match GlobalConfigManager::get_service().await {
            Ok(service) => service,
            Err(error) => {
                warn!(
                    "Unable to expire config apply receipt: commit_id={}, consumer={}, error={}",
                    commit_id, consumer, error
                );
                return;
            }
        };
        match service
            .expire_pending_apply_receipt(&commit_id, revision, &consumer, receipt_attempt)
            .await
        {
            Ok((Some(event), commit)) => {
                let _ = config_apply_status_sender().send(event);
                match maybe_auto_rollback(&service, &commit).await {
                    Ok(Some(rolled_back)) => publish_aggregate_apply_status(&rolled_back),
                    Ok(None) => publish_aggregate_apply_status(&commit),
                    Err(error) => {
                        warn!(
                            "Failed to auto-rollback config commit: commit_id={}, error={}",
                            commit_id, error
                        );
                        publish_aggregate_apply_status(&commit);
                    }
                }
            }
            Ok((None, _)) => {}
            Err(error) => warn!(
                "Failed to expire config apply receipt: commit_id={}, consumer={}, error={}",
                commit_id, consumer, error
            ),
        }
    });
}

fn config_commit_sender() -> &'static tokio::sync::broadcast::Sender<ConfigCommittedEvent> {
    CONFIG_COMMIT_SENDER.get_or_init(|| tokio::sync::broadcast::channel(100).0)
}

fn config_apply_status_sender() -> &'static tokio::sync::broadcast::Sender<ConfigApplyStatusEvent> {
    CONFIG_APPLY_STATUS_SENDER.get_or_init(|| tokio::sync::broadcast::channel(100).0)
}

fn config_rollback_sender() -> &'static tokio::sync::broadcast::Sender<ConfigRolledBackEvent> {
    CONFIG_ROLLBACK_SENDER.get_or_init(|| tokio::sync::broadcast::channel(100).0)
}

async fn maybe_auto_rollback(
    service: &Arc<ConfigService>,
    commit: &ConfigCommit,
) -> CoreResult<Option<ConfigCommit>> {
    if commit.source.surface.as_deref() == Some("config-auto-rollback")
        || !commit
            .apply_receipts
            .iter()
            .any(|receipt| receipt.critical && receipt.status == ConfigApplyReceiptStatus::Failed)
    {
        return Ok(None);
    }

    let (rollback, catalog_version) = service
        .rollback_failed_commit(&commit.commit_id, commit.revision)
        .await?;
    let rollback_event = ConfigRolledBackEvent {
        original_commit_id: commit.commit_id.clone(),
        rollback_commit: ConfigCommittedEvent {
            commit_id: rollback.commit_id.clone(),
            revision: rollback.revision,
            catalog_version,
            scope: rollback.scope.clone(),
            source: rollback.source.clone(),
            changes: rollback.changes.clone(),
            affected_sections: rollback.affected_sections.clone(),
            committed_at: rollback.committed_at,
        },
    };
    let _ = config_rollback_sender().send(rollback_event);

    let mut rolled_back = commit.clone();
    rolled_back.status = ConfigCommitStatus::RolledBack;
    rolled_back.undo_token = None;
    for receipt in &mut rolled_back.apply_receipts {
        receipt.status = ConfigApplyReceiptStatus::RolledBack;
    }
    Ok(Some(rolled_back))
}

fn publish_aggregate_apply_status(commit: &ConfigCommit) {
    let Some(status) = aggregate_apply_status(commit) else {
        return;
    };
    let terminal_messages = commit
        .apply_receipts
        .iter()
        .filter(|receipt| {
            matches!(
                receipt.status,
                ConfigApplyReceiptStatus::Failed
                    | ConfigApplyReceiptStatus::Superseded
                    | ConfigApplyReceiptStatus::RolledBack
            )
        })
        .filter_map(|receipt| receipt.message.as_deref())
        .collect::<Vec<_>>();
    let _ = config_apply_status_sender().send(ConfigApplyStatusEvent {
        commit_id: commit.commit_id.clone(),
        revision: commit.revision,
        consumer: CONFIG_APPLY_TRANSACTION_CONSUMER.to_string(),
        receipt_attempt: commit
            .apply_receipts
            .iter()
            .map(|receipt| receipt.attempt)
            .max()
            .unwrap_or(1),
        status,
        paths: commit
            .changes
            .iter()
            .map(|change| change.path.clone())
            .collect(),
        message: if terminal_messages.is_empty() {
            None
        } else {
            Some(terminal_messages.join("; "))
        },
    });
}

fn aggregate_apply_status(commit: &ConfigCommit) -> Option<ConfigApplyStatus> {
    if commit
        .apply_receipts
        .iter()
        .any(|receipt| receipt.status == ConfigApplyReceiptStatus::Pending)
    {
        return None;
    }

    match commit.status {
        ConfigCommitStatus::Partial => Some(ConfigApplyStatus::Partial),
        ConfigCommitStatus::RolledBack => Some(ConfigApplyStatus::RolledBack),
        ConfigCommitStatus::Applied => {
            if commit.apply_receipts.iter().any(|receipt| {
                matches!(
                    receipt.status,
                    ConfigApplyReceiptStatus::Failed | ConfigApplyReceiptStatus::Superseded
                )
            }) {
                return Some(ConfigApplyStatus::Partial);
            }
            if commit
                .apply_receipts
                .iter()
                .any(|receipt| receipt.status == ConfigApplyReceiptStatus::RestartRequired)
            {
                return Some(ConfigApplyStatus::RestartRequired);
            }
            Some(ConfigApplyStatus::Applied)
        }
        ConfigCommitStatus::Applying => None,
    }
}

/// Convenience helper: get the global configuration service.
pub async fn get_global_config_service() -> CoreResult<Arc<ConfigService>> {
    GlobalConfigManager::get_service().await
}

/// Convenience helper: initialize the global configuration service.
pub async fn initialize_global_config() -> CoreResult<()> {
    GlobalConfigManager::initialize().await
}

/// Initializes the global configuration service with an explicit manager
/// policy. Product surfaces must opt in; the ordinary helper remains strict.
pub async fn initialize_global_config_with_settings(
    settings: ConfigManagerSettings,
) -> CoreResult<()> {
    GlobalConfigManager::initialize_with_settings(settings).await
}

/// Convenience helper: subscribe to authoritative configuration commits.
pub fn subscribe_config_commits() -> ConfigCommitReceiver {
    GlobalConfigManager::subscribe_commits()
}

/// Convenience helper: subscribe to automatic compensating rollbacks.
pub fn subscribe_config_rollbacks() -> ConfigRollbackReceiver {
    GlobalConfigManager::subscribe_rollbacks()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::config::ConfigApplyReceipt;
    use crate::service::config::ConfigStartupFailurePhase;
    use sparo_events::{ConfigChangeSource, ConfigScope};

    #[test]
    fn external_watcher_is_disabled_for_read_only_defaults() {
        assert!(should_start_external_config_watcher(
            &ConfigStartupStatus::persistent()
        ));
        assert!(!should_start_external_config_watcher(
            &ConfigStartupStatus::read_only_defaults(ConfigStartupFailurePhase::Validation,)
        ));
    }

    fn commit_with_receipts(
        status: ConfigCommitStatus,
        receipt_statuses: &[ConfigApplyReceiptStatus],
    ) -> ConfigCommit {
        ConfigCommit {
            commit_id: "commit-aggregate".to_string(),
            revision: 4,
            status,
            scope: ConfigScope::user(),
            source: ConfigChangeSource::system(),
            changes: Vec::new(),
            apply_receipts: receipt_statuses
                .iter()
                .enumerate()
                .map(|(index, receipt_status)| ConfigApplyReceipt {
                    consumer: format!("consumer-{index}"),
                    setting_ids: vec![format!("setting-{index}")],
                    paths: vec![format!("path-{index}")],
                    attempt: 1,
                    attempted_at: chrono::Utc::now(),
                    status: *receipt_status,
                    critical: false,
                    message: None,
                })
                .collect(),
            affected_sections: Vec::new(),
            restart_required: vec!["core.process.runtime".to_string()],
            undo_token: None,
            committed_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn aggregate_reports_restart_required_as_a_terminal_status() {
        let commit = commit_with_receipts(
            ConfigCommitStatus::Applied,
            &[
                ConfigApplyReceiptStatus::Applied,
                ConfigApplyReceiptStatus::RestartRequired,
            ],
        );

        assert_eq!(
            aggregate_apply_status(&commit),
            Some(ConfigApplyStatus::RestartRequired)
        );
    }

    #[test]
    fn aggregate_prioritizes_failure_over_restart_required() {
        let partial = commit_with_receipts(
            ConfigCommitStatus::Partial,
            &[
                ConfigApplyReceiptStatus::RestartRequired,
                ConfigApplyReceiptStatus::Failed,
            ],
        );
        assert_eq!(
            aggregate_apply_status(&partial),
            Some(ConfigApplyStatus::Partial)
        );
    }

    #[test]
    fn aggregate_reports_superseded_receipts_as_partial() {
        let superseded = commit_with_receipts(
            ConfigCommitStatus::Partial,
            &[
                ConfigApplyReceiptStatus::Applied,
                ConfigApplyReceiptStatus::Superseded,
            ],
        );

        assert_eq!(
            aggregate_apply_status(&superseded),
            Some(ConfigApplyStatus::Partial)
        );
    }

    #[test]
    fn aggregate_waits_while_any_receipt_is_pending() {
        let commit = commit_with_receipts(
            ConfigCommitStatus::Applying,
            &[
                ConfigApplyReceiptStatus::RestartRequired,
                ConfigApplyReceiptStatus::Pending,
            ],
        );

        assert_eq!(aggregate_apply_status(&commit), None);
    }
}
