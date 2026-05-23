use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppCatalogKind {
    LiveApp,
    AgentApp,
    BridgeApp,
}

impl AppCatalogKind {
    pub fn catalog_order(self) -> u8 {
        match self {
            Self::LiveApp => 0,
            Self::AgentApp => 1,
            Self::BridgeApp => 2,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCatalogEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub kind: AppCatalogKind,
    pub icon: String,
    pub category: String,
    pub enabled: bool,
}
