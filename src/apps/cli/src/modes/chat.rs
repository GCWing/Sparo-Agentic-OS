/// Chat mode implementation
///
/// Interactive chat mode with TUI interface
use anyhow::Result;
use crossterm::event::{Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use sparo_core::infrastructure::try_get_path_manager_arc;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tokio::sync::mpsc;

use crate::agent::{agentic_system::AgenticSystem, core_adapter::CoreAgentAdapter, Agent};
use crate::config::CliConfig;
use crate::session::{Session, ToolCallStatus};
use crate::ui::chat::{ChatShortcutLabels, ChatView};
use crate::ui::commands::{
    agents_registry_message, command_for_slash, typed_command_action, CommandAction, CommandScope,
    PanelKind,
};
use crate::ui::panels::{
    command_count, jump_selection, move_selection, panel_count, selected_command,
    selected_memory_file, selected_panel_detail, selected_session_row, selected_task_row,
    selected_workspace, OverlayKind, OverlayState, SelectionJump,
};
use crate::ui::string_utils::{shell_arg, workspace_option};
use crate::ui::theme::Theme;
use crate::ui::{init_terminal, restore_terminal};

pub(crate) fn global_agentic_workspace_path() -> Option<PathBuf> {
    try_get_path_manager_arc()
        .ok()
        .map(|path_manager| path_manager.agentic_os_runtime_root())
}

pub(crate) fn effective_workspace_selection(
    workspace: Option<String>,
) -> (Option<PathBuf>, Option<String>, String) {
    match workspace {
        Some(workspace) => {
            let label = workspace.clone();
            (Some(PathBuf::from(&workspace)), Some(workspace), label)
        }
        None => {
            let path = global_agentic_workspace_path();
            let label = path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_else(|| "Agentic OS global runtime".to_string());
            let session_workspace = path.as_ref().map(|path| path.to_string_lossy().to_string());
            (path, session_workspace, label)
        }
    }
}

pub(crate) fn preview_text_file(path: &Path, max_lines: usize, max_chars: usize) -> Result<String> {
    let content = std::fs::read_to_string(path)?;
    let mut preview = String::new();
    for line in content.lines().take(max_lines) {
        if preview.len() + line.len() + 1 > max_chars {
            preview.push_str("\n...");
            return Ok(preview);
        }
        preview.push_str(line);
        preview.push('\n');
    }
    if content.lines().count() > max_lines {
        preview.push_str("...");
    }
    Ok(preview.trim_end().to_string())
}

pub(crate) fn memory_preview_followup_prompt(memory_file: &Path) -> String {
    format!(
        "Use the loaded memory preview above from `{}`. Summarize the actionable context for the current workspace, call out anything stale or risky, and suggest the next concrete step.",
        memory_file.display()
    )
}

pub(crate) fn workspace_selection_followup_prompt(workspace_label: &str) -> String {
    format!(
        "Use the selected workspace context `{}` and the workspace detail above. Summarize the current project context, call out setup or git risks, and suggest the next concrete CLI action.",
        workspace_label
    )
}

pub(crate) fn panel_analysis_followup_prompt(kind: PanelKind) -> Option<&'static str> {
    match kind {
        PanelKind::Apps => Some(
            "Use the selected app context above. Summarize what this app is for, whether it has an openable target, and the next concrete action.",
        ),
        PanelKind::Settings => Some(
            "Use the selected settings context above. Summarize the current state, call out risks or missing setup, and suggest the next concrete action.",
        ),
        _ => None,
    }
}

pub(crate) fn task_without_session_followup_prompt(title: &str, agent: &str) -> String {
    format!(
        "Use the task detail above for `{}`. Summarize the current state, identify what {} should do next, and prepare the next concrete delegation step.",
        title, agent
    )
}

fn prepared_panel_status(kind: PanelKind) -> &'static str {
    match kind {
        PanelKind::Sessions => "Resumed session; type a message to continue",
        PanelKind::Tasks => "Loaded task context; press Enter to analyze",
        PanelKind::Apps => "Loaded app context; press Enter to analyze",
        PanelKind::Settings => "Loaded settings context; press Enter to analyze",
        PanelKind::Memory => "Loaded memory preview; press Enter to analyze",
        PanelKind::Workspaces => "Workspace selected; press Enter to analyze",
    }
}

fn empty_panel_status(kind: PanelKind) -> &'static str {
    match kind {
        PanelKind::Sessions => {
            "No Sessions item selected; start with `sparo chat` or run `sparo sessions list`"
        }
        PanelKind::Tasks => {
            "No Tasks item selected; use `/dispatch <task>` or run `sparo tasks list`"
        }
        PanelKind::Apps => {
            "No Apps item selected; run `sparo apps list` or use Sparo Desktop Apps Center / App Builder"
        }
        PanelKind::Memory => {
            "No Memory item selected; run `sparo memory list` or add durable context through chat"
        }
        PanelKind::Workspaces => {
            "No Workspaces item selected; run `sparo workspaces use .` from a project"
        }
        PanelKind::Settings => {
            "No Settings item selected; run `sparo health --json` for diagnostics"
        }
    }
}

fn shortcut_matches(shortcut: &str, key: KeyEvent) -> bool {
    let shortcut = shortcut.trim();
    if shortcut.is_empty() {
        return false;
    }

    if shortcut.eq_ignore_ascii_case("enter") {
        return matches!(key.code, KeyCode::Enter);
    }
    if shortcut.eq_ignore_ascii_case("esc") || shortcut.eq_ignore_ascii_case("escape") {
        return matches!(key.code, KeyCode::Esc);
    }

    let Some(raw_key) = shortcut
        .strip_prefix("Ctrl+")
        .or_else(|| shortcut.strip_prefix("ctrl+"))
        .or_else(|| shortcut.strip_prefix("CTRL+"))
    else {
        return false;
    };
    let mut chars = raw_key.chars();
    let Some(expected) = chars.next() else {
        return false;
    };
    if chars.next().is_some() {
        return false;
    }

    matches!(
        (key.code, key.modifiers),
        (KeyCode::Char(actual), KeyModifiers::CONTROL) if actual.eq_ignore_ascii_case(&expected)
    )
}

fn overlay_item_count(overlay: &OverlayState, scope: CommandScope) -> usize {
    match overlay.kind {
        OverlayKind::CommandPalette => command_count(scope, &overlay.filter),
        OverlayKind::Panel(_) => panel_count(overlay),
        OverlayKind::Help => 0,
    }
}

/// Chat mode exit reason
#[derive(Debug, Clone, PartialEq)]
pub enum ChatExitReason {
    /// User exits program
    Quit,
    /// Return to Agentic OS home
    BackToMenu {
        workspace: Option<String>,
        session_id: Option<String>,
    },
}

pub struct ChatMode {
    config: CliConfig,
    agent_name: String,
    workspace_path: Option<PathBuf>,
    agent: Arc<dyn Agent>,
    initial_input: Option<String>,
    initial_context_messages: Vec<String>,
    persisted_session_id: RwLock<Option<String>>,
}

impl ChatMode {
    pub fn new_with_session(
        config: CliConfig,
        agent_name: String,
        workspace_path: Option<PathBuf>,
        session_id: Option<String>,
        agentic_system: &AgenticSystem,
    ) -> Self {
        let skip_tool_confirmation = !config.behavior.confirm_dangerous;
        let agent = Arc::new(CoreAgentAdapter::new_with_session(
            agent_name.clone(),
            agentic_system.coordinator.clone(),
            agentic_system.event_queue.clone(),
            workspace_path.clone(),
            session_id.clone(),
            skip_tool_confirmation,
        )) as Arc<dyn Agent>;

        Self {
            config,
            agent_name,
            workspace_path,
            agent,
            initial_input: None,
            initial_context_messages: Vec::new(),
            persisted_session_id: RwLock::new(session_id),
        }
    }

    pub fn set_initial_input(&mut self, input: Option<String>) {
        self.initial_input = input.filter(|value| !value.trim().is_empty());
    }

    pub fn set_initial_context_messages(&mut self, messages: Vec<String>) {
        self.initial_context_messages = messages
            .into_iter()
            .filter(|value| !value.trim().is_empty())
            .collect();
    }

