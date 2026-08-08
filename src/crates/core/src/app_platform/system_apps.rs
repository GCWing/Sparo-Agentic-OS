//! System Intelligent App release seeding.
//!
//! Bundled Product Apps are release inputs, never mutable installations. Seeding
//! resolves only the newest package for each App into an immutable release.
//! Startup replaces an existing official selection with that Release and
//! permanently prunes older Releases and artifacts for the same App.

use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use include_dir::Dir;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::fs;
use uuid::Uuid;

use crate::error::{CoreError, CoreResult};
use crate::infrastructure::PathManager;

use super::bundle_assets::{SYSTEM_COMPONENT_BUNDLES, SYSTEM_PRODUCT_APP_BUNDLES};
use super::catalog::ComponentDefinition;
use super::draft_package::prepare_draft_release;
use super::resolver::ProductAppResolver;
use super::revision_store::{
    AppOwner, AppRevisionStore, ImportReleaseFromPackageRequest, ReleaseMetadata,
    ReleaseProvenanceKind, ReleaseRuntimeSpec, SystemReleaseInitializationOutcome,
    SystemReleaseSyncOutcome,
};

const APP_JSON: &str = "app.json";
const COMPONENT_JSON: &str = "component.json";
const COMPONENT_DIGEST_DOMAIN: &[u8] = b"sparo-system-component-v1\0";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemAppSeedResult {
    pub components_added: usize,
    pub components_reused: usize,
    pub apps_retired: usize,
    pub releases_added: usize,
    pub releases_reused: usize,
    pub releases_replaced: usize,
    pub activations_created: usize,
    pub activations_preserved: usize,
    pub issues: Vec<SystemAppSeedIssue>,
}

impl SystemAppSeedResult {
    pub fn is_degraded(&self) -> bool {
        !self.issues.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemAppSeedIssue {
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone)]
struct ImportedSystemRelease {
    sync_outcome: SystemReleaseSyncOutcome,
    activation_outcome: SystemReleaseInitializationOutcome,
}

async fn load_shared_components<'a>(
    cache: &'a mut Option<Vec<ComponentDefinition>>,
    path_manager: &PathManager,
) -> CoreResult<&'a [ComponentDefinition]> {
    if cache.is_none() {
        *cache = Some(list_system_shared_components(path_manager).await?);
    }
    Ok(cache.as_deref().unwrap_or_default())
}

/// Synchronizes only the newest bundled Product App version for each identity.
/// Each System-owned App is committed independently, so one malformed package
/// becomes a reported issue without blocking other Apps. User-selected variants
/// retain their routing decision, while official System Apps follow the current
/// content snapshot even when its declared development version is unchanged.
pub async fn seed_system_app_releases(
    path_manager: &PathManager,
    revision_store: &AppRevisionStore,
) -> CoreResult<SystemAppSeedResult> {
    let mut result = SystemAppSeedResult::default();
    if let Err(error) = cleanup_system_seed_staging_directories(revision_store.storage_root()).await
    {
        result.issues.push(SystemAppSeedIssue {
            source: "staging-cleanup".to_string(),
            app_id: None,
            version: None,
            message: error.to_string(),
        });
    }
    match seed_system_shared_components(path_manager).await {
        Ok((added, reused)) => {
            result.components_added = added;
            result.components_reused = reused;
        }
        Err(error) => result.issues.push(SystemAppSeedIssue {
            source: "shared-components".to_string(),
            app_id: None,
            version: None,
            message: error.to_string(),
        }),
    }
    let filesystem_root = filesystem_product_apps_root();
    let mut shared_components = None;

    let mut newest_sources = BTreeMap::<String, (Version, PathBuf)>::new();
    let mut declared_app_ids = BTreeSet::new();
    for source in collect_package_sources(&SYSTEM_PRODUCT_APP_BUNDLES, &filesystem_root, APP_JSON) {
        let identity = match package_source_segments(&source, 2, "Product App") {
            Ok(identity) => identity,
            Err(error) => {
                result.issues.push(SystemAppSeedIssue {
                    source: source.display().to_string(),
                    app_id: None,
                    version: None,
                    message: error.to_string(),
                });
                continue;
            }
        };
        declared_app_ids.insert(identity[0].clone());
        let version = match Version::parse(&identity[1]) {
            Ok(version) => version,
            Err(error) => {
                result.issues.push(SystemAppSeedIssue {
                    source: source.display().to_string(),
                    app_id: Some(identity[0].clone()),
                    version: Some(identity[1].clone()),
                    message: format!(
                        "Invalid bundled Intelligent App version {}: {error}",
                        identity[1]
                    ),
                });
                continue;
            }
        };
        let replace = newest_sources
            .get(&identity[0])
            .is_none_or(|(current, _)| version > *current);
        if replace {
            newest_sources.insert(identity[0].clone(), (version, source));
        }
    }

    let installed_system_apps = revision_store
        .list_apps()
        .await
        .into_iter()
        .filter(|app| app.owner == AppOwner::system())
        .collect::<Vec<_>>();
    for app in installed_system_apps {
        if declared_app_ids.contains(&app.app_id) {
            continue;
        }
        match revision_store.retire_system_app(&app.app_id).await {
            Ok(true) => result.apps_retired += 1,
            Ok(false) => {}
            Err(error) => result.issues.push(SystemAppSeedIssue {
                source: "retired-system-app".to_string(),
                app_id: Some(app.app_id),
                version: None,
                message: error.to_string(),
            }),
        }
    }

    for (expected_app_id, (expected_version, source)) in newest_sources {
        let components = match load_shared_components(&mut shared_components, path_manager).await {
            Ok(components) => components,
            Err(error) => {
                result.issues.push(SystemAppSeedIssue {
                    source: source.display().to_string(),
                    app_id: Some(expected_app_id.clone()),
                    version: Some(expected_version.to_string()),
                    message: error.to_string(),
                });
                continue;
            }
        };
        let release = match import_system_app_release(
            revision_store,
            &source,
            &expected_app_id,
            &expected_version,
            components,
        )
        .await
        {
            Ok(release) => release,
            Err(error) => {
                result.issues.push(SystemAppSeedIssue {
                    source: source.display().to_string(),
                    app_id: Some(expected_app_id),
                    version: Some(expected_version.to_string()),
                    message: error.to_string(),
                });
                continue;
            }
        };
        match release.sync_outcome {
            SystemReleaseSyncOutcome::Added => result.releases_added += 1,
            SystemReleaseSyncOutcome::Reused => result.releases_reused += 1,
            SystemReleaseSyncOutcome::Replaced => result.releases_replaced += 1,
        }
        match release.activation_outcome {
            SystemReleaseInitializationOutcome::Created => result.activations_created += 1,
            SystemReleaseInitializationOutcome::Preserved => result.activations_preserved += 1,
        }
    }

    Ok(result)
}

