import { escapeHtml, getActiveIndex, getActiveSlide, getSelectedElement } from './state.js';
import { translate as t } from './i18n.js';

export function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((node) => {
    node.setAttribute('aria-label', t(node.dataset.i18nAria));
  });
}

export function renderAll(state, handlers) {
  syncInputs(state);
  renderGeneration(state);
  renderOutline(state, handlers);
  renderThumbs(state, handlers);
  renderSlideCanvas(state, handlers);
  renderInspector(state, handlers);
  document.querySelector('.ppt-live')?.setAttribute('data-density', state.style.density);
  document.querySelectorAll('.segment').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === state.mode);
  });
}

export function renderGeneration(state) {
  const list = byId('generationSteps');
  const steps = state.generation?.steps || [];
  const current = steps.find((step) => step.id === state.generation?.current) || steps.find((step) => step.status === 'running') || steps.find((step) => step.status === 'error') || steps.find((step) => step.status === 'done') || null;
  const doneCount = steps.filter((step) => step.status === 'done').length;
  const isActive = Boolean(state.generation?.active || steps.some((step) => step.status === 'running'));
  const hasError = steps.some((step) => step.status === 'error');
  const progress = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;
  document.querySelector('.ppt-live')?.classList.toggle('is-generating', isActive);
  document.querySelector('.ppt-live')?.classList.toggle('has-generation-error', hasError);
  text('topProgressText', current ? `${current.label}: ${current.detail}` : t('ready'));
  byId('topProgressMeter')?.style.setProperty('--progress', `${progress}%`);
  text('generationOverlayTitle', current?.label || t('ready'));
  text('generationOverlayDetail', current?.detail || t('exportReady'));
  const overlay = byId('generationOverlay');
  if (overlay) overlay.hidden = !isActive && !hasError;
  if (!list) return;
  list.innerHTML = '';
  steps.forEach((step, index) => {
    const row = document.createElement('li');
    row.className = `generation-step is-${step.status || 'pending'}`;
    row.innerHTML = `
      <span class="generation-index">${index + 1}</span>
      <span class="generation-copy">
        <strong>${escapeHtml(step.label)}</strong>
        <small>${escapeHtml(step.detail)}</small>
      </span>
    `;
    list.append(row);
  });
}

export function syncInputs(state) {
  value('topicInput', state.brief.topic);
  value('audienceInput', state.brief.audience);
  value('materialInput', state.brief.material);
  value('slideTargetInput', state.brief.slideTarget);
  value('deckTypeInput', state.brief.deckType);
  value('toneInput', state.brief.tone);
  value('themeInput', state.style.theme);
  value('densityInput', state.style.density);
  value('brandPrimaryInput', state.style.brandPrimary);
  value('brandAccentInput', state.style.brandAccent);
  value('imagePolicyInput', state.brief.imagePolicy);
  text('deckTitle', state.title || t('defaultDeckTitle'));
  text('deckMeta', t('slidesMeta', { count: state.slides.length }));
  text('slideCount', state.brief.slideTarget);
  text('currentSlideIndex', String(getActiveIndex(state) + 1));
}

export function readInputs(state) {
  state.brief.topic = val('topicInput');
  state.brief.audience = val('audienceInput');
  state.brief.material = val('materialInput');
  state.brief.slideTarget = Number(val('slideTargetInput')) || state.brief.slideTarget;
  state.brief.deckType = val('deckTypeInput') || state.brief.deckType;
  state.brief.tone = val('toneInput') || state.brief.tone;
  state.brief.imagePolicy = val('imagePolicyInput') || state.brief.imagePolicy;
  state.style.theme = val('themeInput') || state.style.theme;
  state.style.density = val('densityInput') || state.style.density;
  state.style.brandPrimary = val('brandPrimaryInput') || state.style.brandPrimary;
  state.style.brandAccent = val('brandAccentInput') || state.style.brandAccent;
}

export function renderOutline(state, handlers) {
  const list = byId('outlineList');
  if (!list) return;
  list.innerHTML = '';
  state.outline.forEach((item, index) => {
    const row = document.createElement('li');
    row.className = 'outline-row';
    row.innerHTML = `
      <span class="outline-index">${index + 1}</span>
      <input class="outline-input" value="${escapeHtml(item)}">
      <div class="outline-actions">
        <button class="mini-btn" type="button" data-move="-1" aria-label="Move up">↑</button>
        <button class="mini-btn" type="button" data-move="1" aria-label="Move down">↓</button>
        <button class="mini-btn" type="button" data-remove aria-label="Remove">×</button>
      </div>
    `;
    row.querySelector('.outline-input').addEventListener('input', (event) => handlers.updateOutline(index, event.target.value));
    row.querySelectorAll('[data-move]').forEach((button) => {
      button.addEventListener('click', () => handlers.moveOutline(index, Number(button.dataset.move)));
    });
    row.querySelector('[data-remove]').addEventListener('click', () => handlers.removeOutline(index));
    list.append(row);
  });
}

