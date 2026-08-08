use std::collections::BTreeMap;
use std::sync::Arc;

use crate::api::app_state::AppState;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sparo_core::agentic::coordination::{ConversationCoordinator, DialogScheduler};
use sparo_core::agentic_os::work::{
    default_work_store, AgenticWorkRuntimeBridge, CreateWorkForObjectRequest,
    EnsurePrimaryWorkObjectRequest, WorkCleanupAction, WorkCleanupItem, WorkCleanupItemReport,
    WorkCleanupItemStatus, WorkExecutionGraph, WorkLifecycleHookBus, WorkLifecycleHookContext,
    WorkLifecycleHookHandler, WorkLifecycleHookKind, WorkLifecycleHookOutcome,
    WorkLifecycleHookPhase, WorkResourceOwnership, WorkResourceRef, WorkService,
};
use sparo_core::command::agentic_os as agentic_os_command;
use sparo_core::error::CoreResult;
use sparo_core::product_app_runtime_host::ProductAppRuntimeHostWorkerPool;
use tauri::State;

fn work_service(
    coordinator: &Arc<ConversationCoordinator>,
    scheduler: &Arc<DialogScheduler>,
) -> Result<WorkService, String> {
    work_service_with_hook_bus(
        coordinator,
        scheduler,
        WorkLifecycleHookBus::default_handlers(),
    )
}

fn work_service_with_desktop_hooks(
    coordinator: &Arc<ConversationCoordinator>,
    scheduler: &Arc<DialogScheduler>,
    state: &AppState,
) -> Result<WorkService, String> {
    work_service_with_hook_bus(
        coordinator,
        scheduler,
        WorkLifecycleHookBus::default_handlers_with(vec![Arc::new(
            ProductRuntimeWorkerLifecycleHook::new(state.js_worker_pool.clone()),
        )]),
    )
}

fn work_service_with_hook_bus(
    coordinator: &Arc<ConversationCoordinator>,
    scheduler: &Arc<DialogScheduler>,
    hook_bus: WorkLifecycleHookBus,
) -> Result<WorkService, String> {
    let store = default_work_store().map_err(|error| error.to_string())?;
    let runtime = Arc::new(AgenticWorkRuntimeBridge::new(
        coordinator.clone(),
        scheduler.clone(),
    ));
    Ok(WorkService::with_lifecycle_hooks(store, runtime, hook_bus))
}

struct ProductRuntimeWorkerLifecycleHook {
    worker_pool: Option<Arc<ProductAppRuntimeHostWorkerPool>>,
}

impl ProductRuntimeWorkerLifecycleHook {
    fn new(worker_pool: Option<Arc<ProductAppRuntimeHostWorkerPool>>) -> Self {
        Self { worker_pool }
    }

    fn worker_id(work_id: &str, runtime_instance_id: &str) -> String {
        format!("product-app-runtime:{}:{}", work_id, runtime_instance_id)
    }
}

const PRODUCT_RUNTIME_WORKER_HOOK_PHASES: &[WorkLifecycleHookPhase] = &[
    WorkLifecycleHookPhase::Plan,
    WorkLifecycleHookPhase::Prepare,
];

#[async_trait]
impl WorkLifecycleHookHandler for ProductRuntimeWorkerLifecycleHook {
    fn id(&self) -> &'static str {
        "product_runtime_worker"
    }

    fn phases(&self) -> &'static [WorkLifecycleHookPhase] {
        PRODUCT_RUNTIME_WORKER_HOOK_PHASES
    }

    async fn handle(
        &self,
        context: &WorkLifecycleHookContext,
        hook: &WorkLifecycleHookKind,
    ) -> CoreResult<WorkLifecycleHookOutcome> {
        match hook {
            WorkLifecycleHookKind::DeleteRequested { .. } => {
                let items = context
                    .work
                    .runtime_instances
                    .iter()
                    .map(|instance| {
                        let worker_id =
                            Self::worker_id(context.work.id.as_str(), instance.id.as_str());
                        let mut metadata = BTreeMap::new();
                        metadata.insert("runtime_instance_id".to_string(), instance.id.clone());
                        metadata.insert("product_app_id".to_string(), instance.app_id.clone());
                        metadata.insert(
                            "product_app_surface_id".to_string(),
                            instance.product_app_surface_id.clone(),
                        );
                        WorkCleanupItem {
                            id: format!("product-runtime-worker:{}", worker_id),
                            handler_id: self.id().to_string(),
                            resource: WorkResourceRef {
                                kind: "product_runtime_worker".to_string(),
                                id: worker_id,
                                ownership: WorkResourceOwnership::Owned,
                                metadata,
                            },
                            action: WorkCleanupAction::Stop,
                            required: false,
                        }
                    })
                    .collect();
                Ok(WorkLifecycleHookOutcome::CleanupPlan(items))
            }
            WorkLifecycleHookKind::Deleting { plan } => {
                let mut reports = Vec::new();
                let Some(worker_pool) = &self.worker_pool else {
                    for item in &plan.items {
                        reports.push(WorkCleanupItemReport {
                            item: item.clone(),
                            status: WorkCleanupItemStatus::Skipped,
                            message: Some(
                                "Product runtime worker pool is not initialized".to_string(),
                            ),
                        });
                    }
                    return Ok(WorkLifecycleHookOutcome::CleanupReport(reports));
                };

                for item in &plan.items {
                    worker_pool.stop(&item.resource.id).await;
                    reports.push(WorkCleanupItemReport {
                        item: item.clone(),
                        status: WorkCleanupItemStatus::Succeeded,
                        message: None,
                    });
                }
                Ok(WorkLifecycleHookOutcome::CleanupReport(reports))
            }
            WorkLifecycleHookKind::Deleted { .. } => Ok(WorkLifecycleHookOutcome::Continue),
        }
    }
}

