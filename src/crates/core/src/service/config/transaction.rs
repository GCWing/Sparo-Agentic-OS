//! Revisioned configuration transaction contracts and durable coordination state.

use super::apply::ConfigApplyReceiptRoute;
use super::catalog::{ConfigCatalog, SettingRisk};
use super::types::GlobalConfig;
use crate::error::{CoreError, CoreResult};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sparo_events::{
    ConfigApplyStatus, ConfigApplyStatusEvent, ConfigApplyStrategy, ConfigChangeSource,
    ConfigScope, ConfigStoredValue, ConfigValueChange, PublishedConfigValueChange,
    SettingsSectionRef,
};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::OnceLock;

pub(crate) const PLAN_TTL_MILLIS: i64 = 5 * 60 * 1_000;
pub(crate) const TRANSACTION_HISTORY_TTL_MILLIS: i64 = 30 * 60 * 1_000;
pub(crate) const MAX_TRANSACTION_HISTORY_ENTRIES: usize = 256;

/// A versioned, redacted configuration snapshot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSnapshot {
    pub revision: u64,
    pub catalog_version: String,
    pub scope: ConfigScope,
    pub values: BTreeMap<String, ConfigStoredValue>,
}

/// Catalog-backed patch prepared against an expected revision.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigPatch {
    pub request_id: String,
    pub idempotency_key: String,
    pub expected_revision: u64,
    pub source: ConfigChangeSource,
    pub scope: ConfigScope,
    pub operations: Vec<ConfigPatchOperation>,
}

/// The only generic mutation operations exposed by configuration transactions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "op",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ConfigPatchOperation {
    Set { setting_id: String, value: Value },
    Reset { setting_id: String },
}

impl ConfigPatchOperation {
    pub fn setting_id(&self) -> &str {
        match self {
            Self::Set { setting_id, .. } | Self::Reset { setting_id } => setting_id,
        }
    }
}

/// One redacted change in a validated plan.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPlanChange {
    pub setting_id: String,
    pub before: ConfigStoredValue,
    pub after: ConfigStoredValue,
    pub risk: SettingRisk,
    pub apply_strategy: ConfigApplyStrategy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPlanWarning {
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setting_id: Option<String>,
}

/// Immutable, short-lived validated plan.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPlan {
    pub plan_id: String,
    pub base_revision: u64,
    pub catalog_version: String,
    pub operation_hash: String,
    pub expires_at_ms: i64,
    pub changes: Vec<ConfigPlanChange>,
    pub requires_confirmation: bool,
    pub affected_sections: Vec<SettingsSectionRef>,
    pub warnings: Vec<ConfigPlanWarning>,
}

/// Request to atomically commit an existing validated plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitConfigPlanRequest {
    pub plan_id: String,
    pub expected_revision: u64,
    pub idempotency_key: String,
    pub confirmed: bool,
}

/// Request to create a compensating commit for an earlier commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UndoConfigCommitRequest {
    pub commit_id: String,
    pub undo_token: String,
    pub expected_revision: u64,
    pub idempotency_key: String,
    pub confirmed: bool,
}

