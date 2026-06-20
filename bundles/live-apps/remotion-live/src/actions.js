// remotion-live :: actions.js (auto-split from ui.js; do not hand-merge)

import { callBackend, entryInput } from './backend.js';
import { compositionDuration, currentComposition, defaultPreviewFrame, normalizeManifest, previewFrameKey } from './model.js';
import { resetPlayerRuntimeState, usePlayerPreview, useStudioPreview } from './preview-mode.js';
import { clearPlayerHostPoll, ensurePlayerPreviewHost, ensurePreviewServer, evaluateCurrentFrame, requestPreviewClip, requestPreviewFrame, sendOrQueuePlayerCommand } from './preview-runtime.js';
import { refreshSelectionDom, render, setError, setLoading, updateTimelineDom } from './render-core.js';
import { buildSelectedVideoContext, hasLiveTextSelection, selectionContextSentence } from './selection-geom.js';
import { previewClipCache, previewFrameCache, state } from './state.js';
import { asArray, cacheGet, clamp, projectName, round2, routeKey, runtime, stopPlaybackTimer, t } from './util.js';
import { setPlayingState, syncFrameDom } from './views.js';

function setPreviewMode(mode) {
  const next = mode === 'studio' || mode === 'still' ? mode : 'player';
  if (next === state.previewMode) return;
  state.previewMode = next;
  state.previewError = null;
  state.previewClipError = null;
  state.playing = false;
  stopPlaybackTimer();
  render();
  if (state.route !== '/preview' || !currentComposition()) return;
  if (next === 'player') {
    void ensurePlayerPreviewHost(true);
  } else if (next === 'studio') {
    void ensurePreviewServer();
  } else {
    void requestPreviewFrame(true);
  }
}


function releaseSelectionGuard() {
  if (state.selectionPointerDown || hasLiveTextSelection()) return;
  state.selectionGuard = false;
  if (state.renderQueued) {
    render();
  }
}


function scheduleSelectionGuardRelease() {
  window.setTimeout(releaseSelectionGuard, 0);
}


function applyProjectOutput(output) {
  const previousBuildId = state.manifest?.buildId || null;
  state.project = output?.project || output?.detection || output || null;
  state.manifest = normalizeManifest(output);
  const nextBuildId = state.manifest?.buildId || null;
  if (previousBuildId && nextBuildId && previousBuildId !== nextBuildId) {
    previewFrameCache.clear();
    previewClipCache.clear();
    state.previewFrame = null;
    state.previewClip = null;
    state.playerFrameModel = null;
  }
  const firstComposition = currentComposition();
  if (!state.activeCompositionId && firstComposition) {
    state.activeCompositionId = firstComposition.id;
    state.frame = defaultPreviewFrame(firstComposition);
    state.frameTouched = false;
  } else if (!state.frameTouched && firstComposition) {
    state.frame = defaultPreviewFrame(firstComposition);
  }
}


function selectEntry(entryPoint) {
  if (!entryPoint) return;
  state.selectedEntry = entryPoint;
  void refreshProject();
}


async function refreshProject() {
  if (!state.workspacePath) {
    state.project = null;
    state.manifest = null;
    state.detection = null;
    state.status = 'no-workspace';
    render();
    return;
  }

  state.detecting = true;
  setLoading(true, t('detecting'));
  try {
    const detection = await callBackend('detectProject', entryInput());
    state.detection = detection || null;
    const status = detection?.status || (detection?.ok ? 'matched' : 'notFound');

    if (status === 'notFound' || status === 'broken' || status === 'ambiguous') {
      state.project = detection || null;
      state.manifest = null;
      state.activeCompositionId = null;
      state.status = status === 'broken'
        ? t('projectBrokenTitle')
        : status === 'ambiguous'
        ? t('ambiguousTitle')
        : t('projectMissing');
      state.error = null;
      return;
    }

    const output = await callBackend('compileProject', entryInput());
    applyProjectOutput(output);
    state.status = asArray(state.manifest?.compositions).length ? t('projectReady') : t('projectMissing');
    state.error = null;
    if (state.route === '/preview' && usePlayerPreview()) {
      void ensurePlayerPreviewHost();
    } else if (state.route === '/preview' && useStudioPreview()) {
      void ensurePreviewServer();
    }
    await evaluateCurrentFrame();
  } catch (error) {
    setError(error);
  } finally {
    state.detecting = false;
    setLoading(false);
  }
}