/// Reads installed shared component packages without creating directories or
/// triggering a seed. Runtime/read paths must remain side-effect free.
pub async fn list_system_shared_components(
    path_manager: &PathManager,
) -> CoreResult<Vec<ComponentDefinition>> {
    let root = path_manager.system_components_dir();
    if !root.is_dir() {
        return Ok(Vec::new());
    }

    let mut package_dirs = Vec::new();
    let mut kinds = fs::read_dir(&root).await?;
    while let Some(kind) = kinds.next_entry().await? {
        if !kind.file_type().await?.is_dir() {
            continue;
        }
        let mut components = fs::read_dir(kind.path()).await?;
        while let Some(component) = components.next_entry().await? {
            if !component.file_type().await?.is_dir() {
                continue;
            }
            let mut versions = fs::read_dir(component.path()).await?;
            while let Some(version) = versions.next_entry().await? {
                let package_dir = version.path();
                if version.file_type().await?.is_dir() && package_dir.join(COMPONENT_JSON).is_file()
                {
                    package_dirs.push(package_dir);
                }
            }
        }
    }
    package_dirs.sort();

    let mut definitions = Vec::with_capacity(package_dirs.len());
    for package_dir in package_dirs {
        definitions.push(
            ProductAppResolver::read_component_package(&package_dir)
                .await?
                .component,
        );
    }
    definitions.sort_by(|left, right| {
        left.kind
            .path_segment()
            .cmp(right.kind.path_segment())
            .then_with(|| left.id.cmp(&right.id))
            .then_with(|| left.version.cmp(&right.version))
    });
    Ok(definitions)
}

async fn seed_system_shared_components(path_manager: &PathManager) -> CoreResult<(usize, usize)> {
    let components_root = path_manager.system_components_dir();
    fs::create_dir_all(&components_root).await?;
    cleanup_system_seed_staging_directories(&components_root).await?;
    let filesystem_root = filesystem_components_root();
    let mut added = 0;
    let mut reused = 0;
    for source in
        collect_package_sources(&SYSTEM_COMPONENT_BUNDLES, &filesystem_root, COMPONENT_JSON)
    {
        let source_identity = package_source_segments(&source, 3, "component")?;
        let staging = components_root.join(format!(".system-seed-{}", Uuid::new_v4().simple()));
        if let Err(error) = materialize_source(
            &source,
            &filesystem_root,
            &SYSTEM_COMPONENT_BUNDLES,
            &staging,
        )
        .await
        {
            if staging.exists() {
                let _ = fs::remove_dir_all(&staging).await;
            }
            return Err(error);
        }

        let result = install_immutable_component(path_manager, &staging, &source_identity).await;
        if staging.exists() {
            let _ = fs::remove_dir_all(&staging).await;
        }
        match result? {
            true => added += 1,
            false => reused += 1,
        }
    }
    Ok((added, reused))
}

async fn cleanup_system_seed_staging_directories(parent: &Path) -> CoreResult<()> {
    let parent_metadata = match fs::symlink_metadata(parent).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err(CoreError::validation(format!(
            "System seed storage root is not a directory: {}",
            parent.display()
        )));
    }

    let mut entries = fs::read_dir(parent).await?;
    while let Some(entry) = entries.next_entry().await? {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !is_system_seed_staging_name(&name) {
            continue;
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).await?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(CoreError::validation(format!(
                "System seed staging entry is not a real directory: {}",
                path.display()
            )));
        }
        ensure_tree_has_no_symlinks(&path).await?;
        fs::remove_dir_all(&path).await?;
    }
    Ok(())
}