    pub fn run(
        &mut self,
        existing_terminal: Option<Terminal<CrosstermBackend<io::Stdout>>>,
    ) -> Result<ChatExitReason> {
        tracing::info!("Starting Chat mode, Agent: {}", self.agent_name);
        if let Some(ws) = &self.workspace_path {
            tracing::info!("Workspace: {}", ws.display());
        }

        let mut terminal = match existing_terminal {
            Some(t) => t,
            None => init_terminal()?,
        };
        let session = self.load_persisted_session().unwrap_or_else(|| {
            Session::new(
                self.agent_name.clone(),
                self.workspace_path
                    .as_ref()
                    .map(|path| path.to_string_lossy().to_string()),
            )
        });

        let theme = Theme::from_preferences(&self.config.ui.theme, &self.config.ui.color_scheme);
        let mut chat_view = ChatView::new(session, theme);
        chat_view.set_show_tips(self.config.ui.show_tips);
        chat_view.set_animation(self.config.ui.animation);
        chat_view.set_shortcuts(ChatShortcutLabels::from_config_values(
            &self.config.shortcuts.send_message,
            &self.config.shortcuts.interrupt,
            &self.config.shortcuts.menu,
        ));
        for message in self.initial_context_messages.drain(..) {
            chat_view.add_message("system".to_string(), message);
        }
        if let Some(initial_input) = self.initial_input.take() {
            chat_view.input = initial_input;
            chat_view.cursor = chat_view.input.chars().count();
        }

        let rt_handle = tokio::runtime::Handle::current();
        let (response_tx, mut response_rx) =
            mpsc::unbounded_channel::<crate::agent::AgentResponse>();
        let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<crate::agent::AgentEvent>();

        let mut pending_response: Option<tokio::task::JoinHandle<Result<()>>> = None;
        let mut current_assistant_message_text = String::new();
        let mut current_tool_map: std::collections::HashMap<String, crate::session::ToolCall> =
            std::collections::HashMap::new();

        let mut exit_reason = ChatExitReason::Quit;
        let mut should_quit = false;

        let run_result: Result<ChatExitReason> = (|| {
            while !should_quit {
                terminal.draw(|frame| {
                    chat_view.render(frame);
                })?;

                while let Ok(event) = stream_rx.try_recv() {
                    use crate::agent::AgentEvent;
                    use crate::session::{ToolCall, ToolCallStatus};

                    match event {
                        AgentEvent::TextChunk(chunk) => {
                            current_assistant_message_text.push_str(&chunk);
                            chat_view.session.update_last_message_text_flow(
                                current_assistant_message_text.clone(),
                                true,
                            );
                        }

                        AgentEvent::ToolCallStart {
                            tool_id,
                            tool_name,
                            parameters,
                        } => {
                            if !current_assistant_message_text.is_empty() {
                                chat_view.session.update_last_message_text_flow(
                                    current_assistant_message_text.clone(),
                                    false,
                                );
                            }

                            let tool_call = ToolCall {
                                tool_id: Some(tool_id.clone()),
                                tool_name,
                                parameters,
                                result: None,
                                status: ToolCallStatus::Running,
                                progress: Some(0.0),
                                progress_message: None,
                                duration_ms: None,
                            };

                            current_tool_map.insert(tool_id, tool_call.clone());
                            chat_view.session.add_tool_to_last_message(tool_call);
                        }

                        AgentEvent::ToolCallProgress {
                            tool_id,
                            tool_name: _,
                            message,
                        } => {
                            if let Some(tool) = current_tool_map.get_mut(&tool_id) {
                                tool.progress_message = Some(message.clone());
                                chat_view
                                    .session
                                    .update_tool_in_last_message(&tool_id, |t| {
                                        t.progress_message = Some(message);
                                    });
                            }
                        }

                        AgentEvent::ToolConfirmationNeeded {
                            tool_id,
                            tool_name,
                            parameters,
                        } => {
                            let tool_call = ToolCall {
                                tool_id: Some(tool_id.clone()),
                                tool_name: tool_name.clone(),
                                parameters,
                                result: None,
                                status: ToolCallStatus::ConfirmationNeeded,
                                progress: None,
                                progress_message: Some(
                                    "Waiting for terminal confirmation".to_string(),
                                ),
                                duration_ms: None,
                            };
                            if let Some(tool) = current_tool_map.get_mut(&tool_id) {
                                tool.status = ToolCallStatus::ConfirmationNeeded;
                                tool.parameters = tool_call.parameters.clone();
                                tool.progress_message =
                                    Some("Waiting for terminal confirmation".to_string());
                                chat_view
                                    .session
                                    .update_tool_in_last_message(&tool_id, |t| {
                                        t.status = ToolCallStatus::ConfirmationNeeded;
                                        t.progress_message =
                                            Some("Waiting for terminal confirmation".to_string());
                                    });
                            } else {
                                current_tool_map.insert(tool_id.clone(), tool_call.clone());
                                chat_view.session.add_tool_to_last_message(tool_call);
                            }
                            chat_view.set_pending_tool_confirmation(tool_id, tool_name.clone());
                            chat_view.set_status(Some(format!(
                                "{} needs confirmation. Press y to run, n to reject.",
                                tool_name
                            )));
                        }

                        AgentEvent::ToolConfirmed { tool_id, tool_name } => {
                            chat_view.clear_pending_tool_confirmation(&tool_id);
                            if let Some(tool) = current_tool_map.get_mut(&tool_id) {
                                tool.status = ToolCallStatus::Confirmed;
                                tool.progress_message = Some("Confirmed".to_string());
                            }
                            chat_view
                                .session
                                .update_tool_in_last_message(&tool_id, |t| {
                                    t.status = ToolCallStatus::Confirmed;
                                    t.progress_message = Some("Confirmed".to_string());
                                });
                            chat_view.set_status(Some(format!("Confirmed {}", tool_name)));
                        }

                        AgentEvent::ToolRejected {
                            tool_id,
                            tool_name,
                            reason,
                        } => {
                            chat_view.clear_pending_tool_confirmation(&tool_id);
                            if let Some(tool) = current_tool_map.get_mut(&tool_id) {
                                tool.status = ToolCallStatus::Rejected;
                                tool.result = Some(reason.clone());
                                tool.progress_message = Some("Rejected".to_string());
                            }
                            chat_view
                                .session
                                .update_tool_in_last_message(&tool_id, |t| {
                                    t.status = ToolCallStatus::Rejected;
                                    t.result = Some(reason.clone());
                                    t.progress_message = Some("Rejected".to_string());
                                });
                            chat_view.set_status(Some(format!("Rejected {}", tool_name)));
                        }

                        AgentEvent::ToolCallComplete {
                            tool_id,
                            tool_name,
                            result,
                            success,
                        } => {
                            if let Some(tool) = current_tool_map.get_mut(&tool_id) {
                                tool.status = if success {
                                    ToolCallStatus::Success
                                } else {
                                    ToolCallStatus::Failed
                                };
                                tool.result = Some(result.clone());
                                tool.progress = Some(1.0);

                                chat_view
                                    .session
                                    .update_tool_in_last_message(&tool_id, |t| {
                                        t.status = tool.status.clone();
                                        t.result = Some(result);
                                        t.progress = Some(1.0);
                                    });
                            } else {
                                tracing::warn!(
                                    "Received completion for unknown CLI tool call: id={}, name={}",
                                    tool_id,
                                    tool_name
                                );
                            }
                        }

                        AgentEvent::Done => {
                            if !current_assistant_message_text.is_empty() {
                                chat_view.session.update_last_message_text_flow(
                                    current_assistant_message_text.clone(),
                                    false,
                                );
                            }
                        }

                        AgentEvent::Error(err) => {
                            chat_view.set_status(Some(format!("Error: {}", err)));
                        }

                        _ => {}
                    }
                }

                if let Ok(response) = response_rx.try_recv() {
                    self.finish_agent_response(
                        &mut chat_view,
                        response,
                        &mut current_assistant_message_text,
                        &mut current_tool_map,
                    );
                }

                if pending_response
                    .as_ref()
                    .is_some_and(|handle| handle.is_finished())
                {
                    if let Some(handle) = pending_response.take() {
                        let join_result = tokio::task::block_in_place(|| {
                            tokio::runtime::Handle::current().block_on(handle)
                        });
                        if let Err(error) = join_result {
                            tracing::error!("Agent response task join failed: {}", error);
                            chat_view.set_loading(false);
                            chat_view.set_status(Some(format!("Agent task failed: {}", error)));
                        }
                    }
                    tracing::debug!("Agent response task completed");
                }

                if crossterm::event::poll(Duration::from_millis(16))? {
                    if let Ok(event) = crossterm::event::read() {
                        match event {
                            Event::Key(key) => {
                                if let Some(reason) = self.handle_key_event(
                                    key,
                                    &mut chat_view,
                                    &mut pending_response,
                                    &rt_handle,
                                    &response_tx,
                                    &stream_tx,
                                    &mut current_assistant_message_text,
                                    &mut current_tool_map,
                                )? {
                                    should_quit = true;
                                    exit_reason = reason;
                                }
                            }
                            Event::Resize(_, _) => {}
                            _ => {}
                        }
                    }
                }
            }

            Ok(exit_reason)
        })();

        if let Some(handle) = pending_response.take() {
            handle.abort();
            tracing::info!("Aborted pending CLI agent response on chat exit");
        }

        let restore_result = restore_terminal(terminal);
        tracing::info!("Chat mode exited");

        restore_result?;
        run_result
    }

    fn load_persisted_session(&self) -> Option<Session> {
        let session_id = self.current_persisted_session_id()?;
        self.load_session_by_id(
            &session_id,
            self.workspace_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
        )
    }

    fn current_persisted_session_id(&self) -> Option<String> {
        self.persisted_session_id
            .read()
            .ok()
            .and_then(|session_id| session_id.clone())
    }

    fn set_persisted_session_id(&self, session_id: Option<String>) {
        if let Ok(mut current_session_id) = self.persisted_session_id.write() {
            *current_session_id = session_id;
        } else {
            tracing::warn!("Failed to update CLI chat persisted session id");
        }
    }

    fn finish_agent_response(
        &self,
        chat_view: &mut ChatView,
        response: crate::agent::AgentResponse,
        current_assistant_message_text: &mut String,
        current_tool_map: &mut std::collections::HashMap<String, crate::session::ToolCall>,
    ) {
        if let Some(session_id) = response.session_id {
            chat_view.session.id = session_id.clone();
            self.set_persisted_session_id(Some(session_id));
        }

        current_assistant_message_text.clear();
        current_tool_map.clear();
        chat_view.set_loading(false);
        if response.success {
            chat_view.set_status(None);
        } else if chat_view.status.is_none() {
            chat_view.set_status(Some("Agent response failed".to_string()));
        }
    }

    fn load_session_by_id(
        &self,
        session_id: &str,
        workspace_path: Option<String>,
    ) -> Option<Session> {
        let workspace_path = workspace_path.or_else(|| {
            self.workspace_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string())
        });
        let domain = match workspace_path.as_deref() {
            Some(workspace_path) => {
                let path_manager = sparo_core::infrastructure::try_get_path_manager_arc().ok()?;
                let workspace_id = path_manager
                    .workspace_id(std::path::Path::new(workspace_path))
                    .ok()?;
                sparo_core::agentic::core::SessionDomain::Workspace { workspace_id }
            }
            None => sparo_core::agentic::core::SessionDomain::Global,
        };
        let request = sparo_core::command::session::ShowSessionRequest {
            locator: sparo_core::agentic::core::SessionLocator {
                domain,
                session_id: session_id.to_string(),
            },
        };
        let Ok(handle) = tokio::runtime::Handle::try_current() else {
            return None;
        };
        let detail = tokio::task::block_in_place(|| {
            handle.block_on(sparo_core::command::session::show_session(request))
        });

