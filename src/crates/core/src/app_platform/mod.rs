//! Shared Product App and Component platform primitives.

pub mod activation_policy;
pub mod authoring;
mod bundle_assets;
pub mod capability_binding;
pub mod capability_grants;
pub mod catalog;
pub(crate) mod draft_lock;
pub mod draft_package;
pub mod eval;
pub mod evolution;
pub mod launch_binding;
pub mod manifest;
pub mod native;
pub mod permissions;
pub mod private_components;
pub mod rehearsal;
pub mod resolver;
pub mod revision_store;
pub mod runtime_storage;
mod state_io;
pub mod surfaces;
pub mod system_apps;
pub mod versioning;

pub use activation_policy::{AppActivationPolicy, AppReleaseCapabilityReview};
pub use authoring::{
    create_component_package, create_product_app_component_scaffold,
    default_product_app_work_multiplicity_for_surface_mode, scaffold_product_app_draft,
    CreateComponentPackageDraft, CreateProductAppComponentDraft, CreateProductAppPackageDraft,
    CreateProductAppPackageOptions, WrittenComponentPackage, WrittenProductAppComponentScaffold,
    WrittenProductAppPackage,
};
#[cfg(test)]
pub(crate) use authoring::{create_product_app_package, create_product_app_package_with_options};
pub use capability_binding::{known_os_atomic_capabilities, validate_app_capability_bindings};
pub use capability_grants::{required_app_capabilities, CapabilityGrant, CapabilityGrantStore};
pub use catalog::{
    build_component_lock, stable_digest, AppAuthor, AppCatalogEntry, AppCatalogVisibility,
    AppComponentRef, AppDataDeletionPolicy, AppDataLifecyclePolicy, AppDataMigrationPolicy,
    AppDataRetentionPolicy, AppDataSharePolicy, AppDefinition, AppI18n, AppIconSpec,
    AppInstallScope, AppInteractionModel, AppLocalizedMetadata, AppManagementAction,
    AppRuntimeInteraction, AppRuntimeInteractionSidecar, AppRuntimeInteractionTab,
    AppRuntimeInteractionText, AppRuntimeSidecarAvailability, AppRuntimeSidecarIcon,
    AppRuntimeSidecarTargetGroup, AppSurfaceMode, AppTruthSource, AppWorkMultiplicity,
    CapabilityRef, ComponentDefinition, ComponentKind, ComponentLock, ComponentLockEntry,
    ComponentOwnerApp, ComponentPackageSource, ComponentSource, ComponentVisibility,
    NativeAppManagementAction, NativeAppManagementOrigin, NativeAppManagementPolicy,
    PermissionSpec, ProductAppCatalogEntry, ProductAppCatalogIssue, ProductAppCatalogIssueSource,
    ProductAppCatalogSourceKind, ProductAppCatalogSourceRef, ProductAppLaunch,
    ProductAppLaunchKind, ProductAppLaunchScopeRequirement, ProductAppLibrarySource,
    ProductAppManagementOrigin, ProductAppManagementPolicy, ProductAppUninstallPolicy, SurfaceRef,
    WorkObjectKind, WorkObjectScope,
};
pub use draft_package::{
    materialize_fork_draft_contract, rebind_draft_package_identity, validate_release_evaluation,
};
pub use eval::{
    ProductAppEvalCase, ProductAppEvalEvidenceKind, ProductAppEvalExpectation,
    ProductAppEvalExpectationKind, ProductAppEvalPlan,
};
pub use evolution::{
    EvolutionAutonomyLevel, EvolutionConsent, EvolutionEvaluation, EvolutionProposal,
    EvolutionProposalKind, EvolutionProposalStatus, EvolutionRiskLevel, EvolutionSignal,
    ProductAppEvolutionState, ProductAppEvolutionStore,
};
pub use launch_binding::{
    is_os_native_agent_id, is_system_builtin_product_app_agent_id,
    validate_product_app_launch_binding,
};
pub use manifest::AppManifestIdentity;
pub use native::{
    native_app_catalog, native_app_shell_catalog, NativeAppAvailability, NativeAppCatalogEntry,
    NativeAppOrigin,
};
pub use permissions::AppPermissionSummary;
pub use private_components::{
    collect_private_bridge_package_dirs, private_component_source_dir,
    register_private_product_app_runtime_components, ProductAppPrivateComponentRegistration,
};
pub use rehearsal::{
    ProductAppRehearsalAction, ProductAppRehearsalPlan, ProductAppRehearsalScenario,
    ProductAppRehearsalScenarioKind, ProductAppRehearsalStep,
};
pub use resolver::{
    ComponentPackage, ProductAppPackage, ProductAppResolveRequest, ProductAppResolver,
    ResolvedProductApp,
};
pub use revision_store::{
    ActivateReleaseRequest, ActivationRecord, AppActivationScope, AppCatalogProjection,
    AppDerivation, AppOwner, AppOwnerKind, AppRecord, AppRevisionStore, AppSlotProjection,
    AppVariantProjection, AppVariantState, ArchivedApp, CreateDraftRequest,
    CreateIntelligentAppRequest, CreatedApp, DraftRebaseContext, DraftRecord, ForkReleaseRequest,
    PublishDraftRequest, ReleaseMetadata, ReleaseProvenanceKind, ReleaseRecord, ReleaseRuntimeSpec,
    ResolvedDraft, ResolvedRelease, SystemReleaseInitializationOutcome,
};
pub use runtime_storage::ProductAppRuntimeStorage;
pub(crate) use state_io::{atomic_write_json, recover_atomic_json};
pub use surfaces::{
    AppSurfaces, ProductAppRuntimeIssueSeverity, ProductAppRuntimeLogLevel, ProductAppRuntimeState,
};
pub use system_apps::{
    list_system_shared_components, seed_system_app_releases, SystemAppSeedResult,
};
pub use versioning::{
    compare_product_app_revisions, create_product_app_checkpoint,
    current_product_app_package_digest, describe_current_product_app_revision,
    restore_product_app_checkpoint, CompareProductAppRevisionsRequest,
    CreateProductAppCheckpointRequest, ProductAppCheckpointFile, ProductAppCheckpointManifest,
    ProductAppCheckpointValidation, ProductAppRevisionChangeKind, ProductAppRevisionComparison,
    ProductAppRevisionDescriptor, ProductAppRevisionFileChange, ProductAppRevisionKind,
    ProductAppRevisionRef, RestoreProductAppCheckpointRequest, RestoredProductAppCheckpoint,
    WrittenProductAppCheckpoint, PRODUCT_APP_CHECKPOINT_SCHEMA_VERSION,
};
