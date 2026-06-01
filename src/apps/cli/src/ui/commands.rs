#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandScope {
    Home,
    Chat,
    Global,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PanelKind {
    Sessions,
    Tasks,
    Apps,
    Memory,
    Workspaces,
    Settings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandAction {
    OpenPanel(PanelKind),
    OpenPanelAt(PanelKind, usize),
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
    pub aliases: &'static [&'static str],
    pub title: &'static str,
    pub description: &'static str,
    pub shortcut: Option<&'static str>,
    pub action: CommandAction,
    pub scopes: &'static [CommandScope],
}

const GLOBAL: &[CommandScope] = &[CommandScope::Global];
const CHAT: &[CommandScope] = &[CommandScope::Chat];
const BOTH: &[CommandScope] = &[CommandScope::Home, CommandScope::Chat];

pub const COMMANDS: &[CommandSpec] = &[
    CommandSpec {
        slash: "/sessions",
        aliases: &["/session", "/recent", "/resume", "/chapters", "/chapter"],
        title: "Sessions",
        description: "Browse and resume saved sessions",
        shortcut: None,
        action: CommandAction::OpenPanel(PanelKind::Sessions),
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/tasks",
        aliases: &["/task"],
        title: "Tasks",
        description: "Open the agent task center",
        shortcut: Some("Ctrl+T"),
        action: CommandAction::OpenPanel(PanelKind::Tasks),
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/apps",
        aliases: &["/app"],
        title: "Apps",
        description: "Browse Agent, Bridge, and Live Apps",
        shortcut: Some("Ctrl+P"),
        action: CommandAction::OpenPanel(PanelKind::Apps),
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/memory",
        aliases: &["/memories", "/notes"],
        title: "Memory",
        description: "Browse global and project memory files",
        shortcut: Some("Ctrl+Y"),
        action: CommandAction::OpenPanel(PanelKind::Memory),
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/workspace",
        aliases: &["/workspaces", "/work", "/project", "/projects"],
        title: "Workspaces",
        description: "Select or inspect workspaces",
        shortcut: Some("Ctrl+O"),
        action: CommandAction::OpenPanel(PanelKind::Workspaces),
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/settings",
        aliases: &["/config"],
        title: "Settings",
        description: "Inspect model, workspace, git, health, and data",
        shortcut: Some("Ctrl+,"),
        action: CommandAction::OpenPanel(PanelKind::Settings),
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/model",
        aliases: &["/models"],
        title: "Model",
        description: "Inspect or change model routing",
        shortcut: None,
        action: CommandAction::OpenPanelAt(PanelKind::Settings, 0),
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/prefs",
        aliases: &["/preferences"],
        title: "Preferences",
        description: "Inspect CLI-local preferences and default workspace",
        shortcut: None,
        action: CommandAction::OpenPanelAt(PanelKind::Settings, 1),
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/runtime",
        aliases: &["/health"],
        title: "Runtime",
        description: "Inspect CLI runtime health and diagnostics",
        shortcut: None,
        action: CommandAction::OpenPanelAt(PanelKind::Settings, 3),
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/data",
        aliases: &["/storage"],
        title: "Data",
        description: "Inspect sessions, memory, and storage paths",
        shortcut: None,
        action: CommandAction::OpenPanelAt(PanelKind::Settings, 4),
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/git",
        aliases: &[],
        title: "Git",
        description: "Inspect current workspace git context",
        shortcut: None,
        action: CommandAction::OpenPanelAt(PanelKind::Settings, 2),
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/new",
        aliases: &[],
        title: "New Session",
        description: "Start a fresh default-agent session",
        shortcut: None,
        action: CommandAction::NewSession,
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/clear",
        aliases: &[],
        title: "Clear Chat",
        description: "Clear the visible chat transcript",
        shortcut: Some("Ctrl+L"),
        action: CommandAction::ClearChat,
        scopes: CHAT,
    },
    CommandSpec {
        slash: "/dispatch",
        aliases: &[],
        title: "Dispatch",
        description: "Use /dispatch <task> to prepare a delegation prompt",
        shortcut: None,
        action: CommandAction::Dispatch,
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/agents",
        aliases: &[],
        title: "Agents",
        description: "List available built-in agents",
        shortcut: None,
        action: CommandAction::ShowAgents,
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/history",
        aliases: &[],
        title: "History",
        description: "Inspect chat statistics or saved sessions",
        shortcut: None,
        action: CommandAction::ShowHistory,
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/export",
        aliases: &[],
        title: "Export",
        description: "Prepare session export guidance",
        shortcut: None,
        action: CommandAction::ExportSession,
        scopes: BOTH,
    },
    CommandSpec {
        slash: "/help",
        aliases: &[],
        title: "Help",
        description: "Open the command reference",
        shortcut: Some("/"),
        action: CommandAction::Help,
        scopes: GLOBAL,
    },
];

