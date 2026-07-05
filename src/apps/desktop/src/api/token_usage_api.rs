use crate::api::app_state::AppState;
use sparo_core::service::token_usage::{
    ModelTokenStats, SessionTokenStats, TimeRange, TokenUsageQuery, TokenUsageRecord,
    TokenUsageSummary,
};
use chrono::{DateTime, Utc};
use log::error;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

const DEFAULT_RECORD_LIMIT: usize = 500;
const MAX_RECORD_LIMIT: usize = 1_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetTokenUsageRequest {
    pub time_range: Option<String>,
    pub model_id: Option<String>,
    pub session_id: Option<String>,
    pub include_subagent: Option<bool>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageRecordDto {
    pub model_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub agent_type: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cached_tokens: u32,
    pub total_tokens: u32,
    pub is_subagent: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTokenStatsDto {
    pub model_id: String,
    pub total_input: u64,
    pub total_output: u64,
    pub total_cached: u64,
    pub total_tokens: u64,
    pub session_count: u32,
    pub request_count: u32,
    pub first_used: Option<DateTime<Utc>>,
    pub last_used: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTokenStatsDto {
    pub session_id: String,
    pub model_id: String,
    pub agent_type: Option<String>,
    pub total_input: u32,
    pub total_output: u32,
    pub total_cached: u32,
    pub total_tokens: u32,
    pub request_count: u32,
    pub created_at: DateTime<Utc>,
    pub last_updated: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageSummaryDto {
    pub total_input: u64,
    pub total_output: u64,
    pub total_cached: u64,
    pub total_tokens: u64,
    pub by_model: HashMap<String, ModelTokenStatsDto>,
    pub by_agent: HashMap<String, SessionTokenStatsDto>,
    pub by_session: HashMap<String, SessionTokenStatsDto>,
    pub record_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetTokenUsageResponse {
    pub summary: TokenUsageSummaryDto,
    pub records: Vec<TokenUsageRecordDto>,
}

fn parse_time_range(value: Option<&str>) -> TimeRange {
    match value.unwrap_or("thisMonth") {
        "today" => TimeRange::Today,
        "thisWeek" => TimeRange::ThisWeek,
        "all" => TimeRange::All,
        _ => TimeRange::ThisMonth,
    }
}

fn build_base_query(request: &GetTokenUsageRequest) -> TokenUsageQuery {
    TokenUsageQuery {
        model_id: request
            .model_id
            .as_ref()
            .filter(|value| !value.trim().is_empty())
            .cloned(),
        session_id: request
            .session_id
            .as_ref()
            .filter(|value| !value.trim().is_empty())
            .cloned(),
        time_range: parse_time_range(request.time_range.as_deref()),
        limit: None,
        offset: None,
        include_subagent: request.include_subagent.unwrap_or(true),
    }
}

fn build_records_query(request: &GetTokenUsageRequest) -> TokenUsageQuery {
    let mut query = build_base_query(request);
    let requested_limit = request.limit.unwrap_or(DEFAULT_RECORD_LIMIT);
    query.limit = Some(requested_limit.clamp(1, MAX_RECORD_LIMIT));
    query.offset = request.offset;
    query
}

fn record_to_dto(record: TokenUsageRecord) -> TokenUsageRecordDto {
    TokenUsageRecordDto {
        model_id: record.model_id,
        session_id: record.session_id,
        turn_id: record.turn_id,
        agent_type: record.agent_type,
        timestamp: record.timestamp,
        input_tokens: record.input_tokens,
        output_tokens: record.output_tokens,
        cached_tokens: record.cached_tokens,
        total_tokens: record.total_tokens,
        is_subagent: record.is_subagent,
    }
}

fn model_stats_to_dto(stats: ModelTokenStats) -> ModelTokenStatsDto {
    ModelTokenStatsDto {
        model_id: stats.model_id,
        total_input: stats.total_input,
        total_output: stats.total_output,
        total_cached: stats.total_cached,
        total_tokens: stats.total_tokens,
        session_count: stats.session_count,
        request_count: stats.request_count,
        first_used: stats.first_used,
        last_used: stats.last_used,
    }
}

fn session_stats_to_dto(stats: SessionTokenStats) -> SessionTokenStatsDto {
    SessionTokenStatsDto {
        session_id: stats.session_id,
        model_id: stats.model_id,
        agent_type: stats.agent_type,
        total_input: stats.total_input,
        total_output: stats.total_output,
        total_cached: stats.total_cached,
        total_tokens: stats.total_tokens,
        request_count: stats.request_count,
        created_at: stats.created_at,
        last_updated: stats.last_updated,
    }
}

fn summary_to_dto(summary: TokenUsageSummary) -> TokenUsageSummaryDto {
    TokenUsageSummaryDto {
        total_input: summary.total_input,
        total_output: summary.total_output,
        total_cached: summary.total_cached,
        total_tokens: summary.total_tokens,
        by_model: summary
            .by_model
            .into_iter()
            .map(|(key, value)| (key, model_stats_to_dto(value)))
            .collect(),
        by_agent: summary
            .by_agent
            .into_iter()
            .map(|(key, value)| (key, session_stats_to_dto(value)))
            .collect(),
        by_session: summary
            .by_session
            .into_iter()
            .map(|(key, value)| (key, session_stats_to_dto(value)))
            .collect(),
        record_count: summary.record_count,
    }
}

#[tauri::command]
pub async fn get_token_usage(
    state: State<'_, AppState>,
    request: GetTokenUsageRequest,
) -> Result<GetTokenUsageResponse, String> {
    let summary_query = build_base_query(&request);
    let records_query = build_records_query(&request);

    let summary = state
        .token_usage_service
        .get_summary(summary_query)
        .await
        .map_err(|error| {
            error!("Failed to get token usage summary: {}", error);
            format!("Failed to get token usage summary: {}", error)
        })?;

    let records = state
        .token_usage_service
        .query_records(records_query)
        .await
        .map_err(|error| {
            error!("Failed to query token usage records: {}", error);
            format!("Failed to query token usage records: {}", error)
        })?;

    Ok(GetTokenUsageResponse {
        summary: summary_to_dto(summary),
        records: records.into_iter().map(record_to_dto).collect(),
    })
}

#[tauri::command]
pub async fn clear_token_usage(state: State<'_, AppState>) -> Result<(), String> {
    state
        .token_usage_service
        .clear_all_stats()
        .await
        .map_err(|error| {
            error!("Failed to clear token usage records: {}", error);
            format!("Failed to clear token usage records: {}", error)
        })
}
