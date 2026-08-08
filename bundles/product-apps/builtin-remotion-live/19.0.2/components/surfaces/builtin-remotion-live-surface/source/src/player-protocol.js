// remotion-live :: player-protocol.js

import { compositionDuration, currentComposition, selectedLayer } from './model.js';
import { applyPlayerFrame, currentPreviewSnapshot, ensurePlayerInstanceId, nextPlayerCommandId, normalizePreviewFrame, playerPreviewReady } from './preview-controller.js';
import {
  playerFrameNode,
  postPlayerMessage,
  reportPlayerRuntimeLog,
  requestPlayerHandshake,
  resetPlayerChannelConnection,
  setPlayerMessageHandler,
  syncPlayerRuntimeDom,
} from './player-dom.js';
import {
  PLAYER_BASELINE_REVISION,
  isPlayerRuntimeEvidenceMessage,
  isStalePlayerStateMessage,
  playerMessageRevision,
} from './player-state-contract.js';
import { state } from './state.js';
import { asArray, clamp, rootElement } from './util.js';
import { setPlayingState, syncPhaseDom, syncPlaybackDom, syncPlayingDom, syncSelectionOverlayDom } from './views.js';

const snapshotRequests = new Map();
const PLAYER_COMMAND_SETTLE_TIMEOUT_MS = 2_500;
let playbackDomFrame = null;

function schedulePlaybackDomSync() {
  if (playbackDomFrame !== null) return;
  playbackDomFrame = window.requestAnimationFrame(() => {
    playbackDomFrame = null;
    syncPlayerStateAttributes();
    syncPlaybackDom();
  });
}

function requestPlayerHostEnsure(force = false) {
  window.dispatchEvent(new CustomEvent('remotion-live:ensure-player-host', { detail: { force } }));
}


function requestRender() {
  window.dispatchEvent(new CustomEvent('remotion-live:render-request'));
}


function clearPlayerCommandTimer() {
  if (!state.playerCommandTimer) return;
  clearTimeout(state.playerCommandTimer);
  state.playerCommandTimer = null;
}


function commandLogDetails(command = {}, details = {}) {
  return {
    commandId: command.commandId || null,
    command: command.command || command.type || null,
    revision: Number.isFinite(Number(command.revision)) ? Number(command.revision) : null,
    connectionGeneration: state.playerConnectionGeneration,
    connectionId: state.playerConnectionId,
    ...details,
  };
}


function reportPlayerControl(level, message, command, details = {}) {
  if (command?.type === 'seek' || command?.command === 'seek') return;
  reportPlayerRuntimeLog(level, message, commandLogDetails(command, details));
}


function resetDesiredStateToActual() {
  const actual = state.playerActualState || {};
  const revision = Math.max(
    Number(state.playerDesiredRevision) || 0,
    Number(state.playerActualRevision) || PLAYER_BASELINE_REVISION,
  );
  state.playerDesiredRevision = revision;
  state.playerDesiredState = {
    instanceId: state.playerInstanceId || null,
    revision,
    frame: normalizePreviewFrame(actual.frame ?? state.playerRuntimeFrame ?? state.frame),
    playing: Boolean(actual.playing ?? state.playerRuntimePlaying),
    muted: Boolean(actual.muted ?? state.playerRuntimeMuted ?? state.muted),
    volume: clamp(Number(actual.volume ?? state.playerRuntimeVolume ?? state.volume) || 0, 0, 1),
  };
  syncPlayingDom();
}


function startPlayerCommandTimer(command) {
  clearPlayerCommandTimer();
  state.playerCommandTimer = window.setTimeout(() => {
    state.playerCommandTimer = null;
    void verifyTimedOutPlayerCommand(command);
  }, PLAYER_COMMAND_SETTLE_TIMEOUT_MS);
}


