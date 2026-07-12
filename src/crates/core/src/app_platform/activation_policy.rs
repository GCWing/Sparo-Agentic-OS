//! Authoritative activation authorization for immutable Intelligent App Releases.
//!
//! All cross-crate activation and rollback flows pass through this policy. The
//! revision store only owns atomic registry mutation and deliberately exposes
//! no raw activation primitive outside `app_platform`.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, CoreResult};
use crate::infrastructure::PathManager;

use super::capability_grants::{required_app_capabilities, CapabilityGrant, CapabilityGrantStore};
use super::draft_package::validate_release_evaluation;
use super::resolver::ProductAppResolver;
use super::revision_store::{
    ActivateReleaseRequest, ActivationRecord, AppActivationScope, AppOwnerKind, AppRecord,
    AppRevisionStore, ReleaseProvenanceKind, ReleaseRecord,
};
use super::system_apps::list_system_shared_components;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppReleaseCapabilityReview {
    pub app_id: String,
    pub release_id: String,
    pub capability_fingerprint: String,
    pub capabilities: Vec<String>,
    pub approved: bool,
    pub requires_approval: bool,
}

/// Single policy boundary for Release review, consent, activation, and rollback.
pub struct AppActivationPolicy<'a> {
    revision_store: &'a AppRevisionStore,
    path_manager: &'a PathManager,
}

impl<'a> AppActivationPolicy<'a> {
    pub fn new(revision_store: &'a AppRevisionStore, path_manager: &'a PathManager) -> Self {
        Self {
            revision_store,
            path_manager,
        }
    }

    pub async fn review_release(
        &self,
        scope: &AppActivationScope,
        app_id: &str,
        release_id: &str,
    ) -> CoreResult<AppReleaseCapabilityReview> {
        self.review_release_with_anchor(scope, app_id, release_id)
            .await
            .map(|(review, _)| review)
    }

    async fn review_release_with_anchor(
        &self,
        scope: &AppActivationScope,
        app_id: &str,
        release_id: &str,
    ) -> CoreResult<(AppReleaseCapabilityReview, Option<ActivationRecord>)> {
        scope.validate()?;
        let app = self
            .revision_store
            .get_app(app_id)
            .await
            .ok_or_else(|| CoreError::NotFound(format!("Intelligent App {app_id}")))?;
        let resolved = self
            .revision_store
            .resolve_release(app_id, release_id)
            .await?;
        self.revision_store
            .verify_release_artifact(release_id)
            .await?;
        if resolved.release.provenance != ReleaseProvenanceKind::System {
            validate_release_evaluation(
                &resolved.artifact_path,
                &resolved.release.evaluation_report_digest,
            )
            .await?;
        }

        let shared_components = list_system_shared_components(self.path_manager).await?;
        let package = ProductAppResolver::resolve_package_runtime(
            &resolved.artifact_path,
            &shared_components,
        )
        .await?;
        if package.app.id != app.app_id {
            return Err(CoreError::validation(format!(
                "Release {release_id} artifact belongs to app {}, expected {}",
                package.app.id, app.app_id
            )));
        }
        if package.lock.permission_digest != resolved.release.capability_fingerprint {
            return Err(CoreError::validation(format!(
                "Release {release_id} capability fingerprint does not match its immutable artifact"
            )));
        }

        let capabilities = required_app_capabilities(&package.app, &package.components);
        let activation_anchor = self
            .revision_store
            .get_effective_activation(scope, &app.slot_id)
            .await;
        let trusted_system_release = self
            .system_release_implicitly_trusted(activation_anchor.as_ref(), &app, &resolved.release)
            .await;
        let approved = capabilities.is_empty()
            || trusted_system_release
            || CapabilityGrantStore::new(self.path_manager)
                .is_approved_for_capabilities(
                    app_id,
                    &resolved.release.capability_fingerprint,
                    capabilities.clone(),
                )
                .await?;

        Ok((
            AppReleaseCapabilityReview {
                app_id: app_id.to_string(),
                release_id: release_id.to_string(),
                capability_fingerprint: resolved.release.capability_fingerprint,
                requires_approval: !capabilities.is_empty() && !approved,
                capabilities,
                approved,
            },
            activation_anchor,
        ))
    }