function setComposition(id) {
  state.activeCompositionId = id;
  state.frame = defaultPreviewFrame(currentComposition());
  state.frameTouched = false;
  state.selectedElementId = null;
  state.previewFrame = null;
  state.previewClip = null;
  state.previewError = null;
  state.previewClipError = null;
  state.previewQueuedKey = null;
  state.playerHost = null;
  state.playerHostError = null;
  resetPlayerRuntimeState();
  clearPlayerHostPoll();
  if (usePlayerPreview() && state.route === '/preview') {
    void ensurePlayerPreviewHost(true);
  }
  void evaluateCurrentFrame();
}


function setFrame(frame, options = {}) {
  const duration = compositionDuration();
  state.frame = clamp(Number(frame) || 0, 0, duration - 1);
  if (!options.silent) state.frameTouched = true;
  if (usePlayerPreview()) {
    sendOrQueuePlayerCommand('seek', { frame: state.frame });
    if (options.fastSync) syncFrameDom();
    else updateTimelineDom();
    return;
  }
  if (!useStudioPreview()) {
    const cachedFrame = cacheGet(previewFrameCache, previewFrameKey());
    if (cachedFrame?.dataUrl) {
      state.previewFrame = cachedFrame;
      state.previewError = null;
      render();
    }
  }
  void evaluateCurrentFrame();
}


function stepFrame(delta) {
  setFrame(state.frame + delta);
}


function togglePlayback() {
  if (usePlayerPreview()) {
    if (state.playing) {
      setPlayingState(false);
      sendOrQueuePlayerCommand('pause', { frame: state.frame });
      return;
    }
    setPlayingState(true);
    sendOrQueuePlayerCommand('play', { frame: state.frame });
    return;
  }
  if (useStudioPreview()) return;
  if (state.playing) {
    setPlayingState(false);
    render();
    return;
  }

  setPlayingState(true);
  stopPlaybackTimer();
  render();
  void requestPreviewClip();
}


function requestExport() {
  if (!currentComposition()) return;
  if (state.exportRun?.status === 'running') return;
  state.exportConfirmOpen = true;
  render();
}


function dismissExportDialog() {
  if (!state.exportConfirmOpen) return;
  state.exportConfirmOpen = false;
  render();
}


function dismissExportRun() {
  state.exportRun = null;
  render();
}

// The Remotion runtime renders exports synchronously, so there is no progress
// stream to poll: the backend call resolves only once the file is written.
// We surface a confirmation guardrail, an indeterminate busy state, and the result.

async function confirmExport() {
  const composition = currentComposition();
  if (!composition) return;
  state.exportConfirmOpen = false;
  state.exportRun = { status: 'running', compositionId: composition.id };
  render();
  try {
    const output = await callBackend('startExport', {
      compositionId: composition.id,
      frameRange: [0, compositionDuration(composition) - 1],
    });
    state.exportRun = {
      status: output?.status === 'cancelled' ? 'cancelled' : 'completed',
      compositionId: composition.id,
      runId: output?.runId || null,
      outputPath: output?.outputPath || null,
      outputUri: output?.outputUri || null,
    };
    state.status = t('exportDone');
    state.error = null;
  } catch (error) {
    state.exportRun = { status: 'failed', error: String(error?.message || error) };
    setError(error);
    return;
  }
  render();
}


async function sendContext() {
  const host = runtime();
  const context = buildSelectedVideoContext();
  const sentence = selectionContextSentence(context);
  const basePrompt = t('askPrompt', {
    project: projectName(),
    composition: context.compositionId || '-',
    frame: context.frame,
    route: routeKey(),
    workspace: state.workspacePath || '-',
  });
  const prompt = `${basePrompt}\n\nSelected video context: ${sentence}\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``;
  await host.host?.fillChatInput?.(prompt);
}

// ─── Icons (inline SVG) ──────────────────────────────────────────────────────


function selectPreviewLayer(layerId) {
  state.selectedElementId = layerId || null;
  state.selection = layerId ? { type: 'element' } : null;
  refreshSelectionDom();
}


function setPointSelection(point) {
  state.selectedElementId = null;
  state.selection = { type: 'point', point: { x: round2(point.x), y: round2(point.y) } };
  refreshSelectionDom();
}


function setRegionSelection(box) {
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


export { confirmExport, dismissExportDialog, dismissExportRun, refreshProject, requestExport, scheduleSelectionGuardRelease, selectEntry, selectPreviewLayer, sendContext, setComposition, setFrame, setPointSelection, setPreviewMode, setRegionSelection, stepFrame, togglePlayback };
