import {
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
} from './src/actions.js';
import { normalizeRoute } from './src/constants.js';
import { compositionDuration } from './src/model.js';
import { requestPlayerHandshake, resetPlayerChannelConnection } from './src/player-dom.js';
import { sendOrQueuePlayerCommand } from './src/player-protocol.js';
import { resetPlayerRuntimeState } from './src/preview-controller.js';
import { clearPlayerHostPoll, ensurePlayerPreviewHost, pollPlayerPreviewHostStatus } from './src/preview-runtime.js';
import { clearSelection, render, updateTimelineDom } from './src/render-core.js';
import { isSelectionStartTarget, stageNormalizedPoint } from './src/selection-geom.js';
import { state } from './src/state.js';
import { closestElement, runtime } from './src/util.js';
import { fitPreviewStage, isFrameCommitted, removeDraftMarker, updateDraftMarkerDom } from './src/views.js';

let layoutObserver = null;
let fitAnimationFrame = null;

function scheduleStageFit() {
  if (fitAnimationFrame) cancelAnimationFrame(fitAnimationFrame);
  fitAnimationFrame = requestAnimationFrame(() => {
    fitAnimationFrame = null;
    fitPreviewStage();
  });
}

function observeLayout() {
  if (layoutObserver || typeof ResizeObserver === 'undefined') return;
  const root = document.getElementById('remotionLiveRoot');
  if (!root) return;
  layoutObserver = new ResizeObserver(scheduleStageFit);
  layoutObserver.observe(root);
}

function handleRouteEvent(payload = {}) {
  state.route = normalizeRoute(payload.route || state.route);
  state.tabId = payload.tabId || state.tabId;
  state.sessionId = payload.sessionId || state.sessionId;
  const nextWorkspace = payload.workspacePath || payload.workbench?.workspacePath || state.workspacePath;
  const workspaceChanged = Boolean(nextWorkspace && nextWorkspace !== state.workspacePath);
  state.workspacePath = nextWorkspace || state.workspacePath;

  if (workspaceChanged) {
    resetExportState();
    clearPlayerHostPoll();
    state.project = null;
    state.error = null;
    state.phase = 'idle';
    state.manifest = null;
    state.detection = null;
    state.selectedEntry = null;
    state.activeCompositionId = null;
    state.frame = 0;
    state.playerFrameModel = null;
    state.playerHost = null;
    state.playerHostError = null;
    state.playerHostLoading = false;
    state.selection = null;
    state.selectedElementId = null;
    state.interactionMode = 'preview';
    resetPlayerChannelConnection({ rotateNonce: true });
    resetPlayerRuntimeState();
  }

  render();
  if (workspaceChanged || (!state.project && state.workspacePath)) void refreshProject();
}

function pauseForInspectGesture() {
  if (!state.playerRuntimePlaying && !state.playerDesiredState?.playing) return;
  sendOrQueuePlayerCommand('pause', { frame: state.frame });
}

document.addEventListener('pointerdown', (event) => {
  if (!isSelectionStartTarget(event.target)) return;
  state.selectionPointerDown = true;
  pauseForInspectGesture();
}, true);

document.addEventListener('pointerdown', (event) => {
  if (state.interactionMode !== 'inspect' || event.button !== 0) return;
  const capture = closestElement(event.target, '[data-select-capture]');
  if (!capture) return;
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
  } catch {
    // Pointer capture is an enhancement; document-level listeners still complete the gesture.
  }
  updateDraftMarkerDom();
}, true);

document.addEventListener('pointermove', (event) => {
  if (state.interactionMode !== 'inspect' || !state.selectionDragging || !state.selectionDraft) return;
  const current = stageNormalizedPoint(event);
  if (!current) return;
  const draft = state.selectionDraft;
  draft.x = Math.min(draft.startX, current.x);
  draft.y = Math.min(draft.startY, current.y);
  draft.width = Math.abs(current.x - draft.startX);
  draft.height = Math.abs(current.y - draft.startY);
  draft.moved = draft.width > 1.5 || draft.height > 1.5;
  updateDraftMarkerDom();
}, true);

document.addEventListener('pointerup', () => {
  state.selectionPointerDown = false;
  if (!state.selectionDragging) return;
  state.selectionDragging = false;
  const draft = state.selectionDraft;
  state.selectionDraft = null;
  removeDraftMarker();
  if (!draft) return;
  if (draft.moved) setRegionSelection({ x: draft.x, y: draft.y, width: draft.width, height: draft.height });
  else setPointSelection({ x: draft.startX, y: draft.startY });
  if (state.renderQueued) render();
}, true);

