//! Agent Component implementation packages for Product App agent backends and runtime tools.

use crate::agent_component::manifest::{
    default_model, default_tools, AgentComponentBridgeCapabilityRef, AgentComponentInfo,
    AgentComponentJsToolManifest, AgentComponentLevel, AgentComponentManifest,
    AgentComponentPackage,
};
use crate::agentic::agents::{Agent, PromptBuilder, PromptBuilderContext, RequestContextPolicy};
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::agentic::tools::registry::{get_global_tool_registry, ToolRegistry};
use crate::agentic::tools::user_input_manager::get_user_input_manager;
use crate::bridge_component::{
    bridge_run_result_for_assistant, ensure_bridge_run_completed, BridgeComponentConsumer,
    BridgeComponentConsumerKind, BridgeComponentManager,
};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::get_path_manager_arc;
use async_trait::async_trait;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tokio::time::{timeout, Duration};

use super::js_runtime;

pub const AGENT_COMPONENT_SCHEMA_VERSION: u32 = 1;
pub const AGENT_COMPONENT_MANIFEST: &str = "manifest.json";
pub const AGENT_COMPONENT_PROMPT: &str = "agent.md";
pub const AGENT_COMPONENT_EXAMPLES: &str = "examples.json";
const AGENT_COMPONENT_RUNTIME_TOOL_PREFIX: &str = "agentcomponent";
const OBSOLETE_BUILTIN_FILE_AGENT_COMPONENT_IDS: &[&str] = &[
    "files-downloads-tidy",
    "files-batch-renamer",
    "cursor-agent",
];

pub fn validate_agent_component_id(id: &str) -> CoreResult<()> {
    if id.is_empty() {
        return Err(CoreError::validation("Agent Component id cannot be empty"));
    }
    let mut chars = id.chars();
    if !chars.next().is_some_and(|c| c.is_ascii_alphabetic()) {
        return Err(CoreError::validation(
            "Agent Component id must start with an ASCII letter",
        ));
    }
    for c in chars {
        if !c.is_ascii_alphanumeric() && c != '-' && c != '_' {
            return Err(CoreError::validation(
                "Agent Component id can only contain ASCII letters, numbers, -, _",
            ));
        }
    }
    Ok(())
}

pub fn slugify_agent_component_id(name: &str) -> String {
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
        "agent-component".to_string()
    } else if out.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) {
        out
    } else {
        format!("agent-{}", out)
    }
}

fn agent_component_root(
    level: AgentComponentLevel,
    workspace_root: Option<&Path>,
) -> CoreResult<PathBuf> {
    let pm = get_path_manager_arc();
    Ok(match level {
        AgentComponentLevel::User => pm.user_agent_components_dir(),
        AgentComponentLevel::Project => {
            let workspace_root = workspace_root.ok_or_else(|| {
                CoreError::validation("Project Agent Components require a workspace path")
            })?;
            pm.project_agent_components_dir(workspace_root)
        }
    })
}

fn agent_component_dir(
    level: AgentComponentLevel,
    app_id: &str,
    workspace_root: Option<&Path>,
) -> CoreResult<PathBuf> {
    Ok(agent_component_root(level, workspace_root)?.join(app_id))
}

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &Path) -> CoreResult<T> {
    let text = std::fs::read_to_string(path)?;
    serde_json::from_str(&text).map_err(CoreError::from)
}

fn write_json_file<T: Serialize>(path: &Path, value: &T) -> CoreResult<()> {
    let text = serde_json::to_string_pretty(value)?;
    std::fs::write(path, format!("{text}\n"))?;
    Ok(())
}

pub struct AgentComponentAgent {
    manifest: AgentComponentManifest,
    prompt: String,
    path: String,
}

impl AgentComponentAgent {
    pub fn new(manifest: AgentComponentManifest, prompt: String, path: String) -> Self {
        let composed = compose_agent_prompt(&prompt, Path::new(&path), &manifest);
        Self {
            manifest,
            prompt: composed,
            path,
        }
    }

