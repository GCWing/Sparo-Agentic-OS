use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{CoreError, CoreResult};
use crate::infrastructure::PathManager;

use super::native::is_native_system_lifecycle_id;
use super::{
    AppCatalogVisibility, AppManagementAction, ProductAppCatalogEntry, ProductAppCatalogSourceKind,
    ProductAppCatalogSourceRef, ProductAppLibrarySource, ProductAppManagementOrigin,
    ProductAppManagementPolicy, ProductAppUninstallPolicy, ResolvedProductApp,
};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProductAppCatalogState {
    #[serde(default)]
    apps: BTreeMap<String, ProductAppCatalogStateEntry>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductAppCatalogStateEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    installed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    installed_from: Option<ProductAppCatalogSourceKind>,
    #[serde(default, skip_serializing_if = "is_false")]
    uninstalled: bool,
}

pub async fn install_product_app(
    path_manager: &PathManager,
    app_id: &str,
    app_version: &str,
) -> CoreResult<()> {
    install_product_app_with_source(path_manager, app_id, app_version, None).await
}

pub async fn install_product_app_with_source(
    path_manager: &PathManager,
    app_id: &str,
    app_version: &str,
    installed_from: Option<ProductAppCatalogSourceKind>,
) -> CoreResult<()> {
    reject_native_system_lifecycle_target(app_id)?;
    ensure_product_app_package_exists(path_manager, app_id, app_version).await?;
    let mut state = load_catalog_state(path_manager).await?;
    let entry = state
        .apps
        .entry(state_key(app_id, app_version))
        .or_default();
    entry.installed = Some(true);
    entry.uninstalled = false;
    entry.enabled = Some(true);
    entry.installed_from = installed_from;
    save_catalog_state(path_manager, &state).await
}

pub(crate) async fn ensure_product_app_seed_installed(
    path_manager: &PathManager,
    app_id: &str,
    app_version: &str,
    installed_from: ProductAppCatalogSourceKind,
) -> CoreResult<()> {
    reject_native_system_lifecycle_target(app_id)?;
    ensure_product_app_package_exists(path_manager, app_id, app_version).await?;
    let mut state = load_catalog_state(path_manager).await?;
    let entry = state
        .apps
        .entry(state_key(app_id, app_version))
        .or_default();
    entry.installed = Some(true);
    entry.uninstalled = false;
    if entry.enabled.is_none() {
        entry.enabled = Some(true);
    }
    entry.installed_from = Some(installed_from);
    save_catalog_state(path_manager, &state).await
}

pub async fn set_product_app_enabled(
    path_manager: &PathManager,
    app_id: &str,
    app_version: &str,
    enabled: bool,
) -> CoreResult<()> {
    reject_native_system_lifecycle_target(app_id)?;
    ensure_product_app_package_exists(path_manager, app_id, app_version).await?;
    let mut state = load_catalog_state(path_manager).await?;
    let visibility = product_app_catalog_visibility(path_manager, app_id, app_version).await?;
    if !product_app_is_installed(state.apps.get(&state_key(app_id, app_version)), visibility) {
        return Err(CoreError::validation(format!(
            "Product App is not installed: {}@{}",
            app_id, app_version
        )));
    }
    let entry = state
        .apps
        .entry(state_key(app_id, app_version))
        .or_default();
    entry.enabled = Some(enabled);
    save_catalog_state(path_manager, &state).await
}

pub async fn uninstall_product_app(
    path_manager: &PathManager,
    app_id: &str,
    app_version: &str,
) -> CoreResult<()> {
    reject_native_system_lifecycle_target(app_id)?;
    validate_catalog_identity("app_id", app_id)?;
    validate_catalog_identity("app_version", app_version)?;
    let mut state = load_catalog_state(path_manager).await?;
    let entry = state
        .apps
        .entry(state_key(app_id, app_version))
        .or_default();
    entry.installed = Some(false);
    entry.enabled = None;
    entry.installed_from = None;
    entry.uninstalled = true;
    save_catalog_state(path_manager, &state).await
}

