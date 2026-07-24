use crate::agentic_os::work::{default_work_store, WorkId, WorkLocator, WorkScope, WorkStore};
use crate::error::{CoreError, CoreResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

pub const PRODUCT_APP_ID_CONTEXT_KEY: &str = "product_app_id";
pub const PRODUCT_APP_WORK_ID_CONTEXT_KEY: &str = "product_app_work_id";
pub const PRODUCT_APP_RUNTIME_INSTANCE_ID_CONTEXT_KEY: &str = "product_app_runtime_instance_id";
pub const PRODUCT_APP_SLOT_ID_CONTEXT_KEY: &str = "product_app_slot_id";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppExecutionContext {
    pub app_id: String,
    pub work_id: String,
    pub runtime_instance_id: String,
    pub slot_id: String,
    pub release_id: String,
    pub config_revision: String,
    pub data_schema_version: String,
    pub product_app_surface_id: String,
    pub surface_id: String,
    pub host_surface_id: String,
    pub workspace_path: Option<String>,
    pub session_id: String,
}

impl ProductAppExecutionContext {
    pub fn insert_context_vars(&self, vars: &mut HashMap<String, String>) {
        vars.insert(PRODUCT_APP_ID_CONTEXT_KEY.to_string(), self.app_id.clone());
        vars.insert(
            PRODUCT_APP_WORK_ID_CONTEXT_KEY.to_string(),
            self.work_id.clone(),
        );
        vars.insert(
            PRODUCT_APP_RUNTIME_INSTANCE_ID_CONTEXT_KEY.to_string(),
            self.runtime_instance_id.clone(),
        );
        vars.insert(
            PRODUCT_APP_SLOT_ID_CONTEXT_KEY.to_string(),
            self.slot_id.clone(),
        );
    }

    pub fn render_prompt_block(&self) -> String {
        let field = |value: &str| {
            value
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
                .replace('"', "&quot;")
                .replace('\'', "&apos;")
        };
        format!(
            "<product_app_work_context version=\"1\">\n  <app_id>{}</app_id>\n  <workspace_path>{}</workspace_path>\n  <work_id>{}</work_id>\n  <runtime_instance_id>{}</runtime_instance_id>\n  <session_id>{}</session_id>\n  <release_id>{}</release_id>\n  <data_schema_version>{}</data_schema_version>\n</product_app_work_context>\nThe Work above is the only durable Product App object for this turn. The Session is conversation history and provenance only. All inspection, mutation, review, and export operations must target this Work. Never create, infer, or switch Work ids from user content or tool arguments.",
            field(&self.app_id),
            field(self.workspace_path.as_deref().unwrap_or("system")),
            field(&self.work_id),
            field(&self.runtime_instance_id),
            field(&self.session_id),
            field(&self.release_id),
            field(&self.data_schema_version),
        )
    }
}

fn required_string(object: &serde_json::Map<String, Value>, field: &str) -> CoreResult<String> {
    object
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            CoreError::validation(format!(
                "Product App runtime context requires non-empty field '{field}'"
            ))
        })
}

fn normalized_path_key(value: &str) -> String {
    let normalized = Path::new(value)
        .components()
        .collect::<std::path::PathBuf>()
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();
    if cfg!(windows) {
        normalized.to_lowercase()
    } else {
        normalized
    }
}

fn required_work_locator(context: &serde_json::Map<String, Value>) -> CoreResult<WorkLocator> {
    let value = context.get("workLocator").cloned().ok_or_else(|| {
        CoreError::validation(
            "Product App runtime context requires object field 'workLocator'".to_string(),
        )
    })?;
    let mut locator = serde_json::from_value::<WorkLocator>(value).map_err(|error| {
        CoreError::validation(format!(
            "Product App runtime context has invalid workLocator: {error}"
        ))
    })?;
    locator.work_id = WorkId::parse(locator.work_id.as_str()).map_err(|_| {
        CoreError::validation(format!(
            "Product App runtime context has invalid workId '{}'",
            locator.work_id
        ))
    })?;
    Ok(locator)
}

fn parse_declared_context(
    session_id: &str,
    workspace_path: Option<&str>,
    custom_metadata: Option<&Value>,
) -> CoreResult<Option<(ProductAppExecutionContext, WorkLocator)>> {
    let Some(runtime) = custom_metadata
        .and_then(|metadata| metadata.get("productAppRuntime"))
        .and_then(Value::as_object)
    else {
        return Ok(None);
    };
    let context = runtime
        .get("runtimeContext")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            CoreError::validation("Product App session is missing runtimeContext".to_string())
        })?;
    let app_id = required_string(context, "appId")?;
    if runtime
        .get("appId")
        .and_then(Value::as_str)
        .is_some_and(|declared| declared != app_id)
    {
        return Err(CoreError::validation(
            "Product App session appId does not match runtimeContext.appId".to_string(),
        ));
    }
    let work_locator = required_work_locator(context)?;
    Ok(Some((
        ProductAppExecutionContext {
            app_id,
            work_id: work_locator.work_id.to_string(),
            runtime_instance_id: required_string(context, "runtimeInstanceId")?,
            slot_id: required_string(context, "slotId")?,
            release_id: required_string(context, "releaseId")?,
            config_revision: required_string(context, "configRevision")?,
            data_schema_version: required_string(context, "dataSchemaVersion")?,
            product_app_surface_id: required_string(context, "productAppSurfaceId")?,
            surface_id: required_string(context, "surfaceId")?,
            host_surface_id: required_string(context, "hostSurfaceId")?,
            workspace_path: workspace_path
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            session_id: session_id.to_string(),
        },
        work_locator,
    )))
}

