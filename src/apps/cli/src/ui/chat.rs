/// Chat mode TUI interface
use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout, Margin, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap},
    Frame,
};
use std::collections::VecDeque;
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use super::commands::CommandScope;
use super::markdown::MarkdownRenderer;
use super::panels::{render_overlay, OverlayState};
use super::string_utils::truncate_str;
use super::theme::{StyleKind, Theme};
use super::widgets::{HelpText, Spinner};
use crate::session::{FlowItem, Message, Session};

fn compact_workspace_label(workspace: Option<&str>) -> String {
    let Some(raw) = workspace.map(str::trim).filter(|value| !value.is_empty()) else {
        return "global".to_string();
    };

    let normalized = raw.replace('\\', "/");
    let with_home = dirs::home_dir()
        .map(|home| home.to_string_lossy().replace('\\', "/"))
        .and_then(|home| {
            normalized
                .strip_prefix(&home)
                .map(|rest| format!("~{}", rest))
        })
        .unwrap_or(normalized);

    truncate_str(&with_home, 36)
}

fn chat_shortcut_items(browse_mode: bool, width: u16) -> Vec<(&'static str, &'static str)> {
    if browse_mode {
        if width < 64 {
            return vec![("^E", "Exit browse "), ("Esc", "Exit "), ("^B", "Home ")];
        }
        if width >= 96 {
            return vec![
                ("Up/Dn", "Scroll "),
                ("PgUp/Dn", "Page "),
                ("^Home/End", "Top/Bot "),
                ("^E", "Exit browse "),
                ("Esc", "Exit "),
                ("^B", "Home "),
            ];
        }
        return vec![
            ("Up/Dn", "Scroll "),
            ("PgUp/Dn", "Page "),
            ("^E", "Exit browse "),
            ("Esc", "Exit "),
            ("^B", "Home "),
        ];
    }

    if width < 64 {
        return vec![("/", "Cmd "), ("^E", "Browse "), ("^C", "Quit ")];
    }

    if width < 104 {
        return vec![
            ("/", "Cmd "),
            ("^T/P/Y/O/,", "Panels "),
            ("/sessions", "Sessions "),
            ("^U", "Clear input "),
            ("^L", "Clear "),
            ("^E", "Browse "),
            ("Esc", "Home "),
            ("^C", "Quit "),
        ];
    }

    vec![
        ("/", "Cmd "),
        ("^T", "Tasks "),
        ("^P", "Apps "),
        ("^Y", "Memory "),
        ("^O", "Work "),
        ("^,", "Settings "),
        ("/sessions", "Sessions "),
        ("^U", "Clear input "),
        ("^L", "Clear "),
        ("^E", "Browse "),
        ("Esc", "Home "),
        ("^C", "Quit "),
    ]
}

fn compact_inline_text(value: &str, max_bytes: usize) -> String {
    let first_line = value.lines().next().unwrap_or("");
    if first_line.len() <= max_bytes {
        return first_line.to_string();
    }
    if max_bytes <= 3 {
        return ".".repeat(max_bytes);
    }
    truncate_str(first_line, max_bytes.saturating_sub(3))
}

fn status_bar_text(
    status: Option<&str>,
    message_count: usize,
    tool_count: usize,
    file_count: usize,
    browse_mode: bool,
    width: u16,
) -> String {
    let raw = status.map(str::to_string).unwrap_or_else(|| {
        format!("{message_count} messages | {tool_count} tools | {file_count} files")
    });
    let reserved = if browse_mode { 12 } else { 2 };
    let max_bytes = (width as usize).saturating_sub(reserved).max(8);
    compact_inline_text(&raw, max_bytes)
}

fn chars_width(chars: &[char]) -> usize {
    chars.iter().collect::<String>().width()
}

fn visible_input_window(input: &str, cursor: usize, max_width: usize) -> (String, u16) {
    if max_width == 0 || input.is_empty() {
        return (String::new(), 0);
    }

    let chars: Vec<char> = input.chars().collect();
    let cursor = cursor.min(chars.len());
    let mut start = 0;
    while start < cursor && chars_width(&chars[start..cursor]) > max_width {
        start += 1;
    }

    let mut end = cursor;
    while end < chars.len() && chars_width(&chars[start..=end]) <= max_width {
        end += 1;
    }

    let visible = chars[start..end].iter().collect::<String>();
    let cursor_x = chars_width(&chars[start..cursor]).min(max_width) as u16;
    (visible, cursor_x)
}