/// Requests a new apply attempt for one failed non-critical consumer without
/// rewriting the already committed configuration values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetryConfigApplyRequest {
    pub commit_id: String,
    pub expected_revision: u64,
    pub consumer: String,
    pub expected_attempt: u32,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConfigApplyReceiptStatus {
    Pending,
    Applied,
    RestartRequired,
    Superseded,
    Failed,
    RolledBack,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigApplyReceipt {
    pub consumer: String,
    pub setting_ids: Vec<String>,
    pub paths: Vec<String>,
    pub attempt: u32,
    pub attempted_at: chrono::DateTime<chrono::Utc>,
    pub status: ConfigApplyReceiptStatus,
    pub critical: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishedConfigApplyReceipt {
    pub consumer: String,
    pub setting_ids: Vec<String>,
    pub attempt: u32,
    pub attempted_at: chrono::DateTime<chrono::Utc>,
    pub status: ConfigApplyReceiptStatus,
    pub critical: bool,
}

impl ConfigApplyReceipt {
    pub fn published(&self) -> PublishedConfigApplyReceipt {
        PublishedConfigApplyReceipt {
            consumer: self.consumer.clone(),
            setting_ids: self.setting_ids.clone(),
            attempt: self.attempt,
            attempted_at: self.attempted_at,
            status: self.status,
            critical: self.critical,
        }
    }
}

const fn initial_receipt_attempt() -> u32 {
    1
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConfigCommitStatus {
    Applying,
    Applied,
    Partial,
    RolledBack,
}

/// Authoritative result of a successful atomic commit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigCommit {
    pub commit_id: String,
    pub revision: u64,
    pub status: ConfigCommitStatus,
    pub scope: ConfigScope,
    pub source: ConfigChangeSource,
    pub changes: Vec<ConfigValueChange>,
    pub apply_receipts: Vec<ConfigApplyReceipt>,
    pub affected_sections: Vec<SettingsSectionRef>,
    pub restart_required: Vec<String>,
    pub undo_token: Option<String>,
    pub committed_at: chrono::DateTime<chrono::Utc>,
}

/// Storage-free commit result shared with Desktop, CLI, and SettingsAgent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishedConfigCommit {
    pub commit_id: String,
    pub revision: u64,
    pub status: ConfigCommitStatus,
    pub scope: ConfigScope,
    pub source: ConfigChangeSource,
    pub changes: Vec<PublishedConfigValueChange>,
    pub apply_receipts: Vec<PublishedConfigApplyReceipt>,
    pub affected_sections: Vec<SettingsSectionRef>,
    pub restart_required: Vec<String>,
    pub undo_token: Option<String>,
    pub committed_at: chrono::DateTime<chrono::Utc>,
}

impl ConfigCommit {
    pub fn published(&self) -> PublishedConfigCommit {
        PublishedConfigCommit {
            commit_id: self.commit_id.clone(),
            revision: self.revision,
            status: self.status,
            scope: self.scope.clone(),
            source: self.source.clone(),
            changes: self
                .changes
                .iter()
                .map(ConfigValueChange::published)
                .collect(),
            apply_receipts: self
                .apply_receipts
                .iter()
                .map(ConfigApplyReceipt::published)
                .collect(),
            affected_sections: self.affected_sections.clone(),
            restart_required: self.restart_required.clone(),
            undo_token: self.undo_token.clone(),
            committed_at: self.committed_at,
        }
    }
}

/// Redacted payload used by ToolPipeline for an authoritative undo confirmation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigUndoConfirmation {
    pub commit_id: String,
    pub revision: u64,
    pub changes: Vec<ConfigValueChange>,
    pub affected_sections: Vec<SettingsSectionRef>,
    pub requires_confirmation: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishedConfigUndoConfirmation {
    pub commit_id: String,
    pub revision: u64,
    pub changes: Vec<PublishedConfigValueChange>,
    pub affected_sections: Vec<SettingsSectionRef>,
    pub requires_confirmation: bool,
}

impl ConfigUndoConfirmation {
    pub fn published(&self) -> PublishedConfigUndoConfirmation {
        PublishedConfigUndoConfirmation {
            commit_id: self.commit_id.clone(),
            revision: self.revision,
            changes: self
                .changes
                .iter()
                .map(ConfigValueChange::published)
                .collect(),
            affected_sections: self.affected_sections.clone(),
            requires_confirmation: self.requires_confirmation,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RawConfigChange {
    pub setting_id: String,
    pub path: String,
    pub before: Value,
    pub after: Value,
    pub risk: SettingRisk,
    pub apply_strategy: ConfigApplyStrategy,
}

#[derive(Debug, Clone)]
pub(crate) struct PendingConfigPlan {
    pub plan: ConfigPlan,
    pub candidate: GlobalConfig,
    pub raw_changes: Vec<RawConfigChange>,
    pub source: ConfigChangeSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StoredConfigCommit {
    pub commit: ConfigCommit,
    pub raw_changes: Vec<RawConfigChange>,
    pub max_risk: SettingRisk,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct IdempotencyRecord {
    pub fingerprint: String,
    pub commit: ConfigCommit,
}

#[derive(Debug, Clone)]
pub(crate) struct PlanIdempotencyRecord {
    pub fingerprint: String,
    pub plan: ConfigPlan,
}

#[derive(Clone)]
pub(crate) struct ConfigTransactionState {
    pub revision: u64,
    pub catalog: ConfigCatalog,
    pub pending_plans: HashMap<String, PendingConfigPlan>,
    pub plan_idempotency: HashMap<String, PlanIdempotencyRecord>,
    pub commits: HashMap<String, StoredConfigCommit>,
    pub idempotency: HashMap<String, IdempotencyRecord>,
}

const TRANSACTION_JOURNAL_FORMAT_VERSION: u8 = 1;

/// Bounded, authenticated transaction state embedded in the same atomic file
/// as the configuration snapshot. Pending plans are deliberately excluded:
/// they are short-lived interaction state and must be planned again after a
/// restart, while commits, undo material, receipts, and idempotency survive.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DurableConfigTransactionJournal {
    format_version: u8,
    revision: u64,
    commits: HashMap<String, StoredConfigCommit>,
    idempotency: HashMap<String, IdempotencyRecord>,
}

impl ConfigTransactionState {
    pub fn new(revision: u64, catalog: ConfigCatalog) -> Self {
        Self {
            revision,
            catalog,
            pending_plans: HashMap::new(),
            plan_idempotency: HashMap::new(),
            commits: HashMap::new(),
            idempotency: HashMap::new(),
        }
    }

    pub fn durable_journal(&self) -> DurableConfigTransactionJournal {
        DurableConfigTransactionJournal {
            format_version: TRANSACTION_JOURNAL_FORMAT_VERSION,
            revision: self.revision,
            commits: self.commits.clone(),
            idempotency: self.idempotency.clone(),
        }
    }

    pub fn restore(
        catalog: ConfigCatalog,
        journal: DurableConfigTransactionJournal,
    ) -> CoreResult<Self> {
        if journal.format_version != TRANSACTION_JOURNAL_FORMAT_VERSION {
            return Err(CoreError::config(format!(
                "Unsupported config transaction journal version {}",
                journal.format_version
            )));
        }
        let revision = journal.revision;
        for (commit_id, stored) in &journal.commits {
            if commit_id != &stored.commit.commit_id || stored.commit.revision > revision {
                return Err(CoreError::config(
                    "Config transaction journal contains an invalid commit",
                ));
            }
            if stored
                .raw_changes
                .iter()
                .any(|change| change.setting_id.is_empty() || change.path.is_empty())
            {
                return Err(CoreError::config(
                    "Config transaction journal contains an invalid rollback change",
                ));
            }
        }
        if journal.idempotency.iter().any(|(key, record)| {
            key.trim().is_empty()
                || record.fingerprint.is_empty()
                || record.commit.revision > revision
        }) {
            return Err(CoreError::config(
                "Config transaction journal contains an invalid idempotency record",
            ));
        }

        // A field removed from the current persistence schema can still appear
        // in the bounded undo journal. The current snapshot remains
        // authoritative, so discard only commits that can no longer be safely
        // replayed instead of rejecting the entire configuration.
        let stale_commit_ids = journal
            .commits
            .iter()
            .filter_map(|(commit_id, stored)| {
                stored
                    .raw_changes
                    .iter()
                    .any(|change| {
                        catalog
                            .find(&change.setting_id)
                            .map(|descriptor| descriptor.storage.path.as_str())
                            != Some(change.path.as_str())
                    })
                    .then(|| commit_id.clone())
            })
            .collect::<HashSet<_>>();
        let mut commits = journal.commits;
        commits.retain(|commit_id, _| !stale_commit_ids.contains(commit_id));
        let mut idempotency = journal.idempotency;
        let idempotency_count_before = idempotency.len();
        idempotency.retain(|_, record| !stale_commit_ids.contains(&record.commit.commit_id));
        if !stale_commit_ids.is_empty() {
            log::warn!(
                "Discarded stale config transaction history: revision={}, commits={}, idempotency_records={}",
                revision,
                stale_commit_ids.len(),
                idempotency_count_before.saturating_sub(idempotency.len())
            );
        }

        let mut state = Self {
            revision,
            catalog,
            pending_plans: HashMap::new(),
            plan_idempotency: HashMap::new(),
            commits,
            idempotency,
        };
        state.prune_transaction_history(chrono::Utc::now().timestamp_millis());
        Ok(state)
    }

    pub fn snapshot(&self, config: &Value) -> ConfigSnapshot {
        ConfigSnapshot {
            revision: self.revision,
            catalog_version: self.catalog.version.clone(),
            scope: ConfigScope::user(),
            values: self.catalog.published_snapshot_values(config),
        }
    }

    pub fn remove_expired_plans(&mut self, now_ms: i64) {
        let expired: Vec<String> = self
            .pending_plans
            .iter()
            .filter(|(_, plan)| plan.plan.expires_at_ms <= now_ms)
            .map(|(plan_id, _)| plan_id.clone())
            .collect();
        for plan_id in expired {
            self.pending_plans.remove(&plan_id);
            plan_confirmation_index().remove(&plan_id);
        }
        self.plan_idempotency
            .retain(|_, record| record.plan.expires_at_ms > now_ms);
    }

    /// Bounds idempotency and undo state so plaintext rollback material never
    /// remains in memory beyond the short interactive undo window.
    pub fn prune_transaction_history(&mut self, now_ms: i64) {
        let cutoff_ms = now_ms.saturating_sub(TRANSACTION_HISTORY_TTL_MILLIS);
        let mut retained_commits = self
            .commits
            .iter()
            .filter_map(|(commit_id, stored)| {
                let committed_at_ms = stored.commit.committed_at.timestamp_millis();
                (committed_at_ms > cutoff_ms).then(|| (commit_id.clone(), committed_at_ms))
            })
            .collect::<Vec<_>>();
        retained_commits.sort_by_key(|(_, committed_at_ms)| *committed_at_ms);
        let overflow = retained_commits
            .len()
            .saturating_sub(MAX_TRANSACTION_HISTORY_ENTRIES);
        let retained_commit_ids = retained_commits
            .into_iter()
            .skip(overflow)
            .map(|(commit_id, _)| commit_id)
            .collect::<std::collections::HashSet<_>>();

        let removed_commit_ids = self
            .commits
            .keys()
            .filter(|commit_id| !retained_commit_ids.contains(*commit_id))
            .cloned()
            .collect::<Vec<_>>();
        for commit_id in removed_commit_ids {
            self.commits.remove(&commit_id);
        }

        let mut retained_idempotency = self
            .idempotency
            .iter()
            .filter_map(|(key, record)| {
                let committed_at_ms = record.commit.committed_at.timestamp_millis();
                (committed_at_ms > cutoff_ms).then(|| (key.clone(), committed_at_ms))
            })
            .collect::<Vec<_>>();
        retained_idempotency.sort_by_key(|(_, committed_at_ms)| *committed_at_ms);
        let overflow = retained_idempotency
            .len()
            .saturating_sub(MAX_TRANSACTION_HISTORY_ENTRIES);
        let retained_idempotency_keys = retained_idempotency
            .into_iter()
            .skip(overflow)
            .map(|(key, _)| key)
            .collect::<std::collections::HashSet<_>>();
        self.idempotency
            .retain(|key, _| retained_idempotency_keys.contains(key));
    }
}

#[derive(Clone)]
struct PlanConfirmationRecord {
    expires_at_ms: i64,
    plan: ConfigPlan,
}

#[derive(Clone)]
struct UndoConfirmationRecord {
    expires_at_ms: i64,
    confirmation: ConfigUndoConfirmation,
}

static PLAN_CONFIRMATIONS: OnceLock<DashMap<String, PlanConfirmationRecord>> = OnceLock::new();
static UNDO_CONFIRMATIONS: OnceLock<DashMap<String, UndoConfirmationRecord>> = OnceLock::new();

fn plan_confirmation_index() -> &'static DashMap<String, PlanConfirmationRecord> {
    PLAN_CONFIRMATIONS.get_or_init(DashMap::new)
}

fn undo_confirmation_index() -> &'static DashMap<String, UndoConfirmationRecord> {
    UNDO_CONFIRMATIONS.get_or_init(DashMap::new)
}

pub(crate) fn index_plan_confirmation(plan: &ConfigPlan) {
    plan_confirmation_index().insert(
        plan.plan_id.clone(),
        PlanConfirmationRecord {
            expires_at_ms: plan.expires_at_ms,
            plan: plan.clone(),
        },
    );
}

pub(crate) fn remove_plan_confirmation(plan_id: &str) {
    plan_confirmation_index().remove(plan_id);
}

pub(crate) fn index_undo_confirmation(commit: &StoredConfigCommit) {
    if commit.commit.undo_token.is_none() || commit.raw_changes.is_empty() {
        remove_undo_confirmation(&commit.commit.commit_id);
        return;
    }
    let confirmation = ConfigUndoConfirmation {
        commit_id: commit.commit.commit_id.clone(),
        revision: commit.commit.revision,
        changes: commit.commit.changes.clone(),
        affected_sections: commit.commit.affected_sections.clone(),
        requires_confirmation: commit.max_risk >= SettingRisk::Elevated,
    };
    undo_confirmation_index().insert(
        commit.commit.commit_id.clone(),
        UndoConfirmationRecord {
            expires_at_ms: commit
                .commit
                .committed_at
                .timestamp_millis()
                .saturating_add(TRANSACTION_HISTORY_TTL_MILLIS),
            confirmation,
        },
    );
}

pub(crate) fn synchronize_undo_confirmation_index(
    previous: &ConfigTransactionState,
    next: &ConfigTransactionState,
) {
    for commit_id in previous.commits.keys() {
        if !next.commits.contains_key(commit_id) {
            remove_undo_confirmation(commit_id);
        }
    }
    for stored in next.commits.values() {
        index_undo_confirmation(stored);
    }
}

pub(crate) fn remove_undo_confirmation(commit_id: &str) {
    undo_confirmation_index().remove(commit_id);
}

/// Returns whether Core requires confirmation for a plan. Unknown or expired is secure-default true.
pub fn config_plan_requires_confirmation(plan_id: &str) -> bool {
    config_plan_for_confirmation(plan_id)
        .map(|plan| plan.requires_confirmation)
        .unwrap_or(true)
}

/// Returns Core's redacted authoritative plan payload for ToolPipeline confirmation.
pub fn config_plan_for_confirmation(plan_id: &str) -> Option<ConfigPlan> {
    let record = plan_confirmation_index().get(plan_id)?.clone();
    if record.expires_at_ms <= chrono::Utc::now().timestamp_millis() {
        plan_confirmation_index().remove(plan_id);
        return None;
    }
    Some(record.plan)
}

/// Returns whether Core requires confirmation for undo. Unknown or expired is secure-default true.
pub fn config_undo_requires_confirmation(commit_id: &str) -> bool {
    config_undo_for_confirmation(commit_id)
        .map(|confirmation| confirmation.requires_confirmation)
        .unwrap_or(true)
}

/// Returns Core's redacted authoritative undo payload for ToolPipeline confirmation.
pub fn config_undo_for_confirmation(commit_id: &str) -> Option<ConfigUndoConfirmation> {
    let record = undo_confirmation_index().get(commit_id)?.clone();
    if record.expires_at_ms <= chrono::Utc::now().timestamp_millis() {
        undo_confirmation_index().remove(commit_id);
        return None;
    }
    Some(record.confirmation)
}

pub(crate) fn build_apply_receipts(
    changes: &[ConfigValueChange],
    routes: &BTreeMap<String, ConfigApplyReceiptRoute>,
) -> (ConfigCommitStatus, Vec<ConfigApplyReceipt>, Vec<String>) {
    let mut groups: BTreeMap<(String, String, bool, bool), Vec<&ConfigValueChange>> =
        BTreeMap::new();
    for change in changes {
        let (strategy, consumer, critical, active) = match change.apply_strategy {
            ConfigApplyStrategy::Reactive => {
                ("reactive", "config-snapshot".to_string(), true, true)
            }
            ConfigApplyStrategy::Adapter => {
                let route = routes
                    .get(&change.path)
                    .cloned()
                    .unwrap_or_else(ConfigApplyReceiptRoute::inactive);
                ("adapter", route.consumer, route.critical, route.active)
            }
            ConfigApplyStrategy::RestartRequired => (
                "restartRequired",
                "process-runtime".to_string(),
                false,
                false,
            ),
            ConfigApplyStrategy::ManualOnly => {
                ("manualOnly", "config-store".to_string(), true, true)
            }
        };
        groups
            .entry((strategy.to_string(), consumer, critical, active))
            .or_default()
            .push(change);
    }

    let mut receipts = Vec::new();
    let mut restart_required = Vec::new();
    for ((strategy, consumer, route_critical, route_active), grouped) in groups {
        let setting_ids: Vec<String> = grouped
            .iter()
            .map(|change| change.setting_id.clone())
            .collect();
        let paths = grouped.iter().map(|change| change.path.clone()).collect();
        let (status, critical, message) = match strategy.as_str() {
            "reactive" => (ConfigApplyReceiptStatus::Applied, true, None),
            "adapter" => {
                if route_active {
                    (
                        ConfigApplyReceiptStatus::Pending,
                        route_critical,
                        Some(format!("Awaiting {consumer}")),
                    )
                } else {
                    restart_required.extend(setting_ids.iter().cloned());
                    (
                        ConfigApplyReceiptStatus::RestartRequired,
                        false,
                        Some(format!(
                            "No live runtime adapter owns these paths; routed to '{consumer}' and saved for next start"
                        )),
                    )
                }
            }
            "restartRequired" => {
                restart_required.extend(setting_ids.iter().cloned());
                (
                    ConfigApplyReceiptStatus::RestartRequired,
                    false,
                    Some("Saved; takes effect after restart".to_string()),
                )
            }
            _ => (ConfigApplyReceiptStatus::Applied, true, None),
        };
        receipts.push(ConfigApplyReceipt {
            consumer,
            setting_ids,
            paths,
            attempt: initial_receipt_attempt(),
            attempted_at: chrono::Utc::now(),
            status,
            critical,
            message,
        });
    }

    let status = aggregate_receipt_status(&receipts);
    (status, receipts, restart_required)
}

pub(crate) fn apply_status_to_commit(
    commit: &mut ConfigCommit,
    event: &ConfigApplyStatusEvent,
) -> CoreResult<bool> {
    if commit.commit_id != event.commit_id || commit.revision != event.revision {
        return Err(CoreError::validation("config.apply_status_commit_mismatch"));
    }
    if event.paths.is_empty() {
        return Err(CoreError::validation("config.apply_status_paths_required"));
    }

    let receipt = commit
        .apply_receipts
        .iter_mut()
        .find(|receipt| receipt.consumer == event.consumer)
        .ok_or_else(|| CoreError::validation("config.apply_status_consumer_unknown"))?;
    if receipt.attempt != event.receipt_attempt {
        return Err(CoreError::validation(
            "config.apply_status_attempt_mismatch",
        ));
    }
    let reported_paths = event
        .paths
        .iter()
        .collect::<std::collections::BTreeSet<_>>();
    let expected_paths = receipt
        .paths
        .iter()
        .collect::<std::collections::BTreeSet<_>>();
    if reported_paths != expected_paths {
        return Err(CoreError::validation("config.apply_status_paths_mismatch"));
    }

    let next_status = match event.status {
        ConfigApplyStatus::Applied => ConfigApplyReceiptStatus::Applied,
        ConfigApplyStatus::RestartRequired => ConfigApplyReceiptStatus::RestartRequired,
        ConfigApplyStatus::Superseded => ConfigApplyReceiptStatus::Superseded,
        ConfigApplyStatus::Partial | ConfigApplyStatus::Failed => ConfigApplyReceiptStatus::Failed,
        ConfigApplyStatus::RolledBack => ConfigApplyReceiptStatus::RolledBack,
    };
    if receipt.status != ConfigApplyReceiptStatus::Pending {
        if receipt.status == next_status && receipt.message == event.message {
            return Ok(false);
        }
        return Err(CoreError::validation(
            "config.apply_status_already_terminal",
        ));
    }
    receipt.status = next_status;
    receipt.message = event.message.clone();
    let restart_setting_ids = if next_status == ConfigApplyReceiptStatus::RestartRequired {
        receipt.setting_ids.clone()
    } else {
        Vec::new()
    };

    for setting_id in restart_setting_ids {
        if !commit.restart_required.contains(&setting_id) {
            commit.restart_required.push(setting_id);
        }
    }

    commit.status = aggregate_receipt_status(&commit.apply_receipts);
    Ok(true)
}

fn aggregate_receipt_status(receipts: &[ConfigApplyReceipt]) -> ConfigCommitStatus {
    if receipts
        .iter()
        .any(|receipt| receipt.status == ConfigApplyReceiptStatus::Pending)
    {
        ConfigCommitStatus::Applying
    } else if receipts.iter().any(|receipt| {
        matches!(
            receipt.status,
            ConfigApplyReceiptStatus::Failed | ConfigApplyReceiptStatus::Superseded
        )
    }) {
        ConfigCommitStatus::Partial
    } else if !receipts.is_empty()
        && receipts
            .iter()
            .all(|receipt| receipt.status == ConfigApplyReceiptStatus::RolledBack)
    {
        ConfigCommitStatus::RolledBack
    } else {
        ConfigCommitStatus::Applied
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::config::apply::{
        ConfigApplyReceiptRoute, CONFIG_APPLY_CONSUMER_INACTIVE_RUNTIME,
        CONFIG_APPLY_CONSUMER_RUNTIME_LOGGING,
    };
    use sparo_events::ConfigChangeSource;

    #[test]
    fn patch_operations_use_one_strict_camel_case_wire_contract() {
        let operation: ConfigPatchOperation = serde_json::from_value(serde_json::json!({
            "op": "set",
            "settingId": "core.app.language",
            "value": "zh-CN"
        }))
        .expect("camel-case patch operation");
        assert_eq!(operation.setting_id(), "core.app.language");
        assert_eq!(
            serde_json::to_value(operation).expect("serialize patch operation"),
            serde_json::json!({
                "op": "set",
                "settingId": "core.app.language",
                "value": "zh-CN"
            })
        );

        let error = serde_json::from_value::<ConfigPatchOperation>(serde_json::json!({
            "op": "reset",
            "setting_id": "core.app.language"
        }))
        .expect_err("snake-case compatibility aliases are not supported");
        assert!(error.to_string().contains("setting_id"));
    }

    fn change(path: &str, strategy: ConfigApplyStrategy) -> ConfigValueChange {
        ConfigValueChange {
            setting_id: format!("setting.{path}"),
            path: path.to_string(),
            old_value: ConfigStoredValue::public(Value::Null),
            new_value: ConfigStoredValue::public(Value::Bool(true)),
            apply_strategy: strategy,
        }
    }

    fn live_logging_routes() -> BTreeMap<String, ConfigApplyReceiptRoute> {
        BTreeMap::from([(
            "app.logging.level".to_string(),
            ConfigApplyReceiptRoute::active(CONFIG_APPLY_CONSUMER_RUNTIME_LOGGING, false),
        )])
    }

    fn stored_commit(commit_id: &str, committed_at_ms: i64) -> StoredConfigCommit {
        StoredConfigCommit {
            commit: ConfigCommit {
                commit_id: commit_id.to_string(),
                revision: committed_at_ms.max(1) as u64,
                status: ConfigCommitStatus::Applied,
                scope: ConfigScope::user(),
                source: ConfigChangeSource::system(),
                changes: Vec::new(),
                apply_receipts: Vec::new(),
                affected_sections: Vec::new(),
                restart_required: Vec::new(),
                undo_token: Some(format!("undo-{commit_id}")),
                committed_at: chrono::DateTime::from_timestamp_millis(committed_at_ms)
                    .expect("valid timestamp"),
            },
            raw_changes: vec![RawConfigChange {
                setting_id: "core.secret".to_string(),
                path: "secret.value".to_string(),
                before: Value::String("plaintext-before".to_string()),
                after: Value::String("plaintext-after".to_string()),
                risk: SettingRisk::Safe,
                apply_strategy: ConfigApplyStrategy::Reactive,
            }],
            max_risk: SettingRisk::Safe,
        }
    }

    #[test]
    fn transaction_history_is_time_and_size_bounded() {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let mut state = ConfigTransactionState::new(
            1,
            ConfigCatalog {
                version: "test".to_string(),
                settings: Vec::new(),
            },
        );
        let expired = stored_commit("expired", now_ms - TRANSACTION_HISTORY_TTL_MILLIS - 1);
        state.commits.insert("expired".to_string(), expired.clone());
        state.idempotency.insert(
            "expired-key".to_string(),
            IdempotencyRecord {
                fingerprint: "expired".to_string(),
                commit: expired.commit,
            },
        );
        for index in 0..=MAX_TRANSACTION_HISTORY_ENTRIES {
            let commit_id = format!("retained-{index:03}");
            let stored = stored_commit(&commit_id, now_ms - index as i64);
            state.commits.insert(commit_id.clone(), stored.clone());
            state.idempotency.insert(
                format!("key-{index:03}"),
                IdempotencyRecord {
                    fingerprint: commit_id,
                    commit: stored.commit,
                },
            );
        }

        state.prune_transaction_history(now_ms);

        assert_eq!(state.commits.len(), MAX_TRANSACTION_HISTORY_ENTRIES);
        assert_eq!(state.idempotency.len(), MAX_TRANSACTION_HISTORY_ENTRIES);
        assert!(!state.commits.contains_key("expired"));
        assert!(!state.idempotency.contains_key("expired-key"));
        assert!(!state
            .commits
            .contains_key(&format!("retained-{:03}", MAX_TRANSACTION_HISTORY_ENTRIES)));
    }

    #[test]
    fn restore_discards_only_history_for_removed_settings() {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let config = serde_json::to_value(GlobalConfig::default()).expect("serialize config");
        let catalog = ConfigCatalog::build(&config, &config).expect("build current catalog");

        let mut current = stored_commit("current", now_ms);
        current.commit.revision = 6;
        current.raw_changes[0].setting_id = "core.themes.current".to_string();
        current.raw_changes[0].path = "themes.current".to_string();

        let mut stale = stored_commit("stale", now_ms);
        stale.commit.revision = 7;
        stale.raw_changes[0].setting_id = "core.themes.pointer.scale".to_string();
        stale.raw_changes[0].path = "themes.pointer.scale".to_string();

        let journal = DurableConfigTransactionJournal {
            format_version: TRANSACTION_JOURNAL_FORMAT_VERSION,
            revision: 7,
            commits: HashMap::from([
                ("current".to_string(), current.clone()),
                ("stale".to_string(), stale.clone()),
            ]),
            idempotency: HashMap::from([
                (
                    "current-key".to_string(),
                    IdempotencyRecord {
                        fingerprint: "current-fingerprint".to_string(),
                        commit: current.commit,
                    },
                ),
                (
                    "stale-key".to_string(),
                    IdempotencyRecord {
                        fingerprint: "stale-fingerprint".to_string(),
                        commit: stale.commit,
                    },
                ),
            ]),
        };

        let restored =
            ConfigTransactionState::restore(catalog, journal).expect("restore tolerant journal");

        assert_eq!(restored.revision, 7);
        assert!(restored.commits.contains_key("current"));
        assert!(!restored.commits.contains_key("stale"));
        assert!(restored.idempotency.contains_key("current-key"));
        assert!(!restored.idempotency.contains_key("stale-key"));
    }

    #[test]
    fn receipts_wait_for_live_consumers_and_defer_inactive_ones_until_restart() {
        let changes = vec![
            change("app.logging.level", ConfigApplyStrategy::Adapter),
            change(
                "product_apps.apps.builtin-bitfun-coder.debug.ingest_port",
                ConfigApplyStrategy::Adapter,
            ),
        ];

        let (status, receipts, restart_required) =
            build_apply_receipts(&changes, &live_logging_routes());

        assert_eq!(status, ConfigCommitStatus::Applying);
        assert_eq!(receipts.len(), 2);
        assert_eq!(
            receipts
                .iter()
                .find(|receipt| receipt.consumer == CONFIG_APPLY_CONSUMER_RUNTIME_LOGGING)
                .expect("logging receipt")
                .status,
            ConfigApplyReceiptStatus::Pending
        );
        assert_eq!(
            receipts
                .iter()
                .find(|receipt| receipt.consumer == CONFIG_APPLY_CONSUMER_INACTIVE_RUNTIME)
                .expect("inactive runtime receipt")
                .status,
            ConfigApplyReceiptStatus::RestartRequired
        );
        assert!(restart_required
            .iter()
            .any(|setting_id| setting_id.contains("ingest_port")));
    }

    #[test]
    fn adapter_without_a_live_owner_requires_restart_without_failing() {
        let (status, receipts, restart_required) = build_apply_receipts(
            &[change(
                "unmapped.runtime.path",
                ConfigApplyStrategy::Adapter,
            )],
            &BTreeMap::new(),
        );

        assert_eq!(status, ConfigCommitStatus::Applied);
        assert_eq!(receipts[0].consumer, CONFIG_APPLY_CONSUMER_INACTIVE_RUNTIME);
        assert_eq!(
            receipts[0].status,
            ConfigApplyReceiptStatus::RestartRequired
        );
        assert_eq!(
            restart_required,
            vec!["setting.unmapped.runtime.path".to_string()]
        );
        assert!(receipts[0]
            .message
            .as_deref()
            .is_some_and(|message| message.contains("No live runtime adapter")));
    }

    #[test]
    fn terminal_acknowledgement_aggregates_commit_status() {
        let change = change("app.logging.level", ConfigApplyStrategy::Adapter);
        let (_, receipts, _) =
            build_apply_receipts(std::slice::from_ref(&change), &live_logging_routes());
        let mut commit = ConfigCommit {
            commit_id: "commit-1".to_string(),
            revision: 2,
            status: ConfigCommitStatus::Applying,
            scope: ConfigScope::user(),
            source: ConfigChangeSource::system(),
            changes: vec![change],
            apply_receipts: receipts,
            affected_sections: Vec::new(),
            restart_required: Vec::new(),
            undo_token: None,
            committed_at: chrono::Utc::now(),
        };
        let event = ConfigApplyStatusEvent {
            commit_id: "commit-1".to_string(),
            revision: 2,
            consumer: CONFIG_APPLY_CONSUMER_RUNTIME_LOGGING.to_string(),
            receipt_attempt: 1,
            status: ConfigApplyStatus::Applied,
            paths: vec!["app.logging.level".to_string()],
            message: None,
        };

        assert!(apply_status_to_commit(&mut commit, &event).expect("apply ack"));
        assert_eq!(commit.status, ConfigCommitStatus::Applied);
        assert_eq!(
            commit.apply_receipts[0].status,
            ConfigApplyReceiptStatus::Applied
        );
        assert!(!apply_status_to_commit(&mut commit, &event).expect("duplicate ack"));
    }

    #[test]
    fn restart_required_acknowledgement_updates_receipt_and_commit_projection() {
        let change = change("app.logging.level", ConfigApplyStrategy::Adapter);
        let (_, receipts, _) =
            build_apply_receipts(std::slice::from_ref(&change), &live_logging_routes());
        let mut commit = ConfigCommit {
            commit_id: "commit-restart".to_string(),
            revision: 3,
            status: ConfigCommitStatus::Applying,
            scope: ConfigScope::user(),
            source: ConfigChangeSource::system(),
            changes: vec![change],
            apply_receipts: receipts,
            affected_sections: Vec::new(),
            restart_required: Vec::new(),
            undo_token: None,
            committed_at: chrono::Utc::now(),
        };
        let event = ConfigApplyStatusEvent {
            commit_id: "commit-restart".to_string(),
            revision: 3,
            consumer: CONFIG_APPLY_CONSUMER_RUNTIME_LOGGING.to_string(),
            receipt_attempt: 1,
            status: ConfigApplyStatus::RestartRequired,
            paths: vec!["app.logging.level".to_string()],
            message: Some("Restart required".to_string()),
        };

        assert!(apply_status_to_commit(&mut commit, &event).expect("restart ack"));
        assert_eq!(commit.status, ConfigCommitStatus::Applied);
        assert_eq!(
            commit.apply_receipts[0].status,
            ConfigApplyReceiptStatus::RestartRequired
        );
        assert_eq!(commit.restart_required, vec!["setting.app.logging.level"]);
    }

    #[test]
    fn published_commit_hides_change_and_receipt_storage_paths() {
        let commit = ConfigCommit {
            commit_id: "commit-public".to_string(),
            revision: 2,
            status: ConfigCommitStatus::Applied,
            scope: ConfigScope::user(),
            source: ConfigChangeSource::system(),
            changes: vec![ConfigValueChange {
                setting_id: "core.logging.verbosity".to_string(),
                path: "app.logging.level".to_string(),
                old_value: ConfigStoredValue::public(Value::String("info".to_string())),
                new_value: ConfigStoredValue::public(Value::String("debug".to_string())),
                apply_strategy: ConfigApplyStrategy::Reactive,
            }],
            apply_receipts: vec![ConfigApplyReceipt {
                consumer: CONFIG_APPLY_CONSUMER_RUNTIME_LOGGING.to_string(),
                setting_ids: vec!["core.logging.verbosity".to_string()],
                paths: vec!["app.logging.level".to_string()],
                attempt: 1,
                attempted_at: chrono::Utc::now(),
                status: ConfigApplyReceiptStatus::Applied,
                critical: false,
                message: Some("Failed to apply app.logging.level".to_string()),
            }],
            affected_sections: Vec::new(),
            restart_required: Vec::new(),
            undo_token: None,
            committed_at: chrono::Utc::now(),
        };

        let published = serde_json::to_value(commit.published()).expect("published commit");
        assert!(published["changes"][0].get("path").is_none());
        assert!(published["applyReceipts"][0].get("paths").is_none());
        assert!(published["applyReceipts"][0].get("message").is_none());
        assert!(!published.to_string().contains("app.logging.level"));
    }
}
