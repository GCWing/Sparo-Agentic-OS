//! Shared Product App and Component platform primitives.

pub mod authoring;
pub mod builtin;
pub mod catalog;
pub mod manifest;
pub mod permissions;
pub mod resolver;
pub mod surfaces;

pub use authoring::{
    CreateComponentPackageDraft, CreateProductAppPackageDraft, WrittenComponentPackage,
    WrittenProductAppPackage, create_component_package, create_product_app_package,
};
pub use builtin::{
    list_installed_components, list_installed_product_app_catalog, list_installed_product_apps,
    seed_builtin_product_app_packages,
};
pub use catalog::{
    AppCatalogEntry, AppCatalogVisibility, AppComponentRef, AppDefinition, AppInstallScope,
    AppInteractionModel, AppSurfaceMode, AppTruthSource, AppWorkMultiplicity, CapabilityRef,
    ComponentDefinition, ComponentKind, ComponentLock, ComponentLockEntry, ComponentOwnerApp,
    ComponentPackageSource, ComponentSource, ComponentVisibility, PermissionSpec,
    ProductAppCatalogEntry, ProductAppLaunch, ProductAppLaunchKind,
    ProductAppLaunchScopeRequirement, SurfaceRef, WorkObjectKind, WorkObjectScope,
    build_component_lock, stable_digest,
};
pub use manifest::AppManifestIdentity;
pub use permissions::AppPermissionSummary;
pub use resolver::{
    ComponentPackage, ProductAppPackage, ProductAppResolveRequest, ProductAppResolver,
    ResolvedProductApp,
};
pub use surfaces::AppSurfaces;
