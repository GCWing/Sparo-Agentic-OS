//! Authoritative execution boundary for immutable Intelligent App Releases.

use std::collections::BTreeMap;

use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use sparo_core::agentic_os::work::{
    CreateWorkRequest, PrimarySurfacePolicy, ResolveAppWorkRequest, StartWorkRequest, WorkAppKind,
    WorkAppRef, WorkAppRelationRole, WorkAssignmentKind, WorkAssignmentRef, WorkRecord, WorkScope,
    WorkSubject, WorkSurfaceRef,
};
use sparo_core::app_platform::{
    list_system_shared_components, register_private_product_app_runtime_components,
    required_app_capabilities, validate_release_evaluation, ActivationRecord, AppActivationScope,
    AppOwnerKind, AppRecord, CapabilityGrantStore, ProductAppLaunch, ProductAppLaunchKind,
    ProductAppLaunchScopeRequirement, ProductAppResolver, ReleaseProvenanceKind, ReleaseRecord,
    ReleaseRuntimeSpec, ResolvedProductApp, ResolvedRelease,
};

use crate::api::app_state::AppState;

#[derive(Debug, Clone)]
pub struct AuthoritativeAppRelease {
    pub resolved_release: ResolvedRelease,
    pub package: ResolvedProductApp,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AuthoritativeReleaseBinding {
    slot_id: String,
    app_id: String,
    release_id: String,
    config_revision: String,
    data_schema_version: String,
    launch: ProductAppLaunch,
    primary_surface: Option<sparo_core::app_platform::SurfaceRef>,
}

impl AuthoritativeAppRelease {
    fn binding(&self) -> Result<AuthoritativeReleaseBinding, String> {
        let launch = self
            .resolved_release
            .release
            .runtime
            .launch
            .clone()
            .ok_or_else(|| {
                format!(
                    "Release {} has no launch binding",
                    self.resolved_release.release.release_id
                )
            })?;
        Ok(AuthoritativeReleaseBinding {
            slot_id: self.resolved_release.release.slot_id.clone(),
            app_id: self.resolved_release.release.app_id.clone(),
            release_id: self.resolved_release.release.release_id.clone(),
            config_revision: self.resolved_release.release.config_revision.clone(),
            data_schema_version: self.resolved_release.release.data_schema_version.clone(),
            launch,
            primary_surface: self
                .resolved_release
                .release
                .runtime
                .primary_surface
                .clone(),
        })
    }

    pub fn validate_application_surface_runtime(
        &self,
        scope: &WorkScope,
        product_app_surface_id: &str,
        surface_id: &str,
    ) -> Result<(), String> {
        let binding = self.binding()?;
        validate_scope_requirement(&binding, scope)?;
        if binding.launch.kind != ProductAppLaunchKind::ApplicationSurface {
            return Err(format!(
                "Release {} is not an application-surface App",
                binding.release_id
            ));
        }
        let declared_surface = binding.primary_surface.as_ref().ok_or_else(|| {
            format!(
                "Release {} has no primary surface binding",
                binding.release_id
            )
        })?;
        let declared_surface_id = declared_surface
            .surface_id
            .as_deref()
            .unwrap_or(declared_surface.component_id.as_str());
        if declared_surface.component_id != product_app_surface_id
            || declared_surface_id != surface_id
        {
            return Err(format!(
                "Runtime surface does not match authoritative Release {}",
                binding.release_id
            ));
        }
        Ok(())
    }

