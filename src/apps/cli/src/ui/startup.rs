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

use super::theme::{StyleKind, Theme};
use super::commands::{command_for_slash, CommandAction, CommandScope, PanelKind};
use super::panels::{
    command_count, move_selection, render_command_palette, render_snapshot_panel, selected_command,
    OverlayKind, OverlayState,
};

/// ANSI-shadow style banner for the home hero. Each line is centered at render time.
const BANNER: &[&str] = &[
    "███████╗██████╗  █████╗ ██████╗  ██████╗",
    "██╔════╝██╔══██╗██╔══██╗██╔══██╗██╔═══██╗",
    "███████╗██████╔╝███████║██████╔╝██║   ██║",
    "╚════██║██╔═══╝ ██╔══██║██╔══██╗██║   ██║",
    "███████║██║     ██║  ██║██║  ██║╚██████╔╝",
    "╚══════╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ",
];

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
    Tasks,
    Apps,
    Memory,
    Workspaces,
    Settings,
    Command,
}

pub struct StartupPage {
    snapshot: DispatcherSnapshot,
    theme: Theme,
    panel: Panel,
    selected: usize,
    input: String,
    command_filter: String,
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
                tracing::warn!("Failed to initialize process runtime for CLI snapshot: {}", error);
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
            command_filter: String::new(),
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
            Panel::Tasks => self.render_panel(frame, area, PanelKind::Tasks),
            Panel::Apps => self.render_panel(frame, area, PanelKind::Apps),
            Panel::Memory => self.render_panel(frame, area, PanelKind::Memory),
            Panel::Workspaces => self.render_panel(frame, area, PanelKind::Workspaces),
            Panel::Settings => self.render_panel(frame, area, PanelKind::Settings),
            Panel::Command => self.render_command(frame, area),
        }
    }

    fn render_panel(&mut self, frame: &mut Frame, area: Rect, kind: PanelKind) {
        let mut overlay = OverlayState::panel(kind, self.snapshot.clone());
        overlay.selected = self.selected;
        render_snapshot_panel(frame, area, &self.theme, &mut overlay, kind);
        self.selected = overlay.selected;
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

        let workspace = self
            .snapshot
            .current_workspace
            .as_deref()
            .map(short_path)
            .unwrap_or_else(|| "global".to_string());
        let branch = self.snapshot.git_branch.as_deref().unwrap_or("no-git");

        let status = Line::from(vec![
            Span::styled("● ", self.theme.style(StyleKind::Success)),
            Span::styled(self.snapshot.model.clone(), self.theme.style(StyleKind::Muted)),
            Span::styled("   ", self.theme.style(StyleKind::Faint)),
            Span::styled(workspace, self.theme.style(StyleKind::Muted)),
            Span::styled("   ", self.theme.style(StyleKind::Faint)),
            Span::styled(branch.to_string(), self.theme.style(StyleKind::Faint)),
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

        frame.render_widget(
            Paragraph::new(lines).alignment(Alignment::Center),
            area,
        );
    }

    fn render_continue(&self, frame: &mut Frame, area: Rect) {
        let line = match self.snapshot.sessions.first() {
            Some(session) => Line::from(vec![
                Span::styled("Continue  ", self.theme.style(StyleKind::AccentTitle)),
                Span::styled(session.title.clone(), self.theme.style(StyleKind::Title)),
                Span::styled(
                    format!(
                        "   {} turns · {}",
                        session.turns,
                        format_relative_time(session.last_active_at)
                    ),
                    self.theme.style(StyleKind::Muted),
                ),
            ]),
            None => Line::from(vec![Span::styled(
                "Start your first dispatcher chapter",
                self.theme.style(StyleKind::AccentTitle),
            )]),
        };

        frame.render_widget(
            Paragraph::new(line).alignment(Alignment::Center),
            area,
        );
    }

    fn render_timeline(&mut self, frame: &mut Frame, area: Rect) {
        let pad = home_pad(area);

        let mut items = Vec::new();
        items.push(ListItem::new(Line::from(vec![
            Span::raw(" ".repeat(pad)),
            Span::styled("RECENT", self.theme.style(StyleKind::Faint)),
        ])));

        if self.snapshot.sessions.is_empty() {
            items.push(ListItem::new(Line::from(vec![
                Span::raw(" ".repeat(pad)),
                Span::styled(
                    "No dispatcher chapters yet",
                    self.theme.style(StyleKind::Muted),
                ),
            ])));
        } else {
            for session in self
                .snapshot
                .sessions
                .iter()
                .take(area.height.saturating_sub(1) as usize)
            {
                let child = if session.child_count > 0 {
                    format!(" · {} sub", session.child_count)
                } else {
                    String::new()
                };
                items.push(ListItem::new(Line::from(vec![
                    Span::raw(" ".repeat(pad)),
                    Span::styled("· ", self.theme.style(StyleKind::Primary)),
                    Span::styled(&session.title, self.theme.style(StyleKind::Title)),
                    Span::raw("  "),
                    Span::styled(
                        format!(
                            "{} turns{} · {}",
                            session.turns,
                            child,
                            format_clock(session.last_active_at)
                        ),
                        self.theme.style(StyleKind::Muted),
                    ),
                ])));
            }
        }

        let mut state = ListState::default();
        state.select(Some(self.selected.min(items.len().saturating_sub(1)).max(1)));
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
        spans.extend(chip(self.snapshot.tasks.len(), "tasks"));
        spans.push(sep());
        spans.extend(chip(self.snapshot.apps.len(), "apps"));
        spans.push(sep());
        spans.extend(chip(self.snapshot.memories.len(), "memory"));
        spans.push(sep());
        spans.extend(chip(self.snapshot.sessions.len(), "chapters"));

        frame.render_widget(
            Paragraph::new(Line::from(spans)).alignment(Alignment::Center),
            area,
        );
    }

    fn render_input(&self, frame: &mut Frame, area: Rect) {
        let pad = home_pad(area);
        let mut spans = vec![
            Span::raw(" ".repeat(pad)),
            Span::styled("❯ ", self.theme.style(StyleKind::Primary)),
        ];
        if self.input.is_empty() {
            spans.push(Span::styled(
                "Talk to Sparo, or / for commands",
                self.theme.style(StyleKind::Muted),
            ));
        } else {
            spans.push(Span::styled(self.input.clone(), self.theme.style(StyleKind::Text)));
        }

        frame.render_widget(Paragraph::new(Line::from(spans)), area);
    }

    fn render_footer(&self, frame: &mut Frame, area: Rect) {
        let key = |k: &str| Span::styled(k.to_string(), self.theme.style(StyleKind::Muted));
        let lab = |l: &str| Span::styled(format!(" {}", l), self.theme.style(StyleKind::Faint));
        let sep = || Span::styled("    ", self.theme.style(StyleKind::Faint));

        let line = Line::from(vec![
            key("enter"),
            lab("send"),
            sep(),
            key("/"),
            lab("command"),
            sep(),
            key("^T"),
            lab("tasks"),
            sep(),
            key("^P"),
            lab("apps"),
            sep(),
            key("^O"),
            lab("workspace"),
            sep(),
            key("^C"),
            lab("exit"),
        ]);

        frame.render_widget(
            Paragraph::new(line).alignment(Alignment::Center),
            area,
        );
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
            (KeyCode::Char('m'), KeyModifiers::CONTROL) => {
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
            (KeyCode::Char('/'), _) => {
                self.panel = Panel::Command;
                self.command_filter.clear();
                self.selected = 0;
                None
            }
            (KeyCode::Esc, _) => {
                self.panel = Panel::Home;
                None
            }
            (KeyCode::Up, _) => {
                self.selected = self.selected.saturating_sub(1);
                None
            }
            (KeyCode::Down, _) => {
                self.selected = self.selected.saturating_add(1);
                None
            }
            (KeyCode::Backspace, _) if self.panel == Panel::Home => {
                self.input.pop();
                None
            }
            (KeyCode::Enter, _) => self.handle_enter(),
            (KeyCode::Char(c), _) if self.panel == Panel::Home => {
                self.input.push(c);
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
            (KeyCode::Backspace, _) => {
                self.command_filter.pop();
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
                let overlay = OverlayState {
                    kind: OverlayKind::CommandPalette,
                    selected: self.selected,
                    filter: self.command_filter.clone(),
                    snapshot: None,
                };
                selected_command(&overlay, CommandScope::Home)
                    .and_then(|command| self.apply_command_action(command.action))
            }
            _ => None,
        }
    }

    fn toggle_panel(&mut self, panel: Panel) {
        self.panel = if self.panel == panel { Panel::Home } else { panel };
        self.selected = 0;
    }

    fn handle_enter(&mut self) -> Option<StartupOutcome> {
        if self.panel == Panel::Home {
            let typed = self.input.trim();
            if typed == "/" {
                self.panel = Panel::Command;
                self.command_filter.clear();
                self.selected = 0;
                return None;
            }
            if typed.starts_with('/') {
                if let Some(command) = command_for_slash(typed, CommandScope::Home) {
                    return self.apply_command_action(command.action);
                }
            }
        }

        Some(StartupOutcome::Launch(self.launch_selection()))
    }

    fn apply_command_action(&mut self, action: CommandAction) -> Option<StartupOutcome> {
        match action {
            CommandAction::OpenPanel(kind) => {
                self.panel = panel_from_kind(kind);
                self.selected = 0;
                None
            }
            CommandAction::NewSession => {
                self.input.clear();
                Some(StartupOutcome::Launch(StartupLaunch {
                    workspace: self.snapshot.current_workspace.clone(),
                    session_id: None,
                    agent: "Dispatcher".to_string(),
                    initial_message: None,
                }))
            }
            CommandAction::Help => {
                self.panel = Panel::Command;
                self.command_filter.clear();
                self.selected = 0;
                None
            }
            CommandAction::ClearChat
            | CommandAction::Dispatch
            | CommandAction::ShowAgents
            | CommandAction::ShowHistory
            | CommandAction::ExportSession => None,
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
            Panel::Tasks => {
                if let Some(task) = self.snapshot.tasks.get(self.selected) {
                    return StartupLaunch {
                        workspace: task.workspace.clone().or_else(|| self.snapshot.current_workspace.clone()),
                        session_id: task.session_id.clone(),
                        agent: task.agent.clone(),
                        initial_message: None,
                    };
                }
            }
            Panel::Apps => {
                if let Some(app) = self.snapshot.apps.get(self.selected) {
                    return StartupLaunch {
                        workspace: self.snapshot.current_workspace.clone(),
                        session_id: None,
                        agent: "Dispatcher".to_string(),
                        initial_message: Some(format!(
                            "Open or use the {} '{}' (id: {}). If it needs setup, tell me the next concrete action.",
                            app.kind, app.name, app.id
                        )),
                    };
                }
            }
            Panel::Memory => {
                if let Some(memory) = self.snapshot.memories.get(self.selected) {
                    return StartupLaunch {
                        workspace: self.snapshot.current_workspace.clone(),
                        session_id: None,
                        agent: "Dispatcher".to_string(),
                        initial_message: Some(format!(
                            "Review the {} memory file '{}' in '{}'.",
                            memory.scope, memory.file, memory.target
                        )),
                    };
                }
            }
            Panel::Workspaces => {
                if let Some(row) = self.snapshot.workspaces.get(self.selected) {
                    return StartupLaunch {
                        workspace: row.path.clone(),
                        session_id: None,
                        agent: "Dispatcher".to_string(),
                        initial_message: None,
                    };
                }
            }
            Panel::Home | Panel::Settings | Panel::Command => {}
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
        PanelKind::Tasks => Panel::Tasks,
        PanelKind::Apps => Panel::Apps,
        PanelKind::Memory => Panel::Memory,
        PanelKind::Workspaces => Panel::Workspaces,
        PanelKind::Settings => Panel::Settings,
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
