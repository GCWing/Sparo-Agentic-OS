use super::runtime::worker_protocol::{BridgeWorkerEnvelope, BridgeWorkerStartRequest};
use super::{
    BridgeAppEvent, BridgeAppManifest, BridgeAppPackage, BridgeAppRunStatus,
    BridgeAppRuntimeLanguage,
};
use crate::infrastructure::get_path_manager_arc;
use crate::util::errors::{BitFunError, BitFunResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

pub const BRIDGE_APP_SCHEMA_VERSION: u32 = 1;
pub const BRIDGE_APP_MANIFEST: &str = "manifest.json";
const DEFAULT_BRIDGE_RUN_TIMEOUT_MS: u64 = 600_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAppRunResult {
    pub app_id: String,
    pub action: String,
    pub run_id: String,
    pub status: BridgeAppRunStatus,
    #[serde(default)]
    pub events: Vec<BridgeAppEvent>,
    #[serde(default)]
    pub output: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
}

fn bridge_app_root() -> PathBuf {
    get_path_manager_arc().user_bridge_apps_dir()
}

fn bridge_app_dir(app_id: &str) -> PathBuf {
    bridge_app_root().join(app_id)
}

fn read_json_file<T: for<'de> serde::Deserialize<'de>>(path: &Path) -> BitFunResult<T> {
    let text = std::fs::read_to_string(path)?;
    serde_json::from_str(&text).map_err(BitFunError::from)
}

fn write_json_file<T: serde::Serialize>(path: &Path, value: &T) -> BitFunResult<()> {
    let text = serde_json::to_string_pretty(value)?;
    std::fs::write(path, format!("{text}\n"))?;
    Ok(())
}

pub struct BridgeAppManager;

impl BridgeAppManager {
    pub fn seed_builtin_bridge_apps() -> BitFunResult<()> {
        super::builtin::seed_builtin_bridge_apps()
    }

    pub fn app_dir(app_id: &str) -> PathBuf {
        bridge_app_dir(app_id)
    }

    pub fn list() -> BitFunResult<Vec<BridgeAppPackage>> {
        let _ = Self::seed_builtin_bridge_apps();
        let root = bridge_app_root();
        if !root.exists() {
            return Ok(Vec::new());
        }

        let mut packages = Vec::new();
        for entry in std::fs::read_dir(root)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Ok(package) = Self::load_package_from_dir(&path) {
                packages.push(package);
            }
        }
        packages.sort_by(|a, b| {
            a.manifest
                .name
                .to_lowercase()
                .cmp(&b.manifest.name.to_lowercase())
        });
        Ok(packages)
    }

    pub fn get(app_id: &str) -> BitFunResult<BridgeAppPackage> {
        let dir = bridge_app_dir(app_id);
        if dir.join(BRIDGE_APP_MANIFEST).exists() {
            return Self::load_package_from_dir(&dir);
        }
        Err(BitFunError::NotFound(format!(
            "Bridge App not found: {app_id}"
        )))
    }

    pub fn create_or_update(
        mut manifest: BridgeAppManifest,
        overwrite: bool,
    ) -> BitFunResult<BridgeAppPackage> {
        Self::validate_manifest(&mut manifest)?;
        let dir = bridge_app_dir(&manifest.id);
        if dir.exists() && !overwrite {
            return Err(BitFunError::validation(format!(
                "Bridge App '{}' already exists",
                manifest.id
            )));
        }
        std::fs::create_dir_all(&dir)?;
        write_json_file(&dir.join(BRIDGE_APP_MANIFEST), &manifest)?;
        Self::load_package_from_dir(&dir)
    }

    pub fn delete(app_id: &str) -> BitFunResult<()> {
        let dir = bridge_app_dir(app_id);
        if !dir.exists() {
            return Err(BitFunError::NotFound(format!(
                "Bridge App not found: {app_id}"
            )));
        }
        std::fs::remove_dir_all(dir)?;
        Ok(())
    }

    pub async fn run_action(
        app_id: &str,
        action: &str,
        input: Value,
        workspace_path: Option<String>,
        run_id: String,
    ) -> BitFunResult<BridgeAppRunResult> {
        let package = Self::get(app_id)?;
        let action_decl = package
            .manifest
            .actions
            .iter()
            .find(|decl| decl.name == action)
            .ok_or_else(|| {
                BitFunError::validation(format!(
                    "Bridge App '{}' does not expose action '{}'",
                    app_id, action
                ))
            })?;
        let app_dir = PathBuf::from(&package.path);
        let entry = app_dir.join(&package.manifest.runtime.entry);
        if !entry.exists() {
            return Err(BitFunError::NotFound(format!(
                "Bridge App runtime entry not found: {}",
                entry.display()
            )));
        }

        let request = BridgeWorkerStartRequest {
            app_id: app_id.to_string(),
            action: action.to_string(),
            input,
            workspace_path,
        };
        let request_json = serde_json::to_vec(&request)?;
        let mut command = runtime_command(
            package.manifest.runtime.language,
            package.manifest.runtime.package_manager.as_deref(),
            &entry,
        );
        command.current_dir(&app_dir);
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|e| BitFunError::ProcessError(format!("Failed to start Bridge App: {e}")))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(&request_json).await?;
            stdin.write_all(b"\n").await?;
            stdin.shutdown().await?;
        }

        let output = tokio::time::timeout(
            std::time::Duration::from_millis(DEFAULT_BRIDGE_RUN_TIMEOUT_MS),
            child.wait_with_output(),
        )
        .await
        .map_err(|_| BitFunError::Timeout("Bridge App run timed out".to_string()))??;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let (events, final_output, event_failed) = parse_bridge_stdout(&stdout);
        let status = if !output.status.success() || event_failed {
            BridgeAppRunStatus::Failed
        } else {
            BridgeAppRunStatus::Completed
        };

        Ok(BridgeAppRunResult {
            app_id: app_id.to_string(),
            action: action_decl.name.clone(),
            run_id,
            status,
            events,
            output: final_output.unwrap_or(Value::Null),
            stderr: if stderr.trim().is_empty() {
                None
            } else {
                Some(stderr)
            },
        })
    }

    pub fn validate_manifest(manifest: &mut BridgeAppManifest) -> BitFunResult<()> {
        if manifest.schema_version == 0 {
            manifest.schema_version = BRIDGE_APP_SCHEMA_VERSION;
        }
        if manifest.schema_version != BRIDGE_APP_SCHEMA_VERSION {
            return Err(BitFunError::validation(format!(
                "Unsupported Bridge App schema version: {}",
                manifest.schema_version
            )));
        }
        validate_bridge_app_id(&manifest.id)?;
        if manifest.name.trim().is_empty() {
            return Err(BitFunError::validation("Bridge App name cannot be empty"));
        }
        if manifest.description.trim().is_empty() {
            return Err(BitFunError::validation(
                "Bridge App description cannot be empty",
            ));
        }
        if manifest.runtime.entry.trim().is_empty()
            || Path::new(&manifest.runtime.entry).is_absolute()
            || Path::new(&manifest.runtime.entry)
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(BitFunError::validation(
                "Bridge App runtime entry must be a relative path inside the Bridge App",
            ));
        }
        Ok(())
    }

    fn load_package_from_dir(dir: &Path) -> BitFunResult<BridgeAppPackage> {
        let mut manifest: BridgeAppManifest = read_json_file(&dir.join(BRIDGE_APP_MANIFEST))?;
        Self::validate_manifest(&mut manifest)?;
        Ok(BridgeAppPackage {
            manifest,
            path: dir.to_string_lossy().to_string(),
        })
    }
}

