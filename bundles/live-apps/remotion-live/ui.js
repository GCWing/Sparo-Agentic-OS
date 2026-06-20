const ROUTES = new Set(['/preview']);

const PLAYER_HOST_RUNTIME_VERSION = 4;
const PREVIEW_FRAME_CACHE_LIMIT = 96;
const PREVIEW_CLIP_CACHE_LIMIT = 12;
const previewFrameCache = new Map();
const previewClipCache = new Map();

const MESSAGES = {
  'en-US': {
    title: 'Remotion Live',
    refresh: 'Refresh',
    sendContext: 'Send context',
    noWorkspace: 'Open a workspace to inspect a Remotion project.',
    loadingProject: 'Reading project',
    projectReady: 'Project ready',
    projectMissing: 'No Remotion project detected',
    backendMissing: 'Remotion runtime backend is unavailable',
    composition: 'Composition',
    frame: 'Frame',
    play: 'Play',
    pause: 'Pause',
    previous: 'Previous frame',
    next: 'Next frame',
    renderStill: 'Render still',
    exportVideo: 'Export',
    preview: 'Preview',
    timeline: 'Timeline',
    renderingFrame: 'Rendering frame',
    preparingPlayback: 'Preparing playback',
    startingPlayer: 'Starting Remotion Player',
    playerUnavailable: 'Player preview is not ready',
    startingStudio: 'Starting Remotion Studio',
    studioPreview: 'Remotion Studio preview',
    studioUnavailable: 'Remotion Studio is not ready',
    openStudio: 'Open Studio',
    restartStudio: 'Restart Studio',
    stopStudio: 'Stop Studio',
    previewUnavailable: 'Preview frame unavailable',
    playbackUnavailable: 'Playback unavailable',
    cached: 'cached',
    rendered: 'rendered',
    duration: '{{frames}} frames',
    fps: '{{fps}} fps',
    resolution: '{{width}} x {{height}}',
    entry: 'Entry',
    root: 'Root',
    packageManager: 'Package manager',
    version: 'Remotion',
    noCompositions: 'No compositions found.',
    noLayers: 'No frame layers returned yet.',
    sequences: 'Sequences',
    layers: 'Layers',
    files: 'Files',
    output: 'Output',
    status: 'Status',
    activeFrame: 'Active frame',
    askPrompt:
      'Use the current Remotion Live context. Project: {{project}}. Composition: {{composition}}. Frame: {{frame}}. Route: {{route}}. Workspace: {{workspace}}. Recommend the next edit and validation step.',
  },
  'zh-CN': {
    title: 'Remotion Live',
    refresh: '刷新',
    sendContext: '发送上下文',
    noWorkspace: '打开工作区后即可检查 Remotion 项目。',
    loadingProject: '正在读取项目',
    projectReady: '项目已就绪',
    projectMissing: '未检测到 Remotion 项目',
    backendMissing: 'Remotion 运行后端不可用',
    composition: 'Composition',
    frame: '帧',
    play: '播放',
    pause: '暂停',
    previous: '上一帧',
    next: '下一帧',
    renderStill: '渲染静帧',
    exportVideo: '导出',
    preview: '预览',
    timeline: '时间线',
    renderingFrame: '正在渲染帧',
    preparingPlayback: '正在准备播放',
    previewUnavailable: '预览帧不可用',
    playbackUnavailable: '播放不可用',
    duration: '{{frames}} 帧',
    fps: '{{fps}} fps',
    resolution: '{{width}} x {{height}}',
    entry: '入口',
    root: 'Root',
    packageManager: '包管理器',
    version: 'Remotion',
    noCompositions: '未发现 Composition。',
    noLayers: '当前帧暂无图层模型。',
    sequences: 'Sequences',
    layers: '图层',
    files: '文件',
    output: '输出',
    status: '状态',
    activeFrame: '当前帧',
    askPrompt:
      '请基于当前 Remotion Live 上下文协作。项目：{{project}}。Composition：{{composition}}。Frame：{{frame}}。Route：{{route}}。Workspace：{{workspace}}。请建议下一处编辑和验证步骤。',
  },
};

const state = {
  locale: navigator.language || 'en-US',
  route: normalizeRoute(document.documentElement.dataset.route || '/preview'),
  tabId: null,
  sessionId: null,
  workspacePath: null,
  loading: false,
  error: null,
  status: 'idle',
  project: null,
  manifest: null,
  activeCompositionId: null,
  frame: 0,
  frameModel: null,
  previewFrame: null,
  previewLoading: false,
  previewError: null,
  previewInFlightKey: null,
  previewQueuedKey: null,
  previewScale: 1,
  previewClip: null,
  previewClipLoading: false,
  previewClipError: null,
  previewClipInFlightKey: null,
  previewClipScale: 0.25,
  previewClipSeconds: 3,
  previewMode: 'player',
  playerHost: null,
  playerHostLoading: false,
  playerHostError: null,
  playerHostPollTimer: null,
  playerRuntimeReady: false,
  playerPendingCommand: null,
  playerHandshakeTimer: null,
  playerCommandFallbackTimer: null,
  playerControlEpoch: 0,
  playerReloadNonce: 0,
  playerRuntimeFrame: null,
  playerRuntimePlaying: false,
  previewServer: null,
  previewServerLoading: false,
  previewServerError: null,
  previewServerPollTimer: null,
  frameTouched: false,
  playing: false,
  playTimer: null,
  selectionGuard: false,
  selectionPointerDown: false,
  renderQueued: false,
  lastStill: null,
  tlZoom: 1,
};

