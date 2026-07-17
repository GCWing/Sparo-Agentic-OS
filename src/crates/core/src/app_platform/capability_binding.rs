use std::collections::BTreeSet;

use crate::error::{CoreError, CoreResult};

use super::catalog::{AppComponentRef, AppDefinition, ComponentDefinition};
use super::permissions::AppPermissionSummary;

const OS_ATOMIC_CAPABILITIES: &[&str] = &[
    "filesystem.read",
    "filesystem.write",
    "terminal.run",
    "process.spawn",
    "git.read",
    "git.write",
    "browser.navigate",
    "browser.inspect",
    "workspace.inspect",
    "workspace.modify",
    "session.read",
    "session.write",
    "memory.read",
    "memory.write",
    "model.invoke",
    "tool.invoke",
    "component.register",
    "component.run",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CoarsePermission {
    Fs,
    Net,
    Shell,
    Ai,
}

pub fn known_os_atomic_capabilities() -> &'static [&'static str] {
    OS_ATOMIC_CAPABILITIES
}

pub fn validate_app_capability_bindings(
    app: &AppDefinition,
    components: &[ComponentDefinition],
) -> CoreResult<()> {
    validate_capability_list("app.osCapabilities", &app.os_capabilities)?;
    validate_declared_capabilities_are_permitted(
        &format!("Product App {}@{}", app.id, app.version),
        &app.os_capabilities,
        &app.permissions,
    )?;

    let declared = app
        .os_capabilities
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();

    for component_ref in &app.components {
        validate_component_ref_uses_capabilities(app, &declared, component_ref)?;
    }

    for component in components {
        validate_component_uses_capabilities(app, &declared, component)?;
    }

    Ok(())
}

fn validate_component_ref_uses_capabilities(
    app: &AppDefinition,
    declared: &BTreeSet<&str>,
    component_ref: &AppComponentRef,
) -> CoreResult<()> {
    validate_capability_list(
        &format!(
            "app.components[{}].usesCapabilities",
            component_ref.component_id
        ),
        &component_ref.uses_capabilities,
    )?;
    validate_uses_subset(
        &format!(
            "Product App {}@{} component ref {}",
            app.id, app.version, component_ref.component_id
        ),
        declared,
        &component_ref.uses_capabilities,
    )
}

fn validate_component_uses_capabilities(
    app: &AppDefinition,
    declared: &BTreeSet<&str>,
    component: &ComponentDefinition,
) -> CoreResult<()> {
    validate_capability_list(
        &format!("component {} usesCapabilities", component.id),
        &component.uses_capabilities,
    )?;
    validate_uses_subset(
        &format!(
            "Product App {}@{} component {}",
            app.id, app.version, component.id
        ),
        declared,
        &component.uses_capabilities,
    )
}

fn validate_uses_subset(
    label: &str,
    declared: &BTreeSet<&str>,
    uses_capabilities: &[String],
) -> CoreResult<()> {
    for capability in uses_capabilities {
        if !declared.contains(capability.as_str()) {
            return Err(CoreError::validation(format!(
                "{} uses OS atomic capability '{}' but app.osCapabilities does not declare it",
                label, capability
            )));
        }
    }
    Ok(())
}

fn validate_capability_list(label: &str, capabilities: &[String]) -> CoreResult<()> {
    let mut seen = BTreeSet::new();
    for capability in capabilities {
        validate_known_capability(label, capability)?;
        if !seen.insert(capability.as_str()) {
            return Err(CoreError::validation(format!(
                "{label} contains duplicate OS atomic capability '{}'",
                capability
            )));
        }
    }
    Ok(())
}

fn validate_known_capability(label: &str, capability: &str) -> CoreResult<()> {
    if OS_ATOMIC_CAPABILITIES.contains(&capability) {
        return Ok(());
    }
    Err(CoreError::validation(format!(
        "{label} contains unknown OS atomic capability '{}'",
        capability
    )))
}

fn validate_declared_capabilities_are_permitted(
    label: &str,
    capabilities: &[String],
    permissions: &AppPermissionSummary,
) -> CoreResult<()> {
    for capability in capabilities {
        let Some(permission) = coarse_permission_for_capability(capability) else {
            continue;
        };
        if !permission_enabled(permission, permissions) {
            return Err(CoreError::validation(format!(
                "{} declares OS atomic capability '{}' but permissions.{} is false",
                label,
                capability,
                permission_field(permission)
            )));
        }
    }
    Ok(())
}

fn coarse_permission_for_capability(capability: &str) -> Option<CoarsePermission> {
    match capability {
        "filesystem.read" | "filesystem.write" => Some(CoarsePermission::Fs),
        "terminal.run" | "process.spawn" => Some(CoarsePermission::Shell),
        "browser.navigate" | "browser.inspect" => Some(CoarsePermission::Net),
        "model.invoke" => Some(CoarsePermission::Ai),
        "git.read" | "git.write" => Some(CoarsePermission::Shell),
        _ => None,
    }
}

