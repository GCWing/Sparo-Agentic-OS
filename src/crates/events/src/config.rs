//! Serializable configuration-domain events shared by product surfaces.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Collapses internal configuration failures into stable codes that may cross a
/// product-surface boundary. Callers must not copy the original error into public payloads
/// or ordinary logs.
pub fn published_config_error_code(error: &str) -> &'static str {
    if error.contains("config.manual_draft_conflict") {
        "config.manual_draft_conflict"
    } else if error.contains("config.revision_conflict")
        || error.contains("config.stale_plan")
        || error.contains("config.apply_retry_revision_mismatch")
    {
        "config.revision_conflict"
    } else if error.contains("config.catalog_changed") {
        "config.catalog_changed"
    } else if error.contains("config.plan_expired") {
        "config.plan_expired"
    } else if error.contains("config.confirmation_required") {
        "config.confirmation_required"
    } else if error.contains("config.idempotency_conflict") {
        "config.idempotency_conflict"
    } else if error.contains("config.undo_conflict") {
        "config.undo_conflict"
    } else if error.contains("config.undo_token_invalid") {
        "config.undo_token_invalid"
    } else if error.contains("config.commit_unknown") {
        "config.commit_unknown"
    } else if error.contains("config.apply_retry_") {
        "config.apply_retry_failed"
    } else if error.contains("config.scope_unsupported") {
        "config.scope_unsupported"
    } else if error.contains("config.setting_unavailable") {
        "config.setting_unavailable"
    } else if error.contains("config.setting_managed") {
        "config.setting_managed"
    } else if error.contains("config.recovery_read_only") {
        "config.recovery_read_only"
    } else {
        "config.operation_failed"
    }
}

/// Publish only stable, non-sensitive failure codes from the SettingsAgent
/// boundary. Configuration failures reuse the shared config taxonomy while
/// agent-runtime readiness remains an explicit AI-domain error.
pub fn published_settings_agent_error_code(error: &str) -> &'static str {
    if error.contains("settings.secure_input_required") {
        "settings.secure_input_required"
    } else if error.contains("settings.request_invalid") {
        "settings.request_invalid"
    } else if error.contains("ai.model_not_configured") {
        "ai.model_not_configured"
    } else {
        published_config_error_code(error)
    }
}

/// Origin of a configuration change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConfigChangeSourceKind {
    Manual,
    Ai,
    Cli,
    Import,
    System,
}

/// Auditable origin metadata for a configuration change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigChangeSource {
    pub kind: ConfigChangeSourceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

impl ConfigChangeSource {
    pub fn manual() -> Self {
        Self {
            kind: ConfigChangeSourceKind::Manual,
            surface: None,
            request_id: None,
        }
    }

    pub fn system() -> Self {
        Self {
            kind: ConfigChangeSourceKind::System,
            surface: None,
            request_id: None,
        }
    }
}

/// Supported configuration scope kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConfigScopeKind {
    User,
    Workspace,
    Session,
}

/// Configuration scope attached to every committed event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigScope {
    pub kind: ConfigScopeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

impl ConfigScope {
    pub fn user() -> Self {
        Self {
            kind: ConfigScopeKind::User,
            workspace_id: None,
            session_id: None,
        }
    }
}

/// Runtime application strategy declared by the trusted catalog.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConfigApplyStrategy {
    Reactive,
    Adapter,
    RestartRequired,
    ManualOnly,
}

/// A value safe to expose in events, logs, agents, and frontend stores.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConfigStoredValue {
    Value {
        value: Value,
    },
    Secret {
        configured: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provider: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        masked_suffix: Option<String>,
    },
}

impl ConfigStoredValue {
    pub fn public(value: Value) -> Self {
        Self::Value { value }
    }

    pub fn secret(configured: bool) -> Self {
        Self::Secret {
            configured,
            provider: None,
            masked_suffix: None,
        }
    }
}

/// Stable settings-section coordinate affected by a commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSectionRef {
    pub category_id: String,
    pub tab_id: String,
    pub section_id: String,
    #[serde(default)]
    pub field_ids: Vec<String>,
}

