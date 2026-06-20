//! Live App module: ESM UI, Node Worker, Runtime Adapter, and permission policy.

pub mod bridge_builder;
pub mod builtin;
pub mod compiler;
pub mod exporter;
pub mod host_dispatch;
pub mod js_worker;
pub mod js_worker_pool;
pub mod manager;
pub mod permission_policy;
pub mod runtime_detect;
pub mod runtime_ui_kit;
pub mod storage;
pub mod types;

pub use builtin::{ensure_builtin_live_app_current, seed_builtin_live_apps};
pub use exporter::{ExportCheckResult, ExportOptions, ExportResult, ExportTarget, LiveAppExporter};
pub use host_dispatch::{dispatch_host, is_host_primitive};
pub use js_worker_pool::{InstallResult, JsWorkerPool};
pub use manager::{
    initialize_global_live_app_manager, try_get_global_live_app_manager, LiveAppManager,
};
pub use permission_policy::resolve_policy;
pub use runtime_detect::{DetectedRuntime, RuntimeKind};
pub use runtime_ui_kit::RUNTIME_UI_KIT_COMPONENTS;
pub use storage::LiveAppStorage;
pub use types::{
    AiPermissions, EsmDep, FsPermissions, LiveApp, LiveAppAiContext, LiveAppBackendActionBinding,
    LiveAppBackendBinding, LiveAppBackendKind, LiveAppBackendMemoryScope,
    LiveAppBackendSessionPolicy, LiveAppBuildMode, LiveAppEntry, LiveAppI18n, LiveAppInteraction,
    LiveAppInteractionChat, LiveAppInteractionMode, LiveAppInteractionTab, LiveAppInteractionText,
    LiveAppLocalizedMeta, LiveAppMeta, LiveAppPermissions, LiveAppRuntimeIssue,
    LiveAppRuntimeIssueSeverity, LiveAppRuntimeLog, LiveAppRuntimeLogLevel, LiveAppSource,
    LiveAppSourceFile, LiveAppSourceFileKind, NetPermissions, NodePermissions, NpmDep, PathScope,
    ShellPermissions,
};