fn is_system_seed_staging_name(name: &str) -> bool {
    let Some(suffix) = name.strip_prefix(".system-seed-") else {
        return false;
    };
    !suffix.is_empty()
}

async fn ensure_tree_has_no_symlinks(root: &Path) -> CoreResult<()> {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let mut entries = fs::read_dir(&directory).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).await?;
            if metadata.file_type().is_symlink() {
                return Err(CoreError::validation(format!(
                    "System seed staging directories must not contain symbolic links: {}",
                    path.display()
                )));
            }
            if metadata.is_dir() {
                pending.push(path);
            }
        }
    }
    Ok(())
}

async fn install_immutable_component(
    path_manager: &PathManager,
    staging: &Path,
    source_identity: &[String],
) -> CoreResult<bool> {
    let component = ProductAppResolver::read_component_package(staging)
        .await?
        .component;
    let component_version = component.version.as_deref().ok_or_else(|| {
        CoreError::validation(format!(
            "Bundled shared component {} must declare a version",
            component.id
        ))
    })?;
    if component.kind.path_segment() != source_identity[0]
        || component.id != source_identity[1]
        || component_version != source_identity[2]
    {
        return Err(CoreError::validation(format!(
            "Bundled component path {}/{}/{} does not match manifest identity {}/{}/{}",
            source_identity[0],
            source_identity[1],
            source_identity[2],
            component.kind.path_segment(),
            component.id,
            component_version
        )));
    }
    let destination = path_manager.system_component_version_dir(
        component.kind.path_segment(),
        &component.id,
        component_version,
    );
    let staged_digest = digest_directory(staging, COMPONENT_DIGEST_DOMAIN).await?;
    if destination.exists() {
        ensure_same_immutable_component(&destination, &staged_digest).await?;
        return Ok(false);
    }

    let parent = destination.parent().ok_or_else(|| {
        CoreError::validation(format!(
            "System component destination has no parent: {}",
            destination.display()
        ))
    })?;
    fs::create_dir_all(parent).await?;
    match fs::rename(staging, &destination).await {
        Ok(()) => Ok(true),
        Err(_) if destination.exists() => {
            ensure_same_immutable_component(&destination, &staged_digest).await?;
            Ok(false)
        }
        Err(rename_error) => Err(rename_error.into()),
    }
}

async fn ensure_same_immutable_component(
    destination: &Path,
    expected_digest: &str,
) -> CoreResult<()> {
    let metadata = fs::symlink_metadata(destination).await?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(CoreError::validation(format!(
            "Immutable system component path is not a directory: {}",
            destination.display()
        )));
    }
    let installed_digest = digest_directory(destination, COMPONENT_DIGEST_DOMAIN).await?;
    if installed_digest != expected_digest {
        return Err(CoreError::validation(format!(
            "Immutable system component version collision at {}: installed={}, bundled={}. Publish changed component bytes under a new version",
            destination.display(), installed_digest, expected_digest
        )));
    }
    Ok(())
}

async fn import_system_app_release(
    revision_store: &AppRevisionStore,
    source: &Path,
    expected_app_id: &str,
    expected_version: &Version,
    shared_components: &[ComponentDefinition],
) -> CoreResult<ImportedSystemRelease> {
    let staging = revision_store
        .storage_root()
        .join(format!(".system-seed-{}", Uuid::new_v4().simple()));
    if let Err(error) = materialize_source(
        source,
        &filesystem_product_apps_root(),
        &SYSTEM_PRODUCT_APP_BUNDLES,
        &staging,
    )
    .await
    {
        if staging.exists() {
            let _ = fs::remove_dir_all(&staging).await;
        }
        return Err(error);
    }

    let result = normalize_and_import_system_app(
        revision_store,
        &staging,
        Some((expected_app_id, expected_version)),
        shared_components,
    )
    .await;
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging).await;
    }
    result
}

