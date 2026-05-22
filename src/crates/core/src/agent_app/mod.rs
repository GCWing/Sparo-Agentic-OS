//! Agent App packages for FlowChat-native reusable work applications.

use crate::agentic::agents::{Agent, PromptBuilder, PromptBuilderContext, RequestContextPolicy};
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::agentic::tools::registry::get_global_tool_registry;
use crate::infrastructure::get_path_manager_arc;
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::Command;

pub const AGENT_APP_SCHEMA_VERSION: u32 = 1;
pub const AGENT_APP_MANIFEST: &str = "manifest.json";
pub const AGENT_APP_PROMPT: &str = "agent.md";
pub const AGENT_APP_EXAMPLES: &str = "examples.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentAppLevel {
    User,
    Project,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppExample {
    pub title: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppToolPolicy {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allow: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppServiceAction {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub input_schema: Value,
    #[serde(default)]
    pub output_schema: Value,
    #[serde(default)]
    pub prompt_template: String,
    #[serde(default)]
    pub memory: String,
    #[serde(default)]
    pub tool_policy: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default = "default_icon")]
    pub icon: String,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub level: AgentAppLevel,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default)]
    pub readonly: bool,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_tools")]
    pub tools: Vec<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub subagents: Vec<String>,
    #[serde(default)]
    pub tool_policies: BTreeMap<String, AgentAppToolPolicy>,
    #[serde(default)]
    pub service_actions: Vec<AgentAppServiceAction>,
    #[serde(default)]
    pub examples: Vec<AgentAppExample>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppPackage {
    pub manifest: AgentAppManifest,
    pub prompt: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub category: String,
    pub tags: Vec<String>,
    pub level: AgentAppLevel,
    pub model: String,
    pub readonly: bool,
    pub enabled: bool,
    pub tools: Vec<String>,
    pub skills: Vec<String>,
    pub subagents: Vec<String>,
    pub service_actions: Vec<AgentAppServiceAction>,
    pub examples: Vec<AgentAppExample>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JsToolPermissions {
    #[serde(default)]
    pub fs: JsToolFsPermissions,
    #[serde(default)]
    pub shell: JsToolShellPermissions,
    #[serde(default)]
    pub net: JsToolNetPermissions,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JsToolFsPermissions {
    #[serde(default)]
    pub read: Vec<String>,
    #[serde(default)]
    pub write: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JsToolShellPermissions {
    #[serde(default)]
    pub allow: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JsToolNetPermissions {
    #[serde(default)]
    pub allow: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAppJsToolManifest {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
    pub runtime: String,
    pub entry: String,
    #[serde(default = "default_readonly")]
    pub readonly: bool,
    #[serde(default)]
    pub permissions: JsToolPermissions,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default = "default_max_output_bytes")]
    pub max_output_bytes: usize,
}

fn default_icon() -> String {
    "bot".to_string()
}

fn default_category() -> String {
    "custom".to_string()
}

fn default_model() -> String {
    "primary".to_string()
}

fn default_enabled() -> bool {
    true
}

fn default_readonly() -> bool {
    true
}

fn default_timeout_ms() -> u64 {
    30_000
}

fn default_max_output_bytes() -> usize {
    200_000
}

fn default_tools() -> Vec<String> {
    vec![
        "LS".to_string(),
        "Read".to_string(),
        "Glob".to_string(),
        "Grep".to_string(),
    ]
}

pub fn validate_agent_app_id(id: &str) -> BitFunResult<()> {
    if id.is_empty() {
        return Err(BitFunError::validation("Agent App id cannot be empty"));
    }
    let mut chars = id.chars();
    if !chars.next().is_some_and(|c| c.is_ascii_alphabetic()) {
        return Err(BitFunError::validation(
            "Agent App id must start with an ASCII letter",
        ));
    }
    for c in chars {
        if !c.is_ascii_alphanumeric() && c != '-' && c != '_' {
            return Err(BitFunError::validation(
                "Agent App id can only contain ASCII letters, numbers, -, _",
            ));
        }
    }
    Ok(())
}

pub fn slugify_agent_app_id(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if (c.is_whitespace() || c == '-' || c == '_') && !out.ends_with('-') {
            out.push('-');
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "agent-app".to_string()
    } else if out.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) {
        out
    } else {
        format!("agent-{}", out)
    }
}

fn agent_app_root(level: AgentAppLevel, workspace_root: Option<&Path>) -> BitFunResult<PathBuf> {
    let pm = get_path_manager_arc();
    Ok(match level {
        AgentAppLevel::User => pm.user_agent_apps_dir(),
        AgentAppLevel::Project => {
            let workspace_root = workspace_root.ok_or_else(|| {
                BitFunError::validation("Project Agent Apps require a workspace path")
            })?;
            pm.project_agent_apps_dir(workspace_root)
        }
    })
}

fn agent_app_dir(
    level: AgentAppLevel,
    app_id: &str,
    workspace_root: Option<&Path>,
) -> BitFunResult<PathBuf> {
    Ok(agent_app_root(level, workspace_root)?.join(app_id))
}

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &Path) -> BitFunResult<T> {
    let text = std::fs::read_to_string(path)?;
    serde_json::from_str(&text).map_err(BitFunError::from)
}

fn write_json_file<T: Serialize>(path: &Path, value: &T) -> BitFunResult<()> {
    let text = serde_json::to_string_pretty(value)?;
    std::fs::write(path, format!("{text}\n"))?;
    Ok(())
}

pub struct AgentAppAgent {
    manifest: AgentAppManifest,
    prompt: String,
    path: String,
}

impl AgentAppAgent {
    pub fn new(manifest: AgentAppManifest, prompt: String, path: String) -> Self {
        Self {
            manifest,
            prompt,
            path,
        }
    }

    pub fn manifest(&self) -> &AgentAppManifest {
        &self.manifest
    }

    pub fn path(&self) -> &str {
        &self.path
    }
}

#[async_trait]
impl Agent for AgentAppAgent {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        &self.manifest.id
    }

    fn name(&self) -> &str {
        &self.manifest.name
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

    fn default_tools(&self) -> Vec<String> {
        self.manifest.tools.clone()
    }

    fn request_context_policy(&self) -> RequestContextPolicy {
        let mut policy = RequestContextPolicy::default();
        if self.manifest.category == "files" {
            policy = policy.with_files_context();
        }
        policy
    }

    fn is_readonly(&self) -> bool {
        self.manifest.readonly
    }
}

pub struct AgentAppManager;

impl AgentAppManager {
    pub fn seed_builtin_file_agent_apps() -> BitFunResult<Vec<AgentAppInfo>> {
        let mut seeded = Vec::new();
        for (manifest, prompt) in builtin_file_agent_apps() {
            let dir = agent_app_dir(AgentAppLevel::User, &manifest.id, None)?;
            if !dir.join(AGENT_APP_MANIFEST).exists() {
                let package = Self::create_or_update(manifest, prompt, None, false)?;
                seeded.push(package_to_info(&package));
            }
        }
        Ok(seeded)
    }

    pub fn list(workspace_root: Option<&Path>) -> BitFunResult<Vec<AgentAppInfo>> {
        let _ = workspace_root;
        let mut apps = Vec::new();
        Self::load_from_root(AgentAppLevel::User, None, &mut apps)?;
        apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(apps)
    }

    fn load_from_root(
        level: AgentAppLevel,
        workspace_root: Option<&Path>,
        out: &mut Vec<AgentAppInfo>,
    ) -> BitFunResult<()> {
        let root = agent_app_root(level, workspace_root)?;
        if !root.exists() {
            return Ok(());
        }
        for entry in std::fs::read_dir(root)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            match Self::load_package_from_dir(&path) {
                Ok(package) => out.push(package_to_info(&package)),
                Err(e) => warn!("Failed to load Agent App from {}: {}", path.display(), e),
            }
        }
        Ok(())
    }

    pub fn get(
        app_id: &str,
        level: Option<AgentAppLevel>,
        workspace_root: Option<&Path>,
    ) -> BitFunResult<AgentAppPackage> {
        let _ = workspace_root;
        if level == Some(AgentAppLevel::Project) {
            return Err(BitFunError::validation(
                "Project Agent Apps are not supported; Agent Apps are user-level only",
            ));
        }
        let dir = agent_app_dir(AgentAppLevel::User, app_id, None)?;
        if dir.join(AGENT_APP_MANIFEST).exists() {
            return Self::load_package_from_dir(&dir);
        }
        Err(BitFunError::NotFound(format!(
            "Agent App not found: {app_id}"
        )))
    }

    pub fn create_or_update(
        mut manifest: AgentAppManifest,
        prompt: String,
        workspace_root: Option<&Path>,
        overwrite: bool,
    ) -> BitFunResult<AgentAppPackage> {
        let _ = workspace_root;
        manifest.level = AgentAppLevel::User;
        Self::validate_manifest(&mut manifest)?;
        if prompt.trim().is_empty() {
            return Err(BitFunError::validation("Agent App prompt cannot be empty"));
        }
        let dir = agent_app_dir(AgentAppLevel::User, &manifest.id, None)?;
        if dir.exists() && !overwrite {
            return Err(BitFunError::validation(format!(
                "Agent App '{}' already exists",
                manifest.id
            )));
        }
        std::fs::create_dir_all(dir.join("tools"))?;
        write_json_file(&dir.join(AGENT_APP_MANIFEST), &manifest)?;
        std::fs::write(dir.join(AGENT_APP_PROMPT), format!("{}\n", prompt.trim()))?;
        write_json_file(&dir.join(AGENT_APP_EXAMPLES), &manifest.examples)?;
        let package = Self::load_package_from_dir(&dir)?;
        Self::register_package(&package)?;
        Ok(package)
    }

    pub async fn delete(
        app_id: &str,
        level: AgentAppLevel,
        workspace_root: Option<&Path>,
    ) -> BitFunResult<()> {
        let _ = workspace_root;
        if level == AgentAppLevel::Project {
            return Err(BitFunError::validation(
                "Project Agent Apps are not supported; Agent Apps are user-level only",
            ));
        }
        let dir = agent_app_dir(AgentAppLevel::User, app_id, None)?;
        if !dir.exists() {
            return Err(BitFunError::NotFound(format!(
                "Agent App not found: {app_id}"
            )));
        }
        Self::unregister_runtime_tools(app_id).await;
        std::fs::remove_dir_all(&dir)?;
        crate::agentic::agents::get_agent_registry().remove_agent_app(app_id)?;
        Ok(())
    }

    pub fn register_all(workspace_root: Option<&Path>) -> BitFunResult<Vec<AgentAppInfo>> {
        let _ = workspace_root;
        let packages = Self::load_packages(workspace_root)?;
        let registry = crate::agentic::agents::get_agent_registry();
        for package in &packages {
            Self::register_package_with_registry(&registry, package)?;
        }
        Ok(packages.iter().map(package_to_info).collect())
    }

    pub async fn register_runtime_tools(
        workspace_root: Option<&Path>,
    ) -> BitFunResult<Vec<String>> {
        let _ = workspace_root;
        let packages = Self::load_packages(workspace_root)?;
        let mut registered = Vec::new();
        let registry = get_global_tool_registry();
        let mut guard = registry.write().await;
        for package in packages {
            guard.unregister_tools_with_prefix(&format!("agentapp__{}__", package.manifest.id));
            let app_dir = PathBuf::from(&package.path);
            let tools_dir = app_dir.join("tools");
            if !tools_dir.exists() {
                continue;
            }
            for entry in std::fs::read_dir(&tools_dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) != Some("json") {
                    continue;
                }
                let manifest: AgentAppJsToolManifest = read_json_file(&path)?;
                validate_js_tool_manifest(&manifest)?;
                let tool = AgentAppRuntimeToolAdapter::new(
                    package.manifest.id.clone(),
                    app_dir.clone(),
                    manifest,
                );
                let name = tool.name().to_string();
                guard.register_tool(Arc::new(tool));
                registered.push(name);
            }
        }
        Ok(registered)
    }

    pub async fn unregister_runtime_tools(app_id: &str) {
        let registry = get_global_tool_registry();
        let mut guard = registry.write().await;
        guard.unregister_tools_with_prefix(&format!("agentapp__{}__", app_id));
    }

    pub fn create_js_tool(
        app_id: &str,
        level: Option<AgentAppLevel>,
        workspace_root: Option<&Path>,
        manifest: AgentAppJsToolManifest,
        source: String,
    ) -> BitFunResult<String> {
        validate_js_tool_manifest(&manifest)?;
        let package = Self::get(app_id, level, workspace_root)?;
        let app_dir = PathBuf::from(package.path);
        let manifest_path = app_dir
            .join("tools")
            .join(format!("{}.tool.json", manifest.name));
        let entry_path = app_dir.join(&manifest.entry);
        let parent = entry_path
            .parent()
            .ok_or_else(|| BitFunError::validation("Invalid JS tool entry path"))?;
        std::fs::create_dir_all(parent)?;
        write_json_file(&manifest_path, &manifest)?;
        std::fs::write(&entry_path, source)?;
        Ok(format!("agentapp__{}__{}", app_id, manifest.name))
    }

    pub async fn test_js_tool(
        app_id: &str,
        tool_name: &str,
        input: &Value,
        workspace_root: Option<&Path>,
    ) -> BitFunResult<Value> {
        let package = Self::get(app_id, None, workspace_root)?;
        let app_dir = PathBuf::from(package.path);
        let manifest_path = app_dir
            .join("tools")
            .join(format!("{}.tool.json", tool_name));
        let manifest: AgentAppJsToolManifest = read_json_file(&manifest_path)?;
        validate_js_tool_manifest(&manifest)?;
        let tool = AgentAppRuntimeToolAdapter::new(app_id.to_string(), app_dir, manifest);
        let context = ToolUseContext {
            tool_call_id: None,
            agent_type: Some("AgentAppStudio".to_string()),
            session_id: None,
            dialog_turn_id: None,
            workspace: workspace_root
                .map(|root| crate::agentic::WorkspaceBinding::new(None, root.to_path_buf())),
            custom_data: HashMap::new(),
            computer_use_host: None,
            cancellation_token: None,
            runtime_tool_restrictions: Default::default(),
            workspace_services: None,
            workspace_mount: None,
            agentic: None,
        };
        let results = tool.call_impl(input, &context).await?;
        Ok(json!({ "results": results }))
    }

    fn load_packages(workspace_root: Option<&Path>) -> BitFunResult<Vec<AgentAppPackage>> {
        let _ = workspace_root;
        let mut packages = Vec::new();
        Self::load_packages_from_root(AgentAppLevel::User, None, &mut packages)?;
        Ok(packages)
    }

    fn load_packages_from_root(
        level: AgentAppLevel,
        workspace_root: Option<&Path>,
        out: &mut Vec<AgentAppPackage>,
    ) -> BitFunResult<()> {
        let root = agent_app_root(level, workspace_root)?;
        if !root.exists() {
            return Ok(());
        }
        for entry in std::fs::read_dir(root)? {
            let entry = entry?;
            if entry.path().is_dir() {
                match Self::load_package_from_dir(&entry.path()) {
                    Ok(package) => out.push(package),
                    Err(e) => warn!(
                        "Skipping invalid Agent App {}: {}",
                        entry.path().display(),
                        e
                    ),
                }
            }
        }
        Ok(())
    }

    fn load_package_from_dir(dir: &Path) -> BitFunResult<AgentAppPackage> {
        let mut manifest: AgentAppManifest = read_json_file(&dir.join(AGENT_APP_MANIFEST))?;
        Self::validate_manifest(&mut manifest)?;
        let prompt = std::fs::read_to_string(dir.join(AGENT_APP_PROMPT))?;
        Ok(AgentAppPackage {
            manifest,
            prompt,
            path: dir.to_string_lossy().to_string(),
        })
    }

    fn register_package(package: &AgentAppPackage) -> BitFunResult<()> {
        let registry = crate::agentic::agents::get_agent_registry();
        Self::register_package_with_registry(&registry, package)
    }

    fn register_package_with_registry(
        registry: &Arc<crate::agentic::agents::AgentRegistry>,
        package: &AgentAppPackage,
    ) -> BitFunResult<()> {
        let config = crate::agentic::agents::CustomSubagentConfig {
            enabled: package.manifest.enabled,
            model: package.manifest.model.clone(),
        };
        registry.register_or_replace_agent_app(
            Arc::new(AgentAppAgent::new(
                package.manifest.clone(),
                package.prompt.clone(),
                package.path.clone(),
            )),
            config,
        );
        info!("Registered Agent App: {}", package.manifest.id);
        Ok(())
    }

    pub fn validate_manifest(manifest: &mut AgentAppManifest) -> BitFunResult<()> {
        manifest.level = AgentAppLevel::User;
        if manifest.schema_version == 0 {
            manifest.schema_version = AGENT_APP_SCHEMA_VERSION;
        }
        if manifest.schema_version != AGENT_APP_SCHEMA_VERSION {
            return Err(BitFunError::validation(format!(
                "Unsupported Agent App schema version: {}",
                manifest.schema_version
            )));
        }
        manifest.id = manifest.id.trim().to_string();
        validate_agent_app_id(&manifest.id)?;
        if manifest.name.trim().is_empty() {
            return Err(BitFunError::validation("Agent App name cannot be empty"));
        }
        if manifest.description.trim().is_empty() {
            return Err(BitFunError::validation(
                "Agent App description cannot be empty",
            ));
        }
        if manifest.tools.is_empty() {
            manifest.tools = default_tools();
        }
        if manifest.model.trim().is_empty() {
            manifest.model = default_model();
        }
        Ok(())
    }

    pub fn bash_allowlist_for(agent_id: &str) -> Option<Vec<String>> {
        let package = Self::get(agent_id, Some(AgentAppLevel::User), None).ok()?;
        package
            .manifest
            .tool_policies
            .get("Bash")
            .map(|policy| policy.allow.clone())
    }
}

