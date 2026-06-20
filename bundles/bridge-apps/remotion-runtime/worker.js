const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");

const IGNORED_DIRS = new Set([".git", "node_modules", "out", "dist", "build", ".next", ".sparo_os", "coverage"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const PREVIEW_CACHE_LIMIT = 160;
const PREVIEW_VIDEO_CACHE_LIMIT = 24;
const DEFAULT_PREVIEW_SCALE = 1;
const DEFAULT_PREVIEW_VIDEO_SCALE = 0.5;
const DEFAULT_PREVIEW_CLIP_SECONDS = 3;
const DEFAULT_STILL_SCALE = 1;
const REMOTION_RENDER_TIMEOUT_MS = 240_000;
const REMOTION_EXPORT_TIMEOUT_MS = 600_000;
const PREVIEW_SERVER_BOOT_WAIT_MS = 0;
const PREVIEW_SERVER_STALE_MS = 120_000;
const PLAYER_HOST_BOOT_WAIT_MS = 45_000;
const PLAYER_HOST_STALE_MS = 10 * 60_000;
const PLAYER_HOST_RUNTIME_VERSION = 4;
const ASSET_EXTENSIONS = new Map([
  [".png", "image"],
  [".jpg", "image"],
  [".jpeg", "image"],
  [".webp", "image"],
  [".gif", "image"],
  [".svg", "image"],
  [".mp4", "video"],
  [".mov", "video"],
  [".webm", "video"],
  [".m4v", "video"],
  [".mp3", "audio"],
  [".wav", "audio"],
  [".m4a", "audio"],
  [".ogg", "audio"],
  [".aac", "audio"],
  [".ttf", "font"],
  [".otf", "font"],
  [".woff", "font"],
  [".woff2", "font"],
  [".srt", "caption"],
  [".vtt", "caption"],
  [".json", "data"],
]);

function emit(event) {
  const line = `${JSON.stringify(event)}\n`;
  try {
    fs.writeSync(1, line);
  } catch {
    process.stdout.write(line);
  }
}

function emitStatus(message, status = "running") {
  emit({ type: "run.status", status, message });
}

function readRequest() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(input.trim() || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    process.stdin.on("error", reject);
  });
}

function workspacePathOf(requestOrInput) {
  const input = requestOrInput?.input || requestOrInput || {};
  return String(
    input.workspacePath ||
    input.workspace_path ||
    requestOrInput?.workspacePath ||
    requestOrInput?.workspace_path ||
    "",
  ).trim();
}

