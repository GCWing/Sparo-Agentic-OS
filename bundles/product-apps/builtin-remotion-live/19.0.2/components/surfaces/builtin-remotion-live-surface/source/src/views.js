import { ICONS, PLAYER_CONTROL_PROTOCOL_VERSION, PLAYER_HOST_RUNTIME_VERSION } from './constants.js';
import { compositionDuration, currentComposition, frameLayers, layerBox, layerElementId, timelineFramePercent } from './model.js';
import { playerHostUrl } from './player-dom.js';
import { playerPreviewReady, playerStageKey } from './preview-controller.js';
import { state } from './state.js';
import { asArray, clamp, escapeHtml, formatSMPTE, previewStageNode, t, workspaceLabel } from './util.js';

function actualFrame() {
  const value = Number(state.playerActualState?.frame ?? state.playerRuntimeFrame ?? state.frame);
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function transportFrame() {
  const seeking = state.playerSeeking || state.playerInFlightCommand?.type === 'seek';
  const desired = Number(state.playerDesiredState?.frame ?? state.frame);
  return seeking && Number.isFinite(desired) ? Math.round(desired) : actualFrame();
}

function isFrameCommitted() {
  const composition = currentComposition();
  const projectRevision = state.manifest?.projectRevision || state.manifest?.sourceRevision;
  const descriptorRevision = composition?.descriptorRevision || state.manifest?.descriptorRevision;
  return Boolean(
    state.playerRuntimeReady
      && projectRevision
      && descriptorRevision
      && state.playerActualState?.projectRevision === projectRevision
      && state.playerActualState?.descriptorRevision === descriptorRevision
      && !state.playerSeeking
      && !state.playerBuffering
      && !state.playerRuntimePlaying
      && state.playerCommittedFrame !== null
      && Number(state.playerCommittedFrame) === actualFrame()
      && actualFrame() === Math.round(Number(state.frame) || 0),
  );
}

function previewPhase() {
  if (state.error || state.playerHostError || state.playerPhase === 'error') return 'error';
  if (state.phase === 'detecting') return 'detecting';
  if (state.phase === 'snapshot') return 'snapshot';
  if (state.phase === 'bundling') return 'bundling';
  if (state.playerBuffering || state.playerPhase === 'buffering') return 'buffering';
  if (state.playerSeeking || state.playerPhase === 'seeking') return 'seeking';
  if (state.playerRuntimePlaying || state.playerPhase === 'playing') return 'playing';
  if (state.playerPhase === 'ended') return 'ended';
  if (state.playerRuntimeReady || state.playerPhase === 'paused' || state.playerPhase === 'ready') return 'ready';
  if (state.playerHostLoading || state.phase === 'hostStarting' || state.playerPhase === 'connecting') return 'connecting';
  return state.manifest ? 'loading' : state.phase || 'idle';
}

function phaseLabel(phase = previewPhase()) {
  const keys = {
    idle: 'waitingWorkspace',
    detecting: 'detecting',
    snapshot: 'loadingSnapshot',
    bundling: 'bundling',
    connecting: 'hostStarting',
    loading: 'playerLoading',
    ready: 'readyPaused',
    playing: 'playing',
    buffering: 'buffering',
    seeking: 'seeking',
    ended: 'readyPaused',
    error: 'playerUnavailable',
    notFound: 'projectMissing',
    broken: 'projectBrokenTitle',
    ambiguous: 'ambiguousTitle',
  };
  return t(keys[phase] || 'readyPaused');
}

function phaseTone(phase = previewPhase()) {
  if (phase === 'error' || phase === 'broken') return 'error';
  if (phase === 'ready') return 'success';
  if (phase === 'buffering' || phase === 'seeking' || phase === 'ambiguous') return 'warning';
  if (phase === 'playing') return 'accent';
  return 'info';
}

function renderStatus(phase = previewPhase()) {
  return `
    <span class="bfui-status bfui-status--${phaseTone(phase)} rl-status" data-preview-status data-phase="${phase}">
      <span class="bfui-status__dot" aria-hidden="true"></span>
      <span class="rl-status__label">${escapeHtml(phaseLabel(phase))}</span>
    </span>
  `;
}

function actualAudioState() {
  return {
    muted: state.playerRuntimeReady ? Boolean(state.playerRuntimeMuted) : Boolean(state.muted),
    volume: state.playerRuntimeReady ? clamp(Number(state.playerRuntimeVolume) || 0, 0, 1) : clamp(Number(state.volume) || 0, 0, 1),
  };
}

function syncAudioDom() {
  const audio = actualAudioState();
  const button = document.querySelector('[data-action="toggle-muted"]');
  if (button) {
    button.setAttribute('aria-label', audio.muted ? t('unmute') : t('mute'));
    button.setAttribute('aria-pressed', audio.muted ? 'true' : 'false');
    button.innerHTML = audio.muted ? ICONS.muted : ICONS.volume;
  }
  const volume = document.querySelector('[data-action="volume"]');
  if (volume) volume.value = String(audio.muted ? 0 : audio.volume);
}

function syncPhaseDom() {
  const phase = previewPhase();
  const frameState = isFrameCommitted() ? 'committed' : 'pending';
  const inspectMode = state.interactionMode === 'inspect' ? 'true' : 'false';
  const root = document.getElementById('remotionLiveRoot');
  const workbench = document.querySelector('.rl-workbench');
  [root, workbench].forEach((node) => {
    if (!node) return;
    node.dataset.previewPhase = phase;
    node.dataset.actualFrame = String(actualFrame());
    node.dataset.actualPlaying = state.playerRuntimePlaying ? 'true' : 'false';
    node.dataset.frameState = frameState;
    node.dataset.inspectMode = inspectMode;
    node.dataset.buffering = state.playerBuffering ? 'true' : 'false';
    node.dataset.seeking = state.playerSeeking ? 'true' : 'false';
  });

  const current = document.querySelector('[data-preview-status]');
  if (current && current.dataset.phase !== phase) {
    const template = document.createElement('template');
    template.innerHTML = renderStatus(phase).trim();
    current.replaceWith(template.content.firstElementChild);
  }

  const sendContext = document.querySelector('[data-action="send-context"]');
  if (sendContext) sendContext.disabled = !isFrameCommitted();
  syncAudioDom();

  const stage = previewStageNode();
  const interactionChanged = stage && (
    stage.dataset.runtimePhase !== phase
      || stage.dataset.frameState !== frameState
      || stage.dataset.inspectMode !== inspectMode
  );
  if (stage && interactionChanged) {
    stage.dataset.runtimePhase = phase;
    stage.dataset.frameState = frameState;
    stage.dataset.inspectMode = inspectMode;
    stage.querySelectorAll('.rl-player-runtime-overlay').forEach((node) => node.remove());
    const overlayTemplate = document.createElement('template');
    overlayTemplate.innerHTML = renderPlayerOverlay().trim();
    const overlay = overlayTemplate.content.firstElementChild;
    if (overlay) stage.appendChild(overlay);
    syncInteractionLayersDom();
  }
}

function syncFrameDom(options = {}) {
  const composition = currentComposition();
  const duration = compositionDuration(composition);
  const fps = Number(composition?.fps || 30);
  const committedFrame = clamp(actualFrame(), 0, duration - 1);
  const frame = clamp(transportFrame(), 0, duration - 1);
  const percent = timelineFramePercent(frame, composition);

  document.querySelectorAll('input[data-action="frame-number"], input[data-action="frame-range"]').forEach((node) => {
    node.value = String(frame);
  });
  document.querySelectorAll('.rl-timecode__value').forEach((node) => {
    node.textContent = formatSMPTE(frame, fps);
  });
  document.querySelectorAll('.rl-frame-current').forEach((node) => {
    node.textContent = String(frame);
  });
  document.querySelectorAll('.rl-frame-actual').forEach((node) => {
    node.textContent = String(committedFrame);
  });
  document.querySelectorAll('.rl-review-scrub').forEach((node) => {
    node.style.setProperty('--rl-progress', `${percent}%`);
  });
  document.querySelectorAll('.rl-review-playhead').forEach((node) => {
    node.style.left = `${percent}%`;
  });
  if (options.syncPhase !== false) syncPhaseDom();
}

function syncPlayingDom(options = {}) {
  const actualPlaying = Boolean(state.playerRuntimePlaying);
  const desiredPlaying = Boolean(state.playerDesiredState?.playing ?? actualPlaying);
  const pending = desiredPlaying !== actualPlaying;
  document.querySelectorAll('[data-action="toggle-play"]').forEach((button) => {
    button.classList.toggle('is-playing', actualPlaying);
    button.classList.toggle('is-pending', pending);
    button.setAttribute('aria-label', actualPlaying ? t('pause') : t('play'));
    button.setAttribute('aria-pressed', actualPlaying ? 'true' : 'false');
    button.setAttribute('aria-busy', pending ? 'true' : 'false');
    if (button.classList.contains('rl-play-btn')) button.innerHTML = actualPlaying ? ICONS.pause : ICONS.play;
  });
  if (options.syncPhase !== false) syncPhaseDom();
}

function syncPlaybackDom() {
  syncFrameDom({ syncPhase: false });
  syncPlayingDom({ syncPhase: false });
  syncPhaseDom();
}

function setPlayingState(playing) {
  state.playerRuntimePlaying = Boolean(playing);
  syncPlayingDom();
}

function syncFrameFromPlayer(frame) {
  state.playerRuntimeFrame = clamp(Math.round(Number(frame) || 0), 0, compositionDuration() - 1);
  state.frame = state.playerRuntimeFrame;
  state.frameTouched = true;
  syncFrameDom();
}

function renderExportOverlay() {
  const composition = currentComposition();
  if (state.exportConfirmOpen && composition) {
    return `
      <dialog class="bfui-dialog rl-export-dialog" aria-modal="true" aria-labelledby="rl-export-title">
        <div class="bfui-dialog__header">
          <div>
            <div class="bfui-dialog__title" id="rl-export-title">${escapeHtml(t('exportConfirmTitle'))}</div>
            <div class="bfui-dialog__description">${escapeHtml(composition.id)}</div>
          </div>
        </div>
        <div class="bfui-dialog__body">${escapeHtml(t('exportConfirmBody', {
          composition: composition.id,
          lastFrame: compositionDuration(composition) - 1,
        }))}</div>
        <div class="bfui-dialog__footer">
          <button type="button" class="btn btn-sm btn-ghost" data-action="export-dismiss">${escapeHtml(t('cancel'))}</button>
          <button type="button" class="btn btn-sm btn-primary" data-action="export-confirm" autofocus>${escapeHtml(t('exportConfirm'))}</button>
        </div>
      </dialog>
    `;
  }

  const run = state.exportRun;
  if (!run) return '';
  const busy = run.status === 'queued' || run.status === 'running' || run.status === 'cancelling';
  const progress = clamp(Number(run.progress ?? 0), 0, 100);
  const label = run.status === 'cancelling'
    ? t('exportCancelling')
    : busy
    ? t('exporting')
    : run.status === 'completed'
    ? t('exportDone')
    : run.status === 'cancelled'
    ? t('exportCancelled')
    : t('exportFailed');
  return `
    <aside class="v-card v-card--elevated v-card--padding-small rl-export-job" role="status" aria-live="polite">
      <div class="rl-export-job__row">
        ${busy ? '<span class="bfui-spinner__mark" aria-hidden="true"></span>' : ''}
        <strong>${escapeHtml(label)}</strong>
        ${busy && run.status !== 'cancelling' && run.runId ? `<button type="button" class="btn btn-sm btn-ghost" data-action="cancel-export">${escapeHtml(t('cancel'))}</button>` : ''}
        ${!busy ? `<button type="button" class="btn btn-sm btn-ghost btn-icon-only" data-action="export-run-dismiss" aria-label="${escapeHtml(t('cancel'))}">×</button>` : ''}
      </div>
      ${busy ? `<div class="rl-export-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div>` : ''}
      ${run.outputPath ? `<small title="${escapeHtml(run.outputPath)}">${escapeHtml(run.outputPath)}</small>` : ''}
      ${run.error ? `<small class="rl-export-job__error">${escapeHtml(run.error)}</small>` : ''}
    </aside>
  `;
}

function renderHeader() {
  const compositions = asArray(state.manifest?.compositions);
  const composition = currentComposition();
  const committed = isFrameCommitted();
  const inspect = state.interactionMode === 'inspect';
  const exportBusy = ['queued', 'running', 'cancelling'].includes(state.exportRun?.status);
  return `
    <header class="bfui-toolbar rl-header">
      <div class="bfui-toolbar__group rl-header__identity">
        <span class="rl-header__workspace" title="${escapeHtml(state.workspacePath || '')}">${escapeHtml(state.workspacePath ? workspaceLabel() : t('title'))}</span>
        ${composition ? '<span class="rl-header__slash" aria-hidden="true">/</span>' : ''}
        ${compositions.length > 1 ? `
          <select class="rl-composition-select" data-action="select-composition" aria-label="${escapeHtml(t('composition'))}">
            ${compositions.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === composition?.id ? ' selected' : ''}>${escapeHtml(item.id)}</option>`).join('')}
          </select>
        ` : composition ? `<span class="rl-header__composition">${escapeHtml(composition.id)}</span>` : ''}
      </div>
      <div class="rl-header__status" role="status" aria-live="polite">${renderStatus()}</div>
      <div class="bfui-toolbar__group rl-header__actions">
        <button type="button" class="btn btn-sm ${inspect ? 'btn-primary' : 'btn-secondary'} rl-labelled-action" data-action="toggle-inspect" aria-pressed="${inspect}" aria-label="${escapeHtml(inspect ? t('exitInspect') : t('inspect'))}">
          ${ICONS.inspect}<span>${escapeHtml(inspect ? t('exitInspect') : t('inspect'))}</span>
        </button>
        <button type="button" class="btn btn-sm btn-ghost btn-icon-only" data-action="refresh" title="${escapeHtml(t('refresh'))}" aria-label="${escapeHtml(t('refresh'))}">${ICONS.refresh}</button>
        <button type="button" class="btn btn-sm btn-ghost btn-icon-only rl-expand-action" data-action="expand-panel" title="${escapeHtml(t('expandPanel'))}" aria-label="${escapeHtml(t('expandPanel'))}">${ICONS.expand}</button>
        <button type="button" class="btn btn-sm btn-secondary rl-labelled-action" data-action="start-export" ${composition && !exportBusy ? '' : 'disabled'}><span>${escapeHtml(t('exportVideo'))}</span></button>
        <button type="button" class="btn btn-sm btn-primary rl-labelled-action" data-action="send-context" ${committed ? '' : 'disabled'} title="${escapeHtml(t('sendContext'))}">${ICONS.send}<span>${escapeHtml(t('sendContext'))}</span></button>
      </div>
    </header>
  `;
}

