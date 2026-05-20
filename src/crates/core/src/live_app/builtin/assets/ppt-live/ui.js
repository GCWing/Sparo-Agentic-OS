import { translate as t } from './src/i18n.js';
import {
  ELEMENT_TYPES,
  LEGACY_STORAGE_KEY,
  OLD_LEGACY_STORAGE_KEY,
  OLDEST_LEGACY_STORAGE_KEY,
  STORAGE_KEY,
  clamp,
  clone,
  createInitialState,
  defaultOutline,
  defaultElement,
  ensureState,
  getActiveIndex,
  getActiveSlide,
  getSelectedElement,
  makeSlide,
  migrateLegacy,
  normalizeElement,
  normalizeSlide,
} from './src/state.js';
import {
  applyDeckInstructionWithAi,
  applySlideInstructionWithAi,
  enrichSources,
  generateDeckWithAi,
  generateOutlineWithAi,
  insertSlideWithAi,
  localDeck,
  localDeckUpdate,
  localInsertedSlide,
  localOutline,
  localSlideUpdate,
} from './src/deck-ai.js';
import { applyI18n, readInputs, renderAll, renderInspector, renderSlideCanvas, renderGeneration, renderThumbs, slideHtml } from './src/render.js';
import { downloadBase64File, downloadHtmlDeck, fileSafe } from './src/export-html.js';

let state = createInitialState();
let busy = false;
let dragState = null;

const $ = (id) => document.getElementById(id);
const runtime = () => window.app || {};

function storage() {
  const host = runtime();
  if (host.storage) return host.storage;
  return {
    get: async (key) => JSON.parse(localStorage.getItem(key) || 'null'),
    set: async (key, value) => localStorage.setItem(key, JSON.stringify(value)),
  };
}

async function loadState() {
  try {
    const saved = await storage().get(STORAGE_KEY);
    if (saved) {
      state = ensureState(saved);
      return;
    }
    const legacy = await storage().get(LEGACY_STORAGE_KEY);
    const oldLegacy = legacy || await storage().get(OLD_LEGACY_STORAGE_KEY) || await storage().get(OLDEST_LEGACY_STORAGE_KEY);
    state = migrateLegacy(oldLegacy) || createInitialState();
    await persist(true);
  } catch (error) {
    runtime().log?.warn?.('Failed to load PPT Live state', { error: String(error) });
    state = createInitialState();
  }
}

async function persist(silent = false) {
  state = ensureState(state);
  await storage().set(STORAGE_KEY, { ...state, updatedAt: Date.now() });
  if (!silent) setStatus(t('saved'));
}

function setStatus(message) {
  const node = $('statusLine');
  if (node) node.textContent = message;
}

function setExportStatus(message) {
  const node = $('exportStatus');
  if (node) node.textContent = message;
}

function setBusy(nextBusy, message) {
  busy = nextBusy;
  document.querySelector('.ppt-live')?.classList.toggle('is-busy', busy);
  document.querySelectorAll('button, input, select, textarea').forEach((node) => {
    if (['closePreview', 'prevPresent', 'nextPresent'].includes(node.id)) return;
    node.disabled = busy;
  });
  const pill = $('aiStatusPill');
  if (pill) {
    pill.textContent = busy ? 'AI' : 'Ready';
    pill.classList.toggle('is-busy', busy);
  }
  if (message) setStatus(message);
}

function setGenerationStep(id, status, message) {
  state.generation.current = id;
  state.generation.steps = state.generation.steps.map((step) => ({
    ...step,
    status: step.id === id ? status : step.status,
  }));
  state.generation.active = status === 'running' || state.generation.steps.some((step) => step.status === 'running');
  renderGeneration(state);
  if (message) setStatus(message);
}

function resetGeneration() {
  state.generation.active = false;
  state.generation.current = 'idle';
  state.generation.steps = state.generation.steps.map((step) => ({ ...step, status: 'pending' }));
  renderGeneration(state);
}

