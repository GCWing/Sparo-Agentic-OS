//! Built-in Product App and Component packages bundled from `bundles/apps` and
//! `bundles/components`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use include_dir::{include_dir, Dir, File};
use serde_json::Value;

use crate::infrastructure::PathManager;
use crate::util::errors::{BitFunError, BitFunResult};

use super::{
    AppCatalogEntry, ComponentDefinition, ComponentLock, ProductAppResolveRequest,
    ProductAppResolver, ResolvedProductApp,
};

static BUILTIN_PRODUCT_APPS_DIR: Dir<'_> =
    include_dir!("$CARGO_MANIFEST_DIR/../../../bundles/apps");
static BUILTIN_COMPONENTS_DIR: Dir<'_> =
    include_dir!("$CARGO_MANIFEST_DIR/../../../bundles/components");

const APP_JSON: &str = "app.json";
const APP_LOCK_JSON: &str = "app.lock.json";
const COMPONENT_JSON: &str = "component.json";

pub async fn seed_builtin_product_app_packages(
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
    for app_source in collect_product_app_package_sources() {
        match seed_product_app_package(path_manager, &app_source).await {
            Ok(app_dir) => installed_app_dirs.push(app_dir),
            Err(error) => log::warn!(
                "seed builtin product app package '{}' failed: {}",
                app_source.display(),
                error
            ),
        }
    }

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
    Ok(list_installed_product_apps(path_manager)
        .await?
        .into_iter()
        .map(|app| app.catalog_entry)
        .collect())
}

pub async fn list_installed_product_apps(
    path_manager: &PathManager,
) -> BitFunResult<Vec<ResolvedProductApp>> {
    let shared_components = read_installed_shared_components(path_manager).await?;
    let mut apps = Vec::new();

    for app_dir in collect_installed_product_app_dirs(&path_manager.system_product_apps_dir())? {
        let package = ProductAppResolver::read_product_app_package(&app_dir).await?;
        let lock = ProductAppResolver::read_lock(&app_dir).await?;
        let components =
            components_for_lock(&package.private_components, &shared_components, &lock)?;
        apps.push(ProductAppResolver::build_runtime_projection(
            package.app,
            components,
            lock,
        )?);
    }

    apps.sort_by(|left, right| {
        left.app
            .name
            .to_lowercase()
            .cmp(&right.app.name.to_lowercase())
            .then_with(|| left.app.id.cmp(&right.app.id))
    });
    Ok(apps)
}

pub async fn list_installed_components(
    path_manager: &PathManager,
) -> BitFunResult<Vec<ComponentDefinition>> {
    let mut components = read_installed_shared_components(path_manager).await?;
    for app in list_installed_product_apps(path_manager).await? {
        components.extend(app.components);
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

async fn seed_product_app_package(
    path_manager: &PathManager,
    source_dir: &Path,
) -> BitFunResult<PathBuf> {
    let app = read_source_app_definition(source_dir)?;
    let dest_dir = path_manager.system_product_app_version_dir(&app.id, &app.version);
    reset_dir(&dest_dir, &path_manager.system_product_apps_dir())?;
    copy_source_dir(source_dir, &dest_dir, CopyMode::ProductAppPackage)?;
    Ok(dest_dir)
}

async fn refresh_installed_app_lock(
    app_dir: &Path,
    shared_components: &[ComponentDefinition],
) -> BitFunResult<String> {
    let package = ProductAppResolver::read_product_app_package(app_dir).await?;
    let resolved = ProductAppResolver::resolve_install(ProductAppResolveRequest {
        app: package.app,
        private_components: package.private_components,
        shared_components: shared_components.to_vec(),
    })?;
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

#[derive(Debug, Clone, Copy)]
enum CopyMode {
    ProductAppPackage,
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
        CopyMode::ProductAppPackage => filesystem_product_apps_root().join(source_dir),
        CopyMode::ComponentPackage => filesystem_components_root().join(source_dir),
    }
}

fn embedded_source_dir(source_dir: &Path, mode: CopyMode) -> Option<&'static Dir<'static>> {
    let normalized = source_dir.to_string_lossy().replace('\\', "/");
    match mode {
        CopyMode::ProductAppPackage => BUILTIN_PRODUCT_APPS_DIR.get_dir(normalized.as_str()),
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
    collect_installed_package_dirs(root, APP_JSON)
}

fn collect_component_package_dirs(root: &Path) -> BitFunResult<Vec<PathBuf>> {
    collect_installed_package_dirs(root, COMPONENT_JSON)
}

fn collect_installed_package_dirs(root: &Path, marker: &str) -> BitFunResult<Vec<PathBuf>> {
    let mut out = Vec::new();
    if !root.exists() {
        return Ok(out);
    }
    collect_installed_package_dirs_into(root, marker, &mut out)?;
    out.sort();
    Ok(out)
}

fn collect_installed_package_dirs_into(
    dir: &Path,
    marker: &str,
    out: &mut Vec<PathBuf>,
) -> BitFunResult<()> {
    if dir.join(marker).is_file() {
        out.push(dir.to_path_buf());
        return Ok(());
    }

    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            collect_installed_package_dirs_into(&path, marker, out)?;
        }
    }
    Ok(())
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
        .join("apps")
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
    use super::*;
    use crate::app_platform::ProductAppLaunchScopeRequirement;
    use std::collections::BTreeSet;

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
            let resolved = ProductAppResolver::resolve_install(ProductAppResolveRequest {
                app: package.app,
                private_components: package.private_components,
                shared_components: shared_components.clone(),
            })
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
            "builtin-app-studio",
            "builtin-coding",
            "builtin-component-studio",
            "builtin-cowork",
            "builtin-deep-research",
            "builtin-design",
            "builtin-harmony-dev",
            "builtin-ppt-live",
            "builtin-remotion-live",
            "builtin-spark-board",
        ] {
            assert!(app_ids.contains(expected), "{expected} should be packaged");
        }
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

        let resolved = ProductAppResolver::resolve_install(ProductAppResolveRequest {
            app: package.app,
            private_components: package.private_components,
            shared_components,
        })
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

        let resolved = ProductAppResolver::resolve_install(ProductAppResolveRequest {
            app: package.app,
            private_components: package.private_components,
            shared_components,
        })
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
            entry.component_id == "surface-component-runtime"
                && entry.version.as_deref() == Some("1.0.0")
        }));
    }
}