        match detail {
            Ok(detail) => Some(Session::from_persisted(detail.metadata, detail.turns)),
            Err(error) => {
                tracing::warn!(
                    "Failed to hydrate persisted CLI session {}: {}",
                    session_id,
                    error
                );
                None
            }
        }
    }

    fn fallback_session_from_row(
        row: &sparo_core::command::agentic_os::AgenticOsSessionRow,
        detail: Option<String>,
    ) -> Session {
        let mut session = Session::new(row.agent.clone(), row.workspace.clone());
        session.id = row.id.clone();
        session.title = row.title.clone();
        session.metadata.message_count = 0;
        if let Some(detail) = detail {
            session.add_message("system".to_string(), detail);
        }
        session
    }

    fn fallback_session_from_task(
        task: &sparo_core::command::agentic_os::AgenticOsTaskRow,
        session_id: &str,
        detail: Option<String>,
    ) -> Session {
        let mut session = Session::new(task.agent.clone(), task.workspace.clone());
        session.id = session_id.to_string();
        session.title = task.title.clone();
        session.metadata.message_count = 0;
        if let Some(detail) = detail {
            session.add_message("system".to_string(), detail);
        }
        session
    }

    #[allow(clippy::too_many_arguments)]
    fn handle_key_event(
        &self,
        key: KeyEvent,
        chat_view: &mut ChatView,
        pending_response: &mut Option<tokio::task::JoinHandle<Result<()>>>,
        rt_handle: &tokio::runtime::Handle,
        response_tx: &mpsc::UnboundedSender<crate::agent::AgentResponse>,
        stream_tx: &mpsc::UnboundedSender<crate::agent::AgentEvent>,
        current_assistant_message_text: &mut String,
        current_tool_map: &mut std::collections::HashMap<String, crate::session::ToolCall>,
    ) -> Result<Option<ChatExitReason>> {
        if key.kind != KeyEventKind::Press && key.kind != KeyEventKind::Repeat {
            return Ok(None);
        }

        if self.handle_pending_confirmation_key(key, chat_view, rt_handle, stream_tx) {
            return Ok(None);
        }

        if chat_view.overlay.is_some() {
            return self.handle_overlay_key(key, chat_view);
        }

        if shortcut_matches(&self.config.shortcuts.interrupt, key) && pending_response.is_some() {
            self.interrupt_pending_response(
                chat_view,
                pending_response,
                current_assistant_message_text,
                current_tool_map,
            );
            return Ok(None);
        }

        if shortcut_matches(&self.config.shortcuts.menu, key)
            && !matches!(key.code, KeyCode::Esc)
            && !chat_view.browse_mode
        {
            return self.handle_menu_shortcut(chat_view);
        }

        if shortcut_matches(&self.config.shortcuts.send_message, key)
            && !matches!(key.code, KeyCode::Enter)
        {
            if pending_response.is_none() {
                self.submit_chat_input(
                    chat_view,
                    pending_response,
                    rt_handle,
                    response_tx,
                    stream_tx,
                    current_assistant_message_text,
                    current_tool_map,
                )?;
            }
            return Ok(None);
        }

        match (key.code, key.modifiers) {
            (KeyCode::Char('c'), KeyModifiers::CONTROL) => {
                tracing::info!("User requested quit");
                return Ok(Some(ChatExitReason::Quit));
            }

            (KeyCode::Char('l'), KeyModifiers::CONTROL) => {
                if pending_response.is_some() {
                    chat_view.set_status(Some(
                        "Wait for the current response before clearing".to_string(),
                    ));
                    return Ok(None);
                }
                chat_view.clear_screen();
                chat_view.set_status(Some("Conversation cleared".to_string()));
            }

            (KeyCode::Char('t'), KeyModifiers::CONTROL) => {
                self.open_snapshot_panel(PanelKind::Tasks, chat_view)?;
            }

            (KeyCode::Char('p'), KeyModifiers::CONTROL) => {
                self.open_snapshot_panel(PanelKind::Apps, chat_view)?;
            }

            (KeyCode::Char('y'), KeyModifiers::CONTROL) => {
                self.open_snapshot_panel(PanelKind::Memory, chat_view)?;
            }

            (KeyCode::Char('o'), KeyModifiers::CONTROL) => {
                self.open_snapshot_panel(PanelKind::Workspaces, chat_view)?;
            }

            (KeyCode::Char(','), KeyModifiers::CONTROL) => {
                self.open_snapshot_panel(PanelKind::Settings, chat_view)?;
            }

            (KeyCode::Char('b'), KeyModifiers::CONTROL) => {
                tracing::info!("User returning to Agentic OS home");
                return self.handle_menu_shortcut(chat_view);
            }

            (KeyCode::Enter, _) => {
                if pending_response.is_some() {
                    return Ok(None);
                }

                self.submit_chat_input(
                    chat_view,
                    pending_response,
                    rt_handle,
                    response_tx,
                    stream_tx,
                    current_assistant_message_text,
                    current_tool_map,
                )?;
            }

            (KeyCode::Backspace, _) => {
                chat_view.handle_backspace();
            }

            (KeyCode::Left, _) => {
                chat_view.move_cursor_left();
            }
            (KeyCode::Right, _) => {
                chat_view.move_cursor_right();
            }

            (KeyCode::Up, _) => {
                if chat_view.browse_mode {
                    chat_view.scroll_up(1);
                } else {
                    chat_view.history_prev();
                }
            }
            (KeyCode::Down, _) => {
                if chat_view.browse_mode {
                    chat_view.scroll_down(1);
                } else {
                    chat_view.history_next();
                }
            }

            (KeyCode::Home, KeyModifiers::CONTROL) => {
                chat_view.scroll_to_top();
                chat_view.set_status(Some("Jumped to conversation top".to_string()));
            }

            (KeyCode::End, KeyModifiers::CONTROL) => {
                chat_view.scroll_to_bottom();
                chat_view.set_status(Some("Jumped to conversation bottom".to_string()));
            }

            (KeyCode::Home, _) => {
                chat_view.cursor = 0;
            }

            (KeyCode::End, _) => {
                chat_view.move_cursor_to_end();
            }

            (KeyCode::Char('u'), KeyModifiers::CONTROL) => {
                chat_view.clear_input();
            }

            (KeyCode::Char('e'), KeyModifiers::CONTROL) => {
                chat_view.toggle_browse_mode();
                let status_msg = if chat_view.browse_mode {
                    "Entered browse mode, use Up/Down or PageUp/PageDown to scroll"
                } else {
                    "Exited browse mode, back to normal input"
                };
                chat_view.set_status(Some(status_msg.to_string()));
            }

            (KeyCode::PageUp, _) => {
                chat_view.scroll_up(10);
            }

            (KeyCode::PageDown, _) => {
                chat_view.scroll_down(10);
            }

            (KeyCode::Esc, _) => {
                if chat_view.browse_mode {
                    chat_view.scroll_to_bottom();
                    chat_view.set_status(Some("Exited browse mode".to_string()));
                } else if !chat_view.input.trim().is_empty() {
                    chat_view.clear_input();
                    chat_view.set_status(Some(
                        "Draft cleared; press Esc again to return home".to_string(),
                    ));
                } else {
                    tracing::info!("User returning to Agentic OS home via Esc");
                    return self.handle_menu_shortcut(chat_view);
                }
            }

            (KeyCode::Char('/'), KeyModifiers::NONE | KeyModifiers::SHIFT)
                if chat_view.input.is_empty() =>
            {
                chat_view.open_overlay(OverlayState::command_palette());
            }

            (KeyCode::Char(c), KeyModifiers::NONE | KeyModifiers::SHIFT) => {
                if !c.is_control() && c != '\u{0}' {
                    chat_view.handle_char(c);
                }
            }

            _ => {}
        }

        Ok(None)
    }

    #[allow(clippy::too_many_arguments)]
    fn submit_chat_input(
        &self,
        chat_view: &mut ChatView,
        pending_response: &mut Option<tokio::task::JoinHandle<Result<()>>>,
        rt_handle: &tokio::runtime::Handle,
        response_tx: &mpsc::UnboundedSender<crate::agent::AgentResponse>,
        stream_tx: &mpsc::UnboundedSender<crate::agent::AgentEvent>,
        current_assistant_message_text: &mut String,
        current_tool_map: &mut std::collections::HashMap<String, crate::session::ToolCall>,
    ) -> Result<()> {
        if chat_view.input.trim_start().starts_with('/') {
            if let Some(input) = chat_view.take_input() {
                tracing::info!("User command: {}", input);
                self.handle_command(&input, chat_view)?;
            }
            return Ok(());
        }

        let Some(input) = chat_view.send_input() else {
            return Ok(());
        };

        tracing::info!("User input: {}", input);

        chat_view.set_loading(true);
        chat_view.set_status(Some(format!("{} is thinking...", chat_view.session.agent)));
        chat_view
            .session
            .add_message("assistant".to_string(), String::new());

        current_assistant_message_text.clear();
        current_tool_map.clear();

        let agent = Arc::clone(&self.agent);
        let input_clone = input.clone();
        let resp_tx = response_tx.clone();
        let stream_tx_clone = stream_tx.clone();

        let handle_clone = rt_handle.spawn(async move {
            match agent
                .process_message(input_clone, stream_tx_clone.clone())
                .await
            {
                Ok(response) => {
                    tracing::info!(
                        "Agent response complete: {} tool calls",
                        response.tool_calls.len()
                    );
                    let _ = resp_tx.send(response);
                }
                Err(e) => {
                    tracing::error!("Agent processing failed: {}", e);
                    let _ = stream_tx_clone.send(crate::agent::AgentEvent::Error(e.to_string()));
                    let _ = resp_tx.send(crate::agent::AgentResponse {
                        session_id: None,
                        tool_calls: vec![],
                        success: false,
                    });
                }
            }
            Ok(())
        });

        *pending_response = Some(handle_clone);
        Ok(())
    }

    fn interrupt_pending_response(
        &self,
        chat_view: &mut ChatView,
        pending_response: &mut Option<tokio::task::JoinHandle<Result<()>>>,
        current_assistant_message_text: &mut String,
        current_tool_map: &mut std::collections::HashMap<String, crate::session::ToolCall>,
    ) {
        let Some(handle) = pending_response.take() else {
            return;
        };
        handle.abort();
        if !current_assistant_message_text.is_empty() {
            chat_view
                .session
                .update_last_message_text_flow(current_assistant_message_text.clone(), false);
        }
        current_assistant_message_text.clear();
        current_tool_map.clear();
        chat_view.set_loading(false);
        chat_view.set_status(Some("Response interrupted".to_string()));
    }

    fn handle_menu_shortcut(&self, chat_view: &mut ChatView) -> Result<Option<ChatExitReason>> {
        if !chat_view.input.trim().is_empty() {
            chat_view.clear_input();
            chat_view.set_status(Some(
                "Draft cleared; use the menu shortcut again to return home".to_string(),
            ));
            return Ok(None);
        }

        chat_view.set_status(Some("Returning to Agentic OS home...".to_string()));
        Ok(Some(ChatExitReason::BackToMenu {
            workspace: chat_view.session.workspace.clone(),
            session_id: self.current_persisted_session_id(),
        }))
    }

    fn handle_pending_confirmation_key(
        &self,
        key: KeyEvent,
        chat_view: &mut ChatView,
        rt_handle: &tokio::runtime::Handle,
        stream_tx: &mpsc::UnboundedSender<crate::agent::AgentEvent>,
    ) -> bool {
        let Some(pending) = chat_view.pending_tool_confirmation.clone() else {
            return false;
        };

        match (key.code, key.modifiers) {
            (KeyCode::Char('c'), KeyModifiers::CONTROL)
            | (KeyCode::Char('b'), KeyModifiers::CONTROL)
            | (KeyCode::Esc, _) => false,
            (KeyCode::Char('y') | KeyCode::Char('Y'), KeyModifiers::NONE | KeyModifiers::SHIFT) => {
                let agent = Arc::clone(&self.agent);
                let stream_tx = stream_tx.clone();
                let tool_id = pending.tool_id.clone();
                let tool_name = pending.tool_name.clone();
                chat_view.clear_pending_tool_confirmation(&tool_id);
                chat_view
                    .session
                    .update_tool_in_last_message(&tool_id, |t| {
                        t.status = ToolCallStatus::Confirmed;
                        t.progress_message = Some("Confirmed".to_string());
                    });
                chat_view.set_status(Some(format!("Confirmed {}; continuing...", tool_name)));
                rt_handle.spawn(async move {
                    if let Err(error) = agent.confirm_tool(&tool_id, None).await {
                        let _ = stream_tx.send(crate::agent::AgentEvent::Error(format!(
                            "Failed to confirm {}: {}",
                            tool_name, error
                        )));
                    }
                });
                true
            }
            (KeyCode::Char('n') | KeyCode::Char('N'), KeyModifiers::NONE | KeyModifiers::SHIFT) => {
                let agent = Arc::clone(&self.agent);
                let stream_tx = stream_tx.clone();
                let tool_id = pending.tool_id.clone();
                let tool_name = pending.tool_name.clone();
                let reason = "Rejected from Sparo CLI TUI".to_string();
                chat_view.clear_pending_tool_confirmation(&tool_id);
                chat_view
                    .session
                    .update_tool_in_last_message(&tool_id, |t| {
                        t.status = ToolCallStatus::Rejected;
                        t.result = Some(reason.clone());
                        t.progress_message = Some("Rejected".to_string());
                    });
                chat_view.set_status(Some(format!("Rejected {}; continuing...", tool_name)));
                rt_handle.spawn(async move {
                    if let Err(error) = agent.reject_tool(&tool_id, reason).await {
                        let _ = stream_tx.send(crate::agent::AgentEvent::Error(format!(
                            "Failed to reject {}: {}",
                            tool_name, error
                        )));
                    }
                });
                true
            }
            _ => {
                chat_view.set_status(Some(format!(
                    "{} needs confirmation. Press y to run, n to reject.",
                    pending.tool_name
                )));
                true
            }
        }
    }

    fn handle_overlay_key(
        &self,
        key: KeyEvent,
        chat_view: &mut ChatView,
    ) -> Result<Option<ChatExitReason>> {
        if matches!((key.code, key.modifiers), (KeyCode::Enter, _)) {
            if let Some(overlay) = chat_view.overlay.as_ref() {
                if let OverlayKind::Panel(kind) = overlay.kind {
                    if overlay.selected >= panel_count(overlay) {
                        chat_view.set_status(Some(empty_panel_status(kind).to_string()));
                        return Ok(None);
                    }
                }
            }
        }
        if matches!(key.code, KeyCode::Char('R'))
            || matches!(
                (key.code, key.modifiers),
                (KeyCode::Char('r'), KeyModifiers::SHIFT)
            )
        {
            if let Some(overlay) = chat_view.overlay.as_ref() {
                if let OverlayKind::Panel(kind) = overlay.kind {
                    if overlay.filter.is_empty() {
                        let selected = overlay.selected;
                        self.open_snapshot_panel_at(kind, chat_view, selected)?;
                        chat_view.set_status(Some(format!("Refreshed {}", kind.title())));
                        return Ok(None);
                    }
                }
            }
        }

        let Some(overlay) = chat_view.overlay.as_mut() else {
            return Ok(None);
        };

        let mut clear_status_after_filter_change = false;
        match (key.code, key.modifiers) {
            (KeyCode::Esc, _) => {
                if matches!(overlay.kind, OverlayKind::Panel(_)) && !overlay.filter.is_empty() {
                    overlay.filter.clear();
                    overlay.selected = 0;
                    clear_status_after_filter_change = true;
                } else {
                    chat_view.close_overlay();
                }
            }
            (KeyCode::Up, _) => {
                let count = match overlay.kind {
                    OverlayKind::CommandPalette => {
                        command_count(CommandScope::Chat, &overlay.filter)
                    }
                    OverlayKind::Panel(_) => panel_count(overlay),
                    OverlayKind::Help => 0,
                };
                move_selection(overlay, -1, count);
            }
            (KeyCode::Down, _) => {
                let count = match overlay.kind {
                    OverlayKind::CommandPalette => {
                        command_count(CommandScope::Chat, &overlay.filter)
                    }
                    OverlayKind::Panel(_) => panel_count(overlay),
                    OverlayKind::Help => 0,
                };
                move_selection(overlay, 1, count);
            }
            (KeyCode::PageUp, _) => {
                let count = overlay_item_count(overlay, CommandScope::Chat);
                jump_selection(overlay, SelectionJump::PageUp(8), count);
            }
            (KeyCode::PageDown, _) => {
                let count = overlay_item_count(overlay, CommandScope::Chat);
                jump_selection(overlay, SelectionJump::PageDown(8), count);
            }
            (KeyCode::Home, _) => {
                let count = overlay_item_count(overlay, CommandScope::Chat);
                jump_selection(overlay, SelectionJump::First, count);
            }
            (KeyCode::End, _) => {
                let count = overlay_item_count(overlay, CommandScope::Chat);
                jump_selection(overlay, SelectionJump::Last, count);
            }
            (KeyCode::Backspace, _) if overlay.kind == OverlayKind::CommandPalette => {
                overlay.filter.pop();
                overlay.selected = 0;
                clear_status_after_filter_change = true;
            }
            (KeyCode::Backspace, _) if matches!(overlay.kind, OverlayKind::Panel(_)) => {
                overlay.filter.pop();
                overlay.selected = 0;
                clear_status_after_filter_change = true;
            }
            (KeyCode::Char('u'), KeyModifiers::CONTROL)
                if matches!(
                    overlay.kind,
                    OverlayKind::CommandPalette | OverlayKind::Panel(_)
                ) =>
            {
                overlay.filter.clear();
                overlay.selected = 0;
                clear_status_after_filter_change = true;
            }
            (KeyCode::Char(c), KeyModifiers::NONE | KeyModifiers::SHIFT)
                if overlay.kind == OverlayKind::CommandPalette =>
            {
                if !c.is_control() && c != '/' {
                    overlay.filter.push(c);
                    overlay.selected = 0;
                    clear_status_after_filter_change = true;
                }
            }
            (KeyCode::Char(c), KeyModifiers::NONE | KeyModifiers::SHIFT)
                if matches!(overlay.kind, OverlayKind::Panel(_)) =>
            {
                if !c.is_control() && c != '/' {
                    overlay.filter.push(c);
                    overlay.selected = 0;
                    clear_status_after_filter_change = true;
                }
            }
            (KeyCode::Enter, _) => match overlay.kind {
                OverlayKind::CommandPalette => {
                    if let Some((action, args)) =
                        typed_command_action(&overlay.filter, CommandScope::Chat)
                    {
                        chat_view.close_overlay();
                        self.apply_command_action(action, &args, chat_view)?;
                    } else if let Some(command) = selected_command(overlay, CommandScope::Chat) {
                        chat_view.close_overlay();
                        self.apply_command_action(command.action, "", chat_view)?;
                    } else {
                        chat_view.set_status(Some(
                            "No matching command; edit the filter or press Esc".to_string(),
                        ));
                    }
                }
                OverlayKind::Panel(PanelKind::Workspaces) => {
                    if let Some(workspace) = selected_workspace(overlay) {
                        let detail = selected_panel_detail(overlay);
                        chat_view.close_overlay();
                        let (workspace_path, session_workspace, workspace_label) =
                            effective_workspace_selection(workspace);
                        self.agent.set_workspace_path(workspace_path);
                        self.set_persisted_session_id(None);
                        chat_view.session.workspace = session_workspace;
                        if let Some(detail) = detail {
                            chat_view.add_message("system".to_string(), detail);
                        }
                        chat_view.replace_input_preserving_draft(
                            workspace_selection_followup_prompt(&workspace_label),
                        );
                        chat_view.set_status(Some(format!(
                            "Workspace selected: {}; press Enter to analyze",
                            workspace_label
                        )));
                    }
                }
                OverlayKind::Panel(PanelKind::Memory) => {
                    if let Some(memory_file) = selected_memory_file(overlay) {
                        let detail = selected_panel_detail(overlay);
                        let preview = preview_text_file(&memory_file, 80, 4000);
                        match preview {
                            Ok(preview) => {
                                chat_view.close_overlay();
                                if let Some(detail) = detail {
                                    chat_view.add_message("system".to_string(), detail);
                                }
                                chat_view.add_message(
                                    "system".to_string(),
                                    format!(
                                        "Memory preview: {}\n\n{}",
                                        memory_file.display(),
                                        preview
                                    ),
                                );
                                chat_view.replace_input_preserving_draft(
                                    memory_preview_followup_prompt(&memory_file),
                                );
                                chat_view.set_status(Some(
                                    "Loaded memory preview; press Enter to analyze".to_string(),
                                ));
                            }
                            Err(error) => {
                                chat_view.set_status(Some(format!(
                                    "Failed to read memory file: {}",
                                    error
                                )));
                            }
                        }
                    }
                }
                OverlayKind::Panel(PanelKind::Sessions) => {
                    if let Some(row) = selected_session_row(overlay) {
                        let detail = selected_panel_detail(overlay);
                        chat_view.close_overlay();
                        let workspace_path = row.workspace.as_ref().map(PathBuf::from);
                        if let Err(error) = self.agent.set_session_context(
                            row.id.clone(),
                            workspace_path,
                            row.agent.clone(),
                        ) {
                            chat_view
                                .set_status(Some(format!("Failed to switch session: {}", error)));
                            return Ok(None);
                        }

                        chat_view.session = self
                            .load_session_by_id(&row.id, row.workspace.clone())
                            .unwrap_or_else(|| Self::fallback_session_from_row(&row, detail));
                        self.set_persisted_session_id(Some(row.id.clone()));
                        chat_view.clear_input();
                        chat_view.set_loading(false);
                        chat_view.set_status(Some(format!(
                            "Resumed {}; type a message to continue",
                            row.title
                        )));
                    }
                }
                OverlayKind::Panel(PanelKind::Tasks) => {
                    let detail = selected_panel_detail(overlay);
                    if let Some(task) = selected_task_row(overlay) {
                        if let Some(session_id) = task.session_id.clone() {
                            chat_view.close_overlay();
                            let workspace_path = task.workspace.as_ref().map(PathBuf::from);
                            if let Err(error) = self.agent.set_session_context(
                                session_id.clone(),
                                workspace_path,
                                task.agent.clone(),
                            ) {
                                chat_view.set_status(Some(format!(
                                    "Failed to switch task session: {}",
                                    error
                                )));
                                return Ok(None);
                            }

                            chat_view.session = self
                                .load_session_by_id(&session_id, task.workspace.clone())
                                .unwrap_or_else(|| {
                                    Self::fallback_session_from_task(&task, &session_id, detail)
                                });
                            self.set_persisted_session_id(Some(session_id));
                            chat_view.clear_input();
                            chat_view.set_loading(false);
                            chat_view.set_status(Some(format!(
                                "Resumed task {}; type a message to continue",
                                task.title
                            )));
                        } else {
                            chat_view.close_overlay();
                            if let Err(error) = self.agent.set_agent_type(task.agent.clone()) {
                                chat_view.set_status(Some(format!(
                                    "Failed to switch task agent: {}",
                                    error
                                )));
                                return Ok(None);
                            }
                            self.agent.reset_session();
                            self.set_persisted_session_id(None);
                            chat_view.session.agent = task.agent.clone();
                            if let Some(detail) = detail {
                                chat_view.add_message("system".to_string(), detail);
                            }
                            chat_view.replace_input_preserving_draft(
                                task_without_session_followup_prompt(&task.title, &task.agent),
                            );
                            chat_view.set_status(Some(format!(
                                "Loaded task context for {}; press Enter to analyze",
                                task.agent
                            )));
                        }
                    }
                }
                OverlayKind::Panel(kind @ (PanelKind::Apps | PanelKind::Settings)) => {
                    let detail = selected_panel_detail(overlay);
                    let prompt = panel_analysis_followup_prompt(kind);
                    chat_view.close_overlay();
                    if let Some(detail) = detail {
                        chat_view.add_message("system".to_string(), detail);
                    }
                    if let Some(prompt) = prompt {
                        chat_view.replace_input_preserving_draft(prompt.to_string());
                        chat_view.set_status(Some(prepared_panel_status(kind).to_string()));
                    }
                }
                OverlayKind::Help => {
                    chat_view.close_overlay();
                }
            },
            _ => {}
        }

        if clear_status_after_filter_change {
            chat_view.set_status(None);
        }

        Ok(None)
    }

    /// Handle shortcut commands
    fn handle_command(&self, command: &str, chat_view: &mut ChatView) -> Result<()> {
        let parts: Vec<&str> = command.split_whitespace().collect();
        if parts.is_empty() {
            return Ok(());
        }

        if let Some(spec) = command_for_slash(parts[0], CommandScope::Chat) {
            let args = command.trim_start_matches(parts[0]).trim();
            self.apply_command_action(spec.action, args, chat_view)?;
        } else {
            chat_view.open_overlay(OverlayState {
                kind: OverlayKind::CommandPalette,
                selected: 0,
                filter: parts[0].trim_start_matches('/').to_string(),
                snapshot: None,
            });
            chat_view.set_status(Some(format!(
                "No command matched {}; choose one from the palette",
                parts[0]
            )));
        }

        Ok(())
    }

    fn apply_command_action(
        &self,
        action: CommandAction,
        args: &str,
        chat_view: &mut ChatView,
    ) -> Result<()> {
        match action {
            CommandAction::OpenPanel(kind) => self.open_snapshot_panel(kind, chat_view)?,
            CommandAction::OpenPanelAt(kind, selected) => {
                self.open_snapshot_panel_at(kind, chat_view, selected)?;
            }
            CommandAction::Help => chat_view.open_overlay(OverlayState::help()),
            CommandAction::ClearChat => {
                if chat_view.loading {
                    chat_view.set_status(Some(
                        "Wait for the current response before clearing".to_string(),
                    ));
                } else {
                    chat_view.clear_screen();
                    chat_view.set_status(Some("Conversation cleared".to_string()));
                }
            }
            CommandAction::Dispatch => {
                if args.is_empty() {
                    chat_view.set_status(Some("Usage: /dispatch <task>".to_string()));
                } else {
                    chat_view.replace_input_preserving_draft(format!(
                        "Delegate this work to the right specialized Agent: {}",
                        args
                    ));
                    chat_view.set_status(Some(
                        "Prepared delegation prompt; press Enter to send".to_string(),
                    ));
                }
            }
            CommandAction::ShowAgents => {
                chat_view.add_message("system".to_string(), live_agents_message()?);
            }
            CommandAction::ShowHistory => {
                chat_view.add_message(
                    "system".to_string(),
                    session_history_summary(&chat_view.session),
                );
            }
            CommandAction::ExportSession => {
                chat_view.add_message(
                    "system".to_string(),
                    session_export_guidance(
                        &chat_view.session,
                        self.current_persisted_session_id().as_deref(),
                    ),
                );
            }
            CommandAction::NewSession => {
                if chat_view.loading {
                    chat_view.set_status(Some(
                        "Wait for the current response before starting a new session".to_string(),
                    ));
                } else {
                    if let Err(error) = self.agent.set_agent_type(self.agent_name.clone()) {
                        chat_view.set_status(Some(format!(
                            "Failed to reset agent for new session: {}",
                            error
                        )));
                        return Ok(());
                    }
                    self.agent.reset_session();
                    self.set_persisted_session_id(None);
                    chat_view.start_new_session_with_agent(self.agent_name.clone());
                    chat_view.set_status(Some("Started a fresh session".to_string()));
                }
            }
        }

        Ok(())
    }

    fn open_snapshot_panel(&self, kind: PanelKind, chat_view: &mut ChatView) -> Result<()> {
        self.open_snapshot_panel_at(kind, chat_view, 0)
    }

    fn open_snapshot_panel_at(
        &self,
        kind: PanelKind,
        chat_view: &mut ChatView,
        selected: usize,
    ) -> Result<()> {
        let workspace = chat_view.session.workspace.clone().or_else(|| {
            self.workspace_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string())
        });
        let snapshot = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current()
                .block_on(crate::ui::startup::StartupPage::load_snapshot(workspace))
        });

        self.open_snapshot_overlay(kind, snapshot, selected, chat_view);
        Ok(())
    }

    fn open_snapshot_overlay(
        &self,
        kind: PanelKind,
        snapshot: sparo_core::command::agentic_os::AgenticOsSnapshot,
        selected: usize,
        chat_view: &mut ChatView,
    ) {
        let mut overlay = OverlayState::panel(kind, snapshot);
        overlay.selected = clamp_panel_selection(&overlay, selected);
        let is_empty = panel_count(&overlay) == 0;
        chat_view.open_overlay(overlay);
        if is_empty {
            chat_view.set_status(Some(empty_panel_status(kind).to_string()));
        } else {
            chat_view.set_status(None);
        }
    }
}

