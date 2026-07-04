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
    pub product_app_runtime_backend: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ProductAppRuntimeState {
    pub source_revision: String,
    pub deps_revision: String,
    pub deps_dirty: bool,
    pub worker_restart_required: bool,
    pub ui_recompile_required: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProductAppRuntimeIssueSeverity {
    Fatal,
    Warning,
    Noise,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProductAppRuntimeLogLevel {
    Debug,
    Info,
    Warn,
    Error,
}
