//! Yield or guide dialog execution at model-round boundaries.
//!
//! The [`DialogRoundPreemptSource`] is implemented by [`DialogScheduler`](super::scheduler::DialogScheduler)
//! and read by [`ExecutionEngine`](super::execution::ExecutionEngine) after each completed model round.

use crate::agentic::image_analysis::ImageContextData;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct DialogTurnGuidance {
    pub guidance_id: String,
    pub target_turn_id: String,
    pub source_turn_id: String,
    pub user_input: String,
    pub original_user_input: Option<String>,
    pub image_contexts: Option<Vec<ImageContextData>>,
    pub received_at_ms: u64,
}

impl DialogTurnGuidance {
    pub fn image_count(&self) -> usize {
        self.image_contexts
            .as_ref()
            .map(|images| images.len())
            .unwrap_or(0)
    }
}

/// Observes whether the current dialog turn should end after the latest model round
/// (so a queued user message can start as a new turn).
pub trait DialogRoundPreemptSource: Send + Sync {
    fn should_yield_after_round(&self, session_id: &str) -> bool;
    fn clear_yield_after_round(&self, session_id: &str);
    fn take_guidance_after_round(
        &self,
        _session_id: &str,
        _turn_id: &str,
    ) -> Vec<DialogTurnGuidance> {
        Vec::new()
    }
}

/// Used when no scheduler is wired (e.g. tests, isolated execution).
pub struct NoopDialogRoundPreemptSource;

impl DialogRoundPreemptSource for NoopDialogRoundPreemptSource {
    fn should_yield_after_round(&self, _session_id: &str) -> bool {
        false
    }

    fn clear_yield_after_round(&self, _session_id: &str) {}
}

/// Shared flag storage keyed by session; scheduler sets, engine reads and clears.
#[derive(Debug, Default)]
pub struct SessionRoundYieldFlags {
    inner: dashmap::DashMap<String, Arc<AtomicBool>>,
    guidance: dashmap::DashMap<String, VecDeque<DialogTurnGuidance>>,
}

impl SessionRoundYieldFlags {
    pub fn request_yield(&self, session_id: &str) {
        self.inner
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(AtomicBool::new(false)))
            .store(true, Ordering::SeqCst);
    }

    pub fn should_yield(&self, session_id: &str) -> bool {
        self.inner
            .get(session_id)
            .map(|r| r.value().load(Ordering::SeqCst))
            .unwrap_or(false)
    }

    pub fn clear(&self, session_id: &str) {
        self.inner.remove(session_id);
    }

    pub fn push_guidance(&self, session_id: &str, guidance: DialogTurnGuidance) {
        self.guidance
            .entry(session_id.to_string())
            .or_default()
            .push_back(guidance);
    }

    pub fn take_guidance(&self, session_id: &str, turn_id: &str) -> Vec<DialogTurnGuidance> {
        let Some(mut pending) = self.guidance.get_mut(session_id) else {
            return Vec::new();
        };

        let mut retained = VecDeque::new();
        let mut matched = Vec::new();
        while let Some(guidance) = pending.pop_front() {
            if guidance.target_turn_id == turn_id {
                matched.push(guidance);
            } else {
                retained.push_back(guidance);
            }
        }
        *pending = retained;
        matched
    }
}

impl DialogRoundPreemptSource for SessionRoundYieldFlags {
    fn should_yield_after_round(&self, session_id: &str) -> bool {
        self.should_yield(session_id)
    }

    fn clear_yield_after_round(&self, session_id: &str) {
        self.clear(session_id);
    }

    fn take_guidance_after_round(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> Vec<DialogTurnGuidance> {
        self.take_guidance(session_id, turn_id)
    }
}
