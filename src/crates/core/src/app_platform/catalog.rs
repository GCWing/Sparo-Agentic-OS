use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::eval::ProductAppEvalPlan;
use super::permissions::AppPermissionSummary;
use super::rehearsal::ProductAppRehearsalPlan;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppInteractionModel {
    Conversation,
    InteractiveWorkspace,
}

/// App-owned additions to the host-derived Product App runtime interaction.
///
/// The host remains authoritative for the profile, chat binding, primary tab,
/// and backend routing. Apps may only declare additional runtime tabs.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRuntimeInteraction {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tabs: Vec<AppRuntimeInteractionTab>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AppRuntimeInteractionText {
    Plain(String),
    Localized(BTreeMap<String, String>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AppRuntimeSidecarIcon {
    Activity,
    AppWindow,
    FileText,
    Palette,
    Play,
    Settings,
}

impl AppRuntimeSidecarIcon {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Activity => "activity",
            Self::AppWindow => "app-window",
            Self::FileText => "file-text",
            Self::Palette => "palette",
            Self::Play => "play",
            Self::Settings => "settings",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppRuntimeSidecarAvailability {
    Enabled,
    Disabled,
    Hidden,
}

impl AppRuntimeSidecarAvailability {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Enabled => "enabled",
            Self::Disabled => "disabled",
            Self::Hidden => "hidden",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppRuntimeSidecarTargetGroup {
    Primary,
    Secondary,
}

impl AppRuntimeSidecarTargetGroup {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Primary => "primary",
            Self::Secondary => "secondary",
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRuntimeInteractionSidecar {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<AppRuntimeSidecarIcon>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub availability: Option<AppRuntimeSidecarAvailability>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_group: Option<AppRuntimeSidecarTargetGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRuntimeInteractionTab {
    pub id: String,
    #[serde(rename = "type")]
    pub tab_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<AppRuntimeInteractionText>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
    #[serde(default)]
    pub default: bool,
    #[serde(default)]
    pub developer_only: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sidecar: Option<AppRuntimeInteractionSidecar>,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub data: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppWorkMultiplicity {
    Multiple,
    Singleton,
}

impl Default for AppWorkMultiplicity {
    fn default() -> Self {
        Self::Multiple
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppTruthSource {
    OwnedObjectState,
    RuntimeFact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppSurfaceMode {
    ChatPrimary,
    SidecarLinked,
    ImmersivePrimary,
    EmbeddedObject,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppInstallScope {
    System,
    Workspace,
    Project,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppCatalogVisibility {
    Discoverable,
    InstalledOnly,
    Hidden,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AppIconSpec {
    PackageAsset {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mime_type: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        digest: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        uri: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        background: Option<String>,
    },
    NativeAsset {
        asset_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mime_type: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        digest: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        uri: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        background: Option<String>,
    },
    Lucide {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        background: Option<String>,
    },
    Monogram {
        label: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        seed: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        background: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProductAppLibrarySource {
    Installed,
    Discoverable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProductAppCatalogSourceKind {
    InstalledPackage,
    BuiltinMarketplace,
    PublishedRelease,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProductAppCatalogIssueSource {
    InstalledPackage,
    CatalogSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppCatalogIssue {
    pub source: ProductAppCatalogIssueSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
    pub package_dir: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppCatalogSourceRef {
    pub kind: ProductAppCatalogSourceKind,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_uri: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppManagementAction {
    Install,
    Update,
    Disable,
    Uninstall,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProductAppManagementOrigin {
    InstalledPackage,
    DiscoverableSource,
    UpdateSource,
    Hidden,
}

impl Default for ProductAppManagementOrigin {
    fn default() -> Self {
        Self::Hidden
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeAppManagementOrigin {
    NativeSystem,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeAppManagementAction {
    Configure,
    ResetState,
    HideFromHome,
}

impl Default for NativeAppManagementOrigin {
    fn default() -> Self {
        Self::NativeSystem
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppUninstallPolicy {
    #[serde(default, skip_serializing_if = "is_false")]
    pub removes_installed_package: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub retains_work: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub retains_runtime_storage: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppManagementPolicy {
    #[serde(default)]
    pub origin: ProductAppManagementOrigin,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<AppManagementAction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uninstall: Option<ProductAppUninstallPolicy>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAppManagementPolicy {
    #[serde(default)]
    pub origin: NativeAppManagementOrigin,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<NativeAppManagementAction>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkObjectScope {
    Global,
    Workspace,
    Project,
    Asset,
    Device,
    Runtime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppDataRetentionPolicy {
    WorkRuntimeScoped,
    SessionScoped,
    UserManaged,
    ExternalSystem,
}

impl Default for AppDataRetentionPolicy {
    fn default() -> Self {
        Self::WorkRuntimeScoped
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppDataDeletionPolicy {
    DeleteWithWork,
    DeleteOnUserRequest,
    NoDurableData,
    ExternalSystem,
}

impl Default for AppDataDeletionPolicy {
    fn default() -> Self {
        Self::DeleteWithWork
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppDataMigrationPolicy {
    NotSupported,
    ExportImport,
    SchemaVersioned,
    ExternalSystem,
}

impl Default for AppDataMigrationPolicy {
    fn default() -> Self {
        Self::NotSupported
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppDataSharePolicy {
    ExcludeRuntimePrivateData,
    DeclaredWorkObjectsOnly,
    ExternalReferenceOnly,
}

impl Default for AppDataSharePolicy {
    fn default() -> Self {
        Self::ExcludeRuntimePrivateData
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDataLifecyclePolicy {
    #[serde(default)]
    pub retention: AppDataRetentionPolicy,
    #[serde(default)]
    pub deletion: AppDataDeletionPolicy,
    #[serde(default)]
    pub migration: AppDataMigrationPolicy,
    #[serde(default)]
    pub share: AppDataSharePolicy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ComponentKind {
    Surface,
    Agent,
    Bridge,
    Runtime,
    Tool,
    Skill,
}

impl ComponentKind {
    pub fn path_segment(self) -> &'static str {
        match self {
            Self::Surface => "surfaces",
            Self::Agent => "agents",
            Self::Bridge => "bridges",
            Self::Runtime => "runtimes",
            Self::Tool => "tools",
            Self::Skill => "skills",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ComponentSource {
    Private,
    Shared,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ComponentPackageSource {
    AppPrivate,
    Shared,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ComponentVisibility {
    AppDependency,
    Developer,
    Hidden,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceRef {
    pub component_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkObjectKind {
    pub id: String,
    pub label: String,
    pub scope: WorkObjectScope,
    #[serde(default)]
    pub identity_schema: Value,
    #[serde(default)]
    pub context_schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppComponentRef {
    pub component_id: String,
    pub kind: ComponentKind,
    pub source: ComponentSource,
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub uses_capabilities: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLocalizedMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppI18n {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub locales: BTreeMap<String, AppLocalizedMetadata>,
}

impl AppI18n {
    pub fn is_empty(&self) -> bool {
        self.locales.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityRef {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionSpec {
    pub kind: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentOwnerApp {
    pub app_id: String,
    pub app_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentDefinition {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub kind: ComponentKind,
    pub name: String,
    pub description: String,
    pub package_source: ComponentPackageSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_app: Option<ComponentOwnerApp>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<CapabilityRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub permissions: Vec<PermissionSpec>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub uses_capabilities: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub used_by_apps: Vec<String>,
    pub visibility: ComponentVisibility,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dependencies: Vec<AppComponentRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub implementation_ref: Option<String>,
}

impl ComponentDefinition {
    pub fn fqid(&self) -> String {
        match &self.owner_app {
            Some(owner) => format!(
                "app://{}@{}/{}/{}",
                owner.app_id,
                owner.app_version,
                self.kind.path_segment(),
                self.id
            ),
            None => format!(
                "component://{}/{}@{}",
                self.kind.path_segment(),
                self.id,
                self.version.as_deref().unwrap_or("0.0.0")
            ),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentLockEntry {
    pub fqid: String,
    pub component_id: String,
    pub kind: ComponentKind,
    pub source: ComponentSource,
    pub digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub implementation_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentLock {
    pub app_id: String,
    pub version: String,
    pub lock_version: u32,
    pub resolved_components: Vec<ComponentLockEntry>,
    pub permission_digest: String,
    pub component_graph_digest: String,
}

impl ComponentLock {
    pub fn digest(&self) -> String {
        stable_digest(self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProductAppLaunchKind {
    AgentSession,
    ApplicationSurface,
    AppBuilder,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProductAppLaunchScopeRequirement {
    SystemAllowed,
    WorkspaceOptional,
    WorkspaceRequired,
}

impl Default for ProductAppLaunchScopeRequirement {
    fn default() -> Self {
        Self::SystemAllowed
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppLaunch {
    pub kind: ProductAppLaunchKind,
    pub target_id: String,
    #[serde(default)]
    pub scope_requirement: ProductAppLaunchScopeRequirement,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppAuthor {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDefinition {
    pub id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub authors: Vec<AppAuthor>,
    #[serde(default, skip_serializing_if = "AppI18n::is_empty")]
    pub i18n: AppI18n,
    pub interaction_model: AppInteractionModel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_interaction: Option<AppRuntimeInteraction>,
    #[serde(default)]
    pub work_multiplicity: AppWorkMultiplicity,
    #[serde(default)]
    pub work_object_kinds: Vec<WorkObjectKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_lifecycle: Option<AppDataLifecyclePolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truth_source: Option<AppTruthSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_surface: Option<SurfaceRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_surface_mode: Option<AppSurfaceMode>,
    #[serde(default)]
    pub components: Vec<AppComponentRef>,
    pub component_lock_id: String,
    pub permissions: AppPermissionSummary,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub os_capabilities: Vec<String>,
    pub install_scope: AppInstallScope,
    pub catalog_visibility: AppCatalogVisibility,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub icon: AppIconSpec,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub launch: Option<ProductAppLaunch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppCatalogEntry {
    #[serde(flatten)]
    pub app: AppDefinition,
    pub component_lock_digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_digest: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub update_available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_component_lock_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available_component_lock_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_package_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available_package_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_release_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_release_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_release_notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_published_at_ms: Option<u64>,
    #[serde(default)]
    pub dependency_summary: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub installed: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub discoverable: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub library_sources: Vec<ProductAppLibrarySource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_source: Option<ProductAppCatalogSourceRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub catalog_issues: Vec<ProductAppCatalogIssue>,
    #[serde(default)]
    pub management: ProductAppManagementPolicy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rehearsal_plan: Option<ProductAppRehearsalPlan>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_plan: Option<ProductAppEvalPlan>,
}

/// The App Catalog now exposes only Product App projections.
pub type AppCatalogEntry = ProductAppCatalogEntry;

pub fn build_component_lock(
    app: &AppDefinition,
    components: &[ComponentDefinition],
) -> ComponentLock {
    build_component_lock_with_implementation_digests(app, components, &BTreeMap::new())
}

pub fn build_component_lock_with_implementation_digests(
    app: &AppDefinition,
    components: &[ComponentDefinition],
    implementation_digests: &BTreeMap<String, String>,
) -> ComponentLock {
    let resolved_components = components
        .iter()
        .map(|component| {
            let source = if component.owner_app.is_some() {
                ComponentSource::Private
            } else {
                ComponentSource::Shared
            };
            let implementation_digest = implementation_digests.get(&component.fqid()).cloned();
            ComponentLockEntry {
                fqid: component.fqid(),
                component_id: component.id.clone(),
                kind: component.kind,
                source,
                digest: component_lock_entry_digest(component, implementation_digest.as_deref()),
                implementation_digest,
                version: component.version.clone(),
                scope: match component.package_source {
                    ComponentPackageSource::Shared => Some("system".to_string()),
                    ComponentPackageSource::AppPrivate => None,
                },
            }
        })
        .collect::<Vec<_>>();

    ComponentLock {
        app_id: app.id.clone(),
        version: app.version.clone(),
        lock_version: 1,
        permission_digest: permission_contract_digest(app, components),
        component_graph_digest: stable_digest(&resolved_components),
        resolved_components,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductAppPermissionContract<'a> {
    permissions: &'a AppPermissionSummary,
    os_capabilities: Vec<&'a str>,
    component_uses_capabilities: BTreeMap<String, Vec<&'a str>>,
    component_permissions: BTreeMap<String, Vec<ComponentPermissionContract<'a>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ComponentPermissionContract<'a> {
    kind: String,
    scopes: Vec<&'a str>,
}

fn permission_contract_digest(app: &AppDefinition, components: &[ComponentDefinition]) -> String {
    let mut component_uses_capabilities = BTreeMap::new();
    let mut component_permissions = BTreeMap::new();
    for component_ref in &app.components {
        let mut uses = component_ref
            .uses_capabilities
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        uses.sort_unstable();
        uses.dedup();
        component_uses_capabilities.insert(
            format!(
                "ref:{}/{}",
                component_ref.kind.path_segment(),
                component_ref.component_id
            ),
            uses,
        );
    }
    for component in components {
        let mut uses = component
            .uses_capabilities
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        uses.sort_unstable();
        uses.dedup();
        component_uses_capabilities.insert(format!("component:{}", component.fqid()), uses);
        let mut permissions = component
            .permissions
            .iter()
            .map(|permission| {
                let mut scopes = permission
                    .scopes
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                scopes.sort_unstable();
                scopes.dedup();
                ComponentPermissionContract {
                    kind: permission.kind.trim().to_ascii_lowercase(),
                    scopes,
                }
            })
            .collect::<Vec<_>>();
        permissions.sort_by(|left, right| {
            left.kind
                .cmp(&right.kind)
                .then_with(|| left.scopes.cmp(&right.scopes))
        });
        component_permissions.insert(format!("component:{}", component.fqid()), permissions);
    }
    let mut os_capabilities = app
        .os_capabilities
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    os_capabilities.sort_unstable();
    os_capabilities.dedup();
    stable_digest(&ProductAppPermissionContract {
        permissions: &app.permissions,
        os_capabilities,
        component_uses_capabilities,
        component_permissions,
    })
}

fn component_lock_entry_digest(
    component: &ComponentDefinition,
    implementation_digest: Option<&str>,
) -> String {
    stable_digest(&serde_json::json!({
        "component": component,
        "implementationDigest": implementation_digest,
    }))
}

pub fn stable_digest<T: Serialize>(value: &T) -> String {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{:x}", hasher.finalize())
}

#[cfg(test)]
mod permission_contract_tests {
    use super::*;

    #[test]
    fn component_permission_scope_changes_capability_fingerprint() {
        let app = test_app();
        let mut component = test_component();
        component.permissions = vec![PermissionSpec {
            kind: "net".to_string(),
            summary: "Network access".to_string(),
            scopes: vec!["https://api.example.com".to_string()],
        }];
        let first = build_component_lock(&app, &[component.clone()]).permission_digest;

        component.permissions[0].summary = "Different user-facing copy".to_string();
        let copy_only = build_component_lock(&app, &[component.clone()]).permission_digest;
        assert_eq!(first, copy_only, "permission copy is not an authority");

        component.permissions[0]
            .scopes
            .push("https://upload.example.com".to_string());
        let expanded = build_component_lock(&app, &[component]).permission_digest;
        assert_ne!(first, expanded, "expanded scopes require a new grant");
    }

    fn test_app() -> AppDefinition {
        AppDefinition {
            id: "permission-contract".to_string(),
            version: "1.0.0".to_string(),
            name: "Permission Contract".to_string(),
            description: "Test app".to_string(),
            authors: Vec::new(),
            i18n: AppI18n::default(),
            interaction_model: AppInteractionModel::Conversation,
            runtime_interaction: None,
            work_multiplicity: AppWorkMultiplicity::Multiple,
            work_object_kinds: Vec::new(),
            data_lifecycle: None,
            truth_source: None,
            primary_surface: None,
            primary_surface_mode: None,
            components: Vec::new(),
            component_lock_id: String::new(),
            permissions: AppPermissionSummary::default(),
            os_capabilities: Vec::new(),
            install_scope: AppInstallScope::System,
            catalog_visibility: AppCatalogVisibility::Discoverable,
            enabled: true,
            icon: AppIconSpec::Monogram {
                label: "P".to_string(),
                seed: None,
                background: None,
            },
            category: "test".to_string(),
            tags: Vec::new(),
            launch: None,
        }
    }

    fn test_component() -> ComponentDefinition {
        ComponentDefinition {
            id: "surface".to_string(),
            version: None,
            kind: ComponentKind::Surface,
            name: "Surface".to_string(),
            description: "Test surface".to_string(),
            package_source: ComponentPackageSource::AppPrivate,
            owner_app: Some(ComponentOwnerApp {
                app_id: "permission-contract".to_string(),
                app_version: "1.0.0".to_string(),
            }),
            capabilities: Vec::new(),
            permissions: Vec::new(),
            uses_capabilities: Vec::new(),
            used_by_apps: Vec::new(),
            visibility: ComponentVisibility::AppDependency,
            dependencies: Vec::new(),
            implementation_ref: None,
        }
    }
}

fn default_enabled() -> bool {
    true
}

fn is_false(value: &bool) -> bool {
    !*value
}