fn permission_enabled(permission: CoarsePermission, permissions: &AppPermissionSummary) -> bool {
    match permission {
        CoarsePermission::Fs => permissions.fs,
        CoarsePermission::Net => permissions.net,
        CoarsePermission::Shell => permissions.shell,
        CoarsePermission::Ai => permissions.ai,
    }
}

fn permission_field(permission: CoarsePermission) -> &'static str {
    match permission {
        CoarsePermission::Fs => "fs",
        CoarsePermission::Net => "net",
        CoarsePermission::Shell => "shell",
        CoarsePermission::Ai => "ai",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_platform::catalog::{
        AppCatalogVisibility, AppIconSpec, AppInstallScope, AppInteractionModel,
        AppWorkMultiplicity, ComponentKind, ComponentPackageSource, ComponentSource,
        ComponentVisibility, ProductAppLaunch, ProductAppLaunchKind,
        ProductAppLaunchScopeRequirement,
    };

    #[test]
    fn rejects_component_use_not_declared_by_app() {
        let mut app = test_app(vec!["filesystem.read"]);
        app.components[0].uses_capabilities = vec!["terminal.run".to_string()];
        let component = test_component(vec![]);

        let error = validate_app_capability_bindings(&app, &[component])
            .expect_err("component use must be declared by the Product App");

        assert!(error.to_string().contains("app.osCapabilities"));
        assert!(error.to_string().contains("terminal.run"));
    }

    #[test]
    fn rejects_declared_capability_missing_coarse_permission() {
        let mut app = test_app(vec!["terminal.run"]);
        app.permissions.shell = false;

        let error = validate_app_capability_bindings(&app, &[test_component(vec![])])
            .expect_err("terminal capability requires shell permission");

        assert!(error.to_string().contains("permissions.shell"));
    }

    #[test]
    fn accepts_component_use_covered_by_app_capability_and_permission() {
        let mut app = test_app(vec!["filesystem.read", "terminal.run", "model.invoke"]);
        app.components[0].uses_capabilities =
            vec!["filesystem.read".to_string(), "terminal.run".to_string()];
        let component = test_component(vec!["model.invoke"]);

        validate_app_capability_bindings(&app, &[component]).expect("capability binding is valid");
    }

    fn test_app(os_capabilities: Vec<&str>) -> AppDefinition {
        AppDefinition {
            id: "capability-test".to_string(),
            version: "1.0.0".to_string(),
            name: "Capability Test".to_string(),
            description: "Capability test app.".to_string(),
            authors: Vec::new(),
            i18n: Default::default(),
            interaction_model: AppInteractionModel::Conversation,
            runtime_interaction: None,
            work_multiplicity: AppWorkMultiplicity::Multiple,
            work_object_kinds: vec![],
            data_lifecycle: None,
            truth_source: None,
            primary_surface: None,
            primary_surface_mode: None,
            components: vec![AppComponentRef {
                component_id: "agent".to_string(),
                kind: ComponentKind::Agent,
                source: ComponentSource::Private,
                role: "assistant".to_string(),
                version: None,
                capabilities: vec![],
                uses_capabilities: vec![],
            }],
            component_lock_id: String::new(),
            permissions: AppPermissionSummary {
                fs: true,
                shell: true,
                ai: true,
                ..AppPermissionSummary::default()
            },
            os_capabilities: os_capabilities.into_iter().map(str::to_string).collect(),
            install_scope: AppInstallScope::System,
            catalog_visibility: AppCatalogVisibility::Discoverable,
            enabled: true,
            icon: AppIconSpec::Monogram {
                label: "Capability Test".to_string(),
                seed: None,
                background: None,
            },
            category: "test".to_string(),
            tags: vec![],
            launch: Some(ProductAppLaunch {
                kind: ProductAppLaunchKind::AgentSession,
                target_id: "Runno".to_string(),
                scope_requirement: ProductAppLaunchScopeRequirement::SystemAllowed,
                agent_type: Some("Runno".to_string()),
                surface_id: None,
            }),
        }
    }

    fn test_component(uses_capabilities: Vec<&str>) -> ComponentDefinition {
        ComponentDefinition {
            id: "agent".to_string(),
            version: None,
            kind: ComponentKind::Agent,
            name: "Agent".to_string(),
            description: "Agent component.".to_string(),
            package_source: ComponentPackageSource::AppPrivate,
            owner_app: None,
            capabilities: vec![],
            permissions: vec![],
            uses_capabilities: uses_capabilities.into_iter().map(str::to_string).collect(),
            used_by_apps: vec![],
            visibility: ComponentVisibility::AppDependency,
            dependencies: vec![],
            implementation_ref: None,
        }
    }
}
