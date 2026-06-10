//! Default built-in skill profiles per mode.

use super::agent_overrides::UserAgentSkillOverrides;
use super::types::{SkillInfo, SkillLocation};
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct BuiltinSkillProfile {
    /// Baseline state for built-in skills in this mode.
    default_enabled: bool,
    /// Built-in skill directory names whose state differs from `default_enabled`.
    overridden_skills: &'static [&'static str],
}

const ENABLE_ALL_BUILTINS: BuiltinSkillProfile = BuiltinSkillProfile {
    default_enabled: true,
    overridden_skills: &[],
};

const DISABLE_ALL_BUILTINS: BuiltinSkillProfile = BuiltinSkillProfile {
    default_enabled: false,
    overridden_skills: &[],
};

const AGENTIC_PROFILE: BuiltinSkillProfile = BuiltinSkillProfile {
    default_enabled: true,
    overridden_skills: &["docx", "pdf", "pptx", "xlsx"],
};

const COWORK_PROFILE: BuiltinSkillProfile = BuiltinSkillProfile {
    default_enabled: false,
    overridden_skills: &[
        "docx",
        "pdf",
        "pptx",
        "xlsx",
        "ppt-design",
        "find-skills",
        "writing-skills",
    ],
};

const DESIGN_PROFILE: BuiltinSkillProfile = BuiltinSkillProfile {
    default_enabled: false,
    overridden_skills: &[
        "docx",
        "pdf",
        "pptx",
        "xlsx",
        "ppt-design",
        "find-skills",
        "writing-skills",
    ],
};

/// Studio only needs the Live App domain skill; other built-ins clutter the Skill tool list.
const LIVE_APP_STUDIO_PROFILE: BuiltinSkillProfile = BuiltinSkillProfile {
    default_enabled: false,
    overridden_skills: &["liveapp-dev"],
};

fn builtin_profile_for_agent(agent_id: &str) -> BuiltinSkillProfile {
    match agent_id {
        "Plan" | "debug" => DISABLE_ALL_BUILTINS,
        "agentic" => AGENTIC_PROFILE,
        "Cowork" => COWORK_PROFILE,
        "Design" => DESIGN_PROFILE,
        "LiveAppStudio" => LIVE_APP_STUDIO_PROFILE,
        _ => ENABLE_ALL_BUILTINS,
    }
}

pub fn is_enabled_by_default_for_agent(skill: &SkillInfo, agent_id: &str) -> bool {
    if skill.level != SkillLocation::User || !skill.is_builtin {
        return true;
    }

    let profile = builtin_profile_for_agent(agent_id);
    if profile.overridden_skills.contains(&skill.dir_name.as_str()) {
        !profile.default_enabled
    } else {
        profile.default_enabled
    }
}

pub fn is_skill_enabled_for_agent(
    skill: &SkillInfo,
    agent_id: &str,
    user_overrides: &UserAgentSkillOverrides,
    disabled_project_skills: &HashSet<String>,
) -> bool {
    match skill.level {
        SkillLocation::Project => !disabled_project_skills.contains(&skill.key),
        SkillLocation::User => {
            let default_enabled = is_enabled_by_default_for_agent(skill, agent_id);

            if default_enabled {
                !user_overrides.disabled_skills.contains(&skill.key)
            } else {
                user_overrides.enabled_skills.contains(&skill.key)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{is_enabled_by_default_for_agent, is_skill_enabled_for_agent};
    use crate::agentic::tools::implementations::skills::agent_overrides::UserAgentSkillOverrides;
    use crate::agentic::tools::implementations::skills::types::{SkillInfo, SkillLocation};
    use std::collections::HashSet;

    fn builtin_skill(dir_name: &str) -> SkillInfo {
        SkillInfo {
            key: format!("user::bitfun::{}", dir_name),
            name: dir_name.to_string(),
            description: String::new(),
            path: format!("/tmp/{}", dir_name),
            level: SkillLocation::User,
            source_slot: "bitfun".to_string(),
            dir_name: dir_name.to_string(),
            is_builtin: true,
            group_key: None,
        }
    }

    fn custom_user_skill(dir_name: &str) -> SkillInfo {
        SkillInfo {
            key: format!("user::bitfun::{}", dir_name),
            name: dir_name.to_string(),
            description: String::new(),
            path: format!("/tmp/{}", dir_name),
            level: SkillLocation::User,
            source_slot: "bitfun".to_string(),
            dir_name: dir_name.to_string(),
            is_builtin: false,
            group_key: None,
        }
    }

    #[test]
    fn builtin_defaults_follow_mode_profiles() {
        let pdf = builtin_skill("pdf");
        let tdd = builtin_skill("test-driven-development");

        assert!(!is_enabled_by_default_for_agent(&pdf, "agentic"));
        assert!(is_enabled_by_default_for_agent(&tdd, "agentic"));
        assert!(is_enabled_by_default_for_agent(&pdf, "Cowork"));
        assert!(!is_enabled_by_default_for_agent(&tdd, "Cowork"));
        assert!(is_enabled_by_default_for_agent(&pdf, "Design"));
        assert!(!is_enabled_by_default_for_agent(&tdd, "Design"));
        assert!(!is_enabled_by_default_for_agent(&pdf, "Plan"));
        assert!(!is_enabled_by_default_for_agent(&tdd, "debug"));
    }

    #[test]
    fn agentic_enables_ppt_design_builtin() {
        let ppt_design = builtin_skill("ppt-design");
        let pdf = builtin_skill("pdf");

        assert!(is_enabled_by_default_for_agent(&ppt_design, "agentic"));
        assert!(!is_enabled_by_default_for_agent(&pdf, "agentic"));
    }

    #[test]
    fn live_app_studio_enables_only_liveapp_dev_builtin() {
        let liveapp = builtin_skill("liveapp-dev");
        let pdf = builtin_skill("pdf");
        let tdd = builtin_skill("test-driven-development");

        assert!(is_enabled_by_default_for_agent(&liveapp, "LiveAppStudio"));
        assert!(!is_enabled_by_default_for_agent(&pdf, "LiveAppStudio"));
        assert!(!is_enabled_by_default_for_agent(&tdd, "LiveAppStudio"));
    }

    #[test]
    fn non_builtin_user_skills_remain_enabled_by_default() {
        let custom = custom_user_skill("my-custom-skill");
        assert!(is_enabled_by_default_for_agent(&custom, "agentic"));
        assert!(is_enabled_by_default_for_agent(&custom, "Plan"));
    }

    #[test]
    fn user_overrides_apply_on_top_of_defaults() {
        let pdf = builtin_skill("pdf");
        let mut overrides = UserAgentSkillOverrides::default();
        let disabled_project = HashSet::new();

        assert!(!is_skill_enabled_for_agent(
            &pdf,
            "agentic",
            &overrides,
            &disabled_project,
        ));

        overrides.enabled_skills.push(pdf.key.clone());
        assert!(is_skill_enabled_for_agent(
            &pdf,
            "agentic",
            &overrides,
            &disabled_project,
        ));
    }
}
