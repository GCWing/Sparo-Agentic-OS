//! MCP transport layer
//!
//! Handles JSON-RPC message transport over stdin/stdout.

use super::types::{MCPError, MCPMessage, MCPNotification, MCPRequest, MCPResponse};
use crate::error::{CoreError, CoreResult};
use log::{debug, error, info, warn};
use serde_json::Value;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::mpsc;
use tokio::sync::Mutex;

/// MCP transport.
pub struct MCPTransport {
    stdin: Arc<Mutex<ChildStdin>>,
    request_id: Arc<Mutex<u64>>,
}

impl MCPTransport {
    /// Creates a new transport instance.
    pub fn new(stdin: ChildStdin) -> Self {
        Self {
            stdin: Arc::new(Mutex::new(stdin)),
            request_id: Arc::new(Mutex::new(0)),
        }
    }

    /// Generates a new request ID.
    async fn next_request_id(&self) -> u64 {
        let mut id = self.request_id.lock().await;
        *id += 1;
        *id
    }

    /// Sends a request.
    pub async fn send_request(&self, method: String, params: Option<Value>) -> CoreResult<u64> {
        let id = self.next_request_id().await;
        let request = MCPRequest::new(Value::Number(id.into()), method, params);
        self.send_message(MCPMessage::Request(request)).await?;
        Ok(id)
    }

    /// Sends a notification.
    pub async fn send_notification(&self, method: String, params: Option<Value>) -> CoreResult<()> {
        let notification = MCPNotification::new(method, params);
        self.send_message(MCPMessage::Notification(notification))
            .await
    }

    /// Sends a response.
    pub async fn send_response(&self, id: Value, result: Value) -> CoreResult<()> {
        let response = MCPResponse::success(id, result);
        self.send_message(MCPMessage::Response(response)).await
    }

    /// Sends an error response.
    pub async fn send_error(&self, id: Value, error: MCPError) -> CoreResult<()> {
        let response = MCPResponse::error(id, error);
        self.send_message(MCPMessage::Response(response)).await
    }

    /// Sends a message.
    async fn send_message(&self, message: MCPMessage) -> CoreResult<()> {
        let json = serde_json::to_string(&message).map_err(|e| {
            CoreError::serialization(format!("Failed to serialize MCP message: {}", e))
        })?;

        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(json.as_bytes())
            .await
            .map_err(|e| CoreError::io(format!("Failed to write to MCP server stdin: {}", e)))?;
        stdin.write_all(b"\n").await.map_err(|e| {
            CoreError::io(format!(
                "Failed to write newline to MCP server stdin: {}",
                e
            ))
        })?;
        stdin
            .flush()
            .await
            .map_err(|e| CoreError::io(format!("Failed to flush MCP server stdin: {}", e)))?;

        debug!("Sent MCP message: {}", json);
        Ok(())
    }

    /// Starts the receive loop.
    pub fn start_receive_loop(stdout: ChildStdout, tx: mpsc::UnboundedSender<MCPMessage>) {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();

            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => {
                        info!("MCP server stdout closed");
                        break;
                    }
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }

                        match serde_json::from_str::<MCPMessage>(trimmed) {
                            Ok(message) => {
                                if tx.send(message).is_err() {
                                    warn!("Failed to send MCP message to handler: channel closed");
                                    break;
                                }
                            }
                            Err(e) => {
                                error!("Failed to parse MCP message: {} - Raw: {}", e, trimmed);
                            }
                        }
                    }
                    Err(e) => {
                        error!("Error reading from MCP server stdout: {}", e);
                        break;
                    }
                }
            }
        });
    }
}
