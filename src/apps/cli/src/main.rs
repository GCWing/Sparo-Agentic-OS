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
use bitfun_core::infrastructure::APP_CONFIG_DIR_NAME;
use clap::{error::ErrorKind as ClapErrorKind, Parser, Subcommand, ValueEnum};
use serde::{Deserialize, Serialize};

use config::{canonical_shortcut, CliConfig};
use modes::chat::{task_without_session_followup_prompt, ChatMode};
use modes::exec::ExecMode;
use ui::string_utils::{shell_arg, workspace_option};

pub(crate) const JSON_OUTPUT_ALREADY_EMITTED: &str = "__sparo_json_output_already_emitted__";
const CLI_OUTPUT_ALREADY_EMITTED: &str = "__sparo_output_already_emitted__";

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

#[derive(Debug, Clone, Serialize)]
struct DirectoryHealth {
    path: String,
    kind: String,
    status: String,
    exists: bool,
    is_dir: bool,
    readable: bool,
    error: Option<String>,
    hint: Option<String>,
}

fn directory_health_hint(status: &str) -> Option<String> {
    match status {
        "missing" => Some(
            "Directory has not been created yet; Sparo will create it when needed.".to_string(),
        ),
        "not_directory" => {
            Some("Move or rename the file at this path, then run the command again.".to_string())
        }
        "not_file" => Some(
            "Move or rename the directory at this path, then run the command again.".to_string(),
        ),
        "invalid_config" => Some(
            "Fix the config file syntax or move the file aside so Sparo can recreate defaults."
                .to_string(),
        ),
        "unreadable" => Some(
            "Check directory permissions and whether another process is locking it.".to_string(),
        ),
        "inaccessible" => Some(
            "Check OS permissions or security software for the Sparo data directory.".to_string(),
        ),
        _ => None,
    }
}

#[derive(Subcommand)]
enum Commands {
    /// Start interactive chat (TUI)
    Chat {
        /// Agent type (defaults to CLI preference behavior.default_agent)
        #[arg(short, long)]
        agent: Option<String>,

        /// Workspace path (defaults to CLI preference workspace.default_path when set)
        #[arg(short, long)]
        workspace: Option<String>,
    },

    /// Execute single command
    Exec {
        /// User message
        message: String,

        /// Agent type (defaults to CLI preference behavior.default_agent)
        #[arg(short, long)]
        agent: Option<String>,

        /// Workspace path (defaults to CLI preference workspace.default_path when set)
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

        /// Maximum total execution time in seconds (0 disables the CLI-level timeout)
        #[arg(long, default_value_t = 600)]
        timeout_secs: u64,

        /// Tool execution requires confirmation (default: no confirmation to avoid blocking non-interactive mode)
        #[arg(long)]
        confirm: bool,
    },

    /// Execute batch tasks
    Batch {
        /// Task configuration file path
        #[arg(short, long)]
        tasks: Option<String>,

        /// Print an example batch task file and exit
        #[arg(long, value_enum)]
        example: Option<BatchExampleFormat>,

        /// Output batch summary in JSON format
        #[arg(long)]
        json: bool,

        /// Maximum execution time per batch task in seconds (0 disables the CLI-level timeout)
        #[arg(long, default_value_t = 600)]
        timeout_secs: u64,

        /// Continue running later tasks after one task fails
        #[arg(long)]
        continue_on_error: bool,
    },

    /// Session management
    Sessions {
        /// Workspace path whose persisted sessions should be managed (defaults to CLI preference workspace.default_path when set)
        #[arg(short, long, global = true)]
        workspace: Option<String>,

        /// Output in JSON format
        #[arg(long, global = true)]
        json: bool,

        #[command(subcommand)]
        action: SessionAction,
    },

    /// Manage backend-tracked agent tasks
    Tasks {
        /// Workspace hint for task discovery (defaults to CLI preference workspace.default_path when set)
        #[arg(short, long, global = true)]
        workspace: Option<String>,

        /// Output in JSON format
        #[arg(long, global = true)]
        json: bool,

        #[command(subcommand)]
        action: TasksAction,
    },

    /// Inspect available agents
    Agents {
        /// Output in JSON format
        #[arg(long, global = true)]
        json: bool,

        #[command(subcommand)]
        action: AgentsAction,
    },

    /// Configuration management
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },

    /// Manage Agent, Bridge, and Live Apps
    Apps {
        /// Output in JSON format
        #[arg(long, global = true)]
        json: bool,

        #[command(subcommand)]
        action: AppsAction,
    },

    /// Inspect and select known workspaces
    Workspaces {
        /// Output in JSON format
        #[arg(long, global = true)]
        json: bool,

        #[command(subcommand)]
        action: WorkspacesAction,
    },

    /// Browse global and project memory files
    Memory {
        /// Workspace hint for project memory discovery (defaults to CLI preference workspace.default_path when set)
        #[arg(short, long, global = true)]
        workspace: Option<String>,

        /// Output in JSON format
        #[arg(long, global = true)]
        json: bool,

        #[command(subcommand)]
        action: MemoryAction,
    },

    /// Invoke tool directly
    Tool {
        #[command(subcommand)]
        action: ToolAction,
    },

    /// Health check
    Health {
        /// Output in JSON format
        #[arg(long)]
        json: bool,
    },
}

#[derive(Subcommand)]
enum SessionAction {
    /// List all sessions
    List,
    /// Show the most recent session
    Last,
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
    /// Export a session transcript
    Export {
        /// Session ID (or "last" for the most recent)
        id: String,

        /// Output file path. Defaults to stdout.
        #[arg(short, long)]
        output: Option<String>,

        /// Export format
        #[arg(long, value_enum, default_value_t = SessionExportFormat::Markdown)]
        format: SessionExportFormat,
    },
    /// Resume a persisted session in the TUI
    Resume {
        /// Session ID (or "last" for the most recent)
        id: String,

        /// Optional message to prefill in the chat input
        #[arg(short, long)]
        message: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum SessionExportFormat {
    Markdown,
    Json,
}

impl SessionExportFormat {
    fn as_arg(self) -> &'static str {
        match self {
            SessionExportFormat::Markdown => "markdown",
            SessionExportFormat::Json => "json",
        }
    }
}

#[derive(Subcommand)]
enum TasksAction {
    /// List backend-tracked tasks
    List,
    /// Show the most recent backend-tracked task
    Last,
    /// Show one task by session id, title, or "last"
    Show {
        /// Task session id, title, or "last" for the most recent task
        id: String,
    },
    /// Open or resume one task in the TUI by session id, title, or "last"
    Resume {
        /// Task session id, title, or "last" for the most recent task
        id: String,

        /// Optional message to prefill in the chat input
        #[arg(short, long)]
        message: Option<String>,
    },
    /// Export a task transcript by session id, title, or "last"
    Export {
        /// Task session id, title, or "last" for the most recent task
        id: String,

        /// Output file path. Defaults to stdout.
        #[arg(short, long)]
        output: Option<String>,

        /// Export format
        #[arg(long, value_enum, default_value_t = SessionExportFormat::Markdown)]
        format: SessionExportFormat,
    },
}

#[derive(Subcommand)]
enum AgentsAction {
    /// List available built-in, app-backed, and custom agents
    List,
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

        /// Include secrets such as API keys and proxy passwords
        #[arg(long)]
        include_secrets: bool,
    },
    /// Get a shared global configuration value by dot-path
    Get {
        /// Dot-path within the shared global configuration
        path: Option<String>,

        /// Output raw JSON
        #[arg(long)]
        json: bool,

        /// Include secrets such as API keys and proxy passwords
        #[arg(long)]
        include_secrets: bool,
    },
    /// Set a shared global configuration value by dot-path
    Set {
        /// Dot-path within the shared global configuration
        path: String,

        /// JSON value; bare text is treated as a string
        value: String,

        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },
    /// Edit CLI-local presentation preferences
    Edit,
    /// Manage CLI-local preferences
    Prefs {
        #[command(subcommand)]
        action: PrefsAction,
    },
    /// Reset shared global configuration or a dot-path within it
    Reset {
        /// Dot-path within the shared global configuration
        path: Option<String>,

        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },
    /// Export shared global configuration as JSON
    Export {
        /// Include secrets such as API keys and proxy passwords
        #[arg(long)]
        include_secrets: bool,

        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },
    /// Import shared global configuration from a JSON file
    Import {
        /// Exported configuration JSON file
        file: String,

        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },
    /// Validate shared global configuration
    Validate {
        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },
    /// Reload shared global configuration from disk
    Reload {
        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },
    /// Show shared global configuration health
    Health {
        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },
}

#[derive(Subcommand)]
enum PrefsAction {
    /// Show CLI-local preferences
    Get {
        /// Optional preference path
        path: Option<String>,

        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },
    /// Set a CLI-local preference
    Set {
        /// Preference path: ui.theme, ui.show_tips, ui.animation, ui.color_scheme, behavior.default_agent, behavior.confirm_dangerous, workspace.default_path, shortcuts.send_message, shortcuts.interrupt, shortcuts.menu
        path: String,

        /// Preference value
        value: String,

        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },
}

#[derive(Subcommand)]
enum AppsAction {
    /// List installed apps
    List {
        /// Workspace hint for project-scoped context (defaults to CLI preference workspace.default_path when set)
        #[arg(short, long)]
        workspace: Option<String>,
    },
    /// Show one installed app
    Show {
        /// App id or name
        id: String,

        /// Workspace hint for project-scoped context (defaults to CLI preference workspace.default_path when set)
        #[arg(short, long)]
        workspace: Option<String>,
    },
    /// Open the app package or target in the OS file manager
    Open {
        /// App id or name
        id: String,

        /// Workspace hint for project-scoped context (defaults to CLI preference workspace.default_path when set)
        #[arg(short, long)]
        workspace: Option<String>,
    },
}

#[derive(Subcommand)]
enum WorkspacesAction {
    /// List known workspaces
    List,
    /// Show one workspace by label or path
    Show {
        /// Workspace label, path, or "global"
        id: String,
    },
    /// Set the CLI-local default workspace preference
    Use {
        /// Workspace label, path, or "global"
        id: String,
    },
}

#[derive(Subcommand)]
enum MemoryAction {
    /// List global and project memory files
    List,
    /// Show a memory file by file name, scope:file, or full path
    Show {
        /// Memory file name, scope:file, or full path
        id: String,

        /// Maximum bytes to print
        #[arg(long, default_value_t = 12_000)]
        max_bytes: usize,
    },
}

