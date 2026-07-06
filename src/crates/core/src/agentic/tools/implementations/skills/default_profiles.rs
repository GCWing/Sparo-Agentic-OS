//! Default built-in skill profiles per mode.

use super::agent_overrides::UserAgentSkillOverrides;
use super::types::{SkillInfo, SkillLocation};
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct BuiltinSkillProfile {
    /// Baseline state for built-in skills in this mode.
    default_enabled: bool,
    /// Built-in suite ids whose state differs from `default_enabled`.
    overridden_suites: &'static [&'static str],
    /// Built-in skill directory names whose state differs from `default_enabled`.
    overridden_skills: &'static [&'static str],
}

const ENABLE_ALL_BUILTINS: BuiltinSkillProfile = BuiltinSkillProfile {
    default_enabled: true,
    overridden_suites: &[],
    overridden_skills: &[],
};

const DISABLE_ALL_BUILTINS: BuiltinSkillProfile = BuiltinSkillProfile {
    default_enabled: false,
    overridden_suites: &[],
    overridden_skills: &[],
};

const EXECUTION_PROFILE: BuiltinSkillProfile = BuiltinSkillProfile {
    default_enabled: true,
    overridden_suites: &["office-documents"],
    overridden_skills: &[],
};

const COWORK_PROFILE: BuiltinSkillProfile = BuiltinSkillProfile {
    default_enabled: false,
    overridden_suites: &["office-documents", "presentation-workflow"],
    overridden_skills: &["find-skills", "writing-skills"],
};

const DESIGN_PROFILE: BuiltinSkillProfile = BuiltinSkillProfile {
    default_enabled: false,
    overridden_suites: &["office-documents", "presentation-workflow"],
    overridden_skills: &["find-skills", "writing-skills"],
};

/// App Builder only needs focused Product App authoring skills; other built-ins clutter the Skill tool list.
const APP_BUILDER_PROFILE: BuiltinSkillProfile = BuiltinSkillProfile {
    default_enabled: false,
    overridden_suites: &["product-app-development"],
    overridden_skills: &[],
};

fn builtin_profile_for_agent(agent_id: &str) -> BuiltinSkillProfile {
    match agent_id {
        "bitfun-plan" | "bitfun-debug" => DISABLE_ALL_BUILTINS,
        "Runno" | "bitfun-coder" | "bitfun-team" => EXECUTION_PROFILE,
        "Cowork" => COWORK_PROFILE,
        "Design" => DESIGN_PROFILE,
        "AppBuilder" => APP_BUILDER_PROFILE,
        _ => ENABLE_ALL_BUILTINS,
    }
}

pub fn is_enabled_by_default_for_agent(skill: &SkillInfo, agent_id: &str) -> bool {
    if skill.level != SkillLocation::User || !skill.is_builtin {
        return true;
    }

    let profile = builtin_profile_for_agent(agent_id);
    let mut enabled = profile.default_enabled;

    if skill
        .suite_key
        .as_deref()
        .is_some_and(|suite_key| profile.overridden_suites.contains(&suite_key))
    {
        enabled = !profile.default_enabled;
    }

    if profile.overridden_skills.contains(&skill.dir_name.as_str()) {
        enabled = !profile.default_enabled;
    }

    enabled
}

