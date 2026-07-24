use super::PersistenceManager;
use crate::agentic::core::{SessionDomain, SessionLocator};
use crate::error::CoreResult;
use dashmap::{DashMap, DashSet};
use log::info;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionWorkspaceMaintenanceReport {
    pub scanned_sessions: usize,
    pub hidden_sessions: usize,
    pub deleted_sessions: usize,
    pub skipped: bool,
}

pub struct SessionWorkspaceMaintenanceService {
    persistence_manager: Arc<PersistenceManager>,
    cleaned_domains: DashSet<SessionDomain>,
    domain_locks: DashMap<SessionDomain, Arc<Mutex<()>>>,
}

impl SessionWorkspaceMaintenanceService {
    pub fn new(persistence_manager: Arc<PersistenceManager>) -> Self {
        Self {
            persistence_manager,
            cleaned_domains: DashSet::new(),
            domain_locks: DashMap::new(),
        }
    }

    pub async fn ensure_domain_maintained(
        &self,
        domain: &SessionDomain,
    ) -> CoreResult<SessionWorkspaceMaintenanceReport> {
        if self.cleaned_domains.contains(domain) {
            return Ok(SessionWorkspaceMaintenanceReport {
                skipped: true,
                ..Default::default()
            });
        }

        let domain_lock = self
            .domain_locks
            .entry(domain.clone())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone();
        let _guard = domain_lock.lock().await;

        if self.cleaned_domains.contains(domain) {
            return Ok(SessionWorkspaceMaintenanceReport {
                skipped: true,
                ..Default::default()
            });
        }

        let report = self.run_domain_maintenance(domain).await?;
        self.cleaned_domains.insert(domain.clone());

        Ok(report)
    }

    async fn run_domain_maintenance(
        &self,
        domain: &SessionDomain,
    ) -> CoreResult<SessionWorkspaceMaintenanceReport> {
        let all_metadata = self
            .persistence_manager
            .list_session_metadata_including_internal(domain)
            .await?;
        let hidden_sessions = all_metadata
            .iter()
            .filter(|metadata| metadata.should_hide_from_user_lists())
            .count();
        let deletable_session_ids = all_metadata
            .iter()
            .filter(|metadata| metadata.should_delete_during_hidden_session_maintenance())
            .map(|metadata| metadata.session_id.clone())
            .collect::<Vec<_>>();

        let mut report = SessionWorkspaceMaintenanceReport {
            scanned_sessions: all_metadata.len(),
            hidden_sessions,
            deleted_sessions: 0,
            skipped: false,
        };

        for session_id in deletable_session_ids {
            self.persistence_manager
                .delete_session(&SessionLocator {
                    domain: domain.clone(),
                    session_id,
                })
                .await?;
            report.deleted_sessions += 1;
        }

        if report.deleted_sessions > 0 {
            info!(
                "Session domain maintenance removed hidden sessions: domain={:?}, scanned_sessions={}, hidden_sessions={}, deleted_sessions={}",
                domain,
                report.scanned_sessions,
                report.hidden_sessions,
                report.deleted_sessions
            );
        }

        Ok(report)
    }
}

// Superseded by typed-locator session maintenance contract tests.
#[cfg(any())]
mod tests {
    use super::SessionWorkspaceMaintenanceService;
    use crate::agentic::core::SessionKind;
    use crate::agentic::persistence::PersistenceManager;
    use crate::infrastructure::PathManager;
    use crate::service::session::{SessionMetadata, SETTINGS_FLOW_RUNTIME_SESSION_CREATOR};
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use uuid::Uuid;

    struct TestWorkspace {
        root: PathBuf,
        path: PathBuf,
    }

