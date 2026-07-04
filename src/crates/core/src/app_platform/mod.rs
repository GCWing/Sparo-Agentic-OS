//! Shared Product App and Component platform primitives.

pub mod authoring;
pub mod builtin;
pub mod catalog;
pub mod catalog_state;
pub mod eval;
pub mod manifest;
pub mod native;
pub mod permissions;
pub mod rehearsal;
pub mod resolver;
pub mod runtime_storage;
pub mod surfaces;
pub mod versioning;

pub use authoring::{
    create_component_package, create_product_app_component_scaffold, create_product_app_package,
    create_product_app_package_with_options,
    default_product_app_work_multiplicity_for_surface_mode, CreateComponentPackageDraft,
    CreateProductAppComponentDraft, CreateProductAppPackageDraft, CreateProductAppPackageOptions,
    WrittenComponentPackage, WrittenProductAppComponentScaffold, WrittenProductAppPackage,
};
pub use builtin::{
    get_installed_product_app_by_lock, install_product_app, list_installed_package_components,
    list_installed_product_app_catalog, list_installed_product_app_catalog_with_issues,
    list_installed_product_apps, list_installed_shared_components, list_product_app_catalog_source,
    list_product_app_catalog_source_with_issues, publish_product_app_release_to_catalog,
    seed_builtin_product_app_packages, select_installed_product_app_by_lock, uninstall_product_app,
    ProductAppCatalogEntries, PublishProductAppReleaseToCatalogRequest,
    PublishedProductAppReleaseCatalogSource,
};
pub use catalog::{
    build_component_lock, stable_digest, AppCatalogEntry, AppCatalogVisibility, AppComponentRef,
    AppDataDeletionPolicy, AppDataLifecyclePolicy, AppDataMigrationPolicy, AppDataRetentionPolicy,
    AppDataSharePolicy, AppDefinition, AppIconSpec, AppInstallScope, AppInteractionModel,
    AppManagementAction, AppSurfaceMode, AppTruthSource, AppWorkMultiplicity, CapabilityRef,
    ComponentDefinition, ComponentKind, ComponentLock, ComponentLockEntry, ComponentOwnerApp,
    ComponentPackageSource, ComponentSource, ComponentVisibility, NativeAppManagementAction,
    NativeAppManagementOrigin, NativeAppManagementPolicy, PermissionSpec, ProductAppCatalogEntry,
    ProductAppCatalogIssue, ProductAppCatalogIssueSource, ProductAppCatalogSourceKind,
    ProductAppCatalogSourceRef, ProductAppLaunch, ProductAppLaunchKind,
    ProductAppLaunchScopeRequirement, ProductAppLibrarySource, ProductAppManagementOrigin,
    ProductAppManagementPolicy, ProductAppUninstallPolicy, SurfaceRef, WorkObjectKind,
    WorkObjectScope,
};
pub use catalog_state::{
    apply_product_app_catalog_source_state, apply_product_app_catalog_state,
    set_product_app_enabled,
};
pub use eval::{
    ProductAppEvalCase, ProductAppEvalEvidenceKind, ProductAppEvalExpectation,
    ProductAppEvalExpectationKind, ProductAppEvalPlan,
};
pub use manifest::AppManifestIdentity;
pub use native::{
    native_app_catalog, NativeAppAvailability, NativeAppCatalogEntry, NativeAppOrigin,
};
pub use permissions::AppPermissionSummary;
pub use rehearsal::{
    ProductAppRehearsalAction, ProductAppRehearsalPlan, ProductAppRehearsalScenario,
    ProductAppRehearsalScenarioKind, ProductAppRehearsalStep,
};
pub use resolver::{
    ComponentPackage, ProductAppPackage, ProductAppResolveRequest, ProductAppResolver,
    ResolvedProductApp,
};
pub use runtime_storage::ProductAppRuntimeStorage;
pub use surfaces::{
    AppSurfaces, ProductAppRuntimeIssueSeverity, ProductAppRuntimeLogLevel, ProductAppRuntimeState,
};
pub use versioning::{
    compare_product_app_revisions, create_product_app_checkpoint,
    create_product_app_from_release_template, create_product_app_release,
    current_product_app_package_digest, describe_current_product_app_revision,
    restore_product_app_checkpoint, restore_product_app_release,
    validate_product_app_release_readiness, CompareProductAppRevisionsRequest,
    CreateProductAppCheckpointRequest, CreateProductAppFromReleaseTemplateRequest,
    CreateProductAppReleaseRequest, ProductAppCheckpointFile, ProductAppCheckpointManifest,
    ProductAppCheckpointReadinessSnapshot, ProductAppReleaseCatalogSourceManifest,
    ProductAppReleaseCheck, ProductAppReleaseManifest, ProductAppReleaseReadinessSnapshot,
    ProductAppReleaseShareSnapshot, ProductAppRevisionChangeKind, ProductAppRevisionComparison,
    ProductAppRevisionDescriptor, ProductAppRevisionFileChange, ProductAppRevisionKind,
    ProductAppRevisionRef, RestoreProductAppCheckpointRequest, RestoreProductAppReleaseRequest,
    RestoredProductAppCheckpoint, RestoredProductAppRelease, WrittenProductAppCheckpoint,
    WrittenProductAppFromReleaseTemplate, WrittenProductAppRelease,
    PRODUCT_APP_CHECKPOINT_SCHEMA_VERSION, PRODUCT_APP_RELEASE_CATALOG_SOURCE_FILE,
    PRODUCT_APP_RELEASE_CATALOG_SOURCE_SCHEMA_VERSION,
    PRODUCT_APP_RELEASE_READINESS_REQUIRED_CHECK_IDS, PRODUCT_APP_RELEASE_SCHEMA_VERSION,
};