pub async fn product_app_installed_source_kind(
    path_manager: &PathManager,
    app_id: &str,
    app_version: &str,
) -> CoreResult<Option<ProductAppCatalogSourceKind>> {
    validate_catalog_identity("app_id", app_id)?;
    validate_catalog_identity("app_version", app_version)?;
    let state = load_catalog_state(path_manager).await?;
    Ok(state
        .apps
        .get(&state_key(app_id, app_version))
        .and_then(|entry| entry.installed_from))
}

pub async fn apply_product_app_catalog_source_state(
    path_manager: &PathManager,
    apps: Vec<ResolvedProductApp>,
) -> CoreResult<Vec<ResolvedProductApp>> {
    let state = load_catalog_state(path_manager).await?;
    Ok(apps
        .into_iter()
        .map(|mut app| {
            let key = state_key(&app.app.id, &app.app.version);
            let entry = state.apps.get(&key);
            apply_entry_state(&mut app, entry, false);
            app
        })
        .collect())
}

pub async fn apply_product_app_catalog_state(
    path_manager: &PathManager,
    apps: Vec<ResolvedProductApp>,
) -> CoreResult<Vec<ResolvedProductApp>> {
    let state = load_catalog_state(path_manager).await?;
    let mut projected = Vec::with_capacity(apps.len());
    for mut app in apps {
        let key = state_key(&app.app.id, &app.app.version);
        let entry = state.apps.get(&key);
        if !product_app_is_installed(entry, app.app.catalog_visibility) {
            continue;
        }
        apply_entry_state(&mut app, entry, true);
        projected.push(app);
    }
    Ok(projected)
}

pub(crate) async fn load_product_app_catalog_state(
    path_manager: &PathManager,
) -> CoreResult<ProductAppCatalogState> {
    load_catalog_state(path_manager).await
}

pub(crate) fn apply_product_app_entry_catalog_state(
    catalog_entry: &mut ProductAppCatalogEntry,
    state: &ProductAppCatalogState,
    installed_projection: bool,
) {
    let key = state_key(&catalog_entry.app.id, &catalog_entry.app.version);
    apply_catalog_entry_state(catalog_entry, state.apps.get(&key), installed_projection);
}

fn apply_entry_state(
    app: &mut ResolvedProductApp,
    entry: Option<&ProductAppCatalogStateEntry>,
    installed_projection: bool,
) {
    apply_catalog_entry_state(&mut app.catalog_entry, entry, installed_projection);
    app.app.enabled = app.catalog_entry.app.enabled;
}

fn apply_catalog_entry_state(
    catalog_entry: &mut ProductAppCatalogEntry,
    entry: Option<&ProductAppCatalogStateEntry>,
    installed_projection: bool,
) {
    if let Some(enabled) = entry.and_then(|entry| entry.enabled) {
        catalog_entry.app.enabled = enabled;
    }
    let installed = product_app_is_installed(entry, catalog_entry.app.catalog_visibility);
    let discoverable =
        catalog_entry.app.catalog_visibility == AppCatalogVisibility::Discoverable && !installed;
    catalog_entry.installed = installed_projection && installed;
    catalog_entry.discoverable = !installed_projection && discoverable;
    catalog_entry.library_sources.clear();
    if catalog_entry.installed {
        catalog_entry
            .library_sources
            .push(ProductAppLibrarySource::Installed);
    }
    if catalog_entry.discoverable {
        catalog_entry
            .library_sources
            .push(ProductAppLibrarySource::Discoverable);
    }
    let existing_source = catalog_entry.catalog_source.clone();
    let installed_from = if catalog_entry.installed {
        entry
            .and_then(|entry| entry.installed_from)
            .or_else(|| infer_installed_source_kind(catalog_entry, existing_source.as_ref()))
    } else {
        None
    };
    catalog_entry.management = product_app_management_policy(catalog_entry, installed_from);
    catalog_entry.catalog_source = Some(if installed_projection {
        ProductAppCatalogSourceRef {
            kind: ProductAppCatalogSourceKind::InstalledPackage,
            label: "Installed package".to_string(),
            package_uri: Some(format!(
                "product-app://{}@{}",
                catalog_entry.app.id, catalog_entry.app.version
            )),
        }
    } else {
        existing_source.unwrap_or_else(|| ProductAppCatalogSourceRef {
            kind: ProductAppCatalogSourceKind::BuiltinMarketplace,
            label: "Built-in marketplace source".to_string(),
            package_uri: Some(format!(
                "product-app://{}@{}",
                catalog_entry.app.id, catalog_entry.app.version
            )),
        })
    });
}

