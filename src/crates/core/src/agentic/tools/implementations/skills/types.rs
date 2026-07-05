//! Skill type definitions

use crate::error::{CoreError, CoreResult};
use crate::util::front_matter_markdown::FrontMatterMarkdown;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Skill location
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillLocation {
    /// User-level (global)
    User,
    /// Project-level
    Project,
}

impl SkillLocation {
    pub fn as_str(&self) -> &'static str {
        match self {
            SkillLocation::User => "user",
            SkillLocation::Project => "project",
        }
    }
}

/// Skill or suite governance owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillGovernance {
    /// Shipped and synchronized by Sparo OS.
    SparoManaged,
    /// Installed or authored by the current user.
    UserManaged,
    /// Installed or authored by the current project.
    ProjectManaged,
}

impl SkillGovernance {
    pub fn can_delete(self) -> bool {
        !matches!(self, SkillGovernance::SparoManaged)
    }

    pub fn can_edit(self) -> bool {
        !matches!(self, SkillGovernance::SparoManaged)
    }
}

/// Suite member override policy declared by `suite.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillSuiteMemberOverridePolicy {
    SparoManaged,
    SuiteLocal,
    WorkspaceMayOverride,
}

impl Default for SkillSuiteMemberOverridePolicy {
    fn default() -> Self {
        Self::SuiteLocal
    }
}

/// Suite default profile intent declared by `suite.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillSuiteDefaultProfileIntent {
    Enabled,
    Disabled,
    Available,
}

/// Member declaration inside a suite manifest.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSuiteMemberRef {
    pub skill_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub override_policy: SkillSuiteMemberOverridePolicy,
}

/// Suite source manifest loaded from `suite.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSuiteManifest {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub router_path: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub members: Vec<SkillSuiteMemberRef>,
    #[serde(default)]
    pub default_profiles: HashMap<String, SkillSuiteDefaultProfileIntent>,
}

/// Complete suite information (for API return).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSuiteInfo {
    /// Runtime-unique identifier derived from source slot + suite id.
    pub key: String,
    /// Stable suite id from `suite.json`.
    pub id: String,
    pub name: String,
    pub description: String,
    pub level: SkillLocation,
    pub source_slot: String,
    pub path: String,
    pub governance: SkillGovernance,
    pub router_path: Option<String>,
    pub member_skill_keys: Vec<String>,
    pub missing_refs: Vec<SkillSuiteMemberRef>,
    pub tags: Vec<String>,
    pub is_builtin: bool,
    pub can_delete: bool,
    pub can_edit: bool,
    pub can_update: bool,
}

impl SkillSuiteInfo {
    pub fn to_xml_desc(&self) -> String {
        format!(
            r#"<suite>
<command>
suite:{}
</command>
<name>
{}
</name>
<description>
{}
</description>
<members>
{}
</members>
</suite>
"#,
            self.id,
            self.name,
            self.description,
            self.member_skill_keys.join(", ")
        )
    }
}

/// Skill catalog returned to management surfaces.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillCatalog {
    pub skills: Vec<SkillInfo>,
    pub suites: Vec<SkillSuiteInfo>,
}

/// Complete skill information (for API return)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    /// Runtime-unique identifier derived from source slot + directory name.
    pub key: String,
    /// Skill name (read from SKILL.md, used by the model to invoke the skill)
    pub name: String,
    /// Description (read from SKILL.md)
    pub description: String,
    /// Skill folder path
    pub path: String,
    /// Level (project-level/user-level)
    pub level: SkillLocation,
    /// Source slot that discovered this skill.
    pub source_slot: String,
    /// Directory name under the slot's `skills/` root.
    pub dir_name: String,
    /// Whether this skill is bundled with Sparo OS as a built-in skill.
    #[serde(default)]
    pub is_builtin: bool,
    /// Governance owner for delete/edit/update policy.
    pub governance: SkillGovernance,
    /// Optional suite id. Standalone skills keep this empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suite_key: Option<String>,
    /// Suite member override policy when the skill belongs to a suite.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suite_member_override_policy: Option<SkillSuiteMemberOverridePolicy>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub can_delete: bool,
    pub can_edit: bool,
    pub can_update: bool,
}

impl SkillInfo {
    /// Convert to XML description (for tool description)
    pub fn to_xml_desc(&self) -> String {
        format!(
            r#"<skill>
<name>
{}
</name>
<description>
{}
</description>
<suite>
{}
</suite>
<location>
{}
</location>
</skill>
"#,
            self.name,
            self.description,
            self.suite_key.as_deref().unwrap_or("standalone"),
            self.path
        )
    }
}

/// Skill information annotated for a specific agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillInfo {
    #[serde(flatten)]
    pub skill: SkillInfo,
    /// True when this skill is currently disabled for the agent after applying
    /// defaults plus user/project overrides.
    pub disabled_by_agent: bool,
    /// True when this skill is the one actually selected for runtime after applying
    /// agent disables and same-name priority resolution.
    pub selected_for_runtime: bool,
}

/// Skill data (contains content, for execution)
#[derive(Debug, Clone)]
pub struct SkillData {
    pub key: String,
    pub name: String,
    pub description: String,
    pub content: String,
    pub location: SkillLocation,
    pub path: String,
    pub source_slot: String,
    pub dir_name: String,
    pub suite_key: Option<String>,
    pub suite_member_override_policy: Option<SkillSuiteMemberOverridePolicy>,
    pub tags: Vec<String>,
}

impl SkillData {
    /// Parse Skill from SKILL.md file content
    pub fn from_markdown(
        path: String,
        content: &str,
        location: SkillLocation,
        with_content: bool,
    ) -> CoreResult<Self> {
        let (metadata, body) = FrontMatterMarkdown::load_str(content)
            .map_err(|e| CoreError::tool(format!("Invalid SKILL.md format: {}", e)))?;

        let name = metadata
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| {
                CoreError::tool("Missing required field 'name' in SKILL.md".to_string())
            })?;

        let description = metadata
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| {
                CoreError::tool("Missing required field 'description' in SKILL.md".to_string())
            })?;

        let skill_content = if with_content { body } else { String::new() };
        let dir_name = std::path::Path::new(&path)
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| CoreError::tool(format!("Invalid skill path: {}", path)))?
            .to_string();

        Ok(SkillData {
            key: String::new(),
            name,
            description,
            content: skill_content,
            location,
            path,
            source_slot: String::new(),
            dir_name,
            suite_key: None,
            suite_member_override_policy: None,
            tags: Vec::new(),
        })
    }
}
