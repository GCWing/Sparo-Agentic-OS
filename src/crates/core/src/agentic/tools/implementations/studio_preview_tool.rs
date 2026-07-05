//! RunStudioPreview tool - structured App Studio Preview Harness entrypoint.

use crate::agent_component::{AgentComponentLevel, AgentComponentManager};
use crate::agentic::agents::get_agent_registry;
use crate::agentic::app_studio_context::{AppStudioExecutionContext, AppStudioSubject};
use crate::agentic::tools::framework::{Tool, ToolResult, ToolUseContext};
use crate::agentic::tools::implementations::skills::get_skill_registry;
use crate::agentic::tools::implementations::work_tool_support::work_service_from_tool_context;
use crate::agentic::tools::pipeline::SubagentParentInfo;
use crate::agentic_os::work::{
    WorkId, WorkRecord, WorkStudioFactCheck, WorkStudioFactStatus, WorkStudioPreviewKind,
    WorkStudioPreviewSource,
};
use crate::app_platform::{
    AppSurfaceMode, ComponentDefinition, ComponentKind, ComponentSource, ProductAppEvalCase,
    ProductAppEvalEvidenceKind, ProductAppEvalExpectation, ProductAppEvalExpectationKind,
    ProductAppLaunchKind, ProductAppResolver,
};
use crate::bridge_component::{
    BridgeComponentConsumer, BridgeComponentConsumerKind, BridgeComponentManager,
    BridgeComponentRunStatus,
};
use crate::error::{CoreError, CoreResult};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::HashMap;
use tokio::fs;

pub struct RunStudioPreviewTool;

impl RunStudioPreviewTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for RunStudioPreviewTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for RunStudioPreviewTool {
    fn name(&self) -> &str {
        "RunStudioPreview"
    }

