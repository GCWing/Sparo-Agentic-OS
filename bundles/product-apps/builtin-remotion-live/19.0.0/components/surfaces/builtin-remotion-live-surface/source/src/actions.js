import { callBackend } from './backend.js';
import { compositionDuration, currentComposition, defaultPreviewFrame, normalizeManifest } from './model.js';
import * as playerProtocol from './player-protocol.js';
import { resetPlayerChannelConnection } from './player-dom.js';
import { playerPreviewReady, resetPlayerRuntimeState } from './preview-controller.js';
import { clearPlayerHostPoll, ensurePlayerPreviewHost } from './preview-runtime.js';
import { refreshSelectionDom, render, setError, updateTimelineDom } from './render-core.js';
import { buildSelectedVideoContext, selectionContextSentence } from './selection-geom.js';
import { state } from './state.js';
import { clamp, projectName, round2, runtime, t } from './util.js';
import { isFrameCommitted } from './views.js';

let exportPollTimer = null;
let exportGeneration = 0;
let projectLoadGeneration = 0;
let projectLoadRequest = null;
const ACTIVE_EXPORT_STATUSES = new Set(['queued', 'running', 'cancelling']);

function applyProjectOutput(output) {
  const previousBuildId = state.manifest?.buildId || null;
  state.project = output?.project || output?.detection || output || null;
  state.manifest = normalizeManifest(output);
  const nextBuildId = state.manifest?.buildId || null;
  if (previousBuildId && nextBuildId && previousBuildId !== nextBuildId) {
    state.playerHost = null;
    resetPlayerChannelConnection({ rotateNonce: true });
    resetPlayerRuntimeState();
  }

  const composition = currentComposition();
  if (!state.activeCompositionId && composition) {
    state.activeCompositionId = composition.id;
    state.frame = defaultPreviewFrame(composition);
    state.frameTouched = false;
  } else if (!state.frameTouched && composition) {
    state.frame = defaultPreviewFrame(composition);
  }
}

function selectEntry(entryPoint) {
  if (!entryPoint) return;
  state.selectedEntry = entryPoint;
  void refreshProject();
}

async function loadProject(generation, workspacePath, entryPoint, freshSnapshot) {
  const input = entryPoint ? { entryPoint } : {};
  const isCurrent = () => (
    generation === projectLoadGeneration
      && state.workspacePath === workspacePath
      && state.selectedEntry === entryPoint
  );
  if (!workspacePath) {
    state.project = null;
    state.manifest = null;
    state.detection = null;
    state.phase = 'idle';
    render();
    return;
  }

  state.phase = 'detecting';
  render();
  try {
    const detection = await callBackend('detectProject', input);
    if (!isCurrent()) return;
    state.detection = detection || null;
    const status = detection?.status || (detection?.ok ? 'matched' : 'notFound');
    if (status === 'notFound' || status === 'broken' || status === 'ambiguous') {
      state.project = detection || null;
      state.manifest = null;
      state.activeCompositionId = null;
      state.phase = status;
      state.error = null;
      return;
    }

    state.phase = freshSnapshot ? 'bundling' : 'snapshot';
    render();
    const output = await callBackend(freshSnapshot ? 'compileProject' : 'getCompositionManifest', input);
    if (!isCurrent()) return;
    applyProjectOutput(output);
    state.phase = 'hostStarting';
    state.error = null;
    await ensurePlayerPreviewHost();
  } catch (error) {
    if (!isCurrent()) return;
    state.phase = 'error';
    setError(error);
  } finally {
    if (!isCurrent()) return;
    render();
  }
}

function refreshProject(options = {}) {
  const workspacePath = state.workspacePath;
  const entryPoint = state.selectedEntry;
  const freshSnapshot = options.fresh === true;
  const requestKey = `${workspacePath || ''}\u0000${entryPoint || ''}\u0000${freshSnapshot ? 'fresh' : 'cached'}`;
  if (projectLoadRequest?.key === requestKey) return projectLoadRequest.promise;

  const generation = ++projectLoadGeneration;
  const request = { key: requestKey, promise: null };
  request.promise = loadProject(generation, workspacePath, entryPoint, freshSnapshot).finally(() => {
    if (projectLoadRequest === request) projectLoadRequest = null;
  });
  projectLoadRequest = request;
  return request.promise;
}

