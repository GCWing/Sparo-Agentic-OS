//! Persistent Bridge Component daemon pool.
//!
//! Bridges declared with `kind: "daemon"` keep a warm process and speak NDJSON
//! request/response over stdin/stdout. One-shot bridges still use the
//! spawn-per-call path in `manager.rs`.

use super::worker_protocol::{BridgeWorkerEnvelope, BridgeWorkerStartRequest};
use crate::bridge_component::{BridgeComponentEvent, BridgeComponentRunStatus};
use crate::error::{CoreError, CoreResult};
use log::warn;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{Mutex, Notify};
use tokio_util::sync::CancellationToken;

#[cfg(windows)]
use win32job::{ExtendedLimitInfo, Job};

const DEFAULT_IDLE_TIMEOUT_MS: u64 = 5 * 60 * 1000;
const MAX_REQUEST_BYTES: usize = 4 * 1024 * 1024;
const MAX_STDOUT_FRAME_BYTES: usize = 8 * 1024 * 1024;
const MAX_CALL_OUTPUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_CALL_EVENTS: usize = 10_000;
const MAX_DAEMON_STDERR_BYTES: usize = 1024 * 1024;
const MAX_FINGERPRINT_FILES: usize = 4_096;
const MAX_FINGERPRINT_BYTES: u64 = 64 * 1024 * 1024;
pub const DEFAULT_DAEMON_CALL_TIMEOUT_MS: u64 = 120_000;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct DaemonKey {
    bridge_id: String,
    canonical_app_dir: PathBuf,
    canonical_entry: PathBuf,
    runtime_fingerprint: String,
}

impl DaemonKey {
    fn same_runtime_location(&self, other: &Self) -> bool {
        self.bridge_id == other.bridge_id
            && self.canonical_app_dir == other.canonical_app_dir
            && self.canonical_entry == other.canonical_entry
    }

    fn label(&self) -> String {
        format!("{} ({})", self.bridge_id, self.canonical_app_dir.display())
    }
}

struct DaemonProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    stderr_limit_exceeded: Arc<AtomicBool>,
    stderr_limit_notify: Arc<Notify>,
    last_used: Instant,
    idle_timeout: Option<Duration>,
    #[cfg(windows)]
    process_job: Option<Job>,
}

type SharedDaemonProcess = Arc<Mutex<DaemonProcess>>;

#[derive(Debug)]
pub struct DaemonCallResult {
    pub events: Vec<BridgeComponentEvent>,
    pub output: Option<Value>,
    pub status: BridgeComponentRunStatus,
}

pub struct BridgeDaemonPool {
    // The map lock only protects daemon discovery/replacement. Each daemon has
    // its own lock so unrelated Bridge Components can run concurrently while
    // requests for the same warm process remain ordered on stdin/stdout.
    processes: Mutex<HashMap<DaemonKey, SharedDaemonProcess>>,
    reaper_started: AtomicBool,
}

impl BridgeDaemonPool {
    pub fn new() -> Self {
        Self {
            processes: Mutex::new(HashMap::new()),
            reaper_started: AtomicBool::new(false),
        }
    }

