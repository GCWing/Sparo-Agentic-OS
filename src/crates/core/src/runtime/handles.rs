//! Strongly-typed handle bundles passed through tool contexts and the
//! desktop application state.
//!
//! These bundles replace the previous `get_global_*()` accessors. Every
//! consumer that used to reach for a global now receives the exact handle
//! it needs through dependency injection — either constructor injection (for
//! long-lived services that bind once at boot) or per-call injection via
//! [`ToolUseContext`](crate::agentic::tools::ToolUseContext) (for tools that
//! are constructed once but executed many times across different sessions).

use crate::agentic::coordination::{ConversationCoordinator, DialogScheduler};
use crate::service::cron::CronService;
use crate::service::host::HostAutoScanService;
use std::sync::Arc;

/// Handles to the process-wide agentic stack.
///
/// Each handle is an `Arc` because:
///   * the stack outlives every individual call site,
///   * tools execute on `tokio` worker threads that take ownership of their
///     context for the duration of the call, and
///   * cloning an `Arc` is essentially free.
///
/// The bundle itself is `Clone` so it can be cheaply embedded in
/// [`ToolUseContext`](crate::agentic::tools::ToolUseContext) and the
/// per-workspace runtime structures.
#[derive(Clone)]
pub struct AgenticHandles {
    pub coordinator: Arc<ConversationCoordinator>,
    pub scheduler: Arc<DialogScheduler>,
    pub cron_service: Arc<CronService>,
    pub host_auto_scan: Arc<HostAutoScanService>,
}

impl std::fmt::Debug for AgenticHandles {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgenticHandles").finish_non_exhaustive()
    }
}
