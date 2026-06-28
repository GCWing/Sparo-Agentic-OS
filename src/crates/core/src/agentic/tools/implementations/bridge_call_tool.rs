use crate::agent_component::AgentComponentManager;
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::bridge_component::{
    BridgeComponentConsumer, BridgeComponentConsumerKind, BridgeComponentManager,
};
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct BridgeComponentCallTool;

impl BridgeComponentCallTool {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for BridgeComponentCallTool {
    fn name(&self) -> &str {
        "BridgeComponentCall"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok("Call a declared Bridge Component capability action for an Agent Component or internal runtime workflow. Use this for external SDK, CLI, GUI, service, daemon, or MCP bridge capabilities instead of embedding bridge logic in the Agent Component.".to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["bridge_id", "capability_id", "action"],
            "properties": {
                "bridge_id": { "type": "string" },
                "capability_id": { "type": "string" },
                "action": { "type": "string" },
                "input": { "type": "object" },
                "mode": { "type": "string", "enum": ["auto", "sync"], "default": "auto" }
            },
            "additionalProperties": false
        })
    }

    fn user_facing_name(&self) -> String {
        "Bridge Component Call".to_string()
    }

    fn is_concurrency_safe(&self, _input: Option<&Value>) -> bool {
        false
    }

    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        true
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> BitFunResult<Vec<ToolResult>> {
        let bridge_id = input
            .get("bridge_id")
            .and_then(Value::as_str)
            .or_else(|| input.get("bridgeId").and_then(Value::as_str))
            .ok_or_else(|| BitFunError::validation("bridge_id is required"))?;
        let capability_id = input
            .get("capability_id")
            .and_then(Value::as_str)
            .or_else(|| input.get("capabilityId").and_then(Value::as_str))
            .ok_or_else(|| BitFunError::validation("capability_id is required"))?;
        let action = input
            .get("action")
            .and_then(Value::as_str)
            .ok_or_else(|| BitFunError::validation("action is required"))?;
        let payload = input.get("input").cloned().unwrap_or_else(|| json!({}));
        let workspace_path = context
            .workspace_root()
            .map(|path| path.to_string_lossy().to_string());
        let consumer_id = context
            .agent_type
            .clone()
            .unwrap_or_else(|| "agent-component".to_string());
        if let Ok(agent_package) =
            AgentComponentManager::get(&consumer_id, None, context.workspace_root())
        {
            let declared = agent_package
                .manifest
                .bridge_capabilities
                .iter()
                .any(|capability| {
                    capability.bridge_id == bridge_id && capability.capability_id == capability_id
                });
            if !declared {
                return Err(BitFunError::validation(format!(
                    "Agent Component '{}' has not declared Bridge capability '{}:{}'",
                    consumer_id, bridge_id, capability_id
                )));
            }
        }
        let consumer = BridgeComponentConsumer {
            kind: BridgeComponentConsumerKind::AgentComponent,
            id: consumer_id,
            session_id: context.session_id.clone(),
            turn_id: context.dialog_turn_id.clone(),
        };

        let result = BridgeComponentManager::start_run(
            bridge_id,
            Some(capability_id),
            action,
            payload,
            workspace_path,
            consumer,
        )
        .await?;

        Ok(vec![ToolResult::ok(
            json!({
                "run_id": result.run_id,
                "bridge_component_id": result.component_id,
                "capability_id": result.capability_id,
                "action": result.action,
                "status": result.status,
                "output": result.output,
                "events": result.events,
                "stderr": result.stderr,
            }),
            Some(format!(
                "Bridge capability {} action {} finished with status {:?}",
                capability_id, action, result.status
            )),
        )])
    }
}
