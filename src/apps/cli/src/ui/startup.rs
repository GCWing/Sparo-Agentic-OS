/// Agentic OS dispatcher home for the CLI.
use anyhow::Result;
use bitfun_core::command::agentic_os::{
    AgenticOsSnapshot as DispatcherSnapshot, AgenticOsSnapshotRequest,
};
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::{
    backend::Backend,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{List, ListItem, ListState, Paragraph},
    Frame, Terminal,
};
use std::time::Duration;
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use crate::modes::chat::effective_workspace_selection;

use super::commands::{
    available_agents_message, command_for_slash, typed_command_action, CommandAction, CommandScope,
    PanelKind,
};
use super::panels::{
    command_count, jump_selection, move_selection, panel_count, render_command_palette,
    render_overlay, render_snapshot_panel, selected_command,
    selected_panel_data_index as overlay_selected_panel_data_index, selected_panel_detail,
    selected_panel_prompt, OverlayKind, OverlayState, SelectionJump,
};
use super::string_utils::truncate_str;
use super::theme::{StyleKind, Theme};

/// ANSI-shadow style banner for the home hero. Each line is centered at render time.
const BANNER: &[&str] = &[
    "  ____  ____    _    ____   ___ ",
    " / ___||  _ \\  / \\  |  _ \\ / _ \\",
    " \\___ \\| |_) |/ _ \\ | |_) | | | |",
    "  ___) |  __// ___ \\|  _ <| |_| |",
    " |____/|_|  /_/   \\_\\_| \\_\\\\___/ ",
];
const RECENT_SESSION_COMFORTABLE_HEIGHT: u16 = 12;

#[derive(Debug, Clone)]
pub struct StartupLaunch {
    pub workspace: Option<String>,
    pub session_id: Option<String>,
    pub agent: String,
    pub initial_message: Option<String>,
}

#[derive(Debug, Clone)]
pub enum StartupOutcome {
    Launch(StartupLaunch),
    Exit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Panel {
    Home,
    Sessions,
    Tasks,
    Apps,
    Memory,
    Workspaces,
    Settings,
    Command,
    Help,
}

pub struct StartupPage {
    snapshot: DispatcherSnapshot,
    theme: Theme,
    panel: Panel,
    selected: usize,
    input: String,
    input_cursor: usize,
    command_filter: String,
    panel_filter: String,
    home_recent_area_height: u16,
}

impl StartupPage {
    pub async fn load_snapshot(workspace_hint: Option<String>) -> DispatcherSnapshot {
        let runtime = match bitfun_core::runtime::initialize_process_runtime(
            bitfun_core::runtime::ProcessRuntimeOptions {
                initialize_i18n: false,
                initialize_token_usage: false,
            },
        )
        .await
        {
            Ok(runtime) => runtime,
            Err(error) => {
                tracing::warn!(
                    "Failed to initialize process runtime for CLI snapshot: {}",
                    error
                );
                return DispatcherSnapshot::default();
            }
        };

        bitfun_core::command::agentic_os::get_snapshot(
            &runtime.command_context(),
            AgenticOsSnapshotRequest { workspace_hint },
        )
        .await
        .unwrap_or_else(|error| {
            tracing::warn!("Failed to load Agentic OS snapshot: {}", error);
            DispatcherSnapshot::default()
        })
    }

    pub fn new(snapshot: DispatcherSnapshot) -> Self {
        Self {
            snapshot,
            theme: Theme::dark(),
            panel: Panel::Home,
            selected: 0,
            input: String::new(),
            input_cursor: 0,
            command_filter: String::new(),
            panel_filter: String::new(),
            home_recent_area_height: RECENT_SESSION_COMFORTABLE_HEIGHT,
        }
    }

    pub fn run<B: Backend>(&mut self, terminal: &mut Terminal<B>) -> Result<StartupOutcome> {
        terminal.clear()?;

        loop {
            terminal.draw(|f| self.render(f))?;

            if event::poll(Duration::from_millis(100))? {
                match event::read()? {
                    Event::Key(key) => {
                        if let Some(outcome) = self.handle_key(key) {
                            return Ok(outcome);
                        }
                    }
                    Event::Resize(_, _) => terminal.clear()?,
                    _ => {}
                }
            }
        }
    }

    fn render(&mut self, frame: &mut Frame) {
        let area = frame.area();
        match self.panel {
            Panel::Home => self.render_home(frame, area),
            Panel::Sessions => self.render_panel(frame, area, PanelKind::Sessions),
            Panel::Tasks => self.render_panel(frame, area, PanelKind::Tasks),
            Panel::Apps => self.render_panel(frame, area, PanelKind::Apps),
            Panel::Memory => self.render_panel(frame, area, PanelKind::Memory),
            Panel::Workspaces => self.render_panel(frame, area, PanelKind::Workspaces),
            Panel::Settings => self.render_panel(frame, area, PanelKind::Settings),
            Panel::Command => self.render_command(frame, area),
            Panel::Help => self.render_help(frame, area),
        }
    }

    fn render_panel(&mut self, frame: &mut Frame, area: Rect, kind: PanelKind) {
        let mut overlay = OverlayState::panel(kind, self.snapshot.clone());
        overlay.selected = self.selected;
        overlay.filter = self.panel_filter.clone();
        render_snapshot_panel(
            frame,
            area,
            &self.theme,
            &mut overlay,
            kind,
            CommandScope::Home,
        );
        self.selected = overlay.selected;
        self.panel_filter = overlay.filter;
    }

    fn render_home(&mut self, frame: &mut Frame, area: Rect) {
        // A narrow, centered column gives the home a calm, spacious feel.
        let content = centered_column(area, 72);
        let compact = content.height < 22;

        // Hero block: banner + tagline + status, all centered together.
        let hero_height: u16 = if compact { 4 } else { BANNER.len() as u16 + 3 };

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(hero_height),
                Constraint::Length(1), // spacer
                Constraint::Length(1), // continue
                Constraint::Length(1), // spacer
                Constraint::Min(3),    // timeline
                Constraint::Length(1), // counters
                Constraint::Length(1), // spacer
                Constraint::Length(1), // input
                Constraint::Length(1), // footer
            ])
            .split(content);

