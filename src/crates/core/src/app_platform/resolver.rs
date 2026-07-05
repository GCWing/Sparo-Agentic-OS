use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};

use base64::Engine as _;
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::fs;

use crate::error::{CoreError, CoreResult};

use super::catalog::{
    build_component_lock_with_implementation_digests, stable_digest, AppCatalogEntry,
    AppComponentRef, AppDefinition, AppIconSpec, ComponentDefinition, ComponentKind, ComponentLock,
    ComponentOwnerApp, ComponentPackageSource, ComponentSource, ProductAppCatalogEntry,
    ProductAppLaunch, ProductAppLaunchKind,
};
use super::eval::ProductAppEvalPlan;
use super::rehearsal::ProductAppRehearsalPlan;
use crate::product_app_runtime_host::{
    ProductAppRuntimeHostNpmDep as NpmDep, ProductAppRuntimeHostSource,
    ProductAppRuntimeHostSourceFile, ProductAppRuntimeHostSourceFileKind,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppPackage {
    pub app: AppDefinition,
    #[serde(default)]
    pub private_components: Vec<ComponentDefinition>,
    #[serde(default)]
    pub private_surface_sources: BTreeMap<String, ProductAppRuntimeHostSource>,
    #[serde(default)]
    pub component_implementation_digests: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rehearsal_plan: Option<ProductAppRehearsalPlan>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_plan: Option<ProductAppEvalPlan>,
    pub package_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentPackage {
    pub component: ComponentDefinition,
    pub package_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedProductApp {
    pub app: AppDefinition,
    pub components: Vec<ComponentDefinition>,
    pub lock: ComponentLock,
    pub catalog_entry: AppCatalogEntry,
    #[serde(default)]
    pub private_surface_sources: BTreeMap<String, ProductAppRuntimeHostSource>,
    #[serde(skip)]
    pub package_dir: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct ProductAppResolveRequest {
    pub app: AppDefinition,
    pub private_components: Vec<ComponentDefinition>,
    pub shared_components: Vec<ComponentDefinition>,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct ProductAppResolver;

impl ProductAppResolver {
    pub fn resolve_install(request: ProductAppResolveRequest) -> CoreResult<ResolvedProductApp> {
        Self::resolve_install_with_implementation_digests(request, BTreeMap::new(), BTreeMap::new())
    }

    fn resolve_install_with_implementation_digests(
        request: ProductAppResolveRequest,
        component_implementation_digests: BTreeMap<String, String>,
        private_surface_sources: BTreeMap<String, ProductAppRuntimeHostSource>,
    ) -> CoreResult<ResolvedProductApp> {
        Self::resolve_install_with_implementation_digests_and_rehearsal(
            request,
            component_implementation_digests,
            private_surface_sources,
            None,
            None,
        )
    }

    pub fn resolve_package_install(
        package: ProductAppPackage,
        shared_components: Vec<ComponentDefinition>,
    ) -> CoreResult<ResolvedProductApp> {
        let package_dir = package.package_dir.clone();
        let mut resolved = Self::resolve_install_with_implementation_digests_and_rehearsal(
            ProductAppResolveRequest {
                app: package.app,
                private_components: package.private_components,
                shared_components,
            },
            package.component_implementation_digests,
            package.private_surface_sources,
            package.rehearsal_plan,
            package.eval_plan,
        )?;
        resolved.package_dir = Some(package_dir.clone());
        Self::hydrate_package_icon(&mut resolved, &package_dir)?;
        Ok(resolved)
    }

    pub(crate) fn hydrate_package_icon(
        resolved: &mut ResolvedProductApp,
        package_dir: &Path,
    ) -> CoreResult<()> {
        hydrate_package_icon(resolved, package_dir)
    }

    fn resolve_install_with_implementation_digests_and_rehearsal(
        request: ProductAppResolveRequest,
        component_implementation_digests: BTreeMap<String, String>,
        private_surface_sources: BTreeMap<String, ProductAppRuntimeHostSource>,
        rehearsal_plan: Option<ProductAppRehearsalPlan>,
        eval_plan: Option<ProductAppEvalPlan>,
    ) -> CoreResult<ResolvedProductApp> {
        validate_app_identity(&request.app)?;
        validate_work_object_kinds(&request.app)?;
        validate_component_refs("app.components", &request.app.components)?;
        validate_product_app_entry(&request.app)?;

        let mut resolver = InstallResolver::new(
            request.app.clone(),
            request.private_components,
            request.shared_components,
        )?;
        let components = resolver.resolve()?;
        let mut app = request.app;
        validate_component_implementation_refs(&app, &components)?;
        validate_implementation_digests(&components, &component_implementation_digests)?;
        let lock = build_component_lock_with_implementation_digests(
            &app,
            &components,
            &component_implementation_digests,
        );
        app.component_lock_id = lock.digest();
        let catalog_entry =
            build_catalog_entry(app.clone(), &components, &lock, rehearsal_plan, eval_plan);

        Ok(ResolvedProductApp {
            app,
            components,
            lock,
            catalog_entry,
            private_surface_sources,
            package_dir: None,
        })
    }

    pub fn build_runtime_projection(
        mut app: AppDefinition,
        components: Vec<ComponentDefinition>,
        lock: ComponentLock,
        component_implementation_digests: BTreeMap<String, String>,
        private_surface_sources: BTreeMap<String, ProductAppRuntimeHostSource>,
    ) -> CoreResult<ResolvedProductApp> {
        validate_component_implementation_refs(&app, &components)?;
        validate_runtime_lock(&app, &components, &lock, &component_implementation_digests)?;
        app.component_lock_id = lock.digest();
        let catalog_entry = build_catalog_entry(app.clone(), &components, &lock, None, None);
        Ok(ResolvedProductApp {
            app,
            components,
            lock,
            catalog_entry,
            private_surface_sources,
            package_dir: None,
        })
    }

    pub async fn read_product_app_package(package_dir: &Path) -> CoreResult<ProductAppPackage> {
        let app_path = package_dir.join("app.json");
        let app: AppDefinition = read_product_app_definition(&app_path).await?;
        reject_work_objects_sidecar(package_dir, &app)?;
        let private_components = read_private_components(
            &package_dir.join("components"),
            ComponentOwnerApp {
                app_id: app.id.clone(),
                app_version: app.version.clone(),
            },
        )
        .await?;
        let (private_surface_sources, component_implementation_digests) =
            read_private_surface_sources(package_dir, &app, &private_components).await?;
        let rehearsal_plan =
            read_optional_json(&package_dir.join("tests").join("rehearsal.json")).await?;
        let eval_plan = read_optional_json(&package_dir.join("tests").join("eval.json")).await?;
        Ok(ProductAppPackage {
            app,
            private_components,
            private_surface_sources,
            component_implementation_digests,
            rehearsal_plan,
            eval_plan,
            package_dir: package_dir.to_path_buf(),
        })
    }

    pub async fn read_component_package(package_dir: &Path) -> CoreResult<ComponentPackage> {
        let component_path = package_dir.join("component.json");
        let component: ComponentDefinition = read_json(&component_path).await?;
        validate_shared_component(&component)?;
        Ok(ComponentPackage {
            component,
            package_dir: package_dir.to_path_buf(),
        })
    }

    pub async fn write_lock(package_dir: &Path, lock: &ComponentLock) -> CoreResult<PathBuf> {
        fs::create_dir_all(package_dir).await?;
        let lock_path = package_dir.join("app.lock.json");
        let bytes = serde_json::to_vec_pretty(lock)?;
        fs::write(&lock_path, bytes).await?;
        Ok(lock_path)
    }

    pub async fn read_lock(package_dir: &Path) -> CoreResult<ComponentLock> {
        read_json(&package_dir.join("app.lock.json")).await
    }
}

struct InstallResolver {
    app: AppDefinition,
    private_components: BTreeMap<ComponentKey, ComponentDefinition>,
    shared_components: BTreeMap<ComponentKey, Vec<ComponentDefinition>>,
    resolved: BTreeMap<String, ComponentDefinition>,
    visiting: BTreeSet<String>,
}

impl InstallResolver {
    fn new(
        app: AppDefinition,
        private_components: Vec<ComponentDefinition>,
        shared_components: Vec<ComponentDefinition>,
    ) -> CoreResult<Self> {
        let private_components = private_components
            .into_iter()
            .map(|component| {
                validate_private_component(&app, &component)?;
                Ok((ComponentKey::new(component.kind, &component.id), component))
            })
            .collect::<CoreResult<BTreeMap<_, _>>>()?;

        let mut shared_by_key = BTreeMap::<ComponentKey, Vec<ComponentDefinition>>::new();
        for component in shared_components {
            validate_shared_component(&component)?;
            shared_by_key
                .entry(ComponentKey::new(component.kind, &component.id))
                .or_default()
                .push(component);
        }
        for versions in shared_by_key.values_mut() {
            versions.sort_by(|left, right| {
                parse_component_version(right)
                    .cmp(&parse_component_version(left))
                    .then_with(|| left.id.cmp(&right.id))
            });
        }

        Ok(Self {
            app,
            private_components,
            shared_components: shared_by_key,
            resolved: BTreeMap::new(),
            visiting: BTreeSet::new(),
        })
    }

    fn resolve(&mut self) -> CoreResult<Vec<ComponentDefinition>> {
        let refs = self.app.components.clone();
        for component_ref in refs {
            self.resolve_ref(&component_ref)?;
        }
        Ok(self.resolved.values().cloned().collect())
    }

    fn resolve_ref(&mut self, component_ref: &AppComponentRef) -> CoreResult<()> {
        validate_component_ref("component ref", component_ref)?;
        let component = match component_ref.source {
            ComponentSource::Private => self.resolve_private(component_ref)?,
            ComponentSource::Shared => self.resolve_shared(component_ref)?,
        };
        let fqid = component.fqid();
        if self.resolved.contains_key(&fqid) {
            return Ok(());
        }
        if !self.visiting.insert(fqid.clone()) {
            return Err(CoreError::validation(format!(
                "Component dependency cycle detected at {}",
                fqid
            )));
        }

        validate_component_refs(
            &format!("component {} dependencies", component.id),
            &component.dependencies,
        )?;
        for dependency in &component.dependencies {
            self.resolve_ref(dependency)?;
        }

        self.visiting.remove(&fqid);
        self.resolved.insert(fqid, component);
        Ok(())
    }

    fn resolve_private(
        &self,
        component_ref: &AppComponentRef,
    ) -> CoreResult<ComponentDefinition> {
        if component_ref.version.is_some() {
            return Err(CoreError::validation(format!(
                "Private component {} must not declare an independent version",
                component_ref.component_id
            )));
        }
        self.private_components
            .get(&ComponentKey::new(
                component_ref.kind,
                &component_ref.component_id,
            ))
            .cloned()
            .ok_or_else(|| {
                CoreError::validation(format!(
                    "Private component not found: {}/{}",
                    component_ref.kind.path_segment(),
                    component_ref.component_id
                ))
            })
    }

    fn resolve_shared(&self, component_ref: &AppComponentRef) -> CoreResult<ComponentDefinition> {
        let requirement = component_ref.version.as_deref().ok_or_else(|| {
            CoreError::validation(format!(
                "Shared component {} must declare a semver range",
                component_ref.component_id
            ))
        })?;
        let req = VersionReq::parse(requirement).map_err(|error| {
            CoreError::validation(format!(
                "Invalid semver range for shared component {}: {}",
                component_ref.component_id, error
            ))
        })?;
        let candidates = self
            .shared_components
            .get(&ComponentKey::new(
                component_ref.kind,
                &component_ref.component_id,
            ))
            .ok_or_else(|| {
                CoreError::validation(format!(
                    "Shared component not found: {}/{}",
                    component_ref.kind.path_segment(),
                    component_ref.component_id
                ))
            })?;
        candidates
            .iter()
            .find(|component| {
                component
                    .version
                    .as_deref()
                    .and_then(|version| Version::parse(version).ok())
                    .is_some_and(|version| req.matches(&version))
            })
            .cloned()
            .ok_or_else(|| {
                CoreError::validation(format!(
                    "No shared component version matches {} for {}/{}",
                    requirement,
                    component_ref.kind.path_segment(),
                    component_ref.component_id
                ))
            })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct ComponentKey {
    kind: ComponentKind,
    id: String,
}

impl ComponentKey {
    fn new(kind: ComponentKind, id: &str) -> Self {
        Self {
            kind,
            id: id.to_string(),
        }
    }
}

fn validate_app_identity(app: &AppDefinition) -> CoreResult<()> {
    validate_required("app.id", &app.id)?;
    validate_required("app.version", &app.version)?;
    validate_required("app.name", &app.name)?;
    validate_required("app.goal", &app.goal)?;
    Ok(())
}

fn validate_work_object_kinds(app: &AppDefinition) -> CoreResult<()> {
    if app.work_object_kinds.is_empty() && !is_studio_product_app(app) {
        return Err(CoreError::validation(format!(
            "Product App {}@{} must declare at least one workObjectKinds entry",
            app.id, app.version
        )));
    }
    let mut ids = BTreeSet::new();
    for kind in &app.work_object_kinds {
        validate_required("workObjectKinds.id", &kind.id)?;
        validate_required("workObjectKinds.label", &kind.label)?;
        if !ids.insert(kind.id.clone()) {
            return Err(CoreError::validation(format!(
                "Duplicate work object kind in app.json: {}",
                kind.id
            )));
        }
    }
    Ok(())
}

fn is_studio_product_app(app: &AppDefinition) -> bool {
    matches!(
        app.launch.as_ref().map(|launch| launch.kind),
        Some(ProductAppLaunchKind::AppStudio)
    )
}

fn validate_product_app_entry(app: &AppDefinition) -> CoreResult<()> {
    let Some(launch) = app.launch.as_ref() else {
        return Err(CoreError::validation(format!(
            "Product App {}@{} must declare a launch entry",
            app.id, app.version
        )));
    };

    match launch.kind {
        ProductAppLaunchKind::ApplicationSurface => validate_application_surface_entry(app, launch),
        ProductAppLaunchKind::AgentSession => validate_agent_session_entry(app, launch),
        ProductAppLaunchKind::AppStudio => Ok(()),
    }
}

fn validate_application_surface_entry(
    app: &AppDefinition,
    launch: &ProductAppLaunch,
) -> CoreResult<()> {
    let Some(primary_surface) = app.primary_surface.as_ref() else {
        return Err(CoreError::validation(format!(
            "Product App {}@{} launches an application surface but does not declare primarySurface",
            app.id, app.version
        )));
    };
    validate_required("primarySurface.componentId", &primary_surface.component_id)?;
    if app.primary_surface_mode.is_none() {
        return Err(CoreError::validation(format!(
            "Product App {}@{} launches an application surface but does not declare primarySurfaceMode",
            app.id, app.version
        )));
    }
    if launch.target_id != app.id {
        return Err(CoreError::validation(format!(
            "Product App {}@{} applicationSurface launch target must be the app id",
            app.id, app.version
        )));
    }
    if app.components.iter().any(|component| {
        component.kind == ComponentKind::Surface
            && component.component_id == primary_surface.component_id
    }) {
        return Ok(());
    }
    Err(CoreError::validation(format!(
        "Product App primary surface {} must be present in app.components",
        primary_surface.component_id
    )))
}

fn validate_agent_session_entry(
    app: &AppDefinition,
    launch: &ProductAppLaunch,
) -> CoreResult<()> {
    validate_required("launch.targetId", &launch.target_id)?;
    let has_agent_component = app
        .components
        .iter()
        .any(|component| component.kind == ComponentKind::Agent);
    if has_agent_component || launch.agent_type.is_some() || app.permissions.ai {
        return Ok(());
    }
    Err(CoreError::validation(format!(
        "Product App {}@{} launches an agent session but declares no Agent Component, launch.agentType, or AI permission",
        app.id, app.version
    )))
}

fn validate_implementation_digests(
    components: &[ComponentDefinition],
    digests: &BTreeMap<String, String>,
) -> CoreResult<()> {
    let component_fqids = components
        .iter()
        .map(ComponentDefinition::fqid)
        .collect::<BTreeSet<_>>();
    for fqid in digests.keys() {
        if !component_fqids.contains(fqid) {
            return Err(CoreError::validation(format!(
                "Implementation digest references unresolved component {}",
                fqid
            )));
        }
    }
    Ok(())
}

fn validate_component_implementation_refs(
    app: &AppDefinition,
    components: &[ComponentDefinition],
) -> CoreResult<()> {
    for component in components {
        match component.kind {
            ComponentKind::Surface => {
                let implementation_ref =
                    component.implementation_ref.as_deref().ok_or_else(|| {
                        CoreError::validation(format!(
                            "Product App surface {} must declare implementationRef",
                            component.id
                        ))
                    })?;
                if implementation_ref.starts_with("bundle://surface-components/") {
                    return Err(CoreError::validation(format!(
                        "Product App {}@{} uses deprecated surface bundle implementationRef {}. Package surface source under the app and use app://.",
                        app.id, app.version, implementation_ref
                    )));
                }
                if !implementation_ref.starts_with("app://") {
                    return Err(CoreError::validation(format!(
                        "Product App {}@{} surface {} must use app:// implementationRef",
                        app.id, app.version, component.id
                    )));
                }
                validate_private_component_ref(implementation_ref, app, component)?;
            }
            _ => {
                let Some(implementation_ref) = component.implementation_ref.as_deref() else {
                    continue;
                };
                if implementation_ref.starts_with("app://") {
                    validate_private_component_ref(implementation_ref, app, component)?;
                }
            }
        }
    }
    Ok(())
}

fn validate_component_refs(label: &str, refs: &[AppComponentRef]) -> CoreResult<()> {
    for component_ref in refs {
        validate_component_ref(label, component_ref)?;
    }
    Ok(())
}

fn validate_component_ref(label: &str, component_ref: &AppComponentRef) -> CoreResult<()> {
    validate_required(&format!("{label}.componentId"), &component_ref.component_id)?;
    validate_required(&format!("{label}.role"), &component_ref.role)?;
    match component_ref.source {
        ComponentSource::Private if component_ref.version.is_some() => {
            Err(CoreError::validation(format!(
                "{label}: private component {} must not declare version",
                component_ref.component_id
            )))
        }
        ComponentSource::Shared => {
            let version = component_ref.version.as_deref().unwrap_or_default();
            validate_required(&format!("{label}.version"), version)?;
            VersionReq::parse(version).map_err(|error| {
                CoreError::validation(format!(
                    "{label}: invalid shared component semver range for {}: {}",
                    component_ref.component_id, error
                ))
            })?;
            Ok(())
        }
        _ => Ok(()),
    }
}

fn validate_private_component(
    app: &AppDefinition,
    component: &ComponentDefinition,
) -> CoreResult<()> {
    validate_required("component.id", &component.id)?;
    if component.package_source != ComponentPackageSource::AppPrivate {
        return Err(CoreError::validation(format!(
            "Private component {} must use packageSource=appPrivate",
            component.id
        )));
    }
    if component.version.is_some() {
        return Err(CoreError::validation(format!(
            "App-private component {} must not declare an independent version",
            component.id
        )));
    }
    let owner = component.owner_app.as_ref().ok_or_else(|| {
        CoreError::validation(format!(
            "App-private component {} must declare ownerApp",
            component.id
        ))
    })?;
    if owner.app_id != app.id || owner.app_version != app.version {
        return Err(CoreError::validation(format!(
            "App-private component {} ownerApp must match {}@{}",
            component.id, app.id, app.version
        )));
    }
    Ok(())
}

fn validate_shared_component(component: &ComponentDefinition) -> CoreResult<()> {
    validate_required("component.id", &component.id)?;
    if component.package_source != ComponentPackageSource::Shared {
        return Err(CoreError::validation(format!(
            "Shared component {} must use packageSource=shared",
            component.id
        )));
    }
    if component.owner_app.is_some() {
        return Err(CoreError::validation(format!(
            "Shared component {} must not declare ownerApp",
            component.id
        )));
    }
    let version = component.version.as_deref().unwrap_or_default();
    validate_required("component.version", version)?;
    Version::parse(version).map_err(|error| {
        CoreError::validation(format!(
            "Invalid shared component version for {}: {}",
            component.id, error
        ))
    })?;
    Ok(())
}

fn validate_runtime_lock(
    app: &AppDefinition,
    components: &[ComponentDefinition],
    lock: &ComponentLock,
    component_implementation_digests: &BTreeMap<String, String>,
) -> CoreResult<()> {
    if lock.app_id != app.id || lock.version != app.version {
        return Err(CoreError::validation(format!(
            "Lock {}@{} does not match app {}@{}",
            lock.app_id, lock.version, app.id, app.version
        )));
    }

    let expected = build_component_lock_with_implementation_digests(
        app,
        components,
        component_implementation_digests,
    );
    if lock.permission_digest != expected.permission_digest {
        return Err(CoreError::validation(
            "App lock permission digest does not match component definitions",
        ));
    }
    if lock.component_graph_digest != expected.component_graph_digest {
        return Err(CoreError::validation(
            "App lock component graph digest does not match component definitions",
        ));
    }
    if lock.resolved_components.len() != expected.resolved_components.len() {
        return Err(CoreError::validation(
            "App lock resolved component count does not match component definitions",
        ));
    }
    for expected_entry in expected.resolved_components {
        let Some(actual_entry) = lock
            .resolved_components
            .iter()
            .find(|entry| entry.fqid == expected_entry.fqid)
        else {
            return Err(CoreError::validation(format!(
                "App lock is missing resolved component {}",
                expected_entry.fqid
            )));
        };
        if actual_entry.digest != expected_entry.digest {
            return Err(CoreError::validation(format!(
                "App lock digest mismatch for {}",
                expected_entry.fqid
            )));
        }
        if actual_entry.implementation_digest != expected_entry.implementation_digest {
            return Err(CoreError::validation(format!(
                "App lock implementation digest mismatch for {}",
                expected_entry.fqid
            )));
        }
    }
    Ok(())
}

fn build_catalog_entry(
    app: AppDefinition,
    components: &[ComponentDefinition],
    lock: &ComponentLock,
    rehearsal_plan: Option<ProductAppRehearsalPlan>,
    eval_plan: Option<ProductAppEvalPlan>,
) -> ProductAppCatalogEntry {
    ProductAppCatalogEntry {
        app,
        component_lock_digest: lock.digest(),
        package_digest: None,
        update_available: false,
        installed_component_lock_digest: None,
        available_component_lock_digest: None,
        installed_package_digest: None,
        available_package_digest: None,
        catalog_release_id: None,
        catalog_release_label: None,
        catalog_release_notes: None,
        catalog_published_at_ms: None,
        dependency_summary: dependency_summary(components),
        installed: false,
        discoverable: false,
        library_sources: Vec::new(),
        catalog_source: None,
        catalog_issues: Vec::new(),
        management: Default::default(),
        rehearsal_plan,
        eval_plan,
    }
}

const MAX_APP_ICON_ASSET_BYTES: u64 = 2 * 1024 * 1024;

fn hydrate_package_icon(resolved: &mut ResolvedProductApp, package_dir: &Path) -> CoreResult<()> {
    hydrate_package_icon_spec(&mut resolved.app.icon, package_dir)?;
    resolved.catalog_entry.app.icon = resolved.app.icon.clone();
    Ok(())
}

pub(crate) fn hydrate_package_icon_spec(
    icon: &mut AppIconSpec,
    package_dir: &Path,
) -> CoreResult<()> {
    let AppIconSpec::PackageAsset {
        path,
        mime_type,
        digest,
        uri,
        ..
    } = icon
    else {
        return Ok(());
    };

    validate_package_icon_asset_path(path)?;
    let asset_path = package_dir.join(path.as_str());
    let metadata = std::fs::metadata(&asset_path).map_err(|error| {
        CoreError::validation(format!(
            "Product App icon asset not found or unreadable: {} ({})",
            path, error
        ))
    })?;
    if !metadata.is_file() {
        return Err(CoreError::validation(format!(
            "Product App icon asset must be a file: {}",
            path
        )));
    }
    if metadata.len() > MAX_APP_ICON_ASSET_BYTES {
        return Err(CoreError::validation(format!(
            "Product App icon asset exceeds {} bytes: {}",
            MAX_APP_ICON_ASSET_BYTES, path
        )));
    }

    let detected_mime_type = detect_icon_asset_mime_type(&asset_path)?;
    let bytes = std::fs::read(&asset_path)?;
    validate_icon_asset_bytes(path, detected_mime_type, &bytes)?;

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);

    *mime_type = Some(detected_mime_type.to_string());
    *digest = Some(format!("sha256:{:x}", hasher.finalize()));
    *uri = Some(format!("data:{detected_mime_type};base64,{encoded}"));
    Ok(())
}

fn validate_package_icon_asset_path(path: &str) -> CoreResult<()> {
    let relative = Path::new(path);
    if path.trim().is_empty() || relative.is_absolute() {
        return Err(CoreError::validation(format!(
            "Product App icon asset path must be package-relative: {}",
            path
        )));
    }
    for component in relative.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(CoreError::validation(format!(
                "Product App icon asset path must not escape the package: {}",
                path
            )));
        }
    }
    if !path.starts_with("assets/") && !path.starts_with("assets\\") {
        return Err(CoreError::validation(format!(
            "Product App icon asset must live under assets/: {}",
            path
        )));
    }
    Ok(())
}

fn detect_icon_asset_mime_type(path: &Path) -> CoreResult<&'static str> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Ok("image/png"),
        "webp" => Ok("image/webp"),
        "svg" => Ok("image/svg+xml"),
        extension => Err(CoreError::validation(format!(
            "Unsupported Product App icon asset extension: {}",
            extension
        ))),
    }
}

fn validate_icon_asset_bytes(path: &str, mime_type: &str, bytes: &[u8]) -> CoreResult<()> {
    if bytes.is_empty() {
        return Err(CoreError::validation(format!(
            "Product App icon asset is empty: {}",
            path
        )));
    }
    if mime_type == "image/svg+xml" {
        let svg = std::str::from_utf8(bytes).map_err(|error| {
            CoreError::validation(format!(
                "Product App SVG icon must be valid UTF-8: {} ({})",
                path, error
            ))
        })?;
        let lower = svg.to_ascii_lowercase();
        if lower.contains("<script") || lower.contains("onload=") || lower.contains("javascript:") {
            return Err(CoreError::validation(format!(
                "Product App SVG icon contains unsafe executable content: {}",
                path
            )));
        }
    }
    Ok(())
}

fn dependency_summary(components: &[ComponentDefinition]) -> String {
    let mut counts = BTreeMap::<&'static str, usize>::new();
    for component in components {
        let label = match component.kind {
            ComponentKind::Surface => "Surface",
            ComponentKind::Agent => "Agent",
            ComponentKind::Bridge => "Bridge",
            ComponentKind::Runtime => "Runtime",
            ComponentKind::Tool => "Tool",
            ComponentKind::Skill => "Skill",
        };
        *counts.entry(label).or_default() += 1;
    }
    counts
        .into_iter()
        .map(|(kind, count)| format!("{} {}", count, kind))
        .collect::<Vec<_>>()
        .join(", ")
}

async fn read_json<T>(path: &Path) -> CoreResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    let bytes = fs::read(path).await.map_err(|error| {
        CoreError::io(format!("Failed to read {}: {}", path.display(), error))
    })?;
    serde_json::from_slice(&bytes).map_err(CoreError::from)
}

async fn read_product_app_definition(path: &Path) -> CoreResult<AppDefinition> {
    let bytes = fs::read(path).await.map_err(|error| {
        CoreError::io(format!("Failed to read {}: {}", path.display(), error))
    })?;
    let mut value: Value = serde_json::from_slice(&bytes).map_err(CoreError::from)?;
    if canonicalize_legacy_icon_value(&mut value) {
        let bytes = serde_json::to_vec_pretty(&value).map_err(CoreError::from)?;
        fs::write(path, bytes).await.map_err(|error| {
            CoreError::io(format!("Failed to write {}: {}", path.display(), error))
        })?;
    }
    serde_json::from_value(value).map_err(CoreError::from)
}

fn canonicalize_legacy_icon_value(value: &mut Value) -> bool {
    let Some(icon_name) = value.get("icon").and_then(Value::as_str) else {
        return false;
    };
    let icon = if icon_name.trim().is_empty() || icon_name.eq_ignore_ascii_case("app") {
        let label = value
            .get("name")
            .and_then(Value::as_str)
            .or_else(|| value.get("id").and_then(Value::as_str))
            .unwrap_or("App");
        serde_json::json!({
            "kind": "monogram",
            "label": label
        })
    } else {
        serde_json::json!({
            "kind": "lucide",
            "name": icon_name
        })
    };
    value["icon"] = icon;
    true
}

async fn read_optional_json<T>(path: &Path) -> CoreResult<Option<T>>
where
    T: for<'de> Deserialize<'de>,
{
    match fs::read(path).await {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(CoreError::from),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(CoreError::io(format!(
            "Failed to read {}: {}",
            path.display(),
            error
        ))),
    }
}

fn reject_work_objects_sidecar(package_dir: &Path, app: &AppDefinition) -> CoreResult<()> {
    let sidecar = package_dir.join("work-objects");
    if !sidecar.exists() {
        return Ok(());
    }
    let has_entries = std::fs::read_dir(&sidecar)
        .map_err(CoreError::from)?
        .next()
        .transpose()
        .map_err(CoreError::from)?
        .is_some();
    if !has_entries {
        return Ok(());
    }
    Err(CoreError::validation(format!(
        "Product App {}@{} uses deprecated work-objects sidecar files. Declare workObjectKinds in app.json.",
        app.id, app.version
    )))
}

async fn read_private_surface_sources(
    package_dir: &Path,
    app: &AppDefinition,
    components: &[ComponentDefinition],
) -> CoreResult<(
    BTreeMap<String, ProductAppRuntimeHostSource>,
    BTreeMap<String, String>,
)> {
    let mut sources = BTreeMap::new();
    let mut digests = BTreeMap::new();
    for component in components {
        let Some(implementation_ref) = component.implementation_ref.as_deref() else {
            continue;
        };
        if !implementation_ref.starts_with("app://") {
            continue;
        }
        let component_dir = package_dir
            .join("components")
            .join(component.kind.path_segment())
            .join(&component.id);
        validate_private_component_ref(implementation_ref, app, component)?;
        if component.kind == ComponentKind::Surface {
            let source = read_surface_source_from_package(&component_dir).await?;
            digests.insert(component.fqid(), stable_digest(&source));
            sources.insert(component.id.clone(), source);
        } else {
            let source_dir = component_dir.join("source");
            if !source_dir.is_dir() {
                return Err(CoreError::validation(format!(
                    "App-private Product App component {} must include source/",
                    component_dir.display()
                )));
            }
            digests.insert(component.fqid(), filesystem_source_digest(&source_dir)?);
        }
    }
    Ok((sources, digests))
}

fn validate_private_component_ref(
    implementation_ref: &str,
    app: &AppDefinition,
    component: &ComponentDefinition,
) -> CoreResult<()> {
    let Some(rest) = implementation_ref.strip_prefix("app://") else {
        return Err(CoreError::validation(format!(
            "Invalid private component implementationRef: {}",
            implementation_ref
        )));
    };
    let Some((identity, path)) = rest.split_once('/') else {
        return Err(CoreError::validation(format!(
            "Invalid private component implementationRef: {}",
            implementation_ref
        )));
    };
    let expected_identity = format!("{}@{}", app.id, app.version);
    if identity != expected_identity {
        return Err(CoreError::validation(format!(
            "Private component {} does not belong to Product App {}",
            implementation_ref, expected_identity
        )));
    }
    let expected_path = format!("{}/{}", component.kind.path_segment(), component.id);
    if path != expected_path {
        return Err(CoreError::validation(format!(
            "Private component {} does not match app-private Product App component {}",
            implementation_ref, component.id
        )));
    }
    Ok(())
}

async fn read_surface_source_from_package(
    component_dir: &Path,
) -> CoreResult<ProductAppRuntimeHostSource> {
    let source_dir = component_dir.join("source");
    if !source_dir.is_dir() {
        return Err(CoreError::validation(format!(
            "App-private Product App surface {} must include source/",
            component_dir.display()
        )));
    }

    let html = read_optional_text(&source_dir.join("index.html")).await?;
    let css = read_optional_text(&source_dir.join("style.css")).await?;
    let ui_js = read_optional_text(&source_dir.join("ui.js")).await?;
    let worker_js = read_optional_text(&source_dir.join("worker.js")).await?;
    if html.trim().is_empty() {
        return Err(CoreError::validation(format!(
            "App-private surface source {} must include non-empty index.html",
            source_dir.display()
        )));
    }
    if ui_js.trim().is_empty() {
        return Err(CoreError::validation(format!(
            "App-private surface source {} must include non-empty ui.js",
            source_dir.display()
        )));
    }

    let esm_dependencies = read_optional_json(&source_dir.join("esm_dependencies.json"))
        .await?
        .unwrap_or_default();
    let i18n_messages = read_optional_json(&source_dir.join("i18n.json"))
        .await?
        .unwrap_or_else(|| serde_json::json!({}));
    let entry = read_optional_json(&source_dir.join("source_manifest.json"))
        .await?
        .unwrap_or_default();
    let npm_dependencies =
        read_optional_package_dependencies(&component_dir.join("package.json")).await?;
    let source_files = read_extra_surface_source_files(&source_dir).await?;

    Ok(ProductAppRuntimeHostSource {
        html,
        css,
        ui_js,
        esm_dependencies,
        i18n_messages,
        worker_js,
        npm_dependencies,
        entry,
        source_files,
    })
}

fn filesystem_source_digest(source_dir: &Path) -> CoreResult<String> {
    let mut files = Vec::new();
    collect_source_files(source_dir, &mut files)?;
    files.sort_by(|left, right| normalized_digest_path(left).cmp(&normalized_digest_path(right)));

    let mut hasher = Sha256::new();
    for file in files {
        let relative = file.strip_prefix(source_dir).map_err(|error| {
            CoreError::io(format!("Invalid component source path: {}", error))
        })?;
        hasher.update(normalized_digest_path(relative).as_bytes());
        hasher.update([0]);
        hasher.update(std::fs::read(&file)?);
        hasher.update([0]);
    }
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn collect_source_files(dir: &Path, out: &mut Vec<PathBuf>) -> CoreResult<()> {
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            if path.file_name().is_some_and(|name| name == "node_modules") {
                continue;
            }
            collect_source_files(&path, out)?;
        } else if path.is_file() {
            out.push(path);
        }
    }
    Ok(())
}

