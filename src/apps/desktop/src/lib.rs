#![allow(non_snake_case)]
//! Sparo OS desktop shell — orchestration only.
//!
//! Workflow (see `bootstrap/` for details of each stage):
//!
//! ```text
//!   ┌──────────── main() (sync, ≤3 lines) ────────────┐
//!   │ Stage A: panic hook + LogConfig + tracing       │
//!   │ Stage B: tauri::Builder.setup()                 │
//!   │   • declarative main window (visible:false)     │
//!   │   • tray skeleton menu                          │
//!   │   • transport + event loop                      │
//!   │   • spawn Stage C, then Stage D                 │
//!   │ run() — Tauri event loop owns main thread       │
//!   └─────────────────────────────────────────────────┘
//! ```

pub mod api;
pub mod bootstrap;
pub mod computer_use;
pub mod frontend_runtime_watchdog;
pub mod logging;
pub mod macos_menubar;
pub mod theme;
pub mod tray;
pub mod window;

use bitfun_core::infrastructure::constants::{
    APP_PRODUCT_NAME, EVENT_SYSTEM_NOTIFICATION, WINDOW_MAIN,
};
use bitfun_transport::TauriTransportAdapter;
use serde::Deserialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Emitter, Manager};

use api::clipboard_file_api::*;
use api::commands::*;
use api::computer_use_api::*;
use api::config_api::*;
use api::cron_api::*;
use api::diff_api::*;
use api::global_milestone_api::*;
use api::host_scan_api::*;
use api::i18n_api::*;
use api::mcp_api::*;
use api::memory_consolidation_api::*;
use api::project_detection_api::*;
use api::runtime_api::*;
use api::session_api::*;
use api::skill_api::*;
use api::snapshot_service::*;
use api::storage_commands::*;
use api::subagent_api::*;
use api::system_api::*;
use api::tool_api::*;
use api::workspace_overview_api::*;
pub use api::*;

use bootstrap::{AppContainer, BootStage};

// ─────────────────────────────────────────────── Quit-vs-hide signal ───

/// Set this to true before triggering a close event to indicate the user
/// actually wants to quit (vs just hiding the window to the tray).
static WANTS_EXIT: AtomicBool = AtomicBool::new(false);

pub fn set_wants_exit() {
    WANTS_EXIT.store(true, Ordering::SeqCst);
}

fn wants_exit() -> bool {
    WANTS_EXIT.load(Ordering::SeqCst)
}

/// Coordinator state still exposed via `.manage` for code paths that take a
/// `tauri::State<CoordinatorState>` argument.
#[derive(Clone)]
pub struct CoordinatorState {
    pub coordinator: Arc<bitfun_core::agentic::coordination::ConversationCoordinator>,
}

/// Dialog scheduler state, primary entry point for user messages.
#[derive(Clone)]
pub struct SchedulerState {
    pub scheduler: Arc<bitfun_core::agentic::coordination::DialogScheduler>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebdriverBridgeResultRequest {
    payload: serde_json::Value,
}

#[tauri::command]
async fn webdriver_bridge_result(request: WebdriverBridgeResultRequest) -> Result<(), String> {
    log::debug!("webdriver_bridge_result command invoked");
    bitfun_webdriver::handle_bridge_result(request.payload)
}

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

// ─────────────────────────────────────────────── Tauri entrypoint ───

/// Tauri application entry point. Called from `main()`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    bootstrap::panic::install();

    let in_debug = cfg!(debug_assertions) || std::env::var("DEBUG").unwrap_or_default() == "1";
    let log_config = logging::LogConfig::new(in_debug);
    let log_targets = logging::build_log_targets(&log_config);
    let session_log_dir = log_config.session_log_dir.clone();
    let startup_level = log_config.level;

    eprintln!("=== {} starting ===", APP_PRODUCT_NAME);

    let boot = bootstrap::BootController::new();
    let container = AppContainer::new(boot.clone());
    container.startup_log_level.store(Arc::new(startup_level));

    let path_manager = bitfun_core::infrastructure::get_path_manager_arc();

    let container_setup = container.clone();
    let container_close = container.clone();