    pub async fn call(
        &self,
        bridge_id: &str,
        app_dir: &Path,
        entry: &Path,
        runtime_context_fingerprint: &str,
        mut command: Command,
        request: &BridgeWorkerStartRequest,
        idle_timeout_ms: Option<u64>,
        timeout_ms: u64,
        cancellation: &CancellationToken,
    ) -> CoreResult<DaemonCallResult> {
        let expected_run_id = request
            .run_id
            .as_deref()
            .filter(|run_id| !run_id.trim().is_empty())
            .ok_or_else(|| {
                CoreError::validation("Bridge Component daemon request requires a run id")
            })?;
        if request.bridge_id != bridge_id {
            return Err(CoreError::validation(format!(
                "Bridge Component daemon request bridge id '{}' does not match '{}'",
                request.bridge_id, bridge_id
            )));
        }

        let request_json = serde_json::to_vec(request)?;
        if request_json.len() > MAX_REQUEST_BYTES {
            return Err(CoreError::validation(format!(
                "Bridge Component daemon request exceeds the {} byte limit",
                MAX_REQUEST_BYTES
            )));
        }

        let app_dir_owned = app_dir.to_path_buf();
        let entry_owned = entry.to_path_buf();
        let bridge_id_owned = bridge_id.to_string();
        let runtime_context_fingerprint = runtime_context_fingerprint.to_string();
        let key = tokio::task::spawn_blocking(move || {
            build_daemon_key(
                &bridge_id_owned,
                &app_dir_owned,
                &entry_owned,
                &runtime_context_fingerprint,
            )
        })
        .await
        .map_err(|error| {
            CoreError::Process(format!(
                "Failed to join Bridge Component fingerprint task: {error}"
            ))
        })??;

        self.evict_idle().await;
        let process = self
            .get_or_spawn(
                &key,
                app_dir,
                &mut command,
                resolve_idle_timeout(idle_timeout_ms),
            )
            .await?;

        let mut process_guard = tokio::select! {
            _ = cancellation.cancelled() => {
                // No request frame was written, so cancelling a queued call
                // must not disturb a different call currently using the daemon.
                return Err(CoreError::cancelled("Bridge Component daemon call cancelled"));
            }
            process_guard = process.lock() => process_guard,
        };
        let result = {
            let process = &mut process_guard;
            process.last_used = Instant::now();
            let result = tokio::select! {
                _ = cancellation.cancelled() => {
                    Err(CoreError::cancelled("Bridge Component daemon call cancelled"))
                }
                result = tokio::time::timeout(
                    Duration::from_millis(timeout_ms.max(1_000)),
                    call_once(process, &request_json, bridge_id, expected_run_id),
                ) => match result {
                    Ok(Ok(value)) => Ok(value),
                    Ok(Err(error)) => Err(error),
                    Err(_) => Err(CoreError::Timeout(
                        "Bridge Component daemon call timed out".to_string(),
                    )),
                },
            };
            process.last_used = Instant::now();
            result
        };
        drop(process_guard);

        match result {
            Ok(value) => Ok(value),
            Err(error) => {
                // Protocol, IO, EOF, stderr-limit, and timeout failures make
                // stream alignment unknowable. Retire the process instead of
                // letting a later request consume stale frames.
                if self.remove_if_same(&key, &process).await {
                    let mut dead = process.lock().await;
                    kill_daemon(&mut dead).await;
                }
                Err(error)
            }
        }
    }

    async fn get_or_spawn(
        &self,
        key: &DaemonKey,
        app_dir: &Path,
        command: &mut Command,
        idle_timeout: Option<Duration>,
    ) -> CoreResult<SharedDaemonProcess> {
        let (existing, superseded) = {
            let mut processes = self.processes.lock().await;
            let existing = processes.get(key).cloned();
            let superseded_keys = processes
                .keys()
                .filter(|candidate| candidate.same_runtime_location(key) && *candidate != key)
                .cloned()
                .collect::<Vec<_>>();
            let superseded = superseded_keys
                .into_iter()
                .filter_map(|candidate| processes.remove(&candidate))
                .collect::<Vec<_>>();
            (existing, superseded)
        };

        // A package or manifest content change gets a new fingerprint. Retire
        // the prior daemon before starting the replacement at that location.
        for old in superseded {
            let mut old = old.lock().await;
            kill_daemon(&mut old).await;
        }

        if let Some(existing) = existing {
            let exited = {
                let mut process = existing.lock().await;
                process.child.try_wait().ok().flatten().is_some()
            };
            if !exited {
                return Ok(existing);
            }
            if self.remove_if_same(key, &existing).await {
                let mut old = existing.lock().await;
                kill_daemon(&mut old).await;
            }
        }

        // Spawning outside the map lock keeps other runtimes responsive. If
        // another caller wins the same-key race, keep its daemon and retire the
        // redundant process we just created.
        let spawned = Arc::new(Mutex::new(
            spawn_daemon(app_dir, command, idle_timeout).await?,
        ));
        let selected = {
            let mut processes = self.processes.lock().await;
            processes
                .entry(key.clone())
                .or_insert_with(|| spawned.clone())
                .clone()
        };
        if !Arc::ptr_eq(&selected, &spawned) {
            let mut redundant = spawned.lock().await;
            kill_daemon(&mut redundant).await;
        }
        Ok(selected)
    }

