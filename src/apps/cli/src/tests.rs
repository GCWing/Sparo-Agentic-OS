use super::*;
use clap::CommandFactory;

fn test_config_commit(
    status: sparo_core::service::config::ConfigCommitStatus,
) -> sparo_core::service::config::PublishedConfigCommit {
    sparo_core::service::config::ConfigCommit {
        commit_id: "cfg-commit-test".to_string(),
        revision: 42,
        status,
        scope: sparo_events::ConfigScope::user(),
        source: sparo_events::ConfigChangeSource {
            kind: sparo_events::ConfigChangeSourceKind::Cli,
            surface: Some("cli".to_string()),
            request_id: Some("request-test".to_string()),
        },
        changes: Vec::new(),
        apply_receipts: Vec::new(),
        affected_sections: Vec::new(),
        restart_required: Vec::new(),
        undo_token: None,
        committed_at: chrono::Utc::now(),
    }
    .published()
}

#[test]
fn config_redaction_masks_nested_secret_fields() {
    let mut value = serde_json::json!({
        "ai": {
            "models": [
                {
                    "name": "demo",
                    "api_key": "sk-secret",
                    "custom_headers": {
                        "Authorization": "Bearer token"
                    }
                }
            ],
            "proxy": {
                "password": "proxy-secret"
            }
        }
    });

    redact_config_value(&mut value);

    assert_eq!(value["ai"]["models"][0]["api_key"], "<redacted>");
    assert_eq!(
        value["ai"]["models"][0]["custom_headers"]["Authorization"],
        "<redacted>"
    );
    assert_eq!(value["ai"]["proxy"]["password"], "<redacted>");
    assert_eq!(value["ai"]["models"][0]["name"], "demo");
}

#[test]
fn should_emit_json_error_detects_global_json_flag() {
    assert!(should_emit_json_error([
        "tasks".to_string(),
        "show".to_string(),
        "last".to_string(),
        "--json".to_string(),
    ]));
    assert!(should_emit_json_error([
        "health".to_string(),
        "--json=true".to_string(),
    ]));
    assert!(!should_emit_json_error([
        "tasks".to_string(),
        "show".to_string(),
        "last".to_string(),
    ]));
    assert!(!should_emit_json_error([
        "exec".to_string(),
        "--".to_string(),
        "--json".to_string(),
    ]));
    assert!(should_emit_json_error([
        "config".to_string(),
        "get".to_string(),
        "ai".to_string(),
    ]));
    assert!(!should_emit_json_error([
        "config".to_string(),
        "validate".to_string(),
    ]));
    assert!(should_emit_json_error([
        "config".to_string(),
        "validate".to_string(),
        "--json".to_string(),
    ]));
    assert!(!should_emit_json_error([
        "config".to_string(),
        "health".to_string(),
    ]));
    assert!(should_emit_json_error([
        "config".to_string(),
        "health".to_string(),
        "--json".to_string(),
    ]));
    assert!(!should_emit_json_error([
        "config".to_string(),
        "import".to_string(),
        "config-export.json".to_string(),
    ]));
    assert!(should_emit_json_error([
        "config".to_string(),
        "import".to_string(),
        "config-export.json".to_string(),
        "--json".to_string(),
    ]));
    assert!(!should_emit_json_error([
        "--verbose".to_string(),
        "config".to_string(),
        "prefs".to_string(),
        "get".to_string(),
    ]));
    assert!(should_emit_json_error([
        "--verbose".to_string(),
        "config".to_string(),
        "prefs".to_string(),
        "get".to_string(),
        "--json".to_string(),
    ]));
    assert!(!should_emit_json_error([
        "tool".to_string(),
        "schema".to_string(),
        "read_file".to_string(),
    ]));
    assert!(should_emit_json_error([
        "tool".to_string(),
        "schema".to_string(),
        "read_file".to_string(),
        "--json".to_string(),
    ]));
    assert!(should_emit_json_error([
        "tool".to_string(),
        "list".to_string(),
        "--json".to_string(),
    ]));
    assert!(should_emit_json_error([
        "tool".to_string(),
        "list".to_string(),
        "--json=false".to_string(),
    ]));
    assert!(should_emit_json_error([
        "agents".to_string(),
        "list".to_string(),
        "--json".to_string(),
    ]));
    assert!(!should_emit_json_error([
        "config".to_string(),
        "prefs".to_string(),
        "get".to_string(),
        "behavior.default_agent".to_string(),
    ]));
    assert!(should_emit_json_error([
        "config".to_string(),
        "prefs".to_string(),
        "get".to_string(),
        "behavior.default_agent".to_string(),
        "--json".to_string(),
    ]));
}

#[test]
fn cli_parse_errors_can_be_structured_when_json_was_requested() {
    let args = ["sparo", "health", "--json", "--bogus"];
    let equals_args = ["sparo", "health", "--json=true"];

    assert!(should_emit_json_error(
        args.iter().skip(1).map(|arg| arg.to_string())
    ));
    assert!(cli_parse_error_message(&args)
        .unwrap()
        .contains("unexpected argument '--bogus'"));
    assert!(should_emit_json_error(
        equals_args.iter().skip(1).map(|arg| arg.to_string())
    ));
    assert!(cli_parse_error_message(&equals_args)
        .unwrap()
        .contains("unexpected value 'true'"));
    assert!(cli_parse_error_message(&["sparo", "--help"]).is_none());
}

#[test]
fn command_requests_json_tracks_structured_output_commands() {
    assert!(command_requests_json(&Some(Commands::Batch {
        tasks: None,
        example: None,
        json: true,
        timeout_secs: 600,
        continue_on_error: false,
    })));
    assert!(command_requests_json(&Some(Commands::Health {
        json: true
    })));
    assert!(command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Get {
            setting_id: "core.ai.models".to_string(),
        },
    })));
    assert!(command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Export,
    })));
    assert!(command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Show { json: true },
    })));
    assert!(command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Catalog {
            query: None,
            json: true,
        },
    })));
    assert!(command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Set {
            setting_id: "core.ai.default_models.primary".to_string(),
            value: "demo".to_string(),
            json: true,
            yes: false,
        },
    })));
    assert!(command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Reset {
            setting_id: "core.ai.default_models.primary".to_string(),
            json: true,
            yes: false,
        },
    })));
    assert!(command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Import {
            file: "config-export.json".to_string(),
            json: true,
            yes: false,
        },
    })));
    assert!(command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Validate { json: true },
    })));
    assert!(command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Health { json: true },
    })));
    assert!(!command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Prefs {
            action: PrefsAction::Get {
                path: None,
                json: false,
            },
        },
    })));
    assert!(command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Prefs {
            action: PrefsAction::Get {
                path: None,
                json: true,
            },
        },
    })));
    assert!(!command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Prefs {
            action: PrefsAction::Set {
                path: "ui.show_tips".to_string(),
                value: "false".to_string(),
                json: false,
            },
        },
    })));
    assert!(command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Prefs {
            action: PrefsAction::Set {
                path: "ui.show_tips".to_string(),
                value: "false".to_string(),
                json: true,
            },
        },
    })));
    assert!(command_requests_json(&Some(Commands::Tool {
        action: ToolAction::List { json: true },
    })));
    assert!(!command_requests_json(&Some(Commands::Tool {
        action: ToolAction::Schema {
            name: "read_file".to_string(),
            workspace: None,
            json: false,
        },
    })));
    assert!(command_requests_json(&Some(Commands::Tool {
        action: ToolAction::Schema {
            name: "read_file".to_string(),
            workspace: None,
            json: true,
        },
    })));
    assert!(command_requests_json(&Some(Commands::Tool {
        action: ToolAction::Run {
            name: "read_file".to_string(),
            params: None,
            params_file: None,
            workspace: None,
            json: true,
        },
    })));
    assert!(command_requests_json(&Some(Commands::Agents {
        action: AgentsAction::List,
        json: true,
    })));
    assert!(!command_requests_json(&Some(Commands::Chat {
        agent: None,
        workspace: None,
    })));
    assert!(!command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Show { json: false },
    })));
    assert!(!command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Set {
            setting_id: "core.ai.default_models.primary".to_string(),
            value: "demo".to_string(),
            json: false,
            yes: false,
        },
    })));
    assert!(!command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Validate { json: false },
    })));
    assert!(!command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Import {
            file: "config-export.json".to_string(),
            json: false,
            yes: false,
        },
    })));
    assert!(!command_requests_json(&Some(Commands::Config {
        action: ConfigAction::Health { json: false },
    })));
    assert!(!command_requests_json(&Some(Commands::Tool {
        action: ToolAction::List { json: false },
    })));
    assert!(!command_requests_json(&Some(Commands::Tool {
        action: ToolAction::Run {
            name: "read_file".to_string(),
            params: None,
            params_file: None,
            workspace: None,
            json: false,
        },
    })));
    assert!(!command_requests_json(&Some(Commands::Batch {
        tasks: None,
        example: None,
        json: false,
        timeout_secs: 600,
        continue_on_error: false,
    })));
    assert!(!command_requests_json(&Some(Commands::Agents {
        action: AgentsAction::List,
        json: false,
    })));
}

#[test]
fn pre_config_dispatch_is_limited_to_readonly_discovery_commands() {
    assert!(can_dispatch_before_cli_config(&Some(
        Commands::Workspaces {
            action: WorkspacesAction::List,
            json: true,
        }
    )));
    assert!(can_dispatch_before_cli_config(&Some(Commands::Tool {
        action: ToolAction::List { json: true },
    })));
    assert!(!can_dispatch_before_cli_config(&Some(Commands::Apps {
        action: AppsAction::Show {
            id: "cursor-bridge".to_string(),
        },
        json: true,
    })));
    assert!(!can_dispatch_before_cli_config(&Some(Commands::Memory {
        action: MemoryAction::List,
        workspace: None,
        json: true,
    })));
    assert!(!can_dispatch_before_cli_config(&Some(Commands::Tasks {
        action: TasksAction::Show {
            id: "last".to_string(),
        },
        workspace: None,
        json: true,
    })));
    assert!(can_use_default_config_silently(&Some(Commands::Apps {
        action: AppsAction::Show {
            id: "cursor-bridge".to_string(),
        },
        json: false,
    })));
    assert!(can_use_default_config_silently(&Some(Commands::Sessions {
        domain: CliSessionDomain::OsAgent,
        action: SessionAction::Export {
            id: "last".to_string(),
            output: None,
            format: SessionExportFormat::Markdown,
        },
        workspace: None,
        json: false,
    })));
    assert!(can_use_default_config_silently(&Some(Commands::Tasks {
        action: TasksAction::Export {
            id: "last".to_string(),
            output: None,
            format: SessionExportFormat::Markdown,
        },
        workspace: None,
        json: false,
    })));
    assert!(can_use_default_config_silently(&Some(Commands::Agents {
        action: AgentsAction::List,
        json: false,
    })));
    assert!(!can_use_default_config_silently(&Some(
        Commands::Sessions {
            domain: CliSessionDomain::OsAgent,
            action: SessionAction::Delete {
                id: "session-1".to_string(),
            },
            workspace: None,
            json: false,
        }
    )));
    assert!(!can_dispatch_before_cli_config(&Some(
        Commands::Workspaces {
            action: WorkspacesAction::Use {
                id: "global".to_string(),
            },
            json: true,
        }
    )));
    assert!(!can_dispatch_before_cli_config(&Some(Commands::Apps {
        action: AppsAction::Open {
            id: "cursor-bridge".to_string(),
        },
        json: true,
    })));
    assert!(!can_dispatch_before_cli_config(&Some(Commands::Tasks {
        action: TasksAction::Resume {
            id: "last".to_string(),
            message: None,
        },
        workspace: None,
        json: false,
    })));
}

#[test]
fn invalid_cli_config_is_required_for_tui_and_prefs_only() {
    assert!(requires_valid_cli_config(&None, true));
    assert!(requires_valid_cli_config(
        &Some(Commands::Chat {
            agent: None,
            workspace: None,
        }),
        true
    ));
    assert!(requires_valid_cli_config(
        &Some(Commands::Config {
            action: ConfigAction::Prefs {
                action: PrefsAction::Get {
                    path: None,
                    json: true,
                },
            },
        }),
        false
    ));
    assert!(!requires_valid_cli_config(
        &Some(Commands::Agents {
            action: AgentsAction::List,
            json: false,
        }),
        false
    ));
    assert!(!requires_valid_cli_config(
        &Some(Commands::Sessions {
            domain: CliSessionDomain::OsAgent,
            action: SessionAction::List,
            workspace: None,
            json: false,
        }),
        false
    ));
}

