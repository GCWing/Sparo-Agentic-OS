use crate::bridge_app::{BridgeAppConsumer, BridgeAppEvent};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeWorkerStartRequest {
    #[serde(alias = "appId", alias = "app_id")]
    pub bridge_id: String,
    #[serde(default)]
    pub capability_id: Option<String>,
    pub action: String,
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub input: Value,
    #[serde(default)]
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub consumer: BridgeAppConsumer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeWorkerEnvelope {
    pub bridge_id: String,
    pub run_id: String,
    pub event: BridgeAppEvent,
}