    let run_result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(
            move |app, _args, _cwd| {
                if let Some(window) = app.get_webview_window(WINDOW_MAIN) {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            },
        ))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(logging::build_log_plugin(log_targets))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name(APP_PRODUCT_NAME)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .manage(container.clone())
        .manage(path_manager)
        .setup(move |app| {
            let app_handle = app.handle().clone();
            container_setup.boot.attach_app(app_handle.clone());

            app.on_menu_event(|app, event| {
                let _ = crate::window::companion_window::handle_context_menu_event(
                    app,
                    event.id().as_ref(),
                );
            });

            #[cfg(target_os = "macos")]
            {
                app.on_menu_event(|app, event| {
                    let event_name =
                        crate::macos_menubar::menu_event_name_for_id(event.id().as_ref());
                    if let Some(event_name) = event_name {
                        let _ = app.emit(event_name, ());
                    }
                });
            }

            logging::register_runtime_log_state(startup_level, session_log_dir.clone());

            register_bundled_mobile_web(&app_handle);

            if let Err(e) = window::main_window::configure(&app_handle) {
                log::error!("Failed to configure main window: {}", e);
            }

            if let Err(e) = tray::init_tray(&app_handle) {
                log::warn!("Failed to initialize system tray: {}", e);
            }
            frontend_runtime_watchdog::start(app_handle.clone());

            let transport = Arc::new(TauriTransportAdapter::new(app_handle.clone()));
            container_setup.set_transport(transport.clone());
            container_setup.boot.transition(BootStage::WindowReady);

            spawn_boot_pipeline(
                container_setup.clone(),
                app_handle.clone(),
                transport.clone(),
            );

            api::remote_connect_api::init_on_startup();
            logging::spawn_log_cleanup_task();

            Ok(())
        })
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == WINDOW_MAIN {
                    handle_main_close(window, api, container_close.clone());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Boot stage IPC
            api::boot_api::get_boot_stage,
            api::boot_api::get_boot_history,
            // Window control
            crate::window::main_window::show_main_window,
            crate::window::companion_window::show_agent_companion_desktop_pet,
            crate::window::companion_window::hide_agent_companion_desktop_pet,
            crate::window::companion_window::resize_agent_companion_desktop_pet,
            crate::window::companion_window::show_agent_companion_context_menu,
            // Agentic
            api::agentic_api::create_session,
            api::agentic_api::update_session_model,
            api::agentic_api::update_session_title,
            api::agentic_api::ensure_coordinator_session,
            api::agentic_api::start_dialog_turn,
            api::agentic_api::compact_session,
            api::agentic_api::cancel_dialog_turn,
            api::agentic_api::delete_session,
            api::agentic_api::restore_session,
            webdriver_bridge_result,
            api::agentic_api::list_sessions,
            api::agentic_api::confirm_tool_execution,
            api::agentic_api::reject_tool_execution,
            api::agentic_api::cancel_tool,
            api::agentic_api::generate_session_title,
            api::agentic_api::list_agents,
            api::agentic_os_api::agentic_os_list_works,
            api::agentic_os_api::agentic_os_get_work,
            api::agentic_os_api::agentic_os_create_work,
            api::agentic_os_api::agentic_os_start_work,
            api::agentic_os_api::agentic_os_update_work,
            api::agentic_os_api::agentic_os_dispatch_work,
            api::agentic_os_api::agentic_os_advance_work,
            api::agentic_os_api::agentic_os_control_work,
            api::token_usage_api::get_token_usage,
            api::token_usage_api::clear_token_usage,
            api::agent_app_api::list_agent_apps,
            api::agent_app_api::get_agent_app,
            api::agent_app_api::create_agent_app,
            api::agent_app_api::update_agent_app,
            api::agent_app_api::delete_agent_app,
            api::agent_app_api::reload_agent_apps,
            api::agent_app_api::validate_agent_app_package,
            api::agent_app_api::create_agent_app_js_tool,
            api::agent_app_api::test_agent_app_js_tool,
            api::agent_app_api::export_agent_app,
            api::agent_app_api::import_agent_app,
            api::app_catalog_api::list_app_catalog,
            api::bridge_app_api::list_bridge_apps,
            api::bridge_app_api::get_bridge_app,
            api::bridge_app_api::validate_bridge_app_package,
            api::bridge_app_api::create_bridge_app,
            api::bridge_app_api::update_bridge_app,
            api::bridge_app_api::import_bridge_app_from_path,
            api::bridge_app_api::delete_bridge_app,
            api::bridge_app_api::run_bridge_app_action,
            api::bridge_app_api::list_bridge_app_runs,
            api::bridge_app_api::get_bridge_app_run,
            api::bridge_app_api::cancel_bridge_app_run,
            api::bridge_app_api::get_bridge_app_run_artifacts,
            api::bridge_app_api::stream_bridge_app_run_events,
            api::btw_api::btw_ask_stream,
            api::btw_api::btw_cancel,
            api::markdown_ai_api::markdown_ai_propose_edits,
            api::markdown_ai_api::markdown_ai_cancel,
            api::context_upload_api::upload_image_contexts,
            get_all_tools_info,
            get_readonly_tools_info,
            get_tool_info,
            validate_tool_input,
            execute_tool,
            is_tool_enabled,
            submit_user_answers,
            initialize_global_state,
            get_available_tools,
            report_ide_control_result,
            get_health_status,
            get_statistics,
            test_ai_connection,
            test_ai_config_connection,
            list_ai_models_by_config,
            discover_cli_credentials,
            refresh_cli_credential,
            initialize_ai,
            set_agent_model,
            get_agent_models,
            refresh_model_client,
            fix_mermaid_code,
            get_app_state,
            update_app_status,
            read_file_content,
            list_agent_companion_pets,
            import_agent_companion_pet_package,
            delete_agent_companion_pet_package,
            write_file_content,
            check_path_exists,
            get_file_metadata,
            get_file_editor_sync_hash,
            rename_file,
            export_local_file_to_path,
            reveal_in_explorer,
            system_fs_list_drives,
            system_fs_list_quick_folders,
            system_fs_list_dir,
            system_fs_stat,
            system_fs_create_file,
            system_fs_create_dir,
            system_fs_delete,
            system_fs_rename,
            system_fs_reveal_in_os,
            system_fs_open_with_default,
            file_workbench_plan_operations,
            file_workbench_execute_plan,
            file_workbench_audit_list,
            file_workbench_restore_audit_item,
            pinned_list,
            pinned_add,
            pinned_remove,
            pinned_reorder,
            stash_files_context,
            get_file_tree,
            explorer_get_file_tree,
            get_directory_children,
            explorer_get_children,
            get_directory_children_paginated,
            explorer_get_children_paginated,
            search_files,
            search_filenames,
            search_file_contents,
            start_search_filenames_stream,
            start_search_file_contents_stream,
            cancel_search,
            delete_file,
            delete_directory,
            create_file,
            create_directory,
            list_directory_files,
            start_file_watch,
            stop_file_watch,
            get_watched_paths,
            get_clipboard_files,
            paste_files,
            get_config,
            computer_use_get_status,
            computer_use_request_permissions,
            computer_use_open_system_settings,
            set_config,
            reset_config,
            export_config,
            import_config,
            validate_config,
            reload_config,
            sync_config_to_global,
            get_global_config_health,
            get_runtime_logging_info,
            get_agent_capability_profile,
            update_agent_capability_profile,
            get_runtime_capabilities,
            api::runtime_api::record_frontend_runtime_heartbeat,
            api::runtime_api::get_frontend_runtime_watchdog_snapshot,
            api::runtime_api::disable_frontend_runtime_safe_mode,
            get_agent_capability_configs,
            get_agent_capability_config,
            set_agent_capability_config,
            reset_agent_capability_config,
            get_subagent_configs,
            set_subagent_config,
            list_subagents,
            get_subagent_detail,
            delete_subagent,
            create_subagent,
            update_subagent,
            reload_subagents,
            list_agent_tool_names,
            update_subagent_config,
            get_agent_subagent_configs,
            replace_agent_subagent_selection,
            get_skill_configs,
            get_agent_skill_configs,
            list_skill_market,
            search_skill_market,
            download_skill_market,
            set_agent_skill_disabled,
            replace_agent_skill_selection,
            validate_skill_path,
            add_skill,
            delete_skill,
            compute_diff,
            apply_patch,
            save_merged_diff_content,
            initialize_snapshot,
            record_file_change,
            rollback_session,
            rollback_to_turn,
            accept_session,
            accept_file,
            reject_file,
            get_session_files,
            get_session_turns,
            get_turn_files,
            get_file_diff,
            get_operation_diff,
            get_operation_summary,
            get_session_operations,
            accept_operation,
            reject_operation,
            get_session_stats,
            get_snapshot_system_stats,
            get_snapshot_sessions,
            check_git_isolation,
            get_file_change_history,
            get_all_modified_files,
            get_baseline_snapshot_diff,
            get_storage_paths,
            get_workspace_storage_paths,
            cleanup_storage,
            cleanup_storage_with_policy,
            get_storage_statistics,
            initialize_workspace_storage,
            reset_application_data,
            get_context_budget,
            list_persisted_sessions,
            load_session_turns,
            save_session_turn,
            save_session_metadata,
            export_session_transcript,
            delete_persisted_session,
            touch_session_activity,
            load_persisted_session_metadata,
            fork_session,
            initialize_mcp_servers,
            api::mcp_api::initialize_mcp_servers_non_destructive,
            get_mcp_servers,
            api::mcp_api::list_mcp_resources,
            api::mcp_api::read_mcp_resource,
            api::mcp_api::list_mcp_prompts,
            api::mcp_api::get_mcp_prompt,
            start_mcp_server,
            stop_mcp_server,
            restart_mcp_server,
            get_mcp_server_status,
            load_mcp_json_config,
            save_mcp_json_config,
            get_mcp_tool_ui_uri,
            fetch_mcp_app_resource,
            send_mcp_app_message,
            submit_mcp_interaction_response,
            update_mcp_remote_auth,
            clear_mcp_remote_auth,
            api::mcp_api::delete_mcp_server,
            api::mcp_api::start_mcp_remote_oauth,
            api::mcp_api::get_mcp_remote_oauth_session,
            api::mcp_api::cancel_mcp_remote_oauth,
            detect_project,
            reload_global_config,
            get_global_config_status,
            subscribe_config_updates,
            get_model_configs,
            get_recent_workspaces,
            remove_recent_workspace,
            cleanup_invalid_workspaces,
            get_opened_workspaces,
            open_workspace,
            close_workspace,
            remember_workspace,
            reorder_opened_workspaces,
            get_last_used_workspace,
            scan_workspace_info,
            list_cron_jobs,
            create_cron_job,
            update_cron_job,
            delete_cron_job,
            run_host_scan,
            run_global_milestone,
            run_memory_consolidation,
            list_workspace_overview_bindings,
            run_workspace_overview_refresh,
            api::config_api::canonicalize_agent_capability_configs,
            api::terminal_api::terminal_get_shells,
            api::terminal_api::terminal_create,
            api::terminal_api::terminal_get,
            api::terminal_api::terminal_list,
            api::terminal_api::terminal_close,
            api::terminal_api::terminal_write,
            api::terminal_api::terminal_resize,
            api::terminal_api::terminal_signal,
            api::terminal_api::terminal_ack,
            api::terminal_api::terminal_execute,
            api::terminal_api::terminal_send_command,
            api::terminal_api::terminal_has_shell_integration,
            api::terminal_api::terminal_shutdown_all,
            api::terminal_api::terminal_get_history,
            get_system_info,
            send_system_notification,
            check_command_exists,
            check_commands_exist,
            run_system_command,
            set_macos_edit_menu_mode,
            i18n_get_current_language,
            i18n_set_language,
            i18n_get_supported_languages,
            i18n_get_config,
            i18n_set_config,
            // Remote Connect
            api::remote_connect_api::remote_connect_get_device_info,
            api::remote_connect_api::remote_connect_get_lan_ip,
            api::remote_connect_api::remote_connect_get_lan_network_info,
            api::remote_connect_api::remote_connect_get_methods,
            api::remote_connect_api::remote_connect_start,
            api::remote_connect_api::remote_connect_stop,
            api::remote_connect_api::remote_connect_stop_bot,
            api::remote_connect_api::remote_connect_status,
            api::remote_connect_api::remote_connect_get_form_state,
            api::remote_connect_api::remote_connect_set_form_state,
            api::remote_connect_api::remote_connect_configure_custom_server,
            api::remote_connect_api::remote_connect_configure_bot,
            api::remote_connect_api::remote_connect_weixin_qr_start,
            api::remote_connect_api::remote_connect_weixin_qr_poll,
            api::remote_connect_api::remote_connect_get_bot_verbose_mode,
            api::remote_connect_api::remote_connect_set_bot_verbose_mode,
            // Live App API
            api::live_app_api::list_live_apps,
            api::live_app_api::list_recent_live_apps,
            api::live_app_api::record_recent_live_app,
            api::live_app_api::get_live_app,
            api::live_app_api::create_live_app,
            api::live_app_api::update_live_app,
            api::live_app_api::delete_live_app,
            api::live_app_api::get_live_app_versions,
            api::live_app_api::rollback_live_app,
            api::live_app_api::get_live_app_storage,
            api::live_app_api::set_live_app_storage,
            api::live_app_api::grant_live_app_workspace,
            api::live_app_api::grant_live_app_path,
            api::live_app_api::live_app_runtime_status,
            api::live_app_api::live_app_worker_call,
            api::live_app_api::live_app_worker_stop,
            api::live_app_api::live_app_worker_list_running,
            api::live_app_api::live_app_install_deps,
            api::live_app_api::live_app_recompile,
            api::live_app_api::live_app_dialog_message,
            api::live_app_api::live_app_import_from_path,
            api::live_app_api::live_app_sync_from_fs,
            api::live_app_api::live_app_report_runtime_issue,
            api::live_app_api::live_app_report_runtime_log,
            api::live_app_api::live_app_clear_runtime_issues,
            api::live_app_api::live_app_capture_matrix,
            api::live_app_api::live_app_ai_complete,
            api::live_app_api::live_app_ai_chat,
            api::live_app_api::live_app_ai_cancel,
            api::live_app_api::live_app_ai_list_models,
            api::live_app_api::live_app_backend_call,
            api::live_app_api::live_app_backend_status,
            api::live_app_api::live_app_backend_cancel_run,
            api::live_app_api::live_app_ppt_turn_assistant_text,
            api::live_app_api::live_app_cancel_stale_ppt_runs,
            api::ppt_live_export_api::live_app_render_slide_page,
            // Browser Control API (CDP-based user browser control)
            api::browser_control_api::browser_control_get_status,
            api::browser_control_api::browser_control_launch,
            api::browser_control_api::browser_control_restart_with_cdp,
            api::browser_control_api::browser_control_create_launcher,
            api::self_control_api::submit_self_control_response,
            // Announcement / feature-demo / tips API
            api::announcement_api::get_pending_announcements,
            api::announcement_api::mark_announcement_seen,
            api::announcement_api::dismiss_announcement,
            api::announcement_api::never_show_announcement,
            api::announcement_api::trigger_announcement,
            api::announcement_api::get_announcement_tips,
        ])
        .run(tauri::generate_context!());

    if let Err(e) = run_result {
        log::error!("Error while running tauri application: {}", e);
        bootstrap::failure::show_native_error_dialog(
            "Sparo OS failed to start",
            &format!("Tauri application loop exited with error:\n\n{}", e),
        );
    }
}

