use crate::agentic::WorkspaceBinding;
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::try_get_path_manager_arc;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const INTELLIGENT_APPS_DIRECTORY: &str = "intelligent_apps";
const DRAFTS_DIRECTORY: &str = "drafts";
const DRAFT_ID_PREFIX: &str = "draft_";
const DRAFT_ID_HEX_LENGTH: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppBuilderSubjectScope {
    System,
    Workspace { workspace_path: PathBuf },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppBuilderSubject {
    BuilderDraft {
        draft_id: String,
        title: Option<String>,
        scope: AppBuilderSubjectScope,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppBuilderExecutionContext {
    pub subject: AppBuilderSubject,
    pub package_root: PathBuf,
    pub allowed_write_roots: Vec<PathBuf>,
    pub work_id: Option<String>,
    pub runtime_instance_id: Option<String>,
    pub preview_issue_id: Option<String>,
}

impl AppBuilderExecutionContext {
    /// Restores an executable AppBuilder context from a bound Draft identity.
    ///
    /// Persisted metadata is intentionally not an authority for filesystem paths. The package
    /// root is derived from `draft_id` below the app-owned Draft store and canonicalized before it
    /// becomes an allowed write root.
    pub fn from_metadata(
        custom_metadata: Option<&Value>,
        turn_metadata: Option<&Value>,
        workspace: Option<&WorkspaceBinding>,
    ) -> CoreResult<Option<Self>> {
        Self::from_metadata_with_app_root(custom_metadata, turn_metadata, workspace, None)
    }

    fn from_metadata_with_app_root(
        custom_metadata: Option<&Value>,
        turn_metadata: Option<&Value>,
        workspace: Option<&WorkspaceBinding>,
        app_root_override: Option<&Path>,
    ) -> CoreResult<Option<Self>> {
        // Draft identity is a session capability. Per-turn metadata can carry issue correlation,
        // but it cannot rebind the session to another Draft.
        let binding = custom_metadata.and_then(|value| value.get("agentSessionBinding"));
        let Some(subject_value) = binding.and_then(|value| value.get("subject")) else {
            return Ok(None);
        };

        // Releases and shared Components are immutable inputs, never AppBuilder subjects.
        if string_field(subject_value, "kind").as_deref() != Some("builder-draft") {
            return Ok(None);
        }

        let Some(draft_id) = string_field(subject_value, "id") else {
            return Err(CoreError::validation(
                "AppBuilder Draft binding requires a draft id",
            ));
        };
        validate_draft_id(&draft_id)?;

        let app_root = match app_root_override {
            Some(path) => path.to_path_buf(),
            None => try_get_path_manager_arc()
                .map_err(|error| CoreError::tool(format!("PathManager not initialized: {error}")))?
                .app_root(),
        };
        let package_root = resolve_builder_draft_package_root(&app_root, &draft_id)?;
        let issue_context = turn_metadata.and_then(|value| value.get("appBuilderIssueContext"));
        let inherited_execution_context = binding.and_then(|value| value.get("executionContext"));
        let facts = custom_metadata.and_then(|value| value.get("appBuilderFacts"));

        Ok(Some(Self {
            subject: AppBuilderSubject::BuilderDraft {
                draft_id,
                title: string_field(subject_value, "title"),
                scope: resolve_scope(binding, workspace),
            },
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

    /// Produces inheritance metadata containing identity and runtime correlation only.
    /// Filesystem paths are deliberately absent and will be re-derived by the receiving session.
    pub fn to_session_metadata_patch(
        &self,
        opened_from: &str,
        updated_at: u64,
    ) -> CoreResult<Value> {
        let AppBuilderSubject::BuilderDraft {
            draft_id,
            title,
            scope,
        } = &self.subject;
        validate_draft_id(draft_id)?;

        let display_title = title.as_deref().unwrap_or(draft_id);
        let scope_value = scope_to_metadata(scope);
        let workspace_path = scope_workspace_path(scope);
        let mut execution_context = json!({});
        if let Some(work_id) = self.work_id.as_deref() {
            execution_context["workId"] = json!(work_id);
        }
        if let Some(runtime_instance_id) = self.runtime_instance_id.as_deref() {
            execution_context["runtimeInstanceId"] = json!(runtime_instance_id);
        }
        if let Some(preview_issue_id) = self.preview_issue_id.as_deref() {
            execution_context["previewIssueId"] = json!(preview_issue_id);
        }

        Ok(json!({
            "agentSessionBinding": {
                "schemaVersion": 1,
                "intent": {
                    "agentType": "AppBuilder",
                    "mode": "edit"
                },
                "subject": {
                    "kind": "builder-draft",
                    "id": draft_id,
                    "title": display_title
                },
                "surface": {
                    "contentType": "app-builder",
                    "title": format!("Edit {display_title}"),
                    "data": {
                        "draftId": draft_id,
                        "scope": scope_value
                    }
                },
                "executionContext": execution_context,
                "scope": scope_value,
                "workspacePath": workspace_path,
                "openedFrom": opened_from,
                "updatedAt": updated_at
            },
            "appBuilderFacts": {
                "subject": {
                    "kind": "builder-draft",
                    "draftId": draft_id
                }
            }
        }))
    }
}

fn validate_draft_id(draft_id: &str) -> CoreResult<()> {
    let Some(suffix) = draft_id.strip_prefix(DRAFT_ID_PREFIX) else {
        return Err(invalid_draft_id());
    };
    if suffix.len() != DRAFT_ID_HEX_LENGTH
        || !suffix
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(invalid_draft_id());
    }
    Ok(())
}

fn invalid_draft_id() -> CoreError {
    CoreError::validation("AppBuilder draft id must be draft_ followed by 32 lowercase hex digits")
}

fn resolve_builder_draft_package_root(app_root: &Path, draft_id: &str) -> CoreResult<PathBuf> {
    validate_draft_id(draft_id)?;
    let drafts_root = app_root
        .join(INTELLIGENT_APPS_DIRECTORY)
        .join(DRAFTS_DIRECTORY);
    let canonical_drafts_root = dunce::canonicalize(&drafts_root).map_err(|error| {
        CoreError::validation(format!(
            "Intelligent App Draft store is unavailable at '{}': {error}",
            drafts_root.display()
        ))
    })?;
    let candidate = drafts_root.join(draft_id);
    if !candidate.is_dir() {
        return Err(CoreError::validation(format!(
            "AppBuilder Draft directory does not exist: {draft_id}"
        )));
    }
    let canonical_candidate = dunce::canonicalize(&candidate).map_err(|error| {
        CoreError::validation(format!(
            "Failed to canonicalize AppBuilder Draft directory '{}': {error}",
            candidate.display()
        ))
    })?;
    let expected_candidate = canonical_drafts_root.join(draft_id);
    if canonical_candidate != expected_candidate
        || !canonical_candidate.starts_with(&canonical_drafts_root)
    {
        return Err(CoreError::validation(format!(
            "AppBuilder Draft directory escapes or aliases its canonical store location: {draft_id}"
        )));
    }
    Ok(canonical_candidate)
}

fn scope_to_metadata(scope: &AppBuilderSubjectScope) -> Value {
    match scope {
        AppBuilderSubjectScope::System => json!({ "kind": "system" }),
        AppBuilderSubjectScope::Workspace { workspace_path } => json!({
            "kind": "workspace",
            "workspacePath": workspace_path.to_string_lossy()
        }),
    }
}

fn scope_workspace_path(scope: &AppBuilderSubjectScope) -> Value {
    match scope {
        AppBuilderSubjectScope::System => Value::Null,
        AppBuilderSubjectScope::Workspace { workspace_path } => {
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
) -> AppBuilderSubjectScope {
    if let Some(scope) = binding.and_then(|value| value.get("scope")) {
        if scope.get("kind").and_then(Value::as_str) == Some("workspace") {
            if let Some(path) = string_field(scope, "workspacePath") {
                return AppBuilderSubjectScope::Workspace {
                    workspace_path: PathBuf::from(path),
                };
            }
        }
    }

    workspace
        .map(|binding| AppBuilderSubjectScope::Workspace {
            workspace_path: binding.root_path().to_path_buf(),
        })
        .unwrap_or(AppBuilderSubjectScope::System)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const DRAFT_ID: &str = "draft_0123456789abcdef0123456789abcdef";

    fn create_draft_store() -> (PathBuf, PathBuf) {
        let app_root = std::env::temp_dir().join(format!(
            "sparo-app-builder-context-{}",
            uuid::Uuid::new_v4()
        ));
        let draft_root = app_root
            .join(INTELLIGENT_APPS_DIRECTORY)
            .join(DRAFTS_DIRECTORY)
            .join(DRAFT_ID);
        std::fs::create_dir_all(&draft_root).expect("create draft root");
        (
            app_root,
            dunce::canonicalize(draft_root).expect("canonical draft root"),
        )
    }

    #[test]
    fn bound_draft_id_alone_resolves_the_canonical_package_root() {
        let (app_root, draft_root) = create_draft_store();
        let metadata = json!({
            "agentSessionBinding": {
                "subject": {
                    "kind": "builder-draft",
                    "id": DRAFT_ID,
                    "title": "Focus Draft"
                },
                "scope": { "kind": "system" }
            }
        });

        let context = AppBuilderExecutionContext::from_metadata_with_app_root(
            Some(&metadata),
            None,
            None,
            Some(&app_root),
        )
        .expect("context result")
        .expect("context");

        assert_eq!(context.package_root, draft_root);
        assert_eq!(context.allowed_write_roots, vec![draft_root]);
        assert!(matches!(
            context.subject,
            AppBuilderSubject::BuilderDraft { ref draft_id, .. } if draft_id == DRAFT_ID
        ));
        let _ = std::fs::remove_dir_all(app_root);
    }

    #[test]
    fn persisted_package_roots_are_ignored() {
        let (app_root, draft_root) = create_draft_store();
        let attacker_root = app_root.join("outside");
        std::fs::create_dir_all(&attacker_root).expect("create attacker root");
        let metadata = json!({
            "agentSessionBinding": {
                "subject": {
                    "kind": "builder-draft",
                    "id": DRAFT_ID,
                    "data": { "packageRoot": attacker_root }
                },
                "surface": { "data": { "packageRoot": attacker_root } },
                "executionContext": { "packageRoot": attacker_root }
            },
            "appBuilderFacts": {
                "subject": { "kind": "builder-draft", "packageRoot": attacker_root }
            }
        });

        let context = AppBuilderExecutionContext::from_metadata_with_app_root(
            Some(&metadata),
            None,
            None,
            Some(&app_root),
        )
        .expect("context result")
        .expect("context");

        assert_eq!(context.package_root, draft_root);
        let _ = std::fs::remove_dir_all(app_root);
    }

    #[test]
    fn turn_metadata_cannot_rebind_the_session_to_another_draft() {
        let (app_root, _) = create_draft_store();
        let turn_metadata = json!({
            "agentSessionBinding": {
                "subject": { "kind": "builder-draft", "id": DRAFT_ID }
            }
        });
        let context = AppBuilderExecutionContext::from_metadata_with_app_root(
            None,
            Some(&turn_metadata),
            None,
            Some(&app_root),
        )
        .expect("context result");
        assert!(context.is_none());
        let _ = std::fs::remove_dir_all(app_root);
    }

    #[test]
    fn invalid_or_missing_draft_directories_are_rejected() {
        let (app_root, _) = create_draft_store();
        let invalid_metadata = json!({
            "agentSessionBinding": {
                "subject": { "kind": "builder-draft", "id": "../outside" }
            }
        });
        assert!(AppBuilderExecutionContext::from_metadata_with_app_root(
            Some(&invalid_metadata),
            None,
            None,
            Some(&app_root),
        )
        .is_err());

        let missing_metadata = json!({
            "agentSessionBinding": {
                "subject": {
                    "kind": "builder-draft",
                    "id": "draft_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                }
            }
        });
        assert!(AppBuilderExecutionContext::from_metadata_with_app_root(
            Some(&missing_metadata),
            None,
            None,
            Some(&app_root),
        )
        .is_err());
        let _ = std::fs::remove_dir_all(app_root);
    }

    #[test]
    fn inherited_metadata_round_trips_without_filesystem_paths() {
        let (app_root, draft_root) = create_draft_store();
        let original = AppBuilderExecutionContext {
            subject: AppBuilderSubject::BuilderDraft {
                draft_id: DRAFT_ID.to_string(),
                title: Some("Focus Draft".to_string()),
                scope: AppBuilderSubjectScope::System,
            },
            package_root: draft_root.clone(),
            allowed_write_roots: vec![draft_root.clone()],
            work_id: Some("work-1".to_string()),
            runtime_instance_id: Some("runtime-1".to_string()),
            preview_issue_id: Some("issue-1".to_string()),
        };

        let patch = original
            .to_session_metadata_patch("InheritedAppBuilderExecutionContext", 1234)
            .expect("metadata patch");
        assert!(!patch.to_string().contains("packageRoot"));

        let restored = AppBuilderExecutionContext::from_metadata_with_app_root(
            Some(&patch),
            None,
            None,
            Some(&app_root),
        )
        .expect("context result")
        .expect("context");
        assert_eq!(restored.package_root, draft_root);
        assert_eq!(restored.work_id.as_deref(), Some("work-1"));
        assert_eq!(restored.runtime_instance_id.as_deref(), Some("runtime-1"));
        assert_eq!(restored.preview_issue_id.as_deref(), Some("issue-1"));
        let _ = std::fs::remove_dir_all(app_root);
    }
}
