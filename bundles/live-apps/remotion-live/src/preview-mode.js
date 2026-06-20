// remotion-live :: preview-mode.js (auto-split from ui.js; do not hand-merge)

import { PLAYER_HOST_RUNTIME_VERSION } from './constants.js';
import { state } from './state.js';

function useStudioPreview() {
  return state.previewMode === 'studio';
}


function usePlayerPreview() {
  return state.previewMode === 'player';
}


function useStillPreview() {
  return state.previewMode === 'still';
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
  state.playerFrameModel = null;
  if (state.playerHandshakeTimer) {
    clearTimeout(state.playerHandshakeTimer);
    state.playerHandshakeTimer = null;
  }
  if (state.playerCommandFallbackTimer) {
    clearTimeout(state.playerCommandFallbackTimer);
    state.playerCommandFallbackTimer = null;
  }
}


export { playerPreviewReady, resetPlayerRuntimeState, studioPreviewReady, usePlayerPreview, useStudioPreview };
