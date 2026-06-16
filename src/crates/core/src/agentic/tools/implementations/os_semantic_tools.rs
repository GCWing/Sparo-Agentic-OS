use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::agentic::agents::get_agent_registry;
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext, ValidationResult};
use crate::agentic::tools::implementations::work_tool_support::work_service_from_tool_context;
use crate::agentic_os::work::{WorkId, WorkProjection, WorkStatus};
use crate::infrastructure::get_path_manager_arc;
use crate::service::system_fs::SystemFsService;
use crate::util::errors::{BitFunError, BitFunResult};

const DEFAULT_STATUS_LIMIT: usize = 20;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum CapabilityRegistryAction {
    List,
    Get,
}

#[derive(Debug, Deserialize)]
struct CapabilityRegistryInput {
    action: CapabilityRegistryAction,
    #[serde(default)]
    capability_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum NativeOSAction {
    Overview,
    KnownLocations,
    ExplainPath,
}

#[derive(Debug, Deserialize)]
struct NativeOSInput {
    action: NativeOSAction,
    #[serde(default)]
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum OSStatusAction {
    Overview,
    Works,
}

#[derive(Debug, Deserialize)]
struct OSStatusInput {
    action: OSStatusAction,
    #[serde(default)]
    work_id: Option<String>,
    #[serde(default = "default_status_limit")]
    limit: usize,
    #[serde(default)]
    include_archived: bool,
}

pub struct CapabilityRegistryTool;

impl CapabilityRegistryTool {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for CapabilityRegistryTool {
    fn name(&self) -> &str {
        "CapabilityRegistry"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok("Inspect available specialist Agents before starting Work. Returns each capability's domain, what it is best and worst for, and its quality signal, so you can pick the right executor agent_type.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list", "get"],
                    "description": "list: all launchable capabilities with routing guidance. get: one capability profile."
                },
                "capability_id": {
                    "type": "string",
                    "description": "Required for get. The capability or agent id (for example agentic, Cowork, Design)."
                }
            },
            "required": ["action"]
        })
    }

    fn is_readonly(&self) -> bool {
        true
    }

    async fn validate_input(
        &self,
        input: &Value,
        _context: Option<&ToolUseContext>,
    ) -> ValidationResult {
        match serde_json::from_value::<CapabilityRegistryInput>(input.clone()) {
            Ok(parsed) => {
                if matches!(parsed.action, CapabilityRegistryAction::Get)
                    && parsed
                        .capability_id
                        .as_deref()
                        .unwrap_or_default()
                        .trim()
                        .is_empty()
                {
                    return validation_error("capability_id is required for action=get");
                }
                ValidationResult::default()
            }
            Err(error) => validation_error(format!("Invalid CapabilityRegistry input: {}", error)),
        }
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let input = parse_input::<CapabilityRegistryInput>(input, self.name())?;
        let registry = get_agent_registry();
        let workspace_root = context.workspace_root();

        let data = match input.action {
            CapabilityRegistryAction::List => {
                let capabilities = registry
                    .list_agents_info()
                    .await
                    .into_iter()
                    .map(|info| {
                        let guidance = capability_guidance(&info.id);
                        json!({
                            "id": info.id,
                            "name": info.name,
                            "description": info.description,
                            "enabled": info.enabled,
                            "toolCount": info.tool_count,
                            "defaultTools": info.default_tools,
                            "domain": guidance.domain,
                            "bestFor": guidance.best_for,
                            "avoidFor": guidance.avoid_for,
                            "qualitySignal": guidance.quality_signal,
                        })
                    })
                    .collect::<Vec<_>>();
                json!({
                    "action": "list",
                    "capabilities": capabilities,
                    "selectionPrinciple": "Route by required outcome quality and work surface, not by keywords alone."
                })
            }
            CapabilityRegistryAction::Get => {
                let capability_id = input
                    .capability_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|id| !id.is_empty())
                    .ok_or_else(|| BitFunError::validation("capability_id is required"))?;
                let profile = registry
                    .get_agent_capability_profile(capability_id, workspace_root)
                    .await
                    .ok_or_else(|| {
                        BitFunError::NotFound(format!("Capability not found: {}", capability_id))
                    })?;
                let guidance = capability_guidance(capability_id);
                json!({
                    "action": "get",
                    "capabilityId": capability_id,
                    "profile": profile,
                    "domain": guidance.domain,
                    "bestFor": guidance.best_for,
                    "avoidFor": guidance.avoid_for,
                    "qualitySignal": guidance.quality_signal,
                })
            }
        };

        Ok(vec![ToolResult::ok(data, None)])
    }
}

pub struct NativeOSTool;

