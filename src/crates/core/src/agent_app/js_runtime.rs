//! Persistent Node.js sidecar for Agent App JavaScript runtime tools.
//!
//! Agent App runtime tools used to spawn a fresh `node -e <bootstrap>` process on
//! every single tool call. Node startup plus module resolution costs roughly
//! 50-150ms per call, which dominated the latency of otherwise trivial tools (most
//! Remotion tools just map their input to a `bridgeCall` descriptor).
//!
//! This module keeps one long-lived Node process and serves many tool calls over
//! newline-delimited JSON (NDJSON) on stdin/stdout. The process loads each tool
//! module once via Node's `require` cache, so repeated calls pay neither the Node
//! boot cost nor the module-resolution cost. The per-call host capability surface
//! (`fs`, `shell`, `net`, `log`, `storage`) and the `bridgeCall` return contract are
//! preserved exactly, so existing tools keep working unchanged.

use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

use crate::agent_app::manifest::AgentAppJsToolManifest;
use crate::util::errors::{BitFunError, BitFunResult};

/// Resolve the JavaScript runtime executable. Prefers `node`, falls back to `bun`.
pub fn resolve_js_runtime() -> String {
    if which::which("node").is_ok() {
        "node".to_string()
    } else if which::which("bun").is_ok() {
        "bun".to_string()
    } else {
        "node".to_string()
    }
}

/// Run a single Agent App JS tool on the shared persistent Node sidecar and return
/// the parsed tool result value (which may contain a `bridgeCall` descriptor).
pub async fn run_js_tool(
    app_dir: &Path,
    manifest: &AgentAppJsToolManifest,
    input: &Value,
    workspace_root: Option<&Path>,
) -> BitFunResult<Value> {
    runtime()
        .run(app_dir, manifest, input, workspace_root)
        .await
}

fn runtime() -> &'static JsToolRuntime {
    static RUNTIME: OnceLock<JsToolRuntime> = OnceLock::new();
    RUNTIME.get_or_init(JsToolRuntime::new)
}

/// Owns the lazily-spawned, auto-restarting Node sidecar shared by all Agent App
/// JS runtime tools.
struct JsToolRuntime {
    sidecar: Mutex<Option<Arc<NodeSidecar>>>,
}

impl JsToolRuntime {
    fn new() -> Self {
        Self {
            sidecar: Mutex::new(None),
        }
    }

    /// Return a live sidecar, spawning (or respawning) one if the current process
    /// has exited.
    async fn live_sidecar(&self) -> BitFunResult<Arc<NodeSidecar>> {
        let mut guard = self.sidecar.lock().await;
        if let Some(existing) = guard.as_ref() {
            if existing.is_alive() {
                return Ok(existing.clone());
            }
        }
        let fresh = Arc::new(NodeSidecar::spawn()?);
        *guard = Some(fresh.clone());
        Ok(fresh)
    }

    /// Drop the sidecar from the slot if it is the same instance the caller saw die.
    async fn retire(&self, dead: &Arc<NodeSidecar>) {
        let mut guard = self.sidecar.lock().await;
        if let Some(existing) = guard.as_ref() {
            if Arc::ptr_eq(existing, dead) {
                *guard = None;
            }
        }
    }

    async fn run(
        &self,
        app_dir: &Path,
        manifest: &AgentAppJsToolManifest,
        input: &Value,
        workspace_root: Option<&Path>,
    ) -> BitFunResult<Value> {
        let entry = app_dir.join(&manifest.entry).to_string_lossy().to_string();
        let request = json!({
            "entry": entry,
            "input": input,
            "permissions": serde_json::to_value(&manifest.permissions)
                .unwrap_or_else(|_| json!({})),
            "workspaceRoot": workspace_root
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
            "readonly": manifest.readonly,
        });
        let timeout = Duration::from_millis(manifest.timeout_ms);

        let sidecar = self.live_sidecar().await?;
        let result = match sidecar.call(request.clone(), timeout).await {
            Err(SidecarError::Dead) => {
                // The process died (possibly between attempts). Respawn once and retry.
                self.retire(&sidecar).await;
                let fresh = self.live_sidecar().await?;
                fresh.call(request, timeout).await
            }
            other => other,
        };
        let value = result.map_err(BitFunError::from)?;
        enforce_output_limit(&value, manifest.max_output_bytes)?;
        Ok(value)
    }
}

fn enforce_output_limit(value: &Value, max_output_bytes: usize) -> BitFunResult<()> {
    if max_output_bytes == 0 {
        return Ok(());
    }
    let encoded = serde_json::to_string(value).unwrap_or_default();
    if encoded.len() > max_output_bytes {
        return Err(BitFunError::tool(format!(
            "Agent App JS tool output exceeded {} bytes",
            max_output_bytes
        )));
    }
    Ok(())
}

