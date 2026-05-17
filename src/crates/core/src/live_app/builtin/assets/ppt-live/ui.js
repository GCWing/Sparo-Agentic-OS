const STRINGS = {
  'en-US': {
    eyebrow: 'AI PPT Studio',
    title: 'PPT Live',
    newDeck: 'New',
    preview: 'Preview',
    copyHtml: 'Copy HTML',
    downloadHtml: 'Download HTML',
    generateTitle: 'Generate PPT',
    chatTitle: 'AI Chat',
    chatInputLabel: 'Message',
    chatPlaceholder: 'Describe the PPT you want, paste source material, or ask AI to modify the current slide.',
    sendChat: 'Send to AI',
    editModalTitle: 'Edit element',
    cancel: 'Cancel',
    save: 'Save',
    topicLabel: 'Topic',
    topicPlaceholder: 'Describe the presentation goal, topic, and key message.',
    audienceLabel: 'Audience',
    audiencePlaceholder: 'Executives, customers, students...',
    scenarioLabel: 'Scenario',
    scenarioBusiness: 'Business report',
    scenarioSales: 'Sales pitch',
    scenarioProduct: 'Product intro',
    scenarioTeaching: 'Teaching',
    scenarioFundraising: 'Fundraising',
    slidesLabel: 'Slides',
    toneLabel: 'Tone',
    toneProfessional: 'Professional',
    toneConcise: 'Concise',
    tonePersuasive: 'Persuasive',
    toneEducational: 'Educational',
    materialLabel: 'Source material',
    materialPlaceholder: 'Paste notes, docs, data points, or rough requirements.',
    generateOutline: 'Generate outline',
    generateDeck: 'Generate designed deck',
    ready: 'Ready.',
    outlineTitle: 'Outline',
    modeEdit: 'Edit',
    modeSort: 'Sort',
    modePresent: 'Present',
    inspectorTitle: 'Element inspector',
    noSelection: 'No element selected',
    elementTypeLabel: 'Type',
    elementTextLabel: 'Content',
    elementItemsLabel: 'List items',
    geometryLabel: 'Position and size',
    styleLabel: 'Element style',
    speakerNotesLabel: 'Speaker notes',
    addText: 'Text',
    addList: 'List',
    addShape: 'Shape',
    addMetric: 'Metric',
    deleteElement: 'Delete element',
    addSlide: 'Add slide',
    deleteSlide: 'Delete slide',
    aiTitle: 'AI design',
    aiRedesignSlide: 'Redesign slide',
    aiRestyleDeck: 'Restyle deck',
    aiTighter: 'Make tighter',
    aiMoreVisual: 'More visual',
    customPromptLabel: 'Custom instruction',
    customPromptPlaceholder: 'Example: create a consulting-style layout with fewer words.',
    runAi: 'Apply to slide',
    themeTitle: 'Deck style',
    prev: 'Previous',
    next: 'Next',
    working: 'Working with AI...',
    aiUnavailable: 'AI is unavailable, generated a local designed draft instead.',
    outlineReady: 'Outline ready.',
    deckReady: 'Designed deck generated.',
    saved: 'Saved.',
    copied: 'HTML copied.',
    copyFailed: 'Copy failed. Download is still available.',
    slideUpdated: 'Slide updated.',
    cannotDelete: 'Keep at least one slide.',
    newSlideTitle: 'New slide',
    defaultDeckTitle: 'AI Agent Product Strategy',
    slidesMeta: 'slides'
  },
  'zh-CN': {
    eyebrow: 'AI PPT Studio',
    title: 'PPT Live',
    newDeck: 'New',
    preview: 'Preview',
    copyHtml: 'Copy HTML',
    downloadHtml: 'Download HTML',
    generateTitle: 'Generate PPT',
    chatTitle: 'AI Chat',
    chatInputLabel: 'Message',
    chatPlaceholder: 'Describe the PPT you want, paste source material, or ask AI to modify the current slide.',
    sendChat: 'Send to AI',
    editModalTitle: 'Edit element',
    cancel: 'Cancel',
    save: 'Save',
    topicLabel: 'Topic',
    topicPlaceholder: 'Describe the presentation goal, topic, and key message.',
    audienceLabel: 'Audience',
    audiencePlaceholder: 'Executives, customers, students...',
    scenarioLabel: 'Scenario',
    scenarioBusiness: 'Business report',
    scenarioSales: 'Sales pitch',
    scenarioProduct: 'Product intro',
    scenarioTeaching: 'Teaching',
    scenarioFundraising: 'Fundraising',
    slidesLabel: 'Slides',
    toneLabel: 'Tone',
    toneProfessional: 'Professional',
    toneConcise: 'Concise',
    tonePersuasive: 'Persuasive',
    toneEducational: 'Educational',
    materialLabel: 'Source material',
    materialPlaceholder: 'Paste notes, docs, data points, or rough requirements.',
    generateOutline: 'Generate outline',
    generateDeck: 'Generate designed deck',
    ready: 'Ready.',
    outlineTitle: 'Outline',
    modeEdit: 'Edit',
    modeSort: 'Sort',
    modePresent: 'Present',
    inspectorTitle: 'Element inspector',
    noSelection: 'No element selected',
    elementTypeLabel: 'Type',
    elementTextLabel: 'Content',
    elementItemsLabel: 'List items',
    geometryLabel: 'Position and size',
    styleLabel: 'Element style',
    speakerNotesLabel: 'Speaker notes',
    addText: 'Text',
    addList: 'List',
    addShape: 'Shape',
    addMetric: 'Metric',
    deleteElement: 'Delete element',
    addSlide: 'Add slide',
    deleteSlide: 'Delete slide',
    aiTitle: 'AI design',
    aiRedesignSlide: 'Redesign slide',
    aiRestyleDeck: 'Restyle deck',
    aiTighter: 'Make tighter',
    aiMoreVisual: 'More visual',
    customPromptLabel: 'Custom instruction',
    customPromptPlaceholder: 'Example: create a consulting-style layout with fewer words.',
    runAi: 'Apply to slide',
    themeTitle: 'Deck style',
    prev: 'Previous',
    next: 'Next',
    working: 'Working with AI...',
    aiUnavailable: 'AI is unavailable, generated a local designed draft instead.',
    outlineReady: 'Outline ready.',
    deckReady: 'Designed deck generated.',
    saved: 'Saved.',
    copied: 'HTML copied.',
    copyFailed: 'Copy failed. Download is still available.',
    slideUpdated: 'Slide updated.',
    cannotDelete: 'Keep at least one slide.',
    newSlideTitle: 'New slide',
    defaultDeckTitle: 'AI Agent Product Strategy',
    slidesMeta: 'slides'
  }
};

