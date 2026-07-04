//! Built-in Product App and Component packages bundled from
//! `bundles/product-apps/builtin` and `bundles/components`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use include_dir::{include_dir, Dir, File};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::infrastructure::PathManager;
use crate::util::errors::{BitFunError, BitFunResult};

use super::catalog_state::{
    install_product_app_with_source as mark_product_app_installed,
    product_app_installed_source_kind, uninstall_product_app as mark_product_app_uninstalled,
};
use super::native::is_native_system_lifecycle_id;
use super::versioning::current_product_app_package_digest;
use super::{
    apply_product_app_catalog_source_state, apply_product_app_catalog_state, AppCatalogEntry,
    AppCatalogVisibility, AppDefinition, AppManagementAction, AppSurfaceMode, AppWorkMultiplicity,
    ComponentDefinition, ComponentLock, ProductAppCatalogEntry, ProductAppCatalogIssue,
    ProductAppCatalogIssueSource, ProductAppCatalogSourceKind, ProductAppCatalogSourceRef,
    ProductAppLibrarySource, ProductAppManagementOrigin, ProductAppManagementPolicy,
    ProductAppPackage, ProductAppReleaseCatalogSourceManifest, ProductAppReleaseManifest,
    ProductAppResolver, ProductAppUninstallPolicy, ResolvedProductApp, WorkObjectScope,
    PRODUCT_APP_RELEASE_CATALOG_SOURCE_FILE, PRODUCT_APP_RELEASE_CATALOG_SOURCE_SCHEMA_VERSION,
    PRODUCT_APP_RELEASE_SCHEMA_VERSION,
};

static BUILTIN_PRODUCT_APPS_DIR: Dir<'_> =
    include_dir!("$CARGO_MANIFEST_DIR/../../../bundles/product-apps/builtin");
static BUILTIN_COMPONENTS_DIR: Dir<'_> =
    include_dir!("$CARGO_MANIFEST_DIR/../../../bundles/components");
static BUILTIN_PACKAGE_CATALOG_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));
static BUILTIN_PACKAGE_SEED_CACHE: LazyLock<Mutex<BTreeSet<BuiltinPackageSeedKey>>> =
    LazyLock::new(|| Mutex::new(BTreeSet::new()));
static PRODUCT_APP_SOURCE_SEED_CACHE: LazyLock<Mutex<BTreeSet<PathBuf>>> =
    LazyLock::new(|| Mutex::new(BTreeSet::new()));

const APP_JSON: &str = "app.json";
const APP_LOCK_JSON: &str = "app.lock.json";
const COMPONENT_JSON: &str = "component.json";
// Legacy bundle roots are kept out of Product App catalog scans while older
// worktrees finish deleting or migrating them.
const LEGACY_NON_PRODUCT_APP_ROOT_DIRS: &[&str] = &[
    "agent_apps",
    "agent_components",
    "bridge_apps",
    "bridge_components",
    "liveapps",
    "surface_components",
];

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppCatalogEntries {
    pub entries: Vec<AppCatalogEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub issues: Vec<ProductAppCatalogIssue>,
}