    async fn description(&self) -> CoreResult<String> {
        Ok(r#"Run the App Studio Preview Harness for the current bound Product App or Component subject and return a structured PreviewResult fact. This is the platform preview gate for product-app-preview, agent-chat, sidecar, full-app, embedded, capability, agent-eval, runtime-boundary, runtime-dependencies, permission-review, user-path-rehearsal, and release-rehearsal modes.

Input may be empty in a bound AppStudio session. Optional mode can force one harness: auto, product-app-preview, agent-chat, sidecar-ui, full-ui, embedded-object, capability, agent-eval, runtime-boundary, runtime-dependencies, permission-review, user-path-rehearsal, or release-rehearsal. The tool never edits files. Release rehearsal summarizes readiness gaps and never substitutes for independent runtime, user-path, permission-review, dependency-health, or Agent Eval evidence. When a concrete runner or evidence source is not available, it returns notVerified checks instead of pretending the preview passed."#
            .to_string())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": [
                        "auto",
                        "product-app-preview",
                        "agent-chat",
                        "sidecar-ui",
                        "sidecar",
                        "full-ui",
                        "full-app",
                        "embedded-object",
                        "embedded",
                        "capability",
                        "agent-eval",
                        "agent_eval",
                        "runtime-boundary",
                        "runtime-dependencies",
                        "permission-review",
                        "user-path-rehearsal",
                        "release-rehearsal"
                    ],
                    "description": "Preview Harness mode. Defaults to auto from the bound App Studio subject."
                },
                "intent": {
                    "type": "string",
                    "description": "Short human-readable reason for the preview run."
                },
                "fixture": {
                    "type": "object",
                    "description": "Optional harness fixture or sample input. It is recorded as input evidence, not trusted as runtime proof."
                },
                "execute": {
                    "type": "boolean",
                    "description": "When true, run a supported concrete preview, capability, or eval executor. Currently this can execute Agent Chat hidden turns, Bridge Component refs, Agent Component JS runtime tool refs, interactive surface runtime binding checks, agent runtime binding checks, skill binding checks, Agent Eval JS tool fixtures, and Agent Eval agent behavior fixtures, and requires permissions."
                }
            },
            "description": "Leave input empty to run the default preview harness for the current bound AppStudio subject."
        })
    }

    fn is_readonly(&self) -> bool {
        true
    }

    fn is_concurrency_safe(&self, input: Option<&Value>) -> bool {
        !self.needs_permissions(input)
    }

    fn needs_permissions(&self, input: Option<&Value>) -> bool {
        input
            .and_then(|value| value.get("execute"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }

    async fn call_impl(
        &self,
        input: &Value,
        context: &ToolUseContext,
    ) -> CoreResult<Vec<ToolResult>> {
        let Some(app_studio) = context.app_studio.as_ref() else {
            return Err(CoreError::validation(
                "RunStudioPreview requires a bound AppStudio session".to_string(),
            ));
        };

        let requested_mode = optional_string(input, "mode").unwrap_or_else(|| "auto".to_string());
        let mode = resolve_harness_mode(&requested_mode, app_studio).await;
        let fixture_provided = input.get("fixture").is_some_and(|value| !value.is_null());
        let execute = input
            .get("execute")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let intent = optional_string(input, "intent");
        let target = target_summary(app_studio);
        let fixture_satisfied_by_harness = !fixture_provided
            && matches!(
                mode.as_str(),
                "product-app-preview"
                    | "sidecar"
                    | "full-app"
                    | "embedded"
                    | "agent-eval"
                    | "runtime-boundary"
                    | "runtime-dependencies"
                    | "permission-review"
                    | "user-path-rehearsal"
            );
        let mut checks = vec![
            check(
                "target",
                "passed",
                format!("Bound App Studio target resolved: {target}."),
            ),
            check(
                "fixture",
                if fixture_provided || fixture_satisfied_by_harness {
                    "passed"
                } else {
                    "notVerified"
                },
                if fixture_provided {
                    "Harness fixture input was provided.".to_string()
                } else if fixture_satisfied_by_harness {
                    if mode == "agent-eval" {
                        "No explicit fixture input was provided; Agent Eval will use package eval cases or target defaults."
                            .to_string()
                    } else if matches!(
                        mode.as_str(),
                        "runtime-boundary"
                            | "runtime-dependencies"
                            | "permission-review"
                            | "user-path-rehearsal"
                    ) {
                        "No explicit fixture input was provided; this harness consumes the latest App Studio Workbench evidence for the bound Product App Work."
                            .to_string()
                    } else {
                        "No explicit fixture input was provided; this harness consumes the latest Workbench host observation for the bound Product App Work."
                            .to_string()
                    }
                } else {
                    "No explicit harness fixture input was provided.".to_string()
                },
            ),
        ];

        let runtime_instance_id = app_studio.runtime_instance_id.clone();
        match mode.as_str() {
            "agent-chat" => {
                checks.extend(agent_chat_preview_checks(app_studio, context, input, execute).await);
            }
            "product-app-preview" | "sidecar" | "full-app" | "embedded" => {
                checks.extend(
                    work_preview_observation_checks(app_studio, context, &mode, "host observation")
                        .await
                        .checks,
                );
            }
            "capability" => {
                checks.extend(
                    capability_preview_checks(
                        app_studio,
                        context,
                        input,
                        fixture_provided,
                        execute,
                    )
                    .await,
                );
            }
            "agent-eval" => {
                checks.extend(agent_eval_preview_checks(app_studio, context, input, execute).await);
            }
            "runtime-boundary" => {
                let evidence = work_preview_observation_checks(
                    app_studio,
                    context,
                    &mode,
                    "runtime boundary evidence",
                )
                .await;
                if evidence.found {
                    checks.extend(evidence.checks);
                } else {
                    checks.extend(runtime_boundary_preview_checks(app_studio).await);
                    checks.extend(evidence.checks);
                }
            }
            "runtime-dependencies" => {
                let evidence = work_preview_observation_checks(
                    app_studio,
                    context,
                    &mode,
                    "runtime dependency evidence",
                )
                .await;
                if evidence.found {
                    checks.extend(evidence.checks);
                } else {
                    checks.extend(runtime_dependency_preview_checks(app_studio).await);
                    checks.extend(evidence.checks);
                }
            }
            "permission-review" => {
                let evidence = work_preview_observation_checks(
                    app_studio,
                    context,
                    &mode,
                    "permission review evidence",
                )
                .await;
                if evidence.found {
                    checks.extend(evidence.checks);
                } else {
                    checks.extend(permission_review_preview_checks(app_studio).await);
                    checks.extend(evidence.checks);
                }
            }
            "user-path-rehearsal" => {
                let evidence = work_preview_observation_checks(
                    app_studio,
                    context,
                    &mode,
                    "user-path rehearsal evidence",
                )
                .await;
                if evidence.found {
                    checks.extend(evidence.checks);
                } else {
                    checks.extend(user_path_rehearsal_preview_checks(app_studio).await);
                    checks.extend(evidence.checks);
                }
            }
            "release-rehearsal" => {
                checks.extend(release_rehearsal_preview_checks(app_studio, context).await);
            }
            _ => {
                checks.push(check(
                    "harnessMode",
                    "failed",
                    format!("Unsupported Preview Harness mode: {mode}."),
                ));
            }
        }

        let status = aggregate_status(&checks);
        let failed = count_status(&checks, "failed") + count_status(&checks, "blocked");
        let warnings = count_status(&checks, "warning");
        let result_text = format!(
            "Studio preview harness {status} for {target} using mode {mode}. failed={failed}, warnings={warnings}."
        );
        let (app_id, component_id, component_kind, version) = subject_identity(app_studio);
        let preview_result_id = preview_result_id(&mode, &target);
        let package_root = app_studio.package_root.to_string_lossy().to_string();
        let work_id = app_studio.work_id.clone();

        Ok(vec![ToolResult::Result {
            data: json!({
                "status": status,
                "preview_result_id": preview_result_id.clone(),
                "previewResultId": preview_result_id,
                "kind": mode_to_preview_kind(&mode),
                "source": "preview-harness",
                "harness_mode": mode.clone(),
                "harnessMode": mode,
                "target": target,
                "app_id": app_id.clone(),
                "appId": app_id,
                "component_id": component_id.clone(),
                "componentId": component_id,
                "component_kind": component_kind.clone(),
                "componentKind": component_kind,
                "version": version,
                "package_root": package_root.clone(),
                "packageRoot": package_root,
                "work_id": work_id.clone(),
                "workId": work_id,
                "runtime_instance_id": runtime_instance_id.clone(),
                "runtimeInstanceId": runtime_instance_id,
                "intent": intent,
                "checks": checks,
                "summary": {
                    "failed": failed,
                    "warnings": warnings,
                    "fixtureProvided": fixture_provided
                }
            }),
            result_for_assistant: Some(result_text),
            image_attachments: None,
        }])
    }
}

async fn agent_chat_preview_checks(
    app_studio: &AppStudioExecutionContext,
    context: &ToolUseContext,
    input: &Value,
    execute: bool,
) -> Vec<Value> {
    let AppStudioSubject::ProductApp { .. } = &app_studio.subject else {
        return vec![check(
            "agentChat",
            "failed",
            "Agent Chat Preview requires a bound Product App subject.".to_string(),
        )];
    };

    let package = match ProductAppResolver::read_product_app_package(&app_studio.package_root).await
    {
        Ok(package) => package,
        Err(error) => {
            return vec![check(
                "agentChat",
                "failed",
                format!(
                    "Failed to read bound Product App package at {}: {error}",
                    app_studio.package_root.display()
                ),
            )];
        }
    };

    let app_id = package.app.id.clone();
    let version = package.app.version.clone();
    let app_description = package.app.description.clone();
    let private_agents = package
        .private_components
        .iter()
        .filter(|component| component.kind == ComponentKind::Agent)
        .collect::<Vec<_>>();
    let declared_agent_ref_count = package
        .app
        .components
        .iter()
        .filter(|component| component.kind == ComponentKind::Agent)
        .count();
    let selected_agent = fixture_string(input, "componentId")
        .or_else(|| fixture_string(input, "component_id"))
        .as_deref()
        .and_then(|component_id| {
            private_agents
                .iter()
                .find(|component| component.id == component_id)
                .copied()
        })
        .or_else(|| private_agents.first().copied());
    let implementation_ref = fixture_implementation_ref(input)
        .or_else(|| selected_agent.and_then(|component| component.implementation_ref.clone()));
    let agent_type = implementation_ref.as_deref().and_then(agent_type_from_ref);
    let prompt = agent_chat_preview_prompt(input, &app_id, &version, &app_description);
    let chat_run = if execute {
        agent_type.map(|agent_type| execute_agent_chat_preview(agent_type, &prompt, context))
    } else {
        None
    };
    let chat_run = match chat_run {
        Some(run) => Some(run.await),
        None => None,
    };

    vec![
        check(
            "package",
            "passed",
            format!("Read Product App package {app_id}@{version}."),
        ),
        check(
            "agentBinding",
            if agent_type.is_some() {
                "passed"
            } else if implementation_ref.is_some() {
                "blocked"
            } else if package.app.permissions.ai || declared_agent_ref_count > 0 || !private_agents.is_empty() {
                "blocked"
            } else {
                "notVerified"
            },
            if let Some(agent_type) = agent_type {
                format!(
                    "Agent Chat Preview selected agent://{} from {} private agent component(s) and {} declared agent ref(s).",
                    agent_type,
                    private_agents.len(),
                    declared_agent_ref_count
                )
            } else if let Some(implementation_ref) = implementation_ref.as_deref() {
                format!(
                    "Agent Chat Preview requires an agent://* implementationRef; selected {}.",
                    implementation_ref
                )
            } else if package.app.permissions.ai || declared_agent_ref_count > 0 || !private_agents.is_empty() {
                "Product App declares AI or agent components, but no concrete agent://* runtime binding could be selected."
                    .to_string()
            } else {
                "Product App does not declare an Agent Chat runtime binding.".to_string()
            },
        ),
        check(
            "agentChat",
            chat_run
                .as_ref()
                .map(|run| run.status)
                .unwrap_or_else(|| {
                    if execute && agent_type.is_none() {
                        "blocked"
                    } else {
                        "notVerified"
                    }
                }),
            chat_run
                .as_ref()
                .map(|run| run.detail.clone())
                .unwrap_or_else(|| {
                    if execute && agent_type.is_none() {
                        "execute=true was requested, but no agent://* runtime binding was available for Agent Chat Preview."
                            .to_string()
                    } else {
                        "Agent Chat Preview did not execute in this tool call; run with execute=true to record a hidden agent turn."
                            .to_string()
                    }
                }),
        ),
        check(
            "chatTranscript",
            chat_run
                .as_ref()
                .map(|run| run.log_status)
                .unwrap_or("notVerified"),
            chat_run
                .as_ref()
                .map(|run| run.log_detail.clone())
                .unwrap_or_else(|| "No Agent Chat transcript was recorded by this preview run.".to_string()),
        ),
    ]
}

struct AgentChatPreviewRun {
    status: &'static str,
    detail: String,
    log_status: &'static str,
    log_detail: String,
}

async fn execute_agent_chat_preview(
    agent_type: &str,
    prompt: &str,
    context: &ToolUseContext,
) -> AgentChatPreviewRun {
    let Some(agentic) = context.agentic() else {
        return AgentChatPreviewRun {
            status: "notVerified",
            detail: format!(
                "Agent Chat Preview resolved agent://{}, but no agentic coordinator was available to run a hidden turn.",
                agent_type
            ),
            log_status: "notVerified",
            log_detail: "Agent Chat Preview runner was unavailable in this tool context."
                .to_string(),
        };
    };
    let Some(tool_call_id) = context.tool_call_id.clone() else {
        return AgentChatPreviewRun {
            status: "notVerified",
            detail: format!(
                "Agent Chat Preview resolved agent://{}, but no parent tool call id was available for hidden execution.",
                agent_type
            ),
            log_status: "notVerified",
            log_detail: "Agent Chat Preview needs parent tool/session/turn metadata.".to_string(),
        };
    };
    let Some(session_id) = context.session_id.clone() else {
        return AgentChatPreviewRun {
            status: "notVerified",
            detail: format!(
                "Agent Chat Preview resolved agent://{}, but no parent session id was available for hidden execution.",
                agent_type
            ),
            log_status: "notVerified",
            log_detail: "Agent Chat Preview needs parent session metadata.".to_string(),
        };
    };
    let Some(dialog_turn_id) = context.dialog_turn_id.clone() else {
        return AgentChatPreviewRun {
            status: "notVerified",
            detail: format!(
                "Agent Chat Preview resolved agent://{}, but no parent dialog turn id was available for hidden execution.",
                agent_type
            ),
            log_status: "notVerified",
            log_detail: "Agent Chat Preview needs parent dialog turn metadata.".to_string(),
        };
    };
    let Some(workspace_path) = context
        .workspace_root()
        .map(|path| path.to_string_lossy().to_string())
    else {
        return AgentChatPreviewRun {
            status: "notVerified",
            detail: format!(
                "Agent Chat Preview resolved agent://{}, but no workspace path was available for hidden execution.",
                agent_type
            ),
            log_status: "notVerified",
            log_detail: "Agent Chat Preview needs a workspace-bound execution context."
                .to_string(),
        };
    };

    let mut subagent_context = HashMap::new();
    subagent_context.insert("preview_harness".to_string(), "agent-chat".to_string());
    let result = agentic
        .coordinator
        .execute_subagent(
            agent_type.to_string(),
            prompt.to_string(),
            SubagentParentInfo {
                tool_call_id,
                session_id,
                dialog_turn_id,
            },
            Some(workspace_path),
            Some(subagent_context),
            context.app_studio.clone(),
            context.cancellation_token.as_ref(),
        )
        .await;

    match result {
        Ok(result) if result.text.trim().is_empty() => AgentChatPreviewRun {
            status: "failed",
            detail: format!(
                "Agent Chat Preview executed agent://{} in hidden session {}, but the response was empty.",
                agent_type, result.session_id
            ),
            log_status: "failed",
            log_detail: "Hidden Agent Chat turn returned an empty response.".to_string(),
        },
        Ok(result) => AgentChatPreviewRun {
            status: "passed",
            detail: format!(
                "Agent Chat Preview executed agent://{} in hidden session {} and produced a response.",
                agent_type, result.session_id
            ),
            log_status: "passed",
            log_detail: truncate_detail(&result.text, 240),
        },
        Err(error) => AgentChatPreviewRun {
            status: "failed",
            detail: format!("Agent Chat Preview agent://{} failed: {error}", agent_type),
            log_status: "failed",
            log_detail: "Hidden Agent Chat turn failed before producing output.".to_string(),
        },
    }
}

fn agent_chat_preview_prompt(
    input: &Value,
    app_id: &str,
    version: &str,
    app_description: &str,
) -> String {
    if let Some(message) = fixture_string(input, "message")
        .or_else(|| fixture_string(input, "prompt"))
        .or_else(|| {
            input
                .get("fixture")
                .and_then(|fixture| fixture.get("input"))
                .and_then(|input| optional_string(input, "message"))
        })
        .filter(|message| !message.trim().is_empty())
    {
        return message;
    }

    format!(
        "Preview Product App {}@{}. Goal or description: {}. Reply with one concrete next step this app can take for a user.",
        app_id,
        version,
        if app_description.trim().is_empty() {
            "not specified"
        } else {
            app_description.trim()
        }
    )
}

async fn capability_preview_checks(
    app_studio: &AppStudioExecutionContext,
    context: &ToolUseContext,
    input: &Value,
    fixture_provided: bool,
    execute: bool,
) -> Vec<Value> {
    let AppStudioSubject::Component { .. } = &app_studio.subject else {
        return vec![check(
            "capabilityTarget",
            "failed",
            "Capability Preview requires a bound Component subject.".to_string(),
        )];
    };

    let package = match ProductAppResolver::read_component_package(&app_studio.package_root).await {
        Ok(package) => package,
        Err(error) => {
            return vec![check(
                "package",
                "failed",
                format!(
                    "Failed to read bound Component package at {}: {error}",
                    app_studio.package_root.display()
                ),
            )];
        }
    };

    let component = package.component;
    let version = component
        .version
        .clone()
        .unwrap_or_else(|| "0.0.0".to_string());
    let capability_count = component.capabilities.len();
    let action_count = component
        .capabilities
        .iter()
        .map(|capability| capability.actions.len())
        .sum::<usize>();
    let capability_labels = component
        .capabilities
        .iter()
        .map(|capability| {
            if capability.actions.is_empty() {
                capability.id.clone()
            } else {
                format!("{}({})", capability.id, capability.actions.join(", "))
            }
        })
        .collect::<Vec<_>>();
    let permission_labels = component
        .permissions
        .iter()
        .map(|permission| permission.kind.clone())
        .collect::<Vec<_>>();
    let invalid_dependencies = component
        .dependencies
        .iter()
        .filter(|dependency| dependency.source != ComponentSource::Shared)
        .map(|dependency| {
            format!(
                "{}:{}",
                dependency.kind.path_segment(),
                dependency.component_id
            )
        })
        .collect::<Vec<_>>();
    let contract_path = app_studio.package_root.join("tests").join("contract.md");
    let contract_text = fs::read_to_string(&contract_path).await.unwrap_or_default();
    let implementation_ref = component.implementation_ref.clone();
    let has_runnable_action = action_count > 0;
    let bridge_id = implementation_ref
        .as_deref()
        .and_then(bridge_component_id_from_ref);
    let agent_component_id = implementation_ref
        .as_deref()
        .and_then(agent_component_id_from_ref);
    let interactive_surface_runtime_id = implementation_ref
        .as_deref()
        .and_then(interactive_surface_runtime_id_from_ref);
    let agent_type = implementation_ref.as_deref().and_then(agent_type_from_ref);
    let skill_id = implementation_ref.as_deref().and_then(skill_id_from_ref);
    let requested_capability_id = input
        .get("fixture")
        .and_then(|fixture| optional_string(fixture, "capabilityId"))
        .or_else(|| {
            input
                .get("fixture")
                .and_then(|fixture| optional_string(fixture, "capability_id"))
        });
    let selected_capability = requested_capability_id
        .as_deref()
        .and_then(|id| {
            component
                .capabilities
                .iter()
                .find(|capability| capability.id == id)
        })
        .or_else(|| component.capabilities.first());
    let selected_action = input
        .get("fixture")
        .and_then(|fixture| optional_string(fixture, "action"))
        .or_else(|| selected_capability.and_then(|capability| capability.actions.first().cloned()));
    let explicit_agent_tool_name = input
        .get("fixture")
        .and_then(|fixture| optional_string(fixture, "toolName"))
        .or_else(|| {
            input
                .get("fixture")
                .and_then(|fixture| optional_string(fixture, "tool_name"))
        });
    let agent_tool_candidates = agent_component_tool_candidates(
        explicit_agent_tool_name.as_deref(),
        selected_action.as_deref(),
    );
    let selected_input = input
        .get("fixture")
        .and_then(|fixture| fixture.get("input"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let run_result = if execute {
        match (bridge_id, selected_capability, selected_action.as_deref()) {
            (Some(bridge_id), Some(capability), Some(action)) => {
                let workspace_path = context
                    .workspace_root()
                    .map(|path| path.to_string_lossy().to_string());
                let consumer = BridgeComponentConsumer {
                    kind: BridgeComponentConsumerKind::Management,
                    id: "app-studio-preview-harness".to_string(),
                    session_id: context.session_id.clone(),
                    turn_id: context.dialog_turn_id.clone(),
                };
                Some(
                    BridgeComponentManager::start_run(
                        bridge_id,
                        Some(&capability.id),
                        action,
                        selected_input.clone(),
                        workspace_path,
                        consumer,
                    )
                    .await,
                )
            }
            _ => None,
        }
    } else {
        None
    };
    let agent_tool_result = if execute && bridge_id.is_none() {
        match agent_component_id {
            Some(agent_component_id) if !agent_tool_candidates.is_empty() => {
                let workspace_root = context.workspace_root().map(|path| path.to_path_buf());
                let level = agent_component_level_from_input(input);
                let mut last_error = None;
                let mut result = None;
                for tool_name in agent_tool_candidates.iter() {
                    match AgentComponentManager::test_js_tool(
                        agent_component_id,
                        tool_name,
                        &selected_input,
                        level,
                        workspace_root.as_deref(),
                    )
                    .await
                    {
                        Ok(value) => {
                            result = Some((tool_name.clone(), Ok(value)));
                            break;
                        }
                        Err(error) => {
                            last_error = Some((tool_name.clone(), Err(error)));
                        }
                    }
                }
                result.or(last_error)
            }
            _ => None,
        }
    } else {
        None
    };
    let agent_runtime_result = if execute
        && has_runnable_action
        && bridge_id.is_none()
        && agent_component_id.is_none()
        && interactive_surface_runtime_id.is_none()
    {
        match agent_type {
            Some(agent_type) => {
                Some(resolve_agent_runtime_binding(agent_type, context.workspace_root()).await)
            }
            None => None,
        }
    } else {
        None
    };
    let skill_binding_result = if execute
        && has_runnable_action
        && bridge_id.is_none()
        && agent_component_id.is_none()
        && interactive_surface_runtime_id.is_none()
        && agent_type.is_none()
    {
        match skill_id {
            Some(skill_id) => Some(
                resolve_skill_binding(
                    skill_id,
                    context.workspace_root(),
                    context.agent_type.as_deref(),
                )
                .await,
            ),
            None => None,
        }
    } else {
        None
    };
    let interactive_surface_runtime_result = if execute
        && has_runnable_action
        && bridge_id.is_none()
        && agent_component_id.is_none()
        && agent_type.is_none()
        && skill_id.is_none()
    {
        match (interactive_surface_runtime_id, selected_action.as_deref()) {
            (Some(runtime_id), Some(action)) => Some(resolve_interactive_surface_runtime_binding(
                runtime_id,
                &component,
                action,
                app_studio.runtime_instance_id.as_deref(),
            )),
            _ => None,
        }
    } else {
        None
    };
    let (capability_trace_status, capability_trace_detail) = if let Some(Ok(result)) =
        run_result.as_ref()
    {
        (
            if result.status == BridgeComponentRunStatus::Completed {
                "passed"
            } else {
                "failed"
            },
            format!(
                "runner=bridge-component component={} capability={} action={} run={} events={}.",
                bridge_id.unwrap_or("unknown-bridge"),
                result
                    .capability_id
                    .as_deref()
                    .unwrap_or("unknown-capability"),
                result.action,
                result.run_id,
                result.events.len()
            ),
        )
    } else if let Some(Err(error)) = run_result.as_ref() {
        (
            "failed",
            format!("runner=bridge-component failed before trace capture: {error}"),
        )
    } else if let Some((tool_name, Ok(value))) = agent_tool_result.as_ref() {
        let result_count = value
            .get("results")
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0);
        (
            "passed",
            format!(
                "runner=agent-component-js component={} tool={} resultItems={}.",
                agent_component_id.unwrap_or("unknown-agent-component"),
                tool_name,
                result_count
            ),
        )
    } else if let Some((tool_name, Err(error))) = agent_tool_result.as_ref() {
        (
            "failed",
            format!("runner=agent-component-js tool={tool_name} failed: {error}"),
        )
    } else if let Some(Ok(binding)) = agent_runtime_result.as_ref() {
        (
                if binding.enabled { "passed" } else { "blocked" },
                format!(
                    "runner=agent-runtime-binding agent=agent://{} enabled={} kind={} model={} tools={} skills={} subagents={}.",
                    binding.agent_type,
                    binding.enabled,
                    binding.agent_kind,
                    binding.model.as_deref().unwrap_or("unconfigured"),
                    binding.tool_count,
                    binding.skill_count,
                    binding.subagent_count
                ),
            )
    } else if let Some(Err(error)) = agent_runtime_result.as_ref() {
        (
            "failed",
            format!("runner=agent-runtime-binding failed before trace capture: {error}"),
        )
    } else if let Some(Ok(binding)) = skill_binding_result.as_ref() {
        (
            if binding.selected {
                "passed"
            } else {
                "blocked"
            },
            format!(
                "runner=skill-binding skill=skill://{} selected={} key={} level={} sourceSlot={}.",
                binding.requested,
                binding.selected,
                binding.key,
                binding.level,
                binding.source_slot
            ),
        )
    } else if let Some(Err(error)) = skill_binding_result.as_ref() {
        (
            "failed",
            format!("runner=skill-binding failed before trace capture: {error}"),
        )
    } else if let Some(Ok(binding)) = interactive_surface_runtime_result.as_ref() {
        (
                "passed",
                format!(
                    "runner=interactive-surface-runtime runtime=runtime://{} component={} action={} runtimeInstance={}.",
                    binding.runtime_id,
                    binding.component_id,
                    binding.action,
                    binding
                        .runtime_instance_id
                        .as_deref()
                        .unwrap_or("unbound")
                ),
            )
    } else if let Some(Err(error)) = interactive_surface_runtime_result.as_ref() {
        (
            "failed",
            format!("runner=interactive-surface-runtime failed before trace capture: {error}"),
        )
    } else if implementation_ref.is_none() || !has_runnable_action {
        (
            "blocked",
            "No implementationRef/action pair is available for capability trace selection."
                .to_string(),
        )
    } else if execute {
        (
            "blocked",
            "execute=true did not match a supported capability runner; no trace was produced."
                .to_string(),
        )
    } else if fixture_provided {
        (
                "notVerified",
                format!(
                    "Fixture is present for action {}, but execute=false so no capability runner trace was produced.",
                    selected_action.as_deref().unwrap_or("unknown-action")
                ),
            )
    } else {
        (
            "notVerified",
            "No concrete capability runner trace is recorded for this preview.".to_string(),
        )
    };

    vec![
        check(
            "package",
            "passed",
            format!(
                "Read Component package {}/{}@{}.",
                component.kind.path_segment(),
                component.id,
                version
            ),
        ),
        check(
            "componentContract",
            if contract_text.trim().is_empty() {
                "failed"
            } else {
                "passed"
            },
            if contract_text.trim().is_empty() {
                format!(
                    "Contract file is missing or empty: {}",
                    contract_path.display()
                )
            } else {
                format!("Contract file is present: {}", contract_path.display())
            },
        ),
        check(
            "capabilitySchema",
            if capability_count == 0 {
                "warning"
            } else if action_count == 0 {
                "warning"
            } else {
                "passed"
            },
            if capability_count == 0 {
                "No capabilities are declared in component.json.".to_string()
            } else if action_count == 0 {
                format!(
                    "{} capability declaration(s) found, but none declare runnable actions.",
                    capability_count
                )
            } else {
                format!(
                    "{} capability declaration(s), {} action(s): {}.",
                    capability_count,
                    action_count,
                    capability_labels.join(", ")
                )
            },
        ),
        check(
            "implementation",
            if implementation_ref.is_some() {
                "passed"
            } else {
                "blocked"
            },
            implementation_ref.clone().unwrap_or_else(|| {
                "No implementationRef is declared for this capability.".to_string()
            }),
        ),
        check(
            "permissions",
            if permission_labels.is_empty() {
                "passed"
            } else {
                "warning"
            },
            if permission_labels.is_empty() {
                "No Component package permissions are declared.".to_string()
            } else {
                format!("Declared permissions: {}.", permission_labels.join(", "))
            },
        ),
        check(
            "dependencies",
            if invalid_dependencies.is_empty() {
                "passed"
            } else {
                "failed"
            },
            if invalid_dependencies.is_empty() {
                format!(
                    "{} shared dependencies are declared.",
                    component.dependencies.len()
                )
            } else {
                format!(
                    "Capability package depends on app-private components: {}.",
                    invalid_dependencies.join(", ")
                )
            },
        ),
        check(
            "capabilityCall",
            if let Some(Ok(result)) = run_result.as_ref() {
                if result.status == BridgeComponentRunStatus::Completed {
                    "passed"
                } else {
                    "failed"
                }
            } else if run_result.as_ref().is_some_and(Result::is_err) {
                "failed"
            } else if agent_tool_result
                .as_ref()
                .is_some_and(|(_, result)| result.is_ok())
            {
                "passed"
            } else if agent_tool_result
                .as_ref()
                .is_some_and(|(_, result)| result.is_err())
            {
                "failed"
            } else if agent_runtime_result
                .as_ref()
                .is_some_and(|result| result.as_ref().is_ok_and(|binding| binding.enabled))
            {
                "passed"
            } else if agent_runtime_result
                .as_ref()
                .is_some_and(|result| result.as_ref().is_ok_and(|binding| !binding.enabled))
            {
                "blocked"
            } else if agent_runtime_result.as_ref().is_some_and(Result::is_err) {
                "failed"
            } else if skill_binding_result
                .as_ref()
                .is_some_and(|result| result.as_ref().is_ok_and(|binding| binding.selected))
            {
                "passed"
            } else if skill_binding_result
                .as_ref()
                .is_some_and(|result| result.as_ref().is_ok_and(|binding| !binding.selected))
            {
                "blocked"
            } else if skill_binding_result.as_ref().is_some_and(Result::is_err) {
                "failed"
            } else if interactive_surface_runtime_result
                .as_ref()
                .is_some_and(Result::is_ok)
            {
                "passed"
            } else if interactive_surface_runtime_result
                .as_ref()
                .is_some_and(Result::is_err)
            {
                "failed"
            } else if implementation_ref.is_none() || !has_runnable_action {
                "blocked"
            } else if execute
                && bridge_id.is_none()
                && agent_component_id.is_none()
                && interactive_surface_runtime_id.is_none()
                && agent_type.is_none()
                && skill_id.is_none()
            {
                "blocked"
            } else if execute && agent_component_id.is_some() && agent_tool_candidates.is_empty() {
                "blocked"
            } else if execute {
                "blocked"
            } else {
                "notVerified"
            },
            if let Some(Ok(result)) = run_result.as_ref() {
                format!(
                    "Bridge capability {} action {} finished with status {:?} (run {}).",
                    result
                        .capability_id
                        .as_deref()
                        .unwrap_or("unknown-capability"),
                    result.action,
                    result.status,
                    result.run_id
                )
            } else if let Some(Err(error)) = run_result.as_ref() {
                format!("Bridge capability execution failed: {error}")
            } else if let Some((tool_name, Ok(value))) = agent_tool_result.as_ref() {
                let result_count = value
                    .get("results")
                    .and_then(Value::as_array)
                    .map(Vec::len)
                    .unwrap_or(0);
                format!(
                    "Agent Component JS runtime tool {} completed with {} result item(s).",
                    tool_name, result_count
                )
            } else if let Some((tool_name, Err(error))) = agent_tool_result.as_ref() {
                format!("Agent Component JS runtime tool {tool_name} failed: {error}")
            } else if let Some(Ok(binding)) = agent_runtime_result.as_ref() {
                if binding.enabled {
                    format!(
                        "Agent runtime binding agent://{} resolved: kind={}, model={}, tools={}, skills={}, subagents={}. No LLM turn was started.",
                        binding.agent_type,
                        binding.agent_kind,
                        binding.model.as_deref().unwrap_or("unconfigured"),
                        binding.tool_count,
                        binding.skill_count,
                        binding.subagent_count
                    )
                } else {
                    format!(
                        "Agent runtime binding agent://{} resolved but is disabled for runtime launch.",
                        binding.agent_type
                    )
                }
            } else if let Some(Err(error)) = agent_runtime_result.as_ref() {
                format!("Agent runtime binding check failed: {error}")
            } else if let Some(Ok(binding)) = skill_binding_result.as_ref() {
                if binding.selected {
                    format!(
                        "Skill binding skill://{} resolved for runtime: name={}, key={}, level={}, sourceSlot={}. Skill content was not invoked as behavioral eval.",
                        binding.requested,
                        binding.name,
                        binding.key,
                        binding.level,
                        binding.source_slot
                    )
                } else {
                    format!(
                        "Skill binding skill://{} exists as {}, but is not selected for the current App Studio agent/workspace runtime.",
                        binding.requested, binding.key
                    )
                }
            } else if let Some(Err(error)) = skill_binding_result.as_ref() {
                format!("Skill binding check failed: {error}")
            } else if let Some(Ok(binding)) = interactive_surface_runtime_result.as_ref() {
                format!(
                    "Interactive surface runtime runtime://{} resolved for {} action {} with hostKind=ProductAppRuntime and runtimeInstance={}. No iframe DOM observation was produced inside this tool call.",
                    binding.runtime_id,
                    binding.component_kind,
                    binding.action,
                    binding
                        .runtime_instance_id
                        .as_deref()
                        .unwrap_or("unbound")
                )
            } else if let Some(Err(error)) = interactive_surface_runtime_result.as_ref() {
                format!("Interactive surface runtime binding check failed: {error}")
            } else if implementation_ref.is_none() {
                "No implementationRef is available to invoke.".to_string()
            } else if !has_runnable_action {
                "No declared capability action is available to invoke.".to_string()
            } else if execute
                && bridge_id.is_none()
                && agent_component_id.is_none()
                && interactive_surface_runtime_id.is_none()
                && agent_type.is_none()
                && skill_id.is_none()
            {
                format!(
                    "execute=true is supported only for bundle://bridge-components/*, bundle://agent-components/*, runtime://interactive-surface, agent://*, or skill://* refs; current ref is {}.",
                    implementation_ref.unwrap_or_default()
                )
            } else if execute && agent_component_id.is_some() && agent_tool_candidates.is_empty() {
                "Agent Component capability execution requires fixture.toolName/tool_name or an action that maps to a JS runtime tool.".to_string()
            } else if execute {
                "execute=true was requested, but no matching capability/action could be selected."
                    .to_string()
            } else if fixture_provided {
                "Fixture input was recorded, but no Bridge, Agent Component, Interactive Surface, Agent, or Skill runtime executor has run it yet.".to_string()
            } else {
                "No fixture input or concrete executor result is recorded for this capability preview.".to_string()
            },
        ),
        check(
            "capabilityLogs",
            if let Some(Ok(result)) = run_result.as_ref() {
                if result
                    .stderr
                    .as_deref()
                    .is_some_and(|text| !text.trim().is_empty())
                {
                    "warning"
                } else if result.events.is_empty() {
                    "notVerified"
                } else {
                    "passed"
                }
            } else if agent_tool_result
                .as_ref()
                .is_some_and(|(_, result)| result.is_ok())
            {
                "passed"
            } else if agent_tool_result
                .as_ref()
                .is_some_and(|(_, result)| result.is_err())
            {
                "failed"
            } else if agent_runtime_result.as_ref().is_some_and(Result::is_ok) {
                "passed"
            } else if agent_runtime_result.as_ref().is_some_and(Result::is_err) {
                "failed"
            } else if skill_binding_result.as_ref().is_some_and(Result::is_ok) {
                "passed"
            } else if skill_binding_result.as_ref().is_some_and(Result::is_err) {
                "failed"
            } else if interactive_surface_runtime_result
                .as_ref()
                .is_some_and(Result::is_ok)
            {
                "passed"
            } else if interactive_surface_runtime_result
                .as_ref()
                .is_some_and(Result::is_err)
            {
                "failed"
            } else {
                "notVerified"
            },
            if let Some(Ok(result)) = run_result.as_ref() {
                let stderr_summary = result
                    .stderr
                    .as_deref()
                    .filter(|text| !text.trim().is_empty())
                    .map(|text| format!(" stderr={}", truncate_detail(text, 240)))
                    .unwrap_or_default();
                format!(
                    "{} event(s) recorded for bridge run {}.{}",
                    result.events.len(),
                    result.run_id,
                    stderr_summary
                )
            } else if let Some((tool_name, Ok(value))) = agent_tool_result.as_ref() {
                format!(
                    "Agent Component JS runtime tool {} returned {}.",
                    tool_name,
                    truncate_detail(&value.to_string(), 240)
                )
            } else if let Some((tool_name, Err(error))) = agent_tool_result.as_ref() {
                format!("Agent Component JS runtime tool {tool_name} failed before log collection: {error}")
            } else if let Some(Ok(binding)) = agent_runtime_result.as_ref() {
                format!(
                    "Agent runtime profile resolved for {}: kind={}, enabled={}, model={}, tools={}, skills={}, subagents={}.",
                    binding.agent_type,
                    binding.agent_kind,
                    binding.enabled,
                    binding.model.as_deref().unwrap_or("unconfigured"),
                    binding.tool_count,
                    binding.skill_count,
                    binding.subagent_count
                )
            } else if let Some(Err(error)) = agent_runtime_result.as_ref() {
                format!("Agent runtime profile resolution failed before log collection: {error}")
            } else if let Some(Ok(binding)) = skill_binding_result.as_ref() {
                format!(
                    "Skill profile resolved for {}: selected={}, name={}, key={}, level={}, path={}.",
                    binding.requested,
                    binding.selected,
                    binding.name,
                    binding.key,
                    binding.level,
                    binding.path
                )
            } else if let Some(Err(error)) = skill_binding_result.as_ref() {
                format!("Skill profile resolution failed before log collection: {error}")
            } else if let Some(Ok(binding)) = interactive_surface_runtime_result.as_ref() {
                format!(
                    "Interactive surface runtime contract resolved for {}: component={}, action={}, runtimeInstanceBound={}, hostApis=resolve_product_app_runtime_instance/product_app_runtime_*. Product App Runtime host observation remains a separate preview gate.",
                    binding.runtime_id,
                    binding.component_id,
                    binding.action,
                    binding.runtime_instance_id.is_some()
                )
            } else if let Some(Err(error)) = interactive_surface_runtime_result.as_ref() {
                format!(
                    "Interactive surface runtime contract resolution failed before log collection: {error}"
                )
            } else {
                "No capability runner logs are recorded for this preview run.".to_string()
            },
        ),
        check(
            "capabilityTrace",
            capability_trace_status,
            capability_trace_detail,
        ),
    ]
}

async fn agent_eval_preview_checks(
    app_studio: &AppStudioExecutionContext,
    context: &ToolUseContext,
    input: &Value,
    execute: bool,
) -> Vec<Value> {
    match &app_studio.subject {
        AppStudioSubject::ProductApp { .. } => {
            agent_eval_product_app_checks(app_studio, context, input, execute).await
        }
        AppStudioSubject::Component { .. } => {
            agent_eval_component_checks(app_studio, context, input, execute).await
        }
        AppStudioSubject::StudioDraft { .. } => vec![
            check(
                "agentEval",
                "notVerified",
                "Studio draft does not have a Product App or Component package with representative agent behavior to evaluate.".to_string(),
            ),
            check(
                "evalLogs",
                "notVerified",
                "Create or bind a package before running Agent Eval.".to_string(),
            ),
        ],
    }
}

async fn agent_eval_product_app_checks(
    app_studio: &AppStudioExecutionContext,
    context: &ToolUseContext,
    input: &Value,
    execute: bool,
) -> Vec<Value> {
    let package = match ProductAppResolver::read_product_app_package(&app_studio.package_root).await
    {
        Ok(package) => package,
        Err(error) => {
            return vec![
                check(
                    "agentEval",
                    "failed",
                    format!(
                        "Failed to read bound Product App package at {} before Agent Eval: {error}",
                        app_studio.package_root.display()
                    ),
                ),
                check(
                    "evalLogs",
                    "failed",
                    "No Agent Eval logs were produced because the Product App package could not be read."
                        .to_string(),
                ),
                check(
                    "evalTrace",
                    "failed",
                    "Product App package read failed before Agent Eval trace selection.".to_string(),
                ),
            ];
        }
    };

    let private_agents = package
        .private_components
        .iter()
        .filter(|component| component.kind == ComponentKind::Agent)
        .collect::<Vec<_>>();
    let declared_agent_ref_count = package
        .app
        .components
        .iter()
        .filter(|component| component.kind == ComponentKind::Agent)
        .count();
    let requires_eval =
        package.app.permissions.ai || declared_agent_ref_count > 0 || !private_agents.is_empty();

    if !input
        .get("fixture")
        .is_some_and(|fixture| !fixture.is_null())
    {
        return product_app_eval_plan_checks(
            &package.app.id,
            &package.app.version,
            requires_eval,
            package.app.permissions.ai,
            declared_agent_ref_count,
            &private_agents,
            package.eval_plan.as_ref().map(|plan| plan.cases.as_slice()),
            context,
            execute,
        )
        .await;
    }

    let selected_agent = fixture_string(input, "componentId")
        .or_else(|| fixture_string(input, "component_id"))
        .as_deref()
        .and_then(|component_id| {
            private_agents
                .iter()
                .find(|component| component.id == component_id)
                .copied()
        })
        .or_else(|| private_agents.first().copied());
    let implementation_ref = fixture_implementation_ref(input)
        .or_else(|| selected_agent.and_then(|component| component.implementation_ref.clone()));
    let selected_action = fixture_string(input, "action").or_else(|| {
        selected_agent.and_then(|component| {
            component
                .capabilities
                .first()
                .and_then(|capability| capability.actions.first().cloned())
        })
    });

    agent_eval_checks_for_ref(
        requires_eval,
        implementation_ref.as_deref(),
        selected_action.as_deref(),
        input,
        context,
        execute,
        format!(
            "No Agent Component or AI permission is declared by Product App {}@{}; Agent Eval is not required.",
            package.app.id, package.app.version
        ),
        format!(
            "Product App {}@{} declares AI behavior through aiPermission={}, agentRefs={}, privateAgentComponents={}.",
            package.app.id,
            package.app.version,
            package.app.permissions.ai,
            declared_agent_ref_count,
            private_agents.len()
        ),
    )
    .await
}

async fn product_app_eval_plan_checks(
    app_id: &str,
    version: &str,
    requires_eval: bool,
    ai_permission: bool,
    declared_agent_ref_count: usize,
    private_agents: &[&ComponentDefinition],
    cases: Option<&[ProductAppEvalCase]>,
    context: &ToolUseContext,
    execute: bool,
) -> Vec<Value> {
    if !requires_eval {
        return vec![
            check(
                "agentEval",
                "passed",
                format!(
                    "No Agent Component or AI permission is declared by Product App {app_id}@{version}; Agent Eval is not required."
                ),
            ),
            check(
                "evalLogs",
                "passed",
                "No Agent Eval execution log is required for this target.".to_string(),
            ),
        ];
    }

    let cases = cases.unwrap_or(&[]);
    if cases.is_empty() {
        return vec![
            check(
                "agentEval",
                "notVerified",
                format!(
                    "Product App {app_id}@{version} declares AI behavior through aiPermission={ai_permission}, agentRefs={declared_agent_ref_count}, privateAgentComponents={}; no machine-readable Agent Eval case is declared in tests/eval.json.",
                    private_agents.len()
                ),
            ),
            check(
                "evalLogs",
                "notVerified",
                "No Product App Agent Eval cases are available to execute.".to_string(),
            ),
            check(
                "evalTrace",
                "notVerified",
                "No machine-readable Agent Eval case is available for trace capture.".to_string(),
            ),
        ];
    }

    if !execute {
        return vec![
            check(
                "agentEval",
                "notVerified",
                format!(
                    "Product App {app_id}@{version} declares {} Agent Eval case(s) in tests/eval.json. Run RunStudioPreview with mode=\"agent-eval\" and execute=true to execute them.",
                    cases.len()
                ),
            ),
            check(
                "evalLogs",
                "notVerified",
                "No Product App Agent Eval runner executed in this tool call.".to_string(),
            ),
            check(
                "evalTrace",
                "notVerified",
                format!(
                    "{} Agent Eval case(s) are declared, but execute=false so no eval runner trace was produced.",
                    cases.len()
                ),
            ),
        ];
    }

    let mut results = Vec::new();
    for case in cases {
        results.push(execute_product_app_eval_case(case, private_agents, context).await);
    }

    let status = aggregate_eval_case_status(&results);
    let passed = results
        .iter()
        .filter(|result| result.status == "passed")
        .count();
    let failed = results
        .iter()
        .filter(|result| result.status == "failed")
        .count();
    let blocked = results
        .iter()
        .filter(|result| result.status == "blocked")
        .count();
    let not_verified = results
        .iter()
        .filter(|result| result.status == "notVerified")
        .count();
    let first_problem = results
        .iter()
        .find(|result| result.status != "passed")
        .map(|result| {
            format!(
                " First non-passing case {}: {}",
                result.case_id, result.detail
            )
        })
        .unwrap_or_default();
    let log_status = if results.iter().any(|result| result.log_status == "failed") {
        "failed"
    } else if results.iter().any(|result| result.log_status == "blocked") {
        "blocked"
    } else if results
        .iter()
        .any(|result| result.log_status == "notVerified")
    {
        "notVerified"
    } else if results.iter().any(|result| result.log_status == "warning") {
        "warning"
    } else {
        "passed"
    };
    let log_detail = results
        .iter()
        .map(|result| {
            format!(
                "{} [{}]: {}",
                result.case_id, result.log_status, result.log_detail
            )
        })
        .collect::<Vec<_>>()
        .join(" | ");
    let trace_detail = results
        .iter()
        .map(|result| format!("{} [{}]: {}", result.case_id, result.status, result.detail))
        .collect::<Vec<_>>()
        .join(" | ");

    vec![
        check(
            "agentEval",
            status,
            format!(
                "Product App Agent Eval executed {} case(s): passed={}, failed={}, blocked={}, notVerified={}.{}",
                results.len(),
                passed,
                failed,
                blocked,
                not_verified,
                first_problem
            ),
        ),
        check("evalLogs", log_status, truncate_detail(&log_detail, 480)),
        check("evalTrace", status, truncate_detail(&trace_detail, 480)),
    ]
}

#[derive(Debug, Clone)]
struct ProductAppEvalCaseResult {
    case_id: String,
    status: &'static str,
    detail: String,
    log_status: &'static str,
    log_detail: String,
}

async fn execute_product_app_eval_case(
    case: &ProductAppEvalCase,
    private_agents: &[&ComponentDefinition],
    context: &ToolUseContext,
) -> ProductAppEvalCaseResult {
    let selected_agent = case
        .component_id
        .as_deref()
        .and_then(non_empty_trimmed)
        .and_then(|component_id| {
            private_agents
                .iter()
                .find(|component| component.id == component_id)
                .copied()
        })
        .or_else(|| {
            if private_agents.len() == 1 {
                private_agents.first().copied()
            } else {
                None
            }
        });
    let implementation_ref = case
        .implementation_ref
        .as_deref()
        .and_then(non_empty_trimmed)
        .or_else(|| selected_agent.and_then(|component| component.implementation_ref.as_deref()));
    let selected_action = case
        .action
        .as_deref()
        .and_then(non_empty_trimmed)
        .or_else(|| {
            selected_agent.and_then(|component| {
                component
                    .capabilities
                    .first()
                    .and_then(|capability| capability.actions.first().map(String::as_str))
            })
        });

    let Some(implementation_ref) = implementation_ref else {
        return ProductAppEvalCaseResult {
            case_id: case.id.clone(),
            status: "blocked",
            detail: "No implementationRef is available for this eval case.".to_string(),
            log_status: "blocked",
            log_detail: "Agent Eval could not select an implementation to execute.".to_string(),
        };
    };

    if let Some(agent_component_id) = agent_component_id_from_ref(implementation_ref) {
        if case.evidence_kind == ProductAppEvalEvidenceKind::RuntimeBinding {
            return ProductAppEvalCaseResult {
                case_id: case.id.clone(),
                status: "blocked",
                detail: format!(
                    "Eval case {} declares evidenceKind=runtime-binding, which requires an agent://* implementationRef.",
                    case.id
                ),
                log_status: "blocked",
                log_detail:
                    "Runtime binding evidence must be produced by the agent runtime binding resolver."
                        .to_string(),
            };
        }
        let candidates =
            agent_component_tool_candidates(case.tool_name.as_deref(), selected_action);
        if candidates.is_empty() {
            return ProductAppEvalCaseResult {
                case_id: case.id.clone(),
                status: "blocked",
                detail: "No Agent Component JS runtime tool candidate was declared.".to_string(),
                log_status: "blocked",
                log_detail:
                    "Eval case requires toolName/tool_name or an action that maps to a JS runtime tool."
                        .to_string(),
            };
        }

        let workspace_root = context.workspace_root().map(|path| path.to_path_buf());
        let mut last_error = None;
        for tool_name in candidates.iter() {
            match AgentComponentManager::test_js_tool(
                agent_component_id,
                tool_name,
                &case.input,
                None,
                workspace_root.as_deref(),
            )
            .await
            {
                Ok(value) => {
                    if let Err(error) =
                        evaluate_product_app_eval_expectations(&value, &case.expectations)
                    {
                        return ProductAppEvalCaseResult {
                            case_id: case.id.clone(),
                            status: if case.required { "failed" } else { "warning" },
                            detail: format!(
                                "Eval case {} ran JS runtime tool {tool_name}, but expectation failed: {error}",
                                case.id
                            ),
                            log_status: if case.required { "failed" } else { "warning" },
                            log_detail: truncate_detail(&value.to_string(), 240),
                        };
                    }
                    let result_count = value
                        .get("results")
                        .and_then(Value::as_array)
                        .map(Vec::len)
                        .unwrap_or(0);
                    return ProductAppEvalCaseResult {
                        case_id: case.id.clone(),
                        status: "passed",
                        detail: format!(
                            "Eval case {} executed Agent Component JS runtime tool {tool_name} with {result_count} result item(s) and {} expectation(s).",
                            case.id,
                            case.expectations.len()
                        ),
                        log_status: "passed",
                        log_detail: truncate_detail(&value.to_string(), 240),
                    };
                }
                Err(error) => {
                    last_error = Some((tool_name.clone(), error.to_string()));
                }
            }
        }

        let (tool_name, error) =
            last_error.unwrap_or_else(|| ("unknown".to_string(), "No tool executed.".to_string()));
        return ProductAppEvalCaseResult {
            case_id: case.id.clone(),
            status: if case.required { "failed" } else { "warning" },
            detail: format!(
                "Eval case {} JS runtime tool {tool_name} failed: {error}",
                case.id
            ),
            log_status: if case.required { "failed" } else { "warning" },
            log_detail: "Agent Eval runner failed before producing a passing fixture result."
                .to_string(),
        };
    }

    if let Some(agent_type) = agent_type_from_ref(implementation_ref) {
        return match resolve_agent_runtime_binding(agent_type, context.workspace_root()).await {
            Ok(binding) if binding.enabled => {
                if case.evidence_kind == ProductAppEvalEvidenceKind::RuntimeBinding {
                    let output = agent_runtime_binding_eval_output(&binding, &case.input);
                    if let Err(error) =
                        evaluate_product_app_eval_expectations(&output, &case.expectations)
                    {
                        ProductAppEvalCaseResult {
                            case_id: case.id.clone(),
                            status: if case.required { "failed" } else { "warning" },
                            detail: format!(
                                "Eval case {} resolved agent://{} runtime binding, but expectation failed: {error}",
                                case.id, binding.agent_type
                            ),
                            log_status: if case.required { "failed" } else { "warning" },
                            log_detail: truncate_detail(&output.to_string(), 240),
                        }
                    } else {
                        ProductAppEvalCaseResult {
                            case_id: case.id.clone(),
                            status: "passed",
                            detail: format!(
                                "Eval case {} verified agent://{} runtime binding with {} expectation(s).",
                                case.id,
                                binding.agent_type,
                                case.expectations.len()
                            ),
                            log_status: "passed",
                            log_detail: truncate_detail(&output.to_string(), 240),
                        }
                    }
                } else if case.evidence_kind == ProductAppEvalEvidenceKind::JsTool {
                    ProductAppEvalCaseResult {
                        case_id: case.id.clone(),
                        status: "blocked",
                        detail: format!(
                            "Eval case {} declares evidenceKind=js-tool, which requires a bundle://agent-components/* implementationRef.",
                            case.id
                        ),
                        log_status: "blocked",
                        log_detail:
                            "Agent Component JS tool evidence cannot be produced from an agent:// runtime binding."
                                .to_string(),
                    }
                } else {
                    execute_agent_behavior_eval_case(case, &binding.agent_type, context).await
                }
            }
            Ok(binding) => ProductAppEvalCaseResult {
                case_id: case.id.clone(),
                status: "blocked",
                detail: format!(
                    "Eval case {} resolved agent://{} but the runtime binding is disabled.",
                    case.id, binding.agent_type
                ),
                log_status: "blocked",
                log_detail: "Disabled agent runtime cannot produce representative eval evidence."
                    .to_string(),
            },
            Err(error) => ProductAppEvalCaseResult {
                case_id: case.id.clone(),
                status: "failed",
                detail: format!(
                    "Eval case {} agent runtime binding failed before eval execution: {error}",
                    case.id
                ),
                log_status: "failed",
                log_detail:
                    "Agent runtime profile resolution failed before Agent Eval log collection."
                        .to_string(),
            },
        };
    }

    ProductAppEvalCaseResult {
        case_id: case.id.clone(),
        status: "blocked",
        detail: format!(
            "Eval case {} uses unsupported implementationRef {implementation_ref}.",
            case.id
        ),
        log_status: "blocked",
        log_detail:
            "Agent Eval supports bundle://agent-components/* JS runtime tool cases or agent://* runtime binding checks."
                .to_string(),
    }
}

async fn execute_agent_behavior_eval_case(
    case: &ProductAppEvalCase,
    agent_type: &str,
    context: &ToolUseContext,
) -> ProductAppEvalCaseResult {
    let Some(agentic) = context.agentic() else {
        return ProductAppEvalCaseResult {
            case_id: case.id.clone(),
            status: "notVerified",
            detail: format!(
                "Eval case {} resolved agent://{}, but no agentic coordinator was available to run a representative behavior eval.",
                case.id, agent_type
            ),
            log_status: "notVerified",
            log_detail: "Agent behavior eval runner was unavailable in this tool context."
                .to_string(),
        };
    };
    let Some(tool_call_id) = context.tool_call_id.clone() else {
        return ProductAppEvalCaseResult {
            case_id: case.id.clone(),
            status: "notVerified",
            detail: format!(
                "Eval case {} resolved agent://{}, but no parent tool call id was available for hidden eval execution.",
                case.id, agent_type
            ),
            log_status: "notVerified",
            log_detail: "Agent behavior eval needs parent tool/session/turn metadata.".to_string(),
        };
    };
    let Some(session_id) = context.session_id.clone() else {
        return ProductAppEvalCaseResult {
            case_id: case.id.clone(),
            status: "notVerified",
            detail: format!(
                "Eval case {} resolved agent://{}, but no parent session id was available for hidden eval execution.",
                case.id, agent_type
            ),
            log_status: "notVerified",
            log_detail: "Agent behavior eval needs parent session metadata.".to_string(),
        };
    };
    let Some(dialog_turn_id) = context.dialog_turn_id.clone() else {
        return ProductAppEvalCaseResult {
            case_id: case.id.clone(),
            status: "notVerified",
            detail: format!(
                "Eval case {} resolved agent://{}, but no parent dialog turn id was available for hidden eval execution.",
                case.id, agent_type
            ),
            log_status: "notVerified",
            log_detail: "Agent behavior eval needs parent dialog turn metadata.".to_string(),
        };
    };
    let Some(workspace_path) = context
        .workspace_root()
        .map(|path| path.to_string_lossy().to_string())
    else {
        return ProductAppEvalCaseResult {
            case_id: case.id.clone(),
            status: "notVerified",
            detail: format!(
                "Eval case {} resolved agent://{}, but no workspace path was available for hidden eval execution.",
                case.id, agent_type
            ),
            log_status: "notVerified",
            log_detail: "Agent behavior eval needs a workspace-bound execution context."
                .to_string(),
        };
    };

    let mut subagent_context = HashMap::new();
    subagent_context.insert("preview_harness".to_string(), "agent-eval".to_string());
    subagent_context.insert("eval_case_id".to_string(), case.id.clone());
    let prompt = behavior_eval_prompt(case);
    let result = agentic
        .coordinator
        .execute_subagent(
            agent_type.to_string(),
            prompt,
            SubagentParentInfo {
                tool_call_id,
                session_id,
                dialog_turn_id,
            },
            Some(workspace_path),
            Some(subagent_context),
            context.app_studio.clone(),
            context.cancellation_token.as_ref(),
        )
        .await;

    match result {
        Ok(result) => {
            let output = Value::String(result.text.clone());
            if let Err(error) = evaluate_product_app_eval_expectations(&output, &case.expectations)
            {
                ProductAppEvalCaseResult {
                    case_id: case.id.clone(),
                    status: if case.required { "failed" } else { "warning" },
                    detail: format!(
                        "Eval case {} executed agent://{} behavior in hidden session {}, but expectation failed: {error}",
                        case.id, agent_type, result.session_id
                    ),
                    log_status: if case.required { "failed" } else { "warning" },
                    log_detail: truncate_detail(&result.text, 240),
                }
            } else {
                ProductAppEvalCaseResult {
                    case_id: case.id.clone(),
                    status: "passed",
                    detail: format!(
                        "Eval case {} executed agent://{} behavior in hidden session {} with {} expectation(s).",
                        case.id,
                        agent_type,
                        result.session_id,
                        case.expectations.len()
                    ),
                    log_status: "passed",
                    log_detail: truncate_detail(&result.text, 240),
                }
            }
        }
        Err(error) => ProductAppEvalCaseResult {
            case_id: case.id.clone(),
            status: if case.required { "failed" } else { "warning" },
            detail: format!(
                "Eval case {} agent://{} behavior runner failed: {error}",
                case.id, agent_type
            ),
            log_status: if case.required { "failed" } else { "warning" },
            log_detail: "Agent behavior eval runner failed before producing output.".to_string(),
        },
    }
}

fn behavior_eval_prompt(case: &ProductAppEvalCase) -> String {
    if let Some(message) = case
        .input
        .get("message")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return message.to_string();
    }
    if let Some(prompt) = case
        .input
        .get("prompt")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return prompt.to_string();
    }

    format!(
        "Run this App Studio behavior eval case.\n\nCase: {}\nTitle: {}\nDescription: {}\nInput JSON: {}",
        case.id,
        case.title,
        case.description,
        case.input
    )
}