#[derive(Subcommand)]
enum ToolAction {
    /// List registered core tools
    List {
        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },
    /// Show a tool input schema
    Schema {
        /// Tool name
        name: String,

        /// Workspace path for context-aware schemas
        #[arg(short, long)]
        workspace: Option<String>,

        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },
    /// Execute a registered core tool
    Run {
        /// Tool name
        name: String,

        /// Tool parameters as JSON, or a loose flat object such as {path:src,depth:1}
        #[arg(short, long)]
        params: Option<String>,

        /// Read tool parameters as JSON from a file, or "-" for stdin
        #[arg(long)]
        params_file: Option<String>,

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

#[derive(Debug, Clone, Copy, ValueEnum)]
enum BatchExampleFormat {
    Json,
    Toml,
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
            Self::Object { agent, .. } => {
                agent.clone().unwrap_or_else(|| default_agent.to_string())
            }
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

fn batch_example_value(format: BatchExampleFormat) -> serde_json::Value {
    match format {
        BatchExampleFormat::Json => serde_json::json!({
            "tasks": [
                "Summarize the current workspace",
                {
                    "message": "Run a focused code review on the CLI changes",
                    "agent": "debug",
                    "workspace": ".",
                    "output_patch": "review.patch"
                }
            ]
        }),
        BatchExampleFormat::Toml => serde_json::json!({
            "tasks": [
                {
                    "message": "Summarize the current workspace"
                },
                {
                    "message": "Run a focused code review on the CLI changes",
                    "agent": "debug",
                    "workspace": ".",
                    "output_patch": "review.patch"
                }
            ]
        }),
    }
}

fn directory_health(path: &std::path::Path) -> DirectoryHealth {
    match path.try_exists() {
        Ok(false) => DirectoryHealth {
            path: path.to_string_lossy().to_string(),
            kind: "directory".to_string(),
            status: "missing".to_string(),
            exists: false,
            is_dir: false,
            readable: false,
            error: None,
            hint: directory_health_hint("missing"),
        },
        Ok(true) => match path.metadata() {
            Ok(metadata) => {
                let is_dir = metadata.is_dir();
                let readable = is_dir && std::fs::read_dir(path).is_ok();
                let status = if readable {
                    "ok"
                } else if is_dir {
                    "unreadable"
                } else {
                    "not_directory"
                };
                DirectoryHealth {
                    path: path.to_string_lossy().to_string(),
                    kind: "directory".to_string(),
                    status: status.to_string(),
                    exists: true,
                    is_dir,
                    readable,
                    error: if is_dir && !readable {
                        Some("Directory is not readable".to_string())
                    } else if !is_dir {
                        Some("Path exists but is not a directory".to_string())
                    } else {
                        None
                    },
                    hint: directory_health_hint(status),
                }
            }
            Err(error) => DirectoryHealth {
                path: path.to_string_lossy().to_string(),
                kind: "directory".to_string(),
                status: "inaccessible".to_string(),
                exists: true,
                is_dir: false,
                readable: false,
                error: Some(error.to_string()),
                hint: directory_health_hint("inaccessible"),
            },
        },
        Err(error) => DirectoryHealth {
            path: path.to_string_lossy().to_string(),
            kind: "directory".to_string(),
            status: "inaccessible".to_string(),
            exists: false,
            is_dir: false,
            readable: false,
            error: Some(error.to_string()),
            hint: directory_health_hint("inaccessible"),
        },
    }
}

fn file_health(path: &std::path::Path) -> DirectoryHealth {
    match path.try_exists() {
        Ok(false) => DirectoryHealth {
            path: path.to_string_lossy().to_string(),
            kind: "file".to_string(),
            status: "missing".to_string(),
            exists: false,
            is_dir: false,
            readable: false,
            error: None,
            hint: directory_health_hint("missing"),
        },
        Ok(true) => match path.metadata() {
            Ok(metadata) => {
                let is_file = metadata.is_file();
                let readable = is_file && std::fs::File::open(path).is_ok();
                let status = if readable {
                    "ok"
                } else if is_file {
                    "unreadable"
                } else {
                    "not_file"
                };
                DirectoryHealth {
                    path: path.to_string_lossy().to_string(),
                    kind: "file".to_string(),
                    status: status.to_string(),
                    exists: true,
                    is_dir: metadata.is_dir(),
                    readable,
                    error: if is_file && !readable {
                        Some("File is not readable".to_string())
                    } else if !is_file {
                        Some("Path exists but is not a file".to_string())
                    } else {
                        None
                    },
                    hint: directory_health_hint(status),
                }
            }
            Err(error) => DirectoryHealth {
                path: path.to_string_lossy().to_string(),
                kind: "file".to_string(),
                status: "inaccessible".to_string(),
                exists: true,
                is_dir: false,
                readable: false,
                error: Some(error.to_string()),
                hint: directory_health_hint("inaccessible"),
            },
        },
        Err(error) => DirectoryHealth {
            path: path.to_string_lossy().to_string(),
            kind: "file".to_string(),
            status: "inaccessible".to_string(),
            exists: false,
            is_dir: false,
            readable: false,
            error: Some(error.to_string()),
            hint: directory_health_hint("inaccessible"),
        },
    }
}

fn cli_config_file_health(path: &std::path::Path) -> DirectoryHealth {
    let mut health = file_health(path);
    if health.status != "ok" {
        return health;
    }

    match std::fs::read_to_string(path).ok().and_then(|content| {
        match toml::from_str::<CliConfig>(&content) {
            Ok(config) => config.validate().err().map(|error| error.to_string()),
            Err(error) => Some(error.to_string()),
        }
    }) {
        Some(error) => {
            health.status = "invalid_config".to_string();
            health.error = Some(error);
            health.hint = directory_health_hint("invalid_config");
            health
        }
        None => health,
    }
}

fn global_config_file_health(path: &std::path::Path) -> DirectoryHealth {
    let mut health = file_health(path);
    if health.status != "ok" {
        return health;
    }

    match std::fs::read_to_string(path).ok().and_then(|content| {
        serde_json::from_str::<bitfun_core::service::config::GlobalConfig>(&content).err()
    }) {
        Some(error) => {
            health.status = "invalid_config".to_string();
            health.error = Some(error.to_string());
            health.hint = directory_health_hint("invalid_config");
            health
        }
        None => health,
    }
}

fn health_summary(checks: &serde_json::Value) -> serde_json::Value {
    let mut total = 0usize;
    let mut ok = 0usize;
    let mut missing = 0usize;
    let mut problems = 0usize;
    let mut missing_checks = Vec::new();
    let mut missing_details = Vec::new();
    let mut problem_checks = Vec::new();
    let mut problem_details = Vec::new();

    if let Some(checks) = checks.as_object() {
        total = checks.len();
        for (name, check) in checks {
            match check.get("status").and_then(|value| value.as_str()) {
                Some("ok") => ok += 1,
                Some("missing") => {
                    missing += 1;
                    missing_checks.push(name.clone());
                    missing_details.push(serde_json::json!({
                        "name": name,
                        "kind": check.get("kind").and_then(|value| value.as_str()).unwrap_or("path"),
                        "status": "missing",
                        "path": check.get("path").and_then(|value| value.as_str()).unwrap_or("unknown"),
                        "hint": check.get("hint").and_then(|value| value.as_str()),
                    }));
                }
                _ => {
                    problems += 1;
                    problem_checks.push(name.clone());
                    problem_details.push(serde_json::json!({
                        "name": name,
                        "kind": check.get("kind").and_then(|value| value.as_str()).unwrap_or("path"),
                        "status": check.get("status").and_then(|value| value.as_str()).unwrap_or("unknown"),
                        "path": check.get("path").and_then(|value| value.as_str()).unwrap_or("unknown"),
                        "hint": check.get("hint").and_then(|value| value.as_str()),
                    }));
                }
            }
        }
    }

    serde_json::json!({
        "total": total,
        "ok": ok,
        "missing": missing,
        "missing_checks": missing_checks,
        "missing_details": missing_details,
        "problems": problems,
        "problem_checks": problem_checks,
        "problem_details": problem_details,
    })
}

fn cli_health_value() -> Result<serde_json::Value> {
    let config_dir = CliConfig::config_dir_path()?;
    let current_workspace = std::env::current_dir().ok();
    let (agentic_os_memory_path, workspace_sessions_path, workspace_memory_path) =
        match bitfun_core::infrastructure::try_get_path_manager_arc() {
            Ok(path_manager) => {
                let workspace_sessions_path = current_workspace
                    .as_deref()
                    .map(|workspace| path_manager.workspace_sessions_dir(workspace))
                    .unwrap_or_else(|| {
                        config_dir
                            .join("workspaces")
                            .join("unknown")
                            .join("sessions")
                    });
                let workspace_memory_path = current_workspace
                    .as_deref()
                    .map(|workspace| path_manager.workspace_memory_dir(workspace))
                    .unwrap_or_else(|| {
                        config_dir.join("workspaces").join("unknown").join("memory")
                    });
                (
                    path_manager.agentic_os_memory_dir(),
                    workspace_sessions_path,
                    workspace_memory_path,
                )
            }
            Err(_) => (
                config_dir.join("agentic_os").join("memory"),
                config_dir
                    .join("workspaces")
                    .join("unknown")
                    .join("sessions"),
                config_dir.join("workspaces").join("unknown").join("memory"),
            ),
        };
    let checks = serde_json::json!({
        "app_root": directory_health(&config_dir),
        "cli_config_file": cli_config_file_health(&CliConfig::config_path()?),
        "config": directory_health(&config_dir.join("config")),
        "global_config_file": global_config_file_health(&config_dir.join("config").join("app.json")),
        "workspaces": directory_health(&config_dir.join("workspaces")),
        "workspace_sessions": directory_health(&workspace_sessions_path),
        "agentic_os_memory": directory_health(&agentic_os_memory_path),
        "workspace_memory": directory_health(&workspace_memory_path),
        "apps": directory_health(&config_dir.join("apps")),
        "agent_apps": directory_health(&config_dir.join("apps").join("agent_apps")),
        "bridge_apps": directory_health(&config_dir.join("apps").join("bridge_apps")),
        "live_apps": directory_health(&config_dir.join("apps").join("liveapps")),
        "skills": directory_health(&config_dir.join("skills")),
        "logs": directory_health(&config_dir.join("logs")),
    });
    let success = checks
        .as_object()
        .map(|checks| {
            checks.values().all(|check| {
                matches!(
                    check.get("status").and_then(|value| value.as_str()),
                    Some("ok" | "missing")
                )
            })
        })
        .unwrap_or(false);
    let summary = health_summary(&checks);

    Ok(serde_json::json!({
        "success": success,
        "version": env!("CARGO_PKG_VERSION"),
        "config_dir": config_dir.to_string_lossy(),
        "summary": summary,
        "checks": checks,
    }))
}

fn cli_health_success(health: &serde_json::Value) -> bool {
    health
        .get("success")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

fn health_next_steps(health: &serde_json::Value) -> Vec<String> {
    let mut hints = std::collections::BTreeSet::new();
    if let Some(checks) = health.get("checks").and_then(|value| value.as_object()) {
        for check in checks.values() {
            let status = check
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            if matches!(status, "ok" | "missing") {
                continue;
            }
            if let Some(hint) = check.get("hint").and_then(|value| value.as_str()) {
                if !hint.trim().is_empty() {
                    hints.insert(hint.to_string());
                }
            }
        }
    }
    hints.into_iter().collect()
}

fn healthy_health_next_steps() -> Vec<String> {
    vec![
        "Start interactive chat: sparo chat".to_string(),
        "Inspect CLI preferences: sparo config prefs get".to_string(),
        "Inspect shared config: sparo config show".to_string(),
        "Machine output: sparo health --json".to_string(),
    ]
}

fn emit_cli_health(json: bool) -> Result<bool> {
    let health = cli_health_value()?;
    let success = cli_health_success(&health);
    if json {
        print_json(health)?;
    } else {
        if success {
            println!("Sparo CLI is running normally");
        } else {
            println!("Sparo CLI is running, but some data directories need attention");
        }
        println!("Version: {}", env!("CARGO_PKG_VERSION"));
        println!(
            "Config directory: {}",
            health
                .get("config_dir")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown")
        );
        if let Some(summary) = health.get("summary") {
            println!(
                "Summary: {} ok, {} missing, {} problems",
                summary
                    .get("ok")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0),
                summary
                    .get("missing")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0),
                summary
                    .get("problems")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0)
            );
        }
        let mut next_steps = health_next_steps(&health);
        if next_steps.is_empty() && success {
            next_steps = healthy_health_next_steps();
        }
        if !next_steps.is_empty() {
            println!();
            println!("Next steps:");
            for step in next_steps {
                println!("  - {}", step);
            }
        }
        if let Some(checks) = health.get("checks").and_then(|value| value.as_object()) {
            println!();
            println!("Health checks:");
            for (name, check) in checks {
                let status = match check
                    .get("status")
                    .and_then(|value| value.as_str())
                    .unwrap_or("unknown")
                {
                    "ok" => "ok",
                    "missing" => "not created yet",
                    "not_directory" => "not a directory",
                    "not_file" => "not a file",
                    "invalid_config" => "invalid config",
                    "unreadable" => "not readable",
                    "inaccessible" => "inaccessible",
                    _ => "needs attention",
                };
                println!(
                    "  {} [{}]: {} ({})",
                    name,
                    check
                        .get("kind")
                        .and_then(|value| value.as_str())
                        .unwrap_or("path"),
                    status,
                    check
                        .get("path")
                        .and_then(|value| value.as_str())
                        .unwrap_or("unknown")
                );
                if let Some(error) = check.get("error").and_then(|value| value.as_str()) {
                    println!("    {}", error);
                }
                if let Some(hint) = check.get("hint").and_then(|value| value.as_str()) {
                    println!("    hint: {}", hint);
                }
            }
        }
    }
    Ok(success)
}

fn render_batch_example(format: BatchExampleFormat) -> &'static str {
    match format {
        BatchExampleFormat::Json => {
            r#"{
  "tasks": [
    "Summarize the current workspace",
    {
      "message": "Run a focused code review on the CLI changes",
      "agent": "debug",
      "workspace": ".",
      "output_patch": "review.patch"
    }
  ]
}"#
        }
        BatchExampleFormat::Toml => {
            r#"[[tasks]]
message = "Summarize the current workspace"

[[tasks]]
message = "Run a focused code review on the CLI changes"
agent = "debug"
workspace = "."
output_patch = "review.patch""#
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

fn resolve_tui_workspace_path(workspace: Option<&str>) -> Option<std::path::PathBuf> {
    resolve_workspace_path(workspace).or_else(|| {
        bitfun_core::infrastructure::try_get_path_manager_arc()
            .ok()
            .map(|path_manager| path_manager.agentic_os_runtime_root())
    })
}

fn normalize_workspace_hint(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else if value == "." {
        std::env::current_dir()
            .ok()
            .map(|path| path.to_string_lossy().to_string())
    } else if value.eq_ignore_ascii_case("global") {
        agentic_global_workspace_hint()
    } else {
        Some(value.to_string())
    }
}

fn cli_default_workspace_hint(config: &CliConfig) -> Option<String> {
    normalize_workspace_hint(&config.workspace.default_path)
}

fn agentic_global_workspace_hint() -> Option<String> {
    bitfun_core::infrastructure::try_get_path_manager_arc()
        .ok()
        .map(|path_manager| {
            path_manager
                .agentic_os_runtime_root()
                .to_string_lossy()
                .to_string()
        })
}

fn effective_workspace_hint(config: &CliConfig, explicit: Option<&str>) -> Option<String> {
    explicit
        .and_then(normalize_workspace_hint)
        .or_else(|| cli_default_workspace_hint(config))
}

fn resolve_configured_workspace_path(
    config: &CliConfig,
    explicit: Option<&str>,
) -> Option<std::path::PathBuf> {
    let hint = effective_workspace_hint(config, explicit);
    resolve_workspace_path(hint.as_deref())
}

fn cli_timeout(timeout_secs: u64) -> Option<u64> {
    if timeout_secs == 0 {
        None
    } else {
        Some(timeout_secs)
    }
}

fn interactive_tui_skip_tool_confirmation(config: &CliConfig) -> bool {
    !config.behavior.confirm_dangerous
}

fn exec_skip_tool_confirmation(confirm: bool) -> bool {
    !confirm
}

fn effective_cli_agent(config: &CliConfig, explicit_agent: Option<&str>) -> String {
    explicit_agent
        .filter(|agent| !agent.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| config.behavior.default_agent.clone())
}

async fn initialize_cli_process_runtime() -> Result<bitfun_core::runtime::ProcessRuntime> {
    bitfun_core::runtime::initialize_process_runtime(bitfun_core::runtime::ProcessRuntimeOptions {
        initialize_i18n: false,
        initialize_token_usage: false,
    })
    .await
    .context("Failed to initialize CLI process runtime")
}

async fn set_tool_confirmation_skip(
    config_service: &std::sync::Arc<bitfun_core::service::config::ConfigService>,
    skip_confirmation: bool,
    mode: &str,
) -> bool {
    let ai_config: bitfun_core::service::config::types::AIConfig = config_service
        .get_config(Some("ai"))
        .await
        .unwrap_or_default();
    let original_skip_confirmation = ai_config.skip_tool_confirmation;

    if let Err(error) = config_service
        .set_config("ai.skip_tool_confirmation", skip_confirmation)
        .await
    {
        tracing::warn!(
            "Failed to set tool confirmation toggle for {} mode, continuing: {}",
            mode,
            error
        );
    }

    original_skip_confirmation
}

async fn restore_tool_confirmation_skip(
    config_service: &std::sync::Arc<bitfun_core::service::config::ConfigService>,
    original_skip_confirmation: bool,
    mode: &str,
) {
    if let Err(error) = config_service
        .set_config("ai.skip_tool_confirmation", original_skip_confirmation)
        .await
    {
        tracing::warn!(
            "Failed to restore tool confirmation toggle after {} mode: {}",
            mode,
            error
        );
    }
}

type CliTerminal = ratatui::Terminal<ratatui::backend::CrosstermBackend<std::io::Stdout>>;

fn restore_terminal_if_present(terminal: &mut Option<CliTerminal>) {
    if let Some(terminal) = terminal.take() {
        if let Err(error) = ui::restore_terminal(terminal) {
            tracing::warn!(
                "Failed to restore CLI terminal after setup error: {}",
                error
            );
            eprintln!(
                "Warning: failed to restore terminal after setup error: {}",
                error
            );
        }
    }
}

fn render_loading_or_restore(terminal: &mut Option<CliTerminal>, message: &str) -> Result<()> {
    let Some(active_terminal) = terminal.as_mut() else {
        return Ok(());
    };

    if let Err(error) = ui::render_loading(active_terminal, message) {
        restore_terminal_if_present(terminal);
        return Err(error);
    }

    Ok(())
}

fn run_startup_page_or_restore(
    terminal: &mut Option<CliTerminal>,
    startup_page: &mut ui::startup::StartupPage,
) -> Result<ui::startup::StartupOutcome> {
    let Some(active_terminal) = terminal.as_mut() else {
        anyhow::bail!("Startup terminal is not available");
    };

    match startup_page.run(active_terminal) {
        Ok(outcome) => Ok(outcome),
        Err(error) => {
            restore_terminal_if_present(terminal);
            Err(error)
        }
    }
}

fn main() -> std::process::ExitCode {
    let json_error = should_emit_json_error(std::env::args().skip(1));
    let worker = match std::thread::Builder::new()
        .name("sparo-cli-main".to_string())
        .stack_size(16 * 1024 * 1024)
        .spawn(|| -> Result<()> {
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .context("Failed to initialize CLI async runtime")?
                .block_on(run_cli())
        }) {
        Ok(worker) => worker,
        Err(error) => {
            emit_cli_error(
                &anyhow::Error::new(error).context("Failed to start CLI main thread"),
                json_error,
            );
            return std::process::ExitCode::FAILURE;
        }
    };

    match worker.join() {
        Ok(Ok(())) => std::process::ExitCode::SUCCESS,
        Ok(Err(error)) => {
            emit_cli_error(&error, json_error);
            std::process::ExitCode::FAILURE
        }
        Err(payload) => std::panic::resume_unwind(payload),
    }
}

fn should_emit_json_error(args: impl IntoIterator<Item = String>) -> bool {
    let args: Vec<String> = args.into_iter().take_while(|arg| arg != "--").collect();
    if args.iter().any(|arg| is_json_flag_arg(arg)) {
        return true;
    }

    let command_args: Vec<&str> = args
        .iter()
        .filter_map(|arg| match arg.as_str() {
            "-v" | "--verbose" => None,
            value => Some(value),
        })
        .collect();

    match command_args.as_slice() {
        ["config", "get", ..] | ["config", "export", ..] => true,
        ["config", "validate", args @ ..]
        | ["config", "health", args @ ..]
        | ["config", "import", args @ ..]
        | ["tool", "schema", args @ ..] => args.iter().any(|arg| is_json_flag_arg(arg)),
        ["agents", args @ ..] => args.iter().any(|arg| is_json_flag_arg(arg)),
        ["tool", "list", args @ ..] => args.iter().any(|arg| is_json_flag_arg(arg)),
        _ => false,
    }
}

fn is_json_flag_arg(arg: &str) -> bool {
    arg == "--json" || arg.starts_with("--json=")
}

fn command_requests_json(command: &Option<Commands>) -> bool {
    matches!(
        command,
        Some(Commands::Exec { json: true, .. })
            | Some(Commands::Batch { json: true, .. })
            | Some(Commands::Sessions { json: true, .. })
            | Some(Commands::Tasks { json: true, .. })
            | Some(Commands::Agents { json: true, .. })
            | Some(Commands::Apps { json: true, .. })
            | Some(Commands::Workspaces { json: true, .. })
            | Some(Commands::Memory { json: true, .. })
            | Some(Commands::Config {
                action: ConfigAction::Show { json: true, .. }
                    | ConfigAction::Get { .. }
                    | ConfigAction::Set { json: true, .. }
                    | ConfigAction::Prefs {
                        action: PrefsAction::Get { json: true, .. }
                            | PrefsAction::Set { json: true, .. },
                    }
                    | ConfigAction::Reset { json: true, .. }
                    | ConfigAction::Export { .. }
                    | ConfigAction::Import { json: true, .. }
                    | ConfigAction::Validate { json: true }
                    | ConfigAction::Reload { json: true }
                    | ConfigAction::Health { json: true },
            })
            | Some(Commands::Tool {
                action: ToolAction::List { json: true }
                    | ToolAction::Schema { json: true, .. }
                    | ToolAction::Run { json: true, .. },
            })
            | Some(Commands::Health { json: true })
    )
}

#[cfg(test)]
fn cli_parse_error_message(args: &[&str]) -> Option<String> {
    Cli::try_parse_from(args)
        .err()
        .filter(|error| {
            !matches!(
                error.kind(),
                ClapErrorKind::DisplayHelp | ClapErrorKind::DisplayVersion
            )
        })
        .map(|error| error.to_string())
}

fn can_dispatch_before_cli_config(command: &Option<Commands>) -> bool {
    matches!(
        command,
        Some(Commands::Tool {
            action: ToolAction::List { .. } | ToolAction::Schema { .. },
        }) | Some(Commands::Workspaces {
            action: WorkspacesAction::List | WorkspacesAction::Show { .. },
            ..
        })
    )
}

fn can_use_default_config_silently(command: &Option<Commands>) -> bool {
    matches!(
        command,
        Some(Commands::Apps {
            action: AppsAction::List { .. } | AppsAction::Show { .. },
            ..
        }) | Some(Commands::Memory {
            action: MemoryAction::List | MemoryAction::Show { .. },
            ..
        }) | Some(Commands::Agents {
            action: AgentsAction::List,
            ..
        }) | Some(Commands::Tasks {
            action: TasksAction::List
                | TasksAction::Last
                | TasksAction::Show { .. }
                | TasksAction::Export { .. },
            ..
        }) | Some(Commands::Sessions {
            action: SessionAction::List
                | SessionAction::Last
                | SessionAction::Show { .. }
                | SessionAction::Export { .. },
            ..
        })
    )
}

fn requires_valid_cli_config(command: &Option<Commands>, is_tui_mode: bool) -> bool {
    is_tui_mode
        || matches!(
            command,
            Some(Commands::Config {
                action: ConfigAction::Prefs { .. },
            })
        )
}

async fn dispatch_before_cli_config(command: Commands) -> Result<bool> {
    match command {
        Commands::Tool { action } => {
            handle_tool_action(action).await?;
            Ok(true)
        }
        Commands::Workspaces { action, json } => {
            handle_workspaces_action(action, json).await?;
            Ok(true)
        }
        command => {
            drop(command);
            Ok(false)
        }
    }
}

fn is_runtime_directory_error(error: &anyhow::Error) -> bool {
    let message = cli_error_chain(error).join("\n");
    message.contains("initialize_global_config")
        || message.contains("Failed to initialize CLI process runtime")
        || message.contains(APP_CONFIG_DIR_NAME)
}

fn cli_error_hint(error: &anyhow::Error) -> Option<&'static str> {
    let message = cli_error_chain(error).join("\n");
    if is_runtime_directory_error(error) {
        Some("Run `sparo health` to diagnose Sparo CLI data directory access.")
    } else if message.contains("unexpected argument '--workspace'")
        && message.contains("tip: '")
        && message.contains("--workspace")
    {
        Some("Place `--workspace <path>` after the subcommand that accepts it, for example `sparo apps show --workspace <path> <id>` or `sparo memory show --workspace <path> <id>`.")
    } else if message.contains("No history sessions") {
        Some("Start a session with `sparo chat`, or run `sparo exec \"<message>\"` for a one-shot task.")
    } else if message.contains("Session not found:") {
        Some("Run `sparo sessions list` to see available session ids before showing, exporting, or resuming one.")
    } else if message.contains("sessions resume is interactive and does not support --json") {
        Some("Run `sparo sessions resume <id>` without `--json`, or use `sparo sessions show <id> --json` for scriptable inspection.")
    } else if message.contains("tasks resume is interactive and does not support --json") {
        Some("Run `sparo tasks resume <id>` without `--json`, or use `sparo tasks show <id> --json` for scriptable inspection.")
    } else if message.contains("No backend-tracked agent tasks found") {
        Some("Start work with `sparo chat`, or run `sparo sessions list` to inspect saved conversations.")
    } else if message.contains("Task not found:") {
        Some("Run `sparo tasks list` to see task ids and titles before showing, exporting, or resuming one.")
    } else if message.contains("Task has no persisted session id:") {
        Some("Use `sparo tasks resume <id-or-title>` to continue the task in the TUI; task export requires a persisted session transcript.")
    } else if message.contains("Memory file not found:") {
        Some("Run `sparo memory list` to see available global and project memory files.")
    } else if message.contains("App not found:") {
        Some("Run `sparo apps list` to see available Agent, Bridge, and Live Apps.")
    } else if message.contains("does not expose a local target to open")
        || message.contains("App target does not exist:")
        || message.contains("Failed to open app target:")
    {
        Some("Use `sparo apps show <id>` to inspect app details; only apps with a local target can be opened from the CLI.")
    } else if message.contains("Workspace not found:") {
        Some("Run `sparo workspaces list` to see known workspace labels and paths.")
    } else if message.contains("Tool not found:") {
        Some("Run `sparo tool list` to see registered core tools.")
    } else if message.contains("Batch task file is required")
        || message.contains("Failed to read batch task file:")
    {
        Some("Run `sparo batch --example json` or `sparo batch --example toml` to generate a starter task file.")
    } else if message.contains("Invalid JSON batch task file:")
        || message.contains("Invalid TOML batch task file:")
    {
        Some("Compare the file with `sparo batch --example json` or `sparo batch --example toml`, then fix the task syntax.")
    } else if message.contains("Invalid parameters for tool")
        || message.contains("Invalid JSON parameters for tool")
        || message.contains("Failed to read tool parameter file:")
    {
        Some("Use `sparo tool schema <name> --json` to inspect parameters, or pass complex input with `--params-file <file>`.")
    } else if message.contains("Failed to create export directory:")
        || message.contains("Failed to write export file:")
    {
        Some("Pass a writable file path with `--output <file>`; create or fix permissions on the parent directory if needed.")
    } else {
        None
    }
}

fn cli_error_kind(error: &anyhow::Error) -> &'static str {
    let message = cli_error_chain(error).join("\n");
    if message.starts_with("error: ") {
        "cli_parse_error"
    } else if is_runtime_directory_error(error) {
        "runtime_directory_error"
    } else {
        "execution_error"
    }
}

fn cli_error_chain(error: &anyhow::Error) -> Vec<String> {
    error.chain().map(|cause| cause.to_string()).collect()
}

fn emit_cli_error(error: &anyhow::Error, json: bool) {
    if error.to_string() == CLI_OUTPUT_ALREADY_EMITTED {
        return;
    }
    if json && error.to_string() == JSON_OUTPUT_ALREADY_EMITTED {
        return;
    }

    if json {
        let mut value = serde_json::json!({
            "success": false,
            "error_kind": cli_error_kind(error),
            "error": error.to_string(),
        });
        let causes = cli_error_chain(error);
        if causes.len() > 1 {
            value["causes"] = serde_json::Value::Array(
                causes.into_iter().map(serde_json::Value::String).collect(),
            );
        }
        if let Some(hint) = cli_error_hint(error) {
            value["hint"] = serde_json::Value::String(hint.to_string());
        }
        println!(
            "{}",
            serde_json::to_string_pretty(&value).unwrap_or_else(|_| {
                "{\"success\":false,\"error\":\"Failed to serialize error\"}".to_string()
            })
        );
    } else {
        eprintln!("Error: {:#}", error);
        if let Some(hint) = cli_error_hint(error) {
            eprintln!("Hint: {}", hint);
        }
    }
}

