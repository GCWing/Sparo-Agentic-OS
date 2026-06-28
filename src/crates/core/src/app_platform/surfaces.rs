use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSurfaces {
    #[serde(default)]
    pub launchable_app: bool,
    #[serde(default)]
    pub agent: bool,
    #[serde(default)]
    pub tool: bool,
    #[serde(default)]
    pub surface_component_backend: bool,
}