    async fn remove_if_same(&self, key: &DaemonKey, expected: &SharedDaemonProcess) -> bool {
        let mut processes = self.processes.lock().await;
        let matches = processes
            .get(key)
            .is_some_and(|current| Arc::ptr_eq(current, expected));
        if matches {
            processes.remove(key);
        }
        matches
    }

    async fn evict_idle(&self) {
        let stale = {
            let mut processes = self.processes.lock().await;
            take_idle(&mut processes)
        };
        for (key, process) in stale {
            warn!("Evicting stale Bridge Component daemon: {}", key.label());
            let mut process = process.lock().await;
            kill_daemon(&mut process).await;
        }
    }

    fn start_idle_reaper(self: &Arc<Self>) {
        let Ok(handle) = tokio::runtime::Handle::try_current() else {
            return;
        };
        if self
            .reaper_started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }
        let pool = Arc::downgrade(self);
        handle.spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            interval.tick().await;
            loop {
                interval.tick().await;
                let Some(pool) = pool.upgrade() else {
                    break;
                };
                pool.evict_idle().await;
            }
        });
    }

    #[allow(dead_code)]
    pub async fn shutdown(&self) {
        let processes = {
            let mut processes = self.processes.lock().await;
            processes
                .drain()
                .map(|(_, process)| process)
                .collect::<Vec<_>>()
        };
        for process in processes {
            let mut process = process.lock().await;
            kill_daemon(&mut process).await;
        }
    }
}

async fn kill_daemon(process: &mut DaemonProcess) {
    #[cfg(windows)]
    {
        // Closing a kill-on-job-close Job terminates the daemon and any child
        // processes it launched, unlike Child::kill which only targets the
        // immediate process on Windows.
        process.process_job.take();
    }
    let _ = process.child.kill().await;
    let _ = process.child.wait().await;
}

impl Drop for BridgeDaemonPool {
    fn drop(&mut self) {
        for process in self.processes.get_mut().values() {
            if let Ok(mut process) = process.try_lock() {
                #[cfg(windows)]
                {
                    process.process_job.take();
                }
                let _ = process.child.start_kill();
            }
        }
    }
}

fn take_idle(
    processes: &mut HashMap<DaemonKey, SharedDaemonProcess>,
) -> Vec<(DaemonKey, SharedDaemonProcess)> {
    let now = Instant::now();
    let stale = processes
        .iter()
        .filter_map(|(key, process)| {
            // A count above one means a caller already holds or is waiting on
            // this daemon. Do not retire it between discovery and use.
            if Arc::strong_count(process) > 1 {
                return None;
            }
            let process = process.try_lock().ok()?;
            (process.stderr_limit_exceeded.load(Ordering::Acquire)
                || process
                    .idle_timeout
                    .is_some_and(|timeout| now.duration_since(process.last_used) > timeout))
            .then(|| key.clone())
        })
        .collect::<Vec<_>>();
    stale
        .into_iter()
        .filter_map(|key| processes.remove(&key).map(|process| (key, process)))
        .collect()
}

