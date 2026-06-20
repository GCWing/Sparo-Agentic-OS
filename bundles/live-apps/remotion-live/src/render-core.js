// remotion-live :: render-core.js (auto-split from ui.js; do not hand-merge)

import { callBackend } from './backend.js';
import { ICONS } from './constants.js';
import { compositionDuration, currentComposition, previewClipKey, previewFrameKey } from './model.js';
import { playerFrameNode, requestPlayerHandshake } from './player-dom.js';
import { playerPreviewReady, studioPreviewReady, usePlayerPreview, useStudioPreview } from './preview-mode.js';
import { selectionSummary, shouldDeferRenderForSelection } from './selection-geom.js';
import { state } from './state.js';
import { escapeHtml, formatSMPTE, rootElement, t } from './util.js';
import { commitSelectionMarkerDom, ensurePreviewVideoPlayback, fitPreviewStage, renderDetectingState, renderDetectionState, renderExportOverlay, renderHeader, renderLayers, renderPlayerPreviewContent, renderSelectCaptureLayer, renderSelectionMarker, renderSelectionOverlay, renderStudioPreviewContent, renderTimelineInline, renderTimelineZoomControls, renderWorkspaceEmpty, replaceElementHtml, syncFrameDom, syncPlayingDom, syncSelectionOverlayDom } from './views.js';

function setLoading(loading, status = null) {
  state.loading = loading;
  if (status) state.status = status;
  render();
}


function setError(error) {
  state.error = error ? String(error.message || error) : null;
  if (error) state.status = 'error';
  render();
}


async function renderStill() {
  const composition = currentComposition();
  if (!composition) return;
  setLoading(true, t('renderStill'));
  try {
    const output = await callBackend('renderStill', {
      compositionId: composition.id,
      frame: state.frame,
    });
    state.lastStill = output;
    state.status = output?.status || 'completed';
    state.error = null;
  } catch (error) {
    setError(error);
  } finally {
    setLoading(false);
  }
}


