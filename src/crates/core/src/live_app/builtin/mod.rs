//! Built-in Live Apps bundled from `bundles/live-apps`.
//!
//! Runtime code lives in `src/crates/core/src/live_app`. Shipped app content
//! lives under the repository-level `bundles/live-apps/<bundle>/` directories.
//! Each bundle declares a stable app id and bundle version in `bundle.json`;
//! installed built-ins are refreshed when either the version or source digest changes.

use crate::live_app::manager::LiveAppManager;
use crate::live_app::types::LiveAppMeta;
use crate::util::errors::{BitFunError, BitFunResult};
use chrono::Utc;
use include_dir::{include_dir, Dir, File};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

static BUILTIN_LIVE_APPS_DIR: Dir<'_> =
    include_dir!("$CARGO_MANIFEST_DIR/../../../bundles/live-apps");

const BUILTIN_MARKER: &str = ".builtin-version";
const BUNDLE_MANIFEST: &str = "bundle.json";
const LIVE_APP_META: &str = "meta.json";
const PACKAGE_JSON: &str = "package.json";
const DEFAULT_I18N_JSON: &str = "i18n.json";
const REMOVED_BUILTIN_APP_IDS: &[&str] = &[
    "builtin-personal-desk",
    "builtin-decision-board",
    "builtin-micro-operator",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuiltinLiveAppBundle {
    schema_version: u32,
    id: String,
    version: u32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuiltinInstallMarker {
    schema_version: u32,
    bundle_id: String,
    bundle_version: u32,
    source_digest: String,
}

/// Seed all built-in Live Apps into the user data directory. Idempotent: skips apps
/// whose installed marker matches the bundled version and source digest. User's
/// `storage.json` is preserved across reseeds; source files and root metadata are
/// overwritten.
pub async fn seed_builtin_live_apps(manager: &Arc<LiveAppManager>) -> BitFunResult<()> {
    remove_retired_builtin_live_apps(manager).await;

    for bundle_path in collect_builtin_bundle_paths() {
        if let Err(error) = seed_bundle_by_path(manager, &bundle_path).await {
            log::warn!(
                "seed builtin live app bundle '{}' failed: {}",
                bundle_path.display(),
                error
            );
        }
    }
    Ok(())
}

/// Ensure a specific built-in Live App is current before it is listed or opened.
/// Returns `Ok(false)` for user-created apps that are not backed by a built-in bundle.
pub async fn ensure_builtin_live_app_current(
    manager: &Arc<LiveAppManager>,
    app_id: &str,
) -> BitFunResult<bool> {
    for bundle_path in collect_builtin_bundle_paths() {
        match read_filesystem_bundle_manifest(&bundle_path).await {
            Ok(bundle) if bundle.id == app_id => {
                seed_bundle_by_path(manager, &bundle_path).await?;
                return Ok(true);
            }
            Ok(_) => {}
            Err(_) => {}
        }

        if let Some(bundle_dir) = embedded_bundle_dir(&bundle_path) {
            let bundle = read_bundle_manifest(bundle_dir)?;
            if bundle.id == app_id {
                seed_one(manager, bundle_dir).await?;
                return Ok(true);
            }
        }
    }

    Ok(false)
}

async fn seed_bundle_by_path(
    manager: &Arc<LiveAppManager>,
    relative_bundle_dir: &Path,
) -> BitFunResult<()> {
    match seed_one_from_filesystem(manager, relative_bundle_dir).await {
        Ok(()) => Ok(()),
        Err(filesystem_error) => {
            let Some(bundle_dir) = embedded_bundle_dir(relative_bundle_dir) else {
                return Err(filesystem_error);
            };
            seed_one(manager, bundle_dir)
                .await
                .map_err(|embedded_error| {
                    BitFunError::service(format!(
                        "filesystem source failed: {}; embedded source failed: {}",
                        filesystem_error, embedded_error
                    ))
                })
        }
    }
}

fn collect_builtin_bundle_paths() -> Vec<PathBuf> {
    let mut paths: BTreeSet<PathBuf> = BUILTIN_LIVE_APPS_DIR
        .dirs()
        .map(|dir| dir.path().to_path_buf())
        .collect();

    let filesystem_root = filesystem_bundles_root();
    if let Ok(entries) = std::fs::read_dir(filesystem_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Some(name) = path.file_name() {
                paths.insert(PathBuf::from(name));
            }
        }
    }

    paths.into_iter().collect()
}

fn embedded_bundle_dir(relative_bundle_dir: &Path) -> Option<&'static Dir<'static>> {
    let normalized = relative_bundle_dir.to_string_lossy().replace('\\', "/");
    BUILTIN_LIVE_APPS_DIR.get_dir(normalized.as_str())
}

async fn remove_retired_builtin_live_apps(manager: &Arc<LiveAppManager>) {
    for app_id in REMOVED_BUILTIN_APP_IDS {
        let app_dir = manager.path_manager().live_app_dir(app_id);
        if !app_dir.exists() {
            continue;
        }

        match manager.delete(app_id).await {
            Ok(()) => log::info!("removed retired builtin live app '{}'", app_id),
            Err(e) => log::warn!("remove retired builtin live app '{}' failed: {}", app_id, e),
        }
    }
}

async fn seed_one_from_filesystem(
    manager: &Arc<LiveAppManager>,
    relative_bundle_dir: &Path,
) -> BitFunResult<()> {
    let bundle_dir = filesystem_bundles_root().join(relative_bundle_dir);
    let bundle = read_filesystem_bundle_manifest(relative_bundle_dir).await?;
    validate_bundle_manifest_at_path(&bundle, &bundle_dir)?;
    let source_digest = filesystem_bundle_digest(&bundle_dir)?;

    let app_dir = manager.path_manager().live_app_dir(&bundle.id);
    let marker_path = app_dir.join(BUILTIN_MARKER);

    if is_installed_current(&marker_path, &bundle, &source_digest).await {
        return Ok(());
    }

    let source_dir = app_dir.join("source");
    tokio::fs::create_dir_all(&source_dir)
        .await
        .map_err(|e| BitFunError::io(format!("create dir failed: {}", e)))?;

    seed_meta_from_filesystem(&app_dir, &bundle_dir, &bundle).await?;
    seed_source_files_from_filesystem(&source_dir, &bundle_dir).await?;
    seed_package_json_from_filesystem(&app_dir, &bundle_dir, &bundle.id).await?;

    let storage_path = app_dir.join("storage.json");
    if !storage_path.exists() {
        write_bytes(storage_path, b"{}").await?;
    }

    write_bytes(
        app_dir.join("compiled.html"),
        b"<!DOCTYPE html><html><body>Loading...</body></html>",
    )
    .await?;

    manager.recompile(&bundle.id, "dark", None).await?;

    write_install_marker(marker_path, &bundle, &source_digest).await?;
    log::info!(
        "seeded builtin live app '{}' (v{}, source {})",
        bundle.id,
        bundle.version,
        source_digest
    );
    Ok(())
}

async fn seed_one(manager: &Arc<LiveAppManager>, bundle_dir: &Dir<'_>) -> BitFunResult<()> {
    let bundle = read_bundle_manifest(bundle_dir)?;
    validate_bundle_manifest(&bundle, bundle_dir)?;
    let source_digest = embedded_bundle_digest(bundle_dir)?;

    let app_dir = manager.path_manager().live_app_dir(&bundle.id);
    let marker_path = app_dir.join(BUILTIN_MARKER);

    if is_installed_current(&marker_path, &bundle, &source_digest).await {
        return Ok(());
    }

    let source_dir = app_dir.join("source");
    tokio::fs::create_dir_all(&source_dir)
        .await
        .map_err(|e| BitFunError::io(format!("create dir failed: {}", e)))?;

    seed_meta(&app_dir, bundle_dir, &bundle).await?;
    seed_source_files(&source_dir, bundle_dir).await?;
    seed_package_json(&app_dir, bundle_dir, &bundle.id).await?;

    let storage_path = app_dir.join("storage.json");
    if !storage_path.exists() {
        write_bytes(storage_path, b"{}").await?;
    }

    write_bytes(
        app_dir.join("compiled.html"),
        b"<!DOCTYPE html><html><body>Loading...</body></html>",
    )
    .await?;

    manager.recompile(&bundle.id, "dark", None).await?;

    write_install_marker(marker_path, &bundle, &source_digest).await?;
    log::info!(
        "seeded builtin live app '{}' (v{}, source {})",
        bundle.id,
        bundle.version,
        source_digest
    );
    Ok(())
}

fn read_bundle_manifest(bundle_dir: &Dir<'_>) -> BitFunResult<BuiltinLiveAppBundle> {
    let manifest = read_utf8_file(bundle_dir, BUNDLE_MANIFEST)?;
    serde_json::from_str(manifest)
        .map_err(|e| BitFunError::parse(format!("invalid bundled bundle.json: {}", e)))
}

async fn read_filesystem_bundle_manifest(
    relative_bundle_dir: &Path,
) -> BitFunResult<BuiltinLiveAppBundle> {
    let bundle_dir = filesystem_bundles_root().join(relative_bundle_dir);
    let manifest_path = bundle_dir.join(BUNDLE_MANIFEST);
    if !manifest_path.exists() {
        return Err(BitFunError::validation(format!(
            "missing required Live App bundle file {} in {}",
            BUNDLE_MANIFEST,
            bundle_dir.display()
        )));
    }

    let manifest = tokio::fs::read_to_string(&manifest_path)
        .await
        .map_err(|e| BitFunError::io(format!("read {} failed: {}", manifest_path.display(), e)))?;
    serde_json::from_str(&manifest)
        .map_err(|e| BitFunError::parse(format!("invalid bundled bundle.json: {}", e)))
}

async fn is_installed_current(
    marker_path: &Path,
    bundle: &BuiltinLiveAppBundle,
    source_digest: &str,
) -> bool {
    let Ok(content) = tokio::fs::read_to_string(marker_path).await else {
        return false;
    };

    let parsed_marker = serde_json::from_str::<BuiltinInstallMarker>(&content).ok();
    parsed_marker.is_some_and(|marker| {
        marker.schema_version == 1
            && marker.bundle_id == bundle.id
            && marker.bundle_version >= bundle.version
            && marker.source_digest == source_digest
    })
}

async fn write_install_marker<P: AsRef<Path>>(
    marker_path: P,
    bundle: &BuiltinLiveAppBundle,
    source_digest: &str,
) -> BitFunResult<()> {
    let marker = BuiltinInstallMarker {
        schema_version: 1,
        bundle_id: bundle.id.clone(),
        bundle_version: bundle.version,
        source_digest: source_digest.to_string(),
    };
    let marker_json = serde_json::to_vec_pretty(&marker).map_err(BitFunError::from)?;
    write_bytes(marker_path, &marker_json).await
}

fn embedded_bundle_digest(bundle_dir: &Dir<'_>) -> BitFunResult<String> {
    let mut files = Vec::new();
    collect_files(bundle_dir, &mut files);

    let bundle_root = bundle_dir.path();
    let mut entries = Vec::with_capacity(files.len());
    for file in files {
        let relative = relative_embedded_bundle_path(bundle_root, file.path())?;
        entries.push((relative, file.contents()));
    }
    entries.sort_by(|a, b| normalized_digest_path(&a.0).cmp(&normalized_digest_path(&b.0)));

    let mut hasher = Sha256::new();
    for (relative, content) in entries {
        hash_bundle_entry(&mut hasher, &relative, content);
    }
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

fn filesystem_bundle_digest(bundle_dir: &Path) -> BitFunResult<String> {
    let mut files = collect_files_from_filesystem(bundle_dir)?;
    files.sort();

    let mut hasher = Sha256::new();
    for file in files {
        let relative = file.strip_prefix(bundle_dir).map_err(|_| {
            BitFunError::validation(format!(
                "unexpected bundled Live App path: {}",
                file.display()
            ))
        })?;
        let content = std::fs::read(&file)?;
        hash_bundle_entry(&mut hasher, relative, &content);
    }
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

fn hash_bundle_entry(hasher: &mut Sha256, relative: &Path, content: &[u8]) {
    hasher.update(normalized_digest_path(relative).as_bytes());
    hasher.update([0]);
    hasher.update(content);
    hasher.update([0]);
}

fn normalized_digest_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn validate_bundle_manifest(
    bundle: &BuiltinLiveAppBundle,
    bundle_dir: &Dir<'_>,
) -> BitFunResult<()> {
    validate_bundle_manifest_at_path(bundle, bundle_dir.path())
}

fn validate_bundle_manifest_at_path(
    bundle: &BuiltinLiveAppBundle,
    bundle_dir: &Path,
) -> BitFunResult<()> {
    if bundle.schema_version != 1 {
        return Err(BitFunError::validation(format!(
            "unsupported Live App bundle schema version {} in {}",
            bundle.schema_version,
            bundle_dir.display()
        )));
    }
    if bundle.id.trim().is_empty() {
        return Err(BitFunError::validation(format!(
            "Live App bundle id cannot be empty in {}",
            bundle_dir.display()
        )));
    }
    if bundle.version == 0 {
        return Err(BitFunError::validation(format!(
            "Live App bundle version must be positive in {}",
            bundle_dir.display()
        )));
    }
    Ok(())
}

async fn seed_meta_from_filesystem(
    app_dir: &Path,
    bundle_dir: &Path,
    bundle: &BuiltinLiveAppBundle,
) -> BitFunResult<()> {
    let meta_path = bundle_dir.join(LIVE_APP_META);
    let meta_text = tokio::fs::read_to_string(&meta_path)
        .await
        .map_err(|e| BitFunError::io(format!("read {} failed: {}", meta_path.display(), e)))?;
    let mut meta: LiveAppMeta = serde_json::from_str(&meta_text)
        .map_err(|e| BitFunError::parse(format!("invalid bundled meta.json: {}", e)))?;
    meta.id = bundle.id.clone();
    meta.version = bundle.version;

    let now = Utc::now().timestamp_millis();
    let app_meta_path = app_dir.join(LIVE_APP_META);
    let preserved_created_at = match tokio::fs::read_to_string(&app_meta_path).await {
        Ok(existing) => serde_json::from_str::<LiveAppMeta>(&existing)
            .ok()
            .map(|m| m.created_at)
            .unwrap_or(now),
        Err(_) => now,
    };
    meta.created_at = preserved_created_at;
    meta.updated_at = now;

    let meta_json = serde_json::to_vec_pretty(&meta).map_err(BitFunError::from)?;
    write_bytes(app_meta_path, &meta_json).await
}

async fn seed_source_files_from_filesystem(
    source_dir: &Path,
    bundle_dir: &Path,
) -> BitFunResult<()> {
    prepare_source_dir(source_dir).await?;

    let files = collect_files_from_filesystem(bundle_dir)?;
    let mut wrote_i18n = false;

    for file in files {
        let relative = file.strip_prefix(bundle_dir).map_err(|_| {
            BitFunError::validation(format!(
                "unexpected bundled Live App path: {}",
                file.display()
            ))
        })?;

        if is_root_file(relative, BUNDLE_MANIFEST)
            || is_root_file(relative, LIVE_APP_META)
            || is_root_file(relative, PACKAGE_JSON)
        {
            continue;
        }

        if is_root_file(relative, DEFAULT_I18N_JSON) {
            wrote_i18n = true;
        }

        write_bytes(source_dir.join(relative), &tokio::fs::read(&file).await?).await?;
    }

    if !wrote_i18n {
        write_bytes(source_dir.join(DEFAULT_I18N_JSON), b"{}").await?;
    }

    Ok(())
}

async fn seed_package_json_from_filesystem(
    app_dir: &Path,
    bundle_dir: &Path,
    app_id: &str,
) -> BitFunResult<()> {
    let package_path = bundle_dir.join(PACKAGE_JSON);
    if package_path.exists() {
        let content = tokio::fs::read(&package_path).await.map_err(|e| {
            BitFunError::io(format!("read {} failed: {}", package_path.display(), e))
        })?;
        return write_bytes(app_dir.join(PACKAGE_JSON), &content).await;
    }

    let pkg = serde_json::json!({
        "name": format!("live-app-{}", app_id),
        "private": true,
        "dependencies": {}
    });
    let pkg_json = serde_json::to_vec_pretty(&pkg).map_err(BitFunError::from)?;
    write_bytes(app_dir.join(PACKAGE_JSON), &pkg_json).await
}

fn collect_files_from_filesystem(dir: &Path) -> BitFunResult<Vec<std::path::PathBuf>> {
    let mut files = Vec::new();
    collect_files_from_filesystem_into(dir, &mut files)?;
    Ok(files)
}

fn collect_files_from_filesystem_into(
    dir: &Path,
    out: &mut Vec<std::path::PathBuf>,
) -> BitFunResult<()> {
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            if path.file_name().is_some_and(|name| name == "node_modules") {
                continue;
            }
            collect_files_from_filesystem_into(&path, out)?;
        } else if path.is_file() {
            out.push(path);
        }
    }
    Ok(())
}

fn filesystem_bundles_root() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("bundles")
        .join("live-apps")
}

