// remotion-live :: player-dom.js (auto-split from ui.js; do not hand-merge)

import { currentComposition } from './model.js';
import { ensurePlayerInstanceId } from './preview-controller.js';
import { playerPreviewReady } from './preview-mode.js';
import { state } from './state.js';

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
    url.searchParams.set('instanceId', ensurePlayerInstanceId());
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
    ...payload,
    source: 'sparo-remotion-live',
    type,
    compositionId: composition.id,
    instanceId: ensurePlayerInstanceId(),
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


function syncPlayerRuntimeDom() {
  if (!state.playerRuntimeReady || state.playerHostLoading) return;
  document.querySelectorAll('.rl-player-runtime-overlay').forEach((node) => node.remove());
}


export { playerFrameNode, playerHostUrl, postPlayerMessage, requestPlayerHandshake, syncPlayerRuntimeDom };