fn aggregate_eval_case_status(results: &[ProductAppEvalCaseResult]) -> &'static str {
    if results.iter().any(|result| result.status == "failed") {
        "failed"
    } else if results.iter().any(|result| result.status == "blocked") {
        "blocked"
    } else if results.iter().any(|result| result.status == "notVerified") {
        "notVerified"
    } else if results.iter().any(|result| result.status == "warning") {
        "warning"
    } else {
        "passed"
    }
}

fn agent_runtime_binding_eval_output(
    binding: &AgentRuntimeBindingEvidence,
    input: &Value,
) -> Value {
    json!({
        "kind": "agent-runtime-binding",
        "agentType": &binding.agent_type,
        "agentKind": &binding.agent_kind,
        "enabled": binding.enabled,
        "model": binding.model.as_deref().unwrap_or("unconfigured"),
        "toolCount": binding.tool_count,
        "skillCount": binding.skill_count,
        "subagentCount": binding.subagent_count,
        "input": input,
    })
}

fn evaluate_product_app_eval_expectations(
    output: &Value,
    expectations: &[ProductAppEvalExpectation],
) -> Result<(), String> {
    for (index, expectation) in expectations.iter().enumerate() {
        match expectation.kind {
            ProductAppEvalExpectationKind::JsonEquals => {
                let actual = expectation
                    .path
                    .as_deref()
                    .and_then(|path| value_at_path(output, path))
                    .unwrap_or(output);
                let expected = expectation
                    .value
                    .as_ref()
                    .ok_or_else(|| format!("expectation {index} json-equals is missing value"))?;
                if actual != expected {
                    return Err(format!(
                        "expectation {index} json-equals mismatch at {}: expected {}, got {}",
                        expectation.path.as_deref().unwrap_or("$"),
                        expected,
                        actual
                    ));
                }
            }
            ProductAppEvalExpectationKind::JsonContains => {
                let actual = expectation
                    .path
                    .as_deref()
                    .and_then(|path| value_at_path(output, path))
                    .unwrap_or(output);
                let expected = expectation
                    .value
                    .as_ref()
                    .ok_or_else(|| format!("expectation {index} json-contains is missing value"))?;
                if !json_contains(actual, expected) {
                    return Err(format!(
                        "expectation {index} json-contains mismatch at {}: expected subset {} in {}",
                        expectation.path.as_deref().unwrap_or("$"),
                        expected,
                        actual
                    ));
                }
            }
            ProductAppEvalExpectationKind::TextContains => {
                let actual = expectation
                    .path
                    .as_deref()
                    .and_then(|path| value_at_path(output, path))
                    .unwrap_or(output);
                let expected = expectation
                    .value
                    .as_ref()
                    .ok_or_else(|| format!("expectation {index} text-contains is missing value"))?;
                let needle = expected
                    .as_str()
                    .map(ToString::to_string)
                    .unwrap_or_else(|| expected.to_string());
                let haystack = actual
                    .as_str()
                    .map(ToString::to_string)
                    .unwrap_or_else(|| actual.to_string());
                if !haystack.contains(&needle) {
                    return Err(format!(
                        "expectation {index} text-contains mismatch at {}: expected text containing {}",
                        expectation.path.as_deref().unwrap_or("$"),
                        needle
                    ));
                }
            }
            ProductAppEvalExpectationKind::ResultCountAtLeast => {
                let actual = expectation
                    .path
                    .as_deref()
                    .and_then(|path| value_at_path(output, path))
                    .or_else(|| output.get("results"))
                    .unwrap_or(output);
                let expected = expectation
                    .value
                    .as_ref()
                    .and_then(Value::as_u64)
                    .ok_or_else(|| {
                        format!(
                            "expectation {index} result-count-at-least is missing numeric value"
                        )
                    })? as usize;
                let actual_count = actual.as_array().map(Vec::len).ok_or_else(|| {
                    format!(
                        "expectation {index} result-count-at-least target {} is not an array",
                        expectation.path.as_deref().unwrap_or("results")
                    )
                })?;
                if actual_count < expected {
                    return Err(format!(
                        "expectation {index} result-count-at-least mismatch: expected at least {expected}, got {actual_count}"
                    ));
                }
            }
        }
    }
    Ok(())
}

