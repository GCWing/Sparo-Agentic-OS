use super::{
    auto_memory_scope_runtime_config, auto_memory_throttle_policy,
    decide_auto_memory_post_turn_action, queue_action_from_schedule_decision,
    AutoMemoryPostTurnAction, AutoMemoryQueueAction, AutoMemoryScheduleDecision,
    AutoMemoryThrottlePolicy, ResolvedAutoMemoryContext,
};
use crate::agentic::core::SessionKind;
use crate::agentic::memory::store::MemoryScope;
use crate::agentic::session::SessionManager;
use log::{debug, warn};

#[derive(Debug, Clone)]
pub struct AutoMemoryCompletedTurnFollowup {
    pub store_key: String,
    pub queue_action: AutoMemoryQueueAction,
}

async fn inspect_turn_wrote_auto_memory(
    session_manager: &SessionManager,
    session_id: &str,
    turn_id: &str,
    session_kind: SessionKind,
    auto_memory_context: Option<&ResolvedAutoMemoryContext>,
) -> Option<bool> {
    if !matches!(session_kind, SessionKind::Standard) {
        return None;
    }

    let auto_memory_context = auto_memory_context?;
    match session_manager
        .turn_wrote_memory_for_scope(session_id, turn_id, auto_memory_context.scope)
        .await
    {
        Ok(wrote_memory) => Some(wrote_memory),
        Err(error) => {
            warn!(
                "Failed to inspect turn for direct memory writes; scheduling auto memory anyway: session_id={}, turn_id={}, scope={}, error={}",
                session_id,
                turn_id,
                auto_memory_context.scope.as_label(),
                error
            );
            None
        }
    }
}

async fn mark_auto_memory_consumed_after_direct_write(
    session_manager: &SessionManager,
    session_id: &str,
    turn_id: &str,
    auto_memory_scope: Option<MemoryScope>,
    consumed_at_ms: i64,
) {
    debug!(
        "Skipping auto memory extractor because the completed turn already updated memory files: session_id={}, turn_id={}, scope={}",
        session_id,
        turn_id,
        auto_memory_scope
            .unwrap_or(MemoryScope::WorkspaceProject)
            .as_label()
    );
    match session_manager
        .mark_auto_memory_consumed_through_turn(session_id, turn_id, consumed_at_ms)
        .await
    {
        Ok(true) => {}
        Ok(false) => {}
        Err(error) => {
            warn!(
                "Failed to advance auto memory cursor after direct memory write: session_id={}, turn_id={}, error={}",
                session_id, turn_id, error
            );
        }
    }
}

fn log_auto_memory_post_turn_schedule_decision(
    session_id: &str,
    turn_id: &str,
    scope: MemoryScope,
    scope_enabled: bool,
    policy: AutoMemoryThrottlePolicy,
    schedule_decision: AutoMemoryScheduleDecision,
) {
    match schedule_decision {
        AutoMemoryScheduleDecision::ReadyNow { reason } => {
            if !scope_enabled {
                debug!(
                    "Auto memory is disabled for scope; extraction is ready but will stay pending: session_id={}, turn_id={}, scope={}, extract_every_eligible_turns={}, min_extract_interval_secs={}, force_extract_after_pending_eligible_turns={:?}, ready_reason={:?}",
                    session_id,
                    turn_id,
                    scope.as_label(),
                    policy.extract_every_eligible_turns,
                    policy.min_extract_interval_secs,
                    policy.force_extract_after_pending_eligible_turns,
                    reason
                );
            } else {
                debug!(
                    "Auto memory extraction is ready; queueing now: session_id={}, turn_id={}, scope={}, extract_every_eligible_turns={}, min_extract_interval_secs={}, force_extract_after_pending_eligible_turns={:?}, ready_reason={:?}",
                    session_id,
                    turn_id,
                    scope.as_label(),
                    policy.extract_every_eligible_turns,
                    policy.min_extract_interval_secs,
                    policy.force_extract_after_pending_eligible_turns,
                    reason
                );
            }
        }
        AutoMemoryScheduleDecision::WaitingForIdle { ready_at_ms } => {
            if !scope_enabled {
                debug!(
                    "Recorded auto memory eligible turn while auto memory is disabled for scope: session_id={}, turn_id={}, scope={}, extract_every_eligible_turns={}, min_extract_interval_secs={}, force_extract_after_pending_eligible_turns={:?}, idle_ready_at_ms={}",
                    session_id,
                    turn_id,
                    scope.as_label(),
                    policy.extract_every_eligible_turns,
                    policy.min_extract_interval_secs,
                    policy.force_extract_after_pending_eligible_turns,
                    ready_at_ms
                );
            } else {
                debug!(
                    "Deferred auto memory extraction until the session has been idle long enough: session_id={}, turn_id={}, scope={}, extract_every_eligible_turns={}, min_extract_interval_secs={}, force_extract_after_pending_eligible_turns={:?}, idle_ready_at_ms={}",
                    session_id,
                    turn_id,
                    scope.as_label(),
                    policy.extract_every_eligible_turns,
                    policy.min_extract_interval_secs,
                    policy.force_extract_after_pending_eligible_turns,
                    ready_at_ms
                );
            }
        }
        AutoMemoryScheduleDecision::CoolingDown { ready_at_ms } => {
            if !scope_enabled {
                debug!(
                    "Recorded auto memory eligible turn while auto memory is disabled for scope: session_id={}, turn_id={}, scope={}, extract_every_eligible_turns={}, min_extract_interval_secs={}, force_extract_after_pending_eligible_turns={:?}, ready_at_ms={}",
                    session_id,
                    turn_id,
                    scope.as_label(),
                    policy.extract_every_eligible_turns,
                    policy.min_extract_interval_secs,
                    policy.force_extract_after_pending_eligible_turns,
                    ready_at_ms
                );
            } else {
                debug!(
                    "Eligible-turn threshold reached but auto memory is cooling down: session_id={}, turn_id={}, scope={}, extract_every_eligible_turns={}, min_extract_interval_secs={}, force_extract_after_pending_eligible_turns={:?}, ready_at_ms={}",
                    session_id,
                    turn_id,
                    scope.as_label(),
                    policy.extract_every_eligible_turns,
                    policy.min_extract_interval_secs,
                    policy.force_extract_after_pending_eligible_turns,
                    ready_at_ms
                );
            }
        }
        AutoMemoryScheduleDecision::NotReadyByEligibleTurns => {
            if !scope_enabled {
                debug!(
                    "Recorded auto memory eligible turn while auto memory is disabled for scope: session_id={}, turn_id={}, scope={}, extract_every_eligible_turns={}, min_extract_interval_secs={}, force_extract_after_pending_eligible_turns={:?}",
                    session_id,
                    turn_id,
                    scope.as_label(),
                    policy.extract_every_eligible_turns,
                    policy.min_extract_interval_secs,
                    policy.force_extract_after_pending_eligible_turns
                );
            } else {
                debug!(
                    "Deferred auto memory extraction until the eligible-turn threshold is reached: session_id={}, turn_id={}, scope={}, extract_every_eligible_turns={}, min_extract_interval_secs={}, force_extract_after_pending_eligible_turns={:?}",
                    session_id,
                    turn_id,
                    scope.as_label(),
                    policy.extract_every_eligible_turns,
                    policy.min_extract_interval_secs,
                    policy.force_extract_after_pending_eligible_turns
                );
            }
        }
    }
}

