use super::runtime::worker_protocol::{BridgeWorkerEnvelope, BridgeWorkerStartRequest};
use super::{
    BridgeAppCapability, BridgeAppConsumer, BridgeAppConsumerKind, BridgeAppEvent,
    BridgeAppManifest, BridgeAppPackage, BridgeAppRunStatus, BridgeAppRuntimeLanguage,
};
use crate::agentic::agents::{
    Agent, CustomSubagentConfig, PromptBuilder, PromptBuilderContext, RequestContextPolicy,
};
use crate::agentic::tools::implementations::bridge_app_runtime_tool_name;
use crate::infrastructure::get_path_manager_arc;
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use chrono::Utc;
use log::warn;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::any::Any;
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, LazyLock};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::RwLock;

pub const BRIDGE_APP_SCHEMA_VERSION: u32 = 1;
pub const BRIDGE_APP_MANIFEST: &str = "manifest.json";
const DEFAULT_BRIDGE_RUN_TIMEOUT_MS: u64 = 600_000;

static BRIDGE_RUN_REGISTRY: LazyLock<RwLock<HashMap<String, BridgeAppRun>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

pub struct BridgeAppAgent {
    manifest: BridgeAppManifest,
    path: String,
    tools: Vec<String>,
    prompt: String,
}

impl BridgeAppAgent {
    pub fn new(package: BridgeAppPackage) -> Self {
        let tools = package
            .manifest
            .tools
            .iter()
            .map(|tool| bridge_app_runtime_tool_name(&package.manifest.id, &tool.name))
            .collect::<Vec<_>>();
        let tool_list = tools.join(", ");
        let capability_list = package
            .manifest
            .capabilities
            .iter()
            .map(|capability| format!("{} ({})", capability.id, capability.title))
            .collect::<Vec<_>>()
            .join(", ");
        let prompt = format!(
            "You are {name}, a Bridge App-backed Agent in Sparo OS.\n\nUse only the Bridge App tools assigned to you: {tools}. Treat those tools as the product capability surface for the current workspace; do not describe yourself as unable to access the workspace just because access is mediated by the Bridge App. Do not call low-level workspace tools unless the user is explicitly debugging the integration.\n\nBefore starting external SDK, CLI, GUI, service, daemon, or MCP work, call the tool's health action when it is available or when setup, credentials, dependencies, permissions, or workspace binding may be missing. Use setup only when health indicates it is needed or the user asks for it, then use start for the actual task. If a Bridge action fails, do not retry the same action with the same input. Explain the exact failure surfaced by the tool, name the missing configuration if known, and ask only for the information needed to continue.\n\nBridge capabilities: {capabilities}.",
            name = package.manifest.name,
            tools = tool_list,
            capabilities = capability_list
        );
        Self {
            manifest: package.manifest,
            path: package.path,
            tools,
            prompt,
        }
    }

    pub fn path(&self) -> &str {
        &self.path
    }

    pub fn manifest(&self) -> &BridgeAppManifest {
        &self.manifest
    }
}

#[async_trait]
impl Agent for BridgeAppAgent {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn id(&self) -> &str {
        &self.manifest.id
    }

    fn name(&self) -> &str {
        self.manifest
            .tools
            .first()
            .and_then(|tool| {
                tool.ui
                    .as_ref()
                    .and_then(|ui| ui.get("card"))
                    .and_then(|card| card.get("displayName").or_else(|| card.get("title")))
                    .and_then(Value::as_str)
            })
            .unwrap_or(&self.manifest.name)
    }

    fn description(&self) -> &str {
        &self.manifest.description
    }

    fn prompt_template_name(&self, _model_name: Option<&str>) -> &str {
        ""
    }

    async fn build_prompt(&self, context: &PromptBuilderContext) -> BitFunResult<String> {
        PromptBuilder::new(context.clone())
            .build_prompt_from_template(&self.prompt)
            .await
    }