#[derive(Debug, Clone, Default)]
struct ProductAppProjectionBatch {
    apps: Vec<ResolvedProductApp>,
    degraded_apps: Vec<ResolvedProductApp>,
    issues: Vec<ProductAppCatalogIssue>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct BuiltinPackageSeedKey {
    product_apps_dir: PathBuf,
    components_dir: PathBuf,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishProductAppReleaseToCatalogRequest {
    pub release_manifest_path: PathBuf,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_by: Option<String>,
    pub published_at_ms: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedProductAppReleaseCatalogSource {
    pub app_id: String,
    pub version: String,
    pub release_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_notes: Option<String>,
    pub artifact_uri: String,
    pub source_dir: PathBuf,
    pub component_lock_digest: String,
    pub package_digest: String,
    pub published_at_ms: u64,
    pub work_id: String,
}

pub async fn seed_builtin_product_app_packages(
    path_manager: &PathManager,
) -> BitFunResult<Vec<String>> {
    let _guard = BUILTIN_PACKAGE_CATALOG_LOCK.lock().await;
    ensure_builtin_product_app_packages_seeded_unlocked(path_manager).await
}

async fn ensure_builtin_product_app_packages_seeded_unlocked(
    path_manager: &PathManager,
) -> BitFunResult<Vec<String>> {
    let key = BuiltinPackageSeedKey {
        product_apps_dir: path_manager.system_product_apps_dir(),
        components_dir: path_manager.system_components_dir(),
    };
    if seed_cache_contains(&BUILTIN_PACKAGE_SEED_CACHE, &key)
        && key.product_apps_dir.exists()
        && key.components_dir.exists()
    {
        return Ok(Vec::new());
    }

    let seeded = seed_builtin_product_app_packages_unlocked(path_manager).await?;
    seed_cache_insert(&BUILTIN_PACKAGE_SEED_CACHE, key);
    Ok(seeded)
}

async fn ensure_product_app_catalog_sources_seeded_unlocked(
    path_manager: &PathManager,
) -> BitFunResult<Vec<PathBuf>> {
    let key = product_app_sources_dir(path_manager);
    if seed_cache_contains(&PRODUCT_APP_SOURCE_SEED_CACHE, &key) && key.exists() {
        return Ok(Vec::new());
    }

    let seeded = seed_product_app_catalog_sources_unlocked(path_manager).await?;
    seed_cache_insert(&PRODUCT_APP_SOURCE_SEED_CACHE, key);
    Ok(seeded)
}

fn seed_cache_contains<T>(cache: &Mutex<BTreeSet<T>>, key: &T) -> bool
where
    T: Ord,
{
    cache
        .lock()
        .map(|guard| guard.contains(key))
        .unwrap_or(false)
}

fn seed_cache_insert<T>(cache: &Mutex<BTreeSet<T>>, key: T)
where
    T: Ord,
{
    if let Ok(mut guard) = cache.lock() {
        guard.insert(key);
    }
}

async fn seed_builtin_product_app_packages_unlocked(
    path_manager: &PathManager,
) -> BitFunResult<Vec<String>> {
    path_manager
        .ensure_dir(&path_manager.system_product_apps_dir())
        .await?;
    path_manager
        .ensure_dir(&path_manager.system_components_dir())
        .await?;

    for component_source in collect_component_package_sources() {
        if let Err(error) = seed_component_package(path_manager, &component_source).await {
            log::warn!(
                "seed builtin component package '{}' failed: {}",
                component_source.display(),
                error
            );
        }
    }

    let mut installed_app_dirs = Vec::new();
    installed_app_dirs.extend(collect_installed_product_app_dirs(
        &path_manager.system_product_apps_dir(),
    )?);

    let shared_components = read_installed_shared_components(path_manager).await?;
    let mut seeded = Vec::new();
    for app_dir in installed_app_dirs {
        match refresh_installed_app_lock(&app_dir, &shared_components).await {
            Ok(app_id) => seeded.push(app_id),
            Err(error) => log::warn!(
                "refresh builtin product app package lock '{}' failed: {}",
                app_dir.display(),
                error
            ),
        }
    }

    Ok(seeded)
}

pub async fn list_installed_product_app_catalog(
    path_manager: &PathManager,
) -> BitFunResult<Vec<AppCatalogEntry>> {
    Ok(list_installed_product_app_catalog_with_issues(path_manager)
        .await?
        .entries)
}

pub async fn list_installed_product_app_catalog_with_issues(
    path_manager: &PathManager,
) -> BitFunResult<ProductAppCatalogEntries> {
    let _guard = BUILTIN_PACKAGE_CATALOG_LOCK.lock().await;
    ensure_builtin_product_app_packages_seeded_unlocked(path_manager).await?;
    let batch = list_installed_product_apps_unlocked_with_issues(path_manager).await?;
    let mut entries = batch
        .apps
        .into_iter()
        .chain(batch.degraded_apps.into_iter())
        .map(|app| app.catalog_entry)
        .collect::<Vec<_>>();
    sort_app_catalog_entries_by_name(&mut entries);
    Ok(ProductAppCatalogEntries {
        entries,
        issues: batch.issues,
    })
}

pub async fn list_product_app_catalog_source(
    path_manager: &PathManager,
) -> BitFunResult<Vec<AppCatalogEntry>> {
    Ok(list_product_app_catalog_source_with_issues(path_manager)
        .await?
        .entries)
}

pub async fn list_product_app_catalog_source_with_issues(
    path_manager: &PathManager,
) -> BitFunResult<ProductAppCatalogEntries> {
    let _guard = BUILTIN_PACKAGE_CATALOG_LOCK.lock().await;
    ensure_builtin_product_app_packages_seeded_unlocked(path_manager).await?;
    ensure_product_app_catalog_sources_seeded_unlocked(path_manager).await?;
    let batch = list_product_app_source_projections_unlocked_with_issues(path_manager).await?;
    let mut projected_apps = batch.apps;
    projected_apps.extend(batch.degraded_apps);
    let source_apps = apply_product_app_catalog_source_state(path_manager, projected_apps).await?;
    Ok(ProductAppCatalogEntries {
        entries: annotate_product_app_source_updates(path_manager, source_apps)
            .await?
            .into_iter()
            .map(|app| app.catalog_entry)
            .collect(),
        issues: batch.issues,
    })
}

pub async fn list_installed_product_apps(
    path_manager: &PathManager,
) -> BitFunResult<Vec<ResolvedProductApp>> {
    let _guard = BUILTIN_PACKAGE_CATALOG_LOCK.lock().await;
    ensure_builtin_product_app_packages_seeded_unlocked(path_manager).await?;
    list_installed_product_apps_unlocked(path_manager).await
}

pub async fn install_product_app(
    path_manager: &PathManager,
    app_id: &str,
    app_version: &str,
) -> BitFunResult<()> {
    reject_native_system_lifecycle_target(app_id)?;
    let _guard = BUILTIN_PACKAGE_CATALOG_LOCK.lock().await;
    ensure_builtin_product_app_packages_seeded_unlocked(path_manager).await?;
    ensure_product_app_catalog_sources_seeded_unlocked(path_manager).await?;
    let source_dir = product_app_sources_dir(path_manager)
        .join(app_id)
        .join(app_version);
    if !source_dir.join(APP_JSON).is_file() {
        return Err(BitFunError::NotFound(format!(
            "Product App source not found: {}@{}",
            app_id, app_version
        )));
    }
    let release_source = read_release_source_manifest(&source_dir).await?;
    if let Some(source_manifest) = &release_source {
        if source_manifest.app_id != app_id || source_manifest.app_version != app_version {
            return Err(BitFunError::validation(format!(
                "Published release source identity does not match requested install. request={}@{}, source={}@{}",
                app_id, app_version, source_manifest.app_id, source_manifest.app_version
            )));
        }
    }
    let dest_dir = path_manager.system_product_app_version_dir(app_id, app_version);
    reset_dir(&dest_dir, &path_manager.system_product_apps_dir())?;
    let installed_from = if release_source.is_some() {
        ProductAppCatalogSourceKind::PublishedRelease
    } else {
        ProductAppCatalogSourceKind::BuiltinMarketplace
    };
    let copy_mode = if release_source.is_some() {
        CopyMode::PublishedProductAppRelease
    } else {
        CopyMode::ProductAppPackage
    };
    copy_filesystem_dir(&source_dir, &dest_dir, copy_mode)?;
    let shared_components = read_installed_shared_components(path_manager).await?;
    if let Some(source_manifest) = release_source {
        if let Err(error) =
            verify_installed_release_package(&dest_dir, &shared_components, &source_manifest).await
        {
            let _ = remove_package_dir(&dest_dir, &path_manager.system_product_apps_dir());
            return Err(error);
        }
    } else {
        refresh_installed_app_lock(&dest_dir, &shared_components).await?;
    }
    mark_product_app_installed(path_manager, app_id, app_version, Some(installed_from)).await
}

pub async fn publish_product_app_release_to_catalog(
    path_manager: &PathManager,
    request: PublishProductAppReleaseToCatalogRequest,
) -> BitFunResult<PublishedProductAppReleaseCatalogSource> {
    let manifest = read_release_manifest(&request.release_manifest_path).await?;
    validate_publishable_release_manifest(&manifest)?;
    let release_dir = request.release_manifest_path.parent().ok_or_else(|| {
        BitFunError::validation(format!(
            "Release manifest path has no parent: {}",
            request.release_manifest_path.display()
        ))
    })?;
    let release_files_dir = release_dir.join(&manifest.content_root);
    if !release_files_dir.is_dir() {
        return Err(BitFunError::validation(format!(
            "Release source snapshot is missing: {}",
            release_files_dir.display()
        )));
    }
    verify_release_snapshot_contents(&release_files_dir, &manifest)?;

    let source_root = product_app_sources_dir(path_manager);
    path_manager.ensure_dir(&source_root).await?;
    let dest_dir = package_version_dir(&source_root, &manifest.app_id, &manifest.app_version);
    reset_dir(&dest_dir, &source_root)?;
    copy_filesystem_dir(
        &release_files_dir,
        &dest_dir,
        CopyMode::PublishedProductAppRelease,
    )?;

    let source_manifest = ProductAppReleaseCatalogSourceManifest {
        schema_version: PRODUCT_APP_RELEASE_CATALOG_SOURCE_SCHEMA_VERSION,
        release_id: manifest.release_id.clone(),
        artifact_uri: manifest_artifact_uri(&manifest),
        app_id: manifest.app_id.clone(),
        app_version: manifest.app_version.clone(),
        component_lock_digest: manifest.component_lock_digest.clone(),
        package_digest: manifest.package_digest.clone(),
        published_at_ms: request.published_at_ms,
        published_by: request.published_by,
        release_label: manifest.label.clone(),
        release_notes: manifest.notes.clone(),
    };
    verify_release_source_package(&dest_dir, &source_manifest).await?;
    write_bytes(
        dest_dir.join(PRODUCT_APP_RELEASE_CATALOG_SOURCE_FILE),
        &serde_json::to_vec_pretty(&source_manifest)?,
    )?;

    Ok(PublishedProductAppReleaseCatalogSource {
        app_id: manifest.app_id,
        version: manifest.app_version,
        release_id: manifest.release_id,
        release_label: source_manifest.release_label,
        release_notes: source_manifest.release_notes,
        artifact_uri: source_manifest.artifact_uri,
        source_dir: dest_dir,
        component_lock_digest: source_manifest.component_lock_digest,
        package_digest: source_manifest.package_digest,
        published_at_ms: source_manifest.published_at_ms,
        work_id: manifest.readiness.work_id,
    })
}

pub async fn uninstall_product_app(
    path_manager: &PathManager,
    app_id: &str,
    app_version: &str,
) -> BitFunResult<()> {
    reject_native_system_lifecycle_target(app_id)?;
    let _guard = BUILTIN_PACKAGE_CATALOG_LOCK.lock().await;
    let dest_dir = path_manager.system_product_app_version_dir(app_id, app_version);
    if !dest_dir.join(APP_JSON).is_file() {
        ensure_product_app_catalog_sources_seeded_unlocked(path_manager).await?;
        return Err(BitFunError::validation(format!(
            "Product App is not installed: {}@{}",
            app_id, app_version
        )));
    }
    if installed_product_app_source_kind(path_manager, app_id, app_version, &dest_dir).await?
        == Some(ProductAppCatalogSourceKind::BuiltinMarketplace)
    {
        return Err(BitFunError::validation(format!(
            "Built-in Product Apps can be disabled but not uninstalled: {}@{}",
            app_id, app_version
        )));
    }
    mark_product_app_uninstalled(path_manager, app_id, app_version).await?;
    remove_package_dir(&dest_dir, &path_manager.system_product_apps_dir())?;
    Ok(())
}

async fn list_installed_product_apps_unlocked(
    path_manager: &PathManager,
) -> BitFunResult<Vec<ResolvedProductApp>> {
    Ok(
        list_installed_product_apps_unlocked_with_issues(path_manager)
            .await?
            .apps,
    )
}

async fn list_installed_product_apps_unlocked_with_issues(
    path_manager: &PathManager,
) -> BitFunResult<ProductAppProjectionBatch> {
    let mut batch = list_product_app_package_projections_unlocked(path_manager).await?;
    batch.apps = apply_product_app_catalog_state(path_manager, batch.apps).await?;
    apply_degraded_installed_package_state(&mut batch.degraded_apps);

    batch.apps.sort_by(|left, right| {
        left.app
            .name
            .to_lowercase()
            .cmp(&right.app.name.to_lowercase())
            .then_with(|| left.app.id.cmp(&right.app.id))
    });
    batch.degraded_apps.sort_by(|left, right| {
        left.app
            .name
            .to_lowercase()
            .cmp(&right.app.name.to_lowercase())
            .then_with(|| left.app.id.cmp(&right.app.id))
    });
    Ok(batch)
}

fn apply_degraded_installed_package_state(apps: &mut [ResolvedProductApp]) {
    for app in apps {
        app.app.enabled = false;
        app.catalog_entry.app.enabled = false;
        app.catalog_entry.installed = true;
        app.catalog_entry.discoverable = false;
        app.catalog_entry.library_sources = vec![ProductAppLibrarySource::Installed];
        app.catalog_entry.catalog_source = Some(ProductAppCatalogSourceRef {
            kind: ProductAppCatalogSourceKind::InstalledPackage,
            label: "Installed package".to_string(),
            package_uri: Some(format!("product-app://{}@{}", app.app.id, app.app.version)),
        });
        app.catalog_entry.management = ProductAppManagementPolicy {
            origin: ProductAppManagementOrigin::InstalledPackage,
            actions: vec![AppManagementAction::Uninstall],
            uninstall: Some(ProductAppUninstallPolicy {
                removes_installed_package: true,
                retains_work: true,
                retains_runtime_storage: true,
            }),
        };
    }
}

async fn list_product_app_package_projections_unlocked(
    path_manager: &PathManager,
) -> BitFunResult<ProductAppProjectionBatch> {
    let shared_components = read_installed_shared_components(path_manager).await?;
    let mut batch = ProductAppProjectionBatch::default();

    for app_dir in collect_installed_product_app_dirs(&path_manager.system_product_apps_dir())? {
        match read_installed_product_app_projection(&app_dir, &shared_components).await {
            Ok(Some(mut resolved)) => {
                if let Err(error) = annotate_package_revision(&app_dir, &mut resolved).await {
                    let issue = record_product_app_catalog_issue(
                        &mut batch.issues,
                        ProductAppCatalogIssueSource::InstalledPackage,
                        &app_dir,
                        &error,
                    );
                    resolved.catalog_entry.catalog_issues.push(issue);
                }
                batch.apps.push(resolved);
            }
            Ok(None) => {}
            Err(error) => {
                let issue = record_product_app_catalog_issue(
                    &mut batch.issues,
                    ProductAppCatalogIssueSource::InstalledPackage,
                    &app_dir,
                    &error,
                );
                if let Some(degraded) = read_degraded_product_app_projection(&app_dir, issue).await
                {
                    batch.degraded_apps.push(degraded);
                }
            }
        }
    }

    batch.apps.sort_by(|left, right| {
        left.app
            .name
            .to_lowercase()
            .cmp(&right.app.name.to_lowercase())
            .then_with(|| left.app.id.cmp(&right.app.id))
    });
    Ok(batch)
}

fn sort_app_catalog_entries_by_name(entries: &mut [AppCatalogEntry]) {
    entries.sort_by(|left, right| {
        left.app
            .name
            .to_lowercase()
            .cmp(&right.app.name.to_lowercase())
            .then_with(|| left.app.id.cmp(&right.app.id))
    });
}

async fn read_installed_product_app_projection(
    app_dir: &Path,
    shared_components: &[ComponentDefinition],
) -> BitFunResult<Option<ResolvedProductApp>> {
    let mut package = ProductAppResolver::read_product_app_package(app_dir).await?;
    if is_native_system_lifecycle_id(&package.app.id) {
        log::debug!(
            "skip retired native Product App package '{}' in installed catalog",
            package.app.id
        );
        return Ok(None);
    }
    if normalize_legacy_generated_work_multiplicity(app_dir, &mut package.app).await? {
        log::info!(
            "normalized legacy generated Product App work multiplicity: app_id={}, app_version={}, app_dir={}",
            package.app.id,
            package.app.version,
            app_dir.display()
        );
    }

    let app_id = package.app.id.clone();
    let app_version = package.app.version.clone();
    match build_installed_product_app_projection(app_dir, package, shared_components).await {
        Ok(resolved) => Ok(Some(resolved)),
        Err(error) if is_refreshable_installed_app_lock_error(&error) => {
            log::warn!(
                "refresh stale installed Product App lock: app_id={}, app_version={}, app_dir={}, error={}",
                app_id,
                app_version,
                app_dir.display(),
                error
            );
            refresh_installed_app_lock(app_dir, shared_components).await?;
            let package = ProductAppResolver::read_product_app_package(app_dir).await?;
            build_installed_product_app_projection(app_dir, package, shared_components)
                .await
                .map(Some)
        }
        Err(error) => Err(error),
    }
}

async fn normalize_legacy_generated_work_multiplicity(
    app_dir: &Path,
    app: &mut AppDefinition,
) -> BitFunResult<bool> {
    if !is_legacy_generated_full_surface_multiple_app(app) {
        return Ok(false);
    }
    app.work_multiplicity = AppWorkMultiplicity::Singleton;
    write_app_work_multiplicity(app_dir, AppWorkMultiplicity::Singleton).await?;
    Ok(true)
}

fn is_legacy_generated_full_surface_multiple_app(app: &AppDefinition) -> bool {
    matches!(
        app.primary_surface_mode,
        Some(AppSurfaceMode::ImmersivePrimary) | Some(AppSurfaceMode::EmbeddedObject)
    ) && app.work_multiplicity == AppWorkMultiplicity::Multiple
        && app.work_object_kinds.len() == 1
        && app.work_object_kinds.first().is_some_and(|work_object| {
            work_object.id == "primary-work"
                && work_object.label == "Primary Work"
                && work_object.scope == WorkObjectScope::Global
        })
}

async fn build_installed_product_app_projection(
    app_dir: &Path,
    package: ProductAppPackage,
    shared_components: &[ComponentDefinition],
) -> BitFunResult<ResolvedProductApp> {
    let lock = ProductAppResolver::read_lock(app_dir).await?;
    let components = components_for_lock(&package.private_components, shared_components, &lock)?;
    let mut resolved = ProductAppResolver::build_runtime_projection(
        package.app,
        components,
        lock,
        package.component_implementation_digests,
        package.private_surface_sources,
    )?;
    ProductAppResolver::hydrate_package_icon(&mut resolved, app_dir)?;
    Ok(resolved)
}

async fn read_degraded_product_app_projection(
    app_dir: &Path,
    issue: ProductAppCatalogIssue,
) -> Option<ResolvedProductApp> {
    let app = match read_product_app_definition_for_catalog_issue(app_dir).await {
        Ok(app) => app,
        Err(error) => {
            log::warn!(
                "unable to project invalid Product App package for management: package_dir={}, error={}",
                app_dir.display(),
                error
            );
            return None;
        }
    };
    if is_native_system_lifecycle_id(&app.id) {
        log::debug!(
            "skip retired native Product App package '{}' while projecting degraded catalog entry",
            app.id
        );
        return None;
    }

    let lock = ProductAppResolver::read_lock(app_dir)
        .await
        .unwrap_or_else(|_| degraded_component_lock(&app));
    let catalog_entry = degraded_product_app_catalog_entry(app.clone(), &lock, issue);
    let mut resolved = ResolvedProductApp {
        app,
        components: Vec::new(),
        lock,
        catalog_entry,
        private_surface_sources: BTreeMap::new(),
    };
    if let Err(error) = ProductAppResolver::hydrate_package_icon(&mut resolved, app_dir) {
        log::warn!(
            "failed to hydrate degraded Product App package icon: app_id={}, app_version={}, package_dir={}, error={}",
            resolved.app.id,
            resolved.app.version,
            app_dir.display(),
            error
        );
    }
    Some(resolved)
}

async fn read_product_app_definition_for_catalog_issue(
    app_dir: &Path,
) -> BitFunResult<AppDefinition> {
    let app_path = app_dir.join(APP_JSON);
    let bytes = tokio::fs::read(&app_path).await.map_err(|error| {
        BitFunError::io(format!("Failed to read {}: {}", app_path.display(), error))
    })?;
    serde_json::from_slice(&bytes).map_err(BitFunError::from)
}

fn degraded_component_lock(app: &AppDefinition) -> ComponentLock {
    ComponentLock {
        app_id: app.id.clone(),
        version: app.version.clone(),
        lock_version: 1,
        resolved_components: Vec::new(),
        permission_digest: "unresolved".to_string(),
        component_graph_digest: "unresolved".to_string(),
    }
}

fn degraded_product_app_catalog_entry(
    app: AppDefinition,
    lock: &ComponentLock,
    issue: ProductAppCatalogIssue,
) -> ProductAppCatalogEntry {
    let component_lock_digest = if app.component_lock_id.trim().is_empty() {
        lock.digest()
    } else {
        app.component_lock_id.clone()
    };
    ProductAppCatalogEntry {
        app,
        component_lock_digest,
        package_digest: None,
        update_available: false,
        installed_component_lock_digest: None,
        available_component_lock_digest: None,
        installed_package_digest: None,
        available_package_digest: None,
        catalog_release_id: None,
        catalog_release_label: None,
        catalog_release_notes: None,
        catalog_published_at_ms: None,
        dependency_summary: format!("Package issue: {}", issue.message),
        installed: false,
        discoverable: false,
        library_sources: Vec::new(),
        catalog_source: None,
        catalog_issues: vec![issue],
        management: Default::default(),
        rehearsal_plan: None,
        eval_plan: None,
    }
}

fn is_refreshable_installed_app_lock_error(error: &BitFunError) -> bool {
    let BitFunError::Validation(message) = error else {
        return false;
    };
    message == "App lock permission digest does not match component definitions"
        || message == "App lock component graph digest does not match component definitions"
        || message == "App lock resolved component count does not match component definitions"
        || message.starts_with("App lock is missing resolved component ")
        || message.starts_with("App lock digest mismatch for ")
        || message.starts_with("App lock implementation digest mismatch for ")
        || message.starts_with("Installed app lock references missing component ")
}

async fn list_product_app_source_projections_unlocked_with_issues(
    path_manager: &PathManager,
) -> BitFunResult<ProductAppProjectionBatch> {
    let shared_components = read_installed_shared_components(path_manager).await?;
    let mut batch = ProductAppProjectionBatch::default();

    for app_dir in collect_installed_product_app_dirs(&product_app_sources_dir(path_manager))? {
        match read_product_app_source_projection(&app_dir, &shared_components).await {
            Ok(Some(resolved)) => batch.apps.push(resolved),
            Ok(None) => {}
            Err(error) => {
                let issue = record_product_app_catalog_issue(
                    &mut batch.issues,
                    ProductAppCatalogIssueSource::CatalogSource,
                    &app_dir,
                    &error,
                );
                if let Some(degraded) = read_degraded_product_app_projection(&app_dir, issue).await
                {
                    batch.degraded_apps.push(degraded);
                }
            }
        }
    }

    batch.apps.sort_by(|left, right| {
        left.app
            .name
            .to_lowercase()
            .cmp(&right.app.name.to_lowercase())
            .then_with(|| left.app.id.cmp(&right.app.id))
    });
    batch.degraded_apps.sort_by(|left, right| {
        left.app
            .name
            .to_lowercase()
            .cmp(&right.app.name.to_lowercase())
            .then_with(|| left.app.id.cmp(&right.app.id))
    });
    Ok(batch)
}

async fn read_product_app_source_projection(
    app_dir: &Path,
    shared_components: &[ComponentDefinition],
) -> BitFunResult<Option<ResolvedProductApp>> {
    let package = ProductAppResolver::read_product_app_package(app_dir).await?;
    if is_native_system_lifecycle_id(&package.app.id) {
        log::debug!(
            "skip retired native Product App package '{}' in source catalog",
            package.app.id
        );
        return Ok(None);
    }
    let mut resolved = resolve_catalog_source_package(app_dir, package, shared_components).await?;
    annotate_package_revision(app_dir, &mut resolved).await?;
    Ok(Some(resolved))
}

async fn annotate_package_revision(
    app_dir: &Path,
    app: &mut ResolvedProductApp,
) -> BitFunResult<String> {
    if let Some(source_manifest) = read_release_source_manifest(app_dir).await? {
        app.catalog_entry.package_digest = Some(source_manifest.package_digest.clone());
        app.catalog_entry.catalog_source = Some(ProductAppCatalogSourceRef {
            kind: ProductAppCatalogSourceKind::PublishedRelease,
            label: "Published release".to_string(),
            package_uri: Some(source_manifest.artifact_uri.clone()),
        });
        apply_release_source_metadata(&source_manifest, &mut app.catalog_entry);
        return Ok(source_manifest.package_digest);
    }

    let package_digest = current_product_app_package_digest(app_dir).await?;
    app.catalog_entry.package_digest = Some(package_digest.clone());
    Ok(package_digest)
}

async fn installed_product_app_source_kind(
    path_manager: &PathManager,
    app_id: &str,
    app_version: &str,
    app_dir: &Path,
) -> BitFunResult<Option<ProductAppCatalogSourceKind>> {
    if let Some(source_kind) =
        product_app_installed_source_kind(path_manager, app_id, app_version).await?
    {
        return Ok(Some(source_kind));
    }
    if read_release_source_manifest(app_dir).await?.is_some() {
        return Ok(Some(ProductAppCatalogSourceKind::PublishedRelease));
    }
    let package = ProductAppResolver::read_product_app_package(app_dir).await?;
    if package.app.catalog_visibility == AppCatalogVisibility::Discoverable {
        return Ok(Some(ProductAppCatalogSourceKind::BuiltinMarketplace));
    }
    Ok(None)
}

async fn annotate_product_app_source_updates(
    path_manager: &PathManager,
    mut source_apps: Vec<ResolvedProductApp>,
) -> BitFunResult<Vec<ResolvedProductApp>> {
    let installed_apps = list_installed_product_apps_unlocked(path_manager).await?;
    let installed_by_key = installed_apps
        .into_iter()
        .map(|app| (package_key(&app.app.id, &app.app.version), app))
        .collect::<BTreeMap<_, _>>();

    for source in &mut source_apps {
        let key = package_key(&source.app.id, &source.app.version);
        let Some(installed) = installed_by_key.get(&key) else {
            continue;
        };
        let installed_lock = installed.lock.digest();
        let available_lock = source.lock.digest();
        let installed_package = installed.catalog_entry.package_digest.clone();
        let available_package = source.catalog_entry.package_digest.clone();
        source.catalog_entry.installed_component_lock_digest = Some(installed_lock.clone());
        source.catalog_entry.available_component_lock_digest = Some(available_lock.clone());
        source.catalog_entry.installed_package_digest = installed_package.clone();
        source.catalog_entry.available_package_digest = available_package.clone();
        let compare_package_digest = source
            .catalog_entry
            .catalog_source
            .as_ref()
            .is_some_and(|source| source.kind == ProductAppCatalogSourceKind::PublishedRelease);
        source.catalog_entry.update_available = installed_lock != available_lock
            || (compare_package_digest && installed_package != available_package);
        if source.catalog_entry.update_available {
            source.catalog_entry.discoverable = false;
        }
    }

    Ok(source_apps)
}

async fn resolve_catalog_source_package(
    app_dir: &Path,
    package: ProductAppPackage,
    shared_components: &[ComponentDefinition],
) -> BitFunResult<ResolvedProductApp> {
    let mut resolved =
        ProductAppResolver::resolve_package_install(package, shared_components.to_vec())?;
    if let Some(source_manifest) = read_release_source_manifest(app_dir).await? {
        verify_resolved_release_source(&resolved, &source_manifest)?;
        resolved.app.catalog_visibility = AppCatalogVisibility::Discoverable;
        resolved.catalog_entry.app.catalog_visibility = AppCatalogVisibility::Discoverable;
        resolved.catalog_entry.catalog_source = Some(ProductAppCatalogSourceRef {
            kind: ProductAppCatalogSourceKind::PublishedRelease,
            label: "Published release".to_string(),
            package_uri: Some(source_manifest.artifact_uri.clone()),
        });
        resolved.catalog_entry.package_digest = Some(source_manifest.package_digest.clone());
        apply_release_source_metadata(&source_manifest, &mut resolved.catalog_entry);
    }
    Ok(resolved)
}

fn apply_release_source_metadata(
    source: &ProductAppReleaseCatalogSourceManifest,
    entry: &mut AppCatalogEntry,
) {
    entry.catalog_release_id = Some(source.release_id.clone());
    entry.catalog_release_label = source.release_label.clone();
    entry.catalog_release_notes = source.release_notes.clone();
    entry.catalog_published_at_ms = Some(source.published_at_ms);
}

pub async fn get_installed_product_app_by_lock(
    path_manager: &PathManager,
    app_id: &str,
    app_version: &str,
    component_lock_digest: &str,
) -> BitFunResult<(ResolvedProductApp, String)> {
    let apps = list_installed_product_apps(path_manager).await?;
    select_installed_product_app_by_lock(apps, app_id, app_version, component_lock_digest)
}

pub fn select_installed_product_app_by_lock(
    apps: Vec<ResolvedProductApp>,
    app_id: &str,
    app_version: &str,
    component_lock_digest: &str,
) -> BitFunResult<(ResolvedProductApp, String)> {
    let mut available = Vec::new();
    for app in apps {
        if app.app.id != app_id {
            continue;
        }
        let lock_digest = app.lock.digest();
        if app.app.version == app_version && lock_digest == component_lock_digest {
            return Ok((app, lock_digest));
        }
        available.push(format!("{} ({})", app.app.version, lock_digest));
    }

    if available.is_empty() {
        return Err(BitFunError::validation(format!(
            "Product App not found: {}",
            app_id
        )));
    }

    Err(BitFunError::validation(format!(
        "Product App {} package for version {} and lock {} is not installed. Available: {}",
        app_id,
        app_version,
        component_lock_digest,
        available.join(", ")
    )))
}

pub async fn list_installed_shared_components(
    path_manager: &PathManager,
) -> BitFunResult<Vec<ComponentDefinition>> {
    list_installed_components_projection(path_manager, InstalledComponentProjection::SharedOnly)
        .await
}

pub async fn list_installed_package_components(
    path_manager: &PathManager,
) -> BitFunResult<Vec<ComponentDefinition>> {
    list_installed_components_projection(path_manager, InstalledComponentProjection::PackageCatalog)
        .await
}

enum InstalledComponentProjection {
    SharedOnly,
    PackageCatalog,
}

async fn list_installed_components_projection(
    path_manager: &PathManager,
    projection: InstalledComponentProjection,
) -> BitFunResult<Vec<ComponentDefinition>> {
    let _guard = BUILTIN_PACKAGE_CATALOG_LOCK.lock().await;
    ensure_builtin_product_app_packages_seeded_unlocked(path_manager).await?;
    let mut components = read_installed_shared_components(path_manager).await?;
    if matches!(projection, InstalledComponentProjection::PackageCatalog) {
        for app in list_installed_product_apps_unlocked(path_manager).await? {
            components.extend(app.components);
        }
    }
    Ok(dedupe_components(components))
}

async fn seed_component_package(
    path_manager: &PathManager,
    source_dir: &Path,
) -> BitFunResult<PathBuf> {
    let component = read_source_component_definition(source_dir)?;
    let version = component.version.as_deref().ok_or_else(|| {
        BitFunError::validation(format!(
            "builtin shared component {} must declare version",
            component.id
        ))
    })?;
    let dest_dir = path_manager.system_component_version_dir(
        component.kind.path_segment(),
        &component.id,
        version,
    );
    reset_dir(&dest_dir, &path_manager.system_components_dir())?;
    copy_source_dir(source_dir, &dest_dir, CopyMode::ComponentPackage)?;
    ProductAppResolver::read_component_package(&dest_dir).await?;
    Ok(dest_dir)
}

async fn seed_product_app_catalog_sources_unlocked(
    path_manager: &PathManager,
) -> BitFunResult<Vec<PathBuf>> {
    let source_root = product_app_sources_dir(path_manager);
    path_manager.ensure_dir(&source_root).await?;

    let mut seeded = Vec::new();
    for app_source in collect_product_app_package_sources() {
        match seed_product_app_source(path_manager, &app_source).await {
            Ok(app_dir) => seeded.push(app_dir),
            Err(error) => log::warn!(
                "seed builtin product app source '{}' failed: {}",
                app_source.display(),
                error
            ),
        }
    }
    Ok(seeded)
}

async fn seed_product_app_source(
    path_manager: &PathManager,
    source_dir: &Path,
) -> BitFunResult<PathBuf> {
    let app = read_source_app_definition(source_dir)?;
    let source_root = product_app_sources_dir(path_manager);
    let dest_dir = package_version_dir(&source_root, &app.id, &app.version);
    reset_dir(&dest_dir, &source_root)?;
    copy_source_dir(source_dir, &dest_dir, CopyMode::ProductAppPackage)?;
    Ok(dest_dir)
}

async fn refresh_installed_app_lock(
    app_dir: &Path,
    shared_components: &[ComponentDefinition],
) -> BitFunResult<String> {
    let package = ProductAppResolver::read_product_app_package(app_dir).await?;
    let resolved =
        ProductAppResolver::resolve_package_install(package, shared_components.to_vec())?;
    write_app_component_lock_id(app_dir, &resolved.app.component_lock_id).await?;
    ProductAppResolver::write_lock(app_dir, &resolved.lock).await?;
    Ok(resolved.app.id)
}

async fn write_app_component_lock_id(app_dir: &Path, lock_id: &str) -> BitFunResult<()> {
    let app_path = app_dir.join(APP_JSON);
    let bytes = tokio::fs::read(&app_path).await.map_err(|error| {
        BitFunError::io(format!("Failed to read {}: {}", app_path.display(), error))
    })?;
    let mut value: Value = serde_json::from_slice(&bytes).map_err(BitFunError::from)?;
    value["componentLockId"] = Value::String(lock_id.to_string());
    let bytes = serde_json::to_vec_pretty(&value).map_err(BitFunError::from)?;
    tokio::fs::write(&app_path, bytes).await.map_err(|error| {
        BitFunError::io(format!("Failed to write {}: {}", app_path.display(), error))
    })
}

async fn write_app_work_multiplicity(
    app_dir: &Path,
    work_multiplicity: AppWorkMultiplicity,
) -> BitFunResult<()> {
    let app_path = app_dir.join(APP_JSON);
    let bytes = tokio::fs::read(&app_path).await.map_err(|error| {
        BitFunError::io(format!("Failed to read {}: {}", app_path.display(), error))
    })?;
    let mut value: Value = serde_json::from_slice(&bytes).map_err(BitFunError::from)?;
    value["workMultiplicity"] =
        serde_json::to_value(work_multiplicity).map_err(BitFunError::from)?;
    let bytes = serde_json::to_vec_pretty(&value).map_err(BitFunError::from)?;
    tokio::fs::write(&app_path, bytes).await.map_err(|error| {
        BitFunError::io(format!("Failed to write {}: {}", app_path.display(), error))
    })
}

async fn read_release_manifest(path: &Path) -> BitFunResult<ProductAppReleaseManifest> {
    let bytes = tokio::fs::read(path).await.map_err(|error| {
        BitFunError::io(format!(
            "Failed to read release manifest {}: {}",
            path.display(),
            error
        ))
    })?;
    serde_json::from_slice(&bytes).map_err(BitFunError::from)
}

async fn read_release_source_manifest(
    app_dir: &Path,
) -> BitFunResult<Option<ProductAppReleaseCatalogSourceManifest>> {
    let path = app_dir.join(PRODUCT_APP_RELEASE_CATALOG_SOURCE_FILE);
    match tokio::fs::read(&path).await {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(BitFunError::from),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(BitFunError::io(format!(
            "Failed to read release catalog source {}: {}",
            path.display(),
            error
        ))),
    }
}

fn validate_publishable_release_manifest(manifest: &ProductAppReleaseManifest) -> BitFunResult<()> {
    if manifest.schema_version != PRODUCT_APP_RELEASE_SCHEMA_VERSION {
        return Err(BitFunError::validation(format!(
            "Unsupported Product App release manifest schema: {}",
            manifest.schema_version
        )));
    }
    if manifest.readiness.status != "passed" {
        return Err(BitFunError::validation(format!(
            "Product App release cannot be published because readiness is {}",
            manifest.readiness.status
        )));
    }
    if manifest
        .readiness
        .checks
        .iter()
        .any(|check| check.status != "passed")
    {
        return Err(BitFunError::validation(
            "Product App release cannot be published until every readiness check has passed",
        ));
    }
    if !manifest.share.includes_package_source
        || !manifest.share.includes_default_configuration
        || !manifest.share.excludes_work_history
        || !manifest.share.excludes_runtime_storage
        || !manifest.share.excludes_user_private_data
    {
        return Err(BitFunError::validation(
            "Product App release cannot be published because its share boundary is incomplete",
        ));
    }
    Ok(())
}

fn verify_release_snapshot_contents(
    release_files_dir: &Path,
    manifest: &ProductAppReleaseManifest,
) -> BitFunResult<()> {
    let mut expected_paths = BTreeSet::new();
    let absolute_root = absolute_path(release_files_dir)?;
    for file in &manifest.package_files {
        expected_paths.insert(file.path.clone());
        let path = release_files_dir.join(&file.path);
        let absolute_path = absolute_path(&path)?;
        if !absolute_path.starts_with(&absolute_root) {
            return Err(BitFunError::validation(format!(
                "Release manifest references a file outside the release source snapshot: {}",
                file.path
            )));
        }
        let bytes = std::fs::read(&absolute_path).map_err(|error| {
            BitFunError::io(format!(
                "Failed to read release source file {}: {}",
                absolute_path.display(),
                error
            ))
        })?;
        if bytes.len() as u64 != file.bytes {
            return Err(BitFunError::validation(format!(
                "Release source file size mismatch for {}. manifest={}, actual={}",
                file.path,
                file.bytes,
                bytes.len()
            )));
        }
        let digest = sha256_bytes(&bytes);
        if digest != file.sha256 {
            return Err(BitFunError::validation(format!(
                "Release source file hash mismatch for {}. manifest={}, actual={}",
                file.path, file.sha256, digest
            )));
        }
    }

    let actual_paths = collect_files_from_filesystem(release_files_dir)?
        .into_iter()
        .map(|path| {
            path.strip_prefix(release_files_dir)
                .map(|relative| relative.to_string_lossy().replace('\\', "/"))
                .map_err(|_| {
                    BitFunError::validation(format!(
                        "unexpected release source path: {}",
                        path.display()
                    ))
                })
        })
        .collect::<BitFunResult<BTreeSet<_>>>()?;
    if actual_paths != expected_paths {
        return Err(BitFunError::validation(
            "Release source snapshot file set does not match release manifest",
        ));
    }
    Ok(())
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{:x}", hasher.finalize())
}

fn manifest_artifact_uri(manifest: &ProductAppReleaseManifest) -> String {
    format!(
        "product-app://{}@{}/releases/{}",
        manifest.app_id, manifest.app_version, manifest.release_id
    )
}

async fn verify_release_source_package(
    app_dir: &Path,
    source: &ProductAppReleaseCatalogSourceManifest,
) -> BitFunResult<()> {
    let package = ProductAppResolver::read_product_app_package(app_dir).await?;
    let lock = ProductAppResolver::read_lock(app_dir).await?;
    if package.app.id != source.app_id || package.app.version != source.app_version {
        return Err(BitFunError::validation(format!(
            "Release source package identity does not match release manifest. source={}@{}, package={}@{}",
            source.app_id, source.app_version, package.app.id, package.app.version
        )));
    }
    if package.app.component_lock_id != source.component_lock_digest {
        return Err(BitFunError::validation(format!(
            "Release source app.json lock does not match release manifest. app={}, release={}",
            package.app.component_lock_id, source.component_lock_digest
        )));
    }
    if lock.digest() != source.component_lock_digest {
        return Err(BitFunError::validation(format!(
            "Release source app.lock.json does not match release manifest. lock={}, release={}",
            lock.digest(),
            source.component_lock_digest
        )));
    }
    Ok(())
}

async fn verify_installed_release_package(
    app_dir: &Path,
    shared_components: &[ComponentDefinition],
    source: &ProductAppReleaseCatalogSourceManifest,
) -> BitFunResult<()> {
    verify_release_source_package(app_dir, source).await?;
    let package = ProductAppResolver::read_product_app_package(app_dir).await?;
    let resolved =
        ProductAppResolver::resolve_package_install(package, shared_components.to_vec())?;
    verify_resolved_release_source(&resolved, source)
}

fn verify_resolved_release_source(
    resolved: &ResolvedProductApp,
    source: &ProductAppReleaseCatalogSourceManifest,
) -> BitFunResult<()> {
    if resolved.app.id != source.app_id || resolved.app.version != source.app_version {
        return Err(BitFunError::validation(format!(
            "Resolved release source identity does not match release manifest. source={}@{}, resolved={}@{}",
            source.app_id, source.app_version, resolved.app.id, resolved.app.version
        )));
    }
    let resolved_lock = resolved.lock.digest();
    if resolved_lock != source.component_lock_digest {
        return Err(BitFunError::validation(format!(
            "Resolved release source lock does not match published release. resolved={}, release={}",
            resolved_lock, source.component_lock_digest
        )));
    }
    Ok(())
}

async fn read_installed_shared_components(
    path_manager: &PathManager,
) -> BitFunResult<Vec<ComponentDefinition>> {
    read_component_packages_from_root(&path_manager.system_components_dir()).await
}

async fn read_component_packages_from_root(root: &Path) -> BitFunResult<Vec<ComponentDefinition>> {
    let mut components = Vec::new();
    for package_dir in collect_component_package_dirs(root)? {
        components.push(
            ProductAppResolver::read_component_package(&package_dir)
                .await?
                .component,
        );
    }
    components.sort_by(|left, right| {
        left.kind
            .path_segment()
            .cmp(right.kind.path_segment())
            .then_with(|| left.id.cmp(&right.id))
            .then_with(|| left.version.cmp(&right.version))
    });
    Ok(components)
}

fn components_for_lock(
    private_components: &[ComponentDefinition],
    shared_components: &[ComponentDefinition],
    lock: &ComponentLock,
) -> BitFunResult<Vec<ComponentDefinition>> {
    let mut by_fqid = BTreeMap::<String, ComponentDefinition>::new();
    for component in private_components.iter().chain(shared_components.iter()) {
        by_fqid.insert(component.fqid(), component.clone());
    }

    let mut components = Vec::new();
    for entry in &lock.resolved_components {
        let Some(component) = by_fqid.get(&entry.fqid) else {
            return Err(BitFunError::validation(format!(
                "Installed app lock references missing component {}",
                entry.fqid
            )));
        };
        components.push(component.clone());
    }
    Ok(components)
}

fn record_product_app_catalog_issue(
    issues: &mut Vec<ProductAppCatalogIssue>,
    source: ProductAppCatalogIssueSource,
    app_dir: &Path,
    error: &BitFunError,
) -> ProductAppCatalogIssue {
    let issue = product_app_catalog_issue(source, app_dir, error);
    log::warn!(
        "skip invalid Product App package: source={:?}, app_id={:?}, app_version={:?}, package_dir={}, error={}",
        issue.source,
        issue.app_id,
        issue.app_version,
        issue.package_dir,
        issue.message
    );
    issues.push(issue.clone());
    issue
}

fn product_app_catalog_issue(
    source: ProductAppCatalogIssueSource,
    app_dir: &Path,
    error: &BitFunError,
) -> ProductAppCatalogIssue {
    let (app_id, app_version) = product_app_identity_from_dir(app_dir);
    ProductAppCatalogIssue {
        source,
        app_id,
        app_version,
        package_dir: app_dir.display().to_string(),
        message: error.to_string(),
    }
}

fn product_app_identity_from_dir(app_dir: &Path) -> (Option<String>, Option<String>) {
    let app_version = app_dir
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty());
    let app_id = app_dir
        .parent()
        .and_then(Path::file_name)
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty());
    (app_id, app_version)
}

#[derive(Debug, Clone, Copy)]
enum CopyMode {
    ProductAppPackage,
    PublishedProductAppRelease,
    ComponentPackage,
}

fn copy_source_dir(source_dir: &Path, dest_dir: &Path, mode: CopyMode) -> BitFunResult<()> {
    let filesystem_dir = filesystem_source_dir(source_dir, mode);
    if filesystem_dir.exists() {
        copy_filesystem_dir(&filesystem_dir, dest_dir, mode)?;
        return Ok(());
    }

    let embedded_dir = embedded_source_dir(source_dir, mode).ok_or_else(|| {
        BitFunError::validation(format!(
            "builtin package source not found: {}",
            source_dir.display()
        ))
    })?;
    copy_embedded_dir(embedded_dir, dest_dir, mode)
}

fn copy_filesystem_dir(source_dir: &Path, dest_dir: &Path, mode: CopyMode) -> BitFunResult<()> {
    for file in collect_files_from_filesystem(source_dir)? {
        let relative = file.strip_prefix(source_dir).map_err(|_| {
            BitFunError::validation(format!(
                "unexpected builtin package path: {}",
                file.display()
            ))
        })?;
        if should_skip_file(relative, mode) {
            continue;
        }
        write_bytes(dest_dir.join(relative), &std::fs::read(&file)?)?;
    }
    Ok(())
}

fn copy_embedded_dir(source_dir: &Dir<'_>, dest_dir: &Path, mode: CopyMode) -> BitFunResult<()> {
    let mut files = Vec::new();
    collect_embedded_files(source_dir, &mut files);
    for file in files {
        let relative = file.path().strip_prefix(source_dir.path()).map_err(|_| {
            BitFunError::validation(format!(
                "unexpected embedded builtin package path: {}",
                file.path().display()
            ))
        })?;
        if should_skip_file(relative, mode) {
            continue;
        }
        write_bytes(dest_dir.join(relative), file.contents())?;
    }
    Ok(())
}

fn should_skip_file(relative: &Path, mode: CopyMode) -> bool {
    matches!(mode, CopyMode::ProductAppPackage)
        && relative.parent().is_none()
        && relative
            .file_name()
            .is_some_and(|name| name == APP_LOCK_JSON)
}

fn reset_dir(path: &Path, root: &Path) -> BitFunResult<()> {
    let absolute_root = absolute_path(root)?;
    let absolute_path = absolute_path(path)?;
    if absolute_path == absolute_root || !absolute_path.starts_with(&absolute_root) {
        return Err(BitFunError::validation(format!(
            "refusing to reset package path outside root: {}",
            absolute_path.display()
        )));
    }
    if absolute_path.exists() {
        std::fs::remove_dir_all(&absolute_path)?;
    }
    std::fs::create_dir_all(&absolute_path)?;
    Ok(())
}

fn remove_package_dir(path: &Path, root: &Path) -> BitFunResult<()> {
    let absolute_root = absolute_path(root)?;
    let absolute_path = absolute_path(path)?;
    if absolute_path == absolute_root || !absolute_path.starts_with(&absolute_root) {
        return Err(BitFunError::validation(format!(
            "refusing to remove package path outside root: {}",
            absolute_path.display()
        )));
    }
    if absolute_path.exists() {
        std::fs::remove_dir_all(&absolute_path)?;
    }
    Ok(())
}

fn product_app_sources_dir(path_manager: &PathManager) -> PathBuf {
    path_manager.user_state_dir().join("product_app_sources")
}

fn package_version_dir(root: &Path, package_id: &str, package_version: &str) -> PathBuf {
    root.join(package_id).join(package_version)
}

fn package_key(app_id: &str, version: &str) -> String {
    format!("{}@{}", app_id, version)
}

fn reject_native_system_lifecycle_target(app_id: &str) -> BitFunResult<()> {
    if is_native_system_lifecycle_id(app_id) {
        return Err(BitFunError::validation(format!(
            "Native system apps are always available and cannot be installed, uninstalled, enabled, or disabled: {}",
            app_id
        )));
    }
    Ok(())
}

fn absolute_path(path: &Path) -> BitFunResult<PathBuf> {
    let current = std::env::current_dir().map_err(BitFunError::from)?;
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        current.join(path)
    };
    Ok(dunce::simplified(&absolute).to_path_buf())
}

