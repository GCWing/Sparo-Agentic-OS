use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, CoreResult};
use crate::infrastructure::try_get_path_manager_arc;

use super::execution_binding::WorkExecutionSource;
use super::record::WorkRecord;
use super::runtime_bridge::WorkRuntimeBridge;
use super::surface::WorkSurfaceRef;
use super::types::WorkScope;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkDeleteOptions {
    #[serde(default)]
    pub cascade_child_works: bool,
    #[serde(default)]
    pub delete_linked_sessions: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkLifecycleHookPhase {
    Validate,
    Plan,
    Prepare,
    Commit,
    AfterCommit,
    Compensate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WorkLifecycleHookKind {
    DeleteRequested { options: WorkDeleteOptions },
    Deleting { plan: WorkCleanupPlan },
    Deleted { report: WorkCleanupReport },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkResourceOwnership {
    Owned,
    Linked,
    Derived,
    External,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkCleanupAction {
    Delete,
    Detach,
    Retain,
    Archive,
    Stop,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkResourceRef {
    pub kind: String,
    pub id: String,
    pub ownership: WorkResourceOwnership,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkCleanupItem {
    pub id: String,
    pub handler_id: String,
    pub resource: WorkResourceRef,
    pub action: WorkCleanupAction,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkCleanupPlan {
    pub work_id: String,
    pub items: Vec<WorkCleanupItem>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkCleanupItemStatus {
    Planned,
    Succeeded,
    Failed,
    Retained,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkCleanupItemReport {
    pub item: WorkCleanupItem,
    pub status: WorkCleanupItemStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkCleanupReport {
    pub work_id: String,
    pub items: Vec<WorkCleanupItemReport>,
}

impl WorkCleanupReport {
    pub fn has_required_failures(&self) -> bool {
        self.items.iter().any(|item| {
            item.item.required
                && matches!(
                    item.status,
                    WorkCleanupItemStatus::Failed | WorkCleanupItemStatus::Skipped
                )
        })
    }
}

#[derive(Clone)]
pub struct WorkLifecycleHookContext {
    pub work: WorkRecord,
    pub runtime_bridge: Arc<dyn WorkRuntimeBridge>,
}

impl WorkLifecycleHookContext {
    pub fn new(work: WorkRecord, runtime_bridge: Arc<dyn WorkRuntimeBridge>) -> Self {
        Self {
            work,
            runtime_bridge,
        }
    }
}

pub enum WorkLifecycleHookOutcome {
    Continue,
    CleanupPlan(Vec<WorkCleanupItem>),
    CleanupReport(Vec<WorkCleanupItemReport>),
}

#[async_trait]
pub trait WorkLifecycleHookHandler: Send + Sync {
    fn id(&self) -> &'static str;
    fn phases(&self) -> &'static [WorkLifecycleHookPhase];

    async fn handle(
        &self,
        context: &WorkLifecycleHookContext,
        hook: &WorkLifecycleHookKind,
    ) -> CoreResult<WorkLifecycleHookOutcome>;
}

#[derive(Clone)]
pub struct WorkLifecycleHookBus {
    handlers: Arc<Vec<Arc<dyn WorkLifecycleHookHandler>>>,
}

impl WorkLifecycleHookBus {
    pub fn new(handlers: Vec<Arc<dyn WorkLifecycleHookHandler>>) -> Self {
        Self {
            handlers: Arc::new(handlers),
        }
    }

    pub fn default_handlers() -> Self {
        Self::default_handlers_with(Vec::new())
    }

    pub fn default_handlers_with(
        mut extension_handlers: Vec<Arc<dyn WorkLifecycleHookHandler>>,
    ) -> Self {
        let mut handlers: Vec<Arc<dyn WorkLifecycleHookHandler>> =
            vec![Arc::new(WorkSessionLifecycleHook)];
        handlers.append(&mut extension_handlers);
        handlers.push(Arc::new(ProductRuntimeStorageLifecycleHook));
        handlers.push(Arc::new(RetainedReferenceLifecycleHook));
        Self::new(handlers)
    }

    pub async fn plan_delete(
        &self,
        context: &WorkLifecycleHookContext,
        options: WorkDeleteOptions,
    ) -> CoreResult<WorkCleanupPlan> {
        let hook = WorkLifecycleHookKind::DeleteRequested { options };
        let mut items = Vec::new();
        for handler in self.handlers.iter() {
            if !handler.phases().contains(&WorkLifecycleHookPhase::Plan) {
                continue;
            }
            match handler.handle(context, &hook).await? {
                WorkLifecycleHookOutcome::CleanupPlan(mut planned) => items.append(&mut planned),
                WorkLifecycleHookOutcome::Continue | WorkLifecycleHookOutcome::CleanupReport(_) => {
                }
            }
        }
        Ok(WorkCleanupPlan {
            work_id: context.work.id.as_str().to_string(),
            items,
        })
    }

    pub async fn execute_delete(
        &self,
        context: &WorkLifecycleHookContext,
        plan: WorkCleanupPlan,
    ) -> WorkCleanupReport {
        let mut reports = Vec::new();
        let items_by_handler = plan.items.into_iter().fold(
            BTreeMap::<String, Vec<WorkCleanupItem>>::new(),
            |mut map, item| {
                map.entry(item.handler_id.clone()).or_default().push(item);
                map
            },
        );
        let mut handled_handler_ids = BTreeSet::new();

        for handler in self.handlers.iter() {
            let Some(items) = items_by_handler.get(handler.id()) else {
                continue;
            };
            handled_handler_ids.insert(handler.id().to_string());
            if !handler.phases().contains(&WorkLifecycleHookPhase::Prepare) {
                for item in items {
                    reports.push(WorkCleanupItemReport {
                        item: item.clone(),
                        status: WorkCleanupItemStatus::Skipped,
                        message: Some(format!(
                            "No prepare-phase handler registered for {}",
                            item.handler_id
                        )),
                    });
                }
                continue;
            }

            let cleanup_plan = WorkCleanupPlan {
                work_id: context.work.id.as_str().to_string(),
                items: items.clone(),
            };
            let hook = WorkLifecycleHookKind::Deleting { plan: cleanup_plan };
            match handler.handle(context, &hook).await {
                Ok(WorkLifecycleHookOutcome::CleanupReport(mut handler_reports)) => {
                    reports.append(&mut handler_reports);
                }
                Ok(WorkLifecycleHookOutcome::Continue)
                | Ok(WorkLifecycleHookOutcome::CleanupPlan(_)) => {
                    for item in items {
                        reports.push(WorkCleanupItemReport {
                            item: item.clone(),
                            status: WorkCleanupItemStatus::Succeeded,
                            message: None,
                        });
                    }
                }
                Err(error) => {
                    for item in items {
                        reports.push(WorkCleanupItemReport {
                            item: item.clone(),
                            status: WorkCleanupItemStatus::Failed,
                            message: Some(error.to_string()),
                        });
                    }
                }
            }
        }

        for (handler_id, items) in &items_by_handler {
            if handled_handler_ids.contains(handler_id) {
                continue;
            }
            for item in items {
                reports.push(WorkCleanupItemReport {
                    item: item.clone(),
                    status: WorkCleanupItemStatus::Skipped,
                    message: Some(format!(
                        "No lifecycle hook handler registered for {}",
                        handler_id
                    )),
                });
            }
        }

        WorkCleanupReport {
            work_id: context.work.id.as_str().to_string(),
            items: reports,
        }
    }

    pub async fn notify_deleted(
        &self,
        context: &WorkLifecycleHookContext,
        report: WorkCleanupReport,
    ) {
        let hook = WorkLifecycleHookKind::Deleted { report };
        for handler in self.handlers.iter() {
            if !handler
                .phases()
                .contains(&WorkLifecycleHookPhase::AfterCommit)
            {
                continue;
            }
            if let Err(error) = handler.handle(context, &hook).await {
                log::warn!(
                    "Work delete lifecycle hook failed after commit: handler_id={} work_id={} error={}",
                    handler.id(),
                    context.work.id,
                    error
                );
            }
        }
    }
}

struct WorkSessionLifecycleHook;

const PLAN_AND_PREPARE_PHASES: &[WorkLifecycleHookPhase] = &[
    WorkLifecycleHookPhase::Plan,
    WorkLifecycleHookPhase::Prepare,
];

#[async_trait]
impl WorkLifecycleHookHandler for WorkSessionLifecycleHook {
    fn id(&self) -> &'static str {
        "work_session"
    }

    fn phases(&self) -> &'static [WorkLifecycleHookPhase] {
        PLAN_AND_PREPARE_PHASES
    }

    async fn handle(
        &self,
        context: &WorkLifecycleHookContext,
        hook: &WorkLifecycleHookKind,
    ) -> CoreResult<WorkLifecycleHookOutcome> {
        match hook {
            WorkLifecycleHookKind::DeleteRequested { options } => {
                let mut planned = Vec::new();
                for session_id in owned_work_session_ids(&context.work) {
                    planned.push(session_delete_item(
                        &context.work,
                        self.id(),
                        "work-session",
                        session_id,
                        WorkResourceOwnership::Owned,
                        true,
                    )?);
                }
                if options.delete_linked_sessions {
                    for session_id in linked_session_ids(&context.work) {
                        planned.push(session_delete_item(
                            &context.work,
                            self.id(),
                            "linked-session",
                            session_id,
                            WorkResourceOwnership::Linked,
                            false,
                        )?);
                    }
                }
                Ok(WorkLifecycleHookOutcome::CleanupPlan(planned))
            }
            WorkLifecycleHookKind::Deleting { plan } => {
                let mut reports = Vec::new();
                for item in &plan.items {
                    if item.action != WorkCleanupAction::Delete {
                        reports.push(WorkCleanupItemReport {
                            item: item.clone(),
                            status: WorkCleanupItemStatus::Skipped,
                            message: Some(
                                "Work session hook only handles delete actions".to_string(),
                            ),
                        });
                        continue;
                    }

                    let locator_json = item
                        .resource
                        .metadata
                        .get("session_locator")
                        .cloned()
                        .ok_or_else(|| {
                            CoreError::validation("session_locator is required for session cleanup")
                        })?;
                    let locator = serde_json::from_str(&locator_json).map_err(|error| {
                        CoreError::validation(format!(
                            "Invalid session_locator for cleanup: {error}"
                        ))
                    })?;
                    let result = context.runtime_bridge.delete_work_session(&locator).await;
                    reports.push(report_for_result(item, result));
                }
                Ok(WorkLifecycleHookOutcome::CleanupReport(reports))
            }
            WorkLifecycleHookKind::Deleted { .. } => Ok(WorkLifecycleHookOutcome::Continue),
        }
    }
}

struct ProductRuntimeStorageLifecycleHook;

#[async_trait]
impl WorkLifecycleHookHandler for ProductRuntimeStorageLifecycleHook {
    fn id(&self) -> &'static str {
        "product_runtime_storage"
    }

    fn phases(&self) -> &'static [WorkLifecycleHookPhase] {
        PLAN_AND_PREPARE_PHASES
    }

    async fn handle(
        &self,
        context: &WorkLifecycleHookContext,
        hook: &WorkLifecycleHookKind,
    ) -> CoreResult<WorkLifecycleHookOutcome> {
        match hook {
            WorkLifecycleHookKind::DeleteRequested { .. } => {
                if context.work.runtime_instances.is_empty() {
                    return Ok(WorkLifecycleHookOutcome::CleanupPlan(Vec::new()));
                }
                let runtime_instance_ids = context
                    .work
                    .runtime_instances
                    .iter()
                    .map(|instance| instance.id.as_str())
                    .collect::<Vec<_>>()
                    .join(",");
                let app_ids = context
                    .work
                    .runtime_instances
                    .iter()
                    .map(|instance| instance.app_id.as_str())
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect::<Vec<_>>()
                    .join(",");
                let mut metadata = BTreeMap::new();
                metadata.insert("runtime_instance_ids".to_string(), runtime_instance_ids);
                metadata.insert("app_ids".to_string(), app_ids);
                Ok(WorkLifecycleHookOutcome::CleanupPlan(vec![
                    WorkCleanupItem {
                        id: format!("product-runtime-storage:{}", context.work.id.as_str()),
                        handler_id: self.id().to_string(),
                        resource: WorkResourceRef {
                            kind: "product_runtime_storage".to_string(),
                            id: context.work.id.as_str().to_string(),
                            ownership: WorkResourceOwnership::Owned,
                            metadata,
                        },
                        action: WorkCleanupAction::Delete,
                        required: true,
                    },
                ]))
            }
            WorkLifecycleHookKind::Deleting { plan } => {
                let mut reports = Vec::new();
                for item in &plan.items {
                    let result = delete_work_runtime_storage(&context.work);
                    reports.push(report_for_result(item, result));
                }
                Ok(WorkLifecycleHookOutcome::CleanupReport(reports))
            }
            WorkLifecycleHookKind::Deleted { .. } => Ok(WorkLifecycleHookOutcome::Continue),
        }
    }
}

struct RetainedReferenceLifecycleHook;

#[async_trait]
impl WorkLifecycleHookHandler for RetainedReferenceLifecycleHook {
    fn id(&self) -> &'static str {
        "retained_reference"
    }

    fn phases(&self) -> &'static [WorkLifecycleHookPhase] {
        PLAN_AND_PREPARE_PHASES
    }

    async fn handle(
        &self,
        context: &WorkLifecycleHookContext,
        hook: &WorkLifecycleHookKind,
    ) -> CoreResult<WorkLifecycleHookOutcome> {
        match hook {
            WorkLifecycleHookKind::DeleteRequested { options } => {
                let mut planned = Vec::new();
                if !options.delete_linked_sessions {
                    for session_id in linked_session_ids(&context.work) {
                        planned.push(retain_item(
                            self.id(),
                            "linked-agent-session",
                            "agent_session",
                            session_id,
                            WorkResourceOwnership::Linked,
                        ));
                    }
                }
                for artifact in &context.work.artifact_refs {
                    planned.push(retain_item(
                        self.id(),
                        "artifact",
                        "artifact",
                        artifact.id.clone(),
                        WorkResourceOwnership::Linked,
                    ));
                }
                for memory in &context.work.memory_refs {
                    planned.push(retain_item(
                        self.id(),
                        "memory",
                        "memory",
                        memory.id.clone(),
                        WorkResourceOwnership::Linked,
                    ));
                }
                if !options.cascade_child_works {
                    for child_work_id in delegated_child_work_ids(&context.work) {
                        planned.push(retain_item(
                            self.id(),
                            "child-work",
                            "work",
                            child_work_id,
                            WorkResourceOwnership::Linked,
                        ));
                    }
                }
                Ok(WorkLifecycleHookOutcome::CleanupPlan(planned))
            }
            WorkLifecycleHookKind::Deleting { plan } => {
                let reports = plan
                    .items
                    .iter()
                    .map(|item| WorkCleanupItemReport {
                        item: item.clone(),
                        status: WorkCleanupItemStatus::Retained,
                        message: Some("Reference retained by default cleanup policy".to_string()),
                    })
                    .collect();
                Ok(WorkLifecycleHookOutcome::CleanupReport(reports))
            }
            WorkLifecycleHookKind::Deleted { .. } => Ok(WorkLifecycleHookOutcome::Continue),
        }
    }
}

fn owned_work_session_ids(work: &WorkRecord) -> Vec<String> {
    let mut ids = BTreeSet::new();
    for surface in &work.surfaces {
        if let WorkSurfaceRef::WorkSession { session_id } = surface {
            ids.insert(session_id.clone());
        }
    }
    if let WorkSurfaceRef::WorkSession { session_id } = &work.primary_surface {
        ids.insert(session_id.clone());
    }
    for session_ref in &work.session_refs {
        if matches!(
            session_ref.owner.as_ref(),
            Some(crate::agentic::core::SessionOwner::ProductApp { work_id, .. })
                if work_id == work.id.as_str()
        ) {
            ids.insert(session_ref.session_id.clone());
        }
    }
    ids.into_iter().collect()
}

fn linked_session_ids(work: &WorkRecord) -> Vec<String> {
    let owned = owned_work_session_ids(work)
        .into_iter()
        .collect::<BTreeSet<_>>();
    let mut ids = BTreeSet::new();
    for session_ref in &work.session_refs {
        if !owned.contains(&session_ref.session_id) {
            ids.insert(session_ref.session_id.clone());
        }
    }
    for surface in &work.surfaces {
        if let WorkSurfaceRef::AgentSession { session_id } = surface {
            if !owned.contains(session_id) {
                ids.insert(session_id.clone());
            }
        }
    }
    if let WorkSurfaceRef::AgentSession { session_id } = &work.primary_surface {
        if !owned.contains(session_id) {
            ids.insert(session_id.clone());
        }
    }
    ids.into_iter().collect()
}

fn delegated_child_work_ids(work: &WorkRecord) -> Vec<String> {
    let mut ids = BTreeSet::new();
    for binding in &work.execution_bindings {
        if let WorkExecutionSource::DelegatedWorkRun { child_work_id, .. } = &binding.source {
            ids.insert(child_work_id.as_str().to_string());
        }
    }
    ids.into_iter().collect()
}

fn session_delete_item(
    work: &WorkRecord,
    handler_id: &str,
    item_prefix: &str,
    session_id: String,
    ownership: WorkResourceOwnership,
    required: bool,
) -> CoreResult<WorkCleanupItem> {
    let locator = work
        .session_refs
        .iter()
        .find(|reference| reference.session_id == session_id)
        .and_then(|reference| reference.locator.clone())
        .ok_or_else(|| {
            CoreError::validation(format!(
                "SessionLocator is required for Work-linked session cleanup: {session_id}"
            ))
        })?;
    let mut metadata = BTreeMap::new();
    metadata.insert(
        "session_locator".to_string(),
        serde_json::to_string(&locator)?,
    );
    Ok(WorkCleanupItem {
        id: format!("{}:{}", item_prefix, session_id),
        handler_id: handler_id.to_string(),
        resource: WorkResourceRef {
            kind: "agent_session".to_string(),
            id: session_id,
            ownership,
            metadata,
        },
        action: WorkCleanupAction::Delete,
        required,
    })
}

fn delete_work_runtime_storage(work: &WorkRecord) -> CoreResult<()> {
    let path_manager = try_get_path_manager_arc()?;
    let app_ids = work
        .runtime_instances
        .iter()
        .map(|instance| instance.app_id.as_str())
        .collect::<BTreeSet<_>>();
    for app_id in app_ids {
        let app_root = match &work.scope {
            WorkScope::Global => path_manager.global_app_data_dir(app_id)?,
            WorkScope::Workspace { workspace_id } => {
                path_manager.workspace_app_data_dir(workspace_id, app_id)?
            }
        };
        let target = app_root.join("works").join(work.id.as_str());
        if !target.starts_with(&app_root) {
            return Err(CoreError::validation(format!(
                "Refusing to delete Product App data outside root: {}",
                target.display()
            )));
        }
        if target.exists() {
            std::fs::remove_dir_all(&target).map_err(|error| {
                CoreError::io(format!(
                    "Failed to delete Product App data {}: {}",
                    target.display(),
                    error
                ))
            })?;
        }
    }
    Ok(())
}

fn retain_item(
    handler_id: &str,
    item_prefix: &str,
    resource_kind: &str,
    resource_id: String,
    ownership: WorkResourceOwnership,
) -> WorkCleanupItem {
    WorkCleanupItem {
        id: format!("{}:{}", item_prefix, resource_id),
        handler_id: handler_id.to_string(),
        resource: WorkResourceRef {
            kind: resource_kind.to_string(),
            id: resource_id,
            ownership,
            metadata: BTreeMap::new(),
        },
        action: WorkCleanupAction::Retain,
        required: false,
    }
}

fn report_for_result(item: &WorkCleanupItem, result: CoreResult<()>) -> WorkCleanupItemReport {
    match result {
        Ok(()) => WorkCleanupItemReport {
            item: item.clone(),
            status: WorkCleanupItemStatus::Succeeded,
            message: None,
        },
        Err(error) => WorkCleanupItemReport {
            item: item.clone(),
            status: WorkCleanupItemStatus::Failed,
            message: Some(error.to_string()),
        },
    }
}