fn value_at_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for segment in path.trim().trim_start_matches("$.").split('.') {
        if segment.is_empty() {
            continue;
        }
        if let Ok(index) = segment.parse::<usize>() {
            current = current.as_array()?.get(index)?;
        } else {
            current = current.get(segment)?;
        }
    }
    Some(current)
}

fn json_contains(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Object(actual), Value::Object(expected)) => expected.iter().all(|(key, value)| {
            actual
                .get(key)
                .is_some_and(|actual_value| json_contains(actual_value, value))
        }),
        (Value::Array(actual), Value::Array(expected)) => expected.iter().all(|expected_value| {
            actual
                .iter()
                .any(|actual_value| json_contains(actual_value, expected_value))
        }),
        _ => actual == expected,
    }
}

async fn agent_eval_component_checks(
    app_studio: &AppStudioExecutionContext,
    context: &ToolUseContext,
    input: &Value,
    execute: bool,
) -> Vec<Value> {
    let package = match ProductAppResolver::read_component_package(&app_studio.package_root).await {
        Ok(package) => package,
        Err(error) => {
            return vec![
                check(
                    "agentEval",
                    "failed",
                    format!(
                        "Failed to read bound Component package at {} before Agent Eval: {error}",
                        app_studio.package_root.display()
                    ),
                ),
                check(
                    "evalLogs",
                    "failed",
                    "No Agent Eval logs were produced because the Component package could not be read."
                        .to_string(),
                ),
                check(
                    "evalTrace",
                    "failed",
                    "Component package read failed before Agent Eval trace selection.".to_string(),
                ),
            ];
        }
    };

    let component = package.component;
    let action_count = component
        .capabilities
        .iter()
        .map(|capability| capability.actions.len())
        .sum::<usize>();
    let requires_eval = component.kind == ComponentKind::Agent || action_count > 0;
    let implementation_ref = fixture_implementation_ref(input).or(component.implementation_ref);
    let selected_action = fixture_string(input, "action").or_else(|| {
        component
            .capabilities
            .first()
            .and_then(|capability| capability.actions.first().cloned())
    });
    let version = component
        .version
        .clone()
        .unwrap_or_else(|| "0.0.0".to_string());

    agent_eval_checks_for_ref(
        requires_eval,
        implementation_ref.as_deref(),
        selected_action.as_deref(),
        input,
        context,
        execute,
        format!(
            "Component package {}/{}@{} has no Agent behavior or runnable action requiring Agent Eval.",
            component.kind.path_segment(),
            component.id,
            version
        ),
        format!(
            "Component package {}/{}@{} declares kind={} and {} runnable action(s); representative eval/action evidence is required.",
            component.kind.path_segment(),
            component.id,
            version,
            component.kind.path_segment(),
            action_count
        ),
    )
    .await
}

async fn agent_eval_checks_for_ref(
    requires_eval: bool,
    implementation_ref: Option<&str>,
    selected_action: Option<&str>,
    input: &Value,
    context: &ToolUseContext,
    execute: bool,
    not_required_detail: String,
    required_detail: String,
) -> Vec<Value> {
    if !requires_eval {
        return vec![
            check("agentEval", "passed", not_required_detail),
            check(
                "evalLogs",
                "passed",
                "No Agent Eval execution log is required for this target.".to_string(),
            ),
        ];
    }

    if !execute {
        return vec![
            check(
                "agentEval",
                "notVerified",
                format!(
                    "{required_detail} Run RunStudioPreview with mode=\"agent-eval\", execute=true, and a representative fixture/action to produce executable evidence."
                ),
            ),
            check(
                "evalLogs",
                "notVerified",
                "No Agent Eval runner executed in this tool call.".to_string(),
            ),
            check(
                "evalTrace",
                "notVerified",
                "execute=false so no Agent Eval runner trace was produced.".to_string(),
            ),
        ];
    }

    let Some(implementation_ref) = implementation_ref.and_then(non_empty_trimmed) else {
        return vec![
            check(
                "agentEval",
                "blocked",
                format!(
                    "{required_detail} No implementationRef is available for an Agent Eval runner."
                ),
            ),
            check(
                "evalLogs",
                "blocked",
                "Agent Eval could not select an implementation to execute.".to_string(),
            ),
            check(
                "evalTrace",
                "blocked",
                "No implementationRef was available for Agent Eval trace selection.".to_string(),
            ),
        ];
    };

    if let Some(agent_component_id) = agent_component_id_from_ref(implementation_ref) {
        let explicit_tool_name =
            fixture_string(input, "toolName").or_else(|| fixture_string(input, "tool_name"));
        let candidates =
            agent_component_tool_candidates(explicit_tool_name.as_deref(), selected_action);
        if candidates.is_empty() {
            return vec![
                check(
                    "agentEval",
                    "blocked",
                    "Agent Component eval requires fixture.toolName/tool_name or an action that maps to a JS runtime tool.".to_string(),
                ),
                check(
                    "evalLogs",
                    "blocked",
                    "No Agent Component JS runtime tool candidate could be selected for Agent Eval."
                        .to_string(),
                ),
                check(
                    "evalTrace",
                    "blocked",
                    "No Agent Component JS runtime tool candidate was available for eval trace."
                        .to_string(),
                ),
            ];
        }

        let selected_input = fixture_input(input);
        let workspace_root = context.workspace_root().map(|path| path.to_path_buf());
        let level = agent_component_level_from_input(input);
        let mut last_error = None;
        for tool_name in candidates.iter() {
            match AgentComponentManager::test_js_tool(
                agent_component_id,
                tool_name,
                &selected_input,
                level,
                workspace_root.as_deref(),
            )
            .await
            {
                Ok(value) => {
                    match fixture_eval_expectations(input) {
                        Ok(expectations) => {
                            if let Err(error) =
                                evaluate_product_app_eval_expectations(&value, &expectations)
                            {
                                return vec![
                                    check(
                                        "agentEval",
                                        "failed",
                                        format!(
                                            "Agent Eval executed Agent Component JS runtime tool {tool_name}, but fixture expectation failed: {error}"
                                        ),
                                    ),
                                    check(
                                        "evalLogs",
                                        "failed",
                                        truncate_detail(&value.to_string(), 240),
                                    ),
                                    check(
                                        "evalTrace",
                                        "failed",
                                        format!(
                                            "runner=agent-component-js component={} tool={} expectation=failed.",
                                            agent_component_id, tool_name
                                        ),
                                    ),
                                ];
                            }
                        }
                        Err(error) => {
                            return vec![
                                check(
                                    "agentEval",
                                    "blocked",
                                    format!("Agent Eval fixture expectations are invalid: {error}"),
                                ),
                                check(
                                    "evalLogs",
                                    "blocked",
                                    "Agent Eval could not evaluate malformed fixture expectations."
                                        .to_string(),
                                ),
                                check(
                                    "evalTrace",
                                    "blocked",
                                    "Malformed fixture expectations prevented eval trace evaluation."
                                        .to_string(),
                                ),
                            ];
                        }
                    }
                    let result_count = value
                        .get("results")
                        .and_then(Value::as_array)
                        .map(Vec::len)
                        .unwrap_or(0);
                    return vec![
                        check(
                            "agentEval",
                            "passed",
                            format!(
                                "Agent Eval executed Agent Component JS runtime tool {tool_name} with {result_count} result item(s)."
                            ),
                        ),
                        check(
                            "evalLogs",
                            "passed",
                            format!(
                                "Agent Eval fixture returned {}.",
                                truncate_detail(&value.to_string(), 240)
                            ),
                        ),
                        check(
                            "evalTrace",
                            "passed",
                            format!(
                                "runner=agent-component-js component={} tool={} resultItems={}.",
                                agent_component_id, tool_name, result_count
                            ),
                        ),
                    ];
                }
                Err(error) => {
                    last_error = Some((tool_name.clone(), error.to_string()));
                }
            }
        }

        let (tool_name, error) =
            last_error.unwrap_or_else(|| ("unknown".to_string(), "No tool executed.".to_string()));
        return vec![
            check(
                "agentEval",
                "failed",
                format!("Agent Eval JS runtime tool {tool_name} failed: {error}"),
            ),
            check(
                "evalLogs",
                "failed",
                "Agent Eval runner failed before producing a passing fixture result.".to_string(),
            ),
            check(
                "evalTrace",
                "failed",
                format!("runner=agent-component-js tool={tool_name} failed before trace pass."),
            ),
        ];
    }

    if let Some(agent_type) = agent_type_from_ref(implementation_ref) {
        return match resolve_agent_runtime_binding(agent_type, context.workspace_root()).await {
            Ok(binding) if binding.enabled => {
                let eval_case = match fixture_eval_case(input, implementation_ref, selected_action)
                {
                    Ok(eval_case) => eval_case,
                    Err(error) => {
                        return vec![
                            check(
                                "agentEval",
                                "blocked",
                                format!("Agent Eval fixture is invalid: {error}"),
                            ),
                            check(
                                "evalLogs",
                                "blocked",
                                "Agent Eval could not construct an executable eval case from the fixture."
                                    .to_string(),
                            ),
                            check(
                                "evalTrace",
                                "blocked",
                                "Invalid fixture prevented Agent Eval trace selection.".to_string(),
                            ),
                        ];
                    }
                };
                match eval_case.evidence_kind {
                    ProductAppEvalEvidenceKind::RuntimeBinding => {
                        let output = agent_runtime_binding_eval_output(&binding, &eval_case.input);
                        if let Err(error) = evaluate_product_app_eval_expectations(
                            &output,
                            &eval_case.expectations,
                        ) {
                            vec![
                                check(
                                    "agentEval",
                                    if eval_case.required { "failed" } else { "warning" },
                                    format!(
                                        "Agent runtime binding agent://{} resolved, but fixture expectation failed: {error}",
                                        binding.agent_type
                                    ),
                                ),
                                check(
                                    "evalLogs",
                                    if eval_case.required { "failed" } else { "warning" },
                                    truncate_detail(&output.to_string(), 240),
                                ),
                                check(
                                    "evalTrace",
                                    if eval_case.required { "failed" } else { "warning" },
                                    format!(
                                        "runner=agent-runtime-binding agent=agent://{} expectation=failed.",
                                        binding.agent_type
                                    ),
                                ),
                            ]
                        } else {
                            vec![
                                check(
                                    "agentEval",
                                    "passed",
                                    format!(
                                        "Agent runtime binding agent://{} resolved and satisfied {} fixture expectation(s).",
                                        binding.agent_type,
                                        eval_case.expectations.len()
                                    ),
                                ),
                                check(
                                    "evalLogs",
                                    "passed",
                                    truncate_detail(&output.to_string(), 240),
                                ),
                                check(
                                    "evalTrace",
                                    "passed",
                                    format!(
                                        "runner=agent-runtime-binding agent=agent://{} expectations={}.",
                                        binding.agent_type,
                                        eval_case.expectations.len()
                                    ),
                                ),
                            ]
                        }
                    }
                    ProductAppEvalEvidenceKind::JsTool => vec![
                        check(
                            "agentEval",
                            "blocked",
                            format!(
                                "Agent Eval fixture declares evidenceKind=js-tool, which requires a bundle://agent-components/* implementationRef; got agent://{}.",
                                binding.agent_type
                            ),
                        ),
                        check(
                            "evalLogs",
                            "blocked",
                            "Agent Component JS tool evidence cannot be produced from an agent:// runtime binding."
                                .to_string(),
                        ),
                        check(
                            "evalTrace",
                            "blocked",
                            format!(
                                "runner=agent-runtime-binding agent=agent://{} cannot satisfy js-tool evidence.",
                                binding.agent_type
                            ),
                        ),
                    ],
                    ProductAppEvalEvidenceKind::Behavior => {
                        let result =
                            execute_agent_behavior_eval_case(&eval_case, &binding.agent_type, context)
                                .await;
                        vec![
                            check("agentEval", result.status, result.detail),
                            check("evalLogs", result.log_status, result.log_detail),
                            check(
                                "evalTrace",
                                result.status,
                                format!(
                                    "runner=agent-behavior agent=agent://{} case={} status={}.",
                                    binding.agent_type, eval_case.id, result.status
                                ),
                            ),
                        ]
                    }
                }
            }
            Ok(binding) => vec![
                check(
                    "agentEval",
                    "blocked",
                    format!(
                        "Agent runtime binding agent://{} resolved but is disabled for runtime launch.",
                        binding.agent_type
                    ),
                ),
                check(
                    "evalLogs",
                    "blocked",
                    "Disabled agent runtime cannot produce representative eval evidence."
                        .to_string(),
                ),
                check(
                    "evalTrace",
                    "blocked",
                    format!(
                        "runner=agent-runtime-binding agent=agent://{} disabled.",
                        binding.agent_type
                    ),
                ),
            ],
            Err(error) => vec![
                check(
                    "agentEval",
                    "failed",
                    format!("Agent runtime binding check failed before eval execution: {error}"),
                ),
                check(
                    "evalLogs",
                    "failed",
                    "Agent runtime profile resolution failed before Agent Eval log collection."
                        .to_string(),
                ),
                check(
                    "evalTrace",
                    "failed",
                    format!("runner=agent-runtime-binding failed before trace capture: {error}"),
                ),
            ],
        };
    }

    vec![
        check(
            "agentEval",
            "blocked",
            format!(
                "Agent Eval supports bundle://agent-components/* JS runtime tool fixtures or agent://* runtime binding checks; current ref is {implementation_ref}."
            ),
        ),
        check(
            "evalLogs",
            "blocked",
            "No supported Agent Eval runner matched the implementationRef.".to_string(),
        ),
        check(
            "evalTrace",
            "blocked",
            "No supported Agent Eval runner matched the implementationRef for trace capture."
                .to_string(),
        ),
    ]
}

fn fixture_string(input: &Value, field: &str) -> Option<String> {
    input
        .get("fixture")
        .and_then(|fixture| optional_string(fixture, field))
}

fn fixture_implementation_ref(input: &Value) -> Option<String> {
    fixture_string(input, "implementationRef")
        .or_else(|| fixture_string(input, "implementation_ref"))
}

fn fixture_input(input: &Value) -> Value {
    input
        .get("fixture")
        .and_then(|fixture| fixture.get("input"))
        .cloned()
        .unwrap_or_else(|| json!({}))
}

fn fixture_eval_case(
    input: &Value,
    implementation_ref: &str,
    selected_action: Option<&str>,
) -> Result<ProductAppEvalCase, String> {
    let id = fixture_non_empty_string(input, &["caseId", "case_id", "id"])
        .unwrap_or_else(|| "fixture-agent-behavior".to_string());
    let title = fixture_non_empty_string(input, &["title"])
        .unwrap_or_else(|| "Fixture Agent Eval".to_string());
    let description = fixture_non_empty_string(input, &["description"]).unwrap_or_else(|| {
        "Run the representative fixture input through the bound agent runtime.".to_string()
    });
    Ok(ProductAppEvalCase {
        id,
        title,
        description,
        component_id: fixture_non_empty_string(input, &["componentId", "component_id"]),
        implementation_ref: Some(implementation_ref.to_string()),
        action: selected_action
            .and_then(non_empty_trimmed)
            .map(str::to_string)
            .or_else(|| fixture_non_empty_string(input, &["action"])),
        tool_name: fixture_non_empty_string(input, &["toolName", "tool_name"]),
        input: fixture_input(input),
        expectations: fixture_eval_expectations(input)?,
        evidence_kind: fixture_eval_evidence_kind(input)?,
        tags: Vec::new(),
        required: input
            .get("fixture")
            .and_then(|fixture| fixture.get("required"))
            .and_then(Value::as_bool)
            .unwrap_or(true),
    })
}

fn fixture_non_empty_string(input: &Value, fields: &[&str]) -> Option<String> {
    fields.iter().find_map(|field| {
        fixture_string(input, field).and_then(|value| non_empty_trimmed(&value).map(str::to_string))
    })
}

fn fixture_eval_expectations(input: &Value) -> Result<Vec<ProductAppEvalExpectation>, String> {
    let Some(expectations) = input
        .get("fixture")
        .and_then(|fixture| fixture.get("expectations"))
    else {
        return Ok(Vec::new());
    };
    serde_json::from_value(expectations.clone())
        .map_err(|error| format!("failed to parse fixture.expectations: {error}"))
}

fn fixture_eval_evidence_kind(input: &Value) -> Result<ProductAppEvalEvidenceKind, String> {
    match fixture_non_empty_string(input, &["evidenceKind", "evidence_kind"])
        .unwrap_or_else(|| "behavior".to_string())
        .as_str()
    {
        "behavior" => Ok(ProductAppEvalEvidenceKind::Behavior),
        "runtime-binding" => Ok(ProductAppEvalEvidenceKind::RuntimeBinding),
        "js-tool" => Ok(ProductAppEvalEvidenceKind::JsTool),
        other => Err(format!("unsupported fixture evidenceKind: {other}")),
    }
}

fn bridge_component_id_from_ref(implementation_ref: &str) -> Option<&str> {
    implementation_ref
        .strip_prefix("bundle://bridge-components/")
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.contains('/'))
}

fn agent_component_id_from_ref(implementation_ref: &str) -> Option<&str> {
    implementation_ref
        .strip_prefix("bundle://agent-components/")
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.contains('/'))
}

fn interactive_surface_runtime_id_from_ref(implementation_ref: &str) -> Option<&str> {
    implementation_ref
        .strip_prefix("runtime://")
        .map(str::trim)
        .filter(|value| *value == "interactive-surface")
}

fn agent_type_from_ref(implementation_ref: &str) -> Option<&str> {
    implementation_ref
        .strip_prefix("agent://")
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.contains('/'))
}

fn skill_id_from_ref(implementation_ref: &str) -> Option<&str> {
    implementation_ref
        .strip_prefix("skill://")
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.contains('/'))
}

#[derive(Debug, Clone)]
struct AgentRuntimeBindingEvidence {
    agent_type: String,
    agent_kind: String,
    enabled: bool,
    model: Option<String>,
    tool_count: usize,
    skill_count: usize,
    subagent_count: usize,
}

#[derive(Debug, Clone)]
struct SkillBindingEvidence {
    requested: String,
    key: String,
    name: String,
    level: String,
    source_slot: String,
    path: String,
    selected: bool,
}

#[derive(Debug, Clone)]
struct InteractiveSurfaceRuntimeEvidence {
    runtime_id: String,
    component_id: String,
    component_kind: String,
    action: String,
    runtime_instance_id: Option<String>,
}

async fn resolve_agent_runtime_binding(
    agent_type: &str,
    workspace_root: Option<&std::path::Path>,
) -> Result<AgentRuntimeBindingEvidence, String> {
    let profile = get_agent_registry()
        .get_agent_capability_profile(agent_type, workspace_root)
        .await
        .ok_or_else(|| format!("agent://{agent_type} does not resolve to a registered agent"))?;
    Ok(AgentRuntimeBindingEvidence {
        agent_type: profile.agent_id,
        agent_kind: profile.agent_kind,
        enabled: profile.enabled,
        model: profile.model,
        tool_count: profile.tools.effective.len(),
        skill_count: profile.skills.effective.len(),
        subagent_count: profile.subagents.effective.len(),
    })
}

async fn resolve_skill_binding(
    skill_id: &str,
    workspace_root: Option<&std::path::Path>,
    agent_type: Option<&str>,
) -> Result<SkillBindingEvidence, String> {
    let registry = get_skill_registry();
    let all_skills = registry.get_all_skills_for_workspace(workspace_root).await;
    let Some(skill) = all_skills.into_iter().find(|skill| {
        skill.key == skill_id || skill.dir_name == skill_id || skill.name == skill_id
    }) else {
        return Err(format!(
            "skill://{skill_id} does not resolve to an installed project or user skill"
        ));
    };
    let resolved_skills = registry
        .get_resolved_skills_for_workspace(workspace_root, agent_type)
        .await;
    let selected = resolved_skills
        .iter()
        .any(|resolved| resolved.key == skill.key);
    Ok(SkillBindingEvidence {
        requested: skill_id.to_string(),
        key: skill.key,
        name: skill.name,
        level: skill.level.as_str().to_string(),
        source_slot: skill.source_slot,
        path: skill.path,
        selected,
    })
}