fn builtin_file_agent_apps() -> Vec<(AgentAppManifest, String)> {
    let mut downloads_policies = BTreeMap::new();
    downloads_policies.insert(
        "Bash".to_string(),
        AgentAppToolPolicy {
            allow: vec!["mkdir".to_string(), "mv".to_string(), "cp".to_string()],
        },
    );

    let mut rename_policies = BTreeMap::new();
    rename_policies.insert(
        "Bash".to_string(),
        AgentAppToolPolicy {
            allow: vec!["mv".to_string()],
        },
    );

    vec![
        (
            AgentAppManifest {
                schema_version: AGENT_APP_SCHEMA_VERSION,
                id: "files-downloads-tidy".to_string(),
                name: "Downloads Tidy".to_string(),
                description:
                    "Organize downloads or selected folders by category and age with preview-first moves."
                        .to_string(),
                icon: "FolderArchive".to_string(),
                category: "files".to_string(),
                tags: vec!["files".to_string(), "cleanup".to_string()],
                level: AgentAppLevel::User,
                model: "primary".to_string(),
                readonly: false,
                enabled: true,
                tools: vec![
                    "LS".to_string(),
                    "Glob".to_string(),
                    "Read".to_string(),
                    "Bash".to_string(),
                ],
                skills: Vec::new(),
                subagents: vec!["FileFinder".to_string()],
                tool_policies: downloads_policies,
                service_actions: vec![AgentAppServiceAction {
                    name: "tidy".to_string(),
                    description: "Plan and execute a download tidy run".to_string(),
                    input_schema: Value::Null,
                    output_schema: Value::Null,
                    prompt_template: "Inspect the current FilesContext, group candidate files, present a preview plan, then move files only after confirmation.".to_string(),
                    memory: String::new(),
                    tool_policy: Vec::new(),
                }],
                examples: vec![AgentAppExample {
                    title: "Tidy my Downloads".to_string(),
                    prompt: "Group files by type and move old items into an Archive folder. Show me the plan first.".to_string(),
                }],
            },
            r#"{LANGUAGE_PREFERENCE}

{ENV_INFO}

# Role

You are Downloads Tidy, a Files Agent App for cleaning up downloads and selected folders.

Use the current `<FilesContext>` as the starting point. Inspect before acting. Produce a clear preview plan with source paths, destination folders, and naming choices before any write operation. Use Bash only for simple `mkdir`, `mv`, or `cp` commands allowed by policy.

Never create an index, database, embedding store, background watcher, or scheduled job.

{AGENT_MEMORY}
"#
            .to_string(),
        ),
        (
            AgentAppManifest {
                schema_version: AGENT_APP_SCHEMA_VERSION,
                id: "files-batch-renamer".to_string(),
                name: "Batch Renamer".to_string(),
                description:
                    "Rename selected files with a consistent pattern and a reviewable mapping."
                        .to_string(),
                icon: "FilePenLine".to_string(),
                category: "files".to_string(),
                tags: vec!["files".to_string(), "rename".to_string()],
                level: AgentAppLevel::User,
                model: "primary".to_string(),
                readonly: false,
                enabled: true,
                tools: vec![
                    "LS".to_string(),
                    "Glob".to_string(),
                    "Read".to_string(),
                    "Bash".to_string(),
                ],
                skills: Vec::new(),
                subagents: vec!["FileFinder".to_string()],
                tool_policies: rename_policies,
                service_actions: vec![AgentAppServiceAction {
                    name: "rename".to_string(),
                    description: "Plan and apply a batch rename".to_string(),
                    input_schema: Value::Null,
                    output_schema: Value::Null,
                    prompt_template: "Build a source-to-target rename table from FilesContext and apply it only after confirmation.".to_string(),
                    memory: String::new(),
                    tool_policy: Vec::new(),
                }],
                examples: vec![AgentAppExample {
                    title: "Rename selected screenshots".to_string(),
                    prompt: "Rename the selected files into a consistent date-based pattern. Show the mapping first.".to_string(),
                }],
            },
            r#"{LANGUAGE_PREFERENCE}

{ENV_INFO}

# Role

You are Batch Renamer, a Files Agent App for safe, reviewable file renames.

Use the current `<FilesContext>` selection first. If no files are selected, ask for a scope or use a narrow Glob search. Always present a source-to-target mapping and collision check before invoking Bash. Use only simple `mv` commands allowed by policy.

Never create an index, database, embedding store, background watcher, or scheduled job.

{AGENT_MEMORY}
"#
            .to_string(),
        ),
    ]
}

