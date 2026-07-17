use async_trait::async_trait;
use dashmap::DashMap;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::agentic::agents::SettingsAgent;
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext, ValidationResult};
use crate::error::{CoreError, CoreResult};
use crate::service::config::{
    config_plan_for_confirmation, config_plan_requires_confirmation, config_undo_for_confirmation,
    config_undo_requires_confirmation, get_global_config_service, CommitConfigPlanRequest,
    ConfigPatch, ConfigPatchOperation, UndoConfigCommitRequest,
};
use sparo_events::{ConfigChangeSource, ConfigChangeSourceKind, ConfigScope};

const CONFIRMATION_GRANTED_KEY: &str = "tool_confirmation_granted";
const SETTINGS_SURFACE: &str = "settings-ai-mode";
const DIRTY_CONSTRAINT_TTL: Duration = Duration::from_secs(60 * 60);
const MAX_ACTIVE_DIRTY_CONSTRAINTS: usize = 1_024;

#[derive(Clone)]
struct DirtySettingsConstraint {
    setting_ids: BTreeSet<String>,
    expires_at: Instant,
}

struct DirtySettingsConstraintStore {
    entries: DashMap<String, DirtySettingsConstraint>,
    registration_lock: Mutex<()>,
    max_entries: usize,
}

impl DirtySettingsConstraintStore {
    fn new(max_entries: usize) -> Self {
        Self {
            entries: DashMap::new(),
            registration_lock: Mutex::new(()),
            max_entries,
        }
    }

    fn register(
        self: &Arc<Self>,
        key: &str,
        setting_ids: BTreeSet<String>,
        ttl: Duration,
    ) -> CoreResult<()> {
        if setting_ids.is_empty() {
            self.clear(key);
            return Ok(());
        }

        let expires_at = Instant::now() + ttl;
        {
            let _registration_guard = self
                .registration_lock
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            self.prune_expired_locked(Instant::now());
            if !self.entries.contains_key(key) && self.entries.len() >= self.max_entries {
                return Err(CoreError::validation(
                    "SettingsAgent has too many active dirty-setting constraints",
                ));
            }
            self.entries.insert(
                key.to_string(),
                DirtySettingsConstraint {
                    setting_ids,
                    expires_at,
                },
            );
        }

        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            let store = Arc::downgrade(self);
            let key = key.to_string();
            runtime.spawn(async move {
                tokio::time::sleep(ttl).await;
                if let Some(store) = store.upgrade() {
                    store.remove_if_expired(&key, Instant::now());
                }
            });
        }

        Ok(())
    }

    fn conflicts(&self, key: &str, operations: &[ConfigPatchOperation]) -> Vec<String> {
        let _registration_guard = self
            .registration_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(constraint) = self.entries.get(key) else {
            return Vec::new();
        };
        if constraint.expires_at <= Instant::now() {
            drop(constraint);
            self.entries.remove(key);
            return Vec::new();
        }

        operations
            .iter()
            .filter_map(|operation| match operation {
                ConfigPatchOperation::Set { setting_id, .. }
                | ConfigPatchOperation::Reset { setting_id } => constraint
                    .setting_ids
                    .contains(setting_id)
                    .then(|| setting_id.clone()),
            })
            .collect()
    }

    fn clear(&self, key: &str) {
        let _registration_guard = self
            .registration_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.entries.remove(key);
    }

    fn remove_if_expired(&self, key: &str, now: Instant) {
        let _registration_guard = self
            .registration_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let expired = self
            .entries
            .get(key)
            .is_some_and(|constraint| constraint.expires_at <= now);
        if expired {
            self.entries.remove(key);
        }
    }

    fn prune_expired_locked(&self, now: Instant) {
        let expired_turn_ids = self
            .entries
            .iter()
            .filter(|entry| entry.expires_at <= now)
            .map(|entry| entry.key().clone())
            .collect::<Vec<_>>();
        for turn_id in expired_turn_ids {
            self.entries.remove(&turn_id);
        }
    }

    #[cfg(test)]
    fn contains(&self, key: &str) -> bool {
        let _registration_guard = self
            .registration_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.entries.contains_key(key)
    }
}

static DIRTY_SETTINGS_BY_TURN: OnceLock<Arc<DirtySettingsConstraintStore>> = OnceLock::new();