fn resolve_interactive_surface_runtime_binding(
    runtime_id: &str,
    component: &ComponentDefinition,
    action: &str,
    runtime_instance_id: Option<&str>,
) -> Result<InteractiveSurfaceRuntimeEvidence, String> {
    if runtime_id != "interactive-surface" {
        return Err(format!(
            "runtime://{runtime_id} is not a registered App Studio runtime executor"
        ));
    }
    if component.kind != ComponentKind::Runtime {
        return Err(format!(
            "runtime://interactive-surface must be declared by a Runtime component, but {} is {}",
            component.id,
            component.kind.path_segment()
        ));
    }
    Ok(InteractiveSurfaceRuntimeEvidence {
        runtime_id: runtime_id.to_string(),
        component_id: component.id.clone(),
        component_kind: component.kind.path_segment().to_string(),
        action: action.to_string(),
        runtime_instance_id: runtime_instance_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
    })
}

fn agent_component_level_from_input(input: &Value) -> Option<AgentComponentLevel> {
    input
        .get("fixture")
        .and_then(|fixture| optional_string(fixture, "level"))
        .or_else(|| optional_string(input, "level"))
        .and_then(|value| match value.as_str() {
            "project" => Some(AgentComponentLevel::Project),
            "user" => Some(AgentComponentLevel::User),
            _ => None,
        })
}

fn agent_component_tool_candidates(
    explicit_tool_name: Option<&str>,
    selected_action: Option<&str>,
) -> Vec<String> {
    if let Some(tool_name) = explicit_tool_name.and_then(non_empty_trimmed) {
        return vec![tool_name.to_string()];
    }

    let Some(action) = selected_action.and_then(non_empty_trimmed) else {
        return Vec::new();
    };
    let mut candidates = vec![action.to_string()];
    let snake = action_to_tool_name(action);
    if snake != action {
        candidates.push(snake);
    }
    candidates
}

fn non_empty_trimmed(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn action_to_tool_name(action: &str) -> String {
    let mut out = String::new();
    let mut previous_was_separator = false;
    for ch in action.chars() {
        if ch.is_ascii_uppercase() {
            if !out.is_empty() && !previous_was_separator {
                out.push('_');
            }
            out.push(ch.to_ascii_lowercase());
            previous_was_separator = false;
        } else if matches!(ch, '-' | ' ' | '.') {
            if !out.is_empty() && !previous_was_separator {
                out.push('_');
                previous_was_separator = true;
            }
        } else {
            out.push(ch);
            previous_was_separator = ch == '_';
        }
    }
    out.trim_matches('_').to_string()
}

fn truncate_detail(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

async fn runtime_boundary_preview_checks(app_studio: &AppStudioExecutionContext) -> Vec<Value> {
    match &app_studio.subject {
        AppStudioSubject::ProductApp { .. } => {
            runtime_boundary_product_app_checks(app_studio).await
        }
        AppStudioSubject::Component { .. } => runtime_boundary_component_checks(app_studio).await,
        AppStudioSubject::StudioDraft { .. } => vec![
            check(
                "runtimeStorage",
                "notVerified",
                "Studio draft does not have an installed Product App runtime storage boundary to probe."
                    .to_string(),
            ),
            check(
                "dataSummary",
                "notVerified",
                "Create or bind a Product App package before recording runtime boundary evidence."
                    .to_string(),
            ),
        ],
    }
}

async fn runtime_boundary_product_app_checks(app_studio: &AppStudioExecutionContext) -> Vec<Value> {
    let package = match ProductAppResolver::read_product_app_package(&app_studio.package_root).await
    {
        Ok(package) => package,
        Err(error) => {
            return vec![
                check(
                    "package",
                    "failed",
                    format!(
                        "Failed to read bound Product App package at {}: {error}",
                        app_studio.package_root.display()
                    ),
                ),
                check(
                    "runtimeStorage",
                    "blocked",
                    "Runtime boundary evidence cannot continue without a readable Product App package."
                        .to_string(),
                ),
            ];
        }
    };

    let app = package.app;
    let permission_names = app_permission_names(&app.permissions);
    let data_boundary_declared = !app.work_object_kinds.is_empty();
    let runtime_instance = app_studio
        .runtime_instance_id
        .as_deref()
        .filter(|id| !id.trim().is_empty());

    vec![
        check(
            "package",
            "passed",
            format!("Read Product App package {}@{}.", app.id, app.version),
        ),
        check(
            "runtimeStorage",
            "notVerified",
            runtime_instance
                .map(|id| {
                    format!("Runtime instance {id} is bound, but storage scope probing must be recorded by the Product App Runtime host.")
                })
                .unwrap_or_else(|| {
                    "No runtime instance is bound; Product App Runtime host storage scope probing has not run."
                        .to_string()
                }),
        ),
        check(
            "permissions",
            if permission_names.is_empty() {
                "passed"
            } else {
                "warning"
            },
            if permission_names.is_empty() {
                "No elevated Product App permissions are declared in app.json.".to_string()
            } else {
                format!(
                    "Declared Product App permissions require runtime boundary and explicit review evidence: {}.",
                    permission_names.join(", ")
                )
            },
        ),
        check(
            "data",
            "notVerified",
            if data_boundary_declared {
                format!(
                    "{} work object kind(s) declare the app data boundary, but runtime storage scope probing has not produced Product App Runtime evidence.",
                    app.work_object_kinds.len()
                )
            } else {
                "No work object kind declares the app data boundary.".to_string()
            },
        ),
        check(
            "dataLifecycle",
            "notVerified",
            app.data_lifecycle
                .as_ref()
                .map(|policy| {
                    format!(
                        "Package declares data lifecycle retention={:?}, deletion={:?}, migration={:?}, share={:?}, but runtime retention and share-impact evidence has not been recorded.",
                        policy.retention, policy.deletion, policy.migration, policy.share
                    )
                })
                .unwrap_or_else(|| {
                    "No dataLifecycle policy declares retention, deletion, migration, and share behavior."
                        .to_string()
                }),
        ),
        check(
            "dataSummary",
            "notVerified",
            "Runtime retention, memory, and share-impact summary must be recorded by the Product App Runtime host after storage scope probing."
                .to_string(),
        ),
    ]
}

async fn runtime_boundary_component_checks(app_studio: &AppStudioExecutionContext) -> Vec<Value> {
    let package = match ProductAppResolver::read_component_package(&app_studio.package_root).await {
        Ok(package) => package,
        Err(error) => {
            return vec![check(
                "package",
                "failed",
                format!(
                    "Failed to read bound Component package at {}: {error}",
                    app_studio.package_root.display()
                ),
            )];
        }
    };
    let component = package.component;
    let permission_names = component
        .permissions
        .iter()
        .map(|permission| permission.kind.clone())
        .collect::<Vec<_>>();

    vec![
        check(
            "package",
            "passed",
            format!(
                "Read Component package {}/{}@{}.",
                component.kind.path_segment(),
                component.id,
                component.version.unwrap_or_else(|| "0.0.0".to_string())
            ),
        ),
        check(
            "permissions",
            if permission_names.is_empty() {
                "passed"
            } else {
                "warning"
            },
            if permission_names.is_empty() {
                "No Component package permissions are declared.".to_string()
            } else {
                format!(
                    "Declared Component permissions: {}.",
                    permission_names.join(", ")
                )
            },
        ),
        check(
            "data",
            "notVerified",
            "Component data boundary depends on the consuming Product App runtime context."
                .to_string(),
        ),
        check(
            "dataSummary",
            "notVerified",
            "Component runtime data summary must be recorded through a consuming Product App host."
                .to_string(),
        ),
    ]
}

async fn runtime_dependency_preview_checks(app_studio: &AppStudioExecutionContext) -> Vec<Value> {
    match &app_studio.subject {
        AppStudioSubject::ProductApp { .. } => {
            runtime_dependency_product_app_checks(app_studio).await
        }
        AppStudioSubject::Component { .. } => runtime_dependency_component_checks(app_studio).await,
        AppStudioSubject::StudioDraft { .. } => vec![check(
            "runtimeDependencies",
            "notVerified",
            "Studio draft does not have an installed package dependency graph to probe."
                .to_string(),
        )],
    }
}

async fn runtime_dependency_product_app_checks(
    app_studio: &AppStudioExecutionContext,
) -> Vec<Value> {
    let package = match ProductAppResolver::read_product_app_package(&app_studio.package_root).await
    {
        Ok(package) => package,
        Err(error) => {
            return vec![
                check(
                    "package",
                    "failed",
                    format!(
                        "Failed to read bound Product App package at {}: {error}",
                        app_studio.package_root.display()
                    ),
                ),
                check(
                    "runtimeDependencies",
                    "blocked",
                    "Runtime dependency evidence cannot continue without a readable Product App package."
                        .to_string(),
                ),
            ];
        }
    };

    let source_count = package.private_surface_sources.len();
    let npm_dependency_count = package
        .private_surface_sources
        .values()
        .map(|source| source.npm_dependencies.len())
        .sum::<usize>();
    let esm_dependency_count = package
        .private_surface_sources
        .values()
        .map(|source| source.esm_dependencies.len())
        .sum::<usize>();
    let dependency_count = npm_dependency_count + esm_dependency_count;
    vec![
        check(
            "package",
            "passed",
            format!(
                "Read Product App package {}@{}.",
                package.app.id, package.app.version
            ),
        ),
        check(
            "runtimeDependencies",
            "notVerified",
            if source_count == 0 {
                "No private Product App host surface source is packaged; dependency health must be observed by the installed runtime host."
                    .to_string()
            } else if dependency_count == 0 {
                format!(
                    "No npm worker dependencies or browser ESM dependencies are declared across {} private host surface source(s), but runtime dependency health still requires Product App Runtime host evidence for source loading, import-map resolution, and worker freshness.",
                    source_count
                )
            } else if npm_dependency_count == 0 {
                format!(
                    "{} browser ESM dependency(ies) are declared across {} private host surface source(s); import-map/CDN resolution must be recorded by the Product App Runtime host.",
                    esm_dependency_count, source_count
                )
            } else {
                format!(
                    "{} npm worker dependency(ies) and {} browser ESM dependency(ies) are declared across {} private host surface source(s); install state and worker freshness must be recorded by the Product App Runtime host.",
                    npm_dependency_count, esm_dependency_count, source_count
                )
            },
        ),
    ]
}

async fn runtime_dependency_component_checks(app_studio: &AppStudioExecutionContext) -> Vec<Value> {
    let package = match ProductAppResolver::read_component_package(&app_studio.package_root).await {
        Ok(package) => package,
        Err(error) => {
            return vec![check(
                "runtimeDependencies",
                "failed",
                format!(
                    "Failed to read bound Component package at {}: {error}",
                    app_studio.package_root.display()
                ),
            )];
        }
    };
    let component = package.component;
    let invalid_dependencies = component
        .dependencies
        .iter()
        .filter(|dependency| dependency.source != ComponentSource::Shared)
        .map(|dependency| {
            format!(
                "{}:{}",
                dependency.kind.path_segment(),
                dependency.component_id
            )
        })
        .collect::<Vec<_>>();

    vec![check(
        "runtimeDependencies",
        if invalid_dependencies.is_empty() {
            "notVerified"
        } else {
            "failed"
        },
        if invalid_dependencies.is_empty() {
            format!(
                "{} shared Component dependency reference(s) are declared; runtime dependency health still requires consuming Product App runtime evidence.",
                component.dependencies.len()
            )
        } else {
            format!(
                "Component package depends on app-private components: {}.",
                invalid_dependencies.join(", ")
            )
        },
    )]
}

async fn permission_review_preview_checks(app_studio: &AppStudioExecutionContext) -> Vec<Value> {
    match &app_studio.subject {
        AppStudioSubject::ProductApp { .. } => {
            permission_review_product_app_checks(app_studio).await
        }
        AppStudioSubject::Component { .. } => permission_review_component_checks(app_studio).await,
        AppStudioSubject::StudioDraft { .. } => vec![check(
            "permissionReview",
            "notVerified",
            "Studio draft does not have a package permission manifest to review.".to_string(),
        )],
    }
}

async fn permission_review_product_app_checks(
    app_studio: &AppStudioExecutionContext,
) -> Vec<Value> {
    let package = match ProductAppResolver::read_product_app_package(&app_studio.package_root).await
    {
        Ok(package) => package,
        Err(error) => {
            return vec![check(
                "permissionReview",
                "failed",
                format!(
                    "Failed to read bound Product App package at {}: {error}",
                    app_studio.package_root.display()
                ),
            )];
        }
    };
    let permission_names = app_permission_names(&package.app.permissions);

    vec![
        check(
            "permissions",
            if permission_names.is_empty() {
                "passed"
            } else {
                "warning"
            },
            if permission_names.is_empty() {
                "No elevated Product App permissions are declared in app.json.".to_string()
            } else {
                format!(
                    "Declared Product App permissions: {}.",
                    permission_names.join(", ")
                )
            },
        ),
        check(
            "permissionReview",
            "notVerified",
            if permission_names.is_empty() {
                "No elevated permissions are declared, but an explicit App Studio permission review has not been recorded."
                    .to_string()
            } else {
                "Elevated permissions require explicit review evidence recorded by the App Studio host after runtime permission summary is available."
                    .to_string()
            },
        ),
    ]
}

async fn permission_review_component_checks(app_studio: &AppStudioExecutionContext) -> Vec<Value> {
    let package = match ProductAppResolver::read_component_package(&app_studio.package_root).await {
        Ok(package) => package,
        Err(error) => {
            return vec![check(
                "permissionReview",
                "failed",
                format!(
                    "Failed to read bound Component package at {}: {error}",
                    app_studio.package_root.display()
                ),
            )];
        }
    };
    let permission_names = package
        .component
        .permissions
        .iter()
        .map(|permission| permission.kind.clone())
        .collect::<Vec<_>>();

    vec![
        check(
            "permissions",
            if permission_names.is_empty() {
                "passed"
            } else {
                "warning"
            },
            if permission_names.is_empty() {
                "No Component package permissions are declared.".to_string()
            } else {
                format!(
                    "Declared Component permissions: {}.",
                    permission_names.join(", ")
                )
            },
        ),
        check(
            "permissionReview",
            "notVerified",
            if permission_names.is_empty() {
                "No Component permissions are declared, but explicit consumer permission review evidence has not been recorded.".to_string()
            } else {
                "Component permissions require explicit review evidence through a consuming Product App."
                    .to_string()
            },
        ),
    ]
}

async fn user_path_rehearsal_preview_checks(app_studio: &AppStudioExecutionContext) -> Vec<Value> {
    match &app_studio.subject {
        AppStudioSubject::ProductApp { .. } => user_path_product_app_checks(app_studio).await,
        AppStudioSubject::Component { .. } => vec![
            check(
                "criticalPath",
                "notVerified",
                "Component subject does not define a Product App new-user critical path."
                    .to_string(),
            ),
            check(
                "userPath",
                "notVerified",
                "Run capability or Agent Eval harnesses for Component subjects; user-path rehearsal is Product App host evidence."
                    .to_string(),
            ),
        ],
        AppStudioSubject::StudioDraft { .. } => vec![
            check(
                "criticalPath",
                "notVerified",
                "Studio draft does not have an installed Product App critical path to rehearse."
                    .to_string(),
            ),
            check(
                "userPath",
                "notVerified",
                "Create or bind a Product App package before recording user-path rehearsal evidence."
                    .to_string(),
            ),
        ],
    }
}

async fn user_path_product_app_checks(app_studio: &AppStudioExecutionContext) -> Vec<Value> {
    let package = match ProductAppResolver::read_product_app_package(&app_studio.package_root).await
    {
        Ok(package) => package,
        Err(error) => {
            return vec![
                check(
                    "criticalPath",
                    "failed",
                    format!(
                        "Failed to read bound Product App package at {}: {error}",
                        app_studio.package_root.display()
                    ),
                ),
                check(
                    "userPath",
                    "blocked",
                    "User-path rehearsal cannot continue without a readable Product App package."
                        .to_string(),
                ),
            ];
        }
    };
    let scenario_count = package
        .rehearsal_plan
        .as_ref()
        .map(|plan| plan.scenarios.len())
        .unwrap_or(0);
    let step_count = package
        .rehearsal_plan
        .as_ref()
        .map(|plan| {
            plan.scenarios
                .iter()
                .map(|scenario| scenario.steps.len())
                .sum::<usize>()
        })
        .unwrap_or(0);
    let detail = if scenario_count > 0 && step_count > 0 {
        format!(
            "{} rehearsal scenario(s), {} step(s) are declared; iframe click/input execution must be recorded by the Product App Runtime host.",
            scenario_count, step_count
        )
    } else {
        "No machine-readable user-path rehearsal scenario is declared in tests/rehearsal.json."
            .to_string()
    };

    vec![
        check("criticalPath", "notVerified", detail.clone()),
        check("userPath", "notVerified", detail),
    ]
}

async fn release_rehearsal_preview_checks(
    app_studio: &AppStudioExecutionContext,
    context: &ToolUseContext,
) -> Vec<Value> {
    match &app_studio.subject {
        AppStudioSubject::ProductApp { .. } => {
            release_rehearsal_product_app_checks(app_studio).await
        }
        AppStudioSubject::Component { .. } => {
            release_rehearsal_component_checks(app_studio, context).await
        }
        AppStudioSubject::StudioDraft { .. } => vec![
            check(
                "criticalPath",
                "notVerified",
                "Studio draft does not have an installed Product App or Component package to rehearse."
                    .to_string(),
            ),
            check(
                "releaseGate",
                "notVerified",
                "Create or bind a package before running release rehearsal.".to_string(),
            ),
        ],
    }
}

async fn release_rehearsal_product_app_checks(
    app_studio: &AppStudioExecutionContext,
) -> Vec<Value> {
    let package = match ProductAppResolver::read_product_app_package(&app_studio.package_root).await
    {
        Ok(package) => package,
        Err(error) => {
            return vec![
                check(
                    "package",
                    "failed",
                    format!(
                        "Failed to read bound Product App package at {}: {error}",
                        app_studio.package_root.display()
                    ),
                ),
                check(
                    "releaseGate",
                    "blocked",
                    "Release rehearsal cannot continue without a readable Product App package."
                        .to_string(),
                ),
            ];
        }
    };

    let app = package.app;
    let primary_surface_id = app
        .primary_surface
        .as_ref()
        .map(|surface| surface.component_id.as_str());
    let private_surface_exists = primary_surface_id.is_some_and(|primary_surface_id| {
        package.private_components.iter().any(|component| {
            component.kind == ComponentKind::Surface && component.id == primary_surface_id
        })
    });
    let expected_launch_kind = if primary_surface_id.is_some() {
        ProductAppLaunchKind::ApplicationSurface
    } else {
        ProductAppLaunchKind::AgentSession
    };
    let launch_matches = app.launch.as_ref().is_some_and(|launch| {
        launch.kind == expected_launch_kind
            && if expected_launch_kind == ProductAppLaunchKind::ApplicationSurface {
                launch.target_id == app.id
            } else {
                !launch.target_id.trim().is_empty()
            }
    });
    let permission_names = app_permission_names(&app.permissions);
    let agent_component_count = app
        .components
        .iter()
        .filter(|component| component.kind == ComponentKind::Agent)
        .count()
        + package
            .private_components
            .iter()
            .filter(|component| component.kind == ComponentKind::Agent)
            .count();
    let agent_entry_exists = agent_component_count > 0 || app.permissions.ai;
    let critical_entry_exists = if expected_launch_kind == ProductAppLaunchKind::ApplicationSurface
    {
        private_surface_exists
    } else {
        agent_entry_exists
    };
    let data_boundary_declared = !app.work_object_kinds.is_empty();
    let rehearsal_scenario_count = package
        .rehearsal_plan
        .as_ref()
        .map(|plan| plan.scenarios.len())
        .unwrap_or(0);
    let rehearsal_step_count = package
        .rehearsal_plan
        .as_ref()
        .map(|plan| {
            plan.scenarios
                .iter()
                .map(|scenario| scenario.steps.len())
                .sum::<usize>()
        })
        .unwrap_or(0);
    let eval_case_count = package
        .eval_plan
        .as_ref()
        .map(|plan| plan.cases.len())
        .unwrap_or(0);
    let data_lifecycle = app.data_lifecycle.as_ref();

    vec![
        check(
            "package",
            "passed",
            format!("Read Product App package {}@{}.", app.id, app.version),
        ),
        check(
            "criticalPath",
            if critical_entry_exists && launch_matches {
                "notVerified"
            } else {
                "failed"
            },
            if critical_entry_exists && launch_matches {
                if let Some(primary_surface_id) = primary_surface_id {
                    format!(
                        "Primary surface {} and launch policy are declared; no new-user critical path runner has executed yet.",
                        primary_surface_id
                    )
                } else {
                    "Agent entry and launch policy are declared; no new-user critical path runner has executed yet."
                        .to_string()
                }
            } else {
                format!(
                    "Surface entry exists={}, agent entry exists={}, launch policy matches={}.",
                    private_surface_exists, agent_entry_exists, launch_matches
                )
            },
        ),
        check(
            "permissions",
            if permission_names.is_empty() {
                "passed"
            } else {
                "warning"
            },
            if permission_names.is_empty() {
                "No elevated Product App permissions are declared.".to_string()
            } else {
                format!("Declared Product App permissions: {}.", permission_names.join(", "))
            },
        ),
        check(
            "permissionReview",
            "notVerified",
            if permission_names.is_empty() {
                "No elevated Product App permissions are declared, but explicit release permission review evidence has not been recorded."
                    .to_string()
            } else {
                "Declared Product App permissions require explicit App Studio review evidence before release."
                    .to_string()
            },
        ),
        check(
            "data",
            "notVerified",
            if data_boundary_declared {
                format!(
                    "{} work object kind(s) declare the app data boundary, but runtime storage scope probing has not produced Product App Runtime evidence.",
                    app.work_object_kinds.len()
                )
            } else {
                "No work object kind declares the app data boundary.".to_string()
            },
        ),
        check(
            "dataSummary",
            "notVerified",
            if data_boundary_declared {
                "Package declares a data boundary, but runtime retention, memory, and share-impact summary still requires Product App Runtime evidence.".to_string()
            } else {
                "No data summary can be generated until the app declares a work object data boundary.".to_string()
            },
        ),
        check(
            "dataLifecycle",
            "notVerified",
            if let Some(policy) = data_lifecycle {
                format!(
                    "Package declares data lifecycle retention={:?}, deletion={:?}, migration={:?}, share={:?}, but runtime retention and share-impact evidence has not been recorded.",
                    policy.retention, policy.deletion, policy.migration, policy.share
                )
            } else {
                "No dataLifecycle policy declares retention, deletion, migration, and share behavior.".to_string()
            },
        ),
        check(
            "runtimeDependencies",
            "notVerified",
            "Runtime dependency health requires Product App Runtime evidence for Node availability, dependency install state, and worker restart freshness.".to_string(),
        ),
        check(
            "agentEval",
            if agent_component_count == 0 && !app.permissions.ai {
                "passed"
            } else {
                "notVerified"
            },
            if agent_component_count == 0 && !app.permissions.ai {
                "No Agent Component or AI permission is declared; Agent Eval is not required for this Product App.".to_string()
            } else if eval_case_count > 0 {
                format!(
                    "{} agent component reference(s) or AI permission require representative eval evidence. tests/eval.json declares {} eval case(s); run the agent-eval harness with execute=true to record executable evidence.",
                    agent_component_count,
                    eval_case_count
                )
            } else {
                format!(
                    "{} agent component reference(s) or AI permission require representative eval evidence; no machine-readable eval case is declared in tests/eval.json.",
                    agent_component_count
                )
            },
        ),
        check(
            "userPath",
            "notVerified",
            if rehearsal_scenario_count > 0 && rehearsal_step_count > 0 {
                format!(
                    "{} rehearsal scenario(s), {} step(s) are declared; no click/input user-path runner has executed yet.",
                    rehearsal_scenario_count, rehearsal_step_count
                )
            } else {
                "No machine-readable user-path rehearsal scenario is declared in tests/rehearsal.json.".to_string()
            },
        ),
        check(
            "releaseGate",
            "notVerified",
            "Release still requires package validation releaseGate, preview observation, runtime issue, data/permission, user-path, and eval facts when required."
                .to_string(),
        ),
    ]
}

async fn release_rehearsal_component_checks(
    app_studio: &AppStudioExecutionContext,
    context: &ToolUseContext,
) -> Vec<Value> {
    let package = match ProductAppResolver::read_component_package(&app_studio.package_root).await {
        Ok(package) => package,
        Err(error) => {
            return vec![
                check(
                    "package",
                    "failed",
                    format!(
                        "Failed to read bound Component package at {}: {error}",
                        app_studio.package_root.display()
                    ),
                ),
                check(
                    "releaseGate",
                    "blocked",
                    "Release rehearsal cannot continue without a readable Component package."
                        .to_string(),
                ),
            ];
        }
    };

    let component = package.component;
    let contract_path = app_studio.package_root.join("tests").join("contract.md");
    let contract_text = fs::read_to_string(&contract_path).await.unwrap_or_default();
    let permission_names = component
        .permissions
        .iter()
        .map(|permission| permission.kind.clone())
        .collect::<Vec<_>>();
    let capability_action_count = component
        .capabilities
        .iter()
        .map(|capability| capability.actions.len())
        .sum::<usize>();
    let invalid_dependencies = component
        .dependencies
        .iter()
        .filter(|dependency| dependency.source != ComponentSource::Shared)
        .map(|dependency| {
            format!(
                "{}:{}",
                dependency.kind.path_segment(),
                dependency.component_id
            )
        })
        .collect::<Vec<_>>();

    let mut checks = vec![
        check(
            "package",
            "passed",
            format!(
                "Read Component package {}/{}@{}.",
                component.kind.path_segment(),
                component.id,
                component.version.unwrap_or_else(|| "0.0.0".to_string())
            ),
        ),
        check(
            "componentContract",
            if contract_text.trim().is_empty() {
                "failed"
            } else {
                "passed"
            },
            if contract_text.trim().is_empty() {
                format!("Contract file is missing or empty: {}", contract_path.display())
            } else {
                format!("Contract file is present: {}", contract_path.display())
            },
        ),
        check(
            "capabilities",
            if component.capabilities.is_empty() {
                "warning"
            } else {
                "passed"
            },
            if component.capabilities.is_empty() {
                "No capabilities are declared in component.json.".to_string()
            } else {
                format!("{} capabilities declared.", component.capabilities.len())
            },
        ),
        check(
            "dependencies",
            if invalid_dependencies.is_empty() {
                "passed"
            } else {
                "failed"
            },
            if invalid_dependencies.is_empty() {
                format!(
                    "{} shared dependencies are declared.",
                    component.dependencies.len()
                )
            } else {
                format!(
                    "Component package depends on app-private components: {}.",
                    invalid_dependencies.join(", ")
                )
            },
        ),
        check(
            "implementation",
            if component.implementation_ref.is_some() {
                "passed"
            } else {
                "blocked"
            },
            component.implementation_ref.clone().unwrap_or_else(|| {
                "No implementationRef is declared for this Component package.".to_string()
            }),
        ),
        check(
            "consumerCompatibility",
            "notVerified",
            if component.used_by_apps.is_empty() {
                "No Product App consumer lock has validated this component yet.".to_string()
            } else {
                format!(
                    "Component manifest lists Product App consumer(s): {}; consumer compatibility still requires a consuming Product App runtime evidence run.",
                    component.used_by_apps.join(", ")
                )
            },
        ),
        check(
            "permissions",
            if permission_names.is_empty() {
                "passed"
            } else {
                "warning"
            },
            if permission_names.is_empty() {
                "No Component package permissions are declared.".to_string()
            } else {
                format!("Declared Component permissions: {}.", permission_names.join(", "))
            },
        ),
        check(
            "permissionReview",
            "notVerified",
            if permission_names.is_empty() {
                "No Component package permissions are declared, but explicit consumer permission review evidence has not been recorded.".to_string()
            } else {
                "Declared Component permissions require explicit review through a consuming Product App before release."
                    .to_string()
            },
        ),
        check(
            "data",
            "notVerified",
            "Component package permissions and consumer contracts declare intent only; data boundary readiness requires consuming Product App runtime evidence."
                .to_string(),
        ),
        check(
            "dataLifecycle",
            "notVerified",
            "Component data lifecycle readiness requires consuming Product App runtime write/read/delete and share-impact evidence."
                .to_string(),
        ),
        check(
            "dataSummary",
            "notVerified",
            "Component package data summary requires a consumer Product App runtime and share boundary evidence."
                .to_string(),
        ),
        check(
            "runtimeStorage",
            "notVerified",
            "Component runtime storage readiness requires a consuming Product App runtime storage scope probe."
                .to_string(),
        ),
        check(
            "runtimeDependencies",
            "notVerified",
            "Component runtime dependency health requires a consumer Product App runtime evidence run."
                .to_string(),
        ),
        check(
            "agentEval",
            "notVerified",
            if component.kind == ComponentKind::Agent || capability_action_count > 0 {
                format!(
                    "{} declared capability action(s) require representative eval or action evidence.",
                    capability_action_count
                )
            } else {
                "Release rehearsal found no executable capability action that requires eval, but Agent Eval readiness must be recorded by the independent agent-eval harness.".to_string()
            },
        ),
        check(
            "releaseGate",
            "notVerified",
            "Component release still requires consumer compatibility, preview/runtime, permission/data, and eval evidence."
                .to_string(),
        ),
    ];
    overlay_component_work_graph_release_evidence(&mut checks, app_studio, context).await;
    checks
}

async fn overlay_component_work_graph_release_evidence(
    checks: &mut Vec<Value>,
    app_studio: &AppStudioExecutionContext,
    context: &ToolUseContext,
) {
    let AppStudioSubject::Component { component_id, .. } = &app_studio.subject else {
        return;
    };
    let Some(record) = load_bound_work_record(app_studio, context).await else {
        return;
    };

    for id in [
        "componentContract",
        "capabilities",
        "dependencies",
        "implementation",
        "consumerCompatibility",
        "permissions",
        "permissionReview",
        "data",
        "dataLifecycle",
        "dataSummary",
        "runtimeStorage",
        "runtimeDependencies",
        "agentEval",
    ] {
        if let Some(check) = latest_component_release_evidence_check(&record, id, component_id) {
            replace_check(checks, work_studio_fact_check_to_json(&check));
        }
    }
}

async fn load_bound_work_record(
    app_studio: &AppStudioExecutionContext,
    context: &ToolUseContext,
) -> Option<WorkRecord> {
    let work_id = WorkId::parse(app_studio.work_id.as_deref()?.to_string()).ok()?;
    let service = work_service_from_tool_context(context).ok()?;
    service.get(&work_id).await.ok()
}

fn latest_component_release_evidence_check(
    record: &WorkRecord,
    id: &str,
    component_id: &str,
) -> Option<WorkStudioFactCheck> {
    let preview_check = latest_component_preview_evidence_check(record, id, component_id);
    let validation_check = latest_component_validation_evidence_check(record, id, component_id);

    if component_runtime_evidence_check(id) {
        return preview_check.or_else(|| {
            validation_check
                .filter(|check| validation_runtime_check_is_strong_evidence(check.status))
        });
    }

    validation_check.or(preview_check)
}

fn latest_component_preview_evidence_check(
    record: &WorkRecord,
    id: &str,
    component_id: &str,
) -> Option<WorkStudioFactCheck> {
    record
        .studio_preview_results
        .iter()
        .filter(|preview| preview.kind != WorkStudioPreviewKind::ReleaseRehearsal)
        .filter(|preview| component_preview_source_is_strong_evidence(id, preview.source))
        .filter(|preview| preview_relevant_to_component(preview, component_id))
        .filter_map(|preview| {
            preview
                .checks
                .iter()
                .find(|check| check.id == id)
                .map(|check| (preview.observed_at, check.clone()))
        })
        .max_by_key(|(observed_at, _)| *observed_at)
        .map(|(_, check)| check)
}

fn latest_component_validation_evidence_check(
    record: &WorkRecord,
    id: &str,
    component_id: &str,
) -> Option<WorkStudioFactCheck> {
    record
        .studio_validation_results
        .iter()
        .filter(|validation| {
            validation
                .component_id
                .as_deref()
                .map_or(true, |validation_component_id| {
                    validation_component_id == component_id
                })
        })
        .filter_map(|validation| {
            validation
                .checks
                .iter()
                .find(|check| check.id == id)
                .map(|check| (validation.observed_at, check.clone()))
        })
        .max_by_key(|(observed_at, _)| *observed_at)
        .map(|(_, check)| check)
}

fn component_runtime_evidence_check(id: &str) -> bool {
    matches!(
        id,
        "consumerCompatibility"
            | "permissionReview"
            | "data"
            | "dataLifecycle"
            | "dataSummary"
            | "runtimeStorage"
            | "runtimeDependencies"
            | "agentEval"
    )
}

fn component_preview_source_is_strong_evidence(id: &str, source: WorkStudioPreviewSource) -> bool {
    if !component_runtime_evidence_check(id) {
        return true;
    }

    if id == "agentEval" {
        return matches!(
            source,
            WorkStudioPreviewSource::PreviewHarness
                | WorkStudioPreviewSource::RuntimeObservation
                | WorkStudioPreviewSource::FixRerun
        );
    }

    source == WorkStudioPreviewSource::RuntimeObservation
}

fn validation_runtime_check_is_strong_evidence(status: WorkStudioFactStatus) -> bool {
    matches!(
        status,
        WorkStudioFactStatus::Failed | WorkStudioFactStatus::Blocked
    )
}

fn preview_relevant_to_component(
    preview: &crate::agentic_os::work::WorkStudioPreviewResult,
    component_id: &str,
) -> bool {
    if preview.component_id.as_deref() == Some(component_id) {
        return true;
    }
    if preview.component_id.is_some() {
        return false;
    }

    let has_component_identity =
        preview.product_app_surface_id.is_some() || preview.surface_id.is_some();
    let component_identity_matches = preview.product_app_surface_id.as_deref()
        == Some(component_id)
        || preview.surface_id.as_deref() == Some(component_id);

    !has_component_identity || component_identity_matches
}

fn work_studio_fact_check_to_json(check: &WorkStudioFactCheck) -> Value {
    json!({
        "id": check.id.clone(),
        "status": preview_status_string(check.status),
        "detail": check.detail.clone(),
    })
}

fn replace_check(checks: &mut Vec<Value>, replacement: Value) {
    let Some(id) = replacement.get("id").and_then(Value::as_str) else {
        return;
    };
    if let Some(existing) = checks
        .iter_mut()
        .find(|check| check.get("id").and_then(Value::as_str) == Some(id))
    {
        *existing = replacement;
    } else {
        checks.push(replacement);
    }
}

fn app_permission_names(
    permissions: &crate::app_platform::AppPermissionSummary,
) -> Vec<&'static str> {
    [
        ("fs", permissions.fs),
        ("net", permissions.net),
        ("shell", permissions.shell),
        ("gui", permissions.gui),
        ("secrets", permissions.secrets),
        ("ai", permissions.ai),
    ]
    .into_iter()
    .filter_map(|(name, enabled)| enabled.then_some(name))
    .collect()
}

async fn resolve_harness_mode(
    requested_mode: &str,
    app_studio: &AppStudioExecutionContext,
) -> String {
    let requested_mode = requested_mode.trim();
    if !requested_mode.is_empty() && requested_mode != "auto" {
        return normalize_requested_mode(requested_mode).to_string();
    }

    match &app_studio.subject {
        AppStudioSubject::ProductApp { .. } => {
            match ProductAppResolver::read_product_app_package(&app_studio.package_root).await {
                Ok(package) => {
                    if package
                        .app
                        .launch
                        .as_ref()
                        .is_some_and(|launch| launch.kind == ProductAppLaunchKind::AgentSession)
                    {
                        "agent-chat".to_string()
                    } else {
                        match package
                            .app
                            .primary_surface_mode
                            .unwrap_or(AppSurfaceMode::ImmersivePrimary)
                        {
                            AppSurfaceMode::ChatPrimary => "agent-chat",
                            AppSurfaceMode::SidecarLinked => "sidecar",
                            AppSurfaceMode::ImmersivePrimary => "full-app",
                            AppSurfaceMode::EmbeddedObject => "embedded",
                        }
                        .to_string()
                    }
                }
                Err(_) => "product-app-preview".to_string(),
            }
        }
        AppStudioSubject::Component { component_kind, .. } => {
            if component_kind == "agent" {
                "agent-chat".to_string()
            } else {
                "capability".to_string()
            }
        }
        AppStudioSubject::StudioDraft { .. } => "product-app-preview".to_string(),
    }
}

fn normalize_requested_mode(mode: &str) -> &str {
    match mode {
        "sidecar-ui" => "sidecar",
        "full-ui" => "full-app",
        "embedded-object" => "embedded",
        "agent_eval" => "agent-eval",
        _ => mode,
    }
}

fn mode_to_preview_kind(mode: &str) -> &'static str {
    match mode {
        "agent-chat" => "agent-chat",
        "sidecar" => "sidecar",
        "full-app" => "full-app",
        "embedded" => "embedded",
        "capability" => "capability",
        "agent-eval" => "agent-eval",
        "runtime-boundary" => "runtime-boundary",
        "runtime-dependencies" => "runtime-dependencies",
        "permission-review" => "permission-review",
        "user-path-rehearsal" => "user-path-rehearsal",
        "release-rehearsal" => "release-rehearsal",
        _ => "product-app-preview",
    }
}

