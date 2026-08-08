//! Immutable Intelligent App revisions, mutable drafts, and activation routing.
//!
//! The store deliberately keeps editable sources and runtime artifacts in separate
//! trees. A release is committed into a content-addressed artifact directory and
//! can only be selected through an activation record. No operation mutates a
//! committed artifact in place.

use crate::error::{CoreError, CoreResult};
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

use super::catalog::{
    AppDefinition, AppIconSpec, AppSurfaceMode, AppWorkMultiplicity, ComponentDefinition,
    ProductAppLaunch, ProductAppLaunchKind, SurfaceRef,
};
use super::draft_lock::acquire_draft_lock;
use super::draft_package::{
    materialize_fork_draft_contract, prepare_draft_release, rebind_draft_package_identity,
};
use super::state_io::{atomic_write_json, recover_atomic_json};

const STORE_DIRECTORY: &str = "intelligent_apps";
const REGISTRY_FILE: &str = "registry.json";
const REGISTRY_SCHEMA_VERSION: u32 = 3;
const ARTIFACT_DIGEST_DOMAIN: &[u8] = b"sparo-intelligent-app-artifact-v1\0";
const RELEASE_ID_DOMAIN: &[u8] = b"sparo-intelligent-app-release-v1\0";
const REBASE_FILE_DIGEST_DOMAIN: &[u8] = b"sparo-intelligent-app-rebase-file-v1\0";
const DRAFT_MANIFEST_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppOwner {
    pub kind: AppOwnerKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_id: Option<String>,
}

impl AppOwner {
    pub fn system() -> Self {
        Self {
            kind: AppOwnerKind::System,
            owner_id: None,
        }
    }

    pub fn user(owner_id: impl Into<String>) -> Self {
        Self {
            kind: AppOwnerKind::User,
            owner_id: Some(owner_id.into()),
        }
    }

    pub fn organization(owner_id: impl Into<String>) -> Self {
        Self {
            kind: AppOwnerKind::Organization,
            owner_id: Some(owner_id.into()),
        }
    }