#[test]
fn directory_health_distinguishes_missing_dirs_and_files() {
    let temp_root =
        std::env::temp_dir().join(format!("sparo-cli-health-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_root).expect("create temp health root");
    let existing_dir = temp_root.join("existing");
    std::fs::create_dir_all(&existing_dir).expect("create temp health dir");
    let existing_file = temp_root.join("workspaces");
    std::fs::write(&existing_file, "not a directory").expect("create temp health file");

    let dir_health = directory_health(&existing_dir);
    assert!(dir_health.exists);
    assert!(dir_health.is_dir);
    assert!(dir_health.readable);
    assert_eq!(dir_health.kind, "directory");
    assert_eq!(dir_health.status, "ok");
    assert!(dir_health.error.is_none());
    assert!(dir_health.hint.is_none());

    let missing_health = directory_health(&temp_root.join("missing"));
    assert!(!missing_health.exists);
    assert!(!missing_health.is_dir);
    assert!(!missing_health.readable);
    assert_eq!(missing_health.kind, "directory");
    assert_eq!(missing_health.status, "missing");
    assert!(missing_health.error.is_none());
    assert_eq!(
        missing_health.hint.as_deref(),
        Some("Directory has not been created yet; Sparo will create it when needed.")
    );

    let file_health = directory_health(&existing_file);
    assert!(file_health.exists);
    assert!(!file_health.is_dir);
    assert!(!file_health.readable);
    assert_eq!(file_health.kind, "directory");
    assert_eq!(file_health.status, "not_directory");
    assert_eq!(
        file_health.error.as_deref(),
        Some("Path exists but is not a directory")
    );
    assert_eq!(
        file_health.hint.as_deref(),
        Some("Move or rename the file at this path, then run the command again.")
    );

    std::fs::remove_file(existing_file).expect("remove temp health file");
    std::fs::remove_dir_all(temp_root).expect("remove temp health root");
}

#[test]
fn file_health_distinguishes_files_missing_and_directories() {
    let temp_root = std::env::temp_dir().join(format!(
        "sparo-cli-file-health-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_root).expect("create temp file health root");
    let config_file = temp_root.join("config.toml");
    std::fs::write(&config_file, "ui.theme = \"dark\"").expect("create temp config file");
    let directory_at_file_path = temp_root.join("config-dir.toml");
    std::fs::create_dir_all(&directory_at_file_path).expect("create temp directory at file path");

    let file = file_health(&config_file);
    assert!(file.exists);
    assert!(!file.is_dir);
    assert!(file.readable);
    assert_eq!(file.kind, "file");
    assert_eq!(file.status, "ok");
    assert!(file.hint.is_none());

    let missing = file_health(&temp_root.join("missing.toml"));
    assert_eq!(missing.kind, "file");
    assert_eq!(missing.status, "missing");
    assert_eq!(
        missing.hint.as_deref(),
        Some("Directory has not been created yet; Sparo will create it when needed.")
    );

    let directory = file_health(&directory_at_file_path);
    assert_eq!(directory.kind, "file");
    assert_eq!(directory.status, "not_file");
    assert_eq!(
        directory.error.as_deref(),
        Some("Path exists but is not a file")
    );
    assert_eq!(
        directory.hint.as_deref(),
        Some("Move or rename the directory at this path, then run the command again.")
    );

    std::fs::remove_dir_all(temp_root).expect("remove temp file health root");
}

#[test]
fn cli_config_file_health_validates_toml_content() {
    let temp_root = std::env::temp_dir().join(format!(
        "sparo-cli-config-health-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_root).expect("create temp config health root");
    let valid_config = temp_root.join("valid.toml");
    std::fs::write(
        &valid_config,
        toml::to_string_pretty(&CliConfig::default()).expect("serialize default config"),
    )
    .expect("write valid config");
    let invalid_config = temp_root.join("invalid.toml");
    std::fs::write(&invalid_config, "ui.theme = [").expect("write invalid config");
    let shortcut_conflict_config = temp_root.join("shortcut-conflict.toml");
    let mut conflicting = CliConfig::default();
    conflicting.shortcuts.send_message = "Ctrl+C".to_string();
    std::fs::write(
        &shortcut_conflict_config,
        toml::to_string_pretty(&conflicting).expect("serialize conflicting config"),
    )
    .expect("write conflicting config");
    let invalid_shortcut_config = temp_root.join("invalid-shortcut.toml");
    let mut invalid_shortcut = CliConfig::default();
    invalid_shortcut.shortcuts.interrupt = "Ctrl+Delete".to_string();
    std::fs::write(
        &invalid_shortcut_config,
        toml::to_string_pretty(&invalid_shortcut).expect("serialize invalid shortcut config"),
    )
    .expect("write invalid shortcut config");
    let reserved_shortcut_config = temp_root.join("reserved-shortcut.toml");
    let mut reserved_shortcut = CliConfig::default();
    reserved_shortcut.shortcuts.send_message = "Esc".to_string();
    reserved_shortcut.shortcuts.menu = "Ctrl+B".to_string();
    std::fs::write(
        &reserved_shortcut_config,
        toml::to_string_pretty(&reserved_shortcut).expect("serialize reserved shortcut config"),
    )
    .expect("write reserved shortcut config");
    let invalid_theme_config = temp_root.join("invalid-theme.toml");
    let mut invalid_theme = CliConfig::default();
    invalid_theme.ui.theme = "neon".to_string();
    std::fs::write(
        &invalid_theme_config,
        toml::to_string_pretty(&invalid_theme).expect("serialize invalid theme config"),
    )
    .expect("write invalid theme config");
    let invalid_color_scheme_config = temp_root.join("invalid-color-scheme.toml");
    let mut invalid_color_scheme = CliConfig::default();
    invalid_color_scheme.ui.color_scheme = "infrared".to_string();
    std::fs::write(
        &invalid_color_scheme_config,
        toml::to_string_pretty(&invalid_color_scheme)
            .expect("serialize invalid color scheme config"),
    )
    .expect("write invalid color scheme config");
    let empty_default_agent_config = temp_root.join("empty-default-agent.toml");
    let mut empty_default_agent = CliConfig::default();
    empty_default_agent.behavior.default_agent = "  ".to_string();
    std::fs::write(
        &empty_default_agent_config,
        toml::to_string_pretty(&empty_default_agent).expect("serialize empty default agent config"),
    )
    .expect("write empty default agent config");

    let valid = cli_config_file_health(&valid_config);
    assert_eq!(valid.status, "ok");
    assert!(valid.error.is_none());
    assert!(valid.hint.is_none());

    let invalid = cli_config_file_health(&invalid_config);
    assert_eq!(invalid.status, "invalid_config");
    assert!(invalid.error.is_some());
    assert_eq!(
        invalid.hint.as_deref(),
        Some("Fix the config file syntax or move the file aside so Sparo can recreate defaults.")
    );

    let shortcut_conflict = cli_config_file_health(&shortcut_conflict_config);
    assert_eq!(shortcut_conflict.status, "invalid_config");
    assert!(shortcut_conflict
        .error
        .as_deref()
        .is_some_and(|error| error.contains("shortcuts.send_message and shortcuts.interrupt")));
    assert_eq!(
        shortcut_conflict.hint.as_deref(),
        Some("Fix the config file syntax or move the file aside so Sparo can recreate defaults.")
    );

    let invalid_shortcut = cli_config_file_health(&invalid_shortcut_config);
    assert_eq!(invalid_shortcut.status, "invalid_config");
    assert!(invalid_shortcut
        .error
        .as_deref()
        .is_some_and(|error| error.contains("shortcuts.interrupt has an invalid shortcut")));

    let reserved_shortcut = cli_config_file_health(&reserved_shortcut_config);
    assert_eq!(reserved_shortcut.status, "invalid_config");
    assert!(reserved_shortcut
        .error
        .as_deref()
        .is_some_and(|error| error.contains("shortcuts.send_message cannot use Esc")));

    let invalid_theme = cli_config_file_health(&invalid_theme_config);
    assert_eq!(invalid_theme.status, "invalid_config");
    assert!(invalid_theme
        .error
        .as_deref()
        .is_some_and(|error| error.contains("ui.theme must be one of")));

    let invalid_color_scheme = cli_config_file_health(&invalid_color_scheme_config);
    assert_eq!(invalid_color_scheme.status, "invalid_config");
    assert!(invalid_color_scheme
        .error
        .as_deref()
        .is_some_and(|error| error.contains("ui.color_scheme must be one of")));

    let empty_default_agent = cli_config_file_health(&empty_default_agent_config);
    assert_eq!(empty_default_agent.status, "invalid_config");
    assert!(empty_default_agent
        .error
        .as_deref()
        .is_some_and(|error| error.contains("behavior.default_agent cannot be empty")));

    std::fs::remove_dir_all(temp_root).expect("remove temp config health root");
}

#[test]
fn global_config_file_health_validates_json_content() {
    let temp_root = std::env::temp_dir().join(format!(
        "sparo-global-config-health-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_root).expect("create temp global config health root");
    let valid_config = temp_root.join("app.json");
    std::fs::write(
        &valid_config,
        serde_json::to_string_pretty(&sparo_core::service::config::GlobalConfig::default())
            .expect("serialize default global config"),
    )
    .expect("write valid global config");
    let invalid_config = temp_root.join("invalid-app.json");
    std::fs::write(&invalid_config, "{").expect("write invalid global config");

    let valid = global_config_file_health(&valid_config);
    assert_eq!(valid.status, "ok");
    assert!(valid.error.is_none());
    assert!(valid.hint.is_none());

    let invalid = global_config_file_health(&invalid_config);
    assert_eq!(invalid.status, "invalid_config");
    assert!(invalid.error.is_some());
    assert_eq!(
        invalid.hint.as_deref(),
        Some("Fix the config file syntax or move the file aside so Sparo can recreate defaults.")
    );

    std::fs::remove_dir_all(temp_root).expect("remove temp global config health root");
}

#[test]
fn help_text_mentions_task_last_and_workspace_defaults() {
    let help = Cli::command().render_long_help().to_string();
    assert!(help.contains("Manage backend-tracked agent tasks"));

    let mut command = Cli::command();
    let exec_help = command
        .find_subcommand_mut("exec")
        .unwrap()
        .render_long_help()
        .to_string();
    assert!(exec_help.contains("workspace.default_path"));

    let tasks_help = command
        .find_subcommand_mut("tasks")
        .unwrap()
        .render_long_help()
        .to_string();
    assert!(tasks_help.contains("session id, title, or \"last\""));
    assert!(tasks_help.contains("Show the most recent backend-tracked task"));
}

#[test]
fn last_shortcuts_parse_to_recent_session_and_task_actions() {
    let cli = Cli::try_parse_from(["sparo", "sessions", "--domain", "os-agent", "last"]).unwrap();
    match cli.command {
        Some(Commands::Sessions {
            action: SessionAction::Last,
            ..
        }) => {}
        _ => panic!("expected sessions last shortcut"),
    }

    let cli = Cli::try_parse_from(["sparo", "tasks", "last"]).unwrap();
    match cli.command {
        Some(Commands::Tasks {
            action: TasksAction::Last,
            ..
        }) => {}
        _ => panic!("expected tasks last shortcut"),
    }
}

#[test]
fn tool_run_help_mentions_loose_params() {
    let mut command = Cli::command();
    let tool_help = command
        .find_subcommand_mut("tool")
        .unwrap()
        .find_subcommand_mut("run")
        .unwrap()
        .render_long_help()
        .to_string();
    assert!(tool_help.contains("loose flat object"));
}

#[test]
fn tool_list_help_mentions_json_output() {
    let mut command = Cli::command();
    let tool_help = command
        .find_subcommand_mut("tool")
        .unwrap()
        .find_subcommand_mut("list")
        .unwrap()
        .render_long_help()
        .to_string();
    assert!(tool_help.contains("Output raw JSON"));
}

#[test]
fn tool_schema_help_mentions_json_output() {
    let mut command = Cli::command();
    let tool_help = command
        .find_subcommand_mut("tool")
        .unwrap()
        .find_subcommand_mut("schema")
        .unwrap()
        .render_long_help()
        .to_string();
    assert!(tool_help.contains("Output raw JSON"));
}

#[test]
fn tool_schema_human_lines_summarize_fields_and_actions() {
    let response = sparo_core::command::tool::ToolSchemaResponse {
        name: "LS".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "required": ["path"],
            "properties": {
                "path": {
                    "type": "string",
                    "description": "The absolute path to the directory to list."
                },
                "limit": {
                    "type": "number",
                    "description": "The maximum number of entries to return."
                }
            }
        }),
        model_input_schema: serde_json::json!({
            "type": "object",
            "required": ["path"],
            "properties": {
                "path": { "type": "string" }
            }
        }),
    };

    let output = tool_schema_human_lines(&response, Some("D:\\workspace\\my project")).join("\n");

    assert!(output.contains("Tool Schema: LS"));
    assert!(output.contains("Workspace context: D:\\workspace\\my project"));
    assert!(output.contains("limit (optional, number) - The maximum number"));
    assert!(output.contains("path (required, string) - The absolute path"));
    assert!(output.contains("Model-facing schema: differs from runtime schema"));
    assert!(output.contains(
            "Run tool: sparo tool run LS --workspace \"D:\\workspace\\my project\" --params-file <file>"
        ));
    assert!(output.contains(
        "Machine output: sparo tool schema LS --workspace \"D:\\workspace\\my project\" --json"
    ));
}

#[test]
fn tool_list_human_lines_include_next_actions() {
    let lines = tool_list_human_lines(&[sparo_core::command::tool::ToolInfo {
        name: "search_files".to_string(),
        user_facing_name: "Search Files".to_string(),
        description: "Search workspace files\nwith extra details".to_string(),
        readonly: true,
        enabled: true,
        supports_streaming: false,
    }]);

    assert!(lines.contains(&"Available Tools (total 1, enabled 1, readonly 1)".to_string()));
    assert!(lines.contains(&"search_files [readonly]".to_string()));
    assert!(lines.contains(&"  Search workspace files".to_string()));
    assert!(lines.contains(&"  Inspect schema: sparo tool schema search_files --json".to_string()));
    assert!(lines.contains(
        &"  Run tool: sparo tool run search_files --params '{\"key\":\"value\"}'".to_string()
    ));
    assert!(lines.contains(&"  Workspace scope: add --workspace <path> to schema/run".to_string()));
    assert!(lines.contains(&"  Machine output: sparo tool list --json".to_string()));
}

#[test]
fn tool_list_human_lines_empty_state_still_guides_next_step() {
    let lines = tool_list_human_lines(&[]);

    assert!(lines.contains(&"Available Tools (total 0, enabled 0, readonly 0)".to_string()));
    assert!(lines.contains(&"No tools available.".to_string()));
    assert!(
        lines.contains(&"  Inspect schema: sparo tool schema \"<tool-name>\" --json".to_string())
    );
}

#[test]
fn tool_run_human_lines_surface_content_and_next_actions() {
    let response = sparo_core::command::tool::ExecuteToolResponse {
        tool_name: "read_file".to_string(),
        results: Vec::new(),
        display_results: vec![serde_json::json!({
            "content": "line one\nline two",
            "assistant": {
                "path": "src/main.rs",
                "truncated": false
            }
        })],
    };

    let output = tool_run_human_lines(&response, Some("D:\\workspace\\my project")).join("\n");

    assert!(output.contains("Tool: read_file"));
    assert!(output.contains("Content:\n  line one\n  line two"));
    assert!(output.contains("Assistant context:\n  {"));
    assert!(output.contains("\"path\": \"src/main.rs\""));
    assert!(output.contains(
            "Inspect schema: sparo tool schema read_file --workspace \"D:\\workspace\\my project\" --json"
        ));
    assert!(output.contains(
            "Rerun with JSON: sparo tool run read_file --workspace \"D:\\workspace\\my project\" --params-file <file> --json"
        ));
}

#[test]
fn tool_run_human_lines_explain_empty_results() {
    let response = sparo_core::command::tool::ExecuteToolResponse {
        tool_name: "noop".to_string(),
        results: Vec::new(),
        display_results: Vec::new(),
    };

    let output = tool_run_human_lines(&response, None).join("\n");

    assert!(output.contains("No display results returned."));
    assert!(output.contains("Inspect schema: sparo tool schema noop --json"));
    assert!(output.contains("Rerun with JSON: sparo tool run noop --params-file <file> --json"));
}

#[test]
fn config_prefs_get_help_mentions_json_output() {
    let mut command = Cli::command();
    let prefs_get_help = command
        .find_subcommand_mut("config")
        .unwrap()
        .find_subcommand_mut("prefs")
        .unwrap()
        .find_subcommand_mut("get")
        .unwrap()
        .render_long_help()
        .to_string();
    assert!(prefs_get_help.contains("Output raw JSON"));

    let mut command = Cli::command();
    let prefs_set_help = command
        .find_subcommand_mut("config")
        .unwrap()
        .find_subcommand_mut("prefs")
        .unwrap()
        .find_subcommand_mut("set")
        .unwrap()
        .render_long_help()
        .to_string();
    assert!(prefs_set_help.contains("behavior.confirm_dangerous"));
    assert!(prefs_set_help.contains("shortcuts.send_message"));
}

#[test]
fn structured_config_subcommands_accept_json_flag() {
    let mut command = Cli::command();
    for subcommand in [
        "get", "set", "reset", "export", "import", "validate", "reload", "health",
    ] {
        let help = command
            .find_subcommand_mut("config")
            .unwrap()
            .find_subcommand_mut(subcommand)
            .unwrap()
            .render_long_help()
            .to_string();
        assert!(
            help.contains("Output raw JSON"),
            "missing --json help for config {}",
            subcommand
        );
    }
}

#[test]
fn health_help_mentions_json_output() {
    let mut command = Cli::command();
    let help = command
        .find_subcommand_mut("health")
        .unwrap()
        .render_long_help()
        .to_string();
    assert!(help.contains("Output in JSON format"));
}

#[test]
fn agents_help_mentions_live_registry_and_json_output() {
    let mut command = Cli::command();
    let help = command
        .find_subcommand_mut("agents")
        .unwrap()
        .render_long_help()
        .to_string();
    assert!(help.contains("Inspect available agents"));
    assert!(help.contains("Output in JSON format"));
    assert!(help.contains("List available built-in, app-backed, and custom agents"));
}

#[test]
fn batch_help_mentions_example_output() {
    let mut command = Cli::command();
    let help = command
        .find_subcommand_mut("batch")
        .unwrap()
        .render_long_help()
        .to_string();
    assert!(help.contains("Print an example batch task file and exit"));
    assert!(help.contains("--tasks <TASKS>"));
}

#[test]
fn json_already_emitted_marker_is_suppressed() {
    let error = anyhow::anyhow!(JSON_OUTPUT_ALREADY_EMITTED);
    assert_eq!(error.to_string(), JSON_OUTPUT_ALREADY_EMITTED);
    let error = anyhow::anyhow!(CLI_OUTPUT_ALREADY_EMITTED);
    assert_eq!(error.to_string(), CLI_OUTPUT_ALREADY_EMITTED);
}

#[test]
fn cli_health_success_reads_script_contract_flag() {
    assert!(cli_health_success(&serde_json::json!({ "success": true })));
    assert!(!cli_health_success(
        &serde_json::json!({ "success": false })
    ));
    assert!(!cli_health_success(&serde_json::json!({})));
}

#[test]
fn command_modes_choose_blocking_confirmation_only_for_interactive_surfaces() {
    assert!(exec_skip_tool_confirmation(false));
    assert!(!exec_skip_tool_confirmation(true));
}

#[test]
fn default_agent_pref_fills_missing_cli_agent() {
    let mut config = CliConfig::default();
    config.behavior.default_agent = "bitfun-debug".to_string();

    assert_eq!(effective_cli_agent(&config, None), "bitfun-debug");
    assert_eq!(effective_cli_agent(&config, Some("")), "bitfun-debug");
    assert_eq!(
        effective_cli_agent(&config, Some("bitfun-plan")),
        "bitfun-plan"
    );
}

#[test]
fn cli_default_agent_matches_core_registry_default() {
    let config = CliConfig::default();
    let registry = sparo_core::agentic::agents::get_agent_registry();
    let registry_default = registry.default_agent_type();

    assert_eq!(config.behavior.default_agent, registry_default);
    assert_eq!(registry_default, "Runno");
}

#[test]
fn cli_health_includes_app_storage_checks() {
    let health = cli_health_value().expect("build cli health value");
    let checks = health["checks"]
        .as_object()
        .expect("health checks should be an object");

    for key in [
        "apps",
        "components",
        "product_app_runtime_hosts",
        "agent_components",
        "bridge_components",
    ] {
        assert!(checks.contains_key(key), "missing health check: {key}");
    }
}

#[test]
fn cli_health_includes_memory_storage_checks() {
    let health = cli_health_value().expect("build cli health value");
    let checks = health["checks"]
        .as_object()
        .expect("health checks should be an object");

    for key in ["agentic_os_memory", "workspace_memory"] {
        assert!(checks.contains_key(key), "missing health check: {key}");
    }
}

#[test]
fn cli_health_includes_session_storage_checks() {
    let health = cli_health_value().expect("build cli health value");
    let checks = health["checks"]
        .as_object()
        .expect("health checks should be an object");

    for key in [
        "sessions",
        "os_agent_sessions",
        "global_sessions",
        "workspace_sessions",
        "works",
        "runs",
        "app_data",
        "services",
    ] {
        assert!(checks.contains_key(key), "missing health check: {key}");
    }
}

#[test]
fn health_summary_counts_problem_checks() {
    let summary = health_summary(&serde_json::json!({
        "app_root": { "status": "ok" },
        "logs": {
            "kind": "directory",
            "status": "missing",
            "path": "C:\\sparo\\logs",
            "hint": "Created when needed"
        },
        "workspaces": {
            "kind": "directory",
            "status": "inaccessible",
            "path": "C:\\sparo\\workspaces",
            "hint": "Check permissions"
        },
        "skills": {
            "kind": "directory",
            "status": "not_directory",
            "path": "C:\\sparo\\skills"
        }
    }));

    assert_eq!(summary["total"], 4);
    assert_eq!(summary["ok"], 1);
    assert_eq!(summary["missing"], 1);
    assert_eq!(
        summary["missing_checks"].as_array().unwrap(),
        &vec![serde_json::Value::String("logs".to_string())]
    );
    assert_eq!(summary["missing_details"][0]["name"], "logs");
    assert_eq!(summary["missing_details"][0]["kind"], "directory");
    assert_eq!(summary["missing_details"][0]["status"], "missing");
    assert_eq!(summary["missing_details"][0]["path"], "C:\\sparo\\logs");
    assert_eq!(summary["missing_details"][0]["hint"], "Created when needed");
    assert_eq!(summary["problems"], 2);
    assert_eq!(
        summary["problem_checks"].as_array().unwrap(),
        &vec![
            serde_json::Value::String("skills".to_string()),
            serde_json::Value::String("workspaces".to_string())
        ]
    );
    assert_eq!(summary["problem_details"][0]["name"], "skills");
    assert_eq!(summary["problem_details"][0]["kind"], "directory");
    assert_eq!(summary["problem_details"][0]["status"], "not_directory");
    assert_eq!(summary["problem_details"][0]["path"], "C:\\sparo\\skills");
    assert_eq!(summary["problem_details"][1]["name"], "workspaces");
    assert_eq!(summary["problem_details"][1]["hint"], "Check permissions");
}

#[test]
fn health_next_steps_deduplicates_problem_hints() {
    let health = serde_json::json!({
        "checks": {
            "ok": { "status": "ok", "hint": "No action" },
            "missing": { "status": "missing", "hint": "Created when needed" },
            "apps": { "status": "inaccessible", "hint": "Check permissions" },
            "sessions": { "status": "inaccessible", "hint": "Check permissions" },
            "config": { "status": "invalid_config", "hint": "Fix config syntax" }
        }
    });

    assert_eq!(
        health_next_steps(&health),
        vec![
            "Check permissions".to_string(),
            "Fix config syntax".to_string()
        ]
    );
}

#[test]
fn healthy_health_next_steps_keep_success_output_actionable() {
    assert_eq!(
        healthy_health_next_steps(),
        vec![
            "Start interactive chat: sparo chat".to_string(),
            "Inspect CLI preferences: sparo config prefs get".to_string(),
            "Inspect shared config: sparo config show".to_string(),
            "Machine output: sparo health --json".to_string(),
        ]
    );
}

#[test]
fn cli_error_hint_points_runtime_directory_failures_to_health() {
    let error = anyhow::anyhow!("initialize_global_config: Failed to create directory");
    assert_eq!(
        cli_error_hint(&error),
        Some("Run `sparo health` to diagnose Sparo CLI data directory access.")
    );
    assert_eq!(cli_error_kind(&error), "runtime_directory_error");

    let unrelated = anyhow::anyhow!("Tool not found: ReadFile");
    assert_eq!(
        cli_error_hint(&unrelated),
        Some("Run `sparo tool list` to see registered core tools.")
    );
    assert_eq!(cli_error_kind(&unrelated), "execution_error");
}

#[test]
fn cli_error_hints_keep_panel_empty_states_actionable() {
    let no_tasks = anyhow::anyhow!("No backend-tracked agent tasks found");
    assert_eq!(cli_error_kind(&no_tasks), "execution_error");
    assert_eq!(
            cli_error_hint(&no_tasks),
            Some(
                "Start work with `sparo chat`, or run `sparo sessions list` to inspect saved conversations."
            )
        );

    let missing_memory = anyhow::anyhow!("Memory file not found: project:notes.md");
    assert_eq!(cli_error_kind(&missing_memory), "execution_error");
    assert_eq!(
        cli_error_hint(&missing_memory),
        Some("Run `sparo memory list` to see available global and project memory files.")
    );

    let missing_app = anyhow::anyhow!("Intelligent App not found: files");
    assert_eq!(cli_error_kind(&missing_app), "execution_error");
    assert_eq!(
        cli_error_hint(&missing_app),
        Some("Run `sparo apps list` to see Intelligent Apps in the effective activation scope.")
    );

    let cli_launch =
        anyhow::anyhow!("CLI Intelligent App launch is unavailable for 'Dashboard' (dashboard)");
    assert_eq!(cli_error_kind(&cli_launch), "execution_error");
    assert_eq!(
            cli_error_hint(&cli_launch),
            Some("Open Sparo Desktop Apps Center and launch the selected Intelligent App into a Work; the CLI never falls back to opening package files.")
        );

    let no_sessions = anyhow::anyhow!("No history sessions");
    assert_eq!(cli_error_kind(&no_sessions), "execution_error");
    assert_eq!(
            cli_error_hint(&no_sessions),
            Some(
                "Start a session with `sparo chat`, or run `sparo exec \"<message>\"` for a one-shot task."
            )
        );

    let session_resume_json =
        anyhow::anyhow!("sessions resume is interactive and does not support --json");
    assert_eq!(cli_error_kind(&session_resume_json), "execution_error");
    assert_eq!(
            cli_error_hint(&session_resume_json),
            Some(
                "Run `sparo sessions resume <id>` without `--json`, or use `sparo sessions show <id> --json` for scriptable inspection."
            )
        );

    let task_resume_json =
        anyhow::anyhow!("tasks resume is interactive and does not support --json");
    assert_eq!(cli_error_kind(&task_resume_json), "execution_error");
    assert_eq!(
            cli_error_hint(&task_resume_json),
            Some(
                "Run `sparo tasks resume <id>` without `--json`, or use `sparo tasks show <id> --json` for scriptable inspection."
            )
        );

    let task_without_session = anyhow::anyhow!("Task has no persisted session id: review");
    assert_eq!(cli_error_kind(&task_without_session), "execution_error");
    assert_eq!(
            cli_error_hint(&task_without_session),
            Some(
                "Use `sparo tasks resume <id-or-title>` to continue the task in the TUI; task export requires a persisted session transcript."
            )
        );

    let missing_batch = anyhow::anyhow!("Failed to read batch task file: missing.json");
    assert_eq!(cli_error_kind(&missing_batch), "execution_error");
    assert_eq!(
            cli_error_hint(&missing_batch),
            Some(
                "Run `sparo batch --example json` or `sparo batch --example toml` to generate a starter task file."
            )
        );

    let invalid_batch = anyhow::anyhow!("Invalid JSON batch task file: tasks.json");
    assert_eq!(cli_error_kind(&invalid_batch), "execution_error");
    assert_eq!(
            cli_error_hint(&invalid_batch),
            Some(
                "Compare the file with `sparo batch --example json` or `sparo batch --example toml`, then fix the task syntax."
            )
        );

    let invalid_tool_params = anyhow::anyhow!("Invalid parameters for tool Bash");
    assert_eq!(cli_error_kind(&invalid_tool_params), "execution_error");
    assert_eq!(
            cli_error_hint(&invalid_tool_params),
            Some(
                "Use `sparo tool schema <name> --json` to inspect parameters, or pass complex input with `--params-file <file>`."
            )
        );

    let misplaced_workspace = anyhow::anyhow!(
        "error: unexpected argument '--workspace' found\n\n  tip: 'show --workspace' exists"
    );
    assert_eq!(cli_error_kind(&misplaced_workspace), "cli_parse_error");
    assert_eq!(
            cli_error_hint(&misplaced_workspace),
            Some(
                "Place `--workspace <path>` after the subcommand that accepts it, for example `sparo tool run --workspace <path> <name>` or `sparo memory show --workspace <path> <id>`."
            )
        );
}

#[test]
fn cli_error_kind_classifies_parse_errors() {
    let error = anyhow::anyhow!("error: unexpected argument '--json' found");

    assert_eq!(cli_error_kind(&error), "cli_parse_error");
}

#[test]
fn cli_error_chain_preserves_context_and_source() {
    let source = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied");
    let error = anyhow::Error::new(source).context("Failed to access CLI config file");

    let causes = cli_error_chain(&error);

    assert_eq!(causes[0], "Failed to access CLI config file");
    assert_eq!(causes[1], "denied");
}

#[test]
fn read_tool_params_rejects_multiple_sources() {
    let result = read_tool_params(Some("{}".to_string()), Some("params.json".to_string()));
    assert!(result.is_err());
}

#[test]
fn read_tool_params_accepts_inline_json() {
    let value = read_tool_params(Some(r#"{"path":"."}"#.to_string()), None).unwrap();
    assert_eq!(value["path"], ".");
}

#[test]
fn read_tool_params_accepts_loose_flat_object() {
    let value = read_tool_params(
        Some("{path:src/apps/cli/src,depth:1,readonly:true}".to_string()),
        None,
    )
    .unwrap();
    assert_eq!(value["path"], "src/apps/cli/src");
    assert_eq!(value["depth"], 1);
    assert_eq!(value["readonly"], true);
}

#[test]
fn read_tool_params_accepts_utf8_bom() {
    let value = read_tool_params(Some("\u{feff}{\"path\":\".\"}".to_string()), None).unwrap();
    assert_eq!(value["path"], ".");
}

#[test]
fn parse_batch_task_file_accepts_utf8_bom() {
    let tasks = parse_batch_task_file("\u{feff}[]", "tasks.json").unwrap();
    assert!(tasks.is_empty());
}

#[test]
fn batch_examples_parse_as_task_files() {
    let json_tasks =
        parse_batch_task_file(render_batch_example(BatchExampleFormat::Json), "tasks.json")
            .unwrap();
    assert_eq!(json_tasks.len(), 2);
    assert_eq!(json_tasks[0].message(), "Summarize the current workspace");
    assert_eq!(json_tasks[1].agent("OSAgent"), "bitfun-coder");

    let toml_tasks =
        parse_batch_task_file(render_batch_example(BatchExampleFormat::Toml), "tasks.toml")
            .unwrap();
    assert_eq!(toml_tasks.len(), 2);
    assert_eq!(toml_tasks[1].workspace().as_deref(), Some("."));
}

#[test]
fn empty_batch_hint_points_to_starter_example() {
    assert!(empty_batch_hint().contains("sparo batch --example json"));
    assert!(empty_batch_hint().contains("at least one task"));
}

#[test]
fn empty_history_hints_point_to_health_when_storage_may_be_missing() {
    assert!(empty_task_hint().contains("sparo chat"));
    assert!(empty_task_hint().contains("sparo health"));
    assert!(empty_session_hint().contains("sparo exec"));
    assert!(empty_session_hint().contains("sparo health"));
}

#[test]
fn write_export_file_creates_parent_directories() {
    let temp_root =
        std::env::temp_dir().join(format!("sparo-cli-export-test-{}", uuid::Uuid::new_v4()));
    let output = temp_root.join("nested").join("session.md");

    write_export_file(output.to_str().unwrap(), "exported").unwrap();

    assert_eq!(std::fs::read_to_string(&output).unwrap(), "exported");
    std::fs::remove_dir_all(temp_root).unwrap();
}

#[test]
fn export_file_errors_include_writable_output_hint() {
    let temp_root = std::env::temp_dir().join(format!(
        "sparo-cli-export-dir-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_root).unwrap();

    let error = write_export_file(temp_root.to_str().unwrap(), "exported").unwrap_err();
    assert_eq!(
            cli_error_hint(&error),
            Some("Pass a writable file path with `--output <file>`; create or fix permissions on the parent directory if needed.")
        );

    std::fs::remove_dir_all(temp_root).unwrap();
}

#[test]
fn batch_summary_serializes_script_contract() {
    let results = vec![
        BatchTaskResult {
            index: 1,
            agent: "OSAgent".to_string(),
            message: "one".to_string(),
            session_id: Some("session-1".to_string()),
            success: true,
            duration_ms: 12,
            error_kind: None,
            error: None,
        },
        BatchTaskResult {
            index: 2,
            agent: "bitfun-debug".to_string(),
            message: "two".to_string(),
            session_id: None,
            success: false,
            duration_ms: 34,
            error_kind: Some("execution_error".to_string()),
            error: Some("failed".to_string()),
        },
    ];
    let value = serde_json::to_value(batch_summary("tasks.json", &results)).unwrap();

    assert_eq!(value["tasks_file"], "tasks.json");
    assert_eq!(value["passed"], 1);
    assert_eq!(value["failed"], 1);
    assert_eq!(value["total"], 2);
    assert_eq!(value["results"][0]["session_id"], "session-1");
    assert_eq!(value["results"][1]["session_id"], serde_json::Value::Null);
    assert_eq!(value["results"][1]["error_kind"], "execution_error");
    assert_eq!(value["results"][1]["error"], "failed");
}

#[test]
fn batch_human_summary_points_to_resume_command_when_session_exists() {
    let result = BatchTaskResult {
        index: 1,
        agent: "OSAgent".to_string(),
        message: "one\nmore".to_string(),
        session_id: Some("session-1".to_string()),
        success: true,
        duration_ms: 12,
        error_kind: None,
        error: None,
    };

    assert_eq!(
        batch_result_summary_line(&result),
        "1. ok | OSAgent | 12 ms | one"
    );
    assert_eq!(
        batch_result_session_line(result.session_id.as_deref()).as_deref(),
        Some("   session: session-1 (resume with `sparo sessions resume session-1`)")
    );
    assert!(batch_result_session_line(None).is_none());
}

#[test]
fn batch_summary_human_lines_include_rerun_and_machine_output_actions() {
    let results = vec![BatchTaskResult {
        index: 1,
        agent: "OSAgent".to_string(),
        message: "one\nmore".to_string(),
        session_id: Some("session-1".to_string()),
        success: true,
        duration_ms: 12,
        error_kind: None,
        error: None,
    }];
    let summary = batch_summary("tasks file.json", &results);
    let output = batch_summary_human_lines(&summary).join("\n");

    assert!(output.contains("=== Batch Summary ==="));
    assert!(output.contains("1 passed, 0 failed, 1 total"));
    assert!(output.contains("Resume latest session: sparo sessions resume session-1"));
    assert!(output.contains("Inspect sessions: sparo sessions list"));
    assert!(output.contains("Rerun batch: sparo batch --tasks \"tasks file.json\""));
    assert!(output.contains("Machine output: sparo batch --tasks \"tasks file.json\" --json"));
}

#[test]
fn batch_summary_human_lines_include_failure_rerun_guidance() {
    let results = vec![BatchTaskResult {
        index: 1,
        agent: "bitfun-debug".to_string(),
        message: "review".to_string(),
        session_id: None,
        success: false,
        duration_ms: 34,
        error_kind: Some("execution_error".to_string()),
        error: Some("failed".to_string()),
    }];
    let summary = batch_summary("tasks.json", &results);
    let output = batch_summary_human_lines(&summary).join("\n");

    assert!(output.contains("0 passed, 1 failed, 1 total"));
    assert!(output.contains("error kind: execution_error"));
    assert!(output.contains("error: failed"));
    assert!(
        output.contains("Rerun after fixes: sparo batch --tasks tasks.json --continue-on-error")
    );
    assert!(!output.contains("Resume latest session:"));
}

#[test]
fn batch_summary_human_lines_keep_empty_batch_actionable() {
    let results = Vec::new();
    let summary = batch_summary("empty.json", &results);
    let output = batch_summary_human_lines(&summary).join("\n");

    assert!(output.contains("0 passed, 0 failed, 0 total"));
    assert!(output.contains("Generate starter file: sparo batch --example json"));
    assert!(output.contains("Machine output: sparo batch --tasks empty.json --json"));
}

#[test]
fn empty_batch_human_lines_include_summary_and_next_actions() {
    let output = empty_batch_human_lines("empty file.json").join("\n");

    assert!(output.contains("No batch tasks found in empty file.json"));
    assert!(output.contains("Generate starter file: sparo batch --example json"));
    assert!(output.contains("=== Batch Summary ==="));
    assert!(output.contains("Inspect sessions: sparo sessions list"));
    assert!(output.contains("Machine output: sparo batch --tasks \"empty file.json\" --json"));
}

#[test]
fn sessions_list_human_lines_include_next_actions_for_latest_session() {
    let session = sample_session_metadata();
    let output =
        sessions_list_human_lines(&[session], Some("D:\\workspace\\my project")).join("\n");

    assert!(output.contains("History sessions (total 1)"));
    assert!(output.contains("1. Review CLI sessions (ID: session-1)"));
    assert!(output.contains("Agent: bitfun-debug | Turns: 3 | Messages: 6"));
    assert!(output.contains("Next actions:"));
    assert!(output.contains(
        "Resume latest: sparo sessions --workspace \"D:\\workspace\\my project\" resume session-1"
    ));
    assert!(output.contains(
        "Show details: sparo sessions --workspace \"D:\\workspace\\my project\" show session-1"
    ));
    assert!(output.contains(
            "Export latest: sparo sessions --workspace \"D:\\workspace\\my project\" export session-1 --output session.md"
        ));
    assert!(
        output.contains("Open TUI history: sparo chat --workspace \"D:\\workspace\\my project\"")
    );
}

#[test]
fn sessions_list_human_lines_keep_empty_history_actionable() {
    let output = sessions_list_human_lines(&[], None).join("\n");

    assert!(output.contains("No history sessions"));
    assert!(output.contains("sparo chat"));
    assert!(output.contains("sparo exec"));
}

fn sample_session_metadata() -> sparo_core::service::session::SessionMetadata {
    sparo_core::service::session::SessionMetadata {
        domain: sparo_core::agentic::core::SessionDomain::Workspace {
            workspace_id: "ws_test".to_string(),
        },
        session_id: "session-1".to_string(),
        session_name: "Review CLI sessions".to_string(),
        agent_type: "bitfun-debug".to_string(),
        created_by: None,
        session_kind: sparo_core::agentic::core::SessionKind::Standard,
        model_name: "gpt-test".to_string(),
        created_at: 1_700_000_000_000,
        last_active_at: 1_700_000_100_000,
        turn_count: 3,
        message_count: 6,
        tool_call_count: 2,
        status: sparo_core::service::session::SessionStatus::Active,
        terminal_session_id: None,
        snapshot_session_id: None,
        tags: Vec::new(),
        custom_metadata: None,
        todos: None,
        workspace_path: Some("D:\\workspace\\my project".to_string()),
        workspace_hostname: None,
    }
}

#[test]
fn session_human_detail_lines_include_next_actions() {
    let metadata = sample_session_metadata();

    let output = session_human_detail_lines(&metadata).join("\n");

    assert!(output.contains("Session Details"));
    assert!(output.contains("Title: Review CLI sessions"));
    assert!(output.contains("Statistics:"));
    assert!(output.contains("  Tool calls: 2"));
    assert!(output.contains("Next actions:"));
    assert!(output.contains(
        "Resume: sparo sessions --workspace \"D:\\workspace\\my project\" resume session-1"
    ));
    assert!(output.contains(
            "Export: sparo sessions --workspace \"D:\\workspace\\my project\" export session-1 --output session.md"
        ));
}

#[test]
fn session_delete_human_lines_include_recovery_actions() {
    let output = session_delete_human_lines(
        "session 1",
        Some("D:\\workspace\\my project"),
        "Deleted session: session 1",
    )
    .join("\n");

    assert!(output.contains("Session Deleted"));
    assert!(output.contains("Status: Deleted session: session 1"));
    assert!(output.contains("Requested session: session 1"));
    assert!(output.contains("Workspace: D:\\workspace\\my project"));
    assert!(output.contains(
        "Inspect sessions: sparo sessions --workspace \"D:\\workspace\\my project\" list"
    ));
    assert!(
        output.contains("Start a new chat: sparo chat --workspace \"D:\\workspace\\my project\"")
    );
    assert!(output.contains(
            "Machine output: sparo sessions --workspace \"D:\\workspace\\my project\" delete \"session 1\" --json"
        ));
}

#[test]
fn session_export_human_lines_include_resume_and_machine_output() {
    let output = session_export_human_lines(
        "session 1",
        Some("D:\\workspace\\my project"),
        "exports\\session file.md",
        SessionExportFormat::Markdown,
    )
    .join("\n");

    assert!(output.contains("Session Exported"));
    assert!(output.contains("Session: session 1"));
    assert!(output.contains("Workspace: D:\\workspace\\my project"));
    assert!(output.contains("Output: exports\\session file.md"));
    assert!(output.contains("Format: markdown"));
    assert!(output.contains("Open file: \"exports\\session file.md\""));
    assert!(output.contains(
            "Resume session: sparo sessions --workspace \"D:\\workspace\\my project\" resume \"session 1\""
        ));
    assert!(output.contains(
            "Machine output: sparo sessions --workspace \"D:\\workspace\\my project\" export \"session 1\" --output \"exports\\session file.md\" --format markdown --json"
        ));
}

#[test]
fn agent_summary_line_matches_cli_agents_table_contract() {
    let agent = sparo_core::agentic::agents::AgentInfo {
        id: "bitfun-debug".to_string(),
        name: "Debug".to_string(),
        description: "Diagnose failures".to_string(),
        is_readonly: false,
        tool_count: 3,
        default_tools: vec!["read_file".to_string()],
        enabled: true,
        subagent_source: None,
        path: None,
        model: None,
        app_kind: None,
        app_icon: None,
        app_category: None,
        app_path: None,
    };

    assert_eq!(
        agent_summary_line(&agent),
        "bitfun-debug | Debug | enabled | 3 tools | write"
    );
}

#[test]
fn agents_human_lines_include_launch_and_default_actions() {
    let agents = vec![sparo_core::agentic::agents::AgentInfo {
        id: "debug agent".to_string(),
        name: "Debug Agent".to_string(),
        description: "Diagnose failures with detailed workspace inspection.".to_string(),
        is_readonly: false,
        tool_count: 3,
        default_tools: vec![
            "read_file".to_string(),
            "search".to_string(),
            "run_command".to_string(),
            "write_file".to_string(),
            "edit_file".to_string(),
            "diagnostics".to_string(),
        ],
        enabled: true,
        subagent_source: None,
        path: Some("D:\\agents\\debug".to_string()),
        model: None,
        app_kind: Some("Agent Component".to_string()),
        app_icon: None,
        app_category: None,
        app_path: None,
    }];

    let output = agents_human_lines(&agents).join("\n");

    assert!(output.contains("Available Agents (total 1)"));
    assert!(output.contains("debug agent | Debug Agent | enabled | 3 tools | write"));
    assert!(
        output.contains("tools: read_file, search, run_command, write_file, edit_file (+1 more)")
    );
    assert!(output.contains("Chat with agent: sparo chat --agent \"debug agent\""));
    assert!(output.contains("One-shot run: sparo exec --agent \"debug agent\" \"<message>\""));
    assert!(output
        .contains("Make default: sparo config prefs set behavior.default_agent \"debug agent\""));
    assert!(output.contains("Machine output: sparo agents list --json"));
}

#[test]
fn agents_human_lines_do_not_launch_disabled_only_registry() {
    let agents = vec![sparo_core::agentic::agents::AgentInfo {
        id: "disabled".to_string(),
        name: "Disabled".to_string(),
        description: "Currently disabled.".to_string(),
        is_readonly: true,
        tool_count: 0,
        default_tools: Vec::new(),
        enabled: false,
        subagent_source: None,
        path: None,
        model: None,
        app_kind: None,
        app_icon: None,
        app_category: None,
        app_path: None,
    }];

    let output = agents_human_lines(&agents).join("\n");

    assert!(output.contains("disabled | Disabled | disabled | 0 tools | readonly"));
    assert!(output.contains("Enable an agent in configuration before launching chat or exec."));
    assert!(!output.contains("sparo chat --agent disabled"));
}

#[test]
fn compact_description_truncates_noisy_human_output() {
    let description = "Produces a comprehensive deep-research report on any subject using parallel sub-agent orchestration. Dispatches multiple research agents concurrently to investigate different chapters and competitors simultaneously, then synthesizes findings into a cohesive report.";

    let compact = compact_description(description).unwrap();

    assert!(compact.contains("Produces a comprehensive"));
    assert!(compact.ends_with("..."));
    assert!(!compact.contains("then synthesizes findings into a cohesive report"));
    assert_eq!(compact_description(" \n\t "), None);
}

#[test]
fn compact_description_preserves_short_app_descriptions() {
    assert_eq!(
        compact_description("Open local Bridge Components from the CLI").as_deref(),
        Some("Open local Bridge Components from the CLI")
    );
}

#[test]
fn batch_error_kind_classifies_timeouts() {
    assert_eq!(
        batch_error_kind("CLI exec timed out after 1 seconds"),
        "timeout"
    );
    assert_eq!(batch_error_kind("join cancelled"), "cancelled");
    assert_eq!(batch_error_kind("other failure"), "execution_error");
}

#[test]
fn cli_prefs_get_and_set_known_paths() {
    let mut config = CliConfig::default();

    set_cli_pref(&mut config, "ui.theme", "light").unwrap();
    set_cli_pref(&mut config, "ui.show_tips", "off").unwrap();
    set_cli_pref(&mut config, "ui.color_scheme", "blue").unwrap();
    set_cli_pref(&mut config, "behavior.default_agent", "bitfun-debug").unwrap();
    set_cli_pref(&mut config, "behavior.confirm_dangerous", "false").unwrap();
    set_cli_pref(&mut config, "workspace.default_path", "D:\\workspace").unwrap();
    set_cli_pref(&mut config, "shortcuts.send_message", "ctrl+s").unwrap();
    set_cli_pref(&mut config, "shortcuts.interrupt", "Ctrl+X").unwrap();
    set_cli_pref(&mut config, "shortcuts.menu", "escape").unwrap();

    assert_eq!(
        cli_prefs_value(&config, Some("ui.theme")).unwrap(),
        serde_json::json!("light")
    );
    assert_eq!(
        cli_prefs_value(&config, Some("ui.show_tips")).unwrap(),
        serde_json::json!(false)
    );
    assert_eq!(
        cli_prefs_value(&config, Some("ui.color_scheme")).unwrap(),
        serde_json::json!("blue")
    );
    assert_eq!(
        cli_prefs_value(&config, Some("behavior.default_agent")).unwrap(),
        serde_json::json!("bitfun-debug")
    );
    assert_eq!(
        cli_prefs_value(&config, Some("behavior.confirm_dangerous")).unwrap(),
        serde_json::json!(false)
    );
    assert_eq!(
        cli_prefs_value(&config, Some("workspace.default_path")).unwrap(),
        serde_json::json!("D:\\workspace")
    );
    assert_eq!(
        cli_prefs_value(&config, Some("shortcuts.send_message")).unwrap(),
        serde_json::json!("Ctrl+S")
    );
    assert_eq!(
        cli_prefs_value(&config, Some("shortcuts.interrupt")).unwrap(),
        serde_json::json!("Ctrl+X")
    );
    assert_eq!(
        cli_prefs_value(&config, Some("shortcuts.menu")).unwrap(),
        serde_json::json!("Esc")
    );
}

#[test]
fn cli_prefs_human_output_respects_json_flag_contract() {
    let mut config = CliConfig::default();
    config.behavior.default_agent = "bitfun-debug".to_string();
    config.workspace.default_path = "D:\\workspace".to_string();

    assert_eq!(
        cli_prefs_get_human_output(&config, Some("behavior.default_agent")).unwrap(),
        "behavior.default_agent = bitfun-debug"
    );

    let full = cli_prefs_get_human_output(&config, None).unwrap();
    assert!(full.contains("CLI Preferences"));
    assert!(full.contains("Default Agent: bitfun-debug"));
    assert!(full.contains("Default workspace: D:\\workspace"));
    assert!(full.contains("Exclude patterns: node_modules, .git, target, dist"));
    assert!(full.contains("CLI preference file: "));
    assert!(full.contains("Next actions:"));
    assert!(full.contains("Edit preferences: sparo config edit"));
    assert!(full.contains("Validate preferences: sparo health"));
    assert!(full.contains("Machine output: sparo config prefs get --json"));

    let set = cli_prefs_set_human_output(
        "ui.show_tips",
        &serde_json::json!(false),
        std::path::Path::new("C:\\Users\\example\\config.toml"),
    )
    .unwrap();
    assert!(set.contains("Set ui.show_tips = false"));
    assert!(set.contains("CLI preference file: C:\\Users\\example\\config.toml"));
    assert!(set.contains("Inspect CLI preferences: sparo config prefs get"));
    assert!(set.contains("Validate CLI preferences: sparo health"));
    assert!(set.contains("Machine output: sparo config prefs get ui.show_tips --json"));
}

#[test]
fn shared_config_summary_keeps_default_config_show_scannable() {
    let value = serde_json::json!({
        "revision": 12,
        "catalogVersion": "sha256:catalog",
        "publishedSettingCount": 42,
        "models": {
            "configured": 2,
            "enabled": 1
        },
        "defaultModels": {
            "primary": "primary-model",
            "fast": "fast-model"
        },
        "agentModelMappings": 2,
        "appLanguage": "zh-CN"
    });

    let output = shared_config_summary_lines(&value).join("\n");

    assert!(output.contains("Shared Global Configuration Summary"));
    assert!(output.contains("Revision: 12"));
    assert!(output.contains("Catalog: sha256:catalog (42 settings)"));
    assert!(output.contains("Models: 2 configured, 1 enabled"));
    assert!(output.contains("Default models: primary=primary-model, fast=fast-model"));
    assert!(output.contains("Agent model mappings: 2"));
    assert!(output.contains("App language: zh-CN"));
    assert!(output.contains("sparo config export"));
    assert!(!output.contains("\"models\""));
    assert!(!output.contains("\"api_key\""));
}

#[test]
fn config_validate_human_lines_summarize_status_and_next_actions() {
    let value = serde_json::json!({
        "valid": false,
        "errors": ["Missing primary model"],
        "warnings": ["Provider disabled"]
    });

    let output = config_validate_human_lines(&value).join("\n");

    assert!(output.contains("Shared Global Configuration Validation"));
    assert!(output.contains("Status: invalid"));
    assert!(output.contains("Errors: 1"));
    assert!(output.contains("Warnings: 1"));
    assert!(output.contains("  - Missing primary model"));
    assert!(output.contains("Edit config: sparo config edit"));
    assert!(output.contains("Inspect config: sparo config show"));
    assert!(output.contains("Run health: sparo config health"));
    assert!(output.contains("Machine output: sparo config validate --json"));
}

#[test]
fn config_health_human_lines_summarize_health_and_next_actions() {
    let value = serde_json::json!({
        "healthy": false,
        "message": "Configuration system is unavailable",
        "config_directory": "C:\\Users\\example\\sparo_os\\config",
        "warnings": ["Failed to load configuration service"]
    });

    let output = config_health_human_lines(&value).join("\n");

    assert!(output.contains("Shared Global Configuration Health"));
    assert!(output.contains("Status: needs attention"));
    assert!(output.contains("Message: Configuration system is unavailable"));
    assert!(output.contains("Config directory: C:\\Users\\example\\sparo_os\\config"));
    assert!(output.contains("  - Failed to load configuration service"));
    assert!(output.contains("Run CLI health: sparo health"));
    assert!(output.contains("Validate config: sparo config validate"));
    assert!(output.contains("Machine output: sparo config health --json"));
}

#[test]
fn config_edit_human_lines_include_editor_and_validation_commands() {
    let path = std::path::Path::new("C:\\Users\\example\\sparo_os\\cli.toml");
    let output = config_edit_human_lines(path).join("\n");

    assert!(output.contains("CLI Preference File"));
    assert!(output.contains("Path: C:\\Users\\example\\sparo_os\\cli.toml"));
    assert!(output.contains("code C:\\Users\\example\\sparo_os\\cli.toml"));
    #[cfg(target_os = "windows")]
    assert!(output.contains("notepad C:\\Users\\example\\sparo_os\\cli.toml"));
    assert!(output.contains("Validate CLI preferences: sparo health"));
    assert!(output.contains("Inspect CLI preferences: sparo config prefs get"));
    assert!(output.contains("Inspect shared config: sparo config show"));
    assert!(!output.contains("\\\"C:\\\\Users"));
}

#[test]
fn config_set_human_lines_include_commit_and_next_actions() {
    let commit = test_config_commit(sparo_core::service::config::ConfigCommitStatus::Applying);
    let output = config_set_human_lines("core.ai.default_models.primary", &commit).join("\n");

    assert!(output.contains("Shared Global Configuration Updated"));
    assert!(output.contains("Status: applying"));
    assert!(output.contains("Commit ID: cfg-commit-test"));
    assert!(output.contains("Revision: 42"));
    assert!(output.contains("Setting ID: core.ai.default_models.primary"));
    assert!(!output.contains("gpt-demo"));
    assert!(!output.contains("Value:"));
    assert!(output.contains("Inspect value: sparo config get core.ai.default_models.primary"));
    assert!(output.contains("Validate config: sparo config validate"));
    assert!(output.contains("Use --json on future changes for machine-readable output"));
}

#[test]
fn config_reset_human_lines_require_one_setting_id_and_include_commit() {
    let commit = test_config_commit(sparo_core::service::config::ConfigCommitStatus::Applied);
    let output = config_reset_human_lines("core.ai.default_models.primary", &commit).join("\n");

    assert!(output.contains("Shared Global Configuration Reset"));
    assert!(output.contains("Status: applied"));
    assert!(output.contains("Commit ID: cfg-commit-test"));
    assert!(output.contains("Revision: 42"));
    assert!(output.contains("Setting ID: core.ai.default_models.primary"));
    assert!(output.contains("Inspect value: sparo config get core.ai.default_models.primary"));
    assert!(
        output.contains("Machine output: sparo config reset core.ai.default_models.primary --json")
    );
}

#[test]
fn config_reset_setting_id_is_required_by_clap() {
    let error = Cli::try_parse_from(["sparo", "config", "reset"])
        .err()
        .expect("reset without a setting ID must be rejected");
    assert_eq!(
        error.kind(),
        clap::error::ErrorKind::MissingRequiredArgument
    );
}

#[test]
fn config_show_does_not_duplicate_single_setting_lookup() {
    let error = Cli::try_parse_from([
        "sparo",
        "config",
        "show",
        "--setting-id",
        "core.ai.default_models.primary",
    ])
    .err()
    .expect("single-setting lookup belongs to `config get`");
    assert_eq!(error.kind(), clap::error::ErrorKind::UnknownArgument);
}

#[test]
fn config_import_human_lines_report_only_successful_outcomes() {
    let output =
        config_import_human_lines("C:\\Users\\example\\config export.json", None).join("\n");

    assert!(output.contains("Shared Global Configuration Imported"));
    assert!(output.contains("Status: no changes"));
    assert!(output.contains("File: C:\\Users\\example\\config export.json"));
    assert!(output.contains("Validate config: sparo config validate"));
    assert!(output.contains(
        "Machine output: sparo config import \"C:\\Users\\example\\config export.json\" --json"
    ));
}

#[test]
fn cli_presentation_preferences_summary_includes_operational_defaults() {
    let mut config = CliConfig::default();
    config.behavior.default_agent = "bitfun-debug".to_string();
    config.behavior.confirm_dangerous = false;
    config.workspace.default_path = "D:\\workspace\\project".to_string();

    let lines = cli_presentation_preference_lines(&config).join("\n");

    assert!(lines.contains("Default Agent: bitfun-debug"));
    assert!(lines.contains("Confirm dangerous tools: false"));
    assert!(lines.contains("Default workspace: D:\\workspace\\project"));
    assert!(lines.contains("Send shortcut: Ctrl+D"));
}

#[test]
fn cli_config_path_line_uses_copyable_display_path() {
    let line = cli_config_path_line(std::path::Path::new(
        "C:\\Users\\example\\sparo_os\\config.toml",
    ));

    assert_eq!(
        line,
        "  CLI preference file: C:\\Users\\example\\sparo_os\\config.toml"
    );
    assert!(!line.contains("\\\\"));
    assert!(!line.contains('"'));
}

#[test]
fn cli_prefs_reject_unknown_paths_and_values() {
    let mut config = CliConfig::default();

    assert!(set_cli_pref(&mut config, "ui.theme", "blue").is_err());
    assert!(set_cli_pref(&mut config, "ui.color_scheme", "infrared").is_err());
    assert!(set_cli_pref(&mut config, "behavior.default_agent", "  ").is_err());
    assert!(set_cli_pref(&mut config, "shortcuts.send_message", "Ctrl+Delete").is_err());
    assert!(set_cli_pref(&mut config, "shortcuts.interrupt", "Shift+X").is_err());
    assert!(set_cli_pref(&mut config, "shortcuts.send_message", "Esc").is_err());
    assert!(set_cli_pref(&mut config, "shortcuts.interrupt", "Enter").is_err());
    assert!(set_cli_pref(&mut config, "shortcuts.menu", "Enter").is_err());
    assert!(set_cli_pref(&mut config, "ui.unknown", "x").is_err());
    assert!(cli_prefs_value(&config, Some("ui.unknown")).is_err());
}

#[test]
fn cli_prefs_reject_conflicting_shortcuts_without_mutating_config() {
    let mut config = CliConfig::default();
    let original_send = config.shortcuts.send_message.clone();

    let error = set_cli_pref(&mut config, "shortcuts.send_message", "Ctrl+C").unwrap_err();

    assert!(error
        .to_string()
        .contains("shortcuts.send_message and shortcuts.interrupt cannot both use Ctrl+C"));
    assert_eq!(config.shortcuts.send_message, original_send);
    assert_eq!(config.shortcuts.interrupt, "Ctrl+C");
}

#[test]
fn effective_workspace_hint_prefers_explicit_then_cli_default() {
    let mut config = CliConfig::default();
    config.workspace.default_path = "D:\\workspace\\project".to_string();

    assert_eq!(
        effective_workspace_hint(&config, Some("D:\\explicit")).as_deref(),
        Some("D:\\explicit")
    );
    assert_eq!(
        effective_workspace_hint(&config, None).as_deref(),
        Some("D:\\workspace\\project")
    );

    config.workspace.default_path.clear();
    assert_eq!(effective_workspace_hint(&config, None), None);

    config.workspace.default_path = "global".to_string();
    assert!(effective_workspace_hint(&config, None).is_some());
}

#[test]
fn effective_workspace_hint_normalizes_explicit_dot_and_global() {
    let config = CliConfig::default();
    let current = std::env::current_dir()
        .unwrap()
        .to_string_lossy()
        .to_string();

    assert_eq!(
        effective_workspace_hint(&config, Some(".")).as_deref(),
        Some(current.as_str())
    );
    assert_eq!(
        effective_workspace_hint(&config, Some("  .  ")).as_deref(),
        Some(current.as_str())
    );
    assert!(effective_workspace_hint(&config, Some("global")).is_some());
    assert_eq!(
        effective_workspace_hint(&config, Some("   ")).as_deref(),
        Some(current.as_str())
    );
}

fn sample_intelligent_app_catalog() -> CliIntelligentAppCatalog {
    let scope = sparo_core::app_platform::AppActivationScope::System;
    let app = sparo_core::app_platform::AppRecord {
        app_id: "runno".to_string(),
        slot_id: "assistant".to_string(),
        display_name: "Runno".to_string(),
        description: Some("Built-in Intelligent App".to_string()),
        owner: sparo_core::app_platform::AppOwner::system(),
        derived_from: None,
        created_at_ms: 1,
    };
    let activation = sparo_core::app_platform::ActivationRecord {
        scope: scope.clone(),
        slot_id: app.slot_id.clone(),
        selected_app_id: app.app_id.clone(),
        active_release_id: "release_runno_1".to_string(),
        enabled: true,
    };
    CliIntelligentAppCatalog {
        slots: vec![sparo_core::app_platform::AppSlotProjection {
            slot_id: app.slot_id.clone(),
            display_name: app.display_name.clone(),
            activation: Some(activation),
            variants: vec![sparo_core::app_platform::AppVariantProjection {
                app,
                releases: Vec::new(),
                latest_release: None,
                upstream_base_release_id: None,
                upstream_latest_release_id: None,
                upstream_update_available: false,
                state: sparo_core::app_platform::AppVariantState::Active,
            }],
        }],
        drafts: Vec::new(),
        issues: Vec::new(),
    }
}

#[test]
fn intelligent_app_details_match_app_id_or_name_case_insensitively() {
    let catalog = sample_intelligent_app_catalog();

    assert_eq!(
        intelligent_app_details(&catalog, "RUNNO")
            .unwrap()
            .app
            .app_id,
        "runno"
    );
    assert_eq!(
        intelligent_app_details(&catalog, "runno")
            .unwrap()
            .app
            .display_name,
        "Runno"
    );
    assert!(intelligent_app_details(&catalog, "missing").is_err());
}

#[test]
fn app_human_detail_lines_report_activation_and_desktop_launch_boundary() {
    let catalog = sample_intelligent_app_catalog();
    let app = intelligent_app_details(&catalog, "runno").unwrap();

    let output = app_human_detail_lines(&app).join("\n");

    assert!(output.contains("Intelligent App Details"));
    assert!(output.contains("App ID: runno"));
    assert!(output.contains("Active release: release_runno_1"));
    assert!(output.contains("Inspect: sparo apps show runno"));
    assert!(output.contains("Launch: use Sparo Desktop Apps Center"));
    assert!(!output.contains("sparo apps open"));
}

#[test]
fn apps_list_human_lines_report_slots_variants_and_activation() {
    let catalog = sample_intelligent_app_catalog();
    let output = apps_list_human_lines(&catalog).join("\n");

    assert!(output.contains("Intelligent Apps (1 slots, 1 variants)"));
    assert!(output.contains("Runno | slot assistant"));
    assert!(output.contains("activation: enabled | app runno | release release_runno_1"));
    assert!(output.contains("runno | active | owner system"));
    assert!(output.contains("Inspect latest: sparo apps show runno"));
    assert!(output.contains("Launch: use Sparo Desktop Apps Center"));
}

#[test]
fn apps_list_human_lines_empty_state_guides_desktop_builder() {
    let catalog = CliIntelligentAppCatalog {
        slots: Vec::new(),
        drafts: Vec::new(),
        issues: Vec::new(),
    };
    let output = apps_list_human_lines(&catalog).join("\n");

    assert!(output.contains("No Intelligent Apps are available."));
    assert!(output.contains("Sparo Desktop Apps Center / App Builder"));
    assert!(output.contains("Machine output: sparo apps list --json"));
}

#[test]
fn find_workspace_row_matches_label_path_or_global() {
    let workspaces = vec![
        sparo_core::command::agentic_os::AgenticOsWorkspaceRow {
            label: "global".to_string(),
            path: None,
            git: None,
            session_count: 0,
        },
        sparo_core::command::agentic_os::AgenticOsWorkspaceRow {
            label: "Project".to_string(),
            path: Some("D:\\workspace\\project".to_string()),
            git: Some("git main".to_string()),
            session_count: 2,
        },
    ];

    assert!(find_workspace_row(&workspaces, "GLOBAL")
        .unwrap()
        .path
        .is_none());
    assert_eq!(
        find_workspace_row(&workspaces, "project")
            .unwrap()
            .path
            .as_deref(),
        Some("D:\\workspace\\project")
    );
    assert_eq!(
        find_workspace_row(&workspaces, "D:/workspace/project")
            .unwrap()
            .label,
        "Project"
    );
    assert!(find_workspace_row(&workspaces, "missing").is_none());
}

#[test]
fn resolve_workspace_row_accepts_existing_direct_path() {
    let temp_root =
        std::env::temp_dir().join(format!("sparo-cli-workspace-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_root).unwrap();

    let row = resolve_workspace_row(&[], temp_root.to_str().unwrap()).unwrap();

    assert_eq!(
        row.label,
        temp_root.file_name().unwrap().to_string_lossy().to_string()
    );
    let expected_path = display_workspace_path(&temp_root.canonicalize().unwrap());
    assert_eq!(row.path.as_deref(), Some(expected_path.as_str()));
    assert_eq!(row.session_count, 0);

    std::fs::remove_dir_all(temp_root).unwrap();
}

#[test]
fn workspace_human_detail_lines_include_use_and_chat_actions() {
    let workspace = sparo_core::command::agentic_os::AgenticOsWorkspaceRow {
        label: "my project".to_string(),
        path: Some("D:\\workspace\\my project".to_string()),
        git: Some("git main".to_string()),
        session_count: 3,
    };

    let output = workspace_human_detail_lines(&workspace).join("\n");

    assert!(output.contains("Workspace Details"));
    assert!(output.contains("Path: D:\\workspace\\my project"));
    assert!(output.contains("Sessions: 3"));
    assert!(output.contains("Next actions:"));
    assert!(output.contains("Use: sparo workspaces use \"my project\""));
    assert!(output.contains("Chat: sparo chat --workspace \"D:\\workspace\\my project\""));
}

#[test]
fn workspace_human_detail_lines_make_global_chat_explicit() {
    let workspace = sparo_core::command::agentic_os::AgenticOsWorkspaceRow {
        label: "global".to_string(),
        path: None,
        git: None,
        session_count: 1,
    };

    let output = workspace_human_detail_lines(&workspace).join("\n");

    assert!(output.contains("Path: Agentic OS global runtime"));
    assert!(output.contains("Use: sparo workspaces use global"));
    assert!(output.contains("Chat: sparo chat --workspace global"));
}

#[test]
fn workspace_use_human_lines_include_preference_and_next_actions() {
    let workspace = sparo_core::command::agentic_os::AgenticOsWorkspaceRow {
        label: "my project".to_string(),
        path: Some("D:\\workspace\\my project".to_string()),
        git: Some("git main".to_string()),
        session_count: 3,
    };

    let output = workspace_use_human_lines(
        &workspace,
        "D:\\workspace\\my project",
        std::path::Path::new("C:\\Users\\example\\sparo_os\\config.toml"),
    )
    .join("\n");

    assert!(output.contains("CLI Default Workspace Updated"));
    assert!(output.contains("Workspace: my project"));
    assert!(output.contains("Path: D:\\workspace\\my project"));
    assert!(output.contains("CLI preference file: C:\\Users\\example\\sparo_os\\config.toml"));
    assert!(output.contains("Start chat: sparo chat"));
    assert!(output.contains("Inspect workspace: sparo workspaces show \"my project\""));
    assert!(output.contains("Inspect preference: sparo config prefs get workspace.default_path"));
    assert!(output.contains("Machine output: sparo workspaces use \"my project\" --json"));
}

#[test]
fn workspaces_list_human_lines_include_next_actions_for_first_workspace() {
    let workspaces = vec![sparo_core::command::agentic_os::AgenticOsWorkspaceRow {
        label: "my project".to_string(),
        path: Some("D:\\workspace\\my project".to_string()),
        git: Some("git main".to_string()),
        session_count: 3,
    }];

    let output = workspaces_list_human_lines(&workspaces).join("\n");

    assert!(output.contains("Known Workspaces (total 1)"));
    assert!(output.contains("my project"));
    assert!(output.contains("path: D:\\workspace\\my project"));
    assert!(output.contains("Next actions:"));
    assert!(output.contains("Use latest: sparo workspaces use \"my project\""));
    assert!(output.contains("Show details: sparo workspaces show \"my project\""));
    assert!(output.contains("Chat here: sparo chat --workspace \"D:\\workspace\\my project\""));
    assert!(output.contains("Machine output: sparo workspaces list --json"));
}

#[test]
fn workspaces_list_human_lines_make_global_chat_explicit() {
    let workspaces = vec![sparo_core::command::agentic_os::AgenticOsWorkspaceRow {
        label: "global".to_string(),
        path: None,
        git: None,
        session_count: 1,
    }];

    let output = workspaces_list_human_lines(&workspaces).join("\n");

    assert!(output.contains("path: Agentic OS global runtime"));
    assert!(output.contains("Use latest: sparo workspaces use global"));
    assert!(output.contains("Show details: sparo workspaces show global"));
    assert!(output.contains("Chat here: sparo chat --workspace global"));
}

#[test]
fn workspaces_list_human_lines_empty_state_stays_scriptable() {
    let output = workspaces_list_human_lines(&[]).join("\n");

    assert!(output.contains("Known Workspaces (total 0)"));
    assert!(output.contains("Add a project by opening chat with --workspace <path>."));
    assert!(output.contains("Machine output: sparo workspaces list --json"));
}

#[test]
fn resolve_workspace_row_rejects_missing_direct_path() {
    let missing = std::env::temp_dir().join(format!(
        "sparo-cli-workspace-missing-{}",
        uuid::Uuid::new_v4()
    ));

    assert!(resolve_workspace_row(&[], missing.to_str().unwrap()).is_none());
}

#[test]
fn find_memory_row_matches_file_scope_or_path() {
    let memories = vec![sparo_core::command::agentic_os::AgenticOsMemoryRow {
        scope: "PROJECT".to_string(),
        file: "notes.md".to_string(),
        target: "D:\\workspace\\.sparo_os".to_string(),
    }];

    assert_eq!(
        find_memory_row(&memories, "NOTES.md").unwrap().scope,
        "PROJECT"
    );
    assert_eq!(
        find_memory_row(&memories, "project:notes.md").unwrap().file,
        "notes.md"
    );
    assert_eq!(
        find_memory_row(&memories, "D:/workspace/.sparo_os/notes.md")
            .unwrap()
            .scope,
        "PROJECT"
    );
    assert!(find_memory_row(&memories, "missing.md").is_none());
}

#[test]
fn read_memory_content_reports_truncation_metadata() {
    let temp_root =
        std::env::temp_dir().join(format!("sparo-cli-memory-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_root).expect("create temp memory root");
    let file = temp_root.join("notes.md");
    std::fs::write(&file, "abcdef").expect("write temp memory file");
    let memory = sparo_core::command::agentic_os::AgenticOsMemoryRow {
        scope: "PROJECT".to_string(),
        file: "notes.md".to_string(),
        target: temp_root.to_string_lossy().to_string(),
    };

    let preview = read_memory_content(&memory, 3).expect("read truncated memory content");

    assert_eq!(preview.content, "abc");
    assert_eq!(preview.max_bytes, 3);
    assert_eq!(preview.bytes_read, 3);
    assert_eq!(preview.total_bytes, 6);
    assert!(preview.truncated);

    let value = memory_content_json(&memory, &preview);
    assert_eq!(value["content"], "abc");
    assert_eq!(value["max_bytes"], 3);
    assert_eq!(value["truncated_to_bytes"], 3);
    assert_eq!(value["bytes_read"], 3);
    assert_eq!(value["total_bytes"], 6);
    assert_eq!(value["truncated"], true);

    std::fs::remove_dir_all(temp_root).expect("remove temp memory root");
}

#[test]
fn memory_human_detail_lines_include_next_actions_and_truncation() {
    let memory = sparo_core::command::agentic_os::AgenticOsMemoryRow {
        scope: "PROJECT".to_string(),
        file: "notes.md".to_string(),
        target: "D:\\workspace\\my project\\.sparo_os".to_string(),
    };
    let preview = MemoryContentPreview {
        content: "abc".to_string(),
        max_bytes: 3,
        bytes_read: 3,
        total_bytes: 6,
        truncated: true,
    };

    let output =
        memory_human_detail_lines(&memory, &preview, Some("D:\\workspace\\my project")).join("\n");

    assert!(output.contains("Memory: PROJECT | notes.md"));
    assert!(output.contains("abc"));
    assert!(output.contains("[truncated: showing 3 of 6 bytes"));
    assert!(output.contains("Next actions:"));
    assert!(output.contains(
            "Show full file: sparo memory --workspace \"D:\\workspace\\my project\" show project:notes.md --max-bytes 6"
        ));
    assert!(
        output.contains("Discuss in chat: sparo chat --workspace \"D:\\workspace\\my project\"")
    );
}

#[test]
fn memory_human_detail_lines_omit_truncation_when_complete() {
    let memory = sparo_core::command::agentic_os::AgenticOsMemoryRow {
        scope: "GLOBAL".to_string(),
        file: "profile.md".to_string(),
        target: "D:\\sparo\\memory".to_string(),
    };
    let preview = MemoryContentPreview {
        content: "complete".to_string(),
        max_bytes: 1024,
        bytes_read: 8,
        total_bytes: 8,
        truncated: false,
    };

    let output = memory_human_detail_lines(&memory, &preview, None).join("\n");

    assert!(!output.contains("[truncated"));
    assert!(output.contains("Show full file: sparo memory show global:profile.md --max-bytes 8"));
    assert!(output.contains("Discuss in chat: sparo chat"));
}

#[test]
fn memory_list_human_lines_include_show_and_chat_actions() {
    let memories = vec![sparo_core::command::agentic_os::AgenticOsMemoryRow {
        scope: "PROJECT".to_string(),
        file: "notes.md".to_string(),
        target: "C:\\SparoData\\workspaces\\ws_test\\memory".to_string(),
    }];

    let output = memory_list_human_lines(&memories, Some("D:\\workspace\\my project")).join("\n");

    assert!(output.contains("Memory Files (total 1)"));
    assert!(output.contains("PROJECT | notes.md"));
    assert!(output.contains("Next actions:"));
    assert!(output.contains(
        "Show latest: sparo memory --workspace \"D:\\workspace\\my project\" show project:notes.md"
    ));
    assert!(
        output.contains("Discuss in chat: sparo chat --workspace \"D:\\workspace\\my project\"")
    );
    assert!(output.contains("Machine output: sparo memory list --json"));
}

#[test]
fn memory_list_human_lines_keep_empty_snapshot_actionable() {
    let output = memory_list_human_lines(&[], None).join("\n");

    assert!(output.contains("No memory files are available in this snapshot."));
    assert!(!output.contains(".sparo_os/memory"));
    assert!(output.contains("Memory surface"));
    assert!(output.contains("sparo health"));
    assert!(output.contains("sparo chat"));
}

#[test]
fn find_task_row_matches_session_id_or_title() {
    let tasks = vec![sparo_core::command::agentic_os::AgenticOsTaskRow {
        title: "Fix bug".to_string(),
        agent: "bitfun-debug".to_string(),
        status: "active".to_string(),
        detail: "2 turns".to_string(),
        session_id: Some("task-session".to_string()),
        workspace: Some("D:\\workspace".to_string()),
    }];

    assert_eq!(
        find_task_row(&tasks, "TASK-SESSION").unwrap().title,
        "Fix bug"
    );
    assert_eq!(
        find_task_row(&tasks, "fix bug")
            .unwrap()
            .session_id
            .as_deref(),
        Some("task-session")
    );
    assert_eq!(find_task_row(&tasks, "last").unwrap().title, "Fix bug");
    assert!(find_task_row(&tasks, "missing").is_none());
}

#[test]
fn resolve_task_last_reports_empty_task_list() {
    let error = resolve_task_from_rows(&[], "last").unwrap_err();
    assert!(error
        .to_string()
        .contains("No backend-tracked agent tasks found"));
}

#[test]
fn task_human_detail_lines_include_next_actions_for_persisted_tasks() {
    let task = sparo_core::command::agentic_os::AgenticOsTaskRow {
        title: "Review CLI task flow".to_string(),
        agent: "bitfun-debug".to_string(),
        status: "active".to_string(),
        detail: "Needs handoff".to_string(),
        session_id: Some("task-session".to_string()),
        workspace: Some("D:\\workspace\\my project".to_string()),
    };

    let output = task_human_detail_lines(&task).join("\n");

    assert!(output.contains("Task Details"));
    assert!(output.contains("Session: task-session"));
    assert!(output.contains("Next actions:"));
    assert!(output.contains(
        "Resume: sparo tasks --workspace \"D:\\workspace\\my project\" resume task-session"
    ));
    assert!(output.contains(
            "Export: sparo tasks --workspace \"D:\\workspace\\my project\" export task-session --output task.md"
        ));
}

#[test]
fn task_human_detail_lines_explain_unsaved_task_export_limit() {
    let task = sparo_core::command::agentic_os::AgenticOsTaskRow {
        title: "Review CLI task flow".to_string(),
        agent: "bitfun-debug".to_string(),
        status: "active".to_string(),
        detail: "Needs handoff".to_string(),
        session_id: None,
        workspace: None,
    };

    let output = task_human_detail_lines(&task).join("\n");

    assert!(output.contains("Session: none"));
    assert!(output.contains("Resume: sparo tasks resume \"Review CLI task flow\""));
    assert!(
        output.contains("Export: unavailable until this task has a persisted session transcript.")
    );
}

#[test]
fn task_export_human_lines_include_resume_and_machine_output() {
    let output = task_export_human_lines(
        "task title",
        "session 1",
        "exports\\task.json",
        SessionExportFormat::Json,
    )
    .join("\n");

    assert!(output.contains("Task Exported"));
    assert!(output.contains("Task: task title"));
    assert!(output.contains("Session: session 1"));
    assert!(output.contains("Output: exports\\task.json"));
    assert!(output.contains("Format: json"));
    assert!(output.contains("Open file: exports\\task.json"));
    assert!(output.contains("Inspect task: sparo tasks show \"session 1\""));
    assert!(output.contains("Resume task: sparo tasks resume \"session 1\""));
    assert!(output.contains(
            "Machine output: sparo tasks export \"session 1\" --output exports\\task.json --format json --json"
        ));
}

#[test]
fn tasks_list_human_lines_include_next_actions_for_persisted_latest_task() {
    let tasks = vec![sparo_core::command::agentic_os::AgenticOsTaskRow {
        title: "Review CLI task flow".to_string(),
        agent: "bitfun-debug".to_string(),
        status: "active".to_string(),
        detail: "Needs handoff".to_string(),
        session_id: Some("task-session".to_string()),
        workspace: Some("D:\\workspace\\task".to_string()),
    }];

    let output = tasks_list_human_lines(&tasks, Some("D:\\workspace\\fallback")).join("\n");

    assert!(output.contains("Agent Tasks (total 1)"));
    assert!(output.contains("task-session | active | Review CLI task flow"));
    assert!(output.contains("Next actions:"));
    assert!(output.contains(
        "Resume latest: sparo tasks --workspace D:\\workspace\\task resume task-session"
    ));
    assert!(output
        .contains("Show details: sparo tasks --workspace D:\\workspace\\task show task-session"));
    assert!(output.contains(
            "Export latest: sparo tasks --workspace D:\\workspace\\task export task-session --output task.md"
        ));
    assert!(output.contains("Open TUI tasks: sparo chat --workspace D:\\workspace\\task"));
}

#[test]
fn tasks_list_human_lines_explain_no_session_latest_task() {
    let tasks = vec![sparo_core::command::agentic_os::AgenticOsTaskRow {
        title: "Review CLI task flow".to_string(),
        agent: "bitfun-debug".to_string(),
        status: "active".to_string(),
        detail: "Needs handoff".to_string(),
        session_id: None,
        workspace: None,
    }];

    let output = tasks_list_human_lines(&tasks, Some("D:\\workspace\\my project")).join("\n");

    assert!(output.contains("no-session | active | Review CLI task flow"));
    assert!(output.contains(
            "Resume latest: sparo tasks --workspace \"D:\\workspace\\my project\" resume \"Review CLI task flow\""
        ));
    assert!(output.contains(
            "Show details: sparo tasks --workspace \"D:\\workspace\\my project\" show \"Review CLI task flow\""
        ));
    assert!(output.contains(
        "Export latest: unavailable until this task has a persisted session transcript."
    ));
}

#[test]
fn tasks_list_human_lines_keep_empty_task_list_actionable() {
    let output = tasks_list_human_lines(&[], None).join("\n");

    assert!(output.contains("No backend-tracked agent tasks found."));
    assert!(output.contains("sparo chat"));
    assert!(output.contains("sparo sessions list"));
}

#[test]
fn task_tui_launch_context_prepares_unsaved_task_for_chat() {
    let task = sparo_core::command::agentic_os::AgenticOsTaskRow {
        title: "Review CLI task flow".to_string(),
        agent: "bitfun-debug".to_string(),
        status: "active".to_string(),
        detail: "Needs handoff".to_string(),
        session_id: None,
        workspace: None,
    };

    let launch = task_tui_launch_context(&task, Some("D:\\workspace\\fallback".to_string()), None);

    assert_eq!(launch.workspace.as_deref(), Some("D:\\workspace\\fallback"));
    assert_eq!(launch.agent, "bitfun-debug");
    assert_eq!(launch.title, "Review CLI task flow");
    assert_eq!(launch.context_messages.len(), 1);
    assert!(launch.context_messages[0].contains("Task detail"));
    assert!(launch.context_messages[0].contains("Session: none"));
    assert!(launch.context_messages[0].contains("Workspace: global"));
    let message = launch.initial_message.as_deref().unwrap();
    assert!(message.contains("Use the task detail above"));
    assert!(message.contains("Review CLI task flow"));
    assert!(message.contains("bitfun-debug"));
}

#[test]
fn task_tui_launch_context_preserves_explicit_resume_message() {
    let task = sparo_core::command::agentic_os::AgenticOsTaskRow {
        title: "Review CLI task flow".to_string(),
        agent: "bitfun-debug".to_string(),
        status: "active".to_string(),
        detail: "Needs handoff".to_string(),
        session_id: None,
        workspace: Some("D:\\workspace\\task".to_string()),
    };

    let launch = task_tui_launch_context(
        &task,
        Some("D:\\workspace\\fallback".to_string()),
        Some("continue with risk review".to_string()),
    );

    assert_eq!(launch.workspace.as_deref(), Some("D:\\workspace\\task"));
    assert_eq!(
        launch.initial_message.as_deref(),
        Some("continue with risk review")
    );
}

#[test]
fn task_session_resume_context_carries_task_detail_into_chat() {
    let task = sparo_core::command::agentic_os::AgenticOsTaskRow {
        title: "Review CLI task flow".to_string(),
        agent: "bitfun-debug".to_string(),
        status: "active".to_string(),
        detail: "Needs handoff".to_string(),
        session_id: Some("task-session".to_string()),
        workspace: Some("D:\\workspace\\task".to_string()),
    };

    let resume = task_session_resume_context(
        &task,
        Some("D:\\workspace\\fallback".to_string()),
        "task-session".to_string(),
        Some("continue from here".to_string()),
    );

    assert_eq!(resume.workspace.as_deref(), Some("D:\\workspace\\task"));
    assert_eq!(resume.session_id, "task-session");
    assert_eq!(
        resume.initial_message.as_deref(),
        Some("continue from here")
    );
    assert_eq!(resume.context_messages.len(), 1);
    assert!(resume.context_messages[0].contains("Task detail"));
    assert!(resume.context_messages[0].contains("Review CLI task flow"));
    assert!(resume.context_messages[0].contains("Session: task-session"));
}