    fn request_context_policy(&self) -> RequestContextPolicy {
        RequestContextPolicy::default()
    }

    fn default_tools(&self) -> Vec<String> {
        self.tools.clone()
    }

    fn is_readonly(&self) -> bool {
        self.manifest.tools.iter().all(|tool| tool.readonly)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAppRunResult {
    pub app_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability_id: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAppRun {
    pub run_id: String,
    pub bridge_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability_id: Option<String>,
    pub action: String,
    pub consumer_kind: BridgeAppConsumerKind,
    pub consumer_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    pub status: BridgeAppRunStatus,
    pub started_at: i64,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_run_ref: Option<String>,
    #[serde(default)]
    pub artifacts: Vec<Value>,
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

fn normalize_consumer(mut consumer: BridgeAppConsumer) -> BridgeAppConsumer {
    if consumer.id.trim().is_empty() {
        consumer.id = match consumer.kind {
            BridgeAppConsumerKind::AgentApp => "agent-app".to_string(),
            BridgeAppConsumerKind::LiveApp | BridgeAppConsumerKind::LiveAppBackend => {
                "live-app".to_string()
            }
            BridgeAppConsumerKind::Management => "management".to_string(),
            BridgeAppConsumerKind::System => "system".to_string(),
        };
    }
    consumer
}

fn normalize_legacy_capabilities(manifest: &mut BridgeAppManifest) {
    if !manifest.capabilities.is_empty() || manifest.actions.is_empty() {
        return;
    }
    manifest.capabilities.push(BridgeAppCapability {
        id: format!("{}.default", manifest.id),
        title: manifest.name.clone(),
        description: manifest.description.clone(),
        category: format!("{:?}", manifest.kind).to_ascii_lowercase(),
        actions: manifest
            .actions
            .iter()
            .map(|action| action.name.clone())
            .collect(),
        streaming: manifest.actions.iter().any(|action| action.streaming),
        cancelable: manifest.actions.iter().any(|action| action.cancelable),
        resumable: manifest.actions.iter().any(|action| action.resumable),
        usable_by: vec![
            BridgeAppConsumerKind::AgentApp,
            BridgeAppConsumerKind::LiveAppBackend,
            BridgeAppConsumerKind::Management,
        ],
        input_schema: Value::Null,
        output_schema: Value::Null,
    });
}

fn validate_capability(
    manifest: &BridgeAppManifest,
    capability: &BridgeAppCapability,
) -> BitFunResult<()> {
    if capability.id.trim().is_empty() {
        return Err(BitFunError::validation(format!(
            "Bridge App '{}' has a capability with an empty id",
            manifest.id
        )));
    }
    if capability.actions.is_empty() {
        return Err(BitFunError::validation(format!(
            "Bridge capability '{}' must expose at least one action",
            capability.id
        )));
    }
    for action in &capability.actions {
        if !manifest.actions.iter().any(|decl| decl.name == *action) {
            return Err(BitFunError::validation(format!(
                "Bridge capability '{}' references undeclared action '{}'",
                capability.id, action
            )));
        }
    }
    Ok(())
}

fn validate_manifest_action(
    manifest: &BridgeAppManifest,
    capability_id: Option<&str>,
    action: &str,
) -> BitFunResult<()> {
    if let Some(capability_id) = capability_id {
        let capability = manifest
            .capabilities
            .iter()
            .find(|capability| capability.id == capability_id)
            .ok_or_else(|| {
                BitFunError::validation(format!(
                    "Bridge App '{}' does not expose capability '{}'",
                    manifest.id, capability_id
                ))
            })?;
        if !capability.actions.iter().any(|declared| declared == action) {
            return Err(BitFunError::validation(format!(
                "Bridge capability '{}' does not expose action '{}'",
                capability_id, action
            )));
        }
        return Ok(());
    }

    if manifest.actions.iter().any(|decl| decl.name == action) {
        return Ok(());
    }
    if manifest
        .capabilities
        .iter()
        .any(|capability| capability.actions.iter().any(|declared| declared == action))
    {
        return Ok(());
    }
    Err(BitFunError::validation(format!(
        "Bridge App '{}' does not expose action '{}'",
        manifest.id, action
    )))
}

fn summarize_bridge_failure_output(output: &Value) -> String {
    if let Some(message) = output
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .filter(|message| !message.trim().is_empty())
    {
        return message.trim().to_string();
    }
    if let Some(message) = output
        .get("message")
        .and_then(Value::as_str)
        .filter(|message| !message.trim().is_empty())
    {
        return message.trim().to_string();
    }
    match serde_json::to_string(output) {
        Ok(text) if text.len() > 300 => format!("{}...", &text[..300]),
        Ok(text) => text,
        Err(_) => "<unserializable output>".to_string(),
    }
}

fn runtime_shell_executable(
    language: BridgeAppRuntimeLanguage,
    package_manager: Option<&str>,
) -> &'static str {
    match language {
        BridgeAppRuntimeLanguage::JavaScript => "node",
        BridgeAppRuntimeLanguage::TypeScript => {
            if package_manager == Some("pnpm") {
                "pnpm"
            } else {
                "npx"
            }
        }
        BridgeAppRuntimeLanguage::Python => "python",
        BridgeAppRuntimeLanguage::Native => "native",
    }
}

fn validate_runtime_shell_permission(manifest: &BridgeAppManifest) -> BitFunResult<()> {
    let executable = runtime_shell_executable(
        manifest.runtime.language,
        manifest.runtime.package_manager.as_deref(),
    );
    if manifest
        .permissions
        .shell
        .iter()
        .any(|entry| entry == executable)
    {
        return Ok(());
    }
    Err(BitFunError::validation(format!(
        "Bridge App '{}' must declare '{}' in permissions.shell to start its runtime",
        manifest.id, executable
    )))
}

fn capability_for_run<'a>(
    manifest: &'a BridgeAppManifest,
    capability_id: Option<&str>,
    action: &str,
) -> Option<&'a BridgeAppCapability> {
    if let Some(capability_id) = capability_id {
        return manifest
            .capabilities
            .iter()
            .find(|capability| capability.id == capability_id);
    }
    manifest
        .capabilities
        .iter()
        .find(|capability| capability.actions.iter().any(|declared| declared == action))
}

fn validate_consumer_permission(
    manifest: &BridgeAppManifest,
    capability_id: Option<&str>,
    action: &str,
    consumer: &BridgeAppConsumer,
) -> BitFunResult<()> {
    let Some(capability) = capability_for_run(manifest, capability_id, action) else {
        return Ok(());
    };
    if capability.usable_by.is_empty() || capability.usable_by.contains(&consumer.kind) {
        return Ok(());
    }
    Err(BitFunError::validation(format!(
        "Bridge capability '{}' cannot be used by {:?}",
        capability.id, consumer.kind
    )))
}

fn validate_gui_permission(
    manifest: &BridgeAppManifest,
    capability_id: Option<&str>,
    action: &str,
) -> BitFunResult<()> {
    let capability = capability_for_run(manifest, capability_id, action);
    let requires_gui = matches!(manifest.kind, super::BridgeAppKind::Gui)
        || capability
            .map(|capability| capability.category.eq_ignore_ascii_case("gui"))
            .unwrap_or(false);
    if !requires_gui || !manifest.permissions.gui.is_empty() {
        return Ok(());
    }
    Err(BitFunError::validation(format!(
        "Bridge App '{}' requires explicit permissions.gui declarations for GUI capabilities",
        manifest.id
    )))
}

fn normalize_permission_path(path: &Path) -> BitFunResult<PathBuf> {
    if path.exists() {
        return Ok(path.canonicalize()?);
    }
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    Ok(absolute)
}

fn path_is_within(child: &Path, parent: &Path) -> bool {
    child == parent || child.starts_with(parent)
}

fn permission_scope_root(scope: &str, app_dir: &Path) -> Option<PathBuf> {
    match scope {
        "{app}" | "{appdata}" => Some(app_dir.to_path_buf()),
        "{home}" => std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from),
        _ => {
            let candidate = PathBuf::from(scope);
            if candidate.is_absolute() {
                Some(candidate)
            } else {
                None
            }
        }
    }
}

