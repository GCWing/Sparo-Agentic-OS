use bitfun_core::command::agentic_os::AgenticOsSnapshot;
use ratatui::{
    layout::{Alignment, Margin, Rect},
    style::Style,
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Clear, List, ListItem, ListState, Paragraph},
    Frame,
};

use super::commands::{filtered_commands, CommandScope, CommandSpec, PanelKind};
use super::string_utils::{shell_arg, truncate_str};
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
        OverlayKind::Panel(kind) => render_snapshot_panel(frame, area, theme, overlay, kind, scope),
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
    let popup = overlay_popup(area, 78, 18);
    let content = overlay_content_area(popup);
    let content_width = content.width as usize;
    let commands = filtered_commands(scope, &overlay.filter);
    let has_matches = !commands.is_empty();
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
        items.push(ListItem::new(Line::from(Span::styled(
            command_palette_empty_hint(content_width),
            theme.style(StyleKind::Faint),
        ))));
    } else {
        for command in commands {
            items.push(ListItem::new(command_reference_line(
                command,
                theme,
                content_width,
            )));
        }
    }

    let mut state = ListState::default();
    if items.len() > 2 {
        state.select(Some(overlay.selected + 2));
    }

    let inner = Rect {
        x: content.x,
        y: content.y,
        width: content.width,
        height: content.height.saturating_sub(2),
    };
    let footer_area = Rect {
        x: content.x,
        y: content.y + content.height.saturating_sub(1),
        width: content.width,
        height: 1,
    };
    let footer = Paragraph::new(command_palette_footer_hint(content_width, has_matches))
        .style(theme.style(StyleKind::Faint))
        .alignment(Alignment::Center);

    frame.render_widget(Clear, popup);
    frame.render_widget(overlay_block("Command Palette", theme), popup);
    render_overlay_separator(frame, theme, footer_area.y.saturating_sub(1), content);
    frame.render_stateful_widget(
        List::new(items)
            .highlight_style(overlay_selection_style(theme))
            .highlight_symbol("> ")
            .repeat_highlight_symbol(true),
        inner,
        &mut state,
    );
    frame.render_widget(footer, footer_area);
}

fn command_palette_empty_hint(width: usize) -> String {
    compact_inline_text(
        "Backspace clears the filter. Try sessions, memory, data, or help.",
        width,
    )
}

pub fn render_snapshot_panel(
    frame: &mut Frame,
    area: Rect,
    theme: &Theme,
    overlay: &mut OverlayState,
    kind: PanelKind,
    scope: CommandScope,
) {
    let popup = overlay_popup(area, 96, 22);
    let content = overlay_content_area(popup);
    let data_count = panel_match_count(kind, overlay.snapshot.as_ref(), &overlay.filter);
    let raw_count = snapshot_panel_count(kind, overlay.snapshot.as_ref());
    let rows = panel_rows_for_width(
        kind,
        overlay.snapshot.as_ref(),
        theme,
        content.width as usize,
        &overlay.filter,
    );
    if data_count == 0 {
        overlay.selected = overlay.selected.min(rows.len().saturating_sub(1));
    } else {
        overlay.selected = overlay.selected.min(data_count.saturating_sub(1));
    }
    let title = snapshot_panel_title(
        kind,
        overlay.selected,
        data_count,
        raw_count,
        &overlay.filter,
        content.width,
    );
    let preview = selected_panel_preview(overlay, content.width as usize);

    let mut state = ListState::default();
    if !rows.is_empty() {
        let selected_row = if data_count == 0 {
            overlay.selected
        } else {
            overlay.selected + 1
        };
        state.select(Some(selected_row));
    }

    let preview_height = u16::from(preview.is_some());
    let footer = Paragraph::new(panel_footer_hint(
        kind,
        scope,
        popup.width,
        overlay.selected,
        data_count,
        &overlay.filter,
    ))
    .style(theme.style(StyleKind::Faint))
    .alignment(Alignment::Center);
    let inner = Rect {
        x: content.x,
        y: content.y,
        width: content.width,
        height: content.height.saturating_sub(2 + preview_height),
    };
    let preview_area = Rect {
        x: content.x,
        y: content
            .y
            .saturating_add(content.height.saturating_sub(1 + preview_height)),
        width: content.width,
        height: preview_height,
    };
    let footer_area = Rect {
        x: content.x,
        y: content.y + content.height.saturating_sub(1),
        width: content.width,
        height: 1,
    };

    frame.render_widget(Clear, popup);
    frame.render_widget(overlay_block(&title, theme), popup);
    render_overlay_separator(frame, theme, footer_area.y.saturating_sub(1), content);
    frame.render_stateful_widget(
        List::new(rows)
            .highlight_style(overlay_selection_style(theme))
            .highlight_symbol("> ")
            .repeat_highlight_symbol(true),
        inner,
        &mut state,
    );
    if let Some(preview) = preview {
        frame.render_widget(
            Paragraph::new(preview)
                .style(theme.style(StyleKind::Faint))
                .alignment(Alignment::Center),
            preview_area,
        );
    }
    frame.render_widget(footer, footer_area);
}

fn render_help(frame: &mut Frame, area: Rect, theme: &Theme, scope: CommandScope) {
    let popup = overlay_popup(area, 82, 18);
    let content = overlay_content_area(popup);
    let content_width = content.width as usize;
    let visible_content_height = content.height.saturating_sub(2) as usize;
    let mut lines = vec![Line::from(Span::styled(
        "Command Reference",
        theme.style(StyleKind::AccentTitle),
    ))];
    lines.push(Line::from(""));
    let quick_capacity = help_quick_reference_capacity(visible_content_height);
    lines.extend(
        help_quick_reference_lines(scope, theme, content_width)
            .into_iter()
            .take(quick_capacity),
    );
    lines.push(Line::from(""));

    let command_capacity = visible_content_height.saturating_sub(lines.len());
    let commands = super::commands::commands_for_scope(scope).collect::<Vec<_>>();
    let visible_count = if commands.len() > command_capacity {
        command_capacity.saturating_sub(1)
    } else {
        command_capacity
    };
    for command in commands.iter().take(visible_count) {
        lines.push(command_reference_line(command, theme, content_width));
    }
    if commands.len() > visible_count {
        lines.push(help_overflow_line(
            commands.len().saturating_sub(visible_count),
            theme,
            content_width,
        ));
    }

    let inner = Rect {
        x: content.x,
        y: content.y,
        width: content.width,
        height: content.height.saturating_sub(2),
    };
    let footer_area = Rect {
        x: content.x,
        y: content.y + content.height.saturating_sub(1),
        width: content.width,
        height: 1,
    };
    let footer = Paragraph::new(help_footer_hint(content_width))
        .style(theme.style(StyleKind::Faint))
        .alignment(Alignment::Center);

    frame.render_widget(Clear, popup);
    frame.render_widget(overlay_block("Help", theme), popup);
    render_overlay_separator(frame, theme, footer_area.y.saturating_sub(1), content);
    frame.render_widget(Paragraph::new(lines).alignment(Alignment::Left), inner);
    frame.render_widget(footer, footer_area);
}

fn help_quick_reference_capacity(inner_height: usize) -> usize {
    if inner_height < 10 {
        1
    } else if inner_height < 14 {
        2
    } else if inner_height < 18 {
        3
    } else {
        4
    }
}

fn help_quick_reference_lines(
    scope: CommandScope,
    theme: &Theme,
    content_width: usize,
) -> Vec<Line<'static>> {
    let primary = match scope {
        CommandScope::Home => "Home: Enter continue/new   / commands   R refresh",
        CommandScope::Chat | CommandScope::Global => {
            "Chat: Enter send   Ctrl+L clear   Ctrl+E browse"
        }
    };
    [
        primary,
        "Panels: Ctrl+T/P/Y/O/,   R refresh   Pg/Home/End move",
        "Panel filter: type text   Backspace edit   Ctrl+U clear   Esc clear",
        "Commands: type / then sessions, memory, data, or help",
    ]
    .into_iter()
    .map(|line| {
        Line::from(Span::styled(
            compact_inline_text(line, content_width),
            theme.style(StyleKind::Muted),
        ))
    })
    .collect()
}

fn help_overflow_line(remaining: usize, theme: &Theme, content_width: usize) -> Line<'static> {
    Line::from(Span::styled(
        compact_inline_text(
            &format!("+ {} more commands. Press / and type to filter.", remaining),
            content_width,
        ),
        theme.style(StyleKind::Faint),
    ))
}

pub fn selected_command(
    overlay: &OverlayState,
    scope: CommandScope,
) -> Option<&'static super::commands::CommandSpec> {
    let commands = filtered_commands(scope, &overlay.filter);
    let index = overlay.selected.min(commands.len().saturating_sub(1));
    commands.get(index).copied()
}

fn help_footer_hint(width: usize) -> String {
    let hint = if width >= 64 {
        "Esc closes this panel. Press / from chat or home to open commands."
    } else if width >= 36 {
        "Esc close   / commands"
    } else {
        "Esc close"
    };

    truncate_str(hint, width)
}

fn command_palette_footer_hint(width: usize, has_matches: bool) -> String {
    let hint = if !has_matches {
        if width >= 42 {
            "Backspace clear   Esc close"
        } else {
            "Backspace   Esc"
        }
    } else if width >= 70 {
        "Type filter   Pg/Home/End move   Enter select   Esc close"
    } else if width >= 56 {
        "Type filter   Enter select   Esc close"
    } else if width >= 30 {
        "Enter select   Esc close"
    } else {
        "Enter   Esc"
    };

    truncate_str(hint, width)
}

fn panel_footer_hint(
    kind: PanelKind,
    scope: CommandScope,
    width: u16,
    selected: usize,
    data_count: usize,
    filter: &str,
) -> String {
    let content_width = width.saturating_sub(2) as usize;
    if !filter.trim().is_empty() {
        let filter_hint = compact_inline_text(&format!("filter: {}", filter), content_width / 2);
        let hint = if width >= 64 {
            format!(
                "{}   Backspace edit   Ctrl+U clear   Esc clear   {}",
                filter_hint,
                enter_action_short_label(kind, scope)
            )
        } else if width >= 36 {
            format!("{}   Backspace   Esc", filter_hint)
        } else {
            filter_hint
        };
        return truncate_str(&hint, content_width);
    }

    if data_count == 0 {
        let hint = if width >= 58 {
            "No items   R refresh   Esc close"
        } else if width >= 34 {
            "No items   R refresh   Esc"
        } else {
            "R refresh   Esc"
        };
        return truncate_str(hint, content_width);
    }

    let position = if data_count > 1 {
        Some(format!("{}/{}", selected + 1, data_count))
    } else {
        None
    };

    let hint = if let Some(position) = position {
        if width >= 92 {
            format!(
                "Up/Dn/Pg/Home/End {}   Type filter   {}   R refresh   Esc close",
                position,
                enter_action_label(kind, scope)
            )
        } else if width >= 70 {
            format!(
                "Up/Dn/Pg/Home/End {}   {}   R refresh   Esc close",
                position,
                enter_action_label(kind, scope)
            )
        } else if width >= 46 {
            format!(
                "Up/Dn {}   {}   R refresh   Esc",
                position,
                enter_action_short_label(kind, scope)
            )
        } else if width >= 30 {
            "Up/Dn   Enter   R   Esc".to_string()
        } else {
            "Up/Dn Esc".to_string()
        }
    } else if width >= 76 {
        format!(
            "Type filter   {}   R refresh   Esc close",
            enter_action_label(kind, scope)
        )
    } else if width >= 58 {
        single_item_panel_hint(kind, scope).to_string()
    } else if width >= 34 {
        format!(
            "{}   R refresh   Esc close",
            enter_action_short_label(kind, scope)
        )
    } else {
        "Enter   R   Esc".to_string()
    };

    truncate_str(&hint, content_width)
}

