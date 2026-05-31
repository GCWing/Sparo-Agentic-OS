use crate::agent::{
    agentic_system::AgenticSystem, core_adapter::CoreAgentAdapter, Agent, AgentEvent,
};
/// Exec mode implementation
///
/// Single command execution mode
use anyhow::{anyhow, Result};
use serde::Serialize;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::time::{Duration, Sleep};

#[derive(Debug, Serialize)]
pub struct ExecRunOutput {
    pub success: bool,
    pub message: String,
    pub agent: String,
    pub workspace_path: Option<String>,
    pub duration_ms: u128,
    pub timeout_secs: Option<u64>,
    pub timed_out: bool,
    pub assistant_text: String,
    pub tool_calls: Vec<crate::session::ToolCall>,
    pub patch: Option<String>,
    pub patch_written_to: Option<String>,
    pub error_kind: Option<String>,
    pub error: Option<String>,
}

pub struct ExecMode {
    message: String,
    agent: Arc<dyn Agent>,
    workspace_path: Option<PathBuf>,
    /// None: no patch output, Some("-"): output to stdout, Some(path): save to file
    output_patch: Option<String>,
    json_output: bool,
    suppress_output: bool,
    timeout_secs: Option<u64>,
}

fn suppress_top_level_error_after_json_output(json_output: bool, suppress_output: bool) -> bool {
    json_output && !suppress_output
}

impl ExecMode {
    pub fn new(
        message: String,
        agent_type: String,
        agentic_system: &AgenticSystem,
        workspace_path: Option<PathBuf>,
        output_patch: Option<String>,
        json_output: bool,
        timeout_secs: Option<u64>,
    ) -> Self {
        // Use the real CoreAgentAdapter
        let agent = Arc::new(CoreAgentAdapter::new(
            agent_type,
            agentic_system.coordinator.clone(),
            agentic_system.event_queue.clone(),
            workspace_path.clone(),
        )) as Arc<dyn Agent>;

        Self {
            message,
            agent,
            workspace_path,
            output_patch,
            json_output,
            suppress_output: false,
            timeout_secs,
        }
    }

    pub fn suppress_output(&mut self, suppress_output: bool) {
        self.suppress_output = suppress_output;
    }