// ─────────────────────────────────────────────── Stage C + D pipeline ───

fn spawn_boot_pipeline(
    container: Arc<AppContainer>,
    app_handle: tauri::AppHandle,
    transport: Arc<TauriTransportAdapter>,
) {
    tauri::async_runtime::spawn(async move {
        let globals = match bootstrap::globals::initialize().await {
            Ok(g) => g,
            Err(e) => {
                log::error!("Stage-C globals failed: {}", e);
                container.boot.fail("globals", e);
                return;
            }
        };
        container.boot.transition(BootStage::GlobalReady);

        // Now config is ready: wire runtime services that depend on it.
        let startup_level = **container.startup_log_level.load();
        spawn_runtime_log_level_listener(startup_level);
        spawn_ingest_server_with_config_listener();
        wire_infrastructure_events(transport.clone()).await;

        // Stage D: agentic + AppState + event loop. We do agentic first because
        // AppState's mcp_service uses the same config; then we publish the
        // transport-fed event loop so events emitted during AppState construction
        // are not lost.
        let agentic =
            match bootstrap::workspace::initialize_agentic(&app_handle, &container, &globals).await
            {
                Ok(a) => a,
                Err(e) => {
                    log::error!("Stage-D agentic init failed: {}", e);
                    container.boot.fail("agentic", e);
                    return;
                }
            };
        container.set_coordinator(agentic.coordinator.clone());
        container.set_scheduler(agentic.scheduler.clone());

        bootstrap::workspace::spawn_event_loop(
            agentic.event_queue.clone(),
            agentic.event_router.clone(),
            transport,
        );

        let app_state = match bootstrap::workspace::initialize_app_state(&container, globals).await
        {
            Ok(s) => s,
            Err(e) => {
                log::error!("Stage-D AppState init failed: {}", e);
                container.boot.fail("app_state", e);
                return;
            }
        };

        // Publish AppState + coordinator/scheduler as Tauri State so existing
        // `#[tauri::command]` handlers can resolve them.
        let workspace_path = app_state.workspace_path.read().await.clone();

        // Hand a clone to Tauri's State map. Every AppState field is an Arc,
        // so the clone shares the same underlying services with the copy held
        // in the container.
        app_handle.manage((*app_state).clone());
        app_handle.manage(CoordinatorState {
            coordinator: agentic.coordinator.clone(),
        });
        app_handle.manage(SchedulerState {
            scheduler: agentic.scheduler.clone(),
        });
        app_handle.manage(agentic.coordinator.clone());
        app_handle.manage(agentic.scheduler.clone());
        app_handle.manage(crate::api::terminal_api::TerminalState::new());

        // Terminal event loop needs an AppHandle clone, not the container.
        {
            let terminal_state_inner = crate::api::terminal_api::TerminalState::new();
            let app_handle_clone = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                crate::api::terminal_api::start_terminal_event_loop(
                    terminal_state_inner,
                    app_handle_clone,
                );
            });
        }

        bitfun_webdriver::maybe_start(app_handle.clone());

        #[cfg(target_os = "macos")]
        macos_menubar_initial_setup(app_handle.clone());

        container.boot.transition(BootStage::WorkspaceReady {
            path: workspace_path.map(|p| p.display().to_string()),
        });

        log::info!("Sparo OS boot complete");
    });
}