fn dirty_settings_by_turn() -> &'static Arc<DirtySettingsConstraintStore> {
    DIRTY_SETTINGS_BY_TURN.get_or_init(|| {
        Arc::new(DirtySettingsConstraintStore::new(
            MAX_ACTIVE_DIRTY_CONSTRAINTS,
        ))
    })
}

pub(crate) fn register_dirty_settings_constraint(
    session_id: &str,
    turn_id: &str,
    setting_ids: impl IntoIterator<Item = String>,
) -> CoreResult<()> {
    let setting_ids = setting_ids
        .into_iter()
        .map(|setting_id| setting_id.trim().to_string())
        .filter(|setting_id| !setting_id.is_empty())
        .collect::<BTreeSet<_>>();
    dirty_settings_by_turn().register(
        &dirty_constraint_key(session_id, turn_id),
        setting_ids,
        DIRTY_CONSTRAINT_TTL,
    )
}

pub(crate) fn clear_dirty_settings_constraint(session_id: &str, turn_id: &str) {
    dirty_settings_by_turn().clear(&dirty_constraint_key(session_id, turn_id));
}

pub(crate) struct DirtySettingsConstraintGuard {
    store: Arc<DirtySettingsConstraintStore>,
    turn_id: String,
}

impl DirtySettingsConstraintGuard {
    fn new(store: Arc<DirtySettingsConstraintStore>, turn_id: impl Into<String>) -> Self {
        Self {
            store,
            turn_id: turn_id.into(),
        }
    }
}

impl Drop for DirtySettingsConstraintGuard {
    fn drop(&mut self) {
        self.store.clear(&self.turn_id);
    }
}

pub(crate) fn dirty_settings_constraint_guard(
    session_id: &str,
    turn_id: &str,
) -> DirtySettingsConstraintGuard {
    DirtySettingsConstraintGuard::new(
        dirty_settings_by_turn().clone(),
        dirty_constraint_key(session_id, turn_id),
    )
}

fn dirty_constraint_key(session_id: &str, turn_id: &str) -> String {
    format!("{session_id}\0{turn_id}")
}

fn dirty_setting_conflicts(
    session_id: &str,
    turn_id: &str,
    operations: &[ConfigPatchOperation],
) -> Vec<String> {
    dirty_settings_by_turn().conflicts(&dirty_constraint_key(session_id, turn_id), operations)
}

