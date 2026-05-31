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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readonly: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FilesContextSummaryCategory {
    pub category: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FilesContextSummary {
    pub item_count: u32,
    pub file_count: u32,
    pub folder_count: u32,
    pub total_size: u64,
    #[serde(default)]
    pub categories: Vec<FilesContextSummaryCategory>,
    #[serde(default)]
    pub capabilities: Vec<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<FilesContextSummary>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
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

    if let Some(source) = context.source.filter(|source| !source.trim().is_empty()) {
        lines.push(format!("source: {}", source));
    }

    if let Some(summary) = context.summary {
        lines.push("summary:".to_string());
        lines.push(format!("  items: {}", summary.item_count));
        lines.push(format!("  files: {}", summary.file_count));
        lines.push(format!("  folders: {}", summary.folder_count));
        lines.push(format!("  total_size: {} bytes", summary.total_size));
        if !summary.categories.is_empty() {
            lines.push("  categories:".to_string());
            for category in summary.categories {
                lines.push(format!("    - {}: {}", category.category, category.count));
            }
        }
        if !summary.capabilities.is_empty() {
            lines.push(format!(
                "  capabilities: {}",
                summary.capabilities.join(", ")
            ));
        }
    } else if !context.capabilities.is_empty() {
        lines.push(format!("capabilities: {}", context.capabilities.join(", ")));
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
            let category = item
                .category
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!(" [{}]", value))
                .unwrap_or_default();
            let readonly = item
                .readonly
                .filter(|value| *value)
                .map(|_| " readonly")
                .unwrap_or_default();
            let hidden = item
                .hidden
                .filter(|value| *value)
                .map(|_| " hidden")
                .unwrap_or_default();
            let modified = item
                .modified
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!(" modified={}", value))
                .unwrap_or_default();
            lines.push(format!(
                "  - {} {}{}{}{}{}{}",
                kind, item.path, category, size, readonly, hidden, modified
            ));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_rich_file_workbench_context() {
        let session_id = format!("files-context-test-{}", uuid::Uuid::new_v4());
        stash_files_context(
            &session_id,
            FilesContext {
                scope: FilesContextScope::System,
                cwd: "C:/Users/example/Downloads".to_string(),
                workspace_root: None,
                selection: vec![FilesContextSelection {
                    path: "C:/Users/example/Downloads/report.md".to_string(),
                    kind: FilesContextSelectionKind::File,
                    size: Some(128),
                    category: Some("text".to_string()),
                    readonly: Some(false),
                    hidden: Some(false),
                    modified: Some("2026-05-30T10:00:00Z".to_string()),
                }],
                recently_opened_paths: vec!["C:/Users/example/Downloads".to_string()],
                summary: Some(FilesContextSummary {
                    item_count: 1,
                    file_count: 1,
                    folder_count: 0,
                    total_size: 128,
                    categories: vec![FilesContextSummaryCategory {
                        category: "text".to_string(),
                        count: 1,
                    }],
                    capabilities: vec!["openInSparo".to_string(), "askSparo".to_string()],
                }),
                capabilities: vec![],
                source: Some("file-workbench".to_string()),
                created_at: Utc::now(),
            },
        );

        let prompt = render_files_context_prompt(&session_id).expect("context prompt");
        clear_files_context(&session_id);

        assert!(prompt.contains("source: file-workbench"));
        assert!(prompt.contains("summary:"));
        assert!(prompt.contains("categories:"));
        assert!(prompt.contains("- file C:/Users/example/Downloads/report.md [text] (128 bytes)"));
        assert!(prompt.contains("capabilities: openInSparo, askSparo"));
    }
}