export function renderThumbs(state, handlers) {
  const holder = byId('slideThumbs');
  if (!holder) return;
  holder.innerHTML = '';
  state.slides.forEach((slide, index) => {
    const button = document.createElement('button');
    button.className = `thumb${slide.id === state.activeSlideId ? ' is-active' : ''}`;
    button.type = 'button';
    button.style.setProperty('--thumb-bg', slide.theme.background);
    button.style.setProperty('--thumb-primary', slide.theme.primary);
    button.innerHTML = `
      <span class="thumb-kicker">${escapeHtml(slide.kicker || '')}</span>
      <span class="thumb-title">${escapeHtml(slide.title)}</span>
      <span class="thumb-number">${index + 1}</span>
    `;
    button.addEventListener('click', () => handlers.selectSlide(slide.id));
    holder.append(button);
  });
}

export function renderSlideCanvas(state, handlers) {
  const canvas = byId('slideCanvas');
  if (!canvas) return;
  const slide = getActiveSlide(state);
  canvas.innerHTML = slide ? slideHtml(slide, { selectedElementId: state.selectedElementId, editable: true }) : '';
  canvas.querySelectorAll('.slide-element').forEach((node) => {
    node.addEventListener('pointerdown', (event) => handlers.beginDrag(event, node.dataset.elementId));
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.selectElement(node.dataset.elementId);
    });
  });
  canvas.addEventListener('click', () => handlers.selectElement(''), { once: true });
}

export function renderInspector(state, handlers) {
  const panel = byId('elementInspector');
  const element = getSelectedElement(state);
  const slide = getActiveSlide(state);
  if (!panel || !slide) return;
  if (!element) {
    panel.innerHTML = `${slideMethodologyFields(slide)}<p class="empty-copy">${t('noSelection')}</p><label>${t('speakerNotesLabel')}<textarea id="slideNotesInput" rows="5">${escapeHtml(slide.notes || '')}</textarea></label>`;
    bindSlideFields(panel, handlers);
    panel.querySelector('#slideNotesInput')?.addEventListener('input', (event) => handlers.updateSlideNotes(event.target.value));
    return;
  }
  panel.innerHTML = `
    ${slideMethodologyFields(slide)}
    <label>${t('elementTypeLabel')}<input value="${escapeHtml(element.type)}" readonly></label>
    <label>${t('elementTextLabel')}<textarea id="elementTextInput" rows="4">${escapeHtml(element.text || '')}</textarea></label>
    <label>${t('elementItemsLabel')}<textarea id="elementItemsInput" rows="4">${escapeHtml((element.items || []).join('\n'))}</textarea></label>
    <label>${t('elementDataLabel')}<textarea id="elementDataInput" rows="4">${escapeHtml((element.data || []).map((point) => `${point.label}: ${point.value}`).join('\n'))}</textarea></label>
    <div class="field-grid dense">
      <label>X<input id="elementXInput" type="number" min="0" max="100" value="${round(element.x)}"></label>
      <label>Y<input id="elementYInput" type="number" min="0" max="100" value="${round(element.y)}"></label>
      <label>W<input id="elementWInput" type="number" min="3" max="100" value="${round(element.w)}"></label>
      <label>H<input id="elementHInput" type="number" min="3" max="100" value="${round(element.h)}"></label>
    </div>
    <div class="field-grid dense">
      <label>Font<input id="elementFontInput" type="number" min="8" max="88" value="${element.style.fontSize}"></label>
      <label>Weight<input id="elementWeightInput" type="number" min="100" max="900" step="50" value="${element.style.fontWeight}"></label>
      <label>Color<input id="elementColorInput" type="text" value="${escapeHtml(element.style.color)}"></label>
      <label>Bg<input id="elementBgInput" type="text" value="${escapeHtml(element.style.background)}"></label>
    </div>
    <label>${t('speakerNotesLabel')}<textarea id="slideNotesInput" rows="5">${escapeHtml(slide.notes || '')}</textarea></label>
  `;
  [
    'elementTextInput',
    'elementItemsInput',
    'elementDataInput',
    'elementXInput',
    'elementYInput',
    'elementWInput',
    'elementHInput',
    'elementFontInput',
    'elementWeightInput',
    'elementColorInput',
    'elementBgInput',
    'slideNotesInput',
  ].forEach((id) => panel.querySelector(`#${id}`)?.addEventListener('input', () => handlers.updateElementFromInspector()));
  bindSlideFields(panel, handlers);
}

