/// Agentic OS Agentic OS home for the CLI.
use anyhow::Result;
use bitfun_core::command::agentic_os::{AgenticOsSnapshot, AgenticOsSnapshotRequest};
use crossterm::event::{
    self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEvent,
    MouseEventKind,
};
use ratatui::{
    backend::Backend,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, List, ListItem, Paragraph},
    Frame, Terminal,
};
use std::time::{Duration, Instant};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use crate::config::DEFAULT_CLI_AGENT;
use crate::modes::chat::{
    effective_workspace_selection, memory_preview_followup_prompt, panel_analysis_followup_prompt,
    preview_text_file, task_without_session_followup_prompt, workspace_selection_followup_prompt,
};

use super::commands::{
    agents_registry_message, command_for_slash, typed_command_action, CommandAction, CommandScope,
    PanelKind,
};
use super::panels::{
    command_count, jump_selection, move_selection, panel_count, render_command_palette,
    render_overlay, render_snapshot_panel, selected_command, selected_memory_file,
    selected_panel_data_index as overlay_selected_panel_data_index, selected_panel_detail,
    OverlayKind, OverlayState, SelectionJump,
};
use super::string_utils::truncate_str;
use super::theme::{StyleKind, Theme};

const RECENT_SESSION_COMFORTABLE_HEIGHT: u16 = 12;

/// Duration of the wordmark "focus pull" intro before it settles.
const WORDMARK_BOOT_MS: f32 = 680.0;
const WORDMARK_ROWS: [&str; 5] = [
    " ▟███▙  ███▙    ▟██▙  ███▙    ▟██▙    ▟███▙  ▟███▙ ",
    " █▛▀▀   █  █▙    ▄█▛  █  █▙  █▛  █    █▛ ▜█  █▛▀▀  ",
    " ▜███▙  ███▛   ▟███▙  ███▛   █   █    █   █  ▜███▙ ",
    "   ▀▜█  █      █  █   █ ▜▙   █▙ ▟█    █▙ ▟█    ▀▜█ ",
    " ▜███▛  █      ▜██▛   █  ▜▙   ▜██▛    ▜███▛  ▜███▛ ",
];
const WORDMARK_OS_COLUMN: usize = 38;
const WORDMARK_DOT_ROW: usize = 2;
const WORDMARK_DOT_GAP: &str = "  ";
const WORDMARK_SUBTITLE: &str = "a g e n t i c   o p e r a t i n g   s y s t e m";

#[derive(Debug, Clone)]
pub struct StartupLaunch {
    pub workspace: Option<String>,
    pub session_id: Option<String>,
    pub agent: String,
    pub initial_message: Option<String>,
    pub context_messages: Vec<String>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HomeHintTarget {
    Enter,
    Commands,
    Sessions,
}

pub struct StartupPage {
    snapshot: AgenticOsSnapshot,
    theme: Theme,
    default_agent: String,
    panel: Panel,
    selected: usize,
    input: String,
    input_cursor: usize,
    command_filter: String,
    panel_filter: String,
    home_recent_area_height: u16,
    home_recent_x_range: (u16, u16),
    home_recent_targets: Vec<(u16, usize)>,
    home_enter_hint_target: Option<(u16, u16, u16)>,
    home_command_hint_target: Option<(u16, u16, u16)>,
    home_sessions_hint_target: Option<(u16, u16, u16)>,
    home_hover_hint: Option<HomeHintTarget>,
    started_at: Instant,
}

impl StartupPage {
    pub async fn load_snapshot(workspace_hint: Option<String>) -> AgenticOsSnapshot {
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
                return AgenticOsSnapshot::default();
            }
        };