#[cfg(target_os = "macos")]
fn macos_menubar_initial_setup(app_handle: tauri::AppHandle) {
    use tauri::Manager;
    tauri::async_runtime::spawn(async move {
        let app_state: tauri::State<'_, api::app_state::AppState> = app_handle.state();
        let language = app_state
            .config_service
            .get_config::<String>(Some("app.language"))
            .await
            .unwrap_or_else(|_| "zh-CN".to_string());
        let has_workspace = app_state.workspace_path.read().await.is_some();
        let mode = if has_workspace {
            crate::macos_menubar::MenubarMode::Workspace
        } else {
            crate::macos_menubar::MenubarMode::Startup
        };
        let edit_mode = *app_state.macos_edit_menu_mode.read().await;
        let _ = crate::macos_menubar::set_macos_menubar_with_mode(
            &app_handle,
            &language,
            mode,
            edit_mode,
        );
    });
}

async fn wire_infrastructure_events(transport: Arc<TauriTransportAdapter>) {
    use bitfun_core::{infrastructure, service};

    let emitter: Arc<dyn infrastructure::events::EventEmitter> =
        Arc::new(infrastructure::events::TransportEmitter::new(transport));

    service::snapshot::initialize_snapshot_event_emitter(emitter.clone());
    service::initialize_file_watch_service(emitter.clone());

    let event_system = infrastructure::events::get_global_event_system();
    event_system.set_emitter(emitter).await;
}

