//! Product App session-history ownership and storage resolution.

use crate::agentic::core::{
    ProductAppSessionChannel, ProductAppSessionRole, SessionDomain, SessionLocator, SessionOwner,
};
use crate::agentic_os::work::{WorkId, WorkRecord, WorkScope};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::PathManager;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProductAppSessionBinding {
    pub owner: SessionOwner,
    pub locator: SessionLocator,
    pub execution_workspace_path: String,
}

pub struct ProductAppSessionResolver;

impl ProductAppSessionResolver {
    pub fn domain_for_work(
        _path_manager: &PathManager,
        work: &WorkRecord,
    ) -> CoreResult<SessionDomain> {
        match &work.scope {
            WorkScope::Workspace { workspace_id } => Ok(SessionDomain::Workspace {
                workspace_id: workspace_id.clone(),
            }),
            WorkScope::Global => Ok(SessionDomain::Global),
        }
    }

    pub fn binding_for_work(
        path_manager: &PathManager,
        work: &WorkRecord,
        app_id: &str,
        session_id: impl Into<String>,
        channel: ProductAppSessionChannel,
        role: ProductAppSessionRole,
    ) -> CoreResult<ProductAppSessionBinding> {
        let app_id = app_id.trim();
        if app_id.is_empty() {
            return Err(CoreError::validation("app_id is required".to_string()));
        }
        let domain = Self::domain_for_work(path_manager, work)?;
        let execution_workspace_path = match &work.scope {
            WorkScope::Workspace { .. } => work.workspace_path.clone().ok_or_else(|| {
                CoreError::validation("workspace_path is required for Workspace Work")
            })?,
            WorkScope::Global => path_manager
                .global_app_data_dir(app_id)?
                .join("works")
                .join(work.id.as_str())
                .to_string_lossy()
                .into_owned(),
        };
        let work_id = work.id.to_string();
        let session_id = session_id.into();
        Ok(ProductAppSessionBinding {
            owner: SessionOwner::ProductApp {
                app_id: app_id.to_string(),
                work_id,
                channel,
                role,
            },
            locator: SessionLocator { domain, session_id },
            execution_workspace_path,
        })
    }

    pub fn require_work_id(value: &str) -> CoreResult<WorkId> {
        WorkId::parse(value.to_string()).map_err(CoreError::validation)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agentic_os::work::{WorkKind, WorkSubject, WorkSurfaceRef, WorkVisibility};

    fn work(scope: WorkScope) -> WorkRecord {
        WorkRecord::new(
            WorkId::generate(),
            WorkKind::AppWorkflow,
            "App".to_string(),
            "Use app".to_string(),
            WorkVisibility::Primary,
            WorkSubject::Goal,
            Vec::new(),
            scope,
            WorkSurfaceRef::OsAgentHome {
                agentic_os_session_id: None,
            },
            1,
        )
    }

    #[test]
    fn workspace_work_resolves_to_workspace_domain() {
        let path_manager =
            PathManager::with_user_root_for_tests(std::env::temp_dir().join("session-domain-test"));
        let mut work = work(WorkScope::Workspace {
            workspace_id: "ws_demo".to_string(),
        });
        work.workspace_path = Some("D:/workspace/demo".to_string());
        assert!(matches!(
            ProductAppSessionResolver::domain_for_work(&path_manager, &work).unwrap(),
            SessionDomain::Workspace { .. }
        ));
    }

    #[test]
    fn system_work_resolves_to_global_domain() {
        let path_manager =
            PathManager::with_user_root_for_tests(std::env::temp_dir().join("session-domain-test"));
        let work = work(WorkScope::Global);
        assert_eq!(
            ProductAppSessionResolver::domain_for_work(&path_manager, &work).unwrap(),
            SessionDomain::Global
        );
    }
}
