mod agent;
/// Sparo CLI
///
/// Command-line interface version, supports:
/// - Interactive TUI
/// - Single command execution
/// - Batch task processing
mod config;
mod modes;
mod session;
mod ui;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use serde::Deserialize;

use config::CliConfig;
use modes::chat::ChatMode;
use modes::exec::ExecMode;

#[derive(Parser)]
#[command(name = "sparo")]
#[command(about = "Sparo CLI - Agentic OS command-line surface", long_about = None)]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Enable verbose logging
    #[arg(short, long, global = true)]
    verbose: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Start interactive chat (TUI)
    Chat {
        /// Agent type
        #[arg(short, long, default_value = "Dispatcher")]
        agent: String,

        /// Workspace path
        #[arg(short, long)]
        workspace: Option<String>,
    },

    /// Execute single command
    Exec {
        /// User message
        message: String,

        /// Agent type
        #[arg(short, long, default_value = "Dispatcher")]
        agent: String,

        /// Workspace path
        #[arg(short, long)]
        workspace: Option<String>,

        /// Output in JSON format (script-friendly)
        #[arg(long)]
        json: bool,

        /// Output git diff patch after execution (for SWE-bench evaluation)
        /// Without path outputs to terminal, with path saves to file
        /// Example: --output-patch or --output-patch ./result.patch
        #[arg(long, num_args = 0..=1, default_missing_value = "-")]
        output_patch: Option<String>,

        /// Tool execution requires confirmation (default: no confirmation to avoid blocking non-interactive mode)
        #[arg(long)]
        confirm: bool,
    },

    /// Execute batch tasks
    Batch {
        /// Task configuration file path
        #[arg(short, long)]
        tasks: String,
    },

    /// Session management
    Sessions {
        /// Workspace path whose persisted sessions should be managed
        #[arg(short, long)]
        workspace: Option<String>,

        #[command(subcommand)]
        action: SessionAction,
    },

    /// Configuration management
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },

    /// Invoke tool directly
    Tool {
        #[command(subcommand)]
        action: ToolAction,
    },

    /// Health check
    Health,
}

#[derive(Subcommand)]
enum SessionAction {
    /// List all sessions
    List,
    /// Show session details
    Show {
        /// Session ID (or "last" for the most recent)
        id: String,
    },
    /// Delete session
    Delete {
        /// Session ID
        id: String,
    },
}

#[derive(Subcommand)]
enum ConfigAction {
    /// Show configuration
    Show {
        /// Dot-path within the shared global configuration
        #[arg(long)]
        path: Option<String>,

        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },
    /// Get a shared global configuration value by dot-path
    Get {
        /// Dot-path within the shared global configuration
        path: Option<String>,
    },
    /// Set a shared global configuration value by dot-path
    Set {
        /// Dot-path within the shared global configuration
        path: String,

        /// JSON value; bare text is treated as a string
        value: String,
    },
    /// Edit CLI-local presentation preferences
    Edit,
    /// Reset shared global configuration or a dot-path within it
    Reset {
        /// Dot-path within the shared global configuration
        path: Option<String>,
    },
    /// Export shared global configuration as JSON
    Export,
    /// Import shared global configuration from a JSON file
    Import {
        /// Exported configuration JSON file
        file: String,
    },
    /// Validate shared global configuration
    Validate,
    /// Reload shared global configuration from disk
    Reload,
    /// Show shared global configuration health
    Health,
}