        bitfun_core::command::agentic_os::get_snapshot(
            &runtime.command_context(),
            AgenticOsSnapshotRequest { workspace_hint },
        )
        .await
        .unwrap_or_else(|error| {
            tracing::warn!("Failed to load Agentic OS snapshot: {}", error);
            AgenticOsSnapshot::default()
        })
    }

    pub fn new(snapshot: AgenticOsSnapshot) -> Self {
        Self {
            snapshot,
            theme: Theme::dark(),
            default_agent: DEFAULT_CLI_AGENT.to_string(),
            panel: Panel::Home,
            selected: 0,
            input: String::new(),
            input_cursor: 0,
            command_filter: String::new(),
            panel_filter: String::new(),
            home_recent_area_height: RECENT_SESSION_COMFORTABLE_HEIGHT,
            home_recent_x_range: (0, 0),
            home_recent_targets: Vec::new(),
            home_enter_hint_target: None,
            home_command_hint_target: None,
            home_sessions_hint_target: None,
            home_hover_hint: None,
            started_at: Instant::now(),
        }
    }

    pub fn set_theme(&mut self, theme: Theme) {
        self.theme = theme;
    }

    pub fn set_default_agent(&mut self, default_agent: String) {
        if !default_agent.trim().is_empty() {
            self.default_agent = default_agent;
        }
    }

    pub fn focus_recent_session(&mut self, session_id: &str) {
        let Some(index) = self
            .snapshot
            .sessions
            .iter()
            .position(|session| session.id == session_id)
        else {
            return;
        };

        self.panel_filter.clear();
        self.command_filter.clear();
        self.clear_input();

        let visible = recent_session_visible_count(
            self.snapshot.sessions.len(),
            self.home_recent_area_height,
        );
        if index < visible {
            self.panel = Panel::Home;
            self.selected = index + 1;
        } else {
            self.panel = Panel::Sessions;
            self.selected = index;
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
                    Event::Mouse(mouse) => {
                        if let Some(outcome) = self.handle_mouse(mouse) {
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
        // The home is an open terminal-native composition: a quiet centered
        // column for the brand, composer, recent work, and real environment
        // context. The frame comes from the terminal window itself, not from a
        // nested TUI panel.
        let content_area = if area.height >= 24 {
            self.render_title_bar(frame, area);
            Rect {
                x: area.x,
                y: area.y + 2,
                width: area.width,
                height: area.height.saturating_sub(2),
            }
        } else {
            area
        };
        let shell = home_shell(content_area);

        let content = inset_rect(shell, 0, 0);
        let compact = content.height < 22 || content.width as usize <= wordmark_width() + 8;
        let gap: u16 = 1;
        let hero_height: u16 = if compact {
            2
        } else {
            WORDMARK_ROWS.len() as u16 + 1
        };
        let composer_height: u16 = if compact { 3 } else { 7 };
        let env_height: u16 = if compact { 1 } else { 2 };

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(gap),             // top breathing room
                Constraint::Length(hero_height),     // hero: wordmark + subtitle
                Constraint::Length(gap),             // spacer
                Constraint::Length(composer_height), // composer control
                Constraint::Length(gap),             // spacer
                Constraint::Min(6),                  // recent timeline
                Constraint::Length(env_height),      // environment line
            ])
            .split(content);

        self.render_hero(frame, chunks[1], compact);
        self.render_composer(frame, chunks[3], compact);
        self.render_timeline(frame, chunks[5]);
        self.render_env(frame, chunks[6], compact);
    }

    fn render_title_bar(&self, frame: &mut Frame, area: Rect) {
        let width = area.width as usize;
        let title_line = Line::from(vec![
            Span::styled("  ▣  console", self.theme.style(StyleKind::Muted)),
            Span::styled("   ●", self.theme.style(StyleKind::Primary)),
            Span::styled(" ready", self.theme.style(StyleKind::Faint)),
        ]);
        let rule = Line::from(Span::styled(
            "─".repeat(width),
            self.theme.style(StyleKind::Border),
        ));

        let title_area = Rect {
            x: area.x,
            y: area.y,
            width: area.width,
            height: 1,
        };
        let rule_area = Rect {
            x: area.x,
            y: area.y + 1,
            width: area.width,
            height: 1,
        };
        frame.render_widget(Paragraph::new(title_line), title_area);
        frame.render_widget(Paragraph::new(rule), rule_area);
    }

    fn render_hero(&self, frame: &mut Frame, area: Rect, compact: bool) {
        let elapsed = self.started_at.elapsed().as_millis() as f32;
        let lines = wordmark_lines(&self.theme, elapsed, compact);

        frame.render_widget(Paragraph::new(lines).alignment(Alignment::Center), area);
    }

    fn render_composer(&mut self, frame: &mut Frame, area: Rect, compact: bool) {
        self.home_enter_hint_target = None;
        self.home_command_hint_target = None;
        self.home_sessions_hint_target = None;
        if compact {
            self.render_compact_composer(frame, area);
            return;
        }

        let area_width = area.width as usize;
        let box_width = area_width.saturating_sub(2).min(76).max(20);
        let side_pad = area_width.saturating_sub(box_width) / 2;
        let inner_width = box_width.saturating_sub(2).max(8);
        let horizontal = "─".repeat(inner_width);
        let border_style = self.theme.style(StyleKind::Border);
        let corner_style = Style::default()
            .fg(self.theme.ignition)
            .add_modifier(Modifier::BOLD);
        let rail_style = self.theme.style(StyleKind::Faint);
        let action_style = self.theme.style(StyleKind::AccentTitle);
        let question_width = inner_width.saturating_sub(4);
        let prompt = compact_startup_text("What do you want to build?", question_width);
        let prompt_fill = question_width.saturating_sub(prompt.width());
        let hint_text = "[enter]  go  •  /cmd  •  sessions";
        let hint_pad = centered_text(hint_text, inner_width);
        let hint_spans = hint_spans(
            &self.theme,
            &hint_pad,
            self.home_hover_hint == Some(HomeHintTarget::Enter),
            self.home_hover_hint == Some(HomeHintTarget::Commands),
            self.home_hover_hint == Some(HomeHintTarget::Sessions),
        );
        let hint_x = area.x + side_pad as u16 + 1;
        let hint_y = area.y + 4;
        if let Some(start) = hint_pad.find("[enter]") {
            let start = hint_x + start as u16;
            self.home_enter_hint_target = Some((hint_y, start, start + "[enter]".len() as u16));
        }
        if let Some(start) = hint_pad.find("/cmd") {
            let start = hint_x + start as u16;
            self.home_command_hint_target = Some((hint_y, start, start + "/cmd".len() as u16));
        }
        if let Some(start) = hint_pad.find("sessions") {
            let start = hint_x + start as u16;
            self.home_sessions_hint_target = Some((hint_y, start, start + "sessions".len() as u16));
        }
        let input_width = question_width;
        let (visible_input, cursor_x) =
            startup_input_window(&self.input, self.input_cursor, input_width);
        let side_pad_span = || Span::raw(" ".repeat(side_pad));

        let input_fill = inner_width
            .saturating_sub(4)
            .saturating_sub(visible_input.width());

        let lines = vec![
            Line::from(vec![
                side_pad_span(),
                Span::styled("┌", corner_style),
                Span::styled(horizontal.clone(), rail_style),
                Span::styled("┐", corner_style),
            ]),
            Line::from(vec![
                side_pad_span(),
                Span::styled("│  ", border_style),
                Span::styled("❯ ", action_style),
                Span::styled(prompt, self.theme.style(StyleKind::Text)),
                Span::raw(" ".repeat(prompt_fill)),
                Span::styled("│", border_style),
            ]),
            Line::from(vec![
                side_pad_span(),
                Span::styled("│  ", border_style),
                Span::styled("█", action_style),
                Span::raw(" "),
                Span::styled(visible_input, self.theme.style(StyleKind::Text)),
                Span::raw(" ".repeat(input_fill)),
                Span::styled("│", border_style),
            ]),
            Line::from(vec![
                side_pad_span(),
                Span::styled("│  ", border_style),
                Span::styled("─".repeat(inner_width.saturating_sub(2)), rail_style),
                Span::styled("│", border_style),
            ]),
            Line::from(
                vec![side_pad_span(), Span::styled("│", border_style)]
                    .into_iter()
                    .chain(hint_spans)
                    .chain(std::iter::once(Span::styled("│", border_style)))
                    .collect::<Vec<_>>(),
            ),
            Line::from(vec![
                side_pad_span(),
                Span::styled("└", corner_style),
                Span::styled(horizontal, rail_style),
                Span::styled("┘", corner_style),
            ]),
        ];

        frame.render_widget(Paragraph::new(lines), area);
        if self.panel == Panel::Home {
            frame.set_cursor_position((area.x + side_pad as u16 + 5 + cursor_x, area.y + 2));
        }
    }

    fn render_compact_composer(&mut self, frame: &mut Frame, area: Rect) {
        let hints: &[(&str, &str)] = if area.width < 52 {
            &[("enter", "go"), ("/", "cmd")]
        } else {
            &[("enter", "go"), ("/", "cmd"), ("sessions", "open")]
        };

        let block = startup_composer_block(&self.theme, hints);
        let inner = block.inner(area);
        frame.render_widget(block, area);

        let input_width = inner.width.saturating_sub(2) as usize;
        let (visible_input, cursor_x) =
            startup_input_window(&self.input, self.input_cursor, input_width);

        let mut spans = vec![Span::styled("› ", self.theme.style(StyleKind::Primary))];
        if self.input.is_empty() {
            spans.push(Span::styled(
                compact_startup_text("What do you want to build?", input_width),
                self.theme.style(StyleKind::Muted),
            ));
        } else {
            spans.push(Span::styled(
                visible_input,
                self.theme.style(StyleKind::Text),
            ));
        }

        frame.render_widget(Paragraph::new(Line::from(spans)), inner);
        if self.panel == Panel::Home {
            frame.set_cursor_position((inner.x + 2 + cursor_x, inner.y));
        }
    }

    fn render_env(&self, frame: &mut Frame, area: Rect, compact: bool) {
        let (model, workspace, branch) = startup_status_labels(
            &self.snapshot.model,
            self.snapshot.current_workspace.as_deref(),
            self.snapshot.git_branch.as_deref(),
            area.width,
        );

        let dot = || Span::styled("  ·  ", self.theme.style(StyleKind::Primary));
        let line = Line::from(vec![
            Span::styled(model, self.theme.style(StyleKind::Muted)),
            dot(),
            Span::styled(workspace, self.theme.style(StyleKind::Muted)),
            dot(),
            Span::styled(branch, self.theme.style(StyleKind::Faint)),
        ]);

        if compact {
            frame.render_widget(Paragraph::new(line).alignment(Alignment::Center), area);
            return;
        }

        let area = inset_rect(area, 1, 0);
        let rule = Line::from(Span::styled(
            "─".repeat(area.width as usize),
            self.theme.style(StyleKind::Border),
        ));
        frame.render_widget(
            Paragraph::new(vec![rule, line]).alignment(Alignment::Center),
            area,
        );
    }

    fn render_timeline(&mut self, frame: &mut Frame, area: Rect) {
        self.home_recent_area_height = area.height;
        self.home_recent_targets.clear();
        let pad = home_pad(area);
        let content_width = area.width.saturating_sub((pad * 2) as u16);
        self.home_recent_x_range = (
            area.x.saturating_add(pad as u16),
            area.x
                .saturating_add(pad as u16)
                .saturating_add(content_width),
        );

        let mut items = Vec::new();
        let rule_width = content_width as usize;
        let recent_rule = recent_header_text(rule_width);
        items.push(ListItem::new(Line::from(vec![
            Span::raw(" ".repeat(pad)),
            Span::styled(recent_rule, self.theme.style(StyleKind::Faint)),
        ])));

        if self.snapshot.sessions.is_empty() {
            items.push(ListItem::new(Line::from(vec![
                Span::raw(" ".repeat(pad)),
                Span::styled("No recent sessions yet", self.theme.style(StyleKind::Muted)),
            ])));
        } else {
            let shown_limit =
                recent_session_visible_count(self.snapshot.sessions.len(), area.height);
            let show_row_separators = area.height >= 8 && shown_limit > 1;
            for (index, session) in self.snapshot.sessions.iter().take(shown_limit).enumerate() {
                let kind = session_kind_label(session.is_dispatch_task);
                let selected = self.selected == index + 1 || (self.selected == 0 && index == 0);
                let highlight_style = Style::default()
                    .fg(self.theme.text)
                    .bg(self.theme.ignition)
                    .add_modifier(Modifier::BOLD);
                let item_style = if selected {
                    highlight_style
                } else {
                    Style::default()
                };
                let row_style = if selected {
                    Style::default()
                        .fg(self.theme.text)
                        .bg(self.theme.ignition)
                        .add_modifier(Modifier::BOLD)
                } else {
                    self.theme.style(StyleKind::Title)
                };
                let row_meta_style = if selected {
                    Style::default()
                        .fg(self.theme.text)
                        .bg(self.theme.ignition)
                        .add_modifier(Modifier::BOLD)
                } else {
                    self.theme.style(StyleKind::Muted)
                };
                let row_index_style = if selected {
                    Style::default()
                        .fg(self.theme.text)
                        .bg(self.theme.ignition)
                        .add_modifier(Modifier::BOLD)
                } else {
                    self.theme.style(StyleKind::Faint)
                };
                let row_kind_style = if selected {
                    row_style
                } else if session.is_dispatch_task {
                    self.theme.style(StyleKind::Warning)
                } else {
                    self.theme.style(StyleKind::Primary)
                };
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
                let row_width = content_width as usize;
                let fixed_width = 2 + 6 + 9 + 5 + meta.width();
                let title_width = row_width.saturating_sub(fixed_width).max(12);
                let title = compact_startup_text(&session.title, title_width);
                let title_fill = title_width.saturating_sub(title.width());
                let index_label = format!("{:02}", index + 1);
                let row_y = area.y + items.len() as u16;
                self.home_recent_targets.push((row_y, index + 1));
                items.push(
                    ListItem::new(Line::from(vec![
                        Span::raw(" ".repeat(pad)),
                        Span::styled(
                            if selected { "▶ " } else { "  " },
                            if selected {
                                highlight_style
                            } else {
                                self.theme.style(StyleKind::Primary)
                            },
                        ),
                        Span::styled("▕", row_index_style),
                        Span::styled(index_label, row_index_style),
                        Span::styled("▏  ", row_index_style),
                        Span::styled(format!("{:<9}", kind), row_kind_style),
                        Span::styled(title, row_style),
                        Span::styled(" ".repeat(title_fill), row_style),
                        Span::styled("  •  ", self.theme.style(StyleKind::Primary)),
                        Span::styled(meta, row_meta_style),
                    ]))
                    .style(item_style),
                );
                if show_row_separators && index + 1 < shown_limit {
                    items.push(ListItem::new(Line::from(vec![
                        Span::raw(" ".repeat(pad + 2)),
                        Span::styled(
                            "┄".repeat(content_width.saturating_sub(2) as usize),
                            self.theme.style(StyleKind::Faint),
                        ),
                    ])));
                }
            }
            let hidden_count =
                recent_session_hidden_count(self.snapshot.sessions.len(), area.height);
            if hidden_count > 0 && items.len() < area.height as usize {
                let more_index = shown_limit + 1;
                let selected = self.selected == more_index;
                let highlight_style = Style::default()
                    .fg(self.theme.text)
                    .bg(self.theme.ignition)
                    .add_modifier(Modifier::BOLD);
                let item_style = if selected {
                    highlight_style
                } else {
                    Style::default()
                };
                let more_style = if selected {
                    Style::default()
                        .fg(self.theme.text)
                        .bg(self.theme.ignition)
                        .add_modifier(Modifier::BOLD)
                } else {
                    self.theme.style(StyleKind::Faint)
                };
                let row_y = area.y + items.len() as u16;
                self.home_recent_targets.push((row_y, more_index));
                items.push(
                    ListItem::new(Line::from(vec![
                        Span::raw(" ".repeat(pad)),
                        Span::styled(
                            if selected { "▶ " } else { "  " },
                            if selected {
                                highlight_style
                            } else {
                                self.theme.style(StyleKind::Primary)
                            },
                        ),
                        Span::styled(
                            format!("     more sessions  + {}", hidden_count),
                            more_style,
                        ),
                    ]))
                    .style(item_style),
                );
            }
        }

        frame.render_widget(List::new(items), area);
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

    fn handle_mouse(&mut self, mouse: MouseEvent) -> Option<StartupOutcome> {
        if self.panel != Panel::Home {
            return None;
        }

        self.home_hover_hint = if mouse_hits_target(mouse, self.home_enter_hint_target) {
            Some(HomeHintTarget::Enter)
        } else if mouse_hits_target(mouse, self.home_command_hint_target) {
            Some(HomeHintTarget::Commands)
        } else if mouse_hits_target(mouse, self.home_sessions_hint_target) {
            Some(HomeHintTarget::Sessions)
        } else {
            None
        };

        if matches!(mouse.kind, MouseEventKind::Down(MouseButton::Left)) {
            if mouse_hits_target(mouse, self.home_enter_hint_target) {
                return self.handle_enter();
            }
            if mouse_hits_target(mouse, self.home_command_hint_target) {
                self.panel = Panel::Command;
                self.command_filter.clear();
                self.selected = 0;
                return None;
            }
            if mouse_hits_target(mouse, self.home_sessions_hint_target) {
                self.panel = Panel::Sessions;
                self.panel_filter.clear();
                self.selected = 0;
                return None;
            }
        }

        let (start_x, end_x) = self.home_recent_x_range;
        if mouse.column < start_x || mouse.column >= end_x {
            return None;
        }

        let Some((_, selected)) = self
            .home_recent_targets
            .iter()
            .find(|(row, _)| *row == mouse.row)
            .copied()
        else {
            return None;
        };

        self.selected = selected;
        match mouse.kind {
            MouseEventKind::Moved | MouseEventKind::Drag(_) => None,
            MouseEventKind::Down(MouseButton::Left) => self.handle_enter(),
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
                    agent: self.default_agent.clone(),
                    initial_message: None,
                    context_messages: Vec::new(),
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
                agent: self.default_agent.clone(),
                initial_message: Some(live_agents_reference_message()),
                context_messages: Vec::new(),
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
                        agent: self.default_agent.clone(),
                        initial_message: Some(format!(
                            "Delegate this work to the right specialized Agent: {}",
                            args
                        )),
                        context_messages: Vec::new(),
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
                agent: self.default_agent.clone(),
                initial_message: Some(typed.to_string()),
                context_messages: Vec::new(),
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
                        context_messages: Vec::new(),
                    };
                }
            }
            Panel::Tasks => {
                if let Some(task) = self
                    .selected_panel_data_index(PanelKind::Tasks)
                    .and_then(|index| self.snapshot.tasks.get(index))
                {
                    let has_session = task.session_id.is_some();
                    return StartupLaunch {
                        workspace: task
                            .workspace
                            .clone()
                            .or_else(|| self.snapshot.current_workspace.clone()),
                        session_id: task.session_id.clone(),
                        agent: task.agent.clone(),
                        initial_message: if has_session {
                            None
                        } else {
                            Some(task_without_session_followup_prompt(
                                &task.title,
                                &task.agent,
                            ))
                        },
                        context_messages: self.panel_context_messages(PanelKind::Tasks),
                    };
                }
            }
            Panel::Apps => {
                if self.selected_panel_data_index(PanelKind::Apps).is_some() {
                    return StartupLaunch {
                        workspace: self.snapshot.current_workspace.clone(),
                        session_id: None,
                        agent: self.default_agent.clone(),
                        initial_message: panel_analysis_followup_prompt(PanelKind::Apps)
                            .map(str::to_string),
                        context_messages: self.panel_context_messages(PanelKind::Apps),
                    };
                }
            }
            Panel::Memory => {
                if self.selected_panel_data_index(PanelKind::Memory).is_some() {
                    let (context_messages, initial_message) = self.memory_launch_context();
                    return StartupLaunch {
                        workspace: self.snapshot.current_workspace.clone(),
                        session_id: None,
                        agent: self.default_agent.clone(),
                        initial_message,
                        context_messages,
                    };
                }
            }
            Panel::Workspaces => {
                if let Some(row) = self
                    .selected_panel_data_index(PanelKind::Workspaces)
                    .and_then(|index| self.snapshot.workspaces.get(index))
                {
                    let (_, session_workspace, workspace_label) =
                        effective_workspace_selection(row.path.clone());
                    return StartupLaunch {
                        workspace: session_workspace,
                        session_id: None,
                        agent: self.default_agent.clone(),
                        initial_message: Some(workspace_selection_followup_prompt(
                            &workspace_label,
                        )),
                        context_messages: self.panel_context_messages(PanelKind::Workspaces),
                    };
                }
            }
            Panel::Settings => {
                if self
                    .selected_panel_data_index(PanelKind::Settings)
                    .is_some()
                {
                    return StartupLaunch {
                        workspace: self.snapshot.current_workspace.clone(),
                        session_id: None,
                        agent: self.default_agent.clone(),
                        initial_message: panel_analysis_followup_prompt(PanelKind::Settings)
                            .map(str::to_string),
                        context_messages: self.panel_context_messages(PanelKind::Settings),
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
                .unwrap_or_else(|| self.default_agent.clone()),
            initial_message: None,
            context_messages: Vec::new(),
        }
    }

    fn panel_overlay(&self, kind: PanelKind) -> OverlayState {
        let mut overlay = OverlayState::panel(kind, self.snapshot.clone());
        overlay.selected = self.selected;
        overlay.filter = self.panel_filter.clone();
        overlay
    }

    fn panel_context_messages(&self, kind: PanelKind) -> Vec<String> {
        selected_panel_detail(&self.panel_overlay(kind))
            .into_iter()
            .collect()
    }

    fn memory_launch_context(&self) -> (Vec<String>, Option<String>) {
        let overlay = self.panel_overlay(PanelKind::Memory);
        let mut context_messages = Vec::new();
        if let Some(detail) = selected_panel_detail(&overlay) {
            context_messages.push(detail);
        }

        let Some(memory_file) = selected_memory_file(&overlay) else {
            return (context_messages, None);
        };

        match preview_text_file(&memory_file, 80, 4000) {
            Ok(preview) => context_messages.push(format!(
                "Memory preview: {}\n\n{}",
                memory_file.display(),
                preview
            )),
            Err(error) => context_messages.push(format!(
                "Memory preview failed: {}\n\n{}",
                memory_file.display(),
                error
            )),
        }

        (
            context_messages,
            Some(memory_preview_followup_prompt(&memory_file)),
        )
    }

    fn selected_panel_data_index(&self, kind: PanelKind) -> Option<usize> {
        let mut overlay = OverlayState::panel(kind, self.snapshot.clone());
        overlay.selected = self.selected;
        overlay.filter = self.panel_filter.clone();
        overlay_selected_panel_data_index(&overlay)
    }
}

/// Left padding inside a centered home column so list rows align with the hero.
fn home_pad(area: Rect) -> usize {
    if area.width > 48 {
        1
    } else {
        0
    }
}

fn home_shell(area: Rect) -> Rect {
    if area.width < 72 || area.height < 18 {
        return area;
    }

    let width = area.width.min(78);
    let height = area.height.saturating_sub(2).min(28).max(18);
    Rect {
        x: area.x + area.width.saturating_sub(width) / 2,
        y: area.y + area.height.saturating_sub(height) / 2,
        width,
        height,
    }
}

fn inset_rect(area: Rect, horizontal: u16, vertical: u16) -> Rect {
    Rect {
        x: area.x.saturating_add(horizontal),
        y: area.y.saturating_add(vertical),
        width: area.width.saturating_sub(horizontal.saturating_mul(2)),
        height: area.height.saturating_sub(vertical.saturating_mul(2)),
    }
}

fn wordmark_width() -> usize {
    WORDMARK_ROWS
        .iter()
        .map(|row| row.width())
        .max()
        .unwrap_or(0)
        + WORDMARK_DOT_GAP.width()
        + 1
}

fn centered_text(value: &str, width: usize) -> String {
    let value = compact_startup_text(value, width);
    let remaining = width.saturating_sub(value.width());
    let left = remaining / 2;
    let right = remaining.saturating_sub(left);
    format!("{}{}{}", " ".repeat(left), value, " ".repeat(right))
}

fn hint_spans(
    theme: &Theme,
    hint: &str,
    enter_hovered: bool,
    commands_hovered: bool,
    sessions_hovered: bool,
) -> Vec<Span<'static>> {
    let enter = "[enter]";
    let command = "/cmd";
    let sessions = "sessions";
    let enter_start = hint.find(enter);
    let command_start = hint.find(command);
    let sessions_start = hint.find(sessions);
    let Some(enter_start) = enter_start else {
        return vec![Span::styled(
            hint.to_string(),
            theme.style(StyleKind::Muted),
        )];
    };
    let Some(command_start) = command_start else {
        return vec![Span::styled(
            hint.to_string(),
            theme.style(StyleKind::Muted),
        )];
    };
    let Some(sessions_start) = sessions_start else {
        return vec![Span::styled(
            hint.to_string(),
            theme.style(StyleKind::Muted),
        )];
    };

    let hover_style = Style::default()
        .fg(theme.text)
        .bg(theme.ignition)
        .add_modifier(Modifier::BOLD);
    let keycap_style = if enter_hovered {
        hover_style
    } else {
        Style::default()
            .fg(theme.ignition)
            .add_modifier(Modifier::BOLD)
    };
    let accent_style = Style::default()
        .fg(theme.ignition)
        .add_modifier(Modifier::BOLD);
    let enter_end = enter_start + enter.len();
    let command_end = command_start + command.len();
    let sessions_end = sessions_start + sessions.len();
    let middle = &hint[enter_end..command_start];
    let command_gap = &hint[command_end..sessions_start];

    vec![
        Span::styled(
            hint[..enter_start].to_string(),
            theme.style(StyleKind::Muted),
        ),
        Span::styled("[".to_string(), keycap_style),
        Span::styled("enter".to_string(), keycap_style),
        Span::styled("]".to_string(), keycap_style),
        styled_hint_gap(theme, middle, accent_style),
        Span::styled(
            hint[command_start..command_end].to_string(),
            if commands_hovered {
                hover_style
            } else {
                theme.style(StyleKind::Muted)
            },
        ),
        styled_hint_gap(theme, command_gap, accent_style),
        Span::styled(
            hint[sessions_start..sessions_end].to_string(),
            if sessions_hovered {
                hover_style
            } else {
                theme.style(StyleKind::Muted)
            },
        ),
        Span::styled(
            hint[sessions_end..].to_string(),
            theme.style(StyleKind::Muted),
        ),
    ]
}

