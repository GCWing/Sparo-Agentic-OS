use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::agentic::agents::get_agent_registry;
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext, ValidationResult};
use crate::error::{CoreError, CoreResult};

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

    async fn description(&self) -> CoreResult<String> {
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
    ) -> CoreResult<Vec<ToolResult>> {
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
                    .ok_or_else(|| CoreError::validation("capability_id is required"))?;
                let profile = registry
                    .get_agent_capability_profile(capability_id, workspace_root)
                    .await
                    .ok_or_else(|| {
                        CoreError::NotFound(format!("Capability not found: {}", capability_id))
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
        "AppStudio" => CapabilityGuidance {
            domain: "product_apps",
            best_for: &[
                "create, repair, inspect, or operate Product App experiences",
                "create, repair, package, or improve reusable components used by Product Apps",
                "interactive artifact work that needs app runtime awareness",
            ],
            avoid_for: &["general coding outside Product App context"],
            quality_signal:
                "Produces or operates a working Product App experience with its component contracts.",
        },
        _ => CapabilityGuidance {
            domain: "custom_or_specialized",
            best_for: &["specialized tasks matching the capability description"],
            avoid_for: &["tasks outside the declared capability or disabled profiles"],
            quality_signal: "Use only when its profile clearly matches the desired output.",
        },
    }
}

fn parse_input<T>(input: &Value, tool_name: &str) -> CoreResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(input.clone())
        .map_err(|error| CoreError::validation(format!("Invalid {} input: {}", tool_name, error)))
}

fn validation_error(message: impl Into<String>) -> ValidationResult {
    ValidationResult {
        result: false,
        message: Some(message.into()),
        error_code: None,
        meta: None,
    }
}