async fn seed_meta(
    app_dir: &Path,
    bundle_dir: &Dir<'_>,
    bundle: &BuiltinLiveAppBundle,
) -> BitFunResult<()> {
    let meta_text = read_utf8_file(bundle_dir, LIVE_APP_META)?;
    let mut meta: LiveAppMeta = serde_json::from_str(meta_text)
        .map_err(|e| BitFunError::parse(format!("invalid bundled meta.json: {}", e)))?;
    meta.id = bundle.id.clone();
    meta.version = bundle.version;

    let now = Utc::now().timestamp_millis();
    let meta_path = app_dir.join(LIVE_APP_META);
    let preserved_created_at = match tokio::fs::read_to_string(&meta_path).await {
        Ok(existing) => serde_json::from_str::<LiveAppMeta>(&existing)
            .ok()
            .map(|m| m.created_at)
            .unwrap_or(now),
        Err(_) => now,
    };
    meta.created_at = preserved_created_at;
    meta.updated_at = now;

    let meta_json = serde_json::to_vec_pretty(&meta).map_err(BitFunError::from)?;
    write_bytes(meta_path, &meta_json).await
}

async fn prepare_source_dir(source_dir: &Path) -> BitFunResult<()> {
    if source_dir.exists() {
        tokio::fs::remove_dir_all(source_dir).await.map_err(|e| {
            BitFunError::io(format!(
                "failed to reset live app source dir {}: {}",
                source_dir.display(),
                e
            ))
        })?;
    }
    tokio::fs::create_dir_all(source_dir)
        .await
        .map_err(|e| BitFunError::io(format!("create dir failed: {}", e)))
}