const STORAGE_KEY = 'pptLiveStateV2';
const ELEMENT_TYPES = ['text', 'list', 'shape', 'metric'];
const THEMES = {
  executive: { background: '#fbfcff', ink: '#111827', muted: '#5b6575', accent: '#2357d8', accent2: '#0d9488' },
  fresh: { background: '#fbfdf9', ink: '#10201f', muted: '#60716d', accent: '#0d9488', accent2: '#ca8a04' },
  studio: { background: '#fcfbff', ink: '#1f1630', muted: '#6c607a', accent: '#7c3aed', accent2: '#db2777' }
};

let state = {
  title: '',
  topic: '',
  audience: '',
  scenario: 'business',
  tone: 'professional',
  slideTarget: 8,
  material: '',
  outline: [],
  slides: [],
  chatMessages: [],
  activeSlideId: '',
  selectedElementId: '',
  theme: 'executive',
  mode: 'edit',
  presentIndex: 0
};

let dragState = null;

const $ = (id) => document.getElementById(id);
const runtime = () => window.app || {};
const locale = () => runtime().locale || 'en-US';
const t = (key) => (STRINGS[locale()] || STRINGS['en-US'])[key] || STRINGS['en-US'][key] || key;
const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function storage() {
  const host = runtime();
  if (host.storage) return host.storage;
  return {
    get: async (key) => JSON.parse(localStorage.getItem(key) || 'null'),
    set: async (key, value) => localStorage.setItem(key, JSON.stringify(value))
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });
}

function setStatus(message) {
  $('statusLine').textContent = message;
}

function setBusy(busy) {
  document.querySelectorAll('button, input, select, textarea').forEach((node) => {
    if (['closePreview', 'prevPresent', 'nextPresent'].includes(node.id)) return;
    node.disabled = busy;
  });
}

function defaultOutline() {
  return [
    t('defaultDeckTitle'),
    'Why now',
    'Current pain points',
    'Solution overview',
    'Core workflow',
    'Value proof',
    'Rollout plan',
    'Next steps'
  ];
}

function themeFor(slide) {
  return {
    ...THEMES[state.theme],
    ...(slide?.style || {})
  };
}

function createElement(type, overrides = {}) {
  const defaults = {
    text: {
      text: 'Key message',
      x: 9,
      y: 12,
      w: 58,
      h: 18,
      style: { fontSize: 40, fontWeight: 760, color: 'ink', align: 'left' }
    },
    list: {
      items: ['First point', 'Second point', 'Third point'],
      x: 10,
      y: 42,
      w: 48,
      h: 34,
      style: { fontSize: 20, color: 'ink', background: 'transparent', borderRadius: 8 }
    },
    shape: {
      text: '',
      x: 66,
      y: 14,
      w: 22,
      h: 62,
      style: { background: 'accent', opacity: 0.16, borderRadius: 18 }
    },
    metric: {
      text: '3x',
      label: 'Faster first draft',
      x: 64,
      y: 48,
      w: 24,
      h: 22,
      style: { fontSize: 44, fontWeight: 800, color: 'accent', background: 'rgba(255,255,255,0.72)', borderRadius: 12 }
    }
  };
  return {
    id: uid('el'),
    type,
    ...clone(defaults[type] || defaults.text),
    ...overrides,
    style: {
      ...(defaults[type]?.style || defaults.text.style),
      ...(overrides.style || {})
    }
  };
}

function designedSlide(title, index, total) {
  return normalizeSlide({
    id: uid('slide'),
    title,
    notes: `State the takeaway for "${title}" first, then support it with one concrete example.`,
    style: styleForIndex(index),
    elements: fallbackElementsFor(title, index, total)
  }, index);
}

