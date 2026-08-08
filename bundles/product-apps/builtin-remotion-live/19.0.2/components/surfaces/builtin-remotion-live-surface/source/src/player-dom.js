// remotion-live :: player-dom.js

import { PLAYER_CONTROL_PROTOCOL_VERSION } from './constants.js';
import { currentComposition } from './model.js';
import { ensurePlayerInstanceId, playerPreviewReady } from './preview-controller.js';
import { state } from './state.js';
import { t } from './util.js';

const HANDSHAKE_RETRY_DELAYS_MS = [500, 750, 1_250, 1_500];
const PLAYER_READY_TIMEOUT_MS = 12_000;
const HEARTBEAT_INTERVAL_MS = 3_000;
const HEARTBEAT_TIMEOUT_MS = 7_000;
const MAX_FRAME_RECOVERY_ATTEMPTS = 1;

let channelIdentity = null;
let playerMessageHandler = null;
let readinessHandshakeIdentityKey = null;
const readinessHandshakeSignals = new Set();
let connectionCounter = 0;
let connectionGeneration = 0;
let heartbeatTimer = null;
let reportedReadyConnectionId = null;

function randomNonce() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}


function reportPlayerRuntimeLog(level, message, details = {}) {
  try {
    window.parent?.postMessage({
      method: 'sparo/runtime-log',
      params: {
        level,
        category: 'remotion-preview',
        message,
        source: 'player-dom.js',
        details,
        timestampMs: Date.now(),
      },
    }, '*');
  } catch {
    // Diagnostics must never interfere with preview recovery.
  }
}


function playerFrameNode() {
  return document.querySelector('.rl-player-frame');
}


function clearHeartbeat() {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}


function clearPlayerReadyTimer() {
  if (!state.playerReadyTimer) return;
  clearTimeout(state.playerReadyTimer);
  state.playerReadyTimer = null;
}


function closePlayerConnection() {
  clearHeartbeat();
  clearPlayerReadyTimer();
  if (state.playerCommandTimer) {
    clearTimeout(state.playerCommandTimer);
    state.playerCommandTimer = null;
  }
  if (channelIdentity) channelIdentity.connectionId = null;
  state.playerInFlightCommand = null;
  state.playerChannelConnected = false;
  state.playerConnectionState = 'disconnected';
  state.playerConnectionTransport = null;
  state.playerConnectionId = null;
  state.playerLastMessageAt = null;
}


function resetReadinessHandshakeSignals() {
  readinessHandshakeIdentityKey = null;
  readinessHandshakeSignals.clear();
}


function playerChannelKey() {
  return [
    ensurePlayerInstanceId(),
    state.playerHost?.baseUrl || state.playerHost?.url || '',
    state.playerReloadNonce || 0,
  ].join('|');
}


function nonceFromRenderedFrame(instanceId) {
  const src = playerFrameNode()?.getAttribute('src');
  if (!src) return null;
  try {
    const url = new URL(src, window.location.href);
    if (url.searchParams.get('instanceId') !== instanceId) return null;
    return url.searchParams.get('channelNonce') || null;
  } catch {
    return null;
  }
}