async fn run_cli() -> Result<()> {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(error)
            if matches!(
                error.kind(),
                ClapErrorKind::DisplayHelp | ClapErrorKind::DisplayVersion
            ) =>
        {
            error.print()?;
            return Ok(());
        }
        Err(error) => return Err(anyhow::anyhow!(error.to_string())),
    };

    let is_tui_mode = matches!(cli.command, None | Some(Commands::Chat { .. }));
    let structured_output = command_requests_json(&cli.command);
    let log_level = if structured_output {
        tracing_subscriber::filter::LevelFilter::OFF
    } else if cli.verbose {
        tracing_subscriber::filter::LevelFilter::DEBUG
    } else if is_tui_mode {
        tracing_subscriber::filter::LevelFilter::INFO
    } else {
        tracing_subscriber::filter::LevelFilter::OFF
    };

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
            .with_writer(std::io::stderr)
            .with_target(false)
            .init();
    }

    if let Some(Commands::Batch {
        example: Some(format),
        json,
        ..
    }) = &cli.command
    {
        if *json {
            print_json(batch_example_value(*format))?;
        } else {
            println!("{}", render_batch_example(*format));
        }
        return Ok(());
    }

    if let Some(Commands::Health { json }) = &cli.command {
        if !emit_cli_health(*json)? {
            return Err(anyhow::anyhow!(CLI_OUTPUT_ALREADY_EMITTED));
        }
        return Ok(());
    }

    if can_dispatch_before_cli_config(&cli.command) {
        let Some(command) = cli.command else {
            unreachable!("command shape was checked before dispatch");
        };
        dispatch_before_cli_config(command).await?;
        return Ok(());
    }

    let require_valid_config = requires_valid_cli_config(&cli.command, is_tui_mode);
    let show_config_warnings = !is_tui_mode
        && !command_requests_json(&cli.command)
        && !can_use_default_config_silently(&cli.command);
    let config = match CliConfig::load() {
        Ok(config) => config,
        Err(error) => {
            if require_valid_config {
                return Err(error).context("Failed to load CLI config");
            }
            if show_config_warnings {
                eprintln!("Warning: Failed to load config: {}", error);
                eprintln!("Using default configuration");
            }
            CliConfig::default()
        }
    };

    match cli.command {
        Some(Commands::Chat { agent, workspace }) => {
            let explicit_agent = agent.as_deref();
            let configured_agent = effective_cli_agent(&config, explicit_agent);
            let (
                workspace,
                startup_session_id,
                effective_agent,
                startup_initial_message,
                startup_context_messages,
                mut startup_terminal,
            ) = if workspace.is_none() && explicit_agent.is_none() {
                use ui::startup::{StartupOutcome, StartupPage};

                let mut terminal = Some(ui::init_terminal()?);
                render_loading_or_restore(&mut terminal, "Loading Agentic OS backend...")?;
                let snapshot =
                    StartupPage::load_snapshot(cli_default_workspace_hint(&config)).await;
                let mut startup_page = StartupPage::new(snapshot);
                startup_page.set_default_agent(config.behavior.default_agent.clone());
                startup_page.set_theme(ui::theme::Theme::from_preferences(
                    &config.ui.theme,
                    &config.ui.color_scheme,
                ));
                let outcome = run_startup_page_or_restore(&mut terminal, &mut startup_page)?;

                match outcome {
                    StartupOutcome::Launch(launch) => (
                        launch.workspace,
                        launch.session_id,
                        launch.agent,
                        launch.initial_message,
                        launch.context_messages,
                        terminal,
                    ),
                    StartupOutcome::Exit => {
                        restore_terminal_if_present(&mut terminal);
                        println!("Goodbye!");
                        return Ok(());
                    }
                }
            } else {
                (workspace, None, configured_agent, None, Vec::new(), None)
            };

            if startup_terminal.is_some() {
                render_loading_or_restore(
                    &mut startup_terminal,
                    "Initializing system, please wait...",
                )?;
            } else {
                println!("Initializing system, please wait...");
            }

            let workspace_path = resolve_tui_workspace_path(workspace.as_deref());
            tracing::info!("CLI workspace: {:?}", workspace_path);

            let process_runtime = match initialize_cli_process_runtime().await {
                Ok(runtime) => runtime,
                Err(error) => {
                    restore_terminal_if_present(&mut startup_terminal);
                    return Err(error);
                }
            };
            tracing::info!("CLI process runtime initialized");

            let config_service = process_runtime.config_service.clone();
            let original_skip_confirmation = set_tool_confirmation_skip(
                &config_service,
                interactive_tui_skip_tool_confirmation(&config),
                "chat",
            )
            .await;

            let agentic_system = match agent::agentic_system::init_agentic_system()
                .await
                .context("Failed to initialize agentic system")
            {
                Ok(system) => system,
                Err(error) => {
                    restore_tool_confirmation_skip(
                        &config_service,
                        original_skip_confirmation,
                        "chat",
                    )
                    .await;
                    restore_terminal_if_present(&mut startup_terminal);
                    return Err(error);
                }
            };
            tracing::info!("Agentic system initialized");

            if startup_terminal.is_some() {
                if let Err(error) = render_loading_or_restore(
                    &mut startup_terminal,
                    "System initialized, starting chat interface...",
                ) {
                    restore_tool_confirmation_skip(
                        &config_service,
                        original_skip_confirmation,
                        "chat",
                    )
                    .await;
                    return Err(error);
                }
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
            chat_mode.set_initial_context_messages(startup_context_messages);
            chat_mode.set_initial_input(startup_initial_message);
            let chat_result = chat_mode.run(startup_terminal);

            restore_tool_confirmation_skip(&config_service, original_skip_confirmation, "chat")
                .await;

            chat_result?;
        }

        Some(Commands::Exec {
            message,
            agent,
            workspace,
            json,
            output_patch,
            timeout_secs,
            confirm,
        }) => {
            let agent = effective_cli_agent(&config, agent.as_deref());
            let workspace_path_resolved =
                resolve_configured_workspace_path(&config, workspace.as_deref())
                    .or_else(|| std::env::current_dir().ok());
            tracing::info!("CLI workspace: {:?}", workspace_path_resolved);

            let process_runtime = initialize_cli_process_runtime().await?;
            tracing::info!("CLI process runtime initialized");

            let config_service = process_runtime.config_service.clone();
            let original_skip_confirmation = set_tool_confirmation_skip(
                &config_service,
                exec_skip_tool_confirmation(confirm),
                "exec",
            )
            .await;

            let run_result = async {
                let agentic_system = agent::agentic_system::init_agentic_system()
                    .await
                    .context("Failed to initialize agentic system")?;
                tracing::info!("Agentic system initialized");

                let mut exec_mode = ExecMode::new(
                    message,
                    agent,
                    &agentic_system,
                    workspace_path_resolved,
                    output_patch,
                    json,
                    cli_timeout(timeout_secs),
                );
                exec_mode.run().await
            }
            .await;

            restore_tool_confirmation_skip(&config_service, original_skip_confirmation, "exec")
                .await;

            run_result?;
        }

        Some(Commands::Batch {
            tasks,
            example,
            json,
            timeout_secs,
            continue_on_error,
        }) => {
            debug_assert!(example.is_none());
            let tasks = tasks.ok_or_else(|| {
                anyhow::anyhow!("Batch task file is required; use --tasks <file> or --example json")
            })?;
            handle_batch_tasks(
                tasks,
                cli_timeout(timeout_secs),
                continue_on_error,
                json,
                &config,
            )
            .await?;
        }

        Some(Commands::Sessions {
            action: SessionAction::Resume { id, message },
            workspace,
            json,
        }) => {
            if json {
                anyhow::bail!("sessions resume is interactive and does not support --json");
            }
            let workspace = effective_workspace_hint(&config, workspace.as_deref());
            resume_session_in_tui(config, workspace, id, message, Vec::new()).await?;
        }

        Some(Commands::Sessions {
            action,
            workspace,
            json,
        }) => {
            let workspace = effective_workspace_hint(&config, workspace.as_deref());
            handle_session_action(action, workspace, json).await?;
        }

        Some(Commands::Tasks {
            action: TasksAction::Resume { id, message },
            workspace,
            json,
        }) => {
            if json {
                anyhow::bail!("tasks resume is interactive and does not support --json");
            }
            let workspace = effective_workspace_hint(&config, workspace.as_deref());
            let task = resolve_task(workspace.clone(), &id).await?;
            if let Some(session_id) = task.session_id.clone() {
                let resume = task_session_resume_context(&task, workspace, session_id, message);
                resume_session_in_tui(
                    config,
                    resume.workspace,
                    resume.session_id,
                    resume.initial_message,
                    resume.context_messages,
                )
                .await?;
            } else {
                resume_task_without_session_in_tui(
                    config,
                    task_tui_launch_context(&task, workspace, message),
                )
                .await?;
            }
        }

        Some(Commands::Tasks {
            action,
            workspace,
            json,
        }) => {
            let workspace = effective_workspace_hint(&config, workspace.as_deref());
            handle_tasks_action(action, workspace, json).await?;
        }

        Some(Commands::Agents { action, json }) => {
            handle_agents_action(action, json).await?;
        }

        Some(Commands::Config { action }) => {
            handle_config_action(action, &config).await?;
        }

        Some(Commands::Apps { action, json }) => {
            handle_apps_action(action, json, &config).await?;
        }

        Some(Commands::Workspaces { action, json }) => {
            handle_workspaces_action(action, json).await?;
        }

        Some(Commands::Memory {
            action,
            workspace,
            json,
        }) => {
            let workspace = effective_workspace_hint(&config, workspace.as_deref());
            handle_memory_action(action, workspace, json).await?;
        }

        Some(Commands::Tool { action }) => {
            handle_tool_action(action).await?;
        }

        Some(Commands::Health { json }) => {
            if !emit_cli_health(json)? {
                return Err(anyhow::anyhow!(CLI_OUTPUT_ALREADY_EMITTED));
            }
        }

        None => {
            use modes::chat::ChatExitReason;
            use ui::startup::StartupPage;

            let mut home_workspace_hint = cli_default_workspace_hint(&config);
            let mut home_session_hint: Option<String> = None;
            loop {
                let mut terminal = Some(ui::init_terminal()?);
                render_loading_or_restore(&mut terminal, "Loading Agentic OS backend...")?;
                let snapshot = StartupPage::load_snapshot(home_workspace_hint.clone()).await;
                let mut startup_page = StartupPage::new(snapshot);
                startup_page.set_default_agent(config.behavior.default_agent.clone());
                startup_page.set_theme(ui::theme::Theme::from_preferences(
                    &config.ui.theme,
                    &config.ui.color_scheme,
                ));
                if let Some(session_id) = home_session_hint.as_deref() {
                    startup_page.focus_recent_session(session_id);
                }
                let launch = match run_startup_page_or_restore(&mut terminal, &mut startup_page)? {
                    ui::startup::StartupOutcome::Launch(launch) => launch,
                    ui::startup::StartupOutcome::Exit => {
                        restore_terminal_if_present(&mut terminal);
                        println!("Goodbye!");
                        break;
                    }
                };

                render_loading_or_restore(&mut terminal, "Initializing system, please wait...")?;

                let workspace_path = resolve_tui_workspace_path(launch.workspace.as_deref());
                tracing::info!("CLI workspace: {:?}", workspace_path);

                let process_runtime = match initialize_cli_process_runtime().await {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        restore_terminal_if_present(&mut terminal);
                        return Err(error);
                    }
                };
                tracing::info!("CLI process runtime initialized");

                let config_service = process_runtime.config_service.clone();
                let original_skip_confirmation = set_tool_confirmation_skip(
                    &config_service,
                    interactive_tui_skip_tool_confirmation(&config),
                    "home-chat",
                )
                .await;

                let agentic_system = match agent::agentic_system::init_agentic_system()
                    .await
                    .context("Failed to initialize agentic system")
                {
                    Ok(system) => system,
                    Err(error) => {
                        restore_tool_confirmation_skip(
                            &config_service,
                            original_skip_confirmation,
                            "home-chat",
                        )
                        .await;
                        restore_terminal_if_present(&mut terminal);
                        return Err(error);
                    }
                };
                tracing::info!("Agentic system initialized");

                if let Err(error) = render_loading_or_restore(
                    &mut terminal,
                    "System initialized, starting chat interface...",
                ) {
                    restore_tool_confirmation_skip(
                        &config_service,
                        original_skip_confirmation,
                        "home-chat",
                    )
                    .await;
                    return Err(error);
                }

                let mut chat_mode = ChatMode::new_with_session(
                    config.clone(),
                    launch.agent,
                    workspace_path,
                    launch.session_id,
                    &agentic_system,
                );
                chat_mode.set_initial_context_messages(launch.context_messages);
                chat_mode.set_initial_input(launch.initial_message);
                let exit_reason = chat_mode.run(terminal.take());

                restore_tool_confirmation_skip(
                    &config_service,
                    original_skip_confirmation,
                    "home-chat",
                )
                .await;
                let exit_reason = exit_reason?;

                match exit_reason {
                    ChatExitReason::Quit => {
                        println!("Goodbye!");
                        break;
                    }
                    ChatExitReason::BackToMenu {
                        workspace,
                        session_id,
                    } => {
                        if workspace.is_some() {
                            home_workspace_hint = workspace;
                        }
                        home_session_hint = session_id;
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

fn empty_batch_hint() -> &'static str {
    "Add at least one task, or run `sparo batch --example json` to generate a starter file."
}

fn empty_task_hint() -> &'static str {
    "Start work with `sparo chat` or run `sparo batch --example json`; run `sparo health` if expected tasks are missing."
}

fn empty_session_hint() -> &'static str {
    "Start a session with `sparo chat`, or run `sparo exec \"<message>\"`; run `sparo health` if expected history is missing."
}

async fn handle_batch_tasks(
    tasks_file: String,
    timeout_secs: Option<u64>,
    continue_on_error: bool,
    json: bool,
    config: &CliConfig,
) -> Result<()> {
    let raw = std::fs::read_to_string(&tasks_file)
        .with_context(|| format!("Failed to read batch task file: {}", tasks_file))?;
    let parsed = parse_batch_task_file(&raw, &tasks_file)?;
    if parsed.is_empty() {
        if json {
            emit_batch_summary(&tasks_file, &[], true)?;
        } else {
            for line in empty_batch_human_lines(&tasks_file) {
                println!("{}", line);
            }
        }
        return Ok(());
    }

    let process_runtime = initialize_cli_process_runtime().await?;
    tracing::info!("CLI process runtime initialized");

    let config_service = process_runtime.config_service.clone();
    let original_skip_confirmation =
        set_tool_confirmation_skip(&config_service, true, "batch").await;

    let run_result = async {
        let agentic_system = agent::agentic_system::init_agentic_system()
            .await
            .context("Failed to initialize agentic system")?;

        if !json {
            println!(
                "Executing {} batch task(s) from {}",
                parsed.len(),
                tasks_file
            );
        }
        let mut results = Vec::new();
        for (index, task) in parsed.iter().enumerate() {
            let started_at = std::time::Instant::now();
            let agent = task.agent(&config.behavior.default_agent);
            let workspace_path =
                resolve_configured_workspace_path(config, task.workspace().as_deref())
                    .or_else(|| std::env::current_dir().ok());
            if !json {
                println!("\n=== Task {}/{} | {} ===", index + 1, parsed.len(), agent);
            }
            let mut exec_mode = ExecMode::new(
                task.message().to_string(),
                agent.clone(),
                &agentic_system,
                workspace_path,
                task.output_patch(),
                json,
                timeout_secs,
            );
            exec_mode.suppress_output(json);
            match exec_mode.run().await {
                Ok(()) => {
                    results.push(BatchTaskResult {
                        index: index + 1,
                        agent,
                        message: task.message().to_string(),
                        session_id: exec_mode.last_session_id().map(str::to_string),
                        success: true,
                        duration_ms: started_at.elapsed().as_millis(),
                        error_kind: None,
                        error: None,
                    });
                }
                Err(error) => {
                    let error_message = error.to_string();
                    if !json {
                        eprintln!("Batch task {} failed: {}", index + 1, error_message);
                    }
                    results.push(BatchTaskResult {
                        index: index + 1,
                        agent,
                        message: task.message().to_string(),
                        session_id: exec_mode.last_session_id().map(str::to_string),
                        success: false,
                        duration_ms: started_at.elapsed().as_millis(),
                        error_kind: Some(batch_error_kind(&error_message).to_string()),
                        error: Some(error_message.clone()),
                    });
                    if !continue_on_error {
                        emit_batch_summary(&tasks_file, &results, json)?;
                        if json {
                            return Err(anyhow::anyhow!(JSON_OUTPUT_ALREADY_EMITTED));
                        }
                        return Err(anyhow::anyhow!(
                            "Batch stopped after task {} failed: {}",
                            index + 1,
                            error_message
                        ));
                    }
                }
            }
        }

        emit_batch_summary(&tasks_file, &results, json)?;
        if results.iter().any(|result| !result.success) {
            if json {
                return Err(anyhow::anyhow!(JSON_OUTPUT_ALREADY_EMITTED));
            }
            anyhow::bail!("Batch completed with failed tasks");
        }

        Ok(())
    }
    .await;

    restore_tool_confirmation_skip(&config_service, original_skip_confirmation, "batch").await;
    run_result
}

async fn resume_session_in_tui(
    config: CliConfig,
    workspace: Option<String>,
    id: String,
    initial_message: Option<String>,
    context_messages: Vec<String>,
) -> Result<()> {
    use bitfun_core::command::session as session_command;

    println!("Loading session {}...", id);
    let process_runtime = initialize_cli_process_runtime().await?;
    let detail = session_command::show_session(session_command::ShowSessionRequest {
        session_id: id,
        workspace_path: workspace.clone(),
    })
    .await?;

    let workspace = workspace.or_else(|| detail.metadata.workspace_path.clone());
    let workspace_path = resolve_tui_workspace_path(workspace.as_deref());
    let agent = detail.metadata.agent_type.clone();
    let session_id = detail.metadata.session_id.clone();

    let config_service = process_runtime.config_service.clone();
    let skip_tool_confirmation = interactive_tui_skip_tool_confirmation(&config);
    let original_skip_confirmation =
        set_tool_confirmation_skip(&config_service, skip_tool_confirmation, "sessions-resume")
            .await;

    let run_result = async {
        let agentic_system = agent::agentic_system::init_agentic_system()
            .await
            .context("Failed to initialize agentic system")?;
        let mut chat_mode = ChatMode::new_with_session(
            config,
            agent,
            workspace_path,
            Some(session_id),
            &agentic_system,
        );
        chat_mode.set_initial_context_messages(context_messages);
        chat_mode.set_initial_input(initial_message);
        chat_mode.run(None).map(|_| ())
    }
    .await;

    restore_tool_confirmation_skip(
        &config_service,
        original_skip_confirmation,
        "sessions-resume",
    )
    .await;

    run_result
}

struct TaskTuiLaunchContext {
    workspace: Option<String>,
    agent: String,
    title: String,
    initial_message: Option<String>,
    context_messages: Vec<String>,
}

struct TaskSessionResumeContext {
    workspace: Option<String>,
    session_id: String,
    initial_message: Option<String>,
    context_messages: Vec<String>,
}

fn task_detail_context_message(
    task: &bitfun_core::command::agentic_os::AgenticOsTaskRow,
) -> String {
    format!(
        "Task detail\nTitle: {}\nAgent: {}\nStatus: {}\nDetail: {}\nSession: {}\nWorkspace: {}",
        task.title,
        task.agent,
        task.status,
        task.detail,
        task.session_id.as_deref().unwrap_or("none"),
        task.workspace.as_deref().unwrap_or("global")
    )
}

fn task_session_resume_context(
    task: &bitfun_core::command::agentic_os::AgenticOsTaskRow,
    fallback_workspace: Option<String>,
    session_id: String,
    initial_message: Option<String>,
) -> TaskSessionResumeContext {
    TaskSessionResumeContext {
        workspace: task.workspace.clone().or(fallback_workspace),
        session_id,
        initial_message: initial_message.filter(|message| !message.trim().is_empty()),
        context_messages: vec![task_detail_context_message(task)],
    }
}

fn task_tui_launch_context(
    task: &bitfun_core::command::agentic_os::AgenticOsTaskRow,
    fallback_workspace: Option<String>,
    initial_message: Option<String>,
) -> TaskTuiLaunchContext {
    TaskTuiLaunchContext {
        workspace: task.workspace.clone().or(fallback_workspace),
        agent: task.agent.clone(),
        title: task.title.clone(),
        initial_message: initial_message
            .filter(|message| !message.trim().is_empty())
            .or_else(|| {
                Some(task_without_session_followup_prompt(
                    &task.title,
                    &task.agent,
                ))
            }),
        context_messages: vec![task_detail_context_message(task)],
    }
}

async fn resume_task_without_session_in_tui(
    config: CliConfig,
    launch: TaskTuiLaunchContext,
) -> Result<()> {
    println!("Loading task {}...", launch.title);
    let process_runtime = initialize_cli_process_runtime().await?;
    let workspace_path = resolve_tui_workspace_path(launch.workspace.as_deref());

    let config_service = process_runtime.config_service.clone();
    let skip_tool_confirmation = interactive_tui_skip_tool_confirmation(&config);
    let original_skip_confirmation =
        set_tool_confirmation_skip(&config_service, skip_tool_confirmation, "tasks-resume").await;

    let run_result = async {
        let agentic_system = agent::agentic_system::init_agentic_system()
            .await
            .context("Failed to initialize agentic system")?;
        let mut chat_mode =
            ChatMode::new_with_session(config, launch.agent, workspace_path, None, &agentic_system);
        chat_mode.set_initial_context_messages(launch.context_messages);
        chat_mode.set_initial_input(launch.initial_message);
        chat_mode.run(None).map(|_| ())
    }
    .await;

    restore_tool_confirmation_skip(&config_service, original_skip_confirmation, "tasks-resume")
        .await;

    run_result
}

async fn load_tasks_snapshot(
    workspace: Option<String>,
) -> Result<Vec<bitfun_core::command::agentic_os::AgenticOsTaskRow>> {
    let snapshot = bitfun_core::command::agentic_os::get_snapshot_without_config(
        bitfun_core::command::agentic_os::AgenticOsSnapshotRequest {
            workspace_hint: workspace,
        },
    )
    .await?;
    Ok(snapshot.tasks)
}

fn find_task_row<'a>(
    tasks: &'a [bitfun_core::command::agentic_os::AgenticOsTaskRow],
    id_or_title: &str,
) -> Option<&'a bitfun_core::command::agentic_os::AgenticOsTaskRow> {
    if id_or_title.eq_ignore_ascii_case("last") {
        return tasks.first();
    }

    let needle = id_or_title.to_ascii_lowercase();
    tasks.iter().find(|task| {
        task.session_id
            .as_deref()
            .is_some_and(|session_id| session_id.eq_ignore_ascii_case(id_or_title))
            || task.title.to_ascii_lowercase() == needle
    })
}

async fn resolve_task(
    workspace: Option<String>,
    id_or_title: &str,
) -> Result<bitfun_core::command::agentic_os::AgenticOsTaskRow> {
    let tasks = load_tasks_snapshot(workspace).await?;
    resolve_task_from_rows(&tasks, id_or_title)
}

fn resolve_task_from_rows(
    tasks: &[bitfun_core::command::agentic_os::AgenticOsTaskRow],
    id_or_title: &str,
) -> Result<bitfun_core::command::agentic_os::AgenticOsTaskRow> {
    if id_or_title.eq_ignore_ascii_case("last") && tasks.is_empty() {
        anyhow::bail!("No backend-tracked agent tasks found");
    }
    find_task_row(&tasks, id_or_title)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("Task not found: {}", id_or_title))
}

