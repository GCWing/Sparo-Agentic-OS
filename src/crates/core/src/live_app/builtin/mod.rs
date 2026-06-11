//! Built-in Live Apps bundled from `bundles/live-apps`.
//!
//! Runtime code lives in `src/crates/core/src/live_app`. Shipped app content
//! lives under the repository-level `bundles/live-apps/<bundle>/` directories.
//! Each bundle declares a stable app id and reseed version in `bundle.json`.

use crate::live_app::manager::LiveAppManager;
use crate::live_app::types::LiveAppMeta;
use crate::util::errors::{BitFunError, BitFunResult};
use chrono::Utc;
use include_dir::{include_dir, Dir, File};
use serde::Deserialize;
use std::path::Path;
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

/// Seed all built-in Live Apps into the user data directory. Idempotent: skips apps
/// whose on-disk marker version is >= the bundled version. User's `storage.json`
/// is preserved across reseeds; source files and root metadata are overwritten.
pub async fn seed_builtin_live_apps(manager: &Arc<LiveAppManager>) -> BitFunResult<()> {
    remove_retired_builtin_live_apps(manager).await;

    let mut app_dirs: Vec<&Dir<'_>> = BUILTIN_LIVE_APPS_DIR.dirs().collect();
    app_dirs.sort_by(|a, b| a.path().cmp(b.path()));

    for app_dir in app_dirs {
        if let Err(e) = seed_one(manager, app_dir).await {
            match seed_one_from_filesystem(manager, app_dir.path()).await {
                Ok(()) => {
                    log::debug!(
                        "seeded builtin live app bundle '{}' from filesystem fallback after embedded bundle failed: {}",
                        app_dir.path().display(),
                        e
                    );
                }
                Err(fallback_error) => {
                    log::warn!(
                        "seed builtin live app bundle '{}' failed: {}; filesystem fallback failed: {}",
                        app_dir.path().display(),
                        e,
                        fallback_error
                    );
                }
            }
        }
    }
    Ok(())
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
    let bundle: BuiltinLiveAppBundle = serde_json::from_str(&manifest)
        .map_err(|e| BitFunError::parse(format!("invalid bundled bundle.json: {}", e)))?;
    validate_bundle_manifest_at_path(&bundle, &bundle_dir)?;

    let app_dir = manager.path_manager().live_app_dir(&bundle.id);
    let marker_path = app_dir.join(BUILTIN_MARKER);

    if let Ok(content) = tokio::fs::read_to_string(&marker_path).await {
        if let Ok(installed) = content.trim().parse::<u32>() {
            if installed >= bundle.version {
                return Ok(());
            }
        }
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

    write_bytes(marker_path, bundle.version.to_string().as_bytes()).await?;
    log::info!(
        "seeded builtin live app '{}' (v{})",
        bundle.id,
        bundle.version
    );
    Ok(())
}

async fn seed_one(manager: &Arc<LiveAppManager>, bundle_dir: &Dir<'_>) -> BitFunResult<()> {
    let bundle = read_bundle_manifest(bundle_dir)?;
    validate_bundle_manifest(&bundle, bundle_dir)?;

    let app_dir = manager.path_manager().live_app_dir(&bundle.id);
    let marker_path = app_dir.join(BUILTIN_MARKER);

    if let Ok(content) = tokio::fs::read_to_string(&marker_path).await {
        if let Ok(installed) = content.trim().parse::<u32>() {
            if installed >= bundle.version {
                return Ok(());
            }
        }
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

    write_bytes(marker_path, bundle.version.to_string().as_bytes()).await?;
    log::info!(
        "seeded builtin live app '{}' (v{})",
        bundle.id,
        bundle.version
    );
    Ok(())
}

fn read_bundle_manifest(bundle_dir: &Dir<'_>) -> BitFunResult<BuiltinLiveAppBundle> {
    let manifest = read_utf8_file(bundle_dir, BUNDLE_MANIFEST)?;
    serde_json::from_str(manifest)
        .map_err(|e| BitFunError::parse(format!("invalid bundled bundle.json: {}", e)))
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
