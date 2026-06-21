//! Turn outcome model shared across coordination components.

use std::fmt;

/// Outcome of a completed dialog turn, used to notify `DialogScheduler`.
#[derive(Debug, Clone)]
pub enum TurnOutcome {
    /// Turn completed normally.
    Completed {
        turn_id: String,
        final_response: String,
    },
    /// Turn was cancelled before producing a final answer.
    Cancelled {
        turn_id: String,
        reason: TurnCancellationReason,
        actor: SessionControlActor,
    },
    /// Turn failed with an error.
    Failed { turn_id: String, error: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnCancellationReason {
    UserRequested,
    GoalControl,
    SessionDeleted,
    Superseded,
    SystemShutdown,
    Unknown,
}

impl TurnCancellationReason {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::UserRequested => "user_requested",
            Self::GoalControl => "goal_control",
            Self::SessionDeleted => "session_deleted",
            Self::Superseded => "superseded",
            Self::SystemShutdown => "system_shutdown",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionControlActor {
    User,
    Goal,
    System,
    AgentSession,
    Tool,
}

impl SessionControlActor {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Goal => "goal",
            Self::System => "system",
            Self::AgentSession => "agent_session",
            Self::Tool => "tool",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnOutcomeQueueAction {
    DispatchNext,
    PauseQueue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnOutcomeStatus {
    Completed,
    Cancelled,
    Failed,
}

impl TurnOutcomeStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::Failed => "failed",
        }
    }
}

impl fmt::Display for TurnOutcomeStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl TurnOutcome {
    pub fn turn_id(&self) -> &str {
        match self {
            Self::Completed { turn_id, .. }
            | Self::Cancelled { turn_id, .. }
            | Self::Failed { turn_id, .. } => turn_id,
        }
    }

    pub fn status(&self) -> TurnOutcomeStatus {
        match self {
            Self::Completed { .. } => TurnOutcomeStatus::Completed,
            Self::Cancelled { .. } => TurnOutcomeStatus::Cancelled,
            Self::Failed { .. } => TurnOutcomeStatus::Failed,
        }
    }

    pub fn status_str(&self) -> &'static str {
        self.status().as_str()
    }

    pub fn reply_text(&self) -> String {
        match self {
            Self::Completed { final_response, .. } => {
                if final_response.trim().is_empty() {
                    "(no final text response)".to_string()
                } else {
                    final_response.clone()
                }
            }
            Self::Cancelled { .. } => {
                "The target session cancelled this request before producing a final answer."
                    .to_string()
            }
            Self::Failed { error, .. } => {
                format!("The target session failed to complete this request.\nError: {error}")
            }
        }
    }

    pub fn queue_action(&self) -> TurnOutcomeQueueAction {
        match self {
            Self::Completed { .. } => TurnOutcomeQueueAction::DispatchNext,
            Self::Failed { .. } => TurnOutcomeQueueAction::PauseQueue,
            Self::Cancelled { reason, .. } => match reason {
                TurnCancellationReason::UserRequested | TurnCancellationReason::Unknown => {
                    TurnOutcomeQueueAction::PauseQueue
                }
                TurnCancellationReason::GoalControl
                | TurnCancellationReason::SessionDeleted
                | TurnCancellationReason::Superseded
                | TurnCancellationReason::SystemShutdown => TurnOutcomeQueueAction::DispatchNext,
            },
        }
    }
}