#[derive(Subcommand)]
enum ToolAction {
    /// List registered core tools
    List,
    /// Show a tool input schema
    Schema {
        /// Tool name
        name: String,

        /// Workspace path for context-aware schemas
        #[arg(short, long)]
        workspace: Option<String>,
    },
    /// Execute a registered core tool
    Run {
        /// Tool name
        name: String,

        /// Tool parameters as JSON
        #[arg(short, long)]
        params: Option<String>,

        /// Workspace path used by file/shell tools
        #[arg(short, long)]
        workspace: Option<String>,

        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum BatchTaskFile {
    List(Vec<BatchTask>),
    Object { tasks: Vec<BatchTask> },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum BatchTask {
    Message(String),
    Object {
        message: String,
        agent: Option<String>,
        workspace: Option<String>,
        output_patch: Option<String>,
    },
}

impl BatchTask {
    fn message(&self) -> &str {
        match self {
            Self::Message(message) => message,
            Self::Object { message, .. } => message,
        }
    }

    fn agent(&self, default_agent: &str) -> String {
        match self {
            Self::Message(_) => default_agent.to_string(),
            Self::Object { agent, .. } => agent.clone().unwrap_or_else(|| default_agent.to_string()),
        }
    }

    fn workspace(&self) -> Option<String> {
        match self {
            Self::Message(_) => None,
            Self::Object { workspace, .. } => workspace.clone(),
        }
    }

    fn output_patch(&self) -> Option<String> {
        match self {
            Self::Message(_) => None,
            Self::Object { output_patch, .. } => output_patch.clone(),
        }
    }
}

fn resolve_workspace_path(workspace: Option<&str>) -> Option<std::path::PathBuf> {
    match workspace {
        Some(".") => std::env::current_dir().ok(),
        Some(path) => Some(std::path::PathBuf::from(path)),
        None => None,
    }
}

async fn initialize_cli_process_runtime() -> Result<bitfun_core::runtime::ProcessRuntime> {
    bitfun_core::runtime::initialize_process_runtime(bitfun_core::runtime::ProcessRuntimeOptions {
        initialize_i18n: false,
        initialize_token_usage: false,
    })
    .await
    .context("Failed to initialize CLI process runtime")
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    let log_level = if cli.verbose {
        tracing::Level::DEBUG
    } else {
        tracing::Level::INFO
    };

    let is_tui_mode = matches!(cli.command, None | Some(Commands::Chat { .. }));

    if is_tui_mode {
        use std::fs::OpenOptions;

        let log_dir = CliConfig::config_dir()
            .ok()
            .map(|d| d.join("logs"))
            .unwrap_or_else(|| std::env::temp_dir().join("sparo_os-cli"));

        std::fs::create_dir_all(&log_dir).ok();
        let log_file = log_dir.join("sparo_os-cli.log");

        if let Ok(file) = OpenOptions::new().create(true).append(true).open(log_file) {
            tracing_subscriber::fmt()
                .with_max_level(log_level)
                .with_writer(move || -> Box<dyn std::io::Write + Send> {
                    match file.try_clone() {
                        Ok(cloned) => Box::new(cloned),
                        Err(e) => {
                            eprintln!("Warning: Failed to clone log file handle: {}", e);
                            Box::new(std::io::sink())
                        }
                    }
                })
                .with_ansi(false)
                .with_target(false)
                .init();
        } else {
            tracing_subscriber::fmt()
                .with_max_level(log_level)
                .with_target(false)
                .init();
        }
    } else {
        tracing_subscriber::fmt()
            .with_max_level(log_level)
            .with_target(false)
            .init();
    }

    let config = CliConfig::load().unwrap_or_else(|e| {
        if !is_tui_mode {
            eprintln!("Warning: Failed to load config: {}", e);
            eprintln!("Using default configuration");
        }
        CliConfig::default()
    });

    match cli.command {
        Some(Commands::Chat { agent, workspace }) => {
            let (workspace, startup_session_id, effective_agent, mut startup_terminal) = if workspace.is_none() {
                use ui::startup::{StartupOutcome, StartupPage};

                let mut terminal = ui::init_terminal()?;
                ui::render_loading(&mut terminal, "Loading Agentic OS backend...")?;
                let snapshot = StartupPage::load_snapshot(None).await;
                let mut startup_page = StartupPage::new(snapshot);
                let outcome = startup_page.run(&mut terminal)?;

                match outcome {
                    StartupOutcome::Launch(launch) => {
                        (launch.workspace, launch.session_id, launch.agent, Some(terminal))
                    }
                    StartupOutcome::Exit => {
                        ui::restore_terminal(terminal)?;
                        println!("Goodbye!");
                        return Ok(());
                    }
                }
            } else {
                (workspace, None, agent, None)
            };

            if let Some(ref mut term) = startup_terminal {
                ui::render_loading(term, "Initializing system, please wait...")?;
            } else {
                println!("Initializing system, please wait...");
            }

            let workspace_path = resolve_workspace_path(workspace.as_deref());
            tracing::info!("CLI workspace: {:?}", workspace_path);

            let process_runtime = initialize_cli_process_runtime().await?;
            tracing::info!("CLI process runtime initialized");

            let config_service = process_runtime.config_service.clone();
            let ai_config: bitfun_core::service::config::types::AIConfig = config_service
                .get_config(Some("ai"))
                .await
                .unwrap_or_default();
            let original_skip_confirmation = ai_config.skip_tool_confirmation;
            if let Err(e) = config_service
                .set_config("ai.skip_tool_confirmation", true)
                .await
            {
                tracing::warn!(
                    "Failed to temporarily disable tool confirmation, continuing: {}",
                    e
                );
            }

            let agentic_system = agent::agentic_system::init_agentic_system()
                .await
                .context("Failed to initialize agentic system")?;
            tracing::info!("Agentic system initialized");

            if let Some(ref mut term) = startup_terminal {
                ui::render_loading(term, "System initialized, starting chat interface...")?;
            } else {
                println!("System initialized, starting chat interface...\n");
                std::thread::sleep(std::time::Duration::from_millis(500));
            }

            let mut chat_mode = ChatMode::new_with_session(
                config,
                effective_agent,
                workspace_path,
                startup_session_id,
                &agentic_system,
            );
            let chat_result = chat_mode.run(startup_terminal);

            let _ = config_service
                .set_config("ai.skip_tool_confirmation", original_skip_confirmation)
                .await;

            chat_result?;
        }

        Some(Commands::Exec {
            message,
            agent,
            workspace,
            json: _,
            output_patch,
            confirm,
        }) => {
            let workspace_path_resolved = resolve_workspace_path(workspace.as_deref())
                .or_else(|| std::env::current_dir().ok());
            tracing::info!("CLI workspace: {:?}", workspace_path_resolved);

            let process_runtime = initialize_cli_process_runtime().await?;
            tracing::info!("CLI process runtime initialized");

            let config_service = process_runtime.config_service.clone();
            let ai_config: bitfun_core::service::config::types::AIConfig = config_service
                .get_config(Some("ai"))
                .await
                .unwrap_or_default();
            let original_skip_confirmation = ai_config.skip_tool_confirmation;
            let desired_skip = !confirm;
            if let Err(e) = config_service
                .set_config("ai.skip_tool_confirmation", desired_skip)
                .await
            {
                tracing::warn!("Failed to set tool confirmation toggle, continuing: {}", e);
            }

            let agentic_system = agent::agentic_system::init_agentic_system()
                .await
                .context("Failed to initialize agentic system")?;
            tracing::info!("Agentic system initialized");

            let mut exec_mode = ExecMode::new(
                config,
                message,
                agent,
                &agentic_system,
                workspace_path_resolved,
                output_patch,
            );
            let run_result = exec_mode.run().await;

            let _ = config_service
                .set_config("ai.skip_tool_confirmation", original_skip_confirmation)
                .await;

            run_result?;
        }

        Some(Commands::Batch { tasks }) => {
            handle_batch_tasks(tasks, &config).await?;
        }

        Some(Commands::Sessions { action, workspace }) => {
            handle_session_action(action, workspace).await?;
        }

        Some(Commands::Config { action }) => {
            handle_config_action(action, &config).await?;
        }

        Some(Commands::Tool { action }) => {
            handle_tool_action(action).await?;
        }

        Some(Commands::Health) => {
            println!("Sparo CLI is running normally");
            println!("Version: {}", env!("CARGO_PKG_VERSION"));
            println!("Config directory: {:?}", CliConfig::config_dir()?);
        }

        None => {
            use modes::chat::ChatExitReason;
            use ui::startup::StartupPage;

            loop {
                let mut terminal = ui::init_terminal()?;
                ui::render_loading(&mut terminal, "Loading Agentic OS backend...")?;
                let snapshot = StartupPage::load_snapshot(None).await;
                let mut startup_page = StartupPage::new(snapshot);
                let launch = match startup_page.run(&mut terminal)? {
                    ui::startup::StartupOutcome::Launch(launch) => launch,
                    ui::startup::StartupOutcome::Exit => {
                        ui::restore_terminal(terminal)?;
                        println!("Goodbye!");
                        break;
                    }
                };

                ui::render_loading(&mut terminal, "Initializing system, please wait...")?;

                let workspace_path = resolve_workspace_path(launch.workspace.as_deref());
                tracing::info!("CLI workspace: {:?}", workspace_path);

                let process_runtime = initialize_cli_process_runtime().await?;
                tracing::info!("CLI process runtime initialized");

                let config_service = process_runtime.config_service.clone();
                let ai_config: bitfun_core::service::config::types::AIConfig = config_service
                    .get_config(Some("ai"))
                    .await
                    .unwrap_or_default();
                let original_skip_confirmation = ai_config.skip_tool_confirmation;
                let _ = config_service
                    .set_config("ai.skip_tool_confirmation", true)
                    .await;

                let agentic_system = agent::agentic_system::init_agentic_system()
                    .await
                    .context("Failed to initialize agentic system")?;
                tracing::info!("Agentic system initialized");

                ui::render_loading(
                    &mut terminal,
                    "System initialized, starting chat interface...",
                )?;

                let mut chat_mode = ChatMode::new_with_session(
                    config.clone(),
                    launch.agent,
                    workspace_path,
                    launch.session_id,
                    &agentic_system,
                );
                chat_mode.set_initial_input(launch.initial_message);
                let exit_reason = chat_mode.run(Some(terminal));

                let _ = config_service
                    .set_config("ai.skip_tool_confirmation", original_skip_confirmation)
                    .await;
                let exit_reason = exit_reason?;

                match exit_reason {
                    ChatExitReason::Quit => {
                        println!("Goodbye!");
                        break;
                    }
                    ChatExitReason::BackToMenu => {
                        continue;
                    }
                }
            }
        }
    }

    Ok(())
}

fn format_unix_ms(timestamp_ms: u64) -> String {
    chrono::DateTime::<chrono::Local>::from(
        std::time::UNIX_EPOCH + std::time::Duration::from_millis(timestamp_ms),
    )
    .format("%Y-%m-%d %H:%M:%S")
    .to_string()
}

fn turn_assistant_preview(turn: &bitfun_core::service::session::DialogTurnData) -> String {
    turn.model_rounds
        .iter()
        .flat_map(|round| round.text_items.iter())
        .map(|item| item.content.trim())
        .find(|content| !content.is_empty())
        .unwrap_or("")
        .lines()
        .next()
        .unwrap_or("")
        .to_string()
}

async fn handle_batch_tasks(tasks_file: String, config: &CliConfig) -> Result<()> {
    let raw = std::fs::read_to_string(&tasks_file)
        .with_context(|| format!("Failed to read batch task file: {}", tasks_file))?;
    let parsed = parse_batch_task_file(&raw, &tasks_file)?;
    if parsed.is_empty() {
        println!("No batch tasks found in {}", tasks_file);
        return Ok(());
    }

    let process_runtime = initialize_cli_process_runtime().await?;
    tracing::info!("CLI process runtime initialized");

    let config_service = process_runtime.config_service.clone();
    let ai_config: bitfun_core::service::config::types::AIConfig = config_service
        .get_config(Some("ai"))
        .await
        .unwrap_or_default();
    let original_skip_confirmation = ai_config.skip_tool_confirmation;
    if let Err(e) = config_service
        .set_config("ai.skip_tool_confirmation", true)
        .await
    {
        tracing::warn!("Failed to disable tool confirmation for batch mode: {}", e);
    }

    let agentic_system = agent::agentic_system::init_agentic_system()
        .await
        .context("Failed to initialize agentic system")?;

    println!("Executing {} batch task(s) from {}", parsed.len(), tasks_file);
    for (index, task) in parsed.iter().enumerate() {
        let agent = task.agent("Dispatcher");
        let workspace_path = resolve_workspace_path(task.workspace().as_deref())
            .or_else(|| std::env::current_dir().ok());
        println!("\n=== Task {}/{} · {} ===", index + 1, parsed.len(), agent);
        let mut exec_mode = ExecMode::new(
            config.clone(),
            task.message().to_string(),
            agent,
            &agentic_system,
            workspace_path,
            task.output_patch(),
        );
        exec_mode.run().await?;
    }

    let _ = config_service
        .set_config("ai.skip_tool_confirmation", original_skip_confirmation)
        .await;
    Ok(())
}

fn parse_batch_task_file(raw: &str, file_name: &str) -> Result<Vec<BatchTask>> {
    if file_name.ends_with(".toml") {
        let parsed: BatchTaskFile = toml::from_str(raw)
            .with_context(|| format!("Invalid TOML batch task file: {}", file_name))?;
        return Ok(batch_tasks_from_file(parsed));
    }

    let parsed: BatchTaskFile = serde_json::from_str(raw)
        .with_context(|| format!("Invalid JSON batch task file: {}", file_name))?;
    Ok(batch_tasks_from_file(parsed))
}

fn batch_tasks_from_file(file: BatchTaskFile) -> Vec<BatchTask> {
    match file {
        BatchTaskFile::List(tasks) => tasks,
        BatchTaskFile::Object { tasks } => tasks,
    }
}

async fn handle_session_action(
    action: SessionAction,
    workspace_path: Option<String>,
) -> Result<()> {
    use bitfun_core::command::session as session_command;

    match action {
        SessionAction::List => {
            let sessions =
                session_command::list_sessions(session_command::SessionWorkspaceRequest {
                    workspace_path,
                })
                .await?;

            if sessions.is_empty() {
                println!("No history sessions");
                return Ok(());
            }

            println!("History sessions (total {})\n", sessions.len());

            for (i, info) in sessions.iter().enumerate() {
                println!("{}. {} (ID: {})", i + 1, info.session_name, info.session_id);
                println!(
                    "   Agent: {} | Turns: {} | Messages: {} | Updated: {}",
                    info.agent_type,
                    info.turn_count,
                    info.message_count,
                    format_unix_ms(info.last_active_at)
                );
                if let Some(ws) = &info.workspace_path {
                    println!("   Workspace: {}", ws);
                }
                println!();
            }
        }

        SessionAction::Show { id } => {
            let detail = session_command::show_session(session_command::ShowSessionRequest {
                session_id: id,
                workspace_path,
            })
            .await?;
            let metadata = detail.metadata;

            println!("Session Details\n");
            println!("Title: {}", metadata.session_name);
            println!("ID: {}", metadata.session_id);
            println!("Agent: {}", metadata.agent_type);
            println!("Created: {}", format_unix_ms(metadata.created_at));
            println!("Updated: {}", format_unix_ms(metadata.last_active_at));
            if let Some(ws) = &metadata.workspace_path {
                println!("Workspace: {}", ws);
            }
            println!();
            println!("Statistics:");
            println!("  Turns: {}", metadata.turn_count);
            println!("  Messages: {}", metadata.message_count);
            println!("  Tool calls: {}", metadata.tool_call_count);
            println!();

            if !detail.turns.is_empty() {
                println!("Recent turns:");
                let recent = detail.turns.iter().rev().take(3);
                for turn in recent {
                    let assistant = turn_assistant_preview(turn);
                    println!(
                        "  [{}] user: {}",
                        format_unix_ms(turn.user_message.timestamp),
                        turn.user_message.content.lines().next().unwrap_or("")
                    );
                    if !assistant.is_empty() {
                        println!("       assistant: {}", assistant);
                    }
                }
            }
        }

        SessionAction::Delete { id } => {
            let response = session_command::delete_session(session_command::DeleteSessionRequest {
                session_id: id,
                workspace_path,
            })
            .await?;
            println!("{}", response.message);
        }
    }

    Ok(())
}

async fn build_command_context() -> Result<bitfun_core::command::CommandContext> {
    let runtime = initialize_cli_process_runtime().await?;
    Ok(runtime.command_context())
}

fn parse_config_value(value: &str) -> serde_json::Value {
    serde_json::from_str(value).unwrap_or_else(|_| serde_json::Value::String(value.to_string()))
}

fn print_json(value: impl serde::Serialize) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(&value)?);
    Ok(())
}

async fn handle_config_action(action: ConfigAction, config: &CliConfig) -> Result<()> {
    use bitfun_core::command::config as command_config;

    match action {
        ConfigAction::Show { path, json } => {
            let ctx = build_command_context().await?;
            let value = command_config::get_config(
                &ctx,
                command_config::GetConfigRequest { path: path.clone() },
            )
            .await?;

            if json {
                print_json(value)?;
            } else {
                println!("Shared Global Configuration\n");
                println!("Path: {}", path.unwrap_or_else(|| "<root>".to_string()));
                print_json(value)?;
                println!();
                println!("CLI Presentation Preferences");
                println!("  Theme: {}", config.ui.theme);
                println!("  Show tips: {}", config.ui.show_tips);
                println!("  Animation: {}", config.ui.animation);
                println!("  Default Agent: {}", config.behavior.default_agent);
                println!("  CLI preference file: {:?}", CliConfig::config_path()?);
            }
        }

        ConfigAction::Get { path } => {
            let ctx = build_command_context().await?;
            let value =
                command_config::get_config(&ctx, command_config::GetConfigRequest { path }).await?;
            print_json(value)?;
        }

        ConfigAction::Set { path, value } => {
            let ctx = build_command_context().await?;
            let response = command_config::set_config(
                &ctx,
                command_config::SetConfigRequest {
                    path,
                    value: parse_config_value(&value),
                },
            )
            .await?;
            println!("{}", response.message);
            if response.invalidated_ai_cache {
                println!("AI client cache invalidated");
            }
        }

        ConfigAction::Edit => {
            let config_path = CliConfig::config_path()?;
            println!("Config file location: {:?}", config_path);
            println!();
            println!("Please use a text editor to edit the config file:");
            println!("  vi {:?}", config_path);
            println!("  or");
            println!("  code {:?}", config_path);
        }

        ConfigAction::Reset { path } => {
            let ctx = build_command_context().await?;
            let response =
                command_config::reset_config(&ctx, command_config::ResetConfigRequest { path })
                    .await?;
            println!("{}", response.message);
            if response.invalidated_ai_cache {
                println!("AI client cache invalidated");
            }
        }

        ConfigAction::Export => {
            let ctx = build_command_context().await?;
            let value = command_config::export_config(&ctx).await?;
            print_json(value)?;
        }

        ConfigAction::Import { file } => {
            let ctx = build_command_context().await?;
            let raw = std::fs::read_to_string(&file)
                .with_context(|| format!("Failed to read config export file: {}", file))?;
            let config = serde_json::from_str(&raw)
                .with_context(|| format!("Invalid config export JSON: {}", file))?;
            let response =
                command_config::import_config(&ctx, command_config::ImportConfigRequest { config })
                    .await?;
            print_json(response.result)?;
            if response.invalidated_ai_cache {
                println!("AI client cache invalidated");
            }
        }

        ConfigAction::Validate => {
            let ctx = build_command_context().await?;
            let value = command_config::validate_config(&ctx).await?;
            print_json(value)?;
        }

        ConfigAction::Reload => {
            let ctx = build_command_context().await?;
            let message = command_config::reload_config(&ctx).await?;
            println!("{}", message);
        }

        ConfigAction::Health => {
            let ctx = build_command_context().await?;
            let status = command_config::get_global_config_health_status(&ctx).await?;
            print_json(status)?;
        }
    }

    Ok(())
}

async fn handle_tool_action(action: ToolAction) -> Result<()> {
    use bitfun_core::command::tool as tool_command;

    match action {
        ToolAction::List => {
            let tools = tool_command::list_tools().await?;
            for tool in tools {
                let mut flags = Vec::new();
                if tool.readonly {
                    flags.push("readonly");
                }
                if tool.supports_streaming {
                    flags.push("streaming");
                }
                if !tool.enabled {
                    flags.push("disabled");
                }
                let suffix = if flags.is_empty() {
                    String::new()
                } else {
                    format!(" [{}]", flags.join(", "))
                };
                println!("{}{}", tool.name, suffix);
                println!("  {}", tool.description.lines().next().unwrap_or(""));
            }
        }

        ToolAction::Schema { name, workspace } => {
            let schema = tool_command::tool_schema(tool_command::ToolSchemaRequest {
                name,
                workspace_path: workspace,
            })
            .await?;
            print_json(schema)?;
        }

        ToolAction::Run {
            name,
            params,
            workspace,
            json,
        } => {
            initialize_cli_process_runtime().await?;
            let input = match params {
                Some(raw) => serde_json::from_str(&raw)
                    .with_context(|| format!("Invalid JSON parameters for tool {}", name))?,
                None => serde_json::json!({}),
            };
            let response = tool_command::execute_tool(tool_command::ExecuteToolRequest {
                name,
                input,
                workspace_path: workspace,
            })
            .await?;

            if json {
                print_json(response)?;
            } else {
                println!("Tool: {}", response.tool_name);
                for result in response.display_results {
                    println!("{}", serde_json::to_string_pretty(&result)?);
                }
            }
        }
    }

    Ok(())
}
