//! Product App catalog and Component Center API.

use std::collections::BTreeMap;

use crate::api::app_state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sparo_core::agentic_os::work::{
    default_work_store, RuntimeInstanceRef, WorkRuntimeIssueSeverity, WorkRuntimeLogLevel,
    WorkRuntimeRunStatus, WorkService,
};
use sparo_core::app_platform::{
    install_product_app as write_product_app_installed, list_installed_package_components,
    list_installed_product_app_catalog_with_issues, list_product_app_catalog_source_with_issues,
    list_product_app_home_catalog as read_product_app_home_catalog, native_app_shell_catalog,
    set_product_app_enabled as write_product_app_enabled,
    uninstall_product_app as write_product_app_uninstalled, AppCatalogEntry, AppCatalogVisibility,
    ComponentDefinition, ComponentKind, NativeAppCatalogEntry, ProductAppCatalogIssue,
};
use sparo_core::bridge_component::{
    BridgeComponentConsumer, BridgeComponentConsumerKind, BridgeComponentManager,
    BridgeComponentRunStatus,
};
use tauri::State;

const COMPONENT_HEALTH_ACTION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(12);

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentHealthResponse {
    pub component_id: String,
    pub status: String,
    pub detail: String,
    #[serde(default)]
    pub checks: Vec<ComponentHealthCheck>,
    pub runtime: ComponentRuntimeHealth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentHealthCheck {
    pub name: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComponentRuntimeHealth {
    pub recent_run_count: usize,
    pub recent_failure_count: usize,
    pub runtime_issue_count: usize,
    pub runtime_warning_count: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<ComponentDiagnosticAction>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recent_failures: Vec<ComponentRuntimeFailure>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recent_logs: Vec<ComponentRuntimeLogEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health_action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health_action_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health_action_detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_activity_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComponentDiagnosticAction {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub status: String,
    pub detail: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComponentRuntimeFailure {
    pub work_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_app_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_instance_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    pub severity: String,
    pub message: String,
    pub timestamp_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComponentRuntimeLogEntry {
    pub work_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_app_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_instance_id: Option<String>,
    pub level: String,
    pub category: String,
    pub message: String,
    pub timestamp_ms: i64,
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
    #[serde(default)]
    pub runtime_usages: Vec<ComponentRuntimeUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComponentRuntimeUsage {
    pub work_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_app_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_instance_id: Option<String>,
    pub run_count: usize,
    pub issue_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_activity_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppLibraryResponse {
    pub installed: Vec<AppCatalogEntry>,
    pub discoverable: Vec<AppCatalogEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub issues: Vec<ProductAppCatalogIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppHomeCatalogResponse {
    pub apps: Vec<AppCatalogEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub issues: Vec<ProductAppCatalogIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCenterCatalogResponse {
    pub native: Vec<NativeAppCatalogEntry>,
    pub product_apps: ProductAppLibraryResponse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetProductAppEnabledRequest {
    pub app_id: String,
    pub app_version: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProductAppRequest {
    pub app_id: String,
    pub app_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallProductAppRequest {
    pub app_id: String,
    pub app_version: String,
}

#[tauri::command]
pub async fn list_app_catalog(
    state: State<'_, AppState>,
) -> Result<AppCenterCatalogResponse, String> {
    let native = native_app_shell_catalog();
    let product_apps = list_product_app_library(state).await?;
    Ok(AppCenterCatalogResponse {
        native,
        product_apps,
    })
}

#[tauri::command]
pub async fn list_native_app_catalog() -> Result<Vec<NativeAppCatalogEntry>, String> {
    Ok(native_app_shell_catalog())
}

#[tauri::command]
pub async fn list_product_app_home_catalog(
    state: State<'_, AppState>,
) -> Result<ProductAppHomeCatalogResponse, String> {
    let path_manager = state.workspace_service.path_manager().clone();
    let result = read_product_app_home_catalog(&path_manager)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ProductAppHomeCatalogResponse {
        apps: result.entries,
        issues: result.issues,
    })
}

#[tauri::command]
pub async fn list_product_app_library(
    state: State<'_, AppState>,
) -> Result<ProductAppLibraryResponse, String> {
    let path_manager = state.workspace_service.path_manager().clone();
    let installed_result = list_visible_app_catalog_entries(&state).await?;
    let source_result = list_product_app_catalog_source_with_issues(&path_manager)
        .await
        .map_err(|e| e.to_string())?;
    let mut discoverable = source_result
        .entries
        .into_iter()
        .filter(|entry| {
            entry.discoverable || entry.update_available || !entry.catalog_issues.is_empty()
        })
        .collect::<Vec<_>>();
    sort_app_catalog_entries(&mut discoverable);
    let mut issues = installed_result.issues;
    issues.extend(source_result.issues);
    Ok(ProductAppLibraryResponse {
        installed: installed_result.entries,
        discoverable,
        issues,
    })
}

async fn list_visible_app_catalog_entries(
    state: &AppState,
) -> Result<sparo_core::app_platform::ProductAppCatalogEntries, String> {
    let path_manager = state.workspace_service.path_manager().clone();
    let mut result = list_installed_product_app_catalog_with_issues(&path_manager)
        .await
        .map_err(|e| e.to_string())?;
    let entries = &mut result.entries;
    entries.retain(|entry| entry.app.catalog_visibility != AppCatalogVisibility::Hidden);
    sort_app_catalog_entries(entries);
    Ok(result)
}

fn sort_app_catalog_entries(entries: &mut [AppCatalogEntry]) {
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
}

#[tauri::command]
pub async fn install_product_app(
    state: State<'_, AppState>,
    request: InstallProductAppRequest,
) -> Result<(), String> {
    let path_manager = state.workspace_service.path_manager().clone();
    write_product_app_installed(&path_manager, &request.app_id, &request.app_version)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_product_app_enabled(
    state: State<'_, AppState>,
    request: SetProductAppEnabledRequest,
) -> Result<(), String> {
    let path_manager = state.workspace_service.path_manager().clone();
    write_product_app_enabled(
        &path_manager,
        &request.app_id,
        &request.app_version,
        request.enabled,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn uninstall_product_app(
    state: State<'_, AppState>,
    request: UninstallProductAppRequest,
) -> Result<(), String> {
    let path_manager = state.workspace_service.path_manager().clone();
    write_product_app_uninstalled(&path_manager, &request.app_id, &request.app_version)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_components(
    state: State<'_, AppState>,
) -> Result<Vec<ComponentDefinition>, String> {
    list_component_definitions(&state).await
}

async fn list_component_definitions(state: &AppState) -> Result<Vec<ComponentDefinition>, String> {
    let path_manager = state.workspace_service.path_manager().clone();
    let components = list_installed_package_components(&path_manager)
        .await
        .map_err(|e| e.to_string())?;
    Ok(dedupe_components(components))
}

#[tauri::command]
pub async fn get_component(
    state: State<'_, AppState>,
    request: GetComponentRequest,
) -> Result<ComponentDefinition, String> {
    let components = list_component_definitions(&state).await?;
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
    let component_id = request.component_id.clone();
    let kind = request.kind;
    let components = list_component_definitions(&state).await?;
    let component = components
        .iter()
        .find(|component| {
            component.id == component_id && kind.map_or(true, |k| component.kind == k)
        })
        .ok_or_else(|| format!("Component not found: {}", component_id))?;
    let runtime = collect_component_runtime_health(component, request.workspace_path).await;
    Ok(build_component_health_response(
        component,
        &components,
        runtime,
    ))
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
    let runtime_usages = collect_component_runtime_usage(&component).await;
    Ok(ComponentUsageResponse {
        component_id: component.id,
        used_by_apps: component.used_by_apps,
        runtime_usages,
    })
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

fn build_component_health_response(
    component: &ComponentDefinition,
    components: &[ComponentDefinition],
    mut runtime: ComponentRuntimeHealth,
) -> ComponentHealthResponse {
    let mut issues = Vec::new();
    let mut checks = Vec::new();
    let mut missing_dependencies = Vec::new();
    if component
        .implementation_ref
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .is_empty()
    {
        issues.push("implementationRef is not declared".to_string());
    }
    for dependency in &component.dependencies {
        let resolved = components.iter().any(|candidate| {
            candidate.id == dependency.component_id && candidate.kind == dependency.kind
        });
        if !resolved {
            let detail = format!(
                "dependency missing: {}:{}",
                dependency.kind.path_segment(),
                dependency.component_id
            );
            issues.push(detail.clone());
            missing_dependencies.push(detail);
            runtime.actions.push(ComponentDiagnosticAction {
                id: format!(
                    "install-dependency:{}:{}",
                    dependency.kind.path_segment(),
                    dependency.component_id
                ),
                label: "Install dependency".to_string(),
                kind: "installDependency".to_string(),
                status: "blocked".to_string(),
                detail: format!(
                    "Install or restore {} component {} before this component can run cleanly.",
                    dependency.kind.path_segment(),
                    dependency.component_id
                ),
                target: Some(dependency.component_id.clone()),
            });
        }
    }
    checks.push(ComponentHealthCheck {
        name: "contract".to_string(),
        status: if issues.is_empty() {
            "available".to_string()
        } else {
            "degraded".to_string()
        },
        detail: if issues.is_empty() {
            format!(
                "Contract resolves with {} dependencies and {} declared capabilities.",
                component.dependencies.len(),
                component.capabilities.len()
            )
        } else {
            issues.join("; ")
        },
    });
    checks.push(ComponentHealthCheck {
        name: "dependencies".to_string(),
        status: if missing_dependencies.is_empty() {
            "available".to_string()
        } else {
            "degraded".to_string()
        },
        detail: if missing_dependencies.is_empty() {
            format!(
                "{}/{} dependencies are installed.",
                component.dependencies.len(),
                component.dependencies.len()
            )
        } else {
            missing_dependencies.join("; ")
        },
    });

    if runtime.recent_run_count > 0
        || runtime.runtime_issue_count > 0
        || runtime.runtime_warning_count > 0
    {
        checks.push(ComponentHealthCheck {
            name: "runtime".to_string(),
            status: if runtime.recent_failure_count > 0 || runtime.runtime_issue_count > 0 {
                "degraded".to_string()
            } else {
                "available".to_string()
            },
            detail: format!(
                "{} recent runs, {} failed, {} runtime errors, {} warnings.",
                runtime.recent_run_count,
                runtime.recent_failure_count,
                runtime.runtime_issue_count,
                runtime.runtime_warning_count
            ),
        });
    }
    if let Some(action) = runtime.health_action.as_deref() {
        runtime.actions.push(ComponentDiagnosticAction {
            id: format!("run-health-action:{}", action),
            label: "Run health action".to_string(),
            kind: "runHealthAction".to_string(),
            status: runtime
                .health_action_status
                .clone()
                .unwrap_or_else(|| "available".to_string()),
            detail: runtime
                .health_action_detail
                .clone()
                .unwrap_or_else(|| format!("{} can be run for live diagnostics.", action)),
            target: Some(action.to_string()),
        });
        checks.push(ComponentHealthCheck {
            name: "healthAction".to_string(),
            status: runtime
                .health_action_status
                .clone()
                .unwrap_or_else(|| "degraded".to_string()),
            detail: runtime
                .health_action_detail
                .clone()
                .unwrap_or_else(|| format!("{} did not return health detail.", action)),
        });
    }

    let status = if issues.is_empty()
        && runtime.recent_failure_count == 0
        && runtime.runtime_issue_count == 0
        && runtime
            .health_action_status
            .as_deref()
            .map_or(true, |status| status == "available")
    {
        "available"
    } else {
        "degraded"
    };
    let detail = if !issues.is_empty() {
        issues.join("; ")
    } else if runtime.recent_failure_count > 0 || runtime.runtime_issue_count > 0 {
        format!(
            "Runtime evidence reports {} failed runs and {} errors.",
            runtime.recent_failure_count, runtime.runtime_issue_count
        )
    } else if let Some(detail) = runtime.health_action_detail.as_deref() {
        detail.to_string()
    } else {
        format!(
            "Component package resolved with {} dependencies and {} declared capabilities.",
            component.dependencies.len(),
            component.capabilities.len()
        )
    };
    runtime.actions.push(ComponentDiagnosticAction {
        id: "open-runtime-logs".to_string(),
        label: "Review runtime logs".to_string(),
        kind: "openRuntimeLogs".to_string(),
        status: if runtime.recent_logs.is_empty() {
            "empty".to_string()
        } else {
            "available".to_string()
        },
        detail: if runtime.recent_logs.is_empty() {
            "No recent runtime logs have been recorded for this component.".to_string()
        } else {
            format!(
                "{} recent runtime log entries are available.",
                runtime.recent_logs.len()
            )
        },
        target: None,
    });
    runtime.actions.push(ComponentDiagnosticAction {
        id: "inspect-runtime-usage".to_string(),
        label: "Inspect runtime usage".to_string(),
        kind: "inspectRuntimeUsage".to_string(),
        status: if runtime.recent_run_count > 0 || runtime.runtime_issue_count > 0 {
            "available".to_string()
        } else {
            "empty".to_string()
        },
        detail: "Use the runtime usage graph below to jump from this component back to owning Work and Runtime instances.".to_string(),
        target: None,
    });
    ComponentHealthResponse {
        component_id: component.id.clone(),
        status: status.to_string(),
        detail,
        checks,
        runtime,
    }
}

async fn collect_component_runtime_usage(
    component: &ComponentDefinition,
) -> Vec<ComponentRuntimeUsage> {
    let Ok(store) = default_work_store() else {
        return Vec::new();
    };
    let service = WorkService::new(store);
    let Ok(works) = service.list().await else {
        return Vec::new();
    };
    let mut usages = BTreeMap::<String, ComponentRuntimeUsage>::new();
    for work in works {
        let runtime_instance_ids = work
            .runtime_instances
            .iter()
            .filter(|instance| instance.product_app_surface_id == component.id)
            .map(|instance| instance.id.clone())
            .collect::<std::collections::HashSet<_>>();

        for run in &work.runtime_runs {
            if run.component_id != component.id
                && !runtime_instance_ids.contains(&run.runtime_instance_id)
            {
                continue;
            }
            let usage = component_usage_entry(
                &mut usages,
                work.id.as_str(),
                Some(&run.runtime_instance_id),
                runtime_instance_product_app_id(&work.runtime_instances, &run.runtime_instance_id),
            );
            usage.run_count += 1;
            merge_usage_activity(usage, run.updated_at.max(run.started_at));
        }

        for issue in &work.runtime_issues {
            if issue.component_id != component.id
                && !runtime_instance_ids.contains(&issue.runtime_instance_id)
            {
                continue;
            }
            let usage = component_usage_entry(
                &mut usages,
                work.id.as_str(),
                Some(&issue.runtime_instance_id),
                Some(issue.product_app_id.as_str()),
            );
            usage.issue_count += 1;
            merge_usage_activity(usage, issue.timestamp_ms);
        }

        for log in &work.runtime_logs {
            if log.component_id != component.id
                && !runtime_instance_ids.contains(&log.runtime_instance_id)
            {
                continue;
            }
            if !matches!(
                log.level,
                WorkRuntimeLogLevel::Warn | WorkRuntimeLogLevel::Error
            ) {
                continue;
            }
            let usage = component_usage_entry(
                &mut usages,
                work.id.as_str(),
                Some(&log.runtime_instance_id),
                Some(log.product_app_id.as_str()),
            );
            usage.issue_count += 1;
            merge_usage_activity(usage, log.timestamp_ms);
        }
    }
    let mut values = usages.into_values().collect::<Vec<_>>();
    values.sort_by(|left, right| {
        right
            .last_activity_at
            .cmp(&left.last_activity_at)
            .then_with(|| left.work_id.cmp(&right.work_id))
    });
    values
}

fn component_usage_entry<'a>(
    usages: &'a mut BTreeMap<String, ComponentRuntimeUsage>,
    work_id: &str,
    runtime_instance_id: Option<&str>,
    product_app_id: Option<&str>,
) -> &'a mut ComponentRuntimeUsage {
    let key = format!("{}:{}", work_id, runtime_instance_id.unwrap_or("work"));
    usages.entry(key).or_insert_with(|| ComponentRuntimeUsage {
        work_id: work_id.to_string(),
        product_app_id: product_app_id.map(str::to_string),
        runtime_instance_id: runtime_instance_id.map(str::to_string),
        run_count: 0,
        issue_count: 0,
        last_activity_at: None,
    })
}

fn runtime_instance_product_app_id<'a>(
    instances: &'a [RuntimeInstanceRef],
    runtime_instance_id: &str,
) -> Option<&'a str> {
    instances
        .iter()
        .find(|instance| instance.id == runtime_instance_id)
        .map(|instance| instance.product_app_id.as_str())
}

fn merge_usage_activity(usage: &mut ComponentRuntimeUsage, timestamp: i64) {
    usage.last_activity_at = Some(
        usage
            .last_activity_at
            .map(|current| current.max(timestamp))
            .unwrap_or(timestamp),
    );
}

fn trim_component_runtime_health(health: &mut ComponentRuntimeHealth) {
    health
        .recent_failures
        .sort_by(|left, right| right.timestamp_ms.cmp(&left.timestamp_ms));
    health.recent_failures.truncate(5);
    health
        .recent_logs
        .sort_by(|left, right| right.timestamp_ms.cmp(&left.timestamp_ms));
    health.recent_logs.truncate(10);
}

fn runtime_log_level_label(level: WorkRuntimeLogLevel) -> &'static str {
    match level {
        WorkRuntimeLogLevel::Debug => "debug",
        WorkRuntimeLogLevel::Info => "info",
        WorkRuntimeLogLevel::Warn => "warn",
        WorkRuntimeLogLevel::Error => "error",
    }
}

async fn collect_component_runtime_health(
    component: &ComponentDefinition,
    workspace_path: Option<String>,
) -> ComponentRuntimeHealth {
    let mut health = ComponentRuntimeHealth::default();

    if component.kind == ComponentKind::Bridge {
        collect_bridge_component_health_action(component, workspace_path.clone(), &mut health)
            .await;
    }

    let Ok(store) = default_work_store() else {
        return health;
    };
    let service = WorkService::new(store);
    let Ok(works) = service.list().await else {
        return health;
    };

    for work in works {
        let runtime_instance_ids = work
            .runtime_instances
            .iter()
            .filter(|instance| instance.product_app_surface_id == component.id)
            .map(|instance| instance.id.clone())
            .collect::<std::collections::HashSet<_>>();

        for run in &work.runtime_runs {
            if run.component_id != component.id
                && !runtime_instance_ids.contains(&run.runtime_instance_id)
            {
                continue;
            }
            health.recent_run_count += 1;
            if run.status == WorkRuntimeRunStatus::Failed {
                health.recent_failure_count += 1;
                let timestamp_ms = run.updated_at.max(run.started_at);
                health.recent_failures.push(ComponentRuntimeFailure {
                    work_id: work.id.as_str().to_string(),
                    product_app_id: runtime_instance_product_app_id(
                        &work.runtime_instances,
                        &run.runtime_instance_id,
                    )
                    .map(str::to_string),
                    runtime_instance_id: Some(run.runtime_instance_id.clone()),
                    run_id: Some(run.run_id.clone()),
                    severity: "failed".to_string(),
                    message: run
                        .error
                        .clone()
                        .unwrap_or_else(|| format!("{} failed", run.action)),
                    timestamp_ms,
                });
            }
            merge_last_activity(&mut health, run.updated_at.max(run.started_at));
        }

        for issue in &work.runtime_issues {
            if issue.component_id != component.id
                && !runtime_instance_ids.contains(&issue.runtime_instance_id)
            {
                continue;
            }
            match issue.severity {
                WorkRuntimeIssueSeverity::Fatal => {
                    health.runtime_issue_count += 1;
                    health.recent_failures.push(ComponentRuntimeFailure {
                        work_id: work.id.as_str().to_string(),
                        product_app_id: Some(issue.product_app_id.clone()),
                        runtime_instance_id: Some(issue.runtime_instance_id.clone()),
                        run_id: None,
                        severity: "fatal".to_string(),
                        message: issue.message.clone(),
                        timestamp_ms: issue.timestamp_ms,
                    });
                }
                WorkRuntimeIssueSeverity::Warning => {
                    health.runtime_warning_count += 1;
                }
                WorkRuntimeIssueSeverity::Noise => {}
            }
            merge_last_activity(&mut health, issue.timestamp_ms);
        }

        for log in &work.runtime_logs {
            if log.component_id != component.id
                && !runtime_instance_ids.contains(&log.runtime_instance_id)
            {
                continue;
            }
            match log.level {
                WorkRuntimeLogLevel::Error => {
                    health.runtime_issue_count += 1;
                    health.recent_failures.push(ComponentRuntimeFailure {
                        work_id: work.id.as_str().to_string(),
                        product_app_id: Some(log.product_app_id.clone()),
                        runtime_instance_id: Some(log.runtime_instance_id.clone()),
                        run_id: None,
                        severity: "error".to_string(),
                        message: log.message.clone(),
                        timestamp_ms: log.timestamp_ms,
                    });
                }
                WorkRuntimeLogLevel::Warn => {
                    health.runtime_warning_count += 1;
                }
                WorkRuntimeLogLevel::Debug | WorkRuntimeLogLevel::Info => {}
            }
            health.recent_logs.push(ComponentRuntimeLogEntry {
                work_id: work.id.as_str().to_string(),
                product_app_id: Some(log.product_app_id.clone()),
                runtime_instance_id: Some(log.runtime_instance_id.clone()),
                level: runtime_log_level_label(log.level).to_string(),
                category: log.category.clone(),
                message: log.message.clone(),
                timestamp_ms: log.timestamp_ms,
            });
            merge_last_activity(&mut health, log.timestamp_ms);
        }
    }

    trim_component_runtime_health(&mut health);
    health
}

async fn collect_bridge_component_health_action(
    component: &ComponentDefinition,
    workspace_path: Option<String>,
    health: &mut ComponentRuntimeHealth,
) {
    let Some((capability_id, action)) = component_health_action(component) else {
        return;
    };
    if let Err(error) = BridgeComponentManager::seed_builtin_bridge_components() {
        health.health_action = Some(action.clone());
        health.health_action_status = Some("degraded".to_string());
        health.health_action_detail = Some(format!(
            "Bridge Component package seeding failed before {}: {}",
            action, error
        ));
        return;
    }
    let run_id = format!(
        "component-health:{}:{}:{}",
        component.kind.path_segment(),
        component.id,
        chrono::Utc::now().timestamp_millis()
    );
    let result = tokio::time::timeout(
        COMPONENT_HEALTH_ACTION_TIMEOUT,
        BridgeComponentManager::run_capability_action(
            &component.id,
            capability_id.as_deref(),
            &action,
            json!({}),
            workspace_path,
            run_id,
            BridgeComponentConsumer {
                kind: BridgeComponentConsumerKind::Management,
                id: format!("component-health:{}", component.id),
                session_id: None,
                turn_id: None,
            },
        ),
    )
    .await;

    health.health_action = Some(action.clone());
    match result {
        Ok(Ok(result)) => {
            let degraded = result.status == BridgeComponentRunStatus::Failed
                || bridge_output_has_error_diagnostics(&result.output)
                || result
                    .stderr
                    .as_deref()
                    .is_some_and(|stderr| !stderr.trim().is_empty());
            let (error_count, warning_count) = bridge_output_diagnostic_counts(&result.output);
            health.runtime_issue_count += error_count;
            health.runtime_warning_count += warning_count;
            health.health_action_status = Some(if degraded {
                "degraded".to_string()
            } else {
                "available".to_string()
            });
            health.health_action_detail =
                Some(bridge_health_action_detail(&action, &result.output));
        }
        Ok(Err(error)) => {
            health.recent_failure_count += 1;
            health.health_action_status = Some("degraded".to_string());
            health.health_action_detail = Some(format!("{} failed: {}", action, error));
        }
        Err(_) => {
            health.recent_failure_count += 1;
            health.health_action_status = Some("degraded".to_string());
            health.health_action_detail = Some(format!(
                "{} timed out after {} seconds.",
                action,
                COMPONENT_HEALTH_ACTION_TIMEOUT.as_secs()
            ));
        }
    }
}

fn component_health_action(component: &ComponentDefinition) -> Option<(Option<String>, String)> {
    for preferred in ["health", "readDiagnostics", "getRuntimeState"] {
        if let Some(capability) = component
            .capabilities
            .iter()
            .find(|capability| capability.actions.iter().any(|action| action == preferred))
        {
            return Some((Some(capability.id.clone()), preferred.to_string()));
        }
    }
    None
}

fn bridge_output_has_error_diagnostics(output: &Value) -> bool {
    output
        .get("diagnostics")
        .and_then(Value::as_array)
        .is_some_and(|diagnostics| {
            diagnostics.iter().any(|diagnostic| {
                let level = diagnostic
                    .get("level")
                    .or_else(|| diagnostic.get("severity"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                matches!(level, "error" | "fatal")
            })
        })
        || output
            .get("ok")
            .and_then(Value::as_bool)
            .is_some_and(|ok| !ok)
}

fn bridge_output_diagnostic_counts(output: &Value) -> (usize, usize) {
    let Some(diagnostics) = output.get("diagnostics").and_then(Value::as_array) else {
        return (0, 0);
    };
    let mut errors = 0;
    let mut warnings = 0;
    for diagnostic in diagnostics {
        let level = diagnostic
            .get("level")
            .or_else(|| diagnostic.get("severity"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if matches!(level, "error" | "fatal") {
            errors += 1;
        } else if level == "warning" {
            warnings += 1;
        }
    }
    (errors, warnings)
}

fn bridge_health_action_detail(action: &str, output: &Value) -> String {
    if let Some(diagnostics) = output.get("diagnostics").and_then(Value::as_array) {
        let error_count = diagnostics
            .iter()
            .filter(|diagnostic| {
                diagnostic
                    .get("level")
                    .or_else(|| diagnostic.get("severity"))
                    .and_then(Value::as_str)
                    .is_some_and(|level| matches!(level, "error" | "fatal"))
            })
            .count();
        let warning_count = diagnostics
            .iter()
            .filter(|diagnostic| {
                diagnostic
                    .get("level")
                    .or_else(|| diagnostic.get("severity"))
                    .and_then(Value::as_str)
                    .is_some_and(|level| level == "warning")
            })
            .count();
        return format!(
            "{} returned {} diagnostics: {} errors, {} warnings.",
            action,
            diagnostics.len(),
            error_count,
            warning_count
        );
    }
    if let Some(ok) = output.get("ok").and_then(Value::as_bool) {
        return format!("{} returned ok={}.", action, ok);
    }
    format!("{} completed.", action)
}

fn merge_last_activity(health: &mut ComponentRuntimeHealth, timestamp: i64) {
    health.last_activity_at = Some(
        health
            .last_activity_at
            .map(|current| current.max(timestamp))
            .unwrap_or(timestamp),
    );
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

#[cfg(test)]
mod tests {
    use super::{build_component_health_response, ComponentRuntimeHealth};
    use sparo_core::app_platform::{
        AppComponentRef, CapabilityRef, ComponentDefinition, ComponentKind, ComponentPackageSource,
        ComponentSource, ComponentVisibility,
    };

    fn component(id: &str, kind: ComponentKind) -> ComponentDefinition {
        ComponentDefinition {
            id: id.to_string(),
            version: Some("1.0.0".to_string()),
            kind,
            name: id.to_string(),
            description: String::new(),
            package_source: ComponentPackageSource::Shared,
            owner_app: None,
            capabilities: vec![CapabilityRef {
                id: "run".to_string(),
                title: "Run".to_string(),
                description: String::new(),
                actions: Vec::new(),
            }],
            permissions: Vec::new(),
            uses_capabilities: Vec::new(),
            used_by_apps: Vec::new(),
            visibility: ComponentVisibility::Developer,
            dependencies: Vec::new(),
            implementation_ref: Some("bundle://component".to_string()),
        }
    }

    #[test]
    fn component_health_reports_missing_dependencies() {
        let mut surface = component("surface", ComponentKind::Surface);
        surface.dependencies.push(AppComponentRef {
            component_id: "missing-agent".to_string(),
            kind: ComponentKind::Agent,
            source: ComponentSource::Shared,
            role: "executor".to_string(),
            version: None,
            capabilities: Vec::new(),
            uses_capabilities: Vec::new(),
        });

        let health = build_component_health_response(
            &surface,
            &[surface.clone()],
            ComponentRuntimeHealth::default(),
        );

        assert_eq!(health.status, "degraded");
        assert!(health
            .detail
            .contains("dependency missing: agents:missing-agent"));
    }

    #[test]
    fn component_health_reports_available_when_contract_resolves() {
        let surface = component("surface", ComponentKind::Surface);

        let health = build_component_health_response(
            &surface,
            &[surface.clone()],
            ComponentRuntimeHealth::default(),
        );

        assert_eq!(health.status, "available");
        assert!(health.detail.contains("resolved with 0 dependencies"));
    }

    #[test]
    fn component_health_degrades_from_runtime_evidence() {
        let bridge = component("bridge", ComponentKind::Bridge);

        let health = build_component_health_response(
            &bridge,
            &[bridge.clone()],
            ComponentRuntimeHealth {
                recent_run_count: 3,
                recent_failure_count: 1,
                runtime_issue_count: 1,
                runtime_warning_count: 0,
                health_action: None,
                health_action_status: None,
                health_action_detail: None,
                last_activity_at: Some(42),
                ..ComponentRuntimeHealth::default()
            },
        );

        assert_eq!(health.status, "degraded");
        assert_eq!(health.runtime.recent_run_count, 3);
        assert!(health
            .checks
            .iter()
            .any(|check| check.name == "runtime" && check.status == "degraded"));
    }
}