function styleForIndex(index) {
  const styleVariants = [
    { background: '#fbfcff', accent: '#2357d8', accent2: '#0d9488' },
    { background: '#fffdf7', accent: '#b45309', accent2: '#2563eb' },
    { background: '#f8fbff', accent: '#0f766e', accent2: '#7c3aed' },
    { background: '#fdfcff', accent: '#7c3aed', accent2: '#db2777' }
  ];
  return styleVariants[index % styleVariants.length];
}

function fallbackElementsFor(title, index, total) {
  const cover = index === 0;
  const closing = index === total - 1;
  if (cover) {
    return [
      createElement('shape', { x: 62, y: 7, w: 28, h: 76, style: { background: 'accent', opacity: 0.13, borderRadius: 22 } }),
      createElement('text', { text: title, x: 9, y: 23, w: 58, h: 24, style: { fontSize: 48, fontWeight: 820, color: 'ink' } }),
      createElement('text', { text: state.audience || 'AI-assisted presentation draft', x: 10, y: 54, w: 45, h: 10, style: { fontSize: 20, fontWeight: 520, color: 'muted' } })
    ];
  }
  if (closing) {
    return [
      createElement('text', { text: title, x: 12, y: 18, w: 68, h: 20, style: { fontSize: 42, fontWeight: 800, color: 'ink' } }),
      createElement('list', { items: ['Confirm the direction', 'Select the owner', 'Start the next iteration'], x: 14, y: 45, w: 52, h: 32 }),
      createElement('shape', { x: 70, y: 42, w: 18, h: 18, style: { background: 'accent2', opacity: 0.22, borderRadius: 99 } })
    ];
  }
  if (index % 3 === 1) {
    return [
      createElement('text', { text: title, x: 8, y: 10, w: 62, h: 14, style: { fontSize: 34, fontWeight: 800, color: 'ink' } }),
      createElement('list', { items: pointsFor(title, index), x: 9, y: 32, w: 44, h: 42 }),
      createElement('metric', { text: index === 1 ? '70%' : `${index + 1}`, label: 'signal to remember', x: 62, y: 35, w: 26, h: 26 })
    ];
  }
  if (index % 3 === 2) {
    return [
      createElement('shape', { x: 7, y: 13, w: 24, h: 62, style: { background: 'accent2', opacity: 0.16, borderRadius: 18 } }),
      createElement('text', { text: title, x: 37, y: 12, w: 50, h: 16, style: { fontSize: 33, fontWeight: 790, color: 'ink' } }),
      createElement('list', { items: pointsFor(title, index), x: 38, y: 35, w: 42, h: 38 })
    ];
  }
  return [
    createElement('text', { text: title, x: 8, y: 10, w: 62, h: 15, style: { fontSize: 34, fontWeight: 800, color: 'ink' } }),
    createElement('metric', { text: '1', label: pointsFor(title, index)[0], x: 9, y: 38, w: 23, h: 24 }),
    createElement('metric', { text: '2', label: pointsFor(title, index)[1], x: 38, y: 38, w: 23, h: 24 }),
    createElement('metric', { text: '3', label: pointsFor(title, index)[2], x: 67, y: 38, w: 23, h: 24 })
  ];
}

function pointsFor(title, index) {
  const source = [
    `Clarify the decision behind ${title}`,
    'Reduce manual formatting and rewrite cycles',
    'Keep the human in control of the final message',
    'Generate layout, copy, and style together',
    'Edit every object directly after generation'
  ];
  return [source[index % source.length], source[(index + 1) % source.length], source[(index + 2) % source.length]];
}

function defaultSlides() {
  const outline = defaultOutline();
  return outline.map((title, index) => designedSlide(title, index, outline.length));
}

function normalizeElement(element) {
  const type = ELEMENT_TYPES.includes(element.type) ? element.type : 'text';
  const base = createElement(type);
  return {
    ...base,
    ...element,
    id: element.id || uid('el'),
    type,
    x: clamp(Number(element.x ?? base.x), 0, 96),
    y: clamp(Number(element.y ?? base.y), 0, 96),
    w: clamp(Number(element.w ?? base.w), 3, 100),
    h: clamp(Number(element.h ?? base.h), 3, 100),
    text: typeof element.text === 'string' ? element.text : base.text,
    label: typeof element.label === 'string' ? element.label : base.label,
    items: Array.isArray(element.items) ? element.items.map(String) : base.items,
    style: normalizeStyle({ ...base.style, ...(element.style || {}) })
  };
}

function normalizeStyle(style) {
  return {
    fontSize: clamp(Number(style.fontSize || 20), 8, 88),
    fontWeight: clamp(Number(style.fontWeight || 500), 100, 900),
    color: style.color || 'ink',
    align: style.align || 'left',
    background: style.background || 'transparent',
    opacity: clamp(Number(style.opacity ?? 1), 0, 1),
    borderRadius: clamp(Number(style.borderRadius || 0), 0, 99)
  };
}

function normalizeSlide(slide, index) {
  return {
    id: slide.id || uid('slide'),
    title: slide.title || `${t('newSlideTitle')} ${index + 1}`,
    notes: slide.notes || '',
    style: {
      ...THEMES[state.theme],
      ...(slide.style || {})
    },
    elements: Array.isArray(slide.elements) && slide.elements.length > 0
      ? slide.elements.map(normalizeElement)
      : fallbackElementsFor(slide.title || `${t('newSlideTitle')} ${index + 1}`, index, state.slides.length || 1).map(normalizeElement)
  };
}