async function verifyTimedOutPlayerCommand(command) {
  if (state.playerInFlightCommand?.commandId !== command.commandId) return;
  const snapshot = state.playerChannelConnected
    ? await requestPlayerSnapshot(750)
    : null;
  if (state.playerInFlightCommand?.commandId !== command.commandId) return;

  const timedOut = state.playerInFlightCommand;
  if (snapshot && settleInFlightCommand(state.playerActualState || snapshot)) {
    syncPlaybackDom();
    return;
  }

  state.playerInFlightCommand = null;
  state.playerPendingCommand = null;
  state.playerNeedsReconcile = false;
  if (!snapshot) {
    reportPlayerControl('warn', 'Remotion preview command response timed out', timedOut, {
      accepted: Boolean(timedOut.accepted),
      timeoutMs: PLAYER_COMMAND_SETTLE_TIMEOUT_MS + 750,
    });
    resetPlayerChannelConnection();
    state.playerRuntimeReady = false;
    setPlayerPhase('connecting');
    requestPlayerHandshake();
    syncPlaybackDom();
    return;
  }

  resetDesiredStateToActual();
  reportPlayerControl('warn', 'Remotion preview command did not settle', timedOut, {
    accepted: Boolean(timedOut.accepted),
    timeoutMs: PLAYER_COMMAND_SETTLE_TIMEOUT_MS,
  });
  syncPlaybackDom();
}


function syncPlayerStateAttributes() {
  const root = rootElement();
  if (!root) return;
  root.dataset.playerPhase = state.playerPhase || 'disconnected';
  root.dataset.playerBuffering = String(Boolean(state.playerBuffering));
  root.dataset.playerSeeking = String(Boolean(state.playerSeeking));
  root.dataset.playerReady = String(Boolean(state.playerRuntimeReady));
}


function setPlayerPhase(phase) {
  state.playerPhase = phase;
  syncPlayerStateAttributes();
  syncPhaseDom();
}


function desiredState() {
  const instanceId = state.playerInstanceId || null;
  if (state.playerDesiredState?.instanceId === instanceId) return state.playerDesiredState;
  state.playerDesiredState = {
    instanceId,
    revision: Number(state.playerDesiredRevision) || 0,
    frame: normalizePreviewFrame(state.frame),
    playing: Boolean(state.playerRuntimePlaying),
    muted: state.muted !== false,
    volume: clamp(Number.isFinite(Number(state.volume)) ? Number(state.volume) : 1, 0, 1),
  };
  return state.playerDesiredState;
}


function nextDesiredState(type, payload = {}) {
  const previous = desiredState();
  const next = { ...previous };
  if (payload.frame !== undefined) next.frame = normalizePreviewFrame(payload.frame);

  if (type === 'play') next.playing = true;
  if (type === 'pause') next.playing = false;
  if (type === 'toggle') next.playing = !next.playing;
  if (type === 'mute') next.muted = payload.muted !== false;
  if (type === 'unmute') next.muted = false;
  if (type === 'volume') {
    next.volume = clamp(Number(payload.volume) || 0, 0, 1);
    if (payload.muted !== undefined) next.muted = Boolean(payload.muted);
  }

  const revision = Math.max(
    Number(state.playerDesiredRevision) || 0,
    Number(state.playerActualRevision) || 0,
  ) + 1;
  next.instanceId = state.playerInstanceId || null;
  next.revision = revision;
  state.playerDesiredRevision = revision;
  state.playerDesiredState = next;
  state.muted = next.muted;
  state.volume = next.volume;
  syncPlayingDom();
  return next;
}


function preparePlayerCommand(type, payload = {}) {
  ensurePlayerInstanceId();
  const desired = nextDesiredState(type, payload);
  const commandId = payload.commandId || nextPlayerCommandId(type);
  return {
    type,
    commandId,
    revision: desired.revision,
    desired,
    payload: {
      commandId,
      command: type,
      revision: desired.revision,
      desired,
    },
  };
}


function markCommandInFlight(command) {
  state.playerInFlightCommand = {
    commandId: command.commandId,
    type: command.type,
    revision: command.revision,
    desired: command.desired,
    accepted: false,
    startedAt: Date.now(),
  };
  startPlayerCommandTimer(command);
  if (command.type === 'seek') {
    state.playerCommittedFrame = null;
    state.playerSeeking = true;
    setPlayerPhase('seeking');
  }
}


function postPreparedPlayerCommand(command) {
  const posted = postPlayerMessage('reconcile', command.payload, { requireReady: false });
  if (posted) {
    markCommandInFlight(command);
    state.playerPendingCommand = null;
    reportPlayerControl('debug', 'Remotion preview command sent', command);
  }
  return posted;
}


