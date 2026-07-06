//! Platform-agnostic GUI Bridge adapter contracts.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuiBridgeTarget {
    pub app_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub process_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuiBridgeObservation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screenshot_artifact_id: Option<String>,
    #[serde(default)]
    pub accessibility_tree: Value,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum GuiBridgeAction {
    Observe,
    Click { x: f64, y: f64 },
    TypeText { text: String },
    KeyPress { key: String },
    Wait { timeout_ms: u64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuiBridgeRequest {
    pub target: GuiBridgeTarget,
    pub action: GuiBridgeAction,
    #[serde(default)]
    pub input: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuiBridgeResponse {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observation: Option<GuiBridgeObservation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub trait GuiBridgeAdapter: Send + Sync {
    fn handle(&self, request: GuiBridgeRequest) -> crate::error::CoreResult<GuiBridgeResponse>;
}
