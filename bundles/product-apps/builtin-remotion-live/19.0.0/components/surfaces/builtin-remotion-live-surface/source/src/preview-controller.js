// remotion-live :: preview-controller.js

import { PLAYER_HOST_RUNTIME_VERSION } from './constants.js';
import { compositionDuration, currentComposition } from './model.js';
import { state } from './state.js';
import { clamp } from './util.js';

let instanceCounter = 0;
let commandCounter = 0;

function playerStageKey(composition = currentComposition()) {
  const hostUrl = state.playerHost?.baseUrl || state.playerHost?.url || '';
  return [
    state.previewMode || 'player',
    state.workspacePath || '',
    composition?.id || '',
    state.manifest?.buildId || '',
    hostUrl,
    PLAYER_HOST_RUNTIME_VERSION,
  ].join('|');
}


function ensurePlayerInstanceId() {
  const nextStageKey = playerStageKey();
  if (!state.playerInstanceId || state.playerStageKey !== nextStageKey) {
    instanceCounter += 1;
    state.playerInstanceId = `rl-${Date.now().toString(36)}-${instanceCounter}`;
    state.playerStageKey = nextStageKey;
  }
  return state.playerInstanceId;
}


function resetPlayerInstance() {
  state.playerInstanceId = null;
  state.playerStageKey = null;
  state.playerRenderedStageKey = null;
  state.playerInFlightCommand = null;
}


function nextPlayerCommandId(type = 'command') {
  commandCounter += 1;
  return `${ensurePlayerInstanceId()}-${type}-${commandCounter}`;
}


function normalizePreviewFrame(frame) {
  const duration = compositionDuration();
  return clamp(Math.round(Number(frame) || 0), 0, duration - 1);
}


function applyPlayerFrame(frame, options = {}) {
  const nextFrame = normalizePreviewFrame(frame);
  state.playerRuntimeFrame = nextFrame;
  state.frame = nextFrame;
  if (options.touched !== false) state.frameTouched = true;
  if (state.playerFrameModel && Math.round(Number(state.playerFrameModel.frame) || 0) !== nextFrame) {
    state.playerFrameModel = null;
  }
  return nextFrame;
}


function currentPreviewSnapshot(source = 'state') {
  const composition = currentComposition();
  const frame = normalizePreviewFrame(state.frame);
  return {
    ok: true,
    source,
    compositionId: composition?.id || state.activeCompositionId || null,
    frame,
    playing: Boolean(state.playerRuntimePlaying || state.playing),
    durationInFrames: composition?.durationInFrames ?? compositionDuration(composition),
    fps: composition?.fps ?? null,
    width: composition?.width ?? null,
    height: composition?.height ?? null,
    frameContext: state.playerFrameModel || state.frameModel || null,
  };
}


export {
  applyPlayerFrame,
  currentPreviewSnapshot,
  ensurePlayerInstanceId,
  nextPlayerCommandId,
  normalizePreviewFrame,
  playerStageKey,
  resetPlayerInstance,
};
