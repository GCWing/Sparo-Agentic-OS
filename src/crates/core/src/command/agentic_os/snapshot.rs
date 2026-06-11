use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::agent_app::AgentAppManager;
use crate::agentic::core::SessionKind;
use crate::agentic::persistence::PersistenceManager;
use crate::agentic_os::work::{default_work_store, WorkProjection};
use crate::bridge_app::BridgeAppManager;
use crate::infrastructure::try_get_path_manager_arc;
use crate::live_app::LiveAppManager;
use crate::service::config::types::AIConfig;
use crate::service::workspace::get_global_workspace_service;

use super::super::{CommandContext, CommandError, CommandResult};

#[derive(Debug, Clone, Deserialize)]
pub struct AgenticOsSnapshotRequest {
    pub workspace_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct AgenticOsSnapshot {
    pub model: String,
    pub current_workspace: Option<String>,
    pub git_branch: Option<String>,
    pub sessions: Vec<AgenticOsSessionRow>,
    pub works: Vec<AgenticOsWorkRow>,
    pub apps: Vec<AgenticOsAppRow>,
    pub memories: Vec<AgenticOsMemoryRow>,
    pub workspaces: Vec<AgenticOsWorkspaceRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsSessionRow {
    pub id: String,
    pub title: String,
    pub agent: String,
    pub workspace: Option<String>,
    pub parent_session_id: Option<String>,
    pub is_dispatch_task: bool,
    pub turns: usize,
    pub child_count: usize,
    pub last_active_at: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsWorkRow {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub status: String,
    pub objective: String,
    pub workspace: Option<String>,
    pub updated_at: i64,
    pub primary_surface: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsAppRow {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub description: String,
    pub capability: String,
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsMemoryRow {
    pub scope: String,
    pub file: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgenticOsWorkspaceRow {
    pub label: String,
    pub path: Option<String>,
    pub git: Option<String>,
    pub session_count: usize,
}

pub async fn get_snapshot(
    ctx: &CommandContext,
    request: AgenticOsSnapshotRequest,
) -> CommandResult<AgenticOsSnapshot> {
    let model = load_default_model(ctx).await;
    get_snapshot_with_model(request, model).await
}

pub async fn get_snapshot_without_config(
    request: AgenticOsSnapshotRequest,
) -> CommandResult<AgenticOsSnapshot> {
    get_snapshot_with_model(request, "primary".to_string()).await
}

async fn get_snapshot_with_model(
    request: AgenticOsSnapshotRequest,
    model: String,
) -> CommandResult<AgenticOsSnapshot> {
    let current_workspace = request.workspace_hint.or_else(|| {
        std::env::current_dir()
            .ok()
            .map(|path| path.to_string_lossy().to_string())
    });
    let mut snapshot = AgenticOsSnapshot {
        model,
        git_branch: current_workspace
            .as_ref()
            .and_then(|workspace| git_branch_for_path(Path::new(workspace))),
        current_workspace,
        ..Default::default()
    };

    snapshot.workspaces = load_workspaces().await;
    snapshot.sessions = load_sessions_for_snapshot(&snapshot.workspaces).await?;
    annotate_session_relationships(&mut snapshot.sessions);
    for workspace in &mut snapshot.workspaces {
        workspace.session_count = snapshot
            .sessions
            .iter()
            .filter(|session| session.workspace == workspace.path)
            .count();
    }
    snapshot.works = load_works().await?;
    snapshot.apps = load_apps().await;
    snapshot.memories = load_memories(snapshot.current_workspace.as_deref()).await;

    Ok(snapshot)
}

async fn load_default_model(ctx: &CommandContext) -> String {
    let ai: AIConfig = ctx
        .config_service()
        .get_config(Some("ai"))
        .await
        .unwrap_or_default();
    let model_ref = ai
        .default_models
        .primary
        .or_else(|| ai.models.iter().find(|m| m.enabled).map(|m| m.id.clone()));

    model_ref
        .as_deref()
        .and_then(|model_ref| {
            ai.models
                .iter()
                .find(|model| {
                    model.id == model_ref
                        || model.name == model_ref
                        || model.model_name == model_ref
                })
                .map(|model| {
                    if !model.model_name.trim().is_empty() {
                        model.model_name.clone()
                    } else if !model.name.trim().is_empty() {
                        model.name.clone()
                    } else {
                        model.id.clone()
                    }
                })
        })
        .or(model_ref)
        .unwrap_or_else(|| "primary".to_string())
}

async fn load_workspaces() -> Vec<AgenticOsWorkspaceRow> {
    let mut rows = vec![AgenticOsWorkspaceRow {
        label: "global".to_string(),
        path: None,
        git: None,
        session_count: 0,
    }];

    if let Some(service) = get_global_workspace_service() {
        let mut candidates = service.list_workspace_routing_candidates().await;
        candidates.sort_by(|left, right| {
            right
                .last_accessed
                .cmp(&left.last_accessed)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
                .then_with(|| left.id.cmp(&right.id))
        });
        rows.extend(
            candidates
                .into_iter()
                .map(|workspace| AgenticOsWorkspaceRow {
                    label: workspace.name,
                    git: git_branch_for_path(&workspace.root_path),
                    path: Some(workspace.root_path.to_string_lossy().to_string()),
                    session_count: 0,
                }),
        );
    }

    if rows.len() == 1 {
        if let Ok(current) = std::env::current_dir() {
            rows.push(AgenticOsWorkspaceRow {
                label: current
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("current")
                    .to_string(),
                git: git_branch_for_path(&current),
                path: Some(current.to_string_lossy().to_string()),
                session_count: 0,
            });
        }
    }

    rows
}

async fn load_sessions_for_snapshot(
    workspaces: &[AgenticOsWorkspaceRow],
) -> CommandResult<Vec<AgenticOsSessionRow>> {
    let path_manager = try_get_path_manager_arc().map_err(CommandError::session)?;
    let manager = PersistenceManager::new(path_manager.clone()).map_err(CommandError::session)?;

    let mut rows = Vec::new();
    for workspace in workspaces {
        let storage_path = workspace
            .path
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| path_manager.agentic_os_runtime_root());
        let metadata = manager
            .list_session_metadata(&storage_path)
            .await
            .map_err(CommandError::session)?;
        for session in metadata
            .into_iter()
            .filter(|item| !item.should_hide_from_user_lists())
        {
            let parent_session_id = session
                .created_by
                .as_deref()
                .and_then(|created_by| created_by.strip_prefix("session-"))
                .map(str::to_string);
            let is_dispatch_task = parent_session_id.is_some()
                && matches!(session.session_kind, SessionKind::Standard);
            rows.push(AgenticOsSessionRow {
                id: session.session_id,
                title: session.session_name,
                agent: session.agent_type,
                workspace: workspace.path.clone(),
                parent_session_id,
                is_dispatch_task,
                turns: session.turn_count,
                child_count: 0,
                last_active_at: session.last_active_at,
            });
        }
    }

    rows.sort_by(|a, b| b.last_active_at.cmp(&a.last_active_at));
    Ok(rows)
}

fn annotate_session_relationships(sessions: &mut [AgenticOsSessionRow]) {
    let mut child_counts = std::collections::HashMap::<String, usize>::new();
    for session in sessions.iter() {
        if let Some(parent_id) = &session.parent_session_id {
            *child_counts.entry(parent_id.clone()).or_default() += 1;
        }
    }

    for session in sessions.iter_mut() {
        session.child_count = child_counts.remove(&session.id).unwrap_or_default();
    }
}

async fn load_works() -> CommandResult<Vec<AgenticOsWorkRow>> {
    let store = default_work_store().map_err(CommandError::session)?;
    let records = store.list().await.map_err(CommandError::session)?;
    Ok(records
        .iter()
        .map(WorkProjection::from)
        .map(|projection| AgenticOsWorkRow {
            id: projection.id.to_string(),
            title: projection.title,
            kind: format!("{:?}", projection.kind),
            status: format!("{:?}", projection.status),
            objective: projection.objective,
            workspace: projection.scope.workspace_path().map(str::to_string),
            updated_at: projection.updated_at,
            primary_surface: serde_json::to_value(projection.primary_surface)
                .unwrap_or_else(|_| serde_json::json!({})),
        })
        .collect())
}

async fn load_apps() -> Vec<AgenticOsAppRow> {
    let mut rows = Vec::new();

    if let Ok(apps) = AgentAppManager::list(None) {
        rows.extend(apps.into_iter().map(|app| AgenticOsAppRow {
            id: app.id,
            name: app.name,
            kind: "AGENT APP".to_string(),
            description: app.description,
            capability: app.tools.join(" "),
            target: Some(app.path),
        }));
    }

    if let Ok(apps) = BridgeAppManager::list() {
        rows.extend(apps.into_iter().map(|app| AgenticOsAppRow {
            id: app.manifest.id,
            name: app.manifest.name,
            kind: "BRIDGE APP".to_string(),
            description: app.manifest.description,
            capability: format!("{:?}", app.manifest.runtime.language),
            target: Some(app.path),
        }));
    }

    if let Ok(path_manager) = try_get_path_manager_arc() {
        let manager = LiveAppManager::new(path_manager);
        if let Ok(apps) = manager.list().await {
            rows.extend(apps.into_iter().map(|app| AgenticOsAppRow {
                id: app.id,
                name: app.name,
                kind: "LIVE APP".to_string(),
                description: app.description,
                capability: app.category,
                target: None,
            }));
        }
    }

    rows
}

async fn load_memories(workspace: Option<&str>) -> Vec<AgenticOsMemoryRow> {
    let Ok(path_manager) = try_get_path_manager_arc() else {
        return Vec::new();
    };
    let mut rows = collect_memory_dir("GLOBAL", path_manager.agentic_os_memory_dir()).await;
    if let Some(workspace) = workspace {
        rows.extend(
            collect_memory_dir(
                "PROJECT",
                path_manager.workspace_memory_dir(Path::new(workspace)),
            )
            .await,
        );
    }
    rows
}

async fn collect_memory_dir(scope: &str, dir: PathBuf) -> Vec<AgenticOsMemoryRow> {
    let mut rows = Vec::new();
    let Ok(mut entries) = tokio::fs::read_dir(&dir).await else {
        return rows;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".md") || name.ends_with(".jsonl") {
            rows.push(AgenticOsMemoryRow {
                scope: scope.to_string(),
                file: name,
                target: dir.to_string_lossy().to_string(),
            });
        }
    }
    rows
}

fn git_branch_for_path(path: &Path) -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!branch.is_empty()).then_some(format!("git {}", branch))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_uses_works_field() {
        let snapshot = AgenticOsSnapshot::default();
        let value = serde_json::to_value(snapshot).expect("serialize");
        assert!(value.get("works").is_some());
        assert!(value.get("tasks").is_none());
    }
}
