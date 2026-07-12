//! Draft-local Product App checkpoint history.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::fs;

use crate::error::{CoreError, CoreResult};

use super::catalog::{stable_digest, ComponentDefinition};
use super::resolver::ProductAppResolver;

pub const PRODUCT_APP_CHECKPOINT_SCHEMA_VERSION: u32 = 2;

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
pub struct CompareProductAppRevisionsRequest {
    pub package_dir: PathBuf,
    pub base: ProductAppRevisionRef,
    pub target: ProductAppRevisionRef,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProductAppRevisionRef {
    CurrentPackage,
    Checkpoint(String),
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
    pub validation: ProductAppCheckpointValidation,
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
pub struct ProductAppCheckpointValidation {
    pub component_lock_verified: bool,
    pub detail: String,
}

pub async fn create_product_app_checkpoint(
    request: CreateProductAppCheckpointRequest,
) -> CoreResult<WrittenProductAppCheckpoint> {
    let package_dir = request.package_dir;
    if !package_dir.is_dir() {
        return Err(CoreError::validation(format!(
            "Product App Draft directory does not exist: {}",
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
            "Draft checkpoint requires a current component lock. declared={}, file={}, resolved={}",
            declared_lock_digest, file_lock_digest, resolved_lock_digest
        )));
    }

    let package_files = collect_package_files(&package_dir).await?;
    if package_files.is_empty() {
        return Err(CoreError::validation(format!(
            "Product App Draft has no checkpointable files: {}",
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
    let checkpoints_root = package_dir.join("checkpoints");
    let checkpoint_dir = checkpoints_root.join(&checkpoint_id);
    if checkpoint_dir.exists() {
        return Err(CoreError::validation(format!(
            "Draft checkpoint already exists: {}",
            checkpoint_dir.display()
        )));
    }
    let staging_dir = checkpoints_root.join(format!(".{checkpoint_id}.staging"));
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir).await?;
    }

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
        validation: ProductAppCheckpointValidation {
            component_lock_verified: true,
            detail: "Checkpoint captures verified Product App Draft source and its exact component lock."
                .to_string(),
        },
    };

    fs::create_dir_all(&staging_dir).await?;
    let write_result = async {
        write_snapshot_contents(&staging_dir, &package_files).await?;
        fs::write(
            staging_dir.join("checkpoint.json"),
            serde_json::to_vec_pretty(&manifest)?,
        )
        .await?;
        fs::rename(&staging_dir, &checkpoint_dir).await?;
        Ok::<(), CoreError>(())
    }
    .await;
    if write_result.is_err() && staging_dir.exists() {
        let _ = fs::remove_dir_all(&staging_dir).await;
    }
    write_result?;

    Ok(WrittenProductAppCheckpoint {
        checkpoint_id,
        app_id,
        version,
        component_lock_digest: resolved_lock_digest,
        package_digest,
        manifest_path: checkpoint_dir.join("checkpoint.json"),
        artifact_uri: format!(
            "product-app-draft://{}/checkpoints/{}",
            resolved.app.id, manifest.checkpoint_id
        ),
        file_count: package_files.len(),
        checkpoint_count: count_checkpoint_manifests(&package_dir).await?,
        created_at_ms: request.created_at_ms,
    })
}

pub async fn restore_product_app_checkpoint(
    request: RestoreProductAppCheckpointRequest,
) -> CoreResult<RestoredProductAppCheckpoint> {
    if !request.confirm {
        return Err(CoreError::validation(
            "RestoreProductAppCheckpoint requires confirm=true because it replaces Draft source"
                .to_string(),
        ));
    }

    let checkpoint = read_checkpoint_manifest(&request.package_dir, &request.checkpoint_id).await?;
    let content_root = checkpoint_content_root(&request.package_dir, &checkpoint)?;
    let verified_files = read_verified_snapshot(&checkpoint.package_files, &content_root).await?;

    let staging_dir = request
        .package_dir
        .join("checkpoints")
        .join(format!(".restore-{}.staging", checkpoint.checkpoint_id));
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir).await?;
    }
    fs::create_dir_all(&staging_dir).await?;
    let validation_result = async {
        write_verified_files(&staging_dir, &verified_files).await?;
        verify_package_lock(
            &staging_dir,
            &request.shared_components,
            &checkpoint.app_id,
            &checkpoint.app_version,
            &checkpoint.component_lock_digest,
        )
        .await
    }
    .await;
    if let Err(error) = validation_result {
        let _ = fs::remove_dir_all(&staging_dir).await;
        return Err(error);
    }

    let result = apply_verified_snapshot(&request.package_dir, &verified_files).await;
    let _ = fs::remove_dir_all(&staging_dir).await;
    let (restored_files, removed_files) = result?;
    Ok(RestoredProductAppCheckpoint {
        checkpoint_id: checkpoint.checkpoint_id,
        app_id: checkpoint.app_id,
        version: checkpoint.app_version,
        component_lock_digest: checkpoint.component_lock_digest,
        package_digest: checkpoint.package_digest,
        manifest_path: checkpoint_manifest_path(&request.package_dir, &request.checkpoint_id)?,
        restored_files,
        removed_files,
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
        match (base_files.get(&path), target_files.get(&path)) {
            (Some(base), Some(target)) if base.sha256 == target.sha256 => {
                unchanged_count += 1;
            }
            (Some(base), Some(target)) => changes.push(ProductAppRevisionFileChange {
                path,
                change: ProductAppRevisionChangeKind::Modified,
                base_sha256: Some(base.sha256.clone()),
                target_sha256: Some(target.sha256.clone()),
            }),
            (Some(base), None) => changes.push(ProductAppRevisionFileChange {
                path,
                change: ProductAppRevisionChangeKind::Removed,
                base_sha256: Some(base.sha256.clone()),
                target_sha256: None,
            }),
            (None, Some(target)) => changes.push(ProductAppRevisionFileChange {
                path,
                change: ProductAppRevisionChangeKind::Added,
                base_sha256: None,
                target_sha256: Some(target.sha256.clone()),
            }),
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

pub async fn describe_current_product_app_revision(
    package_dir: &Path,
) -> CoreResult<ProductAppRevisionDescriptor> {
    let (descriptor, _) = current_package_revision(package_dir).await?;
    Ok(descriptor)
}

pub async fn current_product_app_package_digest(package_dir: &Path) -> CoreResult<String> {
    let files = collect_package_files(package_dir).await?;
    Ok(stable_digest(
        &files
            .into_iter()
            .map(|file| file.metadata)
            .collect::<Vec<_>>(),
    ))
}

struct CollectedPackageFile {
    metadata: ProductAppCheckpointFile,
    bytes: Vec<u8>,
}

async fn collect_package_files(root: &Path) -> CoreResult<Vec<CollectedPackageFile>> {
    let mut directories = vec![root.to_path_buf()];
    let mut files = Vec::new();
    while let Some(directory) = directories.pop() {
        let mut entries = fs::read_dir(&directory).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let relative = path.strip_prefix(root).map_err(|_| {
                CoreError::validation(format!(
                    "Package entry is outside Draft root: {}",
                    path.display()
                ))
            })?;
            if is_excluded_checkpoint_path(relative) {
                continue;
            }
            let file_type = entry.file_type().await?;
            if file_type.is_dir() {
                directories.push(path);
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
    files.sort_by(|left, right| left.metadata.path.cmp(&right.metadata.path));
    Ok(files)
}

async fn write_snapshot_contents(
    snapshot_dir: &Path,
    files: &[CollectedPackageFile],
) -> CoreResult<()> {
    let content_root = snapshot_dir.join("files");
    for file in files {
        let destination = safe_relative_path(&content_root, &file.metadata.path)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::write(destination, &file.bytes).await?;
    }
    Ok(())
}

async fn read_verified_snapshot(
    files: &[ProductAppCheckpointFile],
    content_root: &Path,
) -> CoreResult<Vec<(ProductAppCheckpointFile, Vec<u8>)>> {
    let mut verified = Vec::with_capacity(files.len());
    let mut unique_paths = BTreeSet::new();
    for file in files {
        if !unique_paths.insert(file.path.clone()) {
            return Err(CoreError::validation(format!(
                "Checkpoint contains duplicate path: {}",
                file.path
            )));
        }
        let source = safe_relative_path(content_root, &file.path)?;
        let bytes = fs::read(&source).await.map_err(|error| {
            CoreError::validation(format!(
                "Checkpoint content is missing for {}: {}",
                file.path, error
            ))
        })?;
        let digest = sha256_digest(&bytes);
        if digest != file.sha256 || bytes.len() as u64 != file.bytes {
            return Err(CoreError::validation(format!(
                "Checkpoint content digest mismatch for {}",
                file.path
            )));
        }
        verified.push((file.clone(), bytes));
    }
    Ok(verified)
}

async fn write_verified_files(
    root: &Path,
    files: &[(ProductAppCheckpointFile, Vec<u8>)],
) -> CoreResult<()> {
    for (file, bytes) in files {
        let destination = safe_relative_path(root, &file.path)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::write(destination, bytes).await?;
    }
    Ok(())
}

async fn apply_verified_snapshot(
    package_dir: &Path,
    files: &[(ProductAppCheckpointFile, Vec<u8>)],
) -> CoreResult<(usize, usize)> {
    let snapshot_paths = files
        .iter()
        .map(|(file, _)| file.path.as_str())
        .collect::<BTreeSet<_>>();
    let mut removed_files = 0;
    for current in collect_package_files(package_dir).await? {
        if snapshot_paths.contains(current.metadata.path.as_str()) {
            continue;
        }
        let path = safe_relative_path(package_dir, &current.metadata.path)?;
        if path.is_file() {
            fs::remove_file(path).await?;
            removed_files += 1;
        }
    }
    write_verified_files(package_dir, files).await?;
    Ok((files.len(), removed_files))
}

async fn verify_package_lock(
    package_dir: &Path,
    shared_components: &[ComponentDefinition],
    expected_app_id: &str,
    expected_version: &str,
    expected_lock_digest: &str,
) -> CoreResult<()> {
    let package = ProductAppResolver::read_product_app_package(package_dir).await?;
    if package.app.id != expected_app_id || package.app.version != expected_version {
        return Err(CoreError::validation(format!(
            "Checkpoint identity mismatch. package={}@{}, checkpoint={}@{}",
            package.app.id, package.app.version, expected_app_id, expected_version
        )));
    }
    let declared_lock_digest = package.app.component_lock_id.clone();
    let resolved =
        ProductAppResolver::resolve_package_install(package, shared_components.to_vec())?;
    let resolved_lock_digest = resolved.lock.digest();
    let file_lock_digest = ProductAppResolver::read_lock(package_dir).await?.digest();
    if declared_lock_digest != expected_lock_digest
        || resolved_lock_digest != expected_lock_digest
        || file_lock_digest != expected_lock_digest
    {
        return Err(CoreError::validation(format!(
            "Checkpoint lock mismatch. checkpoint={}, declared={}, file={}, resolved={}",
            expected_lock_digest, declared_lock_digest, file_lock_digest, resolved_lock_digest
        )));
    }
    Ok(())
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
    }
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
    Ok((
        ProductAppRevisionDescriptor {
            kind: ProductAppRevisionKind::Checkpoint,
            checkpoint_id: Some(checkpoint.checkpoint_id),
            app_id: checkpoint.app_id,
            version: checkpoint.app_version,
            component_lock_digest: checkpoint.component_lock_digest,
            package_digest: checkpoint.package_digest,
            file_count: files.len(),
        },
        files,
    ))
}

async fn current_package_revision(
    package_dir: &Path,
) -> CoreResult<(
    ProductAppRevisionDescriptor,
    BTreeMap<String, ProductAppCheckpointFile>,
)> {
    let package = ProductAppResolver::read_product_app_package(package_dir).await?;
    let component_lock_digest = ProductAppResolver::read_lock(package_dir).await?.digest();
    let metadata = collect_package_files(package_dir)
        .await?
        .into_iter()
        .map(|file| file.metadata)
        .collect::<Vec<_>>();
    let package_digest = stable_digest(&metadata);
    let files = metadata
        .into_iter()
        .map(|file| (file.path.clone(), file))
        .collect::<BTreeMap<_, _>>();
    Ok((
        ProductAppRevisionDescriptor {
            kind: ProductAppRevisionKind::CurrentPackage,
            checkpoint_id: None,
            app_id: package.app.id,
            version: package.app.version,
            component_lock_digest,
            package_digest,
            file_count: files.len(),
        },
        files,
    ))
}

async fn read_checkpoint_manifest(
    package_dir: &Path,
    checkpoint_id: &str,
) -> CoreResult<ProductAppCheckpointManifest> {
    let path = checkpoint_manifest_path(package_dir, checkpoint_id)?;
    let manifest: ProductAppCheckpointManifest = serde_json::from_slice(&fs::read(&path).await?)?;
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
    safe_relative_path(
        &package_dir
            .join("checkpoints")
            .join(&checkpoint.checkpoint_id),
        &checkpoint.content_root,
    )
}

fn safe_relative_path(root: &Path, relative: &str) -> CoreResult<PathBuf> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute() {
        return Err(CoreError::validation(format!(
            "Checkpoint path must be relative: {relative}"
        )));
    }
    let mut path = root.to_path_buf();
    for component in relative_path.components() {
        match component {
            Component::Normal(segment) if !segment.is_empty() => path.push(segment),
            _ => {
                return Err(CoreError::validation(format!(
                    "Invalid checkpoint relative path: {relative}"
                )))
            }
        }
    }
    if path == root {
        return Err(CoreError::validation(
            "Checkpoint relative path cannot be empty".to_string(),
        ));
    }
    Ok(path)
}

fn validate_checkpoint_id(checkpoint_id: &str) -> CoreResult<()> {
    let valid = !checkpoint_id.trim().is_empty()
        && checkpoint_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character));
    if valid {
        Ok(())
    } else {
        Err(CoreError::validation(format!(
            "Invalid checkpoint id: {checkpoint_id}"
        )))
    }
}

fn is_excluded_checkpoint_path(path: &Path) -> bool {
    path.components().any(|component| match component {
        Component::Normal(segment) => matches!(
            segment.to_string_lossy().as_ref(),
            "checkpoints" | "releases" | "previews" | "node_modules" | ".git" | ".sparo_os"
        ),
        _ => true,
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
    let root = package_dir.join("checkpoints");
    if !root.is_dir() {
        return Ok(0);
    }
    let mut count = 0;
    let mut entries = fs::read_dir(root).await?;
    while let Some(entry) = entries.next_entry().await? {
        if entry.file_type().await?.is_dir() && entry.path().join("checkpoint.json").is_file() {
            count += 1;
        }
    }
    Ok(count)
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

fn id_segment(value: &str) -> String {
    let mut output = String::new();
    let mut last_dash = false;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            output.push(character.to_ascii_lowercase());
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
        create_product_app_package, AppSurfaceMode, CreateProductAppPackageDraft,
        WrittenProductAppPackage,
    };
    use crate::infrastructure::PathManager;
    use serde_json::{json, Value};

    #[test]
    fn safe_relative_path_rejects_parent_traversal() {
        assert!(safe_relative_path(Path::new("root"), "../app.json").is_err());
    }

    #[test]
    fn checkpoint_ids_are_stable_and_path_safe() {
        assert_eq!(
            build_checkpoint_id("My App", "1.0.0", 42, "sha256:abcdef1234567890"),
            "checkpoint-my-app-1-0-0-42-abcdef123456"
        );
    }

    #[tokio::test]
    async fn checkpoint_is_immutable_and_excludes_history() {
        let (root, written) = create_test_package("checkpoint").await;
        fs::create_dir_all(written.package_dir.join("checkpoints").join("old"))
            .await
            .expect("create old checkpoint directory");
        fs::write(
            written
                .package_dir
                .join("checkpoints")
                .join("old")
                .join("ignored.txt"),
            "ignored",
        )
        .await
        .expect("write ignored history");

        let checkpoint = checkpoint(&written, 42).await;
        let manifest: ProductAppCheckpointManifest = serde_json::from_slice(
            &fs::read(&checkpoint.manifest_path)
                .await
                .expect("read manifest"),
        )
        .expect("parse manifest");

        assert_eq!(
            manifest.schema_version,
            PRODUCT_APP_CHECKPOINT_SCHEMA_VERSION
        );
        assert!(manifest.validation.component_lock_verified);
        assert!(manifest
            .package_files
            .iter()
            .all(|file| !file.path.starts_with("checkpoints/")));
        assert!(checkpoint
            .manifest_path
            .parent()
            .expect("checkpoint directory")
            .join("files")
            .join("app.json")
            .is_file());
        assert_eq!(checkpoint.checkpoint_count, 1);

        let duplicate = create_product_app_checkpoint(CreateProductAppCheckpointRequest {
            package_dir: written.package_dir.clone(),
            shared_components: Vec::new(),
            label: None,
            summary: None,
            created_by: None,
            created_at_ms: 42,
        })
        .await
        .expect_err("same content and timestamp must not overwrite checkpoint");
        assert!(duplicate.to_string().contains("already exists"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn restore_validates_then_replaces_draft_source() {
        let (root, written) = create_test_package("restore").await;
        let checkpoint = checkpoint(&written, 43).await;
        let app_path = written.package_dir.join("app.json");
        let mut app: Value = serde_json::from_slice(&fs::read(&app_path).await.unwrap()).unwrap();
        app["description"] = json!("Changed description");
        fs::write(&app_path, serde_json::to_vec_pretty(&app).unwrap())
            .await
            .expect("change app");
        fs::write(written.package_dir.join("extra.txt"), "extra")
            .await
            .expect("write extra source");

        let restored = restore_product_app_checkpoint(RestoreProductAppCheckpointRequest {
            package_dir: written.package_dir.clone(),
            shared_components: Vec::new(),
            checkpoint_id: checkpoint.checkpoint_id,
            confirm: true,
        })
        .await
        .expect("restore checkpoint");
        let app: Value = serde_json::from_slice(&fs::read(&app_path).await.unwrap()).unwrap();

        assert_eq!(app["description"], json!("Original description"));
        assert!(!written.package_dir.join("extra.txt").exists());
        assert_eq!(restored.removed_files, 1);
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn compare_supports_only_checkpoint_and_current() {
        let (root, written) = create_test_package("compare").await;
        let checkpoint = checkpoint(&written, 44).await;
        let app_path = written.package_dir.join("app.json");
        let mut app: Value = serde_json::from_slice(&fs::read(&app_path).await.unwrap()).unwrap();
        app["description"] = json!("Changed description");
        fs::write(&app_path, serde_json::to_vec_pretty(&app).unwrap())
            .await
            .expect("change app");

        let comparison = compare_product_app_revisions(CompareProductAppRevisionsRequest {
            package_dir: written.package_dir.clone(),
            base: ProductAppRevisionRef::Checkpoint(checkpoint.checkpoint_id),
            target: ProductAppRevisionRef::CurrentPackage,
        })
        .await
        .expect("compare Draft states");

        assert_eq!(comparison.base.kind, ProductAppRevisionKind::Checkpoint);
        assert_eq!(
            comparison.target.kind,
            ProductAppRevisionKind::CurrentPackage
        );
        assert!(comparison.changes.iter().any(|change| {
            change.path == "app.json" && change.change == ProductAppRevisionChangeKind::Modified
        }));
        let _ = std::fs::remove_dir_all(root);
    }

    async fn create_test_package(name: &str) -> (PathBuf, WrittenProductAppPackage) {
        let root = std::env::temp_dir().join(format!(
            "sparo-product-app-draft-checkpoint-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        let path_manager = PathManager::with_user_root_for_tests(root.clone());
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: format!("{name}-app"),
                name: format!("{name} App"),
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
        .expect("create Product App package");
        (root, written)
    }

    async fn checkpoint(
        written: &WrittenProductAppPackage,
        created_at_ms: u64,
    ) -> WrittenProductAppCheckpoint {
        create_product_app_checkpoint(CreateProductAppCheckpointRequest {
            package_dir: written.package_dir.clone(),
            shared_components: Vec::new(),
            label: Some("Draft baseline".to_string()),
            summary: None,
            created_by: Some("test".to_string()),
            created_at_ms,
        })
        .await
        .expect("create checkpoint")
    }
}
