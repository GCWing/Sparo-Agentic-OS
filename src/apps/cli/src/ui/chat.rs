/// Chat mode TUI interface
use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap},
    Frame,
};
use std::collections::VecDeque;
use unicode_width::UnicodeWidthStr;

use super::markdown::MarkdownRenderer;
use super::theme::{StyleKind, Theme};
use super::widgets::{HelpText, Spinner};
use crate::session::{FlowItem, Message, Session};

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
        }
    }

    /// Render interface
    pub fn render(&mut self, frame: &mut Frame) {
        let size = frame.area();

        // Main layout: header + content + status bar + input + shortcuts
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3), // header
                Constraint::Min(10),   // messages area
                Constraint::Length(1), // status bar
                Constraint::Length(3), // input area
                Constraint::Length(1), // shortcuts hint
            ])
            .split(size);

        // Render each part
        self.render_header(frame, chunks[0]);
        self.render_messages(frame, chunks[1]);
        self.render_status_bar(frame, chunks[2]);
        self.render_input(frame, chunks[3]);
        self.render_shortcuts(frame, chunks[4]);
    }

    /// Render header
    fn render_header(&self, frame: &mut Frame, area: Rect) {
        let title = format!(" Sparo OS CLI v{} ", env!("CARGO_PKG_VERSION"));
        let agent_info = format!(" Agent: {} ", self.session.agent);

        let workspace = self
            .session
            .workspace
            .as_ref()
            .map(|w| format!("Workspace: {}", w))
            .unwrap_or_else(|| "No workspace".to_string());

        let header = Block::default()
            .borders(Borders::ALL)
            .border_style(self.theme.style(StyleKind::Border))
            .style(Style::default().bg(self.theme.background));

        // Product name in purple and bold
        let title_style = Style::default()
            .fg(ratatui::style::Color::Rgb(147, 51, 234))
            .add_modifier(Modifier::BOLD);

        let text = vec![Line::from(vec![
            Span::styled(&title, title_style),
            Span::raw("  "),
            Span::styled(&agent_info, self.theme.style(StyleKind::Primary)),
            Span::raw("  "),
            Span::styled(&workspace, self.theme.style(StyleKind::Muted)),
        ])];

        let paragraph = Paragraph::new(text)
            .block(header)
            .alignment(Alignment::Center);

        frame.render_widget(paragraph, area);
    }

    fn render_messages(&mut self, frame: &mut Frame, area: Rect) {
        let title = if self.browse_mode {
            " Conversation [Browse Mode ↕] ".to_string()
        } else {
            " Conversation ".to_string()
        };

        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(self.theme.style(StyleKind::Border))
            .title(title);

        let inner = block.inner(area);
        frame.render_widget(block, area);

        if self.session.messages.is_empty() {
            let welcome = vec![
                Line::from(""),
                Line::from(Span::styled(
                    "Welcome to Sparo OS CLI!",
                    self.theme.style(StyleKind::Title),
                )),
                Line::from(""),
                Line::from(Span::styled(
                    "Enter your request, AI will help you complete programming tasks.",
                    self.theme.style(StyleKind::Info),
                )),
                Line::from(""),
                Line::from(Span::styled(
                    "Tip: Use / prefix for quick commands",
                    self.theme.style(StyleKind::Muted),
                )),
            ];

            let paragraph = Paragraph::new(welcome)
                .alignment(Alignment::Center)
                .wrap(Wrap { trim: true });

            frame.render_widget(paragraph, inner);
        } else {
            let messages: Vec<ListItem> = self
                .session
                .messages
                .iter()
                .flat_map(|msg| self.render_message(msg))
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

    fn render_message<'a>(&self, message: &'a Message) -> Vec<ListItem<'a>> {
        let mut items = Vec::new();

        let role_style = match message.role.as_str() {
            "user" => self.theme.style(StyleKind::Success),
            "assistant" => self.theme.style(StyleKind::Primary),
            _ => self.theme.style(StyleKind::Muted),
        };

        let role_prefix = match message.role.as_str() {
            "user" => "You:",
            "assistant" => "Assistant:",
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
                            let available_width = 80;
                            let markdown_lines =
                                self.markdown_renderer.render(content, available_width);

                            for md_line in markdown_lines {
                                let mut spans = vec![Span::raw("  ")];
                                spans.extend(md_line.spans);
                                items.push(ListItem::new(Line::from(spans)));
                            }
                        } else {
                            let content_lines: Vec<&str> = content.lines().collect();
                            for line in content_lines {
                                items.push(ListItem::new(Line::from(vec![
                                    Span::raw("  "),
                                    Span::raw(line),
                                ])));
                            }
                        }

                        if *is_streaming {
                            items.push(ListItem::new(Line::from(vec![
                                Span::raw("  "),
                                Span::styled("▊", self.theme.style(StyleKind::Primary)),
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
        } else {
            if message.role == "assistant"
                && MarkdownRenderer::has_markdown_syntax(&message.content)
            {
                let available_width = 80;
                let markdown_lines = self
                    .markdown_renderer
                    .render(&message.content, available_width);

                for md_line in markdown_lines {
                    let mut spans = vec![Span::raw("  ")];
                    spans.extend(md_line.spans);
                    items.push(ListItem::new(Line::from(spans)));
                }
            } else {
                let content_lines: Vec<&str> = message.content.lines().collect();
                for line in content_lines {
                    items.push(ListItem::new(Line::from(vec![
                        Span::raw("  "),
                        Span::raw(line),
                    ])));
                }
            }
        }

        items
    }

    /// Render status bar
    fn render_status_bar(&self, frame: &mut Frame, area: Rect) {
        let status_text = if let Some(status) = &self.status {
            status.clone()
        } else {
            format!(
                "Messages: {} | Tool calls: {} | Files modified: {}",
                self.session.metadata.message_count,
                self.session.metadata.tool_calls,
                self.session.metadata.files_modified
            )
        };

        let paragraph = Paragraph::new(status_text)
            .style(self.theme.style(StyleKind::Muted))
            .alignment(Alignment::Left);

        frame.render_widget(paragraph, area);
    }

    fn render_input(&self, frame: &mut Frame, area: Rect) {
        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(self.theme.style(StyleKind::Primary))
            .title(" Input ");

        let input_text = if self.input.is_empty() {
            Span::styled("Enter message...", self.theme.style(StyleKind::Muted))
        } else {
            Span::raw(&self.input)
        };

        let paragraph = Paragraph::new(Line::from(vec![Span::raw("> "), input_text])).block(block);

        frame.render_widget(paragraph, area);

        // Set cursor position
        if !self.loading {
            // Calculate display width to cursor position
            let byte_pos = self.char_pos_to_byte_pos(self.cursor);
            let display_width = self.input[..byte_pos].width() as u16;

            frame.set_cursor_position((
                area.x + 3 + display_width, // "> " + display width
                area.y + 1,
            ));
        }
    }

    fn render_shortcuts(&self, frame: &mut Frame, area: Rect) {
        let help = HelpText {
            shortcuts: if self.browse_mode {
                // Browse mode shortcuts
                vec![
                    ("↑↓".to_string(), "Scroll ".to_string()),
                    ("PgUp/PgDn".to_string(), "Page ".to_string()),
                    ("Ctrl+E".to_string(), "Exit browse ".to_string()),
                    ("Esc".to_string(), "To bottom ".to_string()),
                    ("Ctrl+M".to_string(), "Menu ".to_string()),
                ]
            } else {
                // Normal mode shortcuts
                vec![
                    ("↑↓".to_string(), "History ".to_string()),
                    ("Ctrl+E".to_string(), "Browse ".to_string()),
                    ("Ctrl+L".to_string(), "Clear ".to_string()),
                    ("Esc".to_string(), "Menu ".to_string()),
                    ("Ctrl+C".to_string(), "Quit".to_string()),
                ]
            },
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
        if self.input.trim().is_empty() {
            return None;
        }

        let input = self.input.clone();

        // Add to history
        self.input_history.push_front(input.clone());
        if self.input_history.len() > 50 {
            self.input_history.pop_back();
        }
        self.history_index = None;

        // Clear input
        self.input.clear();
        self.cursor = 0;

        // Add to session (will auto-trigger scroll)
        self.add_message("user".to_string(), input.clone());

        Some(input)
    }

    pub fn handle_char(&mut self, c: char) {
        if c.is_control() || c == '\u{0}' {
            return;
        }

        let byte_pos = self.char_pos_to_byte_pos(self.cursor);
        self.input.insert(byte_pos, c);
        self.cursor += 1;
    }

    pub fn handle_backspace(&mut self) {
        if self.cursor > 0 && !self.input.is_empty() {
            let byte_pos = self.char_pos_to_byte_pos(self.cursor - 1);
            if byte_pos < self.input.len() {
                self.input.remove(byte_pos);
                self.cursor -= 1;
            }
        }
    }

    pub fn move_cursor_left(&mut self) {
        if self.cursor > 0 {
            self.cursor -= 1;
        }
    }

    pub fn move_cursor_right(&mut self) {
        let char_count = self.input.chars().count();
        if self.cursor < char_count {
            self.cursor += 1;
        }
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
            self.cursor = self.input.len();
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
                    self.cursor = self.input.len();
                    self.history_index = Some(new_index);
                }
            }
        }
    }

    pub fn clear_screen(&mut self) {
        self.session.messages.clear();
        self.list_state.select(None);
        self.auto_scroll = true;
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
                .flat_map(|msg| self.render_message(msg))
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
            .flat_map(|msg| self.render_message(msg))
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
}