function renderWorkspaceEmpty() {
  return `
    <div class="bfui-empty rl-empty">
      <div class="rl-empty__icon">${ICONS.film}</div>
      <strong class="bfui-empty__title">${escapeHtml(t('title'))}</strong>
      <p class="bfui-empty__description">${escapeHtml(t('noWorkspace'))}</p>
    </div>
  `;
}

function renderDetectingState() {
  return `
    <div class="bfui-empty rl-empty" role="status" aria-live="polite">
      <span class="bfui-spinner"><span class="bfui-spinner__mark"></span><span>${escapeHtml(t('detecting'))}</span></span>
    </div>
  `;
}

function renderDetectionState() {
  const detection = state.detection || {};
  const status = detection.status || (detection.ok ? 'matched' : 'notFound');
  if (status === 'ambiguous') {
    return `
      <section class="v-card v-card--padding-medium rl-detection">
        <h2>${escapeHtml(t('ambiguousTitle'))}</h2>
        <p>${escapeHtml(t('ambiguousHint'))}</p>
        <div class="bfui-stack">
          ${asArray(detection.entryPoints).map((entry) => `
            <button type="button" class="btn btn-base btn-secondary rl-entry" data-action="select-entry" data-entry="${escapeHtml(entry.path)}">
              <span>${escapeHtml(entry.path)}</span><small>${escapeHtml(entry.source || '')}</small>
            </button>
          `).join('')}
        </div>
      </section>
    `;
  }
  const broken = status === 'broken';
  const firstError = asArray(detection.diagnostics).find((item) => item.level === 'error');
  const reason = detection.errorSummary || firstError?.message || (broken ? t('projectBrokenTitle') : t('notRemotion'));
  return `
    <section class="alert ${broken ? 'alert--error' : 'alert--info'} rl-detection">
      <div class="alert__content">
        <div class="alert__title">${escapeHtml(broken ? t('projectBrokenTitle') : t('notRemotionTitle'))}</div>
        <div class="alert__description">${escapeHtml(reason)}</div>
        ${broken && detection.hasNodeModules === false ? `<p>${escapeHtml(t('installDeps'))}</p>` : ''}
        <button type="button" class="btn btn-sm btn-secondary" data-action="refresh">${escapeHtml(t('retry'))}</button>
      </div>
    </section>
  `;
}

