//! Skill tool implementation
//!
//! Supports loading and executing skills from user-level and project-level directories
//! Manages skill enabled/disabled status through SkillRegistry

use crate::agentic::agents::get_agent_registry;
use crate::agentic::tools::framework::{
    Tool, ToolRenderOptions, ToolResult, ToolUseContext, ValidationResult,
};
use crate::error::{CoreError, CoreResult};
use async_trait::async_trait;
use log::debug;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;

// Use skills module
use super::skills::{get_skill_registry, SkillLocation};

/// Skill tool
pub struct SkillTool;

impl SkillTool {
    pub fn new() -> Self {
        Self
    }

    fn render_description(&self, skills_list: String) -> String {
        let skills_list = if skills_list.is_empty() {
            "No skills available".to_string()
        } else {
            skills_list
        };

        format!(
            r#"Execute a skill within the main conversation

<skills_instructions>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills:
- Invoke skills using this tool with the skill name only (no arguments)
- The skill's prompt will expand and provide detailed instructions on how to complete the task
- Examples:
  - `command: "pdf"` - invoke the pdf skill
  - `command: "xlsx"` - invoke the xlsx skill
  - `command: "ms-office-suite:pdf"` - invoke using fully qualified name

Important:
- Only use skills listed in <available_skills> below
- Do not invoke a skill that is already running
</skills_instructions>

<available_skills>
{}
</available_skills>"#,
            skills_list
        )
    }

    async fn build_suite_descriptions_for_workspace(
        &self,
        workspace_root: Option<&Path>,
        agent_type: Option<&str>,
    ) -> Vec<String> {
        let registry = get_skill_registry();
        let resolved_keys: HashSet<String> = registry
            .get_resolved_skills_for_workspace(workspace_root, agent_type)
            .await
            .into_iter()
            .map(|skill| skill.key)
            .collect();
        let catalog = registry
            .get_skill_catalog_for_workspace(workspace_root)
            .await;

        catalog
            .suites
            .into_iter()
            .filter(|suite| {
                suite
                    .member_skill_keys
                    .iter()
                    .any(|key| resolved_keys.contains(key))
            })
            .map(|suite| suite.to_xml_desc())
            .collect()
    }

    async fn build_description_for_context(&self, context: Option<&ToolUseContext>) -> String {
        let registry = get_skill_registry();
        let mut available_skills = match context {
            Some(ctx) if ctx.is_remote() => {
                if let Some(fs) = ctx.ws_fs() {
                    let root = ctx
                        .workspace
                        .as_ref()
                        .map(|w| w.root_path_string())
                        .unwrap_or_default();
                    registry
                        .get_resolved_skills_xml_for_remote_workspace(
                            fs,
                            &root,
                            ctx.agent_type.as_deref(),
                        )
                        .await
                } else {
                    registry
                        .get_resolved_skills_xml_for_workspace(
                            ctx.workspace_root(),
                            ctx.agent_type.as_deref(),
                        )
                        .await
                }
            }
            Some(ctx) => match ctx.agent_type.as_deref() {
                Some(agent_type) => {
                    if let Some(profile) = get_agent_registry()
                        .get_agent_capability_profile(agent_type, ctx.workspace_root())
                        .await
                    {
                        let allowed: std::collections::HashSet<String> =
                            profile.skills.effective.into_iter().collect();
                        registry
                            .get_resolved_skills_for_workspace(ctx.workspace_root(), None)
                            .await
                            .into_iter()
                            .filter(|skill| allowed.contains(&skill.key))
                            .map(|skill| skill.to_xml_desc())
                            .collect::<Vec<_>>()
                    } else {
                        registry
                            .get_resolved_skills_xml_for_workspace(
                                ctx.workspace_root(),
                                ctx.agent_type.as_deref(),
                            )
                            .await
                    }
                }
                None => {
                    registry
                        .get_resolved_skills_xml_for_workspace(ctx.workspace_root(), None)
                        .await
                }
            },
            None => {
                registry
                    .get_resolved_skills_xml_for_workspace(None, None)
                    .await
            }
        };

        if let Some(ctx) = context.filter(|ctx| !ctx.is_remote()) {
            let mut suites = self
                .build_suite_descriptions_for_workspace(
                    ctx.workspace_root(),
                    ctx.agent_type.as_deref(),
                )
                .await;
            suites.append(&mut available_skills);
            available_skills = suites;
        } else if context.is_none() {
            let mut suites = self
                .build_suite_descriptions_for_workspace(None, None)
                .await;
            suites.append(&mut available_skills);
            available_skills = suites;
        }

        self.render_description(available_skills.join("\n"))
    }
}

#[async_trait]
impl Tool for SkillTool {
    fn name(&self) -> &str {
        "Skill"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(self.build_description_for_context(None).await)
    }

