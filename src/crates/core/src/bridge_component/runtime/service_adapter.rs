//! Platform-agnostic service Bridge adapter contracts.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceBridgeEndpoint {
    pub base_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceBridgeRequest {
    pub endpoint: ServiceBridgeEndpoint,
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub body: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceBridgeResponse {
    pub status: u16,
    #[serde(default)]
    pub body: Value,
    #[serde(default)]
    pub headers: Value,
}

pub trait ServiceBridgeAdapter: Send + Sync {
    fn request(
        &self,
        request: ServiceBridgeRequest,
    ) -> crate::error::CoreResult<ServiceBridgeResponse>;
}