async fn handle_tasks_action(
    action: TasksAction,
    workspace: Option<String>,
    json: bool,
) -> Result<()> {
    match action {
        TasksAction::List => {
            let workspace_for_output = workspace.clone();
            let tasks = load_tasks_snapshot(workspace).await?;
            if json {
                print_json(tasks)?;
            } else {
                for line in tasks_list_human_lines(&tasks, workspace_for_output.as_deref()) {
                    println!("{}", line);
                }
            }
        }
        TasksAction::Last => {
            show_task_details(workspace, "last", json).await?;
        }
        TasksAction::Show { id } => {
            show_task_details(workspace, &id, json).await?;
        }
        TasksAction::Export { id, output, format } => {
            let task = resolve_task(workspace.clone(), &id).await?;
            let session_id = task
                .session_id
                .clone()
                .ok_or_else(|| anyhow::anyhow!("Task has no persisted session id: {}", id))?;
            use bitfun_core::command::session as session_command;
            let detail = session_command::show_session(session_command::ShowSessionRequest {
                session_id: session_id.clone(),
                workspace_path: task.workspace.or(workspace),
            })
            .await?;
            let exported = match format {
                SessionExportFormat::Json => serde_json::to_string_pretty(&detail)?,
                SessionExportFormat::Markdown => render_session_markdown(&detail),
            };
            if let Some(output) = output {
                write_export_file(&output, &exported)?;
                if json {
                    print_json(serde_json::json!({ "output": output }))?;
                } else {
                    for line in task_export_human_lines(&task.title, &session_id, &output, format) {
                        println!("{}", line);
                    }
                }
            } else {
                println!("{}", exported);
            }
        }
        TasksAction::Resume { .. } => {
            anyhow::bail!("tasks resume must be handled before non-interactive task actions");
        }
    }
    Ok(())
}

async fn handle_agents_action(action: AgentsAction, json: bool) -> Result<()> {
    match action {
        AgentsAction::List => {
            let _process_runtime = initialize_cli_process_runtime().await?;
            let _agentic_system = agent::agentic_system::init_agentic_system()
                .await
                .context("Failed to initialize agentic system")?;
            let agents = bitfun_core::agentic::agents::get_agent_registry()
                .list_agents_info()
                .await;

            if json {
                print_json(agents)?;
                return Ok(());
            }

            for line in agents_human_lines(&agents) {
                println!("{}", line);
            }
        }
    }
    Ok(())
}

async fn show_task_details(workspace: Option<String>, id: &str, json: bool) -> Result<()> {
    let task = resolve_task(workspace, id).await?;
    if json {
        print_json(task)?;
    } else {
        for line in task_human_detail_lines(&task) {
            println!("{}", line);
        }
    }
    Ok(())
}

fn tasks_list_human_lines(
    tasks: &[bitfun_core::command::agentic_os::AgenticOsTaskRow],
    workspace: Option<&str>,
) -> Vec<String> {
    if tasks.is_empty() {
        return vec![
            "No backend-tracked agent tasks found.".to_string(),
            empty_task_hint().to_string(),
            "Inspect saved sessions with `sparo sessions list`.".to_string(),
        ];
    }

    let mut lines = vec![
        format!("Agent Tasks (total {})", tasks.len()),
        String::new(),
    ];
    for task in tasks {
        lines.push(format!(
            "{} | {} | {}",
            task.session_id.as_deref().unwrap_or("no-session"),
            task.status,
            task.title
        ));
        lines.push(format!("  agent: {} | {}", task.agent, task.detail));
        if let Some(workspace) = &task.workspace {
            lines.push(format!("  workspace: {}", workspace));
        }
        lines.push(String::new());
    }

    if let Some(latest) = tasks.first() {
        let workspace_arg = workspace_option(latest.workspace.as_deref().or(workspace));
        let task_id = latest.session_id.as_deref().unwrap_or(&latest.title);
        let task_arg = shell_arg(task_id);
        lines.push("Next actions:".to_string());
        lines.push(format!(
            "  Resume latest: sparo tasks{} resume {}",
            workspace_arg, task_arg
        ));
        lines.push(format!(
            "  Show details: sparo tasks{} show {}",
            workspace_arg, task_arg
        ));
        if latest.session_id.is_some() {
            lines.push(format!(
                "  Export latest: sparo tasks{} export {} --output task.md",
                workspace_arg, task_arg
            ));
        } else {
            lines.push(
                "  Export latest: unavailable until this task has a persisted session transcript."
                    .to_string(),
            );
        }
        lines.push(format!("  Open TUI tasks: sparo chat{}", workspace_arg));
    }

    lines
}

fn task_human_detail_lines(
    task: &bitfun_core::command::agentic_os::AgenticOsTaskRow,
) -> Vec<String> {
    let workspace_arg = workspace_option(task.workspace.as_deref());
    let resume_id = task.session_id.as_deref().unwrap_or(&task.title);
    let resume_arg = shell_arg(resume_id);
    let mut lines = vec![
        "Task Details".to_string(),
        String::new(),
        format!("Title: {}", task.title),
        format!("Session: {}", task.session_id.as_deref().unwrap_or("none")),
        format!("Agent: {}", task.agent),
        format!("Status: {}", task.status),
        format!("Detail: {}", task.detail),
        format!(
            "Workspace: {}",
            task.workspace.as_deref().unwrap_or("global")
        ),
        String::new(),
        "Next actions:".to_string(),
        format!(
            "  Resume: sparo tasks{} resume {}",
            workspace_arg, resume_arg
        ),
    ];

    if let Some(session_id) = task.session_id.as_deref() {
        lines.push(format!(
            "  Export: sparo tasks{} export {} --output task.md",
            workspace_arg,
            shell_arg(session_id)
        ));
    } else {
        lines.push(
            "  Export: unavailable until this task has a persisted session transcript.".to_string(),
        );
    }

    lines
}

fn task_export_human_lines(
    title: &str,
    session_id: &str,
    output: &str,
    format: SessionExportFormat,
) -> Vec<String> {
    let session_arg = shell_arg(session_id);
    vec![
        "Task Exported".to_string(),
        format!("Task: {}", title),
        format!("Session: {}", session_id),
        format!("Output: {}", output),
        format!("Format: {}", format.as_arg()),
        String::new(),
        "Next actions:".to_string(),
        format!("  Open file: {}", shell_arg(output)),
        format!("  Inspect task: sparo tasks show {}", session_arg),
        format!("  Resume task: sparo tasks resume {}", session_arg),
        format!(
            "  Machine output: sparo tasks export {} --output {} --format {} --json",
            session_arg,
            shell_arg(output),
            format.as_arg()
        ),
    ]
}

fn agent_summary_line(agent: &bitfun_core::agentic::agents::AgentInfo) -> String {
    let state = if agent.enabled { "enabled" } else { "disabled" };
    let readonly = if agent.is_readonly {
        "readonly"
    } else {
        "write"
    };
    format!(
        "{} | {} | {} | {} tools | {}",
        agent.id, agent.name, state, agent.tool_count, readonly
    )
}

fn agents_human_lines(agents: &[bitfun_core::agentic::agents::AgentInfo]) -> Vec<String> {
    if agents.is_empty() {
        return vec![
            "No agents available.".to_string(),
            "Run `sparo health` if the agent registry failed to load.".to_string(),
        ];
    }

    let mut lines = vec![
        format!("Available Agents (total {})", agents.len()),
        String::new(),
    ];
    for agent in agents {
        lines.push(agent_summary_line(agent));
        if let Some(description) = compact_description(&agent.description) {
            lines.push(format!("  {}", description));
        }
        if let Some(app_kind) = &agent.app_kind {
            lines.push(format!("  app: {}", app_kind));
        }
        if let Some(path) = agent
            .app_path
            .as_ref()
            .or(agent.path.as_ref())
            .filter(|path| !path.trim().is_empty())
        {
            lines.push(format!("  path: {}", path));
        }
        if !agent.default_tools.is_empty() {
            let mut tools = agent
                .default_tools
                .iter()
                .take(5)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ");
            if agent.default_tools.len() > 5 {
                tools.push_str(&format!(" (+{} more)", agent.default_tools.len() - 5));
            }
            lines.push(format!("  tools: {}", tools));
        }
        lines.push(String::new());
    }

    lines.push("Next actions:".to_string());
    if let Some(agent) = agents.iter().find(|agent| agent.enabled) {
        let agent_arg = shell_arg(&agent.id);
        lines.push(format!(
            "  Chat with agent: sparo chat --agent {}",
            agent_arg
        ));
        lines.push(format!(
            "  One-shot run: sparo exec --agent {} \"<message>\"",
            agent_arg
        ));
        lines.push(format!(
            "  Make default: sparo config prefs set behavior.default_agent {}",
            agent_arg
        ));
    } else {
        lines.push("  Enable an agent in configuration before launching chat or exec.".to_string());
    }
    lines.push("  Machine output: sparo agents list --json".to_string());

    lines
}

fn compact_description(description: &str) -> Option<String> {
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

#[derive(Debug, serde::Serialize)]
struct BatchTaskResult {
    index: usize,
    agent: String,
    message: String,
    session_id: Option<String>,
    success: bool,
    duration_ms: u128,
    error_kind: Option<String>,
    error: Option<String>,
}

#[derive(Debug, serde::Serialize)]
struct BatchSummary<'a> {
    tasks_file: &'a str,
    passed: usize,
    failed: usize,
    total: usize,
    results: &'a [BatchTaskResult],
}

fn batch_summary<'a>(tasks_file: &'a str, results: &'a [BatchTaskResult]) -> BatchSummary<'a> {
    let passed = results.iter().filter(|result| result.success).count();
    let failed = results.len().saturating_sub(passed);
    BatchSummary {
        tasks_file,
        passed,
        failed,
        total: results.len(),
        results,
    }
}

fn emit_batch_summary(tasks_file: &str, results: &[BatchTaskResult], json: bool) -> Result<()> {
    let summary = batch_summary(tasks_file, results);
    if json {
        print_json(summary)
    } else {
        for line in batch_summary_human_lines(&summary) {
            println!("{}", line);
        }
        Ok(())
    }
}

fn empty_batch_human_lines(tasks_file: &str) -> Vec<String> {
    let mut lines = vec![
        format!("No batch tasks found in {}", tasks_file),
        empty_batch_hint().to_string(),
    ];
    lines.extend(batch_summary_human_lines(&batch_summary(tasks_file, &[])));
    lines
}

fn batch_summary_human_lines(summary: &BatchSummary<'_>) -> Vec<String> {
    let mut lines = vec![
        String::new(),
        "=== Batch Summary ===".to_string(),
        format!(
            "{} passed, {} failed, {} total",
            summary.passed, summary.failed, summary.total
        ),
    ];

    for result in summary.results {
        lines.push(batch_result_summary_line(result));
        if let Some(line) = batch_result_session_line(result.session_id.as_deref()) {
            lines.push(line);
        }
        if let Some(error) = &result.error {
            if let Some(kind) = &result.error_kind {
                lines.push(format!("   error kind: {}", kind));
            }
            lines.push(format!("   error: {}", error));
        }
    }

    lines.extend([String::new(), "Next actions:".to_string()]);
    if let Some(session_id) = summary
        .results
        .iter()
        .rev()
        .find_map(|result| result.session_id.as_deref())
    {
        lines.push(format!(
            "  Resume latest session: sparo sessions resume {}",
            shell_arg(session_id)
        ));
    }
    lines.push("  Inspect sessions: sparo sessions list".to_string());
    if summary.failed > 0 {
        lines.push(format!(
            "  Rerun after fixes: sparo batch --tasks {} --continue-on-error",
            shell_arg(summary.tasks_file)
        ));
    } else if summary.total == 0 {
        lines.push("  Generate starter file: sparo batch --example json".to_string());
    } else {
        lines.push(format!(
            "  Rerun batch: sparo batch --tasks {}",
            shell_arg(summary.tasks_file)
        ));
    }
    lines.push(format!(
        "  Machine output: sparo batch --tasks {} --json",
        shell_arg(summary.tasks_file)
    ));

    lines
}

fn batch_result_session_line(session_id: Option<&str>) -> Option<String> {
    session_id.map(|session_id| {
        format!(
            "   session: {} (resume with `sparo sessions resume {}`)",
            session_id, session_id
        )
    })
}

fn sessions_list_human_lines(
    sessions: &[bitfun_core::service::session::SessionMetadata],
    workspace_path: Option<&str>,
) -> Vec<String> {
    if sessions.is_empty() {
        return vec![
            "No history sessions".to_string(),
            empty_session_hint().to_string(),
        ];
    }

    let mut lines = vec![
        format!("History sessions (total {})", sessions.len()),
        String::new(),
    ];

    for (index, info) in sessions.iter().enumerate() {
        lines.push(format!(
            "{}. {} (ID: {})",
            index + 1,
            info.session_name,
            info.session_id
        ));
        lines.push(format!(
            "   Agent: {} | Turns: {} | Messages: {} | Updated: {}",
            info.agent_type,
            info.turn_count,
            info.message_count,
            format_unix_ms(info.last_active_at)
        ));
        if let Some(workspace) = &info.workspace_path {
            lines.push(format!("   Workspace: {}", workspace));
        }
        lines.push(String::new());
    }

    if let Some(recent) = sessions.first() {
        let session_arg = shell_arg(&recent.session_id);
        let workspace_arg = workspace_option(workspace_path);
        lines.push("Next actions:".to_string());
        lines.push(format!(
            "  Resume latest: sparo sessions{} resume {}",
            workspace_arg, session_arg
        ));
        lines.push(format!(
            "  Show details: sparo sessions{} show {}",
            workspace_arg, session_arg
        ));
        lines.push(format!(
            "  Export latest: sparo sessions{} export {} --output session.md",
            workspace_arg, session_arg
        ));
        lines.push(format!("  Open TUI history: sparo chat{}", workspace_arg));
    }

    lines
}

fn batch_result_summary_line(result: &BatchTaskResult) -> String {
    let status = if result.success { "ok" } else { "failed" };
    let first_line = result.message.lines().next().unwrap_or("");
    format!(
        "{}. {} | {} | {} ms | {}",
        result.index, status, result.agent, result.duration_ms, first_line
    )
}

fn batch_error_kind(error: &str) -> &'static str {
    if error.contains("timed out after") {
        "timeout"
    } else if error.contains("cancelled") {
        "cancelled"
    } else {
        "execution_error"
    }
}

fn parse_batch_task_file(raw: &str, file_name: &str) -> Result<Vec<BatchTask>> {
    let raw = strip_utf8_bom(raw);
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

fn write_export_file(output: &str, content: &str) -> Result<()> {
    let path = std::path::Path::new(output);
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create export directory: {}", parent.display()))?;
    }
    std::fs::write(path, content)
        .with_context(|| format!("Failed to write export file: {}", output))?;
    Ok(())
}

async fn handle_session_action(
    action: SessionAction,
    workspace_path: Option<String>,
    json: bool,
) -> Result<()> {
    use bitfun_core::command::session as session_command;

    match action {
        SessionAction::List => {
            let workspace_for_output = workspace_path.clone();
            let sessions =
                session_command::list_sessions(session_command::SessionWorkspaceRequest {
                    workspace_path,
                })
                .await?;

            if json {
                print_json(sessions)?;
                return Ok(());
            }

            for line in sessions_list_human_lines(&sessions, workspace_for_output.as_deref()) {
                println!("{}", line);
            }
        }

        SessionAction::Last => {
            show_session_details("last".to_string(), workspace_path, json).await?;
        }

        SessionAction::Show { id } => {
            show_session_details(id, workspace_path, json).await?;
        }

        SessionAction::Delete { id } => {
            let workspace_for_output = workspace_path.clone();
            let response = session_command::delete_session(session_command::DeleteSessionRequest {
                session_id: id.clone(),
                workspace_path,
            })
            .await?;
            if json {
                print_json(response)?;
                return Ok(());
            }
            for line in
                session_delete_human_lines(&id, workspace_for_output.as_deref(), &response.message)
            {
                println!("{}", line);
            }
        }

        SessionAction::Export { id, output, format } => {
            let detail = session_command::show_session(session_command::ShowSessionRequest {
                session_id: id.clone(),
                workspace_path,
            })
            .await?;

            let exported = match format {
                SessionExportFormat::Json => serde_json::to_string_pretty(&detail)?,
                SessionExportFormat::Markdown => render_session_markdown(&detail),
            };

            if let Some(output) = output {
                write_export_file(&output, &exported)?;
                if json {
                    print_json(serde_json::json!({ "output": output }))?;
                } else {
                    for line in session_export_human_lines(
                        &detail.metadata.session_id,
                        detail.metadata.workspace_path.as_deref(),
                        &output,
                        format,
                    ) {
                        println!("{}", line);
                    }
                }
            } else {
                println!("{}", exported);
            }
        }

        SessionAction::Resume { .. } => {
            anyhow::bail!("sessions resume must be handled before non-interactive session actions");
        }
    }

    Ok(())
}

async fn show_session_details(
    id: String,
    workspace_path: Option<String>,
    json: bool,
) -> Result<()> {
    use bitfun_core::command::session as session_command;

    let detail = session_command::show_session(session_command::ShowSessionRequest {
        session_id: id,
        workspace_path,
    })
    .await?;

    if json {
        print_json(detail)?;
        return Ok(());
    }

    let metadata = &detail.metadata;

    for line in session_human_detail_lines(metadata) {
        println!("{}", line);
    }

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

    Ok(())
}

fn session_human_detail_lines(
    metadata: &bitfun_core::service::session::SessionMetadata,
) -> Vec<String> {
    let workspace_arg = workspace_option(metadata.workspace_path.as_deref());
    let session_arg = shell_arg(&metadata.session_id);
    let mut lines = vec![
        "Session Details".to_string(),
        String::new(),
        format!("Title: {}", metadata.session_name),
        format!("ID: {}", metadata.session_id),
        format!("Agent: {}", metadata.agent_type),
        format!("Created: {}", format_unix_ms(metadata.created_at)),
        format!("Updated: {}", format_unix_ms(metadata.last_active_at)),
    ];

    if let Some(workspace) = &metadata.workspace_path {
        lines.push(format!("Workspace: {}", workspace));
    }

    lines.extend([
        String::new(),
        "Statistics:".to_string(),
        format!("  Turns: {}", metadata.turn_count),
        format!("  Messages: {}", metadata.message_count),
        format!("  Tool calls: {}", metadata.tool_call_count),
        String::new(),
        "Next actions:".to_string(),
        format!(
            "  Resume: sparo sessions{} resume {}",
            workspace_arg, session_arg
        ),
        format!(
            "  Export: sparo sessions{} export {} --output session.md",
            workspace_arg, session_arg
        ),
        String::new(),
    ]);

    lines
}

fn render_session_markdown(detail: &bitfun_core::command::session::SessionDetail) -> String {
    let metadata = &detail.metadata;
    let mut out = String::new();
    out.push_str(&format!("# {}\n\n", metadata.session_name));
    out.push_str(&format!("- ID: `{}`\n", metadata.session_id));
    out.push_str(&format!("- Agent: `{}`\n", metadata.agent_type));
    out.push_str(&format!(
        "- Created: `{}`\n",
        format_unix_ms(metadata.created_at)
    ));
    out.push_str(&format!(
        "- Updated: `{}`\n",
        format_unix_ms(metadata.last_active_at)
    ));
    if let Some(workspace) = &metadata.workspace_path {
        out.push_str(&format!("- Workspace: `{}`\n", workspace));
    }
    out.push_str(&format!(
        "- Turns: {} | Messages: {} | Tool calls: {}\n\n",
        metadata.turn_count, metadata.message_count, metadata.tool_call_count
    ));

    for turn in &detail.turns {
        out.push_str(&format!("## Turn {}\n\n", turn.turn_index + 1));
        out.push_str("### User\n\n");
        out.push_str(turn.user_message.content.trim());
        out.push_str("\n\n");

        let mut wrote_assistant = false;
        for round in &turn.model_rounds {
            for text in &round.text_items {
                if text.content.trim().is_empty() {
                    continue;
                }
                if !wrote_assistant {
                    out.push_str("### Assistant\n\n");
                    wrote_assistant = true;
                }
                out.push_str(text.content.trim());
                out.push_str("\n\n");
            }
            if !round.tool_items.is_empty() {
                out.push_str("### Tools\n\n");
                for tool in &round.tool_items {
                    out.push_str(&format!(
                        "- `{}`: {}\n",
                        tool.tool_name,
                        tool.status.as_deref().unwrap_or("completed")
                    ));
                }
                out.push('\n');
            }
        }
    }

    out
}

fn session_delete_human_lines(id: &str, workspace: Option<&str>, message: &str) -> Vec<String> {
    let workspace_arg = workspace_option(workspace);
    vec![
        "Session Deleted".to_string(),
        format!("Status: {}", message),
        format!("Requested session: {}", id),
        format!(
            "Workspace: {}",
            workspace.unwrap_or("current directory or Agentic OS global runtime")
        ),
        String::new(),
        "Next actions:".to_string(),
        format!("  Inspect sessions: sparo sessions{} list", workspace_arg),
        format!("  Start a new chat: sparo chat{}", workspace_arg),
        format!(
            "  Machine output: sparo sessions{} delete {} --json",
            workspace_arg,
            shell_arg(id)
        ),
    ]
}

fn session_export_human_lines(
    id: &str,
    workspace: Option<&str>,
    output: &str,
    format: SessionExportFormat,
) -> Vec<String> {
    let workspace_arg = workspace_option(workspace);
    let session_arg = shell_arg(id);
    vec![
        "Session Exported".to_string(),
        format!("Session: {}", id),
        format!(
            "Workspace: {}",
            workspace.unwrap_or("current directory or Agentic OS global runtime")
        ),
        format!("Output: {}", output),
        format!("Format: {}", format.as_arg()),
        String::new(),
        "Next actions:".to_string(),
        format!("  Open file: {}", shell_arg(output)),
        format!(
            "  Resume session: sparo sessions{} resume {}",
            workspace_arg, session_arg
        ),
        format!(
            "  Show details: sparo sessions{} show {}",
            workspace_arg, session_arg
        ),
        format!(
            "  Machine output: sparo sessions{} export {} --output {} --format {} --json",
            workspace_arg,
            session_arg,
            shell_arg(output),
            format.as_arg()
        ),
    ]
}