function setComposition(id) {
  if (!id || id === state.activeCompositionId) return;
  playerProtocol.sendOrQueuePlayerCommand('pause', { frame: state.frame });
  state.activeCompositionId = id;
  state.frame = defaultPreviewFrame(currentComposition());
  state.frameTouched = false;
  state.selectedElementId = null;
  state.selection = null;
  state.playerHostError = null;
  resetPlayerChannelConnection({ rotateNonce: true });
  resetPlayerRuntimeState();
  clearPlayerHostPoll();
  render();
  void ensurePlayerPreviewHost(false);
}

function setFrame(frame, options = {}) {
  const duration = compositionDuration();
  state.frame = clamp(Math.round(Number(frame) || 0), 0, duration - 1);
  if (!options.silent) state.frameTouched = true;
  if (!playerPreviewReady()) void ensurePlayerPreviewHost();
  playerProtocol.sendOrQueuePlayerCommand('seek', { frame: state.frame });
  if (!options.fastSync) updateTimelineDom();
}

function stepFrame(delta) {
  playerProtocol.sendOrQueuePlayerCommand('pause', { frame: state.frame });
  setFrame(state.frame + delta);
}

function togglePlayback() {
  if (!playerPreviewReady()) void ensurePlayerPreviewHost();
  const wantsToPlay = Boolean(state.playerDesiredState?.playing ?? state.playerRuntimePlaying);
  if (wantsToPlay || state.playerRuntimePlaying) {
    playerProtocol.sendOrQueuePlayerCommand('pause', { frame: state.frame });
    return;
  }

  if (state.interactionMode === 'inspect') {
    state.interactionMode = 'preview';
    state.selectionDragging = false;
  }
  if (state.playerPhase === 'ended' || state.frame >= compositionDuration() - 1) {
    state.frame = 0;
  }
  playerProtocol.sendOrQueuePlayerCommand('play', { frame: state.frame });
  render();
}

function setInteractionMode(mode) {
  const next = mode === 'inspect' ? 'inspect' : 'preview';
  if (state.interactionMode === next) return;
  state.interactionMode = next;
  state.selectionDragging = false;
  state.selectionDraft = null;
  if (next === 'inspect') {
    playerProtocol.sendOrQueuePlayerCommand('pause', { frame: state.frame });
    playerProtocol.requestPlayerFrameContext?.();
  }
  render();
}

function toggleInspect() {
  setInteractionMode(state.interactionMode === 'inspect' ? 'preview' : 'inspect');
}

function toggleMuted() {
  state.muted = !state.muted;
  playerProtocol.setPlayerAudio?.({ muted: state.muted, volume: state.volume });
}

function setVolume(value) {
  const volume = clamp(Number(value) || 0, 0, 1);
  state.volume = volume;
  state.muted = volume === 0;
  playerProtocol.setPlayerAudio?.({ muted: state.muted, volume });
}

function retryPreview() {
  state.playerHostError = null;
  state.playerPhase = 'connecting';
  state.playerReloadNonce += 1;
  resetPlayerChannelConnection({ rotateNonce: true });
  resetPlayerRuntimeState();
  render();
  void ensurePlayerPreviewHost(true);
}

function requestExport() {
  if (!currentComposition() || ACTIVE_EXPORT_STATUSES.has(state.exportRun?.status)) return;
  state.exportConfirmOpen = true;
  render();
}

function restoreExportFocus() {
  queueMicrotask(() => document.querySelector('[data-action="start-export"]')?.focus());
}

function dismissExportDialog() {
  state.exportConfirmOpen = false;
  render();
  restoreExportFocus();
}

function dismissExportRun() {
  if (exportPollTimer) clearTimeout(exportPollTimer);
  exportPollTimer = null;
  exportGeneration += 1;
  state.exportRun = null;
  render();
}

function resetExportState() {
  if (exportPollTimer) clearTimeout(exportPollTimer);
  exportPollTimer = null;
  exportGeneration += 1;
  state.exportRun = null;
  state.exportConfirmOpen = false;
}

function scheduleExportPoll(delayMs = 700) {
  if (exportPollTimer) clearTimeout(exportPollTimer);
  exportPollTimer = window.setTimeout(() => {
    exportPollTimer = null;
    void pollExportStatus();
  }, delayMs);
}