impl NativeOSTool {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for NativeOSTool {
    fn name(&self) -> &str {
        "NativeOS"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok("Read native operating-system context: OS family, drives, known folders, workspace roots, and Sparo OS runtime paths. Also classifies where a given path lives and how to access it.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["overview", "known_locations", "explain_path"],
                    "description": "overview: OS, drives, and known locations. known_locations: user folders plus Sparo runtime paths. explain_path: classify one path (exists, file/dir, location, recommended access)."
                },
                "path": {
                    "type": "string",
                    "description": "Required for explain_path. Absolute, or relative to the current workspace."
                }
            },
            "required": ["action"]
        })
    }

    fn is_readonly(&self) -> bool {
        true
    }

    async fn validate_input(
        &self,
        input: &Value,
        _context: Option<&ToolUseContext>,
    ) -> ValidationResult {
        match serde_json::from_value::<NativeOSInput>(input.clone()) {
            Ok(parsed) => {
                if matches!(parsed.action, NativeOSAction::ExplainPath)
                    && parsed.path.as_deref().unwrap_or_default().trim().is_empty()
                {
                    return validation_error("path is required for action=explain_path");
                }
                ValidationResult::default()
            }
            Err(error) => validation_error(format!("Invalid NativeOS input: {}", error)),
        }
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let input = parse_input::<NativeOSInput>(input, self.name())?;
        let data = match input.action {
            NativeOSAction::Overview => json!({
                "action": "overview",
                "nativeOS": native_os_snapshot(context),
                "drives": SystemFsService::list_drives().unwrap_or_default(),
                "knownLocations": known_locations(),
            }),
            NativeOSAction::KnownLocations => json!({
                "action": "known_locations",
                "knownLocations": known_locations(),
                "sparoRuntimeLocations": sparo_runtime_locations(context),
            }),
            NativeOSAction::ExplainPath => {
                let path = input
                    .path
                    .as_deref()
                    .map(str::trim)
                    .filter(|path| !path.is_empty())
                    .ok_or_else(|| BitFunError::validation("path is required"))?;
                json!({
                    "action": "explain_path",
                    "path": explain_path(path, context),
                })
            }
        };

        Ok(vec![ToolResult::ok(data, None)])
    }
}

pub struct OSStatusTool;

impl OSStatusTool {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for OSStatusTool {
    fn name(&self) -> &str {
        "OSStatus"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok("Read Agentic OS status: current session and workspace context plus active Work. Read-only; it never creates or changes Work.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["overview", "works"],
                    "description": "overview: session, workspace, and active Work together. works: list Work, or one Work when work_id is set."
                },
                "work_id": {
                    "type": "string",
                    "description": "For works: inspect this single Work instead of listing."
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100,
                    "description": "Max Work to return when listing. Defaults to 20."
                },
                "include_archived": {
                    "type": "boolean",
                    "description": "Include archived Work when listing. Defaults to false."
                }
            },
            "required": ["action"]
        })
    }

    fn is_readonly(&self) -> bool {
        true
    }

    async fn validate_input(
        &self,
        input: &Value,
        _context: Option<&ToolUseContext>,
    ) -> ValidationResult {
        match serde_json::from_value::<OSStatusInput>(input.clone()) {
            Ok(parsed) => {
                if parsed.limit == 0 || parsed.limit > 100 {
                    return validation_error("limit must be between 1 and 100");
                }
                ValidationResult::default()
            }
            Err(error) => validation_error(format!("Invalid OSStatus input: {}", error)),
        }
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let input = parse_input::<OSStatusInput>(input, self.name())?;
        let data = match input.action {
            OSStatusAction::Overview => {
                let works = list_work_projections(context, input.include_archived, input.limit)
                    .await
                    .unwrap_or_default();
                json!({
                    "action": "overview",
                    "session": session_snapshot(context),
                    "workspace": workspace_snapshot(context),
                    "activeWorkCount": works.len(),
                    "works": works,
                })
            }
            OSStatusAction::Works => {
                let works = if let Some(work_id) = input.work_id.as_deref() {
                    vec![get_work_projection(context, work_id).await?]
                } else {
                    list_work_projections(context, input.include_archived, input.limit).await?
                };
                json!({
                    "action": "works",
                    "works": works,
                })
            }
        };

        Ok(vec![ToolResult::ok(data, None)])
    }
}

struct CapabilityGuidance {
    domain: &'static str,
    best_for: &'static [&'static str],
    avoid_for: &'static [&'static str],
    quality_signal: &'static str,
}