fn styled_hint_gap<'a>(theme: &Theme, value: &str, accent_style: Style) -> Span<'a> {
    if value.contains('•') {
        Span::styled(value.to_string(), accent_style)
    } else {
        Span::styled(value.to_string(), theme.style(StyleKind::Muted))
    }
}

fn mouse_hits_target(mouse: MouseEvent, target: Option<(u16, u16, u16)>) -> bool {
    target
        .map(|(row, start, end)| mouse.row == row && mouse.column >= start && mouse.column < end)
        .unwrap_or(false)
}

fn recent_header_text(width: usize) -> String {
    if width < 18 {
        return "recent".to_string();
    }

    let label = " recent ";
    let left = 3usize.min(width.saturating_sub(label.len()));
    let right = width.saturating_sub(label.len() + left);
    format!("{}{}{}", "─".repeat(left), label, "─".repeat(right))
}

/// A precise home composer. Chat mode keeps the shared rounded composer; the
/// startup home uses a plain border to make the first screen feel more like a
/// calibrated command console.
fn startup_composer_block(theme: &Theme, hints: &[(&'static str, &'static str)]) -> Block<'static> {
    let mut spans = vec![Span::raw(" ")];
    for (index, (key, label)) in hints.iter().enumerate() {
        if index > 0 {
            spans.push(Span::styled("  |  ", theme.style(StyleKind::Faint)));
        }
        spans.push(Span::styled(*key, theme.style(StyleKind::Muted)));
        spans.push(Span::styled(
            format!(" {}", label),
            theme.style(StyleKind::Faint),
        ));
    }
    spans.push(Span::raw(" "));

    Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Plain)
        .border_style(theme.style(StyleKind::Border))
        .title_bottom(Line::from(spans).alignment(Alignment::Center))
}