async fn seed_source_files(source_dir: &Path, bundle_dir: &Dir<'_>) -> BitFunResult<()> {
    prepare_source_dir(source_dir).await?;

    let mut files = Vec::new();
    collect_files(bundle_dir, &mut files);

    let bundle_root = bundle_dir.path();
    let mut wrote_i18n = false;

    for file in files {
        let relative = relative_embedded_bundle_path(bundle_root, file.path())?;

        if is_root_file(&relative, BUNDLE_MANIFEST)
            || is_root_file(&relative, LIVE_APP_META)
            || is_root_file(&relative, PACKAGE_JSON)
        {
            continue;
        }

        if is_root_file(&relative, DEFAULT_I18N_JSON) {
            wrote_i18n = true;
        }

        write_bytes(source_dir.join(relative), file.contents()).await?;
    }

    if !wrote_i18n {
        write_bytes(source_dir.join(DEFAULT_I18N_JSON), b"{}").await?;
    }

    Ok(())
}

async fn seed_package_json(app_dir: &Path, bundle_dir: &Dir<'_>, app_id: &str) -> BitFunResult<()> {
    if let Some(file) = get_bundle_file(bundle_dir, PACKAGE_JSON) {
        return write_bytes(app_dir.join(PACKAGE_JSON), file.contents()).await;
    }

    let pkg = serde_json::json!({
        "name": format!("live-app-{}", app_id),
        "private": true,
        "dependencies": {}
    });
    let pkg_json = serde_json::to_vec_pretty(&pkg).map_err(BitFunError::from)?;
    write_bytes(app_dir.join(PACKAGE_JSON), &pkg_json).await
}