enum SidecarError {
    /// The sidecar process is gone; the caller may respawn and retry.
    Dead,
    /// The tool itself threw; carries the JS error/stack text.
    Tool(String),
    /// The tool did not respond within its timeout.
    Timeout,
    /// Request could not be serialized for the protocol.
    Protocol(String),
}

impl From<SidecarError> for BitFunError {
    fn from(err: SidecarError) -> Self {
        match err {
            SidecarError::Dead => {
                BitFunError::tool("Agent App JS runtime process is not available")
            }
            SidecarError::Tool(message) => {
                BitFunError::tool(format!("Agent App JS tool failed: {}", message.trim()))
            }
            SidecarError::Timeout => {
                BitFunError::Timeout("Agent App JS runtime tool timed out".to_string())
            }
            SidecarError::Protocol(message) => {
                BitFunError::tool(format!("Agent App JS runtime protocol error: {}", message))
            }
        }
    }
}

type PendingMap = Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>;

/// A single persistent Node process serving NDJSON tool requests.
struct NodeSidecar {
    stdin: Mutex<ChildStdin>,
    pending: Arc<PendingMap>,
    next_id: AtomicU64,
    alive: Arc<AtomicBool>,
    // Kept so the child is killed on drop (kill_on_drop) when a dead sidecar is replaced.
    _child: Mutex<Child>,
}

/// Sentinel error text sent to in-flight waiters when the reader detects EOF.
const DEAD_SENTINEL: &str = "\u{0}__js_runtime_dead__";

impl NodeSidecar {
    fn spawn() -> BitFunResult<Self> {
        let mut child = Command::new(resolve_js_runtime())
            .arg("-e")
            .arg(SERVER_SCRIPT)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| BitFunError::tool(format!("Failed to start JS runtime: {e}")))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| BitFunError::tool("Failed to capture JS runtime stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| BitFunError::tool("Failed to capture JS runtime stdout"))?;
        let stderr = child.stderr.take();

        let pending: Arc<PendingMap> = Arc::new(Mutex::new(HashMap::new()));
        let alive = Arc::new(AtomicBool::new(true));

        // Reader task: demultiplex responses by id back to their waiters.
        {
            let pending = pending.clone();
            let alive = alive.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stdout);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            let trimmed = line.trim();
                            if trimmed.is_empty() {
                                continue;
                            }
                            if let Ok(message) = serde_json::from_str::<Value>(trimmed) {
                                dispatch_response(&pending, message).await;
                            }
                        }
                    }
                }
                alive.store(false, Ordering::SeqCst);
                let mut map = pending.lock().await;
                for (_, tx) in map.drain() {
                    let _ = tx.send(Err(DEAD_SENTINEL.to_string()));
                }
            });
        }

        // Drain stderr so the pipe never blocks; surface tool logs at debug level.
        if let Some(stderr) = stderr {
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            let trimmed = line.trim();
                            if !trimmed.is_empty() {
                                log::debug!("agent app js runtime: {}", trimmed);
                            }
                        }
                    }
                }
            });
        }

        Ok(Self {
            stdin: Mutex::new(stdin),
            pending,
            next_id: AtomicU64::new(1),
            alive,
            _child: Mutex::new(child),
        })
    }

    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    async fn call(&self, mut request: Value, timeout: Duration) -> Result<Value, SidecarError> {
        if !self.is_alive() {
            return Err(SidecarError::Dead);
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        if let Some(object) = request.as_object_mut() {
            object.insert("id".to_string(), json!(id));
        }
        let line = format!(
            "{}\n",
            serde_json::to_string(&request).map_err(|e| SidecarError::Protocol(e.to_string()))?
        );

        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        {
            let mut stdin = self.stdin.lock().await;
            if stdin.write_all(line.as_bytes()).await.is_err() || stdin.flush().await.is_err() {
                self.alive.store(false, Ordering::SeqCst);
                self.pending.lock().await.remove(&id);
                return Err(SidecarError::Dead);
            }
        }

        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(Ok(value))) => Ok(value),
            Ok(Ok(Err(message))) if message == DEAD_SENTINEL => Err(SidecarError::Dead),
            Ok(Ok(Err(message))) => Err(SidecarError::Tool(message)),
            Ok(Err(_canceled)) => Err(SidecarError::Dead),
            Err(_elapsed) => {
                self.pending.lock().await.remove(&id);
                Err(SidecarError::Timeout)
            }
        }
    }
}

async fn dispatch_response(pending: &PendingMap, message: Value) {
    let Some(id) = message.get("id").and_then(Value::as_u64) else {
        return;
    };
    let ok = message.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let payload = if ok {
        Ok(message.get("result").cloned().unwrap_or(Value::Null))
    } else {
        Err(message
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Agent App JS tool failed")
            .to_string())
    };
    if let Some(tx) = pending.lock().await.remove(&id) {
        let _ = tx.send(payload);
    }
}