fn single_item_panel_hint(kind: PanelKind, scope: CommandScope) -> &'static str {
    if kind == PanelKind::Sessions && scope == CommandScope::Chat {
        "Enter resume session   R refresh   Esc close"
    } else {
        kind.close_hint()
    }
}

fn enter_action_label(kind: PanelKind, scope: CommandScope) -> &'static str {
    match kind {
        PanelKind::Sessions if scope == CommandScope::Chat => "Enter resume session",
        PanelKind::Sessions => "Enter resume session",
        PanelKind::Tasks => "Enter open task",
        PanelKind::Apps => "Enter inspect app",
        PanelKind::Memory => "Enter load memory",
        PanelKind::Workspaces => "Enter select workspace",
        PanelKind::Settings => "Enter inspect setting",
    }
}

fn enter_action_short_label(kind: PanelKind, scope: CommandScope) -> &'static str {
    match kind {
        PanelKind::Sessions if scope == CommandScope::Chat => "Enter resume",
        PanelKind::Sessions => "Enter resume",
        PanelKind::Tasks => "Enter open",
        PanelKind::Apps => "Enter inspect",
        PanelKind::Memory => "Enter load",
        PanelKind::Workspaces => "Enter select",
        PanelKind::Settings => "Enter inspect",
    }
}

fn snapshot_panel_title(
    kind: PanelKind,
    selected: usize,
    data_count: usize,
    raw_count: usize,
    filter: &str,
    popup_width: u16,
) -> String {
    let title = if data_count == 0 {
        if !filter.trim().is_empty() && raw_count > 0 {
            format!("{} 0/{} filter {}", kind.title(), raw_count, filter)
        } else {
            format!("{} 0", kind.title())
        }
    } else if !filter.trim().is_empty() && raw_count != data_count {
        format!(
            "{} {}/{} filter {}",
            kind.title(),
            selected + 1,
            data_count,
            filter
        )
    } else {
        format!("{} {}/{}", kind.title(), selected + 1, data_count)
    };
    compact_inline_text(&title, popup_width.saturating_sub(4) as usize)
}

fn panel_filter_active(filter: &str) -> bool {
    !filter.trim().is_empty()
}

fn panel_match_count(kind: PanelKind, snapshot: Option<&AgenticOsSnapshot>, filter: &str) -> usize {
    let Some(snapshot) = snapshot else {
        return 0;
    };
    filtered_panel_indices(kind, snapshot, filter).len()
}

fn filtered_snapshot_for_panel(
    kind: PanelKind,
    snapshot: &AgenticOsSnapshot,
    filter: &str,
) -> AgenticOsSnapshot {
    if !panel_filter_active(filter) || kind == PanelKind::Settings {
        return snapshot.clone();
    }

    let mut filtered = snapshot.clone();
    match kind {
        PanelKind::Sessions => {
            filtered.sessions = snapshot
                .sessions
                .iter()
                .filter(|session| {
                    searchable_matches(
                        filter,
                        [
                            session.title.as_str(),
                            session.id.as_str(),
                            session.agent.as_str(),
                            session.workspace.as_deref().unwrap_or("global"),
                            if session.is_dispatch_task {
                                "task"
                            } else {
                                "session"
                            },
                        ],
                    )
                })
                .cloned()
                .collect();
        }
        PanelKind::Tasks => {
            filtered.tasks = snapshot
                .tasks
                .iter()
                .filter(|task| {
                    searchable_matches(
                        filter,
                        [
                            task.title.as_str(),
                            task.status.as_str(),
                            task.agent.as_str(),
                            task.detail.as_str(),
                            task.session_id.as_deref().unwrap_or(""),
                            task.workspace.as_deref().unwrap_or("global"),
                        ],
                    )
                })
                .cloned()
                .collect();
        }
        PanelKind::Apps => {
            filtered.apps = snapshot
                .apps
                .iter()
                .filter(|app| {
                    searchable_matches(
                        filter,
                        [
                            app.id.as_str(),
                            app.name.as_str(),
                            app.kind.as_str(),
                            app.capability.as_str(),
                            app.description.as_str(),
                            app.target.as_deref().unwrap_or(""),
                        ],
                    )
                })
                .cloned()
                .collect();
        }
        PanelKind::Memory => {
            filtered.memories = snapshot
                .memories
                .iter()
                .filter(|memory| {
                    searchable_matches(
                        filter,
                        [
                            memory.scope.as_str(),
                            memory.file.as_str(),
                            memory.target.as_str(),
                        ],
                    )
                })
                .cloned()
                .collect();
        }
        PanelKind::Workspaces => {
            filtered.workspaces = snapshot
                .workspaces
                .iter()
                .filter(|workspace| {
                    let current = workspace_current_label(
                        workspace.path.as_deref(),
                        snapshot.current_workspace.as_deref(),
                    );
                    searchable_matches(
                        filter,
                        [
                            current,
                            workspace.label.as_str(),
                            workspace
                                .path
                                .as_deref()
                                .unwrap_or("Agentic OS global runtime"),
                            workspace.git.as_deref().unwrap_or("no-git"),
                        ],
                    )
                })
                .cloned()
                .collect();
        }
        PanelKind::Settings => {}
    }
    filtered
}

fn filtered_panel_indices(
    kind: PanelKind,
    snapshot: &AgenticOsSnapshot,
    filter: &str,
) -> Vec<usize> {
    if !panel_filter_active(filter) {
        return (0..snapshot_panel_count(kind, Some(snapshot))).collect();
    }

    match kind {
        PanelKind::Sessions => snapshot
            .sessions
            .iter()
            .enumerate()
            .filter_map(|(index, session)| {
                searchable_matches(
                    filter,
                    [
                        session.title.as_str(),
                        session.id.as_str(),
                        session.agent.as_str(),
                        session.workspace.as_deref().unwrap_or("global"),
                        if session.is_dispatch_task {
                            "task"
                        } else {
                            "session"
                        },
                    ],
                )
                .then_some(index)
            })
            .collect(),
        PanelKind::Tasks => snapshot
            .tasks
            .iter()
            .enumerate()
            .filter_map(|(index, task)| {
                searchable_matches(
                    filter,
                    [
                        task.title.as_str(),
                        task.status.as_str(),
                        task.agent.as_str(),
                        task.detail.as_str(),
                        task.session_id.as_deref().unwrap_or(""),
                        task.workspace.as_deref().unwrap_or("global"),
                    ],
                )
                .then_some(index)
            })
            .collect(),
        PanelKind::Apps => snapshot
            .apps
            .iter()
            .enumerate()
            .filter_map(|(index, app)| {
                searchable_matches(
                    filter,
                    [
                        app.id.as_str(),
                        app.name.as_str(),
                        app.kind.as_str(),
                        app.capability.as_str(),
                        app.description.as_str(),
                        app.target.as_deref().unwrap_or(""),
                    ],
                )
                .then_some(index)
            })
            .collect(),
        PanelKind::Memory => snapshot
            .memories
            .iter()
            .enumerate()
            .filter_map(|(index, memory)| {
                searchable_matches(
                    filter,
                    [
                        memory.scope.as_str(),
                        memory.file.as_str(),
                        memory.target.as_str(),
                    ],
                )
                .then_some(index)
            })
            .collect(),
        PanelKind::Workspaces => snapshot
            .workspaces
            .iter()
            .enumerate()
            .filter_map(|(index, workspace)| {
                let current = workspace_current_label(
                    workspace.path.as_deref(),
                    snapshot.current_workspace.as_deref(),
                );
                searchable_matches(
                    filter,
                    [
                        current,
                        workspace.label.as_str(),
                        workspace
                            .path
                            .as_deref()
                            .unwrap_or("Agentic OS global runtime"),
                        workspace.git.as_deref().unwrap_or("no-git"),
                    ],
                )
                .then_some(index)
            })
            .collect(),
        PanelKind::Settings => (0..5)
            .filter(|index| searchable_matches(filter, settings_search_terms(*index)))
            .collect(),
    }
}

pub fn selected_panel_data_index(overlay: &OverlayState) -> Option<usize> {
    let OverlayKind::Panel(kind) = overlay.kind else {
        return None;
    };
    let snapshot = overlay.snapshot.as_ref()?;
    filtered_panel_indices(kind, snapshot, &overlay.filter)
        .get(overlay.selected)
        .copied()
}

fn searchable_matches<'a>(filter: &str, values: impl IntoIterator<Item = &'a str>) -> bool {
    let haystack = values
        .into_iter()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    filter
        .split_whitespace()
        .map(str::to_ascii_lowercase)
        .all(|term| haystack.contains(&term))
}

fn settings_search_terms(index: usize) -> [&'static str; 4] {
    match index {
        0 => ["model", "ai", "default_models", "routing"],
        1 => ["workspace", "default_path", "project", "select"],
        2 => ["git", "branch", "context", "workspace"],
        3 => ["health", "diagnose", "repair", "paths"],
        4 => ["data", "storage", "sessions", "memory"],
        _ => ["", "", "", ""],
    }
}

fn no_matching_panel_rows(kind: PanelKind, theme: &Theme, filter: &str) -> Vec<ListItem<'static>> {
    let filter = compact_inline_text(filter, 28);
    vec![
        ListItem::new(Line::from(Span::styled(
            format!("No matching {} items.", kind.title().to_ascii_lowercase()),
            theme.style(StyleKind::Muted),
        ))),
        ListItem::new(Line::from(Span::styled(
            format!("Filter: {}", filter),
            theme.style(StyleKind::Faint),
        ))),
        ListItem::new(Line::from(Span::styled(
            "Backspace edit; Esc clear; R refresh.",
            theme.style(StyleKind::Faint),
        ))),
    ]
}

fn compact_text(value: &str, max_bytes: usize) -> String {
    truncate_str(value, max_bytes)
}

fn command_primary_label(command: &CommandSpec, width: usize) -> String {
    format!(
        "{:<width$}",
        compact_text(command.slash, width),
        width = width
    )
}

fn command_alias_hint(command: &CommandSpec, max_bytes: usize) -> String {
    let aliases = command.display_aliases();
    if aliases.is_empty() {
        return String::new();
    }
    compact_inline_text(&format!("aka {}", aliases.join(" ")), max_bytes)
}

fn command_reference_line<'a>(
    command: &'a CommandSpec,
    theme: &Theme,
    content_width: usize,
) -> Line<'a> {
    let slash_width = 14.min(content_width.max(1));
    if content_width < 44 {
        return Line::from(vec![
            Span::styled(
                command_primary_label(command, slash_width),
                theme.style(StyleKind::AccentTitle),
            ),
            Span::styled(
                compact_inline_text(command.title, 16),
                theme.style(StyleKind::Title),
            ),
        ]);
    }

    let show_aliases = content_width >= 68 && !command.display_aliases().is_empty();
    let alias_width = if show_aliases { 20 } else { 0 };
    let title_width = if content_width >= 68 { 15 } else { 18 };
    let shortcut = command.shortcut.unwrap_or("");
    let show_shortcut = !shortcut.is_empty() && content_width >= 62;
    let shortcut_width = if show_shortcut {
        shortcut.len().saturating_add(2)
    } else {
        0
    };
    let reserved = slash_width + alias_width + title_width + shortcut_width;
    let desc_width = content_width.saturating_sub(reserved).max(12);

    let mut spans = vec![Span::styled(
        command_primary_label(command, slash_width),
        theme.style(StyleKind::AccentTitle),
    )];
    if show_aliases {
        spans.push(Span::styled(
            format!("{:<20}", command_alias_hint(command, 19)),
            theme.style(StyleKind::Faint),
        ));
    }
    spans.push(Span::styled(
        format!(
            "{:<title_width$}",
            compact_inline_text(command.title, title_width),
            title_width = title_width
        ),
        theme.style(StyleKind::Title),
    ));
    spans.push(Span::styled(
        compact_inline_text(command.description, desc_width),
        theme.style(StyleKind::Muted),
    ));
    if show_shortcut {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(shortcut, theme.style(StyleKind::Faint)));
    }
    Line::from(spans)
}