fn wrap_plain_line(value: &str, width: usize) -> Vec<String> {
    if width == 0 || value.width() <= width {
        return vec![value.to_string()];
    }

    let width = width.max(8);
    let mut lines = Vec::new();
    let mut current = String::new();
    let mut current_width = 0usize;

    for ch in value.chars() {
        let ch_width = UnicodeWidthChar::width(ch).unwrap_or(0);
        if current_width > 0 && current_width + ch_width > width {
            lines.push(std::mem::take(&mut current));
            current_width = 0;
        }

        current.push(ch);
        current_width += ch_width;
    }

    if !current.is_empty() {
        lines.push(current);
    }

    lines
}

/// Chat interface state
pub struct ChatView {
    /// Theme
    pub theme: Theme,
    /// Current session
    pub session: Session,
    /// Input buffer
    pub input: String,
    /// Input cursor position
    pub cursor: usize,
    /// List scroll state
    pub list_state: ListState,
    /// Whether to auto-scroll to bottom
    pub auto_scroll: bool,
    /// Whether loading
    pub loading: bool,
    /// Loading animation
    pub spinner: Spinner,
    /// Status message
    pub status: Option<String>,
    /// Input history (for up/down arrows)
    pub input_history: VecDeque<String>,
    /// History position
    pub history_index: Option<usize>,
    /// Markdown renderer
    markdown_renderer: MarkdownRenderer,
    /// Whether in browse mode (for scrolling through history)
    pub browse_mode: bool,
    /// Message scroll offset (from bottom up)
    pub scroll_offset: usize,
    /// Active overlay panel or command palette.
    pub overlay: Option<OverlayState>,
    /// Last rendered message width, used to keep browse scroll math aligned.
    message_width: usize,
}

impl ChatView {
    /// Create new Chat view
    pub fn new(session: Session, theme: Theme) -> Self {
        let markdown_renderer = MarkdownRenderer::new(theme.clone());
        Self {
            spinner: Spinner::new(theme.style(StyleKind::Primary)),
            markdown_renderer,
            theme,
            session,
            input: String::new(),
            cursor: 0,
            list_state: ListState::default(),
            auto_scroll: true,
            loading: false,
            status: None,
            input_history: VecDeque::with_capacity(50),
            history_index: None,
            browse_mode: false,
            scroll_offset: 0,
            overlay: None,
            message_width: 80,
        }
    }