/// The persistent server loop executed by the Node sidecar. It reads one JSON
/// request per line and writes one JSON response per line. Each request carries the
/// absolute tool `entry`, the `input`, the declared `permissions`, the
/// `workspaceRoot`, and the `readonly` flag, so a single process can safely serve
/// every Agent App tool. The host capability surface mirrors the previous per-call
/// bootstrap exactly.
const SERVER_SCRIPT: &str = r#"'use strict';
const fs = require('fs/promises');
const path = require('path');
const child_process = require('child_process');
const readline = require('readline');

process.on('uncaughtException', (error) => {
  try { console.error('[uncaughtException]', error && error.stack ? error.stack : String(error)); } catch (_) {}
});
process.on('unhandledRejection', (error) => {
  try { console.error('[unhandledRejection]', error && error.stack ? error.stack : String(error)); } catch (_) {}
});

function buildContext(entry, permissions, workspaceRoot, readonly) {
  const appDir = path.dirname(entry);
  permissions = permissions || {};
  function expandRoot(root) {
    return String(root || '').replace('{workspace}', workspaceRoot).replace('{app}', appDir);
  }
  function within(target, root) {
    if (!root) return false;
    const rel = path.relative(path.resolve(root), path.resolve(target));
    return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
  }
  function allowed(target, roots) {
    return (roots || []).some((root) => within(target, expandRoot(root)));
  }
  function assertRead(target) {
    if (!allowed(target, permissions.fs && permissions.fs.read)) throw new Error('Read path is not allowed: ' + target);
  }
  function assertWrite(target) {
    if (!allowed(target, permissions.fs && permissions.fs.write)) throw new Error('Write path is not allowed: ' + target);
  }
  async function walk(dir, suffix, out) {
    assertRead(dir);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const item of entries) {
      const p = path.join(dir, item.name);
      if (item.isDirectory()) await walk(p, suffix, out);
      else if (!suffix || p.endsWith(suffix)) out.push(p);
    }
  }
  return {
    workspaceRoot,
    appDir,
    fs: {
      readText: async (p) => { assertRead(p); return fs.readFile(p, 'utf8'); },
      writeText: async (p, text) => { assertWrite(p); await fs.mkdir(path.dirname(p), { recursive: true }); return fs.writeFile(p, text, 'utf8'); },
      glob: async (pattern) => {
        const base = pattern.includes('**') ? pattern.slice(0, pattern.indexOf('**')) : path.dirname(pattern);
        const suffix = pattern.includes('*') ? pattern.slice(pattern.lastIndexOf('*') + 1) : '';
        const out = [];
        await walk(path.resolve(base || '.'), suffix, out);
        return out;
      }
    },
    shell: {
      exec: async (command) => new Promise((resolve, reject) => {
        const allow = (permissions.shell && permissions.shell.allow) || [];
        if (!allow.includes(command)) return reject(new Error('Shell command is not allowed: ' + command));
        child_process.exec(command, { cwd: workspaceRoot || appDir, timeout: 30000 }, (error, stdout, stderr) => {
          if (error) reject(error); else resolve({ stdout, stderr });
        });
      })
    },
    net: {
      fetch: async (url, options) => {
        const allow = (permissions.net && permissions.net.allow) || [];
        if (!allow.some((prefix) => String(url).startsWith(prefix))) throw new Error('Network URL is not allowed: ' + url);
        return fetch(url, options);
      }
    },
    log: {
      info: (...args) => console.error('[info]', ...args),
      warn: (...args) => console.error('[warn]', ...args),
      error: (...args) => console.error('[error]', ...args)
    },
    storage: {
      get: async (key) => {
        const file = path.join(appDir, '..', 'storage.json');
        try { return JSON.parse(await fs.readFile(file, 'utf8'))[key]; } catch { return undefined; }
      },
      set: async (key, value) => {
        if (readonly) throw new Error('Readonly Agent App JS tools cannot write storage');
        const file = path.join(appDir, '..', 'storage.json');
        let data = {};
        try { data = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
        data[key] = value;
        await fs.writeFile(file, JSON.stringify(data, null, 2));
      }
    }
  };
}

let writeChain = Promise.resolve();
function send(message) {
  const line = JSON.stringify(message) + '\n';
  writeChain = writeChain.then(() => new Promise((resolve) => process.stdout.write(line, resolve)));
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (raw) => {
  const line = raw.trim();
  if (!line) return;
  let request;
  try { request = JSON.parse(line); } catch (error) { return; }
  const id = request.id;
  (async () => {
    try {
      const context = buildContext(request.entry, request.permissions, request.workspaceRoot || '', !!request.readonly);
      const mod = require(request.entry);
      if (!mod || typeof mod.run !== 'function') throw new Error('JS runtime tool must export async run(input, context)');
      const result = await mod.run(request.input, context);
      send({ id, ok: true, result: result === undefined ? {} : result });
    } catch (error) {
      send({ id, ok: false, error: (error && error.stack) ? error.stack : String(error) });
    }
  })();
});
rl.on('close', () => process.exit(0));
"#;
