// remotion-live :: entry (ui.js). Event dispatcher + bootstrap. Logic split into ./src/*.js

import { confirmExport, dismissExportDialog, dismissExportRun, refreshProject, requestExport, scheduleSelectionGuardRelease, selectEntry, selectPreviewLayer, sendContext, setComposition, setFrame, setPointSelection, setPreviewMode, setRegionSelection, stepFrame, togglePlayback } from './src/actions.js';
import { normalizeRoute } from './src/constants.js';
import { compositionDuration, currentComposition, selectedLayer } from './src/model.js';
import { requestPlayerHandshake, syncPlayerRuntimeDom } from './src/player-dom.js';
import { resetPlayerRuntimeState } from './src/preview-mode.js';
import { clearPlayerCommandFallback, clearPlayerHostPoll, clearPreviewServerPoll, ensurePreviewServer, evaluateCurrentFrame, flushPlayerCommand, sendOrQueuePlayerCommand, stopPreviewServer } from './src/preview-runtime.js';
import { clearSelection, render, renderStill, updateTimelineDom } from './src/render-core.js';
import { hasLiveTextSelection, isSelectionStartTarget, pausePlaybackForSelection, stageNormalizedPoint } from './src/selection-geom.js';
import { previewClipCache, previewFrameCache, state } from './src/state.js';
import { asArray, clamp, closestElement, runtime } from './src/util.js';
import { fitPreviewStage, removeDraftMarker, setPlayingState, syncFrameFromPlayer, syncSelectionOverlayDom, updateDraftMarkerDom } from './src/views.js';

function handleRouteEvent(payload = {}) {
  state.route = normalizeRoute(payload.route || state.route);
  state.tabId = payload.tabId || state.tabId;
  state.sessionId = payload.sessionId || state.sessionId;
  const nextWorkspace = payload.workspacePath || payload.workbench?.workspacePath || state.workspacePath;
  const workspaceChanged = nextWorkspace && nextWorkspace !== state.workspacePath;
  state.workspacePath = nextWorkspace || state.workspacePath;
  if (workspaceChanged) {
    clearPlayerHostPoll();
    clearPreviewServerPoll();
    previewFrameCache.clear();
    previewClipCache.clear();
    state.previewFrame = null;
    state.previewClip = null;
    state.previewError = null;
    state.previewClipError = null;
    state.playerHost = null;
    state.playerHostError = null;
    state.playerHostLoading = false;
    resetPlayerRuntimeState();
    state.selectedElementId = null;
    state.detection = null;
    state.selectedEntry = null;
    state.selection = null;
    state.selectionDraft = null;
    state.selectionDragging = false;
    state.previewServer = null;
    state.previewServerError = null;
    state.previewServerLoading = false;
  }
  render();
  if (workspaceChanged || (!state.project && state.workspacePath)) {
    void refreshProject();
  }
}

document.addEventListener('pointerdown', (event) => {
  if (!isSelectionStartTarget(event.target)) return;
  state.selectionPointerDown = true;
  state.selectionGuard = true;
  pausePlaybackForSelection();
}, true);

document.addEventListener('pointerup', () => {
  if (!state.selectionPointerDown) return;
  state.selectionPointerDown = false;
  scheduleSelectionGuardRelease();
}, true);

// Point / region selection drawing on the preview stage (P2).
document.addEventListener('pointerdown', (event) => {
  const capture = closestElement(event.target, '[data-select-capture]');
  if (!capture || event.button !== 0) return;
  const start = stageNormalizedPoint(event);
  if (!start) return;
  state.selectionDragging = true;
  state.selectionDraft = {
    startX: start.x,
    startY: start.y,
    x: start.x,
    y: start.y,
    width: 0,
    height: 0,
    moved: false,
  };
  try {
    capture.setPointerCapture(event.pointerId);
  } catch (_error) {
    // setPointerCapture is best-effort; drawing still works without it.
  }
  updateDraftMarkerDom();
}, true);

document.addEventListener('pointermove', (event) => {
  if (!state.selectionDragging || !state.selectionDraft) return;
  const current = stageNormalizedPoint(event);
  if (!current) return;
  const draft = state.selectionDraft;
  draft.x = Math.min(draft.startX, current.x);
  draft.y = Math.min(draft.startY, current.y);
  draft.width = Math.abs(current.x - draft.startX);
  draft.height = Math.abs(current.y - draft.startY);
  if (draft.width > 1.5 || draft.height > 1.5) draft.moved = true;
  updateDraftMarkerDom();
}, true);

