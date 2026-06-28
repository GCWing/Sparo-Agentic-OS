pub use crate::agentic::tools::workspace_paths::{
    normalize_path, resolve_path, resolve_path_with_workspace,
};

use crate::agentic::tools::framework::ToolUseContext;
use crate::infrastructure::try_get_path_manager_arc;
use crate::util::errors::{BitFunError, BitFunResult};
use std::path::{Path, PathBuf};

pub async fn enforce_surface_component_studio_source_write(
    context: &ToolUseContext,
    resolved_path: &str,
) -> BitFunResult<()> {
    if context.agent_type.as_deref() != Some("AppStudio") {
        return Ok(());
    }

    let target = Path::new(resolved_path);
    for root in allowed_app_studio_package_roots(context)? {
        if target.starts_with(&root) {
            return Ok(());
        }
    }

    Err(BitFunError::validation(
        "AppStudio can only write Product App and Component package files".to_string(),
    ))
}

fn allowed_app_studio_package_roots(context: &ToolUseContext) -> BitFunResult<Vec<PathBuf>> {
    let path_manager = try_get_path_manager_arc()
        .map_err(|e| BitFunError::tool(format!("PathManager not initialized: {}", e)))?;
    let mut roots = vec![
        path_manager.system_product_apps_dir(),
        path_manager.system_components_dir(),
    ];
    if let Some(workspace_root) = context.workspace_root() {
        roots.push(path_manager.project_product_apps_dir(workspace_root));
        roots.push(path_manager.project_components_dir(workspace_root));
    }
    Ok(roots)
}