    pub fn validate_existing_work_runtime(&self, work: &WorkRecord) -> Result<(), String> {
        let binding = self.binding()?;
        validate_scope_requirement(&binding, &work.scope)?;
        match binding.launch.kind {
            ProductAppLaunchKind::ApplicationSurface => {
                let surface = std::iter::once(&work.primary_surface)
                    .chain(work.surfaces.iter())
                    .find_map(|surface| match surface {
                        WorkSurfaceRef::ApplicationSurface {
                            product_app_id,
                            product_app_surface_id,
                            surface_id,
                        } if product_app_id == &binding.app_id => {
                            Some((product_app_surface_id, surface_id))
                        }
                        _ => None,
                    })
                    .ok_or_else(|| {
                        format!(
                            "Work {} has no application surface accepted by Release {}",
                            work.id, binding.release_id
                        )
                    })?;
                self.validate_application_surface_runtime(&work.scope, surface.0, surface.1)
            }
            ProductAppLaunchKind::AgentSession | ProductAppLaunchKind::AppBuilder => {
                if std::iter::once(&work.primary_surface)
                    .chain(work.surfaces.iter())
                    .any(|surface| matches!(surface, WorkSurfaceRef::ApplicationSurface { .. }))
                {
                    return Err(format!(
                        "Work {} application surface is not accepted by Release {}",
                        work.id, binding.release_id
                    ));
                }
                let agent_type = binding
                    .launch
                    .agent_type
                    .as_deref()
                    .unwrap_or(binding.launch.target_id.as_str());
                validate_agent_assignment(work.assignment.as_ref(), agent_type, &binding.release_id)
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProductAppWorkCompatibilityStatus {
    Compatible,
    AppUnavailable,
    AppDisabled,
    AppSelectionChanged,
    VersionIncompatible,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppWorkCompatibility {
    pub status: ProductAppWorkCompatibilityStatus,
    pub slot_id: String,
    pub app_id: String,
    pub created_with_release_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_with_version: Option<String>,
    pub work_data_schema_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_app_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_release_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_data_schema_version: Option<String>,
}

impl ProductAppWorkCompatibility {
    pub fn is_compatible(&self) -> bool {
        self.status == ProductAppWorkCompatibilityStatus::Compatible
    }

    fn rejection_message(&self) -> String {
        match self.status {
            ProductAppWorkCompatibilityStatus::Compatible => {
                "Product App Work is compatible".to_string()
            }
            ProductAppWorkCompatibilityStatus::AppUnavailable => format!(
                "PRODUCT_APP_WORK_APP_UNAVAILABLE: App {} is not installed for Work data schema {}",
                self.app_id, self.work_data_schema_version
            ),
            ProductAppWorkCompatibilityStatus::AppDisabled => format!(
                "PRODUCT_APP_WORK_APP_DISABLED: App slot {} is disabled",
                self.slot_id
            ),
            ProductAppWorkCompatibilityStatus::AppSelectionChanged => format!(
                "PRODUCT_APP_WORK_APP_SELECTION_CHANGED: Work expects App {}, but slot {} currently selects {}",
                self.app_id,
                self.slot_id,
                self.installed_app_id.as_deref().unwrap_or("unknown")
            ),
            ProductAppWorkCompatibilityStatus::VersionIncompatible => format!(
                "PRODUCT_APP_WORK_VERSION_INCOMPATIBLE: Work data schema {} from Release {} cannot be opened by installed App {} Release {} data schema {}",
                self.work_data_schema_version,
                self.created_with_release_id,
                self.installed_app_id.as_deref().unwrap_or("unknown"),
                self.installed_release_id.as_deref().unwrap_or("unknown"),
                self.installed_data_schema_version.as_deref().unwrap_or("unknown")
            ),
        }
    }
}

/// Evaluates historical Work data against the single currently installed App.
///
/// The Work's Release is audit metadata only. It is never resolved as an
/// execution target. Compatibility is intentionally strict: the installed
/// Release must belong to the same logical App and declare the exact same data
/// schema version.
pub async fn inspect_product_app_work_compatibility(
    state: &AppState,
    app_ref: &WorkAppRef,
) -> Result<ProductAppWorkCompatibility, String> {
    let created_with_version = state
        .app_revision_store
        .list_releases(Some(&app_ref.app_id))
        .await
        .into_iter()
        .find(|release| release.release_id == app_ref.release_id)
        .map(|release| release.version);
    let mut result = ProductAppWorkCompatibility {
        status: ProductAppWorkCompatibilityStatus::AppUnavailable,
        slot_id: app_ref.slot_id.clone(),
        app_id: app_ref.app_id.clone(),
        created_with_release_id: app_ref.release_id.clone(),
        created_with_version,
        work_data_schema_version: app_ref.data_schema_version.clone(),
        installed_app_id: None,
        installed_release_id: None,
        installed_version: None,
        installed_data_schema_version: None,
    };

    if state
        .app_revision_store
        .get_app(&app_ref.app_id)
        .await
        .is_none()
    {
        return Ok(result);
    }
    let Some(activation) = state
        .app_revision_store
        .get_effective_activation(&AppActivationScope::System, &app_ref.slot_id)
        .await
    else {
        return Ok(result);
    };
    result.installed_app_id = Some(activation.selected_app_id.clone());
    result.installed_release_id = Some(activation.active_release_id.clone());
    if !activation.enabled {
        result.status = ProductAppWorkCompatibilityStatus::AppDisabled;
        return Ok(result);
    }
    if activation.selected_app_id != app_ref.app_id {
        result.status = ProductAppWorkCompatibilityStatus::AppSelectionChanged;
        return Ok(result);
    }

    let installed = state
        .app_revision_store
        .resolve_release(&activation.selected_app_id, &activation.active_release_id)
        .await
        .map_err(|error| error.to_string())?;
    result.installed_version = Some(installed.release.version.clone());
    result.installed_data_schema_version = Some(installed.release.data_schema_version.clone());
    result.status = if installed.release.data_schema_version == app_ref.data_schema_version {
        ProductAppWorkCompatibilityStatus::Compatible
    } else {
        ProductAppWorkCompatibilityStatus::VersionIncompatible
    };
    Ok(result)
}

/// Resolves an existing Work exclusively through the current system Activation.
/// Historical Release coordinates carried by the Work are never executable.
pub async fn resolve_current_app_release_for_work(
    state: &AppState,
    app_ref: &WorkAppRef,
) -> Result<(AuthoritativeAppRelease, WorkAppRef), String> {
    let compatibility = inspect_product_app_work_compatibility(state, app_ref).await?;
    if !compatibility.is_compatible() {
        return Err(compatibility.rejection_message());
    }
    let app_id = compatibility
        .installed_app_id
        .as_deref()
        .ok_or_else(|| compatibility.rejection_message())?;
    let release_id = compatibility
        .installed_release_id
        .as_deref()
        .ok_or_else(|| compatibility.rejection_message())?;
    let authoritative = resolve_authorized_app_release(state, app_id, release_id).await?;
    let binding = authoritative.binding()?;
    let current_ref = WorkAppRef::product_app(
        binding.slot_id,
        binding.app_id,
        binding.release_id,
        binding.config_revision,
        binding.data_schema_version,
    );
    Ok((authoritative, current_ref))
}

/// Resolves and authorizes exactly one current immutable Release.
pub async fn resolve_authorized_app_release(
    state: &AppState,
    app_id: &str,
    release_id: &str,
) -> Result<AuthoritativeAppRelease, String> {
    let app_record = state.app_revision_store.get_app(app_id).await;
    if app_record.is_none() {
        return Err(format!(
            "Intelligent App {app_id} is archived and cannot create new Work"
        ));
    }
    let resolved_release = state
        .app_revision_store
        .resolve_release(app_id, release_id)
        .await
        .map_err(|error| error.to_string())?;
    let shared_components = list_system_shared_components(state.workspace_service.path_manager())
        .await
        .map_err(|error| error.to_string())?;
    let package = ProductAppResolver::resolve_package_runtime(
        &resolved_release.artifact_path,
        &shared_components,
    )
    .await
    .map_err(|error| error.to_string())?;

    validate_release_contract(
        app_record.as_ref(),
        &resolved_release.release,
        &package,
        env!("CARGO_PKG_VERSION"),
    )?;
    state
        .app_revision_store
        .verify_release_artifact(release_id)
        .await
        .map_err(|error| error.to_string())?;
    if resolved_release.release.provenance != ReleaseProvenanceKind::System {
        validate_release_evaluation(
            &resolved_release.artifact_path,
            &resolved_release.release.evaluation_report_digest,
        )
        .await
        .map_err(|error| error.to_string())?;
    }

    let required_capabilities = required_app_capabilities(&package.app, &package.components);
    let trusted_system_release = app_record
        .as_ref()
        .is_some_and(|record| record.owner.kind == AppOwnerKind::System)
        && resolved_release.release.provenance == ReleaseProvenanceKind::System;
    if !required_capabilities.is_empty() && !trusted_system_release {
        let approved = CapabilityGrantStore::new(state.workspace_service.path_manager())
            .is_approved_for_capabilities(
                app_id,
                &resolved_release.release.capability_fingerprint,
                required_capabilities.clone(),
            )
            .await
            .map_err(|error| error.to_string())?;
        if !approved {
            return Err(format!(
                "Release {} requires capability approval before execution: {}",
                resolved_release.release.release_id,
                required_capabilities.join(", ")
            ));
        }
    }

    Ok(AuthoritativeAppRelease {
        resolved_release,
        package,
    })
}

pub fn validate_product_app_ref(
    app_ref: &WorkAppRef,
    release: &AuthoritativeAppRelease,
) -> Result<(), String> {
    validate_ref_against_binding(app_ref, &release.binding()?)
}

pub async fn authorize_create_work_request(
    state: &AppState,
    request: &mut CreateWorkRequest,
) -> Result<(), String> {
    let subject_ref = match &request.subject {
        WorkSubject::App { app, .. } if app.kind == WorkAppKind::ProductApp => Some(app.clone()),
        _ => None,
    };
    let executor_refs = request
        .app_refs
        .iter()
        .filter(|relation| {
            relation.role == WorkAppRelationRole::Executor
                && relation.app.kind == WorkAppKind::ProductApp
        })
        .map(|relation| relation.app.clone())
        .collect::<Vec<_>>();
    let primary_ref = authoritative_primary_ref(subject_ref.as_ref(), &executor_refs)?;

    let mut all_refs = request
        .app_refs
        .iter()
        .filter(|relation| relation.app.kind == WorkAppKind::ProductApp)
        .map(|relation| relation.app.clone())
        .collect::<Vec<_>>();
    if let Some(app_ref) = subject_ref {
        all_refs.push(app_ref);
    }
    let releases = authorize_refs(state, &all_refs, &request.scope).await?;
    if let Some(primary_ref) = primary_ref {
        let release = release_for_ref(&releases, &primary_ref)?;
        normalize_authoritative_launch(
            &release.binding()?,
            &request.scope,
            &mut request.primary_surface_policy,
            &mut request.primary_surface,
            &mut request.assignment,
        )?;
        register_authoritative_agent_release(state, release).await?;
    }
    Ok(())
}

pub async fn authorize_resolve_app_work_request(
    state: &AppState,
    request: &mut ResolveAppWorkRequest,
) -> Result<(), String> {
    let subject_ref = (request.app.kind == WorkAppKind::ProductApp).then(|| request.app.clone());
    let executor_refs = request
        .app_refs
        .iter()
        .filter(|relation| {
            relation.role == WorkAppRelationRole::Executor
                && relation.app.kind == WorkAppKind::ProductApp
        })
        .map(|relation| relation.app.clone())
        .collect::<Vec<_>>();
    let primary_ref = authoritative_primary_ref(subject_ref.as_ref(), &executor_refs)?;
    let mut all_refs = request
        .app_refs
        .iter()
        .filter(|relation| relation.app.kind == WorkAppKind::ProductApp)
        .map(|relation| relation.app.clone())
        .collect::<Vec<_>>();
    if let Some(app_ref) = subject_ref {
        all_refs.push(app_ref);
    }
    let releases = authorize_refs(state, &all_refs, &request.scope).await?;
    if let Some(primary_ref) = primary_ref {
        let release = release_for_ref(&releases, &primary_ref)?;
        normalize_authoritative_launch(
            &release.binding()?,
            &request.scope,
            &mut request.primary_surface_policy,
            &mut request.primary_surface,
            &mut request.assignment,
        )?;
        register_authoritative_agent_release(state, release).await?;
    }
    Ok(())
}

pub async fn authorize_start_work_request(
    state: &AppState,
    request: &mut StartWorkRequest,
) -> Result<(), String> {
    let subject_ref = match &request.subject {
        WorkSubject::App { app, .. } if app.kind == WorkAppKind::ProductApp => Some(app.clone()),
        _ => None,
    };
    let executor_refs = request
        .app_refs
        .iter()
        .filter(|relation| {
            relation.role == WorkAppRelationRole::Executor
                && relation.app.kind == WorkAppKind::ProductApp
        })
        .map(|relation| relation.app.clone())
        .collect::<Vec<_>>();
    let primary_ref = authoritative_primary_ref(subject_ref.as_ref(), &executor_refs)?;
    let mut all_refs = request
        .app_refs
        .iter()
        .filter(|relation| relation.app.kind == WorkAppKind::ProductApp)
        .map(|relation| relation.app.clone())
        .collect::<Vec<_>>();
    if let Some(app_ref) = subject_ref {
        all_refs.push(app_ref);
    }
    let releases = authorize_refs(state, &all_refs, &request.scope).await?;
    if let Some(primary_ref) = primary_ref {
        let release = release_for_ref(&releases, &primary_ref)?;
        let mut primary_surface = None;
        normalize_authoritative_launch(
            &release.binding()?,
            &request.scope,
            &mut request.primary_surface_policy,
            &mut primary_surface,
            &mut request.assignment,
        )?;
        if primary_surface.is_some() {
            return Err(
                "Application-surface Releases must be started through resolveAppWork".to_string(),
            );
        }
        register_authoritative_agent_release(state, release).await?;
    }
    Ok(())
}

async fn authorize_refs(
    state: &AppState,
    refs: &[WorkAppRef],
    scope: &WorkScope,
) -> Result<BTreeMap<(String, String), AuthoritativeAppRelease>, String> {
    let mut releases = BTreeMap::new();
    for app_ref in refs {
        let key = (app_ref.app_id.clone(), app_ref.release_id.clone());
        if let Some(release) = releases.get(&key) {
            validate_product_app_ref(app_ref, release)?;
            validate_scope_requirement(&release.binding()?, scope)?;
            validate_effective_activation(state, scope, app_ref).await?;
            continue;
        }
        let release =
            resolve_authorized_app_release(state, &app_ref.app_id, &app_ref.release_id).await?;
        validate_product_app_ref(app_ref, &release)?;
        validate_scope_requirement(&release.binding()?, scope)?;
        validate_effective_activation(state, scope, app_ref).await?;
        releases.insert(key, release);
    }
    Ok(releases)
}

async fn validate_effective_activation(
    state: &AppState,
    _scope: &WorkScope,
    app_ref: &WorkAppRef,
) -> Result<(), String> {
    let activation = state
        .app_revision_store
        .get_effective_activation(&AppActivationScope::System, &app_ref.slot_id)
        .await
        .ok_or_else(|| {
            format!(
                "No effective Activation exists for Product App slot {}",
                app_ref.slot_id
            )
        })?;
    validate_activation_matches_ref(&activation, app_ref)
}

fn validate_activation_matches_ref(
    activation: &ActivationRecord,
    app_ref: &WorkAppRef,
) -> Result<(), String> {
    if activation.slot_id != app_ref.slot_id {
        return Err(format!(
            "Activation slot mismatch: requested={}, activation={}",
            app_ref.slot_id, activation.slot_id
        ));
    }
    if !activation.enabled {
        return Err(format!(
            "Product App slot {} is disabled and cannot create new Work",
            app_ref.slot_id
        ));
    }
    if activation.selected_app_id != app_ref.app_id
        || activation.active_release_id != app_ref.release_id
    {
        return Err(format!(
            "New Work must use the effective Activation for slot {}: {}@{}",
            app_ref.slot_id, activation.selected_app_id, activation.active_release_id
        ));
    }
    Ok(())
}

fn release_for_ref<'a>(
    releases: &'a BTreeMap<(String, String), AuthoritativeAppRelease>,
    app_ref: &WorkAppRef,
) -> Result<&'a AuthoritativeAppRelease, String> {
    releases
        .get(&(app_ref.app_id.clone(), app_ref.release_id.clone()))
        .ok_or_else(|| {
            format!(
                "Authoritative Release was not resolved for {}@{}",
                app_ref.app_id, app_ref.release_id
            )
        })
}

fn authoritative_primary_ref(
    subject_ref: Option<&WorkAppRef>,
    executor_refs: &[WorkAppRef],
) -> Result<Option<WorkAppRef>, String> {
    let mut candidates = executor_refs.to_vec();
    if let Some(subject_ref) = subject_ref {
        candidates.push(subject_ref.clone());
    }
    candidates.sort_by(|left, right| {
        (&left.app_id, &left.release_id).cmp(&(&right.app_id, &right.release_id))
    });
    candidates
        .dedup_by(|left, right| left.app_id == right.app_id && left.release_id == right.release_id);
    if candidates.len() > 1 {
        return Err(
            "A Work may not declare multiple authoritative Product App executors".to_string(),
        );
    }
    Ok(candidates.into_iter().next())
}

pub(crate) async fn register_authoritative_agent_release(
    state: &AppState,
    release: &AuthoritativeAppRelease,
) -> Result<(), String> {
    let launch = release
        .resolved_release
        .release
        .runtime
        .launch
        .as_ref()
        .ok_or_else(|| {
            format!(
                "Release {} has no launch binding",
                release.resolved_release.release.release_id
            )
        })?;
    if matches!(
        launch.kind,
        ProductAppLaunchKind::AgentSession | ProductAppLaunchKind::AppBuilder
    ) {
        register_private_product_app_runtime_components(&release.package)
            .await
            .map_err(|error| error.to_string())?;
        state
            .app_revision_store
            .verify_release_artifact(&release.resolved_release.release.release_id)
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn validate_release_contract(
    app_record: Option<&AppRecord>,
    release: &ReleaseRecord,
    package: &ResolvedProductApp,
    runtime_version: &str,
) -> Result<(), String> {
    if app_record.is_some_and(|record| release.app_id != record.app_id)
        || package.app.id != release.app_id
    {
        return Err(format!(
            "Release {} App identity does not match its immutable artifact",
            release.release_id
        ));
    }
    if app_record.is_some_and(|record| release.slot_id != record.slot_id) {
        return Err(format!(
            "Release {} slot does not match its App identity",
            release.release_id
        ));
    }
    if package.app.version != release.version {
        return Err(format!(
            "Release {} version mismatch: registry={}, artifact={}",
            release.release_id, release.version, package.app.version
        ));
    }
    let lock_digest = package.lock.digest();
    if lock_digest != release.component_lock_digest
        || package.app.component_lock_id != release.component_lock_digest
    {
        return Err(format!(
            "Release {} component lock does not match its immutable artifact",
            release.release_id
        ));
    }
    if package.lock.permission_digest != release.capability_fingerprint {
        return Err(format!(
            "Release {} capability fingerprint does not match its immutable artifact",
            release.release_id
        ));
    }
    if ReleaseRuntimeSpec::from_app(&package.app) != release.runtime {
        return Err(format!(
            "Release {} runtime binding does not match its immutable artifact",
            release.release_id
        ));
    }
    let requirement = VersionReq::parse(&release.runtime_compatibility).map_err(|error| {
        format!(
            "Release {} has invalid runtime compatibility {}: {}",
            release.release_id, release.runtime_compatibility, error
        )
    })?;
    let runtime_version = Version::parse(runtime_version)
        .map_err(|error| format!("Invalid desktop runtime version {runtime_version}: {error}"))?;
    if !requirement.matches(&runtime_version) {
        return Err(format!(
            "Release {} requires runtime {}, current runtime is {}",
            release.release_id, requirement, runtime_version
        ));
    }
    if release.runtime.launch.is_none() {
        return Err(format!(
            "Release {} has no authoritative launch binding",
            release.release_id
        ));
    }
    Ok(())
}

fn validate_ref_against_binding(
    app_ref: &WorkAppRef,
    binding: &AuthoritativeReleaseBinding,
) -> Result<(), String> {
    if app_ref.kind != WorkAppKind::ProductApp {
        return Err("Authoritative Release validation requires a Product App binding".to_string());
    }
    if binding.slot_id != app_ref.slot_id {
        return Err(format!(
            "Product App Work slotId mismatch: requested={}, release={}",
            app_ref.slot_id, binding.slot_id
        ));
    }
    for (field, actual, expected) in [
        ("appId", &app_ref.app_id, &binding.app_id),
        ("releaseId", &app_ref.release_id, &binding.release_id),
        (
            "configRevision",
            &app_ref.config_revision,
            &binding.config_revision,
        ),
        (
            "dataSchemaVersion",
            &app_ref.data_schema_version,
            &binding.data_schema_version,
        ),
    ] {
        if actual != expected {
            return Err(format!(
                "Product App Work {field} mismatch: requested={actual}, release={expected}"
            ));
        }
    }
    Ok(())
}

fn validate_scope_requirement(
    binding: &AuthoritativeReleaseBinding,
    scope: &WorkScope,
) -> Result<(), String> {
    if binding.launch.scope_requirement == ProductAppLaunchScopeRequirement::WorkspaceRequired
        && matches!(scope, WorkScope::Global)
    {
        return Err(format!(
            "Release {} requires a workspace-scoped Work",
            binding.release_id
        ));
    }
    if let WorkScope::Workspace { workspace_id } = scope {
        if workspace_id.trim().is_empty() {
            return Err("Workspace-scoped Work requires a non-empty workspace id".to_string());
        }
    }
    Ok(())
}

fn normalize_authoritative_launch(
    binding: &AuthoritativeReleaseBinding,
    scope: &WorkScope,
    primary_surface_policy: &mut PrimarySurfacePolicy,
    primary_surface: &mut Option<WorkSurfaceRef>,
    assignment: &mut Option<WorkAssignmentRef>,
) -> Result<(), String> {
    validate_scope_requirement(binding, scope)?;
    match binding.launch.kind {
        ProductAppLaunchKind::AgentSession | ProductAppLaunchKind::AppBuilder => {
            if *primary_surface_policy != PrimarySurfacePolicy::WorkSession {
                return Err(format!(
                    "Release {} requires work_session primary surface policy",
                    binding.release_id
                ));
            }
            if primary_surface.as_ref().is_some_and(|surface| {
                !matches!(
                    surface,
                    WorkSurfaceRef::WorkSession { .. } | WorkSurfaceRef::AgentSession { .. }
                )
            }) {
                return Err(format!(
                    "Release {} cannot bind an application surface",
                    binding.release_id
                ));
            }
            let agent_type = binding
                .launch
                .agent_type
                .as_deref()
                .unwrap_or(binding.launch.target_id.as_str());
            validate_agent_assignment(assignment.as_ref(), agent_type, &binding.release_id)?;
            *assignment = Some(WorkAssignmentRef::agent(agent_type));
        }
        ProductAppLaunchKind::ApplicationSurface => {
            if *primary_surface_policy != PrimarySurfacePolicy::ApplicationSurface {
                return Err(format!(
                    "Release {} requires application_surface primary surface policy",
                    binding.release_id
                ));
            }
            let surface = binding.primary_surface.as_ref().ok_or_else(|| {
                format!(
                    "Release {} has no primary surface binding",
                    binding.release_id
                )
            })?;
            let expected = WorkSurfaceRef::ApplicationSurface {
                product_app_id: binding.app_id.clone(),
                product_app_surface_id: surface.component_id.clone(),
                surface_id: surface
                    .surface_id
                    .clone()
                    .unwrap_or_else(|| surface.component_id.clone()),
            };
            if primary_surface
                .as_ref()
                .is_some_and(|surface| surface != &expected)
            {
                return Err(format!(
                    "Release {} application surface does not match the Work request",
                    binding.release_id
                ));
            }
            validate_application_assignment(
                assignment.as_ref(),
                &binding.app_id,
                &binding.release_id,
            )?;
            *primary_surface = Some(expected);
            *assignment = Some(WorkAssignmentRef {
                kind: WorkAssignmentKind::Application,
                agent_type: None,
                assistant_id: None,
                application_id: Some(binding.app_id.clone()),
                human_label: None,
                external_label: None,
            });
        }
    }
    Ok(())
}

fn validate_agent_assignment(
    assignment: Option<&WorkAssignmentRef>,
    expected_agent_type: &str,
    release_id: &str,
) -> Result<(), String> {
    let Some(assignment) = assignment else {
        return Ok(());
    };
    if assignment.kind != WorkAssignmentKind::Agent
        || assignment.agent_type.as_deref() != Some(expected_agent_type)
    {
        return Err(format!(
            "Release {release_id} requires authoritative agentType {expected_agent_type}"
        ));
    }
    Ok(())
}

fn validate_application_assignment(
    assignment: Option<&WorkAssignmentRef>,
    app_id: &str,
    release_id: &str,
) -> Result<(), String> {
    let Some(assignment) = assignment else {
        return Ok(());
    };
    if assignment.kind != WorkAssignmentKind::Application
        || assignment.application_id.as_deref() != Some(app_id)
    {
        return Err(format!(
            "Release {release_id} requires authoritative application assignment {app_id}"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sparo_core::app_platform::SurfaceRef;

    fn agent_binding() -> AuthoritativeReleaseBinding {
        AuthoritativeReleaseBinding {
            slot_id: "writer".to_string(),
            app_id: "user.writer".to_string(),
            release_id: "release-1".to_string(),
            config_revision: "sha256:config".to_string(),
            data_schema_version: "1.0.0".to_string(),
            launch: ProductAppLaunch {
                kind: ProductAppLaunchKind::AgentSession,
                target_id: "private-writer".to_string(),
                scope_requirement: ProductAppLaunchScopeRequirement::WorkspaceOptional,
                agent_type: Some("private-writer".to_string()),
                surface_id: None,
            },
            primary_surface: None,
        }
    }

    #[test]
    fn immutable_ref_rejects_config_and_schema_spoofing() {
        let mut app_ref = WorkAppRef::product_app(
            "writer",
            "user.writer",
            "release-1",
            "sha256:wrong",
            "1.0.0",
        );
        assert!(validate_ref_against_binding(&app_ref, &agent_binding()).is_err());
        app_ref.config_revision = "sha256:config".to_string();
        app_ref.data_schema_version = "2.0.0".to_string();
        assert!(validate_ref_against_binding(&app_ref, &agent_binding()).is_err());
    }

    #[test]
    fn agent_launch_rejects_forged_assignment_and_derives_missing_assignment() {
        let binding = agent_binding();
        let mut policy = PrimarySurfacePolicy::WorkSession;
        let mut surface = None;
        let mut forged = Some(WorkAssignmentRef::agent("OSAgent"));
        assert!(normalize_authoritative_launch(
            &binding,
            &WorkScope::Global,
            &mut policy,
            &mut surface,
            &mut forged,
        )
        .is_err());

        let mut assignment = None;
        normalize_authoritative_launch(
            &binding,
            &WorkScope::Global,
            &mut policy,
            &mut surface,
            &mut assignment,
        )
        .expect("derive assignment");
        assert_eq!(
            assignment.and_then(|assignment| assignment.agent_type),
            Some("private-writer".to_string())
        );
    }

    #[test]
    fn application_launch_derives_exact_release_surface() {
        let mut binding = agent_binding();
        binding.launch.kind = ProductAppLaunchKind::ApplicationSurface;
        binding.launch.target_id = binding.app_id.clone();
        binding.launch.agent_type = None;
        binding.primary_surface = Some(SurfaceRef {
            component_id: "writer-surface".to_string(),
            surface_id: Some("primary".to_string()),
        });
        let mut policy = PrimarySurfacePolicy::ApplicationSurface;
        let mut surface = None;
        let mut assignment = None;
        normalize_authoritative_launch(
            &binding,
            &WorkScope::Global,
            &mut policy,
            &mut surface,
            &mut assignment,
        )
        .expect("derive application binding");
        assert_eq!(
            surface,
            Some(WorkSurfaceRef::ApplicationSurface {
                product_app_id: "user.writer".to_string(),
                product_app_surface_id: "writer-surface".to_string(),
                surface_id: "primary".to_string(),
            })
        );
    }

    #[test]
    fn new_work_requires_enabled_exact_activation() {
        let app_ref = WorkAppRef::product_app(
            "writer",
            "user.writer",
            "release-1",
            "sha256:config",
            "1.0.0",
        );
        let mut activation = ActivationRecord {
            scope: AppActivationScope::System,
            slot_id: "writer".to_string(),
            selected_app_id: "user.writer".to_string(),
            active_release_id: "release-1".to_string(),
            enabled: false,
        };
        assert!(validate_activation_matches_ref(&activation, &app_ref).is_err());
        activation.enabled = true;
        activation.active_release_id = "release-2".to_string();
        assert!(validate_activation_matches_ref(&activation, &app_ref).is_err());
        activation.active_release_id = "release-1".to_string();
        assert!(validate_activation_matches_ref(&activation, &app_ref).is_ok());
    }
}