        self.home_recent_area_height = chunks[4].height;
        self.render_hero(frame, chunks[0], compact);
        self.render_continue(frame, chunks[2]);
        self.render_timeline(frame, chunks[4]);
        self.render_counters(frame, chunks[5]);
        self.render_input(frame, chunks[7]);
        self.render_footer(frame, chunks[8]);
    }

    fn render_hero(&self, frame: &mut Frame, area: Rect, compact: bool) {
        let primary = self
            .theme
            .style(StyleKind::Primary)
            .add_modifier(Modifier::BOLD);

        let (model, workspace, branch) = startup_status_labels(
            &self.snapshot.model,
            self.snapshot.current_workspace.as_deref(),
            self.snapshot.git_branch.as_deref(),
            area.width,
        );

        let status = Line::from(vec![
            Span::styled("* ", self.theme.style(StyleKind::Success)),
            Span::styled(model, self.theme.style(StyleKind::Muted)),
            Span::styled("   ", self.theme.style(StyleKind::Faint)),
            Span::styled(workspace, self.theme.style(StyleKind::Muted)),
            Span::styled("   ", self.theme.style(StyleKind::Faint)),
            Span::styled(branch, self.theme.style(StyleKind::Faint)),
        ]);

        let mut lines: Vec<Line> = Vec::new();
        if compact || area.width < BANNER[0].chars().count() as u16 {
            lines.push(Line::from(Span::styled("SPARO", primary)));
            lines.push(Line::from(""));
            lines.push(status);
        } else {
            for row in BANNER {
                lines.push(Line::from(Span::styled(*row, primary)));
            }
            lines.push(Line::from(Span::styled(
                "agentic operating system",
                self.theme.style(StyleKind::Muted),
            )));
            lines.push(Line::from(""));
            lines.push(status);
        }

        frame.render_widget(Paragraph::new(lines).alignment(Alignment::Center), area);
    }

    fn render_continue(&self, frame: &mut Frame, area: Rect) {
        let line = self.home_action_line(area.width);

        frame.render_widget(Paragraph::new(line).alignment(Alignment::Center), area);
    }

    fn home_action_line(&self, width: u16) -> Line<'static> {
        let typed = self.input.trim();
        if !typed.is_empty() {
            let prefix = "Send  ";
            let suffix = "   new session";
            let text_width = width
                .saturating_sub(prefix.len() as u16)
                .saturating_sub(suffix.len() as u16) as usize;
            return Line::from(vec![
                Span::styled(prefix.to_string(), self.theme.style(StyleKind::AccentTitle)),
                Span::styled(
                    compact_startup_text(typed, text_width.max(10)),
                    self.theme.style(StyleKind::Title),
                ),
                Span::styled(suffix.to_string(), self.theme.style(StyleKind::Muted)),
            ]);
        }

        if self.home_selection_opens_sessions_panel() {
            let hidden = recent_session_hidden_count(
                self.snapshot.sessions.len(),
                self.home_recent_area_height,
            );
            return Line::from(vec![
                Span::styled(
                    "Open  ".to_string(),
                    self.theme.style(StyleKind::AccentTitle),
                ),
                Span::styled("Sessions".to_string(), self.theme.style(StyleKind::Title)),
                Span::styled(
                    format!("   {} more saved", hidden),
                    self.theme.style(StyleKind::Muted),
                ),
            ]);
        }

        let selected_index = self.selected.saturating_sub(1);
        match self
            .snapshot
            .sessions
            .get(selected_index)
            .or_else(|| self.snapshot.sessions.first())
        {
            Some(session) => {
                let kind = session_kind_label(session.is_dispatch_task);
                let meta = format!(
                    "   {} | {} turns | {}",
                    kind,
                    session.turns,
                    format_relative_time(session.last_active_at)
                );
                let prefix = "Continue  ";
                let title_width = width
                    .saturating_sub(prefix.len() as u16)
                    .saturating_sub(meta.len() as u16) as usize;
                Line::from(vec![
                    Span::styled(prefix.to_string(), self.theme.style(StyleKind::AccentTitle)),
                    Span::styled(
                        compact_startup_text(&session.title, title_width.max(12)),
                        self.theme.style(StyleKind::Title),
                    ),
                    Span::styled(meta, self.theme.style(StyleKind::Muted)),
                ])
            }
            None => Line::from(vec![Span::styled(
                "Start your first dispatcher session".to_string(),
                self.theme.style(StyleKind::AccentTitle),
            )]),
        }
    }

    fn render_timeline(&mut self, frame: &mut Frame, area: Rect) {
        self.home_recent_area_height = area.height;
        let pad = home_pad(area);

        let mut items = Vec::new();
        items.push(ListItem::new(Line::from(vec![
            Span::raw(" ".repeat(pad)),
            Span::styled("RECENT", self.theme.style(StyleKind::Faint)),
        ])));

        if self.snapshot.sessions.is_empty() {
            items.push(ListItem::new(Line::from(vec![
                Span::raw(" ".repeat(pad)),
                Span::styled("No recent sessions yet", self.theme.style(StyleKind::Muted)),
            ])));
        } else {
            let shown_limit =
                recent_session_visible_count(self.snapshot.sessions.len(), area.height);
            for session in self.snapshot.sessions.iter().take(shown_limit) {
                let kind = session_kind_label(session.is_dispatch_task);
                let meta = format!(
                    "{} turns{} | {}",
                    session.turns,
                    if session.child_count > 0 {
                        format!(" | {} sub", session.child_count)
                    } else {
                        String::new()
                    },
                    format_clock(session.last_active_at)
                );
                let title_width = area
                    .width
                    .saturating_sub(pad as u16)
                    .saturating_sub(4)
                    .saturating_sub(7)
                    .saturating_sub(meta.len() as u16) as usize;
                items.push(ListItem::new(Line::from(vec![
                    Span::raw(" ".repeat(pad)),
                    Span::styled("- ", self.theme.style(StyleKind::Primary)),
                    Span::styled(format!("{:<7}", kind), self.theme.style(StyleKind::Faint)),
                    Span::styled(
                        compact_startup_text(&session.title, title_width.max(12)),
                        self.theme.style(StyleKind::Title),
                    ),
                    Span::raw("  "),
                    Span::styled(meta, self.theme.style(StyleKind::Muted)),
                ])));
            }
            let hidden_count =
                recent_session_hidden_count(self.snapshot.sessions.len(), area.height);
            if hidden_count > 0 && items.len() < area.height as usize {
                items.push(ListItem::new(Line::from(vec![
                    Span::raw(" ".repeat(pad)),
                    Span::styled(
                        format!("+ {} more in /sessions", hidden_count),
                        self.theme.style(StyleKind::Faint),
                    ),
                ])));
            }
        }

        let mut state = ListState::default();
        state.select(Some(
            self.selected.min(items.len().saturating_sub(1)).max(1),
        ));
        frame.render_stateful_widget(
            List::new(items).highlight_style(self.selection_style()),
            area,
            &mut state,
        );
    }

    fn render_counters(&self, frame: &mut Frame, area: Rect) {
        let sep = || Span::styled("    ", self.theme.style(StyleKind::Faint));
        let chip = |count: usize, label: &str| {
            vec![
                Span::styled(count.to_string(), self.theme.style(StyleKind::Title)),
                Span::styled(format!(" {}", label), self.theme.style(StyleKind::Muted)),
            ]
        };

        let mut spans = Vec::new();
        for (index, (count, label)) in startup_counter_items(&self.snapshot).iter().enumerate() {
            if index > 0 {
                spans.push(sep());
            }
            spans.extend(chip(*count, label));
        }

        frame.render_widget(
            Paragraph::new(Line::from(spans)).alignment(Alignment::Center),
            area,
        );
    }

    fn render_input(&self, frame: &mut Frame, area: Rect) {
        let pad = home_pad(area);
        let input_width = area.width.saturating_sub(pad as u16).saturating_sub(2) as usize;
        let (visible_input, cursor_x) =
            startup_input_window(&self.input, self.input_cursor, input_width);
        let mut spans = vec![
            Span::raw(" ".repeat(pad)),
            Span::styled("> ", self.theme.style(StyleKind::Primary)),
        ];
        if self.input.is_empty() {
            spans.push(Span::styled(
                compact_startup_text("Talk to Sparo, or / for commands", input_width),
                self.theme.style(StyleKind::Muted),
            ));
        } else {
            spans.push(Span::styled(
                visible_input,
                self.theme.style(StyleKind::Text),
            ));
        }

        frame.render_widget(Paragraph::new(Line::from(spans)), area);
        if self.panel == Panel::Home && !self.input.is_empty() {
            frame.set_cursor_position((area.x + pad as u16 + 2 + cursor_x, area.y));
        }
    }

    fn render_footer(&self, frame: &mut Frame, area: Rect) {
        let key = |k: &str| Span::styled(k.to_string(), self.theme.style(StyleKind::Muted));
        let lab = |l: &str| Span::styled(format!(" {}", l), self.theme.style(StyleKind::Faint));
        let sep = || Span::styled("  ", self.theme.style(StyleKind::Faint));
        let footer_items = startup_footer_items(
            area.width,
            home_recent_selectable_rows(self.snapshot.sessions.len(), self.home_recent_area_height),
            self.refresh_available(),
        );
        let mut spans = Vec::new();
        for (index, (shortcut, label)) in footer_items.iter().enumerate() {
            if index > 0 {
                spans.push(sep());
            }
            spans.push(key(shortcut));
            spans.push(lab(label));
        }
        let line = Line::from(spans);

        frame.render_widget(Paragraph::new(line).alignment(Alignment::Center), area);
    }

    fn render_command(&mut self, frame: &mut Frame, area: Rect) {
        let mut overlay = OverlayState {
            kind: OverlayKind::CommandPalette,
            selected: self.selected,
            filter: self.command_filter.clone(),
            snapshot: None,
        };
        render_command_palette(frame, area, &self.theme, &mut overlay, CommandScope::Home);
        self.selected = overlay.selected;
    }

    fn render_help(&self, frame: &mut Frame, area: Rect) {
        let mut overlay = OverlayState::help();
        render_overlay(frame, area, &self.theme, &mut overlay, CommandScope::Home);
    }

    fn handle_key(&mut self, key: KeyEvent) -> Option<StartupOutcome> {
        if key.kind != KeyEventKind::Press && key.kind != KeyEventKind::Repeat {
            return None;
        }

        if self.panel == Panel::Command {
            return self.handle_command_key(key);
        }

        match (key.code, key.modifiers) {
            (KeyCode::Char('c'), KeyModifiers::CONTROL) => Some(StartupOutcome::Exit),
            (KeyCode::Char('t'), KeyModifiers::CONTROL) => {
                self.toggle_panel(Panel::Tasks);
                None
            }
            (KeyCode::Char('p'), KeyModifiers::CONTROL) => {
                self.toggle_panel(Panel::Apps);
                None
            }
            (KeyCode::Char('y'), KeyModifiers::CONTROL) => {
                self.toggle_panel(Panel::Memory);
                None
            }
            (KeyCode::Char('o'), KeyModifiers::CONTROL) => {
                self.toggle_panel(Panel::Workspaces);
                None
            }
            (KeyCode::Char(','), KeyModifiers::CONTROL) => {
                self.toggle_panel(Panel::Settings);
                None
            }
            (KeyCode::Char('R') | KeyCode::Char('r'), KeyModifiers::NONE | KeyModifiers::SHIFT)
                if self.refresh_available()
                    && refresh_key(key)
                    && !(self.panel.is_snapshot_panel() && !self.panel_filter.is_empty()) =>
            {
                self.refresh_snapshot();
                None
            }
            (KeyCode::Char('/'), _) => {
                self.panel = Panel::Command;
                self.command_filter.clear();
                self.selected = 0;
                None
            }
            (KeyCode::Char('u'), KeyModifiers::CONTROL) if self.panel == Panel::Home => {
                self.clear_input();
                None
            }
            (KeyCode::Char('u'), KeyModifiers::CONTROL) if self.panel.is_snapshot_panel() => {
                self.panel_filter.clear();
                self.selected = 0;
                None
            }
            (KeyCode::Esc, _) => {
                if self.panel.is_snapshot_panel() && !self.panel_filter.is_empty() {
                    self.panel_filter.clear();
                    self.selected = 0;
                    return None;
                }
                self.panel = Panel::Home;
                None
            }
            (KeyCode::Up, _) => {
                self.move_selection(-1);
                None
            }
            (KeyCode::Down, _) => {
                self.move_selection(1);
                None
            }
            (KeyCode::PageUp, _) => {
                self.jump_selection(SelectionJump::PageUp(5));
                None
            }
            (KeyCode::PageDown, _) => {
                self.jump_selection(SelectionJump::PageDown(5));
                None
            }
            (KeyCode::Left, _) if self.panel == Panel::Home && !self.input.is_empty() => {
                self.move_input_cursor_left();
                None
            }
            (KeyCode::Right, _) if self.panel == Panel::Home && !self.input.is_empty() => {
                self.move_input_cursor_right();
                None
            }
            (KeyCode::Home, _) => {
                if self.panel == Panel::Home && !self.input.is_empty() {
                    self.input_cursor = 0;
                    return None;
                }
                self.jump_selection(SelectionJump::First);
                None
            }
            (KeyCode::End, _) => {
                if self.panel == Panel::Home && !self.input.is_empty() {
                    self.move_input_cursor_to_end();
                    return None;
                }
                self.jump_selection(SelectionJump::Last);
                None
            }
            (KeyCode::Backspace, _) if self.panel.is_snapshot_panel() => {
                self.panel_filter.pop();
                self.selected = 0;
                None
            }
            (KeyCode::Backspace, _) if self.panel == Panel::Home => {
                self.handle_input_backspace();
                None
            }
            (KeyCode::Enter, _) => self.handle_enter(),
            (KeyCode::Char(c), KeyModifiers::NONE | KeyModifiers::SHIFT)
                if self.panel.is_snapshot_panel() =>
            {
                if !c.is_control() && c != '/' {
                    self.panel_filter.push(c);
                    self.selected = 0;
                }
                None
            }
            (KeyCode::Char(c), _) if self.panel == Panel::Home => {
                self.handle_input_char(c);
                None
            }
            _ => None,
        }
    }

    fn handle_command_key(&mut self, key: KeyEvent) -> Option<StartupOutcome> {
        match (key.code, key.modifiers) {
            (KeyCode::Esc, _) => {
                self.panel = Panel::Home;
                None
            }
            (KeyCode::Up, _) => {
                let count = command_count(CommandScope::Home, &self.command_filter);
                let mut overlay = OverlayState {
                    kind: OverlayKind::CommandPalette,
                    selected: self.selected,
                    filter: self.command_filter.clone(),
                    snapshot: None,
                };
                move_selection(&mut overlay, -1, count);
                self.selected = overlay.selected;
                None
            }
            (KeyCode::Down, _) => {
                let count = command_count(CommandScope::Home, &self.command_filter);
                let mut overlay = OverlayState {
                    kind: OverlayKind::CommandPalette,
                    selected: self.selected,
                    filter: self.command_filter.clone(),
                    snapshot: None,
                };
                move_selection(&mut overlay, 1, count);
                self.selected = overlay.selected;
                None
            }
            (KeyCode::PageUp, _) => {
                self.jump_command_selection(SelectionJump::PageUp(8));
                None
            }
            (KeyCode::PageDown, _) => {
                self.jump_command_selection(SelectionJump::PageDown(8));
                None
            }
            (KeyCode::Home, _) => {
                self.jump_command_selection(SelectionJump::First);
                None
            }
            (KeyCode::End, _) => {
                self.jump_command_selection(SelectionJump::Last);
                None
            }
            (KeyCode::Backspace, _) => {
                self.command_filter.pop();
                self.selected = 0;
                None
            }
            (KeyCode::Char('u'), KeyModifiers::CONTROL) => {
                self.command_filter.clear();
                self.selected = 0;
                None
            }
            (KeyCode::Char(c), KeyModifiers::NONE | KeyModifiers::SHIFT) => {
                if !c.is_control() && c != '/' {
                    self.command_filter.push(c);
                    self.selected = 0;
                }
                None
            }
            (KeyCode::Enter, _) => {
                if let Some(outcome) = self.apply_filtered_command() {
                    return outcome;
                }
                let overlay = OverlayState {
                    kind: OverlayKind::CommandPalette,
                    selected: self.selected,
                    filter: self.command_filter.clone(),
                    snapshot: None,
                };
                selected_command(&overlay, CommandScope::Home)
                    .and_then(|command| self.apply_command_action(command.action, ""))
            }
            _ => None,
        }
    }

    fn apply_filtered_command(&mut self) -> Option<Option<StartupOutcome>> {
        typed_command_action(&self.command_filter, CommandScope::Home)
            .map(|(action, args)| self.apply_command_action(action, &args))
    }

    fn toggle_panel(&mut self, panel: Panel) {
        self.panel = if self.panel == panel {
            Panel::Home
        } else {
            panel
        };
        self.selected = 0;
        self.panel_filter.clear();
    }

    fn handle_input_char(&mut self, c: char) {
        if c.is_control() || c == '\u{0}' {
            return;
        }
        let byte_pos = self.input_byte_pos(self.input_cursor);
        self.input.insert(byte_pos, c);
        self.input_cursor += 1;
    }

    fn handle_input_backspace(&mut self) {
        if self.input_cursor == 0 || self.input.is_empty() {
            return;
        }
        let byte_pos = self.input_byte_pos(self.input_cursor - 1);
        if byte_pos < self.input.len() {
            self.input.remove(byte_pos);
            self.input_cursor -= 1;
        }
    }

    fn clear_input(&mut self) {
        self.input.clear();
        self.input_cursor = 0;
    }

    fn move_input_cursor_left(&mut self) {
        self.input_cursor = self.input_cursor.saturating_sub(1);
    }

    fn move_input_cursor_right(&mut self) {
        if self.input_cursor < self.input_char_count() {
            self.input_cursor += 1;
        }
    }

    fn move_input_cursor_to_end(&mut self) {
        self.input_cursor = self.input_char_count();
    }

    fn input_char_count(&self) -> usize {
        self.input.chars().count()
    }

    fn input_byte_pos(&self, char_pos: usize) -> usize {
        self.input
            .char_indices()
            .nth(char_pos)
            .map(|(pos, _)| pos)
            .unwrap_or(self.input.len())
    }

    fn refresh_available(&self) -> bool {
        (self.panel == Panel::Home && self.input.is_empty()) || self.panel.is_snapshot_panel()
    }

    fn refresh_snapshot(&mut self) {
        let workspace = self.snapshot.current_workspace.clone();
        self.snapshot = match tokio::runtime::Handle::try_current() {
            Ok(handle) => tokio::task::block_in_place(|| {
                handle.block_on(StartupPage::load_snapshot(workspace))
            }),
            Err(_) => tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map(|runtime| runtime.block_on(StartupPage::load_snapshot(workspace)))
                .unwrap_or_else(|_| self.snapshot.clone()),
        };
        self.clamp_selection();
    }

    fn clamp_selection(&mut self) {
        if self.panel == Panel::Home {
            let max_selected = home_recent_selectable_rows(
                self.snapshot.sessions.len(),
                self.home_recent_area_height,
            );
            self.selected = self.selected.min(max_selected);
            return;
        }

        let count = self.current_panel_count();
        if count == 0 {
            self.selected = 0;
        } else {
            self.selected = self.selected.min(count.saturating_sub(1));
        }
    }

    fn move_selection(&mut self, delta: isize) {
        if self.panel == Panel::Home {
            let max_selected = home_recent_selectable_rows(
                self.snapshot.sessions.len(),
                self.home_recent_area_height,
            );
            if max_selected == 0 {
                self.selected = 0;
                return;
            }
            let current = self.selected.max(1);
            self.selected = if delta < 0 {
                current.saturating_sub(delta.unsigned_abs()).max(1)
            } else {
                current.saturating_add(delta as usize).min(max_selected)
            };
            return;
        }

        if delta < 0 {
            self.selected = self.selected.saturating_sub(delta.unsigned_abs());
        } else {
            self.selected = self.selected.saturating_add(delta as usize);
        }
    }

    fn jump_selection(&mut self, target: SelectionJump) {
        if self.panel == Panel::Home {
            let max_selected = home_recent_selectable_rows(
                self.snapshot.sessions.len(),
                self.home_recent_area_height,
            );
            if max_selected == 0 {
                self.selected = 0;
                return;
            }
            self.selected = match target {
                SelectionJump::First => 1,
                SelectionJump::Last => max_selected,
                SelectionJump::PageUp(page_size) => {
                    self.selected.max(1).saturating_sub(page_size.max(1)).max(1)
                }
                SelectionJump::PageDown(page_size) => self
                    .selected
                    .max(1)
                    .saturating_add(page_size.max(1))
                    .min(max_selected),
            };
            return;
        }

        let count = self.current_panel_count();
        let mut overlay = OverlayState {
            kind: OverlayKind::Panel(
                panel_kind_from_panel(self.panel).unwrap_or(PanelKind::Settings),
            ),
            selected: self.selected,
            filter: self.panel_filter.clone(),
            snapshot: Some(self.snapshot.clone()),
        };
        jump_selection(&mut overlay, target, count);
        self.selected = overlay.selected;
    }

    fn current_panel_count(&self) -> usize {
        let Some(kind) = panel_kind_from_panel(self.panel) else {
            return self.panel.selection_count(&self.snapshot);
        };
        let overlay = OverlayState {
            kind: OverlayKind::Panel(kind),
            selected: self.selected,
            filter: self.panel_filter.clone(),
            snapshot: Some(self.snapshot.clone()),
        };
        panel_count(&overlay)
    }

    fn jump_command_selection(&mut self, target: SelectionJump) {
        let count = command_count(CommandScope::Home, &self.command_filter);
        let mut overlay = OverlayState {
            kind: OverlayKind::CommandPalette,
            selected: self.selected,
            filter: self.command_filter.clone(),
            snapshot: None,
        };
        jump_selection(&mut overlay, target, count);
        self.selected = overlay.selected;
    }

    fn handle_enter(&mut self) -> Option<StartupOutcome> {
        if self.panel == Panel::Help {
            return None;
        }

        if self.panel == Panel::Home {
            let typed = self.input.trim().to_string();
            if typed == "/" {
                self.panel = Panel::Command;
                self.command_filter.clear();
                self.selected = 0;
                return None;
            }
            if typed.starts_with('/') {
                if let Some(command) = command_for_slash(&typed, CommandScope::Home) {
                    let args = typed
                        .split_once(char::is_whitespace)
                        .map(|(_, args)| args.trim().to_string())
                        .unwrap_or_default();
                    return self.apply_command_action(command.action, &args);
                }
                self.panel = Panel::Command;
                self.command_filter = typed.trim_start_matches('/').to_string();
                self.selected = 0;
                return None;
            }
        }

        if self.panel.is_snapshot_panel() && self.selected >= self.current_panel_count() {
            return None;
        }

        if self.panel == Panel::Home && self.home_selection_opens_sessions_panel() {
            self.panel = Panel::Sessions;
            self.panel_filter.clear();
            self.selected = 0;
            return None;
        }

        Some(StartupOutcome::Launch(self.launch_selection()))
    }

    fn home_selection_opens_sessions_panel(&self) -> bool {
        let visible = recent_session_visible_count(
            self.snapshot.sessions.len(),
            self.home_recent_area_height,
        );
        self.selected > visible
            && recent_session_hidden_count(
                self.snapshot.sessions.len(),
                self.home_recent_area_height,
            ) > 0
    }

    fn apply_command_action(
        &mut self,
        action: CommandAction,
        args: &str,
    ) -> Option<StartupOutcome> {
        match action {
            CommandAction::OpenPanel(kind) => {
                self.panel = panel_from_kind(kind);
                self.panel_filter.clear();
                self.selected = 0;
                None
            }
            CommandAction::OpenPanelAt(kind, selected) => {
                self.panel = panel_from_kind(kind);
                self.panel_filter.clear();
                self.selected =
                    selected.min(self.panel.selection_count(&self.snapshot).saturating_sub(1));
                None
            }
            CommandAction::NewSession => {
                self.clear_input();
                Some(StartupOutcome::Launch(StartupLaunch {
                    workspace: self.snapshot.current_workspace.clone(),
                    session_id: None,
                    agent: "Dispatcher".to_string(),
                    initial_message: None,
                }))
            }
            CommandAction::Help => {
                self.panel = Panel::Help;
                self.command_filter.clear();
                self.panel_filter.clear();
                self.selected = 0;
                None
            }
            CommandAction::ShowHistory | CommandAction::ExportSession => {
                self.panel = Panel::Sessions;
                self.panel_filter.clear();
                self.selected = 0;
                None
            }
            CommandAction::ShowAgents => Some(StartupOutcome::Launch(StartupLaunch {
                workspace: self.snapshot.current_workspace.clone(),
                session_id: None,
                agent: "Dispatcher".to_string(),
                initial_message: Some(available_agents_message().to_string()),
            })),
            CommandAction::Dispatch => {
                if args.is_empty() {
                    self.panel = Panel::Command;
                    self.command_filter = "dispatch".to_string();
                    self.clear_input();
                    self.selected = 0;
                    None
                } else {
                    Some(StartupOutcome::Launch(StartupLaunch {
                        workspace: self.snapshot.current_workspace.clone(),
                        session_id: None,
                        agent: "Dispatcher".to_string(),
                        initial_message: Some(format!(
                            "Delegate this work to the right specialized Agent: {}",
                            args
                        )),
                    }))
                }
            }
            CommandAction::ClearChat => None,
        }
    }

    fn launch_selection(&self) -> StartupLaunch {
        let typed = self.input.trim();
        if self.panel == Panel::Home && !typed.is_empty() {
            return StartupLaunch {
                workspace: self.snapshot.current_workspace.clone(),
                session_id: None,
                agent: "Dispatcher".to_string(),
                initial_message: Some(typed.to_string()),
            };
        }

        match self.panel {
            Panel::Sessions => {
                if let Some(session) = self
                    .selected_panel_data_index(PanelKind::Sessions)
                    .and_then(|index| self.snapshot.sessions.get(index))
                {
                    return StartupLaunch {
                        workspace: session
                            .workspace
                            .clone()
                            .or_else(|| self.snapshot.current_workspace.clone()),
                        session_id: Some(session.id.clone()),
                        agent: session.agent.clone(),
                        initial_message: None,
                    };
                }
            }
            Panel::Tasks => {
                if let Some(task) = self
                    .selected_panel_data_index(PanelKind::Tasks)
                    .and_then(|index| self.snapshot.tasks.get(index))
                {
                    return StartupLaunch {
                        workspace: task
                            .workspace
                            .clone()
                            .or_else(|| self.snapshot.current_workspace.clone()),
                        session_id: task.session_id.clone(),
                        agent: task.agent.clone(),
                        initial_message: self.initial_message_for_panel_selection(PanelKind::Tasks),
                    };
                }
            }
            Panel::Apps => {
                if self.selected_panel_data_index(PanelKind::Apps).is_some() {
                    return StartupLaunch {
                        workspace: self.snapshot.current_workspace.clone(),
                        session_id: None,
                        agent: "Dispatcher".to_string(),
                        initial_message: self.initial_message_for_panel_selection(PanelKind::Apps),
                    };
                }
            }
            Panel::Memory => {
                if self.selected_panel_data_index(PanelKind::Memory).is_some() {
                    return StartupLaunch {
                        workspace: self.snapshot.current_workspace.clone(),
                        session_id: None,
                        agent: "Dispatcher".to_string(),
                        initial_message: self
                            .initial_message_for_panel_selection(PanelKind::Memory),
                    };
                }
            }
            Panel::Workspaces => {
                if let Some(row) = self
                    .selected_panel_data_index(PanelKind::Workspaces)
                    .and_then(|index| self.snapshot.workspaces.get(index))
                {
                    let (_, session_workspace, _) = effective_workspace_selection(row.path.clone());
                    return StartupLaunch {
                        workspace: session_workspace,
                        session_id: None,
                        agent: "Dispatcher".to_string(),
                        initial_message: self
                            .initial_message_for_panel_selection(PanelKind::Workspaces),
                    };
                }
            }
            Panel::Settings => {
                if let Some(message) = self.initial_message_for_panel_selection(PanelKind::Settings)
                {
                    return StartupLaunch {
                        workspace: self.snapshot.current_workspace.clone(),
                        session_id: None,
                        agent: "Dispatcher".to_string(),
                        initial_message: Some(message),
                    };
                }
            }
            Panel::Home | Panel::Command => {}
            Panel::Help => {}
        }

        let selected_session = self
            .snapshot
            .sessions
            .get(self.selected.saturating_sub(1))
            .or_else(|| self.snapshot.sessions.first());

        StartupLaunch {
            workspace: selected_session
                .and_then(|session| session.workspace.clone())
                .or_else(|| self.snapshot.current_workspace.clone()),
            session_id: selected_session.map(|session| session.id.clone()),
            agent: selected_session
                .map(|session| session.agent.clone())
                .unwrap_or_else(|| "Dispatcher".to_string()),
            initial_message: None,
        }
    }

    fn initial_message_for_panel_selection(&self, kind: PanelKind) -> Option<String> {
        let mut overlay = OverlayState::panel(kind, self.snapshot.clone());
        overlay.selected = self.selected;
        overlay.filter = self.panel_filter.clone();
        match (
            selected_panel_detail(&overlay),
            selected_panel_prompt(&overlay),
        ) {
            (Some(detail), Some(prompt)) => Some(format!("{}\n\n{}", detail, prompt)),
            (Some(detail), None) => Some(detail),
            (None, Some(prompt)) => Some(prompt),
            (None, None) => None,
        }
    }

    fn selected_panel_data_index(&self, kind: PanelKind) -> Option<usize> {
        let mut overlay = OverlayState::panel(kind, self.snapshot.clone());
        overlay.selected = self.selected;
        overlay.filter = self.panel_filter.clone();
        overlay_selected_panel_data_index(&overlay)
    }

    fn selection_style(&self) -> Style {
        self.theme
            .style(StyleKind::Primary)
            .add_modifier(Modifier::BOLD)
    }
}

