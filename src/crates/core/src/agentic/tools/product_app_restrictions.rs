use super::{ToolPathPolicy, ToolRuntimeRestrictions};
use crate::agentic::product_app_context::ProductAppExecutionContext;
use serde_json::Value;
use std::path::{Component, Path, PathBuf};

fn safe_id(value: &str) -> String {
    let normalized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();
    if normalized.is_empty() {
        "default".to_string()
    } else {
        normalized
    }
}

fn relative_path(value: &str) -> Option<PathBuf> {
    let path = Path::new(value.trim());
    if value.trim().is_empty() || path.is_absolute() {
        return None;
    }
    if value.trim() == "." {
        return Some(PathBuf::new());
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => normalized.push(segment),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    (!normalized.as_os_str().is_empty()).then_some(normalized)
}

fn string_array(value: Option<&Value>) -> Option<Vec<String>> {
    value?
        .as_array()?
        .iter()
        .map(|item| item.as_str().map(str::to_string))
        .collect()
}

/// Build an opt-in file policy for a Product App's visible Agent session.
/// Sessions without `productAppRuntime.agentWorkspace` use the default
/// unrestricted tool policy.
pub fn build_product_app_runtime_restrictions(
    execution_context: &ProductAppExecutionContext,
    custom_metadata: Option<&Value>,
    system_runtime_root: &Path,
) -> Option<ToolRuntimeRestrictions> {
    let runtime = custom_metadata?.get("productAppRuntime")?.as_object()?;
    let policy = runtime.get("agentWorkspace")?.as_object()?;
    let app_id = safe_id(&execution_context.app_id);
    let managed_root_template = policy.get("managedRoot")?.as_str()?;
    let managed_root_relative = relative_path(
        &managed_root_template
            .replace("{appId}", &app_id)
            .replace("{workId}", &safe_id(&execution_context.work_id))
            .replace("{sessionId}", &safe_id(&execution_context.session_id)),
    )?;
    let trusted_workspace = execution_context
        .workspace_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let base_root = trusted_workspace
        .clone()
        .unwrap_or_else(|| system_runtime_root.to_path_buf());
    let managed_root = base_root.join(managed_root_relative);
    let document_roots = string_array(policy.get("documentRoots"))?
        .into_iter()
        .map(|value| relative_path(&value).map(|path| managed_root.join(path)))
        .collect::<Option<Vec<_>>>()?;
    if document_roots.is_empty() {
        return None;
    }
    let mut private_roots = string_array(policy.get("privateRoots"))
        .unwrap_or_default()
        .into_iter()
        .map(|value| relative_path(&value).map(|path| managed_root.join(path)))
        .collect::<Option<Vec<_>>>()?;

    let workspace_access = policy
        .get("workspaceAccess")
        .and_then(Value::as_str)
        .unwrap_or("readWrite");
    if !matches!(workspace_access, "none" | "readOnly" | "readWrite") {
        return None;
    }

    let mut read_roots = document_roots.clone();
    let mut write_roots = document_roots.clone();
    if let Some(workspace_root) = trusted_workspace {
        private_roots.push(workspace_root.join(".sparo_os"));
        if workspace_access != "none" {
            read_roots.push(workspace_root.clone());
        }
        if workspace_access == "readWrite" {
            write_roots.push(workspace_root);
        }
    }

    let as_strings = |roots: Vec<PathBuf>| {
        roots
            .into_iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect::<Vec<_>>()
    };
    let read_roots = as_strings(read_roots);
    let write_roots = as_strings(write_roots);
    Some(ToolRuntimeRestrictions {
        path_policy: ToolPathPolicy {
            read_roots: read_roots.clone(),
            list_roots: read_roots.clone(),
            search_roots: read_roots,
            write_roots: write_roots.clone(),
            edit_roots: write_roots,
            delete_roots: Vec::new(),
            denied_roots: as_strings(private_roots),
        },
        ..ToolRuntimeRestrictions::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn metadata() -> Value {
        json!({
            "productAppRuntime": {
                "appId": "sample-app",
                "agentWorkspace": {
                    "managedRoot": "Documents/{appId}/{workId}",
                    "workspaceAccess": "readWrite",
                    "documentRoots": ["documents"],
                    "privateRoots": ["visual", "history", "cache"]
                }
            }
        })
    }

    fn execution_context(workspace_path: Option<&str>) -> ProductAppExecutionContext {
        ProductAppExecutionContext {
            app_id: "sample-app".to_string(),
            work_id: "work-1".to_string(),
            runtime_instance_id: "runtime-1".to_string(),
            slot_id: "slot-1".to_string(),
            release_id: "release-1".to_string(),
            config_revision: "config-1".to_string(),
            data_schema_version: "1".to_string(),
            product_app_surface_id: "surface-1".to_string(),
            surface_id: "primary".to_string(),
            host_surface_id: "host-1".to_string(),
            workspace_path: workspace_path.map(str::to_string),
            session_id: "session-1".to_string(),
        }
    }

    #[test]
    fn policy_is_strictly_opt_in() {
        assert!(build_product_app_runtime_restrictions(
            &execution_context(Some("C:/workspace")),
            Some(&json!({"productAppRuntime": {"appId": "sample-app"}})),
            Path::new("C:/runtime"),
        )
        .is_none());
    }

    #[test]
    fn workspace_policy_grants_workspace_and_managed_documents_only() {
        let restrictions = build_product_app_runtime_restrictions(
            &execution_context(Some("C:/workspace")),
            Some(&metadata()),
            Path::new("C:/runtime"),
        )
        .expect("declared policy");

        assert!(restrictions
            .path_policy
            .read_roots
            .iter()
            .any(|root| root.ends_with("workspace")));
        assert!(restrictions
            .path_policy
            .write_roots
            .iter()
            .any(|root| root.ends_with("documents")));
        assert!(restrictions
            .path_policy
            .denied_roots
            .iter()
            .any(|root| root.ends_with("visual")));
        assert!(restrictions
            .path_policy
            .denied_roots
            .iter()
            .any(|root| root.ends_with(".sparo_os")));
    }

    #[test]
    fn system_scope_does_not_grant_the_system_runtime_root() {
        let restrictions = build_product_app_runtime_restrictions(
            &execution_context(None),
            Some(&metadata()),
            Path::new("C:/runtime"),
        )
        .expect("declared policy");

        assert_eq!(restrictions.path_policy.read_roots.len(), 1);
        assert!(restrictions.path_policy.read_roots[0].ends_with("documents"));
    }
}
