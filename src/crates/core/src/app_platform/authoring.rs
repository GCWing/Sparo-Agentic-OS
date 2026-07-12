//! Product App and Component package authoring.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::fs;

use crate::error::{CoreError, CoreResult};
use crate::infrastructure::PathManager;

use super::catalog::{
    AppAuthor, AppCatalogVisibility, AppComponentRef, AppDataLifecyclePolicy, AppDefinition,
    AppI18n, AppIconSpec, AppInstallScope, AppInteractionModel, AppSurfaceMode, AppTruthSource,
    AppWorkMultiplicity, CapabilityRef, ComponentDefinition, ComponentKind, ComponentOwnerApp,
    ComponentPackageSource, ComponentSource, ComponentVisibility, PermissionSpec, ProductAppLaunch,
    ProductAppLaunchKind, ProductAppLaunchScopeRequirement, SurfaceRef, WorkObjectKind,
    WorkObjectScope,
};
use super::eval::{
    ProductAppEvalCase, ProductAppEvalEvidenceKind, ProductAppEvalExpectation,
    ProductAppEvalExpectationKind, ProductAppEvalPlan,
};
use super::permissions::AppPermissionSummary;
use super::rehearsal::{
    ProductAppRehearsalAction, ProductAppRehearsalPlan, ProductAppRehearsalScenario,
    ProductAppRehearsalScenarioKind, ProductAppRehearsalStep,
};
use super::resolver::ProductAppResolver;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProductAppPackageDraft {
    pub app_id: String,
    pub name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub authors: Vec<AppAuthor>,
    #[serde(default, skip_serializing_if = "AppI18n::is_empty")]
    pub i18n: AppI18n,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default = "default_agent_type")]
    pub agent_type: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_surface_mode")]
    pub primary_surface_mode: AppSurfaceMode,
    #[serde(default)]
    pub work_multiplicity: Option<AppWorkMultiplicity>,
    #[serde(default)]
    pub truth_source: Option<AppTruthSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateComponentPackageDraft {
    pub component_id: String,
    pub kind: ComponentKind,
    pub name: String,
    pub description: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub implementation_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenProductAppPackage {
    pub app_id: String,
    pub version: String,
    pub component_lock_digest: String,
    pub package_dir: PathBuf,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProductAppPackageOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_agent: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_surface: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProductAppComponentDraft {
    pub package_dir: PathBuf,
    pub component_id: String,
    pub kind: ComponentKind,
    pub name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub implementation_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
    #[serde(default)]
    pub make_primary_surface: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenProductAppComponentScaffold {
    pub app_id: String,
    pub version: String,
    pub component_id: String,
    pub kind: ComponentKind,
    pub role: String,
    pub component_lock_digest: String,
    pub package_dir: PathBuf,
    pub component_dir: PathBuf,
    pub generated_files: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenComponentPackage {
    pub component_id: String,
    pub kind: ComponentKind,
    pub version: String,
    pub package_dir: PathBuf,
}

#[cfg(test)]
pub(crate) async fn create_product_app_package(
    path_manager: &PathManager,
    draft: CreateProductAppPackageDraft,
) -> CoreResult<WrittenProductAppPackage> {
    create_product_app_package_with_options(
        path_manager,
        draft,
        CreateProductAppPackageOptions::default(),
    )
    .await
}

#[cfg(test)]
pub(crate) async fn create_product_app_package_with_options(
    path_manager: &PathManager,
    draft: CreateProductAppPackageDraft,
    options: CreateProductAppPackageOptions,
) -> CoreResult<WrittenProductAppPackage> {
    let package_dir = path_manager.system_product_app_version_dir(&draft.app_id, &draft.version);
    ensure_new_package_dir(&package_dir).await?;
    write_product_app_package(&package_dir, draft, options).await
}

/// Scaffolds a new package directly inside an already-authorized mutable Draft.
///
/// The caller owns the Draft identity and path authorization. This function never derives an
/// install/catalog path and rejects a Draft that already contains package source.
pub async fn scaffold_product_app_draft(
    draft_root: &Path,
    draft: CreateProductAppPackageDraft,
    options: CreateProductAppPackageOptions,
) -> CoreResult<WrittenProductAppPackage> {
    ensure_empty_draft_root(draft_root).await?;
    write_product_app_package(draft_root, draft, options).await
}

async fn write_product_app_package(
    package_dir: &Path,
    draft: CreateProductAppPackageDraft,
    options: CreateProductAppPackageOptions,
) -> CoreResult<WrittenProductAppPackage> {
    validate_package_id("appId", &draft.app_id)?;
    validate_required("name", &draft.name)?;
    validate_required("description", &draft.description)?;
    validate_required("version", &draft.version)?;
    let include_surface = options
        .include_surface
        .unwrap_or(draft.primary_surface_mode != AppSurfaceMode::ChatPrimary);
    let include_agent = resolve_include_agent(&draft, &options, include_surface)?;

    let surface_id = format!("{}-surface", draft.app_id);
    let agent_id = format!("{}-agent", draft.app_id);
    let owner = ComponentOwnerApp {
        app_id: draft.app_id.clone(),
        app_version: draft.version.clone(),
    };

    let work_object = WorkObjectKind {
        id: "primary-work".to_string(),
        label: "Primary Work".to_string(),
        scope: WorkObjectScope::Global,
        identity_schema: json!({
            "type": "object",
            "required": ["workId"],
            "properties": {
                "workId": { "type": "string" }
            }
        }),
        context_schema: json!({
            "type": "object",
            "properties": {
                "description": { "type": "string" }
            }
        }),
    };

    let primary_surface_definition = include_surface.then(|| ComponentDefinition {
        id: surface_id.clone(),
        version: None,
        kind: ComponentKind::Surface,
        name: format!("{} Surface", draft.name),
        description: "Primary Product App surface generated by App Builder.".to_string(),
        package_source: ComponentPackageSource::AppPrivate,
        owner_app: Some(owner.clone()),
        capabilities: vec![
            CapabilityRef {
                id: "context.publish".to_string(),
                title: "Publish structured work context".to_string(),
                description: "Publishes Work-owned context for AI collaboration.".to_string(),
                actions: vec!["context.publish".to_string()],
            },
            CapabilityRef {
                id: "selection.describe".to_string(),
                title: "Describe selection".to_string(),
                description:
                    "Describes the current object or selection without owning durable state."
                        .to_string(),
                actions: vec!["selection.describe".to_string()],
            },
        ],
        permissions: Vec::new(),
        uses_capabilities: vec!["session.read".to_string(), "component.run".to_string()],
        used_by_apps: vec![draft.app_id.clone()],
        visibility: ComponentVisibility::AppDependency,
        dependencies: Vec::new(),
        implementation_ref: Some(format!(
            "app://{}@{}/surfaces/{}",
            draft.app_id, draft.version, surface_id
        )),
    });

    let agent_component = include_agent.then(|| ComponentDefinition {
        id: agent_id.clone(),
        version: None,
        kind: ComponentKind::Agent,
        name: format!("{} Agent", draft.name),
        description: "Agent component generated by App Builder.".to_string(),
        package_source: ComponentPackageSource::AppPrivate,
        owner_app: Some(owner),
        capabilities: vec![CapabilityRef {
            id: "agent.run".to_string(),
            title: "Run agent session".to_string(),
            description: "Starts the configured agent for this Product App.".to_string(),
            actions: vec!["agent.session.start".to_string()],
        }],
        permissions: vec![PermissionSpec {
            kind: "ai".to_string(),
            summary: "Uses the configured AI agent.".to_string(),
            scopes: vec![draft.agent_type.clone()],
        }],
        uses_capabilities: vec!["model.invoke".to_string(), "tool.invoke".to_string()],
        used_by_apps: vec![draft.app_id.clone()],
        visibility: ComponentVisibility::AppDependency,
        dependencies: Vec::new(),
        implementation_ref: Some(format!("agent://{}", draft.agent_type)),
    });

    let launch = if include_surface {
        ProductAppLaunch {
            kind: ProductAppLaunchKind::ApplicationSurface,
            target_id: draft.app_id.clone(),
            scope_requirement: ProductAppLaunchScopeRequirement::SystemAllowed,
            agent_type: None,
            surface_id: Some("primary".to_string()),
        }
    } else {
        ProductAppLaunch {
            kind: ProductAppLaunchKind::AgentSession,
            target_id: draft.agent_type.clone(),
            scope_requirement: ProductAppLaunchScopeRequirement::WorkspaceOptional,
            agent_type: Some(draft.agent_type.clone()),
            surface_id: None,
        }
    };

    let rehearsal_plan = default_product_app_rehearsal_plan(&draft, include_agent, include_surface);
    let eval_plan = include_agent.then(|| default_product_app_eval_plan(&draft, &agent_id));
    let validation_plan = default_product_app_validation_plan(
        &draft,
        include_agent.then_some(agent_id.as_str()),
        include_surface,
    );
    let work_multiplicity = draft.work_multiplicity.unwrap_or_else(|| {
        if include_surface {
            default_product_app_work_multiplicity_for_surface_mode(draft.primary_surface_mode)
        } else {
            AppWorkMultiplicity::Multiple
        }
    });

    let mut components = Vec::new();
    if include_surface {
        components.push(AppComponentRef {
            component_id: surface_id.clone(),
            kind: ComponentKind::Surface,
            source: ComponentSource::Private,
            role: "primarySurface".to_string(),
            version: None,
            capabilities: Vec::new(),
            uses_capabilities: vec!["session.read".to_string(), "component.run".to_string()],
        });
    }
    if include_agent {
        components.push(AppComponentRef {
            component_id: agent_id.clone(),
            kind: ComponentKind::Agent,
            source: ComponentSource::Private,
            role: "agent".to_string(),
            version: None,
            capabilities: Vec::new(),
            uses_capabilities: vec!["model.invoke".to_string(), "tool.invoke".to_string()],
        });
    }

    let mut app = AppDefinition {
        id: draft.app_id.clone(),
        version: draft.version.clone(),
        name: draft.name.clone(),
        description: draft.description.clone(),
        authors: draft.authors.clone(),
        i18n: draft.i18n.clone(),
        interaction_model: if include_surface {
            AppInteractionModel::InteractiveWorkspace
        } else {
            AppInteractionModel::Conversation
        },
        work_multiplicity,
        work_object_kinds: vec![work_object.clone()],
        data_lifecycle: Some(AppDataLifecyclePolicy::default()),
        truth_source: draft.truth_source,
        primary_surface: include_surface.then(|| SurfaceRef {
            component_id: surface_id.clone(),
            surface_id: Some("primary".to_string()),
        }),
        primary_surface_mode: include_surface.then_some(draft.primary_surface_mode),
        components,
        component_lock_id: String::new(),
        permissions: AppPermissionSummary {
            ai: include_agent,
            ..AppPermissionSummary::default()
        },
        os_capabilities: default_product_app_os_capabilities(include_agent, include_surface),
        install_scope: AppInstallScope::System,
        catalog_visibility: AppCatalogVisibility::InstalledOnly,
        enabled: true,
        icon: AppIconSpec::PackageAsset {
            path: "assets/icon.svg".to_string(),
            mime_type: None,
            digest: None,
            uri: None,
            background: None,
        },
        category: draft.category,
        tags: draft.tags,
        launch: Some(launch),
    };

    fs::create_dir_all(package_dir).await?;
    write_json(package_dir.join("app.json"), &app).await?;
    write_json(package_dir.join("config").join("default.json"), &json!({})).await?;
    write_json(
        package_dir.join("config").join("data-schema.json"),
        &json!({ "version": "1.0.0" }),
    )
    .await?;
    write_json(
        package_dir.join("compatibility.json"),
        &json!({ "runtimeCompatibility": format!(">={}", env!("CARGO_PKG_VERSION")) }),
    )
    .await?;
    write_default_app_icon(&package_dir, &draft.name).await?;
    if let Some(primary_surface_definition) = primary_surface_definition.as_ref() {
        let primary_surface_dir = package_dir
            .join("components")
            .join(ComponentKind::Surface.path_segment())
            .join(&primary_surface_definition.id);
        write_json(
            primary_surface_dir.join("component.json"),
            primary_surface_definition,
        )
        .await?;
        write_private_surface_source(&primary_surface_dir, &draft.name, &draft.description).await?;
    }
    if let Some(agent_component) = agent_component {
        write_json(
            package_dir
                .join("components")
                .join(ComponentKind::Agent.path_segment())
                .join(&agent_component.id)
                .join("component.json"),
            &agent_component,
        )
        .await?;
    }
    let package = ProductAppResolver::read_product_app_package(&package_dir).await?;
    let resolved = ProductAppResolver::resolve_package_install(package, Vec::new())?;
    app.component_lock_id = resolved.app.component_lock_id.clone();
    write_json(package_dir.join("app.json"), &app).await?;
    write_text(
        package_dir.join("tests").join("validation-plan.md"),
        &validation_plan,
    )
    .await?;
    write_json(
        package_dir.join("tests").join("rehearsal.json"),
        &rehearsal_plan,
    )
    .await?;
    if let Some(eval_plan) = eval_plan {
        write_json(package_dir.join("tests").join("eval.json"), &eval_plan).await?;
    }
    ProductAppResolver::write_lock(&package_dir, &resolved.lock).await?;

    Ok(WrittenProductAppPackage {
        app_id: app.id,
        version: app.version,
        component_lock_digest: resolved.lock.digest(),
        package_dir: package_dir.to_path_buf(),
    })
}

pub async fn create_product_app_component_scaffold(
    draft: CreateProductAppComponentDraft,
    shared_components: Vec<ComponentDefinition>,
) -> CoreResult<WrittenProductAppComponentScaffold> {
    validate_package_id("componentId", &draft.component_id)?;
    validate_required("name", &draft.name)?;
    validate_required("description", &draft.description)?;
    if draft.make_primary_surface && draft.kind != ComponentKind::Surface {
        return Err(CoreError::validation(
            "makePrimarySurface is only valid for Surface components".to_string(),
        ));
    }

    let package_dir = draft.package_dir;
    let mut package = ProductAppResolver::read_product_app_package(&package_dir).await?;
    let app_id = package.app.id.clone();
    let app_version = package.app.version.clone();
    let role = draft
        .role
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| default_private_component_role(draft.kind, draft.make_primary_surface));
    validate_required("role", &role)?;

    if package
        .private_components
        .iter()
        .any(|component| component.id == draft.component_id && component.kind == draft.kind)
    {
        return Err(CoreError::validation(format!(
            "App-private component already exists: {}/{}",
            draft.kind.path_segment(),
            draft.component_id
        )));
    }
    if package.app.components.iter().any(|component_ref| {
        component_ref.source == ComponentSource::Private
            && component_ref.kind == draft.kind
            && component_ref.component_id == draft.component_id
    }) {
        return Err(CoreError::validation(format!(
            "Product App already references private component {}/{}",
            draft.kind.path_segment(),
            draft.component_id
        )));
    }

    let agent_type = draft
        .agent_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Runno");
    let implementation_ref = draft
        .implementation_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            default_private_component_implementation_ref(
                &package.app,
                draft.kind,
                &draft.component_id,
                agent_type,
            )
        });
    let owner = ComponentOwnerApp {
        app_id: app_id.clone(),
        app_version: app_version.clone(),
    };
    let capabilities = default_private_component_capabilities(draft.kind);
    let permissions = default_private_component_permissions(draft.kind, agent_type);
    let component = ComponentDefinition {
        id: draft.component_id.clone(),
        version: None,
        kind: draft.kind,
        name: draft.name,
        description: draft.description,
        package_source: ComponentPackageSource::AppPrivate,
        owner_app: Some(owner),
        capabilities,
        permissions,
        uses_capabilities: default_private_component_uses_capabilities(draft.kind),
        used_by_apps: vec![app_id.clone()],
        visibility: ComponentVisibility::AppDependency,
        dependencies: Vec::new(),
        implementation_ref,
    };

    let component_dir = package_dir
        .join("components")
        .join(draft.kind.path_segment())
        .join(&component.id);
    ensure_new_package_dir(&component_dir).await?;
    let component_json = component_dir.join("component.json");
    write_json(component_json.clone(), &component).await?;
    let mut generated_files = vec![component_json];
    generated_files.extend(
        write_private_component_scaffold_files(
            &component_dir,
            &component,
            &package.app,
            agent_type,
        )
        .await?,
    );

    let capability_ids = component
        .capabilities
        .iter()
        .map(|capability| capability.id.clone())
        .collect::<Vec<_>>();
    if draft.make_primary_surface {
        for component_ref in &mut package.app.components {
            if component_ref.kind == ComponentKind::Surface
                && component_ref.role == "primarySurface"
            {
                component_ref.role = "surface".to_string();
            }
        }
    }
    package.app.components.push(AppComponentRef {
        component_id: component.id.clone(),
        kind: component.kind,
        source: ComponentSource::Private,
        role: role.clone(),
        version: None,
        capabilities: capability_ids,
        uses_capabilities: default_private_component_uses_capabilities(component.kind),
    });
    merge_os_capabilities(
        &mut package.app.os_capabilities,
        default_private_component_uses_capabilities(component.kind),
    );
    if component.kind == ComponentKind::Agent {
        package.app.permissions.ai = true;
        if package.eval_plan.is_none() {
            let eval_plan = default_product_app_eval_plan_for_agent(
                &app_id,
                &package.app.name,
                &package.app.description,
                agent_type,
                &component.id,
            );
            let eval_path = package_dir.join("tests").join("eval.json");
            write_json(eval_path.clone(), &eval_plan).await?;
            generated_files.push(eval_path);
        }
    }
    if draft.make_primary_surface {
        package.app.primary_surface = Some(SurfaceRef {
            component_id: component.id.clone(),
            surface_id: Some("primary".to_string()),
        });
        package.app.primary_surface_mode = Some(AppSurfaceMode::ImmersivePrimary);
        package.app.interaction_model = AppInteractionModel::InteractiveWorkspace;
        package.app.launch = Some(ProductAppLaunch {
            kind: ProductAppLaunchKind::ApplicationSurface,
            target_id: app_id.clone(),
            scope_requirement: ProductAppLaunchScopeRequirement::SystemAllowed,
            agent_type: None,
            surface_id: Some("primary".to_string()),
        });
    }

    let app_path = package_dir.join("app.json");
    write_json(app_path.clone(), &package.app).await?;
    generated_files.push(app_path);
    let refreshed = ProductAppResolver::read_product_app_package(&package_dir).await?;
    let resolved = ProductAppResolver::resolve_package_install(refreshed, shared_components)?;
    write_json(package_dir.join("app.json"), &resolved.app).await?;
    let lock_path = package_dir.join("app.lock.json");
    ProductAppResolver::write_lock(&package_dir, &resolved.lock).await?;
    generated_files.push(lock_path);

    Ok(WrittenProductAppComponentScaffold {
        app_id,
        version: app_version,
        component_id: component.id,
        kind: component.kind,
        role,
        component_lock_digest: resolved.lock.digest(),
        package_dir,
        component_dir,
        generated_files,
    })
}

pub async fn create_component_package(
    path_manager: &PathManager,
    draft: CreateComponentPackageDraft,
) -> CoreResult<WrittenComponentPackage> {
    validate_package_id("componentId", &draft.component_id)?;
    validate_required("name", &draft.name)?;
    validate_required("description", &draft.description)?;
    validate_required("version", &draft.version)?;

    let package_dir = path_manager.system_component_version_dir(
        draft.kind.path_segment(),
        &draft.component_id,
        &draft.version,
    );
    ensure_new_package_dir(&package_dir).await?;

    let component = ComponentDefinition {
        id: draft.component_id.clone(),
        version: Some(draft.version.clone()),
        kind: draft.kind,
        name: draft.name,
        description: draft.description,
        package_source: ComponentPackageSource::Shared,
        owner_app: None,
        capabilities: vec![CapabilityRef {
            id: "component.contract".to_string(),
            title: "Component contract".to_string(),
            description: "Generated component contract placeholder.".to_string(),
            actions: vec!["component.validate".to_string()],
        }],
        permissions: Vec::new(),
        uses_capabilities: Vec::new(),
        used_by_apps: Vec::new(),
        visibility: ComponentVisibility::Developer,
        dependencies: Vec::new(),
        implementation_ref: draft.implementation_ref,
    };

    fs::create_dir_all(&package_dir).await?;
    write_json(package_dir.join("component.json"), &component).await?;
    write_text(
        package_dir.join("src").join("README.md"),
        "# Implementation\n\nPlace the component implementation here.\n",
    )
    .await?;
    write_text(
        package_dir.join("tests").join("contract.md"),
        "# Contract Tests\n\n- Validate component.json.\n- Verify declared capabilities and permissions.\n- Verify Product App references use semver ranges.\n",
    )
    .await?;
    ProductAppResolver::read_component_package(&package_dir).await?;

    Ok(WrittenComponentPackage {
        component_id: component.id,
        kind: component.kind,
        version: draft.version,
        package_dir,
    })
}

fn resolve_include_agent(
    draft: &CreateProductAppPackageDraft,
    options: &CreateProductAppPackageOptions,
    include_surface: bool,
) -> CoreResult<bool> {
    let include_agent = options
        .include_agent
        .unwrap_or(!include_surface || draft.primary_surface_mode == AppSurfaceMode::ChatPrimary);
    if !include_surface && !include_agent {
        return Err(CoreError::validation(
            "Product Apps without a surface require an app-private Agent Component".to_string(),
        ));
    }
    Ok(include_agent)
}

fn default_private_component_role(kind: ComponentKind, make_primary_surface: bool) -> String {
    if kind == ComponentKind::Surface && make_primary_surface {
        return "primarySurface".to_string();
    }
    match kind {
        ComponentKind::Surface => "surface".to_string(),
        ComponentKind::Agent => "agent".to_string(),
        ComponentKind::Bridge => "bridge".to_string(),
        ComponentKind::Runtime => "runtime".to_string(),
        ComponentKind::Tool => "tool".to_string(),
        ComponentKind::Skill => "skill".to_string(),
    }
}

fn default_private_component_implementation_ref(
    app: &AppDefinition,
    kind: ComponentKind,
    component_id: &str,
    agent_type: &str,
) -> Option<String> {
    match kind {
        ComponentKind::Agent => Some(format!("agent://{agent_type}")),
        ComponentKind::Surface
        | ComponentKind::Bridge
        | ComponentKind::Runtime
        | ComponentKind::Tool
        | ComponentKind::Skill => Some(format!(
            "app://{}@{}/{}/{}",
            app.id,
            app.version,
            kind.path_segment(),
            component_id
        )),
    }
}

fn default_private_component_capabilities(kind: ComponentKind) -> Vec<CapabilityRef> {
    match kind {
        ComponentKind::Surface => vec![
            CapabilityRef {
                id: "context.publish".to_string(),
                title: "Publish structured work context".to_string(),
                description: "Publishes Work-owned context for AI collaboration.".to_string(),
                actions: vec!["context.publish".to_string()],
            },
            CapabilityRef {
                id: "selection.describe".to_string(),
                title: "Describe selection".to_string(),
                description:
                    "Describes the current object or selection without owning durable state."
                        .to_string(),
                actions: vec!["selection.describe".to_string()],
            },
        ],
        ComponentKind::Agent => vec![CapabilityRef {
            id: "agent.run".to_string(),
            title: "Run app-private agent".to_string(),
            description: "Runs the Product App's private AI behavior boundary.".to_string(),
            actions: vec!["agent.session.start".to_string()],
        }],
        ComponentKind::Bridge => vec![CapabilityRef {
            id: "service.action".to_string(),
            title: "Expose service action".to_string(),
            description: "Defines a controlled bridge from Product App code to a backend action."
                .to_string(),
            actions: vec!["service.action.call".to_string()],
        }],
        ComponentKind::Runtime => vec![CapabilityRef {
            id: "runtime.host".to_string(),
            title: "Declare runtime host boundary".to_string(),
            description: "Declares a special execution or hosting boundary for this Product App."
                .to_string(),
            actions: vec!["runtime.host.resolve".to_string()],
        }],
        ComponentKind::Tool => vec![CapabilityRef {
            id: "tool.call".to_string(),
            title: "Call structured tool".to_string(),
            description: "Defines a structured tool contract callable by the app or agent."
                .to_string(),
            actions: vec!["tool.call".to_string()],
        }],
        ComponentKind::Skill => vec![CapabilityRef {
            id: "skill.apply".to_string(),
            title: "Apply reusable workflow knowledge".to_string(),
            description: "Packages reusable workflow guidance for the Product App.".to_string(),
            actions: vec!["skill.apply".to_string()],
        }],
    }
}

fn default_private_component_permissions(
    kind: ComponentKind,
    agent_type: &str,
) -> Vec<PermissionSpec> {
    match kind {
        ComponentKind::Agent => vec![PermissionSpec {
            kind: "ai".to_string(),
            summary: "Uses the configured AI agent.".to_string(),
            scopes: vec![agent_type.to_string()],
        }],
        _ => Vec::new(),
    }
}

fn default_private_component_uses_capabilities(kind: ComponentKind) -> Vec<String> {
    match kind {
        ComponentKind::Surface => vec!["session.read".to_string(), "component.run".to_string()],
        ComponentKind::Agent => vec![
            "session.read".to_string(),
            "model.invoke".to_string(),
            "tool.invoke".to_string(),
        ],
        ComponentKind::Bridge => vec!["component.run".to_string()],
        ComponentKind::Runtime => vec!["component.run".to_string()],
        ComponentKind::Tool => vec!["tool.invoke".to_string()],
        ComponentKind::Skill => vec!["memory.read".to_string()],
    }
}

fn default_product_app_os_capabilities(include_agent: bool, include_surface: bool) -> Vec<String> {
    let mut capabilities = Vec::new();
    if include_surface {
        merge_os_capabilities(
            &mut capabilities,
            default_private_component_uses_capabilities(ComponentKind::Surface),
        );
    }
    if include_agent {
        merge_os_capabilities(
            &mut capabilities,
            default_private_component_uses_capabilities(ComponentKind::Agent),
        );
    }
    capabilities
}

fn merge_os_capabilities(target: &mut Vec<String>, additions: Vec<String>) {
    for capability in additions {
        if !target.iter().any(|existing| existing == &capability) {
            target.push(capability);
        }
    }
}

async fn write_private_component_scaffold_files(
    component_dir: &PathBuf,
    component: &ComponentDefinition,
    app: &AppDefinition,
    agent_type: &str,
) -> CoreResult<Vec<PathBuf>> {
    match component.kind {
        ComponentKind::Surface => {
            write_private_surface_source(component_dir, &component.name, &component.description)
                .await?;
            let source_dir = component_dir.join("source");
            Ok(vec![
                source_dir.join("index.html"),
                source_dir.join("style.css"),
                source_dir.join("ui.js"),
                source_dir.join("worker.js"),
            ])
        }
        ComponentKind::Agent => {
            let source_dir = component_dir.join("source");
            let prompt_path = source_dir.join("prompt.md");
            write_text(
                prompt_path.clone(),
                &format!(
                    "# {}\n\nYou are the app-private agent for `{}`.\n\nProduct App description: {}\n\nUse Product App backend bindings and service actions when they are declared. Keep durable state in the Product App Work/runtime boundary rather than in the raw authoring session.\n",
                    component.name, app.id, app.description
                ),
            )
            .await?;
            let fixtures_path = source_dir.join("fixtures.json");
            write_json(
                fixtures_path.clone(),
                &json!({
                    "version": 1,
                    "agentType": agent_type,
                    "fixtures": [
                        {
                            "id": "primary-behavior",
                            "input": { "message": format!("Help with: {}", app.description) },
                            "expect": ["app-specific response", "actionable next step"]
                        }
                    ]
                }),
            )
            .await?;
            Ok(vec![prompt_path, fixtures_path])
        }
        ComponentKind::Bridge => {
            let source_dir = component_dir.join("source");
            let actions_path = source_dir.join("actions.json");
            write_json(
                actions_path.clone(),
                &json!({
                    "version": 1,
                    "actions": [
                        {
                            "id": "health",
                            "description": "Check whether the app-private bridge can serve requests.",
                            "inputSchema": { "type": "object", "additionalProperties": true },
                            "outputSchema": { "type": "object", "additionalProperties": true }
                        }
                    ]
                }),
            )
            .await?;
            let worker_path = source_dir.join("worker.js");
            write_text(
                worker_path.clone(),
                "export async function health(input = {}) {\n  return { ok: true, input };\n}\n",
            )
            .await?;
            let readme_path = source_dir.join("README.md");
            write_text(
                readme_path.clone(),
                "# Bridge Component\n\nDefine app-private service actions here, then expose them through Product App backend bindings before UI code calls them.\n",
            )
            .await?;
            Ok(vec![actions_path, worker_path, readme_path])
        }
        ComponentKind::Runtime => {
            let source_dir = component_dir.join("source");
            let runtime_path = source_dir.join("runtime.json");
            write_json(
                runtime_path.clone(),
                &json!({
                    "version": 1,
                    "host": "product-app-runtime",
                    "notes": "Declare special runtime host requirements here only when the Product App needs them."
                }),
            )
            .await?;
            let readme_path = source_dir.join("README.md");
            write_text(
                readme_path.clone(),
                "# Runtime Component\n\nUse this scaffold for special execution or hosting requirements that the default Product App runtime host does not cover.\n",
            )
            .await?;
            Ok(vec![runtime_path, readme_path])
        }
        ComponentKind::Tool => {
            let source_dir = component_dir.join("source");
            let schema_path = source_dir.join("tool.schema.json");
            write_json(
                schema_path.clone(),
                &json!({
                    "name": component.id,
                    "description": component.description,
                    "inputSchema": { "type": "object", "additionalProperties": true },
                    "outputSchema": { "type": "object", "additionalProperties": true }
                }),
            )
            .await?;
            let tool_path = source_dir.join("tool.js");
            write_text(
                tool_path.clone(),
                "export async function call(input = {}) {\n  return { ok: true, input };\n}\n",
            )
            .await?;
            let readme_path = source_dir.join("README.md");
            write_text(
                readme_path.clone(),
                "# Tool Component\n\nImplement the structured tool contract in `tool.js` and keep schemas aligned with app or agent call sites.\n",
            )
            .await?;
            Ok(vec![schema_path, tool_path, readme_path])
        }
        ComponentKind::Skill => {
            let source_dir = component_dir.join("source");
            let skill_path = source_dir.join("SKILL.md");
            write_text(
                skill_path.clone(),
                &format!(
                    "# {}\n\nUse this app-private skill to capture reusable workflow knowledge for `{}`.\n\n## When To Use\n\nUse when the Product App needs consistent domain workflow guidance that should not live in the system prompt.\n\n## Guidance\n\n- Keep instructions specific to this Product App.\n- Keep API and UI details in the appropriate Product App implementation files.\n- Update examples when the app behavior changes.\n",
                    component.name, app.name
                ),
            )
            .await?;
            Ok(vec![skill_path])
        }
    }
}

fn default_product_app_validation_plan(
    draft: &CreateProductAppPackageDraft,
    agent_component_id: Option<&str>,
    include_surface: bool,
) -> String {
    let preview_gate = if include_surface {
        "- `RunBuilderPreview` with `mode=\"product-app-preview\"`: primary surface identity and placement resolve before claiming UI readiness."
    } else {
        "- `RunBuilderPreview` with `mode=\"agent-chat\"`: the app-private Agent entry resolves before claiming conversational readiness."
    };
    let runtime_boundary_gate = if include_surface {
        "- `RunBuilderPreview` with `mode=\"runtime-boundary\"`: Work id, runtime instance id, Product App version, component lock digest, and primary surface id are all bound to the same Product App runtime context; data behavior, retention, deletion, migration, and share impact still require runtime evidence."
    } else {
        "- `RunBuilderPreview` with `mode=\"runtime-boundary\"`: Work/session id, Product App version, component lock digest, and Agent entry are bound to the same Product App runtime context; data behavior, retention, deletion, migration, and share impact still require runtime evidence."
    };
    let agent_eval_gate = agent_component_id
        .map(|component_id| {
            format!(
                "- `RunBuilderPreview` with `mode=\"agent-eval\"` and `execute=true`: required eval cases in `tests/eval.json` produce evidence according to `evidenceKind`. `runtime-binding` cases prove agent runtime binding readiness for `{component_id}`; `behavior` cases use the App Builder hidden-agent runner when parent session, turn, workspace, and coordinator context are available; otherwise they remain `notVerified`."
            )
        })
        .unwrap_or_else(|| {
            "- Agent Eval is not required for the initial surface-only package. If intelligent backend behavior or `permissions.ai` is added later, add an app-private Agent Component, create `tests/eval.json`, and run `RunBuilderPreview` with `mode=\"agent-eval\"`.".to_string()
        });
    let eval_seed = agent_component_id
        .map(|component_id| {
            format!("- `tests/eval.json`: required Agent Eval seeds for `{component_id}` runtime binding readiness and representative behavior evidence.")
        })
        .unwrap_or_else(|| {
            "- No `tests/eval.json` is seeded because this package does not declare AI behavior yet.".to_string()
        });
    format!(
        r#"# Validation Plan

Product App: `{}` @ `{}`
Description: {}

## Required Gates

- `ValidateProductAppPackage`: app.json, private components, component lock, launch policy, permission boundary, data boundary, rehearsal plan, and eval plan all resolve.
{}
{}
- `RunBuilderPreview` with `mode="runtime-dependencies"`: Product App Runtime host records source loading, import-map/CDN resolution when used, Node/dependency install state when used, and worker freshness before dependency health can pass.
- `RunBuilderPreview` with `mode="permission-review"`: App Builder records explicit permission review evidence; package permission declarations alone do not pass the review gate.
- `RunBuilderPreview` with `mode="user-path-rehearsal"`: the critical user path in `tests/rehearsal.json` is observed, not inferred from package metadata.
{}
- `RunBuilderPreview` with `mode="release-rehearsal"`: release readiness only aggregates the independent gates above and must remain `notVerified` while any gate lacks evidence.

## Seeded Evidence Files

- `tests/rehearsal.json`: user path, runtime boundary, permission/data, and release-gate rehearsal seeds.
{}
- `app.lock.json`: component lock digest that must match the runtime context.
"#,
        draft.app_id,
        draft.version,
        draft.description,
        preview_gate,
        runtime_boundary_gate,
        agent_eval_gate,
        eval_seed
    )
}

fn default_product_app_rehearsal_plan(
    draft: &CreateProductAppPackageDraft,
    include_agent: bool,
    include_surface: bool,
) -> ProductAppRehearsalPlan {
    let permission_expectation = if include_agent {
        "AI permission is tied to the app-private Agent Component".to_string()
    } else {
        "AI permission is absent until intelligent backend behavior is introduced".to_string()
    };
    let entry_target = if include_surface {
        "primary-surface"
    } else {
        "agent-session"
    };
    let entry_expectation = if include_surface {
        "Product App surface opens"
    } else {
        "Product App agent session opens"
    };
    let focus_target = if include_surface {
        "primary-workflow-control"
    } else {
        "primary-agent-message"
    };
    let focus_expectation = if include_surface {
        "Start product app path"
    } else {
        "Agent can respond from Product App context"
    };
    let runtime_identity_expectation = if include_surface {
        "host surface id maps to the declared primary surface"
    } else {
        "agent entry maps to the declared Product App launch"
    };
    ProductAppRehearsalPlan {
        version: 1,
        scenarios: vec![
            ProductAppRehearsalScenario {
                id: "critical-user-path".to_string(),
                title: format!("Complete the first useful path in {}", draft.name),
                description: format!(
                    "Open the app and observe the path that should make progress from: {}",
                    draft.description
                ),
                kind: ProductAppRehearsalScenarioKind::UserPath,
                steps: vec![
                    ProductAppRehearsalStep {
                        id: "open-product-app".to_string(),
                        action: ProductAppRehearsalAction::Open,
                        target: Some(entry_target.to_string()),
                        value: None,
                        expect: vec![entry_expectation.to_string(), draft.name.clone()],
                    },
                    ProductAppRehearsalStep {
                        id: "focus-primary-action".to_string(),
                        action: ProductAppRehearsalAction::Focus,
                        target: Some(focus_target.to_string()),
                        value: None,
                        expect: vec![focus_expectation.to_string(), draft.description.clone()],
                    },
                    ProductAppRehearsalStep {
                        id: "observe-description-progress".to_string(),
                        action: ProductAppRehearsalAction::Observe,
                        target: Some("work-outcome".to_string()),
                        value: None,
                        expect: vec![format!("Progress target: {}", draft.description)],
                    },
                ],
                expected: vec![
                    "The app opens without fatal runtime issues.".to_string(),
                    "The primary workflow has an observable path from the Product App description."
                        .to_string(),
                    "The observation comes from the runtime host, not only app metadata."
                        .to_string(),
                ],
            },
            ProductAppRehearsalScenario {
                id: "runtime-boundary".to_string(),
                title: "Verify Product App runtime identity".to_string(),
                description:
                    "Confirm the runtime context is Work-owned and matches the package lock."
                        .to_string(),
                kind: ProductAppRehearsalScenarioKind::Capability,
                steps: vec![ProductAppRehearsalStep {
                    id: "observe-runtime-context".to_string(),
                    action: ProductAppRehearsalAction::Observe,
                    target: Some("product-app-runtime-context".to_string()),
                    value: None,
                    expect: vec![
                    "work id is present".to_string(),
                    "runtime instance id is present".to_string(),
                    "component lock digest matches app.lock.json".to_string(),
                        runtime_identity_expectation.to_string(),
                    ],
                }],
                expected: vec![
                    "Runtime readiness is tied to Work and Product App identity.".to_string(),
                    "No legacy host-surface identity is required to explain the run."
                        .to_string(),
                ],
            },
            ProductAppRehearsalScenario {
                id: "permission-data-boundary".to_string(),
                title: "Review permission and data lifecycle boundary".to_string(),
                description:
                    "Confirm the Product App uses only declared permissions and lifecycle policy."
                        .to_string(),
                kind: ProductAppRehearsalScenarioKind::Capability,
                steps: vec![ProductAppRehearsalStep {
                    id: "observe-boundaries".to_string(),
                    action: ProductAppRehearsalAction::Observe,
                    target: Some("permissions-and-data-lifecycle".to_string()),
                    value: None,
                    expect: vec![
                        permission_expectation,
                        "no filesystem, shell, network, GUI, or secret permission is implied"
                            .to_string(),
                        "data retention is Work runtime scoped".to_string(),
                        "runtime-private data is excluded from share/export by default"
                            .to_string(),
                    ],
                }],
                expected: vec![
                    "Permission review can be recorded as an independent gate.".to_string(),
                    "Data lifecycle can be checked before release rehearsal.".to_string(),
                ],
            },
            ProductAppRehearsalScenario {
                id: "release-gate-evidence".to_string(),
                title: "Assemble release evidence".to_string(),
                description:
                    "Release rehearsal must aggregate independent validation, preview, eval, runtime, permission, data, and user-path evidence."
                        .to_string(),
                kind: ProductAppRehearsalScenarioKind::ReleaseGate,
                steps: vec![ProductAppRehearsalStep {
                    id: "observe-required-gates".to_string(),
                    action: ProductAppRehearsalAction::Observe,
                    target: Some("release-readiness-facts".to_string()),
                    value: None,
                    expect: vec![
                        "package validation gate is passed".to_string(),
                        "product-app-preview gate is observed".to_string(),
                        "runtime-boundary gate is observed".to_string(),
                        "runtime-dependencies gate is observed".to_string(),
                        "permission-review gate records manifest, runtime summary, and risk review evidence".to_string(),
                        "agent-eval gate is executed when required".to_string(),
                        "user-path-rehearsal gate is observed".to_string(),
                    ],
                }],
                expected: vec![
                    "Release rehearsal remains notVerified until every independent gate has evidence."
                        .to_string(),
                ],
            },
        ],
    }
}

fn default_product_app_eval_plan(
    draft: &CreateProductAppPackageDraft,
    agent_component_id: &str,
) -> ProductAppEvalPlan {
    default_product_app_eval_plan_for_agent(
        &draft.app_id,
        &draft.name,
        &draft.description,
        &draft.agent_type,
        agent_component_id,
    )
}

fn default_product_app_eval_plan_for_agent(
    app_id: &str,
    app_name: &str,
    app_description: &str,
    agent_type: &str,
    agent_component_id: &str,
) -> ProductAppEvalPlan {
    ProductAppEvalPlan {
        version: 1,
        cases: vec![
            ProductAppEvalCase {
                id: "agent-runtime-binding".to_string(),
                title: format!("Verify {} agent runtime binding", app_name),
                description: "Executable readiness check for the configured Product App agent runtime binding.".to_string(),
                component_id: Some(agent_component_id.to_string()),
                implementation_ref: Some(format!("agent://{}", agent_type)),
                action: Some("agent.runtime.binding".to_string()),
                tool_name: None,
                input: json!({
                    "description": app_description,
                    "appId": app_id,
                    "agentType": agent_type
                }),
                expectations: vec![
                    ProductAppEvalExpectation {
                        kind: ProductAppEvalExpectationKind::JsonEquals,
                        path: Some("enabled".to_string()),
                        value: Some(json!(true)),
                    },
                    ProductAppEvalExpectation {
                        kind: ProductAppEvalExpectationKind::JsonEquals,
                        path: Some("agentType".to_string()),
                        value: Some(json!(agent_type)),
                    },
                ],
                evidence_kind: ProductAppEvalEvidenceKind::RuntimeBinding,
                tags: vec![
                    "release-gate".to_string(),
                    "agent-eval".to_string(),
                    "runtime-binding".to_string(),
                    "seed".to_string(),
                ],
                required: true,
            },
            ProductAppEvalCase {
                id: "primary-agent-behavior".to_string(),
                title: format!("Evaluate {} agent behavior", app_name),
                description: format!(
                    "Representative Product App eval for the core description: {}",
                    app_description
                ),
                component_id: Some(agent_component_id.to_string()),
                implementation_ref: Some(format!("agent://{}", agent_type)),
                action: Some("agent.session.start".to_string()),
                tool_name: None,
                input: json!({
                    "message": format!("Help with: {}", app_description),
                    "description": app_description,
                    "appId": app_id,
                    "expectedEvidence": [
                        "app-specific response",
                        "actionable next step",
                        "Product App context awareness"
                    ]
                }),
                expectations: vec![ProductAppEvalExpectation {
                    kind: ProductAppEvalExpectationKind::TextContains,
                    path: None,
                    value: Some(json!(app_description)),
                }],
                evidence_kind: ProductAppEvalEvidenceKind::Behavior,
                tags: vec![
                    "release-gate".to_string(),
                    "agent-eval".to_string(),
                    "behavior".to_string(),
                    "seed".to_string(),
                ],
                required: true,
            },
        ],
    }
}

async fn write_json(path: PathBuf, value: &impl Serialize) -> CoreResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let bytes = serde_json::to_vec_pretty(value)?;
    fs::write(&path, bytes).await?;
    Ok(())
}