async function waitFrame() {
  await new Promise((resolve) => setTimeout(resolve, 120));
}

function rerender() {
  state = ensureState(state);
  renderAll(state, handlers);
}

function updateBriefFromInputs() {
  readInputs(state);
  state = ensureState(state);
}

function promptValue() {
  return $('topicInput')?.value.trim() || '';
}

function isDefaultDraft() {
  const defaultSpine = defaultOutline().join('\n');
  return !state.outline.length
    || state.outline.join('\n') === defaultSpine
    || state.title === t('defaultDeckTitle');
}

function promptIntent() {
  const prompt = promptValue();
  if (!prompt) return 'empty';
  if (/删除|移除|删掉|delete|remove/i.test(prompt)) return 'delete';
  if (/插入|新增|加一页|添加.*页|insert|add (a )?(slide|page)/i.test(prompt)) return 'insert';
  if (/大纲|outline/i.test(prompt) && !/生成整套|生成页面|generate deck|slides?/i.test(prompt)) return 'outline';
  if (isDefaultDraft() || /生成|制作|做一份|创建|create|build|make|generate/i.test(prompt)) return 'generate';
  if (/整套|全部|全局|整体|whole|entire|all slides|deck/i.test(prompt)) return 'deck';
  return 'slide';
}

async function generateOutline() {
  updateBriefFromInputs();
  setBusy(true, t('working'));
  resetGeneration();
  try {
    setGenerationStep('brief', 'running', t('generationReadingBrief'));
    await waitFrame();
    await enrichSources(state);
    await waitFrame();
    const result = await generateOutlineWithAi(state);
    setGenerationStep('brief', 'done');
    setGenerationStep('spine', 'done', t('generationSpineReady'));
    state.title = result.title;
    state.outline = result.outline;
    setStatus(t('outlineReady'));
  } catch (error) {
    runtime().log?.warn?.('PPT Live outline AI failed', { error: String(error) });
    setGenerationStep('brief', 'done');
    setGenerationStep('spine', 'error', t('generationLocalSpine'));
    state.outline = localOutline(state);
    state.title = state.outline[0] || state.title;
    setStatus(t('aiUnavailable'));
  } finally {
    setBusy(false);
    state.generation.active = false;
    rerender();
    await persist(true);
  }
}

async function generateDeck() {
  updateBriefFromInputs();
  if (!state.outline.length) state.outline = localOutline(state);
  setBusy(true, t('working'));
  resetGeneration();
  try {
    setGenerationStep('brief', 'running', t('generationReadingBrief'));
    await waitFrame();
    await enrichSources(state);
    await waitFrame();
    setGenerationStep('brief', 'done');
    setGenerationStep('spine', 'running', t('generationWritingClaims'));
    await waitFrame();
    setGenerationStep('spine', 'done');
    setGenerationStep('proof', 'running', t('generationChoosingProof'));
    await waitFrame();
    const result = await generateDeckWithAi(state);
    setGenerationStep('proof', 'done');
    setGenerationStep('design', 'running', t('generationDesigningLayouts'));
    await waitFrame();
    state.title = result.title;
    state.slides = result.slides;
    setGenerationStep('design', 'done');
    setGenerationStep('compile', 'done', t('generationCompiled'));
    setGenerationStep('qa', 'done', t('generationQaDone'));
    setStatus(t('deckReady'));
  } catch (error) {
    runtime().log?.warn?.('PPT Live deck AI failed', { error: String(error) });
    setGenerationStep('proof', 'done');
    setGenerationStep('design', 'running', t('generationLocalCompiler'));
    await waitFrame();
    state = localDeck(state);
    setGenerationStep('design', 'done');
    setGenerationStep('compile', 'done');
    setGenerationStep('qa', String(error).includes('grounded') ? 'error' : 'done');
    setStatus(String(error).includes('grounded') ? t('sourceGroundingRequired') : t('aiUnavailable'));
  } finally {
    state.activeSlideId = state.slides[0]?.id || '';
    state.selectedElementId = state.slides[0]?.elements[0]?.id || '';
    state.outline = state.slides.map((slide) => slide.title);
    setBusy(false);
    state.generation.active = false;
    rerender();
    await persist(true);
  }
}

