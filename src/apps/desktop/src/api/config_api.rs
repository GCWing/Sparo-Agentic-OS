//! Configuration API

use crate::api::command_error::{public_config_error, PublicCommandError};
use crate::bootstrap::AppContainer;
use log::error;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sparo_core::service::config::{
    CommitConfigPlanRequest, ConfigPatch, ConfigPatchOperation, ConfigPlan, ConfigService,
    ConfigSnapshot, ConfigStartupStatus, PublishedConfigCatalog, PublishedConfigCommit,
    RetryConfigApplyRequest, UndoConfigCommitRequest,
};
use sparo_events::{ConfigChangeSource, ConfigChangeSourceKind, ConfigScope, ConfigScopeKind};
use std::sync::Arc;
use tauri::State;

fn config_command_error(
    operation: &'static str,
    error: &impl std::fmt::Display,
) -> PublicCommandError {
    let public_error = public_config_error(error);
    error!(
        "Config command failed: operation={}, error_code={}",
        operation,
        public_error.code()
    );
    public_error
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DescribeConfigCatalogRequest {
    pub scope: ConfigScope,
    #[serde(default)]
    pub query: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GetConfigSnapshotRequest {
    pub scope: ConfigScope,
}

#[derive(Debug, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct GetConfigStartupStatusRequest {}

#[derive(Debug, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct RebuildDefaultConfigRequest {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GetConfigCommitRequest {
    pub commit_id: String,
}

/// WebView-owned configuration changes are always manual changes. The desktop
/// adapter owns the audit source so an untrusted caller cannot claim a system,
/// CLI, import, or AI identity.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanConfigPatchRequest {
    pub request_id: String,
    pub idempotency_key: String,
    pub expected_revision: u64,
    pub scope: ConfigScope,
    pub operations: Vec<ConfigPatchOperation>,
}

impl PlanConfigPatchRequest {
    fn into_manual_patch(self) -> ConfigPatch {
        let source_request_id = self.request_id.clone();
        ConfigPatch {
            request_id: self.request_id,
            idempotency_key: self.idempotency_key,
            expected_revision: self.expected_revision,
            source: desktop_manual_source(Some(source_request_id)),
            scope: self.scope,
            operations: self.operations,
        }
    }
}

fn desktop_manual_source(request_id: Option<String>) -> ConfigChangeSource {
    ConfigChangeSource {
        kind: ConfigChangeSourceKind::Manual,
        surface: Some("desktop-web-ui".to_string()),
        request_id,
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct GetRuntimeLoggingInfoRequest {}

fn to_json_value<T: Serialize>(value: T, context: &str) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| format!("Failed to serialize {}: {}", context, e))
}

fn require_user_scope(scope: &ConfigScope) -> Result<(), PublicCommandError> {
    if scope.kind == ConfigScopeKind::User
        && scope.workspace_id.is_none()
        && scope.session_id.is_none()
    {
        Ok(())
    } else {
        Err(PublicCommandError::new("config.scope_unsupported"))
    }
}

fn require_config_service(
    container: &State<'_, Arc<AppContainer>>,
) -> Result<Arc<ConfigService>, PublicCommandError> {
    container
        .config_service()
        .ok_or_else(|| PublicCommandError::new("config.service_unavailable"))
}

#[tauri::command]
pub async fn describe_config_catalog(
    container: State<'_, Arc<AppContainer>>,
    request: DescribeConfigCatalogRequest,
) -> Result<PublishedConfigCatalog, PublicCommandError> {
    require_user_scope(&request.scope)?;
    require_config_service(&container)?
        .describe_published_catalog(request.query.as_deref())
        .await
        .map_err(|error| config_command_error("describe_catalog", &error))
}

#[tauri::command]
pub async fn get_config_snapshot(
    container: State<'_, Arc<AppContainer>>,
    request: GetConfigSnapshotRequest,
) -> Result<ConfigSnapshot, PublicCommandError> {
    require_user_scope(&request.scope)?;
    require_config_service(&container)?
        .get_snapshot()
        .await
        .map_err(|error| config_command_error("get_snapshot", &error))
}

