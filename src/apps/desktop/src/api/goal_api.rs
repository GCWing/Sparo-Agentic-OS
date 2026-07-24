use sparo_core::agentic::goal::{
    GoalControlRequest, GoalEditRequest, GoalResponse, GoalService, GoalStatusRequest,
    GoalUserRequest,
};
use sparo_core::agentic::{coordination::DialogScheduler, core::SessionDomain};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn submit_session_goal(
    goal_service: State<'_, Arc<GoalService>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: GoalUserRequest,
) -> Result<GoalResponse, String> {
    if !is_goal_command(&request.raw_input) {
        return Err("submit_session_goal requires a /goal command".to_string());
    }
    if is_agentic_os_goal_unsupported(
        &scheduler,
        &request.session_id,
        request.agent_type.as_deref().unwrap_or_default(),
    ) {
        return Err("Goal mode is not supported in Agentic OS sessions".to_string());
    }

    let fallback_status = GoalStatusRequest {
        session_id: request.session_id.clone(),
        workspace_path: request.workspace_path.clone(),
    };

    match goal_service
        .handle_text_intake(request)
        .await
        .map_err(|error| error.to_string())?
    {
        Some(response) => Ok(response),
        None => goal_service
            .status(fallback_status)
            .await
            .map_err(|error| error.to_string()),
    }
}

#[tauri::command]
pub async fn get_session_goal(
    goal_service: State<'_, Arc<GoalService>>,
    request: GoalStatusRequest,
) -> Result<GoalResponse, String> {
    goal_service
        .status(request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn control_session_goal(
    goal_service: State<'_, Arc<GoalService>>,
    request: GoalControlRequest,
) -> Result<GoalResponse, String> {
    goal_service
        .control(request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_session_goal(
    goal_service: State<'_, Arc<GoalService>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: GoalEditRequest,
) -> Result<GoalResponse, String> {
    if is_agentic_os_goal_unsupported(
        &scheduler,
        &request.session_id,
        request.agent_type.as_deref().unwrap_or_default(),
    ) {
        return Err("Goal mode is not supported in Agentic OS sessions".to_string());
    }

    goal_service
        .update_from_user_edit(request)
        .await
        .map_err(|error| error.to_string())
}

fn is_goal_command(raw_input: &str) -> bool {
    let trimmed = raw_input.trim_start();
    trimmed
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("/goal"))
        && trimmed
            .chars()
            .nth(5)
            .map(|ch| ch.is_whitespace())
            .unwrap_or(true)
}

fn is_agentic_os_goal_unsupported(
    scheduler: &DialogScheduler,
    session_id: &str,
    requested_agent_type: &str,
) -> bool {
    if is_agentic_os_agent_type(requested_agent_type) {
        return true;
    }

    scheduler
        .session_manager()
        .get_session(session_id)
        .is_some_and(|session| {
            matches!(session.config.domain, SessionDomain::OsAgent)
                || is_agentic_os_agent_type(&session.agent_type)
        })
}

fn is_agentic_os_agent_type(agent_type: &str) -> bool {
    matches!(
        agent_type.trim().to_ascii_lowercase().as_str(),
        "osagent" | "os-agent" | "os_agent" | "dispatcher"
    )
}