function ensureState() {
  if (!state.title) state.title = t('defaultDeckTitle');
  if (!Array.isArray(state.outline) || state.outline.length === 0) state.outline = defaultOutline();
  if (!Array.isArray(state.slides) || state.slides.length === 0) state.slides = defaultSlides();
  if (!Array.isArray(state.chatMessages) || state.chatMessages.length === 0) {
    state.chatMessages = [
      {
        role: 'assistant',
        text: 'Tell me what deck you need. I can generate the whole deck or redesign the selected slide.'
      }
    ];
  }
  state.slides = state.slides.map(normalizeSlide);
  if (!state.slides.some((slide) => slide.id === state.activeSlideId)) state.activeSlideId = state.slides[0]?.id || '';
  if (!activeSlide()?.elements?.some((element) => element.id === state.selectedElementId)) {
    state.selectedElementId = activeSlide()?.elements?.[0]?.id || '';
  }
}

function activeSlide() {
  return state.slides.find((slide) => slide.id === state.activeSlideId) || state.slides[0];
}

function activeIndex() {
  return Math.max(0, state.slides.findIndex((slide) => slide.id === state.activeSlideId));
}

function selectedElement() {
  return activeSlide()?.elements?.find((element) => element.id === state.selectedElementId) || null;
}

async function persist(silent = true) {
  ensureState();
  await storage().set(STORAGE_KEY, { ...state, updatedAt: Date.now() });
  if (!silent) setStatus(t('saved'));
}

async function load() {
  try {
    const saved = await storage().get(STORAGE_KEY);
    if (saved && Array.isArray(saved.slides)) state = { ...state, ...saved };
  } catch (error) {
    runtime().log?.warn?.('Failed to load PPT Live state', { error: String(error) });
  }
  ensureState();
}

function syncInputs() {
  if ($('deckTone')) $('deckTone').value = state.tone || 'professional';
  if ($('deckSlideTarget')) $('deckSlideTarget').value = state.slideTarget || state.slides.length || 8;
  $('currentSlideIndex').textContent = String(activeIndex() + 1);
  $('slideCount').textContent = String(state.slideTarget || state.slides.length);
  $('deckTitle').textContent = state.title || t('defaultDeckTitle');
  $('deckMeta').textContent = `${state.slides.length} ${t('slidesMeta')}`;
  renderChatMessages();
  syncInspector();
}

function renderChatMessages() {
  const holder = $('chatMessages');
  if (!holder) return;
  holder.innerHTML = '';
  state.chatMessages.slice(-24).forEach((message) => {
    const item = document.createElement('div');
    item.className = `chat-message is-${message.role}`;
    item.textContent = message.text;
    holder.append(item);
  });
  holder.scrollTop = holder.scrollHeight;
}

function syncInspector() {
  const element = selectedElement();
  const panel = $('elementInspector');
  if (!element) {
    panel.innerHTML = `<p class="empty-copy">${t('noSelection')}</p>`;
    return;
  }
  panel.innerHTML = `
    <label>${t('elementTypeLabel')}<input id="elementType" type="text" value="${escapeAttr(element.type)}" readonly></label>
    <label>${t('elementTextLabel')}<textarea id="elementText" rows="4">${escapeHtml(element.text || '')}</textarea></label>
    <label>${t('elementItemsLabel')}<textarea id="elementItems" rows="5">${escapeHtml((element.items || []).join('\n'))}</textarea></label>
    <div class="field-grid dense">
      <label>X<input id="elementX" type="number" min="0" max="100" value="${round(element.x)}"></label>
      <label>Y<input id="elementY" type="number" min="0" max="100" value="${round(element.y)}"></label>
      <label>W<input id="elementW" type="number" min="3" max="100" value="${round(element.w)}"></label>
      <label>H<input id="elementH" type="number" min="3" max="100" value="${round(element.h)}"></label>
    </div>
    <div class="field-grid dense">
      <label>Font<input id="elementFontSize" type="number" min="8" max="88" value="${element.style.fontSize}"></label>
      <label>Weight<input id="elementWeight" type="number" min="100" max="900" step="50" value="${element.style.fontWeight}"></label>
      <label>Color<input id="elementColor" type="text" value="${escapeAttr(element.style.color)}"></label>
      <label>Bg<input id="elementBg" type="text" value="${escapeAttr(element.style.background)}"></label>
    </div>
    <label>${t('speakerNotesLabel')}<textarea id="slideNotesInput" rows="4">${escapeHtml(activeSlide().notes || '')}</textarea></label>
  `;
  ['elementText', 'elementItems', 'elementX', 'elementY', 'elementW', 'elementH', 'elementFontSize', 'elementWeight', 'elementColor', 'elementBg', 'slideNotesInput'].forEach((id) => {
    $(id).addEventListener('input', readInspector);
  });
}

function readComposer() {
  state.tone = $('deckTone')?.value || state.tone || 'professional';
  state.slideTarget = clamp(Number($('deckSlideTarget')?.value) || state.slideTarget || 8, 4, 20);
  if ($('deckSlideTarget')) $('deckSlideTarget').value = state.slideTarget;
}

