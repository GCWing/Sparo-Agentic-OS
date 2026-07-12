//! Product App package operations that are only valid for mutable Drafts.

use std::path::Path;

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::fs;

use crate::error::{CoreError, CoreResult};

use super::catalog::{
    stable_digest, AppDefinition, ComponentDefinition, ComponentKind, ComponentOwnerApp,
    ComponentSource, ProductAppLaunchKind,
};
use super::resolver::{ProductAppResolver, ResolvedProductApp};
use super::state_io::atomic_write_json;

#[derive(Debug, Clone)]
pub(super) struct PreparedDraftRelease {
    pub app: AppDefinition,
    pub component_lock_digest: String,
    pub config_revision: String,
    pub capability_fingerprint: String,
    pub data_schema_version: String,
    pub runtime_compatibility: String,
    pub evaluation_report_digest: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DraftCompatibility {
    runtime_compatibility: String,
}

#[derive(Debug, Clone, Deserialize)]
struct DraftDataSchema {
    version: String,
}

pub async fn rebind_draft_package_identity(package_dir: &Path, new_app_id: &str) -> CoreResult<()> {
    validate_app_id(new_app_id)?;
    let package = ProductAppResolver::read_product_app_package(package_dir).await?;
    let old_app_id = package.app.id;
    if old_app_id == new_app_id {
        return Ok(());
    }

    let mut app: AppDefinition = read_json(&package_dir.join("app.json")).await?;
    app.id = new_app_id.to_string();
    app.component_lock_id.clear();
    if let Some(launch) = app.launch.as_mut() {
        if launch.kind == ProductAppLaunchKind::ApplicationSurface && launch.target_id == old_app_id
        {
            launch.target_id = new_app_id.to_string();
        }
    }
    atomic_write_json(&package_dir.join("app.json"), &app).await?;
    rewrite_component_owners(package_dir, &old_app_id, new_app_id, &app.version).await?;

    let lock_path = package_dir.join("app.lock.json");
    if lock_path.exists() {
        fs::remove_file(lock_path).await?;
    }
    Ok(())
}

pub(super) async fn prepare_draft_release(
    package_dir: &Path,
    version: &str,
    shared_components: &[ComponentDefinition],
) -> CoreResult<PreparedDraftRelease> {
    semver::Version::parse(version).map_err(|error| {
        CoreError::validation(format!(
            "Invalid Intelligent App release version {version}: {error}"
        ))
    })?;
    let mut app: AppDefinition = read_json(&package_dir.join("app.json")).await?;
    validate_app_id(&app.id)?;
    app.version = version.to_string();
    app.component_lock_id.clear();
    atomic_write_json(&package_dir.join("app.json"), &app).await?;
    rewrite_component_owners(package_dir, &app.id, &app.id, version).await?;

    let package = ProductAppResolver::read_product_app_package(package_dir).await?;
    let resolved =
        ProductAppResolver::resolve_package_install(package, shared_components.to_vec())?;
    ProductAppResolver::write_lock(package_dir, &resolved.lock).await?;
    atomic_write_json(&package_dir.join("app.json"), &resolved.app).await?;

    let config: Value = read_json(&package_dir.join("config").join("default.json")).await?;
    let config_revision = stable_digest(&config);
    let data_schema_version =
        read_json::<DraftDataSchema>(&package_dir.join("config").join("data-schema.json"))
            .await?
            .version;
    semver::Version::parse(&data_schema_version).map_err(|error| {
        CoreError::validation(format!(
            "Invalid Intelligent App data schema version {data_schema_version}: {error}"
        ))
    })?;
    let runtime_compatibility =
        read_json::<DraftCompatibility>(&package_dir.join("compatibility.json"))
            .await?
            .runtime_compatibility;
    semver::VersionReq::parse(&runtime_compatibility).map_err(|error| {
        CoreError::validation(format!(
            "Invalid Intelligent App runtime compatibility {runtime_compatibility}: {error}"
        ))
    })?;
    let capability_fingerprint = resolved.lock.permission_digest.clone();
    let evaluation_report = build_release_evaluation_report(&resolved)?;
    atomic_write_json(
        &package_dir.join("tests").join("release-evaluation.json"),
        &evaluation_report,
    )
    .await?;
    let evaluation_report_digest = stable_digest(&evaluation_report);

    Ok(PreparedDraftRelease {
        app: resolved.app,
        component_lock_digest: resolved.lock.digest(),
        config_revision,
        capability_fingerprint,
        data_schema_version,
        runtime_compatibility,
        evaluation_report_digest,
    })
}

/// Materializes the explicit lifecycle contract when an immutable upstream Release is forked into
/// a new mutable Draft. Values come from the source Release; publish never invents them.
pub async fn materialize_fork_draft_contract(
    package_dir: &Path,
    data_schema_version: &str,
    runtime_compatibility: &str,
) -> CoreResult<()> {
    semver::Version::parse(data_schema_version).map_err(|error| {
        CoreError::validation(format!(
            "Invalid fork data schema version {data_schema_version}: {error}"
        ))
    })?;
    semver::VersionReq::parse(runtime_compatibility).map_err(|error| {
        CoreError::validation(format!(
            "Invalid fork runtime compatibility {runtime_compatibility}: {error}"
        ))
    })?;
    let config_path = package_dir.join("config").join("default.json");
    if !config_path.is_file() {
        atomic_write_json(&config_path, &json!({})).await?;
    }
    atomic_write_json(
        &package_dir.join("config").join("data-schema.json"),
        &json!({ "version": data_schema_version }),
    )
    .await?;
    atomic_write_json(
        &package_dir.join("compatibility.json"),
        &json!({ "runtimeCompatibility": runtime_compatibility }),
    )
    .await
}

/// Verifies that a user-owned immutable artifact carries the deterministic release gate produced
/// by `prepare_draft_release`. System Releases use the signed system seed pipeline instead.
pub async fn validate_release_evaluation(
    artifact_path: &Path,
    expected_digest: &str,
) -> CoreResult<()> {
    let report_path = artifact_path.join("tests").join("release-evaluation.json");
    let report: Value = read_json(&report_path).await?;
    if report.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || report.get("status").and_then(Value::as_str) != Some("passed")
    {
        return Err(CoreError::validation(format!(
            "Release evaluation is not a passing schema-v1 report: {}",
            report_path.display()
        )));
    }
    let actual_digest = stable_digest(&report);
    if actual_digest != expected_digest {
        return Err(CoreError::validation(format!(
            "Release evaluation digest mismatch: expected={expected_digest}, actual={actual_digest}"
        )));
    }
    Ok(())
}

fn build_release_evaluation_report(resolved: &ResolvedProductApp) -> CoreResult<Value> {
    if resolved.app.work_object_kinds.is_empty() {
        return Err(CoreError::validation(
            "Release validation requires at least one declared Work object kind",
        ));
    }
    if resolved.app.data_lifecycle.is_none() {
        return Err(CoreError::validation(
            "Release validation requires an explicit dataLifecycle policy",
        ));
    }
    let rehearsal = resolved
        .catalog_entry
        .rehearsal_plan
        .as_ref()
        .ok_or_else(|| {
            CoreError::validation(
                "Release validation requires tests/rehearsal.json with executable user paths",
            )
        })?;
    if rehearsal.scenarios.is_empty()
        || rehearsal
            .scenarios
            .iter()
            .any(|scenario| scenario.steps.is_empty() || scenario.expected.is_empty())
    {
        return Err(CoreError::validation(
            "Every release rehearsal scenario must declare steps and expected outcomes",
        ));
    }

    let requires_agent_eval = resolved.app.permissions.ai
        || resolved
            .components
            .iter()
            .any(|component| component.kind == ComponentKind::Agent);
    let eval_case_count = if requires_agent_eval {
        let eval = resolved.catalog_entry.eval_plan.as_ref().ok_or_else(|| {
            CoreError::validation(
                "AI-enabled Releases require tests/eval.json with required evaluation cases",
            )
        })?;
        if eval.cases.is_empty()
            || eval
                .cases
                .iter()
                .filter(|case| case.required)
                .any(|case| case.expectations.is_empty())
        {
            return Err(CoreError::validation(
                "AI-enabled Releases require non-empty evaluation cases and expectations",
            ));
        }
        eval.cases.len()
    } else {
        0
    };

    if resolved
        .app
        .launch
        .as_ref()
        .is_some_and(|launch| launch.kind == ProductAppLaunchKind::ApplicationSurface)
    {
        let primary_surface = resolved.app.primary_surface.as_ref().ok_or_else(|| {
            CoreError::validation("Application-surface Release has no primarySurface")
        })?;
        let private_primary_surface = resolved.app.components.iter().any(|component| {
            component.component_id == primary_surface.component_id
                && component.source == ComponentSource::Private
        });
        if private_primary_surface
            && !resolved
                .private_surface_sources
                .contains_key(&primary_surface.component_id)
        {
            return Err(CoreError::validation(format!(
                "Primary Surface {} has no immutable runtime source",
                primary_surface.component_id
            )));
        }
    }

    Ok(json!({
        "schemaVersion": 1,
        "status": "passed",
        "appId": resolved.app.id.clone(),
        "version": resolved.app.version.clone(),
        "componentLockDigest": resolved.lock.digest(),
        "checks": [
            { "id": "packageGraph", "status": "passed" },
            { "id": "componentLock", "status": "passed" },
            { "id": "dataLifecycle", "status": "passed" },
            {
                "id": "userPathContract",
                "status": "passed",
                "scenarioCount": rehearsal.scenarios.len()
            },
            {
                "id": "agentEvalContract",
                "status": if requires_agent_eval { "passed" } else { "notRequired" },
                "caseCount": eval_case_count
            }
        ]
    }))
}

async fn rewrite_component_owners(
    package_dir: &Path,
    old_app_id: &str,
    new_app_id: &str,
    version: &str,
) -> CoreResult<()> {
    let components_root = package_dir.join("components");
    if !components_root.is_dir() {
        return Ok(());
    }
    let mut pending = vec![components_root];
    while let Some(directory) = pending.pop() {
        let mut entries = fs::read_dir(&directory).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let file_type = entry.file_type().await?;
            if file_type.is_dir() {
                pending.push(path);
                continue;
            }
            if !file_type.is_file() || entry.file_name() != "component.json" {
                continue;
            }
            let mut component: ComponentDefinition = read_json(&path).await?;
            if component.owner_app.is_some() {
                component.owner_app = Some(ComponentOwnerApp {
                    app_id: new_app_id.to_string(),
                    app_version: version.to_string(),
                });
            }
            for used_by_app in &mut component.used_by_apps {
                if used_by_app == old_app_id {
                    *used_by_app = new_app_id.to_string();
                }
            }
            if let Some(implementation_ref) = component.implementation_ref.as_mut() {
                let old_prefix = format!("app://{old_app_id}@");
                if implementation_ref.starts_with(&old_prefix) {
                    let suffix = implementation_ref[old_prefix.len()..]
                        .find('/')
                        .map(|index| implementation_ref[old_prefix.len() + index..].to_string())
                        .unwrap_or_default();
                    *implementation_ref = format!("app://{new_app_id}@{version}{suffix}");
                }
            }
            atomic_write_json(&path, &component).await?;
        }
    }
    Ok(())
}