function generationFromRenderedFrame(instanceId) {
  const src = playerFrameNode()?.getAttribute('src');
  if (!src) return null;
  try {
    const url = new URL(src, window.location.href);
    if (url.searchParams.get('instanceId') !== instanceId) return null;
    const value = Number(url.searchParams.get('connectionGeneration'));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}


function ensurePlayerChannelIdentity() {
  const key = playerChannelKey();
  if (!channelIdentity || channelIdentity.key !== key) {
    closePlayerConnection();
    resetReadinessHandshakeSignals();
    const instanceId = ensurePlayerInstanceId();
    connectionGeneration += 1;
    channelIdentity = {
      key,
      instanceId,
      nonce: nonceFromRenderedFrame(instanceId) || randomNonce(),
      generation: generationFromRenderedFrame(instanceId) || connectionGeneration,
      connectionId: null,
    };
    state.playerChannelNonce = channelIdentity.nonce;
    state.playerConnectionGeneration = channelIdentity.generation;
  }
  return channelIdentity;
}


function resetPlayerChannelConnection(options = {}) {
  closePlayerConnection();
  if (state.playerHandshakeTimer) {
    clearTimeout(state.playerHandshakeTimer);
    state.playerHandshakeTimer = null;
  }
  if (options.rotateNonce) {
    channelIdentity = null;
    state.playerChannelNonce = null;
    resetReadinessHandshakeSignals();
  }
  if (options.resetRecovery) {
    state.playerRecoveryAttempt = 0;
    state.playerConnectionErrorCode = null;
  }
}


function activatePlayerHandshake(signal) {
  if (state.playerChannelConnected) return;
  const identity = ensurePlayerChannelIdentity();
  if (readinessHandshakeIdentityKey !== identity.key) {
    readinessHandshakeIdentityKey = identity.key;
    readinessHandshakeSignals.clear();
  }
  if (readinessHandshakeSignals.has(signal)) return;
  readinessHandshakeSignals.add(signal);

  // A speculative connect may arrive before the child installs its listener.
  // The frame load and bootstrap messages each restart that lease once, while
  // repeated bootstrap pulses cannot churn an in-flight connection.
  if (state.playerHandshakeTimer) {
    clearTimeout(state.playerHandshakeTimer);
    state.playerHandshakeTimer = null;
  }
  requestPlayerHandshake();
}


function notifyPlayerFrameLoaded(node) {
  if (!node || node !== playerFrameNode()) return;
  activatePlayerHandshake('frame-load');
}


function playerHostUrl(options = {}) {
  const host = state.playerHost;
  const composition = currentComposition();
  if (!host?.url || !composition) return '';
  try {
    const identity = ensurePlayerChannelIdentity();
    const url = new URL(host.baseUrl || host.url);
    url.searchParams.set('compositionId', composition.id);
    url.searchParams.set('frame', String(Math.round(Number(state.frame) || 0)));
    url.searchParams.set('instanceId', identity.instanceId);
    url.searchParams.set('channelNonce', identity.nonce);
    url.searchParams.set('connectionGeneration', String(identity.generation));
    if (options.cacheBust || state.playerReloadNonce) {
      url.searchParams.set('_rl', String(state.playerReloadNonce));
    }
    return url.toString();
  } catch {
    return host.url;
  }
}


function setPlayerMessageHandler(handler) {
  playerMessageHandler = typeof handler === 'function' ? handler : null;
}


function messageMatchesPreview(message, identity) {
  const composition = currentComposition();
  if (!composition || message.source !== 'sparo-remotion-player-host') return false;
  if (message.protocolVersion !== PLAYER_CONTROL_PROTOCOL_VERSION) return false;
  if (message.compositionId !== composition.id) return false;
  if (message.projectRevision !== (state.manifest?.projectRevision || state.manifest?.sourceRevision)) return false;
  if (message.descriptorRevision !== (composition.descriptorRevision || state.manifest?.descriptorRevision)) return false;
  if (message.instanceId !== identity.instanceId || message.channelNonce !== identity.nonce) return false;
  return message.connectionGeneration === identity.generation;
}


function failPlayerConnection(errorCode) {
  resetPlayerChannelConnection({ rotateNonce: false });
  state.playerConnectionState = 'failed';
  state.playerConnectionErrorCode = errorCode;
  state.playerRuntimeReady = false;
  state.playerPhase = 'error';
  state.playerHostError = t('connectionTimeout');
  reportPlayerRuntimeLog('error', 'Remotion preview connection failed', {
    errorCode,
    recoveryAttempt: state.playerRecoveryAttempt,
    compositionId: currentComposition()?.id || null,
    projectRevision: state.manifest?.projectRevision || state.manifest?.sourceRevision || null,
  });
  window.dispatchEvent(new CustomEvent('remotion-live:render-request'));
}


function recoverPlayerFrame(errorCode) {
  resetPlayerChannelConnection({ rotateNonce: true });
  state.playerRuntimeReady = false;
  state.playerRuntimePlaying = false;
  if (state.playerRecoveryAttempt >= MAX_FRAME_RECOVERY_ATTEMPTS) {
    failPlayerConnection(errorCode);
    return;
  }

  state.playerRecoveryAttempt += 1;
  state.playerConnectionErrorCode = errorCode;
  state.playerConnectionState = 'recovering';
  state.playerPhase = 'connecting';
  state.playerHostError = null;
  state.playerReloadNonce += 1;
  reportPlayerRuntimeLog('warn', 'Reloading Remotion preview frame after connection failure', {
    errorCode,
    recoveryAttempt: state.playerRecoveryAttempt,
    compositionId: currentComposition()?.id || null,
    projectRevision: state.manifest?.projectRevision || state.manifest?.sourceRevision || null,
  });
  window.dispatchEvent(new CustomEvent('remotion-live:render-request'));
}


function startPlayerReadyTimer(identity) {
  clearPlayerReadyTimer();
  state.playerReadyTimer = window.setTimeout(() => {
    state.playerReadyTimer = null;
    if (identity !== channelIdentity || state.playerRuntimeReady) return;
    recoverPlayerFrame('PLAYER_MOUNT_TIMEOUT');
  }, PLAYER_READY_TIMEOUT_MS);
}


function startHeartbeat(identity) {
  clearHeartbeat();
  state.playerLastMessageAt = Date.now();
  heartbeatTimer = window.setInterval(() => {
    if (identity !== channelIdentity || !state.playerRuntimeReady || document.visibilityState === 'hidden') return;
    const silenceMs = Date.now() - Number(state.playerLastMessageAt || 0);
    if (silenceMs > HEARTBEAT_TIMEOUT_MS) {
      reportPlayerRuntimeLog('warn', 'Remotion preview heartbeat timed out', {
        silenceMs,
        compositionId: currentComposition()?.id || null,
      });
      resetPlayerChannelConnection({ rotateNonce: false });
      state.playerRuntimeReady = false;
      state.playerPhase = 'connecting';
      requestPlayerHandshake();
      window.dispatchEvent(new CustomEvent('remotion-live:render-request'));
      return;
    }
    postPlayerMessage('ping', { sentAt: Date.now() }, { requireReady: false });
  }, HEARTBEAT_INTERVAL_MS);
}


function handleVisibilityChange() {
  if (document.visibilityState !== 'visible' || !state.playerRuntimeReady) return;
  state.playerLastMessageAt = Date.now();
  postPlayerMessage('ping', { sentAt: Date.now() }, { requireReady: false });
}


function handlePlayerWindowMessage(event) {
  const node = playerFrameNode();
  const message = event.data || {};
  if (!node?.contentWindow || message.source !== 'sparo-remotion-player-host') return;
  const identity = ensurePlayerChannelIdentity();
  if (!messageMatchesPreview(message, identity)) return;

  if (message.type === 'bootstrapReady') {
    // WebView2 may expose different WindowProxy identities for the same nested,
    // opaque iframe. The URL-bound nonce and immutable preview identity bind
    // the message to this exact navigation without relying on event.source.
    activatePlayerHandshake('bootstrap-ready');
    return;
  }

  if (!identity.connectionId || message.connectionId !== identity.connectionId) return;
  state.playerLastMessageAt = Date.now();

  if (message.type === 'channelReady') {
    state.playerChannelConnected = true;
    state.playerConnectionState = 'connected';
    state.playerConnectionTransport = 'window-message';
    state.playerConnectionId = identity.connectionId;
    state.playerConnectionErrorCode = null;
    if (state.playerHandshakeTimer) {
      clearTimeout(state.playerHandshakeTimer);
      state.playerHandshakeTimer = null;
    }
    startPlayerReadyTimer(identity);
  }

  if (message.type === 'ready') {
    const recoveryAttempt = state.playerRecoveryAttempt;
    clearPlayerReadyTimer();
    state.playerRecoveryAttempt = 0;
    state.playerConnectionErrorCode = null;
    startHeartbeat(identity);
    if (reportedReadyConnectionId !== identity.connectionId) {
      reportedReadyConnectionId = identity.connectionId;
      reportPlayerRuntimeLog('info', 'Remotion preview transport ready', {
        transport: 'window-message',
        connectionGeneration: identity.generation,
        connectionId: identity.connectionId,
        recoveryAttempt,
        compositionId: currentComposition()?.id || null,
        projectRevision: state.manifest?.projectRevision || state.manifest?.sourceRevision || null,
      });
    }
  }

  if (message.type === 'error') {
    clearHeartbeat();
    clearPlayerReadyTimer();
  }

  if (message.type === 'pong') return;
  playerMessageHandler?.(message, { trusted: true });
}


function openPlayerConnection(identity) {
  const composition = currentComposition();
  const node = playerFrameNode();
  if (!composition || !node?.contentWindow || !playerPreviewReady()) return false;

  connectionCounter += 1;
  identity.connectionId = `${identity.instanceId}-c${connectionCounter}`;
  state.playerConnectionId = identity.connectionId;
  state.playerConnectionState = 'connecting';
  state.playerConnectionTransport = 'window-message';

  node.contentWindow.postMessage({
    source: 'sparo-remotion-live',
    type: 'connect',
    protocolVersion: PLAYER_CONTROL_PROTOCOL_VERSION,
    compositionId: composition.id,
    projectRevision: state.manifest?.projectRevision || state.manifest?.sourceRevision,
    descriptorRevision: composition.descriptorRevision || state.manifest?.descriptorRevision,
    instanceId: identity.instanceId,
    channelNonce: identity.nonce,
    connectionGeneration: identity.generation,
    connectionId: identity.connectionId,
    transport: 'window-message',
  }, '*');
  return true;
}


function postPlayerMessage(type, payload = {}, options = {}) {
  const composition = currentComposition();
  const identity = ensurePlayerChannelIdentity();
  const node = playerFrameNode();
  if (!composition || !node?.contentWindow || !identity.connectionId || !state.playerChannelConnected || !playerPreviewReady()) return false;
  if (options.requireReady !== false && !state.playerRuntimeReady) return false;
  node.contentWindow.postMessage({
    ...payload,
    source: 'sparo-remotion-live',
    type,
    protocolVersion: PLAYER_CONTROL_PROTOCOL_VERSION,
    compositionId: composition.id,
    projectRevision: state.manifest?.projectRevision || state.manifest?.sourceRevision,
    descriptorRevision: composition.descriptorRevision || state.manifest?.descriptorRevision,
    instanceId: identity.instanceId,
    channelNonce: identity.nonce,
    connectionGeneration: identity.generation,
    connectionId: identity.connectionId,
  }, '*');
  return true;
}


function requestPlayerHandshake(attempt = 0) {
  if (!playerPreviewReady() || !playerFrameNode()?.contentWindow) {
    if (!state.playerHandshakeTimer) {
      state.playerHandshakeTimer = window.setTimeout(() => {
        state.playerHandshakeTimer = null;
        requestPlayerHandshake(0);
      }, 250);
    }
    return;
  }
  if (state.playerChannelConnected) return;
  if (attempt === 0 && state.playerHandshakeTimer) return;

  const identity = ensurePlayerChannelIdentity();
  openPlayerConnection(identity);
  if (state.playerChannelConnected) return;
  if (state.playerHandshakeTimer) clearTimeout(state.playerHandshakeTimer);
  state.playerHandshakeTimer = window.setTimeout(() => {
    state.playerHandshakeTimer = null;
    if (attempt >= HANDSHAKE_RETRY_DELAYS_MS.length - 1) {
      recoverPlayerFrame(
        readinessHandshakeSignals.has('bootstrap-ready')
          ? 'CONNECTION_TIMEOUT'
          : 'FRAME_BOOTSTRAP_TIMEOUT',
      );
      return;
    }
    requestPlayerHandshake(attempt + 1);
  }, HANDSHAKE_RETRY_DELAYS_MS[Math.min(attempt, HANDSHAKE_RETRY_DELAYS_MS.length - 1)]);
}


function syncPlayerRuntimeDom() {
  if (!state.playerRuntimeReady || state.playerHostLoading) return;
  document.querySelectorAll('.rl-player-runtime-overlay').forEach((node) => node.remove());
}


window.addEventListener('message', handlePlayerWindowMessage);
document.addEventListener('visibilitychange', handleVisibilityChange);


export {
  notifyPlayerFrameLoaded,
  playerFrameNode,
  playerHostUrl,
  postPlayerMessage,
  reportPlayerRuntimeLog,
  requestPlayerHandshake,
  resetPlayerChannelConnection,
  setPlayerMessageHandler,
  syncPlayerRuntimeDom,
};