async fn build_command_context() -> Result<bitfun_core::command::CommandContext> {
    let runtime = initialize_cli_process_runtime().await?;
    Ok(runtime.command_context())
}

fn parse_config_value(value: &str) -> serde_json::Value {
    serde_json::from_str(value).unwrap_or_else(|_| serde_json::Value::String(value.to_string()))
}

fn cli_prefs_value(config: &CliConfig, path: Option<&str>) -> Result<serde_json::Value> {
    let all = serde_json::to_value(config)?;
    match path {
        Some(path) => get_json_path(&all, path)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Unknown CLI preference path: {}", path)),
        None => Ok(all),
    }
}

fn cli_presentation_preference_lines(config: &CliConfig) -> Vec<String> {
    vec![
        format!("  Theme: {}", config.ui.theme),
        format!("  Color scheme: {}", config.ui.color_scheme),
        format!("  Show tips: {}", config.ui.show_tips),
        format!("  Animation: {}", config.ui.animation),
        format!("  Default Agent: {}", config.behavior.default_agent),
        format!(
            "  Confirm dangerous tools: {}",
            config.behavior.confirm_dangerous
        ),
        format!("  Default workspace: {}", config.workspace.default_path),
        format!("  Send shortcut: {}", config.shortcuts.send_message),
        format!("  Interrupt shortcut: {}", config.shortcuts.interrupt),
        format!("  Menu shortcut: {}", config.shortcuts.menu),
    ]
}

fn cli_config_path_line(config_path: &std::path::Path) -> String {
    format!("  CLI preference file: {}", config_path.display())
}

fn cli_pref_human_value(value: &serde_json::Value) -> Result<String> {
    match value {
        serde_json::Value::String(value) => Ok(value.clone()),
        serde_json::Value::Bool(value) => Ok(value.to_string()),
        serde_json::Value::Number(value) => Ok(value.to_string()),
        serde_json::Value::Null => Ok("null".to_string()),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            Ok(serde_json::to_string_pretty(value)?)
        }
    }
}

fn cli_prefs_get_human_output(config: &CliConfig, path: Option<&str>) -> Result<String> {
    if let Some(path) = path {
        let value = cli_prefs_value(config, Some(path))?;
        return Ok(format!("{} = {}", path, cli_pref_human_value(&value)?));
    }

    let mut lines = vec!["CLI Preferences".to_string()];
    lines.extend(cli_presentation_preference_lines(config));
    if !config.workspace.exclude_patterns.is_empty() {
        lines.push(format!(
            "  Exclude patterns: {}",
            config.workspace.exclude_patterns.join(", ")
        ));
    }
    lines.push(cli_config_path_line(&CliConfig::config_path()?));
    lines.extend([
        String::new(),
        "Next actions:".to_string(),
        "  Edit preferences: sparo config edit".to_string(),
        "  Validate preferences: sparo health".to_string(),
        "  Machine output: sparo config prefs get --json".to_string(),
    ]);
    Ok(lines.join("\n"))
}

fn shared_config_summary_lines(value: &serde_json::Value) -> Vec<String> {
    let models = value
        .pointer("/ai/models")
        .and_then(|value| value.as_array())
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let enabled_models = models
        .iter()
        .filter(|model| {
            model
                .get("enabled")
                .and_then(|value| value.as_bool())
                .unwrap_or(false)
        })
        .count();
    let agent_model_count = value
        .pointer("/ai/agent_models")
        .and_then(|value| value.as_object())
        .map(serde_json::Map::len)
        .unwrap_or(0);
    let app_language = value
        .pointer("/app/language")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown");

    let mut default_models = Vec::new();
    if let Some(defaults) = value
        .pointer("/ai/default_models")
        .and_then(|value| value.as_object())
    {
        for key in ["primary", "fast", "search", "image_generation"] {
            match defaults.get(key) {
                Some(serde_json::Value::String(model)) if !model.is_empty() => {
                    default_models.push(format!("{}={}", key, model));
                }
                Some(serde_json::Value::Null) | None => {}
                Some(value) => default_models.push(format!("{}={}", key, value)),
            }
        }
    }

    let default_models = if default_models.is_empty() {
        "not configured".to_string()
    } else {
        default_models.join(", ")
    };

    vec![
        "Shared Global Configuration Summary".to_string(),
        "  Path: <root>".to_string(),
        format!(
            "  Models: {} configured, {} enabled",
            models.len(),
            enabled_models
        ),
        format!("  Default models: {}", default_models),
        format!("  Agent model mappings: {}", agent_model_count),
        format!("  App language: {}", app_language),
        format!("  Full shared config: sparo config show --json"),
        format!("  Read one shared path: sparo config get <path>"),
    ]
}

fn json_array_strings(value: &serde_json::Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    item.as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| item.to_string())
                })
                .collect()
        })
        .unwrap_or_default()
}

fn config_validate_human_lines(value: &serde_json::Value) -> Vec<String> {
    let valid = value
        .get("valid")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let errors = json_array_strings(value, "errors");
    let warnings = json_array_strings(value, "warnings");
    let mut lines = vec![
        "Shared Global Configuration Validation".to_string(),
        String::new(),
        format!("Status: {}", if valid { "valid" } else { "invalid" }),
        format!("Errors: {}", errors.len()),
        format!("Warnings: {}", warnings.len()),
    ];

    if !errors.is_empty() {
        lines.push(String::new());
        lines.push("Errors:".to_string());
        lines.extend(errors.iter().map(|error| format!("  - {}", error)));
    }
    if !warnings.is_empty() {
        lines.push(String::new());
        lines.push("Warnings:".to_string());
        lines.extend(warnings.iter().map(|warning| format!("  - {}", warning)));
    }

    lines.extend([String::new(), "Next actions:".to_string()]);
    if !valid {
        lines.push("  Edit config: sparo config edit".to_string());
    }
    lines.extend([
        "  Inspect config: sparo config show".to_string(),
        "  Run health: sparo config health".to_string(),
        "  Machine output: sparo config validate --json".to_string(),
    ]);

    lines
}

fn config_health_human_lines(value: &serde_json::Value) -> Vec<String> {
    let healthy = value
        .get("healthy")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let warnings = json_array_strings(value, "warnings");
    let mut lines = vec![
        "Shared Global Configuration Health".to_string(),
        String::new(),
        format!(
            "Status: {}",
            if healthy {
                "healthy"
            } else {
                "needs attention"
            }
        ),
        format!(
            "Message: {}",
            value
                .get("message")
                .and_then(|value| value.as_str())
                .unwrap_or("unavailable")
        ),
        format!(
            "Providers: {}",
            value
                .get("total_providers")
                .and_then(|value| value.as_u64())
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string())
        ),
        format!(
            "Config directory: {}",
            value
                .get("config_directory")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown")
        ),
    ];

    if !warnings.is_empty() {
        lines.push(String::new());
        lines.push("Warnings:".to_string());
        lines.extend(warnings.iter().map(|warning| format!("  - {}", warning)));
    }

    lines.extend([String::new(), "Next actions:".to_string()]);
    if !healthy {
        lines.push("  Run CLI health: sparo health".to_string());
    }
    lines.extend([
        "  Validate config: sparo config validate".to_string(),
        "  Inspect config: sparo config show".to_string(),
        "  Machine output: sparo config health --json".to_string(),
    ]);

    lines
}

fn config_edit_human_lines(config_path: &std::path::Path) -> Vec<String> {
    let path = config_path.to_string_lossy();
    let path_arg = shell_arg(&path);
    let mut lines = vec![
        "CLI Preference File".to_string(),
        String::new(),
        format!("Path: {}", path),
        String::new(),
        "Open with:".to_string(),
        format!("  code {}", path_arg),
    ];

    #[cfg(target_os = "windows")]
    lines.push(format!("  notepad {}", path_arg));
    #[cfg(target_os = "macos")]
    lines.push(format!("  open -e {}", path_arg));
    #[cfg(all(unix, not(target_os = "macos")))]
    lines.push(format!("  ${{EDITOR:-vi}} {}", path_arg));

    lines.extend([
        String::new(),
        "Next actions:".to_string(),
        "  Validate CLI preferences: sparo health".to_string(),
        "  Inspect CLI preferences: sparo config prefs get".to_string(),
        "  Inspect shared config: sparo config show".to_string(),
    ]);

    lines
}

fn cli_prefs_set_human_output(
    path: &str,
    value: &serde_json::Value,
    config_path: &std::path::Path,
) -> Result<String> {
    Ok(format!(
        "Set {} = {}\nCLI preference file: {}\n\nNext actions:\n  Inspect CLI preferences: sparo config prefs get\n  Validate CLI preferences: sparo health\n  Machine output: sparo config prefs get {} --json",
        path,
        cli_pref_human_value(value)?,
        config_path.display(),
        path
    ))
}

fn ai_cache_line(invalidated_ai_cache: bool) -> &'static str {
    if invalidated_ai_cache {
        "AI client cache: invalidated"
    } else {
        "AI client cache: unchanged"
    }
}

fn config_set_human_lines(
    path: &str,
    value: &str,
    message: &str,
    invalidated_ai_cache: bool,
) -> Vec<String> {
    vec![
        "Shared Global Configuration Updated".to_string(),
        format!("Status: {}", message),
        format!("Path: {}", path),
        format!("Value: {}", value),
        ai_cache_line(invalidated_ai_cache).to_string(),
        String::new(),
        "Next actions:".to_string(),
        format!("  Inspect value: sparo config get {}", path),
        "  Validate config: sparo config validate".to_string(),
        "  Open in chat: sparo chat".to_string(),
        format!(
            "  Machine output: sparo config set {} {} --json",
            path,
            shell_arg(value)
        ),
    ]
}

fn config_reset_human_lines(
    path: Option<&str>,
    message: &str,
    invalidated_ai_cache: bool,
) -> Vec<String> {
    let target = path.unwrap_or("all shared configuration");
    let inspect_action = path
        .map(|path| format!("  Inspect value: sparo config get {}", path))
        .unwrap_or_else(|| "  Inspect config: sparo config show".to_string());
    let machine_action = path
        .map(|path| format!("  Machine output: sparo config reset {} --json", path))
        .unwrap_or_else(|| "  Machine output: sparo config reset --json".to_string());

    vec![
        "Shared Global Configuration Reset".to_string(),
        format!("Status: {}", message),
        format!("Target: {}", target),
        ai_cache_line(invalidated_ai_cache).to_string(),
        String::new(),
        "Next actions:".to_string(),
        inspect_action,
        "  Validate config: sparo config validate".to_string(),
        "  Run health: sparo config health".to_string(),
        machine_action,
    ]
}

fn config_reload_human_lines(message: &str) -> Vec<String> {
    vec![
        "Shared Global Configuration Reloaded".to_string(),
        format!("Status: {}", message),
        String::new(),
        "Next actions:".to_string(),
        "  Validate config: sparo config validate".to_string(),
        "  Inspect config: sparo config show".to_string(),
        "  Machine output: sparo config reload --json".to_string(),
    ]
}

fn config_import_human_lines(
    file: &str,
    response: &bitfun_core::command::config::ImportConfigResponse,
) -> Vec<String> {
    let mut lines = vec![
        "Shared Global Configuration Imported".to_string(),
        format!(
            "Status: {}",
            if response.result.success {
                "success"
            } else {
                "failed"
            }
        ),
        format!("File: {}", file),
        ai_cache_line(response.invalidated_ai_cache).to_string(),
    ];

    if !response.result.errors.is_empty() {
        lines.push(format!("Errors: {}", response.result.errors.len()));
        for error in response.result.errors.iter().take(3) {
            lines.push(format!("  - {}", error));
        }
        if response.result.errors.len() > 3 {
            lines.push(format!(
                "  ... {} more",
                response.result.errors.len().saturating_sub(3)
            ));
        }
    }

    if !response.result.warnings.is_empty() {
        lines.push(format!("Warnings: {}", response.result.warnings.len()));
        for warning in response.result.warnings.iter().take(3) {
            lines.push(format!("  - {}", warning));
        }
        if response.result.warnings.len() > 3 {
            lines.push(format!(
                "  ... {} more",
                response.result.warnings.len().saturating_sub(3)
            ));
        }
    }

    lines.extend([
        String::new(),
        "Next actions:".to_string(),
        "  Validate config: sparo config validate".to_string(),
        "  Inspect config: sparo config show".to_string(),
        format!(
            "  Machine output: sparo config import {} --json",
            shell_arg(file)
        ),
    ]);

    lines
}

fn get_json_path<'a>(value: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    let mut current = value;
    for segment in path.split('.') {
        current = current.get(segment)?;
    }
    Some(current)
}

fn parse_bool_pref(path: &str, value: &str) -> Result<bool> {
    match value.to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" | "on" => Ok(true),
        "false" | "0" | "no" | "off" => Ok(false),
        _ => anyhow::bail!("{} expects a boolean value", path),
    }
}

fn parse_shortcut_pref(path: &str, value: &str) -> Result<String> {
    canonical_shortcut(value).with_context(|| format!("{} has an invalid shortcut", path))
}

fn set_cli_pref(config: &mut CliConfig, path: &str, value: &str) -> Result<()> {
    let mut updated = config.clone();
    match path {
        "ui.theme" => match value {
            "dark" | "light" | "auto" => updated.ui.theme = value.to_string(),
            _ => anyhow::bail!("ui.theme must be one of: dark, light, auto"),
        },
        "ui.show_tips" => updated.ui.show_tips = parse_bool_pref(path, value)?,
        "ui.animation" => updated.ui.animation = parse_bool_pref(path, value)?,
        "ui.color_scheme" => match value {
            "default" | "sparo" | "ember" | "blue" | "ocean" | "green" | "forest" | "mono"
            | "minimal" => updated.ui.color_scheme = value.to_string(),
            _ => anyhow::bail!(
                "ui.color_scheme must be one of: default, sparo, ember, blue, ocean, green, forest, mono, minimal"
            ),
        },
        "behavior.default_agent" => updated.behavior.default_agent = value.to_string(),
        "behavior.confirm_dangerous" => {
            updated.behavior.confirm_dangerous = parse_bool_pref(path, value)?
        }
        "workspace.default_path" => updated.workspace.default_path = value.to_string(),
        "shortcuts.send_message" => {
            updated.shortcuts.send_message = parse_shortcut_pref(path, value)?
        }
        "shortcuts.interrupt" => updated.shortcuts.interrupt = parse_shortcut_pref(path, value)?,
        "shortcuts.menu" => updated.shortcuts.menu = parse_shortcut_pref(path, value)?,
        _ => anyhow::bail!("Unknown CLI preference path: {}", path),
    }
    updated.validate()?;
    *config = updated;
    Ok(())
}

fn handle_prefs_action(action: PrefsAction, config: &CliConfig) -> Result<()> {
    match action {
        PrefsAction::Get { path, json } => {
            if json {
                print_json(cli_prefs_value(&config, path.as_deref())?)?;
            } else {
                println!("{}", cli_prefs_get_human_output(config, path.as_deref())?);
            }
        }
        PrefsAction::Set { path, value, json } => {
            let mut config = CliConfig::load()?;
            set_cli_pref(&mut config, &path, &value)?;
            config.save()?;
            let updated_value = cli_prefs_value(&config, Some(&path))?;
            let config_path = CliConfig::config_path()?;
            if json {
                print_json(serde_json::json!({
                    "path": path,
                    "value": updated_value,
                    "config_path": config_path.to_string_lossy(),
                }))?;
            } else {
                println!(
                    "{}",
                    cli_prefs_set_human_output(&path, &updated_value, &config_path)?
                );
            }
        }
    }
    Ok(())
}

fn print_json(value: impl serde::Serialize) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(&value)?);
    Ok(())
}

fn strip_utf8_bom(raw: &str) -> &str {
    raw.trim_start_matches('\u{feff}')
}

fn should_redact_config_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    normalized == "api_key"
        || normalized == "password"
        || normalized == "token"
        || normalized == "access_token"
        || normalized == "refresh_token"
        || normalized == "authorization"
        || normalized.contains("secret")
}

fn redact_config_value(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, child) in map.iter_mut() {
                if should_redact_config_key(key) {
                    if !child.is_null() {
                        *child = serde_json::Value::String("<redacted>".to_string());
                    }
                } else {
                    redact_config_value(child);
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                redact_config_value(item);
            }
        }
        _ => {}
    }
}

fn printable_config_value<T: serde::Serialize>(
    value: T,
    include_secrets: bool,
) -> Result<serde_json::Value> {
    let mut value = serde_json::to_value(value)?;
    if !include_secrets {
        redact_config_value(&mut value);
    }
    Ok(value)
}

async fn read_shared_config_value(path: Option<String>) -> Result<serde_json::Value> {
    use bitfun_core::command::config as command_config;

    match build_command_context().await {
        Ok(ctx) => command_config::get_config(
            &ctx,
            command_config::GetConfigRequest { path: path.clone() },
        )
        .await
        .map_err(Into::into),
        Err(error) if cli_error_kind(&error) == "runtime_directory_error" => {
            read_shared_config_file_value(path).with_context(|| {
                format!(
                    "Failed to read shared config directly after runtime initialization failed: {}",
                    error
                )
            })
        }
        Err(error) => Err(error),
    }
}

fn read_shared_config_file_value(path: Option<String>) -> Result<serde_json::Value> {
    let config_file = shared_config_file_path()?;
    read_shared_config_value_from_path(&config_file, path.as_deref())
}

fn shared_config_file_path() -> Result<std::path::PathBuf> {
    Ok(CliConfig::config_dir_path()?
        .join("config")
        .join("app.json"))
}

fn read_shared_config_value_from_path(
    config_file: &std::path::Path,
    path: Option<&str>,
) -> Result<serde_json::Value> {
    let value = match config_file.try_exists() {
        Ok(true) => {
            let raw = std::fs::read_to_string(config_file).with_context(|| {
                format!(
                    "Failed to read shared config file: {}",
                    config_file.display()
                )
            })?;
            serde_json::from_str::<serde_json::Value>(strip_utf8_bom(&raw)).with_context(|| {
                format!(
                    "Failed to parse shared config file as JSON: {}",
                    config_file.display()
                )
            })?
        }
        Ok(false) | Err(_) => {
            serde_json::to_value(bitfun_core::service::config::GlobalConfig::default())?
        }
    };

    if let Some(path) = path {
        get_json_path(&value, path)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Unknown shared config path: {}", path))
    } else {
        Ok(value)
    }
}

fn fallback_shared_config_export(include_secrets: bool) -> Result<serde_json::Value> {
    let config = read_shared_config_file_value(None)?;
    let export = serde_json::json!({
        "config": config,
        "export_timestamp": chrono::Utc::now().to_rfc3339(),
        "version": env!("CARGO_PKG_VERSION"),
    });
    printable_config_value(export, include_secrets)
}

fn fallback_shared_config_validation() -> Result<serde_json::Value> {
    read_shared_config_file_value(None)?;
    Ok(serde_json::json!({
        "valid": true,
        "errors": [],
        "warnings": [
            "Validated by direct shared config file read because the global config service is unavailable."
        ],
    }))
}

fn fallback_shared_config_health(error: &anyhow::Error) -> Result<serde_json::Value> {
    let config_file = shared_config_file_path()?;
    let config_directory = config_file
        .parent()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| config_file.to_string_lossy().to_string());
    Ok(serde_json::json!({
        "healthy": false,
        "total_providers": 0,
        "config_directory": config_directory,
        "warnings": [error.to_string()],
        "message": "Global configuration service is unavailable; run `sparo health` for path diagnostics.",
        "last_modified": chrono::Utc::now().to_rfc3339(),
    }))
}

fn read_tool_params(
    params: Option<String>,
    params_file: Option<String>,
) -> Result<serde_json::Value> {
    if params.is_some() && params_file.is_some() {
        anyhow::bail!("Use either --params or --params-file, not both");
    }

    let raw = if let Some(raw) = params {
        Some(raw)
    } else if let Some(path) = params_file {
        if path == "-" {
            let mut input = String::new();
            use std::io::Read;
            std::io::stdin()
                .read_to_string(&mut input)
                .context("Failed to read tool parameters from stdin")?;
            Some(input)
        } else {
            Some(
                std::fs::read_to_string(&path)
                    .with_context(|| format!("Failed to read tool parameter file: {}", path))?,
            )
        }
    } else {
        None
    };

    match raw {
        Some(raw) => parse_tool_params_text(strip_utf8_bom(raw.trim())),
        None => Ok(serde_json::json!({})),
    }
}

fn parse_tool_params_text(raw: &str) -> Result<serde_json::Value> {
    match serde_json::from_str(raw) {
        Ok(value) => Ok(value),
        Err(json_error) => parse_loose_flat_object(raw).with_context(|| {
            format!(
                "Invalid JSON parameters for tool. Use --params-file for complex values. JSON parser error: {}",
                json_error
            )
        }),
    }
}

fn parse_loose_flat_object(raw: &str) -> Result<serde_json::Value> {
    let trimmed = raw.trim();
    let Some(body) = trimmed
        .strip_prefix('{')
        .and_then(|value| value.strip_suffix('}'))
    else {
        anyhow::bail!("Parameters are not an object");
    };

    let mut map = serde_json::Map::new();
    if body.trim().is_empty() {
        return Ok(serde_json::Value::Object(map));
    }

    for pair in body.split(',') {
        let Some((key, value)) = pair.split_once(':') else {
            anyhow::bail!("Expected key:value pair in parameters");
        };
        let key = key.trim().trim_matches('"').trim_matches('\'');
        if key.is_empty() {
            anyhow::bail!("Parameter key cannot be empty");
        }
        map.insert(key.to_string(), parse_loose_value(value.trim()));
    }

    Ok(serde_json::Value::Object(map))
}

