use super::{
    ensure_markdown_placeholder, global_overview::ensure_global_memory_overview_files,
    MemoryStoreTarget, MEMORY_DIR_NAME, MEMORY_INDEX_FILE, MEMORY_INDEX_TEMPLATE,
};
use crate::infrastructure::get_path_manager_arc;
use crate::util::errors::*;
use log::debug;
use std::path::PathBuf;
use tokio::fs;

pub(crate) fn memory_store_dir_path_for_target(target: MemoryStoreTarget<'_>) -> PathBuf {
    let path_manager = get_path_manager_arc();
    let path = match target {
        MemoryStoreTarget::WorkspaceProject(workspace_root) => {
            path_manager.project_memory_dir(workspace_root)
        }
        MemoryStoreTarget::GlobalAgenticOs => path_manager.agentic_os_memory_dir(),
    };
    debug!(
        "Resolved memory store directory: scope={} memory_dir={} storage_subdir={}",
        target.scope().as_label(),
        path.display(),
        MEMORY_DIR_NAME
    );
    path
}

pub(crate) async fn ensure_memory_store_for_target(
    target: MemoryStoreTarget<'_>,
) -> BitFunResult<()> {
    let memory_dir = memory_store_dir_path_for_target(target);
    if !memory_dir.exists() {
        fs::create_dir_all(&memory_dir).await.map_err(|e| {
            BitFunError::service(format!(
                "Failed to create memory directory {}: {}",
                memory_dir.display(),
                e
            ))
        })?;
    }
    let created_memory_index =
        ensure_markdown_placeholder(&memory_dir.join(MEMORY_INDEX_FILE), MEMORY_INDEX_TEMPLATE)
            .await?;

    if matches!(target, MemoryStoreTarget::GlobalAgenticOs) {
        ensure_global_memory_overview_files(&memory_dir).await?;
    }

    debug!(
        "Ensured memory store files: scope={} path={} created_memory_index={}",
        target.scope().as_label(),
        memory_dir.display(),
        created_memory_index
    );

    Ok(())
}
