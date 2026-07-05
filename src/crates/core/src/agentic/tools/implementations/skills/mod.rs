//! Skill management module
//!
//! Provides Skill registry, loading, and configuration management functionality

pub mod agent_overrides;
pub mod builtin;
pub mod default_profiles;
pub mod registry;
pub mod types;

pub use registry::SkillRegistry;
pub use types::{
    AgentSkillInfo, SkillCatalog, SkillData, SkillGovernance, SkillInfo, SkillLocation,
    SkillSuiteDefaultProfileIntent, SkillSuiteInfo, SkillSuiteManifest,
    SkillSuiteMemberOverridePolicy, SkillSuiteMemberRef,
};

/// Get global Skill registry instance
pub fn get_skill_registry() -> &'static SkillRegistry {
    SkillRegistry::global()
}
