const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { previewServerStatePath, previewServerLogPath, previewServerLauncherPath, previewServerLauncherConfigPath, normalizeWorkspace, workspacePathOf } = require("./paths");
const { readJson, writeJson, isProcessAlive, httpStatus, tailPreviewLogs, tailFile, psQuote, findFreePort, waitForHttp, clampNumber, terminateProcessTree } = require("./util");
const { remotionCommand } = require("./remotion-cli");
const { detectProject } = require("./project");
const { PREVIEW_SERVER_STALE_MS, PREVIEW_SERVER_BOOT_WAIT_MS } = require("./constants");

function readPreviewServerState(workspacePath) {
  return readJson(previewServerStatePath(workspacePath), null);
}

function writePreviewServerState(workspacePath, state) {
  writeJson(previewServerStatePath(workspacePath), state);
}

function ensurePreviewServerLauncher(workspacePath) {
  const launcherPath = previewServerLauncherPath(workspacePath);
  fs.mkdirSync(path.dirname(launcherPath), { recursive: true });
  fs.writeFileSync(launcherPath, `#!/usr/bin/env node
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const configPath = process.argv[2];
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
fs.mkdirSync(require("node:path").dirname(config.logPath), { recursive: true });
fs.appendFileSync(config.logPath, "\\n[" + new Date().toISOString() + "] Launcher started\\n", "utf8");

const outFd = fs.openSync(config.logPath, "a");
const errFd = fs.openSync(config.logPath, "a");
const child = spawn(config.command, config.args, {
  cwd: config.cwd,
  shell: Boolean(config.shell),
  detached: true,
  windowsHide: true,
  stdio: ["ignore", outFd, errFd],
  env: { ...process.env, ...(config.env || {}) },
});
child.unref();

try {
  const state = JSON.parse(fs.readFileSync(config.statePath, "utf8"));
  fs.writeFileSync(config.statePath, JSON.stringify({
    ...state,
    pid: child.pid,
    serverPid: child.pid,
    launcherPid: process.pid,
  }, null, 2) + "\\n", "utf8");
} catch {}
process.exit(0);
`, "utf8");
  return launcherPath;
}

async function previewServerStatusForState(workspacePath, state) {
  if (!state?.url || !state?.pid) {
    return {
      ok: true,
      status: "stopped",
      ready: false,
      url: null,
      log: "",
    };
  }

  const pid = state.serverPid || state.pid;
  const alive = isProcessAlive(pid);
  const health = alive ? await httpStatus(state.url) : { reachable: false, error: "Process is not running." };
  const ready = Boolean(alive && health.reachable);
  return {
    ok: true,
    status: ready ? "ready" : alive ? "starting" : "stopped",
    ready,
    alive,
    url: state.url,
    pid,
    serverPid: state.serverPid,
    launcherPid: state.launcherPid,
    port: state.port,
    workspacePath,
    command: state.command,
    args: state.args,
    startedAt: state.startedAt,
    logPath: state.logPath,
    log: tailPreviewLogs(state),
    health,
  };
}

