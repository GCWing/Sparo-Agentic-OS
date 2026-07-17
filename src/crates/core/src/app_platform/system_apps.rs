//! System Intelligent App release seeding.
//!
//! Bundled Product Apps are release inputs, never mutable installations. Seeding
//! resolves each package into an immutable release. Startup initializes an
//! empty slot from the newest bundled release, but never changes an existing
//! selection. Newer bundled releases remain available until the user updates.

use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use include_dir::Dir;
use semver::Version;
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
    ActivateReleaseRequest, AppActivationScope, AppOwner, AppRevisionStore,
    ImportReleaseFromPackageRequest, ReleaseMetadata, ReleaseProvenanceKind, ReleaseRecord,
    ReleaseRuntimeSpec, SystemReleaseInitializationOutcome,
};

const APP_JSON: &str = "app.json";
const COMPONENT_JSON: &str = "component.json";
const COMPONENT_DIGEST_DOMAIN: &[u8] = b"sparo-system-component-v1\0";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SystemAppSeedResult {
    pub components_added: usize,
    pub components_reused: usize,
    pub releases_added: usize,
    pub releases_reused: usize,
    pub activations_created: usize,
    pub activations_preserved: usize,
}

#[derive(Debug, Clone)]
struct ImportedSystemRelease {
    app_id: String,
    slot_id: String,
    version: Version,
    release_id: String,
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

// Startup is a release consumer, not a publisher. Once a valid system Release
// owns an app/version identity, preserve it even when a development filesystem
// bundle has drifted. Direct imports still reject changed bytes at the same
// version, so authors must publish the bundle under a new version.
async fn reusable_system_release(
    revision_store: &AppRevisionStore,
    existing_releases: &[ReleaseRecord],
    source_identity: &[String],
) -> CoreResult<Option<ImportedSystemRelease>> {
    let app_id = &source_identity[0];
    let version_text = &source_identity[1];
    let Some(release) = existing_releases
        .iter()
        .filter(|release| {
            release.provenance == ReleaseProvenanceKind::System
                && release.app_id.as_str() == app_id.as_str()
                && release.slot_id.as_str() == app_id.as_str()
                && release.version.as_str() == version_text.as_str()
        })
        .max_by(|left, right| left.release_id.cmp(&right.release_id))
    else {
        return Ok(None);
    };
    if !reusable_release_artifact(revision_store.storage_root(), release).await? {
        return Ok(None);
    }
    let version = Version::parse(version_text).map_err(|error| {
        CoreError::validation(format!(
            "Invalid bundled Intelligent App version {version_text}: {error}"
        ))
    })?;
    Ok(Some(ImportedSystemRelease {
        app_id: release.app_id.clone(),
        slot_id: release.slot_id.clone(),
        version,
        release_id: release.release_id.clone(),
    }))
}

async fn reusable_release_artifact(
    revision_store_root: &Path,
    release: &ReleaseRecord,
) -> CoreResult<bool> {
    let Some(digest) = release.artifact_digest.strip_prefix("sha256:") else {
        return Err(CoreError::validation(format!(
            "System Release {} has an invalid artifact digest",
            release.release_id
        )));
    };
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(CoreError::validation(format!(
            "System Release {} has an invalid artifact digest",
            release.release_id
        )));
    }
    let artifact = revision_store_root.join("artifacts").join(digest);
    let metadata = match fs::symlink_metadata(&artifact).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(CoreError::validation(format!(
            "System Release artifact path is not an immutable directory: {}",
            artifact.display()
        )));
    }
    Ok(true)
}

