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
            log::warn!(
                "seed builtin live app bundle '{}' failed: {}",
                app_dir.path().display(),
                e
            );
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
    if bundle.schema_version != 1 {
        return Err(BitFunError::validation(format!(
            "unsupported Live App bundle schema version {} in {}",
            bundle.schema_version,
            bundle_dir.path().display()
        )));
    }
    if bundle.id.trim().is_empty() {
        return Err(BitFunError::validation(format!(
            "Live App bundle id cannot be empty in {}",
            bundle_dir.path().display()
        )));
    }
    if bundle.version == 0 {
        return Err(BitFunError::validation(format!(
            "Live App bundle version must be positive in {}",
            bundle_dir.path().display()
        )));
    }
    Ok(())
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

async fn seed_source_files(source_dir: &Path, bundle_dir: &Dir<'_>) -> BitFunResult<()> {
    let mut files = Vec::new();
    collect_files(bundle_dir, &mut files);

    let bundle_root = bundle_dir.path();
    let mut wrote_i18n = false;

    for file in files {
        let relative = file.path().strip_prefix(bundle_root).map_err(|_| {
            BitFunError::validation(format!(
                "unexpected bundled Live App path: {}",
                file.path().display()
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

        write_bytes(source_dir.join(relative), file.contents()).await?;
    }

    if !wrote_i18n {
        write_bytes(source_dir.join(DEFAULT_I18N_JSON), b"{}").await?;
    }

    Ok(())
}

async fn seed_package_json(app_dir: &Path, bundle_dir: &Dir<'_>, app_id: &str) -> BitFunResult<()> {
    if let Some(file) = bundle_dir.get_file(PACKAGE_JSON) {
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
        collect_files(sub, out);
    }
}

fn read_utf8_file<'a>(dir: &'a Dir<'a>, name: &str) -> BitFunResult<&'a str> {
    let file = dir.get_file(name).ok_or_else(|| {
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
