// remotion-live :: preview-controller.js

import { PLAYER_CONTROL_PROTOCOL_VERSION, PLAYER_HOST_RUNTIME_VERSION } from './constants.js';
import { compositionDuration, currentComposition } from './model.js';
import { state } from './state.js';
import { clamp } from './util.js';

let instanceCounter = 0;
let commandCounter = 0;

function playerPreviewReady() {
  const composition = currentComposition();
  const projectRevision = state.manifest?.projectRevision || state.manifest?.sourceRevision;
  const descriptorRevision = composition?.descriptorRevision || state.manifest?.descriptorRevision;
  return Boolean(
    state.playerHost?.ready
      && state.playerHost?.url
      && state.playerHost?.runtimeVersion === PLAYER_HOST_RUNTIME_VERSION
      && state.playerHost?.protocolVersion === PLAYER_CONTROL_PROTOCOL_VERSION
      && state.playerHost?.projectRevision === projectRevision
      && state.playerHost?.descriptorRevision === descriptorRevision,
  );
}

function resetPlayerRuntimeState() {
  state.playerRuntimeReady = false;
  state.playerRuntimePlaying = false;
  state.playerRuntimeFrame = null;
  state.playerCommittedFrame = null;
  state.playerBuffering = false;
  state.playerSeeking = false;
  state.playerPhase = 'disconnected';
  state.playerRuntimeMuted = state.muted;
  state.playerRuntimeVolume = state.volume;
  state.playerDesiredState = null;
  state.playerActualState = null;
  state.playerDesiredRevision = 0;
  state.playerActualRevision = 0;
  state.playerChannelConnected = false;
  state.playerConnectionState = 'disconnected';
  state.playerChannelNonce = null;
  state.playerPendingCommand = null;
  state.playerInFlightCommand = null;
  state.playerInstanceId = null;
  state.playerStageKey = null;
  state.playerRenderedStageKey = null;
  state.playerFrameModel = null;

  if (state.playerHandshakeTimer) {
    clearTimeout(state.playerHandshakeTimer);
    state.playerHandshakeTimer = null;
  }
}

function playerStageKey(composition = currentComposition()) {
  const hostUrl = state.playerHost?.baseUrl || state.playerHost?.url || '';
  return [
    state.workspacePath || '',
    composition?.id || '',
    state.manifest?.buildId || '',
    state.manifest?.projectRevision || state.manifest?.sourceRevision || '',
    composition?.descriptorRevision || state.manifest?.descriptorRevision || '',
    hostUrl,
    state.playerReloadNonce || 0,
    PLAYER_HOST_RUNTIME_VERSION,
    PLAYER_CONTROL_PROTOCOL_VERSION,
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
  if (options.updateDesired !== false) {
    state.frame = nextFrame;
    if (options.touched !== false) state.frameTouched = true;
  }
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
    playing: Boolean(state.playerRuntimePlaying),
    muted: state.playerRuntimeMuted ?? state.muted ?? true,
    volume: state.playerRuntimeVolume ?? state.volume ?? 1,
    buffering: Boolean(state.playerBuffering),
    durationInFrames: composition?.durationInFrames ?? compositionDuration(composition),
    fps: composition?.fps ?? null,
    width: composition?.width ?? null,
    height: composition?.height ?? null,
    frameContext: state.playerFrameModel || null,
  };
}


export {
  applyPlayerFrame,
  currentPreviewSnapshot,
  ensurePlayerInstanceId,
  nextPlayerCommandId,
  normalizePreviewFrame,
  playerPreviewReady,
  playerStageKey,
  resetPlayerRuntimeState,
};