    pub fn manifest(&self) -> &AgentComponentManifest {
        &self.manifest
    }

    pub fn path(&self) -> &str {
        &self.path
    }
}

#[async_trait]
impl Agent for AgentComponentAgent {
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

    async fn build_prompt(&self, context: &PromptBuilderContext) -> CoreResult<String> {
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

pub struct AgentComponentManager;

impl AgentComponentManager {
    pub fn seed_builtin_agent_components() -> CoreResult<Vec<AgentComponentInfo>> {
        Self::remove_obsolete_builtin_file_agent_components()?;
        let app_ids = super::builtin::seed_builtin_agent_components()?;
        let mut seeded = Vec::new();
        for app_id in app_ids {
            match Self::get(&app_id, Some(AgentComponentLevel::User), None) {
                Ok(package) => seeded.push(package_to_info(&package)),
                Err(e) => warn!("Failed to load seeded Agent Component '{}': {}", app_id, e),
            }
        }
        Ok(seeded)
    }

    pub fn seed_builtin_file_agent_components() -> CoreResult<Vec<AgentComponentInfo>> {
        Self::seed_builtin_agent_components()
    }

    fn remove_obsolete_builtin_file_agent_components() -> CoreResult<()> {
        for app_id in OBSOLETE_BUILTIN_FILE_AGENT_COMPONENT_IDS {
            let dir = agent_component_dir(AgentComponentLevel::User, app_id, None)?;
            if !dir.exists() {
                continue;
            }
            std::fs::remove_dir_all(&dir)?;
            let _ = crate::agentic::agents::get_agent_registry().remove_agent_component(app_id);
            info!("Removed obsolete built-in Agent Component: {}", app_id);
        }
        Ok(())
    }

    pub fn list(workspace_root: Option<&Path>) -> CoreResult<Vec<AgentComponentInfo>> {
        let mut apps = Vec::new();
        Self::load_from_root(AgentComponentLevel::User, None, &mut apps)?;
        if workspace_root.is_some() {
            let mut project_apps = Vec::new();
            Self::load_from_root(
                AgentComponentLevel::Project,
                workspace_root,
                &mut project_apps,
            )?;
            merge_agent_component_infos(&mut apps, project_apps);
        }
        apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(apps)
    }

    fn load_from_root(
        level: AgentComponentLevel,
        workspace_root: Option<&Path>,
        out: &mut Vec<AgentComponentInfo>,
    ) -> CoreResult<()> {
        let root = agent_component_root(level, workspace_root)?;
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
                Err(e) => warn!(
                    "Failed to load Agent Component from {}: {}",
                    path.display(),
                    e
                ),
            }
        }
        Ok(())
    }

    pub fn get(
        app_id: &str,
        level: Option<AgentComponentLevel>,
        workspace_root: Option<&Path>,
    ) -> CoreResult<AgentComponentPackage> {
        let levels = match level {
            Some(level) => vec![level],
            None => {
                if workspace_root.is_some() {
                    vec![AgentComponentLevel::Project, AgentComponentLevel::User]
                } else {
                    vec![AgentComponentLevel::User]
                }
            }
        };

        for level in levels {
            let dir = agent_component_dir(level, app_id, workspace_root)?;
            if dir.join(AGENT_COMPONENT_MANIFEST).exists() {
                return Self::load_package_from_dir(&dir);
            }
        }
        Err(CoreError::NotFound(format!(
            "Agent Component not found: {app_id}"
        )))
    }