fn package_to_info(package: &AgentAppPackage) -> AgentAppInfo {
    AgentAppInfo {
        id: package.manifest.id.clone(),
        name: package.manifest.name.clone(),
        description: package.manifest.description.clone(),
        icon: package.manifest.icon.clone(),
        category: package.manifest.category.clone(),
        tags: package.manifest.tags.clone(),
        level: package.manifest.level,
        model: package.manifest.model.clone(),
        readonly: package.manifest.readonly,
        enabled: package.manifest.enabled,
        tools: package.manifest.tools.clone(),
        skills: package.manifest.skills.clone(),
        subagents: package.manifest.subagents.clone(),
        service_actions: package.manifest.service_actions.clone(),
        examples: package.manifest.examples.clone(),
        path: package.path.clone(),
    }
}

fn validate_js_tool_manifest(manifest: &AgentAppJsToolManifest) -> BitFunResult<()> {
    validate_agent_app_id(&manifest.name)?;
    if manifest.runtime != "javascript" {
        return Err(BitFunError::validation(
            "Agent App runtime tools currently support runtime=javascript only",
        ));
    }
    if manifest.entry.trim().is_empty()
        || Path::new(&manifest.entry).is_absolute()
        || Path::new(&manifest.entry)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(BitFunError::validation(
            "JS runtime tool entry must be a relative path inside the Agent App",
        ));
    }
    if manifest.readonly
        && (!manifest.permissions.fs.write.is_empty()
            || !manifest.permissions.shell.allow.is_empty())
    {
        return Err(BitFunError::validation(
            "Readonly JS runtime tools cannot request write or shell permissions",
        ));
    }
    Ok(())
}