    async fn description_with_context(
        &self,
        context: Option<&ToolUseContext>,
    ) -> CoreResult<String> {
        let mut s = self.build_description_for_context(context).await;
        if context.map(|c| c.is_remote()).unwrap_or(false)
            && context.and_then(|c| c.ws_fs()).is_none()
        {
            s.push_str(
                "\n\n**Remote workspace:** Project-level skills on the server could not be indexed (workspace I/O unavailable). Use **Read** / **Glob** on the remote tree if needed.",
            );
        }
        Ok(s)
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                "description": "The skill name or suite command. E.g., \"pdf\", \"xlsx\", or \"suite:product-app-development\""
                }
            },
            "required": ["command"],
            "additionalProperties": false
        })
    }

    fn is_readonly(&self) -> bool {
        true
    }

    fn is_concurrency_safe(&self, _input: Option<&Value>) -> bool {
        true
    }

    fn needs_permissions(&self, _input: Option<&Value>) -> bool {
        false
    }

    async fn validate_input(
        &self,
        input: &Value,
        _context: Option<&ToolUseContext>,
    ) -> ValidationResult {
        if input
            .get("command")
            .and_then(|v| v.as_str())
            .is_none_or(|s| s.is_empty())
        {
            return ValidationResult {
                result: false,
                message: Some("command is required and cannot be empty".to_string()),
                error_code: Some(400),
                meta: None,
            };
        }

        ValidationResult {
            result: true,
            message: None,
            error_code: None,
            meta: None,
        }
    }

    fn render_tool_use_message(&self, input: &Value, _options: &ToolRenderOptions) -> String {
        if let Some(command) = input.get("command").and_then(|v| v.as_str()) {
            format!("The \"{}\" skill is loaded.", command)
        } else {
            "Loading skill...".to_string()
        }
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> CoreResult<Vec<ToolResult>> {
        let skill_name = input
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| CoreError::tool("command is required".to_string()))?;

        debug!("Skill tool executing skill: {}", skill_name);

        // Find and load skill through registry
        let registry = get_skill_registry();
        if skill_name.trim().starts_with("suite:") {
            let (suite, router_content) = registry
                .find_and_load_suite_router_for_workspace(
                    skill_name,
                    context.workspace_root(),
                    context.agent_type.as_deref(),
                )
                .await?;

            let result_for_assistant = format!(
                "Skill suite '{}' loaded successfully. Use this router to choose the smallest matching member skill before loading member instructions.\n\n{}",
                suite.name, router_content
            );

            let result = ToolResult::Result {
                data: json!({
                    "suite_id": suite.id,
                    "suite_name": suite.name,
                    "description": suite.description,
                    "content": router_content,
                    "success": true
                }),
                result_for_assistant: Some(result_for_assistant),
                image_attachments: None,
            };

            return Ok(vec![result]);
        }

        let skill_data = if context.is_remote() {
            if let Some(ws_fs) = context.ws_fs() {
                let root = context
                    .workspace
                    .as_ref()
                    .map(|w| w.root_path_string())
                    .unwrap_or_default();
                registry
                    .find_and_load_skill_for_remote_workspace(
                        skill_name,
                        ws_fs,
                        &root,
                        context.agent_type.as_deref(),
                    )
                    .await?
            } else {
                registry
                    .find_and_load_skill_for_workspace(
                        skill_name,
                        context.workspace_root(),
                        context.agent_type.as_deref(),
                    )
                    .await?
            }
        } else {
            registry
                .find_and_load_skill_for_workspace(
                    skill_name,
                    context.workspace_root(),
                    context.agent_type.as_deref(),
                )
                .await?
        };

        if let Some(agent_type) = context.agent_type.as_deref() {
            if let Some(profile) = get_agent_registry()
                .get_agent_capability_profile(agent_type, context.workspace_root())
                .await
            {
                let allowed: std::collections::HashSet<String> =
                    profile.skills.effective.into_iter().collect();
                if !allowed.contains(&skill_data.key) {
                    return Err(CoreError::tool(format!(
                        "Skill '{}' is not enabled for agent '{}'",
                        skill_name, agent_type
                    )));
                }
            }
        }

        let location_str = match skill_data.location {
            SkillLocation::User => "user",
            SkillLocation::Project => "project",
        };

        let result_for_assistant = format!(
            "Skill '{}' loaded successfully. Note: any paths mentioned in this skill are relative to {}, not the workspace.\n\n{}",
            skill_data.name, skill_data.path, skill_data.content
        );

        let result = ToolResult::Result {
            data: json!({
                "skill_name": skill_data.name,
                "description": skill_data.description,
                "location": location_str,
                "content": skill_data.content,
                "success": true
            }),
            result_for_assistant: Some(result_for_assistant),
            image_attachments: None,
        };

        Ok(vec![result])
    }
}

impl Default for SkillTool {
    fn default() -> Self {
        Self::new()
    }
}
