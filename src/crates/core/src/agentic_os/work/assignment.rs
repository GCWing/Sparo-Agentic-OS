use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkAssignmentKind {
    Agent,
    Assistant,
    Application,
    Human,
    External,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkAssignmentRef {
    pub kind: WorkAssignmentKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assistant_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub application_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub human_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_label: Option<String>,
}

impl WorkAssignmentRef {
    pub fn agent(agent_type: impl Into<String>) -> Self {
        Self {
            kind: WorkAssignmentKind::Agent,
            agent_type: Some(agent_type.into()),
            assistant_id: None,
            application_id: None,
            human_label: None,
            external_label: None,
        }
    }
}
