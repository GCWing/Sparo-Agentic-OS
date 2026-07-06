//! Product App package versioning artifacts.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::fs;

use crate::error::{CoreError, CoreResult};

use super::catalog::{
    stable_digest, AppComponentRef, AppDefinition, ComponentDefinition, ComponentKind,
    ComponentOwnerApp, ComponentPackageSource, ComponentSource,
};
use super::resolver::ProductAppResolver;

pub const PRODUCT_APP_CHECKPOINT_SCHEMA_VERSION: u32 = 1;
pub const PRODUCT_APP_RELEASE_SCHEMA_VERSION: u32 = 1;
pub const PRODUCT_APP_RELEASE_CATALOG_SOURCE_SCHEMA_VERSION: u32 = 1;
pub const PRODUCT_APP_RELEASE_CATALOG_SOURCE_FILE: &str = "release-source.json";
pub const PRODUCT_APP_RELEASE_READINESS_REQUIRED_CHECK_IDS: &[&str] = &[
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
];

#[derive(Debug, Clone)]
pub struct CreateProductAppCheckpointRequest {
    pub package_dir: PathBuf,
    pub shared_components: Vec<ComponentDefinition>,
    pub label: Option<String>,
    pub summary: Option<String>,
    pub created_by: Option<String>,
    pub created_at_ms: u64,
}

#[derive(Debug, Clone)]
pub struct RestoreProductAppCheckpointRequest {
    pub package_dir: PathBuf,
    pub shared_components: Vec<ComponentDefinition>,
    pub checkpoint_id: String,
    pub confirm: bool,
}

#[derive(Debug, Clone)]
pub struct RestoreProductAppReleaseRequest {
    pub package_dir: PathBuf,
    pub shared_components: Vec<ComponentDefinition>,
    pub release_id: String,
    pub confirm: bool,
}