function normalizeWorkspace(workspacePath) {
  if (!workspacePath) throw new Error("workspacePath is required.");
  const resolved = path.resolve(workspacePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Workspace does not exist or is not a directory: ${resolved}`);
  }
  return resolved;
}

function relativeToWorkspace(workspacePath, absolutePath) {
  return path.relative(workspacePath, absolutePath).replace(/\\/g, "/");
}

function ensureRuntimeDir(workspacePath, child = "") {
  const dir = path.join(workspacePath, ".sparo_os", "remotion-live", child);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function previewServerStatePath(workspacePath) {
  return path.join(ensureRuntimeDir(workspacePath), "preview-server.json");
}

function previewServerLogPath(workspacePath) {
  return path.join(ensureRuntimeDir(workspacePath, "logs"), "preview-server.log");
}

function previewServerLauncherPath(workspacePath) {
  return path.join(ensureRuntimeDir(workspacePath, "bin"), "preview-server-launcher.js");
}

function previewServerLauncherConfigPath(workspacePath, port) {
  return path.join(ensureRuntimeDir(workspacePath, "bin"), `preview-server-${port}.json`);
}

function playerHostStatePath(workspacePath) {
  return path.join(ensureRuntimeDir(workspacePath), "player-host.json");
}

function playerHostRootDir(workspacePath) {
  return ensureRuntimeDir(workspacePath, "player-host");
}

function playerHostSourceDir(workspacePath) {
  return path.join(playerHostRootDir(workspacePath), "src");
}

function playerHostDistDir(workspacePath) {
  return path.join(playerHostRootDir(workspacePath), "dist");
}

function playerHostLogPath(workspacePath) {
  return path.join(ensureRuntimeDir(workspacePath, "logs"), "player-host.log");
}

function playerHostServerPath(workspacePath) {
  return path.join(ensureRuntimeDir(workspacePath, "bin"), "player-host-server.js");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tailFile(filePath, maxBytes = 6000) {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    fs.closeSync(fd);
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

function tailPreviewLogs(state) {
  return [
    tailFile(state?.logPath),
    tailFile(state?.stdoutLogPath),
    tailFile(state?.stderrLogPath),
  ].filter(Boolean).join("\n");
}

function tailPlayerHostLogs(state) {
  return [
    tailFile(state?.logPath),
    tailFile(state?.stderrLogPath),
  ].filter(Boolean).join("\n");
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function jsString(value) {
  return JSON.stringify(String(value).replace(/\\/g, "/"));
}

function relativeImport(fromDir, toFile) {
  let specifier = path.relative(fromDir, toFile).replace(/\\/g, "/");
  if (!specifier.startsWith(".")) specifier = `./${specifier}`;
  return specifier;
}

function sideEffectImportsForSource(entryDir, sourcePath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return "";
  const source = readText(sourcePath);
  const imports = [];
  const sideEffectImportPattern = /(^|\n)\s*import\s+["']([^"']+)["']\s*;?/g;
  for (const match of source.matchAll(sideEffectImportPattern)) {
    const specifier = match[2];
    if (!specifier) continue;
    const resolvedSpecifier = specifier.startsWith(".")
      ? relativeImport(entryDir, path.resolve(path.dirname(sourcePath), specifier))
      : specifier;
    imports.push(`import ${jsString(resolvedSpecifier)};`);
  }
  return imports.join("\n");
}

function isProcessAlive(pid) {
  const normalized = Number(pid);
  if (!Number.isInteger(normalized) || normalized <= 0) return false;
  try {
    process.kill(normalized, 0);
    return true;
  } catch {
    return false;
  }
}

function terminateProcessTree(pid) {
  const normalized = Number(pid);
  if (!Number.isInteger(normalized) || normalized <= 0) return;
  try {
    if (process.platform === "win32") {
      const killed = spawnSync("taskkill", ["/PID", String(normalized), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      if (killed.status !== 0) {
        spawnSync("powershell", [
          "-NoProfile",
          "-Command",
          `Stop-Process -Id ${normalized} -Force -ErrorAction SilentlyContinue`,
        ], {
          windowsHide: true,
          stdio: "ignore",
        });
      }
      return;
    }
    try {
      process.kill(-normalized, "SIGTERM");
    } catch {
      process.kill(normalized, "SIGTERM");
    }
  } catch {
    // Best-effort cleanup; status polling will surface if the process stays alive.
  }
}

function findFreePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("Could not allocate a preview server port."));
      });
    });
  });
}

async function httpStatus(url, timeoutMs = 1200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
    });
    return { reachable: true, statusCode: response.status };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHttp(url, timeoutMs) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await httpStatus(url, 1500);
    if (last.reachable) return last;
    await sleep(500);
  }
  return last || { reachable: false, error: "Timed out waiting for preview server." };
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function walkFiles(root, options = {}) {
  const maxFiles = options.maxFiles || 5000;
  const files = [];
  const stack = [root];
  while (stack.length && files.length < maxFiles) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) stack.push(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
        if (files.length >= maxFiles) break;
      }
    }
  }
  return files;
}

function sourceFiles(workspacePath) {
  return walkFiles(workspacePath)
    .filter((filePath) => SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .filter((filePath) => (safeStat(filePath)?.size || 0) < 750_000);
}

function packageManager(workspacePath) {
  if (fs.existsSync(path.join(workspacePath, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(workspacePath, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(workspacePath, "bun.lockb"))) return "bun";
  if (fs.existsSync(path.join(workspacePath, "package-lock.json"))) return "npm";
  return "npm";
}

function packageInfo(workspacePath) {
  return readJson(path.join(workspacePath, "package.json"), {}) || {};
}

function dependencyVersion(pkg, name) {
  return (
    pkg.dependencies?.[name] ||
    pkg.devDependencies?.[name] ||
    pkg.peerDependencies?.[name] ||
    ""
  );
}

function hashContent(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 12);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function remotionCommand(workspacePath) {
  const localCli = path.join(workspacePath, "node_modules", "@remotion", "cli", "remotion-cli.js");
  if (fs.existsSync(localCli)) {
    return {
      command: process.execPath,
      argsPrefix: [localCli],
      source: "local-cli-js",
      shell: false,
    };
  }

  const localName = process.platform === "win32" ? "remotion.cmd" : "remotion";
  const localBinary = path.join(workspacePath, "node_modules", ".bin", localName);
  if (fs.existsSync(localBinary)) {
    return {
      command: localBinary,
      argsPrefix: [],
      source: "local-bin",
      shell: process.platform === "win32",
    };
  }

  const manager = packageManager(workspacePath);
  if (manager === "pnpm") return { command: "pnpm", argsPrefix: ["exec", "remotion"], source: "pnpm" };
  if (manager === "yarn") return { command: "yarn", argsPrefix: ["remotion"], source: "yarn" };
  if (manager === "bun") return { command: "bunx", argsPrefix: ["remotion"], source: "bunx" };
  return { command: "npx", argsPrefix: ["remotion"], source: "npx" };
}

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

function resolveWorkspaceModule(workspacePath, request) {
  return require.resolve(request, { paths: [workspacePath] });
}

function playerHostBundleId(manifest, composition) {
  return hashContent(JSON.stringify({
    runtimeVersion: PLAYER_HOST_RUNTIME_VERSION,
    buildId: manifest.buildId,
    compositionId: composition.id,
    componentPath: composition.componentPath,
    componentName: composition.componentName,
    defaultProps: composition.defaultProps || {},
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
    durationInFrames: composition.durationInFrames,
  }));
}

function writePlayerHostEntry(workspacePath, manifest, composition, bundleId) {
  const sourceDir = playerHostSourceDir(workspacePath);
  fs.mkdirSync(sourceDir, { recursive: true });
  const entryPath = path.join(sourceDir, `entry-${safeFilePart(composition.id)}-${bundleId}.tsx`);
  const entryDir = path.dirname(entryPath);
  const sourcePath = composition.sourcePath ? path.join(workspacePath, composition.sourcePath) : null;
  const componentPath = composition.componentPath ? path.join(workspacePath, composition.componentPath) : null;
  if (!componentPath || !fs.existsSync(componentPath)) {
    throw new Error(`Cannot build Player preview because component source was not found: ${composition.componentPath || "(missing)"}`);
  }
  const sourceImport = sideEffectImportsForSource(entryDir, sourcePath);
  const componentImport = relativeImport(entryDir, componentPath);
  const componentName = composition.componentName || "default";
  const defaultProps = JSON.stringify(composition.defaultProps || {});
  const code = `
import * as React from "react";
import {useCallback, useEffect, useMemo, useRef} from "react";
import {createRoot} from "react-dom/client";
import {Player, type PlayerRef} from "@remotion/player";
${sourceImport}
import * as ComponentModule from ${jsString(componentImport)};

const composition = ${JSON.stringify({
    id: composition.id,
    durationInFrames: composition.durationInFrames,
    fps: composition.fps,
    width: composition.width,
    height: composition.height,
  })};
const defaultProps = ${defaultProps};
const componentName = ${JSON.stringify(componentName)};
const Component = (ComponentModule as Record<string, React.ComponentType<any>>)[componentName] || (ComponentModule as any).default;
const runtimeVersion = ${PLAYER_HOST_RUNTIME_VERSION};

function clampFrame(value: unknown) {
  const frame = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(composition.durationInFrames - 1, frame));
}

function post(type: string, payload: Record<string, unknown> = {}) {
  window.parent?.postMessage({
    source: "sparo-remotion-player-host",
    runtimeVersion,
    type,
    compositionId: composition.id,
    ...payload,
  }, "*");
}

function App() {
  const playerRef = useRef<PlayerRef>(null);
  const cleanupRef = useRef<null | (() => void)>(null);
  const readyPostedRef = useRef(false);
  const pendingCommandsRef = useRef<Array<Record<string, unknown>>>([]);
  const initialFrame = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return clampFrame(params.get("frame"));
  }, []);
  const shouldAutoplay = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("autoplay") === "1";
  }, []);

  const seekTo = useCallback((frame: unknown) => {
    const next = clampFrame(frame);
    playerRef.current?.seekTo(next);
    post("frame", {frame: next});
  }, []);

  const play = useCallback((frame?: unknown) => {
    if (frame !== undefined && frame !== null) {
      seekTo(frame);
    }
    const player = playerRef.current;
    const result = player?.play();
    if (player) {
      post("play", {frame: clampFrame(player.getCurrentFrame())});
    }
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch((error) => {
        post("error", {message: error instanceof Error ? error.message : String(error)});
      });
    }
  }, [seekTo]);

  const pause = useCallback(() => {
    const player = playerRef.current;
    player?.pause();
    if (player) {
      post("pause", {frame: clampFrame(player.getCurrentFrame())});
    }
  }, []);

  const runCommand = useCallback((message: Record<string, unknown>) => {
    if (message.type === "seek") seekTo(message.frame);
    if (message.type === "play") play(message.frame);
    if (message.type === "pause") pause();
    if (message.type === "toggle") playerRef.current?.toggle();
    post("command", {command: message.type, frame: clampFrame(playerRef.current?.getCurrentFrame?.() ?? initialFrame)});
  }, [pause, play, seekTo]);

  const ensurePlayerReady = useCallback(() => {
    const player = playerRef.current;
    if (!player) return false;

    if (!cleanupRef.current) {
    const onFrame = (event: Event) => {
      const detailFrame = (event as CustomEvent<{frame?: number}>).detail?.frame;
      const frame = detailFrame ?? player.getCurrentFrame();
      post("frame", {frame: clampFrame(frame)});
    };
    const onPlay = () => post("play", {frame: clampFrame(player.getCurrentFrame())});
    const onPause = () => post("pause", {frame: clampFrame(player.getCurrentFrame())});
    const onEnded = () => post("ended", {frame: composition.durationInFrames - 1});
    const onError = (event: Event) => {
      const error = (event as CustomEvent<{error?: Error}>).detail?.error;
      post("error", {message: error instanceof Error ? error.message : String(error || "Player error")});
    };
    player.addEventListener("timeupdate", onFrame as any);
    player.addEventListener("frameupdate", onFrame as any);
    player.addEventListener("seeked", onFrame as any);
    player.addEventListener("play", onPlay as any);
    player.addEventListener("pause", onPause as any);
    player.addEventListener("ended", onEnded as any);
    player.addEventListener("error", onError as any);
      cleanupRef.current = () => {
      player.removeEventListener("timeupdate", onFrame as any);
      player.removeEventListener("frameupdate", onFrame as any);
      player.removeEventListener("seeked", onFrame as any);
      player.removeEventListener("play", onPlay as any);
      player.removeEventListener("pause", onPause as any);
      player.removeEventListener("ended", onEnded as any);
      player.removeEventListener("error", onError as any);
    };
    }

    const frame = clampFrame(player.getCurrentFrame?.() ?? initialFrame);
    if (!readyPostedRef.current) {
      readyPostedRef.current = true;
      post("ready", {
        frame,
        durationInFrames: composition.durationInFrames,
        fps: composition.fps,
        width: composition.width,
        height: composition.height,
      });
      if (shouldAutoplay) {
        window.setTimeout(() => play(frame), 0);
      }
    } else {
      post("ready", {
        frame,
        durationInFrames: composition.durationInFrames,
        fps: composition.fps,
        width: composition.width,
        height: composition.height,
      });
    }

    const pending = pendingCommandsRef.current.splice(0);
    pending.forEach(runCommand);
    return true;
  }, [initialFrame, play, runCommand, shouldAutoplay]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data || {};
      if (message.source !== "sparo-remotion-live") return;
      if (message.compositionId && message.compositionId !== composition.id) return;
      if (message.type === "ping") {
        ensurePlayerReady();
        return;
      }
      if (!ensurePlayerReady()) {
        pendingCommandsRef.current.push(message);
        return;
      }
      runCommand(message);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [ensurePlayerReady, runCommand]);

  useEffect(() => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (ensurePlayerReady()) {
        window.clearInterval(timer);
      } else if (attempts > 200) {
        window.clearInterval(timer);
        post("error", {message: "Timed out waiting for Remotion Player to mount."});
      }
    }, 25);
    return () => {
      window.clearInterval(timer);
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [ensurePlayerReady]);

  if (!Component) {
    post("error", {message: "Composition component could not be resolved."});
    return <div className="rl-player-error">Composition component could not be resolved.</div>;
  }

  return (
    <Player
      ref={playerRef}
      component={Component}
      durationInFrames={composition.durationInFrames}
      fps={composition.fps}
      compositionWidth={composition.width}
      compositionHeight={composition.height}
      inputProps={defaultProps}
      initialFrame={initialFrame}
      controls={false}
      clickToPlay={false}
      initiallyMuted={true}
      moveToBeginningWhenEnded={false}
      style={{width: "100%", height: "100%"}}
      renderLoading={() => <div className="rl-player-loading">Loading preview...</div>}
      errorFallback={({error}) => <div className="rl-player-error">{error.message}</div>}
    />
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
`;
  fs.writeFileSync(entryPath, code, "utf8");
  return entryPath;
}

async function runWebpackBuild(webpack, config) {
  await new Promise((resolve, reject) => {
    const compiler = webpack(config);
    compiler.run((error, stats) => {
      compiler.close(() => {});
      if (error) {
        reject(error);
        return;
      }
      if (stats?.hasErrors()) {
        reject(new Error(stats.toString({ all: false, errors: true, errorDetails: true })));
        return;
      }
      resolve();
    });
  });
}

async function bundlePlayerHost(workspacePath, manifest, composition, bundleId) {
  const distDir = playerHostDistDir(workspacePath);
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  const entryPath = writePlayerHostEntry(workspacePath, manifest, composition, bundleId);
  const webpack = require(resolveWorkspaceModule(workspacePath, "webpack"));
  const esbuild = require(resolveWorkspaceModule(workspacePath, "esbuild"));
  const esbuildLoaderPath = path.join(
    workspacePath,
    "node_modules",
    "@remotion",
    "bundler",
    "dist",
    "esbuild-loader",
    "index.js",
  );
  const config = {
    mode: "development",
    target: "web",
    context: workspacePath,
    entry: entryPath,
    devtool: "source-map",
    output: {
      path: distDir,
      filename: "player-host.js",
      publicPath: "/",
      assetModuleFilename: "assets/[hash][ext][query]",
      clean: true,
    },
    resolve: {
      extensions: [".ts", ".tsx", ".web.js", ".js", ".jsx", ".mjs", ".cjs", ".json"],
      modules: [path.join(workspacePath, "node_modules"), "node_modules"],
      alias: {
        "react/jsx-runtime": resolveWorkspaceModule(workspacePath, "react/jsx-runtime"),
        "react/jsx-dev-runtime": resolveWorkspaceModule(workspacePath, "react/jsx-dev-runtime"),
        "react-dom/client": resolveWorkspaceModule(workspacePath, "react-dom/client"),
        "react-dom": resolveWorkspaceModule(workspacePath, "react-dom"),
        react: resolveWorkspaceModule(workspacePath, "react"),
        "@remotion/player": resolveWorkspaceModule(workspacePath, "@remotion/player"),
        "remotion/no-react": path.resolve(resolveWorkspaceModule(workspacePath, "remotion"), "..", "..", "esm", "no-react.mjs"),
        "remotion/version": path.resolve(resolveWorkspaceModule(workspacePath, "remotion"), "..", "..", "esm", "version.mjs"),
        remotion: path.resolve(resolveWorkspaceModule(workspacePath, "remotion"), "..", "..", "esm", "index.mjs"),
      },
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: [{
            loader: esbuildLoaderPath,
            options: {
              target: "chrome105",
              loader: "tsx",
              implementation: esbuild,
              remotionRoot: workspacePath,
            },
          }],
        },
        {
          test: /\.jsx?$/,
          exclude: /node_modules/,
          use: [{
            loader: esbuildLoaderPath,
            options: {
              target: "chrome105",
              loader: "jsx",
              implementation: esbuild,
              remotionRoot: workspacePath,
            },
          }],
        },
        {
          test: /\.css$/i,
          use: [
            resolveWorkspaceModule(workspacePath, "style-loader"),
            {
              loader: resolveWorkspaceModule(workspacePath, "css-loader"),
              options: { modules: { auto: true, namedExport: false } },
            },
          ],
          type: "javascript/auto",
        },
        {
          test: /\.(png|svg|jpg|jpeg|webp|gif|bmp|webm|mp4|mov|mp3|m4a|wav|aac|woff2?|otf|ttf|eot)$/i,
          type: "asset/resource",
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        "process.env.NODE_ENV": JSON.stringify("development"),
        "process.env.REMOTION_ENV": JSON.stringify("preview"),
      }),
    ],
    cache: {
      type: "filesystem",
      cacheDirectory: path.join(playerHostRootDir(workspacePath), "webpack-cache"),
    },
    optimization: { minimize: false },
  };
  await runWebpackBuild(webpack, config);
  fs.writeFileSync(path.join(distDir, "index.html"), `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      html, body, #root { margin: 0; width: 100%; height: 100%; background: #05070b; overflow: hidden; }
      .rl-player-loading, .rl-player-error { width: 100%; height: 100%; display: grid; place-items: center; color: rgba(255,255,255,.72); font: 13px system-ui, sans-serif; background: #05070b; }
      .rl-player-error { color: #ff9b9b; padding: 24px; box-sizing: border-box; text-align: center; }
    </style>
    <title>Remotion Player Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/player-host.js"></script>
  </body>
</html>
`, "utf8");
  return { distDir, entryPath };
}

function ensurePlayerHostServerScript(workspacePath) {
  const serverPath = playerHostServerPath(workspacePath);
  fs.mkdirSync(path.dirname(serverPath), { recursive: true });
  fs.writeFileSync(serverPath, `#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3]);
const logPath = process.argv[4];
const publicRoot = path.resolve(process.argv[5] || path.join(process.cwd(), "public"));
fs.mkdirSync(path.dirname(logPath), {recursive: true});
function log(message) {
  fs.appendFileSync(logPath, "[" + new Date().toISOString() + "] " + message + "\\n", "utf8");
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf"
};
function isInside(candidate, base) {
  return candidate === base || candidate.startsWith(base + path.sep);
}
function resolveServedFile(requested) {
  const distPath = path.resolve(root, requested);
  if (isInside(distPath, root)) {
    try {
      const stat = fs.statSync(distPath);
      if (stat.isFile()) return {filePath: distPath, source: "dist"};
    } catch {}
  }
  const publicPath = path.resolve(publicRoot, requested);
  if (isInside(publicPath, publicRoot)) {
    try {
      const stat = fs.statSync(publicPath);
      if (stat.isFile()) return {filePath: publicPath, source: "public"};
    } catch {}
  }
  return null;
}
const server = http.createServer((request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/health") {
      response.writeHead(200, {"content-type": "application/json; charset=utf-8", "cache-control": "no-store"});
      response.end(JSON.stringify({ok: true}));
      return;
    }
    const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const served = resolveServedFile(requested);
    if (!served) throw new Error("Not a file");
    const {filePath, source} = served;
    response.writeHead(200, {
      "content-type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": source === "public" ? "no-cache" : "no-store",
      "cross-origin-opener-policy": "same-origin-allow-popups"
    });
    fs.createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(404, {"content-type": "text/plain; charset=utf-8"});
    response.end("Not found");
  }
});
server.listen(port, "127.0.0.1", () => log("Player host listening on 127.0.0.1:" + port));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
`, "utf8");
  return serverPath;
}

async function playerHostStatusForState(workspacePath, state) {
  if (!state?.url || !state?.pid) {
    return { ok: true, status: "stopped", ready: false, url: null, log: "" };
  }
  const pid = state.serverPid || state.pid;
  const alive = isProcessAlive(pid);
  const health = alive ? await httpStatus(`${state.url}/health`) : { reachable: false, error: "Process is not running." };
  const ready = Boolean(alive && health.reachable);
  return {
    ok: true,
    status: ready ? "ready" : alive ? "starting" : "stopped",
    ready,
    alive,
    url: state.url,
    pid,
    serverPid: state.serverPid,
    port: state.port,
    compositionId: state.compositionId,
    buildId: state.buildId,
    bundleId: state.bundleId,
    runtimeVersion: state.runtimeVersion,
    startedAt: state.startedAt,
    distDir: state.distDir,
    publicDir: state.publicDir,
    logPath: state.logPath,
    log: tailPlayerHostLogs(state),
    health,
  };
}

function readPlayerHostState(workspacePath) {
  return readJson(playerHostStatePath(workspacePath), null);
}

function writePlayerHostState(workspacePath, state) {
  writeJson(playerHostStatePath(workspacePath), state);
}

function spawnPlayerHostServer(workspacePath, distDir, port, stateBase) {
  const serverPath = ensurePlayerHostServerScript(workspacePath);
  const logPath = playerHostLogPath(workspacePath);
  const publicDir = path.join(workspacePath, "public");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] Starting Remotion Player host on 127.0.0.1:${port}\n`, "utf8");
  if (process.platform === "win32") {
    const psArgs = [serverPath, distDir, String(port), logPath, publicDir].map(psQuote).join(", ");
    const psScript = [
      `$p = Start-Process -FilePath ${psQuote(process.execPath)} -ArgumentList @(${psArgs}) -WorkingDirectory ${psQuote(workspacePath)} -WindowStyle Hidden -PassThru`,
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
      throw new Error(`Failed to start Remotion Player host: ${detail}`);
    }
    const pid = Number(String(launch.stdout || "").match(/\d+/)?.[0]);
    if (!Number.isInteger(pid)) {
      const detail = String(launch.stderr || launch.stdout || "Start-Process did not return a PID.").trim();
      throw new Error(`Failed to start Remotion Player host: ${detail}`);
    }
    return { ...stateBase, pid, serverPid: pid, launcher: "powershell-start-process", logPath, publicDir };
  }
  const child = spawn(process.execPath, [serverPath, distDir, String(port), logPath, publicDir], {
    cwd: workspacePath,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  return { ...stateBase, pid: child.pid, serverPid: child.pid, launcher: "node-detached", logPath, publicDir };
}

async function ensurePlayerPreviewHost(input = {}) {
  const { workspacePath, manifest, composition, frame } = compositionForInput(input);
  if (!composition.componentName || !composition.componentPath) {
    throw new Error("Cannot start Player preview because the composition component could not be resolved.");
  }

  const bundleId = playerHostBundleId(manifest, composition);
  const existing = readPlayerHostState(workspacePath);
  const existingStatus = await playerHostStatusForState(workspacePath, existing);
  const force = input.force === true;
  const stale = existing?.startedAt && Date.now() - Number(existing.startedAt) > PLAYER_HOST_STALE_MS;
  const sameRuntime = existing?.runtimeVersion === PLAYER_HOST_RUNTIME_VERSION;
  const sameBundle = sameRuntime && existing?.bundleId === bundleId && existing?.compositionId === composition.id && existing?.buildId === manifest.buildId;

  if (!force && sameBundle && existingStatus.ready && !stale) {
    return {
      ...existingStatus,
      renderer: "remotion-player",
      reused: true,
      frame,
      composition,
      url: `${existingStatus.url}?compositionId=${encodeURIComponent(composition.id)}&frame=${frame}`,
      baseUrl: existingStatus.url,
    };
  }

  if (existingStatus.alive) {
    terminateProcessTree(existingStatus.pid);
  }

  const { distDir, entryPath } = await bundlePlayerHost(workspacePath, manifest, composition, bundleId);
  const requestedPort = Number(input.port);
  const port = Number.isInteger(requestedPort) && requestedPort >= 1024 && requestedPort <= 65535
    ? requestedPort
    : await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const stateBase = {
    ok: true,
    status: "starting",
    ready: false,
    url: baseUrl,
    baseUrl,
    port,
    pid: null,
    serverPid: null,
    renderer: "remotion-player",
    compositionId: composition.id,
    buildId: manifest.buildId,
    bundleId,
    runtimeVersion: PLAYER_HOST_RUNTIME_VERSION,
    workspacePath,
    distDir,
    entryPath,
    startedAt: Date.now(),
  };
  const state = spawnPlayerHostServer(workspacePath, distDir, port, stateBase);
  writePlayerHostState(workspacePath, state);
  const waitMs = clampNumber(input.waitMs, 0, 120_000, PLAYER_HOST_BOOT_WAIT_MS);
  const health = waitMs > 0
    ? await waitForHttp(`${baseUrl}/health`, waitMs)
    : { reachable: false, error: "Not waited." };
  const ready = Boolean(health.reachable);
  const nextState = {
    ...state,
    ready,
    status: ready ? "ready" : "starting",
    health,
  };
  writePlayerHostState(workspacePath, nextState);
  return {
    ...nextState,
    renderer: "remotion-player",
    reused: false,
    frame,
    composition,
    url: `${baseUrl}?compositionId=${encodeURIComponent(composition.id)}&frame=${frame}`,
    baseUrl,
    log: tailPlayerHostLogs(nextState),
  };
}

async function getPlayerPreviewHostStatus(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const state = readPlayerHostState(workspacePath);
  const status = await playerHostStatusForState(workspacePath, state);
  if (state && status.status !== state.status) {
    writePlayerHostState(workspacePath, { ...state, status: status.status, ready: status.ready });
  }
  return {
    ...status,
    renderer: "remotion-player",
  };
}

async function stopPlayerPreviewHost(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const state = readPlayerHostState(workspacePath);
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
  writePlayerHostState(workspacePath, nextState);
  return {
    ok: true,
    status: "stopped",
    ready: false,
    url: state?.url || null,
    pid: pid || null,
    logPath: state?.logPath || null,
    log: tailPlayerHostLogs(state),
    renderer: "remotion-player",
  };
}

function detectRemotionRenderer(workspacePath) {
  const pkg = packageInfo(workspacePath);
  const command = remotionCommand(workspacePath);
  return {
    kind: "remotion-cli",
    available: Boolean(dependencyVersion(pkg, "remotion") || dependencyVersion(pkg, "@remotion/cli")),
    version: dependencyVersion(pkg, "remotion") || dependencyVersion(pkg, "@remotion/cli") || null,
    command: command.source,
  };
}

function remotionFailureMessage(command, args, result) {
  if (result.error) {
    return `Remotion command failed to start (${command.source}): ${result.error.message}`;
  }
  const stderr = String(result.stderr || "").trim();
  const stdout = String(result.stdout || "").trim();
  const tail = [stderr, stdout].filter(Boolean).join("\n").slice(-2200);
  return `Remotion command failed (${[command.command, ...command.argsPrefix, ...args].join(" ")}): ${tail || `exit ${result.status}`}`;
}

function runRemotion(workspacePath, args, options = {}) {
  const command = remotionCommand(workspacePath);
  const result = spawnSync(command.command, [...command.argsPrefix, ...args], {
    cwd: workspacePath,
    encoding: "utf8",
    timeout: options.timeoutMs || REMOTION_RENDER_TIMEOUT_MS,
    windowsHide: true,
    shell: Boolean(command.shell),
    env: {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
  });

  if (result.error || result.status !== 0) {
    throw new Error(remotionFailureMessage(command, args, result));
  }

  return {
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    command: command.source,
  };
}

function mimeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  return "image/png";
}

function fileDataUrl(filePath) {
  const data = fs.readFileSync(filePath);
  return `data:${mimeForPath(filePath)};base64,${data.toString("base64")}`;
}

function fileUri(filePath) {
  const resolved = path.resolve(filePath).replace(/\\/g, "/");
  return `file:///${resolved.replace(/^\/+/, "")}`;
}

function pruneDirectoryFiles(dir, maxFiles = PREVIEW_CACHE_LIMIT) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(dir, entry.name);
      return { filePath, mtimeMs: safeStat(filePath)?.mtimeMs || 0 };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const entry of entries.slice(maxFiles)) {
    try {
      fs.unlinkSync(entry.filePath);
    } catch {
      // Best-effort cache pruning only.
    }
  }
}

