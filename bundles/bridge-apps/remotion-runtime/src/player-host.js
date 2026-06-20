const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { playerHostStatePath, playerHostRootDir, playerHostSourceDir, playerHostDistDir, playerHostLogPath, playerHostServerPath, normalizeWorkspace, workspacePathOf } = require("./paths");
const { hashContent, safeFilePart, sideEffectImportsForSource, relativeImport, jsString, readJson, writeJson, isProcessAlive, httpStatus, tailPlayerHostLogs, psQuote, findFreePort, clampNumber, waitForHttp, terminateProcessTree } = require("./util");
const { compositionForInput } = require("./project");
const { PLAYER_HOST_RUNTIME_VERSION, PLAYER_HOST_STALE_MS, PLAYER_HOST_BOOT_WAIT_MS } = require("./constants");

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
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef} from "react";
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
const componentPath = ${JSON.stringify(composition.componentPath || null)};
const ELEMENT_SELECTOR = "img,video,canvas,svg,h1,h2,h3,h4,h5,h6,p,span,strong,em,small,div,section,article,main,header,footer,li,button";
const SKIP_CLASS_PATTERN = /(remotion|player|rl-player|__remotion)/i;

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

function elementLabel(element: Element): string {
  const direct = element.getAttribute("aria-label")
    || element.getAttribute("title")
    || element.getAttribute("alt")
    || element.getAttribute("data-name")
    || element.getAttribute("data-testid")
    || "";
  const text = direct || (element.textContent || "").replace(/\\s+/g, " ").trim();
  return text.slice(0, 80);
}

function elementPath(element: Element, root: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== root && parts.length < 6) {
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const siblings = Array.from(parent.children).filter((item) => item.tagName === current!.tagName);
    const index = siblings.indexOf(current) + 1;
    parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + index + ")" : tag);
    current = parent;
  }
  return parts.join(">");
}

function hasOwnText(element: Element): boolean {
  return Array.from(element.childNodes).some((node) => {
    return node.nodeType === Node.TEXT_NODE && Boolean((node.textContent || "").trim());
  });
}

function visibleElementCandidates(stage: HTMLElement): Element[] {
  const candidates = Array.from(stage.querySelectorAll(ELEMENT_SELECTOR));
  const stageRect = stage.getBoundingClientRect();
  const stageArea = Math.max(1, stageRect.width * stageRect.height);
  return candidates.filter((element) => {
    if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return false;
    const tag = element.tagName.toLowerCase();
    if (tag === "script" || tag === "style") return false;
    const className = typeof element.className === "string" ? element.className : "";
    if (SKIP_CLASS_PATTERN.test(className)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    if (rect.right <= stageRect.left || rect.left >= stageRect.right || rect.bottom <= stageRect.top || rect.top >= stageRect.bottom) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") <= 0.02) return false;
    const area = rect.width * rect.height;
    const mediaLike = ["img", "video", "canvas", "svg"].includes(tag);
    const textLike = Boolean(elementLabel(element));
    const ownText = hasOwnText(element);
    const visualStyle = style.backgroundImage !== "none"
      || (style.backgroundColor && style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent")
      || style.borderTopStyle !== "none"
      || style.boxShadow !== "none";
    const nearWholeStage = area / stageArea > 0.92;
    if (nearWholeStage && !mediaLike && !ownText) return false;
    return mediaLike || textLike || visualStyle;
  });
}

function measureFrameContext(stage: HTMLElement | null, frame: number) {
  if (!stage) {
    return {
      frame,
      timeSeconds: frame / composition.fps,
      layers: [],
      measurement: "player-dom",
    };
  }
  const stageRect = stage.getBoundingClientRect();
  const width = Math.max(1, stageRect.width);
  const height = Math.max(1, stageRect.height);
  const layers = visibleElementCandidates(stage)
    .map((element, index) => {
      const rect = element.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, ((rect.left - stageRect.left) / width) * 100));
      const y = Math.max(0, Math.min(100, ((rect.top - stageRect.top) / height) * 100));
      const w = Math.max(0.5, Math.min(100 - x, (rect.width / width) * 100));
      const h = Math.max(0.5, Math.min(100 - y, (rect.height / height) * 100));
      const tag = element.tagName.toLowerCase();
      const path = elementPath(element, stage);
      const label = elementLabel(element) || tag;
      return {
        id: "dom:" + path,
        type: tag,
        label,
        source: "player-dom",
        sourceHint: componentPath,
        componentPath,
        elementPath: path,
        x,
        y,
        width: w,
        height: h,
        bboxPercent: { x, y, width: w, height: h },
        color: ["#5dc6ff", "#f4c542", "#8de16d", "#ff7a90", "#b99cff", "#63dbc6"][index % 6],
        opacity: 0.18,
      };
    })
    .sort((left, right) => (left.width * left.height) - (right.width * right.height))
    .slice(0, 32);
  return {
    frame,
    timeSeconds: frame / composition.fps,
    composition,
    measurement: "player-dom",
    layers,
  };
}