function readInspector() {
  const slide = activeSlide();
  const element = selectedElement();
  if (!slide || !element) return;
  element.text = $('elementText')?.value || '';
  element.items = ($('elementItems')?.value || '').split('\n').map((item) => item.trim()).filter(Boolean);
  element.x = clamp(Number($('elementX')?.value ?? element.x), 0, 100);
  element.y = clamp(Number($('elementY')?.value ?? element.y), 0, 100);
  element.w = clamp(Number($('elementW')?.value ?? element.w), 3, 100);
  element.h = clamp(Number($('elementH')?.value ?? element.h), 3, 100);
  element.style.fontSize = clamp(Number($('elementFontSize')?.value ?? element.style.fontSize), 8, 88);
  element.style.fontWeight = clamp(Number($('elementWeight')?.value ?? element.style.fontWeight), 100, 900);
  element.style.color = $('elementColor')?.value || element.style.color;
  element.style.background = $('elementBg')?.value || element.style.background;
  slide.notes = $('slideNotesInput')?.value || slide.notes;
  updateSlideTitleFromElements(slide);
  renderOutline();
  renderThumbs();
  renderSlideCanvas();
  persist();
}

function updateSlideTitleFromElements(slide) {
  const titleElement = slide.elements.find((element) => element.type === 'text');
  if (titleElement?.text) slide.title = titleElement.text.slice(0, 80);
  state.outline[activeIndex()] = slide.title;
  state.title = state.slides[0]?.title || state.title;
}

function render() {
  ensureState();
  syncInputs();
  renderOutline();
  renderThumbs();
  renderSlideCanvas();
  document.querySelectorAll('.theme-swatch').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.theme === state.theme);
  });
  document.querySelectorAll('.segment').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === state.mode);
  });
}

function renderOutline() {
  const list = $('outlineList');
  list.innerHTML = '';
  state.outline.forEach((item, index) => {
    const li = document.createElement('li');
    const input = document.createElement('input');
    input.className = 'outline-input';
    input.value = item;
    input.addEventListener('input', () => {
      state.outline[index] = input.value;
      if (state.slides[index]) state.slides[index].title = input.value;
      renderThumbs();
      persist();
    });
    li.append(input);
    list.append(li);
  });
}

function renderThumbs() {
  const holder = $('slideThumbs');
  holder.innerHTML = '';
  state.slides.forEach((slide, index) => {
    const button = document.createElement('button');
    button.className = `thumb${slide.id === state.activeSlideId ? ' is-active' : ''}`;
    button.type = 'button';
    button.innerHTML = `<span class="thumb-title"></span><span class="thumb-number">${index + 1}</span>`;
    button.querySelector('.thumb-title').textContent = slide.title;
    button.style.background = slide.style.background || THEMES[state.theme].background;
    button.addEventListener('click', () => {
      state.activeSlideId = slide.id;
      state.selectedElementId = slide.elements[0]?.id || '';
      render();
      persist();
    });
    holder.append(button);
  });
}

function renderSlideCanvas() {
  $('slideCanvas').innerHTML = slideHtml(activeSlide(), { editable: true });
  $('slideCanvas').querySelectorAll('.slide-element').forEach((node) => {
    node.addEventListener('pointerdown', beginDrag);
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      state.selectedElementId = node.dataset.elementId;
      render();
      persist();
    });
    node.addEventListener('dblclick', () => {
      const element = selectedElement();
      if (!element || element.type === 'shape') return;
      openEditModal(element);
    });
  });
  $('slideCanvas').addEventListener('click', () => {
    state.selectedElementId = '';
    render();
  }, { once: true });
}

function slideHtml(slide, options = {}) {
  const theme = themeFor(slide);
  const editable = Boolean(options.editable);
  const style = `--slide-bg:${theme.background};--slide-ink:${theme.ink};--slide-muted:${theme.muted};--slide-accent:${theme.accent};--slide-accent-2:${theme.accent2};`;
  return `<div class="slide free-slide" style="${style}" data-slide-id="${escapeAttr(slide.id)}">
    ${(slide.elements || []).map((element) => elementHtml(element, theme, editable)).join('')}
  </div>`;
}