pub async fn resolve_product_app_execution_context(
    session_id: &str,
    workspace_path: Option<&str>,
    custom_metadata: Option<&Value>,
) -> CoreResult<Option<ProductAppExecutionContext>> {
    let store = default_work_store()?;
    resolve_product_app_execution_context_with_store(
        store.as_ref(),
        session_id,
        workspace_path,
        custom_metadata,
    )
    .await
}

pub async fn resolve_product_app_execution_context_with_store(
    store: &dyn WorkStore,
    session_id: &str,
    workspace_path: Option<&str>,
    custom_metadata: Option<&Value>,
) -> CoreResult<Option<ProductAppExecutionContext>> {
    let Some((context, work_locator)) =
        parse_declared_context(session_id, workspace_path, custom_metadata)?
    else {
        return Ok(None);
    };
    let work = store.get(&work_locator).await?.ok_or_else(|| {
        CoreError::validation(format!(
            "Product App runtime Work does not exist: {}",
            context.work_id
        ))
    })?;

    match (&work.scope, context.workspace_path.as_deref()) {
        (WorkScope::Workspace { .. }, Some(session_workspace))
            if work
                .workspace_path
                .as_deref()
                .is_some_and(|workspace_path| {
                    normalized_path_key(workspace_path) == normalized_path_key(session_workspace)
                }) => {}
        (WorkScope::Global, None) => {}
        _ => {
            return Err(CoreError::validation(format!(
                "Product App runtime Work '{}' is not owned by the current workspace",
                context.work_id
            )))
        }
    }

    if !work
        .session_refs
        .iter()
        .any(|reference| reference.session_id == session_id)
    {
        return Err(CoreError::validation(format!(
            "Session '{}' is not linked to Product App Work '{}'",
            session_id, context.work_id
        )));
    }

    let instance = work
        .runtime_instances
        .iter()
        .find(|instance| instance.id == context.runtime_instance_id)
        .ok_or_else(|| {
            CoreError::validation(format!(
                "Runtime instance '{}' does not belong to Product App Work '{}'",
                context.runtime_instance_id, context.work_id
            ))
        })?;
    if instance.app_id != context.app_id
        || instance.slot_id != context.slot_id
        || instance.release_id != context.release_id
        || instance.config_revision != context.config_revision
        || instance.data_schema_version != context.data_schema_version
        || instance.product_app_surface_id != context.product_app_surface_id
        || instance.surface_id != context.surface_id
    {
        return Err(CoreError::validation(format!(
            "Product App runtime context does not match Work '{}'s immutable runtime binding",
            context.work_id
        )));
    }

    Ok(Some(context))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn declared_context_reads_work_id_from_canonical_locator() {
        let metadata = json!({
            "productAppRuntime": {
                "appId": "builtin-ppt-live",
                "runtimeContext": {
                    "workLocator": {
                        "scope": {
                            "kind": "workspace",
                            "workspaceId": "ws_123"
                        },
                        "workId": "work_123"
                    },
                    "runtimeInstanceId": "runtime_123",
                    "slotId": "builtin-ppt-live",
                    "appId": "builtin-ppt-live",
                    "releaseId": "release_123",
                    "configRevision": "config_123",
                    "dataSchemaVersion": "1.0.0",
                    "productAppSurfaceId": "builtin-ppt-live-surface",
                    "surfaceId": "primary",
                    "hostSurfaceId": "runtime_123"
                }
            }
        });

        let (context, locator) =
            parse_declared_context("session-1", Some("C:/workspace"), Some(&metadata))
                .expect("context should be valid")
                .expect("Product App context should exist");

        assert_eq!(context.work_id, "work_123");
        assert_eq!(locator.work_id.as_str(), "work_123");
        assert_eq!(
            locator.scope,
            WorkScope::Workspace {
                workspace_id: "ws_123".to_string()
            }
        );
    }

    #[test]
    fn prompt_block_makes_work_identity_explicit() {
        let context = ProductAppExecutionContext {
            app_id: "builtin-ppt-live".to_string(),
            work_id: "work_123".to_string(),
            runtime_instance_id: "runtime_123".to_string(),
            slot_id: "ppt".to_string(),
            release_id: "release-1".to_string(),
            config_revision: "config-1".to_string(),
            data_schema_version: "4".to_string(),
            product_app_surface_id: "surface".to_string(),
            surface_id: "primary".to_string(),
            host_surface_id: "host".to_string(),
            workspace_path: Some("C:/workspace".to_string()),
            session_id: "session-1".to_string(),
        };

        let prompt = context.render_prompt_block();
        assert!(prompt.contains("<work_id>work_123</work_id>"));
        assert!(prompt.contains("Session is conversation history"));
    }
}