async fn normalize_and_import_system_app(
    revision_store: &AppRevisionStore,
    staging: &Path,
    expected_identity: Option<(&str, &Version)>,
    shared_components: &[ComponentDefinition],
) -> CoreResult<ImportedSystemRelease> {
    let package = ProductAppResolver::read_product_app_package(staging).await?;
    let source_version = package.app.version;
    let prepared = prepare_draft_release(staging, &source_version, shared_components).await?;
    let app = prepared.app;
    let version = Version::parse(&app.version).map_err(|error| {
        CoreError::validation(format!(
            "Invalid bundled Intelligent App version {}: {error}",
            app.version
        ))
    })?;
    let app_id = app.id.clone();
    if let Some((expected_app_id, expected_version)) = expected_identity {
        if app_id != expected_app_id || version != *expected_version {
            return Err(CoreError::validation(format!(
                "Bundled Product App path identity {expected_app_id}@{expected_version} does not match manifest identity {app_id}@{version}"
            )));
        }
    }
    let slot_id = app.id.clone();
    let runtime = ReleaseRuntimeSpec::from_app(&app);
    let (_, sync_outcome, activation_outcome) = revision_store
        .sync_system_release_from_package(
            staging,
            ImportReleaseFromPackageRequest {
                app_id: app_id.clone(),
                slot_id: slot_id.clone(),
                display_name: app.name,
                description: Some(app.description),
                owner: AppOwner::system(),
                parent_release_id: None,
                metadata: ReleaseMetadata {
                    version: app.version,
                    component_lock_digest: prepared.component_lock_digest,
                    config_revision: prepared.config_revision,
                    data_schema_version: prepared.data_schema_version,
                    runtime_compatibility: prepared.runtime_compatibility,
                    capability_fingerprint: prepared.capability_fingerprint,
                    evaluation_report_digest: prepared.evaluation_report_digest,
                    runtime,
                    label: None,
                    notes: None,
                    provenance: ReleaseProvenanceKind::System,
                    signature: None,
                    upstream_app_id: None,
                    upstream_base_release_id: None,
                },
            },
        )
        .await?;

    Ok(ImportedSystemRelease {
        sync_outcome,
        activation_outcome,
    })
}

#[cfg(test)]
fn digest_bytes(domain: &[u8], bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update((bytes.len() as u64).to_le_bytes());
    hasher.update(bytes);
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

async fn digest_directory(root: &Path, domain: &[u8]) -> CoreResult<String> {
    if !root.is_dir() {
        return Err(CoreError::NotFound(format!(
            "System package directory {}",
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
                    "System packages must not contain symbolic links: {}",
                    path.display()
                )));
            }
            if metadata.is_dir() {
                pending.push(path);
            } else if metadata.is_file() {
                files.push(path);
            } else {
                return Err(CoreError::validation(format!(
                    "Unsupported system package entry: {}",
                    path.display()
                )));
            }
        }
    }
    files.sort();

    let mut hasher = Sha256::new();
    hasher.update(domain);
    for file in files {
        let relative = file.strip_prefix(root).map_err(|_| {
            CoreError::validation(format!(
                "System package file escaped its root: {}",
                file.display()
            ))
        })?;
        let relative = relative.to_string_lossy().replace('\\', "/");
        let bytes = fs::read(&file).await?;
        let bytes = canonical_system_package_bytes(&bytes);
        hasher.update((relative.len() as u64).to_le_bytes());
        hasher.update(relative.as_bytes());
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(bytes.as_ref());
    }
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

async fn materialize_source(
    relative: &Path,
    filesystem_root: &Path,
    embedded_root: &'static Dir<'static>,
    destination: &Path,
) -> CoreResult<()> {
    if destination.exists() {
        return Err(CoreError::validation(format!(
            "System package staging path already exists: {}",
            destination.display()
        )));
    }
    let filesystem_source = filesystem_root.join(relative);
    if filesystem_source.is_dir() {
        return copy_filesystem_tree(&filesystem_source, destination).await;
    }

    let normalized = relative.to_string_lossy().replace('\\', "/");
    let embedded_source = embedded_root.get_dir(normalized.as_str()).ok_or_else(|| {
        CoreError::NotFound(format!(
            "Bundled system package source {}",
            relative.display()
        ))
    })?;
    copy_embedded_tree(embedded_source, destination).await
}

async fn copy_filesystem_tree(source: &Path, destination: &Path) -> CoreResult<()> {
    fs::create_dir(destination).await?;
    let mut pending = vec![(source.to_path_buf(), destination.to_path_buf())];
    while let Some((source_dir, destination_dir)) = pending.pop() {
        let mut entries = fs::read_dir(&source_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let source_path = entry.path();
            let destination_path = destination_dir.join(entry.file_name());
            let metadata = fs::symlink_metadata(&source_path).await?;
            if metadata.file_type().is_symlink() {
                let _ = fs::remove_dir_all(destination).await;
                return Err(CoreError::validation(format!(
                    "Bundled system packages must not contain symbolic links: {}",
                    source_path.display()
                )));
            }
            if metadata.is_dir() {
                fs::create_dir(&destination_path).await?;
                pending.push((source_path, destination_path));
            } else if metadata.is_file() {
                let bytes = fs::read(&source_path).await?;
                fs::write(
                    &destination_path,
                    canonical_system_package_bytes(&bytes).as_ref(),
                )
                .await?;
                fs::set_permissions(&destination_path, metadata.permissions()).await?;
            } else {
                let _ = fs::remove_dir_all(destination).await;
                return Err(CoreError::validation(format!(
                    "Unsupported bundled system package entry: {}",
                    source_path.display()
                )));
            }
        }
    }
    Ok(())
}

async fn copy_embedded_tree(source: &'static Dir<'static>, destination: &Path) -> CoreResult<()> {
    fs::create_dir(destination).await?;
    let mut pending = vec![(source, destination.to_path_buf())];
    while let Some((source_dir, destination_dir)) = pending.pop() {
        for child in source_dir.dirs() {
            let name = child.path().file_name().ok_or_else(|| {
                CoreError::validation(format!(
                    "Embedded system package directory has no name: {}",
                    child.path().display()
                ))
            })?;
            let child_destination = destination_dir.join(name);
            fs::create_dir(&child_destination).await?;
            pending.push((child, child_destination));
        }
        for file in source_dir.files() {
            let name = file.path().file_name().ok_or_else(|| {
                CoreError::validation(format!(
                    "Embedded system package file has no name: {}",
                    file.path().display()
                ))
            })?;
            fs::write(
                destination_dir.join(name),
                canonical_system_package_bytes(file.contents()).as_ref(),
            )
            .await?;
        }
    }
    Ok(())
}