async function generateDeckFromPrompt() {
  if (isDefaultDraft()) await generateOutline();
  await generateDeck();
}

async function handlePromptSubmit() {
  switch (promptIntent()) {
    case 'empty':
      setStatus(t('promptRequired'));
      return;
    case 'delete':
      deleteSlide();
      return;
    case 'insert':
      await insertSlideFromPrompt();
      return;
    case 'outline':
      await generateOutline();
      return;
    case 'generate':
      await generateDeckFromPrompt();
      return;
    case 'deck':
      await reviseDeck();
      return;
    case 'slide':
    default:
      await reviseCurrentSlide();
  }
}

async function applyAiAction(action, options = {}) {
  if (options.readBrief !== false) updateBriefFromInputs();
  const instruction = promptValue();
  setBusy(true, t('working'));
  try {
    const nextSlide = await applySlideInstructionWithAi(state, action, instruction);
    replaceActiveSlide(nextSlide);
  } catch (error) {
    runtime().log?.warn?.('PPT Live slide AI failed', { action, error: String(error) });
    replaceActiveSlide(localSlideUpdate(state, action, instruction));
  } finally {
    setBusy(false);
    setStatus(t('slideUpdated'));
    rerender();
    await persist(true);
  }
}

async function reviseCurrentSlide() {
  await applyAiAction('redesign', { readBrief: false });
}

async function reviseDeck() {
  const instruction = promptValue();
  setBusy(true, t('working'));
  try {
    const result = await applyDeckInstructionWithAi(state, instruction);
    state.title = result.title || state.title;
    state.slides = result.slides;
  } catch (error) {
    runtime().log?.warn?.('PPT Live deck revision AI failed', { error: String(error) });
    const fallback = localDeckUpdate(state, instruction);
    state.title = fallback.title || state.title;
    state.slides = fallback.slides;
  } finally {
    state.outline = state.slides.map((slide) => slide.title);
    state.activeSlideId = state.slides[0]?.id || '';
    state.selectedElementId = state.slides[0]?.elements[0]?.id || '';
    setBusy(false);
    setStatus(t('deckUpdated'));
    rerender();
    await persist(true);
  }
}

async function insertSlideFromPrompt() {
  const instruction = promptValue();
  setBusy(true, t('working'));
  try {
    const index = Math.min(state.slides.length, getActiveIndex(state) + 1);
    const slide = await insertSlideWithAi(state, instruction);
    state.slides.splice(index, 0, normalizeSlide(slide, index, { ...state, slides: [...state.slides, slide] }));
    state.activeSlideId = state.slides[index].id;
  } catch (error) {
    runtime().log?.warn?.('PPT Live insert slide AI failed', { error: String(error) });
    const index = Math.min(state.slides.length, getActiveIndex(state) + 1);
    const slide = localInsertedSlide(state, instruction);
    state.slides.splice(index, 0, normalizeSlide(slide, index, { ...state, slides: [...state.slides, slide] }));
    state.activeSlideId = state.slides[index].id;
  } finally {
    state.brief.slideTarget = state.slides.length;
    state.outline = state.slides.map((slide) => slide.title);
    state.selectedElementId = getActiveSlide(state)?.elements[0]?.id || '';
    setBusy(false);
    setStatus(t('slideInserted'));
    rerender();
    await persist(true);
  }
}

function replaceActiveSlide(nextSlide) {
  if (!nextSlide) return;
  const index = getActiveIndex(state);
  state.slides[index] = normalizeSlide(nextSlide, index, state);
  state.outline[index] = state.slides[index].title;
  state.selectedElementId = state.slides[index].elements[0]?.id || '';
}

