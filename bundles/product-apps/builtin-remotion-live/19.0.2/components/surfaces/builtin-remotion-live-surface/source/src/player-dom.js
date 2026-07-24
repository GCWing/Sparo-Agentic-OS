// remotion-live :: player-dom.js

import { PLAYER_CONTROL_PROTOCOL_VERSION } from './constants.js';
import { currentComposition } from './model.js';
import { ensurePlayerInstanceId, playerPreviewReady } from './preview-controller.js';
import { state } from './state.js';
import { t } from './util.js';

let channelIdentity = null;
let playerPort = null;
let playerMessageHandler = null;
let readinessHandshakeIdentityKey = null;
const readinessHandshakeSignals = new Set();

function randomNonce() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}


function playerFrameNode() {
  return document.querySelector('.rl-player-frame');
}


function closePlayerPort() {
  if (playerPort) {
    playerPort.onmessage = null;
    playerPort.onmessageerror = null;
    playerPort.close();
  }
  playerPort = null;
  state.playerChannelConnected = false;
  state.playerConnectionState = 'disconnected';
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


function ensurePlayerChannelIdentity() {
  const key = playerChannelKey();
  if (!channelIdentity || channelIdentity.key !== key) {
    closePlayerPort();
    resetReadinessHandshakeSignals();
    const instanceId = ensurePlayerInstanceId();
    channelIdentity = {
      key,
      instanceId,
      nonce: nonceFromRenderedFrame(instanceId) || randomNonce(),
    };
    state.playerChannelNonce = channelIdentity.nonce;
  }
  return channelIdentity;
}


function resetPlayerChannelConnection(options = {}) {
  closePlayerPort();
  if (state.playerHandshakeTimer) {
    clearTimeout(state.playerHandshakeTimer);
    state.playerHandshakeTimer = null;
  }
  if (options.rotateNonce) {
    channelIdentity = null;
    state.playerChannelNonce = null;
    resetReadinessHandshakeSignals();
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

  // A pre-load transfer can be lost before the child installs its connect
  // listener. The iframe load and bootstrap messages are monotonic readiness
  // signals, so each may replace that speculative lease exactly once. Repeated
  // bootstrap pulses never churn an in-flight MessagePort.
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


function handlePlayerBootstrap(event) {
  const node = playerFrameNode();
  const composition = currentComposition();
  const message = event.data || {};
  if (!node?.contentWindow) return;
  if (!composition || message.source !== 'sparo-remotion-player-host' || message.type !== 'bootstrapReady') return;
  if (message.protocolVersion !== PLAYER_CONTROL_PROTOCOL_VERSION) return;
  if (message.compositionId !== composition.id) return;
  if (message.projectRevision !== (state.manifest?.projectRevision || state.manifest?.sourceRevision)) return;
  if (message.descriptorRevision !== (composition.descriptorRevision || state.manifest?.descriptorRevision)) return;
  const identity = ensurePlayerChannelIdentity();
  if (message.instanceId !== identity.instanceId || message.channelNonce !== identity.nonce) return;
  // WebView2 may expose different WindowProxy identities for the same nested,
  // opaque iframe. The bootstrap message is a monotonic child-ready signal;
  // the private channel remains bound to this navigation by the high-entropy
  // nonce and immutable preview identity.
  activatePlayerHandshake('bootstrap-ready');
}


function handlePortMessage(identity, event) {
  const message = event.data || {};
  if (identity !== channelIdentity) return;
  if (message.source !== 'sparo-remotion-player-host') return;
  if (message.protocolVersion !== PLAYER_CONTROL_PROTOCOL_VERSION) return;
  if (message.instanceId !== identity.instanceId) return;
  if (message.channelNonce !== identity.nonce) return;

  if (message.type === 'channelReady') {
    state.playerChannelConnected = true;
    state.playerConnectionState = 'connected';
    if (state.playerHandshakeTimer) {
      clearTimeout(state.playerHandshakeTimer);
      state.playerHandshakeTimer = null;
    }
  }
  playerMessageHandler?.(message, { trusted: true });
}


function openPlayerChannel(identity) {
  const composition = currentComposition();
  const node = playerFrameNode();
  if (!composition || !node?.contentWindow || !playerPreviewReady()) return false;

  closePlayerPort();
  const channel = new MessageChannel();
  playerPort = channel.port1;
  playerPort.onmessage = (event) => handlePortMessage(identity, event);
  playerPort.onmessageerror = () => {
    if (identity !== channelIdentity) return;
    resetPlayerChannelConnection();
    state.playerRuntimeReady = false;
    requestPlayerHandshake();
  };
  playerPort.start();
  state.playerConnectionState = 'connecting';

  // The nested Player inherits an opaque sandbox origin. A transferred port is
  // the capability; the nonce binds it to this exact iframe navigation.
  node.contentWindow.postMessage({
    source: 'sparo-remotion-live',
    type: 'connect',
    protocolVersion: PLAYER_CONTROL_PROTOCOL_VERSION,
    compositionId: composition.id,
    projectRevision: state.manifest?.projectRevision || state.manifest?.sourceRevision,
    descriptorRevision: composition.descriptorRevision || state.manifest?.descriptorRevision,
    instanceId: identity.instanceId,
    channelNonce: identity.nonce,
  }, '*', [channel.port2]);
  return true;
}


function postPlayerMessage(type, payload = {}, options = {}) {
  const composition = currentComposition();
  const identity = ensurePlayerChannelIdentity();
  if (!composition || !playerPort || !state.playerChannelConnected || !playerPreviewReady()) return false;
  if (options.requireReady !== false && !state.playerRuntimeReady) return false;
  playerPort.postMessage({
    ...payload,
    source: 'sparo-remotion-live',
    type,
    protocolVersion: PLAYER_CONTROL_PROTOCOL_VERSION,
    compositionId: composition.id,
    projectRevision: state.manifest?.projectRevision || state.manifest?.sourceRevision,
    descriptorRevision: composition.descriptorRevision || state.manifest?.descriptorRevision,
    instanceId: identity.instanceId,
    channelNonce: identity.nonce,
  });
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
  openPlayerChannel(identity);
  if (state.playerChannelConnected) return;
  if (state.playerHandshakeTimer) clearTimeout(state.playerHandshakeTimer);
  state.playerHandshakeTimer = window.setTimeout(() => {
    state.playerHandshakeTimer = null;
    if (attempt >= 24) {
      closePlayerPort();
      state.playerConnectionState = 'failed';
      state.playerRuntimeReady = false;
      state.playerPhase = 'error';
      state.playerHostError = t('connectionTimeout');
      window.dispatchEvent(new CustomEvent('remotion-live:render-request'));
      return;
    }
    requestPlayerHandshake(attempt + 1);
  }, attempt < 4 ? 750 : 1500);
}


function syncPlayerRuntimeDom() {
  if (!state.playerRuntimeReady || state.playerHostLoading) return;
  document.querySelectorAll('.rl-player-runtime-overlay').forEach((node) => node.remove());
}


window.addEventListener('message', handlePlayerBootstrap);


export {
  notifyPlayerFrameLoaded,
  playerFrameNode,
  playerHostUrl,
  postPlayerMessage,
  requestPlayerHandshake,
  resetPlayerChannelConnection,
  setPlayerMessageHandler,
  syncPlayerRuntimeDom,
};
