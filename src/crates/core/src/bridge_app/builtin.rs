//! Built-in Bridge Apps bundled from `bundles/bridge-apps`.

use super::manager::{BridgeAppManager, BRIDGE_APP_MANIFEST};
use crate::util::errors::{BitFunError, BitFunResult};
use include_dir::{include_dir, Dir, File};
use serde::Deserialize;
use std::path::Path;

static BUILTIN_BRIDGE_APPS_DIR: Dir<'_> =
    include_dir!("$CARGO_MANIFEST_DIR/../../../bundles/bridge-apps");

const BUILTIN_MARKER: &str = ".builtin-version";
const BUNDLE_MANIFEST: &str = "bundle.json";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuiltinBridgeAppBundle {
    schema_version: u32,
    id: String,
    version: u32,
}

pub fn seed_builtin_bridge_apps() -> BitFunResult<()> {
    let mut app_dirs: Vec<&Dir<'_>> = BUILTIN_BRIDGE_APPS_DIR.dirs().collect();
    app_dirs.sort_by(|a, b| a.path().cmp(b.path()));

    for app_dir in app_dirs {
        if let Err(e) = seed_one(app_dir) {
            match seed_one_from_filesystem(app_dir.path()) {
                Ok(()) => {
                    log::debug!(
                        "seeded builtin bridge app bundle '{}' from filesystem fallback after embedded bundle failed: {}",
                        app_dir.path().display(),
                        e
                    );
                }
                Err(fallback_error) => {
                    log::warn!(
                        "seed builtin bridge app bundle '{}' failed: {}; filesystem fallback failed: {}",
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

fn seed_one(bundle_dir: &Dir<'_>) -> BitFunResult<()> {
    let bundle = read_bundle_manifest(bundle_dir)?;
    validate_embedded_bundle_manifest(&bundle, bundle_dir)?;

    let app_dir = BridgeAppManager::app_dir(&bundle.id);
    let marker_path = app_dir.join(BUILTIN_MARKER);

    if let Ok(content) = std::fs::read_to_string(&marker_path) {
        if let Ok(installed) = content.trim().parse::<u32>() {
            if installed >= bundle.version {
                return Ok(());
            }
        }
    }

    std::fs::create_dir_all(&app_dir)?;
    seed_files(&app_dir, bundle_dir)?;
    std::fs::write(marker_path, bundle.version.to_string())?;
    log::info!(
        "seeded builtin bridge app '{}' (v{})",
        bundle.id,
        bundle.version
    );
    Ok(())
}

fn seed_one_from_filesystem(relative_bundle_dir: &Path) -> BitFunResult<()> {
    let bundle_dir = filesystem_bundles_root().join(relative_bundle_dir);
    let manifest_path = bundle_dir.join(BUNDLE_MANIFEST);
    if !manifest_path.exists() {
        return Err(BitFunError::validation(format!(
            "missing required Bridge App bundle file {} in {}",
            BUNDLE_MANIFEST,
            bundle_dir.display()
        )));
    }

    let manifest = std::fs::read_to_string(&manifest_path)?;
    let bundle: BuiltinBridgeAppBundle = serde_json::from_str(&manifest)
        .map_err(|e| BitFunError::parse(format!("invalid bundled bridge bundle.json: {}", e)))?;
    validate_bundle_manifest_at_path(&bundle, &bundle_dir)?;

    let app_dir = BridgeAppManager::app_dir(&bundle.id);
    let marker_path = app_dir.join(BUILTIN_MARKER);

    if let Ok(content) = std::fs::read_to_string(&marker_path) {
        if let Ok(installed) = content.trim().parse::<u32>() {
            if installed >= bundle.version {
                return Ok(());
            }
        }
    }

    std::fs::create_dir_all(&app_dir)?;
    seed_files_from_filesystem(&app_dir, &bundle_dir)?;
    std::fs::write(marker_path, bundle.version.to_string())?;
    log::info!(
        "seeded builtin bridge app '{}' (v{})",
        bundle.id,
        bundle.version
    );
    Ok(())
}

fn read_bundle_manifest(bundle_dir: &Dir<'_>) -> BitFunResult<BuiltinBridgeAppBundle> {
    let manifest = read_utf8_file(bundle_dir, BUNDLE_MANIFEST)?;
    serde_json::from_str(manifest)
        .map_err(|e| BitFunError::parse(format!("invalid bundled bridge bundle.json: {}", e)))
}

fn validate_embedded_bundle_manifest(
    bundle: &BuiltinBridgeAppBundle,
    bundle_dir: &Dir<'_>,
) -> BitFunResult<()> {
    validate_bundle_manifest_at_path(bundle, bundle_dir.path())
}

fn validate_bundle_manifest_at_path(
    bundle: &BuiltinBridgeAppBundle,
    bundle_dir: &Path,
) -> BitFunResult<()> {
    if bundle.schema_version != 1 {
        return Err(BitFunError::validation(format!(
            "unsupported Bridge App bundle schema version {} in {}",
            bundle.schema_version,
            bundle_dir.display()
        )));
    }
    if bundle.id.trim().is_empty() {
        return Err(BitFunError::validation(format!(
            "Bridge App bundle id cannot be empty in {}",
            bundle_dir.display()
        )));
    }
    if bundle.version == 0 {
        return Err(BitFunError::validation(format!(
            "Bridge App bundle version must be positive in {}",
            bundle_dir.display()
        )));
    }
    Ok(())
}

fn seed_files(app_dir: &Path, bundle_dir: &Dir<'_>) -> BitFunResult<()> {
    let mut files = Vec::new();
    collect_files(bundle_dir, &mut files);

    let bundle_root = bundle_dir.path();
    for file in files {
        let relative = file.path().strip_prefix(bundle_root).map_err(|_| {
            BitFunError::validation(format!(
                "unexpected bundled Bridge App path: {}",
                file.path().display()
            ))
        })?;
        if is_root_file(relative, BUNDLE_MANIFEST) {
            continue;
        }
        write_bytes(app_dir.join(relative), file.contents())?;
    }

    let mut manifest: super::BridgeAppManifest =
        serde_json::from_str(read_utf8_file(bundle_dir, BRIDGE_APP_MANIFEST)?)?;
    BridgeAppManager::validate_manifest(&mut manifest)?;
    Ok(())
}

fn seed_files_from_filesystem(app_dir: &Path, bundle_dir: &Path) -> BitFunResult<()> {
    let files = collect_files_from_filesystem(bundle_dir)?;

    for file in files {
        let relative = file.strip_prefix(bundle_dir).map_err(|_| {
            BitFunError::validation(format!(
                "unexpected bundled Bridge App path: {}",
                file.display()
            ))
        })?;
        if is_root_file(relative, BUNDLE_MANIFEST) {
            continue;
        }
        write_bytes(app_dir.join(relative), &std::fs::read(&file)?)?;
    }

    let manifest_path = bundle_dir.join(BRIDGE_APP_MANIFEST);
    let mut manifest: super::BridgeAppManifest =
        serde_json::from_str(&std::fs::read_to_string(manifest_path)?)?;
    BridgeAppManager::validate_manifest(&mut manifest)?;
    Ok(())
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
            collect_files_from_filesystem_into(&path, out)?;
        } else if path.is_file() {
            out.push(path);
        }
    }
    Ok(())
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
            "missing required Bridge App bundle file {} in {}",
            name,
            dir.path().display()
        ))
    })?;
    file.contents_utf8().ok_or_else(|| {
        BitFunError::parse(format!(
            "bundled Bridge App file is not valid UTF-8: {}/{}",
            dir.path().display(),
            name
        ))
    })
}

fn is_root_file(path: &Path, name: &str) -> bool {
    path.parent().is_none() && path.file_name().is_some_and(|value| value == name)
}

fn write_bytes<P: AsRef<Path>>(path: P, content: &[u8]) -> BitFunResult<()> {
    if let Some(parent) = path.as_ref().parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, content)?;
    Ok(())
}

fn filesystem_bundles_root() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("bundles")
        .join("bridge-apps")
}