function slideMethodologyFields(slide) {
  return `
    <div class="method-fields">
      <label>${t('kickerLabel')}<input id="slideKickerInput" value="${escapeHtml(slide.kicker || '')}"></label>
      <label>${t('claimLabel')}<textarea id="slideClaimInput" rows="3">${escapeHtml(slide.claim || '')}</textarea></label>
      <label>${t('proofObjectLabel')}<input id="slideProofInput" value="${escapeHtml(slide.proofObject || '')}"></label>
      <label>${t('supportNoteLabel')}<textarea id="slideSupportInput" rows="3">${escapeHtml(slide.supportNote || '')}</textarea></label>
      <label>${t('sourceNoteLabel')}<input id="slideSourceInput" value="${escapeHtml(slide.sourceNote || '')}"></label>
    </div>
  `;
}

function bindSlideFields(panel, handlers) {
  ['slideKickerInput', 'slideClaimInput', 'slideProofInput', 'slideSupportInput', 'slideSourceInput'].forEach((id) => {
    panel.querySelector(`#${id}`)?.addEventListener('input', () => handlers.updateSlideMethodology());
  });
}

export function slideHtml(slide, options = {}) {
  const editable = Boolean(options.editable);
  const selectedId = options.selectedElementId || '';
  const style = [
    `--slide-bg:${slide.theme.background}`,
    `--slide-ink:${slide.theme.ink}`,
    `--slide-muted:${slide.theme.muted}`,
    `--slide-primary:${slide.theme.primary}`,
    `--slide-accent:${slide.theme.accent}`,
    `--slide-panel:${slide.theme.panel || '#ffffff'}`,
  ].join(';');
  return `<div class="slide free-slide layout-${escapeHtml(slide.layout)}" style="${style}" data-slide-id="${escapeHtml(slide.id)}">
    ${slide.kicker ? `<div class="slide-kicker"><span></span><b>${escapeHtml(slide.kicker)}</b></div>` : ''}
    ${slide.proofObject ? `<div class="slide-proof-tag">${escapeHtml(slide.proofObject)}</div>` : ''}
    ${(slide.elements || []).map((element) => elementHtml(element, slide.theme, editable, selectedId)).join('')}
    ${slide.sourceNote ? `<div class="slide-source-note">${escapeHtml(slide.sourceNote)}</div>` : ''}
  </div>`;
}

function elementHtml(element, theme, editable, selectedId) {
  const selected = editable && selectedId === element.id;
  const style = [
    `left:${element.x}%`,
    `top:${element.y}%`,
    `width:${element.w}%`,
    `height:${element.h}%`,
    `font-size:${element.style.fontSize}px`,
    `font-weight:${element.style.fontWeight}`,
    `color:${resolveColor(element.style.color, theme)}`,
    `text-align:${element.style.align || 'left'}`,
    `background:${resolveColor(element.style.background, theme)}`,
    `opacity:${element.style.opacity}`,
    `border-radius:${element.style.borderRadius}px`,
  ].join(';');
  let content = '';
  if (element.type === 'list') {
    content = `<ul>${(element.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  } else if (element.type === 'metric') {
    content = `<strong>${escapeHtml(element.text)}</strong><span>${escapeHtml(element.label)}</span>`;
  } else if (element.type === 'chart') {
    const max = Math.max(1, ...(element.data || []).map((point) => Number(point.value) || 0));
    content = `<b>${escapeHtml(element.text)}</b><div class="chart-bars">${(element.data || []).map((point) => `<span><i style="height:${Math.max(8, (Number(point.value) || 0) / max * 100)}%"></i><em>${escapeHtml(point.label)}</em></span>`).join('')}</div>`;
  } else if (element.type === 'media') {
    content = `<span>${escapeHtml(element.text || t('mediaPlaceholder'))}</span>`;
  } else {
    content = escapeHtml(element.text || '');
  }
  return `<div class="slide-element element-${element.type}${selected ? ' is-selected' : ''}" data-element-id="${escapeHtml(element.id)}" style="${style}">${content}${selected ? '<i class="resize-handle"></i>' : ''}</div>`;
}

export function resolveColor(value, theme) {
  if (!value || value === 'transparent') return 'transparent';
  if (value === 'ink') return theme.ink;
  if (value === 'muted') return theme.muted;
  if (value === 'primary') return theme.primary;
  if (value === 'accent') return theme.accent;
  if (value === 'panel') return theme.panel || '#ffffff';
  if (value === 'soft') return colorMix(theme.primary, 0.1);
  if (value === 'background') return theme.background;
  return value;
}

function colorMix(hex, alpha) {
  const raw = String(hex || '#0f766e').replace('#', '');
  const int = parseInt(raw.length === 3 ? raw.split('').map((x) => x + x).join('') : raw, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function byId(id) {
  return document.getElementById(id);
}

function value(id, next) {
  const node = byId(id);
  if (node && document.activeElement !== node) node.value = next ?? '';
}

function val(id) {
  return byId(id)?.value || '';
}

function text(id, value) {
  const node = byId(id);
  if (node) node.textContent = String(value ?? '');
}

function round(value) {
  return Math.round(Number(value) * 10) / 10;
}