fn compact_inline_text(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    if max_bytes <= 3 {
        return ".".repeat(max_bytes);
    }

    let mut boundary = max_bytes - 3;
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    format!("{}...", value[..boundary].trim_end())
}

pub fn selected_memory_file(overlay: &OverlayState) -> Option<std::path::PathBuf> {
    let OverlayKind::Panel(PanelKind::Memory) = overlay.kind else {
        return None;
    };
    let selected = selected_panel_data_index(overlay)?;
    let memory = overlay.snapshot.as_ref()?.memories.get(selected)?;
    Some(selected_memory_path(memory))
}

pub fn selected_session_row(
    overlay: &OverlayState,
) -> Option<bitfun_core::command::agentic_os::AgenticOsSessionRow> {
    let OverlayKind::Panel(PanelKind::Sessions) = overlay.kind else {
        return None;
    };
    let selected = selected_panel_data_index(overlay)?;
    overlay.snapshot.as_ref()?.sessions.get(selected).cloned()
}

pub fn selected_task_row(
    overlay: &OverlayState,
) -> Option<bitfun_core::command::agentic_os::AgenticOsTaskRow> {
    let OverlayKind::Panel(PanelKind::Tasks) = overlay.kind else {
        return None;
    };
    let selected = selected_panel_data_index(overlay)?;
    overlay.snapshot.as_ref()?.tasks.get(selected).cloned()
}

fn selected_memory_path(
    memory: &bitfun_core::command::agentic_os::AgenticOsMemoryRow,
) -> std::path::PathBuf {
    std::path::Path::new(&memory.target).join(&memory.file)
}

pub fn selected_panel_detail(overlay: &OverlayState) -> Option<String> {
    let OverlayKind::Panel(kind) = overlay.kind else {
        return None;
    };
    let snapshot = overlay.snapshot.as_ref()?;
    let selected = selected_panel_data_index(overlay)?;
    match kind {
        PanelKind::Sessions => snapshot.sessions.get(selected).map(|session| {
            format!(
                "Session detail\nType: {}\nTitle: {}\nAgent: {}\nSession: {}\nWorkspace: {}\nTurns: {}\nChild tasks: {}\nLast active: {}",
                if session.is_dispatch_task {
                    "dispatch task"
                } else {
                    "session"
                },
                session.title,
                session.agent,
                session.id,
                session.workspace.as_deref().unwrap_or("global"),
                session.turns,
                session.child_count,
                session.last_active_at
            )
        }),
        PanelKind::Tasks => snapshot.tasks.get(selected).map(|task| {
            format!(
                "Task detail\nTitle: {}\nAgent: {}\nStatus: {}\nDetail: {}\nSession: {}\nWorkspace: {}",
                task.title,
                task.agent,
                task.status,
                task.detail,
                task.session_id.as_deref().unwrap_or("none"),
                task.workspace.as_deref().unwrap_or("global")
            )
        }),
        PanelKind::Apps => snapshot.apps.get(selected).map(|app| {
            format!(
                "App detail\nName: {}\nKind: {}\nId: {}\nCapability: {}\nTarget: {}\nDescription: {}",
                app.name,
                app.kind,
                app.id,
                app.capability,
                app.target.as_deref().unwrap_or("not available"),
                app.description
            )
        }),
        PanelKind::Settings => match selected {
            0 => Some(format!(
                "Model settings\nCurrent model: {}\nInspect: sparo config show --path ai.default_models",
                snapshot.model
            )),
            1 => Some(format!(
                "Workspace settings\nCurrent workspace: {}\nInspect: sparo config prefs get workspace.default_path --json\nChange: sparo workspaces use <label-or-path>",
                snapshot.current_workspace.as_deref().unwrap_or("global")
            )),
            2 => Some(format!(
                "Git context\nCurrent branch: {}\nInspect: sparo workspaces show {}",
                snapshot.git_branch.as_deref().unwrap_or("no-git"),
                shell_arg(snapshot.current_workspace.as_deref().unwrap_or("global"))
            )),
            3 => Some(
                "CLI health\nInspect: sparo health --json\nCovers: data paths, config files, workspace storage, logs, and repair hints"
                    .to_string(),
            ),
            4 => Some(
                "Data storage\nInspect: sparo health --json\nSessions: sparo sessions list\nMemory: sparo memory list"
                    .to_string(),
            ),
            _ => None,
        },
        PanelKind::Workspaces => snapshot.workspaces.get(selected).map(|workspace| {
            let current =
                workspace_current_label(workspace.path.as_deref(), snapshot.current_workspace.as_deref());
            format!(
                "Workspace detail\nLabel: {}\nCurrent: {}\nPath: {}\nGit: {}\nSessions: {}",
                workspace.label,
                if current.is_empty() { "no" } else { "yes" },
                workspace
                    .path
                    .as_deref()
                    .unwrap_or("Agentic OS global runtime"),
                workspace.git.as_deref().unwrap_or("no-git"),
                workspace.session_count
            )
        }),
        PanelKind::Memory => snapshot.memories.get(selected).map(|memory| {
            let path = selected_memory_path(memory).to_string_lossy().to_string();
            format!(
                "Memory detail\nScope: {}\nFile: {}\nPath: {}\nTarget: {}",
                memory.scope, memory.file, path, memory.target
            )
        }),
    }
}

fn selected_panel_preview(overlay: &OverlayState, width: usize) -> Option<String> {
    let OverlayKind::Panel(kind) = overlay.kind else {
        return None;
    };
    let snapshot = overlay.snapshot.as_ref()?;
    let selected = selected_panel_data_index(overlay)?;
    let preview = match kind {
        PanelKind::Sessions => {
            let session = snapshot.sessions.get(selected)?;
            format!(
                "{} - {} - {} turns - {}",
                if session.is_dispatch_task {
                    "task"
                } else {
                    "session"
                },
                session.agent,
                session.turns,
                session.workspace.as_deref().unwrap_or("global")
            )
        }
        PanelKind::Tasks => {
            let task = snapshot.tasks.get(selected)?;
            format!(
                "{} - {} - {} - {}",
                task.status,
                task.agent,
                task.session_id.as_deref().unwrap_or("no session"),
                task.detail
            )
        }
        PanelKind::Apps => {
            let app = snapshot.apps.get(selected)?;
            format!(
                "{} - {} - {}",
                app.kind,
                app.capability,
                app_target_label(app.target.as_deref())
            )
        }
        PanelKind::Memory => {
            let memory = snapshot.memories.get(selected)?;
            format!("{} - {} - preview", memory.scope, memory.file)
        }
        PanelKind::Workspaces => {
            let workspace = snapshot.workspaces.get(selected)?;
            let current = workspace_current_label(
                workspace.path.as_deref(),
                snapshot.current_workspace.as_deref(),
            );
            let current_prefix = if current.is_empty() { "" } else { "current - " };
            format!(
                "{}{} - {} sessions - {}",
                current_prefix,
                workspace.git.as_deref().unwrap_or("no-git"),
                workspace.session_count,
                workspace
                    .path
                    .as_deref()
                    .unwrap_or("Agentic OS global runtime")
            )
        }
        PanelKind::Settings => match selected {
            0 => format!("model - {}", snapshot.model),
            1 => format!(
                "workspace - {}",
                snapshot.current_workspace.as_deref().unwrap_or("global")
            ),
            2 => format!(
                "git - {}",
                snapshot.git_branch.as_deref().unwrap_or("no-git")
            ),
            3 => "health - paths, config, storage, logs".to_string(),
            4 => "data - sessions, memory, storage".to_string(),
            _ => return None,
        },
    };
    Some(compact_inline_text(&preview, width))
}

pub fn selected_workspace(overlay: &OverlayState) -> Option<Option<String>> {
    let OverlayKind::Panel(PanelKind::Workspaces) = overlay.kind else {
        return None;
    };
    let selected = selected_panel_data_index(overlay)?;
    overlay
        .snapshot
        .as_ref()?
        .workspaces
        .get(selected)
        .map(|workspace| workspace.path.clone())
}

#[cfg(test)]
fn panel_rows(
    kind: PanelKind,
    snapshot: Option<&AgenticOsSnapshot>,
    theme: &Theme,
) -> Vec<ListItem<'static>> {
    panel_rows_for_width(kind, snapshot, theme, 94, "")
}

