//! Product App session-history API.
//!
//! Product Apps address conversations by Work and channel. The desktop host
//! resolves that logical identity to the authoritative storage partition.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sparo_core::agentic::coordination::ConversationCoordinator;
use sparo_core::agentic::core::{
    ProductAppSessionChannel, ProductAppSessionRole, SessionConfig, SessionLocator, SessionOwner,
};
use sparo_core::agentic_os::work::{
    default_work_store, LinkSessionToWorkRequest, WorkAppKind, WorkLocator, WorkService,
    WorkSurfaceRef,
};
use sparo_core::app_platform::ProductAppSessionResolver;
use sparo_core::service::session::SessionMetadata;
use tauri::State;

use crate::api::app_state::AppState;
static OPEN_PRODUCT_APP_SESSION_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProductAppSessionRequest {
    pub work_locator: WorkLocator,
    pub app_id: String,
    pub channel_id: String,
    #[serde(default)]
    pub entity_id: Option<String>,
    pub session_name: String,
    pub agent_type: String,
    #[serde(default)]
    pub custom_metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppSessionHistoryBinding {
    pub execution_workspace_path: String,
    pub locator: SessionLocator,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProductAppSessionResponse {
    pub session_id: String,
    pub created: bool,
    pub history: ProductAppSessionHistoryBinding,
    pub metadata: SessionMetadata,
}

fn required(value: &str, field: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        Err(format!("{field} is required"))
    } else {
        Ok(value.to_string())
    }
}

fn product_app_metadata_patch(
    custom_metadata: Option<Value>,
    app_id: &str,
    work_id: &str,
    channel: &ProductAppSessionChannel,
) -> Result<Value, String> {
    let mut root = match custom_metadata {
        Some(Value::Object(value)) => value,
        Some(_) => return Err("custom_metadata must be a JSON object".to_string()),
        None => serde_json::Map::new(),
    };
    let runtime = root
        .entry("productAppRuntime".to_string())
        .or_insert_with(|| json!({}));
    let runtime = runtime
        .as_object_mut()
        .ok_or_else(|| "custom_metadata.productAppRuntime must be a JSON object".to_string())?;
    runtime.insert("appId".to_string(), Value::String(app_id.to_string()));
    runtime.insert("workId".to_string(), Value::String(work_id.to_string()));
    runtime.insert(
        "sessionChannel".to_string(),
        json!({
            "channelId": channel.channel_id,
            "entityId": channel.entity_id,
            "role": "surface_chat",
        }),
    );
    Ok(Value::Object(root))
}

#[tauri::command]
pub async fn open_product_app_session(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    app_state: State<'_, AppState>,
    request: OpenProductAppSessionRequest,
) -> Result<OpenProductAppSessionResponse, String> {
    let work_locator = request.work_locator;
    let app_id = required(&request.app_id, "app_id")?;
    let channel_id = required(&request.channel_id, "channel_id")?;
    let session_name = required(&request.session_name, "session_name")?;
    let agent_type = required(&request.agent_type, "agent_type")?;
    let channel = ProductAppSessionChannel {
        channel_id,
        entity_id: request
            .entity_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    };
    let metadata_patch = product_app_metadata_patch(
        request.custom_metadata,
        &app_id,
        work_locator.work_id.as_str(),
        &channel,
    )?;

    // Work linking and session creation must be one logical resolve-or-create
    // operation. Serializing this short critical section prevents duplicate
    // surface sessions when the same app is opened concurrently.
    let _guard = OPEN_PRODUCT_APP_SESSION_LOCK.lock().await;
    let work_service = WorkService::new(default_work_store().map_err(|error| error.to_string())?);
    let work = work_service
        .get(&work_locator)
        .await
        .map_err(|error| error.to_string())?;
    let references_app = work
        .subject
        .app_ref()
        .is_some_and(|app| app.kind == WorkAppKind::ProductApp && app.app_id == app_id)
        || work.app_refs.iter().any(|relation| {
            relation.app.kind == WorkAppKind::ProductApp && relation.app.app_id == app_id
        });
    if !references_app {
        return Err(format!(
            "Product App {app_id} is not bound to Work {}",
            work.id
        ));
    }

    let expected_owner = SessionOwner::ProductApp {
        app_id: app_id.clone(),
        work_id: work.id.to_string(),
        channel: channel.clone(),
        role: ProductAppSessionRole::SurfaceChat,
    };
    let matches = work
        .session_refs
        .iter()
        .filter(|session_ref| session_ref.owner.as_ref() == Some(&expected_owner))
        .collect::<Vec<_>>();
    if matches.len() > 1 {
        return Err(format!(
            "Work {} has multiple Product App sessions for channel {}",
            work.id, channel.channel_id
        ));
    }

    let path_manager = app_state.workspace_service.path_manager();
    let (session_id, binding, created) = if let Some(session_ref) = matches.first() {
        let binding = ProductAppSessionResolver::binding_for_work(
            path_manager,
            &work,
            &app_id,
            session_ref.session_id.clone(),
            channel.clone(),
            ProductAppSessionRole::SurfaceChat,
        )
        .map_err(|error| error.to_string())?;
        if session_ref.locator.as_ref() != Some(&binding.locator) {
            return Err(format!(
                "Product App session {} has an invalid history locator",
                session_ref.session_id
            ));
        }
        if coordinator
            .get_session_manager()
            .get_session(&session_ref.session_id)
            .is_none()
        {
            coordinator
                .restore_session(&binding.locator)
                .await
                .map_err(|error| format!("Failed to restore Product App session: {error}"))?;
        }
        (session_ref.session_id.clone(), binding, false)
    } else {
        let binding = ProductAppSessionResolver::binding_for_work(
            path_manager,
            &work,
            &app_id,
            uuid::Uuid::new_v4().to_string(),
            channel.clone(),
            ProductAppSessionRole::SurfaceChat,
        )
        .map_err(|error| error.to_string())?;
        let config = SessionConfig {
            workspace_path: Some(binding.execution_workspace_path.clone()),
            ..SessionConfig::new(binding.locator.domain.clone())
        };
        let session = coordinator
            .create_session_with_workspace(
                Some(binding.locator.session_id.clone()),
                session_name,
                agent_type,
                config,
                binding.execution_workspace_path.clone(),
            )
            .await
            .map_err(|error| format!("Failed to create Product App session: {error}"))?;
        if let Err(error) = coordinator
            .merge_session_custom_metadata(&session.session_id, metadata_patch.clone())
            .await
        {
            let cleanup_error = coordinator.delete_session(&binding.locator).await.err();
            return Err(match cleanup_error {
                Some(cleanup_error) => format!(
                    "Failed to persist Product App session metadata: {error}; cleanup failed: {cleanup_error}"
                ),
                None => format!("Failed to persist Product App session metadata: {error}"),
            });
        }
        if let Err(error) = work_service
            .link_session_to_work(LinkSessionToWorkRequest {
                work_locator: work.locator(),
                session_id: session.session_id.clone(),
                workspace_path: work.workspace_path.clone(),
                locator: Some(binding.locator.clone()),
                owner: Some(binding.owner.clone()),
                surface: Some(WorkSurfaceRef::AgentSession {
                    session_id: session.session_id.clone(),
                }),
                bind_surface: true,
                set_primary: false,
            })
            .await
        {
            let cleanup_error = coordinator.delete_session(&binding.locator).await.err();
            return Err(match cleanup_error {
                Some(cleanup_error) => format!(
                    "Failed to link Product App session to Work: {error}; cleanup failed: {cleanup_error}"
                ),
                None => format!("Failed to link Product App session to Work: {error}"),
            });
        }
        (session.session_id, binding, true)
    };

    if !created {
        coordinator
            .merge_session_custom_metadata(&session_id, metadata_patch)
            .await
            .map_err(|error| format!("Failed to persist Product App session metadata: {error}"))?;
    }

    let metadata = coordinator
        .get_session_manager()
        .load_session_metadata(&session_id)
        .await
        .map_err(|error| format!("Failed to load Product App session metadata: {error}"))?
        .ok_or_else(|| format!("Product App session metadata not found: {session_id}"))?;

    Ok(OpenProductAppSessionResponse {
        session_id,
        created,
        history: ProductAppSessionHistoryBinding {
            execution_workspace_path: binding.execution_workspace_path,
            locator: binding.locator,
        },
        metadata,
    })
}
