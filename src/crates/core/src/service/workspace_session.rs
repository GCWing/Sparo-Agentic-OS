//! Local workspace session identity and stable path helpers (session storage under the real workspace root).

use dunce::canonicalize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Host label for **local disk** workspaces in logical keys (`{host}:{path}`).
pub const LOCAL_WORKSPACE_SCOPE_HOST: &str = "localhost";

/// Workspace identity for session persistence (local roots only).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct WorkspaceSessionIdentity {
    pub hostname: String,
    /// Canonical local root used as the logical workspace path.
    pub logical_workspace_path: String,
}

impl WorkspaceSessionIdentity {
    pub fn logical_workspace_path(&self) -> &str {
        &self.logical_workspace_path
    }

    pub fn session_storage_path(&self) -> PathBuf {
        PathBuf::from(&self.logical_workspace_path)
    }
}

pub fn workspace_session_identity(workspace_path: &str) -> Option<WorkspaceSessionIdentity> {
    let local_root =
        normalize_local_workspace_root_for_stable_id(Path::new(workspace_path)).ok()?;
    Some(WorkspaceSessionIdentity {
        hostname: LOCAL_WORKSPACE_SCOPE_HOST.to_string(),
        logical_workspace_path: local_root,
    })
}

/// Normalize a path string for stable comparisons (slashes, no duplicate `//`, trim trailing `/` except root).
pub fn normalize_posix_style_path(path: &str) -> String {
    let mut s = path.replace('\\', "/");
    while s.contains("//") {
        s = s.replace("//", "/");
    }
    if s == "/" {
        return s;
    }
    s.trim_end_matches('/').to_string()
}

fn hash_host_and_root(host: &str, root_norm: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(host.trim().to_lowercase().as_bytes());
    hasher.update(b"\n");
    hasher.update(root_norm.as_bytes());
    hex::encode(&hasher.finalize()[..16])
}

/// Stable storage id for a **local** workspace (`localhost` + canonical absolute root).
pub fn local_workspace_stable_storage_id(canonical_root_norm: &str) -> String {
    format!(
        "local_{}",
        hash_host_and_root(LOCAL_WORKSPACE_SCOPE_HOST, canonical_root_norm)
    )
}

/// Canonical local root [`PathBuf`] plus normalized string form (single `canonicalize` call).
pub fn canonicalize_local_workspace_root(path: &Path) -> Result<(PathBuf, String), String> {
    let pb = canonicalize(path).map_err(|e| {
        format!(
            "Failed to canonicalize local workspace path '{}': {}",
            path.display(),
            e
        )
    })?;
    let s = path_buf_to_stable_local_root_string(&pb);
    Ok((pb, s))
}

/// Canonical absolute local path as a stable UTF-8 string (forward slashes, dunce-simplified).
pub fn normalize_local_workspace_root_for_stable_id(path: &Path) -> Result<String, String> {
    Ok(canonicalize_local_workspace_root(path)?.1)
}

fn path_buf_to_stable_local_root_string(canonical: &Path) -> String {
    canonical.to_string_lossy().replace('\\', "/")
}

/// Whether two local paths refer to the same workspace root (canonical comparison when possible).
pub fn local_workspace_roots_equal(a: &Path, b: &Path) -> bool {
    match (
        normalize_local_workspace_root_for_stable_id(a),
        normalize_local_workspace_root_for_stable_id(b),
    ) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// Human-readable logical key: `{host}:{normalized_absolute_root}` (for logs / UI; not a directory name).
pub fn workspace_logical_key(host: &str, root_norm: &str) -> String {
    format!("{}:{}", host.trim(), root_norm)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_posix_collapses_slashes_and_backslashes() {
        assert_eq!(
            normalize_posix_style_path(r"\\home\\user\\repo//src"),
            "/home/user/repo/src"
        );
    }

    #[test]
    fn normalize_posix_root_unchanged() {
        assert_eq!(normalize_posix_style_path("/"), "/");
        assert_eq!(normalize_posix_style_path("///"), "/");
    }

    #[test]
    fn normalize_posix_trims_trailing_slash() {
        assert_eq!(
            normalize_posix_style_path("/home/user/repo/"),
            "/home/user/repo"
        );
    }

    #[test]
    fn local_stable_id_is_deterministic_and_prefixed() {
        let id1 = local_workspace_stable_storage_id("/Users/foo/BitFun");
        let id2 = local_workspace_stable_storage_id("/Users/foo/BitFun");
        assert_eq!(id1, id2);
        assert!(id1.starts_with("local_"));
        assert_eq!(id1.len(), 6 + 32);
    }

    #[test]
    fn workspace_logical_key_joins_host_and_path() {
        assert_eq!(
            workspace_logical_key("localhost", "/Users/p/w"),
            "localhost:/Users/p/w"
        );
    }

    #[test]
    fn local_workspace_session_identity_uses_workspace_root_for_storage() {
        let workspace_root = std::env::temp_dir().join(format!(
            "bitfun-workspace-identity-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&workspace_root).expect("workspace should exist");

        let identity = workspace_session_identity(&workspace_root.to_string_lossy())
            .expect("local identity should resolve");

        assert_eq!(identity.hostname, LOCAL_WORKSPACE_SCOPE_HOST);
        assert_eq!(
            identity.session_storage_path(),
            PathBuf::from(identity.logical_workspace_path())
        );

        let _ = std::fs::remove_dir_all(workspace_root);
    }
}