/// One authoritative value change in a configuration commit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigValueChange {
    pub setting_id: String,
    pub path: String,
    pub old_value: ConfigStoredValue,
    pub new_value: ConfigStoredValue,
    pub apply_strategy: ConfigApplyStrategy,
}

/// Storage-free value change safe for product-surface clients.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishedConfigValueChange {
    pub setting_id: String,
    pub old_value: ConfigStoredValue,
    pub new_value: ConfigStoredValue,
    pub apply_strategy: ConfigApplyStrategy,
}

impl ConfigValueChange {
    pub fn published(&self) -> PublishedConfigValueChange {
        PublishedConfigValueChange {
            setting_id: self.setting_id.clone(),
            old_value: self.old_value.clone(),
            new_value: self.new_value.clone(),
            apply_strategy: self.apply_strategy,
        }
    }
}

/// Authoritative event emitted once an atomic configuration commit succeeds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigCommittedEvent {
    pub commit_id: String,
    pub revision: u64,
    pub catalog_version: String,
    pub scope: ConfigScope,
    pub source: ConfigChangeSource,
    pub changes: Vec<ConfigValueChange>,
    pub affected_sections: Vec<SettingsSectionRef>,
    pub committed_at: DateTime<Utc>,
}

/// Storage-free commit event safe for Desktop/Web UI publication.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishedConfigCommittedEvent {
    pub commit_id: String,
    pub revision: u64,
    pub catalog_version: String,
    pub scope: ConfigScope,
    pub source: ConfigChangeSource,
    pub changes: Vec<PublishedConfigValueChange>,
    pub affected_sections: Vec<SettingsSectionRef>,
    pub committed_at: DateTime<Utc>,
}

impl ConfigCommittedEvent {
    pub fn published(&self) -> PublishedConfigCommittedEvent {
        PublishedConfigCommittedEvent {
            commit_id: self.commit_id.clone(),
            revision: self.revision,
            catalog_version: self.catalog_version.clone(),
            scope: self.scope.clone(),
            source: self.source.clone(),
            changes: self
                .changes
                .iter()
                .map(ConfigValueChange::published)
                .collect(),
            affected_sections: self.affected_sections.clone(),
            committed_at: self.committed_at,
        }
    }
}

impl ConfigCommittedEvent {
    /// Returns whether this commit changed the exact storage path.
    pub fn changes_path(&self, path: &str) -> bool {
        self.changes.iter().any(|change| change.path == path)
    }

    /// Returns whether this commit changed a path at or below the given storage prefix.
    pub fn changes_under(&self, prefix: &str) -> bool {
        self.changes.iter().any(|change| {
            change.path == prefix
                || change
                    .path
                    .strip_prefix(prefix)
                    .is_some_and(|suffix| suffix.starts_with('.'))
        })
    }
}

/// Event emitted when a compensating commit rolls back an earlier commit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigRolledBackEvent {
    pub original_commit_id: String,
    pub rollback_commit: ConfigCommittedEvent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishedConfigRolledBackEvent {
    pub original_commit_id: String,
    pub rollback_commit: PublishedConfigCommittedEvent,
}

impl ConfigRolledBackEvent {
    pub fn published(&self) -> PublishedConfigRolledBackEvent {
        PublishedConfigRolledBackEvent {
            original_commit_id: self.original_commit_id.clone(),
            rollback_commit: self.rollback_commit.published(),
        }
    }
}

/// Runtime application receipt status for one committed configuration change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConfigApplyStatus {
    Applied,
    RestartRequired,
    Superseded,
    Partial,
    Failed,
    RolledBack,
}

/// Serializable application status update produced after a commit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigApplyStatusEvent {
    pub commit_id: String,
    pub revision: u64,
    pub consumer: String,
    pub receipt_attempt: u32,
    pub status: ConfigApplyStatus,
    pub paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Storage-free runtime apply status safe for product-surface clients.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishedConfigApplyStatusEvent {
    pub commit_id: String,
    pub revision: u64,
    pub consumer: String,
    pub receipt_attempt: u32,
    pub status: ConfigApplyStatus,
}