/// Left padding inside a centered home column so list rows align with the hero.
fn home_pad(area: Rect) -> usize {
    if area.width > 48 {
        2
    } else {
        0
    }
}

fn panel_from_kind(kind: PanelKind) -> Panel {
    match kind {
        PanelKind::Sessions => Panel::Sessions,
        PanelKind::Tasks => Panel::Tasks,
        PanelKind::Apps => Panel::Apps,
        PanelKind::Memory => Panel::Memory,
        PanelKind::Workspaces => Panel::Workspaces,
        PanelKind::Settings => Panel::Settings,
    }
}

fn panel_kind_from_panel(panel: Panel) -> Option<PanelKind> {
    match panel {
        Panel::Sessions => Some(PanelKind::Sessions),
        Panel::Tasks => Some(PanelKind::Tasks),
        Panel::Apps => Some(PanelKind::Apps),
        Panel::Memory => Some(PanelKind::Memory),
        Panel::Workspaces => Some(PanelKind::Workspaces),
        Panel::Settings => Some(PanelKind::Settings),
        Panel::Home | Panel::Command | Panel::Help => None,
    }
}

fn startup_footer_items(
    width: u16,
    recent_selectable_rows: usize,
    refresh_available: bool,
) -> &'static [(&'static str, &'static str)] {
    const COMPACT: &[(&str, &str)] = &[("enter", "go"), ("/", "cmd"), ("^C", "exit")];
    const COMPACT_WITH_REFRESH: &[(&str, &str)] = &[
        ("enter", "go"),
        ("/", "cmd"),
        ("R", "refresh"),
        ("^C", "exit"),
    ];
    const FULL: &[(&str, &str)] = &[
        ("enter", "go"),
        ("/", "cmd"),
        ("/sessions", "recent"),
        ("^T", "tasks"),
        ("^P", "apps"),
        ("^Y", "memory"),
        ("^O", "work"),
        ("^,", "settings"),
        ("R", "refresh"),
        ("^C", "exit"),
    ];
    const FULL_NO_REFRESH: &[(&str, &str)] = &[
        ("enter", "go"),
        ("/", "cmd"),
        ("/sessions", "recent"),
        ("^T", "tasks"),
        ("^P", "apps"),
        ("^Y", "memory"),
        ("^O", "work"),
        ("^,", "settings"),
        ("^C", "exit"),
    ];
    const FULL_WITH_NAV: &[(&str, &str)] = &[
        ("enter", "go"),
        ("Pg/Home/End", "move"),
        ("/", "cmd"),
        ("^T/P/Y/O/,", "panels"),
        ("R", "refresh"),
        ("^C", "exit"),
    ];
    const FULL_WITH_NAV_NO_REFRESH: &[(&str, &str)] = &[
        ("enter", "go"),
        ("Pg/Home/End", "move"),
        ("/", "cmd"),
        ("^T/P/Y/O/,", "panels"),
        ("^C", "exit"),
    ];

    if width < 72 {
        if refresh_available {
            COMPACT_WITH_REFRESH
        } else {
            COMPACT
        }
    } else if recent_selectable_rows > 1 {
        if refresh_available {
            FULL_WITH_NAV
        } else {
            FULL_WITH_NAV_NO_REFRESH
        }
    } else if refresh_available {
        FULL
    } else {
        FULL_NO_REFRESH
    }
}