pub fn agents_registry_message(agents: &[bitfun_core::agentic::agents::AgentInfo]) -> String {
    if agents.is_empty() {
        return "Available Agents:\nNo agents are currently registered.\n\nUse:\n- sparo agents list --json to inspect the live agent registry".to_string();
    }

    let mut out = format!(
        "Available Agents (live registry, {} total):\n",
        agents.len()
    );
    for agent in agents.iter().take(12) {
        let state = if agent.enabled { "enabled" } else { "disabled" };
        let readonly = if agent.is_readonly {
            "readonly"
        } else {
            "write"
        };
        out.push_str(&format!(
            "- {} ({}) - {} | {} tools | {}\n",
            agent.name, agent.id, state, agent.tool_count, readonly
        ));
        if let Some(description) = compact_agent_description(&agent.description) {
            out.push_str(&format!("  {}\n", description));
        }
    }
    if agents.len() > 12 {
        out.push_str(&format!("- ... {} more\n", agents.len() - 12));
    }
    out.push_str(
        "\nUse:\n- sparo agents list to inspect the live agent registry\n- /dispatch <task> to route work to a specialist\n- sparo tasks list to inspect delegated work",
    );
    out
}

fn compact_agent_description(description: &str) -> Option<String> {
    let compact = description.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return None;
    }

    const MAX_CHARS: usize = 140;
    if compact.chars().count() <= MAX_CHARS {
        return Some(compact);
    }

    let mut preview = compact.chars().take(MAX_CHARS).collect::<String>();
    if let Some((index, _)) = preview
        .char_indices()
        .rev()
        .find(|(_, ch)| ch.is_whitespace())
    {
        preview.truncate(index);
    }

    Some(format!("{}...", preview.trim_end()))
}

pub fn command_for_slash(input: &str, scope: CommandScope) -> Option<&'static CommandSpec> {
    let slash = input.split_whitespace().next().unwrap_or(input);
    let slash = slash.to_ascii_lowercase();
    COMMANDS
        .iter()
        .find(|command| command.matches_slash(&slash) && command.visible_in(scope))
}

pub fn typed_command_action(filter: &str, scope: CommandScope) -> Option<(CommandAction, String)> {
    let filter = filter.trim();
    if filter.is_empty() {
        return None;
    }
    let (head, args) = filter
        .split_once(char::is_whitespace)
        .map(|(head, args)| (head.to_string(), args.trim().to_string()))
        .unwrap_or((filter.to_string(), String::new()));
    let slash = format!("/{}", head.trim_start_matches('/'));
    command_for_slash(&slash, scope).map(|command| (command.action, args))
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
                || command
                    .aliases
                    .iter()
                    .any(|alias| alias.trim_start_matches('/').contains(&filter))
                || command.title.to_lowercase().contains(&filter)
                || command.description.to_lowercase().contains(&filter)
        })
        .collect()
}

impl CommandSpec {
    pub fn visible_in(&self, scope: CommandScope) -> bool {
        self.scopes.contains(&CommandScope::Global) || self.scopes.contains(&scope)
    }

    pub fn matches_slash(&self, slash: &str) -> bool {
        self.slash == slash || self.aliases.contains(&slash)
    }

    pub fn display_aliases(&self) -> Vec<&'static str> {
        self.aliases
            .iter()
            .copied()
            .filter(|alias| !is_deprecated_alias(alias))
            .collect()
    }

    #[cfg(test)]
    pub fn slash_label(&self) -> String {
        let aliases = self.display_aliases();
        if aliases.is_empty() {
            self.slash.to_string()
        } else {
            format!("{} ({})", self.slash, aliases.join(", "))
        }
    }
}

fn is_deprecated_alias(alias: &str) -> bool {
    matches!(alias, "/chapters" | "/chapter")
}