fn live_agents_reference_message() -> String {
    let registry = bitfun_core::agentic::agents::get_agent_registry();
    let agents = if let Ok(handle) = tokio::runtime::Handle::try_current() {
        tokio::task::block_in_place(|| handle.block_on(registry.list_agents_info()))
    } else {
        match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime.block_on(registry.list_agents_info()),
            Err(error) => {
                return format!(
                    "Available Agents:\nFailed to inspect the live agent registry: {}\n\nUse:\n- sparo agents list to inspect the live agent registry",
                    error
                );
            }
        }
    };

    agents_registry_message(&agents)
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

/// Linearly interpolate between two RGB colors. Used to animate the brand
/// wordmark without leaving the project palette.
fn lerp_color(from: Color, to: Color, t: f32) -> Color {
    let to_rgb = |color: Color| match color {
        Color::Rgb(r, g, b) => (r, g, b),
        _ => (0, 0, 0),
    };
    let (fr, fg, fb) = to_rgb(from);
    let (tr, tg, tb) = to_rgb(to);
    let t = t.clamp(0.0, 1.0);
    let mix = |a: u8, b: u8| (a as f32 + (b as f32 - a as f32) * t).round() as u8;
    Color::Rgb(mix(fr, tr), mix(fg, tg), mix(fb, tb))
}

