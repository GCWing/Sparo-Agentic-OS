/// Chat mode implementation
///
/// Interactive chat mode with TUI interface
use anyhow::Result;
use bitfun_core::infrastructure::try_get_path_manager_arc;
use crossterm::event::{Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

use crate::agent::{agentic_system::AgenticSystem, core_adapter::CoreAgentAdapter, Agent};
use crate::config::CliConfig;
use crate::session::Session;
use crate::ui::chat::ChatView;
use crate::ui::commands::{
    available_agents_message, command_for_slash, typed_command_action, CommandAction, CommandScope,
    PanelKind,
};
use crate::ui::panels::{
    command_count, jump_selection, move_selection, panel_count, selected_command,
    selected_memory_file, selected_panel_detail, selected_panel_prompt, selected_workspace,
    OverlayKind, OverlayState, SelectionJump,
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

fn preview_text_file(path: &Path, max_lines: usize, max_chars: usize) -> Result<String> {
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

fn prepared_panel_status(kind: PanelKind) -> &'static str {
    match kind {
        PanelKind::Sessions => "Prepared session action prompt; press Enter to send",
        PanelKind::Tasks => "Prepared task action prompt; press Enter to send",
        PanelKind::Apps => "Prepared app action prompt; press Enter to send",
        PanelKind::Settings => "Prepared settings action prompt; press Enter to send",
        PanelKind::Memory => "Loaded memory preview; press Enter to send",
        PanelKind::Workspaces => "Workspace selected; press Enter to send",
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
            "No Apps item selected; run `sparo apps list` or inspect app creation tool schemas"
        }
        PanelKind::Memory => {
            "No Memory item selected; run `sparo memory list` or add notes under .sparo_os/memory"
        }
        PanelKind::Workspaces => {
            "No Workspaces item selected; run `sparo workspaces use .` from a project"
        }
        PanelKind::Settings => {
            "No Settings item selected; run `sparo health --json` for diagnostics"
        }
    }
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
    /// Return to dispatcher home
    BackToMenu,
}

pub struct ChatMode {
    config: CliConfig,
    agent_name: String,
    workspace_path: Option<PathBuf>,
    agent: Arc<dyn Agent>,
    initial_input: Option<String>,
    persisted_session_id: Option<String>,
}

impl ChatMode {
    pub fn new_with_session(
        config: CliConfig,
        agent_name: String,
        workspace_path: Option<PathBuf>,
        session_id: Option<String>,
        agentic_system: &AgenticSystem,
    ) -> Self {
        let agent = Arc::new(CoreAgentAdapter::new_with_session(
            agent_name.clone(),
            agentic_system.coordinator.clone(),
            agentic_system.event_queue.clone(),
            workspace_path.clone(),
            session_id.clone(),
        )) as Arc<dyn Agent>;

        Self {
            config,
            agent_name,
            workspace_path,
            agent,
            initial_input: None,
            persisted_session_id: session_id,
        }
    }

    pub fn set_initial_input(&mut self, input: Option<String>) {
        self.initial_input = input.filter(|value| !value.trim().is_empty());
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

        let theme = match self.config.ui.theme.as_str() {
            "light" => Theme::light(),
            _ => Theme::dark(),
        };
        let mut chat_view = ChatView::new(session, theme);
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
                    current_assistant_message_text.clear();
                    current_tool_map.clear();
                    chat_view.set_loading(false);
                    if response.success {
                        chat_view.set_status(None);
                    } else if chat_view.status.is_none() {
                        chat_view.set_status(Some("Agent response failed".to_string()));
                    }
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
        let session_id = self.persisted_session_id.as_ref()?;
        let workspace_path = self
            .workspace_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string());
        let request = bitfun_core::command::session::ShowSessionRequest {
            session_id: session_id.clone(),
            workspace_path,
        };
        let detail = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current()
                .block_on(bitfun_core::command::session::show_session(request))
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

        if chat_view.overlay.is_some() {
            return self.handle_overlay_key(key, chat_view);
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
                tracing::info!("User returning to dispatcher home");
                chat_view.set_status(Some("Returning to dispatcher home...".to_string()));
                return Ok(Some(ChatExitReason::BackToMenu));
            }

            (KeyCode::Enter, _) => {
                if pending_response.is_some() {
                    return Ok(None);
                }

                if chat_view.input.trim_start().starts_with('/') {
                    if let Some(input) = chat_view.take_input() {
                        tracing::info!("User command: {}", input);
                        self.handle_command(&input, chat_view)?;
                    }
                    return Ok(None);
                }

                if let Some(input) = chat_view.send_input() {
                    tracing::info!("User input: {}", input);

                    chat_view.set_loading(true);
                    chat_view.set_status(Some(format!("{} is thinking...", self.agent_name)));
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
                                let _ = stream_tx_clone
                                    .send(crate::agent::AgentEvent::Error(e.to_string()));
                                let _ = resp_tx.send(crate::agent::AgentResponse {
                                    tool_calls: vec![],
                                    success: false,
                                });
                            }
                        }
                        Ok(())
                    });

                    *pending_response = Some(handle_clone);
                }
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
                } else {
                    tracing::info!("User returning to dispatcher home via Esc");
                    return Ok(Some(ChatExitReason::BackToMenu));
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
                        let prompt = selected_panel_prompt(overlay);
                        chat_view.close_overlay();
                        let (workspace_path, session_workspace, workspace_label) =
                            effective_workspace_selection(workspace);
                        self.agent.set_workspace_path(workspace_path);
                        chat_view.session.workspace = session_workspace;
                        if let Some(detail) = detail {
                            chat_view.add_message("system".to_string(), detail);
                        }
                        if let Some(prompt) = prompt {
                            chat_view.replace_input_preserving_draft(prompt);
                            chat_view.set_status(Some(format!(
                                "Workspace selected: {}; press Enter to send",
                                workspace_label
                            )));
                        } else {
                            chat_view.set_status(Some(format!(
                                "Workspace selected for the next action: {}",
                                workspace_label
                            )));
                        }
                    }
                }
                OverlayKind::Panel(PanelKind::Memory) => {
                    if let Some(memory_file) = selected_memory_file(overlay) {
                        let detail = selected_panel_detail(overlay);
                        let prompt = selected_panel_prompt(overlay);
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
                                if let Some(prompt) = prompt {
                                    chat_view.replace_input_preserving_draft(prompt);
                                    chat_view.set_status(Some(
                                        "Loaded memory preview; press Enter to send".to_string(),
                                    ));
                                }
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
                OverlayKind::Panel(
                    kind @ (PanelKind::Sessions
                    | PanelKind::Tasks
                    | PanelKind::Apps
                    | PanelKind::Settings),
                ) => {
                    let detail = selected_panel_detail(overlay);
                    let prompt = selected_panel_prompt(overlay);
                    chat_view.close_overlay();
                    if let Some(detail) = detail {
                        chat_view.add_message("system".to_string(), detail);
                    }
                    if let Some(prompt) = prompt {
                        chat_view.replace_input_preserving_draft(prompt);
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
                        "Prepared Dispatcher delegation prompt; press Enter to send".to_string(),
                    ));
                }
            }
            CommandAction::ShowAgents => {
                chat_view.add_message("system".to_string(), available_agents_message().to_string());
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
                        self.persisted_session_id.as_deref(),
                    ),
                );
            }
            CommandAction::NewSession => {
                if chat_view.loading {
                    chat_view.set_status(Some(
                        "Wait for the current response before starting a new session".to_string(),
                    ));
                } else {
                    self.agent.reset_session();
                    chat_view.start_new_session();
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

        let mut overlay = OverlayState::panel(kind, snapshot);
        overlay.selected = clamp_panel_selection(&overlay, selected);
        chat_view.open_overlay(overlay);
        Ok(())
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
         Use `/export` for the exact saved-session export command.",
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

fn session_export_guidance(session: &Session, persisted_session_id: Option<&str>) -> String {
    let workspace_arg = workspace_option(session.workspace.as_deref());
    let export_id = persisted_session_id.unwrap_or("last");
    let export_id_arg = shell_arg(export_id);
    let show_id_arg = shell_arg(export_id);
    let session_note = if persisted_session_id.is_some() {
        format!("This chat was opened from saved session `{}`.", session.id)
    } else {
        "This live TUI transcript may not share its local display id with the persisted core session; use `last` after a turn has been saved.".to_string()
    };

    format!(
        "Session export\n\
         - Current transcript: {}\n\
         - Workspace: {}\n\
         - {}\n\n\
         Commands:\n\
         - sparo sessions{} show {}\n\
         - sparo sessions{} export {} --output session.md\n\
         - sparo sessions{} list",
        session.id,
        session.workspace.as_deref().unwrap_or("global"),
        session_note,
        workspace_arg,
        show_id_arg,
        workspace_arg,
        export_id_arg,
        workspace_arg,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{AgentEvent, AgentResponse};
    use bitfun_core::command::agentic_os::{
        AgenticOsAppRow, AgenticOsMemoryRow, AgenticOsSessionRow, AgenticOsSnapshot,
        AgenticOsTaskRow, AgenticOsWorkspaceRow,
    };
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeAgent {
        workspace_path: Mutex<Option<PathBuf>>,
    }

    #[async_trait::async_trait]
    impl Agent for FakeAgent {
        async fn process_message(
            &self,
            _message: String,
            _event_tx: mpsc::UnboundedSender<AgentEvent>,
        ) -> Result<AgentResponse> {
            Ok(AgentResponse {
                tool_calls: Vec::new(),
                success: true,
            })
        }

        fn name(&self) -> &str {
            "fake"
        }

        fn set_workspace_path(&self, workspace_path: Option<PathBuf>) {
            *self.workspace_path.lock().unwrap() = workspace_path;
        }

        fn reset_session(&self) {}
    }

    fn sample_snapshot(memory_target: Option<String>) -> AgenticOsSnapshot {
        AgenticOsSnapshot {
            model: "test-model".to_string(),
            current_workspace: Some("D:\\workspace\\project".to_string()),
            git_branch: Some("git main".to_string()),
            sessions: vec![AgenticOsSessionRow {
                id: "session-1".to_string(),
                title: "Build CLI".to_string(),
                agent: "Dispatcher".to_string(),
                workspace: Some("D:\\workspace\\project".to_string()),
                parent_session_id: None,
                is_dispatch_task: false,
                turns: 3,
                child_count: 1,
                last_active_at: 1_700_000_000_000,
            }],
            tasks: vec![AgenticOsTaskRow {
                title: "Fix bug".to_string(),
                agent: "debug".to_string(),
                status: "active".to_string(),
                detail: "2 turns".to_string(),
                session_id: Some("task-session".to_string()),
                workspace: Some("D:\\workspace\\project".to_string()),
            }],
            apps: vec![AgenticOsAppRow {
                id: "files".to_string(),
                name: "Files".to_string(),
                kind: "AGENT APP".to_string(),
                description: "Browse files".to_string(),
                capability: "read write".to_string(),
                target: None,
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
            agent_name: "Dispatcher".to_string(),
            workspace_path: None,
            agent,
            initial_input: None,
            persisted_session_id: None,
        }
    }

    fn chat_view_with_overlay(kind: PanelKind, snapshot: AgenticOsSnapshot) -> ChatView {
        let session = Session::new("Dispatcher".to_string(), None);
        let mut view = ChatView::new(session, Theme::dark());
        view.open_overlay(OverlayState::panel(kind, snapshot));
        view
    }

    #[test]
    fn chat_overlay_enter_prepares_task_panel_action() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let mut view = chat_view_with_overlay(PanelKind::Tasks, sample_snapshot(None));
        view.input = "keep this draft".to_string();
        view.cursor = view.input.chars().count();

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert!(view.overlay.is_none());
        assert!(view
            .input
            .contains("sparo tasks --workspace D:\\workspace\\project show task-session"));
        assert_eq!(view.cursor, view.input.chars().count());
        assert_eq!(
            view.status.as_deref(),
            Some("Prepared task action prompt; press Enter to send")
        );
        assert_eq!(
            view.input_history.front().map(String::as_str),
            Some("keep this draft")
        );
        assert!(view
            .session
            .messages
            .last()
            .unwrap()
            .content
            .contains("Task detail"));
    }

    #[test]
    fn chat_overlay_enter_prepares_session_panel_action() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let mut view = chat_view_with_overlay(PanelKind::Sessions, sample_snapshot(None));

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert!(view.overlay.is_none());
        assert!(view
            .input
            .contains("sparo sessions --workspace D:\\workspace\\project show session-1"));
        assert!(view
            .input
            .contains("sparo sessions --workspace D:\\workspace\\project resume session-1"));
        assert!(view
            .session
            .messages
            .last()
            .unwrap()
            .content
            .contains("Session detail"));
        assert_eq!(
            view.status.as_deref(),
            Some("Prepared session action prompt; press Enter to send")
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
            agent: "debug".to_string(),
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
        assert!(view.input.contains("session-review"));
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
    fn chat_overlay_enter_prepares_app_panel_action() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let mut view = chat_view_with_overlay(PanelKind::Apps, sample_snapshot(None));

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert!(view.overlay.is_none());
        assert!(view
            .input
            .contains("sparo apps show --workspace D:\\workspace\\project files"));
        assert!(view
            .session
            .messages
            .last()
            .unwrap()
            .content
            .contains("App detail"));
        assert_eq!(
            view.status.as_deref(),
            Some("Prepared app action prompt; press Enter to send")
        );
    }

    #[test]
    fn chat_overlay_enter_prepares_settings_panel_action() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let mut view = chat_view_with_overlay(PanelKind::Settings, sample_snapshot(None));

        mode.handle_overlay_key(KeyEvent::from(KeyCode::Enter), &mut view)
            .unwrap();

        assert!(view.overlay.is_none());
        assert!(view.input.contains("sparo config show"));
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
            Some("Prepared settings action prompt; press Enter to send")
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
        assert!(view.input.contains("sparo workspaces show project"));
        assert!(view
            .session
            .messages
            .last()
            .unwrap()
            .content
            .contains("Workspace detail"));
        assert_eq!(
            view.status.as_deref(),
            Some("Workspace selected: D:\\workspace\\project; press Enter to send")
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
        assert!(view.input.contains("sparo workspaces show design"));
        assert_eq!(
            view.status.as_deref(),
            Some("Workspace selected: D:\\workspace\\design; press Enter to send")
        );
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
        assert!(view
            .input
            .contains("sparo memory --workspace D:\\workspace\\project show project:notes.md"));
        assert_eq!(
            view.status.as_deref(),
            Some("Loaded memory preview; press Enter to send")
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
        let session = Session::new("Dispatcher".to_string(), None);
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
        let session = Session::new("Dispatcher".to_string(), None);
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
        let session = Session::new("Dispatcher".to_string(), None);
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
            Some("Prepared Dispatcher delegation prompt; press Enter to send")
        );
    }

    #[test]
    fn chat_command_palette_filter_edit_clears_stale_status() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let session = Session::new("Dispatcher".to_string(), None);
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
        let mut view = ChatView::new(Session::new("Dispatcher".to_string(), None), Theme::dark());
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
        let mut view = ChatView::new(Session::new("Dispatcher".to_string(), None), Theme::dark());
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
    fn chat_clear_command_waits_for_loading_response() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let session = Session::new("Dispatcher".to_string(), None);
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

    #[test]
    fn chat_new_command_waits_for_loading_response() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let session = Session::new("Dispatcher".to_string(), None);
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
    fn chat_history_summarizes_current_session_context() {
        let fake = Arc::new(FakeAgent::default());
        let mode = chat_mode_with_fake_agent(fake);
        let mut session = Session::new(
            "Dispatcher".to_string(),
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
    fn chat_export_prepares_actionable_session_commands() {
        let fake = Arc::new(FakeAgent::default());
        let mut mode = chat_mode_with_fake_agent(fake);
        mode.persisted_session_id = Some("saved-session".to_string());
        let session = Session::new(
            "Dispatcher".to_string(),
            Some("D:\\workspace\\project".to_string()),
        );
        let mut view = ChatView::new(session, Theme::dark());

        mode.handle_command("/export", &mut view).unwrap();

        let message = &view.session.messages.last().unwrap().content;
        assert!(message.contains("Session export"));
        assert!(message
            .contains("sparo sessions --workspace D:\\workspace\\project show saved-session"));
        assert!(message
            .contains("sparo sessions --workspace D:\\workspace\\project export saved-session"));
        assert!(message.contains("sparo sessions --workspace D:\\workspace\\project list"));
    }

    #[test]
    fn chat_export_quotes_workspace_paths_with_spaces() {
        let fake = Arc::new(FakeAgent::default());
        let mut mode = chat_mode_with_fake_agent(fake);
        mode.persisted_session_id = Some("saved-session".to_string());
        let session = Session::new(
            "Dispatcher".to_string(),
            Some("D:\\workspace\\my project".to_string()),
        );
        let mut view = ChatView::new(session, Theme::dark());

        mode.handle_command("/export", &mut view).unwrap();

        let message = &view.session.messages.last().unwrap().content;
        assert!(message.contains(
            "sparo sessions --workspace \"D:\\workspace\\my project\" show saved-session"
        ));
        assert!(message.contains(
            "sparo sessions --workspace \"D:\\workspace\\my project\" export saved-session"
        ));
    }
}
