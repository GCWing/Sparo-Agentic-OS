use super::runtime::worker_protocol::{BridgeWorkerEnvelope, BridgeWorkerStartRequest};
use super::{
    BridgeComponentCapability, BridgeComponentConsumer, BridgeComponentConsumerKind,
    BridgeComponentEvent, BridgeComponentManifest, BridgeComponentPackage,
    BridgeComponentRunStatus, BridgeComponentRuntimeLanguage,
};
use crate::agentic::agents::{
    Agent, CustomSubagentConfig, PromptBuilder, PromptBuilderContext, RequestContextPolicy,
};
use crate::agentic::tools::implementations::bridge_component_runtime_tool_name;
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
use std::sync::{Arc, LazyLock, RwLock as StdRwLock};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::RwLock;

pub const BRIDGE_COMPONENT_SCHEMA_VERSION: u32 = 1;
pub const BRIDGE_COMPONENT_MANIFEST: &str = "manifest.json";
const DEFAULT_BRIDGE_RUN_TIMEOUT_MS: u64 = 600_000;

static BRIDGE_RUN_REGISTRY: LazyLock<RwLock<HashMap<String, BridgeComponentRun>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));
static PRIVATE_BRIDGE_COMPONENT_DIRS: LazyLock<StdRwLock<HashMap<String, PathBuf>>> =
    LazyLock::new(|| StdRwLock::new(HashMap::new()));

pub struct BridgeComponentAgent {
    manifest: BridgeComponentManifest,
    path: String,
    tools: Vec<String>,
    prompt: String,
}