pub fn validate_bridge_app_id(id: &str) -> BitFunResult<()> {
    if id.is_empty() {
        return Err(BitFunError::validation("Bridge App id cannot be empty"));
    }
    let mut chars = id.chars();
    if !chars.next().is_some_and(|c| c.is_ascii_alphabetic()) {
        return Err(BitFunError::validation(
            "Bridge App id must start with an ASCII letter",
        ));
    }
    for c in chars {
        if !c.is_ascii_alphanumeric() && c != '-' && c != '_' {
            return Err(BitFunError::validation(
                "Bridge App id can only contain ASCII letters, numbers, -, _",
            ));
        }
    }
    Ok(())
}

fn runtime_command(
    language: BridgeAppRuntimeLanguage,
    package_manager: Option<&str>,
    entry: &Path,
) -> Command {
    match language {
        BridgeAppRuntimeLanguage::JavaScript => {
            let mut command = Command::new("node");
            command.arg(entry);
            command
        }
        BridgeAppRuntimeLanguage::TypeScript => {
            if package_manager == Some("pnpm") {
                let mut command = Command::new("pnpm");
                command.args(["exec", "tsx"]);
                command.arg(entry);
                command
            } else {
                let mut command = Command::new("npx");
                command.args(["tsx"]);
                command.arg(entry);
                command
            }
        }
        BridgeAppRuntimeLanguage::Python => {
            let mut command = Command::new("python");
            command.arg(entry);
            command
        }
        BridgeAppRuntimeLanguage::Native => Command::new(entry),
    }
}

fn parse_bridge_stdout(stdout: &str) -> (Vec<BridgeAppEvent>, Option<Value>, bool) {
    let mut events = Vec::new();
    let mut output = None;
    let mut failed = false;

    for line in stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if let Ok(event) = serde_json::from_str::<BridgeAppEvent>(line) {
            capture_bridge_event_result(&event, &mut output, &mut failed);
            events.push(event);
            continue;
        }

        if let Ok(envelope) = serde_json::from_str::<BridgeWorkerEnvelope>(line) {
            capture_bridge_event_result(&envelope.event, &mut output, &mut failed);
            events.push(envelope.event);
            continue;
        }

        if let Ok(value) = serde_json::from_str::<Value>(line) {
            output = Some(value);
        }
    }

    (events, output, failed)
}

fn capture_bridge_event_result(
    event: &BridgeAppEvent,
    output: &mut Option<Value>,
    failed: &mut bool,
) {
    if let BridgeAppEvent::RunCompleted { output: value } = event {
        *output = Some(value.clone());
    }
    if matches!(event, BridgeAppEvent::RunFailed { .. }) {
        *failed = true;
    }
}
