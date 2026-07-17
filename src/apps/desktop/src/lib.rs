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

use serde::Deserialize;
use sparo_core::infrastructure::constants::{
    APP_PRODUCT_NAME, EVENT_SYSTEM_NOTIFICATION, WINDOW_MAIN,
};
use sparo_transport::TauriTransportAdapter;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Emitter, Manager};

use api::background_process_api::*;
use api::clipboard_file_api::*;
use api::commands::*;
use api::computer_use_api::*;
use api::config_api::*;
use api::cron_api::*;
use api::daily_letter_api::*;
use api::diff_api::*;
use api::global_milestone_api::*;
use api::host_scan_api::*;
use api::mcp_api::*;
use api::memory_consolidation_api::*;
use api::project_detection_api::*;
use api::runtime_api::*;
use api::session_api::*;
use api::skill_api::*;
use api::snapshot_service::*;
use api::speech_api::*;
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
static EXIT_CLEANUP_STARTED: AtomicBool = AtomicBool::new(false);

fn exit_request_requires_cleanup(cleanup_started: bool) -> bool {
    !cleanup_started
}

pub fn set_wants_exit() {
    WANTS_EXIT.store(true, Ordering::SeqCst);
}

pub(crate) fn wants_exit() -> bool {
    WANTS_EXIT.load(Ordering::SeqCst)
}

/// Complete process-owned cleanup before terminating the Tauri event loop.
pub(crate) fn request_clean_exit(app_handle: tauri::AppHandle) {
    if EXIT_CLEANUP_STARTED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    tauri::async_runtime::spawn(async move {
        if let Some(container) = app_handle.try_state::<Arc<AppContainer>>() {
            if let Some(coordinator) = container.coordinator() {
                if let Err(error) = coordinator.shutdown_settings_agent_session().await {
                    log::error!(
                        "Failed to clean SettingsAgent session during exit: {}",
                        error
                    );
                }
            }
        }
        sparo_core::util::process_manager::cleanup_all_processes();
        api::remote_connect_api::cleanup_on_exit();
        app_handle.exit(0);
    });
}

/// Coordinator state still exposed via `.manage` for code paths that take a
/// `tauri::State<CoordinatorState>` argument.
#[derive(Clone)]
pub struct CoordinatorState {
    pub coordinator: Arc<sparo_core::agentic::coordination::ConversationCoordinator>,
}

/// Dialog scheduler state, primary entry point for user messages.
#[derive(Clone)]
pub struct SchedulerState {
    pub scheduler: Arc<sparo_core::agentic::coordination::DialogScheduler>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebdriverBridgeResultRequest {
    payload: serde_json::Value,
}

#[tauri::command]
async fn webdriver_bridge_result(request: WebdriverBridgeResultRequest) -> Result<(), String> {
    log::debug!("webdriver_bridge_result command invoked");
    sparo_webdriver::handle_bridge_result(request.payload)
}

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

// ─────────────────────────────────────────────── Tauri entrypoint ───

fn is_embedded_webdriver_mode() -> bool {
    cfg!(debug_assertions) && std::env::var_os("SPARO_WEBDRIVER_PORT").is_some()
}

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

    let path_manager = sparo_core::infrastructure::get_path_manager_arc();
    let startup_theme =
        theme::ThemeConfig::from_startup_config_file(&path_manager.app_config_file());

    let container_setup = container.clone();
    let container_close = container.clone();

