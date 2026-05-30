#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandScope {
    Home,
    Chat,
    Global,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PanelKind {
    Tasks,
    Apps,
    Memory,
    Workspaces,
    Settings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandAction {
    OpenPanel(PanelKind),
    NewSession,
    ClearChat,
    Dispatch,
    ShowAgents,
    ShowHistory,
    ExportSession,
    Help,
}

#[derive(Debug, Clone, Copy)]
pub struct CommandSpec {
    pub slash: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub shortcut: Option<&'static str>,
    pub action: CommandAction,
    pub scopes: &'static [CommandScope],
}

const GLOBAL: &[CommandScope] = &[CommandScope::Global];
const HOME: &[CommandScope] = &[CommandScope::Home];
const CHAT: &[CommandScope] = &[CommandScope::Chat];
const BOTH: &[CommandScope] = &[CommandScope::Home, CommandScope::Chat];

pub const COMMANDS: &[CommandSpec] = &[
    CommandSpec {
        slash: "/tasks",
        title: "Tasks",
        description: "Open the agent task center",
        shortcut: Some("Ctrl+T"),
        action: CommandAction::OpenPanel(PanelKind::Tasks),
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/apps",
        title: "Apps",
        description: "Browse Agent, Bridge, and Live Apps",
        shortcut: Some("Ctrl+P"),
        action: CommandAction::OpenPanel(PanelKind::Apps),
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/memory",
        title: "Memory",
        description: "Browse global and project memory files",
        shortcut: Some("Ctrl+M"),
        action: CommandAction::OpenPanel(PanelKind::Memory),
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/workspace",
        title: "Workspaces",
        description: "Switch or inspect workspaces",
        shortcut: Some("Ctrl+O"),
        action: CommandAction::OpenPanel(PanelKind::Workspaces),
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/settings",
        title: "Settings",
        description: "Inspect active model and CLI runtime settings",
        shortcut: Some("Ctrl+,"),
        action: CommandAction::OpenPanel(PanelKind::Settings),
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/new",
        title: "New Session",
        description: "Start a fresh Dispatcher session",
        shortcut: None,
        action: CommandAction::NewSession,
        scopes: HOME,
    },
    CommandSpec {
        slash: "/clear",
        title: "Clear Chat",
        description: "Clear the visible chat transcript",
        shortcut: Some("Ctrl+L"),
        action: CommandAction::ClearChat,
        scopes: CHAT,
    },
    CommandSpec {
        slash: "/dispatch",
        title: "Dispatch",
        description: "Prepare a Dispatcher delegation prompt",
        shortcut: None,
        action: CommandAction::Dispatch,
        scopes: CHAT,
    },
    CommandSpec {
        slash: "/agents",
        title: "Agents",
        description: "List available built-in agents",
        shortcut: None,
        action: CommandAction::ShowAgents,
        scopes: CHAT,
    },
    CommandSpec {
        slash: "/history",
        title: "History",
        description: "Show current session statistics",
        shortcut: None,
        action: CommandAction::ShowHistory,
        scopes: CHAT,
    },
    CommandSpec {
        slash: "/export",
        title: "Export",
        description: "Show where persisted session history lives",
        shortcut: None,
        action: CommandAction::ExportSession,
        scopes: CHAT,
    },
    CommandSpec {
        slash: "/help",
        title: "Help",
        description: "Open the command reference",
        shortcut: Some("/"),
        action: CommandAction::Help,
        scopes: GLOBAL,
    },
];

pub fn command_for_slash(input: &str, scope: CommandScope) -> Option<&'static CommandSpec> {
    let slash = input.split_whitespace().next().unwrap_or(input);
    COMMANDS
        .iter()
        .find(|command| command.slash == slash && command.visible_in(scope))
}

pub fn commands_for_scope(scope: CommandScope) -> impl Iterator<Item = &'static CommandSpec> {
    COMMANDS
        .iter()
        .filter(move |command| command.visible_in(scope))
}

pub fn filtered_commands(scope: CommandScope, filter: &str) -> Vec<&'static CommandSpec> {
    let filter = filter.trim_start_matches('/').to_lowercase();
    commands_for_scope(scope)
        .filter(|command| {
            filter.is_empty()
                || command.slash.trim_start_matches('/').contains(&filter)
                || command.title.to_lowercase().contains(&filter)
                || command.description.to_lowercase().contains(&filter)
        })
        .collect()
}

impl CommandSpec {
    pub fn visible_in(&self, scope: CommandScope) -> bool {
        self.scopes.contains(&CommandScope::Global) || self.scopes.contains(&scope)
    }
}

impl PanelKind {
    pub fn title(self) -> &'static str {
        match self {
            Self::Tasks => "Tasks",
            Self::Apps => "Apps",
            Self::Memory => "Memory",
            Self::Workspaces => "Workspaces",
            Self::Settings => "Settings",
        }
    }

    pub fn close_hint(self) -> &'static str {
        match self {
            Self::Tasks => "Enter continue task   R refresh   Esc close",
            Self::Apps => "Enter prepare app action   R refresh   Esc close",
            Self::Memory => "Enter discuss memory   R refresh   Esc close",
            Self::Workspaces => "Enter switch workspace   R refresh   Esc close",
            Self::Settings => "Use `sparo config` for durable changes   Esc close",
        }
    }
}