fn mode_to_work_preview_kind(mode: &str) -> WorkStudioPreviewKind {
    match mode {
        "agent-chat" => WorkStudioPreviewKind::AgentChat,
        "sidecar" => WorkStudioPreviewKind::Sidecar,
        "full-app" => WorkStudioPreviewKind::FullApp,
        "embedded" => WorkStudioPreviewKind::Embedded,
        "capability" => WorkStudioPreviewKind::Capability,
        "agent-eval" => WorkStudioPreviewKind::AgentEval,
        "runtime-boundary" => WorkStudioPreviewKind::RuntimeBoundary,
        "runtime-dependencies" => WorkStudioPreviewKind::RuntimeDependencies,
        "permission-review" => WorkStudioPreviewKind::PermissionReview,
        "user-path-rehearsal" => WorkStudioPreviewKind::UserPathRehearsal,
        "release-rehearsal" => WorkStudioPreviewKind::ReleaseRehearsal,
        _ => WorkStudioPreviewKind::ProductAppPreview,
    }
}

struct WorkPreviewEvidence {
    checks: Vec<Value>,
    found: bool,
}

async fn work_preview_observation_checks(
    app_studio: &AppStudioExecutionContext,
    context: &ToolUseContext,
    mode: &str,
    evidence_label: &str,
) -> WorkPreviewEvidence {
    let mut checks = Vec::new();
    let runtime_instance_id = app_studio.runtime_instance_id.as_deref();
    let runtime_identity_required = mode != "permission-review";

    let Some(work_id_text) = app_studio.work_id.as_deref() else {
        checks.push(runtime_identity_check(
            runtime_instance_id,
            None,
            runtime_identity_required,
        ));
        checks.push(check(
            "workIdentity",
            "notVerified",
            format!(
                "No Work id is bound to this App Studio turn; {evidence_label} cannot be read from the Work graph."
            ),
        ));
        checks.push(check(
            "previewObservation",
            "notVerified",
            format!(
                "Concrete {evidence_label} belongs to the App Studio Workbench or Product App Runtime host; no bound Work graph was available for this tool to read the latest observation."
            ),
        ));
        return WorkPreviewEvidence {
            checks,
            found: false,
        };
    };
    checks.push(check(
        "workIdentity",
        "passed",
        format!("Workbench preview evidence will be read from Work {work_id_text}."),
    ));

    let work_id = match WorkId::parse(work_id_text.to_string()) {
        Ok(work_id) => work_id,
        Err(error) => {
            checks.push(runtime_identity_check(
                runtime_instance_id,
                None,
                runtime_identity_required,
            ));
            checks.push(check(
                "previewObservation",
                "notVerified",
                format!("Bound App Studio Work id is invalid: {error}."),
            ));
            return WorkPreviewEvidence {
                checks,
                found: false,
            };
        }
    };
    let service = match work_service_from_tool_context(context) {
        Ok(service) => service,
        Err(error) => {
            checks.push(runtime_identity_check(
                runtime_instance_id,
                None,
                runtime_identity_required,
            ));
            checks.push(check(
                "previewObservation",
                "notVerified",
                format!("Unable to open Work graph for preview evidence: {error}."),
            ));
            return WorkPreviewEvidence {
                checks,
                found: false,
            };
        }
    };
    let record = match service.get(&work_id).await {
        Ok(record) => record,
        Err(error) => {
            checks.push(runtime_identity_check(
                runtime_instance_id,
                None,
                runtime_identity_required,
            ));
            checks.push(check(
                "previewObservation",
                "notVerified",
                format!("Unable to read Work {work_id}: {error}."),
            ));
            return WorkPreviewEvidence {
                checks,
                found: false,
            };
        }
    };
    let expected_kind = mode_to_work_preview_kind(mode);
    let expected_product_app_id = match &app_studio.subject {
        AppStudioSubject::ProductApp { app_id, .. } => Some(app_id.as_str()),
        _ => None,
    };
    let latest = record
        .studio_preview_results
        .iter()
        .filter(|preview| preview.kind == expected_kind)
        .filter(|preview| is_external_preview_observation(preview.source))
        .filter(|preview| {
            expected_product_app_id.map_or(true, |app_id| {
                preview
                    .product_app_id
                    .as_deref()
                    .map_or(true, |preview_app_id| preview_app_id == app_id)
            })
        })
        .filter(|preview| {
            runtime_instance_id.map_or(true, |runtime_id| {
                preview
                    .runtime_instance_id
                    .as_deref()
                    .map_or(true, |preview_runtime_id| preview_runtime_id == runtime_id)
            })
        })
        .max_by_key(|preview| preview.observed_at);

    let Some(preview) = latest else {
        checks.push(runtime_identity_check(
            runtime_instance_id,
            None,
            runtime_identity_required,
        ));
        checks.push(check(
            "previewObservation",
            "notVerified",
            format!(
                "No external Workbench/runtime observation with kind {} is recorded on Work {} for {}.",
                mode_to_preview_kind(mode),
                work_id,
                evidence_label
            ),
        ));
        return WorkPreviewEvidence {
            checks,
            found: false,
        };
    };
    checks.push(runtime_identity_check(
        runtime_instance_id,
        preview.runtime_instance_id.as_deref(),
        runtime_identity_required,
    ));
    checks.push(check(
        "previewObservation",
        preview_status_for_check(preview.status),
        format!(
            "Workbench observation {} for {} recorded status {} at {}. {}",
            preview.id,
            evidence_label,
            preview_status_string(preview.status),
            preview.observed_at,
            preview.detail.as_deref().unwrap_or("No detail provided.")
        ),
    ));
    if preview.checks.is_empty() {
        checks.push(check(
            "workbenchObservationChecks",
            "notVerified",
            "Workbench observation did not include detailed checks.".to_string(),
        ));
    } else {
        checks.extend(preview.checks.iter().map(work_preview_check_to_json));
    }
    WorkPreviewEvidence {
        checks,
        found: true,
    }
}

