import { compositionDuration, currentComposition } from './model.js';
import { notifyPlayerFrameLoaded, playerFrameNode, requestPlayerHandshake } from './player-dom.js';
import { playerStageKey } from './preview-controller.js';
import { selectionSummary, shouldDeferRenderForSelection } from './selection-geom.js';
import { state } from './state.js';
import { escapeHtml, rootElement, runtime, t } from './util.js';
import {
  actualFrame,
  commitSelectionMarkerDom,
  fitPreviewStage,
  isFrameCommitted,
  previewPhase,
  renderDetectingState,
  renderDetectionState,
  renderExportOverlay,
  renderHeader,
  renderPlaybackTransport,
  renderPlayerOverlay,
  renderPlayerPreviewContent,
  renderPreviewClickLayer,
  renderSelectCaptureLayer,
  renderSelectionMarker,
  renderSelectionOverlay,
  renderTimelineInline,
  renderWorkspaceEmpty,
  replaceElementHtml,
  syncFrameDom,
  syncInteractionLayersDom,
  syncPhaseDom,
  syncPlayingDom,
  syncSelectionOverlayDom,
} from './views.js';

function setError(error) {
  const failedPhase = state.phase;
  const message = error ? String(error?.message || error) : null;
  state.error = message;
  if (error) {
    state.phase = 'error';
    runtime().log?.error?.('Remotion Live operation failed', {
      phase: failedPhase,
      error: message,
    });
  }
  render();
}

function renderStatusStrip() {
  const phase = previewPhase();
  const busy = ['detecting', 'bundling', 'connecting', 'loading'].includes(phase);
  return `<div class="rl-status-strip${busy ? ' is-busy' : ''}" aria-hidden="true"><span></span></div>`;
}

function renderContextTray() {
  if (!currentComposition() || state.interactionMode !== 'inspect') return '';
  const summary = selectionSummary();
  return `
    <aside class="rl-context-tray" aria-live="polite">
      <div class="rl-context-tray__copy">
        <span class="badge badge--accent">${escapeHtml(t('inspectActive'))}</span>
        <span title="${escapeHtml(summary)}">${escapeHtml(state.selection ? summary : t('inspectHint'))}</span>
      </div>
      ${state.selection ? `<button type="button" class="btn btn-sm btn-ghost" data-action="clear-selection">${escapeHtml(t('clearSelection'))}</button>` : ''}
    </aside>
  `;
}

