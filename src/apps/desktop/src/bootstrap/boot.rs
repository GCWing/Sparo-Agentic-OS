//! Boot stage state machine + Tauri event emission.
//!
//! `BootController` is the single source of truth for "where is the app in the
//! boot sequence right now". It is stored inside `AppContainer` and is queried
//! by both backend code (e.g. tray menu disables session list before
//! WorkspaceReady) and by the frontend (`get_boot_stage` command + listen on
//! `boot://stage` event).

use arc_swap::ArcSwap;
use bitfun_core::infrastructure::constants::EVENT_BOOT_STAGE;
use serde::Serialize;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

/// Coarse-grained phases the desktop shell goes through during startup.
///
/// Each variant carries the minimum context the UI needs to render itself.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BootStage {
    /// Before the main window has been created. Frontend never sees this stage.
    PreWindow,
    /// Main window has been created and shown (or about to be shown). The
    /// frontend can render the Splash and start listening for further events.
    WindowReady,
    /// Process-wide globals are ready (config, i18n, AI factory, ingest server,
    /// event bus). Workspace-scoped services may still be loading.
    GlobalReady,
    /// Workspace-scoped services are mounted. `path` is `None` if the user has
    /// no last-used workspace; the UI will render the workspace picker.
    WorkspaceReady { path: Option<String> },
    /// A boot stage failed. The UI shows a recovery panel.
    Degraded { stage: String, error: String },
}

impl BootStage {
    pub fn label(&self) -> &'static str {
        match self {
            BootStage::PreWindow => "pre_window",
            BootStage::WindowReady => "window_ready",
            BootStage::GlobalReady => "global_ready",
            BootStage::WorkspaceReady { .. } => "workspace_ready",
            BootStage::Degraded { .. } => "degraded",
        }
    }
}

pub struct BootController {
    stage: ArcSwap<BootStage>,
    app_handle: OnceLock<AppHandle>,
    history: Mutex<Vec<String>>,
    start_at: std::time::Instant,
}

impl BootController {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            stage: ArcSwap::from_pointee(BootStage::PreWindow),
            app_handle: OnceLock::new(),
            history: Mutex::new(Vec::new()),
            start_at: std::time::Instant::now(),
        })
    }

    /// Attach the Tauri `AppHandle` after the builder runs `setup`. Subsequent
    /// stage transitions will be broadcast via `boot://stage`.
    pub fn attach_app(&self, app: AppHandle) {
        let _ = self.app_handle.set(app);
    }

    pub fn current(&self) -> BootStage {
        BootStage::clone(&self.stage.load())
    }

    /// Move to a new stage and broadcast it to the webview if available.
    pub fn transition(&self, next: BootStage) {
        let label = next.label();
        let elapsed = self.start_at.elapsed().as_millis();
        log::info!(
            "Boot stage transition: stage={}, elapsed_ms={}",
            label,
            elapsed
        );
        if let Ok(mut history) = self.history.lock() {
            history.push(format!("{}@{}ms", label, elapsed));
        }
        self.stage.store(Arc::new(next.clone()));
        if let Some(app) = self.app_handle.get() {
            if let Err(error) = app.emit(EVENT_BOOT_STAGE, &next) {
                log::warn!("Failed to emit boot stage event: {}", error);
            }
        }
    }

    pub fn fail(&self, stage: &str, error: impl std::fmt::Display) {
        self.transition(BootStage::Degraded {
            stage: stage.to_string(),
            error: error.to_string(),
        });
    }

    pub fn history(&self) -> Vec<String> {
        self.history.lock().map(|h| h.clone()).unwrap_or_default()
    }
}
