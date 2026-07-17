//! Product App Runtime Host core boundary.
//!
//! This is the public runtime-host API for Product App surfaces. The private
//! engine keeps the low-level worker, compiler, storage, and permission logic.

pub use crate::product_app_runtime_host_engine::exporter::{
    ExportCheckResult as ProductAppRuntimeHostExportCheckResult,
    ExportOptions as ProductAppRuntimeHostExportOptions,
    ExportResult as ProductAppRuntimeHostExportResult,
    ExportTarget as ProductAppRuntimeHostExportTarget, ProductAppRuntimeHostExporter,
};
pub use crate::product_app_runtime_host_engine::host_dispatch::{dispatch_host, is_host_primitive};
pub use crate::product_app_runtime_host_engine::js_worker_pool::{
    InstallResult as ProductAppRuntimeHostInstallResult,
    JsWorkerPool as ProductAppRuntimeHostWorkerPool,
};
pub use crate::product_app_runtime_host_engine::manager::{
    initialize_global_product_app_runtime_host_manager,
    try_get_global_product_app_runtime_host_manager, ProductAppRuntimeHostManager,
};
pub use crate::product_app_runtime_host_engine::permission_policy::resolve_policy;
pub use crate::product_app_runtime_host_engine::runtime_detect::{
    DetectedRuntime as ProductAppRuntimeHostDetectedRuntime,
    RuntimeKind as ProductAppRuntimeHostRuntimeKind,
};
pub use crate::product_app_runtime_host_engine::runtime_ui_kit::RUNTIME_UI_KIT_COMPONENTS as PRODUCT_APP_RUNTIME_HOST_UI_KIT_COMPONENTS;
pub use crate::product_app_runtime_host_engine::storage::ProductAppRuntimeHostStorage;
pub use crate::product_app_runtime_host_engine::types::{
    AiPermissions as ProductAppRuntimeHostAiPermissions, EsmDep as ProductAppRuntimeHostEsmDep,
    FsPermissions as ProductAppRuntimeHostFsPermissions,
    IframePermissions as ProductAppRuntimeHostIframePermissions,
    NetPermissions as ProductAppRuntimeHostNetPermissions,
    NodePermissions as ProductAppRuntimeHostNodePermissions, NpmDep as ProductAppRuntimeHostNpmDep,
    PathScope as ProductAppRuntimeHostPathScope, ProductAppRuntimeHostAiContext,
    ProductAppRuntimeHostBackendActionBinding, ProductAppRuntimeHostBackendBinding,
    ProductAppRuntimeHostBackendKind, ProductAppRuntimeHostBackendMemoryScope,
    ProductAppRuntimeHostBackendSessionPolicy, ProductAppRuntimeHostBuildMode,
    ProductAppRuntimeHostEntry, ProductAppRuntimeHostI18n, ProductAppRuntimeHostInteraction,
    ProductAppRuntimeHostInteractionChat, ProductAppRuntimeHostInteractionMode,
    ProductAppRuntimeHostInteractionTab, ProductAppRuntimeHostInteractionTabSidecar,
    ProductAppRuntimeHostInteractionText, ProductAppRuntimeHostLocalizedMeta,
    ProductAppRuntimeHostPermissions, ProductAppRuntimeHostRuntimeIssue,
    ProductAppRuntimeHostRuntimeIssueSeverity, ProductAppRuntimeHostRuntimeLog,
    ProductAppRuntimeHostRuntimeLogLevel, ProductAppRuntimeHostRuntimeState,
    ProductAppRuntimeHostSource, ProductAppRuntimeHostSourceFile,
    ProductAppRuntimeHostSourceFileKind, ProductAppRuntimeHostSurface,
    ProductAppRuntimeHostSurfaceMeta, ShellPermissions as ProductAppRuntimeHostShellPermissions,
};