async fn spawn_daemon(
    app_dir: &Path,
    command: &mut Command,
    idle_timeout: Option<Duration>,
) -> CoreResult<DaemonProcess> {
    command.current_dir(app_dir);
    command.kill_on_drop(true);
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| CoreError::Process(format!("Failed to start Bridge Component daemon: {e}")))?;
    #[cfg(windows)]
    let process_job = attach_windows_process_job(&child);
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| CoreError::Process("Daemon stdin was not piped".to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CoreError::Process("Daemon stdout was not piped".to_string()))?;

    let stderr_limit_exceeded = Arc::new(AtomicBool::new(false));
    let stderr_limit_notify = Arc::new(Notify::new());
    if let Some(mut stderr) = child.stderr.take() {
        let limit_exceeded = stderr_limit_exceeded.clone();
        let limit_notify = stderr_limit_notify.clone();
        tokio::spawn(async move {
            let mut buffer = [0_u8; 8 * 1024];
            let mut total = 0_usize;
            let mut reported_output = false;
            loop {
                match stderr.read(&mut buffer).await {
                    Ok(0) => break,
                    Ok(read) => {
                        total = total.saturating_add(read);
                        if !reported_output {
                            warn!("Bridge Component daemon wrote to stderr");
                            reported_output = true;
                        }
                        if total > MAX_DAEMON_STDERR_BYTES
                            && !limit_exceeded.swap(true, Ordering::AcqRel)
                        {
                            warn!(
                                "Bridge Component daemon stderr exceeded the {} byte limit",
                                MAX_DAEMON_STDERR_BYTES
                            );
                            limit_notify.notify_one();
                        }
                        // Keep draining after the limit so the child cannot
                        // block on a full stderr pipe while the call is retired.
                    }
                    Err(_) => break,
                }
            }
        });
    }
    Ok(DaemonProcess {
        child,
        stdin,
        stdout: BufReader::new(stdout),
        stderr_limit_exceeded,
        stderr_limit_notify,
        last_used: Instant::now(),
        idle_timeout,
        #[cfg(windows)]
        process_job,
    })
}

fn resolve_idle_timeout(configured_ms: Option<u64>) -> Option<Duration> {
    match configured_ms {
        Some(0) => None,
        Some(milliseconds) => Some(Duration::from_millis(milliseconds)),
        None => Some(Duration::from_millis(DEFAULT_IDLE_TIMEOUT_MS)),
    }
}

#[cfg(windows)]
fn attach_windows_process_job(child: &Child) -> Option<Job> {
    let job = match Job::create() {
        Ok(job) => job,
        Err(error) => {
            warn!("Failed to create Bridge Component daemon process job: {error}");
            return None;
        }
    };
    let mut info = ExtendedLimitInfo::new();
    info.limit_kill_on_job_close();
    if let Err(error) = job.set_extended_limit_info(&info) {
        warn!("Failed to configure Bridge Component daemon process job: {error}");
        return None;
    }
    let Some(process_handle) = child.raw_handle() else {
        warn!("Failed to assign exited Bridge Component daemon to process job");
        return None;
    };
    if let Err(error) = job.assign_process(process_handle as isize) {
        warn!("Failed to assign Bridge Component daemon to process job: {error}");
        return None;
    }
    Some(job)
}

async fn call_once(
    process: &mut DaemonProcess,
    request_json: &[u8],
    expected_bridge_id: &str,
    expected_run_id: &str,
) -> CoreResult<DaemonCallResult> {
    if process.stderr_limit_exceeded.load(Ordering::Acquire) {
        return Err(stderr_limit_error());
    }

    process.stdin.write_all(request_json).await?;
    process.stdin.write_all(b"\n").await?;
    process.stdin.flush().await?;

    let mut events = Vec::new();
    let mut final_output = None;
    let mut cumulative_bytes = 0_usize;

    loop {
        if process.stderr_limit_exceeded.load(Ordering::Acquire) {
            return Err(stderr_limit_error());
        }
        let frame = tokio::select! {
            _ = process.stderr_limit_notify.notified() => {
                return Err(stderr_limit_error());
            }
            frame = read_stdout_frame(&mut process.stdout) => frame?,
        };
        if process.stderr_limit_exceeded.load(Ordering::Acquire) {
            return Err(stderr_limit_error());
        }
        if frame.is_empty() {
            continue;
        }
        cumulative_bytes = cumulative_bytes.saturating_add(frame.len());
        if cumulative_bytes > MAX_CALL_OUTPUT_BYTES {
            return Err(CoreError::Process(format!(
                "Bridge Component daemon output exceeds the {} byte per-call limit",
                MAX_CALL_OUTPUT_BYTES
            )));
        }

        let envelope = decode_correlated_envelope(&frame, expected_bridge_id, expected_run_id)?;
        if let BridgeComponentEvent::RunStarted { run_id } = &envelope.event {
            if run_id != expected_run_id {
                return Err(CoreError::Process(format!(
                    "Bridge Component daemon run.started id '{}' does not match expected run id '{}'",
                    run_id, expected_run_id
                )));
            }
        }

        capture_event(&envelope.event, &mut final_output);
        let terminal_status = terminal_status(&envelope.event);
        events.push(envelope.event);
        if events.len() > MAX_CALL_EVENTS {
            return Err(CoreError::Process(format!(
                "Bridge Component daemon emitted more than {MAX_CALL_EVENTS} events in one call"
            )));
        }
        if let Some(status) = terminal_status {
            return Ok(DaemonCallResult {
                events,
                output: final_output,
                status,
            });
        }
    }
}