    let mut builder = tauri::Builder::default()
        .append_invoke_initialization_script(startup_theme.generate_startup_bootstrap_script());
    if !is_embedded_webdriver_mode() {
        builder = builder.plugin(tauri_plugin_single_instance::init(
            move |app, _args, _cwd| {
                if let Some(window) = app.get_webview_window(WINDOW_MAIN) {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            },
        ));
    }

    let mut context = tauri::generate_context!();
    if let Err(error) =
        window::main_window::apply_startup_theme_to_context(&mut context, &startup_theme)
    {
        log::warn!(
            "Failed to apply startup theme to main window config: {}",
            error
        );
    }

    let app = match builder
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
            api::agentic_api::update_session_workspace,
            api::agentic_api::ensure_coordinator_session,
            api::agentic_api::start_dialog_turn,
            api::agentic_api::list_queued_dialog_turns,
            api::agentic_api::update_queued_dialog_turn,
            api::agentic_api::delete_queued_dialog_turn,
            api::agentic_api::guide_queued_dialog_turn,
            api::agentic_api::resume_queued_dialog_turns,
            api::agentic_api::compact_session,
            api::goal_api::submit_session_goal,
            api::goal_api::get_session_goal,
            api::goal_api::control_session_goal,
            api::goal_api::update_session_goal,
            api::agentic_api::cancel_dialog_turn,
            api::agentic_api::cancel_session,
            api::agentic_api::delete_session,
            api::agentic_api::restore_session,
            webdriver_bridge_result,
            api::agentic_api::list_sessions,
            api::agentic_api::confirm_tool_execution,
            api::agentic_api::reject_tool_execution,
            api::agentic_api::cancel_tool,
            api::settings_agent_api::ensure_settings_flow_session,
            api::settings_agent_api::reset_settings_flow_session,
            api::agentic_api::generate_session_title,
            api::agentic_api::list_agents,
            api::agentic_os_api::agentic_os_list_works,
            api::agentic_os_api::agentic_os_get_work,
            api::agentic_os_api::agentic_os_delete_work,
            api::agentic_os_api::agentic_os_get_work_execution_graph,
            api::agentic_os_api::agentic_os_create_work,
            api::agentic_os_api::agentic_os_resolve_app_work,
            api::agentic_os_api::agentic_os_resolve_component_work,
            api::agentic_os_api::agentic_os_start_work,
            api::agentic_os_api::agentic_os_update_work,
            api::agentic_os_api::agentic_os_link_session_to_work,
            api::agentic_os_api::agentic_os_dispatch_work,
            api::agentic_os_api::agentic_os_advance_work,
            api::agentic_os_api::agentic_os_control_work,
            api::agentic_os_api::agentic_os_record_builder_preview_result,
            api::agentic_os_api::agentic_os_record_builder_validation_result,
            agentic_os_list_background_processes,
            agentic_os_run_background_process,
            daily_letter_list,
            daily_letter_get,
            daily_letter_generate,
            daily_letter_apply_receipts,
            daily_letter_seal,
            daily_letter_state,
            api::token_usage_api::get_token_usage,
            api::token_usage_api::clear_token_usage,
            api::agent_component_api::list_agent_components,
            api::agent_component_api::get_agent_component,
            api::agent_component_api::create_agent_component,
            api::agent_component_api::update_agent_component,
            api::agent_component_api::delete_agent_component,
            api::agent_component_api::reload_agent_components,
            api::agent_component_api::validate_agent_component_package,
            api::agent_component_api::create_agent_component_js_tool,
            api::agent_component_api::test_agent_component_js_tool,
            api::agent_component_api::export_agent_component,
            api::agent_component_api::import_agent_component,
            api::intelligent_app_api::list_app_catalog,
            api::intelligent_app_api::create_intelligent_app,
            api::intelligent_app_api::fork_intelligent_app,
            api::intelligent_app_api::create_app_draft,
            api::intelligent_app_api::create_app_rebase_draft,
            api::intelligent_app_api::resolve_app_draft,
            api::intelligent_app_api::delete_app_draft,
            api::intelligent_app_api::resolve_intelligent_app_draft_preview,
            api::intelligent_app_api::close_intelligent_app_draft_preview,
            api::intelligent_app_api::publish_app_draft,
            api::intelligent_app_api::activate_app_release,
            api::intelligent_app_api::get_app_release_capability_review,
            api::intelligent_app_api::approve_app_release_capabilities,
            api::intelligent_app_api::rollback_app_activation,
            api::intelligent_app_api::deactivate_app_slot,
            api::intelligent_app_api::remove_intelligent_app,
            api::app_capability_api::list_app_capability_grants,
            api::app_capability_api::revoke_app_capabilities,
            api::app_evolution_api::get_app_evolution_state,
            api::app_evolution_api::set_app_evolution_consent,
            api::app_evolution_api::approve_app_evolution_proposal,
            api::app_evolution_api::reject_app_evolution_proposal,
            api::app_evolution_api::rollback_app_evolution_proposal,
            api::product_app_runtime_api::resolve_product_app_runtime_instance,
            api::product_app_runtime_api::product_app_runtime_list_host_surfaces,
            api::product_app_runtime_api::product_app_runtime_list_recent_host_surfaces,
            api::product_app_runtime_api::product_app_runtime_record_recent_host_surface,
            api::product_app_runtime_api::product_app_runtime_get_host_surface,
            api::product_app_runtime_api::product_app_runtime_host_runtime_status,
            api::product_app_runtime_api::product_app_runtime_list_running_workers,
            api::product_app_runtime_api::product_app_runtime_stop_worker,
            api::product_app_runtime_api::product_app_runtime_install_dependencies,
            api::product_app_runtime_api::product_app_runtime_recompile_host_surface,
            api::product_app_runtime_api::product_app_runtime_clear_runtime_issues,
            api::product_app_runtime_api::product_app_runtime_worker_call,
            api::product_app_runtime_api::product_app_runtime_report_runtime_issue,
            api::product_app_runtime_api::product_app_runtime_report_runtime_log,
            api::product_app_runtime_api::product_app_runtime_ai_complete,
            api::product_app_runtime_api::product_app_runtime_ai_chat,
            api::product_app_runtime_api::product_app_runtime_ai_cancel,
            api::product_app_runtime_api::product_app_runtime_ai_list_models,
            api::product_app_runtime_api::product_app_runtime_backend_call,
            api::product_app_runtime_api::product_app_runtime_backend_status,
            api::product_app_runtime_api::product_app_runtime_backend_cancel_run,
            api::product_app_runtime_api::product_app_runtime_cancel_stale_ppt_runs,
            api::product_app_runtime_api::product_app_runtime_ppt_turn_assistant_text,
            api::product_app_runtime_api::product_app_runtime_render_slide_page,
            api::bridge_component_api::list_bridge_components,
            api::bridge_component_api::get_bridge_component,
            api::bridge_component_api::validate_bridge_component_package,
            api::bridge_component_api::create_bridge_component,
            api::bridge_component_api::update_bridge_component,
            api::bridge_component_api::import_bridge_component_from_path,
            api::bridge_component_api::delete_bridge_component,
            api::bridge_component_api::run_bridge_component_action,
            api::bridge_component_api::list_bridge_component_runs,
            api::bridge_component_api::get_bridge_component_run,
            api::bridge_component_api::cancel_bridge_component_run,
            api::bridge_component_api::get_bridge_component_run_artifacts,
            api::bridge_component_api::stream_bridge_component_run_events,
            api::btw_api::btw_ask_stream,
            api::btw_api::btw_cancel,
            api::markdown_ai_api::markdown_ai_propose_edits,
            api::markdown_ai_api::markdown_ai_cancel,
            api::markdown_export_api::export_markdown_html,
            api::markdown_export_api::export_markdown_pdf,
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
            test_saved_ai_model_connection,
            list_ai_models_by_config,
            discover_cli_credentials,
            refresh_cli_credential,
            initialize_ai,
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
            describe_config_catalog,
            get_config_snapshot,
            get_config_startup_status,
            rebuild_default_config,
            plan_config_patch,
            commit_config_patch,
            undo_config_commit,
            get_config_commit,
            retry_config_apply,
            computer_use_get_status,
            computer_use_request_permissions,
            computer_use_open_system_settings,
            get_runtime_logging_info,
            speech_list_models,
            speech_download_model,
            speech_cancel_model_download,
            speech_delete_model,
            speech_verify_model,
            speech_start_input_session,
            speech_append_audio_chunk,
            speech_finish_input_session,
            speech_cancel_input_session,
            get_runtime_capabilities,
            api::runtime_api::record_frontend_runtime_heartbeat,
            api::runtime_api::get_frontend_runtime_watchdog_snapshot,
            api::runtime_api::disable_frontend_runtime_safe_mode,
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
            set_agent_skill_suite_disabled,
            replace_agent_skill_selection,
            validate_skill_package_path,
            add_skill_package,
            delete_skill_package,
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
            get_main_window_close_intent,
            send_system_notification,
            check_command_exists,
            check_commands_exist,
            run_system_command,
            set_macos_edit_menu_mode,
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
            // Browser Control API (CDP-based user browser control)
            api::browser_control_api::browser_control_get_status,
            api::browser_control_api::browser_control_launch,
            api::browser_control_api::browser_control_restart_with_cdp,
            api::browser_control_api::browser_control_create_launcher,
            // Announcement / feature-demo / tips API
            api::announcement_api::get_pending_announcements,
            api::announcement_api::mark_announcement_seen,
            api::announcement_api::dismiss_announcement,
            api::announcement_api::never_show_announcement,
            api::announcement_api::trigger_announcement,
            api::announcement_api::get_announcement_tips,
        ])
        .build(context)
    {
        Ok(app) => app,
        Err(error) => {
            log::error!("Error while building tauri application: {}", error);
            bootstrap::failure::show_native_error_dialog(
                "Sparo OS failed to start",
                &format!("Tauri application build failed:\n\n{}", error),
            );
            return;
        }
    };

    // Covers predefined macOS Quit/Cmd+Q and any future direct exit request. The cleanup task
    // finishes by calling `AppHandle::exit`; the single-flight flag lets that second request pass
    // through instead of recursively starting cleanup.
    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            let cleanup_started = EXIT_CLEANUP_STARTED.load(Ordering::SeqCst);
            if exit_request_requires_cleanup(cleanup_started) {
                api.prevent_exit();
                set_wants_exit();
                request_clean_exit(app_handle.clone());
            }
        }
    });
}

