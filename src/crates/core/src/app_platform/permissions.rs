use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPermissionSummary {
    #[serde(default)]
    pub fs: bool,
    #[serde(default)]
    pub net: bool,
    #[serde(default)]
    pub shell: bool,
    #[serde(default)]
    pub gui: bool,
    #[serde(default)]
    pub secrets: bool,
    #[serde(default)]
    pub ai: bool,
}