async fn read_stdout_frame(stdout: &mut BufReader<ChildStdout>) -> CoreResult<Vec<u8>> {
    let mut frame = Vec::new();
    loop {
        let (consumed, complete) = {
            let available = stdout.fill_buf().await?;
            if available.is_empty() {
                return Err(CoreError::Process(
                    "Bridge Component daemon closed stdout unexpectedly".to_string(),
                ));
            }
            if let Some(newline) = available.iter().position(|byte| *byte == b'\n') {
                if frame.len().saturating_add(newline) > MAX_STDOUT_FRAME_BYTES {
                    return Err(stdout_frame_limit_error());
                }
                frame.extend_from_slice(&available[..newline]);
                (newline + 1, true)
            } else {
                if frame.len().saturating_add(available.len()) > MAX_STDOUT_FRAME_BYTES {
                    return Err(stdout_frame_limit_error());
                }
                frame.extend_from_slice(available);
                (available.len(), false)
            }
        };
        stdout.consume(consumed);
        if complete {
            let start = frame
                .iter()
                .position(|byte| !byte.is_ascii_whitespace())
                .unwrap_or(frame.len());
            let end = frame
                .iter()
                .rposition(|byte| !byte.is_ascii_whitespace())
                .map_or(start, |index| index + 1);
            return Ok(frame[start..end].to_vec());
        }
    }
}

fn decode_correlated_envelope(
    frame: &[u8],
    expected_bridge_id: &str,
    expected_run_id: &str,
) -> CoreResult<BridgeWorkerEnvelope> {
    let envelope = serde_json::from_slice::<BridgeWorkerEnvelope>(frame).map_err(|error| {
        CoreError::Process(format!(
            "Bridge Component daemon emitted an invalid or uncorrelated response envelope: {error}"
        ))
    })?;
    if envelope.bridge_id != expected_bridge_id || envelope.run_id != expected_run_id {
        return Err(CoreError::Process(format!(
            "Bridge Component daemon response correlation mismatch: expected bridge '{}' run '{}', received bridge '{}' run '{}'",
            expected_bridge_id,
            expected_run_id,
            envelope.bridge_id,
            envelope.run_id
        )));
    }
    Ok(envelope)
}

fn terminal_status(event: &BridgeComponentEvent) -> Option<BridgeComponentRunStatus> {
    match event {
        BridgeComponentEvent::RunCompleted { .. } => Some(BridgeComponentRunStatus::Completed),
        BridgeComponentEvent::RunFailed { .. } => Some(BridgeComponentRunStatus::Failed),
        BridgeComponentEvent::RunCancelled { .. } => Some(BridgeComponentRunStatus::Cancelled),
        _ => None,
    }
}

fn capture_event(event: &BridgeComponentEvent, final_output: &mut Option<Value>) {
    match event {
        BridgeComponentEvent::RunCompleted { output } => *final_output = Some(output.clone()),
        BridgeComponentEvent::RunFailed { error } => *final_output = Some(error.clone()),
        BridgeComponentEvent::RunCancelled { reason } => *final_output = Some(reason.clone()),
        _ => {}
    }
}