fn panel_rows_for_width(
    kind: PanelKind,
    snapshot: Option<&AgenticOsSnapshot>,
    theme: &Theme,
    content_width: usize,
    filter: &str,
) -> Vec<ListItem<'static>> {
    let Some(snapshot) = snapshot else {
        return vec![ListItem::new(Line::from(Span::styled(
            "Loading...",
            theme.style(StyleKind::Muted),
        )))];
    };
    if panel_filter_active(filter) && panel_match_count(kind, Some(snapshot), filter) == 0 {
        return no_matching_panel_rows(kind, theme, filter);
    }

    let filtered_snapshot = filtered_snapshot_for_panel(kind, snapshot, filter);
    let snapshot = &filtered_snapshot;

    if content_width < 56 {
        return compact_panel_rows(kind, snapshot, theme, content_width, filter);
    }

    match kind {
        PanelKind::Sessions => {
            if snapshot.sessions.is_empty() {
                return empty_panel_rows(
                    theme,
                    "No saved sessions found.",
                    "Run `sparo sessions list`; start with `sparo chat`; use `sparo health` if history is missing.",
                );
            }
            let rows = snapshot
                .sessions
                .iter()
                .map(|session| {
                    let kind = if session.is_dispatch_task {
                        "task"
                    } else {
                        "session"
                    };
                    let last_active = format_session_time(session.last_active_at);
                    let child = if session.child_count > 0 {
                        format!(" | {} child", session.child_count)
                    } else {
                        String::new()
                    };
                    ListItem::new(Line::from(vec![
                        Span::styled(
                            format!("{:<22}", compact_inline_text(&session.title, 22)),
                            theme.style(StyleKind::Title),
                        ),
                        Span::styled(format!("{:<8}", kind), theme.style(StyleKind::Faint)),
                        Span::styled(
                            format!("{:<12}", compact_inline_text(&session.agent, 12)),
                            theme.style(StyleKind::Muted),
                        ),
                        Span::styled(
                            format!("{:<12}", last_active),
                            theme.style(StyleKind::Faint),
                        ),
                        Span::styled(
                            format!("{} turns{}", session.turns, child),
                            theme.style(StyleKind::Faint),
                        ),
                    ]))
                })
                .collect::<Vec<_>>();
            with_panel_header(PanelKind::Sessions, theme, rows)
        }
        PanelKind::Tasks => {
            if snapshot.tasks.is_empty() {
                return empty_panel_rows(
                    theme,
                    "No backend-tracked agent tasks found.",
                    "Run `sparo tasks list`; start with `sparo chat`; use `sparo health` if tasks are missing.",
                );
            }
            let rows = snapshot
                .tasks
                .iter()
                .map(|task| {
                    let session = task_session_label(task.session_id.as_deref());
                    ListItem::new(Line::from(vec![
                        Span::styled(
                            format!("{:<10}", compact_inline_text(&task.status, 10)),
                            theme.style(StyleKind::Primary),
                        ),
                        Span::styled(
                            format!("{:<24}", compact_inline_text(&task.title, 24)),
                            theme.style(StyleKind::Title),
                        ),
                        Span::styled(
                            format!("{:<12}", compact_inline_text(&task.agent, 12)),
                            theme.style(StyleKind::Muted),
                        ),
                        Span::styled(
                            format!("{:<16}", compact_inline_text(session, 16)),
                            theme.style(StyleKind::Faint),
                        ),
                        Span::styled(
                            compact_text(&task.detail, 26),
                            theme.style(StyleKind::Muted),
                        ),
                    ]))
                })
                .collect::<Vec<_>>();
            with_panel_header(PanelKind::Tasks, theme, rows)
        }
        PanelKind::Apps => {
            if snapshot.apps.is_empty() {
                return empty_panel_rows(
                    theme,
                    "No Agent, Live, or Bridge Apps are available in this snapshot.",
                    "Run `sparo apps list`; inspect `sparo tool schema CreateAgentApp --json` or `InitLiveApp --json`.",
                );
            }
            let rows = snapshot
                .apps
                .iter()
                .map(|app| {
                    let target_label = app_target_label(app.target.as_deref());
                    ListItem::new(Line::from(vec![
                        Span::styled(
                            format!("{:<10}", compact_inline_text(&app.kind, 10)),
                            theme.style(StyleKind::Muted),
                        ),
                        Span::styled(
                            format!("{:<22}", compact_inline_text(&app.name, 22)),
                            theme.style(StyleKind::Title),
                        ),
                        Span::styled(
                            format!("{:<9}", target_label),
                            theme.style(StyleKind::Primary),
                        ),
                        Span::styled(
                            format!("{:<28}", compact_inline_text(&app.description, 28)),
                            theme.style(StyleKind::Text),
                        ),
                        Span::styled(
                            compact_text(&app.capability, 20),
                            theme.style(StyleKind::Faint),
                        ),
                    ]))
                })
                .collect::<Vec<_>>();
            with_panel_header(PanelKind::Apps, theme, rows)
        }
        PanelKind::Memory => {
            if snapshot.memories.is_empty() {
                return empty_panel_rows(
                    theme,
                    "No memory files are available in this snapshot.",
                    "Run `sparo memory list`; add notes under .sparo_os/memory; use `sparo health` if memory is missing.",
                );
            }
            let rows = snapshot
                .memories
                .iter()
                .map(|memory| {
                    ListItem::new(Line::from(vec![
                        Span::styled(
                            format!("{:<9}", compact_inline_text(&memory.scope, 9)),
                            theme.style(StyleKind::Muted),
                        ),
                        Span::styled(
                            format!("{:<26}", compact_inline_text(&memory.file, 26)),
                            theme.style(StyleKind::Title),
                        ),
                        Span::styled(
                            format!("{:<10}", "preview"),
                            theme.style(StyleKind::Primary),
                        ),
                        Span::styled(
                            compact_text(&memory.target, 34),
                            theme.style(StyleKind::Faint),
                        ),
                    ]))
                })
                .collect::<Vec<_>>();
            with_panel_header(PanelKind::Memory, theme, rows)
        }
        PanelKind::Workspaces => {
            if snapshot.workspaces.is_empty() {
                return empty_panel_rows(
                    theme,
                    "No known workspaces found.",
                    "Run `sparo workspaces list`; from a project run `sparo workspaces use .`.",
                );
            }
            let rows = snapshot
                .workspaces
                .iter()
                .map(|workspace| {
                    let current = workspace_current_label(
                        workspace.path.as_deref(),
                        snapshot.current_workspace.as_deref(),
                    );
                    let path = workspace
                        .path
                        .as_deref()
                        .unwrap_or("Agentic OS global runtime");
                    let git = workspace.git.as_deref().unwrap_or("no-git");
                    ListItem::new(Line::from(vec![
                        Span::styled(format!("{:<8}", current), theme.style(StyleKind::Primary)),
                        Span::styled(
                            format!("{:<18}", compact_inline_text(&workspace.label, 18)),
                            theme.style(StyleKind::Title),
                        ),
                        Span::styled(
                            format!("{:<28}", compact_inline_text(path, 28)),
                            theme.style(StyleKind::Muted),
                        ),
                        Span::styled(
                            format!("{:<16}", compact_inline_text(git, 16)),
                            theme.style(StyleKind::Faint),
                        ),
                        Span::styled(
                            format!("{} sessions", workspace.session_count),
                            theme.style(StyleKind::Faint),
                        ),
                    ]))
                })
                .collect::<Vec<_>>();
            with_panel_header(PanelKind::Workspaces, theme, rows)
        }
        PanelKind::Settings => {
            let rows = vec![
                ListItem::new(Line::from(vec![
                    Span::styled("MODEL      ", theme.style(StyleKind::Muted)),
                    Span::styled("inspect   ", theme.style(StyleKind::Primary)),
                    Span::styled(
                        compact_inline_text(&snapshot.model, 44),
                        theme.style(StyleKind::Title),
                    ),
                ])),
                ListItem::new(Line::from(vec![
                    Span::styled("WORKSPACE  ", theme.style(StyleKind::Muted)),
                    Span::styled("select    ", theme.style(StyleKind::Primary)),
                    Span::styled(
                        compact_inline_text(
                            snapshot.current_workspace.as_deref().unwrap_or("global"),
                            44,
                        ),
                        theme.style(StyleKind::Title),
                    ),
                ])),
                ListItem::new(Line::from(vec![
                    Span::styled("GIT        ", theme.style(StyleKind::Muted)),
                    Span::styled("context   ", theme.style(StyleKind::Primary)),
                    Span::styled(
                        compact_inline_text(snapshot.git_branch.as_deref().unwrap_or("no-git"), 44),
                        theme.style(StyleKind::Title),
                    ),
                ])),
                ListItem::new(Line::from(vec![
                    Span::styled("HEALTH     ", theme.style(StyleKind::Muted)),
                    Span::styled("diagnose  ", theme.style(StyleKind::Primary)),
                    Span::styled("sparo health --json", theme.style(StyleKind::Title)),
                ])),
                ListItem::new(Line::from(vec![
                    Span::styled("DATA       ", theme.style(StyleKind::Muted)),
                    Span::styled("inspect   ", theme.style(StyleKind::Primary)),
                    Span::styled("sessions, memory, storage", theme.style(StyleKind::Title)),
                ])),
            ]
            .into_iter()
            .enumerate()
            .filter_map(|(index, row)| {
                searchable_matches(filter, settings_search_terms(index)).then_some(row)
            })
            .collect::<Vec<_>>();
            with_panel_header(PanelKind::Settings, theme, rows)
        }
    }
}

fn with_panel_header(
    kind: PanelKind,
    theme: &Theme,
    mut rows: Vec<ListItem<'static>>,
) -> Vec<ListItem<'static>> {
    rows.insert(0, panel_header_row(kind, theme));
    rows
}

fn compact_panel_rows(
    kind: PanelKind,
    snapshot: &AgenticOsSnapshot,
    theme: &Theme,
    content_width: usize,
    filter: &str,
) -> Vec<ListItem<'static>> {
    if panel_filter_active(filter) && panel_match_count(kind, Some(snapshot), filter) == 0 {
        return no_matching_panel_rows(kind, theme, filter);
    }

    let value_width = content_width.saturating_sub(18).clamp(8, 28);
    let context_width = content_width.saturating_sub(value_width + 8).clamp(6, 18);

    let rows = match kind {
        PanelKind::Sessions => {
            if snapshot.sessions.is_empty() {
                return empty_panel_rows(
                    theme,
                    "No saved sessions found.",
                    "Run `sparo sessions list`; start with `sparo chat`; use `sparo health` if history is missing.",
                );
            }
            snapshot
                .sessions
                .iter()
                .map(|session| {
                    let kind = if session.is_dispatch_task {
                        "task"
                    } else {
                        "session"
                    };
                    ListItem::new(Line::from(vec![
                        Span::styled(
                            format!(
                                "{:<value_width$}",
                                compact_inline_text(&session.title, value_width)
                            ),
                            theme.style(StyleKind::Title),
                        ),
                        Span::styled(
                            format!(" {:<7}", compact_inline_text(kind, 7)),
                            theme.style(StyleKind::Faint),
                        ),
                        Span::styled(
                            compact_inline_text(&format!("{}t", session.turns), context_width),
                            theme.style(StyleKind::Muted),
                        ),
                    ]))
                })
                .collect::<Vec<_>>()
        }
        PanelKind::Tasks => {
            if snapshot.tasks.is_empty() {
                return empty_panel_rows(
                    theme,
                    "No backend-tracked agent tasks found.",
                    "Run `sparo tasks list`; start with `sparo chat`; use `sparo health` if tasks are missing.",
                );
            }
            let title_width = content_width.saturating_sub(26).clamp(8, 20);
            let session_width = content_width.saturating_sub(title_width + 12).clamp(10, 18);
            snapshot
                .tasks
                .iter()
                .map(|task| {
                    ListItem::new(Line::from(vec![
                        Span::styled(
                            format!("{:<10}", compact_inline_text(&task.status, 10)),
                            theme.style(StyleKind::Primary),
                        ),
                        Span::styled(
                            format!(
                                "{:<title_width$}",
                                compact_inline_text(&task.title, title_width)
                            ),
                            theme.style(StyleKind::Title),
                        ),
                        Span::styled(
                            compact_inline_text(
                                task_session_label(task.session_id.as_deref()),
                                session_width,
                            ),
                            theme.style(StyleKind::Faint),
                        ),
                    ]))
                })
                .collect::<Vec<_>>()
        }
        PanelKind::Apps => {
            if snapshot.apps.is_empty() {
                return empty_panel_rows(
                    theme,
                    "No Agent, Live, or Bridge Apps are available in this snapshot.",
                    "Run `sparo apps list`; inspect `sparo tool schema CreateAgentApp --json` or `InitLiveApp --json`.",
                );
            }
            snapshot
                .apps
                .iter()
                .map(|app| {
                    ListItem::new(Line::from(vec![
                        Span::styled(
                            format!(
                                "{:<value_width$}",
                                compact_inline_text(&app.name, value_width)
                            ),
                            theme.style(StyleKind::Title),
                        ),
                        Span::styled(
                            format!(" {:<8}", app_target_label(app.target.as_deref())),
                            theme.style(StyleKind::Primary),
                        ),
                        Span::styled(
                            compact_inline_text(&app.kind, context_width),
                            theme.style(StyleKind::Muted),
                        ),
                    ]))
                })
                .collect::<Vec<_>>()
        }
        PanelKind::Memory => {
            if snapshot.memories.is_empty() {
                return empty_panel_rows(
                    theme,
                    "No memory files are available in this snapshot.",
                    "Run `sparo memory list`; add notes under .sparo_os/memory; use `sparo health` if memory is missing.",
                );
            }
            snapshot
                .memories
                .iter()
                .map(|memory| {
                    ListItem::new(Line::from(vec![
                        Span::styled(
                            format!("{:<9}", compact_inline_text(&memory.scope, 9)),
                            theme.style(StyleKind::Muted),
                        ),
                        Span::styled(
                            format!(
                                "{:<value_width$}",
                                compact_inline_text(&memory.file, value_width)
                            ),
                            theme.style(StyleKind::Title),
                        ),
                        Span::styled("preview", theme.style(StyleKind::Primary)),
                    ]))
                })
                .collect::<Vec<_>>()
        }
        PanelKind::Workspaces => {
            if snapshot.workspaces.is_empty() {
                return empty_panel_rows(
                    theme,
                    "No known workspaces found.",
                    "Run `sparo workspaces list`; from a project run `sparo workspaces use .`.",
                );
            }
            snapshot
                .workspaces
                .iter()
                .map(|workspace| {
                    ListItem::new(Line::from(vec![
                        Span::styled(
                            format!(
                                "{:<value_width$}",
                                compact_inline_text(&workspace.label, value_width)
                            ),
                            theme.style(StyleKind::Title),
                        ),
                        Span::styled(
                            format!(
                                " {:<context_width$}",
                                compact_inline_text(
                                    workspace.git.as_deref().unwrap_or("no-git"),
                                    context_width
                                ),
                                context_width = context_width
                            ),
                            theme.style(StyleKind::Faint),
                        ),
                        Span::styled(
                            format!("{}s", workspace.session_count),
                            theme.style(StyleKind::Muted),
                        ),
                    ]))
                })
                .collect::<Vec<_>>()
        }
        PanelKind::Settings => {
            let rows = vec![
                compact_setting_row(theme, "MODEL", "inspect", &snapshot.model, value_width),
                compact_setting_row(
                    theme,
                    "WKSPC",
                    "select",
                    snapshot.current_workspace.as_deref().unwrap_or("global"),
                    value_width,
                ),
                compact_setting_row(
                    theme,
                    "GIT",
                    "context",
                    snapshot.git_branch.as_deref().unwrap_or("no-git"),
                    value_width,
                ),
                compact_setting_row(theme, "HEALTH", "diagnose", "sparo health", value_width),
                compact_setting_row(theme, "DATA", "inspect", "sessions/memory", value_width),
            ];
            rows.into_iter()
                .enumerate()
                .filter_map(|(index, row)| {
                    searchable_matches(filter, settings_search_terms(index)).then_some(row)
                })
                .collect()
        }
    };

    with_compact_panel_header(kind, theme, rows)
}

