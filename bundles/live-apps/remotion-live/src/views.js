// remotion-live :: views.js (auto-split from ui.js; do not hand-merge)

import { ICONS } from './constants.js';
import { compositionDuration, currentComposition, frameLayers, layerBox, layerElementId, layerStyle, previewFrameKey, timelineFramePercent } from './model.js';
import { playerHostUrl } from './player-dom.js';
import { playerStageKey } from './preview-controller.js';
import { playerPreviewReady, studioPreviewReady, useStudioPreview } from './preview-mode.js';
import { state } from './state.js';
import { asArray, clamp, escapeHtml, formatSMPTE, previewStageNode, t, workspaceLabel } from './util.js';

function renderModeSwitch() {
  const modes = [
    ['player', 'modePlayer'],
    ['studio', 'modeStudio'],
    ['still', 'modeStill'],
  ];
  return `
    <div class="rl-mode-switch" role="group" aria-label="${escapeHtml(t('previewMode'))}">
      ${modes.map(([mode, key]) => `
        <button
          type="button"
          class="rl-mode-btn${state.previewMode === mode ? ' is-active' : ''}"
          data-action="set-mode"
          data-mode="${mode}"
          aria-pressed="${state.previewMode === mode ? 'true' : 'false'}"
        >${escapeHtml(t(key))}</button>
      `).join('')}
    </div>
  `;
}


function syncFrameDom() {
  const composition = currentComposition();
  const duration = compositionDuration(composition);
  const fps = Number(composition?.fps || 30);
  const frame = clamp(Number(state.frame) || 0, 0, duration - 1);
  const percent = timelineFramePercent(frame, composition);
  document.querySelectorAll('input[data-action="frame-number"], input[data-action="frame-range"]').forEach((node) => {
    node.value = String(frame);
  });
  const timecode = document.querySelector('.rl-transport__tc');
  if (timecode) timecode.textContent = formatSMPTE(frame, fps);
  const framePill = document.querySelector('.rl-stage-pill--br');
  if (framePill) framePill.textContent = `F ${frame}`;
  document.querySelectorAll('.rl-tl-playhead, .rl-tl-vline').forEach((node) => {
    node.style.left = `${percent}%`;
  });
}


function syncPlayingDom() {
  const button = document.querySelector('.rl-play-btn[data-action="toggle-play"]');
  if (!button) return;
  button.classList.toggle('is-playing', Boolean(state.playing));
  button.setAttribute('aria-label', state.playing ? t('pause') : t('play'));
  button.innerHTML = state.playing ? ICONS.pause : ICONS.play;
}


function setPlayingState(playing) {
  state.playing = Boolean(playing);
  syncPlayingDom();
}


function syncFrameFromPlayer(frame) {
  const composition = currentComposition();
  const duration = compositionDuration(composition);
  const nextFrame = clamp(Math.round(Number(frame) || 0), 0, duration - 1);
  state.playerRuntimeFrame = nextFrame;
  state.frame = nextFrame;
  state.frameTouched = true;
  if (state.playerFrameModel && Math.round(Number(state.playerFrameModel.frame) || 0) !== nextFrame) {
    state.playerFrameModel = null;
  }
  syncFrameDom();
}


