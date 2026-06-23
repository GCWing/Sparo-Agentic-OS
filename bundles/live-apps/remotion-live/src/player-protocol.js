// remotion-live :: player-protocol.js

import { compositionDuration, currentComposition, selectedLayer } from './model.js';
import { applyPlayerFrame, currentPreviewSnapshot, nextPlayerCommandId, normalizePreviewFrame } from './preview-controller.js';
import { playerFrameNode, postPlayerMessage, requestPlayerHandshake, syncPlayerRuntimeDom } from './player-dom.js';
import { playerPreviewReady, usePlayerPreview, useStudioPreview } from './preview-mode.js';
import { state } from './state.js';
import { asArray, clamp } from './util.js';
import { setPlayingState, syncFrameDom, syncPlayingDom, syncSelectionOverlayDom } from './views.js';

const snapshotRequests = new Map();

function requestPlayerHostEnsure(force = false) {
  window.dispatchEvent(new CustomEvent('remotion-live:ensure-player-host', { detail: { force } }));
}


function requestPlayerHostStatusPoll() {
  window.dispatchEvent(new CustomEvent('remotion-live:poll-player-host-status'));
}


function requestRender() {
  window.dispatchEvent(new CustomEvent('remotion-live:render-request'));
}


function clearPlayerCommandFallback() {
  if (!state.playerCommandFallbackTimer) return;
  clearTimeout(state.playerCommandFallbackTimer);
  state.playerCommandFallbackTimer = null;
}


function clearInFlightCommand(commandId = null) {
  if (commandId && state.playerInFlightCommand?.commandId !== commandId) return false;
  state.playerInFlightCommand = null;
  clearPlayerCommandFallback();
  return true;
}


function preparePlayerCommand(type, payload = {}) {
  const frame = normalizePreviewFrame(payload.frame ?? state.frame);
  const commandId = payload.commandId || nextPlayerCommandId(type);
  return {
    type,
    commandId,
    frame,
    payload: {
      ...payload,
      frame,
      commandId,
    },
  };
}


function markCommandInFlight(command) {
  state.playerInFlightCommand = {
    commandId: command.commandId,
    type: command.type,
    frame: command.frame,
    startedAt: Date.now(),
  };
}


function postPreparedPlayerCommand(command, options = {}) {
  const posted = postPlayerMessage(command.type, command.payload, options);
  if (posted) markCommandInFlight(command);
  return posted;
}


function retryPlayerCommand(command) {
  requestPlayerHostStatusPoll();
  postPreparedPlayerCommand(command, { requireReady: false });
  requestPlayerHandshake();
}


function schedulePlayerCommandFallback(command) {
  if (!usePlayerPreview() || !playerPreviewReady()) return;
  clearPlayerCommandFallback();

  const epoch = ++state.playerControlEpoch;
  const expectedFrame = normalizePreviewFrame(command.frame);
  const startRuntimeFrame = Number(state.playerRuntimeFrame);
  const hasStartRuntimeFrame = Number.isFinite(startRuntimeFrame);
  const delay = command.type === 'play' ? 700 : command.type === 'pause' ? 260 : 300;

  state.playerCommandFallbackTimer = window.setTimeout(() => {
    state.playerCommandFallbackTimer = null;
    if (epoch !== state.playerControlEpoch || !playerPreviewReady()) return;
    if (state.playerInFlightCommand?.commandId !== command.commandId) return;

    if (command.type === 'pause') {
      if (!state.playing && state.playerRuntimePlaying) retryPlayerCommand(command);
      return;
    }

    if (command.type === 'seek') {
      const runtimeFrame = Number(state.playerRuntimeFrame);
      const hasRuntimeFrame = Number.isFinite(runtimeFrame);
      if (!hasRuntimeFrame || Math.abs(runtimeFrame - expectedFrame) > 1) {
        retryPlayerCommand(command);
      }
      return;
    }

    if (command.type === 'play') {
      if (!state.playing) return;
      const runtimeFrame = Number(state.playerRuntimeFrame);
      const hasRuntimeFrame = Number.isFinite(runtimeFrame);
      const baselineFrame = hasStartRuntimeFrame ? Math.max(expectedFrame, startRuntimeFrame) : expectedFrame;
      const advanced = hasRuntimeFrame && runtimeFrame > baselineFrame + 1;
      if (!advanced) retryPlayerCommand(command);
    }
  }, delay);
}


function queuePlayerCommand(command) {
  state.playerPendingCommand = command;
}


function sendOrQueuePlayerCommand(type, payload = {}) {
  const command = preparePlayerCommand(type, payload);
  if (postPreparedPlayerCommand(command)) {
    schedulePlayerCommandFallback(command);
    return true;
  }
  if (playerPreviewReady() && postPreparedPlayerCommand(command, { requireReady: false })) {
    schedulePlayerCommandFallback(command);
    requestPlayerHandshake();
    return true;
  }
  queuePlayerCommand(command);
  if (!playerPreviewReady() && state.workspacePath && currentComposition()) {
    requestPlayerHostEnsure();
  } else {
    requestPlayerHandshake();
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
    if (postPreparedPlayerCommand(pending)) {
      schedulePlayerCommandFallback(pending);
    } else {
      queuePlayerCommand(pending);
    }
    return;
  }

  const type = state.playing ? 'play' : state.playerRuntimePlaying ? 'pause' : 'seek';
  const command = preparePlayerCommand(type, { frame: state.frame });
  if (postPreparedPlayerCommand(command)) {
    schedulePlayerCommandFallback(command);
  }
}