/// Build the animated `Sparo OS` wordmark.
///
/// The roomy form uses a custom segmented terminal wordmark so the brand reads
/// as a designed CLI surface rather than a generic FIGlet banner.
fn wordmark_lines(theme: &Theme, elapsed: f32, compact: bool) -> Vec<Line<'static>> {
    let booting = elapsed < WORDMARK_BOOT_MS;
    let progress = (elapsed / WORDMARK_BOOT_MS).clamp(0.0, 1.0);
    let eased = 1.0 - (1.0 - progress) * (1.0 - progress);

    let letter_color = if booting {
        lerp_color(theme.faint, theme.text, eased)
    } else {
        theme.text
    };
    let letter_style = Style::default()
        .fg(letter_color)
        .add_modifier(Modifier::BOLD);
    let os_color = lerp_color(theme.faint, theme.ignition, eased);
    let os_style = Style::default().fg(os_color);
    let os_dot_style = Style::default().fg(os_color).add_modifier(Modifier::BOLD);
    if !compact {
        let mut lines = WORDMARK_ROWS
            .iter()
            .enumerate()
            .map(|(row_index, row)| {
                let mut spans = row
                    .chars()
                    .enumerate()
                    .map(|(column, ch)| {
                        let style = if column >= WORDMARK_OS_COLUMN && ch != ' ' {
                            os_style
                        } else {
                            letter_style
                        };
                        Span::styled(ch.to_string(), style)
                    })
                    .collect::<Vec<_>>();
                spans.push(Span::raw(WORDMARK_DOT_GAP));
                spans.push(if row_index == WORDMARK_DOT_ROW {
                    Span::styled("●".to_string(), os_dot_style)
                } else {
                    Span::raw(" ")
                });
                Line::from(spans)
            })
            .collect::<Vec<_>>();
        lines.push(Line::from(Span::styled(
            WORDMARK_SUBTITLE,
            theme.style(StyleKind::Faint),
        )));
        return lines;
    }

    vec![
        Line::from(vec![
            Span::styled(
                "Sparo ",
                theme.style(StyleKind::Title).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                "OS",
                Style::default()
                    .fg(theme.ignition)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(Span::styled(
            WORDMARK_SUBTITLE,
            theme.style(StyleKind::Faint),
        )),
        Line::from(""),
    ]
}

fn refresh_key(key: KeyEvent) -> bool {
    matches!(key.code, KeyCode::Char('R'))
        || matches!(
            (key.code, key.modifiers),
            (KeyCode::Char('r'), KeyModifiers::SHIFT)
        )
}

fn session_kind_label(is_dispatch_task: bool) -> &'static str {
    if is_dispatch_task {
        "task"
    } else {
        "session"
    }
}

fn recent_session_limit(_area_height: u16) -> usize {
    3
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

    fn selection_count(self, snapshot: &AgenticOsSnapshot) -> usize {
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

fn short_path(path: impl AsRef<str>) -> String {
    let value = path.as_ref().replace('\\', "/");
    dirs::home_dir()
        .and_then(|home| {
            let home = home.to_string_lossy().replace('\\', "/");
            value.strip_prefix(&home).map(|rest| format!("~{}", rest))
        })
        .unwrap_or(value)
}

fn home_workspace_label(workspace: Option<&str>) -> String {
    let Some(workspace) = workspace else {
        return "global".to_string();
    };
    let short = short_path(workspace);
    if short == "~" || short == "/" {
        return short;
    }
    short
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or(short.as_str())
        .to_string()
}

fn home_branch_label(branch: Option<&str>) -> String {
    branch
        .unwrap_or("no-git")
        .strip_prefix("git ")
        .unwrap_or_else(|| branch.unwrap_or("no-git"))
        .to_string()
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
        compact_status_part(&home_workspace_label(workspace), workspace_limit),
        compact_status_part(&home_branch_label(git_branch), branch_limit),
    )
}

fn format_clock(timestamp_ms: u64) -> String {
    chrono::DateTime::<chrono::Local>::from(
        std::time::UNIX_EPOCH + std::time::Duration::from_millis(timestamp_ms),
    )
    .format("%H:%M")
    .to_string()
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
                agent: "OSAgent".to_string(),
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
                agent: "OSAgent".to_string(),
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
                    "A very long Agentic OS chapter title that should stay visually contained"
                        .to_string();
            }
            let mut page = StartupPage::new(snapshot);

            terminal.draw(|frame| page.render(frame)).unwrap();
        }
    }

    #[test]
    fn startup_home_uses_compact_brand_when_wordmark_would_overflow() {
        let backend = TestBackend::new(60, 24);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot());

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);

        assert!(!text.contains(WORDMARK_ROWS[0].trim_end()));
        assert!(text.contains("Sparo OS"));
        assert!(text.contains(WORDMARK_SUBTITLE));
        assert!(!text.contains("agentic operating system"));
    }

    #[test]
    fn startup_home_composer_hints_live_in_the_box_border() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot_with_sessions(8));

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);

        assert!(text.contains("┌"));
        assert!(text.contains("│"));
        assert!(text.contains("enter"));
        assert!(text.contains("cmd"));
        assert!(text.contains("sessions"));
    }

    #[test]
    fn startup_home_composer_enter_hint_reads_as_keycap() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot());

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);
        let keycap_y = text
            .lines()
            .position(|line| line.contains("[enter]"))
            .expect("enter keycap should render");
        let keycap_line = text.lines().nth(keycap_y).unwrap();
        let keycap_x = keycap_line.find("[enter]").unwrap();
        let buffer = terminal.backend().buffer();

        assert_eq!(
            buffer[(keycap_x as u16, keycap_y as u16)].style().fg,
            Some(page.theme.ignition)
        );
        assert!(matches!(
            buffer[(keycap_x as u16, keycap_y as u16)].style().bg,
            None | Some(Color::Reset)
        ));
        assert_eq!(
            buffer[((keycap_x + 1) as u16, keycap_y as u16)].style().fg,
            Some(page.theme.ignition)
        );
    }

    #[test]
    fn startup_home_composer_box_edges_stay_aligned() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot());

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);
        let lines = text.lines().collect::<Vec<_>>();
        let top = lines
            .iter()
            .position(|line| line.contains('┌') && line.contains('┐') && line.contains('─'))
            .expect("composer top border should render");
        let bottom = lines
            .iter()
            .position(|line| line.contains('└') && line.contains('┘') && line.contains('─'))
            .expect("composer bottom border should render");
        let left = lines[top].chars().position(|ch| ch == '┌').unwrap();
        let right = lines[top].chars().position(|ch| ch == '┐').unwrap();

        assert_eq!(lines[bottom].chars().position(|ch| ch == '└'), Some(left));
        assert_eq!(lines[bottom].chars().position(|ch| ch == '┘'), Some(right));
        for line in &lines[top + 1..bottom] {
            let chars = line.chars().collect::<Vec<_>>();
            assert_eq!(line.chars().position(|ch| ch == '│'), Some(left));
            assert_eq!(
                chars
                    .iter()
                    .enumerate()
                    .rev()
                    .find_map(|(index, ch)| if *ch == '│' { Some(index) } else { None }),
                Some(right)
            );
        }
    }

    #[test]
    fn startup_home_composer_uses_accent_corners_and_quiet_rails() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot());

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);
        let lines = text.lines().collect::<Vec<_>>();
        let top = lines
            .iter()
            .position(|line| line.contains('┌') && line.contains('┐') && line.contains('─'))
            .expect("composer top border should render");
        let left = lines[top].chars().position(|ch| ch == '┌').unwrap();
        let right = lines[top].chars().position(|ch| ch == '┐').unwrap();
        let buffer = terminal.backend().buffer();

        assert_eq!(
            buffer[(left as u16, top as u16)].style().fg,
            Some(page.theme.ignition)
        );
        assert_eq!(
            buffer[(right as u16, top as u16)].style().fg,
            Some(page.theme.ignition)
        );
        assert_eq!(
            buffer[((left + 1) as u16, top as u16)].style().fg,
            Some(page.theme.faint)
        );
        assert_eq!(
            buffer[(left as u16, (top + 1) as u16)].style().fg,
            Some(page.theme.border)
        );
        let chevron_y = text
            .lines()
            .position(|line| line.contains("❯ What do you want to build?"))
            .expect("composer prompt chevron should render");
        let chevron_line = text.lines().nth(chevron_y).unwrap();
        let chevron_x = chevron_line[..chevron_line.find('❯').unwrap()]
            .chars()
            .count();
        let chevron_style = buffer[(chevron_x as u16, chevron_y as u16)].style();
        assert_eq!(chevron_style.fg, Some(page.theme.ignition));
        assert!(chevron_style.add_modifier.contains(Modifier::BOLD));
        let cursor_y = text
            .lines()
            .position(|line| line.contains("│  █"))
            .expect("composer input cursor should render");
        let cursor_line = text.lines().nth(cursor_y).unwrap();
        let cursor_x = cursor_line[..cursor_line.find("│  █").unwrap() + "│  ".len()]
            .chars()
            .count();
        let cursor_style = buffer[(cursor_x as u16, cursor_y as u16)].style();
        assert_eq!(cursor_style.fg, Some(page.theme.ignition));
        assert!(cursor_style.add_modifier.contains(Modifier::BOLD));
    }

    #[test]
    fn startup_home_uses_one_reference_grid_for_main_surfaces() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot_with_sessions(8));

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);
        let lines = text.lines().collect::<Vec<_>>();
        let first_visible = |line: &str| line.chars().position(|ch| ch != ' ');
        let last_visible = |line: &str| {
            let mut last = None;
            for (index, ch) in line.chars().enumerate() {
                if ch != ' ' {
                    last = Some(index);
                }
            }
            last
        };

        let composer_line = lines
            .iter()
            .find(|line| {
                line.contains('\u{250c}') && line.contains('\u{2510}') && line.contains('\u{2500}')
            })
            .expect("composer top border should render");
        let recent_line = lines
            .iter()
            .find(|line| line.contains("recent"))
            .expect("recent rule should render");
        let footer_rule = lines
            .iter()
            .rev()
            .find(|line| {
                let trimmed = line.trim();
                !trimmed.is_empty() && trimmed.chars().all(|ch| ch == '\u{2500}')
            })
            .expect("footer rule should render");

        assert_eq!(first_visible(recent_line), first_visible(composer_line));
        assert_eq!(first_visible(footer_rule), first_visible(composer_line));
        assert_eq!(last_visible(recent_line), last_visible(composer_line));
        assert_eq!(last_visible(footer_rule), last_visible(composer_line));
    }

    #[test]
    fn startup_home_does_not_draw_an_outer_panel_frame() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot());

        terminal.draw(|frame| page.render(frame)).unwrap();
        let content_area = Rect {
            x: 0,
            y: 2,
            width: 100,
            height: 28,
        };
        let shell = home_shell(content_area);
        let buffer = terminal.backend().buffer();

        assert_eq!(buffer[(shell.x, shell.y)].symbol(), " ");
        assert_ne!(buffer[(shell.x, shell.y)].symbol(), "\u{250c}");
    }

    #[test]
    fn startup_home_renders_reference_title_bar() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot());

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);

        assert!(text.contains("▣  console"));
        assert!(text.contains("ready"));
        assert!(!text.contains("▣  Sparo OS"));
        assert!(!text.contains("□"));
        assert!(!text.contains("×"));
    }

    #[test]
    fn startup_home_uses_sparo_os_weighted_brand_wordmark_on_roomy_terminals() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot());
        page.started_at = Instant::now() - Duration::from_millis(WORDMARK_BOOT_MS as u64 + 1);

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);
        let wordmark_y = text
            .lines()
            .position(|line| line.contains(WORDMARK_ROWS[0]))
            .expect("wordmark should render");
        let wordmark_line = text.lines().nth(wordmark_y).unwrap();
        let wordmark_start_byte = wordmark_line
            .find(WORDMARK_ROWS[0].trim_end())
            .expect("wordmark should have a visible start");
        let wordmark_x = wordmark_line[..wordmark_start_byte].chars().count();
        let buffer = terminal.backend().buffer();

        assert!(text.contains(WORDMARK_ROWS[0].trim_end()));
        assert!(text.contains(WORDMARK_ROWS[WORDMARK_ROWS.len() - 1].trim_end()));
        assert_eq!(text.matches("Sparo OS").count(), 0);
        assert!(text.contains(WORDMARK_SUBTITLE));
        assert!(!text.contains("agentic operating system"));
        let dot_y = wordmark_y + WORDMARK_DOT_ROW;
        let dot_line = text.lines().nth(dot_y).expect("wordmark dot row");
        let dot_start_byte = dot_line
            .find('●')
            .expect("roomy wordmark should include the reference accent dot");
        let dot_x = dot_line[..dot_start_byte].chars().count();
        assert_eq!(
            buffer[(dot_x as u16, dot_y as u16)].style().fg,
            Some(page.theme.ignition)
        );
        assert!(buffer[(dot_x as u16, dot_y as u16)]
            .style()
            .add_modifier
            .contains(Modifier::BOLD));
        assert_eq!(
            buffer[(wordmark_x as u16, wordmark_y as u16)].style().fg,
            Some(page.theme.text)
        );
        for (row_index, row) in WORDMARK_ROWS.iter().enumerate() {
            for (column, ch) in row.chars().enumerate().skip(WORDMARK_OS_COLUMN) {
                if ch == ' ' {
                    continue;
                }
                assert_eq!(
                    buffer[(
                        (wordmark_x + column) as u16,
                        (wordmark_y + row_index) as u16
                    )]
                        .style()
                        .fg,
                    Some(page.theme.ignition),
                    "OS glyph column {column} on row {row_index} should use the brand accent"
                );
                assert!(
                    !buffer[(
                        (wordmark_x + column) as u16,
                        (wordmark_y + row_index) as u16
                    )]
                    .style()
                    .add_modifier
                    .contains(Modifier::BOLD),
                    "OS glyph column {column} on row {row_index} should stay lighter than the accent dot"
                );
            }
        }
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
        assert!(text.contains("recent"));
        assert!(text.contains("01"));
        assert!(text.contains("02"));
        assert!(text.contains("❯"));
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
        assert_eq!(workspace, "going");
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
        assert_eq!(wide.1, "project");
        assert_eq!(wide.2, "main");
    }

    #[test]
    fn startup_home_status_uses_brand_separator_dots() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot());

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);
        let status_y = text
            .lines()
            .position(|line| line.contains("test-model") && line.contains("project"))
            .expect("status line should render");
        let status_line = text.lines().nth(status_y).unwrap();
        let dot_x = status_line
            .chars()
            .position(|ch| ch == '·')
            .expect("status line should include a separator dot");
        let buffer = terminal.backend().buffer();

        assert_eq!(
            buffer[(dot_x as u16, status_y as u16)].style().fg,
            Some(page.theme.ignition)
        );
    }

    #[test]
    fn startup_session_titles_stay_compact() {
        let title = compact_startup_text(
            "This is a very long Agentic OS chapter title that should not dominate the home page",
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
    fn startup_home_cursor_stays_in_composer_input_row() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot());
        page.input = "abc".to_string();
        page.move_input_cursor_to_end();

        terminal.draw(|frame| page.render(frame)).unwrap();

        let text = terminal_text(&terminal);
        let input_row = text
            .lines()
            .position(|line| line.contains("█ abc"))
            .expect("home composer input row should render typed input");
        let cursor = terminal.get_cursor_position().unwrap();
        let cursor_line = text.lines().nth(cursor.y as usize).unwrap_or("");

        assert_eq!(cursor.y as usize, input_row);
        assert!(!cursor_line.contains("Sparo OS"));
    }

    #[test]
    fn startup_recent_sessions_stay_curated() {
        assert_eq!(recent_session_visible_count(8, 12), 3);
        assert_eq!(recent_session_hidden_count(8, 12), 5);
        assert_eq!(recent_session_visible_count(8, 6), 3);
        assert_eq!(recent_session_hidden_count(8, 6), 5);
        assert_eq!(recent_session_visible_count(2, 12), 2);
        assert_eq!(recent_session_hidden_count(2, 12), 0);
        assert_eq!(home_recent_selectable_rows(8, 12), 4);
        assert_eq!(home_recent_selectable_rows(8, 6), 4);
        assert_eq!(home_recent_selectable_rows(2, 12), 2);
    }

    #[test]
    fn startup_focus_recent_session_selects_visible_current_session() {
        let mut page = StartupPage::new(sample_snapshot_with_sessions(4));

        page.focus_recent_session("session-1");

        assert_eq!(page.panel, Panel::Home);
        assert_eq!(page.selected, 2);
    }

    #[test]
    fn startup_focus_recent_session_opens_sessions_panel_when_current_session_is_hidden() {
        let mut page = StartupPage::new(sample_snapshot_with_sessions(8));

        page.focus_recent_session("session-5");

        assert_eq!(page.panel, Panel::Sessions);
        assert_eq!(page.selected, 5);
    }

    #[test]
    fn startup_home_recent_rows_stay_low_noise() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot_with_sessions(8));

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);

        assert!(text.contains("01"));
        assert!(text.contains("02"));
        assert!(text.contains("03"));
        assert!(text.contains("more sessions  + 5"));
        assert!(text.contains("▕01▏  session  Session 0"));
        assert!(text.contains("•  0 turns"));
        assert!(!text.contains("│ 0 turns"));
        assert!(!text.contains("▕04▏"));
        assert!(!text.contains("05  session"));
        assert!(!text.contains("╌"));
        assert!(!text.contains("CORE READY"));
        assert!(!text.contains("DISPATCHER ONLINE"));
    }

    #[test]
    fn startup_home_selected_session_row_is_highlighted() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot_with_sessions(3));
        page.selected = 2;

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);
        let selected_y = text
            .lines()
            .position(|line| line.contains("Session 1"))
            .expect("selected session should render");
        let selected_line = text.lines().nth(selected_y).unwrap();
        let selected_byte = selected_line.find("Session 1").unwrap();
        let selected_x = selected_line[..selected_byte].chars().count();
        let unselected_y = text
            .lines()
            .position(|line| line.contains("Session 0"))
            .expect("unselected session should render");
        let unselected_line = text.lines().nth(unselected_y).unwrap();
        let unselected_byte = unselected_line.find("Session 0").unwrap();
        let unselected_x = unselected_line[..unselected_byte].chars().count();
        let buffer = terminal.backend().buffer();

        assert_eq!(
            buffer[(selected_x as u16, selected_y as u16)].style().bg,
            Some(page.theme.ignition)
        );
        assert_eq!(
            buffer[(page.home_recent_x_range.1 - 1, selected_y as u16)]
                .style()
                .bg,
            Some(page.theme.ignition)
        );
        assert_ne!(
            buffer[(unselected_x as u16, unselected_y as u16)]
                .style()
                .bg,
            Some(page.theme.ignition)
        );
    }

    #[test]
    fn startup_home_recent_rows_support_mouse_hover_and_click() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot_with_sessions(3));

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);
        let row = text
            .lines()
            .position(|line| line.contains("Session 1"))
            .expect("target session should render") as u16;
        let column = text
            .lines()
            .nth(row as usize)
            .and_then(|line| line.find("Session 1"))
            .expect("target session should have a clickable column") as u16;

        let hover = page.handle_mouse(MouseEvent {
            kind: MouseEventKind::Moved,
            column,
            row,
            modifiers: KeyModifiers::NONE,
        });
        assert!(hover.is_none());
        assert_eq!(page.selected, 2);

        let clicked = page.handle_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column,
            row,
            modifiers: KeyModifiers::NONE,
        });
        match clicked {
            Some(StartupOutcome::Launch(launch)) => {
                assert_eq!(launch.session_id.as_deref(), Some("session-1"));
            }
            other => panic!("expected mouse click to launch session, got {other:?}"),
        }
    }

    #[test]
    fn startup_home_more_row_supports_mouse_hover_and_click() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot_with_sessions(8));

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);
        let row = text
            .lines()
            .position(|line| line.contains("more sessions  + 5"))
            .expect("more row should render") as u16;
        let column = text
            .lines()
            .nth(row as usize)
            .and_then(|line| line.find("more sessions"))
            .expect("more row should have a clickable column") as u16;

        let hover = page.handle_mouse(MouseEvent {
            kind: MouseEventKind::Moved,
            column,
            row,
            modifiers: KeyModifiers::NONE,
        });
        assert!(hover.is_none());
        assert_eq!(page.selected, 4);

        let clicked = page.handle_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column,
            row,
            modifiers: KeyModifiers::NONE,
        });
        assert!(clicked.is_none());
        assert_eq!(page.panel, Panel::Sessions);
        assert_eq!(page.selected, 0);
    }

    #[test]
    fn startup_home_composer_hints_support_mouse_clicks() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot_with_sessions(3));

        terminal.draw(|frame| page.render(frame)).unwrap();
        let (row, enter_x, _) = page
            .home_enter_hint_target
            .expect("enter hint should expose a mouse target");
        let hover_enter = page.handle_mouse(MouseEvent {
            kind: MouseEventKind::Moved,
            column: enter_x,
            row,
            modifiers: KeyModifiers::NONE,
        });
        assert!(hover_enter.is_none());
        assert_eq!(page.home_hover_hint, Some(HomeHintTarget::Enter));
        terminal.draw(|frame| page.render(frame)).unwrap();
        assert_eq!(
            terminal.backend().buffer()[(enter_x, row)].style().bg,
            Some(page.theme.ignition)
        );

        let clicked_enter = page.handle_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: enter_x,
            row,
            modifiers: KeyModifiers::NONE,
        });
        match clicked_enter {
            Some(StartupOutcome::Launch(launch)) => {
                assert_eq!(launch.session_id.as_deref(), Some("session-0"));
            }
            other => panic!("expected enter hint click to launch selected session, got {other:?}"),
        }

        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot_with_sessions(3));

        terminal.draw(|frame| page.render(frame)).unwrap();
        let (row, command_x, _) = page
            .home_command_hint_target
            .expect("commands hint should expose a mouse target");
        let hover_command = page.handle_mouse(MouseEvent {
            kind: MouseEventKind::Moved,
            column: command_x,
            row,
            modifiers: KeyModifiers::NONE,
        });
        assert!(hover_command.is_none());
        assert_eq!(page.home_hover_hint, Some(HomeHintTarget::Commands));
        terminal.draw(|frame| page.render(frame)).unwrap();
        assert_eq!(
            terminal.backend().buffer()[(command_x, row)].style().bg,
            Some(page.theme.ignition)
        );

        let clicked_command = page.handle_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: command_x,
            row,
            modifiers: KeyModifiers::NONE,
        });
        assert!(clicked_command.is_none());
        assert_eq!(page.panel, Panel::Command);
        assert_eq!(page.selected, 0);

        page.panel = Panel::Home;
        terminal.draw(|frame| page.render(frame)).unwrap();
        let (row, sessions_x, _) = page
            .home_sessions_hint_target
            .expect("sessions hint should expose a mouse target");
        let clicked_sessions = page.handle_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: sessions_x,
            row,
            modifiers: KeyModifiers::NONE,
        });
        assert!(clicked_sessions.is_none());
        assert_eq!(page.panel, Panel::Sessions);
        assert_eq!(page.selected, 0);
    }

    #[test]
    fn startup_home_matches_reference_terminal_structure() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot_with_sessions(8));

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);

        assert!(text.contains(WORDMARK_ROWS[0].trim_end()));
        assert!(text.contains(WORDMARK_ROWS[WORDMARK_ROWS.len() - 1].trim_end()));
        assert_eq!(text.matches("Sparo OS").count(), 0);
        assert!(text.contains(WORDMARK_SUBTITLE));
        assert!(!text.contains("agentic operating system"));
        assert!(text.contains("┌"));
        assert!(text.contains("What do you want to build?"));
        assert!(text.contains("█"));
        assert!(text.contains("[enter]"));
        assert!(text.contains("go"));
        assert!(text.contains("/cmd"));
        assert!(text.contains("sessions"));
        assert!(!text.contains("/ commands"));
        assert!(!text.contains("/sessions recent"));
        assert!(text.contains("─── recent"));
        assert!(text.contains("▶ ▕01▏"));
        assert!(text.contains("▕02▏"));
        assert!(!text.contains("Sparo OS  ·"));
        assert!(text.contains("project"));
        assert!(text.contains("main"));
        assert!(!text.contains("D:/workspace/project"));
        assert!(!text.contains("git main"));
    }

    #[test]
    fn startup_home_composer_shows_typed_input() {
        let backend = TestBackend::new(70, 20);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut page = StartupPage::new(sample_snapshot_with_sessions(4));
        page.input = "Review the CLI product surface".to_string();
        page.move_input_cursor_to_end();

        terminal.draw(|frame| page.render(frame)).unwrap();
        let text = terminal_text(&terminal);

        assert!(text.contains("Review the CLI product surface"));
        // Composer hints live in the box border, not on a separate crowded row.
        assert!(text.contains("cmd"));
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

        assert_eq!(page.selected, 4);

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
        assert_eq!(page.selected, 4);

        page.handle_key(KeyEvent::new(KeyCode::Home, KeyModifiers::NONE));
        assert_eq!(page.selected, 1);

        page.handle_key(KeyEvent::new(KeyCode::PageDown, KeyModifiers::NONE));
        assert_eq!(page.selected, 4);

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
        page.set_default_agent("debug".to_string());
        page.input = "Summarize this workspace".to_string();

        let outcome = page.handle_enter().unwrap();

        match outcome {
            StartupOutcome::Launch(launch) => {
                assert_eq!(
                    launch.initial_message.as_deref(),
                    Some("Summarize this workspace")
                );
                assert_eq!(launch.agent, "debug");
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_uses_cli_default_agent_without_explicit_preference() {
        let mut page = StartupPage::new(sample_snapshot());
        page.input = "Summarize this workspace".to_string();

        let outcome = page.handle_enter().unwrap();

        match outcome {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.agent, DEFAULT_CLI_AGENT);
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_default_agent_preference_drives_home_commands() {
        let mut page = StartupPage::new(sample_snapshot());
        page.set_default_agent("agentic".to_string());

        for ch in "/new".chars() {
            page.handle_key(KeyEvent::from(KeyCode::Char(ch)));
        }
        let outcome = page.handle_key(KeyEvent::from(KeyCode::Enter));

        match outcome.expect("new command should launch") {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.agent, "agentic");
                assert!(launch.initial_message.is_none());
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }

        let mut page = StartupPage::new(sample_snapshot());
        page.set_default_agent("debug".to_string());
        for ch in "/dispatch review CLI".chars() {
            page.handle_key(KeyEvent::from(KeyCode::Char(ch)));
        }
        let outcome = page.handle_key(KeyEvent::from(KeyCode::Enter));

        match outcome.expect("dispatch command should launch") {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.agent, "debug");
                assert!(launch
                    .initial_message
                    .as_deref()
                    .is_some_and(|message| message.contains("review CLI")));
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
                assert_eq!(launch.agent, DEFAULT_CLI_AGENT);
                assert!(launch
                    .initial_message
                    .as_deref()
                    .unwrap()
                    .contains("Available Agents (live registry"));
                assert!(launch
                    .initial_message
                    .as_deref()
                    .unwrap()
                    .contains("sparo agents list"));
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
                assert_eq!(launch.agent, DEFAULT_CLI_AGENT);
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
                assert_eq!(launch.agent, "OSAgent");
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
                assert_eq!(launch.agent, "OSAgent");
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
    fn startup_apps_selection_loads_app_context_and_followup_prompt() {
        let mut page = StartupPage::new(sample_snapshot());
        page.panel = Panel::Apps;

        let outcome = page.handle_enter().unwrap();

        match outcome {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.session_id, None);
                let context = launch.context_messages.join("\n\n");
                assert!(context.contains("App detail"));
                assert!(context.contains("Name: Files"));
                let message = launch.initial_message.as_deref().unwrap();
                assert!(message.contains("Use the selected app context above"));
                assert!(!message.contains("sparo apps show"));
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_tasks_selection_with_session_resumes_task_context() {
        let mut page = StartupPage::new(sample_snapshot_with_task(Some("task-session")));
        page.panel = Panel::Tasks;

        let outcome = page.handle_enter().unwrap();

        match outcome {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.session_id.as_deref(), Some("task-session"));
                assert_eq!(launch.agent, "debug");
                assert_eq!(launch.workspace.as_deref(), Some("D:\\workspace\\project"));
                assert!(launch.initial_message.is_none());
                let context = launch.context_messages.join("\n\n");
                assert!(context.contains("Task detail"));
                assert!(context.contains("Session: task-session"));
                assert!(!context.contains("sparo tasks"));
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_tasks_selection_without_session_loads_task_context() {
        let mut page = StartupPage::new(sample_snapshot_with_task(None));
        page.panel = Panel::Tasks;

        let outcome = page.handle_enter().unwrap();

        match outcome {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.session_id, None);
                assert_eq!(launch.agent, "debug");
                let context = launch.context_messages.join("\n\n");
                assert!(context.contains("Task detail"));
                assert!(context.contains("Review TUI task flow"));
                let message = launch.initial_message.as_deref().unwrap();
                assert!(message.contains("Use the task detail above"));
                assert!(message.contains("Review TUI task flow"));
                assert!(!message.contains("sparo tasks"));
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
                let context = launch.context_messages.join("\n\n");
                assert!(context.contains("Workspace detail"));
                assert!(context.contains("Label: project"));
                let message = launch.initial_message.as_deref().unwrap();
                assert!(message.contains("Use the selected workspace context"));
                assert!(message.contains("D:\\workspace\\project"));
                assert!(!message.contains("sparo workspaces show"));
                assert!(!message.contains("sparo workspaces use"));
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
                let context = launch.context_messages.join("\n\n");
                assert!(context.contains("Workspace detail"));
                assert!(context.contains("Label: design"));
                let message = launch.initial_message.as_deref().unwrap();
                assert!(message.contains("Use the selected workspace context"));
                assert!(message.contains("D:\\workspace\\design"));
                assert!(!message.contains("sparo workspaces show"));
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
                    .context_messages
                    .join("\n\n")
                    .contains("Agentic OS global runtime"));
                assert!(launch
                    .initial_message
                    .as_deref()
                    .unwrap()
                    .contains("Use the selected workspace context"));
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_memory_selection_loads_context_and_followup_prompt() {
        let mut page = StartupPage::new(sample_snapshot());
        page.panel = Panel::Memory;

        let outcome = page.handle_enter().unwrap();

        match outcome {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.session_id, None);
                let context = launch.context_messages.join("\n\n");
                assert!(context.contains("Memory detail"));
                assert!(context.contains("D:\\memory\\memory.md"));
                let message = launch.initial_message.as_deref().unwrap();
                assert!(message.contains("Use the loaded memory preview above"));
                assert!(message.contains("D:\\memory\\memory.md"));
                assert!(!message.contains("sparo memory"));
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }

    #[test]
    fn startup_settings_selection_loads_settings_context_and_followup_prompt() {
        let mut page = StartupPage::new(sample_snapshot());
        page.panel = Panel::Settings;

        let outcome = page.handle_enter().unwrap();

        match outcome {
            StartupOutcome::Launch(launch) => {
                assert_eq!(launch.session_id, None);
                let context = launch.context_messages.join("\n\n");
                assert!(context.contains("Model settings"));
                assert!(context.contains("ai.default_models"));
                let message = launch.initial_message.as_deref().unwrap();
                assert!(message.contains("Use the selected settings context above"));
                assert!(!message.contains("sparo config show"));
            }
            StartupOutcome::Exit => panic!("expected launch"),
        }
    }
}