function resolveModule(fromFile, request) {
  if (!request || !request.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), request);
  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
    path.join(base, "index.jsx"),
    path.join(base, "index.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && safeStat(candidate)?.isFile()) || null;
}

function attrRaw(source, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{([^}]*)\\})`, "m");
  const match = pattern.exec(source);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

function attrExpression(source, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*`, "m");
  const match = pattern.exec(source);
  if (!match) return null;
  let index = match.index + match[0].length;
  while (/\s/.test(source[index] || "")) index += 1;
  const quote = source[index];
  if (quote === '"' || quote === "'" || quote === "`") {
    let cursor = index + 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\" && cursor + 1 < source.length) {
        cursor += 2;
        continue;
      }
      if (source[cursor] === quote) return source.slice(index, cursor + 1);
      cursor += 1;
    }
    return null;
  }
  if (source[index] !== "{") return null;
  let depth = 0;
  let cursor = index;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '"' || char === "'" || char === "`") {
      const innerQuote = char;
      cursor += 1;
      while (cursor < source.length) {
        if (source[cursor] === "\\" && cursor + 1 < source.length) {
          cursor += 2;
          continue;
        }
        if (source[cursor] === innerQuote) break;
        cursor += 1;
      }
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(index, cursor + 1);
    }
    cursor += 1;
  }
  return null;
}

