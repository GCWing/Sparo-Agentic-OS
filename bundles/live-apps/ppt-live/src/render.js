import { escapeHtml, extractHtmlSlideBackground, getActiveIndex, getActiveSlide, getSelectedElement, densityToIndex, indexToDensity, normalizeDensity } from './state.js';
import { translate as t, getLocale } from './i18n.js';

export function applyI18n() {
  document.documentElement.lang = getLocale();
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
  renderGenerationOverlay(state);
  renderOutline(state, handlers);
  renderThumbs(state, handlers);
  renderSlideCanvas(state, handlers);
  renderInspector(state, handlers);
  fitSlideCanvas();
  fitThumbPreviews();
  document.querySelector('.ppt-live')?.setAttribute('data-density', state.style.density);
  document.querySelectorAll('.segment').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === state.mode);
  });
  /* Update status bar slide position */
  const activeIndex = getActiveIndex(state);
  const slidePos = byId('slidePosition');
  if (slidePos) {
    slidePos.textContent = `${activeIndex + 1} / ${state.slides?.length || 1}`;
  }
}

let lastCanvasFitKey = '';

export function fitSlideCanvas() {
  const canvas = byId('slideCanvas');
  const area = canvas?.closest('.canvas-area');
  const stage = canvas?.closest('.canvas-stage');
  if (!canvas || !area || !stage) return;

  const areaStyles = getComputedStyle(area);
  const padX = parseFloat(areaStyles.paddingLeft) + parseFloat(areaStyles.paddingRight);
  const padY = parseFloat(areaStyles.paddingTop) + parseFloat(areaStyles.paddingBottom);
  const maxW = Math.max(160, area.clientWidth - padX);
  const maxH = Math.max(90, area.clientHeight - padY);
  let width = maxW;
  let height = width * 9 / 16;
  if (height > maxH) {
    height = maxH;
    width = height * 16 / 9;
  }
  const w = Math.floor(width);
  const h = Math.floor(height);
  const fitKey = `${maxW}x${maxH}`;
  if (fitKey === lastCanvasFitKey && stage.style.width === `${w}px` && stage.style.height === `${h}px`) {
    const frame = canvas.querySelector('.html-slide-frame');
    if (frame) fitHtmlSlideFrame(frame);
    return;
  }
  lastCanvasFitKey = fitKey;
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  const present = byId('presentSlide');
  if (present) {
    present.style.width = `${w}px`;
    present.style.height = `${h}px`;
  }
  const frame = canvas.querySelector('.html-slide-frame');
  if (frame) fitHtmlSlideFrame(frame);
}