function queuePlayerCommand(command) {
  // This is a complete desired-state snapshot, not a lossy one-command queue.
  if (Number(command.revision) > Number(state.playerInFlightCommand?.revision ?? PLAYER_BASELINE_REVISION)) {
    clearPlayerCommandTimer();
    state.playerInFlightCommand = null;
    state.playerNeedsReconcile = false;
  }
  state.playerPendingCommand = command;
  reportPlayerControl('debug', 'Remotion preview command queued', command, {
    channelConnected: Boolean(state.playerChannelConnected),
    runtimeReady: Boolean(state.playerRuntimeReady),
  });
}


function sendOrQueuePlayerCommand(type, payload = {}) {
  const command = preparePlayerCommand(type, payload);
  if (postPreparedPlayerCommand(command)) return true;

  queuePlayerCommand(command);
  if (!playerPreviewReady() && state.workspacePath && currentComposition()) {
    requestPlayerHostEnsure();
  } else {
    requestPlayerHandshake();
  }
  return false;
}


function flushPlayerCommand() {
  if (!state.playerChannelConnected) return;
  const pending = state.playerPendingCommand;
  if (pending) {
    if (!postPreparedPlayerCommand(pending)) queuePlayerCommand(pending);
    return;
  }

  const desired = desiredState();
  if (state.playerInFlightCommand?.revision === desired.revision) return;
  const commandId = nextPlayerCommandId('reconcile');
  const command = {
    type: desired.playing ? 'play' : 'pause',
    commandId,
    revision: desired.revision,
    desired,
    payload: {
      commandId,
      command: 'reconcile',
      revision: desired.revision,
      desired,
    },
  };
  postPreparedPlayerCommand(command);
}


function currentMessageBelongsToPreview(message, options = {}) {
  if (options.trusted !== true) return false;
  if (message.source !== 'sparo-remotion-player-host') return false;
  const composition = currentComposition();
  if (message.compositionId !== composition?.id) return false;
  if (message.projectRevision !== (state.manifest?.projectRevision || state.manifest?.sourceRevision)) return false;
  if (message.descriptorRevision !== (composition?.descriptorRevision || state.manifest?.descriptorRevision)) return false;
  if (message.instanceId !== state.playerInstanceId) return false;
  if (message.channelNonce !== state.playerChannelNonce) return false;
  if (message.connectionGeneration !== state.playerConnectionGeneration) return false;
  if (message.connectionId !== state.playerConnectionId) return false;
  return true;
}


function syncFrameFromPlayerMessage(frame, playing = state.playerRuntimePlaying) {
  const desiredFrame = Number(state.playerInFlightCommand?.desired?.frame);
  const pendingSeek = state.playerInFlightCommand?.type === 'seek'
    && Number.isFinite(desiredFrame)
    && Number(frame) !== desiredFrame;
  const nextFrame = applyPlayerFrame(frame, { updateDesired: !pendingSeek });
  if (playing && state.playerDesiredState?.playing) {
    state.playerDesiredState = { ...state.playerDesiredState, frame: nextFrame };
  }
  return nextFrame;
}


function applyFrameContextMessage(message) {
  const composition = currentComposition();
  const frameContext = message.frameContext || message;
  const frame = clamp(Number(frameContext.frame ?? message.frame ?? state.frame) || 0, 0, compositionDuration(composition) - 1);
  state.playerFrameModel = {
    ok: true,
    compositionId: frameContext.compositionId || message.compositionId || composition?.id || state.activeCompositionId,
    frame,
    timeSeconds: frameContext.timeSeconds ?? (composition?.fps ? frame / composition.fps : null),
    composition: frameContext.composition || composition || null,
    measurement: frameContext.measurement || 'player-dom',
    layers: asArray(frameContext.layers),
  };
  if (state.selectedElementId && !selectedLayer()) state.selectedElementId = null;
  if (!syncSelectionOverlayDom()) requestRender();
}


