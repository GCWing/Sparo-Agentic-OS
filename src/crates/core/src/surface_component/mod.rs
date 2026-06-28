//! Surface Component module: ESM UI, Node Worker, Runtime Adapter, and permission policy.

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

pub use builtin::{
    ensure_builtin_surface_component_current, resolve_builtin_surface_component_bundle_id,
    seed_builtin_surface_components,
};
pub use exporter::{
    ExportCheckResult, ExportOptions, ExportResult, ExportTarget, SurfaceComponentExporter,
};
pub use host_dispatch::{dispatch_host, is_host_primitive};
pub use js_worker_pool::{InstallResult, JsWorkerPool};
pub use manager::{
    initialize_global_surface_component_manager, try_get_global_surface_component_manager,
    SurfaceComponentManager,
};
pub use permission_policy::resolve_policy;
pub use runtime_detect::{DetectedRuntime, RuntimeKind};
pub use runtime_ui_kit::RUNTIME_UI_KIT_COMPONENTS;
pub use storage::SurfaceComponentStorage;
pub use types::{
    AiPermissions, EsmDep, FsPermissions, NetPermissions, NodePermissions, NpmDep, PathScope,
    ShellPermissions, SurfaceComponent, SurfaceComponentAiContext,
    SurfaceComponentBackendActionBinding, SurfaceComponentBackendBinding,
    SurfaceComponentBackendKind, SurfaceComponentBackendMemoryScope,
    SurfaceComponentBackendSessionPolicy, SurfaceComponentBuildMode, SurfaceComponentEntry,
    SurfaceComponentI18n, SurfaceComponentInteraction, SurfaceComponentInteractionChat,
    SurfaceComponentInteractionMode, SurfaceComponentInteractionTab,
    SurfaceComponentInteractionText, SurfaceComponentLocalizedMeta, SurfaceComponentMeta,
    SurfaceComponentPermissions, SurfaceComponentRuntimeIssue,
    SurfaceComponentRuntimeIssueSeverity, SurfaceComponentRuntimeLog,
    SurfaceComponentRuntimeLogLevel, SurfaceComponentSource, SurfaceComponentSourceFile,
    SurfaceComponentSourceFileKind,
};