    pub fn create_or_update(
        mut manifest: AgentComponentManifest,
        prompt: String,
        workspace_root: Option<&Path>,
        overwrite: bool,
    ) -> CoreResult<AgentComponentPackage> {
        Self::validate_manifest(&mut manifest)?;
        if prompt.trim().is_empty() {
            return Err(CoreError::validation(
                "Agent Component prompt cannot be empty",
            ));
        }
        let dir = agent_component_dir(manifest.level, &manifest.id, workspace_root)?;
        if dir.exists() && !overwrite {
            return Err(CoreError::validation(format!(
                "Agent Component '{}' already exists",
                manifest.id
            )));
        }
        std::fs::create_dir_all(dir.join("tools"))?;
        write_json_file(&dir.join(AGENT_COMPONENT_MANIFEST), &manifest)?;
        std::fs::write(
            dir.join(AGENT_COMPONENT_PROMPT),
            format!("{}\n", prompt.trim()),
        )?;
        write_json_file(&dir.join(AGENT_COMPONENT_EXAMPLES), &manifest.examples)?;
        let package = Self::load_package_from_dir(&dir)?;
        Self::register_package(&package)?;
        Ok(package)
    }

    pub async fn delete(
        app_id: &str,
        level: AgentComponentLevel,
        workspace_root: Option<&Path>,
    ) -> CoreResult<()> {
        let dir = agent_component_dir(level, app_id, workspace_root)?;
        if !dir.exists() {
            return Err(CoreError::NotFound(format!(
                "Agent Component not found: {app_id}"
            )));
        }
        Self::unregister_runtime_tools(app_id).await;
        std::fs::remove_dir_all(&dir)?;
        crate::agentic::agents::get_agent_registry().remove_agent_component(app_id)?;
        Self::register_all(workspace_root)?;
        Self::register_runtime_tools(workspace_root).await?;
        Ok(())
    }

    pub fn register_all(workspace_root: Option<&Path>) -> CoreResult<Vec<AgentComponentInfo>> {
        let packages = Self::load_packages(workspace_root)?;
        let registry = crate::agentic::agents::get_agent_registry();
        for package in &packages {
            Self::register_package_with_registry(&registry, package)?;
        }
        Ok(packages.iter().map(package_to_info).collect())
    }

    pub async fn register_runtime_tools(workspace_root: Option<&Path>) -> CoreResult<Vec<String>> {
        let packages = Self::load_packages(workspace_root)?;
        let mut registered = Vec::new();
        let registry = get_global_tool_registry();
        let mut guard = registry.write().await;
        for package in packages {
            Self::register_runtime_tools_for_package_with_guard(
                &mut guard,
                &package,
                HashMap::new(),
                true,
            )?
            .into_iter()
            .for_each(|name| registered.push(name));
        }
        Ok(registered)
    }

    pub async fn register_runtime_tools_for_package(
        package: &AgentComponentPackage,
        private_bridge_package_dirs: HashMap<String, PathBuf>,
    ) -> CoreResult<Vec<String>> {
        let registry = get_global_tool_registry();
        let mut guard = registry.write().await;
        Self::register_runtime_tools_for_package_with_guard(
            &mut guard,
            package,
            private_bridge_package_dirs,
            true,
        )
    }

    fn register_runtime_tools_for_package_with_guard(
        guard: &mut ToolRegistry,
        package: &AgentComponentPackage,
        private_bridge_package_dirs: HashMap<String, PathBuf>,
        replace_existing: bool,
    ) -> CoreResult<Vec<String>> {
        let mut registered = Vec::new();
        if replace_existing {
            guard.unregister_tools_with_prefix(&format!(
                "{}__{}__",
                AGENT_COMPONENT_RUNTIME_TOOL_PREFIX, package.manifest.id
            ));
        }
        let app_dir = PathBuf::from(&package.path);
        let tools_dir = app_dir.join("tools");
        if !tools_dir.exists() {
            return Ok(registered);
        }
        for entry in std::fs::read_dir(&tools_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let manifest: AgentComponentJsToolManifest = read_json_file(&path)?;
            validate_js_tool_manifest(&manifest)?;
            let tool = AgentComponentRuntimeToolAdapter::new(
                package.manifest.id.clone(),
                app_dir.clone(),
                package.manifest.bridge_capabilities.clone(),
                manifest,
                private_bridge_package_dirs.clone(),
            );
            let name = tool.name().to_string();
            guard.register_tool(Arc::new(tool));
            registered.push(name);
        }
        Ok(registered)
    }