function mergeActualState(message = {}) {
  const previous = state.playerActualState || {};
  const revision = Number(message.revision);
  const currentRevision = Number(state.playerActualRevision) || 0;
  if (Number.isFinite(revision) && revision < currentRevision) return previous;
  const nextRevision = Number.isFinite(revision)
    ? revision
    : currentRevision;
  const actual = {
    ...previous,
    ...(message.actual && typeof message.actual === 'object' ? message.actual : {}),
    instanceId: state.playerInstanceId,
    revision: nextRevision,
    projectRevision: message.projectRevision,
    descriptorRevision: message.descriptorRevision,
  };
  if (message.frame !== undefined) actual.frame = normalizePreviewFrame(message.frame);
  if (typeof message.playing === 'boolean') actual.playing = message.playing;
  if (typeof message.buffering === 'boolean') actual.buffering = message.buffering;
  if (typeof message.seeking === 'boolean') actual.seeking = message.seeking;
  if (typeof message.muted === 'boolean') actual.muted = message.muted;
  if (Number.isFinite(Number(message.volume))) actual.volume = clamp(Number(message.volume), 0, 1);

  state.playerActualRevision = nextRevision;
  state.playerActualState = actual;
  if (actual.frame !== undefined) syncFrameFromPlayerMessage(actual.frame, actual.playing);
  if (typeof actual.playing === 'boolean') state.playerRuntimePlaying = actual.playing;
  if (typeof actual.buffering === 'boolean') state.playerBuffering = actual.buffering;
  if (typeof actual.seeking === 'boolean') state.playerSeeking = actual.seeking;
  if (typeof actual.muted === 'boolean') state.playerRuntimeMuted = actual.muted;
  if (Number.isFinite(Number(actual.volume))) state.playerRuntimeVolume = actual.volume;
  return actual;
}


function commandIsSettled(command, actual) {
  if (!command || Number(actual.revision) < Number(command.revision)) return false;
  if (command.type === 'play') return actual.playing === true;
  if (command.type === 'pause') return actual.playing === false;
  if (command.type === 'seek') return Number(actual.frame) === Number(command.desired.frame) && !actual.seeking;
  if (command.type === 'mute' || command.type === 'unmute') return actual.muted === command.desired.muted;
  if (command.type === 'volume') {
    return Math.abs(Number(actual.volume) - Number(command.desired.volume)) < 0.001
      && actual.muted === command.desired.muted;
  }
  return true;
}


function settleInFlightCommand(actual) {
  if (!commandIsSettled(state.playerInFlightCommand, actual)) return false;
  const settled = state.playerInFlightCommand;
  clearPlayerCommandTimer();
  state.playerInFlightCommand = null;
  state.playerPendingCommand = null;
  state.playerNeedsReconcile = false;
  reportPlayerControl('debug', 'Remotion preview command settled', settled, {
    actualPlaying: Boolean(actual.playing),
    actualFrame: actual.frame,
  });
  return true;
}


function applySnapshotMessage(message) {
  const actual = mergeActualState(message);
  if (message.frameContext) applyFrameContextMessage({ ...message.frameContext, frame: actual.frame });
  return {
    ok: true,
    source: 'player-snapshot',
    projectRevision: message.projectRevision,
    descriptorRevision: message.descriptorRevision,
    compositionId: message.compositionId || currentComposition()?.id || state.activeCompositionId,
    frame: actual.frame ?? normalizePreviewFrame(state.frame),
    playing: Boolean(actual.playing),
    muted: actual.muted,
    volume: actual.volume,
    buffering: Boolean(actual.buffering),
    durationInFrames: message.durationInFrames ?? currentComposition()?.durationInFrames ?? compositionDuration(),
    fps: message.fps ?? currentComposition()?.fps ?? null,
    width: message.width ?? currentComposition()?.width ?? null,
    height: message.height ?? currentComposition()?.height ?? null,
    frameContext: message.frameContext || state.playerFrameModel || null,
  };
}


function resolveSnapshotRequest(message) {
  const requestId = message.requestId;
  if (!requestId || !snapshotRequests.has(requestId)) return false;
  const request = snapshotRequests.get(requestId);
  snapshotRequests.delete(requestId);
  clearTimeout(request.timer);
  request.resolve(applySnapshotMessage(message));
  return true;
}