fn validate_workspace_permission(
    manifest: &BridgeAppManifest,
    app_dir: &Path,
    workspace_path: Option<&str>,
) -> BitFunResult<()> {
    let Some(workspace_path) = workspace_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
    else {
        return Ok(());
    };
    let workspace = normalize_permission_path(Path::new(workspace_path))?;
    if manifest
        .permissions
        .fs
        .iter()
        .any(|scope| scope == "{workspace}")
    {
        return Ok(());
    }
    for scope in &manifest.permissions.fs {
        let Some(root) = permission_scope_root(scope, app_dir) else {
            continue;
        };
        let root = normalize_permission_path(&root)?;
        if path_is_within(&workspace, &root) {
            return Ok(());
        }
    }
    Err(BitFunError::validation(format!(
        "Bridge App '{}' cannot access workspace '{}' because permissions.fs does not include '{{workspace}}' or a containing path",
        manifest.id,
        workspace.display()
    )))
}

fn collect_declared_secret_env(manifest: &BridgeAppManifest) -> Vec<(String, OsString)> {
    manifest
        .permissions
        .secrets
        .iter()
        .filter_map(|name| {
            let trimmed = name.trim();
            if trimmed.is_empty() {
                return None;
            }
            std::env::var_os(trimmed).map(|value| (trimmed.to_string(), value))
        })
        .collect()
}

