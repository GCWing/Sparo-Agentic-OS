use serde::{Deserialize, Serialize};

use super::ids::WorkId;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WorkSurfaceRef {
    OsAgentHome {
        dispatcher_session_id: Option<String>,
    },
    WorkSession {
        session_id: String,
    },
    AgentSession {
        session_id: String,
    },
    LiveApp {
        app_id: String,
    },
    WorkCenter {
        work_id: WorkId,
    },
    ApplicationSurface {
        application_id: String,
        surface_id: String,
    },
}