pub struct AgentAppRuntimeToolAdapter {
    app_id: String,
    app_dir: PathBuf,
    manifest: AgentAppJsToolManifest,
    tool_name: String,
}

impl AgentAppRuntimeToolAdapter {
    pub fn new(app_id: String, app_dir: PathBuf, manifest: AgentAppJsToolManifest) -> Self {
        let tool_name = format!("agentapp__{}__{}", app_id, manifest.name);
        Self {
            app_id,
            app_dir,
            manifest,
            tool_name,
        }
    }
}

#[async_trait]
impl Tool for AgentAppRuntimeToolAdapter {
    fn name(&self) -> &str {
        &self.tool_name
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok(self.manifest.description.clone())
    }

    fn input_schema(&self) -> Value {
        self.manifest.input_schema.clone()
    }

    fn is_readonly(&self) -> bool {
        self.manifest.readonly
    }

    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        !self.manifest.readonly
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        validate_js_input_subset(&self.manifest.input_schema, input)?;
        let workspace_root = context.workspace_root().map(Path::to_path_buf);
        let bridge = build_js_bridge_script(
            &self.app_dir,
            &self.manifest,
            input,
            workspace_root.as_deref(),
        )?;
        let child = Command::new(resolve_js_runtime())
            .arg("-e")
            .arg(bridge)
            .current_dir(&self.app_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| BitFunError::tool(format!("Failed to start JS runtime: {e}")))?;