// ─────────────────────────────────────────────── Stage C + D pipeline ───

#[cfg(test)]
mod lifecycle_tests {
    use super::exit_request_requires_cleanup;

    #[test]
    fn exit_request_is_intercepted_only_until_cleanup_has_started() {
        assert!(exit_request_requires_cleanup(false));
        assert!(!exit_request_requires_cleanup(true));
    }
}

fn spawn_boot_pipeline(
    container: Arc<AppContainer>,
    app_handle: tauri::AppHandle,
    transport: Arc<TauriTransportAdapter>,
) {
    tauri::async_runtime::spawn(async move {
        let globals = match bootstrap::globals::initialize().await {
            Ok(g) => g,
            Err(e) => {
                // The backend log keeps the full anyhow context chain so the
                // first actionable startup cause is visible. BootController
                // continues to expose only the existing outer error text.
                log::error!("Stage-C globals failed: {:#}", e);
                container.boot.fail("globals", e);
                return;
            }
        };

        // Subscribe before publishing the service through AppContainer so no
        // commit can be accepted by the Config API without a live Web UI
        // event bridge.
        spawn_config_commit_bridge(app_handle.clone(), globals.config_service.clone());

        // Register all runtime consumers before the service becomes callable
        // through AppContainer. Stage-C writes must never observe a partially
        // wired apply pipeline.
        if let Err(error) = initialize_runtime_config_apply_adapters(&app_handle) {
            log::error!(
                "Failed to initialize runtime config apply adapters: {}",
                error
            );
            container.boot.fail("config_apply_adapters", error);
            return;
        }

        if let Err(error) = container.set_config_service(globals.config_service.clone()) {
            log::error!("Failed to publish configuration service: {}", error);
            container.boot.fail("config_service_publish", error);
            return;
        }

        let global_config = match globals.config_service.get_config(None).await {
            Ok(config) => config,
            Err(error) => {
                log::error!("Failed to load authoritative startup config: {}", error);
                container.boot.fail("startup_config", error.to_string());
                return;
            }
        };
        let startup_theme = match theme::ThemeConfig::from_global_config(&global_config) {
            Ok(theme) => theme,
            Err(error) => {
                log::error!("Failed to resolve authoritative startup theme: {}", error);
                container.boot.fail("startup_theme", error);
                return;
            }
        };
        if let Err(error) = window::main_window::configure(&app_handle, &startup_theme) {
            log::error!("Failed to configure main window: {}", error);
            container.boot.fail("main_window", error);
            return;
        }
        container.boot.transition(BootStage::GlobalReady);
        tray::request_menu_refresh(&app_handle);

        spawn_ingest_server();
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
                    container.boot.fail("agentic_runtime", e);
                    return;
                }
            };
        container.set_coordinator(agentic.coordinator.clone());
        container.set_scheduler(agentic.scheduler.clone());

        match agentic
            .coordinator
            .initialize_settings_agent_lifecycle()
            .await
        {
            Ok(removed) if removed > 0 => log::info!(
                "Removed stale SettingsAgent application-lifecycle sessions: count={}",
                removed
            ),
            Ok(_) => {}
            Err(error) => {
                // Settings lifecycle cleanup is intentionally non-fatal for desktop boot. The
                // lazy ensure path keeps the lifecycle uninitialized and retries this sweep when
                // AI settings is first opened.
                log::warn!(
                    "Failed to clean stale SettingsAgent sessions; lazy initialization will retry: error={}",
                    error
                );
            }
        }

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
        app_handle.manage(agentic.goal_service.clone());
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

        sparo_webdriver::maybe_start(app_handle.clone());

        #[cfg(target_os = "macos")]
        macos_menubar_initial_setup(app_handle.clone());

        container.boot.transition(BootStage::WorkspaceReady {
            path: workspace_path.map(|p| p.display().to_string()),
        });
        tray::request_menu_refresh(&app_handle);

        log::info!("Sparo OS boot complete");
    });
}

