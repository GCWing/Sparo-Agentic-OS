const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { playerHostStatePath, playerHostRootDir, playerHostSourceDir, playerHostDistDir, playerHostLogPath, playerHostServerPath, normalizeWorkspace, workspacePathOf } = require("./paths");
const { hashContent, readJson, writeJson, isProcessAlive, httpStatus, tailPlayerHostLogs, psQuote, findFreePort, clampNumber, waitForHttp, terminateProcessTree } = require("./util");
const { compositionForInput } = require("./project");
const { RUNTIME_SCHEMA_VERSION } = require("./project-runtime");
const { artifactRoot } = require("./artifacts");
const { PLAYER_CONTROL_PROTOCOL_VERSION, PLAYER_HOST_RUNTIME_VERSION, PLAYER_HOST_BOOT_WAIT_MS } = require("./constants");

const playerHostFlights = new Map();
const playerHostWorkspaceTails = new Map();

function moduleSearchPaths(workspacePath, projectRoot) {
  return Array.from(new Set([
    projectRoot,
    workspacePath,
    __dirname,
    process.cwd(),
  ].filter(Boolean)));
}

function resolveWorkspaceModule(workspacePath, request, projectRoot = workspacePath) {
  return require.resolve(request, { paths: moduleSearchPaths(workspacePath, projectRoot) });
}

function resolveRemotionBundlerLoader(workspacePath, projectRoot) {
  const packagePath = resolveWorkspaceModule(workspacePath, "@remotion/bundler/package.json", projectRoot);
  return path.join(path.dirname(packagePath), "dist", "esbuild-loader", "index.js");
}

function playerHostBundleId(manifest) {
  return hashContent(JSON.stringify({
    runtimeVersion: PLAYER_HOST_RUNTIME_VERSION,
    protocolVersion: PLAYER_CONTROL_PROTOCOL_VERSION,
    buildId: manifest.buildId,
    entryPoint: manifest.entryPoint,
  }));
}

function playerHostProjectEntryPath(workspacePath, manifest) {
  const workspaceRoot = path.resolve(workspacePath);
  const relativeEntry = String(manifest?.entryPoint || "").trim();
  const projectEntryPath = relativeEntry ? path.resolve(workspaceRoot, relativeEntry) : null;
  const relative = projectEntryPath ? path.relative(workspaceRoot, projectEntryPath) : "";
  if (
    !projectEntryPath
    || relative.startsWith("..")
    || path.isAbsolute(relative)
    || !fs.existsSync(projectEntryPath)
    || !fs.statSync(projectEntryPath).isFile()
  ) {
    throw new Error(`Cannot build Player preview because the Remotion entry point was not found: ${relativeEntry || "(missing)"}`);
  }
  return projectEntryPath;
}

function playerHostWebpackEntries(workspacePath, manifest, hostEntryPath) {
  return [
    playerHostProjectEntryPath(workspacePath, manifest),
    path.resolve(hostEntryPath),
  ];
}

