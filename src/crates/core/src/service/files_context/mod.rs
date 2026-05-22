use chrono::{DateTime, Utc};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FilesContextScope {
    Workspace,
    System,
    Pinned,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FilesContextSelectionKind {
    File,
    Dir,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FilesContextSelection {
    pub path: String,
    pub kind: FilesContextSelectionKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FilesContext {
    pub scope: FilesContextScope,
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_root: Option<String>,
    #[serde(default)]
    pub selection: Vec<FilesContextSelection>,
    #[serde(default)]
    pub recently_opened_paths: Vec<String>,
    #[serde(default = "Utc::now")]
    pub created_at: DateTime<Utc>,
}

static FILES_CONTEXTS: OnceLock<DashMap<String, FilesContext>> = OnceLock::new();

fn registry() -> &'static DashMap<String, FilesContext> {
    FILES_CONTEXTS.get_or_init(DashMap::new)
}

pub fn stash_files_context(session_id: impl Into<String>, mut context: FilesContext) {
    context.created_at = Utc::now();
    registry().insert(session_id.into(), context);
}

pub fn get_files_context(session_id: &str) -> Option<FilesContext> {
    registry().get(session_id).map(|entry| entry.clone())
}

pub fn clear_files_context(session_id: &str) {
    registry().remove(session_id);
}

pub fn render_files_context_prompt(session_id: &str) -> Option<String> {
    let context = get_files_context(session_id)?;
    let scope = match context.scope {
        FilesContextScope::Workspace => "workspace",
        FilesContextScope::System => "system",
        FilesContextScope::Pinned => "pinned",
    };

    let mut lines = vec![
        "<FilesContext>".to_string(),
        format!("scope: {}", scope),
        format!("cwd: {}", context.cwd),
    ];

    if let Some(root) = context
        .workspace_root
        .filter(|root| !root.trim().is_empty())
    {
        lines.push(format!("workspace_root: {}", root));
    }

    lines.push("selection:".to_string());
    if context.selection.is_empty() {
        lines.push("  - none".to_string());
    } else {
        for item in context.selection {
            let kind = match item.kind {
                FilesContextSelectionKind::File => "file",
                FilesContextSelectionKind::Dir => "dir",
            };
            let size = item
                .size
                .map(|bytes| format!(" ({} bytes)", bytes))
                .unwrap_or_default();
            lines.push(format!("  - {} {}{}", kind, item.path, size));
        }
    }

    if !context.recently_opened_paths.is_empty() {
        lines.push("recently_opened:".to_string());
        for path in context.recently_opened_paths {
            lines.push(format!("  - {}", path));
        }
    }

    lines.push("</FilesContext>".to_string());
    Some(lines.join("\n"))
}
