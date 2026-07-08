use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;

use crate::agentic::coordination::{
    ConversationCoordinator, DialogScheduler, DialogSubmissionPolicy, DialogSubmitOutcome,
    DialogTriggerSource, SessionControlActor, TurnCancellationReason,
};
use crate::agentic::core::SessionConfig;
use crate::error::{CoreError, CoreResult};

use super::ids::WorkId;

#[derive(Debug, Clone)]
pub struct CreateWorkSessionRequest {
    pub work_id: WorkId,
    pub title: String,
    pub agent_type: String,
    pub workspace_path: String,
}

#[derive(Debug, Clone)]
pub struct CreateWorkSessionOutcome {
    pub session_id: String,
    pub session_name: String,
    pub agent_type: String,
}

#[derive(Debug, Clone)]
pub struct WorkSessionAdvanceRequest {
    pub work_id: WorkId,
    pub session_id: String,
    pub agent_type: String,
    pub workspace_path: String,
    pub instructions: String,
}

#[derive(Debug, Clone)]
pub struct WorkSessionAdvanceOutcome {
    pub session_id: String,
    pub turn_id: String,
    pub started: bool,
}

#[async_trait]
pub trait WorkRuntimeBridge: Send + Sync {
    async fn create_work_session(
        &self,
        request: CreateWorkSessionRequest,
    ) -> CoreResult<CreateWorkSessionOutcome>;

    async fn advance_work_session(
        &self,
        request: WorkSessionAdvanceRequest,
    ) -> CoreResult<WorkSessionAdvanceOutcome>;

    async fn cancel_work_session_run(&self, _session_id: &str) -> CoreResult<()> {
        Ok(())
    }

    async fn clear_work_session_queue(&self, _session_id: &str) -> CoreResult<()> {
        Ok(())
    }

    async fn delete_work_session(
        &self,
        _workspace_path: &str,
        _session_id: &str,
    ) -> CoreResult<()> {
        Err(CoreError::service(
            "Work runtime bridge is required to delete Work-owned sessions",
        ))
    }
}

#[derive(Debug, Default)]
pub struct NoopWorkRuntimeBridge;

#[async_trait]
impl WorkRuntimeBridge for NoopWorkRuntimeBridge {
    async fn create_work_session(
        &self,
        _request: CreateWorkSessionRequest,
    ) -> CoreResult<CreateWorkSessionOutcome> {
        Err(CoreError::service(
            "Work runtime bridge is required to create a WorkSession",
        ))
    }

    async fn advance_work_session(
        &self,
        _request: WorkSessionAdvanceRequest,
    ) -> CoreResult<WorkSessionAdvanceOutcome> {
        Err(CoreError::service(
            "Work runtime bridge is required to advance a WorkSession",
        ))
    }
}

#[derive(Clone)]
pub struct AgenticWorkRuntimeBridge {
    coordinator: Arc<ConversationCoordinator>,
    scheduler: Arc<DialogScheduler>,
}

impl AgenticWorkRuntimeBridge {
    pub fn new(coordinator: Arc<ConversationCoordinator>, scheduler: Arc<DialogScheduler>) -> Self {
        Self {
            coordinator,
            scheduler,
        }
    }
}

#[async_trait]
impl WorkRuntimeBridge for AgenticWorkRuntimeBridge {
    async fn create_work_session(
        &self,
        request: CreateWorkSessionRequest,
    ) -> CoreResult<CreateWorkSessionOutcome> {
        let session = self
            .coordinator
            .create_session_with_workspace_and_creator(
                None,
                request.title,
                request.agent_type,
                SessionConfig {
                    workspace_path: Some(request.workspace_path.clone()),
                    ..Default::default()
                },
                request.workspace_path,
                Some(format!("work-{}", request.work_id.as_str())),
            )
            .await?;

        Ok(CreateWorkSessionOutcome {
            session_id: session.session_id,
            session_name: session.session_name,
            agent_type: session.agent_type,
        })
    }

    async fn advance_work_session(
        &self,
        request: WorkSessionAdvanceRequest,
    ) -> CoreResult<WorkSessionAdvanceOutcome> {
        if request.instructions.trim().is_empty() {
            return Err(CoreError::validation("instructions cannot be empty"));
        }

        let outcome = self
            .scheduler
            .submit(
                request.session_id.clone(),
                request.instructions.clone(),
                Some(request.instructions),
                None,
                request.agent_type,
                None,
                Some(request.workspace_path),
                DialogSubmissionPolicy::for_source(DialogTriggerSource::AgentSession),
                None,
                None,
            )
            .await
            .map_err(CoreError::tool)?;

        let (session_id, turn_id, started) = match outcome {
            DialogSubmitOutcome::Started {
                session_id,
                turn_id,
            } => (session_id, turn_id, true),
            DialogSubmitOutcome::Queued {
                session_id,
                turn_id,
            } => (session_id, turn_id, false),
        };

        Ok(WorkSessionAdvanceOutcome {
            session_id,
            turn_id,
            started,
        })
    }

    async fn cancel_work_session_run(&self, session_id: &str) -> CoreResult<()> {
        self.scheduler
            .cancel_active_turn_for_session(
                session_id,
                TurnCancellationReason::UserRequested,
                SessionControlActor::Tool,
                Duration::from_millis(500),
            )
            .await?;
        Ok(())
    }

    async fn clear_work_session_queue(&self, session_id: &str) -> CoreResult<()> {
        self.scheduler.clear_session_queue(session_id);
        Ok(())
    }

    async fn delete_work_session(&self, workspace_path: &str, session_id: &str) -> CoreResult<()> {
        self.clear_work_session_queue(session_id).await?;
        self.scheduler
            .cancel_active_turn_for_session(
                session_id,
                TurnCancellationReason::SessionDeleted,
                SessionControlActor::Tool,
                Duration::from_millis(500),
            )
            .await?;
        self.coordinator
            .delete_session(Path::new(workspace_path), session_id)
            .await?;
        Ok(())
    }
}