fn stderr_limit_error() -> CoreError {
    CoreError::Process(format!(
        "Bridge Component daemon stderr exceeds the {} byte lifetime limit",
        MAX_DAEMON_STDERR_BYTES
    ))
}

fn stdout_frame_limit_error() -> CoreError {
    CoreError::Process(format!(
        "Bridge Component daemon stdout frame exceeds the {} byte limit",
        MAX_STDOUT_FRAME_BYTES
    ))
}

fn build_daemon_key(
    bridge_id: &str,
    app_dir: &Path,
    entry: &Path,
    runtime_context_fingerprint: &str,
) -> CoreResult<DaemonKey> {
    let canonical_app_dir = std::fs::canonicalize(app_dir).map_err(|error| {
        CoreError::Process(format!(
            "Failed to canonicalize Bridge Component package directory '{}': {error}",
            app_dir.display()
        ))
    })?;
    let canonical_entry = std::fs::canonicalize(entry).map_err(|error| {
        CoreError::Process(format!(
            "Failed to canonicalize Bridge Component runtime entry '{}': {error}",
            entry.display()
        ))
    })?;
    if !canonical_entry.starts_with(&canonical_app_dir) {
        return Err(CoreError::validation(format!(
            "Bridge Component runtime entry '{}' resolves outside package directory '{}'",
            entry.display(),
            app_dir.display()
        )));
    }
    let runtime_fingerprint = fingerprint_runtime_package(
        &canonical_app_dir,
        &canonical_entry,
        runtime_context_fingerprint,
    )?;
    Ok(DaemonKey {
        bridge_id: bridge_id.to_string(),
        canonical_app_dir,
        canonical_entry,
        runtime_fingerprint,
    })
}

fn fingerprint_runtime_package(
    app_dir: &Path,
    entry: &Path,
    runtime_context_fingerprint: &str,
) -> CoreResult<String> {
    let mut files = Vec::new();
    collect_runtime_files(app_dir, app_dir, &mut files)?;
    files.sort_by(|left, right| left.0.cmp(&right.0));
    if files.len() > MAX_FINGERPRINT_FILES {
        return Err(CoreError::validation(format!(
            "Bridge Component runtime package contains more than {MAX_FINGERPRINT_FILES} files"
        )));
    }

    let mut hasher = Sha256::new();
    hasher.update(b"sparo-bridge-daemon-runtime-v1\0");
    hasher.update(entry.to_string_lossy().as_bytes());
    hasher.update(b"\0");
    hasher.update(runtime_context_fingerprint.as_bytes());
    hasher.update(b"\0");
    let mut total_bytes = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    for (relative, path) in files {
        let metadata = std::fs::metadata(&path)?;
        total_bytes = total_bytes.saturating_add(metadata.len());
        if total_bytes > MAX_FINGERPRINT_BYTES {
            return Err(CoreError::validation(format!(
                "Bridge Component runtime package exceeds the {} byte fingerprint limit",
                MAX_FINGERPRINT_BYTES
            )));
        }
        hasher.update(relative.as_bytes());
        hasher.update(b"\0");
        let mut file = std::fs::File::open(&path)?;
        loop {
            let read = std::io::Read::read(&mut file, &mut buffer)?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        hasher.update(b"\0");
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Fingerprint environment values without retaining or logging their plaintext.
/// Callers should include every explicitly injected value and any inherited
/// variables that affect runtime/interpreter resolution.
pub fn fingerprint_runtime_environment(values: &[(String, OsString)]) -> String {
    let mut values = values
        .iter()
        .map(|(name, value)| (name.as_str(), value.as_os_str().as_encoded_bytes()))
        .collect::<Vec<_>>();
    values.sort_by(|left, right| left.0.cmp(right.0));
    let mut hasher = Sha256::new();
    hasher.update(b"sparo-bridge-daemon-env-v1\0");
    for (name, value) in values {
        hasher.update(name.len().to_le_bytes());
        hasher.update(name.as_bytes());
        hasher.update(value.len().to_le_bytes());
        hasher.update(value);
    }
    hex::encode(hasher.finalize())
}

fn collect_runtime_files(
    root: &Path,
    directory: &Path,
    files: &mut Vec<(String, PathBuf)>,
) -> CoreResult<()> {
    let mut entries = std::fs::read_dir(directory)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            let name = entry.file_name();
            if matches!(name.to_str(), Some(".git" | "node_modules" | ".cache")) {
                continue;
            }
            collect_runtime_files(root, &path, files)?;
        } else if file_type.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|error| CoreError::Process(error.to_string()))?
                .to_string_lossy()
                .replace('\\', "/");
            files.push((relative, path));
            if files.len() > MAX_FINGERPRINT_FILES {
                return Err(CoreError::validation(format!(
                    "Bridge Component runtime package contains more than {MAX_FINGERPRINT_FILES} files"
                )));
            }
        }
    }
    Ok(())
}

