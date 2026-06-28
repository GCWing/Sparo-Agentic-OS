use crate::bridge_component::{BridgeComponentConsumer, BridgeComponentEvent};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeWorkerStartRequest {
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
    pub consumer: BridgeComponentConsumer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeWorkerEnvelope {
    pub bridge_id: String,
    pub run_id: String,
    pub event: BridgeComponentEvent,
}