function renderSelectionOverlay() {
  const layers = frameLayers();
  if (state.interactionMode !== 'inspect' || !isFrameCommitted() || !layers.length) return '';
  return `
    <div class="rl-selection-overlay">
      ${layers.flatMap((layer, index) => {
        const id = layerElementId(layer, index);
        const box = layerBox(layer, index);
        if (!box) return [];
        const selected = id === state.selectedElementId;
        const label = layer.label || layer.id || layer.type || `Layer ${index + 1}`;
        return [`
          <button type="button" class="rl-selection-hotspot${selected ? ' is-selected' : ''}"
            data-preview-layer-id="${escapeHtml(id)}"
            style="left:${box.x}%;top:${box.y}%;width:${box.width}%;height:${box.height}%;--rl-layer-color:${escapeHtml(box.color)}"
            title="${escapeHtml(label)}" aria-label="${escapeHtml(`${t('selectionElement')} ${label}`)}">
            ${selected ? `<span>${escapeHtml(label)}</span>` : ''}
          </button>
        `];
      }).join('')}
    </div>
  `;
}

function syncSelectionOverlayDom() {
  const stage = previewStageNode();
  if (!stage) return false;
  stage.querySelector('.rl-selection-overlay')?.remove();
  const template = document.createElement('template');
  template.innerHTML = renderSelectionOverlay().trim();
  const node = template.content.firstElementChild;
  if (node) stage.appendChild(node);
  return true;
}