document.addEventListener('pointerup', (event) => {
  if (!state.selectionDragging) return;
  state.selectionDragging = false;
  const draft = state.selectionDraft;
  state.selectionDraft = null;
  removeDraftMarker();
  if (!draft) return;
  if (draft.moved && (draft.width > 1.5 || draft.height > 1.5)) {
    setRegionSelection({ x: draft.x, y: draft.y, width: draft.width, height: draft.height });
  } else {
    setPointSelection({ x: draft.startX, y: draft.startY });
  }
}, true);

document.addEventListener('selectstart', (event) => {
  if (!isSelectionStartTarget(event.target)) return;
  state.selectionGuard = true;
  pausePlaybackForSelection();
}, true);

document.addEventListener('selectionchange', () => {
  if (hasLiveTextSelection()) {
    state.selectionGuard = true;
    pausePlaybackForSelection();
    return;
  }
  if (!state.selectionPointerDown) {
    scheduleSelectionGuardRelease();
  }
});

window.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.source !== 'sparo-remotion-player-host') return;
  const composition = currentComposition();
  if (message.compositionId && composition?.id && message.compositionId !== composition.id) return;
  if (message.type === 'ready') {
    state.playerRuntimeReady = true;
    state.playerHostError = null;
    syncFrameFromPlayer(message.frame ?? state.frame);
    syncPlayerRuntimeDom();
    flushPlayerCommand();
  }
  if (message.type === 'frame') {
    clearPlayerCommandFallback();
    syncFrameFromPlayer(message.frame);
  }
  if (message.type === 'frameContext') {
    const frame = clamp(Number(message.frame ?? state.frame) || 0, 0, compositionDuration(composition) - 1);
    state.playerFrameModel = {
      ok: true,
      compositionId: message.compositionId || composition?.id || state.activeCompositionId,
      frame,
      timeSeconds: message.timeSeconds ?? (composition?.fps ? frame / composition.fps : null),
      composition: message.composition || composition || null,
      measurement: message.measurement || 'player-dom',
      layers: asArray(message.layers),
    };
    if (state.selectedElementId && !selectedLayer()) {
      state.selectedElementId = null;
    }
    if (!syncSelectionOverlayDom()) render();
  }
  if (message.type === 'command') {
    clearPlayerCommandFallback();
    if (message.frame !== undefined) syncFrameFromPlayer(message.frame);
  }
  if (message.type === 'play') {
    clearPlayerCommandFallback();
    state.playerRuntimePlaying = true;
    if (!state.playing) {
      if (message.frame !== undefined) syncFrameFromPlayer(message.frame);
      sendOrQueuePlayerCommand('pause', { frame: message.frame ?? state.frame });
      return;
    }
    setPlayingState(true);
    if (message.frame !== undefined) syncFrameFromPlayer(message.frame);
  }
  if (message.type === 'pause') {
    clearPlayerCommandFallback();
    state.playerRuntimePlaying = false;
    setPlayingState(false);
    if (message.frame !== undefined) syncFrameFromPlayer(message.frame);
  }
  if (message.type === 'ended') {
    state.playerRuntimePlaying = false;
    setPlayingState(false);
    if (message.frame !== undefined) syncFrameFromPlayer(message.frame);
  }
  if (message.type === 'error') {
    state.playerHostError = String(message.message || 'Player preview failed.');
    state.playerRuntimeReady = false;
    state.playerRuntimePlaying = false;
    setPlayingState(false);
    render();
  }
});

document.addEventListener('load', (event) => {
  const node = event.target;
  if (!node?.classList?.contains('rl-player-frame')) return;
  state.playerRuntimeReady = false;
  requestPlayerHandshake();
}, true);

window.addEventListener('resize', fitPreviewStage);