fn descriptor_for_settings_agent(
    descriptor: &crate::service::config::PublishedSettingDescriptor,
) -> CoreResult<Value> {
    serde_json::to_value(descriptor).map_err(|error| {
        CoreError::config(format!("Failed to publish Catalog descriptor: {error}"))
    })
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum SettingsCatalogInput {
    Query {
        query: String,
        #[serde(default = "default_catalog_query_limit")]
        limit: usize,
    },
    Get {
        setting_id: String,
    },
}

const MAX_CATALOG_QUERY_RESULTS: usize = 20;

fn default_catalog_query_limit() -> usize {
    8
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum SettingsChangeInput {
    Plan {
        expected_revision: u64,
        operations: Vec<ConfigPatchOperation>,
    },
    Apply {
        plan_id: String,
        expected_revision: u64,
    },
    Undo {
        commit_id: String,
        undo_token: String,
        expected_revision: u64,
    },
}

pub struct SettingsCatalogTool;

impl SettingsCatalogTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SettingsCatalogTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for SettingsCatalogTool {
    fn name(&self) -> &str {
        SettingsAgent::CATALOG_TOOL
    }

    async fn description(&self) -> CoreResult<String> {
        Ok("Search a bounded subset of the trusted settings catalog, or read one setting contract with its current redacted value. Use only stable setting IDs returned by this tool; never infer storage paths or secret values.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "oneOf": [
                {
                    "properties": {
                        "action": { "const": "query" },
                        "query": {
                            "type": "string",
                            "minLength": 1,
                            "description": "Natural-language or stable-ID search text."
                        },
                        "limit": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": MAX_CATALOG_QUERY_RESULTS,
                            "default": default_catalog_query_limit()
                        }
                    },
                    "required": ["action", "query"],
                    "additionalProperties": false
                },
                {
                    "properties": {
                        "action": { "const": "get" },
                        "settingId": {
                            "type": "string",
                            "minLength": 1,
                            "description": "Exact stable setting ID returned by query."
                        }
                    },
                    "required": ["action", "settingId"],
                    "additionalProperties": false
                }
            ]
        })
    }

    fn is_readonly(&self) -> bool {
        true
    }

    async fn validate_input(
        &self,
        input: &Value,
        context: Option<&ToolUseContext>,
    ) -> ValidationResult {
        if !is_settings_agent(context) {
            return validation_error("SettingsCatalog is restricted to SettingsAgent");
        }
        match serde_json::from_value::<SettingsCatalogInput>(input.clone()) {
            Ok(SettingsCatalogInput::Query { query, limit })
                if query.trim().is_empty() || limit == 0 || limit > MAX_CATALOG_QUERY_RESULTS =>
            {
                validation_error("SettingsCatalog query and limit are outside the allowed bounds")
            }
            Ok(SettingsCatalogInput::Get { setting_id }) if setting_id.trim().is_empty() => {
                validation_error("SettingsCatalog get requires a setting ID")
            }
            Ok(_) => ValidationResult::default(),
            Err(error) => validation_error(format!("Invalid SettingsCatalog input: {error}")),
        }
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> CoreResult<Vec<ToolResult>> {
        enforce_settings_agent(context, self.name())?;
        let input: SettingsCatalogInput = parse_input(input, self.name())?;
        let service = get_global_config_service().await?;
        let output = match input {
            SettingsCatalogInput::Query { query, limit } => {
                let query = query.trim();
                if query.is_empty() || limit == 0 || limit > MAX_CATALOG_QUERY_RESULTS {
                    return Err(CoreError::validation(
                        "SettingsCatalog query and limit are outside the allowed bounds",
                    ));
                }
                let (mut catalog, snapshot) = service
                    .describe_published_catalog_with_snapshot(Some(query))
                    .await?;
                catalog.settings.retain(|setting| setting.ai.readable);
                catalog.settings.truncate(limit);
                let mut settings = Vec::with_capacity(catalog.settings.len());
                for descriptor in catalog.settings {
                    let current = snapshot
                        .values
                        .get(&descriptor.id)
                        .cloned()
                        .ok_or_else(|| {
                            CoreError::config(format!(
                                "Authoritative config snapshot is missing setting '{}' at revision {}",
                                descriptor.id, snapshot.revision
                            ))
                        })?;
                    settings.push(json!({
                        "descriptor": descriptor_for_settings_agent(&descriptor)?,
                        "current": current,
                    }));
                }
                json!({
                    "revision": snapshot.revision,
                    "catalogVersion": snapshot.catalog_version,
                    "settings": settings,
                })
            }
            SettingsCatalogInput::Get { setting_id } => {
                let setting_id = setting_id.trim();
                if setting_id.is_empty() {
                    return Err(CoreError::validation(
                        "SettingsCatalog get requires a setting ID",
                    ));
                }
                let (catalog, snapshot) = service
                    .describe_published_catalog_with_snapshot(None)
                    .await?;
                let descriptor = catalog
                    .find(setting_id)
                    .filter(|setting| setting.ai.readable)
                    .ok_or_else(|| CoreError::validation("config.setting_unknown_or_unreadable"))?;
                let current = snapshot.values.get(setting_id).cloned().ok_or_else(|| {
                    CoreError::config(format!(
                        "Authoritative config snapshot is missing setting '{}' at revision {}",
                        descriptor.id, snapshot.revision
                    ))
                })?;
                json!({
                    "revision": snapshot.revision,
                    "catalogVersion": snapshot.catalog_version,
                    "descriptor": descriptor_for_settings_agent(&descriptor)?,
                    "current": current,
                })
            }
        };
        Ok(vec![ToolResult::ok(output, None)])
    }
}

pub struct SettingsChangeTool;

impl SettingsChangeTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SettingsChangeTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for SettingsChangeTool {
    fn name(&self) -> &str {
        SettingsAgent::CHANGE_TOOL
    }