fn spawn_config_commit_bridge(
    app_handle: tauri::AppHandle,
    config_service: Arc<sparo_core::service::config::ConfigService>,
) {
    let mut commits = config_service.subscribe_commits();
    let mut apply_statuses = config_service.subscribe_apply_statuses();
    let mut rollbacks = config_service.subscribe_rollbacks();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                result = commits.recv() => match result {
                    Ok(event) => {
                        if let Err(error) = app_handle.emit("config://committed", event.published()) {
                            log::warn!(
                                "Failed to emit config commit to Web UI: commit_id={}, error={}",
                                event.commit_id,
                                error
                            );
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        log::warn!("Config commit bridge lagged: skipped={}", skipped);
                        match config_service.get_snapshot().await {
                            Ok(snapshot) => {
                                if let Err(error) = app_handle.emit("config://snapshot-refreshed", &snapshot) {
                                    log::warn!(
                                        "Failed to emit authoritative config snapshot to Web UI after bridge lag: revision={}, skipped={}, error={}",
                                        snapshot.revision,
                                        skipped,
                                        error
                                    );
                                }
                            }
                            Err(error) => {
                                log::error!(
                                    "Failed to load authoritative config snapshot after bridge lag: skipped={}, error={}",
                                    skipped,
                                    error
                                );
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                },
                result = apply_statuses.recv() => match result {
                    Ok(event) => {
                        if let Err(error) = app_handle.emit("config://apply-status", event.published()) {
                            log::warn!(
                                "Failed to emit config apply status to Web UI: commit_id={}, consumer={}, error={}",
                                event.commit_id,
                                event.consumer,
                                error
                            );
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        log::warn!("Config apply-status bridge lagged: skipped={}", skipped);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                },
                result = rollbacks.recv() => match result {
                    Ok(event) => {
                        if let Err(error) = app_handle.emit("config://rolled-back", event.published()) {
                            log::warn!(
                                "Failed to emit config rollback to Web UI: commit_id={}, error={}",
                                event.original_commit_id,
                                error
                            );
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        log::warn!("Config rollback bridge lagged: skipped={}", skipped);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                },
            }
        }
    });
}

#[cfg(target_os = "macos")]
fn macos_menubar_initial_setup(app_handle: tauri::AppHandle) {
    use tauri::Manager;
    tauri::async_runtime::spawn(async move {
        let app_state: tauri::State<'_, api::app_state::AppState> = app_handle.state();
        let language = match app_state
            .config_service
            .get_config::<String>(Some("app.language"))
            .await
        {
            Ok(language) => language,
            Err(error) => {
                log::error!("Failed to load macOS menu language: {}", error);
                return;
            }
        };
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
    use sparo_core::{infrastructure, service};

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
    if wants_exit() {
        api.prevent_close();
        log::info!("Main window close requested with wants_exit, cleaning up");
        request_clean_exit(window.app_handle().clone());
        return;
    }

    let config_service = container.config_service();
    let app_handle = window.app_handle().clone();
    let window2 = window.clone();
    api.prevent_close();
    tauri::async_runtime::spawn(async move {
        let close_to_tray = match config_service.as_deref() {
            Some(service) => read_close_to_tray_pref(service).await,
            None => Err("config.service_unavailable".to_string()),
        };
        match close_to_tray {
            Ok(true) => {
                let _ = window2.hide();
                log::info!("Main window hidden to tray");
                if let Some(service) = config_service.as_deref() {
                    if maybe_show_tray_hint(&app_handle, service).await.is_err() {
                        log::warn!("Failed to show tray hint: failure_code=tray.hint_failed");
                    }
                }
            }
            Ok(false) => {
                set_wants_exit();
                let _ = window2.close();
            }
            Err(_) => {
                log::error!(
                    "Failed to read close-to-tray preference: failure_code=tray.config_unavailable"
                );
                set_wants_exit();
                let _ = window2.close();
            }
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
async fn maybe_show_tray_hint(
    app: &tauri::AppHandle,
    config_service: &sparo_core::service::config::ConfigService,
) -> Result<(), String> {
    use sparo_core::service::config::GlobalConfig;

    let already_shown = config_service
        .get_config::<GlobalConfig>(None)
        .await
        .map(|config| config.app.tray.hide_to_tray_hint_shown)
        .map_err(|error| error.to_string())?;

    if already_shown {
        return Ok(());
    }

    config_service
        .commit_operations(
            sparo_events::ConfigChangeSource {
                kind: sparo_events::ConfigChangeSourceKind::System,
                surface: Some("tray-hint".to_string()),
                request_id: None,
            },
            vec![sparo_core::service::config::ConfigPatchOperation::Set {
                setting_id: sparo_core::service::config::catalog::SETTING_APP_TRAY_HINT_SHOWN
                    .to_string(),
                value: serde_json::json!(true),
            }],
            true,
        )
        .await
        .map_err(|error| error.to_string())?;

    app.emit(
        EVENT_SYSTEM_NOTIFICATION,
        serde_json::json!({
            "title": APP_PRODUCT_NAME,
            "body": "Sparo OS is still running in the system tray. Right-click the tray icon to open the menu."
        }),
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

async fn read_close_to_tray_pref(
    service: &sparo_core::service::config::ConfigService,
) -> Result<bool, String> {
    use sparo_core::service::config::GlobalConfig;
    service
        .get_config::<GlobalConfig>(None)
        .await
        .map(|config| config.app.tray.close_to_tray)
        .map_err(|error| error.to_string())
}

// ─────────────────────────────────────────────── Config apply adapters ───

static CONFIG_APPLY_ADAPTER_REGISTRATIONS: std::sync::OnceLock<
    Vec<sparo_core::service::config::ConfigApplyAdapterRegistration>,
> = std::sync::OnceLock::new();

fn initialize_runtime_config_apply_adapters(
    app_handle: &tauri::AppHandle,
) -> sparo_core::CoreResult<()> {
    use sparo_core::infrastructure::debug_log::IngestServerManager;
    use sparo_core::service::config::{
        register_config_apply_adapter, ConfigApply, ConfigApplyAdapterCriticality,
        ConfigApplyPathPattern, ConfigApplyPrepare, CONFIG_APPLY_CONSUMER_DEBUG_INGEST,
        CONFIG_APPLY_CONSUMER_RUNTIME_I18N, CONFIG_APPLY_CONSUMER_RUNTIME_LOGGING,
    };

    let logging_apply: ConfigApply = Arc::new(|context| {
        Box::pin(async move {
            let configured_level = &context.snapshot.app.logging.level;
            let level = logging::parse_log_level(configured_level).ok_or_else(|| {
                sparo_core::CoreError::validation(format!(
                    "Unsupported runtime log level: '{configured_level}'"
                ))
            })?;
            logging::apply_runtime_log_level(level, "config_apply_adapter");
            Ok(())
        })
    });
    let logging_registration = register_config_apply_adapter(
        CONFIG_APPLY_CONSUMER_RUNTIME_LOGGING,
        vec![ConfigApplyPathPattern::exact("app.logging.level")],
        ConfigApplyAdapterCriticality::NonCritical,
        None,
        logging_apply,
    )?;

    let i18n_app_handle = app_handle.clone();
    let i18n_apply: ConfigApply = Arc::new(move |context| {
        let app_handle = i18n_app_handle.clone();
        Box::pin(async move {
            use sparo_core::service::i18n::{get_global_i18n_service, LocaleId};

            let language = &context.snapshot.app.language;
            let locale = LocaleId::from_str(language).ok_or_else(|| {
                sparo_core::CoreError::validation(format!(
                    "Unsupported runtime locale: '{language}'"
                ))
            })?;
            let service = get_global_i18n_service().await.ok_or_else(|| {
                sparo_core::CoreError::service("Global i18n service is not initialized")
            })?;
            service.set_locale(locale).await?;

            if let Some(state) = app_handle.try_state::<api::app_state::AppState>() {
                let mode = if state.workspace_path.read().await.is_some() {
                    crate::macos_menubar::MenubarMode::Workspace
                } else {
                    crate::macos_menubar::MenubarMode::Startup
                };
                let edit_mode = *state.macos_edit_menu_mode.read().await;
                crate::macos_menubar::set_macos_menubar_with_mode(
                    &app_handle,
                    language,
                    mode,
                    edit_mode,
                )
                .map_err(|error| {
                    sparo_core::CoreError::service(format!(
                        "Failed to refresh native menu for locale '{language}': {error}"
                    ))
                })?;
            }

            Ok(())
        })
    });
    let i18n_registration = register_config_apply_adapter(
        CONFIG_APPLY_CONSUMER_RUNTIME_I18N,
        vec![ConfigApplyPathPattern::exact("app.language")],
        ConfigApplyAdapterCriticality::NonCritical,
        None,
        i18n_apply,
    )?;

    let debug_prepare: ConfigApplyPrepare = Arc::new(|context| {
        Box::pin(async move {
            let debug_config = context
                .candidate
                .product_apps
                .bitfun_coder_debug_config()
                .ok_or_else(|| {
                    sparo_core::CoreError::config(
                        "BitFun Coder Product App debug config is unavailable",
                    )
                })?;
            IngestServerManager::global()
                .prepare_port(debug_config.ingest_port)
                .await
                .map_err(|error| {
                    sparo_core::CoreError::validation(format!(
                        "Debug ingest port preflight failed: {error}"
                    ))
                })
        })
    });
    let debug_apply: ConfigApply = Arc::new(|context| {
        Box::pin(async move {
            let config = ingest_server_config_from_snapshot(&context.snapshot)?;
            IngestServerManager::global()
                .update_port(config.port, config.log_config.log_path)
                .await
                .map_err(|error| {
                    sparo_core::CoreError::config(format!(
                        "Failed to apply Debug Log Ingest Server config on port {}: {error}",
                        config.port
                    ))
                })
        })
    });
    let debug_registration = register_config_apply_adapter(
        CONFIG_APPLY_CONSUMER_DEBUG_INGEST,
        vec![ConfigApplyPathPattern::prefix(
            "product_apps.apps.builtin-bitfun-coder.debug",
        )],
        ConfigApplyAdapterCriticality::NonCritical,
        Some(debug_prepare),
        debug_apply,
    )?;

    CONFIG_APPLY_ADAPTER_REGISTRATIONS
        .set(vec![
            logging_registration,
            i18n_registration,
            debug_registration,
        ])
        .map_err(|_| {
            sparo_core::CoreError::service("Runtime config apply adapters are already initialized")
        })
}

async fn resolve_ingest_server_config(
) -> sparo_core::CoreResult<sparo_core::infrastructure::debug_log::IngestServerConfig> {
    use sparo_core::service::config::get_global_config_service;

    let config_service = get_global_config_service().await?;
    let config = config_service
        .get_config::<sparo_core::service::config::GlobalConfig>(None)
        .await?;
    ingest_server_config_from_snapshot(&config)
}

fn ingest_server_config_from_snapshot(
    config: &sparo_core::service::config::GlobalConfig,
) -> sparo_core::CoreResult<sparo_core::infrastructure::debug_log::IngestServerConfig> {
    use sparo_core::service::workspace::get_global_workspace_service;

    let debug_config = config
        .product_apps
        .bitfun_coder_debug_config()
        .ok_or_else(|| {
            sparo_core::CoreError::config("BitFun Coder Product App debug config is unavailable")
        })?;
    let workspace_path = get_global_workspace_service()
        .and_then(|service| service.try_get_last_used_workspace_path())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    Ok(
        sparo_core::infrastructure::debug_log::IngestServerConfig::with_log_path(
            debug_config.ingest_port,
            workspace_path.join(&debug_config.log_path),
        ),
    )
}

fn spawn_ingest_server() {
    use sparo_core::infrastructure::debug_log::IngestServerManager;
    use sparo_core::service::config::get_global_config_service;

    tauri::async_runtime::spawn(async move {
        let initial_config = match resolve_ingest_server_config().await {
            Ok(config) => config,
            Err(error) => {
                log::error!(
                    "Debug Log Ingest Server disabled because Product App config is unavailable: {}",
                    error
                );
                return;
            }
        };
        let configured_port = initial_config.port;

        let manager = IngestServerManager::global();
        if let Err(e) = manager.start(Some(initial_config)).await {
            log::error!("Failed to start Debug Log Ingest Server: {}", e);
            return;
        }

        let actual_port = manager.get_actual_port().await;
        if actual_port != configured_port {
            let sync_result = async {
                get_global_config_service()
                    .await?
                    .commit_operations(
                        sparo_events::ConfigChangeSource {
                            kind: sparo_events::ConfigChangeSourceKind::System,
                            surface: Some("debug-ingest-startup".to_string()),
                            request_id: None,
                        },
                        vec![sparo_core::service::config::ConfigPatchOperation::Set {
                            setting_id:
                                sparo_core::service::config::catalog::SETTING_DEBUG_INGEST_PORT
                                    .to_string(),
                            value: serde_json::json!(actual_port),
                        }],
                        true,
                    )
                    .await
                    .map(|_| ())
            }
            .await;
            if let Err(error) = sync_result {
                log::error!("Failed to sync actual ingest port to config: {}", error);
                manager.stop().await;
                return;
            }
            log::info!(
                "Ingest Server port synced: actual_port={}, config_port={}",
                actual_port,
                configured_port
            );
        }
    });
}