function elementHtml(element, theme, editable) {
  const selected = editable && element.id === state.selectedElementId;
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
    `border-radius:${element.style.borderRadius}px`
  ].join(';');
  const classes = `slide-element element-${element.type}${selected ? ' is-selected' : ''}`;
  let content = '';
  if (element.type === 'list') {
    content = `<ul>${(element.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  } else if (element.type === 'metric') {
    content = `<strong>${escapeHtml(element.text || '')}</strong><span>${escapeHtml(element.label || '')}</span>`;
  } else if (element.type === 'shape') {
    content = element.text ? `<span>${escapeHtml(element.text)}</span>` : '';
  } else {
    content = escapeHtml(element.text || '');
  }
  return `<div class="${classes}" data-element-id="${escapeAttr(element.id)}" style="${style}">${content}${selected ? '<i class="resize-handle"></i>' : ''}</div>`;
}

function resolveColor(value, theme) {
  if (!value || value === 'transparent') return 'transparent';
  if (value === 'ink') return theme.ink;
  if (value === 'muted') return theme.muted;
  if (value === 'accent') return theme.accent;
  if (value === 'accent2') return theme.accent2;
  if (value === 'background') return theme.background;
  return value;
}

function beginDrag(event) {
  if (event.button !== 0) return;
  const target = event.currentTarget;
  const slide = activeSlide();
  const element = slide.elements.find((item) => item.id === target.dataset.elementId);
  if (!element) return;
  state.selectedElementId = element.id;
  const rect = $('slideCanvas').getBoundingClientRect();
  const resizing = event.target.classList.contains('resize-handle');
  dragState = {
    pointerId: event.pointerId,
    resizing,
    startX: event.clientX,
    startY: event.clientY,
    rect,
    start: { x: element.x, y: element.y, w: element.w, h: element.h }
  };
  target.setPointerCapture(event.pointerId);
  window.addEventListener('pointermove', dragMove);
  window.addEventListener('pointerup', endDrag, { once: true });
}

function dragMove(event) {
  if (!dragState) return;
  const element = selectedElement();
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
  renderSlideCanvas();
  syncInspector();
}

function endDrag() {
  dragState = null;
  window.removeEventListener('pointermove', dragMove);
  persist();
}

function extractJson(text) {
  if (!text) return null;
  const raw = typeof text === 'string' ? text : text.text || '';
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function askAi(prompt, maxTokens = 1800) {
  const host = runtime();
  if (!host.ai?.complete) throw new Error('AI unavailable');
  const result = await host.ai.complete(prompt, {
    systemPrompt: 'You design editable PPT slides. Return strict JSON only. Use percent positions. Avoid markdown fences.',
    maxTokens,
    temperature: 0.62
  });
  return extractJson(result && result.text ? result.text : result);
}

function buildContext() {
  readComposer();
  return {
    topic: state.topic || t('defaultDeckTitle'),
    audience: state.audience || 'general audience',
    scenario: state.scenario,
    tone: state.tone,
    slideTarget: state.slideTarget,
    material: state.material
  };
}

async function handleChatSend() {
  const input = $('chatInput');
  const message = input?.value.trim() || '';
  if (!message) return;
  input.value = '';
  state.chatMessages.push({ role: 'user', text: message });
  renderChatMessages();

  const hasUserDeck = state.slides.length > 0 && state.topic;
  if (!hasUserDeck || /generate|create|make|deck|ppt|slides|presentation|生成|做一份|创建|演示/i.test(message)) {
    state.topic = message;
    state.material = message;
    await generateDeck();
    state.chatMessages.push({ role: 'assistant', text: 'I generated a designed editable deck. Select any object to fine tune it, or ask me to revise a slide.' });
  } else {
    await aiDesign(message);
    state.chatMessages.push({ role: 'assistant', text: 'I updated the selected slide with that instruction.' });
  }
  render();
  persist();
}

async function generateOutline() {
  const context = buildContext();
  setBusy(true);
  setStatus(t('working'));
  try {
    const data = await askAi([
      'Return JSON: {"title":"deck title","outline":["slide title", "..."]}.',
      `Language: ${locale()}.`,
      `Context: ${JSON.stringify(context)}.`,
      'The outline should fit a practical PPT deck.'
    ].join('\n'), 900);
    if (!data?.outline?.length) throw new Error('Invalid outline');
    state.title = data.title || data.outline[0] || state.title;
    state.outline = data.outline.slice(0, context.slideTarget);
    setStatus(t('outlineReady'));
  } catch {
    state.outline = localOutline(context);
    state.title = state.outline[0] || context.topic;
    setStatus(t('aiUnavailable'));
  } finally {
    setBusy(false);
    render();
    persist();
  }
}

async function generateDeck() {
  const context = buildContext();
  if (!state.outline.length) state.outline = localOutline(context);
  setBusy(true);
  setStatus(t('working'));
  try {
    const schema = '{"title":"...","slides":[{"title":"...","notes":"...","style":{"background":"#...","ink":"#...","muted":"#...","accent":"#...","accent2":"#..."},"elements":[{"type":"text|list|shape|metric","x":0-100,"y":0-100,"w":0-100,"h":0-100,"text":"...","label":"...","items":["..."],"style":{"fontSize":number,"fontWeight":number,"color":"ink|muted|accent|accent2|#hex","background":"transparent|accent|accent2|rgba(...)|#hex","borderRadius":number,"opacity":0-1,"align":"left|center|right"}}]}]}';
    const data = await askAi([
      `Return JSON with this shape: ${schema}.`,
      `Language: ${locale()}.`,
      `Context: ${JSON.stringify(context)}.`,
      `Confirmed outline: ${JSON.stringify(state.outline)}.`,
      'Generate each slide as a distinct editable layout. Do not use one fixed title/body template. Position elements freely on a 16:9 canvas. Generate visual style per slide.'
    ].join('\n'), 2600);
    if (!data?.slides?.length) throw new Error('Invalid deck');
    state.title = data.title || state.title || context.topic;
    state.slides = data.slides.slice(0, context.slideTarget).map(normalizeSlide);
  } catch {
    state.slides = localSlides(context, state.outline).map(normalizeSlide);
    setStatus(t('aiUnavailable'));
  }
  state.activeSlideId = state.slides[0]?.id || '';
  state.selectedElementId = state.slides[0]?.elements?.[0]?.id || '';
  state.outline = state.slides.map((slide) => slide.title);
  state.title = state.slides[0]?.title || state.title;
  setBusy(false);
  render();
  persist();
  if ($('statusLine').textContent !== t('aiUnavailable')) setStatus(t('deckReady'));
}

function localOutline(context) {
  return [
    context.topic,
    'Why this matters now',
    'Audience pain points',
    'Proposed approach',
    'Workflow and capabilities',
    'Evidence and value',
    'Implementation path',
    'Decision and next steps'
  ].slice(0, context.slideTarget);
}

function localSlides(context, outline) {
  return outline.map((title, index) => designedSlide(title, index, outline.length));
}

async function aiDesign(action) {
  const instruction = action || $('chatInput')?.value.trim() || '';
  if (!instruction) return;
  setBusy(true);
  setStatus(t('working'));
  const slide = activeSlide();
  try {
    const schema = '{"title":"...","notes":"...","style":{"background":"#...","ink":"#...","muted":"#...","accent":"#...","accent2":"#..."},"elements":[{"type":"text|list|shape|metric","x":0-100,"y":0-100,"w":0-100,"h":0-100,"text":"...","label":"...","items":["..."],"style":{"fontSize":number,"fontWeight":number,"color":"ink|muted|accent|accent2|#hex","background":"transparent|accent|accent2|rgba(...)|#hex","borderRadius":number,"opacity":0-1,"align":"left|center|right"}}]}';
    const data = await askAi([
      `Return JSON for one redesigned slide with this shape: ${schema}.`,
      `Language: ${locale()}.`,
      `Instruction: ${instruction}.`,
      `Deck context: ${JSON.stringify(buildContext())}.`,
      `Current slide: ${JSON.stringify(slide)}.`,
      'Preserve the core message, but you may change layout, element positions, visual style, and text density.'
    ].join('\n'), 1800);
    if (!data?.elements?.length) throw new Error('Invalid slide');
    Object.assign(slide, normalizeSlide({ ...slide, ...data }, activeIndex()));
  } catch {
    localRedesign(slide, instruction);
  }
  state.selectedElementId = slide.elements[0]?.id || '';
  setBusy(false);
  render();
  persist();
  setStatus(t('slideUpdated'));
}

async function restyleDeck() {
  const next = arguments[0] || (state.theme === 'executive' ? 'fresh' : state.theme === 'fresh' ? 'studio' : 'executive');
  state.theme = next;
  state.slides.forEach((slide, index) => {
    slide.style = { ...THEMES[next], ...(index % 2 ? { accent: THEMES[next].accent2, accent2: THEMES[next].accent } : {}) };
  });
  render();
  persist();
  setStatus(t('slideUpdated'));
}

function localRedesign(slide, instruction) {
  const title = slide.title;
  const index = activeIndex();
  const redesigned = designedSlide(title, index + 1, state.slides.length + 1);
  if (String(instruction).includes('visual')) {
    redesigned.elements.unshift(createElement('shape', { x: 5, y: 8, w: 86, h: 76, style: { background: 'accent', opacity: 0.06, borderRadius: 20 } }));
  }
  Object.assign(slide, redesigned, { id: slide.id, title });
}

function addElement(type) {
  const slide = activeSlide();
  const element = createElement(type, { x: 12 + slide.elements.length * 3, y: 18 + slide.elements.length * 3 });
  slide.elements.push(element);
  state.selectedElementId = element.id;
  render();
  persist();
}

function deleteElement() {
  const slide = activeSlide();
  if (!slide) return;
  slide.elements = slide.elements.filter((element) => element.id !== state.selectedElementId);
  state.selectedElementId = slide.elements[0]?.id || '';
  render();
  persist();
}

function addSlide() {
  const index = activeIndex() + 1;
  const slide = designedSlide(t('newSlideTitle'), index, state.slides.length + 1);
  state.slides.splice(index, 0, slide);
  state.activeSlideId = slide.id;
  state.selectedElementId = slide.elements[0]?.id || '';
  state.outline = state.slides.map((item) => item.title);
  render();
  persist();
}

function deleteSlide() {
  if (state.slides.length <= 1) {
    setStatus(t('cannotDelete'));
    return;
  }
  const index = activeIndex();
  state.slides.splice(index, 1);
  state.activeSlideId = state.slides[Math.max(0, index - 1)].id;
  state.selectedElementId = activeSlide().elements[0]?.id || '';
  state.outline = state.slides.map((item) => item.title);
  render();
  persist();
}

function newDeck() {
  state = {
    ...state,
    title: t('defaultDeckTitle'),
    topic: '',
    audience: '',
    material: '',
    outline: defaultOutline(),
    slides: defaultSlides(),
    chatMessages: [
      {
        role: 'assistant',
        text: 'Tell me what deck you need. I can generate the whole deck or redesign the selected slide.'
      }
    ],
    activeSlideId: '',
    selectedElementId: '',
    presentIndex: 0
  };
  ensureState();
  render();
  persist(false);
}

function openEditModal(element) {
  state.selectedElementId = element.id;
  const modal = $('editModal');
  const textarea = $('editModalText');
  textarea.value = element.type === 'list' ? (element.items || []).join('\n') : element.text || '';
  modal.hidden = false;
  textarea.focus();
}

function closeEditModal() {
  $('editModal').hidden = true;
}

function saveEditModal() {
  const element = selectedElement();
  if (!element) return closeEditModal();
  const value = $('editModalText').value;
  if (element.type === 'list') element.items = value.split('\n').map((item) => item.trim()).filter(Boolean);
  else element.text = value;
  updateSlideTitleFromElements(activeSlide());
  closeEditModal();
  render();
  persist();
}

function openPreview() {
  state.presentIndex = activeIndex();
  renderPresent();
  $('previewDialog').showModal();
}

function renderPresent() {
  const slide = state.slides[state.presentIndex] || state.slides[0];
  $('presentSlide').innerHTML = slideHtml(slide);
  $('presentCounter').textContent = `${state.presentIndex + 1} / ${state.slides.length}`;
}

function movePresent(delta) {
  state.presentIndex = clamp(state.presentIndex + delta, 0, state.slides.length - 1);
  renderPresent();
}

function exportHtml() {
  const slides = state.slides.map((slide) => `<section class="deck-slide">${slideHtml(slide)}</section>`).join('\n');
  const css = collectCss();
  return `<!DOCTYPE html>
<html lang="${locale()}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(state.title)}</title>
<style>
body{margin:0;background:#111827;font-family:system-ui,sans-serif}.deck{display:grid;gap:24px;padding:24px}.deck-slide{display:grid;place-items:center;min-height:100vh}
${css}
</style>
</head>
<body><main class="deck">${slides}</main></body>
</html>`;
}

function collectCss() {
  const chunks = [];
  document.querySelectorAll('style').forEach((style) => chunks.push(style.textContent || ''));
  Array.from(document.styleSheets || []).forEach((sheet) => {
    try {
      const rules = Array.from(sheet.cssRules || []).map((rule) => rule.cssText).join('\n');
      if (rules) chunks.push(rules);
    } catch {
      // Fallback below keeps exported decks readable.
    }
  });
  if (chunks.length > 0) return chunks.join('\n');
  return `.slide{position:relative;width:100%;height:100%;background:var(--slide-bg);color:var(--slide-ink);overflow:hidden}.slide-element{position:absolute;padding:12px;overflow:hidden}.element-list ul{margin:0;padding-left:1.1em}.element-metric strong{display:block;font-size:inherit}`;
}

async function copyExport() {
  try {
    const html = exportHtml();
    if (runtime().clipboard?.writeText) await runtime().clipboard.writeText(html);
    else await navigator.clipboard.writeText(html);
    setStatus(t('copied'));
  } catch {
    setStatus(t('copyFailed'));
  }
}

function downloadExport() {
  const blob = new Blob([exportHtml()], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(state.title || 'ppt-live').replace(/[\\/:*?"<>|]+/g, '-')}.html`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  ['deckTone', 'deckSlideTarget'].forEach((id) => {
    $(id)?.addEventListener('input', () => {
      readComposer();
      persist();
    });
  });
  $('sendChat').addEventListener('click', handleChatSend);
  $('chatInput').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') handleChatSend();
  });
  $('addOutlineItem').addEventListener('click', () => {
    state.outline.push(t('newSlideTitle'));
    renderOutline();
    persist();
  });
  $('addSlide').addEventListener('click', addSlide);
  $('deleteSlide').addEventListener('click', deleteSlide);
  $('deleteElement').addEventListener('click', deleteElement);
  document.querySelectorAll('[data-add-element]').forEach((button) => {
    button.addEventListener('click', () => addElement(button.dataset.addElement));
  });
  $('newDeck').addEventListener('click', newDeck);
  $('previewDeck').addEventListener('click', openPreview);
  $('closePreview').addEventListener('click', () => $('previewDialog').close());
  $('prevPresent').addEventListener('click', () => movePresent(-1));
  $('nextPresent').addEventListener('click', () => movePresent(1));
  $('copyExport').addEventListener('click', copyExport);
  $('downloadExport').addEventListener('click', downloadExport);
  document.querySelectorAll('.ai-action').forEach((button) => {
    button.addEventListener('click', () => aiDesign(button.dataset.action));
  });
  $('restyleDeck').addEventListener('click', restyleDeck);
  document.querySelectorAll('.theme-swatch').forEach((button) => {
    button.addEventListener('click', () => {
      restyleDeck(button.dataset.theme);
    });
  });
  document.querySelectorAll('.segment').forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      if (state.mode === 'present') openPreview();
      render();
      persist();
    });
  });
  document.addEventListener('keydown', (event) => {
    if (!event.target.closest?.('.app-modal') && event.key === 'Escape' && !$('editModal').hidden) closeEditModal();
    if (!$('previewDialog').open) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') movePresent(1);
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') movePresent(-1);
  });
  $('closeEditModal').addEventListener('click', closeEditModal);
  $('cancelEditModal').addEventListener('click', closeEditModal);
  $('saveEditModal').addEventListener('click', saveEditModal);
  document.querySelectorAll('[data-close-edit]').forEach((node) => {
    node.addEventListener('click', closeEditModal);
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(Number(value) * 10) / 10;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

async function init() {
  applyI18n();
  await load();
  bindEvents();
  render();
  runtime().onLocaleChange?.(() => {
    applyI18n();
    render();
  });
}

init();