export function positionFloatingToolbar(element) {
  const toolbar = byId('floatingToolbar');
  const canvas = byId('slideCanvas');
  if (!toolbar || !canvas || !element) {
    if (toolbar) toolbar.classList.remove('is-visible');
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const elX = (element.x / 100) * rect.width;
  const elY = (element.y / 100) * rect.height;
  const elW = (element.w / 100) * rect.width;
  toolbar.style.left = `${rect.left + elX + elW / 2 - toolbar.offsetWidth / 2}px`;
  toolbar.style.top = `${rect.top + elY - toolbar.offsetHeight - 8}px`;
  toolbar.classList.add('is-visible');
}

function cssLengthToPx(raw, fallback) {
  const text = String(raw || '').trim();
  const num = parseFloat(text);
  if (!Number.isFinite(num)) return fallback;
  if (text.endsWith('pt')) return num * (96 / 72);
  if (text.endsWith('px')) return num;
  return num;
}

export const EXPORT_PREVIEW_WIDTH = 1280;
export const EXPORT_PREVIEW_HEIGHT = 720;

function scopeEmbeddedSlideStyles(styleText, selector) {
  return String(styleText || '').replace(/\bbody\b/g, selector);
}

export function buildExportPreviewStage(html) {
  const stage = document.createElement('div');
  stage.className = 'export-preview__html-stage';
  try {
    const doc = new DOMParser().parseFromString(normalizeSlideDocument(html), 'text/html');
    const styleText = Array.from(doc.querySelectorAll('style')).map((node) => node.textContent || '').join('\n');
    const scopedStyle = scopeEmbeddedSlideStyles(styleText, '.export-preview__html-body');
    const style = document.createElement('style');
    style.textContent = `
      .export-preview__html-stage,
      .export-preview__html-body {
        width: ${EXPORT_PREVIEW_WIDTH}px;
        height: ${EXPORT_PREVIEW_HEIGHT}px;
        margin: 0;
        overflow: hidden;
        box-sizing: border-box;
        position: relative;
      }
      ${scopedStyle}
    `;
    stage.appendChild(style);
    const body = document.createElement('div');
    body.className = 'export-preview__html-body';
    if (doc.body) {
      for (const attr of doc.body.attributes) {
        if (attr.name === 'class') body.classList.add(...attr.value.split(/\s+/).filter(Boolean));
        else body.setAttribute(attr.name, attr.value);
      }
      body.innerHTML = doc.body.innerHTML;
    }
    stage.appendChild(body);
  } catch {
    stage.textContent = '';
  }
  return stage;
}

export function fitExportPreviewFrame(container) {
  if (!container) return;
  const viewport = container.querySelector('.export-preview__viewport') || container;
  const hostW = viewport.clientWidth || viewport.getBoundingClientRect().width;
  const hostH = viewport.clientHeight || viewport.getBoundingClientRect().height;
  if (!hostW || !hostH) return;

  const scaleWrap = viewport.querySelector('.export-preview__scale');
  const content = scaleWrap?.querySelector('.export-preview__html-stage, .export-preview__element-stage');
  if (!scaleWrap || !content) return;

  const isHtml = content.classList.contains('export-preview__html-stage');
  const designW = isHtml ? EXPORT_PREVIEW_WIDTH : 960;
  const designH = isHtml ? EXPORT_PREVIEW_HEIGHT : 540;
  const scale = Math.min(hostW / designW, hostH / designH);

  content.style.width = `${designW}px`;
  content.style.height = `${designH}px`;
  content.style.transform = `scale(${scale})`;
  content.style.transformOrigin = 'top left';
  scaleWrap.style.width = `${Math.floor(designW * scale)}px`;
  scaleWrap.style.height = `${Math.floor(designH * scale)}px`;
}

export function fitHtmlSlideFrame(frame) {
  if (!frame) return;
  let doc = null;
  try {
    doc = frame.contentDocument;
  } catch {
    return;
  }
  if (!doc?.documentElement) return;
  const root = doc.documentElement;
  const body = doc.body;
  if (!body) return;
  const view = doc.defaultView;
  body.style.transform = 'none';
  const bodyStyle = view.getComputedStyle(body);
  let designW = cssLengthToPx(bodyStyle.width, 0) || body.scrollWidth || 960;
  let designH = cssLengthToPx(bodyStyle.height, 0) || body.scrollHeight || 540;
  if (!Number.isFinite(designW) || designW < 320) designW = 960;
  if (!Number.isFinite(designH) || designH < 180) designH = 540;
  if (designW > 2400) designW = 1280;
  if (designH > 2400) designH = 720;
  const hostW = frame.clientWidth || designW;
  const hostH = frame.clientHeight || designH;
  const scale = Math.min(hostW / designW, hostH / designH, 1);
  root.style.width = `${designW}px`;
  root.style.height = `${designH}px`;
  root.style.overflow = 'hidden';
  body.style.margin = '0';
  body.style.width = `${designW}px`;
  body.style.minHeight = `${designH}px`;
  body.style.transformOrigin = 'top left';
  body.style.transform = `scale(${scale})`;
  const offsetX = Math.max(0, (hostW - designW * scale) / 2);
  const offsetY = Math.max(0, (hostH - designH * scale) / 2);
  frame.style.width = `${hostW}px`;
  frame.style.height = `${hostH}px`;
  root.style.position = 'absolute';
  root.style.left = `${offsetX}px`;
  root.style.top = `${offsetY}px`;
}

function userFacingEventDetail(item) {
  if (!item) return '';
  const hiddenKinds = new Set(['turn', 'round', 'round-done', 'tokens', 'text', 'thinking']);
  if (hiddenKinds.has(item.kind || '')) return '';
  const detail = String(item.detail || '').trim();
  if (!detail) return '';
  if (/^[0-9a-f-]{8,}/i.test(detail)) return '';
  return detail;
}

function currentGenerationStep(steps) {
  return steps.find((step) => step.status === 'running')
    || [...steps].reverse().find((step) => step.status === 'done')
    || steps[0]
    || null;
}

function formatGenerationProgress(state) {
  const current = Number(state.generation?.draftedCount) || 0;
  if (current <= 0) return '';
  return t('generationPageProgress', { current });
}

function scrollGenerationListToLatest(list) {
  if (!list) return;
  const schedule = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (callback) => setTimeout(callback, 0);
  schedule(() => {
    list.scrollTop = list.scrollHeight;
  });
}

export function renderGeneration(state) {
  const list = byId('generationSteps');
  const steps = state.generation?.steps || [];
  const events = Array.isArray(state.generation?.events) ? state.generation.events : [];
  const current = steps.find((step) => step.id === state.generation?.current)
    || steps.find((step) => step.status === 'running')
    || steps.find((step) => step.status === 'error')
    || null;
  const doneCount = steps.filter((step) => step.status === 'done').length;
  const isActive = Boolean(state.generation?.active || steps.some((step) => step.status === 'running'));
  const hasError = steps.some((step) => step.status === 'error');
  const isComplete = !isActive && !hasError && steps.length > 0 && doneCount === steps.length;
  const progress = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;
  const pageProgress = formatGenerationProgress(state);
  const topProgress = byId('topProgress');
  if (topProgress) {
    topProgress.classList.toggle('is-step-progress', isActive && !pageProgress);
  }

  document.querySelector('.ppt-live')?.classList.toggle('is-generating', isActive);
  document.querySelector('.ppt-live')?.classList.toggle('has-generation-error', hasError);

  if (isComplete) {
    text('topProgressText', t('deckReady'));
    byId('topProgressMeter')?.style.setProperty('--progress', '100%');
  } else if (isActive && pageProgress) {
    text('topProgressText', pageProgress);
    byId('topProgressMeter')?.style.setProperty('--progress', `${progress}%`);
  } else if (isActive && current) {
    text('topProgressText', `${current.label}: ${current.detail}`);
    byId('topProgressMeter')?.style.setProperty('--progress', `${progress}%`);
  } else if (current) {
    text('topProgressText', `${current.label}: ${current.detail}`);
    byId('topProgressMeter')?.style.setProperty('--progress', `${progress}%`);
  } else {
    text('topProgressText', t('ready'));
    byId('topProgressMeter')?.style.setProperty('--progress', `${progress}%`);
  }

  if (!list) return;
  list.innerHTML = '';
  if (!events.length) {
    const row = document.createElement('li');
    row.className = 'generation-event is-empty';
    row.innerHTML = `
      <span class="generation-index">--</span>
      <span class="generation-copy">
        <strong>${escapeHtml(t('processWaitingForEventsTitle'))}</strong>
        <small>${escapeHtml(t('processWaitingForEvents'))}</small>
      </span>
    `;
    list.append(row);
  } else {
    events.forEach((event, index) => {
      const detail = userFacingEventDetail(event);
      const row = document.createElement('li');
      row.className = `generation-event is-${event.kind || 'info'}`;
      row.innerHTML = `
        <span class="generation-index">${index + 1}</span>
        <span class="generation-copy">
          <strong>${escapeHtml(event.title || t('processEventUnknown'))}</strong>
          ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
        </span>
      `;
      list.append(row);
    });
  }
  scrollGenerationListToLatest(list);
}

export function renderGenerationOverlay(state) {
  const overlay = byId('generationOverlay');
  if (!overlay) return;
  const steps = state.generation?.steps || [];
  const isActive = Boolean(state.generation?.active || steps.some((step) => step.status === 'running'));
  overlay.hidden = !isActive;
  if (!isActive) return;
  const current = steps.find((step) => step.id === state.generation?.current)
    || steps.find((step) => step.status === 'running')
    || null;
  const pageProgress = formatGenerationProgress(state);
  text('generationOverlayTitle', current?.label || t('generationAgentWorking'));
  text('generationOverlayProgress', pageProgress || current?.detail || t('generationProgressPulse'));
}

export function syncFontFamilyToggle(fontFamily = 'sans') {
  const value = fontFamily === 'serif' ? 'serif' : 'sans';
  document.querySelectorAll('[data-font-family]').forEach((button) => {
    const active = button.dataset.fontFamily === value;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

export function syncColorModeToggle(colorMode = 'light') {
  const value = colorMode === 'dark' ? 'dark' : 'light';
  document.querySelectorAll('[data-color-mode]').forEach((button) => {
    const active = button.dataset.colorMode === value;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

export function syncDensitySlider(density = 'standard') {
  const value = normalizeDensity(density);
  const index = densityToIndex(value);
  const root = document.getElementById('densitySlider');
  if (root) {
    root.style.setProperty('--density-index', String(index));
    root.dataset.index = String(index);
    root.setAttribute('aria-valuenow', String(index));
    const labelKey = `density${value.charAt(0).toUpperCase()}${value.slice(1)}`;
    root.setAttribute('aria-valuetext', t(labelKey));
    root.querySelectorAll('[data-density-index]').forEach((tick) => {
      const active = Number(tick.dataset.densityIndex) === index;
      tick.classList.toggle('is-active', active);
    });
  }
  document.querySelector('.ppt-live')?.setAttribute('data-density', value);
}

export function syncInputs(state) {
  const promptDraft = typeof state.promptDraft === 'string' ? state.promptDraft : '';
  const hasDeck = Array.isArray(state.slides) && state.slides.length > 0;
  value('topicInput', hasDeck ? promptDraft : (promptDraft || state.brief.topic));
  syncFontFamilyToggle(state.style.fontFamily);
  syncColorModeToggle(state.style.colorMode);
  syncDensitySlider(state.style.density);
  text('deckTitle', state.title || t('defaultDeckTitle'));
  text('deckMeta', t('slidesMeta', { count: state.slides.length }));
  text('currentSlideIndex', String(getActiveIndex(state) + 1));
}

export function readInputs(state, options = {}) {
  const includeTopic = options.includeTopic !== false;
  if (includeTopic) {
    state.brief.topic = val('topicInput');
    state.promptDraft = state.brief.topic;
    inferBriefFromPrompt(state);
  }
}

function inferBriefFromPrompt(state) {
  const prompt = String(state.brief.topic || '');
  const slideMatch = prompt.match(/(\d{1,2})\s*(?:页|页面|张|slides?|pages?)/i)
    || prompt.match(/(?:页数|slides?|pages?)\D{0,8}(\d{1,2})/i);
  if (slideMatch) state.brief.slideTarget = Math.max(3, Math.min(24, Number(slideMatch[1])));
  else state.brief.slideTarget = 0;
}

export function renderOutline(state, handlers) {
  const list = byId('outlineList');
  if (!list) return;
  list.innerHTML = '';
  state.outline.forEach((item, index) => {
    const row = document.createElement('li');
    const slide = state.slides[index];
    row.className = `outline-row${slide?.id === state.activeSlideId ? ' is-active' : ''}`;
    row.innerHTML = `
      <span class="outline-index">${index + 1}</span>
      <button class="outline-card" type="button">
        <strong>${escapeHtml(item)}</strong>
        <small>${escapeHtml(slide?.proofObject || '')}</small>
      </button>
    `;
    row.querySelector('.outline-card').addEventListener('click', () => {
      if (slide?.id) handlers.selectSlide(slide.id);
    });
    list.append(row);
  });
}

export function renderThumbs(state, handlers) {
  const holder = byId('slideThumbs');
  if (!holder) return;
  holder.innerHTML = '';
  if (!state.slides.length) {
    const empty = document.createElement('div');
    empty.className = 'thumbs-empty';
    empty.textContent = t('slidesEmptyHint');
    holder.append(empty);
    return;
  }
  state.slides.forEach((slide, index) => {
    const extractedBackground = slide.html ? extractHtmlSlideBackground(slide.html) : null;
    const theme = slide.theme || {};
    const thumbBackground = extractedBackground || theme.background || 'var(--studio-slide-chrome)';
    const button = document.createElement('button');
    button.className = `thumb${slide.id === state.activeSlideId ? ' is-active' : ''}`;
    button.type = 'button';
    button.style.setProperty('--thumb-bg', thumbBackground);
    button.style.setProperty('--thumb-primary', theme.primary || 'var(--studio-accent)');

    const preview = document.createElement('div');
    preview.className = 'thumb-preview';
    preview.style.background = thumbBackground;
    if (slide.html) {
      preview.appendChild(buildHtmlThumbStage(slide.html));
    } else {
      const slideNode = document.createElement('div');
      slideNode.className = 'thumb-preview-slide';
      slideNode.innerHTML = slideHtml(slide);
      preview.appendChild(slideNode);
    }
    button.appendChild(preview);

    const copy = document.createElement('div');
    copy.className = 'thumb-copy';
    copy.innerHTML = `
      <span class="thumb-kicker">${escapeHtml(slide.kicker || '')}</span>
      <span class="thumb-title">${escapeHtml(slide.title)}</span>
    `;
    button.appendChild(copy);

    const number = document.createElement('span');
    number.className = 'thumb-number';
    number.textContent = String(index + 1);
    button.appendChild(number);

    button.addEventListener('click', () => handlers.selectSlide(slide.id));
    holder.append(button);
  });
  requestAnimationFrame(() => fitThumbPreviews());
}

const THUMB_BASE_WIDTH = 960;
const THUMB_BASE_HEIGHT = 540;

function buildHtmlThumbStage(html) {
  const stage = document.createElement('div');
  stage.className = 'thumb-preview-html';
  try {
    const doc = new DOMParser().parseFromString(normalizeSlideDocument(html), 'text/html');
    const styleText = Array.from(doc.querySelectorAll('style')).map((node) => node.textContent || '').join('\n');
    const style = document.createElement('style');
    style.textContent = `
      .thumb-preview-html,
      .thumb-preview-html .thumb-preview-body {
        width: ${THUMB_BASE_WIDTH}px;
        height: ${THUMB_BASE_HEIGHT}px;
        margin: 0;
        overflow: hidden;
        box-sizing: border-box;
      }
      ${styleText}
    `;
    stage.appendChild(style);
    const body = document.createElement('div');
    body.className = 'thumb-preview-body';
    if (doc.body) {
      for (const attr of doc.body.attributes) {
        if (attr.name === 'class') body.classList.add(...attr.value.split(/\s+/).filter(Boolean));
        else body.setAttribute(attr.name, attr.value);
      }
      body.innerHTML = doc.body.innerHTML;
    }
    stage.appendChild(body);
  } catch {
    stage.textContent = '';
  }
  return stage;
}

export function fitThumbPreviewFrame(frame, preview) {
  if (!frame || !preview) return;
  const width = preview.clientWidth || preview.getBoundingClientRect().width;
  if (!width) return;
  const scale = width / THUMB_BASE_WIDTH;
  frame.style.width = `${THUMB_BASE_WIDTH}px`;
  frame.style.height = `${THUMB_BASE_HEIGHT}px`;
  frame.style.transform = `scale(${scale})`;
  frame.style.transformOrigin = 'top left';
  preview.style.height = '';
}

function fitThumbPreviewContent(preview) {
  const content = preview.querySelector('.thumb-preview-html, .thumb-preview-slide');
  if (!content) return;
  const width = preview.clientWidth || preview.getBoundingClientRect().width;
  if (!width) return;
  const scale = width / THUMB_BASE_WIDTH;
  content.style.width = `${THUMB_BASE_WIDTH}px`;
  content.style.height = `${THUMB_BASE_HEIGHT}px`;
  content.style.transform = `scale(${scale})`;
  content.style.transformOrigin = 'top left';
  preview.style.height = '';
}

function fitThumbPreviewSlide(preview) {
  fitThumbPreviewContent(preview);
}

export function fitThumbPreviews() {
  const holder = byId('slideThumbs');
  if (!holder) return;
  holder.querySelectorAll('.thumb-preview').forEach((preview) => {
    if (preview.querySelector('.thumb-preview-frame')) {
      fitThumbPreviewFrame(preview.querySelector('.thumb-preview-frame'), preview);
    } else {
      fitThumbPreviewContent(preview);
    }
  });
}

let thumbPreviewObserver = null;

export function observeThumbPreviews() {
  const holder = byId('slideThumbs');
  if (!holder || thumbPreviewObserver) return;
  if (typeof ResizeObserver === 'undefined') return;
  thumbPreviewObserver = new ResizeObserver(() => {
    fitThumbPreviews();
  });
  thumbPreviewObserver.observe(holder);
}

function isStarterDeck(state) {
  if (!String(state.brief?.topic || '').trim()) {
    const title = String(state.title || '').trim();
    if (title === t('blankDeckTitle') || title === t('defaultDeckTitle') || title === t('newSlideTitle')) {
      return true;
    }
  }
  if (!state.slides?.length) return true;
  const title = String(state.title || '').trim();
  const onlyStarterSlide = state.slides.length === 1
    && state.outline.length === 1
    && state.outline[0] === t('newSlideTitle');
  return onlyStarterSlide
    && (title === t('blankDeckTitle') || title === t('newSlideTitle'));
}

function applySlideCanvasBackground(canvas, slide) {
  if (!canvas) return;
  if (!slide) {
    canvas.style.background = '';
    return;
  }
  const theme = slide.theme || {};
  const extracted = slide.html ? extractHtmlSlideBackground(slide.html) : null;
  const background = extracted || theme.background || '';
  canvas.style.background = background || '';
}

export function renderSlideCanvas(state, handlers) {
  const canvas = byId('slideCanvas');
  if (!canvas) return;
  const slide = getActiveSlide(state);
  const isGenerating = Boolean(state.generation?.active || state.generation?.steps?.some((step) => step.status === 'running'));
  if (!slide) {
    canvas.classList.remove('is-html-slide');
    canvas.classList.add('is-empty');
    canvas.innerHTML = isGenerating
      ? `<div class="slide-empty-state"><span aria-hidden="true">PL</span><strong>${escapeHtml(t('generationAgentWorking'))}</strong><p>${escapeHtml(t('agentWorkingDetail'))}</p></div>`
      : `<div class="welcome-hero"><span class="welcome-hero__icon" aria-hidden="true">PL</span><h2>${escapeHtml(t('welcomeTitle'))}</h2><p>${escapeHtml(t('welcomeSubcopy'))}</p><div class="welcome-hero__tips"><button type="button" class="welcome-tip" data-welcome-prompt="${escapeHtml(t('welcomeTip1'))}">${escapeHtml(t('welcomeTip1'))}</button><button type="button" class="welcome-tip" data-welcome-prompt="${escapeHtml(t('welcomeTip2'))}">${escapeHtml(t('welcomeTip2'))}</button><button type="button" class="welcome-tip" data-welcome-prompt="${escapeHtml(t('welcomeTip3'))}">${escapeHtml(t('welcomeTip3'))}</button></div></div>`;
    bindWelcomeTips(canvas);
    applySlideCanvasBackground(canvas, null);
    fitSlideCanvas();
    return;
  }
  if (isStarterDeck(state) && !slide.html && !isGenerating) {
    canvas.classList.remove('is-html-slide');
    canvas.classList.add('is-empty');
    canvas.innerHTML = `
      <div class="welcome-hero">
        <span class="welcome-hero__icon" aria-hidden="true">PL</span>
        <h2>${escapeHtml(t('welcomeTitle'))}</h2>
        <p>${escapeHtml(t('welcomeSubcopy'))}</p>
        <div class="welcome-hero__tips">
          <button type="button" class="welcome-tip" data-welcome-prompt="${escapeHtml(t('welcomeTip1'))}">${escapeHtml(t('welcomeTip1'))}</button>
          <button type="button" class="welcome-tip" data-welcome-prompt="${escapeHtml(t('welcomeTip2'))}">${escapeHtml(t('welcomeTip2'))}</button>
          <button type="button" class="welcome-tip" data-welcome-prompt="${escapeHtml(t('welcomeTip3'))}">${escapeHtml(t('welcomeTip3'))}</button>
        </div>
      </div>
    `;
    bindWelcomeTips(canvas);
    applySlideCanvasBackground(canvas, null);
    fitSlideCanvas();
    return;
  }
  canvas.classList.remove('is-empty');
  if (slide?.html) {
    canvas.innerHTML = '';
    canvas.classList.add('is-html-slide');
    const frame = document.createElement('iframe');
    frame.className = 'html-slide-frame';
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.srcdoc = normalizeSlideDocument(slide.html);
    frame.addEventListener('load', () => {
      bindHtmlSlideEditing(frame, slide.id, handlers);
      fitHtmlSlideFrame(frame);
    });
    canvas.append(frame);
    applySlideCanvasBackground(canvas, slide);
    canvas.classList.remove('is-entering');
    void canvas.offsetWidth;
    canvas.classList.add('is-entering');
    fitSlideCanvas();
    return;
  }
  canvas.classList.remove('is-html-slide');
  canvas.innerHTML = slide ? slideHtml(slide, { selectedElementId: state.selectedElementId, editable: true }) : '';
  canvas.querySelectorAll('.slide-element').forEach((node) => {
    const elementId = node.dataset.elementId;
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.selectElement(elementId);
    });
    node.addEventListener('pointerdown', (event) => {
      if (event.target?.isContentEditable && !event.target.classList.contains('resize-handle')) return;
      handlers.beginDrag(event, elementId);
    });
  });
  canvas.querySelectorAll('[data-edit-text]').forEach((node) => {
    node.addEventListener('blur', () => {
      handlers.updateElementTextDirect(node.dataset.editText, node.textContent || '');
    });
    node.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') node.blur();
    });
  });
  canvas.querySelectorAll('[data-edit-list]').forEach((node) => {
    node.addEventListener('blur', () => {
      handlers.updateElementListItemDirect(node.dataset.editList, Number(node.dataset.itemIndex), node.textContent || '');
    });
    node.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') node.blur();
    });
  });
  canvas.classList.remove('is-entering');
  void canvas.offsetWidth;
  canvas.classList.add('is-entering');
  /* Position floating toolbar on selected element */
  const selectedEl = getSelectedElement(state);
  if (selectedEl) {
    positionFloatingToolbar(selectedEl);
  } else {
    const toolbar = byId('floatingToolbar');
    if (toolbar) toolbar.classList.remove('is-visible');
  }
  applySlideCanvasBackground(canvas, slide);
  fitSlideCanvas();
}

export function renderInspector(state, handlers) {
  const panel = byId('elementInspector');
  const element = getSelectedElement(state);
  const slide = getActiveSlide(state);
  if (!panel || !slide) return;
  if (panel.hidden) {
    panel.innerHTML = '';
    return;
  }
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
    ${slideQualityFields(slide)}
  `;
}

function slideQualityFields(slide) {
  const issues = Array.isArray(slide.quality?.issues) ? slide.quality.issues : [];
  if (!issues.length) return '';
  return `
    <div class="method-fields quality-fields">
      <strong>${escapeHtml(t('qualityReportTitle'))}: ${Math.round(Number(slide.quality?.score ?? 100))}/100</strong>
      <ul>${issues.map((issue) => `<li data-severity="${escapeHtml(issue.severity)}">${escapeHtml(issue.message)}</li>`).join('')}</ul>
    </div>
  `;
}

function bindSlideFields(panel, handlers) {
  ['slideKickerInput', 'slideClaimInput', 'slideProofInput', 'slideSupportInput', 'slideSourceInput'].forEach((id) => {
    panel.querySelector(`#${id}`)?.addEventListener('input', () => handlers.updateSlideMethodology());
  });
}