fn collect_files<'a>(dir: &'a Dir<'a>, out: &mut Vec<&'a File<'a>>) {
    for file in dir.files() {
        out.push(file);
    }

    for sub in dir.dirs() {
        if sub
            .path()
            .file_name()
            .is_some_and(|name| name == "node_modules")
        {
            continue;
        }
        collect_files(sub, out);
    }
}

fn get_bundle_file<'a>(bundle_dir: &'a Dir<'a>, name: &str) -> Option<&'a File<'a>> {
    let bundle_name = bundle_dir.path().to_string_lossy();
    let prefixed = format!("{bundle_name}/{name}");
    bundle_dir
        .get_file(name)
        .or_else(|| bundle_dir.get_file(&prefixed))
        .or_else(|| BUILTIN_LIVE_APPS_DIR.get_file(&prefixed))
        .or_else(|| {
            bundle_dir
                .files()
                .find(|file| file.path().file_name().is_some_and(|value| value == name))
        })
}

fn relative_embedded_bundle_path(
    bundle_root: &Path,
    file_path: &Path,
) -> BitFunResult<std::path::PathBuf> {
    if let Ok(relative) = file_path.strip_prefix(bundle_root) {
        return Ok(relative.to_path_buf());
    }

    if let Some(bundle_name) = bundle_root.file_name() {
        let prefixed_root = Path::new(bundle_name);
        if let Ok(relative) = file_path.strip_prefix(prefixed_root) {
            return Ok(relative.to_path_buf());
        }
    }

    if file_path.components().next().is_some_and(|component| {
        component.as_os_str() != bundle_root.as_os_str()
            && bundle_root
                .file_name()
                .is_some_and(|name| component.as_os_str() != name)
    }) {
        return Ok(file_path.to_path_buf());
    }

    Err(BitFunError::validation(format!(
        "unexpected bundled Live App path: {}",
        file_path.display()
    )))
}