function renderSelectCaptureLayer() {
  return state.interactionMode === 'inspect' && isFrameCommitted()
    ? '<div class="rl-select-capture" data-select-capture="1" aria-hidden="true"></div>'
    : '';
}

function renderPreviewClickLayer() {
  if (state.interactionMode !== 'preview' || !state.playerRuntimeReady) return '';
  return `<button type="button" class="rl-preview-click-layer" data-action="toggle-play" aria-label="${escapeHtml(state.playerRuntimePlaying ? t('pause') : t('play'))}"></button>`;
}

function renderSelectionMarker() {
  if (state.interactionMode !== 'inspect' || !isFrameCommitted()) return '';
  const selection = state.selection;
  if (selection?.type === 'point' && selection.point) {
    return `<div class="rl-sel-point" style="left:${selection.point.x}%;top:${selection.point.y}%" aria-hidden="true"></div>`;
  }
  if (selection?.type === 'region' && selection.normalizedBox) {
    const box = selection.normalizedBox;
    return `<div class="rl-sel-region" style="left:${box.x}%;top:${box.y}%;width:${box.width}%;height:${box.height}%" aria-hidden="true"></div>`;
  }
  return '';
}

function removeDraftMarker() {
  document.querySelectorAll('.rl-sel-draft').forEach((node) => node.remove());
}

