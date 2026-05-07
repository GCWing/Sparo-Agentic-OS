use std::path::Path;
use std::sync::Arc;

use bitfun_core::agentic::core::SessionKind;
use bitfun_core::agentic::persistence::PersistenceManager;
use bitfun_core::infrastructure::PathManager;
use bitfun_core::service::session::SessionMetadata;
use bitfun_core::util::errors::{BitFunError, BitFunResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub(super) const CUSTOM_METADATA_PROVIDER_KEY: &str = "provider";
pub(super) const CUSTOM_METADATA_PROVIDER_VALUE: &str = "acp";
pub(super) const CUSTOM_METADATA_CLIENT_ID_KEY: &str = "acpClientId";
pub(super) const CUSTOM_METADATA_ORIGIN_KEY: &str = "origin";
pub(super) const CUSTOM_METADATA_PARENT_SESSION_ID_KEY: &str = "parentSessionId";
pub(super) const CUSTOM_METADATA_PARENT_DIALOG_TURN_ID_KEY: &str = "parentDialogTurnId";
pub(super) const CUSTOM_METADATA_PARENT_TOOL_CALL_ID_KEY: &str = "parentToolCallId";
pub(super) const CUSTOM_METADATA_REMOTE_SESSION_ID_KEY: &str = "acpRemoteSessionId";
pub(super) const CUSTOM_METADATA_RESUME_STRATEGY_KEY: &str = "acpResumeStrategy";
pub(super) const CUSTOM_METADATA_LAST_RESUME_ERROR_KEY: &str = "acpLastResumeError";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAcpFlowSessionRecordResponse {
    pub session_id: String,
    pub session_name: String,
    pub agent_type: String,
}

pub(super) struct AcpSessionPersistence {
    manager: PersistenceManager,
}

impl AcpSessionPersistence {
    pub(super) fn new(path_manager: Arc<PathManager>) -> BitFunResult<Self> {
        Ok(Self {
            manager: PersistenceManager::new(path_manager)?,
        })
    }

    pub(super) async fn create_flow_session_record(
        &self,
        session_storage_path: &Path,
        workspace_path: &str,
        client_id: &str,
        session_name: Option<String>,
    ) -> BitFunResult<CreateAcpFlowSessionRecordResponse> {
        self.create_session_record(
            session_storage_path,
            workspace_path,
            client_id,
            session_name,
            None,
            SessionKind::Standard,
            None,
            None,
            None,
            None,
        )
        .await
    }

    pub(super) async fn create_dispatched_flow_session_record(
        &self,
        session_storage_path: &Path,
        workspace_path: &str,
        client_id: &str,
        session_name: Option<String>,
        created_by: Option<String>,
        origin: Option<&str>,
    ) -> BitFunResult<CreateAcpFlowSessionRecordResponse> {
        self.create_session_record(
            session_storage_path,
            workspace_path,
            client_id,
            session_name,
            created_by,
            SessionKind::Standard,
            None,
            None,
            None,
            origin,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn create_derived_flow_session_record(
        &self,
        session_storage_path: &Path,
        workspace_path: &str,
        client_id: &str,
        session_name: Option<String>,
        created_by: Option<String>,
        parent_session_id: &str,
        parent_dialog_turn_id: Option<&str>,
        parent_tool_call_id: Option<&str>,
        origin: Option<&str>,
    ) -> BitFunResult<CreateAcpFlowSessionRecordResponse> {
        self.create_session_record(
            session_storage_path,
            workspace_path,
            client_id,
            session_name,
            created_by,
            SessionKind::Derived,
            Some(parent_session_id),
            parent_dialog_turn_id,
            parent_tool_call_id,
            origin,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn create_session_record(
        &self,
        session_storage_path: &Path,
        workspace_path: &str,
        client_id: &str,
        session_name: Option<String>,
        created_by: Option<String>,
        session_kind: SessionKind,
        parent_session_id: Option<&str>,
        parent_dialog_turn_id: Option<&str>,
        parent_tool_call_id: Option<&str>,
        origin: Option<&str>,
    ) -> BitFunResult<CreateAcpFlowSessionRecordResponse> {
        let session_id = format!("acp_{}_{}", client_id, uuid::Uuid::new_v4());
        let agent_type = format!("acp:{}", client_id);
        let session_name = session_name
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("{} ACP", client_id));

        let mut metadata = SessionMetadata::new(
            session_id.clone(),
            session_name.clone(),
            agent_type.clone(),
            "auto".to_string(),
        );
        metadata.created_by = created_by;
        metadata.session_kind = session_kind;
        metadata.workspace_path = Some(workspace_path.to_string());
        metadata.custom_metadata = Some(json!({
            "kind": if matches!(session_kind, SessionKind::Derived) { "derived" } else { "normal" },
            CUSTOM_METADATA_PROVIDER_KEY: CUSTOM_METADATA_PROVIDER_VALUE,
            CUSTOM_METADATA_CLIENT_ID_KEY: client_id,
            CUSTOM_METADATA_ORIGIN_KEY: origin,
            CUSTOM_METADATA_PARENT_SESSION_ID_KEY: parent_session_id,
            CUSTOM_METADATA_PARENT_DIALOG_TURN_ID_KEY: parent_dialog_turn_id,
            CUSTOM_METADATA_PARENT_TOOL_CALL_ID_KEY: parent_tool_call_id,
            CUSTOM_METADATA_REMOTE_SESSION_ID_KEY: null,
            CUSTOM_METADATA_RESUME_STRATEGY_KEY: null,
            CUSTOM_METADATA_LAST_RESUME_ERROR_KEY: null,
        }));

        self.manager
            .save_session_metadata(session_storage_path, &metadata)
            .await?;

        Ok(CreateAcpFlowSessionRecordResponse {
            session_id,
            session_name,
            agent_type,
        })
    }

    pub(super) async fn delete_flow_session_record(
        &self,
        session_storage_path: &Path,
        bitfun_session_id: &str,
    ) -> BitFunResult<()> {
        self.manager
            .delete_session(session_storage_path, bitfun_session_id)
            .await
    }

    pub(super) async fn load_remote_session_id(
        &self,
        session_storage_path: &Path,
        bitfun_session_id: &str,
    ) -> BitFunResult<Option<String>> {
        let Some(metadata) = self
            .manager
            .load_session_metadata(session_storage_path, bitfun_session_id)
            .await?
        else {
            return Ok(None);
        };

        Ok(metadata
            .custom_metadata
            .as_ref()
            .and_then(|custom| custom.get(CUSTOM_METADATA_REMOTE_SESSION_ID_KEY))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string))
    }

    pub(super) async fn update_remote_session_state(
        &self,
        session_storage_path: &Path,
        bitfun_session_id: &str,
        remote_session_id: &str,
        resume_strategy: &str,
        last_resume_error: Option<String>,
    ) -> BitFunResult<()> {
        self.update_metadata(session_storage_path, bitfun_session_id, |metadata| {
            let mut custom = metadata.custom_metadata.take().unwrap_or_else(|| json!({}));
            ensure_object(&mut custom)?;
            custom[CUSTOM_METADATA_PROVIDER_KEY] = json!(CUSTOM_METADATA_PROVIDER_VALUE);
            custom[CUSTOM_METADATA_REMOTE_SESSION_ID_KEY] = json!(remote_session_id);
            custom[CUSTOM_METADATA_RESUME_STRATEGY_KEY] = json!(resume_strategy);
            custom[CUSTOM_METADATA_LAST_RESUME_ERROR_KEY] =
                last_resume_error.map(Value::String).unwrap_or(Value::Null);
            metadata.custom_metadata = Some(custom);
            metadata.touch();
            Ok(())
        })
        .await
    }

    pub(super) async fn update_model_id(
        &self,
        session_storage_path: &Path,
        bitfun_session_id: &str,
        model_id: &str,
    ) -> BitFunResult<()> {
        self.update_metadata(session_storage_path, bitfun_session_id, |metadata| {
            metadata.model_name = model_id.to_string();
            metadata.touch();
            Ok(())
        })
        .await
    }

    async fn update_metadata(
        &self,
        session_storage_path: &Path,
        bitfun_session_id: &str,
        update: impl FnOnce(&mut SessionMetadata) -> BitFunResult<()>,
    ) -> BitFunResult<()> {
        let Some(mut metadata) = self
            .manager
            .load_session_metadata(session_storage_path, bitfun_session_id)
            .await?
        else {
            return Ok(());
        };

        update(&mut metadata)?;
        self.manager
            .save_session_metadata(session_storage_path, &metadata)
            .await
    }
}

fn ensure_object(value: &mut Value) -> BitFunResult<()> {
    if value.is_object() {
        return Ok(());
    }

    *value = json!({});
    if value.is_object() {
        Ok(())
    } else {
        Err(BitFunError::service(
            "Failed to initialize ACP session custom metadata".to_string(),
        ))
    }
}