impl ConfigApplyStatusEvent {
    pub fn published(&self) -> PublishedConfigApplyStatusEvent {
        PublishedConfigApplyStatusEvent {
            commit_id: self.commit_id.clone(),
            revision: self.revision,
            consumer: self.consumer.clone(),
            receipt_attempt: self.receipt_attempt,
            status: self.status,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_error_codes_never_publish_internal_failure_details() {
        let internal = "config.revision_conflict at C:\\private\\app.json: token=secret";
        assert_eq!(
            published_config_error_code(internal),
            "config.revision_conflict"
        );
        assert_eq!(
            published_config_error_code("failed to read C:\\private\\app.json"),
            "config.operation_failed"
        );
        assert_eq!(
            published_config_error_code("config.setting_managed: core.ai.agent_capability_configs"),
            "config.setting_managed"
        );
        assert_eq!(
            published_config_error_code("Configuration error: config.recovery_read_only"),
            "config.recovery_read_only"
        );
        assert_eq!(
            published_settings_agent_error_code(
                "ai.model_not_configured: configure an enabled primary AI model"
            ),
            "ai.model_not_configured"
        );
        assert_eq!(
            published_settings_agent_error_code(
                "config.revision_conflict at C:\\private\\app.json: token=secret"
            ),
            "config.revision_conflict"
        );
        assert_eq!(
            published_settings_agent_error_code(
                "settings.secure_input_required: token at C:\\private\\app.json"
            ),
            "settings.secure_input_required"
        );
        assert_eq!(
            published_settings_agent_error_code(
                "SettingsAgent execution failed at C:\\private\\app.json: token=secret"
            ),
            "config.operation_failed"
        );
    }

    #[test]
    fn committed_event_matches_exact_and_subtree_paths() {
        let event = ConfigCommittedEvent {
            commit_id: "commit".to_string(),
            revision: 2,
            catalog_version: "catalog-v2".to_string(),
            scope: ConfigScope::user(),
            source: ConfigChangeSource::system(),
            changes: vec![ConfigValueChange {
                setting_id: "core.app.host_scan.auto_scan_enabled".to_string(),
                path: "app.host_scan.auto_scan_enabled".to_string(),
                old_value: ConfigStoredValue::public(Value::Bool(false)),
                new_value: ConfigStoredValue::public(Value::Bool(true)),
                apply_strategy: ConfigApplyStrategy::Adapter,
            }],
            affected_sections: Vec::new(),
            committed_at: Utc::now(),
        };

        assert!(event.changes_path("app.host_scan.auto_scan_enabled"));
        assert!(event.changes_under("app.host_scan"));
        assert!(!event.changes_under("app.host"));
        assert!(!event.changes_path("app.host_scan"));
    }

    #[test]
    fn published_events_never_expose_storage_paths() {
        let committed = ConfigCommittedEvent {
            commit_id: "commit".to_string(),
            revision: 2,
            catalog_version: "catalog-v2".to_string(),
            scope: ConfigScope::user(),
            source: ConfigChangeSource::system(),
            changes: vec![ConfigValueChange {
                setting_id: "core.logging.verbosity".to_string(),
                path: "app.logging.level".to_string(),
                old_value: ConfigStoredValue::public(Value::String("info".to_string())),
                new_value: ConfigStoredValue::public(Value::String("debug".to_string())),
                apply_strategy: ConfigApplyStrategy::Reactive,
            }],
            affected_sections: Vec::new(),
            committed_at: Utc::now(),
        };
        let committed_json = serde_json::to_value(committed.published()).unwrap();
        assert_eq!(
            committed_json["changes"][0]["settingId"],
            "core.logging.verbosity"
        );
        assert!(committed_json["changes"][0].get("path").is_none());
        assert!(!committed_json.to_string().contains("app.logging.level"));

        let apply_status = ConfigApplyStatusEvent {
            commit_id: "commit".to_string(),
            revision: 2,
            consumer: "runtime-logging".to_string(),
            receipt_attempt: 1,
            status: ConfigApplyStatus::Applied,
            paths: vec!["app.logging.level".to_string()],
            message: Some("Failed to apply app.logging.level".to_string()),
        };
        let status_json = serde_json::to_value(apply_status.published()).unwrap();
        assert!(status_json.get("paths").is_none());
        assert!(status_json.get("message").is_none());
        assert!(!status_json.to_string().contains("app.logging.level"));
    }
}