async fn write_text(path: PathBuf, value: &str) -> CoreResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    fs::write(&path, value).await?;
    Ok(())
}

async fn write_default_app_icon(package_dir: &Path, label: &str) -> CoreResult<()> {
    let initial = label
        .chars()
        .find(|character| character.is_alphanumeric())
        .map(|character| character.to_uppercase().to_string())
        .unwrap_or_else(|| "A".to_string());
    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="30" fill="#07111E"/><path d="M28 64c0-21 15-36 36-36h28v20H64c-10 0-16 6-16 16s6 16 16 16h28v20H64c-21 0-36-15-36-36Z" fill="#25D5F2"/><text x="64" y="77" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="38" font-weight="700" fill="#F8FAFC">{}</text></svg>"##,
        initial
    );
    write_text(package_dir.join("assets").join("icon.svg"), &svg).await
}

async fn write_private_surface_source(
    component_dir: &PathBuf,
    app_name: &str,
    app_description: &str,
) -> CoreResult<()> {
    let source_dir = component_dir.join("source");
    write_text(
        source_dir.join("index.html"),
        r#"<main id="app-root" class="product-app-surface" data-testid="primary-surface"></main>"#,
    )
    .await?;
    write_text(
        source_dir.join("style.css"),
        r#".product-app-surface {
  min-height: 100vh;
  box-sizing: border-box;
  display: grid;
  align-content: center;
  gap: 12px;
  padding: 32px;
  color: var(--ds-color-text-primary);
  background: var(--ds-color-bg-app);
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.product-app-surface__eyebrow {
  margin: 0;
  color: var(--ds-color-text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}
.product-app-surface__title {
  margin: 0;
  font-size: 28px;
  line-height: 1.2;
  letter-spacing: 0;
}
.product-app-surface__copy {
  margin: 0;
  max-width: 64ch;
  color: var(--ds-color-text-secondary);
  font-size: 15px;
  line-height: 1.55;
}
.product-app-surface__action {
  width: fit-content;
  min-height: 36px;
  border: 1px solid var(--ds-color-border-strong);
  border-radius: 6px;
  padding: 0 14px;
  color: var(--ds-color-text-primary);
  background: var(--ds-color-bg-surface);
  font: inherit;
  font-weight: 600;
}
.product-app-surface__outcome {
  margin: 0;
  max-width: 64ch;
  color: var(--ds-color-text-secondary);
  font-size: 14px;
  line-height: 1.45;
}
"#,
    )
    .await?;
    let name_json =
        serde_json::to_string(app_name).unwrap_or_else(|_| "\"Product App\"".to_string());
    let description_json =
        serde_json::to_string(app_description).unwrap_or_else(|_| "\"\"".to_string());
    write_text(
        source_dir.join("ui.js"),
        &format!(
            r#"const root = document.getElementById('app-root');
const appName = {name_json};
const appDescription = {description_json};

if (root) {{
  root.innerHTML = `
    <p class="product-app-surface__eyebrow">Product App</p>
    <h1 class="product-app-surface__title">${{appName}}</h1>
    <p class="product-app-surface__copy">${{appDescription}}</p>
    <button class="product-app-surface__action" type="button" data-testid="primary-workflow-control" data-action="primary-workflow-control" aria-label="Start product app path">Start product app path</button>
    <p class="product-app-surface__outcome" data-testid="work-outcome">Progress target: ${{appDescription}}</p>
  `;
  const action = root.querySelector('[data-testid="primary-workflow-control"]');
  const outcome = root.querySelector('[data-testid="work-outcome"]');
  if (action && outcome) {{
    action.addEventListener('click', () => {{
      outcome.textContent = `Progress target: ${{appDescription}}`;
    }});
  }}
}}
"#
        ),
    )
    .await?;
    write_text(source_dir.join("worker.js"), "").await
}

async fn ensure_new_package_dir(path: &PathBuf) -> CoreResult<()> {
    if fs::try_exists(path).await? {
        return Err(CoreError::validation(format!(
            "package already exists: {}",
            path.display()
        )));
    }
    Ok(())
}

async fn ensure_empty_draft_root(path: &Path) -> CoreResult<()> {
    if !fs::try_exists(path).await? || !path.is_dir() {
        return Err(CoreError::validation(format!(
            "Authorized Intelligent App Draft does not exist: {}",
            path.display()
        )));
    }
    let mut entries = fs::read_dir(path).await?;
    while let Some(entry) = entries.next_entry().await? {
        if entry.file_name() != ".sparo_os" {
            return Err(CoreError::validation(format!(
                "Intelligent App Draft already contains package source: {}",
                path.display()
            )));
        }
    }
    Ok(())
}

fn validate_required(field: &str, value: &str) -> CoreResult<()> {
    if value.trim().is_empty() {
        return Err(CoreError::validation(format!("{field} is required")));
    }
    Ok(())
}

fn validate_package_id(field: &str, value: &str) -> CoreResult<()> {
    validate_required(field, value)?;
    let valid = value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');
    if !valid {
        return Err(CoreError::validation(format!(
            "{field} must contain only ASCII letters, numbers, '-' or '_'"
        )));
    }
    Ok(())
}

fn default_version() -> String {
    "1.0.0".to_string()
}

fn default_agent_type() -> String {
    "Runno".to_string()
}

fn default_surface_mode() -> AppSurfaceMode {
    AppSurfaceMode::ImmersivePrimary
}

pub fn default_product_app_work_multiplicity_for_surface_mode(
    primary_surface_mode: AppSurfaceMode,
) -> AppWorkMultiplicity {
    match primary_surface_mode {
        AppSurfaceMode::ChatPrimary | AppSurfaceMode::SidecarLinked => {
            AppWorkMultiplicity::Multiple
        }
        AppSurfaceMode::ImmersivePrimary | AppSurfaceMode::EmbeddedObject => {
            AppWorkMultiplicity::Singleton
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::infrastructure::PathManager;

    use super::*;

    #[tokio::test]
    async fn creates_resolved_agent_only_product_app_package_with_lock() {
        let root = test_root("product-app");
        let path_manager = PathManager::with_user_root_for_tests(root);
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "sample-app".to_string(),
                name: "Sample App".to_string(),
                description: "Sample description".to_string(),
                authors: Vec::new(),
                i18n: Default::default(),
                version: "1.0.0".to_string(),
                agent_type: "Runno".to_string(),
                category: "testing".to_string(),
                tags: vec!["sample".to_string()],
                primary_surface_mode: AppSurfaceMode::ChatPrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .unwrap();

        assert!(written.package_dir.join("app.json").exists());
        assert!(written.package_dir.join("app.lock.json").exists());
        assert!(!written
            .package_dir
            .join("components")
            .join("surfaces")
            .join("sample-app-surface")
            .join("component.json")
            .exists());
        assert!(written
            .package_dir
            .join("tests")
            .join("rehearsal.json")
            .exists());
        assert!(written.package_dir.join("tests").join("eval.json").exists());
        let package = ProductAppResolver::read_product_app_package(&written.package_dir)
            .await
            .unwrap();
        assert!(package.app.primary_surface.is_none());
        assert!(package.app.primary_surface_mode.is_none());
        let launch = package.app.launch.as_ref().expect("launch");
        assert_eq!(launch.kind, ProductAppLaunchKind::AgentSession);
        assert_eq!(launch.target_id, "Runno");
        assert!(package.app.permissions.ai);
        assert!(package
            .private_components
            .iter()
            .any(|component| component.kind == ComponentKind::Agent));
        assert!(package
            .rehearsal_plan
            .as_ref()
            .is_some_and(|plan| !plan.scenarios.is_empty()));
        let eval_plan = package.eval_plan.as_ref().expect("eval plan");
        assert_eq!(
            eval_plan
                .cases
                .iter()
                .map(|case| (case.id.as_str(), case.evidence_kind))
                .collect::<Vec<_>>(),
            vec![
                (
                    "agent-runtime-binding",
                    ProductAppEvalEvidenceKind::RuntimeBinding,
                ),
                (
                    "primary-agent-behavior",
                    ProductAppEvalEvidenceKind::Behavior
                ),
            ]
        );
        assert!(package.app.data_lifecycle.is_some());
        assert!(!written.package_dir.join("work-objects").exists());
    }

    #[tokio::test]
    async fn sidecar_product_app_launches_application_surface() {
        let root = test_root("product-app-sidecar");
        let path_manager = PathManager::with_user_root_for_tests(root);
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "sample-sidecar-app".to_string(),
                name: "Sample Sidecar App".to_string(),
                description: "Sample sidecar description".to_string(),
                authors: Vec::new(),
                i18n: Default::default(),
                version: "1.0.0".to_string(),
                agent_type: "Runno".to_string(),
                category: "testing".to_string(),
                tags: vec!["sample".to_string()],
                primary_surface_mode: AppSurfaceMode::SidecarLinked,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .unwrap();

        let package = ProductAppResolver::read_product_app_package(&written.package_dir)
            .await
            .unwrap();
        let launch = package.app.launch.unwrap();
        assert_eq!(launch.kind, ProductAppLaunchKind::ApplicationSurface);
        assert_eq!(launch.target_id, "sample-sidecar-app");
        assert_eq!(
            launch.scope_requirement,
            ProductAppLaunchScopeRequirement::SystemAllowed
        );
        assert_eq!(launch.surface_id.as_deref(), Some("primary"));
        assert!(launch.agent_type.is_none());
        assert!(!package.app.permissions.ai);
        assert!(package
            .private_components
            .iter()
            .all(|component| component.kind != ComponentKind::Agent));
        assert!(package.eval_plan.is_none());
    }

    #[tokio::test]
    async fn creates_valid_shared_component_package() {
        let root = test_root("component");
        let path_manager = PathManager::with_user_root_for_tests(root);
        let written = create_component_package(
            &path_manager,
            CreateComponentPackageDraft {
                component_id: "sample-skill".to_string(),
                kind: ComponentKind::Skill,
                name: "Sample Skill".to_string(),
                description: "Sample component".to_string(),
                version: "1.0.0".to_string(),
                implementation_ref: Some("skill://sample".to_string()),
            },
        )
        .await
        .unwrap();

        assert!(written.package_dir.join("component.json").exists());
    }

    #[tokio::test]
    async fn creates_app_private_component_scaffolds_for_all_kinds() {
        let root = test_root("product-app-components");
        let path_manager = PathManager::with_user_root_for_tests(root);
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "component-rich-app".to_string(),
                name: "Component Rich App".to_string(),
                description: "Exercises app-private component scaffolds".to_string(),
                authors: Vec::new(),
                i18n: Default::default(),
                version: "1.0.0".to_string(),
                agent_type: "Runno".to_string(),
                category: "testing".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .unwrap();

        let cases = [
            (
                ComponentKind::Surface,
                "secondary-surface",
                "Secondary Surface",
                "source/ui.js",
            ),
            (
                ComponentKind::Agent,
                "analysis-agent",
                "Analysis Agent",
                "source/prompt.md",
            ),
            (
                ComponentKind::Bridge,
                "service-bridge",
                "Service Bridge",
                "source/actions.json",
            ),
            (
                ComponentKind::Runtime,
                "special-runtime",
                "Special Runtime",
                "source/runtime.json",
            ),
            (
                ComponentKind::Tool,
                "structured-tool",
                "Structured Tool",
                "source/tool.schema.json",
            ),
            (
                ComponentKind::Skill,
                "workflow-skill",
                "Workflow Skill",
                "source/SKILL.md",
            ),
        ];

        for (kind, component_id, name, expected_source) in cases {
            let scaffold = create_product_app_component_scaffold(
                CreateProductAppComponentDraft {
                    package_dir: written.package_dir.clone(),
                    component_id: component_id.to_string(),
                    kind,
                    name: name.to_string(),
                    description: format!("{name} scaffold"),
                    role: None,
                    implementation_ref: None,
                    agent_type: None,
                    make_primary_surface: false,
                },
                Vec::new(),
            )
            .await
            .unwrap();
            assert_eq!(scaffold.kind, kind);
            assert!(scaffold.component_dir.join("component.json").exists());
            assert!(scaffold.component_dir.join(expected_source).exists());
        }

        let package = ProductAppResolver::read_product_app_package(&written.package_dir)
            .await
            .unwrap();
        assert!(package.app.permissions.ai);
        assert!(package.eval_plan.is_some());
        for (kind, component_id, _, _) in cases {
            assert!(package
                .app
                .components
                .iter()
                .any(|component| component.kind == kind && component.component_id == component_id));
            assert!(package
                .private_components
                .iter()
                .any(|component| component.kind == kind && component.id == component_id));
        }

        let resolved = ProductAppResolver::resolve_package_install(package, Vec::new()).unwrap();
        let lock = ProductAppResolver::read_lock(&written.package_dir)
            .await
            .unwrap();
        assert_eq!(lock.digest(), resolved.lock.digest());
        assert_eq!(resolved.app.component_lock_id, resolved.lock.digest());
    }

    fn test_root(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("sparo-authoring-{name}-{nanos}"))
    }
}
