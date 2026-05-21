use bitfun_core::service::prompt_assets::{
    PromptAsset, PromptAssetGit, PromptAssetGitCommit, PromptAssetGitDiff, PromptAssetGitStatus,
    PromptAssetMetadata, PromptAssetScope, PromptAssetStore, PromptAssetSummary,
    PromptValidationReport,
};
use bitfun_core::service::prompt_git_trace::{
    GitHeadSnapshot, GitPromptCommit, PromptGitTraceStore,
};
use bitfun_core::service::prompt_history::{
    PromptHistoryEvent, PromptHistoryQuery, PromptHistoryStore, PromptHistorySummary, PromptLineage,
};
use serde::Deserialize;
use std::path::PathBuf;

fn workspace_root_from_request(workspace_path: &str) -> Result<PathBuf, String> {
    let trimmed = workspace_path.trim();
    if trimmed.is_empty() {
        return Err("workspacePath is required".to_string());
    }
    Ok(PathBuf::from(trimmed))
}

// ==================== 类型 ====================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPromptHistoryRequest {
    pub workspace_path: String,
    pub session_id: Option<String>,
    pub agent_type: Option<String>,
    pub pinned: Option<bool>,
    pub query: Option<String>,
    pub branch: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetPromptLineageRequest {
    pub workspace_path: String,
    pub event_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TogglePromptPinRequest {
    pub workspace_path: String,
    pub event_id: String,
    pub pinned: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotePromptHistoryToAssetRequest {
    pub workspace_path: String,
    pub history_event_id: String,
    pub metadata: PromptAssetMetadata,
    pub body: Option<String>,
    pub relative_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAssetListRequest {
    pub workspace_path: String,
    pub scope: Option<PromptAssetScope>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAssetRequest {
    pub workspace_path: String,
    pub asset_id: String,
    pub scope: Option<PromptAssetScope>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePromptAssetRequest {
    pub workspace_path: String,
    pub metadata: PromptAssetMetadata,
    pub body: String,
    pub relative_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatePromptContentRequest {
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAssetGitPathRequest {
    pub workspace_path: String,
    pub relative_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAssetGitHistoryRequest {
    pub workspace_path: String,
    pub relative_path: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackPromptAssetRequest {
    pub workspace_path: String,
    pub relative_path: String,
    pub commit: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptGitHistoryRequest {
    pub workspace_path: String,
    pub branch: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptGitBranchesRequest {
    pub workspace_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptGitHeadSnapshotRequest {
    pub workspace_path: String,
}

// ==================== 历史页面 ====================

#[tauri::command]
pub async fn list_prompt_history(
    request: ListPromptHistoryRequest,
) -> Result<PromptHistorySummary, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptHistoryStore::list(
        &workspace,
        PromptHistoryQuery {
            session_id: request.session_id,
            agent_type: request.agent_type,
            pinned: request.pinned,
            query: request.query,
            branch: request.branch,
            from_date: request.from_date,
            to_date: request.to_date,
            limit: request.limit,
            prompt_hash: None,
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_prompt_lineage(
    request: GetPromptLineageRequest,
) -> Result<PromptLineage, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptHistoryStore::get_lineage(&workspace, &request.event_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_prompt_pin(
    request: TogglePromptPinRequest,
) -> Result<PromptHistoryEvent, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptHistoryStore::toggle_pin(&workspace, &request.event_id, request.pinned)
        .await
        .map_err(|e| e.to_string())
}

// ==================== Assets 页面 ====================

#[tauri::command]
pub async fn list_prompt_assets(
    request: PromptAssetListRequest,
) -> Result<Vec<PromptAssetSummary>, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptAssetStore::list_assets(
        workspace.as_path(),
        request.scope.unwrap_or(PromptAssetScope::Project),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_prompt_asset(request: PromptAssetRequest) -> Result<PromptAsset, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptAssetStore::get_asset(
        workspace.as_path(),
        request.scope.unwrap_or(PromptAssetScope::Project),
        &request.asset_id,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_prompt_asset(request: SavePromptAssetRequest) -> Result<PromptAsset, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    let scope = request.metadata.scope;
    PromptAssetStore::save_asset(
        workspace.as_path(),
        scope,
        request.metadata,
        &request.body,
        request.relative_path.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn validate_prompt_content(
    request: ValidatePromptContentRequest,
) -> Result<PromptValidationReport, String> {
    Ok(PromptAssetStore::validate_content(&request.content))
}

#[tauri::command]
pub async fn validate_prompt_asset(
    request: PromptAssetRequest,
) -> Result<PromptValidationReport, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptAssetStore::validate_asset(
        workspace.as_path(),
        request.scope.unwrap_or(PromptAssetScope::Project),
        &request.asset_id,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_prompt_asset_git_status(
    request: PromptAssetListRequest,
) -> Result<PromptAssetGitStatus, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptAssetGit::status(workspace.as_path()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_prompt_asset_git_diff(
    request: PromptAssetGitPathRequest,
) -> Result<PromptAssetGitDiff, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptAssetGit::diff(workspace.as_path(), request.relative_path.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_prompt_asset_git_history(
    request: PromptAssetGitHistoryRequest,
) -> Result<Vec<PromptAssetGitCommit>, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptAssetGit::history(
        workspace.as_path(),
        request.relative_path.as_deref(),
        request.limit.unwrap_or(20),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rollback_prompt_asset(request: RollbackPromptAssetRequest) -> Result<(), String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptAssetGit::rollback(workspace.as_path(), &request.relative_path, &request.commit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn promote_prompt_history_to_asset(
    request: PromotePromptHistoryToAssetRequest,
) -> Result<PromptAsset, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    let event = PromptHistoryStore::get_event(&workspace, &request.history_event_id)
        .map_err(|e| e.to_string())?;
    let mut metadata = request.metadata;
    metadata.source_history_event_id = Some(event.id.clone());
    metadata.source_session_id = Some(event.session_id.clone());
    metadata.source_turn_id = event.turn_id.clone();
    let scope = metadata.scope;
    let body = request.body.unwrap_or_else(|| event.text.clone());
    PromptAssetStore::save_asset(
        workspace.as_path(),
        scope,
        metadata,
        &body,
        request.relative_path.as_deref(),
    )
    .map_err(|e| e.to_string())
}

// ==================== Git 页面 ====================

#[tauri::command]
pub async fn list_git_prompt_commits(
    request: PromptGitHistoryRequest,
) -> Result<Vec<GitPromptCommit>, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptGitTraceStore::list_git_prompt_commits(
        &workspace,
        request.branch.as_deref(),
        request.limit.unwrap_or(50),
        request.offset.unwrap_or(0),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_prompt_git_branches(
    request: PromptGitBranchesRequest,
) -> Result<Vec<String>, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptGitTraceStore::list_branches(&workspace).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_prompt_git_head_snapshot(
    request: PromptGitHeadSnapshotRequest,
) -> Result<GitHeadSnapshot, String> {
    let workspace = workspace_root_from_request(&request.workspace_path)?;
    PromptGitTraceStore::get_head_snapshot(&workspace).map_err(|e| e.to_string())
}