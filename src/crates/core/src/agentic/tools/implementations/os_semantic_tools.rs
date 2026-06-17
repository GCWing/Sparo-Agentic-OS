use std::path::Path;

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::agentic::agents::get_agent_registry;
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext, ValidationResult};
use crate::agentic::tools::implementations::work_tool_support::work_service_from_tool_context;
use crate::agentic_os::work::{WorkId, WorkProjection, WorkScope, WorkStatus};
use crate::infrastructure::get_path_manager_arc;
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

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum OSStatusAction {
    Overview,
    Works,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum OSStatusWorkScope {
    CurrentWorkspace,
    System,
    All,
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
    #[serde(default = "default_work_scope")]
    work_scope: OSStatusWorkScope,
    #[serde(default)]
    workspace_path: Option<String>,
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
        Ok("Read Agentic OS status: current session and scoped Work. Defaults to the current workspace/system scope; use work_scope=all only when the user explicitly asks for all Agentic OS Work. Read-only; it never creates or changes Work.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["overview", "works"],
                    "description": "overview: session, workspace, and scoped Work together. works: list scoped Work, or one Work when work_id is set."
                },
                "work_id": {
                    "type": "string",
                    "description": "For works: inspect this single Work instead of listing."
                },
                "work_scope": {
                    "type": "string",
                    "enum": ["current_workspace", "system", "all"],
                    "description": "Which Work scope to list. Defaults to current_workspace. Use all only for an explicit global Work audit."
                },
                "workspace_path": {
                    "type": "string",
                    "description": "Optional exact workspace path to list. When set, it overrides work_scope and returns only Work scoped to that workspace."
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
        let work_scope = resolve_work_scope_filter(&input, context);
        let data = match input.action {
            OSStatusAction::Overview => {
                let works = list_work_projections(
                    context,
                    &work_scope,
                    input.include_archived,
                    input.limit,
                )
                .await
                .unwrap_or_default();
                json!({
                    "action": "overview",
                    "session": session_snapshot(context),
                    "workspace": workspace_snapshot(context),
                    "workScope": work_scope.to_json(),
                    "workCount": works.len(),
                    "activeWorkCount": works.len(),
                    "works": works,
                })
            }
            OSStatusAction::Works => {
                let works = if let Some(work_id) = input.work_id.as_deref() {
                    vec![get_work_projection(context, work_id).await?]
                } else {
                    list_work_projections(context, &work_scope, input.include_archived, input.limit)
                        .await?
                };
                json!({
                    "action": "works",
                    "workScope": work_scope.to_json(),
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

fn default_work_scope() -> OSStatusWorkScope {
    OSStatusWorkScope::CurrentWorkspace
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

#[derive(Debug, Clone, PartialEq, Eq)]
enum WorkScopeFilter {
    All,
    System,
    WorkspacePath(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedWorkScopeFilter {
    mode: &'static str,
    filter: WorkScopeFilter,
}

impl ResolvedWorkScopeFilter {
    fn matches(&self, scope: &WorkScope) -> bool {
        match (&self.filter, scope) {
            (WorkScopeFilter::All, _) => true,
            (WorkScopeFilter::System, WorkScope::System) => true,
            (WorkScopeFilter::WorkspacePath(expected), WorkScope::Workspace { workspace_path }) => {
                paths_equal_for_scope(expected, workspace_path)
            }
            _ => false,
        }
    }

    fn filter_name(&self) -> &'static str {
        match &self.filter {
            WorkScopeFilter::All => "all",
            WorkScopeFilter::System => "system",
            WorkScopeFilter::WorkspacePath(_) => "workspace",
        }
    }

    fn workspace_path(&self) -> Option<&str> {
        match &self.filter {
            WorkScopeFilter::WorkspacePath(path) => Some(path.as_str()),
            _ => None,
        }
    }

    fn to_json(&self) -> Value {
        json!({
            "mode": self.mode,
            "filter": self.filter_name(),
            "workspacePath": self.workspace_path(),
        })
    }
}

fn resolve_work_scope_filter(
    input: &OSStatusInput,
    context: &ToolUseContext,
) -> ResolvedWorkScopeFilter {
    if let Some(workspace_path) = input
        .workspace_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return ResolvedWorkScopeFilter {
            mode: "workspace_path",
            filter: WorkScopeFilter::WorkspacePath(workspace_path.to_string()),
        };
    }

    match input.work_scope {
        OSStatusWorkScope::CurrentWorkspace => current_workspace_work_scope_filter(context),
        OSStatusWorkScope::System => ResolvedWorkScopeFilter {
            mode: "system",
            filter: WorkScopeFilter::System,
        },
        OSStatusWorkScope::All => ResolvedWorkScopeFilter {
            mode: "all",
            filter: WorkScopeFilter::All,
        },
    }
}

fn current_workspace_work_scope_filter(context: &ToolUseContext) -> ResolvedWorkScopeFilter {
    let paths = get_path_manager_arc();
    if let Some(workspace_root) = context.workspace_root() {
        if paths_equal_for_scope(workspace_root, paths.agentic_os_runtime_root()) {
            return ResolvedWorkScopeFilter {
                mode: "current_workspace",
                filter: WorkScopeFilter::System,
            };
        }

        return ResolvedWorkScopeFilter {
            mode: "current_workspace",
            filter: WorkScopeFilter::WorkspacePath(path_to_string_lossy(workspace_root)),
        };
    }

    ResolvedWorkScopeFilter {
        mode: "current_workspace",
        filter: WorkScopeFilter::System,
    }
}

async fn list_work_projections(
    context: &ToolUseContext,
    work_scope: &ResolvedWorkScopeFilter,
    include_archived: bool,
    limit: usize,
) -> BitFunResult<Vec<WorkProjection>> {
    let service = work_service_from_tool_context(context)?;
    let mut works = service
        .list()
        .await?
        .into_iter()
        .filter(|record| {
            (include_archived || !matches!(record.status, WorkStatus::Archived))
                && work_scope.matches(&record.scope)
        })
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

fn path_to_string_lossy(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().into_owned()
}

fn paths_equal_for_scope(left: impl AsRef<Path>, right: impl AsRef<Path>) -> bool {
    comparable_path_for_scope(left) == comparable_path_for_scope(right)
}

fn comparable_path_for_scope(path: impl AsRef<Path>) -> String {
    let mut value = dunce::simplified(path.as_ref())
        .to_string_lossy()
        .replace('\\', "/");

    while value.ends_with('/') && !value.ends_with(":/") && value.len() > 1 {
        value.pop();
    }

    if cfg!(windows) {
        value.to_ascii_lowercase()
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agentic::WorkspaceBinding;
    use std::collections::HashMap;
    use std::path::PathBuf;

    fn context_with_workspace(root_path: PathBuf) -> ToolUseContext {
        ToolUseContext {
            tool_call_id: None,
            agent_type: None,
            session_id: None,
            dialog_turn_id: None,
            workspace: Some(WorkspaceBinding::new(None, root_path)),
            custom_data: HashMap::new(),
            computer_use_host: None,
            cancellation_token: None,
            runtime_tool_restrictions: Default::default(),
            workspace_services: None,
            workspace_mount: None,
            agentic: None,
        }
    }

    fn status_input(work_scope: OSStatusWorkScope) -> OSStatusInput {
        OSStatusInput {
            action: OSStatusAction::Overview,
            work_id: None,
            limit: DEFAULT_STATUS_LIMIT,
            include_archived: false,
            work_scope,
            workspace_path: None,
        }
    }

    #[test]
    fn current_workspace_scope_maps_agentic_os_runtime_to_system() {
        let context = context_with_workspace(get_path_manager_arc().agentic_os_runtime_root());
        let resolved =
            resolve_work_scope_filter(&status_input(OSStatusWorkScope::CurrentWorkspace), &context);

        assert_eq!(resolved.mode, "current_workspace");
        assert_eq!(resolved.filter, WorkScopeFilter::System);
        assert!(resolved.matches(&WorkScope::System));
        assert!(!resolved.matches(&WorkScope::Workspace {
            workspace_path: "D:/code/warp-master".to_string(),
        }));
    }

    #[test]
    fn all_scope_matches_system_and_workspace_work() {
        let context = context_with_workspace(get_path_manager_arc().agentic_os_runtime_root());
        let resolved = resolve_work_scope_filter(&status_input(OSStatusWorkScope::All), &context);

        assert_eq!(resolved.mode, "all");
        assert_eq!(resolved.filter, WorkScopeFilter::All);
        assert!(resolved.matches(&WorkScope::System));
        assert!(resolved.matches(&WorkScope::Workspace {
            workspace_path: "D:/code/warp-master".to_string(),
        }));
    }

    #[test]
    fn explicit_workspace_path_overrides_scope_and_normalizes_separators() {
        let workspace = std::env::temp_dir().join("sparo-os-status-tool-project");
        let workspace_path = path_to_string_lossy(&workspace);
        let alternate_workspace_path = format!("{}/", workspace_path.replace('\\', "/"));
        let mut input = status_input(OSStatusWorkScope::All);
        input.workspace_path = Some(alternate_workspace_path);
        let context = context_with_workspace(get_path_manager_arc().agentic_os_runtime_root());

        let resolved = resolve_work_scope_filter(&input, &context);

        assert_eq!(resolved.mode, "workspace_path");
        assert!(matches!(resolved.filter, WorkScopeFilter::WorkspacePath(_)));
        assert!(resolved.matches(&WorkScope::Workspace { workspace_path }));
        assert!(!resolved.matches(&WorkScope::System));
    }
}