// ─────────────────────────────────────────────── Window close handling ───

fn handle_main_close(
    window: &tauri::Window,
    api: &tauri::CloseRequestApi,
    container: Arc<AppContainer>,
) {
    static CLEANUP_DONE: AtomicBool = AtomicBool::new(false);

    if wants_exit() {
        if CLEANUP_DONE
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            log::info!("Main window close requested with wants_exit, cleaning up");
            bitfun_core::util::process_manager::cleanup_all_processes();
            api::remote_connect_api::cleanup_on_exit();
            window.app_handle().exit(0);
        } else {
            api.prevent_close();
        }
        return;
    }

    let _ = container;
    let app_handle = window.app_handle().clone();
    let window2 = window.clone();
    api.prevent_close();
    tauri::async_runtime::spawn(async move {
        let close_to_tray = read_close_to_tray_pref().await;
        if close_to_tray {
            let _ = window2.hide();
            log::info!("Main window hidden to tray");
            maybe_show_tray_hint(&app_handle).await;
        } else {
            set_wants_exit();
            let _ = window2.close();
        }
    });
}

// ─────────────────────────────────────────────── Misc helpers ───

fn register_bundled_mobile_web(app: &tauri::AppHandle) {
    let candidates = ["mobile-web/dist", "mobile-web", "dist"];
    let mut found = false;
    for candidate in &candidates {
        if let Ok(p) = app
            .path()
            .resolve(candidate, tauri::path::BaseDirectory::Resource)
        {
            if p.join("index.html").exists() {
                log::info!("Found bundled mobile-web at: {}", p.display());
                api::remote_connect_api::set_mobile_web_resource_path(p);
                found = true;
                break;
            }
        }
    }
    if !found {
        if let Ok(res_dir) = app.path().resource_dir() {
            for sub in &["mobile-web/dist", "mobile-web", "dist", ""] {
                let p = if sub.is_empty() {
                    res_dir.clone()
                } else {
                    res_dir.join(sub)
                };
                if p.join("index.html").exists() {
                    log::info!("Found mobile-web via resource root scan: {}", p.display());
                    api::remote_connect_api::set_mobile_web_resource_path(p);
                    break;
                }
            }
        }
    }
}