fn product_app_management_policy(
    catalog_entry: &super::ProductAppCatalogEntry,
    installed_from: Option<ProductAppCatalogSourceKind>,
) -> ProductAppManagementPolicy {
    if catalog_entry.installed {
        let can_uninstall = installed_from != Some(ProductAppCatalogSourceKind::BuiltinMarketplace);
        let mut actions = vec![AppManagementAction::Disable];
        if can_uninstall {
            actions.push(AppManagementAction::Uninstall);
        }
        return ProductAppManagementPolicy {
            origin: ProductAppManagementOrigin::InstalledPackage,
            actions,
            uninstall: can_uninstall.then_some(ProductAppUninstallPolicy {
                removes_installed_package: true,
                retains_work: true,
                retains_runtime_storage: true,
            }),
        };
    }

    if catalog_entry.update_available {
        return ProductAppManagementPolicy {
            origin: ProductAppManagementOrigin::UpdateSource,
            actions: vec![AppManagementAction::Update],
            uninstall: None,
        };
    }

    if catalog_entry.discoverable {
        return ProductAppManagementPolicy {
            origin: ProductAppManagementOrigin::DiscoverableSource,
            actions: vec![AppManagementAction::Install],
            uninstall: None,
        };
    }

    ProductAppManagementPolicy {
        origin: ProductAppManagementOrigin::Hidden,
        actions: Vec::new(),
        uninstall: None,
    }
}

fn infer_installed_source_kind(
    catalog_entry: &ProductAppCatalogEntry,
    existing_source: Option<&ProductAppCatalogSourceRef>,
) -> Option<ProductAppCatalogSourceKind> {
    if existing_source
        .is_some_and(|source| source.kind == ProductAppCatalogSourceKind::PublishedRelease)
    {
        return Some(ProductAppCatalogSourceKind::PublishedRelease);
    }
    if catalog_entry.app.catalog_visibility == AppCatalogVisibility::Discoverable {
        return Some(ProductAppCatalogSourceKind::BuiltinMarketplace);
    }
    None
}

fn product_app_is_installed(
    entry: Option<&ProductAppCatalogStateEntry>,
    visibility: AppCatalogVisibility,
) -> bool {
    if let Some(entry) = entry {
        if entry.uninstalled {
            return false;
        }
        if let Some(installed) = entry.installed {
            return installed;
        }
    }
    visibility == AppCatalogVisibility::InstalledOnly
}

async fn ensure_product_app_package_exists(
    path_manager: &PathManager,
    app_id: &str,
    app_version: &str,
) -> CoreResult<()> {
    validate_catalog_identity("app_id", app_id)?;
    validate_catalog_identity("app_version", app_version)?;
    let app_json = path_manager
        .system_product_app_version_dir(app_id, app_version)
        .join("app.json");
    if !app_json.exists() {
        return Err(CoreError::NotFound(format!(
            "Product App package not found: {}@{}",
            app_id, app_version
        )));
    }
    Ok(())
}

async fn product_app_catalog_visibility(
    path_manager: &PathManager,
    app_id: &str,
    app_version: &str,
) -> CoreResult<AppCatalogVisibility> {
    validate_catalog_identity("app_id", app_id)?;
    validate_catalog_identity("app_version", app_version)?;
    let app_json = path_manager
        .system_product_app_version_dir(app_id, app_version)
        .join("app.json");
    let bytes = tokio::fs::read(&app_json).await.map_err(|error| {
        CoreError::io(format!("Failed to read {}: {}", app_json.display(), error))
    })?;
    let value: Value = serde_json::from_slice(&bytes).map_err(CoreError::from)?;
    value
        .get("catalogVisibility")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(CoreError::from)?
        .ok_or_else(|| {
            CoreError::validation(format!(
                "Product App package {}@{} does not declare catalogVisibility",
                app_id, app_version
            ))
        })
}