document.addEventListener('click', (event) => {
  if (event.target?.classList?.contains('rl-modal-scrim')) {
    dismissExportDialog();
    return;
  }

  const layerNode = closestElement(event.target, '[data-preview-layer-id]');
  if (layerNode) {
    event.preventDefault();
    event.stopPropagation();
    selectPreviewLayer(layerNode.dataset.previewLayerId);
    return;
  }

  // Timeline seek: clicks on ruler or track area (not on interactive controls).
  // The range input inside the ruler handles dragging via the 'input' event;
  // this handler covers clicks directly on the track bars / empty track area.
  const tlSeekNode = closestElement(event.target, '[data-tl-seek]');
  if (tlSeekNode && !closestElement(event.target, 'input,button,select')) {
    const scrollEl = tlSeekNode.closest('.rl-tl-main');
    if (scrollEl) {
      const rect = scrollEl.getBoundingClientRect();
      const clickX = event.clientX - rect.left + scrollEl.scrollLeft;
      const ratio = Math.max(0, Math.min(1, clickX / Math.max(1, scrollEl.scrollWidth)));
      const maxFrame = Number(tlSeekNode.dataset.tlSeek) || 0;
      setFrame(Math.round(ratio * maxFrame));
    }
    return;
  }

  const actionNode = closestElement(event.target, '[data-action]');
  if (!actionNode) return;
  const action = actionNode.dataset.action;
  if (action === 'refresh') void refreshProject();
  if (action === 'set-mode') setPreviewMode(actionNode.dataset.mode);
  if (action === 'select-entry') selectEntry(actionNode.dataset.entry);
  if (action === 'clear-selection') clearSelection();
  if (action === 'send-context') void sendContext();
  if (action === 'step-prev') stepFrame(-1);
  if (action === 'step-next') stepFrame(1);
  if (action === 'toggle-play') togglePlayback();
  if (action === 'open-studio' && state.previewServer?.url) {
    window.open(state.previewServer.url, '_blank', 'noopener,noreferrer');
  }
  if (action === 'restart-preview-server') void ensurePreviewServer(true);
  if (action === 'stop-preview-server') void stopPreviewServer();
  if (action === 'render-still') void renderStill();
  if (action === 'start-export') requestExport();
  if (action === 'export-confirm') void confirmExport();
  if (action === 'export-dismiss') dismissExportDialog();
  if (action === 'export-run-dismiss') dismissExportRun();
  // Timeline zoom
  if (action === 'tl-zoom-in')  { state.tlZoom = Math.min(16, (state.tlZoom || 1) * 1.5); updateTimelineDom(); }
  if (action === 'tl-zoom-out') { state.tlZoom = Math.max(1,  (state.tlZoom || 1) / 1.5); updateTimelineDom(); }
  if (action === 'tl-zoom-fit') { state.tlZoom = 1; updateTimelineDom(); }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (state.exportConfirmOpen) {
    dismissExportDialog();
    return;
  }
  if (state.selection) {
    clearSelection();
  }
});

document.addEventListener('ended', (event) => {
  const node = event.target;
  if (!node || node.tagName !== 'VIDEO' || !node.classList.contains('rl-preview-video')) return;
  const endFrame = Number(node.dataset.endFrame);
  state.playing = false;
  if (Number.isFinite(endFrame)) {
    state.frame = clamp(endFrame, 0, compositionDuration() - 1);
    state.frameTouched = true;
  }
  state.previewClip = null;
  void evaluateCurrentFrame();
}, true);

document.addEventListener('change', (event) => {
  const node = event.target;
  if (node?.dataset?.action === 'select-composition') setComposition(node.value);
  if (node?.dataset?.action === 'frame-number') setFrame(node.value);
});

document.addEventListener('input', (event) => {
  const node = event.target;
  if (node?.dataset?.action === 'frame-range') setFrame(node.value, { fastSync: true });
  if (node?.dataset?.action === 'tl-zoom') { state.tlZoom = Math.max(1, Number(node.value)); updateTimelineDom(); }
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type !== 'sparo:event') return;
  if (message.event === 'localeChange') {
    state.locale = message.payload?.locale || state.locale;
    render();
  }
  if (message.event === 'workbenchRouteChange') {
    handleRouteEvent(message.payload || {});
  }
});

runtime().onLocaleChange?.((locale) => {
  state.locale = locale || state.locale;
  render();
});

window.addEventListener('DOMContentLoaded', () => {
  render();
});