#[derive(Debug, Clone)]
pub struct CreateProductAppFromReleaseTemplateRequest {
    pub source_package_dir: PathBuf,
    pub target_package_dir: PathBuf,
    pub shared_components: Vec<ComponentDefinition>,
    pub release_id: String,
    pub new_app_id: String,
    pub new_name: String,
    pub new_version: String,
    pub new_description: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CompareProductAppRevisionsRequest {
    pub package_dir: PathBuf,
    pub base: ProductAppRevisionRef,
    pub target: ProductAppRevisionRef,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProductAppRevisionRef {
    CurrentPackage,
    Checkpoint(String),
    Release(String),
}

#[derive(Debug, Clone)]
pub struct CreateProductAppReleaseRequest {
    pub package_dir: PathBuf,
    pub shared_components: Vec<ComponentDefinition>,
    pub readiness: ProductAppReleaseReadinessSnapshot,
    pub label: Option<String>,
    pub notes: Option<String>,
    pub created_by: Option<String>,
    pub created_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenProductAppCheckpoint {
    pub checkpoint_id: String,
    pub app_id: String,
    pub version: String,
    pub component_lock_digest: String,
    pub package_digest: String,
    pub manifest_path: PathBuf,
    pub artifact_uri: String,
    pub file_count: usize,
    pub checkpoint_count: usize,
    pub created_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredProductAppCheckpoint {
    pub checkpoint_id: String,
    pub app_id: String,
    pub version: String,
    pub component_lock_digest: String,
    pub package_digest: String,
    pub manifest_path: PathBuf,
    pub restored_files: usize,
    pub removed_files: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredProductAppRelease {
    pub release_id: String,
    pub app_id: String,
    pub version: String,
    pub component_lock_digest: String,
    pub package_digest: String,
    pub manifest_path: PathBuf,
    pub restored_files: usize,
    pub removed_files: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenProductAppRelease {
    pub release_id: String,
    pub app_id: String,
    pub version: String,
    pub component_lock_digest: String,
    pub package_digest: String,
    pub manifest_path: PathBuf,
    pub artifact_uri: String,
    pub file_count: usize,
    pub release_count: usize,
    pub created_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenProductAppFromReleaseTemplate {
    pub source_release_id: String,
    pub source_app_id: String,
    pub source_version: String,
    pub app_id: String,
    pub version: String,
    pub name: String,
    pub component_lock_digest: String,
    pub package_digest: String,
    pub package_dir: PathBuf,
    pub file_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRevisionComparison {
    pub base: ProductAppRevisionDescriptor,
    pub target: ProductAppRevisionDescriptor,
    pub changes: Vec<ProductAppRevisionFileChange>,
    pub changed_count: usize,
    pub unchanged_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRevisionDescriptor {
    pub kind: ProductAppRevisionKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_id: Option<String>,
    pub app_id: String,
    pub version: String,
    pub component_lock_digest: String,
    pub package_digest: String,
    pub file_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProductAppRevisionKind {
    Checkpoint,
    Release,
    CurrentPackage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRevisionFileChange {
    pub path: String,
    pub change: ProductAppRevisionChangeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_sha256: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProductAppRevisionChangeKind {
    Added,
    Removed,
    Modified,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppCheckpointManifest {
    pub schema_version: u32,
    pub checkpoint_id: String,
    pub app_id: String,
    pub app_version: String,
    pub component_lock_digest: String,
    pub package_digest: String,
    pub created_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub content_root: String,
    pub package_files: Vec<ProductAppCheckpointFile>,
    pub readiness: ProductAppCheckpointReadinessSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppReleaseManifest {
    pub schema_version: u32,
    pub release_id: String,
    pub app_id: String,
    pub app_version: String,
    pub component_lock_digest: String,
    pub package_digest: String,
    pub created_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub content_root: String,
    pub package_files: Vec<ProductAppCheckpointFile>,
    pub readiness: ProductAppReleaseReadinessSnapshot,
    pub share: ProductAppReleaseShareSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppReleaseReadinessSnapshot {
    pub work_id: String,
    pub preview_result_id: String,
    pub status: String,
    pub observed_at: i64,
    pub checks: Vec<ProductAppReleaseCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppReleaseCheck {
    pub id: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppReleaseShareSnapshot {
    pub includes_package_source: bool,
    pub includes_default_configuration: bool,
    pub excludes_work_history: bool,
    pub excludes_runtime_storage: bool,
    pub excludes_user_private_data: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppReleaseCatalogSourceManifest {
    pub schema_version: u32,
    pub release_id: String,
    pub artifact_uri: String,
    pub app_id: String,
    pub app_version: String,
    pub component_lock_digest: String,
    pub package_digest: String,
    pub published_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppCheckpointFile {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppCheckpointReadinessSnapshot {
    pub component_lock_verified: bool,
    pub release_status: String,
    pub detail: String,
}

pub async fn create_product_app_checkpoint(
    request: CreateProductAppCheckpointRequest,
) -> CoreResult<WrittenProductAppCheckpoint> {
    let package_dir = request.package_dir;
    if !package_dir.is_dir() {
        return Err(CoreError::validation(format!(
            "Product App package directory does not exist: {}",
            package_dir.display()
        )));
    }

    let package = ProductAppResolver::read_product_app_package(&package_dir).await?;
    let app_id = package.app.id.clone();
    let version = package.app.version.clone();
    let declared_lock_digest = package.app.component_lock_id.clone();
    let resolved = ProductAppResolver::resolve_package_install(package, request.shared_components)?;
    let resolved_lock_digest = resolved.lock.digest();
    let file_lock = ProductAppResolver::read_lock(&package_dir).await?;
    let file_lock_digest = file_lock.digest();

    if declared_lock_digest != resolved_lock_digest || file_lock_digest != resolved_lock_digest {
        return Err(CoreError::validation(format!(
            "Product App checkpoint requires a current component lock. declared={}, file={}, resolved={}",
            declared_lock_digest, file_lock_digest, resolved_lock_digest
        )));
    }

    let package_files = collect_package_files(&package_dir).await?;
    if package_files.is_empty() {
        return Err(CoreError::validation(format!(
            "Product App package has no checkpointable files: {}",
            package_dir.display()
        )));
    }
    let package_file_manifest = package_files
        .iter()
        .map(|file| file.metadata.clone())
        .collect::<Vec<_>>();
    let package_digest = stable_digest(&package_file_manifest);
    let checkpoint_id =
        build_checkpoint_id(&app_id, &version, request.created_at_ms, &package_digest);
    let checkpoint_dir = package_dir.join("checkpoints").join(&checkpoint_id);
    let manifest_path = checkpoint_dir.join("checkpoint.json");
    let artifact_uri = format!("product-app://{app_id}@{version}/checkpoints/{checkpoint_id}");
    let file_count = package_files.len();

    let manifest = ProductAppCheckpointManifest {
        schema_version: PRODUCT_APP_CHECKPOINT_SCHEMA_VERSION,
        checkpoint_id: checkpoint_id.clone(),
        app_id: app_id.clone(),
        app_version: version.clone(),
        component_lock_digest: resolved_lock_digest.clone(),
        package_digest: package_digest.clone(),
        created_at_ms: request.created_at_ms,
        created_by: request.created_by,
        label: request.label,
        summary: request.summary,
        content_root: "files".to_string(),
        package_files: package_file_manifest,
        readiness: ProductAppCheckpointReadinessSnapshot {
            component_lock_verified: true,
            release_status: "notReleased".to_string(),
            detail: "Checkpoint captures the package source and current component lock; it is not a release artifact.".to_string(),
        },
    };

    fs::create_dir_all(&checkpoint_dir).await?;
    write_snapshot_contents(&checkpoint_dir, &package_files).await?;
    let bytes = serde_json::to_vec_pretty(&manifest)?;
    fs::write(&manifest_path, bytes).await?;
    let checkpoint_count = count_checkpoint_manifests(&package_dir).await?;

    Ok(WrittenProductAppCheckpoint {
        checkpoint_id,
        app_id,
        version,
        component_lock_digest: resolved_lock_digest,
        package_digest,
        manifest_path,
        artifact_uri,
        file_count,
        checkpoint_count,
        created_at_ms: request.created_at_ms,
    })
}

pub async fn restore_product_app_checkpoint(
    request: RestoreProductAppCheckpointRequest,
) -> CoreResult<RestoredProductAppCheckpoint> {
    if !request.confirm {
        return Err(CoreError::validation(
            "RestoreProductAppCheckpoint requires confirm=true because it overwrites package files"
                .to_string(),
        ));
    }

    let checkpoint = read_checkpoint_manifest(&request.package_dir, &request.checkpoint_id).await?;
    let content_root = checkpoint_content_root(&request.package_dir, &checkpoint)?;
    let (restored_files, removed_files) = restore_package_snapshot(
        &request.package_dir,
        &checkpoint.package_files,
        &content_root,
        "Checkpoint",
    )
    .await?;

    verify_restored_checkpoint_lock(
        &request.package_dir,
        &request.shared_components,
        &checkpoint,
    )
    .await?;
    let manifest_path = checkpoint_manifest_path(&request.package_dir, &request.checkpoint_id)?;

    Ok(RestoredProductAppCheckpoint {
        checkpoint_id: checkpoint.checkpoint_id,
        app_id: checkpoint.app_id,
        version: checkpoint.app_version,
        component_lock_digest: checkpoint.component_lock_digest,
        package_digest: checkpoint.package_digest,
        manifest_path,
        restored_files,
        removed_files,
    })
}

pub async fn restore_product_app_release(
    request: RestoreProductAppReleaseRequest,
) -> CoreResult<RestoredProductAppRelease> {
    if !request.confirm {
        return Err(CoreError::validation(
            "RestoreProductAppRelease requires confirm=true because it overwrites package files"
                .to_string(),
        ));
    }

    let release = read_release_manifest(&request.package_dir, &request.release_id).await?;
    let content_root = release_content_root(&request.package_dir, &release)?;
    let (restored_files, removed_files) = restore_package_snapshot(
        &request.package_dir,
        &release.package_files,
        &content_root,
        "Release",
    )
    .await?;

    verify_restored_release_lock(&request.package_dir, &request.shared_components, &release)
        .await?;
    let manifest_path = release_manifest_path(&request.package_dir, &request.release_id)?;

    Ok(RestoredProductAppRelease {
        release_id: release.release_id,
        app_id: release.app_id,
        version: release.app_version,
        component_lock_digest: release.component_lock_digest,
        package_digest: release.package_digest,
        manifest_path,
        restored_files,
        removed_files,
    })
}

pub async fn create_product_app_from_release_template(
    request: CreateProductAppFromReleaseTemplateRequest,
) -> CoreResult<WrittenProductAppFromReleaseTemplate> {
    validate_package_id("new_app_id", &request.new_app_id)?;
    validate_required("new_name", &request.new_name)?;
    validate_required("new_version", &request.new_version)?;
    if request.target_package_dir.exists() {
        return Err(CoreError::validation(format!(
            "Target Product App package already exists: {}",
            request.target_package_dir.display()
        )));
    }

    let release = read_release_manifest(&request.source_package_dir, &request.release_id).await?;
    let content_root = release_content_root(&request.source_package_dir, &release)?;
    copy_release_snapshot_to_target(
        &request.target_package_dir,
        &content_root,
        &release.package_files,
    )
    .await?;
    rebase_template_package_identity(
        &request.target_package_dir,
        &release,
        &request.new_app_id,
        &request.new_name,
        &request.new_version,
        request.new_description.as_deref(),
    )
    .await?;

    let package = ProductAppResolver::read_product_app_package(&request.target_package_dir).await?;
    let resolved = ProductAppResolver::resolve_package_install(package, request.shared_components)?;
    write_app_definition(&request.target_package_dir, &resolved.app).await?;
    ProductAppResolver::write_lock(&request.target_package_dir, &resolved.lock).await?;
    let package_digest = current_product_app_package_digest(&request.target_package_dir).await?;
    let file_count = collect_package_files(&request.target_package_dir)
        .await?
        .len();

    Ok(WrittenProductAppFromReleaseTemplate {
        source_release_id: release.release_id,
        source_app_id: release.app_id,
        source_version: release.app_version,
        app_id: resolved.app.id,
        version: resolved.app.version,
        name: resolved.app.name,
        component_lock_digest: resolved.lock.digest(),
        package_digest,
        package_dir: request.target_package_dir,
        file_count,
    })
}

pub async fn compare_product_app_revisions(
    request: CompareProductAppRevisionsRequest,
) -> CoreResult<ProductAppRevisionComparison> {
    let (base, base_files) = revision_from_ref(&request.package_dir, request.base).await?;
    let (target, target_files) = revision_from_ref(&request.package_dir, request.target).await?;

    let paths = base_files
        .keys()
        .chain(target_files.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut changes = Vec::new();
    let mut unchanged_count = 0;
    for path in paths {
        let base_file = base_files.get(&path);
        let target_file = target_files.get(&path);
        match (base_file, target_file) {
            (Some(base_file), Some(target_file)) if base_file.sha256 == target_file.sha256 => {
                unchanged_count += 1;
            }
            (Some(base_file), Some(target_file)) => {
                changes.push(ProductAppRevisionFileChange {
                    path,
                    change: ProductAppRevisionChangeKind::Modified,
                    base_sha256: Some(base_file.sha256.clone()),
                    target_sha256: Some(target_file.sha256.clone()),
                });
            }
            (Some(base_file), None) => {
                changes.push(ProductAppRevisionFileChange {
                    path,
                    change: ProductAppRevisionChangeKind::Removed,
                    base_sha256: Some(base_file.sha256.clone()),
                    target_sha256: None,
                });
            }
            (None, Some(target_file)) => {
                changes.push(ProductAppRevisionFileChange {
                    path,
                    change: ProductAppRevisionChangeKind::Added,
                    base_sha256: None,
                    target_sha256: Some(target_file.sha256.clone()),
                });
            }
            (None, None) => {}
        }
    }

    Ok(ProductAppRevisionComparison {
        base,
        target,
        changed_count: changes.len(),
        unchanged_count,
        changes,
    })
}

async fn revision_from_ref(
    package_dir: &Path,
    revision: ProductAppRevisionRef,
) -> CoreResult<(
    ProductAppRevisionDescriptor,
    BTreeMap<String, ProductAppCheckpointFile>,
)> {
    match revision {
        ProductAppRevisionRef::CurrentPackage => current_package_revision(package_dir).await,
        ProductAppRevisionRef::Checkpoint(checkpoint_id) => {
            checkpoint_revision(package_dir, &checkpoint_id).await
        }
        ProductAppRevisionRef::Release(release_id) => {
            release_revision(package_dir, &release_id).await
        }
    }
}

pub async fn describe_current_product_app_revision(
    package_dir: &Path,
) -> CoreResult<ProductAppRevisionDescriptor> {
    let (descriptor, _) = current_package_revision(package_dir).await?;
    Ok(descriptor)
}

pub async fn current_product_app_package_digest(package_dir: &Path) -> CoreResult<String> {
    let files = collect_package_files(package_dir).await?;
    let file_metadata = files
        .into_iter()
        .map(|file| file.metadata)
        .collect::<Vec<_>>();
    Ok(stable_digest(&file_metadata))
}

pub async fn create_product_app_release(
    request: CreateProductAppReleaseRequest,
) -> CoreResult<WrittenProductAppRelease> {
    validate_product_app_release_readiness(&request.readiness)?;
    let package_dir = request.package_dir;
    if !package_dir.is_dir() {
        return Err(CoreError::validation(format!(
            "Product App package directory does not exist: {}",
            package_dir.display()
        )));
    }

    let package = ProductAppResolver::read_product_app_package(&package_dir).await?;
    let app_id = package.app.id.clone();
    let version = package.app.version.clone();
    let declared_lock_digest = package.app.component_lock_id.clone();
    let resolved = ProductAppResolver::resolve_package_install(package, request.shared_components)?;
    let resolved_lock_digest = resolved.lock.digest();
    let file_lock_digest = ProductAppResolver::read_lock(&package_dir).await?.digest();
    if declared_lock_digest != resolved_lock_digest || file_lock_digest != resolved_lock_digest {
        return Err(CoreError::validation(format!(
            "Product App release requires a current component lock. declared={}, file={}, resolved={}",
            declared_lock_digest, file_lock_digest, resolved_lock_digest
        )));
    }

    let package_files = collect_package_files(&package_dir).await?;
    if package_files.is_empty() {
        return Err(CoreError::validation(format!(
            "Product App package has no releasable files: {}",
            package_dir.display()
        )));
    }
    let package_file_manifest = package_files
        .iter()
        .map(|file| file.metadata.clone())
        .collect::<Vec<_>>();
    let package_digest = stable_digest(&package_file_manifest);
    let release_id = build_release_id(&app_id, &version, request.created_at_ms, &package_digest);
    let release_dir = package_dir.join("releases").join(&release_id);
    let manifest_path = release_dir.join("release.json");
    let artifact_uri = format!("product-app://{app_id}@{version}/releases/{release_id}");
    let file_count = package_files.len();
    let manifest = ProductAppReleaseManifest {
        schema_version: PRODUCT_APP_RELEASE_SCHEMA_VERSION,
        release_id: release_id.clone(),
        app_id: app_id.clone(),
        app_version: version.clone(),
        component_lock_digest: resolved_lock_digest.clone(),
        package_digest: package_digest.clone(),
        created_at_ms: request.created_at_ms,
        created_by: request.created_by,
        label: request.label,
        notes: request.notes,
        content_root: "files".to_string(),
        package_files: package_file_manifest,
        readiness: request.readiness,
        share: ProductAppReleaseShareSnapshot {
            includes_package_source: true,
            includes_default_configuration: true,
            excludes_work_history: true,
            excludes_runtime_storage: true,
            excludes_user_private_data: true,
            detail: "Release artifact contains app package source and default configuration only; Work history, runtime storage, and user private data are excluded.".to_string(),
        },
    };

    fs::create_dir_all(&release_dir).await?;
    write_snapshot_contents(&release_dir, &package_files).await?;
    fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest)?).await?;
    let release_count = count_release_manifests(&package_dir).await?;

    Ok(WrittenProductAppRelease {
        release_id,
        app_id,
        version,
        component_lock_digest: resolved_lock_digest,
        package_digest,
        manifest_path,
        artifact_uri,
        file_count,
        release_count,
        created_at_ms: request.created_at_ms,
    })
}

struct CollectedPackageFile {
    metadata: ProductAppCheckpointFile,
    bytes: Vec<u8>,
}

async fn collect_package_files(root: &Path) -> CoreResult<Vec<CollectedPackageFile>> {
    let mut dirs = vec![root.to_path_buf()];
    let mut files = Vec::new();

    while let Some(dir) = dirs.pop() {
        let mut entries = fs::read_dir(&dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let relative = path.strip_prefix(root).map_err(|_| {
                CoreError::validation(format!(
                    "Package entry is outside package root: {}",
                    path.display()
                ))
            })?;
            if is_excluded_checkpoint_path(relative) {
                continue;
            }

            let file_type = entry.file_type().await?;
            if file_type.is_dir() {
                dirs.push(path);
            } else if file_type.is_file() {
                let bytes = fs::read(&path).await?;
                files.push(CollectedPackageFile {
                    metadata: ProductAppCheckpointFile {
                        path: normalize_relative_path(relative),
                        sha256: sha256_digest(&bytes),
                        bytes: bytes.len() as u64,
                    },
                    bytes,
                });
            }
        }
    }

    files.sort_by(|a, b| a.metadata.path.cmp(&b.metadata.path));
    Ok(files)
}

async fn write_snapshot_contents(
    snapshot_dir: &Path,
    files: &[CollectedPackageFile],
) -> CoreResult<()> {
    let content_root = snapshot_dir.join("files");
    for file in files {
        let destination = join_normalized_relative_path(&content_root, &file.metadata.path)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::write(destination, &file.bytes).await?;
    }
    Ok(())
}

async fn restore_package_snapshot(
    package_dir: &Path,
    snapshot_files: &[ProductAppCheckpointFile],
    content_root: &Path,
    artifact_label: &str,
) -> CoreResult<(usize, usize)> {
    let current_files = collect_package_files(package_dir).await?;
    let snapshot_paths = snapshot_files
        .iter()
        .map(|file| file.path.as_str())
        .collect::<BTreeSet<_>>();
    let mut removed_files = 0;

    for current_file in current_files {
        if snapshot_paths.contains(current_file.metadata.path.as_str()) {
            continue;
        }
        let path = join_normalized_relative_path(package_dir, &current_file.metadata.path)?;
        if path.is_file() {
            fs::remove_file(path).await?;
            removed_files += 1;
        }
    }

    for file in snapshot_files {
        let snapshot_path = join_normalized_relative_path(content_root, &file.path)?;
        let bytes = fs::read(&snapshot_path).await.map_err(|error| {
            CoreError::validation(format!(
                "{} content is missing for {}: {}",
                artifact_label, file.path, error
            ))
        })?;
        let actual_sha256 = sha256_digest(&bytes);
        if actual_sha256 != file.sha256 || bytes.len() as u64 != file.bytes {
            return Err(CoreError::validation(format!(
                "{} content digest mismatch for {}. expected={} bytes={}, actual={} bytes={}",
                artifact_label,
                file.path,
                file.sha256,
                file.bytes,
                actual_sha256,
                bytes.len()
            )));
        }

        let destination = join_normalized_relative_path(package_dir, &file.path)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::write(destination, bytes).await?;
    }

    Ok((snapshot_files.len(), removed_files))
}

async fn copy_release_snapshot_to_target(
    target_package_dir: &Path,
    content_root: &Path,
    snapshot_files: &[ProductAppCheckpointFile],
) -> CoreResult<()> {
    fs::create_dir_all(target_package_dir).await?;
    for file in snapshot_files {
        let snapshot_path = join_normalized_relative_path(content_root, &file.path)?;
        let bytes = fs::read(&snapshot_path).await.map_err(|error| {
            CoreError::validation(format!(
                "Release template content is missing for {}: {}",
                file.path, error
            ))
        })?;
        let actual_sha256 = sha256_digest(&bytes);
        if actual_sha256 != file.sha256 || bytes.len() as u64 != file.bytes {
            return Err(CoreError::validation(format!(
                "Release template content digest mismatch for {}. expected={} bytes={}, actual={} bytes={}",
                file.path,
                file.sha256,
                file.bytes,
                actual_sha256,
                bytes.len()
            )));
        }
        let destination = join_normalized_relative_path(target_package_dir, &file.path)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::write(destination, bytes).await?;
    }
    Ok(())
}

async fn rebase_template_package_identity(
    package_dir: &Path,
    release: &ProductAppReleaseManifest,
    new_app_id: &str,
    new_name: &str,
    new_version: &str,
    new_description: Option<&str>,
) -> CoreResult<()> {
    let app_path = package_dir.join("app.json");
    let mut app: AppDefinition = read_json(&app_path).await?;
    let source_app_id = release.app_id.as_str();
    let component_id_map = private_component_id_map(&app, source_app_id, new_app_id);

    app.id = new_app_id.to_string();
    app.version = new_version.to_string();
    app.name = new_name.to_string();
    if let Some(description) = new_description.filter(|value| !value.trim().is_empty()) {
        app.description = description.to_string();
    }
    if let Some(primary_surface) = app.primary_surface.as_mut() {
        if let Some(next_id) = component_id_map.get(&primary_surface.component_id) {
            primary_surface.component_id = next_id.clone();
        }
    }
    for component in &mut app.components {
        if component.source == ComponentSource::Private {
            if let Some(next_id) = component_id_map.get(&component.component_id) {
                component.component_id = next_id.clone();
            }
        }
    }
    if let Some(launch) = app.launch.as_mut() {
        if launch.target_id == source_app_id {
            launch.target_id = new_app_id.to_string();
        } else if let Some(next_id) = component_id_map.get(&launch.target_id) {
            launch.target_id = next_id.clone();
        }
    }
    app.component_lock_id = String::new();
    write_app_definition(package_dir, &app).await?;

    rebase_private_component_files(
        package_dir,
        &release.app_id,
        &release.app_version,
        new_app_id,
        new_version,
        &component_id_map,
        &app.components,
    )
    .await?;
    rewrite_eval_plan_refs(package_dir, source_app_id, new_app_id, &component_id_map).await?;
    let lock_path = package_dir.join("app.lock.json");
    if lock_path.is_file() {
        fs::remove_file(lock_path).await?;
    }
    Ok(())
}

fn private_component_id_map(
    app: &AppDefinition,
    source_app_id: &str,
    new_app_id: &str,
) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for component in &app.components {
        if component.source != ComponentSource::Private {
            continue;
        }
        let next_id = rebased_component_id(
            &component.component_id,
            source_app_id,
            new_app_id,
            &component.role,
            component.kind,
        );
        map.insert(component.component_id.clone(), next_id);
    }
    map
}

fn rebased_component_id(
    component_id: &str,
    source_app_id: &str,
    new_app_id: &str,
    role: &str,
    kind: ComponentKind,
) -> String {
    if component_id == source_app_id {
        return new_app_id.to_string();
    }
    if let Some(suffix) = component_id.strip_prefix(source_app_id) {
        if suffix.starts_with('-') || suffix.starts_with('_') {
            return format!("{new_app_id}{suffix}");
        }
    }
    let fallback = match (kind, role) {
        (ComponentKind::Surface, "primarySurface") => "surface".to_string(),
        (ComponentKind::Agent, "agent") | (ComponentKind::Agent, "backend") => "agent".to_string(),
        _ if !role.trim().is_empty() => id_segment(role),
        _ => id_segment(component_id),
    };
    format!("{new_app_id}-{fallback}")
}

async fn rebase_private_component_files(
    package_dir: &Path,
    source_app_id: &str,
    source_version: &str,
    new_app_id: &str,
    new_version: &str,
    component_id_map: &BTreeMap<String, String>,
    component_refs: &[AppComponentRef],
) -> CoreResult<()> {
    for component_ref in component_refs {
        if component_ref.source != ComponentSource::Private {
            continue;
        }
        let old_id = component_id_map
            .iter()
            .find_map(|(old_id, new_id)| {
                (new_id == &component_ref.component_id).then(|| old_id.clone())
            })
            .unwrap_or_else(|| component_ref.component_id.clone());
        let new_id = component_ref.component_id.clone();
        let kind_dir = package_dir
            .join("components")
            .join(component_ref.kind.path_segment());
        let old_dir = kind_dir.join(&old_id);
        let new_dir = kind_dir.join(&new_id);
        if old_dir.is_dir() && old_dir != new_dir {
            if new_dir.exists() {
                return Err(CoreError::validation(format!(
                    "Template component target already exists: {}",
                    new_dir.display()
                )));
            }
            fs::rename(&old_dir, &new_dir).await?;
        }
        let component_path = new_dir.join("component.json");
        if !component_path.is_file() {
            continue;
        }
        let mut component: ComponentDefinition = read_json(&component_path).await?;
        component.id = new_id.clone();
        if component.package_source == ComponentPackageSource::AppPrivate {
            component.owner_app = Some(ComponentOwnerApp {
                app_id: new_app_id.to_string(),
                app_version: new_version.to_string(),
            });
            component.used_by_apps = vec![new_app_id.to_string()];
        }
        if let Some(implementation_ref) = component.implementation_ref.as_mut() {
            *implementation_ref = rebase_template_string(
                implementation_ref,
                source_app_id,
                source_version,
                new_app_id,
                new_version,
                component_id_map,
            );
        }
        write_json(&component_path, &component).await?;
    }
    Ok(())
}

async fn rewrite_eval_plan_refs(
    package_dir: &Path,
    source_app_id: &str,
    new_app_id: &str,
    component_id_map: &BTreeMap<String, String>,
) -> CoreResult<()> {
    let eval_path = package_dir.join("tests").join("eval.json");
    if !eval_path.is_file() {
        return Ok(());
    }
    let mut value: serde_json::Value = read_json(&eval_path).await?;
    rewrite_json_strings(&mut value, source_app_id, new_app_id, component_id_map);
    write_json(&eval_path, &value).await
}

fn rewrite_json_strings(
    value: &mut serde_json::Value,
    source_app_id: &str,
    new_app_id: &str,
    component_id_map: &BTreeMap<String, String>,
) {
    match value {
        serde_json::Value::String(text) => {
            let mut next = if text == source_app_id {
                new_app_id.to_string()
            } else {
                text.clone()
            };
            for (old_id, new_id) in component_id_map {
                if next == *old_id {
                    next = new_id.clone();
                } else if next.contains(old_id) {
                    next = next.replace(old_id, new_id);
                }
            }
            *text = next;
        }
        serde_json::Value::Array(items) => {
            for item in items {
                rewrite_json_strings(item, source_app_id, new_app_id, component_id_map);
            }
        }
        serde_json::Value::Object(map) => {
            for item in map.values_mut() {
                rewrite_json_strings(item, source_app_id, new_app_id, component_id_map);
            }
        }
        _ => {}
    }
}

fn rebase_template_string(
    value: &str,
    source_app_id: &str,
    source_version: &str,
    new_app_id: &str,
    new_version: &str,
    component_id_map: &BTreeMap<String, String>,
) -> String {
    let mut next = value.replace(
        &format!("app://{source_app_id}@{source_version}/"),
        &format!("app://{new_app_id}@{new_version}/"),
    );
    for (old_id, new_id) in component_id_map {
        next = next.replace(old_id, new_id);
    }
    next
}

async fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> CoreResult<T> {
    let bytes = fs::read(path).await?;
    Ok(serde_json::from_slice(&bytes)?)
}

async fn write_json<T: Serialize>(path: &Path, value: &T) -> CoreResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    fs::write(path, serde_json::to_vec_pretty(value)?).await?;
    Ok(())
}

async fn write_app_definition(package_dir: &Path, app: &AppDefinition) -> CoreResult<()> {
    write_json(&package_dir.join("app.json"), app).await
}

fn join_normalized_relative_path(root: &Path, relative: &str) -> CoreResult<PathBuf> {
    let mut path = root.to_path_buf();
    for segment in relative.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(CoreError::validation(format!(
                "Invalid checkpoint relative path: {relative}"
            )));
        }
        path.push(segment);
    }
    Ok(path)
}

async fn read_checkpoint_manifest(
    package_dir: &Path,
    checkpoint_id: &str,
) -> CoreResult<ProductAppCheckpointManifest> {
    let path = checkpoint_manifest_path(package_dir, checkpoint_id)?;
    let bytes = fs::read(&path).await?;
    let manifest: ProductAppCheckpointManifest = serde_json::from_slice(&bytes)?;
    if manifest.schema_version != PRODUCT_APP_CHECKPOINT_SCHEMA_VERSION {
        return Err(CoreError::validation(format!(
            "Unsupported Product App checkpoint schema version {} in {}",
            manifest.schema_version,
            path.display()
        )));
    }
    if manifest.checkpoint_id != checkpoint_id {
        return Err(CoreError::validation(format!(
            "Checkpoint manifest id mismatch. requested={}, manifest={}",
            checkpoint_id, manifest.checkpoint_id
        )));
    }
    Ok(manifest)
}

fn checkpoint_manifest_path(package_dir: &Path, checkpoint_id: &str) -> CoreResult<PathBuf> {
    validate_checkpoint_id(checkpoint_id)?;
    Ok(package_dir
        .join("checkpoints")
        .join(checkpoint_id)
        .join("checkpoint.json"))
}

fn checkpoint_content_root(
    package_dir: &Path,
    checkpoint: &ProductAppCheckpointManifest,
) -> CoreResult<PathBuf> {
    validate_checkpoint_id(&checkpoint.checkpoint_id)?;
    join_normalized_relative_path(
        &package_dir
            .join("checkpoints")
            .join(&checkpoint.checkpoint_id),
        &checkpoint.content_root,
    )
}

async fn read_release_manifest(
    package_dir: &Path,
    release_id: &str,
) -> CoreResult<ProductAppReleaseManifest> {
    let path = release_manifest_path(package_dir, release_id)?;
    let bytes = fs::read(&path).await?;
    let manifest: ProductAppReleaseManifest = serde_json::from_slice(&bytes)?;
    if manifest.schema_version != PRODUCT_APP_RELEASE_SCHEMA_VERSION {
        return Err(CoreError::validation(format!(
            "Unsupported Product App release schema version {} in {}",
            manifest.schema_version,
            path.display()
        )));
    }
    if manifest.release_id != release_id {
        return Err(CoreError::validation(format!(
            "Release manifest id mismatch. requested={}, manifest={}",
            release_id, manifest.release_id
        )));
    }
    Ok(manifest)
}

fn release_manifest_path(package_dir: &Path, release_id: &str) -> CoreResult<PathBuf> {
    validate_release_id(release_id)?;
    Ok(package_dir
        .join("releases")
        .join(release_id)
        .join("release.json"))
}

fn release_content_root(
    package_dir: &Path,
    release: &ProductAppReleaseManifest,
) -> CoreResult<PathBuf> {
    validate_release_id(&release.release_id)?;
    join_normalized_relative_path(
        &package_dir.join("releases").join(&release.release_id),
        &release.content_root,
    )
}

fn validate_checkpoint_id(checkpoint_id: &str) -> CoreResult<()> {
    let valid = !checkpoint_id.trim().is_empty()
        && checkpoint_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.');
    if valid {
        Ok(())
    } else {
        Err(CoreError::validation(format!(
            "Invalid checkpoint id: {checkpoint_id}"
        )))
    }
}

fn validate_release_id(release_id: &str) -> CoreResult<()> {
    let valid = !release_id.trim().is_empty()
        && release_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.');
    if valid {
        Ok(())
    } else {
        Err(CoreError::validation(format!(
            "Invalid release id: {release_id}"
        )))
    }
}

fn validate_package_id(field: &str, value: &str) -> CoreResult<()> {
    let valid = !value.trim().is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');
    if valid {
        Ok(())
    } else {
        Err(CoreError::validation(format!(
            "{field} must contain only ASCII letters, numbers, '-' or '_'"
        )))
    }
}

fn validate_required(field: &str, value: &str) -> CoreResult<()> {
    if value.trim().is_empty() {
        Err(CoreError::validation(format!("{field} cannot be empty")))
    } else {
        Ok(())
    }
}

async fn verify_restored_checkpoint_lock(
    package_dir: &Path,
    shared_components: &[ComponentDefinition],
    checkpoint: &ProductAppCheckpointManifest,
) -> CoreResult<()> {
    let package = ProductAppResolver::read_product_app_package(package_dir).await?;
    if package.app.id != checkpoint.app_id || package.app.version != checkpoint.app_version {
        return Err(CoreError::validation(format!(
            "Restored package identity does not match checkpoint. package={}@{}, checkpoint={}@{}",
            package.app.id, package.app.version, checkpoint.app_id, checkpoint.app_version
        )));
    }

    let declared_lock_digest = package.app.component_lock_id.clone();
    let resolved =
        ProductAppResolver::resolve_package_install(package, shared_components.to_vec())?;
    let resolved_lock_digest = resolved.lock.digest();
    let file_lock_digest = ProductAppResolver::read_lock(package_dir).await?.digest();
    if declared_lock_digest != checkpoint.component_lock_digest
        || resolved_lock_digest != checkpoint.component_lock_digest
        || file_lock_digest != checkpoint.component_lock_digest
    {
        return Err(CoreError::validation(format!(
            "Restored checkpoint lock mismatch. checkpoint={}, declared={}, file={}, resolved={}",
            checkpoint.component_lock_digest,
            declared_lock_digest,
            file_lock_digest,
            resolved_lock_digest
        )));
    }
    Ok(())
}

async fn verify_restored_release_lock(
    package_dir: &Path,
    shared_components: &[ComponentDefinition],
    release: &ProductAppReleaseManifest,
) -> CoreResult<()> {
    let package = ProductAppResolver::read_product_app_package(package_dir).await?;
    if package.app.id != release.app_id || package.app.version != release.app_version {
        return Err(CoreError::validation(format!(
            "Restored package identity does not match release. package={}@{}, release={}@{}",
            package.app.id, package.app.version, release.app_id, release.app_version
        )));
    }

    let declared_lock_digest = package.app.component_lock_id.clone();
    let resolved =
        ProductAppResolver::resolve_package_install(package, shared_components.to_vec())?;
    let resolved_lock_digest = resolved.lock.digest();
    let file_lock_digest = ProductAppResolver::read_lock(package_dir).await?.digest();
    if declared_lock_digest != release.component_lock_digest
        || resolved_lock_digest != release.component_lock_digest
        || file_lock_digest != release.component_lock_digest
    {
        return Err(CoreError::validation(format!(
            "Restored release lock mismatch. release={}, declared={}, file={}, resolved={}",
            release.component_lock_digest,
            declared_lock_digest,
            file_lock_digest,
            resolved_lock_digest
        )));
    }
    Ok(())
}

async fn checkpoint_revision(
    package_dir: &Path,
    checkpoint_id: &str,
) -> CoreResult<(
    ProductAppRevisionDescriptor,
    BTreeMap<String, ProductAppCheckpointFile>,
)> {
    let checkpoint = read_checkpoint_manifest(package_dir, checkpoint_id).await?;
    let files = checkpoint
        .package_files
        .iter()
        .map(|file| (file.path.clone(), file.clone()))
        .collect::<BTreeMap<_, _>>();
    let descriptor = ProductAppRevisionDescriptor {
        kind: ProductAppRevisionKind::Checkpoint,
        checkpoint_id: Some(checkpoint.checkpoint_id),
        release_id: None,
        app_id: checkpoint.app_id,
        version: checkpoint.app_version,
        component_lock_digest: checkpoint.component_lock_digest,
        package_digest: checkpoint.package_digest,
        file_count: files.len(),
    };
    Ok((descriptor, files))
}

async fn release_revision(
    package_dir: &Path,
    release_id: &str,
) -> CoreResult<(
    ProductAppRevisionDescriptor,
    BTreeMap<String, ProductAppCheckpointFile>,
)> {
    let release = read_release_manifest(package_dir, release_id).await?;
    let files = release
        .package_files
        .iter()
        .map(|file| (file.path.clone(), file.clone()))
        .collect::<BTreeMap<_, _>>();
    let descriptor = ProductAppRevisionDescriptor {
        kind: ProductAppRevisionKind::Release,
        checkpoint_id: None,
        release_id: Some(release.release_id),
        app_id: release.app_id,
        version: release.app_version,
        component_lock_digest: release.component_lock_digest,
        package_digest: release.package_digest,
        file_count: files.len(),
    };
    Ok((descriptor, files))
}

async fn current_package_revision(
    package_dir: &Path,
) -> CoreResult<(
    ProductAppRevisionDescriptor,
    BTreeMap<String, ProductAppCheckpointFile>,
)> {
    let package = ProductAppResolver::read_product_app_package(package_dir).await?;
    let app_id = package.app.id.clone();
    let version = package.app.version.clone();
    let component_lock_digest = ProductAppResolver::read_lock(package_dir).await?.digest();
    let files = collect_package_files(package_dir).await?;
    let file_metadata = files
        .into_iter()
        .map(|file| file.metadata)
        .collect::<Vec<_>>();
    let package_digest = stable_digest(&file_metadata);
    let file_map = file_metadata
        .into_iter()
        .map(|file| (file.path.clone(), file))
        .collect::<BTreeMap<_, _>>();
    let descriptor = ProductAppRevisionDescriptor {
        kind: ProductAppRevisionKind::CurrentPackage,
        checkpoint_id: None,
        release_id: None,
        app_id,
        version,
        component_lock_digest,
        package_digest,
        file_count: file_map.len(),
    };
    Ok((descriptor, file_map))
}

fn is_excluded_checkpoint_path(path: &Path) -> bool {
    path.components().any(|component| match component {
        Component::Normal(segment) => matches!(
            segment.to_string_lossy().as_ref(),
            "checkpoints"
                | "releases"
                | "node_modules"
                | ".git"
                | ".sparo_os"
                | PRODUCT_APP_RELEASE_CATALOG_SOURCE_FILE
        ),
        _ => false,
    })
}

fn normalize_relative_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn sha256_digest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

async fn count_checkpoint_manifests(package_dir: &Path) -> CoreResult<usize> {
    let checkpoints_dir = package_dir.join("checkpoints");
    if !checkpoints_dir.is_dir() {
        return Ok(0);
    }

    let mut count = 0;
    let mut entries = fs::read_dir(checkpoints_dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        if entry.file_type().await?.is_dir() && entry.path().join("checkpoint.json").is_file() {
            count += 1;
        }
    }
    Ok(count)
}

async fn count_release_manifests(package_dir: &Path) -> CoreResult<usize> {
    let releases_dir = package_dir.join("releases");
    if !releases_dir.is_dir() {
        return Ok(0);
    }

    let mut count = 0;
    let mut entries = fs::read_dir(releases_dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        if entry.file_type().await?.is_dir() && entry.path().join("release.json").is_file() {
            count += 1;
        }
    }
    Ok(count)
}

pub fn validate_product_app_release_readiness(
    readiness: &ProductAppReleaseReadinessSnapshot,
) -> CoreResult<()> {
    if readiness.work_id.trim().is_empty() {
        return Err(CoreError::validation(
            "Product App release requires a readiness work_id".to_string(),
        ));
    }
    if readiness.preview_result_id.trim().is_empty() {
        return Err(CoreError::validation(
            "Product App release requires a readiness preview_result_id".to_string(),
        ));
    }
    if readiness.status != "passed" {
        return Err(CoreError::validation(format!(
            "Product App release requires passed release readiness, got {}",
            readiness.status
        )));
    }
    let Some(release_gate) = readiness
        .checks
        .iter()
        .find(|check| check.id == "releaseGate")
    else {
        return Err(CoreError::validation(
            "Product App release requires a releaseGate readiness check".to_string(),
        ));
    };
    if release_gate.status != "passed" {
        return Err(CoreError::validation(format!(
            "Product App release requires releaseGate=passed, got {}",
            release_gate.status
        )));
    }
    if let Some(check) = readiness
        .checks
        .iter()
        .find(|check| check.status != "passed")
    {
        return Err(CoreError::validation(format!(
            "Product App release requires every readiness check to pass. {}={}",
            check.id, check.status
        )));
    }
    if let Some(required_id) = PRODUCT_APP_RELEASE_READINESS_REQUIRED_CHECK_IDS
        .iter()
        .find(|required_id| {
            readiness
                .checks
                .iter()
                .all(|check| check.id != **required_id)
        })
    {
        return Err(CoreError::validation(format!(
            "Product App release requires {required_id} readiness evidence"
        )));
    }
    Ok(())
}

fn build_checkpoint_id(
    app_id: &str,
    version: &str,
    created_at_ms: u64,
    package_digest: &str,
) -> String {
    let digest_suffix = package_digest
        .strip_prefix("sha256:")
        .unwrap_or(package_digest)
        .chars()
        .take(12)
        .collect::<String>();
    format!(
        "checkpoint-{}-{}-{}-{}",
        id_segment(app_id),
        id_segment(version),
        created_at_ms,
        digest_suffix
    )
}

fn build_release_id(
    app_id: &str,
    version: &str,
    created_at_ms: u64,
    package_digest: &str,
) -> String {
    let digest_suffix = package_digest
        .strip_prefix("sha256:")
        .unwrap_or(package_digest)
        .chars()
        .take(12)
        .collect::<String>();
    format!(
        "release-{}-{}-{}-{}",
        id_segment(app_id),
        id_segment(version),
        created_at_ms,
        digest_suffix
    )
}

fn id_segment(value: &str) -> String {
    let mut output = String::new();
    let mut last_dash = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            output.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash && !output.is_empty() {
            output.push('-');
            last_dash = true;
        }
    }
    while output.ends_with('-') {
        output.pop();
    }
    if output.is_empty() {
        "unknown".to_string()
    } else {
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_platform::{
        create_product_app_package, create_product_app_package_with_options, AppSurfaceMode,
        CreateProductAppPackageDraft, CreateProductAppPackageOptions,
    };
    use crate::infrastructure::PathManager;
    use serde_json::{json, Value};

    #[tokio::test]
    async fn create_checkpoint_writes_manifest_and_excludes_checkpoint_dir() {
        let root = test_root("writes-manifest");
        let path_manager = PathManager::with_user_root_for_tests(root.clone());
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "checkpoint-app".to_string(),
                name: "Checkpoint App".to_string(),
                description: "Checkpoint test app".to_string(),
                authors: Vec::new(),
                i18n: Default::default(),
                version: "1.0.0".to_string(),
                agent_type: "Runno".to_string(),
                category: "utility".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .expect("create product app");
        fs::create_dir_all(written.package_dir.join("checkpoints").join("old"))
            .await
            .expect("create old checkpoint dir");
        fs::write(
            written
                .package_dir
                .join("checkpoints")
                .join("old")
                .join("ignored.txt"),
            "ignore me",
        )
        .await
        .expect("write old checkpoint file");

        let checkpoint = create_product_app_checkpoint(CreateProductAppCheckpointRequest {
            package_dir: written.package_dir.clone(),
            shared_components: Vec::new(),
            label: Some("Stable draft".to_string()),
            summary: Some("Ready for release rehearsal.".to_string()),
            created_by: Some("test".to_string()),
            created_at_ms: 1234,
        })
        .await
        .expect("create checkpoint");

        assert_eq!(checkpoint.app_id, "checkpoint-app");
        assert_eq!(checkpoint.version, "1.0.0");
        assert_eq!(
            checkpoint.component_lock_digest,
            written.component_lock_digest
        );
        assert_eq!(checkpoint.checkpoint_count, 1);
        assert_eq!(checkpoint.created_at_ms, 1234);
        assert!(checkpoint.manifest_path.exists());
        let manifest: ProductAppCheckpointManifest =
            serde_json::from_slice(&fs::read(&checkpoint.manifest_path).await.unwrap()).unwrap();

        assert_eq!(
            manifest.schema_version,
            PRODUCT_APP_CHECKPOINT_SCHEMA_VERSION
        );
        assert_eq!(manifest.checkpoint_id, checkpoint.checkpoint_id);
        assert_eq!(manifest.label.as_deref(), Some("Stable draft"));
        assert!(manifest.package_digest.starts_with("sha256:"));
        assert!(manifest
            .package_files
            .iter()
            .any(|file| file.path == "app.json"));
        assert!(manifest
            .package_files
            .iter()
            .any(|file| file.path == "app.lock.json"));
        assert!(manifest
            .package_files
            .iter()
            .all(|file| !file.path.starts_with("checkpoints/")));
        assert!(manifest.readiness.component_lock_verified);
        assert!(checkpoint
            .manifest_path
            .parent()
            .unwrap()
            .join("files")
            .join("app.json")
            .is_file());

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn create_checkpoint_rejects_stale_component_lock() {
        let root = test_root("stale-lock");
        let path_manager = PathManager::with_user_root_for_tests(root.clone());
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "stale-checkpoint-app".to_string(),
                name: "Stale Checkpoint App".to_string(),
                description: "Checkpoint stale lock test app".to_string(),
                authors: Vec::new(),
                i18n: Default::default(),
                version: "1.0.0".to_string(),
                agent_type: "Runno".to_string(),
                category: "utility".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .expect("create product app");
        let app_path = written.package_dir.join("app.json");
        let mut app: Value = serde_json::from_slice(&fs::read(&app_path).await.unwrap()).unwrap();
        app["componentLockId"] = json!("sha256:stale");
        fs::write(&app_path, serde_json::to_vec_pretty(&app).unwrap())
            .await
            .expect("write stale app");

        let error = create_product_app_checkpoint(CreateProductAppCheckpointRequest {
            package_dir: written.package_dir.clone(),
            shared_components: Vec::new(),
            label: None,
            summary: None,
            created_by: None,
            created_at_ms: 1234,
        })
        .await
        .expect_err("stale lock should fail")
        .to_string();

        assert!(error.contains("current component lock"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn restore_checkpoint_restores_snapshot_and_removes_new_files() {
        let root = test_root("restore");
        let path_manager = PathManager::with_user_root_for_tests(root.clone());
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "restore-checkpoint-app".to_string(),
                name: "Restore Checkpoint App".to_string(),
                description: "Original description".to_string(),
                authors: Vec::new(),
                i18n: Default::default(),
                version: "1.0.0".to_string(),
                agent_type: "Runno".to_string(),
                category: "utility".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .expect("create product app");
        let checkpoint = create_product_app_checkpoint(CreateProductAppCheckpointRequest {
            package_dir: written.package_dir.clone(),
            shared_components: Vec::new(),
            label: None,
            summary: None,
            created_by: None,
            created_at_ms: 1234,
        })
        .await
        .expect("create checkpoint");

        let app_path = written.package_dir.join("app.json");
        let mut app: Value = serde_json::from_slice(&fs::read(&app_path).await.unwrap()).unwrap();
        app["description"] = json!("Changed description");
        fs::write(&app_path, serde_json::to_vec_pretty(&app).unwrap())
            .await
            .expect("write changed app");
        fs::write(written.package_dir.join("extra.txt"), "new file")
            .await
            .expect("write extra file");

        let restored = restore_product_app_checkpoint(RestoreProductAppCheckpointRequest {
            package_dir: written.package_dir.clone(),
            shared_components: Vec::new(),
            checkpoint_id: checkpoint.checkpoint_id.clone(),
            confirm: true,
        })
        .await
        .expect("restore checkpoint");
        let restored_app: Value =
            serde_json::from_slice(&fs::read(&app_path).await.unwrap()).unwrap();

        assert_eq!(restored.checkpoint_id, checkpoint.checkpoint_id);
        assert_eq!(
            restored_app.get("description").and_then(Value::as_str),
            Some("Original description")
        );
        assert!(!written.package_dir.join("extra.txt").exists());
        assert_eq!(restored.removed_files, 1);

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn compare_revisions_reports_current_package_changes() {
        let root = test_root("compare");
        let path_manager = PathManager::with_user_root_for_tests(root.clone());
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "compare-checkpoint-app".to_string(),
                name: "Compare Checkpoint App".to_string(),
                description: "Original description".to_string(),
                authors: Vec::new(),
                i18n: Default::default(),
                version: "1.0.0".to_string(),
                agent_type: "Runno".to_string(),
                category: "utility".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .expect("create product app");
        let checkpoint = create_product_app_checkpoint(CreateProductAppCheckpointRequest {
            package_dir: written.package_dir.clone(),
            shared_components: Vec::new(),
            label: None,
            summary: None,
            created_by: None,
            created_at_ms: 1234,
        })
        .await
        .expect("create checkpoint");

        let app_path = written.package_dir.join("app.json");
        let mut app: Value = serde_json::from_slice(&fs::read(&app_path).await.unwrap()).unwrap();
        app["description"] = json!("Changed description");
        fs::write(&app_path, serde_json::to_vec_pretty(&app).unwrap())
            .await
            .expect("write changed app");

        let comparison = compare_product_app_revisions(CompareProductAppRevisionsRequest {
            package_dir: written.package_dir.clone(),
            base: ProductAppRevisionRef::Checkpoint(checkpoint.checkpoint_id),
            target: ProductAppRevisionRef::CurrentPackage,
        })
        .await
        .expect("compare revisions");

        assert_eq!(comparison.changed_count, 1);
        assert!(comparison.changes.iter().any(|change| {
            change.path == "app.json" && change.change == ProductAppRevisionChangeKind::Modified
        }));

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn compare_release_to_current_package_reports_changes() {
        let root = test_root("compare-release");
        let path_manager = PathManager::with_user_root_for_tests(root.clone());
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "compare-release-app".to_string(),
                name: "Compare Release App".to_string(),
                description: "Original release description".to_string(),
                authors: Vec::new(),
                i18n: Default::default(),
                version: "1.0.0".to_string(),
                agent_type: "Runno".to_string(),
                category: "utility".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .expect("create product app");
        let release = create_product_app_release(CreateProductAppReleaseRequest {
            package_dir: written.package_dir.clone(),
            shared_components: Vec::new(),
            readiness: passed_release_readiness(),
            label: Some("Release baseline".to_string()),
            notes: None,
            created_by: Some("test".to_string()),
            created_at_ms: 2234,
        })
        .await
        .expect("create release");

        let app_path = written.package_dir.join("app.json");
        let mut app: Value = serde_json::from_slice(&fs::read(&app_path).await.unwrap()).unwrap();
        app["description"] = json!("Changed after release");
        fs::write(&app_path, serde_json::to_vec_pretty(&app).unwrap())
            .await
            .expect("write changed app");

        let comparison = compare_product_app_revisions(CompareProductAppRevisionsRequest {
            package_dir: written.package_dir.clone(),
            base: ProductAppRevisionRef::Release(release.release_id.clone()),
            target: ProductAppRevisionRef::CurrentPackage,
        })
        .await
        .expect("compare release revisions");

        assert_eq!(comparison.base.kind, ProductAppRevisionKind::Release);
        assert_eq!(
            comparison.base.release_id.as_deref(),
            Some(release.release_id.as_str())
        );
        assert_eq!(
            comparison.target.kind,
            ProductAppRevisionKind::CurrentPackage
        );
        assert!(comparison.changes.iter().any(|change| {
            change.path == "app.json" && change.change == ProductAppRevisionChangeKind::Modified
        }));

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn create_product_app_from_release_template_rebases_identity_and_lock() {
        let root = test_root("release-template");
        let path_manager = PathManager::with_user_root_for_tests(root.clone());
        let written = create_product_app_package_with_options(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "source-template-app".to_string(),
                name: "Source Template App".to_string(),
                description: "Source template description".to_string(),
                authors: Vec::new(),
                i18n: Default::default(),
                version: "1.0.0".to_string(),
                agent_type: "Runno".to_string(),
                category: "utility".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
            CreateProductAppPackageOptions {
                include_agent: Some(true),
                include_surface: Some(true),
            },
        )
        .await
        .expect("create product app");
        let release = create_product_app_release(CreateProductAppReleaseRequest {
            package_dir: written.package_dir.clone(),
            shared_components: Vec::new(),
            readiness: passed_release_readiness(),
            label: Some("Template release".to_string()),
            notes: None,
            created_by: Some("test".to_string()),
            created_at_ms: 3234,
        })
        .await
        .expect("create release");
        let target_package_dir =
            path_manager.system_product_app_version_dir("derived-template-app", "1.0.0");

        let template =
            create_product_app_from_release_template(CreateProductAppFromReleaseTemplateRequest {
                source_package_dir: written.package_dir.clone(),
                target_package_dir: target_package_dir.clone(),
                shared_components: Vec::new(),
                release_id: release.release_id.clone(),
                new_app_id: "derived-template-app".to_string(),
                new_name: "Derived Template App".to_string(),
                new_version: "1.0.0".to_string(),
                new_description: Some("Derived description".to_string()),
            })
            .await
            .expect("create release template");

        let package = ProductAppResolver::read_product_app_package(&target_package_dir)
            .await
            .expect("read rebased package");
        let resolved = ProductAppResolver::resolve_package_install(package.clone(), Vec::new())
            .expect("resolve rebased package");
        let eval_plan: serde_json::Value = serde_json::from_slice(
            &fs::read(target_package_dir.join("tests").join("eval.json"))
                .await
                .unwrap(),
        )
        .unwrap();

        assert_eq!(template.source_release_id, release.release_id);
        assert_eq!(template.app_id, "derived-template-app");
        assert_eq!(package.app.id, "derived-template-app");
        assert_eq!(package.app.name, "Derived Template App");
        assert_eq!(package.app.description, "Derived description");
        assert_eq!(
            package
                .app
                .primary_surface
                .as_ref()
                .expect("primary surface")
                .component_id,
            "derived-template-app-surface"
        );
        assert!(package.private_components.iter().all(|component| component
            .owner_app
            .as_ref()
            .is_some_and(|owner| owner.app_id == "derived-template-app")));
        assert!(target_package_dir
            .join("components")
            .join("surfaces")
            .join("derived-template-app-surface")
            .is_dir());
        assert!(!target_package_dir.join("releases").exists());
        assert!(!target_package_dir.join("checkpoints").exists());
        assert_eq!(package.app.component_lock_id, resolved.lock.digest());
        assert_eq!(template.component_lock_digest, resolved.lock.digest());
        assert_eq!(
            eval_plan
                .pointer("/cases/0/input/appId")
                .and_then(serde_json::Value::as_str),
            Some("derived-template-app")
        );
        assert_eq!(
            eval_plan
                .pointer("/cases/0/componentId")
                .and_then(serde_json::Value::as_str),
            Some("derived-template-app-agent")
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn create_release_writes_manifest_and_source_snapshot() {
        let root = test_root("release");
        let path_manager = PathManager::with_user_root_for_tests(root.clone());
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "release-app".to_string(),
                name: "Release App".to_string(),
                description: "Release test app".to_string(),
                authors: Vec::new(),
                i18n: Default::default(),
                version: "1.0.0".to_string(),
                agent_type: "Runno".to_string(),
                category: "utility".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .expect("create product app");

        let release = create_product_app_release(CreateProductAppReleaseRequest {
            package_dir: written.package_dir.clone(),
            shared_components: Vec::new(),
            readiness: passed_release_readiness(),
            label: Some("First release".to_string()),
            notes: Some("Ready to share.".to_string()),
            created_by: Some("test".to_string()),
            created_at_ms: 1234,
        })
        .await
        .expect("create release");
        let manifest: ProductAppReleaseManifest =
            serde_json::from_slice(&fs::read(&release.manifest_path).await.unwrap()).unwrap();

        assert_eq!(release.release_count, 1);
        assert_eq!(release.app_id, "release-app");
        assert_eq!(release.component_lock_digest, written.component_lock_digest);
        assert_eq!(manifest.schema_version, PRODUCT_APP_RELEASE_SCHEMA_VERSION);
        assert_eq!(manifest.release_id, release.release_id);
        assert_eq!(manifest.label.as_deref(), Some("First release"));
        assert!(manifest.share.excludes_work_history);
        assert!(release
            .manifest_path
            .parent()
            .unwrap()
            .join("files")
            .join("app.json")
            .is_file());

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn restore_release_restores_snapshot_and_removes_new_files() {
        let root = test_root("restore-release");
        let path_manager = PathManager::with_user_root_for_tests(root.clone());
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "restore-release-app".to_string(),
                name: "Restore Release App".to_string(),
                description: "Original release description".to_string(),
                authors: Vec::new(),
                i18n: Default::default(),
                version: "1.0.0".to_string(),
                agent_type: "Runno".to_string(),
                category: "utility".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .expect("create product app");
        let release = create_product_app_release(CreateProductAppReleaseRequest {
            package_dir: written.package_dir.clone(),
            shared_components: Vec::new(),
            readiness: passed_release_readiness(),
            label: Some("Rollback target".to_string()),
            notes: None,
            created_by: Some("test".to_string()),
            created_at_ms: 1234,
        })
        .await
        .expect("create release");

        let app_path = written.package_dir.join("app.json");
        let mut app: Value = serde_json::from_slice(&fs::read(&app_path).await.unwrap()).unwrap();
        app["description"] = json!("Changed after release");
        fs::write(&app_path, serde_json::to_vec_pretty(&app).unwrap())
            .await
            .expect("write changed app");
        fs::write(written.package_dir.join("post-release.txt"), "new file")
            .await
            .expect("write extra file");

        let restored = restore_product_app_release(RestoreProductAppReleaseRequest {
            package_dir: written.package_dir.clone(),
            shared_components: Vec::new(),
            release_id: release.release_id.clone(),
            confirm: true,
        })
        .await
        .expect("restore release");
        let restored_app: Value =
            serde_json::from_slice(&fs::read(&app_path).await.unwrap()).unwrap();

        assert_eq!(restored.release_id, release.release_id);
        assert_eq!(
            restored.component_lock_digest,
            release.component_lock_digest
        );
        assert_eq!(
            restored_app.get("description").and_then(Value::as_str),
            Some("Original release description")
        );
        assert!(!written.package_dir.join("post-release.txt").exists());
        assert_eq!(restored.removed_files, 1);

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn create_release_rejects_unpassed_readiness() {
        let root = test_root("release-readiness");
        let path_manager = PathManager::with_user_root_for_tests(root.clone());
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "blocked-release-app".to_string(),
                name: "Blocked Release App".to_string(),
                description: "Release gate test app".to_string(),
                authors: Vec::new(),
                i18n: Default::default(),
                version: "1.0.0".to_string(),
                agent_type: "Runno".to_string(),
                category: "utility".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .expect("create product app");
        let mut readiness = passed_release_readiness();
        readiness.status = "notVerified".to_string();

        let error = create_product_app_release(CreateProductAppReleaseRequest {
            package_dir: written.package_dir,
            shared_components: Vec::new(),
            readiness,
            label: None,
            notes: None,
            created_by: None,
            created_at_ms: 1234,
        })
        .await
        .expect_err("unpassed readiness should fail")
        .to_string();

        assert!(error.contains("passed release readiness"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn release_readiness_rejects_missing_required_check() {
        let mut readiness = passed_release_readiness();
        readiness
            .checks
            .retain(|check| check.id != "runtimeStorage");

        let error = validate_product_app_release_readiness(&readiness)
            .expect_err("missing runtime evidence should fail")
            .to_string();

        assert!(error.contains("runtimeStorage readiness evidence"));
    }

    fn passed_release_readiness() -> ProductAppReleaseReadinessSnapshot {
        ProductAppReleaseReadinessSnapshot {
            work_id: "work_1".to_string(),
            preview_result_id: "preview:release-rehearsal:work_1".to_string(),
            status: "passed".to_string(),
            observed_at: 123,
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

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "sparo-product-app-checkpoint-{name}-{}",
            uuid::Uuid::new_v4()
        ))
    }
}