async fn upsert_run(run: BridgeAppRun) {
    BRIDGE_RUN_REGISTRY
        .write()
        .await
        .insert(run.run_id.clone(), run);
}

async fn update_run_from_result(result: &BridgeAppRunResult) {
    let mut runs = BRIDGE_RUN_REGISTRY.write().await;
    let Some(run) = runs.get_mut(&result.run_id) else {
        return;
    };
    run.status = result.status;
    run.updated_at = Utc::now().timestamp_millis();
    run.events = result.events.clone();
    run.output = result.output.clone();
    run.stderr = result.stderr.clone();
    run.artifacts = result
        .events
        .iter()
        .filter_map(|event| match event {
            BridgeAppEvent::ArtifactCreated { artifact } => Some(artifact.clone()),
            _ => None,
        })
        .collect();
}

async fn append_run_event(run_id: &str, event: BridgeAppEvent) {
    let mut runs = BRIDGE_RUN_REGISTRY.write().await;
    let Some(run) = runs.get_mut(run_id) else {
        return;
    };
    run.updated_at = Utc::now().timestamp_millis();
    match &event {
        BridgeAppEvent::RunStatus { status, .. } => {
            run.status = *status;
        }
        BridgeAppEvent::RunCompleted { output } => {
            run.status = BridgeAppRunStatus::Completed;
            run.output = output.clone();
        }
        BridgeAppEvent::RunFailed { error } => {
            run.status = BridgeAppRunStatus::Failed;
            run.output = error.clone();
        }
        BridgeAppEvent::RunCancelled { .. } => {
            run.status = BridgeAppRunStatus::Cancelled;
        }
        BridgeAppEvent::ArtifactCreated { artifact } => {
            run.artifacts.push(artifact.clone());
        }
        _ => {}
    }
    run.events.push(event);
}

async fn update_run_output(run_id: &str, output: Value) {
    let mut runs = BRIDGE_RUN_REGISTRY.write().await;
    let Some(run) = runs.get_mut(run_id) else {
        return;
    };
    run.updated_at = Utc::now().timestamp_millis();
    run.output = output;
}

pub struct BridgeAppManager;

