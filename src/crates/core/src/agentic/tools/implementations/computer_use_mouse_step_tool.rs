//! Cardinal pointer step (up/down/left/right) for Computer use.

use crate::agentic::tools::computer_use_capability::computer_use_tool_enabled;
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::agentic::tools::implementations::computer_use_tool::computer_use_execute_mouse_step;
use crate::error::{CoreError, CoreResult};
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct ComputerUseMouseStepTool;

impl Default for ComputerUseMouseStepTool {
    fn default() -> Self {
        Self::new()
    }
}

impl ComputerUseMouseStepTool {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for ComputerUseMouseStepTool {
    fn name(&self) -> &str {
        "ComputerUseMouseStep"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(
            "Move the pointer **one cardinal step** (up / down / left / right) by **`pixels`** (default 32, clamped 1..400) — same as **`ComputerUse`** **`pointer_move_rel`** on macOS scale. **Host blocks this immediately after a `screenshot`** until you reposition with **`move_to_text`**, **`mouse_move`** (`use_screen_coordinates`: true), or **`click_element`** (do not nudge from the JPEG). For diagonals, use **`ComputerUse`** **`pointer_move_rel`**.".to_string(),
        )
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "direction": {
                    "type": "string",
                    "enum": ["up", "down", "left", "right"],
                    "description": "Cardinal direction for the step."
                },
                "pixels": {
                    "type": "integer",
                    "description": "Distance in screenshot/display pixels (default 32, clamped 1..400). Use smaller values (e.g. 8–24) for fine alignment."
                }
            },
            "required": ["direction"],
            "additionalProperties": false
        })
    }

    fn is_readonly(&self) -> bool {
        false
    }

    fn is_concurrency_safe(&self, _input: Option<&Value>) -> bool {
        false
    }

    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        true
    }

    fn allows_confirmation_bypass(&self, _input: Option<&Value>) -> bool {
        false
    }

    async fn is_enabled(&self) -> bool {
        computer_use_tool_enabled().await
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> CoreResult<Vec<ToolResult>> {
        if context.is_remote() {
            return Err(CoreError::tool(
                "ComputerUseMouseStep cannot run while the session workspace is remote (SSH)."
                    .to_string(),
            ));
        }
        let host = context.computer_use_host.as_ref().ok_or_else(|| {
            CoreError::tool(
                "Computer use is only available in the Sparo OS desktop app.".to_string(),
            )
        })?;

        computer_use_execute_mouse_step(host.as_ref(), input).await
    }
}