async fn load_catalog_state(path_manager: &PathManager) -> CoreResult<ProductAppCatalogState> {
    let path = path_manager.product_app_catalog_state_path();
    if !path.exists() {
        return Ok(ProductAppCatalogState::default());
    }
    let bytes = tokio::fs::read(&path).await.map_err(|error| {
        CoreError::io(format!(
            "Failed to read Product App catalog state {}: {}",
            path.display(),
            error
        ))
    })?;
    serde_json::from_slice(&bytes).map_err(|error| {
        CoreError::parse(format!(
            "Invalid Product App catalog state {}: {}",
            path.display(),
            error
        ))
    })
}

async fn save_catalog_state(
    path_manager: &PathManager,
    state: &ProductAppCatalogState,
) -> CoreResult<()> {
    let path = path_manager.product_app_catalog_state_path();
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            CoreError::io(format!(
                "Failed to create Product App catalog state dir {}: {}",
                parent.display(),
                error
            ))
        })?;
    }
    let bytes = serde_json::to_vec_pretty(state).map_err(CoreError::from)?;
    tokio::fs::write(&path, bytes).await.map_err(|error| {
        CoreError::io(format!(
            "Failed to write Product App catalog state {}: {}",
            path.display(),
            error
        ))
    })
}

fn state_key(app_id: &str, app_version: &str) -> String {
    format!("{}@{}", app_id, app_version)
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn reject_native_system_lifecycle_target(app_id: &str) -> CoreResult<()> {
    validate_catalog_identity("app_id", app_id)?;
    if is_native_system_lifecycle_id(app_id) {
        return Err(CoreError::validation(format!(
            "Native system apps are always available and cannot be installed, uninstalled, enabled, or disabled: {}",
            app_id
        )));
    }
    Ok(())
}

fn validate_catalog_identity(label: &str, value: &str) -> CoreResult<()> {
    if value.trim().is_empty() {
        return Err(CoreError::validation(format!("{} cannot be empty", label)));
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.')
    {
        return Err(CoreError::validation(format!(
            "{} can only contain ASCII letters, numbers, '.', '-' and '_'",
            label
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn path_manager(test_name: &str) -> PathManager {
        let root = std::env::temp_dir().join(format!(
            "sparo-product-app-catalog-state-{}-{}",
            test_name,
            uuid::Uuid::new_v4().simple()
        ));
        PathManager::with_user_root_for_tests(root)
    }

    async fn write_package(path_manager: &PathManager, app_id: &str, version: &str) {
        let package_dir = path_manager.system_product_app_version_dir(app_id, version);
        tokio::fs::create_dir_all(&package_dir).await.unwrap();
        tokio::fs::write(
            package_dir.join("app.json"),
            r#"{"enabled":true,"catalogVisibility":"discoverable"}"#,
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn catalog_state_overrides_enabled_outside_package_source() {
        let path_manager = path_manager("enabled-override");
        write_package(&path_manager, "remotion-live", "19.0.0").await;

        install_product_app(&path_manager, "remotion-live", "19.0.0")
            .await
            .unwrap();
        set_product_app_enabled(&path_manager, "remotion-live", "19.0.0", false)
            .await
            .unwrap();

        let state_bytes = tokio::fs::read(path_manager.product_app_catalog_state_path())
            .await
            .unwrap();
        let state: ProductAppCatalogState = serde_json::from_slice(&state_bytes).unwrap();
        assert_eq!(
            state
                .apps
                .get("remotion-live@19.0.0")
                .and_then(|entry| entry.enabled),
            Some(false)
        );

        let source = tokio::fs::read_to_string(
            path_manager
                .system_product_app_version_dir("remotion-live", "19.0.0")
                .join("app.json"),
        )
        .await
        .unwrap();
        assert_eq!(
            source,
            r#"{"enabled":true,"catalogVisibility":"discoverable"}"#
        );
    }

    #[tokio::test]
    async fn catalog_state_rejects_path_unsafe_identity() {
        let path_manager = Arc::new(path_manager("unsafe-identity"));

        let error = set_product_app_enabled(&path_manager, "../bad", "1.0.0", false)
            .await
            .expect_err("path-unsafe app ids must be rejected");

        assert!(error.to_string().contains("app_id can only contain"));
    }
}