    pub async fn unregister_runtime_tools(app_id: &str) {
        let registry = get_global_tool_registry();
        let mut guard = registry.write().await;
        guard.unregister_tools_with_prefix(&format!(
            "{}__{}__",
            AGENT_COMPONENT_RUNTIME_TOOL_PREFIX, app_id
        ));
    }

    pub fn create_js_tool(
        app_id: &str,
        level: Option<AgentComponentLevel>,
        workspace_root: Option<&Path>,
        manifest: AgentComponentJsToolManifest,
        source: String,
    ) -> CoreResult<String> {
        validate_js_tool_manifest(&manifest)?;
        let package = Self::get(app_id, level, workspace_root)?;
        let app_dir = PathBuf::from(package.path);
        let manifest_path = app_dir
            .join("tools")
            .join(format!("{}.tool.json", manifest.name));
        let entry_path = app_dir.join(&manifest.entry);
        let parent = entry_path
            .parent()
            .ok_or_else(|| CoreError::validation("Invalid JS tool entry path"))?;
        std::fs::create_dir_all(parent)?;
        write_json_file(&manifest_path, &manifest)?;
        std::fs::write(&entry_path, source)?;
        Ok(format!(
            "{}__{}__{}",
            AGENT_COMPONENT_RUNTIME_TOOL_PREFIX, app_id, manifest.name
        ))
    }