function currentMessageBelongsToPreview(message) {
  if (message.source !== 'sparo-remotion-player-host') return false;
  const composition = currentComposition();
  if (message.compositionId && composition?.id && message.compositionId !== composition.id) return false;
  if (message.instanceId && state.playerInstanceId && message.instanceId !== state.playerInstanceId) return false;
  if (!state.playerInstanceId && message.instanceId) {
    state.playerInstanceId = String(message.instanceId);
  }
  return true;
}


function syncFrameFromPlayerMessage(frame) {
  const nextFrame = applyPlayerFrame(frame);
  syncFrameDom();
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
  if (state.selectedElementId && !selectedLayer()) {
    state.selectedElementId = null;
  }
  if (!syncSelectionOverlayDom()) requestRender();
}


function applySnapshotMessage(message) {
  const frame = message.frame !== undefined ? syncFrameFromPlayerMessage(message.frame) : normalizePreviewFrame(state.frame);
  if (typeof message.playing === 'boolean') {
    state.playerRuntimePlaying = message.playing;
    setPlayingState(message.playing);
  } else {
    syncPlayingDom();
  }
  if (message.frameContext) {
    applyFrameContextMessage({
      ...message.frameContext,
      frame,
      compositionId: message.compositionId,
    });
  }
  return {
    ok: true,
    source: 'player-snapshot',
    compositionId: message.compositionId || currentComposition()?.id || state.activeCompositionId,
    frame,
    playing: Boolean(message.playing),
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


function acknowledgeCommand(message) {
  const commandId = message.commandId || null;
  if (!state.playerInFlightCommand) return false;
  if (commandId && commandId !== state.playerInFlightCommand.commandId) return false;
  clearInFlightCommand(commandId || state.playerInFlightCommand.commandId);
  return true;
}


function handlePlayerHostMessage(message = {}) {
  if (!currentMessageBelongsToPreview(message)) return false;

  if (message.type === 'ready') {
    state.playerRuntimeReady = true;
    state.playerHostError = null;
    syncFrameFromPlayerMessage(message.frame ?? state.frame);
    if (typeof message.playing === 'boolean') {
      state.playerRuntimePlaying = message.playing;
    }
    syncPlayerRuntimeDom();
    flushPlayerCommand();
    return true;
  }

  if (message.type === 'snapshot') {
    resolveSnapshotRequest(message);
    return true;
  }

  if (message.type === 'frame') {
    if (message.frame !== undefined) syncFrameFromPlayerMessage(message.frame);
    if (typeof message.playing === 'boolean') {
      state.playerRuntimePlaying = message.playing;
    }
    return true;
  }

  if (message.type === 'frameContext') {
    applyFrameContextMessage(message);
    return true;
  }

  if (message.type === 'command') {
    acknowledgeCommand(message);
    if (message.frame !== undefined) syncFrameFromPlayerMessage(message.frame);
    if (typeof message.playing === 'boolean') {
      state.playerRuntimePlaying = message.playing;
      if (message.command === 'play') setPlayingState(message.playing);
      else syncPlayingDom();
    }
    return true;
  }

  if (message.type === 'play') {
    state.playerRuntimePlaying = true;
    if (message.frame !== undefined) syncFrameFromPlayerMessage(message.frame);
    if (!state.playing) {
      if (!state.playerInFlightCommand || state.playerInFlightCommand.type !== 'pause') {
        sendOrQueuePlayerCommand('pause', { frame: message.frame ?? state.frame });
      }
      return true;
    }
    setPlayingState(true);
    return true;
  }

  if (message.type === 'pause') {
    state.playerRuntimePlaying = false;
    if (message.frame !== undefined) syncFrameFromPlayerMessage(message.frame);
    if (!(state.playing && state.playerInFlightCommand?.type === 'play')) {
      setPlayingState(false);
    }
    return true;
  }

  if (message.type === 'ended') {
    state.playerRuntimePlaying = false;
    setPlayingState(false);
    if (message.frame !== undefined) syncFrameFromPlayerMessage(message.frame);
    return true;
  }

  if (message.type === 'error') {
    state.playerHostError = String(message.message || 'Player preview failed.');
    state.playerRuntimeReady = false;
    state.playerRuntimePlaying = false;
    clearInFlightCommand();
    setPlayingState(false);
    requestRender();
    return true;
  }

  return true;
}


function requestPlayerSnapshot(timeoutMs = 700) {
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


async function getPreviewSnapshot() {
  if (usePlayerPreview() && playerPreviewReady()) {
    const snapshot = await requestPlayerSnapshot();
    if (snapshot) return snapshot;
    return currentPreviewSnapshot('player-fallback');
  }
  if (useStudioPreview()) return currentPreviewSnapshot('studio-state');
  return currentPreviewSnapshot('still-state');
}


export {
  clearPlayerCommandFallback,
  flushPlayerCommand,
  getPreviewSnapshot,
  handlePlayerHostMessage,
  requestPlayerSnapshot,
  sendOrQueuePlayerCommand,
};
