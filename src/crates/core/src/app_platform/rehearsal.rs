use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRehearsalPlan {
    #[serde(default = "default_rehearsal_plan_version")]
    pub version: u32,
    #[serde(default)]
    pub scenarios: Vec<ProductAppRehearsalScenario>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRehearsalScenario {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_rehearsal_scenario_kind")]
    pub kind: ProductAppRehearsalScenarioKind,
    #[serde(default)]
    pub steps: Vec<ProductAppRehearsalStep>,
    #[serde(default)]
    pub expected: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProductAppRehearsalScenarioKind {
    UserPath,
    AgentChat,
    Capability,
    ReleaseGate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppRehearsalStep {
    pub id: String,
    pub action: ProductAppRehearsalAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default)]
    pub expect: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProductAppRehearsalAction {
    Open,
    Focus,
    Click,
    Type,
    Submit,
    Observe,
}

fn default_rehearsal_plan_version() -> u32 {
    1
}

fn default_rehearsal_scenario_kind() -> ProductAppRehearsalScenarioKind {
    ProductAppRehearsalScenarioKind::UserPath
}