fn refresh_key(key: KeyEvent) -> bool {
    matches!(key.code, KeyCode::Char('R'))
        || matches!(
            (key.code, key.modifiers),
            (KeyCode::Char('r'), KeyModifiers::SHIFT)
        )
}

fn startup_counter_items(snapshot: &DispatcherSnapshot) -> [(usize, &'static str); 5] {
    [
        (snapshot.workspaces.len(), "workspaces"),
        (snapshot.tasks.len(), "tasks"),
        (snapshot.apps.len(), "apps"),
        (snapshot.memories.len(), "memory"),
        (snapshot.sessions.len(), "sessions"),
    ]
}

fn session_kind_label(is_dispatch_task: bool) -> &'static str {
    if is_dispatch_task {
        "task"
    } else {
        "session"
    }
}

fn recent_session_limit(area_height: u16) -> usize {
    if area_height < 7 {
        3
    } else {
        5
    }
}

fn recent_session_visible_count(total_sessions: usize, area_height: u16) -> usize {
    if total_sessions == 0 {
        return 0;
    }
    let visible_limit = recent_session_limit(area_height);
    let has_more_than_limit = total_sessions > visible_limit;
    let available_rows = area_height.saturating_sub(1) as usize;
    let visible_rows = if has_more_than_limit {
        available_rows.saturating_sub(1)
    } else {
        available_rows
    };
    visible_limit.min(visible_rows.max(1)).min(total_sessions)
}