fn compact_setting_row(
    theme: &Theme,
    key: &'static str,
    action: &'static str,
    value: &str,
    value_width: usize,
) -> ListItem<'static> {
    ListItem::new(Line::from(vec![
        Span::styled(format!("{:<7}", key), theme.style(StyleKind::Muted)),
        Span::styled(format!("{:<9}", action), theme.style(StyleKind::Primary)),
        Span::styled(
            compact_inline_text(value, value_width),
            theme.style(StyleKind::Title),
        ),
    ]))
}

fn with_compact_panel_header(
    kind: PanelKind,
    theme: &Theme,
    mut rows: Vec<ListItem<'static>>,
) -> Vec<ListItem<'static>> {
    rows.insert(0, compact_panel_header_row(kind, theme));
    rows
}

fn compact_panel_header_row(kind: PanelKind, theme: &Theme) -> ListItem<'static> {
    ListItem::new(Line::from(Span::styled(
        compact_panel_header_text(kind),
        theme.style(StyleKind::Faint),
    )))
}

fn compact_panel_header_text(kind: PanelKind) -> &'static str {
    match kind {
        PanelKind::Sessions => "item  type  ctx",
        PanelKind::Tasks => "status  item  session",
        PanelKind::Apps => "app  action  kind",
        PanelKind::Memory => "scope  file  action",
        PanelKind::Workspaces => "now  workspace  git  sessions",
        PanelKind::Settings => "setting  action  value",
    }
}

fn panel_header_row(kind: PanelKind, theme: &Theme) -> ListItem<'static> {
    ListItem::new(Line::from(Span::styled(
        panel_header_text(kind),
        theme.style(StyleKind::Faint),
    )))
}

fn panel_header_text(kind: PanelKind) -> &'static str {
    match kind {
        PanelKind::Sessions => "title  type  agent  active  activity",
        PanelKind::Tasks => "status  title  agent  session  detail",
        PanelKind::Apps => "kind  name  action  desc  cap",
        PanelKind::Memory => "scope  file  action  target",
        PanelKind::Workspaces => "now  workspace  path  git  sessions",
        PanelKind::Settings => "setting    action    value",
    }
}

fn empty_panel_rows(
    theme: &Theme,
    message: impl Into<String>,
    next_action: impl Into<String>,
) -> Vec<ListItem<'static>> {
    vec![
        ListItem::new(Line::from(Span::styled(
            message.into(),
            theme.style(StyleKind::Muted),
        ))),
        ListItem::new(Line::from(Span::styled(
            next_action.into(),
            theme.style(StyleKind::Faint),
        ))),
    ]
}

fn app_target_label(target: Option<&str>) -> &'static str {
    if target.is_some() {
        "open"
    } else {
        "inspect"
    }
}

fn workspace_current_label(path: Option<&str>, current_workspace: Option<&str>) -> &'static str {
    match (path, current_workspace) {
        (Some(path), Some(current)) if same_workspace_path(path, current) => "current",
        (None, None) => "current",
        _ => "",
    }
}

fn same_workspace_path(left: &str, right: &str) -> bool {
    let left = left.replace('\\', "/");
    let right = right.replace('\\', "/");
    left.eq_ignore_ascii_case(&right)
}

fn task_session_label(session_id: Option<&str>) -> &str {
    session_id.unwrap_or("no-session")
}

fn format_session_time(timestamp_ms: u64) -> String {
    chrono::DateTime::<chrono::Local>::from(
        std::time::UNIX_EPOCH + std::time::Duration::from_millis(timestamp_ms),
    )
    .format("%m-%d %H:%M")
    .to_string()
}

fn overlay_block<'a>(title: &'a str, theme: &Theme) -> Block<'a> {
    Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Plain)
        .title(Span::styled(
            format!(" // {} ", title),
            theme.style(StyleKind::Primary),
        ))
        .border_style(theme.style(StyleKind::Border))
}

fn overlay_popup(area: Rect, max_width: u16, max_height: u16) -> Rect {
    let horizontal_gutter = if area.width >= 108 {
        12
    } else if area.width >= 72 {
        6
    } else if area.width >= 44 {
        2
    } else {
        0
    };
    let vertical_gutter = if area.height >= 28 {
        4
    } else if area.height >= 14 {
        2
    } else {
        0
    };
    let width = max_width
        .min(area.width.saturating_sub(horizontal_gutter))
        .max(area.width.min(24));
    let height = max_height
        .min(area.height.saturating_sub(vertical_gutter))
        .max(area.height.min(8));

    centered_popup(area, width, height)
}

fn centered_popup(area: Rect, width: u16, height: u16) -> Rect {
    Rect {
        x: area.x + area.width.saturating_sub(width) / 2,
        y: area.y + area.height.saturating_sub(height) / 2,
        width,
        height,
    }
}

fn overlay_content_area(popup: Rect) -> Rect {
    popup.inner(Margin {
        horizontal: if popup.width >= 56 { 2 } else { 1 },
        vertical: 1,
    })
}

fn overlay_selection_style(theme: &Theme) -> Style {
    theme.style(StyleKind::Title)
}

fn render_overlay_separator(frame: &mut Frame, theme: &Theme, y: u16, content: Rect) {
    if content.height < 4 {
        return;
    }

    let separator_area = Rect {
        x: content.x,
        y,
        width: content.width,
        height: 1,
    };
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            "-".repeat(content.width as usize),
            theme.style(StyleKind::Faint),
        ))),
        separator_area,
    );
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

