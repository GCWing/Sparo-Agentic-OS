// remotion-live :: preview-runtime.js (auto-split from ui.js; do not hand-merge)

import { callBackend } from './backend.js';
import { PLAYER_HOST_RUNTIME_VERSION, PREVIEW_CLIP_CACHE_LIMIT, PREVIEW_FRAME_CACHE_LIMIT } from './constants.js';
import { compositionDuration, currentComposition, previewClipKey, previewFrameKey, selectedLayer } from './model.js';
import { playerFrameNode, playerHostUrl, requestPlayerHandshake } from './player-dom.js';
import { playerPreviewReady, usePlayerPreview, useStudioPreview } from './preview-mode.js';
import { render } from './render-core.js';
import { previewClipCache, previewFrameCache, state } from './state.js';
import { cacheGet, cacheSet, clamp } from './util.js';

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
    state.playerFrameModel = null;
    state.previewFrame = null;
    state.previewClip = null;
    state.selectedElementId = null;
    state.previewError = null;
    state.previewClipError = null;
    render();
    return;
  }
  const frame = clamp(Number(state.frame) || 0, 0, compositionDuration(composition) - 1);
  state.frame = frame;
  try {
    state.frameModel = await callBackend('getFrameContext', {
      compositionId: composition.id,
      frame,
    });
    if (state.selectedElementId && !selectedLayer()) {
      state.selectedElementId = null;
    }
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


export { clearPlayerHostPoll, clearPreviewServerPoll, ensurePlayerPreviewHost, ensurePreviewServer, evaluateCurrentFrame, pollPlayerPreviewHostStatus, requestPreviewClip, requestPreviewFrame, stopPreviewServer };