    async fn description(&self) -> CoreResult<String> {
        Ok("Plan, atomically apply, or undo a catalog-backed settings transaction. Always plan before apply. Safe plans apply directly; elevated plans pause in the runtime confirmation lifecycle. Destructive and secret mutations are rejected by Core policy.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "oneOf": [
                {
                    "properties": {
                        "action": { "const": "plan" },
                        "expectedRevision": { "type": "integer", "minimum": 0 },
                        "operations": {
                            "type": "array",
                            "minItems": 1,
                            "items": {
                                "oneOf": [
                                    {
                                        "type": "object",
                                        "properties": {
                                            "op": { "const": "set" },
                                            "settingId": { "type": "string", "minLength": 1 },
                                            "value": {}
                                        },
                                        "required": ["op", "settingId", "value"],
                                        "additionalProperties": false
                                    },
                                    {
                                        "type": "object",
                                        "properties": {
                                            "op": { "const": "reset" },
                                            "settingId": { "type": "string", "minLength": 1 }
                                        },
                                        "required": ["op", "settingId"],
                                        "additionalProperties": false
                                    }
                                ]
                            }
                        }
                    },
                    "required": ["action", "expectedRevision", "operations"],
                    "additionalProperties": false
                },
                {
                    "properties": {
                        "action": { "const": "apply" },
                        "planId": { "type": "string", "minLength": 1 },
                        "expectedRevision": { "type": "integer", "minimum": 0 }
                    },
                    "required": ["action", "planId", "expectedRevision"],
                    "additionalProperties": false
                },
                {
                    "properties": {
                        "action": { "const": "undo" },
                        "commitId": { "type": "string", "minLength": 1 },
                        "undoToken": { "type": "string", "minLength": 1 },
                        "expectedRevision": { "type": "integer", "minimum": 0 }
                    },
                    "required": ["action", "commitId", "undoToken", "expectedRevision"],
                    "additionalProperties": false
                }
            ]
        })
    }

    fn needs_permissions(&self, input: Option<&Value>) -> bool {
        let Some(input) = input else {
            return true;
        };
        match serde_json::from_value::<SettingsChangeInput>(input.clone()) {
            Ok(SettingsChangeInput::Plan { .. }) => false,
            Ok(SettingsChangeInput::Apply { plan_id, .. }) => {
                config_plan_requires_confirmation(&plan_id)
            }
            Ok(SettingsChangeInput::Undo { commit_id, .. }) => {
                config_undo_requires_confirmation(&commit_id)
            }
            Err(_) => true,
        }
    }

    fn confirmation_payload(&self, input: &Value) -> Value {
        match serde_json::from_value::<SettingsChangeInput>(input.clone()) {
            Ok(SettingsChangeInput::Apply { plan_id, .. }) => {
                config_plan_for_confirmation(&plan_id)
                    .and_then(|plan| serde_json::to_value(plan).ok())
                    .map(|plan| json!({ "action": "apply", "plan": plan }))
                    .unwrap_or_else(|| json!({ "action": "apply", "unavailable": true }))
            }
            Ok(SettingsChangeInput::Undo { commit_id, .. }) => {
                config_undo_for_confirmation(&commit_id)
                    .and_then(|confirmation| serde_json::to_value(confirmation.published()).ok())
                    .map(|confirmation| json!({ "action": "undo", "confirmation": confirmation }))
                    .unwrap_or_else(|| json!({ "action": "undo", "unavailable": true }))
            }
            Ok(SettingsChangeInput::Plan { .. }) => {
                json!({ "action": "plan", "unavailable": true })
            }
            Err(_) => json!({ "unavailable": true }),
        }
    }

    async fn validate_input(
        &self,
        input: &Value,
        context: Option<&ToolUseContext>,
    ) -> ValidationResult {
        if !is_settings_agent(context) {
            return validation_error("SettingsChange is restricted to SettingsAgent");
        }
        match serde_json::from_value::<SettingsChangeInput>(input.clone()) {
            Ok(SettingsChangeInput::Plan { operations, .. }) if operations.is_empty() => {
                validation_error("SettingsChange plan requires at least one operation")
            }
            Ok(_) => ValidationResult::default(),
            Err(error) => validation_error(format!("Invalid SettingsChange input: {error}")),
        }
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> CoreResult<Vec<ToolResult>> {
        enforce_settings_agent(context, self.name())?;
        let input: SettingsChangeInput = parse_input(input, self.name())?;
        let service = get_global_config_service().await?;
        let confirmed = context
            .custom_data
            .get(CONFIRMATION_GRANTED_KEY)
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let tool_call_id = context
            .tool_call_id
            .as_deref()
            .ok_or_else(|| CoreError::validation("SettingsChange requires tool_call_id"))?;

        let output = match input {
            SettingsChangeInput::Plan {
                expected_revision,
                operations,
            } => {
                let session_id = context
                    .session_id
                    .as_deref()
                    .ok_or_else(|| CoreError::validation("SettingsChange requires session_id"))?;
                let request_id = context.dialog_turn_id.clone().ok_or_else(|| {
                    CoreError::validation("SettingsChange requires dialog_turn_id")
                })?;
                let conflicts = dirty_setting_conflicts(session_id, &request_id, &operations);
                if !conflicts.is_empty() {
                    return Err(CoreError::validation(format!(
                        "config.manual_draft_conflict: {}",
                        conflicts.join(",")
                    )));
                }
                let source = ConfigChangeSource {
                    kind: ConfigChangeSourceKind::Ai,
                    surface: Some(SETTINGS_SURFACE.to_string()),
                    request_id: Some(request_id.clone()),
                };
                serde_json::to_value(
                    service
                        .plan_patch(ConfigPatch {
                            request_id,
                            idempotency_key: format!("settings-plan-{tool_call_id}"),
                            expected_revision,
                            source,
                            scope: ConfigScope::user(),
                            operations,
                        })
                        .await?,
                )?
            }
            SettingsChangeInput::Apply {
                plan_id,
                expected_revision,
            } => {
                let commit = service
                    .commit_plan(CommitConfigPlanRequest {
                        plan_id,
                        expected_revision,
                        idempotency_key: format!("settings-apply-{tool_call_id}"),
                        confirmed,
                    })
                    .await?;
                serde_json::to_value(commit.published())?
            }
            SettingsChangeInput::Undo {
                commit_id,
                undo_token,
                expected_revision,
            } => {
                let request_id = context.dialog_turn_id.clone().ok_or_else(|| {
                    CoreError::validation("SettingsChange requires dialog_turn_id")
                })?;
                serde_json::to_value(
                    service
                        .undo_commit(
                            UndoConfigCommitRequest {
                                commit_id,
                                undo_token,
                                expected_revision,
                                idempotency_key: format!("settings-undo-{tool_call_id}"),
                                confirmed,
                            },
                            ConfigChangeSource {
                                kind: ConfigChangeSourceKind::Ai,
                                surface: Some(SETTINGS_SURFACE.to_string()),
                                request_id: Some(request_id),
                            },
                        )
                        .await?
                        .published(),
                )?
            }
        };

        Ok(vec![ToolResult::ok(output, None)])
    }
}

