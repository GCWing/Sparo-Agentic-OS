use crate::agent_app::AgentAppManager;
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::bridge_app::{BridgeAppConsumer, BridgeAppConsumerKind, BridgeAppManager};
use crate::util::errors::{BitFunError, BitFunResult};
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct BridgeCallTool;

impl BridgeCallTool {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for BridgeCallTool {
    fn name(&self) -> &str {
        "BridgeCall"
    }

    async fn description(&self) -> BitFunResult<String> {
        Ok("Call a declared Bridge App capability action for an Agent App or internal runtime workflow. Use this for external SDK, CLI, GUI, service, daemon, or MCP bridge capabilities instead of embedding bridge logic in the Agent App.".to_string())
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
        "Bridge Call".to_string()
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
            .unwrap_or_else(|| "agent-app".to_string());
        if let Ok(agent_package) =
            AgentAppManager::get(&consumer_id, None, context.workspace_root())
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
                    "Agent App '{}' has not declared Bridge capability '{}:{}'",
                    consumer_id, bridge_id, capability_id
                )));
            }
        }
        let consumer = BridgeAppConsumer {
            kind: BridgeAppConsumerKind::AgentApp,
            id: consumer_id,
            session_id: context.session_id.clone(),
            turn_id: context.dialog_turn_id.clone(),
        };

        let result = BridgeAppManager::start_run(
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
                "bridge_id": result.app_id,
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
