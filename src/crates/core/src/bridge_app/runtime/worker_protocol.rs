use crate::bridge_app::BridgeAppEvent;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeWorkerStartRequest {
    pub app_id: String,
    pub action: String,
    #[serde(default)]
    pub input: Value,
    #[serde(default)]
    pub workspace_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeWorkerEnvelope {
    pub app_id: String,
    pub run_id: String,
    pub event: BridgeAppEvent,
}