function beginPlayerStateConnection(message) {
  if (state.playerStateConnectionId === message.connectionId) return false;
  clearPlayerCommandTimer();
  state.playerStateConnectionId = message.connectionId;
  state.playerActualRevision = PLAYER_BASELINE_REVISION;
  state.playerActualState = null;
  state.playerCommittedFrame = null;
  state.playerInFlightCommand = null;
  state.playerNeedsReconcile = false;
  state.playerRuntimeReady = false;
  state.playerRuntimePlaying = false;
  state.playerRuntimeFrame = null;
  state.playerBuffering = false;
  state.playerSeeking = false;
  reportPlayerRuntimeLog('info', 'Remotion preview state connection opened', {
    connectionGeneration: state.playerConnectionGeneration,
    connectionId: message.connectionId,
    desiredRevision: state.playerDesiredState?.revision ?? null,
  });
  return true;
}


function markPlayerRuntimeEvidence(message) {
  if (!isPlayerRuntimeEvidenceMessage(message)) return;
  const wasReady = state.playerRuntimeReady;
  state.playerRuntimeReady = true;
  state.playerConnectionState = 'connected';
  state.playerHostError = null;
  if (!wasReady) syncPlayerRuntimeDom();
}


function rebaseDesiredStateRevision() {
  const desired = desiredState();
  const revision = Math.max(
    Number(desired.revision) || 0,
    Number(state.playerActualRevision) + 1,
  );
  state.playerDesiredRevision = revision;
  state.playerDesiredState = { ...desired, revision };
}


function reconcileRejectedCommandAfterActualState() {
  if (!state.playerNeedsReconcile) return;
  state.playerNeedsReconcile = false;
  state.playerInFlightCommand = null;
  clearPlayerCommandTimer();
  rebaseDesiredStateRevision();
  flushPlayerCommand();
}