fn is_external_preview_observation(source: WorkStudioPreviewSource) -> bool {
    matches!(
        source,
        WorkStudioPreviewSource::RuntimeFact
            | WorkStudioPreviewSource::RuntimeObservation
            | WorkStudioPreviewSource::FixRerun
    )
}

fn runtime_identity_check(
    bound_runtime_instance_id: Option<&str>,
    observed_runtime_instance_id: Option<&str>,
    required: bool,
) -> Value {
    let runtime_instance_id = bound_runtime_instance_id.or(observed_runtime_instance_id);
    check(
        "runtimeIdentity",
        if runtime_instance_id.is_some() || !required {
            "passed"
        } else {
            "notVerified"
        },
        if let Some(id) = bound_runtime_instance_id {
            format!("Runtime instance {id} is bound to this App Studio turn.")
        } else if let Some(id) = observed_runtime_instance_id {
            format!("Runtime instance {id} is recorded by the Workbench observation.")
        } else if required {
            "No runtime instance is bound to this App Studio turn or recorded by the Workbench observation."
                .to_string()
        } else {
            "This Workbench observation kind does not require a bound runtime instance.".to_string()
        },
    )
}

fn work_preview_check_to_json(check: &crate::agentic_os::work::WorkStudioFactCheck) -> Value {
    json!({
        "id": check.id.clone(),
        "status": preview_status_string(check.status),
        "detail": check.detail.clone(),
    })
}

fn preview_status_for_check(status: WorkStudioFactStatus) -> &'static str {
    match status {
        WorkStudioFactStatus::Passed => "passed",
        WorkStudioFactStatus::Warning => "warning",
        WorkStudioFactStatus::Failed => "failed",
        WorkStudioFactStatus::Blocked => "blocked",
        WorkStudioFactStatus::Running | WorkStudioFactStatus::Waiting => "running",
        WorkStudioFactStatus::NotRun => "notRun",
        WorkStudioFactStatus::NotVerified | WorkStudioFactStatus::Ready => "notVerified",
    }
}

fn preview_status_string(status: WorkStudioFactStatus) -> &'static str {
    match status {
        WorkStudioFactStatus::Passed => "passed",
        WorkStudioFactStatus::Warning => "warning",
        WorkStudioFactStatus::Failed => "failed",
        WorkStudioFactStatus::NotRun => "notRun",
        WorkStudioFactStatus::NotVerified => "notVerified",
        WorkStudioFactStatus::Blocked => "blocked",
        WorkStudioFactStatus::Running => "running",
        WorkStudioFactStatus::Ready => "ready",
        WorkStudioFactStatus::Waiting => "waiting",
    }
}

fn aggregate_status(checks: &[Value]) -> &'static str {
    if checks.iter().any(|check| {
        matches!(
            check.get("status").and_then(Value::as_str),
            Some("failed" | "blocked")
        )
    }) {
        "failed"
    } else if checks.iter().any(|check| {
        matches!(
            check.get("status").and_then(Value::as_str),
            Some("running" | "waiting")
        )
    }) {
        "running"
    } else if checks.iter().any(|check| {
        matches!(
            check.get("status").and_then(Value::as_str),
            Some("notRun" | "notVerified")
        )
    }) {
        "notVerified"
    } else if checks
        .iter()
        .any(|check| check.get("status").and_then(Value::as_str) == Some("warning"))
    {
        "warning"
    } else {
        "passed"
    }
}

fn target_summary(app_studio: &AppStudioExecutionContext) -> String {
    match &app_studio.subject {
        AppStudioSubject::ProductApp {
            app_id, version, ..
        } => format!("product-app:{app_id}@{version}"),
        AppStudioSubject::Component {
            component_id,
            component_kind,
            version,
            ..
        } => format!("component:{component_kind}/{component_id}@{version}"),
        AppStudioSubject::StudioDraft { draft_id, .. } => format!("studio-draft:{draft_id}"),
    }
}

fn subject_identity(
    app_studio: &AppStudioExecutionContext,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    match &app_studio.subject {
        AppStudioSubject::ProductApp {
            app_id, version, ..
        } => (Some(app_id.clone()), None, None, Some(version.clone())),
        AppStudioSubject::Component {
            component_id,
            component_kind,
            version,
            ..
        } => (
            None,
            Some(component_id.clone()),
            Some(component_kind.clone()),
            Some(version.clone()),
        ),
        AppStudioSubject::StudioDraft { .. } => (None, None, None, None),
    }
}

fn preview_result_id(mode: &str, target: &str) -> String {
    format!("preview:{mode}:{}", compact_id_part(target))
}

fn compact_id_part(value: &str) -> String {
    let compact = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if compact.is_empty() {
        "unknown".to_string()
    } else {
        compact.chars().take(96).collect()
    }
}

fn check(id: &str, status: &str, detail: String) -> Value {
    json!({
        "id": id,
        "status": status,
        "detail": detail,
    })
}

fn count_status(checks: &[Value], status: &str) -> usize {
    checks
        .iter()
        .filter(|check| check.get("status").and_then(Value::as_str) == Some(status))
        .count()
}

