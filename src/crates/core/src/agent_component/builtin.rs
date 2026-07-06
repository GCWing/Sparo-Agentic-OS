use super::manager::{AgentComponentManager, AGENT_COMPONENT_MANIFEST};
use crate::agent_component::{AgentComponentLevel, AgentComponentManifest};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::get_path_manager_arc;
use include_dir::{include_dir, Dir, File};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

static BUILTIN_AGENT_COMPONENTS_DIR: Dir<'_> =
    include_dir!("$CARGO_MANIFEST_DIR/../../../bundles/agent-components");

const BUILTIN_MARKER: &str = ".builtin-version";
const BUNDLE_MANIFEST: &str = "bundle.json";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuiltinAgentComponentBundle {
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

pub fn seed_builtin_agent_components() -> CoreResult<Vec<String>> {
    let mut seeded = Vec::new();

    for bundle_path in collect_builtin_bundle_paths() {
        match seed_bundle_by_path(&bundle_path) {
            Ok(id) => seeded.push(id),
            Err(error) => log::warn!(
                "seed builtin Agent Component bundle '{}' failed: {}",
                bundle_path.display(),
                error
            ),
        }
    }

    Ok(seeded)
}

fn seed_bundle_by_path(relative_bundle_dir: &Path) -> CoreResult<String> {
    match seed_one_from_filesystem(relative_bundle_dir) {
        Ok(id) => Ok(id),
        Err(filesystem_error) => {
            let Some(bundle_dir) = embedded_bundle_dir(relative_bundle_dir) else {
                return Err(filesystem_error);
            };
            seed_one(bundle_dir).map_err(|embedded_error| {
                CoreError::service(format!(
                    "filesystem source failed: {}; embedded source failed: {}",
                    filesystem_error, embedded_error
                ))
            })
        }
    }
}

fn collect_builtin_bundle_paths() -> Vec<PathBuf> {
    let mut paths: BTreeSet<PathBuf> = BUILTIN_AGENT_COMPONENTS_DIR
        .dirs()
        .map(|dir| dir.path().to_path_buf())
        .collect();

    if let Ok(entries) = std::fs::read_dir(filesystem_bundles_root()) {
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
    BUILTIN_AGENT_COMPONENTS_DIR.get_dir(normalized.as_str())
}

fn seed_one(bundle_dir: &Dir<'_>) -> CoreResult<String> {
    let bundle = read_bundle_manifest(bundle_dir)?;
    validate_bundle_manifest_at_path(&bundle, bundle_dir.path())?;
    let source_digest = embedded_bundle_digest(bundle_dir)?;

    let app_dir = user_agent_component_dir(&bundle.id);
    let marker_path = app_dir.join(BUILTIN_MARKER);
    if is_installed_current(&marker_path, &bundle, &source_digest) {
        return Ok(bundle.id);
    }

    std::fs::create_dir_all(&app_dir)?;
    seed_files(&app_dir, bundle_dir)?;
    write_install_marker(marker_path, &bundle, &source_digest)?;
    log::info!(
        "seeded builtin Agent Component '{}' (v{}, source {})",
        bundle.id,
        bundle.version,
        source_digest
    );
    Ok(bundle.id)
}

fn seed_one_from_filesystem(relative_bundle_dir: &Path) -> CoreResult<String> {
    let bundle_dir = filesystem_bundles_root().join(relative_bundle_dir);
    let bundle = read_filesystem_bundle_manifest(relative_bundle_dir)?;
    validate_bundle_manifest_at_path(&bundle, &bundle_dir)?;
    let source_digest = filesystem_bundle_digest(&bundle_dir)?;

    let app_dir = user_agent_component_dir(&bundle.id);
    let marker_path = app_dir.join(BUILTIN_MARKER);
    if is_installed_current(&marker_path, &bundle, &source_digest) {
        return Ok(bundle.id);
    }

    std::fs::create_dir_all(&app_dir)?;
    seed_files_from_filesystem(&app_dir, &bundle_dir)?;
    write_install_marker(marker_path, &bundle, &source_digest)?;
    log::info!(
        "seeded builtin Agent Component '{}' (v{}, source {})",
        bundle.id,
        bundle.version,
        source_digest
    );
    Ok(bundle.id)
}

fn read_bundle_manifest(bundle_dir: &Dir<'_>) -> CoreResult<BuiltinAgentComponentBundle> {
    let manifest = read_utf8_file(bundle_dir, BUNDLE_MANIFEST)?;
    serde_json::from_str(manifest).map_err(|e| {
        CoreError::parse(format!(
            "invalid bundled Agent Component bundle.json: {}",
            e
        ))
    })
}

fn read_filesystem_bundle_manifest(
    relative_bundle_dir: &Path,
) -> CoreResult<BuiltinAgentComponentBundle> {
    let bundle_dir = filesystem_bundles_root().join(relative_bundle_dir);
    let manifest_path = bundle_dir.join(BUNDLE_MANIFEST);
    if !manifest_path.exists() {
        return Err(CoreError::validation(format!(
            "missing required Agent Component bundle file {} in {}",
            BUNDLE_MANIFEST,
            bundle_dir.display()
        )));
    }

    let manifest = std::fs::read_to_string(&manifest_path)?;
    serde_json::from_str(&manifest).map_err(|e| {
        CoreError::parse(format!(
            "invalid bundled Agent Component bundle.json: {}",
            e
        ))
    })
}

fn is_installed_current(
    marker_path: &Path,
    bundle: &BuiltinAgentComponentBundle,
    source_digest: &str,
) -> bool {
    let Ok(content) = std::fs::read_to_string(marker_path) else {
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

fn write_install_marker<P: AsRef<Path>>(
    marker_path: P,
    bundle: &BuiltinAgentComponentBundle,
    source_digest: &str,
) -> CoreResult<()> {
    let marker = BuiltinInstallMarker {
        schema_version: 1,
        bundle_id: bundle.id.clone(),
        bundle_version: bundle.version,
        source_digest: source_digest.to_string(),
    };
    let marker_json = serde_json::to_vec_pretty(&marker).map_err(CoreError::from)?;
    write_bytes(marker_path, &marker_json)
}

fn embedded_bundle_digest(bundle_dir: &Dir<'_>) -> CoreResult<String> {
    let mut files = Vec::new();
    collect_files(bundle_dir, &mut files);

    let bundle_root = bundle_dir.path();
    let mut entries = Vec::with_capacity(files.len());
    for file in files {
        let relative = file.path().strip_prefix(bundle_root).map_err(|_| {
            CoreError::validation(format!(
                "unexpected bundled Agent Component path: {}",
                file.path().display()
            ))
        })?;
        entries.push((relative.to_path_buf(), file.contents()));
    }
    entries.sort_by(|a, b| normalized_digest_path(&a.0).cmp(&normalized_digest_path(&b.0)));

    let mut hasher = Sha256::new();
    for (relative, content) in entries {
        hash_bundle_entry(&mut hasher, &relative, content);
    }
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

fn filesystem_bundle_digest(bundle_dir: &Path) -> CoreResult<String> {
    let mut files = collect_files_from_filesystem(bundle_dir)?;
    files.sort();

    let mut hasher = Sha256::new();
    for file in files {
        let relative = file.strip_prefix(bundle_dir).map_err(|_| {
            CoreError::validation(format!(
                "unexpected bundled Agent Component path: {}",
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

fn validate_bundle_manifest_at_path(
    bundle: &BuiltinAgentComponentBundle,
    bundle_dir: &Path,
) -> CoreResult<()> {
    if bundle.schema_version != 1 {
        return Err(CoreError::validation(format!(
            "unsupported Agent Component bundle schema version {} in {}",
            bundle.schema_version,
            bundle_dir.display()
        )));
    }
    if bundle.id.trim().is_empty() {
        return Err(CoreError::validation(format!(
            "Agent Component bundle id cannot be empty in {}",
            bundle_dir.display()
        )));
    }
    if bundle.version == 0 {
        return Err(CoreError::validation(format!(
            "Agent Component bundle version must be positive in {}",
            bundle_dir.display()
        )));
    }
    Ok(())
}

fn seed_files(app_dir: &Path, bundle_dir: &Dir<'_>) -> CoreResult<()> {
    let mut files = Vec::new();
    collect_files(bundle_dir, &mut files);

    let bundle_root = bundle_dir.path();
    for file in files {
        let relative = file.path().strip_prefix(bundle_root).map_err(|_| {
            CoreError::validation(format!(
                "unexpected bundled Agent Component path: {}",
                file.path().display()
            ))
        })?;
        if is_root_file(relative, BUNDLE_MANIFEST) {
            continue;
        }
        write_bytes(app_dir.join(relative), file.contents())?;
    }

    let mut manifest: AgentComponentManifest =
        serde_json::from_str(read_utf8_file(bundle_dir, AGENT_COMPONENT_MANIFEST)?)?;
    manifest.level = AgentComponentLevel::User;
    AgentComponentManager::validate_manifest(&mut manifest)?;
    Ok(())
}

fn seed_files_from_filesystem(app_dir: &Path, bundle_dir: &Path) -> CoreResult<()> {
    let files = collect_files_from_filesystem(bundle_dir)?;

    for file in files {
        let relative = file.strip_prefix(bundle_dir).map_err(|_| {
            CoreError::validation(format!(
                "unexpected bundled Agent Component path: {}",
                file.display()
            ))
        })?;
        if is_root_file(relative, BUNDLE_MANIFEST) {
            continue;
        }
        write_bytes(app_dir.join(relative), &std::fs::read(&file)?)?;
    }

    let manifest_path = bundle_dir.join(AGENT_COMPONENT_MANIFEST);
    let mut manifest: AgentComponentManifest =
        serde_json::from_str(&std::fs::read_to_string(manifest_path)?)?;
    manifest.level = AgentComponentLevel::User;
    AgentComponentManager::validate_manifest(&mut manifest)?;
    Ok(())
}

fn collect_files_from_filesystem(dir: &Path) -> CoreResult<Vec<PathBuf>> {
    let mut files = Vec::new();
    collect_files_from_filesystem_into(dir, &mut files)?;
    Ok(files)
}

fn collect_files_from_filesystem_into(dir: &Path, out: &mut Vec<PathBuf>) -> CoreResult<()> {
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

fn read_utf8_file<'a>(dir: &'a Dir<'a>, name: &str) -> CoreResult<&'a str> {
    let file = dir.get_file(name).ok_or_else(|| {
        CoreError::validation(format!(
            "missing required Agent Component bundle file {} in {}",
            name,
            dir.path().display()
        ))
    })?;
    file.contents_utf8().ok_or_else(|| {
        CoreError::parse(format!(
            "bundled Agent Component file is not valid UTF-8: {}/{}",
            dir.path().display(),
            name
        ))
    })
}

fn is_root_file(path: &Path, name: &str) -> bool {
    path.parent().is_none() && path.file_name().is_some_and(|value| value == name)
}

fn write_bytes<P: AsRef<Path>>(path: P, content: &[u8]) -> CoreResult<()> {
    if let Some(parent) = path.as_ref().parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, content)?;
    Ok(())
}

fn filesystem_bundles_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("bundles")
        .join("agent-components")
}

fn user_agent_component_dir(app_id: &str) -> PathBuf {
    get_path_manager_arc()
        .user_agent_components_dir()
        .join(app_id)
}
