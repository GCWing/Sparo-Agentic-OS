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
        "Write today's Daily Letter from this context packet.\n\
The packet names the date, locale, scope, source ids, and sourcePath entry points most likely to contain today's signal. Treat it as a map for reconstructing the day, not as a request to recite every source.\n\
Use only the read-only tools LS, Glob, Grep, and Read. Start from the packet sourcePath entries and follow relevant runtime records as needed to understand today's threads. Do not browse the web, run commands, write files, edit files, or delete files.\n\
Raw records may contain secrets or personal data. Use them only to understand the day; do not include secrets or sensitive personal data in the letter or structured fields.\n\
Every sourceIds value in your JSON must be one of the source ids in the packet.\n\
Return only JSON.\n\n{}",
        json
    ))
}
