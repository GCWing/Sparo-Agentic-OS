/// Compact tool timeline rendering.
use ratatui::{
    text::{Line, Span},
    widgets::ListItem,
};

use super::string_utils::{prettify_result, truncate_str};
use super::theme::{tool_icon, StyleKind, Theme};
use crate::session::{ToolCall, ToolCallStatus};

pub fn render_tool_card<'a>(tool_call: &'a ToolCall, theme: &Theme) -> Vec<ListItem<'a>> {
    let mut items = Vec::new();
    let (status_mark, status_style, trailing) = status_parts(tool_call, theme);
    let target = truncate_str(&extract_key_params(&tool_call.parameters), 58);
    let summary = result_summary(tool_call);

    items.push(ListItem::new(Line::from(vec![
        Span::raw("   "),
        Span::styled(status_mark, status_style),
        Span::raw(" "),
        Span::styled(
            tool_icon(&tool_call.tool_name),
            theme.style(StyleKind::Title),
        ),
        Span::raw("   "),
        Span::styled(target, theme.style(StyleKind::Text)),
        Span::raw("   "),
        Span::styled(trailing, theme.style(StyleKind::Muted)),
    ])));

    if !summary.is_empty() {
        items.push(ListItem::new(Line::from(vec![
            Span::raw("       | "),
            Span::styled(summary, theme.style(StyleKind::Muted)),
        ])));
    }

    items
}

fn status_parts<'a>(
    tool_call: &'a ToolCall,
    theme: &Theme,
) -> (&'static str, ratatui::style::Style, &'a str) {
    match tool_call.status {
        ToolCallStatus::Running | ToolCallStatus::Streaming => (
            "*",
            theme.style(StyleKind::Primary),
            tool_call.progress_message.as_deref().unwrap_or("running"),
        ),
        ToolCallStatus::Success => ("ok", theme.style(StyleKind::Success), "done"),
        ToolCallStatus::Failed => ("x", theme.style(StyleKind::Error), "failed"),
        ToolCallStatus::ConfirmationNeeded => ("?", theme.style(StyleKind::Warning), "confirm y/n"),
        ToolCallStatus::Confirmed => (">", theme.style(StyleKind::Primary), "confirmed"),
        ToolCallStatus::Waiting | ToolCallStatus::Queued => {
            (">", theme.style(StyleKind::Muted), "queued")
        }
        ToolCallStatus::Cancelled | ToolCallStatus::Rejected => {
            ("x", theme.style(StyleKind::Warning), "cancelled")
        }
        _ => ("-", theme.style(StyleKind::Muted), "pending"),
    }
}

fn result_summary(tool_call: &ToolCall) -> String {
    tool_call
        .result
        .as_ref()
        .map(|result| truncate_str(&prettify_result(result), 92))
        .unwrap_or_default()
}

fn extract_key_params(params: &serde_json::Value) -> String {
    if let Some(obj) = params.as_object() {
        let priority_keys = [
            "path",
            "file_path",
            "target_file",
            "target_directory",
            "query",
            "pattern",
            "command",
            "message",
        ];

        for key in &priority_keys {
            if let Some(value) = obj.get(*key).and_then(|v| v.as_str()) {
                return value.to_string();
            }
        }

        if let Some((key, value)) = obj.iter().next() {
            return match value.as_str() {
                Some(text) => format!("{}: {}", key, text),
                None => format!("{}: {}", key, value),
            };
        }
    }

    "working".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool_with_status(status: ToolCallStatus) -> ToolCall {
        ToolCall {
            tool_id: Some("tool-1".to_string()),
            tool_name: "BashTool".to_string(),
            parameters: serde_json::json!({"command": "git status"}),
            result: None,
            status,
            progress: None,
            progress_message: None,
            duration_ms: None,
        }
    }

    #[test]
    fn tool_card_surfaces_confirmation_prompt() {
        let theme = Theme::dark();
        let tool = tool_with_status(ToolCallStatus::ConfirmationNeeded);

        let (mark, _style, trailing) = status_parts(&tool, &theme);

        assert_eq!(mark, "?");
        assert_eq!(trailing, "confirm y/n");
    }

    #[test]
    fn tool_card_surfaces_confirmed_state() {
        let theme = Theme::dark();
        let tool = tool_with_status(ToolCallStatus::Confirmed);

        let (mark, _style, trailing) = status_parts(&tool, &theme);

        assert_eq!(mark, ">");
        assert_eq!(trailing, "confirmed");
    }
}