fn clamp_panel_selection(overlay: &OverlayState, selected: usize) -> usize {
    let count = panel_count(overlay);
    if count == 0 {
        0
    } else {
        selected.min(count.saturating_sub(1))
    }
}

fn session_history_summary(session: &Session) -> String {
    format!(
        "Current session\n\
         - Title: {}\n\
         - Session: {}\n\
         - Agent: {}\n\
         - Workspace: {}\n\
         - Messages: {}\n\
         - Tool calls: {}\n\
         - Files modified: {}\n\
         - Updated: {}\n\n\
         Use `/export` for the exact persisted-session export command.",
        session.title,
        session.id,
        session.agent,
        session.workspace.as_deref().unwrap_or("global"),
        session.metadata.message_count,
        session.metadata.tool_calls,
        session.metadata.files_modified,
        session.updated_at.to_rfc3339(),
    )
}

fn live_agents_message() -> Result<String> {
    let handle = tokio::runtime::Handle::current();
    let agents = tokio::task::block_in_place(|| {
        handle.block_on(sparo_core::agentic::agents::get_agent_registry().list_agents_info())
    })?;
    Ok(agents_registry_message(&agents))
}

fn session_export_guidance(session: &Session, persisted_session_id: Option<&str>) -> String {
    let workspace_arg = workspace_option(session.workspace.as_deref());
    let export_id = persisted_session_id.unwrap_or("last");
    let export_id_arg = shell_arg(export_id);
    let inspect_command = if export_id == "last" {
        format!("sparo sessions{} last", workspace_arg)
    } else {
        format!("sparo sessions{} show {}", workspace_arg, export_id_arg)
    };
    let resume_command = format!("sparo sessions{} resume {}", workspace_arg, export_id_arg);
    let export_command = format!(
        "sparo sessions{} export {} --output session.md",
        workspace_arg, export_id_arg
    );
    let list_command = format!("sparo sessions{} list", workspace_arg);
    let session_note = if persisted_session_id.is_some() {
        format!(
            "This TUI transcript is bound to persisted core session `{}`.",
            export_id
        )
    } else {
        "This live TUI transcript has not been bound to a persisted core session yet; send a turn first, or use `last` after another saved turn.".to_string()
    };

    format!(
        "Session export\n\
         - Current transcript: {}\n\
         - Workspace: {}\n\
         - {}\n\n\
         Commands:\n\
         - Inspect: {}\n\
         - Resume: {}\n\
         - Export: {}\n\
         - List: {}",
        session.id,
        session.workspace.as_deref().unwrap_or("global"),
        session_note,
        inspect_command,
        resume_command,
        export_command,
        list_command,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{AgentEvent, AgentResponse};
    use crate::session::ToolCall;
    use sparo_core::command::agentic_os::{
        AgenticOsAppRow, AgenticOsMemoryRow, AgenticOsSessionRow, AgenticOsSnapshot,
        AgenticOsTaskRow, AgenticOsWorkspaceRow,
    };
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeAgent {
        workspace_path: Mutex<Option<PathBuf>>,
        agent_type: Mutex<Option<String>>,
        session_context: Mutex<Option<(String, Option<PathBuf>, String)>>,
        confirmed_tools: Mutex<Vec<String>>,
        rejected_tools: Mutex<Vec<(String, String)>>,
    }

    #[async_trait::async_trait]
    impl Agent for FakeAgent {
        async fn process_message(
            &self,
            _message: String,
            _event_tx: mpsc::UnboundedSender<AgentEvent>,
        ) -> Result<AgentResponse> {
            Ok(AgentResponse {
                session_id: Some("fake-session".to_string()),
                tool_calls: Vec::new(),
                success: true,
            })
        }

        fn name(&self) -> String {
            "fake".to_string()
        }

        fn set_workspace_path(&self, workspace_path: Option<PathBuf>) {
            *self.workspace_path.lock().unwrap() = workspace_path;
        }

        fn set_agent_type(&self, agent_type: String) -> Result<()> {
            *self.agent_type.lock().unwrap() = Some(agent_type);
            Ok(())
        }

        fn set_session_context(
            &self,
            session_id: String,
            workspace_path: Option<PathBuf>,
            agent_type: String,
        ) -> Result<()> {
            *self.session_context.lock().unwrap() = Some((session_id, workspace_path, agent_type));
            Ok(())
        }

        fn reset_session(&self) {}

        async fn confirm_tool(
            &self,
            tool_id: &str,
            _updated_input: Option<serde_json::Value>,
        ) -> Result<()> {
            self.confirmed_tools
                .lock()
                .unwrap()
                .push(tool_id.to_string());
            Ok(())
        }

        async fn reject_tool(&self, tool_id: &str, reason: String) -> Result<()> {
            self.rejected_tools
                .lock()
                .unwrap()
                .push((tool_id.to_string(), reason));
            Ok(())
        }
    }

    fn sample_snapshot(memory_target: Option<String>) -> AgenticOsSnapshot {
        AgenticOsSnapshot {
            model: "test-model".to_string(),
            current_workspace: Some("D:\\workspace\\project".to_string()),
            git_branch: Some("git main".to_string()),
            sessions: vec![AgenticOsSessionRow {
                id: "session-1".to_string(),
                title: "Build CLI".to_string(),
                agent: "OSAgent".to_string(),
                workspace: Some("D:\\workspace\\project".to_string()),
                parent_session_id: None,
                is_dispatch_task: false,
                turns: 3,
                child_count: 1,
                last_active_at: 1_700_000_000_000,
            }],
            works: Vec::new(),
            tasks: vec![AgenticOsTaskRow {
                title: "Fix bug".to_string(),
                agent: "bitfun-debug".to_string(),
                status: "active".to_string(),
                detail: "2 turns".to_string(),
                session_id: Some("task-session".to_string()),
                workspace: Some("D:\\workspace\\project".to_string()),
            }],
            apps: vec![AgenticOsAppRow {
                id: "files".to_string(),
                slot_id: "files".to_string(),
                name: "Files".to_string(),
                state: "active".to_string(),
                owner: "system".to_string(),
                description: "Browse files".to_string(),
                active_release_id: Some("release-files-1".to_string()),
                latest_release_id: Some("release-files-1".to_string()),
                version: Some("1.0.0".to_string()),
                capability_fingerprint: Some("sha256:files".to_string()),
            }],
            memories: vec![AgenticOsMemoryRow {
                scope: "PROJECT".to_string(),
                file: "notes.md".to_string(),
                target: memory_target
                    .unwrap_or_else(|| "D:\\workspace\\project\\.sparo_os".to_string()),
            }],
            workspaces: vec![AgenticOsWorkspaceRow {
                label: "project".to_string(),
                path: Some("D:\\workspace\\project".to_string()),
                git: Some("git main".to_string()),
                session_count: 1,
            }],
        }
    }

    fn chat_mode_with_fake_agent(fake: Arc<FakeAgent>) -> ChatMode {
        let agent: Arc<dyn Agent> = fake;
        ChatMode {
            config: CliConfig::default(),
            agent_name: "OSAgent".to_string(),
            workspace_path: None,
            agent,
            initial_input: None,
            initial_context_messages: Vec::new(),
            persisted_session_id: RwLock::new(None),
        }
    }

    fn chat_view_with_overlay(kind: PanelKind, snapshot: AgenticOsSnapshot) -> ChatView {
        let session = Session::new("OSAgent".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());
        view.open_overlay(OverlayState::panel(kind, snapshot));
        view
    }

    #[test]
    fn chat_response_records_core_session_id_for_export_and_home_focus() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let session = Session::new("OSAgent".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());
        view.set_loading(true);
        let mut assistant_text = "partial".to_string();
        let mut tool_map = std::collections::HashMap::from([(
            "tool-1".to_string(),
            ToolCall {
                tool_id: Some("tool-1".to_string()),
                tool_name: "BashTool".to_string(),
                parameters: serde_json::json!({}),
                result: None,
                status: crate::session::ToolCallStatus::Running,
                progress: None,
                progress_message: None,
                duration_ms: None,
            },
        )]);

        mode.finish_agent_response(
            &mut view,
            AgentResponse {
                session_id: Some("core-session-1".to_string()),
                tool_calls: Vec::new(),
                success: true,
            },
            &mut assistant_text,
            &mut tool_map,
        );

        assert_eq!(view.session.id, "core-session-1");
        assert_eq!(
            mode.current_persisted_session_id().as_deref(),
            Some("core-session-1")
        );
        assert!(assistant_text.is_empty());
        assert!(tool_map.is_empty());
        assert!(!view.loading);
        assert!(view.status.is_none());
    }

    #[test]
    fn chat_overlay_enter_resumes_task_panel_session() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake.clone());
        let mut view = chat_view_with_overlay(PanelKind::Tasks, sample_snapshot(None));
        view.input = "keep this draft".to_string();
        view.cursor = view.input.chars().count();

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert!(view.overlay.is_none());
        assert!(view.input.is_empty());
        assert_eq!(view.session.id, "task-session");
        assert_eq!(view.session.title, "Fix bug");
        assert_eq!(view.session.agent, "bitfun-debug");
        assert_eq!(
            view.session.workspace.as_deref(),
            Some("D:\\workspace\\project")
        );
        assert_eq!(
            view.status.as_deref(),
            Some("Resumed task Fix bug; type a message to continue")
        );
        assert!(view
            .session
            .messages
            .last()
            .unwrap()
            .content
            .contains("Task detail"));
        let context = fake.session_context.lock().unwrap().clone().unwrap();
        assert_eq!(context.0, "task-session");
        assert_eq!(
            context
                .1
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            Some("D:\\workspace\\project".to_string())
        );
        assert_eq!(context.2, "bitfun-debug");
        assert_eq!(
            mode.current_persisted_session_id().as_deref(),
            Some("task-session")
        );
    }

    #[test]
    fn chat_overlay_enter_loads_task_context_without_session_id() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake.clone());
        let mut snapshot = sample_snapshot(None);
        snapshot.tasks[0].session_id = None;
        let mut view = chat_view_with_overlay(PanelKind::Tasks, snapshot);
        view.input = "keep this draft".to_string();
        view.cursor = view.input.chars().count();

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert!(view.overlay.is_none());
        assert_eq!(view.session.agent, "bitfun-debug");
        assert!(view.input.contains("Use the task detail above"));
        assert!(view.input.contains("Fix bug"));
        assert!(!view.input.contains("sparo tasks"));
        assert!(view
            .session
            .messages
            .last()
            .unwrap()
            .content
            .contains("Task detail"));
        assert_eq!(
            view.status.as_deref(),
            Some("Loaded task context for bitfun-debug; press Enter to analyze")
        );
        assert_eq!(
            view.input_history.front().map(String::as_str),
            Some("keep this draft")
        );
        assert!(mode.current_persisted_session_id().is_none());
        assert_eq!(
            fake.agent_type.lock().unwrap().as_deref(),
            Some("bitfun-debug")
        );
        assert!(fake.session_context.lock().unwrap().is_none());
    }

    #[test]
    fn prepared_panel_status_matches_direct_context_actions() {
        assert_eq!(
            prepared_panel_status(PanelKind::Sessions),
            "Resumed session; type a message to continue"
        );
        assert_eq!(
            prepared_panel_status(PanelKind::Memory),
            "Loaded memory preview; press Enter to analyze"
        );
        assert_eq!(
            prepared_panel_status(PanelKind::Workspaces),
            "Workspace selected; press Enter to analyze"
        );
    }

    #[test]
    fn chat_overlay_enter_resumes_session_panel_selection() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake.clone());
        let mut view = chat_view_with_overlay(PanelKind::Sessions, sample_snapshot(None));
        view.input = "draft should clear".to_string();
        view.cursor = view.input.chars().count();

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert!(view.overlay.is_none());
        assert!(view.input.is_empty());
        assert_eq!(view.session.id, "session-1");
        assert_eq!(view.session.title, "Build CLI");
        assert_eq!(view.session.agent, "OSAgent");
        assert_eq!(
            view.session.workspace.as_deref(),
            Some("D:\\workspace\\project")
        );
        assert!(view
            .session
            .messages
            .last()
            .unwrap()
            .content
            .contains("Session detail"));
        assert_eq!(
            view.status.as_deref(),
            Some("Resumed Build CLI; type a message to continue")
        );
        let context = fake.session_context.lock().unwrap().clone().unwrap();
        assert_eq!(context.0, "session-1");
        assert_eq!(
            context
                .1
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            Some("D:\\workspace\\project".to_string())
        );
        assert_eq!(context.2, "OSAgent");
        assert_eq!(
            mode.current_persisted_session_id().as_deref(),
            Some("session-1")
        );
    }

    #[test]
    fn chat_panel_filter_prepares_matching_row_and_esc_clears_first() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let mut snapshot = sample_snapshot(None);
        snapshot.sessions.push(AgenticOsSessionRow {
            id: "session-review".to_string(),
            title: "Review TUI panels".to_string(),
            agent: "bitfun-debug".to_string(),
            workspace: Some("D:\\workspace\\project".to_string()),
            parent_session_id: None,
            is_dispatch_task: false,
            turns: 5,
            child_count: 0,
            last_active_at: 1_700_000_100_000,
        });
        let mut view = chat_view_with_overlay(PanelKind::Sessions, snapshot.clone());

        for ch in "review".chars() {
            mode.handle_overlay_key(
                KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE),
                &mut view,
            )
            .unwrap();
        }
        assert_eq!(view.overlay.as_ref().unwrap().filter, "review");
        assert_eq!(panel_count(view.overlay.as_ref().unwrap()), 1);

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Esc), &mut view)
            .unwrap();
        assert_eq!(view.overlay.as_ref().unwrap().filter, "");

        view.overlay = Some(OverlayState::panel(PanelKind::Sessions, snapshot));
        view.overlay.as_mut().unwrap().filter = "review".to_string();
        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert!(view.overlay.is_none());
        assert!(view.input.is_empty());
        assert_eq!(view.session.id, "session-review");
        assert!(view
            .session
            .messages
            .last()
            .unwrap()
            .content
            .contains("Review TUI panels"));
    }

    #[test]
    fn chat_empty_panel_enter_keeps_overlay_open_with_status() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let mut snapshot = sample_snapshot(None);
        snapshot.tasks.clear();
        let mut view = chat_view_with_overlay(PanelKind::Tasks, snapshot);

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert!(view.overlay.is_some());
        assert!(view.session.messages.is_empty());
        assert!(view.input.is_empty());
        assert_eq!(
            view.status.as_deref(),
            Some("No Tasks item selected; use `/dispatch <task>` or run `sparo tasks list`")
        );
    }

    #[test]
    fn chat_overlay_supports_page_and_edge_navigation() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let mut view = chat_view_with_overlay(PanelKind::Settings, sample_snapshot(None));

        mode.handle_overlay_key(KeyEvent::from(KeyCode::PageDown), &mut view)
            .unwrap();
        assert_eq!(view.overlay.as_ref().unwrap().selected, 4);

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Home), &mut view)
            .unwrap();
        assert_eq!(view.overlay.as_ref().unwrap().selected, 0);

        mode.handle_overlay_key(KeyEvent::from(KeyCode::End), &mut view)
            .unwrap();
        assert_eq!(view.overlay.as_ref().unwrap().selected, 4);

        mode.handle_overlay_key(KeyEvent::from(KeyCode::PageUp), &mut view)
            .unwrap();
        assert_eq!(view.overlay.as_ref().unwrap().selected, 0);
    }

    #[test]
    fn chat_panel_refresh_selection_clamps_to_available_items() {
        let overlay = OverlayState::panel(PanelKind::Settings, sample_snapshot(None));
        assert_eq!(clamp_panel_selection(&overlay, 3), 3);
        assert_eq!(clamp_panel_selection(&overlay, 99), 4);

        let mut snapshot = sample_snapshot(None);
        snapshot.tasks.clear();
        let empty_overlay = OverlayState::panel(PanelKind::Tasks, snapshot);
        assert_eq!(clamp_panel_selection(&empty_overlay, 3), 0);
    }

    #[test]
    fn chat_open_empty_snapshot_panel_sets_actionable_status() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let session = Session::new("OSAgent".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());
        view.set_status(Some("stale status".to_string()));
        let mut snapshot = sample_snapshot(None);
        snapshot.tasks.clear();

        mode.open_snapshot_overlay(PanelKind::Tasks, snapshot, 3, &mut view);

        assert!(view.overlay.is_some());
        assert_eq!(view.overlay.as_ref().unwrap().selected, 0);
        assert_eq!(
            view.status.as_deref(),
            Some("No Tasks item selected; use `/dispatch <task>` or run `sparo tasks list`")
        );
    }

    #[test]
    fn chat_open_non_empty_snapshot_panel_clears_stale_status() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let session = Session::new("OSAgent".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());
        view.set_status(Some("stale status".to_string()));

        mode.open_snapshot_overlay(PanelKind::Settings, sample_snapshot(None), 99, &mut view);

        assert!(view.overlay.is_some());
        assert_eq!(view.overlay.as_ref().unwrap().selected, 4);
        assert!(view.status.is_none());
    }

    #[test]
    fn chat_overlay_enter_loads_app_context_and_followup_prompt() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let mut view = chat_view_with_overlay(PanelKind::Apps, sample_snapshot(None));

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert!(view.overlay.is_none());
        assert!(view.input.contains("Use the selected app context above"));
        assert!(!view.input.contains("sparo apps show"));
        assert!(view
            .session
            .messages
            .last()
            .unwrap()
            .content
            .contains("App detail"));
        assert_eq!(
            view.status.as_deref(),
            Some("Loaded app context; press Enter to analyze")
        );
    }

    #[test]
    fn chat_overlay_enter_loads_settings_context_and_followup_prompt() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let mut view = chat_view_with_overlay(PanelKind::Settings, sample_snapshot(None));

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert!(view.overlay.is_none());
        assert!(view
            .input
            .contains("Use the selected settings context above"));
        assert!(!view.input.contains("sparo config show"));
        assert!(view
            .session
            .messages
            .last()
            .unwrap()
            .content
            .contains("Model settings"));
        assert!(view
            .session
            .messages
            .last()
            .unwrap()
            .content
            .contains("ai.default_models"));
        assert_eq!(
            view.status.as_deref(),
            Some("Loaded settings context; press Enter to analyze")
        );
    }

    #[test]
    fn chat_overlay_enter_updates_workspace_selection() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake.clone());
        let mut view = chat_view_with_overlay(PanelKind::Workspaces, sample_snapshot(None));

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert!(view.overlay.is_none());
        assert_eq!(
            view.session.workspace.as_deref(),
            Some("D:\\workspace\\project")
        );
        assert_eq!(
            fake.workspace_path
                .lock()
                .unwrap()
                .as_ref()
                .map(|path| path.to_string_lossy().to_string())
                .as_deref(),
            Some("D:\\workspace\\project")
        );
        assert!(view.input.contains("Use the selected workspace context"));
        assert!(view.input.contains("D:\\workspace\\project"));
        assert!(!view.input.contains("sparo workspaces show"));
        assert!(view
            .session
            .messages
            .last()
            .unwrap()
            .content
            .contains("Workspace detail"));
        assert_eq!(
            view.status.as_deref(),
            Some("Workspace selected: D:\\workspace\\project; press Enter to analyze")
        );
    }

    #[test]
    fn chat_workspace_filter_selects_matching_workspace() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake.clone());
        let mut snapshot = sample_snapshot(None);
        snapshot.workspaces.push(AgenticOsWorkspaceRow {
            label: "design".to_string(),
            path: Some("D:\\workspace\\design".to_string()),
            git: Some("git feature/design".to_string()),
            session_count: 3,
        });
        let mut view = chat_view_with_overlay(PanelKind::Workspaces, snapshot);
        view.overlay.as_mut().unwrap().filter = "design".to_string();

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert_eq!(
            view.session.workspace.as_deref(),
            Some("D:\\workspace\\design")
        );
        assert_eq!(
            fake.workspace_path
                .lock()
                .unwrap()
                .as_ref()
                .map(|path| path.to_string_lossy().to_string())
                .as_deref(),
            Some("D:\\workspace\\design")
        );
        assert!(view.input.contains("Use the selected workspace context"));
        assert!(view.input.contains("D:\\workspace\\design"));
        assert!(!view.input.contains("sparo workspaces show"));
        assert_eq!(
            view.status.as_deref(),
            Some("Workspace selected: D:\\workspace\\design; press Enter to analyze")
        );
    }

    #[test]
    fn chat_workspace_selection_clears_persisted_session_export_target() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake.clone());
        mode.set_persisted_session_id(Some("old-session".to_string()));
        let mut view = chat_view_with_overlay(PanelKind::Workspaces, sample_snapshot(None));

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert!(mode.current_persisted_session_id().is_none());

        mode.handle_command("/export", &mut view).unwrap();
        let message = &view.session.messages.last().unwrap().content;
        assert!(message.contains("sparo sessions --workspace D:\\workspace\\project last"));
        assert!(!message.contains("old-session"));
    }

    #[test]
    fn chat_overlay_enter_loads_memory_preview_and_prompt() {
        let temp_dir =
            std::env::temp_dir().join(format!("sparo-memory-test-{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let memory_path = temp_dir.join("notes.md");
        std::fs::write(&memory_path, "Remember this workspace detail.").unwrap();

        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let mut view = chat_view_with_overlay(
            PanelKind::Memory,
            sample_snapshot(Some(temp_dir.to_string_lossy().to_string())),
        );

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert!(view.overlay.is_none());
        assert!(view
            .session
            .messages
            .first()
            .unwrap()
            .content
            .contains("Memory detail"));
        assert!(view
            .session
            .messages
            .last()
            .unwrap()
            .content
            .contains("Remember this workspace detail."));
        assert!(view.input.contains("Use the loaded memory preview above"));
        assert!(view.input.contains("notes.md"));
        assert!(!view.input.contains("sparo memory"));
        assert_eq!(
            view.status.as_deref(),
            Some("Loaded memory preview; press Enter to analyze")
        );

        let _ = std::fs::remove_file(memory_path);
        let _ = std::fs::remove_dir(temp_dir);
    }

    #[test]
    fn chat_memory_preview_failure_keeps_overlay_open() {
        let missing_dir =
            std::env::temp_dir().join(format!("sparo-missing-memory-test-{}", std::process::id()));
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let mut view = chat_view_with_overlay(
            PanelKind::Memory,
            sample_snapshot(Some(missing_dir.to_string_lossy().to_string())),
        );

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert!(matches!(
            view.overlay.as_ref().map(|overlay| overlay.kind),
            Some(OverlayKind::Panel(PanelKind::Memory))
        ));
        assert!(view.session.messages.is_empty());
        assert!(view.input.is_empty());
        assert!(view
            .status
            .as_deref()
            .unwrap()
            .contains("Failed to read memory file"));
    }

    #[test]
    fn chat_unknown_slash_command_opens_palette_without_transcript_noise() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let session = Session::new("OSAgent".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());

        mode.handle_command("/unknown", &mut view).unwrap();

        assert!(view.session.messages.is_empty());
        let overlay = view.overlay.as_ref().unwrap();
        assert_eq!(overlay.kind, OverlayKind::CommandPalette);
        assert_eq!(overlay.filter, "unknown");
        assert_eq!(
            view.status.as_deref(),
            Some("No command matched /unknown; choose one from the palette")
        );
    }

    #[test]
    fn chat_command_palette_enter_without_matches_reports_status() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let session = Session::new("OSAgent".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());
        view.open_overlay(OverlayState {
            kind: OverlayKind::CommandPalette,
            selected: 0,
            filter: "no-such-command".to_string(),
            snapshot: None,
        });

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert!(matches!(
            view.overlay.as_ref().map(|overlay| overlay.kind),
            Some(OverlayKind::CommandPalette)
        ));
        assert!(view.session.messages.is_empty());
        assert_eq!(
            view.status.as_deref(),
            Some("No matching command; edit the filter or press Esc")
        );
    }

    #[test]
    fn chat_command_palette_accepts_typed_command_with_args() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let session = Session::new("OSAgent".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());
        view.open_overlay(OverlayState {
            kind: OverlayKind::CommandPalette,
            selected: 0,
            filter: "dispatch review the TUI panels".to_string(),
            snapshot: None,
        });

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert!(view.overlay.is_none());
        assert!(view.input.contains("Delegate this work"));
        assert!(view.input.contains("review the TUI panels"));
        assert_eq!(
            view.status.as_deref(),
            Some("Prepared delegation prompt; press Enter to send")
        );
    }

    #[test]
    fn chat_command_palette_filter_edit_clears_stale_status() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let session = Session::new("OSAgent".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());
        view.open_overlay(OverlayState {
            kind: OverlayKind::CommandPalette,
            selected: 0,
            filter: "no-such-command".to_string(),
            snapshot: None,
        });
        view.set_status(Some(
            "No matching command; edit the filter or press Esc".to_string(),
        ));

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Backspace), &mut view)
            .unwrap();

        assert!(view.status.is_none());
        assert_eq!(
            view.overlay.as_ref().unwrap().filter,
            "no-such-comman".to_string()
        );
    }

    #[test]
    fn chat_overlay_ctrl_u_clears_command_and_panel_filters() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let mut view = chat_view_with_overlay(PanelKind::Sessions, sample_snapshot(None));
        view.overlay.as_mut().unwrap().filter = "review".to_string();
        view.overlay.as_mut().unwrap().selected = 1;
        view.set_status(Some("stale".to_string()));

        mode.handle_overlay_key(
            KeyEvent::new(KeyCode::Char('u'), KeyModifiers::CONTROL),
            &mut view,
        )
        .unwrap();
        assert_eq!(view.overlay.as_ref().unwrap().filter, "");
        assert_eq!(view.overlay.as_ref().unwrap().selected, 0);
        assert!(view.status.is_none());

        view.open_overlay(OverlayState {
            kind: OverlayKind::CommandPalette,
            selected: 2,
            filter: "settings".to_string(),
            snapshot: None,
        });
        view.set_status(Some("stale".to_string()));

        mode.handle_overlay_key(
            KeyEvent::new(KeyCode::Char('u'), KeyModifiers::CONTROL),
            &mut view,
        )
        .unwrap();
        assert_eq!(view.overlay.as_ref().unwrap().filter, "");
        assert_eq!(view.overlay.as_ref().unwrap().selected, 0);
        assert!(view.status.is_none());
    }

    #[test]
    fn chat_clear_shortcut_matches_clear_command_feedback() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (response_tx, _response_rx) = mpsc::unbounded_channel();
        let (stream_tx, _stream_rx) = mpsc::unbounded_channel();
        let mut pending_response = None;
        let mut assistant_text = String::new();
        let mut tool_map = std::collections::HashMap::new();
        let mut view = ChatView::new(Session::new("OSAgent".to_string(), None), Theme::dark());
        view.add_message("user".to_string(), "hello".to_string());

        mode.handle_key_event(
            KeyEvent::new(KeyCode::Char('l'), KeyModifiers::CONTROL),
            &mut view,
            &mut pending_response,
            runtime.handle(),
            &response_tx,
            &stream_tx,
            &mut assistant_text,
            &mut tool_map,
        )
        .unwrap();

        assert!(view.session.messages.is_empty());
        assert_eq!(view.status.as_deref(), Some("Conversation cleared"));
    }

    #[test]
    fn chat_clear_shortcut_waits_for_pending_response() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (response_tx, _response_rx) = mpsc::unbounded_channel();
        let (stream_tx, _stream_rx) = mpsc::unbounded_channel();
        let mut pending_response = Some(runtime.spawn(async { Ok(()) }));
        let mut assistant_text = String::new();
        let mut tool_map = std::collections::HashMap::new();
        let mut view = ChatView::new(Session::new("OSAgent".to_string(), None), Theme::dark());
        view.add_message("user".to_string(), "hello".to_string());

        mode.handle_key_event(
            KeyEvent::new(KeyCode::Char('l'), KeyModifiers::CONTROL),
            &mut view,
            &mut pending_response,
            runtime.handle(),
            &response_tx,
            &stream_tx,
            &mut assistant_text,
            &mut tool_map,
        )
        .unwrap();

        assert_eq!(view.session.messages.len(), 1);
        assert_eq!(
            view.status.as_deref(),
            Some("Wait for the current response before clearing")
        );

        if let Some(handle) = pending_response.take() {
            handle.abort();
        }
    }

    #[test]
    fn chat_configured_shortcut_parser_matches_core_keys() {
        assert!(shortcut_matches(
            "Ctrl+D",
            KeyEvent::new(KeyCode::Char('d'), KeyModifiers::CONTROL)
        ));
        assert!(shortcut_matches(
            "ctrl+d",
            KeyEvent::new(KeyCode::Char('D'), KeyModifiers::CONTROL)
        ));
        assert!(shortcut_matches("Esc", KeyEvent::from(KeyCode::Esc)));
        assert!(shortcut_matches("Enter", KeyEvent::from(KeyCode::Enter)));
        assert!(!shortcut_matches(
            "Ctrl+D",
            KeyEvent::new(KeyCode::Char('d'), KeyModifiers::NONE)
        ));
        assert!(!shortcut_matches(
            "Ctrl+Delete",
            KeyEvent::new(KeyCode::Delete, KeyModifiers::CONTROL)
        ));
    }

    #[test]
    fn chat_configured_send_shortcut_submits_input() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (response_tx, _response_rx) = mpsc::unbounded_channel();
        let (stream_tx, _stream_rx) = mpsc::unbounded_channel();
        let mut pending_response = None;
        let mut assistant_text = String::new();
        let mut tool_map = std::collections::HashMap::new();
        let mut view = ChatView::new(Session::new("OSAgent".to_string(), None), Theme::dark());
        view.input = "use configured send".to_string();
        view.cursor = view.input.chars().count();

        mode.handle_key_event(
            KeyEvent::new(KeyCode::Char('d'), KeyModifiers::CONTROL),
            &mut view,
            &mut pending_response,
            runtime.handle(),
            &response_tx,
            &stream_tx,
            &mut assistant_text,
            &mut tool_map,
        )
        .unwrap();

        assert!(pending_response.is_some());
        assert!(view.input.is_empty());
        assert_eq!(view.session.messages[0].content, "use configured send");
        assert_eq!(view.status.as_deref(), Some("OSAgent is thinking..."));

        if let Some(handle) = pending_response.take() {
            handle.abort();
        }
    }

    #[test]
    fn chat_custom_send_shortcut_uses_cli_preference() {
        let fake = Arc::new(FakeAgent::default());
        let mut mode = chat_mode_with_fake_agent(fake);
        mode.config.shortcuts.send_message = "Ctrl+S".to_string();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (response_tx, _response_rx) = mpsc::unbounded_channel();
        let (stream_tx, _stream_rx) = mpsc::unbounded_channel();
        let mut pending_response = None;
        let mut assistant_text = String::new();
        let mut tool_map = std::collections::HashMap::new();
        let mut view = ChatView::new(Session::new("OSAgent".to_string(), None), Theme::dark());
        view.input = "custom shortcut".to_string();
        view.cursor = view.input.chars().count();

        mode.handle_key_event(
            KeyEvent::new(KeyCode::Char('d'), KeyModifiers::CONTROL),
            &mut view,
            &mut pending_response,
            runtime.handle(),
            &response_tx,
            &stream_tx,
            &mut assistant_text,
            &mut tool_map,
        )
        .unwrap();
        assert!(pending_response.is_none());
        assert_eq!(view.input, "custom shortcut");

        mode.handle_key_event(
            KeyEvent::new(KeyCode::Char('s'), KeyModifiers::CONTROL),
            &mut view,
            &mut pending_response,
            runtime.handle(),
            &response_tx,
            &stream_tx,
            &mut assistant_text,
            &mut tool_map,
        )
        .unwrap();

        assert!(pending_response.is_some());
        assert!(view.input.is_empty());
        assert_eq!(view.session.messages[0].content, "custom shortcut");

        if let Some(handle) = pending_response.take() {
            handle.abort();
        }
    }

    #[test]
    fn chat_configured_interrupt_shortcut_aborts_pending_response() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (response_tx, _response_rx) = mpsc::unbounded_channel();
        let (stream_tx, _stream_rx) = mpsc::unbounded_channel();
        let mut pending_response =
            Some(runtime.spawn(async { std::future::pending::<Result<()>>().await }));
        let mut assistant_text = "partial answer".to_string();
        let mut tool_map = std::collections::HashMap::new();
        let mut view = ChatView::new(Session::new("OSAgent".to_string(), None), Theme::dark());
        view.set_loading(true);
        view.session
            .add_message("assistant".to_string(), String::new());

        let outcome = mode
            .handle_key_event(
                KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL),
                &mut view,
                &mut pending_response,
                runtime.handle(),
                &response_tx,
                &stream_tx,
                &mut assistant_text,
                &mut tool_map,
            )
            .unwrap();

        assert_eq!(outcome, None);
        assert!(pending_response.is_none());
        assert!(!view.loading);
        assert_eq!(view.status.as_deref(), Some("Response interrupted"));
        assert_eq!(
            view.session.messages.last().unwrap().content,
            "partial answer"
        );
    }

    #[test]
    fn chat_enter_status_uses_current_session_agent() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (response_tx, _response_rx) = mpsc::unbounded_channel();
        let (stream_tx, _stream_rx) = mpsc::unbounded_channel();
        let mut pending_response = None;
        let mut assistant_text = String::new();
        let mut tool_map = std::collections::HashMap::new();
        let mut view = ChatView::new(
            Session::new("bitfun-debug".to_string(), None),
            Theme::dark(),
        );
        view.input = "diagnose this".to_string();
        view.cursor = view.input.chars().count();

        mode.handle_key_event(
            KeyEvent::from(KeyCode::Enter),
            &mut view,
            &mut pending_response,
            runtime.handle(),
            &response_tx,
            &stream_tx,
            &mut assistant_text,
            &mut tool_map,
        )
        .unwrap();

        assert_eq!(view.status.as_deref(), Some("bitfun-debug is thinking..."));
        if let Some(handle) = pending_response.take() {
            handle.abort();
        }
    }

    #[test]
    fn chat_esc_clears_draft_before_returning_home() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (response_tx, _response_rx) = mpsc::unbounded_channel();
        let (stream_tx, _stream_rx) = mpsc::unbounded_channel();
        let mut pending_response = None;
        let mut assistant_text = String::new();
        let mut tool_map = std::collections::HashMap::new();
        let mut view = ChatView::new(Session::new("OSAgent".to_string(), None), Theme::dark());
        view.input = "half written thought".to_string();
        view.cursor = view.input.chars().count();

        let first = mode
            .handle_key_event(
                KeyEvent::from(KeyCode::Esc),
                &mut view,
                &mut pending_response,
                runtime.handle(),
                &response_tx,
                &stream_tx,
                &mut assistant_text,
                &mut tool_map,
            )
            .unwrap();

        assert_eq!(first, None);
        assert!(view.input.is_empty());
        assert_eq!(
            view.status.as_deref(),
            Some("Draft cleared; press Esc again to return home")
        );

        let second = mode
            .handle_key_event(
                KeyEvent::from(KeyCode::Esc),
                &mut view,
                &mut pending_response,
                runtime.handle(),
                &response_tx,
                &stream_tx,
                &mut assistant_text,
                &mut tool_map,
            )
            .unwrap();

        assert_eq!(
            second,
            Some(ChatExitReason::BackToMenu {
                workspace: None,
                session_id: None
            })
        );
    }

    #[test]
    fn chat_back_to_menu_preserves_current_workspace_and_session_hints() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        mode.set_persisted_session_id(Some("session-1".to_string()));
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (response_tx, _response_rx) = mpsc::unbounded_channel();
        let (stream_tx, _stream_rx) = mpsc::unbounded_channel();
        let mut pending_response = None;
        let mut assistant_text = String::new();
        let mut tool_map = std::collections::HashMap::new();
        let mut view = ChatView::new(
            Session::new(
                "OSAgent".to_string(),
                Some("D:\\workspace\\selected".to_string()),
            ),
            Theme::dark(),
        );

        let outcome = mode
            .handle_key_event(
                KeyEvent::new(KeyCode::Char('b'), KeyModifiers::CONTROL),
                &mut view,
                &mut pending_response,
                runtime.handle(),
                &response_tx,
                &stream_tx,
                &mut assistant_text,
                &mut tool_map,
            )
            .unwrap();

        assert_eq!(
            outcome,
            Some(ChatExitReason::BackToMenu {
                workspace: Some("D:\\workspace\\selected".to_string()),
                session_id: Some("session-1".to_string())
            })
        );
    }

    #[test]
    fn chat_clear_command_waits_for_loading_response() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let session = Session::new("OSAgent".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());
        view.add_message("user".to_string(), "hello".to_string());
        view.set_loading(true);
        view.open_overlay(OverlayState {
            kind: OverlayKind::CommandPalette,
            selected: 0,
            filter: "clear".to_string(),
            snapshot: None,
        });

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert_eq!(view.session.messages.len(), 1);
        assert!(view.overlay.is_none());
        assert_eq!(
            view.status.as_deref(),
            Some("Wait for the current response before clearing")
        );
    }

    fn chat_view_waiting_for_tool_confirmation() -> ChatView {
        let session = Session::new("OSAgent".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());
        view.add_message("assistant".to_string(), String::new());
        view.session.add_tool_to_last_message(ToolCall {
            tool_id: Some("tool-1".to_string()),
            tool_name: "BashTool".to_string(),
            parameters: serde_json::json!({"command": "git status"}),
            result: None,
            status: ToolCallStatus::ConfirmationNeeded,
            progress: None,
            progress_message: Some("Waiting for terminal confirmation".to_string()),
            duration_ms: None,
        });
        view.set_pending_tool_confirmation("tool-1".to_string(), "BashTool".to_string());
        view
    }

    #[test]
    fn chat_pending_tool_confirmation_y_confirms_tool() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake.clone());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (response_tx, _response_rx) = mpsc::unbounded_channel();
        let (stream_tx, _stream_rx) = mpsc::unbounded_channel();
        let mut pending_response = None;
        let mut assistant_text = String::new();
        let mut tool_map = std::collections::HashMap::new();
        let mut view = chat_view_waiting_for_tool_confirmation();

        mode.handle_key_event(
            KeyEvent::from(KeyCode::Char('y')),
            &mut view,
            &mut pending_response,
            runtime.handle(),
            &response_tx,
            &stream_tx,
            &mut assistant_text,
            &mut tool_map,
        )
        .unwrap();
        runtime.block_on(tokio::task::yield_now());

        assert!(view.pending_tool_confirmation.is_none());
        assert_eq!(fake.confirmed_tools.lock().unwrap().as_slice(), ["tool-1"]);
        let tool_status = match &view.session.messages.last().unwrap().flow_items[0] {
            crate::session::FlowItem::Tool { tool_call } => tool_call.status.clone(),
            _ => panic!("expected tool flow item"),
        };
        assert_eq!(tool_status, ToolCallStatus::Confirmed);
    }

    #[test]
    fn chat_pending_tool_confirmation_n_rejects_tool() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake.clone());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (response_tx, _response_rx) = mpsc::unbounded_channel();
        let (stream_tx, _stream_rx) = mpsc::unbounded_channel();
        let mut pending_response = None;
        let mut assistant_text = String::new();
        let mut tool_map = std::collections::HashMap::new();
        let mut view = chat_view_waiting_for_tool_confirmation();

        mode.handle_key_event(
            KeyEvent::from(KeyCode::Char('n')),
            &mut view,
            &mut pending_response,
            runtime.handle(),
            &response_tx,
            &stream_tx,
            &mut assistant_text,
            &mut tool_map,
        )
        .unwrap();
        runtime.block_on(tokio::task::yield_now());

        assert!(view.pending_tool_confirmation.is_none());
        assert_eq!(fake.rejected_tools.lock().unwrap()[0].0, "tool-1");
        let (tool_status, result) = match &view.session.messages.last().unwrap().flow_items[0] {
            crate::session::FlowItem::Tool { tool_call } => {
                (tool_call.status.clone(), tool_call.result.clone())
            }
            _ => panic!("expected tool flow item"),
        };
        assert_eq!(tool_status, ToolCallStatus::Rejected);
        assert_eq!(result.as_deref(), Some("Rejected from Sparo CLI TUI"));
    }

    #[test]
    fn chat_pending_tool_confirmation_preserves_global_quit() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake.clone());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (response_tx, _response_rx) = mpsc::unbounded_channel();
        let (stream_tx, _stream_rx) = mpsc::unbounded_channel();
        let mut pending_response = None;
        let mut assistant_text = String::new();
        let mut tool_map = std::collections::HashMap::new();
        let mut view = chat_view_waiting_for_tool_confirmation();

        let outcome = mode
            .handle_key_event(
                KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL),
                &mut view,
                &mut pending_response,
                runtime.handle(),
                &response_tx,
                &stream_tx,
                &mut assistant_text,
                &mut tool_map,
            )
            .unwrap();

        assert_eq!(outcome, Some(ChatExitReason::Quit));
        assert!(fake.confirmed_tools.lock().unwrap().is_empty());
        assert!(fake.rejected_tools.lock().unwrap().is_empty());
    }

    #[test]
    fn chat_new_command_waits_for_loading_response() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let session = Session::new("OSAgent".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());
        view.add_message("user".to_string(), "keep this session".to_string());
        view.set_loading(true);
        view.open_overlay(OverlayState {
            kind: OverlayKind::CommandPalette,
            selected: 0,
            filter: "new".to_string(),
            snapshot: None,
        });

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert_eq!(view.session.messages.len(), 1);
        assert!(view.overlay.is_none());
        assert_eq!(
            view.status.as_deref(),
            Some("Wait for the current response before starting a new session")
        );
    }

    #[test]
    fn chat_new_command_resets_specialized_session_to_agentic_os() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake.clone());
        mode.set_persisted_session_id(Some("debug-session".to_string()));
        let mut session = Session::new(
            "bitfun-debug".to_string(),
            Some("D:\\workspace\\project".to_string()),
        );
        session.id = "debug-session".to_string();
        session.add_message("user".to_string(), "debug this".to_string());
        let mut view = ChatView::new(session, Theme::dark());

        mode.handle_command("/new", &mut view).unwrap();

        assert_eq!(view.session.agent, "OSAgent");
        assert_eq!(
            view.session.workspace.as_deref(),
            Some("D:\\workspace\\project")
        );
        assert!(view.session.messages.is_empty());
        assert!(mode.current_persisted_session_id().is_none());
        assert_eq!(fake.agent_type.lock().unwrap().as_deref(), Some("OSAgent"));
        assert_eq!(view.status.as_deref(), Some("Started a fresh session"));
    }

    #[test]
    fn chat_history_summarizes_current_session_context() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let mut session = Session::new(
            "OSAgent".to_string(),
            Some("D:\\workspace\\project".to_string()),
        );
        session.add_message("user".to_string(), "Hello".to_string());
        let mut view = ChatView::new(session, Theme::dark());

        mode.handle_command("/history", &mut view).unwrap();

        let message = &view.session.messages.last().unwrap().content;
        assert!(message.contains("Current session"));
        assert!(message.contains("Workspace: D:\\workspace\\project"));
        assert!(message.contains("Use `/export`"));
    }

    #[test]
    fn chat_agents_command_uses_live_registry_message() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let fake = Arc::new(FakeAgent::default());
            let mode = chat_mode_with_fake_agent(fake);
            let session = Session::new("OSAgent".to_string(), None);
            let mut view = ChatView::new(session, Theme::dark());

            mode.handle_command("/agents", &mut view).unwrap();

            let message = &view.session.messages.last().unwrap().content;
            assert!(message.contains("Available Agents (live registry"));
            assert!(message.contains("sparo agents list"));
        });
    }

    #[test]
    fn chat_export_prepares_actionable_session_commands() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        mode.set_persisted_session_id(Some("saved-session".to_string()));
        let session = Session::new(
            "OSAgent".to_string(),
            Some("D:\\workspace\\project".to_string()),
        );
        let mut view = ChatView::new(session, Theme::dark());

        mode.handle_command("/export", &mut view).unwrap();

        let message = &view.session.messages.last().unwrap().content;
        assert!(message.contains("Session export"));
        assert!(message.contains("bound to persisted core session `saved-session`"));
        assert!(message.contains(
            "Inspect: sparo sessions --workspace D:\\workspace\\project show saved-session"
        ));
        assert!(message.contains(
            "Resume: sparo sessions --workspace D:\\workspace\\project resume saved-session"
        ));
        assert!(message.contains(
            "Export: sparo sessions --workspace D:\\workspace\\project export saved-session"
        ));
        assert!(message.contains("List: sparo sessions --workspace D:\\workspace\\project list"));
    }

    #[test]
    fn chat_export_quotes_workspace_paths_with_spaces() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        mode.set_persisted_session_id(Some("saved-session".to_string()));
        let session = Session::new(
            "OSAgent".to_string(),
            Some("D:\\workspace\\my project".to_string()),
        );
        let mut view = ChatView::new(session, Theme::dark());

        mode.handle_command("/export", &mut view).unwrap();

        let message = &view.session.messages.last().unwrap().content;
        assert!(message.contains(
            "sparo sessions --workspace \"D:\\workspace\\my project\" show saved-session"
        ));
        assert!(message.contains(
            "sparo sessions --workspace \"D:\\workspace\\my project\" resume saved-session"
        ));
        assert!(message.contains(
            "sparo sessions --workspace \"D:\\workspace\\my project\" export saved-session"
        ));
    }

    #[test]
    fn chat_export_explains_unbound_live_session_before_first_saved_turn() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let session = Session::new(
            "OSAgent".to_string(),
            Some("D:\\workspace\\project".to_string()),
        );
        let mut view = ChatView::new(session, Theme::dark());

        mode.handle_command("/export", &mut view).unwrap();

        let message = &view.session.messages.last().unwrap().content;
        assert!(message.contains("has not been bound to a persisted core session yet"));
        assert!(message.contains("Inspect: sparo sessions --workspace D:\\workspace\\project last"));
        assert!(message
            .contains("Resume: sparo sessions --workspace D:\\workspace\\project resume last"));
        assert!(message.contains("sparo sessions --workspace D:\\workspace\\project export last"));
    }
}
