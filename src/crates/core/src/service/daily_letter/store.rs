use super::types::{
    DailyLetterGetRequest, DailyLetterListRequest, DailyLetterRecord, DailyLetterScope,
    DailyLetterState,
};
use crate::error::{CoreError, CoreResult};
use crate::infrastructure::get_path_manager_arc;
use std::path::{Path, PathBuf};
use tokio::fs;

const DAILY_LETTERS_DIR: &str = "daily_letters";

pub(crate) fn resolve_request_scope(
    scope: Option<DailyLetterScope>,
    workspace_path: Option<&str>,
) -> DailyLetterScope {
    scope.unwrap_or_else(|| {
        if workspace_path
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
        {
            DailyLetterScope::Workspace
        } else {
            DailyLetterScope::AgenticOs
        }
    })
}

pub(crate) fn daily_letter_root(
    scope: DailyLetterScope,
    workspace_path: Option<&Path>,
) -> CoreResult<PathBuf> {
    let path_manager = get_path_manager_arc();
    match scope {
        DailyLetterScope::AgenticOs => Ok(path_manager
            .agentic_os_runtime_root()
            .join(DAILY_LETTERS_DIR)),
        DailyLetterScope::Workspace => {
            let workspace = workspace_path.ok_or_else(|| {
                CoreError::validation("workspacePath is required for workspace daily letters")
            })?;
            Ok(path_manager.project_root(workspace).join(DAILY_LETTERS_DIR))
        }
    }
}

pub(crate) fn daily_letter_state_path(
    scope: DailyLetterScope,
    workspace_path: Option<&Path>,
) -> CoreResult<PathBuf> {
    Ok(daily_letter_root(scope, workspace_path)?.join("state.json"))
}

pub(crate) fn daily_letter_record_id(
    date: &str,
    scope: DailyLetterScope,
    workspace_path: Option<&Path>,
) -> String {
    match scope {
        DailyLetterScope::AgenticOs => format!("daily-letter-agentic-os-{date}"),
        DailyLetterScope::Workspace => {
            let workspace_id = workspace_path
                .map(|path| get_path_manager_arc().workspace_runtime_id(path))
                .unwrap_or_else(|| "workspace".to_string());
            format!("daily-letter-{workspace_id}-{date}")
        }
    }
}

pub(crate) fn daily_letter_record_path(
    date: &str,
    scope: DailyLetterScope,
    workspace_path: Option<&Path>,
) -> CoreResult<PathBuf> {
    let year = date.split('-').next().unwrap_or("unknown");
    Ok(daily_letter_root(scope, workspace_path)?
        .join(year)
        .join(format!("{date}.json")))
}

pub(crate) fn daily_letter_markdown_path(
    date: &str,
    scope: DailyLetterScope,
    workspace_path: Option<&Path>,
) -> CoreResult<PathBuf> {
    let year = date.split('-').next().unwrap_or("unknown");
    Ok(daily_letter_root(scope, workspace_path)?
        .join(year)
        .join(format!("{date}.md")))
}

pub(crate) async fn load_daily_letter_state(
    scope: DailyLetterScope,
    workspace_path: Option<&Path>,
) -> CoreResult<DailyLetterState> {
    let root = daily_letter_root(scope, workspace_path)?;
    fs::create_dir_all(&root).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to create daily letter runtime directory {}: {}",
            root.display(),
            error
        ))
    })?;

    let path = daily_letter_state_path(scope, workspace_path)?;
    if !path.exists() {
        return Ok(DailyLetterState::default());
    }
    let content = fs::read_to_string(&path).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to read daily letter state file {}: {}",
            path.display(),
            error
        ))
    })?;
    if content.trim().is_empty() {
        return Ok(DailyLetterState::default());
    }
    serde_json::from_str(&content).map_err(|error| {
        CoreError::service(format!(
            "Failed to parse daily letter state file {}: {}",
            path.display(),
            error
        ))
    })
}

pub(crate) async fn save_daily_letter_state(
    scope: DailyLetterScope,
    workspace_path: Option<&Path>,
    state: &DailyLetterState,
) -> CoreResult<()> {
    let path = daily_letter_state_path(scope, workspace_path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let content = serde_json::to_string_pretty(state)?;
    fs::write(&path, content).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to write daily letter state file {}: {}",
            path.display(),
            error
        ))
    })?;
    Ok(())
}