function updateContextTrayDom() {
  const tray = document.querySelector('.rl-context-tray');
  const html = renderContextTray().trim();
  if (!tray) {
    if (html) render();
    return;
  }
  if (!html) {
    tray.remove();
    return;
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  const node = template.content.firstElementChild;
  if (node) tray.replaceWith(node);
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


function renderContextTray() {
  const composition = currentComposition();
  if (!composition || useStudioPreview()) return '';
  const summary = selectionSummary();
  return `
    <div class="rl-context-tray">
      <span class="rl-context-tray__label">${escapeHtml(t('contextLabel'))}</span>
      <span class="rl-context-tray__value" title="${escapeHtml(summary)}">${escapeHtml(summary)}</span>
      ${state.selection
        ? `<button type="button" class="rl-context-tray__clear" data-action="clear-selection">${escapeHtml(t('clearSelection'))}</button>`
        : `<span class="rl-context-tray__hint">${escapeHtml(t('selectionHint'))}</span>`}
    </div>
  `;
}


function renderPreviewStageContent() {
  if (usePlayerPreview()) {
    return renderPlayerPreviewContent();
  }

  if (useStudioPreview()) {
    return renderStudioPreviewContent();
  }

  const composition = currentComposition();
  const key = previewFrameKey(composition);
  const preview = state.previewFrame?.key === key ? state.previewFrame : null;
  const clipKey = previewClipKey(composition);
  const clip = state.previewClip?.key === clipKey ? state.previewClip : null;

  // Playing: video clip ready
  if (state.playing && clip?.dataUrl) {
    return `
      <video
        class="rl-preview-video"
        src="${escapeHtml(clip.dataUrl)}"
        data-end-frame="${escapeHtml(clip.to ?? state.frame)}"
        autoplay
        muted
        controls
        playsinline
      ></video>
    `;
  }

  // Playing: waiting for clip render
  if (state.playing && state.previewClipLoading) {
    return `
      <div class="rl-overlay">
        <div class="rl-spinner"></div>
        <p>${escapeHtml(t('preparingPlayback'))}</p>
      </div>
    `;
  }

  // Still frame available — show it (with subtle refresh spinner if re-rendering)
  if (preview?.dataUrl) {
    return `
      <img class="rl-preview-frame" src="${escapeHtml(preview.dataUrl)}" alt="${escapeHtml(composition?.id || '')}" />
      ${state.previewLoading
        ? `<div class="rl-overlay rl-overlay--loading"><div class="rl-spinner rl-spinner--sm"></div></div>`
        : ''}
    `;
  }

  // Loading first frame
  if (state.previewLoading) {
    return `
      <div class="rl-overlay">
        <div class="rl-spinner"></div>
        <p>${escapeHtml(t('renderingFrame'))}</p>
      </div>
    `;
  }

  // Clip error — fall back to still if available
  if (state.previewClipError) {
    return `
      <div class="rl-overlay rl-overlay--error">
        <p>${escapeHtml(t('playbackUnavailable'))}</p>
        <small>${escapeHtml(state.previewClipError)}</small>
      </div>
    `;
  }

  // Still frame error — show layer boxes
  if (state.previewError) {
    return `
      <div class="rl-overlay rl-overlay--error">
        <p>${escapeHtml(t('previewUnavailable'))}</p>
        <small>${escapeHtml(state.previewError)}</small>
      </div>
      <div class="rl-layers-fallback">${renderLayers()}</div>
    `;
  }

  // Composition present but no render yet
  if (composition) {
    return `
      <div class="rl-overlay">
        <div class="rl-spinner"></div>
        <p>${escapeHtml(t('renderingFrame'))}</p>
      </div>
    `;
  }

  return renderLayers();
}

// ─── Preview: main view (stable stage + replaceable controls/timeline) ────────


function renderStudioTransport() {
  return `
    <div class="rl-transport rl-transport--studio">
      <button class="rl-btn" data-action="open-studio" ${studioPreviewReady() ? '' : 'disabled'}>${escapeHtml(t('openStudio'))}</button>
      <button class="rl-btn" data-action="restart-preview-server">${escapeHtml(t('restartStudio'))}</button>
      <button class="rl-btn" data-action="stop-preview-server">${escapeHtml(t('stopStudio'))}</button>
      <div class="rl-transport__spacer"></div>
      <button class="rl-btn" data-action="render-still">${escapeHtml(t('renderStill'))}</button>
    </div>
  `;
}


function renderPlaybackTransport(composition, duration, fps) {
  return `
    <div class="rl-transport">
      <div class="rl-transport__btns">
        <button class="rl-icon-btn" data-action="step-prev" aria-label="${escapeHtml(t('previous'))}">${ICONS.prev}</button>
        <button class="rl-play-btn${state.playing ? ' is-playing' : ''}" data-action="toggle-play" aria-label="${escapeHtml(state.playing ? t('pause') : t('play'))}">
          ${state.playing ? ICONS.pause : ICONS.play}
        </button>
        <button class="rl-icon-btn" data-action="step-next" aria-label="${escapeHtml(t('next'))}">${ICONS.next}</button>
      </div>
      <div class="rl-transport__sep" aria-hidden="true"></div>
      ${renderTimelineZoomControls()}
      <div class="rl-transport__sep" aria-hidden="true"></div>
      <div class="rl-transport__spacer"></div>
      <div class="rl-transport__frame-tools">
        <div class="rl-frame-num">
          <input
            type="number"
            min="0"
            max="${Math.max(0, duration - 1)}"
            value="${state.frame}"
            data-action="frame-number"
            aria-label="${escapeHtml(t('frame'))}"
          />
          <span class="rl-frame-num__total">/ ${duration - 1}</span>
        </div>
        <div class="rl-transport__tc" title="SMPTE HH:MM:SS:FF">${escapeHtml(formatSMPTE(state.frame, fps))}</div>
        <button class="rl-btn" data-action="render-still">${escapeHtml(t('renderStill'))}</button>
      </div>
    </div>
  `;
}


function updateTimelineDom() {
  const composition = currentComposition();
  if (!composition || useStudioPreview()) return;
  const duration = compositionDuration(composition);
  const fps = Number(composition?.fps || 30);
  replaceElementHtml('.rl-transport', renderPlaybackTransport(composition, duration, fps));
  replaceElementHtml('.rl-tl-inline', renderTimelineInline(composition, duration, fps));
  syncFrameDom();
  syncPlayingDom();
  updateContextTrayDom();
}


function renderPreview() {
  const composition = currentComposition();
  const duration = compositionDuration(composition);
  const fps = Number(composition?.fps || 30);
  const studioMode = useStudioPreview();
  const aspectRatio = composition
    ? `${composition.width || 1920}/${composition.height || 1080}`
    : '16/9';

  return `
    <section class="rl-preview" data-testid="remotion-preview-panel">
      <!-- Dark cinema stage -->
      <div class="rl-stage-area">
        <div class="rl-stage${studioMode ? ' rl-stage--studio' : ''}"${studioMode ? '' : ` style="aspect-ratio:${aspectRatio}"`}>
          ${renderPreviewStageContent()}
          ${composition && !studioMode ? renderSelectCaptureLayer() : ''}
          ${renderSelectionOverlay()}
          ${composition && !studioMode ? renderSelectionMarker() : ''}
          ${composition && !studioMode ? `
            <div class="rl-stage-pill rl-stage-pill--br" aria-live="polite">F ${state.frame}</div>
            <div class="rl-stage-pill rl-stage-pill--bl">${escapeHtml(t('resolution', composition))}</div>
          ` : ''}
        </div>
      </div>
      ${composition && !studioMode ? renderContextTray() : ''}

      ${composition ? studioMode
        ? renderStudioTransport()
        : `${renderPlaybackTransport(composition, duration, fps)}${renderTimelineInline(composition, duration, fps)}`
      : ''}
    </section>
  `;
}

// ─── Timeline helpers ─────────────────────────────────────────────────────────


function renderRouteContent() {
  if (!state.workspacePath) return renderWorkspaceEmpty();
  const status = state.detection?.status;
  if (status === 'notFound' || status === 'broken' || status === 'ambiguous') {
    return renderDetectionState();
  }
  if (state.detecting && !state.manifest) {
    return renderDetectingState();
  }
  return renderPreview();
}

// ─── Main render ──────────────────────────────────────────────────────────────


function render() {
  if (shouldDeferRenderForSelection()) {
    state.renderQueued = true;
    return;
  }

  const root = rootElement();
  if (!root) return;
  const previousPlayerFrame = playerFrameNode();
  state.renderQueued = false;
  root.dataset.route = state.route;
  document.documentElement.dataset.route = state.route;

  // Progress and error both live in the same auto-height row so the grid stays stable.
  const statusBar = state.loading
    ? `<div class="rl-status-bar"><div class="rl-progress" role="progressbar"><span></span></div></div>`
    : state.error
    ? `<div class="rl-status-bar"><div class="rl-error-bar">${escapeHtml(state.error)}</div></div>`
    : `<div class="rl-status-bar"></div>`;

  root.innerHTML = renderHeader() + statusBar + `<div class="rl-content">${renderRouteContent()}</div>` + renderExportOverlay();
  fitPreviewStage();
  const nextPlayerFrame = playerFrameNode();
  if (nextPlayerFrame && nextPlayerFrame !== previousPlayerFrame) {
    state.playerRuntimeReady = false;
    state.playerRuntimePlaying = false;
  }
  if (playerPreviewReady() && !state.playerRuntimeReady) {
    requestPlayerHandshake();
  }
  ensurePreviewVideoPlayback();
}


export { clearSelection, refreshSelectionDom, render, renderStill, setError, setLoading, updateTimelineDom };