export function slideHtml(slide, options = {}) {
  if (slide?.html) {
    return `<iframe class="html-slide-frame" sandbox="allow-same-origin" srcdoc="${escapeHtml(normalizeSlideDocument(slide.html))}"></iframe>`;
  }
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
    ${slideQualityBadge(slide)}
    ${(slide.elements || []).map((element) => elementHtml(element, slide.theme, editable, selectedId)).join('')}
    ${slide.sourceNote ? `<div class="slide-source-note">${escapeHtml(slide.sourceNote)}</div>` : ''}
  </div>`;
}

function slideQualityBadge(slide) {
  const issues = Array.isArray(slide.quality?.issues) ? slide.quality.issues : [];
  if (!issues.length) return '';
  const highCount = issues.filter((issue) => issue.severity === 'high').length;
  const label = highCount ? t('qualityNeedsReview') : t('qualityHasWarnings');
  return `<div class="slide-quality-badge" data-severity="${highCount ? 'high' : 'medium'}">${escapeHtml(label)}</div>`;
}

function bindWelcomeTips(canvas) {
  canvas.querySelectorAll('[data-welcome-prompt]').forEach((node) => {
    node.addEventListener('click', () => {
      const input = byId('topicInput');
      if (!input) return;
      input.value = node.dataset.welcomePrompt || node.textContent || '';
      input.focus();
    });
  });
}

function bindHtmlSlideEditing(frame, slideId, handlers) {
  if (!handlers?.updateSlideHtmlDirect) return;
  let doc = null;
  try {
    doc = frame.contentDocument;
  } catch {
    return;
  }
  if (!doc?.documentElement) return;
  const editableNodes = doc.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,span,strong,em,blockquote,td,th');
  editableNodes.forEach((node) => {
    if (!String(node.textContent || '').trim()) return;
    node.setAttribute('contenteditable', 'true');
    node.setAttribute('spellcheck', 'false');
    node.addEventListener('blur', () => {
      handlers.updateSlideHtmlDirect(slideId, serializeFrameDocument(doc));
    });
    node.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') node.blur();
    });
  });
}

function serializeFrameDocument(doc) {
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}

export function normalizeSlideDocument(html) {
  const source = String(html || '').trim();
  if (!source) return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body></body></html>';
  if (/<!doctype|<html[\s>]/i.test(source)) return source;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${source}</body></html>`;
}