fn canonical_system_package_bytes(bytes: &[u8]) -> Cow<'_, [u8]> {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return Cow::Borrowed(bytes);
    };
    if !bytes.windows(2).any(|window| window == b"\r\n") {
        return Cow::Borrowed(bytes);
    }
    Cow::Owned(text.replace("\r\n", "\n").into_bytes())
}

fn collect_package_sources(
    embedded_root: &'static Dir<'static>,
    filesystem_root: &Path,
    marker: &str,
) -> Vec<PathBuf> {
    let mut sources = BTreeSet::new();
    collect_embedded_sources(embedded_root, embedded_root.path(), marker, &mut sources);
    collect_filesystem_sources(filesystem_root, filesystem_root, marker, &mut sources);
    sources.into_iter().collect()
}

fn collect_embedded_sources(
    directory: &'static Dir<'static>,
    root: &Path,
    marker: &str,
    sources: &mut BTreeSet<PathBuf>,
) {
    if directory.get_file(marker).is_some() {
        if let Ok(relative) = directory.path().strip_prefix(root) {
            sources.insert(relative.to_path_buf());
        }
    }
    for child in directory.dirs() {
        collect_embedded_sources(child, root, marker, sources);
    }
}

fn collect_filesystem_sources(
    directory: &Path,
    root: &Path,
    marker: &str,
    sources: &mut BTreeSet<PathBuf>,
) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    if directory.join(marker).is_file() {
        if let Ok(relative) = directory.strip_prefix(root) {
            sources.insert(relative.to_path_buf());
        }
    }
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_filesystem_sources(&path, root, marker, sources);
        }
    }
}

fn package_source_segments(
    source: &Path,
    expected_count: usize,
    package_kind: &str,
) -> CoreResult<Vec<String>> {
    let segments = source
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    if segments.len() != expected_count || segments.iter().any(|segment| segment.is_empty()) {
        return Err(CoreError::validation(format!(
            "Bundled {package_kind} must use the canonical package path, got {}",
            source.display()
        )));
    }
    Ok(segments)
}

fn filesystem_product_apps_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../bundles/product-apps")
}