/// Imports bundled shared components and Product Apps without mutating an
/// existing release or user-owned routing decision.
///
/// All releases are imported before empty slots are initialized or untouched
/// official selections are advanced. A malformed bundle can therefore leave
/// new immutable artifacts available for a retry, but cannot partially change
/// runtime routing.
pub async fn seed_system_app_releases(
    path_manager: &PathManager,
    revision_store: &AppRevisionStore,
) -> CoreResult<SystemAppSeedResult> {
    cleanup_system_seed_staging_directories(revision_store.storage_root()).await?;
    let (components_added, components_reused) = seed_system_shared_components(path_manager).await?;
    let existing_releases = revision_store.list_releases(None).await;
    let existing_release_ids = existing_releases
        .iter()
        .map(|release| release.release_id.clone())
        .collect::<BTreeSet<_>>();
    let filesystem_root = filesystem_product_apps_root();
    let mut shared_components = None;

    let mut imported = Vec::new();
    let mut releases_added = 0;
    let mut releases_reused = 0;
    for source in collect_package_sources(&SYSTEM_PRODUCT_APP_BUNDLES, &filesystem_root, APP_JSON) {
        let source_identity = package_source_segments(&source, 2, "Product App")?;
        let release = if let Some(release) =
            reusable_system_release(revision_store, &existing_releases, &source_identity).await?
        {
            release
        } else {
            let components = load_shared_components(&mut shared_components, path_manager).await?;
            import_system_app_release(revision_store, &source, components).await?
        };
        if release.app_id != source_identity[0] || release.version.to_string() != source_identity[1]
        {
            return Err(CoreError::validation(format!(
                "Bundled Product App path {} does not match manifest identity {}@{}",
                source.display(),
                release.app_id,
                release.version
            )));
        }
        if existing_release_ids.contains(&release.release_id) {
            releases_reused += 1;
        } else {
            releases_added += 1;
        }
        imported.push(release);
    }

    let mut newest_by_slot = BTreeMap::<String, ImportedSystemRelease>::new();
    for release in imported {
        let replace = newest_by_slot.get(&release.slot_id).is_none_or(|current| {
            release.version > current.version
                || (release.version == current.version && release.release_id > current.release_id)
        });
        if replace {
            newest_by_slot.insert(release.slot_id.clone(), release);
        }
    }

    let scope = AppActivationScope::System;
    let mut activations_created = 0;
    let mut activations_preserved = 0;
    for release in newest_by_slot.into_values() {
        let (_, outcome) = revision_store
            .initialize_system_release(ActivateReleaseRequest {
                scope: scope.clone(),
                slot_id: release.slot_id,
                app_id: release.app_id,
                release_id: release.release_id,
            })
            .await?;
        match outcome {
            SystemReleaseInitializationOutcome::Created => activations_created += 1,
            SystemReleaseInitializationOutcome::Preserved => activations_preserved += 1,
        }
    }

    Ok(SystemAppSeedResult {
        components_added,
        components_reused,
        releases_added,
        releases_reused,
        activations_created,
        activations_preserved,
    })
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
        let filesystem_source_present =
            filesystem_package_source_exists(&filesystem_root.join(&source)).await?;
        let destination = path_manager.system_component_version_dir(
            &source_identity[0],
            &source_identity[1],
            &source_identity[2],
        );
        if !filesystem_source_present && reusable_embedded_component(&destination).await? {
            reused += 1;
            continue;
        }
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

async fn filesystem_package_source_exists(source: &Path) -> CoreResult<bool> {
    let metadata = match fs::symlink_metadata(source).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink() {
        return Err(CoreError::validation(format!(
            "Filesystem system package source must not be a symbolic link: {}",
            source.display()
        )));
    }
    if !metadata.is_dir() {
        return Err(CoreError::validation(format!(
            "Filesystem system package source must be a directory: {}",
            source.display()
        )));
    }
    Ok(true)
}

async fn reusable_embedded_component(destination: &Path) -> CoreResult<bool> {
    let metadata = match fs::symlink_metadata(destination).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(CoreError::validation(format!(
            "Immutable system component path is not a directory: {}",
            destination.display()
        )));
    }
    let marker = destination.join(COMPONENT_JSON);
    let marker_metadata = match fs::symlink_metadata(&marker).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    if marker_metadata.file_type().is_symlink() || !marker_metadata.is_file() {
        return Err(CoreError::validation(format!(
            "Immutable system component marker is not a regular file: {}",
            marker.display()
        )));
    }
    fs::read(&marker).await?;
    Ok(true)
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

    let result = normalize_and_import_system_app(revision_store, &staging, shared_components).await;
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging).await;
    }
    result
}

async fn normalize_and_import_system_app(
    revision_store: &AppRevisionStore,
    staging: &Path,
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
    let slot_id = app.id.clone();
    let runtime = ReleaseRuntimeSpec::from_app(&app);
    let release = revision_store
        .import_release_from_package(
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
        app_id,
        slot_id,
        version,
        release_id: release.release_id,
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

    use super::super::revision_store::{ForkReleaseRequest, PublishDraftRequest};
    use super::*;

    fn test_path_manager(temp: &TempDir) -> PathManager {
        PathManager::with_user_root_for_tests(temp.path().join("app-root"))
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
        let embedded_release = normalize_and_import_system_app(&store, &embedded_staging, &[])
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
        let filesystem_release = normalize_and_import_system_app(&store, &filesystem_staging, &[])
            .await
            .expect("filesystem release");

        assert_eq!(filesystem_release.release_id, embedded_release.release_id);
        assert_eq!(store.list_releases(Some("app-builder")).await.len(), 1);
    }

    #[tokio::test]
    async fn system_seed_preserves_existing_same_version_release() {
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
        let existing = normalize_and_import_system_app(&store, &staging, &[])
            .await
            .expect("existing release");

        let seeded = seed_system_app_releases(&path_manager, &store)
            .await
            .expect("system seed");
        let activation = store
            .get_active(&AppActivationScope::System, "app-builder")
            .await
            .expect("app builder activation");

        assert_eq!(activation.active_release_id, existing.release_id);
        assert!(seeded.releases_reused >= 1);
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
    async fn embedded_component_fast_path_requires_a_readable_regular_marker() {
        let temp = TempDir::new().expect("temp dir");
        let destination = temp.path().join("component");
        fs::create_dir(&destination).await.expect("component dir");

        assert!(!reusable_embedded_component(&destination)
            .await
            .expect("missing marker is not reusable"));
        fs::write(destination.join(COMPONENT_JSON), b"{}")
            .await
            .expect("component marker");
        assert!(reusable_embedded_component(&destination)
            .await
            .expect("readable marker is reusable"));
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
    async fn system_seed_exposes_new_official_release_but_preserves_existing_selection() {
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
        let fast_path_release = reusable_system_release(
            &store,
            &store.list_releases(None).await,
            &[
                official_release.app_id.clone(),
                official_release.version.clone(),
            ],
        )
        .await
        .expect("embedded release fast path")
        .expect("reusable system release");
        assert_eq!(fast_path_release.release_id, official_release.release_id);

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
            .expect("preserved official activation");
        assert_eq!(
            official_activation.active_release_id,
            legacy_release.release_id
        );
        assert_eq!(
            official_activation.previous_release_id.as_deref(),
            Some(official_release.release_id.as_str())
        );
        assert!(first.activations_preserved >= 1);
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