    impl TestWorkspace {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!("sparo-session-maintenance-test-{}", Uuid::new_v4()));
            let path = root.join("workspace");
            std::fs::create_dir_all(&path).expect("test workspace should be created");
            Self { root, path }
        }

        fn path(&self) -> &Path {
            &self.path
        }

        fn path_manager(&self) -> Arc<PathManager> {
            Arc::new(PathManager::with_user_root_for_tests(
                self.root.join("config"),
            ))
        }
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[tokio::test]
    async fn workspace_maintenance_removes_hidden_sessions_once() {
        let workspace = TestWorkspace::new();
        let persistence_manager = Arc::new(
            PersistenceManager::new(workspace.path_manager()).expect("persistence manager"),
        );
        let maintenance = SessionWorkspaceMaintenanceService::new(persistence_manager.clone());

        let visible = SessionMetadata::new(
            Uuid::new_v4().to_string(),
            "Visible Session".to_string(),
            "agent".to_string(),
            "model".to_string(),
        );

        let mut legacy_hidden = SessionMetadata::new(
            Uuid::new_v4().to_string(),
            "Subagent: stale task".to_string(),
            "agent".to_string(),
            "model".to_string(),
        );
        legacy_hidden.created_by = Some("session-parent".to_string());

        let mut subagent_hidden = SessionMetadata::new(
            Uuid::new_v4().to_string(),
            "Subagent: fresh task".to_string(),
            "agent".to_string(),
            "model".to_string(),
        );
        subagent_hidden.session_kind = SessionKind::Subagent;

        let mut durable_internal = SessionMetadata::new(
            Uuid::new_v4().to_string(),
            "Settings".to_string(),
            "SettingsAgent".to_string(),
            "primary".to_string(),
        );
        durable_internal.session_kind = SessionKind::Internal;

        let mut expired_internal = SessionMetadata::new(
            Uuid::new_v4().to_string(),
            "Expired Settings".to_string(),
            "SettingsAgent".to_string(),
            "primary".to_string(),
        );
        expired_internal.session_kind = SessionKind::Internal;
        expired_internal.last_active_at = 0;

        let mut lifecycle_internal = SessionMetadata::new(
            Uuid::new_v4().to_string(),
            "Lifecycle Settings".to_string(),
            "SettingsAgent".to_string(),
            "primary".to_string(),
        );
        lifecycle_internal.session_kind = SessionKind::Internal;
        lifecycle_internal.created_by = Some(SETTINGS_FLOW_RUNTIME_SESSION_CREATOR.to_string());
        lifecycle_internal.last_active_at = 0;

        for metadata in [
            &visible,
            &legacy_hidden,
            &subagent_hidden,
            &durable_internal,
            &expired_internal,
            &lifecycle_internal,
        ] {
            persistence_manager
                .save_session_metadata(workspace.path(), metadata)
                .await
                .expect("metadata should save");
        }

        let first_report = maintenance
            .ensure_workspace_maintained(workspace.path())
            .await
            .expect("maintenance should succeed");

        assert_eq!(first_report.scanned_sessions, 6);
        assert_eq!(first_report.hidden_sessions, 5);
        assert_eq!(first_report.deleted_sessions, 3);
        assert!(!first_report.skipped);

        let raw_after_cleanup = persistence_manager
            .list_session_metadata_including_internal(workspace.path())
            .await
            .expect("raw metadata should load");
        assert_eq!(raw_after_cleanup.len(), 3);
        assert!(raw_after_cleanup
            .iter()
            .any(|metadata| metadata.session_id == visible.session_id));
        assert!(raw_after_cleanup
            .iter()
            .any(|metadata| metadata.session_id == durable_internal.session_id));
        assert!(raw_after_cleanup
            .iter()
            .any(|metadata| metadata.session_id == lifecycle_internal.session_id));

        let visible_after_cleanup = persistence_manager
            .list_session_metadata(workspace.path())
            .await
            .expect("visible metadata should load");
        assert_eq!(visible_after_cleanup.len(), 1);
        assert_eq!(visible_after_cleanup[0].session_id, visible.session_id);

        let second_report = maintenance
            .ensure_workspace_maintained(workspace.path())
            .await
            .expect("second maintenance should succeed");
        assert!(second_report.skipped);
        assert_eq!(second_report.deleted_sessions, 0);
    }
}