fn parse_loose_value(value: &str) -> serde_json::Value {
    let unquoted = value.trim().trim_matches('"').trim_matches('\'');
    if unquoted.eq_ignore_ascii_case("true") {
        return serde_json::Value::Bool(true);
    }
    if unquoted.eq_ignore_ascii_case("false") {
        return serde_json::Value::Bool(false);
    }
    if unquoted.eq_ignore_ascii_case("null") {
        return serde_json::Value::Null;
    }
    if let Ok(number) = unquoted.parse::<i64>() {
        return serde_json::Value::Number(number.into());
    }
    if let Ok(number) = unquoted.parse::<f64>() {
        if let Some(number) = serde_json::Number::from_f64(number) {
            return serde_json::Value::Number(number);
        }
    }
    serde_json::Value::String(unquoted.to_string())
}

async fn handle_config_action(action: ConfigAction, config: &CliConfig) -> Result<()> {
    use bitfun_core::command::config as command_config;

    match action {
        ConfigAction::Show {
            path,
            json,
            include_secrets,
        } => {
            let value = read_shared_config_value(path.clone()).await?;
            let value = printable_config_value(value, include_secrets)?;

            if json {
                print_json(value)?;
            } else {
                if let Some(path) = path {
                    println!("Shared Global Configuration\n");
                    println!("Path: {}", path);
                    print_json(value)?;
                } else {
                    for line in shared_config_summary_lines(&value) {
                        println!("{}", line);
                    }
                    println!();
                    println!("CLI Preferences");
                    for line in cli_presentation_preference_lines(config) {
                        println!("{}", line);
                    }
                    println!("{}", cli_config_path_line(&CliConfig::config_path()?));
                }
            }
        }

        ConfigAction::Get {
            path,
            json: _,
            include_secrets,
        } => {
            let value = read_shared_config_value(path).await?;
            let value = printable_config_value(value, include_secrets)?;
            print_json(value)?;
        }

        ConfigAction::Set { path, value, json } => {
            let ctx = build_command_context().await?;
            let response = command_config::set_config(
                &ctx,
                command_config::SetConfigRequest {
                    path: path.clone(),
                    value: parse_config_value(&value),
                },
            )
            .await?;
            if json {
                print_json(serde_json::json!({
                    "path": path,
                    "message": response.message,
                    "invalidated_ai_cache": response.invalidated_ai_cache,
                }))?;
            } else {
                for line in config_set_human_lines(
                    &path,
                    &value,
                    &response.message,
                    response.invalidated_ai_cache,
                ) {
                    println!("{}", line);
                }
            }
        }

        ConfigAction::Edit => {
            let config_path = CliConfig::config_path()?;
            for line in config_edit_human_lines(&config_path) {
                println!("{}", line);
            }
        }

        ConfigAction::Prefs { action } => {
            handle_prefs_action(action, config)?;
        }

        ConfigAction::Reset { path, json } => {
            let ctx = build_command_context().await?;
            let response = command_config::reset_config(
                &ctx,
                command_config::ResetConfigRequest { path: path.clone() },
            )
            .await?;
            if json {
                print_json(serde_json::json!({
                    "path": path,
                    "message": response.message,
                    "invalidated_ai_cache": response.invalidated_ai_cache,
                }))?;
            } else {
                for line in config_reset_human_lines(
                    path.as_deref(),
                    &response.message,
                    response.invalidated_ai_cache,
                ) {
                    println!("{}", line);
                }
            }
        }

        ConfigAction::Export {
            include_secrets,
            json: _,
        } => {
            let value = match build_command_context().await {
                Ok(ctx) => printable_config_value(
                    command_config::export_config(&ctx).await?,
                    include_secrets,
                )?,
                Err(error) if cli_error_kind(&error) == "runtime_directory_error" => {
                    fallback_shared_config_export(include_secrets)?
                }
                Err(error) => return Err(error),
            };
            print_json(value)?;
        }

        ConfigAction::Import { file, json } => {
            let ctx = build_command_context().await?;
            let raw = std::fs::read_to_string(&file)
                .with_context(|| format!("Failed to read config export file: {}", file))?;
            let config = serde_json::from_str(strip_utf8_bom(&raw))
                .with_context(|| format!("Invalid config export JSON: {}", file))?;
            let response =
                command_config::import_config(&ctx, command_config::ImportConfigRequest { config })
                    .await?;
            if json {
                print_json(response)?;
            } else {
                for line in config_import_human_lines(&file, &response) {
                    println!("{}", line);
                }
            }
        }

        ConfigAction::Validate { json } => {
            let value = match build_command_context().await {
                Ok(ctx) => command_config::validate_config(&ctx).await?,
                Err(error) if cli_error_kind(&error) == "runtime_directory_error" => {
                    fallback_shared_config_validation()?
                }
                Err(error) => return Err(error),
            };
            if json {
                print_json(value)?;
            } else {
                for line in config_validate_human_lines(&value) {
                    println!("{}", line);
                }
            }
        }

        ConfigAction::Reload { json } => {
            let ctx = build_command_context().await?;
            let message = command_config::reload_config(&ctx).await?;
            if json {
                print_json(serde_json::json!({ "message": message }))?;
            } else {
                for line in config_reload_human_lines(&message) {
                    println!("{}", line);
                }
            }
        }

        ConfigAction::Health { json } => {
            let status = match build_command_context().await {
                Ok(ctx) => serde_json::to_value(
                    command_config::get_global_config_health_status(&ctx).await?,
                )?,
                Err(error) if cli_error_kind(&error) == "runtime_directory_error" => {
                    fallback_shared_config_health(&error)?
                }
                Err(error) => return Err(error),
            };
            if json {
                print_json(status)?;
            } else {
                for line in config_health_human_lines(&status) {
                    println!("{}", line);
                }
            }
        }
    }

    Ok(())
}

async fn load_apps_snapshot(
    workspace: Option<String>,
) -> Result<Vec<bitfun_core::command::agentic_os::AgenticOsAppRow>> {
    let snapshot = bitfun_core::command::agentic_os::get_snapshot_without_config(
        bitfun_core::command::agentic_os::AgenticOsSnapshotRequest {
            workspace_hint: workspace,
        },
    )
    .await?;
    Ok(snapshot.apps)
}

fn app_storage_health_checks() -> Vec<(&'static str, DirectoryHealth)> {
    let Ok(path_manager) = bitfun_core::infrastructure::try_get_path_manager_arc() else {
        return Vec::new();
    };

    vec![
        (
            "agent_apps",
            directory_health(&path_manager.user_agent_apps_dir()),
        ),
        (
            "bridge_apps",
            directory_health(&path_manager.user_bridge_apps_dir()),
        ),
        ("live_apps", directory_health(&path_manager.live_apps_dir())),
    ]
}

fn has_app_storage_problem(checks: &[(&'static str, DirectoryHealth)]) -> bool {
    checks.iter().any(|(_, check)| {
        matches!(
            check.status.as_str(),
            "inaccessible" | "not_directory" | "unreadable"
        )
    })
}

fn find_app_row<'a>(
    apps: &'a [bitfun_core::command::agentic_os::AgenticOsAppRow],
    id_or_name: &str,
) -> Option<&'a bitfun_core::command::agentic_os::AgenticOsAppRow> {
    let needle = id_or_name.to_ascii_lowercase();
    apps.iter().find(|app| {
        app.id.eq_ignore_ascii_case(id_or_name) || app.name.to_ascii_lowercase() == needle
    })
}

fn open_path_in_file_manager(path: &str) -> Result<()> {
    let path = std::path::Path::new(path);
    if !path.exists() {
        anyhow::bail!("App target does not exist: {}", path.display());
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("explorer");
        command.arg(path);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(path);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(path);
        command
    };

    command
        .spawn()
        .with_context(|| format!("Failed to open app target: {}", path.display()))?;
    Ok(())
}

async fn handle_apps_action(action: AppsAction, json: bool, config: &CliConfig) -> Result<()> {
    match action {
        AppsAction::List { workspace } => {
            let workspace = effective_workspace_hint(config, workspace.as_deref());
            let apps = load_apps_snapshot(workspace.clone()).await?;
            if json {
                print_json(apps)?;
            } else {
                let app_storage_checks = app_storage_health_checks();
                for line in apps_list_human_lines(
                    &apps,
                    workspace.as_deref(),
                    has_app_storage_problem(&app_storage_checks),
                ) {
                    println!("{}", line);
                }
            }
        }
        AppsAction::Show { id, workspace } => {
            let workspace = effective_workspace_hint(config, workspace.as_deref());
            let apps = load_apps_snapshot(workspace.clone()).await?;
            let app =
                find_app_row(&apps, &id).ok_or_else(|| anyhow::anyhow!("App not found: {}", id))?;
            if json {
                print_json(app)?;
            } else {
                for line in app_human_detail_lines(app, workspace.as_deref()) {
                    println!("{}", line);
                }
            }
        }
        AppsAction::Open { id, workspace } => {
            let workspace = effective_workspace_hint(config, workspace.as_deref());
            let apps = load_apps_snapshot(workspace.clone()).await?;
            let app =
                find_app_row(&apps, &id).ok_or_else(|| anyhow::anyhow!("App not found: {}", id))?;
            let target = app.target.as_deref().ok_or_else(|| {
                anyhow::anyhow!(
                    "{} '{}' does not expose a local target to open",
                    app.kind,
                    app.name
                )
            })?;
            open_path_in_file_manager(target)?;
            if json {
                print_json(serde_json::json!({
                    "id": app.id,
                    "name": app.name,
                    "target": target,
                    "opened": true,
                }))?;
            } else {
                for line in app_open_human_lines(app, workspace.as_deref(), target) {
                    println!("{}", line);
                }
            }
        }
    }
    Ok(())
}

fn apps_list_human_lines(
    apps: &[bitfun_core::command::agentic_os::AgenticOsAppRow],
    workspace: Option<&str>,
    has_storage_problem: bool,
) -> Vec<String> {
    let workspace_arg = workspace_option(workspace);

    if apps.is_empty() {
        if has_storage_problem {
            return vec![
                "No apps could be loaded because app storage is not fully accessible.".to_string(),
                "Run `sparo health` to diagnose Sparo CLI data directory access.".to_string(),
                "Machine output: sparo apps list --json".to_string(),
            ];
        }

        return vec![
            "No Agent, Bridge, or Live Apps installed.".to_string(),
            "Create one from chat with Agent App Studio or Live App Studio.".to_string(),
            "Inspect creation schemas: sparo tool schema CreateAgentApp --json; sparo tool schema InitLiveApp --json".to_string(),
            format!("Open app-building chat: sparo chat{}", workspace_arg),
            "Machine output: sparo apps list --json".to_string(),
        ];
    }

    let mut lines = vec![
        format!("Installed Apps (total {})", apps.len()),
        String::new(),
    ];
    for app in apps {
        lines.push(format!("{} | {} | {}", app.id, app.kind, app.name));
        if let Some(description) = compact_description(&app.description) {
            lines.push(format!("  {}", description));
        }
        lines.push(format!("  capability: {}", app.capability));
        if let Some(target) = &app.target {
            lines.push(format!("  target: {}", target));
        }
        lines.push(String::new());
    }

    if let Some(app) = apps.first() {
        let app_arg = shell_arg(&app.id);
        lines.push("Next actions:".to_string());
        lines.push(format!(
            "  Inspect latest: sparo apps show{} {}",
            workspace_arg, app_arg
        ));
        if app.target.is_some() {
            lines.push(format!(
                "  Open latest: sparo apps open{} {}",
                workspace_arg, app_arg
            ));
        } else {
            lines.push(
                "  Open latest: unavailable because this app has no local target.".to_string(),
            );
        }
        lines.push(format!("  Discuss in chat: sparo chat{}", workspace_arg));
        lines.push("  Machine output: sparo apps list --json".to_string());
    }

    lines
}

fn app_human_detail_lines(
    app: &bitfun_core::command::agentic_os::AgenticOsAppRow,
    workspace: Option<&str>,
) -> Vec<String> {
    let app_arg = shell_arg(&app.id);
    let workspace_arg = workspace_option(workspace);
    let mut lines = vec![
        "App Details".to_string(),
        String::new(),
        format!("Name: {}", app.name),
        format!("ID: {}", app.id),
        format!("Kind: {}", app.kind),
        format!("Description: {}", app.description),
        format!("Capability: {}", app.capability),
        format!(
            "Target: {}",
            app.target.as_deref().unwrap_or("not available")
        ),
        String::new(),
        "Next actions:".to_string(),
        format!("  Inspect: sparo apps show{} {}", workspace_arg, app_arg),
    ];

    if app.target.is_some() {
        lines.push(format!(
            "  Open: sparo apps open{} {}",
            workspace_arg, app_arg
        ));
    } else {
        lines.push("  Open: unavailable because this app has no local target.".to_string());
    }

    lines
}

fn app_open_human_lines(
    app: &bitfun_core::command::agentic_os::AgenticOsAppRow,
    workspace: Option<&str>,
    target: &str,
) -> Vec<String> {
    let workspace_arg = workspace_option(workspace);
    let app_arg = shell_arg(&app.id);
    vec![
        "App Target Opened".to_string(),
        format!("App: {} ({})", app.name, app.kind),
        format!("ID: {}", app.id),
        format!("Target: {}", target),
        String::new(),
        "Next actions:".to_string(),
        format!(
            "  Inspect app: sparo apps show{} {}",
            workspace_arg, app_arg
        ),
        format!("  Discuss in chat: sparo chat{}", workspace_arg),
        format!(
            "  Machine output: sparo apps open{} {} --json",
            workspace_arg, app_arg
        ),
    ]
}

async fn load_workspaces_snapshot(
) -> Result<Vec<bitfun_core::command::agentic_os::AgenticOsWorkspaceRow>> {
    let snapshot = bitfun_core::command::agentic_os::get_snapshot_without_config(
        bitfun_core::command::agentic_os::AgenticOsSnapshotRequest {
            workspace_hint: None,
        },
    )
    .await?;
    Ok(snapshot.workspaces)
}

fn find_workspace_row<'a>(
    workspaces: &'a [bitfun_core::command::agentic_os::AgenticOsWorkspaceRow],
    id_or_path: &str,
) -> Option<&'a bitfun_core::command::agentic_os::AgenticOsWorkspaceRow> {
    let needle = id_or_path.replace('\\', "/").to_ascii_lowercase();
    workspaces.iter().find(|workspace| {
        workspace.label.eq_ignore_ascii_case(id_or_path)
            || workspace
                .path
                .as_deref()
                .map(|path| path.replace('\\', "/").to_ascii_lowercase() == needle)
                .unwrap_or(false)
            || (id_or_path.eq_ignore_ascii_case("global") && workspace.path.is_none())
    })
}

fn resolve_workspace_row(
    workspaces: &[bitfun_core::command::agentic_os::AgenticOsWorkspaceRow],
    id_or_path: &str,
) -> Option<bitfun_core::command::agentic_os::AgenticOsWorkspaceRow> {
    find_workspace_row(workspaces, id_or_path)
        .cloned()
        .or_else(|| workspace_row_from_direct_path(id_or_path))
}

fn workspace_row_from_direct_path(
    id_or_path: &str,
) -> Option<bitfun_core::command::agentic_os::AgenticOsWorkspaceRow> {
    let path = std::path::PathBuf::from(id_or_path);
    if !path.is_dir() {
        return None;
    }
    let resolved = path.canonicalize().unwrap_or(path);
    let label = resolved
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("workspace")
        .to_string();
    Some(bitfun_core::command::agentic_os::AgenticOsWorkspaceRow {
        label,
        path: Some(display_workspace_path(&resolved)),
        git: git_branch_for_workspace_path(&resolved),
        session_count: 0,
    })
}

fn display_workspace_path(path: &std::path::Path) -> String {
    let raw = path.to_string_lossy();
    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", stripped)
    } else if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        raw.to_string()
    }
}

fn git_branch_for_workspace_path(path: &std::path::Path) -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!branch.is_empty()).then_some(format!("git {}", branch))
}

async fn handle_workspaces_action(action: WorkspacesAction, json: bool) -> Result<()> {
    match action {
        WorkspacesAction::List => {
            let workspaces = load_workspaces_snapshot().await?;
            if json {
                print_json(workspaces)?;
            } else {
                for line in workspaces_list_human_lines(&workspaces) {
                    println!("{}", line);
                }
            }
        }
        WorkspacesAction::Show { id } => {
            let workspaces = load_workspaces_snapshot().await?;
            let workspace = resolve_workspace_row(&workspaces, &id)
                .ok_or_else(|| anyhow::anyhow!("Workspace not found: {}", id))?;
            if json {
                print_json(&workspace)?;
            } else {
                for line in workspace_human_detail_lines(&workspace) {
                    println!("{}", line);
                }
            }
        }
        WorkspacesAction::Use { id } => {
            let workspaces = load_workspaces_snapshot().await?;
            let workspace = resolve_workspace_row(&workspaces, &id)
                .ok_or_else(|| anyhow::anyhow!("Workspace not found: {}", id))?;
            let global_workspace;
            let default_path = if let Some(path) = workspace.path.as_deref() {
                path
            } else {
                global_workspace = agentic_global_workspace_hint().ok_or_else(|| {
                    anyhow::anyhow!("Failed to resolve Agentic OS global runtime")
                })?;
                global_workspace.as_str()
            };
            let mut config = CliConfig::load()?;
            set_cli_pref(&mut config, "workspace.default_path", default_path)?;
            config.save()?;
            let config_path = CliConfig::config_path()?;
            if json {
                print_json(serde_json::json!({
                    "label": workspace.label,
                    "path": default_path,
                    "workspace_path": workspace.path.clone(),
                    "config_path": config_path.to_string_lossy(),
                }))?;
            } else {
                for line in workspace_use_human_lines(&workspace, default_path, &config_path) {
                    println!("{}", line);
                }
            }
        }
    }

    Ok(())
}

fn workspaces_list_human_lines(
    workspaces: &[bitfun_core::command::agentic_os::AgenticOsWorkspaceRow],
) -> Vec<String> {
    let mut lines = vec![
        format!("Known Workspaces (total {})", workspaces.len()),
        String::new(),
    ];

    for workspace in workspaces {
        lines.push(workspace.label.clone());
        lines.push(format!(
            "  path: {}",
            workspace
                .path
                .as_deref()
                .unwrap_or("Agentic OS global runtime")
        ));
        lines.push(format!(
            "  git: {}",
            workspace.git.as_deref().unwrap_or("no-git")
        ));
        lines.push(format!("  sessions: {}", workspace.session_count));
        lines.push(String::new());
    }

    if let Some(workspace) = workspaces.first() {
        let workspace_arg = shell_arg(&workspace.label);
        let chat_target = workspace.path.as_deref().unwrap_or("global");
        lines.push("Next actions:".to_string());
        lines.push(format!(
            "  Use latest: sparo workspaces use {}",
            workspace_arg
        ));
        lines.push(format!(
            "  Show details: sparo workspaces show {}",
            workspace_arg
        ));
        lines.push(format!(
            "  Chat here: sparo chat --workspace {}",
            shell_arg(chat_target)
        ));
        lines.push("  Machine output: sparo workspaces list --json".to_string());
    } else {
        lines.extend([
            "Next actions:".to_string(),
            "  Add a project by opening chat with --workspace <path>.".to_string(),
            "  Machine output: sparo workspaces list --json".to_string(),
        ]);
    }

    lines
}

fn workspace_human_detail_lines(
    workspace: &bitfun_core::command::agentic_os::AgenticOsWorkspaceRow,
) -> Vec<String> {
    let workspace_arg = shell_arg(&workspace.label);
    let chat_target = workspace.path.as_deref().unwrap_or("global");
    vec![
        "Workspace Details".to_string(),
        String::new(),
        format!("Label: {}", workspace.label),
        format!(
            "Path: {}",
            workspace
                .path
                .as_deref()
                .unwrap_or("Agentic OS global runtime")
        ),
        format!("Git: {}", workspace.git.as_deref().unwrap_or("no-git")),
        format!("Sessions: {}", workspace.session_count),
        String::new(),
        "Next actions:".to_string(),
        format!("  Use: sparo workspaces use {}", workspace_arg),
        format!("  Chat: sparo chat --workspace {}", shell_arg(chat_target)),
    ]
}

fn workspace_use_human_lines(
    workspace: &bitfun_core::command::agentic_os::AgenticOsWorkspaceRow,
    default_path: &str,
    config_path: &std::path::Path,
) -> Vec<String> {
    let workspace_arg = shell_arg(&workspace.label);
    vec![
        "CLI Default Workspace Updated".to_string(),
        format!("Workspace: {}", workspace.label),
        format!("Path: {}", default_path),
        format!("CLI preference file: {}", config_path.display()),
        String::new(),
        "Next actions:".to_string(),
        "  Start chat: sparo chat".to_string(),
        format!(
            "  Inspect workspace: sparo workspaces show {}",
            workspace_arg
        ),
        "  Inspect preference: sparo config prefs get workspace.default_path".to_string(),
        format!(
            "  Machine output: sparo workspaces use {} --json",
            workspace_arg
        ),
    ]
}