    /// Persists consent for exactly the immutable capability manifest derived
    /// by this policy. Callers cannot submit either a fingerprint or a subset.
    pub async fn approve_release(
        &self,
        scope: &AppActivationScope,
        app_id: &str,
        release_id: &str,
    ) -> CoreResult<CapabilityGrant> {
        let review = self.review_release(scope, app_id, release_id).await?;
        CapabilityGrantStore::new(self.path_manager)
            .approve(
                &review.app_id,
                &review.capability_fingerprint,
                review.capabilities,
                trusted_now_ms()?,
            )
            .await
    }

    pub async fn activate(&self, request: ActivateReleaseRequest) -> CoreResult<ActivationRecord> {
        let (review, activation_anchor) = self
            .review_release_with_anchor(&request.scope, &request.app_id, &request.release_id)
            .await?;
        require_approval(&review)?;
        self.revision_store
            .activate_if_current(request, activation_anchor.as_ref())
            .await
    }

    pub async fn rollback(
        &self,
        scope: &AppActivationScope,
        slot_id: &str,
    ) -> CoreResult<ActivationRecord> {
        let current = self
            .revision_store
            .get_effective_activation(scope, slot_id)
            .await
            .ok_or_else(|| CoreError::NotFound(format!("App activation for slot {slot_id}")))?;
        self.rollback_if_current(scope, slot_id, &current.active_release_id)
            .await
    }

    /// Reviews the exact rollback target, then commits only if the active
    /// Release still matches `expected_active_release_id`.
    pub async fn rollback_if_current(
        &self,
        scope: &AppActivationScope,
        slot_id: &str,
        expected_active_release_id: &str,
    ) -> CoreResult<ActivationRecord> {
        let activation = self
            .revision_store
            .get_effective_activation(scope, slot_id)
            .await
            .ok_or_else(|| CoreError::NotFound(format!("App activation for slot {slot_id}")))?;
        if activation.active_release_id != expected_active_release_id {
            return Err(CoreError::validation(format!(
                "App activation for slot {slot_id} changed before rollback: expected active Release {expected_active_release_id}, found {}",
                activation.active_release_id
            )));
        }
        let previous_release_id = activation.previous_release_id.as_deref().ok_or_else(|| {
            CoreError::validation(format!(
                "App activation for slot {slot_id} has no rollback Release"
            ))
        })?;
        let previous_release = self
            .revision_store
            .list_releases(None)
            .await
            .into_iter()
            .find(|release| release.release_id == previous_release_id)
            .ok_or_else(|| {
                CoreError::NotFound(format!("Rollback app release {previous_release_id}"))
            })?;
        let review = self
            .review_release(
                scope,
                &previous_release.app_id,
                &previous_release.release_id,
            )
            .await?;
        require_approval(&review)?;
        self.revision_store
            .rollback_activation_if_current(scope, slot_id, expected_active_release_id)
            .await
    }

    async fn system_release_implicitly_trusted(
        &self,
        activation: Option<&ActivationRecord>,
        app: &AppRecord,
        candidate: &ReleaseRecord,
    ) -> bool {
        if app.owner.kind != AppOwnerKind::System
            || candidate.provenance != ReleaseProvenanceKind::System
        {
            return false;
        }
        let Some(activation) = activation else {
            return false;
        };
        let trusted_release_ids = [
            Some(activation.active_release_id.as_str()),
            activation.previous_release_id.as_deref(),
        ];
        if trusted_release_ids
            .iter()
            .flatten()
            .any(|trusted_release_id| *trusted_release_id == candidate.release_id)
        {
            return true;
        }
        self.revision_store
            .list_releases(Some(&app.app_id))
            .await
            .into_iter()
            .filter(|release| {
                trusted_release_ids
                    .iter()
                    .flatten()
                    .any(|trusted_release_id| *trusted_release_id == release.release_id)
            })
            .any(|release| {
                release.provenance == ReleaseProvenanceKind::System
                    && release.capability_fingerprint == candidate.capability_fingerprint
            })
    }
}

fn require_approval(review: &AppReleaseCapabilityReview) -> CoreResult<()> {
    if review.requires_approval {
        return Err(CoreError::validation(format!(
            "Capability approval required for app {} fingerprint {}: {}",
            review.app_id,
            review.capability_fingerprint,
            review.capabilities.join(", ")
        )));
    }
    Ok(())
}

