use bitfun_core::command::agentic_os::AgenticOsSnapshot;
use ratatui::{
    layout::{Alignment, Rect},
    style::Modifier,
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Clear, List, ListItem, ListState, Paragraph},
    Frame,
};

use super::commands::{filtered_commands, CommandScope, PanelKind};
use super::theme::{StyleKind, Theme};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverlayKind {
    CommandPalette,
    Panel(PanelKind),
    Help,
}

#[derive(Debug, Clone)]
pub struct OverlayState {
    pub kind: OverlayKind,
    pub selected: usize,
    pub filter: String,
    pub snapshot: Option<AgenticOsSnapshot>,
}

impl OverlayState {
    pub fn command_palette() -> Self {
        Self {
            kind: OverlayKind::CommandPalette,
            selected: 0,
            filter: String::new(),
            snapshot: None,
        }
    }

    pub fn panel(kind: PanelKind, snapshot: AgenticOsSnapshot) -> Self {
        Self {
            kind: OverlayKind::Panel(kind),
            selected: 0,
            filter: String::new(),
            snapshot: Some(snapshot),
        }
    }

    pub fn help() -> Self {
        Self {
            kind: OverlayKind::Help,
            selected: 0,
            filter: String::new(),
            snapshot: None,
        }
    }
}

pub fn render_overlay(
    frame: &mut Frame,
    area: Rect,
    theme: &Theme,
    overlay: &mut OverlayState,
    scope: CommandScope,
) {
    match overlay.kind {
        OverlayKind::CommandPalette => render_command_palette(frame, area, theme, overlay, scope),
        OverlayKind::Panel(kind) => render_snapshot_panel(frame, area, theme, overlay, kind),
        OverlayKind::Help => render_help(frame, area, theme, scope),
    }
}

pub fn render_command_palette(
    frame: &mut Frame,
    area: Rect,
    theme: &Theme,
    overlay: &mut OverlayState,
    scope: CommandScope,
) {
    let popup = centered_popup(area, area.width.min(78), area.height.min(18));
    let commands = filtered_commands(scope, &overlay.filter);
    overlay.selected = overlay.selected.min(commands.len().saturating_sub(1));

    let mut items = Vec::new();
    items.push(ListItem::new(Line::from(vec![
        Span::styled("/", theme.style(StyleKind::Primary)),
        Span::styled(overlay.filter.clone(), theme.style(StyleKind::Text)),
    ])));
    items.push(ListItem::new(Line::from("")));

    if commands.is_empty() {
        items.push(ListItem::new(Line::from(Span::styled(
            "No matching commands",
            theme.style(StyleKind::Muted),
        ))));
    } else {
        for command in commands {
            let shortcut = command.shortcut.unwrap_or("");
            items.push(ListItem::new(Line::from(vec![
                Span::styled(format!("{:<13}", command.slash), theme.style(StyleKind::AccentTitle)),
                Span::styled(format!("{:<16}", command.title), theme.style(StyleKind::Title)),
                Span::styled(command.description, theme.style(StyleKind::Muted)),
                Span::raw("  "),
                Span::styled(shortcut, theme.style(StyleKind::Faint)),
            ])));
        }
    }

    let mut state = ListState::default();
    if items.len() > 2 {
        state.select(Some(overlay.selected + 2));
    }

    frame.render_widget(Clear, popup);
    frame.render_stateful_widget(
        List::new(items)
            .highlight_style(theme.style(StyleKind::Primary).add_modifier(Modifier::BOLD))
            .block(overlay_block("Command Palette", theme)),
        popup,
        &mut state,
    );
}

pub fn render_snapshot_panel(
    frame: &mut Frame,
    area: Rect,
    theme: &Theme,
    overlay: &mut OverlayState,
    kind: PanelKind,
) {
    let popup = centered_popup(area, area.width.min(96), area.height.min(22));
    let rows = panel_rows(kind, overlay.snapshot.as_ref(), theme);
    overlay.selected = overlay.selected.min(rows.len().saturating_sub(1));

    let mut state = ListState::default();
    if !rows.is_empty() {
        state.select(Some(overlay.selected));
    }

    let footer = Paragraph::new(kind.close_hint())
        .style(theme.style(StyleKind::Faint))
        .alignment(Alignment::Center);
    let inner = Rect {
        x: popup.x,
        y: popup.y,
        width: popup.width,
        height: popup.height.saturating_sub(1),
    };
    let footer_area = Rect {
        x: popup.x,
        y: popup.y + popup.height.saturating_sub(1),
        width: popup.width,
        height: 1,
    };

    frame.render_widget(Clear, popup);
    frame.render_stateful_widget(
        List::new(rows)
            .highlight_style(theme.style(StyleKind::Primary).add_modifier(Modifier::BOLD))
            .block(overlay_block(kind.title(), theme)),
        inner,
        &mut state,
    );
    frame.render_widget(footer, footer_area);
}