#[tauri::command]
pub async fn get_config_startup_status(
    container: State<'_, Arc<AppContainer>>,
    request: GetConfigStartupStatusRequest,
) -> Result<ConfigStartupStatus, PublicCommandError> {
    let _ = request;
    Ok(require_config_service(&container)?
        .get_startup_status()
        .await)
}

#[tauri::command]
pub async fn rebuild_default_config(
    container: State<'_, Arc<AppContainer>>,
    request: RebuildDefaultConfigRequest,
) -> Result<ConfigStartupStatus, PublicCommandError> {
    let _ = request;
    let service = require_config_service(&container)?;
    let status = service
        .rebuild_default_config()
        .await
        .map_err(|error| config_command_error("rebuild_defaults", &error))?;
    sparo_core::service::config::GlobalConfigManager::activate_external_watcher_after_rebuild(
        service,
    );
    Ok(status)
}

#[tauri::command]
pub async fn plan_config_patch(
    container: State<'_, Arc<AppContainer>>,
    request: PlanConfigPatchRequest,
) -> Result<ConfigPlan, PublicCommandError> {
    require_user_scope(&request.scope)?;
    let patch = request.into_manual_patch();
    require_config_service(&container)?
        .plan_product_surface_patch(patch)
        .await
        .map_err(|error| config_command_error("plan_patch", &error))
}

#[tauri::command]
pub async fn commit_config_patch(
    container: State<'_, Arc<AppContainer>>,
    request: CommitConfigPlanRequest,
) -> Result<PublishedConfigCommit, PublicCommandError> {
    require_config_service(&container)?
        .commit_plan(request)
        .await
        .map(|commit| commit.published())
        .map_err(|error| config_command_error("commit_patch", &error))
}

#[tauri::command]
pub async fn undo_config_commit(
    container: State<'_, Arc<AppContainer>>,
    request: UndoConfigCommitRequest,
) -> Result<PublishedConfigCommit, PublicCommandError> {
    let source = desktop_manual_source(None);
    require_config_service(&container)?
        .undo_commit(request, source)
        .await
        .map(|commit| commit.published())
        .map_err(|error| config_command_error("undo_commit", &error))
}

#[tauri::command]
pub async fn get_config_commit(
    container: State<'_, Arc<AppContainer>>,
    request: GetConfigCommitRequest,
) -> Result<PublishedConfigCommit, PublicCommandError> {
    require_config_service(&container)?
        .get_commit(&request.commit_id)
        .await
        .map(|commit| commit.published())
        .map_err(|error| config_command_error("get_commit", &error))
}

#[tauri::command]
pub async fn retry_config_apply(
    container: State<'_, Arc<AppContainer>>,
    request: RetryConfigApplyRequest,
) -> Result<PublishedConfigCommit, PublicCommandError> {
    require_config_service(&container)?
        .retry_apply(request)
        .await
        .map(|commit| commit.published())
        .map_err(|error| config_command_error("retry_apply", &error))
}

#[tauri::command]
pub async fn get_runtime_logging_info(
    _request: GetRuntimeLoggingInfoRequest,
) -> Result<Value, String> {
    let logging_info = crate::logging::get_runtime_logging_info();
    to_json_value(logging_info, "runtime logging info")
}

#[cfg(test)]
mod tests {
    use super::{
        public_config_error, DescribeConfigCatalogRequest, GetConfigStartupStatusRequest,
        PlanConfigPatchRequest, UndoConfigCommitRequest,
    };
    use serde_json::json;
    use sparo_core::service::config::{ConfigStartupFailurePhase, ConfigStartupStatus};
    use sparo_events::ConfigChangeSourceKind;

    fn valid_request_json() -> serde_json::Value {
        json!({
            "requestId": "request-1",
            "idempotencyKey": "change-1",
            "expectedRevision": 7,
            "scope": { "kind": "user" },
            "operations": [{
                "op": "set",
                "settingId": "app.language",
                "value": "zh-CN"
            }]
        })
    }

    #[test]
    fn desktop_plan_request_constructs_a_manual_source() {
        let request: PlanConfigPatchRequest =
            serde_json::from_value(valid_request_json()).expect("valid desktop request");

        let patch = request.into_manual_patch();

        assert_eq!(patch.source.kind, ConfigChangeSourceKind::Manual);
        assert_eq!(patch.source.surface.as_deref(), Some("desktop-web-ui"));
        assert_eq!(patch.source.request_id.as_deref(), Some("request-1"));
    }