async fn load_memory_snapshot(
    workspace: Option<String>,
) -> Result<Vec<bitfun_core::command::agentic_os::AgenticOsMemoryRow>> {
    let snapshot = bitfun_core::command::agentic_os::get_snapshot_without_config(
        bitfun_core::command::agentic_os::AgenticOsSnapshotRequest {
            workspace_hint: workspace,
        },
    )
    .await?;
    Ok(snapshot.memories)
}

fn memory_row_path(
    row: &bitfun_core::command::agentic_os::AgenticOsMemoryRow,
) -> std::path::PathBuf {
    std::path::Path::new(&row.target).join(&row.file)
}

fn find_memory_row<'a>(
    memories: &'a [bitfun_core::command::agentic_os::AgenticOsMemoryRow],
    id_or_path: &str,
) -> Option<&'a bitfun_core::command::agentic_os::AgenticOsMemoryRow> {
    let needle = id_or_path.replace('\\', "/").to_ascii_lowercase();
    memories.iter().find(|memory| {
        memory.file.eq_ignore_ascii_case(id_or_path)
            || format!("{}:{}", memory.scope, memory.file).eq_ignore_ascii_case(id_or_path)
            || memory_row_path(memory)
                .to_string_lossy()
                .replace('\\', "/")
                .to_ascii_lowercase()
                == needle
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MemoryContentPreview {
    content: String,
    max_bytes: usize,
    bytes_read: usize,
    total_bytes: usize,
    truncated: bool,
}

fn read_memory_content(
    memory: &bitfun_core::command::agentic_os::AgenticOsMemoryRow,
    max_bytes: usize,
) -> Result<MemoryContentPreview> {
    let path = memory_row_path(memory);
    let bytes = std::fs::read(&path)
        .with_context(|| format!("Failed to read memory file: {}", path.display()))?;
    let end = bytes.len().min(max_bytes);
    Ok(MemoryContentPreview {
        content: String::from_utf8_lossy(&bytes[..end]).to_string(),
        max_bytes,
        bytes_read: end,
        total_bytes: bytes.len(),
        truncated: end < bytes.len(),
    })
}

fn memory_content_json(
    memory: &bitfun_core::command::agentic_os::AgenticOsMemoryRow,
    preview: &MemoryContentPreview,
) -> serde_json::Value {
    serde_json::json!({
        "scope": memory.scope,
        "file": memory.file,
        "target": memory.target,
        "path": memory_row_path(memory).to_string_lossy(),
        "max_bytes": preview.max_bytes,
        "truncated_to_bytes": preview.max_bytes,
        "bytes_read": preview.bytes_read,
        "total_bytes": preview.total_bytes,
        "truncated": preview.truncated,
        "content": preview.content,
    })
}

async fn handle_memory_action(
    action: MemoryAction,
    workspace: Option<String>,
    json: bool,
) -> Result<()> {
    match action {
        MemoryAction::List => {
            let workspace_for_output = workspace.clone();
            let memories = load_memory_snapshot(workspace).await?;
            if json {
                print_json(memories)?;
            } else {
                for line in memory_list_human_lines(&memories, workspace_for_output.as_deref()) {
                    println!("{}", line);
                }
            }
        }
        MemoryAction::Show { id, max_bytes } => {
            let memories = load_memory_snapshot(workspace.clone()).await?;
            let memory = find_memory_row(&memories, &id)
                .ok_or_else(|| anyhow::anyhow!("Memory file not found: {}", id))?;
            let preview = read_memory_content(memory, max_bytes)?;
            if json {
                print_json(memory_content_json(memory, &preview))?;
            } else {
                for line in memory_human_detail_lines(memory, &preview, workspace.as_deref()) {
                    println!("{}", line);
                }
            }
        }
    }

    Ok(())
}

fn memory_list_human_lines(
    memories: &[bitfun_core::command::agentic_os::AgenticOsMemoryRow],
    workspace: Option<&str>,
) -> Vec<String> {
    if memories.is_empty() {
        return vec![
            "No memory files are available in this snapshot.".to_string(),
            "Add notes under .sparo_os/memory; run `sparo health` if memory is missing."
                .to_string(),
            "Discuss context in chat with `sparo chat`.".to_string(),
        ];
    }

    let mut lines = vec![
        format!("Memory Files (total {})", memories.len()),
        String::new(),
    ];
    for memory in memories {
        lines.push(format!("{} | {}", memory.scope, memory.file));
        lines.push(format!("  {}", memory.target));
    }

    if let Some(memory) = memories.first() {
        let memory_id = format!("{}:{}", memory.scope.to_ascii_lowercase(), memory.file);
        let memory_arg = shell_arg(&memory_id);
        let workspace_arg = workspace_option(workspace);
        lines.extend([
            String::new(),
            "Next actions:".to_string(),
            format!(
                "  Show latest: sparo memory{} show {}",
                workspace_arg, memory_arg
            ),
            format!("  Discuss in chat: sparo chat{}", workspace_arg),
            "  Machine output: sparo memory list --json".to_string(),
        ]);
    }

    lines
}

fn memory_human_detail_lines(
    memory: &bitfun_core::command::agentic_os::AgenticOsMemoryRow,
    preview: &MemoryContentPreview,
    workspace: Option<&str>,
) -> Vec<String> {
    let memory_id = format!("{}:{}", memory.scope.to_ascii_lowercase(), memory.file);
    let workspace_arg = workspace_option(workspace);
    let mut lines = vec![
        format!("Memory: {} | {}", memory.scope, memory.file),
        format!("Path: {}", memory_row_path(memory).display()),
        String::new(),
        preview.content.clone(),
    ];

    if preview.truncated {
        lines.extend([
            String::new(),
            format!(
                "[truncated: showing {} of {} bytes; use --max-bytes to read more]",
                preview.bytes_read, preview.total_bytes
            ),
        ]);
    }

    lines.extend([
        String::new(),
        "Next actions:".to_string(),
        format!(
            "  Show full file: sparo memory{} show {} --max-bytes {}",
            workspace_arg,
            shell_arg(&memory_id),
            preview.total_bytes
        ),
        format!("  Discuss in chat: sparo chat{}", workspace_arg),
    ]);

    lines
}

fn tool_list_human_lines(tools: &[bitfun_core::command::tool::ToolInfo]) -> Vec<String> {
    let enabled_count = tools.iter().filter(|tool| tool.enabled).count();
    let readonly_count = tools.iter().filter(|tool| tool.readonly).count();
    let mut lines = vec![
        format!(
            "Available Tools (total {}, enabled {}, readonly {})",
            tools.len(),
            enabled_count,
            readonly_count
        ),
        String::new(),
    ];

    if tools.is_empty() {
        lines.push("No tools available.".to_string());
    } else {
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
            lines.push(format!("{}{}", tool.name, suffix));
            lines.push(format!(
                "  {}",
                tool.description.lines().next().unwrap_or("")
            ));
        }
    }

    let example_tool = tools
        .iter()
        .find(|tool| tool.enabled)
        .or_else(|| tools.first())
        .map(|tool| tool.name.as_str())
        .unwrap_or("<tool-name>");
    let example_tool = shell_arg(example_tool);

    lines.extend([
        String::new(),
        "Next actions:".to_string(),
        format!(
            "  Inspect schema: sparo tool schema {} --json",
            example_tool
        ),
        format!(
            "  Run tool: sparo tool run {} --params '{{\"key\":\"value\"}}'",
            example_tool
        ),
        "  Workspace scope: add --workspace <path> to schema/run".to_string(),
        "  Machine output: sparo tool list --json".to_string(),
    ]);

    lines
}

fn tool_display_value_text(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.trim().to_string(),
        serde_json::Value::Null => String::new(),
        other => serde_json::to_string_pretty(other).unwrap_or_else(|_| other.to_string()),
    }
}

fn push_indented_block(lines: &mut Vec<String>, text: &str) {
    if text.trim().is_empty() {
        lines.push("  (empty)".to_string());
        return;
    }

    for line in text.lines() {
        lines.push(format!("  {}", line));
    }
}

fn tool_run_human_lines(
    response: &bitfun_core::command::tool::ExecuteToolResponse,
    workspace: Option<&str>,
) -> Vec<String> {
    let mut lines = vec![format!("Tool: {}", response.tool_name)];

    if response.display_results.is_empty() {
        lines.push("No display results returned.".to_string());
    } else {
        for (index, result) in response.display_results.iter().enumerate() {
            if response.display_results.len() > 1 {
                lines.extend([String::new(), format!("Result {}:", index + 1)]);
            }

            if let Some(content) = result.get("content") {
                lines.push("Content:".to_string());
                push_indented_block(&mut lines, &tool_display_value_text(content));
            } else {
                lines.push("Result:".to_string());
                push_indented_block(&mut lines, &tool_display_value_text(result));
            }

            if let Some(assistant) = result.get("assistant").filter(|value| !value.is_null()) {
                lines.push("Assistant context:".to_string());
                push_indented_block(&mut lines, &tool_display_value_text(assistant));
            }
        }
    }

    let tool_arg = shell_arg(&response.tool_name);
    let workspace_arg = workspace_option(workspace);
    lines.extend([
        String::new(),
        "Next actions:".to_string(),
        format!(
            "  Inspect schema: sparo tool schema {}{} --json",
            tool_arg, workspace_arg
        ),
        format!(
            "  Rerun with JSON: sparo tool run {}{} --params-file <file> --json",
            tool_arg, workspace_arg
        ),
    ]);

    lines
}