/// Show a one-time OS notification telling the user the app is in the tray.
async fn maybe_show_tray_hint(app: &tauri::AppHandle) {
    use bitfun_core::service::config::get_global_config_service;
    const HINT_KEY: &str = "app.tray.hide_to_tray_hint_shown";

    let already_shown = if let Ok(config_service) = get_global_config_service().await {
        config_service
            .get_config::<bool>(Some(HINT_KEY))
            .await
            .unwrap_or(false)
    } else {
        return;
    };

    if already_shown {
        return;
    }

    if let Ok(config_service) = get_global_config_service().await {
        let _ = config_service.set_config(HINT_KEY, true).await;
    }

    let _ = app.emit(
        EVENT_SYSTEM_NOTIFICATION,
        serde_json::json!({
            "title": APP_PRODUCT_NAME,
            "body": "Sparo OS is still running in the system tray. Right-click the tray icon to open the menu."
        }),
    );
}

async fn read_close_to_tray_pref() -> bool {
    use bitfun_core::service::config::{get_global_config_service, GlobalConfig};
    if let Ok(svc) = get_global_config_service().await {
        svc.get_config::<GlobalConfig>(None)
            .await
            .map(|c| c.app.tray.close_to_tray)
            .unwrap_or(true)
    } else {
        true
    }
}

