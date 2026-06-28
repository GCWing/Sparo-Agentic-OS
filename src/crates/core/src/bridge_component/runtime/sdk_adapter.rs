//! Platform-agnostic SDK Bridge adapter contracts.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdkBridgeInvocation {
    pub package: String,
    pub method: String,
    #[serde(default)]
    pub input: Value,
    #[serde(default)]
    pub secrets: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdkBridgeResponse {
    pub ok: bool,
    #[serde(default)]
    pub output: Value,
    #[serde(default)]
    pub events: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub trait SdkBridgeAdapter: Send + Sync {
    fn invoke(
        &self,
        invocation: SdkBridgeInvocation,
    ) -> crate::util::errors::BitFunResult<SdkBridgeResponse>;
}