#[tauri::command]
pub async fn agentic_os_list_works(
    request: agentic_os_command::AgenticOsListWorksRequest,
) -> Result<agentic_os_command::AgenticOsListWorksResponse, String> {
    agentic_os_command::list_works(request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_get_work(
    request: agentic_os_command::AgenticOsGetWorkRequest,
) -> Result<agentic_os_command::AgenticOsGetWorkResponse, String> {
    agentic_os_command::get_work(request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_list_work_objects(
    request: agentic_os_command::AgenticOsListWorkObjectsRequest,
) -> Result<agentic_os_command::AgenticOsListWorkObjectsResponse, String> {
    agentic_os_command::list_work_objects(request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_get_work_object(
    request: agentic_os_command::AgenticOsGetWorkObjectRequest,
) -> Result<agentic_os_command::AgenticOsGetWorkObjectResponse, String> {
    agentic_os_command::get_work_object(request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_delete_work(
    state: State<'_, AppState>,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: agentic_os_command::AgenticOsDeleteWorkRequest,
) -> Result<agentic_os_command::AgenticOsDeleteWorkResponse, String> {
    let service = work_service_with_desktop_hooks(&coordinator, &scheduler, &state)?;
    agentic_os_command::delete_work_with_service(&service, request)
        .await
        .map_err(|error| error.to_string())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgenticOsGetWorkExecutionGraphRequest {
    pub locator: sparo_core::agentic_os::work::WorkLocator,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgenticOsGetWorkExecutionGraphResponse {
    pub graph: WorkExecutionGraph,
}

#[tauri::command]
pub async fn agentic_os_get_work_execution_graph(
    request: AgenticOsGetWorkExecutionGraphRequest,
) -> Result<AgenticOsGetWorkExecutionGraphResponse, String> {
    let service = WorkService::new(default_work_store().map_err(|error| error.to_string())?);
    let graph = service
        .execution_graph(&request.locator)
        .await
        .map_err(|error| error.to_string())?;
    Ok(AgenticOsGetWorkExecutionGraphResponse { graph })
}

#[tauri::command]
pub async fn agentic_os_create_work(
    state: State<'_, AppState>,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    mut request: agentic_os_command::AgenticOsCreateWorkRequest,
) -> Result<agentic_os_command::AgenticOsCreateWorkResponse, String> {
    let primary_work_object_kind =
        crate::api::app_release_runtime::authorize_create_work_request(&state, &mut request.work)
            .await?;
    let service = work_service(&coordinator, &scheduler)?;
    let mut response = agentic_os_command::create_work_with_service(&service, request)
        .await
        .map_err(|error| error.to_string())?;
    if let Some(declaration) = primary_work_object_kind {
        response.work = service
            .ensure_primary_work_object(EnsurePrimaryWorkObjectRequest {
                work_locator: response.work.locator(),
                kind_id: declaration.kind_id,
                title: Some(response.work.title.clone()),
            })
            .await
            .map_err(|error| error.to_string())?
            .work;
    }
    Ok(response)
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgenticOsCreateWorkForObjectRequest {
    pub source_work_locator: sparo_core::agentic_os::work::WorkLocator,
    pub work: sparo_core::agentic_os::work::CreateWorkRequest,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsCreateWorkForObjectResponse {
    pub work: sparo_core::agentic_os::work::WorkRecord,
}

#[tauri::command]
pub async fn agentic_os_create_work_for_object(
    state: State<'_, AppState>,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    mut request: AgenticOsCreateWorkForObjectRequest,
) -> Result<AgenticOsCreateWorkForObjectResponse, String> {
    let primary_object =
        crate::api::app_release_runtime::authorize_create_work_request(&state, &mut request.work)
            .await?
            .ok_or_else(|| {
                "Product App does not declare a reusable primary WorkObject".to_string()
            })?;
    if !primary_object.reusable_across_works {
        return Err(
            "Product App does not support reusing its primary WorkObject across Works".to_string(),
        );
    }
    let service = work_service(&coordinator, &scheduler)?;
    let source_work = service
        .get(&request.source_work_locator)
        .await
        .map_err(|error| error.to_string())?;
    let source_app = source_work
        .subject
        .app_ref()
        .ok_or_else(|| "Source Work is not owned by a Product App".to_string())?;
    let (_, current_source_app) =
        crate::api::app_release_runtime::resolve_current_app_release_for_work(&state, source_app)
            .await?;
    let target_app = request
        .work
        .subject
        .app_ref()
        .ok_or_else(|| "New Work must be owned by a Product App".to_string())?;
    if &current_source_app != target_app {
        return Err(
            "Source Work is not compatible with the active Product App Release".to_string(),
        );
    }
    let response = service
        .create_work_for_object(CreateWorkForObjectRequest {
            source_work_locator: request.source_work_locator,
            work: request.work,
            primary_object_kind_id: primary_object.kind_id,
        })
        .await
        .map_err(|error| error.to_string())?;
    Ok(AgenticOsCreateWorkForObjectResponse {
        work: response.work,
    })
}

#[tauri::command]
pub async fn agentic_os_resolve_app_work(
    state: State<'_, AppState>,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    mut request: agentic_os_command::AgenticOsResolveAppWorkRequest,
) -> Result<agentic_os_command::AgenticOsResolveAppWorkResponse, String> {
    let primary_work_object_kind =
        crate::api::app_release_runtime::authorize_resolve_app_work_request(
            &state,
            &mut request.app_work,
        )
        .await?;
    let service = work_service(&coordinator, &scheduler)?;
    let mut response = agentic_os_command::resolve_app_work_with_service(&service, request)
        .await
        .map_err(|error| error.to_string())?;
    if response.created {
        if let Some(declaration) = primary_work_object_kind {
            response.work = service
                .ensure_primary_work_object(EnsurePrimaryWorkObjectRequest {
                    work_locator: response.work.locator(),
                    kind_id: declaration.kind_id,
                    title: Some(response.work.title.clone()),
                })
                .await
                .map_err(|error| error.to_string())?
                .work;
        }
    }
    Ok(response)
}

#[tauri::command]
pub async fn agentic_os_resolve_component_work(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: agentic_os_command::AgenticOsResolveComponentWorkRequest,
) -> Result<agentic_os_command::AgenticOsResolveComponentWorkResponse, String> {
    let service = work_service(&coordinator, &scheduler)?;
    agentic_os_command::resolve_component_work_with_service(&service, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_start_work(
    state: State<'_, AppState>,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    mut request: agentic_os_command::AgenticOsStartWorkRequest,
) -> Result<agentic_os_command::AgenticOsStartWorkResponse, String> {
    crate::api::app_release_runtime::authorize_start_work_request(&state, &mut request.start)
        .await?;
    let service = work_service(&coordinator, &scheduler)?;
    agentic_os_command::start_work_with_service(&service, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_update_work(
    request: agentic_os_command::AgenticOsUpdateWorkRequest,
) -> Result<agentic_os_command::AgenticOsUpdateWorkResponse, String> {
    agentic_os_command::update_work(request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_link_session_to_work(
    request: agentic_os_command::AgenticOsLinkSessionToWorkRequest,
) -> Result<agentic_os_command::AgenticOsLinkSessionToWorkResponse, String> {
    agentic_os_command::link_session_to_work(request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_dispatch_work(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: agentic_os_command::AgenticOsDispatchWorkRequest,
) -> Result<agentic_os_command::AgenticOsDispatchWorkResponse, String> {
    let service = work_service(&coordinator, &scheduler)?;
    agentic_os_command::dispatch_work_with_service(&service, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_advance_work(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: agentic_os_command::AgenticOsAdvanceWorkRequest,
) -> Result<agentic_os_command::AgenticOsAdvanceWorkResponse, String> {
    let service = work_service(&coordinator, &scheduler)?;
    agentic_os_command::advance_work_with_service(&service, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_control_work(
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: agentic_os_command::AgenticOsControlWorkRequest,
) -> Result<agentic_os_command::AgenticOsControlWorkResponse, String> {
    let service = work_service(&coordinator, &scheduler)?;
    agentic_os_command::control_work_with_service(&service, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_record_builder_preview_result(
    request: agentic_os_command::AgenticOsRecordBuilderPreviewResultRequest,
) -> Result<agentic_os_command::AgenticOsRecordBuilderPreviewResultResponse, String> {
    agentic_os_command::record_builder_preview_result(request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agentic_os_record_builder_validation_result(
    request: agentic_os_command::AgenticOsRecordBuilderValidationResultRequest,
) -> Result<agentic_os_command::AgenticOsRecordBuilderValidationResultResponse, String> {
    agentic_os_command::record_builder_validation_result(request)
        .await
        .map_err(|error| error.to_string())
}
