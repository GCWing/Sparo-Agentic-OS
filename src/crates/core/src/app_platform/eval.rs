use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppEvalPlan {
    #[serde(default = "default_eval_plan_version")]
    pub version: u32,
    #[serde(default)]
    pub cases: Vec<ProductAppEvalCase>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppEvalCase {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub implementation_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub input: Value,
    #[serde(default)]
    pub expectations: Vec<ProductAppEvalExpectation>,
    #[serde(default = "default_eval_evidence_kind")]
    pub evidence_kind: ProductAppEvalEvidenceKind,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default = "default_required")]
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAppEvalExpectation {
    #[serde(default = "default_eval_expectation_kind")]
    pub kind: ProductAppEvalExpectationKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProductAppEvalExpectationKind {
    JsonEquals,
    JsonContains,
    TextContains,
    ResultCountAtLeast,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProductAppEvalEvidenceKind {
    Behavior,
    RuntimeBinding,
    JsTool,
}

fn default_eval_plan_version() -> u32 {
    1
}

fn default_eval_expectation_kind() -> ProductAppEvalExpectationKind {
    ProductAppEvalExpectationKind::JsonContains
}

fn default_eval_evidence_kind() -> ProductAppEvalEvidenceKind {
    ProductAppEvalEvidenceKind::Behavior
}

fn default_required() -> bool {
    true
}
