use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::command::{CommandContext, CommandError, CommandResult};
use crate::service::config::{
    reload_global_config, ConfigExport, ConfigHealthStatus, ConfigImportResult, GlobalConfigManager,
};

#[derive(Debug, Deserialize)]
pub struct GetConfigRequest {
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SetConfigRequest {
    pub path: String,
    pub value: Value,
}

#[derive(Debug, Serialize)]
pub struct SetConfigResponse {
    pub message: String,
    pub invalidated_ai_cache: bool,
}

#[derive(Debug, Deserialize)]
pub struct ResetConfigRequest {
    pub path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ResetConfigResponse {
    pub message: String,
    pub invalidated_ai_cache: bool,
}

#[derive(Debug, Deserialize)]
pub struct ImportConfigRequest {
    pub config: ConfigExport,
}

#[derive(Debug, Serialize)]
pub struct ImportConfigResponse {
    pub result: ConfigImportResult,
    pub invalidated_ai_cache: bool,
}

fn set_path_requires_ai_cache_invalidation(path: &str) -> bool {
    path.starts_with("ai.models")
        || path.starts_with("ai.default_models")
        || path.starts_with("ai.agent_models")
        || path.starts_with("ai.stream_idle_timeout_secs")
        || path.starts_with("ai.proxy")
}

fn reset_path_requires_ai_cache_invalidation(path: Option<&str>) -> bool {
    match path {
        Some(path) => path.starts_with("ai"),
        None => true,
    }
}

pub async fn get_config(ctx: &CommandContext, request: GetConfigRequest) -> CommandResult<Value> {
    ctx.config_service()
        .get_config::<Value>(request.path.as_deref())
        .await
        .map_err(CommandError::config)
}

pub async fn set_config(
    ctx: &CommandContext,
    request: SetConfigRequest,
) -> CommandResult<SetConfigResponse> {
    ctx.config_service()
        .set_config(&request.path, request.value)
        .await
        .map_err(CommandError::config)?;

    reload_global_config().await.map_err(CommandError::config)?;

    let invalidated_ai_cache = if set_path_requires_ai_cache_invalidation(&request.path) {
        ctx.invalidate_ai_client_cache()
    } else {
        false
    };

    Ok(SetConfigResponse {
        message: "Configuration set successfully".to_string(),
        invalidated_ai_cache,
    })
}

pub async fn reset_config(
    ctx: &CommandContext,
    request: ResetConfigRequest,
) -> CommandResult<ResetConfigResponse> {
    ctx.config_service()
        .reset_config(request.path.as_deref())
        .await
        .map_err(CommandError::config)?;

    reload_global_config().await.map_err(CommandError::config)?;

    let message = if let Some(path) = &request.path {
        format!("Configuration '{}' reset successfully", path)
    } else {
        "All configurations reset successfully".to_string()
    };

    let invalidated_ai_cache = if reset_path_requires_ai_cache_invalidation(request.path.as_deref())
    {
        ctx.invalidate_ai_client_cache()
    } else {
        false
    };

    Ok(ResetConfigResponse {
        message,
        invalidated_ai_cache,
    })
}

pub async fn export_config(ctx: &CommandContext) -> CommandResult<ConfigExport> {
    ctx.config_service()
        .export_config()
        .await
        .map_err(CommandError::config)
}

pub async fn import_config(
    ctx: &CommandContext,
    request: ImportConfigRequest,
) -> CommandResult<ImportConfigResponse> {
    let result = ctx
        .config_service()
        .import_config(request.config)
        .await
        .map_err(CommandError::config)?;

    reload_global_config().await.map_err(CommandError::config)?;
    let invalidated_ai_cache = ctx.invalidate_ai_client_cache();

    Ok(ImportConfigResponse {
        result,
        invalidated_ai_cache,
    })
}

pub async fn validate_config(ctx: &CommandContext) -> CommandResult<Value> {
    let result = ctx
        .config_service()
        .validate_config()
        .await
        .map_err(CommandError::config)?;
    serde_json::to_value(result).map_err(CommandError::serialization)
}

pub async fn reload_config(ctx: &CommandContext) -> CommandResult<String> {
    ctx.config_service()
        .reload()
        .await
        .map_err(CommandError::config)?;
    Ok("Configuration reloaded successfully".to_string())
}

pub async fn sync_config_to_global() -> CommandResult<String> {
    reload_global_config().await.map_err(CommandError::config)?;
    Ok("Configuration synced to global service".to_string())
}

pub fn get_global_config_health() -> bool {
    GlobalConfigManager::is_initialized()
}

pub async fn get_global_config_health_status(
    ctx: &CommandContext,
) -> CommandResult<ConfigHealthStatus> {
    ctx.config_service()
        .health_check()
        .await
        .map_err(CommandError::config)
}