function spawnPreviewServer(workspacePath, detection, port) {
  const command = remotionCommand(workspacePath);
  const logPath = previewServerLogPath(workspacePath);
  const stdoutLogPath = logPath.replace(/\.log$/i, ".stdout.log");
  const stderrLogPath = logPath.replace(/\.log$/i, ".stderr.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(
    logPath,
    `\n\n[${new Date().toISOString()}] Starting Remotion Studio on 127.0.0.1:${port}\n`,
    "utf8",
  );

  const args = [
    ...command.argsPrefix,
    "studio",
    detection.entryPoint,
    "--no-open",
    "--ipv4",
    "--disable-ask-ai",
    "--port",
    String(port),
  ];
  const statePath = previewServerStatePath(workspacePath);
  const baseState = {
    ok: true,
    status: "starting",
    ready: false,
    url: `http://127.0.0.1:${port}`,
    port,
    pid: null,
    command: command.command,
    args,
    commandSource: command.source,
    startedAt: Date.now(),
    workspacePath,
    logPath,
    stdoutLogPath,
    stderrLogPath,
  };
  writeJson(statePath, baseState);

  if (process.platform === "win32") {
    const psArgs = args.map(psQuote).join(", ");
    const psScript = [
      "$env:BROWSER='none'",
      "$env:NO_COLOR='1'",
      "$env:FORCE_COLOR='0'",
      `$p = Start-Process -FilePath ${psQuote(command.command)} -ArgumentList @(${psArgs}) -WorkingDirectory ${psQuote(workspacePath)} -WindowStyle Hidden -PassThru`,
      "$p.Id",
    ].join("; ");
    const launch = spawnSync("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      psScript,
    ], {
      cwd: workspacePath,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    if (launch.error || launch.status !== 0) {
      const detail = String(launch.stderr || launch.stdout || launch.error?.message || `exit ${launch.status}`).trim();
      throw new Error(`Failed to start Remotion Studio: ${detail}`);
    }
    const pid = Number(String(launch.stdout || "").match(/\d+/)?.[0]);
    if (!Number.isInteger(pid)) {
      const detail = String(launch.stderr || launch.stdout || "Start-Process did not return a PID.").trim();
      throw new Error(`Failed to start Remotion Studio: ${detail}`);
    }
    const state = {
      ...baseState,
      pid,
      serverPid: pid,
      launcher: "powershell-start-process",
    };
    writeJson(statePath, state);
    return state;
  }

  const launcherPath = ensurePreviewServerLauncher(workspacePath);
  const launcherConfigPath = previewServerLauncherConfigPath(workspacePath, port);

  writeJson(launcherConfigPath, {
    command: command.command,
    args,
    cwd: workspacePath,
    shell: Boolean(command.shell),
    logPath,
    statePath,
    env: {
      BROWSER: "none",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
  });

  const launch = spawnSync(process.execPath, [launcherPath, launcherConfigPath], {
    cwd: workspacePath,
    windowsHide: true,
    stdio: "ignore",
    timeout: 5000,
  });
  if (launch.error || launch.status !== 0) {
    throw new Error(`Failed to launch Remotion Studio helper: ${launch.error?.message || `exit ${launch.status}`}`);
  }

  return readJson(statePath, baseState) || baseState;
}

async function ensurePreviewServer(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const detection = detectProject(input);
  if (!detection.entryPoint) {
    throw new Error("Cannot start Remotion Studio because no Remotion entry point was detected.");
  }

  const existing = readPreviewServerState(workspacePath);
  const existingStatus = await previewServerStatusForState(workspacePath, existing);
  const force = input.force === true;
  const stale = existing?.startedAt && Date.now() - Number(existing.startedAt) > PREVIEW_SERVER_STALE_MS;

  if (!force && existingStatus.ready) {
    return {
      ...existingStatus,
      reused: true,
      renderer: "remotion-studio",
      diagnostics: detection.diagnostics || [],
    };
  }

  if (!force && existingStatus.alive && !stale) {
    return {
      ...existingStatus,
      reused: true,
      renderer: "remotion-studio",
      diagnostics: detection.diagnostics || [],
    };
  }

  const requestedPort = Number(input.port);
  const port = Number.isInteger(requestedPort) && requestedPort >= 1024 && requestedPort <= 65535
    ? requestedPort
    : await findFreePort();
  const state = spawnPreviewServer(workspacePath, detection, port);
  writePreviewServerState(workspacePath, state);

  const waitMs = clampNumber(input.waitMs, 0, 60_000, PREVIEW_SERVER_BOOT_WAIT_MS);
  const health = waitMs > 0
    ? await waitForHttp(state.url, waitMs)
    : { reachable: false, error: "Not waited." };
  const ready = Boolean(health.reachable);
  const nextState = {
    ...state,
    ready,
    status: ready ? "ready" : "starting",
    health,
  };
  writePreviewServerState(workspacePath, nextState);

  return {
    ...nextState,
    renderer: "remotion-studio",
    reused: false,
    log: tailFile(state.logPath),
    diagnostics: detection.diagnostics || [],
  };
}

async function getPreviewServerStatus(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const state = readPreviewServerState(workspacePath);
  const status = await previewServerStatusForState(workspacePath, state);
  if (state && status.status !== state.status) {
    writePreviewServerState(workspacePath, { ...state, status: status.status, ready: status.ready });
  }
  return {
    ...status,
    renderer: "remotion-studio",
  };
}

async function stopPreviewServer(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const state = readPreviewServerState(workspacePath);
  const pid = state?.serverPid || state?.pid;
  if (pid) {
    terminateProcessTree(pid);
  }
  const nextState = {
    ...(state || {}),
    ok: true,
    status: "stopped",
    ready: false,
    stoppedAt: Date.now(),
  };
  writePreviewServerState(workspacePath, nextState);
  return {
    ok: true,
    status: "stopped",
    ready: false,
    url: state?.url || null,
    pid: pid || null,
    logPath: state?.logPath || null,
    log: tailPreviewLogs(state),
  };
}

module.exports = {
  readPreviewServerState,
  writePreviewServerState,
  ensurePreviewServerLauncher,
  previewServerStatusForState,
  spawnPreviewServer,
  ensurePreviewServer,
  getPreviewServerStatus,
  stopPreviewServer,
};
