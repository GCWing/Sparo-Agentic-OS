//! Revision capability grants.
//!
//! Grants are bound to an App identity and the stable fingerprint of a
//! release's capability manifest. A fork receives a new App identity and must
//! therefore be approved independently.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use tokio::fs;

use crate::error::{CoreError, CoreResult};
use crate::infrastructure::PathManager;

use super::state_io::{atomic_write_json, recover_atomic_json};
use super::{AppDefinition, ComponentDefinition};

const CAPABILITY_GRANT_SCHEMA_VERSION: u32 = 1;
static CAPABILITY_GRANT_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

/// Produces the exact, deterministic capability set represented by a resolved
/// App artifact. Approval UI and the runtime enforcement boundary must use the
/// same derivation so a client cannot under-report a Release's permissions.
pub fn required_app_capabilities(
    app: &AppDefinition,
    components: &[ComponentDefinition],
) -> Vec<String> {
    let mut capabilities = BTreeSet::new();
    for (name, enabled) in [
        ("filesystem", app.permissions.fs),
        ("network", app.permissions.net),
        ("shell", app.permissions.shell),
        ("gui", app.permissions.gui),
        ("secrets", app.permissions.secrets),
        ("ai", app.permissions.ai),
    ] {
        if enabled {
            capabilities.insert(name.to_string());
        }
    }
    capabilities.extend(
        app.os_capabilities
            .iter()
            .map(|capability| format!("os:{capability}")),
    );
    for component in components {
        for permission in &component.permissions {
            if permission.scopes.is_empty() {
                capabilities.insert(format!("component:{}:{}", component.id, permission.kind));
            } else {
                capabilities.extend(permission.scopes.iter().map(|scope| {
                    format!("component:{}:{}:{scope}", component.id, permission.kind)
                }));
            }
        }
        capabilities.extend(
            component
                .uses_capabilities
                .iter()
                .map(|capability| format!("component:{}:uses:{capability}", component.id)),
        );
    }
    capabilities.into_iter().collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityGrant {
    pub app_id: String,
    pub capability_fingerprint: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub approved_capabilities: Vec<String>,
    pub granted_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CapabilityGrantState {
    schema_version: u32,
    #[serde(default)]
    grants: BTreeMap<String, CapabilityGrant>,
}

impl Default for CapabilityGrantState {
    fn default() -> Self {
        Self {
            schema_version: CAPABILITY_GRANT_SCHEMA_VERSION,
            grants: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct CapabilityGrantStore {
    state_path: PathBuf,
}

impl CapabilityGrantStore {
    pub fn new(path_manager: &PathManager) -> Self {
        Self {
            state_path: path_manager
                .user_state_dir()
                .join("app_capability_grants.json"),
        }
    }

    pub(super) async fn approve(
        &self,
        app_id: &str,
        capability_fingerprint: &str,
        mut approved_capabilities: Vec<String>,
        granted_at_ms: u64,
    ) -> CoreResult<CapabilityGrant> {
        let _guard = CAPABILITY_GRANT_LOCK.lock().await;
        validate_identity("appId", app_id)?;
        validate_fingerprint(capability_fingerprint)?;
        approved_capabilities.sort();
        approved_capabilities.dedup();
        let grant = CapabilityGrant {
            app_id: app_id.to_string(),
            capability_fingerprint: capability_fingerprint.to_string(),
            approved_capabilities,
            granted_at_ms,
        };
        let mut state = self.load().await?;
        state
            .grants
            .insert(grant_key(app_id, capability_fingerprint), grant.clone());
        self.save(&state).await?;
        Ok(grant)
    }

    /// Returns true only when the immutable Release fingerprint and the exact
    /// capability set are both covered by the persisted user grant.
    pub async fn is_approved_for_capabilities(
        &self,
        app_id: &str,
        capability_fingerprint: &str,
        mut required_capabilities: Vec<String>,
    ) -> CoreResult<bool> {
        let _guard = CAPABILITY_GRANT_LOCK.lock().await;
        validate_identity("appId", app_id)?;
        validate_fingerprint(capability_fingerprint)?;
        required_capabilities.sort();
        required_capabilities.dedup();
        let state = self.load().await?;
        Ok(state
            .grants
            .get(&grant_key(app_id, capability_fingerprint))
            .is_some_and(|grant| grant.approved_capabilities == required_capabilities))
    }

    pub async fn revoke_app(&self, app_id: &str) -> CoreResult<usize> {
        let _guard = CAPABILITY_GRANT_LOCK.lock().await;
        validate_identity("appId", app_id)?;
        let mut state = self.load().await?;
        let before = state.grants.len();
        state.grants.retain(|_, grant| grant.app_id != app_id);
        let removed = before.saturating_sub(state.grants.len());
        if removed > 0 {
            self.save(&state).await?;
        }
        Ok(removed)
    }

    pub async fn list_for_app(&self, app_id: &str) -> CoreResult<Vec<CapabilityGrant>> {
        let _guard = CAPABILITY_GRANT_LOCK.lock().await;
        validate_identity("appId", app_id)?;
        let state = self.load().await?;
        Ok(state
            .grants
            .into_values()
            .filter(|grant| grant.app_id == app_id)
            .collect())
    }

    async fn load(&self) -> CoreResult<CapabilityGrantState> {
        recover_atomic_json(&self.state_path).await?;
        match fs::read(&self.state_path).await {
            Ok(bytes) => {
                let state: CapabilityGrantState = serde_json::from_slice(&bytes)?;
                if state.schema_version != CAPABILITY_GRANT_SCHEMA_VERSION {
                    return Err(CoreError::validation(format!(
                        "Unsupported capability grant state schema: {}",
                        state.schema_version
                    )));
                }
                Ok(state)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(CapabilityGrantState::default())
            }
            Err(error) => Err(error.into()),
        }
    }

    async fn save(&self, state: &CapabilityGrantState) -> CoreResult<()> {
        atomic_write_json(&self.state_path, state).await
    }
}

fn grant_key(app_id: &str, capability_fingerprint: &str) -> String {
    format!("{app_id}@{capability_fingerprint}")
}

fn validate_identity(label: &str, value: &str) -> CoreResult<()> {
    let value = value.trim();
    if value.is_empty()
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(CoreError::validation(format!(
            "{label} must contain only ASCII letters, numbers, '-' or '_'."
        )));
    }
    Ok(())
}

fn validate_fingerprint(value: &str) -> CoreResult<()> {
    let value = value.trim();
    if value.len() < 16
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, ':' | '-'))
    {
        return Err(CoreError::validation(
            "capabilityFingerprint must be a stable digest.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, CapabilityGrantStore) {
        let temp = tempfile::tempdir().expect("temp dir");
        let state_path = temp.path().join("state").join("grants.json");
        (temp, CapabilityGrantStore { state_path })
    }

    #[tokio::test]
    async fn identical_manifest_can_reuse_a_grant_but_a_new_fingerprint_cannot() {
        let (_temp, store) = store();
        store
            .approve(
                "my-app",
                "sha256:aaaaaaaaaaaaaaaa",
                vec!["filesystem.read".to_string()],
                1,
            )
            .await
            .expect("approve grant");

        assert!(store
            .is_approved_for_capabilities(
                "my-app",
                "sha256:aaaaaaaaaaaaaaaa",
                vec!["filesystem.read".to_string()],
            )
            .await
            .expect("same manifest"));
        assert!(!store
            .is_approved_for_capabilities(
                "my-app",
                "sha256:bbbbbbbbbbbbbbbb",
                vec!["filesystem.read".to_string()],
            )
            .await
            .expect("changed manifest"));
        assert!(!store
            .is_approved_for_capabilities(
                "forked-app",
                "sha256:aaaaaaaaaaaaaaaa",
                vec!["filesystem.read".to_string()],
            )
            .await
            .expect("fork has independent identity"));
    }

    #[tokio::test]
    async fn revoking_an_app_removes_every_manifest_grant() {
        let (_temp, store) = store();
        for fingerprint in ["sha256:aaaaaaaaaaaaaaaa", "sha256:bbbbbbbbbbbbbbbb"] {
            store
                .approve("my-app", fingerprint, Vec::new(), 1)
                .await
                .expect("approve grant");
        }

        assert_eq!(store.revoke_app("my-app").await.expect("revoke"), 2);
        assert!(store.list_for_app("my-app").await.expect("list").is_empty());
    }

    #[tokio::test]
    async fn approval_requires_the_exact_capability_set() {
        let (_temp, store) = store();
        store
            .approve(
                "my-app",
                "sha256:aaaaaaaaaaaaaaaa",
                vec!["network".to_string(), "filesystem".to_string()],
                1,
            )
            .await
            .expect("approve grant");

        assert!(store
            .is_approved_for_capabilities(
                "my-app",
                "sha256:aaaaaaaaaaaaaaaa",
                vec!["filesystem".to_string(), "network".to_string()],
            )
            .await
            .expect("exact grant"));
        assert!(!store
            .is_approved_for_capabilities(
                "my-app",
                "sha256:aaaaaaaaaaaaaaaa",
                vec!["filesystem".to_string()],
            )
            .await
            .expect("partial grant"));
    }
}