fn trusted_now_ms() -> CoreResult<u64> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| {
            CoreError::service(format!("System clock is before Unix epoch: {error}"))
        })?;
    Ok(duration.as_millis().min(u128::from(u64::MAX)) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_platform::{
        seed_system_app_releases, AppOwner, ForkReleaseRequest, PublishDraftRequest,
    };
    use crate::infrastructure::PathManager;

    #[tokio::test]
    async fn activation_and_rollback_require_the_exact_release_grant() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path_manager = PathManager::with_user_root_for_tests(temp.path().join("app-state"));
        let store = AppRevisionStore::open(path_manager.app_root())
            .await
            .expect("revision store");
        seed_system_app_releases(&path_manager, &store)
            .await
            .expect("seed system releases");
        let official = store
            .get_active(&AppActivationScope::System, "runno")
            .await
            .expect("official activation");
        let shared_components = list_system_shared_components(&path_manager)
            .await
            .expect("shared components");

        let first = store
            .fork_release(ForkReleaseRequest {
                source_release_id: official.active_release_id.clone(),
                new_app_id: Some("user-runno-first".to_string()),
                slot_id: Some("runno".to_string()),
                display_name: Some("First Runno".to_string()),
                description: None,
                owner: AppOwner::user("local-user"),
            })
            .await
            .expect("fork first app");
        let first_release = store
            .publish_draft(
                PublishDraftRequest {
                    draft_id: first.draft.draft_id,
                    version: "1.0.1".to_string(),
                    label: None,
                    notes: None,
                    provenance: ReleaseProvenanceKind::User,
                },
                &shared_components,
            )
            .await
            .expect("publish first release");

        let policy = AppActivationPolicy::new(&store, &path_manager);
        let request = ActivateReleaseRequest {
            scope: AppActivationScope::System,
            slot_id: "runno".to_string(),
            app_id: first.app.app_id.clone(),
            release_id: first_release.release_id.clone(),
        };
        let review = policy
            .review_release(&request.scope, &request.app_id, &request.release_id)
            .await
            .expect("review first release");
        assert!(review.requires_approval);
        assert!(!review.capabilities.is_empty());
        let error = policy
            .activate(request.clone())
            .await
            .expect_err("unapproved release must not activate");
        assert!(error.to_string().contains("Capability approval required"));
        policy
            .approve_release(&request.scope, &request.app_id, &request.release_id)
            .await
            .expect("approve first release");
        policy
            .activate(request)
            .await
            .expect("activate first release");

        let second = store
            .fork_release(ForkReleaseRequest {
                source_release_id: official.active_release_id,
                new_app_id: Some("user-runno-second".to_string()),
                slot_id: Some("runno".to_string()),
                display_name: Some("Second Runno".to_string()),
                description: None,
                owner: AppOwner::user("local-user"),
            })
            .await
            .expect("fork second app");
        let second_release = store
            .publish_draft(
                PublishDraftRequest {
                    draft_id: second.draft.draft_id,
                    version: "1.0.1".to_string(),
                    label: None,
                    notes: None,
                    provenance: ReleaseProvenanceKind::User,
                },
                &shared_components,
            )
            .await
            .expect("publish second release");
        policy
            .approve_release(
                &AppActivationScope::System,
                &second.app.app_id,
                &second_release.release_id,
            )
            .await
            .expect("approve second release");
        policy
            .activate(ActivateReleaseRequest {
                scope: AppActivationScope::System,
                slot_id: "runno".to_string(),
                app_id: second.app.app_id,
                release_id: second_release.release_id.clone(),
            })
            .await
            .expect("activate second release");

        CapabilityGrantStore::new(&path_manager)
            .revoke_app(&first.app.app_id)
            .await
            .expect("revoke first release grant");
        let error = policy
            .rollback_if_current(
                &AppActivationScope::System,
                "runno",
                &second_release.release_id,
            )
            .await
            .expect_err("rollback target must be re-authorized");
        assert!(error.to_string().contains("Capability approval required"));

        policy
            .approve_release(
                &AppActivationScope::System,
                &first.app.app_id,
                &first_release.release_id,
            )
            .await
            .expect("reapprove rollback target");
        let rolled_back = policy
            .rollback_if_current(
                &AppActivationScope::System,
                "runno",
                &second_release.release_id,
            )
            .await
            .expect("authorized rollback");
        assert_eq!(rolled_back.active_release_id, first_release.release_id);
    }
}
