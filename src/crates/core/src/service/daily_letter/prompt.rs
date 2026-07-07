use super::types::DailyLetterContextPacket;
use crate::error::{CoreError, CoreResult};

pub(crate) fn daily_letter_allowed_tools() -> Vec<String> {
    ["LS", "Read", "Glob", "Grep"]
        .into_iter()
        .map(str::to_string)
        .collect()
}

pub(crate) fn build_daily_letter_user_prompt(
    packet: &DailyLetterContextPacket,
) -> CoreResult<String> {
    let json = serde_json::to_string_pretty(packet).map_err(|error| {
        CoreError::service(format!(
            "Failed to serialize daily letter context packet: {}",
            error
        ))
    })?;
    Ok(format!(
        "Write Daily Letter from this context packet.\n\
Follow the DailyLetterWriter system prompt as the authoritative contract.\n\
Use the packet as the evidence map. Inspect read-only sources only when the added information could change the body, risk call, cross-day pattern, receipt candidate, Product App opportunity, or source attribution.\n\
Use the packet locale, date, and coverage window. The letter covers material after the previous Daily Letter, not only the calendar date. Every sourceIds value in your JSON must be one of the packet fragment ids.\n\
Return only JSON.\n\n{}",
        json
    ))
}