    fn validate(&self) -> CoreResult<()> {
        match self.kind {
            AppOwnerKind::System if self.owner_id.is_some() => Err(CoreError::validation(
                "System app ownership must not contain ownerId",
            )),
            AppOwnerKind::User | AppOwnerKind::Organization => {
                let owner_id = self.owner_id.as_deref().ok_or_else(|| {
                    CoreError::validation("User and organization ownership requires ownerId")
                })?;
                validate_identifier("ownerId", owner_id)
            }
            AppOwnerKind::System => Ok(()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppOwnerKind {
    System,
    User,
    Organization,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDerivation {
    pub app_id: String,
    pub release_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRecord {
    pub app_id: String,
    pub slot_id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub owner: AppOwner,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub derived_from: Option<AppDerivation>,
    pub created_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftRecord {
    pub draft_id: String,
    pub app_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_release_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rebase_context: Option<DraftRebaseContext>,
    /// Store-relative source path. Call `resolve_draft` before filesystem access.
    pub path: String,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

/// Immutable coordinates for a three-way upstream merge.
///
/// `baseReleaseId` and `targetReleaseId` are releases of `upstreamAppId`;
/// `DraftRecord::base_release_id` remains the current release of the fork itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftRebaseContext {
    pub upstream_app_id: String,
    pub base_release_id: String,
    pub target_release_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredDraftManifest {
    schema_version: u32,
    draft_id: String,
    app_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredRebaseManifest {
    schema_version: u32,
    app_id: String,
    current_release_id: String,
    current_artifact_digest: String,
    upstream_app_id: String,
    base_release_id: String,
    base_artifact_digest: String,
    target_release_id: String,
    target_artifact_digest: String,
    automatic_changes: Vec<StoredRebaseChange>,
    integrated_changes: Vec<StoredRebaseChange>,
    conflicts: Vec<StoredRebaseConflict>,
    created_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredRebaseChange {
    path: String,
    base: StoredRebaseFileSummary,
    mine: StoredRebaseFileSummary,
    target: StoredRebaseFileSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredRebaseConflict {
    path: String,
    base: StoredRebaseFileSummary,
    mine: StoredRebaseFileSummary,
    target: StoredRebaseFileSummary,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredRebaseFileSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    digest: Option<String>,
}

#[derive(Debug)]
struct RebaseMergePlan {
    automatic_changes: Vec<StoredRebaseChange>,
    integrated_changes: Vec<StoredRebaseChange>,
    conflicts: Vec<StoredRebaseConflict>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseRecord {
    pub release_id: String,
    pub app_id: String,
    pub slot_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_release_id: Option<String>,
    pub artifact_digest: String,
    pub component_lock_digest: String,
    pub version: String,
    pub config_revision: String,
    pub data_schema_version: String,
    pub runtime_compatibility: String,
    pub capability_fingerprint: String,
    pub evaluation_report_digest: String,
    pub runtime: ReleaseRuntimeSpec,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub provenance: ReleaseProvenanceKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream_app_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream_base_release_id: Option<String>,
    pub created_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseRuntimeSpec {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch: Option<ProductAppLaunch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_surface: Option<SurfaceRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_surface_mode: Option<AppSurfaceMode>,
    pub work_multiplicity: AppWorkMultiplicity,
    pub icon: AppIconSpec,
    pub category: String,
    pub tags: Vec<String>,
}

impl ReleaseRuntimeSpec {
    pub fn from_app(app: &AppDefinition) -> Self {
        Self {
            launch: app.launch.clone(),
            primary_surface: app.primary_surface.clone(),
            primary_surface_mode: app.primary_surface_mode,
            work_multiplicity: app.work_multiplicity,
            icon: app.icon.clone(),
            category: app.category.clone(),
            tags: app.tags.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReleaseProvenanceKind {
    System,
    User,
    AiGenerated,
    Organization,
    External,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppActivationScope {
    System,
}

impl AppActivationScope {
    pub(super) fn validate(&self) -> CoreResult<()> {
        Ok(())
    }

    fn registry_key(&self) -> String {
        "system".to_string()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationRecord {
    pub scope: AppActivationScope,
    pub slot_id: String,
    pub selected_app_id: String,
    pub active_release_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemReleaseInitializationOutcome {
    Created,
    Preserved,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SystemReleaseSyncOutcome {
    Added,
    Reused,
    Replaced,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseMetadata {
    pub version: String,
    pub component_lock_digest: String,
    pub config_revision: String,
    pub data_schema_version: String,
    pub runtime_compatibility: String,
    pub capability_fingerprint: String,
    pub evaluation_report_digest: String,
    pub runtime: ReleaseRuntimeSpec,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub provenance: ReleaseProvenanceKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream_app_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream_base_release_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateIntelligentAppRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub owner: AppOwner,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDraftRequest {
    pub app_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_release_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkReleaseRequest {
    pub source_release_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_app_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub owner: AppOwner,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishDraftRequest {
    pub draft_id: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub provenance: ReleaseProvenanceKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ImportReleaseFromPackageRequest {
    pub app_id: String,
    pub slot_id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub owner: AppOwner,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_release_id: Option<String>,
    pub metadata: ReleaseMetadata,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateReleaseRequest {
    pub scope: AppActivationScope,
    pub slot_id: String,
    pub app_id: String,
    pub release_id: String,
}

enum ActivationExpectation<'a> {
    #[cfg(test)]
    Unchecked,
    Exact(Option<&'a ActivationRecord>),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedApp {
    pub app: AppRecord,
    pub draft: DraftRecord,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedApp {
    pub app: AppRecord,
    pub removed_draft_ids: Vec<String>,
    pub removed_release_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppVariantState {
    Active,
    Disabled,
    Available,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppVariantProjection {
    pub app: AppRecord,
    pub releases: Vec<ReleaseRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_release: Option<ReleaseRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream_base_release_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream_latest_release_id: Option<String>,
    pub upstream_update_available: bool,
    pub state: AppVariantState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSlotProjection {
    pub slot_id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activation: Option<ActivationRecord>,
    pub variants: Vec<AppVariantProjection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCatalogProjection {
    pub slots: Vec<AppSlotProjection>,
    pub drafts: Vec<DraftRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedDraft {
    pub draft: DraftRecord,
    pub source_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRelease {
    pub release: ReleaseRecord,
    pub artifact_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Registry {
    schema_version: u32,
    apps: BTreeMap<String, AppRecord>,
    drafts: BTreeMap<String, DraftRecord>,
    releases: BTreeMap<String, ReleaseRecord>,
    activations: BTreeMap<String, ActivationRecord>,
    retired_app_ids: BTreeSet<String>,
}

impl Default for Registry {
    fn default() -> Self {
        Self {
            schema_version: REGISTRY_SCHEMA_VERSION,
            apps: BTreeMap::new(),
            drafts: BTreeMap::new(),
            releases: BTreeMap::new(),
            activations: BTreeMap::new(),
            retired_app_ids: BTreeSet::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct AppRevisionStore {
    root: PathBuf,
    registry: Arc<RwLock<Registry>>,
    mutation_lock: Arc<Mutex<()>>,
}

impl AppRevisionStore {
    /// Opens the store below `<app-root>/intelligent_apps`.
    pub async fn open(app_root: impl AsRef<Path>) -> CoreResult<Self> {
        let root = app_root.as_ref().join(STORE_DIRECTORY);
        fs::create_dir_all(root.join("drafts")).await?;
        fs::create_dir_all(root.join("artifacts")).await?;
        for (directory, prefix) in [
            (root.clone(), ".publish-staging-"),
            (root.join("drafts"), ".staging-"),
            (root.join("artifacts"), ".staging-"),
        ] {
            if let Err(error) = cleanup_staging_directories(&directory, prefix).await {
                log::warn!(
                    "Failed to clean Intelligent App staging entries while opening revision store: directory={}, prefix={}, error={}",
                    directory.display(),
                    prefix,
                    error
                );
            }
        }
        let registry_path = root.join(REGISTRY_FILE);
        recover_atomic_json(&registry_path).await?;
        let registry = if registry_path.is_file() {
            let bytes = fs::read(&registry_path).await?;
            let registry: Registry = serde_json::from_slice(&bytes)?;
            validate_registry(&root, &registry)?;
            registry
        } else {
            let registry = Registry::default();
            persist_registry(&root, &registry).await?;
            registry
        };
        if let Err(error) = cleanup_unreferenced_artifacts(&root, &registry).await {
            log::warn!(
                "Failed to clean unreferenced Intelligent App artifacts while opening revision store: root={}, error={}",
                root.display(),
                error
            );
        }

        Ok(Self {
            root,
            registry: Arc::new(RwLock::new(registry)),
            mutation_lock: Arc::new(Mutex::new(())),
        })
    }

    pub fn storage_root(&self) -> &Path {
        &self.root
    }

    pub async fn list_apps(&self) -> Vec<AppRecord> {
        self.registry.read().await.apps.values().cloned().collect()
    }

    pub async fn list_drafts(&self, app_id: Option<&str>) -> Vec<DraftRecord> {
        self.registry
            .read()
            .await
            .drafts
            .values()
            .filter(|draft| app_id.is_none_or(|app_id| draft.app_id == app_id))
            .cloned()
            .collect()
    }

    pub async fn list_releases(&self, app_id: Option<&str>) -> Vec<ReleaseRecord> {
        self.registry
            .read()
            .await
            .releases
            .values()
            .filter(|release| app_id.is_none_or(|app_id| release.app_id == app_id))
            .cloned()
            .collect()
    }

    pub async fn list_activations(
        &self,
        scope: Option<&AppActivationScope>,
    ) -> Vec<ActivationRecord> {
        self.registry
            .read()
            .await
            .activations
            .values()
            .filter(|activation| scope.is_none_or(|scope| &activation.scope == scope))
            .cloned()
            .collect()
    }

    pub async fn get_app(&self, app_id: &str) -> Option<AppRecord> {
        self.registry.read().await.apps.get(app_id).cloned()
    }

    pub async fn get_active(
        &self,
        scope: &AppActivationScope,
        slot_id: &str,
    ) -> Option<ActivationRecord> {
        self.registry
            .read()
            .await
            .activations
            .get(&activation_key(scope, slot_id))
            .cloned()
    }

    pub async fn get_effective_activation(
        &self,
        scope: &AppActivationScope,
        slot_id: &str,
    ) -> Option<ActivationRecord> {
        let registry = self.registry.read().await;
        effective_activation(&registry, scope, slot_id).cloned()
    }

    /// Builds the Apps Center projection without persisting a second catalog model.
    pub async fn list_catalog(&self, scope: &AppActivationScope) -> AppCatalogProjection {
        let registry = self.registry.read().await;
        let mut apps_by_slot = BTreeMap::<String, Vec<AppRecord>>::new();
        for app in registry.apps.values() {
            apps_by_slot
                .entry(app.slot_id.clone())
                .or_default()
                .push(app.clone());
        }

        let mut slots = Vec::with_capacity(apps_by_slot.len());
        for (slot_id, mut apps) in apps_by_slot {
            apps.sort_by(|left, right| left.app_id.cmp(&right.app_id));
            let activation = effective_activation(&registry, scope, &slot_id).cloned();
            let display_name = activation
                .as_ref()
                .and_then(|activation| registry.apps.get(&activation.selected_app_id))
                .or_else(|| apps.first())
                .map(|app| app.display_name.clone())
                .unwrap_or_else(|| slot_id.clone());

            let variants = apps
                .into_iter()
                .map(|app| {
                    let mut releases = registry
                        .releases
                        .values()
                        .filter(|release| release.app_id == app.app_id)
                        .cloned()
                        .collect::<Vec<_>>();
                    releases.sort_by(compare_releases_descending);
                    let latest_release = releases.first().cloned();
                    let upstream_app_id = latest_release
                        .as_ref()
                        .and_then(|release| release.upstream_app_id.as_deref())
                        .or_else(|| {
                            app.derived_from
                                .as_ref()
                                .map(|derived| derived.app_id.as_str())
                        });
                    let upstream_base_release_id = latest_release
                        .as_ref()
                        .and_then(|release| release.upstream_base_release_id.clone())
                        .or_else(|| {
                            app.derived_from
                                .as_ref()
                                .map(|derived| derived.release_id.clone())
                        });
                    let upstream_latest_release_id = upstream_app_id.and_then(|upstream_app_id| {
                        latest_release_for_app(&registry, upstream_app_id)
                            .map(|release| release.release_id.clone())
                    });
                    let upstream_update_available = upstream_base_release_id
                        .as_ref()
                        .zip(upstream_latest_release_id.as_ref())
                        .is_some_and(|(base, latest)| base != latest);
                    let state = match activation.as_ref() {
                        Some(activation) if activation.selected_app_id == app.app_id => {
                            if activation.enabled {
                                AppVariantState::Active
                            } else {
                                AppVariantState::Disabled
                            }
                        }
                        _ => AppVariantState::Available,
                    };
                    AppVariantProjection {
                        app,
                        releases,
                        latest_release,
                        upstream_base_release_id,
                        upstream_latest_release_id,
                        upstream_update_available,
                        state,
                    }
                })
                .collect();
            slots.push(AppSlotProjection {
                slot_id,
                display_name,
                activation,
                variants,
            });
        }

        AppCatalogProjection {
            slots,
            drafts: registry.drafts.values().cloned().collect(),
        }
    }

    pub async fn create_intelligent_app(
        &self,
        request: CreateIntelligentAppRequest,
    ) -> CoreResult<CreatedApp> {
        let _mutation = self.mutation_lock.lock().await;
        request.owner.validate()?;
        if request.owner.kind == AppOwnerKind::System {
            return Err(CoreError::validation(
                "System apps must be imported as signed releases, not created as editable drafts",
            ));
        }

        let app_id = request
            .app_id
            .unwrap_or_else(|| format!("app_{}", Uuid::new_v4().simple()));
        let slot_id = request.slot_id.unwrap_or_else(|| app_id.clone());
        let display_name = request
            .display_name
            .unwrap_or_else(|| "Untitled App".to_string());
        validate_app_fields(&app_id, &slot_id, &display_name)?;

        let app = AppRecord {
            app_id: app_id.clone(),
            slot_id,
            display_name,
            description: normalize_description(request.description)?,
            owner: request.owner,
            derived_from: None,
            created_at_ms: now_ms(),
        };
        let draft = new_draft_record(&app_id, None, None);
        let draft_path = resolve_store_relative_path(&self.root, &draft.path)?;

        let current = self.registry.read().await.clone();
        ensure_app_id_available(&current, &app_id)?;
        create_draft_directory(&draft_path, None, &draft).await?;

        let mut next = current;
        next.apps.insert(app_id, app.clone());
        next.drafts.insert(draft.draft_id.clone(), draft.clone());
        if let Err(error) = self.commit_registry(next).await {
            let _ = fs::remove_dir_all(&draft_path).await;
            return Err(error);
        }

        Ok(CreatedApp { app, draft })
    }

    pub async fn create_empty_draft(&self, app_id: &str) -> CoreResult<DraftRecord> {
        self.create_draft(CreateDraftRequest {
            app_id: app_id.to_string(),
            base_release_id: None,
        })
        .await
    }

    pub async fn create_draft(&self, request: CreateDraftRequest) -> CoreResult<DraftRecord> {
        let _mutation = self.mutation_lock.lock().await;
        let current = self.registry.read().await.clone();
        let app = current
            .apps
            .get(&request.app_id)
            .ok_or_else(|| CoreError::NotFound(format!("Intelligent App {}", request.app_id)))?;
        if app.owner.kind == AppOwnerKind::System {
            return Err(CoreError::validation(
                "System releases are immutable; fork the release before editing",
            ));
        }
        let source_path = if let Some(base_release_id) = request.base_release_id.as_deref() {
            let release = current.releases.get(base_release_id).ok_or_else(|| {
                CoreError::NotFound(format!("Intelligent App release {base_release_id}"))
            })?;
            if release.app_id != request.app_id {
                return Err(CoreError::validation(format!(
                    "Release {base_release_id} belongs to app {}, not {}",
                    release.app_id, request.app_id
                )));
            }
            Some(artifact_path_for_digest(
                &self.root,
                &release.artifact_digest,
            )?)
        } else {
            None
        };

        let draft = new_draft_record(&request.app_id, request.base_release_id, None);
        let draft_path = resolve_store_relative_path(&self.root, &draft.path)?;
        create_draft_directory(&draft_path, source_path.as_deref(), &draft).await?;

        let mut next = current;
        next.drafts.insert(draft.draft_id.clone(), draft.clone());
        if let Err(error) = self.commit_registry(next).await {
            let _ = fs::remove_dir_all(&draft_path).await;
            return Err(error);
        }
        Ok(draft)
    }

    /// Creates an explicit three-way merge draft for an owner-controlled fork.
    ///
    /// The editable tree starts from `current_release_id`. Immutable snapshots of the
    /// upstream base and target are materialized below `.sparo_os/rebase/` so Builder can
    /// perform a deterministic merge without reaching back into mutable catalog state.
    pub async fn create_rebase_draft(
        &self,
        app_id: &str,
        current_release_id: &str,
        target_upstream_release_id: &str,
    ) -> CoreResult<DraftRecord> {
        let _mutation = self.mutation_lock.lock().await;
        validate_identifier("appId", app_id)?;
        validate_identifier("currentReleaseId", current_release_id)?;
        validate_identifier("targetUpstreamReleaseId", target_upstream_release_id)?;

        let current = self.registry.read().await.clone();
        let app = current
            .apps
            .get(app_id)
            .ok_or_else(|| CoreError::NotFound(format!("Intelligent App {app_id}")))?;
        if app.owner.kind == AppOwnerKind::System {
            return Err(CoreError::validation(
                "System releases are upstream sources and cannot create rebase drafts",
            ));
        }

        let current_release = current.releases.get(current_release_id).ok_or_else(|| {
            CoreError::NotFound(format!("Intelligent App release {current_release_id}"))
        })?;
        if current_release.app_id != app_id {
            return Err(CoreError::validation(format!(
                "Release {current_release_id} belongs to app {}, not {app_id}",
                current_release.app_id
            )));
        }
        let upstream_app_id = current_release.upstream_app_id.clone().ok_or_else(|| {
            CoreError::validation(format!(
                "Release {current_release_id} is not connected to an upstream fork lineage"
            ))
        })?;
        let upstream_base_release_id = current_release
            .upstream_base_release_id
            .clone()
            .ok_or_else(|| {
                CoreError::validation(format!(
                    "Release {current_release_id} has no upstream base release"
                ))
            })?;
        let rebase_context = DraftRebaseContext {
            upstream_app_id,
            base_release_id: upstream_base_release_id,
            target_release_id: target_upstream_release_id.to_string(),
        };
        validate_rebase_context(&current, app, current_release, &rebase_context)?;

        let draft = new_draft_record(
            app_id,
            Some(current_release_id.to_string()),
            Some(rebase_context.clone()),
        );
        let draft_path = resolve_store_relative_path(&self.root, &draft.path)?;
        let current_source =
            artifact_path_for_digest(&self.root, &current_release.artifact_digest)?;
        create_draft_directory(&draft_path, Some(&current_source), &draft).await?;
        if let Err(error) = materialize_rebase_workspace(
            &self.root,
            &draft_path,
            &draft,
            current_release,
            &rebase_context,
            &current,
        )
        .await
        {
            let _ = remove_tree_force(&draft_path).await;
            return Err(error);
        }

        let mut next = current;
        next.drafts.insert(draft.draft_id.clone(), draft.clone());
        if let Err(error) = self.commit_registry(next).await {
            let _ = remove_tree_force(&draft_path).await;
            return Err(error);
        }
        Ok(draft)
    }

    /// Forks every app, including system-owned apps, into a new owner-controlled app and draft.
    pub async fn fork_release(&self, request: ForkReleaseRequest) -> CoreResult<CreatedApp> {
        let _mutation = self.mutation_lock.lock().await;
        request.owner.validate()?;
        if request.owner.kind == AppOwnerKind::System {
            return Err(CoreError::validation(
                "A fork must be owned by a user or organization",
            ));
        }
        let current = self.registry.read().await.clone();
        let source_release = current
            .releases
            .get(&request.source_release_id)
            .cloned()
            .ok_or_else(|| {
                CoreError::NotFound(format!(
                    "Intelligent App release {}",
                    request.source_release_id
                ))
            })?;
        let source_app = current
            .apps
            .get(&source_release.app_id)
            .cloned()
            .ok_or_else(|| {
                CoreError::NotFound(format!("Intelligent App {}", source_release.app_id))
            })?;

        let app_id = request
            .new_app_id
            .unwrap_or_else(|| format!("app_{}", Uuid::new_v4().simple()));
        ensure_app_id_available(&current, &app_id)?;
        let slot_id = request.slot_id.unwrap_or(source_app.slot_id.clone());
        let display_name = request.display_name.unwrap_or(source_app.display_name);
        validate_app_fields(&app_id, &slot_id, &display_name)?;

        let app = AppRecord {
            app_id: app_id.clone(),
            slot_id,
            display_name,
            description: normalize_description(request.description.or(source_app.description))?,
            owner: request.owner,
            derived_from: Some(AppDerivation {
                app_id: source_release.app_id.clone(),
                release_id: source_release.release_id.clone(),
            }),
            created_at_ms: now_ms(),
        };
        let draft = new_draft_record(&app_id, Some(source_release.release_id.clone()), None);
        let draft_path = resolve_store_relative_path(&self.root, &draft.path)?;
        let source_path = artifact_path_for_digest(&self.root, &source_release.artifact_digest)?;
        create_draft_directory(&draft_path, Some(&source_path), &draft).await?;
        if let Err(error) = rebind_draft_package_identity(&draft_path, &app_id).await {
            let _ = fs::remove_dir_all(&draft_path).await;
            return Err(error);
        }
        if let Err(error) = materialize_fork_draft_contract(
            &draft_path,
            &source_release.data_schema_version,
            &source_release.runtime_compatibility,
        )
        .await
        {
            let _ = fs::remove_dir_all(&draft_path).await;
            return Err(error);
        }

        let mut next = current;
        next.apps.insert(app_id, app.clone());
        next.drafts.insert(draft.draft_id.clone(), draft.clone());
        if let Err(error) = self.commit_registry(next).await {
            let _ = fs::remove_dir_all(&draft_path).await;
            return Err(error);
        }

        Ok(CreatedApp { app, draft })
    }

    pub async fn publish_draft(
        &self,
        request: PublishDraftRequest,
        shared_components: &[ComponentDefinition],
    ) -> CoreResult<ReleaseRecord> {
        let _draft_lock = acquire_draft_lock(&request.draft_id).await;
        let _mutation = self.mutation_lock.lock().await;
        let current = self.registry.read().await.clone();
        let draft = current
            .drafts
            .get(&request.draft_id)
            .cloned()
            .ok_or_else(|| CoreError::NotFound(format!("App draft {}", request.draft_id)))?;
        let app = current
            .apps
            .get(&draft.app_id)
            .ok_or_else(|| CoreError::NotFound(format!("Intelligent App {}", draft.app_id)))?;
        validate_draft_base(&current, &draft)?;
        validate_release_provenance(app.owner.kind, request.provenance)?;
        if let Some(existing) = current
            .releases
            .values()
            .find(|release| release.app_id == draft.app_id && release.version == request.version)
        {
            return Err(CoreError::validation(format!(
                "Intelligent App {} version {} is already bound to immutable Release {}; publish under a new version",
                draft.app_id, request.version, existing.release_id
            )));
        }
        let draft_path = resolve_store_relative_path(&self.root, &draft.path)?;
        validate_draft_manifest(&draft_path, &draft).await?;
        if let Some(rebase) = draft.rebase_context.as_ref() {
            let current_release_id = draft.base_release_id.as_deref().ok_or_else(|| {
                CoreError::validation(format!(
                    "Rebase draft {} has no current fork release",
                    draft.draft_id
                ))
            })?;
            let current_release = current.releases.get(current_release_id).ok_or_else(|| {
                CoreError::NotFound(format!("Intelligent App release {current_release_id}"))
            })?;
            validate_rebase_context(&current, app, current_release, rebase)?;
            validate_rebase_workspace(
                &self.root,
                &draft_path,
                app,
                current_release,
                rebase,
                &current,
            )
            .await?;
        }

        // Release preparation is intentionally destructive to its input (version normalization,
        // lock refresh, evaluation report generation). Run it only on a private store-owned copy
        // so every failure leaves the user's mutable Draft byte-for-byte unchanged.
        let staging_path = create_publish_staging(&self.root, &draft_path).await?;
        let staged = async {
            let prepared =
                prepare_draft_release(&staging_path, &request.version, shared_components).await?;
            if prepared.app.id != draft.app_id {
                return Err(CoreError::validation(format!(
                    "Draft {} package belongs to app {}, expected {}",
                    draft.draft_id, prepared.app.id, draft.app_id
                )));
            }
            validate_app_fields(&app.app_id, &app.slot_id, &prepared.app.name)?;
            let description = normalize_description(Some(prepared.app.description.clone()))?;
            let mut metadata = ReleaseMetadata {
                version: request.version.clone(),
                component_lock_digest: prepared.component_lock_digest,
                config_revision: prepared.config_revision,
                data_schema_version: prepared.data_schema_version,
                runtime_compatibility: prepared.runtime_compatibility,
                capability_fingerprint: prepared.capability_fingerprint,
                evaluation_report_digest: prepared.evaluation_report_digest,
                runtime: ReleaseRuntimeSpec::from_app(&prepared.app),
                label: request.label.clone(),
                notes: request.notes.clone(),
                provenance: request.provenance,
                signature: None,
                upstream_app_id: None,
                upstream_base_release_id: None,
            };
            if let Some(rebase) = draft.rebase_context.as_ref() {
                metadata.upstream_app_id = Some(rebase.upstream_app_id.clone());
                metadata.upstream_base_release_id = Some(rebase.target_release_id.clone());
            }
            let parent_release = draft
                .base_release_id
                .as_deref()
                .and_then(|release_id| current.releases.get(release_id));
            let metadata = inherit_fork_upstream(app, parent_release, metadata);
            validate_release_metadata(&metadata)?;
            validate_upstream_release(&current, &metadata)?;

            let artifact_digest = commit_artifact(&self.root, &staging_path).await?;
            let parent_release_id = draft.base_release_id.clone().filter(|release_id| {
                current
                    .releases
                    .get(release_id)
                    .is_some_and(|release| release.app_id == draft.app_id)
            });
            let release = build_release_record(
                &draft.app_id,
                &app.slot_id,
                parent_release_id,
                artifact_digest,
                metadata,
            )?;
            Ok::<_, CoreError>((release, prepared.app.name, description))
        }
        .await;

        let cleanup_result = remove_tree_force(&staging_path).await;
        let (release, display_name, description) = match staged {
            Ok(result) => {
                cleanup_result?;
                result
            }
            Err(error) => {
                if let Err(cleanup_error) = cleanup_result {
                    log::warn!(
                        "Failed to clean failed app publish staging: draft_id={}, path={}, error={}",
                        draft.draft_id,
                        staging_path.display(),
                        cleanup_error
                    );
                }
                return Err(error);
            }
        };

        let mut next = current;
        if let Some(app) = next.apps.get_mut(&draft.app_id) {
            app.display_name = display_name;
            app.description = description;
        }
        let published_release = next
            .releases
            .entry(release.release_id.clone())
            .or_insert(release)
            .clone();
        next.drafts.remove(&draft.draft_id);
        self.commit_registry(next).await?;
        remove_draft_directory(&draft, &draft_path).await;
        Ok(published_release)
    }

    // Retained as the strict import primitive for non-System publishing and
    // contract tests; built-in snapshots use the specialized synchronizer.
    #[allow(dead_code)]
    pub(super) async fn import_release_from_package(
        &self,
        package_dir: &Path,
        request: ImportReleaseFromPackageRequest,
    ) -> CoreResult<ReleaseRecord> {
        let _mutation = self.mutation_lock.lock().await;
        request.owner.validate()?;
        validate_app_fields(&request.app_id, &request.slot_id, &request.display_name)?;
        validate_release_metadata(&request.metadata)?;
        validate_release_provenance(request.owner.kind, request.metadata.provenance)?;
        if !package_dir.is_dir() {
            return Err(CoreError::NotFound(format!(
                "Intelligent App package {}",
                package_dir.display()
            )));
        }

        let current = self.registry.read().await.clone();
        if let Some(existing) = current.apps.get(&request.app_id) {
            if existing.owner != request.owner || existing.slot_id != request.slot_id {
                return Err(CoreError::validation(format!(
                    "App {} already exists with different ownership or slot",
                    request.app_id
                )));
            }
        } else {
            ensure_app_id_available(&current, &request.app_id)?;
        }
        validate_parent_release(
            &current,
            &request.app_id,
            request.parent_release_id.as_deref(),
        )?;
        validate_upstream_release(&current, &request.metadata)?;

        let artifact_digest = commit_artifact(&self.root, package_dir).await?;
        let release = build_release_record(
            &request.app_id,
            &request.slot_id,
            request.parent_release_id,
            artifact_digest,
            request.metadata,
        )?;
        if let Some(existing) = current.releases.values().find(|existing| {
            existing.app_id == release.app_id && existing.version == release.version
        }) {
            if existing.release_id == release.release_id {
                return Ok(existing.clone());
            }
            cleanup_unreferenced_artifacts(&self.root, &current).await?;
            return Err(CoreError::validation(format!(
                "Intelligent App {} version {} is already bound to immutable Release {}; publish changed content under a new version",
                release.app_id, release.version, existing.release_id
            )));
        }
        if let Some(existing) = current.releases.get(&release.release_id) {
            return Ok(existing.clone());
        }

        let mut next = current;
        next.apps
            .entry(request.app_id.clone())
            .or_insert(AppRecord {
                app_id: request.app_id,
                slot_id: request.slot_id,
                display_name: request.display_name,
                description: normalize_description(request.description)?,
                owner: request.owner,
                derived_from: None,
                created_at_ms: now_ms(),
            });
        next.releases
            .insert(release.release_id.clone(), release.clone());
        self.commit_registry(next).await?;
        Ok(release)
    }

    /// Synchronizes the current System-owned App snapshot without weakening the
    /// immutable publishing contract used by user, organization, and generated
    /// Releases. A changed system package may retain its declared version; its
    /// content-addressed Release is replaced atomically together with official
    /// routing and current-version-only registry cleanup.
    pub(super) async fn sync_system_release_from_package(
        &self,
        package_dir: &Path,
        request: ImportReleaseFromPackageRequest,
    ) -> CoreResult<(
        ReleaseRecord,
        SystemReleaseSyncOutcome,
        SystemReleaseInitializationOutcome,
    )> {
        let _mutation = self.mutation_lock.lock().await;
        if request.owner != AppOwner::system()
            || request.metadata.provenance != ReleaseProvenanceKind::System
        {
            return Err(CoreError::validation(
                "System snapshot synchronization only accepts System-owned Releases",
            ));
        }
        request.owner.validate()?;
        validate_app_fields(&request.app_id, &request.slot_id, &request.display_name)?;
        let description = normalize_description(request.description.clone())?;
        validate_release_metadata(&request.metadata)?;
        validate_release_provenance(request.owner.kind, request.metadata.provenance)?;
        if !package_dir.is_dir() {
            return Err(CoreError::NotFound(format!(
                "Intelligent App package {}",
                package_dir.display()
            )));
        }

        let current = self.registry.read().await.clone();
        if let Some(existing) = current.apps.get(&request.app_id) {
            if existing.owner != request.owner || existing.slot_id != request.slot_id {
                return Err(CoreError::validation(format!(
                    "App {} already exists with different ownership or slot",
                    request.app_id
                )));
            }
        } else if !current.retired_app_ids.contains(&request.app_id) {
            ensure_app_id_available(&current, &request.app_id)?;
        }
        validate_parent_release(
            &current,
            &request.app_id,
            request.parent_release_id.as_deref(),
        )?;
        validate_upstream_release(&current, &request.metadata)?;

        let artifact_digest = commit_artifact(&self.root, package_dir).await?;
        let release = match build_release_record(
            &request.app_id,
            &request.slot_id,
            request.parent_release_id,
            artifact_digest,
            request.metadata,
        ) {
            Ok(release) => release,
            Err(error) => {
                cleanup_unreferenced_artifacts(&self.root, &current).await?;
                return Err(error);
            }
        };

        let had_release = current.releases.contains_key(&release.release_id);
        let had_other_release = current.releases.values().any(|existing| {
            existing.app_id == release.app_id && existing.release_id != release.release_id
        });
        let sync_outcome = if had_release {
            SystemReleaseSyncOutcome::Reused
        } else if had_other_release {
            SystemReleaseSyncOutcome::Replaced
        } else {
            SystemReleaseSyncOutcome::Added
        };

        let mut next = current.clone();
        next.retired_app_ids.remove(&request.app_id);
        match next.apps.get_mut(&request.app_id) {
            Some(app) => {
                app.display_name = request.display_name.clone();
                app.description = description;
            }
            None => {
                next.apps.insert(
                    request.app_id.clone(),
                    AppRecord {
                        app_id: request.app_id.clone(),
                        slot_id: request.slot_id.clone(),
                        display_name: request.display_name.clone(),
                        description,
                        owner: request.owner,
                        derived_from: None,
                        created_at_ms: now_ms(),
                    },
                );
            }
        }
        next.releases
            .insert(release.release_id.clone(), release.clone());

        let activation_request = ActivateReleaseRequest {
            scope: AppActivationScope::System,
            slot_id: release.slot_id.clone(),
            app_id: release.app_id.clone(),
            release_id: release.release_id.clone(),
        };
        if let Err(error) =
            validate_activation_target(&next, &activation_request, env!("CARGO_PKG_VERSION"))
        {
            cleanup_unreferenced_artifacts(&self.root, &current).await?;
            return Err(error);
        }
        let activation_key = activation_key(&activation_request.scope, &activation_request.slot_id);
        let activation_outcome = match next.activations.get(&activation_key) {
            Some(existing) if existing.selected_app_id != release.app_id => {
                SystemReleaseInitializationOutcome::Preserved
            }
            Some(existing)
                if existing.enabled && existing.active_release_id == release.release_id =>
            {
                SystemReleaseInitializationOutcome::Preserved
            }
            _ => {
                next.activations.insert(
                    activation_key,
                    ActivationRecord {
                        scope: activation_request.scope,
                        slot_id: activation_request.slot_id,
                        selected_app_id: activation_request.app_id,
                        active_release_id: activation_request.release_id,
                        enabled: true,
                    },
                );
                SystemReleaseInitializationOutcome::Created
            }
        };

        retain_only_app_release(&mut next, &release.app_id, &release.release_id)?;
        if let Err(error) = self.commit_registry(next).await {
            cleanup_unreferenced_artifacts(&self.root, &current).await?;
            return Err(error);
        }
        let committed = self.registry.read().await.clone();
        if let Err(error) = cleanup_unreferenced_artifacts(&self.root, &committed).await {
            log::warn!(
                "Failed to clean replaced system App artifacts: app_id={}, release_id={}, error={}",
                release.app_id,
                release.release_id,
                error
            );
        }
        Ok((release, sync_outcome, activation_outcome))
    }

    pub async fn resolve_draft(&self, draft_id: &str) -> CoreResult<ResolvedDraft> {
        let draft = self
            .registry
            .read()
            .await
            .drafts
            .get(draft_id)
            .cloned()
            .ok_or_else(|| CoreError::NotFound(format!("App draft {draft_id}")))?;
        let source_path = resolve_store_relative_path(&self.root, &draft.path)?;
        if !source_path.is_dir() {
            return Err(CoreError::NotFound(format!(
                "App draft source {}",
                source_path.display()
            )));
        }
        validate_draft_manifest(&source_path, &draft).await?;
        Ok(ResolvedDraft { draft, source_path })
    }

    /// Permanently removes one mutable Draft without affecting its App identity or Releases.
    pub async fn delete_draft(&self, draft_id: &str) -> CoreResult<DraftRecord> {
        let _draft_lock = acquire_draft_lock(draft_id).await;
        let _mutation = self.mutation_lock.lock().await;
        let current = self.registry.read().await.clone();
        let draft = current
            .drafts
            .get(draft_id)
            .cloned()
            .ok_or_else(|| CoreError::NotFound(format!("App draft {draft_id}")))?;
        let draft_path = resolve_store_relative_path(&self.root, &draft.path)?;

        let mut next = current;
        next.drafts.remove(draft_id);
        self.commit_registry(next).await?;
        remove_draft_directory(&draft, &draft_path).await;
        Ok(draft)
    }

    /// Records a successful Builder write or checkpoint without inspecting mutable source files.
    pub async fn touch_draft(&self, draft_id: &str) -> CoreResult<DraftRecord> {
        let _mutation = self.mutation_lock.lock().await;
        let mut next = self.registry.read().await.clone();
        let draft = next
            .drafts
            .get_mut(draft_id)
            .ok_or_else(|| CoreError::NotFound(format!("App draft {draft_id}")))?;
        draft.updated_at_ms = now_ms().max(draft.created_at_ms);
        let result = draft.clone();
        self.commit_registry(next).await?;
        Ok(result)
    }

    pub async fn resolve_release(
        &self,
        app_id: &str,
        release_id: &str,
    ) -> CoreResult<ResolvedRelease> {
        let release = self
            .registry
            .read()
            .await
            .releases
            .get(release_id)
            .cloned()
            .ok_or_else(|| CoreError::NotFound(format!("App release {release_id}")))?;
        if release.app_id != app_id {
            return Err(CoreError::validation(format!(
                "Release {release_id} belongs to app {}, not {app_id}",
                release.app_id
            )));
        }
        let artifact_path = artifact_path_for_digest(&self.root, &release.artifact_digest)?;
        if !artifact_path.is_dir() {
            return Err(CoreError::NotFound(format!(
                "Release artifact {}",
                artifact_path.display()
            )));
        }
        Ok(ResolvedRelease {
            release,
            artifact_path,
        })
    }

    pub async fn verify_release_artifact(&self, release_id: &str) -> CoreResult<()> {
        let release = self
            .registry
            .read()
            .await
            .releases
            .get(release_id)
            .cloned()
            .ok_or_else(|| CoreError::NotFound(format!("App release {release_id}")))?;
        let artifact_path = artifact_path_for_digest(&self.root, &release.artifact_digest)?;
        let actual = digest_directory(&artifact_path).await?;
        if actual != release.artifact_digest {
            return Err(CoreError::validation(format!(
                "Release artifact digest mismatch for {release_id}: expected={}, actual={actual}",
                release.artifact_digest
            )));
        }
        Ok(())
    }

    #[cfg(test)]
    pub(super) async fn activate(
        &self,
        request: ActivateReleaseRequest,
    ) -> CoreResult<ActivationRecord> {
        self.activate_for_runtime(
            request,
            env!("CARGO_PKG_VERSION"),
            ActivationExpectation::Unchecked,
        )
        .await
    }

    pub(super) async fn activate_if_current(
        &self,
        request: ActivateReleaseRequest,
        expected_effective_activation: Option<&ActivationRecord>,
    ) -> CoreResult<ActivationRecord> {
        self.activate_for_runtime(
            request,
            env!("CARGO_PKG_VERSION"),
            ActivationExpectation::Exact(expected_effective_activation),
        )
        .await
    }

    async fn activate_for_runtime(
        &self,
        request: ActivateReleaseRequest,
        runtime_version: &str,
        expectation: ActivationExpectation<'_>,
    ) -> CoreResult<ActivationRecord> {
        let _mutation = self.mutation_lock.lock().await;
        let current = self.registry.read().await.clone();
        validate_activation_target(&current, &request, runtime_version)?;

        match expectation {
            #[cfg(test)]
            ActivationExpectation::Unchecked => {}
            ActivationExpectation::Exact(expected) => {
                let observed = effective_activation(&current, &request.scope, &request.slot_id);
                if observed != expected {
                    return Err(CoreError::validation(format!(
                        "App activation for scope={}, slot={} changed after authorization",
                        request.scope.registry_key(),
                        request.slot_id
                    )));
                }
            }
        }

        let key = activation_key(&request.scope, &request.slot_id);
        if let Some(existing) = current.activations.get(&key) {
            if existing.enabled
                && existing.selected_app_id == request.app_id
                && existing.active_release_id == request.release_id
            {
                return Ok(existing.clone());
            }
        }
        let activation = ActivationRecord {
            scope: request.scope,
            slot_id: request.slot_id,
            selected_app_id: request.app_id,
            active_release_id: request.release_id,
            enabled: true,
        };
        let mut next = current;
        next.activations.insert(key, activation.clone());
        self.commit_registry(next).await?;
        Ok(activation)
    }

    /// Initializes an empty system slot from a bundled Release while preserving
    /// every existing selection. Startup discovers updates; only an explicit
    /// user activation may switch an installed slot to a newer Release.
    #[allow(dead_code)]
    pub(super) async fn initialize_system_release(
        &self,
        request: ActivateReleaseRequest,
    ) -> CoreResult<(ActivationRecord, SystemReleaseInitializationOutcome)> {
        let _mutation = self.mutation_lock.lock().await;
        request.scope.validate()?;
        validate_identifier("slotId", &request.slot_id)?;
        let current = self.registry.read().await.clone();
        validate_activation_target(&current, &request, env!("CARGO_PKG_VERSION"))?;
        let app = current
            .apps
            .get(&request.app_id)
            .ok_or_else(|| CoreError::NotFound(format!("Intelligent App {}", request.app_id)))?;
        if app.owner.kind != AppOwnerKind::System {
            return Err(CoreError::validation(format!(
                "Default system activation requires a system-owned App: {}",
                request.app_id
            )));
        }

        let key = activation_key(&request.scope, &request.slot_id);
        if let Some(existing) = current.activations.get(&key) {
            if existing.selected_app_id != request.app_id {
                return Ok((
                    existing.clone(),
                    SystemReleaseInitializationOutcome::Preserved,
                ));
            }
            if existing.enabled && existing.active_release_id == request.release_id {
                return Ok((
                    existing.clone(),
                    SystemReleaseInitializationOutcome::Preserved,
                ));
            }
        }

        let activation = ActivationRecord {
            scope: request.scope,
            slot_id: request.slot_id,
            selected_app_id: request.app_id,
            active_release_id: request.release_id,
            enabled: true,
        };
        let mut next = current;
        next.activations.insert(key, activation.clone());
        self.commit_registry(next).await?;
        Ok((activation, SystemReleaseInitializationOutcome::Created))
    }

    /// Keeps exactly one executable Release for an App and removes every older
    /// artifact. Draft source directories survive, but are rebased onto the
    /// retained Release so no mutable authoring state depends on deleted code.
    pub async fn prune_app_releases_except(
        &self,
        app_id: &str,
        keep_release_id: &str,
    ) -> CoreResult<Vec<ReleaseRecord>> {
        let _mutation = self.mutation_lock.lock().await;
        let mut next = self.registry.read().await.clone();
        let removed = retain_only_app_release(&mut next, app_id, keep_release_id)?;
        if removed.is_empty() {
            return Ok(Vec::new());
        }
        self.commit_registry(next).await?;
        let committed = self.registry.read().await.clone();
        cleanup_unreferenced_artifacts(&self.root, &committed).await?;
        Ok(removed)
    }

    /// Permanently removes an official System App that is no longer bundled.
    /// User-owned forks and their source trees survive with stale upstream
    /// references detached from the removed immutable Releases.
    pub(super) async fn retire_system_app(&self, app_id: &str) -> CoreResult<bool> {
        let _mutation = self.mutation_lock.lock().await;
        validate_identifier("appId", app_id)?;
        let current = self.registry.read().await.clone();
        let Some(app) = current.apps.get(app_id).cloned() else {
            return Ok(false);
        };
        if app.owner.kind != AppOwnerKind::System {
            return Err(CoreError::validation(format!(
                "Only System-owned apps can be retired during bundle synchronization: {app_id}"
            )));
        }
        if current.drafts.values().any(|draft| draft.app_id == app_id) {
            return Err(CoreError::validation(format!(
                "System App {app_id} unexpectedly owns mutable Drafts"
            )));
        }

        let removed_release_ids = current
            .releases
            .values()
            .filter(|release| release.app_id == app_id)
            .map(|release| release.release_id.clone())
            .collect::<BTreeSet<_>>();
        let mut next = current;
        let activation_keys = next.activations.keys().cloned().collect::<Vec<_>>();
        for key in activation_keys {
            let Some(mut activation) = next.activations.get(&key).cloned() else {
                continue;
            };
            if activation.selected_app_id != app_id {
                continue;
            }
            let replacement_release = next
                .releases
                .values()
                .filter(|release| release.app_id != app_id && release.slot_id == app.slot_id)
                .filter(|release| {
                    next.apps
                        .get(&release.app_id)
                        .is_some_and(|candidate| candidate.owner.kind == AppOwnerKind::System)
                })
                .min_by(|left, right| compare_releases_descending(left, right))
                .cloned();
            if let Some(replacement) = replacement_release {
                activation.selected_app_id = replacement.app_id.clone();
                activation.active_release_id = replacement.release_id.clone();
                next.activations.insert(key, activation);
            } else {
                next.activations.remove(&key);
            }
        }

        next.apps.remove(app_id);
        next.releases.retain(|_, release| release.app_id != app_id);
        for remaining_app in next.apps.values_mut() {
            if remaining_app
                .derived_from
                .as_ref()
                .is_some_and(|derived| derived.app_id == app_id)
            {
                remaining_app.derived_from = None;
            }
        }
        for release in next.releases.values_mut() {
            if release
                .parent_release_id
                .as_ref()
                .is_some_and(|release_id| removed_release_ids.contains(release_id))
            {
                release.parent_release_id = None;
            }
            if release
                .upstream_base_release_id
                .as_ref()
                .is_some_and(|release_id| removed_release_ids.contains(release_id))
            {
                release.upstream_app_id = None;
                release.upstream_base_release_id = None;
            }
        }
        for draft in next.drafts.values_mut() {
            if draft
                .base_release_id
                .as_ref()
                .is_some_and(|release_id| removed_release_ids.contains(release_id))
            {
                draft.base_release_id = None;
                draft.rebase_context = None;
            } else if draft.rebase_context.as_ref().is_some_and(|context| {
                removed_release_ids.contains(&context.base_release_id)
                    || removed_release_ids.contains(&context.target_release_id)
            }) {
                draft.rebase_context = None;
            }
        }
        next.retired_app_ids.insert(app_id.to_string());
        self.commit_registry(next).await?;
        let committed = self.registry.read().await.clone();
        cleanup_unreferenced_artifacts(&self.root, &committed).await?;
        Ok(true)
    }

    pub async fn deactivate(
        &self,
        scope: &AppActivationScope,
        slot_id: &str,
    ) -> CoreResult<ActivationRecord> {
        let _mutation = self.mutation_lock.lock().await;
        scope.validate()?;
        validate_identifier("slotId", slot_id)?;
        let mut next = self.registry.read().await.clone();
        let key = activation_key(scope, slot_id);
        if !next.activations.contains_key(&key) {
            let inherited = effective_activation(&next, scope, slot_id)
                .cloned()
                .ok_or_else(|| {
                    CoreError::NotFound(format!(
                        "App activation for scope={}, slot={slot_id}",
                        scope.registry_key()
                    ))
                })?;
            next.activations.insert(
                key.clone(),
                ActivationRecord {
                    scope: scope.clone(),
                    slot_id: slot_id.to_string(),
                    ..inherited
                },
            );
        }
        let activation = next.activations.get_mut(&key).expect("activation inserted");
        if !activation.enabled {
            return Ok(activation.clone());
        }
        activation.enabled = false;
        let result = activation.clone();
        self.commit_registry(next).await?;
        Ok(result)
    }

    /// Permanently removes a user- or organization-owned app, its Releases, and
    /// its unreferenced artifacts. System apps must be deactivated instead.
    pub async fn archive_app(&self, app_id: &str) -> CoreResult<ArchivedApp> {
        // Draft tools do not take the registry mutation lock, so collect and lock every
        // current Draft before committing the archive. A Draft may be created while locks
        // are being acquired; repeat until the mutation lock proves the set is complete.
        let mut locked_draft_ids = BTreeSet::new();
        let mut _draft_locks = Vec::new();
        let (_mutation, current) = loop {
            let mut missing = self
                .registry
                .read()
                .await
                .drafts
                .values()
                .filter(|draft| {
                    draft.app_id == app_id && !locked_draft_ids.contains(&draft.draft_id)
                })
                .map(|draft| draft.draft_id.clone())
                .collect::<Vec<_>>();
            missing.sort();
            if !missing.is_empty() {
                for draft_id in missing {
                    _draft_locks.push(acquire_draft_lock(&draft_id).await);
                    locked_draft_ids.insert(draft_id);
                }
                continue;
            }

            let mutation = self.mutation_lock.lock().await;
            let current = self.registry.read().await.clone();
            let complete = current
                .drafts
                .values()
                .all(|draft| draft.app_id != app_id || locked_draft_ids.contains(&draft.draft_id));
            if complete {
                break (mutation, current);
            }
            drop(mutation);
        };
        let app = current
            .apps
            .get(app_id)
            .cloned()
            .ok_or_else(|| CoreError::NotFound(format!("Intelligent App {app_id}")))?;
        if app.owner.kind == AppOwnerKind::System {
            return Err(CoreError::validation(
                "System apps cannot be archived; deactivate their slot instead",
            ));
        }
        let drafts = current
            .drafts
            .values()
            .filter(|draft| draft.app_id == app_id)
            .cloned()
            .collect::<Vec<_>>();
        let removed_releases = current
            .releases
            .values()
            .filter(|release| release.app_id == app_id)
            .cloned()
            .collect::<Vec<_>>();
        let removed_release_ids = removed_releases
            .iter()
            .map(|release| release.release_id.clone())
            .collect::<Vec<_>>();
        let removed_release_id_set = removed_release_ids.iter().cloned().collect::<BTreeSet<_>>();
        let mut next = current;
        let activation_keys = next.activations.keys().cloned().collect::<Vec<_>>();
        for key in activation_keys {
            let Some(mut activation) = next.activations.get(&key).cloned() else {
                continue;
            };
            let replacement_release = next
                .releases
                .values()
                .filter(|release| release.app_id != app_id && release.slot_id == app.slot_id)
                .filter(|release| {
                    next.apps
                        .get(&release.app_id)
                        .is_some_and(|candidate| candidate.owner.kind == AppOwnerKind::System)
                })
                .min_by(|left, right| compare_releases_descending(left, right))
                .cloned();
            if activation.selected_app_id == app_id {
                if let Some(replacement) = replacement_release {
                    activation.selected_app_id = replacement.app_id.clone();
                    activation.active_release_id = replacement.release_id.clone();
                    next.activations.insert(key, activation);
                } else {
                    next.activations.remove(&key);
                }
            }
        }
        next.apps.remove(app_id);
        next.releases.retain(|_, release| release.app_id != app_id);
        for remaining_app in next.apps.values_mut() {
            if remaining_app
                .derived_from
                .as_ref()
                .is_some_and(|derived| derived.app_id == app_id)
            {
                remaining_app.derived_from = None;
            }
        }
        for release in next.releases.values_mut() {
            if release
                .parent_release_id
                .as_ref()
                .is_some_and(|release_id| removed_release_id_set.contains(release_id))
            {
                release.parent_release_id = None;
            }
            if release
                .upstream_base_release_id
                .as_ref()
                .is_some_and(|release_id| removed_release_id_set.contains(release_id))
            {
                release.upstream_app_id = None;
                release.upstream_base_release_id = None;
            }
        }
        for draft in next.drafts.values_mut() {
            if draft
                .base_release_id
                .as_ref()
                .is_some_and(|release_id| removed_release_id_set.contains(release_id))
            {
                draft.base_release_id = None;
                draft.rebase_context = None;
            } else if draft.rebase_context.as_ref().is_some_and(|context| {
                removed_release_id_set.contains(&context.base_release_id)
                    || removed_release_id_set.contains(&context.target_release_id)
            }) {
                draft.rebase_context = None;
            }
        }
        next.retired_app_ids.insert(app_id.to_string());
        for draft in &drafts {
            next.drafts.remove(&draft.draft_id);
        }
        self.commit_registry(next).await?;

        for draft in &drafts {
            let path = resolve_store_relative_path(&self.root, &draft.path)?;
            remove_draft_directory(draft, &path).await;
        }
        let committed = self.registry.read().await.clone();
        cleanup_unreferenced_artifacts(&self.root, &committed).await?;
        Ok(ArchivedApp {
            app,
            removed_draft_ids: drafts.into_iter().map(|draft| draft.draft_id).collect(),
            removed_release_ids,
        })
    }

    async fn commit_registry(&self, next: Registry) -> CoreResult<()> {
        validate_registry(&self.root, &next)?;
        persist_registry(&self.root, &next).await?;
        *self.registry.write().await = next;
        Ok(())
    }
}

fn retain_only_app_release(
    registry: &mut Registry,
    app_id: &str,
    keep_release_id: &str,
) -> CoreResult<Vec<ReleaseRecord>> {
    let keep = registry
        .releases
        .get(keep_release_id)
        .ok_or_else(|| CoreError::NotFound(format!("Intelligent App release {keep_release_id}")))?;
    if keep.app_id != app_id {
        return Err(CoreError::validation(format!(
            "Release {keep_release_id} belongs to App {}, not {app_id}",
            keep.app_id
        )));
    }
    let removed = registry
        .releases
        .values()
        .filter(|release| release.app_id == app_id && release.release_id != keep_release_id)
        .cloned()
        .collect::<Vec<_>>();
    if removed.is_empty() {
        return Ok(Vec::new());
    }
    let removed_ids = removed
        .iter()
        .map(|release| release.release_id.clone())
        .collect::<BTreeSet<_>>();
    registry
        .releases
        .retain(|release_id, _| !removed_ids.contains(release_id));
    if let Some(retained) = registry.releases.get_mut(keep_release_id) {
        retained.parent_release_id = None;
        if retained
            .upstream_base_release_id
            .as_ref()
            .is_some_and(|release_id| removed_ids.contains(release_id))
        {
            retained.upstream_app_id = None;
            retained.upstream_base_release_id = None;
        }
    }
    for release in registry.releases.values_mut() {
        if release
            .parent_release_id
            .as_ref()
            .is_some_and(|release_id| removed_ids.contains(release_id))
        {
            release.parent_release_id = None;
        }
        if release
            .upstream_base_release_id
            .as_ref()
            .is_some_and(|release_id| removed_ids.contains(release_id))
        {
            release.upstream_app_id = None;
            release.upstream_base_release_id = None;
        }
    }
    for app in registry.apps.values_mut() {
        if let Some(derived) = app.derived_from.as_mut() {
            if derived.app_id == app_id && removed_ids.contains(&derived.release_id) {
                derived.release_id = keep_release_id.to_string();
            }
        }
    }
    for draft in registry.drafts.values_mut() {
        if draft
            .base_release_id
            .as_ref()
            .is_some_and(|release_id| removed_ids.contains(release_id))
        {
            draft.base_release_id = (draft.app_id == app_id).then(|| keep_release_id.to_string());
            draft.rebase_context = None;
        } else if draft.rebase_context.as_ref().is_some_and(|context| {
            removed_ids.contains(&context.base_release_id)
                || removed_ids.contains(&context.target_release_id)
        }) {
            draft.rebase_context = None;
        }
    }
    Ok(removed)
}

fn new_draft_record(
    app_id: &str,
    base_release_id: Option<String>,
    rebase_context: Option<DraftRebaseContext>,
) -> DraftRecord {
    let draft_id = format!("draft_{}", Uuid::new_v4().simple());
    let timestamp = now_ms();
    DraftRecord {
        path: format!("drafts/{draft_id}"),
        draft_id,
        app_id: app_id.to_string(),
        base_release_id,
        rebase_context,
        created_at_ms: timestamp,
        updated_at_ms: timestamp,
    }
}

fn inherit_fork_upstream(
    app: &AppRecord,
    parent_release: Option<&ReleaseRecord>,
    mut metadata: ReleaseMetadata,
) -> ReleaseMetadata {
    if metadata.upstream_app_id.is_none() {
        if let Some(parent) = parent_release.filter(|release| release.upstream_app_id.is_some()) {
            metadata.upstream_app_id = parent.upstream_app_id.clone();
            metadata.upstream_base_release_id = parent.upstream_base_release_id.clone();
        } else if let Some(derived) = app.derived_from.as_ref() {
            metadata.upstream_app_id = Some(derived.app_id.clone());
            metadata.upstream_base_release_id = Some(derived.release_id.clone());
        }
    }
    metadata
}

fn build_release_record(
    app_id: &str,
    slot_id: &str,
    parent_release_id: Option<String>,
    artifact_digest: String,
    metadata: ReleaseMetadata,
) -> CoreResult<ReleaseRecord> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ReleaseIdentity<'a> {
        app_id: &'a str,
        slot_id: &'a str,
        parent_release_id: &'a Option<String>,
        artifact_digest: &'a str,
        metadata: &'a ReleaseMetadata,
    }

    let identity = ReleaseIdentity {
        app_id,
        slot_id,
        parent_release_id: &parent_release_id,
        artifact_digest: &artifact_digest,
        metadata: &metadata,
    };
    let bytes = serde_json::to_vec(&identity)?;
    let mut hasher = Sha256::new();
    hasher.update(RELEASE_ID_DOMAIN);
    hasher.update(bytes);
    let release_id = format!("release_{}", hex::encode(hasher.finalize()));

    Ok(ReleaseRecord {
        release_id,
        app_id: app_id.to_string(),
        slot_id: slot_id.to_string(),
        parent_release_id,
        artifact_digest,
        component_lock_digest: metadata.component_lock_digest,
        version: metadata.version,
        config_revision: metadata.config_revision,
        data_schema_version: metadata.data_schema_version,
        runtime_compatibility: metadata.runtime_compatibility,
        capability_fingerprint: metadata.capability_fingerprint,
        evaluation_report_digest: metadata.evaluation_report_digest,
        runtime: metadata.runtime,
        label: metadata.label,
        notes: metadata.notes,
        provenance: metadata.provenance,
        signature: metadata.signature,
        upstream_app_id: metadata.upstream_app_id,
        upstream_base_release_id: metadata.upstream_base_release_id,
        created_at_ms: now_ms(),
    })
}

fn validate_activation_target(
    registry: &Registry,
    request: &ActivateReleaseRequest,
    runtime_version: &str,
) -> CoreResult<()> {
    request.scope.validate()?;
    validate_identifier("slotId", &request.slot_id)?;
    let runtime_version = Version::parse(runtime_version).map_err(|error| {
        CoreError::validation(format!(
            "Invalid runtime version {runtime_version}: {error}"
        ))
    })?;
    let app = registry
        .apps
        .get(&request.app_id)
        .ok_or_else(|| CoreError::NotFound(format!("Intelligent App {}", request.app_id)))?;
    if app.slot_id != request.slot_id {
        return Err(CoreError::validation(format!(
            "App {} belongs to slot {}, not {}",
            request.app_id, app.slot_id, request.slot_id
        )));
    }
    let release = registry
        .releases
        .get(&request.release_id)
        .ok_or_else(|| CoreError::NotFound(format!("App release {}", request.release_id)))?;
    if release.app_id != request.app_id {
        return Err(CoreError::validation(format!(
            "Release {} belongs to app {}, not {}",
            request.release_id, release.app_id, request.app_id
        )));
    }
    let requirement = VersionReq::parse(&release.runtime_compatibility).map_err(|error| {
        CoreError::validation(format!(
            "Invalid runtime compatibility {}: {error}",
            release.runtime_compatibility
        ))
    })?;
    if !requirement.matches(&runtime_version) {
        return Err(CoreError::validation(format!(
            "Release {} requires runtime {}, current runtime is {}",
            release.release_id, requirement, runtime_version
        )));
    }
    Ok(())
}

fn validate_release_metadata(metadata: &ReleaseMetadata) -> CoreResult<()> {
    Version::parse(&metadata.version).map_err(|error| {
        CoreError::validation(format!(
            "Invalid Intelligent App release version {}: {error}",
            metadata.version
        ))
    })?;
    Version::parse(&metadata.data_schema_version).map_err(|error| {
        CoreError::validation(format!(
            "Invalid data schema version {}: {error}",
            metadata.data_schema_version
        ))
    })?;
    VersionReq::parse(&metadata.runtime_compatibility).map_err(|error| {
        CoreError::validation(format!(
            "Invalid runtime compatibility {}: {error}",
            metadata.runtime_compatibility
        ))
    })?;
    validate_sha256_digest("componentLockDigest", &metadata.component_lock_digest)?;
    validate_sha256_digest("configRevision", &metadata.config_revision)?;
    validate_sha256_digest("capabilityFingerprint", &metadata.capability_fingerprint)?;
    validate_sha256_digest("evaluationReportDigest", &metadata.evaluation_report_digest)?;
    if metadata
        .label
        .as_deref()
        .is_some_and(|label| label.trim().is_empty() || label.chars().count() > 120)
    {
        return Err(CoreError::validation(
            "Release label must contain 1 to 120 characters",
        ));
    }
    if metadata
        .notes
        .as_deref()
        .is_some_and(|notes| notes.chars().count() > 20_000)
    {
        return Err(CoreError::validation(
            "Release notes must not exceed 20000 characters",
        ));
    }
    if matches!(
        metadata.runtime.launch.as_ref().map(|launch| launch.kind),
        Some(ProductAppLaunchKind::ApplicationSurface)
    ) && metadata.runtime.primary_surface.is_none()
    {
        return Err(CoreError::validation(
            "Application-surface Release requires a primarySurface binding",
        ));
    }
    match (
        metadata.upstream_app_id.as_deref(),
        metadata.upstream_base_release_id.as_deref(),
    ) {
        (Some(app_id), Some(release_id)) => {
            validate_identifier("upstreamAppId", app_id)?;
            validate_identifier("upstreamBaseReleaseId", release_id)
        }
        (None, None) => Ok(()),
        _ => Err(CoreError::validation(
            "upstreamAppId and upstreamBaseReleaseId must be provided together",
        )),
    }
}

fn validate_release_provenance(
    owner: AppOwnerKind,
    provenance: ReleaseProvenanceKind,
) -> CoreResult<()> {
    let valid = match owner {
        AppOwnerKind::System => provenance == ReleaseProvenanceKind::System,
        AppOwnerKind::User => matches!(
            provenance,
            ReleaseProvenanceKind::User
                | ReleaseProvenanceKind::AiGenerated
                | ReleaseProvenanceKind::External
        ),
        AppOwnerKind::Organization => matches!(
            provenance,
            ReleaseProvenanceKind::Organization
                | ReleaseProvenanceKind::AiGenerated
                | ReleaseProvenanceKind::External
        ),
    };
    if valid {
        Ok(())
    } else {
        Err(CoreError::validation(format!(
            "Release provenance {provenance:?} is invalid for App owner {owner:?}"
        )))
    }
}

fn validate_parent_release(
    registry: &Registry,
    app_id: &str,
    parent_release_id: Option<&str>,
) -> CoreResult<()> {
    let Some(parent_release_id) = parent_release_id else {
        return Ok(());
    };
    let parent = registry
        .releases
        .get(parent_release_id)
        .ok_or_else(|| CoreError::NotFound(format!("Parent app release {parent_release_id}")))?;
    if parent.app_id != app_id {
        return Err(CoreError::validation(format!(
            "Parent release {parent_release_id} belongs to app {}, not {app_id}",
            parent.app_id
        )));
    }
    Ok(())
}

fn validate_draft_base(registry: &Registry, draft: &DraftRecord) -> CoreResult<()> {
    let Some(base_release_id) = draft.base_release_id.as_deref() else {
        return Ok(());
    };
    let base = registry
        .releases
        .get(base_release_id)
        .ok_or_else(|| CoreError::NotFound(format!("Draft base app release {base_release_id}")))?;
    if base.app_id == draft.app_id {
        return Ok(());
    }
    let app = registry
        .apps
        .get(&draft.app_id)
        .ok_or_else(|| CoreError::NotFound(format!("Intelligent App {}", draft.app_id)))?;
    let derived_from = app.derived_from.as_ref().ok_or_else(|| {
        CoreError::validation(format!(
            "Draft {} uses a cross-app base without fork provenance",
            draft.draft_id
        ))
    })?;
    if derived_from.app_id != base.app_id || derived_from.release_id != base.release_id {
        return Err(CoreError::validation(format!(
            "Draft {} base does not match its fork provenance",
            draft.draft_id
        )));
    }
    Ok(())
}

fn validate_rebase_context(
    registry: &Registry,
    app: &AppRecord,
    current_release: &ReleaseRecord,
    context: &DraftRebaseContext,
) -> CoreResult<()> {
    if app.owner.kind == AppOwnerKind::System {
        return Err(CoreError::validation(
            "Only user- or organization-owned forks can be rebased",
        ));
    }
    if current_release.app_id != app.app_id {
        return Err(CoreError::validation(format!(
            "Current release {} belongs to app {}, not {}",
            current_release.release_id, current_release.app_id, app.app_id
        )));
    }
    validate_identifier("rebaseContext.upstreamAppId", &context.upstream_app_id)?;
    validate_identifier("rebaseContext.baseReleaseId", &context.base_release_id)?;
    validate_identifier("rebaseContext.targetReleaseId", &context.target_release_id)?;
    if context.base_release_id == context.target_release_id {
        return Err(CoreError::validation(
            "Rebase target must differ from the current upstream base",
        ));
    }
    if current_release.upstream_app_id.as_deref() != Some(context.upstream_app_id.as_str())
        || current_release.upstream_base_release_id.as_deref()
            != Some(context.base_release_id.as_str())
    {
        return Err(CoreError::validation(format!(
            "Rebase context does not match release {} upstream coordinates",
            current_release.release_id
        )));
    }
    if !app_has_upstream_lineage(registry, app, &context.upstream_app_id)? {
        return Err(CoreError::validation(format!(
            "App {} is not derived from upstream app {}",
            app.app_id, context.upstream_app_id
        )));
    }

    let base = registry
        .releases
        .get(&context.base_release_id)
        .ok_or_else(|| {
            CoreError::NotFound(format!("Upstream app release {}", context.base_release_id))
        })?;
    let target = registry
        .releases
        .get(&context.target_release_id)
        .ok_or_else(|| {
            CoreError::NotFound(format!(
                "Upstream app release {}",
                context.target_release_id
            ))
        })?;
    for release in [base, target] {
        if release.app_id != context.upstream_app_id {
            return Err(CoreError::validation(format!(
                "Upstream release {} belongs to app {}, not {}",
                release.release_id, release.app_id, context.upstream_app_id
            )));
        }
    }
    let base_version = Version::parse(&base.version).expect("validated release version");
    let target_version = Version::parse(&target.version).expect("validated release version");
    if target_version <= base_version {
        return Err(CoreError::validation(format!(
            "Rebase target {} must advance upstream version {}",
            target.version, base.version
        )));
    }
    Ok(())
}

fn app_has_upstream_lineage(
    registry: &Registry,
    app: &AppRecord,
    upstream_app_id: &str,
) -> CoreResult<bool> {
    let mut cursor = app;
    let mut visited = BTreeSet::new();
    while let Some(derived) = cursor.derived_from.as_ref() {
        if !visited.insert(cursor.app_id.as_str()) {
            return Err(CoreError::validation(format!(
                "Cyclic app fork lineage at {}",
                cursor.app_id
            )));
        }
        let source_release = registry.releases.get(&derived.release_id).ok_or_else(|| {
            CoreError::NotFound(format!("Fork source release {}", derived.release_id))
        })?;
        if source_release.app_id != derived.app_id {
            return Err(CoreError::validation(format!(
                "Fork source release {} belongs to app {}, not {}",
                derived.release_id, source_release.app_id, derived.app_id
            )));
        }
        if derived.app_id == upstream_app_id {
            return Ok(true);
        }
        if source_release.upstream_app_id.as_deref() == Some(upstream_app_id) {
            return Ok(true);
        }
        cursor = match registry.apps.get(&derived.app_id) {
            Some(source_app) => source_app,
            None => return Ok(false),
        };
    }
    Ok(false)
}

fn validate_upstream_release(registry: &Registry, metadata: &ReleaseMetadata) -> CoreResult<()> {
    let (Some(upstream_app_id), Some(upstream_release_id)) = (
        metadata.upstream_app_id.as_deref(),
        metadata.upstream_base_release_id.as_deref(),
    ) else {
        return Ok(());
    };
    let upstream = registry.releases.get(upstream_release_id).ok_or_else(|| {
        CoreError::NotFound(format!("Upstream app release {upstream_release_id}"))
    })?;
    if upstream.app_id != upstream_app_id {
        return Err(CoreError::validation(format!(
            "Upstream release {upstream_release_id} belongs to app {}, not {upstream_app_id}",
            upstream.app_id
        )));
    }
    Ok(())
}

fn validate_registry(root: &Path, registry: &Registry) -> CoreResult<()> {
    if registry.schema_version != REGISTRY_SCHEMA_VERSION {
        return Err(CoreError::validation(format!(
            "Unsupported Intelligent App registry schema version {}",
            registry.schema_version
        )));
    }
    for (app_id, app) in &registry.apps {
        if app_id != &app.app_id {
            return Err(CoreError::validation(format!(
                "App registry key mismatch for {app_id}"
            )));
        }
        validate_app_fields(&app.app_id, &app.slot_id, &app.display_name)?;
        if normalize_description(app.description.clone())? != app.description {
            return Err(CoreError::validation(format!(
                "App {} contains a non-normalized description",
                app.app_id
            )));
        }
        app.owner.validate()?;
        if let Some(derived) = app.derived_from.as_ref() {
            validate_identifier("derivedFrom.appId", &derived.app_id)?;
            validate_identifier("derivedFrom.releaseId", &derived.release_id)?;
        }
    }
    for (draft_id, draft) in &registry.drafts {
        if draft_id != &draft.draft_id || !registry.apps.contains_key(&draft.app_id) {
            return Err(CoreError::validation(format!(
                "Invalid app draft registry entry {draft_id}"
            )));
        }
        let expected_path = format!("drafts/{draft_id}");
        if draft.path != expected_path {
            return Err(CoreError::validation(format!(
                "Draft {draft_id} has invalid source path {}",
                draft.path
            )));
        }
        if draft.updated_at_ms < draft.created_at_ms {
            return Err(CoreError::validation(format!(
                "Draft {draft_id} updatedAtMs precedes createdAtMs"
            )));
        }
        let _ = resolve_store_relative_path(root, &draft.path)?;
        validate_draft_base(registry, draft)?;
        if let Some(rebase) = draft.rebase_context.as_ref() {
            let app = registry.apps.get(&draft.app_id).expect("checked above");
            let current_release_id = draft.base_release_id.as_deref().ok_or_else(|| {
                CoreError::validation(format!(
                    "Rebase draft {draft_id} has no current fork release"
                ))
            })?;
            let current_release = registry.releases.get(current_release_id).ok_or_else(|| {
                CoreError::NotFound(format!("Intelligent App release {current_release_id}"))
            })?;
            validate_rebase_context(registry, app, current_release, rebase)?;
        }
    }
    for (release_id, release) in &registry.releases {
        if release_id != &release.release_id {
            return Err(CoreError::validation(format!(
                "Release registry key mismatch for {release_id}"
            )));
        }
        validate_identifier("releaseId", release_id)?;
        validate_identifier("release.appId", &release.app_id)?;
        validate_identifier("release.slotId", &release.slot_id)?;
        validate_sha256_digest("artifactDigest", &release.artifact_digest)?;
        let metadata = ReleaseMetadata {
            version: release.version.clone(),
            component_lock_digest: release.component_lock_digest.clone(),
            config_revision: release.config_revision.clone(),
            data_schema_version: release.data_schema_version.clone(),
            runtime_compatibility: release.runtime_compatibility.clone(),
            capability_fingerprint: release.capability_fingerprint.clone(),
            evaluation_report_digest: release.evaluation_report_digest.clone(),
            runtime: release.runtime.clone(),
            label: release.label.clone(),
            notes: release.notes.clone(),
            provenance: release.provenance,
            signature: release.signature.clone(),
            upstream_app_id: release.upstream_app_id.clone(),
            upstream_base_release_id: release.upstream_base_release_id.clone(),
        };
        validate_release_metadata(&metadata)?;
        if let Some(app) = registry.apps.get(&release.app_id) {
            validate_release_provenance(app.owner.kind, release.provenance)?;
            if release.slot_id != app.slot_id {
                return Err(CoreError::validation(format!(
                    "Release {release_id} slot {} does not match App slot {}",
                    release.slot_id, app.slot_id
                )));
            }
        }
        validate_parent_release(
            registry,
            &release.app_id,
            release.parent_release_id.as_deref(),
        )?;
        if release
            .parent_release_id
            .as_deref()
            .and_then(|id| registry.releases.get(id))
            .is_some_and(|parent| parent.slot_id != release.slot_id)
        {
            return Err(CoreError::validation(format!(
                "Release {release_id} parent belongs to a different slot"
            )));
        }
        validate_upstream_release(registry, &metadata)?;
    }
    for (activation_registry_key, activation) in &registry.activations {
        activation.scope.validate()?;
        if activation_registry_key != &activation_key(&activation.scope, &activation.slot_id) {
            return Err(CoreError::validation(format!(
                "Activation registry key mismatch for slot {}",
                activation.slot_id
            )));
        }
        let app = registry
            .apps
            .get(&activation.selected_app_id)
            .ok_or_else(|| {
                CoreError::validation(format!(
                    "Activation references missing app {}",
                    activation.selected_app_id
                ))
            })?;
        let release = registry
            .releases
            .get(&activation.active_release_id)
            .ok_or_else(|| {
                CoreError::validation(format!(
                    "Activation references missing release {}",
                    activation.active_release_id
                ))
            })?;
        if app.slot_id != activation.slot_id || release.app_id != app.app_id {
            return Err(CoreError::validation(format!(
                "Activation routing is inconsistent for scope={}, slot={}",
                activation.scope.registry_key(),
                activation.slot_id
            )));
        }
    }
    Ok(())
}

fn validate_app_fields(app_id: &str, slot_id: &str, display_name: &str) -> CoreResult<()> {
    validate_identifier("appId", app_id)?;
    validate_identifier("slotId", slot_id)?;
    let display_name = display_name.trim();
    if display_name.is_empty() || display_name.chars().count() > 160 {
        return Err(CoreError::validation(
            "App displayName must contain between 1 and 160 characters",
        ));
    }
    Ok(())
}

fn normalize_description(description: Option<String>) -> CoreResult<Option<String>> {
    let Some(description) = description else {
        return Ok(None);
    };
    let description = description.trim().to_string();
    if description.is_empty() {
        return Ok(None);
    }
    if description.chars().count() > 2000 {
        return Err(CoreError::validation(
            "App description must not exceed 2000 characters",
        ));
    }
    Ok(Some(description))
}

fn now_ms() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0) as u64
}

fn validate_identifier(field: &str, value: &str) -> CoreResult<()> {
    if value.is_empty()
        || value.len() > 256
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
    {
        return Err(CoreError::validation(format!(
            "{field} must use 1-256 ASCII letters, digits, dots, underscores, or hyphens"
        )));
    }
    Ok(())
}

fn validate_sha256_digest(field: &str, value: &str) -> CoreResult<()> {
    let Some(hex_value) = value.strip_prefix("sha256:") else {
        return Err(CoreError::validation(format!(
            "{field} must be a sha256 digest"
        )));
    };
    if hex_value.len() != 64 || !hex_value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(CoreError::validation(format!(
            "{field} must contain 64 hexadecimal sha256 characters"
        )));
    }
    Ok(())
}

fn ensure_app_id_available(registry: &Registry, app_id: &str) -> CoreResult<()> {
    if registry.apps.contains_key(app_id) || registry.retired_app_ids.contains(app_id) {
        return Err(CoreError::validation(format!(
            "Intelligent App id {app_id} is already used"
        )));
    }
    Ok(())
}

fn activation_key(scope: &AppActivationScope, slot_id: &str) -> String {
    format!("{}\n{slot_id}", scope.registry_key())
}

fn effective_activation<'a>(
    registry: &'a Registry,
    scope: &AppActivationScope,
    slot_id: &str,
) -> Option<&'a ActivationRecord> {
    registry.activations.get(&activation_key(scope, slot_id))
}

fn compare_releases_descending(left: &ReleaseRecord, right: &ReleaseRecord) -> std::cmp::Ordering {
    let left_version = Version::parse(&left.version).expect("validated release version");
    let right_version = Version::parse(&right.version).expect("validated release version");
    right_version
        .cmp(&left_version)
        .then_with(|| right.created_at_ms.cmp(&left.created_at_ms))
        .then_with(|| right.release_id.cmp(&left.release_id))
}

fn latest_release_for_app<'a>(registry: &'a Registry, app_id: &str) -> Option<&'a ReleaseRecord> {
    registry
        .releases
        .values()
        .filter(|release| release.app_id == app_id)
        .min_by(|left, right| compare_releases_descending(left, right))
}

fn resolve_store_relative_path(root: &Path, relative: &str) -> CoreResult<PathBuf> {
    let mut result = root.to_path_buf();
    for segment in relative.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(CoreError::validation(format!(
                "Invalid Intelligent App store path {relative}"
            )));
        }
        validate_identifier("store path segment", segment)?;
        result.push(segment);
    }
    Ok(result)
}

fn artifact_path_for_digest(root: &Path, digest: &str) -> CoreResult<PathBuf> {
    validate_sha256_digest("artifactDigest", digest)?;
    Ok(root.join("artifacts").join(&digest["sha256:".len()..]))
}

async fn cleanup_unreferenced_artifacts(root: &Path, registry: &Registry) -> CoreResult<()> {
    let artifacts_root = root.join("artifacts");
    if !artifacts_root.exists() {
        return Ok(());
    }
    let referenced = registry
        .releases
        .values()
        .filter_map(|release| release.artifact_digest.strip_prefix("sha256:"))
        .map(str::to_string)
        .collect::<BTreeSet<_>>();
    let mut entries = fs::read_dir(&artifacts_root).await?;
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.len() != 64
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
            || referenced.contains(&name)
        {
            continue;
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).await?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(CoreError::validation(format!(
                "Unsafe Intelligent App artifact entry: {}",
                path.display()
            )));
        }
        remove_tree_force(&path).await?;
    }
    Ok(())
}

async fn create_draft_directory(
    destination: &Path,
    source: Option<&Path>,
    draft: &DraftRecord,
) -> CoreResult<()> {
    let parent = destination
        .parent()
        .ok_or_else(|| CoreError::validation("Draft destination has no parent"))?;
    let staging = parent.join(format!(".staging-{}", Uuid::new_v4().simple()));
    if let Some(source) = source {
        copy_tree_strict(source, &staging, CopyTreeMode::All).await?;
        make_tree_writable(&staging).await?;
    } else {
        fs::create_dir(&staging).await?;
    }
    if let Err(error) = write_draft_manifest(&staging, draft).await {
        let _ = remove_tree_force(&staging).await;
        return Err(error);
    }
    if let Err(error) = fs::rename(&staging, destination).await {
        let _ = remove_tree_force(&staging).await;
        return Err(error.into());
    }
    Ok(())
}

async fn write_draft_manifest(draft_path: &Path, draft: &DraftRecord) -> CoreResult<()> {
    let metadata_root = draft_path.join(".sparo_os");
    if metadata_root.exists() {
        return Err(CoreError::validation(format!(
            "Draft source already contains reserved metadata at {}",
            metadata_root.display()
        )));
    }
    fs::create_dir(&metadata_root).await?;
    let manifest_path = metadata_root.join("draft.json");
    let manifest = StoredDraftManifest {
        schema_version: DRAFT_MANIFEST_SCHEMA_VERSION,
        draft_id: draft.draft_id.clone(),
        app_id: draft.app_id.clone(),
    };
    let mut bytes = serde_json::to_vec_pretty(&manifest)?;
    bytes.push(b'\n');
    fs::write(&manifest_path, bytes).await?;
    let mut permissions = fs::metadata(&manifest_path).await?.permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&manifest_path, permissions).await?;
    Ok(())
}

async fn validate_draft_manifest(draft_path: &Path, draft: &DraftRecord) -> CoreResult<()> {
    let draft_metadata = fs::symlink_metadata(draft_path).await.map_err(|error| {
        CoreError::validation(format!(
            "Draft source is unavailable at {}: {error}",
            draft_path.display()
        ))
    })?;
    if draft_metadata.file_type().is_symlink() || !draft_metadata.is_dir() {
        return Err(CoreError::validation(format!(
            "Draft source must be a real directory: {}",
            draft_path.display()
        )));
    }

    let metadata_root = draft_path.join(".sparo_os");
    let metadata = fs::symlink_metadata(&metadata_root)
        .await
        .map_err(|error| {
            CoreError::validation(format!(
                "Draft identity metadata is unavailable at {}: {error}",
                metadata_root.display()
            ))
        })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(CoreError::validation(format!(
            "Draft identity metadata must be a real directory: {}",
            metadata_root.display()
        )));
    }

    let manifest_path = metadata_root.join("draft.json");
    let metadata = fs::symlink_metadata(&manifest_path)
        .await
        .map_err(|error| {
            CoreError::validation(format!(
                "Draft identity manifest is unavailable at {}: {error}",
                manifest_path.display()
            ))
        })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(CoreError::validation(format!(
            "Draft identity manifest must be a regular file: {}",
            manifest_path.display()
        )));
    }
    let bytes = fs::read(&manifest_path).await?;
    let manifest: StoredDraftManifest = serde_json::from_slice(&bytes).map_err(|error| {
        CoreError::validation(format!(
            "Invalid Draft identity manifest {}: {error}",
            manifest_path.display()
        ))
    })?;
    let expected = StoredDraftManifest {
        schema_version: DRAFT_MANIFEST_SCHEMA_VERSION,
        draft_id: draft.draft_id.clone(),
        app_id: draft.app_id.clone(),
    };
    if manifest != expected {
        return Err(CoreError::validation(format!(
            "Draft identity manifest does not match registry coordinates for {}",
            draft.draft_id
        )));
    }
    Ok(())
}

async fn materialize_rebase_workspace(
    store_root: &Path,
    draft_path: &Path,
    draft: &DraftRecord,
    current_release: &ReleaseRecord,
    context: &DraftRebaseContext,
    registry: &Registry,
) -> CoreResult<()> {
    validate_draft_manifest(draft_path, draft).await?;
    let base = registry
        .releases
        .get(&context.base_release_id)
        .ok_or_else(|| {
            CoreError::NotFound(format!("Upstream app release {}", context.base_release_id))
        })?;
    let target = registry
        .releases
        .get(&context.target_release_id)
        .ok_or_else(|| {
            CoreError::NotFound(format!(
                "Upstream app release {}",
                context.target_release_id
            ))
        })?;
    let base_source = artifact_path_for_digest(store_root, &base.artifact_digest)?;
    let target_source = artifact_path_for_digest(store_root, &target.artifact_digest)?;
    let current_source = artifact_path_for_digest(store_root, &current_release.artifact_digest)?;
    for source in [&base_source, &current_source, &target_source] {
        if !source.is_dir() {
            return Err(CoreError::NotFound(format!(
                "Rebase snapshot artifact {}",
                source.display()
            )));
        }
    }

    let merge_plan = build_rebase_merge_plan(&base_source, &current_source, &target_source).await?;
    if merge_plan.automatic_changes.is_empty()
        && merge_plan.integrated_changes.is_empty()
        && merge_plan.conflicts.is_empty()
    {
        return Err(CoreError::validation(format!(
            "Upstream Release {} contains no file-level changes to rebase",
            target.release_id
        )));
    }
    apply_automatic_rebase_changes(draft_path, &target_source, &merge_plan.automatic_changes)
        .await?;

    let metadata_root = draft_path.join(".sparo_os");
    let rebase_root = metadata_root.join("rebase");
    if rebase_root.exists() {
        return Err(CoreError::validation(format!(
            "Draft {} already contains Rebase metadata",
            draft.draft_id
        )));
    }
    fs::create_dir_all(&rebase_root).await?;
    let base_snapshot = rebase_root.join("base");
    let target_snapshot = rebase_root.join("target");
    copy_tree_strict(&base_source, &base_snapshot, CopyTreeMode::All).await?;
    if let Err(error) = copy_tree_strict(&target_source, &target_snapshot, CopyTreeMode::All).await
    {
        return Err(error);
    }
    seal_artifact_tree(&base_snapshot).await?;
    seal_artifact_tree(&target_snapshot).await?;

    let manifest = StoredRebaseManifest {
        schema_version: 2,
        app_id: draft.app_id.clone(),
        current_release_id: current_release.release_id.clone(),
        current_artifact_digest: current_release.artifact_digest.clone(),
        upstream_app_id: context.upstream_app_id.clone(),
        base_release_id: base.release_id.clone(),
        base_artifact_digest: base.artifact_digest.clone(),
        target_release_id: target.release_id.clone(),
        target_artifact_digest: target.artifact_digest.clone(),
        automatic_changes: merge_plan.automatic_changes,
        integrated_changes: merge_plan.integrated_changes,
        conflicts: merge_plan.conflicts,
        created_at_ms: now_ms(),
    };
    let manifest_path = rebase_root.join("manifest.json");
    let mut bytes = serde_json::to_vec_pretty(&manifest)?;
    bytes.push(b'\n');
    fs::write(&manifest_path, bytes).await?;
    let mut permissions = fs::metadata(&manifest_path).await?.permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&manifest_path, permissions).await?;
    Ok(())
}

async fn build_rebase_merge_plan(
    base_root: &Path,
    mine_root: &Path,
    target_root: &Path,
) -> CoreResult<RebaseMergePlan> {
    let base = summarize_rebase_tree(base_root).await?;
    let mine = summarize_rebase_tree(mine_root).await?;
    let target = summarize_rebase_tree(target_root).await?;
    let paths = base
        .keys()
        .chain(mine.keys())
        .chain(target.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut automatic_changes = Vec::new();
    let mut integrated_changes = Vec::new();
    let mut conflicts = Vec::new();

    for path in paths {
        let base_summary = base.get(&path).cloned().unwrap_or_default();
        let mine_summary = mine.get(&path).cloned().unwrap_or_default();
        let target_summary = target.get(&path).cloned().unwrap_or_default();
        if mine_summary == base_summary {
            if mine_summary != target_summary {
                automatic_changes.push(StoredRebaseChange {
                    path,
                    base: base_summary,
                    mine: mine_summary,
                    target: target_summary,
                });
            }
        } else if mine_summary == target_summary {
            integrated_changes.push(StoredRebaseChange {
                path,
                base: base_summary,
                mine: mine_summary,
                target: target_summary,
            });
        } else if target_summary == base_summary {
            // Only the fork changed, so its bytes remain authoritative.
        } else {
            conflicts.push(StoredRebaseConflict {
                path,
                base: base_summary,
                mine: mine_summary,
                target: target_summary,
            });
        }
    }

    let mut applicable_changes = Vec::with_capacity(automatic_changes.len());
    for change in automatic_changes {
        let has_unmerged_structural_blocker = change.target.digest.is_some()
            && mine.iter().any(|(mine_path, mine_summary)| {
                let base_summary = base.get(mine_path).cloned().unwrap_or_default();
                rebase_paths_structurally_overlap(mine_path, &change.path)
                    && mine_summary != &base_summary
            });
        if has_unmerged_structural_blocker {
            conflicts.push(StoredRebaseConflict {
                path: change.path.clone(),
                base: change.base,
                mine: mine.get(&change.path).cloned().unwrap_or_default(),
                target: change.target,
            });
        } else {
            applicable_changes.push(change);
        }
    }
    conflicts.sort_by(|left, right| left.path.cmp(&right.path));

    Ok(RebaseMergePlan {
        automatic_changes: applicable_changes,
        integrated_changes,
        conflicts,
    })
}

fn rebase_paths_structurally_overlap(left: &str, right: &str) -> bool {
    rebase_path_is_descendant(left, right) || rebase_path_is_descendant(right, left)
}

fn rebase_path_is_descendant(path: &str, ancestor: &str) -> bool {
    path.len() > ancestor.len()
        && path.starts_with(ancestor)
        && path.as_bytes().get(ancestor.len()) == Some(&b'/')
}

async fn summarize_rebase_tree(
    root: &Path,
) -> CoreResult<BTreeMap<String, StoredRebaseFileSummary>> {
    if !root.is_dir() {
        return Err(CoreError::NotFound(format!(
            "Rebase tree {}",
            root.display()
        )));
    }
    let mut files = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let mut entries = fs::read_dir(&directory).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).await?;
            if metadata.file_type().is_symlink() {
                return Err(CoreError::validation(format!(
                    "Rebase inputs must not contain symbolic links: {}",
                    path.display()
                )));
            }
            if metadata.is_dir() {
                pending.push(path);
            } else if metadata.is_file() {
                let relative = strict_rebase_relative_path(root, &path)?;
                let summary = summarize_rebase_file(&path).await?;
                if files.insert(relative.clone(), summary).is_some() {
                    return Err(CoreError::validation(format!(
                        "Rebase tree contains a duplicate normalized path: {relative}"
                    )));
                }
            } else {
                return Err(CoreError::validation(format!(
                    "Unsupported Rebase input entry: {}",
                    path.display()
                )));
            }
        }
    }
    Ok(files)
}

async fn summarize_rebase_file(path: &Path) -> CoreResult<StoredRebaseFileSummary> {
    let bytes = fs::read(path).await?;
    let mut hasher = Sha256::new();
    hasher.update(REBASE_FILE_DIGEST_DOMAIN);
    hasher.update((bytes.len() as u64).to_le_bytes());
    hasher.update(bytes);
    Ok(StoredRebaseFileSummary {
        digest: Some(format!("sha256:{}", hex::encode(hasher.finalize()))),
    })
}

async fn summarize_rebase_path(root: &Path, relative: &str) -> CoreResult<StoredRebaseFileSummary> {
    let path = resolve_rebase_relative_path(root, relative)?;
    match fs::symlink_metadata(&path).await {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(CoreError::validation(format!(
            "Resolved Rebase path is a symbolic link: {}",
            path.display()
        ))),
        Ok(metadata) if metadata.is_file() => summarize_rebase_file(&path).await,
        Ok(metadata) if metadata.is_dir() => Ok(StoredRebaseFileSummary::default()),
        Ok(_) => Err(CoreError::validation(format!(
            "Resolved Rebase path is not a file: {}",
            path.display()
        ))),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
            ) =>
        {
            Ok(StoredRebaseFileSummary::default())
        }
        Err(error) => Err(error.into()),
    }
}

async fn apply_automatic_rebase_changes(
    draft_root: &Path,
    target_root: &Path,
    changes: &[StoredRebaseChange],
) -> CoreResult<()> {
    for change in changes
        .iter()
        .filter(|change| change.target.digest.is_none())
    {
        let destination = resolve_rebase_relative_path(draft_root, &change.path)?;
        match fs::symlink_metadata(&destination).await {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(CoreError::validation(format!(
                    "Cannot apply Rebase deletion to a non-file path: {}",
                    destination.display()
                )));
            }
            Ok(_) => {
                fs::remove_file(&destination).await?;
                remove_empty_rebase_parents(draft_root, destination.parent()).await?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }

    for change in changes
        .iter()
        .filter(|change| change.target.digest.is_some())
    {
        let source = resolve_rebase_relative_path(target_root, &change.path)?;
        let destination = resolve_rebase_relative_path(draft_root, &change.path)?;
        match fs::symlink_metadata(&destination).await {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(CoreError::validation(format!(
                    "Cannot apply Rebase file over a symbolic link: {}",
                    destination.display()
                )));
            }
            Ok(metadata) if metadata.is_dir() => {
                if !summarize_rebase_tree(&destination).await?.is_empty() {
                    return Err(CoreError::validation(format!(
                        "Cannot apply Rebase file over a non-empty directory: {}",
                        destination.display()
                    )));
                }
                remove_tree_force(&destination).await?;
            }
            Ok(metadata) if !metadata.is_file() => {
                return Err(CoreError::validation(format!(
                    "Cannot apply Rebase file over a special filesystem entry: {}",
                    destination.display()
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let parent = destination.parent().ok_or_else(|| {
            CoreError::validation(format!(
                "Rebase destination has no parent: {}",
                destination.display()
            ))
        })?;
        fs::create_dir_all(parent).await?;
        fs::copy(&source, &destination).await?;
        let permissions = fs::metadata(&destination).await?.permissions();
        if permissions.readonly() {
            make_file_writable(&destination, permissions).await?;
        }
    }

    for change in changes {
        let actual = summarize_rebase_path(draft_root, &change.path).await?;
        if actual != change.target {
            return Err(CoreError::validation(format!(
                "Automatic Rebase did not materialize target path {}",
                change.path
            )));
        }
    }
    Ok(())
}

async fn remove_empty_rebase_parents(root: &Path, current: Option<&Path>) -> CoreResult<()> {
    let mut current = current.map(Path::to_path_buf);
    while let Some(directory) = current {
        if directory == root || !directory.starts_with(root) {
            break;
        }
        let mut entries = fs::read_dir(&directory).await?;
        if entries.next_entry().await?.is_some() {
            break;
        }
        let parent = directory.parent().map(Path::to_path_buf);
        fs::remove_dir(&directory).await?;
        current = parent;
    }
    Ok(())
}

fn strict_rebase_relative_path(root: &Path, path: &Path) -> CoreResult<String> {
    let relative = path.strip_prefix(root).map_err(|error| {
        CoreError::validation(format!(
            "Invalid Rebase tree path {}: {error}",
            path.display()
        ))
    })?;
    let mut segments = Vec::new();
    for component in relative.components() {
        let std::path::Component::Normal(segment) = component else {
            return Err(CoreError::validation(format!(
                "Invalid Rebase relative path: {}",
                relative.display()
            )));
        };
        let segment = segment.to_str().ok_or_else(|| {
            CoreError::validation(format!(
                "Rebase paths must be valid UTF-8: {}",
                relative.display()
            ))
        })?;
        if segment.is_empty() {
            return Err(CoreError::validation(
                "Rebase path contains an empty segment",
            ));
        }
        segments.push(segment);
    }
    if segments.is_empty() || segments.first() == Some(&".sparo_os") {
        return Err(CoreError::validation(format!(
            "Invalid or reserved Rebase relative path: {}",
            relative.display()
        )));
    }
    Ok(segments.join("/"))
}

fn resolve_rebase_relative_path(root: &Path, relative: &str) -> CoreResult<PathBuf> {
    let mut result = root.to_path_buf();
    let mut count = 0;
    for segment in relative.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." || segment == ".sparo_os" {
            return Err(CoreError::validation(format!(
                "Invalid or reserved Rebase path: {relative}"
            )));
        }
        result.push(segment);
        count += 1;
    }
    if count == 0 {
        return Err(CoreError::validation("Rebase path must not be empty"));
    }
    Ok(result)
}

async fn validate_rebase_workspace(
    store_root: &Path,
    draft_path: &Path,
    app: &AppRecord,
    current_release: &ReleaseRecord,
    context: &DraftRebaseContext,
    registry: &Registry,
) -> CoreResult<()> {
    let rebase_root = draft_path.join(".sparo_os").join("rebase");
    let manifest_path = rebase_root.join("manifest.json");
    let bytes = fs::read(&manifest_path).await.map_err(|error| {
        CoreError::validation(format!(
            "Rebase Draft metadata is unavailable at {}: {error}",
            manifest_path.display()
        ))
    })?;
    let manifest: StoredRebaseManifest = serde_json::from_slice(&bytes).map_err(|error| {
        CoreError::validation(format!(
            "Invalid Rebase Draft metadata {}: {error}",
            manifest_path.display()
        ))
    })?;
    let base = registry
        .releases
        .get(&context.base_release_id)
        .ok_or_else(|| {
            CoreError::NotFound(format!("Upstream app release {}", context.base_release_id))
        })?;
    let target = registry
        .releases
        .get(&context.target_release_id)
        .ok_or_else(|| {
            CoreError::NotFound(format!(
                "Upstream app release {}",
                context.target_release_id
            ))
        })?;
    let base_source = artifact_path_for_digest(store_root, &base.artifact_digest)?;
    let current_source = artifact_path_for_digest(store_root, &current_release.artifact_digest)?;
    let target_source = artifact_path_for_digest(store_root, &target.artifact_digest)?;
    let merge_plan = build_rebase_merge_plan(&base_source, &current_source, &target_source).await?;
    if merge_plan.automatic_changes.is_empty()
        && merge_plan.integrated_changes.is_empty()
        && merge_plan.conflicts.is_empty()
    {
        return Err(CoreError::validation(format!(
            "Upstream Release {} contains no file-level changes to rebase",
            target.release_id
        )));
    }
    let expected = StoredRebaseManifest {
        schema_version: 2,
        app_id: app.app_id.clone(),
        current_release_id: current_release.release_id.clone(),
        current_artifact_digest: current_release.artifact_digest.clone(),
        upstream_app_id: context.upstream_app_id.clone(),
        base_release_id: base.release_id.clone(),
        base_artifact_digest: base.artifact_digest.clone(),
        target_release_id: target.release_id.clone(),
        target_artifact_digest: target.artifact_digest.clone(),
        automatic_changes: merge_plan.automatic_changes,
        integrated_changes: merge_plan.integrated_changes,
        conflicts: merge_plan.conflicts,
        created_at_ms: manifest.created_at_ms,
    };
    if manifest != expected {
        return Err(CoreError::validation(
            "Rebase Draft metadata no longer matches its immutable lineage",
        ));
    }
    for (label, path, expected_digest) in [
        (
            "base",
            rebase_root.join("base"),
            base.artifact_digest.as_str(),
        ),
        (
            "target",
            rebase_root.join("target"),
            target.artifact_digest.as_str(),
        ),
    ] {
        let actual_digest = digest_directory(&path).await.map_err(|error| {
            CoreError::validation(format!("Invalid Rebase {label} snapshot: {error}"))
        })?;
        if actual_digest != expected_digest {
            return Err(CoreError::validation(format!(
                "Rebase {label} snapshot was modified: expected={expected_digest}, actual={actual_digest}"
            )));
        }
    }

    let mut unresolved = Vec::new();
    for change in &manifest.automatic_changes {
        let actual = summarize_rebase_path(draft_path, &change.path).await?;
        if actual == change.mine {
            unresolved.push(change.path.as_str());
        }
    }
    for change in &manifest.integrated_changes {
        let actual = summarize_rebase_path(draft_path, &change.path).await?;
        if actual == change.base {
            unresolved.push(change.path.as_str());
        }
    }
    for conflict in &manifest.conflicts {
        let actual = summarize_rebase_path(draft_path, &conflict.path).await?;
        if actual == conflict.mine {
            unresolved.push(conflict.path.as_str());
        }
    }
    if !unresolved.is_empty() {
        return Err(CoreError::validation(format!(
            "Unresolved Rebase paths still match the original fork: {}",
            unresolved.join(", ")
        )));
    }
    Ok(())
}

async fn commit_artifact(root: &Path, source: &Path) -> CoreResult<String> {
    if !source.is_dir() {
        return Err(CoreError::NotFound(format!(
            "Artifact source {}",
            source.display()
        )));
    }
    let artifacts_root = root.join("artifacts");
    let staging = artifacts_root.join(format!(".staging-{}", Uuid::new_v4().simple()));
    copy_tree_strict(source, &staging, CopyTreeMode::ReleaseArtifact).await?;
    let digest = match digest_directory(&staging).await {
        Ok(digest) => digest,
        Err(error) => {
            let _ = remove_tree_force(&staging).await;
            return Err(error);
        }
    };
    let destination = artifact_path_for_digest(root, &digest)?;
    if destination.is_dir() {
        let existing_digest = digest_directory(&destination).await?;
        if existing_digest != digest {
            let _ = remove_tree_force(&staging).await;
            return Err(CoreError::validation(format!(
                "Content-addressed artifact directory is corrupted: {}",
                destination.display()
            )));
        }
        remove_tree_force(&staging).await?;
        seal_artifact_tree(&destination).await?;
        return Ok(digest);
    }
    if let Err(error) = seal_artifact_tree(&staging).await {
        let _ = remove_tree_force(&staging).await;
        return Err(error);
    }
    if let Err(error) = fs::rename(&staging, &destination).await {
        let _ = remove_tree_force(&staging).await;
        return Err(error.into());
    }
    Ok(digest)
}

async fn create_publish_staging(root: &Path, draft_path: &Path) -> CoreResult<PathBuf> {
    let staging = root.join(format!(".publish-staging-{}", Uuid::new_v4().simple()));
    if let Err(error) = copy_tree_strict(draft_path, &staging, CopyTreeMode::All).await {
        let _ = remove_tree_force(&staging).await;
        return Err(error);
    }
    if let Err(error) = make_tree_writable(&staging).await {
        let _ = remove_tree_force(&staging).await;
        return Err(error);
    }
    let draft_digest = match digest_directory(draft_path).await {
        Ok(digest) => digest,
        Err(error) => {
            let _ = remove_tree_force(&staging).await;
            return Err(error);
        }
    };
    let staging_digest = match digest_directory(&staging).await {
        Ok(digest) => digest,
        Err(error) => {
            let _ = remove_tree_force(&staging).await;
            return Err(error);
        }
    };
    if draft_digest != staging_digest {
        let _ = remove_tree_force(&staging).await;
        return Err(CoreError::validation(
            "App Draft changed while the immutable publish snapshot was being created; retry publish",
        ));
    }
    Ok(staging)
}

async fn cleanup_staging_directories(parent: &Path, prefix: &str) -> CoreResult<()> {
    let mut entries = fs::read_dir(parent).await?;
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name();
        if !name.to_string_lossy().starts_with(prefix) {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path()).await?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(CoreError::validation(format!(
                "Unsafe Intelligent App staging entry: {}",
                entry.path().display()
            )));
        }
        ensure_staging_tree_has_no_symlinks(&entry.path()).await?;
        remove_tree_force(&entry.path()).await?;
    }
    Ok(())
}

async fn ensure_staging_tree_has_no_symlinks(root: &Path) -> CoreResult<()> {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let mut entries = fs::read_dir(directory).await?;
        while let Some(entry) = entries.next_entry().await? {
            let metadata = fs::symlink_metadata(entry.path()).await?;
            if metadata.file_type().is_symlink() {
                return Err(CoreError::validation(format!(
                    "Intelligent App staging directories must not contain symbolic links: {}",
                    entry.path().display()
                )));
            }
            if metadata.is_dir() {
                pending.push(entry.path());
            }
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CopyTreeMode {
    All,
    ReleaseArtifact,
}

async fn copy_tree_strict(source: &Path, destination: &Path, mode: CopyTreeMode) -> CoreResult<()> {
    if destination.exists() {
        return Err(CoreError::validation(format!(
            "Copy destination already exists: {}",
            destination.display()
        )));
    }
    fs::create_dir(destination).await?;
    let mut pending = vec![(source.to_path_buf(), destination.to_path_buf())];
    while let Some((source_dir, destination_dir)) = pending.pop() {
        let mut entries = fs::read_dir(&source_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let source_path = entry.path();
            let destination_path = destination_dir.join(entry.file_name());
            let metadata = fs::symlink_metadata(&source_path).await?;
            if metadata.file_type().is_symlink() {
                let _ = remove_tree_force(destination).await;
                return Err(CoreError::validation(format!(
                    "Intelligent App sources must not contain symbolic links: {}",
                    source_path.display()
                )));
            }
            if mode == CopyTreeMode::ReleaseArtifact
                && should_exclude_release_entry(&entry.file_name())
            {
                continue;
            }
            if metadata.is_dir() {
                fs::create_dir(&destination_path).await?;
                pending.push((source_path, destination_path));
            } else if metadata.is_file() {
                fs::copy(&source_path, &destination_path).await?;
            } else {
                let _ = remove_tree_force(destination).await;
                return Err(CoreError::validation(format!(
                    "Unsupported Intelligent App source entry: {}",
                    source_path.display()
                )));
            }
        }
    }
    Ok(())
}

fn should_exclude_release_entry(name: &std::ffi::OsStr) -> bool {
    matches!(
        name.to_string_lossy().as_ref(),
        "checkpoints" | "previews" | "node_modules" | ".git" | ".sparo_os"
    )
}

async fn seal_artifact_tree(root: &Path) -> CoreResult<()> {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let mut entries = fs::read_dir(directory).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).await?;
            if metadata.is_dir() {
                pending.push(path);
            } else if metadata.is_file() {
                let mut permissions = metadata.permissions();
                permissions.set_readonly(true);
                fs::set_permissions(path, permissions).await?;
            }
        }
    }
    Ok(())
}

async fn make_tree_writable(root: &Path) -> CoreResult<()> {
    if !root.exists() {
        return Ok(());
    }
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let mut entries = fs::read_dir(directory).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).await?;
            if metadata.is_dir() {
                pending.push(path);
            } else if metadata.is_file() && metadata.permissions().readonly() {
                make_file_writable(&path, metadata.permissions()).await?;
            }
        }
    }
    Ok(())
}

#[cfg(windows)]
async fn make_file_writable(path: &Path, mut permissions: std::fs::Permissions) -> CoreResult<()> {
    permissions.set_readonly(false);
    fs::set_permissions(path, permissions).await?;
    Ok(())
}

#[cfg(unix)]
async fn make_file_writable(path: &Path, permissions: std::fs::Permissions) -> CoreResult<()> {
    use std::os::unix::fs::PermissionsExt;
    let mode = permissions.mode() | 0o200;
    fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).await?;
    Ok(())
}

#[cfg(not(any(windows, unix)))]
async fn make_file_writable(path: &Path, mut permissions: std::fs::Permissions) -> CoreResult<()> {
    permissions.set_readonly(false);
    fs::set_permissions(path, permissions).await?;
    Ok(())
}

async fn remove_tree_force(root: &Path) -> CoreResult<()> {
    make_tree_writable(root).await?;
    if root.exists() {
        fs::remove_dir_all(root).await?;
    }
    Ok(())
}

async fn digest_directory(root: &Path) -> CoreResult<String> {
    if !root.is_dir() {
        return Err(CoreError::NotFound(format!(
            "Artifact directory {}",
            root.display()
        )));
    }
    let mut files = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let mut entries = fs::read_dir(&directory).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).await?;
            if metadata.file_type().is_symlink() {
                return Err(CoreError::validation(format!(
                    "Release artifacts must not contain symbolic links: {}",
                    path.display()
                )));
            }
            if metadata.is_dir() {
                pending.push(path);
            } else if metadata.is_file() {
                let relative = path.strip_prefix(root).map_err(|error| {
                    CoreError::validation(format!("Invalid artifact path: {error}"))
                })?;
                files.push((normalize_relative_path(relative), path));
            } else {
                return Err(CoreError::validation(format!(
                    "Unsupported release artifact entry: {}",
                    path.display()
                )));
            }
        }
    }
    files.sort_by(|left, right| left.0.cmp(&right.0));

    let mut hasher = Sha256::new();
    hasher.update(ARTIFACT_DIGEST_DOMAIN);
    for (relative, path) in files {
        let relative = relative.as_bytes();
        hasher.update((relative.len() as u64).to_le_bytes());
        hasher.update(relative);
        let bytes = fs::read(path).await?;
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(bytes);
    }
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

fn normalize_relative_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

async fn remove_draft_directory(draft: &DraftRecord, draft_path: &Path) {
    if let Err(error) = remove_tree_force(draft_path).await {
        log::warn!(
            "Failed to remove app draft directory: draft_id={}, path={}, error={}",
            draft.draft_id,
            draft_path.display(),
            error
        );
    }
}

async fn persist_registry(root: &Path, registry: &Registry) -> CoreResult<()> {
    atomic_write_json(&root.join(REGISTRY_FILE), registry).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest(seed: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(seed.as_bytes());
        format!("sha256:{}", hex::encode(hasher.finalize()))
    }

    fn metadata(version: &str) -> ReleaseMetadata {
        ReleaseMetadata {
            version: version.to_string(),
            component_lock_digest: digest(&format!("lock-{version}")),
            config_revision: digest(&format!("config-{version}")),
            data_schema_version: "1.0.0".to_string(),
            runtime_compatibility: ">=0.1.0".to_string(),
            capability_fingerprint: digest("capabilities"),
            evaluation_report_digest: digest(&format!("evaluation-{version}")),
            runtime: ReleaseRuntimeSpec {
                launch: None,
                primary_surface: None,
                primary_surface_mode: None,
                work_multiplicity: AppWorkMultiplicity::Multiple,
                icon: AppIconSpec::Monogram {
                    label: "App".to_string(),
                    seed: None,
                    background: None,
                },
                category: String::new(),
                tags: Vec::new(),
            },
            label: None,
            notes: None,
            provenance: ReleaseProvenanceKind::User,
            signature: None,
            upstream_app_id: None,
            upstream_base_release_id: None,
        }
    }

    fn system_metadata(version: &str) -> ReleaseMetadata {
        ReleaseMetadata {
            provenance: ReleaseProvenanceKind::System,
            ..metadata(version)
        }
    }

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "sparo-revision-store-{name}-{}",
            Uuid::new_v4().simple()
        ))
    }

    async fn write_source(path: &Path, app_id: &str) {
        let app = serde_json::json!({
            "id": app_id,
            "version": "1.0.0",
            "name": "Writer",
            "description": "Writer test app",
            "interactionModel": "conversation",
            "workMultiplicity": "multiple",
            "workObjectKinds": [{
                "id": "task",
                "label": "Task",
                "scope": "runtime",
                "identitySchema": { "type": "object" },
                "contextSchema": { "type": "object" }
            }],
            "dataLifecycle": {
                "retention": "workRuntimeScoped",
                "deletion": "deleteWithWork",
                "migration": "notSupported",
                "share": "excludeRuntimePrivateData"
            },
            "components": [],
            "componentLockId": "",
            "permissions": {
                "fs": false,
                "net": false,
                "shell": false,
                "gui": false,
                "secrets": false,
                "ai": true
            },
            "installScope": "system",
            "catalogVisibility": "discoverable",
            "enabled": true,
            "icon": { "kind": "lucide", "name": "PenLine" },
            "category": "writing",
            "tags": [],
            "launch": {
                "kind": "agentSession",
                "targetId": "Runno",
                "scopeRequirement": "systemAllowed",
                "agentType": "Runno"
            }
        });
        fs::write(
            path.join("app.json"),
            serde_json::to_vec_pretty(&app).unwrap(),
        )
        .await
        .unwrap();
        fs::create_dir(path.join("components")).await.unwrap();
        fs::create_dir_all(path.join("config")).await.unwrap();
        fs::write(path.join("config").join("default.json"), b"{}")
            .await
            .unwrap();
        fs::write(
            path.join("config").join("data-schema.json"),
            br#"{"version":"1.0.0"}"#,
        )
        .await
        .unwrap();
        fs::write(
            path.join("compatibility.json"),
            br#"{"runtimeCompatibility":">=0.1.0"}"#,
        )
        .await
        .unwrap();
        fs::create_dir_all(path.join("tests")).await.unwrap();
        fs::write(
            path.join("tests").join("rehearsal.json"),
            br#"{
                "version": 1,
                "scenarios": [{
                    "id": "critical-user-path",
                    "title": "Open the app and complete a task",
                    "kind": "user-path",
                    "steps": [{
                        "id": "open",
                        "action": "open",
                        "target": "agent-session",
                        "expect": ["The app opens"]
                    }],
                    "expected": ["The app opens without a fatal runtime issue"]
                }]
            }"#,
        )
        .await
        .unwrap();
        fs::write(
            path.join("tests").join("eval.json"),
            br#"{
                "version": 1,
                "cases": [{
                    "id": "primary-behavior",
                    "title": "Respond from the app context",
                    "input": { "message": "Help with this task" },
                    "expectations": [{
                        "kind": "text-contains",
                        "value": "task"
                    }],
                    "evidenceKind": "behavior",
                    "required": true
                }]
            }"#,
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn open_treats_staging_cleanup_failure_as_non_fatal_maintenance() {
        let root = test_root("non-fatal-staging-cleanup");
        let store_root = root.join(STORE_DIRECTORY);
        fs::create_dir_all(&store_root).await.unwrap();
        let blocked_entry = store_root.join(".publish-staging-blocked");
        fs::write(&blocked_entry, b"unexpected file").await.unwrap();

        let store = AppRevisionStore::open(&root)
            .await
            .expect("staging cleanup must not prevent opening the store");

        assert!(store.list_apps().await.is_empty());
        assert!(blocked_entry.is_file());
        let _ = fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn system_release_can_be_forked_published_activated_and_rolled_back() {
        let root = test_root("fork");
        let package = root.join("official-package");
        fs::create_dir_all(&package).await.unwrap();
        write_source(&package, "system.writer").await;
        let store = AppRevisionStore::open(&root).await.unwrap();

        let official = store
            .import_release_from_package(
                &package,
                ImportReleaseFromPackageRequest {
                    app_id: "system.writer".to_string(),
                    slot_id: "writer".to_string(),
                    display_name: "Writer".to_string(),
                    description: Some("Official writer".to_string()),
                    owner: AppOwner::system(),
                    parent_release_id: None,
                    metadata: system_metadata("1.0.0"),
                },
            )
            .await
            .unwrap();
        let official_activation = store
            .activate_for_runtime(
                ActivateReleaseRequest {
                    scope: AppActivationScope::System,
                    slot_id: "writer".to_string(),
                    app_id: "system.writer".to_string(),
                    release_id: official.release_id.clone(),
                },
                "0.1.0",
                ActivationExpectation::Unchecked,
            )
            .await
            .unwrap();

        let fork = store
            .fork_release(ForkReleaseRequest {
                source_release_id: official.release_id.clone(),
                new_app_id: Some("user.writer".to_string()),
                slot_id: None,
                display_name: Some("My Writer".to_string()),
                description: None,
                owner: AppOwner::user("local"),
            })
            .await
            .unwrap();
        assert_eq!(fork.app.slot_id, "writer");
        assert_eq!(
            fork.app.derived_from.as_ref().unwrap().release_id,
            official.release_id
        );
        let resolved_draft = store.resolve_draft(&fork.draft.draft_id).await.unwrap();
        fs::write(resolved_draft.source_path.join("user-notes.txt"), b"custom")
            .await
            .unwrap();

        let custom = store
            .publish_draft(
                PublishDraftRequest {
                    draft_id: fork.draft.draft_id,
                    version: "1.0.0".to_string(),
                    label: None,
                    notes: None,
                    provenance: ReleaseProvenanceKind::User,
                },
                &[],
            )
            .await
            .unwrap();
        assert_eq!(custom.parent_release_id, None);
        assert_eq!(custom.upstream_app_id.as_deref(), Some("system.writer"));
        assert_eq!(
            custom.upstream_base_release_id.as_deref(),
            Some(official.release_id.as_str())
        );
        let official_artifact = store
            .resolve_release("system.writer", &official.release_id)
            .await
            .unwrap();
        let official_manifest: serde_json::Value = serde_json::from_slice(
            &fs::read(official_artifact.artifact_path.join("app.json"))
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            official_manifest["id"],
            serde_json::Value::String("system.writer".to_string())
        );

        let _custom_activation = store
            .activate_for_runtime(
                ActivateReleaseRequest {
                    scope: AppActivationScope::System,
                    slot_id: "writer".to_string(),
                    app_id: "user.writer".to_string(),
                    release_id: custom.release_id.clone(),
                },
                "0.1.0",
                ActivationExpectation::Unchecked,
            )
            .await
            .unwrap();
        let stale_activation = store
            .activate_if_current(
                ActivateReleaseRequest {
                    scope: AppActivationScope::System,
                    slot_id: "writer".to_string(),
                    app_id: "system.writer".to_string(),
                    release_id: official.release_id.clone(),
                },
                Some(&official_activation),
            )
            .await
            .unwrap_err();
        assert!(stale_activation
            .to_string()
            .contains("changed after authorization"));
        assert_eq!(
            store
                .get_active(&AppActivationScope::System, "writer")
                .await
                .unwrap()
                .active_release_id,
            custom.release_id
        );
        store
            .deactivate(&AppActivationScope::System, "writer")
            .await
            .unwrap();
        let (preserved, outcome) = store
            .initialize_system_release(ActivateReleaseRequest {
                scope: AppActivationScope::System,
                slot_id: "writer".to_string(),
                app_id: "system.writer".to_string(),
                release_id: official.release_id.clone(),
            })
            .await
            .unwrap();
        assert_eq!(outcome, SystemReleaseInitializationOutcome::Preserved);
        assert!(!preserved.enabled);
        assert_eq!(preserved.selected_app_id, "user.writer");

        let reopened = AppRevisionStore::open(&root).await.unwrap();
        assert_eq!(
            reopened
                .get_active(&AppActivationScope::System, "writer")
                .await
                .unwrap(),
            preserved
        );
        reopened
            .verify_release_artifact(&custom.release_id)
            .await
            .unwrap();

        remove_tree_force(&root).await.unwrap();
    }

    #[tokio::test]
    async fn rebase_draft_materializes_three_way_inputs_and_advances_upstream_projection() {
        let root = test_root("rebase");
        let upstream_v1_package = root.join("upstream-v1");
        fs::create_dir_all(&upstream_v1_package).await.unwrap();
        write_source(&upstream_v1_package, "system.writer").await;
        fs::write(upstream_v1_package.join("content.txt"), b"upstream-v1")
            .await
            .unwrap();
        fs::write(upstream_v1_package.join("auto.txt"), b"base-auto")
            .await
            .unwrap();
        fs::write(upstream_v1_package.join("deleted.txt"), b"remove-me")
            .await
            .unwrap();
        fs::write(upstream_v1_package.join("converged.txt"), b"base-value")
            .await
            .unwrap();
        let upstream_v2_package = root.join("upstream-v2");
        fs::create_dir_all(&upstream_v2_package).await.unwrap();
        write_source(&upstream_v2_package, "system.writer").await;
        fs::write(upstream_v2_package.join("content.txt"), b"upstream-v2")
            .await
            .unwrap();
        fs::write(upstream_v2_package.join("auto.txt"), b"target-auto")
            .await
            .unwrap();
        fs::write(upstream_v2_package.join("added.txt"), b"target-added")
            .await
            .unwrap();
        fs::write(upstream_v2_package.join("converged.txt"), b"shared-value")
            .await
            .unwrap();

        let store = AppRevisionStore::open(&root).await.unwrap();
        let upstream_v1 = store
            .import_release_from_package(
                &upstream_v1_package,
                ImportReleaseFromPackageRequest {
                    app_id: "system.writer".to_string(),
                    slot_id: "writer".to_string(),
                    display_name: "Writer".to_string(),
                    description: None,
                    owner: AppOwner::system(),
                    parent_release_id: None,
                    metadata: system_metadata("1.0.0"),
                },
            )
            .await
            .unwrap();
        let upstream_v2 = store
            .import_release_from_package(
                &upstream_v2_package,
                ImportReleaseFromPackageRequest {
                    app_id: "system.writer".to_string(),
                    slot_id: "writer".to_string(),
                    display_name: "Writer".to_string(),
                    description: None,
                    owner: AppOwner::system(),
                    parent_release_id: None,
                    metadata: system_metadata("2.0.0"),
                },
            )
            .await
            .unwrap();
        let fork = store
            .fork_release(ForkReleaseRequest {
                source_release_id: upstream_v1.release_id.clone(),
                new_app_id: Some("user.writer-rebase".to_string()),
                slot_id: None,
                display_name: Some("My Writer".to_string()),
                description: None,
                owner: AppOwner::user("local"),
            })
            .await
            .unwrap();
        let fork_source = store.resolve_draft(&fork.draft.draft_id).await.unwrap();
        fs::write(fork_source.source_path.join("content.txt"), b"user-custom")
            .await
            .unwrap();
        fs::write(
            fork_source.source_path.join("converged.txt"),
            b"shared-value",
        )
        .await
        .unwrap();
        let fork_release = store
            .publish_draft(
                PublishDraftRequest {
                    draft_id: fork.draft.draft_id,
                    version: "1.0.0".to_string(),
                    label: None,
                    notes: None,
                    provenance: ReleaseProvenanceKind::User,
                },
                &[],
            )
            .await
            .unwrap();

        let before = store.list_catalog(&AppActivationScope::System).await;
        let before_variant = before
            .slots
            .iter()
            .flat_map(|slot| &slot.variants)
            .find(|variant| variant.app.app_id == "user.writer-rebase")
            .unwrap();
        assert_eq!(
            before_variant.upstream_base_release_id.as_deref(),
            Some(upstream_v1.release_id.as_str())
        );
        assert_eq!(
            before_variant.upstream_latest_release_id.as_deref(),
            Some(upstream_v2.release_id.as_str())
        );
        assert!(before_variant.upstream_update_available);

        let rebase_draft = store
            .create_rebase_draft(
                "user.writer-rebase",
                &fork_release.release_id,
                &upstream_v2.release_id,
            )
            .await
            .unwrap();
        assert_eq!(rebase_draft.base_release_id, Some(fork_release.release_id));
        assert_eq!(
            rebase_draft.rebase_context,
            Some(DraftRebaseContext {
                upstream_app_id: "system.writer".to_string(),
                base_release_id: upstream_v1.release_id.clone(),
                target_release_id: upstream_v2.release_id.clone(),
            })
        );
        let rebase_source = store.resolve_draft(&rebase_draft.draft_id).await.unwrap();
        assert_eq!(
            fs::read(rebase_source.source_path.join("content.txt"))
                .await
                .unwrap(),
            b"user-custom"
        );
        assert_eq!(
            fs::read(rebase_source.source_path.join("auto.txt"))
                .await
                .unwrap(),
            b"target-auto"
        );
        assert_eq!(
            fs::read(rebase_source.source_path.join("added.txt"))
                .await
                .unwrap(),
            b"target-added"
        );
        assert!(!rebase_source.source_path.join("deleted.txt").exists());
        assert_eq!(
            fs::read(rebase_source.source_path.join("converged.txt"))
                .await
                .unwrap(),
            b"shared-value"
        );
        let rebase_metadata = rebase_source.source_path.join(".sparo_os/rebase");
        assert_eq!(
            fs::read(rebase_metadata.join("base/content.txt"))
                .await
                .unwrap(),
            b"upstream-v1"
        );
        assert_eq!(
            fs::read(rebase_metadata.join("target/content.txt"))
                .await
                .unwrap(),
            b"upstream-v2"
        );
        assert!(fs::metadata(rebase_metadata.join("base/content.txt"))
            .await
            .unwrap()
            .permissions()
            .readonly());
        assert!(fs::metadata(rebase_metadata.join("manifest.json"))
            .await
            .unwrap()
            .permissions()
            .readonly());
        let manifest: serde_json::Value = serde_json::from_slice(
            &fs::read(rebase_metadata.join("manifest.json"))
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["baseReleaseId"], upstream_v1.release_id);
        assert_eq!(manifest["targetReleaseId"], upstream_v2.release_id);
        let automatic_paths = manifest["automaticChanges"]
            .as_array()
            .unwrap()
            .iter()
            .map(|change| change["path"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            automatic_paths,
            vec!["added.txt", "auto.txt", "deleted.txt"]
        );
        let integrated_paths = manifest["integratedChanges"]
            .as_array()
            .unwrap()
            .iter()
            .map(|change| change["path"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(integrated_paths, vec!["converged.txt"]);
        let conflict_paths = manifest["conflicts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|conflict| conflict["path"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(conflict_paths, vec!["content.txt"]);

        let unresolved_error = store
            .publish_draft(
                PublishDraftRequest {
                    draft_id: rebase_draft.draft_id.clone(),
                    version: "2.0.0".to_string(),
                    label: None,
                    notes: None,
                    provenance: ReleaseProvenanceKind::User,
                },
                &[],
            )
            .await
            .unwrap_err();
        assert!(unresolved_error.to_string().contains("Unresolved Rebase"));
        assert!(unresolved_error.to_string().contains("content.txt"));
        fs::write(
            rebase_source.source_path.join("content.txt"),
            b"user-resolved",
        )
        .await
        .unwrap();
        let rebased_release = store
            .publish_draft(
                PublishDraftRequest {
                    draft_id: rebase_draft.draft_id,
                    version: "2.0.0".to_string(),
                    label: None,
                    notes: None,
                    provenance: ReleaseProvenanceKind::User,
                },
                &[],
            )
            .await
            .unwrap();
        assert_eq!(
            rebased_release.upstream_base_release_id.as_deref(),
            Some(upstream_v2.release_id.as_str())
        );
        let rebased_artifact = store
            .resolve_release("user.writer-rebase", &rebased_release.release_id)
            .await
            .unwrap();
        assert!(!rebased_artifact.artifact_path.join(".sparo_os").exists());

        let after = store.list_catalog(&AppActivationScope::System).await;
        let after_variant = after
            .slots
            .iter()
            .flat_map(|slot| &slot.variants)
            .find(|variant| variant.app.app_id == "user.writer-rebase")
            .unwrap();
        assert_eq!(
            after_variant.upstream_base_release_id.as_deref(),
            Some(upstream_v2.release_id.as_str())
        );
        assert_eq!(
            after_variant.upstream_latest_release_id.as_deref(),
            Some(upstream_v2.release_id.as_str())
        );
        assert!(!after_variant.upstream_update_available);

        remove_tree_force(&root).await.unwrap();
    }

    #[tokio::test]
    async fn rebase_draft_rejects_non_fork_and_cross_upstream_target() {
        let root = test_root("rebase-validation");
        let system_package = root.join("system");
        fs::create_dir_all(&system_package).await.unwrap();
        write_source(&system_package, "system.writer").await;
        let other_package = root.join("other");
        fs::create_dir_all(&other_package).await.unwrap();
        write_source(&other_package, "system.other").await;
        let store = AppRevisionStore::open(&root).await.unwrap();
        let system_release = store
            .import_release_from_package(
                &system_package,
                ImportReleaseFromPackageRequest {
                    app_id: "system.writer".to_string(),
                    slot_id: "writer".to_string(),
                    display_name: "Writer".to_string(),
                    description: None,
                    owner: AppOwner::system(),
                    parent_release_id: None,
                    metadata: system_metadata("1.0.0"),
                },
            )
            .await
            .unwrap();
        let other_release = store
            .import_release_from_package(
                &other_package,
                ImportReleaseFromPackageRequest {
                    app_id: "system.other".to_string(),
                    slot_id: "other".to_string(),
                    display_name: "Other".to_string(),
                    description: None,
                    owner: AppOwner::system(),
                    parent_release_id: None,
                    metadata: system_metadata("2.0.0"),
                },
            )
            .await
            .unwrap();
        let system_error = store
            .create_rebase_draft(
                "system.writer",
                &system_release.release_id,
                &other_release.release_id,
            )
            .await
            .unwrap_err();
        assert!(system_error.to_string().contains("cannot create rebase"));

        let fork = store
            .fork_release(ForkReleaseRequest {
                source_release_id: system_release.release_id,
                new_app_id: Some("user.writer-validation".to_string()),
                slot_id: None,
                display_name: None,
                description: None,
                owner: AppOwner::organization("org"),
            })
            .await
            .unwrap();
        let fork_release = store
            .publish_draft(
                PublishDraftRequest {
                    draft_id: fork.draft.draft_id,
                    version: "1.0.0".to_string(),
                    label: None,
                    notes: None,
                    provenance: ReleaseProvenanceKind::Organization,
                },
                &[],
            )
            .await
            .unwrap();
        let cross_upstream_error = store
            .create_rebase_draft(
                "user.writer-validation",
                &fork_release.release_id,
                &other_release.release_id,
            )
            .await
            .unwrap_err();
        assert!(cross_upstream_error.to_string().contains("belongs to app"));

        remove_tree_force(&root).await.unwrap();
    }

    #[tokio::test]
    async fn publishing_creates_distinct_immutable_content_addressed_artifacts() {
        let root = test_root("immutable");
        let store = AppRevisionStore::open(&root).await.unwrap();
        let created = store
            .create_intelligent_app(CreateIntelligentAppRequest {
                app_id: Some("user.notes".to_string()),
                slot_id: Some("notes".to_string()),
                display_name: Some("Notes".to_string()),
                description: None,
                owner: AppOwner::user("local"),
            })
            .await
            .unwrap();
        let first_draft = store.resolve_draft(&created.draft.draft_id).await.unwrap();
        write_source(&first_draft.source_path, "user.notes").await;
        fs::write(first_draft.source_path.join("content.txt"), b"one")
            .await
            .unwrap();
        for excluded in ["checkpoints", "previews", "node_modules", ".git"] {
            let directory = first_draft.source_path.join(excluded);
            fs::create_dir(&directory).await.unwrap();
            fs::write(directory.join("draft-only.txt"), b"not released")
                .await
                .unwrap();
        }
        let first = store
            .publish_draft(
                PublishDraftRequest {
                    draft_id: created.draft.draft_id,
                    version: "1.0.0".to_string(),
                    label: None,
                    notes: None,
                    provenance: ReleaseProvenanceKind::User,
                },
                &[],
            )
            .await
            .unwrap();

        let second_draft = store
            .create_draft(CreateDraftRequest {
                app_id: "user.notes".to_string(),
                base_release_id: Some(first.release_id.clone()),
            })
            .await
            .unwrap();
        let second_source = store.resolve_draft(&second_draft.draft_id).await.unwrap();
        fs::write(second_source.source_path.join("content.txt"), b"two")
            .await
            .unwrap();
        let second = store
            .publish_draft(
                PublishDraftRequest {
                    draft_id: second_draft.draft_id,
                    version: "2.0.0".to_string(),
                    label: None,
                    notes: None,
                    provenance: ReleaseProvenanceKind::User,
                },
                &[],
            )
            .await
            .unwrap();
        assert_ne!(first.artifact_digest, second.artifact_digest);
        assert_ne!(first.release_id, second.release_id);
        let first_resolved = store
            .resolve_release("user.notes", &first.release_id)
            .await
            .unwrap();
        let second_resolved = store
            .resolve_release("user.notes", &second.release_id)
            .await
            .unwrap();
        assert_ne!(first_resolved.artifact_path, second_resolved.artifact_path);
        for excluded in [
            "checkpoints",
            "previews",
            "node_modules",
            ".git",
            ".sparo_os",
        ] {
            assert!(!first_resolved.artifact_path.join(excluded).exists());
        }
        assert!(fs::metadata(first_resolved.artifact_path.join("app.json"))
            .await
            .unwrap()
            .permissions()
            .readonly());
        assert_eq!(
            fs::read_to_string(first_resolved.artifact_path.join("content.txt"))
                .await
                .unwrap(),
            "one"
        );
        assert_eq!(
            fs::read_to_string(second_resolved.artifact_path.join("content.txt"))
                .await
                .unwrap(),
            "two"
        );
        let first_app: AppDefinition = serde_json::from_slice(
            &fs::read(first_resolved.artifact_path.join("app.json"))
                .await
                .unwrap(),
        )
        .unwrap();
        let second_app: AppDefinition = serde_json::from_slice(
            &fs::read(second_resolved.artifact_path.join("app.json"))
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(first_app.version, "1.0.0");
        assert_eq!(second_app.version, "2.0.0");
        let published_app = store.get_app("user.notes").await.unwrap();
        assert_eq!(published_app.display_name, "Writer");
        assert_eq!(
            published_app.description.as_deref(),
            Some("Writer test app")
        );

        remove_tree_force(&root).await.unwrap();
    }

    #[tokio::test]
    async fn failed_publish_is_atomic_and_leaves_the_real_draft_unchanged() {
        let root = test_root("atomic-publish-failure");
        let store = AppRevisionStore::open(&root).await.unwrap();
        let created = store
            .create_intelligent_app(CreateIntelligentAppRequest {
                app_id: Some("user.atomic".to_string()),
                slot_id: Some("atomic".to_string()),
                display_name: Some("Atomic Draft".to_string()),
                description: Some("Original description".to_string()),
                owner: AppOwner::user("local"),
            })
            .await
            .unwrap();
        let resolved = store.resolve_draft(&created.draft.draft_id).await.unwrap();
        write_source(&resolved.source_path, "user.atomic").await;
        fs::write(
            resolved.source_path.join("config").join("default.json"),
            b"{invalid",
        )
        .await
        .unwrap();
        let original_app = fs::read(resolved.source_path.join("app.json"))
            .await
            .unwrap();

        let error = store
            .publish_draft(
                PublishDraftRequest {
                    draft_id: created.draft.draft_id.clone(),
                    version: "9.9.9".to_string(),
                    label: None,
                    notes: None,
                    provenance: ReleaseProvenanceKind::User,
                },
                &[],
            )
            .await
            .unwrap_err();
        assert!(
            error.to_string().contains("config\\default.json")
                || error.to_string().contains("config/default.json")
        );
        assert_eq!(
            fs::read(resolved.source_path.join("app.json"))
                .await
                .unwrap(),
            original_app
        );
        assert!(!resolved.source_path.join("app.lock.json").exists());
        assert!(!resolved
            .source_path
            .join("tests")
            .join("release-evaluation.json")
            .exists());
        assert!(store.resolve_draft(&created.draft.draft_id).await.is_ok());
        let published_app = store.get_app("user.atomic").await.unwrap();
        assert_eq!(published_app.display_name, "Atomic Draft");
        assert_eq!(
            published_app.description.as_deref(),
            Some("Original description")
        );
        let mut entries = fs::read_dir(store.storage_root()).await.unwrap();
        while let Some(entry) = entries.next_entry().await.unwrap() {
            assert!(!entry
                .file_name()
                .to_string_lossy()
                .starts_with(".publish-staging-"));
        }

        remove_tree_force(&root).await.unwrap();
    }

    #[tokio::test]
    async fn opening_store_removes_only_abandoned_publish_staging_directories() {
        let root = test_root("publish-staging-recovery");
        let store_root = root.join(STORE_DIRECTORY);
        let publish_staging = store_root.join(".publish-staging-abandoned");
        let system_seed_staging = store_root.join(".system-seed-abandoned");
        let draft_staging = store_root.join("drafts").join(".staging-abandoned");
        let artifact_staging = store_root.join("artifacts").join(".staging-abandoned");
        let formal_artifact = store_root.join("artifacts").join("formal-artifact");
        let formal_draft = store_root.join("drafts").join("formal-draft");
        for directory in [
            &publish_staging,
            &system_seed_staging,
            &draft_staging,
            &artifact_staging,
            &formal_artifact,
            &formal_draft,
        ] {
            fs::create_dir_all(directory).await.unwrap();
            fs::write(directory.join("sentinel"), b"keep-or-clean")
                .await
                .unwrap();
        }

        let _store = AppRevisionStore::open(&root).await.unwrap();

        assert!(!publish_staging.exists());
        assert!(system_seed_staging.join("sentinel").is_file());
        assert!(!draft_staging.exists());
        assert!(!artifact_staging.exists());
        assert!(formal_artifact.join("sentinel").is_file());
        assert!(formal_draft.join("sentinel").is_file());
        remove_tree_force(&root).await.unwrap();
    }

    #[tokio::test]
    async fn draft_identity_manifest_is_required_and_bound_to_registry_coordinates() {
        let root = test_root("draft-identity");
        let store = AppRevisionStore::open(&root).await.unwrap();
        let created = store
            .create_intelligent_app(CreateIntelligentAppRequest {
                app_id: Some("user.identity".to_string()),
                slot_id: Some("identity".to_string()),
                display_name: Some("Identity".to_string()),
                description: None,
                owner: AppOwner::user("local"),
            })
            .await
            .unwrap();
        let resolved = store.resolve_draft(&created.draft.draft_id).await.unwrap();
        let manifest_path = resolved.source_path.join(".sparo_os/draft.json");
        let manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).await.unwrap()).unwrap();
        assert_eq!(
            manifest,
            serde_json::json!({
                "schemaVersion": 1,
                "draftId": created.draft.draft_id,
                "appId": "user.identity",
            })
        );
        let mut permissions = fs::metadata(&manifest_path).await.unwrap().permissions();
        assert!(permissions.readonly());
        permissions.set_readonly(false);
        fs::set_permissions(&manifest_path, permissions)
            .await
            .unwrap();
        fs::write(
            &manifest_path,
            serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 1,
                "draftId": created.draft.draft_id,
                "appId": "user.other",
            }))
            .unwrap(),
        )
        .await
        .unwrap();
        let mismatch = store
            .resolve_draft(&created.draft.draft_id)
            .await
            .unwrap_err();
        assert!(mismatch
            .to_string()
            .contains("does not match registry coordinates"));

        fs::remove_file(&manifest_path).await.unwrap();
        let missing = store
            .publish_draft(
                PublishDraftRequest {
                    draft_id: created.draft.draft_id,
                    version: "1.0.0".to_string(),
                    label: None,
                    notes: None,
                    provenance: ReleaseProvenanceKind::User,
                },
                &[],
            )
            .await
            .unwrap_err();
        assert!(missing
            .to_string()
            .contains("Draft identity manifest is unavailable"));

        remove_tree_force(&root).await.unwrap();
    }

    #[tokio::test]
    async fn delete_draft_removes_mutable_source_but_preserves_app_identity() {
        let root = test_root("delete-draft");
        let store = AppRevisionStore::open(&root).await.unwrap();
        let created = store
            .create_intelligent_app(CreateIntelligentAppRequest {
                app_id: Some("user.delete-draft".to_string()),
                slot_id: Some("delete-draft".to_string()),
                display_name: Some("Delete Draft".to_string()),
                description: None,
                owner: AppOwner::user("local"),
            })
            .await
            .unwrap();
        let resolved = store.resolve_draft(&created.draft.draft_id).await.unwrap();
        fs::write(resolved.source_path.join("notes.txt"), b"unpublished")
            .await
            .unwrap();

        let deleted = store.delete_draft(&created.draft.draft_id).await.unwrap();

        assert_eq!(deleted, created.draft);
        assert!(!resolved.source_path.exists());
        assert!(store
            .list_drafts(Some("user.delete-draft"))
            .await
            .is_empty());
        assert!(store.resolve_draft(&deleted.draft_id).await.is_err());
        assert!(store.get_app("user.delete-draft").await.is_some());

        remove_tree_force(&root).await.unwrap();
    }

    #[tokio::test]
    async fn archive_removes_user_drafts_releases_and_artifacts() {
        let root = test_root("archive");
        let store = AppRevisionStore::open(&root).await.unwrap();
        let created = store
            .create_intelligent_app(CreateIntelligentAppRequest {
                app_id: Some("user.archive".to_string()),
                slot_id: Some("archive".to_string()),
                display_name: Some("Archive".to_string()),
                description: None,
                owner: AppOwner::user("local"),
            })
            .await
            .unwrap();
        let draft = store.resolve_draft(&created.draft.draft_id).await.unwrap();
        write_source(&draft.source_path, "user.archive").await;
        let release = store
            .publish_draft(
                PublishDraftRequest {
                    draft_id: created.draft.draft_id,
                    version: "1.0.0".to_string(),
                    label: None,
                    notes: None,
                    provenance: ReleaseProvenanceKind::User,
                },
                &[],
            )
            .await
            .unwrap();
        let extra_draft = store
            .create_draft(CreateDraftRequest {
                app_id: "user.archive".to_string(),
                base_release_id: Some(release.release_id.clone()),
            })
            .await
            .unwrap();

        let archived = store.archive_app("user.archive").await.unwrap();
        assert_eq!(archived.removed_draft_ids, vec![extra_draft.draft_id]);
        assert_eq!(
            archived.removed_release_ids,
            vec![release.release_id.clone()]
        );
        assert!(store.get_app("user.archive").await.is_none());
        assert!(store.list_drafts(Some("user.archive")).await.is_empty());
        assert!(store
            .resolve_release("user.archive", &release.release_id)
            .await
            .is_err());

        let error = store
            .create_intelligent_app(CreateIntelligentAppRequest {
                app_id: Some("user.archive".to_string()),
                slot_id: Some("archive".to_string()),
                display_name: Some("Reused identity".to_string()),
                description: None,
                owner: AppOwner::user("local"),
            })
            .await
            .unwrap_err();
        assert!(error.to_string().contains("already used"));

        remove_tree_force(&root).await.unwrap();
    }

    #[tokio::test]
    async fn activation_rejects_release_from_another_app_and_incompatible_runtime() {
        let root = test_root("activation-validation");
        let store = AppRevisionStore::open(&root).await.unwrap();
        let package = root.join("package");
        fs::create_dir_all(&package).await.unwrap();
        fs::write(package.join("app.json"), b"{}").await.unwrap();
        let release = store
            .import_release_from_package(
                &package,
                ImportReleaseFromPackageRequest {
                    app_id: "system.one".to_string(),
                    slot_id: "one".to_string(),
                    display_name: "One".to_string(),
                    description: None,
                    owner: AppOwner::system(),
                    parent_release_id: None,
                    metadata: system_metadata("1.0.0"),
                },
            )
            .await
            .unwrap();
        store
            .create_intelligent_app(CreateIntelligentAppRequest {
                app_id: Some("user.two".to_string()),
                slot_id: Some("two".to_string()),
                display_name: Some("Two".to_string()),
                description: None,
                owner: AppOwner::user("local"),
            })
            .await
            .unwrap();

        let error = store
            .activate_for_runtime(
                ActivateReleaseRequest {
                    scope: AppActivationScope::System,
                    slot_id: "two".to_string(),
                    app_id: "user.two".to_string(),
                    release_id: release.release_id.clone(),
                },
                "0.1.0",
                ActivationExpectation::Unchecked,
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("belongs to app"));

        let error = store
            .activate_for_runtime(
                ActivateReleaseRequest {
                    scope: AppActivationScope::System,
                    slot_id: "one".to_string(),
                    app_id: "system.one".to_string(),
                    release_id: release.release_id,
                },
                "0.0.1",
                ActivationExpectation::Unchecked,
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("requires runtime"));

        remove_tree_force(&root).await.unwrap();
    }

    #[tokio::test]
    async fn system_snapshot_sync_replaces_same_version_without_weakening_strict_import() {
        let root = test_root("system-snapshot-replacement");
        let store = AppRevisionStore::open(&root).await.unwrap();
        let first_package = root.join("system-snapshot-first");
        fs::create_dir_all(&first_package).await.unwrap();
        fs::write(first_package.join("content.txt"), b"first snapshot")
            .await
            .unwrap();
        let request = || ImportReleaseFromPackageRequest {
            app_id: "system.snapshot".to_string(),
            slot_id: "system-snapshot".to_string(),
            display_name: "System Snapshot".to_string(),
            description: Some("Current development snapshot".to_string()),
            owner: AppOwner::system(),
            parent_release_id: None,
            metadata: system_metadata("1.0.0"),
        };

        let (first, first_sync, first_activation) = store
            .sync_system_release_from_package(&first_package, request())
            .await
            .unwrap();
        assert_eq!(first_sync, SystemReleaseSyncOutcome::Added);
        assert_eq!(
            first_activation,
            SystemReleaseInitializationOutcome::Created
        );

        let second_package = root.join("system-snapshot-second");
        fs::create_dir_all(&second_package).await.unwrap();
        fs::write(second_package.join("content.txt"), b"changed snapshot")
            .await
            .unwrap();
        let strict_error = store
            .import_release_from_package(&second_package, request())
            .await
            .expect_err("ordinary immutable import must still reject changed bytes");
        assert!(strict_error
            .to_string()
            .contains("publish changed content under a new version"));

        let (second, second_sync, second_activation) = store
            .sync_system_release_from_package(&second_package, request())
            .await
            .unwrap();
        assert_eq!(second_sync, SystemReleaseSyncOutcome::Replaced);
        assert_eq!(
            second_activation,
            SystemReleaseInitializationOutcome::Created
        );
        assert_ne!(first.release_id, second.release_id);
        assert!(store
            .resolve_release("system.snapshot", &first.release_id)
            .await
            .is_err());
        assert_eq!(
            store.list_releases(Some("system.snapshot")).await,
            vec![second.clone()]
        );
        assert_eq!(
            store
                .get_active(&AppActivationScope::System, "system-snapshot")
                .await
                .unwrap()
                .active_release_id,
            second.release_id
        );

        remove_tree_force(&root).await.unwrap();
    }

    #[tokio::test]
    async fn system_initialization_replaces_an_existing_official_release() {
        let root = test_root("system-initialization-policy");
        let store = AppRevisionStore::open(&root).await.unwrap();
        let first_package = root.join("system-v1");
        let second_package = root.join("system-v2");
        fs::create_dir_all(&first_package).await.unwrap();
        fs::create_dir_all(&second_package).await.unwrap();
        fs::write(first_package.join("app.json"), b"v1")
            .await
            .unwrap();
        fs::write(second_package.join("app.json"), b"v2")
            .await
            .unwrap();
        let first = store
            .import_release_from_package(
                &first_package,
                ImportReleaseFromPackageRequest {
                    app_id: "system.policy".to_string(),
                    slot_id: "system-policy".to_string(),
                    display_name: "System Policy".to_string(),
                    description: None,
                    owner: AppOwner::system(),
                    parent_release_id: None,
                    metadata: system_metadata("1.0.0"),
                },
            )
            .await
            .unwrap();
        let second = store
            .import_release_from_package(
                &second_package,
                ImportReleaseFromPackageRequest {
                    app_id: "system.policy".to_string(),
                    slot_id: "system-policy".to_string(),
                    display_name: "System Policy".to_string(),
                    description: None,
                    owner: AppOwner::system(),
                    parent_release_id: None,
                    metadata: system_metadata("2.0.0"),
                },
            )
            .await
            .unwrap();
        let first_artifact = artifact_path_for_digest(&root, &first.artifact_digest).unwrap();
        store
            .activate(ActivateReleaseRequest {
                scope: AppActivationScope::System,
                slot_id: "system-policy".to_string(),
                app_id: "system.policy".to_string(),
                release_id: first.release_id.clone(),
            })
            .await
            .unwrap();

        let (activated, outcome) = store
            .initialize_system_release(ActivateReleaseRequest {
                scope: AppActivationScope::System,
                slot_id: "system-policy".to_string(),
                app_id: "system.policy".to_string(),
                release_id: second.release_id.clone(),
            })
            .await
            .unwrap();
        assert_eq!(outcome, SystemReleaseInitializationOutcome::Created);
        assert_eq!(activated.active_release_id, second.release_id);
        let removed = store
            .prune_app_releases_except("system.policy", &second.release_id)
            .await
            .unwrap();
        assert_eq!(removed, vec![first.clone()]);
        assert!(store
            .resolve_release("system.policy", &first.release_id)
            .await
            .is_err());
        assert!(!first_artifact.exists());

        remove_tree_force(&root).await.unwrap();
    }

    #[tokio::test]
    async fn archive_atomically_detaches_active_routing_and_deletes_release() {
        let root = test_root("archive-active-app");
        let store = AppRevisionStore::open(&root).await.unwrap();
        let created = store
            .create_intelligent_app(CreateIntelligentAppRequest {
                app_id: Some("user.active-archive".to_string()),
                slot_id: Some("active-archive".to_string()),
                display_name: Some("Active Archive".to_string()),
                description: None,
                owner: AppOwner::user("local"),
            })
            .await
            .unwrap();
        let draft = store.resolve_draft(&created.draft.draft_id).await.unwrap();
        write_source(&draft.source_path, "user.active-archive").await;
        let release = store
            .publish_draft(
                PublishDraftRequest {
                    draft_id: created.draft.draft_id,
                    version: "1.0.0".to_string(),
                    label: None,
                    notes: None,
                    provenance: ReleaseProvenanceKind::User,
                },
                &[],
            )
            .await
            .unwrap();
        store
            .activate(ActivateReleaseRequest {
                scope: AppActivationScope::System,
                slot_id: "active-archive".to_string(),
                app_id: "user.active-archive".to_string(),
                release_id: release.release_id.clone(),
            })
            .await
            .unwrap();

        store.archive_app("user.active-archive").await.unwrap();
        assert!(store
            .get_active(&AppActivationScope::System, "active-archive")
            .await
            .is_none());
        assert!(store
            .resolve_release("user.active-archive", &release.release_id)
            .await
            .is_err());

        remove_tree_force(&root).await.unwrap();
    }

    #[tokio::test]
    async fn archive_preserves_an_active_official_selection() {
        let root = test_root("archive-rollback-pointer");
        let store = AppRevisionStore::open(&root).await.unwrap();
        let system_package = root.join("system-package");
        let user_package = root.join("user-package");
        fs::create_dir_all(&system_package).await.unwrap();
        fs::create_dir_all(&user_package).await.unwrap();
        fs::write(system_package.join("app.json"), b"system")
            .await
            .unwrap();
        fs::write(user_package.join("app.json"), b"user")
            .await
            .unwrap();

        let official = store
            .import_release_from_package(
                &system_package,
                ImportReleaseFromPackageRequest {
                    app_id: "system.rollback-base".to_string(),
                    slot_id: "rollback-slot".to_string(),
                    display_name: "Official".to_string(),
                    description: None,
                    owner: AppOwner::system(),
                    parent_release_id: None,
                    metadata: system_metadata("1.0.0"),
                },
            )
            .await
            .unwrap();
        let personal = store
            .import_release_from_package(
                &user_package,
                ImportReleaseFromPackageRequest {
                    app_id: "user.rollback-variant".to_string(),
                    slot_id: "rollback-slot".to_string(),
                    display_name: "Personal".to_string(),
                    description: None,
                    owner: AppOwner::user("local"),
                    parent_release_id: None,
                    metadata: metadata("1.0.0"),
                },
            )
            .await
            .unwrap();

        for (app_id, release_id) in [
            (official.app_id.as_str(), official.release_id.as_str()),
            (personal.app_id.as_str(), personal.release_id.as_str()),
            (official.app_id.as_str(), official.release_id.as_str()),
        ] {
            store
                .activate(ActivateReleaseRequest {
                    scope: AppActivationScope::System,
                    slot_id: "rollback-slot".to_string(),
                    app_id: app_id.to_string(),
                    release_id: release_id.to_string(),
                })
                .await
                .unwrap();
        }

        store.archive_app(&personal.app_id).await.unwrap();
        let activation = store
            .get_active(&AppActivationScope::System, "rollback-slot")
            .await
            .expect("official selection remains active");
        assert_eq!(activation.active_release_id, official.release_id);

        remove_tree_force(&root).await.unwrap();
    }

    #[test]
    fn activation_scope_is_global() {
        assert_eq!(
            serde_json::to_value(AppActivationScope::System).unwrap(),
            serde_json::json!({ "kind": "system" })
        );
    }
}