fn filesystem_components_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../bundles/components")
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::super::catalog::{AppIconSpec, AppWorkMultiplicity};
    use super::super::revision_store::{
        ActivateReleaseRequest, AppActivationScope, ForkReleaseRequest, PublishDraftRequest,
    };
    use super::*;

    fn test_path_manager(temp: &TempDir) -> PathManager {
        PathManager::with_user_root_for_tests(temp.path().join("app-root"))
    }

    fn test_system_metadata(version: &str) -> ReleaseMetadata {
        let digest = |seed: &str| digest_bytes(b"system-app-retirement-test", seed.as_bytes());
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
                    label: "Test".to_string(),
                    seed: None,
                    background: None,
                },
                category: String::new(),
                tags: Vec::new(),
            },
            label: None,
            notes: None,
            provenance: ReleaseProvenanceKind::System,
            signature: None,
            upstream_app_id: None,
            upstream_base_release_id: None,
        }
    }

    #[test]
    fn canonical_system_package_bytes_normalizes_only_utf8_line_endings() {
        assert_eq!(
            canonical_system_package_bytes(b"line one\r\nline two\r\n").as_ref(),
            b"line one\nline two\n"
        );
        assert_eq!(
            canonical_system_package_bytes(b"line one\nline two\n").as_ref(),
            b"line one\nline two\n"
        );

        let binary = b"\xff\r\n\x00";
        assert_eq!(canonical_system_package_bytes(binary).as_ref(), binary);
    }

    #[tokio::test]
    async fn filesystem_line_endings_reuse_embedded_system_release() {
        let temp = TempDir::new().expect("temp dir");
        let store = AppRevisionStore::open(temp.path().join("store"))
            .await
            .expect("revision store");
        let relative = Path::new("app-builder/1.0.0");
        let missing_filesystem_root = temp.path().join("missing-bundles");

        let embedded_staging = temp.path().join("embedded-staging");
        materialize_source(
            relative,
            &missing_filesystem_root,
            &SYSTEM_PRODUCT_APP_BUNDLES,
            &embedded_staging,
        )
        .await
        .expect("embedded package");
        normalize_and_import_system_app(&store, &embedded_staging, None, &[])
            .await
            .expect("embedded release");

        let filesystem_root = temp.path().join("filesystem-bundles");
        let filesystem_source = filesystem_root.join(relative);
        fs::create_dir_all(filesystem_source.parent().expect("package parent"))
            .await
            .expect("filesystem package parent");
        materialize_source(
            relative,
            &missing_filesystem_root,
            &SYSTEM_PRODUCT_APP_BUNDLES,
            &filesystem_source,
        )
        .await
        .expect("filesystem source package");
        let compatibility_path = filesystem_source.join("compatibility.json");
        let compatibility = fs::read_to_string(&compatibility_path)
            .await
            .expect("compatibility manifest");
        fs::write(&compatibility_path, compatibility.replace('\n', "\r\n"))
            .await
            .expect("CRLF compatibility manifest");

        let filesystem_staging = temp.path().join("filesystem-staging");
        materialize_source(
            relative,
            &filesystem_root,
            &SYSTEM_PRODUCT_APP_BUNDLES,
            &filesystem_staging,
        )
        .await
        .expect("materialized filesystem package");
        let filesystem_release =
            normalize_and_import_system_app(&store, &filesystem_staging, None, &[])
                .await
                .expect("filesystem release");

        assert_eq!(
            filesystem_release.sync_outcome,
            SystemReleaseSyncOutcome::Reused
        );
        assert_eq!(store.list_releases(Some("app-builder")).await.len(), 1);
    }

    #[tokio::test]
    async fn package_identity_is_validated_before_system_release_commit() {
        let temp = TempDir::new().expect("temp dir");
        let store = AppRevisionStore::open(temp.path().join("store"))
            .await
            .expect("revision store");
        let staging = temp.path().join("identity-mismatch");
        materialize_source(
            Path::new("app-builder/1.0.0"),
            &temp.path().join("missing-bundles"),
            &SYSTEM_PRODUCT_APP_BUNDLES,
            &staging,
        )
        .await
        .expect("embedded package");
        let expected_version = Version::parse("1.0.0").expect("expected version");

        let error = normalize_and_import_system_app(
            &store,
            &staging,
            Some(("different-app", &expected_version)),
            &[],
        )
        .await
        .expect_err("path and manifest identity must match");

        assert!(error
            .to_string()
            .contains("does not match manifest identity"));
        assert!(store.list_apps().await.is_empty());
        assert!(store.list_releases(None).await.is_empty());
    }

    #[tokio::test]
    async fn system_seed_retires_apps_removed_from_bundles() {
        let temp = TempDir::new().expect("temp dir");
        let path_manager = test_path_manager(&temp);
        let store = AppRevisionStore::open(path_manager.app_root())
            .await
            .expect("revision store");
        let package = temp.path().join("retired-system-app");
        fs::create_dir_all(&package).await.expect("package");
        fs::write(package.join("app.json"), b"{}")
            .await
            .expect("package marker");
        let app_id = "system.removed-bundle-test";
        let slot_id = "system.removed-bundle-test";
        let request = || ImportReleaseFromPackageRequest {
            app_id: app_id.to_string(),
            slot_id: slot_id.to_string(),
            display_name: "Removed Bundle Test".to_string(),
            description: None,
            owner: AppOwner::system(),
            parent_release_id: None,
            metadata: test_system_metadata("1.0.0"),
        };
        store
            .sync_system_release_from_package(&package, request())
            .await
            .expect("legacy system app");
        assert!(store
            .get_active(&AppActivationScope::System, slot_id)
            .await
            .is_some());

        let seeded = seed_system_app_releases(&path_manager, &store)
            .await
            .expect("system seed");

        assert_eq!(seeded.apps_retired, 1);
        assert!(store.get_app(app_id).await.is_none());
        assert!(store.list_releases(Some(app_id)).await.is_empty());
        assert!(store
            .get_active(&AppActivationScope::System, slot_id)
            .await
            .is_none());

        store
            .sync_system_release_from_package(&package, request())
            .await
            .expect("reintroduced system app");
        assert!(store.get_app(app_id).await.is_some());
    }

    #[tokio::test]
    async fn system_seed_replaces_changed_bytes_at_the_same_version() {
        let temp = TempDir::new().expect("temp dir");
        let path_manager = test_path_manager(&temp);
        let store = AppRevisionStore::open(path_manager.app_root())
            .await
            .expect("revision store");
        let staging = temp.path().join("legacy-app-builder");
        materialize_source(
            Path::new("app-builder/1.0.0"),
            &temp.path().join("missing-bundles"),
            &SYSTEM_PRODUCT_APP_BUNDLES,
            &staging,
        )
        .await
        .expect("app builder package");
        fs::write(
            staging.join("legacy-build.txt"),
            b"different immutable bytes",
        )
        .await
        .expect("legacy marker");
        normalize_and_import_system_app(&store, &staging, None, &[])
            .await
            .expect("existing release");
        let existing_release_id = store
            .get_active(&AppActivationScope::System, "app-builder")
            .await
            .expect("existing activation")
            .active_release_id;

        let seeded = seed_system_app_releases(&path_manager, &store)
            .await
            .expect("system development snapshot");

        assert!(seeded.issues.is_empty());
        assert!(seeded.releases_replaced >= 1);
        assert!(store
            .resolve_release("app-builder", &existing_release_id)
            .await
            .is_err());
        let activation = store
            .get_active(&AppActivationScope::System, "app-builder")
            .await
            .expect("replacement activation");
        assert_ne!(activation.active_release_id, existing_release_id);
        assert_eq!(store.list_releases(Some("app-builder")).await.len(), 1);
    }

    #[tokio::test]
    async fn read_only_component_listing_does_not_create_storage() {
        let temp = TempDir::new().expect("temp dir");
        let path_manager = test_path_manager(&temp);

        let components = list_system_shared_components(&path_manager)
            .await
            .expect("empty component list");

        assert!(components.is_empty());
        assert!(!path_manager.system_components_dir().exists());
    }

    #[tokio::test]
    async fn staging_cleanup_only_removes_strict_system_seed_directories() {
        let temp = TempDir::new().expect("temp dir");
        let root = temp.path().join("store");
        let staging = root.join(".system-seed-0123456789abcdef0123456789abcdef");
        let lookalike = root.join(".system-seed");
        let formal = root.join("artifacts");
        fs::create_dir_all(staging.join("nested"))
            .await
            .expect("staging");
        fs::create_dir(&lookalike).await.expect("lookalike");
        fs::create_dir(&formal).await.expect("formal directory");

        cleanup_system_seed_staging_directories(&root)
            .await
            .expect("cleanup");

        assert!(!staging.exists());
        assert!(lookalike.is_dir());
        assert!(formal.is_dir());
    }

    #[tokio::test]
    async fn staging_cleanup_rejects_a_non_directory_seed_entry() {
        let temp = TempDir::new().expect("temp dir");
        let root = temp.path().join("store");
        fs::create_dir(&root).await.expect("store root");
        let staging = root.join(".system-seed-0123456789abcdef0123456789abcdef");
        fs::write(&staging, b"not a staging directory")
            .await
            .expect("seed lookalike file");

        let error = cleanup_system_seed_staging_directories(&root)
            .await
            .expect_err("non-directory must be rejected");

        assert!(error.to_string().contains("not a real directory"));
        assert!(staging.is_file());
    }

    #[tokio::test]
    async fn component_versions_are_immutable() {
        let temp = TempDir::new().expect("temp dir");
        let path_manager = test_path_manager(&temp);
        let abandoned_staging = path_manager
            .system_components_dir()
            .join(".system-seed-abandoned");
        fs::create_dir_all(&abandoned_staging)
            .await
            .expect("abandoned staging");
        fs::write(abandoned_staging.join("sentinel"), b"stale")
            .await
            .expect("staging sentinel");
        let (added, _) = seed_system_shared_components(&path_manager)
            .await
            .expect("initial component seed");
        assert!(added > 0);
        assert!(!abandoned_staging.exists());

        let component = list_system_shared_components(&path_manager)
            .await
            .expect("seeded components")
            .into_iter()
            .next()
            .expect("bundled component");
        let manifest = path_manager
            .system_component_version_dir(
                component.kind.path_segment(),
                &component.id,
                component
                    .version
                    .as_deref()
                    .expect("shared component version"),
            )
            .join(COMPONENT_JSON);
        let mut changed = fs::read(&manifest).await.expect("component manifest");
        changed.extend_from_slice(b"\n");
        fs::write(&manifest, &changed)
            .await
            .expect("change installed bytes");

        let error = seed_system_shared_components(&path_manager)
            .await
            .expect_err("same component version must not be replaced");
        assert!(error.to_string().contains("version collision"));
        assert_eq!(
            fs::read(&manifest).await.expect("preserved manifest"),
            changed
        );
    }

    #[tokio::test]
    async fn system_seed_reports_failures_and_continues_product_apps() {
        let temp = TempDir::new().expect("temp dir");
        let path_manager = test_path_manager(&temp);
        let store = AppRevisionStore::open(path_manager.app_root())
            .await
            .expect("revision store");
        let initial = seed_system_app_releases(&path_manager, &store)
            .await
            .expect("initial seed");
        assert!(initial.issues.is_empty());

        let component = list_system_shared_components(&path_manager)
            .await
            .expect("seeded components")
            .into_iter()
            .next()
            .expect("bundled component");
        let manifest = path_manager
            .system_component_version_dir(
                component.kind.path_segment(),
                &component.id,
                component
                    .version
                    .as_deref()
                    .expect("shared component version"),
            )
            .join(COMPONENT_JSON);
        let mut changed = fs::read(&manifest).await.expect("component manifest");
        changed.extend_from_slice(b"\n");
        fs::write(&manifest, changed)
            .await
            .expect("change installed bytes");
        fs::write(
            store.storage_root().join(".system-seed-blocked"),
            b"unexpected file",
        )
        .await
        .expect("blocked staging entry");

        let report = seed_system_app_releases(&path_manager, &store)
            .await
            .expect("synchronization failures are reported issues");

        assert!(report
            .issues
            .iter()
            .any(|issue| issue.source == "shared-components"));
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.source == "staging-cleanup"));
        assert!(store.get_app("app-builder").await.is_some());
        assert!(report.releases_reused + report.releases_replaced > 0);
    }

    #[tokio::test]
    async fn system_seed_replaces_old_official_release_and_preserves_user_selection() {
        let temp = TempDir::new().expect("temp dir");
        let path_manager = test_path_manager(&temp);
        let store = AppRevisionStore::open(path_manager.app_root())
            .await
            .expect("revision store");

        let initial = seed_system_app_releases(&path_manager, &store)
            .await
            .expect("initial system seed");
        assert!(initial.releases_added >= 2);
        assert!(store.get_app("runno").await.is_some());
        assert!(store.get_app("app-builder").await.is_some());
        let bundled_activation = store
            .get_active(&AppActivationScope::System, "runno")
            .await
            .expect("bundled activation");
        let official_release = store
            .resolve_release("runno", &bundled_activation.active_release_id)
            .await
            .expect("official release")
            .release;
        let legacy_package = temp.path().join("legacy-runno");
        fs::create_dir(&legacy_package)
            .await
            .expect("legacy package");
        fs::write(legacy_package.join("release.txt"), b"legacy")
            .await
            .expect("legacy artifact");
        let legacy_release = store
            .import_release_from_package(
                &legacy_package,
                ImportReleaseFromPackageRequest {
                    app_id: "runno".to_string(),
                    slot_id: "runno".to_string(),
                    display_name: "Runno".to_string(),
                    description: Some("Legacy official release".to_string()),
                    owner: AppOwner::system(),
                    parent_release_id: None,
                    metadata: ReleaseMetadata {
                        version: "0.1.0".to_string(),
                        component_lock_digest: official_release.component_lock_digest.clone(),
                        config_revision: digest_bytes(b"test-config", b"legacy"),
                        data_schema_version: official_release.data_schema_version.clone(),
                        runtime_compatibility: official_release.runtime_compatibility.clone(),
                        capability_fingerprint: official_release.capability_fingerprint.clone(),
                        evaluation_report_digest: official_release.evaluation_report_digest.clone(),
                        runtime: official_release.runtime.clone(),
                        label: None,
                        notes: None,
                        provenance: ReleaseProvenanceKind::System,
                        signature: None,
                        upstream_app_id: None,
                        upstream_base_release_id: None,
                    },
                },
            )
            .await
            .expect("legacy release");
        store
            .activate(ActivateReleaseRequest {
                scope: AppActivationScope::System,
                slot_id: "runno".to_string(),
                app_id: "runno".to_string(),
                release_id: legacy_release.release_id.clone(),
            })
            .await
            .expect("legacy activation");

        let first = seed_system_app_releases(&path_manager, &store)
            .await
            .expect("seed after older official selection");
        let official_activation = store
            .get_active(&AppActivationScope::System, "runno")
            .await
            .expect("updated official activation");
        assert_eq!(
            official_activation.active_release_id,
            official_release.release_id
        );
        assert!(store
            .resolve_release("runno", &legacy_release.release_id)
            .await
            .is_err());
        assert!(first.activations_created >= 1);
        let fork = store
            .fork_release(ForkReleaseRequest {
                source_release_id: official_release.release_id.clone(),
                new_app_id: Some("user-runno".to_string()),
                slot_id: Some("runno".to_string()),
                display_name: Some("My Runno".to_string()),
                description: None,
                owner: AppOwner::user("local-user"),
            })
            .await
            .expect("fork official release");
        let draft = store
            .resolve_draft(&fork.draft.draft_id)
            .await
            .expect("fork draft");
        fs::write(draft.source_path.join("user-change.txt"), b"user owned")
            .await
            .expect("edit fork");
        let shared_components = list_system_shared_components(&path_manager)
            .await
            .expect("seeded shared components");
        let fork_release = store
            .publish_draft(
                PublishDraftRequest {
                    draft_id: fork.draft.draft_id,
                    version: "1.0.1".to_string(),
                    label: None,
                    notes: None,
                    provenance: ReleaseProvenanceKind::User,
                },
                &shared_components,
            )
            .await
            .expect("publish fork");
        store
            .activate(ActivateReleaseRequest {
                scope: AppActivationScope::System,
                slot_id: "runno".to_string(),
                app_id: fork.app.app_id.clone(),
                release_id: fork_release.release_id.clone(),
            })
            .await
            .expect("select user fork");

        let second = seed_system_app_releases(&path_manager, &store)
            .await
            .expect("seed with selected fork");
        let selected_fork = store
            .get_active(&AppActivationScope::System, "runno")
            .await
            .expect("preserved fork activation");
        assert_eq!(selected_fork.selected_app_id, fork.app.app_id);
        assert_eq!(selected_fork.active_release_id, fork_release.release_id);
        assert!(selected_fork.enabled);
        assert_eq!(second.releases_added, 0);
        assert!(second.activations_preserved >= 1);

        store
            .deactivate(&AppActivationScope::System, "runno")
            .await
            .expect("user disables fork slot");
        let third = seed_system_app_releases(&path_manager, &store)
            .await
            .expect("seed with disabled fork");
        let runno = store
            .get_active(&AppActivationScope::System, "runno")
            .await
            .expect("preserved activation");
        assert!(!runno.enabled, "seed must preserve user routing decisions");
        assert_eq!(runno.selected_app_id, fork.app.app_id);
        assert!(third.activations_preserved >= 1);
    }
}