function handlePlayerHostMessage(message = {}, options = {}) {
  if (!currentMessageBelongsToPreview(message, options)) return false;

  if (message.type === 'channelReady') {
    beginPlayerStateConnection(message);
    setPlayerPhase('connecting');
    flushPlayerCommand();
    return true;
  }

  markPlayerRuntimeEvidence(message);
  if (isStalePlayerStateMessage(message, state.playerActualRevision)) {
    reportPlayerRuntimeLog('debug', 'Ignored stale Remotion preview state', {
      messageType: message.type,
      messageRevision: playerMessageRevision(message),
      actualRevision: state.playerActualRevision,
      connectionGeneration: state.playerConnectionGeneration,
      connectionId: state.playerConnectionId,
    });
    return true;
  }

  if (message.type === 'ready') {
    const actual = mergeActualState({ ...message, buffering: false, seeking: false });
    setPlayingState(Boolean(actual.playing));
    setPlayerPhase(actual.playing ? 'playing' : 'paused');
    syncPlaybackDom();
    syncPlayerRuntimeDom();
    flushPlayerCommand();
    return true;
  }

  if (message.type === 'snapshot') {
    resolveSnapshotRequest(message);
    return true;
  }

  if (message.type === 'frameContext') {
    applyFrameContextMessage(message);
    return true;
  }

  if (message.type === 'commandAccepted') {
    const accepted = message.accepted !== false;
    reportPlayerControl(accepted ? 'debug' : 'warn', accepted
      ? 'Remotion preview command accepted'
      : 'Remotion preview command rejected', message, {
      accepted,
      reason: message.reason || null,
    });
    if (state.playerInFlightCommand?.commandId === message.commandId) {
      state.playerInFlightCommand.accepted = accepted;
      state.playerInFlightCommand.acceptedAt = Date.now();
      if (!accepted) state.playerNeedsReconcile = true;
    }
    return true;
  }

  if (message.type === 'commandFailed') {
    reportPlayerControl('warn', 'Remotion preview command failed', message, {
      reason: message.message || null,
    });
    if (state.playerInFlightCommand?.commandId === message.commandId) {
      clearPlayerCommandTimer();
      state.playerInFlightCommand = null;
      state.playerPendingCommand = null;
      state.playerNeedsReconcile = false;
      resetDesiredStateToActual();
      syncPlaybackDom();
    }
    return true;
  }

  if (message.type === 'frameCommitted' || message.type === 'actualState') {
    const actual = mergeActualState(message);
    if (message.type === 'frameCommitted') state.playerCommittedFrame = actual.frame;
    settleInFlightCommand(actual);
    reconcileRejectedCommandAfterActualState();
    state.playerPhase = actual.buffering
      ? 'buffering'
      : actual.seeking
      ? 'seeking'
      : actual.playing
      ? 'playing'
      : 'paused';
    schedulePlaybackDomSync();
    return true;
  }

  if (message.type === 'seekSettled') {
    const actual = mergeActualState({ ...message, seeking: false });
    state.playerSeeking = false;
    settleInFlightCommand(actual);
    setPlayerPhase(actual.playing ? 'playing' : 'paused');
    syncPlaybackDom();
    return true;
  }

  if (message.type === 'playing') {
    const actual = mergeActualState({ ...message, playing: true, buffering: false });
    state.playerBuffering = false;
    setPlayingState(true);
    settleInFlightCommand(actual);
    setPlayerPhase('playing');
    syncPlaybackDom();
    return true;
  }

  if (message.type === 'paused') {
    const actual = mergeActualState({ ...message, playing: false });
    setPlayingState(false);
    settleInFlightCommand(actual);
    setPlayerPhase('paused');
    syncPlaybackDom();
    return true;
  }

  if (message.type === 'buffering') {
    mergeActualState(message);
    state.playerBuffering = Boolean(message.buffering);
    setPlayerPhase(state.playerBuffering ? 'buffering' : state.playerRuntimePlaying ? 'playing' : 'paused');
    syncPlaybackDom();
    return true;
  }

  if (message.type === 'ended') {
    const actual = mergeActualState({ ...message, playing: false, buffering: false, seeking: false });
    if (state.playerDesiredState) {
      state.playerDesiredState = { ...state.playerDesiredState, frame: actual.frame, playing: false };
    }
    state.playerBuffering = false;
    state.playerSeeking = false;
    clearPlayerCommandTimer();
    state.playerInFlightCommand = null;
    state.playerNeedsReconcile = false;
    setPlayingState(false);
    setPlayerPhase('ended');
    syncPlaybackDom();
    return true;
  }

  if (message.type === 'error') {
    clearPlayerCommandTimer();
    state.playerHostError = String(message.message || 'Player preview failed.');
    state.playerRuntimeReady = false;
    state.playerRuntimePlaying = false;
    state.playerBuffering = false;
    state.playerSeeking = false;
    state.playerInFlightCommand = null;
    state.playerNeedsReconcile = false;
    if (state.playerDesiredState) state.playerDesiredState = { ...state.playerDesiredState, playing: false };
    setPlayingState(false);
    setPlayerPhase('error');
    requestRender();
    return true;
  }

  return false;
}


function requestPlayerSnapshot(timeoutMs = 1_000) {
  if (!playerPreviewReady() || !playerFrameNode()) return Promise.resolve(null);
  const requestId = nextPlayerCommandId('snapshot');
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      snapshotRequests.delete(requestId);
      resolve(null);
    }, timeoutMs);
    snapshotRequests.set(requestId, { resolve, timer });
    const posted = postPlayerMessage('snapshot', { requestId }, { requireReady: false });
    if (!posted) {
      clearTimeout(timer);
      snapshotRequests.delete(requestId);
      resolve(null);
    }
  });
}


function requestPlayerFrameContext() {
  return postPlayerMessage('frameContext', {}, { requireReady: false });
}


function setPlayerAudio({ muted, volume } = {}) {
  if (volume !== undefined) return sendOrQueuePlayerCommand('volume', { volume, muted });
  return sendOrQueuePlayerCommand(muted === false ? 'unmute' : 'mute', { muted });
}


async function getPreviewSnapshot() {
  if (playerPreviewReady()) {
    const snapshot = await requestPlayerSnapshot();
    if (snapshot) return snapshot;
    return currentPreviewSnapshot('player-unavailable');
  }
  return currentPreviewSnapshot('player-state');
}


setPlayerMessageHandler(handlePlayerHostMessage);

export {
  flushPlayerCommand,
  getPreviewSnapshot,
  handlePlayerHostMessage,
  requestPlayerFrameContext,
  requestPlayerSnapshot,
  sendOrQueuePlayerCommand,
  setPlayerAudio,
  syncPlayerStateAttributes,
};
