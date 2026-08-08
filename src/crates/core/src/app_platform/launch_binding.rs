use std::collections::BTreeSet;

use crate::error::{CoreError, CoreResult};

use super::catalog::{AppDefinition, ComponentKind, ComponentSource, ProductAppLaunchKind};

const OS_NATIVE_AGENT_IDS: &[&str] = &["OSAgent", "Runno", "AppBuilder"];

const SYSTEM_BUILTIN_PRODUCT_APP_AGENT_IDS: &[&str] = &[
    "bitfun-coder",
    "bitfun-plan",
    "bitfun-debug",
    "bitfun-team",
    "Cowork",
    "Design",
    "DeepResearch",
];

pub fn is_os_native_agent_id(agent_id: &str) -> bool {
    OS_NATIVE_AGENT_IDS.contains(&agent_id)
}

pub fn is_system_builtin_product_app_agent_id(agent_id: &str) -> bool {
    SYSTEM_BUILTIN_PRODUCT_APP_AGENT_IDS.contains(&agent_id)
}

pub fn validate_product_app_launch_binding(app: &AppDefinition) -> CoreResult<()> {
    let Some(launch) = app.launch.as_ref() else {
        return Err(CoreError::validation(format!(
            "Product App {}@{} must declare a launch entry",
            app.id, app.version
        )));
    };

    match launch.kind {
        ProductAppLaunchKind::ApplicationSurface => {
            if launch.target_id == app.id {
                Ok(())
            } else {
                Err(CoreError::validation(format!(
                    "Product App {}@{} applicationSurface launch target must be the app id",
                    app.id, app.version
                )))
            }
        }
        ProductAppLaunchKind::AppBuilder => {
            validate_app_builder_launch(app, &launch.target_id, launch.agent_type.as_deref())
        }
        ProductAppLaunchKind::AgentSession => {
            let private_agent_component_ids = app_private_agent_component_ids(app);
            validate_agent_launch_id(
                app,
                "launch.targetId",
                &launch.target_id,
                &private_agent_component_ids,
            )?;
            if let Some(agent_type) = launch.agent_type.as_deref() {
                validate_agent_launch_id(
                    app,
                    "launch.agentType",
                    agent_type,
                    &private_agent_component_ids,
                )?;
            }
            Ok(())
        }
    }
}

fn validate_app_builder_launch(
    app: &AppDefinition,
    target_id: &str,
    agent_type: Option<&str>,
) -> CoreResult<()> {
    if target_id != "AppBuilder" {
        return Err(CoreError::validation(format!(
            "Product App {}@{} appBuilder launch target must be AppBuilder",
            app.id, app.version
        )));
    }
    if agent_type.map_or(true, |id| id == "AppBuilder") {
        Ok(())
    } else {
        Err(CoreError::validation(format!(
            "Product App {}@{} appBuilder launch agentType must be AppBuilder when present",
            app.id, app.version
        )))
    }
}

fn validate_agent_launch_id(
    app: &AppDefinition,
    field: &str,
    agent_id: &str,
    private_agent_component_ids: &BTreeSet<&str>,
) -> CoreResult<()> {
    if agent_id.trim().is_empty() {
        return Err(CoreError::validation(format!(
            "Product App {}@{} {} must not be empty",
            app.id, app.version, field
        )));
    }

    if is_os_native_agent_id(agent_id)
        || is_system_builtin_product_app_agent_id(agent_id)
        || private_agent_component_ids.contains(agent_id)
    {
        return Ok(());
    }

    Err(CoreError::validation(format!(
        "Product App {}@{} {} references undeclared agent '{}'; use an OS native agent, a system built-in Product App agent, or an app-private Agent Component",
        app.id, app.version, field, agent_id
    )))
}

