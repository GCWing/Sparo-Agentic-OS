import { callBackend } from './backend.js';
import { PLAYER_CONTROL_PROTOCOL_VERSION, PLAYER_HOST_RUNTIME_VERSION } from './constants.js';
import { currentComposition } from './model.js';
import { resetPlayerChannelConnection } from './player-dom.js';
import { render } from './render-core.js';
import { state } from './state.js';
import { t } from './util.js';

let ensureRequest = null;
let queuedForceKey = null;

function playerHostRequestKey() {
  const composition = currentComposition();
  return [
    state.workspacePath || '',
    state.manifest?.projectRevision || state.manifest?.sourceRevision || '',
    state.manifest?.descriptorRevision || '',
    composition?.id || '',
    composition?.descriptorRevision || '',
  ].join('|');
}

function clearPlayerHostPoll() {
  if (!state.playerHostPollTimer) return;
  clearTimeout(state.playerHostPollTimer);
  state.playerHostPollTimer = null;
}

function schedulePlayerHostPoll(delayMs = 1600) {
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
    host.bundleId || '',
    host.runtimeVersion || '',
    host.protocolVersion || '',
    host.health?.reachable ? '1' : '0',
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
    state.playerConnectionState = 'disconnected';
    state.playerPhase = 'connecting';
    resetPlayerChannelConnection({ rotateNonce: true, resetRecovery: true });
  }

  if (output?.ready
    && output?.runtimeVersion === PLAYER_HOST_RUNTIME_VERSION
    && output?.protocolVersion === PLAYER_CONTROL_PROTOCOL_VERSION) {
    state.playerHostError = null;
    state.playerPhase = state.playerRuntimeReady ? state.playerPhase : 'connecting';
    schedulePlayerHostPoll(5000);
  } else if (output?.ready) {
    state.playerHostError = t('protocolMismatch');
    state.playerPhase = 'error';
    clearPlayerHostPoll();
  } else if (output?.status === 'starting' || output?.status === 'queued') {
    state.playerPhase = 'connecting';
    schedulePlayerHostPoll();
  } else {
    clearPlayerHostPoll();
  }

  return previousSignature !== playerHostSignature(state.playerHost);
}

async function startPlayerHost(force, requestKey) {
  const composition = currentComposition();
  if (!state.workspacePath || !composition) return null;

  state.playerHostLoading = true;
  state.playerHostError = null;
  state.playerPhase = 'connecting';
  render();
  try {
    const output = await callBackend('ensurePlayerPreviewHost', {
      compositionId: composition.id,
      frame: state.frame,
      expectedProjectRevision: state.manifest?.projectRevision || state.manifest?.sourceRevision,
      expectedDescriptorRevision: composition.descriptorRevision || state.manifest?.descriptorRevision,
      force,
      waitMs: 45000,
    });
    if (requestKey !== playerHostRequestKey()) return null;
    applyPlayerHostOutput(output);
    return output;
  } catch (error) {
    if (requestKey === playerHostRequestKey()) {
      state.playerHostError = String(error?.message || error);
      state.playerPhase = 'error';
      clearPlayerHostPoll();
    }
    return null;
  } finally {
    if (requestKey === playerHostRequestKey()) {
      state.playerHostLoading = false;
      render();
    }
  }
}

function ensurePlayerPreviewHost(force = false) {
  if (!state.workspacePath || !currentComposition()) return Promise.resolve(null);
  const requestKey = playerHostRequestKey();
  if (ensureRequest?.key === requestKey) {
    if (force) queuedForceKey = requestKey;
    return ensureRequest.promise;
  }
  queuedForceKey = null;
  const request = { key: requestKey, promise: null };
  request.promise = startPlayerHost(force, requestKey).finally(() => {
    if (ensureRequest === request) ensureRequest = null;
    if (queuedForceKey === requestKey && playerHostRequestKey() === requestKey) {
      queuedForceKey = null;
      void ensurePlayerPreviewHost(true);
    }
  });
  ensureRequest = request;
  return request.promise;
}

async function pollPlayerPreviewHostStatus() {
  if (!state.workspacePath || !currentComposition()) return;
  const requestKey = playerHostRequestKey();
  let shouldRender = false;
  try {
    const output = await callBackend('getPlayerPreviewHostStatus');
    if (requestKey !== playerHostRequestKey()) return;
    shouldRender = applyPlayerHostOutput(output);
    if (state.route === '/preview' && output?.status === 'stopped') {
      state.playerHostError = t('runtimeStopped');
      state.playerPhase = 'error';
      shouldRender = true;
    }
  } catch (error) {
    if (requestKey !== playerHostRequestKey()) return;
    state.playerHostError = String(error?.message || error);
    state.playerPhase = 'error';
    clearPlayerHostPoll();
    shouldRender = true;
  }
  if (shouldRender) render();
}

export {
  clearPlayerHostPoll,
  ensurePlayerPreviewHost,
  pollPlayerPreviewHostStatus,
};
