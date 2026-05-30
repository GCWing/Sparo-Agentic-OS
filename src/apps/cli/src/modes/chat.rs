/// Chat mode implementation
///
/// Interactive chat mode with TUI interface
use anyhow::Result;
use crossterm::event::{Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

use crate::agent::{agentic_system::AgenticSystem, core_adapter::CoreAgentAdapter, Agent};
use crate::config::CliConfig;
use crate::session::Session;
use crate::ui::commands::{command_for_slash, CommandAction, CommandScope, PanelKind};
use crate::ui::chat::ChatView;
use crate::ui::panels::{
    command_count, move_selection, panel_count, selected_command, selected_panel_prompt,
    selected_workspace, OverlayKind, OverlayState,
};
use crate::ui::theme::Theme;
use crate::ui::{init_terminal, restore_terminal};
use uuid;

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
    #[allow(dead_code)]
    pub fn new(
        config: CliConfig,
        agent_name: String,
        workspace_path: Option<PathBuf>,
        agentic_system: &AgenticSystem,
    ) -> Self {
        // Use the real CoreAgentAdapter
        let agent = Arc::new(CoreAgentAdapter::new(
            agent_name.clone(),
            agentic_system.coordinator.clone(),
            agentic_system.event_queue.clone(),
            workspace_path.clone(),
        )) as Arc<dyn Agent>;

        Self {
            config,
            agent_name,
            workspace_path,
            agent,
            initial_input: None,
            persisted_session_id: None,
        }
    }

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
                        tool_name,
                        parameters,
                    } => {
                        if !current_assistant_message_text.is_empty() {
                            chat_view.session.update_last_message_text_flow(
                                current_assistant_message_text.clone(),
                                false,
                            );
                        }

                        let tool_id = uuid::Uuid::new_v4().to_string();
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

                    AgentEvent::ToolCallProgress { tool_name, message } => {
                        for (tool_id, tool) in current_tool_map.iter() {
                            if tool.tool_name == tool_name {
                                let tid = tool_id.clone();
                                chat_view.session.update_tool_in_last_message(&tid, |t| {
                                    t.progress_message = Some(message.clone());
                                });
                                break;
                            }
                        }
                    }

                    AgentEvent::ToolCallComplete {
                        tool_name,
                        result,
                        success,
                    } => {
                        for (tool_id, tool) in current_tool_map.iter_mut() {
                            if tool.tool_name == tool_name && tool.status == ToolCallStatus::Running
                            {
                                tool.status = if success {
                                    ToolCallStatus::Success
                                } else {
                                    ToolCallStatus::Failed
                                };
                                tool.result = Some(result.clone());
                                tool.progress = Some(1.0);

                                let tid = tool_id.clone();
                                chat_view.session.update_tool_in_last_message(&tid, |t| {
                                    t.status = tool.status.clone();
                                    t.result = Some(result.clone());
                                    t.progress = Some(1.0);
                                });
                                break;
                            }
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

            if let Ok(_response) = response_rx.try_recv() {
                current_assistant_message_text.clear();
                current_tool_map.clear();
                chat_view.set_loading(false);
                chat_view.set_status(None);
            }

            if let Some(handle) = &pending_response {
                if handle.is_finished() {
                    pending_response = None;
                    tracing::debug!("Agent response task completed");
                }
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

        restore_terminal(terminal)?;
        tracing::info!("Chat mode exited");

        Ok(exit_reason)
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
                chat_view.clear_screen();
            }

            (KeyCode::Char('t'), KeyModifiers::CONTROL) => {
                self.open_snapshot_panel(PanelKind::Tasks, chat_view)?;
            }

            (KeyCode::Char('p'), KeyModifiers::CONTROL) => {
                self.open_snapshot_panel(PanelKind::Apps, chat_view)?;
            }

            (KeyCode::Char('m'), KeyModifiers::CONTROL) => {
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

                if let Some(input) = chat_view.send_input() {
                    tracing::info!("User input: {}", input);

                    if input.starts_with('/') {
                        self.handle_command(&input, chat_view)?;
                        return Ok(None);
                    }

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
                chat_view.cursor = chat_view.input.len();
            }

            (KeyCode::Char('u'), KeyModifiers::CONTROL) => {
                chat_view.input.clear();
                chat_view.cursor = 0;
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
        let Some(overlay) = chat_view.overlay.as_mut() else {
            return Ok(None);
        };

        match (key.code, key.modifiers) {
            (KeyCode::Esc, _) => {
                chat_view.close_overlay();
            }
            (KeyCode::Up, _) => {
                let count = match overlay.kind {
                    OverlayKind::CommandPalette => command_count(CommandScope::Chat, &overlay.filter),
                    OverlayKind::Panel(_) => panel_count(overlay),
                    OverlayKind::Help => 0,
                };
                move_selection(overlay, -1, count);
            }
            (KeyCode::Down, _) => {
                let count = match overlay.kind {
                    OverlayKind::CommandPalette => command_count(CommandScope::Chat, &overlay.filter),
                    OverlayKind::Panel(_) => panel_count(overlay),
                    OverlayKind::Help => 0,
                };
                move_selection(overlay, 1, count);
            }
            (KeyCode::Backspace, _) if overlay.kind == OverlayKind::CommandPalette => {
                overlay.filter.pop();
                overlay.selected = 0;
            }
            (KeyCode::Char(c), KeyModifiers::NONE | KeyModifiers::SHIFT)
                if overlay.kind == OverlayKind::CommandPalette =>
            {
                if !c.is_control() && c != '/' {
                    overlay.filter.push(c);
                    overlay.selected = 0;
                }
            }
            (KeyCode::Char('r'), KeyModifiers::NONE | KeyModifiers::SHIFT)
                if matches!(overlay.kind, OverlayKind::Panel(_)) =>
            {
                if let OverlayKind::Panel(kind) = overlay.kind {
                    self.open_snapshot_panel(kind, chat_view)?;
                }
            }
            (KeyCode::Enter, _) => match overlay.kind {
                OverlayKind::CommandPalette => {
                    if let Some(command) = selected_command(overlay, CommandScope::Chat) {
                        chat_view.close_overlay();
                        self.apply_command_action(command.action, "", chat_view)?;
                    }
                }
                OverlayKind::Panel(PanelKind::Workspaces) => {
                    if let Some(workspace) = selected_workspace(overlay) {
                        chat_view.close_overlay();
                        chat_view.session.workspace = workspace;
                        chat_view.set_status(Some("Workspace selected for the next action".to_string()));
                    }
                }
                OverlayKind::Panel(_) => {
                    if let Some(prompt) = selected_panel_prompt(overlay) {
                        chat_view.close_overlay();
                        chat_view.input = prompt;
                        chat_view.cursor = chat_view.input.chars().count();
                        chat_view.set_status(Some("Prepared panel action; press Enter to send".to_string()));
                    }
                }
                OverlayKind::Help => {
                    chat_view.close_overlay();
                }
            },
            _ => {}
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
            chat_view.add_message(
                "system".to_string(),
                format!("Unknown command: {}\nType / to open the command palette", parts[0]),
            );
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
            CommandAction::Help => chat_view.open_overlay(OverlayState::help()),
            CommandAction::ClearChat => {
                chat_view.clear_screen();
                chat_view.set_status(Some("Conversation cleared".to_string()));
            }
            CommandAction::Dispatch => {
                if args.is_empty() {
                    chat_view.set_status(Some("Usage: /dispatch <task>".to_string()));
                } else {
                    chat_view.input =
                        format!("Delegate this work to the right specialized Agent: {}", args);
                    chat_view.cursor = chat_view.input.chars().count();
                    chat_view.set_status(Some(
                        "Prepared Dispatcher delegation prompt; press Enter to send".to_string(),
                    ));
                }
            }
            CommandAction::ShowAgents => {
                chat_view.add_message(
                    "system".to_string(),
                    "Available Agents:\n\
                     - Dispatcher - Executive Companion for Agentic OS\n\
                     - agentic - Prime Builder for implementation\n\
                     - Plan - planning and decomposition\n\
                     - debug - debugging and diagnosis\n\
                     - Cowork - collaborative work\n\
                     - Design - design work"
                        .to_string(),
                );
            }
            CommandAction::ShowHistory => {
                chat_view.add_message(
                    "system".to_string(),
                    format!(
                        "Current session statistics:\n\
                             - Messages: {}\n\
                             - Tool calls: {}\n\
                             - Files modified: {}",
                        chat_view.session.metadata.message_count,
                        chat_view.session.metadata.tool_calls,
                        chat_view.session.metadata.files_modified
                    ),
                );
            }
            CommandAction::ExportSession => {
                chat_view.add_message(
                    "system".to_string(),
                    "Persisted agent turns are stored by the shared core session storage. Use the sessions command to inspect saved history.".to_string(),
                );
            }
            CommandAction::NewSession => {
                chat_view.clear_screen();
                chat_view.set_status(Some("Started a fresh visible chat".to_string()));
            }
        }

        Ok(())
    }

    fn open_snapshot_panel(&self, kind: PanelKind, chat_view: &mut ChatView) -> Result<()> {
        let workspace = self
            .workspace_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string());
        let snapshot = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current()
                .block_on(crate::ui::startup::StartupPage::load_snapshot(workspace))
        });

        chat_view.open_overlay(OverlayState::panel(kind, snapshot));
        Ok(())
    }

    #[allow(dead_code)]
    fn show_backend_panel(&self, panel: &str, chat_view: &mut ChatView) -> Result<()> {
        let workspace = self
            .workspace_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string());
        let snapshot = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current()
                .block_on(crate::ui::startup::StartupPage::load_snapshot(workspace))
        });

        let text = match panel {
            "tasks" => {
                let mut lines = vec!["Task Center".to_string(), String::new()];
                if snapshot.tasks.is_empty() {
                    lines.push("No backend-tracked agent tasks found.".to_string());
                } else {
                    for task in snapshot.tasks.iter().take(12) {
                        lines.push(format!(
                            "- {} · {} · {}",
                            task.title, task.agent, task.detail
                        ));
                    }
                }
                lines.join("\n")
            }
            "apps" => {
                let mut lines = vec!["Apps".to_string(), String::new()];
                if snapshot.apps.is_empty() {
                    lines.push("No Agent, Live, or Bridge Apps installed.".to_string());
                } else {
                    for app in snapshot.apps.iter().take(18) {
                        lines.push(format!(
                            "- [{}] {} · {} · {}",
                            app.kind, app.name, app.description, app.capability
                        ));
                    }
                }
                lines.join("\n")
            }
            "memory" => {
                let mut lines = vec!["Memory".to_string(), String::new()];
                if snapshot.memories.is_empty() {
                    lines.push("No memory files found for global/project stores.".to_string());
                } else {
                    for memory in snapshot.memories.iter().take(18) {
                        lines.push(format!(
                            "- {} · {} · {}",
                            memory.scope, memory.file, memory.target
                        ));
                    }
                }
                lines.join("\n")
            }
            "workspace" => {
                let mut lines = vec!["Workspaces".to_string(), String::new()];
                for workspace in &snapshot.workspaces {
                    lines.push(format!(
                        "- {} · {} · {} sessions",
                        workspace.label,
                        workspace
                            .path
                            .as_deref()
                            .unwrap_or("Agentic OS global runtime"),
                        workspace.session_count
                    ));
                }
                lines.join("\n")
            }
            _ => return Ok(()),
        };

        chat_view.add_message("system".to_string(), text);
        Ok(())
    }
}
