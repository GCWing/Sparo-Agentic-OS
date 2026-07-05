//! Storage Management API

use crate::api::AppState;
use sparo_core::infrastructure::storage::{
    CleanupPolicy, CleanupResult, CleanupService, ResetApplicationDataRequest,
    ResetApplicationDataResult, ResetApplicationDataService,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePathsInfo {
    pub app_root: PathBuf,
    pub user_config_dir: PathBuf,
    pub user_state_dir: PathBuf,
    pub user_data_dir: PathBuf,
    pub workspaces_runtime_root: PathBuf,
    pub agentic_os_runtime_root: PathBuf,
    pub apps_dir: PathBuf,
    pub browser_profiles_dir: PathBuf,
    pub secrets_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub cache_root: PathBuf,
    pub logs_dir: PathBuf,
    pub temp_dir: PathBuf,
    pub agentic_os_memory_dir: PathBuf,
    pub agentic_os_host_dir: PathBuf,
    pub agentic_os_host_overview_path: PathBuf,
    pub agentic_os_workspaces_overview_dir: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStats {
    pub total_size_mb: f64,
    pub app_root_size_mb: f64,
    pub config_size_mb: f64,
    pub data_size_mb: f64,
    pub state_size_mb: f64,
    pub workspaces_size_mb: f64,
    pub agentic_os_size_mb: f64,
    pub apps_size_mb: f64,
    pub secrets_size_mb: f64,
    pub cache_size_mb: f64,
    pub logs_size_mb: f64,
    pub temp_size_mb: f64,
    pub backups_size_mb: f64,
    pub categories: Vec<StorageStatsCategory>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatsCategory {
    pub id: String,
    pub label: String,
    pub path: PathBuf,
    pub size_mb: f64,
}

#[tauri::command]
pub async fn get_storage_paths(state: State<'_, AppState>) -> Result<StoragePathsInfo, String> {
    let workspace_service = &state.workspace_service;
    let path_manager = workspace_service.path_manager();

    Ok(StoragePathsInfo {
        app_root: path_manager.app_root(),
        user_config_dir: path_manager.user_config_dir(),
        user_state_dir: path_manager.user_state_dir(),
        user_data_dir: path_manager.user_data_dir(),
        workspaces_runtime_root: path_manager.workspaces_runtime_root(),
        agentic_os_runtime_root: path_manager.agentic_os_runtime_root(),
        apps_dir: path_manager.apps_dir(),
        browser_profiles_dir: path_manager.browser_profiles_dir(),
        secrets_dir: path_manager.secrets_dir(),
        backups_dir: path_manager.backups_dir(),
        cache_root: path_manager.cache_root(),
        logs_dir: path_manager.logs_dir(),
        temp_dir: path_manager.temp_dir(),
        agentic_os_memory_dir: path_manager.agentic_os_memory_dir(),
        agentic_os_host_dir: path_manager.agentic_os_host_dir(),
        agentic_os_host_overview_path: path_manager.agentic_os_host_overview_path(),
        agentic_os_workspaces_overview_dir: path_manager.agentic_os_workspaces_overview_dir(),
    })
}

#[tauri::command]
pub async fn get_workspace_storage_paths(
    state: State<'_, AppState>,
    workspace_path: String,
) -> Result<WorkspaceStoragePathsInfo, String> {
    let workspace_service = &state.workspace_service;
    let path_manager = workspace_service.path_manager();

    let workspace_path = PathBuf::from(workspace_path);

    Ok(WorkspaceStoragePathsInfo {
        workspace_local_root: path_manager.project_root(&workspace_path),
        runtime_root: path_manager.workspace_runtime_root(&workspace_path),
        agents_dir: path_manager.project_agents_dir(&workspace_path),
        sessions_dir: path_manager.workspace_sessions_dir(&workspace_path),
        memory_dir: path_manager.workspace_memory_dir(&workspace_path),
        plans_dir: path_manager.workspace_plans_dir(&workspace_path),
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStoragePathsInfo {
    pub workspace_local_root: PathBuf,
    pub runtime_root: PathBuf,
    pub agents_dir: PathBuf,
    pub sessions_dir: PathBuf,
    pub memory_dir: PathBuf,
    pub plans_dir: PathBuf,
}

#[tauri::command]
pub async fn cleanup_storage(state: State<'_, AppState>) -> Result<CleanupResult, String> {
    let workspace_service = &state.workspace_service;
    let path_manager = workspace_service.path_manager();

    let policy = CleanupPolicy::default();
    let cleanup_service = CleanupService::new((**path_manager).clone(), policy);

    cleanup_service
        .cleanup_all()
        .await
        .map_err(|e| format!("Cleanup failed: {}", e))
}

#[tauri::command]
pub async fn cleanup_storage_with_policy(
    state: State<'_, AppState>,
    policy: CleanupPolicy,
) -> Result<CleanupResult, String> {
    let workspace_service = &state.workspace_service;
    let path_manager = workspace_service.path_manager();

    let cleanup_service = CleanupService::new((**path_manager).clone(), policy);

    cleanup_service
        .cleanup_all()
        .await
        .map_err(|e| format!("Cleanup failed: {}", e))
}

#[tauri::command]
pub async fn get_storage_statistics(state: State<'_, AppState>) -> Result<StorageStats, String> {
    let workspace_service = &state.workspace_service;
    let path_manager = workspace_service.path_manager();

    let roots = vec![
        ("config", "Configuration", path_manager.user_config_dir()),
        ("data", "Application data", path_manager.user_data_dir()),
        ("state", "Application state", path_manager.user_state_dir()),
        (
            "workspaces",
            "Workspace runtime",
            path_manager.workspaces_runtime_root(),
        ),
        (
            "agentic_os",
            "Agentic OS runtime",
            path_manager.agentic_os_runtime_root(),
        ),
        ("apps", "Apps", path_manager.apps_dir()),
        (
            "browser_profiles",
            "Browser profiles",
            path_manager.browser_profiles_dir(),
        ),
        ("secrets", "Secrets", path_manager.secrets_dir()),
        ("cache", "Cache", path_manager.cache_root()),
        ("logs", "Logs", path_manager.logs_dir()),
        ("temp", "Temporary files", path_manager.temp_dir()),
        ("backups", "Backups", path_manager.backups_dir()),
    ];

    let mut categories = Vec::with_capacity(roots.len());
    let mut total_size = 0u64;
    for (id, label, path) in roots {
        let size = calculate_dir_size(&path).await?;
        total_size += size;
        categories.push(StorageStatsCategory {
            id: id.to_string(),
            label: label.to_string(),
            path,
            size_mb: bytes_to_mb(size),
        });
    }

    let size_for = |id: &str| {
        categories
            .iter()
            .find(|category| category.id == id)
            .map(|category| category.size_mb)
            .unwrap_or(0.0)
    };

    Ok(StorageStats {
        total_size_mb: bytes_to_mb(total_size),
        app_root_size_mb: bytes_to_mb(calculate_dir_size(&path_manager.app_root()).await?),
        config_size_mb: size_for("config"),
        data_size_mb: size_for("data"),
        state_size_mb: size_for("state"),
        workspaces_size_mb: size_for("workspaces"),
        agentic_os_size_mb: size_for("agentic_os"),
        apps_size_mb: size_for("apps"),
        secrets_size_mb: size_for("secrets"),
        cache_size_mb: size_for("cache"),
        logs_size_mb: size_for("logs"),
        temp_size_mb: size_for("temp"),
        backups_size_mb: size_for("backups"),
        categories,
    })
}

#[tauri::command]
pub async fn reset_application_data(
    state: State<'_, AppState>,
    request: ResetApplicationDataRequest,
) -> Result<ResetApplicationDataResult, String> {
    let path_manager = state.workspace_service.path_manager();
    let reset_service = ResetApplicationDataService::new((**path_manager).clone());
    reset_service
        .reset(request)
        .await
        .map_err(|e| format!("Failed to reset application data: {}", e))
}

#[tauri::command]
pub async fn initialize_workspace_storage(
    state: State<'_, AppState>,
    workspace_path: String,
) -> Result<(), String> {
    let workspace_service = &state.workspace_service;
    let runtime_service = workspace_service.runtime_service();

    let workspace_path = PathBuf::from(workspace_path);

    runtime_service
        .ensure_local_workspace_runtime(&workspace_path)
        .await
        .map(|_| ())
        .map_err(|e| format!("Failed to initialize workspace runtime: {}", e))
}

fn calculate_dir_size(
    dir: &std::path::Path,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<u64, String>> + Send + '_>> {
    Box::pin(async move {
        let mut total = 0u64;

        if !dir.exists() {
            return Ok(0);
        }

        let mut read_dir = tokio::fs::read_dir(dir)
            .await
            .map_err(|e| format!("Failed to read directory: {}", e))?;

        while let Some(entry) = read_dir
            .next_entry()
            .await
            .map_err(|e| format!("Failed to read directory entry: {}", e))?
        {
            let metadata = entry
                .metadata()
                .await
                .map_err(|e| format!("Failed to get metadata: {}", e))?;

            if metadata.is_dir() {
                total += calculate_dir_size(&entry.path()).await?;
            } else {
                total += metadata.len();
            }
        }

        Ok(total)
    })
}

fn bytes_to_mb(bytes: u64) -> f64 {
    bytes as f64 / 1_048_576.0
}