function restyleDeck() {
  updateBriefFromInputs();
  state.slides = state.slides.map((slide, index) => normalizeSlide({ ...slide, theme: undefined }, index, state));
  setStatus(t('deckRestyled'));
  rerender();
  void persist(true);
}

function syncSlidesFromOutline() {
  updateBriefFromInputs();
  const previous = new Map(state.slides.map((slide) => [slide.title, slide]));
  state.slides = state.outline.map((title, index) => {
    const existing = previous.get(title);
    return existing ? normalizeSlide(existing, index, state) : makeSlide(title, index, state.outline.length, state);
  });
  state.activeSlideId = state.slides[0]?.id || '';
  state.selectedElementId = state.slides[0]?.elements[0]?.id || '';
  rerender();
  void persist(true);
}

function newDeck() {
  state = createInitialState();
  rerender();
  setStatus(t('ready'));
  void persist(true);
}

function addSlide() {
  const index = getActiveIndex(state) + 1;
  const slide = makeSlide(t('newSlideTitle'), index, state.slides.length + 1, state);
  state.slides.splice(index, 0, slide);
  state.outline = state.slides.map((item) => item.title);
  state.activeSlideId = slide.id;
  state.selectedElementId = slide.elements[0]?.id || '';
  rerender();
  void persist(true);
}

function deleteSlide() {
  if (state.slides.length <= 1) {
    setStatus(t('cannotDelete'));
    return;
  }
  const index = getActiveIndex(state);
  state.slides.splice(index, 1);
  state.outline = state.slides.map((item) => item.title);
  state.activeSlideId = state.slides[Math.max(0, index - 1)]?.id || state.slides[0]?.id || '';
  state.selectedElementId = getActiveSlide(state)?.elements[0]?.id || '';
  rerender();
  void persist(true);
}

function addElement(type) {
  if (!ELEMENT_TYPES.includes(type)) return;
  const slide = getActiveSlide(state);
  if (!slide) return;
  const element = normalizeElement({
    ...defaultElement(type),
    x: 10 + (slide.elements.length % 5) * 4,
    y: 14 + (slide.elements.length % 5) * 4,
  });
  slide.elements.push(element);
  state.selectedElementId = element.id;
  rerender();
  void persist(true);
}

function deleteElement() {
  const slide = getActiveSlide(state);
  if (!slide || !state.selectedElementId) return;
  slide.elements = slide.elements.filter((element) => element.id !== state.selectedElementId);
  state.selectedElementId = slide.elements[0]?.id || '';
  rerender();
  void persist(true);
}

function updateSlideTitleFromElements(slide) {
  const titleElement = slide.elements.find((element) => element.type === 'text' && element.text);
  if (!titleElement) return;
  slide.title = titleElement.text.slice(0, 90);
  state.outline[getActiveIndex(state)] = slide.title;
  if (getActiveIndex(state) === 0) state.title = slide.title;
}

function openPreview() {
  state.presentIndex = getActiveIndex(state);
  renderPresent();
  $('previewDialog')?.showModal();
}

function renderPresent() {
  const slide = state.slides[state.presentIndex] || state.slides[0];
  if ($('presentSlide')) $('presentSlide').innerHTML = slide ? slideHtml(slide) : '';
  if ($('presentCounter')) $('presentCounter').textContent = `${state.presentIndex + 1} / ${state.slides.length}`;
}

function movePresent(delta) {
  state.presentIndex = clamp(state.presentIndex + delta, 0, state.slides.length - 1);
  renderPresent();
}

function exportHtml() {
  downloadHtmlDeck(state);
  setExportStatus(t('exportHtmlDone'));
}