function parseConstants(source) {
  const constants = {};
  const regex = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
  let match;
  while ((match = regex.exec(source))) {
    const name = match[1];
    const value = evaluateNumber(match[2], constants, null);
    if (Number.isFinite(value)) constants[name] = value;
  }
  return constants;
}

function evaluateNumber(raw, constants = {}, fallback = undefined) {
  if (raw === null || raw === undefined) return fallback;
  let expression = String(raw).trim();
  if (!expression) return fallback;
  expression = expression.replace(/^["']|["']$/g, "");
  const direct = Number(expression);
  if (Number.isFinite(direct)) return direct;
  expression = expression.replace(/\b[A-Za-z_$][\w$]*\b/g, (name) => {
    if (Object.prototype.hasOwnProperty.call(constants, name)) return String(constants[name]);
    return name;
  });
  if (/[A-Za-z_$]/.test(expression)) return fallback;
  if (!/^[0-9+\-*/().\s]+$/.test(expression)) return fallback;
  try {
    const value = Function(`"use strict"; return (${expression});`)();
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function parseStringAttr(block, name, fallback = "") {
  const raw = attrRaw(block, name);
  if (raw === null || raw === undefined) return fallback;
  return String(raw).trim().replace(/^["'`]|["'`]$/g, "") || fallback;
}

function parseNumberAttr(block, name, constants, fallback) {
  return evaluateNumber(attrRaw(block, name), constants, fallback);
}

function parseDefaultProps(block) {
  const expression = attrExpression(block, "defaultProps");
  if (!expression) return {};
  let objectExpression = expression.trim();
  if (objectExpression.startsWith("{") && objectExpression.endsWith("}")) {
    objectExpression = objectExpression.slice(1, -1).trim();
  }
  if (objectExpression.startsWith("{") && objectExpression.endsWith("}")) {
    objectExpression = objectExpression.slice(1, -1).trim();
  }
  if (!objectExpression) return {};
  const withoutTypes = objectExpression
    .replace(/\s+satisfies\s+[A-Za-z_$][\w$.<>]*/g, "")
    .replace(/\s+as\s+(const|[A-Za-z_$][\w$.<>]*)/g, "");
  const jsonLike = `{${withoutTypes
    .replace(/(^|,\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/'/g, '"')}}`;
  try {
    const parsed = JSON.parse(jsonLike);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function findRemotionEntry(workspacePath, files) {
  const explicit = ["src/index.ts", "src/index.tsx", "src/main.ts", "src/main.tsx"]
    .map((relative) => path.join(workspacePath, relative))
    .find((candidate) => fs.existsSync(candidate));
  const withRegisterRoot = files.find((filePath) => {
    try {
      return readText(filePath).includes("registerRoot");
    } catch {
      return false;
    }
  });
  return withRegisterRoot || explicit || files.find((filePath) => readText(filePath).includes("<Composition")) || null;
}

function findImportedComponentFile(sourceFile, source, componentName) {
  const importRegex = /import\s+([^;]+?)\s+from\s+["']([^"']+)["']/g;
  let match;
  while ((match = importRegex.exec(source))) {
    const clause = match[1];
    const request = match[2];
    const names = [];
    const defaultMatch = /^\s*([A-Za-z_$][\w$]*)/.exec(clause);
    if (defaultMatch) names.push(defaultMatch[1]);
    const namedMatch = /\{([^}]+)\}/.exec(clause);
    if (namedMatch) {
      namedMatch[1].split(",").forEach((part) => {
        const local = part.trim().split(/\s+as\s+/i).pop()?.trim();
        if (local) names.push(local);
      });
    }
    if (!names.includes(componentName)) continue;
    const resolved = resolveModule(sourceFile, request);
    if (resolved) return resolved;
  }
  return null;
}

function componentDefinedIn(source, componentName) {
  const escaped = componentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(function|const|class)\\s+${escaped}\\b`).test(source);
}

function findComponentFile(workspacePath, sourceFile, source, componentName, files) {
  if (!componentName) return sourceFile;
  if (componentDefinedIn(source, componentName)) return sourceFile;
  const imported = findImportedComponentFile(sourceFile, source, componentName);
  if (imported) return imported;
  return files.find((filePath) => {
    try {
      return componentDefinedIn(readText(filePath), componentName);
    } catch {
      return false;
    }
  }) || sourceFile;
}

function parseCompositionBlocks(workspacePath, files) {
  const compositions = [];
  for (const filePath of files) {
    const source = readText(filePath);
    if (!source.includes("<Composition")) continue;
    const constants = parseConstants(source);
    const regex = /<Composition\b([\s\S]*?)(?:\/>|>)/g;
    let match;
    while ((match = regex.exec(source))) {
      const block = match[1];
      const id = parseStringAttr(block, "id", "");
      if (!id) continue;
      const componentName = parseStringAttr(block, "component", "").replace(/[{}]/g, "").trim();
      const componentFile = findComponentFile(workspacePath, filePath, source, componentName, files);
      const durationInFrames = Math.max(1, Math.round(parseNumberAttr(block, "durationInFrames", constants, 300) || 300));
      const fps = Math.max(1, Math.round(parseNumberAttr(block, "fps", constants, 30) || 30));
      const width = Math.max(1, Math.round(parseNumberAttr(block, "width", constants, 1920) || 1920));
      const height = Math.max(1, Math.round(parseNumberAttr(block, "height", constants, 1080) || 1080));
      const defaultProps = parseDefaultProps(block);
      compositions.push({
        id,
        componentName: componentName || null,
        sourcePath: relativeToWorkspace(workspacePath, filePath),
        componentPath: relativeToWorkspace(workspacePath, componentFile),
        durationInFrames,
        fps,
        width,
        height,
        defaultProps,
        sequences: parseSequencesFromFile(workspacePath, componentFile, durationInFrames),
      });
    }
  }
  return compositions;
}

function parseSequencesFromFile(workspacePath, filePath, compositionDuration) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const source = readText(filePath);
  const constants = parseConstants(source);
  const sequences = [];
  const regex = /<Sequence\b([\s\S]*?)(?:\/>|>)/g;
  let match;
  let index = 0;
  while ((match = regex.exec(source))) {
    const block = match[1];
    const from = Math.max(0, Math.round(parseNumberAttr(block, "from", constants, 0) || 0));
    const duration = Math.max(1, Math.round(
      parseNumberAttr(block, "durationInFrames", constants, compositionDuration - from) ||
      parseNumberAttr(block, "duration", constants, compositionDuration - from) ||
      compositionDuration - from,
    ));
    const name = parseStringAttr(block, "name", "") || parseStringAttr(block, "layout", "") || `Sequence ${index + 1}`;
    sequences.push({
      id: `sequence-${index + 1}`,
      label: name,
      from,
      duration,
      sourcePath: relativeToWorkspace(workspacePath, filePath),
    });
    index += 1;
  }
  return sequences;
}

function parseTextSnippets(source) {
  const snippets = [];
  const regex = />([^<>{}\n][^<>{}]{2,120})</g;
  let match;
  while ((match = regex.exec(source)) && snippets.length < 8) {
    const text = match[1].replace(/\s+/g, " ").trim();
    const looksLikeCode =
      !text ||
      /^[);,.\s]+$/.test(text) ||
      /[=;{}()[\]?]/.test(text) ||
      /\b(const|let|return|frame|props|style|className)\b/.test(text);
    if (!looksLikeCode) snippets.push(text);
  }
  return snippets;
}

function detectProject(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const pkg = packageInfo(workspacePath);
  const files = sourceFiles(workspacePath);
  const entryFile = input.entryPoint
    ? path.resolve(workspacePath, input.entryPoint)
    : findRemotionEntry(workspacePath, files);
  const entryPoint = entryFile ? relativeToWorkspace(workspacePath, entryFile) : null;
  const hasRemotionDependency = Boolean(dependencyVersion(pkg, "remotion"));
  const hasCompositions = files.some((filePath) => readText(filePath).includes("<Composition"));
  const diagnostics = [];
  if (!entryPoint) diagnostics.push({ level: "error", source: "detectProject", message: "No Remotion entry point found." });
  if (!hasRemotionDependency) diagnostics.push({ level: "warning", source: "package.json", message: "Package does not declare a remotion dependency." });
  if (!hasCompositions) diagnostics.push({ level: "warning", source: "source", message: "No <Composition> declarations found." });

  return {
    ok: Boolean(entryPoint && (hasRemotionDependency || hasCompositions)),
    workspacePath,
    projectName: pkg.name || path.basename(workspacePath),
    packageManager: packageManager(workspacePath),
    entryPoint,
    rootFile: entryPoint,
    remotionVersion: dependencyVersion(pkg, "remotion") || null,
    renderer: detectRemotionRenderer(workspacePath),
    sourceFileCount: files.length,
    diagnostics,
  };
}

function buildManifest(input = {}) {
  const detection = detectProject(input);
  const workspacePath = detection.workspacePath;
  const files = sourceFiles(workspacePath);
  const compositions = parseCompositionBlocks(workspacePath, files);
  return {
    schemaVersion: 1,
    engine: "sparo-video-engine",
    buildId: hashContent(JSON.stringify({
      workspacePath,
      entryPoint: detection.entryPoint,
      files: files.map((filePath) => `${relativeToWorkspace(workspacePath, filePath)}:${safeStat(filePath)?.mtimeMs || 0}`),
    })),
    generatedAt: Date.now(),
    compositions,
  };
}

function compileProject(input = {}) {
  emitStatus("Compiling Remotion project with Sparo Video Engine.");
  const detection = detectProject(input);
  const workspacePath = detection.workspacePath;
  const manifest = buildManifest(input);
  const assets = indexAssets(input).assets;
  const diagnostics = [
    ...detection.diagnostics,
    ...(manifest.compositions.length ? [] : [{ level: "error", source: "compileProject", message: "No compositions were found." }]),
  ];
  const changes = gitChanges(workspacePath);
  const output = {
    ok: manifest.compositions.length > 0,
    buildId: manifest.buildId,
    project: detection,
    renderer: detection.renderer,
    manifest,
    assets,
    diagnostics,
    changes,
  };
  writeJson(path.join(ensureRuntimeDir(workspacePath), "engine-state.json"), output);
  return output;
}

function getCompositionManifest(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const statePath = path.join(ensureRuntimeDir(workspacePath), "engine-state.json");
  const state = readJson(statePath, null);
  if (state?.manifest) return { ok: true, manifest: state.manifest, project: state.project };
  return { ok: true, manifest: buildManifest(input), project: detectProject(input) };
}

function colorForIndex(index) {
  return ["#5dc6ff", "#f4c542", "#8de16d", "#ff7a90", "#b99cff", "#63dbc6"][index % 6];
}

function visualElementsForComposition(workspacePath, composition) {
  const componentPath = composition?.componentPath ? path.join(workspacePath, composition.componentPath) : null;
  if (!componentPath || !fs.existsSync(componentPath)) return [];
  const source = readText(componentPath);
  const snippets = parseTextSnippets(source);
  const tagMatches = [...source.matchAll(/<(Img|Video|OffthreadVideo|Audio|svg|canvas|AbsoluteFill|div|h1|h2|p|span)\b/g)]
    .map((match) => match[1])
    .slice(0, 12);
  const tags = tagMatches.length ? tagMatches : ["Composition"];
  return tags.map((tag, index) => ({
    id: `element-${index + 1}`,
    type: tag,
    label: snippets[index] || tag,
    x: 8 + (index % 3) * 8,
    y: 10 + index * 6,
    width: Math.max(18, 78 - (index % 4) * 10),
    height: tag === "Audio" ? 8 : Math.max(10, 26 - (index % 3) * 4),
    color: colorForIndex(index),
    opacity: tag === "Audio" ? 0.42 : 0.78,
  }));
}

function evaluateFrame(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const manifest = getCompositionManifest(input).manifest;
  const compositionId = String(input.compositionId || input.composition || "").trim() || manifest.compositions[0]?.id;
  const composition = manifest.compositions.find((item) => item.id === compositionId);
  if (!composition) throw new Error(`Composition not found: ${compositionId || "(none)"}`);
  const frame = Math.max(0, Math.min(Number(input.frame) || 0, composition.durationInFrames - 1));
  const activeSequences = composition.sequences.filter((sequence) => {
    const from = Number(sequence.from) || 0;
    const duration = Number(sequence.duration) || composition.durationInFrames;
    return frame >= from && frame < from + duration;
  });
  const visualElements = visualElementsForComposition(workspacePath, composition);
  const sequenceLayers = activeSequences.map((sequence, index) => ({
    id: sequence.id,
    type: "Sequence",
    label: sequence.label,
    from: sequence.from,
    duration: sequence.duration,
    x: 6 + index * 4,
    y: 8 + index * 8,
    width: Math.max(20, 86 - index * 9),
    height: 13,
    color: colorForIndex(index),
    opacity: 0.62,
  }));
  const layers = sequenceLayers.length ? sequenceLayers : visualElements;
  return {
    ok: true,
    compositionId: composition.id,
    frame,
    timeSeconds: frame / composition.fps,
    composition,
    sequences: composition.sequences,
    activeSequences,
    layers,
    diagnostics: [],
  };
}

function indexAssets(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const files = walkFiles(workspacePath, { maxFiles: 8000 });
  const assets = files
    .map((filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const type = ASSET_EXTENSIONS.get(ext);
      if (!type) return null;
      const stat = safeStat(filePath);
      return {
        type,
        name: path.basename(filePath),
        path: relativeToWorkspace(workspacePath, filePath),
        bytes: stat?.size || 0,
      };
    })
    .filter(Boolean)
    .slice(0, 500);
  return { ok: true, assets, truncated: assets.length >= 500 };
}

function gitChanges(workspacePath) {
  const result = spawnSync("git", ["status", "--short"], {
    cwd: workspacePath,
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return [];
  return String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(0, 200)
    .map((line) => ({
      status: line.slice(0, 2).trim() || "changed",
      path: line.slice(3).trim(),
    }));
}

function readDiagnostics(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const state = readJson(path.join(ensureRuntimeDir(workspacePath), "engine-state.json"), null);
  return {
    ok: true,
    diagnostics: state?.diagnostics || detectProject(input).diagnostics,
    changes: gitChanges(workspacePath),
  };
}

function safeFilePart(value) {
  return String(value || "composition").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "composition";
}

function renderedFramePath(workspacePath, compositionId, frame, scale, buildId, kind = "preview") {
  const scalePart = String(scale).replace(/[^0-9.]+/g, "").replace(".", "p") || "1";
  const outputDir = ensureRuntimeDir(workspacePath, kind === "still" ? "stills" : "preview-frames");
  const outputPath = path.join(
    outputDir,
    `${safeFilePart(compositionId)}-frame-${frame}-scale-${scalePart}-${safeFilePart(buildId)}.png`,
  );
  return { outputDir, outputPath };
}

function renderedPreviewClipPath(workspacePath, compositionId, from, to, scale, buildId) {
  const scalePart = String(scale).replace(/[^0-9.]+/g, "").replace(".", "p") || "1";
  const outputDir = ensureRuntimeDir(workspacePath, "preview-videos");
  const outputPath = path.join(
    outputDir,
    `${safeFilePart(compositionId)}-frames-${from}-${to}-scale-${scalePart}-${safeFilePart(buildId)}.mp4`,
  );
  return { outputDir, outputPath };
}

function compositionForInput(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const manifest = getCompositionManifest(input).manifest;
  const compositionId = String(input.compositionId || input.composition || "").trim() || manifest.compositions[0]?.id;
  const composition = manifest.compositions.find((item) => item.id === compositionId);
  if (!composition) throw new Error(`Composition not found: ${compositionId || "(none)"}`);
  const frame = Math.max(0, Math.min(Math.round(Number(input.frame) || 0), composition.durationInFrames - 1));
  return { workspacePath, manifest, composition, frame };
}

function renderFrameWithRemotion(input = {}, options = {}) {
  const { workspacePath, manifest, composition, frame } = compositionForInput(input);
  const detection = detectProject(input);
  if (!detection.entryPoint) throw new Error("Cannot render frame because no Remotion entry point was detected.");

  const scale = clampNumber(
    input.scale,
    0.05,
    1,
    options.defaultScale ?? DEFAULT_PREVIEW_SCALE,
  );
  const { outputDir, outputPath } = renderedFramePath(
    workspacePath,
    composition.id,
    frame,
    scale,
    manifest.buildId,
    options.kind || "preview",
  );
  const useCache = input.force !== true && fs.existsSync(outputPath);
  let renderLog = null;

  if (!useCache) {
    fs.mkdirSync(outputDir, { recursive: true });
    const args = [
      "still",
      detection.entryPoint,
      composition.id,
      outputPath,
      "--frame",
      String(frame),
      "--scale",
      String(scale),
      "--overwrite",
    ];
    renderLog = runRemotion(workspacePath, args, {
      timeoutMs: options.timeoutMs || REMOTION_RENDER_TIMEOUT_MS,
    });
    pruneDirectoryFiles(outputDir);
  }

  const stat = safeStat(outputPath);
  if (!stat?.isFile()) {
    throw new Error(`Remotion did not produce an image: ${outputPath}`);
  }

  return {
    ok: true,
    renderer: "remotion-cli",
    cached: useCache,
    buildId: manifest.buildId,
    compositionId: composition.id,
    frame,
    scale,
    width: Math.max(1, Math.round((Number(composition.width) || 1920) * scale)),
    height: Math.max(1, Math.round((Number(composition.height) || 1080) * scale)),
    outputPath,
    outputUri: fileUri(outputPath),
    dataUrl: fileDataUrl(outputPath),
    bytes: stat.size,
    renderLog,
    diagnostics: [],
  };
}

function renderStill(input = {}) {
  return {
    status: "completed",
    kind: "remotion-still",
    ...renderFrameWithRemotion(input, {
      kind: "still",
      defaultScale: DEFAULT_STILL_SCALE,
      timeoutMs: REMOTION_RENDER_TIMEOUT_MS,
    }),
  };
}

function renderPreviewFrame(input = {}) {
  return {
    status: "completed",
    kind: "remotion-preview-frame",
    ...renderFrameWithRemotion(input, {
      kind: "preview",
      defaultScale: DEFAULT_PREVIEW_SCALE,
      timeoutMs: REMOTION_RENDER_TIMEOUT_MS,
    }),
  };
}

function renderPreviewClip(input = {}) {
  const { workspacePath, manifest, composition, frame } = compositionForInput(input);
  const detection = detectProject(input);
  if (!detection.entryPoint) throw new Error("Cannot render preview clip because no Remotion entry point was detected.");

  const scale = clampNumber(input.scale, 0.05, 1, DEFAULT_PREVIEW_VIDEO_SCALE);
  const seconds = clampNumber(input.durationSeconds, 2, 12, DEFAULT_PREVIEW_CLIP_SECONDS);
  const fps = Math.max(1, Number(composition.fps) || 30);
  const from = frame;
  const to = Math.max(from, Math.min(
    composition.durationInFrames - 1,
    from + Math.max(1, Math.round(seconds * fps)) - 1,
  ));
  const { outputDir, outputPath } = renderedPreviewClipPath(
    workspacePath,
    composition.id,
    from,
    to,
    scale,
    manifest.buildId,
  );
  const useCache = input.force !== true && fs.existsSync(outputPath);
  let renderLog = null;

  if (!useCache) {
    fs.mkdirSync(outputDir, { recursive: true });
    renderLog = runRemotion(workspacePath, [
      "render",
      detection.entryPoint,
      composition.id,
      outputPath,
      "--overwrite",
      "--scale",
      String(scale),
      `--frames=${from}-${to}`,
    ], {
      timeoutMs: input.timeoutMs || REMOTION_EXPORT_TIMEOUT_MS,
    });
    pruneDirectoryFiles(outputDir, PREVIEW_VIDEO_CACHE_LIMIT);
  }

  const stat = safeStat(outputPath);
  if (!stat?.isFile()) {
    throw new Error(`Remotion did not produce a preview clip: ${outputPath}`);
  }

  return {
    ok: true,
    status: "completed",
    kind: "remotion-preview-clip",
    renderer: "remotion-cli",
    cached: useCache,
    buildId: manifest.buildId,
    compositionId: composition.id,
    from,
    to,
    fps,
    scale,
    width: Math.max(1, Math.round((Number(composition.width) || 1920) * scale)),
    height: Math.max(1, Math.round((Number(composition.height) || 1080) * scale)),
    durationSeconds: (to - from + 1) / fps,
    outputPath,
    outputUri: fileUri(outputPath),
    dataUrl: fileDataUrl(outputPath),
    bytes: stat.size,
    renderLog,
    diagnostics: [],
  };
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

function runsPath(workspacePath) {
  return path.join(ensureRuntimeDir(workspacePath), "runs.json");
}

function readRuns(workspacePath) {
  return readJson(runsPath(workspacePath), { runs: [] }) || { runs: [] };
}

function writeRuns(workspacePath, runs) {
  writeJson(runsPath(workspacePath), { runs });
}

function startExport(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const manifest = getCompositionManifest(input).manifest;
  const detection = detectProject(input);
  const compositionId = String(input.compositionId || input.composition || "").trim() || manifest.compositions[0]?.id;
  const composition = manifest.compositions.find((item) => item.id === compositionId);
  if (!composition) throw new Error(`Composition not found: ${compositionId || "(none)"}`);
  if (!detection.entryPoint) throw new Error("Cannot export because no Remotion entry point was detected.");
  const [fromRaw, toRaw] = Array.isArray(input.frameRange) ? input.frameRange : [0, composition.durationInFrames - 1];
  const fromValue = Number(fromRaw);
  const toValue = Number(toRaw);
  const from = Math.round(Math.max(0, Number.isFinite(fromValue) ? fromValue : 0));
  const to = Math.max(from, Math.round(Math.min(
    composition.durationInFrames - 1,
    Number.isFinite(toValue) ? toValue : composition.durationInFrames - 1,
  )));
  const runId = `export-${hashContent(`${composition.id}:${from}:${to}:${Date.now()}`)}`;
  const outputDir = ensureRuntimeDir(workspacePath, path.join("exports", runId));
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${safeFilePart(composition.id)}.mp4`);
  const args = [
    "render",
    detection.entryPoint,
    composition.id,
    outputPath,
    "--overwrite",
  ];
  if (Number.isFinite(Number(input.scale))) {
    args.push("--scale", String(clampNumber(input.scale, 0.05, 1, 1)));
  }
  if (Array.isArray(input.frameRange)) {
    args.push(`--frames=${from}-${to}`);
  }
  const renderLog = runRemotion(workspacePath, args, { timeoutMs: REMOTION_EXPORT_TIMEOUT_MS });
  const run = {
    runId,
    kind: "remotion-video",
    status: "completed",
    compositionId: composition.id,
    frameRange: [from, to],
    outputPath,
    outputUri: fileUri(outputPath),
    renderLog,
    completedAt: Date.now(),
  };
  const runs = [run, ...readRuns(workspacePath).runs.filter((item) => item.runId !== runId)].slice(0, 50);
  writeRuns(workspacePath, runs);
  writeJson(path.join(outputDir, "manifest.json"), run);
  return { ok: true, ...run, manifestPath: path.join(outputDir, "manifest.json") };
}

function getExportStatus(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const runId = String(input.runId || input.exportId || "").trim();
  const runs = readRuns(workspacePath).runs;
  if (!runId) return { ok: true, runs };
  const run = runs.find((item) => item.runId === runId);
  return { ok: Boolean(run), run: run || null };
}

function cancelExport(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const runId = String(input.runId || input.exportId || "").trim();
  if (!runId) return { ok: false, status: "not_found" };
  const state = readRuns(workspacePath);
  const runs = state.runs.map((run) => run.runId === runId ? { ...run, status: "cancelled", cancelledAt: Date.now() } : run);
  writeRuns(workspacePath, runs);
  return { ok: true, run: runs.find((run) => run.runId === runId) || null };
}

async function main() {
  const request = await readRequest();
  const action = request.action;
  const input = request.input || {};
  emit({ type: "run.started", run_id: request.runId || request.run_id || `remotion-${Date.now()}` });

  let output;
  switch (action) {
    case "detectProject":
      output = detectProject(input);
      break;
    case "compileProject":
      output = compileProject(input);
      break;
    case "getCompositionManifest":
      output = getCompositionManifest(input);
      break;
    case "evaluateFrame":
      output = evaluateFrame(input);
      break;
    case "renderPreviewFrame":
      output = renderPreviewFrame(input);
      break;
    case "renderPreviewClip":
      output = renderPreviewClip(input);
      break;
    case "ensurePlayerPreviewHost":
      output = await ensurePlayerPreviewHost(input);
      break;
    case "getPlayerPreviewHostStatus":
      output = await getPlayerPreviewHostStatus(input);
      break;
    case "stopPlayerPreviewHost":
      output = await stopPlayerPreviewHost(input);
      break;
    case "ensurePreviewServer":
      output = await ensurePreviewServer(input);
      break;
    case "getPreviewServerStatus":
      output = await getPreviewServerStatus(input);
      break;
    case "stopPreviewServer":
      output = await stopPreviewServer(input);
      break;
    case "renderStill":
      output = renderStill(input);
      break;
    case "startExport":
      output = startExport(input);
      break;
    case "getExportStatus":
      output = getExportStatus(input);
      break;
    case "cancelExport":
      output = cancelExport(input);
      break;
    case "indexAssets":
      output = indexAssets(input);
      break;
    case "readDiagnostics":
      output = readDiagnostics(input);
      break;
    default:
      throw new Error(`Unsupported Sparo Video Engine action: ${action}`);
  }

  emit({ type: "run.completed", output });
}

main().catch((error) => {
  emit({
    type: "run.failed",
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
  });
  process.exitCode = 1;
});