function elementHtml(element, theme, editable, selectedId) {
  const selected = editable && selectedId === element.id;
  const style = [
    `left:${element.x}%`,
    `top:${element.y}%`,
    `width:${element.w}%`,
    `height:${element.h}%`,
    `font-size:${fontSizeCss(element.style.fontSize)}`,
    `font-weight:${element.style.fontWeight}`,
    `color:${resolveColor(element.style.color, theme)}`,
    `text-align:${element.style.align || 'left'}`,
    `background:${resolveColor(element.style.background, theme)}`,
    `opacity:${element.style.opacity}`,
    `border-radius:${element.style.borderRadius}px`,
  ].join(';');
  let content = '';
  if (element.type === 'list') {
    content = `<ul>${(element.items || []).map((item, index) => editable
      ? `<li data-edit-list="${escapeHtml(element.id)}" data-item-index="${index}" contenteditable="true" spellcheck="false">${escapeHtml(item)}</li>`
      : `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  } else if (element.type === 'metric') {
    content = `<strong>${escapeHtml(element.text)}</strong><span>${escapeHtml(element.label)}</span>`;
  } else if (element.type === 'chart') {
    const max = Math.max(1, ...(element.data || []).map((point) => Number(point.value) || 0));
    content = `<b>${escapeHtml(element.text)}</b><div class="chart-bars">${(element.data || []).map((point) => `<span><i style="height:${Math.max(8, (Number(point.value) || 0) / max * 100)}%"></i><em>${escapeHtml(point.label)}</em></span>`).join('')}</div>`;
  } else if (element.type === 'media') {
    content = `<span>${escapeHtml(element.text || t('mediaPlaceholder'))}</span>`;
  } else {
    content = editable
      ? `<span class="editable-text" data-edit-text="${escapeHtml(element.id)}" contenteditable="true" spellcheck="false">${escapeHtml(element.text || '')}</span>`
      : escapeHtml(element.text || '');
  }
  return `<div class="slide-element element-${element.type}${selected ? ' is-selected' : ''}" data-element-id="${escapeHtml(element.id)}" data-editable="${editable ? 'true' : 'false'}" style="${style}">${content}${selected ? '<i class="resize-handle"></i>' : ''}</div>`;
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

function fontSizeCss(value) {
  const size = Math.max(8, Number(value) || 24);
  const cqw = Math.round((size / 10.2) * 1000) / 1000;
  return `clamp(8px, ${cqw}cqw, ${size}px)`;
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