fn recent_session_hidden_count(total_sessions: usize, area_height: u16) -> usize {
    total_sessions.saturating_sub(recent_session_visible_count(total_sessions, area_height))
}

fn home_recent_selectable_rows(total_sessions: usize, area_height: u16) -> usize {
    let visible = recent_session_visible_count(total_sessions, area_height);
    let hidden = recent_session_hidden_count(total_sessions, area_height);
    visible + usize::from(hidden > 0)
}

impl Panel {
    fn is_snapshot_panel(self) -> bool {
        matches!(
            self,
            Self::Sessions
                | Self::Tasks
                | Self::Apps
                | Self::Memory
                | Self::Workspaces
                | Self::Settings
        )
    }

    fn selection_count(self, snapshot: &DispatcherSnapshot) -> usize {
        match self {
            Self::Sessions => snapshot.sessions.len(),
            Self::Tasks => snapshot.tasks.len(),
            Self::Apps => snapshot.apps.len(),
            Self::Memory => snapshot.memories.len(),
            Self::Workspaces => snapshot.workspaces.len(),
            Self::Settings => 5,
            Self::Home | Self::Command | Self::Help => 0,
        }
    }
}

/// Return a horizontally centered sub-rect capped at `max_width`, leaving a 1-row top margin.
fn centered_column(area: Rect, max_width: u16) -> Rect {
    let width = area.width.min(max_width);
    let x = area.x + area.width.saturating_sub(width) / 2;
    let top = if area.height > 2 { 1 } else { 0 };
    Rect {
        x,
        y: area.y + top,
        width,
        height: area.height.saturating_sub(top),
    }
}

fn short_path(path: impl AsRef<str>) -> String {
    let value = path.as_ref().replace('\\', "/");
    dirs::home_dir()
        .and_then(|home| {
            let home = home.to_string_lossy().replace('\\', "/");
            value.strip_prefix(&home).map(|rest| format!("~{}", rest))
        })
        .unwrap_or(value)
}

fn compact_status_part(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    if max_bytes <= 3 {
        return ".".repeat(max_bytes);
    }
    truncate_str(value, max_bytes.saturating_sub(3))
}

fn compact_startup_text(value: &str, max_bytes: usize) -> String {
    compact_status_part(value.lines().next().unwrap_or(""), max_bytes)
}

#[cfg(test)]
fn startup_input_text(value: &str, max_width: usize) -> String {
    startup_input_window(value, value.chars().count(), max_width).0
}

fn startup_input_window(value: &str, cursor: usize, max_width: usize) -> (String, u16) {
    let first_line = value.lines().next().unwrap_or("");
    if max_width == 0 {
        return (String::new(), 0);
    }
    if first_line.width() <= max_width {
        let cursor_x = first_line
            .chars()
            .take(cursor)
            .map(|ch| UnicodeWidthChar::width(ch).unwrap_or(0))
            .sum::<usize>()
            .min(max_width) as u16;
        return (first_line.to_string(), cursor_x);
    }
    if max_width <= 3 {
        return (".".repeat(max_width), max_width as u16);
    }

    let chars = first_line.chars().collect::<Vec<_>>();
    let cursor = cursor.min(chars.len());
    let tail_width = max_width.saturating_sub(3);
    let mut width = 0;
    let mut start = cursor;
    while start > 0 {
        let ch_width = UnicodeWidthChar::width(chars[start - 1]).unwrap_or(0);
        if width + ch_width > tail_width {
            break;
        }
        start -= 1;
        width += ch_width;
    }

    let mut visible = if start > 0 {
        String::from("...")
    } else {
        String::new()
    };
    for ch in &chars[start..cursor] {
        visible.push(*ch);
    }
    let cursor_x = visible.width().min(max_width) as u16;
    for ch in &chars[cursor..] {
        let next_width = visible.width() + UnicodeWidthChar::width(*ch).unwrap_or(0);
        if next_width > max_width {
            break;
        }
        visible.push(*ch);
    }

    (visible, cursor_x)
}

fn startup_status_labels(
    model: &str,
    workspace: Option<&str>,
    git_branch: Option<&str>,
    width: u16,
) -> (String, String, String) {
    let available = width.saturating_sub(10) as usize;
    let tight = available < 54;
    let model_limit = if tight { 14 } else { 22 };
    let workspace_limit = if tight { 18 } else { 28 };
    let branch_limit = available
        .saturating_sub(model_limit + workspace_limit)
        .clamp(if tight { 10 } else { 14 }, if tight { 16 } else { 24 });

    (
        compact_status_part(model, model_limit),
        compact_status_part(
            &workspace
                .map(short_path)
                .unwrap_or_else(|| "global".to_string()),
            workspace_limit,
        ),
        compact_status_part(git_branch.unwrap_or("no-git"), branch_limit),
    )
}

fn format_clock(timestamp_ms: u64) -> String {
    chrono::DateTime::<chrono::Local>::from(
        std::time::UNIX_EPOCH + std::time::Duration::from_millis(timestamp_ms),
    )
    .format("%H:%M")
    .to_string()
}