impl BridgeAppManager {
    pub fn seed_builtin_bridge_apps() -> BitFunResult<()> {
        super::builtin::seed_builtin_bridge_apps()
    }

    pub fn register_agent_surfaces() -> BitFunResult<Vec<String>> {
        let packages = Self::list()?;
        let registry = crate::agentic::agents::get_agent_registry();
        let mut registered = Vec::new();
        for package in packages {
            if !package.manifest.surfaces.agent || package.manifest.tools.is_empty() {
                continue;
            }
            let id = package.manifest.id.clone();
            registry.register_or_replace_agent_app(
                Arc::new(BridgeAppAgent::new(package)),
                CustomSubagentConfig {
                    enabled: true,
                    model: "primary".to_string(),
                },
            );
            registered.push(id);
        }
        Ok(registered)
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

    pub fn import_from_path(
        source_path: PathBuf,
        overwrite: bool,
    ) -> BitFunResult<BridgeAppPackage> {
        if !source_path.is_dir() {
            return Err(BitFunError::validation(format!(
                "Bridge App import path is not a directory: {}",
                source_path.display()
            )));
        }
        let source_manifest = source_path.join(BRIDGE_APP_MANIFEST);
        if !source_manifest.exists() {
            return Err(BitFunError::validation(format!(
                "Missing {} in Bridge App import path {}",
                BRIDGE_APP_MANIFEST,
                source_path.display()
            )));
        }

        let mut manifest: BridgeAppManifest = read_json_file(&source_manifest)?;
        Self::validate_manifest(&mut manifest)?;
        let dir = bridge_app_dir(&manifest.id);
        if dir.exists() {
            if !overwrite {
                return Err(BitFunError::validation(format!(
                    "Bridge App '{}' already exists",
                    manifest.id
                )));
            }
            let source = normalize_permission_path(&source_path)?;
            let target = normalize_permission_path(&dir)?;
            if source != target {
                std::fs::remove_dir_all(&dir)?;
            }
        }
        if !dir.exists() {
            std::fs::create_dir_all(&dir)?;
        }
        let source = normalize_permission_path(&source_path)?;
        let target = normalize_permission_path(&dir)?;
        if source != target {
            copy_dir_recursive(&source_path, &dir)?;
            write_json_file(&dir.join(BRIDGE_APP_MANIFEST), &manifest)?;
        }
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
        Self::run_capability_action(
            app_id,
            None,
            action,
            input,
            workspace_path,
            run_id,
            BridgeAppConsumer::default(),
        )
        .await
    }

    pub async fn run_capability_action(
        app_id: &str,
        capability_id: Option<&str>,
        action: &str,
        input: Value,
        workspace_path: Option<String>,
        run_id: String,
        consumer: BridgeAppConsumer,
    ) -> BitFunResult<BridgeAppRunResult> {
        let package = Self::get(app_id)?;
        validate_manifest_action(&package.manifest, capability_id, action)?;
        validate_runtime_shell_permission(&package.manifest)?;
        let app_dir = PathBuf::from(&package.path);
        let normalized_consumer = normalize_consumer(consumer);
        validate_consumer_permission(
            &package.manifest,
            capability_id,
            action,
            &normalized_consumer,
        )?;
        validate_gui_permission(&package.manifest, capability_id, action)?;
        validate_workspace_permission(&package.manifest, &app_dir, workspace_path.as_deref())?;
        let entry = app_dir.join(&package.manifest.runtime.entry);
        if !entry.exists() {
            return Err(BitFunError::NotFound(format!(
                "Bridge App runtime entry not found: {}",
                entry.display()
            )));
        }

        let started_at = Utc::now().timestamp_millis();
        let run = BridgeAppRun {
            run_id: run_id.clone(),
            bridge_id: app_id.to_string(),
            capability_id: capability_id.map(ToString::to_string),
            action: action.to_string(),
            consumer_kind: normalized_consumer.kind,
            consumer_id: normalized_consumer.id.clone(),
            workspace_path: workspace_path.clone(),
            status: BridgeAppRunStatus::Running,
            started_at,
            updated_at: started_at,
            external_run_ref: None,
            artifacts: Vec::new(),
            events: Vec::new(),
            output: Value::Null,
            stderr: None,
        };
        upsert_run(run).await;

        let request = BridgeWorkerStartRequest {
            bridge_id: app_id.to_string(),
            capability_id: capability_id.map(ToString::to_string),
            action: action.to_string(),
            run_id: Some(run_id.clone()),
            input,
            workspace_path,
            consumer: normalized_consumer,
        };
        let request_json = serde_json::to_vec(&request)?;
        let mut command = runtime_command(
            package.manifest.runtime.language,
            package.manifest.runtime.package_manager.as_deref(),
            &entry,
        );
        command.current_dir(&app_dir);
        for (name, value) in collect_declared_secret_env(&package.manifest) {
            command.env(name, value);
        }
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

        let stdout = child.stdout.take().ok_or_else(|| {
            BitFunError::ProcessError("Bridge App stdout was not piped".to_string())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            BitFunError::ProcessError("Bridge App stderr was not piped".to_string())
        })?;
        let stderr_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut text = String::new();
            reader.read_to_string(&mut text).await.map(|_| text)
        });