document.addEventListener('load', (event) => {
  const node = event.target;
  if (!node?.classList?.contains('rl-player-frame')) return;
  state.playerRuntimeReady = false;
  resetPlayerChannelConnection({ rotateNonce: false });
  requestPlayerHandshake();
}, true);

window.addEventListener('resize', scheduleStageFit);

window.addEventListener('remotion-live:ensure-player-host', (event) => {
  void ensurePlayerPreviewHost(Boolean(event.detail?.force));
});

window.addEventListener('remotion-live:poll-player-host-status', () => {
  void pollPlayerPreviewHostStatus();
});

window.addEventListener('remotion-live:render-request', render);

document.addEventListener('click', (event) => {
  const layerNode = closestElement(event.target, '[data-preview-layer-id]');
  if (layerNode && state.interactionMode === 'inspect') {
    event.preventDefault();
    event.stopPropagation();
    selectPreviewLayer(layerNode.dataset.previewLayerId);
    return;
  }

  const actionNode = closestElement(event.target, '[data-action]');
  if (!actionNode || actionNode.disabled) return;
  const action = actionNode.dataset.action;
  if (action === 'refresh') void refreshProject({ fresh: true });
  if (action === 'retry-preview') retryPreview();
  if (action === 'select-entry') selectEntry(actionNode.dataset.entry);
  if (action === 'clear-selection') clearSelection();
  if (action === 'send-context' && isFrameCommitted()) void sendContext();
  if (action === 'step-prev') stepFrame(-1);
  if (action === 'step-next') stepFrame(1);
  if (action === 'toggle-play') togglePlayback();
  if (action === 'toggle-inspect') toggleInspect();
  if (action === 'toggle-muted') toggleMuted();
  if (action === 'start-export') requestExport();
  if (action === 'export-confirm') void confirmExport();
  if (action === 'export-dismiss') dismissExportDialog();
  if (action === 'export-run-dismiss') dismissExportRun();
  if (action === 'cancel-export') void cancelExport();
  if (action === 'expand-panel') void runtime().host?.setPanelMode?.('expanded');
});

document.addEventListener('cancel', (event) => {
  if (!event.target?.classList?.contains('rl-export-dialog')) return;
  event.preventDefault();
  dismissExportDialog();
}, true);

function editableTarget(target) {
  const element = closestElement(target, 'input,select,textarea,[contenteditable="true"]');
  return Boolean(element);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (state.exportConfirmOpen) {
      event.preventDefault();
      dismissExportDialog();
    } else if (state.selection) {
      event.preventDefault();
      clearSelection();
    } else if (state.interactionMode === 'inspect') {
      event.preventDefault();
      setInteractionMode('preview');
    }
    return;
  }
  if (editableTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && isFrameCommitted()) {
      event.preventDefault();
      void sendContext();
    }
    return;
  }
  if (event.code === 'Space' || event.key.toLowerCase() === 'k') {
    event.preventDefault();
    togglePlayback();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    stepFrame(event.shiftKey ? -10 : -1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    stepFrame(event.shiftKey ? 10 : 1);
  } else if (event.key.toLowerCase() === 'i') {
    event.preventDefault();
    toggleInspect();
  } else if (event.key.toLowerCase() === 'm') {
    event.preventDefault();
    toggleMuted();
  } else if (event.key === 'Home') {
    event.preventDefault();
    setFrame(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    setFrame(compositionDuration() - 1);
  }
});

document.addEventListener('change', (event) => {
  const node = event.target;
  if (node?.dataset?.action === 'select-composition') setComposition(node.value);
  if (node?.dataset?.action === 'frame-number') setFrame(node.value);
  if (node?.dataset?.action === 'frame-range') setFrame(node.value);
});

document.addEventListener('input', (event) => {
  const node = event.target;
  if (node?.dataset?.action === 'frame-range') setFrame(node.value, { fastSync: true });
  if (node?.dataset?.action === 'volume') setVolume(node.value);
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type !== 'sparo:event') return;
  if (message.event === 'localeChange') {
    state.locale = message.payload?.locale || state.locale;
    render();
  }
  if (message.event === 'productAppRuntimeRouteChange') handleRouteEvent(message.payload || {});
});

runtime().onLocaleChange?.((locale) => {
  state.locale = locale || state.locale;
  render();
});

window.addEventListener('DOMContentLoaded', () => {
  render();
  observeLayout();
  scheduleStageFit();
});