        let timeout = std::time::Duration::from_millis(self.manifest.timeout_ms);
        let output = tokio::time::timeout(timeout, child.wait_with_output())
            .await
            .map_err(|_| {
                BitFunError::Timeout("Agent App JS runtime tool timed out".to_string())
            })??;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if !output.status.success() {
            return Err(BitFunError::tool(format!(
                "Agent App JS tool failed: {}",
                stderr.trim()
            )));
        }
        if stdout.len() > self.manifest.max_output_bytes {
            return Err(BitFunError::tool(format!(
                "Agent App JS tool output exceeded {} bytes",
                self.manifest.max_output_bytes
            )));
        }
        let value: Value = serde_json::from_str(stdout.trim()).map_err(|e| {
            BitFunError::tool(format!("Agent App JS tool returned invalid JSON: {e}"))
        })?;
        let summary = value
            .get("summary")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("Agent App JS tool {} completed", self.manifest.name));
        Ok(vec![ToolResult::ok(
            json!({
                "app_id": self.app_id,
                "tool": self.manifest.name,
                "result": value,
            }),
            Some(summary),
        )])
    }
}

fn validate_js_input_subset(schema: &Value, input: &Value) -> BitFunResult<()> {
    if schema.get("type").and_then(Value::as_str) != Some("object") {
        return Ok(());
    }
    let object = input
        .as_object()
        .ok_or_else(|| BitFunError::validation("Agent App JS tool input must be an object"))?;
    if let Some(required) = schema.get("required").and_then(Value::as_array) {
        for field in required.iter().filter_map(Value::as_str) {
            if !object.contains_key(field) {
                return Err(BitFunError::validation(format!(
                    "Agent App JS tool input is missing required field '{}'",
                    field
                )));
            }
        }
    }
    let properties = schema.get("properties").and_then(Value::as_object);
    if schema.get("additionalProperties").and_then(Value::as_bool) == Some(false) {
        if let Some(properties) = properties {
            for key in object.keys() {
                if !properties.contains_key(key) {
                    return Err(BitFunError::validation(format!(
                        "Agent App JS tool input contains unknown field '{}'",
                        key
                    )));
                }
            }
        }
    }
    if let Some(properties) = properties {
        for (key, prop_schema) in properties {
            let Some(value) = object.get(key) else {
                continue;
            };
            let Some(expected) = prop_schema.get("type").and_then(Value::as_str) else {
                continue;
            };
            let ok = match expected {
                "string" => value.is_string(),
                "boolean" => value.is_boolean(),
                "number" => value.is_number(),
                "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
                "object" => value.is_object(),
                "array" => value.is_array(),
                _ => true,
            };
            if !ok {
                return Err(BitFunError::validation(format!(
                    "Agent App JS tool input field '{}' must be {}",
                    key, expected
                )));
            }
        }
    }
    Ok(())
}