pub(crate) async fn list_daily_letters(
    request: DailyLetterListRequest,
) -> CoreResult<Vec<DailyLetterRecord>> {
    let scope = resolve_request_scope(request.scope, request.workspace_path.as_deref());
    let workspace_path = request.workspace_path.as_deref().map(Path::new);
    let root = daily_letter_root(scope, workspace_path)?;
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut records = Vec::new();
    let mut year_entries = fs::read_dir(&root).await?;
    while let Some(year_entry) = year_entries.next_entry().await? {
        let file_type = year_entry.file_type().await?;
        if !file_type.is_dir() {
            continue;
        }
        let mut file_entries = fs::read_dir(year_entry.path()).await?;
        while let Some(file_entry) = file_entries.next_entry().await? {
            let path = file_entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&path).await {
                match serde_json::from_str::<DailyLetterRecord>(&content) {
                    Ok(record) => records.push(record),
                    Err(error) => log::warn!(
                        "Skipping invalid daily letter record: path={} error={}",
                        path.display(),
                        error
                    ),
                }
            }
        }
    }

    records.sort_by(|left, right| {
        right
            .date
            .cmp(&left.date)
            .then_with(|| right.updated_at_ms.cmp(&left.updated_at_ms))
    });
    if let Some(limit) = request.limit.filter(|value| *value > 0) {
        records.truncate(limit);
    }
    Ok(records)
}

pub(crate) async fn get_daily_letter(
    request: DailyLetterGetRequest,
) -> CoreResult<Option<DailyLetterRecord>> {
    let scope = resolve_request_scope(request.scope, request.workspace_path.as_deref());
    let workspace_path = request.workspace_path.as_deref().map(Path::new);
    if let Some(date) = request.date.as_deref() {
        return load_daily_letter_record(date, scope, workspace_path).await;
    }

    if let Some(id) = request.id.as_deref() {
        let records = list_daily_letters(DailyLetterListRequest {
            scope: Some(scope),
            workspace_path: request.workspace_path,
            limit: None,
        })
        .await?;
        return Ok(records.into_iter().find(|record| record.id == id));
    }

    Ok(None)
}

pub(crate) async fn load_daily_letter_record(
    date: &str,
    scope: DailyLetterScope,
    workspace_path: Option<&Path>,
) -> CoreResult<Option<DailyLetterRecord>> {
    let path = daily_letter_record_path(date, scope, workspace_path)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).await?;
    Ok(Some(serde_json::from_str(&content)?))
}

pub(crate) async fn save_daily_letter_record(record: &DailyLetterRecord) -> CoreResult<()> {
    let workspace_path = record
        .workspace
        .as_ref()
        .map(|workspace| Path::new(&workspace.path));
    let json_path = daily_letter_record_path(&record.date, record.scope, workspace_path)?;
    if let Some(parent) = json_path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let content = serde_json::to_string_pretty(record)?;
    fs::write(&json_path, content).await.map_err(|error| {
        CoreError::service(format!(
            "Failed to write daily letter record {}: {}",
            json_path.display(),
            error
        ))
    })?;

    let markdown_path = daily_letter_markdown_path(&record.date, record.scope, workspace_path)?;
    fs::write(&markdown_path, render_daily_letter_markdown(record))
        .await
        .map_err(|error| {
            CoreError::service(format!(
                "Failed to write daily letter markdown {}: {}",
                markdown_path.display(),
                error
            ))
        })?;
    Ok(())
}

fn render_daily_letter_markdown(record: &DailyLetterRecord) -> String {
    let mut out = String::new();
    out.push_str("---\n");
    out.push_str(&format!("id: {}\n", record.id));
    out.push_str(&format!("date: {}\n", record.date));
    out.push_str(&format!(
        "scope: {}\n",
        match record.scope {
            DailyLetterScope::AgenticOs => "agentic_os",
            DailyLetterScope::Workspace => "workspace",
        }
    ));
    if let Some(workspace) = record.workspace.as_ref() {
        out.push_str(&format!(
            "workspace: {}\n",
            workspace.path.replace('\\', "/")
        ));
    }
    out.push_str("---\n\n");
    out.push_str(&format!("# {}\n\n", record.preview.title.trim()));
    out.push_str(record.body_markdown.trim());
    out.push_str("\n\n");

    if !record.receipt_candidates.is_empty() {
        out.push_str("## 回执\n\n");
        for item in &record.receipt_candidates {
            out.push_str(&format!(
                "- [{}] {}\n",
                receipt_status_label(item.status),
                item.text
            ));
        }
        out.push('\n');
    }

    if !record.continuation_cards.is_empty() {
        out.push_str("## 明日可拾\n\n");
        for item in &record.continuation_cards {
            out.push_str(&format!("- {}\n", item.text));
        }
        out.push('\n');
    }

    if let Some(app) = record.app_opportunity.as_ref() {
        out.push_str("## P.S.\n\n");
        out.push_str(&format!(
            "**{}**\n\n{}\n",
            app.title.trim(),
            app.summary.trim()
        ));
    }

    out
}

fn receipt_status_label(status: super::types::DailyLetterReceiptStatus) -> &'static str {
    match status {
        super::types::DailyLetterReceiptStatus::Pending => "待回执",
        super::types::DailyLetterReceiptStatus::Accepted => "已采纳",
        super::types::DailyLetterReceiptStatus::Edited => "已修订",
        super::types::DailyLetterReceiptStatus::Dismissed => "已略过",
    }
}

pub(crate) fn path_string(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().replace('\\', "/")
}