impl BridgeComponentAgent {
    pub fn new(package: BridgeComponentPackage) -> Self {
        let tools = package
            .manifest
            .tools
            .iter()
            .map(|tool| bridge_component_runtime_tool_name(&package.manifest.id, &tool.name))
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
            "You are {name}, a Bridge Component-backed Agent in Sparo OS.\n\nUse only the Bridge Component tools assigned to you: {tools}. Treat those tools as the product capability surface for the current workspace; do not describe yourself as unable to access the workspace just because access is mediated by the Bridge Component. Do not call low-level workspace tools unless the user is explicitly debugging the integration.\n\nBefore starting external SDK, CLI, GUI, service, daemon, or MCP work, call the tool's health action when it is available or when setup, credentials, dependencies, permissions, or workspace binding may be missing. Use setup only when health indicates it is needed or the user asks for it, then use start for the actual task. If a Bridge action fails, do not retry the same action with the same input. Explain the exact failure surfaced by the tool, name the missing configuration if known, and ask only for the information needed to continue.\n\nBridge capabilities: {capabilities}.",
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

    pub fn manifest(&self) -> &BridgeComponentManifest {
        &self.manifest
    }
}

#[async_trait]
impl Agent for BridgeComponentAgent {
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
pub struct BridgeComponentRunResult {
    pub component_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability_id: Option<String>,
    pub action: String,
    pub run_id: String,
    pub status: BridgeComponentRunStatus,
    #[serde(default)]
    pub events: Vec<BridgeComponentEvent>,
    #[serde(default)]
    pub output: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeComponentRun {
    pub run_id: String,
    pub bridge_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability_id: Option<String>,
    pub action: String,
    pub consumer_kind: BridgeComponentConsumerKind,
    pub consumer_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    pub status: BridgeComponentRunStatus,
    pub started_at: i64,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_run_ref: Option<String>,
    #[serde(default)]
    pub artifacts: Vec<Value>,
    #[serde(default)]
    pub events: Vec<BridgeComponentEvent>,
    #[serde(default)]
    pub output: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
}

fn bridge_component_root() -> PathBuf {
    get_path_manager_arc().user_bridge_components_dir()
}

fn bridge_component_dir(app_id: &str) -> PathBuf {
    bridge_component_root().join(app_id)
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

fn normalize_consumer(mut consumer: BridgeComponentConsumer) -> BridgeComponentConsumer {
    if consumer.id.trim().is_empty() {
        consumer.id = match consumer.kind {
            BridgeComponentConsumerKind::AgentComponent => "agent-component".to_string(),
            BridgeComponentConsumerKind::ProductAppRuntime => "product-app-runtime".to_string(),
            BridgeComponentConsumerKind::Management => "management".to_string(),
            BridgeComponentConsumerKind::System => "system".to_string(),
        };
    }
    consumer
}

fn validate_capability(
    manifest: &BridgeComponentManifest,
    capability: &BridgeComponentCapability,
) -> BitFunResult<()> {
    if capability.id.trim().is_empty() {
        return Err(BitFunError::validation(format!(
            "Bridge Component '{}' has a capability with an empty id",
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
    manifest: &BridgeComponentManifest,
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
                    "Bridge Component '{}' does not expose capability '{}'",
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
        "Bridge Component '{}' does not expose action '{}'",
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
    language: BridgeComponentRuntimeLanguage,
    package_manager: Option<&str>,
) -> &'static str {
    match language {
        BridgeComponentRuntimeLanguage::JavaScript => "node",
        BridgeComponentRuntimeLanguage::TypeScript => {
            if package_manager == Some("pnpm") {
                "pnpm"
            } else {
                "npx"
            }
        }
        BridgeComponentRuntimeLanguage::Python => "python",
        BridgeComponentRuntimeLanguage::Native => "native",
    }
}

fn validate_runtime_shell_permission(manifest: &BridgeComponentManifest) -> BitFunResult<()> {
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
        "Bridge Component '{}' must declare '{}' in permissions.shell to start its runtime",
        manifest.id, executable
    )))
}

fn capability_for_run<'a>(
    manifest: &'a BridgeComponentManifest,
    capability_id: Option<&str>,
    action: &str,
) -> Option<&'a BridgeComponentCapability> {
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
    manifest: &BridgeComponentManifest,
    capability_id: Option<&str>,
    action: &str,
    consumer: &BridgeComponentConsumer,
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
    manifest: &BridgeComponentManifest,
    capability_id: Option<&str>,
    action: &str,
) -> BitFunResult<()> {
    let capability = capability_for_run(manifest, capability_id, action);
    let requires_gui = matches!(manifest.kind, super::BridgeComponentKind::Gui)
        || capability
            .map(|capability| capability.category.eq_ignore_ascii_case("gui"))
            .unwrap_or(false);
    if !requires_gui || !manifest.permissions.gui.is_empty() {
        return Ok(());
    }
    Err(BitFunError::validation(format!(
        "Bridge Component '{}' requires explicit permissions.gui declarations for GUI capabilities",
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
    manifest: &BridgeComponentManifest,
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
        "Bridge Component '{}' cannot access workspace '{}' because permissions.fs does not include '{{workspace}}' or a containing path",
        manifest.id,
        workspace.display()
    )))
}

fn collect_declared_secret_env(manifest: &BridgeComponentManifest) -> Vec<(String, OsString)> {
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

async fn upsert_run(run: BridgeComponentRun) {
    BRIDGE_RUN_REGISTRY
        .write()
        .await
        .insert(run.run_id.clone(), run);
}

async fn update_run_from_result(result: &BridgeComponentRunResult) {
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
            BridgeComponentEvent::ArtifactCreated { artifact } => Some(artifact.clone()),
            _ => None,
        })
        .collect();
}

async fn append_run_event(run_id: &str, event: BridgeComponentEvent) {
    let mut runs = BRIDGE_RUN_REGISTRY.write().await;
    let Some(run) = runs.get_mut(run_id) else {
        return;
    };
    run.updated_at = Utc::now().timestamp_millis();
    match &event {
        BridgeComponentEvent::RunStatus { status, .. } => {
            run.status = *status;
        }
        BridgeComponentEvent::RunCompleted { output } => {
            run.status = BridgeComponentRunStatus::Completed;
            run.output = output.clone();
        }
        BridgeComponentEvent::RunFailed { error } => {
            run.status = BridgeComponentRunStatus::Failed;
            run.output = error.clone();
        }
        BridgeComponentEvent::RunCancelled { .. } => {
            run.status = BridgeComponentRunStatus::Cancelled;
        }
        BridgeComponentEvent::ArtifactCreated { artifact } => {
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

pub struct BridgeComponentManager;

impl BridgeComponentManager {
    pub fn seed_builtin_bridge_components() -> BitFunResult<()> {
        super::builtin::seed_builtin_bridge_components()
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
            registry.register_or_replace_agent_component(
                Arc::new(BridgeComponentAgent::new(package)),
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
        bridge_component_dir(app_id)
    }

    pub fn register_private_package_dir(
        component_id: &str,
        package_dir: PathBuf,
    ) -> BitFunResult<()> {
        let package = Self::load_package_from_dir(&package_dir)?;
        if package.manifest.id != component_id {
            return Err(BitFunError::validation(format!(
                "Private Bridge Component package id '{}' does not match component '{}'",
                package.manifest.id, component_id
            )));
        }
        let mut guard = PRIVATE_BRIDGE_COMPONENT_DIRS
            .write()
            .map_err(|_| BitFunError::service("Private Bridge Component registry poisoned"))?;
        guard.insert(component_id.to_string(), package_dir);
        Ok(())
    }

    fn private_package_dir(component_id: &str) -> Option<PathBuf> {
        PRIVATE_BRIDGE_COMPONENT_DIRS
            .read()
            .ok()
            .and_then(|guard| guard.get(component_id).cloned())
    }

    pub fn list() -> BitFunResult<Vec<BridgeComponentPackage>> {
        let _ = Self::seed_builtin_bridge_components();
        let root = bridge_component_root();
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

    pub fn get(app_id: &str) -> BitFunResult<BridgeComponentPackage> {
        if let Some(dir) = Self::private_package_dir(app_id) {
            if dir.join(BRIDGE_COMPONENT_MANIFEST).exists() {
                return Self::load_package_from_dir(&dir);
            }
        }
        if let Err(error) = super::builtin::ensure_builtin_bridge_component_current(app_id) {
            log::warn!(
                "refresh built-in Bridge Component '{}' failed: {}",
                app_id,
                error
            );
        }
        let dir = bridge_component_dir(app_id);
        if dir.join(BRIDGE_COMPONENT_MANIFEST).exists() {
            return Self::load_package_from_dir(&dir);
        }
        Err(BitFunError::NotFound(format!(
            "Bridge Component not found: {app_id}"
        )))
    }

    pub fn create_or_update(
        mut manifest: BridgeComponentManifest,
        overwrite: bool,
    ) -> BitFunResult<BridgeComponentPackage> {
        Self::validate_manifest(&mut manifest)?;
        let dir = bridge_component_dir(&manifest.id);
        if dir.exists() && !overwrite {
            return Err(BitFunError::validation(format!(
                "Bridge Component '{}' already exists",
                manifest.id
            )));
        }
        std::fs::create_dir_all(&dir)?;
        write_json_file(&dir.join(BRIDGE_COMPONENT_MANIFEST), &manifest)?;
        Self::load_package_from_dir(&dir)
    }

    pub fn import_from_path(
        source_path: PathBuf,
        overwrite: bool,
    ) -> BitFunResult<BridgeComponentPackage> {
        if !source_path.is_dir() {
            return Err(BitFunError::validation(format!(
                "Bridge Component import path is not a directory: {}",
                source_path.display()
            )));
        }
        let source_manifest = source_path.join(BRIDGE_COMPONENT_MANIFEST);
        if !source_manifest.exists() {
            return Err(BitFunError::validation(format!(
                "Missing {} in Bridge Component import path {}",
                BRIDGE_COMPONENT_MANIFEST,
                source_path.display()
            )));
        }

        let mut manifest: BridgeComponentManifest = read_json_file(&source_manifest)?;
        Self::validate_manifest(&mut manifest)?;
        let dir = bridge_component_dir(&manifest.id);
        if dir.exists() {
            if !overwrite {
                return Err(BitFunError::validation(format!(
                    "Bridge Component '{}' already exists",
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
            write_json_file(&dir.join(BRIDGE_COMPONENT_MANIFEST), &manifest)?;
        }
        Self::load_package_from_dir(&dir)
    }

    pub fn delete(app_id: &str) -> BitFunResult<()> {
        let dir = bridge_component_dir(app_id);
        if !dir.exists() {
            return Err(BitFunError::NotFound(format!(
                "Bridge Component not found: {app_id}"
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
    ) -> BitFunResult<BridgeComponentRunResult> {
        Self::run_capability_action(
            app_id,
            None,
            action,
            input,
            workspace_path,
            run_id,
            BridgeComponentConsumer::default(),
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
        consumer: BridgeComponentConsumer,
    ) -> BitFunResult<BridgeComponentRunResult> {
        let package = Self::get(app_id)?;
        Self::run_capability_action_with_package(
            app_id,
            package,
            capability_id,
            action,
            input,
            workspace_path,
            run_id,
            consumer,
        )
        .await
    }

    pub async fn run_capability_action_from_package_dir(
        package_dir: &Path,
        capability_id: Option<&str>,
        action: &str,
        input: Value,
        workspace_path: Option<String>,
        run_id: String,
        consumer: BridgeComponentConsumer,
    ) -> BitFunResult<BridgeComponentRunResult> {
        let package = Self::load_package_from_dir(package_dir)?;
        let app_id = package.manifest.id.clone();
        Self::run_capability_action_with_package(
            &app_id,
            package,
            capability_id,
            action,
            input,
            workspace_path,
            run_id,
            consumer,
        )
        .await
    }

    async fn run_capability_action_with_package(
        app_id: &str,
        package: BridgeComponentPackage,
        capability_id: Option<&str>,
        action: &str,
        input: Value,
        workspace_path: Option<String>,
        run_id: String,
        consumer: BridgeComponentConsumer,
    ) -> BitFunResult<BridgeComponentRunResult> {
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
                "Bridge Component runtime entry not found: {}",
                entry.display()
            )));
        }

        let started_at = Utc::now().timestamp_millis();
        let run = BridgeComponentRun {
            run_id: run_id.clone(),
            bridge_id: app_id.to_string(),
            capability_id: capability_id.map(ToString::to_string),
            action: action.to_string(),
            consumer_kind: normalized_consumer.kind,
            consumer_id: normalized_consumer.id.clone(),
            workspace_path: workspace_path.clone(),
            status: BridgeComponentRunStatus::Running,
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

        let mut child = command.spawn().map_err(|e| {
            BitFunError::ProcessError(format!("Failed to start Bridge Component: {e}"))
        })?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(&request_json).await?;
            stdin.write_all(b"\n").await?;
            stdin.shutdown().await?;
        }

        let stdout = child.stdout.take().ok_or_else(|| {
            BitFunError::ProcessError("Bridge Component stdout was not piped".to_string())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            BitFunError::ProcessError("Bridge Component stderr was not piped".to_string())
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

                if let Ok(event) = serde_json::from_str::<BridgeComponentEvent>(line) {
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
                BitFunError::ProcessError(format!(
                    "Failed to join Bridge Component stderr task: {e}"
                ))
            })??;
            Ok::<_, BitFunError>((exit_status, events, final_output, event_failed, stderr))
        };

        let (exit_status, events, final_output, event_failed, stderr) = tokio::time::timeout(
            std::time::Duration::from_millis(DEFAULT_BRIDGE_RUN_TIMEOUT_MS),
            execution,
        )
        .await
        .map_err(|_| BitFunError::Timeout("Bridge Component run timed out".to_string()))??;

        let status = if !exit_status.success() || event_failed {
            BridgeComponentRunStatus::Failed
        } else {
            BridgeComponentRunStatus::Completed
        };

        let stderr = if stderr.trim().is_empty() {
            None
        } else {
            Some(stderr)
        };
        let result = BridgeComponentRunResult {
            component_id: app_id.to_string(),
            capability_id: capability_id.map(ToString::to_string),
            action: action.to_string(),
            run_id: run_id.clone(),
            status,
            events: events.clone(),
            output: final_output.clone().unwrap_or(Value::Null),
            stderr,
        };
        if result.status == BridgeComponentRunStatus::Failed {
            warn!(
                "Bridge Component run failed: component_id={}, capability_id={:?}, action={}, run_id={}, stderr_present={}, output={}",
                result.component_id,
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
        consumer: BridgeComponentConsumer,
    ) -> BitFunResult<BridgeComponentRunResult> {
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

    pub async fn start_run_from_package_dir(
        package_dir: &Path,
        capability_id: Option<&str>,
        action: &str,
        input: Value,
        workspace_path: Option<String>,
        consumer: BridgeComponentConsumer,
    ) -> BitFunResult<BridgeComponentRunResult> {
        Self::run_capability_action_from_package_dir(
            package_dir,
            capability_id,
            action,
            input,
            workspace_path,
            format!("bridge-run-{}", uuid::Uuid::new_v4()),
            consumer,
        )
        .await
    }

    pub async fn get_run(run_id: &str) -> Option<BridgeComponentRun> {
        BRIDGE_RUN_REGISTRY.read().await.get(run_id).cloned()
    }

    pub async fn list_runs(app_id: Option<&str>) -> Vec<BridgeComponentRun> {
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
    ) -> BitFunResult<Vec<BridgeComponentEvent>> {
        let run = Self::get_run(run_id)
            .await
            .ok_or_else(|| BitFunError::NotFound(format!("Bridge run not found: {run_id}")))?;
        let start = after_index.unwrap_or(0).min(run.events.len());
        Ok(run.events[start..].to_vec())
    }

    pub async fn cancel_run(run_id: &str) -> BitFunResult<BridgeComponentRun> {
        let mut runs = BRIDGE_RUN_REGISTRY.write().await;
        let run = runs
            .get_mut(run_id)
            .ok_or_else(|| BitFunError::NotFound(format!("Bridge run not found: {run_id}")))?;
        if matches!(
            run.status,
            BridgeComponentRunStatus::Completed | BridgeComponentRunStatus::Failed
        ) {
            return Ok(run.clone());
        }
        run.status = BridgeComponentRunStatus::Cancelled;
        run.updated_at = Utc::now().timestamp_millis();
        run.events.push(BridgeComponentEvent::RunCancelled {
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

    pub fn validate_manifest(manifest: &mut BridgeComponentManifest) -> BitFunResult<()> {
        if manifest.schema_version == 0 {
            manifest.schema_version = BRIDGE_COMPONENT_SCHEMA_VERSION;
        }
        if manifest.schema_version != BRIDGE_COMPONENT_SCHEMA_VERSION {
            return Err(BitFunError::validation(format!(
                "Unsupported Bridge Component schema version: {}",
                manifest.schema_version
            )));
        }
        validate_bridge_component_id(&manifest.id)?;
        if manifest.name.trim().is_empty() {
            return Err(BitFunError::validation(
                "Bridge Component name cannot be empty",
            ));
        }
        if manifest.description.trim().is_empty() {
            return Err(BitFunError::validation(
                "Bridge Component description cannot be empty",
            ));
        }
        if manifest.runtime.entry.trim().is_empty()
            || Path::new(&manifest.runtime.entry).is_absolute()
            || Path::new(&manifest.runtime.entry)
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(BitFunError::validation(
                "Bridge Component runtime entry must be a relative path inside the Bridge Component",
            ));
        }
        if manifest.capabilities.is_empty() {
            return Err(BitFunError::validation(format!(
                "Bridge Component '{}' must declare at least one capability",
                manifest.id
            )));
        }
        for capability in &manifest.capabilities {
            validate_capability(manifest, capability)?;
        }
        for tool in &manifest.tools {
            if tool.name.trim().is_empty() {
                return Err(BitFunError::validation(
                    "Bridge Component tool name cannot be empty",
                ));
            }
            validate_manifest_action(manifest, Some(&tool.capability_id), &tool.action)?;
            for action in &tool.actions {
                validate_manifest_action(manifest, Some(&tool.capability_id), action)?;
            }
        }
        Ok(())
    }

    pub fn load_package_from_dir(dir: &Path) -> BitFunResult<BridgeComponentPackage> {
        let mut manifest: BridgeComponentManifest =
            read_json_file(&dir.join(BRIDGE_COMPONENT_MANIFEST))?;
        Self::validate_manifest(&mut manifest)?;
        Ok(BridgeComponentPackage {
            manifest,
            path: dir.to_string_lossy().to_string(),
        })
    }
}

pub fn validate_bridge_component_id(id: &str) -> BitFunResult<()> {
    if id.is_empty() {
        return Err(BitFunError::validation(
            "Bridge Component id cannot be empty",
        ));
    }
    let mut chars = id.chars();
    if !chars.next().is_some_and(|c| c.is_ascii_alphabetic()) {
        return Err(BitFunError::validation(
            "Bridge Component id must start with an ASCII letter",
        ));
    }
    for c in chars {
        if !c.is_ascii_alphanumeric() && c != '-' && c != '_' {
            return Err(BitFunError::validation(
                "Bridge Component id can only contain ASCII letters, numbers, -, _",
            ));
        }
    }
    Ok(())
}

fn runtime_command(
    language: BridgeComponentRuntimeLanguage,
    package_manager: Option<&str>,
    entry: &Path,
) -> Command {
    match language {
        BridgeComponentRuntimeLanguage::JavaScript => {
            let mut command = Command::new("node");
            command.arg(entry);
            command
        }
        BridgeComponentRuntimeLanguage::TypeScript => {
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
        BridgeComponentRuntimeLanguage::Python => {
            let mut command = Command::new("python");
            command.arg(entry);
            command
        }
        BridgeComponentRuntimeLanguage::Native => Command::new(entry),
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
    event: &BridgeComponentEvent,
    output: &mut Option<Value>,
    failed: &mut bool,
) {
    if let BridgeComponentEvent::RunCompleted { output: value } = event {
        *output = Some(value.clone());
    }
    if let BridgeComponentEvent::RunFailed { error } = event {
        *output = Some(error.clone());
        *failed = true;
    }
}

#[cfg(test)]
mod tests {
    use super::super::{
        BridgeComponentAction, BridgeComponentKind, BridgeComponentLifecycle,
        BridgeComponentPermissions, BridgeComponentRuntime, BridgeComponentSurfaces,
    };
    use super::*;
    use serde_json::json;

    fn manifest_with_usable_by(
        usable_by: Vec<BridgeComponentConsumerKind>,
    ) -> BridgeComponentManifest {
        BridgeComponentManifest {
            schema_version: BRIDGE_COMPONENT_SCHEMA_VERSION,
            id: "test-bridge".to_string(),
            name: "Test Bridge".to_string(),
            description: "Test Bridge".to_string(),
            kind: BridgeComponentKind::Sdk,
            runtime: BridgeComponentRuntime {
                language: BridgeComponentRuntimeLanguage::JavaScript,
                entry: "worker.js".to_string(),
                package_manager: None,
            },
            surfaces: BridgeComponentSurfaces::default(),
            capabilities: vec![BridgeComponentCapability {
                id: "test.capability".to_string(),
                title: "Test Capability".to_string(),
                description: "Test Capability".to_string(),
                category: "test".to_string(),
                actions: vec!["start".to_string()],
                streaming: false,
                cancelable: false,
                resumable: false,
                usable_by,
                input_schema: json!({ "type": "object" }),
                output_schema: json!({ "type": "object" }),
            }],
            actions: vec![BridgeComponentAction {
                name: "start".to_string(),
                description: "Start".to_string(),
                input_schema: json!({ "type": "object" }),
                output_schema: json!({ "type": "object" }),
                streaming: false,
                cancelable: false,
                resumable: false,
            }],
            tools: Vec::new(),
            lifecycle: BridgeComponentLifecycle::default(),
            permissions: BridgeComponentPermissions::default(),
        }
    }

    fn product_runtime_consumer() -> BridgeComponentConsumer {
        BridgeComponentConsumer {
            kind: BridgeComponentConsumerKind::ProductAppRuntime,
            id: "product-app-runtime:work-1:runtime-1".to_string(),
            session_id: None,
            turn_id: None,
        }
    }

    #[test]
    fn product_app_runtime_permission_requires_explicit_usable_by() {
        let legacy_manifest = manifest_with_usable_by(vec![
            BridgeComponentConsumerKind::AgentComponent,
            BridgeComponentConsumerKind::Management,
        ]);
        let consumer = product_runtime_consumer();

        assert!(validate_consumer_permission(
            &legacy_manifest,
            Some("test.capability"),
            "start",
            &consumer,
        )
        .is_err());

        let runtime_manifest =
            manifest_with_usable_by(vec![BridgeComponentConsumerKind::ProductAppRuntime]);

        assert!(validate_consumer_permission(
            &runtime_manifest,
            Some("test.capability"),
            "start",
            &consumer,
        )
        .is_ok());
    }
}
