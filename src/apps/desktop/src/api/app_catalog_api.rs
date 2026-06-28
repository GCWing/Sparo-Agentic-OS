//! Product App catalog and Component Center API.

use std::collections::BTreeMap;

use crate::api::app_state::AppState;
use bitfun_core::app_platform::{
    create_component_package as write_component_package,
    create_product_app_package as write_product_app_package,
    list_installed_components as list_installed_package_components,
    list_installed_product_app_catalog, list_installed_product_apps,
    seed_builtin_product_app_packages, AppCatalogEntry, AppCatalogVisibility, ComponentDefinition,
    ComponentKind, CreateComponentPackageDraft, CreateProductAppPackageDraft,
    WrittenComponentPackage, WrittenProductAppPackage,
};
use bitfun_core::surface_component::{
    resolve_builtin_surface_component_bundle_id, seed_builtin_surface_components,
};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetComponentRequest {
    pub component_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<ComponentKind>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentHealthRequest {
    pub component_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<ComponentKind>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentHealthResponse {
    pub component_id: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentUsageRequest {
    pub component_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<ComponentKind>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentUsageResponse {
    pub component_id: String,
    pub used_by_apps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveProductAppSurfaceRequest {
    pub app_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_component_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedProductAppSurface {
    pub product_app_id: String,
    pub product_app_version: String,
    pub component_lock_digest: String,
    pub surface_component_id: String,
    pub surface_id: String,
    pub implementation_ref: String,
    pub runtime_surface_id: String,
}

#[tauri::command]
pub async fn create_product_app_package(
    state: State<'_, AppState>,
    request: CreateProductAppPackageDraft,
) -> Result<WrittenProductAppPackage, String> {
    let path_manager = state.workspace_service.path_manager().clone();
    write_product_app_package(&path_manager, request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_component_package(
    state: State<'_, AppState>,
    request: CreateComponentPackageDraft,
) -> Result<WrittenComponentPackage, String> {
    let path_manager = state.workspace_service.path_manager().clone();
    write_component_package(&path_manager, request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_app_catalog(state: State<'_, AppState>) -> Result<Vec<AppCatalogEntry>, String> {
    let path_manager = state.workspace_service.path_manager().clone();
    if let Err(error) = seed_builtin_product_app_packages(&path_manager).await {
        log::warn!(
            "Failed to seed built-in Product App packages before catalog listing: {}",
            error
        );
    }

    let mut entries = list_installed_product_app_catalog(&path_manager)
        .await
        .map_err(|e| e.to_string())?;
    entries.retain(|entry| entry.app.catalog_visibility != AppCatalogVisibility::Hidden);
    entries.sort_by(|left, right| {
        app_visibility_rank(left.app.catalog_visibility)
            .cmp(&app_visibility_rank(right.app.catalog_visibility))
            .then_with(|| {
                left.app
                    .name
                    .to_lowercase()
                    .cmp(&right.app.name.to_lowercase())
            })
            .then_with(|| left.app.id.cmp(&right.app.id))
    });
    Ok(entries)
}

#[tauri::command]
pub async fn list_components(
    state: State<'_, AppState>,
) -> Result<Vec<ComponentDefinition>, String> {
    let path_manager = state.workspace_service.path_manager().clone();
    if let Err(error) = seed_builtin_product_app_packages(&path_manager).await {
        log::warn!(
            "Failed to seed built-in Product App packages before component listing: {}",
            error
        );
    }

    let components = list_installed_package_components(&path_manager)
        .await
        .map_err(|e| e.to_string())?;
    Ok(dedupe_components(components))
}

#[tauri::command]
pub async fn resolve_product_app_surface(
    state: State<'_, AppState>,
    request: ResolveProductAppSurfaceRequest,
) -> Result<ResolvedProductAppSurface, String> {
    let path_manager = state.workspace_service.path_manager().clone();
    if let Err(error) = seed_builtin_product_app_packages(&path_manager).await {
        log::warn!(
            "Failed to seed built-in Product App packages before surface resolution: {}",
            error
        );
    }

    let apps = list_installed_product_apps(&path_manager)
        .await
        .map_err(|e| e.to_string())?;
    let app = apps
        .into_iter()
        .find(|entry| entry.app.id == request.app_id)
        .ok_or_else(|| format!("Product App not found: {}", request.app_id))?;
    let surface_component_id = request
        .surface_component_id
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| app.app.primary_surface.component_id.clone());
    let surface_id = request
        .surface_id
        .filter(|id| !id.trim().is_empty())
        .or_else(|| app.app.primary_surface.surface_id.clone())
        .unwrap_or_else(|| "primary".to_string());

    let surface_component = app
        .components
        .iter()
        .find(|component| {
            component.kind == ComponentKind::Surface && component.id == surface_component_id
        })
        .ok_or_else(|| {
            format!(
                "Product App {} does not resolve surface component {}",
                app.app.id, surface_component_id
            )
        })?;
    let implementation_ref = surface_component
        .implementation_ref
        .clone()
        .ok_or_else(|| format!("Surface component {} has no implementationRef", surface_component_id))?;
    let runtime_surface_id = resolve_runtime_surface_id(&implementation_ref).await?;

    if let Err(error) = seed_builtin_surface_components(&state.surface_component_manager).await {
        log::warn!(
            "Failed to seed built-in surface runtime before Product App open: {}",
            error
        );
    }

    Ok(ResolvedProductAppSurface {
        product_app_id: app.app.id,
        product_app_version: app.app.version,
        component_lock_digest: app.lock.digest(),
        surface_component_id,
        surface_id,
        implementation_ref,
        runtime_surface_id,
    })
}

#[tauri::command]
pub async fn get_component(
    state: State<'_, AppState>,
    request: GetComponentRequest,
) -> Result<ComponentDefinition, String> {
    let components = list_components(state).await?;
    components
        .into_iter()
        .find(|component| {
            component.id == request.component_id
                && request.kind.map_or(true, |kind| component.kind == kind)
        })
        .ok_or_else(|| format!("Component not found: {}", request.component_id))
}

#[tauri::command]
pub async fn component_health(
    state: State<'_, AppState>,
    request: ComponentHealthRequest,
) -> Result<ComponentHealthResponse, String> {
    let component = get_component(
        state,
        GetComponentRequest {
            component_id: request.component_id,
            kind: request.kind,
        },
    )
    .await?;
    Ok(ComponentHealthResponse {
        component_id: component.id,
        status: "available".to_string(),
        detail: "Component definition is registered by a Product App or Component package."
            .to_string(),
    })
}

#[tauri::command]
pub async fn component_usage(
    state: State<'_, AppState>,
    request: ComponentUsageRequest,
) -> Result<ComponentUsageResponse, String> {
    let component = get_component(
        state,
        GetComponentRequest {
            component_id: request.component_id,
            kind: request.kind,
        },
    )
    .await?;
    Ok(ComponentUsageResponse {
        component_id: component.id,
        used_by_apps: component.used_by_apps,
    })
}

async fn resolve_runtime_surface_id(implementation_ref: &str) -> Result<String, String> {
    if let Some(app_id) = resolve_builtin_surface_component_bundle_id(implementation_ref)
        .await
        .map_err(|e| e.to_string())?
    {
        return Ok(app_id);
    }

    if implementation_ref.starts_with("app://") {
        return Err(format!(
            "Product App private surface {} does not declare a runnable surface bundle",
            implementation_ref
        ));
    }

    Err(format!(
        "Unsupported Product App surface implementationRef: {}",
        implementation_ref
    ))
}

fn dedupe_components(components: Vec<ComponentDefinition>) -> Vec<ComponentDefinition> {
    let mut by_identity = BTreeMap::<String, ComponentDefinition>::new();
    for component in components {
        let key = component.fqid();
        by_identity
            .entry(key)
            .and_modify(|existing| merge_component_projection(existing, &component))
            .or_insert(component);
    }
    let mut components = by_identity.into_values().collect::<Vec<_>>();
    components.sort_by(|left, right| {
        component_kind_rank(left.kind)
            .cmp(&component_kind_rank(right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.fqid().cmp(&right.fqid()))
    });
    components
}

fn merge_component_projection(existing: &mut ComponentDefinition, component: &ComponentDefinition) {
    for app in &component.used_by_apps {
        if !existing.used_by_apps.contains(app) {
            existing.used_by_apps.push(app.clone());
        }
    }
    for capability in &component.capabilities {
        if !existing
            .capabilities
            .iter()
            .any(|item| item.id == capability.id)
        {
            existing.capabilities.push(capability.clone());
        }
    }
}

fn component_kind_rank(kind: ComponentKind) -> u8 {
    match kind {
        ComponentKind::Surface => 0,
        ComponentKind::Agent => 1,
        ComponentKind::Bridge => 2,
        ComponentKind::Runtime => 3,
        ComponentKind::Tool => 4,
        ComponentKind::Skill => 5,
    }
}

fn app_visibility_rank(visibility: AppCatalogVisibility) -> u8 {
    match visibility {
        AppCatalogVisibility::Discoverable => 0,
        AppCatalogVisibility::InstalledOnly => 1,
        AppCatalogVisibility::Hidden => 2,
    }
}