fn capability_guidance(id: &str) -> CapabilityGuidance {
    match id {
        "agentic" => CapabilityGuidance {
            domain: "software_engineering",
            best_for: &[
                "coding, debugging, refactoring, and tests",
                "repo-backed implementation or investigation",
                "technical diagnosis that must touch files or run commands",
            ],
            avoid_for: &[
                "office deliverables where editable document quality is the outcome",
                "pure emotional grounding or lightweight product discussion",
            ],
            quality_signal: "Produces code changes and verification rather than only advice.",
        },
        "Cowork" => CapabilityGuidance {
            domain: "office_deliverables",
            best_for: &[
                "PPT, documents, tables, reports, and business drafts",
                "polished artifacts where format and editability matter",
            ],
            avoid_for: &[
                "direct code implementation",
                "low-effort answers that OSAgent can handle inline",
            ],
            quality_signal:
                "Optimizes artifact structure, clarity, layout, and final handoff quality.",
        },
        "Design" => CapabilityGuidance {
            domain: "product_design",
            best_for: &[
                "UI/UX critique, visual direction, design systems, and interaction quality",
                "design work that needs taste and domain judgment",
            ],
            avoid_for: &["mechanical file search", "implementation-only coding work"],
            quality_signal:
                "Improves user experience and visual decision quality, not just wording.",
        },
        "DeepResearch" => CapabilityGuidance {
            domain: "research",
            best_for: &[
                "evidence gathering, synthesis, current-source research, and strategic analysis",
                "questions where missing facts would change the answer",
            ],
            avoid_for: &["small known facts", "direct local implementation tasks"],
            quality_signal: "Returns sourced findings, uncertainty, and decision implications.",
        },
        "LiveAppStudio" => CapabilityGuidance {
            domain: "live_apps",
            best_for: &[
                "create, repair, inspect, or operate live app experiences",
                "interactive artifact work that needs app runtime awareness",
            ],
            avoid_for: &["general coding outside live app context"],
            quality_signal: "Produces or operates a working live experience.",
        },
        "AgentAppStudio" => CapabilityGuidance {
            domain: "agent_apps",
            best_for: &["create, repair, package, or improve Agent Apps"],
            avoid_for: &["ordinary chat answers", "unrelated repo edits"],
            quality_signal:
                "Handles app manifest, tools, packaging, and validation as one outcome.",
        },
        _ => CapabilityGuidance {
            domain: "custom_or_specialized",
            best_for: &["specialized tasks matching the capability description"],
            avoid_for: &["tasks outside the declared capability or disabled profiles"],
            quality_signal: "Use only when its profile clearly matches the desired output.",
        },
    }
}

fn default_status_limit() -> usize {
    DEFAULT_STATUS_LIMIT
}

fn parse_input<T>(input: &Value, tool_name: &str) -> BitFunResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(input.clone())
        .map_err(|error| BitFunError::validation(format!("Invalid {} input: {}", tool_name, error)))
}

fn validation_error(message: impl Into<String>) -> ValidationResult {
    ValidationResult {
        result: false,
        message: Some(message.into()),
        error_code: None,
        meta: None,
    }
}

fn workspace_snapshot(context: &ToolUseContext) -> Value {
    let workspace_root = context
        .workspace_root()
        .map(|path| path.to_string_lossy().into_owned());
    json!({
        "kind": if workspace_root.is_some() { "workspace" } else { "system" },
        "root": workspace_root,
        "workspaceId": context.workspace_scope(),
        "isRemote": context.is_remote(),
    })
}

fn session_snapshot(context: &ToolUseContext) -> Value {
    json!({
        "agentType": context.agent_type,
        "sessionId": context.session_id,
        "dialogTurnId": context.dialog_turn_id,
        "toolCallId": context.tool_call_id,
    })
}

fn native_os_snapshot(context: &ToolUseContext) -> Value {
    json!({
        "os": std::env::consts::OS,
        "family": std::env::consts::FAMILY,
        "arch": std::env::consts::ARCH,
        "workspace": workspace_snapshot(context),
        "sparoRuntimeLocations": sparo_runtime_locations(context),
    })
}

fn known_locations() -> Value {
    json!({
        "quickFolders": SystemFsService::list_quick_folders(),
        "homeDir": path_to_string(dirs::home_dir()),
        "configDir": path_to_string(dirs::config_dir()),
        "dataDir": path_to_string(dirs::data_dir()),
        "cacheDir": path_to_string(dirs::cache_dir()),
        "desktopDir": path_to_string(dirs::desktop_dir()),
        "downloadDir": path_to_string(dirs::download_dir()),
        "documentDir": path_to_string(dirs::document_dir()),
    })
}

