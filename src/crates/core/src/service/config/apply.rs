//! Runtime configuration apply coordination.
//!
//! The registry owns both preparation and ordered side-effect execution. A
//! successful prepare returns an immutable reservation, so adapter liveness
//! cannot change between validation, durable commit, and dispatch.

use super::types::GlobalConfig;
use crate::error::{CoreError, CoreResult};
use sparo_events::{ConfigApplyStrategy, ConfigValueChange};
use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::{mpsc, oneshot};

const CONFIG_APPLY_QUEUE_CAPACITY: usize = 64;
const CONFIG_APPLY_EXECUTION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(25);

pub const CONFIG_APPLY_CONSUMER_RUNTIME_LOGGING: &str = "runtime-logging";
pub const CONFIG_APPLY_CONSUMER_RUNTIME_I18N: &str = "runtime-i18n";
pub const CONFIG_APPLY_CONSUMER_DEBUG_INGEST: &str = "debug-ingest";
pub const CONFIG_APPLY_CONSUMER_HOST_AUTO_SCAN: &str = "host-auto-scan";
pub const CONFIG_APPLY_CONSUMER_AI_MODEL_RUNTIME: &str = "ai-model-runtime";
pub const CONFIG_APPLY_CONSUMER_INACTIVE_RUNTIME: &str = "inactive-runtime";

/// One exact setting path or complete configuration subtree owned by a live
/// runtime apply adapter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigApplyPathPattern {
    Exact(String),
    Prefix(String),
}

impl ConfigApplyPathPattern {
    pub fn exact(path: impl Into<String>) -> Self {
        Self::Exact(path.into())
    }

    /// Owns the exact root path and all of its dot-separated descendants.
    pub fn prefix(path: impl Into<String>) -> Self {
        Self::Prefix(path.into())
    }

    fn path(&self) -> &str {
        match self {
            Self::Exact(path) | Self::Prefix(path) => path,
        }
    }

    fn matches(&self, candidate: &str) -> bool {
        match self {
            Self::Exact(path) => candidate == path,
            Self::Prefix(path) => {
                candidate == path
                    || candidate
                        .strip_prefix(path)
                        .is_some_and(|suffix| suffix.starts_with('.'))
            }
        }
    }