fn read_source_app_definition(source_dir: &Path) -> BitFunResult<super::AppDefinition> {
    let bytes = read_source_file(source_dir, APP_JSON, CopyMode::ProductAppPackage)?;
    serde_json::from_slice(&bytes).map_err(BitFunError::from)
}

fn read_source_component_definition(source_dir: &Path) -> BitFunResult<ComponentDefinition> {
    let bytes = read_source_file(source_dir, COMPONENT_JSON, CopyMode::ComponentPackage)?;
    serde_json::from_slice(&bytes).map_err(BitFunError::from)
}

fn read_source_file(source_dir: &Path, file_name: &str, mode: CopyMode) -> BitFunResult<Vec<u8>> {
    let filesystem_path = filesystem_source_dir(source_dir, mode).join(file_name);
    if filesystem_path.exists() {
        return std::fs::read(&filesystem_path).map_err(BitFunError::from);
    }

    let embedded_dir = embedded_source_dir(source_dir, mode).ok_or_else(|| {
        BitFunError::validation(format!(
            "builtin package source not found: {}",
            source_dir.display()
        ))
    })?;
    let file = embedded_dir.get_file(file_name).ok_or_else(|| {
        BitFunError::validation(format!(
            "missing {} in builtin package source {}",
            file_name,
            source_dir.display()
        ))
    })?;
    Ok(file.contents().to_vec())
}