async fn note_auto_memory_eligible_turn_after_completed_turn(
    session_manager: &SessionManager,
    session_id: &str,
    turn_id: &str,
    auto_memory_context: ResolvedAutoMemoryContext,
    now_ms: i64,
) -> Option<AutoMemoryCompletedTurnFollowup> {
    let scope_config = match auto_memory_scope_runtime_config(auto_memory_context.scope).await {
        Ok(config) => config,
        Err(error) => {
            warn!(
                "Skipping auto memory eligible-turn tracking because runtime config is unavailable: session_id={}, turn_id={}, scope={}, error={}",
                session_id,
                turn_id,
                auto_memory_context.scope.as_label(),
                error
            );
            return None;
        }
    };
    let policy = auto_memory_throttle_policy(&scope_config);
    match session_manager
        .note_auto_memory_eligible_turn(session_id, policy, now_ms)
        .await
    {
        Ok(schedule_decision) => {
            log_auto_memory_post_turn_schedule_decision(
                session_id,
                turn_id,
                auto_memory_context.scope,
                scope_config.enabled,
                policy,
                schedule_decision,
            );

            if !scope_config.enabled {
                return None;
            }

            let queue_action = queue_action_from_schedule_decision(schedule_decision);
            if matches!(queue_action, AutoMemoryQueueAction::Skip) {
                return None;
            }

            Some(AutoMemoryCompletedTurnFollowup {
                store_key: auto_memory_context.store_key,
                queue_action,
            })
        }
        Err(error) => {
            if !scope_config.enabled {
                warn!(
                    "Failed to record auto memory eligible turn while auto memory is disabled for scope: session_id={}, turn_id={}, scope={}, error={}",
                    session_id,
                    turn_id,
                    auto_memory_context.scope.as_label(),
                    error
                );
                return None;
            }

            warn!(
                "Failed to update auto memory eligible-turn throttle; scheduling immediately: session_id={}, turn_id={}, scope={}, error={}",
                session_id,
                turn_id,
                auto_memory_context.scope.as_label(),
                error
            );
            Some(AutoMemoryCompletedTurnFollowup {
                store_key: auto_memory_context.store_key,
                queue_action: AutoMemoryQueueAction::QueueNow,
            })
        }
    }
}

pub async fn handle_auto_memory_after_completed_turn(
    session_manager: &SessionManager,
    session_id: &str,
    turn_id: &str,
    session_kind: SessionKind,
    auto_memory_context: Option<ResolvedAutoMemoryContext>,
    now_ms: i64,
) -> Option<AutoMemoryCompletedTurnFollowup> {
    let turn_wrote_memory = inspect_turn_wrote_auto_memory(
        session_manager,
        session_id,
        turn_id,
        session_kind,
        auto_memory_context.as_ref(),
    )
    .await;

    match decide_auto_memory_post_turn_action(session_kind, turn_wrote_memory) {
        AutoMemoryPostTurnAction::Skip => {
            if matches!(turn_wrote_memory, Some(true)) {
                mark_auto_memory_consumed_after_direct_write(
                    session_manager,
                    session_id,
                    turn_id,
                    auto_memory_context.as_ref().map(|context| context.scope),
                    now_ms,
                )
                .await;
            }

            None
        }
        AutoMemoryPostTurnAction::Schedule => {
            let Some(auto_memory_context) = auto_memory_context else {
                debug!(
                    "Skipping auto memory eligible-turn tracking because no local workspace key is available: session_id={}, turn_id={}",
                    session_id, turn_id
                );
                return None;
            };

            note_auto_memory_eligible_turn_after_completed_turn(
                session_manager,
                session_id,
                turn_id,
                auto_memory_context,
                now_ms,
            )
            .await
        }
    }
}