function cacheGet(cache, key) {
  if (!key || !cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function cacheSet(cache, key, value, limit) {
  if (!key || !value) return value;
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  return value;
}

function runtime() {
  return window.app || {};
}

function messages() {
  return MESSAGES[state.locale] || MESSAGES[state.locale.split('-')[0]] || MESSAGES['en-US'];
}

function t(key, params = {}) {
  const template = messages()[key] || MESSAGES['en-US'][key] || key;
  return Object.entries(params).reduce(
    (value, [name, replacement]) => value.replaceAll(`{{${name}}}`, String(replacement ?? '')),
    template,
  );
}

function normalizeRoute(route) {
  const normalized = String(route || '/preview').trim() || '/preview';
  return ROUTES.has(normalized) ? normalized : '/preview';
}

function routeKey(route = state.route) {
  return normalizeRoute(route).replace('/', '') || 'preview';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function currentComposition() {
  const compositions = asArray(state.manifest?.compositions);
  return compositions.find((item) => item.id === state.activeCompositionId) || compositions[0] || null;
}

function compositionDuration(composition = currentComposition()) {
  return Math.max(1, Number(composition?.durationInFrames || composition?.duration || 1));
}

function defaultPreviewFrame(composition = currentComposition()) {
  const duration = compositionDuration(composition);
  if (duration <= 1) return 0;
  return clamp(Math.round(duration * 0.25), 0, duration - 1);
}

function previewFrameKey(composition = currentComposition(), frame = state.frame, scale = state.previewScale) {
  if (!composition) return '';
  return `${state.manifest?.buildId || 'build'}:${composition.id}:${Math.round(Number(frame) || 0)}:${scale}`;
}

function previewClipKey(composition = currentComposition(), frame = state.frame, scale = state.previewClipScale) {
  if (!composition) return '';
  return `${state.manifest?.buildId || 'build'}:${composition.id}:${Math.round(Number(frame) || 0)}:${scale}:${state.previewClipSeconds}`;
}

function useStudioPreview() {
  return state.previewMode === 'studio-iframe';
}

function usePlayerPreview() {
  return state.previewMode === 'player';
}

function studioPreviewReady() {
  return useStudioPreview() && state.previewServer?.ready && state.previewServer?.url;
}

function playerPreviewReady() {
  return usePlayerPreview()
    && state.playerHost?.ready
    && state.playerHost?.url
    && state.playerHost?.runtimeVersion === PLAYER_HOST_RUNTIME_VERSION;
}

function resetPlayerRuntimeState() {
  state.playerRuntimeReady = false;
  state.playerPendingCommand = null;
  state.playerRuntimeFrame = null;
  state.playerRuntimePlaying = false;
  if (state.playerHandshakeTimer) {
    clearTimeout(state.playerHandshakeTimer);
    state.playerHandshakeTimer = null;
  }
  if (state.playerCommandFallbackTimer) {
    clearTimeout(state.playerCommandFallbackTimer);
    state.playerCommandFallbackTimer = null;
  }
}

function projectName() {
  return state.project?.projectName || state.project?.name || 'Remotion';
}

function workspaceLabel() {
  const path = state.workspacePath || '';
  if (!path) return '-';
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function rootElement() {
  return document.getElementById('remotionLiveRoot');
}

function asElement(node) {
  if (!node) return null;
  return node.nodeType === 1 ? node : node.parentElement || null;
}

function nodeInsideRoot(node) {
  const root = rootElement();
  if (!root || !node) return false;
  const element = asElement(node);
  return Boolean(element && root.contains(element));
}

function closestElement(target, selector) {
  const element = asElement(target);
  return typeof element?.closest === 'function' ? element.closest(selector) : null;
}

function hasLiveTextSelection() {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  if (!nodeInsideRoot(selection.anchorNode) && !nodeInsideRoot(selection.focusNode)) return false;
  return selection.toString().trim().length > 0;
}

function isSelectionStartTarget(target) {
  const element = asElement(target);
  if (!element || !nodeInsideRoot(element)) return false;
  return !element.closest('button,input,select,textarea,[contenteditable="true"],[data-action]');
}

function stopPlaybackTimer() {
  if (state.playTimer) {
    clearInterval(state.playTimer);
    state.playTimer = null;
  }
}

function pausePlaybackForSelection() {
  if (!state.playing && !state.playTimer) return;
  state.playing = false;
  stopPlaybackTimer();
  state.renderQueued = true;
}

function shouldDeferRenderForSelection() {
  return state.selectionPointerDown || state.selectionGuard || hasLiveTextSelection();
}

function releaseSelectionGuard() {
  if (state.selectionPointerDown || hasLiveTextSelection()) return;
  state.selectionGuard = false;
  if (state.renderQueued) {
    render();
  }
}

function scheduleSelectionGuardRelease() {
  window.setTimeout(releaseSelectionGuard, 0);
}

function setLoading(loading, status = null) {
  state.loading = loading;
  if (status) state.status = status;
  render();
}

function setError(error) {
  state.error = error ? String(error.message || error) : null;
  if (error) state.status = 'error';
  render();
}

function playerHostOrigin() {
  try {
    const url = state.playerHost?.baseUrl || state.playerHost?.url;
    return url ? new URL(url).origin : '*';
  } catch {
    return '*';
  }
}

function playerFrameNode() {
  return document.querySelector('.rl-player-frame');
}

function playerHostUrl(options = {}) {
  const host = state.playerHost;
  const composition = currentComposition();
  if (!host?.url || !composition) return '';
  try {
    const url = new URL(host.baseUrl || host.url);
    url.searchParams.set('compositionId', composition.id);
    url.searchParams.set('frame', String(Math.round(Number(state.frame) || 0)));
    if (options.autoplay ?? state.playing) url.searchParams.set('autoplay', '1');
    else url.searchParams.delete('autoplay');
    if (options.cacheBust || state.playerReloadNonce) {
      url.searchParams.set('_rl', String(state.playerReloadNonce));
    }
    return url.toString();
  } catch {
    return host.url;
  }
}

function postPlayerMessage(type, payload = {}, options = {}) {
  const composition = currentComposition();
  const node = playerFrameNode();
  if (!composition || !node?.contentWindow || !playerPreviewReady()) return false;
  if (options.requireReady !== false && !state.playerRuntimeReady) return false;
  node.contentWindow.postMessage({
    source: 'sparo-remotion-live',
    type,
    compositionId: composition.id,
    ...payload,
  }, playerHostOrigin());
  return true;
}

function requestPlayerHandshake(attempt = 0) {
  if (!playerPreviewReady()) return;
  postPlayerMessage('ping', { frame: state.frame }, { requireReady: false });
  if (state.playerRuntimeReady || attempt >= 16) return;
  if (state.playerHandshakeTimer) clearTimeout(state.playerHandshakeTimer);
  state.playerHandshakeTimer = window.setTimeout(() => {
    state.playerHandshakeTimer = null;
    requestPlayerHandshake(attempt + 1);
  }, attempt < 4 ? 80 : 250);
}

function reloadPlayerIframe(options = {}) {
  if (!playerPreviewReady()) return false;
  const node = playerFrameNode();
  if (!node) {
    render();
    return false;
  }
  state.playerReloadNonce += 1;
  state.playerRuntimeReady = false;
  state.playerRuntimeFrame = null;
  state.playerRuntimePlaying = false;
  node.src = playerHostUrl({
    autoplay: options.autoplay ?? state.playing,
    cacheBust: true,
  });
  requestPlayerHandshake();
  return true;
}

function clearPlayerCommandFallback() {
  if (!state.playerCommandFallbackTimer) return;
  clearTimeout(state.playerCommandFallbackTimer);
  state.playerCommandFallbackTimer = null;
}

function schedulePlayerCommandFallback(type, payload = {}) {
  if (!usePlayerPreview() || !playerPreviewReady()) return;
  clearPlayerCommandFallback();

  const epoch = ++state.playerControlEpoch;
  const retryPayload = {
    ...payload,
    frame: payload.frame ?? state.frame,
  };
  const retryCommand = () => {
    void pollPlayerPreviewHostStatus();
    postPlayerMessage(type, retryPayload, { requireReady: false });
    requestPlayerHandshake();
  };

  if (type === 'pause') {
    state.playerCommandFallbackTimer = window.setTimeout(() => {
      state.playerCommandFallbackTimer = null;
      if (epoch !== state.playerControlEpoch || !playerPreviewReady()) return;
      if (!state.playing && state.playerRuntimePlaying) {
        retryCommand();
      }
    }, 260);
    return;
  }

  if (type !== 'seek' && type !== 'play') return;

  const expectedFrame = clamp(Number(payload.frame ?? state.frame) || 0, 0, compositionDuration() - 1);
  const startRuntimeFrame = Number(state.playerRuntimeFrame);
  const hasStartRuntimeFrame = Number.isFinite(startRuntimeFrame);
  const delay = type === 'play' ? 700 : 300;
  state.playerCommandFallbackTimer = window.setTimeout(() => {
    state.playerCommandFallbackTimer = null;
    if (epoch !== state.playerControlEpoch || !playerPreviewReady()) return;
    const runtimeFrame = Number(state.playerRuntimeFrame);
    const hasRuntimeFrame = Number.isFinite(runtimeFrame);
    if (type === 'seek') {
      if (!hasRuntimeFrame || Math.abs(runtimeFrame - expectedFrame) > 1) {
        retryCommand();
      }
      return;
    }
    if (!state.playing) return;
    const baselineFrame = hasStartRuntimeFrame ? Math.max(expectedFrame, startRuntimeFrame) : expectedFrame;
    const advanced = hasRuntimeFrame && runtimeFrame > baselineFrame + 1;
    if (!advanced) {
      retryCommand();
    }
  }, delay);
}

function queuePlayerCommand(type, payload = {}) {
  state.playerPendingCommand = {
    type,
    payload: {
      ...payload,
      frame: payload.frame ?? state.frame,
    },
  };
}

function sendOrQueuePlayerCommand(type, payload = {}) {
  if (postPlayerMessage(type, payload)) {
    schedulePlayerCommandFallback(type, payload);
    return true;
  }
  queuePlayerCommand(type, payload);
  if (!playerPreviewReady() && state.workspacePath && currentComposition()) {
    void ensurePlayerPreviewHost();
  } else {
    requestPlayerHandshake();
    schedulePlayerCommandFallback(type, payload);
  }
  return false;
}

function flushPlayerCommand() {
  if (!state.playerRuntimeReady) return;
  if (state.playerHandshakeTimer) {
    clearTimeout(state.playerHandshakeTimer);
    state.playerHandshakeTimer = null;
  }
  const pending = state.playerPendingCommand;
  state.playerPendingCommand = null;
  if (pending) {
    if (postPlayerMessage(pending.type, pending.payload)) {
      schedulePlayerCommandFallback(pending.type, pending.payload);
    } else {
      queuePlayerCommand(pending.type, pending.payload);
    }
    return;
  }
  if (state.playing) {
    postPlayerMessage('play', { frame: state.frame });
  } else if (state.playerRuntimePlaying) {
    postPlayerMessage('pause', { frame: state.frame });
  } else {
    postPlayerMessage('seek', { frame: state.frame });
  }
}

function timelineFramePercent(frame = state.frame, composition = currentComposition()) {
  const duration = compositionDuration(composition);
  if (duration <= 1) return 0;
  return Math.min(100, Math.max(0, (Number(frame) || 0) * (100 / (duration - 1))));
}

function syncFrameDom() {
  const composition = currentComposition();
  const duration = compositionDuration(composition);
  const fps = Number(composition?.fps || 30);
  const frame = clamp(Number(state.frame) || 0, 0, duration - 1);
  const percent = timelineFramePercent(frame, composition);
  document.querySelectorAll('input[data-action="frame-number"], input[data-action="frame-range"]').forEach((node) => {
    node.value = String(frame);
  });
  const timecode = document.querySelector('.rl-transport__tc');
  if (timecode) timecode.textContent = formatSMPTE(frame, fps);
  const framePill = document.querySelector('.rl-stage-pill--br');
  if (framePill) framePill.textContent = `F ${frame}`;
  document.querySelectorAll('.rl-tl-playhead, .rl-tl-vline').forEach((node) => {
    node.style.left = `${percent}%`;
  });
}

function syncPlayingDom() {
  const button = document.querySelector('.rl-play-btn[data-action="toggle-play"]');
  if (!button) return;
  button.classList.toggle('is-playing', Boolean(state.playing));
  button.setAttribute('aria-label', state.playing ? t('pause') : t('play'));
  button.innerHTML = state.playing ? ICONS.pause : ICONS.play;
}

function syncPlayerRuntimeDom() {
  if (!state.playerRuntimeReady || state.playerHostLoading) return;
  document.querySelectorAll('.rl-player-runtime-overlay').forEach((node) => node.remove());
}

function setPlayingState(playing) {
  state.playing = Boolean(playing);
  syncPlayingDom();
}

function syncFrameFromPlayer(frame) {
  const composition = currentComposition();
  const duration = compositionDuration(composition);
  const nextFrame = clamp(Math.round(Number(frame) || 0), 0, duration - 1);
  state.playerRuntimeFrame = nextFrame;
  state.frame = nextFrame;
  state.frameTouched = true;
  syncFrameDom();
}

function bridgeOutput(result) {
  if (result?.bridgeResult?.output !== undefined) return result.bridgeResult.output;
  if (result?.output !== undefined) return result.output;
  return result;
}

async function callBackend(action, input = {}) {
  const host = runtime();
  if (!host.backend?.call) throw new Error(t('backendMissing'));
  const result = await host.backend.call(
    `remotionRuntime.${action}`,
    {
      workspacePath: state.workspacePath,
      ...input,
    },
    {
      entityId: state.workspacePath || 'default',
      idempotencyKey: `remotion-live-${action}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
  );
  if (result?.bridgeResult) return bridgeOutput(result);
  if (!result?.actionRunId || !host.backend?.status) return bridgeOutput(result);

  const startedAt = Date.now();
  while (Date.now() - startedAt < 60000) {
    const status = await host.backend.status(result.actionRunId, {
      sessionId: result.sessionId,
      turnId: result.turnId,
    });
    if (status?.status === 'completed') return bridgeOutput(status);
    if (status?.status === 'failed' || status?.status === 'cancelled') {
      throw new Error(status?.message || status?.stderr || status?.status);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Backend action timed out: ${action}`);
}

function normalizeManifest(output) {
  return output?.manifest || output?.compositionManifest || output || { compositions: [] };
}

function applyProjectOutput(output) {
  const previousBuildId = state.manifest?.buildId || null;
  state.project = output?.project || output?.detection || output || null;
  state.manifest = normalizeManifest(output);
  const nextBuildId = state.manifest?.buildId || null;
  if (previousBuildId && nextBuildId && previousBuildId !== nextBuildId) {
    previewFrameCache.clear();
    previewClipCache.clear();
    state.previewFrame = null;
    state.previewClip = null;
  }
  const firstComposition = currentComposition();
  if (!state.activeCompositionId && firstComposition) {
    state.activeCompositionId = firstComposition.id;
    state.frame = defaultPreviewFrame(firstComposition);
    state.frameTouched = false;
  } else if (!state.frameTouched && firstComposition) {
    state.frame = defaultPreviewFrame(firstComposition);
  }
}

async function refreshProject() {
  if (!state.workspacePath) {
    state.project = null;
    state.manifest = null;
    state.status = 'no-workspace';
    render();
    return;
  }

  setLoading(true, t('loadingProject'));
  try {
    const output = await callBackend('compileProject');
    applyProjectOutput(output);
    state.status = asArray(state.manifest?.compositions).length ? t('projectReady') : t('projectMissing');
    state.error = null;
    if (state.route === '/preview' && usePlayerPreview()) {
      void ensurePlayerPreviewHost();
    } else if (state.route === '/preview' && useStudioPreview()) {
      void ensurePreviewServer();
    }
    await evaluateCurrentFrame();
  } catch (error) {
    setError(error);
  } finally {
    setLoading(false);
  }
}

function clearPlayerHostPoll() {
  if (!state.playerHostPollTimer) return;
  clearTimeout(state.playerHostPollTimer);
  state.playerHostPollTimer = null;
}

function schedulePlayerHostPoll(delayMs = 1200) {
  clearPlayerHostPoll();
  state.playerHostPollTimer = window.setTimeout(() => {
    state.playerHostPollTimer = null;
    void pollPlayerPreviewHostStatus();
  }, delayMs);
}

function playerHostSignature(host) {
  if (!host) return '';
  return [
    host.status || '',
    host.ready ? '1' : '0',
    host.baseUrl || host.url || '',
    host.pid || '',
    host.serverPid || '',
    host.bundleId || '',
    host.runtimeVersion || '',
    host.health?.reachable ? '1' : '0',
    host.health?.statusCode || '',
    host.health?.error || '',
  ].join('|');
}

function applyPlayerHostOutput(output) {
  const previousSignature = playerHostSignature(state.playerHost);
  const previousUrl = state.playerHost?.baseUrl || state.playerHost?.url || null;
  const nextUrl = output?.baseUrl || output?.url || null;
  state.playerHost = output || null;
  if (previousUrl !== nextUrl) {
    state.playerRuntimeReady = false;
  }
  if (output?.ready && output?.runtimeVersion === PLAYER_HOST_RUNTIME_VERSION) {
    state.playerHostError = null;
    schedulePlayerHostPoll(2500);
  } else if (output?.ready) {
    state.playerHostError = 'Player host runtime is stale. Restarting preview...';
    clearPlayerHostPoll();
    if (state.route === '/preview' && currentComposition()) {
      window.setTimeout(() => ensurePlayerPreviewHost(true), 0);
    }
  } else if (output?.status === 'starting') {
    schedulePlayerHostPoll();
  } else {
    clearPlayerHostPoll();
  }
  return previousSignature !== playerHostSignature(state.playerHost);
}

async function ensurePlayerPreviewHost(force = false) {
  const composition = currentComposition();
  if (!state.workspacePath || !composition || !usePlayerPreview()) return;
  state.playerHostLoading = true;
  state.playerHostError = null;
  render();
  try {
    const output = await callBackend('ensurePlayerPreviewHost', {
      compositionId: composition.id,
      frame: state.frame,
      force,
      waitMs: 60000,
    });
    applyPlayerHostOutput(output);
  } catch (error) {
    state.playerHostError = String(error.message || error);
    clearPlayerHostPoll();
  } finally {
    state.playerHostLoading = false;
    render();
  }
}

async function pollPlayerPreviewHostStatus() {
  if (!state.workspacePath || !usePlayerPreview()) return;
  let shouldRender = false;
  try {
    const output = await callBackend('getPlayerPreviewHostStatus');
    shouldRender = applyPlayerHostOutput(output);
    if (state.route === '/preview' && currentComposition() && output?.status === 'stopped') {
      void ensurePlayerPreviewHost(true);
    }
  } catch (error) {
    state.playerHostError = String(error.message || error);
    clearPlayerHostPoll();
    shouldRender = true;
  } finally {
    if (shouldRender) render();
  }
}

async function stopPlayerPreviewHost() {
  if (!state.workspacePath) return;
  clearPlayerHostPoll();
  state.playerHostLoading = true;
  render();
  try {
    const output = await callBackend('stopPlayerPreviewHost');
    state.playerHost = output;
    state.playerHostError = null;
  } catch (error) {
    state.playerHostError = String(error.message || error);
  } finally {
    state.playerHostLoading = false;
    render();
  }
}

function clearPreviewServerPoll() {
  if (!state.previewServerPollTimer) return;
  clearTimeout(state.previewServerPollTimer);
  state.previewServerPollTimer = null;
}

function schedulePreviewServerPoll(delayMs = 2000) {
  clearPreviewServerPoll();
  state.previewServerPollTimer = window.setTimeout(() => {
    state.previewServerPollTimer = null;
    void pollPreviewServerStatus();
  }, delayMs);
}

function applyPreviewServerOutput(output) {
  state.previewServer = output || null;
  if (output?.ready) {
    state.previewServerError = null;
    clearPreviewServerPoll();
  } else if (output?.status === 'starting') {
    schedulePreviewServerPoll();
  }
}

async function ensurePreviewServer(force = false) {
  if (!state.workspacePath || !useStudioPreview()) return;
  state.previewServerLoading = true;
  state.previewServerError = null;
  render();
  try {
    const output = await callBackend('ensurePreviewServer', {
      force,
      waitMs: 0,
    });
    applyPreviewServerOutput(output);
  } catch (error) {
    state.previewServerError = String(error.message || error);
    clearPreviewServerPoll();
  } finally {
    state.previewServerLoading = false;
    render();
  }
}

async function pollPreviewServerStatus() {
  if (!state.workspacePath || !useStudioPreview()) return;
  try {
    const output = await callBackend('getPreviewServerStatus');
    applyPreviewServerOutput(output);
  } catch (error) {
    state.previewServerError = String(error.message || error);
    clearPreviewServerPoll();
  } finally {
    render();
  }
}

async function stopPreviewServer() {
  if (!state.workspacePath) return;
  clearPreviewServerPoll();
  state.previewServerLoading = true;
  render();
  try {
    const output = await callBackend('stopPreviewServer');
    state.previewServer = output;
    state.previewServerError = null;
  } catch (error) {
    state.previewServerError = String(error.message || error);
  } finally {
    state.previewServerLoading = false;
    render();
  }
}

async function evaluateCurrentFrame() {
  const composition = currentComposition();
  if (!composition || !state.workspacePath) {
    state.frameModel = null;
    state.previewFrame = null;
    state.previewClip = null;
    state.previewError = null;
    state.previewClipError = null;
    render();
    return;
  }
  const frame = clamp(Number(state.frame) || 0, 0, compositionDuration(composition) - 1);
  state.frame = frame;
  try {
    state.frameModel = await callBackend('evaluateFrame', {
      compositionId: composition.id,
      frame,
    });
    state.error = null;
  } catch (error) {
    state.frameModel = null;
    state.error = String(error.message || error);
  }
  render();
  if (!useStudioPreview() && !usePlayerPreview()) {
    void requestPreviewFrame();
  } else if (usePlayerPreview() && !playerPreviewReady()) {
    void requestPreviewFrame();
  }
}

async function requestPreviewFrame(force = false) {
  const composition = currentComposition();
  if (!composition || !state.workspacePath) return;

  const key = previewFrameKey(composition);
  if (!force) {
    const cachedFrame = cacheGet(previewFrameCache, key);
    if (cachedFrame?.dataUrl) {
      state.previewFrame = cachedFrame;
      state.previewLoading = false;
      state.previewError = null;
      render();
      return cachedFrame;
    }
  }
  if (!force && state.previewFrame?.key === key && state.previewFrame?.dataUrl) return;
  if (state.previewInFlightKey) {
    state.previewQueuedKey = key;
    return;
  }

  state.previewInFlightKey = key;
  state.previewLoading = true;
  state.previewError = null;
  render();

  try {
    const output = await callBackend('renderPreviewFrame', {
      compositionId: composition.id,
      frame: state.frame,
      scale: state.previewScale,
      force,
    });

    const cachedOutput = cacheSet(
      previewFrameCache,
      key,
      { ...output, key },
      PREVIEW_FRAME_CACHE_LIMIT,
    );

    if (previewFrameKey() === key) {
      state.previewFrame = cachedOutput;
      state.previewError = null;
      return state.previewFrame;
    }
  } catch (error) {
    if (previewFrameKey() === key) {
      state.previewError = String(error.message || error);
    }
  } finally {
    state.previewInFlightKey = null;
    state.previewLoading = false;
    render();

    if (state.previewQueuedKey && state.previewQueuedKey !== state.previewFrame?.key) {
      state.previewQueuedKey = null;
      void requestPreviewFrame();
    } else {
      state.previewQueuedKey = null;
    }
  }
}

async function requestPreviewClip(force = false) {
  const composition = currentComposition();
  if (!composition || !state.workspacePath) return null;

  const key = previewClipKey(composition);
  if (!force) {
    const cachedClip = cacheGet(previewClipCache, key);
    if (cachedClip?.dataUrl) {
      state.previewClip = cachedClip;
      state.previewClipLoading = false;
      state.previewClipError = null;
      render();
      return cachedClip;
    }
  }
  if (!force && state.previewClip?.key === key && state.previewClip?.dataUrl) return state.previewClip;
  if (state.previewClipInFlightKey) return null;

  state.previewClipInFlightKey = key;
  state.previewClipLoading = true;
  state.previewClipError = null;
  render();

  try {
    const output = await callBackend('renderPreviewClip', {
      compositionId: composition.id,
      frame: state.frame,
      scale: state.previewClipScale,
      durationSeconds: state.previewClipSeconds,
      force,
    });
    const cachedOutput = cacheSet(
      previewClipCache,
      key,
      { ...output, key },
      PREVIEW_CLIP_CACHE_LIMIT,
    );

    if (previewClipKey() === key) {
      state.previewClip = cachedOutput;
      state.previewClipError = null;
      return state.previewClip;
    }
    return null;
  } catch (error) {
    if (previewClipKey() === key) {
      state.previewClipError = String(error.message || error);
      state.playing = false;
    }
    return null;
  } finally {
    state.previewClipInFlightKey = null;
    state.previewClipLoading = false;
    render();
  }
}

function setComposition(id) {
  state.activeCompositionId = id;
  state.frame = defaultPreviewFrame(currentComposition());
  state.frameTouched = false;
  state.previewFrame = null;
  state.previewClip = null;
  state.previewError = null;
  state.previewClipError = null;
  state.previewQueuedKey = null;
  state.playerHost = null;
  state.playerHostError = null;
  resetPlayerRuntimeState();
  clearPlayerHostPoll();
  if (usePlayerPreview() && state.route === '/preview') {
    void ensurePlayerPreviewHost(true);
  }
  void evaluateCurrentFrame();
}

function setFrame(frame, options = {}) {
  const duration = compositionDuration();
  state.frame = clamp(Number(frame) || 0, 0, duration - 1);
  if (!options.silent) state.frameTouched = true;
  if (usePlayerPreview()) {
    sendOrQueuePlayerCommand('seek', { frame: state.frame });
    if (options.fastSync) syncFrameDom();
    else updateTimelineDom();
    return;
  }
  if (!useStudioPreview()) {
    const cachedFrame = cacheGet(previewFrameCache, previewFrameKey());
    if (cachedFrame?.dataUrl) {
      state.previewFrame = cachedFrame;
      state.previewError = null;
      render();
    }
  }
  void evaluateCurrentFrame();
}

function stepFrame(delta) {
  setFrame(state.frame + delta);
}

function togglePlayback() {
  if (usePlayerPreview()) {
    if (state.playing) {
      setPlayingState(false);
      sendOrQueuePlayerCommand('pause', { frame: state.frame });
      return;
    }
    setPlayingState(true);
    sendOrQueuePlayerCommand('play', { frame: state.frame });
    return;
  }
  if (useStudioPreview()) return;
  if (state.playing) {
    setPlayingState(false);
    render();
    return;
  }

  setPlayingState(true);
  stopPlaybackTimer();
  render();
  void requestPreviewClip();
}

async function renderStill() {
  const composition = currentComposition();
  if (!composition) return;
  setLoading(true, t('renderStill'));
  try {
    const output = await callBackend('renderStill', {
      compositionId: composition.id,
      frame: state.frame,
    });
    state.lastStill = output;
    state.status = output?.status || 'completed';
    state.error = null;
  } catch (error) {
    setError(error);
  } finally {
    setLoading(false);
  }
}

async function startExport() {
  const composition = currentComposition();
  if (!composition) return;
  setLoading(true, t('exportVideo'));
  try {
    const output = await callBackend('startExport', {
      compositionId: composition.id,
      frameRange: [0, compositionDuration(composition) - 1],
    });
    state.status = output?.status || 'completed';
    state.error = null;
  } catch (error) {
    setError(error);
  } finally {
    setLoading(false);
  }
}

async function sendContext() {
  const host = runtime();
  const composition = currentComposition();
  const prompt = t('askPrompt', {
    project: projectName(),
    composition: composition?.id || '-',
    frame: state.frame,
    route: routeKey(),
    workspace: state.workspacePath || '-',
  });
  await host.host?.fillChatInput?.(prompt);
}

// ─── Icons (inline SVG) ──────────────────────────────────────────────────────

const ICONS = {
  play:    `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5l9 5.5-9 5.5V2.5z"/></svg>`,
  pause:   `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="2" width="3" height="12" rx="1"/><rect x="9" y="2" width="3" height="12" rx="1"/></svg>`,
  prev:    `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M11 13L5 8l6-5v10z"/><rect x="3" y="3" width="2" height="10" rx="1"/></svg>`,
  next:    `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3l6 5-6 5V3z"/><rect x="11" y="3" width="2" height="10" rx="1"/></svg>`,
  refresh: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2v4h-4"/><path d="M2 8a6 6 0 0110.6-3.9L14 6M2 14v-4h4"/><path d="M14 8a6 6 0 01-10.6 3.9L2 10"/></svg>`,
  send:    `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1.5 1.5l13 6.5-13 6.5V9.5l9-1.5-9-1.5V1.5z"/></svg>`,
  film:    `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/></svg>`,
};

// ─── Header ───────────────────────────────────────────────────────────────────
// Three zones: breadcrumb (workspace / composition) | status dot | refresh + AI

function renderHeader() {
  const compositions = asArray(state.manifest?.compositions);
  const composition = currentComposition();
  const hasMultiple = compositions.length > 1;
  const statusClass = state.loading ? 'is-loading' : state.error ? 'is-error' : state.project ? 'is-ok' : '';
  const statusLabel = state.loading
    ? t('loadingProject')
    : state.error
    ? (state.error.length > 38 ? state.error.slice(0, 38) + '\u2026' : state.error)
    : state.status || '';

  let crumb = '';
  if (state.workspacePath) {
    crumb = `<span class="rl-header__ws">${escapeHtml(workspaceLabel())}</span>`;
    if (hasMultiple) {
      crumb += `<span class="rl-sep" aria-hidden="true">/</span>
        <select class="rl-header__comp" data-action="select-composition">
          ${compositions.map((c) => `<option value="${escapeHtml(c.id)}"${c.id === composition?.id ? ' selected' : ''}>${escapeHtml(c.id)}</option>`).join('')}
        </select>`;
    } else if (composition) {
      crumb += `<span class="rl-sep" aria-hidden="true">/</span><span class="rl-header__comp">${escapeHtml(composition.id)}</span>`;
    }
  } else {
    crumb = `<span class="rl-header__ws rl-header__ws--empty">Remotion Live</span>`;
  }

  return `
    <header class="rl-header">
      <div class="rl-header__left">${crumb}</div>
      <div class="rl-header__status ${statusClass}">
        <span class="rl-dot"></span>
        ${statusLabel ? `<span class="rl-dot-label">${escapeHtml(statusLabel)}</span>` : ''}
      </div>
      <div class="rl-header__right">
        <button class="rl-icon-btn" data-action="refresh" title="${escapeHtml(t('refresh'))}" aria-label="${escapeHtml(t('refresh'))}">${ICONS.refresh}</button>
        <button class="rl-btn rl-btn--accent rl-header__export" data-action="start-export" ${composition ? '' : 'disabled'}>${escapeHtml(t('exportVideo'))}</button>
        <button class="rl-ai-btn" data-action="send-context" title="${escapeHtml(t('sendContext'))}">${ICONS.send}<span>${escapeHtml(t('sendContext'))}</span></button>
      </div>
    </header>
  `;
}

// ─── Empty / no workspace ─────────────────────────────────────────────────────

function renderWorkspaceEmpty() {
  return `
    <div class="rl-empty">
      <div class="rl-empty__icon">${ICONS.film}</div>
      <strong class="rl-empty__title">${escapeHtml(t('title'))}</strong>
      <p>${escapeHtml(t('noWorkspace'))}</p>
    </div>
  `;
}

// ─── Preview: native layer fallback boxes ─────────────────────────────────────

function layerStyle(layer, index) {
  const x = Number.isFinite(Number(layer.x)) ? Number(layer.x) : 8 + index * 4;
  const y = Number.isFinite(Number(layer.y)) ? Number(layer.y) : 10 + index * 7;
  const width = Number.isFinite(Number(layer.width)) ? Number(layer.width) : Math.max(18, 78 - index * 8);
  const height = Number.isFinite(Number(layer.height)) ? Number(layer.height) : Math.max(10, 24 - index * 2);
  const color = layer.color || ['#5dc6ff', '#f4c542', '#8de16d', '#ff7a90'][index % 4];
  const opacity = Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 0.82;
  return `left:${x}%;top:${y}%;width:${width}%;height:${height}%;background:${escapeHtml(color)};opacity:${opacity};`;
}

function renderLayers() {
  const layers = asArray(state.frameModel?.layers);
  if (!layers.length) {
    const composition = currentComposition();
    if (!composition) return '';
    return `
      <div class="rl-native-layer" style="left:10%;top:14%;width:80%;height:52%;background:#5dc6ff;opacity:.2;">
        <span>${escapeHtml(composition.id)}</span>
      </div>
      <div class="rl-native-layer" style="left:18%;top:72%;width:64%;height:12%;background:#f4c542;opacity:.6;">
        <span>${escapeHtml(t('noLayers'))}</span>
      </div>
    `;
  }
  return layers.map((layer, index) => `
    <div class="rl-native-layer" style="${layerStyle(layer, index)}">
      <span>${escapeHtml(layer.label || layer.id || layer.type || `Layer ${index + 1}`)}</span>
    </div>
  `).join('');
}

// ─── Preview: stage content (image / video / overlays) ────────────────────────

function renderPlayerPreviewContent() {
  const host = state.playerHost;
  if (playerPreviewReady()) {
    return `
      <iframe
        class="rl-player-frame"
        data-testid="remotion-player-iframe"
        src="${escapeHtml(playerHostUrl())}"
        title="Remotion Player preview"
        allow="autoplay; fullscreen"
      ></iframe>
      ${state.playerHostLoading || !state.playerRuntimeReady ? `<div class="rl-overlay rl-overlay--loading rl-player-runtime-overlay"><div class="rl-spinner rl-spinner--sm"></div></div>` : ''}
    `;
  }

  const composition = currentComposition();
  const key = previewFrameKey(composition);
  const preview = state.previewFrame?.key === key ? state.previewFrame : null;
  const statusText = state.playerHostError || host?.health?.error || host?.status || t('startingPlayer');
  const still = preview?.dataUrl
    ? `<img class="rl-preview-frame" src="${escapeHtml(preview.dataUrl)}" alt="${escapeHtml(composition?.id || '')}" />`
    : `<div class="rl-layers-fallback">${renderLayers()}</div>`;
  return `
    ${still}
    <div class="rl-overlay${state.playerHostError ? ' rl-overlay--error' : ''}">
      ${state.playerHostError ? '' : '<div class="rl-spinner"></div>'}
      <p>${escapeHtml(state.playerHostError ? t('playerUnavailable') : t('startingPlayer'))}</p>
      <small>${escapeHtml(statusText)}</small>
    </div>
  `;
}

function renderStudioPreviewContent() {
  const server = state.previewServer;
  if (studioPreviewReady()) {
    return `
      <iframe
        class="rl-studio-frame"
        data-testid="remotion-studio-iframe"
        src="${escapeHtml(server.url)}"
        title="${escapeHtml(t('studioPreview'))}"
        allow="autoplay; fullscreen; clipboard-read; clipboard-write"
      ></iframe>
      ${state.previewServerLoading ? `<div class="rl-overlay rl-overlay--loading"><div class="rl-spinner rl-spinner--sm"></div></div>` : ''}
    `;
  }

  const log = server?.log || '';
  const statusText = state.previewServerError || server?.health?.error || server?.status || t('startingStudio');
  return `
    <div class="rl-studio-boot">
      <div class="rl-spinner"></div>
      <p>${escapeHtml(state.previewServerError ? t('studioUnavailable') : t('startingStudio'))}</p>
      <small>${escapeHtml(statusText)}</small>
      ${log ? `<pre class="rl-studio-log">${escapeHtml(log.slice(-1800))}</pre>` : ''}
    </div>
  `;
}

function renderPreviewStageContent() {
  if (usePlayerPreview()) {
    return renderPlayerPreviewContent();
  }

  if (useStudioPreview()) {
    return renderStudioPreviewContent();
  }

  const composition = currentComposition();
  const key = previewFrameKey(composition);
  const preview = state.previewFrame?.key === key ? state.previewFrame : null;
  const clipKey = previewClipKey(composition);
  const clip = state.previewClip?.key === clipKey ? state.previewClip : null;

  // Playing: video clip ready
  if (state.playing && clip?.dataUrl) {
    return `
      <video
        class="rl-preview-video"
        src="${escapeHtml(clip.dataUrl)}"
        data-end-frame="${escapeHtml(clip.to ?? state.frame)}"
        autoplay
        muted
        controls
        playsinline
      ></video>
    `;
  }

  // Playing: waiting for clip render
  if (state.playing && state.previewClipLoading) {
    return `
      <div class="rl-overlay">
        <div class="rl-spinner"></div>
        <p>${escapeHtml(t('preparingPlayback'))}</p>
      </div>
    `;
  }

  // Still frame available — show it (with subtle refresh spinner if re-rendering)
  if (preview?.dataUrl) {
    return `
      <img class="rl-preview-frame" src="${escapeHtml(preview.dataUrl)}" alt="${escapeHtml(composition?.id || '')}" />
      ${state.previewLoading
        ? `<div class="rl-overlay rl-overlay--loading"><div class="rl-spinner rl-spinner--sm"></div></div>`
        : ''}
    `;
  }

  // Loading first frame
  if (state.previewLoading) {
    return `
      <div class="rl-overlay">
        <div class="rl-spinner"></div>
        <p>${escapeHtml(t('renderingFrame'))}</p>
      </div>
    `;
  }

  // Clip error — fall back to still if available
  if (state.previewClipError) {
    return `
      <div class="rl-overlay rl-overlay--error">
        <p>${escapeHtml(t('playbackUnavailable'))}</p>
        <small>${escapeHtml(state.previewClipError)}</small>
      </div>
    `;
  }

  // Still frame error — show layer boxes
  if (state.previewError) {
    return `
      <div class="rl-overlay rl-overlay--error">
        <p>${escapeHtml(t('previewUnavailable'))}</p>
        <small>${escapeHtml(state.previewError)}</small>
      </div>
      <div class="rl-layers-fallback">${renderLayers()}</div>
    `;
  }

  // Composition present but no render yet
  if (composition) {
    return `
      <div class="rl-overlay">
        <div class="rl-spinner"></div>
        <p>${escapeHtml(t('renderingFrame'))}</p>
      </div>
    `;
  }

  return renderLayers();
}

// ─── Preview: main view (stable stage + replaceable controls/timeline) ────────

function renderStudioTransport() {
  return `
    <div class="rl-transport rl-transport--studio">
      <button class="rl-btn" data-action="open-studio" ${studioPreviewReady() ? '' : 'disabled'}>${escapeHtml(t('openStudio'))}</button>
      <button class="rl-btn" data-action="restart-preview-server">${escapeHtml(t('restartStudio'))}</button>
      <button class="rl-btn" data-action="stop-preview-server">${escapeHtml(t('stopStudio'))}</button>
      <div class="rl-transport__spacer"></div>
      <button class="rl-btn" data-action="render-still">${escapeHtml(t('renderStill'))}</button>
    </div>
  `;
}

function renderPlaybackTransport(composition, duration, fps) {
  return `
    <div class="rl-transport">
      <div class="rl-transport__btns">
        <button class="rl-icon-btn" data-action="step-prev" aria-label="${escapeHtml(t('previous'))}">${ICONS.prev}</button>
        <button class="rl-play-btn${state.playing ? ' is-playing' : ''}" data-action="toggle-play" aria-label="${escapeHtml(state.playing ? t('pause') : t('play'))}">
          ${state.playing ? ICONS.pause : ICONS.play}
        </button>
        <button class="rl-icon-btn" data-action="step-next" aria-label="${escapeHtml(t('next'))}">${ICONS.next}</button>
      </div>
      <div class="rl-transport__sep" aria-hidden="true"></div>
      ${renderTimelineZoomControls()}
      <div class="rl-transport__sep" aria-hidden="true"></div>
      <div class="rl-transport__spacer"></div>
      <div class="rl-transport__frame-tools">
        <div class="rl-frame-num">
          <input
            type="number"
            min="0"
            max="${Math.max(0, duration - 1)}"
            value="${state.frame}"
            data-action="frame-number"
            aria-label="${escapeHtml(t('frame'))}"
          />
          <span class="rl-frame-num__total">/ ${duration - 1}</span>
        </div>
        <div class="rl-transport__tc" title="SMPTE HH:MM:SS:FF">${escapeHtml(formatSMPTE(state.frame, fps))}</div>
        <button class="rl-btn" data-action="render-still">${escapeHtml(t('renderStill'))}</button>
      </div>
    </div>
  `;
}

function replaceElementHtml(selector, html) {
  const current = document.querySelector(selector);
  if (!current) return false;
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  const next = template.content.firstElementChild;
  if (!next) return false;
  current.replaceWith(next);
  return true;
}

function updateTimelineDom() {
  const composition = currentComposition();
  if (!composition || useStudioPreview()) return;
  const duration = compositionDuration(composition);
  const fps = Number(composition?.fps || 30);
  replaceElementHtml('.rl-transport', renderPlaybackTransport(composition, duration, fps));
  replaceElementHtml('.rl-tl-inline', renderTimelineInline(composition, duration, fps));
  syncFrameDom();
  syncPlayingDom();
}

function renderPreview() {
  const composition = currentComposition();
  const duration = compositionDuration(composition);
  const fps = Number(composition?.fps || 30);
  const studioMode = useStudioPreview();
  const aspectRatio = composition
    ? `${composition.width || 1920}/${composition.height || 1080}`
    : '16/9';

  return `
    <section class="rl-preview" data-testid="remotion-preview-panel">
      <!-- Dark cinema stage -->
      <div class="rl-stage-area">
        <div class="rl-stage${studioMode ? ' rl-stage--studio' : ''}"${studioMode ? '' : ` style="aspect-ratio:${aspectRatio}"`}>
          ${renderPreviewStageContent()}
          ${composition && !studioMode ? `
            <div class="rl-stage-pill rl-stage-pill--br" aria-live="polite">F ${state.frame}</div>
            <div class="rl-stage-pill rl-stage-pill--bl">${escapeHtml(t('resolution', composition))}</div>
          ` : ''}
        </div>
      </div>

      ${composition ? studioMode
        ? renderStudioTransport()
        : `${renderPlaybackTransport(composition, duration, fps)}${renderTimelineInline(composition, duration, fps)}`
      : ''}
    </section>
  `;
}

// ─── Timeline helpers ─────────────────────────────────────────────────────────

function timelineTickInterval(duration) {
  if (duration <= 30)   return 5;
  if (duration <= 90)   return 10;
  if (duration <= 300)  return 30;
  if (duration <= 900)  return 60;
  if (duration <= 3600) return 150;
  return Math.ceil(duration / 20);
}

// SMPTE drop-frame-free timecode: HH:MM:SS:FF (industry standard used by
// DaVinci Resolve, Premiere Pro, After Effects, Final Cut Pro, etc.)
function formatSMPTE(frame, fps) {
  const f = Math.max(0, Math.round(frame));
  const safeFps = Math.max(1, Math.round(fps || 30));
  const fr = f % safeFps;
  const totalSec = Math.floor(f / safeFps);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const p = (n, d) => String(n).padStart(d, '0');
  return `${p(h, 2)}:${p(m, 2)}:${p(s, 2)}:${p(fr, 2)}`;
}

// ─── Inline timeline ──────────────────────────────────────────────────────────
// Design references: DaVinci Resolve, Premiere Pro, Final Cut Pro.
// Single seek control (no duplicate scrubber in transport).
// Supports zoom so users can see frame-level detail on dense compositions.

function renderTimelineZoomControls() {
  const zoom = Math.max(1, state.tlZoom || 1);
  const contentW = Math.round(zoom * 100);

  return `
    <div class="rl-transport__zoom" aria-label="Timeline zoom">
      <button class="rl-tl-zoom-btn" data-action="tl-zoom-out" aria-label="Zoom out"${zoom <= 1 ? ' disabled' : ''}>
        <svg width="10" height="2" viewBox="0 0 10 2" fill="none" aria-hidden="true"><path d="M1 1h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
      <input type="range" class="rl-tl-zoom-slider" min="1" max="16" step="0.25" value="${zoom}" data-action="tl-zoom" aria-label="Timeline zoom" />
      <button class="rl-tl-zoom-btn" data-action="tl-zoom-in" aria-label="Zoom in"${zoom >= 16 ? ' disabled' : ''}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
      <span class="rl-tl-zoom-label">${contentW}%</span>
      ${zoom > 1.05 ? `<button class="rl-tl-zoom-fit" data-action="tl-zoom-fit" aria-label="Fit all frames">Fit</button>` : ''}
    </div>
  `;
}

function renderTimelineInline(composition, duration, fps) {
  const zoom = Math.max(1, state.tlZoom || 1);

  const sequences = asArray(state.frameModel?.sequences).length
    ? asArray(state.frameModel?.sequences)
    : asArray(composition?.sequences);

  // Percentage helpers — positions are always 0-100% within .rl-tl-content
  // so they stay correct at any zoom level (the content div itself gets wider).
  const scale = duration > 1 ? 100 / (duration - 1) : 0;
  const pct = (f) => Math.min(100, Math.max(0, f * scale));
  const playheadPct = pct(state.frame);

  // Tick density adapts to zoom: zoomed-in → denser ticks (more frame detail).
  // visibleFrames estimates how many frames fit in the viewport at current zoom.
  const visibleFrames = Math.max(5, Math.ceil((duration - 1) / zoom));
  const interval = timelineTickInterval(visibleFrames);
  const ticks = [];
  for (let f = 0; f < duration; f += interval) ticks.push(f);
  if (duration > 1 && ticks[ticks.length - 1] !== duration - 1) ticks.push(duration - 1);

  // Fall back to a single composition-wide track when sequences are unknown.
  const trackRows = sequences.length
    ? sequences
    : [{ id: composition.id, from: 0, durationInFrames: duration }];

  // Content width: 100% at zoom=1, 200% at zoom=2, up to 1600% at zoom=16.
  // The .rl-tl-main container scrolls horizontally over this content.
  const contentW = Math.round(zoom * 100);

  // Tick label: frame number when zoomed in enough to show individual frames;
  // switch to SMPTE timecode on large compositions for readability.
  const useSmpteLabels = duration > 300;
  const tickLabel = (f) =>
    useSmpteLabels ? formatSMPTE(f, fps).slice(3) : String(f); // MM:SS:FF or raw frame

  return `
    <div class="rl-tl-inline">

      <!-- Two-column layout: fixed labels | scrollable ruler+tracks -->
      <div class="rl-tl-workspace" data-tl-max="${duration - 1}">

        <div class="rl-tl-labels">
          <div class="rl-tl-gutter"></div>
          ${trackRows.map((seq) => `
            <div class="rl-tl-label"><span>${escapeHtml(seq.label || seq.id || 'Sequence')}</span></div>
          `).join('')}
        </div>

        <!-- Scrollable region — inner content stretches to zoom * 100% -->
        <div class="rl-tl-main">
          <div class="rl-tl-content" style="width:${contentW}%;min-width:100%">

            <!-- Ruler: invisible drag-to-scrub range input overlaid on tick marks -->
            <div class="rl-tl-ruler" data-tl-seek="${duration - 1}">
              <input
                type="range"
                class="rl-tl-scrub"
                min="0"
                max="${duration - 1}"
                value="${state.frame}"
                data-action="frame-range"
                aria-label="${escapeHtml(t('frame'))}"
              />
              ${ticks.map((f) => `
                <div class="rl-tl-tick${f === state.frame ? ' is-current' : ''}" style="left:${pct(f)}%" aria-hidden="true">
                  <span class="rl-tl-tick__lbl">${tickLabel(f)}</span>
                </div>
              `).join('')}
              <!-- Playhead: triangle + stem, always at current frame position -->
              <div class="rl-tl-playhead" style="left:${playheadPct}%" aria-hidden="true"></div>
            </div>

            <!-- Sequence bars: click-to-seek, active bar highlighted by accent -->
            <div class="rl-tl-tracks">
              ${trackRows.map((seq) => {
                const from   = clamp(Number(seq.from || 0), 0, duration - 1);
                const len    = clamp(Number(seq.duration || seq.durationInFrames || duration), 1, duration);
                const barL   = pct(from);
                const barW   = Math.max(0.4, pct(from + len) - barL);
                const active = state.frame >= from && state.frame < (from + len);
                const seqDur = Math.min(len, duration - from);
                return `
                  <div class="rl-tl-track" data-tl-seek="${duration - 1}">
                    <div class="rl-tl-bar${active ? ' is-active' : ''}" style="left:${barL}%;width:${barW}%">
                      ${seqDur > 8 ? `<span class="rl-tl-bar__dur">${seqDur}f</span>` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
              <!-- Vertical playhead line spanning all tracks -->
              <div class="rl-tl-vline" style="left:${playheadPct}%" aria-hidden="true"></div>
            </div>

          </div>
        </div>
      </div>

    </div>
  `;
}

function renderRouteContent() {
  if (!state.workspacePath) return renderWorkspaceEmpty();
  return renderPreview();
}

// ─── Main render ──────────────────────────────────────────────────────────────

function render() {
  if (shouldDeferRenderForSelection()) {
    state.renderQueued = true;
    return;
  }

  const root = rootElement();
  if (!root) return;
  const previousPlayerFrame = playerFrameNode();
  state.renderQueued = false;
  root.dataset.route = state.route;
  document.documentElement.dataset.route = state.route;

  // Progress and error both live in the same auto-height row so the grid stays stable.
  const statusBar = state.loading
    ? `<div class="rl-status-bar"><div class="rl-progress" role="progressbar"><span></span></div></div>`
    : state.error
    ? `<div class="rl-status-bar"><div class="rl-error-bar">${escapeHtml(state.error)}</div></div>`
    : `<div class="rl-status-bar"></div>`;

  root.innerHTML = renderHeader() + statusBar + `<div class="rl-content">${renderRouteContent()}</div>`;
  fitPreviewStage();
  const nextPlayerFrame = playerFrameNode();
  if (nextPlayerFrame && nextPlayerFrame !== previousPlayerFrame) {
    state.playerRuntimeReady = false;
    state.playerRuntimePlaying = false;
  }
  if (playerPreviewReady() && !state.playerRuntimeReady) {
    requestPlayerHandshake();
  }
  ensurePreviewVideoPlayback();
}

function fitPreviewStage() {
  const stage = document.querySelector('.rl-stage:not(.rl-stage--studio)');
  const area = stage?.closest('.rl-stage-area');
  const composition = currentComposition();
  if (!stage || !area || !composition) return;
  const areaRect = area.getBoundingClientRect();
  const sourceWidth = Math.max(1, Number(composition.width) || 1920);
  const sourceHeight = Math.max(1, Number(composition.height) || 1080);
  const ratio = sourceWidth / sourceHeight;
  const maxWidth = Math.min(Math.max(1, areaRect.width), sourceWidth);
  const maxHeight = Math.min(Math.max(1, areaRect.height), sourceHeight);
  let width = maxWidth;
  let height = width / ratio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  stage.style.width = `${Math.max(1, Math.round(width))}px`;
  stage.style.height = `${Math.max(1, Math.round(height))}px`;
}

function ensurePreviewVideoPlayback() {
  if (!state.playing) return;
  const video = document.querySelector('.rl-preview-video');
  if (!video || video.tagName !== 'VIDEO') return;
  video.muted = true;
  const playPromise = video.play?.();
  if (typeof playPromise?.catch === 'function') {
    playPromise.catch(() => {
      // Browsers can still require a second gesture; controls remain visible.
    });
  }
}

function handleRouteEvent(payload = {}) {
  state.route = normalizeRoute(payload.route || state.route);
  state.tabId = payload.tabId || state.tabId;
  state.sessionId = payload.sessionId || state.sessionId;
  const nextWorkspace = payload.workspacePath || payload.workbench?.workspacePath || state.workspacePath;
  const workspaceChanged = nextWorkspace && nextWorkspace !== state.workspacePath;
  state.workspacePath = nextWorkspace || state.workspacePath;
  if (workspaceChanged) {
    clearPlayerHostPoll();
    clearPreviewServerPoll();
    previewFrameCache.clear();
    previewClipCache.clear();
    state.previewFrame = null;
    state.previewClip = null;
    state.previewError = null;
    state.previewClipError = null;
    state.playerHost = null;
    state.playerHostError = null;
    state.playerHostLoading = false;
    resetPlayerRuntimeState();
    state.previewServer = null;
    state.previewServerError = null;
    state.previewServerLoading = false;
  }
  render();
  if (workspaceChanged || (!state.project && state.workspacePath)) {
    void refreshProject();
  }
}

document.addEventListener('pointerdown', (event) => {
  if (!isSelectionStartTarget(event.target)) return;
  state.selectionPointerDown = true;
  state.selectionGuard = true;
  pausePlaybackForSelection();
}, true);

document.addEventListener('pointerup', () => {
  if (!state.selectionPointerDown) return;
  state.selectionPointerDown = false;
  scheduleSelectionGuardRelease();
}, true);

document.addEventListener('selectstart', (event) => {
  if (!isSelectionStartTarget(event.target)) return;
  state.selectionGuard = true;
  pausePlaybackForSelection();
}, true);

document.addEventListener('selectionchange', () => {
  if (hasLiveTextSelection()) {
    state.selectionGuard = true;
    pausePlaybackForSelection();
    return;
  }
  if (!state.selectionPointerDown) {
    scheduleSelectionGuardRelease();
  }
});

window.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.source !== 'sparo-remotion-player-host') return;
  const composition = currentComposition();
  if (message.compositionId && composition?.id && message.compositionId !== composition.id) return;
  if (message.type === 'ready') {
    state.playerRuntimeReady = true;
    state.playerHostError = null;
    syncFrameFromPlayer(message.frame ?? state.frame);
    syncPlayerRuntimeDom();
    flushPlayerCommand();
  }
  if (message.type === 'frame') {
    clearPlayerCommandFallback();
    syncFrameFromPlayer(message.frame);
  }
  if (message.type === 'command') {
    clearPlayerCommandFallback();
    if (message.frame !== undefined) syncFrameFromPlayer(message.frame);
  }
  if (message.type === 'play') {
    clearPlayerCommandFallback();
    state.playerRuntimePlaying = true;
    if (!state.playing) {
      if (message.frame !== undefined) syncFrameFromPlayer(message.frame);
      sendOrQueuePlayerCommand('pause', { frame: message.frame ?? state.frame });
      return;
    }
    setPlayingState(true);
    if (message.frame !== undefined) syncFrameFromPlayer(message.frame);
  }
  if (message.type === 'pause') {
    clearPlayerCommandFallback();
    state.playerRuntimePlaying = false;
    setPlayingState(false);
    if (message.frame !== undefined) syncFrameFromPlayer(message.frame);
  }
  if (message.type === 'ended') {
    state.playerRuntimePlaying = false;
    setPlayingState(false);
    if (message.frame !== undefined) syncFrameFromPlayer(message.frame);
  }
  if (message.type === 'error') {
    state.playerHostError = String(message.message || 'Player preview failed.');
    state.playerRuntimeReady = false;
    state.playerRuntimePlaying = false;
    setPlayingState(false);
    render();
  }
});

document.addEventListener('load', (event) => {
  const node = event.target;
  if (!node?.classList?.contains('rl-player-frame')) return;
  state.playerRuntimeReady = false;
  requestPlayerHandshake();
}, true);

window.addEventListener('resize', fitPreviewStage);

document.addEventListener('click', (event) => {
  // Timeline seek: clicks on ruler or track area (not on interactive controls).
  // The range input inside the ruler handles dragging via the 'input' event;
  // this handler covers clicks directly on the track bars / empty track area.
  const tlSeekNode = closestElement(event.target, '[data-tl-seek]');
  if (tlSeekNode && !closestElement(event.target, 'input,button,select')) {
    const scrollEl = tlSeekNode.closest('.rl-tl-main');
    if (scrollEl) {
      const rect = scrollEl.getBoundingClientRect();
      const clickX = event.clientX - rect.left + scrollEl.scrollLeft;
      const ratio = Math.max(0, Math.min(1, clickX / Math.max(1, scrollEl.scrollWidth)));
      const maxFrame = Number(tlSeekNode.dataset.tlSeek) || 0;
      setFrame(Math.round(ratio * maxFrame));
    }
    return;
  }

  const actionNode = closestElement(event.target, '[data-action]');
  if (!actionNode) return;
  const action = actionNode.dataset.action;
  if (action === 'refresh') void refreshProject();
  if (action === 'send-context') void sendContext();
  if (action === 'step-prev') stepFrame(-1);
  if (action === 'step-next') stepFrame(1);
  if (action === 'toggle-play') togglePlayback();
  if (action === 'open-studio' && state.previewServer?.url) {
    window.open(state.previewServer.url, '_blank', 'noopener,noreferrer');
  }
  if (action === 'restart-preview-server') void ensurePreviewServer(true);
  if (action === 'stop-preview-server') void stopPreviewServer();
  if (action === 'render-still') void renderStill();
  if (action === 'start-export') void startExport();
  // Timeline zoom
  if (action === 'tl-zoom-in')  { state.tlZoom = Math.min(16, (state.tlZoom || 1) * 1.5); updateTimelineDom(); }
  if (action === 'tl-zoom-out') { state.tlZoom = Math.max(1,  (state.tlZoom || 1) / 1.5); updateTimelineDom(); }
  if (action === 'tl-zoom-fit') { state.tlZoom = 1; updateTimelineDom(); }
});

document.addEventListener('ended', (event) => {
  const node = event.target;
  if (!node || node.tagName !== 'VIDEO' || !node.classList.contains('rl-preview-video')) return;
  const endFrame = Number(node.dataset.endFrame);
  state.playing = false;
  if (Number.isFinite(endFrame)) {
    state.frame = clamp(endFrame, 0, compositionDuration() - 1);
    state.frameTouched = true;
  }
  state.previewClip = null;
  void evaluateCurrentFrame();
}, true);

document.addEventListener('change', (event) => {
  const node = event.target;
  if (node?.dataset?.action === 'select-composition') setComposition(node.value);
  if (node?.dataset?.action === 'frame-number') setFrame(node.value);
});

document.addEventListener('input', (event) => {
  const node = event.target;
  if (node?.dataset?.action === 'frame-range') setFrame(node.value, { fastSync: true });
  if (node?.dataset?.action === 'tl-zoom') { state.tlZoom = Math.max(1, Number(node.value)); updateTimelineDom(); }
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type !== 'sparo:event') return;
  if (message.event === 'localeChange') {
    state.locale = message.payload?.locale || state.locale;
    render();
  }
  if (message.event === 'workbenchRouteChange') {
    handleRouteEvent(message.payload || {});
  }
});

runtime().onLocaleChange?.((locale) => {
  state.locale = locale || state.locale;
  render();
});

window.addEventListener('DOMContentLoaded', () => {
  render();
});