fn filesystem_source_dir(source_dir: &Path, mode: CopyMode) -> PathBuf {
    match mode {
        CopyMode::ProductAppPackage | CopyMode::PublishedProductAppRelease => {
            filesystem_product_apps_root().join(source_dir)
        }
        CopyMode::ComponentPackage => filesystem_components_root().join(source_dir),
    }
}

fn embedded_source_dir(source_dir: &Path, mode: CopyMode) -> Option<&'static Dir<'static>> {
    let normalized = source_dir.to_string_lossy().replace('\\', "/");
    match mode {
        CopyMode::ProductAppPackage | CopyMode::PublishedProductAppRelease => {
            BUILTIN_PRODUCT_APPS_DIR.get_dir(normalized.as_str())
        }
        CopyMode::ComponentPackage => BUILTIN_COMPONENTS_DIR.get_dir(normalized.as_str()),
    }
}

fn collect_product_app_package_sources() -> Vec<PathBuf> {
    let mut paths = collect_embedded_package_dirs(&BUILTIN_PRODUCT_APPS_DIR, APP_JSON);
    paths.extend(collect_filesystem_package_dirs(
        &filesystem_product_apps_root(),
        APP_JSON,
    ));
    paths.into_iter().collect()
}

fn collect_component_package_sources() -> Vec<PathBuf> {
    let mut paths = collect_embedded_package_dirs(&BUILTIN_COMPONENTS_DIR, COMPONENT_JSON);
    paths.extend(collect_filesystem_package_dirs(
        &filesystem_components_root(),
        COMPONENT_JSON,
    ));
    paths.into_iter().collect()
}

