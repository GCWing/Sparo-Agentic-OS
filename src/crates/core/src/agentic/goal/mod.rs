//! Session-level goal supervision.
//!
//! Goal mode is owned by a deterministic loop ([`GoalService`] + `goal_loop`).
//! After every owner turn the loop forks a tool-enabled judge that returns a
//! single verdict; the loop is the only component that completes, continues, or
//! escalates a goal. The agent-facing `Goal` tool is advisory only (read a
//! goal, drop a progress note, or report a blocker) and can never claim
//! completion.

pub mod extension;
pub mod extraction;
pub mod fork_message;
pub mod goal_loop;
pub mod instructions;
pub mod intake;
pub mod model;
pub mod output_parser;
pub mod service;
pub mod steering;
pub mod store;
pub mod validation;

use std::sync::{Arc, OnceLock};

pub use extension::GoalSessionExtension;
pub use extraction::{
    test_e2e_runner_enabled, CoordinatorGoalForkRunner, DeterministicGoalForkRunner,
    GoalExtractionRunOutput, GoalExtractionRunRequest, GoalForkRunner, GoalJudgeRunOutput,
    GoalJudgeRunRequest,
};
pub use model::*;
pub use service::GoalService;
pub use store::GoalStore;

static GLOBAL_GOAL_SERVICE: OnceLock<Arc<GoalService>> = OnceLock::new();

pub fn install_global_goal_service(service: Arc<GoalService>) -> Result<(), ()> {
    GLOBAL_GOAL_SERVICE.set(service).map_err(|_| ())
}

pub fn get_global_goal_service() -> Option<Arc<GoalService>> {
    GLOBAL_GOAL_SERVICE.get().cloned()
}