fn render_help(frame: &mut Frame, area: Rect, theme: &Theme, scope: CommandScope) {
    let popup = centered_popup(area, area.width.min(82), area.height.min(18));
    let mut lines = vec![Line::from(Span::styled(
        "Command Reference",
        theme.style(StyleKind::AccentTitle),
    ))];
    lines.push(Line::from(""));
    for command in super::commands::commands_for_scope(scope) {
        lines.push(Line::from(vec![
            Span::styled(format!("{:<13}", command.slash), theme.style(StyleKind::AccentTitle)),
            Span::styled(format!("{:<16}", command.title), theme.style(StyleKind::Title)),
            Span::styled(command.description, theme.style(StyleKind::Muted)),
        ]));
    }
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Esc closes this panel. Enter runs the highlighted command in the palette.",
        theme.style(StyleKind::Faint),
    )));

    frame.render_widget(Clear, popup);
    frame.render_widget(
        Paragraph::new(lines)
            .block(overlay_block("Help", theme))
            .alignment(Alignment::Left),
        popup,
    );
}

pub fn selected_command(
    overlay: &OverlayState,
    scope: CommandScope,
) -> Option<&'static super::commands::CommandSpec> {
    let commands = filtered_commands(scope, &overlay.filter);
    commands.get(overlay.selected).copied()
}

pub fn selected_panel_prompt(overlay: &OverlayState) -> Option<String> {
    let OverlayKind::Panel(kind) = overlay.kind else {
        return None;
    };
    let snapshot = overlay.snapshot.as_ref()?;
    match kind {
        PanelKind::Tasks => snapshot.tasks.get(overlay.selected).map(|task| {
            format!(
                "Continue the task '{}' with {}. Summarize current state first.",
                task.title, task.agent
            )
        }),
        PanelKind::Apps => snapshot.apps.get(overlay.selected).map(|app| {
            format!(
                "Open or use the {} '{}' (id: {}). If setup is required, give the next concrete action.",
                app.kind, app.name, app.id
            )
        }),
        PanelKind::Memory => snapshot.memories.get(overlay.selected).map(|memory| {
            format!(
                "Review the {} memory file '{}' in '{}'.",
                memory.scope, memory.file, memory.target
            )
        }),
        PanelKind::Workspaces | PanelKind::Settings => None,
    }
}

pub fn selected_workspace(overlay: &OverlayState) -> Option<Option<String>> {
    let OverlayKind::Panel(PanelKind::Workspaces) = overlay.kind else {
        return None;
    };
    overlay
        .snapshot
        .as_ref()?
        .workspaces
        .get(overlay.selected)
        .map(|workspace| workspace.path.clone())
}