function updateContextTrayDom() {
  const tray = document.querySelector('.rl-context-tray');
  const html = renderContextTray().trim();
  if (!tray) {
    if (html) {
      const template = document.createElement('template');
      template.innerHTML = html;
      const node = template.content.firstElementChild;
      const transport = document.querySelector('.rl-workbench > .rl-transport');
      if (node && transport) transport.before(node);
    }
    return;
  }
  if (!html) {
    tray.remove();
    return;
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  tray.replaceWith(template.content.firstElementChild);
}

function patchExportOverlayDom(root) {
  root.querySelectorAll('.rl-export-dialog, .rl-export-job').forEach((node) => node.remove());
  const html = renderExportOverlay().trim();
  if (!html) return;
  const template = document.createElement('template');
  template.innerHTML = html;
  const node = template.content.firstElementChild;
  if (node) root.appendChild(node);
  openExportDialog(root);
}

function openExportDialog(root) {
  const dialog = root.querySelector('.rl-export-dialog');
  if (!dialog || dialog.open) return;
  try {
    dialog.showModal();
  } catch {
    dialog.setAttribute('open', '');
  }
  queueMicrotask(() => dialog.querySelector('[autofocus], button')?.focus());
}

function patchPlayerOverlayDom(stage) {
  stage.querySelectorAll('.rl-player-runtime-overlay').forEach((node) => node.remove());
  const html = renderPlayerOverlay().trim();
  if (!html) return;
  const template = document.createElement('template');
  template.innerHTML = html;
  const node = template.content.firstElementChild;
  if (node) stage.appendChild(node);
}

function patchInspectDom(stage) {
  stage.classList.toggle('is-inspecting', state.interactionMode === 'inspect');
  syncInteractionLayersDom();
}

function patchStablePlayerRender(root) {
  const frame = playerFrameNode();
  const stage = frame?.closest('.rl-stage');
  if (!frame || !stage || frame.dataset.stageKey !== playerStageKey()) return false;
  if (!root.querySelector('.rl-workbench')) return false;

  replaceElementHtml('.rl-header', renderHeader());
  replaceElementHtml('.rl-status-strip', renderStatusStrip());
  const composition = currentComposition();
  if (composition) {
    replaceElementHtml('.rl-transport', renderPlaybackTransport(composition, compositionDuration(composition), Number(composition.fps || 30)));
    replaceElementHtml('.rl-review', renderTimelineInline(composition, compositionDuration(composition), Number(composition.fps || 30)));
  }
  patchPlayerOverlayDom(stage);
  patchInspectDom(stage);
  updateContextTrayDom();
  patchExportOverlayDom(root);
  syncFrameDom();
  syncPlayingDom();
  fitPreviewStage();
  if (!state.playerRuntimeReady) requestPlayerHandshake();
  return true;
}

function refreshSelectionDom() {
  syncSelectionOverlayDom();
  commitSelectionMarkerDom();
  updateContextTrayDom();
}

function clearSelection() {
  state.selection = null;
  state.selectedElementId = null;
  refreshSelectionDom();
}

function updateTimelineDom() {
  const composition = currentComposition();
  if (!composition) return;
  const duration = compositionDuration(composition);
  const fps = Number(composition.fps || 30);
  replaceElementHtml('.rl-transport', renderPlaybackTransport(composition, duration, fps));
  replaceElementHtml('.rl-review', renderTimelineInline(composition, duration, fps));
  syncFrameDom();
  syncPlayingDom();
}

function renderPreview() {
  const composition = currentComposition();
  if (!composition) {
    const error = state.error || state.playerHostError;
    return `
      <div class="bfui-empty rl-empty" role="${error ? 'alert' : 'status'}">
        <strong class="bfui-empty__title">${escapeHtml(error ? t('playerUnavailable') : t('noCompositions'))}</strong>
        ${error ? `<p class="bfui-empty__description">${escapeHtml(error)}</p>` : ''}
        <button type="button" class="btn btn-sm btn-secondary" data-action="refresh">${escapeHtml(t('retry'))}</button>
      </div>
    `;
  }
  const duration = compositionDuration(composition);
  const fps = Number(composition.fps || 30);
  const phase = previewPhase();
  const aspectRatio = `${composition.width || 1920}/${composition.height || 1080}`;
  return `
    <section class="rl-workbench" data-testid="remotion-preview-panel"
      data-preview-phase="${phase}" data-actual-frame="${actualFrame()}"
      data-actual-playing="${state.playerRuntimePlaying ? 'true' : 'false'}"
      data-frame-state="${isFrameCommitted() ? 'committed' : 'pending'}"
      data-inspect-mode="${state.interactionMode === 'inspect' ? 'true' : 'false'}"
      data-buffering="${state.playerBuffering ? 'true' : 'false'}"
      data-seeking="${state.playerSeeking ? 'true' : 'false'}"
      data-player-host-ready="${state.playerHost?.ready ? 'true' : 'false'}"
      data-player-connection-state="${escapeHtml(state.playerConnectionState || 'disconnected')}"
      data-player-channel-connected="${state.playerChannelConnected ? 'true' : 'false'}">
      <div class="rl-stage-area">
        <div class="rl-stage${state.interactionMode === 'inspect' ? ' is-inspecting' : ''}" style="aspect-ratio:${aspectRatio}">
          ${renderPlayerPreviewContent()}
          ${renderPreviewClickLayer()}
          ${renderSelectCaptureLayer()}
          ${renderSelectionOverlay()}
          ${renderSelectionMarker()}
          <div class="rl-stage-meta" aria-hidden="true">
            <span>${escapeHtml(t('resolution', composition))}</span>
            <span>F <span class="rl-frame-actual">${actualFrame()}</span></span>
          </div>
        </div>
      </div>
      ${renderContextTray()}
      ${renderPlaybackTransport(composition, duration, fps)}
      ${renderTimelineInline(composition, duration, fps)}
    </section>
  `;
}

function renderRouteContent() {
  if (!state.workspacePath) return renderWorkspaceEmpty();
  const status = state.detection?.status;
  if (status === 'notFound' || status === 'broken' || status === 'ambiguous') return renderDetectionState();
  if (state.phase === 'detecting' && !state.manifest) return renderDetectingState();
  return renderPreview();
}

function render() {
  if (shouldDeferRenderForSelection()) {
    state.renderQueued = true;
    return;
  }
  const root = rootElement();
  if (!root) return;
  state.renderQueued = false;
  root.dataset.route = state.route;
  root.dataset.previewPhase = previewPhase();
  root.dataset.projectPhase = state.phase || 'idle';
  root.dataset.detectionStatus = state.detection?.status || '';
  root.dataset.error = state.error || state.playerHostError || '';
  root.dataset.actualFrame = String(actualFrame());
  root.dataset.actualPlaying = state.playerRuntimePlaying ? 'true' : 'false';
  root.dataset.frameState = isFrameCommitted() ? 'committed' : 'pending';
  root.dataset.inspectMode = state.interactionMode === 'inspect' ? 'true' : 'false';
  root.dataset.buffering = state.playerBuffering ? 'true' : 'false';
  root.dataset.seeking = state.playerSeeking ? 'true' : 'false';
  root.dataset.playerHostReady = state.playerHost?.ready ? 'true' : 'false';
  root.dataset.playerConnectionState = state.playerConnectionState || 'disconnected';
  root.dataset.playerChannelConnected = state.playerChannelConnected ? 'true' : 'false';
  document.documentElement.dataset.route = state.route;

  if (patchStablePlayerRender(root)) return;

  const previousFrame = playerFrameNode();
  root.innerHTML = `${renderHeader()}${renderStatusStrip()}<main class="rl-content">${renderRouteContent()}</main>${renderExportOverlay()}`;
  openExportDialog(root);
  fitPreviewStage();
  const nextFrame = playerFrameNode();
  if (nextFrame) {
    const stageKey = playerStageKey();
    nextFrame.dataset.stageKey = stageKey;
    state.playerRenderedStageKey = stageKey;
  }
  if (nextFrame && nextFrame !== previousFrame) {
    state.playerRuntimeReady = false;
    state.playerRuntimePlaying = false;
    nextFrame.addEventListener('load', () => notifyPlayerFrameLoaded(nextFrame), { once: true });
  }
  if (nextFrame && !state.playerRuntimeReady) requestPlayerHandshake();
  syncPhaseDom();
}

export {
  clearSelection,
  refreshSelectionDom,
  render,
  setError,
  updateTimelineDom,
};