    fn overlaps(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Exact(left), Self::Exact(right)) => left == right,
            (Self::Exact(path), prefix @ Self::Prefix(_))
            | (prefix @ Self::Prefix(_), Self::Exact(path)) => prefix.matches(path),
            (Self::Prefix(left), Self::Prefix(right)) => {
                subtree_contains(left, right) || subtree_contains(right, left)
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigApplyAdapterCriticality {
    NonCritical,
    Critical,
}

impl ConfigApplyAdapterCriticality {
    fn is_critical(self) -> bool {
        self == Self::Critical
    }
}

#[derive(Clone)]
pub struct ConfigApplyPrepareContext {
    pub current: GlobalConfig,
    pub candidate: GlobalConfig,
    pub changes: Vec<ConfigValueChange>,
}

#[derive(Clone)]
pub struct ConfigApplyContext {
    pub commit_id: String,
    pub revision: u64,
    pub origin: ConfigApplyOrigin,
    pub snapshot: GlobalConfig,
    pub changes: Vec<ConfigValueChange>,
}

/// Identifies whether one process-local adapter invocation is backed by a
/// durable origin-process receipt or reconciles a commit that another process
/// already persisted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigApplyOrigin {
    DurableReceipt { attempt: u32 },
    ExternalReconciliation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExternalConfigApplyStatus {
    Applying,
    Applied,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalConfigApplyState {
    pub reconciliation_id: String,
    pub revision: u64,
    pub consumer: String,
    pub setting_ids: Vec<String>,
    pub status: ExternalConfigApplyStatus,
    pub failure_code: Option<String>,
}

pub type ConfigApplyPrepareFuture = Pin<Box<dyn Future<Output = CoreResult<()>> + Send>>;
pub type ConfigApplyPrepare =
    Arc<dyn Fn(ConfigApplyPrepareContext) -> ConfigApplyPrepareFuture + Send + Sync>;
pub type ConfigApplyFuture = Pin<Box<dyn Future<Output = CoreResult<()>> + Send>>;
pub type ConfigApply = Arc<dyn Fn(ConfigApplyContext) -> ConfigApplyFuture + Send + Sync>;

struct QueuedConfigApply {
    context: ConfigApplyContext,
    completion: oneshot::Sender<CoreResult<()>>,
}

#[derive(Clone)]
struct ConfigApplyAdapterEntry {
    generation: u64,
    patterns: Vec<ConfigApplyPathPattern>,
    criticality: ConfigApplyAdapterCriticality,
    prepare: Option<ConfigApplyPrepare>,
    sender: mpsc::Sender<QueuedConfigApply>,
}

static CONFIG_APPLY_ADAPTERS: OnceLock<Mutex<BTreeMap<String, ConfigApplyAdapterEntry>>> =
    OnceLock::new();
static EXTERNAL_CONFIG_APPLY_STATES: OnceLock<Mutex<BTreeMap<String, ExternalConfigApplyState>>> =
    OnceLock::new();
static NEXT_ADAPTER_GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(Debug)]
pub struct ConfigApplyAdapterRegistration {
    consumer: String,
    generation: u64,
}

impl Drop for ConfigApplyAdapterRegistration {
    fn drop(&mut self) {
        let mut adapters = config_apply_adapters()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if adapters
            .get(&self.consumer)
            .is_some_and(|entry| entry.generation == self.generation)
        {
            adapters.remove(&self.consumer);
        }
    }
}

/// Registers exactly one live adapter, including its complete path ownership
/// and failure criticality. The worker is a single FIFO queue, so a later
/// revision can never finish before an earlier revision for the same consumer.
pub fn register_config_apply_adapter(
    consumer: &str,
    patterns: Vec<ConfigApplyPathPattern>,
    criticality: ConfigApplyAdapterCriticality,
    prepare: Option<ConfigApplyPrepare>,
    apply: ConfigApply,
) -> CoreResult<ConfigApplyAdapterRegistration> {
    let consumer = consumer.trim();
    if consumer.is_empty() {
        return Err(CoreError::validation(
            "config.apply_adapter_consumer_required",
        ));
    }
    let runtime = tokio::runtime::Handle::try_current().map_err(|_| {
        CoreError::config("Config apply adapter registration requires an async runtime")
    })?;
    let mut adapters = config_apply_adapters()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if adapters.contains_key(consumer) {
        return Err(CoreError::validation(format!(
            "config.apply_adapter_already_registered: '{consumer}'"
        )));
    }
    validate_patterns(consumer, &patterns, &adapters)?;

    let generation = NEXT_ADAPTER_GENERATION.fetch_add(1, Ordering::Relaxed);
    let (sender, mut receiver) = mpsc::channel::<QueuedConfigApply>(CONFIG_APPLY_QUEUE_CAPACITY);
    runtime.spawn(async move {
        while let Some(job) = receiver.recv().await {
            let result = tokio::time::timeout(CONFIG_APPLY_EXECUTION_TIMEOUT, apply(job.context))
                .await
                .unwrap_or_else(|_| {
                    Err(CoreError::config(
                        "Config apply adapter exceeded its execution deadline",
                    ))
                });
            let _ = job.completion.send(result);
        }
    });
    adapters.insert(
        consumer.to_string(),
        ConfigApplyAdapterEntry {
            generation,
            patterns,
            criticality,
            prepare,
            sender,
        },
    );
    drop(adapters);
    let recovery_consumer = consumer.to_string();
    runtime.spawn(async move {
        if !super::global::GlobalConfigManager::is_initialized() {
            return;
        }
        let service = match super::global::GlobalConfigManager::get_service().await {
            Ok(service) => service,
            Err(_) => {
                log::warn!(
                    "Failed to access config service for apply recovery: consumer={}, failure_code=config.apply_recovery_service_unavailable",
                    recovery_consumer
                );
                return;
            }
        };
        if service
            .resume_pending_applies(&recovery_consumer)
            .await
            .is_err()
        {
            log::warn!(
                "Failed to resume pending config applies: consumer={}, failure_code=config.apply_recovery_failed",
                recovery_consumer
            );
        }
    });
    Ok(ConfigApplyAdapterRegistration {
        consumer: consumer.to_string(),
        generation,
    })
}

#[derive(Clone)]
pub(crate) struct PreparedConfigApply {
    consumer: String,
    changes: Vec<ConfigValueChange>,
    sender: mpsc::Sender<QueuedConfigApply>,
}

impl PreparedConfigApply {
    pub(crate) fn consumer(&self) -> &str {
        &self.consumer
    }

    pub(crate) fn paths(&self) -> Vec<String> {
        self.changes
            .iter()
            .map(|change| change.path.clone())
            .collect()
    }

    pub(crate) async fn dispatch(
        self,
        commit_id: String,
        revision: u64,
        receipt_attempt: u32,
        snapshot: GlobalConfig,
    ) -> CoreResult<()> {
        let result = self
            .enqueue(
                commit_id,
                revision,
                ConfigApplyOrigin::DurableReceipt {
                    attempt: receipt_attempt,
                },
                snapshot,
            )
            .await?;
        result
            .await
            .map_err(|_| CoreError::config("Config apply adapter worker stopped"))?
    }

    async fn enqueue(
        self,
        commit_id: String,
        revision: u64,
        origin: ConfigApplyOrigin,
        snapshot: GlobalConfig,
    ) -> CoreResult<oneshot::Receiver<CoreResult<()>>> {
        let (completion, result) = oneshot::channel();
        self.sender
            .send(QueuedConfigApply {
                context: ConfigApplyContext {
                    commit_id,
                    revision,
                    origin,
                    snapshot,
                    changes: self.changes,
                },
                completion,
            })
            .await
            .map_err(|_| CoreError::config("Config apply adapter queue is closed"))?;
        Ok(result)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConfigApplyReceiptRoute {
    pub(crate) consumer: String,
    pub(crate) critical: bool,
    pub(crate) active: bool,
}

impl ConfigApplyReceiptRoute {
    pub(crate) fn active(consumer: &str, critical: bool) -> Self {
        Self {
            consumer: consumer.to_string(),
            critical,
            active: true,
        }
    }

    pub(crate) fn inactive() -> Self {
        Self {
            consumer: CONFIG_APPLY_CONSUMER_INACTIVE_RUNTIME.to_string(),
            critical: false,
            active: false,
        }
    }
}

#[derive(Default)]
pub(crate) struct PreparedConfigApplySet {
    reservations: BTreeMap<String, PreparedConfigApply>,
    receipt_routes: BTreeMap<String, ConfigApplyReceiptRoute>,
}

impl PreparedConfigApplySet {
    pub(crate) fn consumers(&self) -> BTreeSet<String> {
        self.reservations.keys().cloned().collect()
    }

    pub(crate) fn into_reservations(self) -> Vec<PreparedConfigApply> {
        self.reservations.into_values().collect()
    }

    pub(crate) fn receipt_routes(&self) -> &BTreeMap<String, ConfigApplyReceiptRoute> {
        &self.receipt_routes
    }
}

/// Runs deterministic preparation and captures apply queue reservations for
/// every currently live affected consumer.
pub(crate) async fn prepare_config_apply(
    current: &GlobalConfig,
    candidate: &GlobalConfig,
    changes: &[ConfigValueChange],
) -> CoreResult<PreparedConfigApplySet> {
    let (affected, receipt_routes) = route_config_applies(changes);
    let mut prepared = PreparedConfigApplySet {
        reservations: BTreeMap::new(),
        receipt_routes,
    };

    for (consumer, (entry, consumer_changes)) in affected {
        if let Some(prepare) = entry.prepare {
            prepare(ConfigApplyPrepareContext {
                current: current.clone(),
                candidate: candidate.clone(),
                changes: consumer_changes.clone(),
            })
            .await
            .map_err(|error| {
                CoreError::validation(format!(
                    "config.apply_prepare_failed: consumer '{consumer}': {error}"
                ))
            })?;
        }
        prepared.reservations.insert(
            consumer.clone(),
            PreparedConfigApply {
                consumer,
                changes: consumer_changes,
                sender: entry.sender,
            },
        );
    }

    Ok(prepared)
}

/// Reconciles an authoritative snapshot discovered after another process has
/// already committed it. This path deliberately has no durable receipt: it
/// prepares each live local adapter independently, enqueues work in the same
/// FIFO as origin-process applies, and records only process-local state.
pub(crate) async fn reconcile_external_config_apply(
    reconciliation_id: String,
    revision: u64,
    current: GlobalConfig,
    candidate: GlobalConfig,
    changes: Vec<ConfigValueChange>,
) {
    let (affected, _) = route_config_applies(&changes);
    for (consumer, (entry, consumer_changes)) in affected {
        let setting_ids = consumer_changes
            .iter()
            .map(|change| change.setting_id.clone())
            .collect::<Vec<_>>();
        record_external_config_apply_state(ExternalConfigApplyState {
            reconciliation_id: reconciliation_id.clone(),
            revision,
            consumer: consumer.clone(),
            setting_ids: setting_ids.clone(),
            status: ExternalConfigApplyStatus::Applying,
            failure_code: None,
        });

        if let Some(prepare) = entry.prepare {
            if prepare(ConfigApplyPrepareContext {
                current: current.clone(),
                candidate: candidate.clone(),
                changes: consumer_changes.clone(),
            })
            .await
            .is_err()
            {
                record_external_config_apply_failure(
                    &reconciliation_id,
                    revision,
                    &consumer,
                    setting_ids,
                    "config.external_apply_prepare_failed",
                );
                continue;
            }
        }

        let prepared = PreparedConfigApply {
            consumer: consumer.clone(),
            changes: consumer_changes,
            sender: entry.sender,
        };
        let result = match prepared
            .enqueue(
                reconciliation_id.clone(),
                revision,
                ConfigApplyOrigin::ExternalReconciliation,
                candidate.clone(),
            )
            .await
        {
            Ok(result) => result,
            Err(_) => {
                record_external_config_apply_failure(
                    &reconciliation_id,
                    revision,
                    &consumer,
                    setting_ids,
                    "config.external_apply_enqueue_failed",
                );
                continue;
            }
        };

        let task_reconciliation_id = reconciliation_id.clone();
        tokio::spawn(async move {
            match result.await {
                Ok(Ok(())) => {
                    record_external_config_apply_state(ExternalConfigApplyState {
                        reconciliation_id: task_reconciliation_id.clone(),
                        revision,
                        consumer: consumer.clone(),
                        setting_ids,
                        status: ExternalConfigApplyStatus::Applied,
                        failure_code: None,
                    });
                    log::debug!(
                        "External config apply reconciliation completed: reconciliation_id={}, revision={}, consumer={}",
                        task_reconciliation_id,
                        revision,
                        consumer
                    );
                }
                Ok(Err(_)) => record_external_config_apply_failure(
                    &task_reconciliation_id,
                    revision,
                    &consumer,
                    setting_ids,
                    "config.external_apply_failed",
                ),
                Err(_) => record_external_config_apply_failure(
                    &task_reconciliation_id,
                    revision,
                    &consumer,
                    setting_ids,
                    "config.external_apply_worker_stopped",
                ),
            }
        });
    }
}

fn route_config_applies(
    changes: &[ConfigValueChange],
) -> (
    BTreeMap<String, (ConfigApplyAdapterEntry, Vec<ConfigValueChange>)>,
    BTreeMap<String, ConfigApplyReceiptRoute>,
) {
    let adapters = config_apply_adapters()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    let mut affected = BTreeMap::<String, (ConfigApplyAdapterEntry, Vec<ConfigValueChange>)>::new();
    let mut receipt_routes = BTreeMap::new();
    for change in changes
        .iter()
        .filter(|change| change.apply_strategy == ConfigApplyStrategy::Adapter)
    {
        let Some((consumer, entry)) = adapters.iter().find(|(_, entry)| {
            entry
                .patterns
                .iter()
                .any(|pattern| pattern.matches(&change.path))
        }) else {
            receipt_routes.insert(change.path.clone(), ConfigApplyReceiptRoute::inactive());
            continue;
        };
        receipt_routes.insert(
            change.path.clone(),
            ConfigApplyReceiptRoute::active(consumer, entry.criticality.is_critical()),
        );
        affected
            .entry(consumer.clone())
            .or_insert_with(|| (entry.clone(), Vec::new()))
            .1
            .push(change.clone());
    }
    (affected, receipt_routes)
}

fn record_external_config_apply_failure(
    reconciliation_id: &str,
    revision: u64,
    consumer: &str,
    setting_ids: Vec<String>,
    failure_code: &str,
) {
    record_external_config_apply_state(ExternalConfigApplyState {
        reconciliation_id: reconciliation_id.to_string(),
        revision,
        consumer: consumer.to_string(),
        setting_ids,
        status: ExternalConfigApplyStatus::Failed,
        failure_code: Some(failure_code.to_string()),
    });
    log::error!(
        "External config apply reconciliation failed: reconciliation_id={}, revision={}, consumer={}, failure_code={}",
        reconciliation_id,
        revision,
        consumer,
        failure_code
    );
}

fn record_external_config_apply_state(state: ExternalConfigApplyState) {
    let mut states = external_config_apply_states()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if states
        .get(&state.consumer)
        .is_some_and(|current| current.revision > state.revision)
    {
        return;
    }
    states.insert(state.consumer.clone(), state);
}

pub fn external_config_apply_state(consumer: &str) -> Option<ExternalConfigApplyState> {
    external_config_apply_states()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(consumer)
        .cloned()
}

fn subtree_contains(root: &str, candidate: &str) -> bool {
    candidate == root
        || candidate
            .strip_prefix(root)
            .is_some_and(|suffix| suffix.starts_with('.'))
}

fn validate_patterns(
    consumer: &str,
    patterns: &[ConfigApplyPathPattern],
    adapters: &BTreeMap<String, ConfigApplyAdapterEntry>,
) -> CoreResult<()> {
    if patterns.is_empty() {
        return Err(CoreError::validation(format!(
            "config.apply_adapter_patterns_required: consumer '{consumer}'"
        )));
    }

    for (index, pattern) in patterns.iter().enumerate() {
        let path = pattern.path();
        if path.is_empty()
            || path.trim() != path
            || path.starts_with('.')
            || path.ends_with('.')
            || path.split('.').any(str::is_empty)
        {
            return Err(CoreError::validation(format!(
                "config.apply_adapter_path_invalid: consumer '{consumer}', path '{path}'"
            )));
        }
        for other in patterns.iter().skip(index + 1) {
            if pattern.overlaps(other) {
                return Err(CoreError::validation(format!(
                    "config.apply_adapter_pattern_overlap: consumer '{consumer}', paths '{}' and '{}'",
                    pattern.path(),
                    other.path()
                )));
            }
        }
        for (owner, entry) in adapters {
            if let Some(other) = entry.patterns.iter().find(|other| pattern.overlaps(other)) {
                return Err(CoreError::validation(format!(
                    "config.apply_adapter_pattern_overlap: consumer '{consumer}' path '{}' overlaps consumer '{owner}' path '{}'",
                    pattern.path(),
                    other.path()
                )));
            }
        }
    }

    Ok(())
}

fn config_apply_adapters() -> &'static Mutex<BTreeMap<String, ConfigApplyAdapterEntry>> {
    CONFIG_APPLY_ADAPTERS.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn external_config_apply_states() -> &'static Mutex<BTreeMap<String, ExternalConfigApplyState>> {
    EXTERNAL_CONFIG_APPLY_STATES.get_or_init(|| Mutex::new(BTreeMap::new()))
}

#[cfg(test)]
pub(crate) async fn acquire_config_apply_test_lock() -> tokio::sync::OwnedMutexGuard<()> {
    static LOCK: OnceLock<Arc<tokio::sync::Mutex<()>>> = OnceLock::new();
    LOCK.get_or_init(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
        .lock_owned()
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sparo_events::{ConfigApplyStrategy, ConfigStoredValue};

    fn no_op_apply() -> ConfigApply {
        Arc::new(|_| Box::pin(async { Ok(()) }))
    }

    #[tokio::test]
    async fn active_adapter_is_prepared_and_reserved_before_commit() {
        let _apply_test_guard = acquire_config_apply_test_lock().await;
        let current = GlobalConfig::default();
        let candidate = current.clone();
        let changes = vec![ConfigValueChange {
            setting_id: "core.ai.stream_idle_timeout_secs".to_string(),
            path: "ai.stream_idle_timeout_secs".to_string(),
            old_value: ConfigStoredValue::public(serde_json::Value::Null),
            new_value: ConfigStoredValue::public(serde_json::json!(30)),
            apply_strategy: ConfigApplyStrategy::Adapter,
        }];

        let inactive = prepare_config_apply(&current, &candidate, &changes)
            .await
            .expect("inactive runtime has no state to prepare");
        assert!(inactive.consumers().is_empty());
        assert_eq!(
            inactive.receipt_routes().get("ai.stream_idle_timeout_secs"),
            Some(&ConfigApplyReceiptRoute::inactive())
        );

        let prepare: ConfigApplyPrepare = Arc::new(|_| {
            Box::pin(async { Err(CoreError::validation("runtime resource is unavailable")) })
        });
        let _registration = register_config_apply_adapter(
            CONFIG_APPLY_CONSUMER_AI_MODEL_RUNTIME,
            vec![ConfigApplyPathPattern::exact("ai.stream_idle_timeout_secs")],
            ConfigApplyAdapterCriticality::Critical,
            Some(prepare),
            no_op_apply(),
        )
        .expect("register adapter");
        let rejected = match prepare_config_apply(&current, &candidate, &changes).await {
            Ok(_) => panic!("prepare rejection must abort"),
            Err(error) => error,
        };
        assert!(rejected.to_string().contains("config.apply_prepare_failed"));
    }

    #[tokio::test]
    async fn registry_routes_owned_paths_and_rejects_overlapping_ownership() {
        let _apply_test_guard = acquire_config_apply_test_lock().await;
        let missing_patterns = register_config_apply_adapter(
            "owner-without-paths",
            Vec::new(),
            ConfigApplyAdapterCriticality::NonCritical,
            None,
            no_op_apply(),
        )
        .expect_err("an adapter must declare path ownership");
        assert!(missing_patterns
            .to_string()
            .contains("config.apply_adapter_patterns_required"));

        let redundant_patterns = register_config_apply_adapter(
            "redundant-owner",
            vec![
                ConfigApplyPathPattern::prefix("ai.models"),
                ConfigApplyPathPattern::exact("ai.models.primary"),
            ],
            ConfigApplyAdapterCriticality::NonCritical,
            None,
            no_op_apply(),
        )
        .expect_err("one adapter cannot declare overlapping ownership");
        assert!(redundant_patterns
            .to_string()
            .contains("config.apply_adapter_pattern_overlap"));

        let registration = register_config_apply_adapter(
            "models-owner",
            vec![ConfigApplyPathPattern::prefix("ai.models")],
            ConfigApplyAdapterCriticality::NonCritical,
            None,
            no_op_apply(),
        )
        .expect("register model owner");

        let overlap = register_config_apply_adapter(
            "model-child-owner",
            vec![ConfigApplyPathPattern::exact("ai.models.primary")],
            ConfigApplyAdapterCriticality::NonCritical,
            None,
            no_op_apply(),
        )
        .expect_err("overlapping ownership must be rejected");
        assert!(overlap
            .to_string()
            .contains("config.apply_adapter_pattern_overlap"));

        let change = |setting_id: &str, path: &str| ConfigValueChange {
            setting_id: setting_id.to_string(),
            path: path.to_string(),
            old_value: ConfigStoredValue::public(serde_json::Value::Null),
            new_value: ConfigStoredValue::public(serde_json::json!(true)),
            apply_strategy: ConfigApplyStrategy::Adapter,
        };
        let prepared = prepare_config_apply(
            &GlobalConfig::default(),
            &GlobalConfig::default(),
            &[
                change("core.ai.models", "ai.models"),
                change("core.ai.proxy.url", "ai.proxy.url"),
                change("core.ai.models_legacy.enabled", "ai.models_legacy.enabled"),
            ],
        )
        .await
        .expect("route adapter changes");

        assert_eq!(
            prepared.consumers(),
            BTreeSet::from(["models-owner".to_string()])
        );
        assert_eq!(
            prepared.receipt_routes().get("ai.models"),
            Some(&ConfigApplyReceiptRoute::active("models-owner", false))
        );
        assert_eq!(
            prepared.receipt_routes().get("ai.proxy.url"),
            Some(&ConfigApplyReceiptRoute::inactive())
        );
        assert_eq!(
            prepared.receipt_routes().get("ai.models_legacy.enabled"),
            Some(&ConfigApplyReceiptRoute::inactive())
        );

        drop(registration);
    }
}
