use serde::{Deserialize, Serialize};

use super::AppIconSpec;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppManifestIdentity {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: AppIconSpec,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
}
