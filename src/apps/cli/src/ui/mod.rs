/// TUI interface module
///
/// Build terminal user interface using ratatui
pub mod chat;
pub mod commands;
pub mod markdown;
pub mod panels;
pub mod startup;
pub mod string_utils;
pub mod theme;
pub mod tool_cards;
pub mod widgets;

use anyhow::Result;
use crossterm::{
    event::{DisableMouseCapture, EnableMouseCapture},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Alignment, Constraint, Direction, Layout},
    text::{Line, Span},
    widgets::Paragraph,
    Terminal,
};
use std::io;
use unicode_width::UnicodeWidthStr;

use self::{
    string_utils::truncate_str,
    theme::{StyleKind, Theme},
};

/// Initialize terminal
pub fn init_terminal() -> Result<Terminal<CrosstermBackend<io::Stdout>>> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    if let Err(error) = execute!(stdout, EnterAlternateScreen, EnableMouseCapture) {
        let _ = disable_raw_mode();
        return Err(error.into());
    }
    let backend = CrosstermBackend::new(stdout);
    match Terminal::new(backend) {
        Ok(terminal) => Ok(terminal),
        Err(error) => {
            let _ = execute!(io::stdout(), DisableMouseCapture, LeaveAlternateScreen);
            let _ = disable_raw_mode();
            Err(error.into())
        }
    }
}

/// Restore terminal
pub fn restore_terminal(mut terminal: Terminal<CrosstermBackend<io::Stdout>>) -> Result<()> {
    let mut first_error: Option<anyhow::Error> = None;

    if let Err(error) = execute!(
        terminal.backend_mut(),
        DisableMouseCapture,
        LeaveAlternateScreen
    ) {
        first_error.get_or_insert_with(|| error.into());
    }

    if let Err(error) = disable_raw_mode() {
        first_error.get_or_insert_with(|| error.into());
    }

    if let Err(error) = terminal.show_cursor() {
        first_error.get_or_insert_with(|| error.into());
    }

    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

/// Render a loading/status message on the terminal (stays in alternate screen)
pub fn render_loading(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    message: &str,
) -> Result<()> {
    let msg = message.to_string();
    terminal.draw(|frame| {
        let area = frame.area();
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Percentage(45),
                Constraint::Length(3),
                Constraint::Percentage(45),
            ])
            .split(area);

        let theme = Theme::dark();
        let paragraph = Paragraph::new(loading_control_lines(&theme, &msg, chunks[1].width))
            .alignment(Alignment::Center);
        frame.render_widget(paragraph, chunks[1]);
    })?;
    Ok(())
}

fn loading_control_lines(theme: &Theme, message: &str, width: u16) -> Vec<Line<'static>> {
    let width = width as usize;
    let frame_width = width.saturating_sub(4).min(72).max(width.min(18));
    let inner_width = frame_width.saturating_sub(2).max(8);
    let label_width = inner_width.saturating_sub(4);
    let label = truncate_str(message, label_width);
    let fill = label_width.saturating_sub(label.width());
    let horizontal = "-".repeat(inner_width);
    let corner_style = theme.style(StyleKind::Primary);
    let border_style = theme.style(StyleKind::Border);
    let rail_style = theme.style(StyleKind::Faint);

    vec![
        Line::from(vec![
            Span::styled("+", corner_style),
            Span::styled(horizontal.clone(), rail_style),
            Span::styled("+", corner_style),
        ]),
        Line::from(vec![
            Span::styled("| ", border_style),
            Span::styled("/", corner_style),
            Span::raw(" "),
            Span::styled(label, theme.style(StyleKind::Text)),
            Span::raw(" ".repeat(fill)),
            Span::styled(" |", border_style),
        ]),
        Line::from(vec![
            Span::styled("+", corner_style),
            Span::styled(horizontal, rail_style),
            Span::styled("+", corner_style),
        ]),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line_text(lines: Vec<Line<'static>>) -> String {
        lines
            .into_iter()
            .map(|line| {
                line.spans
                    .into_iter()
                    .map(|span| span.content.into_owned())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn loading_control_uses_drafting_frame() {
        let rendered = line_text(loading_control_lines(
            &Theme::dark(),
            "Loading workspace",
            80,
        ));

        assert!(rendered.contains("+"));
        assert!(rendered.contains("| / Loading workspace"));
        assert!(rendered.contains("-"));
    }
}