fn collect_embedded_package_dirs(root: &'static Dir<'static>, marker: &str) -> BTreeSet<PathBuf> {
    let mut paths = BTreeSet::new();
    collect_embedded_package_dirs_into(root, root.path(), marker, &mut paths);
    paths
}

fn collect_embedded_package_dirs_into(
    dir: &'static Dir<'static>,
    root: &Path,
    marker: &str,
    out: &mut BTreeSet<PathBuf>,
) {
    if dir.get_file(marker).is_some() {
        if let Ok(relative) = dir.path().strip_prefix(root) {
            out.insert(relative.to_path_buf());
        }
    }
    for child in dir.dirs() {
        collect_embedded_package_dirs_into(child, root, marker, out);
    }
}

fn collect_filesystem_package_dirs(root: &Path, marker: &str) -> BTreeSet<PathBuf> {
    let mut paths = BTreeSet::new();
    if !root.exists() {
        return paths;
    }
    collect_filesystem_package_dirs_into(root, root, marker, &mut paths);
    paths
}

fn collect_filesystem_package_dirs_into(
    dir: &Path,
    root: &Path,
    marker: &str,
    out: &mut BTreeSet<PathBuf>,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    if dir.join(marker).is_file() {
        if let Ok(relative) = dir.strip_prefix(root) {
            out.insert(relative.to_path_buf());
        }
    }
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_filesystem_package_dirs_into(&path, root, marker, out);
        }
    }
}

fn collect_installed_product_app_dirs(root: &Path) -> BitFunResult<Vec<PathBuf>> {
    collect_product_app_version_dirs(root)
}

fn collect_component_package_dirs(root: &Path) -> BitFunResult<Vec<PathBuf>> {
    collect_component_version_dirs(root)
}