function updateDraftMarkerDom() {
  const stage = previewStageNode();
  const draft = state.selectionDraft;
  if (!stage) return;
  let marker = stage.querySelector('.rl-sel-draft');
  if (state.interactionMode !== 'inspect' || !state.selectionDragging || !draft) {
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
  const template = document.createElement('template');
  template.innerHTML = renderSelectionMarker().trim();
  const marker = template.content.firstElementChild;
  if (marker) stage.appendChild(marker);
}

function syncInteractionLayersDom() {
  const stage = previewStageNode();
  if (!stage) return;
  stage.classList.toggle('is-inspecting', state.interactionMode === 'inspect');
  stage.querySelectorAll('.rl-preview-click-layer, .rl-select-capture').forEach((node) => node.remove());
  for (const html of [renderPreviewClickLayer(), renderSelectCaptureLayer()]) {
    if (!html.trim()) continue;
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const node = template.content.firstElementChild;
    if (node) stage.appendChild(node);
  }
  syncSelectionOverlayDom();
  commitSelectionMarkerDom();
}

function renderPlayerOverlay() {
  const phase = previewPhase();
  if (phase === 'error') {
    return `
      <div class="rl-stage-overlay rl-stage-overlay--error rl-player-runtime-overlay">
        <div class="alert alert--error">
          <div class="alert__content">
            <div class="alert__title">${escapeHtml(t('playerUnavailable'))}</div>
            <div class="alert__description">${escapeHtml(state.playerHostError || state.error || t('playerUnavailableHint'))}</div>
            <button type="button" class="btn btn-sm btn-secondary" data-action="retry-preview">${escapeHtml(t('retryPreview'))}</button>
          </div>
        </div>
      </div>
    `;
  }
  if (['detecting', 'snapshot', 'bundling', 'connecting', 'loading'].includes(phase)) {
    return `<div class="rl-stage-overlay rl-player-runtime-overlay" role="status"><span class="bfui-spinner"><span class="bfui-spinner__mark"></span><span>${escapeHtml(phaseLabel(phase))}</span></span></div>`;
  }
  if (phase === 'buffering' || phase === 'seeking') {
    return `<div class="rl-stage-state rl-player-runtime-overlay" role="status"><span class="bfui-spinner"><span class="bfui-spinner__mark"></span><span>${escapeHtml(phaseLabel(phase))}</span></span></div>`;
  }
  return '';
}

function renderPlayerPreviewContent() {
  if (playerPreviewReady()) {
    return `
      <iframe class="rl-player-frame" data-testid="remotion-player-iframe" data-stage-key="${escapeHtml(playerStageKey())}"
        src="${escapeHtml(playerHostUrl())}" title="${escapeHtml(t('preview'))}" allow="autoplay; fullscreen" tabindex="-1"></iframe>
      ${renderPlayerOverlay()}
    `;
  }
  const stale = state.playerHost?.ready && (
    state.playerHost?.runtimeVersion !== PLAYER_HOST_RUNTIME_VERSION
      || state.playerHost?.protocolVersion !== PLAYER_CONTROL_PROTOCOL_VERSION
  );
  const error = state.playerHostError || (stale ? t('protocolMismatch') : null);
  if (error) {
    return `
      <div class="rl-stage-placeholder" aria-hidden="true">${ICONS.film}</div>
      <div class="rl-stage-overlay rl-stage-overlay--error rl-player-runtime-overlay">
        <div class="alert alert--error">
          <div class="alert__content">
            <div class="alert__title">${escapeHtml(t('playerUnavailable'))}</div>
            <div class="alert__description">${escapeHtml(error)}</div>
            <button type="button" class="btn btn-sm btn-secondary" data-action="retry-preview">${escapeHtml(t('retryPreview'))}</button>
          </div>
        </div>
      </div>
    `;
  }
  return `
    <div class="rl-stage-placeholder" aria-hidden="true">${ICONS.film}</div>
    <div class="rl-stage-overlay rl-player-runtime-overlay" role="status">
      <span class="bfui-spinner"><span class="bfui-spinner__mark"></span><span>${escapeHtml(phaseLabel())}</span></span>
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

function renderPlaybackTransport(composition, duration, fps) {
  const wantsToPlay = Boolean(state.playerRuntimePlaying);
  const frame = clamp(transportFrame(), 0, duration - 1);
  const audio = actualAudioState();
  return `
    <div class="rl-transport" role="toolbar" aria-label="${escapeHtml(t('preview'))}">
      <div class="rl-transport__playback">
        <button type="button" class="btn btn-sm btn-ghost btn-icon-only" data-action="step-prev" aria-label="${escapeHtml(t('previous'))}">${ICONS.prev}</button>
        <button type="button" class="btn btn-base btn-primary btn-icon-only rl-play-btn${wantsToPlay ? ' is-playing' : ''}" data-action="toggle-play" aria-label="${escapeHtml(wantsToPlay ? t('pause') : t('play'))}" aria-pressed="${wantsToPlay}">${wantsToPlay ? ICONS.pause : ICONS.play}</button>
        <button type="button" class="btn btn-sm btn-ghost btn-icon-only" data-action="step-next" aria-label="${escapeHtml(t('next'))}">${ICONS.next}</button>
      </div>
      <label class="rl-timecode">
        <span class="rl-timecode__value">${escapeHtml(formatSMPTE(frame, fps))}</span>
        <span class="rl-timecode__frame">
          <input type="number" min="0" max="${duration - 1}" value="${frame}" data-action="frame-number" aria-label="${escapeHtml(t('frame'))}" />
          <span>/ ${duration - 1}</span>
        </span>
      </label>
      <div class="rl-transport__audio">
        <button type="button" class="btn btn-sm btn-ghost btn-icon-only" data-action="toggle-muted" aria-label="${escapeHtml(audio.muted ? t('unmute') : t('mute'))}" aria-pressed="${audio.muted}">${audio.muted ? ICONS.muted : ICONS.volume}</button>
        <input type="range" min="0" max="1" step="0.05" value="${audio.muted ? 0 : audio.volume}" class="rl-volume" data-action="volume" aria-label="${escapeHtml(t('volume'))}" />
      </div>
    </div>
  `;
}

function renderTimelineInline(composition, duration, fps) {
  const frame = clamp(transportFrame(), 0, duration - 1);
  const percent = timelineFramePercent(frame, composition);
  const sequences = asArray(state.playerFrameModel?.sequences).length
    ? asArray(state.playerFrameModel?.sequences)
    : asArray(composition?.sequences);
  return `
    <section class="rl-review" aria-label="${escapeHtml(t('timeline'))}">
      <header class="rl-review__header">
        <strong>${escapeHtml(t('timeline'))}</strong>
        <span>${escapeHtml(t('duration', { frames: duration }))} · ${escapeHtml(t('fps', { fps }))}</span>
      </header>
      <div class="rl-review-track">
        <div class="rl-review-track__segments" aria-hidden="true">
          ${sequences.map((sequence) => {
            const start = clamp(Number(sequence.from || 0), 0, duration - 1);
            const length = clamp(Number(sequence.durationInFrames || sequence.duration || 1), 1, duration - start);
            const left = duration > 1 ? start / (duration - 1) * 100 : 0;
            const width = duration > 1 ? length / (duration - 1) * 100 : 100;
            return `<span style="left:${left}%;width:${Math.min(100 - left, width)}%"></span>`;
          }).join('')}
        </div>
        <input type="range" class="rl-review-scrub" min="0" max="${duration - 1}" value="${frame}" style="--rl-progress:${percent}%" data-action="frame-range" aria-label="${escapeHtml(t('timeline'))}" />
        <span class="rl-review-playhead" style="left:${percent}%" aria-hidden="true"></span>
      </div>
      <div class="rl-review__ticks" aria-hidden="true"><span>0</span><span class="rl-frame-current">${frame}</span><span>${duration - 1}</span></div>
    </section>
  `;
}

function fitPreviewStage() {
  const stage = previewStageNode();
  const area = stage?.closest('.rl-stage-area');
  const composition = currentComposition();
  if (!stage || !area || !composition) return;
  const areaRect = area.getBoundingClientRect();
  const sourceWidth = Math.max(1, Number(composition.width) || 1920);
  const sourceHeight = Math.max(1, Number(composition.height) || 1080);
  const ratio = sourceWidth / sourceHeight;
  let width = Math.max(1, areaRect.width);
  let height = width / ratio;
  if (height > areaRect.height) {
    height = Math.max(1, areaRect.height);
    width = height * ratio;
  }
  stage.style.width = `${Math.floor(width)}px`;
  stage.style.height = `${Math.floor(height)}px`;
}

export {
  actualFrame,
  commitSelectionMarkerDom,
  fitPreviewStage,
  isFrameCommitted,
  previewPhase,
  removeDraftMarker,
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
  setPlayingState,
  syncFrameDom,
  syncPlaybackDom,
  syncFrameFromPlayer,
  syncInteractionLayersDom,
  syncPhaseDom,
  syncPlayingDom,
  syncSelectionOverlayDom,
  updateDraftMarkerDom,
};