fn app_private_agent_component_ids(app: &AppDefinition) -> BTreeSet<&str> {
    app.components
        .iter()
        .filter(|component| {
            component.kind == ComponentKind::Agent && component.source == ComponentSource::Private
        })
        .map(|component| component.component_id.as_str())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_platform::catalog::{
        AppCatalogVisibility, AppComponentRef, AppIconSpec, AppInstallScope, AppInteractionModel,
        AppWorkMultiplicity, ComponentKind, ComponentSource, ProductAppLaunch,
        ProductAppLaunchKind, ProductAppLaunchScopeRequirement, WorkObjectKind, WorkObjectScope,
    };
    use crate::app_platform::permissions::AppPermissionSummary;

    #[test]
    fn accepts_os_native_runno_backend() {
        let mut app = test_app(ProductAppLaunchKind::AgentSession, "Runno");
        app.launch.as_mut().unwrap().agent_type = Some("Runno".to_string());

        validate_product_app_launch_binding(&app)
            .expect("explicit Runno Product App backend is valid");
    }

    #[test]
    fn accepts_system_builtin_product_app_agent() {
        let mut app = test_app(ProductAppLaunchKind::AgentSession, "bitfun-coder");
        app.launch.as_mut().unwrap().agent_type = Some("bitfun-coder".to_string());

        validate_product_app_launch_binding(&app)
            .expect("system built-in Product App agent is valid");
    }

    #[test]
    fn accepts_app_private_agent_component() {
        let mut app = test_app(ProductAppLaunchKind::AgentSession, "private-agent");
        app.components.push(AppComponentRef {
            component_id: "private-agent".to_string(),
            kind: ComponentKind::Agent,
            source: ComponentSource::Private,
            role: "backend".to_string(),
            version: None,
            capabilities: vec![],
            uses_capabilities: vec!["model.invoke".to_string()],
        });

        validate_product_app_launch_binding(&app)
            .expect("app-private Agent Component launch is valid");
    }

    #[test]
    fn rejects_undeclared_agent_id() {
        let app = test_app(ProductAppLaunchKind::AgentSession, "LegacyGeneralAgent");

        let error = validate_product_app_launch_binding(&app)
            .expect_err("legacy undeclared agent ids must be rejected");

        assert!(error.to_string().contains("undeclared agent"));
        assert!(error.to_string().contains("LegacyGeneralAgent"));
    }

    fn test_app(kind: ProductAppLaunchKind, target_id: &str) -> AppDefinition {
        AppDefinition {
            id: "test-app".to_string(),
            version: "1.0.0".to_string(),
            name: "Test App".to_string(),
            description: "Test app".to_string(),
            authors: Vec::new(),
            i18n: Default::default(),
            interaction_model: AppInteractionModel::Conversation,
            runtime_interaction: None,
            work_multiplicity: AppWorkMultiplicity::Multiple,
            work_object_kinds: vec![WorkObjectKind {
                id: "task".to_string(),
                label: "Task".to_string(),
                scope: WorkObjectScope::Workspace,
                reusable_across_works: false,
                identity_schema: serde_json::json!({}),
                context_schema: serde_json::json!({}),
            }],
            data_lifecycle: None,
            truth_source: None,
            primary_surface: None,
            primary_surface_mode: None,
            components: vec![],
            component_lock_id: String::new(),
            permissions: AppPermissionSummary {
                fs: false,
                net: false,
                shell: false,
                gui: false,
                secrets: false,
                ai: true,
            },
            os_capabilities: vec!["model.invoke".to_string()],
            install_scope: AppInstallScope::System,
            catalog_visibility: AppCatalogVisibility::InstalledOnly,
            enabled: true,
            icon: AppIconSpec::Monogram {
                label: "T".to_string(),
                seed: None,
                background: None,
            },
            category: "test".to_string(),
            tags: vec![],
            launch: Some(ProductAppLaunch {
                kind,
                target_id: target_id.to_string(),
                scope_requirement: ProductAppLaunchScopeRequirement::SystemAllowed,
                agent_type: None,
                surface_id: None,
            }),
        }
    }
}