        let execution = async {
            let mut reader = BufReader::new(stdout).lines();
            let mut events = Vec::new();
            let mut final_output = None;
            let mut event_failed = false;

            while let Some(line) = reader.next_line().await? {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }

                if let Ok(event) = serde_json::from_str::<BridgeAppEvent>(line) {
                    capture_bridge_event_result(&event, &mut final_output, &mut event_failed);
                    append_run_event(&run_id, event.clone()).await;
                    events.push(event);
                    continue;
                }

                if let Ok(envelope) = serde_json::from_str::<BridgeWorkerEnvelope>(line) {
                    capture_bridge_event_result(
                        &envelope.event,
                        &mut final_output,
                        &mut event_failed,
                    );
                    append_run_event(&run_id, envelope.event.clone()).await;
                    events.push(envelope.event);
                    continue;
                }

                if let Ok(value) = serde_json::from_str::<Value>(line) {
                    update_run_output(&run_id, value.clone()).await;
                    final_output = Some(value);
                }
            }

            let exit_status = child.wait().await?;
            let stderr = stderr_task.await.map_err(|e| {
                BitFunError::ProcessError(format!("Failed to join Bridge App stderr task: {e}"))
            })??;
            Ok::<_, BitFunError>((exit_status, events, final_output, event_failed, stderr))
        };

        let (exit_status, events, final_output, event_failed, stderr) = tokio::time::timeout(
            std::time::Duration::from_millis(DEFAULT_BRIDGE_RUN_TIMEOUT_MS),
            execution,
        )
        .await
        .map_err(|_| BitFunError::Timeout("Bridge App run timed out".to_string()))??;

        let status = if !exit_status.success() || event_failed {
            BridgeAppRunStatus::Failed
        } else {
            BridgeAppRunStatus::Completed
        };

        let stderr = if stderr.trim().is_empty() {
            None
        } else {
            Some(stderr)
        };
        let result = BridgeAppRunResult {
            app_id: app_id.to_string(),
            capability_id: capability_id.map(ToString::to_string),
            action: action.to_string(),
            run_id: run_id.clone(),
            status,
            events: events.clone(),
            output: final_output.clone().unwrap_or(Value::Null),
            stderr,
        };
        if result.status == BridgeAppRunStatus::Failed {
            warn!(
                "Bridge App run failed: app_id={}, capability_id={:?}, action={}, run_id={}, stderr_present={}, output={}",
                result.app_id,
                result.capability_id,
                result.action,
                result.run_id,
                result
                    .stderr
                    .as_ref()
                    .is_some_and(|stderr| !stderr.trim().is_empty()),
                summarize_bridge_failure_output(&result.output)
            );
        }
        update_run_from_result(&result).await;
        Ok(result)
    }

    pub async fn start_run(
        app_id: &str,
        capability_id: Option<&str>,
        action: &str,
        input: Value,
        workspace_path: Option<String>,
        consumer: BridgeAppConsumer,
    ) -> BitFunResult<BridgeAppRunResult> {
        Self::run_capability_action(
            app_id,
            capability_id,
            action,
            input,
            workspace_path,
            format!("bridge-run-{}", uuid::Uuid::new_v4()),
            consumer,
        )
        .await
    }

    pub async fn get_run(run_id: &str) -> Option<BridgeAppRun> {
        BRIDGE_RUN_REGISTRY.read().await.get(run_id).cloned()
    }

    pub async fn list_runs(app_id: Option<&str>) -> Vec<BridgeAppRun> {
        let mut runs: Vec<_> = BRIDGE_RUN_REGISTRY
            .read()
            .await
            .values()
            .filter(|run| app_id.is_none_or(|id| run.bridge_id == id))
            .cloned()
            .collect();
        runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        runs
    }

    pub async fn stream_run_events(
        run_id: &str,
        after_index: Option<usize>,
    ) -> BitFunResult<Vec<BridgeAppEvent>> {
        let run = Self::get_run(run_id)
            .await
            .ok_or_else(|| BitFunError::NotFound(format!("Bridge run not found: {run_id}")))?;
        let start = after_index.unwrap_or(0).min(run.events.len());
        Ok(run.events[start..].to_vec())
    }

    pub async fn cancel_run(run_id: &str) -> BitFunResult<BridgeAppRun> {
        let mut runs = BRIDGE_RUN_REGISTRY.write().await;
        let run = runs
            .get_mut(run_id)
            .ok_or_else(|| BitFunError::NotFound(format!("Bridge run not found: {run_id}")))?;
        if matches!(
            run.status,
            BridgeAppRunStatus::Completed | BridgeAppRunStatus::Failed
        ) {
            return Ok(run.clone());
        }
        run.status = BridgeAppRunStatus::Cancelled;
        run.updated_at = Utc::now().timestamp_millis();
        run.events.push(BridgeAppEvent::RunCancelled {
            reason: serde_json::json!({ "message": "Cancelled by caller" }),
        });
        Ok(run.clone())
    }

    pub async fn get_artifacts(run_id: &str) -> BitFunResult<Vec<Value>> {
        Self::get_run(run_id)
            .await
            .map(|run| run.artifacts)
            .ok_or_else(|| BitFunError::NotFound(format!("Bridge run not found: {run_id}")))
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
        normalize_legacy_capabilities(manifest);
        for capability in &manifest.capabilities {
            validate_capability(manifest, capability)?;
        }
        for tool in &manifest.tools {
            if tool.name.trim().is_empty() {
                return Err(BitFunError::validation(
                    "Bridge App tool name cannot be empty",
                ));
            }
            validate_manifest_action(manifest, Some(&tool.capability_id), &tool.action)?;
            for action in &tool.actions {
                validate_manifest_action(manifest, Some(&tool.capability_id), action)?;
            }
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

fn copy_dir_recursive(source: &Path, target: &Path) -> BitFunResult<()> {
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if source_path.is_dir() {
            std::fs::create_dir_all(&target_path)?;
            copy_dir_recursive(&source_path, &target_path)?;
        } else if source_path.is_file() {
            if let Some(parent) = target_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(&source_path, &target_path)?;
        }
    }
    Ok(())
}

fn capture_bridge_event_result(
    event: &BridgeAppEvent,
    output: &mut Option<Value>,
    failed: &mut bool,
) {
    if let BridgeAppEvent::RunCompleted { output: value } = event {
        *output = Some(value.clone());
    }
    if let BridgeAppEvent::RunFailed { error } = event {
        *output = Some(error.clone());
        *failed = true;
    }
}
