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

use config::CliConfig;
use modes::chat::ChatMode;
use modes::exec::ExecMode;

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
        /// Agent type
        #[arg(short, long, default_value = "Dispatcher")]
        agent: String,

        /// Workspace path (defaults to CLI preference workspace.default_path when set)
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

#[derive(Subcommand)]
enum TasksAction {
    /// List backend-tracked tasks
    List,
    /// Show one task by session id, title, or "last"
    Show {
        /// Task session id, title, or "last" for the most recent task
        id: String,
    },
    /// Resume one task in the TUI by session id, title, or "last"
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
        /// Preference path: ui.theme, ui.show_tips, ui.animation, behavior.default_agent, workspace.default_path
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

    match std::fs::read_to_string(path)
        .ok()
        .and_then(|content| toml::from_str::<CliConfig>(&content).err())
    {
        Some(error) => {
            health.status = "invalid_config".to_string();
            health.error = Some(error.to_string());
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
        let next_steps = health_next_steps(&health);
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
        ["config", "get", ..]
        | ["config", "export", ..]
        | ["config", "import", ..]
        | ["config", "validate", ..]
        | ["config", "health", ..]
        | ["config", "prefs", "get", ..]
        | ["config", "prefs", "set", ..]
        | ["tool", "schema", ..] => true,
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
            | Some(Commands::Apps { json: true, .. })
            | Some(Commands::Workspaces { json: true, .. })
            | Some(Commands::Memory { json: true, .. })
            | Some(Commands::Config {
                action: ConfigAction::Show { json: true, .. }
                    | ConfigAction::Get { .. }
                    | ConfigAction::Set { json: true, .. }
                    | ConfigAction::Prefs {
                        action: PrefsAction::Get { .. } | PrefsAction::Set { .. }
                    }
                    | ConfigAction::Reset { json: true, .. }
                    | ConfigAction::Export { .. }
                    | ConfigAction::Import { .. }
                    | ConfigAction::Validate { .. }
                    | ConfigAction::Reload { json: true }
                    | ConfigAction::Health { .. },
            })
            | Some(Commands::Tool {
                action: ToolAction::List { json: true }
                    | ToolAction::Schema { .. }
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
        }) | Some(Commands::Tasks {
            action: TasksAction::List | TasksAction::Show { .. } | TasksAction::Export { .. },
            ..
        }) | Some(Commands::Sessions {
            action: SessionAction::List | SessionAction::Show { .. } | SessionAction::Export { .. },
            ..
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

    let show_config_warnings = !is_tui_mode
        && !command_requests_json(&cli.command)
        && !can_use_default_config_silently(&cli.command);
    let config = CliConfig::load().unwrap_or_else(|e| {
        if show_config_warnings {
            eprintln!("Warning: Failed to load config: {}", e);
            eprintln!("Using default configuration");
        }
        CliConfig::default()
    });

    match cli.command {
        Some(Commands::Chat { agent, workspace }) => {
            let (
                workspace,
                startup_session_id,
                effective_agent,
                startup_initial_message,
                mut startup_terminal,
            ) = if workspace.is_none() {
                use ui::startup::{StartupOutcome, StartupPage};

                let mut terminal = Some(ui::init_terminal()?);
                render_loading_or_restore(&mut terminal, "Loading Agentic OS backend...")?;
                let snapshot =
                    StartupPage::load_snapshot(cli_default_workspace_hint(&config)).await;
                let mut startup_page = StartupPage::new(snapshot);
                let outcome = run_startup_page_or_restore(&mut terminal, &mut startup_page)?;

                match outcome {
                    StartupOutcome::Launch(launch) => (
                        launch.workspace,
                        launch.session_id,
                        launch.agent,
                        launch.initial_message,
                        terminal,
                    ),
                    StartupOutcome::Exit => {
                        restore_terminal_if_present(&mut terminal);
                        println!("Goodbye!");
                        return Ok(());
                    }
                }
            } else {
                (workspace, None, agent, None, None)
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
            let original_skip_confirmation =
                set_tool_confirmation_skip(&config_service, true, "chat").await;

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
            let workspace_path_resolved =
                resolve_configured_workspace_path(&config, workspace.as_deref())
                    .or_else(|| std::env::current_dir().ok());
            tracing::info!("CLI workspace: {:?}", workspace_path_resolved);

            let process_runtime = initialize_cli_process_runtime().await?;
            tracing::info!("CLI process runtime initialized");

            let config_service = process_runtime.config_service.clone();
            let desired_skip = !confirm;
            let original_skip_confirmation =
                set_tool_confirmation_skip(&config_service, desired_skip, "exec").await;

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
            resume_session_in_tui(config, workspace, id, message).await?;
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
            let session_id = task
                .session_id
                .ok_or_else(|| anyhow::anyhow!("Task has no persisted session id: {}", id))?;
            resume_session_in_tui(config, task.workspace.or(workspace), session_id, message)
                .await?;
        }

        Some(Commands::Tasks {
            action,
            workspace,
            json,
        }) => {
            let workspace = effective_workspace_hint(&config, workspace.as_deref());
            handle_tasks_action(action, workspace, json).await?;
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

            loop {
                let mut terminal = Some(ui::init_terminal()?);
                render_loading_or_restore(&mut terminal, "Loading Agentic OS backend...")?;
                let snapshot =
                    StartupPage::load_snapshot(cli_default_workspace_hint(&config)).await;
                let mut startup_page = StartupPage::new(snapshot);
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
                let original_skip_confirmation =
                    set_tool_confirmation_skip(&config_service, true, "home-chat").await;

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
            println!("No batch tasks found in {}", tasks_file);
            println!("{}", empty_batch_hint());
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
            let agent = task.agent("Dispatcher");
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
    let original_skip_confirmation =
        set_tool_confirmation_skip(&config_service, true, "sessions-resume").await;

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
            let tasks = load_tasks_snapshot(workspace).await?;
            if json {
                print_json(tasks)?;
            } else if tasks.is_empty() {
                println!("No backend-tracked agent tasks found.");
                println!("{}", empty_task_hint());
            } else {
                println!("Agent Tasks (total {})\n", tasks.len());
                for task in tasks {
                    println!(
                        "{} | {} | {}",
                        task.session_id.as_deref().unwrap_or("no-session"),
                        task.status,
                        task.title
                    );
                    println!("  agent: {} | {}", task.agent, task.detail);
                    if let Some(workspace) = task.workspace {
                        println!("  workspace: {}", workspace);
                    }
                    println!();
                }
            }
        }
        TasksAction::Show { id } => {
            let task = resolve_task(workspace, &id).await?;
            if json {
                print_json(task)?;
            } else {
                println!("Task Details\n");
                println!("Title: {}", task.title);
                println!("Session: {}", task.session_id.as_deref().unwrap_or("none"));
                println!("Agent: {}", task.agent);
                println!("Status: {}", task.status);
                println!("Detail: {}", task.detail);
                println!(
                    "Workspace: {}",
                    task.workspace.as_deref().unwrap_or("global")
                );
            }
        }
        TasksAction::Export { id, output, format } => {
            let task = resolve_task(workspace.clone(), &id).await?;
            let session_id = task
                .session_id
                .ok_or_else(|| anyhow::anyhow!("Task has no persisted session id: {}", id))?;
            use bitfun_core::command::session as session_command;
            let detail = session_command::show_session(session_command::ShowSessionRequest {
                session_id,
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
                    println!("Exported task to {}", output);
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

#[derive(Debug, serde::Serialize)]
struct BatchTaskResult {
    index: usize,
    agent: String,
    message: String,
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
        print_batch_summary(&summary);
        Ok(())
    }
}

fn print_batch_summary(summary: &BatchSummary<'_>) {
    println!(
        "\n=== Batch Summary ===\n{} passed, {} failed, {} total",
        summary.passed, summary.failed, summary.total
    );
    for result in summary.results {
        let status = if result.success { "ok" } else { "failed" };
        let first_line = result.message.lines().next().unwrap_or("");
        println!(
            "{}. {} | {} | {} ms | {}",
            result.index, status, result.agent, result.duration_ms, first_line
        );
        if let Some(error) = &result.error {
            if let Some(kind) = &result.error_kind {
                println!("   error kind: {}", kind);
            }
            println!("   error: {}", error);
        }
    }
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
            let sessions =
                session_command::list_sessions(session_command::SessionWorkspaceRequest {
                    workspace_path,
                })
                .await?;

            if json {
                print_json(sessions)?;
                return Ok(());
            }

            if sessions.is_empty() {
                println!("No history sessions");
                println!("{}", empty_session_hint());
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

            if json {
                print_json(detail)?;
                return Ok(());
            }

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
            if json {
                print_json(response)?;
                return Ok(());
            }
            println!("{}", response.message);
        }

        SessionAction::Export { id, output, format } => {
            let detail = session_command::show_session(session_command::ShowSessionRequest {
                session_id: id,
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
                    println!("Exported session to {}", output);
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

fn set_cli_pref(config: &mut CliConfig, path: &str, value: &str) -> Result<()> {
    match path {
        "ui.theme" => match value {
            "dark" | "light" | "auto" => config.ui.theme = value.to_string(),
            _ => anyhow::bail!("ui.theme must be one of: dark, light, auto"),
        },
        "ui.show_tips" => config.ui.show_tips = parse_bool_pref(path, value)?,
        "ui.animation" => config.ui.animation = parse_bool_pref(path, value)?,
        "ui.color_scheme" => config.ui.color_scheme = value.to_string(),
        "behavior.default_agent" => config.behavior.default_agent = value.to_string(),
        "behavior.confirm_dangerous" => {
            config.behavior.confirm_dangerous = parse_bool_pref(path, value)?
        }
        "workspace.default_path" => config.workspace.default_path = value.to_string(),
        _ => anyhow::bail!("Unknown CLI preference path: {}", path),
    }
    Ok(())
}

fn handle_prefs_action(action: PrefsAction, config: &CliConfig) -> Result<()> {
    match action {
        PrefsAction::Get { path, json: _ } => {
            print_json(cli_prefs_value(&config, path.as_deref())?)?;
        }
        PrefsAction::Set {
            path,
            value,
            json: _,
        } => {
            let mut config = CliConfig::load()?;
            set_cli_pref(&mut config, &path, &value)?;
            config.save()?;
            print_json(serde_json::json!({
                "path": path,
                "value": cli_prefs_value(&config, Some(&path))?,
                "config_path": CliConfig::config_path()?.to_string_lossy(),
            }))?;
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
                println!("{}", response.message);
                if response.invalidated_ai_cache {
                    println!("AI client cache invalidated");
                }
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
                println!("{}", response.message);
                if response.invalidated_ai_cache {
                    println!("AI client cache invalidated");
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

        ConfigAction::Import { file, json: _ } => {
            let ctx = build_command_context().await?;
            let raw = std::fs::read_to_string(&file)
                .with_context(|| format!("Failed to read config export file: {}", file))?;
            let config = serde_json::from_str(strip_utf8_bom(&raw))
                .with_context(|| format!("Invalid config export JSON: {}", file))?;
            let response =
                command_config::import_config(&ctx, command_config::ImportConfigRequest { config })
                    .await?;
            print_json(response)?;
        }

        ConfigAction::Validate { json: _ } => {
            let value = match build_command_context().await {
                Ok(ctx) => command_config::validate_config(&ctx).await?,
                Err(error) if cli_error_kind(&error) == "runtime_directory_error" => {
                    fallback_shared_config_validation()?
                }
                Err(error) => return Err(error),
            };
            print_json(value)?;
        }

        ConfigAction::Reload { json } => {
            let ctx = build_command_context().await?;
            let message = command_config::reload_config(&ctx).await?;
            if json {
                print_json(serde_json::json!({ "message": message }))?;
            } else {
                println!("{}", message);
            }
        }

        ConfigAction::Health { json: _ } => {
            let status = match build_command_context().await {
                Ok(ctx) => serde_json::to_value(
                    command_config::get_global_config_health_status(&ctx).await?,
                )?,
                Err(error) if cli_error_kind(&error) == "runtime_directory_error" => {
                    fallback_shared_config_health(&error)?
                }
                Err(error) => return Err(error),
            };
            print_json(status)?;
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
            let apps = load_apps_snapshot(workspace).await?;
            if json {
                print_json(apps)?;
            } else if apps.is_empty() {
                let app_storage_checks = app_storage_health_checks();
                if has_app_storage_problem(&app_storage_checks) {
                    println!(
                        "No apps could be loaded because app storage is not fully accessible."
                    );
                    println!("Run `sparo health` to diagnose Sparo CLI data directory access.");
                } else {
                    println!("No Agent, Bridge, or Live Apps installed.");
                    println!(
                        "Create one from chat with Agent App Studio or Live App Studio, or inspect `sparo tool schema CreateAgentApp --json` and `sparo tool schema InitLiveApp --json`."
                    );
                }
            } else {
                println!("Installed Apps (total {})\n", apps.len());
                for app in apps {
                    println!("{} | {} | {}", app.id, app.kind, app.name);
                    println!("  {}", app.description);
                    println!("  capability: {}", app.capability);
                    if let Some(target) = app.target {
                        println!("  target: {}", target);
                    }
                    println!();
                }
            }
        }
        AppsAction::Show { id, workspace } => {
            let workspace = effective_workspace_hint(config, workspace.as_deref());
            let apps = load_apps_snapshot(workspace).await?;
            let app =
                find_app_row(&apps, &id).ok_or_else(|| anyhow::anyhow!("App not found: {}", id))?;
            if json {
                print_json(app)?;
            } else {
                println!("App Details\n");
                println!("Name: {}", app.name);
                println!("ID: {}", app.id);
                println!("Kind: {}", app.kind);
                println!("Description: {}", app.description);
                println!("Capability: {}", app.capability);
                println!(
                    "Target: {}",
                    app.target.as_deref().unwrap_or("not available")
                );
            }
        }
        AppsAction::Open { id, workspace } => {
            let workspace = effective_workspace_hint(config, workspace.as_deref());
            let apps = load_apps_snapshot(workspace).await?;
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
                println!("Opened {} '{}' at {}", app.kind, app.name, target);
            }
        }
    }
    Ok(())
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
                println!("Known Workspaces (total {})\n", workspaces.len());
                for workspace in workspaces {
                    println!("{}", workspace.label);
                    println!(
                        "  path: {}",
                        workspace
                            .path
                            .as_deref()
                            .unwrap_or("Agentic OS global runtime")
                    );
                    println!("  git: {}", workspace.git.as_deref().unwrap_or("no-git"));
                    println!("  sessions: {}", workspace.session_count);
                    println!();
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
                println!("Workspace Details\n");
                println!("Label: {}", workspace.label);
                println!(
                    "Path: {}",
                    workspace
                        .path
                        .as_deref()
                        .unwrap_or("Agentic OS global runtime")
                );
                println!("Git: {}", workspace.git.as_deref().unwrap_or("no-git"));
                println!("Sessions: {}", workspace.session_count);
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
            if json {
                print_json(serde_json::json!({
                    "label": workspace.label,
                    "path": default_path,
                    "workspace_path": workspace.path.clone(),
                    "config_path": CliConfig::config_path()?.to_string_lossy(),
                }))?;
            } else {
                let display_path = workspace
                    .path
                    .as_deref()
                    .unwrap_or("Agentic OS global runtime");
                println!(
                    "Set CLI default workspace to {} ({})",
                    workspace.label, display_path
                );
            }
        }
    }

    Ok(())
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
            let memories = load_memory_snapshot(workspace).await?;
            if json {
                print_json(memories)?;
            } else if memories.is_empty() {
                println!("No memory files are available in this snapshot.");
                println!(
                    "Add notes under .sparo_os/memory; run `sparo health` if memory is missing."
                );
            } else {
                println!("Memory Files (total {})\n", memories.len());
                for memory in memories {
                    println!("{} | {}", memory.scope, memory.file);
                    println!("  {}", memory.target);
                }
            }
        }
        MemoryAction::Show { id, max_bytes } => {
            let memories = load_memory_snapshot(workspace).await?;
            let memory = find_memory_row(&memories, &id)
                .ok_or_else(|| anyhow::anyhow!("Memory file not found: {}", id))?;
            let preview = read_memory_content(memory, max_bytes)?;
            if json {
                print_json(memory_content_json(memory, &preview))?;
            } else {
                println!(
                    "Memory: {} | {}\nPath: {}\n",
                    memory.scope,
                    memory.file,
                    memory_row_path(memory).display()
                );
                println!("{}", preview.content);
                if preview.truncated {
                    println!(
                        "\n[truncated: showing {} of {} bytes; use --max-bytes to read more]",
                        preview.bytes_read, preview.total_bytes
                    );
                }
            }
        }
    }

    Ok(())
}

async fn handle_tool_action(action: ToolAction) -> Result<()> {
    use bitfun_core::command::tool as tool_command;

    match action {
        ToolAction::List { json } => {
            let tools = tool_command::list_tools().await?;
            if json {
                print_json(tools)?;
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
                    println!("{}{}", tool.name, suffix);
                    println!("  {}", tool.description.lines().next().unwrap_or(""));
                }
            }
        }

        ToolAction::Schema {
            name,
            workspace,
            json: _,
        } => {
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
        assert!(should_emit_json_error([
            "--verbose".to_string(),
            "config".to_string(),
            "prefs".to_string(),
            "get".to_string(),
        ]));
        assert!(should_emit_json_error([
            "tool".to_string(),
            "schema".to_string(),
            "read_file".to_string(),
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
            action: ConfigAction::Prefs {
                action: PrefsAction::Get {
                    path: None,
                    json: false,
                },
            },
        })));
        assert!(command_requests_json(&Some(Commands::Tool {
            action: ToolAction::List { json: true },
        })));
        assert!(command_requests_json(&Some(Commands::Tool {
            action: ToolAction::Schema {
                name: "read_file".to_string(),
                workspace: None,
                json: false,
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
        assert!(!command_requests_json(&Some(Commands::Chat {
            agent: "Dispatcher".to_string(),
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
    fn config_prefs_get_help_mentions_json_output() {
        let mut command = Cli::command();
        let prefs_help = command
            .find_subcommand_mut("config")
            .unwrap()
            .find_subcommand_mut("prefs")
            .unwrap()
            .find_subcommand_mut("get")
            .unwrap()
            .render_long_help()
            .to_string();
        assert!(prefs_help.contains("Output raw JSON"));
    }

    #[test]
    fn structured_config_subcommands_accept_json_flag() {
        let mut command = Cli::command();
        for subcommand in [
            "get", "set", "reset", "export", "validate", "reload", "health",
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
        assert_eq!(json_tasks[1].agent("Dispatcher"), "debug");

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
                agent: "Dispatcher".to_string(),
                message: "one".to_string(),
                success: true,
                duration_ms: 12,
                error_kind: None,
                error: None,
            },
            BatchTaskResult {
                index: 2,
                agent: "debug".to_string(),
                message: "two".to_string(),
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
        assert_eq!(value["results"][1]["error_kind"], "execution_error");
        assert_eq!(value["results"][1]["error"], "failed");
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
        set_cli_pref(&mut config, "behavior.default_agent", "debug").unwrap();
        set_cli_pref(&mut config, "workspace.default_path", "D:\\workspace").unwrap();

        assert_eq!(
            cli_prefs_value(&config, Some("ui.theme")).unwrap(),
            serde_json::json!("light")
        );
        assert_eq!(
            cli_prefs_value(&config, Some("ui.show_tips")).unwrap(),
            serde_json::json!(false)
        );
        assert_eq!(
            cli_prefs_value(&config, Some("behavior.default_agent")).unwrap(),
            serde_json::json!("debug")
        );
        assert_eq!(
            cli_prefs_value(&config, Some("workspace.default_path")).unwrap(),
            serde_json::json!("D:\\workspace")
        );
    }

    #[test]
    fn cli_prefs_reject_unknown_paths_and_values() {
        let mut config = CliConfig::default();

        assert!(set_cli_pref(&mut config, "ui.theme", "blue").is_err());
        assert!(set_cli_pref(&mut config, "ui.unknown", "x").is_err());
        assert!(cli_prefs_value(&config, Some("ui.unknown")).is_err());
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
}
