//! Platform-agnostic CLI Bridge adapter contracts.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliBridgeCommand {
    pub executable: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliBridgeRequest {
    pub command: CliBridgeCommand,
    #[serde(default)]
    pub input: Value,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliBridgeResponse {
    pub exit_code: i32,
    #[serde(default)]
    pub stdout: String,
    #[serde(default)]
    pub stderr: String,
    #[serde(default)]
    pub output: Value,
}

pub trait CliBridgeAdapter: Send + Sync {
    fn run(
        &self,
        request: CliBridgeRequest,
    ) -> crate::util::errors::BitFunResult<CliBridgeResponse>;
}

fn default_timeout_ms() -> u64 {
    600_000
}