pub type SharedBridgeDaemonPool = Arc<BridgeDaemonPool>;

pub fn shared_daemon_pool() -> SharedBridgeDaemonPool {
    static POOL: OnceLock<SharedBridgeDaemonPool> = OnceLock::new();
    let pool = POOL
        .get_or_init(|| Arc::new(BridgeDaemonPool::new()))
        .clone();
    pool.start_idle_reaper();
    pool
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn daemon_key_separates_packages_and_tracks_content_changes() {
        let root = std::env::temp_dir().join(format!("sparo-daemon-key-{}", uuid::Uuid::new_v4()));
        let first = root.join("first");
        let second = root.join("second");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        for directory in [&first, &second] {
            std::fs::write(directory.join("manifest.json"), b"{\"kind\":\"daemon\"}").unwrap();
            std::fs::write(directory.join("worker.js"), b"console.log('one')").unwrap();
        }

        let first_key =
            build_daemon_key("same-id", &first, &first.join("worker.js"), "env-a").unwrap();
        let second_key =
            build_daemon_key("same-id", &second, &second.join("worker.js"), "env-a").unwrap();
        assert_ne!(first_key, second_key);

        std::fs::write(first.join("worker.js"), b"console.log('two')").unwrap();
        let changed_key =
            build_daemon_key("same-id", &first, &first.join("worker.js"), "env-a").unwrap();
        assert_ne!(
            first_key.runtime_fingerprint,
            changed_key.runtime_fingerprint
        );
        assert!(first_key.same_runtime_location(&changed_key));

        let changed_env_key =
            build_daemon_key("same-id", &first, &first.join("worker.js"), "env-b").unwrap();
        assert_ne!(
            changed_key.runtime_fingerprint,
            changed_env_key.runtime_fingerprint
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn response_envelope_requires_bridge_and_run_correlation() {
        let valid = serde_json::to_vec(&json!({
            "bridgeId": "bridge-a",
            "runId": "run-a",
            "event": { "type": "run.completed", "output": { "ok": true } }
        }))
        .unwrap();
        assert!(decode_correlated_envelope(&valid, "bridge-a", "run-a").is_ok());
        assert!(decode_correlated_envelope(&valid, "bridge-b", "run-a").is_err());
        assert!(decode_correlated_envelope(&valid, "bridge-a", "run-b").is_err());

        let bare_event = serde_json::to_vec(&json!({
            "type": "run.completed",
            "output": { "ok": true }
        }))
        .unwrap();
        assert!(decode_correlated_envelope(&bare_event, "bridge-a", "run-a").is_err());
    }

    #[test]
    fn cancelled_event_stays_cancelled() {
        assert_eq!(
            terminal_status(&BridgeComponentEvent::RunCancelled {
                reason: json!({ "message": "cancelled" }),
            }),
            Some(BridgeComponentRunStatus::Cancelled)
        );
    }

    #[test]
    fn daemon_idle_timeout_can_be_disabled_explicitly() {
        assert_eq!(resolve_idle_timeout(None), Some(Duration::from_secs(300)));
        assert_eq!(
            resolve_idle_timeout(Some(1_250)),
            Some(Duration::from_millis(1_250))
        );
        assert_eq!(resolve_idle_timeout(Some(0)), None);
    }
}
