use super::state::SessionState;
use crate::agentic::memory::AutoMemoryState;
use crate::error::{CoreError, CoreResult};
use serde::{Deserialize, Serialize};
use std::time::SystemTime;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SessionKind {
    #[default]
    Standard,
    Subagent,
    /// Durable implementation-owned session that is never exposed in user session lists.
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionDomain {
    OsAgent,
    Global,
    Workspace { workspace_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionLocator {
    pub domain: SessionDomain,
    pub session_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProductAppSessionRole {
    SurfaceChat,
    BackendInternal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProductAppSessionChannel {
    pub channel_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionOwner {
    OsAgent,
    WorkspaceAgent {
        workspace_id: String,
    },
    ProductApp {
        app_id: String,
        work_id: String,
        channel: ProductAppSessionChannel,
        role: ProductAppSessionRole,
    },
    NativeApp {
        app_id: String,
    },
    SystemService {
        service_id: String,
    },
}

// ============ Session ============

/// Session: contains multiple dialog turns
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub session_id: String,
    pub session_name: String,
    pub agent_type: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "created_by",
        alias = "createdBy"
    )]
    pub created_by: Option<String>,
    #[serde(default, alias = "session_kind", alias = "sessionKind")]
    pub kind: SessionKind,

    /// Associated resources
    #[serde(
        skip_serializing_if = "Option::is_none",
        alias = "sandbox_session_id",
        alias = "sandboxSessionId"
    )]
    pub snapshot_session_id: Option<String>,

    /// Dialog turn ID list
    pub dialog_turn_ids: Vec<String>,

    /// Session state
    pub state: SessionState,

    /// Configuration
    pub config: SessionConfig,

    /// Context compression related
    pub compression_state: CompressionState,

    /// Durable auto-memory extraction progress
    pub auto_memory_state: AutoMemoryState,

    /// Lifecycle
    pub created_at: SystemTime,
    pub updated_at: SystemTime,
    pub last_activity_at: SystemTime,
}

/// Context compression state
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CompressionState {
    /// Time of last compression
    pub last_compression_at: Option<SystemTime>,
    /// Compression trigger count
    pub compression_count: usize,
}

impl CompressionState {
    pub fn increment_compression_count(&mut self) {
        self.last_compression_at = Some(SystemTime::now());
        self.compression_count += 1;
    }
}

impl Session {
    pub fn new(session_name: String, agent_type: String, config: SessionConfig) -> Self {
        let now = SystemTime::now();
        Self {
            session_id: Uuid::new_v4().to_string(),
            session_name,
            agent_type,
            created_by: None,
            kind: SessionKind::Standard,
            snapshot_session_id: None,
            dialog_turn_ids: vec![],
            state: SessionState::Idle,
            config,
            compression_state: CompressionState::default(),
            auto_memory_state: AutoMemoryState::default(),
            created_at: now,
            updated_at: now,
            last_activity_at: now,
        }
    }

    pub fn new_with_id(
        session_id: String,
        session_name: String,
        agent_type: String,
        config: SessionConfig,
    ) -> Self {
        let now = SystemTime::now();
        Self {
            session_id,
            session_name,
            agent_type,
            created_by: None,
            kind: SessionKind::Standard,
            snapshot_session_id: None,
            dialog_turn_ids: vec![],
            state: SessionState::Idle,
            config,
            compression_state: CompressionState::default(),
            auto_memory_state: AutoMemoryState::default(),
            created_at: now,
            updated_at: now,
            last_activity_at: now,
        }
    }
}

/// Durable session intent for resolving the usable context window.
///
/// Model capability remains authoritative. Sessions follow the selected model by
/// default and only persist a cap when the caller explicitly requests one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum SessionContextPolicy {
    #[default]
    FollowModel,
    ExplicitCap {
        max_tokens: usize,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedContextWindow {
    pub model_context_window: usize,
    pub effective_context_window: usize,
    pub policy: SessionContextPolicy,
}

impl SessionContextPolicy {
    pub fn resolve(&self, model_context_window: usize) -> CoreResult<ResolvedContextWindow> {
        if model_context_window == 0 {
            return Err(CoreError::Configuration(
                "Model context window must be greater than zero".to_string(),
            ));
        }

        let effective_context_window = match self {
            Self::FollowModel => model_context_window,
            Self::ExplicitCap { max_tokens } => {
                if *max_tokens == 0 {
                    return Err(CoreError::Validation(
                        "Session context cap must be greater than zero".to_string(),
                    ));
                }
                model_context_window.min(*max_tokens)
            }
        };

        Ok(ResolvedContextWindow {
            model_context_window,
            effective_context_window,
            policy: self.clone(),
        })
    }
}

/// Session configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionConfig {
    /// Required physical persistence domain. It is independent from the
    /// workspace path used as the execution context.
    pub domain: SessionDomain,
    #[serde(default)]
    pub context_policy: SessionContextPolicy,
    pub auto_compact: bool,
    pub enable_tools: bool,
    pub safe_mode: bool,
    pub max_turns: usize,
    pub enable_context_compression: bool,
    /// Compression threshold (token usage rate), compression triggered when exceeded
    pub compression_threshold: f32,
    /// Workspace path bound to this session. Used to run AI in the correct workspace
    /// without changing the desktop's foreground workspace.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    /// Model config ID used by this session (for token usage tracking)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
}

impl SessionConfig {
    pub fn new(domain: SessionDomain) -> Self {
        Self {
            domain,
            context_policy: SessionContextPolicy::FollowModel,
            auto_compact: true,
            enable_tools: true,
            safe_mode: true,
            max_turns: 200,
            enable_context_compression: true,
            compression_threshold: 0.8, // 80%
            workspace_path: None,
            model_id: None,
        }
    }
}

#[cfg(test)]
mod context_policy_tests {
    use super::*;

    #[test]
    fn follow_model_uses_the_full_model_capability() {
        let resolved = SessionContextPolicy::FollowModel
            .resolve(1_000_000)
            .unwrap();

        assert_eq!(resolved.model_context_window, 1_000_000);
        assert_eq!(resolved.effective_context_window, 1_000_000);
    }

    #[test]
    fn explicit_cap_never_exceeds_the_model_capability() {
        let lower_cap = SessionContextPolicy::ExplicitCap { max_tokens: 64_000 }
            .resolve(1_000_000)
            .unwrap();
        let higher_cap = SessionContextPolicy::ExplicitCap {
            max_tokens: 2_000_000,
        }
        .resolve(1_000_000)
        .unwrap();

        assert_eq!(lower_cap.effective_context_window, 64_000);
        assert_eq!(higher_cap.effective_context_window, 1_000_000);
    }

    #[test]
    fn derived_max_context_tokens_is_not_persisted() {
        let config: SessionConfig = serde_json::from_value(serde_json::json!({
            "domain": { "kind": "global" },
            "max_context_tokens": 128128,
            "auto_compact": true,
            "enable_tools": true,
            "safe_mode": true,
            "max_turns": 200,
            "enable_context_compression": true,
            "compression_threshold": 0.8,
            "workspace_path": null,
            "model_id": "primary"
        }))
        .unwrap();

        assert_eq!(config.context_policy, SessionContextPolicy::FollowModel);
        let serialized = serde_json::to_value(config).unwrap();
        assert!(serialized.get("max_context_tokens").is_none());
    }

    #[test]
    fn zero_values_are_rejected_instead_of_silently_falling_back() {
        assert!(SessionContextPolicy::FollowModel.resolve(0).is_err());
        assert!(SessionContextPolicy::ExplicitCap { max_tokens: 0 }
            .resolve(1_000_000)
            .is_err());
    }

    #[test]
    fn session_config_rejects_missing_domain() {
        let result = serde_json::from_value::<SessionConfig>(serde_json::json!({
            "auto_compact": true,
            "enable_tools": true,
            "safe_mode": true,
            "max_turns": 200,
            "enable_context_compression": true,
            "compression_threshold": 0.8
        }));

        assert!(result.is_err());
    }
}

/// Session summary (for list display)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    pub session_id: String,
    pub session_name: String,
    pub agent_type: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "created_by",
        alias = "createdBy"
    )]
    pub created_by: Option<String>,
    #[serde(default, alias = "session_kind", alias = "sessionKind")]
    pub kind: SessionKind,
    pub turn_count: usize,
    pub created_at: SystemTime,
    pub last_activity_at: SystemTime,
    pub state: SessionState,
}