fn collect_product_app_version_dirs(root: &Path) -> BitFunResult<Vec<PathBuf>> {
    let mut out = Vec::new();
    if !root.exists() {
        return Ok(out);
    }

    for app_entry in std::fs::read_dir(root)? {
        let app_path = app_entry?.path();
        if !app_path.is_dir() || is_legacy_non_product_app_root(&app_path) {
            continue;
        }
        for version_entry in std::fs::read_dir(&app_path)? {
            let version_path = version_entry?.path();
            if version_path.is_dir() && version_path.join(APP_JSON).is_file() {
                out.push(version_path);
            }
        }
    }

    out.sort();
    Ok(out)
}

fn collect_component_version_dirs(root: &Path) -> BitFunResult<Vec<PathBuf>> {
    let mut out = Vec::new();
    if !root.exists() {
        return Ok(out);
    }

    for kind_entry in std::fs::read_dir(root)? {
        let kind_path = kind_entry?.path();
        if !kind_path.is_dir() {
            continue;
        }
        for component_entry in std::fs::read_dir(&kind_path)? {
            let component_path = component_entry?.path();
            if !component_path.is_dir() {
                continue;
            }
            for version_entry in std::fs::read_dir(&component_path)? {
                let version_path = version_entry?.path();
                if version_path.is_dir() && version_path.join(COMPONENT_JSON).is_file() {
                    out.push(version_path);
                }
            }
        }
    }

    out.sort();
    Ok(out)
}

fn is_legacy_non_product_app_root(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| LEGACY_NON_PRODUCT_APP_ROOT_DIRS.contains(&name))
}

fn collect_files_from_filesystem(dir: &Path) -> BitFunResult<Vec<PathBuf>> {
    let mut files = Vec::new();
    collect_files_from_filesystem_into(dir, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_files_from_filesystem_into(dir: &Path, out: &mut Vec<PathBuf>) -> BitFunResult<()> {
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            collect_files_from_filesystem_into(&path, out)?;
        } else if path.is_file() {
            out.push(path);
        }
    }
    Ok(())
}

fn collect_embedded_files<'a>(dir: &'a Dir<'a>, out: &mut Vec<&'a File<'a>>) {
    for file in dir.files() {
        out.push(file);
    }
    for child in dir.dirs() {
        collect_embedded_files(child, out);
    }
}

fn write_bytes<P: AsRef<Path>>(path: P, content: &[u8]) -> BitFunResult<()> {
    if let Some(parent) = path.as_ref().parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, content)?;
    Ok(())
}

fn dedupe_components(components: Vec<ComponentDefinition>) -> Vec<ComponentDefinition> {
    let mut by_identity = BTreeMap::<String, ComponentDefinition>::new();
    for component in components {
        by_identity
            .entry(component.fqid())
            .and_modify(|existing| {
                for app_id in &component.used_by_apps {
                    if !existing.used_by_apps.contains(app_id) {
                        existing.used_by_apps.push(app_id.clone());
                    }
                }
            })
            .or_insert(component);
    }
    by_identity.into_values().collect()
}

fn filesystem_product_apps_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("bundles")
        .join("product-apps")
        .join("builtin")
}

fn filesystem_components_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("bundles")
        .join("components")
}

#[cfg(test)]
mod tests {
    use crate::app_platform::AppIconSpec;

    use super::*;
    use crate::app_platform::{
        create_product_app_package, create_product_app_release, restore_product_app_release,
        AppCatalogVisibility, AppDataLifecyclePolicy, AppDefinition, AppInstallScope,
        AppInteractionModel, AppManagementAction, AppPermissionSummary, AppSurfaceMode,
        AppWorkMultiplicity, ComponentKind, ComponentPackageSource, CreateProductAppPackageDraft,
        CreateProductAppReleaseRequest, ProductAppCatalogEntry, ProductAppCatalogSourceKind,
        ProductAppLaunchScopeRequirement, ProductAppManagementOrigin, ProductAppReleaseCheck,
        ProductAppReleaseReadinessSnapshot, RestoreProductAppReleaseRequest, SurfaceRef,
    };
    use serde_json::json;
    use std::collections::BTreeSet;

    fn path_manager(test_name: &str) -> PathManager {
        let root = std::env::temp_dir().join(format!(
            "sparo-builtin-product-app-{}-{}",
            test_name,
            uuid::Uuid::new_v4().simple()
        ));
        PathManager::with_user_root_for_tests(root)
    }

    #[test]
    fn product_app_dir_collection_skips_legacy_app_roots() {
        let path_manager = path_manager("collect-product-app-dirs");
        let root = path_manager.system_product_apps_dir();
        let valid_dir = root.join("sample-app").join("1.0.0");
        std::fs::create_dir_all(&valid_dir).expect("valid package dir");
        std::fs::write(valid_dir.join(APP_JSON), "{}").expect("valid app json");

        let flat_legacy_dir = root.join("flat-legacy-app");
        std::fs::create_dir_all(&flat_legacy_dir).expect("flat legacy dir");
        std::fs::write(flat_legacy_dir.join(APP_JSON), "{}").expect("flat legacy app json");

        let live_app_dir = root.join("liveapps").join("legacy-live").join("1.0.0");
        std::fs::create_dir_all(&live_app_dir).expect("legacy live app dir");
        std::fs::write(live_app_dir.join(APP_JSON), "{}").expect("legacy live app json");

        let nested_dir = root
            .join("sample-app")
            .join("source")
            .join("nested")
            .join("1.0.0");
        std::fs::create_dir_all(&nested_dir).expect("nested dir");
        std::fs::write(nested_dir.join(APP_JSON), "{}").expect("nested app json");

        let dirs = collect_installed_product_app_dirs(&root).expect("collect product app dirs");

        assert_eq!(dirs, vec![valid_dir]);
    }

    #[test]
    fn component_dir_collection_uses_versioned_component_shape() {
        let path_manager = path_manager("collect-component-dirs");
        let root = path_manager.system_components_dir();
        let valid_dir = root
            .join(ComponentKind::Surface.path_segment())
            .join("sample-surface")
            .join("1.0.0");
        std::fs::create_dir_all(&valid_dir).expect("valid component dir");
        std::fs::write(valid_dir.join(COMPONENT_JSON), "{}").expect("valid component json");

        let flat_legacy_dir = root.join("legacy-component");
        std::fs::create_dir_all(&flat_legacy_dir).expect("flat legacy component dir");
        std::fs::write(flat_legacy_dir.join(COMPONENT_JSON), "{}")
            .expect("flat legacy component json");

        let nested_dir = root
            .join(ComponentKind::Surface.path_segment())
            .join("sample-surface")
            .join("source")
            .join("1.0.0");
        std::fs::create_dir_all(&nested_dir).expect("nested component dir");
        std::fs::write(nested_dir.join(COMPONENT_JSON), "{}").expect("nested component json");

        let dirs = collect_component_package_dirs(&root).expect("collect component dirs");

        assert_eq!(dirs, vec![valid_dir]);
    }

    fn test_resolved_product_app(version: &str, permission_digest: &str) -> ResolvedProductApp {
        let app = AppDefinition {
            id: "sample-app".to_string(),
            version: version.to_string(),
            name: "Sample App".to_string(),
            description: "A sample Product App".to_string(),
            goal: "Run the sample Product App".to_string(),
            interaction_model: AppInteractionModel::InteractiveWorkspace,
            work_multiplicity: AppWorkMultiplicity::Multiple,
            work_object_kinds: Vec::new(),
            data_lifecycle: Some(AppDataLifecyclePolicy::default()),
            truth_source: None,
            primary_surface: Some(SurfaceRef {
                component_id: "sample-surface".to_string(),
                surface_id: Some("primary".to_string()),
            }),
            primary_surface_mode: Some(AppSurfaceMode::SidecarLinked),
            components: Vec::new(),
            component_lock_id: "sha256:sample".to_string(),
            permissions: AppPermissionSummary::default(),
            install_scope: AppInstallScope::System,
            catalog_visibility: AppCatalogVisibility::Discoverable,
            enabled: true,
            icon: AppIconSpec::Monogram {
                label: "Sample App".to_string(),
                seed: None,
                background: None,
            },
            category: "utility".to_string(),
            tags: Vec::new(),
            launch: None,
        };
        let lock = ComponentLock {
            app_id: app.id.clone(),
            version: app.version.clone(),
            lock_version: 1,
            resolved_components: Vec::new(),
            permission_digest: permission_digest.to_string(),
            component_graph_digest: "component-graph".to_string(),
        };
        let component_lock_digest = lock.digest();
        ResolvedProductApp {
            app: app.clone(),
            components: Vec::new(),
            lock,
            catalog_entry: ProductAppCatalogEntry {
                app,
                component_lock_digest,
                package_digest: None,
                update_available: false,
                installed_component_lock_digest: None,
                available_component_lock_digest: None,
                installed_package_digest: None,
                available_package_digest: None,
                catalog_release_id: None,
                catalog_release_label: None,
                catalog_release_notes: None,
                catalog_published_at_ms: None,
                dependency_summary: String::new(),
                installed: false,
                discoverable: false,
                library_sources: Vec::new(),
                catalog_source: None,
                catalog_issues: Vec::new(),
                management: Default::default(),
                rehearsal_plan: None,
                eval_plan: None,
            },
            private_surface_sources: BTreeMap::new(),
        }
    }

    fn passed_release_readiness() -> ProductAppReleaseReadinessSnapshot {
        ProductAppReleaseReadinessSnapshot {
            work_id: "work_release_catalog".to_string(),
            preview_result_id: "preview:release-rehearsal:work_release_catalog".to_string(),
            status: "passed".to_string(),
            observed_at: 100,
            checks: [
                "validation",
                "preview",
                "issues",
                "criticalPath",
                "permissions",
                "permissionReview",
                "data",
                "dataLifecycle",
                "dataSummary",
                "runtimeStorage",
                "runtimeDependencies",
                "agentEval",
                "userPath",
                "releaseGate",
            ]
            .into_iter()
            .map(|id| ProductAppReleaseCheck {
                id: id.to_string(),
                status: "passed".to_string(),
                detail: Some(format!("{id} passed.")),
            })
            .collect(),
        }
    }

    #[test]
    fn select_installed_product_app_by_lock_uses_version_and_lock() {
        let first = test_resolved_product_app("1.0.0", "permissions-a");
        let selected = test_resolved_product_app("2.0.0", "permissions-b");
        let selected_digest = selected.lock.digest();

        let (app, lock_digest) = select_installed_product_app_by_lock(
            vec![first, selected],
            "sample-app",
            "2.0.0",
            &selected_digest,
        )
        .expect("version and lock should select the installed package");

        assert_eq!(app.app.version, "2.0.0");
        assert_eq!(lock_digest, selected_digest);
    }

    #[test]
    fn select_installed_product_app_by_lock_reports_available_packages() {
        let first = test_resolved_product_app("1.0.0", "permissions-a");
        let second = test_resolved_product_app("2.0.0", "permissions-b");

        let error = select_installed_product_app_by_lock(
            vec![first, second],
            "sample-app",
            "3.0.0",
            "sha256:missing",
        )
        .expect_err("missing version and lock should be reported")
        .to_string();

        assert!(error.contains("version 3.0.0 and lock sha256:missing"));
        assert!(error.contains("1.0.0 (sha256:"));
        assert!(error.contains("2.0.0 (sha256:"));
    }