fn resolve_js_runtime() -> String {
    if which::which("node").is_ok() {
        "node".to_string()
    } else if which::which("bun").is_ok() {
        "bun".to_string()
    } else {
        "node".to_string()
    }
}

fn build_js_bridge_script(
    app_dir: &Path,
    manifest: &AgentAppJsToolManifest,
    input: &Value,
    workspace_root: Option<&Path>,
) -> BitFunResult<String> {
    let entry_json = serde_json::to_string(&app_dir.join(&manifest.entry).to_string_lossy())?;
    let input_json = serde_json::to_string(input)?;
    let permissions_json = serde_json::to_string(&manifest.permissions)?;
    let workspace_json = serde_json::to_string(
        &workspace_root
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
    )?;
    let readonly_json = serde_json::to_string(&manifest.readonly)?;
    Ok(format!(
        r#"
const fs = require('fs/promises');
const path = require('path');
const child_process = require('child_process');
const input = {input_json};
const permissions = {permissions_json};
const workspaceRoot = {workspace_json};
const entry = {entry_json};
const readonly = {readonly_json};

function expandRoot(root) {{
  return String(root || '').replace('{{workspace}}', workspaceRoot).replace('{{app}}', path.dirname(entry));
}}
function within(target, root) {{
  if (!root) return false;
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}}
function allowed(target, roots) {{
  return (roots || []).some((root) => within(target, expandRoot(root)));
}}
function assertRead(target) {{
  if (!allowed(target, permissions.fs && permissions.fs.read)) throw new Error('Read path is not allowed: ' + target);
}}
function assertWrite(target) {{
  if (!allowed(target, permissions.fs && permissions.fs.write)) throw new Error('Write path is not allowed: ' + target);
}}
async function walk(dir, suffix, out) {{
  assertRead(dir);
  const entries = await fs.readdir(dir, {{ withFileTypes: true }});
  for (const entry of entries) {{
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(p, suffix, out);
    else if (!suffix || p.endsWith(suffix)) out.push(p);
  }}
}}
const context = {{
  fs: {{
    readText: async (p) => {{ assertRead(p); return fs.readFile(p, 'utf8'); }},
    writeText: async (p, text) => {{ assertWrite(p); await fs.mkdir(path.dirname(p), {{ recursive: true }}); return fs.writeFile(p, text, 'utf8'); }},
    glob: async (pattern) => {{
      const base = pattern.includes('**') ? pattern.slice(0, pattern.indexOf('**')) : path.dirname(pattern);
      const suffix = pattern.includes('*') ? pattern.slice(pattern.lastIndexOf('*') + 1) : '';
      const out = [];
      await walk(path.resolve(base || '.'), suffix, out);
      return out;
    }}
  }},
  shell: {{
    exec: async (command) => new Promise((resolve, reject) => {{
      const allow = (permissions.shell && permissions.shell.allow) || [];
      if (!allow.includes(command)) return reject(new Error('Shell command is not allowed: ' + command));
      child_process.exec(command, {{ cwd: workspaceRoot || path.dirname(entry), timeout: 30000 }}, (error, stdout, stderr) => {{
        if (error) reject(error); else resolve({{ stdout, stderr }});
      }});
    }})
  }},
  net: {{
    fetch: async (url, options) => {{
      const allow = (permissions.net && permissions.net.allow) || [];
      if (!allow.some((prefix) => String(url).startsWith(prefix))) throw new Error('Network URL is not allowed: ' + url);
      return fetch(url, options);
    }}
  }},
  log: {{
    info: (...args) => console.error('[info]', ...args),
    warn: (...args) => console.error('[warn]', ...args),
    error: (...args) => console.error('[error]', ...args)
  }},
  storage: {{
    get: async (key) => {{
      const file = path.join(path.dirname(entry), '..', 'storage.json');
      try {{ return JSON.parse(await fs.readFile(file, 'utf8'))[key]; }} catch {{ return undefined; }}
    }},
    set: async (key, value) => {{
      if (readonly) throw new Error('Readonly Agent App JS tools cannot write storage');
      const file = path.join(path.dirname(entry), '..', 'storage.json');
      let data = {{}};
      try {{ data = JSON.parse(await fs.readFile(file, 'utf8')); }} catch {{}}
      data[key] = value;
      await fs.writeFile(file, JSON.stringify(data, null, 2));
    }}
  }}
}};
(async () => {{
  const mod = require(entry);
  if (!mod || typeof mod.run !== 'function') throw new Error('JS runtime tool must export async run(input, context)');
  const result = await mod.run(input, context);
  process.stdout.write(JSON.stringify(result || {{}}));
}})().catch((error) => {{
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}});
"#
    ))
}
