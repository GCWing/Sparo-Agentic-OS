use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AutoMemoryState {
    #[serde(default)]
    pub next_unextracted_turn: usize,
    #[serde(default)]
    pub history_revision: u64,
    #[serde(default)]
    pub pending_eligible_turns: usize,
    #[serde(default)]
    pub last_memory_consumed_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AutoMemoryThrottlePolicy {
    pub extract_every_eligible_turns: usize,
    pub min_extract_interval_secs: u64,
    pub force_extract_after_pending_eligible_turns: Option<usize>,
}

impl AutoMemoryThrottlePolicy {
    pub fn new(
        extract_every_eligible_turns: usize,
        min_extract_interval_secs: u64,
        force_extract_after_pending_eligible_turns: Option<usize>,
    ) -> Self {
        Self {
            extract_every_eligible_turns: extract_every_eligible_turns.max(1),
            min_extract_interval_secs,
            force_extract_after_pending_eligible_turns,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoMemoryReadyReason {
    ThresholdReached,
    CooldownExpired,
    CooldownBypassedByPendingEligibleTurns,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoMemoryScheduleDecision {
    NotReadyByEligibleTurns,
    CoolingDown { ready_at_ms: i64 },
    ReadyNow { reason: AutoMemoryReadyReason },
}

impl AutoMemoryScheduleDecision {
    pub const fn ready_at_ms(self) -> Option<i64> {
        match self {
            Self::CoolingDown { ready_at_ms } => Some(ready_at_ms),
            Self::NotReadyByEligibleTurns | Self::ReadyNow { .. } => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoMemoryQueueAction {
    Skip,
    QueueNow,
    QueueAt { ready_at_ms: i64 },
}

impl AutoMemoryState {
    pub fn normalize_for_turn_count(&mut self, turn_count: usize) {
        self.next_unextracted_turn = self.next_unextracted_turn.min(turn_count);
    }

    pub fn has_pending_turns(&self, turn_count: usize) -> bool {
        self.next_unextracted_turn < turn_count
    }

    pub fn note_history_rollback(&mut self, target_turn: usize) {
        self.next_unextracted_turn = self.next_unextracted_turn.min(target_turn);
        self.history_revision = self.history_revision.saturating_add(1);
        self.pending_eligible_turns = 0;
    }

    pub fn mark_extracted_through(
        &mut self,
        through_turn: usize,
        turn_count: usize,
        consumed_at_ms: i64,
    ) {
        self.next_unextracted_turn = through_turn.saturating_add(1).min(turn_count);
        self.pending_eligible_turns = 0;
        self.last_memory_consumed_at_ms = Some(consumed_at_ms);
    }

    pub fn note_eligible_turn_and_schedule_decision(
        &mut self,
        policy: AutoMemoryThrottlePolicy,
        now_ms: i64,
    ) -> AutoMemoryScheduleDecision {
        self.pending_eligible_turns = self.pending_eligible_turns.saturating_add(1);
        self.schedule_decision(policy, now_ms)
    }

    pub fn schedule_decision(
        &self,
        policy: AutoMemoryThrottlePolicy,
        now_ms: i64,
    ) -> AutoMemoryScheduleDecision {
        if self.pending_eligible_turns < policy.extract_every_eligible_turns {
            return AutoMemoryScheduleDecision::NotReadyByEligibleTurns;
        }

        let Some(ready_at_ms) = self.next_ready_at_ms(policy.min_extract_interval_secs) else {
            return AutoMemoryScheduleDecision::ReadyNow {
                reason: AutoMemoryReadyReason::ThresholdReached,
            };
        };

        if now_ms >= ready_at_ms {
            return AutoMemoryScheduleDecision::ReadyNow {
                reason: AutoMemoryReadyReason::CooldownExpired,
            };
        }

        if let Some(force_extract_threshold) = policy.force_extract_after_pending_eligible_turns {
            if self.pending_eligible_turns >= force_extract_threshold {
                return AutoMemoryScheduleDecision::ReadyNow {
                    reason: AutoMemoryReadyReason::CooldownBypassedByPendingEligibleTurns,
                };
            }
        }

        AutoMemoryScheduleDecision::CoolingDown { ready_at_ms }
    }

    pub fn next_ready_at_ms(&self, min_extract_interval_secs: u64) -> Option<i64> {
        if min_extract_interval_secs == 0 {
            return None;
        }

        let interval_ms = min_extract_interval_secs
            .saturating_mul(1000)
            .min(i64::MAX as u64) as i64;
        self.last_memory_consumed_at_ms
            .map(|last_consumed_at_ms| last_consumed_at_ms.saturating_add(interval_ms))
    }
}

#[derive(Debug, Clone)]
pub struct AutoMemoryExtractionCursor {
    pub from_turn: usize,
    pub through_turn: usize,
    pub history_revision: u64,
}

#[cfg(test)]
mod tests {
    use super::{
        AutoMemoryReadyReason, AutoMemoryScheduleDecision, AutoMemoryState,
        AutoMemoryThrottlePolicy,
    };

    #[test]
    fn schedule_decision_bypasses_cooldown_when_pending_backlog_reaches_force_threshold() {
        let state = AutoMemoryState {
            pending_eligible_turns: 6,
            last_memory_consumed_at_ms: Some(1_000),
            ..AutoMemoryState::default()
        };

        let decision =
            state.schedule_decision(AutoMemoryThrottlePolicy::new(2, 60, Some(6)), 30_000);

        assert_eq!(
            decision,
            AutoMemoryScheduleDecision::ReadyNow {
                reason: AutoMemoryReadyReason::CooldownBypassedByPendingEligibleTurns,
            }
        );
    }

    #[test]
    fn schedule_decision_keeps_cooling_down_when_pending_backlog_is_below_force_threshold() {
        let state = AutoMemoryState {
            pending_eligible_turns: 5,
            last_memory_consumed_at_ms: Some(1_000),
            ..AutoMemoryState::default()
        };

        let decision =
            state.schedule_decision(AutoMemoryThrottlePolicy::new(2, 60, Some(6)), 30_000);

        assert_eq!(
            decision,
            AutoMemoryScheduleDecision::CoolingDown {
                ready_at_ms: 61_000
            }
        );
    }
}