fn optional_string(input: &Value, field: &str) -> Option<String> {
    input
        .get(field)?
        .as_str()
        .map(|value| value.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_component::{
        AgentComponentJsToolManifest, AgentComponentLevel, AgentComponentManifest,
        JsToolPermissions, AGENT_COMPONENT_SCHEMA_VERSION,
    };
    use crate::agentic::app_studio_context::{AppStudioSubject, AppStudioSubjectScope};
    use crate::agentic::tools::ToolRuntimeRestrictions;
    use crate::agentic::WorkspaceBinding;
    use crate::app_platform::{
        create_product_app_package, create_product_app_package_with_options, AppSurfaceMode,
        CreateProductAppPackageDraft, CreateProductAppPackageOptions,
    };
    use crate::infrastructure::PathManager;
    use std::collections::BTreeMap;
    use std::collections::HashMap;
    use std::fs as std_fs;
    use std::path::PathBuf;
    use std::sync::OnceLock;

    fn js_runtime_test_lock() -> &'static tokio::sync::Mutex<()> {
        static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
    }

    #[test]
    fn validation_runtime_checks_do_not_supply_passed_runtime_evidence() {
        assert!(!validation_runtime_check_is_strong_evidence(
            WorkStudioFactStatus::Passed
        ));
        assert!(!validation_runtime_check_is_strong_evidence(
            WorkStudioFactStatus::Warning
        ));
        assert!(validation_runtime_check_is_strong_evidence(
            WorkStudioFactStatus::Failed
        ));
        assert!(validation_runtime_check_is_strong_evidence(
            WorkStudioFactStatus::Blocked
        ));
    }

    #[test]
    fn component_runtime_preview_evidence_requires_strong_sources() {
        assert!(component_preview_source_is_strong_evidence(
            "runtimeDependencies",
            WorkStudioPreviewSource::RuntimeObservation
        ));
        assert!(!component_preview_source_is_strong_evidence(
            "runtimeDependencies",
            WorkStudioPreviewSource::PreviewHarness
        ));
        assert!(!component_preview_source_is_strong_evidence(
            "runtimeDependencies",
            WorkStudioPreviewSource::RuntimeFact
        ));
        assert!(component_preview_source_is_strong_evidence(
            "agentEval",
            WorkStudioPreviewSource::PreviewHarness
        ));
        assert!(component_preview_source_is_strong_evidence(
            "componentContract",
            WorkStudioPreviewSource::PreviewHarness
        ));
    }

    fn component_context_with_root(package_root: PathBuf, component_kind: &str) -> ToolUseContext {
        component_context_with_workspace(package_root, component_kind, None)
    }

    fn component_context_with_workspace(
        package_root: PathBuf,
        component_kind: &str,
        workspace_root: Option<PathBuf>,
    ) -> ToolUseContext {
        ToolUseContext {
            tool_call_id: None,
            agent_type: Some("AppStudio".to_string()),
            session_id: Some("session-1".to_string()),
            dialog_turn_id: Some("turn-1".to_string()),
            workspace: workspace_root.map(|root| WorkspaceBinding::new(None, root)),
            custom_data: HashMap::new(),
            app_studio: Some(AppStudioExecutionContext {
                subject: AppStudioSubject::Component {
                    component_id: "current".to_string(),
                    component_kind: component_kind.to_string(),
                    version: "1.0.0".to_string(),
                    title: Some("Current Component".to_string()),
                    scope: AppStudioSubjectScope::System,
                },
                package_root: package_root.clone(),
                allowed_write_roots: vec![package_root],
                work_id: None,
                runtime_instance_id: None,
                preview_issue_id: None,
            }),
            computer_use_host: None,
            cancellation_token: None,
            runtime_tool_restrictions: ToolRuntimeRestrictions::default(),
            workspace_services: None,
            workspace_mount: None,
            agentic: None,
        }
    }

    fn write_project_agent_component_js_tool(workspace_root: &std::path::Path) -> String {
        let component_id = format!("agent-runner-{}", uuid::Uuid::new_v4());
        AgentComponentManager::create_or_update(
            AgentComponentManifest {
                schema_version: AGENT_COMPONENT_SCHEMA_VERSION,
                id: component_id.clone(),
                name: "Agent Runner".to_string(),
                description: "Runs a test Agent Component JS runtime tool.".to_string(),
                icon: "bot".to_string(),
                category: "test".to_string(),
                tags: Vec::new(),
                level: AgentComponentLevel::Project,
                model: "primary".to_string(),
                readonly: true,
                enabled: true,
                tools: Vec::new(),
                skills: Vec::new(),
                subagents: Vec::new(),
                tool_policies: BTreeMap::new(),
                service_actions: Vec::new(),
                bridge_capabilities: Vec::new(),
                examples: Vec::new(),
            },
            "Use the runtime tool for test fixtures.".to_string(),
            Some(workspace_root),
            true,
        )
        .expect("create project agent component");
        AgentComponentManager::create_js_tool(
            &component_id,
            Some(AgentComponentLevel::Project),
            Some(workspace_root),
            AgentComponentJsToolManifest {
                name: "run".to_string(),
                description: "Echo fixture input.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "additionalProperties": true
                }),
                runtime: "javascript".to_string(),
                entry: "tools/run.js".to_string(),
                readonly: true,
                permissions: JsToolPermissions::default(),
                timeout_ms: 30_000,
                max_output_bytes: 12_000,
                ui: None,
            },
            r#"
async function run(input, context) {
  return {
    summary: "Agent Component fixture executed.",
    echoed: input,
    workspaceRoot: context.workspaceRoot,
  };
}

module.exports = { run };
"#
            .to_string(),
        )
        .expect("create JS runtime tool");
        component_id
    }

    fn write_project_skill(workspace_root: &std::path::Path, dir_name: &str, name: &str) {
        let skill_root = workspace_root
            .join(crate::infrastructure::APP_HIDDEN_DIR_NAME)
            .join("skills")
            .join(dir_name);
        std_fs::create_dir_all(&skill_root).expect("create project skill");
        std_fs::write(
            skill_root.join("SKILL.md"),
            format!(
                "---\nname: {name}\ndescription: Test App Studio capability skill.\n---\n\n# {name}\n\nUse this skill for preview harness fixtures.\n"
            ),
        )
        .expect("write project skill");
    }

    fn product_context_with_root(
        package_root: PathBuf,
        app_id: &str,
        version: &str,
    ) -> ToolUseContext {
        product_context_with_workspace(package_root, app_id, version, None)
    }

    fn product_context_with_workspace(
        package_root: PathBuf,
        app_id: &str,
        version: &str,
        workspace_root: Option<PathBuf>,
    ) -> ToolUseContext {
        ToolUseContext {
            tool_call_id: None,
            agent_type: Some("AppStudio".to_string()),
            session_id: Some("session-1".to_string()),
            dialog_turn_id: Some("turn-1".to_string()),
            workspace: workspace_root.map(|root| WorkspaceBinding::new(None, root)),
            custom_data: HashMap::new(),
            app_studio: Some(AppStudioExecutionContext {
                subject: AppStudioSubject::ProductApp {
                    app_id: app_id.to_string(),
                    version: version.to_string(),
                    title: Some("Current App".to_string()),
                    scope: AppStudioSubjectScope::System,
                },
                package_root: package_root.clone(),
                allowed_write_roots: vec![package_root],
                work_id: None,
                runtime_instance_id: None,
                preview_issue_id: None,
            }),
            computer_use_host: None,
            cancellation_token: None,
            runtime_tool_restrictions: ToolRuntimeRestrictions::default(),
            workspace_services: None,
            workspace_mount: None,
            agentic: None,
        }
    }

    fn write_component_package(component_kind: &str) -> (PathBuf, PathBuf) {
        write_component_package_with_implementation(
            component_kind,
            Some("bundle://bridge-components/current"),
        )
    }

    fn write_component_package_with_implementation(
        component_kind: &str,
        implementation_ref: Option<&str>,
    ) -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!(
            "sparo-run-studio-preview-{component_kind}-{}",
            uuid::Uuid::new_v4()
        ));
        let package_root = base.join(component_kind).join("current").join("1.0.0");
        std_fs::create_dir_all(package_root.join("tests")).expect("create component package");
        std_fs::write(
            package_root.join("component.json"),
            serde_json::to_vec_pretty(&json!({
                "id": "current",
                "version": "1.0.0",
                "kind": component_kind,
                "name": "Current Component",
                "description": "A test component package.",
                "packageSource": "shared",
                "capabilities": [{
                    "id": "lookup",
                    "title": "Lookup",
                    "description": "Lookup a value.",
                    "actions": ["run"]
                }],
                "permissions": [],
                "usedByApps": [],
                "visibility": "developer",
                "dependencies": [],
                "implementationRef": implementation_ref
            }))
            .expect("serialize component"),
        )
        .expect("write component");
        std_fs::write(
            package_root.join("tests").join("contract.md"),
            "# Contract\n\n- Given a lookup fixture, returns a structured result.\n",
        )
        .expect("write contract");
        (base, package_root)
    }

    fn unbound_context() -> ToolUseContext {
        ToolUseContext {
            tool_call_id: None,
            agent_type: Some("AppStudio".to_string()),
            session_id: None,
            dialog_turn_id: None,
            workspace: None,
            custom_data: HashMap::new(),
            app_studio: None,
            computer_use_host: None,
            cancellation_token: None,
            runtime_tool_restrictions: ToolRuntimeRestrictions::default(),
            workspace_services: None,
            workspace_mount: None,
            agentic: None,
        }
    }

    #[tokio::test]
    async fn run_studio_preview_requires_bound_context() {
        let tool = RunStudioPreviewTool::new();

        let denied = tool.call_impl(&json!({}), &unbound_context()).await;

        assert!(denied.is_err());
    }

    #[test]
    fn execute_preview_requires_permissions_and_is_not_concurrency_safe() {
        let tool = RunStudioPreviewTool::new();

        assert!(!tool.needs_permissions(Some(&json!({}))));
        assert!(tool.is_concurrency_safe(Some(&json!({}))));
        assert!(tool.needs_permissions(Some(&json!({ "execute": true }))));
        assert!(!tool.is_concurrency_safe(Some(&json!({ "execute": true }))));
    }

    #[tokio::test]
    async fn component_preview_defaults_to_capability_harness_fact() {
        let tool = RunStudioPreviewTool::new();
        let (base, package_root) = write_component_package("bridge");

        let output = tool
            .call_impl(
                &json!({
                    "fixture": {
                        "action": "run",
                        "input": { "query": "hello" }
                    }
                }),
                &component_context_with_root(package_root, "bridge"),
            )
            .await
            .expect("preview result");
        let data = output[0].content();

        assert_eq!(data["kind"], "capability");
        assert_eq!(data["harnessMode"], "capability");
        assert_eq!(data["status"], "notVerified");
        assert_eq!(data["source"], "preview-harness");
        assert_eq!(data["componentId"], "current");
        assert_eq!(data["summary"]["fixtureProvided"], true);
        let check_ids = data["checks"]
            .as_array()
            .expect("checks")
            .iter()
            .map(|check| check["id"].as_str().unwrap().to_string())
            .collect::<Vec<_>>();
        assert_eq!(
            check_ids,
            vec![
                "target",
                "fixture",
                "package",
                "componentContract",
                "capabilitySchema",
                "implementation",
                "permissions",
                "dependencies",
                "capabilityCall",
                "capabilityLogs",
                "capabilityTrace"
            ]
        );
        let checks = data["checks"].as_array().expect("checks");
        assert_eq!(checks[2]["status"], "passed");
        assert_eq!(checks[3]["status"], "passed");
        assert_eq!(checks[4]["status"], "passed");
        assert_eq!(checks[8]["status"], "notVerified");
        let _ = std_fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn execute_capability_blocks_unsupported_implementation_ref() {
        let tool = RunStudioPreviewTool::new();
        let (base, package_root) = write_component_package_with_implementation(
            "runtime",
            Some("custom://interactive-surface"),
        );

        let output = tool
            .call_impl(
                &json!({
                    "mode": "capability",
                    "execute": true,
                    "fixture": {
                        "action": "run",
                        "input": {}
                    }
                }),
                &component_context_with_root(package_root, "runtime"),
            )
            .await
            .expect("preview result");
        let data = output[0].content();
        let capability_call = data["checks"]
            .as_array()
            .expect("checks")
            .iter()
            .find(|check| check["id"] == "capabilityCall")
            .expect("capabilityCall check");

        assert_eq!(capability_call["status"], "blocked");
        assert!(capability_call["detail"]
            .as_str()
            .expect("detail")
            .contains("bundle://bridge-components"));
        assert!(capability_call["detail"]
            .as_str()
            .expect("detail")
            .contains("bundle://agent-components"));
        assert!(capability_call["detail"]
            .as_str()
            .expect("detail")
            .contains("runtime://interactive-surface"));
        assert!(capability_call["detail"]
            .as_str()
            .expect("detail")
            .contains("agent://"));
        assert!(capability_call["detail"]
            .as_str()
            .expect("detail")
            .contains("skill://"));
        let _ = std_fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn execute_capability_resolves_interactive_surface_runtime_binding() {
        let tool = RunStudioPreviewTool::new();
        let (base, package_root) = write_component_package_with_implementation(
            "runtime",
            Some("runtime://interactive-surface"),
        );

        let output = tool
            .call_impl(
                &json!({
                    "mode": "capability",
                    "execute": true,
                    "fixture": {
                        "action": "surface.preview.open",
                        "input": { "route": "/preview" }
                    }
                }),
                &component_context_with_root(package_root, "runtime"),
            )
            .await
            .expect("preview result");
        let data = output[0].content();
        let checks = data["checks"].as_array().expect("checks");
        let capability_call = checks
            .iter()
            .find(|check| check["id"] == "capabilityCall")
            .expect("capabilityCall check");
        let capability_logs = checks
            .iter()
            .find(|check| check["id"] == "capabilityLogs")
            .expect("capabilityLogs check");

        assert_eq!(data["status"], "passed");
        assert_eq!(capability_call["status"], "passed");
        assert!(capability_call["detail"]
            .as_str()
            .expect("detail")
            .contains("Interactive surface runtime runtime://interactive-surface resolved"));
        assert!(capability_call["detail"]
            .as_str()
            .expect("detail")
            .contains("No iframe DOM observation was produced"));
        assert_eq!(capability_logs["status"], "passed");
        assert!(capability_logs["detail"]
            .as_str()
            .expect("detail")
            .contains("Interactive surface runtime contract resolved"));
        let _ = std_fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn execute_capability_resolves_skill_binding() {
        let tool = RunStudioPreviewTool::new();
        let base = std::env::temp_dir().join(format!(
            "sparo-run-studio-preview-skill-binding-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace_root = base.join("workspace");
        std_fs::create_dir_all(&workspace_root).expect("create workspace");
        write_project_skill(&workspace_root, "sample-skill", "sample-skill");
        let (component_base, package_root) =
            write_component_package_with_implementation("skill", Some("skill://sample-skill"));

        let output = tool
            .call_impl(
                &json!({
                    "mode": "capability",
                    "execute": true,
                    "fixture": {
                        "action": "run",
                        "input": { "topic": "preview" }
                    }
                }),
                &component_context_with_workspace(package_root, "skill", Some(workspace_root)),
            )
            .await
            .expect("preview result");
        let data = output[0].content();
        let checks = data["checks"].as_array().expect("checks");
        let capability_call = checks
            .iter()
            .find(|check| check["id"] == "capabilityCall")
            .expect("capabilityCall check");
        let capability_logs = checks
            .iter()
            .find(|check| check["id"] == "capabilityLogs")
            .expect("capabilityLogs check");

        assert_eq!(data["status"], "passed");
        assert_eq!(capability_call["status"], "passed");
        assert!(capability_call["detail"]
            .as_str()
            .expect("detail")
            .contains("Skill binding skill://sample-skill resolved"));
        assert_eq!(capability_logs["status"], "passed");
        assert!(capability_logs["detail"]
            .as_str()
            .expect("detail")
            .contains("Skill profile resolved for sample-skill"));
        let _ = std_fs::remove_dir_all(base);
        let _ = std_fs::remove_dir_all(component_base);
    }

    #[tokio::test]
    async fn execute_capability_resolves_agent_runtime_binding() {
        let tool = RunStudioPreviewTool::new();
        let (base, package_root) =
            write_component_package_with_implementation("agent", Some("agent://agentic"));

        let output = tool
            .call_impl(
                &json!({
                    "mode": "capability",
                    "execute": true,
                    "fixture": {
                        "action": "agent.session.start",
                        "input": { "prompt": "hello" }
                    }
                }),
                &component_context_with_root(package_root, "agent"),
            )
            .await
            .expect("preview result");
        let data = output[0].content();
        let checks = data["checks"].as_array().expect("checks");
        let capability_call = checks
            .iter()
            .find(|check| check["id"] == "capabilityCall")
            .expect("capabilityCall check");
        let capability_logs = checks
            .iter()
            .find(|check| check["id"] == "capabilityLogs")
            .expect("capabilityLogs check");

        assert_eq!(data["status"], "passed");
        assert_eq!(capability_call["status"], "passed");
        assert!(capability_call["detail"]
            .as_str()
            .expect("detail")
            .contains("Agent runtime binding agent://agentic resolved"));
        assert_eq!(capability_logs["status"], "passed");
        assert!(capability_logs["detail"]
            .as_str()
            .expect("detail")
            .contains("Agent runtime profile resolved for agentic"));
        let _ = std_fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn execute_capability_runs_agent_component_js_tool() {
        let _js_runtime_guard = js_runtime_test_lock().lock().await;
        let tool = RunStudioPreviewTool::new();
        let base = std::env::temp_dir().join(format!(
            "sparo-run-studio-preview-agent-component-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace_root = base.join("workspace");
        std_fs::create_dir_all(&workspace_root).expect("create workspace");
        let agent_component_id = write_project_agent_component_js_tool(&workspace_root);
        let implementation_ref = format!("bundle://agent-components/{agent_component_id}");
        let (component_base, package_root) =
            write_component_package_with_implementation("agent", Some(&implementation_ref));

        let output = tool
            .call_impl(
                &json!({
                    "mode": "capability",
                    "execute": true,
                    "fixture": {
                        "action": "run",
                        "input": { "query": "hello" }
                    }
                }),
                &component_context_with_workspace(package_root, "agent", Some(workspace_root)),
            )
            .await
            .expect("preview result");
        let data = output[0].content();
        let checks = data["checks"].as_array().expect("checks");
        let capability_call = checks
            .iter()
            .find(|check| check["id"] == "capabilityCall")
            .expect("capabilityCall check");
        let capability_logs = checks
            .iter()
            .find(|check| check["id"] == "capabilityLogs")
            .expect("capabilityLogs check");

        assert_eq!(data["status"], "passed");
        assert_eq!(capability_call["status"], "passed");
        assert!(capability_call["detail"]
            .as_str()
            .expect("detail")
            .contains("Agent Component JS runtime tool run completed"));
        assert_eq!(capability_logs["status"], "passed");
        assert!(capability_logs["detail"]
            .as_str()
            .expect("detail")
            .contains("Agent Component fixture executed"));
        let _ = crate::agentic::agents::get_agent_registry()
            .remove_agent_component(&agent_component_id);
        crate::agent_component::js_runtime::shutdown_for_tests().await;
        let _ = std_fs::remove_dir_all(base);
        let _ = std_fs::remove_dir_all(component_base);
    }

    #[tokio::test]
    async fn agent_eval_component_runs_agent_component_js_tool() {
        let _js_runtime_guard = js_runtime_test_lock().lock().await;
        let tool = RunStudioPreviewTool::new();
        let base = std::env::temp_dir().join(format!(
            "sparo-run-studio-preview-agent-eval-component-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace_root = base.join("workspace");
        std_fs::create_dir_all(&workspace_root).expect("create workspace");
        let agent_component_id = write_project_agent_component_js_tool(&workspace_root);
        let implementation_ref = format!("bundle://agent-components/{agent_component_id}");
        let (component_base, package_root) =
            write_component_package_with_implementation("agent", Some(&implementation_ref));

        let output = tool
            .call_impl(
                &json!({
                    "mode": "agent-eval",
                    "execute": true,
                    "fixture": {
                        "action": "run",
                        "input": { "query": "agent eval" }
                    }
                }),
                &component_context_with_workspace(package_root, "agent", Some(workspace_root)),
            )
            .await
            .expect("preview result");
        let data = output[0].content();
        let checks = data["checks"].as_array().expect("checks");
        let agent_eval = checks
            .iter()
            .find(|check| check["id"] == "agentEval")
            .expect("agentEval check");
        let eval_logs = checks
            .iter()
            .find(|check| check["id"] == "evalLogs")
            .expect("evalLogs check");

        assert_eq!(data["kind"], "agent-eval");
        assert_eq!(data["harnessMode"], "agent-eval");
        assert_eq!(data["status"], "passed", "{data}");
        assert_eq!(agent_eval["status"], "passed", "{data}");
        assert!(agent_eval["detail"]
            .as_str()
            .expect("agentEval detail")
            .contains("Agent Eval executed Agent Component JS runtime tool run"));
        assert_eq!(eval_logs["status"], "passed");
        let _ = crate::agentic::agents::get_agent_registry()
            .remove_agent_component(&agent_component_id);
        crate::agent_component::js_runtime::shutdown_for_tests().await;
        let _ = std_fs::remove_dir_all(base);
        let _ = std_fs::remove_dir_all(component_base);
    }

    #[tokio::test]
    async fn agent_eval_product_app_requires_executable_evidence() {
        let tool = RunStudioPreviewTool::new();
        let base = std::env::temp_dir().join(format!(
            "sparo-run-studio-preview-product-agent-eval-{}",
            uuid::Uuid::new_v4()
        ));
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let written = create_product_app_package_with_options(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "current-app".to_string(),
                name: "Current App".to_string(),
                description: "A test Product App.".to_string(),
                goal: "Test Agent Eval evidence.".to_string(),
                version: "1.0.0".to_string(),
                agent_type: "agentic".to_string(),
                category: "test".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
            CreateProductAppPackageOptions {
                include_agent: Some(true),
                include_surface: Some(true),
            },
        )
        .await
        .expect("create product app package");

        let output = tool
            .call_impl(
                &json!({
                    "mode": "agent-eval",
                    "intent": "representative behavior eval"
                }),
                &product_context_with_root(written.package_dir, "current-app", "1.0.0"),
            )
            .await
            .expect("preview result");
        let data = output[0].content();
        let checks = data["checks"].as_array().expect("checks");
        let agent_eval = checks
            .iter()
            .find(|check| check["id"] == "agentEval")
            .expect("agentEval check");

        assert_eq!(data["kind"], "agent-eval");
        assert_eq!(data["harnessMode"], "agent-eval");
        assert_eq!(data["status"], "notVerified");
        assert_eq!(agent_eval["status"], "notVerified");
        assert!(agent_eval["detail"]
            .as_str()
            .expect("agentEval detail")
            .contains("execute=true"));
        let _ = std_fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn agent_eval_product_app_executes_runtime_binding_without_claiming_behavior() {
        let tool = RunStudioPreviewTool::new();
        let base = std::env::temp_dir().join(format!(
            "sparo-run-studio-preview-product-agent-runtime-binding-{}",
            uuid::Uuid::new_v4()
        ));
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let written = create_product_app_package_with_options(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "current-app".to_string(),
                name: "Current App".to_string(),
                description: "A test Product App.".to_string(),
                goal: "Test Agent Eval evidence.".to_string(),
                version: "1.0.0".to_string(),
                agent_type: "agentic".to_string(),
                category: "test".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
            CreateProductAppPackageOptions {
                include_agent: Some(true),
                include_surface: Some(true),
            },
        )
        .await
        .expect("create product app package");

        let output = tool
            .call_impl(
                &json!({
                    "mode": "agent-eval",
                    "execute": true
                }),
                &product_context_with_root(written.package_dir, "current-app", "1.0.0"),
            )
            .await
            .expect("preview result");
        let data = output[0].content();
        let checks = data["checks"].as_array().expect("checks");
        let agent_eval = checks
            .iter()
            .find(|check| check["id"] == "agentEval")
            .expect("agentEval check");
        let eval_logs = checks
            .iter()
            .find(|check| check["id"] == "evalLogs")
            .expect("evalLogs check");

        assert_eq!(data["status"], "notVerified");
        assert_eq!(agent_eval["status"], "notVerified");
        assert!(agent_eval["detail"]
            .as_str()
            .expect("agentEval detail")
            .contains("passed=1"));
        assert!(agent_eval["detail"]
            .as_str()
            .expect("agentEval detail")
            .contains("notVerified=1"));
        assert!(eval_logs["detail"]
            .as_str()
            .expect("evalLogs detail")
            .contains("agent-runtime-binding [passed]"));
        assert!(eval_logs["detail"]
            .as_str()
            .expect("evalLogs detail")
            .contains("primary-agent-behavior [notVerified]"));
        let _ = std_fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn agent_eval_product_app_runs_package_eval_plan_js_tool_case() {
        let _js_runtime_guard = js_runtime_test_lock().lock().await;
        let tool = RunStudioPreviewTool::new();
        let base = std::env::temp_dir().join(format!(
            "sparo-run-studio-preview-product-agent-eval-plan-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace_root = base.join("workspace");
        std_fs::create_dir_all(&workspace_root).expect("create workspace");
        let agent_component_id = write_project_agent_component_js_tool(&workspace_root);
        let implementation_ref = format!("bundle://agent-components/{agent_component_id}");
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let written = create_product_app_package_with_options(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "current-app".to_string(),
                name: "Current App".to_string(),
                description: "A test Product App.".to_string(),
                goal: "Test Product App eval evidence.".to_string(),
                version: "1.0.0".to_string(),
                agent_type: "agentic".to_string(),
                category: "test".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
            CreateProductAppPackageOptions {
                include_agent: Some(true),
                include_surface: Some(true),
            },
        )
        .await
        .expect("create product app package");

        let agent_component_path = written
            .package_dir
            .join("components")
            .join("agents")
            .join("current-app-agent")
            .join("component.json");
        let mut agent_component: Value = serde_json::from_slice(
            &std_fs::read(&agent_component_path).expect("read agent component"),
        )
        .expect("parse agent component");
        agent_component["implementationRef"] = json!(implementation_ref);
        std_fs::write(
            &agent_component_path,
            serde_json::to_vec_pretty(&agent_component).expect("serialize agent component"),
        )
        .expect("write agent component");
        std_fs::write(
            written.package_dir.join("tests").join("eval.json"),
            serde_json::to_vec_pretty(&json!({
                "version": 1,
                "cases": [{
                    "id": "primary-tool-case",
                    "title": "Primary tool case",
                    "componentId": "current-app-agent",
                    "implementationRef": implementation_ref,
                    "evidenceKind": "js-tool",
                    "action": "run",
                    "toolName": "run",
                    "input": { "query": "product eval" },
                    "expectations": [{
                        "kind": "json-equals",
                        "path": "results.0.data.result.echoed.query",
                        "value": "product eval"
                    }]
                }]
            }))
            .expect("serialize eval plan"),
        )
        .expect("write eval plan");

        let output = tool
            .call_impl(
                &json!({
                    "mode": "agent-eval",
                    "execute": true
                }),
                &product_context_with_workspace(
                    written.package_dir,
                    "current-app",
                    "1.0.0",
                    Some(workspace_root),
                ),
            )
            .await
            .expect("preview result");
        let data = output[0].content();
        let checks = data["checks"].as_array().expect("checks");
        let agent_eval = checks
            .iter()
            .find(|check| check["id"] == "agentEval")
            .expect("agentEval check");
        let eval_logs = checks
            .iter()
            .find(|check| check["id"] == "evalLogs")
            .expect("evalLogs check");

        let _ = crate::agentic::agents::get_agent_registry()
            .remove_agent_component(&agent_component_id);
        crate::agent_component::js_runtime::shutdown_for_tests().await;
        let _ = std_fs::remove_dir_all(base);

        assert_eq!(data["kind"], "agent-eval");
        assert_eq!(data["harnessMode"], "agent-eval");
        assert_eq!(data["status"], "passed", "{data}");
        assert_eq!(agent_eval["status"], "passed", "{data}");
        assert!(agent_eval["detail"]
            .as_str()
            .expect("agentEval detail")
            .contains("executed 1 case"));
        assert_eq!(eval_logs["status"], "passed");
        assert!(eval_logs["detail"]
            .as_str()
            .expect("evalLogs detail")
            .contains("product eval"));
    }

    #[tokio::test]
    async fn concrete_release_readiness_modes_report_independent_preview_kinds() {
        let tool = RunStudioPreviewTool::new();
        let base = std::env::temp_dir().join(format!(
            "sparo-run-studio-preview-readiness-modes-{}",
            uuid::Uuid::new_v4()
        ));
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let written = create_product_app_package_with_options(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "current-app".to_string(),
                name: "Current App".to_string(),
                description: "A test Product App.".to_string(),
                goal: "Test independent readiness evidence modes.".to_string(),
                version: "1.0.0".to_string(),
                agent_type: "agentic".to_string(),
                category: "test".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
            CreateProductAppPackageOptions {
                include_agent: Some(true),
                include_surface: Some(true),
            },
        )
        .await
        .expect("create product app package");
        let cases = [
            ("runtime-boundary", "runtime-boundary", "runtimeStorage"),
            (
                "runtime-dependencies",
                "runtime-dependencies",
                "runtimeDependencies",
            ),
            ("permission-review", "permission-review", "permissionReview"),
            ("user-path-rehearsal", "user-path-rehearsal", "userPath"),
        ];

        for (mode, expected_kind, expected_check) in cases {
            let output = tool
                .call_impl(
                    &json!({ "mode": mode }),
                    &product_context_with_root(written.package_dir.clone(), "current-app", "1.0.0"),
                )
                .await
                .expect("preview result");
            let data = output[0].content();
            let checks = data["checks"].as_array().expect("checks");

            assert_eq!(data["kind"], expected_kind);
            assert_eq!(data["harnessMode"], mode);
            assert!(
                checks.iter().any(|check| check["id"] == expected_check),
                "{mode} should report {expected_check}: {data}"
            );
        }

        let _ = std_fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn runtime_dependencies_with_browser_esm_dependency_require_runtime_evidence() {
        let tool = RunStudioPreviewTool::new();
        let base = std::env::temp_dir().join(format!(
            "sparo-run-studio-preview-runtime-deps-{}",
            uuid::Uuid::new_v4()
        ));
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let written = create_product_app_package_with_options(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "current-app".to_string(),
                name: "Current App".to_string(),
                description: "A test Product App.".to_string(),
                goal: "Test runtime dependency evidence.".to_string(),
                version: "1.0.0".to_string(),
                agent_type: "agentic".to_string(),
                category: "test".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
            CreateProductAppPackageOptions {
                include_agent: Some(true),
                include_surface: Some(true),
            },
        )
        .await
        .expect("create product app package");
        std_fs::write(
            written
                .package_dir
                .join("components")
                .join("surfaces")
                .join("current-app-surface")
                .join("source")
                .join("esm_dependencies.json"),
            r#"[{"name":"lit","url":"https://cdn.example.invalid/lit.js"}]"#,
        )
        .expect("write esm dependencies");

        let output = tool
            .call_impl(
                &json!({ "mode": "runtime-dependencies" }),
                &product_context_with_root(written.package_dir, "current-app", "1.0.0"),
            )
            .await
            .expect("preview result");
        let data = output[0].content();
        let checks = data["checks"].as_array().expect("checks");
        let runtime_dependencies = checks
            .iter()
            .find(|check| check["id"] == "runtimeDependencies")
            .expect("runtimeDependencies check");

        assert_eq!(data["kind"], "runtime-dependencies");
        assert_eq!(runtime_dependencies["status"], "notVerified");
        assert!(runtime_dependencies["detail"]
            .as_str()
            .expect("runtime dependency detail")
            .contains("import-map/CDN resolution"));

        let _ = std_fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn release_rehearsal_preview_reports_missing_evidence_checks() {
        let tool = RunStudioPreviewTool::new();
        let (base, package_root) = write_component_package("agent");

        let output = tool
            .call_impl(
                &json!({
                    "mode": "release-rehearsal",
                    "intent": "pre-release gate"
                }),
                &component_context_with_root(package_root, "agent"),
            )
            .await
            .expect("preview result");
        let data = output[0].content();

        assert_eq!(data["kind"], "release-rehearsal");
        assert_eq!(data["status"], "notVerified");
        let check_ids = data["checks"]
            .as_array()
            .expect("checks")
            .iter()
            .map(|check| check["id"].as_str().unwrap().to_string())
            .collect::<Vec<_>>();
        let check = |id: &str| {
            data["checks"]
                .as_array()
                .expect("checks")
                .iter()
                .find(|check| check["id"] == id)
                .expect("check exists")
        };
        assert!(check_ids.contains(&"componentContract".to_string()));
        assert!(check_ids.contains(&"capabilities".to_string()));
        assert!(check_ids.contains(&"dependencies".to_string()));
        assert!(check_ids.contains(&"implementation".to_string()));
        assert!(check_ids.contains(&"consumerCompatibility".to_string()));
        assert!(check_ids.contains(&"permissions".to_string()));
        assert!(check_ids.contains(&"permissionReview".to_string()));
        assert!(check_ids.contains(&"data".to_string()));
        assert!(check_ids.contains(&"dataLifecycle".to_string()));
        assert!(check_ids.contains(&"dataSummary".to_string()));
        assert!(check_ids.contains(&"runtimeStorage".to_string()));
        assert!(check_ids.contains(&"runtimeDependencies".to_string()));
        assert!(check_ids.contains(&"agentEval".to_string()));
        assert_eq!(check("data")["status"], "notVerified");
        assert_eq!(check("dataLifecycle")["status"], "notVerified");
        assert_eq!(check("runtimeStorage")["status"], "notVerified");
        assert!(check("data")["detail"]
            .as_str()
            .expect("data detail")
            .contains("runtime evidence"));
        let _ = std_fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn release_rehearsal_product_app_reads_package_permission_data_eval_evidence() {
        let tool = RunStudioPreviewTool::new();
        let base = std::env::temp_dir().join(format!(
            "sparo-run-studio-preview-product-{}",
            uuid::Uuid::new_v4()
        ));
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let written = create_product_app_package_with_options(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "current-app".to_string(),
                name: "Current App".to_string(),
                description: "A test Product App.".to_string(),
                goal: "Test release rehearsal evidence.".to_string(),
                version: "1.0.0".to_string(),
                agent_type: "agentic".to_string(),
                category: "test".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
            CreateProductAppPackageOptions {
                include_agent: Some(true),
                include_surface: Some(true),
            },
        )
        .await
        .expect("create product app package");

        let output = tool
            .call_impl(
                &json!({
                    "mode": "release-rehearsal",
                    "intent": "pre-release gate"
                }),
                &product_context_with_root(written.package_dir, "current-app", "1.0.0"),
            )
            .await
            .expect("preview result");
        let data = output[0].content();
        let checks = data["checks"].as_array().expect("checks");
        let check = |id: &str| {
            checks
                .iter()
                .find(|check| check["id"] == id)
                .expect("check exists")
        };

        assert_eq!(data["kind"], "release-rehearsal");
        assert_eq!(check("package")["status"], "passed");
        assert_eq!(check("criticalPath")["status"], "notVerified");
        assert_eq!(check("permissions")["status"], "warning");
        assert_eq!(check("permissionReview")["status"], "notVerified");
        assert_eq!(check("data")["status"], "notVerified");
        assert_eq!(check("dataLifecycle")["status"], "notVerified");
        assert_eq!(check("dataSummary")["status"], "notVerified");
        assert_eq!(check("runtimeDependencies")["status"], "notVerified");
        assert_eq!(check("agentEval")["status"], "notVerified");
        assert_eq!(check("userPath")["status"], "notVerified");
        assert!(check("userPath")["detail"]
            .as_str()
            .expect("userPath detail")
            .contains("rehearsal scenario"));
        assert_eq!(check("releaseGate")["status"], "notVerified");
        let _ = std_fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn release_rehearsal_surface_only_product_app_does_not_require_agent_eval() {
        let tool = RunStudioPreviewTool::new();
        let base = std::env::temp_dir().join(format!(
            "sparo-run-studio-preview-surface-only-product-{}",
            uuid::Uuid::new_v4()
        ));
        let path_manager = PathManager::with_user_root_for_tests(base.clone());
        let written = create_product_app_package(
            &path_manager,
            CreateProductAppPackageDraft {
                app_id: "surface-only-app".to_string(),
                name: "Surface Only App".to_string(),
                description: "A surface-only test Product App.".to_string(),
                goal: "Test release rehearsal for a surface-only app.".to_string(),
                version: "1.0.0".to_string(),
                agent_type: "agentic".to_string(),
                category: "test".to_string(),
                tags: Vec::new(),
                primary_surface_mode: AppSurfaceMode::ImmersivePrimary,
                work_multiplicity: Default::default(),
                truth_source: None,
            },
        )
        .await
        .expect("create product app package");

        let output = tool
            .call_impl(
                &json!({
                    "mode": "release-rehearsal",
                    "intent": "pre-release gate"
                }),
                &product_context_with_root(written.package_dir, "surface-only-app", "1.0.0"),
            )
            .await
            .expect("preview result");
        let data = output[0].content();
        let checks = data["checks"].as_array().expect("checks");
        let check = |id: &str| {
            checks
                .iter()
                .find(|check| check["id"] == id)
                .expect("check exists")
        };

        assert_eq!(data["kind"], "release-rehearsal");
        assert_eq!(check("permissions")["status"], "passed");
        assert_eq!(check("agentEval")["status"], "passed");
        assert!(check("agentEval")["detail"]
            .as_str()
            .expect("agentEval detail")
            .contains("not required"));
        let _ = std_fs::remove_dir_all(base);
    }
}