fn read_utf8_file<'a>(dir: &'a Dir<'a>, name: &str) -> BitFunResult<&'a str> {
    let file = get_bundle_file(dir, name).ok_or_else(|| {
        BitFunError::validation(format!(
            "missing required Live App bundle file {} in {}",
            name,
            dir.path().display()
        ))
    })?;
    file.contents_utf8().ok_or_else(|| {
        BitFunError::parse(format!(
            "bundled Live App file is not valid UTF-8: {}/{}",
            dir.path().display(),
            name
        ))
    })
}

fn is_root_file(path: &Path, name: &str) -> bool {
    path.parent().is_none() && path.file_name().is_some_and(|value| value == name)
}

async fn write_bytes<P: AsRef<Path>>(path: P, content: &[u8]) -> BitFunResult<()> {
    if let Some(parent) = path.as_ref().parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            BitFunError::io(format!("create dir {} failed: {}", parent.display(), e))
        })?;
    }
    tokio::fs::write(path.as_ref(), content)
        .await
        .map_err(|e| BitFunError::io(format!("write {} failed: {}", path.as_ref().display(), e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const REQUIRED_BUNDLE_FILES: &[&str] = &[
        BUNDLE_MANIFEST,
        LIVE_APP_META,
        "index.html",
        "ui.js",
        "source_manifest.json",
    ];

    #[test]
    fn embedded_live_app_bundles_include_required_files() {
        for app_dir in BUILTIN_LIVE_APPS_DIR.dirs() {
            let bundle_name = app_dir.path().display().to_string();
            for file_name in REQUIRED_BUNDLE_FILES {
                assert!(
                    get_bundle_file(app_dir, file_name).is_some(),
                    "missing {file_name} in embedded Live App bundle {bundle_name}"
                );
                read_utf8_file(app_dir, file_name)
                    .unwrap_or_else(|_| panic!("{file_name} should be readable in {bundle_name}"));
            }
            let manifest = read_bundle_manifest(app_dir).unwrap_or_else(|error| {
                panic!("bundle.json should be readable in {bundle_name}: {error}")
            });
            if manifest.id == "builtin-ppt-live" {
                assert!(
                    get_bundle_file(app_dir, "src/vendor/ppt-export.bundle.mjs").is_some(),
                    "missing src/vendor/ppt-export.bundle.mjs in embedded Live App bundle {bundle_name}"
                );
            } else {
                assert!(
                    get_bundle_file(app_dir, "worker.js").is_some(),
                    "missing worker.js in embedded Live App bundle {bundle_name}"
                );
            }
        }
    }

    #[test]
    fn relative_embedded_bundle_path_strips_prefixed_paths() {
        let bundle_root = Path::new("ppt-live");
        assert_eq!(
            relative_embedded_bundle_path(bundle_root, Path::new("ppt-live/src/state.js"))
                .expect("prefixed path"),
            Path::new("src/state.js")
        );
        assert_eq!(
            relative_embedded_bundle_path(bundle_root, Path::new("src/state.js"))
                .expect("plain path"),
            Path::new("src/state.js")
        );
    }
}
