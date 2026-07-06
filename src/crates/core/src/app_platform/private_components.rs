//! App-private Product App component runtime binding.

use super::{ComponentDefinition, ComponentKind, ResolvedProductApp};
use crate::agent_component::AgentComponentManager;
use crate::bridge_component::BridgeComponentManager;
use crate::error::{CoreError, CoreResult};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct ProductAppPrivateComponentRegistration {
    pub private_bridge_package_dirs: HashMap<String, PathBuf>,
    pub private_agent_component_ids: Vec<String>,
}

pub fn private_component_source_dir(
    app: &ResolvedProductApp,
    component: &ComponentDefinition,
) -> CoreResult<Option<PathBuf>> {
    if component.owner_app.is_none() {
        return Ok(None);
    }
    let package_dir = app.package_dir.as_ref().ok_or_else(|| {
        CoreError::Validation(format!(
            "Product App {}@{} has no package directory for private component {}",
            app.app.id, app.app.version, component.id
        ))
    })?;
    let source_dir = package_dir
        .join("components")
        .join(component.kind.path_segment())
        .join(&component.id)
        .join("source");
    if !source_dir.is_dir() {
        return Err(CoreError::Validation(format!(
            "Product App {}@{} private component {} must include source/ at {}",
            app.app.id,
            app.app.version,
            component.id,
            source_dir.display()
        )));
    }
    Ok(Some(source_dir))
}

pub fn collect_private_bridge_package_dirs(
    app: &ResolvedProductApp,
) -> CoreResult<HashMap<String, PathBuf>> {
    let mut dirs = HashMap::new();
    for component in &app.components {
        if component.kind != ComponentKind::Bridge || component.owner_app.is_none() {
            continue;
        }
        if let Some(source_dir) = private_component_source_dir(app, component)? {
            dirs.insert(component.id.clone(), source_dir);
        }
    }
    Ok(dirs)
}

pub async fn register_private_product_app_runtime_components(
    app: &ResolvedProductApp,
) -> CoreResult<ProductAppPrivateComponentRegistration> {
    let private_bridge_package_dirs = collect_private_bridge_package_dirs(app)?;
    for (component_id, package_dir) in &private_bridge_package_dirs {
        BridgeComponentManager::register_private_package_dir(component_id, package_dir.clone())
            .map_err(|error| {
                CoreError::Validation(format!(
                    "Failed to register private Bridge Component {} for Product App {}@{}: {}",
                    component_id, app.app.id, app.app.version, error
                ))
            })?;
    }

    let mut private_agent_component_ids = Vec::new();
    for component in &app.components {
        if component.kind != ComponentKind::Agent || component.owner_app.is_none() {
            continue;
        }
        let Some(source_dir) = private_component_source_dir(app, component)? else {
            continue;
        };
        let package =
            AgentComponentManager::load_package_from_dir(&source_dir).map_err(|error| {
                CoreError::Validation(format!(
                    "Failed to load private Agent Component {} for Product App {}@{}: {}",
                    component.id, app.app.id, app.app.version, error
                ))
            })?;
        if package.manifest.id != component.id {
            return Err(CoreError::Validation(format!(
                "Private Agent Component package id '{}' does not match component '{}'",
                package.manifest.id, component.id
            )));
        }
        AgentComponentManager::register_package(&package).map_err(|error| {
            CoreError::Validation(format!(
                "Failed to register private Agent Component {} for Product App {}@{}: {}",
                component.id, app.app.id, app.app.version, error
            ))
        })?;
        AgentComponentManager::register_runtime_tools_for_package(
            &package,
            private_bridge_package_dirs.clone(),
        )
        .await
        .map_err(|error| {
            CoreError::Validation(format!(
                "Failed to register private Agent Component tools {} for Product App {}@{}: {}",
                component.id, app.app.id, app.app.version, error
            ))
        })?;
        private_agent_component_ids.push(component.id.clone());
    }

    Ok(ProductAppPrivateComponentRegistration {
        private_bridge_package_dirs,
        private_agent_component_ids,
    })
}