async function exportPptx() {
  updateBriefFromInputs();
  setBusy(true, t('exportPptxWorking'));
  try {
    const result = await runtime().call('exportPptx', { deck: clone(state) });
    if (!result?.base64) throw new Error('PPTX worker returned no data');
    downloadBase64File(
      result.base64,
      result.filename || `${fileSafe(state.title || 'ppt-live')}.pptx`,
      result.mimeType || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    setExportStatus(t('exportPptxDone'));
  } catch (error) {
    runtime().log?.error?.('PPT Live PPTX export failed', { error: String(error) });
    setExportStatus(`${t('exportPptxFailed')} ${t('installDepsHint')}`);
  } finally {
    setBusy(false);
  }
}

const handlers = {
  updateOutline(index, value) {
    state.outline[index] = value;
    if (state.slides[index]) state.slides[index].title = value;
    rerender();
    void persist(true);
  },
  moveOutline(index, delta) {
    const next = index + delta;
    if (next < 0 || next >= state.outline.length) return;
    [state.outline[index], state.outline[next]] = [state.outline[next], state.outline[index]];
    syncSlidesFromOutline();
  },
  removeOutline(index) {
    if (state.outline.length <= 1) return;
    state.outline.splice(index, 1);
    syncSlidesFromOutline();
  },
  selectSlide(id) {
    state.activeSlideId = id;
    state.selectedElementId = getActiveSlide(state)?.elements[0]?.id || '';
    rerender();
    void persist(true);
  },
  selectElement(id) {
    state.selectedElementId = id;
    renderSlideCanvas(state, handlers);
    renderInspector(state, handlers);
    void persist(true);
  },
  updateSlideNotes(value) {
    const slide = getActiveSlide(state);
    if (slide) slide.notes = value;
    void persist(true);
  },
  updateSlideMethodology() {
    const slide = getActiveSlide(state);
    if (!slide) return;
    slide.kicker = $('slideKickerInput')?.value || slide.kicker;
    slide.claim = $('slideClaimInput')?.value || slide.claim;
    slide.proofObject = $('slideProofInput')?.value || slide.proofObject;
    slide.supportNote = $('slideSupportInput')?.value || slide.supportNote;
    slide.sourceNote = $('slideSourceInput')?.value || slide.sourceNote;
    renderSlideCanvas(state, handlers);
    renderThumbs(state, handlers);
    void persist(true);
  },
  updateElementFromInspector() {
    const slide = getActiveSlide(state);
    const element = getSelectedElement(state);
    if (!slide || !element) return;
    element.text = $('elementTextInput')?.value || '';
    element.items = ($('elementItemsInput')?.value || '').split('\n').map((item) => item.trim()).filter(Boolean);
    element.data = parseChartData($('elementDataInput')?.value || '');
    element.x = clamp(Number($('elementXInput')?.value ?? element.x), 0, 100);
    element.y = clamp(Number($('elementYInput')?.value ?? element.y), 0, 100);
    element.w = clamp(Number($('elementWInput')?.value ?? element.w), 3, 100);
    element.h = clamp(Number($('elementHInput')?.value ?? element.h), 3, 100);
    element.style.fontSize = clamp(Number($('elementFontInput')?.value ?? element.style.fontSize), 8, 88);
    element.style.fontWeight = clamp(Number($('elementWeightInput')?.value ?? element.style.fontWeight), 100, 900);
    element.style.color = $('elementColorInput')?.value || element.style.color;
    element.style.background = $('elementBgInput')?.value || element.style.background;
    handlers.updateSlideMethodology();
    slide.notes = $('slideNotesInput')?.value || slide.notes;
    updateSlideTitleFromElements(slide);
    renderSlideCanvas(state, handlers);
    void persist(true);
  },
  beginDrag(event, elementId) {
    if (event.button !== 0) return;
    const slide = getActiveSlide(state);
    const element = slide?.elements.find((item) => item.id === elementId);
    if (!element) return;
    state.selectedElementId = element.id;
    const rect = $('slideCanvas').getBoundingClientRect();
    dragState = {
      resizing: event.target.classList.contains('resize-handle'),
      startX: event.clientX,
      startY: event.clientY,
      rect,
      start: { x: element.x, y: element.y, w: element.w, h: element.h },
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', dragMove);
    window.addEventListener('pointerup', endDrag, { once: true });
  },
};

function dragMove(event) {
  if (!dragState) return;
  const element = getSelectedElement(state);
  if (!element) return;
  const dx = ((event.clientX - dragState.startX) / dragState.rect.width) * 100;
  const dy = ((event.clientY - dragState.startY) / dragState.rect.height) * 100;
  if (dragState.resizing) {
    element.w = clamp(dragState.start.w + dx, 3, 100 - element.x);
    element.h = clamp(dragState.start.h + dy, 3, 100 - element.y);
  } else {
    element.x = clamp(dragState.start.x + dx, 0, 100 - element.w);
    element.y = clamp(dragState.start.y + dy, 0, 100 - element.h);
  }
  renderSlideCanvas(state, handlers);
  renderInspector(state, handlers);
}

function endDrag() {
  dragState = null;
  window.removeEventListener('pointermove', dragMove);
  void persist(true);
}

function parseChartData(raw) {
  return raw
    .split('\n')
    .map((line, index) => {
      const [label, value] = line.split(':');
      return { label: (label || `Item ${index + 1}`).trim(), value: Number(value || 0) };
    })
    .filter((point) => point.label);
}

function bindEvents() {
  ['topicInput', 'audienceInput', 'materialInput', 'slideTargetInput', 'deckTypeInput', 'toneInput', 'themeInput', 'densityInput', 'brandPrimaryInput', 'brandAccentInput', 'imagePolicyInput'].forEach((id) => {
    $(id)?.addEventListener('input', () => {
      updateBriefFromInputs();
      if (['themeInput', 'densityInput', 'brandPrimaryInput', 'brandAccentInput'].includes(id)) restyleDeck();
      else void persist(true);
    });
  });
  $('newDeck')?.addEventListener('click', newDeck);
  $('sendPrompt')?.addEventListener('click', () => void handlePromptSubmit());
  $('generateOutline')?.addEventListener('click', () => void generateOutline());
  $('generateDeck')?.addEventListener('click', () => void generateDeckFromPrompt());
  $('addOutlineItem')?.addEventListener('click', () => {
    state.outline.push(t('newSlideTitle'));
    rerender();
    void persist(true);
  });
  $('syncSlidesFromOutline')?.addEventListener('click', syncSlidesFromOutline);
  $('addSlide')?.addEventListener('click', addSlide);
  $('deleteSlide')?.addEventListener('click', deleteSlide);
  $('deleteElement')?.addEventListener('click', deleteElement);
  $('previewDeck')?.addEventListener('click', openPreview);
  $('closePreview')?.addEventListener('click', () => $('previewDialog')?.close());
  $('prevPresent')?.addEventListener('click', () => movePresent(-1));
  $('nextPresent')?.addEventListener('click', () => movePresent(1));
  $('exportHtml')?.addEventListener('click', exportHtml);
  $('exportPptx')?.addEventListener('click', () => void exportPptx());
  $('restyleDeck')?.addEventListener('click', restyleDeck);
  $('reviseSlide')?.addEventListener('click', () => void reviseCurrentSlide());
  $('reviseDeck')?.addEventListener('click', () => void reviseDeck());
  $('insertSlide')?.addEventListener('click', () => void insertSlideFromPrompt());
  document.querySelectorAll('[data-add-element]').forEach((button) => {
    button.addEventListener('click', () => addElement(button.dataset.addElement));
  });
  document.querySelectorAll('.ai-action').forEach((button) => {
    button.addEventListener('click', () => void applyAiAction(button.dataset.action));
  });
  document.querySelectorAll('.segment').forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      if (state.mode === 'present') openPreview();
      rerender();
      void persist(true);
    });
  });
  document.addEventListener('keydown', (event) => {
    if (!$('previewDialog')?.open) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') movePresent(1);
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') movePresent(-1);
    if (event.key === 'Escape') $('previewDialog')?.close();
  });
}

async function init() {
  applyI18n();
  await loadState();
  bindEvents();
  rerender();
  runtime().onLocaleChange?.(() => {
    applyI18n();
    rerender();
  });
}

init();