pub fn is_builtin_suite_enabled_by_default_for_agent(suite_key: &str, agent_id: &str) -> bool {
    let profile = builtin_profile_for_agent(agent_id);
    if profile.overridden_suites.contains(&suite_key) {
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
    disabled_project_suites: &HashSet<String>,
) -> bool {
    match skill.level {
        SkillLocation::Project => {
            if skill
                .suite_key
                .as_deref()
                .is_some_and(|suite_key| disabled_project_suites.contains(suite_key))
            {
                return false;
            }

            !disabled_project_skills.contains(&skill.key)
        }
        SkillLocation::User => {
            let mut enabled = is_enabled_by_default_for_agent(skill, agent_id);

            if let Some(suite_key) = skill.suite_key.as_deref() {
                if enabled
                    && user_overrides
                        .disabled_suites
                        .contains(&suite_key.to_string())
                {
                    enabled = false;
                } else if !enabled
                    && user_overrides
                        .enabled_suites
                        .contains(&suite_key.to_string())
                {
                    enabled = true;
                }
            }

            if enabled {
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
    use crate::agentic::tools::implementations::skills::types::{
        SkillGovernance, SkillInfo, SkillLocation,
    };
    use std::collections::HashSet;

    fn builtin_skill(dir_name: &str, suite_key: Option<&str>) -> SkillInfo {
        SkillInfo {
            key: format!("user::sparo::{}", dir_name),
            name: dir_name.to_string(),
            description: String::new(),
            path: format!("/tmp/{}", dir_name),
            level: SkillLocation::User,
            source_slot: "sparo".to_string(),
            dir_name: dir_name.to_string(),
            is_builtin: true,
            governance: SkillGovernance::SparoManaged,
            suite_key: suite_key.map(str::to_string),
            suite_member_override_policy: None,
            tags: Vec::new(),
            can_delete: false,
            can_edit: false,
            can_update: false,
        }
    }

    fn custom_user_skill(dir_name: &str) -> SkillInfo {
        SkillInfo {
            key: format!("user::sparo::{}", dir_name),
            name: dir_name.to_string(),
            description: String::new(),
            path: format!("/tmp/{}", dir_name),
            level: SkillLocation::User,
            source_slot: "sparo".to_string(),
            dir_name: dir_name.to_string(),
            is_builtin: false,
            governance: SkillGovernance::UserManaged,
            suite_key: None,
            suite_member_override_policy: None,
            tags: Vec::new(),
            can_delete: true,
            can_edit: true,
            can_update: false,
        }
    }

    #[test]
    fn builtin_defaults_follow_mode_profiles() {
        let pdf = builtin_skill("pdf", Some("office-documents"));
        let find_skills = builtin_skill("find-skills", None);
        let general = builtin_skill("general-purpose", None);

        assert!(!is_enabled_by_default_for_agent(&pdf, "Runno"));
        assert!(is_enabled_by_default_for_agent(&find_skills, "Runno"));
        assert!(is_enabled_by_default_for_agent(&pdf, "Cowork"));
        assert!(is_enabled_by_default_for_agent(&find_skills, "Cowork"));
        assert!(!is_enabled_by_default_for_agent(&general, "Cowork"));
        assert!(is_enabled_by_default_for_agent(&pdf, "Design"));
        assert!(is_enabled_by_default_for_agent(&find_skills, "Design"));
        assert!(!is_enabled_by_default_for_agent(&general, "Design"));
        assert!(!is_enabled_by_default_for_agent(&pdf, "bitfun-plan"));
        assert!(!is_enabled_by_default_for_agent(
            &find_skills,
            "bitfun-debug"
        ));
    }

    #[test]
    fn runno_enables_ppt_design_builtin() {
        let ppt_design = builtin_skill("ppt-design", Some("presentation-workflow"));
        let pdf = builtin_skill("pdf", Some("office-documents"));

        assert!(is_enabled_by_default_for_agent(&ppt_design, "Runno"));
        assert!(!is_enabled_by_default_for_agent(&pdf, "Runno"));
    }

    #[test]
    fn app_builder_enables_only_product_app_authoring_builtins() {
        let enabled = [
            "product-app-api",
            "product-app-ui-polish",
            "product-app-surface",
            "product-app-agent-component",
            "product-app-bridge-component",
            "product-app-runtime-component",
            "product-app-tool-component",
            "product-app-skill-component",
        ];
        let pdf = builtin_skill("pdf", Some("office-documents"));
        let general = builtin_skill("general-purpose", None);

        for skill_name in enabled {
            assert!(is_enabled_by_default_for_agent(
                &builtin_skill(skill_name, Some("product-app-development")),
                "AppBuilder"
            ));
        }
        assert!(!is_enabled_by_default_for_agent(&pdf, "AppBuilder"));
        assert!(!is_enabled_by_default_for_agent(&general, "AppBuilder"));
    }

    #[test]
    fn non_builtin_user_skills_remain_enabled_by_default() {
        let custom = custom_user_skill("my-custom-skill");
        assert!(is_enabled_by_default_for_agent(&custom, "Runno"));
        assert!(is_enabled_by_default_for_agent(&custom, "custom-agent"));
    }

    #[test]
    fn user_overrides_apply_on_top_of_defaults() {
        let pdf = builtin_skill("pdf", Some("office-documents"));
        let mut overrides = UserAgentSkillOverrides::default();
        let disabled_project = HashSet::new();
        let disabled_project_suites = HashSet::new();

        assert!(!is_skill_enabled_for_agent(
            &pdf,
            "Runno",
            &overrides,
            &disabled_project,
            &disabled_project_suites,
        ));

        overrides.enabled_skills.push(pdf.key.clone());
        assert!(is_skill_enabled_for_agent(
            &pdf,
            "Runno",
            &overrides,
            &disabled_project,
            &disabled_project_suites,
        ));
    }
}