async fn read_json<T>(path: &Path) -> CoreResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    let bytes = fs::read(path).await.map_err(|error| {
        CoreError::validation(format!("Failed to read {}: {error}", path.display()))
    })?;
    serde_json::from_slice(&bytes).map_err(|error| {
        CoreError::validation(format!("Failed to parse JSON {}: {error}", path.display()))
    })
}

fn validate_app_id(app_id: &str) -> CoreResult<()> {
    if app_id.is_empty()
        || app_id.len() > 256
        || !app_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
    {
        return Err(CoreError::validation(
            "App id must use 1-256 ASCII letters, digits, dots, underscores, or hyphens",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::authoring::{create_product_app_package, CreateProductAppPackageDraft};
    use super::super::catalog::{AppI18n, AppSurfaceMode, AppTruthSource};
    use super::*;
    use crate::infrastructure::PathManager;

    fn draft(name: &str) -> CreateProductAppPackageDraft {
        CreateProductAppPackageDraft {
            app_id: name.to_string(),
            name: name.to_string(),
            description: "test".to_string(),
            authors: Vec::new(),
            i18n: AppI18n::default(),
            version: "1.0.0".to_string(),
            agent_type: "Runno".to_string(),
            category: "test".to_string(),
            tags: Vec::new(),
            primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
            work_multiplicity: None,
            truth_source: None::<AppTruthSource>,
        }
    }

    #[tokio::test]
    async fn rebinds_a_fork_and_regenerates_release_identity() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = PathManager::with_user_root_for_tests(temp.path().to_path_buf());
        let written = create_product_app_package(&paths, draft("source-app"))
            .await
            .expect("create package");

        rebind_draft_package_identity(&written.package_dir, "forked-app")
            .await
            .expect("rebind");
        let prepared = prepare_draft_release(&written.package_dir, "2.0.0", &[])
            .await
            .expect("prepare release");

        assert_eq!(prepared.app.id, "forked-app");
        assert_eq!(prepared.app.version, "2.0.0");
        assert_eq!(
            prepared.app.component_lock_id,
            prepared.component_lock_digest
        );
        assert!(prepared.config_revision.starts_with("sha256:"));
    }

    #[tokio::test]
    async fn publish_gate_rejects_a_draft_without_an_explicit_compatibility_contract() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = PathManager::with_user_root_for_tests(temp.path().to_path_buf());
        let written = create_product_app_package(&paths, draft("missing-contract"))
            .await
            .expect("create package");
        fs::remove_file(written.package_dir.join("compatibility.json"))
            .await
            .expect("remove compatibility contract");

        let error = prepare_draft_release(&written.package_dir, "1.1.0", &[])
            .await
            .expect_err("publishing without a compatibility contract must fail");

        assert!(error.to_string().contains("compatibility.json"));
    }

    #[tokio::test]
    async fn immutable_release_evaluation_is_bound_to_its_digest() {
        let temp = tempfile::tempdir().expect("temp dir");
        let paths = PathManager::with_user_root_for_tests(temp.path().to_path_buf());
        let written = create_product_app_package(&paths, draft("evaluated-app"))
            .await
            .expect("create package");
        let prepared = prepare_draft_release(&written.package_dir, "1.1.0", &[])
            .await
            .expect("prepare release");

        validate_release_evaluation(&written.package_dir, &prepared.evaluation_report_digest)
            .await
            .expect("generated evaluation must validate");

        let report_path = written
            .package_dir
            .join("tests")
            .join("release-evaluation.json");
        let mut report: Value = read_json(&report_path).await.expect("read evaluation");
        report["status"] = Value::String("failed".to_string());
        atomic_write_json(&report_path, &report)
            .await
            .expect("tamper evaluation");

        assert!(validate_release_evaluation(
            &written.package_dir,
            &prepared.evaluation_report_digest,
        )
        .await
        .is_err());
    }
}
