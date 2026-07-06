use log::{debug, error};
use sparo_core::service::{
    get_global_daily_letter_service, DailyLetterApplyReceiptsRequest, DailyLetterGenerateRequest,
    DailyLetterGetRequest, DailyLetterListRequest, DailyLetterRecord, DailyLetterRunSummary,
    DailyLetterSealRequest, DailyLetterState, DailyLetterUpdateContinuationRequest,
};

fn daily_letter_service() -> Result<std::sync::Arc<sparo_core::service::DailyLetterService>, String>
{
    get_global_daily_letter_service()
        .ok_or_else(|| "Daily letter service is not initialized".to_string())
}

#[tauri::command]
pub async fn daily_letter_list(
    request: DailyLetterListRequest,
) -> Result<Vec<DailyLetterRecord>, String> {
    debug!("Listing daily letters");
    daily_letter_service()?
        .list(request)
        .await
        .map_err(|error| {
            error!("Failed to list daily letters: {}", error);
            format!("Failed to list daily letters: {}", error)
        })
}

#[tauri::command]
pub async fn daily_letter_get(
    request: DailyLetterGetRequest,
) -> Result<Option<DailyLetterRecord>, String> {
    debug!("Getting daily letter");
    daily_letter_service()?.get(request).await.map_err(|error| {
        error!("Failed to get daily letter: {}", error);
        format!("Failed to get daily letter: {}", error)
    })
}

#[tauri::command]
pub async fn daily_letter_generate(
    request: DailyLetterGenerateRequest,
) -> Result<DailyLetterRunSummary, String> {
    debug!("Generating daily letter");
    daily_letter_service()?
        .run_now(request)
        .await
        .map_err(|error| {
            error!("Failed to generate daily letter: {}", error);
            format!("Failed to generate daily letter: {}", error)
        })
}

#[tauri::command]
pub async fn daily_letter_apply_receipts(
    request: DailyLetterApplyReceiptsRequest,
) -> Result<DailyLetterRecord, String> {
    debug!("Applying daily letter receipts");
    daily_letter_service()?
        .apply_receipts(request)
        .await
        .map_err(|error| {
            error!("Failed to apply daily letter receipts: {}", error);
            format!("Failed to apply daily letter receipts: {}", error)
        })
}

#[tauri::command]
pub async fn daily_letter_seal(
    request: DailyLetterSealRequest,
) -> Result<DailyLetterRecord, String> {
    debug!("Sealing daily letter");
    daily_letter_service()?
        .seal(request)
        .await
        .map_err(|error| {
            error!("Failed to seal daily letter: {}", error);
            format!("Failed to seal daily letter: {}", error)
        })
}

#[tauri::command]
pub async fn daily_letter_update_continuation(
    request: DailyLetterUpdateContinuationRequest,
) -> Result<DailyLetterRecord, String> {
    debug!("Updating daily letter continuation");
    daily_letter_service()?
        .update_continuation(request)
        .await
        .map_err(|error| {
            error!("Failed to update daily letter continuation: {}", error);
            format!("Failed to update daily letter continuation: {}", error)
        })
}

#[tauri::command]
pub async fn daily_letter_state() -> Result<DailyLetterState, String> {
    debug!("Reading daily letter state");
    Ok(daily_letter_service()?.state_snapshot().await)
}