    pub async fn test_js_tool(
        app_id: &str,
        tool_name: &str,
        input: &Value,
        level: Option<AgentComponentLevel>,
        workspace_root: Option<&Path>,
    ) -> CoreResult<Value> {
        let package = Self::get(app_id, level, workspace_root)?;
        let app_dir = PathBuf::from(&package.path);
        let manifest_path = app_dir
            .join("tools")
            .join(format!("{}.tool.json", tool_name));
        let manifest: AgentComponentJsToolManifest = read_json_file(&manifest_path)?;
        validate_js_tool_manifest(&manifest)?;
        let tool = AgentComponentRuntimeToolAdapter::new(
            app_id.to_string(),
            app_dir,
            package.manifest.bridge_capabilities.clone(),
            manifest,
            HashMap::new(),
        );
        let context = ToolUseContext {
            tool_call_id: None,
            agent_type: Some("AppBuilder".to_string()),
            session_id: None,
            session_domain: None,
            dialog_turn_id: None,
            workspace: workspace_root
                .map(|root| crate::agentic::WorkspaceBinding::new(None, root.to_path_buf())),
            custom_data: HashMap::new(),
            app_builder: None,
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

    fn load_packages(workspace_root: Option<&Path>) -> CoreResult<Vec<AgentComponentPackage>> {
        let mut packages = Vec::new();
        Self::load_packages_from_root(AgentComponentLevel::User, None, &mut packages)?;
        if workspace_root.is_some() {
            let mut project_packages = Vec::new();
            Self::load_packages_from_root(
                AgentComponentLevel::Project,
                workspace_root,
                &mut project_packages,
            )?;
            merge_agent_component_packages(&mut packages, project_packages);
        }
        Ok(packages)
    }

    fn load_packages_from_root(
        level: AgentComponentLevel,
        workspace_root: Option<&Path>,
        out: &mut Vec<AgentComponentPackage>,
    ) -> CoreResult<()> {
        let root = agent_component_root(level, workspace_root)?;
        if !root.exists() {
            return Ok(());
        }
        for entry in std::fs::read_dir(root)? {
            let entry = entry?;
            if entry.path().is_dir() {
                match Self::load_package_from_dir(&entry.path()) {
                    Ok(package) => out.push(package),
                    Err(e) => warn!(
                        "Skipping invalid Agent Component {}: {}",
                        entry.path().display(),
                        e
                    ),
                }
            }
        }
        Ok(())
    }

    pub fn load_package_from_dir(dir: &Path) -> CoreResult<AgentComponentPackage> {
        let mut manifest: AgentComponentManifest =
            read_json_file(&dir.join(AGENT_COMPONENT_MANIFEST))?;
        Self::validate_manifest(&mut manifest)?;
        let prompt = std::fs::read_to_string(dir.join(AGENT_COMPONENT_PROMPT))?;
        Ok(AgentComponentPackage {
            manifest,
            prompt,
            path: dir.to_string_lossy().to_string(),
        })
    }

    pub fn register_package(package: &AgentComponentPackage) -> CoreResult<()> {
        let registry = crate::agentic::agents::get_agent_registry();
        Self::register_package_with_registry(&registry, package)
    }

    fn register_package_with_registry(
        registry: &Arc<crate::agentic::agents::AgentRegistry>,
        package: &AgentComponentPackage,
    ) -> CoreResult<()> {
        let config = crate::agentic::agents::CustomSubagentConfig {
            enabled: package.manifest.enabled,
            model: package.manifest.model.clone(),
        };
        registry.register_or_replace_agent_component(
            Arc::new(AgentComponentAgent::new(
                package.manifest.clone(),
                package.prompt.clone(),
                package.path.clone(),
            )),
            config,
        );
        info!("Registered Agent Component: {}", package.manifest.id);
        Ok(())
    }

    pub fn validate_manifest(manifest: &mut AgentComponentManifest) -> CoreResult<()> {
        if manifest.schema_version == 0 {
            manifest.schema_version = AGENT_COMPONENT_SCHEMA_VERSION;
        }
        if manifest.schema_version != AGENT_COMPONENT_SCHEMA_VERSION {
            return Err(CoreError::validation(format!(
                "Unsupported Agent Component schema version: {}",
                manifest.schema_version
            )));
        }
        manifest.id = manifest.id.trim().to_string();
        validate_agent_component_id(&manifest.id)?;
        if manifest.name.trim().is_empty() {
            return Err(CoreError::validation(
                "Agent Component name cannot be empty",
            ));
        }
        if manifest.description.trim().is_empty() {
            return Err(CoreError::validation(
                "Agent Component description cannot be empty",
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

    pub fn bash_allowlist_for(
        agent_id: &str,
        workspace_root: Option<&Path>,
    ) -> Option<Vec<String>> {
        let package = Self::get(agent_id, None, workspace_root).ok()?;
        package
            .manifest
            .tool_policies
            .get("Bash")
            .map(|policy| policy.allow.clone())
    }
}

/// Compose the effective Agent Component system prompt by appending the package's own
/// routing guide and declared skill files. This keeps `agent.md` short while making
/// the bundled `skills/*.md` library actually reachable by the agent at runtime.
/// Only skills declared in `manifest.skills` are loaded, and only by simple file name,
/// so a package cannot read outside its own `skills/` directory.
fn compose_agent_prompt(base: &str, dir: &Path, manifest: &AgentComponentManifest) -> String {
    let mut sections: Vec<String> = Vec::new();

    let routing_path = dir.join("routing.md");
    if let Ok(routing) = std::fs::read_to_string(&routing_path) {
        let routing = routing.trim();
        if !routing.is_empty() {
            sections.push(format!("# Routing\n\n{}", routing));
        }
    }

    let mut skill_sections: Vec<String> = Vec::new();
    for key in &manifest.skills {
        let safe = key.trim();
        if safe.is_empty() || safe.contains('/') || safe.contains('\\') || safe.contains("..") {
            continue;
        }
        let skill_path = dir.join("skills").join(format!("{}.md", safe));
        if let Ok(content) = std::fs::read_to_string(&skill_path) {
            let content = content.trim();
            if !content.is_empty() {
                skill_sections.push(format!("## Skill: {}\n\n{}", safe, content));
            }
        }
    }
    if !skill_sections.is_empty() {
        sections.push(format!(
            "# Skill Library\n\n{}",
            skill_sections.join("\n\n")
        ));
    }

    if sections.is_empty() {
        base.trim_end().to_string()
    } else {
        format!("{}\n\n{}", base.trim_end(), sections.join("\n\n"))
    }
}

fn package_to_info(package: &AgentComponentPackage) -> AgentComponentInfo {
    AgentComponentInfo {
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
        bridge_capabilities: package.manifest.bridge_capabilities.clone(),
        examples: package.manifest.examples.clone(),
        path: package.path.clone(),
    }
}

fn merge_agent_component_infos(
    out: &mut Vec<AgentComponentInfo>,
    incoming: Vec<AgentComponentInfo>,
) {
    let mut by_id = out
        .iter()
        .enumerate()
        .map(|(index, app)| (app.id.clone(), index))
        .collect::<HashMap<_, _>>();
    for app in incoming {
        if let Some(index) = by_id.get(&app.id).copied() {
            out[index] = app;
        } else {
            by_id.insert(app.id.clone(), out.len());
            out.push(app);
        }
    }
}

fn merge_agent_component_packages(
    out: &mut Vec<AgentComponentPackage>,
    incoming: Vec<AgentComponentPackage>,
) {
    let mut by_id = out
        .iter()
        .enumerate()
        .map(|(index, package)| (package.manifest.id.clone(), index))
        .collect::<HashMap<_, _>>();
    for package in incoming {
        if let Some(index) = by_id.get(&package.manifest.id).copied() {
            out[index] = package;
        } else {
            by_id.insert(package.manifest.id.clone(), out.len());
            out.push(package);
        }
    }
}

fn validate_js_tool_manifest(manifest: &AgentComponentJsToolManifest) -> CoreResult<()> {
    validate_agent_component_id(&manifest.name)?;
    if manifest.runtime != "javascript" {
        return Err(CoreError::validation(
            "Agent Component runtime tools currently support runtime=javascript only",
        ));
    }
    if manifest.entry.trim().is_empty()
        || Path::new(&manifest.entry).is_absolute()
        || Path::new(&manifest.entry)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(CoreError::validation(
            "JS runtime tool entry must be a relative path inside the Agent Component",
        ));
    }
    if manifest.readonly
        && (!manifest.permissions.fs.write.is_empty()
            || !manifest.permissions.shell.allow.is_empty())
    {
        return Err(CoreError::validation(
            "Readonly JS runtime tools cannot request write or shell permissions",
        ));
    }
    Ok(())
}

pub struct AgentComponentRuntimeToolAdapter {
    app_id: String,
    app_dir: PathBuf,
    bridge_capabilities: Vec<AgentComponentBridgeCapabilityRef>,
    private_bridge_package_dirs: HashMap<String, PathBuf>,
    manifest: AgentComponentJsToolManifest,
    tool_name: String,
}

impl AgentComponentRuntimeToolAdapter {
    pub fn new(
        app_id: String,
        app_dir: PathBuf,
        bridge_capabilities: Vec<AgentComponentBridgeCapabilityRef>,
        manifest: AgentComponentJsToolManifest,
        private_bridge_package_dirs: HashMap<String, PathBuf>,
    ) -> Self {
        let tool_name = format!(
            "{}__{}__{}",
            AGENT_COMPONENT_RUNTIME_TOOL_PREFIX, app_id, manifest.name
        );
        Self {
            app_id,
            app_dir,
            bridge_capabilities,
            private_bridge_package_dirs,
            manifest,
            tool_name,
        }
    }
}

#[async_trait]
impl Tool for AgentComponentRuntimeToolAdapter {
    fn name(&self) -> &str {
        &self.tool_name
    }

    async fn description(&self) -> CoreResult<String> {
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

    fn tool_ui_metadata(&self) -> Option<Value> {
        self.manifest.ui.clone()
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> CoreResult<Vec<ToolResult>> {
        validate_js_input_subset(&self.manifest.input_schema, input)?;
        let workspace_root = context.workspace_root().map(Path::to_path_buf);
        let value = js_runtime::run_js_tool(
            &self.app_dir,
            &self.manifest,
            input,
            workspace_root.as_deref(),
        )
        .await?;
        if let Some(bridge_call) = value.get("bridgeCall").or_else(|| value.get("bridge_call")) {
            return self.execute_bridge_call(bridge_call, context, &value).await;
        }
        let summary = value
            .get("summary")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("Agent Component JS tool {} completed", self.manifest.name));
        Ok(vec![ToolResult::ok(
            json!({
                "component_id": self.app_id,
                "tool": self.manifest.name,
                "result": value,
            }),
            Some(summary),
        )])
    }
}

impl AgentComponentRuntimeToolAdapter {
    async fn execute_bridge_call(
        &self,
        bridge_call: &Value,
        context: &ToolUseContext,
        runtime_value: &Value,
    ) -> CoreResult<Vec<ToolResult>> {
        let bridge_id = bridge_call
            .get("bridgeId")
            .and_then(Value::as_str)
            .or_else(|| bridge_call.get("bridge_id").and_then(Value::as_str))
            .ok_or_else(|| CoreError::validation("bridgeCall.bridgeId is required"))?;
        let capability_id = bridge_call
            .get("capabilityId")
            .and_then(Value::as_str)
            .or_else(|| bridge_call.get("capability_id").and_then(Value::as_str))
            .ok_or_else(|| CoreError::validation("bridgeCall.capabilityId is required"))?;
        let action = bridge_call
            .get("action")
            .and_then(Value::as_str)
            .ok_or_else(|| CoreError::validation("bridgeCall.action is required"))?;
        if !self.allows_bridge_capability(bridge_id, capability_id) {
            return Err(CoreError::validation(format!(
                "Agent Component '{}' is not allowed to use Bridge capability '{}:{}'",
                self.app_id, bridge_id, capability_id
            )));
        }
        let mut payload = bridge_call
            .get("input")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let mut user_input = None;
        if let Some(await_spec) = runtime_value
            .get("awaitUserInput")
            .or_else(|| runtime_value.get("await_user_input"))
        {
            let mode = await_spec.get("mode").and_then(Value::as_str).unwrap_or("");
            if mode != "mergeIntoBridgeInput" {
                return Err(CoreError::validation(
                    "awaitUserInput.mode must be 'mergeIntoBridgeInput'",
                ));
            }
            let tool_id = context.tool_call_id.clone().ok_or_else(|| {
                CoreError::validation(
                    "This interactive Agent Component tool requires a tool_call_id",
                )
            })?;
            let timeout_ms = await_spec
                .get("timeoutMs")
                .or_else(|| await_spec.get("timeout_ms"))
                .and_then(Value::as_u64)
                .unwrap_or(600_000)
                .clamp(1_000, 600_000);
            let (tx, rx) = tokio::sync::oneshot::channel();
            let manager = get_user_input_manager();
            manager.register_channel(tool_id.clone(), tx);
            info!(
                "Agent Component tool waiting for user input: tool_name={}, tool_id={}",
                self.manifest.name, tool_id
            );
            let response = match timeout(Duration::from_millis(timeout_ms), rx).await {
                Ok(Ok(response)) => response,
                Ok(Err(_)) => {
                    return Err(CoreError::tool(format!(
                        "Interactive Agent Component tool '{}' was cancelled",
                        self.manifest.name
                    )))
                }
                Err(_) => {
                    manager.cancel(&tool_id);
                    return Err(CoreError::tool(format!(
                        "Interactive Agent Component tool '{}' timed out waiting for user input",
                        self.manifest.name
                    )));
                }
            };
            payload = merge_bridge_input(payload, &response.answers)?;
            user_input = Some(response.answers);
        }
        let workspace_path = Some(
            context
                .workspace_root()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| get_path_manager_arc().agentic_os_runtime_root())
                .to_string_lossy()
                .to_string(),
        );
        let consumer = BridgeComponentConsumer {
            kind: BridgeComponentConsumerKind::AgentComponent,
            id: self.app_id.clone(),
            session_id: context.session_id.clone(),
            turn_id: context.dialog_turn_id.clone(),
            work_id: context.product_app_work_id().map(str::to_string),
            work_title: None,
            runtime_instance_id: context
                .product_app_runtime_instance_id()
                .map(str::to_string),
        };
        let result = if let Some(package_dir) = self.private_bridge_package_dirs.get(bridge_id) {
            BridgeComponentManager::start_run_from_package_dir(
                package_dir,
                Some(capability_id),
                action,
                payload,
                workspace_path,
                consumer,
            )
            .await?
        } else {
            BridgeComponentManager::start_run(
                bridge_id,
                Some(capability_id),
                action,
                payload,
                workspace_path,
                consumer,
            )
            .await?
        };
        // A Bridge invocation can return normally at the transport layer while its
        // business operation has failed. Never let the Agent Component's static
        // success summary overwrite that terminal status: returning an error here
        // makes the tool pipeline emit a failed event and an `is_error` tool result
        // to the next model round.
        ensure_bridge_run_completed(
            &format!("Agent Component tool '{}'", self.manifest.name),
            &result,
        )?;
        let summary = runtime_value
            .get("summary")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| {
                format!(
                    "Agent Component runtime tool {} completed",
                    self.manifest.name
                )
            });
        let result_for_assistant = bridge_run_result_for_assistant(Some(&summary), &result);
        Ok(vec![ToolResult::ok(
            json!({
                "component_id": self.app_id,
                "tool": self.manifest.name,
                "runtime": runtime_value,
                "user_input": user_input,
                "bridge": {
                    "run_id": result.run_id,
                    "bridge_id": result.component_id,
                    "capability_id": result.capability_id,
                    "action": result.action,
                    "status": result.status,
                    "output": result.output,
                    "events": result.events,
                    "stderr": result.stderr,
                }
            }),
            Some(result_for_assistant),
        )])
    }

    fn allows_bridge_capability(&self, bridge_id: &str, capability_id: &str) -> bool {
        self.bridge_capabilities.iter().any(|capability| {
            capability.bridge_id == bridge_id && capability.capability_id == capability_id
        })
    }
}

fn merge_bridge_input(mut payload: Value, answers: &Value) -> CoreResult<Value> {
    let payload_object = payload
        .as_object_mut()
        .ok_or_else(|| CoreError::validation("Interactive bridgeCall.input must be an object"))?;
    let answer_object = answers
        .as_object()
        .ok_or_else(|| CoreError::validation("Interactive tool answers must be an object"))?;
    for (key, value) in answer_object {
        payload_object.insert(key.clone(), value.clone());
    }
    Ok(payload)
}

fn validate_js_input_subset(schema: &Value, input: &Value) -> CoreResult<()> {
    if schema.get("type").and_then(Value::as_str) != Some("object") {
        return Ok(());
    }
    let object = input
        .as_object()
        .ok_or_else(|| CoreError::validation("Agent Component JS tool input must be an object"))?;
    if let Some(required) = schema.get("required").and_then(Value::as_array) {
        for field in required.iter().filter_map(Value::as_str) {
            if !object.contains_key(field) {
                return Err(CoreError::validation(format!(
                    "Agent Component JS tool input is missing required field '{}'",
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
                    return Err(CoreError::validation(format!(
                        "Agent Component JS tool input contains unknown field '{}'",
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
                return Err(CoreError::validation(format!(
                    "Agent Component JS tool input field '{}' must be {}",
                    key, expected
                )));
            }
        }
    }
    Ok(())
}