fn format_relative_time(timestamp_ms: u64) -> String {
    let now = chrono::Utc::now().timestamp_millis().max(0) as u64;
    let elapsed = now.saturating_sub(timestamp_ms);
    let minutes = elapsed / 60_000;
    if minutes < 1 {
        "just now".to_string()
    } else if minutes < 60 {
        format!("{} min ago", minutes)
    } else if minutes < 24 * 60 {
        format!("{} h ago", minutes / 60)
    } else {
        format!("{} d ago", minutes / (24 * 60))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitfun_core::command::agentic_os::{
        AgenticOsAppRow, AgenticOsMemoryRow, AgenticOsSessionRow, AgenticOsSnapshot,
        AgenticOsTaskRow, AgenticOsWorkspaceRow,
    };
    use ratatui::{backend::TestBackend, Terminal};
    use unicode_width::UnicodeWidthStr;

    fn terminal_text(terminal: &Terminal<TestBackend>) -> String {
        let buffer = terminal.backend().buffer();
        let mut text = String::new();
        for y in 0..buffer.area.height {
            for x in 0..buffer.area.width {
                text.push_str(buffer[(x, y)].symbol());
            }
            text.push('\n');
        }
        text
    }

    fn sample_snapshot() -> AgenticOsSnapshot {
        AgenticOsSnapshot {
            model: "test-model".to_string(),
            current_workspace: Some("D:\\workspace\\project".to_string()),
            git_branch: Some("git main".to_string()),
            sessions: vec![AgenticOsSessionRow {
                id: "session-1".to_string(),
                title: "Build CLI".to_string(),
                agent: "Dispatcher".to_string(),
                workspace: Some("D:\\workspace\\project".to_string()),
                parent_session_id: None,
                is_dispatch_task: false,
                turns: 3,
                child_count: 1,
                last_active_at: chrono::Utc::now().timestamp_millis().max(0) as u64,
            }],
            tasks: Vec::new(),
            apps: vec![AgenticOsAppRow {
                id: "app-1".to_string(),
                name: "Files".to_string(),
                kind: "AGENT APP".to_string(),
                description: "Browse files".to_string(),
                capability: "read write".to_string(),
                target: None,
            }],
            memories: vec![AgenticOsMemoryRow {
                scope: "GLOBAL".to_string(),
                file: "memory.md".to_string(),
                target: "D:\\memory".to_string(),
            }],
            workspaces: vec![AgenticOsWorkspaceRow {
                label: "project".to_string(),
                path: Some("D:\\workspace\\project".to_string()),
                git: Some("git main".to_string()),
                session_count: 1,
            }],
        }
    }

    fn sample_snapshot_with_task(session_id: Option<&str>) -> AgenticOsSnapshot {
        let mut snapshot = sample_snapshot();
        snapshot.tasks = vec![AgenticOsTaskRow {
            title: "Review TUI task flow".to_string(),
            agent: "debug".to_string(),
            status: "active".to_string(),
            detail: "Needs product review".to_string(),
            session_id: session_id.map(str::to_string),
            workspace: Some("D:\\workspace\\project".to_string()),
        }];
        snapshot
    }

    fn sample_snapshot_with_sessions(count: usize) -> AgenticOsSnapshot {
        let mut snapshot = sample_snapshot();
        snapshot.sessions = (0..count)
            .map(|index| AgenticOsSessionRow {
                id: format!("session-{index}"),
                title: format!("Session {index}"),
                agent: "Dispatcher".to_string(),
                workspace: Some("D:\\workspace\\project".to_string()),
                parent_session_id: None,
                is_dispatch_task: false,
                turns: index,
                child_count: 0,
                last_active_at: chrono::Utc::now().timestamp_millis().max(0) as u64,
            })
            .collect();
        snapshot
    }

    #[test]
    fn startup_home_renders_at_common_sizes() {
        for (width, height) in [(100, 30), (42, 14)] {
            let backend = TestBackend::new(width, height);
            let mut terminal = Terminal::new(backend).unwrap();
            let mut page = StartupPage::new(sample_snapshot());
            terminal.draw(|frame| page.render(frame)).unwrap();
        }
    }

    #[test]
    fn startup_home_renders_long_session_titles_at_common_sizes() {
        for (width, height) in [(100, 30), (60, 20), (42, 14)] {
            let backend = TestBackend::new(width, height);
            let mut terminal = Terminal::new(backend).unwrap();
            let mut snapshot = sample_snapshot_with_sessions(8);
            for session in &mut snapshot.sessions {
                session.title =
                    "A very long dispatcher chapter title that should stay visually contained"
                        .to_string();
            }
            let mut page = StartupPage::new(snapshot);

            terminal.draw(|frame| page.render(frame)).unwrap();
        }
    }

    #[test]
    fn startup_home_footer_surfaces_page_navigation_only_when_useful() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot_with_sessions(8));

        terminal.draw(|frame| page.render(frame)).unwrap();
        assert!(terminal_text(&terminal).contains("Pg/Home/End move"));

        let backend = TestBackend::new(42, 14);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot_with_sessions(8));

        terminal.draw(|frame| page.render(frame)).unwrap();
        assert!(!terminal_text(&terminal).contains("Pg/Home/End move"));

        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot_with_sessions(1));

        terminal.draw(|frame| page.render(frame)).unwrap();
        assert!(!terminal_text(&terminal).contains("Pg/Home/End move"));
    }

    #[test]
    fn startup_footer_exposes_memory_and_settings_on_wide_terminals() {
        let full = startup_footer_items(100, 1, true);
        assert!(full.contains(&("enter", "go")));
        assert!(!full.contains(&("Pg/Home/End", "move")));
        assert!(full.contains(&("/sessions", "recent")));
        assert!(full.contains(&("^Y", "memory")));
        assert!(full.contains(&("^,", "settings")));
        assert!(full.contains(&("R", "refresh")));

        let compact = startup_footer_items(42, 6, true);
        assert!(compact.contains(&("enter", "go")));
        assert!(!compact.contains(&("Pg/Home/End", "move")));
        assert!(!compact.contains(&("/sessions", "recent")));
        assert!(!compact.contains(&("^Y", "memory")));
        assert!(!compact.contains(&("^,", "settings")));
        assert!(compact.contains(&("R", "refresh")));
        assert!(compact.contains(&("/", "cmd")));

        let nav = startup_footer_items(100, 6, true);
        assert!(nav.contains(&("Pg/Home/End", "move")));
        assert!(nav.contains(&("^T/P/Y/O/,", "panels")));
        assert!(nav.contains(&("R", "refresh")));
        assert!(!nav.contains(&("^,", "settings")));
    }

    #[test]
    fn startup_counters_include_primary_product_surfaces() {
        let snapshot = sample_snapshot();
        let counters = startup_counter_items(&snapshot);

        assert_eq!(
            counters,
            [
                (1, "workspaces"),
                (0, "tasks"),
                (1, "apps"),
                (1, "memory"),
                (1, "sessions")
            ]
        );
    }

    #[test]
    fn startup_recent_sessions_mark_dispatch_tasks() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut snapshot = sample_snapshot_with_sessions(2);
        snapshot.sessions[0].is_dispatch_task = true;
        snapshot.sessions[0].title = "Implement startup pagination".to_string();
        snapshot.sessions[1].title = "Plan next session".to_string();
        let mut page = StartupPage::new(snapshot);

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);

        assert!(text.contains("task"));
        assert!(text.contains("session"));
        assert!(text.contains("sessions"));
        assert!(!text.contains("chapter"));
    }

    #[test]
    fn startup_status_labels_stay_compact() {
        let (model, workspace, branch) = startup_status_labels(
            "extremely-long-model-routing-name-that-keeps-going",
            Some("D:\\workspace\\project\\with\\a\\very\\deep\\path\\that\\keeps\\going"),
            Some("git feature/a-very-long-branch-name-that-keeps-going"),
            48,
        );

        assert!(model.ends_with("..."));
        assert!(workspace.ends_with("..."));
        assert!(branch.ends_with("..."));
        assert!(model.len() <= 14);
        assert!(workspace.len() <= 18);
        assert!(branch.len() <= 16);

        let wide = startup_status_labels(
            "primary",
            Some("D:\\workspace\\project"),
            Some("git main"),
            100,
        );
        assert_eq!(wide.0, "primary");
        assert_eq!(wide.1, "D:/workspace/project");
        assert_eq!(wide.2, "git main");
    }

    #[test]
    fn startup_session_titles_stay_compact() {
        let title = compact_startup_text(
            "This is a very long dispatcher chapter title that should not dominate the home page",
            24,
        );

        assert!(title.ends_with("..."));
        assert!(title.len() <= 24);
        assert_eq!(
            compact_startup_text("First line\nSecond line", 24),
            "First line"
        );
    }

    #[test]
    fn startup_input_keeps_tail_context_when_long() {
        let input = startup_input_text("sparo sessions export very-long-session-id", 18);

        assert!(input.starts_with("..."));
        assert!(input.ends_with("long-session-id"));
        assert!(input.width() <= 18);

        let unicode_input = startup_input_text("请帮我总结这个workspace里面最近发生了什么", 14);
        assert!(unicode_input.starts_with("..."));
        assert!(unicode_input.width() <= 14);
    }

    #[test]
    fn startup_home_renders_long_typed_input_without_full_overflow() {
        let backend = TestBackend::new(42, 14);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot());
        page.input =
            "Please inspect every panel and produce a careful usability report".to_string();
        page.move_input_cursor_to_end();

        terminal.draw(|frame| page.render(frame)).unwrap();

        let text = terminal_text(&terminal);
        assert!(!text.contains("Please inspect every panel and produce"));
        assert!(text.contains("..."));
        assert!(text.contains("usability report"));
    }

    #[test]
    fn startup_recent_sessions_stay_curated() {
        assert_eq!(recent_session_visible_count(8, 12), 5);
        assert_eq!(recent_session_hidden_count(8, 12), 3);
        assert_eq!(recent_session_visible_count(8, 6), 3);
        assert_eq!(recent_session_hidden_count(8, 6), 5);
        assert_eq!(recent_session_visible_count(2, 12), 2);
        assert_eq!(recent_session_hidden_count(2, 12), 0);
        assert_eq!(home_recent_selectable_rows(8, 12), 6);
        assert_eq!(home_recent_selectable_rows(8, 6), 4);
        assert_eq!(home_recent_selectable_rows(2, 12), 2);
    }

    #[test]
    fn startup_home_action_line_tracks_selected_recent_session() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot_with_sessions(4));
        page.selected = 3;

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);

        assert!(text.contains("Continue"));
        assert!(text.contains("Session 2"));
        assert!(!text.contains("Session 0   session"));
    }

    #[test]
    fn startup_home_action_line_explains_more_row() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot_with_sessions(8));
        page.selected = 6;

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);

        assert!(text.contains("Open"));
        assert!(text.contains("Sessions"));
        assert!(text.contains("3 more saved"));
    }

    #[test]
    fn startup_home_action_line_prioritizes_typed_input() {
        let backend = TestBackend::new(70, 20);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot_with_sessions(4));
        page.selected = 2;
        page.input = "Review the CLI product surface".to_string();

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);

        assert!(text.contains("Send"));
        assert!(text.contains("Review the CLI product surface"));
        assert!(text.contains("new session"));
    }

    #[test]
    fn startup_home_text_input_can_type_r_when_refresh_is_hidden() {
        let mut page = StartupPage::new(sample_snapshot());

        assert!(page.refresh_available());
        page.handle_key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::NONE));
        assert_eq!(page.input, "r");
        assert!(!page.refresh_available());

        page.handle_key(KeyEvent::new(KeyCode::Char('R'), KeyModifiers::SHIFT));
        assert_eq!(page.input, "rR");

        let footer = startup_footer_items(100, 1, page.refresh_available());
        assert!(!footer.contains(&("R", "refresh")));
    }

    #[test]
    fn startup_home_input_supports_cursor_editing() {
        let mut page = StartupPage::new(sample_snapshot());
        for ch in "helo".chars() {
            page.handle_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }

        page.handle_key(KeyEvent::new(KeyCode::Left, KeyModifiers::NONE));
        page.handle_key(KeyEvent::new(KeyCode::Char('l'), KeyModifiers::NONE));

        assert_eq!(page.input, "hello");
        assert_eq!(page.input_cursor, 4);

        page.handle_key(KeyEvent::new(KeyCode::Home, KeyModifiers::NONE));
        assert_eq!(page.input_cursor, 0);

        page.handle_key(KeyEvent::new(KeyCode::Char('>'), KeyModifiers::SHIFT));
        assert_eq!(page.input, ">hello");

        page.handle_key(KeyEvent::new(KeyCode::End, KeyModifiers::NONE));
        assert_eq!(page.input_cursor, page.input.chars().count());

        page.handle_key(KeyEvent::new(KeyCode::Backspace, KeyModifiers::NONE));
        assert_eq!(page.input, ">hell");
    }

    #[test]
    fn startup_ctrl_u_clears_home_and_overlay_filters() {
        let mut page = StartupPage::new(sample_snapshot());
        for ch in "draft".chars() {
            page.handle_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }
        page.handle_key(KeyEvent::new(KeyCode::Char('u'), KeyModifiers::CONTROL));
        assert!(page.input.is_empty());
        assert_eq!(page.input_cursor, 0);

        page.panel = Panel::Sessions;
        page.panel_filter = "review".to_string();
        page.selected = 3;
        page.handle_key(KeyEvent::new(KeyCode::Char('u'), KeyModifiers::CONTROL));
        assert!(page.panel_filter.is_empty());
        assert_eq!(page.selected, 0);

        page.panel = Panel::Command;
        page.command_filter = "settings".to_string();
        page.selected = 2;
        page.handle_command_key(KeyEvent::new(KeyCode::Char('u'), KeyModifiers::CONTROL));
        assert!(page.command_filter.is_empty());
        assert_eq!(page.selected, 0);
    }

    #[test]
    fn startup_home_input_window_tracks_cursor() {
        let value = "sparo sessions export session-id";
        let (tail, tail_cursor) = startup_input_window(value, value.chars().count(), 18);
        assert!(tail.starts_with("..."));
        assert!(tail.ends_with("session-id"));
        assert_eq!(tail_cursor as usize, tail.width());

        let (head, head_cursor) = startup_input_window(value, 0, 18);
        assert!(!head.starts_with("..."));
        assert_eq!(head_cursor, 0);
        assert!(head.starts_with("sparo"));
    }

    #[test]
    fn startup_home_refresh_shortcut_does_not_append_when_input_empty() {
        let mut page = StartupPage::new(sample_snapshot());

        page.handle_key(KeyEvent::new(KeyCode::Char('R'), KeyModifiers::SHIFT));

        assert!(page.input.is_empty());
        assert!(page.refresh_available());
    }

    #[test]
    fn startup_home_selection_stops_at_more_row() {
        let mut page = StartupPage::new(sample_snapshot_with_sessions(8));

        for _ in 0..20 {
            page.handle_key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
        }

        assert_eq!(page.selected, 6);

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(outcome.is_none());
        assert_eq!(page.panel, Panel::Sessions);
        assert_eq!(page.selected, 0);
    }

    #[test]
    fn startup_home_supports_page_and_edge_navigation() {
        let mut page = StartupPage::new(sample_snapshot_with_sessions(8));
        page.home_recent_area_height = 12;

        page.handle_key(KeyEvent::new(KeyCode::End, KeyModifiers::NONE));
        assert_eq!(page.selected, 6);

        page.handle_key(KeyEvent::new(KeyCode::Home, KeyModifiers::NONE));
        assert_eq!(page.selected, 1);

        page.handle_key(KeyEvent::new(KeyCode::PageDown, KeyModifiers::NONE));
        assert_eq!(page.selected, 6);

        page.handle_key(KeyEvent::new(KeyCode::PageUp, KeyModifiers::NONE));
        assert_eq!(page.selected, 1);
    }

    #[test]
    fn startup_clamps_selection_after_snapshot_changes() {
        let mut page = StartupPage::new(sample_snapshot_with_sessions(8));
        page.panel = Panel::Sessions;
        page.selected = 7;
        page.snapshot.sessions.truncate(2);

        page.clamp_selection();

        assert_eq!(page.selected, 1);

        page.snapshot.sessions.clear();
        page.clamp_selection();

        assert_eq!(page.selected, 0);
    }

    #[test]
    fn startup_home_selection_uses_compact_render_height() {
        let backend = TestBackend::new(42, 14);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot_with_sessions(8));
        terminal.draw(|frame| page.render(frame)).unwrap();

        for _ in 0..20 {
            page.handle_key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
        }

        assert_eq!(
            page.selected,
            home_recent_selectable_rows(8, page.home_recent_area_height)
        );

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(outcome.is_none());
        assert_eq!(page.panel, Panel::Sessions);
        assert_eq!(page.selected, 0);
    }

    #[test]
    fn startup_home_enter_never_launches_hidden_recent_session() {
        let mut page = StartupPage::new(sample_snapshot_with_sessions(8));
        page.selected = 6;

        let outcome = page.handle_enter();

        assert!(outcome.is_none());
        assert_eq!(page.panel, Panel::Sessions);
        assert_eq!(page.selected, 0);
    }

    #[test]
    fn startup_enter_with_typed_input_launches_initial_message() {
        let mut page = StartupPage::new(sample_snapshot());
        page.input = "Summarize this workspace".to_string();

        let outcome = page.handle_enter().unwrap();

        match outcome {
            StartupOutcome::Launch(launch) => {
                assert_eq!(
                    launch.initial_message.as_deref(),
                    Some("Summarize this workspace")
                );
                assert_eq!(launch.agent, "Dispatcher");
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_command_palette_can_select_apps_panel() {
        let mut page = StartupPage::new(sample_snapshot());
        page.command_filter = "apps".to_string();

        let outcome = page.handle_command_key(KeyEvent::from(KeyCode::Enter));

        assert!(outcome.is_none());
        assert_eq!(page.panel, Panel::Apps);
    }

    #[test]
    fn startup_command_palette_can_select_sessions_panel() {
        let mut page = StartupPage::new(sample_snapshot());
        page.command_filter = "sessions".to_string();

        let outcome = page.handle_command_key(KeyEvent::from(KeyCode::Enter));

        assert!(outcome.is_none());
        assert_eq!(page.panel, Panel::Sessions);
    }

    #[test]
    fn startup_command_palette_supports_page_and_edge_navigation() {
        let mut page = StartupPage::new(sample_snapshot());
        page.panel = Panel::Command;

        page.handle_command_key(KeyEvent::from(KeyCode::End));
        assert_eq!(
            page.selected,
            command_count(CommandScope::Home, "").saturating_sub(1)
        );

        page.handle_command_key(KeyEvent::from(KeyCode::Home));
        assert_eq!(page.selected, 0);

        page.handle_command_key(KeyEvent::from(KeyCode::PageDown));
        assert_eq!(page.selected, 8);

        page.handle_command_key(KeyEvent::from(KeyCode::PageUp));
        assert_eq!(page.selected, 0);
    }

    #[test]
    fn startup_snapshot_panels_support_page_and_edge_navigation() {
        let mut page = StartupPage::new(sample_snapshot());
        page.panel = Panel::Settings;

        page.handle_key(KeyEvent::new(KeyCode::End, KeyModifiers::NONE));
        assert_eq!(page.selected, 4);

        page.handle_key(KeyEvent::new(KeyCode::Home, KeyModifiers::NONE));
        assert_eq!(page.selected, 0);

        page.handle_key(KeyEvent::new(KeyCode::PageDown, KeyModifiers::NONE));
        assert_eq!(page.selected, 4);

        page.handle_key(KeyEvent::new(KeyCode::PageUp, KeyModifiers::NONE));
        assert_eq!(page.selected, 0);
    }

    #[test]
    fn startup_shortcuts_toggle_panels_and_escape_returns_home() {
        let mut page = StartupPage::new(sample_snapshot());

        assert!(page
            .handle_key(KeyEvent::new(KeyCode::Char('t'), KeyModifiers::CONTROL))
            .is_none());
        assert_eq!(page.panel, Panel::Tasks);

        page.handle_key(KeyEvent::new(KeyCode::Char('t'), KeyModifiers::CONTROL));
        assert_eq!(page.panel, Panel::Home);

        page.handle_key(KeyEvent::new(KeyCode::Char('y'), KeyModifiers::CONTROL));
        assert_eq!(page.panel, Panel::Memory);

        page.handle_key(KeyEvent::new(KeyCode::Char('o'), KeyModifiers::CONTROL));
        assert_eq!(page.panel, Panel::Workspaces);

        page.handle_key(KeyEvent::new(KeyCode::Char(','), KeyModifiers::CONTROL));
        assert_eq!(page.panel, Panel::Settings);

        page.handle_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert_eq!(page.panel, Panel::Home);
    }

    #[test]
    fn startup_refresh_shortcut_matches_visible_surfaces() {
        let mut page = StartupPage::new(sample_snapshot());

        page.panel = Panel::Home;
        assert!(page.refresh_available());

        for panel in [
            Panel::Sessions,
            Panel::Tasks,
            Panel::Apps,
            Panel::Memory,
            Panel::Workspaces,
            Panel::Settings,
        ] {
            page.panel = panel;
            assert!(page.refresh_available(), "{panel:?} should support refresh");
        }

        for panel in [Panel::Command, Panel::Help] {
            page.panel = panel;
            assert!(
                !page.refresh_available(),
                "{panel:?} should not advertise refresh"
            );
        }
    }

    #[test]
    fn startup_memory_shortcut_does_not_conflict_with_enter() {
        let mut page = StartupPage::new(sample_snapshot());

        page.handle_key(KeyEvent::new(KeyCode::Char('m'), KeyModifiers::CONTROL));
        assert_eq!(page.panel, Panel::Home);

        page.handle_key(KeyEvent::new(KeyCode::Char('y'), KeyModifiers::CONTROL));
        assert_eq!(page.panel, Panel::Memory);
    }

    #[test]
    fn startup_typed_slash_command_opens_panel() {
        let mut page = StartupPage::new(sample_snapshot());
        for ch in "/apps".chars() {
            page.handle_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(outcome.is_none());
        assert_eq!(page.panel, Panel::Apps);
        assert_eq!(page.selected, 0);
    }

    #[test]
    fn startup_typed_chapters_alias_opens_sessions_panel() {
        for slash in ["/chapters", "/recent", "/resume"] {
            let mut page = StartupPage::new(sample_snapshot());
            for ch in slash.chars() {
                page.handle_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
            }

            let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

            assert!(outcome.is_none(), "{slash} should open sessions");
            assert_eq!(page.panel, Panel::Sessions);
            assert_eq!(page.selected, 0);
        }
    }

    #[test]
    fn startup_typed_memories_alias_opens_memory_panel() {
        let mut page = StartupPage::new(sample_snapshot());
        for ch in "/memories".chars() {
            page.handle_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(outcome.is_none());
        assert_eq!(page.panel, Panel::Memory);
        assert_eq!(page.selected, 0);
    }

    #[test]
    fn startup_typed_work_alias_opens_workspaces_panel() {
        let mut page = StartupPage::new(sample_snapshot());
        for ch in "/work".chars() {
            page.handle_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(outcome.is_none());
        assert_eq!(page.panel, Panel::Workspaces);
        assert_eq!(page.selected, 0);
    }

    #[test]
    fn startup_typed_health_alias_opens_settings_health_row() {
        let mut page = StartupPage::new(sample_snapshot());
        for ch in "/health".chars() {
            page.handle_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(outcome.is_none());
        assert_eq!(page.panel, Panel::Settings);
        assert_eq!(page.selected, 3);
    }

    #[test]
    fn startup_typed_storage_alias_opens_settings_data_row() {
        let mut page = StartupPage::new(sample_snapshot());
        for ch in "/storage".chars() {
            page.handle_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(outcome.is_none());
        assert_eq!(page.panel, Panel::Settings);
        assert_eq!(page.selected, 4);
    }

    #[test]
    fn startup_typed_prefs_command_opens_settings_workspace_row() {
        let mut page = StartupPage::new(sample_snapshot());
        for ch in "/prefs".chars() {
            page.handle_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(outcome.is_none());
        assert_eq!(page.panel, Panel::Settings);
        assert_eq!(page.selected, 1);
    }

    #[test]
    fn startup_typed_history_and_export_open_sessions_panel() {
        for slash in ["/history", "/export"] {
            let mut page = StartupPage::new(sample_snapshot());
            for ch in slash.chars() {
                page.handle_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
            }

            let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

            assert!(outcome.is_none(), "{slash} should open a panel");
            assert_eq!(page.panel, Panel::Sessions, "{slash} should show sessions");
            assert_eq!(page.selected, 0);
        }
    }

    #[test]
    fn startup_typed_agents_launches_agent_reference_input() {
        let mut page = StartupPage::new(sample_snapshot());
        for ch in "/agents".chars() {
            page.handle_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        match outcome.unwrap() {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.session_id, None);
                assert_eq!(launch.agent, "Dispatcher");
                assert!(launch
                    .initial_message
                    .as_deref()
                    .unwrap()
                    .contains("Available Agents"));
                assert!(launch
                    .initial_message
                    .as_deref()
                    .unwrap()
                    .contains("debug - debugging and diagnosis"));
                assert!(launch
                    .initial_message
                    .as_deref()
                    .unwrap()
                    .contains("/dispatch <task>"));
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_typed_dispatch_with_task_launches_delegation_input() {
        let mut page = StartupPage::new(sample_snapshot());
        for ch in "/dispatch review the CLI panel flow".chars() {
            page.handle_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        match outcome.unwrap() {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.session_id, None);
                assert_eq!(launch.agent, "Dispatcher");
                assert!(launch
                    .initial_message
                    .as_deref()
                    .unwrap()
                    .contains("Delegate this work to the right specialized Agent"));
                assert!(launch
                    .initial_message
                    .as_deref()
                    .unwrap()
                    .contains("review the CLI panel flow"));
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_typed_dispatch_without_task_opens_command_palette() {
        let mut page = StartupPage::new(sample_snapshot());
        for ch in "/dispatch".chars() {
            page.handle_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(outcome.is_none());
        assert_eq!(page.panel, Panel::Command);
        assert_eq!(page.command_filter, "dispatch");
    }

    #[test]
    fn startup_unknown_slash_opens_filtered_command_palette() {
        let mut page = StartupPage::new(sample_snapshot());
        for ch in "/unknown".chars() {
            page.handle_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(outcome.is_none());
        assert_eq!(page.panel, Panel::Command);
        assert_eq!(page.command_filter, "unknown");
        assert_eq!(page.selected, 0);
    }

    #[test]
    fn startup_help_command_opens_reference_without_launching() {
        let mut page = StartupPage::new(sample_snapshot());
        for ch in "/help".chars() {
            page.handle_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(outcome.is_none());
        assert_eq!(page.panel, Panel::Help);
        assert!(page
            .handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE))
            .is_none());
        assert_eq!(page.panel, Panel::Help);
    }

    #[test]
    fn startup_recent_session_selection_launches_selected_session() {
        let mut page = StartupPage::new(sample_snapshot());
        page.selected = 1;

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        match outcome.unwrap() {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.session_id.as_deref(), Some("session-1"));
                assert_eq!(launch.workspace.as_deref(), Some("D:\\workspace\\project"));
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_sessions_panel_launches_selected_session() {
        let mut page = StartupPage::new(sample_snapshot());
        page.panel = Panel::Sessions;

        let outcome = page.handle_enter().unwrap();

        match outcome {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.session_id.as_deref(), Some("session-1"));
                assert_eq!(launch.agent, "Dispatcher");
                assert_eq!(launch.workspace.as_deref(), Some("D:\\workspace\\project"));
                assert!(launch.initial_message.is_none());
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_snapshot_panel_filter_launches_matching_item() {
        let mut page = StartupPage::new(sample_snapshot_with_sessions(6));
        page.panel = Panel::Sessions;

        for ch in "Session 4".chars() {
            page.handle_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }

        assert_eq!(page.panel_filter, "Session 4");
        assert_eq!(page.current_panel_count(), 1);

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        match outcome.unwrap() {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.session_id.as_deref(), Some("session-4"));
                assert_eq!(launch.agent, "Dispatcher");
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_snapshot_panel_escape_clears_filter_before_closing() {
        let mut page = StartupPage::new(sample_snapshot_with_sessions(6));
        page.panel = Panel::Sessions;
        page.panel_filter = "Session 4".to_string();

        page.handle_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert_eq!(page.panel, Panel::Sessions);
        assert!(page.panel_filter.is_empty());

        page.handle_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert_eq!(page.panel, Panel::Home);
    }

    #[test]
    fn startup_apps_selection_launches_app_action_prompt() {
        let mut page = StartupPage::new(sample_snapshot());
        page.panel = Panel::Apps;

        let outcome = page.handle_enter().unwrap();

        match outcome {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.session_id, None);
                assert!(launch
                    .initial_message
                    .as_deref()
                    .unwrap()
                    .contains("App detail"));
                assert!(launch
                    .initial_message
                    .as_deref()
                    .unwrap()
                    .contains("sparo apps show --workspace D:\\workspace\\project app-1"));
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_tasks_selection_launches_task_action_prompt() {
        let mut page = StartupPage::new(sample_snapshot_with_task(Some("task-session")));
        page.panel = Panel::Tasks;

        let outcome = page.handle_enter().unwrap();

        match outcome {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.session_id.as_deref(), Some("task-session"));
                assert_eq!(launch.agent, "debug");
                assert_eq!(launch.workspace.as_deref(), Some("D:\\workspace\\project"));
                let message = launch.initial_message.as_deref().unwrap();
                assert!(message.contains("Task detail"));
                assert!(message
                    .contains("sparo tasks --workspace D:\\workspace\\project show task-session"));
                assert!(message.contains(
                    "sparo tasks --workspace D:\\workspace\\project resume task-session"
                ));
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_tasks_selection_without_session_still_prepares_action_prompt() {
        let mut page = StartupPage::new(sample_snapshot_with_task(None));
        page.panel = Panel::Tasks;

        let outcome = page.handle_enter().unwrap();

        match outcome {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.session_id, None);
                assert_eq!(launch.agent, "debug");
                let message = launch.initial_message.as_deref().unwrap();
                assert!(message.contains("Task detail"));
                assert!(message.contains(
                    "sparo tasks --workspace D:\\workspace\\project show \"Review TUI task flow\""
                ));
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_empty_panel_enter_does_not_launch_recent_session() {
        let mut page = StartupPage::new(sample_snapshot());
        page.panel = Panel::Tasks;

        assert!(page.handle_enter().is_none());
    }

    #[test]
    fn startup_stale_panel_selection_does_not_launch_recent_session() {
        let mut page = StartupPage::new(sample_snapshot());
        page.panel = Panel::Apps;
        page.selected = 99;

        assert!(page.handle_enter().is_none());
    }

    #[test]
    fn startup_workspace_selection_launches_workspace_context() {
        let mut page = StartupPage::new(sample_snapshot());
        page.panel = Panel::Workspaces;

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        match outcome.unwrap() {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.workspace.as_deref(), Some("D:\\workspace\\project"));
                assert_eq!(launch.session_id, None);
                assert!(launch
                    .initial_message
                    .as_deref()
                    .unwrap()
                    .contains("Workspace detail"));
                assert!(launch
                    .initial_message
                    .as_deref()
                    .unwrap()
                    .contains("sparo workspaces show project"));
                assert!(launch
                    .initial_message
                    .as_deref()
                    .unwrap()
                    .contains("sparo workspaces use project"));
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_workspace_filter_launches_matching_workspace_context() {
        let mut snapshot = sample_snapshot();
        snapshot.workspaces.push(AgenticOsWorkspaceRow {
            label: "design".to_string(),
            path: Some("D:\\workspace\\design".to_string()),
            git: Some("git feature/design".to_string()),
            session_count: 3,
        });
        let mut page = StartupPage::new(snapshot);
        page.panel = Panel::Workspaces;
        page.panel_filter = "design".to_string();

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        match outcome.unwrap() {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.workspace.as_deref(), Some("D:\\workspace\\design"));
                let message = launch.initial_message.as_deref().unwrap();
                assert!(message.contains("Workspace detail"));
                assert!(message.contains("Label: design"));
                assert!(message.contains("sparo workspaces show design"));
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_global_workspace_selection_resolves_runtime_workspace() {
        let mut snapshot = sample_snapshot();
        snapshot.workspaces[0].path = None;
        snapshot.workspaces[0].label = "global".to_string();
        let mut page = StartupPage::new(snapshot);
        page.panel = Panel::Workspaces;

        let outcome = page.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        match outcome.unwrap() {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.session_id, None);
                assert!(launch.workspace.is_some());
                assert_ne!(launch.workspace.as_deref(), Some(""));
                assert!(launch
                    .initial_message
                    .as_deref()
                    .unwrap()
                    .contains("Agentic OS global runtime"));
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_memory_selection_launches_memory_action_prompt() {
        let mut page = StartupPage::new(sample_snapshot());
        page.panel = Panel::Memory;

        let outcome = page.handle_enter().unwrap();

        match outcome {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.session_id, None);
                assert!(launch
                    .initial_message
                    .as_deref()
                    .unwrap()
                    .contains("Memory detail"));
                assert!(launch.initial_message.as_deref().unwrap().contains(
                    "sparo memory --workspace D:\\workspace\\project show global:memory.md"
                ));
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_settings_selection_launches_settings_action_prompt() {
        let mut page = StartupPage::new(sample_snapshot());
        page.panel = Panel::Settings;

        let outcome = page.handle_enter().unwrap();

        match outcome {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.session_id, None);
                assert!(launch
                    .initial_message
                    .as_deref()
                    .unwrap()
                    .contains("Model settings"));
                assert!(launch
                    .initial_message
                    .as_deref()
                    .unwrap()
                    .contains("sparo config show"));
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }
}