fn is_settings_agent(context: Option<&ToolUseContext>) -> bool {
    context.and_then(|context| context.agent_type.as_deref()) == Some(SettingsAgent::ID)
}

fn enforce_settings_agent(context: &ToolUseContext, tool_name: &str) -> CoreResult<()> {
    context.enforce_tool_runtime_restrictions(tool_name)?;
    if !is_settings_agent(Some(context)) {
        return Err(CoreError::validation(format!(
            "{tool_name} is restricted to SettingsAgent"
        )));
    }
    Ok(())
}

fn parse_input<T>(input: &Value, tool_name: &str) -> CoreResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(input.clone())
        .map_err(|error| CoreError::validation(format!("Invalid {tool_name} input: {error}")))
}

fn validation_error(message: impl Into<String>) -> ValidationResult {
    ValidationResult {
        result: false,
        message: Some(message.into()),
        error_code: None,
        meta: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_change_schema_exposes_only_transaction_actions() {
        let schema = SettingsChangeTool::new().input_schema();
        let actions = schema["oneOf"]
            .as_array()
            .expect("oneOf")
            .iter()
            .filter_map(|branch| branch["properties"]["action"]["const"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(actions, vec!["plan", "apply", "undo"]);
        assert!(schema["oneOf"]
            .as_array()
            .expect("oneOf")
            .iter()
            .all(|branch| branch["properties"].get("idempotencyKey").is_none()));
    }

    #[test]
    fn settings_catalog_schema_exposes_only_bounded_query_and_exact_get() {
        let schema = SettingsCatalogTool::new().input_schema();
        let actions = schema["oneOf"]
            .as_array()
            .expect("oneOf")
            .iter()
            .filter_map(|branch| branch["properties"]["action"]["const"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(actions, vec!["query", "get"]);
        assert_eq!(
            schema["oneOf"][0]["properties"]["limit"]["maximum"],
            json!(MAX_CATALOG_QUERY_RESULTS)
        );
    }

    #[test]
    fn settings_tool_schema_examples_match_the_camel_case_wire_contract() {
        let catalog_get = serde_json::from_value::<SettingsCatalogInput>(json!({
            "action": "get",
            "settingId": "core.font.ui_size.level"
        }))
        .expect("catalog get schema example should deserialize");
        assert!(matches!(
            catalog_get,
            SettingsCatalogInput::Get { setting_id }
                if setting_id == "core.font.ui_size.level"
        ));

        let change_plan = serde_json::from_value::<SettingsChangeInput>(json!({
            "action": "plan",
            "expectedRevision": 4,
            "operations": [{
                "op": "set",
                "settingId": "core.font.ui_size.level",
                "value": "large"
            }]
        }))
        .expect("change plan schema example should deserialize");
        assert!(matches!(
            change_plan,
            SettingsChangeInput::Plan {
                expected_revision: 4,
                operations
            } if operations == vec![ConfigPatchOperation::Set {
                setting_id: "core.font.ui_size.level".to_string(),
                value: json!("large")
            }]
        ));

        let change_apply = serde_json::from_value::<SettingsChangeInput>(json!({
            "action": "apply",
            "planId": "plan-1",
            "expectedRevision": 4
        }))
        .expect("change apply schema example should deserialize");
        assert!(matches!(
            change_apply,
            SettingsChangeInput::Apply {
                plan_id,
                expected_revision: 4
            } if plan_id == "plan-1"
        ));

        let change_undo = serde_json::from_value::<SettingsChangeInput>(json!({
            "action": "undo",
            "commitId": "commit-1",
            "undoToken": "undo-1",
            "expectedRevision": 5
        }))
        .expect("change undo schema example should deserialize");
        assert!(matches!(
            change_undo,
            SettingsChangeInput::Undo {
                commit_id,
                undo_token,
                expected_revision: 5
            } if commit_id == "commit-1" && undo_token == "undo-1"
        ));
    }

    #[test]
    fn settings_tool_wire_contract_rejects_undeclared_snake_case_fields() {
        let catalog_error = serde_json::from_value::<SettingsCatalogInput>(json!({
            "action": "get",
            "setting_id": "core.font.ui_size.level"
        }))
        .expect_err("catalog input must match the model-facing schema");
        assert!(catalog_error.to_string().contains("setting_id"));

        let change_error = serde_json::from_value::<SettingsChangeInput>(json!({
            "action": "apply",
            "plan_id": "plan-1",
            "expected_revision": 4
        }))
        .expect_err("change input must match the model-facing schema");
        assert!(change_error.to_string().contains("plan_id"));
    }

    #[test]
    fn settings_agent_catalog_projection_hides_storage_paths() {
        let defaults = serde_json::to_value(crate::service::config::GlobalConfig::default())
            .expect("default config");
        let catalog =
            crate::service::config::ConfigCatalog::build(&defaults, &defaults).expect("catalog");
        let descriptor = catalog
            .find("core.app.language")
            .expect("language setting")
            .published()
            .expect("formal published descriptor");

        let projected = descriptor_for_settings_agent(&descriptor).expect("agent projection");

        assert_eq!(projected["id"], json!("core.app.language"));
        assert!(projected.get("storage").is_none());
    }

    #[test]
    fn settings_agent_commit_projection_hides_internal_paths() {
        let projected = serde_json::to_value(
            sparo_events::ConfigValueChange {
                setting_id: "core.app.language".to_string(),
                path: "app.language".to_string(),
                old_value: sparo_events::ConfigStoredValue::public(json!("en-US")),
                new_value: sparo_events::ConfigStoredValue::public(json!("zh-CN")),
                apply_strategy: sparo_events::ConfigApplyStrategy::Reactive,
            }
            .published(),
        )
        .expect("published change");

        assert!(projected.get("path").is_none());
        assert_eq!(projected["settingId"], json!("core.app.language"));
    }

    #[test]
    fn unknown_apply_plan_requires_confirmation() {
        let tool = SettingsChangeTool::new();
        assert!(tool.needs_permissions(Some(&json!({
            "action": "apply",
            "planId": "missing",
            "expectedRevision": 1
        }))));
    }

    #[test]
    fn dirty_constraints_reject_only_overlapping_setting_ids() {
        let session_id = "settings-session-dirty-test";
        let turn_id = "settings-turn-dirty-test";
        register_dirty_settings_constraint(
            session_id,
            turn_id,
            ["core.editor.font_size".to_string()],
        )
        .expect("dirty constraint should register");
        assert_eq!(
            dirty_setting_conflicts(
                session_id,
                turn_id,
                &[ConfigPatchOperation::Set {
                    setting_id: "core.editor.font_size".to_string(),
                    value: json!(16),
                }],
            ),
            vec!["core.editor.font_size".to_string()]
        );
        assert!(dirty_setting_conflicts(
            session_id,
            turn_id,
            &[ConfigPatchOperation::Set {
                setting_id: "core.app.language".to_string(),
                value: json!("en-US"),
            }],
        )
        .is_empty());
        clear_dirty_settings_constraint(session_id, turn_id);
    }

    #[test]
    fn dirty_constraints_do_not_cross_settings_sessions() {
        let turn_id = "shared-turn-id";
        register_dirty_settings_constraint(
            "settings-session-one",
            turn_id,
            ["core.editor.font_size".to_string()],
        )
        .expect("first session constraint should register");
        register_dirty_settings_constraint(
            "settings-session-two",
            turn_id,
            ["core.app.language".to_string()],
        )
        .expect("second session constraint should register");

        let operation = [ConfigPatchOperation::Set {
            setting_id: "core.editor.font_size".to_string(),
            value: json!(16),
        }];
        assert_eq!(
            dirty_setting_conflicts("settings-session-one", turn_id, &operation),
            vec!["core.editor.font_size".to_string()]
        );
        assert!(dirty_setting_conflicts("settings-session-two", turn_id, &operation).is_empty());

        clear_dirty_settings_constraint("settings-session-one", turn_id);
        clear_dirty_settings_constraint("settings-session-two", turn_id);
    }

    #[test]
    fn dirty_constraint_guard_clears_the_terminal_turn() {
        let store = Arc::new(DirtySettingsConstraintStore::new(2));
        let turn_id = "settings-turn-terminal-guard";
        let key = dirty_constraint_key("settings-session-terminal-guard", turn_id);
        store
            .register(
                &key,
                BTreeSet::from(["core.editor.font_size".to_string()]),
                Duration::from_secs(60),
            )
            .expect("dirty constraint should register");

        let guard = DirtySettingsConstraintGuard::new(store.clone(), key.clone());
        assert!(store.contains(&key));
        drop(guard);
        assert!(!store.contains(&key));
    }

    #[tokio::test]
    async fn dirty_constraint_expires_without_a_same_turn_lookup() {
        let store = Arc::new(DirtySettingsConstraintStore::new(2));
        let turn_id = "settings-turn-expiring";
        let key = dirty_constraint_key("settings-session-expiring", turn_id);
        store
            .register(
                &key,
                BTreeSet::from(["core.editor.font_size".to_string()]),
                Duration::from_millis(20),
            )
            .expect("dirty constraint should register");
        assert!(store.contains(&key));

        tokio::time::timeout(Duration::from_secs(1), async {
            while store.contains(&key) {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("expiration task should remove the dirty constraint");
    }

    #[test]
    fn dirty_constraint_store_fails_closed_at_its_capacity() {
        let store = Arc::new(DirtySettingsConstraintStore::new(1));
        let setting_ids = BTreeSet::from(["core.editor.font_size".to_string()]);
        let first_key = dirty_constraint_key("settings-session-capacity", "turn-1");
        let second_key = dirty_constraint_key("settings-session-capacity", "turn-2");
        store
            .register(&first_key, setting_ids.clone(), Duration::from_secs(60))
            .expect("first constraint should register");

        assert!(store
            .register(&second_key, setting_ids.clone(), Duration::from_secs(60))
            .is_err());
        assert!(!store.contains(&second_key));

        store.clear(&first_key);
        store
            .register(&second_key, setting_ids, Duration::from_secs(60))
            .expect("capacity should be reusable after terminal cleanup");
    }

    #[tokio::test]
    async fn catalog_tool_rejects_non_settings_agent_context() {
        let validation = SettingsCatalogTool::new()
            .validate_input(&json!({ "action": "query", "query": "theme" }), None)
            .await;
        assert!(!validation.result);
    }
}
