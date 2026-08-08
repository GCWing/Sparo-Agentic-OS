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
use clap::{error::ErrorKind as ClapErrorKind, Parser, Subcommand, ValueEnum};
use serde::{Deserialize, Serialize};
use sparo_core::command::agentic_os::{
    IntelligentAppCatalogRequest, IntelligentAppCatalogResponse as CliIntelligentAppCatalog,
};
use sparo_core::infrastructure::APP_CONFIG_DIR_NAME;

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
        /// Session domain to inspect; no cross-domain fallback is performed
        #[arg(long, value_enum)]
        domain: CliSessionDomain,

        /// Workspace path used to resolve --domain workspace
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

    /// Inspect global Intelligent Apps, immutable Releases, and Activation routing
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
enum CliSessionDomain {
    OsAgent,
    Global,
    Workspace,
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
    /// Show the shared global configuration summary
    Show {
        /// Output structured summary JSON
        #[arg(long)]
        json: bool,
    },
    /// Discover settings from the authoritative Config Catalog
    Catalog {
        /// Optional query matched against setting IDs, labels, aliases, and tags
        query: Option<String>,

        /// Output raw JSON
        #[arg(long)]
        json: bool,
    },
    /// Get one shared global configuration value by stable Catalog setting ID
    Get {
        /// Stable Catalog setting ID
        setting_id: String,
    },
    /// Set one shared global configuration value by stable Catalog setting ID
    Set {
        /// Stable Catalog setting ID
        setting_id: String,

        /// JSON value; bare text is treated as a string
        value: String,

        /// Output raw JSON
        #[arg(long)]
        json: bool,

        /// Explicitly confirm elevated-risk changes
        #[arg(long)]
        yes: bool,
    },
    /// Edit CLI-local presentation preferences
    Edit,
    /// Manage CLI-local preferences
    Prefs {
        #[command(subcommand)]
        action: PrefsAction,
    },
    /// Reset one shared global configuration setting by stable Catalog setting ID
    Reset {
        /// Stable Catalog setting ID
        setting_id: String,

        /// Output raw JSON
        #[arg(long)]
        json: bool,

        /// Explicitly confirm elevated-risk changes
        #[arg(long)]
        yes: bool,
    },
    /// Export shared global configuration as JSON
    Export,
    /// Import shared global configuration from a JSON file
    Import {
        /// Exported configuration JSON file
        file: String,

        /// Output raw JSON
        #[arg(long)]
        json: bool,

        /// Explicitly confirm elevated-risk changes in the import
        #[arg(long)]
        yes: bool,
    },
    /// Validate shared global configuration
    Validate {
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
    /// List global Intelligent Apps
    List,
    /// Show one Intelligent App and its Releases/Activation
    Show {
        /// App id or name
        id: String,
    },
    /// Launch an Intelligent App (currently requires Sparo Desktop Work)
    Open {
        /// App id or name
        id: String,
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
                    "agent": "bitfun-coder",
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
                    "agent": "bitfun-coder",
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
        serde_json::from_str::<sparo_core::service::config::GlobalConfig>(&content).err()
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
    let path_manager = sparo_core::infrastructure::try_get_path_manager_arc()
        .map_err(|error| anyhow::anyhow!("Failed to initialize storage paths: {error}"))?;
    let registered_workspace = current_workspace
        .as_deref()
        .filter(|path| path.join(".sparo_os").join("workspace.json").is_file());
    let (workspace_sessions_path, workspace_memory_path) =
        if let Some(workspace) = registered_workspace {
            let workspace_id = path_manager.workspace_id(workspace)?;
            let domain = sparo_core::agentic::SessionDomain::Workspace { workspace_id };
            (
                path_manager.session_domain_root(&domain)?,
                path_manager.workspace_memory_dir(workspace)?,
            )
        } else {
            (
                path_manager.sessions_root().join("workspaces"),
                path_manager.workspaces_runtime_root(),
            )
        };
    let agentic_os_memory_path = path_manager.agentic_os_memory_dir();
    let checks = serde_json::json!({
        "app_root": directory_health(&config_dir),
        "cli_config_file": cli_config_file_health(&CliConfig::config_path()?),
        "config": directory_health(&config_dir.join("config")),
        "global_config_file": global_config_file_health(&config_dir.join("config").join("app.json")),
        "workspaces": directory_health(&config_dir.join("workspaces")),
        "sessions": directory_health(&path_manager.sessions_root()),
        "os_agent_sessions": directory_health(
            &path_manager.session_domain_root(&sparo_core::agentic::SessionDomain::OsAgent)?
        ),
        "global_sessions": directory_health(
            &path_manager.session_domain_root(&sparo_core::agentic::SessionDomain::Global)?
        ),
        "workspace_sessions": directory_health(&workspace_sessions_path),
        "works": directory_health(&path_manager.works_root()),
        "runs": directory_health(&path_manager.runs_root()),
        "app_data": directory_health(&path_manager.app_data_root()),
        "services": directory_health(&path_manager.services_root()),
        "agentic_os_memory": directory_health(&agentic_os_memory_path),
        "workspace_memory": directory_health(&workspace_memory_path),
        "apps": directory_health(&config_dir.join("apps")),
        "components": directory_health(&config_dir.join("components")),
        "product_app_runtime_hosts": directory_health(
            &config_dir.join("apps").join("product_app_runtime_hosts"),
        ),
        "agent_components": directory_health(&config_dir.join("apps").join("agent_components")),
        "bridge_components": directory_health(&config_dir.join("apps").join("bridge_components")),
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
      "agent": "bitfun-coder",
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
agent = "bitfun-coder"
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
        sparo_core::infrastructure::try_get_path_manager_arc()
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
    sparo_core::infrastructure::try_get_path_manager_arc()
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

fn exec_skip_tool_confirmation(confirm: bool) -> bool {
    !confirm
}

fn effective_cli_agent(config: &CliConfig, explicit_agent: Option<&str>) -> String {
    explicit_agent
        .filter(|agent| !agent.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| config.behavior.default_agent.clone())
}

async fn initialize_cli_process_runtime() -> Result<sparo_core::runtime::ProcessRuntime> {
    sparo_core::runtime::initialize_process_runtime(sparo_core::runtime::ProcessRuntimeOptions {
        initialize_i18n: false,
        initialize_token_usage: false,
        config_startup_failure_policy:
            sparo_core::service::config::ConfigStartupFailurePolicy::Strict,
    })
    .await
    .context("Failed to initialize CLI process runtime")
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
                    | ConfigAction::Catalog { json: true, .. }
                    | ConfigAction::Get { .. }
                    | ConfigAction::Set { json: true, .. }
                    | ConfigAction::Prefs {
                        action: PrefsAction::Get { json: true, .. }
                            | PrefsAction::Set { json: true, .. },
                    }
                    | ConfigAction::Reset { json: true, .. }
                    | ConfigAction::Export
                    | ConfigAction::Import { json: true, .. }
                    | ConfigAction::Validate { json: true }
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
            action: AppsAction::List | AppsAction::Show { .. },
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
        Some("Place `--workspace <path>` after the subcommand that accepts it, for example `sparo tool run --workspace <path> <name>` or `sparo memory show --workspace <path> <id>`.")
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
    } else if message.contains("Intelligent App not found:") {
        Some("Run `sparo apps list` to see Intelligent Apps in the effective activation scope.")
    } else if message.contains("CLI Intelligent App launch is unavailable") {
        Some("Open Sparo Desktop Apps Center and launch the selected Intelligent App into a Work; the CLI never falls back to opening package files.")
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

            let _process_runtime = match initialize_cli_process_runtime().await {
                Ok(runtime) => runtime,
                Err(error) => {
                    restore_terminal_if_present(&mut startup_terminal);
                    return Err(error);
                }
            };
            tracing::info!("CLI process runtime initialized");

            let agentic_system = match agent::agentic_system::init_agentic_system()
                .await
                .context("Failed to initialize agentic system")
            {
                Ok(system) => system,
                Err(error) => {
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
            chat_mode.run(startup_terminal)?;
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

            let _process_runtime = initialize_cli_process_runtime().await?;
            tracing::info!("CLI process runtime initialized");

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
                    exec_skip_tool_confirmation(confirm),
                );
                exec_mode.run().await
            }
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
            domain,
            workspace,
            json,
        }) => {
            if json {
                anyhow::bail!("sessions resume is interactive and does not support --json");
            }
            let workspace = effective_workspace_hint(&config, workspace.as_deref());
            let session_domain = resolve_cli_session_domain(domain, workspace.as_deref())?;
            resume_session_in_tui(config, workspace, session_domain, id, message, Vec::new())
                .await?;
        }

        Some(Commands::Sessions {
            action,
            domain,
            workspace,
            json,
        }) => {
            let workspace = effective_workspace_hint(&config, workspace.as_deref());
            let session_domain = resolve_cli_session_domain(domain, workspace.as_deref())?;
            handle_session_action(action, workspace, session_domain, json).await?;
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
                let session_domain =
                    resolve_workspace_or_global_session_domain(resume.workspace.as_deref())?;
                resume_session_in_tui(
                    config,
                    resume.workspace,
                    session_domain,
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
            handle_apps_action(action, json).await?;
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

                let _process_runtime = match initialize_cli_process_runtime().await {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        restore_terminal_if_present(&mut terminal);
                        return Err(error);
                    }
                };
                tracing::info!("CLI process runtime initialized");

                let agentic_system = match agent::agentic_system::init_agentic_system()
                    .await
                    .context("Failed to initialize agentic system")
                {
                    Ok(system) => system,
                    Err(error) => {
                        restore_terminal_if_present(&mut terminal);
                        return Err(error);
                    }
                };
                tracing::info!("Agentic system initialized");

                if let Err(error) = render_loading_or_restore(
                    &mut terminal,
                    "System initialized, starting chat interface...",
                ) {
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
                let exit_reason = chat_mode.run(terminal.take())?;

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

fn turn_assistant_preview(turn: &sparo_core::service::session::DialogTurnData) -> String {
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

    let _process_runtime = initialize_cli_process_runtime().await?;
    tracing::info!("CLI process runtime initialized");

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
                true,
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

    run_result
}

fn resolve_cli_session_domain(
    domain: CliSessionDomain,
    workspace: Option<&str>,
) -> Result<sparo_core::agentic::core::SessionDomain> {
    match domain {
        CliSessionDomain::OsAgent => Ok(sparo_core::agentic::core::SessionDomain::OsAgent),
        CliSessionDomain::Global => Ok(sparo_core::agentic::core::SessionDomain::Global),
        CliSessionDomain::Workspace => resolve_workspace_session_domain(workspace),
    }
}

fn resolve_workspace_or_global_session_domain(
    workspace: Option<&str>,
) -> Result<sparo_core::agentic::core::SessionDomain> {
    match workspace.map(str::trim).filter(|value| !value.is_empty()) {
        Some(_) => resolve_workspace_session_domain(workspace),
        None => Ok(sparo_core::agentic::core::SessionDomain::Global),
    }
}

fn resolve_workspace_session_domain(
    workspace: Option<&str>,
) -> Result<sparo_core::agentic::core::SessionDomain> {
    let workspace = workspace
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow::anyhow!("--workspace is required for --domain workspace"))?;
    let path_manager = sparo_core::infrastructure::try_get_path_manager_arc()?;
    let workspace_id = path_manager.workspace_id(std::path::Path::new(workspace))?;
    Ok(sparo_core::agentic::core::SessionDomain::Workspace { workspace_id })
}

async fn resume_session_in_tui(
    config: CliConfig,
    workspace: Option<String>,
    domain: sparo_core::agentic::core::SessionDomain,
    id: String,
    initial_message: Option<String>,
    context_messages: Vec<String>,
) -> Result<()> {
    use sparo_core::command::session as session_command;

    println!("Loading session {}...", id);
    let _process_runtime = initialize_cli_process_runtime().await?;
    let detail = session_command::show_session(session_command::ShowSessionRequest {
        locator: sparo_core::agentic::core::SessionLocator {
            domain,
            session_id: id,
        },
    })
    .await?;

    let workspace = workspace.or_else(|| detail.metadata.workspace_path.clone());
    let workspace_path = resolve_tui_workspace_path(workspace.as_deref());
    let agent = detail.metadata.agent_type.clone();
    let session_id = detail.metadata.session_id.clone();

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

fn task_detail_context_message(task: &sparo_core::command::agentic_os::AgenticOsTaskRow) -> String {
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
    task: &sparo_core::command::agentic_os::AgenticOsTaskRow,
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
    task: &sparo_core::command::agentic_os::AgenticOsTaskRow,
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
    let _process_runtime = initialize_cli_process_runtime().await?;
    let workspace_path = resolve_tui_workspace_path(launch.workspace.as_deref());

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

    run_result
}

async fn load_tasks_snapshot(
    workspace: Option<String>,
) -> Result<Vec<sparo_core::command::agentic_os::AgenticOsTaskRow>> {
    let snapshot = sparo_core::command::agentic_os::get_snapshot_without_config(
        sparo_core::command::agentic_os::AgenticOsSnapshotRequest {
            workspace_hint: workspace,
        },
    )
    .await?;
    Ok(snapshot.tasks)
}

fn find_task_row<'a>(
    tasks: &'a [sparo_core::command::agentic_os::AgenticOsTaskRow],
    id_or_title: &str,
) -> Option<&'a sparo_core::command::agentic_os::AgenticOsTaskRow> {
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
) -> Result<sparo_core::command::agentic_os::AgenticOsTaskRow> {
    let tasks = load_tasks_snapshot(workspace).await?;
    resolve_task_from_rows(&tasks, id_or_title)
}

fn resolve_task_from_rows(
    tasks: &[sparo_core::command::agentic_os::AgenticOsTaskRow],
    id_or_title: &str,
) -> Result<sparo_core::command::agentic_os::AgenticOsTaskRow> {
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
            use sparo_core::command::session as session_command;
            let task_workspace = task.workspace.or(workspace);
            let domain = resolve_workspace_or_global_session_domain(task_workspace.as_deref())?;
            let detail = session_command::show_session(session_command::ShowSessionRequest {
                locator: sparo_core::agentic::core::SessionLocator {
                    domain,
                    session_id: session_id.clone(),
                },
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
            let agents = sparo_core::agentic::agents::get_agent_registry()
                .list_agents_info()
                .await
                .context("Failed to read agent capability configuration")?;

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
    tasks: &[sparo_core::command::agentic_os::AgenticOsTaskRow],
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
    task: &sparo_core::command::agentic_os::AgenticOsTaskRow,
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

fn agent_summary_line(agent: &sparo_core::agentic::agents::AgentInfo) -> String {
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

fn agents_human_lines(agents: &[sparo_core::agentic::agents::AgentInfo]) -> Vec<String> {
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
    sessions: &[sparo_core::service::session::SessionMetadata],
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
    domain: sparo_core::agentic::core::SessionDomain,
    json: bool,
) -> Result<()> {
    use sparo_core::command::session as session_command;

    match action {
        SessionAction::List => {
            let workspace_for_output = workspace_path.clone();
            let sessions =
                session_command::list_sessions(session_command::SessionWorkspaceRequest {
                    domain: domain.clone(),
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
            show_session_details("last".to_string(), domain, json).await?;
        }

        SessionAction::Show { id } => {
            show_session_details(id, domain, json).await?;
        }

        SessionAction::Delete { id } => {
            let workspace_for_output = workspace_path.clone();
            let response = session_command::delete_session(session_command::DeleteSessionRequest {
                locator: sparo_core::agentic::core::SessionLocator {
                    domain: domain.clone(),
                    session_id: id.clone(),
                },
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
                locator: sparo_core::agentic::core::SessionLocator {
                    domain: domain.clone(),
                    session_id: id.clone(),
                },
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
    domain: sparo_core::agentic::core::SessionDomain,
    json: bool,
) -> Result<()> {
    use sparo_core::command::session as session_command;

    let detail = session_command::show_session(session_command::ShowSessionRequest {
        locator: sparo_core::agentic::core::SessionLocator {
            domain,
            session_id: id,
        },
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
    metadata: &sparo_core::service::session::SessionMetadata,
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

fn render_session_markdown(detail: &sparo_core::command::session::SessionDetail) -> String {
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
    let configured_models = value
        .pointer("/models/configured")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let enabled_models = value
        .pointer("/models/enabled")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let agent_model_count = value
        .get("agentModelMappings")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let app_language = value
        .get("appLanguage")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown");

    let mut default_models = Vec::new();
    if let Some(defaults) = value
        .get("defaultModels")
        .and_then(serde_json::Value::as_object)
    {
        for (slot, model) in defaults {
            if let Some(model) = model.as_str().filter(|model| !model.is_empty()) {
                default_models.push(format!("{}={}", slot, model));
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
        format!(
            "  Revision: {}",
            value
                .get("revision")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0)
        ),
        format!(
            "  Catalog: {} ({} settings)",
            value
                .get("catalogVersion")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("unknown"),
            value
                .get("publishedSettingCount")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0)
        ),
        format!(
            "  Models: {} configured, {} enabled",
            configured_models, enabled_models
        ),
        format!("  Default models: {}", default_models),
        format!("  Agent model mappings: {}", agent_model_count),
        format!("  App language: {}", app_language),
        "  Full shared config: sparo config export".to_string(),
        "  Discover setting IDs: sparo config catalog".to_string(),
        "  Read one setting: sparo config get <setting-id>".to_string(),
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

fn config_commit_status_label(
    status: sparo_core::service::config::ConfigCommitStatus,
) -> &'static str {
    use sparo_core::service::config::ConfigCommitStatus;

    match status {
        ConfigCommitStatus::Applying => "applying",
        ConfigCommitStatus::Applied => "applied",
        ConfigCommitStatus::Partial => "partial",
        ConfigCommitStatus::RolledBack => "rolled back",
    }
}

fn config_set_human_lines(
    setting_id: &str,
    commit: &sparo_core::service::config::PublishedConfigCommit,
) -> Vec<String> {
    vec![
        "Shared Global Configuration Updated".to_string(),
        format!("Status: {}", config_commit_status_label(commit.status)),
        format!("Commit ID: {}", commit.commit_id),
        format!("Revision: {}", commit.revision),
        format!("Setting ID: {}", setting_id),
        String::new(),
        "Next actions:".to_string(),
        format!("  Inspect value: sparo config get {}", setting_id),
        "  Validate config: sparo config validate".to_string(),
        "  Open in chat: sparo chat".to_string(),
        "  Use --json on future changes for machine-readable output".to_string(),
    ]
}

fn config_reset_human_lines(
    setting_id: &str,
    commit: &sparo_core::service::config::PublishedConfigCommit,
) -> Vec<String> {
    vec![
        "Shared Global Configuration Reset".to_string(),
        format!("Status: {}", config_commit_status_label(commit.status)),
        format!("Commit ID: {}", commit.commit_id),
        format!("Revision: {}", commit.revision),
        format!("Setting ID: {}", setting_id),
        String::new(),
        "Next actions:".to_string(),
        format!("  Inspect value: sparo config get {}", setting_id),
        "  Validate config: sparo config validate".to_string(),
        "  Run health: sparo config health".to_string(),
        format!("  Machine output: sparo config reset {} --json", setting_id),
    ]
}

fn config_import_human_lines(
    file: &str,
    commit: Option<&sparo_core::service::config::PublishedConfigCommit>,
) -> Vec<String> {
    let mut lines = vec![
        "Shared Global Configuration Imported".to_string(),
        format!(
            "Status: {}",
            if commit.is_some() {
                "applied"
            } else {
                "no changes"
            }
        ),
        format!("File: {}", file),
    ];

    if let Some(commit) = commit {
        lines.push(format!("Commit ID: {}", commit.commit_id));
        lines.push(format!("Revision: {}", commit.revision));
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

fn printable_config_value<T: serde::Serialize>(value: T) -> Result<serde_json::Value> {
    let mut value = serde_json::to_value(value)?;
    redact_config_value(&mut value);
    Ok(value)
}

async fn read_shared_config_value(setting_id: &str) -> Result<serde_json::Value> {
    let runtime = initialize_cli_process_runtime().await?;
    let (catalog, snapshot) = runtime
        .config_service
        .describe_published_catalog_with_snapshot(None)
        .await?;
    catalog.find(setting_id).ok_or_else(|| {
        anyhow::anyhow!("Unknown published configuration setting ID '{setting_id}'")
    })?;
    let stored = snapshot.values.get(setting_id).ok_or_else(|| {
        anyhow::anyhow!("Authoritative snapshot is missing Catalog setting '{setting_id}'")
    })?;
    match stored {
        sparo_events::ConfigStoredValue::Value { value } => Ok(value.clone()),
        sparo_events::ConfigStoredValue::Secret {
            configured,
            provider,
            masked_suffix,
        } => Ok(serde_json::json!({
            "configured": configured,
            "provider": provider,
            "maskedSuffix": masked_suffix,
        })),
    }
}

async fn read_shared_config_summary() -> Result<serde_json::Value> {
    let runtime = initialize_cli_process_runtime().await?;
    let (catalog, snapshot) = runtime
        .config_service
        .describe_published_catalog_with_snapshot(None)
        .await?;

    let published_value = |setting_id: &str| {
        snapshot
            .values
            .get(setting_id)
            .and_then(|stored| match stored {
                sparo_events::ConfigStoredValue::Value { value } => Some(value),
                sparo_events::ConfigStoredValue::Secret { .. } => None,
            })
    };

    let models = published_value("core.ai.models")
        .and_then(serde_json::Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let enabled_models = models
        .iter()
        .filter(|model| model.get("enabled").and_then(serde_json::Value::as_bool) == Some(true))
        .count();
    let agent_model_mappings = published_value("core.ai.agent_models")
        .and_then(serde_json::Value::as_object)
        .map(serde_json::Map::len)
        .unwrap_or(0);
    let app_language = published_value("core.app.language")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);

    let mut default_models = serde_json::Map::new();
    for (slot, setting_id) in [
        ("primary", "core.ai.default_models.primary"),
        ("fast", "core.ai.default_models.fast"),
        ("search", "core.ai.default_models.search"),
        (
            "imageUnderstanding",
            "core.ai.default_models.image_understanding",
        ),
        ("imageGeneration", "core.ai.default_models.image_generation"),
        (
            "speechRecognition",
            "core.ai.default_models.speech_recognition",
        ),
    ] {
        if let Some(model) = published_value(setting_id)
            .and_then(serde_json::Value::as_str)
            .filter(|model| !model.is_empty())
        {
            default_models.insert(
                slot.to_string(),
                serde_json::Value::String(model.to_string()),
            );
        }
    }

    Ok(serde_json::json!({
        "revision": snapshot.revision,
        "catalogVersion": catalog.version,
        "publishedSettingCount": catalog.settings.len(),
        "models": {
            "configured": models.len(),
            "enabled": enabled_models,
        },
        "defaultModels": default_models,
        "agentModelMappings": agent_model_mappings,
        "appLanguage": app_language,
    }))
}

async fn commit_cli_config_operation(
    setting_id: &str,
    confirmed: bool,
    operation: impl FnOnce(String) -> sparo_core::service::config::ConfigPatchOperation,
) -> Result<sparo_core::service::config::PublishedConfigCommit> {
    use sparo_core::service::config::{CommitConfigPlanRequest, ConfigPatch};
    use sparo_events::{ConfigChangeSource, ConfigChangeSourceKind, ConfigScope};

    let setting_id = setting_id.trim();
    if setting_id.is_empty() {
        anyhow::bail!("A non-empty Catalog setting ID is required");
    }

    let runtime = initialize_cli_process_runtime().await?;
    let service = runtime.config_service;
    let (catalog, snapshot) = service
        .describe_published_catalog_with_snapshot(None)
        .await?;
    let descriptor = catalog
        .find(setting_id)
        .ok_or_else(|| anyhow::anyhow!("Unknown configuration setting ID '{setting_id}'"))?;
    let request_id = uuid::Uuid::new_v4().to_string();
    let idempotency_key = format!("cli-config-{request_id}");
    let plan = service
        .plan_product_surface_patch(ConfigPatch {
            request_id: request_id.clone(),
            idempotency_key: idempotency_key.clone(),
            expected_revision: snapshot.revision,
            source: ConfigChangeSource {
                kind: ConfigChangeSourceKind::Cli,
                surface: Some("cli".to_string()),
                request_id: Some(request_id),
            },
            scope: ConfigScope::user(),
            operations: vec![operation(descriptor.id.clone())],
        })
        .await?;
    if plan.requires_confirmation && !confirmed {
        anyhow::bail!(
            "Setting '{}' requires explicit confirmation; rerun with --yes",
            descriptor.id
        );
    }
    service
        .commit_plan(CommitConfigPlanRequest {
            plan_id: plan.plan_id,
            expected_revision: snapshot.revision,
            idempotency_key,
            confirmed,
        })
        .await
        .map(|commit| commit.published())
        .map_err(Into::into)
}

fn shared_config_file_path() -> Result<std::path::PathBuf> {
    Ok(CliConfig::config_dir_path()?
        .join("config")
        .join("app.json"))
}

fn fallback_shared_config_health(error: &anyhow::Error) -> Result<serde_json::Value> {
    let config_file = shared_config_file_path()?;
    let config_directory = config_file
        .parent()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| config_file.to_string_lossy().to_string());
    Ok(serde_json::json!({
        "healthy": false,
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
    match action {
        ConfigAction::Show { json } => {
            let value = read_shared_config_summary().await?;
            let value = printable_config_value(value)?;

            if json {
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

        ConfigAction::Catalog { query, json } => {
            let runtime = initialize_cli_process_runtime().await?;
            let catalog = runtime
                .config_service
                .describe_published_catalog(query.as_deref())
                .await?;
            if json {
                print_json(catalog)?;
            } else {
                println!("Config Catalog {}", catalog.version);
                let visible_settings = catalog
                    .settings
                    .into_iter()
                    .filter(|setting| !setting.presentation.hidden)
                    .collect::<Vec<_>>();
                if visible_settings.is_empty() {
                    println!("No settings matched the query.");
                } else {
                    for setting in visible_settings {
                        println!(
                            "{}\t{}\t{:?}",
                            setting.id, setting.presentation.title_key, setting.policy.risk
                        );
                    }
                }
            }
        }

        ConfigAction::Get { setting_id } => {
            let value = read_shared_config_value(&setting_id).await?;
            let value = printable_config_value(value)?;
            print_json(value)?;
        }

        ConfigAction::Set {
            setting_id,
            value,
            json,
            yes,
        } => {
            let parsed_value = parse_config_value(&value);
            let response = commit_cli_config_operation(&setting_id, yes, |setting_id| {
                sparo_core::service::config::ConfigPatchOperation::Set {
                    setting_id,
                    value: parsed_value,
                }
            })
            .await?;
            if json {
                print_json(serde_json::json!({
                    "settingId": setting_id,
                    "commitId": response.commit_id,
                    "revision": response.revision,
                    "status": response.status,
                }))?;
            } else {
                for line in config_set_human_lines(&setting_id, &response) {
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

        ConfigAction::Reset {
            setting_id,
            json,
            yes,
        } => {
            let response = commit_cli_config_operation(&setting_id, yes, |setting_id| {
                sparo_core::service::config::ConfigPatchOperation::Reset { setting_id }
            })
            .await?;
            if json {
                print_json(serde_json::json!({
                    "settingId": setting_id,
                    "commitId": response.commit_id,
                    "revision": response.revision,
                    "status": response.status,
                }))?;
            } else {
                for line in config_reset_human_lines(&setting_id, &response) {
                    println!("{}", line);
                }
            }
        }

        ConfigAction::Export => {
            let runtime = initialize_cli_process_runtime().await?;
            let value = printable_config_value(runtime.config_service.export_config().await?)?;
            print_json(value)?;
        }

        ConfigAction::Import { file, json, yes } => {
            let runtime = initialize_cli_process_runtime().await?;
            let raw = std::fs::read_to_string(&file)
                .with_context(|| format!("Failed to read config export file: {}", file))?;
            let config = serde_json::from_str(strip_utf8_bom(&raw))
                .with_context(|| format!("Invalid config export JSON: {}", file))?;
            let snapshot = runtime.config_service.get_snapshot().await?;
            let response = runtime
                .config_service
                .import_config(
                    config,
                    snapshot.revision,
                    format!("cli-config-import-{}", uuid::Uuid::new_v4()),
                    yes,
                )
                .await?;
            let response = response.map(|commit| commit.published());
            if json {
                print_json(response)?;
            } else {
                for line in config_import_human_lines(&file, response.as_ref()) {
                    println!("{}", line);
                }
            }
        }

        ConfigAction::Validate { json } => {
            let runtime = initialize_cli_process_runtime().await?;
            let value = serde_json::to_value(runtime.config_service.validate_config().await?)?;
            if json {
                print_json(value)?;
            } else {
                for line in config_validate_human_lines(&value) {
                    println!("{}", line);
                }
            }
        }

        ConfigAction::Health { json } => {
            let status = match initialize_cli_process_runtime().await {
                Ok(runtime) => serde_json::to_value(runtime.config_service.health_check().await?)?,
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

#[derive(Debug, Clone, Serialize)]
struct CliIntelligentAppDetails {
    slot_id: String,
    slot_display_name: String,
    activation: Option<sparo_core::app_platform::ActivationRecord>,
    state: sparo_core::app_platform::AppVariantState,
    app: sparo_core::app_platform::AppRecord,
    releases: Vec<sparo_core::app_platform::ReleaseRecord>,
    latest_release: Option<sparo_core::app_platform::ReleaseRecord>,
    drafts: Vec<sparo_core::app_platform::DraftRecord>,
}

async fn load_intelligent_app_catalog() -> Result<CliIntelligentAppCatalog> {
    let _runtime = initialize_cli_process_runtime().await?;
    sparo_core::command::agentic_os::get_intelligent_app_catalog(IntelligentAppCatalogRequest {})
        .await
        .context("Failed to load authoritative Intelligent App catalog")
}

fn intelligent_app_details(
    catalog: &CliIntelligentAppCatalog,
    id_or_name: &str,
) -> Result<CliIntelligentAppDetails> {
    let exact_app_id = catalog.slots.iter().find_map(|slot| {
        slot.variants
            .iter()
            .find(|variant| variant.app.app_id.eq_ignore_ascii_case(id_or_name))
            .map(|variant| (slot, variant))
    });

    let selected = if let Some(selected) = exact_app_id {
        selected
    } else {
        let matches = catalog
            .slots
            .iter()
            .flat_map(|slot| {
                slot.variants.iter().filter_map(move |variant| {
                    (variant.app.display_name.eq_ignore_ascii_case(id_or_name)
                        || (slot.slot_id.eq_ignore_ascii_case(id_or_name)
                            && slot.variants.len() == 1))
                        .then_some((slot, variant))
                })
            })
            .collect::<Vec<_>>();
        match matches.as_slice() {
            [] => anyhow::bail!("Intelligent App not found: {id_or_name}"),
            [selected] => *selected,
            _ => {
                let ids = matches
                    .iter()
                    .map(|(_, variant)| variant.app.app_id.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                anyhow::bail!(
                    "Intelligent App name is ambiguous: {id_or_name}; use one of these app ids: {ids}"
                );
            }
        }
    };

    let (slot, variant) = selected;
    Ok(CliIntelligentAppDetails {
        slot_id: slot.slot_id.clone(),
        slot_display_name: slot.display_name.clone(),
        activation: slot.activation.clone(),
        state: variant.state,
        app: variant.app.clone(),
        releases: variant.releases.clone(),
        latest_release: variant.latest_release.clone(),
        drafts: catalog
            .drafts
            .iter()
            .filter(|draft| draft.app_id == variant.app.app_id)
            .cloned()
            .collect(),
    })
}

async fn handle_apps_action(action: AppsAction, json: bool) -> Result<()> {
    match action {
        AppsAction::List => {
            let catalog = load_intelligent_app_catalog().await?;
            if json {
                print_json(&catalog)?;
            } else {
                for line in apps_list_human_lines(&catalog) {
                    println!("{}", line);
                }
            }
        }
        AppsAction::Show { id } => {
            let catalog = load_intelligent_app_catalog().await?;
            let app = intelligent_app_details(&catalog, &id)?;
            if json {
                print_json(&app)?;
            } else {
                for line in app_human_detail_lines(&app) {
                    println!("{}", line);
                }
            }
        }
        AppsAction::Open { id } => {
            let catalog = load_intelligent_app_catalog().await?;
            let app = intelligent_app_details(&catalog, &id)?;
            anyhow::bail!(
                "CLI Intelligent App launch is unavailable for '{}' ({}): open Sparo Desktop Apps Center and launch it into a Work",
                app.app.display_name,
                app.app.app_id
            );
        }
    }
    Ok(())
}

fn apps_list_human_lines(catalog: &CliIntelligentAppCatalog) -> Vec<String> {
    if catalog.slots.is_empty() {
        let mut lines = vec![
            "No Intelligent Apps are available.".to_string(),
            "Create or fork one in Sparo Desktop Apps Center / App Builder.".to_string(),
            "Machine output: sparo apps list --json".to_string(),
        ];
        append_intelligent_app_sync_issues(&mut lines, catalog);
        return lines;
    }

    let variant_count = catalog
        .slots
        .iter()
        .map(|slot| slot.variants.len())
        .sum::<usize>();
    let mut lines = vec![
        format!(
            "Intelligent Apps ({} slots, {} variants)",
            catalog.slots.len(),
            variant_count
        ),
        String::new(),
    ];

    for slot in &catalog.slots {
        let activation_label = slot.activation.as_ref().map_or_else(
            || "not configured".to_string(),
            |activation| {
                format!(
                    "{} | app {} | release {}",
                    if activation.enabled {
                        "enabled"
                    } else {
                        "disabled"
                    },
                    activation.selected_app_id,
                    activation.active_release_id
                )
            },
        );
        lines.push(format!("{} | slot {}", slot.display_name, slot.slot_id));
        lines.push(format!("  activation: {activation_label}"));
        for variant in &slot.variants {
            let latest = variant.latest_release.as_ref().map_or_else(
                || "no release".to_string(),
                |release| format!("{} ({})", release.version, release.release_id),
            );
            lines.push(format!(
                "  - {} | {} | owner {} | latest {} | {} releases",
                variant.app.app_id,
                app_variant_state_label(variant.state),
                app_owner_label(&variant.app.owner),
                latest,
                variant.releases.len()
            ));
            if let Some(description) = variant
                .app
                .description
                .as_deref()
                .and_then(compact_description)
            {
                lines.push(format!("    {description}"));
            }
        }
        lines.push(String::new());
    }

    if let Some(app) = catalog.slots.first().and_then(|slot| slot.variants.first()) {
        let app_arg = shell_arg(&app.app.app_id);
        lines.push("Next actions:".to_string());
        lines.push(format!("  Inspect latest: sparo apps show {}", app_arg));
        lines.push(
            "  Launch: use Sparo Desktop Apps Center to create or resume a Work.".to_string(),
        );
        lines.push("  Machine output: sparo apps list --json".to_string());
    }
    append_intelligent_app_sync_issues(&mut lines, catalog);

    lines
}

fn append_intelligent_app_sync_issues(lines: &mut Vec<String>, catalog: &CliIntelligentAppCatalog) {
    if catalog.issues.is_empty() {
        return;
    }
    lines.push(String::new());
    lines.push(format!(
        "System App synchronization issues ({})",
        catalog.issues.len()
    ));
    for issue in &catalog.issues {
        lines.push(format!(
            "  - {}@{} | {} | {}",
            issue.app_id.as_deref().unwrap_or("system-components"),
            issue.version.as_deref().unwrap_or("current"),
            issue.source,
            issue.message
        ));
    }
}

fn app_human_detail_lines(details: &CliIntelligentAppDetails) -> Vec<String> {
    let app = &details.app;
    let app_arg = shell_arg(&app.app_id);
    let mut lines = vec![
        "Intelligent App Details".to_string(),
        String::new(),
        format!("Name: {}", app.display_name),
        format!("App ID: {}", app.app_id),
        format!("Slot ID: {}", details.slot_id),
        format!("Owner: {}", app_owner_label(&app.owner)),
        format!("State: {}", app_variant_state_label(details.state)),
        format!(
            "Description: {}",
            app.description.as_deref().unwrap_or("not provided")
        ),
        format!("Releases: {}", details.releases.len()),
        format!("Drafts: {}", details.drafts.len()),
        String::new(),
    ];

    if let Some(activation) = &details.activation {
        lines.push("Activation".to_string());
        lines.push(format!(
            "  Status: {}",
            if activation.enabled {
                "enabled"
            } else {
                "disabled"
            }
        ));
        lines.push(format!("  Selected app: {}", activation.selected_app_id));
        lines.push(format!(
            "  Active release: {}",
            activation.active_release_id
        ));
    } else {
        lines.push("Activation: not configured".to_string());
    }

    lines.push(String::new());
    lines.push("Immutable Releases".to_string());
    for release in &details.releases {
        lines.push(format!(
            "  {} | version {} | schema {} | config {} | provenance {:?}",
            release.release_id,
            release.version,
            release.data_schema_version,
            release.config_revision,
            release.provenance
        ));
    }
    lines.push(String::new());
    lines.push("Next actions:".to_string());
    lines.push(format!("  Inspect: sparo apps show {}", app_arg));
    lines.push("  Launch: use Sparo Desktop Apps Center to create or resume a Work.".to_string());
    lines
}

fn app_variant_state_label(state: sparo_core::app_platform::AppVariantState) -> &'static str {
    match state {
        sparo_core::app_platform::AppVariantState::Active => "active",
        sparo_core::app_platform::AppVariantState::Disabled => "disabled",
        sparo_core::app_platform::AppVariantState::Available => "available",
    }
}

fn app_owner_label(owner: &sparo_core::app_platform::AppOwner) -> String {
    let kind = match owner.kind {
        sparo_core::app_platform::AppOwnerKind::System => "system",
        sparo_core::app_platform::AppOwnerKind::User => "user",
        sparo_core::app_platform::AppOwnerKind::Organization => "organization",
    };
    owner
        .owner_id
        .as_deref()
        .map(|owner_id| format!("{kind}:{owner_id}"))
        .unwrap_or_else(|| kind.to_string())
}

async fn load_workspaces_snapshot(
) -> Result<Vec<sparo_core::command::agentic_os::AgenticOsWorkspaceRow>> {
    let snapshot = sparo_core::command::agentic_os::get_snapshot_without_config(
        sparo_core::command::agentic_os::AgenticOsSnapshotRequest {
            workspace_hint: None,
        },
    )
    .await?;
    Ok(snapshot.workspaces)
}

fn find_workspace_row<'a>(
    workspaces: &'a [sparo_core::command::agentic_os::AgenticOsWorkspaceRow],
    id_or_path: &str,
) -> Option<&'a sparo_core::command::agentic_os::AgenticOsWorkspaceRow> {
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
    workspaces: &[sparo_core::command::agentic_os::AgenticOsWorkspaceRow],
    id_or_path: &str,
) -> Option<sparo_core::command::agentic_os::AgenticOsWorkspaceRow> {
    find_workspace_row(workspaces, id_or_path)
        .cloned()
        .or_else(|| workspace_row_from_direct_path(id_or_path))
}

fn workspace_row_from_direct_path(
    id_or_path: &str,
) -> Option<sparo_core::command::agentic_os::AgenticOsWorkspaceRow> {
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
    Some(sparo_core::command::agentic_os::AgenticOsWorkspaceRow {
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
    workspaces: &[sparo_core::command::agentic_os::AgenticOsWorkspaceRow],
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
    workspace: &sparo_core::command::agentic_os::AgenticOsWorkspaceRow,
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
    workspace: &sparo_core::command::agentic_os::AgenticOsWorkspaceRow,
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
) -> Result<Vec<sparo_core::command::agentic_os::AgenticOsMemoryRow>> {
    let snapshot = sparo_core::command::agentic_os::get_snapshot_without_config(
        sparo_core::command::agentic_os::AgenticOsSnapshotRequest {
            workspace_hint: workspace,
        },
    )
    .await?;
    Ok(snapshot.memories)
}

fn memory_row_path(
    row: &sparo_core::command::agentic_os::AgenticOsMemoryRow,
) -> std::path::PathBuf {
    std::path::Path::new(&row.target).join(&row.file)
}

fn find_memory_row<'a>(
    memories: &'a [sparo_core::command::agentic_os::AgenticOsMemoryRow],
    id_or_path: &str,
) -> Option<&'a sparo_core::command::agentic_os::AgenticOsMemoryRow> {
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
    memory: &sparo_core::command::agentic_os::AgenticOsMemoryRow,
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
    memory: &sparo_core::command::agentic_os::AgenticOsMemoryRow,
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
    memories: &[sparo_core::command::agentic_os::AgenticOsMemoryRow],
    workspace: Option<&str>,
) -> Vec<String> {
    if memories.is_empty() {
        return vec![
            "No memory files are available in this snapshot.".to_string(),
            "Add durable context through chat or the Memory surface; run `sparo health` if memory is unavailable.".to_string(),
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
    memory: &sparo_core::command::agentic_os::AgenticOsMemoryRow,
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

fn tool_list_human_lines(tools: &[sparo_core::command::tool::ToolInfo]) -> Vec<String> {
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
    response: &sparo_core::command::tool::ExecuteToolResponse,
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
    response: &sparo_core::command::tool::ToolSchemaResponse,
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
    use sparo_core::command::tool as tool_command;

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
mod tests;