// ─────────────────────────────────────────────── Config listeners ───

fn spawn_runtime_log_level_listener(default_level: log::LevelFilter) {
    use bitfun_core::service::config::{subscribe_config_updates, ConfigUpdateEvent};
    tauri::async_runtime::spawn(async move {
        if let Some(mut receiver) = subscribe_config_updates() {
            loop {
                match receiver.recv().await {
                    Ok(ConfigUpdateEvent::LogLevelUpdated { new_level }) => {
                        if let Some(level) = logging::parse_log_level(&new_level) {
                            logging::apply_runtime_log_level(level, "config_update_event");
                        } else {
                            log::warn!(
                                "Received invalid log level from config update event: {}",
                                new_level
                            );
                        }
                    }
                    Ok(ConfigUpdateEvent::ConfigReloaded) => {
                        let level = resolve_runtime_log_level(default_level).await;
                        logging::apply_runtime_log_level(level, "config_reloaded");
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        log::warn!("Log-level listener channel closed, stopping listener");
                        break;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        log::warn!("Log-level listener lagged by {} messages", n);
                    }
                }
            }
        }
    });
}

async fn resolve_runtime_log_level(default_level: log::LevelFilter) -> log::LevelFilter {
    use bitfun_core::service::config::get_global_config_service;
    if let Ok(config_service) = get_global_config_service().await {
        if let Ok(config_level) = config_service
            .get_config::<String>(Some("app.logging.level"))
            .await
        {
            if let Some(level) = logging::parse_log_level(&config_level) {
                return level;
            }
            log::warn!(
                "Invalid app.logging.level '{}', falling back to default={}",
                config_level,
                logging::level_to_str(default_level)
            );
        }
    }
    default_level
}

