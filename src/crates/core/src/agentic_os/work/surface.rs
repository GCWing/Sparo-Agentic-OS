use serde::{Deserialize, Serialize};

use super::ids::WorkId;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WorkSurfaceRef {
    OsAgentHome {
        #[serde(alias = "dispatcher_session_id")]
        agentic_os_session_id: Option<String>,
    },
    WorkSession {
        session_id: String,
    },
    AgentSession {
        session_id: String,
    },
    WorkCenter {
        work_id: WorkId,
    },
    ApplicationSurface {
        product_app_id: String,
        product_app_surface_id: String,
        surface_id: String,
    },
}