function writePlayerHostEntry(workspacePath, manifest, bundleId) {
  const sourceDir = playerHostSourceDir(workspacePath);
  fs.mkdirSync(sourceDir, { recursive: true });
  const entryPath = path.join(sourceDir, `entry-project-${bundleId}.tsx`);
  playerHostProjectEntryPath(workspacePath, manifest);
  const compositionDescriptors = (manifest.compositions || []).map((item) => ({
    id: item.id,
    descriptorRevision: item.descriptorRevision,
    durationInFrames: item.durationInFrames,
    fps: item.fps,
    width: item.width,
    height: item.height,
    resolvedProps: item.resolvedProps || item.defaultProps || {},
    serializedResolvedProps: item.serializedResolvedProps || null,
  }));
  if (!compositionDescriptors.length) {
    throw new Error("Cannot build Player preview because the compiled manifest has no compositions.");
  }
  const code = `
import * as React from "react";
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import {Player, type PlayerRef} from "@remotion/player";
import {Internals} from "remotion";
import {NoReactInternals} from "remotion/no-react";

const runtimeVersion = ${PLAYER_HOST_RUNTIME_VERSION};
const protocolVersion = ${PLAYER_CONTROL_PROTOCOL_VERSION};
const projectRevision = ${JSON.stringify(manifest.projectRevision || manifest.sourceRevision)};
const initialParams = new URLSearchParams(window.location.search);
const compositionDescriptors = ${JSON.stringify(compositionDescriptors)};
const requestedCompositionId = initialParams.get("compositionId");
const composition = compositionDescriptors.find((item) => item.id === requestedCompositionId) || compositionDescriptors[0];
const resolvedProps = composition.serializedResolvedProps
  ? NoReactInternals.deserializeJSONWithSpecialTypes(composition.serializedResolvedProps)
  : composition.resolvedProps;
const instanceId = initialParams.get("instanceId") || "default";
const channelNonce = initialParams.get("channelNonce") || "";
const RegisteredRoot = Internals.getRoot();
const ELEMENT_SELECTOR = "img,video,canvas,svg,h1,h2,h3,h4,h5,h6,p,span,strong,em,small,div,section,article,main,header,footer,li,button";
const SKIP_CLASS_PATTERN = /(remotion|player|rl-player|__remotion)/i;
let controlPort: MessagePort | null = null;

function clampFrame(value: unknown) {
  const frame = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(composition.durationInFrames - 1, frame));
}

function post(type: string, payload: Record<string, unknown> = {}) {
  if (!controlPort) return false;
  controlPort.postMessage({
    ...payload,
    source: "sparo-remotion-player-host",
    runtimeVersion,
    protocolVersion,
    type,
    compositionId: composition.id,
    projectRevision,
    descriptorRevision: composition.descriptorRevision,
    instanceId,
    channelNonce,
  });
  return true;
}

function announceBootstrap() {
  window.parent?.postMessage({
    source: "sparo-remotion-player-host",
    type: "bootstrapReady",
    runtimeVersion,
    protocolVersion,
    compositionId: composition.id,
    projectRevision,
    descriptorRevision: composition.descriptorRevision,
    instanceId,
    channelNonce,
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
        sourceHint: ${JSON.stringify(manifest.entryPoint || null)},
        componentPath: null,
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

function PlayerRuntime({Component}: {Component: React.ComponentType<Record<string, unknown>>}) {
  const playerRef = useRef<PlayerRef>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<null | (() => void)>(null);
  const readyPostedRef = useRef(false);
  const frameContextRequestRef = useRef<number | null>(null);
  const reconcileRequestRef = useRef<number | null>(null);
  const latestReconcileRef = useRef<Record<string, unknown> | null>(null);
  const pendingCommandsRef = useRef<Array<Record<string, unknown>>>([]);
  const playingRef = useRef(false);
  const bufferingRef = useRef(false);
  const seekingRef = useRef(false);
  const mutedRef = useRef(true);
  const volumeRef = useRef(1);
  const activeRevisionRef = useRef(-1);
  const initialFrame = useMemo(() => {
    return clampFrame(initialParams.get("frame"));
  }, []);
  const lastKnownFrameRef = useRef(initialFrame);

  const currentFrame = useCallback(() => {
    const actual = playerRef.current?.getCurrentFrame?.();
    const frame = Number.isFinite(Number(actual)) ? clampFrame(actual) : clampFrame(lastKnownFrameRef.current);
    lastKnownFrameRef.current = frame;
    return frame;
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

  const postSnapshot = useCallback((requestId: unknown) => {
    const frame = currentFrame();
    post("snapshot", {
      requestId,
      frame,
      playing: playingRef.current,
      buffering: bufferingRef.current,
      seeking: seekingRef.current,
      muted: mutedRef.current,
      volume: volumeRef.current,
      revision: activeRevisionRef.current,
      durationInFrames: composition.durationInFrames,
      fps: composition.fps,
      width: composition.width,
      height: composition.height,
      frameContext: measureFrameContext(stageRef.current, frame),
    });
  }, [currentFrame]);

  const actualPayload = useCallback((frame: unknown = currentFrame()) => {
    const next = clampFrame(frame);
    lastKnownFrameRef.current = next;
    return {
      frame: next,
      playing: playingRef.current,
      buffering: bufferingRef.current,
      seeking: seekingRef.current,
      muted: mutedRef.current,
      volume: volumeRef.current,
      revision: activeRevisionRef.current,
    };
  }, [currentFrame]);

  const postActualState = useCallback((type = "actualState", frame?: unknown) => {
    post(type, actualPayload(frame));
  }, [actualPayload]);

  const applyDesiredState = useCallback((message: Record<string, unknown>) => {
    const player = playerRef.current;
    const desired = message.desired as Record<string, unknown> | undefined;
    const revision = Number(message.revision ?? desired?.revision);
    if (!player || !desired || !Number.isInteger(revision) || revision < 0) return;

    if (revision < activeRevisionRef.current) {
      post("commandAccepted", {
        commandId: message.commandId,
        command: message.command,
        revision,
        accepted: false,
        reason: "stale-revision",
      });
      postActualState();
      return;
    }

    activeRevisionRef.current = revision;
    post("commandAccepted", {
      commandId: message.commandId,
      command: message.command,
      revision,
      accepted: true,
    });

    const nextVolume = Math.max(0, Math.min(1, Number(desired.volume) || 0));
    const nextMuted = desired.muted !== false;
    player.setVolume?.(nextVolume);
    if (nextMuted) player.mute?.();
    else player.unmute?.();
    volumeRef.current = player.getVolume?.() ?? nextVolume;
    mutedRef.current = player.isMuted?.() ?? nextMuted;

    const nextFrame = clampFrame(desired.frame);
    if (Math.abs(currentFrame() - nextFrame) > 0) {
      seekingRef.current = true;
      player.seekTo(nextFrame);
    }

    if (desired.playing === true) {
      try {
        player.play();
      } catch (error) {
        post("error", {message: error instanceof Error ? error.message : String(error), revision});
      }
    } else {
      player.pause();
    }

    window.requestAnimationFrame(() => postActualState());
  }, [currentFrame, postActualState]);

  const flushLatestReconcile = useCallback(() => {
    if (reconcileRequestRef.current !== null) {
      window.cancelAnimationFrame(reconcileRequestRef.current);
      reconcileRequestRef.current = null;
    }
    const message = latestReconcileRef.current;
    latestReconcileRef.current = null;
    if (message) applyDesiredState(message);
  }, [applyDesiredState]);

  const runCommand = useCallback((message: Record<string, unknown>) => {
    if (message.type === "snapshot") {
      flushLatestReconcile();
      postSnapshot(message.requestId);
      return;
    }
    if (message.type === "frameContext") {
      flushLatestReconcile();
      postFrameContext(currentFrame());
      return;
    }
    if (message.type === "reconcile") {
      latestReconcileRef.current = message;
      if (reconcileRequestRef.current === null) {
        reconcileRequestRef.current = window.requestAnimationFrame(() => {
          reconcileRequestRef.current = null;
          const latest = latestReconcileRef.current;
          latestReconcileRef.current = null;
          if (latest) applyDesiredState(latest);
        });
      }
    }
  }, [applyDesiredState, currentFrame, flushLatestReconcile, postFrameContext, postSnapshot]);

  const ensurePlayerReady = useCallback(() => {
    const player = playerRef.current;
    if (!player) return false;

    if (!cleanupRef.current) {
      const onFrame = (event: Event) => {
        const detailFrame = (event as CustomEvent<{frame?: number}>).detail?.frame;
        postActualState("frameCommitted", detailFrame ?? player.getCurrentFrame());
      };
      const onSeeked = () => {
        seekingRef.current = false;
        const frame = clampFrame(player.getCurrentFrame());
        postActualState("seekSettled", frame);
        postFrameContext(frame);
      };
      const onPlay = () => {
        playingRef.current = true;
        bufferingRef.current = false;
        postActualState("playing");
      };
      const onPause = () => {
        playingRef.current = false;
        const frame = clampFrame(player.getCurrentFrame());
        postActualState("paused", frame);
        postFrameContext(frame);
      };
      const onWaiting = () => {
        bufferingRef.current = true;
        postActualState("buffering");
      };
      const onResume = () => {
        bufferingRef.current = false;
        postActualState("buffering");
      };
      const onVolumeChange = () => {
        mutedRef.current = player.isMuted?.() ?? mutedRef.current;
        volumeRef.current = player.getVolume?.() ?? volumeRef.current;
        postActualState();
      };
      const onMuteChange = () => {
        mutedRef.current = player.isMuted?.() ?? mutedRef.current;
        postActualState();
      };
      const onEnded = () => {
        playingRef.current = false;
        bufferingRef.current = false;
        seekingRef.current = false;
        postActualState("ended", composition.durationInFrames - 1);
        postFrameContext(composition.durationInFrames - 1);
      };
      const onError = (event: Event) => {
        const error = (event as CustomEvent<{error?: Error}>).detail?.error;
        post("error", {
          message: error instanceof Error ? error.message : String(error || "Player error"),
          revision: activeRevisionRef.current,
        });
      };
      player.addEventListener("frameupdate", onFrame as any);
      player.addEventListener("seeked", onSeeked as any);
      player.addEventListener("play", onPlay as any);
      player.addEventListener("pause", onPause as any);
      player.addEventListener("waiting", onWaiting as any);
      player.addEventListener("resume", onResume as any);
      player.addEventListener("volumechange", onVolumeChange as any);
      player.addEventListener("mutechange", onMuteChange as any);
      player.addEventListener("ended", onEnded as any);
      player.addEventListener("error", onError as any);
      cleanupRef.current = () => {
        player.removeEventListener("frameupdate", onFrame as any);
        player.removeEventListener("seeked", onSeeked as any);
        player.removeEventListener("play", onPlay as any);
        player.removeEventListener("pause", onPause as any);
        player.removeEventListener("waiting", onWaiting as any);
        player.removeEventListener("resume", onResume as any);
        player.removeEventListener("volumechange", onVolumeChange as any);
        player.removeEventListener("mutechange", onMuteChange as any);
        player.removeEventListener("ended", onEnded as any);
        player.removeEventListener("error", onError as any);
      };
    }

    const frame = clampFrame(player.getCurrentFrame?.() ?? initialFrame);
    if (!readyPostedRef.current) {
      const posted = post("ready", {
        ...actualPayload(frame),
        frame,
        durationInFrames: composition.durationInFrames,
        fps: composition.fps,
        width: composition.width,
        height: composition.height,
      });
      if (posted) {
        readyPostedRef.current = true;
        postFrameContext(frame);
        window.requestAnimationFrame(() => {
          postActualState("frameCommitted", clampFrame(player.getCurrentFrame()));
        });
      }
    }

    const pending = pendingCommandsRef.current.splice(0);
    pending.forEach(runCommand);
    return true;
  }, [actualPayload, initialFrame, postActualState, postFrameContext, runCommand]);

  useLayoutEffect(() => {
    postFrameContext(clampFrame(playerRef.current?.getCurrentFrame?.() ?? initialFrame));
  }, [initialFrame, postFrameContext]);

  useEffect(() => {
    const onConnect = (event: MessageEvent) => {
      const message = event.data || {};
      if (message.source !== "sparo-remotion-live") return;
      if (message.type !== "connect") return;
      if (message.protocolVersion !== protocolVersion) return;
      if (message.compositionId !== composition.id) return;
      if (message.projectRevision !== projectRevision) return;
      if (message.descriptorRevision !== composition.descriptorRevision) return;
      if (message.instanceId !== instanceId) return;
      if (!channelNonce || message.channelNonce !== channelNonce) return;
      const port = event.ports?.[0];
      if (!port) return;

      // Nested opaque frames in WebView2 may not preserve WindowProxy object
      // identity across postMessage. Authenticate the one-time connection with
      // the URL-bound nonce plus the complete immutable preview identity; the
      // transferred MessagePort is the capability used after this handshake.

      controlPort?.close();
      controlPort = port;
      controlPort.onmessage = (portEvent) => {
        const command = portEvent.data || {};
        if (command.source !== "sparo-remotion-live") return;
        if (command.protocolVersion !== protocolVersion) return;
        if (command.compositionId !== composition.id) return;
        if (command.projectRevision !== projectRevision) return;
        if (command.descriptorRevision !== composition.descriptorRevision) return;
        if (command.instanceId !== instanceId) return;
        if (command.channelNonce !== channelNonce) return;
        if (!ensurePlayerReady()) {
          if (command.type === "reconcile") {
            pendingCommandsRef.current = pendingCommandsRef.current.filter((item) => item.type !== "reconcile");
          }
          pendingCommandsRef.current.push(command);
          return;
        }
        runCommand(command);
      };
      controlPort.start();
      post("channelReady", {revision: activeRevisionRef.current});
      ensurePlayerReady();
    };
    window.addEventListener("message", onConnect);
    announceBootstrap();
    const bootstrapTimer = window.setInterval(() => {
      if (controlPort) {
        window.clearInterval(bootstrapTimer);
        return;
      }
      announceBootstrap();
    }, 250);
    return () => {
      window.clearInterval(bootstrapTimer);
      window.removeEventListener("message", onConnect);
      controlPort?.close();
      controlPort = null;
    };
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
      if (reconcileRequestRef.current !== null) {
        window.cancelAnimationFrame(reconcileRequestRef.current);
        reconcileRequestRef.current = null;
      }
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [ensurePlayerReady]);

  return (
    <div ref={stageRef} data-sparo-remotion-stage style={{width: "100%", height: "100%", position: "relative"}}>
      <Player
        ref={playerRef}
        component={Component}
        durationInFrames={composition.durationInFrames}
        fps={composition.fps}
        compositionWidth={composition.width}
        compositionHeight={composition.height}
        inputProps={resolvedProps}
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

function RegisteredPlayer() {
  const [registeredComposition, setRegisteredComposition] = useState<null | {component: React.ComponentType<Record<string, unknown>>}>(null);

  useEffect(() => {
    let attempts = 0;
    const findComposition = () => {
      attempts += 1;
      const selected = Internals.compositionsRef.current?.getCompositions().find((item) => item.id === composition.id);
      if (selected?.component) {
        setRegisteredComposition({component: selected.component as React.ComponentType<Record<string, unknown>>});
        return true;
      }
      if (attempts >= 400) {
        post("error", {message: "Timed out waiting for the registered Remotion composition."});
        return true;
      }
      return false;
    };
    if (findComposition()) return;
    const timer = window.setInterval(() => {
      if (findComposition()) window.clearInterval(timer);
    }, 25);
    return () => window.clearInterval(timer);
  }, []);

  if (!registeredComposition) return <div className="rl-player-loading">Loading composition...</div>;
  return <PlayerRuntime Component={registeredComposition.component} />;
}

function App() {
  if (!RegisteredRoot) {
    return <div className="rl-player-error">Remotion root was not registered by the project entry point.</div>;
  }
  return (
    <Internals.CompositionManagerProvider
      onlyRenderComposition={null}
      currentCompositionMetadata={null}
      initialCompositions={[]}
      initialCanvasContent={null}
    >
      <RegisteredRoot />
      <RegisteredPlayer />
    </Internals.CompositionManagerProvider>
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

async function bundlePlayerHost(workspacePath, projectRoot, manifest, bundleId) {
  const moduleRoot = projectRoot || workspacePath;
  const distDir = playerHostDistDir(workspacePath);
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  const entryPath = writePlayerHostEntry(workspacePath, manifest, bundleId);
  const webpack = require(resolveWorkspaceModule(workspacePath, "webpack", moduleRoot));
  const esbuild = require(resolveWorkspaceModule(workspacePath, "esbuild", moduleRoot));
  const esbuildLoaderPath = resolveRemotionBundlerLoader(workspacePath, moduleRoot);
  const config = {
    mode: "development",
    target: "web",
    context: moduleRoot,
    // Remotion's entry point is intentionally side-effectful: registerRoot() is
    // its public contract. Make it a real, ordered Webpack entry so package-level
    // `sideEffects` metadata cannot tree-shake the registration before the host
    // reads Internals.getRoot().
    entry: playerHostWebpackEntries(workspacePath, manifest, entryPath),
    devtool: false,
    output: {
      path: distDir,
      filename: "player-host.js",
      publicPath: "/",
      assetModuleFilename: "assets/[hash][ext][query]",
      clean: true,
    },
    resolve: {
      extensions: [".ts", ".tsx", ".web.js", ".js", ".jsx", ".mjs", ".cjs", ".json"],
      modules: [
        path.join(moduleRoot, "node_modules"),
        path.join(workspacePath, "node_modules"),
        "node_modules",
      ],
      alias: {
        "react/jsx-runtime$": resolveWorkspaceModule(workspacePath, "react/jsx-runtime", moduleRoot),
        "react/jsx-dev-runtime$": resolveWorkspaceModule(workspacePath, "react/jsx-dev-runtime", moduleRoot),
        "react-dom/client$": resolveWorkspaceModule(workspacePath, "react-dom/client", moduleRoot),
        "react-dom$": resolveWorkspaceModule(workspacePath, "react-dom", moduleRoot),
        "react$": resolveWorkspaceModule(workspacePath, "react", moduleRoot),
        "@remotion/player$": resolveWorkspaceModule(workspacePath, "@remotion/player", moduleRoot),
        "remotion/no-react$": path.resolve(resolveWorkspaceModule(workspacePath, "remotion", moduleRoot), "..", "..", "esm", "no-react.mjs"),
        "remotion/version$": path.resolve(resolveWorkspaceModule(workspacePath, "remotion", moduleRoot), "..", "..", "esm", "version.mjs"),
        "remotion$": path.resolve(resolveWorkspaceModule(workspacePath, "remotion", moduleRoot), "..", "..", "esm", "index.mjs"),
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
              remotionRoot: moduleRoot,
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
              remotionRoot: moduleRoot,
            },
          }],
        },
        {
          test: /\.css$/i,
          use: [
            resolveWorkspaceModule(workspacePath, "style-loader", moduleRoot),
            {
              loader: resolveWorkspaceModule(workspacePath, "css-loader", moduleRoot),
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
    <meta name="referrer" content="no-referrer" />
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
const artifactsRoot = path.resolve(process.argv[6]);
const parentPid = Number(process.argv[7]);
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
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".ogv": "video/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
  ".vtt": "text/vtt; charset=utf-8",
  ".srt": "application/x-subrip; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf"
};
function isInside(candidate, base) {
  const relative = path.relative(base, candidate);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
function resolveServedFile(requested, pathname) {
  if (pathname.startsWith("/artifacts/")) {
    const artifactPath = path.resolve(artifactsRoot, requested);
    if (isInside(artifactPath, artifactsRoot)) {
      try {
        const stat = fs.statSync(artifactPath);
        if (stat.isFile()) return {filePath: artifactPath, source: "artifact", stat};
      } catch {}
    }
    return null;
  }
  const distPath = path.resolve(root, requested);
  if (isInside(distPath, root)) {
    try {
      const stat = fs.statSync(distPath);
      if (stat.isFile()) return {filePath: distPath, source: "dist", stat};
    } catch {}
  }
  const publicPath = path.resolve(publicRoot, requested);
  if (isInside(publicPath, publicRoot)) {
    try {
      const stat = fs.statSync(publicPath);
      if (stat.isFile()) return {filePath: publicPath, source: "public", stat};
    } catch {}
  }
  return null;
}
const server = http.createServer((request, response) => {
  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "access-control-allow-headers": "Range",
        "access-control-max-age": "86400",
      });
      response.end();
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, {"content-type": "text/plain; charset=utf-8", "allow": "GET, HEAD, OPTIONS"});
      response.end("Method not allowed");
      return;
    }
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/health") {
      const body = JSON.stringify({ok: true});
      response.writeHead(200, {"content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store"});
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }
    const isArtifact = url.pathname.startsWith("/artifacts/");
    const requested = url.pathname === "/"
      ? "index.html"
      : decodeURIComponent(url.pathname.slice(isArtifact ? "/artifacts/".length : 1));
    const served = resolveServedFile(requested, url.pathname);
    if (!served) throw new Error("Not a file");
    const {filePath, source, stat} = served;
    const etag = '"' + stat.size.toString(16) + "-" + Math.trunc(stat.mtimeMs).toString(16) + '"';
    const lastModified = stat.mtime.toUTCString();
    const baseHeaders = {
      "content-type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": source === "artifact" ? "public, max-age=31536000, immutable" : source === "public" ? "no-cache" : "no-store",
      "accept-ranges": "bytes",
      "etag": etag,
      "last-modified": lastModified,
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified",
      "cross-origin-resource-policy": "cross-origin",
      "cross-origin-opener-policy": "same-origin-allow-popups",
    };
    const ifRange = request.headers["if-range"];
    let ifRangeMatches = !ifRange || ifRange === etag;
    if (!ifRangeMatches && ifRange) {
      const ifRangeDate = Date.parse(ifRange);
      ifRangeMatches = Number.isFinite(ifRangeDate) && stat.mtimeMs <= ifRangeDate + 999;
    }
    const range = ifRangeMatches ? request.headers.range : null;
    if (range) {
      const match = /^bytes=(\\d*)-(\\d*)$/.exec(range);
      if (!match) {
        response.writeHead(416, {...baseHeaders, "content-range": "bytes */" + stat.size});
        response.end();
        return;
      }
      const suffixLength = match[1] === "" ? Number(match[2]) : null;
      const start = suffixLength !== null ? Math.max(0, stat.size - suffixLength) : Number(match[1]);
      const end = suffixLength !== null || match[2] === "" ? stat.size - 1 : Math.min(stat.size - 1, Number(match[2]));
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= stat.size) {
        response.writeHead(416, {...baseHeaders, "content-range": "bytes */" + stat.size});
        response.end();
        return;
      }
      response.writeHead(206, {
        ...baseHeaders,
        "content-range": "bytes " + start + "-" + end + "/" + stat.size,
        "content-length": end - start + 1,
      });
      if (request.method === "HEAD") response.end();
      else fs.createReadStream(filePath, {start, end}).pipe(response);
      return;
    }
    response.writeHead(200, {...baseHeaders, "content-length": stat.size});
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(404, {"content-type": "text/plain; charset=utf-8"});
    response.end("Not found");
  }
});
server.listen(port, "127.0.0.1", () => log("Player host listening on 127.0.0.1:" + port));
function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
function parentIsAlive() {
  if (!Number.isInteger(parentPid) || parentPid <= 0) return false;
  try {
    process.kill(parentPid, 0);
    return true;
  } catch {
    return false;
  }
}
const parentWatch = setInterval(() => {
  if (!parentIsAlive()) shutdown();
}, 2000);
parentWatch.unref();
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
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
    projectRevision: state.projectRevision,
    descriptorRevision: state.descriptorRevision,
    buildId: state.buildId,
    bundleId: state.bundleId,
    runtimeVersion: state.runtimeVersion,
    protocolVersion: state.protocolVersion,
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

function spawnPlayerHostServer(workspacePath, projectRoot, distDir, port, stateBase) {
  const serverPath = ensurePlayerHostServerScript(workspacePath);
  const logPath = playerHostLogPath(workspacePath);
  const runtimeCwd = projectRoot || workspacePath;
  const publicDir = path.join(runtimeCwd, "public");
  const artifactsDir = artifactRoot(workspacePath);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] Starting Remotion Player host on 127.0.0.1:${port}\n`, "utf8");
  if (process.platform === "win32") {
    const psArgs = [serverPath, distDir, String(port), logPath, publicDir, artifactsDir, String(process.pid)].map(psQuote).join(", ");
    const psScript = [
      `$p = Start-Process -FilePath ${psQuote(process.execPath)} -ArgumentList @(${psArgs}) -WorkingDirectory ${psQuote(runtimeCwd)} -WindowStyle Hidden -PassThru`,
      "$p.Id",
    ].join("; ");
    const launch = spawnSync("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      psScript,
    ], {
      cwd: runtimeCwd,
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
    return { ...stateBase, pid, serverPid: pid, parentPid: process.pid, launcher: "powershell-start-process", logPath, publicDir, artifactsDir };
  }
  const child = spawn(process.execPath, [serverPath, distDir, String(port), logPath, publicDir, artifactsDir, String(process.pid)], {
    cwd: runtimeCwd,
    detached: false,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  return { ...stateBase, pid: child.pid, serverPid: child.pid, parentPid: process.pid, launcher: "node-child", logPath, publicDir, artifactsDir };
}

async function ensurePlayerPreviewHostResolved(input, resolved) {
  const { workspacePath, projectRoot, manifest, composition, frame } = resolved;
  if (manifest.schemaVersion !== RUNTIME_SCHEMA_VERSION || !manifest.entryPoint) {
    throw new Error("Cannot start Player preview without a current compiled project snapshot.");
  }

  const bundleId = playerHostBundleId(manifest);
  const existing = readPlayerHostState(workspacePath);
  const existingStatus = await playerHostStatusForState(workspacePath, existing);
  const force = input.force === true;
  const sameRuntime = existing?.runtimeVersion === PLAYER_HOST_RUNTIME_VERSION;
  const sameBundle = sameRuntime && existing?.bundleId === bundleId && existing?.buildId === manifest.buildId;

  if (!force && sameBundle && existingStatus.ready) {
    const revisionState = {
      projectRevision: manifest.projectRevision || manifest.sourceRevision,
      descriptorRevision: composition.descriptorRevision || manifest.descriptorRevision,
    };
    writePlayerHostState(workspacePath, { ...existing, ...revisionState, compositionId: composition.id });
    return {
      ...existingStatus,
      ...revisionState,
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

  const reusableDist = !force
    && sameBundle
    && existing?.distDir
    && fs.existsSync(path.join(existing.distDir, "index.html"))
    && fs.existsSync(path.join(existing.distDir, "player-host.js"));
  const { distDir, entryPath } = reusableDist
    ? { distDir: existing.distDir, entryPath: existing.entryPath }
    : await bundlePlayerHost(workspacePath, projectRoot, manifest, bundleId);
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
    bundleReused: reusableDist,
    compositionId: composition.id,
    projectRevision: manifest.projectRevision || manifest.sourceRevision,
    descriptorRevision: composition.descriptorRevision || manifest.descriptorRevision,
    buildId: manifest.buildId,
    bundleId,
    runtimeVersion: PLAYER_HOST_RUNTIME_VERSION,
    protocolVersion: PLAYER_CONTROL_PROTOCOL_VERSION,
    workspacePath,
    projectRoot,
    distDir,
    entryPath,
    startedAt: Date.now(),
  };
  const state = spawnPlayerHostServer(workspacePath, projectRoot, distDir, port, stateBase);
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

async function ensurePlayerPreviewHost(input = {}) {
  const resolved = await compositionForInput(input);
  const revision = resolved.manifest.buildId || resolved.manifest.descriptorRevision || resolved.manifest.sourceRevision;
  const flightKey = `${resolved.workspacePath}:${revision}:${input.force === true ? 'force' : 'reuse'}`;
  let flight = playerHostFlights.get(flightKey);
  if (!flight) {
    const previous = playerHostWorkspaceTails.get(resolved.workspacePath) || Promise.resolve();
    flight = previous
      .catch(() => {})
      .then(() => ensurePlayerPreviewHostResolved(input, resolved))
      .finally(() => {
        if (playerHostFlights.get(flightKey) === flight) playerHostFlights.delete(flightKey);
        if (playerHostWorkspaceTails.get(resolved.workspacePath) === flight) {
          playerHostWorkspaceTails.delete(resolved.workspacePath);
        }
      });
    playerHostFlights.set(flightKey, flight);
    playerHostWorkspaceTails.set(resolved.workspacePath, flight);
  }

  const result = await flight;
  const baseUrl = result.baseUrl || result.url;
  return {
    ...result,
    compositionId: resolved.composition.id,
    composition: resolved.composition,
    frame: resolved.frame,
    url: `${baseUrl}?compositionId=${encodeURIComponent(resolved.composition.id)}&frame=${resolved.frame}`,
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
  playerHostProjectEntryPath,
  playerHostWebpackEntries,
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