fn spawn_ingest_server_with_config_listener() {
    use bitfun_core::infrastructure::debug_log::IngestServerManager;
    use bitfun_core::service::config::{
        get_global_config_service, subscribe_config_updates, ConfigUpdateEvent,
    };
    use bitfun_core::service::workspace::get_global_workspace_service;

    tauri::async_runtime::spawn(async move {
        let (initial_config, configured_port) = if let Ok(config_service) =
            get_global_config_service().await
        {
            if let Ok(config) = config_service
                .get_config::<bitfun_core::service::config::GlobalConfig>(None)
                .await
            {
                let debug_config = config
                    .smart_apps
                    .prime_builder_debug_config()
                    .unwrap_or(&config.ai.debug_mode_config)
                    .clone();
                let workspace_path = get_global_workspace_service()
                    .and_then(|service| service.try_get_last_used_workspace_path())
                    .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
                (
                    Some(
                        bitfun_core::infrastructure::debug_log::IngestServerConfig::from_debug_mode_config(
                            debug_config.ingest_port,
                            workspace_path.join(&debug_config.log_path),
                        ),
                    ),
                    Some(debug_config.ingest_port),
                )
            } else {
                (None, None)
            }
        } else {
            (None, None)
        };

        let manager = IngestServerManager::global();
        if let Err(e) = manager.start(initial_config).await {
            log::error!("Failed to start Debug Log Ingest Server: {}", e);
        }

        let actual_port = manager.get_actual_port().await;
        if let Some(cfg_port) = configured_port {
            if actual_port != cfg_port {
                if let Ok(config_service) = get_global_config_service().await {
                    if let Err(e) = config_service
                        .set_config("smart_apps.apps.coding-app.debug.ingest_port", actual_port)
                        .await
                    {
                        log::error!("Failed to sync actual port to config: {}", e);
                    } else {
                        log::info!(
                            "Ingest Server port synced: actual_port={}, config_port={}",
                            actual_port,
                            cfg_port
                        );
                    }
                }
            }
        }

        if let Some(mut receiver) = subscribe_config_updates() {
            loop {
                match receiver.recv().await {
                    Ok(ConfigUpdateEvent::DebugModeConfigUpdated {
                        new_port,
                        new_log_path,
                    }) => {
                        let workspace_path = get_global_workspace_service()
                            .and_then(|service| service.try_get_last_used_workspace_path())
                            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
                        let full_log_path = workspace_path.join(&new_log_path);
                        if let Err(e) = manager.update_port(new_port, full_log_path).await {
                            log::error!(
                                "Failed to update Ingest Server config: port={}, log_path={}, error={}",
                                new_port,
                                new_log_path,
                                e
                            );
                        }
                    }
                    Ok(ConfigUpdateEvent::ConfigReloaded) => {
                        if let Ok(config_service) = get_global_config_service().await {
                            if let Ok(config) = config_service
                                .get_config::<bitfun_core::service::config::GlobalConfig>(None)
                                .await
                            {
                                let debug_config = config
                                    .smart_apps
                                    .prime_builder_debug_config()
                                    .unwrap_or(&config.ai.debug_mode_config);
                                let workspace_path = get_global_workspace_service()
                                    .and_then(|service| service.try_get_last_used_workspace_path())
                                    .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
                                let full_log_path = workspace_path.join(&debug_config.log_path);
                                if let Err(e) = manager
                                    .update_port(debug_config.ingest_port, full_log_path)
                                    .await
                                {
                                    log::error!(
                                        "Failed to update Ingest Server after config reload: port={}, error={}",
                                        debug_config.ingest_port,
                                        e
                                    );
                                }
                            }
                        }
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        log::warn!("Config update channel closed, stopping listener");
                        break;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        log::warn!("Config update listener lagged by {} messages", n);
                    }
                }
            }
        }
    });
}
