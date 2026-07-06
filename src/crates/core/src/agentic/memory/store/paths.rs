use super::{
    ensure_markdown_placeholder, MemoryStoreTarget, MEMORY_CANONICAL_FILE,
    MEMORY_CANONICAL_TEMPLATE, MEMORY_DIR_NAME, MEMORY_LOG_DIR_NAME, MEMORY_MILESTONES_FILE,
    MEMORY_MILESTONES_TEMPLATE, MEMORY_SOUL_FILE, MEMORY_SOUL_TEMPLATE, MEMORY_USER_FILE,
    MEMORY_USER_TEMPLATE,
};
use crate::error::*;
use crate::infrastructure::get_path_manager_arc;
use chrono::{Datelike, NaiveDate};
use log::debug;
use std::path::PathBuf;
use tokio::fs;

pub(crate) fn memory_store_dir_path_for_target(target: MemoryStoreTarget<'_>) -> PathBuf {
    let path_manager = get_path_manager_arc();
    let path = match target {
        MemoryStoreTarget::WorkspaceProject(workspace_root) => {
            path_manager.workspace_memory_dir(workspace_root)
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
) -> CoreResult<()> {
    let memory_dir = memory_store_dir_path_for_target(target);
    if !memory_dir.exists() {
        fs::create_dir_all(&memory_dir).await.map_err(|e| {
            CoreError::service(format!(
                "Failed to create memory directory {}: {}",
                memory_dir.display(),
                e
            ))
        })?;
    }

    let logs_dir = memory_dir.join(MEMORY_LOG_DIR_NAME);
    if !logs_dir.exists() {
        fs::create_dir_all(&logs_dir).await.map_err(|e| {
            CoreError::service(format!(
                "Failed to create memory logs directory {}: {}",
                logs_dir.display(),
                e
            ))
        })?;
    }

    let created_soul_file = if matches!(target, MemoryStoreTarget::GlobalAgenticOs) {
        ensure_markdown_placeholder(&memory_dir.join(MEMORY_SOUL_FILE), MEMORY_SOUL_TEMPLATE)
            .await?
    } else {
        false
    };
    let created_user_file = if matches!(target, MemoryStoreTarget::GlobalAgenticOs) {
        ensure_markdown_placeholder(&memory_dir.join(MEMORY_USER_FILE), MEMORY_USER_TEMPLATE)
            .await?
    } else {
        false
    };
    let created_memory_file = ensure_markdown_placeholder(
        &memory_dir.join(MEMORY_CANONICAL_FILE),
        MEMORY_CANONICAL_TEMPLATE,
    )
    .await?;
    let created_milestones_file = if matches!(target, MemoryStoreTarget::GlobalAgenticOs) {
        ensure_markdown_placeholder(
            &memory_dir.join(MEMORY_MILESTONES_FILE),
            MEMORY_MILESTONES_TEMPLATE,
        )
        .await?
    } else {
        false
    };

    debug!(
        "Ensured memory store files: scope={} path={} created_soul_file={} created_user_file={} created_memory_file={} created_milestones_file={}",
        target.scope().as_label(),
        memory_dir.display(),
        created_soul_file,
        created_user_file,
        created_memory_file,
        created_milestones_file
    );

    Ok(())
}

pub(crate) fn memory_journal_dir_for_date(
    target: MemoryStoreTarget<'_>,
    date: NaiveDate,
) -> PathBuf {
    memory_store_dir_path_for_target(target)
        .join(MEMORY_LOG_DIR_NAME)
        .join(format!("{:04}", date.year()))
        .join(format!("{:02}", date.month()))
}

pub(crate) fn memory_journal_file_path_for_date(
    target: MemoryStoreTarget<'_>,
    date: NaiveDate,
) -> PathBuf {
    memory_journal_dir_for_date(target, date).join(format!(
        "{:04}-{:02}-{:02}.jsonl",
        date.year(),
        date.month(),
        date.day()
    ))
}
