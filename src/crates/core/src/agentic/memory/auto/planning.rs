use super::{AutoMemoryQueueAction, AutoMemoryScheduleDecision, AutoMemoryThrottlePolicy};
use crate::agentic::agents::get_agent_registry;
use crate::agentic::core::{Session, SessionKind, SessionState};
use crate::service::config::{get_global_config_service, types::AutoMemoryScopeConfig};
use crate::agentic::memory::store::{
    memory_store_dir_path_for_target, MemoryScope, MemoryStoreTarget,
};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoMemoryPostTurnAction {
    Skip,
    Schedule,
}

#[derive(Debug, Clone)]
pub struct ResolvedAutoMemoryContext {
    pub scope: MemoryScope,
    pub store_key: String,
}

#[derive(Debug, Clone)]
pub struct ResolvedAutoMemoryRuntimeContext {
    pub scope_config: AutoMemoryScopeConfig,
    pub policy: AutoMemoryThrottlePolicy,
}

pub fn decide_auto_memory_post_turn_action(
    session_kind: SessionKind,
    turn_wrote_memory: Option<bool>,
) -> AutoMemoryPostTurnAction {
    if matches!(session_kind, SessionKind::Subagent) {
        return AutoMemoryPostTurnAction::Skip;
    }

    match turn_wrote_memory {
        Some(true) => AutoMemoryPostTurnAction::Skip,
        Some(false) | None => AutoMemoryPostTurnAction::Schedule,
    }
}

pub fn resolve_auto_memory_scope(agent_type: &str, workspace_path: &Path) -> MemoryScope {
    get_agent_registry()
        .get_agent(agent_type, Some(workspace_path))
        .map(|agent| agent.memory_scope())
        .unwrap_or(MemoryScope::WorkspaceProject)
}

pub fn resolve_session_auto_memory_scope(session: &Session) -> Option<MemoryScope> {
    session
        .config
        .workspace_path
        .as_deref()
        .map(|path| resolve_auto_memory_scope(&session.agent_type, Path::new(path)))
}

pub fn auto_memory_scope_config(
    config: &crate::service::config::types::AutoMemoryConfig,
    scope: MemoryScope,
) -> &AutoMemoryScopeConfig {
    match scope {
        MemoryScope::WorkspaceProject => &config.workspace,
        MemoryScope::GlobalAgenticOs => &config.global,
    }
}

pub fn auto_memory_throttle_policy(
    scope_config: &AutoMemoryScopeConfig,
) -> AutoMemoryThrottlePolicy {
    AutoMemoryThrottlePolicy::new(
        scope_config.extract_every_eligible_turns as usize,
        scope_config.min_extract_interval_secs,
        scope_config
            .force_extract_after_pending_eligible_turns
            .map(|value| value as usize),
    )
}

fn build_auto_memory_store_key(target: MemoryStoreTarget<'_>) -> String {
    memory_store_dir_path_for_target(target)
        .to_string_lossy()
        .replace('\\', "/")
}

pub fn session_can_consider_auto_memory(session: &Session) -> bool {
    !matches!(session.kind, SessionKind::Subagent)
        && !matches!(session.state, SessionState::Processing { .. })
}

pub fn resolve_local_auto_memory_context(session: &Session) -> Option<ResolvedAutoMemoryContext> {
    let scope = resolve_session_auto_memory_scope(session)?;
    let workspace_path = Path::new(session.config.workspace_path.as_deref()?);
    let target = match scope {
        MemoryScope::WorkspaceProject => MemoryStoreTarget::WorkspaceProject(workspace_path),
        MemoryScope::GlobalAgenticOs => MemoryStoreTarget::GlobalAgenticOs,
    };

    Some(ResolvedAutoMemoryContext {
        scope,
        store_key: build_auto_memory_store_key(target),
    })
}

pub fn queue_action_from_schedule_decision(
    decision: AutoMemoryScheduleDecision,
) -> AutoMemoryQueueAction {
    match decision {
        AutoMemoryScheduleDecision::ReadyNow { .. } => AutoMemoryQueueAction::QueueNow,
        AutoMemoryScheduleDecision::CoolingDown { ready_at_ms } => {
            AutoMemoryQueueAction::QueueAt { ready_at_ms }
        }
        AutoMemoryScheduleDecision::NotReadyByEligibleTurns => AutoMemoryQueueAction::Skip,
    }
}

pub async fn auto_memory_runtime_config() -> crate::service::config::types::AutoMemoryConfig {
    if let Ok(config_service) = get_global_config_service().await {
        match config_service
            .get_config::<crate::service::config::types::AutoMemoryConfig>(Some("ai.auto_memory"))
            .await
        {
            Ok(config) => return config,
            Err(_) => return crate::service::config::types::AutoMemoryConfig::default(),
        }
    }

    crate::service::config::types::AutoMemoryConfig::default()
}

pub async fn auto_memory_scope_runtime_config(scope: MemoryScope) -> AutoMemoryScopeConfig {
    let config = auto_memory_runtime_config().await;
    auto_memory_scope_config(&config, scope).clone()
}

pub async fn resolve_auto_memory_runtime_context(
    session: &Session,
) -> Option<ResolvedAutoMemoryRuntimeContext> {
    let resolved_context = resolve_local_auto_memory_context(session)?;
    let scope_config = auto_memory_scope_runtime_config(resolved_context.scope).await;
    let policy = auto_memory_throttle_policy(&scope_config);

    Some(ResolvedAutoMemoryRuntimeContext {
        scope_config,
        policy,
    })
}

#[cfg(test)]
mod tests {
    use super::{decide_auto_memory_post_turn_action, AutoMemoryPostTurnAction};
    use crate::agentic::core::SessionKind;

    #[test]
    fn auto_memory_post_turn_skips_for_subagent_sessions() {
        assert_eq!(
            decide_auto_memory_post_turn_action(SessionKind::Subagent, Some(false)),
            AutoMemoryPostTurnAction::Skip
        );
        assert_eq!(
            decide_auto_memory_post_turn_action(SessionKind::Subagent, Some(true)),
            AutoMemoryPostTurnAction::Skip
        );
        assert_eq!(
            decide_auto_memory_post_turn_action(SessionKind::Subagent, None),
            AutoMemoryPostTurnAction::Skip
        );
    }

    #[test]
    fn auto_memory_post_turn_skips_when_main_turn_already_wrote_memory() {
        assert_eq!(
            decide_auto_memory_post_turn_action(SessionKind::Standard, Some(true)),
            AutoMemoryPostTurnAction::Skip
        );
    }

    #[test]
    fn auto_memory_post_turn_schedules_when_main_turn_did_not_write_memory() {
        assert_eq!(
            decide_auto_memory_post_turn_action(SessionKind::Standard, Some(false)),
            AutoMemoryPostTurnAction::Schedule
        );
    }

    #[test]
    fn auto_memory_post_turn_schedules_when_memory_write_detection_fails() {
        assert_eq!(
            decide_auto_memory_post_turn_action(SessionKind::Standard, None),
            AutoMemoryPostTurnAction::Schedule
        );
    }
}