function applyExportOutput(output) {
  const payload = output && Object.hasOwn(output, 'run')
    ? output.run || { status: 'failed', error: t('exportFailed') }
    : output;
  state.exportRun = { ...state.exportRun, ...payload };
  const status = state.exportRun?.status;
  if (ACTIVE_EXPORT_STATUSES.has(status)) {
    scheduleExportPoll();
  }
  render();
}

async function pollExportStatus() {
  const runId = state.exportRun?.runId;
  if (!runId) return;
  const generation = exportGeneration;
  try {
    const output = await callBackend('getExportStatus', { runId });
    if (generation !== exportGeneration || state.exportRun?.runId !== runId) return;
    applyExportOutput(output);
  } catch (error) {
    if (generation !== exportGeneration || state.exportRun?.runId !== runId) return;
    state.exportRun = { ...state.exportRun, status: 'failed', error: String(error?.message || error) };
    render();
  }
}

async function confirmExport() {
  const composition = currentComposition();
  if (!composition) return;
  state.exportConfirmOpen = false;
  state.exportRun = { status: 'queued', compositionId: composition.id, progress: 0 };
  const generation = ++exportGeneration;
  render();
  restoreExportFocus();
  try {
    const output = await callBackend('startExport', {
      compositionId: composition.id,
      expectedProjectRevision: state.manifest?.projectRevision || state.manifest?.sourceRevision,
      expectedDescriptorRevision: composition.descriptorRevision || state.manifest?.descriptorRevision,
      frameRange: [0, compositionDuration(composition) - 1],
    });
    if (generation !== exportGeneration) return;
    applyExportOutput(output);
  } catch (error) {
    if (generation !== exportGeneration) return;
    state.exportRun = { status: 'failed', error: String(error?.message || error) };
    render();
  }
}

async function cancelExport() {
  const runId = state.exportRun?.runId;
  if (!runId) return;
  const generation = exportGeneration;
  try {
    const output = await callBackend('cancelExport', { runId });
    if (generation !== exportGeneration || state.exportRun?.runId !== runId) return;
    applyExportOutput(output);
  } catch (error) {
    if (generation !== exportGeneration || state.exportRun?.runId !== runId) return;
    state.exportRun = { ...state.exportRun, error: String(error?.message || error) };
    render();
  }
}

async function sendContext() {
  if (!isFrameCommitted()) return;
  const snapshot = await playerProtocol.getPreviewSnapshot();
  const context = buildSelectedVideoContext();
  context.previewSnapshotSource = snapshot?.source || 'player-state';
  context.previewPlaying = Boolean(snapshot?.playing);
  context.playbackState = state.playerPhase;
  const sentence = selectionContextSentence(context);
  const basePrompt = t('askPrompt', {
    project: projectName(),
    composition: context.compositionId || '-',
    frame: context.frame,
    workspace: state.workspacePath || '-',
  });
  const prompt = `${basePrompt}\n\n${t('contextPayload')}: ${sentence}\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``;
  await runtime().host?.fillChatInput?.(prompt);
}

function selectPreviewLayer(layerId) {
  if (state.interactionMode !== 'inspect') return;
  state.selectedElementId = layerId || null;
  state.selection = layerId ? { type: 'element' } : null;
  refreshSelectionDom();
}

function setPointSelection(point) {
  if (state.interactionMode !== 'inspect') return;
  state.selectedElementId = null;
  state.selection = { type: 'point', point: { x: round2(point.x), y: round2(point.y) } };
  refreshSelectionDom();
}

function setRegionSelection(box) {
  if (state.interactionMode !== 'inspect') return;
  state.selectedElementId = null;
  state.selection = {
    type: 'region',
    normalizedBox: {
      x: round2(box.x),
      y: round2(box.y),
      width: round2(box.width),
      height: round2(box.height),
    },
  };
  refreshSelectionDom();
}

export {
  cancelExport,
  confirmExport,
  dismissExportDialog,
  dismissExportRun,
  refreshProject,
  requestExport,
  resetExportState,
  retryPreview,
  selectEntry,
  selectPreviewLayer,
  sendContext,
  setComposition,
  setFrame,
  setInteractionMode,
  setPointSelection,
  setRegionSelection,
  setVolume,
  stepFrame,
  toggleInspect,
  toggleMuted,
  togglePlayback,
};