fn panel_rows<'a>(
    kind: PanelKind,
    snapshot: Option<&'a AgenticOsSnapshot>,
    theme: &Theme,
) -> Vec<ListItem<'a>> {
    let Some(snapshot) = snapshot else {
        return vec![ListItem::new(Line::from(Span::styled(
            "Loading...",
            theme.style(StyleKind::Muted),
        )))];
    };

    match kind {
        PanelKind::Tasks => {
            if snapshot.tasks.is_empty() {
                return vec![ListItem::new(Line::from(Span::styled(
                    "No backend-tracked agent tasks found.",
                    theme.style(StyleKind::Muted),
                )))];
            }
            snapshot
                .tasks
                .iter()
                .map(|task| {
                    ListItem::new(Line::from(vec![
                        Span::styled(format!("{:<10}", task.status), theme.style(StyleKind::Primary)),
                        Span::styled(format!("{:<28}", task.title), theme.style(StyleKind::Title)),
                        Span::styled(format!("{:<14}", task.agent), theme.style(StyleKind::Muted)),
                        Span::styled(&task.detail, theme.style(StyleKind::Muted)),
                    ]))
                })
                .collect()
        }
        PanelKind::Apps => {
            if snapshot.apps.is_empty() {
                return vec![ListItem::new(Line::from(Span::styled(
                    "No Agent, Live, or Bridge Apps installed.",
                    theme.style(StyleKind::Muted),
                )))];
            }
            snapshot
                .apps
                .iter()
                .map(|app| {
                    ListItem::new(Line::from(vec![
                        Span::styled(format!("{:<12}", app.kind), theme.style(StyleKind::Muted)),
                        Span::styled(format!("{:<24}", app.name), theme.style(StyleKind::Title)),
                        Span::styled(format!("{:<34}", app.description), theme.style(StyleKind::Text)),
                        Span::styled(&app.capability, theme.style(StyleKind::Faint)),
                    ]))
                })
                .collect()
        }
        PanelKind::Memory => {
            if snapshot.memories.is_empty() {
                return vec![ListItem::new(Line::from(Span::styled(
                    "No memory files found for global/project stores.",
                    theme.style(StyleKind::Muted),
                )))];
            }
            snapshot
                .memories
                .iter()
                .map(|memory| {
                    ListItem::new(Line::from(vec![
                        Span::styled(format!("{:<9}", memory.scope), theme.style(StyleKind::Muted)),
                        Span::styled(format!("{:<28}", memory.file), theme.style(StyleKind::Title)),
                        Span::styled(&memory.target, theme.style(StyleKind::Faint)),
                    ]))
                })
                .collect()
        }
        PanelKind::Workspaces => snapshot
            .workspaces
            .iter()
            .map(|workspace| {
                let path = workspace.path.as_deref().unwrap_or("Agentic OS global runtime");
                ListItem::new(Line::from(vec![
                    Span::styled(format!("{:<18}", workspace.label), theme.style(StyleKind::Title)),
                    Span::styled(format!("{:<40}", path), theme.style(StyleKind::Muted)),
                    Span::styled(
                        format!("{} sessions", workspace.session_count),
                        theme.style(StyleKind::Faint),
                    ),
                ]))
            })
            .collect(),
        PanelKind::Settings => vec![
            ListItem::new(Line::from(vec![
                Span::styled("MODEL      ", theme.style(StyleKind::Muted)),
                Span::styled(&snapshot.model, theme.style(StyleKind::Title)),
            ])),
            ListItem::new(Line::from(vec![
                Span::styled("WORKSPACE  ", theme.style(StyleKind::Muted)),
                Span::styled(
                    snapshot.current_workspace.as_deref().unwrap_or("global"),
                    theme.style(StyleKind::Title),
                ),
            ])),
            ListItem::new(Line::from(vec![
                Span::styled("GIT        ", theme.style(StyleKind::Muted)),
                Span::styled(
                    snapshot.git_branch.as_deref().unwrap_or("no-git"),
                    theme.style(StyleKind::Title),
                ),
            ])),
        ],
    }
}

fn overlay_block<'a>(title: &'a str, theme: &Theme) -> Block<'a> {
    Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .title(Span::styled(
            format!(" {} ", title),
            theme.style(StyleKind::AccentTitle),
        ))
        .border_style(theme.style(StyleKind::Primary))
}

fn centered_popup(area: Rect, width: u16, height: u16) -> Rect {
    Rect {
        x: area.x + area.width.saturating_sub(width) / 2,
        y: area.y + area.height.saturating_sub(height) / 2,
        width,
        height,
    }
}

pub fn move_selection(overlay: &mut OverlayState, delta: isize, item_count: usize) {
    if item_count == 0 {
        overlay.selected = 0;
        return;
    }
    if delta < 0 {
        overlay.selected = overlay.selected.saturating_sub(delta.unsigned_abs());
    } else {
        overlay.selected = (overlay.selected + delta as usize).min(item_count.saturating_sub(1));
    }
}

pub fn command_count(scope: CommandScope, filter: &str) -> usize {
    filtered_commands(scope, filter).len()
}

pub fn panel_count(overlay: &OverlayState) -> usize {
    let Some(snapshot) = &overlay.snapshot else {
        return 0;
    };
    match overlay.kind {
        OverlayKind::Panel(PanelKind::Tasks) => snapshot.tasks.len(),
        OverlayKind::Panel(PanelKind::Apps) => snapshot.apps.len(),
        OverlayKind::Panel(PanelKind::Memory) => snapshot.memories.len(),
        OverlayKind::Panel(PanelKind::Workspaces) => snapshot.workspaces.len(),
        OverlayKind::Panel(PanelKind::Settings) => 3,
        _ => 0,
    }
}
