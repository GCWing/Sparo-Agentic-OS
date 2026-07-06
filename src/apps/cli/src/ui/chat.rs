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

#[derive(Debug, Clone, PartialEq)]
pub struct PendingToolConfirmation {
    pub tool_id: String,
    pub tool_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatShortcutLabels {
    pub send_message: String,
    pub interrupt: String,
    pub menu: String,
}

impl Default for ChatShortcutLabels {
    fn default() -> Self {
        Self {
            send_message: "^D".to_string(),
            interrupt: "^C".to_string(),
            menu: "Esc".to_string(),
        }
    }
}

impl ChatShortcutLabels {
    pub fn from_config_values(send_message: &str, interrupt: &str, menu: &str) -> Self {
        Self {
            send_message: shortcut_display_label(send_message),
            interrupt: shortcut_display_label(interrupt),
            menu: shortcut_display_label(menu),
        }
    }
}

fn shortcut_display_label(shortcut: &str) -> String {
    let shortcut = shortcut.trim();
    if shortcut.eq_ignore_ascii_case("enter") {
        return "Enter".to_string();
    }
    if shortcut.eq_ignore_ascii_case("esc") || shortcut.eq_ignore_ascii_case("escape") {
        return "Esc".to_string();
    }
    shortcut
        .strip_prefix("Ctrl+")
        .or_else(|| shortcut.strip_prefix("ctrl+"))
        .or_else(|| shortcut.strip_prefix("CTRL+"))
        .and_then(|key| {
            let mut chars = key.chars();
            let first = chars.next()?;
            if chars.next().is_none() {
                Some(format!("^{}", first.to_ascii_uppercase()))
            } else {
                None
            }
        })
        .unwrap_or_else(|| shortcut.to_string())
}

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

fn chat_shortcut_items(
    browse_mode: bool,
    loading: bool,
    width: u16,
    shortcuts: &ChatShortcutLabels,
) -> Vec<(String, String)> {
    let interrupt_desc = if loading { "Stop " } else { "Quit " };
    if browse_mode {
        if width < 64 {
            return vec![
                ("^E".to_string(), "Exit ".to_string()),
                (shortcuts.menu.clone(), "Back ".to_string()),
                (shortcuts.interrupt.clone(), interrupt_desc.to_string()),
            ];
        }
        if width >= 96 {
            return vec![
                ("Up/Dn".to_string(), "Scroll ".to_string()),
                ("Pg".to_string(), "Page ".to_string()),
                ("^E".to_string(), "Exit ".to_string()),
                (shortcuts.menu.clone(), "Back ".to_string()),
            ];
        }
        return vec![
            ("Up/Dn".to_string(), "Scroll ".to_string()),
            ("^E".to_string(), "Exit ".to_string()),
            (shortcuts.menu.clone(), "Back ".to_string()),
        ];
    }

    if width < 64 {
        return vec![
            ("/".to_string(), "Cmd ".to_string()),
            (shortcuts.send_message.clone(), "Send ".to_string()),
            (shortcuts.interrupt.clone(), interrupt_desc.to_string()),
        ];
    }

    if width < 104 {
        return vec![
            ("/".to_string(), "Cmd ".to_string()),
            (shortcuts.send_message.clone(), "Send ".to_string()),
            ("^E".to_string(), "Browse ".to_string()),
            (shortcuts.menu.clone(), "Home ".to_string()),
            (shortcuts.interrupt.clone(), interrupt_desc.to_string()),
        ];
    }

    vec![
        ("/".to_string(), "Cmd ".to_string()),
        (shortcuts.send_message.clone(), "Send ".to_string()),
        ("^E".to_string(), "Browse ".to_string()),
        (shortcuts.menu.clone(), "Home ".to_string()),
        (shortcuts.interrupt.clone(), interrupt_desc.to_string()),
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
    /// Whether loading indicators should animate between frames.
    pub animation: bool,
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
    /// Tool execution currently waiting for an explicit terminal decision.
    pub pending_tool_confirmation: Option<PendingToolConfirmation>,
    /// Whether to show the bottom shortcut hint row.
    pub show_tips: bool,
    /// Shortcut labels shown in the bottom hint row.
    pub shortcuts: ChatShortcutLabels,
    /// Last rendered message width, used to keep browse scroll math aligned.
    message_width: usize,
}

impl ChatView {
    /// Create new Chat view
    pub fn new(session: Session, theme: Theme) -> Self {
        let markdown_renderer = MarkdownRenderer::new(theme.clone());
        Self {
            spinner: Spinner::new(theme.style(StyleKind::Primary)),
            animation: true,
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
            pending_tool_confirmation: None,
            show_tips: true,
            shortcuts: ChatShortcutLabels::default(),
            message_width: 80,
        }
    }

    pub fn set_show_tips(&mut self, show_tips: bool) {
        self.show_tips = show_tips;
    }

    pub fn set_animation(&mut self, animation: bool) {
        self.animation = animation;
    }

    pub fn set_shortcuts(&mut self, shortcuts: ChatShortcutLabels) {
        self.shortcuts = shortcuts;
    }

    /// Render interface
    pub fn render(&mut self, frame: &mut Frame) {
        let size = frame.area();

        // Mechanical drafting layout: global rails, a quiet transcript field,
        // and a dedicated input controller at the bottom.
        let constraints = if self.show_tips {
            vec![
                Constraint::Length(1), // header
                Constraint::Length(1), // rule
                Constraint::Min(8),    // messages area
                Constraint::Length(1), // status bar
                Constraint::Length(3), // input controller
                Constraint::Length(1), // shortcuts hint
            ]
        } else {
            vec![
                Constraint::Length(1), // header
                Constraint::Length(1), // rule
                Constraint::Min(8),    // messages area
                Constraint::Length(1), // status bar
                Constraint::Length(3), // input controller
            ]
        };
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints(constraints)
            .split(size);

        self.render_header(frame, chunks[0]);
        self.render_rule(frame, chunks[1]);
        self.render_messages(frame, chunks[2]);
        self.render_status_bar(frame, chunks[3]);
        self.render_input(frame, chunks[4]);
        if self.show_tips {
            self.render_shortcuts(frame, chunks[5]);
        }

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
        let workspace = compact_workspace_label(self.session.workspace.as_deref());

        let line = Line::from(vec![
            Span::raw("  "),
            Span::styled("sparo console", self.theme.style(StyleKind::Muted)),
            Span::styled("   /   ", self.theme.style(StyleKind::Primary)),
            Span::styled("ready", self.theme.style(StyleKind::Faint)),
            Span::styled("   ", self.theme.style(StyleKind::Faint)),
            Span::styled(
                format!("agent {}", truncate_str(&self.session.agent, 22)),
                self.theme.style(StyleKind::Primary),
            ),
            Span::styled("   ", self.theme.style(StyleKind::Faint)),
            Span::styled(workspace, self.theme.style(StyleKind::Muted)),
            Span::styled(
                format!("   v{}", env!("CARGO_PKG_VERSION")),
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
            if self.animation {
                self.spinner.tick();
            }
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

        spans.push(Span::styled("status ", self.theme.style(StyleKind::Faint)));
        spans.push(Span::styled(
            status_text,
            self.theme.style(StyleKind::Muted),
        ));

        if self.browse_mode {
            spans.push(Span::styled(
                "    browse",
                self.theme.style(StyleKind::Primary),
            ));
        }

        if self.pending_tool_confirmation.is_some() {
            spans.push(Span::styled(
                "    confirm y/n",
                self.theme.style(StyleKind::Warning),
            ));
        }

        frame.render_widget(
            Paragraph::new(Line::from(spans)).alignment(Alignment::Left),
            area,
        );
    }
    fn render_input(&self, frame: &mut Frame, area: Rect) {
        let width = area.width as usize;
        let side_pad: usize = if width >= 48 { 2 } else { 0 };
        let frame_width = width
            .saturating_sub(side_pad.saturating_mul(2))
            .max(width.min(24));
        let inner_width = frame_width.saturating_sub(2).max(8);
        let input_width = inner_width.saturating_sub(4);
        let horizontal = "-".repeat(inner_width);
        let border_style = self.theme.style(StyleKind::Border);
        let rail_style = self.theme.style(StyleKind::Faint);
        let corner_style = Style::default()
            .fg(self.theme.ignition)
            .add_modifier(Modifier::BOLD);
        let prompt = if self.loading { "." } else { "/" };
        let prompt_style = if self.loading {
            self.theme.style(StyleKind::Muted)
        } else {
            self.theme.style(StyleKind::Primary)
        };

        let (visible_input, cursor_x) = visible_input_window(&self.input, self.cursor, input_width);
        let input_text = if self.input.is_empty() {
            Span::styled(
                "Talk to Sparo, or type / for commands",
                self.theme.style(StyleKind::Muted),
            )
        } else {
            Span::styled(visible_input, self.theme.style(StyleKind::Text))
        };
        let fill = input_width.saturating_sub(input_text.content.width());
        let side = || Span::raw(" ".repeat(side_pad));

        let lines = vec![
            Line::from(vec![
                side(),
                Span::styled("+", corner_style),
                Span::styled(horizontal.clone(), rail_style),
                Span::styled("+", corner_style),
            ]),
            Line::from(vec![
                side(),
                Span::styled("| ", border_style),
                Span::styled(prompt, prompt_style),
                Span::raw(" "),
                input_text,
                Span::raw(" ".repeat(fill)),
                Span::styled(" |", border_style),
            ]),
            Line::from(vec![
                side(),
                Span::styled("+", corner_style),
                Span::styled(horizontal, rail_style),
                Span::styled("+", corner_style),
            ]),
        ];

        frame.render_widget(Paragraph::new(lines), area);

        // Place the cursor right after the prompt + typed text.
        if !self.loading {
            frame.set_cursor_position((area.x + side_pad as u16 + 4 + cursor_x, area.y + 1));
        }
    }

    fn render_shortcuts(&self, frame: &mut Frame, area: Rect) {
        let help = HelpText {
            shortcuts: chat_shortcut_items(
                self.browse_mode,
                self.loading,
                area.width,
                &self.shortcuts,
            ),
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

    pub fn start_new_session_with_agent(&mut self, agent: String) {
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

    pub fn set_pending_tool_confirmation(&mut self, tool_id: String, tool_name: String) {
        self.pending_tool_confirmation = Some(PendingToolConfirmation { tool_id, tool_name });
    }

    pub fn clear_pending_tool_confirmation(&mut self, tool_id: &str) {
        if self
            .pending_tool_confirmation
            .as_ref()
            .is_some_and(|pending| pending.tool_id == tool_id)
        {
            self.pending_tool_confirmation = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui::commands::PanelKind;
    use ratatui::{backend::TestBackend, buffer::Buffer, Terminal};
    use sparo_core::command::agentic_os::AgenticOsSnapshot;

    fn render_view(view: &mut ChatView, width: u16, height: u16) {
        let backend = TestBackend::new(width, height);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal.draw(|frame| view.render(frame)).unwrap();
    }

    fn buffer_text(buffer: &Buffer) -> String {
        let mut text = String::new();
        for y in 0..buffer.area.height {
            for x in 0..buffer.area.width {
                text.push_str(buffer[(x, y)].symbol());
            }
            text.push('\n');
        }
        text
    }

    fn render_view_text(view: &mut ChatView, width: u16, height: u16) -> String {
        let backend = TestBackend::new(width, height);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal.draw(|frame| view.render(frame)).unwrap();
        buffer_text(terminal.backend().buffer())
    }

    #[test]
    fn chat_empty_state_renders_at_common_sizes() {
        let session = Session::new(
            "OSAgent".to_string(),
            Some("D:\\workspace\\project".to_string()),
        );
        let mut view = ChatView::new(session, Theme::dark());

        render_view(&mut view, 100, 30);
        render_view(&mut view, 48, 14);
    }

    #[test]
    fn chat_input_renders_as_dedicated_drafting_control() {
        let session = Session::new("OSAgent".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());

        let rendered = render_view_text(&mut view, 120, 20);

        assert!(rendered.contains("Talk to Sparo, or type / for commands"));
        assert!(rendered.contains("+"));
        assert!(rendered.contains("| / "));
    }

    #[test]
    fn chat_input_uses_full_workspace_width() {
        let session = Session::new("OSAgent".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());

        let rendered = render_view_text(&mut view, 120, 20);
        let top_edge = rendered
            .lines()
            .find(|line| line.trim_start().starts_with('+'))
            .expect("input frame should render");

        assert!(top_edge.trim_end().len() >= 112, "{top_edge}");
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
        let shortcuts = ChatShortcutLabels::default();
        let compact = chat_shortcut_items(false, false, 48, &shortcuts);
        assert_eq!(
            compact,
            vec![
                ("/".to_string(), "Cmd ".to_string()),
                ("^D".to_string(), "Send ".to_string()),
                ("^C".to_string(), "Quit ".to_string())
            ]
        );

        let medium = chat_shortcut_items(false, false, 80, &shortcuts);
        assert_eq!(
            medium,
            vec![
                ("/".to_string(), "Cmd ".to_string()),
                ("^D".to_string(), "Send ".to_string()),
                ("^E".to_string(), "Browse ".to_string()),
                ("Esc".to_string(), "Home ".to_string()),
                ("^C".to_string(), "Quit ".to_string())
            ]
        );
        assert!(!medium.contains(&("^T".to_string(), "Tasks ".to_string())));
        assert!(!medium.contains(&("^U".to_string(), "Clear input ".to_string())));
        assert!(!medium.contains(&("/sessions".to_string(), "Sessions ".to_string())));

        let wide = chat_shortcut_items(false, false, 120, &shortcuts);
        assert_eq!(
            wide,
            vec![
                ("/".to_string(), "Cmd ".to_string()),
                ("^D".to_string(), "Send ".to_string()),
                ("^E".to_string(), "Browse ".to_string()),
                ("Esc".to_string(), "Home ".to_string()),
                ("^C".to_string(), "Quit ".to_string())
            ]
        );
        assert!(!wide.contains(&("^T/P/Y/O/,".to_string(), "Panels ".to_string())));
        assert!(!wide.contains(&("^,".to_string(), "Settings ".to_string())));
    }

    #[test]
    fn chat_shortcuts_render_configured_labels() {
        let session = Session::new("OSAgent".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());
        view.set_shortcuts(ChatShortcutLabels::from_config_values(
            "Ctrl+S", "Ctrl+X", "Escape",
        ));

        let rendered = render_view_text(&mut view, 100, 20);

        assert!(rendered.contains("[^S]Send"));
        assert!(rendered.contains("[^X]Quit"));
        assert!(rendered.contains("[Esc]Home"));
    }

    #[test]
    fn chat_show_tips_false_omits_shortcut_hint_row() {
        let session = Session::new("OSAgent".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());
        let default_rendered = render_view_text(&mut view, 100, 20);
        assert!(default_rendered.contains("Browse"));
        assert!(default_rendered.contains("Quit"));

        view.set_show_tips(false);
        let rendered = render_view_text(&mut view, 100, 20);

        assert!(!rendered.contains("Browse"));
        assert!(!rendered.contains("Quit"));
        assert!(rendered.contains("Talk to Sparo, or type / for commands"));
    }

    #[test]
    fn chat_animation_false_keeps_loading_indicator_stable() {
        let session = Session::new("OSAgent".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());
        view.set_loading(true);
        view.set_animation(false);

        let first = render_view_text(&mut view, 100, 20);
        let second = render_view_text(&mut view, 100, 20);

        assert!(first.contains("- Thinking..."));
        assert!(second.contains("- Thinking..."));
        assert_eq!(view.spinner.current(), "-");
    }

    #[test]
    fn chat_browse_shortcuts_stay_compact_on_narrow_widths() {
        let shortcuts = ChatShortcutLabels::default();
        let compact = chat_shortcut_items(true, false, 48, &shortcuts);
        assert_eq!(
            compact,
            vec![
                ("^E".to_string(), "Exit ".to_string()),
                ("Esc".to_string(), "Back ".to_string()),
                ("^C".to_string(), "Quit ".to_string())
            ]
        );

        let wide = chat_shortcut_items(true, false, 100, &shortcuts);
        assert!(wide.contains(&("Up/Dn".to_string(), "Scroll ".to_string())));
        assert!(wide.contains(&("Pg".to_string(), "Page ".to_string())));
        assert!(wide.contains(&("^E".to_string(), "Exit ".to_string())));
        assert!(wide.contains(&("Esc".to_string(), "Back ".to_string())));
        assert!(!wide.contains(&("^Home/End".to_string(), "Top/Bot ".to_string())));
    }

    #[test]
    fn chat_loading_shortcut_hint_labels_interrupt_as_stop() {
        let shortcuts = ChatShortcutLabels::default();
        let items = chat_shortcut_items(false, true, 80, &shortcuts);

        assert!(items.contains(&("^C".to_string(), "Stop ".to_string())));
        assert!(!items.contains(&("^C".to_string(), "Quit ".to_string())));
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
        let session = Session::new("OSAgent".to_string(), None);
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
        let session = Session::new("OSAgent".to_string(), None);
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
        let session = Session::new("OSAgent".to_string(), None);
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
        let session = Session::new("OSAgent".to_string(), None);
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
        let session = Session::new("OSAgent".to_string(), None);
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
        let session = Session::new("OSAgent".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());

        view.set_loading(true);
        view.set_loading(false);
        view.set_status(Some("Agent task failed".to_string()));

        assert!(!view.loading);
        assert_eq!(view.status.as_deref(), Some("Agent task failed"));
    }

    #[test]
    fn chat_clear_resets_visible_transcript_metadata() {
        let session = Session::new("OSAgent".to_string(), None);
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
            "OSAgent".to_string(),
            Some("D:\\workspace\\project".to_string()),
        );
        let original_id = session.id.clone();
        let mut view = ChatView::new(session, Theme::dark());

        view.add_message("user".to_string(), "hello".to_string());
        view.input = "draft".to_string();
        view.cursor = 5;
        view.history_index = Some(0);

        view.start_new_session_with_agent("OSAgent".to_string());

        assert_ne!(view.session.id, original_id);
        assert_eq!(view.session.agent, "OSAgent");
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