    /// Render interface
    pub fn render(&mut self, frame: &mut Frame) {
        let size = frame.area();

        // Minimal, borderless layout: header, separator, messages, status,
        // separator, input, shortcuts. Whitespace and thin rules replace boxes.
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(1), // header
                Constraint::Length(1), // rule
                Constraint::Min(8),    // messages area
                Constraint::Length(1), // status bar
                Constraint::Length(1), // rule
                Constraint::Length(1), // input area
                Constraint::Length(1), // shortcuts hint
            ])
            .split(size);

        self.render_header(frame, chunks[0]);
        self.render_rule(frame, chunks[1]);
        self.render_messages(frame, chunks[2]);
        self.render_status_bar(frame, chunks[3]);
        self.render_rule(frame, chunks[4]);
        self.render_input(frame, chunks[5]);
        self.render_shortcuts(frame, chunks[6]);

        if let Some(overlay) = &mut self.overlay {
            render_overlay(frame, size, &self.theme, overlay, CommandScope::Chat);
        }
    }

    /// Render a thin full-width horizontal rule.
    fn render_rule(&self, frame: &mut Frame, area: Rect) {
        let block = Block::default()
            .borders(Borders::TOP)
            .border_style(self.theme.style(StyleKind::Border));
        frame.render_widget(block, area);
    }

    /// Render header
    fn render_header(&self, frame: &mut Frame, area: Rect) {
        let title_style = Style::default()
            .fg(self.theme.ignition)
            .add_modifier(Modifier::BOLD);

        let workspace = compact_workspace_label(self.session.workspace.as_deref());

        let line = Line::from(vec![
            Span::raw("  "),
            Span::styled("SPARO", title_style),
            Span::styled("  |  ", self.theme.style(StyleKind::Faint)),
            Span::styled(
                truncate_str(&self.session.agent, 22),
                self.theme.style(StyleKind::Primary),
            ),
            Span::styled("  |  ", self.theme.style(StyleKind::Faint)),
            Span::styled(workspace, self.theme.style(StyleKind::Muted)),
            Span::styled(
                format!("  |  v{}", env!("CARGO_PKG_VERSION")),
                self.theme.style(StyleKind::Faint),
            ),
        ]);

        frame.render_widget(Paragraph::new(line), area);
    }

    fn render_messages(&mut self, frame: &mut Frame, area: Rect) {
        // Pad the message column so text breathes without a surrounding box.
        let inner = area.inner(Margin {
            horizontal: 2,
            vertical: 0,
        });

        if self.session.messages.is_empty() {
            // Vertically center a calm, minimal welcome.
            let top = inner.height.saturating_sub(5) / 2;
            let welcome = vec![
                Line::from(Span::styled(
                    "How can I help you today?",
                    self.theme.style(StyleKind::Title),
                )),
                Line::from(""),
                Line::from(Span::styled(
                    "Describe a task in natural language and Sparo gets to work.",
                    self.theme.style(StyleKind::Muted),
                )),
                Line::from(""),
                Line::from(vec![
                    Span::styled("Type ", self.theme.style(StyleKind::Faint)),
                    Span::styled("/", self.theme.style(StyleKind::Primary)),
                    Span::styled(" for commands", self.theme.style(StyleKind::Faint)),
                ]),
            ];

            let target = Rect {
                x: inner.x,
                y: inner.y + top,
                width: inner.width,
                height: inner.height.saturating_sub(top),
            };
            let paragraph = Paragraph::new(welcome)
                .alignment(Alignment::Center)
                .wrap(Wrap { trim: true });

            frame.render_widget(paragraph, target);
        } else {
            let message_width = inner.width.saturating_sub(2).max(8) as usize;
            self.message_width = message_width;
            let messages: Vec<ListItem> = self
                .session
                .messages
                .iter()
                .flat_map(|msg| self.render_message(msg, message_width))
                .collect();

            if !messages.is_empty() {
                let total_lines = messages.len();
                let visible_lines = inner.height as usize;

                if self.browse_mode {
                    let view_position = if self.scroll_offset >= total_lines {
                        0
                    } else {
                        total_lines.saturating_sub(self.scroll_offset + visible_lines)
                    };

                    *self.list_state.offset_mut() = view_position;

                    let selected_index = view_position + visible_lines / 2;
                    self.list_state
                        .select(Some(selected_index.min(total_lines.saturating_sub(1))));
                } else if self.auto_scroll {
                    let bottom_offset = total_lines.saturating_sub(visible_lines);
                    *self.list_state.offset_mut() = bottom_offset;

                    let last_index = total_lines.saturating_sub(1);
                    self.list_state.select(Some(last_index));
                    self.scroll_offset = 0;
                }

                if self.browse_mode {
                    let progress_pct = if self.scroll_offset == 0 {
                        100
                    } else if self.scroll_offset >= total_lines {
                        0
                    } else {
                        ((total_lines - self.scroll_offset) * 100 / total_lines).min(100)
                    };

                    let scroll_indicator = format!("{}%", progress_pct);
                    let indicator_area = Rect {
                        x: inner.x + inner.width.saturating_sub(12),
                        y: inner.y,
                        width: 10,
                        height: 1,
                    };

                    let indicator_widget = Paragraph::new(scroll_indicator)
                        .style(self.theme.style(StyleKind::Info))
                        .alignment(Alignment::Right);
                    frame.render_widget(indicator_widget, indicator_area);
                }
            }

            let list = List::new(messages).highlight_style(Style::default());

            frame.render_stateful_widget(list, inner, &mut self.list_state);
        }

        if self.loading {
            self.spinner.tick();
            let loading_text = format!("{} Thinking...", self.spinner.current());
            let loading_span = Span::styled(loading_text, self.theme.style(StyleKind::Primary));

            let loading_area = Rect {
                x: inner.x + 2,
                y: inner.y + inner.height.saturating_sub(1),
                width: inner.width.saturating_sub(4),
                height: 1,
            };

            let paragraph = Paragraph::new(loading_span);
            frame.render_widget(paragraph, loading_area);
        }
    }

    fn render_message<'a>(
        &self,
        message: &'a Message,
        available_width: usize,
    ) -> Vec<ListItem<'a>> {
        let mut items = Vec::new();

        let role_style = match message.role.as_str() {
            "user" => self.theme.style(StyleKind::Success),
            "assistant" => self.theme.style(StyleKind::Primary),
            _ => self.theme.style(StyleKind::Muted),
        };

        let role_prefix = match message.role.as_str() {
            "user" => "You:",
            "assistant" => "Sparo:",
            _ => "System:",
        };

        let time = message.timestamp.format("%H:%M:%S");

        items.push(ListItem::new(Line::from(vec![Span::raw("")])));

        items.push(ListItem::new(Line::from(vec![
            Span::styled(role_prefix, role_style.add_modifier(Modifier::BOLD)),
            Span::raw(" "),
            Span::styled(format!("[{}]", time), self.theme.style(StyleKind::Muted)),
        ])));

        if !message.flow_items.is_empty() {
            for flow_item in &message.flow_items {
                match flow_item {
                    FlowItem::Text {
                        content,
                        is_streaming,
                    } => {
                        if message.role == "assistant"
                            && MarkdownRenderer::has_markdown_syntax(content)
                        {
                            let markdown_lines =
                                self.markdown_renderer.render(content, available_width);

                            for md_line in markdown_lines {
                                let mut spans = vec![Span::raw("  ")];
                                spans.extend(md_line.spans);
                                items.push(ListItem::new(Line::from(spans)));
                            }
                        } else {
                            for line in content.lines() {
                                for wrapped_line in wrap_plain_line(line, available_width) {
                                    items.push(ListItem::new(Line::from(vec![
                                        Span::raw("  "),
                                        Span::raw(wrapped_line),
                                    ])));
                                }
                            }
                        }

                        if *is_streaming {
                            items.push(ListItem::new(Line::from(vec![
                                Span::raw("  "),
                                Span::styled("|", self.theme.style(StyleKind::Primary)),
                            ])));
                        }
                    }

                    FlowItem::Tool { tool_call } => {
                        items.push(ListItem::new(Line::from("")));
                        let tool_items =
                            crate::ui::tool_cards::render_tool_card(tool_call, &self.theme);
                        items.extend(tool_items);
                    }
                }
            }
        } else if message.role == "assistant"
            && MarkdownRenderer::has_markdown_syntax(&message.content)
        {
            let markdown_lines = self
                .markdown_renderer
                .render(&message.content, available_width);

            for md_line in markdown_lines {
                let mut spans = vec![Span::raw("  ")];
                spans.extend(md_line.spans);
                items.push(ListItem::new(Line::from(spans)));
            }
        } else {
            for line in message.content.lines() {
                for wrapped_line in wrap_plain_line(line, available_width) {
                    items.push(ListItem::new(Line::from(vec![
                        Span::raw("  "),
                        Span::raw(wrapped_line),
                    ])));
                }
            }
        }

        items
    }

    /// Render status bar
    fn render_status_bar(&self, frame: &mut Frame, area: Rect) {
        let mut spans = vec![Span::raw("  ")];

        let status_text = status_bar_text(
            self.status.as_deref(),
            self.session.metadata.message_count,
            self.session.metadata.tool_calls,
            self.session.metadata.files_modified,
            self.browse_mode,
            area.width,
        );

        if self.status.is_some() {
            spans.push(Span::styled(
                status_text,
                self.theme.style(StyleKind::Muted),
            ));
        } else {
            spans.push(Span::styled(
                status_text,
                self.theme.style(StyleKind::Muted),
            ));
        }

        if self.browse_mode {
            spans.push(Span::styled(
                "    BROWSE",
                self.theme.style(StyleKind::Primary),
            ));
        }

        frame.render_widget(
            Paragraph::new(Line::from(spans)).alignment(Alignment::Left),
            area,
        );
    }
    fn render_input(&self, frame: &mut Frame, area: Rect) {
        let prompt = if self.loading { "  . " } else { "  > " };
        let prompt_style = if self.loading {
            self.theme.style(StyleKind::Muted)
        } else {
            self.theme.style(StyleKind::Primary)
        };

        let input_area_width = area.width.saturating_sub(4) as usize;
        let (visible_input, cursor_x) =
            visible_input_window(&self.input, self.cursor, input_area_width);
        let input_text = if self.input.is_empty() {
            Span::styled(
                "Talk to Sparo, or / for commands",
                self.theme.style(StyleKind::Muted),
            )
        } else {
            Span::styled(visible_input, self.theme.style(StyleKind::Text))
        };

        let paragraph = Paragraph::new(Line::from(vec![
            Span::styled(prompt, prompt_style),
            input_text,
        ]));

        frame.render_widget(paragraph, area);

        // Place the cursor right after the prompt + typed text.
        if !self.loading {
            frame.set_cursor_position((area.x + 4 + cursor_x, area.y));
        }
    }

    fn render_shortcuts(&self, frame: &mut Frame, area: Rect) {
        let help = HelpText {
            shortcuts: chat_shortcut_items(self.browse_mode, area.width)
                .into_iter()
                .map(|(key, desc)| (key.to_string(), desc.to_string()))
                .collect(),
            style: self.theme.style(StyleKind::Muted),
        };

        let paragraph = Paragraph::new(help.render()).alignment(Alignment::Center);

        frame.render_widget(paragraph, area);
    }

    /// Add message to session
    pub fn add_message(&mut self, role: String, content: String) {
        self.session.add_message(role, content);
        // Ensure auto-scroll to latest message
        self.auto_scroll = true;
    }

    /// Send user input
    pub fn send_input(&mut self) -> Option<String> {
        let input = self.take_input()?;

        // Add to session (will auto-trigger scroll)
        self.add_message("user".to_string(), input.clone());

        Some(input)
    }

    /// Take the current input for local UI commands without adding a chat message.
    pub fn take_input(&mut self) -> Option<String> {
        if self.input.trim().is_empty() {
            return None;
        }

        let input = self.input.clone();

        self.push_input_history(input.clone());
        self.history_index = None;

        // Clear input
        self.input.clear();
        self.cursor = 0;

        Some(input)
    }

    pub fn replace_input_preserving_draft(&mut self, input: String) -> bool {
        let saved_draft = !self.input.trim().is_empty() && self.input != input;
        if saved_draft {
            self.push_input_history(self.input.clone());
        }
        self.input = input;
        self.move_cursor_to_end();
        self.history_index = None;
        saved_draft
    }

    fn push_input_history(&mut self, input: String) {
        self.input_history.push_front(input);
        if self.input_history.len() > 50 {
            self.input_history.pop_back();
        }
    }

    pub fn handle_char(&mut self, c: char) {
        if c.is_control() || c == '\u{0}' {
            return;
        }

        let byte_pos = self.char_pos_to_byte_pos(self.cursor);
        self.input.insert(byte_pos, c);
        self.cursor += 1;
        self.history_index = None;
    }

    pub fn handle_backspace(&mut self) {
        if self.cursor > 0 && !self.input.is_empty() {
            let byte_pos = self.char_pos_to_byte_pos(self.cursor - 1);
            if byte_pos < self.input.len() {
                self.input.remove(byte_pos);
                self.cursor -= 1;
                self.history_index = None;
            }
        }
    }

    pub fn clear_input(&mut self) {
        self.input.clear();
        self.cursor = 0;
        self.history_index = None;
    }

    pub fn move_cursor_left(&mut self) {
        if self.cursor > 0 {
            self.cursor -= 1;
        }
    }

    pub fn move_cursor_right(&mut self) {
        if self.cursor < self.input_char_count() {
            self.cursor += 1;
        }
    }

    pub fn move_cursor_to_end(&mut self) {
        self.cursor = self.input_char_count();
    }

    fn input_char_count(&self) -> usize {
        self.input.chars().count()
    }

    fn char_pos_to_byte_pos(&self, char_pos: usize) -> usize {
        self.input
            .char_indices()
            .nth(char_pos)
            .map(|(pos, _)| pos)
            .unwrap_or(self.input.len())
    }

    pub fn history_prev(&mut self) {
        if self.input_history.is_empty() {
            return;
        }

        let new_index = match self.history_index {
            None => 0,
            Some(i) if i + 1 < self.input_history.len() => i + 1,
            Some(i) => i,
        };

        if let Some(history_item) = self.input_history.get(new_index) {
            self.input = history_item.clone();
            self.move_cursor_to_end();
            self.history_index = Some(new_index);
        }
    }

    pub fn history_next(&mut self) {
        match self.history_index {
            None => {}
            Some(0) => {
                self.input.clear();
                self.cursor = 0;
                self.history_index = None;
            }
            Some(i) => {
                let new_index = i - 1;
                if let Some(history_item) = self.input_history.get(new_index) {
                    self.input = history_item.clone();
                    self.move_cursor_to_end();
                    self.history_index = Some(new_index);
                }
            }
        }
    }

    pub fn clear_screen(&mut self) {
        self.session.messages.clear();
        self.session.metadata.message_count = 0;
        self.session.metadata.tool_calls = 0;
        self.session.metadata.files_modified = 0;
        self.list_state.select(None);
        self.auto_scroll = true;
        self.scroll_offset = 0;
        self.browse_mode = false;
    }

    pub fn start_new_session(&mut self) {
        let agent = self.session.agent.clone();
        let workspace = self.session.workspace.clone();
        self.session = Session::new(agent, workspace);
        self.input.clear();
        self.cursor = 0;
        self.history_index = None;
        self.auto_scroll = true;
        self.browse_mode = false;
        self.scroll_offset = 0;
        self.list_state.select(None);
    }

    pub fn set_loading(&mut self, loading: bool) {
        self.loading = loading;
    }

    pub fn set_status(&mut self, status: Option<String>) {
        self.status = status;
    }

    pub fn toggle_browse_mode(&mut self) {
        self.browse_mode = !self.browse_mode;
        if self.browse_mode {
            self.auto_scroll = false;
        } else {
            self.auto_scroll = true;
            self.scroll_offset = 0;
        }
    }

    pub fn scroll_up(&mut self, lines: usize) {
        if self.browse_mode {
            let total_lines: usize = self
                .session
                .messages
                .iter()
                .flat_map(|msg| self.render_message(msg, self.message_width))
                .count();

            self.scroll_offset = (self.scroll_offset + lines).min(total_lines.saturating_sub(1));
        } else {
            self.browse_mode = true;
            self.auto_scroll = false;
            self.scroll_offset = lines;
        }
    }

    pub fn scroll_down(&mut self, lines: usize) {
        if self.scroll_offset > 0 {
            self.scroll_offset = self.scroll_offset.saturating_sub(lines);

            if self.scroll_offset == 0 && self.browse_mode {
                self.browse_mode = false;
                self.auto_scroll = true;
            }
        }
    }

    pub fn scroll_to_top(&mut self) {
        let total_lines: usize = self
            .session
            .messages
            .iter()
            .flat_map(|msg| self.render_message(msg, self.message_width))
            .count();

        self.browse_mode = true;
        self.auto_scroll = false;
        self.scroll_offset = total_lines.saturating_sub(1);
    }

    pub fn scroll_to_bottom(&mut self) {
        self.browse_mode = false;
        self.auto_scroll = true;
        self.scroll_offset = 0;
    }

    pub fn open_overlay(&mut self, overlay: OverlayState) {
        self.overlay = Some(overlay);
    }

    pub fn close_overlay(&mut self) {
        self.overlay = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui::commands::PanelKind;
    use bitfun_core::command::agentic_os::AgenticOsSnapshot;
    use ratatui::{backend::TestBackend, Terminal};

    fn render_view(view: &mut ChatView, width: u16, height: u16) {
        let backend = TestBackend::new(width, height);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal.draw(|frame| view.render(frame)).unwrap();
    }

    #[test]
    fn chat_empty_state_renders_at_common_sizes() {
        let session = Session::new(
            "Dispatcher".to_string(),
            Some("D:\\workspace\\project".to_string()),
        );
        let mut view = ChatView::new(session, Theme::dark());

        render_view(&mut view, 100, 30);
        render_view(&mut view, 48, 14);
    }

    #[test]
    fn chat_plain_message_lines_wrap_to_terminal_width() {
        let lines = wrap_plain_line(
            "This assistant message is intentionally long enough for a compact terminal.",
            24,
        );

        assert!(lines.len() > 1);
        assert!(lines.iter().all(|line| line.width() <= 24));
    }

    #[test]
    fn chat_header_workspace_label_preserves_context_compactly() {
        assert_eq!(compact_workspace_label(None), "global");
        assert_eq!(compact_workspace_label(Some("   ")), "global");
        assert_eq!(
            compact_workspace_label(Some("D:\\workspace\\project")),
            "D:/workspace/project"
        );

        let compact = compact_workspace_label(Some(
            "D:\\workspace\\project\\with\\a\\very\\deep\\nested\\path\\that\\keeps\\going",
        ));
        assert!(compact.starts_with("D:/workspace/project"));
        assert!(compact.ends_with("..."));
    }

    #[test]
    fn chat_shortcuts_adapt_to_available_width() {
        let compact = chat_shortcut_items(false, 48);
        assert_eq!(
            compact,
            vec![("/", "Cmd "), ("^E", "Browse "), ("^C", "Quit ")]
        );

        let medium = chat_shortcut_items(false, 80);
        assert!(medium.contains(&("^T/P/Y/O/,", "Panels ")));
        assert!(medium.contains(&("/sessions", "Sessions ")));
        assert!(medium.contains(&("^U", "Clear input ")));
        assert!(medium.contains(&("^L", "Clear ")));
        assert!(!medium.contains(&("/sessions", "Chapters ")));
        assert!(!medium.contains(&("^T", "Tasks ")));

        let wide = chat_shortcut_items(false, 120);
        assert!(wide.contains(&("^T", "Tasks ")));
        assert!(wide.contains(&("^,", "Settings ")));
        assert!(wide.contains(&("/sessions", "Sessions ")));
        assert!(wide.contains(&("^U", "Clear input ")));
        assert!(wide.contains(&("^L", "Clear ")));
        assert!(!wide.contains(&("^T/P/Y/O/,", "Panels ")));
    }

    #[test]
    fn chat_browse_shortcuts_stay_compact_on_narrow_widths() {
        let compact = chat_shortcut_items(true, 48);
        assert_eq!(
            compact,
            vec![("^E", "Exit browse "), ("Esc", "Exit "), ("^B", "Home ")]
        );

        let wide = chat_shortcut_items(true, 100);
        assert!(wide.contains(&("Up/Dn", "Scroll ")));
        assert!(wide.contains(&("PgUp/Dn", "Page ")));
        assert!(wide.contains(&("^Home/End", "Top/Bot ")));
        assert!(wide.contains(&("Esc", "Exit ")));
    }

    #[test]
    fn chat_status_bar_text_stays_within_width() {
        let status = status_bar_text(
            Some(
                "Error: D:\\workspace\\project\\with\\a\\very\\long\\path\\that\\keeps\\going\nsecond line",
            ),
            0,
            0,
            0,
            false,
            42,
        );

        assert!(status.ends_with("..."));
        assert!(status.len() <= 40);
        assert!(!status.contains("second line"));

        let browse = status_bar_text(Some("Browsing a very long conversation"), 0, 0, 0, true, 30);
        assert!(browse.len() <= 18);

        assert_eq!(
            status_bar_text(None, 3, 2, 1, false, 80),
            "3 messages | 2 tools | 1 files"
        );
    }

    #[test]
    fn chat_visible_input_window_tracks_cursor() {
        let (visible, cursor_x) =
            visible_input_window("sparo sessions export very-long-session-id", 42, 16);

        assert!(visible.ends_with("session-id"));
        assert_eq!(cursor_x as usize, visible.width());
        assert!(visible.width() <= 16);

        let (visible, cursor_x) = visible_input_window("你好世界hello", 4, 6);
        assert_eq!(visible, "好世界");
        assert_eq!(cursor_x, 6);
        assert!(visible.width() <= 6);
    }

    #[test]
    fn chat_message_and_overlay_render_without_panics() {
        let session = Session::new("Dispatcher".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());
        view.add_message("user".to_string(), "Hello".to_string());
        view.add_message(
            "assistant".to_string(),
            "## Done\n\n- rendered\n- stable".to_string(),
        );
        view.open_overlay(OverlayState::panel(
            PanelKind::Settings,
            AgenticOsSnapshot::default(),
        ));

        render_view(&mut view, 100, 30);
        assert!(view.overlay.is_some());
    }

    #[test]
    fn chat_unicode_input_cursor_tracks_characters() {
        let session = Session::new("Dispatcher".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());

        view.handle_char('你');
        view.handle_char('好');
        view.move_cursor_left();
        view.handle_backspace();

        assert_eq!(view.input, "好");
        assert_eq!(view.cursor, 0);
    }

    #[test]
    fn chat_history_and_end_cursor_use_character_positions() {
        let session = Session::new("Dispatcher".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());

        view.input_history.push_front("你好".to_string());
        view.history_prev();
        assert_eq!(view.cursor, 2);

        view.move_cursor_left();
        view.move_cursor_to_end();
        assert_eq!(view.cursor, 2);
    }

    #[test]
    fn chat_replace_input_preserves_existing_draft_in_history() {
        let session = Session::new("Dispatcher".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());
        view.input = "draft question".to_string();
        view.move_cursor_to_end();

        let saved = view.replace_input_preserving_draft("prepared prompt".to_string());

        assert!(saved);
        assert_eq!(view.input, "prepared prompt");
        assert_eq!(view.cursor, "prepared prompt".chars().count());
        assert_eq!(
            view.input_history.front().map(String::as_str),
            Some("draft question")
        );
        assert!(view.history_index.is_none());
    }

    #[test]
    fn chat_input_edits_exit_history_navigation() {
        let session = Session::new("Dispatcher".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());
        view.push_input_history("first command".to_string());
        view.push_input_history("second command".to_string());

        view.history_prev();
        assert_eq!(view.input, "second command");
        assert_eq!(view.history_index, Some(0));

        view.handle_char('!');
        assert!(view.history_index.is_none());
        view.history_next();
        assert_eq!(view.input, "second command!");

        view.history_prev();
        view.handle_backspace();
        assert!(view.history_index.is_none());

        view.history_prev();
        view.clear_input();
        assert!(view.history_index.is_none());
        view.history_next();
        assert!(view.input.is_empty());
    }

    #[test]
    fn chat_failure_status_can_replace_loading_state() {
        let session = Session::new("Dispatcher".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());

        view.set_loading(true);
        view.set_loading(false);
        view.set_status(Some("Agent task failed".to_string()));

        assert!(!view.loading);
        assert_eq!(view.status.as_deref(), Some("Agent task failed"));
    }

    #[test]
    fn chat_clear_resets_visible_transcript_metadata() {
        let session = Session::new("Dispatcher".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());

        view.add_message("user".to_string(), "hello".to_string());
        view.session.metadata.tool_calls = 2;
        view.session.metadata.files_modified = 1;
        view.browse_mode = true;
        view.scroll_offset = 3;

        view.clear_screen();

        assert!(view.session.messages.is_empty());
        assert_eq!(view.session.metadata.message_count, 0);
        assert_eq!(view.session.metadata.tool_calls, 0);
        assert_eq!(view.session.metadata.files_modified, 0);
        assert!(!view.browse_mode);
        assert_eq!(view.scroll_offset, 0);
    }

    #[test]
    fn chat_new_session_replaces_local_session_state() {
        let session = Session::new(
            "Dispatcher".to_string(),
            Some("D:\\workspace\\project".to_string()),
        );
        let original_id = session.id.clone();
        let mut view = ChatView::new(session, Theme::dark());

        view.add_message("user".to_string(), "hello".to_string());
        view.input = "draft".to_string();
        view.cursor = 5;
        view.history_index = Some(0);

        view.start_new_session();

        assert_ne!(view.session.id, original_id);
        assert_eq!(view.session.agent, "Dispatcher");
        assert_eq!(
            view.session.workspace.as_deref(),
            Some("D:\\workspace\\project")
        );
        assert!(view.session.messages.is_empty());
        assert_eq!(view.session.metadata.message_count, 0);
        assert!(view.input.is_empty());
        assert_eq!(view.cursor, 0);
        assert!(view.history_index.is_none());
    }
}