fn normalized_digest_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

async fn read_optional_text(path: &Path) -> CoreResult<String> {
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(path)
        .await
        .map_err(|error| CoreError::io(format!("Failed to read {}: {}", path.display(), error)))
}

async fn read_optional_package_dependencies(path: &Path) -> CoreResult<Vec<NpmDep>> {
    let Some(package_json): Option<serde_json::Value> = read_optional_json(path).await? else {
        return Ok(Vec::new());
    };
    let dependencies = package_json
        .get("dependencies")
        .and_then(serde_json::Value::as_object)
        .map(|deps| {
            deps.iter()
                .filter_map(|(name, value)| {
                    value.as_str().map(|version| NpmDep {
                        name: name.clone(),
                        version: version.to_string(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(dependencies)
}

async fn read_extra_surface_source_files(
    source_dir: &Path,
) -> CoreResult<Vec<ProductAppRuntimeHostSourceFile>> {
    const STANDARD_SOURCE_FILES: &[&str] = &[
        "index.html",
        "style.css",
        "ui.js",
        "worker.js",
        "esm_dependencies.json",
        "i18n.json",
        "source_manifest.json",
    ];
    let mut files = Vec::new();
    let mut stack = vec![source_dir.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let mut read_dir = fs::read_dir(&dir)
            .await
            .map_err(|error| CoreError::io(format!("Failed to read source dir: {}", error)))?;
        while let Some(entry) = read_dir
            .next_entry()
            .await
            .map_err(|error| CoreError::io(format!("Failed to read source entry: {}", error)))?
        {
            let path = entry.path();
            if path.is_dir() {
                if path.file_name().is_some_and(|name| name == "node_modules") {
                    continue;
                }
                stack.push(path);
                continue;
            }
            let relative = path
                .strip_prefix(source_dir)
                .map_err(|error| CoreError::io(format!("Invalid source path: {}", error)))?
                .to_string_lossy()
                .replace('\\', "/");
            if STANDARD_SOURCE_FILES.contains(&relative.as_str()) {
                continue;
            }
            files.push(ProductAppRuntimeHostSourceFile {
                kind: infer_surface_source_file_kind(&relative),
                path: relative,
                content: fs::read_to_string(&path).await.unwrap_or_default(),
            });
        }
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

fn infer_surface_source_file_kind(path: &str) -> ProductAppRuntimeHostSourceFileKind {
    if path.ends_with(".js") || path.ends_with(".mjs") || path.ends_with(".ts") {
        ProductAppRuntimeHostSourceFileKind::Script
    } else if path.ends_with(".css") || path.ends_with(".scss") {
        ProductAppRuntimeHostSourceFileKind::Style
    } else if path.ends_with(".html") {
        ProductAppRuntimeHostSourceFileKind::Html
    } else if path.ends_with(".json") {
        ProductAppRuntimeHostSourceFileKind::Json
    } else {
        ProductAppRuntimeHostSourceFileKind::Asset
    }
}

async fn read_private_components(
    components_dir: &Path,
    owner_app: ComponentOwnerApp,
) -> CoreResult<Vec<ComponentDefinition>> {
    if !components_dir.exists() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    let mut kind_entries = fs::read_dir(components_dir).await?;
    while let Some(kind_entry) = kind_entries.next_entry().await? {
        let kind_path = kind_entry.path();
        if !kind_path.is_dir() {
            continue;
        }
        let mut component_entries = fs::read_dir(&kind_path).await?;
        while let Some(component_entry) = component_entries.next_entry().await? {
            let component_path = component_entry.path().join("component.json");
            if !component_path.exists() {
                continue;
            }
            let mut component: ComponentDefinition = read_json(&component_path).await?;
            if component.package_source == ComponentPackageSource::AppPrivate
                && component.owner_app.is_none()
            {
                component.owner_app = Some(owner_app.clone());
            }
            out.push(component);
        }
    }
    out.sort_by(|left, right| {
        left.kind
            .path_segment()
            .cmp(right.kind.path_segment())
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(out)
}

fn parse_component_version(component: &ComponentDefinition) -> Version {
    component
        .version
        .as_deref()
        .and_then(|version| Version::parse(version).ok())
        .unwrap_or_else(|| Version::new(0, 0, 0))
}

fn validate_required(field: &str, value: &str) -> CoreResult<()> {
    if value.trim().is_empty() {
        return Err(CoreError::validation(format!("{field} cannot be empty")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde_json::json;

    use super::*;
    use crate::app_platform::{
        AppCatalogVisibility, AppDataLifecyclePolicy, AppInstallScope, AppInteractionModel,
        AppPermissionSummary, AppSurfaceMode, AppTruthSource, AppWorkMultiplicity,
        ComponentVisibility, ProductAppLaunch, ProductAppLaunchKind,
        ProductAppLaunchScopeRequirement, SurfaceRef, WorkObjectKind, WorkObjectScope,
    };

    #[test]
    fn resolver_locks_highest_matching_shared_component() {
        let app = test_app(vec![
            private_ref("preview", ComponentKind::Surface, "primarySurface"),
            shared_ref(
                "runtime-host",
                ComponentKind::Runtime,
                "^2.0.0",
                "runtimeHost",
            ),
        ]);
        let private_components = vec![private_component(&app, "preview", ComponentKind::Surface)];
        let shared_components = vec![
            shared_component("runtime-host", ComponentKind::Runtime, "1.9.0"),
            shared_component("runtime-host", ComponentKind::Runtime, "2.1.3"),
            shared_component("runtime-host", ComponentKind::Runtime, "2.0.1"),
        ];

        let resolved = ProductAppResolver::resolve_install(ProductAppResolveRequest {
            app,
            private_components,
            shared_components,
        })
        .expect("resolver should succeed");

        assert!(resolved.app.component_lock_id.starts_with("sha256:"));
        assert!(resolved.lock.resolved_components.iter().any(|entry| {
            entry.component_id == "runtime-host" && entry.version.as_deref() == Some("2.1.3")
        }));
    }

    #[test]
    fn resolver_rejects_shared_component_without_semver_range() {
        let app = test_app(vec![
            private_ref("preview", ComponentKind::Surface, "primarySurface"),
            AppComponentRef {
                component_id: "runtime-host".to_string(),
                kind: ComponentKind::Runtime,
                source: ComponentSource::Shared,
                role: "runtimeHost".to_string(),
                version: None,
                capabilities: vec![],
            },
        ]);
        let error = ProductAppResolver::resolve_install(ProductAppResolveRequest {
            private_components: vec![private_component(&app, "preview", ComponentKind::Surface)],
            shared_components: vec![shared_component(
                "runtime-host",
                ComponentKind::Runtime,
                "2.1.3",
            )],
            app,
        })
        .expect_err("missing semver range must fail");

        assert!(error.to_string().contains("version"));
    }

    #[test]
    fn resolver_rejects_non_studio_product_app_without_work_objects() {
        let mut app = test_app(vec![private_ref(
            "preview",
            ComponentKind::Surface,
            "primarySurface",
        )]);
        app.work_object_kinds.clear();

        let error = ProductAppResolver::resolve_install(ProductAppResolveRequest {
            private_components: vec![private_component(&app, "preview", ComponentKind::Surface)],
            shared_components: vec![],
            app,
        })
        .expect_err("non-Studio Product App must declare Work Objects");

        assert!(error.to_string().contains("workObjectKinds"));
    }

    #[test]
    fn resolver_allows_studio_product_app_without_work_objects() {
        let mut app = test_app(vec![private_ref(
            "preview",
            ComponentKind::Surface,
            "primarySurface",
        )]);
        app.work_object_kinds.clear();
        app.launch = Some(ProductAppLaunch {
            kind: ProductAppLaunchKind::AppStudio,
            target_id: "AppStudio".to_string(),
            scope_requirement: ProductAppLaunchScopeRequirement::SystemAllowed,
            agent_type: Some("AppStudio".to_string()),
            surface_id: Some("primary".to_string()),
        });

        let resolved = ProductAppResolver::resolve_install(ProductAppResolveRequest {
            private_components: vec![private_component(&app, "preview", ComponentKind::Surface)],
            shared_components: vec![],
            app,
        })
        .expect("Studio Product Apps are outside this Work Object enforcement slice");

        assert!(resolved.app.component_lock_id.starts_with("sha256:"));
    }

    #[test]
    fn resolver_rejects_deprecated_surface_bundle_refs() {
        let app = test_app(vec![private_ref(
            "preview",
            ComponentKind::Surface,
            "primarySurface",
        )]);
        let mut surface = private_component(&app, "preview", ComponentKind::Surface);
        surface.implementation_ref = Some("bundle://surface-components/remotion-live".to_string());

        let error = ProductAppResolver::resolve_install(ProductAppResolveRequest {
            private_components: vec![surface],
            shared_components: vec![],
            app,
        })
        .expect_err("Product App package must not keep surface bundle refs");

        assert!(error.to_string().contains("deprecated surface bundle"));
    }

    #[test]
    fn runtime_projection_rejects_lock_digest_drift() {
        let app = test_app(vec![private_ref(
            "preview",
            ComponentKind::Surface,
            "primarySurface",
        )]);
        let private_components = vec![private_component(&app, "preview", ComponentKind::Surface)];
        let resolved = ProductAppResolver::resolve_install(ProductAppResolveRequest {
            app: app.clone(),
            private_components: private_components.clone(),
            shared_components: vec![],
        })
        .expect("resolver should succeed");
        let mut bad_lock = resolved.lock;
        bad_lock.permission_digest = "sha256:bad".to_string();

        let error = ProductAppResolver::build_runtime_projection(
            app,
            private_components,
            bad_lock,
            BTreeMap::new(),
            BTreeMap::new(),
        )
        .expect_err("bad lock must fail");

        assert!(error.to_string().contains("permission digest"));
    }

    fn test_app(components: Vec<AppComponentRef>) -> AppDefinition {
        AppDefinition {
            id: "remotion-live".to_string(),
            version: "1.0.0".to_string(),
            name: "Remotion Live".to_string(),
            description: "Preview and edit Remotion projects.".to_string(),
            goal: "Collaborate on a Remotion video project.".to_string(),
            interaction_model: AppInteractionModel::InteractiveWorkspace,
            work_multiplicity: AppWorkMultiplicity::Multiple,
            work_object_kinds: vec![WorkObjectKind {
                id: "composition".to_string(),
                label: "Composition".to_string(),
                scope: WorkObjectScope::Runtime,
                identity_schema: json!({ "type": "object" }),
                context_schema: json!({ "type": "object" }),
            }],
            data_lifecycle: Some(AppDataLifecyclePolicy::default()),
            truth_source: Some(AppTruthSource::RuntimeFact),
            primary_surface: Some(SurfaceRef {
                component_id: "preview".to_string(),
                surface_id: Some("primary".to_string()),
            }),
            primary_surface_mode: Some(AppSurfaceMode::SidecarLinked),
            components,
            component_lock_id: String::new(),
            permissions: AppPermissionSummary::default(),
            install_scope: AppInstallScope::System,
            catalog_visibility: AppCatalogVisibility::Discoverable,
            enabled: true,
            icon: AppIconSpec::Monogram {
                label: "Remotion Live".to_string(),
                seed: None,
                background: None,
            },
            category: "creative".to_string(),
            tags: vec![],
            launch: Some(ProductAppLaunch {
                kind: ProductAppLaunchKind::ApplicationSurface,
                target_id: "remotion-live".to_string(),
                scope_requirement: Default::default(),
                agent_type: None,
                surface_id: Some("primary".to_string()),
            }),
        }
    }

    fn private_ref(component_id: &str, kind: ComponentKind, role: &str) -> AppComponentRef {
        AppComponentRef {
            component_id: component_id.to_string(),
            kind,
            source: ComponentSource::Private,
            role: role.to_string(),
            version: None,
            capabilities: vec![],
        }
    }

    fn shared_ref(
        component_id: &str,
        kind: ComponentKind,
        version: &str,
        role: &str,
    ) -> AppComponentRef {
        AppComponentRef {
            component_id: component_id.to_string(),
            kind,
            source: ComponentSource::Shared,
            role: role.to_string(),
            version: Some(version.to_string()),
            capabilities: vec![],
        }
    }

    fn private_component(
        app: &AppDefinition,
        id: &str,
        kind: ComponentKind,
    ) -> ComponentDefinition {
        let implementation_ref = (kind == ComponentKind::Surface).then(|| {
            format!(
                "app://{}@{}/{}/{}",
                app.id,
                app.version,
                ComponentKind::Surface.path_segment(),
                id
            )
        });
        ComponentDefinition {
            id: id.to_string(),
            version: None,
            kind,
            name: id.to_string(),
            description: id.to_string(),
            package_source: ComponentPackageSource::AppPrivate,
            owner_app: Some(ComponentOwnerApp {
                app_id: app.id.clone(),
                app_version: app.version.clone(),
            }),
            capabilities: vec![],
            permissions: vec![],
            used_by_apps: vec![app.id.clone()],
            visibility: ComponentVisibility::AppDependency,
            dependencies: vec![],
            implementation_ref,
        }
    }

    fn shared_component(id: &str, kind: ComponentKind, version: &str) -> ComponentDefinition {
        ComponentDefinition {
            id: id.to_string(),
            version: Some(version.to_string()),
            kind,
            name: id.to_string(),
            description: id.to_string(),
            package_source: ComponentPackageSource::Shared,
            owner_app: None,
            capabilities: vec![],
            permissions: vec![],
            used_by_apps: vec![],
            visibility: ComponentVisibility::Developer,
            dependencies: vec![],
            implementation_ref: None,
        }
    }

    #[tokio::test]
    async fn package_reader_rejects_work_object_sidecar() {
        let root = test_root("work-object-sidecar");
        std::fs::create_dir_all(root.join("work-objects")).unwrap();
        let app = test_app(vec![private_ref(
            "preview",
            ComponentKind::Surface,
            "primarySurface",
        )]);
        write_json_sync(root.join("app.json"), &app);
        write_json_sync(
            root.join("work-objects").join("composition.json"),
            &json!({
                "id": "composition",
                "label": "Composition",
                "scope": "runtime"
            }),
        );

        let error = ProductAppResolver::read_product_app_package(&root)
            .await
            .expect_err("work-objects sidecar must be rejected")
            .to_string();

        assert!(error.contains("Declare workObjectKinds in app.json"));
    }

    #[tokio::test]
    async fn package_reader_canonicalizes_legacy_string_icon() {
        let root = test_root("legacy-string-icon");
        let app = test_app(vec![private_ref(
            "preview",
            ComponentKind::Surface,
            "primarySurface",
        )]);
        let mut app_value = serde_json::to_value(&app).unwrap();
        app_value["icon"] = json!("Boxes");
        write_json_sync(root.join("app.json"), &app_value);

        let package = ProductAppResolver::read_product_app_package(&root)
            .await
            .expect("legacy string icon should be canonicalized before AppDefinition deserialize");

        assert_eq!(
            package.app.icon,
            AppIconSpec::Lucide {
                name: "Boxes".to_string(),
                background: None,
            }
        );

        let repaired: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("app.json")).unwrap()).unwrap();
        assert_eq!(repaired["icon"]["kind"], "lucide");
        assert_eq!(repaired["icon"]["name"], "Boxes");
    }

    #[tokio::test]
    async fn package_private_surface_source_digest_enters_lock() {
        let root = test_root("private-surface-source");
        let app = test_app(vec![private_ref(
            "preview",
            ComponentKind::Surface,
            "primarySurface",
        )]);
        let mut surface = private_component(&app, "preview", ComponentKind::Surface);
        surface.implementation_ref = Some("app://remotion-live@1.0.0/surfaces/preview".to_string());

        write_json_sync(root.join("app.json"), &app);
        let surface_dir = root.join("components").join("surfaces").join("preview");
        write_json_sync(surface_dir.join("component.json"), &surface);
        std::fs::create_dir_all(surface_dir.join("source")).unwrap();
        std::fs::write(
            surface_dir.join("source").join("index.html"),
            "<main id=\"root\"></main>",
        )
        .unwrap();
        std::fs::write(
            surface_dir.join("source").join("ui.js"),
            "document.getElementById('root').textContent = 'Loaded from package source';",
        )
        .unwrap();

        let package = ProductAppResolver::read_product_app_package(&root)
            .await
            .expect("package should parse source");
        assert!(package.private_surface_sources.contains_key("preview"));
        assert!(package
            .component_implementation_digests
            .contains_key(&surface.fqid()));

        let resolved = ProductAppResolver::resolve_package_install(package, Vec::new())
            .expect("package source digest should resolve into lock");
        let entry = resolved
            .lock
            .resolved_components
            .iter()
            .find(|entry| entry.component_id == "preview")
            .expect("surface lock entry");

        assert!(entry.implementation_digest.is_some());
    }

    fn test_root(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("sparo-resolver-{name}-{nanos}"))
    }

    fn write_json_sync(path: PathBuf, value: &impl Serialize) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let bytes = serde_json::to_vec_pretty(value).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
}
