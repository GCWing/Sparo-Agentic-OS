//! System API

use crate::api::app_state::AppState;
use bitfun_core::service::system;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfoResponse {
    pub platform: String,
    pub arch: String,
    pub os_version: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MainWindowCloseIntentResponse {
    pub will_exit: bool,
    pub close_to_tray: bool,
}

#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfoResponse, String> {
    let info = system::get_system_info();

    Ok(SystemInfoResponse {
        platform: info.platform,
        arch: info.arch,
        os_version: info.os_version,
    })
}

#[tauri::command]
pub async fn get_main_window_close_intent() -> Result<MainWindowCloseIntentResponse, String> {
    use bitfun_core::service::config::{get_global_config_service, GlobalConfig};

    let close_to_tray = if let Ok(service) = get_global_config_service().await {
        service
            .get_config::<GlobalConfig>(None)
            .await
            .map(|config| config.app.tray.close_to_tray)
            .unwrap_or(true)
    } else {
        true
    };
    let will_exit = crate::wants_exit() || !close_to_tray;

    Ok(MainWindowCloseIntentResponse {
        will_exit,
        close_to_tray,
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckCommandResponse {
    pub exists: bool,
    pub path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCommandRequest {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<Vec<EnvVar>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutputResponse {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMacosEditMenuModeRequest {
    pub mode: crate::macos_menubar::EditMenuMode,
}

#[tauri::command]
pub async fn check_command_exists(command: String) -> Result<CheckCommandResponse, String> {
    let result = system::check_command(&command);

    Ok(CheckCommandResponse {
        exists: result.exists,
        path: result.path,
    })
}

#[tauri::command]
pub async fn check_commands_exist(
    commands: Vec<String>,
) -> Result<Vec<(String, CheckCommandResponse)>, String> {
    let cmd_refs: Vec<&str> = commands.iter().map(|s| s.as_str()).collect();
    let results = system::check_commands(&cmd_refs);

    Ok(results
        .into_iter()
        .map(|(name, result)| {
            (
                name,
                CheckCommandResponse {
                    exists: result.exists,
                    path: result.path,
                },
            )
        })
        .collect())
}

#[tauri::command]
pub async fn run_system_command(
    request: RunCommandRequest,
) -> Result<CommandOutputResponse, String> {
    let env_vars: Option<Vec<(String, String)>> = request
        .env
        .map(|vars| vars.into_iter().map(|v| (v.key, v.value)).collect());

    let env_ref: Option<&[(String, String)]> = env_vars.as_deref();

    let result = system::run_command(
        &request.command,
        &request.args,
        request.cwd.as_deref(),
        env_ref,
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(CommandOutputResponse {
        exit_code: result.exit_code,
        stdout: result.stdout,
        stderr: result.stderr,
        success: result.success,
    })
}

#[tauri::command]
pub async fn set_macos_edit_menu_mode(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    request: SetMacosEditMenuModeRequest,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let current_mode = *state.macos_edit_menu_mode.read().await;
        if current_mode == request.mode {
            return Ok(());
        }

        {
            let mut edit_mode = state.macos_edit_menu_mode.write().await;
            *edit_mode = request.mode;
        }

        let language = state
            .config_service
            .get_config::<String>(Some("app.language"))
            .await
            .unwrap_or_else(|_| "zh-CN".to_string());
        let menubar_mode = if state.workspace_path.read().await.is_some() {
            crate::macos_menubar::MenubarMode::Workspace
        } else {
            crate::macos_menubar::MenubarMode::Startup
        };

        crate::macos_menubar::set_macos_menubar_with_mode(
            &app,
            &language,
            menubar_mode,
            request.mode,
        )
        .map_err(|error| error.to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&state, &app, &request);
    }

    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendNotificationRequest {
    pub title: String,
    pub body: Option<String>,
}

/// Send an OS-level desktop notification (Windows toast / macOS notification center).
#[tauri::command]
pub async fn send_system_notification(
    app: tauri::AppHandle,
    request: SendNotificationRequest,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    let mut builder = app.notification().builder().title(&request.title);
    if let Some(body) = &request.body {
        builder = builder.body(body);
    }
    builder.show().map_err(|e| e.to_string())
}
