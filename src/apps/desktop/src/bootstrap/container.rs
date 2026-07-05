//! AppContainer — DI root for the desktop process.
//!
//! Holds:
//!   * process-wide globals constructed in Stage-C (config / i18n / AI factory /
//!     event bus / transport),
//!   * the workspace-scoped `AppState` (constructed in Stage-D), held inside an
//!     `ArcSwapOption` so a future workspace switch can replace it atomically
//!     without restarting the process,
//!   * the boot controller used to drive splash UI.
//!
//! Existing `#[tauri::command]` handlers continue to take `State<'_, AppState>`
//! after Stage-D populates it; new code should depend on `State<Arc<AppContainer>>`
//! instead.

use arc_swap::{ArcSwap, ArcSwapOption};
use sparo_transport::TauriTransportAdapter;
use std::sync::Arc;

use super::boot::BootController;
use crate::api::app_state::AppState;

/// Top-level DI container managed by Tauri as `State<Arc<AppContainer>>`.
pub struct AppContainer {
    pub boot: Arc<BootController>,
    pub transport: ArcSwapOption<TauriTransportAdapter>,
    pub app_state: ArcSwapOption<AppState>,
    /// `coordinator` and `scheduler` live here so non-AppState callers (tray
    /// menu, event subscribers) don't have to round-trip through Tauri State.
    pub coordinator: ArcSwapOption<sparo_core::agentic::coordination::ConversationCoordinator>,
    pub scheduler: ArcSwapOption<sparo_core::agentic::coordination::DialogScheduler>,
    /// Cached startup log level so the runtime listener can recompute on
    /// `ConfigReloaded` without re-reading the file from disk.
    pub startup_log_level: ArcSwap<log::LevelFilter>,
    /// Multi-workspace mount registry. Kept alive for the entire process
    /// lifetime; mounts come and go as the user opens/closes workspaces.
    workspace_registry: Arc<sparo_core::runtime::WorkspaceRegistry>,
}

impl AppContainer {
    pub fn new(boot: Arc<BootController>) -> Arc<Self> {
        Arc::new(Self {
            boot,
            transport: ArcSwapOption::empty(),
            app_state: ArcSwapOption::empty(),
            coordinator: ArcSwapOption::empty(),
            scheduler: ArcSwapOption::empty(),
            startup_log_level: ArcSwap::from_pointee(log::LevelFilter::Info),
            workspace_registry: sparo_core::runtime::WorkspaceRegistry::new(),
        })
    }

    pub fn workspace_registry(&self) -> Arc<sparo_core::runtime::WorkspaceRegistry> {
        self.workspace_registry.clone()
    }

    pub fn set_transport(&self, transport: Arc<TauriTransportAdapter>) {
        self.transport.store(Some(transport));
    }

    pub fn transport(&self) -> Option<Arc<TauriTransportAdapter>> {
        self.transport.load_full()
    }

    pub fn set_app_state(&self, state: Arc<AppState>) {
        self.app_state.store(Some(state));
    }

    pub fn app_state(&self) -> Option<Arc<AppState>> {
        self.app_state.load_full()
    }

    pub fn set_coordinator(
        &self,
        coordinator: Arc<sparo_core::agentic::coordination::ConversationCoordinator>,
    ) {
        self.coordinator.store(Some(coordinator));
    }

    pub fn coordinator(
        &self,
    ) -> Option<Arc<sparo_core::agentic::coordination::ConversationCoordinator>> {
        self.coordinator.load_full()
    }

    pub fn set_scheduler(
        &self,
        scheduler: Arc<sparo_core::agentic::coordination::DialogScheduler>,
    ) {
        self.scheduler.store(Some(scheduler));
    }

    pub fn scheduler(&self) -> Option<Arc<sparo_core::agentic::coordination::DialogScheduler>> {
        self.scheduler.load_full()
    }
}