pub fn jump_selection(overlay: &mut OverlayState, target: SelectionJump, item_count: usize) {
    if item_count == 0 {
        overlay.selected = 0;
        return;
    }

    let last = item_count.saturating_sub(1);
    overlay.selected = match target {
        SelectionJump::First => 0,
        SelectionJump::Last => last,
        SelectionJump::PageUp(page_size) => overlay.selected.saturating_sub(page_size.max(1)),
        SelectionJump::PageDown(page_size) => {
            overlay.selected.saturating_add(page_size.max(1)).min(last)
        }
    };
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectionJump {
    First,
    Last,
    PageUp(usize),
    PageDown(usize),
}

pub fn command_count(scope: CommandScope, filter: &str) -> usize {
    filtered_commands(scope, filter).len()
}

pub fn panel_count(overlay: &OverlayState) -> usize {
    match overlay.kind {
        OverlayKind::Panel(kind) => {
            panel_match_count(kind, overlay.snapshot.as_ref(), &overlay.filter)
        }
        _ => 0,
    }
}

fn snapshot_panel_count(kind: PanelKind, snapshot: Option<&AgenticOsSnapshot>) -> usize {
    let Some(snapshot) = snapshot else {
        return 0;
    };
    match kind {
        PanelKind::Sessions => snapshot.sessions.len(),
        PanelKind::Tasks => snapshot.tasks.len(),
        PanelKind::Apps => snapshot.apps.len(),
        PanelKind::Memory => snapshot.memories.len(),
        PanelKind::Workspaces => snapshot.workspaces.len(),
        PanelKind::Settings => 5,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitfun_core::command::agentic_os::{
        AgenticOsAppRow, AgenticOsMemoryRow, AgenticOsSessionRow, AgenticOsSnapshot,
        AgenticOsTaskRow, AgenticOsWorkspaceRow,
    };
    use ratatui::{backend::TestBackend, buffer::Buffer, style::Color, Terminal};

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
                last_active_at: 1_700_000_000_000,
            }],
            tasks: vec![AgenticOsTaskRow {
                title: "Fix bug".to_string(),
                agent: "debug".to_string(),
                status: "active".to_string(),
                detail: "2 turns".to_string(),
                session_id: Some("task-session".to_string()),
                workspace: Some("D:\\workspace\\project".to_string()),
            }],
            apps: vec![AgenticOsAppRow {
                id: "files".to_string(),
                name: "Files".to_string(),
                kind: "AGENT APP".to_string(),
                description: "Browse files".to_string(),
                capability: "read write".to_string(),
                target: None,
            }],
            memories: vec![AgenticOsMemoryRow {
                scope: "PROJECT".to_string(),
                file: "notes.md".to_string(),
                target: "D:\\workspace\\project\\.sparo_os".to_string(),
            }],
            workspaces: vec![AgenticOsWorkspaceRow {
                label: "project".to_string(),
                path: Some("D:\\workspace\\project".to_string()),
                git: Some("git main".to_string()),
                session_count: 1,
            }],
        }
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

    fn render_overlay_text(
        overlay: &mut OverlayState,
        scope: CommandScope,
        width: u16,
        height: u16,
    ) -> String {
        let backend = TestBackend::new(width, height);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| render_overlay(frame, frame.area(), &Theme::dark(), overlay, scope))
            .unwrap();
        buffer_text(terminal.backend().buffer())
    }

    fn render_overlay_buffer(
        overlay: &mut OverlayState,
        scope: CommandScope,
        width: u16,
        height: u16,
    ) -> Buffer {
        let backend = TestBackend::new(width, height);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| render_overlay(frame, frame.area(), &Theme::dark(), overlay, scope))
            .unwrap();
        terminal.backend().buffer().clone()
    }

    #[test]
    fn apps_panel_marks_openable_apps() {
        let mut inspect_only = sample_snapshot();
        let inspect_rendered = format!(
            "{:?}",
            panel_rows(PanelKind::Apps, Some(&inspect_only), &Theme::dark())
        );
        assert!(inspect_rendered.contains("inspect"));
        assert!(!inspect_rendered.contains("open     "));

        inspect_only.apps[0].target = Some("D:\\apps\\files".to_string());
        let open_rendered = format!(
            "{:?}",
            panel_rows(PanelKind::Apps, Some(&inspect_only), &Theme::dark())
        );
        assert!(open_rendered.contains("open"));
    }

    #[test]
    fn tasks_panel_exposes_session_context() {
        let mut snapshot = sample_snapshot();
        let rendered = format!(
            "{:?}",
            panel_rows(PanelKind::Tasks, Some(&snapshot), &Theme::dark())
        );
        assert!(rendered.contains("task-session"));

        snapshot.tasks[0].session_id = None;
        let no_session_rendered = format!(
            "{:?}",
            panel_rows(PanelKind::Tasks, Some(&snapshot), &Theme::dark())
        );
        assert!(no_session_rendered.contains("no-session"));
    }

    #[test]
    fn memory_panel_marks_preview_action() {
        let rendered = format!(
            "{:?}",
            panel_rows(PanelKind::Memory, Some(&sample_snapshot()), &Theme::dark())
        );

        assert!(rendered.contains("PROJECT"));
        assert!(rendered.contains("notes.md"));
        assert!(rendered.contains("preview"));
    }

    #[test]
    fn selected_panel_detail_summarizes_apps_and_tasks() {
        let snapshot = sample_snapshot();
        let session_overlay = OverlayState::panel(PanelKind::Sessions, snapshot.clone());
        let task_overlay = OverlayState::panel(PanelKind::Tasks, snapshot.clone());
        let app_overlay = OverlayState::panel(PanelKind::Apps, snapshot.clone());
        let memory_overlay = OverlayState::panel(PanelKind::Memory, snapshot.clone());
        let settings_overlay = OverlayState::panel(PanelKind::Settings, snapshot);
        let workspace_overlay = OverlayState::panel(PanelKind::Workspaces, sample_snapshot());

        assert!(selected_panel_detail(&session_overlay)
            .unwrap()
            .contains("Session detail"));
        assert!(selected_panel_detail(&session_overlay)
            .unwrap()
            .contains("Type: session"));
        assert!(selected_panel_detail(&task_overlay)
            .unwrap()
            .contains("Task detail"));
        assert!(selected_panel_detail(&app_overlay)
            .unwrap()
            .contains("App detail"));
        assert!(selected_panel_detail(&memory_overlay)
            .unwrap()
            .contains("Memory detail"));
        assert!(selected_panel_detail(&memory_overlay)
            .unwrap()
            .contains("Scope: PROJECT"));
        assert!(selected_panel_detail(&memory_overlay)
            .unwrap()
            .contains("Target: D:\\workspace\\project\\.sparo_os"));
        assert!(selected_panel_detail(&memory_overlay)
            .unwrap()
            .contains("Path: D:\\workspace\\project\\.sparo_os\\notes.md"));
        assert!(selected_panel_detail(&settings_overlay)
            .unwrap()
            .contains("Model settings"));
        assert!(selected_panel_detail(&workspace_overlay)
            .unwrap()
            .contains("Workspace detail"));
        assert!(selected_panel_detail(&workspace_overlay)
            .unwrap()
            .contains("Sessions: 1"));
    }

    #[test]
    fn selected_settings_detail_matches_selected_row() {
        let mut overlay = OverlayState::panel(PanelKind::Settings, sample_snapshot());

        assert!(selected_panel_detail(&overlay)
            .unwrap()
            .contains("Model settings"));
        assert!(selected_panel_detail(&overlay)
            .unwrap()
            .contains("ai.default_models"));

        overlay.selected = 1;
        assert!(selected_panel_detail(&overlay)
            .unwrap()
            .contains("Workspace settings"));
        assert!(selected_panel_detail(&overlay)
            .unwrap()
            .contains("workspace.default_path"));

        overlay.selected = 2;
        assert!(selected_panel_detail(&overlay)
            .unwrap()
            .contains("Git context"));
        assert!(selected_panel_detail(&overlay)
            .unwrap()
            .contains("sparo workspaces show D:\\workspace\\project"));

        overlay.selected = 3;
        assert!(selected_panel_detail(&overlay)
            .unwrap()
            .contains("CLI health"));
        assert!(selected_panel_detail(&overlay)
            .unwrap()
            .contains("sparo health --json"));

        overlay.selected = 4;
        assert!(selected_panel_detail(&overlay)
            .unwrap()
            .contains("Data storage"));
        assert!(selected_panel_detail(&overlay)
            .unwrap()
            .contains("sparo memory list"));

        overlay.selected = 5;
        assert!(selected_panel_detail(&overlay).is_none());
    }

    #[test]
    fn settings_panel_marks_row_actions() {
        let rendered = format!(
            "{:?}",
            panel_rows(
                PanelKind::Settings,
                Some(&sample_snapshot()),
                &Theme::dark()
            )
        );

        assert!(rendered.contains("inspect"));
        assert!(rendered.contains("select"));
        assert!(rendered.contains("context"));
        assert!(rendered.contains("diagnose"));
        assert!(rendered.contains("DATA"));
        assert!(rendered.contains("sessions, memory, storage"));
    }

    #[test]
    fn settings_compact_rows_keep_workspace_label_clear() {
        let rendered = format!(
            "{:?}",
            panel_rows_for_width(
                PanelKind::Settings,
                Some(&sample_snapshot()),
                &Theme::dark(),
                42,
                ""
            )
        );

        assert!(rendered.contains("WKSPC"));
        assert!(rendered.contains("select"));
        assert!(!rendered.contains("\"WORK\""));
    }

    #[test]
    fn sessions_panel_marks_dispatch_tasks() {
        let mut snapshot = sample_snapshot();
        snapshot.sessions[0].is_dispatch_task = true;

        let rendered = format!(
            "{:?}",
            panel_rows(PanelKind::Sessions, Some(&snapshot), &Theme::dark())
        );
        let overlay = OverlayState::panel(PanelKind::Sessions, snapshot);

        assert!(rendered.contains("task"));
        assert!(selected_panel_detail(&overlay)
            .unwrap()
            .contains("Type: dispatch task"));
    }

    #[test]
    fn sessions_panel_exposes_last_active_time() {
        let rendered = format!(
            "{:?}",
            panel_rows(
                PanelKind::Sessions,
                Some(&sample_snapshot()),
                &Theme::dark()
            )
        );

        assert!(rendered.contains(&format_session_time(1_700_000_000_000)));
    }

    #[test]
    fn workspaces_panel_exposes_git_context() {
        let rendered = format!(
            "{:?}",
            panel_rows(
                PanelKind::Workspaces,
                Some(&sample_snapshot()),
                &Theme::dark()
            )
        );

        assert!(rendered.contains("git main"));
        assert!(rendered.contains("1 sessions"));
        assert!(rendered.contains("current"));
    }

    #[test]
    fn empty_panel_rows_include_next_actions() {
        let apps_snapshot = AgenticOsSnapshot {
            apps: Vec::new(),
            ..sample_snapshot()
        };
        let tasks_snapshot = AgenticOsSnapshot {
            tasks: Vec::new(),
            ..sample_snapshot()
        };
        let sessions_snapshot = AgenticOsSnapshot {
            sessions: Vec::new(),
            ..sample_snapshot()
        };
        let memory_snapshot = AgenticOsSnapshot {
            memories: Vec::new(),
            ..sample_snapshot()
        };
        let workspaces_snapshot = AgenticOsSnapshot {
            workspaces: Vec::new(),
            ..sample_snapshot()
        };
        let rendered = format!(
            "{:?}{:?}{:?}{:?}{:?}",
            panel_rows(PanelKind::Apps, Some(&apps_snapshot), &Theme::dark()),
            panel_rows(PanelKind::Tasks, Some(&tasks_snapshot), &Theme::dark()),
            panel_rows(
                PanelKind::Sessions,
                Some(&sessions_snapshot),
                &Theme::dark()
            ),
            panel_rows(PanelKind::Memory, Some(&memory_snapshot), &Theme::dark()),
            panel_rows(
                PanelKind::Workspaces,
                Some(&workspaces_snapshot),
                &Theme::dark()
            ),
        );

        assert!(rendered.contains("No Agent, Live, or Bridge Apps are available"));
        assert!(rendered.contains("sparo apps list"));
        assert!(rendered.contains("CreateAgentApp"));
        assert!(rendered.contains("InitLiveApp"));
        assert!(rendered.contains("sparo tasks list"));
        assert!(rendered.contains("sparo sessions list"));
        assert!(rendered.contains("sparo memory list"));
        assert!(rendered.contains("sparo workspaces list"));
        assert!(rendered.contains("sparo workspaces use ."));
        assert!(rendered.contains("sparo health"));
    }

    #[test]
    fn panel_rows_truncate_long_display_fields() {
        let mut snapshot = sample_snapshot();
        snapshot.model =
            "extremely-long-model-routing-name-that-should-not-dominate-settings".to_string();
        snapshot.current_workspace = Some(
            "D:\\workspace\\project\\with\\a\\very\\deep\\active\\workspace\\path\\that\\keeps\\going"
                .to_string(),
        );
        snapshot.git_branch =
            Some("git feature/some-very-long-branch-name-that-keeps-going".to_string());
        snapshot.sessions[0].agent = "DispatcherWithAVeryLongAgentName".to_string();
        snapshot.tasks[0].status = "waiting-for-user-review".to_string();
        snapshot.tasks[0].agent = "DebugAgentWithAVeryLongName".to_string();
        snapshot.tasks[0].session_id =
            Some("task-session-with-a-very-long-id-that-keeps-going".to_string());
        snapshot.apps[0].kind = "AGENT APP WITH LONG KIND".to_string();
        snapshot.apps[0].description =
            "A very long app description that should stay readable inside a compact panel row"
                .to_string();
        snapshot.apps[0].capability =
            "read write execute summarize inspect generate rewrite".to_string();
        snapshot.memories[0].target =
            "D:\\workspace\\project\\with\\a\\very\\deep\\memory\\directory\\that\\keeps\\going"
                .to_string();
        snapshot.memories[0].file =
            "very-long-memory-file-name-that-should-not-dominate.md".to_string();
        snapshot.workspaces[0].path = Some(
            "D:\\workspace\\project\\with\\a\\very\\deep\\workspace\\path\\that\\keeps\\going"
                .to_string(),
        );
        snapshot.workspaces[0].git =
            Some("git feature/some-very-long-workspace-branch-name-that-keeps-going".to_string());

        let rendered = format!(
            "{:?}{:?}{:?}{:?}{:?}{:?}",
            panel_rows(PanelKind::Sessions, Some(&snapshot), &Theme::dark()),
            panel_rows(PanelKind::Tasks, Some(&snapshot), &Theme::dark()),
            panel_rows(PanelKind::Apps, Some(&snapshot), &Theme::dark()),
            panel_rows(PanelKind::Memory, Some(&snapshot), &Theme::dark()),
            panel_rows(PanelKind::Workspaces, Some(&snapshot), &Theme::dark()),
            panel_rows(PanelKind::Settings, Some(&snapshot), &Theme::dark())
        );

        assert!(rendered.contains("..."));
        assert!(!rendered.contains("DispatcherWithAVeryLongAgentName"));
        assert!(!rendered.contains("waiting-for-user-review"));
        assert!(!rendered.contains("DebugAgentWithAVeryLongName"));
        assert!(!rendered.contains("very-long-id-that-keeps-going"));
        assert!(!rendered.contains("AGENT APP WITH LONG KIND"));
        assert!(!rendered.contains("that-should-not-dominate-settings"));
        assert!(!rendered.contains("active\\workspace\\path\\that\\keeps\\going"));
        assert!(!rendered.contains("branch-name-that-keeps-going"));
        assert!(!rendered.contains("that should stay readable inside a compact panel row"));
        assert!(!rendered.contains("summarize inspect generate rewrite"));
        assert!(!rendered.contains("file-name-that-should-not-dominate"));
        assert!(!rendered.contains("workspace-branch-name-that-keeps-going"));
        assert!(!rendered.contains("that\\keeps\\going"));
    }

    #[test]
    fn command_display_keeps_aliases_compact() {
        let command =
            crate::ui::commands::command_for_slash("/workspace", CommandScope::Home).unwrap();

        assert_eq!(command_primary_label(command, 14), "/workspace    ");
        assert_eq!(command_alias_hint(command, 19), "aka /workspaces...");
        assert!(!command_alias_hint(command, 19).contains("/projects"));

        let sessions =
            crate::ui::commands::command_for_slash("/sessions", CommandScope::Home).unwrap();
        let sessions_alias_hint = command_alias_hint(sessions, 40);
        assert!(sessions_alias_hint.contains("/resume"));
        assert!(!sessions_alias_hint.contains("/chapters"));
        assert!(!sessions_alias_hint.contains("/chapter"));
    }

    #[test]
    fn command_reference_line_adapts_to_available_width() {
        let command =
            crate::ui::commands::command_for_slash("/workspace", CommandScope::Home).unwrap();
        let narrow = command_reference_line(command, &Theme::dark(), 38);
        let wide = command_reference_line(command, &Theme::dark(), 76);

        let narrow_text = narrow
            .spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>();
        let wide_text = wide
            .spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>();

        assert!(narrow_text.contains("/workspace"));
        assert!(narrow_text.contains("Workspaces"));
        assert!(!narrow_text.contains("aka"));
        assert!(wide_text.contains("aka /workspaces"));
        assert!(wide_text.len() <= 78);
    }

    #[test]
    fn selected_command_clamps_to_filtered_results() {
        let overlay = OverlayState {
            kind: OverlayKind::CommandPalette,
            selected: 99,
            filter: "apps".to_string(),
            snapshot: None,
        };

        let command = selected_command(&overlay, CommandScope::Home).unwrap();

        assert_eq!(command.slash, "/apps");
    }

    #[test]
    fn help_footer_matches_overlay_behavior() {
        let hint = help_footer_hint(72);
        let medium = help_footer_hint(42);
        let narrow = help_footer_hint(18);

        assert!(hint.contains("Esc closes"));
        assert!(hint.contains("from chat or home"));
        assert_eq!(medium, "Esc close   / commands");
        assert_eq!(narrow, "Esc close");
    }

    #[test]
    fn help_quick_reference_surfaces_core_tui_controls() {
        let theme = Theme::dark();
        assert_eq!(help_quick_reference_capacity(9), 1);
        assert_eq!(help_quick_reference_capacity(12), 2);
        assert_eq!(help_quick_reference_capacity(16), 3);
        assert_eq!(help_quick_reference_capacity(18), 4);

        let home_lines = help_quick_reference_lines(CommandScope::Home, &theme, 80);
        let home_text = line_text(home_lines);
        assert!(home_text.contains("Home: Enter continue/new"));
        assert!(home_text.contains("R refresh"));
        assert!(home_text.contains("Ctrl+T/P/Y/O/,"));
        assert!(home_text.contains("Panel filter: type text"));
        assert!(home_text.contains("Backspace edit"));
        assert!(home_text.contains("Ctrl+U clear"));
        assert!(home_text.contains("sessions, memory, data"));

        let chat_lines = help_quick_reference_lines(CommandScope::Chat, &theme, 80);
        let chat_text = line_text(chat_lines);
        assert!(chat_text.contains("Chat: Enter send"));
        assert!(chat_text.contains("Ctrl+L clear"));
        assert!(chat_text.contains("Ctrl+E browse"));
        assert!(chat_text.contains("Pg/Home/End move"));
    }

    #[test]
    fn command_palette_footer_hint_adapts_to_width() {
        let wide = command_palette_footer_hint(70, true);
        let medium = command_palette_footer_hint(40, true);
        let narrow = command_palette_footer_hint(18, true);

        assert!(wide.contains("Type filter"));
        assert!(wide.contains("Pg/Home/End move"));
        assert!(wide.contains("Enter select"));
        assert_eq!(medium, "Enter select   Esc close");
        assert_eq!(narrow, "Enter   Esc");
    }

    #[test]
    fn command_palette_footer_avoids_enter_when_empty() {
        let wide = command_palette_footer_hint(70, false);
        let narrow = command_palette_footer_hint(28, false);

        assert_eq!(wide, "Backspace clear   Esc close");
        assert_eq!(narrow, "Backspace   Esc");
        assert!(!wide.contains("Enter"));
        assert!(!narrow.contains("Enter"));
    }

    #[test]
    fn panel_footer_hint_adapts_to_popup_width() {
        let wide = panel_footer_hint(PanelKind::Workspaces, CommandScope::Chat, 72, 0, 1, "");
        let medium = panel_footer_hint(PanelKind::Workspaces, CommandScope::Chat, 44, 0, 1, "");
        let narrow = panel_footer_hint(PanelKind::Workspaces, CommandScope::Chat, 22, 0, 1, "");

        assert!(wide.contains("select workspace"));
        assert!(medium.contains("Enter select"));
        assert!(!medium.contains("select workspace"));
        assert_eq!(narrow, "Enter   R   Esc");
        assert!(
            panel_footer_hint(PanelKind::Settings, CommandScope::Chat, 18, 0, 1, "").len() <= 16
        );
    }

    #[test]
    fn panel_footer_hint_does_not_offer_enter_for_empty_panels() {
        let wide = panel_footer_hint(PanelKind::Sessions, CommandScope::Chat, 72, 0, 0, "");
        let medium = panel_footer_hint(PanelKind::Tasks, CommandScope::Chat, 44, 0, 0, "");
        let narrow = panel_footer_hint(PanelKind::Apps, CommandScope::Chat, 22, 0, 0, "");

        assert!(wide.contains("No items"));
        assert!(wide.contains("R refresh"));
        assert!(!wide.contains("Enter"));
        assert!(medium.contains("No items"));
        assert!(!medium.contains("Enter"));
        assert_eq!(narrow, "R refresh   Esc");
    }

    #[test]
    fn panel_footer_hint_exposes_browsing_for_multi_item_panels() {
        let extra_wide = panel_footer_hint(PanelKind::Sessions, CommandScope::Home, 96, 2, 12, "");
        let wide = panel_footer_hint(PanelKind::Sessions, CommandScope::Home, 88, 2, 12, "");
        let medium = panel_footer_hint(PanelKind::Sessions, CommandScope::Home, 54, 2, 12, "");
        let narrow = panel_footer_hint(PanelKind::Sessions, CommandScope::Home, 32, 2, 12, "");
        let task = panel_footer_hint(PanelKind::Tasks, CommandScope::Chat, 88, 0, 2, "");

        assert!(extra_wide.contains("Type filter"));
        assert!(extra_wide.contains("Enter resume session"));
        assert!(wide.contains("Up/Dn/Pg/Home/End 3/12"));
        assert!(wide.contains("Enter resume session"));
        assert!(!wide.contains("Type filter"));
        assert!(medium.contains("Up/Dn 3/12"));
        assert!(medium.contains("Enter resume"));
        assert!(medium.contains("R refresh"));
        assert_eq!(narrow, "Up/Dn   Enter   R   Esc");
        assert!(task.contains("Enter open task"));
    }

    #[test]
    fn sessions_panel_footer_matches_home_and_chat_enter_behavior() {
        let home = panel_footer_hint(PanelKind::Sessions, CommandScope::Home, 92, 0, 2, "");
        let chat = panel_footer_hint(PanelKind::Sessions, CommandScope::Chat, 92, 0, 2, "");
        let chat_single = panel_footer_hint(PanelKind::Sessions, CommandScope::Chat, 92, 0, 1, "");

        assert!(home.contains("Enter resume session"));
        assert!(chat.contains("Enter resume session"));
        assert!(chat_single.contains("Enter resume session"));
        assert!(chat_single.contains("Type filter"));
        assert!(!chat.contains("prepare session action"));
    }

    #[test]
    fn snapshot_panel_title_shows_position_without_counting_empty_state_rows() {
        assert_eq!(
            snapshot_panel_title(PanelKind::Settings, 0, 5, 5, "", 80),
            "Settings 1/5"
        );
        assert_eq!(
            snapshot_panel_title(PanelKind::Sessions, 0, 0, 0, "", 80),
            "Sessions 0"
        );

        let compact = snapshot_panel_title(PanelKind::Workspaces, 11, 125, 125, "", 14);
        assert!(compact.ends_with("..."));
        assert!(compact.len() <= 10);
    }

    #[test]
    fn snapshot_panel_render_uses_compact_footer_on_narrow_terminals() {
        let mut overlay = OverlayState::panel(PanelKind::Settings, sample_snapshot());
        let narrow = render_overlay_text(&mut overlay, CommandScope::Chat, 30, 12);

        assert!(narrow.contains("Up/Dn   Enter   R"));
        assert!(!narrow.contains("prepare settings action"));
        assert!(!narrow.contains("inspect setting"));

        let mut overlay = OverlayState::panel(PanelKind::Settings, sample_snapshot());
        let wide = render_overlay_text(&mut overlay, CommandScope::Chat, 80, 18);

        assert!(wide.contains("inspect setting"));
        assert!(!wide.contains("prepare settings action"));
    }

    #[test]
    fn snapshot_panel_render_shows_data_position_in_title() {
        let mut overlay = OverlayState::panel(PanelKind::Settings, sample_snapshot());
        overlay.selected = 2;
        let rendered = render_overlay_text(&mut overlay, CommandScope::Chat, 80, 18);

        assert!(rendered.contains("Settings 3/5"));
        assert!(rendered.contains("Up/Dn/Pg/Home/End 3/5"));

        let mut snapshot = sample_snapshot();
        snapshot.sessions.clear();
        let mut overlay = OverlayState::panel(PanelKind::Sessions, snapshot);
        let rendered = render_overlay_text(&mut overlay, CommandScope::Chat, 80, 18);

        assert!(rendered.contains("Sessions 0"));
        assert!(!rendered.contains("Sessions 1/2"));
    }

    #[test]
    fn snapshot_panel_render_includes_selected_item_preview() {
        let mut overlay = OverlayState::panel(PanelKind::Tasks, sample_snapshot());
        let rendered = render_overlay_text(&mut overlay, CommandScope::Chat, 96, 18);

        assert!(rendered.contains("active - debug - task-session"));
        assert!(rendered.contains("Enter open task"));

        let mut overlay = OverlayState::panel(PanelKind::Workspaces, sample_snapshot());
        let rendered = render_overlay_text(&mut overlay, CommandScope::Chat, 96, 18);

        assert!(rendered.contains("current"));
        assert!(rendered.contains("git main - 1 sessions"));
        assert!(rendered.contains("Enter select workspace"));
    }

    #[test]
    fn snapshot_panel_render_empty_footer_matches_empty_state() {
        let mut snapshot = sample_snapshot();
        snapshot.tasks.clear();
        let mut overlay = OverlayState::panel(PanelKind::Tasks, snapshot);
        let rendered = render_overlay_text(&mut overlay, CommandScope::Chat, 80, 18);

        assert!(rendered.contains("Tasks 0"));
        assert!(rendered.contains("No items"));
        assert!(rendered.contains("R refresh"));
        assert!(!rendered.contains("Enter continue"));
        assert!(!rendered.contains("Enter prepare"));
    }

    #[test]
    fn snapshot_panel_render_adds_non_selectable_column_header() {
        let mut overlay = OverlayState::panel(PanelKind::Sessions, sample_snapshot());
        let rendered = render_overlay_text(&mut overlay, CommandScope::Chat, 96, 18);

        assert!(rendered.contains("title"));
        assert!(rendered.contains("type"));
        assert!(rendered.contains("active"));
        assert!(rendered.contains("Build CLI"));
        assert_eq!(overlay.selected, 0);
        assert!(selected_panel_detail(&overlay)
            .unwrap()
            .contains("Build CLI"));
    }

    #[test]
    fn snapshot_panel_render_uses_drafting_shell_and_selection_rail() {
        let mut overlay = OverlayState::panel(PanelKind::Settings, sample_snapshot());
        let rendered = render_overlay_text(&mut overlay, CommandScope::Chat, 96, 18);

        assert!(rendered.contains("// Settings"));
        assert!(rendered.contains("> MODEL"));
    }

    #[test]
    fn snapshot_panel_selection_avoids_red_background_blocks() {
        let mut overlay = OverlayState::panel(PanelKind::Settings, sample_snapshot());
        let buffer = render_overlay_buffer(&mut overlay, CommandScope::Chat, 96, 18);

        let selected_cells = (0..buffer.area.height)
            .flat_map(|y| (0..buffer.area.width).map(move |x| (x, y)))
            .filter_map(|(x, y)| {
                let cell = &buffer[(x, y)];
                (cell.symbol() == ">").then_some(cell)
            })
            .collect::<Vec<_>>();

        assert!(!selected_cells.is_empty());
        assert!(selected_cells
            .iter()
            .all(|cell| matches!(cell.style().bg, None | Some(Color::Reset))));
    }

    #[test]
    fn panel_headers_stay_compact() {
        for kind in [
            PanelKind::Sessions,
            PanelKind::Tasks,
            PanelKind::Apps,
            PanelKind::Memory,
            PanelKind::Workspaces,
            PanelKind::Settings,
        ] {
            let header = panel_header_text(kind);
            assert!(
                header.len() <= 42,
                "header should stay compact for {kind:?}: {header}"
            );
        }
    }

    #[test]
    fn snapshot_panel_render_uses_compact_rows_on_narrow_widths() {
        for (kind, compact_header, row_signal, wide_header) in [
            (
                PanelKind::Sessions,
                "item  type  ctx",
                "Build CLI",
                "active  activity",
            ),
            (
                PanelKind::Tasks,
                "status  item  session",
                "task-session",
                "agent  session",
            ),
            (PanelKind::Apps, "app  action  kind", "inspect", "desc  cap"),
            (
                PanelKind::Memory,
                "scope  file  action",
                "preview",
                "target",
            ),
            (
                PanelKind::Workspaces,
                "workspace  git  sessions",
                "git main",
                "path  git",
            ),
            (
                PanelKind::Settings,
                "setting  action  value",
                "diagnose",
                "setting    action",
            ),
        ] {
            let mut overlay = OverlayState::panel(kind, sample_snapshot());
            let rendered = render_overlay_text(&mut overlay, CommandScope::Chat, 48, 14);

            assert!(
                rendered.contains(compact_header),
                "{kind:?} should render compact header: {rendered}"
            );
            assert!(
                rendered.contains(row_signal),
                "{kind:?} should preserve row signal: {rendered}"
            );
            assert!(
                !rendered.contains(wide_header),
                "{kind:?} should not render wide header on narrow terminals: {rendered}"
            );
            assert_eq!(overlay.selected, 0);
        }
    }

    #[test]
    fn help_overlay_render_uses_compact_footer_on_narrow_terminals() {
        let mut overlay = OverlayState::help();
        let narrow = render_overlay_text(&mut overlay, CommandScope::Chat, 34, 12);

        assert!(narrow.contains("Esc close"));
        assert!(!narrow.contains("from chat or home"));

        let mut overlay = OverlayState::help();
        let wide = render_overlay_text(&mut overlay, CommandScope::Chat, 88, 18);

        assert!(wide.contains("from chat or home"));
    }

    #[test]
    fn help_overlay_marks_hidden_commands_when_short() {
        let mut overlay = OverlayState::help();
        let short = render_overlay_text(&mut overlay, CommandScope::Home, 52, 10);

        assert!(short.contains("more commands"), "{short}");
        assert!(short.contains("Press /"));
    }

    #[test]
    fn command_palette_render_keeps_footer_visible_on_short_terminals() {
        let mut overlay = OverlayState::command_palette();
        overlay.filter = "workspace".to_string();
        let medium = render_overlay_text(&mut overlay, CommandScope::Home, 34, 10);

        assert!(medium.contains("Enter select"));
        assert!(!medium.contains("Type filter"));

        let mut overlay = OverlayState::command_palette();
        let narrow = render_overlay_text(&mut overlay, CommandScope::Home, 28, 10);

        assert!(narrow.contains("Enter   Esc"));

        let mut overlay = OverlayState::command_palette();
        let wide = render_overlay_text(&mut overlay, CommandScope::Home, 86, 18);

        assert!(wide.contains("Type filter"));
        assert!(wide.contains("Pg/Home/End move"));
        assert!(wide.contains("Enter select"));
    }

    #[test]
    fn command_palette_empty_state_guides_recovery() {
        let mut overlay = OverlayState::command_palette();
        overlay.filter = "no-such-command".to_string();

        let rendered = render_overlay_text(&mut overlay, CommandScope::Home, 64, 12);

        assert!(rendered.contains("No matching commands"));
        assert!(rendered.contains("Backspace clears"));
        assert!(rendered.contains("memory"));
        assert!(rendered.contains("data"));
        assert!(rendered.contains("Backspace clear"));
        assert!(rendered.contains("Esc close"));
        assert!(!rendered.contains("Enter select"));
    }

    #[test]
    fn panel_no_match_state_truncates_long_filters() {
        let mut overlay = OverlayState::panel(PanelKind::Apps, sample_snapshot());
        overlay.filter =
            "this filter is intentionally much too long for a compact panel".to_string();

        assert_eq!(
            compact_inline_text(&overlay.filter, 28),
            "this filter is intentiona..."
        );

        let rendered = render_overlay_text(&mut overlay, CommandScope::Chat, 44, 16);

        assert!(rendered.contains("No matching apps items."));
        assert!(rendered.contains("Filter: this filter is intentiona..."));
        assert!(rendered.contains("Backspace edit"));
        assert!(rendered.contains("Esc clear"));
        assert!(rendered.contains("R refresh"));
        assert!(!rendered.contains("much too long for a compact panel"));
    }

    #[test]
    fn settings_panel_count_includes_health_and_data_actions() {
        let overlay = OverlayState::panel(PanelKind::Settings, sample_snapshot());

        assert_eq!(panel_count(&overlay), 5);
    }

    #[test]
    fn sessions_panel_count_uses_saved_sessions() {
        let overlay = OverlayState::panel(PanelKind::Sessions, sample_snapshot());

        assert_eq!(panel_count(&overlay), 1);
    }

    #[test]
    fn selected_workspace_returns_workspace_path() {
        let overlay = OverlayState::panel(PanelKind::Workspaces, sample_snapshot());

        assert_eq!(
            selected_workspace(&overlay).flatten().as_deref(),
            Some("D:\\workspace\\project")
        );
    }

    #[test]
    fn workspace_panel_marks_current_context_in_detail_and_filter() {
        let mut snapshot = sample_snapshot();
        snapshot.workspaces.push(AgenticOsWorkspaceRow {
            label: "other".to_string(),
            path: Some("D:\\workspace\\other".to_string()),
            git: Some("git feature".to_string()),
            session_count: 4,
        });
        let mut overlay = OverlayState::panel(PanelKind::Workspaces, snapshot);
        overlay.filter = "current".to_string();

        assert_eq!(panel_count(&overlay), 1);
        assert_eq!(selected_panel_data_index(&overlay), Some(0));
        assert!(selected_panel_detail(&overlay)
            .unwrap()
            .contains("Current: yes"));
    }

    #[test]
    fn panel_filter_counts_and_selection_use_matching_rows() {
        let mut snapshot = sample_snapshot();
        snapshot.sessions.push(AgenticOsSessionRow {
            id: "session-review".to_string(),
            title: "Review TUI panels".to_string(),
            agent: "debug".to_string(),
            workspace: Some("D:\\workspace\\project".to_string()),
            parent_session_id: None,
            is_dispatch_task: true,
            turns: 7,
            child_count: 0,
            last_active_at: 1_700_000_100_000,
        });
        let mut overlay = OverlayState::panel(PanelKind::Sessions, snapshot);
        overlay.filter = "review debug".to_string();

        assert_eq!(panel_count(&overlay), 1);
        assert_eq!(selected_panel_data_index(&overlay), Some(1));
        assert!(selected_panel_detail(&overlay)
            .unwrap()
            .contains("Review TUI panels"));
    }

    #[test]
    fn panel_filter_supports_settings_and_empty_matches() {
        let mut settings = OverlayState::panel(PanelKind::Settings, sample_snapshot());
        settings.filter = "storage".to_string();
        assert_eq!(panel_count(&settings), 1);
        assert_eq!(selected_panel_data_index(&settings), Some(4));
        assert!(selected_panel_detail(&settings)
            .unwrap()
            .contains("Data storage"));

        let rows = panel_rows_for_width(
            PanelKind::Apps,
            Some(&sample_snapshot()),
            &Theme::dark(),
            80,
            "missing",
        );
        let rendered = format!("{:?}", rows);
        assert!(rendered.contains("No matching apps items"));
        assert!(rendered.contains("Filter: missing"));
        assert!(rendered.contains("Esc clear"));
        assert!(rendered.contains("R refresh"));

        let footer = panel_footer_hint(PanelKind::Apps, CommandScope::Chat, 80, 0, 1, "files");
        assert!(footer.contains("filter: files"));
        assert!(footer.contains("Backspace"));
        assert!(footer.contains("Ctrl+U clear"));
    }

    #[test]
    fn move_selection_clamps_to_available_items() {
        let mut overlay = OverlayState::command_palette();

        move_selection(&mut overlay, 5, 3);
        assert_eq!(overlay.selected, 2);

        move_selection(&mut overlay, -5, 3);
        assert_eq!(overlay.selected, 0);

        move_selection(&mut overlay, 1, 0);
        assert_eq!(overlay.selected, 0);
    }

    #[test]
    fn jump_selection_supports_pages_and_edges() {
        let mut overlay = OverlayState::command_palette();
        overlay.selected = 5;

        jump_selection(&mut overlay, SelectionJump::PageUp(3), 10);
        assert_eq!(overlay.selected, 2);

        jump_selection(&mut overlay, SelectionJump::PageDown(20), 10);
        assert_eq!(overlay.selected, 9);

        jump_selection(&mut overlay, SelectionJump::First, 10);
        assert_eq!(overlay.selected, 0);

        jump_selection(&mut overlay, SelectionJump::Last, 10);
        assert_eq!(overlay.selected, 9);

        jump_selection(&mut overlay, SelectionJump::Last, 0);
        assert_eq!(overlay.selected, 0);
    }
}