    fn get_git_diff(&self) -> Option<String> {
        let workspace = self.workspace_path.as_ref()?;

        let git_dir = workspace.join(".git");
        if !git_dir.exists() {
            eprintln!("Warning: Workspace is not a git repository, cannot generate patch");
            return None;
        }

        let output = bitfun_core::util::process_manager::create_command("git")
            .args(["diff", "--no-color"])
            .current_dir(workspace)
            .output()
            .ok()?;

        if output.status.success() {
            Some(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            eprintln!("Warning: git diff execution failed");
            None
        }
    }

    pub async fn run(&mut self) -> Result<()> {
        tracing::info!(
            "Executing command, Agent: {}, Message: {}",
            self.agent.name(),
            self.message
        );

        if !self.json_output && !self.suppress_output {
            println!("Executing: {}", self.message);
            println!();
        }

        let started_at = std::time::Instant::now();
        let (event_tx, mut event_rx) = mpsc::unbounded_channel();
        let agent = self.agent.clone();
        let message = self.message.clone();
        let agent_name = self.agent.name().to_string();
        let mut assistant_text = String::new();
        let mut event_error: Option<String> = None;
        let mut timed_out = false;
        let mut timeout_sleep: Option<Pin<Box<Sleep>>> = self
            .timeout_secs
            .map(|secs| Box::pin(tokio::time::sleep(Duration::from_secs(secs))));

        let handle = tokio::spawn(async move { agent.process_message(message, event_tx).await });

        loop {
            let event = if let Some(timeout_sleep) = timeout_sleep.as_mut() {
                tokio::select! {
                    _ = timeout_sleep.as_mut() => {
                        timed_out = true;
                        break;
                    }
                    event = event_rx.recv() => event,
                }
            } else {
                event_rx.recv().await
            };

            let Some(event) = event else {
                break;
            };

            match event {
                AgentEvent::Thinking => {
                    if !self.json_output && !self.suppress_output {
                        println!("Thinking...");
                    }
                }
                AgentEvent::TextChunk(chunk) => {
                    assistant_text.push_str(&chunk);
                    if !self.json_output && !self.suppress_output {
                        print!("{}", chunk);
                        use std::io::Write;
                        std::io::stdout().flush().ok();
                    }
                }
                AgentEvent::ToolCallStart {
                    tool_id: _,
                    tool_name,
                    parameters: _,
                } => {
                    if !self.json_output && !self.suppress_output {
                        println!("\nTool call: {}", tool_name);
                    }
                }
                AgentEvent::ToolCallProgress {
                    tool_id: _,
                    tool_name,
                    message,
                } => {
                    if !self.json_output && !self.suppress_output {
                        println!("   In progress {}: {}", tool_name, message);
                    }
                }
                AgentEvent::ToolCallComplete {
                    tool_id: _,
                    tool_name,
                    result,
                    success,
                } => {
                    if !self.json_output && !self.suppress_output {
                        if success {
                            println!("   [+] {}: {}", tool_name, result);
                        } else {
                            println!("   [x] {}: {}", tool_name, result);
                        }
                    }
                }
                AgentEvent::Done => {
                    if !self.json_output && !self.suppress_output {
                        println!("\n");
                    }
                    break;
                }
                AgentEvent::Error(err) => {
                    event_error = Some(err.clone());
                    if !self.json_output && !self.suppress_output {
                        eprintln!("\nError: {}", err);
                    }
                    break;
                }
            }
        }

        if timed_out {
            handle.abort();
        }

        let result = handle.await;

        let mut output = ExecRunOutput {
            success: false,
            message: self.message.clone(),
            agent: agent_name,
            workspace_path: self
                .workspace_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            duration_ms: started_at.elapsed().as_millis(),
            timeout_secs: self.timeout_secs,
            timed_out,
            assistant_text,
            tool_calls: Vec::new(),
            patch: None,
            patch_written_to: None,
            error_kind: None,
            error: event_error,
        };

        let mut failure: Option<anyhow::Error> = if timed_out {
            let timeout_secs = self.timeout_secs.unwrap_or_default();
            let message = format!("CLI exec timed out after {} seconds", timeout_secs);
            output.error_kind = Some("timeout".to_string());
            output.error = Some(message.clone());
            Some(anyhow!(message))
        } else {
            None
        };

        match result {
            Ok(Ok(response)) => {
                output.success = response.success;
                output.tool_calls = response.tool_calls;
                if response.success {
                    if !self.json_output && !self.suppress_output {
                        println!("Execution complete");
                        if !output.tool_calls.is_empty() {
                            println!(
                                "\nTool call statistics: {} tools invoked",
                                output.tool_calls.len()
                            );
                        }
                    }
                } else {
                    if output.error.is_none() {
                        output.error = Some("Agent execution failed".to_string());
                    }
                    if output.error_kind.is_none() {
                        output.error_kind = Some("agent_failed".to_string());
                    }
                    if !self.json_output && !self.suppress_output {
                        println!("Execution failed");
                    }
                    failure = Some(anyhow!(
                        "{}",
                        output
                            .error
                            .clone()
                            .unwrap_or_else(|| "Agent execution failed".to_string())
                    ));
                }
            }
            Ok(Err(e)) => {
                if !self.suppress_output {
                    eprintln!("Execution failed: {}", e);
                }
                output.error_kind = Some("agent_error".to_string());
                output.error = Some(e.to_string());
                failure = Some(e);
            }
            Err(e) => {
                if !timed_out {
                    if !self.suppress_output {
                        eprintln!("Task failed: {}", e);
                    }
                    output.error_kind = Some("join_error".to_string());
                    output.error = Some(e.to_string());
                    failure = Some(e.into());
                }
            }
        }

        output.duration_ms = started_at.elapsed().as_millis();

        self.emit_patch(&mut output);

        let emitted_json_output =
            suppress_top_level_error_after_json_output(self.json_output, self.suppress_output);
        if emitted_json_output {
            println!("{}", serde_json::to_string_pretty(&output)?);
        }

        if let Some(error) = failure {
            if emitted_json_output {
                return Err(anyhow!(crate::JSON_OUTPUT_ALREADY_EMITTED));
            }
            return Err(error);
        }

        Ok(())
    }

    fn emit_patch(&self, output: &mut ExecRunOutput) {
        let Some(ref output_target) = self.output_patch else {
            return;
        };

        if !self.json_output && !self.suppress_output {
            println!("\n--- Generating Patch ---");
        }

        if let Some(patch) = self.get_git_diff() {
            if patch.trim().is_empty() {
                if !self.json_output && !self.suppress_output {
                    println!("(No file modifications)");
                }
                output.patch = Some(String::new());
            } else if output_target == "-" {
                output.patch = Some(patch.clone());
                if !self.json_output && !self.suppress_output {
                    println!("---PATCH_START---");
                    println!("{}", patch);
                    println!("---PATCH_END---");
                }
            } else {
                match std::fs::write(output_target, &patch) {
                    Ok(_) => {
                        output.patch_written_to = Some(output_target.clone());
                        if !self.json_output && !self.suppress_output {
                            println!("Patch saved to: {}", output_target);
                            println!("({} bytes)", patch.len());
                        }
                    }
                    Err(e) => {
                        if !self.suppress_output {
                            eprintln!("Failed to save patch: {}", e);
                        }
                        output.patch = Some(patch.clone());
                        if !self.json_output && !self.suppress_output {
                            println!("---PATCH_START---");
                            println!("{}", patch);
                            println!("---PATCH_END---");
                        }
                    }
                }
            }
        } else if !self.json_output && !self.suppress_output {
            println!("(Unable to generate patch)");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exec_run_output_serializes_script_contract() {
        let output = ExecRunOutput {
            success: true,
            message: "hello".to_string(),
            agent: "Sparo".to_string(),
            workspace_path: Some("D:\\workspace".to_string()),
            duration_ms: 10,
            timeout_secs: Some(600),
            timed_out: false,
            assistant_text: "done".to_string(),
            tool_calls: Vec::new(),
            patch: Some(String::new()),
            patch_written_to: None,
            error_kind: None,
            error: None,
        };

        let value = serde_json::to_value(output).unwrap();
        assert_eq!(value["success"], true);
        assert_eq!(value["message"], "hello");
        assert_eq!(value["assistant_text"], "done");
        assert_eq!(value["duration_ms"], 10);
        assert_eq!(value["timeout_secs"], 600);
        assert_eq!(value["timed_out"], false);
        assert_eq!(value["error_kind"], serde_json::Value::Null);
        assert!(value["tool_calls"].as_array().unwrap().is_empty());
    }

    #[test]
    fn exec_json_failure_uses_already_emitted_marker() {
        assert!(suppress_top_level_error_after_json_output(true, false));
        assert!(!suppress_top_level_error_after_json_output(true, true));
        assert!(!suppress_top_level_error_after_json_output(false, false));
    }
}
