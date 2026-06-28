use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use tokio::fs;

use crate::util::errors::{BitFunError, BitFunResult};

use super::catalog::{
    AppCatalogEntry, AppComponentRef, AppDefinition, ComponentDefinition, ComponentKind,
    ComponentLock, ComponentOwnerApp, ComponentPackageSource, ComponentSource,
    ProductAppCatalogEntry, WorkObjectKind, build_component_lock,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppPackage {
    pub app: AppDefinition,
    #[serde(default)]
    pub private_components: Vec<ComponentDefinition>,
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
    pub fn resolve_install(request: ProductAppResolveRequest) -> BitFunResult<ResolvedProductApp> {
        validate_app_identity(&request.app)?;
        validate_component_refs("app.components", &request.app.components)?;
        validate_primary_surface_ref(&request.app)?;

        let mut resolver = InstallResolver::new(
            request.app.clone(),
            request.private_components,
            request.shared_components,
        )?;
        let components = resolver.resolve()?;
        let mut app = request.app;
        let lock = build_component_lock(&app, &components);
        app.component_lock_id = lock.digest();
        let catalog_entry = build_catalog_entry(app.clone(), &components, &lock);

        Ok(ResolvedProductApp {
            app,
            components,
            lock,
            catalog_entry,
        })
    }

    pub fn build_runtime_projection(
        mut app: AppDefinition,
        components: Vec<ComponentDefinition>,
        lock: ComponentLock,
    ) -> BitFunResult<ResolvedProductApp> {
        validate_runtime_lock(&app, &components, &lock)?;
        app.component_lock_id = lock.digest();
        let catalog_entry = build_catalog_entry(app.clone(), &components, &lock);
        Ok(ResolvedProductApp {
            app,
            components,
            lock,
            catalog_entry,
        })
    }

    pub async fn read_product_app_package(package_dir: &Path) -> BitFunResult<ProductAppPackage> {
        let app_path = package_dir.join("app.json");
        let mut app: AppDefinition = read_json(&app_path).await?;
        let work_objects = read_work_objects(&package_dir.join("work-objects")).await?;
        if !work_objects.is_empty() {
            app.work_object_kinds = work_objects;
        }
        let private_components = read_private_components(
            &package_dir.join("components"),
            ComponentOwnerApp {
                app_id: app.id.clone(),
                app_version: app.version.clone(),
            },
        )
        .await?;
        Ok(ProductAppPackage {
            app,
            private_components,
            package_dir: package_dir.to_path_buf(),
        })
    }

    pub async fn read_component_package(package_dir: &Path) -> BitFunResult<ComponentPackage> {
        let component_path = package_dir.join("component.json");
        let component: ComponentDefinition = read_json(&component_path).await?;
        validate_shared_component(&component)?;
        Ok(ComponentPackage {
            component,
            package_dir: package_dir.to_path_buf(),
        })
    }

    pub async fn write_lock(package_dir: &Path, lock: &ComponentLock) -> BitFunResult<PathBuf> {
        fs::create_dir_all(package_dir).await?;
        let lock_path = package_dir.join("app.lock.json");
        let bytes = serde_json::to_vec_pretty(lock)?;
        fs::write(&lock_path, bytes).await?;
        Ok(lock_path)
    }

    pub async fn read_lock(package_dir: &Path) -> BitFunResult<ComponentLock> {
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
    ) -> BitFunResult<Self> {
        let private_components = private_components
            .into_iter()
            .map(|component| {
                validate_private_component(&app, &component)?;
                Ok((ComponentKey::new(component.kind, &component.id), component))
            })
            .collect::<BitFunResult<BTreeMap<_, _>>>()?;

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

    fn resolve(&mut self) -> BitFunResult<Vec<ComponentDefinition>> {
        let refs = self.app.components.clone();
        for component_ref in refs {
            self.resolve_ref(&component_ref)?;
        }
        let primary_surface = AppComponentRef {
            component_id: self.app.primary_surface.component_id.clone(),
            kind: ComponentKind::Surface,
            source: ComponentSource::Private,
            role: "primarySurface".to_string(),
            version: None,
            capabilities: Vec::new(),
        };
        if !self.resolved.values().any(|component| {
            component.id == primary_surface.component_id && component.kind == ComponentKind::Surface
        }) {
            self.resolve_ref(&primary_surface)?;
        }
        Ok(self.resolved.values().cloned().collect())
    }

    fn resolve_ref(&mut self, component_ref: &AppComponentRef) -> BitFunResult<()> {
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
            return Err(BitFunError::validation(format!(
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
    ) -> BitFunResult<ComponentDefinition> {
        if component_ref.version.is_some() {
            return Err(BitFunError::validation(format!(
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
                BitFunError::validation(format!(
                    "Private component not found: {}/{}",
                    component_ref.kind.path_segment(),
                    component_ref.component_id
                ))
            })
    }

    fn resolve_shared(&self, component_ref: &AppComponentRef) -> BitFunResult<ComponentDefinition> {
        let requirement = component_ref.version.as_deref().ok_or_else(|| {
            BitFunError::validation(format!(
                "Shared component {} must declare a semver range",
                component_ref.component_id
            ))
        })?;
        let req = VersionReq::parse(requirement).map_err(|error| {
            BitFunError::validation(format!(
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
                BitFunError::validation(format!(
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
                BitFunError::validation(format!(
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

fn validate_app_identity(app: &AppDefinition) -> BitFunResult<()> {
    validate_required("app.id", &app.id)?;
    validate_required("app.version", &app.version)?;
    validate_required("app.name", &app.name)?;
    validate_required("app.goal", &app.goal)?;
    Ok(())
}

fn validate_primary_surface_ref(app: &AppDefinition) -> BitFunResult<()> {
    validate_required(
        "primarySurface.componentId",
        &app.primary_surface.component_id,
    )?;
    if app.components.iter().any(|component| {
        component.kind == ComponentKind::Surface
            && component.component_id == app.primary_surface.component_id
    }) {
        return Ok(());
    }
    Err(BitFunError::validation(format!(
        "Primary surface component {} must be present in app.components",
        app.primary_surface.component_id
    )))
}

fn validate_component_refs(label: &str, refs: &[AppComponentRef]) -> BitFunResult<()> {
    for component_ref in refs {
        validate_component_ref(label, component_ref)?;
    }
    Ok(())
}

fn validate_component_ref(label: &str, component_ref: &AppComponentRef) -> BitFunResult<()> {
    validate_required(&format!("{label}.componentId"), &component_ref.component_id)?;
    validate_required(&format!("{label}.role"), &component_ref.role)?;
    match component_ref.source {
        ComponentSource::Private if component_ref.version.is_some() => {
            Err(BitFunError::validation(format!(
                "{label}: private component {} must not declare version",
                component_ref.component_id
            )))
        }
        ComponentSource::Shared => {
            let version = component_ref.version.as_deref().unwrap_or_default();
            validate_required(&format!("{label}.version"), version)?;
            VersionReq::parse(version).map_err(|error| {
                BitFunError::validation(format!(
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
) -> BitFunResult<()> {
    validate_required("component.id", &component.id)?;
    if component.package_source != ComponentPackageSource::AppPrivate {
        return Err(BitFunError::validation(format!(
            "Private component {} must use packageSource=appPrivate",
            component.id
        )));
    }
    if component.version.is_some() {
        return Err(BitFunError::validation(format!(
            "App-private component {} must not declare an independent version",
            component.id
        )));
    }
    let owner = component.owner_app.as_ref().ok_or_else(|| {
        BitFunError::validation(format!(
            "App-private component {} must declare ownerApp",
            component.id
        ))
    })?;
    if owner.app_id != app.id || owner.app_version != app.version {
        return Err(BitFunError::validation(format!(
            "App-private component {} ownerApp must match {}@{}",
            component.id, app.id, app.version
        )));
    }
    Ok(())
}

fn validate_shared_component(component: &ComponentDefinition) -> BitFunResult<()> {
    validate_required("component.id", &component.id)?;
    if component.package_source != ComponentPackageSource::Shared {
        return Err(BitFunError::validation(format!(
            "Shared component {} must use packageSource=shared",
            component.id
        )));
    }
    if component.owner_app.is_some() {
        return Err(BitFunError::validation(format!(
            "Shared component {} must not declare ownerApp",
            component.id
        )));
    }
    let version = component.version.as_deref().unwrap_or_default();
    validate_required("component.version", version)?;
    Version::parse(version).map_err(|error| {
        BitFunError::validation(format!(
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
) -> BitFunResult<()> {
    if lock.app_id != app.id || lock.version != app.version {
        return Err(BitFunError::validation(format!(
            "Lock {}@{} does not match app {}@{}",
            lock.app_id, lock.version, app.id, app.version
        )));
    }

    let expected = build_component_lock(app, components);
    if lock.permission_digest != expected.permission_digest {
        return Err(BitFunError::validation(
            "App lock permission digest does not match component definitions",
        ));
    }
    if lock.component_graph_digest != expected.component_graph_digest {
        return Err(BitFunError::validation(
            "App lock component graph digest does not match component definitions",
        ));
    }
    if lock.resolved_components.len() != expected.resolved_components.len() {
        return Err(BitFunError::validation(
            "App lock resolved component count does not match component definitions",
        ));
    }
    for expected_entry in expected.resolved_components {
        let Some(actual_entry) = lock
            .resolved_components
            .iter()
            .find(|entry| entry.fqid == expected_entry.fqid)
        else {
            return Err(BitFunError::validation(format!(
                "App lock is missing resolved component {}",
                expected_entry.fqid
            )));
        };
        if actual_entry.digest != expected_entry.digest {
            return Err(BitFunError::validation(format!(
                "App lock digest mismatch for {}",
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
) -> ProductAppCatalogEntry {
    ProductAppCatalogEntry {
        app,
        component_lock_digest: lock.digest(),
        dependency_summary: dependency_summary(components),
    }
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

async fn read_json<T>(path: &Path) -> BitFunResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    let bytes = fs::read(path).await.map_err(|error| {
        BitFunError::io(format!("Failed to read {}: {}", path.display(), error))
    })?;
    serde_json::from_slice(&bytes).map_err(BitFunError::from)
}

async fn read_work_objects(dir: &Path) -> BitFunResult<Vec<WorkObjectKind>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let mut entries = fs::read_dir(dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        out.push(read_json(&path).await?);
    }
    out.sort_by(|left: &WorkObjectKind, right| left.id.cmp(&right.id));
    Ok(out)
}

async fn read_private_components(
    components_dir: &Path,
    owner_app: ComponentOwnerApp,
) -> BitFunResult<Vec<ComponentDefinition>> {
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

fn validate_required(field: &str, value: &str) -> BitFunResult<()> {
    if value.trim().is_empty() {
        return Err(BitFunError::validation(format!("{field} cannot be empty")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::app_platform::{
        AppCatalogVisibility, AppInstallScope, AppInteractionModel, AppPermissionSummary,
        AppSurfaceMode, AppTruthSource, AppWorkMultiplicity, ComponentVisibility, SurfaceRef,
        WorkObjectScope,
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

        let error = ProductAppResolver::build_runtime_projection(app, private_components, bad_lock)
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
            truth_source: Some(AppTruthSource::RuntimeFact),
            primary_surface: SurfaceRef {
                component_id: "preview".to_string(),
                surface_id: Some("primary".to_string()),
            },
            primary_surface_mode: AppSurfaceMode::SidecarLinked,
            components,
            component_lock_id: String::new(),
            permissions: AppPermissionSummary::default(),
            install_scope: AppInstallScope::System,
            catalog_visibility: AppCatalogVisibility::Discoverable,
            enabled: true,
            icon: "video".to_string(),
            category: "creative".to_string(),
            tags: vec![],
            launch: None,
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
            implementation_ref: None,
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
}