fn sparo_runtime_locations(context: &ToolUseContext) -> Value {
    let paths = get_path_manager_arc();
    let workspace_runtime_root = context
        .workspace_root()
        .map(|workspace_root| paths.workspace_runtime_root(workspace_root))
        .map(path_to_string_lossy);
    let workspace_memory_dir = context
        .workspace_root()
        .map(|workspace_root| paths.workspace_memory_dir(workspace_root))
        .map(path_to_string_lossy);

    json!({
        "appRoot": path_to_string_lossy(paths.app_root()),
        "userConfigDir": path_to_string_lossy(paths.user_config_dir()),
        "logsDir": path_to_string_lossy(paths.logs_dir()),
        "userDataDir": path_to_string_lossy(paths.user_data_dir()),
        "workspacesRuntimeRoot": path_to_string_lossy(paths.workspaces_runtime_root()),
        "workspaceRuntimeRoot": workspace_runtime_root,
        "workspaceMemoryDir": workspace_memory_dir,
        "agenticOSRuntimeRoot": path_to_string_lossy(paths.agentic_os_runtime_root()),
        "agenticOSMemoryDir": path_to_string_lossy(paths.agentic_os_memory_dir()),
        "agenticOSHostOverviewPath": path_to_string_lossy(paths.agentic_os_host_overview_path()),
        "agenticOSWorkspaceOverviewDir": path_to_string_lossy(paths.agentic_os_workspaces_overview_dir()),
    })
}

fn explain_path(input_path: &str, context: &ToolUseContext) -> Value {
    let requested = Path::new(input_path);
    let effective = if requested.is_absolute() {
        requested.to_path_buf()
    } else if let Some(workspace_root) = context.workspace_root() {
        workspace_root.join(requested)
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(requested)
    };
    let normalized = dunce::simplified(&effective).to_path_buf();
    let metadata = std::fs::metadata(&normalized).ok();
    let paths = get_path_manager_arc();

    json!({
        "requested": input_path,
        "absolute": requested.is_absolute(),
        "effectivePath": path_to_string_lossy(&normalized),
        "exists": metadata.is_some(),
        "isFile": metadata.as_ref().map(|m| m.is_file()).unwrap_or(false),
        "isDir": metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false),
        "readonly": metadata.as_ref().map(|m| m.permissions().readonly()).unwrap_or(false),
        "underWorkspace": context.workspace_root().map(|root| path_starts_with(&normalized, root)).unwrap_or(false),
        "underHome": dirs::home_dir().map(|home| path_starts_with(&normalized, &home)).unwrap_or(false),
        "underSparoAppRoot": path_starts_with(&normalized, &paths.app_root()),
        "underAgenticOSRuntime": path_starts_with(&normalized, &paths.agentic_os_runtime_root()),
        "recommendedAccess": recommended_path_access(&normalized, context),
    })
}

fn recommended_path_access(path: &Path, context: &ToolUseContext) -> &'static str {
    if context
        .workspace_root()
        .map(|root| path_starts_with(path, root))
        .unwrap_or(false)
    {
        return "workspace_tools";
    }

    let paths = get_path_manager_arc();
    if path_starts_with(path, &paths.agentic_os_runtime_root()) {
        return "os_runtime_readonly";
    }

    if dirs::home_dir()
        .map(|home| path_starts_with(path, &home))
        .unwrap_or(false)
    {
        return "native_os_user_area";
    }

    "native_os_unknown_area"
}

async fn list_work_projections(
    context: &ToolUseContext,
    include_archived: bool,
    limit: usize,
) -> BitFunResult<Vec<WorkProjection>> {
    let service = work_service_from_tool_context(context)?;
    let mut works = service
        .list()
        .await?
        .into_iter()
        .filter(|record| include_archived || !matches!(record.status, WorkStatus::Archived))
        .collect::<Vec<_>>();
    works.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(works
        .iter()
        .take(limit)
        .map(WorkProjection::from)
        .collect::<Vec<_>>())
}

async fn get_work_projection(
    context: &ToolUseContext,
    work_id: &str,
) -> BitFunResult<WorkProjection> {
    let service = work_service_from_tool_context(context)?;
    let work_id = WorkId::parse(work_id).map_err(BitFunError::validation)?;
    let record = service.get(&work_id).await?;
    Ok(WorkProjection::from(&record))
}

fn path_to_string(path: Option<PathBuf>) -> Option<String> {
    path.map(path_to_string_lossy)
}

fn path_to_string_lossy(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().into_owned()
}

fn path_starts_with(path: &Path, root: &Path) -> bool {
    let path = dunce::simplified(path);
    let root = dunce::simplified(root);
    path.starts_with(root)
}
