use super::{prompt_builder, Agent, RequestContextPolicy};

mod bitfun_coder_agent;
mod bitfun_debug_agent;
mod bitfun_plan_agent;
mod bitfun_team_agent;
mod cowork_agent;
mod deep_research_agent;
mod design_agent;

pub use self::bitfun_coder_agent::BitFunCoderAgent;
pub use self::bitfun_debug_agent::BitFunDebugAgent;
pub use self::bitfun_plan_agent::BitFunPlanAgent;
pub use self::bitfun_team_agent::BitFunTeamAgent;
pub use self::cowork_agent::CoworkAgent;
pub use self::deep_research_agent::DeepResearchAgent;
pub use self::design_agent::DesignAgent;