function renderExportOverlay() {
  const composition = currentComposition();
  if (state.exportConfirmOpen && composition) {
    const frames = compositionDuration(composition);
    return `
      <div class="rl-modal-scrim">
        <div class="rl-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('exportConfirmTitle'))}">
          <h2 class="rl-modal__title">${escapeHtml(t('exportConfirmTitle'))}</h2>
          <p class="rl-modal__body">${escapeHtml(t('exportConfirmBody', { composition: composition.id, frames }))}</p>
          <div class="rl-modal__actions">
            <button type="button" class="rl-btn" data-action="export-dismiss">${escapeHtml(t('cancel'))}</button>
            <button type="button" class="rl-btn rl-btn--accent" data-action="export-confirm">${escapeHtml(t('exportConfirm'))}</button>
          </div>
        </div>
      </div>
    `;
  }

  const run = state.exportRun;
  if (run?.status === 'running') {
    return `
      <div class="rl-export-toast rl-export-toast--busy" role="status" aria-live="polite">
        <span class="rl-spinner rl-spinner--sm"></span>
        <span>${escapeHtml(t('exporting'))}\u2026</span>
      </div>
    `;
  }
  if (run && (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled')) {
    const label = run.status === 'completed'
      ? t('exportDone')
      : run.status === 'cancelled'
      ? t('cancelExport')
      : t('exportFailed');
    const cls = run.status === 'completed' ? 'is-ok' : 'is-error';
    return `
      <div class="rl-export-toast ${cls}" role="status" aria-live="polite">
        <span class="rl-export-toast__label">${escapeHtml(label)}</span>
        ${run.outputPath ? `<span class="rl-export-toast__path" title="${escapeHtml(run.outputPath)}">${escapeHtml(run.outputPath)}</span>` : ''}
        <button type="button" class="rl-export-toast__close" data-action="export-run-dismiss" aria-label="${escapeHtml(t('cancel'))}">\u00d7</button>
      </div>
    `;
  }
  return '';
}


function renderHeader() {
  const compositions = asArray(state.manifest?.compositions);
  const composition = currentComposition();
  const hasMultiple = compositions.length > 1;
  const statusClass = state.loading ? 'is-loading' : state.error ? 'is-error' : state.project ? 'is-ok' : '';
  const statusLabel = state.loading
    ? t('loadingProject')
    : state.error
    ? (state.error.length > 38 ? state.error.slice(0, 38) + '\u2026' : state.error)
    : state.status || '';

  let crumb = '';
  if (state.workspacePath) {
    crumb = `<span class="rl-header__ws">${escapeHtml(workspaceLabel())}</span>`;
    if (hasMultiple) {
      crumb += `<span class="rl-sep" aria-hidden="true">/</span>
        <select class="rl-header__comp" data-action="select-composition">
          ${compositions.map((c) => `<option value="${escapeHtml(c.id)}"${c.id === composition?.id ? ' selected' : ''}>${escapeHtml(c.id)}</option>`).join('')}
        </select>`;
    } else if (composition) {
      crumb += `<span class="rl-sep" aria-hidden="true">/</span><span class="rl-header__comp">${escapeHtml(composition.id)}</span>`;
    }
  } else {
    crumb = `<span class="rl-header__ws rl-header__ws--empty">Remotion Live</span>`;
  }

  return `
    <header class="rl-header">
      <div class="rl-header__left">${crumb}</div>
      <div class="rl-header__status ${statusClass}">
        <span class="rl-dot"></span>
        ${statusLabel ? `<span class="rl-dot-label">${escapeHtml(statusLabel)}</span>` : ''}
      </div>
      <div class="rl-header__right">
        ${composition ? renderModeSwitch() : ''}
        <button class="rl-icon-btn" data-action="refresh" title="${escapeHtml(t('refresh'))}" aria-label="${escapeHtml(t('refresh'))}">${ICONS.refresh}</button>
        <button class="rl-btn rl-btn--accent rl-header__export" data-action="start-export" ${composition ? '' : 'disabled'}>${escapeHtml(t('exportVideo'))}</button>
        <button class="rl-ai-btn" data-action="send-context" title="${escapeHtml(t('sendContext'))}">${ICONS.send}<span>${escapeHtml(t('sendContext'))}</span></button>
      </div>
    </header>
  `;
}

// ─── Empty / no workspace ─────────────────────────────────────────────────────


function renderWorkspaceEmpty() {
  return `
    <div class="rl-empty">
      <div class="rl-empty__icon">${ICONS.film}</div>
      <strong class="rl-empty__title">${escapeHtml(t('title'))}</strong>
      <p>${escapeHtml(t('noWorkspace'))}</p>
    </div>
  `;
}


function renderDetectingState() {
  return `
    <div class="rl-empty">
      <div class="rl-spinner"></div>
      <p>${escapeHtml(t('detecting'))}</p>
    </div>
  `;
}


function renderDetectionState() {
  const detection = state.detection || {};
  const status = detection.status || (detection.ok ? 'matched' : 'notFound');

  if (status === 'ambiguous') {
    const entries = asArray(detection.entryPoints);
    return `
      <div class="rl-detect">
        <div class="rl-empty__icon">${ICONS.film}</div>
        <strong class="rl-empty__title">${escapeHtml(t('ambiguousTitle'))}</strong>
        <p>${escapeHtml(t('ambiguousHint'))}</p>
        <ul class="rl-entry-list">
          ${entries.map((entry) => `
            <li>
              <button type="button" class="rl-entry-item" data-action="select-entry" data-entry="${escapeHtml(entry.path)}">
                <span class="rl-entry-path">${escapeHtml(entry.path)}</span>
                <span class="rl-entry-source">${escapeHtml(entry.source || '')}</span>
              </button>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  }

  if (status === 'broken') {
    const firstError = asArray(detection.diagnostics).find((item) => item.level === 'error');
    const reason = detection.errorSummary || firstError?.message || t('projectBrokenTitle');
    const needsInstall = detection.hasNodeModules === false;
    return `
      <div class="rl-detect rl-detect--error">
        <div class="rl-empty__icon">${ICONS.film}</div>
        <strong class="rl-empty__title">${escapeHtml(t('projectBrokenTitle'))}</strong>
        <p>${escapeHtml(reason)}</p>
        ${needsInstall ? `<p class="rl-detect__hint">${escapeHtml(t('installDeps'))}</p>` : ''}
        <button type="button" class="rl-btn rl-btn--accent" data-action="refresh">${escapeHtml(t('retry'))}</button>
      </div>
    `;
  }

  return `
    <div class="rl-detect">
      <div class="rl-empty__icon">${ICONS.film}</div>
      <strong class="rl-empty__title">${escapeHtml(t('notRemotionTitle'))}</strong>
      <p>${escapeHtml(t('notRemotion'))}</p>
      <button type="button" class="rl-btn" data-action="refresh">${escapeHtml(t('retry'))}</button>
    </div>
  `;
}

// ─── Preview: native layer fallback boxes ─────────────────────────────────────


function renderSelectionOverlay() {
  const layers = frameLayers();
  const composition = currentComposition();
  if (!composition || useStudioPreview() || !layers.length) return '';
  return `
    <div class="rl-selection-overlay">
      ${layers.map((layer, index) => {
        const id = layerElementId(layer, index);
        const box = layerBox(layer, index);
        const zIndex = Math.max(1, Math.round(10000 - box.width * box.height));
        const selected = id === state.selectedElementId;
        const label = layer.label || layer.id || layer.type || `Layer ${index + 1}`;
        return `
          <button
            type="button"
            class="rl-selection-hotspot${selected ? ' is-selected' : ''}"
            data-preview-layer-id="${escapeHtml(id)}"
            style="left:${box.x}%;top:${box.y}%;width:${box.width}%;height:${box.height}%;z-index:${zIndex};--rl-layer-color:${escapeHtml(box.color)}"
            title="${escapeHtml(label)}"
            aria-label="Select preview element ${escapeHtml(label)}"
          >
            ${selected ? `<span>${escapeHtml(label)}</span>` : ''}
          </button>
        `;
      }).join('')}
    </div>
  `;
}


function syncSelectionOverlayDom() {
  const stage = document.querySelector('.rl-stage:not(.rl-stage--studio)');
  if (!stage) return false;
  const existing = stage.querySelector('.rl-selection-overlay');
  const html = renderSelectionOverlay().trim();
  if (!html) {
    existing?.remove();
    return true;
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  const next = template.content.firstElementChild;
  if (!next) return false;
  if (existing) {
    existing.replaceWith(next);
    return true;
  }
  const chrome = stage.querySelector('.rl-stage-chrome');
  if (chrome) stage.insertBefore(next, chrome);
  else stage.appendChild(next);
  return true;
}

// ─── Point / region selection (P2) ────────────────────────────────────────────


function renderSelectCaptureLayer() {
  return `<div class="rl-select-capture" data-select-capture="1" aria-hidden="true"></div>`;
}


function renderSelectionMarker() {
  const sel = state.selection;
  if (!sel || useStudioPreview()) return '';
  if (sel.type === 'point' && sel.point) {
    return `<div class="rl-sel-point" style="left:${sel.point.x}%;top:${sel.point.y}%" aria-hidden="true"></div>`;
  }
  if (sel.type === 'region' && sel.normalizedBox) {
    const box = sel.normalizedBox;
    return `<div class="rl-sel-region" style="left:${box.x}%;top:${box.y}%;width:${box.width}%;height:${box.height}%" aria-hidden="true"></div>`;
  }
  return '';
}


function removeDraftMarker() {
  document.querySelectorAll('.rl-sel-draft').forEach((node) => node.remove());
}


function updateDraftMarkerDom() {
  const stage = previewStageNode();
  if (!stage) return;
  const draft = state.selectionDraft;
  let marker = stage.querySelector('.rl-sel-draft');
  if (!state.selectionDragging || !draft) {
    marker?.remove();
    return;
  }
  if (!marker) {
    marker = document.createElement('div');
    marker.className = 'rl-sel-region rl-sel-draft';
    marker.setAttribute('aria-hidden', 'true');
    stage.appendChild(marker);
  }
  marker.style.left = `${draft.x}%`;
  marker.style.top = `${draft.y}%`;
  marker.style.width = `${draft.width}%`;
  marker.style.height = `${draft.height}%`;
}


function commitSelectionMarkerDom() {
  const stage = previewStageNode();
  if (!stage) return;
  stage.querySelectorAll('.rl-sel-region:not(.rl-sel-draft), .rl-sel-point').forEach((node) => node.remove());
  const html = renderSelectionMarker().trim();
  if (!html) return;
  const template = document.createElement('template');
  template.innerHTML = html;
  const node = template.content.firstElementChild;
  if (node) stage.appendChild(node);
}


function renderLayers() {
  const layers = frameLayers();
  if (!layers.length) {
    const composition = currentComposition();
    if (!composition) return '';
    return `
      <div class="rl-native-layer" style="left:10%;top:14%;width:80%;height:52%;background:#5dc6ff;opacity:.2;">
        <span>${escapeHtml(composition.id)}</span>
      </div>
      <div class="rl-native-layer" style="left:18%;top:72%;width:64%;height:12%;background:#f4c542;opacity:.6;">
        <span>${escapeHtml(t('noLayers'))}</span>
      </div>
    `;
  }
  return layers.map((layer, index) => `
    <div class="rl-native-layer" style="${layerStyle(layer, index)}">
      <span>${escapeHtml(layer.label || layer.id || layer.type || `Layer ${index + 1}`)}</span>
    </div>
  `).join('');
}

// ─── Preview: stage content (image / video / overlays) ────────────────────────


function renderPlayerPreviewContent() {
  const host = state.playerHost;
  if (playerPreviewReady()) {
    return `
      <iframe
        class="rl-player-frame"
        data-testid="remotion-player-iframe"
        data-stage-key="${escapeHtml(playerStageKey())}"
        src="${escapeHtml(playerHostUrl())}"
        title="Remotion Player preview"
        allow="autoplay; fullscreen"
      ></iframe>
      ${state.playerHostLoading || !state.playerRuntimeReady ? `<div class="rl-overlay rl-overlay--loading rl-player-runtime-overlay"><div class="rl-spinner rl-spinner--sm"></div></div>` : ''}
    `;
  }

  const composition = currentComposition();
  const key = previewFrameKey(composition);
  const preview = state.previewFrame?.key === key ? state.previewFrame : null;
  const statusText = state.playerHostError || host?.health?.error || host?.status || t('startingPlayer');
  const still = preview?.dataUrl
    ? `<img class="rl-preview-frame" src="${escapeHtml(preview.dataUrl)}" alt="${escapeHtml(composition?.id || '')}" />`
    : `<div class="rl-layers-fallback">${renderLayers()}</div>`;
  return `
    ${still}
    <div class="rl-overlay${state.playerHostError ? ' rl-overlay--error' : ''}">
      ${state.playerHostError ? '' : '<div class="rl-spinner"></div>'}
      <p>${escapeHtml(state.playerHostError ? t('playerUnavailable') : t('startingPlayer'))}</p>
      <small>${escapeHtml(statusText)}</small>
    </div>
  `;
}


function renderStudioPreviewContent() {
  const server = state.previewServer;
  if (studioPreviewReady()) {
    return `
      <iframe
        class="rl-studio-frame"
        data-testid="remotion-studio-iframe"
        src="${escapeHtml(server.url)}"
        title="${escapeHtml(t('studioPreview'))}"
        allow="autoplay; fullscreen; clipboard-read; clipboard-write"
      ></iframe>
      ${state.previewServerLoading ? `<div class="rl-overlay rl-overlay--loading"><div class="rl-spinner rl-spinner--sm"></div></div>` : ''}
    `;
  }

  const log = server?.log || '';
  const statusText = state.previewServerError || server?.health?.error || server?.status || t('startingStudio');
  return `
    <div class="rl-studio-boot">
      <div class="rl-spinner"></div>
      <p>${escapeHtml(state.previewServerError ? t('studioUnavailable') : t('startingStudio'))}</p>
      <small>${escapeHtml(statusText)}</small>
      ${log ? `<pre class="rl-studio-log">${escapeHtml(log.slice(-1800))}</pre>` : ''}
    </div>
  `;
}


function replaceElementHtml(selector, html) {
  const current = document.querySelector(selector);
  if (!current) return false;
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  const next = template.content.firstElementChild;
  if (!next) return false;
  current.replaceWith(next);
  return true;
}


function timelineTickInterval(duration) {
  if (duration <= 30)   return 5;
  if (duration <= 90)   return 10;
  if (duration <= 300)  return 30;
  if (duration <= 900)  return 60;
  if (duration <= 3600) return 150;
  return Math.ceil(duration / 20);
}

// SMPTE drop-frame-free timecode: HH:MM:SS:FF (industry standard used by
// DaVinci Resolve, Premiere Pro, After Effects, Final Cut Pro, etc.)

function renderTimelineZoomControls() {
  const zoom = Math.max(1, state.tlZoom || 1);
  const contentW = Math.round(zoom * 100);

  return `
    <div class="rl-transport__zoom" aria-label="Timeline zoom">
      <button class="rl-tl-zoom-btn" data-action="tl-zoom-out" aria-label="Zoom out"${zoom <= 1 ? ' disabled' : ''}>
        <svg width="10" height="2" viewBox="0 0 10 2" fill="none" aria-hidden="true"><path d="M1 1h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
      <input type="range" class="rl-tl-zoom-slider" min="1" max="16" step="0.25" value="${zoom}" data-action="tl-zoom" aria-label="Timeline zoom" />
      <button class="rl-tl-zoom-btn" data-action="tl-zoom-in" aria-label="Zoom in"${zoom >= 16 ? ' disabled' : ''}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
      <span class="rl-tl-zoom-label">${contentW}%</span>
      ${zoom > 1.05 ? `<button class="rl-tl-zoom-fit" data-action="tl-zoom-fit" aria-label="Fit all frames">Fit</button>` : ''}
    </div>
  `;
}


function renderTimelineInline(composition, duration, fps) {
  const zoom = Math.max(1, state.tlZoom || 1);

  const sequences = asArray(state.frameModel?.sequences).length
    ? asArray(state.frameModel?.sequences)
    : asArray(composition?.sequences);

  // Percentage helpers — positions are always 0-100% within .rl-tl-content
  // so they stay correct at any zoom level (the content div itself gets wider).
  const scale = duration > 1 ? 100 / (duration - 1) : 0;
  const pct = (f) => Math.min(100, Math.max(0, f * scale));
  const playheadPct = pct(state.frame);

  // Tick density adapts to zoom: zoomed-in → denser ticks (more frame detail).
  // visibleFrames estimates how many frames fit in the viewport at current zoom.
  const visibleFrames = Math.max(5, Math.ceil((duration - 1) / zoom));
  const interval = timelineTickInterval(visibleFrames);
  const ticks = [];
  for (let f = 0; f < duration; f += interval) ticks.push(f);
  if (duration > 1 && ticks[ticks.length - 1] !== duration - 1) ticks.push(duration - 1);

  // Fall back to a single composition-wide track when sequences are unknown.
  const trackRows = sequences.length
    ? sequences
    : [{ id: composition.id, from: 0, durationInFrames: duration }];

  // Content width: 100% at zoom=1, 200% at zoom=2, up to 1600% at zoom=16.
  // The .rl-tl-main container scrolls horizontally over this content.
  const contentW = Math.round(zoom * 100);

  // Tick label: frame number when zoomed in enough to show individual frames;
  // switch to SMPTE timecode on large compositions for readability.
  const useSmpteLabels = duration > 300;
  const tickLabel = (f) =>
    useSmpteLabels ? formatSMPTE(f, fps).slice(3) : String(f); // MM:SS:FF or raw frame

  return `
    <div class="rl-tl-inline">

      <!-- Two-column layout: fixed labels | scrollable ruler+tracks -->
      <div class="rl-tl-workspace" data-tl-max="${duration - 1}">

        <div class="rl-tl-labels">
          <div class="rl-tl-gutter"></div>
          ${trackRows.map((seq) => `
            <div class="rl-tl-label"><span>${escapeHtml(seq.label || seq.id || 'Sequence')}</span></div>
          `).join('')}
        </div>

        <!-- Scrollable region — inner content stretches to zoom * 100% -->
        <div class="rl-tl-main">
          <div class="rl-tl-content" style="width:${contentW}%;min-width:100%">

            <!-- Ruler: invisible drag-to-scrub range input overlaid on tick marks -->
            <div class="rl-tl-ruler" data-tl-seek="${duration - 1}">
              <input
                type="range"
                class="rl-tl-scrub"
                min="0"
                max="${duration - 1}"
                value="${state.frame}"
                data-action="frame-range"
                aria-label="${escapeHtml(t('frame'))}"
              />
              ${ticks.map((f) => `
                <div class="rl-tl-tick${f === state.frame ? ' is-current' : ''}" style="left:${pct(f)}%" aria-hidden="true">
                  <span class="rl-tl-tick__lbl">${tickLabel(f)}</span>
                </div>
              `).join('')}
              <!-- Playhead: triangle + stem, always at current frame position -->
              <div class="rl-tl-playhead" style="left:${playheadPct}%" aria-hidden="true"></div>
            </div>

            <!-- Sequence bars: click-to-seek, active bar highlighted by accent -->
            <div class="rl-tl-tracks">
              ${trackRows.map((seq) => {
                const from   = clamp(Number(seq.from || 0), 0, duration - 1);
                const len    = clamp(Number(seq.duration || seq.durationInFrames || duration), 1, duration);
                const barL   = pct(from);
                const barW   = Math.max(0.4, pct(from + len) - barL);
                const active = state.frame >= from && state.frame < (from + len);
                const seqDur = Math.min(len, duration - from);
                return `
                  <div class="rl-tl-track" data-tl-seek="${duration - 1}">
                    <div class="rl-tl-bar${active ? ' is-active' : ''}" style="left:${barL}%;width:${barW}%">
                      ${seqDur > 8 ? `<span class="rl-tl-bar__dur">${seqDur}f</span>` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
              <!-- Vertical playhead line spanning all tracks -->
              <div class="rl-tl-vline" style="left:${playheadPct}%" aria-hidden="true"></div>
            </div>

          </div>
        </div>
      </div>

    </div>
  `;
}


function fitPreviewStage() {
  const stage = document.querySelector('.rl-stage:not(.rl-stage--studio)');
  const area = stage?.closest('.rl-stage-area');
  const composition = currentComposition();
  if (!stage || !area || !composition) return;
  const areaRect = area.getBoundingClientRect();
  const sourceWidth = Math.max(1, Number(composition.width) || 1920);
  const sourceHeight = Math.max(1, Number(composition.height) || 1080);
  const ratio = sourceWidth / sourceHeight;
  const maxWidth = Math.min(Math.max(1, areaRect.width), sourceWidth);
  const maxHeight = Math.min(Math.max(1, areaRect.height), sourceHeight);
  let width = maxWidth;
  let height = width / ratio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  stage.style.width = `${Math.max(1, Math.round(width))}px`;
  stage.style.height = `${Math.max(1, Math.round(height))}px`;
}


function ensurePreviewVideoPlayback() {
  if (!state.playing) return;
  const video = document.querySelector('.rl-preview-video');
  if (!video || video.tagName !== 'VIDEO') return;
  video.muted = true;
  const playPromise = video.play?.();
  if (typeof playPromise?.catch === 'function') {
    playPromise.catch(() => {
      // Browsers can still require a second gesture; controls remain visible.
    });
  }
}


export { commitSelectionMarkerDom, ensurePreviewVideoPlayback, fitPreviewStage, removeDraftMarker, renderDetectingState, renderDetectionState, renderExportOverlay, renderHeader, renderLayers, renderPlayerPreviewContent, renderSelectCaptureLayer, renderSelectionMarker, renderSelectionOverlay, renderStudioPreviewContent, renderTimelineInline, renderTimelineZoomControls, renderWorkspaceEmpty, replaceElementHtml, setPlayingState, syncFrameDom, syncFrameFromPlayer, syncPlayingDom, syncSelectionOverlayDom, updateDraftMarkerDom };
