use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::{collections::HashSet, process::Command, sync::OnceLock};

#[derive(Debug, Clone)]
pub struct CheckCommandResult {
    pub exists: bool,
    pub path: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CommandOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum SystemError {
    #[error("Command execution failed: {0}")]
    ExecutionFailed(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

pub fn check_command(cmd: &str) -> CheckCommandResult {
    match which::which(cmd) {
        Ok(path) => CheckCommandResult {
            exists: true,
            path: Some(path.to_string_lossy().to_string()),
        },
        Err(_) => {
            #[cfg(target_os = "macos")]
            {
                let mut merged = Vec::new();
                if let Some(existing) = std::env::var_os("PATH") {
                    merged.extend(std::env::split_paths(&existing));
                }
                merged.extend(platform_path_entries());

                if let Ok(joined) = std::env::join_paths(merged) {
                    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
                    if let Ok(path) = which::which_in(cmd, Some(joined), cwd) {
                        return CheckCommandResult {
                            exists: true,
                            path: Some(path.to_string_lossy().to_string()),
                        };
                    }
                }
            }

            CheckCommandResult {
                exists: false,
                path: None,
            }
        }
    }
}

pub async fn run_command(
    cmd: &str,
    args: &[String],
    cwd: Option<&str>,
    env: Option<&[(String, String)]>,
) -> Result<CommandOutput, SystemError> {
    let mut command = tokio::process::Command::new(cmd);

    command.args(args);

    if let Some(dir) = cwd {
        command.current_dir(dir);
    }

    if let Some(env_vars) = env {
        for (key, value) in env_vars {
            command.env(key, value);
        }
    }

    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());

    let output = command
        .output()
        .await
        .map_err(|e| SystemError::ExecutionFailed(e.to_string()))?;

    let exit_code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let success = output.status.success();

    Ok(CommandOutput {
        exit_code,
        stdout,
        stderr,
        success,
    })
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn platform_path_entries() -> Vec<PathBuf> {
    platform_path_entries_impl()
}

#[cfg(target_os = "macos")]
fn platform_path_entries_impl() -> Vec<PathBuf> {
    let candidates = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/opt/local/bin",
        "/opt/local/sbin",
    ];

    let mut entries: Vec<PathBuf> = candidates.iter().map(PathBuf::from).collect();
    entries.extend(homebrew_node_opt_bin_entries());
    entries.extend(login_shell_path_entries());

    dedup_existing_dirs(entries)
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn platform_path_entries_impl() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(target_os = "macos")]
static LOGIN_SHELL_PATH_ENTRIES: OnceLock<Vec<PathBuf>> = OnceLock::new();

#[cfg(target_os = "macos")]
fn login_shell_path_entries() -> Vec<PathBuf> {
    LOGIN_SHELL_PATH_ENTRIES
        .get_or_init(resolve_login_shell_path_entries)
        .clone()
}

#[cfg(target_os = "macos")]
fn resolve_login_shell_path_entries() -> Vec<PathBuf> {
    let mut shell_candidates = Vec::new();
    if let Ok(shell) = std::env::var("SHELL") {
        let shell = shell.trim();
        if !shell.is_empty() {
            shell_candidates.push(shell.to_string());
        }
    }
    shell_candidates.push("/bin/zsh".to_string());
    shell_candidates.push("/bin/bash".to_string());

    let mut seen = HashSet::new();
    for shell in shell_candidates {
        if !seen.insert(shell.clone()) {
            continue;
        }
        if let Some(path_value) = read_path_from_login_shell(&shell) {
            let entries: Vec<PathBuf> = std::env::split_paths(&path_value)
                .filter(|p| p.is_dir())
                .collect();
            if !entries.is_empty() {
                return dedup_existing_dirs(entries);
            }
        }
    }

    Vec::new()
}

#[cfg(target_os = "macos")]
fn homebrew_node_opt_bin_entries() -> Vec<PathBuf> {
    let opt_roots = ["/opt/homebrew/opt", "/usr/local/opt"];
    let mut entries = Vec::new();

    for root in opt_roots {
        let root_path = PathBuf::from(root);
        if !root_path.is_dir() {
            continue;
        }

        let node_bin = root_path.join("node").join("bin");
        if node_bin.is_dir() {
            entries.push(node_bin);
        }

        let read_dir = match std::fs::read_dir(&root_path) {
            Ok(v) => v,
            Err(_) => continue,
        };

        for entry in read_dir.flatten() {
            let entry_path = entry.path();
            if !entry_path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("node@") {
                continue;
            }

            let bin_dir = entry_path.join("bin");
            if bin_dir.is_dir() {
                entries.push(bin_dir);
            }
        }
    }

    dedup_existing_dirs(entries)
}

#[cfg(target_os = "macos")]
fn read_path_from_login_shell(shell: &str) -> Option<String> {
    let output = Command::new(shell)
        .arg("-lc")
        .arg("printf '%s' \"$PATH\"")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let path_value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path_value.is_empty() {
        None
    } else {
        Some(path_value)
    }
}

#[cfg(target_os = "macos")]
fn dedup_existing_dirs(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for path in paths {
        if !path.is_dir() {
            continue;
        }
        let key = path.to_string_lossy().to_string();
        if seen.insert(key) {
            deduped.push(path);
        }
    }
    deduped
}