fn schema_required_fields(schema: &serde_json::Value) -> std::collections::HashSet<String> {
    schema
        .get("required")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn schema_type_label(value: &serde_json::Value) -> String {
    match value.get("type") {
        Some(serde_json::Value::String(value)) => value.clone(),
        Some(serde_json::Value::Array(values)) => values
            .iter()
            .filter_map(|value| value.as_str())
            .collect::<Vec<_>>()
            .join("|"),
        _ => "any".to_string(),
    }
}

fn tool_schema_human_lines(
    response: &bitfun_core::command::tool::ToolSchemaResponse,
    workspace: Option<&str>,
) -> Vec<String> {
    let mut lines = vec![
        format!("Tool Schema: {}", response.name),
        format!(
            "Workspace context: {}",
            workspace.unwrap_or("current directory")
        ),
    ];

    let required = schema_required_fields(&response.input_schema);
    let properties = response
        .input_schema
        .get("properties")
        .and_then(|value| value.as_object());

    lines.push(String::new());
    lines.push("Input fields:".to_string());
    if let Some(properties) = properties.filter(|properties| !properties.is_empty()) {
        let mut keys = properties.keys().collect::<Vec<_>>();
        keys.sort();
        for key in keys {
            let Some(property) = properties.get(key) else {
                continue;
            };
            let required_label = if required.contains(key.as_str()) {
                "required"
            } else {
                "optional"
            };
            let description = property
                .get("description")
                .and_then(|value| value.as_str())
                .and_then(compact_description);
            let suffix = description
                .map(|description| format!(" - {}", description))
                .unwrap_or_default();
            lines.push(format!(
                "  {} ({}, {}){}",
                key,
                required_label,
                schema_type_label(property),
                suffix
            ));
        }
    } else {
        lines.push("  (no input fields)".to_string());
    }

    let model_schema_note = if response.input_schema == response.model_input_schema {
        "same as runtime schema"
    } else {
        "differs from runtime schema; use --json to inspect"
    };
    let tool_arg = shell_arg(&response.name);
    let workspace_arg = workspace_option(workspace);
    lines.extend([
        format!("Model-facing schema: {}", model_schema_note),
        String::new(),
        "Next actions:".to_string(),
        format!(
            "  Run tool: sparo tool run {}{} --params-file <file>",
            tool_arg, workspace_arg
        ),
        "  List tools: sparo tool list".to_string(),
        format!(
            "  Machine output: sparo tool schema {}{} --json",
            tool_arg, workspace_arg
        ),
    ]);

    lines
}

async fn handle_tool_action(action: ToolAction) -> Result<()> {
    use bitfun_core::command::tool as tool_command;

    match action {
        ToolAction::List { json } => {
            let tools = tool_command::list_tools().await?;
            if json {
                print_json(tools)?;
            } else {
                for line in tool_list_human_lines(&tools) {
                    println!("{}", line);
                }
            }
        }

        ToolAction::Schema {
            name,
            workspace,
            json,
        } => {
            let schema = tool_command::tool_schema(tool_command::ToolSchemaRequest {
                name,
                workspace_path: workspace.clone(),
            })
            .await?;
            if json {
                print_json(schema)?;
            } else {
                for line in tool_schema_human_lines(&schema, workspace.as_deref()) {
                    println!("{}", line);
                }
            }
        }

        ToolAction::Run {
            name,
            params,
            params_file,
            workspace,
            json,
        } => {
            tool_command::tool_schema(tool_command::ToolSchemaRequest {
                name: name.clone(),
                workspace_path: workspace.clone(),
            })
            .await?;
            let input = read_tool_params(params, params_file)
                .with_context(|| format!("Invalid parameters for tool {}", name))?;
            initialize_cli_process_runtime().await?;
            let workspace_for_output = workspace.clone();
            let response = tool_command::execute_tool(tool_command::ExecuteToolRequest {
                name,
                input,
                workspace_path: workspace,
            })
            .await?;

            if json {
                print_json(response)?;
            } else {
                for line in tool_run_human_lines(&response, workspace_for_output.as_deref()) {
                    println!("{}", line);
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

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
    fn read_shared_config_value_from_path_reads_dot_path() {
        let temp_root = std::env::temp_dir().join(format!(
            "sparo-cli-shared-config-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_root).expect("create temp shared config root");
        let config_file = temp_root.join("app.json");
        std::fs::write(
            &config_file,
            r#"{"ai":{"default_models":{"primary":"gpt-demo"}}}"#,
        )
        .expect("write shared config");

        let value =
            read_shared_config_value_from_path(&config_file, Some("ai.default_models.primary"))
                .expect("read shared config dot path");

        assert_eq!(value, serde_json::json!("gpt-demo"));

        std::fs::remove_dir_all(temp_root).expect("remove temp shared config root");
    }

    #[test]
    fn read_shared_config_value_from_path_uses_default_when_missing() {
        let missing = std::env::temp_dir()
            .join(format!(
                "sparo-cli-missing-shared-config-{}",
                uuid::Uuid::new_v4()
            ))
            .join("app.json");

        let value = read_shared_config_value_from_path(&missing, Some("ai.default_models"))
            .expect("read default shared config dot path");

        assert!(value.is_object());
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
                path: Some("ai".to_string()),
                json: false,
                include_secrets: false,
            },
        })));
        assert!(command_requests_json(&Some(Commands::Config {
            action: ConfigAction::Show {
                path: None,
                json: true,
                include_secrets: false,
            },
        })));
        assert!(command_requests_json(&Some(Commands::Config {
            action: ConfigAction::Set {
                path: "ai.default_models.primary".to_string(),
                value: "demo".to_string(),
                json: true,
            },
        })));
        assert!(command_requests_json(&Some(Commands::Config {
            action: ConfigAction::Reset {
                path: Some("ai.default_models.primary".to_string()),
                json: true,
            },
        })));
        assert!(command_requests_json(&Some(Commands::Config {
            action: ConfigAction::Reload { json: true },
        })));
        assert!(command_requests_json(&Some(Commands::Config {
            action: ConfigAction::Import {
                file: "config-export.json".to_string(),
                json: true,
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
            action: ConfigAction::Show {
                path: None,
                json: false,
                include_secrets: false,
            },
        })));
        assert!(!command_requests_json(&Some(Commands::Config {
            action: ConfigAction::Set {
                path: "ai.default_models.primary".to_string(),
                value: "demo".to_string(),
                json: false,
            },
        })));
        assert!(!command_requests_json(&Some(Commands::Config {
            action: ConfigAction::Validate { json: false },
        })));
        assert!(!command_requests_json(&Some(Commands::Config {
            action: ConfigAction::Import {
                file: "config-export.json".to_string(),
                json: false,
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
                workspace: None,
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
                workspace: None,
            },
            json: false,
        })));
        assert!(can_use_default_config_silently(&Some(Commands::Sessions {
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
                workspace: None,
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
    fn app_storage_problem_ignores_missing_dirs_but_flags_inaccessible_storage() {
        let missing = DirectoryHealth {
            path: "missing".to_string(),
            kind: "directory".to_string(),
            status: "missing".to_string(),
            exists: false,
            is_dir: false,
            readable: false,
            error: None,
            hint: directory_health_hint("missing"),
        };
        let inaccessible = DirectoryHealth {
            path: "blocked".to_string(),
            kind: "directory".to_string(),
            status: "inaccessible".to_string(),
            exists: false,
            is_dir: false,
            readable: false,
            error: Some("access denied".to_string()),
            hint: directory_health_hint("inaccessible"),
        };

        assert!(!has_app_storage_problem(&[("agent_apps", missing)]));
        assert!(has_app_storage_problem(&[("agent_apps", inaccessible)]));
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
        std::fs::create_dir_all(&directory_at_file_path)
            .expect("create temp directory at file path");

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
            toml::to_string_pretty(&empty_default_agent)
                .expect("serialize empty default agent config"),
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
            Some(
                "Fix the config file syntax or move the file aside so Sparo can recreate defaults."
            )
        );

        let shortcut_conflict = cli_config_file_health(&shortcut_conflict_config);
        assert_eq!(shortcut_conflict.status, "invalid_config");
        assert!(shortcut_conflict
            .error
            .as_deref()
            .is_some_and(|error| error.contains("shortcuts.send_message and shortcuts.interrupt")));
        assert_eq!(
            shortcut_conflict.hint.as_deref(),
            Some(
                "Fix the config file syntax or move the file aside so Sparo can recreate defaults."
            )
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
            serde_json::to_string_pretty(&bitfun_core::service::config::GlobalConfig::default())
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
            Some(
                "Fix the config file syntax or move the file aside so Sparo can recreate defaults."
            )
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
        let cli = Cli::try_parse_from(["sparo", "sessions", "last"]).unwrap();
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
        let response = bitfun_core::command::tool::ToolSchemaResponse {
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

        let output =
            tool_schema_human_lines(&response, Some("D:\\workspace\\my project")).join("\n");

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
        let lines = tool_list_human_lines(&[bitfun_core::command::tool::ToolInfo {
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
        assert!(
            lines.contains(&"  Inspect schema: sparo tool schema search_files --json".to_string())
        );
        assert!(lines.contains(
            &"  Run tool: sparo tool run search_files --params '{\"key\":\"value\"}'".to_string()
        ));
        assert!(
            lines.contains(&"  Workspace scope: add --workspace <path> to schema/run".to_string())
        );
        assert!(lines.contains(&"  Machine output: sparo tool list --json".to_string()));
    }

    #[test]
    fn tool_list_human_lines_empty_state_still_guides_next_step() {
        let lines = tool_list_human_lines(&[]);

        assert!(lines.contains(&"Available Tools (total 0, enabled 0, readonly 0)".to_string()));
        assert!(lines.contains(&"No tools available.".to_string()));
        assert!(lines
            .contains(&"  Inspect schema: sparo tool schema \"<tool-name>\" --json".to_string()));
    }

    #[test]
    fn tool_run_human_lines_surface_content_and_next_actions() {
        let response = bitfun_core::command::tool::ExecuteToolResponse {
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
        let response = bitfun_core::command::tool::ExecuteToolResponse {
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
        let mut config = CliConfig::default();
        assert!(!interactive_tui_skip_tool_confirmation(&config));
        config.behavior.confirm_dangerous = false;
        assert!(interactive_tui_skip_tool_confirmation(&config));
        assert!(exec_skip_tool_confirmation(false));
        assert!(!exec_skip_tool_confirmation(true));
    }

    #[test]
    fn default_agent_pref_fills_missing_cli_agent() {
        let mut config = CliConfig::default();
        config.behavior.default_agent = "debug".to_string();

        assert_eq!(effective_cli_agent(&config, None), "debug");
        assert_eq!(effective_cli_agent(&config, Some("")), "debug");
        assert_eq!(effective_cli_agent(&config, Some("Plan")), "Plan");
    }

    #[test]
    fn cli_default_agent_matches_core_registry_default() {
        let config = CliConfig::default();
        let registry = bitfun_core::agentic::agents::get_agent_registry();
        let registry_default = registry.default_agent_type();

        assert_eq!(config.behavior.default_agent, registry_default);
        assert_eq!(registry_default, "agentic");
    }

    #[test]
    fn cli_health_includes_app_storage_checks() {
        let health = cli_health_value().expect("build cli health value");
        let checks = health["checks"]
            .as_object()
            .expect("health checks should be an object");

        for key in ["apps", "agent_apps", "bridge_apps", "live_apps"] {
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

        assert!(checks.contains_key("workspace_sessions"));
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

        let missing_app = anyhow::anyhow!("App not found: files");
        assert_eq!(cli_error_kind(&missing_app), "execution_error");
        assert_eq!(
            cli_error_hint(&missing_app),
            Some("Run `sparo apps list` to see available Agent, Bridge, and Live Apps.")
        );

        let app_without_target =
            anyhow::anyhow!("LIVE APP 'Dashboard' does not expose a local target to open");
        assert_eq!(cli_error_kind(&app_without_target), "execution_error");
        assert_eq!(
            cli_error_hint(&app_without_target),
            Some("Use `sparo apps show <id>` to inspect app details; only apps with a local target can be opened from the CLI.")
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
                "Place `--workspace <path>` after the subcommand that accepts it, for example `sparo apps show --workspace <path> <id>` or `sparo memory show --workspace <path> <id>`."
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
        assert_eq!(json_tasks[1].agent("OSAgent"), "debug");

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
                agent: "debug".to_string(),
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
            agent: "debug".to_string(),
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
        assert!(output
            .contains("Rerun after fixes: sparo batch --tasks tasks.json --continue-on-error"));
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
        assert!(output.contains("Agent: debug | Turns: 3 | Messages: 6"));
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
        assert!(output
            .contains("Open TUI history: sparo chat --workspace \"D:\\workspace\\my project\""));
    }

    #[test]
    fn sessions_list_human_lines_keep_empty_history_actionable() {
        let output = sessions_list_human_lines(&[], None).join("\n");

        assert!(output.contains("No history sessions"));
        assert!(output.contains("sparo chat"));
        assert!(output.contains("sparo exec"));
    }

    fn sample_session_metadata() -> bitfun_core::service::session::SessionMetadata {
        bitfun_core::service::session::SessionMetadata {
            session_id: "session-1".to_string(),
            session_name: "Review CLI sessions".to_string(),
            agent_type: "debug".to_string(),
            created_by: None,
            session_kind: bitfun_core::agentic::core::SessionKind::Standard,
            model_name: "gpt-test".to_string(),
            created_at: 1_700_000_000_000,
            last_active_at: 1_700_000_100_000,
            turn_count: 3,
            message_count: 6,
            tool_call_count: 2,
            status: bitfun_core::service::session::SessionStatus::Active,
            terminal_session_id: None,
            snapshot_session_id: None,
            tags: Vec::new(),
            custom_metadata: None,
            todos: None,
            workspace_path: Some("D:\\workspace\\my project".to_string()),
            workspace_hostname: None,
            storage_scope: None,
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
        assert!(output
            .contains("Start a new chat: sparo chat --workspace \"D:\\workspace\\my project\""));
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
        let agent = bitfun_core::agentic::agents::AgentInfo {
            id: "debug".to_string(),
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
            "debug | Debug | enabled | 3 tools | write"
        );
    }

    #[test]
    fn agents_human_lines_include_launch_and_default_actions() {
        let agents = vec![bitfun_core::agentic::agents::AgentInfo {
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
            app_kind: Some("Agent App".to_string()),
            app_icon: None,
            app_category: None,
            app_path: None,
        }];

        let output = agents_human_lines(&agents).join("\n");

        assert!(output.contains("Available Agents (total 1)"));
        assert!(output.contains("debug agent | Debug Agent | enabled | 3 tools | write"));
        assert!(output
            .contains("tools: read_file, search, run_command, write_file, edit_file (+1 more)"));
        assert!(output.contains("Chat with agent: sparo chat --agent \"debug agent\""));
        assert!(output.contains("One-shot run: sparo exec --agent \"debug agent\" \"<message>\""));
        assert!(output.contains(
            "Make default: sparo config prefs set behavior.default_agent \"debug agent\""
        ));
        assert!(output.contains("Machine output: sparo agents list --json"));
    }

    #[test]
    fn agents_human_lines_do_not_launch_disabled_only_registry() {
        let agents = vec![bitfun_core::agentic::agents::AgentInfo {
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
            compact_description("Open local Bridge Apps from the CLI").as_deref(),
            Some("Open local Bridge Apps from the CLI")
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
        set_cli_pref(&mut config, "behavior.default_agent", "debug").unwrap();
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
            serde_json::json!("debug")
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
        config.behavior.default_agent = "debug".to_string();
        config.workspace.default_path = "D:\\workspace".to_string();

        assert_eq!(
            cli_prefs_get_human_output(&config, Some("behavior.default_agent")).unwrap(),
            "behavior.default_agent = debug"
        );

        let full = cli_prefs_get_human_output(&config, None).unwrap();
        assert!(full.contains("CLI Preferences"));
        assert!(full.contains("Default Agent: debug"));
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
            "ai": {
                "models": [
                    { "id": "primary-model", "name": "Primary", "enabled": true },
                    { "id": "disabled-model", "name": "Disabled", "enabled": false }
                ],
                "default_models": {
                    "primary": "primary-model",
                    "fast": "fast-model",
                    "search": null
                },
                "agent_models": {
                    "agentic": "primary",
                    "Plan": "fast"
                }
            },
            "app": {
                "language": "zh-CN"
            }
        });

        let output = shared_config_summary_lines(&value).join("\n");

        assert!(output.contains("Shared Global Configuration Summary"));
        assert!(output.contains("Models: 2 configured, 1 enabled"));
        assert!(output.contains("Default models: primary=primary-model, fast=fast-model"));
        assert!(output.contains("Agent model mappings: 2"));
        assert!(output.contains("App language: zh-CN"));
        assert!(output.contains("sparo config show --json"));
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
            "total_providers": 0,
            "config_directory": "C:\\Users\\example\\sparo_os\\config",
            "warnings": ["Failed to load provider"]
        });

        let output = config_health_human_lines(&value).join("\n");

        assert!(output.contains("Shared Global Configuration Health"));
        assert!(output.contains("Status: needs attention"));
        assert!(output.contains("Message: Configuration system is unavailable"));
        assert!(output.contains("Providers: 0"));
        assert!(output.contains("Config directory: C:\\Users\\example\\sparo_os\\config"));
        assert!(output.contains("  - Failed to load provider"));
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
    fn config_set_human_lines_include_impact_and_next_actions() {
        let output = config_set_human_lines(
            "ai.default_models.primary",
            "gpt-demo",
            "Configuration set successfully",
            true,
        )
        .join("\n");

        assert!(output.contains("Shared Global Configuration Updated"));
        assert!(output.contains("Status: Configuration set successfully"));
        assert!(output.contains("Path: ai.default_models.primary"));
        assert!(output.contains("Value: gpt-demo"));
        assert!(output.contains("AI client cache: invalidated"));
        assert!(output.contains("Inspect value: sparo config get ai.default_models.primary"));
        assert!(output.contains("Validate config: sparo config validate"));
        assert!(output.contains(
            "Machine output: sparo config set ai.default_models.primary gpt-demo --json"
        ));
    }

    #[test]
    fn config_reset_human_lines_handle_path_and_full_reset() {
        let path_output = config_reset_human_lines(
            Some("ai.default_models.primary"),
            "Configuration 'ai.default_models.primary' reset successfully",
            true,
        )
        .join("\n");

        assert!(path_output.contains("Shared Global Configuration Reset"));
        assert!(path_output.contains("Target: ai.default_models.primary"));
        assert!(path_output.contains("AI client cache: invalidated"));
        assert!(path_output.contains("Inspect value: sparo config get ai.default_models.primary"));
        assert!(path_output
            .contains("Machine output: sparo config reset ai.default_models.primary --json"));

        let full_output =
            config_reset_human_lines(None, "All configurations reset successfully", false)
                .join("\n");

        assert!(full_output.contains("Target: all shared configuration"));
        assert!(full_output.contains("AI client cache: unchanged"));
        assert!(full_output.contains("Inspect config: sparo config show"));
        assert!(full_output.contains("Machine output: sparo config reset --json"));
    }

    #[test]
    fn config_reload_human_lines_include_validation_actions() {
        let output = config_reload_human_lines("Configuration reloaded successfully").join("\n");

        assert!(output.contains("Shared Global Configuration Reloaded"));
        assert!(output.contains("Status: Configuration reloaded successfully"));
        assert!(output.contains("Validate config: sparo config validate"));
        assert!(output.contains("Inspect config: sparo config show"));
        assert!(output.contains("Machine output: sparo config reload --json"));
    }

    #[test]
    fn config_import_human_lines_summarize_result_and_keep_json_available() {
        let response = bitfun_core::command::config::ImportConfigResponse {
            result: bitfun_core::service::config::ConfigImportResult {
                success: false,
                errors: vec!["Missing model".to_string()],
                warnings: vec!["Provider disabled".to_string()],
            },
            invalidated_ai_cache: true,
        };

        let output = config_import_human_lines("C:\\Users\\example\\config export.json", &response)
            .join("\n");

        assert!(output.contains("Shared Global Configuration Imported"));
        assert!(output.contains("Status: failed"));
        assert!(output.contains("File: C:\\Users\\example\\config export.json"));
        assert!(output.contains("AI client cache: invalidated"));
        assert!(output.contains("Errors: 1"));
        assert!(output.contains("Warnings: 1"));
        assert!(output.contains("Validate config: sparo config validate"));
        assert!(output.contains(
            "Machine output: sparo config import \"C:\\Users\\example\\config export.json\" --json"
        ));
    }

    #[test]
    fn cli_presentation_preferences_summary_includes_operational_defaults() {
        let mut config = CliConfig::default();
        config.behavior.default_agent = "debug".to_string();
        config.behavior.confirm_dangerous = false;
        config.workspace.default_path = "D:\\workspace\\project".to_string();

        let lines = cli_presentation_preference_lines(&config).join("\n");

        assert!(lines.contains("Default Agent: debug"));
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

    #[test]
    fn find_app_row_matches_id_or_name_case_insensitively() {
        let apps = vec![bitfun_core::command::agentic_os::AgenticOsAppRow {
            id: "files".to_string(),
            name: "Files".to_string(),
            kind: "AGENT APP".to_string(),
            description: "Browse files".to_string(),
            capability: "read write".to_string(),
            target: Some("C:\\apps\\files".to_string()),
        }];

        assert_eq!(find_app_row(&apps, "FILES").unwrap().id, "files");
        assert_eq!(find_app_row(&apps, "files").unwrap().name, "Files");
        assert!(find_app_row(&apps, "missing").is_none());
    }

    #[test]
    fn app_human_detail_lines_include_open_action_when_target_exists() {
        let app = bitfun_core::command::agentic_os::AgenticOsAppRow {
            id: "bridge app".to_string(),
            name: "Bridge App".to_string(),
            kind: "BRIDGE APP".to_string(),
            description: "Connects a local tool".to_string(),
            capability: "inspect run".to_string(),
            target: Some("D:\\apps\\bridge".to_string()),
        };

        let output = app_human_detail_lines(&app, Some("D:\\workspace\\my project")).join("\n");

        assert!(output.contains("App Details"));
        assert!(output.contains("Target: D:\\apps\\bridge"));
        assert!(output.contains(
            "Inspect: sparo apps show --workspace \"D:\\workspace\\my project\" \"bridge app\""
        ));
        assert!(output.contains(
            "Open: sparo apps open --workspace \"D:\\workspace\\my project\" \"bridge app\""
        ));
    }

    #[test]
    fn app_human_detail_lines_explain_inspect_only_apps() {
        let app = bitfun_core::command::agentic_os::AgenticOsAppRow {
            id: "agentic".to_string(),
            name: "Agentic".to_string(),
            kind: "AGENT APP".to_string(),
            description: "Built-in agent app".to_string(),
            capability: "inspect".to_string(),
            target: None,
        };

        let output = app_human_detail_lines(&app, None).join("\n");

        assert!(output.contains("Target: not available"));
        assert!(output.contains("Inspect: sparo apps show agentic"));
        assert!(output.contains("Open: unavailable because this app has no local target."));
    }

    #[test]
    fn app_open_human_lines_include_followup_actions() {
        let app = bitfun_core::command::agentic_os::AgenticOsAppRow {
            id: "bridge app".to_string(),
            name: "Bridge App".to_string(),
            kind: "BRIDGE APP".to_string(),
            description: "Connects a local tool".to_string(),
            capability: "inspect run".to_string(),
            target: Some("D:\\apps\\bridge".to_string()),
        };

        let output =
            app_open_human_lines(&app, Some("D:\\workspace\\my project"), "D:\\apps\\bridge")
                .join("\n");

        assert!(output.contains("App Target Opened"));
        assert!(output.contains("App: Bridge App (BRIDGE APP)"));
        assert!(output.contains("Target: D:\\apps\\bridge"));
        assert!(output.contains(
            "Inspect app: sparo apps show --workspace \"D:\\workspace\\my project\" \"bridge app\""
        ));
        assert!(output
            .contains("Discuss in chat: sparo chat --workspace \"D:\\workspace\\my project\""));
        assert!(output.contains(
            "Machine output: sparo apps open --workspace \"D:\\workspace\\my project\" \"bridge app\" --json"
        ));
    }

    #[test]
    fn apps_list_human_lines_include_open_next_actions_for_target_apps() {
        let apps = vec![bitfun_core::command::agentic_os::AgenticOsAppRow {
            id: "bridge app".to_string(),
            name: "Bridge App".to_string(),
            kind: "BRIDGE APP".to_string(),
            description: "Connects a local tool".to_string(),
            capability: "inspect run".to_string(),
            target: Some("D:\\apps\\bridge".to_string()),
        }];

        let output =
            apps_list_human_lines(&apps, Some("D:\\workspace\\my project"), false).join("\n");

        assert!(output.contains("Installed Apps (total 1)"));
        assert!(output.contains("bridge app | BRIDGE APP | Bridge App"));
        assert!(output.contains("Next actions:"));
        assert!(output.contains(
            "Inspect latest: sparo apps show --workspace \"D:\\workspace\\my project\" \"bridge app\""
        ));
        assert!(output.contains(
            "Open latest: sparo apps open --workspace \"D:\\workspace\\my project\" \"bridge app\""
        ));
        assert!(output
            .contains("Discuss in chat: sparo chat --workspace \"D:\\workspace\\my project\""));
        assert!(output.contains("Machine output: sparo apps list --json"));
    }

    #[test]
    fn apps_list_human_lines_explain_inspect_only_latest_app() {
        let apps = vec![bitfun_core::command::agentic_os::AgenticOsAppRow {
            id: "agentic".to_string(),
            name: "Agentic".to_string(),
            kind: "AGENT APP".to_string(),
            description: "Built-in agent app".to_string(),
            capability: "inspect".to_string(),
            target: None,
        }];

        let output = apps_list_human_lines(&apps, None, false).join("\n");

        assert!(output.contains("Inspect latest: sparo apps show agentic"));
        assert!(output.contains("Open latest: unavailable because this app has no local target."));
        assert!(output.contains("Discuss in chat: sparo chat"));
    }

    #[test]
    fn apps_list_human_lines_empty_state_guides_creation() {
        let output =
            apps_list_human_lines(&[], Some("D:\\workspace\\my project"), false).join("\n");

        assert!(output.contains("No Agent, Bridge, or Live Apps installed."));
        assert!(output.contains("Agent App Studio"));
        assert!(output.contains("sparo tool schema CreateAgentApp --json"));
        assert!(output.contains(
            "Open app-building chat: sparo chat --workspace \"D:\\workspace\\my project\""
        ));
        assert!(output.contains("Machine output: sparo apps list --json"));
    }

    #[test]
    fn apps_list_human_lines_storage_problem_points_to_health() {
        let output = apps_list_human_lines(&[], None, true).join("\n");

        assert!(
            output.contains("No apps could be loaded because app storage is not fully accessible.")
        );
        assert!(output.contains("sparo health"));
        assert!(output.contains("Machine output: sparo apps list --json"));
        assert!(!output.contains("Agent App Studio"));
    }

    #[test]
    fn find_workspace_row_matches_label_path_or_global() {
        let workspaces = vec![
            bitfun_core::command::agentic_os::AgenticOsWorkspaceRow {
                label: "global".to_string(),
                path: None,
                git: None,
                session_count: 0,
            },
            bitfun_core::command::agentic_os::AgenticOsWorkspaceRow {
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
        let workspace = bitfun_core::command::agentic_os::AgenticOsWorkspaceRow {
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
        let workspace = bitfun_core::command::agentic_os::AgenticOsWorkspaceRow {
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
        let workspace = bitfun_core::command::agentic_os::AgenticOsWorkspaceRow {
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
        assert!(
            output.contains("Inspect preference: sparo config prefs get workspace.default_path")
        );
        assert!(output.contains("Machine output: sparo workspaces use \"my project\" --json"));
    }

    #[test]
    fn workspaces_list_human_lines_include_next_actions_for_first_workspace() {
        let workspaces = vec![bitfun_core::command::agentic_os::AgenticOsWorkspaceRow {
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
        let workspaces = vec![bitfun_core::command::agentic_os::AgenticOsWorkspaceRow {
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
        let memories = vec![bitfun_core::command::agentic_os::AgenticOsMemoryRow {
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
        let memory = bitfun_core::command::agentic_os::AgenticOsMemoryRow {
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
        let memory = bitfun_core::command::agentic_os::AgenticOsMemoryRow {
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
            memory_human_detail_lines(&memory, &preview, Some("D:\\workspace\\my project"))
                .join("\n");

        assert!(output.contains("Memory: PROJECT | notes.md"));
        assert!(output.contains("abc"));
        assert!(output.contains("[truncated: showing 3 of 6 bytes"));
        assert!(output.contains("Next actions:"));
        assert!(output.contains(
            "Show full file: sparo memory --workspace \"D:\\workspace\\my project\" show project:notes.md --max-bytes 6"
        ));
        assert!(output
            .contains("Discuss in chat: sparo chat --workspace \"D:\\workspace\\my project\""));
    }

    #[test]
    fn memory_human_detail_lines_omit_truncation_when_complete() {
        let memory = bitfun_core::command::agentic_os::AgenticOsMemoryRow {
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
        assert!(
            output.contains("Show full file: sparo memory show global:profile.md --max-bytes 8")
        );
        assert!(output.contains("Discuss in chat: sparo chat"));
    }

    #[test]
    fn memory_list_human_lines_include_show_and_chat_actions() {
        let memories = vec![bitfun_core::command::agentic_os::AgenticOsMemoryRow {
            scope: "PROJECT".to_string(),
            file: "notes.md".to_string(),
            target: "D:\\workspace\\my project\\.sparo_os\\memory".to_string(),
        }];

        let output =
            memory_list_human_lines(&memories, Some("D:\\workspace\\my project")).join("\n");

        assert!(output.contains("Memory Files (total 1)"));
        assert!(output.contains("PROJECT | notes.md"));
        assert!(output.contains("Next actions:"));
        assert!(output.contains(
            "Show latest: sparo memory --workspace \"D:\\workspace\\my project\" show project:notes.md"
        ));
        assert!(output
            .contains("Discuss in chat: sparo chat --workspace \"D:\\workspace\\my project\""));
        assert!(output.contains("Machine output: sparo memory list --json"));
    }

    #[test]
    fn memory_list_human_lines_keep_empty_snapshot_actionable() {
        let output = memory_list_human_lines(&[], None).join("\n");

        assert!(output.contains("No memory files are available in this snapshot."));
        assert!(output.contains(".sparo_os/memory"));
        assert!(output.contains("sparo health"));
        assert!(output.contains("sparo chat"));
    }

    #[test]
    fn find_task_row_matches_session_id_or_title() {
        let tasks = vec![bitfun_core::command::agentic_os::AgenticOsTaskRow {
            title: "Fix bug".to_string(),
            agent: "debug".to_string(),
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
        let task = bitfun_core::command::agentic_os::AgenticOsTaskRow {
            title: "Review CLI task flow".to_string(),
            agent: "debug".to_string(),
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
        let task = bitfun_core::command::agentic_os::AgenticOsTaskRow {
            title: "Review CLI task flow".to_string(),
            agent: "debug".to_string(),
            status: "active".to_string(),
            detail: "Needs handoff".to_string(),
            session_id: None,
            workspace: None,
        };

        let output = task_human_detail_lines(&task).join("\n");

        assert!(output.contains("Session: none"));
        assert!(output.contains("Resume: sparo tasks resume \"Review CLI task flow\""));
        assert!(output
            .contains("Export: unavailable until this task has a persisted session transcript."));
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
        let tasks = vec![bitfun_core::command::agentic_os::AgenticOsTaskRow {
            title: "Review CLI task flow".to_string(),
            agent: "debug".to_string(),
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
        assert!(output.contains(
            "Show details: sparo tasks --workspace D:\\workspace\\task show task-session"
        ));
        assert!(output.contains(
            "Export latest: sparo tasks --workspace D:\\workspace\\task export task-session --output task.md"
        ));
        assert!(output.contains("Open TUI tasks: sparo chat --workspace D:\\workspace\\task"));
    }

    #[test]
    fn tasks_list_human_lines_explain_no_session_latest_task() {
        let tasks = vec![bitfun_core::command::agentic_os::AgenticOsTaskRow {
            title: "Review CLI task flow".to_string(),
            agent: "debug".to_string(),
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
        let task = bitfun_core::command::agentic_os::AgenticOsTaskRow {
            title: "Review CLI task flow".to_string(),
            agent: "debug".to_string(),
            status: "active".to_string(),
            detail: "Needs handoff".to_string(),
            session_id: None,
            workspace: None,
        };

        let launch =
            task_tui_launch_context(&task, Some("D:\\workspace\\fallback".to_string()), None);

        assert_eq!(launch.workspace.as_deref(), Some("D:\\workspace\\fallback"));
        assert_eq!(launch.agent, "debug");
        assert_eq!(launch.title, "Review CLI task flow");
        assert_eq!(launch.context_messages.len(), 1);
        assert!(launch.context_messages[0].contains("Task detail"));
        assert!(launch.context_messages[0].contains("Session: none"));
        assert!(launch.context_messages[0].contains("Workspace: global"));
        let message = launch.initial_message.as_deref().unwrap();
        assert!(message.contains("Use the task detail above"));
        assert!(message.contains("Review CLI task flow"));
        assert!(message.contains("debug"));
    }

    #[test]
    fn task_tui_launch_context_preserves_explicit_resume_message() {
        let task = bitfun_core::command::agentic_os::AgenticOsTaskRow {
            title: "Review CLI task flow".to_string(),
            agent: "debug".to_string(),
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
        let task = bitfun_core::command::agentic_os::AgenticOsTaskRow {
            title: "Review CLI task flow".to_string(),
            agent: "debug".to_string(),
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
}