    #[tokio::test]
    async fn all_builtin_product_app_packages_resolve_to_locks() {
        let shared_components = read_component_packages_from_root(&filesystem_components_root())
            .await
            .expect("builtin shared Component packages should parse");
        let mut app_ids = BTreeSet::new();

        let apps_root = filesystem_product_apps_root();
        for source_dir in collect_product_app_package_sources() {
            let app_dir = apps_root.join(&source_dir);
            let package = ProductAppResolver::read_product_app_package(&app_dir)
                .await
                .unwrap_or_else(|error| {
                    panic!(
                        "builtin Product App package should parse: {}: {}",
                        app_dir.display(),
                        error
                    )
                });
            let resolved =
                ProductAppResolver::resolve_package_install(package, shared_components.clone())
                    .unwrap_or_else(|error| {
                        panic!(
                            "builtin Product App package should resolve: {}: {}",
                            app_dir.display(),
                            error
                        )
                    });
            assert!(resolved.app.component_lock_id.starts_with("sha256:"));
            assert!(!resolved.lock.resolved_components.is_empty());
            app_ids.insert(resolved.app.id);
        }

        for expected in [
            "builtin-deep-research",
            "builtin-harmony-dev",
            "builtin-ppt-live",
            "builtin-remotion-live",
            "builtin-spark-board",
        ] {
            assert!(app_ids.contains(expected), "{expected} should be packaged");
        }
    }

    #[tokio::test]
    async fn builtin_product_app_lifecycle_separates_source_from_installed_packages() {
        let path_manager = path_manager("install-lifecycle");
        let app_id = "builtin-spark-board";
        let version = "1.0.0";

        let installed_before = list_installed_product_apps(&path_manager)
            .await
            .expect("fresh test root should list installed Product Apps");
        assert!(
            installed_before
                .iter()
                .all(|app| app.app.id != app_id || app.app.version != version),
            "discoverable builtins should not be installed just by seeding the catalog"
        );

        let source_before = list_product_app_catalog_source(&path_manager)
            .await
            .expect("builtin source catalog should be available");
        let source_app = source_before
            .iter()
            .find(|app| app.app.id == app_id && app.app.version == version)
            .expect("builtin source catalog should include Spark Board");
        assert!(source_app.discoverable);
        assert!(!source_app.installed);
        assert_eq!(
            source_app.management.origin,
            ProductAppManagementOrigin::DiscoverableSource
        );
        assert!(source_app
            .management
            .actions
            .contains(&AppManagementAction::Install));
        assert!(!source_app
            .management
            .actions
            .contains(&AppManagementAction::Uninstall));
        assert_eq!(
            source_app.catalog_source.as_ref().map(|source| source.kind),
            Some(ProductAppCatalogSourceKind::BuiltinMarketplace)
        );
        assert!(product_app_sources_dir(&path_manager)
            .join(app_id)
            .join(version)
            .join("app.json")
            .exists());
        assert!(!path_manager
            .system_product_app_version_dir(app_id, version)
            .join("app.json")
            .exists());

        install_product_app(&path_manager, app_id, version)
            .await
            .expect("install should copy from source catalog to installed root");

        let installed_after = list_installed_product_app_catalog(&path_manager)
            .await
            .expect("installed catalog should include installed Product Apps");
        let installed_app = installed_after
            .iter()
            .find(|app| app.app.id == app_id && app.app.version == version)
            .expect("installed catalog should include Spark Board after install");
        assert!(installed_app.installed);
        assert!(!installed_app.discoverable);
        assert_eq!(
            installed_app.management.origin,
            ProductAppManagementOrigin::InstalledPackage
        );
        assert!(installed_app
            .management
            .actions
            .contains(&AppManagementAction::Disable));
        assert!(!installed_app
            .management
            .actions
            .contains(&AppManagementAction::Uninstall));
        assert!(installed_app.management.uninstall.as_ref().is_none());
        assert_eq!(
            installed_app
                .catalog_source
                .as_ref()
                .map(|source| source.kind),
            Some(ProductAppCatalogSourceKind::InstalledPackage)
        );
        assert!(path_manager
            .system_product_app_version_dir(app_id, version)
            .join("app.json")
            .exists());
        let uninstall_error = uninstall_product_app(&path_manager, app_id, version)
            .await
            .expect_err("builtin Product Apps should not be uninstallable");
        assert!(uninstall_error
            .to_string()
            .contains("can be disabled but not uninstalled"));
        assert!(path_manager
            .system_product_app_version_dir(app_id, version)
            .join("app.json")
            .exists());

        let source_after_install = list_product_app_catalog_source(&path_manager)
            .await
            .expect("source catalog should still be readable after install");
        let installed_source_app = source_after_install
            .iter()
            .find(|app| app.app.id == app_id && app.app.version == version)
            .expect("source catalog should still include Spark Board after install");
        assert!(!installed_source_app.discoverable);
        assert!(!installed_source_app.installed);
        assert_eq!(
            installed_source_app.management.origin,
            ProductAppManagementOrigin::Hidden
        );
        assert!(installed_source_app.management.actions.is_empty());
        assert_eq!(
            installed_source_app
                .catalog_source
                .as_ref()
                .map(|source| source.kind),
            Some(ProductAppCatalogSourceKind::BuiltinMarketplace)
        );
    }

    #[tokio::test]
    async fn retired_native_product_app_packages_are_not_manageable() {
        let path_manager = path_manager("retired-native-product-app");
        create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "builtin-coding".to_string(),
                name: "Prime Builder".to_string(),
                description: "Retired native Product App package.".to_string(),
                goal: "This legacy package is now a native system app.".to_string(),
                version: "1.0.0".to_string(),
                agent_type: "agentic".to_string(),
                category: "developer".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ChatPrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .expect("write stale native Product App package");

        let installed = list_installed_product_app_catalog(&path_manager)
            .await
            .expect("installed catalog should still load");
        assert!(
            installed.iter().all(|app| app.app.id != "builtin-coding"),
            "retired native Product App packages should not be projected into App Management"
        );

        let enable_error = crate::app_platform::set_product_app_enabled(
            &path_manager,
            "builtin-coding",
            "1.0.0",
            false,
        )
        .await
        .expect_err("retired native Product Apps must not be disable-able");
        assert!(enable_error
            .to_string()
            .contains("Native system apps are always available"));

        let uninstall_error = uninstall_product_app(&path_manager, "builtin-coding", "1.0.0")
            .await
            .expect_err("retired native Product Apps must not be uninstallable");
        assert!(uninstall_error
            .to_string()
            .contains("Native system apps are always available"));
        assert!(path_manager
            .system_product_app_version_dir("builtin-coding", "1.0.0")
            .join(APP_JSON)
            .exists());
    }

    #[tokio::test]
    async fn installed_catalog_refreshes_stale_component_lock_before_projection() {
        let path_manager = path_manager("stale-installed-lock");
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "lock-repair-app".to_string(),
                name: "Lock Repair App".to_string(),
                description: "Exercises installed Product App lock repair.".to_string(),
                goal: "Repair a stale installed Product App lock before catalog projection."
                    .to_string(),
                version: "1.0.0".to_string(),
                agent_type: "agentic".to_string(),
                category: "utility".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .expect("create package");

        let mut stale_lock = ProductAppResolver::read_lock(&written.package_dir)
            .await
            .expect("read generated lock");
        stale_lock.component_graph_digest = "sha256:stale".to_string();
        ProductAppResolver::write_lock(&written.package_dir, &stale_lock)
            .await
            .expect("write stale lock");

        let installed = list_installed_product_apps_unlocked(&path_manager)
            .await
            .expect("installed catalog should repair stale derived locks");
        assert!(installed
            .iter()
            .any(|app| app.app.id == "lock-repair-app" && app.app.version == "1.0.0"));

        let repaired_app: AppDefinition = serde_json::from_slice(
            &tokio::fs::read(written.package_dir.join(APP_JSON))
                .await
                .unwrap(),
        )
        .expect("read repaired app");
        let repaired_lock = ProductAppResolver::read_lock(&written.package_dir)
            .await
            .expect("read repaired lock");
        assert_ne!(repaired_lock.component_graph_digest, "sha256:stale");
        assert_eq!(repaired_app.component_lock_id, repaired_lock.digest());
    }

    #[tokio::test]
    async fn installed_catalog_skips_invalid_private_component_package_and_reports_issue() {
        let path_manager = path_manager("skip-invalid-private-component");
        create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "healthy-product-app".to_string(),
                name: "Healthy Product App".to_string(),
                description: "Valid package that should still load.".to_string(),
                goal: "Stay visible when a neighboring Product App package is invalid.".to_string(),
                version: "1.0.0".to_string(),
                agent_type: "agentic".to_string(),
                category: "utility".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ChatPrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .expect("create healthy package");
        let broken = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "broken-product-app".to_string(),
                name: "Broken Product App".to_string(),
                description: "Package with a missing private agent component.".to_string(),
                goal: "Exercise per-package catalog failure isolation.".to_string(),
                version: "1.0.0".to_string(),
                agent_type: "agentic".to_string(),
                category: "utility".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ChatPrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .expect("create package to corrupt");

        std::fs::remove_dir_all(
            broken
                .package_dir
                .join("components")
                .join(ComponentKind::Agent.path_segment())
                .join("broken-product-app-agent"),
        )
        .expect("remove private agent component");
        mark_product_app_uninstalled(&path_manager, "broken-product-app", "1.0.0")
            .await
            .expect("mark broken package uninstalled while stale files remain");

        let result = list_installed_product_app_catalog_with_issues(&path_manager)
            .await
            .expect("installed catalog should load around invalid packages");
        assert!(result
            .entries
            .iter()
            .any(|app| app.app.id == "healthy-product-app"));
        let broken_entry = result
            .entries
            .iter()
            .find(|app| app.app.id == "broken-product-app")
            .expect("broken package should stay visible for management");
        assert!(broken_entry.installed);
        assert!(broken_entry
            .management
            .actions
            .contains(&AppManagementAction::Uninstall));
        assert_eq!(broken_entry.catalog_issues.len(), 1);
        assert!(broken_entry.catalog_issues[0]
            .message
            .contains("Private component not found: agents/broken-product-app-agent"));
        assert_eq!(result.issues.len(), 1);
        let issue = &result.issues[0];
        assert_eq!(issue.source, ProductAppCatalogIssueSource::InstalledPackage);
        assert_eq!(issue.app_id.as_deref(), Some("broken-product-app"));
        assert_eq!(issue.app_version.as_deref(), Some("1.0.0"));
        assert!(issue
            .message
            .contains("Private component not found: agents/broken-product-app-agent"));

        let installed = list_installed_product_app_catalog(&path_manager)
            .await
            .expect("legacy installed catalog call should also stay partial-success");
        assert!(installed
            .iter()
            .any(|app| app.app.id == "healthy-product-app"));
        assert!(installed.iter().any(|app| app.app.id == "broken-product-app"));

        let components = list_installed_package_components(&path_manager)
            .await
            .expect("component catalog should not be hidden by one broken Product App");
        assert!(components
            .iter()
            .any(|component| component.id == "healthy-product-app-agent"));
        assert!(components
            .iter()
            .all(|component| component.id != "broken-product-app-agent"));
    }

    #[tokio::test]
    async fn installed_shared_components_exclude_product_app_private_components() {
        let path_manager = path_manager("shared-components-exclude-private");
        create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "private-product-app".to_string(),
                name: "Private Product App".to_string(),
                description: "Creates app-private components.".to_string(),
                goal: "Exercise shared component lookup isolation.".to_string(),
                version: "1.0.0".to_string(),
                agent_type: "agentic".to_string(),
                category: "utility".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ChatPrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .expect("create package with private agent");

        let shared_components = list_installed_shared_components(&path_manager)
            .await
            .expect("read installed shared components");

        assert!(shared_components.iter().all(|component| {
            component.package_source == ComponentPackageSource::Shared
                && component.owner_app.is_none()
        }));
        assert!(shared_components
            .iter()
            .all(|component| component.id != "private-product-app-agent"));

        let package_components = list_installed_package_components(&path_manager)
            .await
            .expect("read installed package components");
        assert!(package_components
            .iter()
            .any(|component| component.id == "private-product-app-agent"));
    }