    #[test]
    fn desktop_plan_request_rejects_a_client_supplied_source() {
        let mut value = valid_request_json();
        value["source"] = json!({ "kind": "system", "surface": "forged" });

        let error = serde_json::from_value::<PlanConfigPatchRequest>(value)
            .expect_err("source must be owned by the desktop adapter");

        assert!(error.to_string().contains("unknown field `source`"));
    }

    #[test]
    fn desktop_plan_request_rejects_a_client_supplied_surface() {
        let mut value = valid_request_json();
        value["surface"] = json!("settings-ai-mode");
        let error = serde_json::from_value::<PlanConfigPatchRequest>(value)
            .expect_err("surface must be owned by the desktop adapter");

        assert!(error.to_string().contains("unknown field `surface`"));
    }

    #[test]
    fn desktop_undo_request_rejects_a_client_supplied_source() {
        let error = serde_json::from_value::<UndoConfigCommitRequest>(json!({
            "commitId": "commit-1",
            "undoToken": "undo-1",
            "expectedRevision": 8,
            "idempotencyKey": "undo-request-1",
            "confirmed": false,
            "source": { "kind": "ai", "surface": "forged" }
        }))
        .expect_err("undo source must be owned by the desktop adapter");

        assert!(error.to_string().contains("unknown field `source`"));
    }

    #[test]
    fn desktop_catalog_request_rejects_client_truth_filtering() {
        let error = serde_json::from_value::<DescribeConfigCatalogRequest>(json!({
            "scope": { "kind": "user" },
            "includeHidden": false
        }))
        .expect_err("the published Catalog truth set is not client-filterable");

        assert!(error.to_string().contains("unknown field `includeHidden`"));
    }

    #[test]
    fn config_command_error_exposes_only_a_stable_code() {
        let error = public_config_error(
            &"validation failed: config.revision_conflict at C:\\private\\app.json",
        );
        let published = serde_json::to_value(error).expect("serializable command error");

        assert_eq!(published, json!({ "code": "config.revision_conflict" }));
        assert!(!published.to_string().contains("private"));
    }

    #[test]
    fn unknown_config_failures_collapse_to_the_generic_code() {
        let error = public_config_error(&"failed to read C:\\private\\app.json");
        let published = serde_json::to_value(error).expect("serializable command error");

        assert_eq!(published, json!({ "code": "config.operation_failed" }));
    }

    #[test]
    fn config_startup_status_request_rejects_unknown_fields() {
        #[derive(Debug, serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct CommandEnvelope {
            request: GetConfigStartupStatusRequest,
        }

        serde_json::from_value::<GetConfigStartupStatusRequest>(json!({}))
            .expect("empty request is valid");
        let envelope = serde_json::from_value::<CommandEnvelope>(json!({ "request": {} }))
            .expect("command uses the structured request argument");
        let _ = envelope.request;
        serde_json::from_value::<CommandEnvelope>(json!({ "_request": {} }))
            .expect_err("underscored command arguments are not part of the IPC contract");
        let error = serde_json::from_value::<GetConfigStartupStatusRequest>(json!({
            "includeRawError": true
        }))
        .expect_err("startup status request is not client-extensible");

        assert!(error
            .to_string()
            .contains("unknown field `includeRawError`"));
    }

    #[test]
    fn config_startup_status_is_redacted_and_stable() {
        let published = serde_json::to_value(ConfigStartupStatus::read_only_defaults(
            ConfigStartupFailurePhase::Validation,
        ))
        .expect("serializable startup status");

        assert_eq!(
            published,
            json!({
                "mode": "readOnlyDefaults",
                "schemaVersion": "1",
                "writesAllowed": false,
                "sourcePreserved": true,
                "rebuildAllowed": true,
                "issue": {
                    "code": "config.startup.validation_failed",
                    "phase": "validation"
                }
            })
        );
        assert!(!published.to_string().contains("app.json"));
        assert!(!published.to_string().contains("force_extract"));
    }
}