function App() {
  const playerRef = useRef<PlayerRef>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<null | (() => void)>(null);
  const readyPostedRef = useRef(false);
  const frameContextRequestRef = useRef<number | null>(null);
  const pendingCommandsRef = useRef<Array<Record<string, unknown>>>([]);
  const initialFrame = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return clampFrame(params.get("frame"));
  }, []);
  const shouldAutoplay = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("autoplay") === "1";
  }, []);

  const postFrameContext = useCallback((frame: number) => {
    if (frameContextRequestRef.current !== null) {
      window.cancelAnimationFrame(frameContextRequestRef.current);
    }
    frameContextRequestRef.current = window.requestAnimationFrame(() => {
      frameContextRequestRef.current = null;
      post("frameContext", measureFrameContext(stageRef.current, frame));
    });
  }, []);

  const seekTo = useCallback((frame: unknown) => {
    const next = clampFrame(frame);
    playerRef.current?.seekTo(next);
    post("frame", {frame: next});
    postFrameContext(next);
  }, [postFrameContext]);

  const play = useCallback((frame?: unknown) => {
    if (frame !== undefined && frame !== null) {
      seekTo(frame);
    }
    const player = playerRef.current;
    const result = player?.play();
    if (player) {
      const nextFrame = clampFrame(player.getCurrentFrame());
      post("play", {frame: nextFrame});
      postFrameContext(nextFrame);
    }
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch((error) => {
        post("error", {message: error instanceof Error ? error.message : String(error)});
      });
    }
  }, [postFrameContext, seekTo]);

  const pause = useCallback(() => {
    const player = playerRef.current;
    player?.pause();
    if (player) {
      const nextFrame = clampFrame(player.getCurrentFrame());
      post("pause", {frame: nextFrame});
      postFrameContext(nextFrame);
    }
  }, [postFrameContext]);

  const runCommand = useCallback((message: Record<string, unknown>) => {
    if (message.type === "seek") seekTo(message.frame);
    if (message.type === "play") play(message.frame);
    if (message.type === "pause") pause();
    if (message.type === "toggle") playerRef.current?.toggle();
    const nextFrame = clampFrame(playerRef.current?.getCurrentFrame?.() ?? initialFrame);
    post("command", {command: message.type, frame: nextFrame});
    postFrameContext(nextFrame);
  }, [initialFrame, pause, play, postFrameContext, seekTo]);

  const ensurePlayerReady = useCallback(() => {
    const player = playerRef.current;
    if (!player) return false;

    if (!cleanupRef.current) {
    const onFrame = (event: Event) => {
      const detailFrame = (event as CustomEvent<{frame?: number}>).detail?.frame;
      const frame = detailFrame ?? player.getCurrentFrame();
      const nextFrame = clampFrame(frame);
      post("frame", {frame: nextFrame});
      postFrameContext(nextFrame);
    };
    const onPlay = () => {
      const nextFrame = clampFrame(player.getCurrentFrame());
      post("play", {frame: nextFrame});
      postFrameContext(nextFrame);
    };
    const onPause = () => {
      const nextFrame = clampFrame(player.getCurrentFrame());
      post("pause", {frame: nextFrame});
      postFrameContext(nextFrame);
    };
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
      postFrameContext(frame);
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
      postFrameContext(frame);
    }

    const pending = pendingCommandsRef.current.splice(0);
    pending.forEach(runCommand);
    return true;
  }, [initialFrame, play, postFrameContext, runCommand, shouldAutoplay]);

  useLayoutEffect(() => {
    postFrameContext(clampFrame(playerRef.current?.getCurrentFrame?.() ?? initialFrame));
  }, [initialFrame, postFrameContext]);

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
      if (frameContextRequestRef.current !== null) {
        window.cancelAnimationFrame(frameContextRequestRef.current);
        frameContextRequestRef.current = null;
      }
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [ensurePlayerReady]);

  if (!Component) {
    post("error", {message: "Composition component could not be resolved."});
    return <div className="rl-player-error">Composition component could not be resolved.</div>;
  }

  return (
    <div ref={stageRef} data-sparo-remotion-stage style={{width: "100%", height: "100%", position: "relative"}}>
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
    </div>
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

module.exports = {
  resolveWorkspaceModule,
  playerHostBundleId,
  writePlayerHostEntry,
  runWebpackBuild,
  bundlePlayerHost,
  ensurePlayerHostServerScript,
  playerHostStatusForState,
  readPlayerHostState,
  writePlayerHostState,
  spawnPlayerHostServer,
  ensurePlayerPreviewHost,
  getPlayerPreviewHostStatus,
  stopPlayerPreviewHost,
};