    #[tokio::test]
    async fn installed_catalog_normalizes_legacy_full_surface_multiple_default() {
        let path_manager = path_manager("legacy-full-surface-multiple");
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "legacy-full-surface-app".to_string(),
                name: "Legacy Full Surface App".to_string(),
                description: "Exercises legacy generated multiplicity repair.".to_string(),
                goal: "Repair a legacy full-surface default before catalog projection.".to_string(),
                version: "1.0.0".to_string(),
                agent_type: "agentic".to_string(),
                category: "utility".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Some(AppWorkMultiplicity::Multiple),
                truth_source: None,
            },
        )
        .await
        .expect("create legacy-shaped package");

        let installed = list_installed_product_app_catalog(&path_manager)
            .await
            .expect("installed catalog should normalize legacy generated app");
        let normalized = installed
            .iter()
            .find(|app| app.app.id == "legacy-full-surface-app")
            .expect("legacy app should be projected");
        assert_eq!(
            normalized.app.work_multiplicity,
            AppWorkMultiplicity::Singleton
        );

        let repaired_app: AppDefinition = serde_json::from_slice(
            &tokio::fs::read(written.package_dir.join(APP_JSON))
                .await
                .unwrap(),
        )
        .expect("read repaired app");
        assert_eq!(
            repaired_app.work_multiplicity,
            AppWorkMultiplicity::Singleton
        );
    }

    #[tokio::test]
    async fn publish_release_to_catalog_source_is_available_and_installable() {
        let path_manager = path_manager("publish-release-source");
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "release-catalog-app".to_string(),
                name: "Release Catalog App".to_string(),
                description: "Published release source test app".to_string(),
                goal: "Publish a release to the catalog source.".to_string(),
                version: "1.0.0".to_string(),
                agent_type: "agentic".to_string(),
                category: "utility".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .expect("create package");
        let release = create_product_app_release(CreateProductAppReleaseRequest {
            package_dir: written.package_dir.clone(),
            shared_components: Vec::new(),
            readiness: passed_release_readiness(),
            label: Some("Catalog release".to_string()),
            notes: Some("Catalog release notes.".to_string()),
            created_by: Some("test".to_string()),
            created_at_ms: 1000,
        })
        .await
        .expect("create release");

        let published = publish_product_app_release_to_catalog(
            &path_manager,
            PublishProductAppReleaseToCatalogRequest {
                release_manifest_path: release.manifest_path.clone(),
                published_by: Some("test".to_string()),
                published_at_ms: 2000,
            },
        )
        .await
        .expect("publish release");

        assert_eq!(published.app_id, "release-catalog-app");
        assert_eq!(published.release_id, release.release_id);
        assert_eq!(published.release_label.as_deref(), Some("Catalog release"));
        assert_eq!(
            published.release_notes.as_deref(),
            Some("Catalog release notes.")
        );
        assert!(published
            .source_dir
            .join(PRODUCT_APP_RELEASE_CATALOG_SOURCE_FILE)
            .is_file());

        let source_catalog = list_product_app_catalog_source(&path_manager)
            .await
            .expect("source catalog");
        let source_app = source_catalog
            .iter()
            .find(|app| app.app.id == "release-catalog-app")
            .expect("published source catalog app");
        assert!(!source_app.discoverable);
        assert!(source_app.update_available);
        assert_eq!(
            source_app.catalog_source.as_ref().map(|source| source.kind),
            Some(ProductAppCatalogSourceKind::PublishedRelease)
        );
        assert_eq!(
            source_app.component_lock_digest,
            release.component_lock_digest
        );
        assert_eq!(
            source_app.catalog_release_id.as_deref(),
            Some(release.release_id.as_str())
        );
        assert_eq!(
            source_app.catalog_release_label.as_deref(),
            Some("Catalog release")
        );
        assert_eq!(
            source_app.catalog_release_notes.as_deref(),
            Some("Catalog release notes.")
        );

        remove_package_dir(
            &written.package_dir,
            &path_manager.system_product_apps_dir(),
        )
        .expect("remove original installed package");
        let source_after_remove = list_product_app_catalog_source(&path_manager)
            .await
            .expect("source catalog after removing local package");
        let source_app_after_remove = source_after_remove
            .iter()
            .find(|app| app.app.id == "release-catalog-app")
            .expect("published source catalog app after removing local package");
        assert!(source_app_after_remove.discoverable);
        assert!(!source_app_after_remove.update_available);

        install_product_app(&path_manager, "release-catalog-app", "1.0.0")
            .await
            .expect("install published release source");

        let installed_catalog = list_installed_product_app_catalog(&path_manager)
            .await
            .expect("installed catalog");
        let installed_app = installed_catalog
            .iter()
            .find(|app| app.app.id == "release-catalog-app")
            .expect("published release app should be installed");
        assert!(installed_app
            .management
            .actions
            .contains(&AppManagementAction::Disable));
        assert!(installed_app
            .management
            .actions
            .contains(&AppManagementAction::Uninstall));
        assert!(installed_app
            .management
            .uninstall
            .as_ref()
            .is_some_and(|policy| policy.removes_installed_package && policy.retains_work));

        let installed_lock = ProductAppResolver::read_lock(
            &path_manager.system_product_app_version_dir("release-catalog-app", "1.0.0"),
        )
        .await
        .expect("installed lock");
        assert_eq!(installed_lock.digest(), release.component_lock_digest);

        uninstall_product_app(&path_manager, "release-catalog-app", "1.0.0")
            .await
            .expect("published release Product Apps should be uninstallable");
        assert!(!path_manager
            .system_product_app_version_dir("release-catalog-app", "1.0.0")
            .join(APP_JSON)
            .exists());
    }

    #[tokio::test]
    async fn source_catalog_marks_update_when_published_release_package_digest_differs() {
        let path_manager = path_manager("published-release-update");
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "release-update-app".to_string(),
                name: "Release Update App".to_string(),
                description: "Original release".to_string(),
                goal: "Detect release source updates.".to_string(),
                version: "1.0.0".to_string(),
                agent_type: "agentic".to_string(),
                category: "utility".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .expect("create package");
        let release_one = create_product_app_release(CreateProductAppReleaseRequest {
            package_dir: written.package_dir.clone(),
            shared_components: Vec::new(),
            readiness: passed_release_readiness(),
            label: Some("Installed release".to_string()),
            notes: None,
            created_by: Some("test".to_string()),
            created_at_ms: 1000,
        })
        .await
        .expect("create release one");

        let app_path = written.package_dir.join(APP_JSON);
        let mut app: Value = serde_json::from_slice(&tokio::fs::read(&app_path).await.unwrap())
            .expect("read app json");
        app["description"] = json!("Updated release source");
        tokio::fs::write(&app_path, serde_json::to_vec_pretty(&app).unwrap())
            .await
            .expect("write updated app");
        let release_two = create_product_app_release(CreateProductAppReleaseRequest {
            package_dir: written.package_dir.clone(),
            shared_components: Vec::new(),
            readiness: passed_release_readiness(),
            label: Some("Available release".to_string()),
            notes: Some("Update notes.".to_string()),
            created_by: Some("test".to_string()),
            created_at_ms: 2000,
        })
        .await
        .expect("create release two");
        publish_product_app_release_to_catalog(
            &path_manager,
            PublishProductAppReleaseToCatalogRequest {
                release_manifest_path: release_two.manifest_path.clone(),
                published_by: Some("test".to_string()),
                published_at_ms: 3000,
            },
        )
        .await
        .expect("publish release two source");
        restore_product_app_release(RestoreProductAppReleaseRequest {
            package_dir: written.package_dir.clone(),
            shared_components: Vec::new(),
            release_id: release_one.release_id.clone(),
            confirm: true,
        })
        .await
        .expect("restore installed package to release one");

        let source_catalog = list_product_app_catalog_source(&path_manager)
            .await
            .expect("source catalog");
        let source_app = source_catalog
            .iter()
            .find(|app| app.app.id == "release-update-app")
            .expect("published source app");

        assert!(source_app.update_available);
        assert_eq!(
            source_app.catalog_release_id.as_deref(),
            Some(release_two.release_id.as_str())
        );
        assert_eq!(
            source_app.catalog_release_label.as_deref(),
            Some("Available release")
        );
        assert_eq!(
            source_app.catalog_release_notes.as_deref(),
            Some("Update notes.")
        );
        assert!(!source_app.discoverable);
        assert_eq!(
            source_app.installed_component_lock_digest,
            Some(release_one.component_lock_digest.clone())
        );
        assert_eq!(
            source_app.available_component_lock_digest,
            Some(release_two.component_lock_digest.clone())
        );
        assert_ne!(
            source_app.installed_package_digest,
            source_app.available_package_digest
        );
    }

    #[tokio::test]
    async fn builtin_remotion_product_app_resolves_to_lock() {
        let app_dir = filesystem_product_apps_root()
            .join("builtin-remotion-live")
            .join("19.0.0");
        let package = ProductAppResolver::read_product_app_package(&app_dir)
            .await
            .expect("builtin Remotion Product App package should parse");
        let shared_components = read_component_packages_from_root(&filesystem_components_root())
            .await
            .expect("builtin shared Component packages should parse");

        let resolved = ProductAppResolver::resolve_package_install(package, shared_components)
            .expect("builtin Remotion Product App should resolve");

        assert_eq!(resolved.app.id, "builtin-remotion-live");
        assert!(resolved.app.component_lock_id.starts_with("sha256:"));
        assert!(resolved.lock.resolved_components.iter().any(|entry| {
            entry.component_id == "remotion-video-agent"
                && entry.version.as_deref() == Some("1.0.0")
        }));
        assert!(resolved.lock.resolved_components.iter().any(|entry| {
            entry.component_id == "builtin-remotion-runtime"
                && entry.version.as_deref() == Some("1.0.0")
        }));
    }

    #[tokio::test]
    async fn builtin_harmony_product_app_resolves_to_workspace_required_lock() {
        let app_dir = filesystem_product_apps_root()
            .join("builtin-harmony-dev")
            .join("13.0.0");
        let package = ProductAppResolver::read_product_app_package(&app_dir)
            .await
            .expect("builtin Harmony Product App package should parse");
        let shared_components = read_component_packages_from_root(&filesystem_components_root())
            .await
            .expect("builtin shared Component packages should parse");

        let resolved = ProductAppResolver::resolve_package_install(package, shared_components)
            .expect("builtin Harmony Product App should resolve");

        assert_eq!(resolved.app.id, "builtin-harmony-dev");
        assert_eq!(resolved.app.version, "13.0.0");
        assert_eq!(
            resolved
                .app
                .launch
                .as_ref()
                .map(|launch| launch.scope_requirement),
            Some(ProductAppLaunchScopeRequirement::WorkspaceRequired)
        );
        assert!(resolved
            .app
            .work_object_kinds
            .iter()
            .any(|kind| kind.id == "workspace"));
        assert!(resolved.lock.resolved_components.iter().any(|entry| {
            entry.component_id == "harmonyos-dev-agent" && entry.version.as_deref() == Some("1.0.0")
        }));
        assert!(resolved.lock.resolved_components.iter().any(|entry| {
            entry.component_id == "builtin-harmony-runtime"
                && entry.version.as_deref() == Some("1.0.0")
        }));
        assert!(resolved.lock.resolved_components.iter().any(|entry| {
            entry.component_id == "product-app-runtime-host"
                && entry.version.as_deref() == Some("1.0.0")
        }));
    }
}