impl PanelKind {
    pub fn title(self) -> &'static str {
        match self {
            Self::Sessions => "Sessions",
            Self::Tasks => "Tasks",
            Self::Apps => "Apps",
            Self::Memory => "Memory",
            Self::Workspaces => "Workspaces",
            Self::Settings => "Settings",
        }
    }

    pub fn close_hint(self) -> &'static str {
        match self {
            Self::Sessions => "Enter resume session   R refresh   Esc close",
            Self::Tasks => "Enter open task   R refresh   Esc close",
            Self::Apps => "Enter inspect app   R refresh   Esc close",
            Self::Memory => "Enter load memory   R refresh   Esc close",
            Self::Workspaces => "Enter select workspace   R refresh   Esc close",
            Self::Settings => "Enter inspect setting   R refresh   Esc close",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_slash_command_accepts_cli_plural_alias() {
        let command = command_for_slash("/workspaces", CommandScope::Home).unwrap();

        assert_eq!(
            command.action,
            CommandAction::OpenPanel(PanelKind::Workspaces)
        );
    }

    #[test]
    fn sessions_slash_command_accepts_singular_alias() {
        let command = command_for_slash("/session", CommandScope::Chat).unwrap();

        assert_eq!(
            command.action,
            CommandAction::OpenPanel(PanelKind::Sessions)
        );
        assert_eq!(
            command.slash_label(),
            "/sessions (/session, /recent, /resume)"
        );
    }

    #[test]
    fn recent_slash_command_opens_sessions_panel() {
        let command = command_for_slash("/recent", CommandScope::Home).unwrap();
        let resume = command_for_slash("/resume", CommandScope::Chat).unwrap();

        assert_eq!(
            command.action,
            CommandAction::OpenPanel(PanelKind::Sessions)
        );
        assert_eq!(resume.action, CommandAction::OpenPanel(PanelKind::Sessions));

        let commands = filtered_commands(CommandScope::Home, "recent");
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].slash, "/sessions");

        let commands = filtered_commands(CommandScope::Chat, "resume");
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].slash, "/sessions");
    }

    #[test]
    fn chapters_slash_command_opens_sessions_panel() {
        let command = command_for_slash("/chapters", CommandScope::Home).unwrap();

        assert_eq!(
            command.action,
            CommandAction::OpenPanel(PanelKind::Sessions)
        );
        assert!(!command.display_aliases().contains(&"/chapters"));
        assert!(!command.display_aliases().contains(&"/chapter"));

        let commands = filtered_commands(CommandScope::Home, "chapters");
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].slash, "/sessions");
    }

    #[test]
    fn sessions_panel_hint_matches_resume_behavior() {
        assert!(PanelKind::Sessions.close_hint().contains("resume session"));
    }

    #[test]
    fn workspaces_panel_hint_matches_select_behavior() {
        assert!(PanelKind::Workspaces
            .close_hint()
            .contains("select workspace"));
    }

    #[test]
    fn tasks_panel_hint_matches_open_behavior() {
        assert!(PanelKind::Tasks.close_hint().contains("open task"));
    }

    #[test]
    fn panel_slash_commands_accept_common_singular_aliases() {
        let task = command_for_slash("/task", CommandScope::Chat).unwrap();
        let app = command_for_slash("/app", CommandScope::Chat).unwrap();

        assert_eq!(task.action, CommandAction::OpenPanel(PanelKind::Tasks));
        assert_eq!(app.action, CommandAction::OpenPanel(PanelKind::Apps));
        assert_eq!(task.slash_label(), "/tasks (/task)");
        assert_eq!(app.slash_label(), "/apps (/app)");
    }

    #[test]
    fn memory_slash_command_accepts_plural_and_notes_aliases() {
        let memories = command_for_slash("/memories", CommandScope::Home).unwrap();
        let notes = command_for_slash("/notes", CommandScope::Chat).unwrap();

        assert_eq!(memories.action, CommandAction::OpenPanel(PanelKind::Memory));
        assert_eq!(notes.action, CommandAction::OpenPanel(PanelKind::Memory));
        assert_eq!(memories.slash_label(), "/memory (/memories, /notes)");

        let commands = filtered_commands(CommandScope::Home, "notes");
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].slash, "/memory");
    }

    #[test]
    fn slash_command_matching_is_case_insensitive() {
        let app = command_for_slash("/Apps", CommandScope::Home).unwrap();
        let config = command_for_slash("/CONFIG", CommandScope::Chat).unwrap();
        let health = command_for_slash("/health", CommandScope::Home).unwrap();

        assert_eq!(app.action, CommandAction::OpenPanel(PanelKind::Apps));
        assert_eq!(config.action, CommandAction::OpenPanel(PanelKind::Settings));
        assert_eq!(
            health.action,
            CommandAction::OpenPanelAt(PanelKind::Settings, 3)
        );
    }

    #[test]
    fn command_filter_matches_aliases_without_duplicate_entries() {
        let commands = filtered_commands(CommandScope::Chat, "workspaces");

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].slash, "/workspace");
        assert_eq!(
            commands[0].action,
            CommandAction::OpenPanel(PanelKind::Workspaces)
        );
    }

    #[test]
    fn slash_label_includes_aliases_when_present() {
        let command = command_for_slash("/workspace", CommandScope::Home).unwrap();

        assert_eq!(
            command.slash_label(),
            "/workspace (/workspaces, /work, /project, /projects)"
        );
    }

    #[test]
    fn workspace_slash_command_accepts_work_and_project_aliases() {
        let work = command_for_slash("/work", CommandScope::Home).unwrap();
        let project = command_for_slash("/project", CommandScope::Chat).unwrap();

        assert_eq!(work.action, CommandAction::OpenPanel(PanelKind::Workspaces));
        assert_eq!(
            project.action,
            CommandAction::OpenPanel(PanelKind::Workspaces)
        );

        let commands = filtered_commands(CommandScope::Home, "project");
        assert!(commands.iter().any(|command| command.slash == "/workspace"));
    }

    #[test]
    fn settings_slash_command_accepts_config_alias() {
        let command = command_for_slash("/config", CommandScope::Chat).unwrap();

        assert_eq!(
            command.action,
            CommandAction::OpenPanel(PanelKind::Settings)
        );
        assert_eq!(command.slash_label(), "/settings (/config)");
        assert!(command.description.contains("data"));
    }

    #[test]
    fn command_filter_matches_config_alias_without_duplicate_entries() {
        let commands = filtered_commands(CommandScope::Home, "config");

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].slash, "/settings");
        assert_eq!(
            commands[0].action,
            CommandAction::OpenPanel(PanelKind::Settings)
        );
    }

    #[test]
    fn command_filter_finds_settings_by_health_and_data_terms() {
        let health = filtered_commands(CommandScope::Home, "health");
        let data = filtered_commands(CommandScope::Home, "data");

        assert!(health.iter().any(|command| command.slash == "/settings"));
        assert!(health.iter().any(|command| command.slash == "/runtime"));
        assert!(data.iter().any(|command| command.slash == "/settings"));
        assert!(data.iter().any(|command| command.slash == "/data"));
    }

    #[test]
    fn settings_related_slash_commands_open_specific_rows() {
        let model = command_for_slash("/model", CommandScope::Home).unwrap();
        let prefs = command_for_slash("/prefs", CommandScope::Chat).unwrap();
        let runtime = command_for_slash("/runtime", CommandScope::Chat).unwrap();
        let git = command_for_slash("/git", CommandScope::Chat).unwrap();

        assert_eq!(
            model.action,
            CommandAction::OpenPanelAt(PanelKind::Settings, 0)
        );
        assert_eq!(
            prefs.action,
            CommandAction::OpenPanelAt(PanelKind::Settings, 1)
        );
        assert_eq!(
            runtime.action,
            CommandAction::OpenPanelAt(PanelKind::Settings, 3)
        );
        assert_eq!(
            command_for_slash("/data", CommandScope::Chat)
                .unwrap()
                .action,
            CommandAction::OpenPanelAt(PanelKind::Settings, 4)
        );
        assert_eq!(
            command_for_slash("/storage", CommandScope::Home)
                .unwrap()
                .action,
            CommandAction::OpenPanelAt(PanelKind::Settings, 4)
        );
        assert_eq!(
            git.action,
            CommandAction::OpenPanelAt(PanelKind::Settings, 2)
        );

        let commands = filtered_commands(CommandScope::Home, "model");
        assert!(commands.iter().any(|command| command.slash == "/model"));

        let commands = filtered_commands(CommandScope::Home, "preferences");
        assert!(commands.iter().any(|command| command.slash == "/prefs"));

        let commands = filtered_commands(CommandScope::Home, "storage");
        assert!(commands.iter().any(|command| command.slash == "/data"));
    }

    #[test]
    fn history_and_export_are_visible_from_home_and_chat() {
        let history = command_for_slash("/history", CommandScope::Home).unwrap();
        let export = command_for_slash("/export", CommandScope::Home).unwrap();

        assert_eq!(history.action, CommandAction::ShowHistory);
        assert_eq!(export.action, CommandAction::ExportSession);
        assert!(command_for_slash("/history", CommandScope::Chat).is_some());
        assert!(command_for_slash("/export", CommandScope::Chat).is_some());

        let commands = filtered_commands(CommandScope::Home, "export");
        assert!(commands.iter().any(|command| command.slash == "/export"));
    }

    #[test]
    fn agents_command_is_visible_from_home_and_chat() {
        let home = command_for_slash("/agents", CommandScope::Home).unwrap();
        let chat = command_for_slash("/agents", CommandScope::Chat).unwrap();

        assert_eq!(home.action, CommandAction::ShowAgents);
        assert_eq!(chat.action, CommandAction::ShowAgents);
    }

    #[test]
    fn agents_registry_message_uses_live_agent_rows() {
        let agent = bitfun_core::agentic::agents::AgentInfo {
            id: "debug".to_string(),
            name: "Debug".to_string(),
            description: "Diagnose failures".to_string(),
            is_readonly: false,
            tool_count: 3,
            default_tools: vec!["Read".to_string()],
            enabled: true,
            subagent_source: None,
            path: None,
            model: None,
            app_kind: None,
            app_icon: None,
            app_category: None,
            app_path: None,
        };

        let message = agents_registry_message(&[agent]);

        assert!(message.contains("Available Agents (live registry, 1 total)"));
        assert!(message.contains("Debug (debug)"));
        assert!(message.contains("Diagnose failures"));
        assert!(message.contains("sparo agents list"));
    }

    #[test]
    fn agents_registry_message_keeps_long_descriptions_compact() {
        let agent = bitfun_core::agentic::agents::AgentInfo {
            id: "deep".to_string(),
            name: "Deep".to_string(),
            description: "Produces a comprehensive deep-research report on any subject using parallel sub-agent orchestration. Dispatches multiple research agents concurrently to investigate different chapters and competitors simultaneously, then synthesizes findings into a cohesive report.".to_string(),
            is_readonly: false,
            tool_count: 3,
            default_tools: vec!["Read".to_string()],
            enabled: true,
            subagent_source: None,
            path: None,
            model: None,
            app_kind: None,
            app_icon: None,
            app_category: None,
            app_path: None,
        };

        let message = agents_registry_message(&[agent]);

        assert!(message.contains("Produces a comprehensive"));
        assert!(message.contains("..."));
        assert!(!message.contains("then synthesizes findings into a cohesive report"));
    }

    #[test]
    fn dispatch_command_is_visible_from_home_and_chat() {
        let home = command_for_slash("/dispatch build feature", CommandScope::Home).unwrap();
        let chat = command_for_slash("/dispatch build feature", CommandScope::Chat).unwrap();

        assert_eq!(home.action, CommandAction::Dispatch);
        assert_eq!(chat.action, CommandAction::Dispatch);
        assert!(home.description.contains("/dispatch <task>"));

        let commands = filtered_commands(CommandScope::Home, "dispatch");
        assert!(commands.iter().any(|command| command.slash == "/dispatch"));
    }

    #[test]
    fn typed_command_action_preserves_args_across_scopes() {
        let home = typed_command_action("dispatch review TUI panels", CommandScope::Home).unwrap();
        let chat = typed_command_action("/dispatch review TUI panels", CommandScope::Chat).unwrap();

        assert_eq!(home.0, CommandAction::Dispatch);
        assert_eq!(home.1, "review TUI panels");
        assert_eq!(chat.0, CommandAction::Dispatch);
        assert_eq!(chat.1, "review TUI panels");
        assert!(typed_command_action("", CommandScope::Home).is_none());
        assert!(typed_command_action("clear", CommandScope::Home).is_none());
        assert_eq!(
            typed_command_action("clear", CommandScope::Chat).unwrap().0,
            CommandAction::ClearChat
        );
    }
}
