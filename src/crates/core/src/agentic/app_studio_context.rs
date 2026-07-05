use crate::agentic::WorkspaceBinding;
use crate::infrastructure::try_get_path_manager_arc;
use crate::error::{CoreError, CoreResult};
use serde_json::{json, Value};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppStudioSubjectScope {
    System,
    Workspace { workspace_path: PathBuf },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppStudioSubject {
    ProductApp {
        app_id: String,
        version: String,
        title: Option<String>,
        scope: AppStudioSubjectScope,
    },
    Component {
        component_id: String,
        component_kind: String,
        version: String,
        title: Option<String>,
        scope: AppStudioSubjectScope,
    },
    StudioDraft {
        draft_id: String,
        title: Option<String>,
        scope: AppStudioSubjectScope,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppStudioExecutionContext {
    pub subject: AppStudioSubject,
    pub package_root: PathBuf,
    pub allowed_write_roots: Vec<PathBuf>,
    pub work_id: Option<String>,
    pub runtime_instance_id: Option<String>,
    pub preview_issue_id: Option<String>,
}

impl AppStudioExecutionContext {
    pub fn from_metadata(
        custom_metadata: Option<&Value>,
        turn_metadata: Option<&Value>,
        workspace: Option<&WorkspaceBinding>,
    ) -> CoreResult<Option<Self>> {
        let binding = turn_metadata
            .and_then(|value| value.get("agentSessionBinding"))
            .or_else(|| custom_metadata.and_then(|value| value.get("agentSessionBinding")));
        let facts = custom_metadata.and_then(|value| value.get("appStudioFacts"));
        let inherited_execution_context = binding.and_then(|value| value.get("executionContext"));
        let issue_context = turn_metadata.and_then(|value| value.get("appStudioIssueContext"));

        let subject_value = binding
            .and_then(|value| value.get("subject"))
            .or_else(|| facts.and_then(|value| value.get("subject")));
        let Some(subject_value) = subject_value else {
            return Ok(None);
        };

        let subject_kind = string_field(subject_value, "kind");
        let scope = resolve_scope(binding, workspace);
        let package_root_hint = inherited_execution_context
            .and_then(|value| string_field(value, "packageRoot"))
            .or_else(|| issue_context.and_then(|value| string_field(value, "packageRoot")))
            .or_else(|| {
                subject_value
                    .get("data")
                    .and_then(|value| string_field(value, "packageRoot"))
            })
            .or_else(|| {
                binding
                    .and_then(|value| value.get("surface"))
                    .and_then(|value| value.get("data"))
                    .and_then(|value| string_field(value, "packageRoot"))
            })
            .or_else(|| {
                facts
                    .and_then(|value| value.get("subject"))
                    .and_then(|value| string_field(value, "packageRoot"))
            });

        let subject = match subject_kind.as_deref() {
            Some("product-app") => {
                let app_id = string_field(subject_value, "id")
                    .or_else(|| string_field(subject_value, "appId"))
                    .or_else(|| {
                        facts
                            .and_then(|value| value.get("subject"))
                            .and_then(|value| string_field(value, "appId"))
                    });
                let version = string_field(subject_value, "version").or_else(|| {
                    facts
                        .and_then(|value| value.get("subject"))
                        .and_then(|value| string_field(value, "version"))
                });
                let Some(app_id) = app_id else {
                    return Ok(None);
                };
                let Some(version) = version else {
                    return Ok(None);
                };
                AppStudioSubject::ProductApp {
                    app_id,
                    version,
                    title: string_field(subject_value, "title"),
                    scope,
                }
            }
            Some("component") => {
                let component_id = string_field(subject_value, "id")
                    .or_else(|| string_field(subject_value, "componentId"))
                    .or_else(|| {
                        facts
                            .and_then(|value| value.get("subject"))
                            .and_then(|value| string_field(value, "componentId"))
                    });
                let component_kind = string_field(subject_value, "componentKind")
                    .or_else(|| {
                        subject_value
                            .get("data")
                            .and_then(|value| string_field(value, "componentKind"))
                    })
                    .or_else(|| {
                        facts
                            .and_then(|value| value.get("subject"))
                            .and_then(|value| string_field(value, "componentKind"))
                    });
                let version = string_field(subject_value, "version").or_else(|| {
                    subject_value
                        .get("data")
                        .and_then(|value| string_field(value, "version"))
                });
                let (Some(component_id), Some(component_kind), Some(version)) =
                    (component_id, component_kind, version)
                else {
                    return Ok(None);
                };
                AppStudioSubject::Component {
                    component_id,
                    component_kind,
                    version,
                    title: string_field(subject_value, "title"),
                    scope,
                }
            }
            Some("studio-draft") => {
                let draft_id = string_field(subject_value, "id")
                    .or_else(|| string_field(subject_value, "draftId"));
                let Some(draft_id) = draft_id else {
                    return Ok(None);
                };
                AppStudioSubject::StudioDraft {
                    draft_id,
                    title: string_field(subject_value, "title"),
                    scope,
                }
            }
            _ => return Ok(None),
        };

        let package_root = resolve_package_root(&subject, package_root_hint.as_deref())?;
        Ok(Some(Self {
            subject,
            allowed_write_roots: vec![package_root.clone()],
            package_root,
            work_id: issue_context
                .and_then(|value| string_field(value, "workId"))
                .or_else(|| issue_context.and_then(|value| string_field(value, "work_id")))
                .or_else(|| {
                    inherited_execution_context.and_then(|value| string_field(value, "workId"))
                })
                .or_else(|| {
                    inherited_execution_context.and_then(|value| string_field(value, "work_id"))
                })
                .or_else(|| latest_preview_result_string(facts, &["workId", "work_id"])),
            runtime_instance_id: issue_context
                .and_then(|value| string_field(value, "runtimeInstanceId"))
                .or_else(|| {
                    inherited_execution_context
                        .and_then(|value| string_field(value, "runtimeInstanceId"))
                })
                .or_else(|| {
                    latest_preview_result_string(
                        facts,
                        &["runtimeInstanceId", "runtime_instance_id"],
                    )
                }),
            preview_issue_id: issue_context
                .and_then(|value| string_field(value, "issueId"))
                .or_else(|| issue_context.and_then(|value| string_field(value, "previewIssueId")))
                .or_else(|| {
                    inherited_execution_context.and_then(|value| string_field(value, "issueId"))
                })
                .or_else(|| {
                    inherited_execution_context
                        .and_then(|value| string_field(value, "previewIssueId"))
                }),
        }))
    }

    pub fn to_session_metadata_patch(&self, opened_from: &str, updated_at: u64) -> Value {
        let package_root = self.package_root.to_string_lossy().into_owned();
        let scope = scope_to_metadata(&self.subject);
        let workspace_path = match &self.subject {
            AppStudioSubject::ProductApp { scope, .. }
            | AppStudioSubject::Component { scope, .. }
            | AppStudioSubject::StudioDraft { scope, .. } => scope_workspace_path(scope),
        };

        let mut execution_context = json!({
            "packageRoot": package_root,
        });
        if let Some(work_id) = self.work_id.as_deref() {
            execution_context["workId"] = json!(work_id);
        }
        if let Some(runtime_instance_id) = self.runtime_instance_id.as_deref() {
            execution_context["runtimeInstanceId"] = json!(runtime_instance_id);
        }
        if let Some(preview_issue_id) = self.preview_issue_id.as_deref() {
            execution_context["previewIssueId"] = json!(preview_issue_id);
        }

        match &self.subject {
            AppStudioSubject::ProductApp {
                app_id,
                version,
                title,
                ..
            } => {
                let display_title = title.as_deref().unwrap_or(app_id);
                json!({
                    "agentSessionBinding": {
                        "schemaVersion": 1,
                        "intent": {
                            "agentType": "AppStudio",
                            "mode": "edit"
                        },
                        "subject": {
                            "kind": "product-app",
                            "id": app_id,
                            "title": display_title,
                            "version": version,
                            "data": {
                                "packageRoot": package_root
                            }
                        },
                        "surface": {
                            "contentType": "app-studio",
                            "title": format!("Edit {}", display_title),
                            "data": {
                                "appId": app_id,
                                "packageRoot": package_root,
                                "scope": scope
                            }
                        },
                        "executionContext": execution_context,
                        "scope": scope,
                        "workspacePath": workspace_path,
                        "openedFrom": opened_from,
                        "updatedAt": updated_at
                    },
                    "appStudioFacts": {
                        "subject": {
                            "kind": "product-app",
                            "appId": app_id,
                            "version": version,
                            "packageRoot": package_root
                        }
                    }
                })
            }
            AppStudioSubject::Component {
                component_id,
                component_kind,
                version,
                title,
                ..
            } => {
                let display_title = title.as_deref().unwrap_or(component_id);
                json!({
                    "agentSessionBinding": {
                        "schemaVersion": 1,
                        "intent": {
                            "agentType": "AppStudio",
                            "mode": "edit"
                        },
                        "subject": {
                            "kind": "component",
                            "id": component_id,
                            "title": display_title,
                            "version": version,
                            "data": {
                                "componentKind": component_kind,
                                "packageRoot": package_root
                            }
                        },
                        "surface": {
                            "contentType": "app-studio",
                            "title": format!("Edit {}", display_title),
                            "data": {
                                "componentId": component_id,
                                "componentKind": component_kind,
                                "componentVersion": version,
                                "componentPackageRoot": package_root,
                                "componentName": display_title,
                                "packageRoot": package_root,
                                "scope": scope
                            }
                        },
                        "executionContext": execution_context,
                        "scope": scope,
                        "workspacePath": workspace_path,
                        "openedFrom": opened_from,
                        "updatedAt": updated_at
                    },
                    "appStudioFacts": {
                        "subject": {
                            "kind": "component",
                            "componentId": component_id,
                            "componentKind": component_kind,
                            "version": version,
                            "packageRoot": package_root
                        }
                    }
                })
            }
            AppStudioSubject::StudioDraft {
                draft_id, title, ..
            } => {
                let display_title = title.as_deref().unwrap_or(draft_id);
                json!({
                    "agentSessionBinding": {
                        "schemaVersion": 1,
                        "intent": {
                            "agentType": "AppStudio",
                            "mode": "edit"
                        },
                        "subject": {
                            "kind": "studio-draft",
                            "id": draft_id,
                            "title": display_title,
                            "data": {
                                "packageRoot": package_root
                            }
                        },
                        "surface": {
                            "contentType": "app-studio",
                            "title": format!("Edit {}", display_title),
                            "data": {
                                "draftId": draft_id,
                                "packageRoot": package_root,
                                "scope": scope
                            }
                        },
                        "executionContext": execution_context,
                        "scope": scope,
                        "workspacePath": workspace_path,
                        "openedFrom": opened_from,
                        "updatedAt": updated_at
                    },
                    "appStudioFacts": {
                        "subject": {
                            "kind": "studio-draft",
                            "draftId": draft_id,
                            "packageRoot": package_root
                        }
                    }
                })
            }
        }
    }
}

fn scope_to_metadata(subject: &AppStudioSubject) -> Value {
    match subject {
        AppStudioSubject::ProductApp { scope, .. }
        | AppStudioSubject::Component { scope, .. }
        | AppStudioSubject::StudioDraft { scope, .. } => match scope {
            AppStudioSubjectScope::System => json!({ "kind": "system" }),
            AppStudioSubjectScope::Workspace { workspace_path } => json!({
                "kind": "workspace",
                "workspacePath": workspace_path.to_string_lossy()
            }),
        },
    }
}

fn scope_workspace_path(scope: &AppStudioSubjectScope) -> Value {
    match scope {
        AppStudioSubjectScope::System => Value::Null,
        AppStudioSubjectScope::Workspace { workspace_path } => {
            json!(workspace_path.to_string_lossy())
        }
    }
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    match value.get(key)? {
        Value::String(text) => {
            let trimmed = text.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn latest_preview_result_string(facts: Option<&Value>, keys: &[&str]) -> Option<String> {
    facts?
        .get("previewResults")?
        .as_array()?
        .iter()
        .enumerate()
        .filter_map(|(index, value)| {
            keys.iter()
                .find_map(|key| string_field(value, key))
                .map(|text| {
                    let observed_at = preview_observed_at(value).unwrap_or(index as i128);
                    ((observed_at, index), text)
                })
        })
        .max_by_key(|(sort_key, _)| *sort_key)
        .map(|(_, text)| text)
}

fn preview_observed_at(value: &Value) -> Option<i128> {
    let number = value
        .get("observedAt")
        .or_else(|| value.get("observed_at"))?
        .as_number()?;
    if let Some(value) = number.as_i64() {
        Some(value as i128)
    } else if let Some(value) = number.as_u64() {
        Some(value as i128)
    } else {
        number.as_f64().map(|value| value as i128)
    }
}

fn resolve_scope(
    binding: Option<&Value>,
    workspace: Option<&WorkspaceBinding>,
) -> AppStudioSubjectScope {
    if let Some(scope) = binding.and_then(|value| value.get("scope")) {
        if scope.get("kind").and_then(Value::as_str) == Some("workspace") {
            if let Some(path) = string_field(scope, "workspacePath") {
                return AppStudioSubjectScope::Workspace {
                    workspace_path: PathBuf::from(path),
                };
            }
        }
    }

    workspace
        .map(|binding| AppStudioSubjectScope::Workspace {
            workspace_path: binding.root_path().to_path_buf(),
        })
        .unwrap_or(AppStudioSubjectScope::System)
}

fn resolve_package_root(
    subject: &AppStudioSubject,
    package_root_hint: Option<&str>,
) -> CoreResult<PathBuf> {
    if let Some(package_root_hint) = package_root_hint {
        let package_root = PathBuf::from(package_root_hint);
        if !package_root.is_absolute() {
            return Err(CoreError::validation(
                "AppStudio package root must be absolute".to_string(),
            ));
        }
        return Ok(package_root);
    }

    let path_manager = try_get_path_manager_arc()
        .map_err(|e| CoreError::tool(format!("PathManager not initialized: {}", e)))?;

    match subject {
        AppStudioSubject::ProductApp {
            app_id,
            version,
            scope,
            ..
        } => Ok(match scope {
            AppStudioSubjectScope::System => {
                path_manager.system_product_app_version_dir(app_id, version)
            }
            AppStudioSubjectScope::Workspace { workspace_path } => {
                path_manager.project_product_app_version_dir(workspace_path, app_id, version)
            }
        }),
        AppStudioSubject::Component {
            component_id,
            component_kind,
            version,
            scope,
            ..
        } => Ok(match scope {
            AppStudioSubjectScope::System => {
                path_manager.system_component_version_dir(component_kind, component_id, version)
            }
            AppStudioSubjectScope::Workspace { workspace_path } => path_manager
                .project_component_version_dir(
                    workspace_path,
                    component_kind,
                    component_id,
                    version,
                ),
        }),
        AppStudioSubject::StudioDraft { .. } => Err(CoreError::validation(
            "AppStudio draft subject requires an absolute package root".to_string(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::get_path_manager_arc;
    use serde_json::json;

    #[test]
    fn builds_product_app_context_from_bound_session_metadata() {
        let custom_metadata = json!({
            "agentSessionBinding": {
                "subject": {
                    "kind": "product-app",
                    "id": "focus-app",
                    "title": "Focus App",
                    "version": "1.2.3"
                },
                "scope": { "kind": "system" }
            },
            "appStudioFacts": {
                "previewResults": [
                    { "workId": "work-1", "runtimeInstanceId": "runtime-1" }
                ]
            }
        });
        let turn_metadata = json!({
            "appStudioIssueContext": {
                "workId": "work-issue",
                "issueId": "issue-1",
                "runtimeInstanceId": "runtime-issue"
            }
        });

        let context = AppStudioExecutionContext::from_metadata(
            Some(&custom_metadata),
            Some(&turn_metadata),
            None,
        )
        .expect("context result")
        .expect("context");

        assert_eq!(
            context.package_root,
            get_path_manager_arc().system_product_app_version_dir("focus-app", "1.2.3")
        );
        assert_eq!(
            context.runtime_instance_id.as_deref(),
            Some("runtime-issue")
        );
        assert_eq!(context.work_id.as_deref(), Some("work-issue"));
        assert_eq!(context.preview_issue_id.as_deref(), Some("issue-1"));
        assert_eq!(
            context.allowed_write_roots,
            vec![context.package_root.clone()]
        );
    }

    #[test]
    fn explicit_execution_package_root_wins_over_workspace_scope_inference() {
        let base = std::env::temp_dir().join(format!(
            "sparo-explicit-app-studio-root-{}",
            uuid::Uuid::new_v4()
        ));
        let package_root = base
            .join("system")
            .join("apps")
            .join("focus-app")
            .join("1.2.3");
        let workspace_root = base.join("workspace");
        let custom_metadata = json!({
            "agentSessionBinding": {
                "subject": {
                    "kind": "product-app",
                    "id": "focus-app",
                    "title": "Focus App",
                    "version": "1.2.3"
                },
                "executionContext": {
                    "packageRoot": package_root.to_string_lossy()
                }
            }
        });
        let workspace = WorkspaceBinding::new(None, workspace_root);

        let context = AppStudioExecutionContext::from_metadata(
            Some(&custom_metadata),
            None,
            Some(&workspace),
        )
        .expect("context result")
        .expect("context");

        assert_eq!(context.package_root, package_root);
        assert_eq!(
            context.allowed_write_roots,
            vec![context.package_root.clone()]
        );

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn builds_product_app_context_from_latest_preview_fact_when_turn_context_is_absent() {
        let custom_metadata = json!({
            "agentSessionBinding": {
                "subject": {
                    "kind": "product-app",
                    "id": "focus-app",
                    "title": "Focus App",
                    "version": "1.2.3"
                },
                "scope": { "kind": "system" }
            },
            "appStudioFacts": {
                "previewResults": [
                    {
                        "workId": "work-old",
                        "runtimeInstanceId": "runtime-old",
                        "observedAt": 1000
                    },
                    {
                        "workId": "work-new",
                        "runtimeInstanceId": "runtime-new",
                        "observedAt": 2000
                    }
                ]
            }
        });

        let context = AppStudioExecutionContext::from_metadata(Some(&custom_metadata), None, None)
            .expect("context result")
            .expect("context");

        assert_eq!(context.work_id.as_deref(), Some("work-new"));
        assert_eq!(context.runtime_instance_id.as_deref(), Some("runtime-new"));
    }

    #[test]
    fn builds_component_context_from_bound_session_metadata() {
        let custom_metadata = json!({
            "agentSessionBinding": {
                "subject": {
                    "kind": "component",
                    "id": "shared-agent",
                    "title": "Shared Agent",
                    "version": "1.0.0",
                    "data": {
                        "componentKind": "agents"
                    }
                },
                "scope": { "kind": "system" }
            }
        });

        let context = AppStudioExecutionContext::from_metadata(Some(&custom_metadata), None, None)
            .expect("context result")
            .expect("context");

        assert_eq!(
            context.package_root,
            get_path_manager_arc().system_component_version_dir("agents", "shared-agent", "1.0.0")
        );
        assert_eq!(
            context.allowed_write_roots,
            vec![context.package_root.clone()]
        );
        assert!(matches!(
            context.subject,
            AppStudioSubject::Component {
                ref component_id,
                ref component_kind,
                ref version,
                ..
            } if component_id == "shared-agent"
                && component_kind == "agents"
                && version == "1.0.0"
        ));
    }

    #[test]
    fn inherited_metadata_patch_round_trips_product_app_execution_context() {
        let package_root =
            get_path_manager_arc().system_product_app_version_dir("focus-app", "1.2.3");
        let original = AppStudioExecutionContext {
            subject: AppStudioSubject::ProductApp {
                app_id: "focus-app".to_string(),
                version: "1.2.3".to_string(),
                title: Some("Focus App".to_string()),
                scope: AppStudioSubjectScope::System,
            },
            package_root,
            allowed_write_roots: Vec::new(),
            work_id: Some("work-1".to_string()),
            runtime_instance_id: Some("runtime-1".to_string()),
            preview_issue_id: Some("issue-1".to_string()),
        };

        let patch = original.to_session_metadata_patch("InheritedAppStudioExecutionContext", 1234);
        assert_eq!(
            patch["agentSessionBinding"]["openedFrom"],
            "InheritedAppStudioExecutionContext"
        );
        assert_eq!(
            patch["agentSessionBinding"]["executionContext"]["workId"],
            "work-1"
        );
        assert_eq!(
            patch["agentSessionBinding"]["executionContext"]["runtimeInstanceId"],
            "runtime-1"
        );

        let restored = AppStudioExecutionContext::from_metadata(Some(&patch), None, None)
            .expect("context result")
            .expect("context");

        assert_eq!(restored.work_id.as_deref(), Some("work-1"));
        assert_eq!(restored.runtime_instance_id.as_deref(), Some("runtime-1"));
        assert_eq!(restored.preview_issue_id.as_deref(), Some("issue-1"));
        assert!(matches!(
            restored.subject,
            AppStudioSubject::ProductApp {
                ref app_id,
                ref version,
                ..
            } if app_id == "focus-app" && version == "1.2.3"
        ));
        assert_eq!(
            restored.allowed_write_roots,
            vec![restored.package_root.clone()]
        );
    }

    #[test]
    fn inherited_context_does_not_depend_on_child_agent_type() {
        let custom_metadata = json!({
            "agentSessionBinding": {
                "intent": {
                    "agentType": "agentic",
                    "mode": "edit"
                },
                "subject": {
                    "kind": "product-app",
                    "id": "focus-app",
                    "title": "Focus App",
                    "version": "1.2.3"
                },
                "scope": { "kind": "system" },
                "openedFrom": "InheritedAppStudioExecutionContext",
                "executionContext": {
                    "workId": "work-1",
                    "runtimeInstanceId": "runtime-1"
                }
            }
        });

        let context = AppStudioExecutionContext::from_metadata(Some(&custom_metadata), None, None)
            .expect("context result")
            .expect("context");

        assert_eq!(
            context.package_root,
            get_path_manager_arc().system_product_app_version_dir("focus-app", "1.2.3")
        );
        assert_eq!(context.work_id.as_deref(), Some("work-1"));
        assert_eq!(context.runtime_instance_id.as_deref(), Some("runtime-1"));
    }
}
